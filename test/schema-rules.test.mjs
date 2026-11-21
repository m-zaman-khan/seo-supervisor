import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import { checkJsonLd } from "../skills/seo-supervisor/scripts/schema-check.mjs";

const CTX = { "@context": "https://schema.org" };
const run = o => checkJsonLd(typeof o === "string" ? o : JSON.stringify({ ...CTX, ...o }));
const only = (o, check) => run(o).filter(i => i.check === check);
const BIZ = {
  "@type": "Plumber",
  name: "Northside Plumbing",
  address: "1 High Street, Leeds",
  telephone: "+44 113 496 0000",
  url: "https://site.example/",
  priceRange: "££",
};

test("geo: a business's coordinates need at least 5 decimal places, as Google's local business and vacation rental docs say", () => {
  const geo = (latitude, longitude) => ({ ...BIZ, geo: { "@type": "GeoCoordinates", latitude, longitude } });
  const [lat, ...more] = only(geo(53.796, -1.54785), "value-geo");
  assert.ok(lat && !more.length, "one warning, for the latitude");
  assert.deepEqual([lat.severity, lat.rule], ["warning", "SCHEMA-08"]);
  assert.match(lat.message, /"latitude" is 53\.796 \(3 decimal places\)/);
  assert.equal(only(geo("53.7964", "-1.5478"), "value-geo").length, 2, "strings are counted too");
  assert.deepEqual(only(geo(53.79648, -1.547851), "value-geo"), []);
  // 53.79640 parses as 53.7964, but the page wrote five decimal places.
  assert.deepEqual(
    only(
      `{"@context":"https://schema.org","@type":"Plumber","name":"N","address":"1 High St","geo":{"@type":"GeoCoordinates","latitude":53.79640,"longitude":-1.54700}}`,
      "value-geo",
    ),
    [],
  );
  assert.equal(
    only({ "@type": "VacationRental", name: "Lake cottage", latitude: 54.37, longitude: -2.91046 }, "value-geo").length,
    1,
    "a vacation rental's own latitude",
  );
  assert.deepEqual(
    only(
      {
        "@type": "Event",
        name: "Gig",
        startDate: "2026-12-01",
        location: {
          "@type": "Place",
          address: "Leeds",
          geo: { "@type": "GeoCoordinates", latitude: 53.8, longitude: -1.5 },
        },
      },
      "value-geo",
    ),
    [],
    "Google sets no precision for an event's place",
  );
});

test("SCHEMA-05 says Search Console and the Rich Results Test no longer report retired types", () => {
  const s05 = readFileSync(join(SKILL, "rules", "structured-data.md"), "utf8")
    .split("### SCHEMA-05")[1]
    .split("### ")[0];
  assert.match(s05, /Search Console/);
  assert.match(s05, /Rich Results Test/);
  assert.match(s05, /no longer report/);
});

test("the superseded Attorney type is flagged like the retired types, pointing to LegalService", () => {
  const [f, ...more] = only(
    { "@type": "Attorney", name: "Smith & Co", address: "1 High Street, Leeds" },
    "type-superseded",
  );
  assert.ok(f && !more.length);
  assert.deepEqual([f.severity, f.rule, f.doc], ["warning", "SCHEMA-05", "https://schema.org/Attorney"]);
  assert.match(f.message, /"Attorney".*LegalService/);
  assert.deepEqual(
    only({ "@type": "LegalService", name: "Smith & Co", address: "1 High Street, Leeds" }, "type-superseded"),
    [],
  );
});

