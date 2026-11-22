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
  // The health score is a local formula, and "How this score works" says so.
  const SCORE_IS_OURS = `This is ${OWN_SCORE}: it counts only the rules this audit checked, and search engines don't use it.`;
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

  // ---------- overview ----------
  function scoreScale(v) {
    /** @type {[number, number, string][]} */
    const segs = [
      [0, 40, "b1"],
      [40, 60, "b2"],
      [60, 75, "b3"],
      [75, 90, "b4"],
      [90, 100, "b5"],
    ];
    return `<div class="scale" role="img" aria-label="Score ${v} on a 0 to 100 scale: 0–39 critical, 40–59 poor, 60–74 fair, 75–89 good, 90–100 excellent">
    <div class="track">${segs.map(([a, b, c]) => `<span class="${c}" style="flex:${b - a}"></span>`).join("")}</div>
    <span class="marker" style="left:${v}%"><b>${v}</b></span>
    <div class="ticks">${[0, 40, 60, 75, 90, 100].map(t => `<span style="left:${t}%">${t}</span>`).join("")}</div>
  </div>`;
  }
  function unlockHtml(delta) {
    if (!unlock) return "";
    const [, name, cls] = bandOf(unlock.value);
    const ids = list => list.map(f => `<a href="#${esc(f.id)}">${esc(f.id)}</a>`).join(", ");
    const owner = openBlockers.filter(needsYou),
      agent = openBlockers.filter(f => !needsYou(f));
    const who = [
      owner.length &&
        `${ids(owner)} need${owner.length === 1 ? "s" : ""} you: the agent won't change ${owner.length === 1 ? "it" : "them"} without your go-ahead.`,
      agent.length && `${ids(agent)} can be fixed with <code>/seo-fix</code>.`,
    ]
      .filter(Boolean)
      .join(" ");
    return `<div class="unlock">
        <p class="u-k">Fix ${openBlockers.length === 1 ? "the blocker" : `the ${openBlockers.length} blockers`} and the score rises to</p>
        <p class="u-v"><span class="from">${overall.value}</span><span class="arrow" aria-hidden="true">→</span><span class="to ${cls}-t">${unlock.value}</span><span class="chip ${cls}">${name}</span></p>
        ${delta && delta.inUnlock ? `<p class="u-s delta ${delta.dir}">${delta.html}.</p>` : ""}
        ${who ? `<p class="u-s">${who}</p>` : ""}
      </div>`;
  }
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

  // One note on the re-check commands the finding cards show.
  const anyRecheck = () => findings.some(f => recheckOf(f));
  const recheckNoteHtml = () => (anyRecheck() ? `\n    <p class="quiet">${esc(RECHECK_NOTE)}</p>` : "");
  const recheckNoteMd = () => (anyRecheck() ? ["## Checking a fix yourself", "", RECHECK_NOTE, ""] : []);
  const panelsHtml = () =>
    [
      hstsPreloadHtml,
      crawlCoverageHtml,
      aiCrawlersHtml,
      productDataHtml,
      speedDetailsHtml,
      browserHtml,
      descriptionsHtml,
      localHtml,
      moreLinksHtml,
      connectionsHtml,
      timelineHtml,
      pageScoresHtml,
      linkIdeasHtml,
      changeCheckHtml,
      linkedOnceHtml,
      appsPdfsHtml,
      newSearchesHtml,
      checkSettingsHtml,
      recheckNoteHtml,
      a11yHtml,
      linkStrengthHtml,
      aiAnswersHtml,
      geoGridHtml,
    ]
      .map(f => f())
      .join("");
  const panelsMd = () =>
    [
      hstsPreloadMd,
      crawlCoverageMd,
      aiCrawlersMd,
      productDataMd,
      speedDetailsMd,
      browserMd,
      descriptionsMd,
      localMd,
      moreLinksMd,
      connectionsMd,
      timelineMd,
      pageScoresMd,
      linkIdeasMd,
      changeCheckMd,
      linkedOnceMd,
      appsPdfsMd,
      newSearchesMd,
      checkSettingsMd,
      recheckNoteMd,
      a11yMd,
      linkStrengthMd,
      aiAnswersMd,
      geoGridMd,
    ].flatMap(f => f());

  function overviewHtml() {
    if (!overall)
      return `<section class="panel empty-state"><h2>Nothing to score</h2><p>This file has no findings or passed rules. Run the audit to fill it.</p></section>`;
    const [, bandName, bandCls] = bandOf(overall.value);
    const capLine = overall.cap
      ? `${plural(overall.blockers, "open blocker")} hold${overall.blockers === 1 ? "s" : ""} the score at ${overall.cap} until fixed.`
      : `${overall.passing} of ${overall.rules} checked rules pass in full.`;
    const delta = deltaOf();
    const sevBar = SEV.map(s => [s, countSev(s)]).filter(([, n]) => n);
    const totalOpen = open.length;
    const fixFirst = open.filter(f => ["blocker", "high", "needs-decision"].includes(f.severity)).slice(0, 5);
    const fallbackFirst = fixFirst.length ? fixFirst : open.slice(0, 3);
    return `
  <div class="ov-top">
    <div class="ov-left">
    <section class="panel score-panel" aria-labelledby="h-score">
      <h2 id="h-score">SEO health score</h2>
      <p class="big ${bandCls}-t"><span class="n">${overall.value}</span><span class="of">/100</span></p>
      <p class="band"><span class="chip ${bandCls}">${bandName}</span><span class="verdict">${esc(verdict)}</span></p>
      ${scoreScale(overall.value)}
      <p class="cap">${esc(capLine)}</p>
      ${unlockHtml(delta)}
      ${delta && !delta.inUnlock ? `<p class="delta ${delta.dir}">${delta.html}</p>` : ""}
      <details class="how"><summary>How this score works</summary>
        <p>Every checked rule is worth 10 points. A rule that passes, or whose findings are all fixed, earns 10. A rule with open findings earns by its worst one: low 8, medium or decision 6, high 3, blocker 0. The score is the share of points earned. Each open blocker caps it: one at 59, two at 49, three at 39. While a blocker is open, the panel also shows the score you reach once it is fixed. Area scores use the same rules within each area. ${SCORE_IS_OURS}</p>
      </details>
    </section>
    <section class="panel stats" aria-label="Issues, fixes and rules">
      <div class="stat">
        <h3>Open issues</h3>
        <p class="stat-n"><span class="n">${totalOpen}</span>${totalOpen ? "" : " · nothing open"}</p>
        ${
          totalOpen
            ? `<div class="stack" role="img" aria-label="${sevBar.map(([sv, n]) => `${n} ${SEV_LABEL[sv]}`).join(", ")}">${sevBar.map(([sv, n]) => `<span class="s-${sv}" style="flex:${n}"></span>`).join("")}</div>
        <ul class="legend">${sevBar.map(([sv, n]) => `<li>${dot(sv)}<span>${SEV_LABEL[sv]}</span><b>${n}</b></li>`).join("")}</ul>`
            : ""
        }
      </div>
      <div class="stat">
        <h3>Fixed this run</h3>
        <p class="stat-n"><span class="n">${fixed.length}</span> of ${findings.length}</p>
        <div class="stack" role="img" aria-label="${fixed.length} fixed, ${open.length} still open"><span class="s-fixed" style="flex:${fixed.length || 0.0001}"></span><span class="s-rest" style="flex:${open.length || 0.0001}"></span></div>
        <p class="quiet">${fixed.length ? `${num(open.length)} still open` : "Run /seo-fix to start"}</p>
      </div>
      <div class="stat">
        <h3>Rules checked</h3>
        <p class="stat-n"><span class="n">${overall.passing}</span> of ${overall.rules} pass</p>
        <div class="stack" role="img" aria-label="${overall.passing} pass, ${overall.rules - overall.passing} with open findings"><span class="s-pass" style="flex:${overall.passing || 0.0001}"></span><span class="s-fail" style="flex:${overall.rules - overall.passing || 0.0001}"></span></div>
        <p class="quiet"><span class="key k-fail" aria-hidden="true"></span>${num(overall.rules - overall.passing)} failing${notChecked.length ? ` · ${num(notChecked.length)} not checked` : ""}</p>
      </div>
    </section>
    ${speedText() ? `<p class="quiet">${esc(speedText())}</p>` : ""}${labSpeedText() ? `\n    <p class="quiet">${esc(labSpeedText())}</p>` : ""}${lcpText() ? `\n    <p class="quiet">${esc(lcpText())}</p>` : ""}${lighthouseText() ? `\n    <p class="quiet">${esc(lighthouseText())}</p>` : ""}${authorityText() ? `\n    <p class="quiet">${esc(authorityText())}${ahrefsCredit() ? ` · <a href="${esc(ahrefsCredit().url)}" rel="noopener">${esc(ahrefsCredit().text)}</a>` : ""}</p>` : ""}${desktopSpeedText() ? `\n    <p class="quiet">${esc(desktopSpeedText())}</p>` : ""}${positionsText() ? `\n    <p class="quiet">${esc(positionsText())}</p>` : ""}${analyticsSplitLines()
      .map(t => `\n    <p class="quiet">${esc(t)}</p>`)
      .join("")}
    ${googleUpdatesText() ? `<p class="quiet">${googleUpdatesText(true)}</p>\n    ` : ""}</div>
    <div class="ov-right">
    <section class="panel factors" aria-labelledby="h-factors">
      <div class="ph"><h2 id="h-factors">What's moving your score</h2><span class="sub">Points lost, biggest first</span></div>
      <ol class="area-list">${(() => {
        const maxPts = Math.max(impact.cap, ...impact.rows.map(x => x.pts), 1);
        const bar = pts =>
          `<span class="meter" aria-hidden="true"><i style="width:${Math.max(4, (100 * pts) / maxPts)}%"></i></span>`;
        const rows = [];
        if (impact.cap > 0)
          rows.push(`<li><a class="area" href="#findings" data-sev="blocker">${dot("blocker")}
          <span class="an"><b>Blocker cap</b><span class="reason">${plural(overall.blockers, "open blocker")} hold${overall.blockers === 1 ? "s" : ""} the score at ${overall.cap} until fixed</span></span>
          ${bar(impact.cap)}<span class="as">−${impact.cap}<small>pts</small></span></a></li>`);
        for (const { a, pts } of impact.rows) {
          const line = a.top.length
            ? `${inl(a.top[0].title)}${a.top.length > 1 ? ` <span class="more">+${a.top.length - 1} more</span>` : ""}`
            : "All checks pass";
          rows.push(`<li><a class="area" href="#findings" data-area="${esc(a.name)}">${a.worst ? dot(a.worst) : `<i class="dot d-pass" aria-hidden="true"></i>`}
          <span class="an"><b>${esc(a.name)} <span class="ascore">${a.value}/100</span></b><span>${line}</span></span>
          ${bar(pts)}<span class="as">${pts ? `−${pts}` : "<1"}<small>pts</small></span></a></li>`);
        }
        const full = areas.filter(a => a.value === 100);
        if (full.length) {
          const fx = full.reduce((t, a) => t + a.fixedHere, 0);
          rows.push(`<li><a class="area" href="#passed"><i class="dot d-pass" aria-hidden="true"></i>
          <span class="an"><b>${plural(full.length, "area")} pass in full</b><span>${esc(full.map(a => a.name).join(", "))}${fx ? ` · ${fx} fixed this run` : ""}</span></span>
          <span class="meter" aria-hidden="true"></span><span class="as ok">0<small>pts</small></span></a></li>`);
        }
        return rows.join("");
      })()}</ol>
    </section>${viewsHtml()}${searchLines()
      .map(t => `\n    <p class="quiet">${esc(t)}</p>`)
      .join(
        "",
      )}${linksHtml()}${agentsHtml()}${writingHtml()}${audienceHtml()}${imagesHtml()}${lighthouseDetailHtml()}${panelsHtml()}
    </div>
  </div>
  ${
    fallbackFirst.length
      ? `<section class="panel fixfirst" aria-labelledby="h-first">
    <div class="ph"><h2 id="h-first">Fix first</h2><a class="link" href="#findings">All findings ${ICON.arrow}</a></div>
    <ol>${fallbackFirst.map(f => `<li><a href="#${esc(f.id)}">${dot(f.severity)}<span class="sev-t">${SEV_LABEL[f.severity]}</span><span class="t">${inl(f.title)}${needsYou(f) ? ` <span class="own">Needs you</span>` : ""}</span><span class="c">${esc(f.category)}</span>${ICON.arrow}</a></li>`).join("")}</ol>
  </section>`
      : ""
  }
`;
  }

  // ---------- findings ----------
  // A finding's optional effort; an unknown value shows nothing.
  const EFFORT = { quick: "under 30 minutes", hours: "an hour or two", "half-day": "half a day or more" };
  const effortOf = f =>
    typeof f.effort === "string" && Object.hasOwn(EFFORT, f.effort) ? `Effort: ${EFFORT[f.effort]}` : "";
  // A command that shows whether the fix worked (lib/recheck.mjs). Its URL may come from the crawl, so it's escaped.
  const recheckHtml = f => {
    const r = recheckOf(f);
    return r
      ? `<div class="ev recheck"><h4>Check the fix yourself</h4><p><code>${esc(r.command)}</code></p><p class="quiet">${esc(r.hint)}</p></div>`
      : "";
  };
  function evidenceHtml(f) {
    const ev = f.evidence || [];
    if (!ev.length) return "";
    const shown = ev.slice(0, 10);
    const listedRest = ev.length - shown.length;
    const total = Math.max(f.count || 0, ev.length);
    const notes = [];
    if (listedRest > 0)
      notes.push(
        `${num(listedRest)} more ${listedRest === 1 ? "example" : "examples"}${mdFile ? ` in <code>${esc(mdFile)}</code>` : ""}`,
      );
    if (total > ev.length) notes.push(`${num(total)} cases found in total; these are examples`);
    return `<div class="ev"><h4>Evidence</h4><div class="tablewrap"><table><thead><tr><th scope="col">Where</th><th scope="col">Detail</th></tr></thead><tbody>${shown.map(e => `<tr><td>${e.url ? `<a href="${esc(e.url)}" rel="noopener">${esc(e.url)}</a>` : ""}${e.file ? `${e.url ? "<br>" : ""}<code>${esc(e.file)}${e.line ? ":" + esc(e.line) : ""}</code>` : ""}</td><td>${inl(e.detail || "")}</td></tr>`).join("")}</tbody></table></div>${notes.length ? `<p class="quiet">${notes.join(". ")}.</p>` : ""}</div>`;
  }
  function findingHtml(f) {
    const isFixed = !isOpen(f);
    return `<article class="f ${isFixed ? "is-fixed" : ""}" id="${esc(f.id)}" data-sev="${f.severity}" data-status="${esc(f.status)}" data-area="${esc(f.category)}" data-text="${esc([f.id, f.rule, f.title, f.what, f.category].join(" ").toLowerCase())}">
    <h3><button class="f-head" aria-expanded="false" aria-controls="${esc(f.id)}-b">
      ${dot(f.severity)}
      <span class="f-title">${inl(f.title)}</span>
      <span class="f-meta"><span class="sev-t">${SEV_LABEL[f.severity]}</span>${needsYou(f) ? `<span class="own">Needs you</span>` : ""}<span>${esc(f.category)}</span>${f.rule ? `<span class="mono">${esc(f.rule)}</span>` : ""}${f.count > 1 ? `<span class="mono">${num(f.count)}×</span>` : ""}${effortOf(f) ? `<span>${esc(effortOf(f))}</span>` : ""}</span>
      ${isFixed ? `<span class="stamp">${ICON.check}Fixed</span>` : `<span class="st st-${esc(f.status)}">${esc(STATUS_LABEL[f.status] || f.status)}</span>`}
      ${ICON.chevron}
    </button></h3>
    <div class="f-body" id="${esc(f.id)}-b" role="region" aria-label="${esc(f.title)}">
      <div class="f-cols">
        <div>
          ${f.what ? `<h4>What's wrong</h4><p>${inl(f.what)}</p>` : ""}
          ${f.why ? `<h4>Why it matters</h4><p>${inl(f.why)}</p>` : ""}
        </div>
        <div>
          ${f.fix ? `<div class="howfix"><h4>How to fix</h4><p>${inl(f.fix)}</p></div>` : ""}
          ${f.decision ? `<div class="dec-inline"><h4>Decision needed</h4><p>${inl(f.decision.question || "")}</p>${(f.decision.options || []).length ? `<ul>${f.decision.options.map(o => `<li>${inl(o)}</li>`).join("")}</ul>` : ""}${f.decision.recommendation ? `<p><strong>Recommended:</strong> ${inl(f.decision.recommendation)}</p>` : ""}</div>` : ""}
          ${isFixed && f.fixed ? `<div class="donebox"><h4>What was done</h4><p>${inl(f.fixed.summary || "")}</p>${(f.fixed.files || []).length ? `<p class="files">${f.fixed.files.map(x => `<code>${esc(x)}</code>`).join(" ")}</p>` : ""}${f.fixed.verified ? `<p class="quiet">${ICON.check} ${inl(f.fixed.verified)}</p>` : ""}</div>` : ""}
        </div>
      </div>
      ${trafficHtml(f)}${clarityHtml(f)}${evidenceHtml(f)}${recheckHtml(f)}
    </div>
  </article>`;
  }
  function findingsHtml() {
    if (!findings.length)
      return `<section class="panel empty-state"><h2>No findings</h2><p>Every checked rule passed. See Passed for what was checked and Limits for what wasn't.</p></section>`;
    const sevPresent = SEV.filter(s => findings.some(f => f.severity === s));
    const areasPresent = [...new Set(findings.map(f => f.category))].sort();
    const statuses = [...new Set(findings.map(f => f.status))];
    return `<div class="toolbar" role="group" aria-label="Filter findings">
      <label class="search">${ICON.search}<span class="sr">Search findings</span><input type="search" id="q" placeholder="Search title, rule or ID" autocomplete="off"></label>
      <div class="seg" role="group" aria-label="Severity"><button type="button" class="segb" data-sev="all" aria-pressed="true">All</button>${sevPresent.map(s => `<button type="button" class="segb" data-sev="${s}" aria-pressed="false">${dot(s)}${SEV_LABEL[s]}<span class="mono">${findings.filter(f => f.severity === s).length}</span></button>`).join("")}</div>
      <label class="sel"><span class="sr">Status</span><select id="fstatus"><option value="all">Any status</option>${statuses.map(s => `<option value="${esc(s)}">${esc(STATUS_LABEL[s] || s)}</option>`).join("")}</select></label>
      <label class="sel"><span class="sr">Area</span><select id="farea"><option value="all">All areas</option>${areasPresent.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("")}</select></label>
      <p class="showing" id="showing" aria-live="polite">${findings.length} findings</p>
    </div>
    <div class="flist" id="flist">${findings.map(findingHtml).join("")}</div>
    <p class="empty" id="fnone" hidden>No findings match these filters. <button type="button" class="link" id="freset">Clear filters</button></p>`;
  }

  // ---------- other tabs ----------
  const decisionsHtml = () =>
    decisions.length
      ? `<div class="cards">${decisions
          .map(
            d => `<article class="panel dcard">
    ${d.id ? `<a class="mono idlink" href="#${esc(d.id)}">${esc(d.id)}</a>` : ""}
    <h3>${inl(d.question)}</h3>${d.context ? `<p>${inl(d.context)}</p>` : ""}
    ${(d.options || []).length ? `<ul class="opts">${d.options.map(o => `<li>${inl(o)}</li>`).join("")}</ul>` : ""}
    ${d.recommendation ? `<p class="rec"><strong>Recommended</strong> ${inl(d.recommendation)}</p>` : ""}
  </article>`,
          )
          .join("")}</div>`
      : `<section class="panel empty-state"><h2>No decisions needed</h2><p>Nothing in this audit needs an owner's call.</p></section>`;
  const changesHtml = () =>
    fixed.length
      ? `<ol class="changes">${fixed
          .map(
            f => `<li class="panel">
    <span class="stamp">${ICON.check}Fixed</span>
    <div><h3><a href="#${esc(f.id)}">${inl(f.title)}</a></h3>
    ${f.fixed?.summary ? `<p>${inl(f.fixed.summary)}</p>` : ""}
    ${(f.fixed?.files || []).length ? `<p class="files">${f.fixed.files.map(x => `<code>${esc(x)}</code>`).join(" ")}</p>` : ""}
    ${f.fixed?.verified ? `<p class="quiet">${ICON.check} ${inl(f.fixed.verified)}</p>` : ""}</div>
    <span class="mono quiet">${esc(f.id)}</span>
  </li>`,
          )
          .join("")}</ol>`
      : `<section class="panel empty-state"><h2>No changes yet</h2><p>Run <code>/seo-fix</code> to fix findings. Each fix is re-checked and listed here with the files it touched.</p></section>`;
  function passedHtml() {
    const fixedRules = fixed.map(f => ({
      rule: f.rule || f.id,
      title: f.title,
      category: f.category,
      detail: "fixed this run",
    }));
    const all = [...passed, ...fixedRules.filter(x => !passed.some(p => p.rule === x.rule))];
    if (!all.length)
      return `<section class="panel empty-state"><h2>No passed rules recorded</h2><p>This file lists findings only.</p></section>`;
    const groups = all.reduce((m, p) => ((m[p.category || "Other"] ||= []).push(p), m), {});
    return `<div class="pgrid">${Object.entries(groups)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([c, ps]) =>
          `<section class="panel pgroup"><h3>${esc(c)}<span class="mono quiet">${ps.length}</span></h3><ul>${ps.map(p => `<li>${ICON.check}<span><span class="mono quiet">${esc(p.rule)}</span> ${inl(p.title)}${p.detail ? `<span class="quiet"> · ${inl(p.detail)}</span>` : ""}</span></li>`).join("")}</ul></section>`,
      )
      .join("")}</div>`;
  }
  const limitsHtml = () =>
    notChecked.length || notes.length
      ? `<div class="limits">
  ${notChecked.length ? `<section class="panel"><h2>Not checked</h2><p class="quiet">These couldn't be verified in this run, so they count neither for nor against the score.</p><ul class="lim">${notChecked.map(n => `<li><b>${inl(n.area || n.rule || "")}</b><span>${inl(n.reason || "")}</span></li>`).join("")}</ul></section>` : ""}
  ${notes.length ? `<section class="panel"><h2>Notes from the audit</h2><ul class="lim">${notes.map(n => `<li><span>${inl(n)}</span></li>`).join("")}</ul></section>` : ""}
</div>`
      : `<section class="panel empty-state"><h2>No limits recorded</h2><p>Every planned check ran.</p></section>`; // adds the result files beside the audit
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
    overview: overviewHtml,
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
      L.push(
        ...linksMd(),
        ...agentsMd(),
        ...writingMd(),
        ...audienceMd(),
        ...imagesMd(),
        ...lighthouseDetailMd(),
        ...panelsMd(),
      );
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
