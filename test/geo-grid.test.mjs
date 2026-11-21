import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { gridPoints, LABEL } from "../skills/seo-supervisor/scripts/geo-grid.mjs";

const GRID = join(SCRIPTS, "geo-grid.mjs"),
  KEYS = join(SCRIPTS, "connect-keys.mjs");
const KEY = "AIzaFakeKey-0123456789abcd";
const OWN = "ChIJown_business_0001",
  XSS = "<img src=x onerror=alert(1)>";
const TODAY = new Date().toISOString().slice(0, 10);
const DEG_KM = (6371.0088 * Math.PI) / 180; // km in one degree of latitude
const near = (a, b, tol = 2e-5) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

// One local server for Places API (New). routes: "GET /v1/places/<id>" or "POST /v1/places:searchText" ->
// (hit, n) => [status, json], n counting that route's hits from 0.
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
        route = `${req.method} ${decodeURIComponent(u.pathname)}`;
      let body = raw;
      try {
        body = JSON.parse(raw);
      } catch {}
      const hit = { route, url: req.url, headers: req.headers, body };
      hits.push(hit);
      seen[route] = (seen[route] ?? -1) + 1;
      const [status, x] = routes[route]?.(hit, seen[route]) || [
        404,
        { error: { code: 404, message: "no fake route", status: "NOT_FOUND" } },
      ];
      res.writeHead(status, { "content-type": "application/json", connection: "close" }).end(JSON.stringify(x));
    });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    hits,
    searches: () => hits.filter(h => h.route === "POST /v1/places:searchText"),
    close: () =>
      new Promise(c => {
        server.closeAllConnections();
        server.close(c);
      }),
  };
}
// A temp home keeps the developer's real key out; Google points at the fake.
const envFor = (home, srv, extra = {}) => ({
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  GOOGLE_PLACES_API_KEY: "",
  ...(srv ? { GOOGLE_PLACES_ENDPOINT: srv.url + "/v1" } : {}),
  ...extra,
});
const grid = (home, srv, args, extra = { GOOGLE_PLACES_API_KEY: KEY }) =>
  node([GRID, "--out", join(home, "seo-audit", "geo-grid.json"), ...args], {
    env: envFor(home, srv, extra),
    cwd: home,
  });
const output = home => JSON.parse(readFileSync(join(home, "seo-audit", "geo-grid.json"), "utf8"));
const googleError = (code, status, reason, message) => [
  code,
  {
    error: {
      code,
      message,
      status,
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason,
          domain: "googleapis.com",
          metadata: { service: "places.googleapis.com" },
        },
      ],
    },
  },
];

// A page of results: other businesses (with names, which Google wouldn't send for an IDs-only mask, to prove they're
// never copied), and the business itself at `at` (1-based), or nowhere.
const rival = i => ({
  id: `ChIJrival_${String(i).padStart(3, "0")}`,
  displayName: { text: `Rival ${i} ${XSS}` },
  formattedAddress: `${i} High Street`,
});
const page = at => {
  const p = Array.from({ length: 20 }, (_, i) => rival(i));
  if (at) p.splice(at - 1, 1, { id: OWN });
  return [200, { places: p }];
};
const DETAILS = { [`GET /v1/places/${OWN}`]: () => [200, { id: OWN, location: { latitude: 53.8, longitude: -1.55 } }] };

