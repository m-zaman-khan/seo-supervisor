import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import { OSM_TAGS } from "../skills/seo-supervisor/scripts/osm.mjs";
import { BUSINESS_TYPES } from "../skills/seo-supervisor/scripts/checks/business-type.mjs";

const ORIGIN = "https://site.example";
const XSS = "<img src=x onerror=alert(1)>";
const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const page = (title, body = "", head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;
const ld = x =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...x })}</script>`;
const plumber = more => ld({ "@type": "Plumber", name: "Northwind Plumbing", telephone: "+44 113 496 0000", ...more });
const PARK_ROW = {
  "@type": "PostalAddress",
  streetAddress: "12 Park Row",
  addressLocality: "Leeds",
  postalCode: "LS1 5JL",
  addressCountry: "GB",
};
const CALL = "<p>Call us on 0113 496 0000.</p>";

async function crawlSite(pages) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir);
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--site-origin", ORIGIN, "--out", out]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const localNotes = r => r.notes.filter(n => /LOCAL-0[56]/.test(n));

// ---------- storefront, service-area business or both ----------

test("an ordinary storefront is a storefront, with its address and geo, and no new finding or note", async () => {
  const r = await crawlSite({
    "/": page(
      "Boiler repairs in Leeds",
      `${CALL}<p>Visit us at 12 Park Row, Leeds LS1 5JL.</p><a href="/about/">About</a>`,
      plumber({ address: PARK_ROW, geo: { "@type": "GeoCoordinates", latitude: 53.7976, longitude: "-1.5453" } }),
    ),
    "/about/": page("About Northwind Plumbing", CALL),
  });
  const lb = r.localBusiness;
  assert.equal(lb.kind, "storefront");
  assert.equal(lb.name, "Northwind Plumbing");
  assert.equal(lb.type, "Plumber");
  assert.deepEqual(lb.address, {
    streetAddress: "12 Park Row",
    addressLocality: "Leeds",
    postalCode: "LS1 5JL",
    addressCountry: "GB",
  });
  assert.deepEqual(lb.geo, { lat: 53.7976, lon: -1.5453 });
  assert.deepEqual(lb.areas, []);
  assert.ok(
    lb.evidence.some(e => /12 Park Row.*shown on \//.test(e)),
    lb.evidence.join("\n"),
  );
  assert.ok(!findingOf(r, "nap-not-shown"));
  assert.deepEqual(localNotes(r), []);
});

test("a site with no local business schema gets no localBusiness, even when it says it comes to you", async () => {
  const r = await crawlSite({
    "/": page(
      "Consulting for growing teams",
      "<p>We come to your office for the workshop.</p>",
      ld({
        "@type": "Organization",
        name: "Northwind Consulting",
        address: { "@type": "PostalAddress", streetAddress: "1 Hidden Way" },
      }),
    ),
  });
  assert.equal(r.localBusiness, undefined);
  assert.deepEqual(localNotes(r), []);
});

test("a business with a town address and areaServed, that comes to its customers, is a service-area business", async () => {
  const r = await crawlSite({
    "/": page(
      "Emergency plumber in Leeds",
      `${CALL}<p>We'll come to you anywhere in Leeds or Bradford, day or night.</p>`,
      plumber({
        address: {
          "@type": "PostalAddress",
          addressLocality: "Leeds",
          addressRegion: "West Yorkshire",
          postalCode: "LS1",
          addressCountry: { "@type": "Country", name: "GB" },
        },
        areaServed: [{ "@type": "City", name: "Leeds" }, "Bradford"],
      }),
    ),
  });
  const lb = r.localBusiness;
  assert.equal(lb.kind, "service-area");
  assert.deepEqual(lb.areas, ["Leeds", "Bradford"]);
  assert.deepEqual(lb.address, {
    addressLocality: "Leeds",
    addressRegion: "West Yorkshire",
    postalCode: "LS1",
    addressCountry: "GB",
  });
  assert.ok(lb.evidence.includes("no street address in the schema"), lb.evidence.join("\n"));
  assert.ok(lb.evidence.includes("text: “We'll come to you” on /"), lb.evidence.join("\n"));
  assert.ok(!findingOf(r, "nap-not-shown"));
  assert.deepEqual(localNotes(r), []);
});

