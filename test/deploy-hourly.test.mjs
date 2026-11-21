// deploy-check.mjs --search-console: hourly clicks since a deploy against the same hours a week before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { searchHourly } from "../skills/seo-supervisor/scripts/deploy-check.mjs";

const CLI = join(SCRIPTS, "deploy-check.mjs"),
  SITE = "https://www.example.com";
const SC = "https://www.googleapis.com/auth/webmasters.readonly";
const HOUR = 36e5,
  DAY = 864e5,
  WEEK = 7 * DAY;
const NOW = Date.parse("2026-11-22T12:20:00Z"),
  LATEST = Date.parse("2026-11-22T09:00:00Z"); // Google's latest hour
// An hour as Search Console writes it: Pacific Time with its offset (-08:00 in November).
const ptKey = h => new Date(h - 8 * HOUR).toISOString().slice(0, 19) + "-08:00";

// One local server plays Google. clicksAt(hour start in ms, latest) gives each hour's clicks (impressions are clicks *
// 20); latest() is the last hour with a row, read once a request; metadata is sent as is.
async function fakeGoogle(clicksAt, { latest = () => LATEST, metadata } = {}) {
  const hits = [];
  const query = () => {
    const rows = [],
      L = latest();
    for (let h = L - 10 * DAY; h <= L; h += HOUR) {
      const c = clicksAt(h, L);
      if (c != null) rows.push({ keys: [ptKey(h)], clicks: c, impressions: c * 20, ctr: 0.05, position: 8 });
    }
    return [
      200,
      {
        rows: rows.sort((a, b) => b.clicks - a.clicks),
        responseAggregationType: "byProperty",
        ...(metadata ? { metadata } : {}),
      },
    ];
  };
  const routes = {
    "POST /token": () => [200, { access_token: "fresh", expires_in: 3599 }],
    "GET /webmasters/v3/sites": () => [
      200,
      {
        siteEntry: [
          { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:127.0.0.1", permissionLevel: "siteOwner" },
        ],
      },
    ],
    "POST /webmasters/v3/sites/sc-domain:example.com/searchAnalytics/query": query,
    "POST /webmasters/v3/sites/sc-domain:127.0.0.1/searchAnalytics/query": query,
  };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => {
      raw += c;
    });
    req.on("end", () => {
      const hit = {
        method: req.method,
        path: decodeURIComponent(new URL(req.url, "http://x").pathname),
        body: /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw) : raw,
      };
      hits.push(hit);
      const [status, json] = routes[`${hit.method} ${hit.path}`]?.(hit) || [
        404,
        { error: { code: 404, message: "no such fake route" } },
      ];
      res.writeHead(status, { "content-type": "application/json", connection: "close" }).end(JSON.stringify(json));
    });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const endpoints = { token: base + "/token", searchConsole: base + "/webmasters/v3" };
  return {
    hits,
    endpoints,
    env: { SEO_GOOGLE_TOKEN_URL: endpoints.token, SEO_GOOGLE_SEARCH_CONSOLE_URL: endpoints.searchConsole },
    close: () =>
      new Promise(c => {
        server.closeAllConnections();
        server.close(c);
      }),
  };
}
function signedIn() {
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
    }),
  );
  return home;
}
const run = async (clicksAt, opts = {}, fake = {}) => {
  const g = await fakeGoogle(clicksAt, fake),
    home = opts.home ?? signedIn();
  try {
    return { r: await searchHourly({ site: SITE, now: NOW, home, endpoints: g.endpoints, ...opts }), hits: g.hits };
  } finally {
    await g.close();
  }
};
// Clicks per hour: `after` from the first hour of the window on, `before` everywhere else.
const AFTER_FROM = LATEST - 23 * HOUR;
const level =
  (before, after, from = AFTER_FROM) =>
  h =>
    h >= from ? after : before;

