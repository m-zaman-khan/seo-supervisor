import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "./serve.mjs";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import { fetchGoogle } from "../skills/seo-supervisor/scripts/google.mjs";

// ---------- google.mjs: new searches this period ----------
// One local server plays Google (as in google.test.mjs): "METHOD /path" -> hit => [status, json].
async function fakeGoogle(routes) {
  const hits = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => {
      raw += c;
    });
    req.on("end", () => {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname),
        body = /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw) : {};
      hits.push({ method: req.method, path, body });
      const route = routes[`${req.method} ${path}`],
        [status, json] = route ? route({ body }) : [404, { error: { code: 404, message: "no such fake route" } }];
      res.writeHead(status, { "content-type": "application/json", connection: "close" }).end(JSON.stringify(json));
    });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    hits,
    endpoints: { token: base + "/token", searchConsole: base + "/webmasters/v3", inspection: base + "/v1" },
    close: () =>
      new Promise(c => {
        server.closeAllConnections();
        server.close(c);
      }),
  };
}
const SC = "https://www.googleapis.com/auth/webmasters.readonly",
  SITE = "/webmasters/v3/sites/sc-domain:example.com";
const signedIn = () => {
  const home = tmp();
  mkdirSync(join(home, ".seo-supervisor"), { recursive: true });
  writeFileSync(
    join(home, ".seo-supervisor", "google.json"),
    JSON.stringify({
      method: "own-client",
      client: { id: "id", secret: "s" },
      access_token: "fresh",
      refresh_token: "r",
      expires_at: Date.now() + 3600e3,
      scope: SC,
    }),
  );
  return home;
};
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const isBefore = body => body.endDate < daysAgo(10);
const Q = (query, clicks, impressions, position = 5) => ({
  keys: [query],
  clicks,
  impressions,
  ctr: clicks / impressions,
  position,
});
const NOW = [
  Q("boiler repair", 9, 500),
  Q("radiator fix", 1, 300),
  Q("new boiler cost", 2, 900),
  Q("combi boiler leeds", 0, 40),
];
const BEFORE = [Q("boiler repair", 12, 600), Q("radiator fix", 0, 5)];
function google(now = NOW, before = BEFORE) {
  return fakeGoogle({
    "POST /token": () => [200, { access_token: "fresh", expires_in: 3599 }],
    "GET /webmasters/v3/sites": () => [
      200,
      { siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] },
    ],
    [`POST ${SITE}/searchAnalytics/query`]: ({ body }) => {
      const rows = body.type === "web" && body.dimensions.join() === "query" ? (isBefore(body) ? before : now) : [];
      return [200, { rows: rows.slice(body.startRow || 0, (body.startRow || 0) + (body.rowLimit || 1000)) }];
    },
    [`GET ${SITE}/sitemaps`]: () => [200, {}],
    "POST /v1/urlInspection/index:inspect": () => [200, { inspectionResult: {} }],
  });
}
const fetchWith = (g, extra = {}) =>
  fetchGoogle({
    site: "https://www.example.com",
    days: 90,
    home: signedIn(),
    endpoints: g.endpoints,
    pageSize: 2,
    ...extra,
  });

test("new searches: this period's queries the period before had no row for, most impressions first, same-length period, paged", async () => {
  const g = await google();
  try {
    const r = await fetchWith(g);
    assert.deepEqual(r.newQueries, [
      { query: "new boiler cost", clicks: 2, impressions: 900, ctr: 0.0022, position: 5 },
      { query: "combi boiler leeds", clicks: 0, impressions: 40, ctr: 0, position: 5 },
    ]);
    const asked = g.hits.filter(h => h.body.dimensions?.join() === "query" && isBefore(h.body));
    assert.deepEqual(
      asked.map(h => h.body.startRow),
      [0, 2],
      "paged with startRow, like the other reads",
    );
    const d = s => Date.parse(s) / 864e5,
      cur = g.hits.find(h => h.body.dimensions?.join() === "query" && !isBefore(h.body)).body,
      prev = asked[0].body;
    assert.equal(d(cur.startDate) - d(prev.endDate), 1, "the period before ends the day before this one starts");
    assert.equal(d(prev.endDate) - d(prev.startDate), d(cur.endDate) - d(cur.startDate), "same length");
    assert.ok(Object.keys(r).indexOf("newQueries") === Object.keys(r).indexOf("trafficChange") + 1);
  } finally {
    await g.close();
  }
});