test("the grid: rows run north to south, columns west to east, the centre is the business, east-west steps scale by cos(latitude)", () => {
  const c = { lat: 60, lng: 10 },
    cells = gridPoints(c, 7, 1);
  assert.equal(cells.length, 49);
  assert.deepEqual(
    cells.slice(0, 2).map(x => [x.row, x.col]),
    [
      [0, 0],
      [0, 1],
    ],
    "row by row, from the north-west corner",
  );
  const at = (r, col) => cells.find(x => x.row === r && x.col === col);
  assert.deepEqual(at(3, 3), { row: 3, col: 3, lat: 60, lng: 10 }, "the centre cell is [floor(size/2), floor(size/2)]");
  near(at(0, 3).lat - 60, 3 / DEG_KM);
  near(at(6, 3).lat - 60, -3 / DEG_KM);
  assert.ok(at(0, 3).lat > at(1, 3).lat && at(5, 3).lat > at(6, 3).lat, "row 0 is the north edge");
  assert.ok(at(3, 0).lng < at(3, 1).lng && at(3, 5).lng < at(3, 6).lng, "col 0 is the west edge");
  // At 60° a degree of longitude is half as long as at the equator, so 1 km east is twice as many degrees.
  near(at(3, 4).lng - 10, 2 / DEG_KM);
  near(at(3, 6).lng - 10, 6 / DEG_KM);
  const eq = gridPoints({ lat: 0, lng: 0 }, 5, 2);
  near(eq.find(x => x.row === 2 && x.col === 3).lng, 2 / DEG_KM);
  assert.deepEqual(
    eq.find(x => x.row === 2 && x.col === 2),
    { row: 2, col: 2, lat: 0, lng: 0 },
  );
  assert.equal(gridPoints(c, 9, 1).length, 81);
  assert.deepEqual(
    gridPoints(c, 9, 1).find(x => x.row === 4 && x.col === 4),
    { row: 4, col: 4, lat: 60, lng: 10 },
  );
  for (const x of gridPoints({ lat: 51.123456789, lng: -0.987654321 }, 5, 0.37))
    for (const v of [x.lat, x.lng]) assert.equal(v, Math.round(v * 1e5) / 1e5, "5 decimals");
  assert.ok(
    gridPoints({ lat: -17.8, lng: 179.999 }, 5, 1).every(x => x.lng >= -180 && x.lng <= 180),
    "longitudes stay in range across 180°",
  );
});

