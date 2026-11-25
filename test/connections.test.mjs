import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import { fetchKeys } from "../skills/seo-supervisor/scripts/connect-keys.mjs";
import { lookupDomains } from "../skills/seo-supervisor/scripts/rdap.mjs";
import { fetchGoogle } from "../skills/seo-supervisor/scripts/google.mjs";

const KEYS = join(SCRIPTS, "connect-keys.mjs"),
  RDAP = join(SCRIPTS, "rdap.mjs"),
  GSC = join(SCRIPTS, "gsc-import.mjs");
const SITE = "https://www.example.com";
const XSS = "<img src=x onerror=alert(1)>";
const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// One local server for every outside service. routes: "/first-segment" -> (hit) => [status, json or string, headers?].
async function fake(routes) {
  const hits = [];
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
        body = raw && /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw) : raw;
      } catch {}
      const hit = {
        verb: req.method,
        path: decodeURIComponent(u.pathname),
        query: u.searchParams,
        headers: req.headers,
        body,
      };
      hits.push(hit);
      const [status, x, headers = {}] = routes[seg]?.(hit) || [404, { error: "no fake route" }];
      res
        .writeHead(status, {
          "content-type": typeof x === "string" ? "text/html" : "application/json",
          connection: "close",
          ...headers,
        })
        .end(typeof x === "string" ? x : JSON.stringify(x));
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
// A temp home and no real keys from the developer's machine.
const envFor = (home, extra = {}) => ({
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
  ...extra,
});
const cli = (script, args, env) => node([script, ...args], { env });

// ---------- Moz ----------
const mozRoute = ({ body }) => {
  const q = body.params.data.site_query.query;
  return [
    200,
    {
      jsonrpc: "2.0",
      id: body.id,
      result: {
        site_query: { query: `https://${q}`, scope: "domain" },
        site_metrics: {
          domain_authority: q === "example.com" ? 45 : 30,
          page_authority: 40,
          spam_score: q === "example.com" ? 2 : -1,
          root_domains_to_root_domain: 1234,
          external_pages_to_root_domain: 56789,
        },
      },
    },
  ];
};

test("Moz: one JSON-RPC data.site.metrics.fetch per domain, the token in x-moz-token, at most 10 domains a run", async () => {
  const srv = await fake({ "/moz": mozRoute });
  try {
    const competitors = Array.from({ length: 11 }, (_, i) => `c${i}.com`);
    const { result, problems } = await fetchKeys({
      site: SITE,
      competitors,
      keys: { moz: { key: "moz-token-0001" } },
      endpoints: { moz: srv.url + "/moz" },
    });
    assert.deepEqual(problems, []);
    assert.equal(srv.hits.length, 10, "the free plan has 50 rows a month, one per domain");
    const h = srv.hits[0];
    assert.equal(h.verb, "POST");
    assert.equal(h.headers["x-moz-token"], "moz-token-0001");
    assert.equal(h.body.jsonrpc, "2.0");
    assert.equal(h.body.method, "data.site.metrics.fetch");
    assert.ok(h.body.id.length >= 24, "Moz wants an id of 24 characters or more");
    assert.deepEqual(h.body.params, { data: { site_query: { query: "example.com", scope: "domain" } } });
    assert.deepEqual(result.moz[0], {
      domain: "example.com",
      domainAuthority: 45,
      spamScore: 2,
      linkingDomains: 1234,
      inboundLinks: 56789,
    });
    assert.equal(result.moz[1].spamScore, null, "-1 means Moz has no Spam Score");
    assert.ok(
      result.notes.some(n => /Moz/.test(n) && /first 10/.test(n)),
      result.notes.join("\n"),
    );
  } finally {
    await srv.close();
  }
});

test("Moz: a used-up month says so plainly, and an unset Moz key isn't listed under Limits", async () => {
  const srv = await fake({
    "/moz": () => [
      403,
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32670, status: 403, message: "Insufficient quota", data: { issue: "insufficient-quota" } },
      },
    ],
  });
  try {
    const { result, problems } = await fetchKeys({
      site: SITE,
      keys: { moz: { key: "moz-token-0001" } },
      endpoints: { moz: srv.url + "/moz" },
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^Moz[^\n]*rows[^\n]*month/);
    assert.deepEqual(result.moz, []);
    const none = await fetchKeys({ site: SITE, keys: {} });
    assert.ok(
      !none.result.notChecked.some(n => /Moz|YouTube/.test(n.area)),
      "optional extras, like Matomo and PostHog",
    );
  } finally {
    await srv.close();
  }
});

// ---------- YouTube ----------
const CHANNEL = "UCabcdefghijklmnopqrstuv";
const ytRoute = ({ path, query }) => {
  if (path.endsWith("/channels"))
    return [
      200,
      {
        items:
          query.get("forHandle") === "@nobody"
            ? []
            : [
                {
                  id: CHANNEL,
                  snippet: { title: "Example Co" },
                  statistics: {
                    viewCount: "300000",
                    subscriberCount: "1200",
                    hiddenSubscriberCount: false,
                    videoCount: "45",
                  },
                },
              ],
      },
    ];
  if (path.endsWith("/search"))
    return [
      200,
      {
        items: [
          {
            id: { kind: "youtube#video", videoId: "vid1" },
            snippet: {
              title: `How to fix widgets ${XSS}`,
              channelId: CHANNEL,
              channelTitle: "Example Co",
              publishedAt: "2026-01-02T03:04:05Z",
            },
          },
          {
            id: { kind: "youtube#video", videoId: "vid2" },
            snippet: {
              title: "Widgets explained",
              channelId: "UCother",
              channelTitle: "Other",
              publishedAt: "2025-06-01T00:00:00Z",
            },
          },
          { id: { kind: "youtube#channel", channelId: "UCx" }, snippet: { title: "a channel" } },
        ],
      },
    ];
};

