import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import { checkJsonLd, ISO_4217 } from "../skills/seo-supervisor/scripts/schema-check.mjs";

const CTX = { "@context": "https://schema.org" };
const run = o => checkJsonLd(JSON.stringify({ ...CTX, ...o }));
const only = (o, check) => run(o).filter(i => i.check === check);
// A normal shop's product, with everything Google's merchant listing doc asks for.
const OFFER = {
  "@type": "Offer",
  price: "49.00",
  priceCurrency: "GBP",
  availability: "https://schema.org/InStock",
  priceValidUntil: "2099-12-31",
};
const GOOD = {
  "@type": "Product",
  name: "Trail shoe",
  image: "https://site.example/img/shoe.jpg",
  description: "A light trail shoe.",
  brand: { "@type": "Brand", name: "Acme" },
  sku: "TS-1",
  gtin13: "4006381333931",
  color: "Red",
  size: "42",
  material: "Mesh",
  category: "Apparel & Accessories > Shoes",
  offers: OFFER,
};
const SHOP_CHECKS =
  /^value-(price-zero|currency-invalid|availability-invalid|brand-placeholder|price-expired)$|^eprel-code$|^energy-details$/;
const shopIssues = o => run(o).filter(i => SHOP_CHECKS.test(i.check) || /merchant listings/.test(i.message));

test("schema-check: a normal shop's product raises nothing new", () => {
  assert.deepEqual(shopIssues(GOOD), []);
  assert.deepEqual(
    shopIssues({ ...GOOD, offers: { ...OFFER, availability: "InStock", priceCurrency: "usd" } }),
    [],
    "Google takes the short name; a lower-case code is left alone",
  );
  assert.deepEqual(shopIssues({ ...GOOD, offers: { ...OFFER, availability: "http://schema.org/OutOfStock" } }), []);
});

test("schema-check: a product sold with an Offer needs an image, while one with an AggregateOffer or a variant in a group doesn't", () => {
  const { image, ...noImage } = GOOD;
  const [f, ...more] = run(noImage).filter(i => /"image"/.test(i.message));
  assert.ok(f && !more.length, "one issue for the image, not a warning too");
  assert.deepEqual(
    [f.severity, f.check, f.doc],
    [
      "error",
      "required-missing",
      "https://developers.google.com/search/docs/appearance/structured-data/merchant-listing",
    ],
  );
  assert.equal(f.message, 'missing "image", required for Google merchant listings');
  const agg = run({
    ...noImage,
    offers: { "@type": "AggregateOffer", lowPrice: "40.00", highPrice: "60.00", priceCurrency: "GBP", offerCount: 3 },
  }).filter(i => /"image"/.test(i.message));
  assert.deepEqual(
    agg.map(i => i.severity),
    ["warning"],
    "product snippets only recommend it",
  );
  const group = {
    "@type": "ProductGroup",
    name: "Wool coat",
    image: "https://site.example/coat.jpg",
    brand: { "@type": "Brand", name: "Acme" },
    hasVariant: [{ "@type": "Product", name: "Wool coat, small", sku: "WC-S", offers: OFFER }],
  };
  assert.deepEqual(
    run(group).filter(i => /merchant listings/.test(i.message)),
    [],
    "a variant may take its image and brand from the group",
  );
  assert.deepEqual(
    run({ ...GOOD, isSimilarTo: { "@type": "Product", name: "Road shoe", offers: OFFER } }).filter(i =>
      /merchant listings/.test(i.message),
    ),
    [],
    "a product nested as isSimilarTo isn't a listing",
  );
});

