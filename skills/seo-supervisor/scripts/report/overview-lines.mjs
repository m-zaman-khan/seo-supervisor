// @ts-check
// One-line summaries of the outside checks for the topic tabs' "at a glance" panels; each is "" without its data.
import { fmtCwv, passes, band } from "../checks/speed.mjs";
import { esc, fmtDate, link, notePath, obj } from "./format.mjs";

// LCP's four parts (speed.lcpBreakdown, in ms), each with its fix.
export const LCP_PART = {
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
// LCP, INP and CLS, each with Google's good / needs improvement / poor band.
function bandedCwv(v) {
  return [
    `LCP ${(v.lcp / 1000).toFixed(1)} s (${band("lcp", v.lcp)})`,
    v.inp != null && `INP ${Math.round(v.inp)} ms (${band("inp", v.inp)})`,
    v.cls != null && `CLS ${Math.round(v.cls * 100) / 100} (${band("cls", v.cls)})`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function overviewLines({ raw, lighthouse }) {
  // Origin field data, else the first page's.
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
  // notePath never throws: a URL it can't read shows as written, so one bad URL can't stop the report.
  const pageName = (u, home = "home page") => (notePath(u) === "/" ? home : notePath(u));
  // The crawler's throttled phone load: the home page, else the first page.
  function labSpeedText() {
    const l = (Array.isArray(raw.labSpeed) ? raw.labSpeed : []).filter(x => obj(x) && x.lcp != null),
      x = l.find(x => notePath(x.url) === "/") || l[0];
    return x
      ? `Lab speed, slow mobile (indicative): ${fmtCwv(x)} · TBT ${Math.round(x.tbt || 0)} ms on ${pageName(x.url, "the home page")}`
      : "";
  }
  function lcpText() {
    const b = obj(raw.speed?.lcpBreakdown);
    if (!b) return "";
    const [k] = Object.keys(LCP_PART).sort((x, y) => (b[y] || 0) - (b[x] || 0)),
      path = notePath(b.url);
    return `LCP breakdown (${b.source === "lab" ? `lab test${path ? `, ${pageName(b.url)}` : ""}` : "real visitors"}): most of the time goes on ${LCP_PART[k][0]} (${(b[k] / 1000).toFixed(1)} s). ${LCP_PART[k][1]}`;
  }
  // More than the default 5 pages (--lighthouse all) adds the three lowest performance scores.
  function lighthouseText() {
    const l = lighthouse,
      x = l.find(x => notePath(x.url) === "/") || l[0],
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
          .map(y => `${notePath(y.url)} ${y.scores.performance}`)
          .join(" · ")}`
      : "";
    return parts.length
      ? `Lighthouse (mobile, ${pageName(x.url)}): ${parts.map(([k, v]) => `${k} ${v}`).join(" · ")}${slowest}`
      : "";
  }
  // Names and dates only: the line never says an update caused anything.
  function googleUpdatesText(html = false) {
    const g = obj(raw.googleUpdates),
      isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!g || !Array.isArray(g.updates)) return "";
    const day = (d, year = false) => fmtDate(d, year);
    const span = (a, b) =>
      !isDay(b)
        ? `${day(a)}, still rolling out`
        : a === b
          ? day(a)
          : a.slice(0, 7) === b.slice(0, 7)
            ? `${+a.slice(8)}–${day(b)}`
            : `${day(a)} – ${day(b)}`;
    const text = html ? esc : s => String(s).replace(/[\\`*_[\]<>]/g, "\\$&"); // feed text: escaped for HTML or Markdown
    const name = u => (html ? link(u.url, esc(u.name)) : text(u.name));
    const list = g.updates
      .filter(u => obj(u) && u.name && isDay(u.start))
      .map(u => `${name(u)} (${span(u.start, u.end)})`);
    const none =
      isDay(g.from) && isDay(g.to)
        ? `none were announced between ${day(g.from, g.from.slice(0, 4) !== g.to.slice(0, 4))} and ${day(g.to, true)}`
        : "none were announced";
    return `Google ranking updates in this period: ${list.length ? list.join(" · ") : none}${g.note ? `. ${text(g.note)}` : ""}`;
  }
  // --desktop: origin field data, else the first page's, plus the desktop trend.
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
  return {
    speedText,
    authorityText,
    ahrefsCredit,
    labSpeedText,
    lcpText,
    lighthouseText,
    googleUpdatesText,
    desktopSpeedText,
  };
}
