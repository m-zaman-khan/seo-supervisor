import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import {
  titleWidth,
  widthText,
  obsoleteMore,
  brandTail,
  templatedDescs,
  templatedShare,
  sectionOf,
  keywordUse,
  isGuide,
  newestDate,
  claimsIn,
  invisibleChar,
} from "../skills/seo-supervisor/scripts/checks/content.mjs";

const DAY = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);

test("titles in Chinese, Japanese and Korean count double, Thai marks count nothing", () => {
  assert.equal(titleWidth("Boiler repair in Leeds"), 22);
  assert.equal(titleWidth("東京の配管修理サービス"), 22, "11 full-width characters");
  assert.equal(titleWidth("서울 배관 수리"), 14, "Hangul is full-width, the spaces aren't");
  assert.equal(titleWidth("สวัสดี"), 4, "two of the six Thai code points are marks on a letter");
  assert.equal(widthText("Boiler repair"), "13 chars", "Latin titles read as before");
  assert.equal(widthText("東京の配管"), "5 characters, about as wide as 10 Latin ones");
});

test("the 11 other obsolete tags are found, not in scripts, comments or custom elements", () => {
  assert.deepEqual(
    obsoleteMore(
      "<p><tt>code</tt> <STRIKE>old</STRIKE> <big>x</big><acronym title=a>A</acronym><applet code=x></applet><basefont size=3><bgsound src=a><dir><li>x</dir><isindex><nobr>y</nobr><spacer type=block></p>",
    ),
    ["tt", "strike", "big", "acronym", "applet", "basefont", "bgsound", "dir", "isindex", "nobr", "spacer"],
  );
  assert.deepEqual(
    obsoleteMore(
      `<script>"<tt>"</script><!-- <strike> --><big-card></big-card><dialog></dialog><bigger>x</bigger><b>bold</b><s>sale</s><abbr>A</abbr><object><param name=a></object>`,
    ),
    [],
    "a normal page stays quiet",
  );
});

test("a description that ends with the title's brand tail", () => {
  assert.equal(
    brandTail(
      "Boiler repair in Leeds | Northwind",
      "Same-day boiler repair across Leeds with fixed prices. | Northwind",
    ),
    "Northwind",
  );
  assert.equal(
    brandTail("Boiler repair - Northwind Plumbing", "Same-day boiler repair across Leeds - northwind plumbing."),
    "Northwind Plumbing",
  );
  assert.equal(
    brandTail("Boiler repair in Leeds | Northwind", "Same-day boiler repair across Leeds from Northwind."),
    null,
    "the brand in a sentence is fine",
  );
  assert.equal(
    brandTail("Well-known boiler brands", "We fit well-known boiler brands - all of them."),
    null,
    "no tail without a spaced separator",
  );
  assert.equal(brandTail("Boiler repair in Leeds", "Same-day boiler repair | Leeds"), null);
});

const d = (url, desc, title) => ({ url, desc, title });
test("stock calls to action, more of them, and an ending shared across pages", () => {
  const cta = templatedDescs([
    d("/a", "Plumbers in Leeds for leaks and boilers. Call us today."),
    d("/b", "Plumbers in York for leaks and boilers. Book now!"),
    d("/c", "Plumbers in Hull for leaks and boilers. Discover more…"),
  ]);
  assert.deepEqual(
    cta.map(h => h[1]),
    ["ends with “Call us today.”", "ends with “Book now!”", "ends with “Discover more…”"],
  );
  const shared = templatedDescs([
    d("/a", "Copper pipes cut to length. Free delivery on every UK order."),
    d("/b", "Brass taps for old sinks. Free delivery on every UK order."),
    d("/c", "Radiator valves in six finishes. Free delivery on every UK order!"),
    d("/d", "Boiler parts for most makes and models in stock."),
  ]);
  assert.deepEqual(
    shared.map(h => h[0]),
    ["/a", "/b", "/c"],
  );
  assert.match(shared[0][1], /ends with “Free delivery on every UK order\.”, like 2 other/);
  assert.deepEqual(
    templatedDescs([d("/a", "Plumbers in Leeds. Learn more"), d("/b", "Plumbers in York. Learn more")]),
    [],
    "fewer than 3 is left alone",
  );
  assert.deepEqual(
    templatedDescs([
      d("/a", "Same text. Learn more"),
      d("/b", "Same text. Learn more"),
      d("/c", "Same text. Learn more"),
    ]),
    [],
    "one description used on many pages is desc-dup's, not this check's",
  );
  assert.deepEqual(
    templatedDescs(
      [
        d("/a", "How to winterize your RV", "How to winterize your RV"),
        d("/b", "How to store your boat", "How to store your boat"),
        d("/c", "How to clean a camper roof", "How to clean a camper roof"),
      ],
      { titleRepeat: true },
    ).length,
    3,
  );
  // Specific descriptions, some two sentences long, one ending with a phrase that only looks like a call to action.
  const normal = [
    d(
      "/",
      "Northwind fixes boilers, leaks and blocked drains across Leeds. We answer the phone in under a minute and give a price first.",
    ),
    d(
      "/boilers/",
      "Same-day boiler repair in Leeds for gas and oil boilers. Every repair comes with a 12-month guarantee on parts.",
    ),
    d(
      "/drains/",
      "Blocked drains cleared with a jetter and a camera survey. Read more about how we keep the mess outside your home.",
    ),
    d("/about/", "Founded in 2009 by two gas engineers. Now a team of nine who still pick up the phone."),
  ];
  assert.deepEqual(templatedDescs(normal), []);
});

