// @ts-check
// Chrome flags, lab CLS and API keys without a browser. Real-Chrome checks: test/browser/chrome-flags.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CHROME_FLAGS } from "../skills/seo-supervisor/scripts/lib/cdp.mjs";
import { findBrowser, renderArgs } from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { runLighthouse } from "../skills/seo-supervisor/scripts/checks/lighthouse.mjs";
import { shotArgs } from "../skills/seo-supervisor/scripts/og-card.mjs";
import { clsOf } from "../skills/seo-supervisor/scripts/checks/visual.mjs";
import { checkSpeed, speedTrend } from "../skills/seo-supervisor/scripts/checks/speed.mjs";
import { ROOT, SCRIPTS, tmp } from "./helpers.mjs";

const hasAll = (args, what) => {
  for (const f of CHROME_FLAGS) assert.ok(args.includes(f), `${what}: ${f}`);
};

// A stand-in for Chrome on the DevTools pipe (fd 3 in, fd 4 out) that answers every command and exits on Browser.close.
const FAKE_CHROME = `import { Socket } from "node:net";
const out = new Socket({ fd: 4, readable: false, writable: true });
let buf = "";
new Socket({ fd: 3, readable: true, writable: false }).setEncoding("utf8").on("data", d => {
  buf += d;
  for (let k; (k = buf.indexOf("\\0")) >= 0; buf = buf.slice(k + 1)) {
    const m = JSON.parse(buf.slice(0, k));
    out.write(JSON.stringify({ id: m.id, result: { product: "Fake" } }) + "\\0");
    if (m.method === "Browser.close") setTimeout(() => process.exit(0), 50);
  }
});`;

test("one list of Chrome flags turns Chrome's own background traffic off", () => {
  for (const f of [
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-default-apps",
    "--no-pings",
    "--disable-domain-reliability",
  ])
    assert.ok(CHROME_FLAGS.includes(f), f);
  const off = CHROME_FLAGS.filter(f => f.startsWith("--disable-features=")),
    on = CHROME_FLAGS.filter(f => f.startsWith("--enable-features="));
  assert.equal(off.length, 1, "Chrome reads only the last --disable-features, so there's one");
  assert.equal(on.length, 1);
  for (const name of [
    "OptimizationHints",
    "Translate",
    "MediaRouter",
    "NetworkTimeServiceQuerying",
    "AutofillServerCommunication",
    "SafeBrowsingHashPrefixRealTimeLookups",
    "AimEnabled",
    "PreconnectToSearch",
  ])
    assert.ok(off[0].slice(19).split(",").includes(name), name);
  assert.deepEqual(on[0].slice(18).split(","), ["SkipListAccountsWithoutGaiaCookies"]);
  assert.ok(
    CHROME_FLAGS.includes("--host-resolver-rules=MAP update.googleapis.com ^NOTFOUND"),
    "Chrome's active-use ping can't resolve",
  );
});

test("lab CLS is the largest session window (shifts under 1 s apart, 5 s at most), not the sum", () => {
  const r = x => Math.round(x * 1000) / 1000;
  assert.equal(clsOf([]), 0);
  assert.equal(
    r(
      clsOf([
        [0, 0.1],
        [500, 0.1],
        [3000, 0.05],
      ]),
    ),
    0.2,
    "two windows, 0.2 and 0.05; the old sum was 0.25",
  );
  assert.equal(
    clsOf([
      [0, 0.1],
      [1000, 0.1],
    ]),
    0.1,
    "1 s apart starts a new window",
  );
  assert.equal(
    r(clsOf([0, 900, 1800, 2700, 3600, 4500, 5400].map(t => [t, 0.01]))),
    0.06,
    "a window ends 5 s after its first shift",
  );
  assert.equal(
    r(
      clsOf([
        [0, 0.02],
        [2000, 0.3],
        [2500, 0.1],
      ]),
    ),
    0.4,
    "the largest window wins, wherever it is",
  );
});

test("the PageSpeed and CrUX keys go in the X-Goog-Api-Key header, never in the address", async () => {
  const PSI = readFileSync(join(ROOT, "test", "fixtures", "psi-pass.json"), "utf8"),
    sent = [];
  const fetchFn = async (url, opts = {}) => {
    sent.push({ url, key: new Headers(opts.headers).get("x-goog-api-key") });
    return new Response(/runPagespeed/.test(url) ? PSI : "{}");
  };
  await checkSpeed(["https://example.com/"], /** @type {any} */ ({ add: () => {}, fetchFn, key: "psi-key" }));
  await checkSpeed(["https://example.com/"], /** @type {any} */ ({ add: () => {}, fetchFn }));
  await speedTrend("https://example.com", { key: "crux-key", fetchFn });
  assert.deepEqual(
    sent.map(s => [s.key, /[?&]key=/.test(s.url)]),
    [
      ["psi-key", false],
      [null, false],
      ["crux-key", false],
    ],
  );
});

