import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { keywordIdeas, ideasMarkdown } from "../skills/seo-supervisor/scripts/keyword-ideas.mjs";

const CLI = join(SCRIPTS, "keyword-ideas.mjs");
const q = (query, impressions, position, clicks = 0) => ({
  query,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});
const page = (path, title, h1Text = null) => ({ url: "https://www.acme.com" + path, status: 200, title, h1Text });
const search = (queries, pageQueries = {}) => ({
  source: "google",
  site: "https://www.acme.com",
  period: "Last 90 days",
  queries,
  pageQueries,
  findings: [],
});
const phrases = list => list.map(i => i.phrase);

test("a query whose main words are in a page's title or H1 isn't a gap; case, accents, stop words and plurals don't count", () => {
  const crawl = {
    siteOrigin: "https://www.acme.com",
    pages: [page("/boilers/", "Boiler Repairs in Leeds | Acme"), page("/cafe/", "Our menu", "Café Menü")],
  };
  const r = keywordIdeas({
    search: search([
      q("boiler repair near me", 200, 25),
      q("cafe menu", 50, 30),
      q("Boiler Repair Leeds", 40, 22),
      q("solar panel cleaning", 80, 30),
    ]),
    crawl,
  });
  assert.deepEqual(phrases(r.gaps), ["solar panel cleaning"], "only the query no page is about");
  assert.equal(r.gaps[0].source, "Search Console");
  assert.deepEqual(r.gaps[0].evidence, { impressions: 80, clicks: 0, position: 30, page: null });
  assert.ok(r.gaps[0].use);
});

test("queries in scripts without spaces never become gaps", () => {
  const crawl = { pages: [page("/", "Acme")] };
  const r = keywordIdeas({ search: search([q("東京 ホテル", 100, 30), q("โรงแรม กรุงเทพ", 100, 30)]), crawl });
  assert.deepEqual(r.gaps, []);
});

test("brand queries are left out of gaps and almost there; the brand defaults to the site's name", () => {
  const crawl = { pages: [page("/", "Home")] };
  const data = search([
    q("acme plumbing", 500, 12),
    q("Acme reviews", 90, 30),
    q("acme.com", 90, 30),
    q("leak detection", 90, 30),
  ]);
  const r = keywordIdeas({ search: data, crawl });
  assert.deepEqual(phrases(r.gaps), ["leak detection"]);
  assert.deepEqual(r.almostThere, []);
  assert.equal(r.brand, "acme");
  const own = keywordIdeas({
    search: search([q("zeta boilers", 90, 30), q("leak detection", 90, 30)]),
    crawl,
    brand: "Zeta",
  });
  assert.deepEqual(phrases(own.gaps), ["leak detection"], "--brand replaces the guess");
});

