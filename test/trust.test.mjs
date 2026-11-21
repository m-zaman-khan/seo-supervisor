import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";
import { trustFeatures, trustSignals } from "../skills/seo-supervisor/scripts/checks/trust.mjs";

const IDS = [
  "about",
  "contact",
  "org-schema",
  "author-byline",
  "author-page",
  "dates",
  "sources",
  "customer-proof",
  "policies",
  "https",
  "own-media",
];
const page = (title, body, head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body>${body}</body></html>`;
const ld = o => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
const byId = signals => Object.fromEntries(signals.map(s => [s.id, s]));

// Writes the pages (path -> HTML) to a folder, serves it and crawls it.
async function crawl(pages, { headers = {}, args = [] } = {}) {
  const root = tmp();
  for (const [path, html] of Object.entries(pages)) {
    const dir = join(root, ...path.split("/").filter(Boolean));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), html);
  }
  const site = await serve(root, { headers });
  const out = join(tmp(), "crawl.json");
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url + "/", "--out", out, ...args]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}

const nav = `<header><nav><a href="/">Home</a> <a href="/blog/fixing-a-leak/">Blog</a></nav></header>`;
const footer = `<footer><a href="/about/">About us</a> <a href="/contact/">Contact</a> <a href="/privacy/">Privacy policy</a> <a href="/terms/">Terms</a></footer>`;
const text =
  "Acme fixes leaks, boilers and blocked drains across the city, with fixed prices agreed before any work starts.";
const FULL = {
  "/": page(
    "Acme Plumbing",
    `${nav}<main><h1>Acme Plumbing</h1><p>${text}</p><img src="/van.jpg" alt="Our van" width="800" height="600"><h2>What our customers say</h2><blockquote>They fixed our leak in an hour.</blockquote></main>${footer}`,
    ld({
      "@context": "https://schema.org",
      "@type": "Plumber",
      name: "Acme Plumbing",
      logo: "https://acme.example/logo.png",
      sameAs: ["https://www.facebook.com/acme"],
    }),
  ),
  "/about/": page(
    "About Acme Plumbing",
    `${nav}<main><h1>About us</h1><p>Family run since 1990. ${text}</p></main>${footer}`,
  ),
  "/contact/": page(
    "Contact Acme Plumbing",
    `${nav}<main><h1>Contact</h1><p><a href="mailto:hello@acme.example">hello@acme.example</a></p></main>${footer}`,
  ),
  "/blog/fixing-a-leak/": page(
    "Fixing a dripping tap",
    `${nav}<main><article><h1>Fixing a dripping tap</h1><p class="byline">By <a href="/authors/jane/" rel="author">Jane Doe</a> · <time datetime="2026-10-01">1 October 2026</time></p><p>A dripping tap wastes thousands of litres a year, according to the <a href="https://www.epa.gov/watersense">EPA</a>. ${text}</p></article></main>${footer}`,
    ld({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: "Fixing a dripping tap",
      author: { "@type": "Person", name: "Jane Doe", url: "/authors/jane/" },
      datePublished: "2026-10-01",
    }),
  ),
  "/authors/jane/": page(
    "Jane Doe, plumber",
    `${nav}<main><h1>Jane Doe</h1><p>Master plumber with 20 years of experience.</p></main>${footer}`,
    ld({
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      mainEntity: { "@type": "Person", name: "Jane Doe" },
    }),
  ),
  "/privacy/": page("Privacy policy", `${nav}<main><h1>Privacy policy</h1><p>${text}</p></main>${footer}`),
  "/terms/": page("Terms of service", `${nav}<main><h1>Terms</h1><p>${text}</p></main>${footer}`),
};
const BARE = {
  "/": page("Bare site", `<main><h1>Bare site</h1><p>${text}</p><p><a href="/services/">Our services</a></p></main>`),
  "/services/": page("Services", `<main><h1>Services</h1><p>${text}</p></main>`),
};
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=()",
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'",
};

test("trust signals: each is found on a site that has it and missing on one that doesn't", async () => {
  const full = await crawl(FULL, { headers: { "/": SECURITY }, args: ["--site-origin", "https://acme.example"] });
  const bare = await crawl(BARE);
  for (const r of [full, bare])
    assert.deepEqual(
      r.trustSignals.map(s => s.id),
      IDS,
      "every signal, in order",
    );
  for (const s of full.trustSignals) {
    assert.equal(s.applies, true, `${s.id} applies to the full site`);
    assert.equal(s.found, true, `${s.id} is found on the full site (evidence: ${s.evidence})`);
    assert.ok(s.label && s.evidence, `${s.id} has a label and evidence`);
  }
  const b = byId(bare.trustSignals);
  for (const id of ["about", "contact", "author-byline", "author-page", "dates", "sources", "customer-proof"])
    assert.equal(b[id].found, false, `${id} is missing on the bare site`);
  assert.equal(
    b.https.applies,
    false,
    "a local crawl with no public origin can't tell whether the site uses HTTPS, so it leaves the count",
  );
  assert.ok(!full.findings.some(f => /trust/i.test(f.check)), "trust signals never become findings");
});

test("HTTPS isn't counted while a cookie or HSTS finding is open, though those checks run late in the crawl", async () => {
  const r = await crawl(FULL, {
    headers: {
      "/": {
        ...SECURITY,
        "Set-Cookie": "sid=abc; Path=/",
        "Strict-Transport-Security": "max-age=300; includeSubDomains",
      },
    },
    args: ["--site-origin", "https://acme.example"],
  });
  assert.deepEqual(
    r.findings
      .filter(f => ["TRUST-01", "TRUST-07"].includes(f.rule))
      .map(f => f.check)
      .sort(),
    ["cookie-flags", "hsts-short"],
  );
  const { https } = byId(r.trustSignals);
  assert.equal(https.found, false, https.evidence);
  assert.equal(https.evidence, "HTTPS, with open security findings");
});

const at = (url, html) => ({ finalUrl: url, trust: trustFeatures(html, url, url) });
const SITE = origin => ({ origin, https: true, orgSchema: null, unsourcedStats: 0 });
const count = signals => signals.filter(s => s.applies).length;

test("signals that don't apply leave the count", () => {
  const product = at(
    "https://shop.example/p/widget/",
    page(
      "Widget",
      `<main><h1>Widget</h1><p>$10</p></main>`,
      ld({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Widget",
        offers: { "@type": "Offer", price: "10", priceCurrency: "USD" },
      }),
    ),
  );
  const shopHome = links =>
    at("https://shop.example/", page("Shop", `<main><h1>Shop</h1><p>${text}</p></main><footer>${links}</footer>`));
  const shop = byId(
    trustSignals(
      [shopHome(`<a href="/privacy/">Privacy</a> <a href="/terms/">Terms of sale</a>`), product],
      SITE("https://shop.example"),
    ),
  );
  for (const id of ["author-byline", "author-page", "dates"])
    assert.equal(shop[id].applies, false, `${id} doesn't apply to a shop with no articles`);
  assert.equal(count(Object.values(shop)), 8, "a shop counts 8 signals");
  assert.equal(shop.policies.found, false, "a shop needs a returns policy too");
  assert.match(shop.policies.add, /returns/i);
  const withReturns = byId(
    trustSignals(
      [
        shopHome(`<a href="/privacy/">Privacy</a> <a href="/terms/">Terms of sale</a> <a href="/returns/">Returns</a>`),
        product,
      ],
      SITE("https://shop.example"),
    ),
  );
  assert.equal(withReturns.policies.found, true);

  const post = at(
    "https://blog.example/blog/hello/",
    page(
      "Hello",
      `<main><h1>Hello</h1><p>${text}</p></main><footer><a href="/privacy/">Privacy</a></footer>`,
      ld({ "@context": "https://schema.org", "@type": "BlogPosting", headline: "Hello", datePublished: "2026-11-01" }),
    ),
  );
  const blog = byId(trustSignals([post], SITE("https://blog.example")));
  assert.equal(blog["author-byline"].applies, true, "author signals count on a site with articles");
  assert.equal(blog.policies.found, true, "a blog that doesn't sell or collect data needs only a privacy policy");
  assert.equal(count(Object.values(blog)), 11);
});