test("YouTube: the channel by handle and the top videos per topic, with the key only in a header, at most 5 topics", async () => {
  const srv = await fake({ "/yt": ytRoute });
  try {
    const topics = ["widgets", "widget repair", "a", "b", "c", "d"];
    const { result, problems } = await fetchKeys({
      site: SITE,
      keys: { youtube: { key: "yt-key-0001" } },
      endpoints: { youtube: srv.url + "/yt" },
      topics,
      channel: "@example",
    });
    assert.deepEqual(problems, []);
    const ch = srv.hits[0];
    assert.equal(ch.path, "/yt/channels");
    // The key goes in the X-Goog-Api-Key header, not the address.
    assert.deepEqual(
      [ch.query.get("part"), ch.query.get("forHandle"), ch.query.get("key"), ch.headers["x-goog-api-key"]],
      ["snippet,statistics", "@example", null, "yt-key-0001"],
    );
    const searches = srv.hits.filter(h => h.path === "/yt/search");
    assert.equal(searches.length, 5, "search.list has 100 calls a day");
    assert.deepEqual(
      ["part", "type", "maxResults", "q"].map(k => searches[0].query.get(k)),
      ["snippet", "video", "10", "widgets"],
    );
    assert.deepEqual(result.youtube.channel, {
      id: CHANNEL,
      title: "Example Co",
      subscribers: 1200,
      videos: 45,
      views: 300000,
    });
    assert.deepEqual(result.youtube.topics[0], {
      topic: "widgets",
      videos: [
        {
          id: "vid1",
          url: "https://www.youtube.com/watch?v=vid1",
          title: `How to fix widgets ${XSS}`,
          channel: "Example Co",
          published: "2026-01-02",
          own: true,
        },
        {
          id: "vid2",
          url: "https://www.youtube.com/watch?v=vid2",
          title: "Widgets explained",
          channel: "Other",
          published: "2025-06-01",
          own: false,
        },
      ],
    });
    assert.ok(
      result.notes.some(n => /YouTube/.test(n) && /first 5/.test(n)),
      result.notes.join("\n"),
    );
    // A channel ID goes as id=, not forHandle=.
    srv.hits.length = 0;
    await fetchKeys({
      site: SITE,
      keys: { youtube: { key: "yt-key-0001" } },
      endpoints: { youtube: srv.url + "/yt" },
      channel: CHANNEL,
    });
    assert.equal(srv.hits[0].query.get("id"), CHANNEL);
  } finally {
    await srv.close();
  }
});

test("YouTube: nothing is asked without topics or a channel; a used-up quota and an unknown channel are explained", async () => {
  const srv = await fake({ "/yt": ytRoute });
  try {
    const none = await fetchKeys({
      site: SITE,
      keys: { youtube: { key: "yt-key-0001" } },
      endpoints: { youtube: srv.url + "/yt" },
    });
    assert.equal(srv.hits.length, 0);
    assert.equal(none.result.youtube, null);
    assert.ok(
      none.result.notes.some(n => /--topics/.test(n)),
      none.result.notes.join("\n"),
    );
    const missing = await fetchKeys({
      site: SITE,
      keys: { youtube: { key: "yt-key-0001" } },
      endpoints: { youtube: srv.url + "/yt" },
      channel: "@nobody",
    });
    assert.equal(missing.result.youtube.channel, null);
    assert.ok(missing.result.notes.some(n => /@nobody/.test(n)));
  } finally {
    await srv.close();
  }
  const busy = await fake({
    "/yt": () => [
      403,
      {
        error: {
          code: 403,
          message: "The request cannot be completed because you have exceeded your quota.",
          errors: [{ reason: "quotaExceeded", domain: "youtube.quota" }],
        },
      },
    ],
  });
  try {
    const { problems } = await fetchKeys({
      site: SITE,
      keys: { youtube: { key: "yt-key-0001" } },
      endpoints: { youtube: busy.url + "/yt" },
      topics: ["widgets"],
    });
    assert.match(problems[0], /^YouTube[^\n]*quota[^\n]*100/);
    assert.ok(!problems[0].includes("yt-key-0001"));
  } finally {
    await busy.close();
  }
});

