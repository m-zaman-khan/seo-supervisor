// @ts-check
// Bing Webmaster Tools: the key's entry, the read (clicks, impressions, links, crawl issues) and URL submission. The
// crawl-issues finding is connect-keys.mjs's crawlFinding.
import { Refused, setLine, PASTE, request, POST, chunks, bare, hostOf, day } from "./http.mjs";

export const bing = {
  name: "Bing Webmaster Tools",
  env: "BING_WEBMASTER_KEY",
  endpointEnv: "BING_WEBMASTER_ENDPOINT",
  endpoint: "https://ssl.bing.com/webmaster/api.svc/json",
  adds: "Bing clicks and impressions by page and query, the pages other sites link to, and problems Bing hit crawling the site",
  where: "bing.com/webmasters → Settings → API Access",
  guide: [
    "Bing Webmaster Tools (free) adds Bing clicks and impressions by page and query, the pages other sites link to, and the problems Bing hit while crawling your site.",
    "1. Sign in at https://www.bing.com/webmasters with a Microsoft, Google or Facebook account.",
    '2. Add your site and verify it. If the site is already in Google Search Console, choose "Import from Google Search Console": it\'s the quickest way.',
    "3. Open Settings → API Access (Settings is at the top right). Read and accept the terms, then click Generate API Key.",
    `4. Copy the key, then in your own terminal run: ${setLine("bing")}`,
    PASTE,
    "One key covers every site verified in your account. Keep it private: anyone who has it can read and change your Bing Webmaster Tools settings.",
  ],
};
const MAX_LINK_PAGES = 10;

// ---------- Bing Webmaster Tools ----------
// CrawlIssues is a flags enum; JSON sends the number, XML the names, so both are read.
/** @type {[string, number, string][]} */
const ISSUES = [
  ["Code301", 1, "permanent redirect (301)"],
  ["Code302", 2, "temporary redirect (302)"],
  ["Code4xx", 4, "client error (4xx)"],
  ["Code5xx", 8, "server error (5xx)"],
  ["BlockedByRobotsTxt", 16, "blocked by robots.txt"],
  ["ContainsMalware", 32, "contains malware"],
  ["ImportantUrlBlockedByRobotsTxt", 64, "important page blocked by robots.txt"],
  ["DnsErrors", 128, "DNS error"],
  ["TimeOutErrors", 256, "timed out"],
];
const issueBits = v =>
  typeof v === "number"
    ? v
    : String(v ?? "")
        .split(/[\s,]+/)
        .reduce((n, s) => n | (ISSUES.find(i => i[0] === s)?.[1] || 0), 0);

// Bing takes the key only as ?apikey= (or OAuth). It's never printed, and request()'s errors name the host, not the
// URL.
const bingGet =
  (key, base) =>
  (method, params = {}) =>
    request("bing", bing, `${base}/${method}?${new URLSearchParams({ ...params, apikey: key })}`).then(b => b?.d);
// Bing's own URL for the site (its www and https), which every other Bing call takes as siteUrl.
async function bingSite(get, site) {
  const want = new URL(site).hostname,
    hostOf = u => {
      try {
        return new URL(u).hostname;
      } catch {
        return "";
      }
    };
  const sites = (await get("GetUserSites")) || [];
  const match = sites.find(s => hostOf(s.Url) === want) || sites.find(s => bare(hostOf(s.Url)) === bare(want));
  if (!match)
    throw new Refused(
      `Bing Webmaster Tools: ${want} isn't in your Bing Webmaster Tools account. Add and verify it at bing.com/webmasters (it can import your sites from Google Search Console), then run again.`,
    );
  if (match.IsVerified === false)
    throw new Refused(
      `Bing Webmaster Tools: ${want} is in your account but isn't verified yet. Finish verifying it at bing.com/webmasters, then run again.`,
    );
  return match.Url;
}

