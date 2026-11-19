import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffCrawls } from "../skills/seo-supervisor/scripts/seo-diff.mjs";
import { serve } from "./serve.mjs";
import { ROOT, SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const OLD = join(ROOT, "test", "fixtures", "crawl-old.json"),
  NEW = join(ROOT, "test", "fixtures", "crawl-new.json");
const read = p => JSON.parse(readFileSync(p, "utf8"));
const kinds = list => list.map(c => `${c.path} ${c.kind}`).sort();

test("two crawls are compared page by page, by path", () => {
  const d = diffCrawls(read(OLD), read(NEW));
  assert.deepEqual(kinds(d.regressions), [
    "/a/ noindex-added",
    "/c/ canonical-changed",
    "/d/ h1-removed",
    "/f/ schema-removed",
    "/h/ status-error",
    "/j/ title-changed",
    "/m/ description-changed",
    "/n/ og-removed",
    "/p/ content-shrunk",
  ]);
  assert.deepEqual(kinds(d.improvements), [
    "/b/ noindex-removed",
    "/e/ h1-added",
    "/g/ schema-added",
    "/i/ status-fixed",
    "/o/ og-added",
  ]);
  assert.deepEqual(
    kinds(d.changed),
    ["/k/ title-changed", "/l/ description-changed", "/q/ content-grew"],
    "a new non-empty title or description and more content are neutral",
  );
  assert.deepEqual(d.added, ["/new/"]);
  assert.deepEqual(d.removed, ["/gone/"], "/about/ moved from a local to the public origin and is the same page");
  const c = d.regressions.find(x => x.kind === "canonical-changed");
  assert.deepEqual([c.before, c.after], ["https://example.com/c/", "https://example.com/a/"]);
  const at = kind => {
    const x = [...d.regressions, ...d.improvements, ...d.changed].find(y => y.kind === kind);
    return [x.before, x.after];
  };
  assert.deepEqual(at("og-removed"), ["og:title, og:image", "og:title"]);
  assert.deepEqual(at("og-added"), [null, "og:title, og:image"]);
  assert.deepEqual(at("content-shrunk"), [800, 120]);
  assert.ok(![...d.regressions, ...d.changed].some(x => x.path === "/r/"), "300 → 180 words is less than half gone");
});

test("the CLI writes the diff with the old crawl's date", async () => {
  const out = join(tmp(), "seo-diff.json");
  await node([join(SCRIPTS, "seo-diff.mjs"), OLD, NEW, "--out", out]);
  const d = read(out);
  assert.equal(d.since, "2026-10-01T09:00:00.000Z");
  assert.equal(d.regressions.length, 9);
});

const render = async diff => {
  const dir = tmp(),
    data = read(join(SKILL, "examples", "sample-audit.json"));
  if (diff) data.diff = diff;
  else delete data.diff;
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};

test("the report shows a Since last audit tab with the regression count", async () => {
  const { html, md } = await render({ since: "2026-10-01T09:00:00.000Z", ...diffCrawls(read(OLD), read(NEW)) });
  assert.match(html, /id="t-diff"[^>]*>Since last audit<span class="cnt">9<\/span>/);
  assert.match(html, /Now noindex/);
  for (const label of [
    "Description changed",
    "Open Graph tags removed",
    "Open Graph tags added",
    "Word count fell",
    "Word count grew",
  ])
    assert.match(html, new RegExp(label));
  assert.match(md, /## Since last audit/);
});

test("without a diff there's no Since last audit tab", async () => {
  const { html } = await render(null);
  assert.doesNotMatch(html, /id="t-diff"/);
});

test("pages are keyed by path and query, a lost self-canonical is a regression, and crawl errors count as status changes", () => {
  const P = (url, extra = {}) => ({
    url,
    status: 200,
    noindex: false,
    canonical: url,
    title: url,
    h1: 1,
    schema: [],
    ...extra,
  });
  const d = diffCrawls(
    { pages: [P("https://e.com/blog"), P("https://e.com/blog?page=2"), P("https://e.com/a/"), P("https://e.com/x/")] },
    {
      pages: [P("https://e.com/blog?page=2"), P("https://e.com/blog"), P("https://e.com/a/", { canonical: null })],
      errors: [{ url: "https://e.com/x/", status: 500 }],
    },
  );
  assert.deepEqual(d.changed, [], "?page=2 isn't confused with /blog");
  assert.deepEqual(kinds(d.regressions), ["/a/ canonical-changed", "/x/ status-error"]);
  assert.deepEqual(d.removed, [], "a page that now errors isn't 'gone'");
  const n = diffCrawls(
    { pages: [P("https://e.com/a/")] },
    {
      pages: [P("https://e.com/a/"), P("https://e.com/new/")],
      errors: [{ url: "https://e.com/broken/", status: 404 }],
    },
  );
  assert.deepEqual(n.added, ["/new/"], "a new URL that only fails (a broken link target) isn't an added page");
});

test("descriptions, share tags and word counts are compared only when both crawls recorded them", () => {
  const P = (extra = {}) => ({
    url: "https://e.com/a/",
    status: 200,
    noindex: false,
    canonical: "https://e.com/a/",
    title: "A",
    h1: 1,
    schema: [],
    ...extra,
  });
  const none = diffCrawls(
    { pages: [P()] },
    { pages: [P({ description: "New", ogTitle: "A", ogImage: "/a.png", words: 900 })] },
  );
  assert.deepEqual(
    [...none.regressions, ...none.improvements, ...none.changed],
    [],
    "a crawl from an older version has none of these fields",
  );
  const d = diffCrawls({ pages: [P({ words: 150 })] }, { pages: [P({ words: 60 })] });
  assert.deepEqual(d.regressions, [], "more than half gone, but fewer than 100 words");
  assert.deepEqual(none.compared, []);
  const full = P({ description: "D", ogTitle: "A", ogImage: null, words: 300 });
  assert.deepEqual(diffCrawls({ pages: [full] }, { pages: [full] }).compared, ["description", "og", "words"]);
});

test("Nothing changed names only the fields both crawls recorded", async () => {
  const empty = {
    since: "2026-10-01T09:00:00.000Z",
    regressions: [],
    improvements: [],
    changed: [],
    added: [],
    removed: [],
  };
  const said = async diff => (await render(diff)).html.match(/<h2>Nothing changed<\/h2><p>([^<]*)<\/p>/)[1];
  assert.equal(
    await said(empty),
    "Every page has the same status, indexing, canonical, title, H1 and schema as last time.",
    "an older crawl had no descriptions, share tags or word counts",
  );
  assert.equal(
    await said({ ...empty, compared: ["description", "og", "words"] }),
    "Every page has the same status, indexing, canonical, title, description, share tags, H1, schema and length as last time.",
  );
  assert.equal(
    await said({ ...empty, compared: ["schemaProps", "speed"] }),
    "Every page has the same status, indexing, canonical, title, H1, schema and schema fields as last time, and no page got much faster or slower.",
  );
});

// Two crawls with speed from each source: real visitors (speed.samples), the crawler's lab load (labSpeed), Lighthouse.
const crawlWithSpeed = ({ field = {}, lab = {}, perf = {} }) => ({
  pages: [],
  speed: {
    strategy: "mobile",
    samples: Object.entries(field).map(([p, f]) => ({ url: `https://e.com${p}`, field: f, origin: null, lab: {} })),
  },
  labSpeed: Object.entries(lab).map(([p, lcp]) => ({ url: `http://127.0.0.1:3000${p}`, lcp, cls: 0.01, tbt: 100 })),
  lighthouse: Object.entries(perf).map(([p, performance]) => ({
    url: `http://127.0.0.1:3000${p}`,
    scores: { performance },
    metrics: {},
    failed: [],
  })),
});
const cwv = (lcp, inp = 150, cls = 0.05) => ({ lcp, inp, cls });

test("real-user speed is a regression when LCP got 20% and 300 ms slower or a Core Web Vital started failing", () => {
  const d = diffCrawls(
    crawlWithSpeed({
      field: {
        "/a/": cwv(2000),
        "/b/": cwv(2000),
        "/c/": cwv(2000, 180),
        "/d/": cwv(1000),
        "/e/": cwv(3500),
        "/f/": cwv(2000, 150, 0.2),
        "/g/": cwv(2000),
      },
    }),
    crawlWithSpeed({
      field: {
        "/a/": cwv(2700),
        "/b/": cwv(2300),
        "/c/": cwv(2100, 220),
        "/d/": cwv(1250),
        "/e/": cwv(2600),
        "/f/": cwv(2000, 150, 0.05),
        "/h/": cwv(9000),
      },
    }),
  );
  assert.deepEqual(
    kinds(d.regressions),
    ["/a/ speed-slower", "/c/ speed-slower"],
    "/b/ is 15% slower, /d/ only 250 ms",
  );
  assert.deepEqual(
    kinds(d.improvements),
    ["/e/ speed-faster", "/f/ speed-faster"],
    "LCP 900 ms and 26% faster; CLS passing again",
  );
  assert.deepEqual(d.regressions[0], {
    path: "/a/",
    kind: "speed-slower",
    source: "real visitors",
    before: "LCP 2.0 s · INP 150 ms · CLS 0.05",
    after: "LCP 2.7 s · INP 150 ms · CLS 0.05",
  });
  assert.ok(d.compared.includes("speed"));
});

test("lab speed needs a bigger change (LCP 40% and 1 s, Lighthouse 15 points), and sources are never mixed", () => {
  const d = diffCrawls(
    crawlWithSpeed({ lab: { "/a/": 2000, "/b/": 2000, "/c/": 4000 }, perf: { "/": 80, "/x/": 80, "/y/": 50 } }),
    crawlWithSpeed({ lab: { "/a/": 2700, "/b/": 3200, "/c/": 2300 }, perf: { "/": 70, "/x/": 64, "/y/": 66 } }),
  );
  assert.deepEqual(
    kinds(d.regressions),
    ["/b/ speed-slower", "/x/ speed-slower"],
    "/a/ is 700 ms slower, within a lab run's noise; / lost 10 points",
  );
  assert.deepEqual(kinds(d.improvements), ["/c/ speed-faster", "/y/ speed-faster"]);
  assert.deepEqual(
    d.regressions.map(c => [c.source, c.before, c.after]),
    [
      ["lab test", "LCP 2.0 s · CLS 0.01", "LCP 3.2 s · CLS 0.01"],
      ["Lighthouse", "performance score 80", "performance score 64"],
    ],
  );
  const mixed = diffCrawls(
    crawlWithSpeed({ field: { "/a/": cwv(2000) } }),
    crawlWithSpeed({ lab: { "/a/": 9000 }, perf: { "/a/": 10 } }),
  );
  assert.deepEqual(
    [...mixed.regressions, ...mixed.improvements],
    [],
    "real-user numbers before, lab numbers after: nothing to compare",
  );
  assert.ok(!mixed.compared.includes("speed"));
  assert.ok(!diffCrawls({ pages: [] }, { pages: [] }).compared.includes("speed"));
});

test("a schema type both crawls have that lost or gained fields is a change; values aren't compared", () => {
  const P = (schemaProps, extra = {}) => ({
    url: "https://e.com/p/",
    status: 200,
    noindex: false,
    canonical: "https://e.com/p/",
    title: "P",
    h1: 1,
    schema: Object.keys(schemaProps),
    schemaProps,
    ...extra,
  });
  const d = diffCrawls(
    {
      pages: [
        P({
          Product: ["aggregateRating", "image", "name", "offers"],
          BreadcrumbList: ["itemListElement"],
          FAQPage: ["mainEntity"],
        }),
      ],
    },
    { pages: [P({ Product: ["brand", "image", "name"], BreadcrumbList: ["itemListElement"] })] },
  );
  assert.deepEqual(
    kinds(d.regressions),
    ["/p/ schema-fields-removed", "/p/ schema-removed"],
    "FAQPage went entirely: that's schema-removed, not lost fields",
  );
  assert.deepEqual(
    d.regressions.find(c => c.kind === "schema-fields-removed"),
    {
      path: "/p/",
      kind: "schema-fields-removed",
      detail: "Product lost aggregateRating, offers",
      before: "aggregateRating, image, name, offers",
      after: "brand, image, name",
    },
  );
  assert.deepEqual(
    d.improvements.map(c => c.detail),
    ["Product gained brand"],
  );
  assert.ok(d.compared.includes("schemaProps"));
  const older = diffCrawls(
    { pages: [P({ Product: ["offers"] })].map(({ schemaProps, ...p }) => p) },
    { pages: [P({ Product: [] })] },
  );
  assert.deepEqual(
    [...older.regressions, ...older.improvements],
    [],
    "a crawl from an older version has no schema fields",
  );
  assert.ok(!older.compared.includes("schemaProps"));
});

test("the crawler records each schema type's top-level fields, merged across blocks; a later crawl with a new price is no change", async () => {
  const dir = tmp(),
    page = (price, extra) =>
      `<!doctype html><html><head><title>Widget</title><link rel="canonical" href="https://shop.example/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Widget","offers":{"@type":"Offer","price":"${price}","priceCurrency":"USD"}}</script><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","@id":"#p","image":"/w.png"${extra}},{"@type":["Organization","Brand"],"name":"Shop","url":"/"}]}</script></head><body><h1>Widget</h1><p>$${price}</p></body></html>`;
  const crawlOf = async html => {
    writeFileSync(join(dir, "index.html"), html);
    const site = await serve(dir),
      out = join(dir, "crawl.json");
    try {
      await node([
        join(SCRIPTS, "seo-crawl.mjs"),
        "--url",
        site.url,
        "--site-origin",
        "https://shop.example",
        "--out",
        out,
      ]);
    } finally {
      await site.close();
    }
    return read(out);
  };
  const a = await crawlOf(page("19.99", ',"aggregateRating":{"@type":"AggregateRating","ratingValue":4.5}'));
  assert.deepEqual(a.pages[0].schemaProps, {
    Product: ["aggregateRating", "image", "name", "offers"],
    Organization: ["name", "url"],
    Brand: ["name", "url"],
  });
  const b = await crawlOf(page("24.99", ""));
  assert.deepEqual(diffCrawls(a, a).regressions, [], "same crawl twice");
  assert.deepEqual(
    diffCrawls(a, b).regressions.map(c => c.detail),
    ["Product lost aggregateRating"],
    "the price changed, the fields didn't",
  );
});

test("speed and schema-field changes show in Since last audit with plain labels", async () => {
  const diff = {
    since: "2026-10-01T09:00:00.000Z",
    added: [],
    removed: [],
    changed: [],
    compared: ["speed", "schemaProps"],
    regressions: [
      { path: "/a/", kind: "speed-slower", source: "real visitors", before: "LCP 2.0 s", after: "LCP 2.7 s" },
      {
        path: "/p/",
        kind: "schema-fields-removed",
        detail: "Product lost aggregateRating, offers",
        before: "aggregateRating, image, name, offers",
        after: "image, name",
      },
    ],
    improvements: [
      {
        path: "/b/",
        kind: "speed-faster",
        source: "Lighthouse",
        before: "performance score 50",
        after: "performance score 70",
      },
      {
        path: "/p/",
        kind: "schema-fields-added",
        detail: "Product gained brand",
        before: "image",
        after: "brand, image",
      },
    ],
  };
  const { html, md } = await render(diff);
  for (const text of [html, md]) {
    assert.match(text, /Now slower \(real visitors\): LCP 2\.0 s → LCP 2\.7 s/);
    assert.match(text, /Now faster \(Lighthouse\): performance score 50 → performance score 70/);
    assert.match(text, /Schema fields removed: Product lost aggregateRating, offers/);
    assert.match(text, /Schema fields added: Product gained brand/);
  }
});