test("signals are found in the menu and in schema, not only in the footer or visible text", () => {
  const home = at(
    "https://mag.example/",
    page(
      "Mag",
      `<header><nav><a href="/who-we-are/">Who we are</a> <a href="/news/">News</a></nav></header><main><h1>Mag</h1><p>${text}</p></main>`,
    ),
  );
  const post = at(
    "https://mag.example/news/launch/",
    page(
      "Launch",
      `<main><h1>Launch</h1><p>${text}</p></main>`,
      ld({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "NewsArticle",
            headline: "Launch",
            author: { "@id": "https://mag.example/#/person/1" },
            datePublished: "2026-11-01T09:00:00+00:00",
          },
          {
            "@type": "Person",
            "@id": "https://mag.example/#/person/1",
            name: "Sam Lee",
            url: "https://mag.example/people/sam/",
          },
        ],
      }),
    ),
  );
  const s = byId(trustSignals([home, post], SITE("https://mag.example")));
  assert.equal(s.about.found, true, "an About page linked only from the main menu");
  assert.match(s.about.evidence, /who-we-are/);
  assert.equal(s["author-byline"].found, true, "an author named only in the Article schema");
  assert.match(s["author-byline"].evidence, /Sam Lee/, "the author's @id reference is followed to the Person node");
  assert.equal(s["author-page"].found, true, "a Person node with a url");
  assert.equal(s.dates.found, true, "a date only in datePublished");
});

