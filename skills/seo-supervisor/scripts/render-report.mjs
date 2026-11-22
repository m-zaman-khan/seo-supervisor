#!/usr/bin/env node
// @ts-check
// Renders an audit JSON (or raw seo-crawl / content-scan output) as one self-contained HTML page that makes no network
// requests, plus a Markdown copy with every finding in full. The JSON shape and score model are in ../report-format.md.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { planStats, planHtml, planMarkdown, PLAN_CSS } from "./report-plan.mjs";
import { VERSION } from "./update-check.mjs";
import { SEV, isOpen, score, bandOf, OWN_SCORE } from "./lib/score.mjs";
import { recheckOf, RECHECK_NOTE } from "./lib/recheck.mjs";
import { isMain } from "./lib/is-main.mjs";
import { buildModel, needsYou } from "./report/model.mjs";
import { overviewLines } from "./report/overview-lines.mjs";
import { overviewHtml, SCORE_IS_OURS } from "./report/overview.mjs";
import { effortOf, findingTabs } from "./report/findings.mjs";
import { diffParts } from "./report/diff.mjs";
import { connectionPanels } from "./report/panels/connections.mjs";
import { localPanels } from "./report/panels/local.mjs";
import { sitePanels } from "./report/panels/site.mjs";
import { contentPanels } from "./report/panels/content.mjs";
import { speedPanels } from "./report/panels/speed-media.mjs";
import { aiPanels } from "./report/panels/ai.mjs";
import { linkPanels } from "./report/panels/links.mjs";
import { searchTraffic } from "./report/traffic.mjs";
import {
  SEV_LABEL,
  STATUS_LABEL,
  esc,
  inl,
  fmtDate,
  num,
  obj,
  plural,
  firstSentence,
  ICON,
  dot,
  noteMd,
  noteCode,
  notePath,
  cellMd,
  isCount,
  isText,
} from "./report/format.mjs";

