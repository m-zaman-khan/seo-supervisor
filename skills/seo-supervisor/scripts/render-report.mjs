#!/usr/bin/env node
// Renders an audit JSON (or raw seo-crawl / content-scan output) as one self-contained HTML page that makes no network
// requests, plus a Markdown copy with every finding in full. The JSON shape and score model are in ../report-format.md.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { planStats, planHtml, planMarkdown, PLAN_CSS } from "./report-plan.mjs";
import { fmtCwv, passes } from "./checks/speed.mjs";
import { VERSION } from "./update-check.mjs";

const argv = process.argv.slice(2);
const inPath = argv.find(a => !a.startsWith("--"));
if (!inPath) {
  console.error(
    "Usage: node render-report.mjs <audit.json|seo-crawl.json|content-scan.json> [--out report.html] [--md report.md] [--no-md]",
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

// ---------- normalise ----------
const isCrawl = raw.tool === "seo-supervisor-crawler";
const isScan = raw.tool === "seo-supervisor-content-scan";
const site = raw.site || {
  name: isCrawl ? new URL(raw.siteOrigin).host : isScan ? `Content: ${basename(String(raw.source))}` : "Website",
  url: raw.siteOrigin || "",
};
const run = { ...(raw.run || {}) };
if (isCrawl)
  Object.assign(run, {
    mode: "crawl",
    date: raw.crawledAt,
    pagesCrawled: raw.stats?.htmlPages,
    auditor: "seo-crawl.mjs " + raw.version,
  });
if (isScan) Object.assign(run, { mode: "content scan", date: raw.scannedAt, auditor: "content-scan.mjs" });
const SEV = ["blocker", "high", "needs-decision", "medium", "low"];
const SEV_LABEL = { blocker: "Blocker", high: "High", "needs-decision": "Decision", medium: "Medium", low: "Low" };
const STATUS_LABEL = {
  open: "Open",
  fixed: "Fixed",
  "wont-fix": "Won't fix",
  "needs-decision": "Needs decision",
  "in-progress": "In progress",
};
const findings = (raw.findings || []).map((f, i) => ({
  evidence: [],
  ...f,
  id: f.id || `F-${String(i + 1).padStart(3, "0")}`,
  severity: SEV.includes(f.severity) ? f.severity : "low",
  status: f.status || (f.severity === "needs-decision" ? "needs-decision" : "open"),
  category: f.category || "Other",
}));
const isOpen = f => f.status !== "fixed";
findings.sort(
  (a, b) =>
    !isOpen(a) - !isOpen(b) || SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || (b.count || 0) - (a.count || 0),
);
const passed = raw.passed || [];
const notChecked = raw.notChecked || [];
const notes = raw.notes || [];
const decisions = [
  ...(raw.decisions || []).map(d => ({ ...d })),
  ...findings
    .filter(f => f.status === "needs-decision" && isOpen(f))
    .map(f => ({
      id: f.id,
      question: f.decision?.question || f.title,
      context: f.what || f.why,
      options: f.decision?.options,
      recommendation: f.decision?.recommendation || f.fix,
    })),
];
const open = findings.filter(isOpen),
  fixed = findings.filter(f => !isOpen(f));
const countSev = s => open.filter(f => f.severity === s).length;

// ---------- score model (documented in report-format.md) ----------
// Every checked rule is worth 10 points. A passing rule (or one whose findings are all fixed) earns 10;
// a rule with open findings earns by its worst one: low 8, medium 6, decision 6, high 3, blocker 0.
// Score = earned / possible. Open blockers cap it: 1 → 59, 2 → 49, 3 → 39 … (never below 9).
const EARN = { blocker: 0, high: 3, "needs-decision": 6, medium: 6, low: 8 };
// fixedCountsAsOpen: the score before this run's fixes. assume: findings to treat as fixed (for the "once blockers
// are fixed" score).
function buildRules({ fixedCountsAsOpen = false, assume = () => false } = {}) {
  const rules = new Map();
  for (const f of findings) {
    const key = f.rule || f.id;
    const r = rules.get(key) || { key, area: f.category, worst: null };
    if (
      !assume(f) &&
      (fixedCountsAsOpen || isOpen(f)) &&
      (r.worst === null || SEV.indexOf(f.severity) < SEV.indexOf(r.worst))
    )
      r.worst = f.severity;
    rules.set(key, r);
  }
  for (const p of passed)
    if (!rules.has(p.rule)) rules.set(p.rule, { key: p.rule, area: p.category || "Other", worst: null });
  return [...rules.values()];
}
function score(rules) {
  if (!rules.length) return null;
  const earned = rules.reduce((s, r) => s + (r.worst ? EARN[r.worst] : 10), 0);
  const rawScore = Math.round((100 * earned) / (rules.length * 10));
  const blockers = rules.filter(r => r.worst === "blocker").length;
  const cap = blockers ? Math.max(9, 69 - 10 * blockers) : 100;
  return {
    value: Math.min(rawScore, cap),
    raw: rawScore,
    cap: blockers ? cap : null,
    blockers,
    rules: rules.length,
    passing: rules.filter(r => !r.worst).length,
  };
}
const BANDS = [
  [90, "Excellent", "b5"],
  [75, "Good", "b4"],
  [60, "Fair", "b3"],
  [40, "Poor", "b2"],
  [0, "Critical", "b1"],
];
const bandOf = v => BANDS.find(([min]) => v >= min);
const rules = buildRules();
const overall = score(rules);
const areaNames = [...new Set(rules.map(r => r.area))];
const areas = areaNames
  .map(name => {
    const s = score(rules.filter(r => r.area === name));
    const top = open.filter(f => f.category === name);
    const fixedHere = fixed.filter(f => f.category === name).length;
    return { name, ...s, worst: top[0]?.severity || null, top, fixedHere };
  })
  .sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));

const before = fixed.length ? score(buildRules({ fixedCountsAsOpen: true })) : null;
// While blockers cap the score, the report shows what fixing them unlocks and who has to do it (fixBy: "owner").
const isBlocker = f => f.severity === "blocker";
const openBlockers = findings.filter(f => isBlocker(f) && isOpen(f));
const unlock = overall?.cap ? score(buildRules({ assume: isBlocker })) : null;
const beforeUnlock = unlock && before ? score(buildRules({ fixedCountsAsOpen: true, assume: isBlocker })) : null;
const needsYou = f => f.fixBy === "owner" && isOpen(f);
// What this run's fixes changed. While the blocker cap holds the total, the gain shows in the checked rules instead.
// A function, so it runs after plural() below is defined.
function deltaOf() {
  if (!before || !overall) return null;
  const fx = plural(fixed.length, "fix", "fixes");
  if (before.value !== overall.value) {
    const up = overall.value > before.value;
    return {
      dir: up ? "up" : "down",
      html: `${up ? "Up" : "Down"} <b>${Math.abs(overall.value - before.value)}</b> from ${before.value} before this run's ${fx}`,
    };
  }
  if (unlock && beforeUnlock && beforeUnlock.value !== unlock.value) {
    const up = unlock.value > beforeUnlock.value;
    const n = Math.abs(unlock.value - beforeUnlock.value);
    return {
      dir: up ? "up" : "down",
      inUnlock: true,
      html: up
        ? `The ${fx} from this run earned <b>${n}</b> ${n === 1 ? "point" : "points"}. You'll see ${n === 1 ? "it" : "them"} once the ${openBlockers.length === 1 ? "blocker is" : "blockers are"} fixed`
        : `This run's changes cost <b>${n}</b> ${n === 1 ? "point" : "points"}`,
    };
  }
  return null;
}
const impact = (() => {
  if (!overall) return { rows: [], cap: 0 };
  const possible = overall.rules * 10;
  const lost = areas.map(a => ({
    a,
    exact:
      (100 * rules.filter(r => r.area === a.name).reduce((s, r) => s + (r.worst ? 10 - EARN[r.worst] : 0), 0)) /
      possible,
  }));
  const target = 100 - overall.raw;
  lost.forEach(x => {
    x.pts = Math.floor(x.exact);
  });
  let rest = target - lost.reduce((s, x) => s + x.pts, 0);
  [...lost]
    .sort((x, y) => y.exact - y.pts - (x.exact - x.pts))
    .forEach(x => {
      if (rest > 0 && x.exact > x.pts) {
        x.pts++;
        rest--;
      }
    });
  return {
    rows: lost.filter(x => x.exact > 0).sort((x, y) => y.exact - x.exact || x.a.value - y.a.value),
    cap: overall.raw - overall.value,
  };
})();

