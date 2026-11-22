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

test("the page's styles have no dead .as.b3-t,.as.b4-t rule", () => {
  const { html } = rend(KITCHEN);
  assert.doesNotMatch(html, /\.as\.b[34]-t/);
  assert.match(html, /\.as\{font:600 16px var\(--mono\);text-align:right\}/, "the .as rule itself stays");
});
