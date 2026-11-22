// connect-keys.mjs, google.mjs, change-check.mjs and deploy-check.mjs on the shared lib/ helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import * as cli from "../skills/seo-supervisor/scripts/lib/cli.mjs";
import { privacyOf } from "../skills/seo-supervisor/scripts/lib/settings-dir.mjs";
import * as keys from "../skills/seo-supervisor/scripts/connect-keys.mjs";
import { fetchGoogle, Fail as GoogleFail } from "../skills/seo-supervisor/scripts/google.mjs";
import { pagePath, periodOf, searchConsole } from "../skills/seo-supervisor/scripts/google/search-console.mjs";
import { refusal } from "../skills/seo-supervisor/scripts/keys/http.mjs";
import { periodFor } from "../skills/seo-supervisor/scripts/keys/visits.mjs";
import { fetchBing } from "../skills/seo-supervisor/scripts/keys/bing.mjs";
import { changeCheck } from "../skills/seo-supervisor/scripts/change-check.mjs";
import { deployCheck } from "../skills/seo-supervisor/scripts/deploy-check.mjs";

const GOOGLE = join(SCRIPTS, "google.mjs"),
  KEYS = join(SCRIPTS, "connect-keys.mjs"),
  CHANGE = join(SCRIPTS, "change-check.mjs"),
  DEPLOY = join(SCRIPTS, "deploy-check.mjs");
const SITE = "https://www.example.com",
  SC = "https://www.googleapis.com/auth/webmasters.readonly";
const QUERY = "POST /webmasters/v3/sites/sc-domain:example.com/searchAnalytics/query";
const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// One local server plays every service. routes: "METHOD /path" -> hit => [status, json, headers?]; all hits are kept.
async function fake(routes = {}) {
  const hits = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => {
      raw += c;
    });
    req.on("end", () => {
      const u = new URL(req.url, "http://x"),
        hit = {
          method: req.method,
          path: decodeURIComponent(u.pathname),
          query: u.searchParams,
          headers: req.headers,
          body: /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw) : raw,
        };
      hits.push(hit);
      const [status, json, headers = {}] = routes[`${hit.method} ${hit.path}`]?.(hit) || [
        404,
        { error: { code: 404, message: "no such fake route" } },
      ];
      res
        .writeHead(status, { "content-type": "application/json", connection: "close", ...headers })
        .end(JSON.stringify(json));
    });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  const endpoints = {
    token: url + "/token",
    searchConsole: url + "/webmasters/v3",
    inspection: url + "/v1",
    analyticsAdmin: url + "/admin",
    analyticsData: url + "/data",
  };
  const env = {
    SEO_GOOGLE_TOKEN_URL: endpoints.token,
    SEO_GOOGLE_SEARCH_CONSOLE_URL: endpoints.searchConsole,
    SEO_GOOGLE_INSPECTION_URL: endpoints.inspection,
  };
  return {
    url,
    hits,
    endpoints,
    env,
    close: () =>
      new Promise(c => {
        server.closeAllConnections();
        server.close(c);
      }),
  };
}
const SITES = {
  "GET /webmasters/v3/sites": () => [
    200,
    { siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] },
  ],
};
// A home with a saved Google sign-in (Search Console only), and no keys from the developer's machine.
function signedIn(extra = {}) {
  const home = tmp();
  mkdirSync(join(home, ".seo-supervisor"), { recursive: true });
  writeFileSync(
    join(home, ".seo-supervisor", "google.json"),
    JSON.stringify({
      method: "own-client",
      client: { id: "own-id", secret: "own-secret" },
      access_token: "fresh",
      refresh_token: "r1",
      expires_at: Date.now() + 3600e3,
      scope: SC,
      ...extra,
    }),
  );
  return home;
}
const NO_KEYS = Object.fromEntries(
  [
    "BING_WEBMASTER_KEY",
    "OPENPAGERANK_KEY",
    "AHREFS_KEY",
    "MOZ_TOKEN",
    "YOUTUBE_API_KEY",
    "MATOMO_TOKEN_AUTH",
    "POSTHOG_PERSONAL_API_KEY",
    "CLARITY_API_TOKEN",
    "PERPLEXITY_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_PLACES_API_KEY",
  ].map(k => [k, ""]),
);
const envFor = (home, extra = {}) => ({ ...process.env, HOME: home, USERPROFILE: home, ...NO_KEYS, ...extra });
const plain =
  (re, code = 2, where = "stderr") =>
  e => {
    assert.equal(e.code, code, e.stderr + e.stdout);
    assert.match(e[where], re);
    assert.doesNotMatch(e.stderr, /\n\s+at |node:internal/);
    return true;
  };

