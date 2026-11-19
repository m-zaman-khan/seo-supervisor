import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ROOT, SCRIPTS, node, tmp } from "./helpers.mjs";

const L = join(ROOT, "test", "fixtures", "logs");
const FIXTURES = ["access.log", "common.log", "app.jsonl"].flatMap(f => ["--log", join(L, f)]);
async function scan(logArgs = FIXTURES, extra = []) {
  const out = join(tmp(), "log-scan.json");
  await node([join(SCRIPTS, "log-scan.mjs"), ...logArgs, "--out", out, ...extra]);
  return JSON.parse(readFileSync(out, "utf8"));
}
const byCheck = (r, check) => r.findings.find(f => f.check === check);
// One line in the combined log format.
const line = (ua, path, status, i = 0) =>
  `198.51.100.1 - - [12/Nov/2026:10:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")} +0000] "GET ${path} HTTP/1.1" ${status} 100 "-" "${ua}"`;
const UA = {
  google: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  bing: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  pplx: "Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
};

test("combined, common and JSON-lines logs parse, and bots are classified by user agent", async () => {
  const r = await scan();
  assert.equal(r.source, "server-logs");
  assert.equal(r.stats.lines, 45);
  assert.equal(r.stats.unparsed, 2, "one junk line and one broken JSON line");
  const g = r.bots.Googlebot;
  assert.equal(g.group, "search");
  assert.ok(g.purpose && g.vendor === "Google");
  assert.equal(g.requests, 10, "desktop, smartphone and vhost-prefixed lines all count");
  assert.equal(g.paths, 4);
  assert.deepEqual(g.status, { "2xx": 3, "3xx": 0, "4xx": 6, "5xx": 1 });
  assert.deepEqual(g.topPaths[0], { path: "/old-page/", requests: 6 });
  assert.equal(g.firstSeen, "2026-10-03T08:00:00.000Z");
  assert.equal(g.lastSeen, "2026-11-14T04:30:00.000Z", "the log's time zone offset is applied");
  assert.equal(r.bots.Bingbot.requests, 5, "matching ignores case (bingbot)");
  assert.equal(r.bots["OAI-SearchBot"].group, "ai-search");
  assert.equal(r.bots.GPTBot.group, "ai-training");
  assert.equal(r.bots["Claude-SearchBot"].requests, 1, "JSON line with a path field");
  assert.deepEqual(
    r.bots["Claude-User"].topPaths,
    [{ path: "/docs/setup?x=1", requests: 1 }],
    "JSON line with an absolute url field and a string status",
  );
  assert.equal(r.bots["ChatGPT-User"].firstSeen, "2026-11-13T09:00:00.000Z", "JSON time in access-log format");
  assert.equal(r.bots.ClaudeBot, undefined, "bots that never visited are left out");
  assert.ok(
    r.notes.some(n => /claiming to be/i.test(n) && /spoof/i.test(n)),
    "counts are stated as claims, since user agents can be spoofed",
  );
});

test("gzip files and whole directories read like plain logs", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "access.log.1.gz"), gzipSync(readFileSync(join(L, "access.log"))));
  copyFileSync(join(L, "common.log"), join(dir, "access.log"));
  const r = await scan(["--log", dir]);
  assert.equal(r.stats.files, 2);
  assert.equal(r.stats.lines, 39);
  assert.equal(r.bots.Googlebot.requests, 10);
});

test("visits referred by AI assistants are counted per source, with their landing pages", async () => {
  const r = await scan();
  assert.deepEqual(
    r.aiReferrals["chatgpt.com"],
    { visits: 3, topPages: [{ path: "/pricing/", visits: 3 }] },
    "two chatgpt.com referrers and one utm_source=chatgpt.com",
  );
  assert.equal(r.aiReferrals["perplexity.ai"].visits, 1, "www.perplexity.ai counts as perplexity.ai");
  assert.equal(r.aiReferrals["claude.ai"].visits, 1);
  assert.equal(r.aiReferrals["gemini.google.com"].visits, 1, "Cloudflare-style JSON fields");
  assert.deepEqual(
    Object.keys(r.aiReferrals).sort(),
    ["chatgpt.com", "claude.ai", "gemini.google.com", "perplexity.ai"],
    "a google.com referrer isn't an AI referral",
  );
});

