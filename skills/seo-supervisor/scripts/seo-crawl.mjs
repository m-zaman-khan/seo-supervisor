#!/usr/bin/env node
// @ts-check
// Read-only SEO crawler: GET and HEAD only, plus a TLS handshake with --check-live.
// Regex HTML parsing is enough for audit evidence. Swap in a real parser if a site breaks it.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileCrawl } from "./seo-diff.mjs";
import { chromeProxyArgs } from "./lib/proxy.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain, warnProxy } from "./lib/cli.mjs";
import { loopback } from "./lib/net.mjs";
import { redact, hideSecrets } from "./lib/redact.mjs";
import { createFindings, quote } from "./lib/findings.mjs";
import { RULES, CHECKS } from "./crawl/catalog.mjs";
import { PAGE_MAX, clean, createFetcher, isLocal, isPublic, mapOrigin, urlOr } from "./crawl/fetch.mjs";
import { createCrawler } from "./crawl/queue.mjs";
import { checkRobots, versionedNote, aiBotAccess, aiRobotRules } from "./checks/robots.mjs";
import { SITEMAP_KEEP, findSitemaps, checkSitemapFiles, checkSitemapEntries } from "./checks/sitemap.mjs";
import { probeSite } from "./checks/probes.mjs";
import { checkPages } from "./checks/site-pages.mjs";
import { checkAssets, imageList, schemaImages, mediaData } from "./checks/assets.mjs";
import {
  checkLinks,
  slashStyle,
  oldUrls,
  outboundLinks,
  linkedOnce,
  linkStrength,
  pageWords,
  otherSites,
} from "./checks/links.mjs";
import { compareGooglebot, aiBotProbe, readPage } from "./checks/bots.mjs";
import { cookiesAndPolicies, securityHeaders } from "./checks/site-security.mjs";
import { agentData, bingAiPrefs, landmarks } from "./checks/site-agents.mjs";
import {
  pageMarkup,
  descStartsWithTitle,
  pageSignals,
  shopChecks,
  contentChecks,
  localData,
} from "./checks/site-content.mjs";
import { hygieneChecks, markdownCheck } from "./checks/site-hygiene.mjs";
import { checkCoverage } from "./checks/coverage.mjs";
import { checkLanguages, otherSiteTargets, linksBack } from "./checks/hreflang.mjs";
import { checkLive } from "./checks/tls.mjs";
import {
  checkSpeed,
  sampleUrls,
  PSI_ENDPOINT,
  speedTrend,
  CRUX_HISTORY_ENDPOINT,
  labLcpBreakdown,
} from "./checks/speed.mjs";
import { findBrowser, openSession, renderPage, renderFindings, renderAll } from "./checks/render.mjs";
import { checkPages as browserChecks } from "./checks/visual.mjs";
import { checkLighthouse, findLighthouse, ALL_CAP } from "./checks/lighthouse.mjs";
import { trustSignals } from "./checks/trust.mjs";
import { checkBusinessType, detectBusinessType } from "./checks/business-type.mjs";
import { slowNote } from "./checks/crawl.mjs";
import { maskKeys } from "./checks/hygiene.mjs";
warnProxy(); // once, before any request

const VERSION = "2.0.0";
const UA = "seo-supervisor-crawler/" + VERSION;

// ---------- args ----------
// An unknown option or unusable value stops the crawl (exit 2) before anything is asked of the site.
// Each option in FLAGS and BOOLEANS needs its own line here, at most 100 characters wide (test/help.test.mjs).
const USAGE = `Usage: node seo-crawl.mjs --url http://localhost:3000 [options]

Crawls a site and writes what it finds to one JSON file. Read-only: it sends only GET and HEAD
requests. Point it at a local or staging server when you can; against production keep
--concurrency low.

Basics
  --url <address>            where the crawl starts (required), like http://localhost:3000
  --site-origin <address>    the public address canonicals and sitemaps should use,
                             like https://www.example.com
  --trailing-slash <style>   auto (the default: detect the site's style, flag a mix), always
                             or never
  --brand <name>             flag titles that repeat the brand name
  --ignore-noindex           before launch: check noindex pages as if they could be indexed
  --banned <pattern>         flag visible text that matches (banned claims, wrong names)
  --verify <pattern>         flag claims the owner hasn't confirmed yet, as decisions

Scope
  --max <n>                  crawl at most n pages (default 1000)
  --concurrency <n>          requests at once (default 8 on this computer, 4 on any other server)
  --include <paths>          crawl only these sections: comma-separated path starts, like /blog/
                             (the start page is still crawled, as the way in)
  --exclude <paths>          skip these sections, like /blog/tag/
  --include-query            crawl addresses with a ?query as pages of their own

Outside checks (each contacts more than the server being crawled, so each needs the owner's yes)
  --check-live               live site only: the certificate, the http-to-https and www/bare-domain
                             redirects, and HSTS (the "always use https" header) on --site-origin
  --outside                  real-user speed from Google PageSpeed Insights for up to 10 public
                             pages (set PSI_API_KEY); a Chrome or Edge render of up to 10 pages on
                             desktop and phone, with screenshots (CHROME_PATH picks the browser);
                             Chrome's back/forward cache test and lab speed; with CRUX_API_KEY,
                             the site's 25-week speed trend
  --render all               with --outside: render every indexable page (up to 200, about 5 s
                             a page) instead of 10; it prints the time it expects first
  --lighthouse [all|<n>]     with --outside: Lighthouse on 5 sample pages, on every indexable
                             page (all: up to 200, about 20 s a page) or on n of them. Install it
                             first: npx seo-supervisor --with-lighthouse, or set LIGHTHOUSE_PATH
  --desktop                  with --outside: send the same pages to PageSpeed again for desktop
                             (information only)
  --render-page <address>    with --outside: render one page you pick
  --render-steps "<steps>"   what to do on that page first, like "scroll; click .more; wait 1000"
                             (it never types)
  --clean-screenshots        with --outside: also save screenshots with cookie bars and chat
                             boxes hidden
  --ai-bot-probe             with --outside: ask up to 3 pages again as AI search crawlers, to see
                             whether a firewall turns them away
  --hreflang-other-sites     with --outside: visit up to 20 language versions on other sites, to
                             see whether they link back
  --outbound-links           visit up to 100 links to other sites, to find broken ones (never
                             private or local addresses)
  --psi-endpoint <address>   send the PageSpeed requests here instead of to Google (for tests)
  --crux-endpoint <address>  send the speed-trend requests here instead of to Google (for tests)

Data inputs
  --urls <file>              old addresses or redirect sources to test: one per line, a CSV's first
                             column, or a JSON array
  --next-manifest <file>     test every fixed-path redirect in a Next.js build's
                             .next/routes-manifest.json
  --gsc-indexing <file>      Search Console's Page indexing export (its Chart.csv): Google's
                             indexed count beside the crawl's, information only

Output
  --out <file>               where the crawl is written (default seo-audit/seo-crawl.json);
                             screenshots go in screenshots/ next to it
  --help, -h                 show this help`;