test("schema-check: a price of 0 is a warning for a merchant listing, never for an AggregateOffer", () => {
  for (const price of ["0", "0.00", 0]) {
    const [f, ...more] = only({ ...GOOD, offers: { ...OFFER, price } }, "value-price-zero");
    assert.ok(f && !more.length, `price ${JSON.stringify(price)}`);
    assert.equal(f.severity, "warning");
    assert.match(f.message, /above zero/);
  }
  assert.equal(
    only(
      {
        ...GOOD,
        offers: {
          ...OFFER,
          price: undefined,
          priceSpecification: { "@type": "UnitPriceSpecification", price: "0.00", priceCurrency: "GBP" },
        },
      },
      "value-price-zero",
    ).length,
    1,
    "inside priceSpecification too",
  );
  assert.deepEqual(
    only(
      {
        ...GOOD,
        offers: { "@type": "AggregateOffer", lowPrice: "0", highPrice: "10", priceCurrency: "GBP", offerCount: 2 },
      },
      "value-price-zero",
    ),
    [],
  );
  assert.deepEqual(only({ ...GOOD, offers: { ...OFFER, price: "0.50" } }, "value-price-zero"), []);
});

test("schema-check: brand, GTIN, colour and the like aren't warned about, since they apply only to products that have them", () => {
  const { brand, sku, gtin13, color, size, material, category, ...bare } = GOOD;
  assert.deepEqual(shopIssues(bare), []);
});

test("schema-check: availability must be one schema.org ItemAvailability value", () => {
  const av = availability => only({ ...GOOD, offers: { ...OFFER, availability } }, "value-availability-invalid");
  for (const ok of [
    "https://schema.org/InStock",
    "InStock",
    "http://schema.org/PreOrder",
    "https://schema.org/MadeToOrder",
    "SoldOut",
  ])
    assert.deepEqual(av(ok), [], ok);
  const [free] = av("in stock");
  assert.deepEqual([free?.severity, free?.rule], ["warning", "SCHEMA-08"]);
  assert.match(free.message, /"in stock".*https:\/\/schema\.org\/InStock/);
  assert.match(av(["https://schema.org/InStock", "https://schema.org/OnlineOnly"])[0]?.message || "", /2 values/);
  assert.equal(av("Available").length, 1);
});

test("schema-check: priceCurrency must be a current ISO 4217 code", () => {
  assert.equal(ISO_4217.size, 178, "ISO 4217 List One, published 2026-09-17");
  for (const c of ["USD", "EUR", "GBP", "JPY", "XCG", "ZWG"]) assert.ok(ISO_4217.has(c), c);
  for (const c of ["HRK", "GB", "UK", "£", "EURO", "RMB"]) assert.ok(!ISO_4217.has(c), c);
  const cur = (o, check = "value-currency-invalid") => only({ ...GOOD, offers: { ...OFFER, ...o } }, check);
  const [sym] = cur({ priceCurrency: "£" });
  assert.deepEqual([sym?.severity, sym?.rule], ["error", "SCHEMA-08"]);
  assert.match(sym.message, /"£".*ISO 4217/);
  assert.equal(cur({ priceCurrency: "EURO" }).length, 1);
  assert.equal(
    cur({
      priceCurrency: undefined,
      priceSpecification: { "@type": "UnitPriceSpecification", price: "49.00", priceCurrency: "UK" },
    }).length,
    1,
  );
  assert.equal(
    only(
      { ...GOOD, offers: { "@type": "AggregateOffer", lowPrice: "4", priceCurrency: "Pounds" } },
      "value-currency-invalid",
    ).length,
    1,
    "an AggregateOffer's too",
  );
  assert.deepEqual(cur({ priceCurrency: "EUR" }), []);
});

test("schema-check: a brand of N/A, None, Generic or nothing is flagged; a real one isn't", () => {
  for (const brand of [
    "N/A",
    "n/a",
    "NA",
    { "@type": "Brand", name: "Generic" },
    { "@type": "Brand", name: " " },
    "None",
    "No brand",
    "Unbranded",
  ]) {
    const [f, ...more] = only({ ...GOOD, brand }, "value-brand-placeholder");
    assert.ok(f && !more.length, JSON.stringify(brand));
    assert.equal(f.severity, "warning");
  }
  for (const brand of ["Acme", { "@type": "Brand", name: "Nado" }, { "@id": "https://site.example/#organization" }])
    assert.deepEqual(only({ ...GOOD, brand }, "value-brand-placeholder"), [], JSON.stringify(brand));
});

