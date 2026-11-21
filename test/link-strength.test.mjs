// Link strength: PageRank over the crawl's own links, scaled to 0–100.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { pageRank, scale } from "../skills/seo-supervisor/scripts/checks/link-strength.mjs";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const ranks = out => {
  const { rank, base } = pageRank(new Map(Object.entries(out)));
  return { r: Object.fromEntries(rank), base };
};

// ---------- the math ----------
test("a cycle shares evenly, and every page is equally strong", () => {
  const { r, base } = ranks({ a: ["b"], b: ["c"], c: ["a"] });
  for (const k of "abc") near(r[k], 1 / 3, k);
  near(base, 0.15 / 3, "base: what a page nobody links to gets");
  assert.deepEqual(Object.fromEntries(scale(new Map(Object.entries(r)), base)), { a: 100, b: 100, c: 100 });
});

test("a star: the centre's share is (1 + d·k) / (n·(1 + d)), each leaf the rest", () => {
  const { r } = ranks({ c: ["l1", "l2", "l3", "l4"], l1: ["c"], l2: ["c"], l3: ["c"], l4: ["c"] });
  near(r.c, (1 + 0.85 * 4) / (5 * 1.85), "centre");
  for (const k of ["l1", "l2", "l3", "l4"]) near(r[k], (1 - r.c) / 4, k);
  near(
    Object.values(r).reduce((s, x) => s + x, 0),
    1,
    "shares sum to 1",
  );
});

test("a chain ending in a page with no links: that page spreads its share evenly over every page", () => {
  // a → b → c, c links nowhere. Every page gets x = (0.15 + 0.85·c)/3; b = 1.85x, c = 2.5725x; they sum to 1.
  const { r, base } = ranks({ a: ["b"], b: ["c"], c: [] }),
    x = 1 / 5.4225;
  near(r.a, x, "a");
  near(r.b, 1.85 * x, "b");
  near(r.c, 2.5725 * x, "c");
  near(base, x, "base includes the spread share");
  // Logarithmic: a has nothing beyond the base (0), c is the strongest (100), b sits at ln 1.85 / ln 2.5725.
  assert.deepEqual(Object.fromEntries(scale(new Map(Object.entries(r)), base)), {
    a: 0,
    b: Math.round((100 * Math.log(1.85)) / Math.log(2.5725)),
    c: 100,
  });
});

test("one page with no links: two pages, a → b", () => {
  const { r } = ranks({ a: ["b"], b: [] });
  near(r.a, 1 / 2.85, "a");
  near(r.b, 1.85 / 2.85, "b");
});

test("self-links, a page's repeat links to the same target and links to pages not crawled are ignored", () => {
  const plain = ranks({ a: ["b"], b: ["a"] }).r,
    noisy = ranks({ a: ["b", "b", "a", "https://gone.example/"], b: ["a", "a", "b"] }).r;
  near(noisy.a, plain.a, "a");
  near(noisy.b, plain.b, "b");
  near(plain.a, 0.5, "a cycle of two");
});

test("no links at all: every page reads 0, and an empty site gives nothing", () => {
  const { r, base } = ranks({ a: [], b: [], c: [] });
  for (const k of "abc") near(r[k], 1 / 3, k);
  assert.deepEqual([...scale(new Map(Object.entries(r)), base).values()], [0, 0, 0]);
  assert.equal(pageRank(new Map()).rank.size, 0);
});

test("the 0–100 scale is against the strongest of the pages kept, and never leaves 0–100", () => {
  const { r, base } = ranks({ home: ["a", "b", "hidden"], a: ["home"], b: ["home", "a"], hidden: ["home"] }),
    rank = new Map(Object.entries(r));
  const s = scale(rank, base, ["a", "b", "hidden"]);
  assert.deepEqual([...s.keys()], ["a", "b", "hidden"], "only the pages kept");
  assert.equal(Math.max(...s.values()), 100, "the strongest kept page is 100");
  assert.equal(s.get("a"), 100);
  assert.ok(s.get("b") < 100 && s.get("b") > 0 && s.get("b") === s.get("hidden"), JSON.stringify([...s]));
  for (const v of s.values()) assert.ok(Number.isInteger(v) && v >= 0 && v <= 100);
});

// ---------- the crawl ----------
const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const page = (title, body = "", head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;
const links = (...hrefs) => hrefs.map(h => `<a href="${h}">Read more</a>`).join(" ");
const SITE = {
  "/": page("Boiler repairs in Leeds", links("/a/", "/b/", "/c")), // /c answers 301 → /c/
  "/a/": page("Boiler servicing", links("/b/", "/b/", "/a/", "/hidden/")),
  "/b/": page("Radiator repairs", links("/")),
  "/c/": page("Hot water faults", links("/")),
  "/hidden/": page("Old offers", "", '<meta name="robots" content="noindex">'),
};
async function crawlSite(pages, args = []) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
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
      ...args,
    ]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}

