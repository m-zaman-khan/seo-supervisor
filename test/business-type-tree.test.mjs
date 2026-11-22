// The business-type test read from schema.org's type tree, the crawl that relies on it, and the shared schema checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { isA, isBusinessType, isLocalBusinessType } from "../skills/seo-supervisor/scripts/lib/business.mjs";
import { localFeatures } from "../skills/seo-supervisor/scripts/checks/local.mjs";

const ORIGIN = "https://site.example";
const COPY =
  "Fresh sourdough, rye and seeded loaves baked before dawn every day, with cakes made to order for birthdays and weddings across the city. ".repeat(
    2,
  );
const ld = (...nodes) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": nodes })}</script>`;
const page = (title, head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><header><nav><a href="/">Home</a> <a href="/partners/">Partners</a> <a href="/reviews/">Reviews</a></nav></header><main><h1>${title}</h1><p>${COPY}</p></main><footer>Crumb Bakery, 12 Mill Lane, Leeds · 0113 496 0000</footer></body></html>`;
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

// ---------- Shared schema checks ----------
test("the crawler's schema helpers come from checks/schema.mjs, and schema-check.mjs re-exports the same ones", async () => {
  const shared = await import("../skills/seo-supervisor/scripts/checks/schema.mjs"),
    cli = await import("../skills/seo-supervisor/scripts/schema-check.mjs");
  for (const k of [
    "ISO_4217",
    "SUPERSEDED",
    "merchantProblems",
    "onlineOnly",
    "otherReviewed",
    "placeholderIn",
    "reviewEventProblems",
    "sellsWithOffer",
  ]) {
    assert.ok(shared[k], k);
    assert.equal(cli[k], shared[k], k);
  }
  assert.equal(typeof cli.checkJsonLd, "function");
});

// ---------- One business-type test ----------
test("every Organization subtype is a business, read from schema.org's tree; WebSite, Person and Service aren't", () => {
  for (const t of [
    "Bakery",
    "HairSalon",
    "MedicalClinic",
    "CafeOrCoffeeShop",
    "Organization",
    "Corporation",
    "OnlineStore",
    "LocalBusiness",
    "Dentist",
    "https://schema.org/Bakery",
    "schema:Florist",
  ])
    assert.ok(isBusinessType(t), t);
  for (const t of [
    "WebSite",
    "Person",
    "Service",
    "FoodService",
    "TaxiService",
    "Product",
    "Brand",
    "",
    "__proto__",
    "constructor",
    42,
    null,
    undefined,
  ])
    assert.ok(!isBusinessType(t), String(t));
});

test("a local business is LocalBusiness or a subtype; an online shop, a corporation or a school isn't", () => {
  for (const t of [
    "Bakery",
    "HairSalon",
    "MedicalClinic",
    "CafeOrCoffeeShop",
    "Plumber",
    "LocalBusiness",
    "http://schema.org/Hotel",
  ])
    assert.ok(isLocalBusinessType(t), t);
  for (const t of [
    "Organization",
    "Corporation",
    "OnlineStore",
    "OnlineBusiness",
    "School",
    "NGO",
    "Service",
    "WebSite",
    "Person",
  ])
    assert.ok(!isLocalBusinessType(t), t);
  assert.ok(
    isA("Bakery", "FoodEstablishment") && !isA("Person", "Organization"),
    "the tree itself is exported for the other checks",
  );
});

test("the local business check reads a HairSalon and a MedicalClinic as local businesses", () => {
  const r = localFeatures(
    [
      { "@type": "HairSalon", name: "Snip", address: { streetAddress: "1 High St" } },
      { "@type": "MedicalClinic", name: "Clinic" },
      { "@type": "OnlineStore", name: "Shop" },
    ],
    "",
  );
  assert.deepEqual(
    r?.biz.map(b => b.type),
    ["HairSalon", "MedicalClinic"],
  );
});

test("a Bakery home page has business schema, and its own rating is flagged; another business's isn't", async () => {
  const BAKERY = {
    "@type": "Bakery",
    "@id": `${ORIGIN}/#org`,
    name: "Crumb Bakery",
    telephone: "0113 496 0000",
    address: { "@type": "PostalAddress", streetAddress: "12 Mill Lane", addressLocality: "Leeds" },
  };
  const RATING = { "@type": "AggregateRating", ratingValue: 4.8, ratingCount: 120 };
  const r = await crawlSite({
    "/": page(
      "Crumb Bakery in Leeds",
      ld(
        { "@type": "WebSite", "@id": `${ORIGIN}/#website`, name: "Crumb Bakery", url: `${ORIGIN}/` },
        { ...BAKERY, aggregateRating: RATING },
      ),
    ),
    "/partners/": page(
      "Our partners",
      ld(
        { "@type": "Florist", name: "Petal Florist", aggregateRating: RATING },
        { "@type": "Product", name: "Seeded loaf", aggregateRating: RATING },
      ),
    ),
    "/reviews/": page(
      "Reviews",
      ld({
        "@type": "Review",
        author: { "@type": "Person", name: "Ana" },
        reviewRating: { "@type": "Rating", ratingValue: 5 },
        itemReviewed: { "@id": `${ORIGIN}/#org` },
      }),
    ),
  });
  assert.equal(r.stats.htmlPages, 3, "every page was read");
  assert.ok(!findingOf(r, "org-missing"), "a Bakery is a business, so the home page has business schema");
});
