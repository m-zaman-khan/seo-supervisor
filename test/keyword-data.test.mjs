import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";

const DATA = join(SCRIPTS, "keyword-data.mjs"),
  KEYS = join(SCRIPTS, "connect-keys.mjs");
const SITE = "https://www.example.com";
const XSS = "<img src=x onerror=alert(1)>";
const LOGIN = "me@example.com",
  PASSWORD = "DfsPassword-1234",
  SEMRUSH = "SemrushKey-abcd5678";

// routes: "/first-segment" -> (hit, n) => [status, json], n counting from 0.
async function fake(routes) {
  const hits = [],
    seen = {};
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => {
      raw += c;
    });
    req.on("end", () => {
      const u = new URL(req.url, "http://x"),
        seg = "/" + u.pathname.split("/")[1];
      let body = raw;
      try {
        body = JSON.parse(raw);
      } catch {}
      const hit = {
        seg,
        verb: req.method,
        path: u.pathname,
        query: Object.fromEntries(u.searchParams),
        headers: req.headers,
        body,
      };
      hits.push(hit);
      seen[seg] = (seen[seg] ?? -1) + 1;
      const [status, x] = routes[seg]?.(hit, seen[seg]) || [404, { error: "no fake route" }];
      res.writeHead(status, { "content-type": "application/json", connection: "close" }).end(JSON.stringify(x));
    });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    hits,
    close: () =>
      new Promise(c => {
        server.closeAllConnections();
        server.close(c);
      }),
  };
}
const envFor = (home, srv, extra = {}) => ({
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  DATAFORSEO_LOGIN: "",
  DATAFORSEO_PASSWORD: "",
  SEMRUSH_API_KEY: "",
  ...(srv ? { DATAFORSEO_ENDPOINT: srv.url + "/dfs/v3", SEMRUSH_ENDPOINT: srv.url + "/sem/apis/v4" } : {}),
  ...extra,
});
const DFS = { DATAFORSEO_LOGIN: LOGIN, DATAFORSEO_PASSWORD: PASSWORD };
// One phrase repeated in another case.
function inputs(home) {
  const ideas = join(home, "keyword-ideas.json"),
    list = join(home, "keywords.txt");
  writeFileSync(
    ideas,
    JSON.stringify({
      almostThere: [{ phrase: "boiler repair leeds" }],
      gaps: [{ phrase: "Boiler Repair Leeds" }],
      questions: [{ phrase: "how much is a boiler service" }],
      extra: [],
    }),
  );
  writeFileSync(list, "# the owner's own\ncombi boiler price\n\n");
  return ["--ideas", ideas, "--keywords", list];
}
const run = (home, srv, keys, extra = []) =>
  node([DATA, "--site", SITE, ...inputs(home), "--out", join(home, "kd.json"), ...extra], {
    env: envFor(home, srv, keys),
  });
const ok = (cost, items) => [
  200,
  {
    status_code: 20000,
    status_message: "Ok.",
    cost,
    tasks: [{ status_code: 20000, status_message: "Ok.", cost, result: [{ items_count: items.length, items }] }],
  },
];
const overview = (keyword, volume, kd, cpc, intent) => ({
  keyword,
  keyword_info: { search_volume: volume, cpc },
  keyword_properties: { keyword_difficulty: kd },
  search_intent_info: { main_intent: intent },
});

