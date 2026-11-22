#!/usr/bin/env node
// @ts-check
// Renders an audit JSON (or raw seo-crawl / content-scan output) as one self-contained HTML page that makes no network
// requests, plus a Markdown copy with every finding in full. The JSON shape and score model are in ../report-format.md.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { SEV, bandOf } from "./lib/score.mjs";
import { isMain } from "./lib/is-main.mjs";
import { Fail, runMain } from "./lib/cli.mjs";
import { parseArgs } from "./lib/args.mjs";
import { SEV_LABEL, esc, link, mdLink, noteMd } from "./report/format.mjs";
import { buildModel } from "./report/model.mjs";
import { loadSources } from "./report/sources.mjs";
import { overviewLines } from "./report/overview-lines.mjs";
import { searchTraffic } from "./report/traffic.mjs";
import { diffParts } from "./report/diff.mjs";
import { findingTabs } from "./report/findings.mjs";
import { sitePanels } from "./report/panels/site.mjs";
import { linkPanels } from "./report/panels/links.mjs";
import { aiPanels } from "./report/panels/ai.mjs";
import { contentPanels } from "./report/panels/content.mjs";
import { speedPanels } from "./report/panels/speed-media.mjs";
import { localPanels } from "./report/panels/local.mjs";
import { connectionPanels } from "./report/panels/connections.mjs";
import {
  logsPanel,
  brandTrendPanel,
  topSearchesPanel,
  keywordIdeasPanel,
  indexVerdictPanel,
} from "./report/panels/data-search.mjs";
import { schemaInventoryPanel } from "./report/panels/data-site.mjs";
import { overviewHtml } from "./report/overview.mjs";
import { pageHtml } from "./report/page.mjs";
import { markdown } from "./report/markdown.mjs";
import { byTab, deeper } from "./report/panel.mjs";

/**
 * Builds the report as text and writes nothing.
 * @param {any} raw the parsed JSON
 * @param {{ dir?: string, mdFile?: string | null }} [opts] dir: the audit's folder, whose settings.json applies;
 *   mdFile: the Markdown file's name for the page to mention, or null for no Markdown (md is then null too)
 * @returns {{ html: string, md: string | null, receipt: string[] }} receipt: the lines printed before "Wrote:"
 */
