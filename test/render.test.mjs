// The report renderer, and the parts of the page render step that need no Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  chromeError,
  findBrowser,
  renderAll,
  renderArgs,
  renderPage,
} from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { serve } from "./serve.mjs";
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

test("a finding's title and what's-wrong text are escaped in the Markdown: Google's rich-result messages go there", async () => {
  const XSS = "<img src=x onerror=alert(1)> [x](javascript:alert(1))";
  const { md } = await renderEdited(d => {
    const f = {
      rule: "SCHEMA-08",
      severity: "high",
      category: "Structured data",
      why: "Why.",
      fix: "Fix.",
      count: 1,
      evidence: [],
      source: "search-console",
    };
    d.findings.push(
      {
        ...f,
        id: "G-001",
        status: "open",
        title: `1 rich result has errors ${XSS}`,
        what: `Found on https://security.example/a/ (Product snippets: ${XSS}).`,
      },
      { ...f, id: "G-002", status: "needs-decision", title: `Decide ${XSS}`, what: `Context ${XSS}` },
    );
  });
  assert.doesNotMatch(md, /(^|[^\\])<img src=x/m, "no raw HTML");
  assert.doesNotMatch(md, /(^|[^\\])\[x\]\(javascript:/m, "no link");
  assert.ok(
    md.includes("Product snippets: \\<img src=x onerror=alert(1)\\> \\[x\\](javascript:alert(1))"),
    "the text still reads the same",
  );
  assert.ok(md.includes("Found on `https://security.example/a/`"), "the URL becomes code");
});
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

const MATOMO = () => ({
  period: { from: "2026-08-20", to: "2026-11-16" },
  traffic: { "/tools/mx-lookup/": { visits: 31 }, "/": { visits: 5320 } },
});
const POSTHOG = () => ({
  period: { from: "2026-08-20", to: "2026-11-16" },
  traffic: { "/tools/mx-lookup/": { visits: 1 } },
});

test("a page with only Matomo data still gets its traffic line, with Matomo's dates", async () => {
  const { html, md } = await renderEdited(d => {
    delete d.traffic;
    delete d.trafficPeriod;
    d.matomo = MATOMO();
  });
  const line = "Matomo: 31 organic visits (2026-08-20 to 2026-11-16)";
  assert.ok(html.includes(`<p class="quiet">${line} on <code>/tools/mx-lookup/</code></p>`), "on the finding card");
  assert.ok(f002(md).includes(`\n${line} on \`/tools/mx-lookup/\`\n`), "under the finding in the Markdown");
  assert.ok(
    html.includes("<dt>Search traffic</dt><dd>Matomo: 5,320 organic visits (2026-08-20 to 2026-11-16)</dd>"),
    "labelled in the plan row",
  );
});

test("Matomo and PostHog join the traffic line, and get an Overview line each", async () => {
  const { html, md } = await renderEdited(d => {
    d.analytics = GA();
    d.matomo = MATOMO();
    d.posthog = POSTHOG();
  });
  const line =
    "Search Console: 120 clicks · 9,800 impressions · Google Analytics: 340 organic visits · Matomo: 31 organic visits · PostHog: 1 organic visit (last 3 months)";
  assert.ok(html.includes(`<p class="quiet">${line} on <code>/tools/mx-lookup/</code></p>`));
  for (const s of [html, md]) {
    assert.ok(s.includes("Matomo: 5,351 organic visits to 2 landing pages (2026-08-20 to 2026-11-16)"), "Matomo total");
    assert.ok(s.includes("PostHog: 1 organic visit to 1 landing page (2026-08-20 to 2026-11-16)"), "PostHog total");
  }
});

test("Matomo and PostHog data is guarded: odd values and dates are dropped, never shown raw", async () => {
  const { html, md } = await renderEdited(d => {
    delete d.traffic;
    delete d.trafficPeriod;
    d.matomo = {
      period: { from: "<img src=x onerror=alert(1)>", to: "2026-11-16" },
      traffic: { "/tools/mx-lookup/": { visits: 31 }, "/": { visits: "<b>9</b>" } },
    };
    d.posthog = { period: "soon", traffic: "not a map" };
  });
  assert.ok(
    html.includes(`<p class="quiet">Matomo: 31 organic visits on <code>/tools/mx-lookup/</code></p>`),
    "no dates when they aren't dates",
  );
  assert.ok(
    (html + md).includes("Matomo: 31 organic visits to 1 landing page"),
    "a page without a number of visits isn't counted",
  );
  assert.doesNotMatch(html + md, /<img src=x|<b>9<\/b>|PostHog/);
});

test("Matomo and PostHog device and country lines show only real counts, the top 10, and nothing when empty", async () => {
  const { html, md } = await renderEdited(d => {
    d.matomo = {
      ...MATOMO(),
      byDevice: { Desktop: { visits: 3 }, Tablet: { visits: "<b>9</b>" }, TV: { visits: -1 }, Phone: "x" },
      byCountry: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`c${i}`, { visits: i + 1 }])),
    };
    d.posthog = { period: null, byDevice: {}, byCountry: "not a map" };
  });
  const device = "Matomo organic visits by device: desktop 3 (2026-08-20 to 2026-11-16)";
  assert.ok(
    html.includes(`<p class="quiet">${device}</p>`) && md.includes(`\n${device}\n`),
    "only the device with a real count",
  );
  for (const s of [html, md]) {
    assert.ok(
      s.includes(
        "Matomo organic visits by country: C11 12 · C10 11 · C9 10 · C8 9 · C7 8 · C6 7 · C5 6 · C4 5 · C3 4 · C2 3 (2026-08-20 to 2026-11-16)",
      ),
      "the 10 with the most visits, most first",
    );
    assert.doesNotMatch(s, /PostHog organic visits|<b>9/);
  }
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
    d.matomo = { period: null, traffic: {} };
    d.posthog = null;
  });
  assert.equal(empty.html, none.html);
  assert.equal(empty.md, none.md);
  assert.doesNotMatch(
    none.html + none.md,
    /Search Console:|Bing|Google Analytics|Matomo|PostHog|Links from other sites/,
  );
  assert.match(none.html, /<\/ol>\n    <\/section>\n    <\/div>\n  <\/div>/, "nothing added after the score factors");
  assert.doesNotMatch(none.md, /\n\n\n/, "no empty lines");
  assert.doesNotMatch(none.html, /<p class="quiet"><\/p>/);
});