test("set, guide and status know Moz and YouTube; the dry run names the topics and never the key", async () => {
  const home = tmp(),
    srv = await fake({});
  try {
    const env = envFor(home, { MOZ_ENDPOINT: srv.url + "/moz", YOUTUBE_ENDPOINT: srv.url + "/yt" });
    await node([KEYS, "set", "moz", "moz-token-abcd1234"], { env });
    await node([KEYS, "set", "youtube", "yt-key-wxyz9876"], { env });
    const s = (await cli(KEYS, ["status"], env)).stdout;
    assert.match(s, /Moz: set \(…1234/);
    assert.match(s, /YouTube Data API: set \(…9876/);
    const moz = (await cli(KEYS, ["guide", "moz"], env)).stdout;
    for (const re of [
      /moz\.com\/api\/dashboard/,
      /50 rows/,
      /separate/i,
      /node connect-keys\.mjs set moz(?! <)/,
      /your own terminal/,
    ])
      assert.match(moz, re);
    const yt = (await cli(KEYS, ["guide", "youtube"], env)).stdout;
    for (const re of [
      /console\.cloud\.google\.com/,
      /YouTube Data API v3/,
      /API key/,
      /100 searches a day/,
      /node connect-keys\.mjs set youtube(?! <)/,
    ])
      assert.match(yt, re);
    await assert.rejects(
      cli(KEYS, ["set", "nope", "x"], env),
      e =>
        e.code === 2 &&
        /bing, openpagerank, ahrefs, matomo, posthog, moz, youtube, clarity, perplexity, openai, googleplaces, dataforseo or semrush/.test(
          e.stderr,
        ),
    );
    const r = await cli(
      KEYS,
      [
        "fetch",
        "--site",
        SITE,
        "--competitors",
        "rival.com",
        "--topics",
        "widgets, widget repair",
        "--youtube-channel",
        "@example",
        "--out",
        join(home, "k.json"),
      ],
      env,
    );
    assert.equal(srv.hits.length, 0);
    assert.match(r.stdout, /Moz: 2 domain name\(s\) \(example\.com, rival\.com\)/);
    assert.match(
      r.stdout,
      /YouTube Data API: your key, 2 topic search\(es\) \(widgets, widget repair\) and the channel @example/,
    );
    assert.doesNotMatch(r.stdout, /moz-token-abcd1234|yt-key-wxyz9876/);
  } finally {
    await srv.close();
  }
});

// ---------- RDAP ----------
const rdapDomain = (name, registrar) => ({
  objectClassName: "domain",
  ldhName: name.toUpperCase(),
  events: [
    { eventAction: "registration", eventDate: "2004-05-12T10:00:00Z" },
    { eventAction: "expiration", eventDate: "2027-05-12T10:00:00Z" },
    { eventAction: "last changed", eventDate: "2026-01-01T00:00:00Z" },
  ],
  entities: [
    {
      objectClassName: "entity",
      roles: ["technical"],
      vcardArray: ["vcard", [["fn", {}, "text", "Not the registrar"]]],
    },
    {
      objectClassName: "entity",
      roles: ["registrar"],
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", registrar],
        ],
      ],
    },
  ],
});
async function rdapServer() {
  let srv;
  srv = await fake({
    "/iana": () => [
      200,
      {
        version: "1.0",
        publication: "2026-11-01T00:00:00Z",
        services: [
          [["com", "net"], [srv.url + "/com/"]],
          [["uk"], [srv.url + "/uk/"]],
          [["co.example"], [srv.url + "/deeper/"]],
        ],
      },
    ],
    "/com": ({ path }) =>
      path.endsWith("/missing.com")
        ? [404, { errorCode: 404 }]
        : [200, rdapDomain(path.split("/").pop(), path.includes("rival") ? XSS : "Example Registrar, Inc.")],
    "/uk": ({ path }) =>
      path.endsWith("/example.co.uk")
        ? [200, rdapDomain("example.co.uk", "Nominet Registrar")]
        : [404, { errorCode: 404 }],
    "/deeper": ({ path }) => [200, rdapDomain(path.split("/").pop(), "Deeper Registrar")],
  });
  return srv;
}

test("RDAP: the server comes from IANA's bootstrap by the longest label match; a subdomain falls back to its parent", async () => {
  const srv = await rdapServer();
  try {
    const r = await lookupDomains({
      domains: ["example.com", "shop.example.co.uk", "a.co.example", "missing.com", "example.zz"],
      bootstrap: srv.url + "/iana",
    });
    assert.deepEqual(r.domainAge[0], {
      domain: "example.com",
      registered: "2004-05-12",
      expires: "2027-05-12",
      registrar: "Example Registrar, Inc.",
      server: new URL(srv.url).host,
    });
    assert.equal(r.domainAge[1].domain, "example.co.uk", "shop.example.co.uk isn't registered; its parent is");
    assert.equal(r.domainAge[1].registrar, "Nominet Registrar");
    assert.equal(r.domainAge[2].registrar, "Deeper Registrar", "co.example beats a shorter match");
    assert.equal(r.domainAge.length, 3);
    assert.ok(
      r.notes.some(n => /missing\.com/.test(n)) && r.notes.some(n => /example\.zz/.test(n) && /IANA/.test(n)),
      r.notes.join("\n"),
    );
    const iana = srv.hits.filter(h => h.path === "/iana");
    assert.equal(iana.length, 1, "the bootstrap file is read once a run");
    const h = srv.hits.find(x => x.path === "/com/domain/example.com");
    assert.match(h.headers.accept, /application\/rdap\+json/);
    assert.ok(!srv.hits.some(x => x.path.startsWith("/uk/domain/co.uk")), "never asks for the public suffix itself");
  } finally {
    await srv.close();
  }
});

test("rdap.mjs is a dry run without --yes, then writes domainAge for the site and its competitors", async () => {
  const srv = await rdapServer(),
    dir = tmp(),
    out = join(dir, "rdap.json");
  try {
    const env = { ...process.env, RDAP_BOOTSTRAP: srv.url + "/iana" };
    const dry = await node([RDAP, "--site", SITE, "--competitors", "rival.com,not a domain", "--out", out], { env });
    assert.equal(srv.hits.length, 0);
    assert.match(dry.stdout, /dry run/i);
    assert.match(dry.stdout, /example\.com, rival\.com/);
    assert.match(dry.stdout, /data\.iana\.org|127\.0\.0\.1/);
    assert.equal(existsSync(out), false);
    await node([RDAP, "--site", SITE, "--competitors", "rival.com", "--out", out, "--yes"], { env });
    const o = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(o.source, "rdap");
    assert.deepEqual(
      o.domainAge.map(d => d.domain),
      ["example.com", "rival.com"],
    );
    await assert.rejects(node([RDAP, "--site", "nope"], { env }), e => e.code === 2 && /--site/.test(e.stderr));
  } finally {
    await srv.close();
  }
});

