// Core Web Vitals from PageSpeed Insights (CrUX field data plus a lab run). The crawler calls it only with --outside,
// for public URLs.

export const CHECKS = {
  "cwv-fail": [
    "PERF-01",
    "high",
    n => `${n} page type(s) fail Core Web Vitals for real visitors`,
    "Google measures loading (LCP), responsiveness (INP) and layout stability (CLS) on real Chrome visits. Pages that fail rank lower in close calls and lose visitors who wait.",
    "Start with the failing metric: LCP (hero image size and priority, server response), INP (long JavaScript tasks, heavy third parties) or CLS (image dimensions, late-loading banners).",
  ],
};

export const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
export const CRUX_HISTORY_ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord";

// The four parts of an image LCP as CrUX names them, in the order they happen.
const LCP_PARTS = {
  ttfb: "largest_contentful_paint_image_time_to_first_byte",
  loadDelay: "largest_contentful_paint_image_resource_load_delay",
  loadDuration: "largest_contentful_paint_image_resource_load_duration",
  renderDelay: "largest_contentful_paint_image_element_render_delay",
};

const TREND = { lcp: "largest_contentful_paint", inp: "interaction_to_next_paint", cls: "cumulative_layout_shift" };
const day = d => (d?.year ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null);
// p75s over CrUX History's 25 weekly periods, as [first, last] per metric, plus the latest LCP parts in ms. With page,
// target is a URL rather than an origin. avg4 averages the first and last four weeks with data, steadier than single
// weeks. https://developer.chrome.com/docs/crux/history-api
export async function speedTrend(
  target,
  { key, endpoint = CRUX_HISTORY_ENDPOINT, fetchFn = fetch, formFactor = "PHONE", page = false },
) {
  const q = new URL(endpoint);
  q.searchParams.set("key", key);
  const r = await fetchFn(q.href, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      [page ? "url" : "origin"]: target,
      formFactor,
      metrics: [...Object.values(TREND), ...Object.values(LCP_PARTS)],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok)
    return {
      note: `CrUX history${page ? ` for ${target}` : formFactor === "PHONE" ? "" : ` (${formFactor.toLowerCase()})`}: ${r.status === 404 ? `not enough Chrome visits to this ${page ? "page" : "site"} for a trend` : `answered ${r.status}${r.status === 403 ? " (enable the Chrome UX Report API for this key)" : ""}`}.`,
    };
  const rec = (await r.json()).record || {},
    m = rec.metrics || {},
    periods = rec.collectionPeriods || [];
  // A period with too few visits is null: skipped, never read as 0.
  const weekly = s =>
    (s?.percentilesTimeseries?.p75s || []).map(x => (x == null || isNaN(Number(x)) ? null : Number(x)));
  const ends = s => {
    const xs = weekly(s).filter(x => x != null);
    return xs.length ? [xs[0], xs[xs.length - 1]] : null;
  };
  const mean = (xs, k) => {
    const v = xs.reduce((a, b) => a + b, 0) / xs.length;
    return k === "cls" ? Math.round(v * 100) / 100 : Math.round(v);
  };
  const avg4 = Object.fromEntries(
    Object.entries(TREND).flatMap(([k, id]) => {
      const xs = weekly(m[id]).filter(x => x != null);
      return xs.length >= 8 ? [[k, [mean(xs.slice(0, 4), k), mean(xs.slice(-4), k)]]] : [];
    }),
  );
  const latest = Object.entries(LCP_PARTS).map(([k, name]) => [k, m[name]?.percentilesTimeseries?.p75s?.at(-1)]);
  const lcpBreakdown = latest.every(([, v]) => v != null) && {
    source: "real visitors",
    url: target,
    ...Object.fromEntries(latest.map(([k, v]) => [k, Math.round(Number(v))])),
  };
  const last = day(periods.at(-1)?.lastDate) ? periods.at(-1) : null;
  return {
    trend: {
      weeks: periods.length,
      ...Object.fromEntries(Object.entries(TREND).map(([k, id]) => [k, ends(m[id])])),
      avg4,
      series: Object.fromEntries(Object.entries(TREND).map(([k, id]) => [k, weekly(m[id])])),
      periods: periods.map(p => day(p.lastDate)),
      ...(last ? { period: { from: day(last.firstDate), to: day(last.lastDate) } } : {}),
    },
    ...(lcpBreakdown ? { lcpBreakdown } : {}),
  };
}

