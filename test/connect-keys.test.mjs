import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import { serve } from "./serve.mjs";
import { fetchKeys } from "../skills/seo-supervisor/scripts/connect-keys.mjs";

const CLI = join(SCRIPTS, "connect-keys.mjs");
const SITE = "https://www.example.com";

// A temp home keeps the developer's real keys out; endpoints point at the fake server.
const envFor = (home, srv, extra = {}) => ({
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  BING_WEBMASTER_KEY: "",
  OPENPAGERANK_KEY: "",
  AHREFS_KEY: "",
  MOZ_TOKEN: "",
  YOUTUBE_API_KEY: "",
  MATOMO_TOKEN_AUTH: "",
  MATOMO_URL: "",
  MATOMO_SITE_ID: "",
  POSTHOG_PERSONAL_API_KEY: "",
  POSTHOG_HOST: "",
  POSTHOG_PROJECT_ID: "",
  ...(srv
    ? {
        BING_WEBMASTER_ENDPOINT: srv.url + "/bing",
        OPENPAGERANK_ENDPOINT: srv.url + "/opr",
        AHREFS_ENDPOINT: srv.url + "/ahrefs",
      }
    : {}),
  ...extra,
});
const cli = (args, env, cwd) => node([CLI, ...args], { env, cwd });
const cliIn = (args, env, input) => {
  const p = cli(args, env);
  p.child.stdin.end(input);
  return p;
};

const BING = {
  GetUserSites: {
    d: [
      { Url: "https://other.example.org/", IsVerified: true },
      { Url: "https://www.example.com/", IsVerified: true },
    ],
  },
  GetQueryStats: {
    d: [
      { Query: "blue widgets", Clicks: 5, Impressions: 100, Date: "/Date(1760000000000-0700)/" },
      { Query: "blue widgets", Clicks: 3, Impressions: 50, Date: "/Date(1762000000000-0700)/" },
      { Query: "widget repair", Clicks: 1, Impressions: 400, Date: "/Date(1761000000000-0700)/" },
    ],
  },
  GetPageStats: {
    d: [
      { Query: "https://www.example.com/pricing", Clicks: 4, Impressions: 80 },
      { Query: "http://example.com/pricing", Clicks: 1, Impressions: 20 },
      { Query: "https://www.example.com/", Clicks: 9, Impressions: 300 },
      { Query: "https://elsewhere.example.net/x", Clicks: 7, Impressions: 70 },
    ],
  },
  GetLinkCounts: page => ({
    d: {
      Links:
        page === "0"
          ? [{ Url: "https://www.example.com/", Count: 14 }]
          : [{ Url: "https://www.example.com/pricing", Count: 3 }],
      TotalPages: 2,
    },
  }),
  GetUrlLinks: { d: { Details: [{ AnchorText: "Example", Url: "https://blog.example.net/post" }], TotalPages: 1 } },
  GetCrawlIssues: {
    d: [
      { Url: "https://www.example.com/broken", HttpCode: 500, Issues: 8, InLinks: 4 },
      { Url: "https://www.example.com/old", HttpCode: 301, Issues: 1, InLinks: 2 },
    ],
  },
};

// Matomo's flat entry-page rows and PostHog's [host, path, visits] rows, with the cases fetch must leave out.
const MATOMO_ROWS = [
  { label: "/pricing", url: "https://www.example.com/pricing", entry_nb_visits: 40, nb_visits: 55 },
  { label: "/pricing", url: "http://example.com/pricing?utm_source=news", entry_nb_visits: 2 },
  { label: "/index", url: "https://www.example.com/", entry_nb_visits: 120 },
  { label: "/about", url: "https://www.example.com/about", nb_visits: 9 },
  { label: "/x", url: "https://elsewhere.example.net/x", entry_nb_visits: 7 },
  { label: "Others", entry_nb_visits: 30 },
];
const POSTHOG_ROWS = [
  ["example.com", "/pricing", 40],
  ["example.com", "/", 120],
  ["elsewhere.example.net", "/x", 7],
  ["example.com", null, 3],
];
// Visits by device and by country: Matomo's report rows (label, code, nb_visits), PostHog's [host, value, visits].
const XSS = "<img src=x onerror=alert(1)>";
const COUNTRIES = ["us", "de", "gb", "fr", "in", "br", "ca", "au", "nl", "es", "it", "se"];
const MATOMO_SPLITS = {
  "DevicesDetection.getType": [
    { label: "Desktop", nb_visits: 120, segment: "deviceType==desktop" },
    { label: "Smartphone", nb_visits: 40 },
    { label: XSS, nb_visits: 2 },
    { label: "Tablet", nb_visits: 0 },
  ],
  "UserCountry.getCountry": [
    { label: "Unknown", code: "xx", nb_visits: 500 },
    ...COUNTRIES.map((code, i) => ({ label: code, code, nb_visits: 100 - i })),
  ],
};
const POSTHOG_DEVICE = [
  ["example.com", "Desktop", 30],
  ["elsewhere.example.net", "Desktop", 99],
  ["example.com", "Mobile", 12],
  ["example.com", null, 5],
];
const POSTHOG_COUNTRY = [
  ["elsewhere.example.net", "FR", 50],
  ["example.com", "US", 20],
  ["example.com", "DE", 4],
  ["example.com", null, 9],
];

