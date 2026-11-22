import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { serve } from "./serve.mjs";
import { Fail, Refused, runMain } from "../skills/seo-supervisor/scripts/lib/cli.mjs";
import { parseArgs } from "../skills/seo-supervisor/scripts/lib/args.mjs";
import { bodyUpTo, retryAfter } from "../skills/seo-supervisor/scripts/lib/http.mjs";
import * as net from "../skills/seo-supervisor/scripts/lib/net.mjs";
import { privacyOf, writePrivate } from "../skills/seo-supervisor/scripts/lib/settings-dir.mjs";
import { hideSecrets, redact } from "../skills/seo-supervisor/scripts/lib/redact.mjs";

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

test("lib/net holds the one private-address test; checks/outbound.mjs re-exports the same functions", async () => {
  const outbound = await import("../skills/seo-supervisor/scripts/checks/outbound.mjs");
  for (const k of ["privateIp", "isPublic", "guarded"]) assert.equal(outbound[k], net[k], k);
  assert.ok(
    net.privateIp("::ffff:10.0.0.1") &&
      net.privateIp("100.64.0.1") &&
      net.privateIp("not-an-ip") &&
      !net.privateIp("8.8.8.8"),
  );
  assert.ok(
    net.isPublic("https://www.example.com/") &&
      !net.isPublic("http://169.254.169.254/") &&
      !net.isPublic("http://intranet/") &&
      !net.isPublic("http://a.internal/") &&
      !net.isPublic("javascript:alert(1)"),
  );
  for (const h of ["localhost", "127.0.0.1", "127.1.2.3", "0.0.0.0", "[::1]", "LOCALHOST"])
    assert.ok(net.loopback(h), h);
  for (const h of ["127.0.0.1.example.com", "10.0.0.1", "[::2]", "localhost.example"]) assert.ok(!net.loopback(h), h);
});

test("pinnedGet: redirects followed by hand, each hop checked; the address each connection uses is checked too", async () => {
  const { createServer } = await import("node:http");
  const srv = createServer((req, res) => {
    if (req.url === "/old") return res.writeHead(301, { Location: "/new" }).end();
    if (req.url === "/to-private") return res.writeHead(302, { Location: "http://10.0.0.1/admin" }).end();
    if (req.url === "/loop") return res.writeHead(302, { Location: "/loop" }).end();
    res.writeHead(200, { "content-type": "text/plain" }).end("hello " + req.method);
  });
  await new Promise(ok => srv.listen(0, "127.0.0.1", () => ok(null)));
  const base = `http://127.0.0.1:${/** @type {any} */ (srv.address()).port}`,
    allow = async u => new URL(u).hostname === "127.0.0.1";
  const body = async (r, u) => {
    let t = "";
    for await (const c of r) t += c;
    return { status: r.statusCode, url: u, t };
  };
  try {
    assert.deepEqual(await net.pinnedGet(base + "/old", { allow, read: body }), {
      status: 200,
      url: base + "/new",
      t: "hello GET",
    });
    assert.deepEqual(
      await net.pinnedGet(base + "/old", { allow, method: "HEAD" }),
      { status: 200 },
      "by default only the status is read",
    );
    assert.match(
      (await net.pinnedGet(base + "/to-private", { allow })).reason,
      /redirects to http:\/\/10\.0\.0\.1\/admin, which isn't a public web address/,
    );
    assert.match((await net.pinnedGet(base + "/loop", { allow, hops: 2 })).reason, /redirects more than 2 times/);
    assert.match((await net.pinnedGet("http://10.0.0.2/")).reason, /^it isn't a public web address/);
    // A public-looking name whose DNS answer is private isn't connected to (DNS rebinding).
    const dns = (name, opts, cb) =>
      opts.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4);
    const port = new URL(base).port;
    assert.match(
      (await net.pinnedGet(`http://rebind.example:${port}/`, { dns })).reason,
      /rebind\.example points at a private or local address \(127\.0\.0\.1\)/,
    );
  } finally {
    srv.close();
  }
});

