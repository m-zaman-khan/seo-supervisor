import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { challengeFor, pkce, fetchGoogle } from "../skills/seo-supervisor/scripts/google.mjs";

const CLI = join(SCRIPTS, "google.mjs");
const SC = "https://www.googleapis.com/auth/webmasters.readonly",
  GA = "https://www.googleapis.com/auth/analytics.readonly";
const b64json = s => JSON.parse(Buffer.from(s, "base64url").toString());

// One local server plays every Google endpoint. routes: "METHOD /path" -> (req, body) => [status, json, headers?].
// Paths are matched without the query string; every request is recorded.
async function fakeGoogle(routes = {}) {
  const hits = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => {
      raw += c;
    });
    req.on("end", () => {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const body = /json/.test(req.headers["content-type"] || "")
        ? JSON.parse(raw)
        : Object.fromEntries(new URLSearchParams(raw));
      const hit = {
        method: req.method,
        path,
        query: Object.fromEntries(new URL(req.url, "http://x").searchParams),
        auth: req.headers.authorization,
        body,
      };
      hits.push(hit);
      const route = routes[`${req.method} ${path}`];
      const [status, json, headers = {}] = route
        ? route(hit)
        : [404, { error: { code: 404, message: "no such fake route" } }];
      res
        .writeHead(status, { "content-type": "application/json", connection: "close", ...headers })
        .end(JSON.stringify(json));
    });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const endpoints = {
    auth: base + "/auth",
    token: base + "/token",
    revoke: base + "/revoke",
    searchConsole: base + "/webmasters/v3",
    inspection: base + "/v1",
    analyticsAdmin: base + "/admin/v1beta",
    analyticsData: base + "/data/v1beta",
  };
  const env = {
    SEO_GOOGLE_AUTH_URL: endpoints.auth,
    SEO_GOOGLE_TOKEN_URL: endpoints.token,
    SEO_GOOGLE_REVOKE_URL: endpoints.revoke,
    SEO_GOOGLE_SEARCH_CONSOLE_URL: endpoints.searchConsole,
    SEO_GOOGLE_INSPECTION_URL: endpoints.inspection,
    SEO_GOOGLE_ANALYTICS_ADMIN_URL: endpoints.analyticsAdmin,
    SEO_GOOGLE_ANALYTICS_DATA_URL: endpoints.analyticsData,
  };
  return {
    base,
    endpoints,
    env,
    hits,
    close: () =>
      new Promise(c => {
        server.closeAllConnections();
        server.close(c);
      }),
  };
}
const homeEnv = home => ({ ...process.env, HOME: home, USERPROFILE: home });
const tokenPath = home => join(home, ".seo-supervisor", "google.json");
const stored = home => JSON.parse(readFileSync(tokenPath(home), "utf8"));
function store(home, extra = {}) {
  mkdirSync(join(home, ".seo-supervisor"), { recursive: true });
  writeFileSync(
    tokenPath(home),
    JSON.stringify({
      method: "own-client",
      client: { id: "own-id", secret: "own-secret" },
      access_token: "fresh",
      refresh_token: "r1",
      expires_at: Date.now() + 3600e3,
      scope: `${SC} ${GA}`,
      connected_at: "2026-11-01T10:00:00.000Z",
      ...extra,
    }),
  );
}
const tokenRoute = { "POST /token": () => [200, { access_token: "fresh", expires_in: 3599, token_type: "Bearer" }] };