test("placeholders inside JSON-LD are errors; ordinary brackets and words aren't", () => {
  const ph = o => only(o, "placeholder");
  const [name, phone, ...more] = ph({ ...BIZ, name: "[Business Name]", telephone: "REPLACE_WITH_PHONE" });
  assert.ok(name && phone && !more.length, "one error per placeholder");
  assert.deepEqual([name.severity, name.rule], ["error", "SCHEMA-01"]);
  assert.match(name.message, /\[Business Name\]/);
  assert.match(phone.message, /REPLACE_WITH_PHONE/);
  assert.equal(ph({ ...BIZ, telephone: "[Phone]" }).length, 1);
  assert.equal(ph({ ...BIZ, address: "[STREET ADDRESS], [CITY]" }).length, 1);
  assert.deepEqual(
    ph({
      "@type": "Article",
      headline: "Best laptops of 2026 [Updated]",
      image: "https://site.example/how-to-replace_battery.jpg",
      description: "Prices [in GBP] and specs",
    }),
    [],
  );
});

test("a top-level item with no @type, or any empty @type, is an error; nested values and @id references aren't", () => {
  const [missing, ...more] = only({ name: "Acme", url: "https://site.example/" }, "type-missing");
  assert.ok(missing && !more.length);
  assert.deepEqual([missing.severity, missing.rule, missing.path], ["error", "SCHEMA-08", "$"]);
  assert.equal(
    only({ "@graph": [{ "@type": "WebSite", url: "https://site.example/" }, { name: "Acme" }] }, "type-missing")[0]
      .path,
    "$.@graph[1]",
  );
  assert.equal(only({ "@type": "", name: "Acme" }, "type-empty").length, 1);
  assert.equal(
    only({ "@type": "Organization", name: "Acme", address: { "@type": [], streetAddress: "1 High St" } }, "type-empty")
      .length,
    1,
    "an empty @type nested too",
  );
  const quiet = {
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://site.example/#organization",
        name: "Acme",
        address: { streetAddress: "1 High St" },
      },
      { "@id": "https://site.example/#organization", sameAs: ["https://www.linkedin.com/company/acme"] }, // merged into the typed node
      { "@id": "https://site.example/#website" }, // a bare reference
    ],
  };
  assert.deepEqual(
    run(quiet).filter(i => /^type-(missing|empty)$/.test(i.check)),
    [],
  );
});

test("LocalBusiness recommends priceRange, which must be shorter than 100 characters", () => {
  const { priceRange, ...noPrice } = BIZ;
  assert.ok(only({ ...noPrice }, "recommended-missing").some(i => /"priceRange"/.test(i.message)));
  assert.ok(!only(BIZ, "recommended-missing").some(i => /"priceRange"/.test(i.message)));
  const [long] = only({ ...BIZ, priceRange: "x".repeat(100) }, "value-price-range");
  assert.deepEqual([long?.severity, long?.rule], ["warning", "SCHEMA-08"]);
  assert.match(long.message, /100 characters/);
  assert.deepEqual(only({ ...BIZ, priceRange: "x".repeat(99) }, "value-price-range"), []);
});