test("schema-check: a priceValidUntil in the past is a warning; a future one or none is fine", () => {
  const [f] = only({ ...GOOD, offers: { ...OFFER, priceValidUntil: "2020-01-31" } }, "value-price-expired");
  assert.equal(f?.severity, "warning");
  assert.match(f.message, /2020-01-31.*may not show/);
  const { priceValidUntil, ...open } = OFFER;
  assert.deepEqual(only({ ...GOOD, offers: open }, "value-price-expired"), []);
});

test("schema-check: an EU energy label needs its EPREL code, and the old energy property gets a note", () => {
  const cert = c => ({
    ...GOOD,
    hasCertification: {
      "@type": "Certification",
      issuedBy: { "@type": "Organization", name: "European_Commission" },
      name: "EPREL",
      ...c,
    },
  });
  const [f, ...more] = only(cert({ certificationRating: { "@type": "Rating", ratingValue: "A" } }), "eprel-code");
  assert.ok(f && !more.length);
  assert.equal(f.severity, "note");
  assert.match(f.message, /"certificationIdentification".*Norway, Switzerland or the UK/);
  assert.deepEqual(only(cert({ certificationIdentification: "123456" }), "eprel-code"), []);
  assert.deepEqual(
    only(
      {
        ...GOOD,
        hasCertification: {
          "@type": "Certification",
          issuedBy: { "@type": "Organization", name: "Oeko-Tex" },
          name: "STANDARD 100",
          certificationIdentification: "1234",
        },
      },
      "eprel-code",
    ),
    [],
  );
  const [old] = only(
    {
      ...GOOD,
      hasEnergyConsumptionDetails: {
        "@type": "EnergyConsumptionDetails",
        hasEnergyEfficiencyCategory: "https://schema.org/EUEnergyEfficiencyCategoryA",
      },
    },
    "energy-details",
  );
  assert.equal(old?.severity, "note");
  assert.match(old.message, /hasCertification/);
});