test("crawler errors, repeated 404s and AI search bots blocked by the server become findings", async () => {
  const dir = tmp(),
    crawl = join(dir, "seo-crawl.json"),
    errLog = join(dir, "errors.log");
  writeFileSync(
    crawl,
    JSON.stringify({
      pages: [{ url: "http://localhost:3000/", status: 200 }],
      errors: [{ url: "http://localhost:3000/old-page/", status: 404 }],
    }),
  );
  writeFileSync(
    errLog,
    Array.from({ length: 100 }, (_, i) =>
      line(UA.google, i < 6 ? "/search-page/" : `/p${i}/`, i < 6 ? 500 : 200, i),
    ).join("\n") + "\n",
  );
  const r = await scan([...FIXTURES, "--log", errLog], ["--site-origin", "https://www.example.com", "--crawl", crawl]);
  for (const f of r.findings) {
    for (const k of [
      "check",
      "rule",
      "severity",
      "category",
      "title",
      "what",
      "why",
      "fix",
      "count",
      "evidence",
      "status",
      "id",
    ])
      assert.ok(f[k] !== undefined, `${f.check} has ${k}`);
    assert.equal(f.source, "server-logs");
    assert.ok(
      f.evidence.every(e => e.url.startsWith("https://www.example.com/") && e.detail),
      "evidence URLs use the site origin",
    );
  }
  const err = byCheck(r, "bot-errors");
  assert.equal(err.rule, "CRAWL-05");
  assert.equal(err.severity, "high");
  assert.equal(err.count, 1);
  assert.equal(err.evidence[0].url, "https://www.example.com/search-page/");
  assert.match(err.evidence[0].detail, /Googlebot.*7 of 110/);
  const nf = byCheck(r, "bot-404s");
  assert.equal(nf.rule, "CRAWL-07");
  assert.equal(nf.severity, "medium");
  assert.deepEqual(
    nf.evidence.map(e => e.url),
    ["https://www.example.com/old-page/"],
  );
  const blocked = byCheck(r, "ai-bots-blocked-in-practice");
  assert.equal(blocked.rule, "MAP-06");
  assert.equal(blocked.severity, "needs-decision");
  assert.equal(blocked.status, "needs-decision");
  assert.deepEqual(
    blocked.evidence.map(e => e.detail.split(":")[0]),
    ["OAI-SearchBot"],
    "GPTBot is a training crawler, so blocking it is a policy, not a finding",
  );
  assert.match(blocked.why, /robots\.txt/);
});

test("below the thresholds there are no findings, and no AI search visits is a note, not a finding", async () => {
  const dir = tmp(),
    lines = [];
  for (let i = 0; i < 200; i++) lines.push(line(UA.google, i ? `/p${i}/` : "/broken/", i ? 200 : 503, i)); // 0.5% 5xx
  for (let i = 0; i < 4; i++) lines.push(line(UA.bing, "/gone/", 500, i), line(UA.google, "/old/", 404, i)); // 4 requests, 4 hits
  writeFileSync(join(dir, "a.log"), lines.join("\n") + "\n");
  const r = await scan(["--log", join(dir, "a.log")]);
  assert.deepEqual(r.findings, []);
  assert.ok(r.notes.some(n => /no requests claiming to be an AI search/i.test(n)));

  const half = Array.from({ length: 10 }, (_, i) => line(UA.pplx, `/q${i}/`, i % 2 ? 403 : 200, i));
  writeFileSync(join(dir, "b.log"), half.join("\n") + "\n");
  const b = await scan(["--log", join(dir, "b.log")]);
  assert.equal(byCheck(b, "ai-bots-blocked-in-practice"), undefined, "half blocked isn't mostly blocked");
  assert.ok(!b.notes.some(n => /no requests claiming to be an AI search/i.test(n)));
});

