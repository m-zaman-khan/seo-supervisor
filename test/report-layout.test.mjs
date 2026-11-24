// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL, SCRIPTS, tmp } from "./helpers.mjs";
import { render } from "../skills/seo-supervisor/scripts/render-report.mjs";
import { buildModel } from "../skills/seo-supervisor/scripts/report/model.mjs";
import { panelHtml, panelMd, byTab } from "../skills/seo-supervisor/scripts/report/panel.mjs";
import { findingTabs } from "../skills/seo-supervisor/scripts/report/findings.mjs";
import { sitePanels } from "../skills/seo-supervisor/scripts/report/panels/site.mjs";
import { linkPanels } from "../skills/seo-supervisor/scripts/report/panels/links.mjs";
import { aiPanels } from "../skills/seo-supervisor/scripts/report/panels/ai.mjs";
import { contentPanels } from "../skills/seo-supervisor/scripts/report/panels/content.mjs";
import { speedPanels } from "../skills/seo-supervisor/scripts/report/panels/speed-media.mjs";
import { localPanels } from "../skills/seo-supervisor/scripts/report/panels/local.mjs";
import { connectionPanels } from "../skills/seo-supervisor/scripts/report/panels/connections.mjs";
import { diffParts } from "../skills/seo-supervisor/scripts/report/diff.mjs";
import {
  logsPanel,
  brandTrendPanel,
  topSearchesPanel,
  keywordIdeasPanel,
  indexVerdictPanel,
} from "../skills/seo-supervisor/scripts/report/panels/data-search.mjs";
import { schemaInventoryPanel } from "../skills/seo-supervisor/scripts/report/panels/data-site.mjs";

const KITCHEN = JSON.parse(readFileSync(join(ROOT, "test", "golden", "kitchen-sink.json"), "utf8"));
const SAMPLE = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
const draw = raw => render(raw, { dir: tmp(), mdFile: "seo-audit.md" });
// One tab's HTML: from its section to the next one.
const tabOf = (html, id) => {
  const i = html.indexOf(`id="p-${id}"`);
  return i < 0 ? "" : html.slice(i, html.indexOf('<section class="tp"', i + 1) >>> 0);
};
const tabIds = html => [...html.matchAll(/<button class="tab" role="tab" id="t-([\w-]+)"/g)].map(x => x[1]);
const finding = (id, severity, extra = {}) => ({
  id,
  severity,
  status: severity === "needs-decision" ? "needs-decision" : "open",
  category: "Crawling & indexing",
  rule: `R-${id}`,
  title: `Title ${id}`,
  what: "w",
  fix: "f",
  ...extra,
});

test("the Overview holds, in order: verdict and score, Fix first, Needs you, what's moving, the scope line and the key numbers, and nothing else", () => {
  const { html } = draw(KITCHEN),
    ov = tabOf(html, "overview");
  const at = [
    "Not ready: 2 blockers to fix first",
    'class="unlock"',
    'id="h-first"',
    'id="h-you"',
    'id="h-factors"',
    'class="scope"',
    'id="h-keys"',
  ].map(s => ov.indexOf(s));
  assert.ok(
    at.every(i => i > 0),
    `each part is there: ${at}`,
  );
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
    "in this order",
  );
  assert.ok(ov.indexOf('class="big') < at[0] + 2000 && ov.indexOf('class="big') > 0, "the score sits with the verdict");
  assert.doesNotMatch(
    ov,
    /<details class="how [a-z]/,
    "no collapsed panel (How this score works has no class of its own)",
  );
  assert.doesNotMatch(
    ov,
    /Real-user speed|Lighthouse \(mobile|Authority:|Search clicks:|Score views|Google ranking updates/,
  );
  assert.match(
    ov,
    /class="scope">Checked 1,240 pages against 34 rules · 3 checks couldn&#39;t run: see <a href="#p-limits">Limits<\/a>/,
  );
  for (const k of ["Pages checked", "Open issues", "Fixed this run", "Clicks from Google", "Core Web Vitals"])
    assert.ok(ov.includes(`<h3>${k}</h3>`), k);
});