test("PKCE: the S256 challenge is the base64url SHA-256 of the verifier (RFC 7636 appendix B)", () => {
  assert.equal(
    challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  const { verifier, challenge } = pkce();
  assert.match(verifier, /^[A-Za-z0-9\-._~]{43,128}$/);
  assert.equal(challenge, createHash("sha256").update(verifier).digest("base64url"));
  assert.notEqual(pkce().verifier, verifier, "a new verifier every time");
});

test("sign in without the shared client explains it isn't set up yet and points to the do-it-yourself option", async () => {
  const home = tmp();
  await assert.rejects(node([CLI, "connect", "--no-browser"], { env: homeEnv(home) }), e => {
    assert.equal(e.code, 2);
    assert.match(e.stderr, /isn't set up yet/);
    assert.match(e.stderr, /node google\.mjs guide/);
    assert.match(e.stderr, /--client-file/);
    return true;
  });
  assert.equal(existsSync(tokenPath(home)), false);
});

test("guide prints numbered steps for a Desktop client and for a service account", async () => {
  const { stdout } = await node([CLI, "guide"]);
  assert.match(stdout, /console\.cloud\.google\.com\/auth\/overview\/personal/);
  for (const api of ["Google Search Console API", "Google Analytics Data API", "Google Analytics Admin API"])
    assert.ok(stdout.includes(api), api);
  assert.match(stdout, /^ *1\. /m);
  assert.match(stdout, /service account/i);
  assert.match(stdout, /--client-file/);
  assert.match(stdout, /--service-account/);
});

test("connect with your own Desktop client: loopback redirect, PKCE, state check, code exchange, private token file", async () => {
  const g = await fakeGoogle({
    "POST /token": () => [
      200,
      { access_token: "at1", refresh_token: "rt1", expires_in: 3599, scope: `${SC} ${GA}`, token_type: "Bearer" },
    ],
  });
  const home = tmp(),
    dir = tmp(),
    clientFile = join(dir, "client_secret_123.json");
  writeFileSync(
    clientFile,
    JSON.stringify({
      installed: {
        client_id: "own-id.apps.googleusercontent.com",
        client_secret: "own-secret",
        redirect_uris: ["http://localhost"],
      },
    }),
  );
  const child = spawn(process.execPath, [CLI, "connect", "--client-file", clientFile, "--no-browser"], {
    env: { ...homeEnv(home), ...g.env },
  });
  let out = "",
    err = "";
  child.stderr.on("data", c => {
    err += c;
  });
  const exited = new Promise(ok => child.on("exit", ok));
  try {
    const authUrl = await new Promise((ok, no) => {
      child.stdout.on("data", c => {
        out += c;
        const m = out.match(new RegExp(g.endpoints.auth.replace(/[.?]/g, "\\$&") + "\\?\\S+"));
        if (m) ok(new URL(m[0]));
      });
      child.on("exit", () => no(new Error("connect exited early: " + out + err)));
    });
    const q = Object.fromEntries(authUrl.searchParams);
    assert.equal(q.client_id, "own-id.apps.googleusercontent.com");
    assert.equal(q.response_type, "code");
    assert.deepEqual(q.scope.split(" ").sort(), [SC, GA].sort());
    assert.equal(q.code_challenge_method, "S256");
    assert.equal(q.access_type, "offline");
    assert.equal(q.prompt, "consent");
    assert.match(q.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.ok(q.state.length >= 16);

    const wrong = await fetch(`${q.redirect_uri}/?code=evil&state=not-the-state`);
    assert.equal(wrong.status, 400, "a redirect with the wrong state is refused");
    await wrong.text();
    const page = await fetch(
      `${q.redirect_uri}/?code=the-code&state=${encodeURIComponent(q.state)}&scope=${encodeURIComponent(q.scope)}`,
    );
    assert.equal(page.status, 200);
    assert.match(await page.text(), /close this tab/i);
    assert.equal(await exited, 0, err);

    const ex = g.hits.find(h => h.path === "/token").body;
    assert.equal(ex.grant_type, "authorization_code");
    assert.equal(ex.code, "the-code");
    assert.equal(ex.redirect_uri, q.redirect_uri);
    assert.equal(ex.client_id, "own-id.apps.googleusercontent.com");
    assert.equal(ex.client_secret, "own-secret");
    assert.equal(challengeFor(ex.code_verifier), q.code_challenge, "the verifier matches the challenge sent to Google");

    const s = stored(home);
    assert.equal(s.method, "own-client");
    assert.equal(s.client.id, "own-id.apps.googleusercontent.com");
    assert.equal(s.client.file, clientFile);
    assert.equal(s.refresh_token, "rt1");
    assert.ok(s.expires_at > Date.now());
    if (process.platform !== "win32") {
      assert.equal(statSync(tokenPath(home)).mode & 0o777, 0o600);
      assert.equal(statSync(join(home, ".seo-supervisor")).mode & 0o777, 0o700);
    }
  } finally {
    child.kill();
    await g.close();
  }
});

test("connect with a service-account key signs an RS256 JWT for both scopes and exchanges it", async () => {
  const g = await fakeGoogle({
    "POST /token": () => [200, { access_token: "sa-at", expires_in: 3599, token_type: "Bearer" }],
  });
  const home = tmp(),
    dir = tmp(),
    keyFile = join(dir, "key.json");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(
    keyFile,
    JSON.stringify({
      type: "service_account",
      client_email: "seo@proj.iam.gserviceaccount.com",
      private_key_id: "kid123",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  );
  try {
    const { stdout } = await node([CLI, "connect", "--service-account", keyFile], {
      env: { ...homeEnv(home), ...g.env },
    });
    assert.match(stdout, /seo@proj\.iam\.gserviceaccount\.com/);
    const { body } = g.hits.find(h => h.path === "/token");
    assert.equal(body.grant_type, "urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, c, sig] = body.assertion.split(".");
    assert.deepEqual(b64json(h), { alg: "RS256", typ: "JWT", kid: "kid123" });
    const claims = b64json(c);
    assert.equal(claims.iss, "seo@proj.iam.gserviceaccount.com");
    assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
    assert.deepEqual(claims.scope.split(" ").sort(), [SC, GA].sort());
    assert.equal(claims.exp - claims.iat, 3600);
    assert.ok(Math.abs(claims.iat - Date.now() / 1000) < 60);
    assert.ok(
      verify("sha256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, "base64url")),
      "the signature checks out with the public key",
    );
    const s = stored(home);
    assert.equal(s.method, "service-account");
    assert.equal(s.client_email, "seo@proj.iam.gserviceaccount.com");
    assert.equal(s.access_token, "sa-at");
  } finally {
    await g.close();
  }
});

test("status shows the method, client, scopes, expiry and the properties the account can see", async () => {
  const g = await fakeGoogle({
    "GET /webmasters/v3/sites": () => [
      200,
      { siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] },
    ],
    "GET /admin/v1beta/accountSummaries": () => [
      200,
      {
        accountSummaries: [
          {
            account: "accounts/1",
            displayName: "Example",
            propertySummaries: [{ property: "properties/123", displayName: "Example site" }],
          },
        ],
      },
    ],
  });
  const home = tmp();
  try {
    await assert.rejects(node([CLI, "status"], { env: { ...homeEnv(home), ...g.env } }), e =>
      /Not connected/.test(e.stdout + e.stderr),
    );
    store(home);
    const { stdout } = await node([CLI, "status"], { env: { ...homeEnv(home), ...g.env } });
    assert.match(stdout, /own Google Cloud client/);
    assert.match(stdout, /own-id/);
    assert.match(stdout, /Search Console \(read-only\)/);
    assert.match(stdout, /Google Analytics \(read-only\)/);
    assert.match(stdout, /valid until/);
    assert.match(stdout, /sc-domain:example\.com/);
    assert.match(stdout, /Example site \(123\)/);
    assert.ok(stdout.includes(tokenPath(home)));
  } finally {
    await g.close();
  }
});

test("disconnect revokes the grant at Google, deletes the token file and points to myaccount", async () => {
  const g = await fakeGoogle({ "POST /revoke": () => [200, {}] });
  const home = tmp();
  store(home);
  try {
    const { stdout } = await node([CLI, "disconnect"], { env: { ...homeEnv(home), ...g.env } });
    assert.deepEqual(
      g.hits.map(h => [h.path, h.body.token]),
      [["/revoke", "r1"]],
    );
    assert.equal(existsSync(tokenPath(home)), false);
    assert.match(stdout, /myaccount\.google\.com\/connections/);
  } finally {
    await g.close();
  }
});

// ---------- fetch ----------
const PAGE = (url, clicks, impressions, position) => ({
  keys: [url],
  clicks,
  impressions,
  ctr: clicks / impressions,
  position,
});
const pageRows = [
  PAGE("https://www.example.com/", 50, 1000, 1.5),
  PAGE("https://www.example.com/a/", 50, 1000, 2.2),
  PAGE("https://www.example.com/b/", 40, 800, 2.8),
  PAGE("https://www.example.com/pricing/", 10, 2500, 2.1),
  PAGE("http://example.com/pricing/", 2, 500, 2.7),
  PAGE("https://www.example.com/guide/", 3, 400, 12.34),
  PAGE("https://blog.example.com/elsewhere/", 99, 9999, 1),
];
const pqRows = [
  { keys: ["https://www.example.com/a/", "widgets"], clicks: 5, impressions: 300, ctr: 0.0167, position: 6 },
  { keys: ["https://www.example.com/b/", "widgets"], clicks: 4, impressions: 200, ctr: 0.02, position: 8 },
  { keys: ["https://www.example.com/pricing/", "widget price"], clicks: 9, impressions: 900, ctr: 0.01, position: 2 },
];
function apiRoutes(over = {}) {
  const SITE = "/webmasters/v3/sites/sc-domain:example.com";
  return {
    ...tokenRoute,
    "GET /webmasters/v3/sites": () => [
      200,
      {
        siteEntry: [
          { siteUrl: "https://other.example/", permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:example.com", permissionLevel: "siteFullUser" },
        ],
      },
    ],
    [`POST ${SITE}/searchAnalytics/query`]: ({ body }) => {
      const d = body.dimensions.join(",");
      const all =
        d === "page"
          ? pageRows
          : d === "query"
            ? [{ keys: ["widgets"], clicks: 9, impressions: 500, ctr: 0.018, position: 6.6 }]
            : pqRows;
      return [200, { rows: all.slice(body.startRow || 0, (body.startRow || 0) + body.rowLimit) }];
    },
    [`GET ${SITE}/sitemaps`]: () => [
      200,
      {
        sitemap: [
          {
            path: "https://www.example.com/sitemap.xml",
            lastSubmitted: "2026-11-01T00:00:00Z",
            lastDownloaded: "2026-11-10T00:00:00Z",
            isPending: false,
            warnings: "1",
            errors: "3",
            contents: [{ type: "web", submitted: "12" }],
          },
        ],
      },
    ],
    "POST /v1/urlInspection/index:inspect": ({ body }) => {
      const p = new URL(body.inspectionUrl).pathname;
      const r = {
        verdict: "PASS",
        coverageState: "Submitted and indexed",
        indexingState: "INDEXING_ALLOWED",
        robotsTxtState: "ALLOWED",
        pageFetchState: "SUCCESSFUL",
        lastCrawlTime: "2026-11-12T08:00:00Z",
        googleCanonical: body.inspectionUrl,
        userCanonical: body.inspectionUrl,
      };
      if (p === "/b/")
        Object.assign(r, {
          verdict: "NEUTRAL",
          coverageState: "Crawled - currently not indexed",
          googleCanonical: undefined,
        });
      if (p === "/pricing/") r.googleCanonical = "https://www.example.com/plans/";
      return [200, { inspectionResult: { inspectionResultLink: "https://search.google.com/x", indexStatusResult: r } }];
    },
    "GET /admin/v1beta/accountSummaries": () => [
      200,
      {
        accountSummaries: [
          {
            account: "accounts/1",
            displayName: "Acme",
            propertySummaries: [
              { property: "properties/111", displayName: "Old app" },
              { property: "properties/222", displayName: "Website" },
            ],
          },
        ],
      },
    ],
    "GET /admin/v1beta/properties/111/dataStreams": () => [
      200,
      { dataStreams: [{ type: "WEB_DATA_STREAM", webStreamData: { defaultUri: "https://app.other.example" } }] },
    ],
    "GET /admin/v1beta/properties/222/dataStreams": () => [
      200,
      { dataStreams: [{ type: "WEB_DATA_STREAM", webStreamData: { defaultUri: "https://www.example.com" } }] },
    ],
    "POST /data/v1beta/properties/222:runReport": () => [
      200,
      {
        rows: [
          { dimensionValues: [{ value: "/pricing/" }], metricValues: [{ value: "120" }, { value: "80" }] },
          { dimensionValues: [{ value: "(not set)" }], metricValues: [{ value: "3" }, { value: "0" }] },
        ],
        rowCount: 2,
      },
    ],
    ...over,
  };
}
const fetchWith = (g, home, extra = {}) =>
  fetchGoogle({
    site: "https://www.example.com",
    days: 90,
    home,
    endpoints: g.endpoints,
    pageSize: 2,
    crawl: null,
    ...extra,
  });

test("fetch: Search Console data in gsc-import's shape, URL Inspection and sitemap findings, and GA4 organic sessions", async () => {
  const g = await fakeGoogle(apiRoutes()),
    home = tmp();
  store(home);
  try {
    const crawl = {
      pages: [
        { url: "http://localhost:3000/docs/", status: 200, depth: 1, linksIn: 4 },
        { url: "not a url", status: 200 },
        { url: "http://localhost:3000/hidden/", status: 200, noindex: true },
      ],
    };
    const r = await fetchWith(g, home, { crawl });
    assert.ok(
      r.inspection.some(i => i.url === "https://www.example.com/docs/"),
      "crawled key pages with no traffic are inspected on the live site",
    );
    assert.ok(!r.inspection.some(i => /hidden/.test(i.url)));
    assert.equal(r.source, "google");
    assert.equal(r.site, "https://www.example.com");
    assert.match(r.period, /^Last 90 days, \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d$/);
    assert.deepEqual(
      r.traffic["/pricing/"],
      { clicks: 12, impressions: 3000, ctr: 0.004, position: 2.2 },
      "http and www variants add up, like gsc-import",
    );
    assert.equal(r.traffic["/guide/"].position, 12.3);
    assert.equal(r.traffic["/elsewhere/"], undefined, "other subdomains of a domain property are left out");
    assert.deepEqual(r.queries, [{ query: "widgets", clicks: 9, impressions: 500, ctr: 0.018, position: 6.6 }]);
    assert.deepEqual(
      Object.keys(r.pageQueries).sort(),
      ["/a/", "/b/", "/pricing/"],
      "page+query rows are paged with startRow",
    );
    const pq = g.hits.filter(h => h.body.dimensions?.join() === "page,query").map(h => h.body.startRow);
    assert.deepEqual(pq, [0, 2]);

    const rules = Object.fromEntries(r.findings.map(f => [f.check, f]));
    assert.equal(rules["low-ctr"].rule, "INTENT-03", "gsc-import's findings logic runs on API data");
    assert.equal(rules["query-competition"].rule, "INTENT-02");
    assert.equal(rules["gsc-not-indexed"].rule, "CRAWL-02");
    assert.equal(rules["gsc-not-indexed"].severity, "high");
    assert.match(rules["gsc-not-indexed"].evidence[0].detail, /Crawled - currently not indexed/);
    assert.equal(rules["gsc-canonical-differs"].rule, "URL-04");
    assert.equal(rules["gsc-canonical-differs"].severity, "medium");
    assert.match(rules["gsc-canonical-differs"].evidence[0].detail, /plans/);
    assert.equal(rules["gsc-sitemap-errors"].rule, "MAP-01");
    assert.match(rules["gsc-sitemap-errors"].evidence[0].detail, /3 errors/);
    assert.deepEqual(
      r.findings.map(f => f.id),
      r.findings.map((_, i) => "G-" + String(i + 1).padStart(3, "0")),
    );

    const insp = r.inspection.find(i => i.url === "https://www.example.com/pricing/");
    assert.equal(insp.coverageState, "Submitted and indexed");
    assert.equal(insp.googleCanonical, "https://www.example.com/plans/");
    assert.equal(insp.userCanonical, "https://www.example.com/pricing/");
    assert.equal(insp.lastCrawlTime, "2026-11-12T08:00:00Z");
    assert.equal(insp.robotsTxtState, "ALLOWED");
    assert.ok(r.inspection.length <= 20);
    const inspected = g.hits.filter(h => h.path.endsWith(":inspect"));
    assert.ok(inspected.every(h => h.body.siteUrl === "sc-domain:example.com"));
    assert.deepEqual(r.sitemaps[0], {
      path: "https://www.example.com/sitemap.xml",
      lastSubmitted: "2026-11-01T00:00:00Z",
      lastDownloaded: "2026-11-10T00:00:00Z",
      isPending: false,
      errors: 3,
      warnings: 1,
    });

    assert.deepEqual(
      r.analytics,
      { "/pricing/": { sessions: 120, engaged: 80 } },
      "the property whose website matches is picked",
    );
    const report = g.hits.find(h => h.path.endsWith(":runReport")).body;
    assert.equal(report.dimensionFilter.filter.stringFilter.value, "Organic Search");
    assert.deepEqual(
      report.metrics.map(m => m.name),
      ["sessions", "engagedSessions"],
    );
    assert.match(
      r.period,
      new RegExp(report.dateRanges[0].startDate + " to " + report.dateRanges[0].endDate),
      "GA4 covers the same period",
    );
    assert.ok(g.hits.filter(h => h.path !== "/token").every(h => h.auth === "Bearer fresh"));
  } finally {
    await g.close();
  }
});

test("fetch: an expired token is refreshed first and saved; a 401 refreshes once and retries", async () => {
  const g = await fakeGoogle(
    apiRoutes({
      "GET /webmasters/v3/sites": ({ auth }) =>
        auth === "Bearer fresh"
          ? [200, { siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] }]
          : [401, { error: { code: 401, message: "Invalid Credentials" } }],
    }),
  );
  try {
    const home = tmp();
    store(home, { access_token: "old", expires_at: Date.now() - 1000 });
    await fetchWith(g, home, { ga4Property: "222" });
    assert.equal(g.hits[0].path, "/token", "refreshed before the first call");
    assert.deepEqual(g.hits[0].body, {
      grant_type: "refresh_token",
      refresh_token: "r1",
      client_id: "own-id",
      client_secret: "own-secret",
    });
    assert.equal(stored(home).access_token, "fresh");
    assert.equal(stored(home).refresh_token, "r1", "the refresh token is kept");
    assert.ok(stored(home).expires_at > Date.now());

    g.hits.length = 0;
    const home2 = tmp();
    store(home2, { access_token: "revoked-server-side" });
    await fetchWith(g, home2, { ga4Property: "222" });
    assert.deepEqual(
      g.hits.slice(0, 3).map(h => h.path),
      ["/webmasters/v3/sites", "/token", "/webmasters/v3/sites"],
    );
  } finally {
    await g.close();
  }
});

test("fetch: a 403 explains the account has no access to the property; a 429 is retried once, then noted", async () => {
  const SITE = "/webmasters/v3/sites/sc-domain:example.com";
  let busy = 0;
  const g = await fakeGoogle(
    apiRoutes({
      [`POST ${SITE}/searchAnalytics/query`]: () => [
        403,
        {
          error: {
            code: 403,
            message: "User does not have sufficient permission for site 'sc-domain:example.com'.",
            status: "PERMISSION_DENIED",
          },
        },
      ],
    }),
  );
  const home = tmp();
  store(home);
  try {
    await assert.rejects(fetchWith(g, home), e => {
      assert.match(e.message, /doesn't have access to sc-domain:example\.com/);
      assert.match(e.message, /Users and permissions/);
      return true;
    });
  } finally {
    await g.close();
  }

  const g2 = await fakeGoogle(
    apiRoutes({
      "POST /data/v1beta/properties/222:runReport": () =>
        busy++ < 5 ? [429, { error: { code: 429, message: "Quota exceeded" } }, { "retry-after": "0" }] : [200, {}],
    }),
  );
  try {
    const r = await fetchWith(g2, home, { ga4Property: "222" });
    assert.equal(g2.hits.filter(h => h.path.endsWith(":runReport")).length, 2, "retried once");
    assert.ok(
      r.notes.some(n => /too many requests/i.test(n) && /Analytics/.test(n)),
      r.notes.join("\n"),
    );
    assert.deepEqual(r.analytics, {});
    assert.ok(Object.keys(r.traffic).length, "the rest of the pull still lands");
  } finally {
    await g2.close();
  }
});

test("fetch: no matching property, no sitemap and no analytics scope are explained plainly", async () => {
  const g = await fakeGoogle(
    apiRoutes({ [`GET /webmasters/v3/sites/sc-domain:example.com/sitemaps`]: () => [200, {}] }),
  );
  const home = tmp();
  store(home, { scope: SC });
  try {
    await assert.rejects(
      fetchWith(g, home, { site: "https://www.nothere.com" }),
      e => /isn't in the Search Console properties/.test(e.message) && /sc-domain:example\.com/.test(e.message),
    );
    const r = await fetchWith(g, home);
    assert.ok(r.notes.some(n => /No sitemap is submitted/.test(n)));
    assert.ok(r.notes.some(n => /Google Analytics wasn't included/.test(n)));
    assert.equal(
      g.hits.some(h => h.path.startsWith("/admin") || h.path.startsWith("/data")),
      false,
    );
  } finally {
    await g.close();
  }
});

test("fetch from the CLI writes seo-audit/google.json", async () => {
  const g = await fakeGoogle(apiRoutes()),
    home = tmp(),
    dir = tmp();
  store(home);
  try {
    const { stdout } = await node(
      [
        CLI,
        "fetch",
        "--site",
        "https://www.example.com",
        "--days",
        "28",
        "--ga4-property",
        "222",
        "--out",
        join(dir, "google.json"),
      ],
      { env: { ...homeEnv(home), ...g.env }, cwd: dir },
    );
    const r = JSON.parse(readFileSync(join(dir, "google.json"), "utf8"));
    assert.deepEqual(Object.keys(r), [
      "source",
      "site",
      "properties",
      "period",
      "traffic",
      "queries",
      "pageQueries",
      "inspection",
      "sitemaps",
      "analytics",
      "findings",
      "notes",
    ]);
    assert.match(r.period, /^Last 28 days/);
    assert.match(stdout, /wrote/);
  } finally {
    await g.close();
  }
});
