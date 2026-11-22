// @ts-check
// Chrome flags and sessions in real Chrome. The checks that need no browser are in test/chrome-flags.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHROME_FLAGS, launchChrome } from "../../skills/seo-supervisor/scripts/lib/cdp.mjs";
import { findBrowser, renderArgs, startGuard } from "../../skills/seo-supervisor/scripts/checks/render.mjs";
import { shotArgs } from "../../skills/seo-supervisor/scripts/og-card.mjs";
import { serve } from "../serve.mjs";
import { tmp } from "../helpers.mjs";

const browser = findBrowser();
const skip = !browser && "Chrome not installed";
const sleep = ms => new Promise(ok => setTimeout(ok, ms));

// A proxy on 127.0.0.1 that refuses every request and records the host each one was for. Chrome sends everything but
// loopback through it, and --host-resolver-rules fails every other name lookup, so nothing leaves this machine.
async function refusingProxy() {
  const hosts = new Set();
  const server = createServer((req, res) => {
    try {
      hosts.add(new URL(req.url).host);
    } catch {
      hosts.add(String(req.url));
    }
    res.writeHead(403).end();
  });
  server.on("connect", (req, sock) => {
    hosts.add(req.url);
    sock.on("error", () => {}).end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", () => ok(undefined)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  return {
    hosts,
    port,
    args: [`--proxy-server=http://127.0.0.1:${port}`, "--host-resolver-rules=MAP * ^NOTFOUND, EXCLUDE 127.0.0.1"],
    close: () => {
      server.closeAllConnections();
      return new Promise(ok => server.close(() => ok(undefined)));
    },
  };
}
// Every host Chrome's own network log names (requests and name lookups), for what might bypass the proxy.
const netLogHosts = file =>
  existsSync(file)
    ? new Set(
        [...readFileSync(file, "utf8").matchAll(/"(?:url|host)":"(?:(?:https?|wss?):\/\/)?([^/":]+)/g)].map(m => m[1]),
      )
    : new Set();
const local = h => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h);

// The page: a form (autofill), a link with a ping (hyperlink auditing), an image and a script, all from the site.
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Contact us</title></head>
<body><main><h1>Contact us</h1><p>Boiler repairs across Leeds.</p><img src="/logo.png" alt="" width="10" height="10">
<form action="/send/" method="post"><label>Email <input type="email" name="email" autocomplete="email"></label><label>Password <input type="password" name="pw" autocomplete="current-password"></label><button>Send</button></form>
<a href="/about/" ping="/ping/">About</a></main><script>document.querySelector("a").click()</script></body></html>`;

test(
  "Chrome with the skill's flags tries no host outside this machine in 25 s, nor do the one-shot render and og-card runs",
  { skip, timeout: 120000 },
  async () => {
    const dir = tmp();
    for (const p of ["", "about", "send", "ping"]) {
      mkdirSync(join(dir, p), { recursive: true });
      writeFileSync(join(dir, p, "index.html"), PAGE);
    }
    const site = await serve(dir),
      log = join(dir, "netlog.json");
    const cdp = await refusingProxy(),
      render = await refusingProxy(),
      card = await refusingProxy();
    const found = {};
    try {
      // Opening tabs is what sets off Chrome's metrics upload and active-use ping, so this opens one every 1.5 s
      // for 25 s, as the phone, desktop and PDF loads do.
      const chrome = await launchChrome(/** @type {string} */ (browser), {
        args: [...cdp.args, `--log-net-log=${log}`],
      });
      try {
        for (const end = Date.now() + 25000; Date.now() < end;) {
          const page = await chrome.newPage();
          await page.send("Page.bringToFront");
          await page.send("Page.navigate", { url: `${site.url}/` });
          await sleep(1500);
          await page.close();
        }
      } finally {
        await chrome.close();
      }
      // The one-shot runs: the render's --dump-dom and og-card's --screenshot.
      const once = (args, profile) =>
        new Promise(ok =>
          execFile(/** @type {string} */ (browser), args, { timeout: 30000 }, () => {
            rmSync(profile, { recursive: true, force: true });
            ok(undefined);
          }),
        );
      const p1 = mkdtempSync(join(tmpdir(), "seo-supervisor-")),
        p2 = mkdtempSync(join(tmpdir(), "seo-supervisor-"));
      writeFileSync(join(dir, "card.html"), "<!doctype html><title>Card</title><h1>Card</h1>");
      await Promise.all([
        once(renderArgs(p1, `${site.url}/`, {}, render.args), p1),
        once(shotArgs(join(dir, "card.html"), join(dir, "card.png"), p2, card.args), p2),
      ]);
      found.cdp = [...new Set([...cdp.hosts, ...netLogHosts(log)])].filter(h => !local(h));
      found.render = [...render.hosts].filter(h => !local(h));
      found.ogCard = [...card.hosts].filter(h => !local(h));
    } finally {
      await Promise.all([site.close(), cdp.close(), render.close(), card.close()]);
    }
    console.log(`hosts Chrome tried: ${JSON.stringify(found)}`);
    assert.deepEqual(found, { cdp: [], render: [], ogCard: [] });
  },
);

// Chrome 157's active-use ping (update.googleapis.com, sent on close after real input) fires only now and then, so
// this checks how it's stopped: with the guard's proxy flags that host skips the proxy, and the resolver rule fails it.
test("update.googleapis.com goes neither out nor through the guard's proxy", { skip, timeout: 60000 }, async () => {
  // Checked first: without the rule, the direct request below would reach the real host.
  assert.ok(CHROME_FLAGS.includes("--host-resolver-rules=MAP update.googleapis.com ^NOTFOUND"));
  const proxy = await refusingProxy(),
    guard = await startGuard("http://127.0.0.1:9/", { env: {} });
  const bypass = guard?.args.find(a => a.startsWith("--proxy-bypass-list="));
  await guard?.close();
  assert.match(bypass || "", /;update\.googleapis\.com$/);
  let nav;
  const chrome = await launchChrome(/** @type {string} */ (browser), {
    args: [`--proxy-server=http://127.0.0.1:${proxy.port}`, /** @type {string} */ (bypass)],
  });
  try {
    nav = await (
      await chrome.newPage()
    ).send("Page.navigate", { url: "https://update.googleapis.com/service/update2/json" });
  } finally {
    await chrome.close();
    await proxy.close();
  }
  assert.equal(nav.errorText, "net::ERR_NAME_NOT_RESOLVED");
  assert.deepEqual([...proxy.hosts], [], "nothing went to the proxy");
});