test("the report footer names the SEO Supervisor version that made it", async () => {
  const { VERSION } = await import("../skills/seo-supervisor/scripts/update-check.mjs");
  const out = join(tmp(), "r.html");
  await node([join(SCRIPTS, "render-report.mjs"), SAMPLE, "--out", out, "--no-md"]);
  assert.match(readFileSync(out, "utf8"), new RegExp(`Generated by SEO Supervisor ${VERSION.replace(/\./g, "\.")}`));
});

// Chrome's own failures: headless Chrome 157 prints this line and dumps nothing; older versions dump their error page.
const LOAD_FAILED =
  "[32432:32272:1119/195616.441:ERROR:components\\headless\\command_handler\\headless_command_handler.cc:403] Page load failed: net::ERR_CONNECTION_REFUSED\n";
const ERROR_PAGE = `<html dir="ltr" lang="en"><head><meta charset="utf-8"><title>127.0.0.1</title></head><body class="neterror" id="t"><div id="main-frame-error" class="interstitial-wrapper"><div id="main-content"><h1><span>This site can’t be reached</span></h1><div class="error-code" jscontent="errorCode">ERR_CONNECTION_REFUSED</div></div></div></body></html>`;

test("the render step knows Chrome's own error page and a failed load from the site's page", () => {
  assert.equal(chromeError("", LOAD_FAILED), "net::ERR_CONNECTION_REFUSED");
  assert.equal(chromeError(ERROR_PAGE), "ERR_CONNECTION_REFUSED");
  assert.equal(
    chromeError(
      `<html><head><link rel="stylesheet" href="chrome-error://chromewebdata/x.css"></head><body></body></html>`,
    ),
    "Chrome's error page",
  );
  assert.equal(chromeError(" \n"), "an empty page");
  // A real page about these errors is still the site's page, and other Chrome log lines aren't a failed load.
  assert.equal(
    chromeError(
      `<html><head><title>Fix net::ERR_CONNECTION_REFUSED</title></head><body><h1>What chrome-error://chromewebdata/ means</h1><p>Chrome's page has id="main-frame-error" and class="neterror" on &lt;body&gt;.</p></body></html>`,
      "[1119/195616.441:ERROR:gpu_init.cc(523)] Passthrough is not supported\n",
    ),
    null,
  );
});