let verdict;
if (!overall) verdict = "Not scored: no checked rules in this file.";
else if (countSev("blocker"))
  verdict = `Not ready: ${countSev("blocker")} blocker${countSev("blocker") > 1 ? "s" : ""} to fix first`;
else if (countSev("high"))
  verdict = `Needs work: ${countSev("high")} high-severity issue${countSev("high") > 1 ? "s" : ""}`;
else if (open.length) verdict = "In good shape: only minor issues left";
else verdict = "Every checked rule passes";

// ---------- helpers ----------
const esc = s =>
  String(s ?? "").replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const inl = s =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
const fmtDate = d => {
  const x = new Date(d || Date.now());
  return isNaN(x) ? String(d) : x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const num = n => Number(n).toLocaleString("en-US");
// Search traffic by path, one line on findings and plan rows: Search Console (`traffic`, gsc-import.mjs or
// google.mjs), Bing (`bing.traffic`, connect-keys.mjs), GA4 organic visits (`analytics`, google.mjs) and the visits
// from search engines in Matomo and PostHog (`matomo.traffic`, `posthog.traffic`, connect-keys.mjs). Each part only
// when present.
const obj = x => (x && typeof x === "object" ? x : null);
const traffic = obj(raw.traffic),
  bing = obj(raw.bing),
  analytics = obj(raw.analytics),
  matomo = obj(raw.matomo),
  posthog = obj(raw.posthog);
// Matomo and PostHog: a page counts only with visits above zero, and dates show only when they are dates.
const visitsOf = t => {
  const n = Number(t?.visits);
  return n > 0 ? n : 0;
};
const isoDates = x =>
  [x?.period?.from, x?.period?.to].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    ? `${x.period.from} to ${x.period.to}`
    : "";
const byPath = (map, u) => {
  if (!obj(map) || !u) return null;
  let x;
  try {
    x = new URL(u, "https://site.invalid");
  } catch {
    return null;
  }
  return obj(map[x.pathname + x.search] || map[x.pathname]);
};
const bingDates = bing?.period?.from ? `${bing.period.from} to ${bing.period.to}` : "";
// plain: Search Console alone reads unlabelled, to match the plan's "Search traffic" field.
const trafficFor = (u, plain = false) => {
  const g = byPath(traffic, u),
    b = byPath(bing?.traffic, u),
    a = byPath(analytics, u),
    m = visitsOf(byPath(matomo?.traffic, u)),
    p = visitsOf(byPath(posthog?.traffic, u));
  const parts = [
    g &&
      `${plain && !b && !a && !m && !p ? "" : "Search Console: "}${num(g.clicks)} clicks · ${num(g.impressions)} impressions`,
    b && `Bing: ${num(b.clicks)} clicks · ${num(b.impressions)} impressions`,
    a && `Google Analytics: ${plural(a.sessions, "organic visit")}`,
    m && `Matomo: ${plural(m, "organic visit")}`,
    p && `PostHog: ${plural(p, "organic visit")}`,
  ].filter(Boolean);
  // One period per line: Google's, shared by Search Console and GA4 (connect-keys reads Matomo and PostHog for the
  // same days), else Matomo's or PostHog's. Bing's dates are on its own Overview line.
  const when = g || a ? raw.trafficPeriod : m ? isoDates(matomo) : p ? isoDates(posthog) : bingDates;
  return parts.length ? `${parts.join(" · ")}${when ? ` (${String(when).toLowerCase()})` : ""}` : null;
};
// The first evidence page with traffic.
const trafficOf = f => {
  const e = (f.evidence || []).find(x => x.url && trafficFor(x.url));
  return e && { text: trafficFor(e.url), path: new URL(e.url, "https://site.invalid").pathname };
};
const trafficHtml = f => {
  const t = trafficOf(f);
  return t ? `<p class="quiet">${esc(t.text)} on <code>${esc(t.path)}</code></p>` : "";
};
// Site-wide totals for the Overview: Bing's clicks, impressions and linked pages, and GA4's, Matomo's and PostHog's
// organic visits. Third-party data, escaped where shown.
const sum = (map, k) => Object.values(obj(map) || {}).reduce((s, t) => s + (Number(t?.[k]) || 0), 0);
const visitsLine = (name, x) => {
  const counts = Object.values(obj(x?.traffic) || {})
      .map(visitsOf)
      .filter(Boolean),
    d = isoDates(x);
  return (
    counts.length &&
    `${name}: ${plural(
      counts.reduce((s, n) => s + n, 0),
      "organic visit",
    )} to ${plural(counts.length, "landing page")}${d ? ` (${d})` : ""}`
  );
};
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
const GTYPE = {
  discover: "Discover",
  image: "Google Images",
  video: "Video search",
  news: "the News tab",
  googleNews: "Google News",
};
function googleLines() {
  const n = (x, k) => Number(x?.[k]) || 0,
    isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s),
    per = raw.trafficPeriod ? ` (${String(raw.trafficPeriod).toLowerCase()})` : "";
  const ch = obj(raw.trafficChange),
    was = obj(ch?.previous),
    now = obj(ch?.current),
    days = was && isDay(was.from) && isDay(was.to) ? (Date.parse(was.to) - Date.parse(was.from)) / 864e5 + 1 : 0;
  const move = k =>
    `${num(n(was, k))} → ${num(n(now, k))}${n(was, k) ? ` (${n(now, k) >= n(was, k) ? "+" : "−"}${Math.abs(Math.round((100 * (n(now, k) - n(was, k))) / n(was, k)))}%)` : ""}`;
  const drops = (Array.isArray(ch?.drops) ? ch.drops.filter(d => obj(d) && d.path) : []).slice(0, 5);
  const byClicks = (m, k = "clicks") =>
    Object.entries(obj(m) || {})
      .filter(([, v]) => n(v, k) > 0)
      .sort((a, b) => n(b[1], "clicks") - n(a[1], "clicks"));
  const types = byClicks(raw.searchTypes).filter(([k]) => GTYPE[k]),
    devices = byClicks(raw.byDevice, "impressions"),
    countries = byClicks(raw.byCountry).slice(0, 10);
  const anomalies = (Array.isArray(raw.anomalies) ? raw.anomalies : []).filter(
    a => obj(a) && isDay(a.from) && isDay(a.to) && a.what && a.url,
  );
  return [
    now &&
      days > 0 &&
      `Search clicks: ${move("clicks")} · impressions: ${move("impressions")} vs the previous ${days} days`,
    drops.length &&
      `Biggest drops in search clicks: ${drops.map(d => `${d.path} ${num(n(d, "before"))} → ${num(n(d, "after"))}`).join(" · ")}`,
    types.length &&
      `Clicks from other Google results: ${types.map(([k, v]) => `${GTYPE[k]} ${num(n(v, "clicks"))}`).join(" · ")}${per}`,
    devices.length &&
      `Search by device: ${devices.map(([k, v]) => `${k.toLowerCase()} ${num(n(v, "clicks"))} clicks · ${num(n(v, "impressions"))} impressions`).join("; ")}${per}`,
    countries.length &&
      `Search clicks by country: ${countries.map(([k, v]) => `${k.toUpperCase()} ${num(n(v, "clicks"))}`).join(" · ")}${per}`,
    anomalies.length &&
      `Google's data anomalies page (${anomalies[0].url}) lists problems in this period: ${anomalies.map(a => `${a.from === a.to ? a.from : `${a.from} to ${a.to}`}: ${a.what}`).join("; ")}. A change in these numbers may not be real.`,
  ];
}
function searchLines() {
  const pages = Object.keys(obj(bing?.traffic) || {}).length,
    ga = Object.keys(analytics || {}).length;
  const bits = [
    pages && `${num(sum(bing.traffic, "clicks"))} clicks · ${num(sum(bing.traffic, "impressions"))} impressions`,
    linked.length && `${plural(linked.length, "page")} ${linked.length === 1 ? "has" : "have"} links from other sites`,
  ].filter(Boolean);
  return [
    ...googleLines(),
    bits.length && `Bing${bingDates ? ` (${bingDates})` : ""}: ${bits.join(" · ")}`,
    ga &&
      `Google Analytics: ${plural(sum(analytics, "sessions"), "organic visit")} to ${plural(ga, "landing page")}${raw.trafficPeriod ? ` (${String(raw.trafficPeriod).toLowerCase()})` : ""}`,
    visitsLine("Matomo", matomo),
    visitsLine("PostHog", posthog),
  ].filter(Boolean);
}
const linkCount = p => plural(Number(p.count) || 0, "link");
const plural = (n, w, p = w + "s") => `${num(n)} ${n === 1 ? w : p}`;
const firstSentence = s => {
  const m = String(s || "").match(/^.*?[.!?](\s|$)/);
  return m ? m[0].trim() : String(s || "");
};
const ICON = {
  chevron:
    '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 10 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrow:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
const dot = s => `<i class="dot d-${s}" aria-hidden="true"></i>`;
const mdFile = mdPath ? basename(mdPath) : null;

// ---------- overview ----------
function scoreScale(v) {
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
// Origin field data, else the first page's, each metric with its band.
function speedText() {
  const s = raw.speed;
  if (!s || (!(s.samples || []).length && !s.trend)) return "";
  const v = (s.samples || []).find(x => x.origin)?.origin || (s.samples || []).find(x => x.field)?.field;
  const now = (s.samples || []).length
    ? v
      ? `${bandedCwv(v)}, ${passes(v) ? "passes" : "fails"} Core Web Vitals`
      : "not enough visits for field data yet"
    : "";
  const l = s.trend?.lcp,
    trend = l
      ? `over ${s.trend.weeks} weeks: LCP ${(l[0] / 1000).toFixed(1)} → ${(l[1] / 1000).toFixed(1)} s (${l[1] < l[0] * 0.95 ? "better" : l[1] > l[0] * 1.05 ? "worse" : "steady"})`
      : "";
  return `Real-user speed (${s.strategy || "mobile"}): ${[now, trend].filter(Boolean).join(" · ")}`;
}
// Ahrefs' licence requires its credit beside the numbers.
function authorityText() {
  const a = Array.isArray(raw.authority) ? raw.authority : [];
  const scores = x =>
    [
      x.openPageRank != null && `Open PageRank ${Number(x.openPageRank).toFixed(1)}`,
      x.ahrefsDR != null && `Domain Rating ${Number(x.ahrefsDR).toFixed(0)}`,
    ]
      .filter(Boolean)
      .join(" · ");
  const [site, ...rivals] = a,
    parts = a.length
      ? [scores(site), ...rivals.filter(r => scores(r)).map(r => `${r.domain}: ${scores(r)}`)].filter(Boolean)
      : [];
  return parts.length ? `Authority: ${parts.join("; ")}` : "";
}
// The credit goes wherever a Domain Rating shows, whether or not the file carries the attribution.
const ahrefsCredit = () =>
  (raw.authority || []).some(x => x.ahrefsDR != null)
    ? raw.attribution || { text: "Domain Rating by Ahrefs", url: "https://ahrefs.com/" }
    : null;
// The crawler's throttled phone load: the home page, else the first page.
function labSpeedText() {
  const l = (raw.labSpeed || []).filter(x => x.lcp != null),
    x = l.find(x => new URL(x.url).pathname === "/") || l[0];
  return x
    ? `Lab speed, slow mobile (indicative): ${fmtCwv(x)} · TBT ${Math.round(x.tbt || 0)} ms on ${new URL(x.url).pathname === "/" ? "the home page" : new URL(x.url).pathname}`
    : "";
}
// LCP's four parts (speed.lcpBreakdown, in ms), each with its fix.
const LCP_PART = {
  ttfb: ["the server's response", "Cache pages, serve them from a CDN or use a faster server."],
  loadDelay: [
    "the wait before the main image starts loading",
    'Preload the hero image, give it fetchpriority="high" and don\'t lazy-load it.',
  ],
  loadDuration: ["downloading the main image", "Make it smaller and serve it in a modern format (WebP or AVIF)."],
  renderDelay: [
    "drawing it on screen",
    "Cut render-blocking CSS and JavaScript, and build the page on the server rather than in the browser.",
  ],
};
function lcpText() {
  const b = raw.speed?.lcpBreakdown;
  if (!b) return "";
  const [k] = Object.keys(LCP_PART).sort((x, y) => (b[y] || 0) - (b[x] || 0)),
    path = b.source === "lab" && new URL(b.url).pathname;
  return `LCP breakdown (${path ? `lab test, ${path === "/" ? "home page" : path}` : "real visitors"}): most of the time goes on ${LCP_PART[k][0]} (${(b[k] / 1000).toFixed(1)} s). ${LCP_PART[k][1]}`;
}
// More than the default 5 pages (--lighthouse all) adds the three lowest performance scores.
function lighthouseText() {
  const l = raw.lighthouse || [],
    x = l.find(x => new URL(x.url).pathname === "/") || l[0],
    s = x?.scores || {};
  const parts = [
    ["Performance", s.performance],
    ["SEO", s.seo],
    ["Accessibility", s.accessibility],
    ["Best practices", s.bestPractices],
  ].filter(([, v]) => v != null);
  const scored =
    l.length > 5
      ? l.filter(y => y.scores?.performance != null).sort((a, b) => a.scores.performance - b.scores.performance)
      : [];
  const slowest = scored.length
    ? `. Lowest performance of ${scored.length} pages: ${scored
        .slice(0, 3)
        .map(y => `${new URL(y.url).pathname} ${y.scores.performance}`)
        .join(" · ")}`
    : "";
  return parts.length
    ? `Lighthouse (mobile, ${new URL(x.url).pathname === "/" ? "home page" : new URL(x.url).pathname}): ${parts.map(([k, v]) => `${k} ${v}`).join(" · ")}${slowest}`
    : "";
}
// Names and dates only: the line never says an update caused anything.
function googleUpdatesText(html = false) {
  const g = obj(raw.googleUpdates),
    isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!g || !Array.isArray(g.updates)) return "";
  const day = (d, year) =>
    new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      ...(year && { year: "numeric" }),
      timeZone: "UTC",
    });
  const span = (a, b) =>
    !isDay(b)
      ? `${day(a)}, still rolling out`
      : a === b
        ? day(a)
        : a.slice(0, 7) === b.slice(0, 7)
          ? `${+a.slice(8)}–${day(b)}`
          : `${day(a)} – ${day(b)}`;
  const text = html ? esc : s => String(s).replace(/[\\`*_[\]<>]/g, "\\$&"); // feed text: escaped for HTML or Markdown
  const name = u =>
    html && /^https?:\/\//i.test(u.url) ? `<a href="${esc(u.url)}" rel="noopener">${esc(u.name)}</a>` : text(u.name);
  const list = g.updates
    .filter(u => obj(u) && u.name && isDay(u.start))
    .map(u => `${name(u)} (${span(u.start, u.end)})`);
  const none =
    isDay(g.from) && isDay(g.to)
      ? `none were announced between ${day(g.from, g.from.slice(0, 4) !== g.to.slice(0, 4))} and ${day(g.to, true)}`
      : "none were announced";
  return `Google ranking updates in this period: ${list.length ? list.join(" · ") : none}${g.note ? `. ${text(g.note)}` : ""}`;
}

// ---------- extra panels: an empty one adds nothing to the output ----------
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
  m && ["brand", "address", "generic", "other"].every(k => Number.isFinite(m[k]) && m[k] >= 0 && m[k] <= 1) ? m : null)(
  obj(raw.anchorMix),
);
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
const noteMd = s =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\\`*_[\]<>]/g, "\\$&");
const noteCode = s => "`" + String(s ?? "").replace(/[`\r\n]/g, " ") + "`";
const notePath = u => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return String(u ?? "");
  }
};
const AGENT_FILE = {
  "/.well-known/api-catalog": "API catalog (RFC 9727)",
  "/.well-known/agent-card.json": "A2A agent card",
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

// --desktop: origin field data, else the first page's, each with Google's good / needs improvement / poor band, plus
// the desktop trend.
import { band } from "./checks/speed.mjs";
function bandedCwv(v) {
  return [
    `LCP ${(v.lcp / 1000).toFixed(1)} s (${band("lcp", v.lcp)})`,
    v.inp != null && `INP ${Math.round(v.inp)} ms (${band("inp", v.inp)})`,
    v.cls != null && `CLS ${Math.round(v.cls * 100) / 100} (${band("cls", v.cls)})`,
  ]
    .filter(Boolean)
    .join(" · ");
}
function desktopSpeedText() {
  const s = raw.speed?.desktop,
    samples = s?.samples || [];
  if (!s || (!samples.length && !s.trend)) return "";
  const v = samples.find(x => x.origin)?.origin || samples.find(x => x.field)?.field;
  const now = !samples.length ? "" : !v ? "not enough visits for field data yet" : bandedCwv(v);
  const l = s.trend?.lcp,
    trend = l
      ? `over ${s.trend.weeks} weeks: LCP ${(l[0] / 1000).toFixed(1)} → ${(l[1] / 1000).toFixed(1)} s (${l[1] < l[0] * 0.95 ? "better" : l[1] > l[0] * 1.05 ? "worse" : "steady"})`
      : "";
  return `Real-user speed (desktop): ${[now, trend].filter(Boolean).join(" · ")}`;
}

// Search Console positions (`positions`, google.mjs fetch) as shares of queries.
const positionsText = () => {
  const p = obj(raw.positions),
    ok = ["top3", "top10", "beyond"].every(k => typeof p?.[k] === "number" && p[k] >= 0 && p[k] <= 1);
  if (!ok || !(Number.isInteger(p.queries) && p.queries > 0)) return "";
  const pct = k => `${Math.round(100 * p[k])}%`;
  return `Search Console queries by average position: ${pct("top3")} in the top 3 · ${pct("top10")} in the top 10 · ${pct("beyond")} beyond, of ${plural(p.queries, "query", "queries")}${raw.trafficPeriod ? ` (${String(raw.trafficPeriod).toLowerCase()})` : ""}`;
};

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
const cellMd = s => s.replace(/\|/g, "\\|");
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

// Matomo and PostHog device and country splits ({ name: { visits } }), top 10. The callers escape the names.
const analyticsSplitLines = () =>
  [
    ["Matomo", matomo],
    ["PostHog", posthog],
  ]
    .flatMap(([name, x]) =>
      [
        ["device", x?.byDevice, k => k.toLowerCase()],
        ["country", x?.byCountry, k => k.toUpperCase()],
      ].map(([by, map, label]) => {
        const rows = Object.entries(obj(map) || {})
            .map(([k, v]) => [k, visitsOf(v)])
            .filter(([, n]) => n)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10),
          d = isoDates(x);
        return (
          rows.length &&
          `${name} organic visits by ${by}: ${rows.map(([k, n]) => `${label(k)} ${num(n)}`).join(" · ")}${d ? ` (${d})` : ""}`
        );
      }),
    )
    .filter(Boolean);

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
  secMd = () => (hstsPreloadText() ? [noteMd(hstsPreloadText()), ""] : []);