test("new searches: our own limit of 50; none past Search Console's 16 months; a note when the period before was cut at 25,000 rows", async () => {
  const many = Array.from({ length: 60 }, (_, i) => Q("query " + i, 0, 100 + i));
  const g = await google(many, []);
  try {
    const r = await fetchWith(g, { pageSize: 25000 });
    assert.equal(r.newQueries.length, 50);
    assert.equal(r.newQueries[0].query, "query 59", "most impressions first");
    const long = await fetchWith(g, { days: 300 });
    assert.equal(long.newQueries, null);
    assert.ok(
      long.notes.some(n => /16 months/.test(n) && /new searches/.test(n)),
      long.notes.join("\n"),
    );
  } finally {
    await g.close();
  }
  const full = Array.from({ length: 25000 }, (_, i) => Q("old " + i, 0, 1));
  const g2 = await google([...NOW, Q("brand new", 0, 7)], full);
  try {
    const r = await fetchWith(g2, { pageSize: 25000 });
    assert.ok(r.newQueries.some(q => q.query === "brand new"));
    assert.ok(
      r.notes.some(n => /25,000/.test(n) && /new searches/.test(n) && /before/.test(n)),
      r.notes.join("\n"),
    );
  } finally {
    await g2.close();
  }
});

const render = async extra => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  writeFileSync(join(dir, "a.json"), JSON.stringify({ ...data, ...extra }));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};

test("the report lists the new searches as information, escaped, and nothing when there are none", async () => {
  const newQueries = [
    { query: "new boiler cost", clicks: 2, impressions: 900 },
    { query: "boiler <b>*deals*</b>", clicks: 0, impressions: 1200 },
    { query: 5, impressions: 3 },
  ];
  const { html, md } = await render({ newQueries });
  assert.ok(
    html.includes("new boiler cost (900 impressions) · boiler &lt;b&gt;*deals*&lt;/b&gt; (1,200 impressions)"),
    "HTML, escaped, in the order given",
  );
  assert.ok(
    md.includes("new boiler cost (900 impressions) · boiler \\<b\\>\\*deals\\*\\</b\\> (1,200 impressions)"),
    "Markdown, escaped",
  );
  for (const s of [html, md]) assert.match(s, /no impressions in the period before/);
  const plain = await render({}),
    score = h => h.match(/<span class="n">(\d+)<\/span>/)[1];
  assert.equal(score(html), score(plain.html), "the score doesn't change");
  const none = await render({ newQueries: [] });
  assert.doesNotMatch(none.html + none.md, /New searches/);
});

// ---------- seo-crawl.mjs: the Markdown version says the same as the page ----------
const ORIGIN = "https://site.example";
// 50+ distinct words of main text, so the page is long enough to compare.
const COPY =
  "Our engineers repair boilers, radiators, thermostats and leaking pipes across Leeds, Bradford, Wakefield and Harrogate. Every visit starts with a written estimate, a careful safety inspection and honest advice about replacing worn parts. We carry common spares in each van, finish most jobs within a single morning, tidy away dust and packaging afterwards, and guarantee labour for twelve months. Landlords receive certificates by email; homeowners can book evenings, weekends or emergency callouts through our friendly office team.";
const OLD =
  "Spring offer: half price gutter cleaning, window washing, patio jet washing and garden fence painting for loyal customers. Call before Easter to claim the voucher, valid on Tuesdays only while stocks last.";