test("a normal day: the last 24 hours beside the same hours a week before, read as Google documents hourly data", async () => {
  const { r, hits } = await run(level(10, 11));
  assert.equal(r.state, "ok", r.text);
  assert.equal(r.property, "sc-domain:example.com");
  assert.deepEqual(r.after, {
    from: "2026-11-21T10:00:00.000Z",
    to: "2026-11-22T10:00:00.000Z",
    clicks: 264,
    impressions: 5280,
  });
  assert.deepEqual(r.before, {
    from: "2026-11-14T10:00:00.000Z",
    to: "2026-11-15T10:00:00.000Z",
    clicks: 240,
    impressions: 4800,
  });
  assert.deepEqual(r.change, { clicks: 10, impressions: 10 });
  assert.equal(r.hours.length, 24);
  assert.deepEqual(r.hours[0], {
    hour: "2026-11-21T10:00:00.000Z",
    clicks: 11,
    impressions: 220,
    weekBefore: { clicks: 10, impressions: 200 },
  });
  assert.match(r.text, /264, against 240 in the same hours a week before \(\+10%\)/);
  assert.match(r.text, /2026-11-21 10:00 UTC to 2026-11-22 10:00 UTC/);
  const sa = hits.filter(h => h.path.endsWith("/searchAnalytics/query"));
  assert.equal(sa.length, 1, "one request covers both windows");
  // Hours need dataState hourly_all; dates are Pacific Time; hourly data goes back 10 days.
  assert.deepEqual(sa[0].body, {
    startDate: "2026-11-13",
    endDate: "2026-11-22",
    type: "web",
    dimensions: ["hour"],
    dataState: "hourly_all",
  });
});

test("a big drop is a plain warning, with our own line named, and hours Google is still counting are pointed out", async () => {
  const { r } = await run(level(10, 5), {}, { metadata: { firstIncompleteHour: "2026-11-22T00:00:00-08:00" } });
  assert.equal(r.state, "warning");
  assert.equal(r.change.clicks, -50);
  assert.match(r.text, /^Google Search clicks fell 50% /);
  assert.match(r.text, /120, against 240 in the same hours a week before/);
  assert.match(r.text, /30% or more is our own line/);
  assert.ok(
    r.notes.some(n => /still collecting .* from 2026-11-22 08:00 UTC/.test(n)),
    r.notes.join("\n"),
  );
  const { r: dip } = await run(level(10, 8));
  assert.equal(dip.state, "ok", "a 20% dip is under our line");
});

