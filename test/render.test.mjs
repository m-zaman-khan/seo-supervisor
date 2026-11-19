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