// ---------- the shared parser ----------
test("a stray yes never counts as --yes: submit-sitemap and the other commands stop before contacting anything", async () => {
  const g = await fake(SITES),
    home = signedIn(),
    env = envFor(home, g.env),
    dir = tmp(),
    list = join(dir, "pages.txt");
  writeFileSync(list, "/a/\n");
  try {
    await assert.rejects(
      node([GOOGLE, "submit-sitemap", "--site", SITE, "--sitemap", SITE + "/sitemap.xml", "yes"], { env }),
      plain(/unexpected "yes": options start with --, like --yes/),
    );
    assert.deepEqual(g.hits, [], "nothing was read or sent");
    assert.equal(
      JSON.parse(readFileSync(join(home, ".seo-supervisor", "google.json"), "utf8")).scope,
      SC,
      "the saved sign-in is unchanged",
    );
    for (const [script, args] of [
      [KEYS, ["fetch", "--site", SITE, "yes"]],
      [KEYS, ["submit-bing", "--site", SITE, "--urls", list, "yes"]],
      [KEYS, ["status", "yes"]],
      [CHANGE, ["--site", SITE, "--date", day(40), "--pages", list, "yes"]],
      [DEPLOY, ["--site", "http://127.0.0.1:9", "yes"]],
    ])
      await assert.rejects(node([script, ...args], { env }), plain(/unexpected "yes"/), args.join(" "));
    // --name=value works, and a misspelt option stops the script.
    const dry = await node([GOOGLE, "submit-sitemap", `--site=${SITE}`, `--sitemap=${SITE}/sitemap.xml`], { env });
    assert.match(dry.stdout, /dry run/);
    await assert.rejects(node([GOOGLE, "fetch", "--sitee", SITE], { env }), plain(/unknown option --sitee/));
    await assert.rejects(
      node([KEYS, "fetch", "--site", SITE, "--competitor", "a.com"], { env }),
      plain(/unknown option --competitor/),
    );
    assert.ok(
      g.hits.every(h => h.path === "/webmasters/v3/sites"),
      "only the dry run's property list was read",
    );
  } finally {
    await g.close();
  }
});

// ---------- Retry-After ----------
test("Retry-After given as a date: a plain wait in seconds, and Google's retry waits for it, not 2 seconds", async () => {
  const at = new Date(Math.floor(Date.now() / 1000) * 1000 + 30000).toUTCString(); // 29 to 30 seconds from now
  const msg = refusal("bing", keys.SERVICES.bing, 429, null, at, "ssl.bing.com");
  assert.match(msg, /Wait 30 seconds and run again/);
  assert.doesNotMatch(msg, /GMT/);
  assert.match(refusal("bing", keys.SERVICES.bing, 429, null, null, "ssl.bing.com"), /Wait a while and run again/);
  assert.match(refusal("bing", keys.SERVICES.bing, 429, null, "20", "ssl.bing.com"), /Wait 20 seconds/);
  let n = 0;
  const g = await fake({
    "GET /webmasters/v3/sites": () =>
      n++
        ? SITES["GET /webmasters/v3/sites"]()
        : [
            429,
            { error: { code: 429, message: "Quota exceeded" } },
            { "retry-after": new Date(Date.now() - 60000).toUTCString() },
          ],
  });
  try {
    const t0 = Date.now(),
      sc = await searchConsole({ site: SITE, home: signedIn(), endpoints: g.endpoints });
    assert.equal(sc.prop, "sc-domain:example.com");
    assert.equal(n, 2, "retried once");
    assert.ok(Date.now() - t0 < 1500, `a date already past means no wait (took ${Date.now() - t0} ms)`);
  } finally {
    await g.close();
  }
});

