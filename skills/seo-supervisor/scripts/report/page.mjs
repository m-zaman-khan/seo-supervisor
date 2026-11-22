// @ts-check
// The report page: one self-contained file with its fonts, styles and script inlined.
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { planStats, planHtml, PLAN_CSS } from "../report-plan.mjs";
import { VERSION } from "../update-check.mjs";
import { esc, inl, link, num, fmtDate, firstSentence } from "./format.mjs";
import { cardsHtml } from "./panel.mjs";

// Bundled woff2 fonts (SIL OFL), inlined so the report stays a single offline file.
const FONTS = [
  ["Geist", "geist.woff2", "100 900"],
  ["Geist Mono", "geist-mono.woff2", "100 900"],
  ["Bricolage Grotesque", "bricolage-grotesque.woff2", "200 800"],
];
const FONT_FACES = FONTS.map(([family, file, weight]) => {
  const path = new URL("../fonts/" + file, import.meta.url);
  if (!existsSync(path)) return "";
  return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${readFileSync(path).toString("base64")}) format("woff2");font-weight:${weight};font-style:normal;font-display:swap}`;
}).join("\n");

// client.js holds a __DEFAULT_TAB__ placeholder. Neither file can carry comments: every byte goes into the report.
const CSS = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
// LF line ends, as the browser reads them, so the script's hash matches even in a CRLF checkout.
const CLIENT_JS = readFileSync(new URL("./client.js", import.meta.url), "utf8").replace(/\r\n?/g, "\n");
// Applies a saved light theme before the first paint.
const HEAD_JS =
  "(function(h){h.classList.add('js');try{if(localStorage.getItem('seo-report-theme')==='light')h.dataset.theme='light'}catch(e){}})(document.documentElement)";
// Only the two hashed scripts run, styles are inline, fonts are data: URIs and nothing is fetched, so an injected
// script or a javascript: link can't run.
const hash = s => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;
const csp = scripts =>
  `default-src 'none'; script-src ${scripts.map(hash).join(" ")}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'`;

/**
 * Takes the model (model.mjs) with raw and mdFile, then each tab's HTML as a function and every tab's panels
 * (report/panel.mjs byTab).
 */
export function pageHtml(
  { raw, site, run, findings, fixed, passed, notChecked, mdFile },
  {
    plan,
    diff,
    overviewHtml,
    diffHtml,
    trafficFor,
    findingsHtml,
    decisionsHtml,
    decisionCount,
    changesHtml,
    passedHtml,
    limitsHtml,
    topics,
    tabs: panels,
  },
) {
  // Action first (Overview, Findings, Decisions), then the data, then the record (Changes, Passed, Limits).
  // markdown.mjs keeps this order.
  const tabs = [
    ["overview", "Overview", null],
    ["findings", "Findings", findings.length],
    ["decisions", "Decisions", decisionCount],
    ...topics.map(([id, label]) => [id, label, null]),
    ["changes", "Changes", fixed.length],
    ["passed", "Passed", passed.length + fixed.length],
    ["limits", "Limits", notChecked.length],
  ];
  if (diff || panels.since)
    tabs.splice(1, 0, ["diff", "Since last audit", diff ? (diff.regressions || []).length : null]);
  if (plan) tabs.splice(plan.status === "proposed" ? 0 : 1, 0, ["plan", "Plan", planStats(plan).rows]);
  const DEFAULT_TAB = tabs[0][0];
  const PANELS = {
    overview: overviewHtml,
    diff: () => `${diff ? diffHtml() : ""}${cardsHtml(panels.since)}`,
    plan: () => planHtml(plan, { esc, inl, num, traffic: u => trafficFor(u, true) }),
    findings: () => findingsHtml(cardsHtml(panels.findings)),
    decisions: decisionsHtml,
    changes: changesHtml,
    passed: passedHtml,
    limits: () => limitsHtml(cardsHtml(panels.limits)),
    ...Object.fromEntries(
      topics.map(([id]) => [
        id,
        () =>
          `<p class="quiet topic-note">Information only: nothing on this tab changes the score.</p>${cardsHtml(panels[id])}`,
      ]),
    ),
  };
  const metaBits = [
    site.url && link(site.url, esc(String(site.url).replace(/^https?:\/\//, ""))),
    run.pagesCrawled != null && `${num(run.pagesCrawled)} pages crawled`,
    esc(fmtDate(run.date)),
    run.mode === "fix" && "Includes fixes",
  ].filter(Boolean);

  // The hash covers the script's text as it sits between its tags, leading newline included.
  const JS = "\n" + CLIENT_JS.replace("__DEFAULT_TAB__", DEFAULT_TAB);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp([HEAD_JS, JS])}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark light">
<title>SEO report · ${esc(site.name)}</title>
<script>${HEAD_JS}</script>
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
<script>${JS}</script>
</body>
</html>
`;
}
