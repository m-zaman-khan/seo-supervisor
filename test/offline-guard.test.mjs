// @ts-check
// The offline guard, the Chrome close wait and the test-only pause switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sleep } from "../skills/seo-supervisor/scripts/checks/crawl.mjs";
import { checkSpeed } from "../skills/seo-supervisor/scripts/checks/speed.mjs";
import { ROOT, SCRIPTS, tmp } from "./helpers.mjs";

const GUARD = pathToFileURL(join(ROOT, "test", "offline.mjs")).href;
// A node script run with the guard preloaded, with no NODE_OPTIONS of its own; resolves to { code, stdout, stderr }.
const guarded = (code, env = {}) =>
  new Promise(ok => {
    const e = /** @type {NodeJS.ProcessEnv} */ ({ ...process.env, ...env });
    delete e.NODE_OPTIONS;
    execFile(
      process.execPath,
      ["--import", GUARD, "--input-type=module", "-e", code],
      { env: e, timeout: 20000 },
      (err, stdout, stderr) => ok({ code: err ? err.code : 0, stdout, stderr }),
    );
  });

test("an outside connection fails loudly even when the code catches the error, and names the host", async () => {
  const r = await guarded(`await fetch("https://example.com/").catch(e => console.log("caught", e.cause?.code));`);
  assert.equal(r.code, 99, "the process fails");
  assert.match(r.stdout, /caught EOFFLINEGUARD/);
  assert.match(r.stderr, /offline guard: refused a connection to example\.com:443/);
});

test("an outside DNS lookup is refused, by callback and by promise, and loopback still works", async () => {
  const r = await guarded(`import dns from "node:dns";
dns.lookup("example.org", e => console.log("callback", e?.code));
await dns.promises.resolve4("example.net").catch(e => console.log("promise", e.code));
console.log("local", (await dns.promises.lookup("localhost")).address);`);
  assert.equal(r.code, 99);
  assert.match(r.stdout, /callback EOFFLINEGUARD/);
  assert.match(r.stdout, /promise EOFFLINEGUARD/);
  assert.match(r.stdout, /local (127\.0\.0\.1|::1)/);
  assert.match(r.stderr, /DNS lookup of example\.org/);
  assert.match(r.stderr, /DNS lookup of example\.net/);
  const server = createServer((q, s) => s.end("hello"));
  await new Promise(ok => server.listen(0, "127.0.0.1", () => ok(null)));
  try {
    const port = /** @type {any} */ (server.address()).port;
    const local = await guarded(`console.log(await (await fetch("http://127.0.0.1:${port}/")).text());`);
    assert.deepEqual([local.code, local.stdout.trim(), local.stderr], [0, "hello", ""]);
    // A name with the caller's own lookup is judged by the address it gives: loopback connects, anything else doesn't.
    const pinned = await guarded(`import { get } from "node:http";
const via = address => new Promise(ok => get({ host: "api.test", port: ${port}, agent: false, lookup: (h, o, cb) => o.all ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4) }, r => r.on("data", d => ok("got " + d))).on("error", e => ok(e.code)));
console.log(await via("127.0.0.1"), await via("93.184.216.34"));`);
    assert.equal(pinned.code, 99);
    assert.equal(pinned.stdout.trim(), "got hello EOFFLINEGUARD");
    assert.match(pinned.stderr, /refused a connection to api\.test:\d+ \(93\.184\.216\.34\)/);
  } finally {
    server.close();
  }
});

test("a node child is guarded too, even with an env of its own; Chrome, Edge and link openers aren't started", async () => {
  const child = `import { execFile } from "node:child_process";
execFile(process.execPath, ["-e", "try { require('node:net').connect(80, 'example.org'); } catch {}"], { env: { PATH: process.env.PATH } }, (e, out, err) => { console.log("child exit", e?.code); process.stderr.write(err); });`;
  const r = await guarded(child);
  assert.match(r.stdout, /child exit 99/, "the grandchild failed");
  assert.match(r.stderr, /refused a connection to example\.org:80/, "and named the host");
  for (const [file, args] of /** @type {[string, string[]][]} */ ([
    ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", []],
    ["/usr/bin/chromium", []],
    ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", []],
    ["msedge.exe", []],
    ["cmd", ["/c", "start", "", "https://example.com/"]],
    ["xdg-open", ["https://example.com/"]],
  ])) {
    const b = await guarded(`import { spawn, execFileSync } from "node:child_process";
try { spawn(${JSON.stringify(file)}, ${JSON.stringify(args)}); } catch (e) { console.log("spawn", e.code); }
try { execFileSync(${JSON.stringify(file)}, ${JSON.stringify(args)}); } catch (e) { console.log("sync", e.code); }`);
    assert.equal(b.code, 99, file);
    assert.match(b.stdout, /spawn EOFFLINEGUARD\nsync EOFFLINEGUARD/, file);
  }
});