test("connect-keys knows dataforseo and semrush: the API login in plain view, then the password hidden; masked status; guides; fetch doesn't use them", async () => {
  const home = tmp(),
    env = envFor(home, null);
  const p = node([KEYS, "set", "dataforseo"], { env });
  p.child.stdin.end(`${LOGIN}\n${PASSWORD}\n`);
  await p;
  const q = node([KEYS, "set", "semrush"], { env });
  q.child.stdin.end(`${SEMRUSH}\n`);
  await q;
  const s = (await node([KEYS, "status"], { env })).stdout;
  assert.match(s, /DataForSEO: set \(…1234, saved in [^)]+\) for the API login me@example\.com/);
  assert.match(s, /Semrush: set \(…5678/);
  assert.ok(!s.includes(PASSWORD) && !s.includes(SEMRUSH));
  const g = (await node([KEYS, "guide", "dataforseo"], { env })).stdout;
  for (const re of [
    /app\.dataforseo\.com\/api-access/,
    /isn't your account password/,
    /\$50/,
    /node connect-keys\.mjs set dataforseo(?! <)/,
    /keyword-data\.mjs/,
  ])
    assert.match(g, re);
  const h = (await node([KEYS, "guide", "semrush"], { env })).stdout;
  for (const re of [
    /Business/,
    /API units/,
    /v4/,
    /semrush\.com\/accounts\/api-keys/,
    /node connect-keys\.mjs set semrush(?! <)/,
    /keyword-data\.mjs/,
  ])
    assert.match(h, re);
  const f = await node([KEYS, "fetch", "--site", SITE, "--out", join(home, "k.json")], { env });
  assert.doesNotMatch(f.stdout, /DataForSEO|Semrush/, "fetch doesn't use them");
});