// ---------- crawler ----------
const page = (h1, schema, head = "", body = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h1} | Acme Outdoor Shop</title>${head}${schema ? `<script type="application/ld+json">${JSON.stringify({ ...CTX, ...schema })}</script>` : ""}</head><body><main><h1>${h1}</h1><p>Plain words about this product.</p>${body}</main></body></html>`;
const prod = (name, offer = {}, more = {}) => ({ ...GOOD, name, offers: { ...OFFER, ...offer }, ...more });
const ADULT = '<meta name="rating" content="adult">';
async function crawl(pages) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  const links = Object.keys(pages)
    .filter(p => p !== "/")
    .map(p => `<a href="${p}">${p}</a>`)
    .join(" ");
  pages = {
    "/": page("Acme Outdoor Shop", { "@type": "Organization", name: "Acme", url: "https://site.example/" }, "", links),
    ...pages,
  };
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir);
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
const NEW = [
  "product-image-missing",
  "product-price-zero",
  "product-currency-invalid",
  "product-availability-invalid",
  "product-brand-placeholder",
  "product-price-expired",
  "product-adult-unlabelled",
  "product-h1-reused",
];

test("crawler: merchant-listing values, adult labels and a shared H1 on product pages; a normal shop, a noindex page and variants stay quiet", async () => {
  const { image, ...noImage } = GOOD;
  const r = await crawl({
    "/shop/good/": page("Trail shoe", prod("Trail shoe")),
    "/shop/zero/": page("Gift wrap", prod("Gift wrap", { price: "0.00" })),
    "/shop/bad/": page("Hiking boot", {
      ...noImage,
      name: "Hiking boot",
      brand: "N/A",
      offers: { ...OFFER, priceCurrency: "£", availability: "in stock", priceValidUntil: "2020-01-31" },
    }),
    "/shop/snippet/": page("Tent", {
      ...noImage,
      name: "Tent",
      offers: {
        "@type": "AggregateOffer",
        lowPrice: "90.00",
        highPrice: "120.00",
        priceCurrency: "GBP",
        offerCount: 4,
      },
    }),
    "/shop/hidden/": page(
      "Old boot",
      { ...noImage, name: "Old boot", brand: "N/A", offers: { ...OFFER, price: "0", priceCurrency: "£" } },
      '<meta name="robots" content="noindex">',
    ),
    "/adult/one/": page("Adult item one", prod("Adult item one"), ADULT),
    "/adult/two/": page(
      "Adult item two",
      prod("Adult item two", {}, { hasAdultConsideration: "https://schema.org/SexualContentConsideration" }),
      ADULT,
    ),
    "/mugs/red/": page("Product details", prod("Red mug")),
    "/mugs/blue/": page("Product details", prod("Blue mug")),
    "/mugs/green/": page("Product details", prod("Green mug")),
    "/coat/small/": page("Wool coat", prod("Wool coat, small")),
    "/coat/medium/": page("Wool coat", prod("Wool coat, medium")),
    "/coat/large/": page("Wool coat", prod("Wool coat, large")),
    "/about/": page("Product details", null),
  });
  assert.deepEqual(
    pathsOf(r, "product-image-missing"),
    ["/shop/bad/"],
    "an AggregateOffer only earns product snippets",
  );
  assert.deepEqual(pathsOf(r, "product-price-zero"), ["/shop/zero/"]);
  for (const key of [
    "product-currency-invalid",
    "product-availability-invalid",
    "product-brand-placeholder",
    "product-price-expired",
  ])
    assert.deepEqual(pathsOf(r, key), ["/shop/bad/"], key);
  assert.equal(findingOf(r, "product-currency-invalid").evidence[0].detail, "Hiking boot: priceCurrency “£”");
  assert.equal(findingOf(r, "product-brand-placeholder").evidence[0].detail, "Hiking boot: brand “N/A”");
  assert.deepEqual(pathsOf(r, "product-adult-unlabelled"), ["/adult/one/"]);
  assert.deepEqual(
    pathsOf(r, "product-h1-reused"),
    ["/mugs/blue/", "/mugs/green/", "/mugs/red/"],
    "a variant's H1 that names its product, and a page with no product, aren't counted",
  );
  assert.match(findingOf(r, "product-h1-reused").evidence[0].detail, /“Product details” on 3 product pages/);
  const sev = Object.fromEntries(NEW.map(k => [k, [findingOf(r, k).rule, findingOf(r, k).severity]]));
  assert.deepEqual(sev, {
    "product-image-missing": ["SHOP-05", "medium"],
    "product-price-zero": ["SHOP-05", "low"],
    "product-currency-invalid": ["SHOP-05", "medium"],
    "product-availability-invalid": ["SHOP-05", "low"],
    "product-brand-placeholder": ["SHOP-05", "low"],
    "product-price-expired": ["SHOP-05", "medium"],
    "product-adult-unlabelled": ["SHOP-05", "medium"],
    "product-h1-reused": ["CONTENT-04", "medium"],
  });
  for (const k of NEW)
    for (const p of ["/shop/good/", "/shop/hidden/", "/adult/two/", "/coat/small/", "/about/"])
      assert.ok(!pathsOf(r, k).includes(p), `${k} stays quiet on ${p}`);
  // Recommended fields the products give, counted over the 12 products on indexable pages.
  assert.deepEqual(r.productFields, {
    products: 12,
    brand: 11,
    gtin: 12,
    sku: 12,
    color: 12,
    size: 12,
    material: 12,
    category: 12,
  });
});

test("crawler: a site with no product pages gets no shop findings and no product fields", async () => {
  const r = await crawl({
    "/about/": page("About us", null),
    "/team/": page("About us", null),
    "/jobs/": page("About us", null),
  });
  for (const k of NEW) assert.ok(!findingOf(r, k), k);
  assert.equal(r.productFields, undefined);
});

// ---------- report ----------
const render = async data => {
  const dir = tmp();
  writeFileSync(
    join(dir, "a.json"),
    JSON.stringify({
      tool: "seo-supervisor-crawler",
      version: "2.0.0",
      siteOrigin: "https://site.example",
      crawledAt: "2026-11-21T10:00:00Z",
      stats: { htmlPages: 4 },
      findings: [],
      notChecked: [],
      notes: [],
      passed: [{ rule: "SHOP-05", title: "Product schema from live data", category: "Structured data" }],
      ...data,
    }),
  );
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};

test("report: the product field counts show as one information line that never changes the score; bad data shows nothing", async () => {
  const fields = { products: 12, brand: 11, gtin: 3, sku: 12, color: 4, size: 4, material: 0, category: 1 };
  const [withInfo, without, bad] = await Promise.all([
    render({ productFields: fields }),
    render({}),
    render({ productFields: { ...fields, gtin: "<b>3</b>" } }),
  ]);
  const line =
    "Of 12 products in the schema: 11 with a brand, 3 with a GTIN or MPN, 12 with a SKU, 4 with a colour, 4 with a size, 0 with a material, 1 with a category.";
  const p = withInfo.html.match(/\n {4}<p class="quiet">Of 12 products[^<]*<\/p>/)?.[0] || "";
  assert.ok(p.includes(line), withInfo.html.slice(0, 200));
  assert.match(p, /Information only/);
  assert.equal(withInfo.html.replace(p, ""), without.html, "the line is the only change");
  assert.ok(withInfo.md.includes(`## Product data\n\n${line}`));
  assert.equal(bad.html, without.html);
  assert.ok(!bad.md.includes("## Product data"));
});

