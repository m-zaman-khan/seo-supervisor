// @ts-check
// Chrome flags and sessions in real Chrome. The checks that need no browser are in test/chrome-flags.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ChildProcess, execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHROME_FLAGS, launchChrome } from "../../skills/seo-supervisor/scripts/lib/cdp.mjs";
import {
  compareRendered,
  findBrowser,
  openSession,
  renderArgs,
  renderPage,
  startGuard,
} from "../../skills/seo-supervisor/scripts/checks/render.mjs";
import { checkPages, checkVisual } from "../../skills/seo-supervisor/scripts/checks/visual.mjs";
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

test(
  "renderPage in an open session: the DOM after scripts and 5 s of timers, a fresh cookie jar each time, the same errors",
  { skip, timeout: 120000 },
  async () => {
    const dir = tmp(),
      page = body =>
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page</title></head><body>${body}</body></html>`;
    const pages = {
      late: page(`<h1>Late</h1><script>setTimeout(() => { document.title = "Set after 3 s" }, 3000)</script>`),
      cookie: page(
        `<h1>Cookie</h1><p id="seen"></p><script>document.getElementById("seen").textContent = "seen:" + document.cookie; document.cookie = "visit=1; path=/"</script>`,
      ),
      login: page(
        `<main><h1>Sign in</h1><form><input name="email"><input type="password" name="pw"><button>Log in</button></form></main>`,
      ).replace("<title>Page", "<title>Sign in"),
    };
    for (const [name, html] of Object.entries(pages)) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, "index.html"), html);
    }
    const site = await serve(dir),
      closed = createServer();
    await new Promise(ok => closed.listen(0, "127.0.0.1", () => ok(undefined)));
    const deadPort = /** @type {import("node:net").AddressInfo} */ (closed.address()).port;
    await new Promise(ok => closed.close(() => ok(undefined)));
    const b = /** @type {string} */ (browser),
      session = await openSession(b, `${site.url}/`);
    try {
      const t0 = Date.now(),
        late = await renderPage(b, `${site.url}/late/`, {}, session);
      assert.match(late, /<title>Set after 3 s<\/title>/, "the page's timers ran, in Chrome's virtual time");
      assert.ok(Date.now() - t0 < 3000, `virtual time, not 3 s of waiting (${Date.now() - t0} ms)`);
      const seen = [];
      for (let i = 0; i < 2; i++)
        seen.push((await renderPage(b, `${site.url}/cookie/`, {}, session)).match(/seen:[^<]*/)?.[0]);
      assert.deepEqual(
        seen,
        ["seen:", "seen:"],
        "each render starts with no cookies, like the one-shot render's fresh profile",
      );
      await assert.rejects(
        renderPage(b, `${site.url}/login/`, {}, session),
        /Chrome showed a login screen at .*\/login\/, so it wasn't compared with the raw HTML/,
      );
      // Another port goes through the guard's proxy, which hangs up when nothing answers there.
      await assert.rejects(
        renderPage(b, `http://127.0.0.1:${deadPort}/`, {}, session),
        /Chrome couldn't load http:\/\/127\.0\.0\.1:\d+\/: net::ERR_(CONNECTION_REFUSED|EMPTY_RESPONSE)$/,
      );
    } finally {
      await session.close();
      await site.close();
    }
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