test("records the position of the business's place ID at each point: found, not in the top 20, and the request it sends", async () => {
  const home = tmp(),
    srv = await fake({
      ...DETAILS,
      // plumber: the n-th search is cell n, row by row; the business sits at row*3 + 1, absent from the last column.
      "POST /v1/places:searchText": ({ body }, n) =>
        body.textQuery === "plumber" ? page(n % 7 === 6 ? null : Math.floor(n / 7) * 3 + 1) : [200, {}],
    });
  try {
    const r = await grid(home, srv, ["--place-id", OWN, "--keywords", "plumber, boiler repair", "--yes"]);
    assert.equal(srv.hits.length, 1 + 2 * 49, "one lookup, then one search per point per keyword, no extra pages");
    const d = srv.hits[0];
    assert.equal(d.route, `GET /v1/places/${OWN}`);
    assert.equal(d.headers["x-goog-fieldmask"], "id,location");
    assert.equal(d.headers["x-goog-api-key"], KEY);
    assert.ok(!d.url.includes(KEY), "the key goes in a header, never in the address");

    const s = srv.searches(),
      out = output(home);
    for (const h of s) {
      assert.equal(h.headers["x-goog-fieldmask"], "places.id,places.attributions", "IDs-only fields");
      assert.equal(h.headers["x-goog-api-key"], KEY);
      assert.deepEqual(
        Object.keys(h.body).sort(),
        ["includePureServiceAreaBusinesses", "locationBias", "textQuery"],
        "default ranking: no rankPreference, no pageToken",
      );
      assert.equal(h.body.locationBias.circle.radius, 500, "half the spacing");
    }
    assert.deepEqual(
      s.map(h => h.body.textQuery),
      [...Array(49).fill("plumber"), ...Array(49).fill("boiler repair")],
      "the bare keyword",
    );
    assert.deepEqual(s[0].body.locationBias.circle.center, {
      latitude: out.keywords[0].cells[0].lat,
      longitude: out.keywords[0].cells[0].lng,
    });
    assert.deepEqual(
      s[24].body.locationBias.circle.center,
      { latitude: 53.8, longitude: -1.55 },
      "the 25th point is the centre",
    );

    assert.deepEqual(Object.keys(out), [
      "source",
      "date",
      "placeId",
      "center",
      "size",
      "spacingKm",
      "biasRadiusM",
      "attribution",
      "label",
      "keywords",
      "notes",
    ]);
    assert.deepEqual(
      [
        out.source,
        out.date,
        out.placeId,
        out.center,
        out.size,
        out.spacingKm,
        out.biasRadiusM,
        out.attribution,
        out.label,
      ],
      ["geo-grid", TODAY, OWN, { lat: 53.8, lng: -1.55 }, 7, 1, 500, "Google Maps", LABEL],
    );
    assert.equal(
      LABEL,
      "Where your business appears in the list Google's Places API returns near each point: an approximation of Google Maps results, not a copy.",
    );
    const [p, b] = out.keywords;
    assert.deepEqual(Object.keys(p), ["keyword", "cells", "top3", "top10", "top20", "notFound", "failed"]);
    assert.equal(p.keyword, "plumber");
    assert.deepEqual(p.cells[0], { row: 0, col: 0, lat: p.cells[0].lat, lng: p.cells[0].lng, rank: 1 });
    assert.deepEqual(
      p.cells.map(c => c.rank),
      Array.from({ length: 49 }, (_, n) => (n % 7 === 6 ? null : Math.floor(n / 7) * 3 + 1)),
    );
    assert.deepEqual([p.top3, p.top10, p.top20, p.notFound, p.failed], [6, 24, 42, 7, 0]);
    assert.deepEqual(
      [b.keyword, b.top3, b.top10, b.top20, b.notFound, b.failed],
      ["boiler repair", 0, 0, 0, 49, 0],
      "no places at all: not in the top 20",
    );
    assert.ok(b.cells.every(c => c.rank === null));
    assert.match(out.notes.join("\n"), /30 days/, "a centre from Google may be kept for 30 days only");

    // Nothing but place IDs and positions: no rival's ID, name or address.
    const file = readFileSync(join(home, "seo-audit", "geo-grid.json"), "utf8");
    assert.doesNotMatch(file, /ChIJrival|Rival|High Street|img src/);
    assert.match(r.stdout, /"plumber": in the top 3 at 6 of 49 points · top 10 at 24 · not in the top 20 at 7/);
    assert.match(r.stdout, /"boiler repair": in the top 3 at 0 of 49 points · top 10 at 0 · not in the top 20 at 49/);
    assert.ok(r.stdout.includes(LABEL));
    assert.match(r.stdout, /Google Maps/);
    assert.doesNotMatch(r.stdout + r.stderr, /Rival|High Street/);
    assert.ok(!(r.stdout + r.stderr + file).includes(KEY), "the key never appears in any output");
  } finally {
    await srv.close();
  }
});

test("--center skips the location lookup (only a free ID check), --size and --spacing set the grid, attributions are kept", async () => {
  const home = tmp(),
    srv = await fake({
      [`GET /v1/places/${OWN}`]: () => [200, { id: OWN }],
      "POST /v1/places:searchText": () => [
        200,
        {
          places: [
            {
              id: "ChIJrival_000",
              attributions: [{ provider: "Example Data Co", providerUri: "https://data.example" }],
            },
            { id: OWN },
          ],
        },
      ],
    });
  try {
    await grid(home, srv, [
      "--place-id",
      OWN,
      "--keywords",
      "dentist",
      "--center",
      "-33.86882,151.20929",
      "--size",
      "5",
      "--spacing",
      "3",
      "--yes",
    ]);
    assert.equal(srv.hits[0].headers["x-goog-fieldmask"], "id", "the place ID check asks for the ID only");
    assert.equal(srv.searches().length, 25);
    assert.equal(srv.searches()[0].body.locationBias.circle.radius, 1500);
    const out = output(home);
    assert.deepEqual(
      [out.center, out.size, out.spacingKm, out.biasRadiusM],
      [{ lat: -33.86882, lng: 151.20929 }, 5, 3, 1500],
    );
    assert.ok(out.keywords[0].cells.every(c => c.rank === 2));
    assert.deepEqual(out.keywords[0].cells[12], { row: 2, col: 2, lat: -33.86882, lng: 151.20929, rank: 2 });
    assert.ok(
      out.notes.some(n => n.includes("Example Data Co") && n.includes("https://data.example")),
      out.notes.join("\n"),
    );
    assert.ok(!out.notes.some(n => /30 days/.test(n)), "no Google coordinates kept");
  } finally {
    await srv.close();
  }
});