// Pages per top-level section show only with two or more; siteSize is set when the crawl stopped at --max, and
// indexing is Search Console's indexed count. Paths are escaped.
const countOf = x => Number.isInteger(x) && x >= 0;
const crawlSections = (Array.isArray(raw.sections) ? raw.sections : [])
  .filter(s => obj(s) && typeof s.path === "string" && countOf(s.pages) && Number.isFinite(s.share))
  .slice(0, 20);
const crawlLines = () => {
  const z = obj(raw.siteSize),
    i = obj(raw.indexing);
  return [
    z &&
      [z.crawled, z.known, z.sitemapUrls].every(countOf) &&
      `The crawl stopped at ${num(z.crawled)} pages (--max). It knew of ${num(z.known)} URLs on the site from links and sitemaps (the sitemaps list ${num(z.sitemapUrls)}), so the site has at least ${num(Math.max(z.known, z.sitemapUrls))} URLs.`,
    i &&
      [i.indexed, i.notIndexed, i.crawlIndexable].every(countOf) &&
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

const aiCrawlersHtml = () => "",
  aiCrawlersMd = () => [];

const schemaHtml = () => "",
  schemaMd = () => [];

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
  fields && countOf(fields.products) && fields.products > 0 && FIELDS.every(([k]) => countOf(fields[k]))
    ? `Of ${plural(fields.products, "product")} in the schema: ${FIELDS.map(([k, w]) => `${num(fields[k])} with ${w}`).join(", ")}. Google recommends each one where the product has it, so a GTIN, colour or material can rightly be missing. Information only: it doesn't change the score.`
    : "";
const shopHtml = () => (shopLine ? `\n    <p class="quiet">${esc(shopLine)}</p>` : ""),
  shopMd = () => (shopLine ? ["## Product data", "", shopLine, ""] : []);

const mediaHtml = () => "",
  mediaMd = () => [];

const renderHtml = () => "",
  renderMd = () => [];

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
    ? kwUse.pages.filter(k => obj(k) && typeof k.url === "string" && typeof k.phrase === "string" && KW_WHY[k.verdict])
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
const asString = x => typeof x === "string" && x !== "";
const asInt = x => Number.isInteger(x) && x >= 0;
const asDay = x => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x));
const newItems = (n =>
  n && asInt(n.count) && n.count > 0
    ? { ...n, sites: asArray(n.sites, s => obj(s) && asString(s.domain)).slice(0, 5) }
    : null)(obj(raw.newLinks));
