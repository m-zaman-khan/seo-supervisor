// @ts-check
// Search and analytics lines for findings, plan rows and the search panels.
import { esc, fmtDate, num, obj, plural } from "./format.mjs";

// Matomo and PostHog: a page counts only with visits above zero, and dates show only when they are dates.
export const visitsOf = t => {
  const n = Number(t?.visits);
  return n > 0 ? n : 0;
};
export const isoDates = x =>
  [x?.period?.from, x?.period?.to].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    ? `${x.period.from} to ${x.period.to}`
    : "";
// A row by page: path and query exactly, else the path, else both compared without tracking parameters or the
// trailing slash, so /pricing/?utm_source=x finds /pricing/. TRACKING is CRAWL-10's list (checks/coverage.mjs) plus
// srsltid, which Merchant Center auto-tagging adds to free listing links.
const TRACKING = /^(utm_\w+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|yclid|igshid|mc_cid|mc_eid|_gl|_ga|srsltid)$/i;
const looseKey = (x, query = true) => {
  const q = query ? [...x.searchParams].filter(([k]) => !TRACKING.test(k)) : [];
  return x.pathname.replace(/(.)\/$/, "$1") + (q.length ? "?" + new URLSearchParams(q) : "");
};
const loose = new WeakMap(); // each map's rows by loose key, the first row of a key kept
const looseRows = map => {
  if (!loose.has(map)) {
    const rows = new Map();
    for (const [k, v] of Object.entries(map)) {
      try {
        const key = looseKey(new URL(k, "https://site.invalid"));
        if (!rows.has(key)) rows.set(key, v);
      } catch {}
    }
    loose.set(map, rows);
  }
  return loose.get(map);
};
export const byPath = (map, u) => {
  if (!obj(map) || !u) return null;
  let x;
  try {
    x = new URL(u, "https://site.invalid");
  } catch {
    return null;
  }
  const rows = () => looseRows(map);
  return (
    obj(map[x.pathname + x.search] || map[x.pathname]) || obj(rows().get(looseKey(x)) || rows().get(looseKey(x, false)))
  );
};
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
const GTYPE = {
  discover: "Discover",
  image: "Google Images",
  video: "Video search",
  news: "the News tab",
  googleNews: "Google News",
  webMultimodal: "Google Lens and Circle to Search",
};
// Google's own brand label from the Search Analytics API: numbers only, both sides or nothing.
const brandSide = x => (obj(x) && Number.isFinite(x.clicks) && Number.isFinite(x.impressions) ? x : null);