// LCP subparts from a Lighthouse 13 report, in ms. A text LCP has no image to wait for or download.
export function labLcpParts(audits) {
  const rows = (audits?.["lcp-breakdown-insight"]?.details?.items || []).find(t => t.type === "table")?.items || [];
  const ms = s => Math.round(rows.find(r => r.subpart === s)?.duration ?? 0);
  return rows.some(r => r.subpart === "timeToFirstByte")
    ? {
        ttfb: ms("timeToFirstByte"),
        loadDelay: ms("resourceLoadDelay"),
        loadDuration: ms("resourceLoadDuration"),
        renderDelay: ms("elementRenderDelay"),
      }
    : null;
}
// The LCP node of a Lighthouse 13 run, its image from the snippet's src or first srcset candidate, and the discovery
// checklist: priorityHinted (fetchpriority="high", images only), eagerlyLoaded (not lazy, or preloaded) and
// requestDiscoverable (started by a preload or the HTML, not CSS or a script).
// https://github.com/GoogleChrome/lighthouse/blob/main/core/audits/insights/lcp-discovery-insight.js
export function labLcpElement(audits) {
  const items = id => audits?.[id]?.details?.items || [];
  const n = [...items("lcp-breakdown-insight"), ...items("lcp-discovery-insight")].find(i => i?.type === "node");
  if (!n) return null;
  const tag = typeof n.snippet === "string" ? n.snippet : "",
    attr = k => new RegExp(`\\s${k}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1]?.replace(/&amp;/g, "&");
  const src = /^<img\b/i.test(tag) ? attr("src") || attr("srcset")?.trim().split(/\s+/)[0] : null;
  const hinted = items("lcp-discovery-insight").find(i => i?.type === "checklist")?.items?.priorityHinted?.value;
  return {
    element: String(n.nodeLabel || n.selector || tag).slice(0, 200),
    ...(src ? { src: src.slice(0, 300) } : {}),
    ...(typeof hinted === "boolean" ? { fetchpriorityHigh: hinted } : {}),
  };
}
// Lab runs ({ url, lcpParts }): the home page's breakdown, else the first one.
export function labLcpBreakdown(runs) {
  const l = runs.filter(x => x.lcpParts),
    x = l.find(x => new URL(x.url).pathname === "/") || l[0];
  return x ? { source: "lab", url: x.url, ...x.lcpParts } : null;
}
// Good up to the first number, poor above the second, at p75 on phone and desktop alike.
// https://web.dev/articles/defining-core-web-vitals-thresholds
export const BANDS = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25] };
export const LIMITS = Object.fromEntries(Object.entries(BANDS).map(([k, [good]]) => [k, good]));
// FCP and TTFB aren't Core Web Vitals, so they stay out of BANDS and never count toward passing or the
// since-last-audit comparison.
// https://web.dev/articles/fcp
// https://web.dev/articles/ttfb
export const OTHER_BANDS = { fcp: [1800, 3000], ttfb: [800, 1800] };
export const band = (metric, value) => {
  const [good, poor] = BANDS[metric] || OTHER_BANDS[metric];
  return value <= good ? "good" : value <= poor ? "needs improvement" : "poor";
};

// PageSpeed reports CLS × 100. shares holds each metric's good, needs-improvement and poor proportions.
const PSI_METRICS = {
  lcp: "LARGEST_CONTENTFUL_PAINT_MS",
  inp: "INTERACTION_TO_NEXT_PAINT",
  cls: "CUMULATIVE_LAYOUT_SHIFT_SCORE",
  fcp: "FIRST_CONTENTFUL_PAINT_MS",
  ttfb: "EXPERIMENTAL_TIME_TO_FIRST_BYTE",
};
const cwv = m => {
  if (!m?.LARGEST_CONTENTFUL_PAINT_MS) return null;
  const shares = Object.fromEntries(
    Object.entries(PSI_METRICS).flatMap(([k, id]) => {
      const d = m[id]?.distributions;
      return Array.isArray(d) && d.length === 3
        ? [[k, d.map(b => Math.round((Number(b?.proportion) || 0) * 1000) / 1000)]]
        : [];
    }),
  );
  const fcp = m.FIRST_CONTENTFUL_PAINT_MS?.percentile,
    ttfb = m.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile;
  return {
    lcp: m.LARGEST_CONTENTFUL_PAINT_MS.percentile,
    inp: m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    cls: m.CUMULATIVE_LAYOUT_SHIFT_SCORE ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
    ...(fcp != null ? { fcp } : {}),
    ...(ttfb != null ? { ttfb } : {}),
    ...(Object.keys(shares).length ? { shares } : {}),
  };
};
export const passes = v =>
  v.lcp <= LIMITS.lcp && (v.inp == null || v.inp <= LIMITS.inp) && (v.cls == null || v.cls <= LIMITS.cls);
export const fmtCwv = v =>
  [
    `LCP ${(v.lcp / 1000).toFixed(1)} s`,
    v.inp != null && `INP ${Math.round(v.inp)} ms`,
    v.cls != null && `CLS ${Math.round(v.cls * 100) / 100}`,
  ]
    .filter(Boolean)
    .join(" · ");

// The home page plus one URL per first path segment, up to 10.
export function sampleUrls(urls, max = 10) {
  const seen = new Set(),
    out = [];
  for (const u of urls) {
    const seg = new URL(u).pathname.split("/")[1] || "";
    if (seen.has(seg)) continue;
    seen.add(seg);
    out.push(u);
  }
  return out.sort((a, b) => new URL(a).pathname.length - new URL(b).pathname.length).slice(0, max);
}

// For --desktop the crawler passes a no-op add, since PERF-01 judges phones.
export async function checkSpeed(urls, { add, endpoint = PSI_ENDPOINT, key, fetchFn = fetch, strategy = "mobile" }) {
  const samples = [],
    notes = [],
    PSI = strategy === "mobile" ? "PageSpeed" : `PageSpeed (${strategy})`;
  let limited = false;
  for (const url of urls) {
    if (limited) break;
    const q = new URL(endpoint);
    q.searchParams.set("url", url);
    q.searchParams.set("strategy", strategy);
    q.searchParams.set("category", "performance");
    if (key) q.searchParams.set("key", key);
    let data = null;
    for (let attempt = 0; attempt < 2 && !data; attempt++) {
      try {
        const r = await fetchFn(q.href, { signal: AbortSignal.timeout(90000) });
        if (r.status === 429 && attempt === 0) {
          await new Promise(ok => setTimeout(ok, 5000));
          continue;
        }
        if (r.status === 429) {
          limited = true;
          notes.push(
            `${PSI} refused the request (rate limit${key ? "" : ": requests without an API key share a daily quota that is usually used up"}). Speed wasn't checked.`,
          );
          break;
        }
        if (!r.ok) {
          notes.push(`${PSI}: ${url} answered ${r.status}.`);
          break;
        }
        data = await r.json();
      } catch (e) {
        notes.push(`${PSI}: ${url} failed (${e.message}).`);
        break;
      }
    }
    if (!data) continue;
    const le = data.loadingExperience;
    const field = le && !le.origin_fallback ? cwv(le.metrics) : null,
      origin = cwv(data.originLoadingExperience?.metrics);
    const a = data.lighthouseResult?.audits || {};
    const lcpParts = labLcpParts(a),
      lcpElement = labLcpElement(a),
      version = data.lighthouseResult?.lighthouseVersion;
    const lab = {
      lcp: a["largest-contentful-paint"]?.numericValue ?? null,
      cls: a["cumulative-layout-shift"]?.numericValue ?? null,
      tbt: a["total-blocking-time"]?.numericValue ?? null,
      ...(lcpParts ? { lcpParts } : {}),
      ...(lcpElement ? { lcpElement } : {}),
      ...(typeof version === "string" ? { version } : {}),
    };
    samples.push({ url, field, origin, lab });
    if (field && !passes(field)) add("cwv-fail", url, `${fmtCwv(field)} (75th percentile of real ${strategy} visits)`);
    else if (!field && lab.lcp != null)
      notes.push(
        `${PSI}: no real-user data for ${url} yet; lab run: LCP ${(lab.lcp / 1000).toFixed(1)} s, CLS ${Math.round((lab.cls || 0) * 100) / 100}, TBT ${Math.round(lab.tbt || 0)} ms.`,
      );
  }
  return { samples, notes, limited };
}