const stale = (n => (n && asDay(n.newest) && asDay(n.asOf) ? n : null))(obj(raw.noNewLinks));
const unlinked = (u =>
  u && asInt(u.count) && u.count > 0 && asInt(u.of) && u.of >= u.count
    ? { ...u, urls: asArray(u.urls, asString).slice(0, 5) }
    : null)(obj(raw.unlinkedPages));
const nfSites = asArray(linkCheck?.nofollowSites, s => obj(s) && asString(s.site) && asInt(s.pages)).slice(0, 10);
const foundItems = asArray(linkCheck?.found, f => obj(f) && asString(f.url) && Array.isArray(f.links))
  .flatMap(f =>
    asArray(f.links, l => obj(l) && asString(l.href))
      .slice(0, 1)
      .map(l => ({ url: f.url, ...l })),
  )
  .slice(0, 10);
const cc = (c =>
  c && asString(obj(c.crawl)?.name)
    ? {
        name: c.crawl.name,
        site: obj(c.site) && asInt(c.site.captures) ? c.site : null,
        pages: asArray(c.linkingPages, p => obj(p) && asString(p.url) && asString(p.state)),
        sites: asArray(c.linkingSites, asString),
      }
    : null)(obj(raw.commonCrawl));
const out = (o =>
  o && obj(o.pages) && Object.keys(o.pages).length
    ? {
        pages: Object.values(o.pages).filter(asInt),
        domains: Object.entries(obj(o.domains) || {}).filter(([k, v]) => asString(k) && asInt(v)),
      }
    : null)(obj(raw.linksToOtherSites));