test("the share of templated descriptions, with a site-wide or cluster verdict", () => {
  assert.equal(sectionOf("https://x.example/locations/leeds/"), "/locations/");
  assert.equal(sectionOf("https://x.example/about/"), "", "a top-level page is in no section");
  const pages = [
    "/locations/leeds/",
    "/locations/york/",
    "/locations/hull/",
    "/locations/bath/",
    "/",
    "/about/",
    "/blog/a/",
    "/blog/b/",
  ].map(u => ({ url: u, section: sectionOf(u) }));
  const cluster = templatedShare(pages, ["/locations/leeds/", "/locations/york/", "/locations/hull/"]);
  assert.deepEqual(cluster, {
    pages: 8,
    templated: 3,
    share: 0.38,
    clusters: [{ section: "/locations/", pages: 4, templated: 3 }],
    outsideClusters: 0,
    verdict: "cluster",
  });
  const flat = ["/a/", "/b/", "/c/", "/d/", "/e/"].map(u => ({ url: u, section: sectionOf(u) }));
  assert.equal(templatedShare(flat, ["/a/", "/b/", "/c/"]).verdict, "site-wide", "3 of 5 top-level pages");
  assert.equal(
    templatedShare([...flat, ...["/f/", "/g/", "/h/"].map(u => ({ url: u, section: "" }))], ["/a/", "/b/", "/c/"])
      .verdict,
    "scattered",
    "3 of 8, in no section",
  );
  assert.equal(templatedShare(flat, []).verdict, "none");
});

const filler = n =>
  Array.from(
    { length: n },
    (_, i) => `Our engineers carry common parts on the van, so most jobs finish on the first visit number ${i}.`,
  ).join(" ");
test("keyword use is missing, natural, repetitive or forced", () => {
  const h = (level, text) => ({ level, text });
  const natural = keywordUse({
    title: "Boiler repair in Leeds | Northwind",
    headings: [h(1, "Boiler repair in Leeds"), h(2, "Prices"), h(2, "Boiler repair guarantee")],
    description: "Same-day boiler repair in Leeds.",
    text: `Boiler repair in Leeds, done the same day. ${filler(12)} We also do boiler repair on Sundays.`,
  });
  // 2 uses × 2 words in 231 words.
  assert.deepEqual(natural, {
    phrase: "boiler repair",
    verdict: "natural",
    density: 1.7,
    spots: ["title", "H1", "first paragraph", "H2", "description"],
  });
  const missing = keywordUse({ title: "Boiler repair in Leeds", headings: [h(1, "Welcome")], text: filler(14) });
  assert.equal(missing.verdict, "missing");
  const repetitive = keywordUse({
    title: "Boiler repair in Leeds",
    headings: [h(1, "Boiler repair")],
    text: `${"Boiler repair is what we do. ".repeat(4)}${filler(10)}`,
  });
  assert.equal(repetitive.verdict, "repetitive", String(repetitive.density));
  const forced = keywordUse({
    title: "Cheap boiler repair Leeds",
    headings: [
      h(1, "Cheap boiler repair Leeds"),
      h(2, "Cheap boiler repair Leeds prices"),
      h(2, "Why cheap boiler repair Leeds"),
      h(2, "Cheap boiler repair Leeds near me"),
    ],
    text: `Cheap boiler repair Leeds. ${filler(12)}`,
  });
  assert.equal(forced.verdict, "forced", "the exact phrase in most subheadings");
  assert.equal(
    keywordUse({ title: "Boiler repair", headings: [], text: "Boiler repair in Leeds. Short page." }),
    null,
    "under 150 words is too little to judge",
  );
  assert.equal(
    keywordUse({ title: "Northwind", headings: [], text: filler(14) }),
    null,
    "a one-word title has no phrase",
  );
});

