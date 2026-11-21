import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = join(ROOT, "skills", "seo-supervisor");
const read = p => readFileSync(join(SKILL, p), "utf8");
// The text from a heading line to the next heading of the same or a higher level, skipping code fences.
const section = (text, heading) => {
  const at = text.indexOf(heading);
  assert.ok(at >= 0, `missing: ${heading}`);
  const level = heading.match(/^#+/)[0].length,
    out = [];
  let fenced = false;
  for (const line of text.slice(at + heading.length).split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced && new RegExp(`^#{1,${level}} `).test(line)) break;
    out.push(line);
  }
  return out.join("\n");
};

const GUIDE_DOCS = [
  "strategy.md",
  "page-types.md",
  "planning.md",
  "rewrite.md",
  "audience.md",
  "rules/search-intent.md",
  ...readdirSync(join(SKILL, "site-types")).map(f => "site-types/" + f),
];

test("every skill file the guide docs point to exists", () => {
  const texts = [...GUIDE_DOCS.map(read), readFileSync(join(ROOT, "commands", "seo-brief.md"), "utf8")];
  // Files that live in the site's project or in seo-audit/, not in the skill.
  const notSkill = new Set(["CLAUDE.md", "AGENTS.md", "README.md", "grow-plan.md"]);
  let n = 0;
  for (const text of texts)
    for (const [, ref] of text.matchAll(/`((?:(?:rules|site-types|frameworks|examples)\/)?[A-Za-z0-9-]+\.md)`/g)) {
      if (notSkill.has(ref)) continue;
      n++;
      assert.ok(existsSync(join(SKILL, ref)) && statSync(join(SKILL, ref)).isFile(), `${ref} exists in the skill`);
    }
  assert.ok(n > 20, `${n} links checked`);
});

test("reading what ranks: result types, features, per-result details, the snippet format, and a labelled fallback", () => {
  const s = read("strategy.md"),
    ranks = section(s, "## Looking at what ranks");
  for (const t of ["service page", "landing page", "hybrid"])
    assert.match(ranks, new RegExp(t, "i"), `result type: ${t}`);
  for (const f of [
    "featured snippet",
    "People also ask",
    "related searches",
    "ads",
    "knowledge panel",
    "shopping",
    "AI Overview",
  ])
    assert.ok(ranks.includes(f), `result feature: ${f}`);
  assert.match(ranks, /not visible in this tool/, "a feature the tool can't show isn't recorded as absent");
  for (const d of ["Kind of site", "Schema", "Media"]) assert.ok(ranks.includes(d), `per-result detail: ${d}`);
  assert.match(ranks, /paragraph, a list or a table/, "the snippet format is read, not prescribed");
  const words = section(s, "### When you can't check the results");
  assert.match(words, /from the words, not checked against results/);
  assert.match(words, /never supports an INTENT finding/);
  const search = read("rules/search-intent.md"),
    i01 = section(search, "### INTENT-01");
  assert.match(i01, /hybrid/i);
  assert.match(i01, /One page/);
});