test("Fix first holds at most 5 code fixes, each with its /seo-fix line; Needs you at most 3 of the owner's; none in both", () => {
  const raw = {
    site: { name: "Caps", url: "https://caps.example" },
    run: { date: "2026-11-20", pagesCrawled: 9 },
    findings: [
      ...[1, 2, 3, 4, 5, 6, 7].map(n => finding(`F-00${n}`, "high")),
      ...[8, 9].map(n => finding(`F-00${n}`, "blocker", { fixBy: "owner" })),
      finding("F-010", "needs-decision"),
      finding("F-011", "medium", { fixBy: "owner" }),
      finding("F-012", "high", { status: "wont-fix" }),
    ],
    decisions: [{ question: "Keep the old blog?" }],
    passed: [],
  };
  const { html, md } = draw(raw),
    ov = tabOf(html, "overview");
  const list = id => {
    const s = ov.slice(ov.indexOf(`id="${id}"`));
    return [...s.slice(0, s.indexOf("</section>")).matchAll(/<li><a href="#([^"]+)"/g)].map(x => x[1]);
  };
  const first = list("h-first"),
    you = list("h-you");
  assert.equal(first.length, 5, "5 at most");
  assert.ok(
    first.every(id => /^F-00[1-7]$/.test(id)),
    "only what the agent can fix in code, and never a won't-fix",
  );
  for (const id of first) assert.ok(ov.includes(`<code>/seo-fix ${id}</code>`), `${id} has its /seo-fix line`);
  assert.deepEqual(you, ["F-008", "F-009", "F-010"], "3 at most: the owner's blockers, then the decision, by severity");
  assert.ok(!first.some(id => you.includes(id)), "nothing in both");
  assert.match(ov, /<a class="link" href="#p-decisions">All 5 in Decisions/, "see all points to Decisions");
  // Decisions lists everything Needs you counts, so "see all" is true.
  const dec = tabOf(html, "decisions");
  for (const s of ["Keep the old blog?", 'href="#F-008"', 'href="#F-009"', 'href="#F-011"', "F-010"])
    assert.ok(dec.includes(s), s);
  // The Markdown has the same two lists.
  const mdList = h => {
    const s = md.slice(md.indexOf(`## ${h}\n`));
    return [...s.slice(0, s.indexOf("\n## ", 3)).matchAll(/^- \*\*(F-\d+)\*\*/gm)].map(x => x[1]);
  };
  assert.deepEqual(mdList("Fix first"), first);
  assert.deepEqual(mdList("Needs you"), you);
  assert.match(md, /^- \*\*F-001\*\* · High · Title F-001 · `\/seo-fix F-001`$/m);
});

test("a topic tab appears only when it has data; the kitchen sink fills all four", () => {
  const ks = tabIds(draw(KITCHEN).html);
  for (const t of ["search-ai", "speed", "links", "site-content"]) assert.ok(ks.includes(t), t);
  assert.deepEqual(ks, [
    "overview",
    "plan",
    "findings",
    "decisions",
    "search-ai",
    "speed",
    "links",
    "site-content",
    "diff",
    "changes",
    "passed",
    "limits",
  ]);
  const bare = tabIds(draw({ site: { name: "Bare" }, run: {}, findings: [finding("F-001", "low")], passed: [] }).html);
  assert.deepEqual(
    bare,
    ["overview", "findings", "decisions", "changes", "passed", "limits"],
    "no data, no topic tab and no note",
  );
  assert.deepEqual(
    tabIds(draw(SAMPLE).html),
    [
      "overview",
      "plan",
      "findings",
      "decisions",
      "search-ai",
      "speed",
      "site-content",
      "diff",
      "changes",
      "passed",
      "limits",
    ],
    "the sample: top pages (traffic), speed and crawl data",
  );
});

