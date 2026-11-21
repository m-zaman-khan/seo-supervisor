import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import { fetchKeys } from "../skills/seo-supervisor/scripts/connect-keys.mjs";

const KEYS = join(SCRIPTS, "connect-keys.mjs");
const SITE = "https://www.example.com";
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJwcm9qZWN0IjoiYWJjIn0.c2lnbmF0dXJl";
const XSS = "<img src=x onerror=alert(1)>";

async function fake(answer) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push({ verb: req.method, url: new URL(req.url, "http://x"), headers: req.headers });
    const [status, body] = answer();
    res.writeHead(status, { "content-type": "application/json", connection: "close" }).end(JSON.stringify(body));
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/export-data/api/v1/project-live-insights`;
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
const env = (home, extra = {}) => ({
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  CLARITY_API_TOKEN: "",
  BING_WEBMASTER_KEY: "",
  OPENPAGERANK_KEY: "",
  AHREFS_KEY: "",
  MOZ_TOKEN: "",
  YOUTUBE_API_KEY: "",
  MATOMO_TOKEN_AUTH: "",
  POSTHOG_PERSONAL_API_KEY: "",
  ...extra,
});

// Traffic's fields follow Microsoft's sample answer; the other metrics' names come from Microsoft's Clarity MCP
// server.
const ANSWER = () => [
  {
    metricName: "Traffic",
    information: [
      {
        totalSessionCount: "100",
        totalBotSessionCount: "5",
        distantUserCount: "80",
        PagesPerSessionPercentage: 1.2,
        URL: "https://www.example.com/pricing",
      },
      {
        totalSessionCount: "50",
        totalBotSessionCount: "0",
        distantUserCount: "40",
        PagesPerSessionPercentage: 1,
        URL: "https://example.com/pricing?utm_source=news",
      },
      {
        totalSessionCount: "30",
        totalBotSessionCount: "0",
        distantUserCount: "25",
        PagesPerSessionPercentage: 1,
        URL: "https://www.example.com/blog/a",
      },
      {
        totalSessionCount: "999",
        totalBotSessionCount: "0",
        distantUserCount: "900",
        PagesPerSessionPercentage: 1,
        URL: "https://other.example.org/x",
      },
      { totalSessionCount: "7", totalBotSessionCount: "0", distantUserCount: "7", PagesPerSessionPercentage: 1 },
    ],
  },
  {
    metricName: "ScrollDepth",
    information: [
      { averageScrollDepth: 40, URL: "https://www.example.com/pricing" },
      { averageScrollDepth: 70, URL: "https://example.com/pricing?utm_source=news" },
    ],
  },
  {
    metricName: "QuickbackClick",
    information: [
      {
        sessionsCount: "100",
        sessionsWithMetricPercentage: 30,
        sessionsWithoutMetricPercentage: 70,
        URL: "https://www.example.com/pricing",
      },
    ],
  },
  {
    metricName: "Rage Click Count",
    information: [{ sessionsWithMetricPercentage: 2, URL: "https://www.example.com/blog/a" }],
  },
  { metricName: "DeadClickCount", information: [{ deadClicksPerSession: 3, URL: "https://www.example.com/pricing" }] },
];

test("Clarity: one GET for the last 3 days by URL, the token as a Bearer header and nothing about the site sent", async () => {
  const srv = await fake(() => [200, ANSWER()]);
  try {
    const { result, problems } = await fetchKeys({
      site: SITE,
      keys: { clarity: { key: TOKEN } },
      endpoints: { clarity: srv.url },
    });
    assert.deepEqual(problems, []);
    assert.equal(srv.hits.length, 1, "Clarity allows 10 requests a day per project: a fetch uses one");
    const h = srv.hits[0];
    assert.equal(h.verb, "GET");
    assert.equal(h.headers.authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(
      [...h.url.searchParams],
      [
        ["numOfDays", "3"],
        ["dimension1", "URL"],
      ],
    );
    assert.doesNotMatch(h.url.href, /example\.com/);
    assert.equal(result.clarity.days, 3);
    assert.match(result.clarity.read, /^\d{4}-\d{2}-\d{2}$/);
    // http/https, www/apex and tracking-parameter variants add up by path; averages are weighted by sessions.
    assert.deepEqual(result.clarity.traffic, {
      "/pricing": { sessions: 150, botSessions: 5, scrollDepth: 50, quickBacks: 30 },
      "/blog/a": { sessions: 30, botSessions: 0, rageClicks: 2 },
    });
    assert.ok(
      result.notes.some(
        n => /dead clicks/.test(n) && /sessionsWithMetricPercentage/.test(n) && /deadClicksPerSession/.test(n),
      ),
      "a metric in a form this version can't read is left out and named: " + result.notes.join("\n"),
    );
    assert.ok(!result.notChecked.some(n => /Clarity/.test(n.area)));
  } finally {
    await srv.close();
  }
});

test("Clarity: a used-up day, a bad token and an answer in another format are explained; no key means it isn't asked", async () => {
  for (const [status, body, re] of [
    [429, { message: "Exceeded daily limit" }, /^Microsoft Clarity[^\n]*10 requests a day/],
    [401, {}, /^Microsoft Clarity didn't accept the token/],
    [403, {}, /^Microsoft Clarity[^\n]*can't read[^\n]*project admin/],
    [200, { error: "x" }, /^Microsoft Clarity's answer isn't/],
    [200, [{ metricName: "ScrollDepth", information: [] }], /^Microsoft Clarity's answer isn't/],
  ]) {
    const srv = await fake(() => [status, body]);
    try {
      const { result, problems } = await fetchKeys({
        site: SITE,
        keys: { clarity: { key: TOKEN } },
        endpoints: { clarity: srv.url },
      });
      assert.equal(problems.length, 1, `${status}: ${problems.join("\n")}`);
      assert.match(problems[0], re);
      assert.ok(!problems[0].includes(TOKEN));
      assert.equal(result.clarity, null);
    } finally {
      await srv.close();
    }
  }
  const none = await fetchKeys({ site: SITE, keys: {} });
  assert.equal(none.result.clarity, null);
  assert.ok(!none.result.notChecked.some(n => /Clarity/.test(n.area)), "offered only when the site uses Clarity");
});

test("Clarity: only other sites' pages, no sessions at all, and a full 1,000 rows each get a note", async () => {
  const cases = [
    [
      [{ metricName: "Traffic", information: [{ totalSessionCount: "9", URL: "https://other.example.org/" }] }],
      /other sites[^\n]*token is for this site's/,
    ],
    [[{ metricName: "Traffic", information: [] }], /no sessions[^\n]*Clarity's code/],
    [
      [
        {
          metricName: "Traffic",
          information: Array.from({ length: 1000 }, (_, i) => ({
            totalSessionCount: "1",
            URL: `https://www.example.com/p${i}`,
          })),
        },
      ],
      /1,000 rows/,
    ],
  ];
  for (const [answer, re] of cases) {
    const srv = await fake(() => [200, answer]);
    try {
      const { result, problems } = await fetchKeys({
        site: SITE,
        keys: { clarity: { key: TOKEN } },
        endpoints: { clarity: srv.url },
      });
      assert.deepEqual(problems, []);
      assert.ok(
        result.notes.some(n => re.test(n)),
        result.notes.join("\n"),
      );
    } finally {
      await srv.close();
    }
  }
});