test("guides and their newest date", () => {
  assert.ok(isGuide("https://x.example/guides/bleed-radiator/", "Bleeding radiators", []));
  assert.ok(isGuide("https://x.example/blog/x/", "How to bleed a radiator", []));
  assert.ok(isGuide("https://x.example/x/", "Radiators", ["HowTo"]));
  assert.ok(!isGuide("https://x.example/services/boilers/", "Boiler repair in Leeds", ["Service"]));
  const now = Date.parse("2026-11-21");
  assert.deepEqual(
    newestDate(`<main><p>Last updated: 12 March 2019</p><p>Published March 3, 2018</p></main>`, [], now),
    { time: Date.UTC(2019, 2, 12), date: "2019-03-12", from: "a visible date" },
  );
  assert.equal(
    newestDate(
      `<p>Updated&nbsp;on Aug 2025</p>`,
      [{ "@type": "Article", datePublished: "2020-01-01", dateModified: "2024-05-01T10:00:00Z" }],
      now,
    ).date,
    "2025-08-01",
  );
  assert.equal(
    newestDate(`<time datetime="2026-10-02">2 Oct</time>`, [{ "@type": "Article", dateModified: "2021-01-01" }], now)
      .from,
    "<time>",
  );
  assert.equal(
    newestDate(`<p>Founded in 2009. We moved in March 2015.</p>`, [], now),
    null,
    "dates not marked as updated or published don't count",
  );
  assert.equal(newestDate(`<p>Updated 1 January 2099</p>`, [], now), null, "a date in the future is ignored");
});

test("claims, each with its kind; ordinary text stays quiet", () => {
  const kinds = t => claimsIn(t).map(c => c.kind);
  assert.deepEqual(kinds("By 2030, electric cars will make up half of new sales."), ["dated claim"]);
  assert.deepEqual(kinds("Since 2015, the number of home chargers has tripled."), ["dated claim"]);
  assert.deepEqual(kinds("The market is worth $3.2 billion."), ["big number"]);
  assert.deepEqual(kinds("Over 150,000 teams use it."), ["big number"]);
  assert.deepEqual(kinds("Our app grew 40% last year."), ["percentage"]);
  assert.deepEqual(kinds("It cuts your bill by up to 30%."), ["percentage"]);
  assert.deepEqual(kinds("Pages load 40% faster."), ["percentage"]);
  assert.deepEqual(kinds("Builds run 3x faster than before."), ["multiplier"]);
  assert.deepEqual(kinds("A Gartner study found that most teams overspend."), ["named source"]);
  assert.deepEqual(kinds("Recent McKinsey research shows the same."), ["named source"]);
  assert.deepEqual(kinds("73% of drivers call twice. Studies show it."), ["statistic", "study"]);
  const ordinary =
    "Founded in 2009, we fix boilers across Leeds. By 2027 we will open a second shop. Save 20% on your first booking, or get 10% off in March. " +
    "We're 100% local and open 24/7. Our team of 12 answers within 2 hours. Prices start at $49.99, and a new boiler is about £2,400. " +
    "The study found nothing new. This report covers our first year. We use 4x4 vans. Take it three times a day. Call 0113 496 0000.";
  assert.deepEqual(claimsIn(ordinary), []);
});

test("the source must sit near its claim; [^1], Via: and links count, a far one doesn't", () => {
  const src = t => claimsIn(t).map(c => c.sourced);
  assert.deepEqual(src("73% of drivers call twice.[^1]"), [true]);
  assert.deepEqual(src("73% of drivers call twice. Via: RAC survey, 2024."), [true]);
  assert.deepEqual(src("73% of drivers call twice ([source](https://rac.example/report))."), [true]);
  assert.deepEqual(src("According to the RAC, 73% of drivers call twice."), [true]);
  assert.deepEqual(
    src("73% of drivers call twice. We fix cars. We fix vans. Source: RAC."),
    [false],
    "two sentences away isn't near",
  );
  assert.deepEqual(
    src("According to Gartner, a Gartner study found most teams overspend."),
    [false],
    "a named authority needs a link, not just its name",
  );
  assert.deepEqual(src("A Gartner study found most teams overspend [1]."), [true]);
  assert.deepEqual(
    src("By 2030, EVs will make up half of sales. Home charging grew 40% last year [1]."),
    [false, true],
    "the next sentence's footnote is its own",
  );
  assert.match(claimsIn("Intro text. Pages load 40% faster with it.")[0].claim, /^Pages load 40% faster with it\.$/);
});

