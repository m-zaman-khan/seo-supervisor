#!/usr/bin/env node
// @ts-check
// Renders an audit JSON (or raw seo-crawl / content-scan output) as one self-contained HTML page that makes no network
// requests, plus a Markdown copy with every finding in full. The JSON shape and score model are in ../report-format.md.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { SEV, bandOf } from "./lib/score.mjs";
import { isMain } from "./lib/is-main.mjs";
import { Fail, runMain } from "./lib/cli.mjs";
import { SEV_LABEL } from "./report/format.mjs";
import { buildModel } from "./report/model.mjs";
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
import { overviewHtml } from "./report/overview.mjs";
import { pageHtml } from "./report/page.mjs";
import { markdown } from "./report/markdown.mjs";

/**
 * Builds the report as text and writes nothing.
 * @param {any} raw the parsed JSON
 * @param {{ dir?: string, mdFile?: string | null }} [opts] dir: the audit's folder, whose settings.json applies;
 *   mdFile: the Markdown file's name for the page to mention, or null for no Markdown (md is then null too)
 * @returns {{ html: string, md: string | null, receipt: string[] }} receipt: the lines printed before "Wrote:"
 */
export function render(raw, { dir = process.cwd(), mdFile = null } = {}) {
  const m = { raw, mdFile, ...buildModel(raw, dir) };
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
  const { findingsHtml, decisionsHtml, changesHtml, passedHtml, limitsHtml, recheckNoteHtml, recheckNoteMd } =
    findingTabs(m, { trafficHtml, clarityHtml });
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
  const { agentsHtml, agentsMd, aiCrawlersHtml, aiCrawlersMd, aiAnswersHtml, aiAnswersMd } = aiPanels(m);
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
  const { localHtml, localMd, geoGridHtml, geoGridMd } = localPanels(m);
  const { connectionsHtml, connectionsMd, changeCheckHtml, changeCheckMd, newSearchesHtml, newSearchesMd } =
    connectionPanels(m);
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
    panelsMd = () => panels.flatMap(([, md]) => md());

  const html = pageHtml(m, {
    plan,
    diff,
    diffHtml,
    trafficFor,
    findingsHtml,
    decisionsHtml,
    changesHtml,
    passedHtml,
    limitsHtml,
    overviewHtml: () =>
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
  });
  const md = mdFile
    ? markdown(m, {
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
  const inPath = argv.find(a => !a.startsWith("--"));
  if (!inPath) throw new Fail(USAGE);
  const opt = k => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : null;
  };
  const outPath = resolve(opt("--out") || inPath.replace(/\.json$/i, "") + ".html");
  const mdPath = argv.includes("--no-md") ? null : resolve(opt("--md") || outPath.replace(/\.html?$/i, "") + ".md");
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
    return 1;
  }
}

if (isMain(import.meta.url)) await runMain(() => main(process.argv.slice(2)));