// ---------- Matomo ----------
const MATOMO = {
  "Actions.getEntryPageUrls": [{ url: "https://www.example.com/pricing", entry_nb_visits: 40 }],
  "DevicesDetection.getType": [{ label: "Desktop", nb_visits: 30 }],
  "UserCountry.getCountry": [{ label: "Germany", code: "de", nb_visits: 20 }],
  "Referrers.getReferrerType": [
    { label: "Search Engines", nb_visits: 300 },
    { label: "Direct Entry", nb_visits: 200 },
    { label: XSS, nb_visits: 3 },
  ],
  "Referrers.getSearchEngines": [
    { label: "Google", nb_visits: 250 },
    { label: "Bing", nb_visits: 40 },
  ],
  "VisitsSummary.get": { [day(4)]: { nb_visits: 7, nb_actions: 20 }, [day(3)]: [] },
  "API.getMatomoVersion": { value: "5.2.1" },
};
const matomoKey = srv => ({ key: "matomo-token-0001", url: srv.url + "/matomo/", siteId: "3" });
const matomoRoute = ({ query }) => [200, MATOMO[query.get("method")] ?? { result: "error", message: "unknown method" }];

test("Matomo: visits by channel (all visits), by search engine, and search visits per day", async () => {
  const srv = await fake({ "/matomo": matomoRoute });
  try {
    const { result, problems } = await fetchKeys({ site: SITE, keys: { matomo: matomoKey(srv) }, days: 30 });
    assert.deepEqual(problems, []);
    const by = m => srv.hits.find(h => h.query.get("method") === m).query;
    assert.equal(by("Referrers.getReferrerType").get("segment"), null, "every channel, not only search");
    assert.equal(by("Referrers.getSearchEngines").get("segment"), "referrerType==search");
    assert.deepEqual(
      [
        by("VisitsSummary.get").get("period"),
        by("VisitsSummary.get").get("date"),
        by("VisitsSummary.get").get("segment"),
      ],
      ["day", `${day(32)},${day(3)}`, "referrerType==search"],
    );
    assert.ok(
      srv.hits.every(
        h => !h.query.has("token_auth") && new URLSearchParams(h.body).get("token_auth") === "matomo-token-0001",
      ),
    );
    assert.deepEqual(result.matomo.byChannel, {
      "Search Engines": { visits: 300 },
      "Direct Entry": { visits: 200 },
      [XSS]: { visits: 3 },
    });
    assert.deepEqual(result.matomo.byEngine, { Google: { visits: 250 }, Bing: { visits: 40 } });
    assert.deepEqual(result.matomo.daily, { [day(4)]: 7, [day(3)]: 0 });
  } finally {
    await srv.close();
  }
});

test("guide matomo says why its numbers differ from Google Analytics", async () => {
  const g = (await cli(KEYS, ["guide", "matomo"], envFor(tmp()))).stdout;
  for (const re of [/Google Analytics/, /consent/i, /sampl/i, /bots/i, /trends/i]) assert.match(g, re);
});

// ---------- PostHog ----------
// Answers by what the HogQL query asks for.
const posthogRoute =
  (over = {}) =>
  ({ body }) => {
    const q = body.query.query;
    for (const [re, reply] of Object.entries(over)) if (new RegExp(re).test(q)) return reply(q);
    if (/count\(\) FROM events WHERE event = '\$pageview' AND timestamp > now\(\)/.test(q))
      return [200, { results: [[4512]] }];
    if (/AS pageviews/.test(q))
      return [
        200,
        {
          results: [
            ["example.com", day(4), 12, 9],
            ["elsewhere.example.net", day(4), 99, 99],
            ["example.com", day(3), 5, 4],
          ],
        },
      ];
    if (/AS k/.test(q) && /\$entry_referring_domain AS k/.test(q))
      return [
        200,
        {
          results: [
            ["example.com", "www.google.com", 50],
            ["example.com", "$direct", 30],
            ["example.com", XSS, 2],
            ["elsewhere.example.net", "bing.com", 9],
          ],
        },
      ];
    if (/AS k/.test(q)) return [200, { results: [["example.com", "Desktop", 3]] }];
    return [200, { results: [["example.com", "/pricing", 40]] }];
  };
const posthogKey = srv => ({ key: "phx_posthog_key_0001", host: srv.url + "/posthog/", projectId: "12345" });

test("PostHog: visits by referrer (all sessions), and organic pageviews and visitors per day", async () => {
  const srv = await fake({ "/posthog": posthogRoute() });
  try {
    const { result, problems } = await fetchKeys({ site: SITE, keys: { posthog: posthogKey(srv) } });
    assert.deepEqual(problems, []);
    const qs = srv.hits.map(h => h.body.query.query);
    const ref = qs.find(q => /\$entry_referring_domain AS k/.test(q));
    assert.ok(/FROM sessions/.test(ref) && !/channel_type/.test(ref), "every session, not only search");
    const daily = qs.find(q => /AS pageviews/.test(q));
    for (const s of [
      "FROM events",
      "event = '$pageview'",
      "session.$channel_type = 'Organic Search'",
      "count(DISTINCT distinct_id) AS visitors",
      `'${day(92)}'`,
    ])
      assert.ok(daily.includes(s), s);
    assert.deepEqual(result.posthog.byReferrer, {
      "www.google.com": { visits: 50 },
      $direct: { visits: 30 },
      [XSS]: { visits: 2 },
    });
    assert.deepEqual(result.posthog.daily, {
      [day(4)]: { pageviews: 12, visitors: 9 },
      [day(3)]: { pageviews: 5, visitors: 4 },
    });
    assert.equal(result.posthog.organicBy, "channel");
    assert.equal(result.posthog.referrersCaptured, undefined, "only checked when there are no visits from search");
  } finally {
    await srv.close();
  }
});