const page = (title, text = COPY) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="Boiler repairs in Leeds"></head><body><header><nav><a href="/">Home</a> <a href="/about/">About</a></nav></header><main><h1>${title}</h1><p>${text}</p></main><footer>Leeds Heating Ltd, registered in England</footer></body></html>`;
async function crawlSite(pages, serveOpts = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir, { headers: { "/": { Vary: "Accept" } }, ...serveOpts });
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--site-origin", ORIGIN, "--out", out]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const PAGES = { "/": page("Boiler repairs in Leeds"), "/about/": page("About our Leeds engineers") };

test("Markdown converted from the page (front matter, links, JSON-LD block) matches it, so AI-05 passes", async () => {
  const md = `---\ntitle: Boiler repairs in Leeds\ndescription: Boiler repairs in Leeds\nimage: https://site.example/og.png\n---\n\n# Boiler repairs in Leeds\n\n${COPY.replace("Leeds,", "[Leeds](https://site.example/leeds/),")}\n\n![A van outside a house](https://site.example/van.jpg)\n\n\`\`\`json\n{"@context":"https://schema.org","@type":"LocalBusiness","name":"Leeds Heating Ltd"}\n\`\`\`\n`;
  const r = await crawlSite(PAGES, { markdown: { "/": md } });
  assert.equal(findingOf(r, "markdown-differs"), undefined, JSON.stringify(findingOf(r, "markdown-differs")?.evidence));
  assert.ok(r.passed.some(p => p.rule === "AI-05"));
});

