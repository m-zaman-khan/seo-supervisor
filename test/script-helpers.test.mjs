import { test } from "node:test";
import assert from "node:assert/strict";
import { Fail, Refused, runMain } from "../skills/seo-supervisor/scripts/lib/cli.mjs";

// runMain sets process.exitCode; each test puts it back, so the test run's own exit code stays the runner's.
async function exitOf(t, main) {
  const out = [],
    err = [],
    was = process.exitCode;
  t.mock.method(console, "log", s => out.push(String(s)));
  t.mock.method(console, "error", s => err.push(String(s)));
  try {
    await runMain(main);
    return { code: process.exitCode, out: out.join("\n"), err: err.join("\n") };
  } finally {
    process.exitCode = was;
    t.mock.restoreAll();
  }
}

test("runMain: the exit code main returns, 0 when it returns nothing; Fail exits 2 (or its own code), Refused 1", async t => {
  assert.equal((await exitOf(t, () => 3)).code, 3);
  assert.equal((await exitOf(t, async () => {})).code, 0);
  const f = await exitOf(t, () => {
    throw new Fail("x: bad input");
  });
  assert.deepEqual([f.code, f.err, f.out], [2, "x: bad input", ""]);
  assert.equal(
    (
      await exitOf(t, () => {
        throw new Fail("x: the feed changed", 1);
      })
    ).code,
    1,
  );
  // A service saying no is a result, so it goes to stdout, named after the script.
  const r = await exitOf(t, async () => {
    throw new Refused("Google says the key is wrong (403).");
  });
  assert.equal(r.code, 1);
  assert.match(r.out, /^[\w.-]+: Google says the key is wrong \(403\)\.$/);
});

test("runMain: a Fail or Refused class from a script not moved to lib/cli yet is read the same way", async t => {
  class OldFail extends Error {}
  Object.defineProperty(OldFail, "name", { value: "Fail" });
  class Old2 extends Error {}
  Object.defineProperty(Old2, "name", { value: "Refused" });
  assert.equal(
    (
      await exitOf(t, () => {
        throw new OldFail("old: bad");
      })
    ).code,
    2,
  );
  assert.equal(
    (
      await exitOf(t, () => {
        throw new Old2("no");
      })
    ).code,
    1,
  );
});

test("runMain: a missing file and a bad settings folder are one plain line and exit 2; a bug keeps its stack trace", async t => {
  const { readFileSync } = await import("node:fs");
  const m = await exitOf(t, () => readFileSync("does-not-exist.json", "utf8"));
  assert.equal(m.code, 2);
  assert.match(m.err, /: can't open \S*does-not-exist\.json \(it isn't there\)\.$/);
  assert.doesNotMatch(m.err, /at |ENOENT:/);
  const s = await exitOf(t, () => {
    throw Object.assign(new Error("SEO_SUPERVISOR_HOME must be a full path"), { code: "SEO_SETTINGS" });
  });
  assert.deepEqual([s.code, s.err], [2, "SEO_SUPERVISOR_HOME must be a full path"]);
  await assert.rejects(
    exitOf(t, () => {
      throw new TypeError("a bug");
    }),
    /a bug/,
  );
});