export function render(raw, { dir = process.cwd(), mdFile = null } = {}) {
  const { raw: full, notShown } = loadSources(raw, dir),
    m = { raw: full, mdFile, notShown, ...buildModel(full, dir) }; // adds the result files beside the audit
  const plan = raw.plan && typeof raw.plan === "object" ? raw.plan : null;
  // Each module builds its parts from the model; what one needs from another is passed in by name.
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
  const { linked, links, moreLinks, linkIdeas, queryGaps, linkedOnce, linkStrength } = linkPanels(m);
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
  const {
    diff,
    diffHtml,
    posts,
    timeline,
    googlePostsText,
    burstMd,
    diffSections,
    diffText,
    unknownLines,
    linksDroppedMd,
  } = diffParts(m, { googleUpdatesText });
  const { findingsHtml, decisionsHtml, changesHtml, passedHtml, limitsHtml, recheckNote, decisionCount } = findingTabs(
    m,
    { trafficHtml, clarityHtml },
  );
  const {
    viewsHtml,
    viewsMd,
    hstsPreload,
    crawlCoverage,
    browser,
    pageScores,
    checkSettings: checkSettingsPanel,
    settingRows,
    settingsSummary,
  } = sitePanels(m);
  const { agents, aiCrawlers, aiAnswers } = aiPanels(m);
  const { writing, productData, descriptions, appsPdfs, audience } = contentPanels(m);
  const { images, lighthouseDetail, speedDetails, a11y } = speedPanels(m);
  const { local, geoGridHtml, geoGridMd } = localPanels(m);
  const { connections, changeCheck, newSearches } = connectionPanels(m);

  // The one-line summaries, each topic's as one panel of quiet lines at the top of its tab.
  const lines = (title, list) => () => {
    const l = list().filter(Boolean);
    return l.length && { title, blocks: l.map(quiet => ({ quiet })) };
  };
  const searchGlance = lines("Search at a glance", () => [
    ...searchLines(),
    positionsText(),
    ...analyticsSplitLines(),
    googleUpdatesText() && { html: googleUpdatesText(true), md: googleUpdatesText() },
  ]);
  const speedGlance = lines("Speed at a glance", () => [
    speedText(),
    desktopSpeedText(),
    labSpeedText(),
    lcpText(),
    lighthouseText(),
  ]);
  // Ahrefs' licence requires its credit beside a Domain Rating.
  const credit = ahrefsCredit();
  const authority = lines("Authority", () => [
    authorityText() && {
      html: `${esc(authorityText())}${credit ? ` · ${link(credit.url, esc(credit.text))}` : ""}`,
      md: `${noteMd(authorityText())}${credit ? ` · ${mdLink(credit.url, noteMd(credit.text))}` : ""}`,
    },
  ]);
  // Score views are labelled as estimates. Like every topic panel, they and the rank grid sit a heading level down in
  // the Markdown.
  const ESTIMATES = "Estimates, not part of the score";
  /** @type {[() => string, () => string[]]} */
  const views = [
    () =>
      viewsHtml().replace(
        '<span class="sub">The audit read another way</span>',
        `<span class="sub">${ESTIMATES}</span>`,
      ),
    () => {
      const v = viewsMd();
      return v.length ? ["### Score views", "", `${ESTIMATES}.`, "", ...v.slice(2)] : [];
    },
  ];
  /** @type {[() => string, () => string[]]} */
  const grid = [geoGridHtml, () => deeper(geoGridMd(), 1)];

  // [tab, card, panel] rows. Panels that share a card render as one box. "since", "limits" and "findings" add to
  // those existing tabs.
  const [S, SP, L, SC] = ["search-ai", "speed", "links", "site-content"];
  const tabs = byTab([
    [S, "Search traffic", searchGlance],
    [S, "Search traffic", () => topSearchesPanel(m)],
    [S, "Search traffic", () => brandTrendPanel(m)],
    [S, "Search traffic", () => indexVerdictPanel(m)],
    [S, "Search traffic", newSearches],
    [S, "Search traffic", connections],
    [S, "Search traffic", posts],
    [S, "Search ideas", () => keywordIdeasPanel(m)],
    [S, "Search ideas", queryGaps],
    [S, "AI crawlers, agents and answers", aiCrawlers],
    [S, "AI crawlers, agents and answers", agents],
    [S, "AI crawlers, agents and answers", () => logsPanel(m)],
    [S, "AI crawlers, agents and answers", aiAnswers],
    [SP, "Speed and Lighthouse", speedGlance],
    [SP, "Speed and Lighthouse", lighthouseDetail],
    [SP, "Speed and Lighthouse", speedDetails],
    [SP, "Speed and Lighthouse", images],
    [L, "Internal links", linkStrength],
    [L, "Internal links", linkedOnce],
    [L, "Internal links", linkIdeas],
    [L, "Links from other sites", authority],
    [L, "Links from other sites", links],
    [L, "Links from other sites", moreLinks],
    [SC, null, views],
    [SC, "Structured data", () => schemaInventoryPanel(m)],
    [SC, "Local business", local],
    [SC, "Local business", grid],
    [SC, "Content and writing", writing],
    [SC, "Content and writing", descriptions],
    [SC, "Content and writing", audience],
    [SC, "Content and writing", productData],
    [SC, "Content and writing", pageScores],
    [SC, "Site hygiene", crawlCoverage],
    [SC, "Site hygiene", browser],
    [SC, "Site hygiene", hstsPreload],
    [SC, "Site hygiene", appsPdfs],
    [SC, "Site hygiene", a11y],
    ["since", "Over time", timeline],
    ["since", "Over time", changeCheck],
    ["limits", "Check settings", checkSettingsPanel],
    ["findings", "Checking a fix yourself", recheckNote],
  ]);
  // The topic tabs that have something to show, in this order.
  const topics = /** @type {[string, string][]} */ ([
    [S, "Search & AI"],
    [SP, "Speed"],
    [L, "Links"],
    [SC, "Site & content"],
  ]).filter(([id]) => tabs[id]);

  const html = pageHtml(m, {
    plan,
    diff,
    diffHtml,
    trafficFor,
    findingsHtml,
    decisionsHtml,
    decisionCount,
    changesHtml,
    passedHtml,
    limitsHtml,
    topics,
    tabs,
    overviewHtml: () => overviewHtml(m),
  });
  const md = mdFile
    ? markdown(m, {
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
      })
    : null;
  const { overall, verdict, unlock, openBlockers, open, countSev, fixed, checkSettings } = m;
  const receipt = [
    overall ? `SEO health score: ${overall.value}/100 (${bandOf(overall.value)[1]}). ${verdict}.` : verdict,
    unlock &&
      `Fixing the ${openBlockers.length === 1 ? "blocker" : `${openBlockers.length} blockers`} raises it to ${unlock.value}/100 (${bandOf(unlock.value)[1]}).`,
    `Open: ${open.length} (${SEV.map(s => `${countSev(s)} ${SEV_LABEL[s].toLowerCase()}`).join(", ")}) · fixed: ${fixed.length}${overall ? ` · rules passing: ${overall.passing} of ${overall.rules}` : ""}`,
    settingRows().length &&
      `Check settings (settings.json): ${settingsSummary()}. The score leaves turned-off checks out.`,
    ...checkSettings.warnings.map(w => `Settings warning: ${w}`),
  ].filter(Boolean);
  return { html, md, receipt };
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

// Exits 0 when written, 1 when only the PDF failed, 2 on a usage error or an input that's missing or isn't JSON.
const USAGE =
  "Usage: node render-report.mjs <audit.json|seo-crawl.json|content-scan.json> [--out report.html] [--md report.md] [--no-md] [--pdf]";
async function main(argv) {
  // The input file is the one word that isn't an option, wherever it sits (--out x.html audit.json works too).
  const args = parseArgs(argv, { flags: ["out", "md"], booleans: ["no-md", "pdf"], positionals: 1, usage: USAGE }),
    inPath = args._[0];
  if (!inPath || args.out === true || args.md === true) throw new Fail(USAGE);
  const outPath = resolve(args.out || inPath.replace(/\.json$/i, "") + ".html");
  const mdPath = args["no-md"] ? null : resolve(args.md || outPath.replace(/\.html?$/i, "") + ".md");
  const text = readFileSync(inPath, "utf8");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Fail(`render-report: ${inPath} isn't valid JSON (${e.message}).`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Fail(`render-report: ${inPath} isn't an audit: it should hold one JSON object (report-format.md).`);
  const { html, md, receipt } = render(raw, {
    dir: dirname(resolve(inPath)),
    mdFile: mdPath ? basename(mdPath) : null,
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  if (mdPath) writeFileSync(mdPath, md);
  const pdfPath = args.pdf ? outPath.replace(/\.html?$/i, "") + ".pdf" : null;
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
    return 1;
  }
}

if (isMain(import.meta.url)) await runMain(() => main(process.argv.slice(2)));