test("a hand-written Markdown version that drifted from the page is a low AI-05 finding, with both shares; short pages aren't compared", async () => {
  const r = await crawlSite(PAGES, { markdown: { "/": `# Boiler repairs in Leeds\n\n${OLD}\n` } });
  const f = findingOf(r, "markdown-differs");
  assert.deepEqual([f?.rule, f?.severity, f?.count], ["AI-05", "low", 1]);
  assert.match(f.evidence[0].detail, /\d+% of the page's main words/);
  assert.match(f.evidence[0].detail, /our own limit/);
  assert.doesNotMatch(f.title + f.why + f.fix, /cloak/i, "no cloaking claim");
  const short = await crawlSite(
    { "/": page("Boiler repairs", "We fix boilers in Leeds."), "/about/": page("About us", "We fix boilers.") },
    { markdown: { "/": OLD } },
  );
  assert.equal(
    findingOf(short, "markdown-differs"),
    undefined,
    "under 50 distinct words, a few words would swing the share",
  );
});

// ---------- log-scan.mjs: YandexBot checked by reverse and forward DNS ----------
const line = (ip, ua, i = 0) =>
  `${ip} - - [12/Nov/2026:10:00:${String(i % 60).padStart(2, "0")} +0000] "GET / HTTP/1.1" 200 100 "-" "${ua}"`;
const YANDEX = "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)";
// A preloaded module replaces node:dns's promise API before log-scan runs; each name asked is written to a file.
function fakeDns(dir) {
  const calls = join(dir, "dns-calls.txt"),
    file = join(dir, "fake-dns.mjs");
  writeFileSync(
    file,
    `import dns from "node:dns";
import { appendFileSync } from "node:fs";
const PTR = { "5.255.253.1": ["spider-5-255-253-1.spider.yandex.com"], "9.9.9.9": ["crawler.yandex.com.example.net"], "7.7.7.7": ["fake.yandex.ru"], "2a02:6b8:c0e:500:1::1": ["spider.yandex.net."] };
const A = { "spider-5-255-253-1.spider.yandex.com": [["5.255.253.1", 4]], "fake.yandex.ru": [["1.1.1.1", 4]], "spider.yandex.net.": [["2a02:6b8:c0e:500:1:0:0:1", 6]] };
const err = code => Object.assign(new Error(code), { code });
dns.promises.reverse = async ip => { appendFileSync(${JSON.stringify(calls)}, "PTR " + ip + "\\n"); if (ip.startsWith("6.6.6.")) throw err("ETIMEOUT"); if (PTR[ip]) return PTR[ip]; throw err("ENOTFOUND"); };
dns.promises.lookup = async host => { appendFileSync(${JSON.stringify(calls)}, "A " + host + "\\n"); if (A[host]) return A[host].map(([address, family]) => ({ address, family })); throw err("ENOTFOUND"); };
`,
  );
  return { preload: pathToFileURL(file).href, calls };
}
async function scanLog(lines, extra = []) {
  const dir = tmp(),
    log = join(dir, "access.log"),
    out = join(dir, "log-scan.json"),
    dns = fakeDns(dir);
  writeFileSync(log, lines.join("\n") + "\n");
  await node(["--import", dns.preload, join(SCRIPTS, "log-scan.mjs"), "--log", log, "--out", out, ...extra]);
  return {
    r: JSON.parse(readFileSync(out, "utf8")),
    asked: existsSync(dns.calls) ? readFileSync(dns.calls, "utf8").trim().split("\n") : [],
  };
}
const LOG = [
  line("5.255.253.1", YANDEX, 1),
  line("5.255.253.1", YANDEX, 2),
  line("5.255.253.1", YANDEX, 3),
  line("9.9.9.9", YANDEX, 4),
  line("9.9.9.9", YANDEX, 5),
  line("7.7.7.7", YANDEX, 6),
  line("6.6.6.6", YANDEX, 7),
  JSON.stringify({ time: "2026-11-12T10:01:00Z", path: "/", status: 200, ua: YANDEX, ip: "2a02:6b8:c0e:500:1::1" }),
  line("8.8.4.4", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", 8),
];

test("log-scan --verify-ips checks YandexBot by reverse DNS on Yandex's domains and a forward lookup back to the same address", async () => {
  const { r, asked } = await scanLog(LOG, ["--verify-ips", tmp()]);
  // 5.255.253.1 and the IPv6 one are Yandex's; 9.9.9.9's name isn't on Yandex's domains; 7.7.7.7's name doesn't
  // lead back to it.
  assert.deepEqual(r.bots.YandexBot.ipCheck, { verified: 4, other: 3, unknown: 1 });
  assert.ok(
    r.notes.some(n => /YandexBot 3 of 8/.test(n)),
    r.notes.join("\n"),
  );
  assert.ok(
    r.notes.some(n => /6\.6\.6\.6|1 YandexBot request/.test(n) && /DNS/.test(n)),
    "a lookup with no answer is named, not called fake",
  );
  assert.ok(!r.notes.some(n => /carry no client address/.test(n) && /YandexBot/.test(n)));
  assert.deepEqual(
    asked.filter(a => a.startsWith("PTR")).sort(),
    ["PTR 2a02:6b8:c0e:500:1::1", "PTR 5.255.253.1", "PTR 6.6.6.6", "PTR 7.7.7.7", "PTR 9.9.9.9"],
    "one lookup per address, YandexBot's only",
  );
  assert.ok(!asked.includes("A crawler.yandex.com.example.net"), "a name off Yandex's domains isn't looked up forward");
});

test("log-scan stops asking a DNS server that answers none of a batch of 10 addresses, and counts the rest as unknown", async () => {
  const { r, asked } = await scanLog(
    Array.from({ length: 15 }, (_, i) => line(`6.6.6.${i + 1}`, YANDEX, i)),
    ["--verify-ips", tmp()],
  );
  assert.deepEqual(r.bots.YandexBot.ipCheck, { verified: 0, other: 0, unknown: 15 });
  assert.equal(asked.length, 10);
  assert.ok(
    r.notes.some(n => /^15 YandexBot request\(s\) couldn't be checked in DNS/.test(n)),
    r.notes.join("\n"),
  );
});

test("log-scan without --verify-ips makes no DNS lookups", async () => {
  const { r, asked } = await scanLog(LOG);
  assert.equal(r.bots.YandexBot.ipCheck, undefined);
  assert.deepEqual(asked, []);
});
