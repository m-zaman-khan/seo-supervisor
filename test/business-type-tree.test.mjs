// The business-type test read from schema.org's type tree, the crawl that relies on it, and the shared schema checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { isA, isBusinessType, isLocalBusinessType } from "../skills/seo-supervisor/scripts/lib/business.mjs";
import { localFeatures } from "../skills/seo-supervisor/scripts/checks/local.mjs";
import { checkJsonLd } from "../skills/seo-supervisor/scripts/schema-check.mjs";
import { reviewEventProblems } from "../skills/seo-supervisor/scripts/checks/schema.mjs";

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

// ---------- Google's conditional return-policy fields ----------
const issuesOf = o =>
  checkJsonLd(JSON.stringify({ "@context": "https://schema.org", ...o }))
    .filter(i => i.severity === "error")
    .map(i => i.message);
const PRODUCT = policy => ({
  "@type": "Product",
  name: "Kettle",
  image: "https://site.example/k.jpg",
  offers: {
    "@type": "Offer",
    price: "20.00",
    priceCurrency: "GBP",
    availability: "https://schema.org/InStock",
    hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", applicableCountry: "GB", ...policy },
  },
});
const ORG = policy => ({
  "@type": "OnlineStore",
  name: "Shop",
  hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", ...policy },
});