const FLAGS = [
  "url",
  "site-origin",
  "trailing-slash",
  "brand",
  "banned",
  "verify",
  "urls",
  "next-manifest",
  "psi-endpoint",
  "crux-endpoint",
  "render",
  "lighthouse",
  "render-page",
  "render-steps",
  "include",
  "exclude",
  "gsc-indexing",
  "max",
  "concurrency",
  "out",
];
const BOOLEANS = [
  "ignore-noindex",
  "check-live",
  "outside",
  "outbound-links",
  "desktop",
  "hreflang-other-sites",
  "ai-bot-probe",
  "clean-screenshots",
  "include-query",
];
/** @type {{ args: ReturnType<typeof parseArgs>, browser: string | null } | undefined} */
let options;
await runMain(() => {
  const a = parseArgs(process.argv.slice(2), { flags: FLAGS, booleans: BOOLEANS, positionals: 0, usage: USAGE });
  if (typeof a.url !== "string")
    throw new Fail(
      `${USAGE.slice(0, USAGE.indexOf("\n"))}\n--url is required. Every option: node seo-crawl.mjs --help`,
    );
  const no = (k, why) => {
    throw new Fail(`seo-crawl: --${k} ${why}`);
  };
  for (const k of ["url", "site-origin"])
    if (k in a && !(URL.canParse(a[k]) && /^https?:$/.test(new URL(a[k]).protocol)))
      no(k, `needs a full web address, like http://localhost:3000 (got “${a[k]}”).`);
  for (const k of ["max", "concurrency"])
    if (k in a && !/^[1-9]\d*$/.test(a[k]))
      no(k, `needs a whole number of 1 or more, like --${k} ${k === "max" ? 1000 : 4}.`);
  for (const k of ["banned", "verify"])
    if (typeof a[k] === "string")
      try {
        new RegExp(a[k], "i");
      } catch (e) {
        no(k, `isn't a valid pattern (${e.message}).`);
      }
  // With --outside, find the browser first: a CHROME_PATH that points at nothing stops the crawl before it starts.
  let browser = null;
  if (a.outside)
    try {
      browser = findBrowser();
    } catch (e) {
      throw new Fail(`seo-crawl: ${e.message}`);
    }
  options = { args: a, browser };
});
if (!options) process.exit(); // runMain said why and set the exit code; nothing has been asked of the site yet
const { args, browser } = options;
const START = new URL(args.url);
const START_ORIGIN = START.origin;
const MAX = Number(args.max || 1000);
const IGNORE_NOINDEX = !!args["ignore-noindex"];
const BANNED = typeof args.banned === "string" ? new RegExp(args.banned, "i") : null;
const VERIFY = typeof args.verify === "string" ? new RegExp(args.verify, "i") : null;
const URL_LIST = typeof args.urls === "string" ? args.urls : null;
const NEXT_MANIFEST = typeof args["next-manifest"] === "string" ? args["next-manifest"] : null;
// Locally the server's own speed is the limit, so 8 at once; 4 against any other server.
const CONC = Number(args.concurrency || (loopback(START.hostname) ? 8 : 4));
const SLASH = ["always", "never"].includes(args["trailing-slash"]) ? args["trailing-slash"] : "auto";
const BRAND = typeof args.brand === "string" ? args.brand : "";
const INCLUDE_QUERY = !!args["include-query"];
const CHECK_LIVE = !!args["check-live"];
const OUTSIDE = !!args.outside; // nothing leaves the machine without it
const LIGHTHOUSE_ALL = args.lighthouse === "all"; // --lighthouse all, or --lighthouse=all
const LIGHTHOUSE = !!args.lighthouse;
const RENDER_ALL = args.render === "all"; // with --outside: every indexable page, not the sample
const DESKTOP = !!args.desktop; // a separate opt-in: it sends the sample URLs to Google a second time
const OUT = resolve(typeof args.out === "string" ? args.out : "seo-audit/seo-crawl.json");
let SITE_ORIGIN = typeof args["site-origin"] === "string" ? new URL(args["site-origin"]).origin : "";
// Public-origin URLs mapped onto the crawl origin. SITE_ORIGIN may still be found while the crawl runs (robots.txt's
// Sitemap: line, the sitemap, the home page's canonical), so every module gets this function, never the value.
const toCrawl = u => mapOrigin(u, SITE_ORIGIN, START_ORIGIN);
const { get, follow, firstBytes, fetchSitemap, xRobotsLines, blocked, slow } = createFetcher({
  startOrigin: START_ORIGIN,
  ua: UA,
  toCrawl,
});
const notes = [];
// --include and --exclude: comma-separated path prefixes, so one crawl can cover one section such as /blog/.
const pathList = k =>
  typeof args[k] === "string"
    ? args[k]
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => "/" + s.replace(/^\/+/, ""))
    : [];
const INCLUDE = pathList("include"),
  EXCLUDE = pathList("exclude"),
  SECTION = INCLUDE.length > 0 || EXCLUDE.length > 0;
const inSection = path =>
  (!INCLUDE.length || INCLUDE.some(p => path.startsWith(p))) && !EXCLUDE.some(p => path.startsWith(p));
const AI_PROBE = !!args["ai-bot-probe"];
const RENDER_PAGE = typeof args["render-page"] === "string" ? args["render-page"] : null;
const RENDER_STEPS = typeof args["render-steps"] === "string" ? args["render-steps"] : "";
const CLEAN_SHOTS = !!args["clean-screenshots"];
// Every finding's URL and detail is scrubbed of secret keys, secret query values and home folders, whichever check adds
// it, so no secret reaches the crawl file through another check's evidence. Notes and notChecked reasons get the same
// scrub on output, emails included.
const { findings, add, evaluated, evalRules, notChecked, skip, list } = createFindings(
  CHECKS,
  s => redact(maskKeys(s), { emails: false }),
  RULES,
);

// Sitemap <xhtml:link> hreflang by crawl URL, built on first use: `sm` is only read later, before the crawl starts.
let smHreflang;
const sitemapHreflang = u =>
  (smHreflang ||= new Map(sm.entries.filter(e => e.hreflang).map(e => [clean(toCrawl(e.loc)), e.hreflang]))).get(
    clean(u),
  ) || [];
// analyze()'s context (crawl/page.mjs). toCrawl and sitemapHreflang are passed as functions: their data arrives later.
const page = { start: START, startOrigin: START_ORIGIN, banned: BANNED, verify: VERIFY, toCrawl, sitemapHreflang };