const linksOf = d => (d?.Details || []).map(l => ({ url: l.Url, anchorText: l.AnchorText }));
const MAX_CHOSEN = 20;
// pages: extra pages to read links for; sister: another site in the same Bing account to compare with.
export async function fetchBing(key, site, base, notes, { pages: chosen = [], sister = null } = {}) {
  const get = bingGet(key, base),
    want = new URL(site).hostname,
    siteUrl = await bingSite(get, site);

  const add = (map, k, r) => {
    if (k == null) return;
    const t = map.get(k) || { clicks: 0, impressions: 0 };
    t.clicks += r.Clicks || 0;
    t.impressions += r.Impressions || 0;
    map.set(k, t);
  };
  const queryRows = (await get("GetQueryStats", { siteUrl })) || [],
    q = new Map();
  for (const r of queryRows) add(q, r.Query, r);
  const queries = [...q].map(([query, t]) => ({ query, ...t })).sort((a, b) => b.impressions - a.impressions);
  // GetPageStats has the page's URL in Query. http/https and www/apex variants of one page add up, as in gsc-import.
  const pathOf = u => {
    try {
      const x = new URL(u);
      return bare(x.hostname) === bare(want) ? x.pathname + x.search : null;
    } catch {
      return null;
    }
  };
  const pageRows = (await get("GetPageStats", { siteUrl })) || [],
    p = new Map();
  for (const r of pageRows) add(p, pathOf(r.Query), r);
  const dates = [...queryRows, ...pageRows]
    .map(r => Number(/\/Date\((-?\d+)/.exec(r.Date || "")?.[1]))
    .filter(Number.isFinite);

  const pages = [];
  let total = 1;
  for (let page = 0; page < Math.min(total, MAX_LINK_PAGES); page++) {
    const d = await get("GetLinkCounts", { siteUrl, page });
    pages.push(...(d?.Links || []).map(l => ({ url: l.Url, count: l.Count })));
    total = d?.TotalPages || 0;
  }
  if (total > MAX_LINK_PAGES)
    notes.push(`Bing lists inbound links in ${total} pages of results; only the first ${MAX_LINK_PAGES} were read.`);
  const sample = linksOf(await get("GetUrlLinks", { siteUrl, link: new URL("/", siteUrl).href, page: 0 }));

  // GetUrlLinks takes any page of the site; only the first page of results is read for each chosen one.
  // https://learn.microsoft.com/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.geturllinks
  let byPage = null;
  if (chosen.length) {
    byPage = {};
    const own = new Set(),
      off = [];
    for (const p of chosen) {
      let u;
      try {
        u = new URL(p, siteUrl);
      } catch {}
      if (u && bare(u.hostname) === bare(want)) own.add(u.pathname + u.search);
      else off.push(p);
    }
    if (off.length)
      notes.push(
        `Bing links: left out ${off.length} chosen page(s) that aren't on ${want}: ${off.slice(0, 5).join(", ")}.`,
      );
    if (own.size > MAX_CHOSEN) notes.push(`Bing links: read the first ${MAX_CHOSEN} of ${own.size} chosen pages.`);
    for (const path of [...own].slice(0, MAX_CHOSEN)) {
      try {
        byPage[path] = linksOf(await get("GetUrlLinks", { siteUrl, link: new URL(path, siteUrl).href, page: 0 }));
      } catch (e) {
        if (!(e instanceof Refused)) throw e;
        notes.push(`Bing didn't give the links to ${path}: ${e.message}`);
      }
    }
  }

  // The sites that link to a sister site but not to this one: the linking pages of each site's 5 most-linked pages
  // (the first page of results each), so it's a sample, not every link.
  let sisterOut = null;
  if (sister) {
    try {
      const sisterUrl = await bingSite(get, sister),
        skip = new Set([bare(want), hostOf(sisterUrl)]);
      const hostsOf = async (url, list) => {
        const hosts = new Set();
        for (const p of list.slice(0, 5))
          for (const l of linksOf(await get("GetUrlLinks", { siteUrl: url, link: p.url, page: 0 }))) {
            const h = hostOf(l.url);
            if (h && !skip.has(h)) hosts.add(h);
          }
        return hosts;
      };
      const theirPages = ((await get("GetLinkCounts", { siteUrl: sisterUrl, page: 0 }))?.Links || [])
        .map(l => ({ url: l.Url, count: l.Count }))
        .sort((a, b) => b.count - a.count);
      const ours = await hostsOf(
          siteUrl,
          [...pages].sort((a, b) => b.count - a.count),
        ),
        theirs = [...(await hostsOf(sisterUrl, theirPages))];
      sisterOut = {
        site: sisterUrl,
        onlySister: theirs.filter(h => !ours.has(h)).slice(0, 50),
        shared: theirs.filter(h => ours.has(h)).length,
      };
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      notes.push(`Bing: the sister site wasn't compared. ${e.message}`);
    }
  }

  let crawlIssues = null;
  try {
    crawlIssues = ((await get("GetCrawlIssues", { siteUrl })) || []).map(r => {
      const bits = issueBits(r.Issues);
      return {
        url: r.Url,
        httpCode: r.HttpCode ?? null,
        issues: ISSUES.filter(i => bits & i[1]).map(i => i[2]),
        inLinks: r.InLinks ?? null,
      };
    });
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    notes.push(`Bing didn't give crawl issues, so they weren't checked: ${e.message}`);
  }

  return {
    siteUrl,
    period: dates.length ? { from: day(Math.min(...dates)), to: day(Math.max(...dates)) } : null,
    traffic: Object.fromEntries(p),
    queries,
    backlinks: { pages: pages.sort((a, b) => b.count - a.count), sample, ...(byPage && { byPage }) },
    crawlIssues,
    ...(sister && { sister: sisterOut }),
  };
}

// ---------- Bing URL submission: a write to Bing, so the CLI runs it only with --yes ----------
// SubmitUrlBatch takes at most 500 URLs a batch, within what GetUrlSubmissionQuota reports. The quota differs per site,
// so it's read each time, never assumed. Returns { siteUrl, quota, sent, notSent, error }.
// https://learn.microsoft.com/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.submiturlbatch
export const BATCH = 500;
export async function submitBing({ key, site, urls, endpoint }) {
  const get = bingGet(key, endpoint),
    siteUrl = await bingSite(get, site);
  const q = await get("GetUrlSubmissionQuota", { siteUrl }),
    left = v => (v == null || !(Number(v) >= 0) ? null : Math.floor(Number(v)));
  const quota = { daily: left(q?.DailyQuota), monthly: left(q?.MonthlyQuota) };
  if (quota.daily == null)
    throw new Refused(
      "Bing Webmaster Tools didn't say how many URLs it takes today (GetUrlSubmissionQuota), so nothing was sent. Try again later.",
    );
  const fits = urls.slice(0, Math.min(quota.daily, quota.monthly ?? quota.daily));
  let sent = 0,
    error = null;
  for (const urlList of chunks(fits, BATCH)) {
    try {
      await request("bing", bing, `${endpoint}/SubmitUrlBatch?${new URLSearchParams({ apikey: key })}`, {
        ...POST,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ siteUrl, urlList }),
      });
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      error = e.message;
      break;
    }
    sent += urlList.length;
  }
  return { siteUrl, quota, sent, notSent: urls.slice(sent), error };
}