const logFile = (dir, name, lines) => {
  const f = join(dir, name);
  writeFileSync(f, lines.join("\n") + "\n");
  return f;
};
const scanLines = (lines, extra) => scan(["--log", logFile(tmp(), "a.log", lines)], extra);
// `total` requests from one bot, the first `errors` of them answered with `status`.
const hits = (ua, total, errors, status = 500) =>
  Array.from({ length: total }, (_, i) => line(ua, `/p${i % 50}/`, i < errors ? status : 200, i));
UA.chatgpt =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot";

test("bot-errors needs 5 server errors and 1% of the bot's requests, and is high only from 5% or 50 errors", async () => {
  assert.equal(
    byCheck(await scanLines(hits(UA.google, 10, 1)), "bot-errors"),
    undefined,
    "one 5xx in 10 requests isn't a pattern",
  );
  assert.equal(
    byCheck(await scanLines(hits(UA.google, 100, 4)), "bot-errors"),
    undefined,
    "4 errors is too few, even at 4%",
  );
  assert.equal(
    byCheck(await scanLines(hits(UA.google, 1000, 9)), "bot-errors"),
    undefined,
    "9 errors in 1,000 is under 1%",
  );
  const medium = byCheck(await scanLines(hits(UA.google, 200, 5)), "bot-errors");
  assert.equal(medium.severity, "medium", "5 errors, 2.5%");
  assert.match(medium.fix, /503 with a Retry-After/, "planned maintenance is fine");
  assert.equal(byCheck(await scanLines(hits(UA.google, 100, 5)), "bot-errors").severity, "high", "5%");
  assert.equal(byCheck(await scanLines(hits(UA.google, 4000, 50)), "bot-errors").severity, "high", "50 errors, 1.25%");
});

test("bot-errors names search crawlers and AI answer bots separately", async () => {
  const ai = byCheck(await scanLines(hits(UA.chatgpt, 200, 5)), "bot-errors");
  assert.doesNotMatch(ai.title, /search crawler/, "ChatGPT-User isn't a search crawler");
  assert.match(ai.title, /^1 AI search or answer bot\(s\) got server errors/);
  const both = byCheck(
    await scanLines([...hits(UA.google, 200, 5), ...hits(UA.bing, 200, 5), ...hits(UA.chatgpt, 200, 5, 503)]),
    "bot-errors",
  );
  assert.match(both.title, /^2 search crawler\(s\) and 1 AI search or answer bot\(s\) got server errors/);
  assert.equal(both.count, 3);
});

test("repeated 404s are a list and a note; with --crawl, the ones the site links to become a finding; probe paths are left out", async () => {
  const dir = tmp(),
    lines = [];
  for (const p of [
    "/old-page/",
    "/linked-gone/",
    "/.env",
    "/.env.local",
    "/wp-login.php",
    "/wp-admin/",
    "/xmlrpc.php",
    "/.git/config",
  ])
    for (let i = 0; i < 6; i++) lines.push(line(UA.google, p, 404, i));
  const log = logFile(dir, "a.log", lines);
  const plain = await scan(["--log", log]);
  assert.equal(byCheck(plain, "bot-404s"), undefined, "without --crawl a 404 may be the right answer");
  assert.deepEqual(
    plain.repeated404s.map(x => x.path).sort(),
    ["/linked-gone/", "/old-page/"],
    "probe paths aren't listed",
  );
  assert.deepEqual(
    plain.repeated404s.find(x => x.path === "/old-page/"),
    { path: "/old-page/", requests: 6, bots: ["Googlebot"] },
  );
  assert.ok(plain.notes.some(n => /pass --crawl/.test(n) && /linked from the site/.test(n)));

  const crawl = join(dir, "seo-crawl.json");
  writeFileSync(
    crawl,
    JSON.stringify({
      pages: [{ url: "http://localhost:3000/", status: 200 }],
      errors: [{ url: "http://localhost:3000/linked-gone/", status: 404 }],
    }),
  );
  const r = await scan(["--log", log], ["--crawl", crawl]);
  const nf = byCheck(r, "bot-404s");
  assert.equal(nf.rule, "CRAWL-07");
  assert.deepEqual(
    nf.evidence.map(e => e.url),
    ["/linked-gone/"],
  );
  assert.deepEqual(
    r.repeated404s.map(x => x.path),
    ["/old-page/"],
    "the unlinked one stays informational",
  );
  assert.ok(!r.notes.some(n => /pass --crawl/.test(n)));

  writeFileSync(join(dir, "bad.json"), "{nope");
  await assert.rejects(
    scan(["--log", log], ["--crawl", join(dir, "bad.json")]),
    e => e.code === 2 && /seo-crawl\.json/.test(e.stderr),
  );
});