// ---------- crawl ----------
const crawler = createCrawler({
  start: START,
  startOrigin: START_ORIGIN,
  max: MAX,
  conc: CONC,
  includeQuery: INCLUDE_QUERY,
  inSection,
  fetcher: { follow, xRobotsLines },
  page,
  toCrawl,
  notes,
});
const { pages, queue, seen, enqueue } = crawler;

// ---------- main ----------
const t0 = Date.now();
const robotsRes = await follow(START_ORIGIN + "/robots.txt", undefined, 5); // Google stops after 5 hops here, 10 for pages
const { robots, robotsDown, star } = checkRobots(robotsRes, { add, evalRules, startOrigin: START_ORIGIN });
const smUrls = robots && robots.sitemaps.length ? robots.sitemaps : [START_ORIGIN + "/sitemap.xml"];
const firstSm = smUrls[0];
if (!SITE_ORIGIN) {
  try {
    const o = new URL(firstSm).origin;
    if (o !== START_ORIGIN) SITE_ORIGIN = o;
  } catch {}
}
const smListed = !!(robots && robots.sitemaps.length);
const sm = await findSitemaps(smUrls, smListed, {
  startOrigin: START_ORIGIN,
  notes,
  fetchSitemap,
  toCrawl,
  conc: CONC,
});
if (!SITE_ORIGIN && sm.entries.length) {
  try {
    const o = new URL(sm.entries[0].loc).origin;
    if (o !== START_ORIGIN && !isLocal(o)) SITE_ORIGIN = o;
  } catch {}
}
checkSitemapFiles(sm, smUrls, { add, findings });
// The home page goes first: its canonical may give the public origin.
enqueue(START.href);
await crawler.run();
const home = pages.get(START.href);
if (!SITE_ORIGIN && home && home.canonicals && home.canonicals[0]) {
  try {
    const o = new URL(home.canonicals[0], home.base).origin;
    if (o !== START_ORIGIN && !isLocal(o)) SITE_ORIGIN = o;
  } catch {}
}
const EXPECT_ORIGIN = SITE_ORIGIN || START_ORIGIN;
if (SITE_ORIGIN && SITE_ORIGIN !== START_ORIGIN)
  notes.push(`Public origin ${SITE_ORIGIN} was mapped onto ${START_ORIGIN} for crawling.`);
const smSet = checkSitemapEntries(sm, firstSm, {
  add,
  notes,
  evalRules,
  expectOrigin: EXPECT_ORIGIN,
  startOrigin: START_ORIGIN,
  toCrawl,
  inSection,
  crawler: { seen, queue },
});
await crawler.run();
const { fetched, capped } = crawler; // final from here: the queue runs no more
// A page over the read limit (crawl/queue.mjs) isn't read, but it's surely past Googlebot's 2 MB too (REND-08).
for (const p of pages.values())
  if (p.over) add("html-over-2mb", p.finalUrl, `over ${PAGE_MAX / 1048576} MB once unpacked, so it wasn't read`);
// Pages a bot challenge answered instead (crawl/queue.mjs): not checked, and not reported as broken either.
if (crawler.challenges.length)
  notes.push(
    `${crawler.challenges.length} page(s) answered with a bot challenge (from Cloudflare or AWS WAF) instead of the page, e.g. ${quote(crawler.challenges[0])}, so they weren't checked. Let the crawler through (allow this machine's address, or the user agent ${UA}) or crawl a staging copy, then run it again.`,
  );

// Soft 404, llms.txt, Markdown, security.txt and the home page's security headers.
const mdHome = await probeSite({
  start: START,
  startOrigin: START_ORIGIN,
  expectOrigin: EXPECT_ORIGIN,
  checkLive: CHECK_LIVE,
  conc: CONC,
  home,
  add,
  evalRules,
  notes,
  follow,
  get,
  pages,
});

// ---------- per-page checks ----------
evalRules(
  "AI-01",
  "REND-08",
  "CONTENT-04",
  "REND-04",
  "CONTENT-09",
  "CRAWL-02",
  "CRAWL-06",
  "CRAWL-07",
  "CRAWL-08",
  "URL-01",
  "URL-04",
  "URL-05",
  "REND-01",
  "META-01",
  "META-02",
  "META-04",
  "META-05",
  "CONTENT-01",
  "CONTENT-02",
  "CONTENT-05",
  "CONTENT-08",
  "SCHEMA-01",
  "SCHEMA-02",
  "SCHEMA-03",
  "SCHEMA-04",
  "SCHEMA-05",
  "SCHEMA-07",
  "MAP-03",
  "LINK-01",
  "LINK-02",
  "LINK-05",
  "LINK-06",
  "PERF-03",
  "PERF-04",
  "PERF-06",
  "REND-09",
  "META-06",
  "MEDIA-03",
);
if (BRAND) evalRules("META-03");
if (BANNED || VERIFY) evalRules("CONTENT-10");
const all = [...pages.values()];
const byFinal = new Map();
for (const p of all) if (p.finalUrl) byFinal.set(p.finalUrl, p);
// One record per page: a link or canonical to a URL that redirects fetches its page again, so the direct fetch is kept.
const byPage = new Map();
for (const p of all) if (p.html && (!byPage.has(p.finalUrl) || p.url === p.finalUrl)) byPage.set(p.finalUrl, p);
const htmlPages = [...byPage.values()];
const finalOf = u => pages.get(u)?.finalUrl || u;
const isHome = p => new URL(p.finalUrl).pathname === "/";

const canonicalFor = p => {
  const c = p.canonicals && p.canonicals[0];
  return c ? (urlOr(c, p.base)?.href ?? null) : null;
};
const samePath = (a, b) => new URL(a).pathname === new URL(b).pathname;
const indexable = p =>
  p.html &&
  (IGNORE_NOINDEX || !p.noindex) &&
  (() => {
    const c = canonicalFor(p);
    return !c || samePath(toCrawl(c), p.finalUrl);
  })();
// The site's own hosts, with or without www: on an HTTPS site an http:// link to them costs a redirect.
const bareHost = h => h.replace(/^www\./, "");
const selfHosts = new Set([START_ORIGIN, EXPECT_ORIGIN].map(o => bareHost(new URL(o).host)));
const extra = {}; // data for the report, filled by the site-wide checks below
// Shared context for the site-wide checks. From here on only the page records' own fields, `all` (old URLs join it),
// extra, notes, notChecked and the finding store change.
const site = {
  all,
  pages,
  byPage,
  byFinal,
  htmlPages,
  home,
  smSet,
  robots,
  star,
  add,
  evalRules,
  evaluated,
  findings,
  notes,
  notChecked,
  extra,
  ignoreNoindex: IGNORE_NOINDEX,
  brand: BRAND,
  start: START,
  startOrigin: START_ORIGIN,
  expectOrigin: EXPECT_ORIGIN,
  conc: CONC,
  toCrawl,
  get,
  follow,
  firstBytes,
  finalOf,
  isHome,
  canonicalFor,
  samePath,
  indexable,
  bareHost,
  selfHosts,
};
const { checkedPages, images, shareImages, titleWords, brandWords, acronyms, localBusiness } = checkPages(site);
// Runs before the Googlebot test. Each image is asked once; extra.images reuses the rows.
const { imageRows, imageInfo } = await checkAssets(site, { images, shareImages });
const { inbound } = checkLinks(site);
const style = await slashStyle(site, SLASH);