test("a finite return window needs merchantReturnDays, and a return shipping fee needs its amount, on an offer and on the organization", () => {
  for (const category of [
    "https://schema.org/MerchantReturnFiniteReturnWindow",
    "MerchantReturnFiniteReturnWindow",
    "http://schema.org/MerchantReturnFiniteReturnWindow",
  ]) {
    assert.deepEqual(
      issuesOf(PRODUCT({ returnPolicyCategory: category })),
      ['missing "merchantReturnDays", required for Google return policies (a finite return window)'],
      category,
    );
    assert.deepEqual(
      issuesOf(ORG({ applicableCountry: "GB", returnPolicyCategory: category })),
      ['missing "merchantReturnDays", required for Google return policies (a finite return window)'],
      category,
    );
  }
  assert.deepEqual(
    issuesOf(
      PRODUCT({ returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow", merchantReturnDays: 30 }),
    ),
    [],
  );
  assert.deepEqual(
    issuesOf(PRODUCT({ returnPolicyCategory: "https://schema.org/MerchantReturnUnlimitedWindow" })),
    [],
    "an unlimited window needs no days",
  );
  const fee = { returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" };
  assert.deepEqual(issuesOf(PRODUCT({ ...fee, returnFees: "https://schema.org/ReturnShippingFees" })), [
    'missing "returnShippingFeesAmount", required for Google return policies (a return shipping fee)',
  ]);
  assert.deepEqual(
    issuesOf(
      PRODUCT({
        ...fee,
        returnFees: "https://schema.org/ReturnShippingFees",
        returnShippingFeesAmount: { "@type": "MonetaryAmount", value: 4.99, currency: "GBP" },
      }),
    ),
    [],
  );
  assert.deepEqual(issuesOf(PRODUCT({ ...fee, returnFees: "https://schema.org/FreeReturn" })), []);
});

test("an organization's return policy needs applicableCountry with returnPolicyCategory (option A), or merchantReturnLink (option B)", () => {
  assert.deepEqual(issuesOf(ORG({ returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" })), [
    'missing "applicableCountry" or "merchantReturnLink", required for Google return policies',
  ]);
  assert.deepEqual(issuesOf(ORG({ applicableCountry: "GB" })), [
    'missing "returnPolicyCategory" or "merchantReturnLink", required for Google return policies',
  ]);
  assert.deepEqual(
    issuesOf(ORG({ applicableCountry: "GB", returnPolicyCategory: "https://schema.org/MerchantReturnNotPermitted" })),
    [],
  );
  assert.deepEqual(issuesOf(ORG({ merchantReturnLink: "https://site.example/returns" })), []);
  assert.deepEqual(issuesOf(ORG({})), [
    'missing "applicableCountry" or "merchantReturnLink", required for Google return policies',
    'missing "returnPolicyCategory" or "merchantReturnLink", required for Google return policies',
  ]);
});

// ---------- One rule id for review-target-conflict ----------
test("schema-check reports review-target-conflict under SCHEMA-01, as the crawler does", async () => {
  const { CHECKS } = await import("../skills/seo-supervisor/scripts/checks/hygiene.mjs");
  const [issue] = checkJsonLd(
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Kettle",
      review: {
        "@type": "Review",
        author: { "@type": "Person", name: "Ana" },
        reviewRating: { "@type": "Rating", ratingValue: 4 },
        itemReviewed: { "@type": "Product", name: "Steel kettle" },
      },
    }),
  ).filter(i => i.check === "review-target-conflict");
  assert.equal(issue?.rule, "SCHEMA-01");
  assert.equal(issue.rule, CHECKS["review-target-conflict"][0]);
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

// One crawl for the tests below. The home page's Bakery gives a phone the page doesn't show (0113 496 0999).
const BAKERY = {
  "@type": "Bakery",
  "@id": `${ORIGIN}/#org`,
  name: "Crumb Bakery",
  telephone: "0113 496 0999",
  address: { "@type": "PostalAddress", streetAddress: "12 Mill Lane", addressLocality: "Leeds" },
};
const RATING = { "@type": "AggregateRating", ratingValue: 4.8, ratingCount: 120 };
let crawled;
const bakeryCrawl = () =>
  (crawled ??= crawlSite({
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
  }));

// Passes once crawl/page.mjs's ORG_RE uses lib/business.mjs; then drop `todo`.
test(
  "the address check (LOCAL-05) runs for a Bakery",
  { todo: "needs the crawl/page.mjs change in schema.md" },
  async () => {
    const f = findingOf(await bakeryCrawl(), "nap-not-shown");
    assert.deepEqual(Object.fromEntries((f?.evidence || []).map(e => [new URL(e.url).pathname, e.detail])), {
      "/": "phone “0113 496 0999” isn't shown on this page or the home page",
    });
  },
);

test("a Bakery home page has business schema, and its own rating is flagged; another business's isn't", async () => {
  const r = await bakeryCrawl();
  assert.equal(r.stats.htmlPages, 3, "every page was read");
  assert.ok(!findingOf(r, "org-missing"), "a Bakery is a business, so the home page has business schema");
  const f = findingOf(r, "rating-self-serving");
  assert.deepEqual([f?.rule, f?.severity, f?.count], ["SCHEMA-04", "low", 2]);
  assert.deepEqual(
    Object.fromEntries(f.evidence.map(e => [new URL(e.url).pathname, e.detail])),
    {
      "/": "a rating on “Crumb Bakery” (Bakery)",
      "/reviews/": "a review of “https://site.example/#org”",
    },
    "the florist's and the product's ratings aren't the site's own",
  );
  assert.match(f.why, /ineligible for star/);
});

// ---------- Ratings of the site's own business ----------
test("the businesses a page rates, by a rating on the node or a review naming it, and the business nodes at its top", () => {
  const RATING = { "@type": "AggregateRating", ratingValue: 4, ratingCount: 9 };
  const r = reviewEventProblems([
    {
      "@type": ["Bakery", "CafeOrCoffeeShop"],
      "@id": "https://site.example/#org",
      name: " Crumb  Bakery ",
      aggregateRating: RATING,
    },
    {
      "@type": "WebPage",
      about: {
        "@type": "Florist",
        name: "Petal",
        review: [{ "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: 5 } }],
      },
    },
    {
      "@type": "Review",
      itemReviewed: [
        { "@id": "https://site.example/#org" },
        { "@type": "Product", name: "Loaf" },
        { "@type": "Dentist", name: "Smile" },
      ],
    },
    { "@type": "Product", name: "Loaf", aggregateRating: RATING },
    { "@type": "Corporation", name: "Parent Co" },
  ]);
  assert.deepEqual(r.orgs, [
    { id: "https://site.example/#org", name: "Crumb  Bakery", type: "Bakery" },
    { id: "", name: "Parent Co", type: "Corporation" },
  ]);
  assert.deepEqual(r.rated, [
    { id: "https://site.example/#org", name: "Crumb  Bakery", type: "Bakery", kind: "a rating on" },
    { id: "", name: "Petal", type: "Florist", kind: "a review on" },
    { id: "https://site.example/#org", name: "", type: "", kind: "a review of" },
    { id: "", name: "Smile", type: "Dentist", kind: "a review of" },
  ]);
});