const words = n => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const doc = (body, css = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page</title><style>body{margin:0;font:16px/1.5 sans-serif}${css}</style></head><body>${body}</body></html>`;
const nav = `<header><nav id="nav">${["/a/", "/b/", "/c/", "/d/", "/e/", "/f/"].map(h => `<a href="${h}">Link ${h}</a>`).join(" ")}</nav><button id="tog" aria-expanded="false" aria-controls="nav">Menu</button></header>`;
const navCss =
  "#tog{display:none}@media (max-width:600px){#nav{display:none}#tog{display:block}#nav.open{display:block}}";
const SITE = {
  clean: doc(
    `${nav}<main><h1>Clean page</h1><a class="btn" href="/contact/" style="background:#036;color:#fff;padding:8px">Get a quote</a><p><a href="#details">Details</a> ${words(150)}</p><div style="height:1600px"></div><h2 id="details">Details</h2><p>${words(100)}</p></main><script>tog.onclick = () => nav.classList.toggle("open")</script>`,
    navCss,
  ),
  menu: doc(`${nav}<main><h1>Broken menu</h1><p>${words(100)}</p></main>`, navCss),
  tiny: doc(`<main><h1>Tiny text</h1><p>${words(200)}</p></main>`, "body{font-size:10px}"),
  jsadded: doc(
    `<main><h1>Added</h1><p>${words(20)}</p><div id="more"></div></main><script>document.getElementById("more").textContent = ${JSON.stringify(words(400))}</script>`,
  ),
  overlay: doc(
    `<main><h1>Overlay</h1><p>${words(200)}</p></main><div id="promo" style="position:fixed;inset:0;background:#fff">Subscribe to read on</div>`,
  ),
};

test(
  "one Chrome for the renders and both checks, one desktop and one phone load per page, the back/forward test on 3 pages",
  { skip, timeout: 300000 },
  async () => {
    const dir = tmp(),
      loads = {};
    for (const [name, html] of Object.entries(SITE)) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, "index.html"), html);
    }
    const site = await serve(dir, {
      before: req => {
        if (req.url.endsWith("/")) loads[req.url] = (loads[req.url] || 0) + 1;
        return false;
      },
    });
    const at = n => `${site.url}/${n}/`,
      urls = Object.keys(SITE).map(at),
      found = {};
    const add = (key, url) => {
      (found[new URL(url).pathname.slice(1, -1)] ||= []).push(key);
    };
    // Every Chrome start goes through ChildProcess.prototype.spawn (spawn and execFile alike).
    let starts = 0;
    const proto = /** @type {any} */ (ChildProcess.prototype),
      spawn = proto.spawn;
    proto.spawn = function (o) {
      if (/chrome|msedge/i.test(o.file)) starts++;
      return spawn.call(this, o);
    };
    let r,
      doms = [];
    try {
      const session = await openSession(/** @type {string} */ (browser), urls[0]);
      try {
        for (const u of urls) doms.push(await renderPage(/** @type {string} */ (browser), u, {}, session));
        r = await checkPages(/** @type {string} */ (browser), urls, {
          add,
          session,
          rawWords: new Map([
            [at("clean"), 272],
            [at("jsadded"), 22],
          ]),
        });
      } finally {
        await session.close();
      }
    } finally {
      proto.spawn = spawn;
      await site.close();
    }
    assert.equal(starts, 1, "one Chrome for everything");
    assert.match(doms[3], /word399/, "the render saw the page after its script");
    assert.deepEqual(compareRendered(SITE.clean, doms[0]), [], "and nothing JavaScript didn't change");
    assert.equal(r.visual.checked, 5, r.visual.notes.join(" "));
    assert.equal(r.more.checked, 5, r.more.notes.join(" "));
    assert.equal(r.visual.lab.length, 5);
    assert.equal(r.visual.bfTested, 3, "the back/forward test runs on 3 sample pages");
    assert.ok(
      r.visual.notes.some(n => /back\/forward cache test on 3 of them/.test(n)),
      r.visual.notes.join(" "),
    );
    assert.deepEqual(found, {
      menu: ["mobile-menu-closed"],
      tiny: ["mobile-small-text"],
      jsadded: ["render-adds-text"],
      overlay: ["mobile-interstitial"],
    });
    const clean = r.more.pages.find(p => p.url === at("clean"));
    assert.deepEqual(
      [clean.h1, clean.cta, clean.menu, clean.jumpLinks?.deepLink, clean.errors],
      [{ desktop: true, phone: true }, { desktop: "Get a quote", phone: "Get a quote" }, "opens", "ok", []],
    );
    // Each page: the render, one desktop and one phone load, the lab load; the first one's jump link; the back/forward
    // test loads pages 1-3 once more and goes on to the next page.
    assert.deepEqual(loads, { "/clean/": 6, "/menu/": 6, "/tiny/": 6, "/jsadded/": 5, "/overlay/": 4 });
  },
);

test("lab CLS in Chrome is the largest burst of layout shifts, not their sum", { skip, timeout: 120000 }, async () => {
  // Two shifts 1.7 s apart (the second timer starts at the first shift, so a busy machine can't bunch them into one
  // burst), after the throttled lab load's first paint and before its load event (a slow image holds it). Each pushes
  // the text 200 px down an 844 px screen. Chrome 157 scores them 0.237 and 0.175; their sum would be 0.412.
  const grow = `document.querySelector(".push").style.height = (parseInt(getComputedStyle(document.querySelector(".push")).height) + 200) + "px"`;
  const page = doc(
    `<div class="push" style="height:0"></div><main><h1>Shifting</h1><p>${words(300)}</p><img src="/slow.png" width="10" height="10" alt=""></main><script>setTimeout(() => { ${grow} }, 2500); setTimeout(() => { ${grow} }, 4200)</script>`,
  );
  const dir = tmp();
  mkdirSync(join(dir, "shift"));
  writeFileSync(join(dir, "shift", "index.html"), page);
  const site = await serve(dir, {
    before: (req, res) => {
      if (req.url !== "/slow.png") return false;
      setTimeout(() => res.writeHead(404).end(), 6000);
      return true;
    },
  });
  let r;
  try {
    r = await checkVisual(/** @type {string} */ (browser), [`${site.url}/shift/`], { add: () => {} });
  } finally {
    await site.close();
  }
  const cls = r.lab[0]?.cls;
  console.log(`lab CLS: ${cls}`);
  assert.ok(
    cls > 0.15 && cls < 0.3,
    `one shift's score, not the sum of both (${JSON.stringify(r.lab)} ${r.notes.join(" ")})`,
  );
});