// ---------- old URLs / redirect sources ----------
const redirectSources = await oldUrls(site, { urlList: URL_LIST, nextManifest: NEXT_MANIFEST });

// ---------- live origin: certificate, http→https and other-host redirects, HSTS ----------
// One deeper page tests whether the other host's redirect keeps the path.
const live =
  CHECK_LIVE && EXPECT_ORIGIN.startsWith("https:") && isPublic(EXPECT_ORIGIN)
    ? await checkLive(EXPECT_ORIGIN, {
        add,
        path: (p => p && new URL(p.finalUrl).pathname)(htmlPages.find(p => !isHome(p) && indexable(p))),
      })
    : null;
if (live) notes.push(...live.notes);
if (live && !live.unresolved) evalRules("TRUST-07", "URL-03");
else
  for (const rule of ["TRUST-07", "URL-03"])
    notChecked.push({
      rule,
      area: `${rule} ${RULES[rule][0]}`,
      reason: live
        ? `${new URL(EXPECT_ORIGIN).hostname} doesn't resolve in DNS yet; run --check-live once the site is live.`
        : CHECK_LIVE
          ? "--check-live needs a public https:// origin; pass --site-origin."
          : "Pass --check-live once the site is live.",
    });

// ---------- outside checks: real-user speed ----------
/** @typedef {{ trend?: any, lcpBreakdown?: any, note?: string }} TrendResult */
/** @type {{ strategy: string, samples: any[], trend?: any, lcpBreakdown?: any, desktop?: any, tablet?: any, pageTrend?: any }} */
let speed;
let speedReason = OUTSIDE
  ? "Speed data needs the public, live site; pass --site-origin."
  : "Outside checks are off. With the owner's go-ahead, --outside fetches real-user speed data from Google PageSpeed Insights.";
const SPEED_ON = OUTSIDE && isPublic(EXPECT_ORIGIN),
  PSI_AT = typeof args["psi-endpoint"] === "string" ? args["psi-endpoint"] : PSI_ENDPOINT,
  CRUX_AT = typeof args["crux-endpoint"] === "string" ? args["crux-endpoint"] : CRUX_HISTORY_ENDPOINT;
const speedUrls = SPEED_ON
  ? sampleUrls(
      htmlPages
        .filter(p => indexable(p) && !p.clientOnly)
        .map(p => {
          const x = new URL(p.finalUrl);
          return EXPECT_ORIGIN + x.pathname + x.search;
        }),
    )
  : [];
let speedLimited = false;
if (SPEED_ON) {
  const r = await checkSpeed(speedUrls, { add, endpoint: PSI_AT, key: process.env.PSI_API_KEY });
  if (r.samples.length) speed = { strategy: "mobile", samples: r.samples };
  notes.push(...r.notes);
  speedLimited = r.limited;
  // PERF-01 counts as checked only when real-user data came back for at least one page.
  if (r.samples.some(s => s.field)) {
    evalRules("PERF-01");
    speedReason = null;
  } else
    speedReason = r.limited
      ? "PageSpeed refused the requests. Set PSI_API_KEY (a free Google Cloud API key for the PageSpeed Insights API) and re-run."
      : "No real-user data came back for the sampled pages (too few Chrome visits, or PageSpeed failed); see the notes.";
}
if (speedReason) notChecked.push({ rule: "PERF-01", area: `PERF-01 ${RULES["PERF-01"][0]}`, reason: speedReason });
// The 25-week trend for the whole origin, only with a key (CRUX_API_KEY, or a PSI_API_KEY with the CrUX API enabled).
const CRUX_KEY = process.env.CRUX_API_KEY || process.env.PSI_API_KEY;
if (SPEED_ON && CRUX_KEY) {
  const t = /** @type {TrendResult} */ (
    await speedTrend(EXPECT_ORIGIN, { key: CRUX_KEY, endpoint: CRUX_AT }).catch(e => ({
      note: `CrUX history failed (${e.message}).`,
    }))
  );
  if (t.trend)
    speed = {
      ...(speed || { strategy: "mobile", samples: [] }),
      trend: t.trend,
      ...(t.lcpBreakdown ? { lcpBreakdown: t.lcpBreakdown } : {}),
    };
  if (t.note) notes.push(t.note);
}
// Desktop never makes a finding or counts in the score: PERF-01 is about phones, the version Google indexes.
if (DESKTOP && !OUTSIDE)
  notes.push(
    "--desktop runs only with outside checks on (--outside): it sends the sample URLs to Google PageSpeed Insights again, for desktop. It didn't run.",
  );
else if (DESKTOP && !SPEED_ON)
  notes.push("--desktop didn't run: speed data needs the public, live site; pass --site-origin.");
else if (DESKTOP && speedLimited)
  notes.push(
    "--desktop didn't run: PageSpeed refused the phone requests, so the desktop ones weren't sent. Set PSI_API_KEY (a free Google Cloud API key for the PageSpeed Insights API) and re-run.",
  );
else if (DESKTOP) {
  const d = await checkSpeed(speedUrls, {
    add: () => {},
    endpoint: PSI_AT,
    key: process.env.PSI_API_KEY,
    strategy: "desktop",
  });
  const t = CRUX_KEY
    ? await speedTrend(EXPECT_ORIGIN, { key: CRUX_KEY, endpoint: CRUX_AT, formFactor: "DESKTOP" }).catch(e => ({
        note: `CrUX history (desktop) failed (${e.message}).`,
      }))
    : {};
  notes.push(...d.notes, ...(t.note ? [t.note] : []));
  if (d.samples.length || t.trend)
    speed = {
      ...(speed || { strategy: "mobile", samples: [] }),
      desktop: {
        strategy: "desktop",
        samples: d.samples,
        ...(t.trend ? { trend: t.trend } : {}),
        ...(t.lcpBreakdown ? { lcpBreakdown: t.lcpBreakdown } : {}),
      },
    };
}

// ---------- outside checks: what JavaScript changes ----------
const renderSample = sampleUrls(htmlPages.filter(p => indexable(p) && !p.refreshTo).map(p => p.finalUrl)); // a meta refresh would render its target
// --render all: every page meant to rank (as Lighthouse's all mode takes them), capped, after the time estimate.
const renderEvery =
  browser && RENDER_ALL
    ? renderAll([...new Set(htmlPages.filter(p => indexable(p) && !p.refreshTo).map(p => p.finalUrl))], {
        log: console.log,
      })
    : null;