test("without --yes it's a dry run: the number of requests, the free tier with the date, what goes, the EEA note; nothing is sent", async () => {
  const home = tmp(),
    srv = await fake({ ...DETAILS, "POST /v1/places:searchText": () => page(1) });
  try {
    const r = await grid(home, srv, ["--place-id", OWN, "--keywords", "plumber,boiler repair,gas engineer"]);
    assert.equal(srv.hits.length, 0);
    assert.equal(existsSync(join(home, "seo-audit", "geo-grid.json")), false);
    assert.match(r.stdout, /dry run, nothing sent/);
    assert.match(r.stdout, /147 searches/);
    assert.match(r.stdout, /148 requests in all/);
    assert.match(r.stdout, /7 × 7 grid, 1 km apart/);
    assert.match(r.stdout, /"plumber", "boiler repair", "gas engineer"/);
    assert.match(r.stdout, /place IDs only/);
    assert.match(r.stdout, /free without limit/);
    assert.match(r.stdout, /22 Nov 2026/);
    assert.match(r.stdout, /10,000 free a month/, "the location lookup's tier");
    assert.match(r.stdout, /billing/);
    assert.match(r.stdout, /European Economic Area/);
    assert.match(r.stdout, /rank tracking/);
    assert.match(r.stdout, /your decision/);
    assert.match(r.stdout, /from GOOGLE_PLACES_API_KEY/);
    assert.match(r.stdout, /--yes/);
    assert.ok(!(r.stdout + r.stderr).includes(KEY));
    const c = await grid(home, srv, [
      "--place-id",
      OWN,
      "--keywords",
      "plumber",
      "--center",
      "53.8,-1.55",
      "--size",
      "5",
    ]);
    assert.match(c.stdout, /25 searches/);
    assert.match(c.stdout, /26 requests in all/);
    assert.match(c.stdout, /53\.8, -1\.55/);
    const none = await grid(home, srv, ["--place-id", OWN, "--keywords", "plumber"], {});
    assert.match(none.stdout, /no Google Places key[^\n]*connect-keys\.mjs guide googleplaces/i);
    assert.equal(srv.hits.length, 0);
  } finally {
    await srv.close();
  }
});