test("PostHog: without $channel_type it counts search-engine referrers instead, and says so", async () => {
  const srv = await fake({
    "/posthog": posthogRoute({
      "channel_type": () => [
        400,
        { type: "validation_error", code: "invalid_input", detail: "Unable to resolve field: $channel_type" },
      ],
    }),
  });
  try {
    const { result, problems } = await fetchKeys({ site: SITE, keys: { posthog: posthogKey(srv) } });
    assert.deepEqual(problems, []);
    assert.equal(result.posthog.organicBy, "referrer");
    assert.deepEqual(result.posthog.traffic, { "/pricing": { visits: 40 } });
    const fallback = srv.hits.map(h => h.body.query.query).filter(q => /LIKE '%google\.%'/.test(q));
    assert.ok(fallback.length >= 2, "the landing pages and the splits use the referrer list");
    assert.ok(
      result.notes.some(n => /PostHog/.test(n) && /\$channel_type/.test(n) && /referr/.test(n)),
      result.notes.join("\n"),
    );
  } finally {
    await srv.close();
  }
});

test("PostHog: zero visits from search are checked against referrer capture before they're believed", async () => {
  const noReferrers = await fake({
    "/posthog": posthogRoute({
      "\\$entry_pathname": () => [200, { results: [] }],
      "\\$entry_referring_domain AS k": () => [200, { results: [["example.com", "$direct", 80]] }],
    }),
  });
  try {
    const { result } = await fetchKeys({ site: SITE, keys: { posthog: posthogKey(noReferrers) } });
    assert.deepEqual(result.posthog.traffic, {});
    assert.equal(result.posthog.referrersCaptured, false);
    assert.ok(
      result.notes.some(n => /PostHog/.test(n) && /referrer/.test(n) && /zero|no visits/i.test(n)),
      result.notes.join("\n"),
    );
  } finally {
    await noReferrers.close();
  }
  const quietSite = await fake({ "/posthog": posthogRoute({ "\\$entry_pathname": () => [200, { results: [] }] }) });
  try {
    const { result } = await fetchKeys({ site: SITE, keys: { posthog: posthogKey(quietSite) } });
    assert.equal(result.posthog.referrersCaptured, true, "referrers arrive, so zero is real");
    assert.ok(!result.notes.some(n => /referrer/.test(n)));
  } finally {
    await quietSite.close();
  }
});

test("test matomo and test posthog are dry runs without --yes, then show Matomo's version and PostHog's pageviews", async () => {
  const home = tmp(),
    srv = await fake({ "/matomo": matomoRoute, "/posthog": posthogRoute() });
  try {
    const env = envFor(home, {
      MATOMO_URL: srv.url + "/matomo/",
      MATOMO_SITE_ID: "3",
      MATOMO_TOKEN_AUTH: "matomo-token-0001",
      POSTHOG_HOST: srv.url + "/posthog/",
      POSTHOG_PROJECT_ID: "12345",
      POSTHOG_PERSONAL_API_KEY: "phx_posthog_key_0001",
    });
    const dry = await cli(KEYS, ["test", "matomo"], env);
    assert.equal(srv.hits.length, 0);
    assert.match(dry.stdout, /dry run/i);
    assert.match(dry.stdout, /API\.getMatomoVersion/);
    const m = await cli(KEYS, ["test", "matomo", "--yes"], env);
    assert.match(m.stdout, /Matomo 5\.2\.1/);
    assert.equal(srv.hits[0].query.get("method"), "API.getMatomoVersion");
    assert.equal(new URLSearchParams(srv.hits[0].body).get("token_auth"), "matomo-token-0001");
    const p = await cli(KEYS, ["test", "posthog", "--yes"], env);
    assert.match(p.stdout, /PostHog project 12345[^\n]*4,512 pageviews in the last 7 days/);
    await assert.rejects(
      cli(KEYS, ["test", "bing", "--yes"], env),
      e => e.code === 2 && /matomo or posthog/.test(e.stderr),
    );
    await assert.rejects(
      cli(KEYS, ["test", "posthog", "--yes"], envFor(tmp())),
      e => e.code === 2 && /guide posthog/.test(e.stderr),
    );
  } finally {
    await srv.close();
  }
  const empty = await fake({ "/posthog": posthogRoute({ "timestamp > now": () => [200, { results: [[0]] }] }) });
  try {
    const p = await cli(
      KEYS,
      ["test", "posthog", "--yes"],
      envFor(home, {
        POSTHOG_HOST: empty.url + "/posthog/",
        POSTHOG_PROJECT_ID: "12345",
        POSTHOG_PERSONAL_API_KEY: "phx_posthog_key_0001",
      }),
    );
    assert.match(p.stdout, /no \$pageview events in the last 7 days/);
  } finally {
    await empty.close();
  }
});