// content-scan.mjs on a list of records; exitCode is the script's own.
async function scan(recs, extra = []) {
  const dir = tmp(),
    out = join(dir, "scan.json");
  writeFileSync(join(dir, "c.json"), JSON.stringify(recs));
  const r = await node([
    join(SCRIPTS, "content-scan.mjs"),
    "--in",
    join(dir, "c.json"),
    "--id",
    "slug",
    "--url",
    "/{slug}/",
    "--title",
    "title",
    "--desc",
    "description",
    "--out",
    out,
    ...extra,
  ]).catch(e => e);
  return { ...JSON.parse(readFileSync(out, "utf8")), exitCode: r.code ?? 0 };
}
const by = (s, check) => s.findings.find(f => f.check === check);
const today = iso(Date.now());
// Ordinary records: specific copy, a founding year, a discount, prices, a fresh date. None of these checks may fire.
const NORMAL = [
  {
    slug: "boilers",
    title: "Boiler repair in Leeds",
    description:
      "Same-day boiler repair in Leeds for gas and oil boilers. Every repair comes with a 12-month guarantee on parts and labour, and a fixed price.",
    body: "Founded in 2009, we fix boilers across Leeds. Save 20% on your first service. Prices start at £79, and most repairs take under 2 hours.",
    updatedAt: today,
  },
  {
    slug: "drains",
    title: "Blocked drains cleared in Leeds",
    description:
      "Blocked drains cleared with a jetter and a camera survey. We show you the footage and explain the fix before any digging starts at all.",
    body: "We clear sinks, toilets and outside drains. By 2027 we will open a second depot in York. Our vans carry a jetter and a camera.",
    updatedAt: today,
  },
  {
    slug: "about",
    title: "東京の配管修理サービス",
    description:
      "Two gas engineers started Northwind, and a team of nine still picks up the phone. Read about who we are, where we work and how we price jobs.",
    body: "שלום‏ world, and Northwind's 👩‍💻 team says hello.",
    updatedAt: today,
  },
];

test("content-scan: ordinary records stay quiet on every one of these checks", async () => {
  const s = await scan(NORMAL, ["--fail-on", "unsourced-stat,stale-data"]);
  assert.deepEqual(
    s.findings.map(f => f.check),
    [],
  );
  assert.equal(s.exitCode, 0);
  assert.deepEqual(s.claims, []);
  assert.deepEqual(s.stats.claims, { total: 0, unsourced: 0 });
});

test("every claim is listed, each item gives its share without a source, and --fail-on stops CI", async () => {
  const recs = [
    ...NORMAL,
    {
      slug: "evs",
      title: "Electric car charging guide",
      body: "By 2030, electric cars will make up half of new sales. A Gartner study found most fleets overspend.\n\n40% of drivers charge at home [1].",
    },
    {
      slug: "cited",
      title: "Home charging costs",
      body: "Home charging grew 40% last year.",
      citation: "https://iea.example/report",
    },
  ];
  const s = await scan(recs);
  const f = by(s, "unsourced-stat");
  assert.equal(f.count, 1);
  assert.equal(f.rule, "CONTENT-10");
  assert.equal(f.evidence[0].url, "/evs/");
  assert.match(
    f.evidence[0].detail,
    /^2 of 3 claims have no source nearby \(67%\): “By 2030, electric cars will make up half of new sales\.” \(dated claim\); “A Gartner study found most fleets overspend\.” \(named source\)$/,
  );
  assert.deepEqual(
    s.claims.map(c => [c.url, c.kind, c.sourced]),
    [
      ["/evs/", "dated claim", false],
      ["/evs/", "named source", false],
      ["/evs/", "statistic", true],
      ["/cited/", "percentage", true],
    ],
    "schema citation counts for the whole item",
  );
  assert.deepEqual(s.stats.claims, { total: 4, unsourced: 2 });
  assert.equal(s.exitCode, 0, "without --fail-on the scan only reports");
  assert.equal(
    (await scan(recs, ["--fail-on", "unsourced-stat"])).exitCode,
    1,
    "any unsourced claim fails, with no share cut-off",
  );
});