// ---------- guidance ----------
const ecommerce = readFileSync(join(SKILL, "site-types", "ecommerce.md"), "utf8");
const section = id => ecommerce.split(`### ${id} ·`)[1].split("\n### ")[0];

test("ecommerce.md: the new checks, adult products, the EU energy label, category format and brand pages under SHOP-05", () => {
  const s05 = section("SHOP-05");
  for (const key of NEW.filter(k => k !== "product-h1-reused")) assert.ok(s05.includes(`\`${key}\``), key);
  assert.match(s05, /ISO 4217/);
  assert.match(s05, /ItemAvailability/);
  assert.match(s05, /SexualContentConsideration/, "adult products");
  assert.match(s05, /<meta name="rating" content="adult">/);
  assert.match(
    s05,
    /EPREL[\s\S]*certificationIdentification[\s\S]*Norway, Switzerland or the UK/,
    "the EU energy label",
  );
  assert.match(
    s05,
    /CategoryCode[\s\S]*taxonomy-with-ids[\s\S]*Apparel & Accessories > Clothing > Dresses/,
    "category format",
  );
  assert.match(s05, /\*\*Brand pages:\*\*[^\n]*CollectionPage[^\n]*Brand/, "brand pages");
});

test("ecommerce.md: SHOP-09 covers headings, a specs table, size and care, the price in the description and manufacturer copy", () => {
  const s09 = section("SHOP-09");
  assert.match(s09, /`product-h1-reused`/, "a shared H1");
  assert.match(s09, /H2/);
  assert.match(s09, /<table>/, "a specs table");
  assert.match(s09, /size guide/i, "size and care");
  assert.match(s09, /care/i);
  assert.match(s09, /from £/, "the price in the description");
  assert.match(s09, /price, age, manufacturer/);
  assert.match(s09, /manufacturer/i, "manufacturer copy");
  assert.match(s09, /CONTENT-04/);
  assert.match(s09, /outside checks/);
});

test("ecommerce.md: SHOP-08 names the AI-label rule for feeds, and ACP and x402 next to UCP", () => {
  const s08 = section("SHOP-08");
  assert.match(
    s08,
    /structured_title[\s\S]*structured_description[\s\S]*trained_algorithmic_media/,
    "the AI-label rule for feeds",
  );
  assert.match(s08, /Agentic Commerce Protocol[\s\S]*agenticcommerce\.dev/, "ACP");
  assert.match(s08, /x402[\s\S]*x402\.org/);
  assert.match(s08, /HTTP 402/);
});