test("writePrivate: an atomic write only this user can read, in a folder whose path has a space; locked says whether that held", async () => {
  const { mkdtempSync, readdirSync, readFileSync, statSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = join(mkdtempSync(join(tmpdir(), "seo tools ")), "Sam Lee", ".seo-supervisor"),
    file = join(dir, "google.json");
  const r = writePrivate(file, '{"a":1}');
  assert.equal(readFileSync(file, "utf8"), '{"a":1}');
  assert.deepEqual(readdirSync(dir), ["google.json"], "no temporary file is left behind");
  assert.equal(writePrivate(file, "second").locked, r.locked, "an existing file is replaced the same way");
  assert.equal(readFileSync(file, "utf8"), "second");
  if (process.platform === "win32") {
    // icacls ships with Windows: inherited entries (BUILTIN\Users and the like) are removed and only this user is left.
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32", "icacls.exe"), [file], {
      encoding: "utf8",
    });
    const acl = out.slice(out.lastIndexOf("google.json") + 11).split("Successfully")[0]; // the entries, without the path
    assert.equal(r.locked, true);
    assert.doesNotMatch(acl, /\(I\)|Users|Everyone/);
    assert.match(acl, new RegExp(`${process.env.USERNAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\(F\\)`));
  } else assert.equal(r.locked, (statSync(file).mode & 0o077) === 0);
  assert.match(privacyOf({ locked: true }), /only your user account can read it/);
  assert.doesNotMatch(privacyOf({ locked: false }), /only your user account/);
});

test("redact hides URL logins, token fragments, more key formats and Slack webhooks; and home folders whose name has a space", () => {
  const cases = [
    ["https://ann:s3cret@example.com/x", "https://[hidden]@example.com/x"],
    ["ftp://deploy@files.example.com/", "ftp://[hidden]@files.example.com/"],
    [
      "https://app.example.com/cb#access_token=ya.b-c&state=1",
      "https://app.example.com/cb#access_token=[hidden]&state=1",
    ],
    ["key sk-proj-abcdefghijklmnopqrstuvwxyz0123 used", "key [hidden] used"],
    ["key sk-abcdefghijklmnopqrstuvwxyz01 used", "key [hidden] used"],
    ["pplx-1234567890abcdef", "[hidden]"],
    ["phx_abcdefghijklmnopqrstuvwxyz", "[hidden]"],
    ["sk_live_51HabcdefghijKLMNOPqrst and rk_live_51HabcdefghijKLMNOPqrst", "[hidden] and [hidden]"],
    [
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789 github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz_0123456789",
      "[hidden] [hidden]",
    ],
    [
      "xoxb-1111-2222-abcDEFghijKLmn and xoxe.xoxp-1-abcdefghijKLMNOPQRST and xapp-1-A0123-4567890-abcdef",
      "[hidden] and xoxe.[hidden] and [hidden]",
    ],
    ["AKIAIOSFODNN7EXAMPLE / ASIAIOSFODNN7EXAMPLE", "[hidden] / [hidden]"],
    [
      "posted to https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX",
      "posted to https://hooks.slack.com/[hidden]",
    ],
    ["Authorization: Basic dXNlcjpwYXNz", "Authorization: Basic [hidden]"],
  ];
  for (const [s, want] of cases) assert.equal(redact(s, { home: "/nobody" }), want, s);
  // Words that only look like the start of a key stay.
  for (const s of [
    "sk-sk and pplx-embed-v2",
    "sk-learn-style-classification-model",
    "xoxo-gossip",
    "the Basic plan",
    "a skill-based task",
    "user@example.com",
  ])
    assert.equal(hideSecrets(s), s);
  // The short form the secret-key check shows on purpose stays readable.
  assert.equal(
    hideSecrets("a Stripe live secret key (sk_live_51Hq…); a GitHub token (ghp_R8f2…); xoxb-1234…"),
    "a Stripe live secret key (sk_live_51Hq…); a GitHub token (ghp_R8f2…); xoxb-1234…",
  );
  // Another user's home folder, with a space in its name (the current user's own is matched whole).
  const other = { home: "C:\\Users\\Someone" };
  assert.equal(redact("open 'C:\\Users\\Sam Lee\\site\\a.json' failed", other), "open '~\\site\\a.json' failed");
  assert.equal(redact("/Users/Jane Q Doe/site/x and /home/bob/y", other), "~/site/x and ~/y");
  assert.equal(redact("C:\\Users\\Sam Lee\\x", { home: "C:\\Users\\Sam Lee" }), "~\\x");
  assert.equal(
    redact("see https://site.example/Users/Sam Lee/x", other),
    "see https://site.example/Users/Sam Lee/x",
    "a site's own /Users/ page isn't a home folder",
  );
});

test("bodyUpTo: the body up to the cap, or null past it", async () => {
  assert.equal(String(await bodyUpTo(new Response("0123456789"), 10)), "0123456789");
  assert.equal(await bodyUpTo(new Response("0123456789"), 9), null);
  assert.equal(String(await bodyUpTo(new Response(null), 9)), "");
});

// ---------- the scripts ----------
const S = "https://www.example.com",
  KEY = "0123456789abcdef0123456789abcdef";