test("CJK titles, shared endings with their share, hidden bidi controls, stale data and missing values", async () => {
  const product = (slug, what, group) => ({
    slug,
    group,
    title: `${what} for older homes`,
    description: `${what} in brass and chrome, cut and tested in our Leeds workshop before they ship. Free delivery on every UK order.`,
    body: `${what}.`,
    updatedAt: "2019-01-01",
  });
  const recs = [
    ...NORMAL.map(r => ({ ...r, group: "page" })),
    product("taps", "Kitchen taps", "shop"),
    product("valves", "Radiator valves", "shop"),
    product("pipes", "Copper pipes", "shop"),
    {
      slug: "rlo",
      group: "page",
      title: "Trojan text in a product name",
      body: "Totally safe‮ txt.exe",
      updatedAt: today,
    },
    {
      slug: "long-cjk",
      group: "page",
      title: "東京都内の配管修理と水漏れ対応サービスを年中無休でご提供します安心の定額料金",
      updatedAt: today,
    },
  ];
  const s = await scan(recs, ["--group", "group"]);
  assert.deepEqual(
    by(s, "title-length").evidence.map(e => e.url),
    ["/long-cjk/"],
    "a short CJK title isn't short, a long one is long",
  );
  assert.match(by(s, "title-length").evidence[0].detail, /^38 characters, about as wide as 76 Latin ones/);
  assert.deepEqual(
    by(s, "templated-desc").evidence.map(e => e.url),
    ["/taps/", "/valves/", "/pipes/"],
  );
  assert.deepEqual(s.stats.templatedDescriptions, {
    pages: 6,
    templated: 3,
    share: 0.5,
    clusters: [{ section: "shop", pages: 3, templated: 3 }],
    outsideClusters: 0,
    verdict: "cluster",
  });
  assert.match(
    by(s, "invisible-unicode").evidence[0].detail,
    /^U\+202E \(right-to-left override\) in “.*Totally safe⟨here⟩ txt\.exe/,
  );
  assert.equal(by(s, "invisible-unicode").count, 1, "the right-to-left mark in Hebrew text isn't counted");
  assert.deepEqual(
    by(s, "stale-data").evidence.map(e => e.url),
    ["/taps/", "/valves/", "/pipes/"],
  );
  assert.equal(by(s, "stale-data").rule, "CONTENT-07");
  assert.match(by(s, "stale-data").evidence[0].detail, /^updatedAt: 2019-01-01/);
  assert.equal(s.stats.records, 8);
  assert.deepEqual(s.stats.fields.description, { filled: 6, missing: 2 });
  assert.deepEqual(s.stats.fields.slug, { filled: 8, missing: 0 });
  assert.ok(
    s.notes.some(n => /Missing values: description 2 of 8/.test(n)),
    s.notes.join("\n"),
  );
  assert.equal(
    by(await scan(recs, ["--group", "group", "--max-age", "100"]), "stale-data"),
    undefined,
    "--max-age sets the window in months",
  );
});