// ---------- Bing ----------
const BING = {
  GetUserSites: () => ({
    d: [
      { Url: "https://www.example.com/", IsVerified: true },
      { Url: "https://sister.example.org/", IsVerified: true },
    ],
  }),
  GetQueryStats: () => ({ d: [] }),
  GetPageStats: () => ({ d: [] }),
  GetCrawlIssues: () => ({ d: [] }),
  GetLinkCounts: q => ({
    d: {
      Links: q.get("siteUrl").includes("sister")
        ? [
            { Url: "https://sister.example.org/", Count: 9 },
            { Url: "https://sister.example.org/guide", Count: 4 },
          ]
        : [{ Url: "https://www.example.com/", Count: 5 }],
      TotalPages: 1,
    },
  }),
  GetUrlLinks: q => {
    const link = q.get("link");
    const from =
      {
        "https://www.example.com/": ["https://shared.example.net/a", "https://only-ours.example.net/b"],
        "https://www.example.com/pricing": ["https://blog.example.net/p"],
        "https://www.example.com/docs/": [],
        "https://sister.example.org/": ["https://shared.example.net/c", "https://www.sister-fan.example.net/d"],
        "https://sister.example.org/guide": ["https://directory.example.net/e"],
      }[link] || [];
    return { d: { Details: from.map(Url => ({ Url, AnchorText: "a link" })), TotalPages: from.length ? 1 : 0 } };
  },
};
const bingRoute = ({ path, query }) => {
  const m = BING[path.split("/").pop()];
  return m ? [200, m(query)] : [404, {}];
};

test("Bing: links for the pages the owner chooses, and the sites that link to a sister site but not to this one", async () => {
  const srv = await fake({ "/bing": bingRoute });
  try {
    const { result, problems } = await fetchKeys({
      site: SITE,
      keys: { bing: { key: "b-key-0001" } },
      endpoints: { bing: srv.url + "/bing" },
      bingPages: ["/pricing", "https://www.example.com/docs/", "https://elsewhere.example.net/x"],
      bingSister: "https://sister.example.org",
    });
    assert.deepEqual(problems, []);
    assert.deepEqual(result.bing.backlinks.byPage, {
      "/pricing": [{ url: "https://blog.example.net/p", anchorText: "a link" }],
      "/docs/": [],
    });
    assert.ok(
      result.notes.some(n => n.includes("https://elsewhere.example.net/x")),
      "a page on another site is skipped, with a note",
    );
    assert.deepEqual(result.bing.sister, {
      site: "https://sister.example.org/",
      onlySister: ["sister-fan.example.net", "directory.example.net"],
      shared: 1,
    });
    const links = srv.hits.filter(h => h.path.endsWith("GetUrlLinks")).map(h => h.query.get("link"));
    assert.ok(links.includes("https://www.example.com/pricing") && links.includes("https://sister.example.org/guide"));
    assert.ok(
      srv.hits
        .filter(h => h.query.get("siteUrl"))
        .every(h => ["https://www.example.com/", "https://sister.example.org/"].includes(h.query.get("siteUrl"))),
    );
  } finally {
    await srv.close();
  }
});

test("Bing: a sister site that isn't in the account is a note, and the rest of Bing's data stays", async () => {
  const srv = await fake({ "/bing": bingRoute });
  try {
    const { result, problems } = await fetchKeys({
      site: SITE,
      keys: { bing: { key: "b-key-0001" } },
      endpoints: { bing: srv.url + "/bing" },
      bingSister: "https://not-mine.example.org",
    });
    assert.deepEqual(problems, []);
    assert.equal(result.bing.sister, null);
    assert.ok(result.bing.backlinks.pages.length);
    assert.ok(
      result.notes.some(n => /not-mine\.example\.org/.test(n)),
      result.notes.join("\n"),
    );
  } finally {
    await srv.close();
  }
});

// ---------- Search Console and Google Analytics ----------
const SC = "https://www.googleapis.com/auth/webmasters.readonly",
  GA = "https://www.googleapis.com/auth/analytics.readonly";
const row = (keys, clicks, impressions) => ({ keys, clicks, impressions, ctr: clicks / impressions, position: 7.5 });
const ga = (dims, ...metrics) => ({
  dimensionValues: dims.map(value => ({ value })),
  metricValues: metrics.map(m => ({ value: String(m) })),
});
function googleRoute(queriesClicks = [20, 5]) {
  return ({ path, body }) => {
    if (path === "/webmasters/v3/sites")
      return [200, { siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] }];
    if (path.endsWith("/searchAnalytics/query")) {
      const d = body.dimensions.join();
      if (body.type !== "web" || d === "device" || d === "country" || d === "page,query") return [200, { rows: [] }];
      if (d === "") return [200, { rows: [{ clicks: 40, impressions: 2000, ctr: 0.02, position: 7.5 }] }];
      if (d === "page") return [200, { rows: [row(["https://www.example.com/a/"], 30, 1000)] }];
      return [200, { rows: queriesClicks.map((c, i) => row([`query ${i}`], c, 100)) }];
    }
    if (path.endsWith("/sitemaps")) return [200, { sitemap: [] }];
    if (path.endsWith("index:inspect"))
      return [
        200,
        {
          inspectionResult: {
            indexStatusResult: {
              verdict: "PASS",
              coverageState: "Submitted and indexed",
              crawledAs: "MOBILE",
              referringUrls: Array.from({ length: 12 }, (_, i) => `https://www.example.com/r${i}/`),
              lastCrawlTime: "2026-11-01T00:00:00Z",
            },
          },
        },
      ];
    if (path.endsWith(":runReport")) {
      const dim = body.dimensions?.[0]?.name,
        channel = body.dimensionFilter.filter.stringFilter.value;
      if (channel === "AI Assistant")
        return [200, { rows: [ga(["chatgpt.com"], 5, 4), ga(["gemini.google.com"], 2, 2)] }];
      const rows = {
        undefined: [ga([], 120, 90)],
        landingPage: [ga(["/a/"], 100, 70)],
        date: [ga(["20261101"], 10, 8), ga(["20261102"], 12, 9), ga(["not a date"], 1, 1)],
        deviceCategory: [ga(["desktop"], 70, 50), ga(["mobile"], 50, 40)],
        country: Array.from({ length: 12 }, (_, i) => ga([`Country ${i}`], 20 - i, 10)),
      }[dim];
      return [200, { rows, rowCount: rows.length }];
    }
  };
}
async function googleFetch(route, extra = {}) {
  const srv = await fake({ "/webmasters": route, "/v1": route, "/data": route }),
    home = tmp();
  mkdirSync(join(home, ".seo-supervisor"), { recursive: true });
  writeFileSync(
    join(home, ".seo-supervisor", "google.json"),
    JSON.stringify({
      method: "own-client",
      client: { id: "id", secret: "s" },
      access_token: "fresh",
      refresh_token: "r",
      expires_at: Date.now() + 3600e3,
      scope: `${SC} ${GA}`,
    }),
  );
  const endpoints = {
    searchConsole: srv.url + "/webmasters/v3",
    inspection: srv.url + "/v1",
    analyticsData: srv.url + "/data/v1beta",
    token: srv.url + "/token",
    analyticsAdmin: srv.url + "/admin",
  };
  try {
    return {
      r: await fetchGoogle({ site: SITE, home, endpoints, ga4Property: "222", inspect: ["/a/"], ...extra }),
      hits: srv.hits,
    };
  } finally {
    await srv.close();
  }
}

