// @ts-check
// Everything from the audit file is escaped: mdSafe where the page uses inl, noteMd for plain values, noteCode for
// paths, URLs and file names, cellMd in tables.
import { SEV, bandOf } from "../lib/score.mjs";
import { recheckOf } from "../lib/recheck.mjs";
import { planMarkdown } from "../report-plan.mjs";
import { SEV_LABEL, STATUS_LABEL, cellMd, fmtDate, mdSafe, noteCode, noteMd, num, plural } from "./format.mjs";
import { needsYou } from "./model.mjs";
import { effortOf, nextStep } from "./findings.mjs";
import { SCORE_HOW, actions, keyNumbers, scopeText } from "./overview.mjs";

/**
 * Follows the page's order (page.mjs), every finding with all its evidence, and ends with "How the score works",
 * which the page folds into its score panel.
 */
export function markdown(
  m,
  {
    plan,
    diff,
    topics,
    tabs,
    burstMd,
    googleUpdatesText,
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
    notShown = [],
  } = m;
  const panels = id => (tabs[id] || []).flatMap(x => x.md);
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
  if (raw.summary) L.push(mdSafe(raw.summary), "");
  const proposed = plan?.status === "proposed";
  if (plan && proposed) L.push(...planMarkdown(plan));
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
  const { fixFirst, needsYou: yours, yours: allYours, tasks } = actions(m);
  const { clicks, period, cwv, strategy } = keyNumbers(m);
  const item = x => `- ${x.id ? `**${noteMd(x.id)}** · ` : ""}${SEV_LABEL[x.sev]} · ${mdSafe(x.title)}`;
  if (fixFirst.length)
    L.push(
      "## Fix first",
      "",
      "What the agent can fix in code. Each line fixes one.",
      "",
      ...fixFirst.map(x => `${item(x)}${x.id ? ` · ${noteCode(`/seo-fix ${x.id}`)}` : ""}`),
      "",
    );
  if (yours.length)
    L.push(
      "## Needs you",
      "",
      "Your call, your accounts or your go-ahead: the agent won't change these without you.",
      "",
      ...yours.map(item),
      "",
      `All ${allYours.length} are under Decisions needed, below.`,
      "",
    );
  if (areas.length) {
    L.push("## Area scores", "", "| Area | Score | Open findings | Top issue |", "| --- | ---: | ---: | --- |");
    for (const a of areas)
      L.push(
        `| ${cellMd(noteMd(a.name))} | ${a.value} | ${a.top.length} | ${cellMd(a.top[0] ? mdSafe(a.top[0].title) : "All checks pass")} |`,
      );
    L.push("");
  }
  if (overall) L.push(`${scopeText(m)} Limits of this audit, below.`, "");
  L.push(
    `Open: ${open.length} (${SEV.map(s => `${countSev(s)} ${SEV_LABEL[s].toLowerCase()}`).join(", ")}) · Fixed: ${fixed.length} · Rules passing: ${overall ? `${overall.passing} of ${overall.rules}` : "n/a"}`,
    "",
  );
  if (clicks != null || cwv)
    L.push(
      [
        clicks != null && `Clicks from Google: ${num(clicks)}${period ? ` (${noteMd(period)})` : ""}`,
        cwv && `Core Web Vitals (real visitors, ${noteMd(strategy)}): ${cwv.toLowerCase()}`,
      ]
        .filter(Boolean)
        .join(" · "),
      "",
    );
  if (plan && !proposed) L.push(...planMarkdown(plan));
  const options = d => [...(d.options || []).map(o => `- ${mdSafe(o)}`), ...((d.options || []).length ? [""] : [])];
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
    if (nextStep(f, decisions)) L.push(`**Next step.** ${mdSafe(nextStep(f, decisions))}`, "");
    const rc = recheckOf(f);
    if (rc) L.push(`**Check the fix yourself.** ${noteCode(rc.command)} ${rc.hint}`, "");
  }
  L.push(...panels("findings"));
  if (decisions.length || tasks.length) {
    L.push("## Decisions needed", "");
    for (const d of decisions) {
      L.push(`### ${d.id ? `${noteMd(d.id)}: ` : ""}${mdSafe(d.question)}`, "");
      if (d.context) L.push(mdSafe(d.context), "");
      L.push(...options(d));
      if (d.recommendation) L.push(`**Recommended:** ${mdSafe(d.recommendation)}`, "");
    }
    if (tasks.length)
      L.push(
        "### Your tasks",
        "",
        "Findings only you can resolve: a setting on your host or an account, your content or your facts. The agent won't change them without your go-ahead.",
        "",
        ...tasks.map(f => `- **${noteMd(f.id)}** ${mdSafe(f.title)} · ${SEV_LABEL[f.severity]}`),
        "",
      );
  }
  for (const [id, label] of topics)
    L.push(`## ${label}`, "", "Information only: nothing here changes the score.", "", ...panels(id));
  if (diff || tabs.since) L.push("## Since last audit", "");
  if (diff) {
    L.push(...burstMd(), `Compared with the crawl of ${noteMd(fmtDate(diff.since))}.`, "");
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
  L.push(...panels("since"));
  if (fixed.length) {
    L.push("## What was changed", "");
    for (const f of fixed)
      L.push(
        `- **${noteMd(f.id)}** ${mdSafe(f.title)}${f.fixed?.summary ? `: ${mdSafe(f.fixed.summary)}` : ""}${(f.fixed?.files || []).length ? ` (${files(f.fixed.files)})` : ""}${f.fixed?.verified ? `. Verified: ${mdSafe(f.fixed.verified)}` : ""}`,
      );
    L.push("");
  }
  if (passed.length) {
    L.push("## Passed checks", "");
    for (const p of passed)
      L.push(`- **${noteMd(p.rule)}** ${mdSafe(p.title)}${p.detail ? ` (${mdSafe(p.detail)})` : ""}`);
    L.push("");
  }
  if (notChecked.length || notes.length || notShown.length || tabs.limits) {
    L.push("## Limits of this audit", "");
    for (const n of notChecked) L.push(`- **${noteMd(n.area || n.rule)}:** ${mdSafe(n.reason || "")}`);
    for (const n of notes) L.push(`- ${mdSafe(n)}`);
    L.push("");
    if (notShown.length)
      L.push(
        "### Not shown",
        "",
        "Results that were produced but can't be shown in this report, and why. Information only: they never change the score.",
        "",
        ...notShown.map(n => `- **${noteMd(n.what)}:** ${noteMd(n.why)}`),
        "",
      );
    L.push(...panels("limits"));
  }
  L.push("## How the score works", "", SCORE_HOW, "");
  return L.join("\n");
}