const renderList = renderEvery?.urls || renderSample;
// One Chrome behind the site's guard serves the renders (each in an isolated tab), then the phone and desktop loads.
// Lighthouse starts its own.
let sessionError = /** @type {Error | null} */ (null);
const session =
  browser && (renderList.length || RENDER_PAGE)
    ? await openSession(browser, renderList[0] ?? START.href).catch(e => {
        sessionError = e;
        return null;
      })
    : null;
let renderFailure = null;
if (browser) {
  let rendered = 0;
  if (sessionError) renderFailure = String(sessionError.message).split("\n")[0].slice(0, 120);
  else
    for (const u of renderList) {
      try {
        const [rawRes, dom] = await Promise.all([get(u, { manual: false }), renderPage(browser, u, {}, session)]);
        if (rawRes.status !== 200 || !rawRes.body) {
          renderFailure ||= `the raw HTML of ${u} couldn't be fetched again`;
          continue;
        }
        rendered++;
        renderFindings(u, rawRes.body, dom, { add, clientRendered: !!byPage.get(u)?.clientOnly });
      } catch (e) {
        renderFailure ||= String(e.message).split("\n")[0].slice(0, 120);
      }
    }
  if (rendered) {
    evalRules("REND-06");
    notes.push(
      `Rendered ${rendered} of ${renderList.length} ${renderEvery ? "" : "sample "}page(s) in headless ${/edge/i.test(browser) ? "Edge" : "Chrome"} and compared them with the raw HTML.${renderFailure ? ` Some failed: ${renderFailure}` : ""}`,
    );
  } else
    notChecked.push({
      rule: "REND-06",
      area: `REND-06 ${RULES["REND-06"][0]}`,
      reason: `The browser at ${browser} couldn't render the sample pages (${renderFailure || "no pages to render"}).`,
    });
} else
  notChecked.push({
    rule: "REND-06",
    area: `REND-06 ${RULES["REND-06"][0]}`,
    reason: OUTSIDE
      ? "Chrome or Edge isn't installed (or set CHROME_PATH), so rendered pages couldn't be compared with the raw HTML."
      : "Outside checks are off. With the owner's go-ahead, --outside renders sample pages in headless Chrome (running the site's own scripts) and compares them with the raw HTML.",
  });

// ---------- outside checks: phone and desktop loads, screenshots, lab speed ----------
let labSpeed,
  visualReason = OUTSIDE
    ? "Chrome or Edge isn't installed (or set CHROME_PATH), so pages couldn't be loaded at phone size."
    : "Outside checks are off. With the owner's go-ahead, --outside loads sample pages in headless Chrome at desktop and phone size (running the site's own scripts) and saves screenshots.";
let bfTested = 0,
  bfReason = OUTSIDE
    ? "Chrome or Edge isn't installed (or set CHROME_PATH)"
    : "outside checks are off (with the owner's go-ahead, --outside runs it in headless Chrome)";
/** @type {{ checked: number, pages: any[], chosen: any, notes: string[] } | null} */
let more = null; // the render checks (REND-11), read from the same loads; their notes and data go in further down
if (browser) {
  // --render-page's raw HTML is read first for the comparison.
  let chosen = null;
  if (RENDER_PAGE) {
    const u = urlOr(RENDER_PAGE, START.href);
    if (u && /^https?:$/.test(u.protocol)) {
      const res = await get(u.href, { manual: false }).catch(() => null);
      chosen = { url: u.href, steps: RENDER_STEPS, raw: res?.status === 200 && res.body ? res.body : null };
    } else notes.push(`--render-page needs an http or https address; “${RENDER_PAGE}” isn't one, so it didn't run.`);
  }
  const failed = e => {
    const why = String(e.message).split("\n")[0].slice(0, 160);
    return {
      visual: { checked: 0, lab: [], notes: [`the browser didn't start: ${why}`], bfTested: 0 },
      more: { checked: 0, pages: [], chosen: null, notes: [`the browser didn't start for the render checks: ${why}`] },
    };
  };
  const both = sessionError
    ? failed(sessionError)
    : await browserChecks(browser, renderSample, {
        add,
        screenshotDir: resolve(dirname(OUT), "screenshots"),
        rawWords: new Map(htmlPages.filter(p => !p.clientOnly).map(p => [p.finalUrl, p.words])),
        clean: CLEAN_SHOTS,
        chosen,
        session,
      }).catch(failed);
  await session?.close();
  const v = both.visual;
  more = both.more;
  if (v.lab.length) labSpeed = v.lab;
  if (v.checked) {
    evalRules("REND-07", "PERF-07");
    visualReason = null;
    notes.push(...v.notes);
  } else
    visualReason = `The browser at ${browser} couldn't load the sample pages (${v.notes[0] || "no pages to load"}).`;
  bfTested = v.bfTested || 0;
  bfReason = !renderSample.length
    ? "no page meant to rank could be tested"
    : renderSample.length < 2
      ? "only one page could be tested, and Back needs a second page to come back from"
      : !v.checked
        ? "the browser couldn't load the sample pages"
        : "it timed out on every page (see the notes)";
}
if (visualReason)
  for (const rule of ["REND-07", "PERF-07"])
    notChecked.push({ rule, area: `${rule} ${RULES[rule][0]}`, reason: visualReason });
// PERF-10 passes only when Chrome's own test ran; without it the HTML hints can still raise a finding, but not pass it.
if (bfTested) evalRules("PERF-10");
else if (!findings.has("bfcache-no-store") && !findings.has("bfcache-unload"))
  notChecked.push({
    rule: "PERF-10",
    area: `PERF-10 ${RULES["PERF-10"][0]}`,
    reason: `Chrome's back/forward cache test didn't run: ${bfReason}.${checkedPages ? " The HTML hints (Cache-Control: no-store, inline unload handlers) found nothing." : ""}`,
  });

// ---------- outside checks: Lighthouse, an optional add-on (scores only, no findings) ----------
let lighthouse;
const lighthouseBin = LIGHTHOUSE && OUTSIDE ? findLighthouse() : null;
if (LIGHTHOUSE && !OUTSIDE)
  notes.push(
    "--lighthouse runs only with outside checks on (--outside): Lighthouse loads each page and runs its scripts, analytics included. It didn't run.",
  );
else if (LIGHTHOUSE && !lighthouseBin)
  notes.push(
    "Lighthouse isn't installed, so it didn't run. Add it with `npx seo-supervisor --with-lighthouse` (about 170 MB, outside the project), or `npm i -g lighthouse`.",
  );
