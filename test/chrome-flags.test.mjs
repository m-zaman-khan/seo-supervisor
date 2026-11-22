// @ts-check
// Chrome flags, lab CLS and API keys without a browser. Real-Chrome checks: test/browser/chrome-flags.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CHROME_FLAGS } from "../skills/seo-supervisor/scripts/lib/cdp.mjs";
import { renderArgs } from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { runLighthouse } from "../skills/seo-supervisor/scripts/checks/lighthouse.mjs";
import { shotArgs } from "../skills/seo-supervisor/scripts/og-card.mjs";
import { clsOf } from "../skills/seo-supervisor/scripts/checks/visual.mjs";
import { SCRIPTS, tmp } from "./helpers.mjs";

const run = (file, args = []) =>
  new Promise(ok =>
    execFile(process.execPath, [file, ...args], { timeout: 20000 }, (err, stdout, stderr) =>
      ok({ err, stdout, stderr }),
    ),
  );
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

test("H-01: all four launch sites pass the flags: launchChrome, the render, og-card and Lighthouse", async () => {
  // The browser launchChrome spawns is a stand-in that records its command line.
  const dir = tmp(),
    fake = join(dir, "fake-chrome.mjs"),
    script = join(dir, "launch.mjs");
  writeFileSync(fake, FAKE_CHROME);
  writeFileSync(
    script,
    `import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const spawn = cp.spawn;
let seen;
cp.spawn = (file, args, opts) => { seen = args; return spawn(process.execPath, [${JSON.stringify(fake)}, ...args], opts); };
syncBuiltinESMExports();
const { launchChrome } = await import(${JSON.stringify(pathToFileURL(join(SCRIPTS, "lib", "cdp.mjs")).href)});
const c = await launchChrome("fake-chrome");
await c.close();
console.log(JSON.stringify(seen));`,
  );
  const r = await run(script);
  assert.equal(r.err, null, r.stderr);
  hasAll(JSON.parse(r.stdout), "launchChrome");

  hasAll(renderArgs("/tmp/p", "https://example.com/", { platform: "darwin", env: {} }), "renderArgs");
  hasAll(
    renderArgs("/tmp/p", "https://example.com/", { platform: "linux", uid: 0, env: {}, exists: () => false }, [
      "--proxy-server=http://127.0.0.1:9",
    ]),
    "renderArgs behind the guard",
  );
  hasAll(shotArgs("/tmp/card.html", "/tmp/card.png", "/tmp/p"), "og-card");
  // Lighthouse: a stand-in CLI that records its arguments and the profile it was given, and writes an empty report.
  const bin = join(dir, "fake-lighthouse.mjs"),
    log = join(dir, "lh.json");
  writeFileSync(
    bin,
    `import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(log)}, JSON.stringify(args));
writeFileSync(args.find(a => a.startsWith("--output-path=")).slice(14), JSON.stringify({ categories: {}, audits: {} }));`,
  );
  await runLighthouse(bin, "http://127.0.0.1:1/", {
    host: { platform: "darwin", env: { HTTPS_PROXY: "http://proxy.corp:8080" } },
  });
  const flags =
    /** @type {string[]} */ (JSON.parse(readFileSync(log, "utf8"))).find(a => a.startsWith("--chrome-flags=")) || "";
  hasAll(flags.slice(15).split(" "), "Lighthouse --chrome-flags");
});