test("the check settings join Limits", () => {
  const dir = tmp();
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ checks: { off: ["title-long"] } }));
  const { html, md } = render(SAMPLE, { dir, mdFile: "seo-audit.md" });
  assert.ok(tabOf(html, "limits").includes('<details class="how checksettings">'));
  assert.ok(!tabOf(html, "overview").includes("checksettings"));
  assert.ok(md.indexOf("### Check settings") > md.indexOf("## Limits of this audit\n"));
});

// Every panel the panel modules build for this audit, as each draws itself.
function everyPanel(raw) {
  const m = { raw, mdFile: "seo-audit.md", ...buildModel(raw, tmp()) };
  const { googleUpdatesText } = { googleUpdatesText: () => "" };
  const mods = [
    sitePanels(m),
    linkPanels(m),
    aiPanels(m),
    contentPanels(m),
    speedPanels(m),
    connectionPanels(m),
    localPanels(m),
    diffParts(m, { googleUpdatesText }),
    findingTabs(m, { trafficHtml: () => "", clarityHtml: () => "" }),
  ];
  const data = [
    logsPanel,
    brandTrendPanel,
    topSearchesPanel,
    keywordIdeasPanel,
    indexVerdictPanel,
    schemaInventoryPanel,
  ].map(f => () => f(m)); // the six data panels
  const vms = [...mods.flatMap(o => Object.values(o)), ...data]
    .filter(f => typeof f === "function" && f.length === 0)
    .map(f => {
      try {
        return f();
      } catch {
        return null;
      }
    })
    .filter(p => p && typeof p === "object" && !Array.isArray(p) && "title" in p && "blocks" in p);
  return { vms, grid: localPanels(m) };
}
for (const [name, raw] of [
  ["the kitchen-sink audit", KITCHEN],
  ["the sample audit (an old audit: no tab fields)", SAMPLE],
]) {
  test(`every panel of ${name} still appears, unchanged, on the page and in the Markdown`, () => {
    const { html, md } = draw(raw),
      { vms, grid } = everyPanel(raw);
    assert.ok(vms.length >= (raw === KITCHEN ? 31 : 1), `${vms.length} panels`);
    for (const p of vms) {
      assert.ok(html.includes(panelHtml(p)), `${p.title} on the page`);
      assert.ok(md.includes(panelMd(p, "###").join("\n")), `${p.title} in the Markdown`);
    }
    if (raw === KITCHEN) {
      assert.ok(html.includes(grid.geoGridHtml()) && md.includes("### Local rank grid"), "the rank grid");
      assert.ok(
        tabOf(html, "site-content").indexOf("how local") < tabOf(html, "site-content").indexOf("how geogrid"),
        "Local business sits next to the rank grid",
      );
      assert.match(
        tabOf(html, "site-content"),
        /id="h-views">Score views<\/h2><span class="sub">Estimates, not part of the score/,
      );
      assert.match(md, /^### Score views\n\nEstimates, not part of the score\./m);
      const since = tabOf(html, "diff");
      assert.ok(
        since.includes("how timeline") && since.includes("Change check, "),
        "the audit timeline and the change check join Since last audit",
      );
      const ai = tabOf(html, "search-ai"),
        card = ai.slice(ai.indexOf("<h2>AI crawlers, agents and answers</h2>"));
      assert.ok(
        card.indexOf("how aibots") > 0 &&
          card.indexOf("how agents") > 0 &&
          card.indexOf("how aibots") < card.indexOf("</section>") &&
          card.indexOf("how agents") < card.indexOf("</section>"),
        "the two AI panels in one card",
      );
    }
  });
}

test("a panel's own tab wins, and a panel with none goes to Site & content", () => {
  const vm = (title, tab) => () => ({ title, tab, blocks: [{ p: title }] });
  const tabs = byTab([
    ["speed", "A", vm("one", "links")],
    [null, "B", vm("two")],
    ["speed", "C", vm("three")],
    ["speed", "D", () => null],
  ]);
  assert.deepEqual(Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, v.map(x => x.card)])), {
    links: ["A"],
    "site-content": ["B"],
    speed: ["C"],
  });
});