else if (lighthouseBin) {
  // all: every page meant to rank, without the sample's one-per-folder pick; the estimate prints before the runs.
  const every = [...new Set(htmlPages.filter(p => indexable(p) && !p.refreshTo).map(p => p.finalUrl))];
  // --lighthouse 20: that many pages meant to rank, the sample first and then the rest, up to all mode's cap.
  const asked = /^\d+$/.test(args.lighthouse) ? Math.min(Number(args.lighthouse), ALL_CAP) : 0;
  const r = await checkLighthouse(
    lighthouseBin,
    LIGHTHOUSE_ALL ? every : asked ? [...new Set([...renderSample, ...every])] : renderSample,
    { chromePath: browser, all: LIGHTHOUSE_ALL || asked > 0, ...(asked ? { max: asked } : {}), log: console.log },
  );
  if (r.results.length) lighthouse = r.results;
  notes.push(...r.notes);
}
// Which part of LCP takes longest: real visitors' (from the trend above), else a PageSpeed or Lighthouse lab run's.
const labLcp = speed?.lcpBreakdown
  ? null
  : labLcpBreakdown([...(speed?.samples || []).map(s => ({ url: s.url, ...s.lab })), ...(lighthouse || [])]);
if (labLcp) speed = { ...(speed || { strategy: "mobile", samples: [] }), lcpBreakdown: labLcp };

// ---------- site-wide checks and data, in this order (data for the report goes on `extra`) ----------

// Unnamed controls, WebMCP tools, agent files and writing notes.
await agentData(site, UA);

// A business type guessed from the home page and the schema, and a finding when the schema is too general.
extra.businessType = home?.html
  ? checkBusinessType(
      htmlPages.map(p => ({
        url: p.finalUrl,
        title: p.title,
        h1: p.headings.find(h => h.level === 1)?.text,
        text: p.bizText,
        types: [...p.types, ...p.schemaOther],
      })),
      add,
    )
  : detectBusinessType([]);

pageMarkup(site);
cookiesAndPolicies(site);
// Other sites are visited only with --outbound-links, a separate opt-in.
const OUTBOUND = !!args["outbound-links"];
const outbound = await outboundLinks(site, OUTBOUND);

descStartsWithTitle(site);

// hreflang sources that disagree, missing versions, lang against hreflang, untranslated versions, invalid lang values,
// and the Translate widget as the only translation.
checkLanguages(
  htmlPages.filter(p => indexable(p) && !p.clientOnly),
  { add, origin: EXPECT_ORIGIN },
);

imageList(site, { images, imageRows });

if (RENDER_ALL && !OUTSIDE)
  notes.push(
    "--render all runs only with outside checks on (--outside): rendering runs each page's own scripts, analytics included. It didn't run.",
  );
if (renderEvery?.note) notes.push(renderEvery.note);

// Kept for seo-diff.mjs. A redirect that never ends (a loop, or more than 10 hops) has no target.
{
  const body = robots ? robotsRes.body : null,
    met = all.filter(p => p.chain?.length > 1).sort((a, b) => (a.url < b.url ? -1 : 1));
  extra.robotsTxt = {
    status: robotsRes.status,
    hash: body == null ? null : createHash("sha256").update(body).digest("hex"),
    text: body?.slice(0, 50 * 1024) ?? null,
  };
  extra.redirects = met
    .slice(0, 500)
    .map(p => ({ from: p.url, to: p.error === "too many redirects" ? null : p.finalUrl, status: p.chain[0].status }));
  if (met.length > 500)
    notes.push(`The crawl met ${met.length} redirects; the first 500 are kept for the next audit's comparison.`);
}

securityHeaders(site);
for (const r of extra.redirects || []) {
  r.from = hideSecrets(r.from);
  if (r.to) r.to = hideSecrets(r.to);
}
// The browser's private-address guard can't run behind a proxy.
if ((browser || lighthouseBin) && chromeProxyArgs().length)
  notes.push(
    "A proxy is set (HTTPS_PROXY or HTTP_PROXY), so headless Chrome and Lighthouse went through it, and the guard that keeps them off private and cloud-metadata addresses didn't run for renders and Lighthouse. The proxy decides what they can reach.",
  );

versionedNote(robots, notes);
checkCoverage(site, {
  section: SECTION,
  include: INCLUDE,
  exclude: EXCLUDE,
  crawler: { seen, fetched, capped },
  sm,
  gscIndexing: args["gsc-indexing"],
});
// Other sites' hreflang targets are visited only with --outside and --hreflang-other-sites: 20 at most, never a private
// address. A target must name the page back; a 404 or 410 is a bad target, anything else that isn't a page is a note.
{
  const others = otherSiteTargets(
      htmlPages.filter(p => indexable(p) && !p.clientOnly),
      EXPECT_ORIGIN,
    ),
    yes = !!args["hreflang-other-sites"];
  if (others.size && OUTSIDE && yes) {
    const list = [...others].slice(0, 20),
      away = [];
    for (let i = 0; i < list.length; i += CONC)
      await Promise.all(
        list.slice(i, i + CONC).map(async ([target, from]) => {
          // A page on another site that trips a check is "couldn't check", never the end of the crawl.
          const r = await follow(target),
            there = (() => {
              try {
                return readPage(r, page);
              } catch {
                return null;
              }
            })();
          if (r.status === 404 || r.status === 410)
            for (const f of from) add("hreflang-bad-target", f.url, `${f.lang} → ${target} (status ${r.status})`);
          else if (!there)
            away.push(`${quote(target)} (${r.error || `status ${r.status}`})`); // quoted: the target is site text
          else
            for (const f of from)
              if (!linksBack(there.hreflang, r.finalUrl, f.url, toCrawl))
                add("hreflang-no-return", f.url, `${f.lang} → ${target} doesn't link back`);
        }),
      );
    if (away.length)
      notes.push(
        `${away.length} hreflang target(s) on other sites couldn't be checked for a return link, e.g. ${away[0]}.`,
      );
    if (others.size > 20) notes.push(`hreflang on other sites: the first 20 of ${others.size} targets were checked.`);
  } else if (others.size) {
    if (yes)
      notes.push(
        "--hreflang-other-sites runs only with outside checks on (--outside), since it visits other sites. It didn't run.",
      );
    notChecked.push({
      rule: "META-08",
      area: "META-08 hreflang return links on other sites",
      reason: `${others.size} hreflang target(s) on other sites, e.g. ${others.keys().next().value}, weren't visited to see whether they link back: that contacts other sites, so it needs outside checks on (--outside) and the owner's own yes (--hreflang-other-sites).`,
    });
  }
}

aiBotAccess({ robots, robotsRes, star }, { add, extra, startOrigin: START_ORIGIN });
bingAiPrefs(site);
// Comment links, Back traps, paywalls, late head tags, site identity.
pageSignals(site);

