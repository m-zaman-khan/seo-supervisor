#!/usr/bin/env node
// @ts-check
// Search Console and GA4 data for the audit. Read-only, except submit-sitemap, which writes only with --yes.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { isMain } from "./lib/is-main.mjs";
import { loginDir } from "./lib/settings-dir.mjs";
import { proxyNote } from "./lib/proxy.mjs";
import { SHARED_CLIENT } from "./lib/google-client.mjs";
import { addTraffic, gscFindings } from "./gsc-import.mjs";
import {
  SC,
  GA,
  SCOPES,
  endpointsFrom,
  Fail,
  fail,
  FORM,
  tokenFile,
  load,
  save,
  tokenRequest,
  serviceAccountToken,
  session,
  API_OFF,
  whoOf,
  explain,
} from "./google/session.mjs";

export { Fail };
// Read/write Search Console, asked for only by submit-sitemap --yes, never at connect.
const WM = "https://www.googleapis.com/auth/webmasters";
const has = (scope, x) => (scope || "").split(" ").includes(x); // not includes() on the string: WM is a prefix of SC
const SC_API = { name: "Google Search Console API", where: "Search Console → Settings → Users and permissions" };
const ADMIN_API = {
  name: "Google Analytics Admin API",
  where: "Google Analytics → Admin → Property access management",
};
const DATA_API = { name: "Google Analytics Data API", where: ADMIN_API.where };
// Logging problems Google lists, so a change they caused isn't read as real. type limits one to that search type.
// Add new ones from the same page.
const DISCOVER_LOSS = "Discover clicks and impressions were under-counted";
const ANOMALIES = [
  {
    from: "2025-05-13",
    to: "2026-04-27",
    what: "impressions weren't counted accurately, so CTR and average position were off too (clicks weren't affected)",
  },
  { from: "2026-05-07", to: "2026-05-08", type: "discover", what: DISCOVER_LOSS },
  { from: "2026-05-21", to: "2026-05-21", type: "discover", what: DISCOVER_LOSS },
  { from: "2026-06-24", to: "2026-06-24", type: "discover", what: DISCOVER_LOSS },
  { from: "2026-08-13", to: "2026-08-13", type: "discover", what: DISCOVER_LOSS },
].map(a => ({ ...a, url: "https://support.google.com/webmasters/answer/6211453" }));
export const anomaliesIn = (from, to, type) => ANOMALIES.filter(a => a.type === type && a.from <= to && a.to >= from);
// Shares of queries, not of impressions, by average position; top10 includes top3.
export function positionShares(queries) {
  if (!queries.length) return null;
  const share = n => Math.round((1000 * n) / queries.length) / 1000,
    top10 = queries.filter(q => q.position <= 10).length;
  return {
    queries: queries.length,
    top3: share(queries.filter(q => q.position <= 3).length),
    top10: share(top10),
    beyond: share(queries.length - top10),
  };
}

export const challengeFor = verifier => createHash("sha256").update(verifier).digest("base64url");
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: challengeFor(verifier) };
}

// ---------- the saved sign-in (google/session.mjs keeps it and makes the calls) ----------
const pendingFile = () => join(loginDir(), "pending-signin.txt");
const readJson = f => {
  let t;
  try {
    t = readFileSync(f, "utf8");
  } catch (e) {
    fail(`google: can't read ${f} (${e.code || e.message}).`);
  }
  try {
    return JSON.parse(t);
  } catch {
    fail(`google: ${f} isn't a JSON file from Google Cloud.`);
  }
};

const httpUrl = (u, what, eg) => {
  let x;
  try {
    x = new URL(u);
  } catch {}
  if (!x || !/^https?:$/.test(x.protocol)) fail(`google: ${what}, like ${eg} (got ${u}).`);
  return x;
};

// The property: a domain property covering the host, else the longest URL-prefix property the site sits under.
async function pickProperty(g, origin, who) {
  let sites;
  try {
    sites = ((await g.call(`${g.E.searchConsole}/sites`)).siteEntry || []).filter(
      x => x.permissionLevel !== "siteUnverifiedUser",
    );
  } catch (e) {
    fail("google: " + explain(e, "the list of Search Console properties", SC_API, who));
  }
  const h = origin.hostname,
    href = origin.origin + origin.pathname;
  const prop = (
    sites.find(
      x => x.siteUrl.startsWith("sc-domain:") && (h === x.siteUrl.slice(10) || h.endsWith("." + x.siteUrl.slice(10))),
    ) || sites.filter(x => href.startsWith(x.siteUrl)).sort((a, b) => b.siteUrl.length - a.siteUrl.length)[0]
  )?.siteUrl;
  if (!prop)
    fail(
      `google: ${origin.origin} isn't in the Search Console properties this account can see (${sites.map(x => x.siteUrl).join(", ") || "it can't see any"}). Add and verify the site in Search Console, or connect with the Google account that has it.`,
    );
  return prop;
}
// A Search Console address as a path on the site's host, else null. www and apex count as one host, as in gsc-import.
const bare = x => x.replace(/^www\./, "");
export const pagePath = (u, host) => {
  try {
    const x = new URL(u);
    return bare(x.hostname) === bare(host) ? x.pathname + x.search : null;
  } catch {
    return null;
  }
};
// Fails early when Search Console access wasn't granted at sign-in.
function scSession(opts) {
  const g = session(opts),
    s = g.store(),
    scope = s.scope || SCOPES.join(" ");
  if (!scope.includes(SC))
    fail(
      "google: Search Console access wasn't granted when you signed in. Run node google.mjs connect again and leave the Search Console box ticked.",
    );
  return { g, scope, who: whoOf(s) };
}
// The site's property and a Search Analytics query on it for other scripts, with token renewal and plain errors.
/** @param {{ site?: string, home?: string, endpoints?: any }} [opts] */
export async function searchConsole({ site, home, endpoints } = {}) {
  const origin = httpUrl(site, "--site must be the site's address", "https://www.example.com");
  const { g, who } = scSession({ home, endpoints }),
    prop = await pickProperty(g, origin, who);
  return {
    origin,
    prop,
    query: body => g.call(`${g.E.searchConsole}/sites/${encodeURIComponent(prop)}/searchAnalytics/query`, body),
    explain: e => explain(e, `${prop} in Search Console`, SC_API, who),
  };
}
// A domain property covers its subdomains; a URL-prefix property only addresses that start with it.
const inProperty = (prop, u) => {
  const d = prop.startsWith("sc-domain:") && prop.slice(10);
  return d ? u.hostname === d || u.hostname.endsWith("." + d) : u.href.startsWith(prop);
};

