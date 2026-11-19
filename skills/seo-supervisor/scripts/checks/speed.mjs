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

// The origin's p75s over CrUX History's 25 weekly periods, as [first, last] per metric, plus the latest LCP parts
// in ms.
// https://developer.chrome.com/docs/crux/history-api
export async function speedTrend(origin, { key, endpoint = CRUX_HISTORY_ENDPOINT, fetchFn = fetch }) {
  const q = new URL(endpoint);
  q.searchParams.set("key", key);
  const r = await fetchFn(q.href, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      origin,
      formFactor: "PHONE",
      metrics: [
        "largest_contentful_paint",
        "interaction_to_next_paint",
        "cumulative_layout_shift",
        ...Object.values(LCP_PARTS),
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok)
    return {
      note: `CrUX history: ${r.status === 404 ? "not enough Chrome visits to this site for a trend" : `answered ${r.status}${r.status === 403 ? " (enable the Chrome UX Report API for this key)" : ""}`}.`,
    };
  const rec = (await r.json()).record || {},
    m = rec.metrics || {};
  // A period with too few visits is null: skipped, never read as 0.
  const ends = s => {
    const xs = (s?.percentilesTimeseries?.p75s || [])
      .filter(x => x != null)
      .map(Number)
      .filter(x => !isNaN(x));
    return xs.length ? [xs[0], xs[xs.length - 1]] : null;
  };
  const latest = Object.entries(LCP_PARTS).map(([k, name]) => [k, m[name]?.percentilesTimeseries?.p75s?.at(-1)]);
  const lcpBreakdown = latest.every(([, v]) => v != null) && {
    source: "real visitors",
    url: origin,
    ...Object.fromEntries(latest.map(([k, v]) => [k, Math.round(Number(v))])),
  };
  return {
    trend: {
      weeks: (rec.collectionPeriods || []).length,
      lcp: ends(m.largest_contentful_paint),
      inp: ends(m.interaction_to_next_paint),
      cls: ends(m.cumulative_layout_shift),
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
// Lab runs ({ url, lcpParts }): the home page's breakdown, else the first one.
export function labLcpBreakdown(runs) {
  const l = runs.filter(x => x.lcpParts),
    x = l.find(x => new URL(x.url).pathname === "/") || l[0];
  return x ? { source: "lab", url: x.url, ...x.lcpParts } : null;
}
export const LIMITS = { lcp: 2500, inp: 200, cls: 0.1 };

// PageSpeed reports CLS as its percentile × 100.
const cwv = m =>
  m && m.LARGEST_CONTENTFUL_PAINT_MS
    ? {
        lcp: m.LARGEST_CONTENTFUL_PAINT_MS.percentile,
        inp: m.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
        cls: m.CUMULATIVE_LAYOUT_SHIFT_SCORE ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
      }
    : null;
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

export async function checkSpeed(urls, { add, endpoint = PSI_ENDPOINT, key, fetchFn = fetch, strategy = "mobile" }) {
  const samples = [],
    notes = [];
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
            `PageSpeed refused the request (rate limit${key ? "" : ": requests without an API key share a daily quota that is usually used up"}). Speed wasn't checked.`,
          );
          break;
        }
        if (!r.ok) {
          notes.push(`PageSpeed: ${url} answered ${r.status}.`);
          break;
        }
        data = await r.json();
      } catch (e) {
        notes.push(`PageSpeed: ${url} failed (${e.message}).`);
        break;
      }
    }
    if (!data) continue;
    const le = data.loadingExperience;
    const field = le && !le.origin_fallback ? cwv(le.metrics) : null,
      origin = cwv(data.originLoadingExperience?.metrics);
    const a = data.lighthouseResult?.audits || {};
    const lcpParts = labLcpParts(a);
    const lab = {
      lcp: a["largest-contentful-paint"]?.numericValue ?? null,
      cls: a["cumulative-layout-shift"]?.numericValue ?? null,
      tbt: a["total-blocking-time"]?.numericValue ?? null,
      ...(lcpParts ? { lcpParts } : {}),
    };
    samples.push({ url, field, origin, lab });
    if (field && !passes(field)) add("cwv-fail", url, `${fmtCwv(field)} (75th percentile of real ${strategy} visits)`);
    else if (!field && lab.lcp != null)
      notes.push(
        `PageSpeed: no real-user data for ${url} yet; lab run: LCP ${(lab.lcp / 1000).toFixed(1)} s, CLS ${Math.round((lab.cls || 0) * 100) / 100}, TBT ${Math.round(lab.tbt || 0)} ms.`,
      );
  }
  return { samples, notes, limited };
}