// ---------- private files ----------
test("keys.json and google.json are written private, and the message says so only when it held", async () => {
  const home = tmp();
  const r = await node([KEYS, "set", "bing", "bing-key-12345678"], { env: envFor(home) });
  assert.ok(
    r.stdout.includes(`(${privacyOf({ locked: true })})`) || r.stdout.includes(`(${privacyOf({ locked: false })})`),
    r.stdout,
  );
  if (process.platform === "win32") {
    // A user icacls doesn't know, so the file can't be limited to it: the message says so instead of claiming it.
    const h2 = tmp(),
      r2 = await node([KEYS, "set", "bing", "bing-key-12345678"], {
        env: envFor(h2, { SystemRoot: join(h2, "no-windows") }),
      });
    assert.match(
      r2.stdout,
      /this system didn't let it be limited to your user account, so it's as private as the folder it's in/,
    );
    assert.doesNotMatch(r2.stdout, /only your user account can read it/);
    assert.deepEqual(JSON.parse(readFileSync(join(h2, ".seo-supervisor", "keys.json"), "utf8")), {
      bing: "bing-key-12345678",
    });
  }
  // google.mjs's header doesn't promise file modes, which Windows ignores.
  assert.doesNotMatch(readFileSync(GOOGLE, "utf8"), /file 0600 where the OS has modes/);
});

// ---------- the YouTube key in a header ----------
test("the YouTube Data API key goes in the X-Goog-Api-Key header, never in the address", async () => {
  const g = await fake({
    "GET /yt/channels": () => [200, { items: [] }],
    "GET /yt/search": () => [200, { items: [] }],
  });
  try {
    await keys.fetchKeys({
      site: SITE,
      keys: { youtube: { key: "yt-key-0001" } },
      endpoints: { youtube: g.url + "/yt" },
      topics: ["widgets"],
      channel: "@example",
    });
    assert.equal(g.hits.length, 2);
    for (const h of g.hits) {
      assert.equal(h.headers["x-goog-api-key"], "yt-key-0001");
      assert.equal(h.query.get("key"), null);
    }
  } finally {
    await g.close();
  }
});

// ---------- a key typed on the command line ----------
test("set <service> <key> still saves, but warns that the key is in the shell's history and points to the hidden prompt", async () => {
  const home = tmp(),
    r = await node([KEYS, "set", "bing", "bing-key-12345678"], { env: envFor(home) });
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".seo-supervisor", "keys.json"), "utf8")), {
    bing: "bing-key-12345678",
  });
  assert.match(r.stderr, /history/);
  assert.match(r.stderr, /node connect-keys\.mjs set bing(?! bing-key)/);
  assert.doesNotMatch(r.stderr + r.stdout, /bing-key-12345678/, "the warning doesn't repeat the key");
  const p = node([KEYS, "set", "ahrefs"], { env: envFor(home) });
  p.child.stdin.end("ahrefs-key-9876\n");
  const piped = await p;
  assert.equal(JSON.parse(readFileSync(join(home, ".seo-supervisor", "keys.json"), "utf8")).ahrefs, "ahrefs-key-9876");
  assert.doesNotMatch(piped.stderr, /history/, "no warning when the key wasn't on the command line");
});

// ---------- periods, paging, the anomaly note and --days ----------
test("--days is checked the same way in google.mjs and connect-keys.mjs, and Matomo's period is Search Console's", async () => {
  const home = tmp(),
    env = envFor(home);
  for (const script of [GOOGLE, KEYS])
    await assert.rejects(
      node([script, "fetch", "--site", SITE, "--days", "90.7"], { env }),
      plain(/--days must be a whole number from 1 to 480 \(got 90\.7\)/),
      script,
    );
  await assert.rejects(
    node([GOOGLE, "fetch", "--site", SITE, "--days"], { env }),
    plain(/--days must be a whole number/),
    "--days with no number isn't read as 90",
  );
  const p = periodOf(30);
  assert.deepEqual(periodFor(30), { from: p.startDate, to: p.endDate });
  assert.equal(p.endDate, day(3), "ends 3 days ago");
});