test("--since: only the full hours after the deploy, and a deploy too old or in the future reads nothing", async () => {
  const { r } = await run(level(10, 4, Date.parse("2026-11-22T04:00:00Z")), { since: "2026-11-22T03:30:00Z" });
  assert.equal(r.hours.length, 6, "04:00 to 10:00: the deploy's own hour is left out");
  assert.deepEqual([r.after.from, r.before.from], ["2026-11-22T04:00:00.000Z", "2026-11-15T04:00:00.000Z"]);
  assert.equal(r.state, "too-little-data", "60 clicks a week before is under our own minimum");
  const { r: old, hits } = await run(level(10, 10), { since: "2026-11-19T12:00:00Z" });
  assert.equal(old.state, "skipped");
  assert.match(old.text, /more than 2 days ago/);
  assert.match(old.text, /change-check\.mjs/);
  assert.equal(hits.length, 0, "nothing was read from Google");
  const { r: soon } = await run(level(10, 10), { since: "2026-11-22T13:00:00Z" });
  assert.match(soon.text, /in the future/);
  const { r: early } = await run(level(10, 10), { since: "2026-11-22T11:00:00Z" });
  assert.equal(early.state, "too-little-data");
  assert.match(early.text, /Too early to tell/);
  assert.match(early.text, /isn't a drop/);
});

test("too little data to tell is never a drop, even when the hours after have no clicks at all", async () => {
  const { r } = await run(level(2, 0));
  assert.equal(r.state, "too-little-data");
  assert.match(r.text, /^Too little data to tell: 48 Google Search clicks in the same hours a week before/);
  assert.match(r.text, /at least 100 \(our own minimum\)/);
  assert.match(r.text, /This isn't a drop/);
  const { r: none } = await run(() => null);
  assert.equal(none.state, "too-little-data");
  assert.match(none.text, /no hourly data/);
});

test("Google not connected: one plain line on how to connect, and nothing is sent", async () => {
  const { r, hits } = await run(level(10, 10), { home: tmp() });
  assert.equal(r.state, "skipped");
  assert.match(r.text, /^Google Search wasn't read: not connected to Google yet\. Run node google\.mjs connect/);
  assert.equal(hits.length, 0);
  const g = await fakeGoogle(level(10, 10));
  try {
    const r2 = await searchHourly({
      site: "https://elsewhere.example.org",
      now: NOW,
      home: signedIn(),
      endpoints: g.endpoints,
    });
    assert.equal(r2.state, "skipped");
    assert.match(r2.text, /isn't in the Search Console properties/);
  } finally {
    await g.close();
  }
});

// ---------- the command line ----------
async function site(routes) {
  const server = createServer((req, res) => {
    const r = routes[req.url];
    if (!r) return res.writeHead(404, { "content-type": "text/plain" }).end("no");
    res.writeHead(r[0], r[1]).end(r[2]);
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(ok => server.close(ok)) };
}
const page = (canonical, extra = "") =>
  `<!doctype html><html><head><title>Home</title><link rel="canonical" href="${canonical}">${extra}</head><body>Hi</body></html>`;
// Rows relative to the real clock: Google's latest hour is 3 hours back, and clicks halve over the last 24 hours.
const realLatest = () => Math.floor(Date.now() / HOUR) * HOUR - 3 * HOUR;
const halved = (h, latest) => (h > latest - 24 * HOUR ? 5 : 10);

test("the CLI shows the hourly part after the checks, adds it to --json, and never changes the exit code", async () => {
  const routes = {
    "/": [200, { "content-type": "text/html" }, ""],
    "/robots.txt": [200, { "content-type": "text/plain" }, "User-agent: *\nAllow: /\n"],
  };
  const s = await site(routes),
    g = await fakeGoogle(halved, { latest: realLatest }),
    home = signedIn();
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...g.env };
  const cli = args =>
    node([CLI, "--site", s.url, ...args], { env }).then(
      o => ({ code: 0, ...o }),
      e => e,
    );
  try {
    routes["/"][2] = page(s.url + "/");
    const text = await cli(["--search-console"]);
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /No blockers/);
    assert.match(text.stdout, /\n {2}WARNING +Google Search clicks fell 50% /);
    assert.match(text.stdout, /fresh and noisy/);
    assert.match(text.stdout, /never fails the deploy check/);
    const json = JSON.parse((await cli(["--search-console", "--json"])).stdout);
    assert.equal(json.searchConsole.state, "warning");
    assert.equal(json.searchConsole.property, "sc-domain:127.0.0.1");
    assert.equal(json.blockers, 0);
    const plain = JSON.parse((await cli(["--json"])).stdout);
    assert.equal(plain.searchConsole, undefined, "opt-in: without the flag, Google isn't asked");
    // A blocker still fails the run, the same with or without the hourly part.
    routes["/"][2] = page(s.url + "/", '<meta name="robots" content="noindex">');
    const [withSc, without] = [await cli(["--search-console", "--json"]), await cli(["--json"])];
    assert.deepEqual([withSc.code, without.code], [1, 1]);
    assert.equal(JSON.parse(withSc.stdout).blockers, JSON.parse(without.stdout).blockers);
    // --since needs --search-console and a time with its zone.
    for (const bad of [
      ["--since", "2026-11-22T10:00:00Z"],
      ["--search-console", "--since", "yesterday"],
      ["--search-console", "--since", "2026-11-22T10:00"],
    ])
      assert.equal((await cli(bad)).code, 2, bad.join(" "));
    assert.match((await cli(["--since", "x"])).stderr, /never fails the check/, "the usage text says so");
  } finally {
    await s.close();
    await g.close();
  }
});

test("the CLI with Google not connected prints one line on how to connect and runs the rest as usual", async () => {
  const routes = {
    "/": [200, { "content-type": "text/html" }, ""],
    "/robots.txt": [200, { "content-type": "text/plain" }, "User-agent: *\nAllow: /\n"],
  };
  const s = await site(routes),
    home = tmp();
  try {
    routes["/"][2] = page(s.url + "/");
    const { stdout } = await node([CLI, "--site", s.url, "--search-console"], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.match(stdout, /OK +The home page answers 200/);
    assert.match(
      stdout,
      /SKIPPED +Google Search wasn't read: not connected to Google yet\. Run node google\.mjs connect/,
    );
    assert.doesNotMatch(stdout, /fresh and noisy/);
  } finally {
    await s.close();
  }
});