test("the crawl gives each indexable page a strength by path, follows redirects, and it's never a finding", async () => {
  const r = await crawlSite(SITE),
    s = r.linkStrength?.pages;
  assert.ok(s, JSON.stringify(r.linkStrength));
  assert.deepEqual(
    Object.keys(s).sort(),
    ["/", "/a/", "/b/", "/c/"],
    "noindex pages aren't scored, and /c is scored as /c/",
  );
  assert.equal(s["/"], 100, "the home page is the strongest");
  assert.equal(
    s["/c/"],
    s["/a/"],
    "the link to /c reaches /c/ through its redirect, so /c/ gets what /a/ gets from the home page",
  );
  assert.ok(s["/b/"] > s["/a/"], "/b/ is linked from the home page and /a/ (twice there, counted once)");
  assert.deepEqual(
    Object.values(s),
    Object.values(s)
      .slice()
      .sort((a, b) => b - a),
    "strongest first",
  );
  assert.ok(Number.isInteger(r.linkStrength.median), "the site-level summary");
  assert.equal(r.linkStrength.capped, undefined);
  assert.ok(!r.findings.some(f => /strength|pagerank/i.test(f.check + f.title)), "never a finding");
});

test("a crawl stopped at --max says so, and a one-section crawl is skipped", async () => {
  const capped = await crawlSite(SITE, ["--max", "3"]);
  assert.equal(capped.linkStrength?.capped, true, JSON.stringify(capped.linkStrength));
  const section = await crawlSite(SITE, ["--include", "/a/"]);
  assert.equal(section.linkStrength, undefined, "links from the pages left out aren't known");
});

// ---------- the report ----------
const ORIGIN = "https://site.example";
const renderReport = async data => {
  const dir = tmp();
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};
const evil = "/<img src=x onerror=alert(1)>/";
const strength = {
  pages: {
    "/": 100,
    "/services/": 80,
    [evil]: 72,
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/p${i}/`, 60 - 5 * i])),
  },
  median: 35,
};
const base = {
  site: { name: "Site", url: ORIGIN },
  run: { date: "2026-11-22" },
  findings: [],
  passed: [{ rule: "LINK-02", title: "No orphan pages", category: "Internal linking" }],
};
const panel = s =>
  s.match(/\n {4}<details class="how linkstrength">[\s\S]*?<\/details>/)?.[0] ?? assert.fail("no panel");
const text = s => panel(s).replaceAll("&#39;", "'"); // esc writes an apostrophe as &#39;
const mdPart = s => s.match(/## Internal link strength[\s\S]*?(?=\n## |$)/)?.[0] ?? assert.fail("no Markdown section");

test("the report's panel: the 10 strongest pages with honest labels, escaped, and the score doesn't change", async () => {
  const on = await renderReport({ ...base, linkStrength: strength }),
    off = await renderReport(base);
  assert.equal(
    on.html.replace(panel(on.html), ""),
    off.html,
    "only the panel changes: the score and areas are the same",
  );
  assert.match(panel(on.html), /<summary>Internal link strength<\/summary>/);
  for (const s of [text(on.html), mdPart(on.md)]) {
    assert.match(s, /our own measure/);
    assert.match(s, /PageRank formula/);
    assert.match(s, /not Google's PageRank/);
    assert.match(s, /links from the whole web/);
    assert.match(s, /isn't public/);
    assert.match(s, /pages this crawl read/);
    assert.match(s, /Information only/);
    assert.match(s, /15 pages/);
    assert.match(s, /strength of 35 or less/);
    assert.match(s, /\/p6\//, "the tenth strongest");
    assert.doesNotMatch(s, /\/p7\//, "only 10");
    assert.doesNotMatch(s, /found in search/i, "no traffic, no traffic list");
  }
  assert.ok(panel(on.html).indexOf("/services/") < panel(on.html).indexOf("/p0/"), "strongest first");
  assert.ok(
    !on.html.includes("<img src=x") && on.html.includes("&lt;img src=x onerror=alert(1)&gt;"),
    "crawled paths are escaped",
  );
  assert.ok(!/(^|[^\\`])<img src=x/m.test(on.md.replace(/`[^`]*`/g, "")), "and in the Markdown");
  assert.ok(!off.html.includes("linkstrength") && !off.md.includes("Internal link strength"));
  const capped = await renderReport({ ...base, linkStrength: { ...strength, capped: true } });
  assert.match(panel(capped.html), /--max/);
});

test("with Search Console traffic, the panel lists pages people find in search that get little link strength", async () => {
  // Bottom third of the 15 values (100, 80, 72, 60 … 5): the 5 weakest, 25 or less.
  const traffic = {
    "/p11/": { clicks: 300, impressions: 9000 },
    "/p8/": { clicks: 0, impressions: 5000 },
    "/services/": { clicks: 900, impressions: 20000 },
    "/p2/": { clicks: 50, impressions: 800 },
    "/gone/": { clicks: 999, impressions: 1 },
  };
  const r = await renderReport({ ...base, linkStrength: strength, traffic, trafficPeriod: "Last 3 months" });
  for (const s of [text(r.html), mdPart(r.md)]) {
    assert.match(s, /found in search/i);
    assert.match(s, /our own rule/);
    assert.match(s, /\/p11\/[\s\S]*strength 5[\s\S]*300 clicks/);
    assert.match(s, /\/p8\/[\s\S]*strength 20[\s\S]*5,000 impressions/);
    assert.doesNotMatch(
      s.split(/found in search/i)[1],
      /\/services\/|\/p2\/|\/gone\//,
      "strong pages and pages not crawled aren't listed",
    );
    assert.ok(
      s.indexOf("/p11/", s.search(/found in search/i)) < s.indexOf("/p8/", s.search(/found in search/i)),
      "most clicks first",
    );
    assert.match(s, /strongest pages/);
    assert.match(s, /Internal link ideas/);
    assert.match(s, /last 3 months/);
  }
});