// ---------- the crawler ----------
const FILL = [
  "Our engineers carry common parts on the van, so most jobs finish on the first visit.",
  "We tidy up after every job and take the old parts away with us.",
  "You get a written price before we start, and it doesn't change unless you ask for more work.",
  "Most people find us through a neighbour or a friend.",
  "We work on weekdays from eight until six, and on Saturday mornings.",
  "Every engineer carries an ID card and shows it at the door.",
].join(" ");
const fill = n => `<p>${Array(n).fill(FILL).join(" ")}</p>`;
const longDate = t =>
  new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const PAGES = {
  "/": [
    "en",
    "Northwind Plumbing | Northwind",
    "Northwind fixes boilers, leaks and blocked drains across Leeds, answers the phone in under a minute and gives a fixed price before any work starts.",
    `<h1>Northwind Plumbing</h1><p>Northwind fixes boilers, leaks and blocked drains across Leeds. We answer the phone in under a minute and give a fixed price before any work starts.</p>${fill(2)}`,
  ],
  "/boiler-repair/": [
    "en",
    "Boiler repair in Leeds | Northwind",
    "Same-day boiler repair in Leeds for gas and oil boilers, with a fixed price before we start and a 12-month guarantee on parts and labour.",
    `<h1>Boiler repair in Leeds</h1><p>Boiler repair in Leeds, done the same day for gas and oil boilers. We give a fixed price before we start, and every repair has a 12-month guarantee on parts and labour.</p>${fill(4)}<h2>What a boiler repair costs</h2><p>Most jobs cost a fixed fee plus parts, and we tell you both first.</p>`,
  ],
  "/guides/bleed-radiator/": [
    "en",
    "How to bleed a radiator | Northwind",
    "How to bleed a radiator in five steps, from turning the heating off to checking the boiler pressure once the air is out of the system.",
    `<h1>How to bleed a radiator</h1><p>Updated ${iso(Date.now() - 30 * DAY)}</p><p>To bleed a radiator, turn the heating off, open the valve with a radiator key, let the air out, close it and check the boiler pressure.</p>${fill(2)}`,
    `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"How to bleed a radiator","datePublished":"2018-01-01","dateModified":"${iso(Date.now() - 30 * DAY)}"}</script>`,
  ],
  "/guides/winter-boiler/": [
    "en",
    "Winter boiler guide | Northwind",
    "Keeping a boiler running through winter: pressure checks, frozen condensate pipes and what to do when the heating stops on a cold morning.",
    `<h1>Winter boiler guide</h1><p>Last updated: ${longDate(Date.now() - 900 * DAY)}</p><p>Keeping a boiler running through winter means pressure checks, thawing frozen condensate pipes and knowing what to do when the heating stops on a cold morning.</p>${fill(2)}`,
  ],
  "/gas-safety/": [
    "en",
    "Gas safety checks | Northwind",
    "Luxury bathroom renovations with marble tiles, freestanding tubs and underfloor warmth designed by award-winning interior architects.",
    `<h1>Gas safety checks</h1><p>A gas safety check tests every gas appliance, pipe and flue in the home, and you get a certificate the same day.</p>${fill(1)}`,
  ],
  "/leak-detection/": [
    "en",
    "Leak detection | Northwind",
    "We find hidden leaks behind walls and under floors with thermal cameras and acoustic sensors, without lifting a single floor tile. | Northwind",
    `<h1>Leak detection</h1><p>We find hidden leaks behind walls and under floors with thermal cameras and acoustic sensors, without lifting a single floor tile.</p>${fill(1)}`,
  ],
  "/history/": [
    "en",
    "Our history | Northwind",
    "Two gas engineers started Northwind in a rented garage, and the team of nine still answers the phone, prices jobs and turns up on time.",
    `<h1>Our history</h1><p>Two gas engineers started Northwind in a <tt>rented garage</tt>, and the team of nine still answers the phone, prices jobs and turns up on <strike>Mondays</strike> time.</p>${fill(1)}`,
  ],
  "/stuffed/": [
    "en",
    "Cheap boiler repair Leeds | Northwind",
    "Cheap boiler repair in Leeds from engineers who carry common parts on the van, so most jobs finish on the first visit at a written price.",
    `<h1>Cheap boiler repair Leeds</h1>${fill(1)}<h2>Cheap boiler repair Leeds prices</h2>${fill(1)}<h2>Why choose cheap boiler repair Leeds</h2>${fill(1)}<h2>Cheap boiler repair Leeds near me</h2>${fill(1)}`,
  ],
  "/zh/": ["zh", "北京管道维修服务中心", "", `<h1>北京管道维修服务中心</h1><p>我们提供管道维修服务。</p>`],
  "/zh-long/": [
    "zh",
    "北京市朝阳区专业管道维修与水管漏水检测服务中心全年无休随叫随到价格公道",
    "",
    `<h1>北京管道维修</h1><p>我们提供管道维修服务。</p>`,
  ],
  ...Object.fromEntries(
    ["Leeds", "York", "Hull"].map(t => [
      `/areas/${t.toLowerCase()}/`,
      [
        "en",
        `Plumbers in ${t} | Northwind`,
        `Plumbers in ${t} for leaks, boilers and blocked drains, with a fixed price before any work starts and engineers on call. Call us today.`,
        `<h1>Plumbers in ${t}</h1><p>Plumbers in ${t} for leaks, boilers and blocked drains, with a fixed price before any work starts and engineers on call.</p>${fill(1)}`,
      ],
    ]),
  ),
};
const NORMAL_PAGES = ["/", "/boiler-repair/", "/guides/bleed-radiator/", "/zh/"];
let contentRun;
function contentSite() {
  return (contentRun ||= (async () => {
    const dir = tmp(),
      out = join(tmp(), "crawl.json");
    const links = Object.keys(PAGES)
      .map(p => `<a href="${p}">${p}</a>`)
      .join(" ");
    for (const [p, [lang, title, desc, body, head = ""]] of Object.entries(PAGES)) {
      mkdirSync(join(dir, p), { recursive: true });
      writeFileSync(
        join(dir, p, "index.html"),
        `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${desc ? `<meta name="description" content="${desc}">` : ""}${head}</head><body><main>${body}</main><footer>${links}</footer></body></html>`,
      );
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
  })());
}
const at = (r, check) => (r.findings.find(f => f.check === check)?.evidence || []).map(e => new URL(e.url).pathname);

test("crawler: ordinary pages stay quiet on every one of these checks", async () => {
  const r = await contentSite();
  for (const check of [
    "desc-mismatch",
    "desc-brand-tail",
    "templated-desc",
    "stale-guide",
    "obsolete-tags",
    "title-short",
    "title-long",
  ])
    for (const p of NORMAL_PAGES) assert.ok(!at(r, check).includes(p), `${check} on ${p}`);
  assert.ok(
    !r.keywordUse.pages.some(k => new URL(k.url).pathname === "/boiler-repair/"),
    "natural keyword use isn't listed",
  );
});

test("crawler: mismatched and brand-tailed descriptions, CJK titles, stock endings, obsolete tags and stale guides", async () => {
  const r = await contentSite();
  assert.deepEqual(at(r, "desc-mismatch"), ["/gas-safety/"]);
  assert.match(
    r.findings.find(f => f.check === "desc-mismatch").evidence[0].detail,
    /: 0 of 14 main words are on the page$/,
  );
  assert.deepEqual(at(r, "desc-brand-tail"), ["/leak-detection/"]);
  assert.ok(at(r, "title-long").includes("/zh-long/"), "35 CJK characters are as wide as 70 Latin ones");
  assert.match(
    r.findings.find(f => f.check === "title-long").evidence.find(e => e.url.endsWith("/zh-long/")).detail,
    /^35 characters, about as wide as 70 Latin ones: /,
  );
  assert.ok(!at(r, "title-short").includes("/zh/"), "10 CJK characters aren't short");
  assert.deepEqual(at(r, "templated-desc").sort(), ["/areas/hull/", "/areas/leeds/", "/areas/york/"]);
  assert.equal(r.findings.find(f => f.check === "templated-desc").rule, "META-02");
  assert.deepEqual(r.templatedDescriptions, {
    pages: 11,
    templated: 3,
    share: 0.27,
    clusters: [{ section: "/areas/", pages: 3, templated: 3 }],
    outsideClusters: 0,
    verdict: "cluster",
  });
  assert.deepEqual(
    r.findings.find(f => f.check === "obsolete-tags").evidence.map(e => [new URL(e.url).pathname, e.detail]),
    [["/history/", "<tt>, <strike>"]],
  );
  assert.deepEqual(at(r, "stale-guide"), ["/guides/winter-boiler/"]);
  const stale = r.findings.find(f => f.check === "stale-guide");
  assert.equal(stale.rule, "CONTENT-07");
  assert.match(stale.evidence[0].detail, /^newest date \d{4}-\d{2}-\d{2}, from a visible date$/);
});

test("crawler: keyword use per English page, information only", async () => {
  const r = await contentSite();
  const stuffed = r.keywordUse.pages.find(k => new URL(k.url).pathname === "/stuffed/");
  assert.equal(stuffed.verdict, "forced");
  assert.equal(stuffed.phrase, "cheap boiler repair");
  assert.deepEqual(
    r.keywordUse.counts,
    { natural: 4, missing: 0, repetitive: 0, forced: 1 },
    "the 5 English pages with 150+ words of main text",
  );
  assert.ok(!r.findings.some(f => /keyword/i.test(f.check)), "never a finding");
});

const render = async data => {
  const dir = tmp();
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};

test("report: the templated share with its verdict and keyword use show in one panel that never changes the score", async () => {
  const r = await contentSite(),
    evil = "<img src=x onerror=alert(1)>";
  const data = {
    ...r,
    keywordUse: {
      counts: { ...r.keywordUse.counts, missing: 1 },
      pages: [
        ...r.keywordUse.pages,
        { url: `https://site.example/${evil}`, phrase: evil, verdict: "missing", density: 0, spots: [] },
        { url: "/x", phrase: "bad", verdict: evil },
      ],
    },
  };
  const withInfo = await render(data),
    without = await render({ ...r, templatedDescriptions: undefined, keywordUse: undefined });
  const panel = withInfo.html.match(/\n {4}<details class="how content">[\s\S]*?<\/details>/)?.[0] || "";
  assert.ok(panel, "a Descriptions and keyword use panel");
  assert.equal(
    withInfo.html.replace(panel, ""),
    without.html,
    "the panel is the only change: the score and areas are the same",
  );
  assert.match(panel, /3 of 11 descriptions \(27%\)/);
  assert.match(panel, /Verdict: a cluster\. Most are in <code>\/areas\/<\/code> \(3 of 3 pages\)/);
  assert.match(panel, /4 natural · 1 missing · 0 repetitive · 1 forced/);
  assert.match(panel, /<code>\/stuffed\/<\/code><\/b><span>“cheap boiler repair”: forced/);
  assert.match(panel, /never change the score/);
  assert.ok(
    !panel.includes("<img src=x") && panel.includes("&lt;img src=x onerror=alert(1)&gt;"),
    "crawled text is escaped",
  );
  assert.ok(!panel.includes("/x<"), "a row with an unknown verdict is dropped");
  const section = withInfo.md.match(/### Descriptions and keyword use\n[\s\S]*?\n\n(?=#{2,3} |$)/)?.[0] || "";
  assert.ok(section && withInfo.md.replace(section, "") === without.md, "the Markdown gains only its section");
  assert.match(section, /- `\/stuffed\/` “cheap boiler repair”: forced/);
  assert.ok(!/(^|[^\\])<img src=x/m.test(section) && section.includes("\\<img src=x onerror=alert(1)\\>"));
});

test("the reading-ease check for CI lists each English page with its score and fails below the pass mark", async () => {
  const dir = tmp();
  const doc = (lang, body) =>
    `<!doctype html><html lang="${lang}"><head><title>x</title></head><body><nav><p>${"Home About Contact. ".repeat(40)}</p></nav><main>${body}</main></body></html>`;
  const EASY = `<p>${"The cat sat on the mat. ".repeat(25)}</p>`; // 150 words, reading ease 100
  const HARD = `<p>${"Happy children quickly enter wooden houses. ".repeat(25)}</p>`; // reading ease 32
  for (const d of ["blog", "node_modules/x", ".cache"]) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, "index.html"), doc("en", EASY));
  writeFileSync(join(dir, "blog", "hard.html"), doc("en-GB", HARD));
  writeFileSync(join(dir, "de.html"), doc("de", HARD));
  writeFileSync(join(dir, "short.htm"), doc("en", "<p>Too short to score.</p>"));
  writeFileSync(join(dir, "node_modules", "x", "index.html"), doc("en", HARD));
  writeFileSync(join(dir, ".cache", "index.html"), doc("en", HARD));
  const run = args =>
    node([join(SCRIPTS, "checks", "writing.mjs"), ...args]).then(
      r => ({ code: 0, out: r.stdout }),
      e => ({ code: e.code, out: e.stdout, err: e.stderr }),
    );
  const fail = await run([dir]);
  assert.equal(fail.code, 1, fail.out);
  assert.match(fail.out, /SEO Supervisor's own check, not Google's/);
  assert.match(fail.out, /never changes the audit score/);
  assert.match(fail.out, /^ +100 {2}index\.html$/m);
  assert.match(fail.out, /^ +32 {2}blog\/hard\.html {2}below 60$/m);
  assert.match(fail.out, /Skipped 2 page\(s\): not English, or under 100 words\./);
  assert.match(fail.out, /1 of 2 pages scored below 60\./);
  assert.ok(
    !/node_modules|\.cache|de\.html/.test(fail.out),
    "dot folders, node_modules and skipped pages aren't listed",
  );
  const pass = await run([dir, "--min", "30"]);
  assert.equal(pass.code, 0);
  assert.match(pass.out, /All 2 pages scored 30 or more\./);
  assert.equal((await run([join(dir, "index.html")])).code, 0, "a single file");
  assert.equal((await run([dir, "--min", "abc"])).code, 2);
  assert.equal((await run([])).code, 2);
});