const bingSample = Array.isArray(bing?.backlinks?.sample) ? bing.backlinks.sample.filter(obj).length : 0;
const extraLines = () => {
  const L = []; // [text, list of [name, detail]]
  if (newItems)
    L.push([
      `${plural(newItems.count, "new site")} ${newItems.count === 1 ? "links" : "link"} to you since the last export${Date.parse(newItems.since) ? ` (${fmtDate(newItems.since)})` : ""}, from Search Console's Top linking sites.${newItems.capped === true ? " Some may be older links: an export holds 1,000 sites at most, so they may have been past the cut before." : ""}`,
      newItems.sites.map(s => [s.domain, asInt(s.links) ? plural(s.links, "link") : ""]),
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
        `→ ${f.href}${asString(f.text) ? ` “${f.text}”` : ""}${asString(f.rel) ? ` (${f.rel})` : ""}`,
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
        `${num(linked)} of ${num(cc.pages.length)} known linking pages link to you in Common Crawl's saved copies${absent ? `; ${num(absent)} ${absent === 1 ? "isn't" : "aren't"} in its newest crawl` : ""}. Its full web graph, with each site's rank, is too big to download, so your rank there isn't shown.`,
        cc.sites.slice(0, 5).map(h => [h, ""]),
      ]);
  }
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
      .map(([name, v]) => [name, n(v?.[k])])
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
    .filter(x => obj(x) && !isNaN(Date.parse(x.date)) && asInt(x.pages))
    .slice(-100)
    .reverse();