test("logs without user agents say so instead of reporting no AI search visits", async () => {
  const r = await scan(["--log", join(L, "common.log")]);
  assert.ok(r.notes.some(n => /don't record user agents, so bots can't be told apart/.test(n)));
  assert.ok(!r.notes.some(n => /no requests claiming to be an AI search/i.test(n)));
});

test("AI referrals count only 2xx responses, so a redirect hop isn't a second visit", async () => {
  const ref = (path, status) =>
    `203.0.113.5 - - [12/Nov/2026:15:00:00 +0000] "GET ${path} HTTP/1.1" ${status} 0 "https://chatgpt.com/" "Mozilla/5.0 Chrome/141.0.0.0"`;
  const r = await scanLines([ref("/pricing", 301), ref("/pricing/", 200), ref("/missing/", 404)]);
  assert.deepEqual(r.aiReferrals["chatgpt.com"], { visits: 1, topPages: [{ path: "/pricing/", visits: 1 }] });
});

test("a corrupt .gz in a folder is a note and the scan goes on; on its own it fails", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "old.log.gz"), "not gzip at all");
  copyFileSync(join(L, "access.log"), join(dir, "access.log"));
  const r = await scan(["--log", dir]);
  assert.equal(r.bots.Googlebot.requests, 10);
  assert.ok(r.notes.some(n => /old\.log\.gz/.test(n)));
  await assert.rejects(scan(["--log", join(dir, "old.log.gz")]), e => e.code === 2 && /old\.log\.gz/.test(e.stderr));
});

test("--since drops older lines", async () => {
  const r = await scan(FIXTURES, ["--since", "2026-11-01"]);
  assert.equal(r.bots.Googlebot.requests, 9);
  assert.equal(r.stats.beforeSince, 1);
  assert.equal(r.since, "2026-11-01");
});

test("with --since, lines without a readable time are left out and counted", async () => {
  const lines = [line(UA.google, "/a/", 200), JSON.stringify({ path: "/b/", status: 200, ua: UA.google })];
  assert.equal((await scanLines(lines)).bots.Googlebot.requests, 2);
  const r = await scanLines(lines, ["--since", "2026-11-01"]);
  assert.equal(r.bots.Googlebot.requests, 1);
  assert.equal(r.stats.undated, 1);
});

test("bad input fails with a clear message and exit code 2", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "notes.txt"), "hello\nworld\n");
  await assert.rejects(
    scan(["--log", join(dir, "notes.txt")]),
    e => e.code === 2 && /isn't an access log/.test(e.stderr),
  );
  await assert.rejects(scan(["--log", join(dir, "missing.log")]), e => e.code === 2 && /missing\.log/.test(e.stderr));
  await assert.rejects(scan([]), e => e.code === 2 && /usage/.test(e.stderr));
  await assert.rejects(scan(FIXTURES, ["--since", "last week"]), e => e.code === 2 && /YYYY-MM-DD/.test(e.stderr));
});