test("a CHROME_PATH with no file there stops with a plain message, never falls back to the installed browser", async () => {
  const installed = p => p === "/usr/bin/google-chrome";
  assert.throws(
    () => findBrowser({ CHROME_PATH: "/c/Program Files/Google/chrome.exe" }, "linux", installed),
    /^Error: CHROME_PATH is set to “\/c\/Program Files\/Google\/chrome\.exe”, but there's no file there/,
  );
  assert.equal(
    findBrowser({ CHROME_PATH: "" }, "linux", installed),
    "/usr/bin/google-chrome",
    "an empty CHROME_PATH is unset",
  );
  assert.equal(findBrowser({}, "linux", installed), "/usr/bin/google-chrome");
  const dir = tmp(),
    r = await new Promise(ok =>
      execFile(
        process.execPath,
        [join(SCRIPTS, "og-card.mjs"), "--title", "Home", "--out", join(dir, "x.png")],
        { env: { ...process.env, CHROME_PATH: join(dir, "no-chrome.exe") } },
        (err, stdout, stderr) => ok({ err, stderr }),
      ),
    );
  assert.equal(r.err?.code, 2);
  assert.match(r.stderr, /^og-card: CHROME_PATH is set to “.*no-chrome\.exe”, but there's no file there/);
  assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/, "no stack trace");
});

// Loaded with --import: every start of "Chrome" is recorded with its command line and its profile's Local State at that
// moment; launchChrome's spawn gets the stand-in above, and the one-shot execFile runs fail at once. No browser starts.
const RECORDER = (log, fake) => `import cp from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
const note = (site, args) => { const dir = args.find(a => a.startsWith("--user-data-dir="))?.slice(16); let state = null; try { state = JSON.parse(readFileSync(join(dir, "Local State"), "utf8")); } catch {} appendFileSync(${JSON.stringify(log)}, JSON.stringify({ site, args, state }) + "\\n"); };
const spawn = cp.spawn;
cp.spawn = (file, args, opts) => { note("spawn", args); return spawn(process.execPath, [${JSON.stringify(fake)}, ...args], opts); };
cp.execFile = (file, args, opts, cb) => { note("execFile", args); process.nextTick(cb, new Error("not a browser"), "", ""); };
syncBuiltinESMExports();`;

test("all four launch sites pass the flags and start Chrome with metrics reporting off: launchChrome, the render, og-card and Lighthouse", async () => {
  const dir = tmp(),
    log = join(dir, "starts.jsonl"),
    pre = join(dir, "record.mjs"),
    fake = join(dir, "fake-chrome.mjs"),
    url = s => JSON.stringify(pathToFileURL(join(SCRIPTS, s)).href);
  writeFileSync(fake, FAKE_CHROME);
  writeFileSync(pre, RECORDER(log, fake));
  const script = (name, body) => {
    writeFileSync(join(dir, name), body);
    return join(dir, name);
  };
  const guarded = (file, args = [], env = process.env) =>
    new Promise(ok =>
      execFile(
        process.execPath,
        ["--import", pathToFileURL(pre).href, file, ...args],
        { timeout: 20000, env },
        (err, stdout, stderr) => ok({ err, stderr }),
      ),
    );
  let r = await guarded(
    script(
      "launch.mjs",
      `const { launchChrome } = await import(${url("lib/cdp.mjs")}); const c = await launchChrome("fake-chrome"); await c.close();`,
    ),
  );
  assert.equal(r.err, null, r.stderr);
  await guarded(
    script(
      "render.mjs",
      `const { renderPage } = await import(${url("checks/render.mjs")}); await renderPage("fake-chrome", "http://127.0.0.1:1/").catch(() => {});`,
    ),
  );
  await guarded(join(SCRIPTS, "og-card.mjs"), ["--title", "Home", "--out", join(dir, "card.png")], {
    ...process.env,
    CHROME_PATH: process.execPath,
  });
  // Lighthouse: a stand-in CLI that records its arguments and the profile it was given, and writes an empty report.
  const bin = join(dir, "fake-lighthouse.mjs");
  writeFileSync(
    bin,
    `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
// Read as Lighthouse reads it: split at spaces outside quotes, quotes dropped.
const args = process.argv.slice(2), flags = args.find(a => a.startsWith("--chrome-flags=")).slice(15).match(/--[^\\s=]+(?:="[^"]*"|=\\S*)?/g).map(f => f.replace(/="(.*)"$/, "=$1")), dir = flags.find(f => f.startsWith("--user-data-dir=")).slice(16);
let state = null; try { state = JSON.parse(readFileSync(dir + "/Local State", "utf8")); } catch {}
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ site: "lighthouse", args: flags, state }) + "\\n");
writeFileSync(args.find(a => a.startsWith("--output-path=")).slice(14), JSON.stringify({ categories: {}, audits: {} }));`,
  );
  await runLighthouse(bin, "http://127.0.0.1:1/", {
    host: { platform: "darwin", env: { HTTPS_PROXY: "http://proxy.corp:8080" } },
  });

  const starts = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map(l => JSON.parse(l));
  assert.deepEqual(
    starts.map(s => s.site),
    ["spawn", "execFile", "execFile", "lighthouse"],
    "launchChrome, the render, og-card, Lighthouse",
  );
  for (const s of starts) {
    hasAll(s.args, s.site);
    assert.deepEqual(
      s.state,
      { user_experience_metrics: { reporting_enabled: false } },
      `${s.site}: metrics reporting off in the profile`,
    );
  }
  hasAll(
    renderArgs("/tmp/p", "https://example.com/", { platform: "linux", uid: 0, env: {}, exists: () => false }, [
      "--proxy-server=http://127.0.0.1:9",
    ]),
    "renderArgs behind the guard",
  );
  hasAll(shotArgs("/tmp/card.html", "/tmp/card.png", "/tmp/p"), "og-card");
});
