// @ts-check
// Cases from a real electrician site's closed (noindex) build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { render } from "../skills/seo-supervisor/scripts/render-report.mjs";
import { buildRules, score } from "../skills/seo-supervisor/scripts/lib/score.mjs";
import { bingAiPrefs } from "../skills/seo-supervisor/scripts/checks/site-agents.mjs";
import { isHtmlSitemap } from "../skills/seo-supervisor/scripts/checks/links.mjs";
import { RULES } from "../skills/seo-supervisor/scripts/crawl/catalog.mjs";

const SITE = { name: "Acme", url: "https://www.acme.example" };
const passing = n => Array.from({ length: n }, (_, i) => ({ rule: `P-${i}`, title: `Rule ${i}`, category: "Other" }));
const audit = (extra = {}) => ({
  site: SITE,
  run: { mode: "audit", date: "2026-11-23", pagesCrawled: 3 },
  findings: [],
  passed: passing(5),
  ...extra,
});
const draw = raw => render(raw, { dir: tmp(), mdFile: "seo-audit.md" });
const tabOf = (html, id) => {
  const i = html.indexOf(`id="p-${id}"`);
  return i < 0 ? "" : html.slice(i, html.indexOf('<section class="tp"', i + 1) >>> 0);
};
const cardOf = (html, title) => {
  const i = html.indexOf(`<section class="panel topic"><h2>${title}</h2>`);
  return i < 0 ? "" : html.slice(i, html.indexOf("</section>", i));
};
const low = (id, rule, category, url) => ({
  id,
  rule,
  severity: "low",
  status: "open",
  category,
  title: `Title ${id}`,
  what: "w",
  fix: "f",
  evidence: url ? [{ url }] : [],
});