test("almost there: position 8 to 20 with real impressions, and the page that ranks for it", () => {
  const data = search(
    [
      q("boiler service cost", 300, 12),
      q("radiator valves", 300, 7.9),
      q("power flush", 300, 20.1),
      q("combi boiler", 9, 15),
      q("gas safety check", 60, 8),
    ],
    { "/boilers/": [q("boiler service cost", 280, 11.5)], "/": [q("boiler service cost", 20, 30)] },
  );
  const r = keywordIdeas({ search: data });
  assert.deepEqual(phrases(r.almostThere), ["boiler service cost", "gas safety check"], "most impressions first");
  assert.equal(r.almostThere[0].evidence.page, "/boilers/", "the page with most of the query's impressions");
  assert.equal(r.almostThere[1].evidence.page, null, "no per-page data for it");
  assert.match(r.almostThere[0].use, /\/boilers\//);
  assert.ok(
    r.notes.some(n => /almost-page-one/.test(n) && /INTENT-04/.test(n)),
    "says how it relates to the page-level finding",
  );
  assert.equal(r.findings, undefined, "ideas never become findings");
});

test("with only per-page exports, a query's impressions add up across pages", () => {
  const r = keywordIdeas({
    search: {
      source: "search-console",
      period: null,
      queries: [],
      pageQueries: { "/a/": [q("boiler flush", 6, 10)], "/b/": [q("boiler flush", 6, 14)] },
    },
  });
  assert.deepEqual(
    r.almostThere.map(i => [i.phrase, i.evidence.impressions, i.evidence.position, i.evidence.page]),
    [["boiler flush", 12, 12, "/a/"]],
  );
});

test("questions are detected, in any language with a question mark", () => {
  const crawl = { pages: [page("/costs/", "Boiler costs")] };
  const r = keywordIdeas({
    search: search([
      q("how much does a boiler cost", 60, 30),
      q("can i bleed a radiator myself", 40, 25),
      q("¿cuánto cuesta una caldera?", 30, 40),
      q("can opener", 50, 30),
      q("acme opening hours?", 20, 30),
    ]),
    crawl,
  });
  assert.deepEqual(
    phrases(r.questions).sort(),
    [
      "acme opening hours?",
      "can i bleed a radiator myself",
      "how much does a boiler cost",
      "¿cuánto cuesta una caldera?",
    ].sort(),
    "brand questions stay: they make good FAQ entries",
  );
  assert.match(
    r.questions.find(i => i.phrase === "how much does a boiler cost").use,
    /\/costs\//,
    "a page already about it is named",
  );
  assert.ok(!phrases(r.gaps).includes("how much does a boiler cost"), "a query is listed in one group only");
  assert.ok(phrases(r.gaps).includes("can opener"), "a starter word with one more word isn't a question");
});

test("--extra phrases keep their source labels; malformed entries are skipped with a note", () => {
  const crawl = { pages: [page("/grants/", "Heat pump grants")] };
  const extra = [
    { phrase: "heat pump grants", source: "Google related searches, 2026-11-20" },
    { phrase: "air source heat pump noise", source: "Bing People also ask, 2026-11-20" },
    { phrase: "", source: "x" },
    { phrase: "no source" },
    "text",
  ];
  const r = keywordIdeas({ search: search([]), crawl, extra });
  assert.deepEqual(
    r.extra.map(i => [i.phrase, i.source]),
    [
      ["heat pump grants", "Google related searches, 2026-11-20"],
      ["air source heat pump noise", "Bing People also ask, 2026-11-20"],
    ],
  );
  assert.match(r.extra[0].use, /\/grants\//);
  assert.ok(r.notes.some(n => /3 .*skipped/.test(n)));
});

test("the honesty notes are always there, in the JSON and the Markdown", () => {
  const r = keywordIdeas({ search: search([q("leak detection", 90, 30)]) });
  const all = r.notes.join(" ");
  assert.match(all, /rare queries/i);
  assert.match(all, /no search volumes/i);
  assert.match(all, /you pick/i);
  assert.match(all, /without --crawl/i, "gaps aren't judged without the crawl");
  assert.equal(r.gaps, null, "not checked, which isn't the same as none");
  const md = ideasMarkdown(r);
  assert.match(md, /no search volumes/i);
  assert.match(md, /not checked/i);
});

test("Markdown escapes queries, sources and pages", () => {
  const crawl = { pages: [page("/", "Home")] };
  const evil = "best *boiler* [deal](javascript:alert(1)) <script>x</script> | pipe";
  const r = keywordIdeas({
    search: search([q(evil, 90, 30)], { "/a_b/": [q(evil, 90, 30)] }),
    crawl,
    extra: [{ phrase: "<img src=x onerror=alert(1)>", source: "Bing_[x](y)" }],
  });
  const md = ideasMarkdown(r);
  assert.ok(!/(^|[^\\])[<[]/m.test(md), "every < and [ is backslash-escaped: no raw HTML, no links");
  assert.ok(
    md.includes("\\*boiler\\*") && md.includes("\\| pipe") && md.includes("Bing\\_"),
    "emphasis and table characters escaped",
  );
  assert.ok(md.includes("/a\\_b/"), "the page that shows for it is escaped too");
});

test("a normal site stays quiet: queries match pages and rank on page one", () => {
  const crawl = {
    pages: [page("/", "Acme Plumbing in Leeds"), page("/boilers/", "Boiler repair and servicing", "Boiler repair")],
  };
  // "leeds" is only on the home page: with 3+ main words, a page holding all but one is about the query.
  const r = keywordIdeas({
    search: search([
      q("acme", 900, 1.2),
      q("boiler repair", 400, 3.1),
      q("boiler servicing leeds", 120, 4),
      q("best boiler repairs near me", 50, 5),
    ]),
    crawl,
  });
  assert.deepEqual([r.gaps, r.almostThere, r.questions, r.extra], [[], [], [], []]);
});

test("the CLI writes the JSON and the Markdown next to it", async () => {
  const dir = tmp(),
    gsc = join(dir, "gsc.json"),
    crawl = join(dir, "crawl.json"),
    out = join(dir, "ideas", "keyword-ideas.json"),
    extra = join(dir, "extra.json");
  writeFileSync(
    gsc,
    JSON.stringify({
      source: "search-console",
      period: null,
      traffic: {},
      queries: [q("leak detection", 90, 30)],
      pageQueries: {},
      findings: [],
    }),
  );
  writeFileSync(crawl, JSON.stringify({ siteOrigin: "https://www.acme.com", pages: [page("/", "Home")] }));
  writeFileSync(extra, JSON.stringify([{ phrase: "heat pumps", source: "Google related searches, 2026-11-20" }]));
  const { stdout } = await node([CLI, "--gsc", gsc, "--crawl", crawl, "--extra", extra, "--out", out]);
  const r = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(phrases(r.gaps), ["leak detection"]);
  assert.deepEqual(phrases(r.extra), ["heat pumps"]);
  assert.ok(existsSync(join(dir, "ideas", "keyword-ideas.md")));
  assert.match(stdout, /keyword-ideas\.json/);
});

test("empty or missing input gives a clear message", async () => {
  const dir = tmp(),
    gsc = join(dir, "gsc.json");
  writeFileSync(
    gsc,
    JSON.stringify({ source: "search-console", traffic: {}, queries: [], pageQueries: {}, findings: [] }),
  );
  const fails = args =>
    node([CLI, ...args, "--out", join(dir, "o.json")]).then(
      () => assert.fail("should exit 2"),
      e => {
        assert.equal(e.code, 2);
        return e.stderr;
      },
    );
  assert.match(await fails(["--gsc", gsc]), /no search queries/i);
  assert.match(await fails([]), /usage/i);
  assert.match(await fails(["--gsc", join(dir, "missing.json")]), /can't read/i);
  assert.ok(!existsSync(join(dir, "o.json")));
});
