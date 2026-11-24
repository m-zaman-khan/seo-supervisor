// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, tmp } from "./helpers.mjs";
import { render } from "../skills/seo-supervisor/scripts/render-report.mjs";

const KITCHEN = JSON.parse(readFileSync(join(ROOT, "test", "golden", "kitchen-sink.json"), "utf8"));
const draw = (raw, dir = tmp()) => render(raw, { dir, mdFile: "seo-audit.md" });
const tabOf = (html, id) => {
  const i = html.indexOf(`id="p-${id}"`);
  return i < 0 ? "" : html.slice(i, html.indexOf('<section class="tp"', i + 1) >>> 0);
};
const tabIds = html => [...html.matchAll(/<button class="tab" role="tab" id="t-([\w-]+)"/g)].map(x => x[1]);
const F = (id, severity, extra = {}) => ({
  id,
  severity,
  status: "open",
  category: "Crawling & indexing",
  rule: `R-${id}`,
  title: `Title ${id}`,
  what: "w",
  fix: "f",
  ...extra,
});
const audit = extra => ({
  site: { name: "S", url: "https://example.com" },
  run: { date: "2026-11-20", pagesCrawled: 3 },
  passed: [],
  ...extra,
});
// The links of one Overview list (h-first: Fix first, h-you: Needs you), and the same list in the Markdown.
const list = (html, h) => {
  const ov = tabOf(html, "overview"),
    i = ov.indexOf(`id="${h}"`);
  if (i < 0) return [];
  const s = ov.slice(i);
  return [...s.slice(0, s.indexOf("</section>")).matchAll(/<li><a href="#([^"]+)"/g)].map(x => x[1]);
};
const mdList = (md, h) => {
  const i = md.indexOf(`## ${h}\n`);
  if (i < 0) return [];
  const s = md.slice(i);
  return [...s.slice(0, s.indexOf("\n## ", 3)).matchAll(/^- \*\*([^*]+)\*\*/gm)].map(x => x[1]);
};

test("Fix first and Needs you never share an item: a finding with an open decision is the owner's", () => {
  const raw = audit({
    findings: [F("F-001", "blocker"), F("F-002", "high"), F("F-003", "high", { fixBy: "owner" })],
    decisions: [{ id: "F-001", question: "Keep the old address for F-001?" }],
  });
  const { html, md } = draw(raw),
    first = list(html, "h-first"),
    you = list(html, "h-you");
  assert.deepEqual(first, ["F-002"], "the agent can't fix F-001 before the owner decides");
  assert.ok(you.includes("F-001") && you.includes("F-003"), `Needs you: ${you}`);
  assert.ok(!first.some(id => you.includes(id)), "nothing in both");
  assert.ok(
    !mdList(md, "Fix first").some(id => mdList(md, "Needs you").includes(id)),
    "nothing in both in the Markdown",
  );
});

test("a won't-fix finding of the owner's takes no Needs you slot", () => {
  const raw = audit({
    findings: [
      F("F-001", "blocker", { fixBy: "owner", status: "wont-fix" }),
      F("F-002", "high", { fixBy: "owner" }),
      F("F-003", "low", { fixBy: "owner" }),
      F("F-004", "medium", { fixBy: "owner" }),
    ],
  });
  const { html, md } = draw(raw);
  assert.deepEqual(list(html, "h-you"), ["F-002", "F-004", "F-003"]);
  assert.match(tabOf(html, "overview"), /All 3 in Decisions/);
  assert.ok(!tabOf(html, "decisions").includes('href="#F-001"'), "not in Your tasks either");
  assert.deepEqual(mdList(md, "Needs you"), ["F-002", "F-004", "F-003"]);
});