const run = (script, args, opts = {}) =>
  node([join(SCRIPTS, script), ...args], { env: { ...process.env, SEO_SUPERVISOR_HOME: tmp(), ...opts.env }, ...opts });
// Exit 2 with a plain message: no stack trace.
const plain =
  (re, code = 2) =>
  e => {
    assert.equal(e.code, code, e.stderr);
    assert.match(e.stderr, re);
    assert.doesNotMatch(e.stderr, /\n\s+at |node:internal/);
    return true;
  };

test("a stray word is never read as --yes: every script stops with a plain message instead", async () => {
  const dir = tmp(),
    f = join(dir, "list.txt");
  writeFileSync(f, "https://other.example/page\n");
  const cases = {
    "rdap.mjs": ["--site", S, "yes"],
    "indexnow.mjs": ["submit", "--site", S, "--key", KEY, "--urls", f, "yes"],
    "google-updates.mjs": ["--since", "2026-01-01", "yes"],
    "images.mjs": ["--crawl", f, "--root", dir, "yes"],
    "gsc-import.mjs": ["--pages", f, "yes"],
    "log-scan.mjs": ["--log", f, "yes"],
    "backlinks.mjs": ["--site", S, "--urls", f, "yes"],
    "commoncrawl.mjs": ["--site", S, "--urls", f, "yes"],
    "links-import.mjs": ["--dir", dir, "--site", S, "yes"],
    "disavow.mjs": ["--site", S, "--domains", "spam.example", "--out", join(dir, "d.txt"), "yes"],
    "osm.mjs": ["--type", "plumber", "--near", "53.79,-1.54", "yes"],
    "keyword-ideas.mjs": ["--gsc", f, "yes"],
    "ai-answers.mjs": ["--site", S, "--questions", f, "yes"],
    "geo-grid.mjs": ["--place-id", "ChIJN1t_tDeuEmsRUsoyG83frY4", "--keywords", "plumber", "yes"],
    "issues.mjs": ["--audit", f, "yes"],
    "content-scan.mjs": ["--in", f, "yes"],
  };
  for (const [script, args] of Object.entries(cases))
    await assert.rejects(run(script, args), plain(/unexpected "yes": options start with --, like --yes/), script);
});

test("a misspelt option stops the script; the other name of a flag works (--rivals and --competitors, --site and --site-origin)", async () => {
  await assert.rejects(
    run("rdap.mjs", ["--site", S, "--competitor", "rival.example"]),
    plain(/unknown option --competitor/),
  );
  assert.match(
    (await run("rdap.mjs", ["--site", S, "--rivals", "rival.example"])).stdout,
    /\(example\.com, rival\.example\)/,
  );
  const dir = tmp(),
    q = join(dir, "q.txt");
  writeFileSync(q, "best plumber?\n");
  assert.match(
    (await run("ai-answers.mjs", ["--site", S, "--questions", q, "--competitors", "not a domain"])).stdout,
    /Skipped rival "not a domain"/,
  );
  const pages = join(dir, "Pages.csv"),
    out = join(dir, "gsc.json");
  writeFileSync(
    pages,
    "Top pages,Clicks,Impressions,CTR,Position\nhttps://www.example.com/a,1,10,10%,3\nhttps://other.example/b,2,20,10%,4\n",
  );
  await run("gsc-import.mjs", ["--pages", pages, "--site", S, "--out", out]);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(out, "utf8")).traffic), ["/a"]);
  await assert.rejects(
    run("log-scan.mjs", ["--log", pages, "--site", "not a url"]),
    plain(/must be a URL like https:\/\/www\.example\.com/),
  );
});

