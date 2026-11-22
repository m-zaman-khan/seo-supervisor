import { test } from "node:test";
import assert from "node:assert/strict";
import { Fail, Refused, runMain } from "../skills/seo-supervisor/scripts/lib/cli.mjs";
import { parseArgs } from "../skills/seo-supervisor/scripts/lib/args.mjs";
import { bodyUpTo, retryAfter } from "../skills/seo-supervisor/scripts/lib/http.mjs";

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

test("parseArgs: --k v, --k=v and booleans; a bare word is never a flag, and a value never starts with --", () => {
  assert.deepEqual(parseArgs(["--site", "https://x.com", "--out=a b.json", "--yes"]), {
    _: [],
    site: "https://x.com",
    out: "a b.json",
    yes: true,
  });
  // A stray "yes" is a positional word, never --yes.
  const stray = parseArgs(["--site", "https://x.com", "--sitemap", "s.xml", "yes"]);
  assert.equal(stray.yes, undefined);
  assert.deepEqual(stray._, ["yes"]);
  assert.deepEqual(parseArgs(["--out", "--yes"]), { _: [], out: true, yes: true });
  assert.deepEqual(parseArgs(["submit", "--key", "k1", "extra"]), { _: ["submit", "extra"], key: "k1" });
  // A boolean never takes the next word, and takes no =value.
  assert.deepEqual(parseArgs(["--yes", "a.html"], { booleans: ["yes"] }), { _: ["a.html"], yes: true });
  assert.throws(
    () => parseArgs(["--yes=no"], { booleans: ["yes"] }),
    e => e instanceof Fail && /--yes takes no value/.test(e.message),
  );
  assert.deepEqual(parseArgs(["--out="]), { _: [], out: "" });
});

test("parseArgs: aliases, repeated flags, unknown options and unexpected words", () => {
  assert.deepEqual(parseArgs(["--rivals", "a.com"], { aliases: { rivals: "competitors" } }), {
    _: [],
    competitors: "a.com",
  });
  assert.deepEqual(parseArgs(["--log", "a.log", "--log=b", "--log"], { lists: ["log"] }), {
    _: [],
    log: ["a.log", "b", true],
  });
  // With flags listed, a misspelt one stops the script instead of being ignored.
  assert.throws(
    () => parseArgs(["--competitor", "a.com"], { flags: ["competitors"] }),
    e => e instanceof Fail && e.exitCode === 2 && /--competitor/.test(e.message),
  );
  assert.deepEqual(
    parseArgs(["--rivals", "a.com", "--yes"], {
      flags: ["competitors"],
      booleans: ["yes"],
      aliases: { rivals: "competitors" },
    }),
    { _: [], competitors: "a.com", yes: true },
  );
  assert.throws(
    () => parseArgs(["--site", "x", "yes"], { positionals: 0 }),
    e => e instanceof Fail && /"yes"/.test(e.message) && /--yes/.test(e.message),
  );
  assert.deepEqual(parseArgs(["off"], { positionals: 1 })._, ["off"]);
});

test("retryAfter: seconds or an HTTP date in any of its three formats, as ms from now; null when absent or unreadable", () => {
  const now = Date.parse("1994-11-06T08:49:00Z");
  assert.equal(retryAfter("120", now), 120000);
  assert.equal(retryAfter(" 0 ", now), 0);
  // IMF-fixdate, the obsolete RFC 850 form and asctime (which is UTC though it says no zone).
  // https://www.rfc-editor.org/rfc/rfc9110#section-5.6.7
  for (const d of ["Sun, 06 Nov 1994 08:49:37 GMT", "Sunday, 06-Nov-94 08:49:37 GMT", "Sun Nov  6 08:49:37 1994"])
    assert.equal(retryAfter(d, now), 37000, d);
  assert.equal(retryAfter("Sun, 06 Nov 1994 08:00:00 GMT", now), 0, "a date already past is no wait");
  for (const bad of [null, undefined, "", "1.5", "-3", "soon", "5 seconds"])
    assert.equal(retryAfter(bad, now), null, String(bad));
});

test("bodyUpTo: the body up to the cap, or null past it", async () => {
  assert.equal(String(await bodyUpTo(new Response("0123456789"), 10)), "0123456789");
  assert.equal(await bodyUpTo(new Response("0123456789"), 9), null);
  assert.equal(String(await bodyUpTo(new Response(null), 9)), "");
});
