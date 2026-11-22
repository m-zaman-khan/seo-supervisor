#!/usr/bin/env node
// @ts-check
// Renders an audit JSON (or raw seo-crawl / content-scan output) as one self-contained HTML page that makes no network
// requests, plus a Markdown copy with every finding in full. The JSON shape and score model are in ../report-format.md.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { planStats, planHtml, planMarkdown, PLAN_CSS } from "./report-plan.mjs";
import { band } from "./checks/speed.mjs";
import { VERSION } from "./update-check.mjs";
import { SEV, isOpen, score, bandOf, OWN_SCORE } from "./lib/score.mjs";
import { recheckOf, RECHECK_NOTE } from "./lib/recheck.mjs";
import { isMain } from "./lib/is-main.mjs";
import { buildModel, needsYou } from "./report/model.mjs";
import { overviewLines, LCP_PART } from "./report/overview-lines.mjs";
import { searchTraffic, visitsOf, isoDates, byPath } from "./report/traffic.mjs";
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

  const traffic = obj(raw.traffic),
    bing = obj(raw.bing),
    matomo = obj(raw.matomo),
    posthog = obj(raw.posthog);
  const linked = Array.isArray(bing?.backlinks?.pages) ? bing.backlinks.pages.filter(obj) : [];
  const topLinked = [...linked].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0)).slice(0, 10);
  const linkSample = (Array.isArray(bing?.backlinks?.sample) ? bing.backlinks.sample.filter(obj) : []).slice(0, 5);
  const bingLinks = topLinked.length || linkSample.length;
  // backlinks.mjs: whether known links from other sites are still there. Third-party URLs, escaped where shown.
  const linkCheck = obj(raw.backlinks),
    checkedLinks = Number(linkCheck?.checked) || 0;
  const goneLinks = Array.isArray(linkCheck?.gone) ? linkCheck.gone.filter(obj) : [];
  const linkCheckLine = checkedLinks
    ? `${num(Number(linkCheck.live) || 0)} of ${num(checkedLinks)} known ${checkedLinks === 1 ? "link is" : "links are"} still there; ${num(goneLinks.length)} gone; ${num(Array.isArray(linkCheck.unreachable) ? linkCheck.unreachable.filter(obj).length : 0)} couldn't be checked`
    : "";
  const linkCount = p => plural(Number(p.count) || 0, "link");
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

  // ---------- breadth panels: an empty one adds nothing to the output ----------
  // Score views: trust signals, Local SEO, Content quality.
  // The trust view is found ÷ applicable signals × 100 (checks/trust.mjs); missing signals are suggestions, not
  // findings. Local SEO and Content quality are the "Local business" and "Headings & content" area scores renamed, each
  // shown only when its area has checked rules. Without trust data there's no panel.
  const trustScore = signals => {
    const on = signals.filter(s => s.applies),
      found = on.filter(s => s.found).length;
    return {
      value: on.length ? Math.round((100 * found) / on.length) : null,
      found,
      applicable: on.length,
      missing: on.filter(s => !s.found),
    };
  };
  const trustList = Array.isArray(raw.trustSignals) ? raw.trustSignals.filter(obj) : null;
  const NOT_GOOGLE = "SEO Supervisor's own check, not a Google score";
  const labelOf = s => String(s.label || s.id || "");
  function viewsOf() {
    if (!trustList) return null;
    const t = trustScore(trustList),
      list = [
        ["Local SEO", "Local business"],
        ["Content quality", "Headings & content"],
      ]
        .map(([label, name]) => ({ label, a: areas.find(a => a.name === name) }))
        .filter(v => v.a);
    const lc = s => (/^\p{Lu}\p{Ll}/u.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
    const line = `${t.found} of ${t.applicable} signals found${t.missing.length ? ` · missing: ${t.missing.map(s => lc(labelOf(s))).join(", ")}` : ""}`;
    return t.value == null && !list.length ? null : { t, list, line };
  }
  const viewsHtml = () => {
    const v = viewsOf();
    if (!v) return "";
    const pass = `<i class="dot d-pass" aria-hidden="true"></i>`;
    const row = (tag, attrs, d, name, lines, value) => `<li><${tag} class="area"${attrs}>${d}
          <span class="an"><b>${name}</b>${lines}</span>
          <span class="meter" aria-hidden="true"><i style="width:${Math.max(4, value)}%"></i></span><span class="as">${value}<small>/100</small></span></${tag}></li>`;
    const rows = [
      ...(v.t.value == null
        ? []
        : [
            row(
              "div",
              "",
              v.t.missing.length ? dot("low") : pass,
              "Trust signals (E-E-A-T)",
              `<span class="reason">${esc(v.line)}</span><span class="reason">${esc(NOT_GOOGLE)}</span>`,
              v.t.value,
            ),
          ]),
      ...v.list.map(({ label, a }) =>
        row(
          "a",
          ` href="#findings" data-area="${esc(a.name)}"`,
          a.worst ? dot(a.worst) : pass,
          esc(label),
          `<span>${esc(a.name)} area · ${a.top.length ? inl(a.top[0].title) : "All checks pass"}</span>`,
          a.value,
        ),
      ),
    ];
    const add = v.t.missing.length
      ? `
      <details class="how"><summary>What to add for trust</summary><p>Suggestions, not findings: they never change the SEO health score, and not every signal fits every site.</p><ul class="lim">${v.t.missing.map(s => `<li><b>${esc(labelOf(s))}</b><span>${inl(s.add || "")}${s.rule ? ` See ${esc(s.rule)}.` : ""}</span></li>`).join("")}</ul></details>`
      : "";
    return `
    <section class="panel factors" aria-labelledby="h-views">
      <div class="ph"><h2 id="h-views">Score views</h2><span class="sub">The audit read another way</span></div>
      <ol class="area-list">${rows.join("")}</ol>${add}
    </section>`;
  };
  const viewsMd = () => {
    const v = viewsOf();
    if (!v) return [];
    const md = s =>
      String(s ?? "")
        .replace(/\s+/g, " ")
        .replace(/[\\`*_[\]<>|]/g, "\\$&"); // crawled text: names, links, dates
    const found = trustList.filter(s => s.applies && s.found);
    return [
      "## Score views",
      "",
      "| View | Score | What it is |",
      "| --- | ---: | --- |",
      ...(v.t.value == null ? [] : [`| Trust signals (E-E-A-T) | ${v.t.value}/100 | ${md(v.line)}. ${NOT_GOOGLE} |`]),
      ...v.list.map(({ label, a }) => `| ${label} | ${a.value}/100 | The ${md(a.name)} area's score |`),
      "",
      ...(v.t.missing.length
        ? [
            "Trust signals to add. They're suggestions, not findings: they never change the score, and not every signal fits every site.",
            "",
            ...v.t.missing.map(s => `- **${md(labelOf(s))}:** ${s.add || ""}${s.rule ? ` See ${md(s.rule)}.` : ""}`),
            "",
          ]
        : []),
      ...(found.length
        ? ["Trust signals found:", "", ...found.map(s => `- **${md(labelOf(s))}:** ${md(s.evidence || "found")}`), ""]
        : []),
    ];
  };

  // Links from other sites and their change since the last audit, in one collapsed panel on the Overview (a section
  // in the Markdown): links-import.mjs's summary of the Search Console exports, then backlinks.mjs's check and Bing's
  // lists. Domains, URLs and counts come from other sites, so they're escaped where shown.
  const scLinks = obj(raw.links),
    scRows = (k, f) =>
      Array.isArray(scLinks?.[k]) ? scLinks[k].filter(x => obj(x) && typeof x[f] === "string" && x[f]) : [];
  const scSites = scRows("sites", "domain"),
    scPages = scRows("pages", "url");
  const scMix = (m =>
    m && ["brand", "address", "generic", "other"].every(k => Number.isFinite(m[k]) && m[k] >= 0 && m[k] <= 1)
      ? m
      : null)(obj(raw.anchorMix));
  const hasSc = !!(scSites.length || scPages.length || scMix),
    linkSources = [hasSc && "Search Console", bingLinks && "Bing"].filter(Boolean).join(" and ");
  // Search Console's tables export at most 1,000 rows, so 1,000 may be more.
  // https://support.google.com/webmasters/answer/9049606
  const scUpTo = n => (n >= 1000 ? "1,000 or more" : num(n));
  const scLine = () => {
    const parts = [
      scSites.length && `${scUpTo(scSites.length)} site${scSites.length === 1 ? " links" : "s link"} to you`,
      scPages.length && `${scUpTo(scPages.length)} of your pages ${scPages.length === 1 ? "has" : "have"} links`,
    ].filter(Boolean);
    return parts.length
      ? `Search Console${Date.parse(scLinks.when) ? ` (export of ${fmtDate(scLinks.when)})` : ""}: ${parts.join(" · ")}`
      : "";
  };
  const scPct = x => `${Math.round(x * 100)}%`;
  const scMixLine = () =>
    `Link text: your brand ${scPct(scMix.brand)} · web address ${scPct(scMix.address)} · generic, like “click here”, ${scPct(scMix.generic)} · other ${scPct(scMix.other)}.`;
  const scInfoLine = () =>
    `${scMix ? "A natural mix is mostly your brand, your web address and words that say what the page is about. " : ""}Information only: it doesn't change the score.`;
  const scCount = x => (Number.isFinite(x.links) ? plural(x.links, "link") : "");
  const scList = (list, f) =>
    `<ul class="lim">${list
      .slice(0, 5)
      .map(x => `<li><b><code>${esc(x[f])}</code></b><span>${scCount(x)}</span></li>`)
      .join("")}</ul>`;
  // worthALook (links-import.mjs): standout links, each with why and what to look at.
  const looks = (Array.isArray(raw.worthALook) ? raw.worthALook : [])
    .filter(x => obj(x) && ["subject", "why", "look"].every(k => typeof x[k] === "string" && x[k]))
    .slice(0, 10);
  const lookEx = x => (Array.isArray(x.examples) ? x.examples.filter(e => typeof e === "string" && e).slice(0, 5) : []);
  const LOOK_INTRO = "Worth a look: links that stand out. It isn't a score or a finding, and most turn out to be fine.";
  const looksHtml = () =>
    looks.length
      ? `<p>${esc(LOOK_INTRO)}</p><ul class="lim">${looks
          .map(
            x =>
              `<li><b>${esc(x.subject)}</b><span>${esc(x.why)} ${esc(x.look)}${
                lookEx(x).length
                  ? ` For example: ${lookEx(x)
                      .map(e => `<code>${esc(e)}</code>`)
                      .join(", ")}`
                  : ""
              }</span></li>`,
          )
          .join("")}</ul>`
      : "";
  const linksHtml = () =>
    hasSc || bingLinks || linkCheckLine || looks.length
      ? `
    <details class="how links"><summary>Links from other sites${linkSources ? ` (${linkSources})` : ""}</summary>${scLine() ? `<p>${esc(scLine())}</p>` : ""}${scSites.length ? `<p>The sites with the most links to you:</p>${scList(scSites, "domain")}` : ""}${scPages.length ? `<p>Your most-linked pages in Search Console:</p>${scList(scPages, "url")}` : ""}${scMix ? `<p>${esc(scMixLine())}</p>` : ""}${hasSc ? `<p>${esc(scInfoLine())}</p>` : ""}${looksHtml()}${
      linkCheckLine
        ? `<p>${esc(linkCheckLine)}</p>${
            goneLinks.length
              ? `<ul class="lim">${goneLinks
                  .slice(0, 10)
                  .map(g => `<li><b><code>${esc(g.url)}</code></b><span>${esc(g.reason)}</span></li>`)
                  .join("")}</ul>`
              : ""
          }`
        : ""
    }${topLinked.length ? `<p>${hasSc ? "Your most-linked pages in Bing:" : "The pages with the most links from other sites:"}</p><ul class="lim">${topLinked.map(p => `<li><b><code>${esc(p.url)}</code></b><span>${linkCount(p)}</span></li>`).join("")}</ul>` : ""}${linkSample.length ? `<p>${hasSc ? "Some of Bing's links to the home page:" : "Some of the links to the home page:"}</p><ul class="lim">${linkSample.map(s => `<li><b><code>${esc(s.url)}</code></b><span>${esc(s.anchorText || "")}</span></li>`).join("")}</ul>` : ""}</details>`
      : "";
  const linksMd = () => {
    if (!(hasSc || bingLinks || linkCheckLine || looks.length)) return [];
    // The same as markdown()'s mdCode and mdText: other sites' addresses as code, their text escaped.
    const code = s => "`" + String(s ?? "").replace(/[`\r\n]/g, " ") + "`",
      text = s =>
        String(s ?? "")
          .replace(/\s+/g, " ")
          .replace(/[\\`*_[\]<>]/g, "\\$&");
    const list = (l, f) => l.slice(0, 5).map(x => `- ${code(x[f])}${scCount(x) ? ` ${scCount(x)}` : ""}`);
    return [
      `## Links from other sites${linkSources ? ` (${linkSources})` : ""}`,
      "",
      ...(scLine() ? [scLine(), ""] : []),
      ...(scSites.length ? ["The sites with the most links to you:", "", ...list(scSites, "domain"), ""] : []),
      ...(scPages.length ? ["Your most-linked pages in Search Console:", "", ...list(scPages, "url"), ""] : []),
      ...(scMix ? [scMixLine(), ""] : []),
      ...(hasSc ? [scInfoLine(), ""] : []),
      ...(looks.length
        ? [
            LOOK_INTRO,
            "",
            ...looks.map(
              x =>
                `- **${text(x.subject)}**: ${text(x.why)} ${text(x.look)}${lookEx(x).length ? ` For example: ${lookEx(x).map(code).join(", ")}` : ""}`,
            ),
            "",
          ]
        : []),
      ...(linkCheckLine
        ? [
            linkCheckLine,
            "",
            ...goneLinks.slice(0, 10).map(g => `- ${code(g.url)} ${text(g.reason)}`),
            ...(goneLinks.length ? [""] : []),
          ]
        : []),
      ...(topLinked.length
        ? [
            hasSc ? "Your most-linked pages in Bing:" : "The pages with the most links from other sites:",
            "",
            ...topLinked.map(p => `- ${code(p.url)} ${linkCount(p)}`),
            "",
          ]
        : []),
      ...(linkSample.length
        ? [
            hasSc ? "Some of Bing's links to the home page:" : "Some of the links to the home page:",
            "",
            ...linkSample.map(s => `- ${code(s.url)}${s.anchorText ? ` ${text(s.anchorText)}` : ""}`),
            "",
          ]
        : []),
    ];
  };
  // links-import.mjs computes links-dropped, as only it has both audits' links.json summaries.
  const LINKS_DROP = {
    sites: "Sites linking to you (Search Console)",
    bingPages: "Your pages with links from other sites (Bing)",
  };
  const linksDrop = (c =>
    c &&
    c.kind === "links-dropped" &&
    Object.hasOwn(LINKS_DROP, c.what) &&
    [c.before, c.after].every(n => Number.isInteger(n) && n >= 0) &&
    c.after < c.before
      ? c
      : null)(obj(raw.linksChange));
  const linksDropText = () =>
    `${num(linksDrop.before)} → ${num(linksDrop.after)} (−${Math.round((100 * (linksDrop.before - linksDrop.after)) / linksDrop.before)}%) since the last audit. Information only: it doesn't change the score. To find which links went, run the backlink check (backlinks.mjs) on Search Console's Latest links export or Bing's sample: it lists the links that are gone.`;
  const linksDiffHtml = () =>
    linksDrop
      ? `\n  <section class="panel"><h2>Links dropped</h2><ul class="lim"><li><b>${LINKS_DROP[linksDrop.what]}</b><span>${esc(linksDropText())}</span></li></ul></section>`
      : "";
  const linksDiffMd = () =>
    linksDrop ? ["### Links dropped", "", `- ${LINKS_DROP[linksDrop.what]}: ${linksDropText()}`, ""] : [];

  // AI agents and writing notes, from the crawler. Crawled text (tool names, sentences, URLs) is escaped for HTML and
  // Markdown.
  const AGENT_FILE = {
    "/.well-known/api-catalog": "API catalog (RFC 9727)",
    "/.well-known/agent-card.json": "A2A agent card",
    "/.well-known/oauth-protected-resource": "OAuth protected resource (RFC 9728)",
    "/.well-known/oauth-authorization-server": "OAuth authorization server (RFC 8414)",
  };
  const agentRows = (() => {
    const a = obj(raw.agents),
      strs = x => (Array.isArray(x) ? x.filter(s => typeof s === "string" && s) : []);
    if (!a) return [];
    return [
      ...(Array.isArray(a.pages) ? a.pages.filter(p => obj(p) && strs(p.tools).length) : []).map(p => [
        notePath(p.url),
        `WebMCP tools: ${strs(p.tools).join(", ")}`,
      ]),
      typeof a.ucp === "string" && a.ucp && ["/.well-known/ucp", `UCP shop profile, version ${a.ucp}`],
      ...strs(a.wellKnown).map(f => [f, AGENT_FILE[f] || "agent file"]),
    ].filter(Boolean);
  })();
  const AGENTS_INTRO =
    "What the site offers AI agents, listed for information: none of it is a finding or changes the score. WebMCP is a Chrome experiment that lets a page offer tools to AI agents, and its API is still changing; only inline scripts and forms were read. UCP is the open standard behind checkout in Google's AI Mode and Gemini.";
  const agentsHtml = () =>
    agentRows.length
      ? `\n    <details class="how agents"><summary>AI agents</summary><p>${esc(AGENTS_INTRO)}</p><ul class="lim">${agentRows.map(([where, what]) => `<li><b><code>${esc(where)}</code></b><span>${esc(what)}</span></li>`).join("")}</ul></details>`
      : "";
  const agentsMd = () =>
    agentRows.length
      ? [
          "## AI agents",
          "",
          AGENTS_INTRO,
          "",
          ...agentRows.map(([where, what]) => `- ${noteCode(where)} ${noteMd(what)}`),
          "",
        ]
      : [];
  const writingNotes = (Array.isArray(raw.writingNotes) ? raw.writingNotes : []).filter(
    n => obj(n) && typeof n.url === "string",
  );
  const noteText = n => {
    const k = x => Math.max(0, Math.floor(Number(x) || 0)),
      stock = Array.isArray(n.stockPhrases) ? n.stockPhrases.filter(s => typeof s === "string") : [];
    return [
      k(n.longSentences) && `${plural(k(n.longSentences), "sentence")} over 35 words`,
      k(n.longParagraphs) && `${plural(k(n.longParagraphs), "paragraph")} over 150 words`,
      stock.length && `stock phrases: ${stock.map(s => `“${s}”`).join(", ")}`,
      Number.isFinite(n.readingEase) && `reading ease ${n.readingEase}`,
      typeof n.longestSentence === "string" && n.longestSentence && `longest sentence: “${n.longestSentence}”`,
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const WRITING_INTRO =
    "Long sentences, long paragraphs and stock phrases on English pages, with Flesch reading ease (0 to 100, higher is easier) as a rough guide. Code and tables are left out. These notes help the writing; they never change the score.";
  const writingHtml = () =>
    writingNotes.length
      ? `\n    <details class="how writing"><summary>Writing notes</summary><p>${esc(WRITING_INTRO)}</p><ul class="lim">${writingNotes
          .slice(0, 10)
          .map(n => `<li><b><code>${esc(notePath(n.url))}</code></b><span>${esc(noteText(n))}</span></li>`)
          .join(
            "",
          )}</ul>${writingNotes.length > 10 && mdFile ? `<p>All ${num(writingNotes.length)} pages are listed in <code>${esc(mdFile)}</code>.</p>` : ""}</details>`
      : "";
  const writingMd = () =>
    writingNotes.length
      ? [
          "## Writing notes",
          "",
          WRITING_INTRO,
          "",
          ...writingNotes.map(n => `- ${noteCode(notePath(n.url))} ${noteMd(noteText(n))}`),
          "",
        ]
      : [];

  // Images ranked by what converting or resizing them would save, top 15. Crawled text is escaped.
  const imageRows = (Array.isArray(raw.images) ? raw.images : [])
    .filter(i => obj(i) && typeof i.url === "string" && Number.isFinite(i.bytes) && i.estSaving > 0)
    .sort((a, b) => b.estSaving - a.estSaving)
    .slice(0, 15);
  const kbOf = n => `${num(Math.round(n / 1024))} KB`;
  const imageWhat = i => [i.format, i.width && i.height && `${i.width} × ${i.height} px`].filter(Boolean).join(" · ");
  const IMAGES_INTRO =
    "A rough estimate of what WebP and resizing to 1,600 px wide would save: Google measured lossy WebP 25–34% smaller than JPEG and lossless WebP 26% smaller than PNG, and the low end is used. Information only: it never changes the score. With your yes, scripts/images.mjs converts the JPEG and PNG ones and keeps the originals (it needs the optional image add-on: npx seo-supervisor --with-image-tools).";
  const imagesHtml = () =>
    imageRows.length
      ? `\n    <details class="how images"><summary>Images by possible saving</summary><p>${esc(IMAGES_INTRO)}</p><div class="tablewrap"><table><thead><tr><th scope="col">Image</th><th scope="col">Size</th><th scope="col">Format</th><th scope="col">Possible saving</th></tr></thead><tbody>${imageRows.map(i => `<tr><td><code>${esc(notePath(i.url))}</code></td><td>${kbOf(i.bytes)}</td><td>${esc(imageWhat(i))}</td><td>about ${kbOf(i.estSaving)}</td></tr>`).join("")}</tbody></table></div></details>`
      : "";
  const imagesMd = () =>
    imageRows.length
      ? [
          "## Images by possible saving",
          "",
          IMAGES_INTRO,
          "",
          "| Image | Size | Format | Possible saving |",
          "| --- | ---: | --- | ---: |",
          ...imageRows.map(
            i =>
              `| ${cellMd(noteCode(notePath(i.url)))} | ${kbOf(i.bytes)} | ${cellMd(noteMd(imageWhat(i)))} | about ${kbOf(i.estSaving)} |`,
          ),
          "",
        ]
      : [];

  // Lighthouse detail per page: each run's `detail` from lighthouse.mjs, every failed audit with up to 10 files or page
  // elements. Titles come from Lighthouse (Markdown backticks included) and files from the site, so both are escaped.
  const lhRuns = (Array.isArray(raw.lighthouse) ? raw.lighthouse : [])
    .filter(x => obj(x) && typeof x.url === "string" && Array.isArray(x.detail))
    .map(x => ({
      path: notePath(x.url),
      audits: x.detail
        .filter(a => obj(a) && typeof a.title === "string")
        .map(a => ({
          ...a,
          items: (Array.isArray(a.items) ? a.items : []).filter(s => typeof s === "string" && s).slice(0, 10),
        })),
    }))
    .filter(x => x.audits.length);
  const LH_INTRO =
    "Every audit each Lighthouse run failed, with the files or page elements it names (10 at most). Information only: Lighthouse's lab results don't change the score.";
  const lighthouseDetailHtml = () =>
    lhRuns.length
      ? `\n    <details class="how lhdetail"><summary>Lighthouse details</summary><p>${esc(LH_INTRO)}</p>${lhRuns
          .slice(0, 10)
          .map(
            x =>
              `<details><summary><code>${esc(x.path)}</code> · ${plural(x.audits.length, "failed audit")}</summary><ul class="lim">${x.audits.map(a => `<li><b>${inl(a.title)}</b><span>${esc(a.category || "")}${a.items.length ? ` · ${a.items.map(s => `<code>${esc(s)}</code>`).join(", ")}` : ""}</span></li>`).join("")}</ul></details>`,
          )
          .join(
            "",
          )}${lhRuns.length > 10 && mdFile ? `<p>All ${num(lhRuns.length)} pages are listed in <code>${esc(mdFile)}</code>.</p>` : ""}</details>`
      : "";
  const lighthouseDetailMd = () =>
    lhRuns.length
      ? [
          "## Lighthouse details",
          "",
          LH_INTRO,
          "",
          ...lhRuns.flatMap(x => [
            `### ${noteCode(x.path)}`,
            "",
            ...x.audits.map(
              a =>
                `- ${noteMd(a.title)}${a.category ? ` (${noteMd(a.category)})` : ""}${a.items.length ? `: ${a.items.map(noteCode).join(", ")}` : ""}`,
            ),
            "",
          ]),
        ]
      : [];

  // Each panel below is a page and Markdown pair; an empty pair adds nothing to the page or the Markdown.
  // The home page's HSTS header against the preload list's rules.
  const hstsPreloadText = () => {
    const p = obj(raw.hstsPreload),
      missing = Array.isArray(p?.missing) ? p.missing.filter(s => typeof s === "string") : [];
    if (!p || typeof p.ready !== "boolean") return "";
    const also =
      "hstspreload.org also needs the header on the bare domain, http:// sent to https:// on the same host first, and every subdomain on HTTPS. Joining the list is optional and slow to undo. Information only: it doesn't change the score.";
    return p.ready
      ? `HSTS preload: the header meets the list's rules. ${also}`
      : `HSTS preload: not ready yet. The header still needs ${missing.join(" and ")}. ${also}`;
  };
  const secHtml = () => (hstsPreloadText() ? `\n    <p class="quiet">${esc(hstsPreloadText())}</p>` : ""),
    secMd = () => (hstsPreloadText() ? ["## HSTS preload", "", noteMd(hstsPreloadText()), ""] : []);

  // Pages per top-level section show only with two or more; siteSize is set when the crawl stopped at --max, and
  // indexing is Search Console's indexed count. Paths are escaped.
  const crawlSections = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter(s => obj(s) && typeof s.path === "string" && isCount(s.pages) && Number.isFinite(s.share))
    .slice(0, 20);
  const crawlLines = () => {
    const z = obj(raw.siteSize),
      i = obj(raw.indexing);
    return [
      z &&
        [z.crawled, z.known, z.sitemapUrls].every(isCount) &&
        `The crawl stopped at ${num(z.crawled)} pages (--max). It knew of ${num(z.known)} URLs on the site from links and sitemaps (the sitemaps list ${num(z.sitemapUrls)}), so the site has at least ${num(Math.max(z.known, z.sitemapUrls))} URLs.`,
      i &&
        [i.indexed, i.notIndexed, i.crawlIndexable].every(isCount) &&
        /^\d{4}-\d{2}-\d{2}$/.test(i.date) &&
        `Search Console counted ${num(i.indexed)} indexed pages (and ${num(i.notIndexed)} not indexed) on ${i.date}; this crawl found ${num(i.crawlIndexable)} pages meant to be indexed${i.capped ? " before it stopped at --max" : ""}. Information only: it doesn't change the score.`,
    ].filter(Boolean);
  };
  const SECTIONS_INTRO =
    "How the crawled pages split across the site's top-level folders. Pages with nothing below them count as top-level pages (/). Information only.";
  const pctOf = s => `${Math.round(s * 100)}%`;
  const crawlScopeHtml = () =>
    crawlLines()
      .map(t => `\n    <p class="quiet">${esc(t)}</p>`)
      .join("") +
    (crawlSections.length > 1
      ? `\n    <details class="how sections"><summary>Site sections</summary><p>${esc(SECTIONS_INTRO)}</p><div class="tablewrap"><table><thead><tr><th scope="col">Section</th><th scope="col">Pages</th><th scope="col">Share</th></tr></thead><tbody>${crawlSections.map(s => `<tr><td><code>${esc(s.path)}</code></td><td>${num(s.pages)}</td><td>${pctOf(s.share)}</td></tr>`).join("")}</tbody></table></div></details>`
      : "");
  const crawlScopeMd = () => {
    const lines = crawlLines(),
      table = crawlSections.length > 1;
    return lines.length || table
      ? [
          "## Crawl coverage",
          "",
          ...lines.flatMap(t => [t, ""]),
          ...(table
            ? [
                "### Site sections",
                "",
                SECTIONS_INTRO,
                "",
                "| Section | Pages | Share |",
                "| --- | ---: | ---: |",
                ...crawlSections.map(s => `| ${cellMd(noteCode(s.path))} | ${num(s.pages)} | ${pctOf(s.share)} |`),
                "",
              ]
            : []),
        ]
      : [];
  };

  // From the crawler: each AI crawler robots.txt allows or blocks (`aiBots`), pages without landmarks (`landmarks`) and
  // Lighthouse's experimental Agentic browsing checks (`lighthouse[].agentic`). Text is escaped.
  const AI_KIND = { search: "AI search", training: "Training", user: "Fetches for a user", other: "Other" };
  const AI_STATUS = {
    allowed: "Allowed",
    blocked: "Blocked",
    "blocked-by-star": "Blocked by `User-agent: *`",
    "blocked-by-googlebot": "Blocked by the Googlebot group (Apple follows it when Applebot isn't named)",
  };
  // The shared AI-training opt-out; an unknown value shows nothing.
  const TRAINING = {
    "not-set": "not in robots.txt. A `User-agent: *` group doesn't cover it",
    blocked: "set: it refuses AI training for the whole site",
    partly: "set for some paths only",
    allowed: "set, and it allows AI training",
  };
  const trainingLine = () =>
    Object.hasOwn(TRAINING, raw.trainingOptOut)
      ? `Shared AI-training opt-out (\`User-agent: __usage_ai-training\`, an IETF draft): ${TRAINING[raw.trainingOptOut]}. Anthropic honours it since 30 Oct 2026, and Bing from 1 Feb 2027; Google plans to in 2027.`
      : "";
  const bots = (Array.isArray(raw.aiBots) ? raw.aiBots : []).filter(
    b => obj(b) && typeof b.bot === "string" && Object.hasOwn(AI_STATUS, b.robots),
  );
  const bare = (l =>
    l && [l.checked, l.count].every(isCount) && Array.isArray(l.pages)
      ? { ...l, pages: l.pages.filter(p => obj(p) && typeof p.url === "string" && Array.isArray(p.missing)) }
      : null)(obj(raw.landmarks));
  const agenticRows = (Array.isArray(raw.lighthouse) ? raw.lighthouse : [])
    .filter(
      x => obj(x) && typeof x.url === "string" && obj(x.agentic) && [x.agentic.passed, x.agentic.total].every(isCount),
    )
    .map(x => ({
      path: notePath(x.url),
      passed: x.agentic.passed,
      total: x.agentic.total,
      failed: (Array.isArray(x.agentic.failed) ? x.agentic.failed : []).filter(
        f => obj(f) && typeof f.title === "string",
      ),
    }));
  const AI_INTRO =
    "Information only: none of this changes the score. The table shows whether robots.txt lets each AI crawler in, by its own group or, when it has none, by the User-agent: * group. Fetchers for a user get a page a person asked for, and some vendors say robots.txt may not apply to them.";
  const AGENTIC_INTRO =
    "Lighthouse's Agentic browsing checks (experimental; Lighthouse 13.3 or later with Chrome 150 or later): whether AI agents can read and use the page. There's no 0–100 score, only the checks passed.";
  const aiBotStatus = b => AI_STATUS[b.robots] + (b.mayIgnore ? " (may ignore robots.txt)" : "");
  const landmarkLine = () =>
    `${num(bare.count)} of ${num(bare.checked)} pages lack one or more landmarks (main, nav, header, footer), which screen readers and AI agents use to find their way around a page (AI-05).`;
  const agenticRow = a =>
    `${num(a.passed)} of ${num(a.total)} checks passed${a.failed.length ? `; failing: ${a.failed.map(f => f.title).join("; ")}` : ""}`;
  const aiCrawlersOn = () => bots.length || bare || agenticRows.length || trainingLine() || aiPrefsOn();
  const aiCrawlersHtml = () =>
    aiCrawlersOn()
      ? `\n    <details class="how aibots"><summary>AI crawlers and agents</summary>` +
        (bots.length
          ? `<p>${esc(AI_INTRO)}</p><div class="tablewrap"><table><thead><tr><th scope="col">Crawler</th><th scope="col">Vendor</th><th scope="col">Kind</th><th scope="col">robots.txt</th></tr></thead><tbody>${bots.map(b => `<tr><td><code>${esc(b.bot)}</code></td><td>${esc(b.vendor)}</td><td>${esc(AI_KIND[b.kind] || b.kind)}</td><td>${inl(aiBotStatus(b))}</td></tr>`).join("")}</tbody></table></div>`
          : "") +
        (trainingLine() ? `<p>${inl(trainingLine())}</p>` : "") +
        aiPartsHtml() +
        (bare
          ? `<p>${esc(landmarkLine())}</p><ul class="lim">${bare.pages.map(p => `<li><b><code>${esc(notePath(p.url))}</code></b><span>no ${esc(p.missing.join(", "))}</span></li>`).join("")}</ul>`
          : "") +
        (agenticRows.length
          ? `<p>${esc(AGENTIC_INTRO)}</p><ul class="lim">${agenticRows.map(a => `<li><b><code>${esc(a.path)}</code></b><span>${esc(agenticRow(a))}</span></li>`).join("")}</ul>`
          : "") +
        `</details>`
      : "";
  const aiCrawlersMd = () =>
    aiCrawlersOn()
      ? [
          "## AI crawlers and agents",
          "",
          ...(bots.length
            ? [
                AI_INTRO,
                "",
                "| Crawler | Vendor | Kind | robots.txt |",
                "| --- | --- | --- | --- |",
                ...bots.map(
                  b =>
                    `| ${cellMd(noteMd(b.bot))} | ${cellMd(noteMd(b.vendor))} | ${cellMd(noteMd(AI_KIND[b.kind] || b.kind))} | ${cellMd(aiBotStatus(b))} |`,
                ),
                "",
              ]
            : []),
          ...(trainingLine() ? [trainingLine(), ""] : []),
          ...aiPartsMd(),
          ...(bare
            ? [
                landmarkLine(),
                "",
                ...bare.pages.map(p => `- ${noteCode(notePath(p.url))} no ${noteMd(p.missing.join(", "))}`),
                "",
              ]
            : []),
          ...(agenticRows.length
            ? [AGENTIC_INTRO, "", ...agenticRows.map(a => `- ${noteCode(a.path)} ${noteMd(agenticRow(a))}`), ""]
            : []),
        ]
      : [];

  // How many Products give each recommended merchant listing field. Numbers only, so nothing crawled is shown.
  const fields = obj(raw.productFields),
    FIELDS = [
      ["brand", "a brand"],
      ["gtin", "a GTIN or MPN"],
      ["sku", "a SKU"],
      ["color", "a colour"],
      ["size", "a size"],
      ["material", "a material"],
      ["category", "a category"],
    ];
  const shopLine =
    fields && isCount(fields.products) && fields.products > 0 && FIELDS.every(([k]) => isCount(fields[k]))
      ? `Of ${plural(fields.products, "product")} in the schema: ${FIELDS.map(([k, w]) => `${num(fields[k])} with ${w}`).join(", ")}. Google recommends each one where the product has it, so a GTIN, colour or material can rightly be missing. Information only: it doesn't change the score.`
      : "";
  const shopHtml = () => (shopLine ? `\n    <p class="quiet">${esc(shopLine)}</p>` : ""),
    shopMd = () => (shopLine ? ["## Product data", "", shopLine, ""] : []);

  // Speed and image details, in one collapsed panel on the Overview (a section in the Markdown). Crawled and
  // third-party text (paths, element labels, hosts, versions) is escaped by the two callers.
  const mediaNums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  const mediaPair = (k, [a, b]) =>
    k === "cls"
      ? `CLS ${a} → ${b}`
      : k === "inp"
        ? `INP ${Math.round(a)} → ${Math.round(b)} ms`
        : `LCP ${(a / 1000).toFixed(1)} → ${(b / 1000).toFixed(1)} s`;
  const mediaPairs = (o, keys = ["lcp", "inp", "cls"]) =>
    keys
      .filter(k => mediaNums(o?.[k], 2))
      .map(k => mediaPair(k, o[k]))
      .join(" · ");
  const mediaDay = (s, year) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          ...(year && { year: "numeric" }),
          timeZone: "UTC",
        })
      : null;
  const mediaList = (xs, f, max = 5) =>
    xs.slice(0, max).map(f).join(" · ") + (xs.length > max ? ` and ${num(xs.length - max)} more` : "");
  const mediaLines = () => {
    const s = obj(raw.speed),
      m = obj(raw.media) || {},
      L = [],
      arr = x => (Array.isArray(x) ? x.filter(obj) : []),
      str = x => typeof x === "string" && x !== "";
    const samples = arr(s?.samples),
      v = obj(samples.find(x => obj(x.origin))?.origin) || obj(samples.find(x => obj(x.field))?.field);
    const KEYS = ["lcp", "inp", "cls", "fcp", "ttfb"],
      pct = x => `${Math.round(x * 100)}%`;
    const shares = KEYS.filter(k => mediaNums(v?.shares?.[k], 3)).map(
      k => `${k.toUpperCase()} ${v.shares[k].map(pct).join(" / ")}`,
    );
    if (shares.length) L.push(`Share of real visits that were good / needs improvement / poor: ${shares.join(" · ")}.`);
    const other = ["fcp", "ttfb"]
      .filter(k => Number.isFinite(v?.[k]))
      .map(k => `${k.toUpperCase()} ${(v[k] / 1000).toFixed(1)} s (${band(k, v[k])})`);
    if (other.length)
      L.push(
        `Other real-user numbers, not Core Web Vitals: ${other.join(" · ")}. Google's lines: FCP good up to 1.8 s, poor over 3 s; TTFB good up to 0.8 s, poor over 1.8 s, as a rough guide.`,
      );
    const t = obj(s?.trend),
      p = obj(t?.period),
      weeks = Number.isInteger(t?.weeks) ? t.weeks : 0;
    if (p && mediaDay(p.from) && mediaDay(p.to))
      L.push(`Real-user data period: CrUX's latest 28 days, ${mediaDay(p.from)} – ${mediaDay(p.to, true)}.`);
    else if (v && (v.shares || v.fcp != null || v.ttfb != null))
      L.push("Real-user data period: PageSpeed's numbers cover the last 28 days of Chrome visits.");
    const late = mediaPairs(t, ["inp", "cls"]),
      avg = mediaPairs(obj(t?.avg4));
    if (weeks && (late || avg))
      L.push(
        [
          late && `Over ${weeks} weeks (first week → latest): ${late}.`,
          avg && `4-week averages: ${avg} (the first four weeks against the last four).`,
        ]
          .filter(Boolean)
          .join(" "),
      );
    const pt = obj(s?.pageTrend),
      ptw = mediaPairs(obj(pt?.trend));
    if (ptw && str(pt.url))
      L.push(
        `${notePath(pt.url) === "/" ? "Home page" : notePath(pt.url)} alone: ${ptw} over ${num(pt.trend.weeks || 0)} weeks.`,
      );
    const tab = obj(s?.tablet),
      tl = obj(tab?.trend)?.lcp,
      tb = obj(tab?.lcpBreakdown);
    if (mediaNums(tl, 2)) {
      const [k] = Object.keys(LCP_PART).sort((x, y) => (tb?.[y] || 0) - (tb?.[x] || 0));
      L.push(
        `Tablet (whole site): ${mediaPair("lcp", tl)} over ${num(tab.trend.weeks || 0)} weeks${tb && Number.isFinite(tb[k]) ? `; most of the LCP goes on ${LCP_PART[k][0]} (${(tb[k] / 1000).toFixed(1)} s)` : ""}.`,
      );
    }
    const heroes = arr(m.heroImages).filter(h => str(h.url) && str(h.element));
    if (heroes.length)
      L.push(
        `Largest paint in the lab (the LCP element): ${mediaList(heroes, h => `${notePath(h.url)} → ${str(h.src) ? `${h.src} (${h.element})` : h.element}${str(h.source) ? `, ${h.source}` : ""}`)}.`,
      );
    const med = obj(m.lighthouseMedians),
      medParts = [
        ["Performance", "performance"],
        ["SEO", "seo"],
        ["Accessibility", "accessibility"],
        ["Best practices", "bestPractices"],
      ]
        .filter(([, k]) => Number.isFinite(med?.[k]))
        .map(([n, k]) => `${n} ${med[k]}`);
    if (medParts.length && Number.isInteger(med.pages))
      L.push(`Lighthouse medians across ${num(med.pages)} pages: ${medParts.join(" · ")}.`);
    const runs = arr(raw.lighthouse).filter(x => str(x.url) && Number.isInteger(x.passed)),
      ver = runs.find(x => str(x.version))?.version;
    if (runs.length)
      L.push(
        `Lighthouse${ver ? ` ${ver}` : ""}: ${mediaList(runs, x => `${notePath(x.url)} passed ${num(x.passed)} audits, failed ${num(Array.isArray(x.detail) ? x.detail.length : 0)}`)}.`,
      );
    const psiVer = samples.map(x => obj(x.lab)?.version).find(str);
    if (psiVer) L.push(`PageSpeed's lab runs used Lighthouse ${psiVer}.`);
    const st = obj(m.serverTimes),
      slow = arr(st?.slow).filter(x => str(x.url) && Number.isFinite(x.ms));
    if (st && [st.pages, st.median, st.p95].every(Number.isFinite))
      L.push(
        `Server response time, one request per page from this machine, ${num(st.pages)} pages: median ${num(st.median)} ms, the slowest 5% from ${num(st.p95)} ms.${slow.length ? ` Over 0.8 s (web.dev's “good” time to first byte for real visitors): ${mediaList(slow, x => `${notePath(x.url)} ${(x.ms / 1000).toFixed(1)} s`)}.` : ""}`,
      );
    const ds = obj(m.domShape),
      deep = arr(ds?.deep).filter(d => str(d.url) && Number.isFinite(d.depth)),
      wide = arr(ds?.wide).filter(d => str(d.url) && str(d.tag) && Number.isFinite(d.children));
    if (deep.length)
      L.push(
        `Nested more than 32 levels deep (our own line, from older Lighthouse advice): ${mediaList(deep, d => `${notePath(d.url)} ${d.depth} levels`)}. Deep nesting usually means wrapper elements that could go.`,
      );
    if (wide.length)
      L.push(
        `An element with more than 60 children (our own line): ${mediaList(wide, d => `${notePath(d.url)} ${d.tag} (${num(d.children)})`)}. Long lists can load in parts.`,
      );
    const cr = obj(m.imageCredits);
    if (cr && Number.isInteger(cr.read) && cr.read > 0) {
      const ai = (Array.isArray(cr.ai) ? cr.ai : []).filter(str),
        aiN = Number.isInteger(cr.aiCount) ? cr.aiCount : ai.length,
        none = (Array.isArray(cr.noCreator) ? cr.noCreator : []).filter(str);
      L.push(
        `Image credits, read from ${plural(cr.read, "image")}: ${num(cr.creator || 0)} name a creator, ${num(aiN)} ${aiN === 1 ? "is" : "are"} labelled as made with AI${ai.length ? ` (${mediaList(ai, notePath)})` : ""}, ${num(cr.c2pa || 0)} carry Content Credentials (C2PA).${none.length ? ` No creator: ${mediaList(none, notePath)}.` : ""}`,
      );
    }
    const ca = obj(m.imageCache),
      unc = (Array.isArray(ca?.uncached) ? ca.uncached : []).filter(str),
      hosts = Object.entries(obj(ca?.otherHosts) || {}).filter(([h, n]) => str(h) && Number.isInteger(n));
    if (ca && ((Number.isInteger(ca.checked) && ca.checked > 0) || hosts.length))
      L.push(
        [
          ca.checked > 0 &&
            `Image caching: ${num(Number.isInteger(ca.uncachedCount) ? ca.uncachedCount : unc.length)} of ${plural(ca.checked, "image")} are sent with no cache lifetime${unc.length ? ` (${mediaList(unc, notePath)})` : ""}, so browsers download them again on every visit.`,
          str(ca.cdn) && `They come through ${ca.cdn}.`,
          hosts.length && `Images on other hosts: ${mediaList(hosts, ([h, n]) => `${h} (${num(n)})`)}.`,
        ]
          .filter(Boolean)
          .join(" "),
      );
    return L;
  };
  const MEDIA_INTRO = "Information only: none of this changes the score.";
  const mediaHtml = () => {
    const L = mediaLines();
    return L.length
      ? `\n    <details class="how media"><summary>Speed and image details</summary><p>${esc(MEDIA_INTRO)}</p>${L.map(t => `<p>${esc(t)}</p>`).join("")}</details>`
      : "";
  };
  const mediaMd = () => {
    const L = mediaLines();
    return L.length ? ["## Speed and image details", "", MEDIA_INTRO, "", ...L.flatMap(t => [noteMd(t), ""])] : [];
  };

  // "What the browser saw": the crawler's renderSample (checks/visual.mjs checkMore) and renderedPage (--render-page).
  // Findings from these browser loads are listed with the others. Errors, text and addresses come from the site, so
  // each is escaped (code spans in the Markdown).
  const renderPages = (Array.isArray(raw.renderSample) ? raw.renderSample : [])
    .filter(p => obj(p) && typeof p.url === "string")
    .slice(0, 10);
  const renderChosen = (c => (c && typeof c.url === "string" ? c : null))(obj(raw.renderedPage));
  const renderStrs = x => (Array.isArray(x) ? x.filter(s => typeof s === "string" && s) : []);
  const renderSummary = () => {
    const seen = renderPages.filter(p => !p.gate && obj(p.h1) && obj(p.cta)),
      n = seen.length;
    if (!n) return "";
    const h1 = d => seen.filter(p => p.h1[d] === true).length,
      cta = d => seen.filter(p => typeof p.cta[d] === "string" && p.cta[d]).length;
    return `On a phone, the H1 is on the first screen on ${h1("phone")} of ${plural(n, "page")} and a button on ${cta("phone")} of ${n}; on desktop, ${h1("desktop")} of ${n} and ${cta("desktop")} of ${n}. The first screen and the button are our own measures, not Google rules.`;
  };
  const RENDER_DEEP = {
    "scrolled-away": "the page scrolled away from it",
    "hash-removed": "the page removed it from the address",
    both: "the page scrolled away from it and removed it from the address",
  };
  const renderBits = p => {
    if (typeof p.gate === "string") return [`showed ${p.gate}, so it wasn't compared or measured`];
    const errors = renderStrs(p.errors),
      h = obj(p.hidden),
      j = obj(p.jumpLinks),
      broken = renderStrs(j?.broken).map(id => `#${id}`);
    return [
      errors.length && `${plural(errors.length, "browser error")}, first: ${errors[0]}`,
      ...["phone", "desktop"].map(
        d =>
          obj(p.h1) &&
          p.h1[d] === false &&
          `the H1 isn't on the first screen on ${d === "phone" ? "a phone" : "desktop"}`,
      ),
      h &&
        isCount(h.words) &&
        h.words >= 50 &&
        /* our own line */ `${num(h.words)} hidden words (${Object.entries(obj(h.by) || {})
          .filter(([, v]) => isCount(v))
          .map(([k, v]) => `${k} ${num(v)}`)
          .join(", ")})${typeof h.examples?.[0]?.text === "string" ? `, most in “${h.examples[0].text}”` : ""}`,
      broken.length &&
        (broken.length === 1
          ? `a link to ${broken[0]}, which isn't on the page`
          : `links to ${broken.join(", ")}, which aren't on the page`),
      RENDER_DEEP[j?.deepLink] && typeof j.target === "string" && `opened at #${j.target}, ${RENDER_DEEP[j.deepLink]}`,
      p.menu === "no-button" && "no menu button found on a phone",
      p.menu === "covered" && "the phone menu button is covered by another layer",
    ].filter(Boolean);
  };
  const renderRows = () => renderPages.map(p => [p.url, renderBits(p)]).filter(([, b]) => b.length);
  const renderChosenText = () => {
    const c = renderChosen,
      w = obj(c.words) || {},
      steps = typeof c.steps === "string" && c.steps ? ` and the steps (${c.steps})` : "",
      errors = renderStrs(c.errors);
    const changes = (Array.isArray(c.changes) ? c.changes : [])
      .filter(x => obj(x) && typeof x.field === "string")
      .map(x => `${x.field}: ${x.raw ?? "none"} → ${x.rendered ?? "none"}`);
    return `: ${isCount(w.html) ? `${num(w.html)} words in the HTML, ${isCount(w.rendered) ? num(w.rendered) : "?"}` : `${isCount(w.rendered) ? num(w.rendered) : "?"} words`} after JavaScript${steps}. ${changes.length ? `What changed: ${changes.join("; ")}.` : "The title, canonical, robots tag, H1, schema and links match the HTML."}${typeof c.gate === "string" ? ` It showed ${c.gate}.` : ""}${errors.length ? ` ${plural(errors.length, "browser error")}, first: ${errors[0]}.` : ""}`;
  };
  const RENDER_INTRO =
    "The sample pages loaded again in Chrome at desktop and phone size. Information only; what is a finding is listed with the other findings.";
  const renderHtml = () => {
    const s = renderSummary(),
      rows = renderRows();
    if (!s && !rows.length && !renderChosen) return "";
    return `\n    <details class="how render"><summary>What the browser saw</summary><p>${esc(RENDER_INTRO)}</p>${s ? `<p>${esc(s)}</p>` : ""}${rows.length ? `<ul class="lim">${rows.map(([u, b]) => `<li><b><code>${esc(notePath(u))}</code></b><span>${esc(b.join(" · "))}</span></li>`).join("")}</ul>` : ""}${renderChosen ? `<p>You chose <code>${esc(notePath(renderChosen.url))}</code>${esc(renderChosenText())}</p>` : ""}</details>`;
  };
  const renderMd = () => {
    const s = renderSummary(),
      rows = renderRows();
    if (!s && !rows.length && !renderChosen) return [];
    return [
      "## What the browser saw",
      "",
      RENDER_INTRO,
      "",
      ...(s ? [s, ""] : []),
      ...rows.map(([u, b]) => `- ${noteCode(notePath(u))} ${noteMd(b.join(" · "))}`),
      ...(rows.length ? [""] : []),
      ...(renderChosen ? [`You chose ${noteCode(notePath(renderChosen.url))}${noteMd(renderChosenText())}`, ""] : []),
    ];
  };

  // Templated descriptions (META-02) and keyword use on English pages (CONTENT-03). Crawled text is escaped.
  const tdShare = (t =>
    t && Number.isInteger(t.pages) && Number.isInteger(t.templated) && t.templated > 0 && t.pages >= t.templated
      ? t
      : null)(obj(raw.templatedDescriptions));
  const tdClusters =
    tdShare && Array.isArray(tdShare.clusters)
      ? tdShare.clusters.filter(
          c => obj(c) && typeof c.section === "string" && Number.isInteger(c.templated) && Number.isInteger(c.pages),
        )
      : [];
  // The verdict's sections go through `code`, which escapes for its format.
  const tdText = code => [
    `${num(tdShare.templated)} of ${plural(tdShare.pages, "description")} (${Math.round((100 * tdShare.templated) / tdShare.pages)}%) end in a stock call to action or in a last sentence other pages share.`,
    tdShare.verdict === "cluster" && tdClusters.length
      ? `Verdict: a cluster. Most are in ${tdClusters.map(c => `${code(c.section)} (${c.templated} of ${c.pages} pages)`).join(", ")}, so that section's template is the fix.`
      : tdShare.verdict === "site-wide"
        ? "Verdict: site-wide. Half or more of the descriptions are templated, so the shared description template is the fix."
        : "Verdict: scattered. Fix them page by page.",
  ];
  const KW = ["natural", "missing", "repetitive", "forced"];
  const KW_WHY = {
    missing: "not in the H1 or the first 100 words",
    repetitive: "over 3% of the words",
    forced: "over 5% of the words, or in most subheadings",
  };
  const kwUse = obj(raw.keywordUse),
    kwCounts =
      kwUse && obj(kwUse.counts)
        ? KW.map(v => [v, Number.isInteger(kwUse.counts[v]) && kwUse.counts[v] >= 0 ? kwUse.counts[v] : 0])
        : [];
  const kwPages =
    kwUse && Array.isArray(kwUse.pages)
      ? kwUse.pages.filter(
          k => obj(k) && typeof k.url === "string" && typeof k.phrase === "string" && KW_WHY[k.verdict],
        )
      : [];
  const kwRow = k =>
    `“${k.phrase}”: ${k.verdict}, ${KW_WHY[k.verdict]}${Number.isFinite(k.density) ? ` (${k.density}% of the words)` : ""}`;
  const kwLine = () =>
    `Keyword use on ${plural(
      kwCounts.reduce((n, [, c]) => n + c, 0),
      "English page",
    )}: ${kwCounts.map(([v, c]) => `${num(c)} ${v}`).join(" · ")}.`;
  const CONTENT_INTRO =
    "How the descriptions and the main keyword are written, for information: these notes never change the score. Each English page's main phrase is taken from its title; the 3% and 5% lines are our own, from CONTENT-03's “no density targets above about 2–3%”.";
  const contentHtml = () =>
    tdShare || kwCounts.length
      ? `\n    <details class="how content"><summary>Descriptions and keyword use</summary><p>${esc(CONTENT_INTRO)}</p>${
          tdShare
            ? `<p>${tdText(s => `<code>${esc(s)}</code>`)
                .map((t, i) => (i ? t : esc(t)))
                .join(" ")}</p>`
            : ""
        }${
          kwCounts.length
            ? `<p>${esc(kwLine())}</p>${
                kwPages.length
                  ? `<ul class="lim">${kwPages
                      .slice(0, 10)
                      .map(k => `<li><b><code>${esc(notePath(k.url))}</code></b><span>${esc(kwRow(k))}</span></li>`)
                      .join("")}</ul>`
                  : ""
              }`
            : ""
        }${kwPages.length > 10 && mdFile ? `<p>All ${num(kwPages.length)} pages are listed in <code>${esc(mdFile)}</code>.</p>` : ""}</details>`
      : "";
  const contentMd = () =>
    tdShare || kwCounts.length
      ? [
          "## Descriptions and keyword use",
          "",
          CONTENT_INTRO,
          "",
          ...(tdShare
            ? [
                tdText(noteCode)
                  .map((t, i) => (i ? t : noteMd(t)))
                  .join(" "),
                "",
              ]
            : []),
          ...(kwCounts.length
            ? [
                kwLine(),
                "",
                ...kwPages.map(k => `- ${noteCode(notePath(k.url))} ${noteMd(kwRow(k))}`),
                ...(kwPages.length ? [""] : []),
              ]
            : []),
        ]
      : [];

  // OpenStreetMap's credit goes wherever its data shows (ODbL). Names, addresses and evidence come from the site or
  // from OpenStreetMap, so each is escaped.
  // https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
  const lbRaw = obj(raw.localBusiness),
    nbRaw = obj(raw.nearby),
    gcRaw = obj(raw.geocode);
  const LOCAL_KIND = {
    storefront: "Customers come to the business's address: a storefront.",
    "service-area":
      "The business goes to its customers: a service-area business. It may hide its street address, so the address check doesn't ask for it (LOCAL-06).",
    hybrid:
      "Customers come to the business's address, and it also goes to them. Keep the address on the site and in the schema, and list the towns it serves as areaServed (LOCAL-12).",
  };
  const OSM_CREDIT =
    "Map data © OpenStreetMap contributors, under the Open Database License (https://www.openstreetmap.org/copyright).";
  const lcFin = x => typeof x === "number" && Number.isFinite(x);
  const lcDist = m => (m < 1000 ? `${num(Math.round(m))} m` : `${+(m / 1000).toFixed(1)} km`);
  const lcStr = x => typeof x === "string" && x.trim() !== "";
  // [text, list of [name, detail]] blocks, and whether OpenStreetMap's data is shown.
  const localLines = () => {
    const L = [];
    if (lbRaw && LOCAL_KIND[lbRaw.kind])
      L.push([
        LOCAL_KIND[lbRaw.kind],
        (Array.isArray(lbRaw.evidence) ? lbRaw.evidence.filter(lcStr) : []).slice(0, 6).map(e => [e, ""]),
      ]);
    const nb = nbRaw && [nbRaw.count, nbRaw.radiusM, nbRaw.perKm2].every(lcFin) ? nbRaw : null;
    if (nb)
      L.push([
        `OpenStreetMap lists ${plural(nb.count, "other place")} of the same kind (${lcStr(nb.label) ? nb.label : "the business's type"}) within ${lcDist(nb.radiusM)} of ${lcStr(nb.centerFrom) ? nb.centerFrom : "the business"}: about ${nb.perKm2} per km². Context only: volunteers keep OpenStreetMap, so it can miss businesses or list closed ones.`,
        (Array.isArray(nb.places) ? nb.places : [])
          .filter(p => obj(p) && lcStr(p.name) && lcFin(p.distanceM))
          .slice(0, 10)
          .map(p => [p.name, lcDist(p.distanceM)]),
      ]);
    const g = gcRaw && lcStr(gcRaw.query) ? gcRaw : null,
      f = obj(g?.found);
    if (g && !f)
      L.push([
        `OpenStreetMap's Nominatim couldn't find “${g.query}”. If the address is right, it may just be missing from OpenStreetMap; that's not a problem with the site.`,
        [],
      ]);
    else if (g && lcFin(f.lat) && lcFin(f.lon)) {
      if (lcFin(g.distanceM))
        L.push([
          g.distanceM > 250
            ? `OpenStreetMap's Nominatim places “${g.query}” ${lcDist(g.distanceM)} from the schema's geo. Check which is right on a map: geo should mark the business's own door (LOCAL-06).`
            : `OpenStreetMap's Nominatim places “${g.query}” ${lcDist(g.distanceM)} from the schema's geo, so the two agree.`,
          [],
        ]);
      else if (g.suggestGeo === true)
        L.push([
          `The schema has no geo. OpenStreetMap's Nominatim places “${g.query}” at ${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}. Check the point on a map, then add it to the business schema as geo, with latitude and longitude (LOCAL-06).`,
          [],
        ]);
    }
    return { L, osm: !!nb || !!g };
  };
  const LOCAL_INTRO = "Information only: none of this changes the score. 250 m is our own line for the address check.";
  const localHtml = () => {
    const { L, osm } = localLines();
    return L.length
      ? `\n    <details class="how local"><summary>Local business</summary><p>${esc(LOCAL_INTRO)}</p>${L.map(([t, list]) => `<p>${esc(t)}</p>${list.length ? `<ul class="lim">${list.map(([k, v]) => `<li><b>${esc(k)}</b>${v ? `<span>${esc(v)}</span>` : ""}</li>`).join("")}</ul>` : ""}`).join("")}${osm ? `<p class="quiet">Map data <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>, under the Open Database License.</p>` : ""}</details>`
      : "";
  };
  const localMd = () => {
    const { L, osm } = localLines();
    return L.length
      ? [
          "## Local business",
          "",
          LOCAL_INTRO,
          "",
          ...L.flatMap(([t, list]) => [
            noteMd(t),
            "",
            ...list.map(([k, v]) => `- ${noteMd(k)}${v ? ` ${noteMd(v)}` : ""}`),
            ...(list.length ? [""] : []),
          ]),
          ...(osm ? [noteMd(OSM_CREDIT), ""] : []),
        ]
      : [];
  };

  // More about links, in one collapsed panel on the Overview (a section in the Markdown). Names, addresses and link
  // text come from other sites, so each is escaped (code spans in the Markdown).
  const asArray = (x, ok) => (Array.isArray(x) ? x.filter(ok) : []);
  const asDay = x => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x));
  const newItems = (n =>
    n && isCount(n.count) && n.count > 0
      ? { ...n, sites: asArray(n.sites, s => obj(s) && isText(s.domain)).slice(0, 5) }
      : null)(obj(raw.newLinks));
  const stale = (n => (n && asDay(n.newest) && asDay(n.asOf) ? n : null))(obj(raw.noNewLinks));
  const unlinked = (u =>
    u && isCount(u.count) && u.count > 0 && isCount(u.of) && u.of >= u.count
      ? { ...u, urls: asArray(u.urls, isText).slice(0, 5) }
      : null)(obj(raw.unlinkedPages));
  const nfSites = asArray(linkCheck?.nofollowSites, s => obj(s) && isText(s.site) && isCount(s.pages)).slice(0, 10);
  const foundItems = asArray(linkCheck?.found, f => obj(f) && isText(f.url) && Array.isArray(f.links))
    .flatMap(f =>
      asArray(f.links, l => obj(l) && isText(l.href))
        .slice(0, 1)
        .map(l => ({ url: f.url, ...l })),
    )
    .slice(0, 10);
  const cc = (c =>
    c && isText(obj(c.crawl)?.name)
      ? {
          name: c.crawl.name,
          site: obj(c.site) && isCount(c.site.captures) ? c.site : null,
          pages: asArray(c.linkingPages, p => obj(p) && isText(p.url) && isText(p.state)),
          sites: asArray(c.linkingSites, isText),
        }
      : null)(obj(raw.commonCrawl));
  // commoncrawl.mjs --rank: the domain's place in Common Crawl's web graph by harmonic centrality, or how far down it
  // isn't.
  const rankInfo = (r =>
    r &&
    isText(r.domain) &&
    isText(r.release) &&
    isCount(r.domains) &&
    (r.found === true ? isCount(r.harmonicPos) : r.found === false && isCount(r.scanned))
      ? r
      : null)(obj(obj(raw.commonCrawl)?.rank));
  const out = (o =>
    o && obj(o.pages) && Object.keys(o.pages).length
      ? {
          pages: Object.values(o.pages).filter(isCount),
          domains: Object.entries(obj(o.domains) || {}).filter(([k, v]) => isText(k) && isCount(v)),
        }
      : null)(obj(raw.linksToOtherSites));
  const bingSample = Array.isArray(bing?.backlinks?.sample) ? bing.backlinks.sample.filter(obj).length : 0;
  const extraLines = () => {
    const L = []; // [text, list of [name, detail]]
    if (newItems)
      L.push([
        `${plural(newItems.count, "new site")} ${newItems.count === 1 ? "links" : "link"} to you since the last export${Date.parse(newItems.since) ? ` (${fmtDate(newItems.since)})` : ""}, from Search Console's Top linking sites.${newItems.capped === true ? " Some may be older links: an export holds 1,000 sites at most, so they may have been past the cut before." : ""}`,
        newItems.sites.map(s => [s.domain, isCount(s.links) ? plural(s.links, "link") : ""]),
      ]);
    if (stale)
      L.push([
        `No new links for 3 months or more: no link in Search Console's Latest links export was found after ${fmtDate(stale.newest)} (export of ${fmtDate(stale.asOf)}). New links usually come from new things worth linking to, like original data, a free tool, a guide or real news (LINK-10).`,
        [],
      ]);
    if (unlinked)
      L.push([
        `${num(unlinked.count)} of your ${num(unlinked.of)} crawled pages have no links from other sites in Search Console's list. That's normal for most pages. For the ones that matter most, link to them from your pages that other sites do link to.`,
        unlinked.urls.map(u => [notePath(u), ""]),
      ]);
    if (nfSites.length)
      L.push([
        "Sites whose links to you are all nofollow, sponsored or ugc, in the backlink check. Such links are allowed; Google says links marked this way “will generally not be followed”.",
        nfSites.map(s => [s.site, plural(s.pages, "page")]),
      ]);
    if (foundItems.length)
      L.push([
        "Links the backlink check found, with the page each points at and its text:",
        foundItems.map(f => [
          f.url,
          `→ ${f.href}${isText(f.text) ? ` “${f.text}”` : ""}${isText(f.rel) ? ` (${f.rel})` : ""}`,
        ]),
      ]);
    if (cc) {
      const s = cc.site,
        linked = cc.pages.filter(p => p.state === "links").length,
        absent = cc.pages.filter(p => p.state === "not-in-crawl").length;
      if (s)
        L.push([
          s.captures
            ? `Common Crawl (${cc.name}) holds ${s.capped === true ? "1,000 or more" : num(s.captures)} saved copies of your site's pages${s.home === true ? ", the home page among them" : ", but not the home page"}.`
            : `Common Crawl (${cc.name}) holds none of your site's pages. If robots.txt blocks CCBot, its crawler, that's why.`,
          [],
        ]);
      if (cc.pages.length)
        L.push([
          `${num(linked)} of ${num(cc.pages.length)} known linking pages link to you in Common Crawl's saved copies${absent ? `; ${num(absent)} ${absent === 1 ? "isn't" : "aren't"} in its newest crawl` : ""}. commoncrawl.mjs --rank adds your domain's rank in its web graph.`,
          cc.sites.slice(0, 5).map(h => [h, ""]),
        ]);
    }
    if (rankInfo)
      L.push([
        `Common Crawl's web graph (${rankInfo.release}): ${rankInfo.found ? `${rankInfo.domain} is #${num(rankInfo.harmonicPos)} of ${num(rankInfo.domains)} domains by how well linked it is (harmonic centrality)${isCount(rankInfo.pageRankPos) ? `, #${num(rankInfo.pageRankPos)} by PageRank` : ""}` : `${rankInfo.domain} isn't in the top ${num(rankInfo.scanned)} of ${num(rankInfo.domains)} domains${rankInfo.capped ? " (the read stopped there)" : ""}`}. Common Crawl's own number, not Google's, and information only.`,
        [],
      ]);
    if (out) {
      const n = out.pages.filter(c => c > 0).length,
        top = [...out.domains].sort((a, b) => b[1] - a[1]).slice(0, 5);
      L.push([
        `${num(n)} of your ${num(out.pages.length)} crawled pages ${n === 1 ? "links" : "link"} to other sites, ${plural(out.domains.length, "site")} in all. Pages that make claims should link to their sources (CONTENT-10).`,
        top.map(([d, c]) => [d, plural(c, "address", "addresses")]),
      ]);
    }
    // How much of the link profile the free sources cover.
    // https://support.google.com/webmasters/answer/9049606
    const cover = [
      hasSc &&
        `Google says Search Console's Links report “isn't a comprehensive list of every link on your site”, and each of its tables stops at 1,000 rows${scSites.length >= 1000 ? " (Top linking sites reached it)" : ""}.`,
      bingSample && `Bing's links here are a sample of ${plural(bingSample, "link")} to your home page.`,
      checkedLinks && `The backlink check opened ${plural(checkedLinks, "known linking page")} (100 at most).`,
      cc && "Common Crawl holds only the pages its monthly crawl reached.",
    ].filter(Boolean);
    if (cover.length)
      L.push([`How much this covers: ${cover.join(" ")} Treat the numbers as a sample, not a full count.`, []]);
    return L;
  };
  const LINKS_INTRO = "Information only: none of this changes the score.";
  const backlinksHtml = () => {
    const L = extraLines();
    return L.length
      ? `\n    <details class="how morelinks"><summary>More about links</summary><p>${esc(LINKS_INTRO)}</p>${L.map(([t, list]) => `<p>${esc(t)}</p>${list.length ? `<ul class="lim">${list.map(([k, v]) => `<li><b><code>${esc(k)}</code></b><span>${esc(v)}</span></li>`).join("")}</ul>` : ""}`).join("")}</details>`
      : "";
  };
  const backlinksMd = () => {
    const L = extraLines();
    return L.length
      ? [
          "## More about links",
          "",
          LINKS_INTRO,
          "",
          ...L.flatMap(([t, list]) => [
            noteMd(t),
            "",
            ...list.map(([k, v]) => `- ${noteCode(k)}${v ? ` ${noteMd(v)}` : ""}`),
            ...(list.length ? [""] : []),
          ]),
        ]
      : [];
  };

  // Third-party text (registrars, video titles, referrers, paths) is escaped by the callers.
  const connLines = () => {
    const n = x => Number(x) || 0,
      fin = Number.isFinite,
      arr = x => (Array.isArray(x) ? x.filter(obj) : []),
      isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const top = (map, k, max = 10, label = s => s) =>
      Object.entries(obj(map) || {})
        .map(([name, v]) => /** @type {[string, number]} */ ([name, n(v?.[k])]))
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, max)
        .map(([name, v]) => `${label(name)} ${num(v)}`)
        .join(" · ");
    const when = x => (isoDates(x) ? ` (${isoDates(x)})` : "");
    const ages = arr(raw.domainAge).filter(d => typeof d.domain === "string" && isDay(d.registered));
    const moz = arr(raw.moz).filter(m => typeof m.domain === "string" && fin(m.domainAuthority));
    const yt = obj(raw.youtube),
      ch = obj(yt?.channel),
      st = obj(raw.siteTotals),
      ad = obj(raw.analyticsDetail),
      ai = obj(ad?.aiAssistant);
    const sister = obj(bing?.sister),
      others = Array.isArray(sister?.onlySister) ? sister.onlySister.filter(h => typeof h === "string" && h) : [];
    const sisterHost = (() => {
      try {
        return new URL(sister.site).hostname;
      } catch {
        return "";
      }
    })();
    const report = (x, k, what, on) => {
      const r = obj(x),
        pages = Object.keys(obj(r?.pages) || {}).length;
      return (
        r &&
        n(r[k]) > 0 &&
        `${what}: ${plural(n(r[k]), k.slice(0, -1))} ${on} ${plural(pages, "page")}${pages ? ` (top: ${top(r.pages, k, 3)})` : ""}`
      );
    };
    return [
      ages.length &&
        `Domain age (RDAP): ${ages.map(d => `${d.domain} registered ${d.registered}${typeof d.registrar === "string" && d.registrar ? ` (${d.registrar})` : ""}`).join(" · ")}`,
      moz.length &&
        `Moz: ${moz.map(m => [`${m.domain} Domain Authority ${m.domainAuthority}`, fin(m.spamScore) && `Spam Score ${m.spamScore}`, fin(m.linkingDomains) && plural(m.linkingDomains, "linking domain")].filter(Boolean).join(", ")).join(" · ")}`,
      ch &&
        typeof ch.title === "string" &&
        `YouTube channel ${ch.title}: ${[fin(ch.subscribers) && plural(ch.subscribers, "subscriber"), fin(ch.videos) && plural(ch.videos, "video"), fin(ch.views) && plural(ch.views, "view")].filter(Boolean).join(" · ")}`,
      ...arr(yt?.topics)
        .filter(t => typeof t.topic === "string" && arr(t.videos).length)
        .map(t => {
          const v = arr(t.videos);
          return `Top YouTube videos for “${t.topic}”: ${ch ? `${v.filter(x => x.own === true).length} of ${v.length} from your channel · ` : ""}first: ${v[0].title}${v[0].channel ? ` (${v[0].channel})` : ""}`;
        }),
      st &&
        n(st.clicks) > 0 &&
        `Search Console totals for the whole property: ${plural(n(st.clicks), "click")} · ${plural(n(st.impressions), "impression")}. ${st.complete === false ? `The queries listed cover ${Math.round((100 * n(st.queryClicks)) / n(st.clicks))}% of the clicks; Google doesn't list rare queries.` : st.complete ? "The queries listed cover every click." : ""}`.trim(),
      ad &&
        n(ad.sessions) > 0 &&
        `Google Analytics organic: ${plural(n(ad.sessions), "session")}${n(ad.users) ? ` from ${plural(n(ad.users), "user")}` : ""}${top(ad.byDevice, "sessions") ? ` · ${top(ad.byDevice, "sessions")}` : ""}${raw.trafficPeriod ? ` (${String(raw.trafficPeriod).toLowerCase()})` : ""}`,
      ad &&
        top(ad.byCountry, "sessions") &&
        `Google Analytics organic sessions by country: ${top(ad.byCountry, "sessions")}`,
      ai &&
        n(ai.sessions) > 0 &&
        `Google Analytics AI Assistant channel: ${plural(n(ai.sessions), "session")}${top(ai.bySource, "sessions") ? ` (${top(ai.bySource, "sessions")})` : ""}`,
      top(matomo?.byChannel, "visits") && `Matomo visits by channel: ${top(matomo.byChannel, "visits")}${when(matomo)}`,
      top(matomo?.byEngine, "visits") &&
        `Matomo search visits by search engine: ${top(matomo.byEngine, "visits")}${when(matomo)}`,
      top(posthog?.byReferrer, "visits") &&
        `PostHog visits by referrer: ${top(posthog.byReferrer, "visits", 10, k => (k === "$direct" ? "direct" : k))}${when(posthog)}`,
      posthog?.referrersCaptured === false &&
        "PostHog: no visit in this period has a referrer, so it can't tell visits from search apart. Its zero visits from search may be wrong.",
      report(raw.aiReports?.google, "impressions", "Google AI Overviews and AI Mode", "on"),
      report(raw.aiReports?.bing, "citations", "Bing AI answers", "of"),
      others.length &&
        sisterHost &&
        `Bing: ${plural(others.length, "site")} ${others.length === 1 ? "links" : "link"} to ${sisterHost} but not to this site: ${others.slice(0, 10).join(", ")}${others.length > 10 ? ` and ${others.length - 10} more` : ""}`,
    ].filter(Boolean);
  };
  const connHtml = () => {
    const l = connLines();
    return l.length
      ? `\n    <details class="how conn"><summary>From your connections</summary>${l.map(t => `\n    <p class="quiet">${esc(t)}</p>`).join("")}</details>`
      : "";
  };
  const connMd = () => {
    const l = connLines();
    return l.length ? ["## From your connections", "", ...l.flatMap(t => [noteMd(t), ""])] : [];
  };

  // Search Central posts from google-updates.mjs --blog, listed by date and never offered as a cause. html: titles link
  // to Google's post, http(s) only.
  function googlePostsText(html = false) {
    const g = obj(raw.googleUpdates);
    if (!Array.isArray(g?.posts)) return "";
    const list = g.posts.filter(
      p => obj(p) && typeof p.title === "string" && p.title.trim() && /^\d{4}-\d{2}-\d{2}$/.test(p.date),
    );
    const day = d =>
      new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    const name = p =>
      !html
        ? noteMd(p.title)
        : /^https?:\/\//i.test(p.url)
          ? `<a href="${esc(p.url)}" rel="noopener">${esc(p.title)}</a>`
          : esc(p.title);
    return list.length
      ? `Google Search Central announcements in this period: ${list.map(p => `${name(p)} (${day(p.date)})`).join(" · ")}`
      : "Google Search Central posted no announcements in this period.";
  }
  // One row per crawl from seo-diff.mjs --history, shown from three crawls on, as two are just Since last audit.
  const timelineRows = () =>
    (Array.isArray(obj(raw.diff)?.timeline) ? raw.diff.timeline : [])
      .filter(x => obj(x) && !isNaN(Date.parse(x.date)) && isCount(x.pages))
      .slice(-100)
      .reverse();
  const timelineCells = x => [
    fmtDate(x.date),
    ...["pages", "findings", "regressions", "improvements", "added", "removed"].map(k =>
      isCount(x[k]) ? num(x[k]) : "–",
    ),
  ];
  const TIMELINE_HEAD = [
    "Crawl",
    "Pages",
    "Crawler findings",
    "Regressions",
    "Improvements",
    "Pages added",
    "Pages gone",
  ];
  const TIMELINE_INTRO =
    "Every crawl filed in seo-audit/history, newest first, each compared with the one before it. Crawler findings are the crawler's own count, before the audit's review. – means it couldn't be told: that crawl or the one before covered part of the site. Information only.";
  const diffMoreHtml = () => {
    const rows = timelineRows(),
      posts = googlePostsText(true);
    return (
      (posts ? `\n    <p class="quiet">${posts}</p>` : "") +
      (rows.length >= 3
        ? `\n    <details class="how timeline"><summary>Audit timeline</summary><p>${esc(TIMELINE_INTRO)}</p><div class="tablewrap"><table><thead><tr>${TIMELINE_HEAD.map(h => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows
            .map(
              x =>
                `<tr>${timelineCells(x)
                  .map(c => `<td>${esc(c)}</td>`)
                  .join("")}</tr>`,
            )
            .join("")}</tbody></table></div></details>`
        : "")
    );
  };
  const diffMoreMd = () => {
    const rows = timelineRows(),
      posts = googlePostsText();
    return [
      ...(posts ? ["## Google Search Central", "", posts, ""] : []),
      ...(rows.length >= 3
        ? [
            "## Audit timeline",
            "",
            TIMELINE_INTRO,
            "",
            `| ${TIMELINE_HEAD.join(" | ")} |`,
            `| --- |${" ---: |".repeat(6)}`,
            ...rows.map(x => `| ${timelineCells(x).join(" | ")} |`),
            "",
          ]
        : []),
    ];
  };

  // The health score is a local formula, and "How this score works" says so. Each page with open findings is scored by
  // the site's model, counting only findings whose examples name it (buildRules' assume). Evidence URLs on other hosts,
  // and files such as sitemaps and robots.txt, are left out. Paths are escaped.
  const SCORE_IS_OURS = `This is ${OWN_SCORE}: it counts only the rules this audit checked, and search engines don't use it.`;
  const PAGE_INTRO = `Each page with open findings, scored with the same rules as the site but counting only the findings listed for that page. It's ${OWN_SCORE}, and it doesn't change the site score. Pages come from the findings' examples, so a finding with more cases than examples can affect pages not listed here.`;
  const PAGE_FILE = /\.(xml|txt|json|gz|js|css)$/i; // files are told from pages by extension only
  const hostOf = u => {
    try {
      return new URL(u).host.replace(/^www\./, "");
    } catch {
      return null;
    }
  };
  const pageScores = (() => {
    if (!overall) return [];
    // The site's own pages: its public host and subdomains (staging.), or a local build the crawl ran on (localhost, a
    // LAN address, .local or .test). Pages are keyed by path, as elsewhere in the report. A preview on another domain
    // (a vercel.app link) isn't recognised.
    const home = hostOf(site.url),
      LOCAL =
        /^(localhost|127\.[\d.]+|0\.0\.0\.0|\[::1\]|10\.[\d.]+|192\.168\.[\d.]+|172\.(1[6-9]|2\d|3[01])\.[\d.]+)(:\d+)?$|\.(local|test|localhost)(:\d+)?$/i;
    const own = h => !home || h === home || h.endsWith("." + home) || LOCAL.test(h);
    const pages = new Map();
    for (const f of open)
      for (const e of f.evidence || []) {
        let u;
        try {
          u = new URL(e.url);
        } catch {
          continue;
        }
        if (!/^https?:$/.test(u.protocol) || !own(hostOf(u.href)) || PAGE_FILE.test(u.pathname)) continue;
        const p = u.pathname + u.search;
        (pages.get(p) || pages.set(p, new Set()).get(p)).add(f);
      }
    return [...pages]
      .map(([path, fs]) => ({
        path,
        ids: [...fs].map(f => f.id),
        value: score(buildRules({ assume: f => !fs.has(f) })).value,
      }))
      .sort((a, b) => a.value - b.value || b.ids.length - a.ids.length || a.path.localeCompare(b.path));
  })();
  const reportHtml = () =>
    pageScores.length
      ? `\n    <details class="how pagescores"><summary>Page scores</summary><p>${PAGE_INTRO}</p><div class="tablewrap"><table><thead><tr><th scope="col">Page</th><th scope="col">Score</th><th scope="col">Open findings</th></tr></thead><tbody>${pageScores
          .slice(0, 10)
          .map(
            p =>
              `<tr><td><code>${esc(p.path)}</code></td><td>${p.value}</td><td>${p.ids.map(id => `<a href="#${esc(id)}">${esc(id)}</a>`).join(", ")}</td></tr>`,
          )
          .join(
            "",
          )}</tbody></table></div>${pageScores.length > 10 && mdFile ? `<p>The 10 lowest. All ${num(pageScores.length)} pages are listed in <code>${esc(mdFile)}</code>.</p>` : ""}</details>`
      : "";
  const reportMd = () =>
    pageScores.length
      ? [
          "## Page scores",
          "",
          PAGE_INTRO,
          "",
          "| Page | Score | Open findings |",
          "| --- | ---: | --- |",
          ...pageScores.map(
            p => `| ${cellMd(noteCode(p.path))} | ${p.value}/100 | ${p.ids.map(id => cellMd(noteMd(id))).join(", ")} |`,
          ),
          "",
        ]
      : [];

  // Shown inside the "AI crawlers and agents" panel above: Brave's Googlebot fallback, Cloudflare's Bot Preference Sync
  // block (`botPreferenceSync`), aipref Content-Usage lines as written (`contentUsage`) and pages that answered the AI
  // probe with a 402 (`aiBotPaid`), as Cloudflare's pay per crawl does. Crawled text is escaped.
  // https://search.brave.com/help/brave-search-crawler
  // https://blog.cloudflare.com/bot-preference-sync/
  const usage = (Array.isArray(raw.contentUsage) ? raw.contentUsage : [])
    .filter(u => obj(u) && typeof u.rule === "string")
    .slice(0, 20);
  const paid = (Array.isArray(raw.aiBotPaid) ? raw.aiBotPaid : [])
    .filter(p => obj(p) && typeof p.url === "string" && typeof p.bot === "string")
    .slice(0, 20);
  const sync = raw.botPreferenceSync === true;
  const BRAVE_LINE =
    "Brave Search's crawler has no user agent of its own, so robots.txt can't name it, and it won't crawl a page Googlebot can't. Brave says robots.txt doesn't keep a page out of its results: a `noindex` robots meta tag does.";
  const SYNC_LINE =
    "This robots.txt has a block that Cloudflare adds, marked `# BEGIN Cloudflare Bot Preference Sync`. Cloudflare's Bot Preference Sync (announced 21 Aug 2026) writes the AI crawler choices made in Cloudflare's dashboard into the live robots.txt, in front of the site's own lines. So the robots.txt the site serves can differ from the one in the code: change those crawlers in Cloudflare's dashboard, as editing the file in the code won't change that block.";
  const USAGE_INTRO =
    "Content-Usage lines in robots.txt, shown as written. They come from the IETF's AI preferences drafts (August and September 2026), which aren't final, so the crawl doesn't judge them.";
  const PAID_INTRO =
    "Asked as an AI search crawler, these pages answered 402 Payment Required: the site asks crawlers to pay for the page. Cloudflare's pay per crawl answers this way, with the price in a crawler-price header. That's paid access, not a refusal, so it isn't a finding.";
  const paidRow = p => `${p.bot}${typeof p.price === "string" ? ` · crawler-price: ${p.price}` : ""}`;
  const aiPrefsOn = () => usage.length || paid.length || sync;
  const aiPartsHtml = () =>
    (bots.length ? `<p>${inl(BRAVE_LINE)}</p>` : "") +
    (sync ? `<p>${inl(SYNC_LINE)}</p>` : "") +
    (usage.length
      ? `<p>${esc(USAGE_INTRO)}</p><ul class="lim">${usage.map(u => `<li><b>${typeof u.agents === "string" ? `<code>User-agent: ${esc(u.agents)}</code>` : "No group (above the first User-agent line)"}</b><span><code>Content-Usage: ${esc(u.rule)}</code></span></li>`).join("")}</ul>`
      : "") +
    (paid.length
      ? `<p>${esc(PAID_INTRO)}</p><ul class="lim">${paid.map(p => `<li><b><code>${esc(notePath(p.url))}</code></b><span>${esc(paidRow(p))}</span></li>`).join("")}</ul>`
      : "");
  const aiPartsMd = () => [
    ...(bots.length ? [BRAVE_LINE, ""] : []),
    ...(sync ? [SYNC_LINE, ""] : []),
    ...(usage.length
      ? [
          USAGE_INTRO,
          "",
          ...usage.map(
            u =>
              `- ${typeof u.agents === "string" ? noteCode(`User-agent: ${u.agents}`) : "No group (above the first User-agent line)"}: ${noteCode(`Content-Usage: ${u.rule}`)}`,
          ),
          "",
        ]
      : []),
    ...(paid.length
      ? [PAID_INTRO, "", ...paid.map(p => `- ${noteCode(notePath(p.url))} ${noteMd(paidRow(p))}`), ""]
      : []),
  ];
  // linkIdeas and queryGaps (keyword-ideas.mjs), copied into the audit as they are. Searches and paths are escaped. Up
  // to 10 of each on the page, all of them (50 at most) in the Markdown.
  const aiRows = (key, list) =>
    (Array.isArray(raw[key]) ? raw[key] : []).filter(
      i =>
        obj(i) &&
        typeof i.page === "string" &&
        typeof i.query === "string" &&
        Number.isFinite(i.impressions) &&
        Array.isArray(i[list]) &&
        i[list].length &&
        i[list].every(s => typeof s === "string"),
    );
  // Google uses links for relevance and to find pages; the query-gap idea is from Chen and Koudas, a preprint.
  // https://developers.google.com/search/docs/crawling-indexing/links-crawlable
  // https://arxiv.org/abs/2610.15033
  const aiGroups = (code, text) =>
    /** @type {[string, string, string, string[][]][]} */ ([
      [
        "linkideas",
        "Internal link ideas",
        "Pages that mention a search another page shows for in Google, but don't link to that page. A link from them, in a sentence about the search, helps people and Google find the page that answers it. From Search Console and the crawl. Information only: none of this changes the score.",
        aiRows("linkIdeas", "from").map(i => [
          code(i.page),
          `${text(`gets ${plural(i.impressions, "impression")} for “${i.query}”. Pages that mention it but don't link to it:`)} ${i.from.map(code).join(", ")}`,
        ]),
      ],
      [
        "querygaps",
        "Searches a page doesn't mention",
        "Searches a page shows for in Google whose words its title, H1 and main text don't use. A page can't answer a search well if it never mentions it, and a 2026 study of AI answers (Chen and Koudas, a preprint, not yet peer reviewed) found that pages whose title and paragraphs match the questions people ask get cited more. Add the words only where they fit the page. Information only: none of this changes the score.",
        aiRows("queryGaps", "missing").map(i => [
          code(i.page),
          text(
            `shows for “${i.query}” (${plural(i.impressions, "impression")}), but doesn't use: ${i.missing.join(", ")}.`,
          ),
        ]),
      ],
    ]).filter(([, , , rows]) => rows.length);
  const linkIdeasHtml = () =>
    aiGroups(s => `<code>${esc(s)}</code>`, esc)
      .map(
        ([cls, title, intro, rows]) =>
          `\n    <details class="how ${cls}"><summary>${esc(title)}</summary><p>${esc(intro)}</p><ul class="lim">${rows
            .slice(0, 10)
            .map(([k, v]) => `<li><b>${k}</b><span>${v}</span></li>`)
            .join(
              "",
            )}</ul>${rows.length > 10 ? `<p>${num(rows.length - 10)} more in <code>seo-audit/keyword-ideas.md</code>.</p>` : ""}</details>`,
      )
      .join("");
  const linkIdeasMd = () =>
    aiGroups(noteCode, noteMd).flatMap(([, title, intro, rows]) => [
      `## ${title}`,
      "",
      intro,
      "",
      ...rows.map(([k, v]) => `- ${k} ${v}`),
      "",
    ]);
  // changeCheck, from change-check.mjs: one clicks line, never offered as a cause. Numbers are validated; the callers
  // escape text.
  const changeLine = () => {
    const c = obj(raw.changeCheck),
      m = obj(c?.clicks),
      g = obj(c?.groups),
      int = Number.isInteger;
    const ranged = m && [m.percent, m.low, m.high].every(int);
    if (
      !c ||
      !/^\d{4}-\d{2}-\d{2}$/.test(c.changeDate) ||
      !["likely up", "likely down", "inconclusive"].includes(m?.verdict) ||
      (!ranged && m.verdict !== "inconclusive")
    )
      return "";
    const signed = p => `${p > 0 ? "+" : p < 0 ? "−" : ""}${num(Math.abs(p))}%`,
      changed = obj(g?.changed)?.pages,
      control = obj(g?.control)?.pages;
    const when = new Date(c.changeDate + "T00:00:00Z").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    const what = ranged
      ? `${m.verdict}, about ${signed(m.percent)} compared with ${isCount(control) ? plural(control, "similar unchanged page") : "similar unchanged pages"} (likely range ${signed(m.low)} to ${signed(m.high)}${m.verdict === "inconclusive" ? ", which includes no change" : ""})`
      : `inconclusive${isText(m.reason) ? `, ${m.reason}` : ""}`;
    return `Change check, ${isCount(changed) ? plural(changed, "page") : "the pages"} changed on ${when}${isCount(c.days) ? `, ${c.days} days before and after` : ""}: Google Search clicks ${what}. This shows what happened to the numbers, not why. Information only.`;
  };
  const changeHtml = () => {
    const l = changeLine();
    return l ? `\n    <p class="quiet">${esc(l)}</p>` : "";
  };
  const changeMd = () => {
    const l = changeLine();
    return l ? ["## Change check", "", noteMd(l), ""] : [];
  };
  // Indexable pages with exactly one internal link in: the first 20, capped when the crawl stopped at --max. Paths are
  // escaped.
  const once = (o =>
    o && isCount(o.count) && Array.isArray(o.pages)
      ? {
          ...o,
          pages: o.pages.filter(p => obj(p) && typeof p.url === "string" && typeof p.from === "string").slice(0, 20),
        }
      : null)(obj(raw.linkedOnce));
  const onceIntro = () =>
    `${plural(once.count, "page")} that can be indexed ${once.count === 1 ? "has" : "have"} only one other page linking to ${once.count === 1 ? "it" : "them"}${once.count > once.pages.length ? `; the first ${num(once.pages.length)} are below` : ""}. A page linked from one place is easy to miss: visitors find it only if they open that one page, and crawlers, which find pages by following links, have a single way in, so the page is cut off if that link goes. A link from a hub or a related page helps both.${once.capped === true ? " The crawl stopped at --max, so links on pages it didn't read aren't counted." : ""} Information only: it doesn't change the score.`;
  const crawlLinksHtml = () =>
    once?.pages.length
      ? `\n    <details class="how linkedonce"><summary>Pages with one incoming link</summary><p>${esc(onceIntro())}</p><ul class="lim">${once.pages.map(p => `<li><b><code>${esc(notePath(p.url))}</code></b><span>linked only from <code>${esc(notePath(p.from))}</code></span></li>`).join("")}</ul></details>`
      : "";
  const crawlLinksMd = () =>
    once?.pages.length
      ? [
          "## Pages with one incoming link",
          "",
          noteMd(onceIntro()),
          "",
          ...once.pages.map(p => `- ${noteCode(notePath(p.url))} linked only from ${noteCode(notePath(p.from))}`),
          "",
        ]
      : [];
  // App link files missing or broken on a site that promotes an app, and PDFs that several pages or the menu link to,
  // which Microsoft Advertising advised against for core information (8 Oct 2025). Crawled text is escaped.
  // https://developers.google.com/search/blog/2025/05/app-deep-links
  const apps = (Array.isArray(raw.appLinks) ? raw.appLinks : [])
    .filter(a => obj(a) && ["Android", "iOS"].includes(a.platform) && isText(a.file) && isText(a.problem))
    .slice(0, 2);
  const pdfLinkFiles = (l =>
    l && Array.isArray(l.pdfs) ? l.pdfs.filter(p => obj(p) && isText(p.url) && isCount(p.pages)).slice(0, 20) : [])(
    obj(raw.pdfLinks),
  );
  const APP_INTRO =
    "The site links to its app. Phones open the site's links in the app only when a file on the site names the app. Google's post on app deep links (2 May 2025) says they don't change how Google ranks or shows pages: they take people from search results straight into the app. Information only: none of this changes the score.";
  const appTail = a =>
    `${a.problem}. ${a.missing === true ? "That's fine if the app doesn't open the site's links." : `${a.platform === "iOS" ? "iPhones" : "Android phones"} won't open the site's links in the app until it's fixed.`}`;
  const PDF_INTRO =
    "PDFs on the site that 3 or more pages link to (our own cut-off), or that the menu links to. Microsoft Advertising's guide to AI search answers (8 Oct 2025) says to avoid relying on PDFs for core information: search engines can read text PDFs, but they often lack the headings and other structure HTML gives. If any of these hold something important, such as prices, a menu, specifications or opening hours, put it on an HTML page too. Information only: none of this changes the score.";
  const pdfTail = p => `linked from ${plural(p.pages, "page")}${p.menu === true ? ", including the menu" : ""}`;
  const hygieneHtml = () =>
    apps.length || pdfLinkFiles.length
      ? `\n    <details class="how hygiene"><summary>App links and PDFs</summary>` +
        (apps.length
          ? `<p>${esc(APP_INTRO)}</p><ul class="lim">${apps.map(a => `<li><b>${esc(a.platform)}</b><span><code>${esc(a.file)}</code> ${esc(appTail(a))}</span></li>`).join("")}</ul>`
          : "") +
        (pdfLinkFiles.length
          ? `<p>${esc(PDF_INTRO)}</p><ul class="lim">${pdfLinkFiles.map(p => `<li><b><code>${esc(notePath(p.url))}</code></b><span>${esc(pdfTail(p))}</span></li>`).join("")}</ul>`
          : "") +
        `</details>`
      : "";
  const hygieneMd = () =>
    apps.length || pdfLinkFiles.length
      ? [
          "## App links and PDFs",
          "",
          ...(apps.length
            ? [
                APP_INTRO,
                "",
                ...apps.map(a => `- ${noteMd(a.platform)}: ${noteCode(a.file)} ${noteMd(appTail(a))}`),
                "",
              ]
            : []),
          ...(pdfLinkFiles.length
            ? [PDF_INTRO, "", ...pdfLinkFiles.map(p => `- ${noteCode(notePath(p.url))} ${noteMd(pdfTail(p))}`), ""]
            : []),
        ]
      : [];
  // newQueries: searches with no row in the previous period, the first 10 as given (most impressions first). Search
  // text is third-party, escaped where shown.
  const newSearchLine = () => {
    const q = (Array.isArray(raw.newQueries) ? raw.newQueries : [])
      .filter(x => obj(x) && typeof x.query === "string" && x.query && Number.isFinite(x.impressions))
      .slice(0, 10);
    return q.length
      ? `New searches this period, with no impressions in the period before: ${q.map(x => `${x.query} (${num(x.impressions)} impressions)`).join(" · ")}. Google hides searches very few people make, so a few of these may have shown the site before. Information only.`
      : "";
  };
  const dataHtml = () => {
    const l = newSearchLine();
    return l ? `\n    <p class="quiet">${esc(l)}</p>` : "";
  };
  const dataMd = () => {
    const l = newSearchLine();
    return l ? ["## New searches", "", noteMd(l), ""] : [];
  };
  // Every turned-off check, changed severity and warning about settings.json, so a setting is never silent. Ids and
  // warnings come from the user's file, so they're escaped.
  const SETTINGS_INTRO =
    "From seo-audit/settings.json, this project's own settings. A check turned off is left out of the findings, and the score leaves turned-off checks out, as if they hadn't run. A changed severity counts in the score too. Blockers can't be turned off or lowered there.";
  const settingRows = () => [
    ...checkSettings.off.map(o => [
      o.check,
      `Turned off: ${o.count ? `${plural(o.count, "finding")} left out` : "no findings this run"}.`,
    ]),
    ...checkSettings.changed.map(c => [
      c.check,
      `Severity set to ${c.to === "needs-decision" ? "decision needed" : c.to}: ${c.count ? `${plural(c.count, "finding")} changed` : "no findings this run"}.`,
    ]),
  ];
  const settingsSummary = () =>
    [
      checkSettings.off.length && `${plural(checkSettings.off.length, "check")} turned off`,
      checkSettings.changed.length && `${plural(checkSettings.changed.length, "severity", "severities")} changed`,
      checkSettings.warnings.length && plural(checkSettings.warnings.length, "warning"),
    ]
      .filter(Boolean)
      .join(" · ");
  const anyRecheck = () => findings.some(f => recheckOf(f));
  // lighthouse.mjs keeps each failed audit with its category title, "Accessibility" in the English runs it starts.
  // Accessibility audits are pass or fail, and some checks, such as trapped focus, need a manual review.
  // https://developer.chrome.com/docs/lighthouse/accessibility/scoring
  const a11yRuns = (Array.isArray(raw.lighthouse) ? raw.lighthouse : [])
    .filter(x => obj(x) && typeof x.url === "string" && Array.isArray(x.detail))
    .map(x => ({
      path: notePath(x.url),
      score: Number.isInteger(x.scores?.accessibility) ? x.scores.accessibility : null,
      audits: x.detail
        .filter(a => obj(a) && typeof a.title === "string" && a.category === "Accessibility")
        .map(a => ({
          title: a.title,
          items: (Array.isArray(a.items) ? a.items : []).filter(s => typeof s === "string" && s).slice(0, 10),
        })),
    }))
    .filter(x => x.audits.length);
  const A11Y_INTRO =
    "Lighthouse's own accessibility checks that failed on each page it ran, with the page elements it names (10 at most). Each check is pass or fail. They're Lighthouse's checks, not SEO Supervisor's, and they can't find everything: some problems, such as keyboard focus that gets trapped, only a person can check. Information only: they don't change the score.";
  const a11yHead = x =>
    `${x.score != null ? `Accessibility ${x.score} · ` : ""}${plural(x.audits.length, "failed check")}`;
  const flowHtml = () =>
    [
      settingRows().length || checkSettings.warnings.length
        ? `\n    <details class="how checksettings"><summary>Check settings: ${esc(settingsSummary())}</summary><p>${esc(SETTINGS_INTRO)}</p><ul class="lim">${settingRows()
            .map(([id, t]) => `<li><b><code>${esc(id)}</code></b><span>${esc(t)}</span></li>`)
            .join(
              "",
            )}${checkSettings.warnings.map(w => `<li><b>Warning</b><span>${esc(w)}</span></li>`).join("")}</ul></details>`
        : "",
      anyRecheck() ? `\n    <p class="quiet">${esc(RECHECK_NOTE)}</p>` : "",
      a11yRuns.length
        ? `\n    <details class="how a11y"><summary>Lighthouse's accessibility checks · ${plural(a11yRuns.length, "page")} with failed checks</summary><p>${esc(A11Y_INTRO)}</p>${a11yRuns
            .slice(0, 10)
            .map(
              x =>
                `<details><summary><code>${esc(x.path)}</code> · ${esc(a11yHead(x))}</summary><ul class="lim">${x.audits.map(a => `<li><b>${inl(a.title)}</b><span>${a.items.map(s => `<code>${esc(s)}</code>`).join(", ")}</span></li>`).join("")}</ul></details>`,
            )
            .join(
              "",
            )}${a11yRuns.length > 10 && mdFile ? `<p>All ${num(a11yRuns.length)} pages are listed in <code>${esc(mdFile)}</code>.</p>` : ""}</details>`
        : "",
    ].join("");
  const flowMd = () => [
    ...(settingRows().length || checkSettings.warnings.length
      ? [
          "## Check settings",
          "",
          SETTINGS_INTRO,
          "",
          ...settingRows().map(([id, t]) => `- ${noteCode(id)} ${noteMd(t)}`),
          ...checkSettings.warnings.map(w => `- Warning: ${noteMd(w)}`),
          "",
        ]
      : []),
    ...(anyRecheck() ? ["## Checking a fix yourself", "", RECHECK_NOTE, ""] : []),
    ...(a11yRuns.length
      ? [
          "## Lighthouse's accessibility checks",
          "",
          A11Y_INTRO,
          "",
          ...a11yRuns.flatMap(x => [
            `### ${noteCode(x.path)} (${a11yHead(x)})`,
            "",
            ...x.audits.map(
              a => `- ${noteMd(a.title)}${a.items.length ? `: ${a.items.map(noteCode).join(", ")}` : ""}`,
            ),
            "",
          ]),
        ]
      : []),
  ];
  // linkStrength is a local measure, 0–100: PageRank over the site's own links (sources in checks/link-strength.mjs).
  // With Search Console traffic it also lists, of the 20 crawled pages with the most clicks, those in the bottom third
  // of strength, a local rule. Paths are escaped.
  const n0 = x => Number(x) || 0;
  const ls = (s => {
    const pages =
      s && obj(s.pages)
        ? Object.entries(s.pages)
            .filter(([, v]) => Number.isInteger(v) && v >= 0 && v <= 100)
            .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        : [];
    if (!pages.length) return null;
    const asc = pages.map(([, v]) => v).reverse(),
      cut = asc[Math.ceil(asc.length / 3) - 1],
      top = pages[0][1];
    const weak = traffic
      ? pages
          .map(([u, v]) => ({ u, v, t: byPath(traffic, u) }))
          .filter(x => x.t && (n0(x.t.clicks) || n0(x.t.impressions)))
          .sort((a, b) => n0(b.t.clicks) - n0(a.t.clicks) || n0(b.t.impressions) - n0(a.t.impressions))
          .slice(0, 20)
          .filter(x => x.v <= cut && x.v < top)
      : [];
    return { pages, median: isCount(s.median) ? s.median : null, capped: s.capped === true, weak };
  })(obj(raw.linkStrength));
  const LS_LABEL =
    "This is our own measure, computed with the PageRank formula (Brin and Page, 1998) on this site's own links. It's not Google's PageRank, which uses links from the whole web and isn't public.";
  const lsIntro = () =>
    `How much of the site's own linking reaches each page, from 0 to 100. ${LS_LABEL} A page gets more when more pages link to it, and more again when those pages are strong. 100 is the site's strongest page, and 0 means no more than a page nothing links to. The scale is logarithmic: the home page and a few others usually hold most of the strength, and on a straight scale nearly every other page would read close to 0. Here, twice the share of links is always the same number of extra points. It's relative to the ${plural(ls.pages.length, "page")} this crawl read that can be indexed${ls.median != null ? `; half of them have a strength of ${ls.median} or less` : ""}.${ls.capped ? " The crawl stopped at --max, so links on pages it didn't read aren't counted." : ""} Information only: it doesn't change the score.`;
  const weakIntro = () =>
    `Found in search, but little link strength: of the 20 crawled pages with the most Search Console clicks, then impressions${raw.trafficPeriod ? ` (${String(raw.trafficPeriod).toLowerCase()})` : ""}, these are in the bottom third of the site's strength (our own rule). People already find them in search, so they're worth more links from your own pages. Link to them from the strongest pages above, in a sentence about what they cover, and see Internal link ideas for pages that already mention their searches.`;
  const weakTail = x =>
    `strength ${x.v} · Search Console: ${num(n0(x.t.clicks))} clicks · ${num(n0(x.t.impressions))} impressions`;
  const scoreHtml = () =>
    ls
      ? `\n    <details class="how linkstrength"><summary>Internal link strength</summary><p>${esc(lsIntro())}</p><ul class="lim">${ls.pages
          .slice(0, 10)
          .map(([u, v]) => `<li><b><code>${esc(u)}</code></b><span>strength ${v}</span></li>`)
          .join("")}</ul>` +
        (ls.weak.length
          ? `<p>${esc(weakIntro())}</p><ul class="lim">${ls.weak.map(x => `<li><b><code>${esc(x.u)}</code></b><span>${esc(weakTail(x))}</span></li>`).join("")}</ul>`
          : "") +
        `</details>`
      : "";
  const scoreMd = () =>
    ls
      ? [
          "## Internal link strength",
          "",
          noteMd(lsIntro()),
          "",
          ...ls.pages.slice(0, 10).map(([u, v]) => `- ${noteCode(u)} strength ${v}`),
          "",
          ...(ls.weak.length
            ? [noteMd(weakIntro()), "", ...ls.weak.map(x => `- ${noteCode(x.u)} ${noteMd(weakTail(x))}`), ""]
            : []),
        ]
      : [];
  // aiAnswers comes from ai-answers.json: per engine, how many sampled answers cited the site and each rival. It's a
  // count from a small sample, so never a score or a finding. Questions, rivals, pages and errors are user or provider
  // text, so they're escaped.
  const aiAnswerData = (a => {
    const cnt = x => (Number.isInteger(x) && x >= 0 ? x : null),
      strs = x => (Array.isArray(x) ? x.filter(s => typeof s === "string") : []);
    const counts = m => Object.entries(obj(m) || {}).filter(([, v]) => cnt(v) !== null);
    const engines = Object.values(obj(a?.engines) || {})
      .map(obj)
      .filter(
        e =>
          e &&
          typeof e.name === "string" &&
          cnt(e.answers) !== null &&
          cnt(e.cited) !== null &&
          (e.answers > 0 || typeof e.error === "string"),
      );
    return engines.length
      ? {
          date: /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : "an unknown date",
          questions: strs(a.questions).length,
          repeat: cnt(a.repeat) || 1,
          engines: engines.map(e => ({
            ...e,
            rivals: counts(e.rivals),
            pages: counts(e.pages),
            never: strs(e.neverCited),
          })),
        }
      : null;
  })(obj(raw.aiAnswers));
  const AI_ANSWERS_INTRO =
    "Whether AI answer engines cited your site when they answered the questions you chose, asked through each provider's API with your own keys. These answers can differ from what people see in the ChatGPT or Perplexity apps, which add personal settings and location, and answers change from day to day. So this is a sample to compare over time, not a ranking. Information only: it doesn't change the score.";
  const aiName = e => `${e.name}${typeof e.model === "string" ? ` (${e.model})` : ""}`;
  const aiHead = e =>
    `your site was cited in ${e.cited} of ${plural(e.answers, "answer")} (a sample: ${plural(aiAnswerData.questions, "question")}, asked ${aiAnswerData.repeat === 1 ? "once" : `${aiAnswerData.repeat} times`} each, on ${aiAnswerData.date}).`;
  const aiStop = e =>
    typeof e.error === "string" ? `${e.name} stopped after ${plural(e.answers, "answer")}: ${e.error}` : "";
  const aiCited = n => `cited in ${plural(n, "answer")}`;
  const aiLists = e =>
    [
      ["Rivals", e.rivals.map(([d, n]) => [d, `cited in ${n} of ${plural(e.answers, "answer")}`])],
      ["Your pages cited", e.pages.map(([p, n]) => [p, aiCited(n)])],
      ["Questions whose answers never cited your site", e.never.map(q => [q, ""])],
    ].filter(([, rows]) => rows.length);
  const answersHtml = () =>
    aiAnswerData
      ? `\n    <details class="how aianswers"><summary>AI answer check</summary><p>${esc(AI_ANSWERS_INTRO)}</p>${aiAnswerData.engines
          .map(
            e =>
              `<p><b>${esc(aiName(e))}</b>: ${esc(aiHead(e))}${aiStop(e) ? ` ${esc(aiStop(e))}` : ""}</p>${aiLists(e)
                .map(
                  ([t, rows]) =>
                    `<p>${esc(t)}:</p><ul class="lim">${rows.map(([k, v]) => `<li><b>${t === "Your pages cited" ? `<code>${esc(k)}</code>` : esc(k)}</b>${v ? `<span>${esc(v)}</span>` : ""}</li>`).join("")}</ul>`,
                )
                .join("")}`,
          )
          .join("")}</details>`
      : "";
  const answersMd = () =>
    aiAnswerData
      ? [
          "## AI answer check",
          "",
          noteMd(AI_ANSWERS_INTRO),
          "",
          ...aiAnswerData.engines.flatMap(e => [
            `### ${noteMd(e.name)}`,
            "",
            noteMd(`${aiName(e)}: ${aiHead(e)}`),
            "",
            ...(aiStop(e) ? [noteMd(aiStop(e)), ""] : []),
            ...aiLists(e).flatMap(([t, rows]) => [
              `${t}:`,
              "",
              ...rows.map(
                ([k, v]) => `- ${t === "Your pages cited" ? noteCode(k) : noteMd(k)}${v ? ` ${noteMd(v)}` : ""}`,
              ),
              "",
            ]),
          ]),
        ]
      : [];
  // geoGrid comes from geo-grid.json. Google's terms forbid Places results on a non-Google map, so it's a plain grid
  // with north at the top, credited "Google Maps". Counts come from the cells, never the file's own totals, and the
  // label is written here, not read from the file.
  // https://cloud.google.com/maps-platform/terms/maps-service-terms
  const GRID_SIZES = new Set([5, 7, 9]);
  const grid = (g => {
    if (!g || !GRID_SIZES.has(g.size) || !Array.isArray(g.keywords)) return null;
    const n = g.size,
      inGrid = c => obj(c) && [c.row, c.col].every(v => Number.isInteger(v) && v >= 0 && v < n);
    const rankOf = r => (Number.isInteger(r) && r >= 1 && r <= 20 ? r : r === "error" ? "error" : null);
    const keywords = g.keywords
      .filter(k => obj(k) && typeof k.keyword === "string" && k.keyword.trim() && Array.isArray(k.cells))
      .slice(0, 3)
      .map(k => {
        const at = Array.from({ length: n }, () => Array(n).fill(undefined));
        for (const c of k.cells.filter(inGrid)) at[c.row][c.col] = rankOf(c.rank);
        const seen = at.flat().filter(v => v !== undefined),
          count = f => seen.filter(f).length,
          ranked = r => typeof r === "number";
        return {
          keyword: k.keyword.trim(),
          at,
          points: seen.length,
          top3: count(r => ranked(r) && r <= 3),
          top10: count(r => ranked(r) && r <= 10),
          notFound: count(r => r === null),
          failed: count(r => r === "error"),
        };
      })
      .filter(k => k.points === n * n); // a grid with holes would mislead, so it isn't drawn
    if (!keywords.length) return null;
    // The run's own notes, including any third-party credit Google returned, which its terms require showing.
    const notes = (Array.isArray(g.notes) ? g.notes : [])
      .filter(t => typeof t === "string" && t.trim())
      .slice(0, 6)
      .map(t => t.trim().slice(0, 400));
    return {
      n,
      keywords,
      notes,
      km: Number.isFinite(g.spacingKm) && g.spacingKm > 0 && g.spacingKm <= 50 ? g.spacingKm : null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(g.date) ? g.date : null,
    };
  })(obj(raw.geoGrid));
  const GRID_BANDS = [
    ["top3", "1–3"],
    ["top10", "4–10"],
    ["top20", "11–20"],
    ["out", "Not in the top 20"],
    ["err", "Not checked"],
  ];
  const gridBand = r => (r === "error" ? "err" : r === null ? "out" : r <= 3 ? "top3" : r <= 10 ? "top10" : "top20");
  const gridIntro = () =>
    `Where your business appears in the list Google's Places API returns near each spot: an approximation of Google Maps results, not a copy. Each square is a spot${grid.km ? ` ${+grid.km.toFixed(2)} km` : ""} apart around your business, north at the top, and the outlined square is your business.${grid.date ? ` Checked on ${fmtDate(grid.date)}.` : ""} Information only: it doesn't change the score.`;
  const gridLine = k =>
    `Top 3 at ${k.top3} of ${k.points} spots · top 10 at ${k.top10} · not in the top 20 at ${k.notFound}${k.failed ? ` · ${k.failed} not checked` : ""}`;
  // Where a square is, from the business: "2 km north, 1 km west".
  const gridWhere = (row, col) => {
    const c = (grid.n - 1) / 2,
      away = (d, plus, minus) =>
        d &&
        `${grid.km ? `${+(Math.abs(d) * grid.km).toFixed(2)} km` : plural(Math.abs(d), "square")} ${d > 0 ? plus : minus}`;
    return row === c && col === c
      ? "Your business"
      : [away(row - c, "south", "north"), away(col - c, "east", "west")].filter(Boolean).join(", ");
  };
  const gridSay = r =>
    r === "error" ? "not checked, the request failed" : r === null ? "not in the top 20" : `position ${r}`;
  const gridHtml = () =>
    grid
      ? `\n    <details class="how geogrid"><summary>Local rank grid</summary><p>${esc(gridIntro())}</p>` +
        `<p class="gg-legend">${GRID_BANDS.filter(([b]) => b !== "err" || grid.keywords.some(k => k.failed))
          .map(([b, t]) => `<span><i class="gg-${b}" aria-hidden="true"></i>${esc(t)}</span>`)
          .join("")}</p><div class="gg-list">` +
        grid.keywords
          .map(
            k =>
              `<figure class="gg"><figcaption><b>${esc(k.keyword)}</b><span>${esc(gridLine(k))}</span></figcaption><span class="gg-north" aria-hidden="true">North</span>` +
              `<div class="gg-grid" style="--n:${grid.n}" role="img" aria-label="${esc(`${k.keyword}: ${gridLine(k).replace(/^Top/, "top")}`)}">` +
              k.at
                .map((row, i) =>
                  row
                    .map(
                      (r, j) =>
                        `<span class="gg-c gg-${gridBand(r)}${i === (grid.n - 1) / 2 && j === i ? " gg-centre" : ""}" title="${esc(`${gridWhere(i, j)}: ${gridSay(r)}`)}">${r === "error" ? "–" : r === null ? "20+" : r}</span>`,
                    )
                    .join(""),
                )
                .join("") +
              `</div><p class="gg-credit">Places data: Google Maps</p></figure>`,
          )
          .join("") +
        `</div>${grid.notes.map(t => `<p>${esc(t)}</p>`).join("")}</details>`
      : "";
  const gridMd = () =>
    grid
      ? [
          "## Local rank grid",
          "",
          noteMd(gridIntro()),
          "",
          ...grid.keywords.flatMap(k => [
            `### ${noteMd(k.keyword)}`,
            "",
            noteMd(gridLine(k)),
            "",
            "```",
            "North",
            ...k.at.map((row, i) =>
              row
                .map((r, j) => {
                  const t = r === "error" ? "-" : r === null ? "20+" : String(r);
                  return (i === (grid.n - 1) / 2 && j === i ? `[${t}]` : t).padStart(3);
                })
                .join(" "),
            ),
            "```",
            "",
          ]),
          "Places data: Google Maps",
          "",
          ...grid.notes.flatMap(t => [noteMd(t), ""]),
        ]
      : [];
  const panelsHtml = () =>
    [
      secHtml,
      crawlScopeHtml,
      aiCrawlersHtml,
      shopHtml,
      mediaHtml,
      renderHtml,
      contentHtml,
      localHtml,
      backlinksHtml,
      connHtml,
      diffMoreHtml,
      reportHtml,
      linkIdeasHtml,
      changeHtml,
      crawlLinksHtml,
      hygieneHtml,
      dataHtml,
      flowHtml,
      scoreHtml,
      answersHtml,
      gridHtml,
    ]
      .map(f => f())
      .join("");
  const panelsMd = () =>
    [
      secMd,
      crawlScopeMd,
      aiCrawlersMd,
      shopMd,
      mediaMd,
      renderMd,
      contentMd,
      localMd,
      backlinksMd,
      connMd,
      diffMoreMd,
      reportMd,
      linkIdeasMd,
      changeMd,
      crawlLinksMd,
      hygieneMd,
      dataMd,
      flowMd,
      scoreMd,
      answersMd,
      gridMd,
    ].flatMap(f => f());

  // audiences (audience.md) is written into seo-audit.json and may quote page text, so every string is escaped.
  // Malformed entries are dropped quietly, and lists are capped at 4 audiences, 5 pages each and 10 items a list.
  const audStrs = x => (Array.isArray(x) ? x.filter(s => typeof s === "string" && s.trim()).slice(0, 10) : []);
  const audiences = (Array.isArray(raw.audiences) ? raw.audiences : [])
    .filter(a => obj(a) && typeof a.name === "string" && a.name.trim())
    .map(a => ({
      name: a.name,
      who: [
        typeof a.wants === "string" && a.wants.trim() && `What they come for: ${a.wants}.`,
        typeof a.checked === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.checked) && `Checked on ${a.checked}.`,
      ]
        .filter(Boolean)
        .join(" "),
      pages: (Array.isArray(a.pages) ? a.pages : [])
        .filter(p => obj(p) && typeof p.url === "string" && p.url.trim())
        .map(p => ({
          path: notePath(p.url),
          lines: [audStrs(p.has), audStrs(p.missing)]
            .map((l, i) => l.length && `${i ? "Missing" : "On the page"}: ${l.join(" · ")}`)
            .filter(Boolean),
        }))
        .filter(p => p.lines.length)
        .slice(0, 5),
    }))
    .filter(a => a.pages.length)
    .slice(0, 4);
  const AUDIENCE_INTRO =
    "What your key pages give each audience you named, with evidence from the page. It's a checklist, not a score: it never changes the score or the findings. A missing item becomes new text only through brief or rewrite mode, and only with your yes.";
  const audienceHtml = () =>
    audiences.length
      ? `\n    <details class="how audience"><summary>Audience check</summary><p>${esc(AUDIENCE_INTRO)}</p>${audiences.map(a => `<p><b>${esc(a.name)}</b>${a.who ? ` · ${esc(a.who)}` : ""}</p><ul class="lim">${a.pages.map(p => `<li><b><code>${esc(p.path)}</code></b><span>${p.lines.map(esc).join("<br>")}</span></li>`).join("")}</ul>`).join("")}</details>`
      : "";
  const audienceMd = () =>
    audiences.length
      ? [
          "## Audience check",
          "",
          AUDIENCE_INTRO,
          "",
          ...audiences.flatMap(a => [
            `### ${noteMd(a.name)}`,
            "",
            ...(a.who ? [noteMd(a.who), ""] : []),
            ...a.pages.flatMap(p => [`- ${noteCode(p.path)}`, ...p.lines.map(l => `  - ${noteMd(l)}`)]),
            "",
          ]),
        ]
      : [];

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
      : `<section class="panel empty-state"><h2>No limits recorded</h2><p>Every planned check ran.</p></section>`;

  const diff = raw.diff && typeof raw.diff === "object" ? raw.diff : null;
  const DIFF_KIND = {
    "canonical-changed": ["Canonical changed", "URL-04"],
    "noindex-added": ["Now noindex", "CRAWL-02"],
    "noindex-removed": ["No longer noindex", "CRAWL-02"],
    "title-changed": ["Title changed", "META-01"],
    "h1-removed": ["H1 removed", "CONTENT-01"],
    "h1-added": ["H1 added", "CONTENT-01"],
    "schema-removed": ["Schema removed", "SCHEMA-03"],
    "schema-added": ["Schema added", "SCHEMA-03"],
    "status-error": ["Now an error", "CRAWL-05"],
    "status-fixed": ["Error fixed", "CRAWL-05"],
    "description-changed": ["Description changed", "META-02"],
    "og-removed": ["Open Graph tags removed", "META-04"],
    "og-added": ["Open Graph tags added", "META-04"],
    "content-shrunk": ["Word count fell", "CONTENT-05"],
    "content-grew": ["Word count grew", "CONTENT-05"],
    "speed-slower": ["Now slower", "PERF-01"],
    "speed-faster": ["Now faster", "PERF-01"],
    "schema-fields-removed": ["Schema fields removed", "SCHEMA-03"],
    "schema-fields-added": ["Schema fields added", "SCHEMA-03"],
    "robots-changed": ["robots.txt changed", "MAP-05"],
    "left-sitemap": ["Left the sitemap", "MAP-03"],
    "joined-sitemap": ["Joined the sitemap", "MAP-03"],
    "lost-internal-links": ["Fewer internal links", "LINK-02"],
    "redirect-changed": ["Redirect changed", "URL-07"],
    "redirect-added": ["Now redirects", "URL-07"],
    "redirect-removed": ["Redirect removed", "URL-07"],
    "h1-changed": ["H1 changed", "CONTENT-01"],
    "h2-changed": ["H2s changed", "CONTENT-02"],
    "hreflang-changed": ["hreflang changed", "META-08"],
    "schema-retired-removed": ["Retired schema removed", "SCHEMA-05"],
    "section-shrunk": ["Section shrank", null],
  };
  const diffSections = d =>
    [
      ["Regressions", d.regressions],
      ["Improvements", d.improvements],
      ["Other changes", d.changed],
    ].filter(([, list]) => (list || []).length);
  const diffText = c =>
    `${DIFF_KIND[c.kind]?.[0] || c.kind}${c.source ? ` (${c.source})` : ""}: ${c.detail ?? `${c.before ?? "none"} → ${c.after ?? "none"}`}`;
  // The finding on the same page and rule, if any.
  const diffFinding = c =>
    findings.find(
      f =>
        f.rule === DIFF_KIND[c.kind]?.[1] &&
        (f.evidence || []).some(e => {
          try {
            return new URL(e.url).pathname === c.path;
          } catch {
            return false;
          }
        }),
    );
  // "Nothing changed" claims a field only when both crawls recorded it.
  const sameFields = d => {
    const c = new Set(d.compared || []);
    const f = [
      "status",
      "indexing",
      "canonical",
      "title",
      c.has("description") && "description",
      c.has("og") && "share tags",
      "H1",
      c.has("h2") && "H2s",
      c.has("hreflang") && "hreflang",
      "schema",
      c.has("schemaProps") && "schema fields",
      c.has("words") && "length",
      c.has("sitemap") && "sitemap listing",
      c.has("links") && "internal links",
    ].filter(Boolean);
    const also = [
      c.has("redirects") && "no redirect changed",
      c.has("robots") && "robots.txt has the same rules",
      c.has("sections") && "no section lost half its pages",
      c.has("speed") && "no page got much faster or slower",
    ].filter(Boolean);
    return `${f.slice(0, -1).join(", ")} and ${f.at(-1)} as last time${also.length ? `, ${[...also.slice(0, -1), `and ${also.at(-1)}`].join(", ")}` : ""}`;
  };
  // Why no page is listed as gone or added: true means --max stopped the crawl, "section" means --include/--exclude.
  const unknownText = (why, which) =>
    why === "section"
      ? `${which === "gone" ? "This crawl" : "The last crawl"} covered one part of the site (--include or --exclude), so pages outside it aren't listed as ${which}.`
      : why === true
        ? `${which === "gone" ? "This crawl" : "The last crawl"} stopped at its page limit (--max), so pages it didn't reach aren't listed as ${which}.`
        : "";
  const unknownLines = d =>
    [unknownText(d.removedUnknown, "gone"), unknownText(d.addedUnknown, "added")].filter(Boolean);
  // seo-diff.mjs's addedBurst, a local threshold (50 pages and 20%). It shows the count and where the pages are, never
  // what they're about, and paths and titles come from the crawl, so they're escaped.
  const HACKED_HELP = "https://support.google.com/webmasters/answer/9044101#hacked-url-injection";
  const BURST_NOTE =
    "Our own line: this shows when at least 50 pages are new and they add at least 20% to the pages the last audit found. Information only: it doesn't change the score.";
  const burst = (b =>
    b && isCount(b.pages) && isCount(b.before) && b.before > 0
      ? {
          pages: b.pages,
          before: b.before,
          sections: (Array.isArray(b.sections) ? b.sections : []).filter(
            s => typeof s?.path === "string" && isCount(s.pages),
          ),
          examples: (Array.isArray(b.examples) ? b.examples : []).filter(e => typeof e?.path === "string").slice(0, 10),
        }
      : null)(obj(diff?.addedBurst));
  const burstText = () =>
    `${num(burst.pages)} new pages appeared since the last audit${diff.since ? ` (on ${fmtDate(diff.since)})` : ""}, ${Math.round((100 * burst.pages) / burst.before)}% more than the ${num(burst.before)} pages it found. If you didn't add them, check for hacked or spam pages`;
  // "/blog/ 12 · /cheap-pills/ 180"; folders past seo-diff's top 20 are summed into one count.
  const burstFolders = code => {
    const other = burst.pages - burst.sections.reduce((n, s) => n + s.pages, 0);
    return `New pages by folder: ${burst.sections.map(s => `${code(s.path)}${s.path === "/" ? " (top level)" : ""} ${num(s.pages)}`).join(" · ")}${other > 0 ? ` · other folders ${num(other)}` : ""}`;
  };
  const burstHtml = () =>
    burst
      ? `<section class="panel"><h2>Many new pages<span class="mono quiet"> ${num(burst.pages)}</span></h2><p>${esc(burstText())}: see <a href="${HACKED_HELP}" rel="noopener">Google's help on hacked content</a>.</p>${burst.sections.length ? `<p class="quiet">${burstFolders(esc)}</p>` : ""}${burst.examples.length ? `<p class="quiet">Some of them, from different folders:</p><ul class="lim">${burst.examples.map(e => `<li><b><code>${esc(e.path)}</code></b><span>${esc(e.title || "no title")}</span></li>`).join("")}</ul>` : ""}<p class="quiet">${BURST_NOTE}</p></section>
  `
      : "";
  const burstMd = () =>
    burst
      ? [
          "### Many new pages",
          "",
          `${noteMd(burstText())}: see Google's help on hacked content, ${HACKED_HELP}`,
          "",
          ...(burst.sections.length ? [burstFolders(noteCode), ""] : []),
          ...(burst.examples.length
            ? [
                "Some of them, from different folders:",
                "",
                ...burst.examples.map(e => `- ${noteCode(e.path)} ${e.title ? noteMd(e.title) : "no title"}`),
                "",
              ]
            : []),
          BURST_NOTE,
          "",
        ]
      : [];
  const diffHtml = () => `<div class="limits">
  ${burstHtml()}<p class="quiet">Compared with the crawl of ${esc(fmtDate(diff.since))}. Pages are matched by path.${unknownLines(
    diff,
  )
    .map(t => ` ${t}`)
    .join(
      "",
    )}</p>${googleUpdatesText() ? `\n  <p class="quiet">${googleUpdatesText(true)}</p>` : ""}${googlePostsText() ? `\n  <p class="quiet">${googlePostsText(true)}</p>` : ""}${linksDiffHtml()}
  ${diffSections(diff)
    .map(
      ([h, list]) =>
        `<section class="panel"><h2>${h}<span class="mono quiet"> ${list.length}</span></h2><ul class="lim">${list
          .map(c => {
            const f = diffFinding(c);
            return `<li><b><code>${esc(c.path)}</code></b><span>${esc(diffText(c))}${f ? ` · <a href="#${esc(f.id)}">${esc(f.id)}</a>` : ""}</span></li>`;
          })
          .join("")}</ul></section>`,
    )
    .join("")}
  ${[
    ["Pages added", diff.added],
    ["Pages gone", diff.removed],
  ]
    .filter(([, l]) => (l || []).length)
    .map(
      ([h, l]) =>
        `<section class="panel"><h2>${h}<span class="mono quiet"> ${l.length}</span></h2><ul class="lim">${l.map(p => `<li><span><code>${esc(p)}</code></span></li>`).join("")}</ul></section>`,
    )
    .join("")}
  ${!diffSections(diff).length && !(diff.added || []).length && !(diff.removed || []).length ? `<section class="panel empty-state"><h2>Nothing changed</h2><p>Every page has the same ${sameFields(diff)}.</p></section>` : ""}
</div>`; // adds the result files beside the audit
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
      L.push(...linksDiffMd());
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