test("a service-area business's street address in the schema but on no page isn't flagged; a note says what to do", async () => {
  const r = await crawlSite({
    "/": page(
      "Emergency plumber in Leeds",
      `${CALL}<p>Our engineers will come to your home anywhere in Leeds.</p><a href="/prices/">Prices</a>`,
      plumber({ address: { "@type": "PostalAddress", streetAddress: "4 Home Lane", addressLocality: "Leeds" } }),
    ),
    "/prices/": page(
      "Plumbing prices in Leeds",
      CALL,
      plumber({ address: { "@type": "PostalAddress", streetAddress: "4 Home Lane", addressLocality: "Leeds" } }),
    ),
  });
  assert.equal(r.localBusiness.kind, "service-area");
  assert.equal(r.localBusiness.streetHidden, true);
  assert.ok(!findingOf(r, "nap-not-shown"), "the hidden street address isn't a finding");
  assert.ok(
    r.passed.some(p => p.rule === "LOCAL-05"),
    "the phone is still checked",
  );
  const [note, more] = localNotes(r);
  assert.equal(more, undefined);
  assert.match(note, /"4 Home Lane"/); // quoted as site text
  assert.match(note, /LOCAL-06/);
  assert.match(note, /LOCAL-05/);
});

test("a storefront that also travels is hybrid; a storefront that hides its street is still flagged", async () => {
  const hybrid = await crawlSite({
    "/": page(
      "Boiler repairs in Leeds",
      `${CALL}<p>Visit us at 12 Park Row, Leeds LS1 5JL.</p>`,
      plumber({ address: PARK_ROW, areaServed: "Leeds" }),
    ),
  });
  assert.equal(hybrid.localBusiness.kind, "hybrid");
  assert.equal(hybrid.localBusiness.streetHidden, false);
  assert.ok(!findingOf(hybrid, "nap-not-shown"));
  const hidden = await crawlSite({
    "/": page("Boiler repairs in Leeds", CALL, plumber({ address: PARK_ROW })),
  });
  assert.equal(hidden.localBusiness.kind, "storefront");
  assert.match(findingOf(hidden, "nap-not-shown")?.evidence[0].detail || "", /12 Park Row/);
  assert.deepEqual(localNotes(hidden), []);
});

// ---------- osm.mjs ----------

test("every business type maps to OpenStreetMap tags, or is marked as not on a map", () => {
  for (const b of BUSINESS_TYPES) {
    assert.ok(b.id in OSM_TAGS, `${b.id} has no entry`);
    const tags = OSM_TAGS[b.id];
    if (tags) for (const t of tags) assert.match(t, /^[a-z_:]+=[a-z_]+(&[a-z_:]+=[a-z_]+)*$/, `${b.id}: ${t}`);
  }
  assert.equal(OSM_TAGS["online-store"], null);
  assert.deepEqual(OSM_TAGS.plumber, ["craft=plumber"]);
});

const OSM = join(SCRIPTS, "osm.mjs");
// One local server for Nominatim (/search) and Overpass (/interpreter).
async function fakeOsm({ search = () => [200, []], interpreter = () => [200, { elements: [] }] } = {}) {
  const hits = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", c => {
      raw += c;
    });
    req.on("end", () => {
      const u = new URL(req.url, "http://x"),
        hit = { verb: req.method, path: u.pathname, query: u.searchParams, headers: req.headers, body: raw };
      hits.push(hit);
      const [status, x] = (
        u.pathname === "/search" ? search : u.pathname === "/interpreter" ? interpreter : () => [404, {}]
      )(hit);
      res.writeHead(status, { "content-type": "application/json", connection: "close" }).end(JSON.stringify(x));
    });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    hits,
    env: { ...process.env, OSM_NOMINATIM: url + "/search", OSM_OVERPASS: url + "/interpreter" },
    close: () =>
      new Promise(c => {
        server.closeAllConnections();
        server.close(c);
      }),
  };
}
const crawlJson = local => {
  const dir = tmp(),
    f = join(dir, "seo-crawl.json");
  writeFileSync(
    f,
    JSON.stringify({
      tool: "seo-supervisor-crawler",
      businessType: { guess: "plumber", confidence: "strong" },
      localBusiness: local,
    }),
  );
  return { dir, f, out: join(dir, "osm.json") };
};
const STORE = {
  kind: "storefront",
  name: "Northwind Plumbing",
  type: "Plumber",
  address: { streetAddress: "12 Park Row", addressLocality: "Leeds", postalCode: "LS1 5JL", addressCountry: "GB" },
  geo: { lat: 53.7976, lon: -1.5453 },
  areas: [],
};
// About 300 m, 1.5 km and 3 km north of the schema's geo (1° of latitude is about 111.2 km).
const north = m => +(53.7976 + m / 111195).toFixed(6);
const ELEMENTS = [
  { type: "node", id: 1, lat: 53.7976, lon: -1.5453, tags: { craft: "plumber", name: "Northwind Plumbing" } },
  { type: "node", id: 2, lat: north(300), lon: -1.5453, tags: { craft: "plumber", name: `Rival ${XSS}` } },
  { type: "way", id: 3, center: { lat: north(1500), lon: -1.5453 }, tags: { craft: "plumber", name: "Far Pipes" } },
  { type: "node", id: 4, lat: north(900), lon: -1.5453, tags: { craft: "plumber" } },
  { type: "node", id: 5, lat: north(3000), lon: -1.5453, tags: { craft: "plumber", name: "Outside the circle" } },
];