test("every Needs you and Decisions link lands on a tab or a finding card", () => {
  const raw = audit({
    findings: [F("F-001", "high"), F("F-002", "medium", { status: "needs-decision", severity: "needs-decision" })],
    decisions: [{ id: "D-1", question: "Keep it?" }, { question: "No id?" }],
  });
  const { html } = draw(raw),
    tabs = tabIds(html);
  const lands = h =>
    (h.startsWith("p-") && tabs.includes(h.slice(2)) && html.includes(`id="${h}"`)) ||
    new RegExp(`<article class="f [^"]*" id="${h}"`).test(html);
  const links = [...list(html, "h-you"), ...[...tabOf(html, "decisions").matchAll(/href="#([^"]+)"/g)].map(x => x[1])];
  assert.ok(links.length >= 3, `${links}`);
  for (const h of links) assert.ok(lands(h), `#${h} goes nowhere`);
  assert.ok(tabOf(html, "decisions").includes("D-1"), "the decision's id still shows");
});

test("a decision is counted once, even when the audit lists it again or a finding carries it too", () => {
  const raw = audit({
    findings: [
      F("F-001", "needs-decision", { status: "needs-decision", decision: { question: "Merge the two pages?" } }),
    ],
    decisions: [
      { id: "F-001", question: "Merge the two pages?" },
      { id: "D-2", question: "Move the blog?" },
      { id: "D-2", question: "Move the blog?" },
      { question: "No id" },
    ],
  });
  const { html, md } = draw(raw),
    dec = tabOf(html, "decisions");
  assert.equal((dec.match(/<article class="panel dcard">/g) || []).length, 3);
  assert.match(html, /id="t-decisions"[^>]*>Decisions<span class="cnt">3<\/span>/);
  const sec = md.slice(
    md.indexOf("## Decisions needed\n"),
    md.indexOf("\n## ", md.indexOf("## Decisions needed\n") + 3),
  );
  assert.equal((sec.match(/^### /gm) || []).length, 3);
});

// The Markdown heading of each tab; the Overview's parts in the page's order.
const HEAD = {
  plan: "## SEO plan\n",
  diff: "## Since last audit\n",
  findings: "## Findings\n",
  decisions: "## Decisions needed\n",
  changes: "## What was changed\n",
  passed: "## Passed checks\n",
  limits: "## Limits of this audit\n",
  "search-ai": "## Search & AI\n",
  speed: "## Speed\n",
  links: "## Links\n",
  "site-content": "## Site & content\n",
};
const OVERVIEW = [
  "**SEO health score: ",
  "## Fix first\n",
  "## Needs you\n",
  "## Area scores\n",
  "Checked 1,240 pages",
  "Open: ",
  "Clicks from Google: ",
];
test("the Markdown follows the page: the Overview's parts, then every tab, in the page's order", () => {
  for (const raw of [KITCHEN, { ...KITCHEN, plan: { ...KITCHEN.plan, status: "proposed" } }]) {
    const { html, md } = draw(raw),
      order = tabIds(html);
    assert.deepEqual(
      order.filter(id => ["findings", "decisions", "search-ai", "site-content", "diff"].includes(id)),
      ["findings", "decisions", "search-ai", "site-content", "diff"],
      "Needs you, then Findings, Decisions, then the data",
    );
    const at = order
      .flatMap(id => (id === "overview" ? OVERVIEW : [HEAD[id]]))
      .map(s => /** @type {[string, number]} */ ([s, md.indexOf(s)]));
    for (const [s, i] of at) assert.ok(i >= 0, `${JSON.stringify(s)} is in the Markdown`);
    for (let k = 1; k < at.length; k++)
      assert.ok(
        at[k - 1][1] < at[k][1],
        `${JSON.stringify(at[k - 1][0])} comes before ${JSON.stringify(at[k][0])} (${raw.plan.status})`,
      );
  }
});

// One panel, one source: google.json beside the audit, with a period the audit doesn't name.
const google = {
  site: "https://example.com",
  period: "Last 90 days",
  traffic: { "/file-page": { clicks: 70, impressions: 90 } },
  queries: [{ query: "file search", clicks: 5, impressions: 9 }],
};
const folder = files => {
  const d = tmp();
  for (const [f, j] of Object.entries(files)) writeFileSync(join(d, f), JSON.stringify(j));
  return d;
};
// One panel: from its box to the next panel's (its own folded parts hold </details> too).
const panelOf = (html, cls) => {
  const i = html.indexOf(`class="how ${cls}`);
  return i < 0 ? "" : html.slice(i, html.indexOf('<details class="how ', i + 1) >>> 0);
};
test("Top searches takes its searches, pages and period from one source", () => {
  const dir = folder({ "google.json": google });
  const mine = panelOf(
    draw(audit({ findings: [], queries: [{ query: "audit search", clicks: 1, impressions: 2 }] }), dir).html,
    "topsearches",
  );
  assert.match(mine, /audit search/);
  assert.doesNotMatch(
    mine,
    /file-page|last 90 days|google\.json/,
    "not the file's pages or period beside the audit's searches",
  );
  const theirs = panelOf(
    draw(
      audit({ findings: [], traffic: { "/audit-page": { clicks: 3, impressions: 4 } }, trafficPeriod: "Last 28 days" }),
      dir,
    ).html,
    "topsearches",
  );
  assert.match(theirs, /file search/);
  assert.match(theirs, /file-page/);
  assert.match(theirs, /last 90 days/);
  assert.doesNotMatch(theirs, /audit-page|last 28 days/, "the file's searches with the file's pages");
});

test("the brand trend's period comes from the brand split's own source", () => {
  const split = {
    branded: { clicks: 9, impressions: 20 },
    nonBranded: { clicks: 4, impressions: 30 },
    previous: { branded: { clicks: 5, impressions: 10 }, nonBranded: { clicks: 4, impressions: 30 } },
  };
  const p = panelOf(
    draw(audit({ findings: [], brandSplit: split }), folder({ "google.json": google })).html,
    "brandtrend",
  );
  assert.match(p, /This period/);
  assert.doesNotMatch(p, /Last 90 days/);
});

test("a result file with no date of its own says its date is when the file was saved", () => {
  const dir = folder({ "log-scan.json": { bots: { Googlebot: { requests: 5 } } } });
  utimesSync(join(dir, "log-scan.json"), new Date("2026-11-18T12:00:00Z"), new Date("2026-11-18T12:00:00Z"));
  const { md } = draw(audit({ findings: [] }), dir);
  assert.match(md, /From your server logs \(log-scan\.json, file saved 18 Nov 2026\)\./);
  utimesSync(join(dir, "log-scan.json"), new Date("2026-09-01T12:00:00Z"), new Date("2026-09-01T12:00:00Z"));
  assert.match(draw(audit({ findings: [] }), dir).md, /log-scan\.json\)?:\*\* .*file was saved on 1 Sept? 2026/);
});

// Claude Code fills ${CLAUDE_PLUGIN_ROOT} in a plugin command's body and in its allowed-tools Bash rules alike.
// https://code.claude.com/docs/en/plugins-reference
// A Bash rule matches the command text as written: exactly without `*`; with a trailing " *", that text alone or
// followed by a space and more. https://code.claude.com/docs/en/permissions
const matches = (rule, cmd) =>
  rule.endsWith(" *") ? cmd === rule.slice(0, -2) || cmd.startsWith(rule.slice(0, -1)) : cmd === rule;
const ROOTDIR = "/home/owner/.claude/plugins/cache/seo-supervisor/seo-supervisor/2.0.0";
test("each command names the exact path its pre-approved scripts match, and works without the plugin", () => {
  const names = readdirSync(join(ROOT, "commands")).filter(f => f.endsWith(".md"));
  assert.equal(names.length, 10);
  for (const name of names) {
    const text = readFileSync(join(ROOT, "commands", name), "utf8").replaceAll("${CLAUDE_PLUGIN_ROOT}", ROOTDIR);
    const [, head, body] = /** @type {RegExpMatchArray} */ (text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/));
    const rules = [...head.matchAll(/^ {2}- Bash\((.+)\)$/gm)].map(x => x[1]);
    const dir = `${ROOTDIR}/skills/seo-supervisor`,
      check = `node ${dir}/scripts/update-check.mjs`;
    assert.ok(body.includes(`\`<skill-dir>\` is \`${dir}\``), `${name}: says what <skill-dir> is`);
    assert.ok(body.includes(`\`${check}\``), `${name}: shows the exact form`);
    assert.ok(
      rules.some(r => matches(r, check)),
      `${name}: the update check it shows is pre-approved`,
    );
    assert.ok(
      !rules.some(r => matches(r, `${check} on`) || matches(r, `${check} off`)),
      `${name}: turning the check on or off still asks`,
    );
    for (const r of rules)
      assert.ok(
        r.startsWith(`node ${dir}/scripts/`) && !/\/\*|scripts\/\*/.test(r),
        `${name}: ${r} names one script by the same path`,
      );
    // An npx install fills nothing in, so the body says where the scripts are in words that don't use the variable.
    assert.match(
      body,
      /starts with `\$`[^.]*npx[^.]*\), `<skill-dir>` is the folder that holds the skill's SKILL\.md/,
      `${name}: says what to do without the plugin`,
    );
  }
});