// ---------- fetch ----------
// crawl, a parsed seo-crawl.json, lets URL Inspection sample key pages with no search traffic yet. inspect (paths or
// URLs) replaces the default sample.
/** @param {{ site?: string, days?: number | string, ga4Property?: string, crawl?: any, inspect?: string[], pageSize?: number, home?: string, endpoints?: any }} [opts] */
export async function fetchGoogle({
  site,
  days = 90,
  ga4Property,
  crawl,
  inspect,
  pageSize = 25000,
  home,
  endpoints,
} = {}) {
  const origin = httpUrl(site, "--site must be the site's address", "https://www.example.com");
  days = Math.round(Number(days));
  if (!(days >= 1 && days <= 480)) fail("google: --days must be between 1 and 480 (Search Console keeps 16 months).");
  const { g, scope, who } = scSession({ home, endpoints }),
    { E } = g,
    notes = [];
  // A failed section becomes a note. A fatal one stops the pull, except on 429: a used-up quota is still only a note.
  const attempt = async (what, api, fn, fatal = false) => {
    try {
      return await fn();
    } catch (e) {
      const msg = explain(e, what, api, who);
      if (fatal && e.status !== 429) fail("google: " + msg);
      notes.push(msg);
    }
  };

  // Search Console's last 2-3 days are provisional, so the period ends 3 days ago.
  const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const endDate = day(3),
    startDate = day(days + 2),
    period = `Last ${days} days, ${startDate} to ${endDate}`;

  const prop = await pickProperty(g, origin, who),
    h = origin.hostname;
  const scBase = `${E.searchConsole}/sites/${encodeURIComponent(prop)}`;

  // www and apex count as one host; other subdomains of a domain property are left out.
  const pathOf = u => pagePath(u, h);
  const metrics = r => ({
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Math.round(r.ctr * 10000) / 10000,
    position: Math.round(r.position * 10) / 10,
  });
  const ci = r => ({ clicks: r.clicks, impressions: r.impressions });
  const sa = body =>
    g.call(`${scBase}/searchAnalytics/query`, { startDate, endDate, type: "web", dimensions: [], ...body });
  const rowsFor = async (dimensions, dates = {}) => {
    const rows = [];
    while (rows.length < 25000) {
      const rowLimit = Math.min(pageSize, 25000 - rows.length),
        got = (await sa({ ...dates, dimensions, rowLimit, startRow: rows.length })).rows || [];
      rows.push(...got);
      if (got.length < rowLimit) break;
    }
    if (rows.length >= 25000)
      notes.push(
        `Search Console has 25,000 or more ${{ page: "pages", query: "queries" }[dimensions.join()] || "page and query pairs"} for ${dates.startDate ? "the period before" : "this period"}; only the top 25,000 were read, so the least-searched ones are left out.`,
      );
    return rows;
  };
  const traffic = {},
    urls = {},
    pageQueries = {},
    pq = {};
  let queries = [],
    pagesRead = false,
    queriesRead = false;
  await attempt(
    `${prop} in Search Console`,
    SC_API,
    async () => {
      for (const r of await rowsFor(["page"])) {
        const p = pathOf(r.keys[0]);
        if (p) {
          urls[p] ||= r.keys[0];
          addTraffic(traffic, p, metrics(r));
        }
      }
      pagesRead = true;
      queries = (await rowsFor(["query"])).map(r => ({ query: r.keys[0], ...metrics(r) }));
      queriesRead = true;
      for (const r of await rowsFor(["page", "query"])) {
        const p = pathOf(r.keys[0]);
        if (p) {
          urls[p] ||= r.keys[0];
          addTraffic((pq[p] ||= {}), r.keys[1], metrics(r));
        }
      }
      for (const [p, list] of Object.entries(pq))
        pageQueries[p] = Object.entries(list).map(([query, m]) => ({ query, ...m }));
    },
    true,
  );

  // A query with no dimensions gives the totals Search Console's chart shows, including the clicks of anonymized
  // queries that query rows leave out. `complete` is null when the queries weren't read.
  // https://developers.google.com/search/blog/2022/10/performance-data-deep-dive
  let siteTotals = null;
  await attempt(`the site totals for ${prop} in Search Console`, SC_API, async () => {
    const t = (await sa({})).rows?.[0];
    if (!t) return;
    const queryClicks = queries.reduce((s, q) => s + q.clicks, 0);
    siteTotals = { ...metrics(t), queryClicks, complete: queriesRead ? queryClicks >= t.clicks : null };
  });

  // The period before has the same length. A drop is at least 20 clicks and 30% lost: below 20 a small page's
  // weekly swing looks like a drop, and a big page loses 20 to noise.
  let trafficChange = null;
  const total = (m, k) => Object.values(m).reduce((s, x) => s + x[k], 0),
    prevStart = day(2 * days + 2),
    prevEnd = day(days + 3);
  if (2 * days + 2 > 482)
    notes.push(
      "Search Console keeps 16 months of data, so a period longer than 240 days has no full period before it to compare with; the change in search clicks and the new searches were left out.",
    );
  // Without this period's pages every page would look like a drop to 0.
  else if (!pagesRead)
    notes.push(
      "This period's pages couldn't be read from Search Console, so the change in search clicks from the period before was left out.",
    );
  else
    await attempt(`${prop} in Search Console for the period before`, SC_API, async () => {
      const before = {};
      for (const r of await rowsFor(["page"], { startDate: prevStart, endDate: prevEnd })) {
        const p = pathOf(r.keys[0]);
        if (p) addTraffic(before, p, metrics(r));
      }
      const drops = Object.entries(before)
        .map(([path, b]) => ({ path, before: b.clicks, after: traffic[path]?.clicks || 0 }))
        .filter(d => d.before - d.after >= 20 && d.after <= d.before * 0.7)
        .sort((a, b) => b.before - b.after - (a.before - a.after))
        .slice(0, 10);
      trafficChange = {
        previous: {
          from: prevStart,
          to: prevEnd,
          clicks: total(before, "clicks"),
          impressions: total(before, "impressions"),
        },
        current: {
          from: startDate,
          to: endDate,
          clicks: total(traffic, "clicks"),
          impressions: total(traffic, "impressions"),
        },
        drops,
      };
    });

  // Queries with no row in the period before. Rows stop at 25,000 and leave out rare (anonymized) queries, so a
  // search listed may have had a few impressions before.
  // https://developers.google.com/webmaster-tools/v1/searchanalytics/query
  let newQueries = null;
  if (2 * days + 2 <= 482 && queriesRead)
    await attempt(`the searches for ${prop} in Search Console for the period before`, SC_API, async () => {
      const before = await rowsFor(["query"], { startDate: prevStart, endDate: prevEnd }),
        had = new Set(before.map(r => r.keys[0]));
      newQueries = queries
        .filter(q => q.impressions > 0 && !had.has(q.query))
        .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
        .slice(0, 50);
      if (before.length >= 25000 && newQueries.length)
        notes.push(
          "Only the period before's top 25,000 searches could be read, so some of the new searches may have been searched then too.",
        );
    });

  // Only the page dimension, which every type allows: Discover and Google News have no queries. Totals are the
  // property's, other subdomains included.
  const searchTypes = {};
  // webMultimodal is Google Lens, Circle to Search and image uploads.
  await attempt("the image, video, news, Discover and Lens results in Search Console", SC_API, async () => {
    for (const type of ["image", "video", "news", "googleNews", "discover", "webMultimodal"]) {
      const t = (await sa({ type })).rows?.[0];
      if (!t?.impressions) continue;
      const pages = {};
      for (const r of (await sa({ type, dimensions: ["page"], rowLimit: 10 })).rows || []) {
        const p = pathOf(r.keys[0]);
        if (p)
          pages[p] = {
            clicks: (pages[p]?.clicks || 0) + r.clicks,
            impressions: (pages[p]?.impressions || 0) + r.impressions,
          };
      }
      searchTypes[type] = { ...ci(t), pages };
    }
  });

  // Country keys are ISO 3166 alpha-3, lower case.
  const byDevice = {},
    byCountry = {};
  await attempt("search by device and country in Search Console", SC_API, async () => {
    for (const r of (await sa({ dimensions: ["device"] })).rows || []) byDevice[r.keys[0]] = ci(r);
    for (const r of ((await sa({ dimensions: ["country"] })).rows || [])
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, 10))
      byCountry[r.keys[0]] = ci(r);
  });

  // brandedClassification has data from 21 Feb 2026, only for top-level properties with enough searches; others get
  // no rows. It can't be combined with a query filter.
  // https://developers.google.com/search/blog/2026/11/search-analytics-api-update
  let brandSplit = null;
  await attempt("the brand and non-brand split in Search Console", SC_API, async () => {
    const rows = (await sa({ dimensions: ["brandedClassification"] })).rows || [],
      side = k => rows.find(r => r.keys?.[0] === k);
    if (side("BRANDED") || side("NON_BRANDED"))
      brandSplit = {
        branded: ci(side("BRANDED") || { clicks: 0, impressions: 0 }),
        nonBranded: ci(side("NON_BRANDED") || { clicks: 0, impressions: 0 }),
      };
    else
      notes.push(
        "Search Console labels brand searches only for top-level properties with enough searches (data from 21 Feb 2026), and this property isn't eligible, so there's no brand and non-brand split.",
      );
  });

  // inspect replaces the default sample: the home page, up to 10 crawled pages (shallowest, most linked), then top
  // pages by clicks, 20 in all. The crawl may be of a local build, so only its paths are used.
  // Google allows 2,000 inspections a day per property and 600 a minute; 200 stays under the minute's limit and
  // leaves most of the day's.
  const INSPECT_MAX = 200;
  const pathOnly = u => {
    try {
      const x = new URL(u);
      return x.pathname + x.search;
    } catch {
      return null;
    }
  };
  const crawled = (crawl?.pages || [])
    .filter(p => p.status === 200 && !p.noindex)
    .sort((a, b) => (a.depth ?? 99) - (b.depth ?? 99) || (b.linksIn || 0) - (a.linksIn || 0))
    .map(p => pathOnly(p.url))
    .filter(Boolean);
  const top = Object.entries(traffic)
    .sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions)
    .map(([p]) => p);
  let picked = [...new Set(["/", ...crawled.slice(0, 10), ...top])]
    .slice(0, 20)
    .map(p => urls[p] || new URL(p, origin).href);
  if (inspect?.length) {
    const on = [],
      off = [];
    for (const u of inspect) {
      let x;
      try {
        x = new URL(u, origin);
      } catch {}
      (x && /^https?:$/.test(x.protocol) && inProperty(prop, x) ? on : off).push(x?.href || u);
    }
    picked = [...new Set(on)];
    if (off.length)
      notes.push(
        `${off.length} of the pages to inspect aren't in the Search Console property ${prop}, so they were skipped: ${off.slice(0, 10).join(", ")}.`,
      );
    if (picked.length > INSPECT_MAX)
      notes.push(
        `URL Inspection checked the first ${INSPECT_MAX} of ${picked.length} pages you listed. Google allows 2,000 a day per property (600 a minute), so run fetch again later with the rest.`,
      );
  }
  const inspection = [];
  const issues = (d, severity) => [
    ...new Set(
      (d.items || [])
        .flatMap(i => i.issues || [])
        .filter(i => i.severity === severity)
        .map(i => i.issueMessage),
    ),
  ];
  // Each page on its own, so one error loses only that page. A usage limit (429), a lost connection or a refused
  // sign-in would fail every page after it, so those stop the run and keep what was read.
  const toInspect = picked.slice(0, INSPECT_MAX),
    failed = [];
  for (const url of toInspect) {
    let r;
    try {
      r =
        (await g.call(`${E.inspection}/urlInspection/index:inspect`, { inspectionUrl: url, siteUrl: prop }))
          .inspectionResult || {};
    } catch (e) {
      if (e.status === 429 || e instanceof Fail) {
        notes.push(
          `${explain(e, "URL Inspection in Search Console", SC_API, who)} URL Inspection stopped after ${inspection.length + failed.length} of ${toInspect.length} pages; the ones it read are kept.`,
        );
        break;
      }
      failed.push(
        `${url} (Google answered ${e.status || "with an error"}${/^HTTP \d+$/.test(e.message) ? "" : `: ${e.message}`})`,
      );
      continue;
    }
    const x = r.indexStatusResult || {},
      rr = r.richResultsResult;
    // referringUrls are pages linking to the URL, directly or indirectly; the first 10 are kept.
    // https://developers.google.com/webmaster-tools/v1/urlInspection.index/UrlInspectionResult
    inspection.push({
      url,
      verdict: x.verdict ?? null,
      coverageState: x.coverageState ?? null,
      indexingState: x.indexingState ?? null,
      robotsTxtState: x.robotsTxtState ?? null,
      pageFetchState: x.pageFetchState ?? null,
      googleCanonical: x.googleCanonical ?? null,
      userCanonical: x.userCanonical ?? null,
      lastCrawlTime: x.lastCrawlTime ?? null,
      crawledAs: x.crawledAs ?? null,
      referringUrls: Array.isArray(x.referringUrls) ? x.referringUrls.slice(0, 10) : [],
      link: r.inspectionResultLink ?? null,
      richResults: rr
        ? {
            verdict: rr.verdict ?? null,
            types: (rr.detectedItems || []).map(d => ({
              type: d.richResultType,
              items: (d.items || []).length,
              errors: issues(d, "ERROR"),
              warnings: issues(d, "WARNING"),
            })),
          }
        : null,
    });
  }
  if (failed.length)
    notes.push(
      `URL Inspection couldn't read ${failed.length} of ${toInspect.length} pages, so they're left out: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ` and ${failed.length - 5} more` : ""}.`,
    );

  const sitemaps = [];
  await attempt("the sitemaps in Search Console", SC_API, async () => {
    for (const x of (await g.call(`${scBase}/sitemaps`)).sitemap || [])
      sitemaps.push({
        path: x.path,
        lastSubmitted: x.lastSubmitted ?? null,
        lastDownloaded: x.lastDownloaded ?? null,
        isPending: !!x.isPending,
        errors: Number(x.errors || 0),
        warnings: Number(x.warnings || 0),
      });
    if (!sitemaps.length)
      notes.push(
        `No sitemap is submitted in Search Console for ${prop}. Submit one under Indexing → Sitemaps so Google finds new and changed pages sooner.`,
      );
  });

  // GA4: --ga4-property, else the one property whose web stream is this site (even when it's the only one).
  const analytics = {};
  let gaProp = ga4Property ? String(ga4Property).replace(/^properties\//, "") : null,
    gaRead = false;
  if (!scope.includes(GA))
    notes.push(
      "Google Analytics wasn't included when you signed in, so there's no visit data. To add it, run node google.mjs connect again and leave the Google Analytics box ticked.",
    );
  else {
    if (!gaProp)
      await attempt("the Google Analytics property list", ADMIN_API, async () => {
        const props = (
          (await g.call(`${E.analyticsAdmin}/accountSummaries?pageSize=200`)).accountSummaries || []
        ).flatMap(a => (a.propertySummaries || []).map(p => ({ id: p.property.split("/")[1], name: p.displayName })));
        if (!props.length) {
          notes.push(
            "The connected account can't see any Google Analytics 4 property, so there's no visit data. Add it under " +
              ADMIN_API.where +
              ".",
          );
          return;
        }
        // Only the first 50 properties' web streams are checked; accounts with more pass --ga4-property.
        const hostOf = u => {
          try {
            return bare(new URL(/^https?:/.test(u) ? u : "https://" + u).hostname);
          } catch {
            return null;
          }
        };
        const matches = [],
          name = p => `${p.name} (${p.id})`;
        for (const p of props.slice(0, 50))
          if (
            ((await g.call(`${E.analyticsAdmin}/properties/${p.id}/dataStreams`)).dataStreams || []).some(
              d => hostOf(d.webStreamData?.defaultUri || "") === bare(h),
            )
          )
            matches.push(p);
        if (matches.length === 1) gaProp = matches[0].id;
        else if (props.length === 1)
          notes.push(
            `The only Google Analytics 4 property this account can see, ${name(props[0])}, has no web stream for ${h}, so its visits weren't used. If it is this site's property, run fetch again with --ga4-property ${props[0].id}.`,
          );
        else
          notes.push(
            `${matches.length ? "Several" : "None of the"} Google Analytics 4 properties ${matches.length ? "match" : "matches"} ${h}. Pick one with --ga4-property <id>: ${(matches.length ? matches : props).slice(0, 10).map(name).join(", ")}.`,
          );
      });
    if (gaProp)
      await attempt(`Google Analytics property ${gaProp}`, DATA_API, async () => {
        const rep = await g.call(`${E.analyticsData}/properties/${gaProp}:runReport`, {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: "landingPage" }],
          metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
          dimensionFilter: {
            filter: {
              fieldName: "sessionDefaultChannelGroup",
              stringFilter: { matchType: "EXACT", value: "Organic Search" },
            },
          },
          limit: 25000,
        });
        for (const r of rep.rows || []) {
          const p = r.dimensionValues?.[0]?.value;
          if (p && p !== "(not set)")
            analytics[p] = { sessions: Number(r.metricValues[0].value), engaged: Number(r.metricValues[1].value) };
        }
        if (rep.rowCount > 25000)
          notes.push(`Google Analytics has ${rep.rowCount} organic landing pages; only the top 25,000 are included.`);
        gaRead = true;
      });
  }
  // Only after the landing pages were read: a refusal or a used-up quota there would only repeat here.
  // GA4's default channel group files ChatGPT, Gemini, Copilot and the like under "AI Assistant".
  // https://support.google.com/analytics/answer/9756891
  let analyticsDetail = null;
  if (gaRead)
    await attempt(
      `Google Analytics property ${gaProp} (users, days, devices, countries and AI assistants)`,
      DATA_API,
      async () => {
        const rows = async (dimension, value = "Organic Search") =>
          (
            (
              await g.call(`${E.analyticsData}/properties/${gaProp}:runReport`, {
                dateRanges: [{ startDate, endDate }],
                ...(dimension ? { dimensions: [{ name: dimension }] } : {}),
                metrics: [{ name: "sessions" }, { name: "totalUsers" }],
                dimensionFilter: {
                  filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value } },
                },
                limit: 1000,
              })
            ).rows || []
          ).map(r => [
            r.dimensionValues?.[0]?.value,
            Number(r.metricValues?.[0]?.value) || 0,
            Number(r.metricValues?.[1]?.value) || 0,
          ]);
        const byName = (list, n = list.length) =>
          Object.fromEntries(
            list
              .filter(([k, s]) => typeof k === "string" && k && k !== "(not set)" && s > 0)
              .sort((a, b) => b[1] - a[1])
              .slice(0, n)
              .map(([k, sessions, users]) => [k, { sessions, users }]),
          );
        const [[, sessions = 0, users = 0] = []] = await rows();
        const daily = Object.fromEntries(
          (await rows("date"))
            .filter(([d]) => /^\d{8}$/.test(d))
            .sort()
            .map(([d, s, u]) => [`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, { sessions: s, users: u }]),
        );
        const byDevice = byName(await rows("deviceCategory")),
          byCountry = byName(await rows("country"), 10);
        // GA4's default channel group files ChatGPT, Gemini, Copilot and the like under "AI Assistant".
        // https://support.google.com/analytics/answer/9756891
        const ai = Object.entries(byName(await rows("sessionSource", "AI Assistant"), 10)).map(
          ([k, v]) => /** @type {const} */ ([k, { sessions: v.sessions }]),
        );
        analyticsDetail = {
          sessions,
          users,
          daily,
          byDevice,
          byCountry,
          aiAssistant: { sessions: ai.reduce((s, [, v]) => s + v.sessions, 0), bySource: Object.fromEntries(ai) },
        };
      },
    );

  // ---------- findings ----------
  const own = [];
  const finding = (check, rule, severity, category, title, why, fix, evidence) => {
    if (!evidence.length) return;
    own.push({
      check,
      rule,
      severity,
      category,
      title,
      what: `${evidence.length === 1 ? "Found on" : `${evidence.length} cases, for example`} ${evidence[0].url} (${evidence[0].detail}).`,
      why,
      fix,
      count: evidence.length,
      evidence,
      source: "search-console",
      status: "open",
    });
  };
  // Only states where Google left the page out are findings. Others are notes: "URL is unknown to Google" is often a
  // page that isn't live yet, "Page with redirect" a redirect doing its job.
  const EXCLUDED =
    /currently not indexed|noindex|blocked by robots\.txt|duplicate|soft 404|not found|server error|redirect error|blocked due to/i;
  const outOfIndex = inspection.filter(i => i.verdict === "FAIL" || i.verdict === "NEUTRAL"),
    other = outOfIndex.filter(i => !EXCLUDED.test(i.coverageState || ""));
  if (other.length)
    notes.push(
      `URL Inspection: ${other.length} inspected page(s) aren't in Google's index for a reason that usually isn't a problem: ${other
        .slice(0, 10)
        .map(i => `${i.url} (${i.coverageState || "no reason given"})`)
        .join(
          ", ",
        )}. "URL is unknown to Google" means Google hasn't found the page yet: if it's live, link to it and list it in the sitemap. "Page with redirect" means Google indexes the redirect's target instead.`,
    );
  const notIndexed = outOfIndex
    .filter(i => !other.includes(i))
    .map(i => ({
      url: i.url,
      detail: `${i.coverageState}${i.lastCrawlTime ? `, last crawled ${i.lastCrawlTime.slice(0, 10)}` : ""}`,
    }));
  finding(
    "gsc-not-indexed",
    "CRAWL-02",
    "high",
    "Crawling & indexing",
    `${notIndexed.length} key page(s) aren't in Google's index`,
    "Search Console's URL Inspection says Google hasn't indexed these pages, so they can't appear in search at all.",
    "Open each page in Search Console's URL Inspection to see the reason. Fix what it names (a noindex, a robots.txt block, a redirect, thin or duplicate content), link to the page from related pages, then click Request indexing.",
    notIndexed,
  );
  const canon = inspection
    .filter(i => i.googleCanonical && i.userCanonical && i.googleCanonical !== i.userCanonical)
    .map(i => ({ url: i.url, detail: `Google chose ${i.googleCanonical}, the page declares ${i.userCanonical}` }));
  finding(
    "gsc-canonical-differs",
    "URL-04",
    "medium",
    "URLs & canonicals",
    `${canon.length} page(s) where Google picked a different canonical than the page declares`,
    "Google ranks the URL it picked instead, so links and signals collect there and the declared page may not show.",
    "Make the canonical tag, internal links, the sitemap and redirects all point at the same URL. If the two pages are near-duplicates, make them clearly different or merge them.",
    canon,
  );
  const broken = sitemaps
    .filter(x => x.errors > 0)
    .map(x => ({
      url: x.path,
      detail: `${x.errors} errors, ${x.warnings} warnings${x.lastDownloaded ? `, last read ${x.lastDownloaded.slice(0, 10)}` : ""}`,
    }));
  finding(
    "gsc-sitemap-errors",
    "MAP-01",
    "medium",
    "Sitemaps & robots",
    `${broken.length} submitted sitemap(s) have errors in Search Console`,
    "Search Console couldn't read all of these sitemaps, so Google may miss new pages or keep old ones.",
    "Open Search Console → Indexing → Sitemaps and click each sitemap to see the error. Fix the file (valid XML, full URLs on this site, at most 50,000 URLs and 50 MB), then resubmit it.",
    broken,
  );
  // Warnings only make a rich result plainer; Google shows nothing for an item with an error.
  const rich = inspection.flatMap(i =>
    (i.richResults?.types || [])
      .filter(t => t.errors.length)
      .map(t => ({ url: i.url, detail: `${t.type}: ${t.errors.join("; ")}` })),
  );
  finding(
    "gsc-rich-result-errors",
    "SCHEMA-08",
    "medium",
    "Structured data",
    `${rich.length} rich result(s) on key pages have errors in Google's URL Inspection`,
    "Google doesn't show a rich result (stars, prices, breadcrumbs and the like) for an item with an error, so these pages show as plain results.",
    "Open each page in Search Console's URL Inspection, or Google's Rich Results Test, to see where the error is. Fix the markup in the template, then click Request indexing.",
    rich,
  );
  const findings = [...gscFindings(traffic, pageQueries, urls), ...own].map((f, i) => ({
    ...f,
    id: "G-" + String(i + 1).padStart(3, "0"),
  }));

  // Google's documented logging problems in this period or the one it's compared with (Discover's only for Discover).
  const anomalies = [
    ...anomaliesIn(trafficChange ? prevStart : startDate, endDate),
    ...(searchTypes.discover ? anomaliesIn(startDate, endDate, "discover") : []),
  ];
  for (const a of anomalies)
    notes.push(
      `Google's "Data anomalies in Search Console" page says that ${a.from === a.to ? `on ${a.from}` : `from ${a.from} to ${a.to}`} ${a.what}. This overlaps the period read${trafficChange && !a.type ? " or the one it's compared with" : ""}, so a change in those numbers may not be real: ${a.url}`,
    );

  return {
    source: "google",
    site: origin.origin,
    properties: { searchConsole: prop, analytics: gaProp },
    period,
    traffic,
    queries,
    positions: positionShares(queries),
    siteTotals,
    pageQueries,
    trafficChange,
    newQueries,
    searchTypes,
    byDevice,
    byCountry,
    brandSplit,
    inspection,
    sitemaps,
    analytics,
    analyticsDetail,
    anomalies,
    findings,
    notes,
  };
}