// One traffic line per path, from every source that has the page.
export function searchTraffic({ raw }, { linked }) {
  const traffic = obj(raw.traffic),
    bing = obj(raw.bing),
    analytics = obj(raw.analytics),
    matomo = obj(raw.matomo),
    posthog = obj(raw.posthog);
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
    // same days), else Matomo's or PostHog's. Bing's dates are on its own search line.
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
  // Clarity covers only the last 1 to 3 days, so it gets its own line under the traffic line. A share shows only when
  // it's above zero.
  const clarity = obj(raw.clarity),
    share = v => typeof v === "number" && v >= 0 && v <= 100;
  const sharePct = v => `${v > 0 && v < 1 ? "under 1" : Math.round(v)}%`;
  const clarityWhen = () => {
    const n = [1, 2, 3].includes(clarity?.days) ? clarity.days : 3,
      d = /^\d{4}-\d{2}-\d{2}$/.test(clarity?.read) ? fmtDate(clarity.read) : "";
    return d ? `the ${n === 1 ? "day" : `${n} days`} before ${d}` : `last ${n === 1 ? "day" : `${n} days`}`;
  };
  const clarityPages = () =>
    Object.entries(obj(clarity?.traffic) || {}).filter(
      ([, c]) => obj(c) && Number.isInteger(c.sessions) && c.sessions > 0,
    );
  const clarityFor = u => {
    const c = byPath(clarity?.traffic, u);
    if (!c || !Number.isInteger(c.sessions) || c.sessions <= 0) return null;
    const of = (k, w) => share(c[k]) && c[k] > 0 && `${w} in ${sharePct(c[k])} of sessions`;
    return `Microsoft Clarity (${clarityWhen()}): ${[plural(c.sessions, "session"), share(c.scrollDepth) && `average scroll depth ${sharePct(c.scrollDepth)}`, of("quickBacks", "quick backs"), of("rageClicks", "rage clicks"), of("deadClicks", "dead clicks"), of("excessiveScroll", "excessive scrolling")].filter(Boolean).join(" · ")}`;
  };
  const clarityOf = f => {
    const e = (f.evidence || []).find(x => x.url && clarityFor(x.url));
    return e && { text: clarityFor(e.url), path: new URL(e.url, "https://site.invalid").pathname };
  };
  const clarityHtml = f => {
    const t = clarityOf(f);
    return t ? `<p class="quiet">${esc(t.text)} on <code>${esc(t.path)}</code></p>` : "";
  };
  // Top pages need 10 or more sessions, a local cut-off, so one visit's quick back can't top the list.
  const clarityLine = () => {
    const pages = clarityPages();
    if (!pages.length) return null;
    const most = (k, w) => {
      const top = pages
        .filter(([, c]) => c.sessions >= 10 && share(c[k]) && c[k] > 0)
        .sort((a, b) => b[1][k] - a[1][k])
        .slice(0, 3);
      return top.length && `most ${w}: ${top.map(([p, c]) => `${p} ${sharePct(c[k])}`).join(", ")}`;
    };
    const tops = [most("quickBacks", "quick backs"), most("rageClicks", "rage clicks")].filter(Boolean);
    return `Microsoft Clarity (${clarityWhen()}): ${plural(
      pages.reduce((s, [, c]) => s + c.sessions, 0),
      "session",
    )} on ${plural(pages.length, "page")}${tops.length ? ` · ${tops.join(" · ")} (pages with 10 or more sessions)` : ""}`;
  };
  // Site-wide search lines. Third-party data, escaped where shown.
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
      brandSide(raw.brandSplit?.branded) &&
        brandSide(raw.brandSplit?.nonBranded) &&
        `Brand searches, as Google labels them: ${num(raw.brandSplit.branded.clicks)} clicks · ${num(raw.brandSplit.branded.impressions)} impressions; other searches: ${num(raw.brandSplit.nonBranded.clicks)} clicks · ${num(raw.brandSplit.nonBranded.impressions)} impressions${per}`,
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
      linked.length &&
        `${plural(linked.length, "page")} ${linked.length === 1 ? "has" : "have"} links from other sites`,
    ].filter(Boolean);
    return [
      ...googleLines(),
      bits.length && `Bing${bingDates ? ` (${bingDates})` : ""}: ${bits.join(" · ")}`,
      ga &&
        `Google Analytics: ${plural(sum(analytics, "sessions"), "organic visit")} to ${plural(ga, "landing page")}${raw.trafficPeriod ? ` (${String(raw.trafficPeriod).toLowerCase()})` : ""}`,
      visitsLine("Matomo", matomo),
      visitsLine("PostHog", posthog),
      clarityLine(),
    ].filter(Boolean);
  }
  // positions holds shares of queries (0 to 1) by average position.
  const positionsText = () => {
    const p = obj(raw.positions),
      ok = ["top3", "top10", "beyond"].every(k => typeof p?.[k] === "number" && p[k] >= 0 && p[k] <= 1);
    if (!ok || !(Number.isInteger(p.queries) && p.queries > 0)) return "";
    const pct = k => `${Math.round(100 * p[k])}%`;
    return `Search Console queries by average position: ${pct("top3")} in the top 3 · ${pct("top10")} in the top 10 · ${pct("beyond")} beyond, of ${plural(p.queries, "query", "queries")}${raw.trafficPeriod ? ` (${String(raw.trafficPeriod).toLowerCase()})` : ""}`;
  };
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
              .map(([k, v]) => /** @type {[string, number]} */ ([k, visitsOf(v)]))
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
  return {
    trafficFor,
    trafficOf,
    trafficHtml,
    clarityOf,
    clarityHtml,
    searchLines,
    positionsText,
    analyticsSplitLines,
  };
}
