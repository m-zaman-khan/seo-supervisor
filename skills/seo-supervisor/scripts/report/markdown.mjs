// @ts-check
// Everything from the audit file is escaped: mdSafe where the page uses inl, noteMd for plain values, noteCode for
// paths, URLs and file names, cellMd in tables.
import { SEV, bandOf } from "../lib/score.mjs";
import { recheckOf } from "../lib/recheck.mjs";
import { planMarkdown } from "../report-plan.mjs";
import { SEV_LABEL, STATUS_LABEL, cellMd, fmtDate, mdLink, mdSafe, noteCode, noteMd, plural } from "./format.mjs";
import { needsYou } from "./model.mjs";
import { effortOf } from "./findings.mjs";
import { SCORE_HOW } from "./overview.mjs";

/**
 * Follows the page's order (page.mjs), every finding with all its evidence, and ends with "How the score works",
 * which the page folds into its score panel.
 */
export function markdown(
  m,
  {
    plan,
    diff,
    speedText,
    labSpeedText,
    lcpText,
    lighthouseText,
    authorityText,
    ahrefsCredit,
    desktopSpeedText,
    positionsText,
    analyticsSplitLines,
    googleUpdatesText,
    searchLines,
    viewsMd,
    panelsMd,
    burstMd,
    googlePostsText,
    diffSections,
    diffText,
    unknownLines,
    linksDroppedMd,
    trafficOf,
    clarityOf,
  },
) {
  const {
    raw,
    site,
    run,
    overall,
    verdict,
    deltaOf,
    openBlockers,
    unlock,
    open,
    fixed,
    countSev,
    areas,
    decisions,
    findings,
    passed,
    notChecked,
    notes,
  } = m;
  const L = [];
  const files = list => list.map(x => noteCode(x)).join(", ");
  L.push(`# SEO report: ${noteMd(site.name)}`, "");
  L.push(
    mdSafe(
      [
        site.url,
        run.pagesCrawled != null && `${run.pagesCrawled} pages crawled`,
        site.framework,
        (site.siteTypes || []).join(", "),
        fmtDate(run.date),
        run.mode,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
    "",
  );
  if (overall) {
    L.push(`**SEO health score: ${overall.value}/100 (${bandOf(overall.value)[1]}).** ${verdict}.`, "");
    const delta = deltaOf(),
      md = h => h.replace(/<\/?b>/g, "**").replace(/<[^>]+>/g, "");
    if (overall.cap) {
      L.push(
        `${plural(overall.blockers, "open blocker")} hold${overall.blockers === 1 ? "s" : ""} the score at ${overall.cap} until fixed.`,
        "",
      );
      const owner = openBlockers.filter(needsYou).map(f => noteMd(f.id));
      L.push(
        `**Fix ${openBlockers.length === 1 ? "the blocker" : `the ${openBlockers.length} blockers`} and the score rises to ${unlock.value}/100 (${bandOf(unlock.value)[1]}).**${delta?.inUnlock ? ` ${md(delta.html)}.` : ""}${owner.length ? ` ${owner.join(", ")} need${owner.length === 1 ? "s" : ""} you: the agent won't change ${owner.length === 1 ? "it" : "them"} without your go-ahead.` : ""}`,
        "",
      );
    }
    if (delta && !delta.inUnlock) L.push(`${md(delta.html)}.`, "");
  }
  if (raw.summary) L.push(mdSafe(raw.summary), "");
  L.push(
    `Open: ${open.length} (${SEV.map(s => `${countSev(s)} ${SEV_LABEL[s].toLowerCase()}`).join(", ")}) · Fixed: ${fixed.length} · Rules passing: ${overall ? `${overall.passing} of ${overall.rules}` : "n/a"}`,
    "",
  );
  if (areas.length) {
    // The one-line summaries carry crawled paths, rivals' domains and feed names, so they're escaped.
    for (const t of [speedText(), labSpeedText(), lcpText(), lighthouseText()]) if (t) L.push(noteMd(t), "");
    if (authorityText())
      L.push(
        `${noteMd(authorityText())}${ahrefsCredit() ? ` · ${mdLink(ahrefsCredit().url, noteMd(ahrefsCredit().text))}` : ""}`,
        "",
      );
    if (desktopSpeedText()) L.push(noteMd(desktopSpeedText()), "");
    if (positionsText()) L.push(noteMd(positionsText()), "");
    for (const t of analyticsSplitLines()) L.push(noteMd(t), "");
    if (googleUpdatesText()) L.push(googleUpdatesText(), "");
    for (const t of searchLines()) L.push(noteMd(t), ""); // paths from Search Console, escaped
    L.push("## Area scores", "", "| Area | Score | Open findings | Top issue |", "| --- | ---: | ---: | --- |");
    for (const a of areas)
      L.push(
        `| ${cellMd(noteMd(a.name))} | ${a.value} | ${a.top.length} | ${cellMd(a.top[0] ? mdSafe(a.top[0].title) : "All checks pass")} |`,
      );
    L.push("");
    L.push(...viewsMd());
    L.push(...panelsMd());
  }
  if (plan) L.push(...planMarkdown(plan));
  if (diff) {
    L.push("## Since last audit", "", ...burstMd(), `Compared with the crawl of ${noteMd(fmtDate(diff.since))}.`, "");
    if (googleUpdatesText()) L.push(googleUpdatesText(), "");
    if (googlePostsText()) L.push(googlePostsText(), "");
    for (const [h, list] of diffSections(diff))
      L.push(`### ${h}`, "", ...list.map(c => `- ${noteCode(c.path)} ${noteMd(diffText(c))}`), ""); // crawled titles and robots.txt rules, escaped
    for (const t of unknownLines(diff)) L.push(t, "");
    for (const [h, l] of [
      ["Pages added", diff.added],
      ["Pages gone", diff.removed],
    ])
      if ((l || []).length) L.push(`### ${h}`, "", ...l.map(p => `- ${noteCode(p)}`), "");
    L.push(...linksDroppedMd());
  }
  const options = d => [...(d.options || []).map(o => `- ${mdSafe(o)}`), ...((d.options || []).length ? [""] : [])];
  if (decisions.length) {
    L.push("## Decisions needed", "");
    for (const d of decisions) {
      L.push(`### ${d.id ? `${noteMd(d.id)}: ` : ""}${mdSafe(d.question)}`, "");
      if (d.context) L.push(mdSafe(d.context), "");
      L.push(...options(d));
      if (d.recommendation) L.push(`**Recommended:** ${mdSafe(d.recommendation)}`, "");
    }
  }
  if (fixed.length) {
    L.push("## What was changed", "");
    for (const f of fixed)
      L.push(
        `- **${noteMd(f.id)}** ${mdSafe(f.title)}${f.fixed?.summary ? `: ${mdSafe(f.fixed.summary)}` : ""}${(f.fixed?.files || []).length ? ` (${files(f.fixed.files)})` : ""}${f.fixed?.verified ? `. Verified: ${mdSafe(f.fixed.verified)}` : ""}`,
      );
    L.push("");
  }
  L.push("## Findings", "");
  for (const f of findings) {
    // Titles and what's wrong can quote crawled pages and Google's messages, so they're escaped like evidence.
    L.push(
      `### ${noteMd(f.id)} · ${SEV_LABEL[f.severity]}${needsYou(f) ? " · Needs you" : ""} · ${mdSafe(f.title)}`,
      "",
    );
    L.push(
      `Status: ${noteMd(STATUS_LABEL[f.status] || f.status)} · Area: ${noteMd(f.category)}${f.rule ? ` · Rule: ${noteMd(f.rule)}` : ""}${f.count ? ` · Cases: ${noteMd(f.count)}` : ""}${effortOf(f) ? ` · ${effortOf(f)}` : ""}`,
      "",
    );
    if (f.what) L.push(`**What's wrong.** ${mdSafe(f.what)}`, "");
    if (f.why) L.push(`**Why it matters.** ${mdSafe(f.why)}`, "");
    if (f.fix) L.push(`**How to fix.** ${mdSafe(f.fix)}`, "");
    if (f.decision) {
      L.push(`**Decision needed.** ${mdSafe(f.decision.question || "")}`, "", ...options(f.decision));
      if (f.decision.recommendation) L.push(`Recommended: ${mdSafe(f.decision.recommendation)}`, "");
    }
    if (f.fixed)
      L.push(
        `**What was done.** ${mdSafe(f.fixed.summary || "")}${(f.fixed.files || []).length ? ` Files: ${files(f.fixed.files)}.` : ""}${f.fixed.verified ? ` Verified: ${mdSafe(f.fixed.verified)}.` : ""}`,
        "",
      );
    const t = trafficOf(f);
    if (t) L.push(`${noteMd(t.text)} on ${noteCode(t.path)}`, "");
    const c = clarityOf(f);
    if (c) L.push(`${noteMd(c.text)} on ${noteCode(c.path)}`, "");
    if ((f.evidence || []).length) {
      L.push("| Where | Detail |", "| --- | --- |");
      for (const e of f.evidence)
        L.push(
          `| ${cellMd([e.url && noteCode(e.url), e.file && noteCode(`${e.file}${e.line ? ":" + e.line : ""}`)].filter(Boolean).join(" "))} | ${cellMd(mdSafe(e.detail))} |`,
        );
      if (f.count > f.evidence.length) L.push("", `${f.count - f.evidence.length} more cases not listed.`);
      L.push("");
    }
    const rc = recheckOf(f);
    if (rc) L.push(`**Check the fix yourself.** ${noteCode(rc.command)} ${rc.hint}`, "");
  }
  if (passed.length) {
    L.push("## Passed checks", "");
    for (const p of passed)
      L.push(`- **${noteMd(p.rule)}** ${mdSafe(p.title)}${p.detail ? ` (${mdSafe(p.detail)})` : ""}`);
    L.push("");
  }
  if (notChecked.length || notes.length) {
    L.push("## Limits of this audit", "");
    for (const n of notChecked) L.push(`- **${noteMd(n.area || n.rule)}:** ${mdSafe(n.reason || "")}`);
    for (const n of notes) L.push(`- ${mdSafe(n)}`);
    L.push("");
  }
  L.push("## How the score works", "", SCORE_HOW, "");
  return L.join("\n");
}