const timelineCells = x => [
  fmtDate(x.date),
  ...["pages", "findings", "regressions", "improvements", "added", "removed"].map(k => (asInt(x[k]) ? num(x[k]) : "–")),
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
    ...(posts ? [posts, ""] : []),
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

const reportHtml = () => "",
  reportMd = () => [];

const panelsHtml = () =>
  [
    secHtml,
    crawlScopeHtml,
    aiCrawlersHtml,
    schemaHtml,
    shopHtml,
    mediaHtml,
    renderHtml,
    contentHtml,
    localHtml,
    backlinksHtml,
    connHtml,
    diffMoreHtml,
    reportHtml,
  ]
    .map(f => f())
    .join("");
const panelsMd = () =>
  [
    secMd,
    crawlScopeMd,
    aiCrawlersMd,
    schemaMd,
    shopMd,
    mediaMd,
    renderMd,
    contentMd,
    localMd,
    backlinksMd,
    connMd,
    diffMoreMd,
    reportMd,
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
        <p>Every checked rule is worth 10 points. A rule that passes, or whose findings are all fixed, earns 10. A rule with open findings earns by its worst one: low 8, medium or decision 6, high 3, blocker 0. The score is the share of points earned. Each open blocker caps it: one at 59, two at 49, three at 39. While a blocker is open, the panel also shows the score you reach once it is fixed. Area scores use the same rules within each area.</p>
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
      ${trafficHtml(f)}${evidenceHtml(f)}
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

// ---------- since last audit ----------
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
// The open finding on the same page and rule, if any.
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
const unknownLines = d => [unknownText(d.removedUnknown, "gone"), unknownText(d.addedUnknown, "added")].filter(Boolean);
const diffHtml = () => `<div class="limits">
  <p class="quiet">Compared with the crawl of ${esc(fmtDate(diff.since))}. Pages are matched by path.${unknownLines(
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

const CSS = `
:root{--bg:#f4f6f9;--panel:#fff;--ink:#1c2a39;--ink2:#3a4757;--mute:#5d6878;--line:#e2e6ec;--line2:#cfd6df;--blue:#2459c9;--blue-soft:#e9effc;--sel:#cfe0ff;
--b1:#d64040;--b2:#e9772e;--b3:#e3a21a;--b4:#6fb35a;--b5:#238a52;
--blocker:#c93636;--high:#e0702b;--decision:#7b52c7;--medium:#d99a12;--low:#7d8a9c;--pass:#238a52;--fixed:#238a52;
--ok-soft:#e6f4ec;--warn-soft:#fdf3dc;--dec-soft:#f0eafb;
--b1-ink:#c03030;--b2-ink:#b5541a;--b5-ink:#1d7444;--chip-ink:#fff;
--display:"Bricolage Grotesque","Geist",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;--sans:"Geist",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;--mono:"Geist Mono",ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
--r:10px;--shadow:none;--neutral:#8a95a5;color-scheme:light}
@media screen{:root:not([data-theme="light"]){--bg:#0e131a;--panel:#151c26;--ink:#e6ebf2;--ink2:#c3ccd8;--mute:#98a3b3;--line:#232c39;--line2:#323d4d;--blue:#7ea2ff;--blue-soft:#1b2640;--sel:#2a3d66;
--b1:#ef6464;--b2:#f38b4a;--b3:#efb93b;--b4:#86c873;--b5:#45b97a;--blocker:#ef6464;--high:#f38b4a;--decision:#a587ec;--medium:#efb93b;--low:#8c99ab;--pass:#45b97a;--fixed:#45b97a;
--ok-soft:#14291e;--warn-soft:#2c2412;--dec-soft:#231c38;--neutral:#6b7788;--b1-ink:#ef6464;--b2-ink:#f38b4a;--b5-ink:#45b97a;--chip-ink:#0e131a;--shadow:0 1px 2px rgba(0,0,0,.3),0 6px 18px rgba(0,0,0,.25);color-scheme:dark}}
*{box-sizing:border-box}
html{scrollbar-color:var(--line2) transparent;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--sans);font-variant-numeric:tabular-nums;caret-color:var(--blue)}
::selection{background:var(--sel)}
a{color:var(--blue);text-underline-offset:3px;text-decoration-thickness:1px}
:focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:6px}
h1,h2,h3,h4{margin:0;text-wrap:balance;font-weight:600}
p{margin:0}
code{font:.86em/1.4 var(--mono);background:var(--bg);border:1px solid var(--line);padding:.05em .35em;border-radius:5px;overflow-wrap:anywhere}
.mono{font-family:var(--mono);font-size:.86em}
.quiet{color:var(--mute);font-size:13.5px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{max-width:1240px;margin:0 auto;padding-left:max(20px,env(safe-area-inset-left));padding-right:max(20px,env(safe-area-inset-right))}
header.top{background:var(--panel);border-bottom:1px solid var(--line)}
header.top .wrap{padding-block:26px 0}
h1{font-family:var(--display);font-weight:700;font-size:clamp(26px,3.4vw,34px);line-height:1.1;letter-spacing:-.02em}
.title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.theme-btn{flex:none;display:inline-flex;align-items:center;gap:7px;height:36px;margin-top:1px;padding:0 14px 0 12px;border:1px solid var(--line2);border-radius:999px;background:var(--panel);color:var(--ink2);font:500 13.5px var(--sans);cursor:pointer}
.theme-btn[hidden]{display:none}.theme-btn:hover{color:var(--ink);border-color:var(--mute)}.theme-btn:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.theme-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
:root[data-theme="light"] .i-sun,:root:not([data-theme="light"]) .i-moon{display:none}
.meta{display:flex;flex-wrap:wrap;gap:4px 14px;color:var(--mute);font-size:13.5px;margin-top:6px}
.meta>*+*::before{content:"·";margin-right:14px;color:var(--line2)}
.lede{max-width:78ch;margin-top:14px;color:var(--ink2)}
.lede-more summary{cursor:pointer;color:var(--blue);font-size:13.5px;font-weight:600;margin-top:6px;list-style:none}
.lede-more summary::-webkit-details-marker{display:none}
.lede-more p{margin-top:6px}
.tabs{display:flex;gap:26px;margin-top:20px;overflow-x:auto;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{appearance:none;background:none;border:0;border-bottom:2px solid transparent;padding:10px 0 12px;font:600 14.5px var(--sans);color:var(--mute);cursor:pointer;white-space:nowrap;display:flex;gap:8px;align-items:center}
.tab:hover{color:var(--ink)}
.tab[aria-selected=true]{color:var(--ink);border-bottom-color:var(--blue)}
.tab .cnt{font:500 12px var(--mono);color:var(--mute);background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:0 7px}
html:not(.js) .tabs{display:none}
main{padding-block:26px 56px}
.tp{display:grid;gap:18px}
html.js .tp[hidden]{display:none}
html:not(.js) .tp+.tp{margin-top:40px}
html:not(.js) .tp::before{content:attr(data-title);font:600 20px var(--sans)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:22px 24px;box-shadow:var(--shadow)}
.panel h2{font-size:16.5px}
.ph{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.sub{color:var(--mute);font-size:13px}
/* overview */
.ov-top{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:18px;align-items:start}
.ov-left{display:grid;gap:18px;align-content:start}
.score-panel{display:grid;gap:12px;align-content:start}
.factors{align-self:start}
.big{display:flex;align-items:baseline;gap:6px;margin-top:6px}
.big .n{font:700 clamp(80px,10vw,124px)/.86 var(--display);letter-spacing:-.04em;font-variant-numeric:lining-nums}
.big .of{font:500 22px var(--mono);color:var(--mute)}
.b1-t{color:var(--b1-ink)}.b2-t{color:var(--b2-ink)}.b3-t{color:var(--ink)}.b4-t{color:var(--ink)}.b5-t{color:var(--b5-ink)}
.big.b3-t .n,.big.b4-t .n{color:var(--ink)}
.band{display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:15.5px;font-weight:600}
.chip{font:600 12.5px var(--sans);padding:3px 10px;border-radius:999px;color:var(--chip-ink)}
.chip.b1{background:var(--b1-ink)}.chip.b2{background:var(--b2-ink)}.chip.b3{background:var(--b3);color:#2b2000}.chip.b4{background:var(--b4);color:#0f2a12}.chip.b5{background:var(--b5-ink)}
.scale{position:relative;margin:22px 0 18px}
.track{display:flex;gap:2px;height:12px;border-radius:6px;overflow:hidden}
.track span.b1{background:var(--b1)}.track span.b2{background:var(--b2)}.track span.b3{background:var(--b3)}.track span.b4{background:var(--b4)}.track span.b5{background:var(--b5)}
.marker{position:absolute;top:-8px;width:3px;height:28px;margin-left:-1.5px;background:var(--ink);border-radius:2px;box-shadow:0 0 0 2px var(--panel)}
.marker b{position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);font:600 12px var(--mono);background:var(--ink);color:var(--panel);padding:1px 6px;border-radius:4px}
.ticks{position:relative;height:16px;margin-top:6px;font:12px var(--mono);color:var(--mute)}
.ticks span{position:absolute;transform:translateX(-50%)}.ticks span:first-child{transform:none}.ticks span:last-child{transform:translateX(-100%)}
.cap{color:var(--ink2)}
.unlock{display:grid;gap:6px;padding:14px 16px;border:1px solid var(--line2);border-radius:8px;background:var(--bg)}
.u-k{font-size:13.5px;font-weight:600;color:var(--ink2)}
.u-v{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}
.u-v .from{font:600 20px var(--mono);color:var(--mute);text-decoration:line-through;text-decoration-thickness:1.5px}
.u-v .arrow{color:var(--mute);font-size:18px}
.u-v .to{font:700 46px/1 var(--display);letter-spacing:-.03em;font-variant-numeric:lining-nums}
.u-v .to.b3-t,.u-v .to.b4-t{color:var(--ink)}
.u-s{font-size:13.5px;color:var(--mute)}
.own{display:inline-block;font:600 11.5px/1.6 var(--sans);color:var(--ink);background:var(--panel);border:1px solid var(--line2);border-radius:999px;padding:0 8px;white-space:nowrap;vertical-align:1px}
.how summary{cursor:pointer;color:var(--blue);font-size:13.5px;font-weight:600;list-style:none}
.how summary::-webkit-details-marker{display:none}
.how p{margin-top:8px;font-size:13.5px;color:var(--mute);max-width:70ch}
.area-list{list-style:none;margin:14px 0 0;padding:0}
.area{display:grid;grid-template-columns:14px minmax(0,1fr) minmax(80px,160px) 64px;gap:14px;align-items:center;padding:11px 8px;margin:0 -8px;border-top:1px solid var(--line);color:inherit;text-decoration:none;border-radius:6px}
.area-list li:first-child .area{border-top:0}
.area:hover{background:var(--bg)}
.an{min-width:0}.an b{display:block;font-weight:600}.an>span{display:block;color:var(--mute);font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.an>span.reason{white-space:normal}
.more{display:inline!important;color:var(--mute)}
.meter{height:8px;background:var(--line);border-radius:4px;overflow:hidden}
.meter i{display:block;height:100%;border-radius:4px;background:var(--neutral)}
.as{font:600 16px var(--mono);text-align:right}
.as.b3-t,.as.b4-t{color:var(--ink)}
.dot{display:inline-block;border-radius:50%;flex:none;justify-self:center}
.d-blocker{width:12px;height:12px;background:var(--blocker)}.d-high{width:10px;height:10px;background:var(--high)}.d-needs-decision{width:10px;height:10px;background:var(--decision)}.d-medium{width:8px;height:8px;background:var(--medium)}.d-low{width:7px;height:7px;background:var(--low)}.d-pass{width:8px;height:8px;background:var(--pass)}
.ov-right{display:grid;gap:18px;align-content:start}
.panel.stats{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(0,1fr) minmax(0,1fr);padding:0}
.stat{display:grid;gap:8px;align-content:start;padding:16px 18px}
.stat+.stat{border-left:1px solid var(--line)}
.stat h3{font-size:13.5px;font-weight:600;color:var(--ink2)}
.stat-n{color:var(--mute);font-size:13.5px}.stat-n .n{font:600 26px/1 var(--mono);color:var(--ink);margin-right:4px}
.key{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:-1px}.k-fail{background:var(--ink2)}
.delta{font-size:13.5px;color:var(--mute)}.delta b{font:600 14px var(--mono)}.delta.up b{color:var(--b5-ink)}.delta.down b{color:var(--b1-ink)}
.ascore{font:500 12.5px var(--mono);color:var(--mute);margin-left:6px}
.as small{font:500 11px var(--sans);color:var(--mute);margin-left:2px}
.as.ok{color:var(--b5-ink)}
.stack{display:flex;gap:2px;height:10px;border-radius:5px;overflow:hidden;background:var(--line)}
.s-blocker{background:var(--blocker)}.s-high{background:var(--high)}.s-needs-decision{background:var(--decision)}.s-medium{background:var(--medium)}.s-low{background:var(--low)}
.s-fixed,.s-pass{background:var(--pass)}.s-rest{background:var(--line2)}.s-fail{background:var(--ink2)}
.legend{list-style:none;margin:2px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px}
.legend li{display:inline-flex;gap:6px;align-items:center}.legend b{font:600 12.5px var(--mono)}
.fixfirst ol{list-style:none;margin:10px 0 0;padding:0}
.fixfirst ol a{display:grid;grid-template-columns:14px 64px minmax(0,1fr) 16px;gap:12px;align-items:center;padding:11px 8px;margin:0 -8px;border-top:1px solid var(--line);color:inherit;text-decoration:none;border-radius:6px}
.fixfirst li:first-child a{border-top:0}
.fixfirst ol a:hover{background:var(--bg)}
.fixfirst .t{font-weight:600;min-width:0}.fixfirst .c{display:none}
.fixfirst svg,.link svg{width:15px;height:15px;color:var(--mute)}
.sev-t{font-size:12.5px;font-weight:600;color:var(--mute);letter-spacing:.01em}
.link{display:inline-flex;gap:6px;align-items:center;font-weight:600;font-size:13.5px;color:var(--blue);text-decoration:none;background:none;border:0;padding:0;cursor:pointer;font-family:inherit}
/* findings */
.toolbar{display:flex;flex-wrap:wrap;gap:10px 12px;align-items:center;position:sticky;top:0;z-index:3;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--line)}
.search{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:0 10px;flex:1 1 220px;max-width:340px}
.search svg{width:15px;height:15px;color:var(--mute)}
.search input{border:0;background:none;color:var(--ink);font:14px var(--sans);padding:8px 0;width:100%;outline:none}
.search:focus-within{outline:2px solid var(--blue);outline-offset:1px}
.seg{display:flex;flex-wrap:wrap;gap:4px}
.segb{display:inline-flex;gap:6px;align-items:center;font:500 13.5px var(--sans);color:var(--ink2);background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:6px 10px;cursor:pointer}
.segb:hover{border-color:var(--mute)}
.segb[aria-pressed=true]{background:var(--ink);color:var(--panel);border-color:var(--ink)}
.segb .mono{color:inherit;opacity:.7}
.sel select{font:14px var(--sans);color:var(--ink);background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:7px 10px}
.showing{margin-left:auto;color:var(--mute);font-size:13.5px}
.flist{display:grid;gap:8px}
.f{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);transition:opacity .25s cubic-bezier(.2,.8,.2,1)}
.flist.focus .f:not(.open){background:var(--bg);border-color:var(--line)}
.flist.focus .f:not(.open) .dot{opacity:.55}
.flist.focus .f:not(.open):hover{background:var(--panel)}
.f.open{border-color:var(--blue);box-shadow:0 0 0 1px var(--blue)}
.f:has(.f-head:focus-visible){outline:2px solid var(--blue);outline-offset:2px}
.f h3{font-size:inherit}
.f-head{all:unset;box-sizing:border-box;width:100%;cursor:pointer;display:grid;grid-template-columns:14px minmax(0,1fr) auto auto 16px;gap:4px 14px;align-items:center;padding:14px 18px;border-radius:var(--r)}
.f-head:focus-visible{outline:none}
.f-title{font-weight:600;font-size:15.5px;line-height:1.4;min-width:0}
.f-meta{grid-column:2;grid-row:2;display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--mute);font-size:13px}
.f-head .st,.f-head .stamp{grid-row:1/3;grid-column:4}
.chev{width:16px;height:16px;color:var(--mute);grid-row:1/3;grid-column:5;transition:transform .2s cubic-bezier(.2,.8,.2,1)}
.f.open .chev{transform:rotate(90deg)}
.f .dot{grid-row:1;align-self:center}
.st{font:600 12px var(--sans);color:var(--ink2);border:1px solid var(--line2);border-radius:999px;padding:2px 9px;white-space:nowrap}
.st-needs-decision{color:var(--decision);border-color:currentColor}
.stamp{display:inline-flex;gap:5px;align-items:center;font:700 11.5px var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--fixed);border:1.5px solid currentColor;border-radius:5px;padding:2px 8px;transform:rotate(-2deg);white-space:nowrap}
.stamp svg{width:12px;height:12px}
.f.is-fixed .f-title{color:var(--ink2)}
.f-body{display:none;padding:4px 18px 20px 46px}
.f.open .f-body,html:not(.js) .f-body{display:grid;gap:18px}
.f-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px}
.f-cols>div{display:grid;gap:8px;align-content:start}
.f-body h4,.ev h4{font-size:12.5px;font-weight:600;color:var(--mute);letter-spacing:.02em;margin-top:4px}
.f-body p{max-width:70ch}
.howfix{background:var(--blue-soft);border-radius:8px;padding:12px 14px;display:grid;gap:6px}
.howfix h4{color:var(--blue);margin:0}
.dec-inline{background:var(--dec-soft);border-radius:8px;padding:12px 14px;display:grid;gap:6px}.dec-inline h4{color:var(--decision);margin:0}
.dec-inline ul,.opts{margin:0;padding-left:18px}
.donebox{background:var(--ok-soft);border-radius:8px;padding:12px 14px;display:grid;gap:6px}.donebox h4{color:var(--fixed);margin:0}
.donebox svg,.quiet svg{width:13px;height:13px;vertical-align:-2px;color:var(--fixed)}
.files{display:flex;flex-wrap:wrap;gap:6px}
.ev{display:grid;gap:8px}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{text-align:left;vertical-align:top;padding:8px 12px;border-top:1px solid var(--line)}
thead th{border-top:0;font-size:12px;font-weight:600;color:var(--mute);background:var(--bg)}
td:first-child{width:52%;overflow-wrap:anywhere}
.empty{color:var(--mute);text-align:center;padding:30px}
/* decisions, changes, passed, limits */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px}
.dcard{display:grid;gap:10px;align-content:start}
.dcard h3{font-size:16.5px}
.idlink{text-decoration:none;color:var(--mute)}
.rec{background:var(--dec-soft);border-radius:8px;padding:10px 12px}.rec strong{display:block;color:var(--decision);font-size:12.5px}
.changes{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.changes li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:16px;align-items:start}
.changes h3{font-size:15.5px}.changes h3 a{color:inherit;text-decoration:none}.changes h3 a:hover{text-decoration:underline}
.changes li>div{display:grid;gap:6px}
.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px}
.pgroup h3{font-size:15px;display:flex;justify-content:space-between}
.pgroup ul{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:8px;font-size:14px}
.pgroup li{display:grid;grid-template-columns:16px 1fr;gap:8px}
.pgroup li svg{width:15px;height:15px;color:var(--pass);margin-top:3px}
.limits{display:grid;gap:18px}
.limits .panel{display:grid;gap:10px}
.lim{list-style:none;margin:0;padding:0;display:grid}
.lim li{display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:16px;padding:10px 0;border-top:1px solid var(--line)}
.lim li:first-child{border-top:0}.lim li span{color:var(--ink2)}
.lim li:not(:has(b)){grid-template-columns:1fr}
.empty-state{display:grid;gap:8px;text-align:center;padding:48px 24px}.empty-state p{color:var(--mute);max-width:56ch;margin:0 auto}
footer{border-top:1px solid var(--line);color:var(--mute);font-size:13px}
footer .wrap{padding-block:20px 40px;display:flex;flex-wrap:wrap;gap:6px 18px;justify-content:space-between}
@media (max-width:900px){.ov-top{grid-template-columns:1fr}.stat+.stat{border-left:0;border-top:1px solid var(--line)}.f-cols{grid-template-columns:1fr}}
@media (max-width:560px){.panel.stats{grid-template-columns:1fr}.stat+.stat{border-left:0;border-top:1px solid var(--line)}.tabs{-webkit-mask-image:linear-gradient(90deg,var(--ink) calc(100% - 28px),transparent);mask-image:linear-gradient(90deg,var(--ink) calc(100% - 28px),transparent);padding-right:28px}.panel{padding:18px}.meta{gap:2px 12px}.meta>*+*::before{display:none}.ticks span:nth-child(5){display:none}.area{grid-template-columns:14px minmax(0,1fr) 56px}.meter{display:none}
.f-head{grid-template-columns:14px minmax(0,1fr) 16px;padding:14px}.f-head .st,.f-head .stamp{grid-column:2;grid-row:3;justify-self:start}.chev{grid-column:3}
.f-body{padding:4px 14px 18px}.fixfirst ol a{grid-template-columns:14px minmax(0,1fr) 16px}.fixfirst .sev-t,.fixfirst .c{display:none}
.lim li{grid-template-columns:1fr;gap:4px}.showing{margin-left:0;width:100%}.cards,.pgrid{grid-template-columns:1fr}.changes li{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media print{body{background:#fff}.tabs,.toolbar,.how,.theme-btn,footer .wrap>:last-child{display:none}html.js .tp[hidden]{display:grid}.tp+.tp{margin-top:28px}.f-body{display:grid!important}.chev{display:none}.panel,.f{box-shadow:none;break-inside:avoid}.flist.focus .f{background:#fff}}
`;

const JS = `
(function(){
  var DEFAULT_TAB='${DEFAULT_TAB}';
  var d=document;d.documentElement.classList.add('js');
  var root=d.documentElement,tb=d.querySelector('.theme-btn');
  if(tb){var syncTheme=function(){var light=root.dataset.theme==='light';tb.querySelector('.tl').textContent=light?'Dark':'Light';tb.setAttribute('aria-label','Switch to '+(light?'dark':'light')+' theme');};
    tb.hidden=false;syncTheme();
    tb.addEventListener('click',function(){var light=root.dataset.theme!=='light';if(light)root.dataset.theme='light';else delete root.dataset.theme;try{localStorage.setItem('seo-report-theme',light?'light':'dark')}catch(e){}syncTheme();});}
  var tabs=[].slice.call(d.querySelectorAll('.tab')),panels=[].slice.call(d.querySelectorAll('.tp'));
  function show(name,focusTab){var ok=false;tabs.forEach(function(t){var on=t.dataset.tab===name;t.setAttribute('aria-selected',on);t.tabIndex=on?0:-1;if(on){ok=true;if(focusTab)t.focus();}});
    if(!ok)return false;panels.forEach(function(p){p.hidden=p.id!=='p-'+name;});return true;}
  tabs.forEach(function(t,i){t.addEventListener('click',function(){history.replaceState(null,'','#'+t.dataset.tab);show(t.dataset.tab);});
    t.addEventListener('keydown',function(e){var k=e.key,j=i;if(k==='ArrowRight')j=(i+1)%tabs.length;else if(k==='ArrowLeft')j=(i-1+tabs.length)%tabs.length;else if(k==='Home')j=0;else if(k==='End')j=tabs.length-1;else return;
      e.preventDefault();history.replaceState(null,'','#'+tabs[j].dataset.tab);show(tabs[j].dataset.tab,true);});});
  var list=d.getElementById('flist');
  function setOpen(f,open){f.classList.toggle('open',open);f.querySelector('.f-head').setAttribute('aria-expanded',open);
    if(list)list.classList.toggle('focus',!!list.querySelector('.f.open'));}
  [].forEach.call(d.querySelectorAll('.f-head'),function(b){b.addEventListener('click',function(){var f=b.closest('.f');setOpen(f,!f.classList.contains('open'));});});
  var state={sev:'all',status:'all',area:'all',q:''};
  function apply(){if(!list)return;var n=0,all=list.children.length;[].forEach.call(list.children,function(f){
      var ok=(state.sev==='all'||f.dataset.sev===state.sev)&&(state.status==='all'||f.dataset.status===state.status)&&(state.area==='all'||f.dataset.area===state.area)&&(!state.q||f.dataset.text.indexOf(state.q)>-1);
      f.hidden=!ok;if(ok)n++;});
    d.getElementById('showing').textContent=(n===all?all:n+' of '+all)+' findings';d.getElementById('fnone').hidden=n>0;}
  [].forEach.call(d.querySelectorAll('.segb[data-sev]'),function(b){b.addEventListener('click',function(){[].forEach.call(d.querySelectorAll('.segb[data-sev]'),function(x){x.setAttribute('aria-pressed',x===b);});state.sev=b.dataset.sev;apply();});});
  var pb=[].slice.call(d.querySelectorAll('.segb[data-pstatus]'));pb.forEach(function(b){b.addEventListener('click',function(){pb.forEach(function(x){x.setAttribute('aria-pressed',x===b);});var st=b.dataset.pstatus;[].forEach.call(d.querySelectorAll('.prow'),function(r){r.hidden=st!=='all'&&r.dataset.status!==st;});});});
  var q=d.getElementById('q');if(q)q.addEventListener('input',function(){state.q=q.value.trim().toLowerCase();apply();});
  var fs=d.getElementById('fstatus');if(fs)fs.addEventListener('change',function(){state.status=fs.value;apply();});
  var fa=d.getElementById('farea');if(fa)fa.addEventListener('change',function(){state.area=fa.value;apply();});
  var fr=d.getElementById('freset');if(fr)fr.addEventListener('click',function(){state={sev:'all',status:'all',area:'all',q:''};if(q)q.value='';if(fs)fs.value='all';if(fa)fa.value='all';
    [].forEach.call(d.querySelectorAll('.segb[data-sev]'),function(x){x.setAttribute('aria-pressed',x.dataset.sev==='all');});apply();});
  [].forEach.call(d.querySelectorAll('.area[data-sev]'),function(a){a.addEventListener('click',function(e){e.preventDefault();var b=d.querySelector('.segb[data-sev="'+a.dataset.sev+'"]');if(b)b.click();history.replaceState(null,'','#findings');show('findings');window.scrollTo(0,0);});});
  [].forEach.call(d.querySelectorAll('.area[data-area]'),function(a){a.addEventListener('click',function(e){e.preventDefault();if(fa){fa.value=a.dataset.area;state.area=a.dataset.area;apply();}
    history.replaceState(null,'','#findings');show('findings');window.scrollTo(0,0);});});
  function route(e){var h=decodeURIComponent(location.hash.slice(1));if(!h){show(DEFAULT_TAB);return;}
    if(show(h))return;var f=d.getElementById(h);if(f&&f.classList.contains('f')){show('findings');f.hidden=false;setOpen(f,true);f.scrollIntoView({block:'start'});if(e)f.querySelector('.f-head').focus({preventScroll:true});}else show(DEFAULT_TAB);}
  window.addEventListener('beforeprint',function(){[].forEach.call(d.querySelectorAll('.prow'),function(r){r.open=true;});});
  window.addEventListener('hashchange',route);route();
})();
`;

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
<script>${JS}</script>
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
    L.push("## Since last audit", "", `Compared with the crawl of ${fmtDate(diff.since)}.`, "");
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
    if ((f.evidence || []).length) {
      L.push("| Where | Detail |", "| --- | --- |");
      for (const e of f.evidence)
        L.push(
          `| ${mdEsc([e.url && mdCode(e.url), e.file && `\`${e.file}${e.line ? ":" + e.line : ""}\``].filter(Boolean).join(" "))} | ${mdEsc(mdSafe(e.detail))} |`,
        );
      if (f.count > f.evidence.length) L.push("", `${f.count - f.evidence.length} more cases not listed.`);
      L.push("");
    }
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
    "Every checked rule is worth 10 points. A rule that passes, or whose findings are all fixed, earns 10. A rule with open findings earns by its worst one: low 8, medium or decision 6, high 3, blocker 0. The score is the share of points earned. Each open blocker caps it: one at 59, two at 49, three at 39. While a blocker is open, the panel also shows the score you reach once it is fixed. Area scores use the same rules within each area.",
    "",
  );
  return L.join("\n");
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
if (mdPath) writeFileSync(mdPath, markdown());
console.log(
  `render-report: ${findings.length} findings (${open.length} open, ${fixed.length} fixed), score ${overall ? overall.value : "n/a"} → ${outPath}${mdPath ? " + " + basename(mdPath) : ""}`,
);