test("tag characters, bidi controls and other hidden characters; real scripts and emoji flags stay quiet", () => {
  const code = t => invisibleChar(t)?.code ?? null;
  assert.equal(code("Ignore\u{E0020}\u{E0061}ll"), "U+E0020");
  assert.equal(invisibleChar("Hi\u{E0041}there").name, "tag character");
  assert.equal(
    code("Flag: \u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} go"),
    null,
    "England's flag is made of tag characters",
  );
  assert.equal(code("abc‮evil"), "U+202E");
  assert.equal(invisibleChar("abc‮evil").name, "right-to-left override");
  assert.equal(code("Price‎ 10"), "U+200E");
  assert.equal(code("a⁦b⁩"), "U+2066");
  assert.equal(code("x⁢y"), "U+2062");
  assert.equal(code("nameㅤ"), "U+3164");
  assert.equal(code("a᠎b"), "U+180E");
  assert.equal(code("שלום‏ world"), null, "a right-to-left mark in Hebrew text is normal");
  assert.equal(code("مرحبا‫نص‬"), null);
  assert.equal(code("ᠮᠣᠩᠭᠣᠯ᠎ᠠ"), null, "the Mongolian vowel separator in Mongolian text");
  assert.equal(code("한국어ㅤ"), null);
  assert.equal(code("Plain English, café, naïve, 👩‍💻 and 👍🏽, “quotes” — dashes."), null);
  assert.equal(code("zero​width"), "U+200B", "the old ones still count");
});
