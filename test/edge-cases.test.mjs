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