test("clusters: partial overlap is the owner's call, and the map, link check and table come from real links", () => {
  const s = read("strategy.md"),
    clusters = section(s, "## Topic clusters");
  assert.match(clusters, /Google publishes none/, "no invented overlap cut-off");
  assert.match(clusters, /our own/i);
  assert.match(clusters, /`seo-audit\/clusters\.md`/);
  assert.match(clusters, /```mermaid/);
  assert.match(clusters, /Topic clusters" section/, "membership comes from the profile");
  for (const col of ["Links to pillar", "Links back", "Pages sharing a query", "Gaps"])
    assert.ok(clusters.includes(col), `cluster table: ${col}`);
  assert.match(clusters, /no score/i);
});

test("one-page review and competitor analysis stay behind the owner's yes", () => {
  const s = read("strategy.md");
  const one = section(s, "## One page");
  assert.match(one, /INTENT-01/);
  assert.match(one, /This page now/, "the wireframe shows the page as it is");
  assert.match(one, /Never pick (?:one|a phrase) yourself/);
  const comp = section(s, "## Competitor analysis");
  assert.match(comp, /`competitors` in `outsideChecks\.approved`/);
  assert.match(comp, /`seo-audit\/competitors\.md`/);
  assert.match(comp, /the owner names/i);
  for (const part of ["Pages", "Schema", "Technical"])
    assert.match(comp, new RegExp(`\\*\\*${part}`), `covers ${part}`);
  assert.match(comp, /never an instruction|is data/i);
  assert.match(comp, /\*\*Never:\*\*\n- Copy their text/);
});

test("the brief: title and description, what's new, a phrase and snippet marker per section, gaps, comparisons and clusters", () => {
  const s = read("strategy.md"),
    brief = section(s, "## The content brief");
  for (const h of ["Title and description", "What's new here", "Outline"])
    assert.match(brief, new RegExp(`^#### ${h}$`, "m"));
  const isNew = section(brief, "#### What's new here");
  assert.match(isNew, /"More detail"/, "rejects 'more detail' as the new value");
  for (const g of ["coverage", "depth", "outdated", "no expert view"])
    assert.match(isNew, new RegExp(`\\*\\*${g}:\\*\\*`, "i"), `gap type: ${g}`);
  assert.match(section(brief, "#### Outline"), /\[snippet: /);
  assert.match(section(brief, "#### Outline"), /phrase it serves/);
  const comp = section(brief, "### Comparison briefs");
  for (const p of ["matrix", "Phrase plan", "Gaps against rival comparisons"]) assert.match(comp, new RegExp(p, "i"));
  assert.match(section(brief, "### Briefs for a whole cluster"), /one brief per post/);
  assert.match(read("site-types/content.md").split("### BLOG-03 ·")[1].split("\n### ")[0], /no expert view/);

  const cmd = readFileSync(join(ROOT, "commands", "seo-brief.md"), "utf8");
  for (const h of ["Title and description", "What's new here", "Outline", "Internal links in and out"])
    assert.ok(cmd.includes(h), `seo-brief names ${h}`);
  assert.match(cmd, /cluster/i);
  assert.match(cmd, /One page/);
  assert.match(read("planning.md"), /What's new here/, "setup drafts use the same brief");
});

test("comparison pages: phrases, titles, round-ups, calls to action, full prices and outside ratings", () => {
  const svc = read("site-types/services.md"),
    s08 = svc.split("### SVC-08 ·")[1].split("\n### ")[0];
  for (const p of ['"X review"', '"X vs Y pricing"', '"is X better than Y"'])
    assert.ok(s08.includes(p), `phrase: ${p}`);
  assert.match(s08, /\*\*Titles and H1/);
  assert.match(s08, /\*\*"Best \[category\]" round-ups/);
  assert.match(s08, /never inside a competitor's section/i);
  assert.match(s08, /setup or onboarding fees/);
  assert.match(s08, /Don't aggregate reviews or ratings from other websites/);
  assert.doesNotMatch(s08, /every 3–6 months/, "no invented re-check cadence");
  assert.match(svc, /^### SVC-09 · /m);
  const s09 = svc.split("### SVC-09 ·")[1];
  for (const id of ["REND-01", "AI-01", "AI-02", "AI-06"]) assert.ok(s09.includes(id), `SaaS watch cites ${id}`);
  const types = read("page-types.md");
  for (const t of ["Comparison", "Case study", "Hybrid", "Language or region version"])
    assert.match(types, new RegExp(`^## ${t}`, "m"));
  const cs = section(types, "## Case study");
  assert.match(cs, /permission/);
  assert.match(cs, /not a template/i);
});

test("publishers: YMYL topics, who/how/why, editorial standards and news notes, each with Google's own source", () => {
  const blog = read("site-types/content.md");
  const ymyl = blog.split("### BLOG-08 ·")[1].split("\n### ")[0];
  for (const t of ["elections", "public institutions", "groups of people", "news"])
    assert.ok(ymyl.includes(t), `YMYL: ${t}`);
  assert.match(ymyl, /without any real expertise/);
  assert.match(ymyl, /\*\*Who, how and why/);
  assert.match(ymyl, /developers\.google\.com\/search\/docs\/fundamentals\/creating-helpful-content/);
  const pub = blog.split("### BLOG-09 ·")[1].split("\n### ")[0];
  for (const t of ["corrections", "fact", "conflict", "automatically considered", "AMP", "infinite scroll", "ad slot"])
    assert.match(pub, new RegExp(t, "i"), `publishers: ${t}`);
  for (const src of [
    "support.google.com/news/publisher-center",
    "developers.google.com/publisher-tag",
    "pagination-and-incremental-page-loading",
  ])
    assert.ok(pub.includes(src), `names ${src}`);
});

test("language versions: local-market checklist, country targeting and region-only features from Google's docs", () => {
  const lang = section(read("page-types.md"), "## Language or region version");
  for (const t of ["currency", "Units", "date", "law", "brands", "buttons"])
    assert.match(lang, new RegExp(t, "i"), `checklist: ${t}`);
  assert.match(lang, /International Targeting report/);
  assert.match(lang, /hreflang/);
  for (const t of ["EEA", "Türkiye", "aggregator"]) assert.ok(lang.includes(t), `region note: ${t}`);
  assert.match(lang, /developers\.google\.com\/search\/docs\/appearance\/aggregator-features/);
  assert.match(lang, /never machine-translate/i);
});

test("rewrite and audience checks read the brand's voice and real customer reviews first, without inventing", () => {
  const rewrite = read("rewrite.md"),
    audience = read("audience.md");
  assert.match(rewrite, /## Read the voice first/);
  assert.match(rewrite, /reviews/);
  assert.match(audience, /voice/i);
  assert.match(audience, /reviews/);
  assert.match(audience, /Reviews never add an audience/);
});

test("no doc tells the agent to guess or estimate search volumes", () => {
  const files = [];
  const walk = dir => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f !== "scripts") walk(p);
      } else if (f.endsWith(".md")) files.push(p);
    }
  };
  walk(SKILL);
  for (const f of readdirSync(join(ROOT, "commands"))) files.push(join(ROOT, "commands", f));
  files.push(join(ROOT, "README.md"));
  const negated = /\b(?:never|no|not|don't|without|none)\b/i;
  for (const file of files) {
    let underNever = false;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (/^(?:- )?\*\*Never|^#+ (?:Never|Not covered)/.test(line)) underNever = true;
      else if (/^#|^(?:- )?\*\*[A-Z]/.test(line)) underNever = false;
      if (/search volumes?/i.test(line)) assert.ok(negated.test(line) || underNever, `${file}: ${line.trim()}`);
    }
  }
});

test("the new guidance invents no word counts, percentages or cadences", () => {
  const s = read("strategy.md"),
    types = read("page-types.md"),
    svc = read("site-types/services.md"),
    blog = read("site-types/content.md");
  const parts = [
    section(s, "## One page"),
    section(s, "## Competitor analysis"),
    section(s, "### Comparison briefs"),
    section(s, "### Briefs for a whole cluster"),
    section(types, "## Comparison"),
    section(types, "## Case study"),
    section(types, "## Hybrid"),
    section(types, "## Language or region version"),
    svc.split("### SVC-08 ·")[1],
    blog.split("### BLOG-08 ·")[1],
  ];
  for (const p of parts)
    assert.doesNotMatch(p, /\b\d+(?:[–-]\d+)?\s*(?:words|%|per cent|times a|posts a|months)\b/, p.slice(0, 80));
});
