// The report renderer, and the parts of the page render step that need no Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const SAMPLE = join(SKILL, "examples", "sample-audit.json");

test("the report renders the score, the unlock line and the owner labels, fully offline", async () => {
  const out = join(tmp(), "seo-audit.html");
  await node([join(SCRIPTS, "render-report.mjs"), SAMPLE, "--out", out]);
  const html = readFileSync(out, "utf8");

  assert.match(html, /<title>SEO report · Example Security \(sample data\)<\/title>/);
  assert.match(html, /<span class="n">49<\/span>/, "two open blockers cap the score at 49");
  assert.match(html, /score rises to/, "the panel shows what fixing the blockers unlocks");
  assert.match(html, /class="to [^"]*">90</, "fixing both blockers takes the sample to 90");
  assert.match(html, /Needs you/, "owner-only findings are labelled");
  assert.match(html, /class="theme-btn"/, "theme switch");
  assert.match(html, /@font-face\{font-family:"Geist"/, "fonts are embedded, not fetched");
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href="https?:/i, "no external scripts, styles or fonts");

  const md = readFileSync(out.replace(/\.html$/, ".md"), "utf8");
  assert.match(md, /Fix the 2 blockers and the score rises to 90\/100/);
  assert.match(md, /## Findings/);
});

const renderWithPlan = async plan => {
  const dir = tmp();
  const data = JSON.parse(readFileSync(SAMPLE, "utf8"));
  if (plan) data.plan = plan;
  else delete data.plan;
  writeFileSync(join(dir, "audit.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "audit.json"), "--out", join(dir, "audit.html")]);
  return { html: readFileSync(join(dir, "audit.html"), "utf8"), md: readFileSync(join(dir, "audit.md"), "utf8") };
};
const twoRows = [
  { url: "/", type: "Home", status: "to-build" },
  { url: "/pricing", type: "Pricing page", status: "to-create", parent: "/" },
];

test("a proposed plan opens the report on the Plan tab, first in the tab row", async () => {
  const { html, md } = await renderWithPlan({ status: "proposed", pages: twoRows });
  assert.match(html, /role="tablist"[^>]*><button[^>]*id="t-plan"/, "Plan is the first tab");
  assert.match(html, /id="t-plan"[^>]*aria-selected="true"/);
  assert.match(html, /id="p-overview"[^>]*hidden/);
  assert.match(html, /var DEFAULT_TAB='plan'/);
  assert.match(md, /^## SEO plan$/m);
});

test("an approved or built plan keeps Overview first, with Plan next to it", async () => {
  const { html } = await renderWithPlan({ status: "built", pages: twoRows });
  assert.match(
    html,
    /role="tablist"[^>]*><button[^>]*id="t-overview"[^>]*aria-selected="true"[^>]*>.*?<\/button><button[^>]*id="t-plan"/,
  );
  assert.match(html, /id="p-plan"[^>]*hidden/);
});

test("a report without a plan has no Plan tab and no plan styles", async () => {
  const { html, md } = await renderWithPlan(null);
  assert.doesNotMatch(html, /id="t-plan"|\.plan-counts\{|\.prow>summary/);
  assert.doesNotMatch(md, /## SEO plan/);
});

test("the plan filter and the findings filter each control only their own buttons", async () => {
  const { html } = await renderWithPlan({ status: "built", pages: twoRows });
  assert.match(html, /querySelectorAll\('\.segb\[data-sev\]'\)/);
  assert.match(html, /querySelectorAll\('\.segb\[data-pstatus\]'\)/);
});

test("the live demo shows a built plan on a Plan tab next to Overview", () => {
  const demo = readFileSync(join(ROOT, "docs", "index.html"), "utf8");
  assert.match(demo, /id="t-overview"[^>]*aria-selected="true"[^>]*>.*?<\/button><button[^>]*id="t-plan"/);
  assert.match(demo, /Already right/);
});

test("the live demo and the bundled sample are up to date (run `npm run demo` after changing the renderer)", async () => {
  const dir = tmp();
  // docs/index.html is rendered without the Markdown twin; the bundled sample comes with sample-report.md.
  await node([join(SCRIPTS, "render-report.mjs"), SAMPLE, "--out", join(dir, "index.html"), "--no-md"]);
  await node([join(SCRIPTS, "render-report.mjs"), SAMPLE, "--out", join(dir, "sample-report.html")]);
  const pairs = [
    [join(ROOT, "docs", "index.html"), join(dir, "index.html")],
    [join(SKILL, "examples", "sample-report.html"), join(dir, "sample-report.html")],
    [join(SKILL, "examples", "sample-report.md"), join(dir, "sample-report.md")],
  ];
  for (const [committed, fresh] of pairs) {
    assert.ok(existsSync(committed), `${committed} exists`);
    assert.equal(readFileSync(committed, "utf8"), readFileSync(fresh, "utf8"), `${committed} matches a fresh render`);
  }
});

test("printing opens every plan row so the planned titles and drafts are on paper", async () => {
  const { html } = await renderWithPlan({ status: "proposed", pages: twoRows });
  assert.match(html, /addEventListener\('beforeprint',function\(\)\{[^}]*\.prow[^}]*open=true/);
});

const renderAuthority = async (authority, attribution) => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(SAMPLE, "utf8"));
  data.authority = authority;
  if (attribution) data.attribution = attribution;
  else delete data.attribution;
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};
const AHREFS_LINK = /<a href="https:\/\/ahrefs\.com\/"[^>]*>Domain Rating by Ahrefs<\/a>/;

test("authority scores show on the Overview, with Ahrefs' required credit next to its numbers", async () => {
  const { html, md } = await renderAuthority(
    [
      { domain: "security.example", openPageRank: 3.62, ahrefsDR: 21 },
      { domain: "rival.example", openPageRank: 5.1, ahrefsDR: 40 },
    ],
    { text: "Domain Rating by Ahrefs", url: "https://ahrefs.com/" },
  );
  assert.match(
    html,
    /Authority: Open PageRank 3\.6 · Domain Rating 21; rival\.example: Open PageRank 5\.1 · Domain Rating 40/,
    "each rival's scores are labelled",
  );
  assert.match(html, AHREFS_LINK);
  assert.match(md, /\[Domain Rating by Ahrefs\]\(https:\/\/ahrefs\.com\/\)/);
});

test("the Ahrefs credit shows whenever a Domain Rating does, even without the attribution field", async () => {
  const { html, md } = await renderAuthority([
    { domain: "security.example", openPageRank: null, ahrefsDR: null },
    { domain: "rival.example", openPageRank: null, ahrefsDR: 40 },
  ]);
  assert.match(html, /Authority: rival\.example: Domain Rating 40/);
  assert.match(html, AHREFS_LINK);
  assert.match(md, /\[Domain Rating by Ahrefs\]\(https:\/\/ahrefs\.com\/\)/);
});

test("the authority line is hidden when every score is empty, and Open PageRank alone needs no Ahrefs credit", async () => {
  const empty = await renderAuthority([
    { domain: "security.example", openPageRank: null, ahrefsDR: null },
    { domain: "rival.example", openPageRank: null, ahrefsDR: null },
  ]);
  assert.doesNotMatch(empty.html + empty.md, /Authority:/);
  const opr = await renderAuthority(
    [
      { domain: "security.example", openPageRank: 3.62, ahrefsDR: null },
      { domain: "rival.example", openPageRank: null, ahrefsDR: null },
    ],
    { text: "Domain Rating by Ahrefs", url: "https://ahrefs.com/" },
  );
  assert.match(opr.html, /Authority: Open PageRank 3\.6</, "a rival without scores is left out");
  assert.doesNotMatch(opr.html, AHREFS_LINK);
});

const renderEdited = async edit => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(SAMPLE, "utf8"));
  edit(data);
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};
const BING = () => ({
  siteUrl: "https://security.example/",
  period: { from: "2026-05-18", to: "2026-11-15" },
  queries: [],
  crawlIssues: [],
  traffic: { "/tools/mx-lookup/": { clicks: 14, impressions: 600 }, "/": { clicks: 1226, impressions: 29500 } },
  backlinks: {
    // 12 linked pages out of order: the list shows the 10 with the most links, most first.
    pages: [5, 12, 1, 9, 3, 11, 7, 2, 10, 4, 8, 6].map(n => ({
      url: `https://security.example/p${n}/`,
      count: n * 10,
    })),
    sample: [
      { url: "https://blog.example/post", anchorText: "<img src=x onerror=alert(1)>" },
      ...[2, 3, 4, 5, 6].map(n => ({ url: `https://ref${n}.example/`, anchorText: `ref ${n}` })),
    ],
  },
});
const GA = () => ({ "/tools/mx-lookup/": { sessions: 340, engaged: 200 }, "/": { sessions: 4980, engaged: 3000 } });
const ALL3 =
  "Search Console: 120 clicks · 9,800 impressions · Bing: 14 clicks · 600 impressions · Google Analytics: 340 organic visits (last 3 months)";
// The lines under finding F-002 in the Markdown, up to the next heading.
const f002 = md => md.split("\n### F-002 ")[1].split("\n### ")[0];

test("a finding's traffic line combines Search Console, Bing and Google Analytics, in the HTML and the Markdown", async () => {
  const { html, md } = await renderEdited(d => {
    d.bing = BING();
    d.analytics = GA();
  });
  assert.ok(
    html.includes(`<p class="quiet">${ALL3} on <code>/tools/mx-lookup/</code></p>`),
    "one line on the finding card",
  );
  assert.ok(
    f002(md).includes(`\n${ALL3} on \`/tools/mx-lookup/\`\n`),
    "the same line under the finding in the Markdown",
  );
});

test("a plan row's Search traffic field shows every source for that page", async () => {
  const { html } = await renderEdited(d => {
    d.bing = BING();
    d.analytics = GA();
  });
  assert.ok(
    html.includes(
      "<dt>Search traffic</dt><dd>Search Console: 1,840 clicks · 52,300 impressions · Bing: 1,226 clicks · 29,500 impressions · Google Analytics: 4,980 organic visits (last 3 months)</dd>",
    ),
  );
});

test("Search Console traffic alone keeps its line on the finding card and shows in the Markdown too", async () => {
  const { html, md } = await renderEdited(() => {});
  assert.ok(
    html.includes(
      `<p class="quiet">Search Console: 120 clicks · 9,800 impressions (last 3 months) on <code>/tools/mx-lookup/</code></p>`,
    ),
  );
  assert.ok(
    f002(md).includes("\nSearch Console: 120 clicks · 9,800 impressions (last 3 months) on `/tools/mx-lookup/`\n"),
  );
});

test("the Overview shows Bing and Google Analytics totals only when that data exists", async () => {
  const bingLine =
    "Bing (2026-05-18 to 2026-11-15): 1,240 clicks · 30,100 impressions · 12 pages have links from other sites";
  const gaLine = "Google Analytics: 5,320 organic visits to 2 landing pages (last 3 months)";
  const both = await renderEdited(d => {
    d.bing = BING();
    d.analytics = GA();
  });
  for (const s of [both.html, both.md]) {
    assert.ok(s.includes(bingLine), "Bing line");
    assert.ok(s.includes(gaLine), "Analytics line");
  }
  const gaOnly = await renderEdited(d => {
    d.analytics = GA();
  });
  assert.ok(gaOnly.html.includes(gaLine));
  assert.doesNotMatch(gaOnly.html + gaOnly.md, /Bing|Links from other sites/);
  const bingOnly = await renderEdited(d => {
    d.bing = BING();
  });
  assert.ok(bingOnly.md.includes(bingLine));
  assert.doesNotMatch(bingOnly.html + bingOnly.md, /Google Analytics/);
});

test("the links list shows Bing's 10 most-linked pages and 5 sample links, escaped", async () => {
  const { html, md } = await renderEdited(d => {
    d.bing = BING();
  });
  const det = html.match(/<details class="how links">[\s\S]*?<\/details>/)?.[0];
  assert.ok(det, "a collapsed details");
  assert.ok(
    html.indexOf(det) > html.indexOf('id="p-overview"') && html.indexOf(det) < html.indexOf('id="p-findings"'),
    "on the Overview",
  );
  assert.deepEqual(
    [...det.matchAll(/security\.example\/p(\d+)\//g)].map(m => Number(m[1])),
    [12, 11, 10, 9, 8, 7, 6, 5, 4, 3],
    "top 10 by links, most first",
  );
  assert.ok(det.includes("<li><b><code>https://security.example/p12/</code></b><span>120 links</span></li>"));
  assert.ok(
    det.includes("blog.example/post") && det.includes("ref5.example") && !det.includes("ref6.example"),
    "the first 5 sample links",
  );
  assert.ok(det.includes("&lt;img src=x onerror=alert(1)&gt;"), "anchor text is escaped");
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(md, /^## Links from other sites \(Bing\)$/m);
  assert.match(md, /^- `https:\/\/security\.example\/p12\/` 120 links$/m);
  assert.doesNotMatch(md, /example\/p[12]\/`/, "the Markdown lists the top 10 too");
  assert.ok(md.includes("\\<img src=x onerror=alert(1)\\>"), "the Markdown escapes the anchor text");
  assert.doesNotMatch(md, /(^|[^\\])<img src=x/m);
});

test("a report without Search Console, Bing or Analytics data has no traffic or search lines, and empty data renders the same as none", async () => {
  const strip = d => {
    delete d.traffic;
    delete d.trafficPeriod;
  };
  const none = await renderEdited(strip);
  const empty = await renderEdited(d => {
    strip(d);
    d.analytics = {};
    d.bing = {
      siteUrl: "https://security.example/",
      period: null,
      traffic: {},
      queries: [],
      backlinks: { pages: [], sample: [] },
      crawlIssues: null,
    };
  });
  assert.equal(empty.html, none.html);
  assert.equal(empty.md, none.md);
  assert.doesNotMatch(none.html + none.md, /Search Console:|Bing|Google Analytics|Links from other sites/);
  assert.match(none.html, /<\/ol>\n    <\/section>\n    <\/div>\n  <\/div>/, "nothing added after the score factors");
  assert.doesNotMatch(none.md, /\n\n\n/, "no empty lines");
  assert.doesNotMatch(none.html, /<p class="quiet"><\/p>/);
});