// ---------- connect ----------
const SHARED_MISSING = `google: Sign in with Google isn't set up yet in this copy of SEO Supervisor (the project's shared Google sign-in hasn't been added).
You can set it up yourself instead, in about 10 minutes:
  1. Run: node google.mjs guide
  2. Follow its steps to make your own Google sign-in file.
  3. Run: node google.mjs connect --client-file <the file you downloaded>`;

function openBrowser(url) {
  // cmd reads & as a command separator, so it's escaped; the empty "" is start's window title.
  const [cmd, argv] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  try {
    spawn(cmd, argv, { stdio: "ignore", detached: true, windowsHide: true })
      .on("error", () => {})
      .unref();
  } catch {} // the link is printed too
}

// Answers Google's redirect to the loopback address; ignores requests whose state doesn't match.
const waitForCode = (server, state, cmd) =>
  new Promise((ok, no) => {
    const timer = setTimeout(
      () =>
        no(
          new Fail(
            `google: no sign-in within 5 minutes, so nothing was saved. Run node google.mjs ${cmd} again when you're ready.`,
          ),
        ),
      5 * 60000,
    );
    server.on("request", (req, res) => {
      const page = (status, text) =>
        res
          .writeHead(status, { "content-type": "text/html; charset=utf-8", connection: "close" })
          .end(
            `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SEO Supervisor</title><body style="font:18px/1.5 system-ui,sans-serif;max-width:32em;margin:15vh auto;padding:0 16px"><p>${text}</p>`,
          );
      let q;
      try {
        q = new URL(req.url, "http://127.0.0.1").searchParams;
      } catch {
        return page(400, "That address isn't valid.");
      }
      if (!q.has("code") && !q.has("error")) return page(404, "Nothing here.");
      if (q.get("state") !== state)
        return page(
          400,
          `This sign-in doesn't match the one the terminal started. Go back to the terminal and run ${cmd} again.`,
        );
      clearTimeout(timer);
      if (q.has("error")) {
        page(200, "Sign-in was cancelled. You can close this tab.");
        no(
          new Fail(
            `google: sign-in didn't finish (${q.get("error")}), so nothing was saved. Run node google.mjs ${cmd} to try again.`,
          ),
        );
        return;
      }
      page(200, "<b>Signed in.</b> You can close this tab and go back to the terminal.");
      ok(q.get("code"));
    });
  });