test("change-check reads its windows with the shared paging and writes Google's data-anomaly note the same way as fetch", async () => {
  // 2 April 2026 sits inside Google's logged impressions problem (13 May 2025 to 27 April 2026).
  const date = "2026-04-02",
    rows = {
      "/c1/": 50,
      "/c2/": 60,
      ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/p${i}/`, 40 + 5 * i])),
    };
  const g = await fake({
    ...SITES,
    [QUERY]: ({ body }) => [
      200,
      {
        rows: Object.entries(rows)
          .map(([p, c]) => ({ keys: [SITE + p], clicks: c, impressions: c * 20 }))
          .slice(body.startRow, body.startRow + body.rowLimit),
      },
    ],
  });
  try {
    const r = await changeCheck({
      site: SITE,
      date,
      pages: ["/c1/", "/c2/"],
      home: signedIn(),
      endpoints: g.endpoints,
      pageSize: 5,
    });
    assert.equal(r.groups.control.pages, 12, "every page was read, 5 rows at a time");
    assert.ok(g.hits.filter(h => h.method === "POST").every(h => h.body.rowLimit === 5 && h.body.type === "web"));
    assert.ok(
      r.notes.some(n =>
        /^Google's "Data anomalies in Search Console" page says that from 2025-05-13 to 2026-04-27 .+\. This overlaps the dates compared, so a change in those numbers may not be real: https:\/\/support\.google\.com/.test(
          n,
        ),
      ),
      r.notes.join("\n"),
    );
  } finally {
    await g.close();
  }
});

// ---------- deploy-check pins the address it checked ----------
test("deploy-check connects off the site only at the address its check gave: a name that fails the check is never fetched", async () => {
  const seen = [],
    asked = [];
  const fetchFn = async url => {
    seen.push(String(url));
    if (new URL(url).pathname === "/robots.txt")
      return new Response(
        "User-agent: *\nAllow: /\nSitemap: https://cdn.example.net/sitemap.xml\nSitemap: https://rebind.example.net/sitemap.xml\n",
        { status: 200, headers: { "content-type": "text/plain" } },
      );
    return new Response(`<!doctype html><title>Home</title><link rel="canonical" href="${SITE}/">`, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };
  // Stands in for DNS: no answer for one name, a private address for the other.
  const lookup = (name, opts, cb) => {
    asked.push(name);
    if (name === "rebind.example.net")
      return opts?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4);
    cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${name}`), { code: "ENOTFOUND" }));
  };
  const cert = async () => ({
    authorized: true,
    valid_from: "Sep 1 00:00:00 2026 GMT",
    valid_to: "Dec 31 00:00:00 2027 GMT",
  });
  const r = await deployCheck(SITE, { fetchFn, lookup, connect: cert });
  assert.deepEqual(
    seen.map(u => new URL(u).host),
    ["www.example.com", "www.example.com"],
    "only the site itself goes through fetch",
  );
  assert.deepEqual(
    [...new Set(asked)].sort(),
    ["cdn.example.net", "rebind.example.net"],
    "each off-site name is looked up for the connection itself",
  );
  const text = r.checks.find(c => c.id === "sitemap").text;
  assert.match(text, /cdn\.example\.net\/sitemap\.xml wasn't reached: the name isn't in DNS \(ENOTFOUND\)/);
  assert.match(text, /rebind\.example\.net points at a private or local address \(127\.0\.0\.1\)/);
});

