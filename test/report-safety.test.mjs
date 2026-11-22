// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL, tmp } from "./helpers.mjs";
import { render } from "../skills/seo-supervisor/scripts/render-report.mjs";
import { summaryOf } from "../skills/seo-supervisor/scripts/dashboard.mjs";
import { SCORE_HOW } from "../skills/seo-supervisor/scripts/report/overview.mjs";

const KITCHEN = JSON.parse(readFileSync(join(ROOT, "test", "golden", "kitchen-sink.json"), "utf8"));
const SAMPLE = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
const copy = x => JSON.parse(JSON.stringify(x));
/** @param {any} raw @param {string | null} [mdFile] */
const rend = (raw, mdFile = "r.md") => render(copy(raw), { dir: tmp(), mdFile });

// Runs fn with the machine's time zone set to each zone in turn (Node applies a new TZ at once).
function inZones(zones, fn) {
  const was = process.env.TZ;
  try {
    for (const tz of zones) {
      process.env.TZ = tz;
      fn(tz);
    }
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

test("dates are the same day west and east of UTC, in the report and the dashboard", () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "seo-audit.json"),
    JSON.stringify({ site: { name: "S" }, run: { date: "2026-11-17" }, findings: [] }),
  );
  const audit = {
    site: { name: "S", url: "https://s.example" },
    run: { date: "2026-11-17" },
    findings: [],
    passed: [{ rule: "R-1", category: "Other" }],
    diff: { since: "2026-10-01", regressions: [], improvements: [], changed: [], added: [], removed: [] },
    changeCheck: { changeDate: "2026-09-03", days: 28, clicks: { verdict: "inconclusive" } },
  };
  inZones(["America/Los_Angeles", "Asia/Karachi", "UTC"], tz => {
    const { html, md } = rend(audit);
    assert.match(html, /<span>17 Nov 2026<\/span>/, `${tz}: the header's date`);
    assert.match(html, / · 17 Nov 2026<\/span><\/div><\/footer>/, `${tz}: the footer's date`);
    assert.match(html, /Compared with the crawl of 1 Oct 2026\./, `${tz}: since last audit`);
    assert.match(html, /changed on 3 Sept? 2026/, `${tz}: the change check's day`);
    assert.match(md ?? "", /· 17 Nov 2026/, `${tz}: the Markdown's date`);
    // A crawl's own time is UTC, and a time written with its offset keeps its own day.
    assert.match(
      rend({
        tool: "seo-supervisor-crawler",
        siteOrigin: "https://s.example",
        crawledAt: "2026-11-20T02:00:00.000Z",
        findings: [],
      }).html,
      /<span>20 Nov 2026<\/span>/,
      `${tz}: a crawl's time`,
    );
    assert.match(
      rend({ ...audit, run: { date: "2026-11-20T23:30:00-08:00" } }).html,
      /<span>20 Nov 2026<\/span>/,
      `${tz}: a time with an offset`,
    );
    assert.equal(summaryOf(dir).date, "17 Nov 2026", `${tz}: the dashboard`);
  });
});

test('"How this score works" is written once: the page and the Markdown say the same words', () => {
  const { html, md } = rend(SAMPLE);
  assert.match(SCORE_HOW, /^Every checked rule is worth 10 points\..* not Google's: .*search engines don't use it\.$/);
  assert.ok(html.includes(`<summary>How this score works</summary>\n        <p>${SCORE_HOW}</p>`));
  assert.ok(md?.includes(`## How the score works\n\n${SCORE_HOW}\n`));
});

test("each failed Lighthouse audit is listed once, and odd runs in the file are skipped, not fatal", () => {
  const audit = {
    site: { name: "S", url: "https://s.example" },
    findings: [],
    passed: [{ rule: "R-1", category: "Other" }],
    lighthouse: [
      null,
      "x",
      { url: 5 },
      { scores: {} },
      {
        url: "https://s.example/",
        passed: 40,
        scores: { performance: 70, accessibility: 81 },
        detail: [
          { title: "Image elements lack alt-zz", category: "Accessibility", items: ["img.hero"] },
          { title: "Cut render-blocking-zz", category: "Performance", items: ["/app.css"] },
          "junk",
        ],
      },
      {
        url: "https://s.example/about/",
        detail: [{ title: "Buttons lack names-zz", category: "Accessibility", items: [] }],
      },
    ],
  };
  const { html, md } = rend(audit);
  for (const t of ["Image elements lack alt-zz", "Buttons lack names-zz", "Cut render-blocking-zz"]) {
    assert.equal(html.split(t).length - 1, 1, `${t}: once on the page`);
    assert.equal((md ?? "").split(t).length - 1, 1, `${t}: once in the Markdown`);
  }
  const details = html.slice(
    html.indexOf('class="how lhdetail"'),
    html.indexOf('class="how', html.indexOf('class="how lhdetail"') + 1),
  );
  assert.match(details, /The accessibility ones are under Lighthouse(&#39;|')s accessibility checks/);
  assert.doesNotMatch(
    details,
    /\/about\//,
    "a page whose only failed audits are accessibility ones isn't in Lighthouse details",
  );
  assert.match(html, /<code>\/<\/code> · 1 failed audit</, "the count leaves the accessibility audit out");
  assert.match(html, /Lighthouse \(mobile, home page\): Performance 70/);
  assert.match(html, /passed 40 audits, failed 2/, "the speed details still count every failed audit");
});

test("one bad URL in the audit file can't stop the report, and the Markdown's title escapes the site name", () => {
  const audit = {
    site: { name: "Shop [x](javascript:alert(1)) <b>*", url: "https://s.example" },
    findings: [],
    passed: [{ rule: "R-1", category: "Other" }],
    labSpeed: [null, { url: "not a url", lcp: 3100, tbt: 250 }],
    speed: { lcpBreakdown: { source: "lab", url: "http://[bad", ttfb: 2400, loadDelay: 100 } },
    lighthouse: [{ url: "::nope::", scores: { performance: 50 } }],
  };
  const { html, md } = rend(audit);
  assert.match(html, /Lab speed, slow mobile \(indicative\): LCP 3\.1 s · TBT 250 ms on not a url/);
  assert.match(html, /LCP breakdown \(lab test, http:\/\/\[bad\): most of the time goes on the server&#39;s response/);
  assert.match(html, /Lighthouse \(mobile, ::nope::\): Performance 50/);
  assert.match(md ?? "", /^# SEO report: Shop \\\[x\\\]\(javascript:alert\(1\)\) \\<b\\>\\\*$/m);
  const crawl = rend({
    tool: "seo-supervisor-crawler",
    siteOrigin: "no origin",
    crawledAt: "2026-11-20T02:00:00Z",
    findings: [],
  });
  assert.match(crawl.html, /<h1>no origin<\/h1>/, "a crawl file with a bad origin is named by it");
});

test("the page's styles have no dead .as.b3-t,.as.b4-t rule", () => {
  const { html } = rend(KITCHEN);
  assert.doesNotMatch(html, /\.as\.b[34]-t/);
  assert.match(html, /\.as\{font:600 16px var\(--mono\);text-align:right\}/, "the .as rule itself stays");
});