test("a missing or bad input file is one plain line and exit 2, not a stack trace", async () => {
  const dir = tmp(),
    nope = join(dir, "nope.csv");
  await assert.rejects(run("gsc-import.mjs", ["--pages", nope]), plain(/can't open .*nope\.csv \(it isn't there\)/));
  await assert.rejects(
    run("gsc-import.mjs", ["--pages", nope, "--site-origin", "not a url"]),
    plain(/--site-origin must be/),
  );
  await assert.rejects(run("content-scan.mjs", ["--in", nope]), plain(/can't open .*nope\.csv/));
  await assert.rejects(run("content-scan.mjs", ["--md", join(dir, "missing")]), plain(/can't open .*missing/));
  const c = join(dir, "c.json");
  writeFileSync(c, JSON.stringify([{ title: "a" }]));
  await assert.rejects(
    run("content-scan.mjs", ["--in", c, "--banned", "(", "--out", join(dir, "o.json")]),
    plain(/--banned isn't a valid regular expression/),
  );
  writeFileSync(join(dir, "bad.json"), "{");
  await assert.rejects(run("content-scan.mjs", ["--in", join(dir, "bad.json")]), plain(/bad\.json isn't JSON/));
});

test("backlinks and commoncrawl print the proxy note before they contact anything, and not in a dry run", async () => {
  const dir = tmp(),
    f = join(dir, "links.txt"),
    env = {
      HTTPS_PROXY: "http://proxy.corp:8080",
      NODE_USE_ENV_PROXY: "",
      SEO_CC_COLLINFO: "http://127.0.0.1:9/collinfo.json",
    };
  writeFileSync(f, "http://10.0.0.1/page\n"); // a private address: refused before any connection
  for (const script of ["backlinks.mjs", "commoncrawl.mjs"]) {
    const args = ["--site", S, "--urls", f, "--out", join(dir, script + ".json")];
    assert.doesNotMatch((await run(script, args, { env })).stderr, /A proxy is set/, script + " dry run");
    assert.equal((await run(script, [...args, "--yes"], { env })).stderr.match(/A proxy is set/g)?.length, 1, script);
  }
});

// A javascript:, data: or protocol-relative address must come out as plain text wherever a URL could become a link.
const HOSTILE = [
  "[click](javascript:alert(1))",
  "![x](data:text/html;base64,PHNjcmlwdD4=)",
  '<a href="//evil.example/x">here</a>',
  "[y](//evil.example/y)",
  "<img src=x onerror=alert(1)>",
];

test("issues: finding text is escaped for GitHub, so crawled text can't make a link, an image or a tag", async () => {
  const { issueOf } = await import("../skills/seo-supervisor/scripts/issues.mjs");
  const f = {
    id: "F-001",
    title: "T",
    severity: "low",
    what: `Found on \`https://a.example/p\` (${HOSTILE[0]}).`,
    why: HOSTILE[1] + " " + HOSTILE[2],
    fix: HOSTILE[3] + " then https://docs.example/fix_it",
    evidence: [{ url: "https://a.example/p", detail: HOSTILE[4] }],
  };
  const { body } = issueOf(f, S);
  assert.doesNotMatch(body, /(^|[^\\])\]\(|(^|[^\\])<(a|img)\b/m, "no Markdown link or image, no HTML tag");
  assert.match(
    body,
    /Found on `https:\/\/a\.example\/p` \(\\\[click\\\]\(javascript:alert\(1\)\)\)\./,
    "code spans stay; the rest is escaped",
  );
  assert.match(body, /`https:\/\/docs\.example\/fix_it`/, "a web address becomes a code span");
  assert.match(body, /\\<img src=x onerror=alert\(1\)\\>/);
});

test("issues: it says how many won't-fix findings it skipped, since the report counts them as open", async () => {
  const dir = tmp(),
    file = join(dir, "seo-audit.json");
  const f = {
    id: "F-001",
    title: "Open one",
    severity: "low",
    rule: "META-01",
    check: "x",
    what: "w",
    why: "y",
    fix: "z",
    status: "open",
  };
  writeFileSync(
    file,
    JSON.stringify({
      site: { url: S },
      findings: [
        f,
        { ...f, id: "F-002", status: "wont-fix" },
        { ...f, id: "F-003", status: "wont-fix" },
        { ...f, id: "F-004", status: "fixed" },
      ],
    }),
  );
  const { stdout } = await run("issues.mjs", ["--audit", file]);
  assert.match(stdout, /2 findings marked won't fix aren't filed/);
  await assert.rejects(
    run("issues.mjs", ["--audit", join(dir, "nope.json")]),
    plain(/issues: .*nope\.json doesn't exist/),
  );
  writeFileSync(join(dir, "bad.json"), "{");
  await assert.rejects(run("issues.mjs", ["--audit", join(dir, "bad.json")]), plain(/bad\.json isn't JSON/));
});

test("report-plan: a draft link is made only for a web address or a path; anything else is shown as text", async () => {
  const { planHtml } = await import("../skills/seo-supervisor/scripts/report-plan.mjs");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`),
    helpers = { esc, inl: esc, num: String };
  const html = draft =>
    planHtml(
      {
        status: "approved",
        pages: [{ url: "/a/", status: "to-build", owner: { needs: "copy", what: "Approve", draft } }],
      },
      helpers,
    );
  for (const bad of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example/x",
    "/\\evil.example/x",
    "\\\\evil\\share",
    "vbscript:x",
    "file:///etc/passwd",
  ]) {
    const h = html(bad);
    assert.doesNotMatch(h, /<a href="(?!#)/, JSON.stringify(bad));
    assert.match(h, /Draft:/, JSON.stringify(bad));
  }
  for (const good of ["drafts/privacy.md", "https://docs.example.com/d?x=1"])
    assert.match(html(good), new RegExp(`<a href="${good.replace(/[.?]/g, "\\$&")}">Read the draft</a>`));
});

test("the installer's --help lists deploy-check, issues and --agents", async () => {
  const { ROOT } = await import("./helpers.mjs");
  const { stdout } = await node([join(ROOT, "bin", "seo-supervisor.mjs"), "--help"]);
  assert.match(stdout, /^\s+--agents\s+\S/m);
  assert.match(stdout, /npx seo-supervisor deploy-check --site/);
  assert.match(stdout, /npx seo-supervisor issues --audit/);
});

test("update-check off|on with a bad SEO_SUPERVISOR_HOME is a plain message; the weekly check itself stays silent", async () => {
  await assert.rejects(
    run("update-check.mjs", ["off"], { env: { SEO_SUPERVISOR_HOME: "relative/folder" } }),
    plain(/SEO_SUPERVISOR_HOME must be a full path/),
  );
  const quiet = await run("update-check.mjs", [], {
    env: { SEO_SUPERVISOR_HOME: "relative/folder", SEO_SUPERVISOR_REGISTRY: "http://127.0.0.1:9" },
  });
  assert.equal(quiet.stdout + quiet.stderr, "");
});

test("indexnow: importing it runs nothing; a gzipped sitemap is unpacked to 50 MB at most; a sitemap index's children stay public", async t => {
  const was = process.exitCode,
    said = [];
  t.mock.method(console, "error", s => said.push(s));
  t.mock.method(console, "log", s => said.push(s));
  await import("../skills/seo-supervisor/scripts/indexnow.mjs");
  t.mock.restoreAll();
  assert.deepEqual([said, process.exitCode], [[], was], "no usage line, no proxy note, no exit code");

  const { gzipSync } = await import("node:zlib");
  const hold = { files: {} },
    srv = await serve(tmp(), hold),
    u = srv.url,
    dir = tmp();
  hold.files["/bomb.xml.gz"] = { type: "application/gzip", body: gzipSync(Buffer.alloc(51 * 1024 * 1024, 32)) };
  hold.files["/index.xml"] = {
    type: "application/xml",
    body: `<sitemapindex><sitemap><loc>http://10.0.0.1/s.xml</loc></sitemap><sitemap><loc>${u}/s1.xml</loc></sitemap></sitemapindex>`,
  };
  hold.files["/s1.xml"] = { type: "application/xml", body: `<urlset><url><loc>${u}/a/</loc></url></urlset>` };
  const submit = extra =>
    run("indexnow.mjs", ["submit", "--site", u, "--key", KEY, "--out", join(dir, "i.json"), ...extra]);
  try {
    await assert.rejects(
      submit(["--from-sitemap", u + "/bomb.xml.gz"]),
      plain(/bomb\.xml\.gz unpacks to more than 50 MB/),
    );
    // The offline guard would fail the run on any attempt to reach 10.0.0.1.
    const r = await submit(["--from-sitemap", u + "/index.xml"]);
    assert.match(
      r.stdout,
      /skipped the child sitemap http:\/\/10\.0\.0\.1\/s\.xml: it isn't on .* or a public web address/,
    );
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "i-dryrun.json"), "utf8")).urls, [u + "/a/"]);
  } finally {
    await srv.close();
  }
});

test("schema-check: a local URL's redirect is followed only to another local address unless --allow-remote", async () => {
  const page = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"A","url":"https://a.example/"}</script>`;
  const hold = { files: { "/ok.html": { type: "text/html", body: page } } },
    srv = await serve(tmp(), {
      ...hold,
      before(req, res) {
        if (req.url === "/away") {
          res.writeHead(302, { Location: "http://outside.example/x.html" }).end();
          return true;
        }
        if (req.url === "/here") {
          res.writeHead(301, { Location: "/ok.html" }).end();
          return true;
        }
        return false;
      },
    });
  try {
    const away = await run("schema-check.mjs", [srv.url + "/away"]).catch(e => e);
    assert.equal(away.code, 1);
    assert.match(away.stdout, /redirects to http:\/\/outside\.example\/x\.html, which isn't on this machine/);
    const here = await run("schema-check.mjs", [srv.url + "/here"]);
    assert.match(here.stdout, /1 item, 0 errors/);
  } finally {
    await srv.close();
  }
});