test("the Markdown follows the page: verdict, score, Fix first, Needs you, Findings, Decisions, then the data by topic", () => {
  const { md } = draw(KITCHEN);
  const at = [
    "**SEO health score: 49/100",
    "## Fix first\n",
    "## Needs you\n",
    "## Findings\n",
    "## Decisions needed\n",
    "## Search & AI\n",
    "## Speed\n",
    "## Links\n",
    "## Site & content\n",
    "## Since last audit\n",
    "## Limits of this audit\n",
  ].map(s => md.indexOf(s));
  assert.ok(
    at.every(i => i >= 0),
    `${at}`,
  );
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
  );
  assert.ok(md.indexOf("Real-user speed (mobile)") > md.indexOf("## Speed\n"), "the speed lines are under Speed");
  assert.ok(md.indexOf("Authority: ") > md.indexOf("## Links\n"), "authority under Links");
  assert.ok(
    md.indexOf("### AI agents") > md.indexOf("## Search & AI\n") &&
      md.indexOf("### AI agents") < md.indexOf("## Speed\n"),
  );
});

test("every open finding ends with its next step: the /seo-fix line, then the re-check command where there is one", () => {
  const { html, md } = draw(KITCHEN),
    m = buildModel(KITCHEN, tmp());
  for (const f of m.findings) {
    const card = html.slice(
      html.indexOf(`<article class="f `, html.indexOf(`id="${f.id}"`) - 200),
      html.indexOf("</article>", html.indexOf(`id="${f.id}"`)),
    );
    const sec = md.slice(md.indexOf(`### ${f.id} · `), md.indexOf("\n### ", md.indexOf(`### ${f.id} · `) + 3));
    const live = f.status !== "fixed" && f.status !== "wont-fix";
    assert.equal(card.includes(`<code>/seo-fix ${f.id}</code>`), live, `${f.id} card`);
    assert.equal(sec.includes(`**Next step.** \`/seo-fix ${f.id}\``), live, `${f.id} Markdown`);
    if (live && card.includes("Check the fix yourself"))
      assert.ok(card.indexOf("/seo-fix") < card.indexOf("Check the fix yourself"), `${f.id}: the re-check comes after`);
  }
  assert.match(
    html,
    /<code>\/seo-fix F-001<\/code> asks you first: the agent won&#39;t change this without your go-ahead\./,
    "an owner's finding says so",
  );
  assert.match(md, /\*\*Next step\.\*\* `\/seo-fix F-002` fixes it and checks the fix\./);
});

test("Limits shows what was produced but couldn't be shown, with why", () => {
  const m = {
    raw: SAMPLE,
    ...buildModel(SAMPLE, tmp()),
    mdFile: null,
    notShown: [{ what: "Server logs (log-scan.json)", why: "it's for another site" }],
  };
  const lim = findingTabs(m, { trafficHtml: () => "", clarityHtml: () => "" }).limitsHtml();
  assert.match(lim, /<h2>Not shown<\/h2>/);
  assert.match(lim, /<li><b>Server logs \(log-scan\.json\)<\/b><span>it&#39;s for another site<\/span><\/li>/);
});

test("the page's styles and script hold no comment (both are inlined and hashed), and the tab bar wraps rather than scrolls", () => {
  const css = readFileSync(join(SCRIPTS, "report", "styles.css"), "utf8"),
    js = readFileSync(join(SCRIPTS, "report", "client.js"), "utf8");
  assert.doesNotMatch(css, /\/\*/);
  assert.doesNotMatch(js, /\/\*|^\s*\/\//m);
  assert.match(css, /\.tabs\{display:flex;flex-wrap:wrap/);
  assert.doesNotMatch(css, /\.tabs\{[^}]*overflow-x/, "a wrapped tab bar never makes the page scroll sideways");
});