// One local server plays Bing Webmaster, Open PageRank, Ahrefs, Matomo (/matomo/) and PostHog (/posthog/).
// `reply` overrides a route: (req, body) => [status, json or an HTML string, headers].
async function fake({ bing = BING, reply = {} } = {}) {
  const hits = [];
  const srv = await serve(tmp(), {
    before(req, res) {
      let body = "";
      req.on("data", c => {
        body += c;
      });
      req.on("end", () => {
        const u = new URL(req.url, "http://x"),
          route = u.pathname.split("/")[1],
          method = u.pathname.split("/")[2];
        hits.push({
          route,
          method,
          verb: req.method,
          path: u.pathname,
          query: u.searchParams,
          headers: req.headers,
          body: body && (/json/.test(req.headers["content-type"]) ? JSON.parse(body) : body),
        });
        const send = (status, x, headers = {}) =>
          res
            .writeHead(status, { "content-type": typeof x === "string" ? "text/html" : "application/json", ...headers })
            .end(typeof x === "string" ? x : JSON.stringify(x));
        if (reply[route]) return send(...reply[route](req, body));
        // A Bing route that answers an array gives [status, json]; Bing's own answers are always an object ({ d }).
        if (route === "bing") {
          const r = bing[method],
            x = typeof r === "function" ? r(u.searchParams.get("page")) : r;
          return !r ? send(404, {}) : Array.isArray(x) ? send(...x) : send(200, x);
        }
        if (route === "opr")
          return send(200, {
            status_code: 200,
            response: u.searchParams
              .getAll("domains[]")
              .map((d, i) =>
                d === "unknown.example"
                  ? { status_code: 404, error: "Domain not found", domain: d, page_rank_decimal: 0 }
                  : {
                      status_code: 200,
                      error: "",
                      domain: d,
                      page_rank_integer: 5 - i,
                      page_rank_decimal: 5.5 - i,
                      rank: String(1000 * (i + 1)),
                    },
              ),
          });
        if (route === "ahrefs")
          return send(200, {
            domain_rating: {
              license: "http://ahrefs.com/legal/domain-rating-license",
              targets: JSON.parse(body).targets.map((t, i) => ({ target: t, domain_rating: 60 - 10 * i })),
            },
          });
        if (route === "matomo") return send(200, MATOMO_SPLITS[u.searchParams.get("method")] || MATOMO_ROWS);
        if (route === "posthog") {
          const q = JSON.parse(body).query.query;
          return send(200, {
            columns: ["host", "k", "visits"],
            results: /\$device_type/.test(q)
              ? POSTHOG_DEVICE
              : /\$geoip_country_code/.test(q)
                ? POSTHOG_COUNTRY
                : POSTHOG_ROWS,
            hasMore: false,
          });
        }
        send(404, {});
      });
      return true;
    },
  });
  return { ...srv, hits };
}
const fetchCli = (home, srv, keys, extra = []) =>
  cli(["fetch", "--site", SITE, "--out", join(home, "keys-out.json"), ...extra], envFor(home, srv, keys));
const output = home => JSON.parse(readFileSync(join(home, "keys-out.json"), "utf8"));

test("set, status and remove keep keys in the home folder, private, and never in the project", async () => {
  const home = tmp(),
    project = tmp(),
    env = envFor(home);
  await cli(["set", "bing", "bingkey-abcdef-1234"], env, project);
  await cli(["set", "ahrefs", "  ahrefs-key-9876  "], env, project);
  const file = join(home, ".seo-supervisor", "keys.json");
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { bing: "bingkey-abcdef-1234", ahrefs: "ahrefs-key-9876" });
  assert.deepEqual(readdirSync(project), [], "nothing written to the project");
  if (process.platform !== "win32") {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(home, ".seo-supervisor")).mode & 0o777, 0o700);
  }

  const s = (await cli(["status"], env)).stdout;
  assert.doesNotMatch(s, /bingkey-abcdef-1234|ahrefs-key-9876/, "keys are masked");
  assert.match(s, /Bing Webmaster Tools: set \(…1234/);
  assert.match(s, /Ahrefs[^\n]*: set \(…9876/);
  assert.match(s, /Open PageRank: not set[^\n]*guide openpagerank/);

  await cli(["remove", "bing"], env);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { ahrefs: "ahrefs-key-9876" });
  assert.match((await cli(["status"], env)).stdout, /Bing Webmaster Tools: not set/);

  await assert.rejects(
    cli(["set", "majestic", "x"], env),
    e => e.code === 2 && /bing, openpagerank, ahrefs, matomo, posthog, moz, youtube or clarity/.test(e.stderr),
  );
  await assert.rejects(cli(["set"], env), e => e.code === 2 && /usage/i.test(e.stderr));
});

test("set with no key reads the first line of stdin, so the key never sits in the command line", async () => {
  const home = tmp(),
    env = envFor(home);
  await cliIn(["set", "bing"], env, "piped-key-5555\r\nsecond line\n");
  assert.deepEqual(JSON.parse(readFileSync(join(home, ".seo-supervisor", "keys.json"), "utf8")), {
    bing: "piped-key-5555",
  });
  await assert.rejects(
    cliIn(["set", "ahrefs"], env, ""),
    e => e.code === 2 && /your own terminal, run node connect-keys\.mjs set ahrefs/.test(e.stderr),
  );
});

test("names that only exist on every object, like toString, aren't services", async () => {
  const env = envFor(tmp());
  await assert.rejects(
    cli(["set", "toString", "k-123456"], env),
    e => e.code === 2 && /bing, openpagerank, ahrefs, matomo, posthog, moz, youtube or clarity/.test(e.stderr),
  );
  await assert.rejects(
    cli(["guide", "constructor"], env),
    e => e.code === 2 && /bing, openpagerank, ahrefs, matomo, posthog, moz, youtube or clarity/.test(e.stderr),
  );
});

test("the keys file is replaced in one step (a new file renamed over the old one), never half-written", async () => {
  const home = tmp(),
    env = envFor(home),
    file = join(home, ".seo-supervisor", "keys.json");
  await cli(["set", "bing", "first-key-1111"], env);
  const before = statSync(file, { bigint: true }).ino;
  await cli(["set", "bing", "second-key-2222"], env);
  assert.notEqual(statSync(file, { bigint: true }).ino, before);
  assert.deepEqual(readdirSync(join(home, ".seo-supervisor")), ["keys.json"], "no temp file left behind");
});