// A browser on another computer can't reach this machine's 127.0.0.1, so the address it ended on is pasted here. PKCE
// and the state check apply as with the loopback redirect.
// https://developers.google.com/identity/protocols/oauth2/native-app
async function pastedCode(state, redirect, cmd) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const closed = new Promise(ok => rl.once("close", () => ok(null)));
  let line;
  try {
    line = await Promise.race([
      rl.question("Copy that whole address from the browser's address bar and paste it here: ", {
        signal: AbortSignal.timeout(5 * 60000),
      }),
      closed,
    ]);
  } catch {
    fail(
      `google: no address was pasted within 5 minutes, so nothing was saved. Run node google.mjs ${cmd} --paste again when you're ready.`,
    );
  } finally {
    rl.close();
  }
  let q;
  try {
    const u = new URL(String(line ?? "").trim());
    if (u.origin === new URL(redirect).origin) q = u.searchParams;
  } catch {}
  if (!q || (!q.has("code") && !q.has("error")))
    fail(
      `google: that isn't the address the browser ended on, which starts with ${redirect}/?state=. Nothing was saved. Run node google.mjs ${cmd} --paste again.`,
    );
  if (q.get("state") !== state)
    fail(
      `google: that address is from a different sign-in, so it doesn't match this one. Nothing was saved. Run node google.mjs ${cmd} --paste again.`,
    );
  if (q.has("error"))
    fail(
      `google: sign-in didn't finish (${q.get("error")}), so nothing was saved. Run node google.mjs ${cmd} --paste to try again.`,
    );
  return q.get("code");
}