test("the render step's Chrome gets the container and proxy flags, and the URL last", () => {
  const P = "http://proxy.corp:8080",
    url = "https://example.com/";
  const args = renderArgs("/tmp/p", url, {
    platform: "linux",
    uid: 0,
    env: { HTTP_PROXY: P, HTTPS_PROXY: P },
    exists: () => false,
  });
  for (const f of [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--proxy-server=${P}`,
    "--user-data-dir=/tmp/p",
    "--dump-dom",
  ])
    assert.ok(args.includes(f), f);
  assert.equal(args.at(-1), url);
  assert.deepEqual(
    renderArgs("/tmp/p", url, { platform: "darwin", env: {} }).filter(a => /sandbox|shm|proxy/.test(a)),
    [],
    "none on an ordinary machine with no proxy",
  );
});

const browser = findBrowser();
test(
  "Chrome failing to load a page is an error from the render step, not an empty page",
  { skip: !browser && "Chrome not installed", timeout: 60000 },
  async t => {
    const closed = createServer();
    await new Promise(ok => closed.listen(0, "127.0.0.1", ok));
    const port = closed.address().port;
    await new Promise(ok => closed.close(ok));
    try {
      await renderPage(browser, `http://127.0.0.1:${port}/`);
      assert.fail("the render resolved");
    } catch (e) {
      if (/sandbox/i.test(`${e.message} ${e.stderr || ""}`)) return t.skip("Chrome sandbox unavailable here");
      assert.match(e.message, /Chrome couldn't load http:\/\/127\.0\.0\.1:\d+\/: net::ERR_CONNECTION_REFUSED/);
    }
  },
);

test(
  "a page Chrome can't load isn't reported as JavaScript changing its title: it's left out, with the reason",
  { skip: !browser && "Chrome not installed", timeout: 180000 },
  async () => {
    const dir = tmp(),
      out = join(tmp(), "crawl.json");
    const page = (title, link) =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>Boiler repairs and servicing across Leeds, with a written estimate first.</p>${link}</main></body></html>`;
    for (const [p, html] of Object.entries({
      "/": page("Boiler Repairs in Leeds", '<a href="/about/">About us</a>'),
      "/about/": page("About Our Leeds Engineers", ""),
    })) {
      mkdirSync(join(dir, p), { recursive: true });
      writeFileSync(join(dir, p, "index.html"), html);
    }
    // The server hangs up on headless Chrome, as a bot blocker might; the crawler itself gets the pages.
    const site = await serve(dir, {
      before: req => /HeadlessChrome/.test(req.headers["user-agent"] || "") && (req.socket.destroy(), true),
    });
    try {
      await node([
        join(SCRIPTS, "seo-crawl.mjs"),
        "--url",
        site.url,
        "--site-origin",
        "https://site.example",
        "--outside",
        "--psi-endpoint",
        "http://127.0.0.1:9/runPagespeed",
        "--out",
        out,
      ]);
    } finally {
      await site.close();
    }
    const r = JSON.parse(readFileSync(out, "utf8"));
    assert.ok(
      !r.findings.some(f => f.check.startsWith("render-")),
      JSON.stringify(r.findings.filter(f => f.check.startsWith("render-")).map(f => f.evidence)),
    );
    assert.ok(!r.passed.some(p => p.rule === "REND-06"));
    assert.match(r.notChecked.find(n => n.rule === "REND-06")?.reason || "", /Chrome couldn't load .*net::ERR_/);
  },
);

test(
  "--render all renders every indexable page up to the cap, after the estimate",
  { skip: !browser && "Chrome not installed", timeout: 300000 },
  async () => {
    const o = "https://example.com",
      logged = [];
    const cut = renderAll([`${o}/a/`, `${o}/b/`, `${o}/`, `${o}/c/`], { max: 3, log: m => logged.push(m) });
    assert.deepEqual(cut.urls, [`${o}/`, `${o}/a/`, `${o}/b/`]);
    assert.deepEqual(logged, [
      "Rendering 3 pages in the browser, about 1 minute (roughly 5 seconds a page), one at a time.",
    ]);
    assert.match(cut.note, /stopped at 3 pages.*1 more page/);
    assert.equal(renderAll([`${o}/`]).note, null, "no cut under 200 pages");

    // By default the crawler renders the sample, one page per top-level folder; --render all, every page meant to rank.
    const dir = tmp();
    const page = (title, extra = "") =>
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${extra}</head><body><main><h1>${title}</h1><p>Boiler repairs and servicing across Leeds, with a written estimate first.</p><a href="/a/1/">One</a> <a href="/a/2/">Two</a> <a href="/a/3/">Three</a> <a href="/a/hidden/">Hidden</a></main></body></html>`;
    const pages = {
      "/": page("Boiler Repairs in Leeds"),
      "/a/1/": page("Boiler Servicing in Leeds"),
      "/a/2/": page("Boiler Installation in Leeds"),
      "/a/3/": page("Gas Safety Checks in Leeds"),
      "/a/hidden/": page("Hidden Page for Staff", '<meta name="robots" content="noindex">'),
    };
    for (const [p, html] of Object.entries(pages)) {
      mkdirSync(join(dir, p), { recursive: true });
      writeFileSync(join(dir, p, "index.html"), html);
    }
    const crawlRendering = async (...extra) => {
      const rendered = new Set(),
        out = join(tmp(), "crawl.json");
      // --dump-dom loads pages with headless Chrome's own user agent; the phone and desktop loads set their own.
      const site = await serve(dir, {
        before: req => {
          if (/HeadlessChrome/.test(req.headers["user-agent"] || "") && req.url.endsWith("/")) rendered.add(req.url);
          return false;
        },
      });
      let stdout;
      try {
        ({ stdout } = await node([
          join(SCRIPTS, "seo-crawl.mjs"),
          "--url",
          site.url,
          "--site-origin",
          "https://site.example",
          "--outside",
          "--psi-endpoint",
          "http://127.0.0.1:9/runPagespeed",
          "--out",
          out,
          ...extra,
        ]));
      } finally {
        await site.close();
      }
      return { rendered: [...rendered].sort(), stdout, r: JSON.parse(readFileSync(out, "utf8")) };
    };
    const sample = await crawlRendering();
    assert.equal(sample.rendered.length, 2, sample.rendered.join(" "));
    assert.equal(sample.rendered[0], "/");
    assert.doesNotMatch(sample.stdout, /Rendering \d+ page/);
    const all = await crawlRendering("--render", "all");
    assert.deepEqual(all.rendered, ["/", "/a/1/", "/a/2/", "/a/3/"], "every page meant to rank, not the noindex one");
    assert.match(all.stdout, /Rendering 4 pages in the browser, about 1 minute/);
    assert.ok(
      all.r.notes.some(n => /^Rendered 4 of 4 page\(s\)/.test(n)),
      all.r.notes.join("\n"),
    );
    assert.ok(all.r.passed.some(p => p.rule === "REND-06"));
  },
);

test("without --outside, --render all doesn't render and says why", async () => {
  const site = await serve(join(ROOT, "test", "fixture-zero")),
    out = join(tmp(), "crawl.json");
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--out", out, "--render=all"]);
  } finally {
    await site.close();
  }
  const r = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(
    r.notes.some(n => /^--render all runs only with outside checks on \(--outside\)/.test(n)),
    r.notes.join("\n"),
  );
  assert.ok(!r.passed.some(p => p.rule === "REND-06"));
});