test("set clarity takes only a token, not the project ID; guide, status and the dry run say what's sent, never the token", async () => {
  const home = tmp(),
    srv = await fake(() => [200, ANSWER()]);
  try {
    const e = env(home, { CLARITY_ENDPOINT: srv.url });
    await assert.rejects(
      node([KEYS, "set", "clarity", "k3x9q2abcd"], { env: e }),
      x => x.code === 2 && /project ID/.test(x.stderr) && /guide clarity/.test(x.stderr),
    );
    await node([KEYS, "set", "clarity", TOKEN], { env: e });
    assert.match(
      (await node([KEYS, "status"], { env: e })).stdout,
      /Microsoft Clarity: set \(…bmF0dXJl|Microsoft Clarity: set \(…/,
    );
    const guide = (await node([KEYS, "guide", "clarity"], { env: e })).stdout;
    for (const re of [
      /clarity\.microsoft\.com/,
      /Settings → Data Export/,
      /project admin/,
      /10 requests a day/,
      /last 3 days/,
      /heat maps/i,
      /node connect-keys\.mjs set clarity(?! <)/,
      /your own terminal/,
    ])
      assert.match(guide, re);
    const dry = (await node([KEYS, "fetch", "--site", SITE, "--out", join(home, "k.json")], { env: e })).stdout;
    assert.equal(srv.hits.length, 0);
    assert.match(dry, /Microsoft Clarity: your token only[^\n]*numOfDays=3&dimension1=URL[^\n]*1 of the 10 requests/);
    assert.doesNotMatch(dry, new RegExp(TOKEN.replace(/\./g, "\\.")));
  } finally {
    await srv.close();
  }
});

// ---------- the report ----------
const render = async extra => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  writeFileSync(join(dir, "a.json"), JSON.stringify({ ...data, ...extra }));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};

test("the report shows Clarity on the page's findings and one Overview line, escaped, and nothing without it", async () => {
  const before = await render({});
  assert.doesNotMatch(before.html + before.md, /Clarity/);
  const { html, md } = await render({
    clarity: {
      days: 3,
      read: "2026-11-21",
      traffic: {
        "/tools/mx-lookup/": {
          sessions: 150,
          botSessions: 5,
          scrollDepth: 49.6,
          quickBacks: 30,
          rageClicks: 0.4,
          deadClicks: 0,
        },
        [`/${XSS}`]: { sessions: 40, quickBacks: 55 },
        "/few/": { sessions: 3, quickBacks: 90 },
        "/odd/": { sessions: "<b>9</b>", scrollDepth: XSS },
      },
    },
  });
  const line =
    "Microsoft Clarity (the 3 days before 21 Nov 2026): 150 sessions · average scroll depth 50% · quick backs in 30% of sessions · rage clicks in under 1% of sessions";
  assert.ok(html.includes(`<p class="quiet">${line} on <code>/tools/mx-lookup/</code></p>`), "on the finding card");
  assert.ok(md.includes(`\n${line} on \`/tools/mx-lookup/\`\n`), "under the finding in the Markdown");
  // /few/ has 90% quick backs but only 3 sessions, under the cut-off.
  const overview =
    "Microsoft Clarity (the 3 days before 21 Nov 2026): 193 sessions on 3 pages · most quick backs: /&lt;img src=x onerror=alert(1)&gt; 55%, /tools/mx-lookup/ 30% · most rage clicks: /tools/mx-lookup/ under 1% (pages with 10 or more sessions)";
  assert.ok(html.includes(overview), "the Overview line, with the path escaped");
  assert.ok(md.includes("most quick backs: /\\<img src=x onerror=alert(1)\\> 55%"), "escaped in the Markdown too");
  assert.doesNotMatch(html, /<img src=x|<b>9<\/b>/);
  assert.doesNotMatch(md, /(?<!\\)<img src=x|<b>9/, "the Markdown shows it only as \\<img");
  const scores = s => s.match(/\d+\/100/g);
  assert.deepEqual(scores(html), scores(before.html), "information only: no score moves");
});