const revoke = async (E, s) => {
  const r = await fetch(E.revoke, {
    method: "POST",
    headers: FORM,
    body: new URLSearchParams({ token: s.refresh_token || s.access_token }),
    signal: AbortSignal.timeout(30000),
  });
  await r.text();
  return r;
};
// Withdraws the sign-in being replaced, best effort. Not when it used the same client: Google withdraws the whole
// grant for that client and account, which would cancel the sign-in just made.
async function revokeReplaced(E, old, clientId) {
  if (
    !old ||
    old.method === "service-account" ||
    !(old.refresh_token || old.access_token) ||
    old.client?.id === clientId
  )
    return;
  try {
    await revoke(E, old);
  } catch {}
}
// The browser sign-in: loopback redirect, PKCE and a state check, then the code is traded for tokens.
// params: scope plus extra auth parameters; intro is printed before the link (after it with --print-url).
async function signIn(E, client, args, params, { cmd = "connect", intro = "" } = {}) {
  const { verifier, challenge } = pkce(),
    state = randomBytes(16).toString("base64url");
  const server = createServer();
  await /** @type {Promise<void>} */ (new Promise((ok, no) => server.once("error", no).listen(0, "127.0.0.1", ok)));
  const redirect_uri = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  // --paste: nothing listens, so the browser's redirect fails at once and its address can be copied (pastedCode).
  const paste = args.paste === true;
  if (paste) server.close();
  const url = `${E.auth}?${new URLSearchParams({ client_id: client.id, redirect_uri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent", ...params })}`;
  // The link also goes to a file, for a caller running this in the background that can't see its output yet.
  const pending = pendingFile();
  let code;
  try {
    save(pending, url + "\n");
    const text = paste
      ? `${args["print-url"] === true ? url + "\n" : ""}${intro}google: open this link in a browser on any computer and sign in:\n\n  ${url}\n\nThe link is also in ${pending} until signing in is done.\nAfter you allow access, the browser goes to an address that starts with ${redirect_uri} and shows an error page. That's expected.\n`
      : `${args["print-url"] === true ? url + "\n" : ""}${intro}google: opening Google's sign-in page in your browser. If it doesn't open, copy this link into your browser:\n\n  ${url}\n\nThe link is also in ${pending} until signing in is done.\nWaiting for you to finish signing in (up to 5 minutes)...\n`;
    await new Promise(ok => process.stdout.write(text, ok)); // flushed before the wait, also into a pipe
    if (args["no-browser"] !== true && !paste) openBrowser(url);
    code = paste ? await pastedCode(state, redirect_uri, cmd) : await waitForCode(server, state, cmd);
  } finally {
    rmSync(pending, { force: true });
    server.close();
    setTimeout(() => server.closeAllConnections(), 1000).unref();
  }
  return tokenRequest(E, {
    code,
    client_id: client.id,
    client_secret: client.secret,
    redirect_uri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
}

// A key or client file inside the project could end up committed, and connect has already copied what it needs.
function leftInProject(f) {
  const rel = relative(process.cwd(), resolve(f));
  return rel && !isAbsolute(rel) && !/^\.\.([\\/]|$)/.test(rel)
    ? `\nWarning: ${f} is inside this project and is no longer needed (its contents are saved in ${loginDir()}). Delete it, and never commit it.`
    : "";
}

async function connect(args) {
  const E = endpointsFrom(),
    file = tokenFile(),
    now = new Date().toISOString(),
    old = load(file);
  const keyFile = str(args["service-account"]),
    clientFile = str(args["client-file"]);
  const json = keyFile || clientFile ? readJson(keyFile || clientFile) : null;
  if (json?.type === "service_account") {
    if (!json.client_email || !json.private_key)
      fail(
        `google: ${keyFile || clientFile} is missing client_email or private_key. Download a new JSON key for the service account.`,
      );
    const t = await serviceAccountToken(E, json);
    save(file, {
      method: "service-account",
      client_email: json.client_email,
      private_key_id: json.private_key_id,
      private_key: json.private_key,
      token_uri: json.token_uri,
      scope: SCOPES.join(" "),
      ...t,
      connected_at: now,
    });
    await revokeReplaced(E, old);
    console.log(
      `google: connected as the service account ${json.client_email}.\nIt sees the Search Console and GA4 properties where this email was added as a user.\nSaved to ${file} (only your user account can read it).${leftInProject(keyFile || clientFile)}`,
    );
    return 0;
  }
  if (keyFile)
    fail(
      `google: ${keyFile} isn't a service-account key. In Google Cloud open IAM & Admin → Service accounts → your account → Keys → Add key → JSON.`,
    );
  let client, method;
  if (clientFile) {
    const c = json.installed;
    if (!c?.client_id)
      fail(
        json.web
          ? `google: ${clientFile} is a "Web application" client. Signing in from the terminal needs a "Desktop app" client: create one (node google.mjs guide) and download its JSON.`
          : `google: ${clientFile} isn't a Google sign-in (OAuth client) file. Download it from your Desktop app client's page in Google Cloud.`,
      );
    // Google's sign-in for Desktop app clients needs the secret, so stop before the browser opens.
    if (!c.client_secret)
      fail(
        `google: ${clientFile} has no client secret, so Google would refuse the sign-in. Download it again from Google Cloud (Clients → your Desktop app client). If that download has no secret either, click Add secret on the same page and download the JSON straight away.`,
      );
    client = { id: c.client_id, secret: c.client_secret, file: resolve(clientFile) };
    method = "own-client";
  } else {
    // The env vars override the shared client; empty means none.
    const env = process.env;
    client = {
      id: env.SEO_GOOGLE_SHARED_CLIENT_ID ?? SHARED_CLIENT.id,
      secret: env.SEO_GOOGLE_SHARED_CLIENT_SECRET ?? SHARED_CLIENT.secret,
    };
    if (!client.id || !client.secret) fail(SHARED_MISSING);
    method = "shared";
  }

  const t = await signIn(E, client, args, { scope: SCOPES.join(" ") });
  const scope = t.scope || SCOPES.join(" ");
  save(file, { method, client, ...t, scope, connected_at: now });
  await revokeReplaced(E, old, client.id);
  console.log(
    `google: connected. Search Console: ${scope.includes(SC) ? "yes" : "no (not allowed)"} · Google Analytics: ${scope.includes(GA) ? "yes" : "no (not allowed)"}.\nSaved to ${file} (only your user account can read it).${t.refresh_token ? "" : "\nGoogle didn't send a long-lived sign-in, so you'll need to connect again in about an hour."}${clientFile ? leftInProject(clientFile) : ""}\nNext: node google.mjs fetch --site https://your-site`,
  );
  return 0;
}

async function status() {
  const file = tokenFile(),
    s = load(file);
  if (!s) {
    console.log(
      "google: Not connected. Run node google.mjs connect to sign in with Google, or node google.mjs guide to set it up yourself.",
    );
    return 1;
  }
  const scope = s.scope || "";
  const how =
    s.method === "service-account"
      ? `a service account (${s.client_email})`
      : s.method === "own-client"
        ? `your own Google Cloud client (${s.client.id}${s.client.file ? `, from ${s.client.file}` : ""})`
        : `Sign in with Google (SEO Supervisor's shared sign-in, ${s.client.id})`;
  const lines = [
    `Connected with: ${how}`,
    `Connected on: ${(s.connected_at || "unknown").slice(0, 10)}`,
    `Access: ${[scope.includes(SC) && "Search Console (read-only)", scope.includes(GA) && "Google Analytics (read-only)"].filter(Boolean).join(", ") || "none"}`,
    `Sitemap submitting: ${has(scope, WM) ? "allowed" : "not allowed (submit-sitemap --yes asks for it when you submit one)"}`,
    `Access token: ${s.expires_at > Date.now() ? `valid until ${new Date(s.expires_at).toISOString().slice(0, 16).replace("T", " ")} UTC` : "expired"}${s.refresh_token || s.private_key ? " (renews automatically)" : " (run connect again)"}`,
    `Saved in: ${file}`,
  ];
  try {
    const g = session();
    lines.push(
      `Search Console properties: ${((await g.call(`${g.E.searchConsole}/sites`)).siteEntry || []).map(x => x.siteUrl).join(", ") || "none"}`,
    );
    if (scope.includes(GA)) {
      try {
        lines.push(
          `Google Analytics 4 properties: ${((await g.call(`${g.E.analyticsAdmin}/accountSummaries?pageSize=200`)).accountSummaries || []).flatMap(a => (a.propertySummaries || []).map(p => `${p.displayName} (${p.property.split("/")[1]})`)).join(", ") || "none"}`,
        );
      } catch (e) {
        lines.push(
          `Google Analytics 4 properties: couldn't list them. ${explain(e, "the Google Analytics property list", ADMIN_API)}`,
        );
      }
    }
  } catch (e) {
    lines.push(
      `Search Console properties: couldn't list them. ${explain(e, "the Search Console property list", SC_API)}`,
    );
  }
  console.log(lines.join("\n"));
  return 0;
}

async function disconnect() {
  const file = tokenFile(),
    s = load(file);
  if (!s && existsSync(file)) {
    rmSync(file, { force: true });
    console.log(
      `google: the saved sign-in (${file}) couldn't be read, so it was deleted. To withdraw access at Google too, open https://myaccount.google.com/connections.`,
    );
    return 0;
  }
  if (!s) {
    console.log("google: not connected, nothing to remove.");
    return 0;
  }
  let revoked = "";
  if (s.method !== "service-account") {
    try {
      const r = await revoke(endpointsFrom(), s);
      revoked = r.ok
        ? "Google has withdrawn SEO Supervisor's access."
        : `Google didn't confirm withdrawing access (${r.status}); it may have been withdrawn already.`;
    } catch (e) {
      revoked = `Couldn't reach Google to withdraw access (${e.cause?.code || e.message}).`;
    }
  }
  rmSync(file, { force: true });
  console.log(
    [
      `google: disconnected. Removed the saved sign-in (${file}).`,
      revoked,
      s.method === "service-account"
        ? `The service account ${s.client_email} keeps the access you gave it: remove it under ${SC_API.where} and ${ADMIN_API.where}, or delete its key in Google Cloud.`
        : "You can check or remove access any time at https://myaccount.google.com/connections.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return 0;
}

// ---------- submit-sitemap ----------
// The only write, and only with --yes. The read/write scope is asked for here by incremental sign-in, never at connect.
function submitError(e, prop, who = "The connected Google account") {
  if (e.status === 403 && !API_OFF.test(e.message))
    return `${who} isn't an owner or full user of ${prop}, so Google refused the sitemap. Submitting a sitemap needs Owner or Full permission (Restricted users can only read): ask the owner to change it under ${SC_API.where}, or connect with an owner's account.`;
  if (e.status === 404)
    return `Google couldn't find ${prop} for the connected account (404), so nothing was submitted. Check that --site is a property in Search Console, or connect with the Google account that has it.`;
  return explain(e, `${prop} in Search Console`, SC_API, who);
}

async function submitSitemap(args) {
  if (!str(args.site) || !str(args.sitemap)) throw new Fail(USAGE);
  const origin = httpUrl(args.site, "--site must be the site's address", "https://www.example.com");
  const map = httpUrl(
    args.sitemap,
    "--sitemap must be the sitemap's full address",
    "https://www.example.com/sitemap.xml",
  );
  let g = session();
  const s = g.store(),
    who = whoOf(s),
    prop = await pickProperty(g, origin, who);
  const d = prop.startsWith("sc-domain:") && prop.slice(10);
  if (!inProperty(prop, map))
    fail(
      `google: ${map.href} isn't on ${prop}, so Search Console would refuse it. Submit a sitemap ${d ? `on ${d} or one of its subdomains` : `whose address starts with ${prop}`}, or pass the --site it belongs to.`,
    );
  const allowed = has(s.scope, WM);
  if (args.yes !== true) {
    console.log(
      [
        `google: dry run, nothing was sent.`,
        `Would submit: ${map.href}`,
        `To the Search Console property: ${prop}`,
        !allowed &&
          s.method !== "service-account" &&
          "First, Google shows a second short screen asking to allow submitting sitemaps (one extra permission).",
        "To submit it, run the same command with --yes.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return 0;
  }
  if (!allowed) {
    const scope = `${s.scope || SCOPES.join(" ")} ${WM}`;
    let t;
    if (s.method === "service-account") t = { ...(await serviceAccountToken(g.E, { ...s, scope })), scope };
    else {
      t = await signIn(
        g.E,
        s.client,
        args,
        { scope: WM, include_granted_scopes: "true" },
        {
          cmd: "submit-sitemap",
          intro:
            "google: submitting a sitemap needs one more permission. Google will ask you to allow SEO Supervisor to submit sitemaps; everything else stays read-only.\n",
        },
      );
      t.scope ||= scope;
    }
    save(tokenFile(), { ...s, ...t });
    if (!has(t.scope, WM))
      fail(
        "google: submitting sitemaps wasn't allowed on Google's screen, so nothing was sent. Run the command again and allow it.",
      );
    g = session();
  }
  const feed = `${g.E.searchConsole}/sites/${encodeURIComponent(prop)}/sitemaps/${encodeURIComponent(map.href)}`;
  try {
    await g.call(feed, null, "PUT");
  } catch (e) {
    fail("google: " + submitError(e, prop, who));
  }
  const lines = [`google: submitted ${map.href} to ${prop}.`];
  try {
    const x = await g.call(feed),
      when = t => t && `${t.slice(0, 16).replace("T", " ")} UTC`;
    const n = (k, word) => `${Number(x[k] || 0)} ${word}${Number(x[k] || 0) === 1 ? "" : "s"}`;
    lines.push(
      `Last submitted: ${when(x.lastSubmitted) || "not shown yet"}`,
      `Status: ${x.isPending ? "waiting for Google to read it" : x.lastDownloaded ? `last read by Google ${when(x.lastDownloaded)}` : "not read by Google yet"}.`,
      Number(x.errors || 0) || Number(x.warnings || 0)
        ? `${n("errors", "error")}, ${n("warnings", "warning")}: open Search Console → Indexing → Sitemaps to see them.`
        : "No errors or warnings so far.",
    );
  } catch (e) {
    lines.push(
      `Google didn't show the sitemap's status yet (${explain(e, "the sitemap", SC_API, who)}). Check Search Console → Indexing → Sitemaps in a few minutes.`,
    );
  }
  console.log(lines.join("\n"));
  return 0;
}

const GUIDE = `Set up Google access yourself (about 10 minutes). Pick one.

A. Your own sign-in (best for most people)
  1. Open https://console.cloud.google.com/auth/overview/personal and sign in with the Google account that sees your site in Search Console.
  2. Follow the steps to create a project and a client. When asked for the application type, choose "Desktop app".
  3. Turn on three APIs. Open https://console.cloud.google.com/apis/library, search for each one and click Enable:
     "Google Search Console API", "Google Analytics Data API" and "Google Analytics Admin API".
  4. On the client's page, click "Download JSON". Keep the file private.
  5. Run: node google.mjs connect --client-file <the downloaded file>
     Your browser opens. Sign in and allow read-only access. Then delete the downloaded file: connect keeps what it needs.
  If you made the client through the regular Google Cloud setup instead of the personal page in step 1, also open
  Google Auth Platform → Audience → Publish app, so sign-ins don't expire after 7 days.

B. A service account (for servers and CI; no browser)
  1. In Google Cloud, open IAM & Admin → Service accounts and create one. Then open it → Keys → Add key → JSON. Keep the file private.
  2. Turn on the same three APIs as in A, step 3.
  3. In Search Console, open Settings → Users and permissions → Add user, and add the service account's email (it ends in .iam.gserviceaccount.com) with Restricted permission
     (Full, if you want it to submit sitemaps with submit-sitemap).
  4. In Google Analytics, open Admin → Property access management → Add users, and add the same email as a Viewer.
  5. Run: node google.mjs connect --service-account <the key file>

Either way, access is read-only. Submitting a sitemap (submit-sitemap --yes) asks for that one extra permission
when you use it. Undo it all any time with: node google.mjs disconnect`;

async function fetchCli(args) {
  if (!str(args.site)) throw new Fail(USAGE);
  const crawlPath = str(args.crawl) || "seo-audit/seo-crawl.json";
  let crawl = null;
  if (existsSync(crawlPath))
    try {
      crawl = JSON.parse(readFileSync(crawlPath, "utf8"));
    } catch {}
  // --inspect: a file with one URL or path per line (# starts a comment); --inspect-urls: a comma-separated list.
  const inspect = [];
  if (str(args.inspect))
    try {
      inspect.push(...readFileSync(args.inspect, "utf8").split(/\r?\n/));
    } catch (e) {
      fail(`google: can't read ${args.inspect} (${e.code || e.message}).`);
    }
  if (str(args["inspect-urls"])) inspect.push(...args["inspect-urls"].split(","));
  const out = resolve(str(args.out) || "seo-audit/google.json");
  const r = await fetchGoogle({
    site: args.site,
    days: str(args.days) || 90,
    ga4Property: str(args["ga4-property"]),
    crawl,
    inspect: inspect.map(s => s.trim()).filter(s => s && !s.startsWith("#")),
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(r, null, 2));
  console.log(
    `google: ${r.properties.searchConsole}${r.properties.analytics ? ` and GA4 property ${r.properties.analytics}` : ""} · ${Object.keys(r.traffic).length} pages, ${r.queries.length} queries, ${r.inspection.length} URLs inspected, ${r.sitemaps.length} sitemaps, ${Object.keys(r.analytics).length} GA4 landing pages, ${r.findings.length} findings · wrote ${out}`,
  );
  for (const n of r.notes) console.log("note: " + n);
  return 0;
}

const str = v => (typeof v === "string" ? v : null);
const USAGE = `usage: node google.mjs connect [--client-file client_secret.json | --service-account key.json] [--no-browser] [--print-url] [--paste]
       node google.mjs guide | status | disconnect
       node google.mjs fetch --site https://www.example.com [--days 90] [--ga4-property <id>] [--crawl seo-audit/seo-crawl.json] [--inspect pages.txt] [--inspect-urls /a/,/b/] [--out seo-audit/google.json]
       node google.mjs submit-sitemap --site https://www.example.com --sitemap https://www.example.com/sitemap.xml [--yes] [--no-browser] [--print-url]`;
// Exit codes as in connect-keys.mjs: 1 when Google refuses or can't be reached, or status finds nothing connected;
// 2 on bad input or no usable sign-in.
if (isMain(import.meta.url)) {
  const note = proxyNote();
  if (note) console.error("note: " + note); // stderr: connect --print-url keeps the link as stdout's first line
  const cmd = process.argv[2],
    args = {};
  for (let i = 3; i < process.argv.length; i++) {
    const k = process.argv[i].replace(/^--/, "");
    args[k] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  }
  const run = {
    connect,
    status,
    disconnect,
    fetch: fetchCli,
    "submit-sitemap": submitSitemap,
    guide: async () => {
      console.log(GUIDE);
      return 0;
    },
  }[cmd];
  // Exit by setting the code, not process.exit(): exiting while fetch's sockets close crashes Node on Windows.
  process.exitCode = await (run ? run(args) : Promise.reject(new Fail(USAGE))).then(null, e => {
    if (!(e instanceof Fail) && e.code !== "SEO_SETTINGS") throw e;
    console.error(e.message);
    return 2;
  });
}