test("Search Console: site totals from one query with no dimensions, and whether the listed queries cover them", async () => {
  const { r, hits } = await googleFetch(googleRoute());
  const total = hits.filter(
    h => h.path.endsWith("/searchAnalytics/query") && h.body.type === "web" && !h.body.dimensions.length,
  );
  assert.equal(total.length, 1);
  assert.deepEqual(r.siteTotals, {
    clicks: 40,
    impressions: 2000,
    ctr: 0.02,
    position: 7.5,
    queryClicks: 25,
    complete: false,
  });
  const full = await googleFetch(googleRoute([30, 10]));
  assert.equal(full.r.siteTotals.complete, true);
});

test("URL Inspection keeps crawledAs and up to 10 referring URLs", async () => {
  const { r } = await googleFetch(googleRoute());
  assert.equal(r.inspection[0].crawledAs, "MOBILE");
  assert.deepEqual(
    r.inspection[0].referringUrls,
    Array.from({ length: 10 }, (_, i) => `https://www.example.com/r${i}/`),
  );
});

test("Google Analytics: organic users, sessions per day, by device and country, and the AI Assistant channel by source", async () => {
  const { r, hits } = await googleFetch(googleRoute());
  const reports = hits.filter(h => h.path.endsWith(":runReport")).map(h => h.body);
  assert.ok(
    reports.every(b => b.dateRanges[0].endDate === reports[0].dateRanges[0].endDate),
    "one period",
  );
  assert.ok(reports.filter(b => b.dimensionFilter.filter.stringFilter.value === "Organic Search").length >= 5);
  const ai = reports.find(b => b.dimensionFilter.filter.stringFilter.value === "AI Assistant");
  assert.deepEqual(ai.dimensions, [{ name: "sessionSource" }]);
  assert.deepEqual(
    reports.find(b => b.dimensions?.[0]?.name === "date").metrics.map(m => m.name),
    ["sessions", "totalUsers"],
  );
  assert.deepEqual(r.analyticsDetail.sessions, 120);
  assert.deepEqual(r.analyticsDetail.users, 90);
  assert.deepEqual(r.analyticsDetail.daily, {
    "2026-11-01": { sessions: 10, users: 8 },
    "2026-11-02": { sessions: 12, users: 9 },
  });
  assert.deepEqual(r.analyticsDetail.byDevice, {
    desktop: { sessions: 70, users: 50 },
    mobile: { sessions: 50, users: 40 },
  });
  assert.deepEqual(
    Object.keys(r.analyticsDetail.byCountry),
    Array.from({ length: 10 }, (_, i) => `Country ${i}`),
  );
  assert.deepEqual(r.analyticsDetail.aiAssistant, {
    sessions: 7,
    bySource: { "chatgpt.com": { sessions: 5 }, "gemini.google.com": { sessions: 2 } },
  });
  assert.deepEqual(r.analytics, { "/a/": { sessions: 100, engaged: 70 } }, "the landing pages are unchanged");
});

// ---------- the AI report exports ----------
test("gsc-import reads Search Console's Generative AI and Bing's AI Performance page exports", async () => {
  const dir = tmp(),
    out = join(dir, "ai.json");
  writeFileSync(
    join(dir, "google.csv"),
    '﻿Top pages,Impressions\r\nhttps://www.example.com/a/,1200\r\nhttp://example.com/a/,10\r\nhttps://www.example.com/b/,"1,300"\r\nhttps://other.example.org/x,99\r\n',
  );
  writeFileSync(
    join(dir, "bing.csv"),
    "Page URL,Citations,Average cited position\nhttps://www.example.com/a/,30,2\nhttps://www.example.com/c/,5,1\n",
  );
  await node([
    GSC,
    "--ai-google",
    join(dir, "google.csv"),
    "--ai-bing",
    join(dir, "bing.csv"),
    "--site-origin",
    SITE,
    "--out",
    out,
  ]);
  const o = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(o.source, "ai-reports");
  assert.deepEqual(o.aiReports.google, {
    impressions: 2510,
    pages: { "/b/": { impressions: 1300 }, "/a/": { impressions: 1210 } },
  });
  assert.deepEqual(o.aiReports.bing, { citations: 35, pages: { "/a/": { citations: 30 }, "/c/": { citations: 5 } } });
  writeFileSync(join(dir, "wrong.csv"), "Query,Clicks\nwidgets,4\n");
  await assert.rejects(
    node([GSC, "--ai-google", join(dir, "wrong.csv"), "--out", out]),
    e => e.code === 2 && /page/i.test(e.stderr) && /Impressions/.test(e.stderr),
  );
});

