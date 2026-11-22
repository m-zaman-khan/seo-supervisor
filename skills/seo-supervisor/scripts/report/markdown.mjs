// @ts-check
// Everything from the audit file is escaped: mdSafe where the page uses inl, noteMd for plain values, noteCode for
// paths, URLs and file names, cellMd in tables.
import { SEV, bandOf } from "../lib/score.mjs";
import { recheckOf } from "../lib/recheck.mjs";
import { planMarkdown } from "../report-plan.mjs";
import { SEV_LABEL, STATUS_LABEL, fmtDate, plural } from "./format.mjs";
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
  const mdEsc = s =>
    String(s ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ");
  // Third-party text: URLs in code spans, anchor text with Markdown and HTML characters backslash-escaped.
  const mdCode = s => "`" + String(s ?? "").replace(/[`\r\n]/g, " ") + "`";
  const mdText = s =>
    String(s ?? "")
      .replace(/\s+/g, " ")
      .replace(/[\\`*_[\]<>]/g, "\\$&");
  // Evidence can quote crawled pages and other sites: its own `code` spans stay, URLs outside them become code spans
  // and the rest is escaped, so none of it renders as a link or a tag.
  const mdSafe = s =>
    String(s ?? "")
      .replace(/\s+/g, " ")
      .split(/(`[^`]+`)/)
      .map((p, i) =>
        i % 2
          ? p
          : p
              .split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)'])/)
              .map((q, j) => (j % 2 ? mdCode(q) : mdText(q)))
              .join(""),
      )
      .join("");
  L.push(`# SEO report: ${site.name}`, "");
  L.push(
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
      const owner = openBlockers.filter(needsYou).map(f => f.id);
      L.push(
        `**Fix ${openBlockers.length === 1 ? "the blocker" : `the ${openBlockers.length} blockers`} and the score rises to ${unlock.value}/100 (${bandOf(unlock.value)[1]}).**${delta?.inUnlock ? ` ${md(delta.html)}.` : ""}${owner.length ? ` ${owner.join(", ")} need${owner.length === 1 ? "s" : ""} you: the agent won't change ${owner.length === 1 ? "it" : "them"} without your go-ahead.` : ""}`,
        "",
      );
    }
    if (delta && !delta.inUnlock) L.push(`${md(delta.html)}.`, "");
  }
  if (raw.summary) L.push(raw.summary, "");
  L.push(
    `Open: ${open.length} (${SEV.map(s => `${countSev(s)} ${SEV_LABEL[s].toLowerCase()}`).join(", ")}) · Fixed: ${fixed.length} · Rules passing: ${overall ? `${overall.passing} of ${overall.rules}` : "n/a"}`,
    "",
  );
  if (areas.length) {
    if (speedText()) L.push(speedText(), "");
    if (labSpeedText()) L.push(labSpeedText(), "");
    if (lcpText()) L.push(lcpText(), "");
    if (lighthouseText()) L.push(lighthouseText(), "");
    if (authorityText())
      L.push(`${authorityText()}${ahrefsCredit() ? ` · [${ahrefsCredit().text}](${ahrefsCredit().url})` : ""}`, "");
    if (desktopSpeedText()) L.push(mdText(desktopSpeedText()), "");
    if (positionsText()) L.push(mdText(positionsText()), "");
    for (const t of analyticsSplitLines()) L.push(mdText(t), "");
    if (googleUpdatesText()) L.push(googleUpdatesText(), "");
    for (const t of searchLines()) L.push(mdText(t), ""); // paths from Search Console, escaped
    L.push("## Area scores", "", "| Area | Score | Open findings | Top issue |", "| --- | ---: | ---: | --- |");
    for (const a of areas)
      L.push(
        `| ${mdEsc(a.name)} | ${a.value} | ${a.top.length} | ${mdEsc(a.top[0] ? mdSafe(a.top[0].title) : "All checks pass")} |`,
      );
    L.push("");
    L.push(...viewsMd());
    L.push(...panelsMd());
  }
  if (plan) L.push(...planMarkdown(plan));
  if (diff) {
    L.push("## Since last audit", "", ...burstMd(), `Compared with the crawl of ${fmtDate(diff.since)}.`, "");
    if (googleUpdatesText()) L.push(googleUpdatesText(), "");
    if (googlePostsText()) L.push(googlePostsText(), "");
    for (const [h, list] of diffSections(diff))
      L.push(`### ${h}`, "", ...list.map(c => `- ${mdCode(c.path)} ${mdText(diffText(c))}`), ""); // crawled titles and robots.txt rules, escaped
    for (const t of unknownLines(diff)) L.push(t, "");
    for (const [h, l] of [
      ["Pages added", diff.added],
      ["Pages gone", diff.removed],
    ])
      if ((l || []).length) L.push(`### ${h}`, "", ...l.map(p => `- \`${p}\``), "");
    L.push(...linksDroppedMd());
  }
  if (decisions.length) {
    L.push("## Decisions needed", "");
    for (const d of decisions) {
      L.push(`### ${d.id ? `${d.id}: ` : ""}${mdSafe(d.question)}`, "");
      if (d.context) L.push(mdSafe(d.context), "");
      for (const o of d.options || []) L.push(`- ${o}`);
      if ((d.options || []).length) L.push("");
      if (d.recommendation) L.push(`**Recommended:** ${d.recommendation}`, "");
    }
  }
  if (fixed.length) {
    L.push("## What was changed", "");
    for (const f of fixed)
      L.push(
        `- **${f.id}** ${mdSafe(f.title)}${f.fixed?.summary ? `: ${f.fixed.summary}` : ""}${(f.fixed?.files || []).length ? ` (${f.fixed.files.map(x => "`" + x + "`").join(", ")})` : ""}${f.fixed?.verified ? `. Verified: ${f.fixed.verified}` : ""}`,
      );
    L.push("");
  }
  L.push("## Findings", "");
  for (const f of findings) {
    // Titles and what's wrong can quote crawled pages and Google's messages, so they're escaped like evidence.
    L.push(`### ${f.id} · ${SEV_LABEL[f.severity]}${needsYou(f) ? " · Needs you" : ""} · ${mdSafe(f.title)}`, "");
    L.push(
      `Status: ${STATUS_LABEL[f.status] || f.status} · Area: ${f.category}${f.rule ? ` · Rule: ${f.rule}` : ""}${f.count ? ` · Cases: ${f.count}` : ""}${effortOf(f) ? ` · ${effortOf(f)}` : ""}`,
      "",
    );
    if (f.what) L.push(`**What's wrong.** ${mdSafe(f.what)}`, "");
    if (f.why) L.push(`**Why it matters.** ${f.why}`, "");
    if (f.fix) L.push(`**How to fix.** ${f.fix}`, "");
    if (f.decision) {
      L.push(`**Decision needed.** ${f.decision.question || ""}`, "");
      for (const o of f.decision.options || []) L.push(`- ${o}`);
      if ((f.decision.options || []).length) L.push("");
      if (f.decision.recommendation) L.push(`Recommended: ${f.decision.recommendation}`, "");
    }
    if (f.fixed)
      L.push(
        `**What was done.** ${f.fixed.summary || ""}${(f.fixed.files || []).length ? ` Files: ${f.fixed.files.map(x => "`" + x + "`").join(", ")}.` : ""}${f.fixed.verified ? ` Verified: ${f.fixed.verified}.` : ""}`,
        "",
      );
    const t = trafficOf(f);
    if (t) L.push(`${t.text} on \`${t.path}\``, "");
    const c = clarityOf(f);
    if (c) L.push(`${c.text} on \`${c.path}\``, "");
    if ((f.evidence || []).length) {
      L.push("| Where | Detail |", "| --- | --- |");
      for (const e of f.evidence)
        L.push(
          `| ${mdEsc([e.url && mdCode(e.url), e.file && `\`${e.file}${e.line ? ":" + e.line : ""}\``].filter(Boolean).join(" "))} | ${mdEsc(mdSafe(e.detail))} |`,
        );
      if (f.count > f.evidence.length) L.push("", `${f.count - f.evidence.length} more cases not listed.`);
      L.push("");
    }
    const rc = recheckOf(f);
    if (rc) L.push(`**Check the fix yourself.** ${mdCode(rc.command)} ${rc.hint}`, "");
  }
  if (passed.length) {
    L.push("## Passed checks", "");
    for (const p of passed) L.push(`- **${p.rule}** ${p.title}${p.detail ? ` (${p.detail})` : ""}`);
    L.push("");
  }
  if (notChecked.length || notes.length) {
    L.push("## Limits of this audit", "");
    for (const n of notChecked) L.push(`- **${n.area || n.rule}:** ${n.reason || ""}`);
    for (const n of notes) L.push(`- ${n}`);
    L.push("");
  }
  L.push("## How the score works", "", SCORE_HOW, "");
  return L.join("\n");
}