test("this site's links to other sites have their own card, and a list of the top 5 says so", () => {
  const domains = {
    "northvale.example": 3,
    "riverton.example": 2,
    "countygov.example": 2,
    "eastvale.example": 2,
    "maps.example": 1,
    "six.example": 1,
    "seven.example": 1,
  };
  const { html, md } = draw(
    audit({
      linksToOtherSites: { pages: { "https://www.acme.example/": 3, "https://www.acme.example/a/": 1 }, domains },
    }),
  );
  assert.equal(cardOf(html, "Links from other sites"), "", "no card for links from other sites: there are none");
  const card = cardOf(html, "Links to other sites");
  assert.match(card, /2 of your 2 crawled pages link to other sites, 7 sites in all; the top 5 are below/);
  assert.ok(card.includes("northvale.example") && !card.includes("seven.example"));
  assert.match(md, /^### Links to other sites$/m);
  assert.doesNotMatch(md, /^### More about links$/m, "nothing else about links to show");
  const few = draw(
    audit({
      linksToOtherSites: { pages: { "https://www.acme.example/": 1 }, domains: { "a.example": 1, "b.example": 2 } },
    }),
  ).html;
  assert.match(cardOf(few, "Links to other sites"), /1 of your 1 crawled pages links to other sites, 2 sites in all\./);
  assert.doesNotMatch(few, /the top \d/);
  // Links from other sites still go in their own card.
  const both = draw(
    audit({
      links: { sites: [{ domain: "fan.example", links: 4 }], pages: [], when: "2026-11-20T00:00:00.000Z" },
      linksToOtherSites: { pages: { "https://www.acme.example/": 1 }, domains: { "a.example": 1 } },
    }),
  ).html;
  assert.match(cardOf(both, "Links from other sites"), /fan\.example/);
  assert.doesNotMatch(cardOf(both, "Links from other sites"), /a\.example/);
  assert.match(cardOf(both, "Links to other sites"), /a\.example/);
});

test("the score stops at 99 while any finding that isn't won't-fix is open, for the site, its areas and each page", () => {
  const one = [low("F-1", "X-01", "Other")];
  const s = score(buildRules(one, passing(99)));
  assert.equal(s.raw, 100, "99.8 rounds to 100");
  assert.equal(s.value, 99);
  assert.equal(s.cap, null, "the blocker cap is still only the blockers'");
  assert.equal(
    score(buildRules([{ ...one[0], status: "wont-fix" }], passing(99))).value,
    100,
    "a won't-fix finding is decided: it may round to 100",
  );
  assert.equal(score(buildRules([{ ...one[0], status: "fixed" }], passing(99))).value, 100);
  // Two areas each lose less than a point: one shows −1 (99 + 1 = 100), the other "<1", escaped.
  const raw = audit({
    passed: passing(198),
    findings: [low("F-1", "X-01", "Alpha", "https://www.acme.example/page/"), low("F-2", "X-02", "Beta")],
  });
  const { html, md } = draw(raw),
    ov = tabOf(html, "overview");
  assert.match(ov, /<p class="big b5-t"><span class="n">99<\/span>/);
  assert.doesNotMatch(ov, /Blocker cap/, "no blocker, so no blocker row");
  assert.match(ov, /&lt;1<small>pts/);
  assert.doesNotMatch(html, />[^<]*<1<small>/, "no raw <1 in the HTML");
  assert.match(ov, /−1<small>pts/);
  assert.doesNotMatch(ov, /Alpha <span class="ascore">100\/100|Beta <span class="ascore">100\/100/);
  assert.match(md, /\| `\/page\/` \| 99\/100 \|/, "the page with an open finding scores 99");
  // Only won't-fix findings left: 100 and Excellent.
  const done = draw(
    audit({ passed: passing(198), findings: [{ ...low("F-1", "X-01", "Alpha"), status: "wont-fix" }] }),
  ).html;
  assert.match(tabOf(done, "overview"), /<span class="n">100<\/span>/);
});

test("Bing's noarchive check skips noindex pages, also when --ignore-noindex checks them as indexable", () => {
  const added = [],
    legacy = { legacy: [{ where: "meta", rule: "noarchive" }], prefs: [] };
  const site = {
    htmlPages: [
      { finalUrl: "https://a.example/", bingAi: legacy, noindex: true },
      { finalUrl: "https://a.example/b/", bingAi: legacy, noindex: false },
    ],
    add: (id, url) => added.push([id, url]),
    evalRules: () => {},
    indexable: () => true,
  };
  bingAiPrefs(site);
  assert.deepEqual(added, [["ai-legacy-noarchive", "https://a.example/b/"]]);
});

test("the blocker cap's sentence is on the first screen once", () => {
  const b = (id, rule) => ({ ...low(id, rule, "Crawling & indexing"), severity: "blocker" });
  const ov = tabOf(draw(audit({ findings: [b("F-1", "B-01"), b("F-2", "B-02")] })).html, "overview");
  assert.equal(ov.split("hold the score at 49").length - 1, 1);
  assert.match(ov, /Blocker cap/);
});

test("image caching with nothing uncached says so, and the speed card is just Speed without Lighthouse", () => {
  const media = { imageCache: { checked: 37, uncachedCount: 0, uncached: [] } };
  const { html, md } = draw(audit({ media }));
  assert.doesNotMatch(html + md, /0 of 37 images/);
  assert.match(html, /all 37 images checked are sent with a cache lifetime/);
  assert.match(html, /<section class="panel topic"><h2>Speed<\/h2>/);
  assert.doesNotMatch(html, /Speed and Lighthouse/);
  const lh = draw(
    audit({ media, lighthouse: [{ url: "https://www.acme.example/", scores: { performance: 80 } }] }),
  ).html;
  assert.match(lh, /<section class="panel topic"><h2>Speed and Lighthouse<\/h2>/);
});

test("a closed site: the Overview's scope line says most pages are noindex, with the --ignore-noindex hint", () => {
  const notes = [
    "100% of pages are noindex. If the site is pre-launch, re-run with --ignore-noindex; per-page checks skipped those pages.",
  ];
  const { html, md } = draw(audit({ notes }));
  const scope = tabOf(html, "overview").match(/<p class="scope">[\s\S]*?<\/p>/)?.[0] || "";
  assert.match(scope, /100% of pages are noindex/);
  assert.match(scope, /--ignore-noindex/);
  assert.match(md, /100% of pages are noindex[^\n]*--ignore-noindex[^\n]*Limits of this audit/);
  assert.doesNotMatch(
    tabOf(draw(audit()).html, "overview").match(/<p class="scope">[\s\S]*?<\/p>/)?.[0] || "",
    /noindex/,
  );
});

test("the Local panel's wording follows the type: a trade that goes to its customers isn't told they come to its address", () => {
  const lb = (kind, type) => ({
    localBusiness: {
      kind,
      name: "Riverside Electric",
      type,
      areas: ["Northvale"],
      evidence: ["schema: Electrician on /"],
    },
  });
  for (const kind of ["hybrid", "storefront"])
    for (const type of ["Electrician", "Plumber", "Locksmith"]) {
      const { html, md } = draw(audit(lb(kind, type)));
      assert.doesNotMatch(html + md, /Customers come to the business/, `${kind} ${type}`);
      assert.match(html, /usually goes to its customers/, `${kind} ${type}`);
    }
  assert.match(
    draw(audit(lb("storefront", "Bakery"))).html,
    /Customers come to the business(&#39;|')s address: a storefront/,
  );
  assert.match(draw(audit(lb("hybrid", "Dentist"))).html, /also goes to them/);
});

test("LOCAL-05 is a Local business rule, so the Local SEO score view shows", () => {
  assert.equal(RULES["LOCAL-05"][1], "Local business");
  const trustSignals = [{ id: "about", label: "About page", rule: "TRUST-04", applies: true, found: true }];
  const { html } = draw(
    audit({
      trustSignals,
      passed: [...passing(5), { rule: "LOCAL-05", title: RULES["LOCAL-05"][0], category: RULES["LOCAL-05"][1] }],
    }),
  );
  assert.match(html, /<b>Local SEO<\/b>/);
});

test("an HTML sitemap page is recognised by its path, H1 or title", () => {
  const p = (path, title = "Page", h1 = "Page") => ({
    finalUrl: `http://localhost:1${path}`,
    title,
    headings: [{ level: 1, text: h1 }],
  });
  for (const x of [
    p("/sitemap"),
    p("/sitemap/"),
    p("/pages/", "Sitemap"),
    p("/all/", "x", " Site map "),
    p("/all/", "Sitemap | Acme"),
  ])
    assert.ok(isHtmlSitemap(x), x.finalUrl);
  for (const x of [p("/about/"), p("/sitemap.xml"), p("/sitemaps/guide/"), p("/x/", "Sitemap tips")])
    assert.ok(!isHtmlSitemap(x), x.finalUrl);
});

// ---------- one crawl of a closed local build ----------
// Every page but the home page is noindex, so it's crawled with --ignore-noindex.
const COPY =
  "Our electricians wire homes and businesses across Twin Rivers every day of the week, with a written quote before any work starts. ".repeat(
    3,
  );
const page = (title, main, head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${title} from Acme Electric in Twin Rivers.">${head}</head><body><header><nav><a href="/">Home</a></nav></header><main><h1>${title}</h1><p>${COPY}</p>${main}</main><footer><a href="/sitemap/">Sitemap</a> <a href="/about/">About</a></footer></body></html>`;
const CLOSED = '<meta name="robots" content="noindex, noarchive">';
const many = '<a href="/">Home</a>'.repeat(160);

test(
  "a closed local build: the HTML sitemap isn't flagged for menu-only or too many links, noarchive is quiet on noindex pages, and HTTPS is judged by --site-origin",
  { timeout: 120000 },
  async () => {
    const dir = tmp(),
      out = join(tmp(), "crawl.json");
    const pages = {
      "/": page("Electrician in Twin Rivers", "", '<meta name="robots" content="noarchive">'),
      "/sitemap/": page("Sitemap", many, CLOSED),
      "/about/": page("About Acme Electric", many, CLOSED),
    };
    for (const [p, h] of Object.entries(pages)) {
      mkdirSync(join(dir, p), { recursive: true });
      writeFileSync(join(dir, p, "index.html"), h);
    }
    const ORIGIN = "https://www.acme.example";
    writeFileSync(join(dir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
    writeFileSync(
      join(dir, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(
        pages,
      )
        .map(p => `<url><loc>${ORIGIN}${p}</loc></url>`)
        .join("")}</urlset>`,
    );
    const site = await serve(dir);
    try {
      await node([
        join(SCRIPTS, "seo-crawl.mjs"),
        "--url",
        site.url,
        "--site-origin",
        ORIGIN,
        "--ignore-noindex",
        "--out",
        out,
      ]);
    } finally {
      await site.close();
    }
    const r = JSON.parse(readFileSync(out, "utf8")),
      urls = check => (r.findings.find(f => f.check === check)?.evidence || []).map(e => new URL(e.url).pathname);
    assert.deepEqual(urls("nav-only-links"), ["/about/"], "the HTML sitemap is left out; another menu-only page isn't");
    assert.deepEqual(urls("too-many-links"), ["/about/"]);
    assert.deepEqual(urls("ai-legacy-noarchive"), ["/"], "only the page that can be indexed");
    assert.ok(
      r.findings.some(f => f.check === "sec-headers"),
      "the local server sends no security headers",
    );
    const https = r.trustSignals.find(s => s.id === "https");
    assert.equal(https.found, true, JSON.stringify(https));
    assert.match(https.evidence, /^https:\/\/www\.acme\.example/);
    assert.match(https.evidence, /local/);
  },
);