const SAMPLE = join(SKILL, "examples", "sample-audit.json");
async function render(data) {
  const dir = tmp();
  writeFileSync(join(dir, "audit.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "audit.json"), "--out", join(dir, "audit.html")]);
  return { html: readFileSync(join(dir, "audit.html"), "utf8"), md: readFileSync(join(dir, "audit.md"), "utf8") };
}
// The page's visible text, entities read back.
const visible = html =>
  html
    .replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
// 8 of 11 found: the three the spec's example names are missing.
const MISSING = ["author-page", "sources", "customer-proof"];
const signals = () =>
  trustSignals([], SITE("https://example.com")).map(s => ({
    ...s,
    applies: true,
    found: !MISSING.includes(s.id),
    evidence: MISSING.includes(s.id) ? null : "on /",
  }));
const scores = ({ html, md }) => ({
  overall: [md.match(/SEO health score: (\d+)\/100/)[1], html.match(/<span class="n">(\d+)<\/span>/)[1]],
  areas: md.split("\n").filter(l => /^\| [^|]+ \| \d+ \| \d+ \|/.test(l)),
  areaChips: [...html.matchAll(/class="ascore">(\d+)\/100/g)].map(m => m[1]),
});

test("missing signals never change the overall score", async () => {
  const base = JSON.parse(readFileSync(SAMPLE, "utf8"));
  const without = await render(base),
    withTrust = await render({ ...base, trustSignals: signals() });
  assert.deepEqual(scores(withTrust), scores(without), "the overall score and every area score are the same");
  assert.doesNotMatch(
    without.html + without.md,
    /Score views/,
    "no trust data, no views panel: older audits render as before",
  );
  for (const out of [visible(withTrust.html), withTrust.md]) {
    assert.match(out, /73\/100/);
    assert.match(out, /8 of 11 signals found · missing: author pages, sources cited, customer reviews/);
  }
  assert.ok(
    !JSON.stringify(withTrust.md.split("## Findings")[1]).includes("Author pages"),
    "missing signals aren't findings",
  );
});

test("the trust view says it's SEO Supervisor's own check", async () => {
  const list = signals(),
    { html, md } = await render({ ...JSON.parse(readFileSync(SAMPLE, "utf8")), trustSignals: list });
  const shown = visible(html);
  for (const out of [shown, md]) assert.match(out, /SEO Supervisor's own check, not a Google score/);
  for (const s of list.filter(s => !s.found)) {
    assert.ok(s.add, `${s.id} says what to add`);
    assert.ok(
      shown.includes(s.label) && shown.includes(s.add.replace(/`/g, "")),
      `the HTML lists ${s.id} with what to add`,
    );
    assert.ok(md.includes(`**${s.label}:** ${s.add}`), `the Markdown lists ${s.id} with what to add`);
  }
});

test("Local SEO and Content quality views reuse the area scores", async () => {
  const base = { ...JSON.parse(readFileSync(SAMPLE, "utf8")), trustSignals: signals() };
  const area = (md, name) => md.match(new RegExp(`^\\| ${name} \\| (\\d+) \\|`, "m"))?.[1];
  const view = (md, name) => md.match(new RegExp(`^\\| ${name} \\| (\\d+)/100 \\|`, "m"))?.[1];
  const plain = await render(base);
  assert.equal(view(plain.md, "Local SEO"), undefined, "no Local business rules checked, no Local SEO view");
  assert.doesNotMatch(plain.html, /Local SEO/);
  assert.equal(view(plain.md, "Content quality"), area(plain.md, "Headings & content"));

  const local = await render({
    ...base,
    findings: [
      ...base.findings,
      {
        id: "F-900",
        rule: "LOCAL-02",
        severity: "medium",
        category: "Local business",
        status: "open",
        title: "City pages share most of their text",
      },
    ],
    passed: [...base.passed, { rule: "LOCAL-06", title: "Local business schema", category: "Local business" }],
  });
  assert.ok(area(local.md, "Local business"), "the sample now has a Local business area");
  assert.equal(view(local.md, "Local SEO"), area(local.md, "Local business"));
  assert.match(local.html, /Local SEO/);
  assert.equal(view(local.md, "Content quality"), area(local.md, "Headings & content"));
});