test("osm.mjs is a dry run without --yes: it says what it would send and sends nothing", async () => {
  const srv = await fakeOsm(),
    { f, out } = crawlJson(STORE);
  try {
    const { stdout } = await node([OSM, "--crawl", f, "--out", out], { env: srv.env });
    assert.equal(srv.hits.length, 0);
    assert.match(stdout, /dry run/i);
    assert.match(stdout, /12 Park Row, Leeds, LS1 5JL, GB/);
    assert.match(stdout, /craft=plumber/);
    assert.match(stdout, /2 km/);
    assert.match(stdout, /© OpenStreetMap contributors/);
    assert.match(stdout, /--yes/);
    assert.equal(existsSync(out), false);
  } finally {
    await srv.close();
  }
});

test("osm.mjs --yes checks the address with Nominatim, counts same-type places around the schema's geo with Overpass, and credits OpenStreetMap", async () => {
  const srv = await fakeOsm({
    search: () => [
      200,
      [{ lat: "53.79770", lon: "-1.54540", display_name: "12, Park Row, Leeds, LS1 5JL, United Kingdom" }],
    ],
    interpreter: () => [200, { elements: ELEMENTS }],
  });
  const { f, out } = crawlJson(STORE);
  try {
    await node([OSM, "--crawl", f, "--out", out, "--yes"], { env: srv.env });
    const [search, overpass, more] = srv.hits;
    assert.equal(more, undefined, "one request to each");
    assert.equal(search.path, "/search");
    assert.equal(search.query.get("q"), "12 Park Row, Leeds, LS1 5JL, GB");
    assert.equal(search.query.get("format"), "jsonv2");
    assert.equal(search.query.get("limit"), "1");
    for (const h of [search, overpass])
      assert.match(h.headers["user-agent"], /^seo-supervisor-osm\/\d+\.\d+\.\d+ \(\+https:\/\//);
    const data = new URLSearchParams(overpass.body).get("data");
    assert.match(data, /\[out:json\]/);
    assert.match(data, /nwr\["craft"="plumber"\]\(around:2000,53\.7976,-1\.5453\);/);
    assert.match(data, /out center/);
    const o = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(o.credit, "© OpenStreetMap contributors");
    assert.equal(o.nearby.count, 3, "itself and the one outside the circle aren't counted");
    assert.equal(o.nearby.unnamed, 1);
    assert.equal(o.nearby.perKm2, 0.24);
    assert.equal(o.nearby.centerFrom, "the schema's geo");
    assert.deepEqual(
      o.nearby.places.map(p => [p.name, p.distanceM]),
      [
        [`Rival ${XSS}`, 300],
        ["Far Pipes", 1500],
      ],
    );
    assert.equal(o.nearby.places[1].osm, "way/3");
    assert.deepEqual(o.geocode.found, {
      lat: 53.7977,
      lon: -1.5454,
      label: "12, Park Row, Leeds, LS1 5JL, United Kingdom",
    });
    assert.equal(o.geocode.distanceM, 13);
    assert.equal(o.geocode.suggestGeo, false);
    srv.hits.length = 0;
    await node([OSM, "--crawl", f, "--out", out, "--yes"], { env: srv.env });
    assert.deepEqual(
      srv.hits.map(h => h.path),
      ["/interpreter"],
      "the same address reuses the last run's answer (Nominatim asks for caching)",
    );
    assert.equal(JSON.parse(readFileSync(out, "utf8")).geocode.distanceM, 13);
  } finally {
    await srv.close();
  }
});

test("osm.mjs: a service-area business sends only its town, centres on it and gets no geo to add; a busy Overpass is a note, not retried", async () => {
  const srv = await fakeOsm({
    search: () => [200, [{ lat: "53.8", lon: "-1.55", display_name: "Leeds" }]],
    interpreter: () => [429, { remark: "rate limited" }],
  });
  const { f, out } = crawlJson({
    kind: "service-area",
    name: "Northwind Plumbing",
    address: { streetAddress: "4 Home Lane", addressLocality: "Leeds", addressCountry: "GB" },
    geo: null,
    areas: ["Leeds"],
  });
  try {
    const { stdout } = await node([OSM, "--crawl", f, "--radius", "5000", "--out", out, "--yes"], { env: srv.env });
    assert.equal(srv.hits.filter(h => h.path === "/search").length, 1);
    assert.equal(srv.hits[0].query.get("q"), "Leeds, GB", "the hidden street is never sent");
    assert.equal(srv.hits.filter(h => h.path === "/interpreter").length, 1);
    assert.match(new URLSearchParams(srv.hits[1].body).get("data"), /around:5000,53\.8,-1\.55/);
    const o = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(o.nearby, undefined);
    assert.equal(o.geocode.suggestGeo, false);
    assert.ok(
      o.notes.some(n => /Overpass/.test(n) && /429/.test(n) && /later/.test(n)),
      o.notes.join("\n"),
    );
    assert.match(stdout, /Overpass/);
  } finally {
    await srv.close();
  }
});

test("osm.mjs: no geo in the schema gets one to add; --near and --type override the crawl; bad input stops with a reason", async () => {
  const srv = await fakeOsm({
    search: () => [200, [{ lat: "53.797612345", lon: "-1.545398765", display_name: "Park Row" }]],
    interpreter: () => [200, { elements: [] }],
  });
  const { f, out } = crawlJson({ ...STORE, geo: null });
  try {
    await node([OSM, "--crawl", f, "--out", out, "--yes"], { env: srv.env });
    let o = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(o.geocode.suggestGeo, true);
    assert.equal(o.nearby.centerFrom, "the address, via Nominatim");
    assert.equal(o.nearby.count, 0);
    srv.hits.length = 0;
    await node([OSM, "--type", "cafe", "--near", "51.5,-0.12", "--out", out, "--yes"], { env: srv.env });
    assert.deepEqual(
      srv.hits.map(h => h.path),
      ["/interpreter"],
      "no address, so no Nominatim request",
    );
    assert.match(
      new URLSearchParams(srv.hits[0].body).get("data"),
      /nwr\["amenity"="cafe"\]\(around:2000,51\.5,-0\.12\)/,
    );
    o = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(o.nearby.centerFrom, "--near");
    assert.equal(o.geocode, undefined);
    srv.hits.length = 0;
    const stop = async (args, re) =>
      assert.rejects(node([OSM, ...args, "--yes"], { env: srv.env }), e => e.code === 2 && re.test(e.stderr));
    await stop(["--type", "online-store", "--near", "51.5,-0.12"], /isn't a place/);
    await stop(["--type", "nope", "--near", "51.5,-0.12"], /plumber/);
    await stop(["--type", "cafe", "--near", "91,0"], /--near/);
    await stop(["--type", "cafe", "--near", "51.5,-0.12", "--radius", "50000"], /--radius/);
    await stop(["--type", "cafe"], /--near/);
    assert.equal(srv.hits.length, 0);
  } finally {
    await srv.close();
  }
});

// ---------- the rules ----------

test("local-business.md: the local rules and notes, each with its source", () => {
  const doc = readFileSync(join(SKILL, "site-types", "local-business.md"), "utf8");
  const rule = id => doc.split(`### ${id} ·`)[1].split("\n### ")[0];
  assert.match(rule("LOCAL-05"), /local phone number instead of a central call center/);
  assert.match(rule("LOCAL-05"), /service-area business that hides its street address/);
  assert.match(rule("LOCAL-06"), /\*\*Hybrid:\*\*/);
  assert.match(rule("LOCAL-06"), /osm\.mjs/);
  const l09 = rule("LOCAL-09");
  assert.match(l09, /16 CFR Part 465/);
  assert.match(l09, /\$53,088/);
  assert.match(l09, /individual business location/);
  assert.match(l09, /HIPAA/);
  assert.match(l09, /Formal Opinion 496/);
  assert.match(l09, /lawyer/);
  assert.match(l09, /Service & Parts/);
  const l12 = rule("LOCAL-12");
  for (const re of [
    /both your address and service area/,
    /750 characters/,
    /\*\*Attributes:\*\*/,
    /\*\*Menu or services link:\*\*/,
    /\*\*Booking link:\*\*/,
    /30 seconds and 75 MB/,
    /Performance report/,
  ])
    assert.match(l12, re);
  assert.match(rule("LOCAL-11"), /osm\.mjs/);
  assert.match(rule("LOCAL-14"), /Yellow Pages/);
  assert.match(rule("LOCAL-14"), /Data Axle/);
  assert.match(rule("LOCAL-15"), /parentOrganization/);
  assert.match(rule("LOCAL-15"), /subfolder/);
  assert.match(rule("LOCAL-16"), /validThrough/);
});

// ---------- the report ----------

const render = async extra => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  writeFileSync(join(dir, "a.json"), JSON.stringify({ ...data, ...extra }));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};

test("the report's Local business panel: the kind and its evidence, nearby places and the address check, credited and escaped", async () => {
  const before = await render({});
  assert.doesNotMatch(before.html, /class="how local"/);
  assert.doesNotMatch(before.md, /## Local business/);
  const { html, md } = await render({
    localBusiness: {
      kind: "hybrid",
      name: XSS,
      type: "Plumber",
      areas: ["Leeds"],
      evidence: [`schema: Plumber “${XSS}” on /`, "areaServed: Leeds"],
    },
    nearby: {
      type: "plumber",
      label: "Plumber",
      tags: ["craft=plumber"],
      center: { lat: 53.7976, lon: -1.5453 },
      centerFrom: "the schema's geo",
      radiusM: 2000,
      count: 3,
      unnamed: 1,
      perKm2: 0.24,
      places: [
        { name: `Rival ${XSS}`, distanceM: 300, osm: "node/2" },
        { name: "Far Pipes", distanceM: 1500, osm: "way/3" },
      ],
    },
    geocode: {
      query: `12 Park Row ${XSS}`,
      found: { lat: 53.7977, lon: -1.5454, label: "Park Row" },
      schemaGeo: { lat: 53.7976, lon: -1.5453 },
      distanceM: 1300,
      suggestGeo: false,
    },
  });
  assert.match(html, /<details class="how local"><summary>Local business<\/summary>/);
  assert.ok(!html.includes(XSS), "third-party text is escaped");
  assert.match(html, /usually goes to its customers/, "a plumber is a trade that goes to its customers");
  assert.match(html, /3 other places/);
  assert.match(html, /0\.24 per km²/);
  assert.match(html, /Far Pipes/);
  assert.match(html, /1\.5 km/);
  assert.match(html, /1\.3 km from the schema/);
  assert.match(html, /© OpenStreetMap contributors/);
  assert.match(md, /^### Local business$/m);
  assert.match(md, /© OpenStreetMap contributors/);
  assert.ok(!md.includes(XSS), "escaped in the Markdown too");
  const sab = await render({
    localBusiness: { kind: "service-area", areas: [], evidence: [] },
    geocode: { query: "Leeds", found: null, schemaGeo: null, distanceM: null, suggestGeo: false },
  });
  assert.match(sab.html, /goes to its customers/);
  assert.match(sab.html, /couldn(’|'|&#39;)t find/);
  const add = await render({
    geocode: {
      query: "12 Park Row",
      found: { lat: 53.797612, lon: -1.545399, label: "Park Row" },
      schemaGeo: null,
      distanceM: null,
      suggestGeo: true,
    },
  });
  assert.match(add.html, /53\.79761, -1\.54540/);
});