test("the dry run sends nothing and shows the keywords, the place, the requests and the most it can cost", async () => {
  const home = tmp(),
    srv = await fake({});
  try {
    const r = await run(home, srv, DFS, ["--competitors", "rival.com"]);
    assert.match(r.stdout, /dry run, nothing sent/);
    assert.match(r.stdout, /DataForSEO[^\n]*API login me@example\.com/);
    assert.match(r.stdout, /United States \(US\), in en/);
    assert.match(r.stdout, /keyword_overview\/live: 3 keywords/);
    assert.match(r.stdout, /domain_intersection\/live: [^\n]*rival\.com ranks for and example\.com doesn't/);
    assert.match(r.stdout, /at most \$0\.04/);
    for (const k of ["1. boiler repair leeds", "2. how much is a boiler service", "3. combi boiler price"])
      assert.ok(r.stdout.includes(k), k);
    assert.ok(!r.stdout.includes(PASSWORD));
    const s = await run(home, srv, { SEMRUSH_API_KEY: SEMRUSH }, ["--competitors", "rival.com"]);
    assert.match(s.stdout, /Semrush[^\n]*3 requests/);
    assert.match(s.stdout, /20 API units a request, 60 units in all/);
    assert.match(s.stdout, /competitor[^\n]*DataForSEO/i, "the competitor gap needs DataForSEO");
    const none = await run(home, srv, {});
    assert.match(none.stdout, /no DataForSEO or Semrush key is set[^\n]*guide dataforseo/i);
    assert.equal(srv.hits.length, 0, "nothing was sent");
  } finally {
    await srv.close();
  }
});

test("with DataForSEO it reads the metrics and a competitor's gap with Basic auth and writes keyword-data.json", async () => {
  const home = tmp();
  const srv = await fake({
    "/dfs": hit =>
      hit.path.endsWith("/keyword_overview/live")
        ? ok(0.01236, [
            overview("boiler repair leeds", 1200, 38, 3.1, "commercial"),
            overview("how much is a boiler service", 2400, 22, 1.25, "informational"),
          ])
        : ok(0.0132, [
            {
              keyword_data: { keyword: `boiler cover ${XSS}`, keyword_info: { search_volume: 5400 } },
              first_domain_serp_element: { rank_group: 4, url: "https://rival.com/cover/" },
            },
          ]),
  });
  try {
    const r = await run(home, srv, DFS, ["--competitors", "rival.com", "--yes"]);
    const [a, b] = srv.hits;
    for (const h of [a, b])
      assert.equal(h.headers.authorization, "Basic " + Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64"));
    assert.match(a.path, /^\/dfs\/v3\/dataforseo_labs\/google\/keyword_overview\/live$/);
    assert.deepEqual(a.body, [
      {
        keywords: ["boiler repair leeds", "how much is a boiler service", "combi boiler price"],
        location_name: "United States",
        language_code: "en",
      },
    ]);
    assert.match(b.path, /\/domain_intersection\/live$/);
    assert.deepEqual(b.body, [
      {
        target1: "rival.com",
        target2: "example.com",
        intersections: false,
        item_types: ["organic"],
        location_name: "United States",
        language_code: "en",
        limit: 100,
      },
    ]);
    const j = JSON.parse(readFileSync(join(home, "kd.json"), "utf8"));
    assert.equal(j.source, "keyword-data");
    assert.equal(j.service, "dataforseo");
    assert.equal(j.site, SITE + "/");
    assert.deepEqual(
      j.keywords.map(k => [k.keyword, k.volume, k.difficulty, k.cpc, k.intent]),
      [
        ["how much is a boiler service", 2400, 22, 1.25, ["informational"]],
        ["boiler repair leeds", 1200, 38, 3.1, ["commercial"]],
      ],
      "most searched first",
    );
    assert.deepEqual(j.notFound, ["combi boiler price"]);
    assert.deepEqual(j.competitors, [
      {
        domain: "rival.com",
        keywords: [{ keyword: `boiler cover ${XSS}`, volume: 5400, position: 4, url: "https://rival.com/cover/" }],
      },
    ]);
    assert.equal(j.spent.usd, 0.02556);
    assert.match(r.stdout, /2 of 3 keywords have data/);
    assert.match(r.stdout, /wrote /);
  } finally {
    await srv.close();
  }
});

test("DataForSEO's refusals, in the body or as HTTP 401, come back as plain messages and exit 1", async () => {
  for (const [answer, re] of [
    [
      [
        200,
        {
          status_code: 40210,
          status_message: "Insufficient funds. Your account's balance is too low to complete this request.",
          tasks: [],
        },
      ],
      /balance is too low[^\n]*app\.dataforseo\.com/,
    ],
    [
      [401, { status_code: 40100, status_message: "You are not authorized to access this resource." }],
      /didn't accept the API login and password[^\n]*isn't your account password/,
    ],
    [
      [200, { status_code: 20000, tasks: [{ status_code: 40501, status_message: "Invalid Field: 'location_name'." }] }],
      /DataForSEO said: Invalid Field: 'location_name'\. \(40501\)/,
    ],
  ]) {
    const home = tmp(),
      srv = await fake({ "/dfs": () => answer });
    try {
      const r = await run(home, srv, DFS, ["--yes"]).catch(e => e);
      assert.equal(r.code, 1, r.stdout);
      assert.match(r.stdout, re);
      assert.ok(!r.stdout.includes(PASSWORD));
    } finally {
      await srv.close();
    }
  }
});

test("with Semrush it asks once per keyword with the v4 key header, turns cents into dollars, and keeps what it read when the key stops working", async () => {
  const home = tmp();
  const srv = await fake({
    "/sem": (hit, n) =>
      n === 0
        ? [
            200,
            {
              meta: { success: true, keyword: "boiler repair leeds", country: "US" },
              data: { search_volume: 880, cpc: 245, keyword_difficulty: 41, intents: ["COMMERCIAL", "INFORMATIONAL"] },
            },
          ]
        : [
            401,
            {
              meta: { success: false, status_code: 401 },
              error: { code: "UNAUTHORIZED", message: "Unauthorized", retryable: false },
            },
          ],
  });
  try {
    const r = await run(home, srv, { SEMRUSH_API_KEY: SEMRUSH }, ["--country", "gb", "--yes"]).catch(e => e);
    assert.equal(r.code, 1, r.stdout);
    assert.equal(srv.hits.length, 2, "it stops at the refusal");
    const [a] = srv.hits;
    assert.equal(a.verb, "GET");
    assert.equal(a.path, "/sem/apis/v4/keywords/v1/metrics");
    assert.deepEqual(a.query, { keyword: "boiler repair leeds", country: "GB" });
    assert.equal(a.headers.authorization, `Apikey ${SEMRUSH}`);
    assert.match(r.stdout, /Semrush didn't accept the key \(401\)[^\n]*v4/);
    const j = JSON.parse(readFileSync(join(home, "kd.json"), "utf8"));
    assert.deepEqual(j.keywords, [
      {
        keyword: "boiler repair leeds",
        volume: 880,
        difficulty: 41,
        cpc: 2.45,
        intent: ["commercial", "informational"],
      },
    ]);
    assert.equal(j.country, "GB");
    assert.equal(j.spent.units, 20, "the refused request isn't counted");
    assert.match(j.error, /didn't accept the key/);
  } finally {
    await srv.close();
  }
});

test("bad input is refused before anything is sent", async () => {
  const home = tmp(),
    env = envFor(home, null, DFS);
  for (const [args, re] of [
    [["--site", SITE], /--ideas[^\n]*--keywords/],
    [["--site", SITE, ...inputs(home), "--country", "XX"], /--country[^\n]*two-letter/],
    [["--site", SITE, ...inputs(home), "--service", "ahrefs"], /dataforseo or semrush/],
    [["--site", SITE, ...inputs(home), "--competitors", "a.com,b.com,c.com,d.com"], /at most 3 competitors/],
  ])
    await assert.rejects(node([DATA, ...args], { env }), e => e.code === 2 && re.test(e.stderr));
});

// ---------- the report ----------
const render = async (extra, files = {}) => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  writeFileSync(join(dir, "a.json"), JSON.stringify({ ...data, ...extra }));
  for (const [f, j] of Object.entries(files)) writeFileSync(join(dir, f), JSON.stringify(j));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};
const IDEAS = {
  almostThere: [{ phrase: "boiler repair leeds", evidence: { impressions: 300, position: 11 } }],
  gaps: [],
  questions: [],
  extra: [],
};
const KD = {
  source: "keyword-data",
  date: "2026-11-24",
  site: "https://security.example/",
  service: "dataforseo",
  serviceName: "DataForSEO",
  country: "US",
  language: "en",
  keywords: [
    { keyword: `boiler repair leeds ${XSS}`, volume: 1200, difficulty: 38, cpc: 3.1, intent: ["commercial"] },
    { keyword: "boiler repair leeds", volume: 880, difficulty: 41, cpc: 2.45, intent: [] },
  ],
  notFound: ["combi boiler price"],
  competitors: [
    {
      domain: "rival.com",
      keywords: [{ keyword: "boiler cover", volume: 5400, position: 4, url: "https://rival.com/cover/" }],
    },
  ],
  spent: { usd: 0.03 },
  notes: [],
};

test("the report shows keyword data, the competitor's keywords and the volume beside each keyword idea", async () => {
  const before = await render({ keywordIdeas: IDEAS });
  assert.match(before.html, /There are no search volumes/);
  assert.doesNotMatch(before.html, /<summary>Keyword data<\/summary>/);
  const { html, md } = await render({ keywordIdeas: IDEAS, keywordData: KD });
  assert.match(html, /<summary>Keyword data<\/summary>/);
  assert.match(html, /From your DataForSEO account, for United States, in en/);
  for (const t of [
    "Searches a month",
    "Difficulty",
    "Cost per click",
    "1,200",
    "$3.10",
    "commercial",
    "combi boiler price",
  ])
    assert.ok(html.includes(t), t);
  assert.ok(html.includes("boiler repair leeds &lt;img src=x onerror=alert(1)&gt;") && !html.includes(XSS), "escaped");
  assert.match(html, /Keywords rival\.com ranks for and you don&#39;t \(1\)/);
  assert.ok(html.includes("5,400"));
  assert.doesNotMatch(html, /There are no search volumes/);
  assert.match(html, /880 searches a month/, "the idea shows its volume");
  assert.match(md, /Keyword data/);
});

test("the report reads keyword-data.json next to the audit, for the same site only", async () => {
  const { html } = await render({}, { "keyword-data.json": KD });
  assert.match(html, /From keyword data \(keyword-data\.json, /);
  const other = await render({}, { "keyword-data.json": { ...KD, site: "https://other.example/" } });
  assert.doesNotMatch(other.html, /<summary>Keyword data<\/summary>/);
});
