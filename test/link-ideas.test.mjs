// Internal link ideas and unmentioned searches, from seo-crawl.words.json and Search Console's per-page queries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { keywordIdeas, ideasMarkdown } from "../skills/seo-supervisor/scripts/keyword-ideas.mjs";

const q = (query, impressions, position, clicks = 0) => ({
  query,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});
const search = pageQueries => ({
  source: "google",
  site: "https://www.acme.com",
  period: "Last 90 days",
  queries: [],
  pageQueries,
  findings: [],
});
const EVIL = "<img src=x onerror=alert(1)>";

// ---------- the crawl's page words, then keyword-ideas on them ----------
// "Zebra" is only in the menu and the footer: they aren't the main text. /old/ is noindex.
const html = (title, main, head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><header><nav><a href="/">Home</a> <a href="/blog/costs/">Costs</a> <a href="/blog/radiators/">Radiators</a> <a href="/old/">Zebra crossing</a></nav></header><main><h1>${title}</h1>${main}</main><footer>Zebra Heating Ltd</footer></body></html>`;
const SITE = {
  "/": html("Acme Heating", `<p>We fix heating across the city. See our <a href="/boilers/">boiler repairs</a>.</p>`),
  "/boilers/": html("Boiler repairs", "<p>We repair combi boilers and system boilers, with a written quote first.</p>"),
  "/blog/costs/": html(
    "What a new boiler costs",
    "<p>A boiler repair often costs far less than a new one. Our price list shows both.</p>",
  ),
  "/blog/radiators/": html(
    "Radiator bleeding",
    `<p>Bleeding a radiator is easy. For a boiler repair, see <a href="/boilers/">our boiler team</a>.</p>`,
  ),
  "/old/": html(
    "Old boiler price list",
    "<p>Boiler repair price list from 2020.</p>",
    '<meta name="robots" content="noindex">',
  ),
};
const GOOGLE = search({
  "/boilers/": [
    q("boiler repairs", 500, 4, 40),
    q("boiler price", 300, 6, 3),
    q("radiator bleeding", 50, 9),
    q("acme boilers", 200, 1, 90),
    q("ボイラー 修理", 100, 5),
    q("boiler service", 5, 12),
  ],
  "/blog/costs/": [q("boiler repairs", 20, 30)],
  "/gone/": [q("boiler parts", 50, 20)],
});

test("the crawl writes each indexable page's main-text words and links next to seo-crawl.json; keyword-ideas turns them into link ideas and missing searches", async () => {
  const site = tmp(),
    dir = tmp(),
    out = join(dir, "seo-crawl.json");
  for (const [p, h] of Object.entries(SITE)) {
    mkdirSync(join(site, p), { recursive: true });
    writeFileSync(join(site, p, "index.html"), h);
  }
  writeFileSync(join(site, "robots.txt"), "User-agent: *\nAllow: /\n");
  const srv = await serve(site);
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      srv.url,
      "--site-origin",
      "https://site.example",
      "--out",
      out,
    ]);
  } finally {
    await srv.close();
  }
  const crawl = JSON.parse(readFileSync(out, "utf8")),
    words = JSON.parse(readFileSync(join(dir, "seo-crawl.words.json"), "utf8"));
  assert.deepEqual(
    crawl.pageWords,
    { file: "seo-crawl.words.json", stamp: words.stamp, pages: 4 },
    "seo-crawl.json only points at the file",
  );
  assert.ok(
    !crawl.pages.some(p => "words" in p && typeof p.words !== "number"),
    "the pages list doesn't carry the words",
  );
  const by = Object.fromEntries(words.pages.map(p => [p.path, p]));
  assert.deepEqual(
    Object.keys(by).sort(),
    ["/", "/blog/costs/", "/blog/radiators/", "/boilers/"],
    "the noindex page is left out",
  );
  assert.ok(by["/boilers/"].words.split(" ").includes("combi") && by["/boilers/"].words.split(" ").includes("boilers"));
  assert.ok(!words.pages.some(p => p.words.split(" ").includes("zebra")), "the menu and footer aren't the main text");
  assert.ok(!by["/blog/costs/"].words.split(" ").includes("what"), "stop words are left out");
  const at = words.pages.findIndex(p => p.path === "/boilers/");
  assert.ok(
    by["/"].links.includes(at) && by["/blog/radiators/"].links.includes(at) && !by["/blog/costs/"].links.includes(at),
    "each page's links, as places in the list",
  );

  const google = join(dir, "google.json"),
    ideas = join(dir, "ideas", "keyword-ideas.json");
  writeFileSync(google, JSON.stringify(GOOGLE));
  const { stdout } = await node([
    join(SCRIPTS, "keyword-ideas.mjs"),
    "--google",
    google,
    "--crawl",
    out,
    "--out",
    ideas,
  ]);
  const r = JSON.parse(readFileSync(ideas, "utf8"));
  assert.deepEqual(
    r.linkIdeas,
    [
      { page: "/boilers/", query: "boiler repairs", impressions: 500, clicks: 40, position: 4, from: ["/blog/costs/"] },
      { page: "/boilers/", query: "boiler price", impressions: 300, clicks: 3, position: 6, from: ["/blog/costs/"] },
    ],
    "the home page and /blog/radiators/ already link to it; the noindex page isn't a source; brand, low and spaceless searches are skipped",
  );
  assert.deepEqual(
    r.queryGaps,
    [
      { page: "/boilers/", query: "boiler price", impressions: 300, clicks: 3, position: 6, missing: ["price"] },
      {
        page: "/boilers/",
        query: "radiator bleeding",
        impressions: 50,
        clicks: 0,
        position: 9,
        missing: ["radiator", "bleeding"],
      },
    ],
    "“boiler repairs” is on the page; /blog/costs/ holds its search's words",
  );
  assert.ok(
    r.notes.some(n => /1 page with Search Console queries isn't among the crawl's indexable pages/.test(n)),
    "/gone/ wasn't crawled: said, not guessed",
  );
  const md = readFileSync(join(dir, "ideas", "keyword-ideas.md"), "utf8");
  assert.match(md, /## Internal link ideas[\s\S]*\| \/boilers\/ \| boiler repairs \|[\s\S]*\/blog\/costs\//);
  assert.match(
    md,
    /## Searches a page doesn't mention[\s\S]*\| \/boilers\/ \| radiator bleeding \|[\s\S]*radiator, bleeding/,
  );
  assert.match(md, /our own/i, "the limits are labelled as ours");
  assert.match(stdout, /2 internal link ideas, 2 searches a page doesn't mention/);
});

// ---------- keywordIdeas on given page words ----------
const PW = { file: "seo-crawl.words.json", stamp: 7, pages: 0 };
const pw = (path, words, links = [], more = {}) => ({ path, words, links, ...more });

test("up to 3 pages each, those holding every word first; the page itself, pages already linking and spaceless pages handled", () => {
  const words = {
    stamp: 7,
    pages: [
      pw("/x/", "heat pump grants"),
      pw("/a/", "heat pump noise"),
      pw("/b/", "heat pumps grant scheme"),
      pw("/c/", "pump grants heat"),
      pw("/d/", "heat grants"),
      pw("/e/", "heat pump grants", [0]),
      pw("/f/", "heat pump grant"),
      pw("/g/", "garden"),
      pw("/jp/", "boiler", [], { nospace: true }),
    ],
  };
  const crawl = { pages: [], pageWords: PW };
  const r = keywordIdeas({
    search: search({
      "/x/": [q("heat pump grants", 90, 12), q("solar panels", 60, 14)],
      "/jp/": [q("boiler cost", 40, 8)],
    }),
    crawl,
    words,
  });
  assert.deepEqual(
    r.linkIdeas.map(i => [i.page, i.query, i.from]),
    [["/x/", "heat pump grants", ["/b/", "/c/", "/f/"]]],
    "pages holding all 3 words first, then those missing one (3+ words allow one); never /x/ itself; /e/ already links to /x/; 3 at most",
  );
  assert.deepEqual(
    r.queryGaps.map(i => [i.page, i.query, i.missing]),
    [["/x/", "solar panels", ["solar", "panels"]]],
    "a page mostly in a script written without spaces gets no gap claimed",
  );
});

test("not checked, with the reason, when the data isn't there; never a finding", () => {
  const words = { stamp: 7, pages: [pw("/x/", "boiler")] },
    pq = search({ "/x/": [q("boiler cost", 90, 12)] });
  const cases = [
    [
      {
        search: { ...pq, pageQueries: {}, queries: [q("boiler cost", 90, 12)] },
        crawl: { pages: [], pageWords: PW },
        words,
      },
      /no per-page queries/,
    ],
    [{ search: pq }, /no --crawl/],
    [{ search: pq, crawl: { pages: [] } }, /older crawler/],
    [
      { search: pq, crawl: { pages: [], pageWords: PW }, words: { stamp: 8, pages: [] } },
      /missing or from another crawl/,
    ],
    [{ search: pq, crawl: { pages: [], pageWords: PW }, words: null }, /missing or from another crawl/],
  ];
  for (const [input, why] of cases) {
    const r = keywordIdeas(input);
    assert.equal(r.linkIdeas, null, String(why));
    assert.equal(r.queryGaps, null, String(why));
    assert.ok(
      r.notes.some(n => /weren't checked/.test(n) && why.test(n)),
      String(why),
    );
    assert.equal(r.findings, undefined);
  }
  assert.match(ideasMarkdown(keywordIdeas(cases[1][0])), /## Internal link ideas\n\n[^\n]+\n\nNot checked/);
});

test("the lists stop at 50, most impressions first, with a note", () => {
  const pages = [pw("/x/", ""), ...Array.from({ length: 60 }, (_, i) => pw(`/s${i}/`, `topic${i} guide`))];
  const r = keywordIdeas({
    search: search({ "/x/": Array.from({ length: 60 }, (_, i) => q(`topic${i} guide`, 100 + i, 9)) }),
    crawl: { pages: [], pageWords: PW },
    words: { stamp: 7, pages },
  });
  assert.equal(r.linkIdeas.length, 50);
  assert.equal(r.queryGaps.length, 50);
  assert.equal(r.linkIdeas[0].query, "topic59 guide");
  assert.ok(
    r.notes.some(n =>
      /Internal link ideas: only the 50 with the most impressions are listed, and there are more/.test(n),
    ),
  );
  assert.ok(r.notes.some(n => /Searches a page doesn't mention: only the first 50 of 60/.test(n)));
});

test("keyword-ideas.md escapes searches and paths in both new tables", () => {
  const words = {
    stamp: 7,
    pages: [pw(`/x_${EVIL}/`, "nothing"), pw("/a|b/", "boiler deal javascript alert 1 img src onerror pipe")],
  };
  const r = keywordIdeas({
    search: search({ [`/x_${EVIL}/`]: [q(`best *boiler* [deal](javascript:alert(1)) ${EVIL} | pipe`, 90, 30)] }),
    crawl: { pages: [], pageWords: PW },
    words,
  });
  assert.equal(r.linkIdeas.length, 1);
  assert.equal(r.queryGaps.length, 1);
  const md = ideasMarkdown(r);
  assert.ok(!/(^|[^\\])[<[]/m.test(md), "every < and [ is backslash-escaped");
  assert.ok(md.includes("/a\\|b/") && md.includes("/x\\_"), "paths escaped");
});

// ---------- the report ----------
const render = async edit => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SCRIPTS, "..", "examples", "sample-audit.json"), "utf8"));
  edit(data);
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};

test("the report shows both lists, escaped, from the audit's linkIdeas and queryGaps; nothing without them", async () => {
  const { html, md } = await render(d => {
    d.linkIdeas = [
      {
        page: "/boilers/",
        query: `boiler ${EVIL}`,
        impressions: 500,
        clicks: 40,
        position: 4,
        from: ["/blog/costs/", `/a/${EVIL}`],
      },
      ...Array.from({ length: 11 }, (_, i) => ({
        page: `/p${i}/`,
        query: `topic ${i}`,
        impressions: 100 - i,
        clicks: 0,
        position: 9,
        from: ["/s/"],
      })),
      { page: "/bad/", query: "no sources", impressions: 5, from: [] },
      "junk",
    ];
    d.queryGaps = [
      { page: `/x/${EVIL}`, query: "boiler price", impressions: 300, clicks: 3, position: 6, missing: ["price"] },
      { page: "/malformed-gap/", query: 7, impressions: 1, missing: ["a"] },
    ];
  });
  const links = html.match(/<details class="how linkideas">[\s\S]*?<\/details>/)?.[0],
    gaps = html.match(/<details class="how querygaps">[\s\S]*?<\/details>/)?.[0];
  assert.ok(links && gaps, "two collapsed sections on the Overview");
  assert.match(links, /<summary>Internal link ideas<\/summary>/);
  assert.match(gaps, /<summary>Searches a page doesn(’|'|&#39;)t mention<\/summary>/);
  assert.ok(
    !html.includes(EVIL) && html.includes("&lt;img src=x onerror=alert(1)&gt;"),
    "Search Console and crawl text escaped",
  );
  assert.match(links, /500 impressions/);
  assert.equal((links.match(/<li>/g) || []).length, 10, "10 at most on the page");
  assert.match(links, /2 more in <code>seo-audit\/keyword-ideas\.md<\/code>/);
  assert.ok(!links.includes("no sources") && !html.includes("/malformed-gap/"), "malformed rows dropped");
  assert.match(gaps, /price/);
  assert.match(gaps, /Chen and Koudas/);
  assert.match(gaps, /information only/i);
  assert.match(md, /## Internal link ideas/);
  assert.match(md, /## Searches a page doesn't mention/);
  assert.ok(
    md.includes("boiler \\<img src=x onerror=alert(1)\\>") && md.includes("`/a/<img src=x onerror=alert(1)>`"),
    "in the Markdown, searches are escaped and paths sit in code spans",
  );
  assert.match(md, /`\/p10\/`/, "the Markdown lists them all");

  const none = await render(() => {});
  assert.ok(
    !/class="how (linkideas|querygaps)"/.test(none.html) && !/Internal link ideas/.test(none.md),
    "no data, no section",
  );
});