test("the guard turns the fixed pauses off and drops the owner's PageSpeed keys; an empty value keeps the pauses", async () => {
  const r = await guarded(
    `console.log(JSON.stringify([process.env.SEO_SUPERVISOR_NO_PAUSES, process.env.PSI_API_KEY ?? null, process.env.CRUX_API_KEY ?? null]));`,
    { PSI_API_KEY: "real", CRUX_API_KEY: "real", SEO_SUPERVISOR_NO_PAUSES: undefined },
  );
  assert.deepEqual(JSON.parse(r.stdout), ["1", null, null]);
  const kept = await guarded(`console.log(JSON.stringify(process.env.SEO_SUPERVISOR_NO_PAUSES));`, {
    SEO_SUPERVISOR_NO_PAUSES: "",
  });
  assert.equal(JSON.parse(kept.stdout), "");
});

// A stand-in for Chrome on the DevTools pipe (fd 3 in, fd 4 out): it answers every command except Browser.close,
// which it ignores, and exits 300 ms later. The script points launchChrome's spawn at it, so no browser starts.
test("closing Chrome doesn't hold the process for the 5 s grace timer once the browser has exited", async () => {
  const dir = tmp(),
    fake = join(dir, "fake-chrome.mjs"),
    script = join(dir, "open-close.mjs");
  writeFileSync(
    fake,
    `import { Socket } from "node:net";
const out = new Socket({ fd: 4, readable: false, writable: true });
let buf = "";
new Socket({ fd: 3, readable: true, writable: false }).setEncoding("utf8").on("data", d => {
  buf += d;
  for (let k; (k = buf.indexOf("\\0")) >= 0; buf = buf.slice(k + 1)) {
    const m = JSON.parse(buf.slice(0, k));
    if (m.method === "Browser.close") { setTimeout(() => process.exit(0), 300); continue; }
    out.write(JSON.stringify({ id: m.id, result: { product: "Fake" } }) + "\\0");
  }
});`,
  );
  writeFileSync(
    script,
    `import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const spawn = cp.spawn;
cp.spawn = (file, args, opts) => spawn(process.execPath, [${JSON.stringify(fake)}, ...args], opts);
syncBuiltinESMExports();
const { launchChrome } = await import(${JSON.stringify(pathToFileURL(join(SCRIPTS, "lib", "cdp.mjs")).href)});
const c = await launchChrome("fake-chrome");
const t = Date.now();
await c.close();
console.log(Date.now() - t);`,
  );
  const t0 = Date.now();
  const r = await new Promise(ok =>
    execFile(process.execPath, [script], { timeout: 20000 }, (err, stdout, stderr) => ok({ err, stdout, stderr })),
  );
  const wall = Date.now() - t0;
  assert.equal(r.err, null, r.stderr);
  assert.ok(Number(r.stdout) >= 250, `close() waited for the browser to exit (${r.stdout.trim()} ms)`);
  assert.ok(wall < 3000, `the script exited ${wall} ms after it started`);
});

test("the fixed waits are 0 ms with the switch on and as long as asked without it; PageSpeed's 429 retry uses them", async () => {
  const was = process.env.SEO_SUPERVISOR_NO_PAUSES,
    time = async (ms, fn = () => sleep(ms)) => {
      const t = performance.now();
      await fn();
      return performance.now() - t;
    };
  const PSI = readFileSync(join(ROOT, "test", "fixtures", "psi-pass.json"), "utf8"),
    answers = [429, 200];
  const fetchFn = async () => {
    const status = answers.shift();
    return new Response(status === 429 ? "{}" : PSI, { status });
  };
  try {
    process.env.SEO_SUPERVISOR_NO_PAUSES = "";
    assert.ok((await time(300)) >= 290, "production waits are unchanged");
    process.env.SEO_SUPERVISOR_NO_PAUSES = "1";
    assert.ok((await time(5000)) < 100);
    let r = /** @type {any} */ (null);
    assert.ok(
      (await time(0, async () => {
        r = await checkSpeed(["https://example.com/"], /** @type {any} */ ({ add: () => {}, fetchFn }));
      })) < 1000,
      "no 5 s wait",
    );
    assert.deepEqual([answers.length, r.samples.length], [0, 1], "asked again after the 429");
  } finally {
    process.env.SEO_SUPERVISOR_NO_PAUSES = was;
  }
});