// ---------- the report ----------
const render = async extra => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  writeFileSync(join(dir, "a.json"), JSON.stringify({ ...data, ...extra }));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};

test("the report shows these connections as information-only lines, escaped, and nothing when they're absent", async () => {
  const before = await render({});
  const { html, md } = await render({
    domainAge: [
      { domain: "example.com", registered: "2004-05-12", expires: "2027-05-12", registrar: XSS },
      { domain: "rival.com", registered: "2015-01-03", registrar: null },
    ],
    moz: [
      { domain: "example.com", domainAuthority: 45, spamScore: 2, linkingDomains: 1234 },
      { domain: "rival.com", domainAuthority: 30, spamScore: null, linkingDomains: null },
    ],
    youtube: {
      channel: { title: XSS, subscribers: 1200, videos: 45, views: 300000 },
      topics: [
        {
          topic: "widgets",
          videos: [
            { title: "T", channel: "Example Co", own: true },
            { title: "U", channel: "Other", own: false },
          ],
        },
      ],
    },
    siteTotals: { clicks: 40, impressions: 2000, queryClicks: 25, complete: false },
    analyticsDetail: {
      sessions: 120,
      users: 90,
      byDevice: { desktop: { sessions: 70 }, mobile: { sessions: 50 } },
      aiAssistant: { sessions: 7, bySource: { "chatgpt.com": { sessions: 5 }, [XSS]: { sessions: 2 } } },
    },
    matomo: {
      byChannel: { "Search Engines": { visits: 300 }, "Direct Entry": { visits: 200 } },
      byEngine: { Google: { visits: 250 } },
    },
    posthog: { byReferrer: { "www.google.com": { visits: 50 }, $direct: { visits: 30 } }, referrersCaptured: false },
    aiReports: {
      google: { impressions: 2510, pages: { "/b/": { impressions: 1300 } } },
      bing: { citations: 35, pages: { [`/${XSS}`]: { citations: 30 } } },
    },
    bing: { sister: { site: "https://sister.example.org/", onlySister: ["sister-fan.example.net", XSS], shared: 1 } },
  });
  const lines = [
    `Domain age (RDAP): example.com registered 2004-05-12 (${XSS}) · rival.com registered 2015-01-03`,
    "Moz: example.com Domain Authority 45, Spam Score 2, 1,234 linking domains · rival.com Domain Authority 30",
    `YouTube channel ${XSS}: 1,200 subscribers · 45 videos · 300,000 views`,
    "Top YouTube videos for “widgets”: 1 of 2 from your channel · first: T (Example Co)",
    "Search Console totals for the whole property: 40 clicks · 2,000 impressions. The queries listed cover 63% of the clicks; Google doesn't list rare queries.",
    "Google Analytics organic: 120 sessions from 90 users · desktop 70 · mobile 50 (last 3 months)",
    `Google Analytics AI Assistant channel: 7 sessions (chatgpt.com 5 · ${XSS} 2)`,
    "Matomo visits by channel: Search Engines 300 · Direct Entry 200",
    "Matomo search visits by search engine: Google 250",
    "PostHog visits by referrer: www.google.com 50 · direct 30",
    "PostHog: no visit in this period has a referrer, so it can't tell visits from search apart. Its zero visits from search may be wrong.",
    "Google AI Overviews and AI Mode: 2,510 impressions on 1 page (top: /b/ 1,300)",
    `Bing AI answers: 35 citations of 1 page (top: /${XSS} 30)`,
    `Bing: 2 sites link to sister.example.org but not to this site: sister-fan.example.net, ${XSS}`,
  ];
  const escHtml = s =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const escMd = s => s.replace(/[\\`*_[\]<>]/g, "\\$&");
  for (const l of lines) {
    assert.ok(html.includes(`<p class="quiet">${escHtml(l)}</p>`), `HTML: ${l}`);
    assert.ok(md.includes(`\n${escMd(l)}\n`), `Markdown: ${l}`);
    assert.ok(!before.html.includes(escHtml(l).slice(0, 20)), `absent without data: ${l}`);
  }
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(md, /(^|[^\\])<img src=x/m);
});

// ---------- the notes in the rules ----------
test("LAUNCH notes: EU click rates around March 2024, and Consent Mode undercounting", () => {
  const t = readFileSync(join(SKILL, "rules", "launch-monitoring.md"), "utf8");
  assert.match(t, /Digital Markets Act/);
  assert.match(t, /March 2024/);
  assert.match(t, /Consent Mode/);
  assert.match(t, /support\.google\.com\/analytics\/answer\/9976101/);
});

test("YouTube: a search result with snippet: null is kept without its details, never a crash", async () => {
  const srv = await fake({
    "/yt": ({ path }) =>
      path.endsWith("/search")
        ? [200, { items: [{ id: { kind: "youtube#video", videoId: "vid9" }, snippet: null }] }]
        : [200, { items: [] }],
  });
  try {
    const { result } = await fetchKeys({
      site: SITE,
      keys: { youtube: { key: "yt-key-0001" } },
      endpoints: { youtube: srv.url + "/yt" },
      topics: ["widgets"],
    });
    assert.deepEqual(
      result.youtube.topics[0].videos.map(v => [v.id, v.title, v.published]),
      [["vid9", "", null]],
    );
  } finally {
    await srv.close();
  }
});