// Bundled woff2 fonts (SIL OFL), inlined so the report stays a single offline file.
const FONTS = [
  ["Geist", "geist.woff2", "100 900"],
  ["Geist Mono", "geist-mono.woff2", "100 900"],
  ["Bricolage Grotesque", "bricolage-grotesque.woff2", "200 800"],
];
const FONT_FACES = FONTS.map(([family, file, weight]) => {
  const path = new URL("./fonts/" + file, import.meta.url);
  if (!existsSync(path)) return "";
  return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${readFileSync(path).toString("base64")}) format("woff2");font-weight:${weight};font-style:normal;font-display:swap}`;
}).join("\n");

// client.js holds a __DEFAULT_TAB__ placeholder. Neither file can carry comments: every byte goes into the report.
const CSS = readFileSync(new URL("./report/styles.css", import.meta.url), "utf8");
const CLIENT_JS = readFileSync(new URL("./report/client.js", import.meta.url), "utf8");

/**
 * Builds the report as text and writes nothing.
 * @param {any} raw the parsed JSON
 * @param {{ dir?: string, mdFile?: string | null }} [opts] dir: the audit's folder, whose settings.json applies;
 *   mdFile: the Markdown file's name for the page to mention, or null for no Markdown (md is then null too)
 * @returns {{ html: string, md: string | null, receipt: string[] }} receipt: the lines printed before "Wrote:"
 */
export function render(raw, { dir = process.cwd(), mdFile = null } = {}) {
  const m = { raw, mdFile, ...buildModel(raw, dir) };
  const {
    site,
    run,
    findings,
    checkSettings,
    passed,
    notChecked,
    notes,
    decisions,
    open,
    fixed,
    countSev,
    buildRules,
    overall,
    areas,
    openBlockers,
    unlock,
    deltaOf,
    impact,
    verdict,
  } = m;

  const { connectionsHtml, connectionsMd, changeCheckHtml, changeCheckMd, newSearchesHtml, newSearchesMd } =
    connectionPanels(m);
  const { localHtml, localMd, geoGridHtml, geoGridMd } = localPanels(m);
  const {
    viewsHtml,
    viewsMd,
    hstsPreloadHtml,
    hstsPreloadMd,
    crawlCoverageHtml,
    crawlCoverageMd,
    browserHtml,
    browserMd,
    pageScoresHtml,
    pageScoresMd,
    checkSettingsHtml,
    checkSettingsMd,
    settingRows,
    settingsSummary,
  } = sitePanels(m);
  const {
    writingHtml,
    writingMd,
    productDataHtml,
    productDataMd,
    descriptionsHtml,
    descriptionsMd,
    appsPdfsHtml,
    appsPdfsMd,
    audienceHtml,
    audienceMd,
  } = contentPanels(m);
  const {
    imagesHtml,
    imagesMd,
    lighthouseDetailHtml,
    lighthouseDetailMd,
    speedDetailsHtml,
    speedDetailsMd,
    a11yHtml,
    a11yMd,
  } = speedPanels(m);
  const { agentsHtml, agentsMd, aiCrawlersHtml, aiCrawlersMd, aiAnswersHtml, aiAnswersMd } = aiPanels(m);
  const {
    linked,
    linksHtml,
    linksMd,
    moreLinksHtml,
    moreLinksMd,
    linkIdeasHtml,
    linkIdeasMd,
    linkedOnceHtml,
    linkedOnceMd,
    linkStrengthHtml,
    linkStrengthMd,
  } = linkPanels(m);
  const {
    trafficFor,
    trafficOf,
    trafficHtml,
    clarityOf,
    clarityHtml,
    searchLines,
    positionsText,
    analyticsSplitLines,
  } = searchTraffic(m, { linked });
  const { findingsHtml, decisionsHtml, changesHtml, passedHtml, limitsHtml, recheckNoteHtml, recheckNoteMd } =
    findingTabs(m, { trafficHtml, clarityHtml });

  const {
    speedText,
    authorityText,
    ahrefsCredit,
    labSpeedText,
    lcpText,
    lighthouseText,
    googleUpdatesText,
    desktopSpeedText,
  } = overviewLines(m);
  const {
    diff,
    diffHtml,
    timelineHtml,
    timelineMd,
    googlePostsText,
    burstMd,
    diffSections,
    diffText,
    unknownLines,
    linksDroppedMd,
  } = diffParts(m, { googleUpdatesText });
  // The Overview's panels, in order: on the page after the score views and search lines, in the Markdown after the area
  // scores.
  const panels = [
    [linksHtml, linksMd],
    [agentsHtml, agentsMd],
    [writingHtml, writingMd],
    [audienceHtml, audienceMd],
    [imagesHtml, imagesMd],
    [lighthouseDetailHtml, lighthouseDetailMd],
    [hstsPreloadHtml, hstsPreloadMd],
    [crawlCoverageHtml, crawlCoverageMd],
    [aiCrawlersHtml, aiCrawlersMd],
    [productDataHtml, productDataMd],
    [speedDetailsHtml, speedDetailsMd],
    [browserHtml, browserMd],
    [descriptionsHtml, descriptionsMd],
    [localHtml, localMd],
    [moreLinksHtml, moreLinksMd],
    [connectionsHtml, connectionsMd],
    [timelineHtml, timelineMd],
    [pageScoresHtml, pageScoresMd],
    [linkIdeasHtml, linkIdeasMd],
    [changeCheckHtml, changeCheckMd],
    [linkedOnceHtml, linkedOnceMd],
    [appsPdfsHtml, appsPdfsMd],
    [newSearchesHtml, newSearchesMd],
    [checkSettingsHtml, checkSettingsMd],
    [recheckNoteHtml, recheckNoteMd],
    [a11yHtml, a11yMd],
    [linkStrengthHtml, linkStrengthMd],
    [aiAnswersHtml, aiAnswersMd],
    [geoGridHtml, geoGridMd],
  ];
  const panelsHtml = () => panels.map(([html]) => html()).join(""),
    panelsMd = () => panels.flatMap(([, md]) => md()); // adds the result files beside the audit
  const plan = raw.plan && typeof raw.plan === "object" ? raw.plan : null;
  const tabs = [
    ["overview", "Overview", null],
    ["findings", "Findings", findings.length],
    ["decisions", "Decisions", decisions.length],
    ["changes", "Changes", fixed.length],
    ["passed", "Passed", passed.length + fixed.length],
    ["limits", "Limits", notChecked.length],
  ];
  if (diff) tabs.splice(1, 0, ["diff", "Since last audit", (diff.regressions || []).length]);
  if (plan) tabs.splice(plan.status === "proposed" ? 0 : 1, 0, ["plan", "Plan", planStats(plan).rows]);
  const DEFAULT_TAB = tabs[0][0];
  const PANELS = {
    overview: () =>
      overviewHtml(m, {
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
        viewsHtml,
        panelsHtml,
      }),
    diff: diffHtml,
    plan: () => planHtml(plan, { esc, inl, num, traffic: u => trafficFor(u, true) }),
    findings: findingsHtml,
    decisions: decisionsHtml,
    changes: changesHtml,
    passed: passedHtml,
    limits: limitsHtml,
  };
  const metaBits = [
    site.url && `<a href="${esc(site.url)}" rel="noopener">${esc(site.url.replace(/^https?:\/\//, ""))}</a>`,
    run.pagesCrawled != null && `${num(run.pagesCrawled)} pages crawled`,
    esc(fmtDate(run.date)),
    run.mode === "fix" && "Includes fixes",
  ].filter(Boolean);

  const JS = CLIENT_JS.replace("__DEFAULT_TAB__", DEFAULT_TAB);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark light">
<title>SEO report · ${esc(site.name)}</title>
<script>(function(h){h.classList.add('js');try{if(localStorage.getItem('seo-report-theme')==='light')h.dataset.theme='light'}catch(e){}})(document.documentElement)</script>
<style>${FONT_FACES}

${CSS}${plan ? PLAN_CSS : ""}</style>
</head>
<body>
<header class="top"><div class="wrap">
  <div class="title-row"><h1>${esc(site.name)}</h1><button class="theme-btn" type="button" hidden><svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg><span class="tl">Light</span></button></div>
  <p class="meta"><span>SEO report</span>${metaBits.map(b => `<span>${b}</span>`).join("")}</p>
  ${raw.summary ? (raw.summary.length <= 300 ? `<p class="lede">${inl(raw.summary)}</p>` : `<div class="lede"><p>${inl(firstSentence(raw.summary))}</p><details class="lede-more"><summary>Full summary</summary><p>${inl(raw.summary.slice(firstSentence(raw.summary).length).trim())}</p></details></div>`) : ""}
  <nav class="tabs" role="tablist" aria-label="Report sections">${tabs.map(([id, label, n], i) => `<button class="tab" role="tab" id="t-${id}" data-tab="${id}" aria-controls="p-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${label}${n != null ? `<span class="cnt">${n}</span>` : ""}</button>`).join("")}</nav>
</div></header>
<main class="wrap">
  ${tabs.map(([id, label]) => `<section class="tp" id="p-${id}" role="tabpanel" aria-labelledby="t-${id}" data-title="${label}"${id === DEFAULT_TAB ? "" : " hidden"}>${PANELS[id]()}</section>`).join("\n  ")}
</main>
<footer><div class="wrap"><span>${mdFile ? `Full detail for every finding: <code>${esc(mdFile)}</code> in the same folder.` : ""}</span><span>Generated by SEO Supervisor ${VERSION}${run.auditor && run.auditor !== "seo-supervisor" ? ` · ${esc(run.auditor)}` : ""} · ${esc(fmtDate(run.date))}</span></div></footer>
<script>
${JS}</script>
</body>
</html>
`;

  // ---------- markdown ----------
  function markdown() {
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
    L.push(
      "## How the score works",
      "",
      `Every checked rule is worth 10 points. A rule that passes, or whose findings are all fixed, earns 10. A rule with open findings earns by its worst one: low 8, medium or decision 6, high 3, blocker 0. The score is the share of points earned. Each open blocker caps it: one at 59, two at 49, three at 39. While a blocker is open, the panel also shows the score you reach once it is fixed. Area scores use the same rules within each area. ${SCORE_IS_OURS}`,
      "",
    );
    return L.join("\n");
  }

  const receipt = [
    overall ? `SEO health score: ${overall.value}/100 (${bandOf(overall.value)[1]}). ${verdict}.` : verdict,
    unlock &&
      `Fixing the ${openBlockers.length === 1 ? "blocker" : `${openBlockers.length} blockers`} raises it to ${unlock.value}/100 (${bandOf(unlock.value)[1]}).`,
    `Open: ${open.length} (${SEV.map(s => `${countSev(s)} ${SEV_LABEL[s].toLowerCase()}`).join(", ")}) · fixed: ${fixed.length}${overall ? ` · rules passing: ${overall.passing} of ${overall.rules}` : ""}`,
    settingRows().length &&
      `Check settings (settings.json): ${settingsSummary()}. The score leaves turned-off checks out.`,
    ...checkSettings.warnings.map(w => `Settings warning: ${w}`),
  ].filter(Boolean);
  return { html, md: mdFile ? markdown() : null, receipt };
}

// Prints the page with its print styles: every tab in turn, findings open, light colours. The browser modules load
// only for --pdf.
async function printPdf(htmlPath, pdf) {
  const [{ findBrowser }, { launchChrome }, { installedBrowser }, { pathToFileURL }] = await Promise.all([
    import("./checks/render.mjs"),
    import("./lib/cdp.mjs"),
    import("./lib/settings-dir.mjs"),
    import("node:url"),
  ]);
  const browser = findBrowser() || installedBrowser();
  if (!browser)
    throw new Error(
      "no Chrome or Edge found, so no PDF was made (the HTML report is ready). Install Chrome or Edge, or set CHROME_PATH to it; in a container or CI, the owner can add one with npx seo-supervisor --with-browser (it downloads Chrome).",
    );
  const chrome = await launchChrome(browser, { timeoutMs: 60000 });
  try {
    const page = await chrome.newPage();
    await page.send("Page.enable");
    const loaded = new Promise((ok, no) => {
      page.on("Page.loadEventFired", ok);
      setTimeout(
        no,
        60000,
        new Error("the report didn't finish loading in Chrome within 60 s, so no PDF was made."),
      ).unref();
    });
    await page.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
    await loaded;
    await page.send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true });
    // Every collapsed panel opens, as a browser's own print does (beforeprint), so the PDF holds them all.
    await page.send("Runtime.evaluate", {
      expression: "document.querySelectorAll('details').forEach(d => { d.open = true; })",
    });
    const { data } = await page.send("Page.printToPDF", {
      printBackground: true,
      paperWidth: 8.27,
      paperHeight: 11.69,
    }); // A4, in inches
    writeFileSync(pdf, Buffer.from(data, "base64"));
  } finally {
    await chrome.close();
  }
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const inPath = argv.find(a => !a.startsWith("--"));
  if (!inPath) {
    console.error(
      "Usage: node render-report.mjs <audit.json|seo-crawl.json|content-scan.json> [--out report.html] [--md report.md] [--no-md] [--pdf]",
    );
    process.exit(2);
  }
  const opt = k => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  const outPath = resolve(opt("--out") || inPath.replace(/\.json$/i, "") + ".html");
  const mdPath = argv.includes("--no-md") ? null : resolve(opt("--md") || outPath.replace(/\.html?$/i, "") + ".md");
  const raw = JSON.parse(readFileSync(inPath, "utf8"));
  const { html, md, receipt } = render(raw, {
    dir: dirname(resolve(inPath)),
    mdFile: mdPath ? basename(mdPath) : null,
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  if (mdPath) writeFileSync(mdPath, md);
  const pdfPath = argv.includes("--pdf") ? outPath.replace(/\.html?$/i, "") + ".pdf" : null;
  const pdfError = pdfPath
    ? await printPdf(outPath, pdfPath).then(
        () => null,
        e => e.message,
      )
    : null;
  console.log(
    [...receipt, `Wrote: ${[outPath, mdPath, pdfPath && !pdfError && pdfPath].filter(Boolean).join(", ")}`]
      .filter(Boolean)
      .join("\n"),
  );
  if (pdfError) {
    console.error(`render-report: ${pdfError}`);
    process.exitCode = 1;
  }
}