aiRobotRules({ robots, robotsRes }, { add, extra, startOrigin: START_ORIGIN });

// Also #fragment links.
linkedOnce(site, { section: SECTION, capped });

// Duplicate analytics, secret keys in pages and scripts, hidden links, app files, PDFs.
await hygieneChecks(site, UA);

await markdownCheck(site, { mdHome, renderSample });

linkStrength(site, { section: SECTION, capped });

// The page-words file for keyword-ideas.mjs.
pageWords(site, { out: OUT, stamp: t0 });

// Click-only elements and missing landmarks.
landmarks(site);
// ---------- the bot probes, the last requests to the site: a firewall may ban the address that sent them ----------
// The home page and up to 9 sample pages as Googlebot, then a few as AI search crawlers with --ai-bot-probe. Every
// other request to the site, schema images and browser loads included, has already gone.
const botSample = sampleUrls(htmlPages.map(p => p.url));
const botCompared = await compareGooglebot(site, { page, botSample });
await aiBotProbe(site, { page, botSample, aiProbe: AI_PROBE, outside: OUTSIDE });
// After every request this crawl makes: what the private-address guard stopped, and whether the crawler slowed down.
if (blocked.size)
  notes.push(
    `The crawler didn't fetch ${blocked.size} address(es) outside the crawled site that are private, local or cloud-metadata addresses: ${[
      ...blocked,
    ]
      .slice(0, 3)
      .map(([u, why]) => `${quote(u)} (${why})`)
      .join("; ")}. A redirect there is reported as the redirect itself.`,
  );
const slowed = slowNote(slow);
if (slowed) notes.push(slowed);

// Also schema placeholders and deprecated types.
await schemaImages(site);

shopChecks(site);

mediaData(site, { speed, lighthouse, imageInfo });
// Only once the phone trend came back: a site without it has no tablet or page data either. A 404 is no news.
if (SPEED_ON && CRUX_KEY && speed?.trend) {
  const [tab, homeT] = /** @type {TrendResult[]} */ ([
    await speedTrend(EXPECT_ORIGIN, { key: CRUX_KEY, endpoint: CRUX_AT, formFactor: "TABLET" }).catch(e => ({
      note: `CrUX history (tablet) failed (${e.message}).`,
    })),
    await speedTrend(EXPECT_ORIGIN + "/", { key: CRUX_KEY, endpoint: CRUX_AT, page: true }).catch(e => ({
      note: `CrUX history for the home page failed (${e.message}).`,
    })),
  ]);
  for (const t of [tab, homeT]) if (t.note && !/not enough Chrome visits/.test(t.note)) notes.push(t.note);
  if (tab.trend) speed.tablet = { trend: tab.trend, ...(tab.lcpBreakdown ? { lcpBreakdown: tab.lcpBreakdown } : {}) };
  if (homeT.trend) speed.pageTrend = { url: EXPECT_ORIGIN + "/", trend: homeT.trend };
}

// REND-11 data from the browser loads above, and --render-page's result.
if (RENDER_PAGE && !OUTSIDE)
  notes.push(
    "--render-page runs only with outside checks on (--outside): rendering runs the page's own scripts, analytics included. It didn't run.",
  );
let moreReason = OUTSIDE
  ? "Chrome or Edge isn't installed (or set CHROME_PATH), so the phone menu and ads couldn't be checked."
  : "Outside checks are off. With the owner's go-ahead, --outside loads sample pages in headless Chrome at phone size (running the site's own scripts) to try the menu button and measure ads.";
if (more) {
  notes.push(...more.notes);
  if (more.pages.length) extra.renderSample = more.pages;
  if (more.chosen) extra.renderedPage = more.chosen;
  if (more.checked) {
    evalRules("REND-11");
    moreReason = null;
  } else
    moreReason = `The browser at ${browser} couldn't load the sample pages at phone size (${more.notes[0] || "no pages to load"}).`;
}
if (moreReason) notChecked.push({ rule: "REND-11", area: `REND-11 ${RULES["REND-11"][0]}`, reason: moreReason });

// Descriptions against their pages, templated descriptions, stale guides, keyword use.
contentChecks(site, { titleWords, brandWords, acronyms });

localData(site, localBusiness);

otherSites(site, outbound);

// E-E-A-T signals for the trust view, never findings or scored; last, so the security findings are in. HTTPS counts
// with no open TRUST-01 or TRUST-07 finding, and is unknown without a public origin. Locally a missing security header
// is often one a CDN adds in production, so it doesn't count against HTTPS; a header sent but wrong still does.
const localHeaders = isLocal(START_ORIGIN) && findings.has("sec-headers");
extra.trustSignals = trustSignals(htmlPages, {
  origin: EXPECT_ORIGIN,
  localHeaders,
  https: !isPublic(EXPECT_ORIGIN)
    ? null
    : EXPECT_ORIGIN.startsWith("https:") &&
      ![...findings.keys()].some(
        k => !(localHeaders && k === "sec-headers") && ["TRUST-01", "TRUST-07"].includes(CHECKS[k][0]),
      ),
  orgSchema: (home?.html && home.trust.org) || htmlPages.find(p => p.trust.org)?.trust.org || null,
  unsourcedStats: htmlPages.filter(p => p.trust.unsourcedStat).length,
});

// ---------- what the crawler cannot check ----------
// CRAWL-09 never passes here: a real Googlebot comes from Google's IP addresses, which no request from here can.
const NOT_CRAWLABLE = [
  ...(["googlebot-blocked", "googlebot-differs", "googlebot-firewall"].some(k => findings.has(k))
    ? []
    : [
        [
          "CRAWL-09",
          "Bot protection and firewall",
          botCompared
            ? `A Googlebot user agent got the same status, robots tag, canonical, title and text as a visitor on ${botCompared} page(s)${isLocal(START_ORIGIN) ? " of the local build, where no CDN or firewall sits in between; crawl the live site to include them" : ""}. A real Googlebot comes from Google's IP addresses, which a firewall can treat differently; confirm with the live test in Search Console's URL Inspection.`
            : "A local crawl can't see CDN or WAF behaviour toward Googlebot; check the CDN settings and URL Inspection after launch.",
        ],
      ]),
  [
    "CRAWL-11",
    "Drafts and publish flags",
    "The crawler can't see publish flags; check the content layer (scripts/content-scan.mjs).",
  ],
  ["SCHEMA-08", "Rich result eligibility", "Run one URL per template through Google's Rich Results Test."],
  ["META-07", "Search Console and Bing verification", "Check DNS or ask the owner."],
  ["LINK-03", "Circular linking design", "Needs a read of the related-content code and data."],
  ["CONTENT-03", "Keyword targeting and cannibalization", "Needs the content plan or Search Console query data."],
  [
    "CONTENT-11",
    "Spam policies (scaled content, doorways, site reputation, back-button hijacking)",
    'Needs a read of content strategy and scripts. The crawler covers parts of it: near-duplicate pages, links in comment sections without rel="ugc" or "nofollow", and inline scripts that may trap the Back button; scripts loaded from files aren\'t read.',
  ],
  [
    "AI-02",
    "AI crawler access through the CDN/WAF",
    "robots.txt is checked; firewall behaviour toward OAI-SearchBot, Claude-SearchBot and PerplexityBot isn't visible locally.",
  ],
];
for (const [rule, area, reason] of NOT_CRAWLABLE) skip(rule, reason, `${rule} ${area}`);
// MAP-01 is half the robots.txt Sitemap: line, so only a sitemap finding settles it while robots.txt is down.
if (robotsDown)
  for (const rule of ["MAP-01", "MAP-05", "MAP-06"])
    if (![...findings.keys()].some(k => CHECKS[k][0] === rule))
      skip(
        rule,
        `robots.txt answered ${robotsRes.status ? `status ${robotsRes.status}` : "nothing"}, so its ${rule === "MAP-01" ? "Sitemap: line" : "rules"} couldn't be read. Re-run once it returns 200.`,
      );