test("structured-data.md: breadcrumbs on desktop only, sale dates, no ranking boost, ContactPage and the SaaS map", () => {
  const md = readFileSync(join(SKILL, "rules", "structured-data.md"), "utf8");
  const section = id => md.split(`### ${id}`)[1].split("### ")[0];
  assert.match(section("SCHEMA-07"), /desktop/, "breadcrumbs on desktop only");
  assert.match(md, /validFrom[\s\S]*validThrough[\s\S]*priceValidUntil/, "sale dates");
  assert.match(md, /won't make (?:a|your) site rank better/i, "no ranking boost");
  const s03 = section("SCHEMA-03");
  assert.match(s03, /\| Contact page \| ContactPage/, "ContactPage");
  assert.match(s03, /SoftwareApplication/);
  assert.match(s03, /\| [^|]*feature[^|]* \|[^|]*SoftwareApplication/i, "the SaaS map: home and feature pages");
  assert.match(s03, /\| [^|]*[Dd]ocs[^|]* \|[^|]*TechArticle/, "the SaaS map: docs");
  assert.match(s03, /\| Case stud/, "the SaaS map: case studies");
});

// ---------- crawler ----------
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), Buffer.alloc(17)]);
const page = (title, schema, extra = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="canonical" href="https://site.example${title === "Home" ? "/" : `/${title.toLowerCase()}/`}">${schema ? `<script type="application/ld+json">${JSON.stringify({ ...CTX, ...schema })}</script>` : ""}</head><body><main><h1>${title}</h1><p>Plain words about this page.</p>${extra}</main></body></html>`;
const crumbs = {
  "@type": "BreadcrumbList",
  itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://site.example/" }],
};
async function crawl(pages, files) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir, { files });
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://site.example",
      "--out",
      out,
    ]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const pathsOf = (r, check) => (findingOf(r, check)?.evidence || []).map(e => new URL(e.url).pathname).sort();

test("crawler: placeholders, the superseded Attorney type and schema images that don't load; ordinary pages stay quiet", async () => {
  const article = (name, image) =>
    page(name, { "@graph": [{ "@type": "Article", headline: `${name} [Updated]`, image }, crumbs] });
  const links = ["broken", "html", "away", "firm", "old", "fine"].map(p => `<a href="/${p}/">${p}</a>`).join(" ");
  const r = await crawl(
    {
      "/": page(
        "Home",
        {
          "@graph": [
            {
              "@type": "Organization",
              name: "Acme",
              url: "https://site.example/",
              logo: "https://site.example/logo.png",
            },
            { "@type": "WebSite", name: "Acme", url: "https://site.example/" },
          ],
        },
        links,
      ),
      "/broken/": article("Broken", "https://site.example/missing.jpg"),
      "/html/": article("Html", { "@type": "ImageObject", url: "/fine/" }),
      "/away/": article("Away", ["https://cdn.other.example/photo.jpg", "/logo.png"]),
      "/firm/": page("Firm", {
        "@graph": [
          { "@type": "Attorney", name: "[Business Name]", telephone: "REPLACE_PHONE", address: "1 High Street, Leeds" },
          crumbs,
        ],
      }),
      "/old/": page(
        "Old",
        null,
        `<div itemscope itemtype="https://schema.org/Attorney"><span itemprop="name">Smith &amp; Co</span></div>`,
      ),
      "/fine/": page("Fine", {
        "@graph": [
          {
            "@type": "LegalService",
            name: "Smith & Co",
            address: "1 High Street, Leeds",
            image: "https://site.example/logo.png",
          },
          crumbs,
        ],
      }),
    },
    { "/logo.png": { type: "image/png", body: png } },
  );

  const img = findingOf(r, "schema-image-broken");
  assert.deepEqual([img?.rule, img?.severity], ["SCHEMA-01", "medium"]);
  assert.deepEqual(pathsOf(r, "schema-image-broken"), ["/broken/", "/html/"]);
  assert.match(img.evidence.find(e => e.url.endsWith("/broken/")).detail, /missing\.jpg → 404/);
  assert.match(img.evidence.find(e => e.url.endsWith("/html/")).detail, /an HTML page, not an image/);
  assert.ok(
    r.notes.some(n => /schema image/i.test(n) && /another host/.test(n)),
    "the image on another host isn't fetched, and a note says so",
  );

  const ph = findingOf(r, "schema-placeholder");
  assert.deepEqual([ph?.rule, ph?.severity], ["SCHEMA-01", "high"]);
  assert.deepEqual(pathsOf(r, "schema-placeholder"), ["/firm/"]);
  assert.match(ph.evidence[0].detail, /\[Business Name\]/);

  const sup = findingOf(r, "schema-superseded");
  assert.deepEqual([sup?.rule, sup?.severity], ["SCHEMA-05", "low"]);
  assert.deepEqual(pathsOf(r, "schema-superseded"), ["/firm/", "/old/"], "JSON-LD and Microdata");
  assert.match(sup.evidence[0].detail, /Attorney → LegalService/);
});
