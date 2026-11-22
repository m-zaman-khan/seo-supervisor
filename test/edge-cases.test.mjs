// @ts-check
// Edge cases: the request pool with no concurrency, a CHROME_PATH that points at no file, a script that stays busy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmp } from "./helpers.mjs";
import { doctor } from "../skills/seo-supervisor/scripts/doctor.mjs";
import { pool } from "../skills/seo-supervisor/scripts/crawl/queue.mjs";

test("pool still runs every item when no concurrency is given (one at a time)", async () => {
  assert.deepEqual(await pool([1, 2, 3], undefined, async x => x * 2), [2, 4, 6]);
  assert.deepEqual(await pool([1, 2], 0, async x => x), [1, 2]);
});

test("doctor reports a CHROME_PATH that points at no file as a plain problem, not a crash", () => {
  const home = tmp();
  const missing = join(home, "no-such-chrome.exe");
  const r = doctor({
    env: { ...process.env, SEO_SUPERVISOR_HOME: join(home, ".seo-supervisor"), CHROME_PATH: missing },
    cwd: home,
  });
  assert.match(r.text, /!! {2}.*CHROME_PATH/, "a !! line names CHROME_PATH");
  assert.equal(r.ready, false, "a broken CHROME_PATH needs fixing");
});

test("a script file that stays rate-limited (503) isn't reported as a broken file", async () => {
  const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const { serve } = await import("./serve.mjs");
  const { SCRIPTS, node } = await import("./helpers.mjs");
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  writeFileSync(
    join(dir, "index.html"),
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Boiler repairs</title><script src="/busy.js"></script></head><body><main><h1>Boiler repairs</h1><p>Our engineers repair boilers across Leeds.</p></main></body></html>',
  );
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  mkdirSync(join(dir, "x"), { recursive: true });
  const site = await serve(dir, {
    before: (req, res) =>
      new URL(req.url, "http://x").pathname === "/busy.js"
        ? !!res.writeHead(503, { "Retry-After": "1" }).end("busy")
        : false,
  });
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--out", out]);
  } finally {
    await site.close();
  }
  const r = JSON.parse(readFileSync(out, "utf8"));
  const broken = r.findings.find(f => f.check === "own-file-broken");
  assert.ok(!broken?.evidence.some(e => /script/.test(e.detail)), JSON.stringify(broken?.evidence));
});