// ---------- Search Console paths and crawl paths ----------
test("tracking parameters don't split a page's Search Console numbers, and a trailing slash doesn't hide them", async () => {
  assert.equal(pagePath(`${SITE}/a/?utm_source=news&id=2&srsltid=AfmBOo&gclid=x`, "www.example.com"), "/a/?id=2");
  assert.equal(pagePath(`${SITE}/a/?utm_medium=email`, "example.com"), "/a/");
  assert.equal(
    pagePath(`${SITE}/a/?page=2&q=a%20b`, "www.example.com"),
    "/a/?page=2&q=a%20b",
    "other parameters stay as they are",
  );
  const prev = periodOf(28).startDate;
  const pages = [
    [`${SITE}/a`, 5],
    [`${SITE}/a/?utm_source=news`, 3],
    [`${SITE}/b?srsltid=AfmBOo`, 2],
    [`${SITE}/c/`, 1],
  ];
  const g = await fake({
    ...SITES,
    [QUERY]: ({ body }) => [
      200,
      {
        rows:
          body.dimensions?.join() === "page" && body.endDate >= prev
            ? pages.map(([u, c]) => ({ keys: [u], clicks: c, impressions: c * 10, ctr: 0.1, position: 3 }))
            : [],
      },
    ],
  });
  try {
    const crawl = {
      pages: [
        { url: `${SITE}/a/`, status: 200 },
        { url: `${SITE}/c`, status: 200 },
        { url: `${SITE}/b`, status: 200 },
      ],
    };
    const r = await fetchGoogle({ site: SITE, days: 28, home: signedIn(), endpoints: g.endpoints, crawl });
    assert.deepEqual(
      Object.fromEntries(Object.entries(r.traffic).map(([p, t]) => [p, t.clicks])),
      { "/a/": 8, "/b": 2, "/c": 1 },
      "filed under the crawled page's own path",
    );
  } finally {
    await g.close();
  }
  // change-check: a listed page matches Search Console's row whatever its trailing slash.
  const rows = {
    "/c1/": 50,
    "/c2": 60,
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/p${i}/`, 40 + 5 * i])),
  };
  const g2 = await fake({
    ...SITES,
    [QUERY]: ({ body }) => [
      200,
      {
        rows: Object.entries(rows)
          .map(([p, c]) => ({ keys: [SITE + p], clicks: c, impressions: c * 20 }))
          .slice(body.startRow, body.startRow + body.rowLimit),
      },
    ],
  });
  try {
    const r = await changeCheck({
      site: SITE,
      date: day(40),
      pages: ["/c1", "/c2/?utm_source=mail"],
      home: signedIn(),
      endpoints: g2.endpoints,
    });
    assert.deepEqual(r.groups.changed.paths, ["/c1/", "/c2"]);
    assert.ok(!r.notes.some(n => /no Google Search data/.test(n)), r.notes.join("\n"));
  } finally {
    await g2.close();
  }
});

// ---------- the brand split against the period before ----------
test("the brand split is compared with the period before, so a fall in other searches that brand growth hides is noted", async () => {
  const brand = (b, n) => [
    { keys: ["BRANDED"], clicks: b, impressions: b * 10 },
    { keys: ["NON_BRANDED"], clicks: n, impressions: n * 30 },
  ];
  const routes = from => ({
    ...SITES,
    [QUERY]: ({ body }) => [
      200,
      {
        rows:
          body.dimensions?.join() === "brandedClassification"
            ? body.endDate < from
              ? brand(100, 200)
              : brand(300, 100)
            : [],
      },
    ],
  });
  let g = await fake(routes(periodOf(28).startDate));
  try {
    const r = await fetchGoogle({ site: SITE, days: 28, home: signedIn(), endpoints: g.endpoints });
    const p = periodOf(28),
      before = { startDate: day(2 * 28 + 2), endDate: day(28 + 3) };
    assert.deepEqual(r.brandSplit, {
      branded: { clicks: 300, impressions: 3000 },
      nonBranded: { clicks: 100, impressions: 3000 },
      previous: {
        from: before.startDate,
        to: before.endDate,
        branded: { clicks: 100, impressions: 1000 },
        nonBranded: { clicks: 200, impressions: 6000 },
      },
    });
    assert.ok(p.startDate > before.endDate);
    assert.ok(
      r.notes.some(
        n =>
          /other than your brand fell from 200 to 100 clicks \(-50%\)/.test(n) &&
          /brand searches grew from 100 to 300/.test(n),
      ),
      r.notes.join("\n"),
    );
  } finally {
    await g.close();
  }
  // A period before that starts before Google's brand label did (21 Feb 2026) isn't compared.
  g = await fake(routes(periodOf(200).startDate));
  try {
    const r = await fetchGoogle({ site: SITE, days: 200, home: signedIn(), endpoints: g.endpoints });
    assert.equal(r.brandSplit.previous, undefined);
    assert.ok(
      r.notes.some(n => /21 Feb 2026/.test(n) && /period before/.test(n)),
      r.notes.join("\n"),
    );
  } finally {
    await g.close();
  }
});

// ---------- Bing's host matching ----------
test("Bing's site is matched exactly first, then www and the bare domain as one; the sister comparison skips both forms", async () => {
  const sites = [
    { Url: "https://example.com/", IsVerified: true },
    { Url: "https://www.example.com/", IsVerified: true },
    { Url: "https://www.sister.example/", IsVerified: true },
  ];
  const links = {
    "https://www.sister.example/": [
      "https://blog.one.example/p",
      "https://sister.example/self",
      "https://www.example.com/x",
      "https://two.example/q",
    ],
    "https://www.example.com/": ["https://blog.one.example/y"],
  };
  const g = await fake({
    "GET /bing/GetUserSites": () => [200, { d: sites }],
    "GET /bing/GetQueryStats": () => [200, { d: [] }],
    "GET /bing/GetPageStats": () => [200, { d: [] }],
    "GET /bing/GetCrawlIssues": () => [200, { d: [] }],
    "GET /bing/GetLinkCounts": h => [200, { d: { Links: [{ Url: h.query.get("siteUrl"), Count: 3 }], TotalPages: 1 } }],
    "GET /bing/GetUrlLinks": h => [
      200,
      { d: { Details: (links[h.query.get("link")] || []).map(Url => ({ Url, AnchorText: "x" })) } },
    ],
  });
  try {
    assert.equal((await fetchBing("k", "https://example.com/", g.url + "/bing", [])).siteUrl, "https://example.com/");
    const r = await fetchBing("k", SITE + "/", g.url + "/bing", [], { sister: "https://sister.example/" });
    assert.equal(r.siteUrl, "https://www.example.com/");
    assert.deepEqual(
      r.sister,
      { site: "https://www.sister.example/", onlySister: ["two.example"], shared: 1 },
      "sister.example and www.example.com are skipped in either form",
    );
  } finally {
    await g.close();
  }
});

// ---------- Fail, Refused, runMain and exit codes ----------
test("one error class each, and exit codes that match the docs: 1 for a refusal or nothing connected, 2 for bad input", async () => {
  assert.equal(keys.Fail, cli.Fail);
  assert.equal(keys.Refused, cli.Refused);
  assert.equal(GoogleFail, cli.Fail);
  const home = tmp(),
    env = envFor(home);
  // status: 1 when nothing is connected, in both scripts, as google.mjs's header says.
  await assert.rejects(node([KEYS, "status"], { env }), plain(/Bing Webmaster Tools: not set/, 1, "stdout"));
  await assert.rejects(node([GOOGLE, "status"], { env }), plain(/Not connected/, 1, "stdout"));
  await node([KEYS, "set", "bing", "bing-key-12345678"], { env });
  assert.match((await node([KEYS, "status"], { env })).stdout, /Bing Webmaster Tools: set/);
  assert.match(readFileSync(KEYS, "utf8"), /1 when a service refuses or can't be reached \(or status finds no key\)/);
  // Google saying no is a refusal (1, on stdout like connect-keys), not bad input (2).
  const g = await fake(SITES),
    h2 = signedIn();
  try {
    await assert.rejects(
      node([GOOGLE, "fetch", "--site", "https://www.nothere.com", "--out", join(h2, "g.json")], {
        env: envFor(h2, g.env),
      }),
      plain(/^google: https:\/\/www\.nothere\.com isn't in the Search Console properties/, 1, "stdout"),
    );
    await assert.rejects(
      changeCheck({ site: "https://www.nothere.com", date: day(40), pages: ["/a/"], home: h2, endpoints: g.endpoints }),
      e => e instanceof cli.Refused,
    );
  } finally {
    await g.close();
  }
});