// A page missing from the sitemap URLs read may be in the part past SITEMAP_KEEP.
if (sm.cut && findings.delete("missing-from-sitemap") && evaluated.delete("MAP-03"))
  skip(
    "MAP-03",
    sm.filesLeft
      ? "Some crawled pages aren't in the first 60 sitemap files, the most this audit reads, so they may still be in the files after them."
      : `Some crawled pages aren't among the first ${SITEMAP_KEEP.toLocaleString("en-US")} sitemap URLs, the most this audit reads, so they may still be in the rest of the sitemap.`,
  );
if (!redirectSources.length)
  skip(
    "URL-07",
    "No redirect list given. Pass --urls (old site URLs) or --next-manifest .next/routes-manifest.json.",
    "URL-07 Old-URL redirects",
  );
if (!BANNED && !VERIFY)
  skip(
    "CONTENT-10",
    "Pass --banned and --verify with the profile's claim lists.",
    "CONTENT-10 Banned and unconfirmed claims",
  );
if (IGNORE_NOINDEX && evaluated.delete("CRAWL-02"))
  skip(
    "CRAWL-02",
    "Pre-launch run: noindex is expected now. Re-check after launch (CRAWL-03).",
    "CRAWL-02 Pages meant to rank are not noindex",
  );

// ---------- output ----------
const out = list({ source: "crawler", prefix: "C" });
const failedRules = new Set(out.map(f => f.rule));
const passed = [...evaluated]
  .filter(r => !failedRules.has(r))
  .sort()
  .map(r => ({ rule: r, title: RULES[r][0], category: RULES[r][1] }));
// Every note and every notChecked reason, whichever check wrote it and whenever, through one scrub.
const scrubText = s => redact(maskKeys(String(s)));
const noteList = notes.map(scrubText);
const report = {
  tool: "seo-supervisor-crawler",
  version: VERSION,
  crawledAt: new Date().toISOString(),
  durationMs: Date.now() - t0,
  startUrl: START.href,
  siteOrigin: EXPECT_ORIGIN,
  options: {
    max: MAX,
    concurrency: CONC,
    ignoreNoindex: IGNORE_NOINDEX,
    banned: BANNED ? String(BANNED) : null,
    verify: VERIFY ? String(VERIFY) : null,
    redirectSources: redirectSources.length,
    trailingSlash: SLASH,
    detectedSlashStyle: style,
    includeQuery: INCLUDE_QUERY,
    brand: BRAND || null,
  },
  // capped: stopped at --max. sitemapComplete: every sitemap file answered 200 and none went unread past a limit.
  // seo-diff.mjs compares internal links and sitemap listing only when they say the crawl and the sitemap were whole.
  stats: {
    fetched,
    capped,
    htmlPages: htmlPages.length,
    sitemapUrls: sm.entries.length,
    sitemapFiles: sm.files,
    sitemapComplete: !sm.cut && sm.files.every(f => f.status === 200),
    robotsTxt: robotsRes.status,
  },
  notes: noteList,
  findings: out,
  passed,
  notChecked: notChecked.map(n => ({ ...n, reason: scrubText(n.reason) })),
  ...extra,
  ...(speed ? { speed } : {}),
  ...(labSpeed ? { labSpeed } : {}),
  ...(lighthouse ? { lighthouse } : {}),
  errors: all.filter(p => !p.html && (p.status >= 400 || p.status === 0)).map(p => ({ url: p.url, status: p.status })),
  pages: htmlPages.map(p => ({
    url: p.finalUrl,
    status: p.status,
    depth: p.depth ?? null,
    inSitemap: smSet.has(p.url),
    noindex: p.noindex,
    canonical: canonicalFor(p),
    title: p.title,
    description: p.description,
    ogTitle: p.ogTitle,
    ogImage: p.ogImage,
    h1Text: p.headings.find(h => h.level === 1)?.text ?? null,
    words: p.words,
    h1: p.h1Count,
    schema: p.types,
    schemaOther: p.schemaOther,
    schemaProps: p.schemaProps,
    linksOut: p.links.length,
    linksIn: inbound.get(p.finalUrl) || 0,
    h2s: p.headings
      .filter(h => h.level === 2)
      .map(h => h.text)
      .slice(0, 50),
    h3s: p.headings
      .filter(h => h.level === 3)
      .map(h => h.text)
      .slice(0, 50),
    ogDescription: p.ogDescription,
    ogUrl: p.ogUrl,
    hreflang: (p.hreflang || []).map(h => ({ lang: h.lang, href: h.href })),
  })),
};
mkdirSync(dirname(OUT), { recursive: true });
// File the previous seo-crawl.json in history/ before replacing it, so "Since last audit" still has it. Other --out
// names (a branch crawl, say) stay out of the history.
if (basename(OUT) === "seo-crawl.json" && existsSync(OUT))
  try {
    fileCrawl(join(dirname(OUT), "history"), OUT, JSON.parse(readFileSync(OUT, "utf8")));
  } catch (e) {
    console.log(`note: the previous ${OUT} couldn't be filed in history/ (${e.message})`);
  }
writeFileSync(OUT, JSON.stringify(report, null, 2));
const counts = out.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {});
console.log(
  `seo-crawl: ${htmlPages.length} HTML pages (${fetched} fetched), ${sm.entries.length} sitemap URLs, ${out.length} findings ` +
    JSON.stringify(counts) +
    `, ${passed.length} rules passed`,
);
for (const n of noteList) console.log("note: " + n);
console.log("wrote " + OUT);