test("a refused key, a turned-off API, no billing or a rate limit: a plain message; points done are kept, the rest marked error", async () => {
  const home = tmp(),
    srv = await fake({
      ...DETAILS,
      "POST /v1/places:searchText": (hit, n) =>
        n < 9
          ? page(2)
          : googleError(
              403,
              "PERMISSION_DENIED",
              "SERVICE_DISABLED",
              "Places API (New) has not been used in project 123 before or it is disabled.",
            ),
    });
  try {
    await assert.rejects(grid(home, srv, ["--place-id", OWN, "--keywords", "plumber,boiler repair", "--yes"]), e => {
      assert.equal(e.code, 1);
      assert.match(e.stdout, /Places API \(New\) isn't turned on[^\n]*Enable/);
      assert.ok(!(e.stdout + e.stderr).includes(KEY));
      return true;
    });
    assert.equal(srv.searches().length, 10, "the run stops at the first refusal");
    const [p, b] = output(home).keywords;
    assert.deepEqual(
      p.cells.slice(0, 9).map(c => c.rank),
      Array(9).fill(2),
    );
    assert.ok(p.cells.slice(9).every(c => c.rank === "error") && b.cells.every(c => c.rank === "error"));
    assert.deepEqual([p.top3, p.failed, p.notFound, b.failed], [9, 40, 0, 49]);
    assert.match(output(home).notes.join("\n"), /isn't turned on/);
  } finally {
    await srv.close();
  }

  for (const [reply, re] of [
    [
      googleError(400, "INVALID_ARGUMENT", "API_KEY_INVALID", "API key not valid. Please pass a valid API key."),
      /didn't accept the key[^\n]*connect-keys\.mjs set googleplaces/,
    ],
    [
      googleError(403, "PERMISSION_DENIED", "BILLING_DISABLED", "This API method requires billing to be enabled."),
      /billing isn't turned on[^\n]*even when/,
    ],
    [
      googleError(403, "PERMISSION_DENIED", "API_KEY_SERVICE_BLOCKED", "Requests to this API are blocked."),
      /isn't allowed to use Places API \(New\)/,
    ],
    [
      [429, { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }],
      /too many requests \(429\)/,
    ],
    [
      googleError(404, "NOT_FOUND", "NOT_FOUND", "Not found."),
      /no place with this place ID[^\n]*places-placeid-finder/,
    ],
  ]) {
    const h = tmp(),
      s = await fake({ [`GET /v1/places/${OWN}`]: () => reply });
    try {
      await assert.rejects(
        grid(h, s, ["--place-id", OWN, "--keywords", "plumber", "--yes"]),
        e => e.code === 1 && re.test(e.stdout) && !(e.stdout + e.stderr).includes(KEY),
      );
      assert.equal(s.searches().length, 0, "a bad key or place ID stops before the grid");
      assert.equal(existsSync(join(h, "seo-audit", "geo-grid.json")), false);
    } finally {
      await s.close();
    }
  }
});

test("a business with no map position (service area only) needs --center", async () => {
  const home = tmp(),
    srv = await fake({ [`GET /v1/places/${OWN}`]: () => [200, { id: OWN }] });
  try {
    await assert.rejects(
      grid(home, srv, ["--place-id", OWN, "--keywords", "plumber", "--yes"]),
      e => e.code === 1 && /--center/.test(e.stdout),
    );
    assert.equal(srv.searches().length, 0);
  } finally {
    await srv.close();
  }
});

test("--find shows Google's matches on screen and saves only the place ID picked", async () => {
  const home = tmp(),
    srv = await fake({
      "POST /v1/places:searchText": () => [
        200,
        {
          places: [
            {
              id: "ChIJcandidate_A",
              displayName: { text: "Leeds Plumbing Co" },
              formattedAddress: "1 Park Row, Leeds",
            },
            {
              id: "ChIJcandidate_B",
              displayName: { text: "Leeds Plumbing Co\u001b[2J" },
              formattedAddress: "9 Briggate, Leeds",
            },
          ],
        },
      ],
    });
  try {
    const dry = await grid(home, srv, ["--find", "Leeds Plumbing Co, Leeds"]);
    assert.equal(srv.hits.length, 0);
    assert.match(dry.stdout, /dry run, nothing sent/);
    assert.match(dry.stdout, /5,000 free a month/);
    assert.match(dry.stdout, /22 Nov 2026/);

    const p = grid(home, srv, ["--find", "Leeds Plumbing Co, Leeds", "--yes"]);
    p.child.stdin.end("2\n");
    const r = await p;
    const h = srv.hits[0];
    assert.deepEqual(h.body, { textQuery: "Leeds Plumbing Co, Leeds", pageSize: 5 });
    assert.equal(h.headers["x-goog-fieldmask"], "places.id,places.displayName,places.formattedAddress");
    assert.match(r.stdout, /1\. Leeds Plumbing Co, 1 Park Row, Leeds/);
    assert.match(r.stdout, /2\. Leeds Plumbing Co\b/);
    assert.ok(!r.stdout.includes("\u001b"), "control characters from Google's text are dropped");
    const saved = readFileSync(join(home, "seo-audit", "geo-grid-place.json"), "utf8");
    assert.deepEqual(JSON.parse(saved), { placeId: "ChIJcandidate_B" });
    assert.doesNotMatch(saved, /Leeds|Park Row|Briggate/);
    assert.ok(!(r.stdout + r.stderr).includes(KEY));

    // The saved ID is used when --place-id isn't given.
    const next = await grid(home, srv, ["--keywords", "plumber"]);
    assert.match(next.stdout, /ChIJcandidate_B/);

    const q = grid(home, srv, ["--find", "Leeds Plumbing Co, Leeds", "--yes"]);
    q.child.stdin.end("\n");
    const skip = await q;
    assert.match(skip.stdout, /Nothing saved/);
    assert.deepEqual(JSON.parse(readFileSync(join(home, "seo-audit", "geo-grid-place.json"), "utf8")), {
      placeId: "ChIJcandidate_B",
    });
  } finally {
    await srv.close();
  }
});

test("checks its input: 1 to 3 keywords, size 5, 7 or 9, a sane spacing, a place ID, a centre, and a key with --yes", async () => {
  const home = tmp(),
    bad = async (args, re, extra) =>
      assert.rejects(grid(home, null, args, extra), e => e.code === 2 && re.test(e.stderr));
  await bad(["--place-id", OWN, "--keywords", "a,b,c,d"], /at most 3[^\n]*our own/);
  await bad(["--place-id", OWN], /--keywords/);
  await bad(["--place-id", OWN, "--keywords", "plumber", "--size", "6"], /5, 7 or 9/);
  await bad(["--place-id", OWN, "--keywords", "plumber", "--spacing", "0"], /--spacing/);
  await bad(["--place-id", OWN, "--keywords", "plumber", "--center", "91,0"], /--center/);
  await bad(["--place-id", "../../etc", "--keywords", "plumber"], /place ID[^\n]*places-placeid-finder/);
  await bad(["--keywords", "plumber"], /--place-id[^\n]*--find/);
  await bad(["--place-id", OWN, "--keywords", "plumber", "--yes"], /guide googleplaces/, {});
  await assert.rejects(
    grid(home, null, []),
    e => e.code === 2 && /places-placeid-finder/.test(e.stderr) && /countryside/.test(e.stderr),
  );
});

test("connect-keys knows googleplaces: a hidden prompt, a masked status and a guide; fetch doesn't use it", async () => {
  const home = tmp(),
    env = envFor(home, null);
  const p = node([KEYS, "set", "googleplaces"], { env });
  p.child.stdin.end("AIzaSavedKey-wxyz9876\n");
  await p;
  const s = (await node([KEYS, "status"], { env })).stdout;
  assert.match(s, /Google Places API: set \(…9876/);
  assert.doesNotMatch(s, /AIzaSavedKey-wxyz9876/);
  const g = (await node([KEYS, "guide", "googleplaces"], { env })).stdout;
  for (const re of [
    /console\.cloud\.google\.com/,
    /Places API \(New\)/,
    /Enable/,
    /API restrictions/,
    /billing/i,
    /even (when|if)/,
    /node connect-keys\.mjs set googleplaces(?! <)/,
    /geo-grid\.mjs/,
  ])
    assert.match(g, re);
  const f = await node([KEYS, "fetch", "--site", "https://www.example.com", "--out", join(home, "k.json")], { env });
  assert.doesNotMatch(f.stdout, /Google Places/, "fetch doesn't use it");
  mkdirSync(join(home, "seo-audit"), { recursive: true });
  writeFileSync(join(home, "seo-audit", "geo-grid-place.json"), JSON.stringify({ placeId: OWN }));
  const dry = await grid(home, null, ["--keywords", "plumber"], {});
  assert.match(dry.stdout, /saved in/);
  assert.ok(!dry.stdout.includes("AIzaSavedKey-wxyz9876"));
});