test("an environment variable wins over the saved key", async () => {
  const home = tmp(),
    srv = await fake();
  try {
    await cli(["set", "bing", "saved-key-1111"], envFor(home));
    const s = (await cli(["status"], envFor(home, null, { BING_WEBMASTER_KEY: "env-key-2222" }))).stdout;
    assert.match(s, /Bing Webmaster Tools: set \(…2222, from BING_WEBMASTER_KEY/);
    await fetchCli(home, srv, { BING_WEBMASTER_KEY: "env-key-2222" }, ["--yes"]);
    assert.ok(srv.hits.length && srv.hits.every(h => h.query.get("apikey") === "env-key-2222"));
  } finally {
    await srv.close();
  }
});

test("guide says where to get each key, in plain steps", async () => {
  const env = envFor(tmp());
  const bing = (await cli(["guide", "bing"], env)).stdout;
  assert.match(bing, /bing\.com\/webmasters/);
  assert.match(bing, /Search Console/);
  assert.match(bing, /Settings → API Access/);
  assert.match(bing, /Generate API Key/);
  assert.match(bing, /every site/i);
  const opr = (await cli(["guide", "openpagerank"], env)).stdout;
  assert.match(opr, /keywordseverywhere\.com\/openpagerank/);
  assert.match(opr, /1 November 2026/);
  assert.match(opr, /403/);
  const ahrefs = (await cli(["guide", "ahrefs"], env)).stdout;
  assert.match(ahrefs, /Account settings → API keys/);
  assert.match(ahrefs, /Domain Rating by Ahrefs/);
  for (const [id, text] of [
    ["bing", bing],
    ["openpagerank", opr],
    ["ahrefs", ahrefs],
  ]) {
    assert.match(text, new RegExp(`node connect-keys\\.mjs set ${id}(?! <key>)`), `${id}: the no-argument form`);
    assert.match(text, /your own terminal/, id);
  }
});

test("the dry run lists the same domains the real run sends (a site with no domain name, like localhost, is left out)", async () => {
  const home = tmp(),
    srv = await fake();
  try {
    const r = await cli(
      ["fetch", "--site", "http://localhost:3000", "--competitors", "a.com", "--out", join(home, "keys-out.json")],
      envFor(home, srv, { OPENPAGERANK_KEY: "o-key-0002" }),
    );
    assert.match(r.stdout, /1 domain name\(s\) \(a\.com\)/);
  } finally {
    await srv.close();
  }
});

test("fetch without --yes is a dry run: it says what would be sent and sends nothing", async () => {
  const home = tmp(),
    srv = await fake();
  try {
    const r = await fetchCli(home, srv, { BING_WEBMASTER_KEY: "b-key-0001", OPENPAGERANK_KEY: "o-key-0002" }, [
      "--competitors",
      "a.com,b.com",
    ]);
    assert.equal(srv.hits.length, 0);
    assert.match(r.stdout, /dry run/i);
    assert.match(r.stdout, /--yes/);
    assert.match(r.stdout, /https:\/\/www\.example\.com\//);
    assert.match(r.stdout, /example\.com, a\.com, b\.com/);
    assert.match(r.stdout, /Ahrefs[^\n]*not set/);
    assert.equal(existsSync(join(home, "keys-out.json")), false);
  } finally {
    await srv.close();
  }
});

test("Bing: matches the site, then reads traffic, queries, links and crawl issues", async () => {
  const home = tmp(),
    srv = await fake();
  try {
    await fetchCli(home, srv, { BING_WEBMASTER_KEY: "b-key-0001" }, ["--yes"]);
    const calls = srv.hits.map(h => h.method);
    assert.deepEqual(calls, [
      "GetUserSites",
      "GetQueryStats",
      "GetPageStats",
      "GetLinkCounts",
      "GetLinkCounts",
      "GetUrlLinks",
      "GetCrawlIssues",
    ]);
    assert.ok(
      srv.hits.slice(1).every(h => h.query.get("siteUrl") === "https://www.example.com/"),
      "uses Bing's own URL for the site",
    );
    assert.equal(srv.hits.find(h => h.method === "GetUrlLinks").query.get("link"), "https://www.example.com/");

    const o = output(home);
    assert.equal(o.source, "keys");
    assert.equal(o.site, "https://www.example.com/");
    assert.deepEqual(o.bing.traffic, {
      "/pricing": { clicks: 5, impressions: 100 },
      "/": { clicks: 9, impressions: 300 },
    });
    assert.deepEqual(o.bing.queries, [
      { query: "widget repair", clicks: 1, impressions: 400 },
      { query: "blue widgets", clicks: 8, impressions: 150 },
    ]);
    assert.ok(o.bing.period.from < o.bing.period.to);
    assert.deepEqual(o.bing.backlinks.pages, [
      { url: "https://www.example.com/", count: 14 },
      { url: "https://www.example.com/pricing", count: 3 },
    ]);
    assert.deepEqual(o.bing.backlinks.sample, [{ url: "https://blog.example.net/post", anchorText: "Example" }]);
    assert.equal(o.bing.crawlIssues.length, 2);
    assert.deepEqual(o.authority, []);
    assert.equal(o.attribution, null);

    assert.equal(o.findings.length, 1, "a redirect alone isn't a crawl problem");
    const f = o.findings[0];
    assert.deepEqual(
      [f.id, f.check, f.rule, f.severity, f.status, f.source, f.count],
      ["K-001", "bing-crawl-issues", "CRAWL-05", "medium", "open", "bing-webmaster", 1],
    );
    assert.match(f.what, /\/broken \(.*server error.*500/);
    assert.ok(f.why && f.fix && f.category);
    assert.ok(o.notChecked.some(n => /Open PageRank/.test(n.area)) && o.notChecked.some(n => /Ahrefs/.test(n.area)));
  } finally {
    await srv.close();
  }
});

test("Bing: a site that isn't in the account says how to add it, and asks nothing else", async () => {
  const home = tmp(),
    srv = await fake({ bing: { GetUserSites: { d: [{ Url: "https://other.example.org/", IsVerified: true }] } } });
  try {
    await assert.rejects(
      fetchCli(home, srv, { BING_WEBMASTER_KEY: "b-key-0001" }, ["--yes"]),
      e =>
        e.code === 1 &&
        /isn't in your Bing Webmaster Tools account/.test(e.stdout) &&
        /bing\.com\/webmasters/.test(e.stdout),
    );
    assert.deepEqual(
      srv.hits.map(h => h.method),
      ["GetUserSites"],
    );
    assert.equal(output(home).bing, null);
  } finally {
    await srv.close();
  }
});

test("authority: the site and competitors go to Open PageRank and Ahrefs once each, with attribution", async () => {
  const home = tmp(),
    srv = await fake();
  try {
    await fetchCli(home, srv, { OPENPAGERANK_KEY: "o-key-0002", AHREFS_KEY: "a-key-0003" }, [
      "--yes",
      "--competitors",
      " https://www.Rival.com/pricing , b.com,,example.com,unknown.example,b.com,not a domain",
    ]);
    const opr = srv.hits.filter(h => h.route === "opr"),
      ahrefs = srv.hits.filter(h => h.route === "ahrefs");
    assert.equal(opr.length, 1);
    assert.deepEqual(opr[0].query.getAll("domains[]"), ["example.com", "rival.com", "b.com", "unknown.example"]);
    assert.equal(opr[0].headers["api-opr"], "o-key-0002");
    assert.equal(ahrefs.length, 1);
    assert.equal(ahrefs[0].headers.authorization, "Bearer a-key-0003");
    assert.deepEqual(ahrefs[0].body.targets, ["example.com", "rival.com", "b.com", "unknown.example"]);

    const o = output(home);
    assert.deepEqual(o.authority, [
      { domain: "example.com", openPageRank: 5.5, ahrefsDR: 60 },
      { domain: "rival.com", openPageRank: 4.5, ahrefsDR: 50 },
      { domain: "b.com", openPageRank: 3.5, ahrefsDR: 40 },
      { domain: "unknown.example", openPageRank: null, ahrefsDR: 30 },
    ]);
    assert.deepEqual(o.attribution, {
      text: "Domain Rating by Ahrefs",
      url: "https://ahrefs.com/",
      license: "http://ahrefs.com/legal/domain-rating-license",
    });
    assert.ok(
      o.notes.some(n => /not a domain/.test(n)),
      "says which competitor it skipped",
    );
    assert.equal(o.bing, null);
  } finally {
    await srv.close();
  }
});

test("more than 100 domains go to Open PageRank in batches of 100", async () => {
  const home = tmp(),
    srv = await fake();
  try {
    await fetchCli(home, srv, { OPENPAGERANK_KEY: "o-key-0002" }, [
      "--yes",
      "--competitors",
      Array.from({ length: 150 }, (_, i) => `c${i}.com`).join(","),
    ]);
    assert.deepEqual(
      srv.hits.map(h => h.query.getAll("domains[]").length),
      [100, 51],
    );
    assert.equal(output(home).authority.length, 151);
  } finally {
    await srv.close();
  }
});

test("refusals are explained in plain words, the rest still runs, and the exit code is 1", async () => {
  const home = tmp(),
    srv = await fake({
      reply: {
        bing: () => [400, { ErrorCode: 3, Message: "ERROR!!! InvalidApiKey" }],
        opr: () => [403, { status_code: 403, error: "address_error" }],
        ahrefs: () => [429, ["Error", "Too many requests"]],
      },
    });
  try {
    await assert.rejects(
      fetchCli(home, srv, { BING_WEBMASTER_KEY: "b", OPENPAGERANK_KEY: "o", AHREFS_KEY: "a" }, ["--yes"]),
      e => {
        assert.equal(e.code, 1);
        assert.match(e.stdout, /Bing Webmaster Tools didn't accept the key[^\n]*set bing/);
        assert.match(e.stdout, /your IP address isn't the one registered for this key/);
        assert.match(e.stdout, /Ahrefs[^\n]*too many requests/i);
        return true;
      },
    );
    const o = output(home);
    assert.equal(o.notes.length >= 3, true);
    assert.deepEqual(
      o.authority.map(a => [a.openPageRank, a.ahrefsDR]),
      [[null, null]],
    );
  } finally {
    await srv.close();
  }
});

test("a 401 says the key is wrong and where to get a new one", async () => {
  const home = tmp(),
    srv = await fake({ reply: { ahrefs: () => [401, ["Error", "Unauthorized"]] } });
  try {
    await assert.rejects(
      fetchCli(home, srv, { AHREFS_KEY: "a" }, ["--yes"]),
      e => /didn't accept the key \(401\)/.test(e.stdout) && /Account settings → API keys/.test(e.stdout),
    );
  } finally {
    await srv.close();
  }
});

test("fetch without any key set lists Bing, Open PageRank and Ahrefs under Limits, but not analytics tools the site may not use", async () => {
  const home = tmp(),
    srv = await fake();
  try {
    await fetchCli(home, srv, {}, ["--yes"]);
    assert.equal(srv.hits.length, 0);
    const o = output(home);
    assert.equal(o.bing, null);
    assert.equal(o.notChecked.length, 3);
    assert.ok(o.notChecked.every(n => /connect-keys\.mjs guide/.test(n.reason)));
    assert.ok(
      !o.notChecked.some(n => /Matomo|PostHog/.test(n.area)),
      "Matomo and PostHog are listed only when the agent finds them in the site (SKILL.md)",
    );
  } finally {
    await srv.close();
  }
});

test("a broken keys.json is reported, not overwritten", async () => {
  const home = tmp();
  mkdirSync(join(home, ".seo-supervisor"));
  writeFileSync(join(home, ".seo-supervisor", "keys.json"), "{ not json");
  await assert.rejects(
    cli(["set", "bing", "k-123456"], envFor(home)),
    e => e.code === 2 && /keys\.json/.test(e.stderr),
  );
  assert.equal(readFileSync(join(home, ".seo-supervisor", "keys.json"), "utf8"), "{ not json");
});

// ---------- Matomo and PostHog ----------
const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const savedFile = home => JSON.parse(readFileSync(join(home, ".seo-supervisor", "keys.json"), "utf8"));
const MATOMO_ENV = srv => ({
  MATOMO_URL: srv.url + "/matomo/",
  MATOMO_SITE_ID: "3",
  MATOMO_TOKEN_AUTH: "matomo-token-0001",
});
const POSTHOG_ENV = srv => ({
  POSTHOG_HOST: srv.url + "/posthog/",
  POSTHOG_PROJECT_ID: "12345",
  POSTHOG_PERSONAL_API_KEY: "phx_posthog_key_0001",
});

test("set matomo asks for the address and site ID in plain view, then the token, and status hides only the token", async () => {
  const home = tmp(),
    env = envFor(home);
  await cliIn(["set", "matomo"], env, "analytics.example.org/index.php?module=CoreHome\n 3 \nmatomo-token-abcd1234\n");
  assert.deepEqual(savedFile(home), {
    matomo: { url: "https://analytics.example.org/", siteId: "3", key: "matomo-token-abcd1234" },
  });
  const s = (await cli(["status"], env)).stdout;
  assert.match(s, /Matomo: set \(…1234, saved in [^)]+\) for site ID 3 at https:\/\/analytics\.example\.org\//);
  assert.doesNotMatch(s, /matomo-token-abcd1234/);
  // The address and site ID can be options, so only the token is typed.
  await cliIn(
    ["set", "matomo", "--url", "https://stats.example.org/matomo/", "--site-id", "7"],
    env,
    "second-token-5678\n",
  );
  assert.deepEqual(savedFile(home).matomo, {
    url: "https://stats.example.org/matomo/",
    siteId: "7",
    key: "second-token-5678",
  });
  await assert.rejects(
    cliIn(["set", "matomo"], env, "analytics.example.org\nmain site\ntoken-0000\n"),
    e => e.code === 2 && /site ID is a number/.test(e.stderr),
  );
  await assert.rejects(
    cliIn(["set", "matomo"], env, "http://analytics.example.org\n3\ntoken-0000\n"),
    e => e.code === 2 && /https:\/\//.test(e.stderr) && /unencrypted/.test(e.stderr),
  );
  assert.equal(savedFile(home).matomo.key, "second-token-5678", "a refused set changes nothing");
});

test("set posthog takes us, eu or an address, and refuses the project key from the tracking code", async () => {
  const home = tmp(),
    env = envFor(home);
  await cliIn(["set", "posthog"], env, "eu\n12345\nphx_secret_key_9876\n");
  assert.deepEqual(savedFile(home).posthog, {
    host: "https://eu.posthog.com/",
    projectId: "12345",
    key: "phx_secret_key_9876",
  });
  await cliIn(["set", "posthog", "--host", "us.i.posthog.com", "--project-id", "777"], env, "phx_other_key_1111\n");
  assert.equal(
    savedFile(home).posthog.host,
    "https://us.posthog.com/",
    "the tracking code's address becomes the app's",
  );
  await assert.rejects(
    cliIn(["set", "posthog"], env, "us\n12345\nphc_projectkey123\n"),
    e => e.code === 2 && /personal API key/.test(e.stderr) && /phx_/.test(e.stderr),
  );
  const s = (await cli(["status"], env)).stdout;
  assert.match(s, /PostHog: set \(…1111, saved in [^)]+\) for project ID 777 at https:\/\/us\.posthog\.com\//);
  assert.doesNotMatch(s, /phx_other_key_1111/);
});

test("guide matomo and guide posthog say where to find each value, step by step", async () => {
  const env = envFor(tmp());
  const m = (await cli(["guide", "matomo"], env)).stdout;
  for (const re of [
    /Websites → Manage/,
    /Personal → Security/,
    /Auth tokens/,
    /view access/,
    /Channel Type/,
    /node connect-keys\.mjs set matomo(?! <)/,
    /your own terminal/,
  ])
    assert.match(m, re);
  const p = (await cli(["guide", "posthog"], env)).stdout;
  for (const re of [
    /us\.posthog\.com/,
    /eu\.posthog\.com/,
    /Personal API keys/,
    /Query: Read/,
    /phx_/,
    /Project ID/,
    /node connect-keys\.mjs set posthog(?! <)/,
    /your own terminal/,
  ])
    assert.match(p, re);
});

test("Matomo and PostHog dry runs show the exact requests, without the secrets, and send nothing", async () => {
  const home = tmp(),
    srv = await fake();
  try {
    const r = await fetchCli(home, srv, { ...MATOMO_ENV(srv), ...POSTHOG_ENV(srv) }, ["--days", "30"]);
    assert.equal(srv.hits.length, 0);
    const from = day(32),
      to = day(3);
    assert.match(r.stdout, /Matomo: your token \(in the request body, never in the address\) and site ID 3/);
    assert.ok(
      r.stdout.includes(
        `POST ${srv.url}/matomo/index.php?module=API&method=Actions.getEntryPageUrls&idSite=3&period=range&date=${from}%2C${to}&segment=referrerType%3D%3Dsearch`,
      ),
    );
    assert.match(r.stdout, /PostHog: your key and project ID 12345/);
    assert.ok(r.stdout.includes(`POST ${srv.url}/posthog/api/projects/12345/query/`));
    assert.match(r.stdout, /\$channel_type = 'Organic Search'/);
    assert.ok(r.stdout.includes(`'${from}'`) && r.stdout.includes(`'${to}'`));
    for (const s of [
      "method=DevicesDetection.getType",
      "method=UserCountry.getCountry",
      "properties.$device_type",
      "properties.$geoip_country_code",
    ])
      assert.ok(r.stdout.includes(s), `the dry run lists the split: ${s}`);
    assert.doesNotMatch(r.stdout, /matomo-token-0001|phx_posthog_key_0001|token_auth=/);
    assert.equal(existsSync(join(home, "keys-out.json")), false);
    await assert.rejects(fetchCli(home, srv, {}, ["--days", "0"]), e => e.code === 2 && /--days/.test(e.stderr));
  } finally {
    await srv.close();
  }
});

test("Matomo: search-engine visits by landing page for Google Analytics' period, the token only in the POST body", async () => {
  const home = tmp(),
    srv = await fake();
  try {
    const r = await fetchCli(home, srv, MATOMO_ENV(srv), ["--yes"]);
    assert.equal(
      srv.hits.length,
      6,
      "the landing pages, the device, country, channel and search-engine splits, then the visits per day",
    );
    const h = srv.hits[0];
    assert.equal(h.verb, "POST");
    assert.equal(h.path, "/matomo/index.php");
    assert.deepEqual(Object.fromEntries(h.query), {
      module: "API",
      method: "Actions.getEntryPageUrls",
      idSite: "3",
      period: "range",
      date: `${day(92)},${day(3)}`,
      segment: "referrerType==search",
      flat: "1",
      filter_limit: "25000",
      filter_sort_column: "entry_nb_visits",
      filter_sort_order: "desc",
      format: "JSON",
    });
    assert.equal(new URLSearchParams(h.body).get("token_auth"), "matomo-token-0001");
    const o = output(home);
    assert.deepEqual(
      [o.matomo.period, o.matomo.traffic],
      [
        { from: day(92), to: day(3) },
        { "/pricing": { visits: 42 }, "/": { visits: 120 } },
      ],
    );
    assert.equal(o.posthog, null);
    assert.match(r.stdout, /Matomo 2 pages/);
  } finally {
    await srv.close();
  }
});

test("PostHog: organic-search sessions by entry page through the Query API", async () => {
  const home = tmp(),
    srv = await fake();
  try {
    await fetchCli(home, srv, POSTHOG_ENV(srv), ["--yes"]);
    assert.equal(
      srv.hits.length,
      5,
      "the landing pages, the device, country and referrer splits, then the visits per day",
    );
    const h = srv.hits[0];
    assert.equal(h.verb, "POST");
    assert.equal(h.path, "/posthog/api/projects/12345/query/");
    assert.equal(h.headers.authorization, "Bearer phx_posthog_key_0001");
    assert.equal(h.body.query.kind, "HogQLQuery");
    const q = h.body.query.query;
    for (const re of [/FROM sessions/, /\$channel_type = 'Organic Search'/, /\$entry_pathname/, /LIMIT 25000/])
      assert.match(q, re);
    assert.ok(q.includes(`'${day(92)}'`) && q.includes(`'${day(3)}'`));
    const o = output(home).posthog;
    assert.deepEqual(
      [o.period, o.traffic],
      [
        { from: day(92), to: day(3) },
        { "/pricing": { visits: 40 }, "/": { visits: 120 } },
      ],
    );
  } finally {
    await srv.close();
  }
});

const both = srv => ({
  matomo: { key: "matomo-token-0001", url: srv.url + "/matomo/", siteId: "3" },
  posthog: { key: "phx_posthog_key_0001", host: srv.url + "/posthog/", projectId: "12345" },
});
test("Matomo and PostHog refusals say what to fix: the token or key, the site or project ID, the address", async () => {
  const cases = [
    [
      () => [
        401,
        {
          result: "error",
          message: "Unable to authenticate with the provided token. It is either invalid or expired.",
        },
      ],
      /^Matomo didn't accept the token[^\n]*set matomo/,
      () => [
        401,
        {
          type: "authentication_error",
          code: "authentication_failed",
          detail: "Personal API key found in request Authorization header is invalid.",
        },
      ],
      /^PostHog didn't accept the key[^\n]*other PostHog region/,
    ],
    [
      () => [
        200,
        {
          result: "error",
          message: "You can't access this resource as it requires 'view' access for the website id = 3.",
        },
      ],
      /^Matomo[^\n]*site ID[^\n]*Websites → Manage/,
      () => [
        403,
        { type: "authentication_error", code: "permission_denied", detail: "You don't have access to the project." },
      ],
      /^PostHog[^\n]*project ID[^\n]*Settings → Project/,
    ],
    [
      () => [
        200,
        {
          result: "error",
          message:
            "The Segment you requested has not yet been created in the Segment Editor and so the report data has not been pre-processed.",
        },
      ],
      /^Matomo[^\n]*segment[^\n]*Channel Type/,
      () => [
        403,
        {
          type: "authentication_error",
          code: "permission_denied",
          detail: "API key missing required scope 'query:read'",
        },
      ],
      /^PostHog[^\n]*Query Read/,
    ],
    [
      () => [200, "<!doctype html><title>Example</title>"],
      /^Matomo: 127\.0\.0\.1:\d+ didn't answer like Matomo/,
      () => [404, "<!doctype html><h1>Not found</h1>"],
      /^PostHog: 127\.0\.0\.1:\d+ didn't answer like PostHog/,
    ],
    [
      () => [301, "", { location: "https://matomo.example.org/" }],
      /^Matomo[^\n]*on to https:\/\/matomo\.example\.org\//,
      () => [308, "", { location: "https://eu.posthog.com/api/projects/12345/query/" }],
      /^PostHog[^\n]*on to https:\/\/eu\.posthog\.com\//,
    ],
  ];
  for (const [matomo, mRe, posthog, pRe] of cases) {
    const srv = await fake({ reply: { matomo, posthog } });
    try {
      const { result, problems } = await fetchKeys({ site: SITE, keys: both(srv) });
      assert.equal(problems.length, 2);
      assert.match(problems[0], mRe);
      assert.match(problems[1], pRe);
      assert.equal(srv.hits.length, 2, "a redirect isn't followed");
      assert.ok(problems.every(p => !/matomo-token-0001|phx_posthog_key_0001/.test(p)));
      assert.equal(result.matomo, null);
      assert.equal(result.posthog, null);
      assert.ok(result.notChecked.some(n => /^Matomo/.test(n.area) && n.reason === problems[0]));
    } finally {
      await srv.close();
    }
  }
});

test("Matomo and PostHog device and country splits are fetched and drawn as one line each, escaped", async () => {
  const home = tmp(),
    srv = await fake();
  try {
    await fetchCli(home, srv, { ...MATOMO_ENV(srv), ...POSTHOG_ENV(srv) }, ["--yes"]);
    const m = srv.hits.filter(h => h.route === "matomo"),
      p = srv.hits.filter(h => h.route === "posthog");
    assert.deepEqual(
      m.map(h => h.query.get("method")),
      [
        "Actions.getEntryPageUrls",
        "DevicesDetection.getType",
        "UserCountry.getCountry",
        "Referrers.getReferrerType",
        "Referrers.getSearchEngines",
        "VisitsSummary.get",
      ],
    );
    for (const h of m) {
      // Every channel is read without the search segment (connections.test.mjs covers it).
      assert.deepEqual(
        [h.verb, h.query.get("segment"), h.query.get("date"), h.query.has("token_auth")],
        [
          "POST",
          h.query.get("method") === "Referrers.getReferrerType" ? null : "referrerType==search",
          `${day(92)},${day(3)}`,
          false,
        ],
      );
      assert.equal(new URLSearchParams(h.body).get("token_auth"), "matomo-token-0001");
    }
    assert.equal(p.length, 5);
    for (const [h, prop] of [
      [p[1], "properties.$device_type"],
      [p[2], "properties.$geoip_country_code"],
    ]) {
      const q = h.body.query.query;
      assert.equal(h.headers.authorization, "Bearer phx_posthog_key_0001");
      for (const s of [
        prop,
        "FROM events",
        "session.$channel_type = 'Organic Search'",
        "count(DISTINCT $session_id)",
        `'${day(92)}'`,
        `'${day(3)}'`,
      ])
        assert.ok(q.includes(s), `${prop}: ${s}`);
    }

    const o = output(home);
    assert.deepEqual(
      o.matomo.byDevice,
      { Desktop: { visits: 120 }, Smartphone: { visits: 40 }, [XSS]: { visits: 2 } },
      "no zero rows",
    );
    assert.deepEqual(
      Object.keys(o.matomo.byCountry),
      COUNTRIES.slice(0, 10).map(c => c.toUpperCase()),
      "the top 10 countries, not Matomo's Unknown (xx)",
    );
    assert.deepEqual(
      o.posthog.byDevice,
      { Desktop: { visits: 30 }, Mobile: { visits: 12 } },
      "this site's sessions only",
    );
    assert.deepEqual(o.posthog.byCountry, { US: { visits: 20 }, DE: { visits: 4 } });

    // The audit JSON carries connect-keys' matomo and posthog as is (report-format.md).
    const dir = tmp(),
      audit = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
    Object.assign(audit, { matomo: o.matomo, posthog: o.posthog });
    writeFileSync(join(dir, "a.json"), JSON.stringify(audit));
    await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
    const html = readFileSync(join(dir, "r.html"), "utf8"),
      md = readFileSync(join(dir, "r.md"), "utf8"),
      when = ` (${day(92)} to ${day(3)})`;
    const lines = [
      `Matomo organic visits by device: desktop 120 · smartphone 40 · ${XSS} 2${when}`,
      `Matomo organic visits by country: US 100 · DE 99 · GB 98 · FR 97 · IN 96 · BR 95 · CA 94 · AU 93 · NL 92 · ES 91${when}`,
      `PostHog organic visits by device: desktop 30 · mobile 12${when}`,
      `PostHog organic visits by country: US 20 · DE 4${when}`,
    ];
    for (const l of lines) {
      assert.ok(
        html.includes(`<p class="quiet">${l.replace(XSS, "&lt;img src=x onerror=alert(1)&gt;")}</p>`),
        `HTML: ${l}`,
      );
      assert.ok(md.includes(`\n${l.replace(XSS, "\\<img src=x onerror=alert(1)\\>")}\n`), `Markdown: ${l}`);
    }
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(md, /(^|[^\\])<img src=x/m);
  } finally {
    await srv.close();
  }

  // A split Matomo can't give (its UserCountry plugin is off) is noted; the landing pages and the other split stay.
  const off = await fake({
    reply: {
      matomo: req => [
        200,
        /UserCountry/.test(req.url)
          ? { result: "error", message: "The plugin UserCountry is not activated." }
          : MATOMO_SPLITS[new URL(req.url, "http://x").searchParams.get("method")] || MATOMO_ROWS,
      ],
    },
  });
  try {
    const { result, problems } = await fetchKeys({ site: SITE, keys: { matomo: both(off).matomo } });
    assert.deepEqual(problems, []);
    assert.deepEqual(
      [Object.keys(result.matomo.traffic), Object.keys(result.matomo.byDevice), result.matomo.byCountry],
      [["/pricing", "/"], ["Desktop", "Smartphone", XSS], undefined],
    );
    assert.ok(
      result.notes.some(n =>
        /^Matomo's visits from search engines by country weren't read: Matomo said: The plugin UserCountry/.test(n),
      ),
    );
  } finally {
    await off.close();
  }
});

test("submit-bing is a dry run without --yes, stays within the quota and refuses other sites' URLs", async () => {
  const home = tmp(),
    dir = tmp(),
    urls = join(dir, "urls.txt"),
    diff = join(dir, "seo-diff.json"),
    KEY = { BING_WEBMASTER_KEY: "b-key-0001" };
  writeFileSync(
    urls,
    [
      "# changed pages",
      "/pricing",
      "https://www.example.com/about#team",
      "https://elsewhere.example.net/x",
      "http://www.example.com/old",
      "//elsewhere.example.net/y",
      "/pricing",
      ...Array.from({ length: 700 }, (_, i) => `/p${i}`),
    ].join("\n"),
  );
  writeFileSync(
    diff,
    JSON.stringify({
      regressions: [
        { path: "/gone", kind: "status-error" },
        { path: "/blog/", kind: "title-changed" },
      ],
      improvements: [],
      changed: [],
      added: ["/new"],
      removed: ["/removed"],
    }),
  );
  const quota = (daily, extra = {}) =>
    fake({
      bing: {
        ...BING,
        GetUrlSubmissionQuota: {
          d: { __type: "UrlSubmissionQuota:#Microsoft.Bing.Webmaster.Api", DailyQuota: daily, MonthlyQuota: 9000 },
        },
        SubmitUrlBatch: { d: null },
        ...extra,
      },
    });
  const submit = (srv, args, env = KEY) => cli(["submit-bing", "--site", SITE, ...args], envFor(home, srv, env));
  let srv = await quota(600);
  try {
    const dry = await submit(srv, ["--from-diff", diff]);
    assert.equal(srv.hits.length, 0, "a dry run sends nothing, not even the quota request");
    for (const re of [
      /dry run/i,
      /--yes/,
      /IndexNow/,
      /https:\/\/www\.example\.com\/blog\//,
      /https:\/\/www\.example\.com\/new/,
      /quota/,
    ])
      assert.match(dry.stdout, re);
    assert.doesNotMatch(dry.stdout, /\/gone|\/removed|b-key-0001/);

    const r = await submit(srv, ["--urls", urls, "--yes"]);
    assert.deepEqual(
      srv.hits.map(h => h.method),
      ["GetUserSites", "GetUrlSubmissionQuota", "SubmitUrlBatch", "SubmitUrlBatch"],
    );
    const sends = srv.hits.filter(h => h.method === "SubmitUrlBatch");
    assert.ok(
      sends.every(
        h =>
          h.verb === "POST" && h.body.siteUrl === "https://www.example.com/" && h.query.get("apikey") === "b-key-0001",
      ),
      "Bing's own URL for the site, the key as Bing takes it",
    );
    assert.deepEqual(
      sends.map(h => h.body.urlList.length),
      [500, 100],
      "at most 500 a request, and no more than the quota",
    );
    const sent = sends.flatMap(h => h.body.urlList);
    assert.deepEqual(sent.slice(0, 3), [
      "https://www.example.com/pricing",
      "https://www.example.com/about",
      "https://www.example.com/p0",
    ]);
    assert.ok(sent.every(u => u.startsWith("https://www.example.com/")));
    for (const re of [
      /left out 3 URL\(s\)[^\n]*https:\/\/www\.example\.com/,
      /600 URL\(s\) today/,
      /submitted 600 URL\(s\)/,
      /102 URL\(s\) didn't fit/,
    ])
      assert.match(r.stdout, re);
    assert.doesNotMatch(r.stdout + r.stderr, /b-key-0001/);
    await srv.close();

    srv = await quota(0);
    await assert.rejects(submit(srv, ["--urls", urls, "--yes"]), e => e.code === 1 && /used up/.test(e.stdout));
    assert.ok(!srv.hits.some(h => h.method === "SubmitUrlBatch"));
    await srv.close();

    srv = await quota(10, { SubmitUrlBatch: () => [400, { ErrorCode: 7, Message: "ERROR!!! InvalidUrl" }] });
    await assert.rejects(
      submit(srv, ["--urls", urls, "--yes"]),
      e => e.code === 1 && /refused a URL \(InvalidUrl\)/.test(e.stdout) && !/b-key-0001/.test(e.stdout + e.stderr),
    );
    await assert.rejects(
      submit(srv, ["--urls", urls], {}),
      e => e.code === 2 && /guide bing/.test(e.stderr),
      "no key: says how to connect Bing",
    );
  } finally {
    await srv.close();
  }
});

test("submit-bing --from-diff leaves out robots.txt and pages whose links or sitemap listing changed but not the page", async () => {
  const home = tmp(),
    diff = join(tmp(), "seo-diff.json");
  writeFileSync(
    diff,
    JSON.stringify({
      regressions: [
        { path: "/a/", kind: "lost-internal-links" },
        { path: "/b/", kind: "left-sitemap" },
        { path: "/c/", kind: "content-shrunk" },
      ],
      improvements: [
        { path: "/d/", kind: "joined-sitemap" },
        { path: "/e/", kind: "status-fixed" },
      ],
      changed: [
        { path: "/robots.txt", kind: "robots-changed" },
        { path: "/g/", kind: "redirect-changed" },
      ],
      added: ["/new/"],
    }),
  );
  const srv = await fake({ bing: BING });
  try {
    const dry = await cli(
      ["submit-bing", "--site", SITE, "--from-diff", diff],
      envFor(home, srv, { BING_WEBMASTER_KEY: "b-key-0001" }),
    );
    assert.deepEqual(
      dry.stdout.match(/^ {2}https:\S+/gm).map(u => u.trim()),
      ["/c/", "/e/", "/g/", "/new/"].map(p => SITE + p),
    );
  } finally {
    await srv.close();
  }
});

test("a Matomo or PostHog server that can't be reached says to check the address", async () => {
  const gone = await serve(tmp());
  await gone.close();
  const { problems } = await fetchKeys({ site: SITE, keys: both(gone) });
  assert.match(problems[0], /^Matomo: couldn't reach 127\.0\.0\.1:\d+[^\n]*address/);
  assert.match(problems[1], /^PostHog: couldn't reach 127\.0\.0\.1:\d+[^\n]*address/);
});
