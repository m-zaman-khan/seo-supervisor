#!/usr/bin/env node
// @ts-check
// Read-only SEO crawler: GET and HEAD only, plus a TLS handshake with --check-live.
// Regex HTML parsing is enough for audit evidence. Swap in a real parser if a site breaks it.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileCrawl } from "./seo-diff.mjs";
import { RULES, CHECKS, RETIRED, KEPT, SHOP_FIELDS } from "./crawl/catalog.mjs";
import {
  TEMPORARY,
  clean,
  createFetcher,
  isLocal,
  isPublic,
  mapOrigin,
  pathKey,
  slashOnly,
  upTo,
  urlOr,
} from "./crawl/fetch.mjs";
import {
  CLIENT_ROUTER,
  FILE_EXT,
  NOSPACE,
  NOSPACE_RUN,
  ORG_RE,
  attrs,
  capsOf,
  ctx,
  decode,
  deepHas,
  jsonLdNodes,
  norm,
  stripNonContent,
  tagsOf,
  textOf,
  typesOf,
  wordsOf,
} from "./lib/html.mjs";
import {
  checkHreflang,
  linkHreflang,
  mergeHreflang,
  languageFeatures,
  checkLanguages,
  otherSiteTargets,
  linksBack,
} from "./checks/hreflang.mjs";
import { checkLive } from "./checks/tls.mjs";
import {
  checkSpeed,
  sampleUrls,
  PSI_ENDPOINT,
  speedTrend,
  CRUX_HISTORY_ENDPOINT,
  labLcpBreakdown,
} from "./checks/speed.mjs";
import { findBrowser, renderPage, compareRendered, changesHead, changesText, renderAll } from "./checks/render.mjs";
import { checkVisual, checkMore } from "./checks/visual.mjs";
import { checkLighthouse, findLighthouse, medianScores, ALL_CAP } from "./checks/lighthouse.mjs";
import { imageSize, imageMeta } from "./lib/image-size.mjs";
import { trustFeatures, trustSignals } from "./checks/trust.mjs";
import { agentFeatures, agentFiles, bingAiRules, BING_PREFS, VALUED } from "./checks/agents.mjs";
import { allowedBy, checkRobots, versionedNote, aiBotAccess, aiRobotRules } from "./checks/robots.mjs";
import { SITEMAP_KEEP, findSitemaps, checkSitemapFiles, checkSitemapEntries } from "./checks/sitemap.mjs";
import { analyze } from "./crawl/page.mjs";
import { createCrawler } from "./crawl/queue.mjs";
import { createFindings } from "./lib/findings.mjs";
import { writingText, writingFeatures } from "./checks/writing.mjs";
import { checkBusinessType, detectBusinessType } from "./checks/business-type.mjs";
import { cookieProblems, cspProblems, hstsRead, insecureResources, serverHoles } from "./checks/technical.mjs";
import { checkOutbound } from "./checks/outbound.mjs";
import { proxyNote, chromeProxyArgs } from "./lib/proxy.mjs";
import { estSaving } from "./images.mjs";
import { redact, hideSecrets } from "./lib/redact.mjs";
import { parseCsv } from "./lib/csv.mjs";
import { SUPERSEDED, placeholderIn, merchantProblems, sellsWithOffer, reviewEventProblems } from "./schema-check.mjs";
import { altProblem, lazySrc, hintsOf, domShape, cdnOf, uncached } from "./checks/media.mjs";
import {
  titleWidth,
  widthText,
  obsoleteMore,
  brandTail,
  templatedDescs,
  templatedShare,
  sectionOf,
  keywordUse,
  isGuide,
  newestDate,
} from "./checks/content.mjs";
import { localFeatures, judgeLocal } from "./checks/local.mjs";
import { ugcLinks, backTrap, paywallLeak, lateHead, identityDrift } from "./checks/page.mjs";
import { pageRank, scale as strengthScale } from "./checks/link-strength.mjs";
import { fragmentLinks, hasName, sleep, slowNote } from "./checks/crawl.mjs";
import {
  HIDDEN_MIN,
  PDF_PAGES,
  JS_CAPS,
  APP_FILES,
  analyticsTwice,
  secretsIn,
  maskKeys,
  hiddenLinks,
  appPromo,
  appFile,
} from "./checks/hygiene.mjs";
// keyword-ideas.mjs's own word rules, so the words file matches its searches exactly.
import { mainWords as pickMainWords } from "./keyword-ideas.mjs";
{
  const n = proxyNote();
  if (n) console.error("note: " + n);
} // once, before any request

// The site's local business (storefront, service-area or hybrid), judged once from every page when the address check
// or the site-wide block first asks.
let localJudged;
const localBusiness = () => (localJudged === undefined ? (localJudged = judgeLocal(htmlPages, shows)) : localJudged);

const VERSION = "2.0.0";
const UA = "seo-supervisor-crawler/" + VERSION;

// ---------- args ----------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const k = a.slice(2);
  const v = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  args[k] = v;
}
if (!args.url || args.url === true) {
  console.error(
    "Usage: node seo-crawl.mjs --url http://localhost:3000 [--site-origin https://example.com] [--trailing-slash auto|always|never] [--brand Name] [--ignore-noindex] [--banned regex] [--verify regex] [--urls file] [--next-manifest file] [--max 1000] [--concurrency 4] [--include-query] [--out seo-audit/seo-crawl.json]",
  );
  process.exit(2);
}
const START = new URL(args.url);
const START_ORIGIN = START.origin;
const MAX = Number(args.max || 1000);
const IGNORE_NOINDEX = !!args["ignore-noindex"];
const BANNED = typeof args.banned === "string" ? new RegExp(args.banned, "i") : null;
const VERIFY = typeof args.verify === "string" ? new RegExp(args.verify, "i") : null;
const URL_LIST = typeof args.urls === "string" ? args.urls : null;
const NEXT_MANIFEST = typeof args["next-manifest"] === "string" ? args["next-manifest"] : null;
const CONC = Math.max(1, Number(args.concurrency || 4));
const SLASH = ["always", "never"].includes(args["trailing-slash"]) ? args["trailing-slash"] : "auto";
const BRAND = typeof args.brand === "string" ? args.brand : "";
const INCLUDE_QUERY = !!args["include-query"];
const CHECK_LIVE = !!args["check-live"];
const OUTSIDE = !!args.outside; // nothing leaves the machine without it
const LIGHTHOUSE_ALL = args.lighthouse === "all" || !!args["lighthouse=all"]; // --lighthouse all, or --lighthouse=all
const LIGHTHOUSE = !!args.lighthouse || LIGHTHOUSE_ALL;
const RENDER_ALL = args.render === "all" || !!args["render=all"]; // with --outside: every indexable page, not the sample
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
const { findings, add, evaluated, evalRules } = createFindings(CHECKS, s => redact(maskKeys(s), { emails: false }));

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
const robotsRes = await follow(START_ORIGIN + "/robots.txt");
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
const sm = await findSitemaps(smUrls, smListed, { startOrigin: START_ORIGIN, notes, fetchSitemap, toCrawl });
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

// Probes: soft 404, slash variants, well-known files and security headers.
evalRules("CRAWL-05", "URL-02", "TRUST-01", "TRUST-02");
const probe = await follow(`${START_ORIGIN}/seo-supervisor-404-probe-${Date.now().toString(36)}`);
if (probe.status === 200)
  add(
    "soft-404",
    probe.chain[0].url,
    probe.chain.length > 1 ? `redirected to ${probe.finalUrl} (200)` : "returned 200",
  );
// llms.txt (MAP-07): a missing one is only low and never a ranking fix, as Google says it neither harms nor helps
// rankings. An HTML page there counts as missing; a file that exists has its format checked.
evalRules("MAP-07");
const llms = await get(START_ORIGIN + "/llms.txt", { manual: false });
if (llms.status !== 200 || /<html/i.test(llms.body || ""))
  add(
    "llms-txt-missing",
    START_ORIGIN + "/llms.txt",
    llms.status === 200 ? "returns an HTML page instead" : `status ${llms.status}`,
  );
else {
  const problems = [
    !/^# \S/.test(llms.body.replace(/^\uFEFF/, "").trimStart()) && "no # heading first",
    !/\[[^\]]+\]\([^)\s]+\)/.test(llms.body) && "no Markdown links",
  ].filter(Boolean);
  if (problems.length) add("llms-structure", START_ORIGIN + "/llms.txt", problems.join(", "));
}
// A Markdown response must vary on Accept so caches keep it apart from the HTML. AI-05 counts as checked only when
// the site serves Markdown; otherwise the code-level check decides it. mdHome saves the Markdown comparison a second
// fetch.
/** @type {string | null} */
let mdHome = null;
try {
  // The Markdown request isn't followed, so only the crawled URL's own answer counts.
  const md = await fetch(START.href, {
    redirect: "manual",
    headers: { "user-agent": UA, accept: "text/markdown" },
    signal: AbortSignal.timeout(15000),
  });
  if (/^text\/markdown/i.test(md.headers.get("content-type") || "")) evalRules("AI-05");
  const vary = (md.headers.get("vary") || "")
    .toLowerCase()
    .split(",")
    .map(v => v.trim()); // Accept-Encoding isn't Accept
  if (/^text\/markdown/i.test(md.headers.get("content-type") || "") && !vary.includes("accept") && !vary.includes("*"))
    add("markdown-no-vary", START.href, `Vary: ${md.headers.get("vary") || "(none)"}`);
  if (md.status === 200 && /^text\/markdown/i.test(md.headers.get("content-type") || "")) mdHome = await md.text();
  else await md.body?.cancel();
} catch {}
const sectxt = await get(START_ORIGIN + "/.well-known/security.txt", { manual: false });
if (sectxt.status !== 200 || /<html/i.test(sectxt.body || ""))
  add(
    "security-txt",
    START_ORIGIN + "/.well-known/security.txt",
    sectxt.status === 200 ? "returns an HTML page instead (soft 404)" : `status ${sectxt.status}`,
  );
if (home && home.headers) {
  const h = home.headers,
    missing = [];
  if (
    !CHECK_LIVE &&
    EXPECT_ORIGIN.startsWith("https") &&
    START_ORIGIN.startsWith("https") &&
    !h.get("strict-transport-security")
  )
    missing.push("Strict-Transport-Security");
  if (!h.get("x-content-type-options")) missing.push("X-Content-Type-Options");
  if (!h.get("referrer-policy")) missing.push("Referrer-Policy");
  if (!h.get("content-security-policy") && !h.get("content-security-policy-report-only"))
    missing.push("Content-Security-Policy");
  if (!h.get("x-frame-options") && !/frame-ancestors/i.test(h.get("content-security-policy") || ""))
    missing.push("X-Frame-Options or CSP frame-ancestors");
  for (const m of missing) add("sec-headers", home.finalUrl, m);
  if (isLocal(START_ORIGIN))
    notes.push("Security headers were read from a local server; production headers set by a CDN or proxy may differ.");
}

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

for (const p of all) {
  if (p.status >= 500 || p.status === 0) add("server-error", p.url, p.error || `status ${p.status}`);
  if (p.chain && p.chain.length > 2)
    add("redirect-chain", p.url, p.chain.map(c => `${c.status}`).join(" → ") + ` → ${p.finalUrl}`);
  const x = new URL(p.url);
  if (/[A-Z]/.test(x.pathname) || /_/.test(x.pathname) || /%20| /.test(x.pathname) || /\/\//.test(x.pathname))
    add("url-format", p.url);
}
for (const [u, e] of smSet) {
  const p = pages.get(u);
  if (!p) continue;
  if (p.status !== 200 || p.chain.length > 1)
    add("sitemap-bad-status", e.loc, p.chain.length > 1 ? `redirects to ${p.finalUrl}` : `status ${p.status}`);
  else if (p.html && p.noindex && !IGNORE_NOINDEX) add("noindex-in-sitemap", e.loc);
  if (robots && star && !allowedBy(star, new URL(u).pathname)) add("sitemap-url-disallowed", e.loc);
}

const titleMap = new Map(),
  descMap = new Map(),
  faqMap = new Map();
let checkedPages = 0;
const images = new Map(); // same-origin image URL -> first indexable page using it
const shareImages = new Map(); // og:image on the crawled site (crawl URL) -> { src, page }
const notChecked = [];
const noindexShare = htmlPages.length ? htmlPages.filter(p => p.noindex).length / htmlPages.length : 0;
if (IGNORE_NOINDEX)
  notes.push(
    "Ran with --ignore-noindex: noindex pages were checked as if indexable (pre-launch audit). Noindex findings were not raised.",
  );
else if (noindexShare > 0.5)
  notes.push(
    `${Math.round(noindexShare * 100)}% of pages are noindex. If the site is pre-launch, re-run with --ignore-noindex; per-page checks skipped those pages.`,
  );
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
// A basic missing on most pages is a site-wide blocker (the usual no-SEO site), reported once instead of per page.
const sitewide = (() => {
  const idx = htmlPages.filter(
    p => indexable(p) && !(p.words < 30 && p.h1Count === 0 && (p.emptyRoot || p.scripts > 0)),
  );
  const titles = new Map();
  for (const p of idx) if (p.title) titles.set(p.title, (titles.get(p.title) || 0) + 1);
  const [topTitle, topCount] = [...titles].sort((a, b) => b[1] - a[1])[0] || [];
  const defaultTitle = topCount >= 0.8 * idx.length ? topTitle : undefined;
  const hits = test => {
    const s = new Set(idx.filter(test));
    return s.size >= 3 && s.size >= 0.8 * idx.length ? s : new Set();
  };
  // A framework's starter title marks a site with no SEO work at any size, even a one-page site.
  const STARTER =
    /^(create next app|create react app|react app|vite \+ (react|vue|svelte|preact|lit|solid|ts)( \+ ts)?|vite app|nuxt( app)?|sveltekit( app)?|remix app|astro|welcome to (next\.js|remix|astro|nuxt)!?|gatsby (default )?starter|my gatsby site|angular ?app|document|untitled( document)?)$/i;
  const starter = new Set(idx.filter(p => !p.title || STARTER.test(p.title.trim())));
  const starterSitewide =
    idx.some(p => p.title && STARTER.test(p.title.trim())) && starter.size >= 0.8 * idx.length ? starter : null;
  return {
    title: starterSitewide || hits(p => !p.title || p.title === defaultTitle),
    h1: hits(p => p.h1Count === 0),
    canonical: hits(p => !p.canonicals.length),
  };
})();
// The site's own hosts, with or without www: on an HTTPS site an http:// link to them costs a redirect.
const bareHost = h => h.replace(/^www\./, "");
const ownHosts = new Set(
  EXPECT_ORIGIN.startsWith("https:")
    ? [EXPECT_ORIGIN, START_ORIGIN].filter(o => o.startsWith("https:")).map(o => bareHost(new URL(o).hostname))
    : [],
);
// Title words worth looking for: 4+ letters, not a stopword, not a brand word (one in most titles). Words in scripts
// written without spaces (Chinese, Japanese, Thai) can't be matched word by word, so they're left out.
const STOP = new Set(
  "about after also been before best does each free from have here home into just like many more most much near official online only over page site some such than that them then there these they this those very website welcome were what when where which while will with your".split(
    " ",
  ),
);
const titleWords = t => [
  ...new Set(
    norm(t)
      .split(" ")
      .filter(w => /^\p{L}{4,}$/u.test(w) && !NOSPACE.test(w) && !STOP.has(w)),
  ),
];
const brandWords = (() => {
  // every word, so a short one ("UK" in "Acme UK") is brand too
  const sets = htmlPages.filter(p => p.title && indexable(p)).map(p => new Set(norm(p.title).split(" "))),
    n = new Map();
  for (const s of sets) for (const w of s) n.set(w, (n.get(w) || 0) + 1);
  return new Set([...[...n].filter(([, c]) => c > sets.length / 2).map(([w]) => w), ...norm(BRAND).split(" ")]);
})();
// A title's capitalised words ("LPG") and the initials of 3+ words in a row, skipping and/of/the ("Heating,
// Ventilation and Air Conditioning" is hvac). Two letters ("IP") would match too much by chance.
const LINKING = new Set("a an and for in of on the to".split(" "));
const acronyms = t => {
  const w = norm(t)
      .split(" ")
      .filter(x => x && !LINKING.has(x) && !brandWords.has(x)),
    out = new Set([...capsOf(t)].filter(x => !brandWords.has(x)));
  for (let i = 0; i < w.length; i++)
    for (let j = i + 3; j <= w.length; j++)
      out.add(
        w
          .slice(i, j)
          .map(x => x[0])
          .join(""),
      );
  return out;
};
// "12 High Street" and "12 High St." both become "12 high st", and "Hauptstraße 5" becomes "hauptstr 5".
const STREET_WORDS = {
  street: "st",
  road: "rd",
  avenue: "ave",
  suite: "ste",
  apartment: "apt",
  boulevard: "blvd",
  drive: "dr",
  lane: "ln",
};
const streetForm = s =>
  norm(s)
    .replace(/stra(?:ß|ss)e\b/g, "str")
    .replace(/\b(?:street|road|avenue|suite|apartment|boulevard|drive|lane)\b/g, w => STREET_WORDS[w]);
// A phone matches on its last 7 digits in any grouping ("+44 113 496 0000" is shown by "(0113) 496-0000"). An address
// matches part by part, units included, so "12 High Road Suite 4" is shown by "Ste. 4, 12 High Rd".
const shows = (p, f) => {
  if (f.kind === "phone")
    return new RegExp(f.value.replace(/\D/g, "").slice(-7).split("").join(" ?") + "(?!\\d)").test(p.normText);
  const text = ` ${streetForm(p.normText)} `;
  return f.value
    .split(",")
    .flatMap(s => streetForm(s).split(/ (?=(?:ste|apt|unit|flat) )/))
    .filter(Boolean)
    .every(part => text.includes(` ${part} `));
};
for (const p of htmlPages) {
  const u = p.finalUrl;
  if (!IGNORE_NOINDEX) {
    if (isHome(p) && p.noindex) add("home-noindex", u);
    else if (p.noindex && !smSet.has(p.url)) add("noindex-review", u);
  }
  if (p.banned) add("banned-claim", u, `“${p.banned.match}” in: ${p.banned.snippet}`);
  if (p.unconfirmed) add("unconfirmed-claim", u, `“${p.unconfirmed.match}” in: ${p.unconfirmed.snippet}`);
  if (p.words < 30 && p.h1Count === 0 && (p.emptyRoot || p.scripts > 0)) {
    add("client-rendered", u, `${p.words} words in server HTML`);
    p.clientOnly = true;
    continue;
  }
  const says = rs => (rs.includes("noindex") ? "noindex" : rs.some(r => r === "index" || r === "all") ? "index" : null);
  if (says(p.metaRules) && says(p.headerRules) && says(p.metaRules) !== says(p.headerRules))
    add("robots-conflict", u, `meta: “${p.robotsMeta}” · header: “${p.xRobots}”`);
  if (p.noindex && !IGNORE_NOINDEX) {
    // Another page is another host or path; a trailing slash alone doesn't make one.
    const c = canonicalFor(p),
      to = c && urlOr(toCrawl(c)),
      at = new URL(u),
      bare = x => x.pathname.replace(/\/$/, "");
    if (to && (to.origin !== at.origin || bare(to) !== bare(at))) add("noindex-canonical", u, `→ ${c}`);
    continue;
  }

  if (sitewide.canonical.has(p)) add("canonical-missing-sitewide", u);
  else if (!p.canonicals.length) add("canonical-missing", u);
  else {
    if (p.canonicals.length > 1) add("canonical-multiple", u, p.canonicals.join(" | "));
    const c = urlOr(p.canonicals[0], p.base);
    if (!c) add("canonical-bad-target", u, `not a valid URL: ${p.canonicals[0]}`);
    else {
      if (c.search) add("canonical-query", u, c.href);
      if (c.origin !== EXPECT_ORIGIN) add("canonical-origin", u, c.href);
      if (!samePath(toCrawl(c.href), u)) add("canonical-not-self", u, `→ ${c.href}`);
      const t = pages.get(clean(toCrawl(c.href)));
      if (t && (t.status !== 200 || (t.chain && t.chain.length > 1)))
        add("canonical-bad-target", u, `${c.href} → ${t.chain && t.chain.length > 1 ? "redirect" : t.status}`);
    }
  }
  if (!indexable(p)) continue;
  checkedPages++;
  for (const q of p.faqQs) {
    const k = norm(q);
    if (k) (faqMap.get(k) || faqMap.set(k, { q, pages: [] }).get(k)).pages.push(u);
  }
  if (p.titleCount > 1) add("title-multiple", u, `${p.titleCount} <title> tags`);
  if (p.placeholder) add("placeholder-text", u, `“${p.placeholder}”`);
  if (p.hashLinks) add("href-hash", u, `${p.hashLinks} link(s)`);
  if (!p.lang) add("lang-missing", u);
  if (sitewide.title.has(p)) add("title-missing-sitewide", u, p.title ? `“${p.title}”` : undefined);
  else if (!p.title) add("title-missing", u);
  else {
    if (titleWidth(p.title) > 60)
      add("title-long", u, `${widthText(p.title)}: ${p.title}`); // CJK characters count as two
    else if (titleWidth(p.title) < 20) add("title-short", u, p.title);
    (titleMap.get(p.title) || titleMap.set(p.title, []).get(p.title)).push(u);
    if (BRAND && p.title.split(BRAND).length > 2) add("title-brand-twice", u, p.title);
  }
  // Errs towards not flagging: a word counts when its stem is on the page ("pricing" finds "prices"), an acronym when
  // the page shows it in capitals, and the H1 counts as page text.
  const tw = p.title ? titleWords(p.title).filter(w => !brandWords.has(w)) : [];
  if (tw.length >= 2 && p.words >= 50) {
    evalRules("META-09");
    const onPage = " " + p.normText;
    if (
      !tw.some(w => onPage.includes(" " + w.slice(0, Math.max(4, w.length - 3)))) &&
      ![...acronyms(p.title)].some(a => p.caps.has(a))
    )
      add("title-mismatch", u, `“${p.title}”: ${tw.join(", ")} aren't on the page`);
  }
  if (!p.description) add("desc-missing", u);
  else {
    if (p.description.length < 120 || p.description.length > 160)
      add("desc-length", u, `${p.description.length} chars`);
    (descMap.get(p.description) || descMap.set(p.description, []).get(p.description)).push(u);
  }
  // og:description is optional (https://ogp.me), but X falls back only to it and LinkedIn requires it. None says
  // whether the meta description stands in, so it's listed only when that's missing too, and only beside a missing
  // og:title or og:image: alone it's desc-missing's.
  const noOg = [!p.ogTitle && "og:title", !p.ogImage && "og:image"].filter(Boolean);
  if (noOg.length)
    add("og-missing", u, [...noOg, !p.ogDescription && !p.description && "og:description"].filter(Boolean).join(", "));
  // Without twitter:card, X shows at most the small summary card. A page with no share image gets og-missing instead.
  // From X's cards markup guide, archived 30 May 2025; X has since taken its card docs down.
  const card = p.twitterCard?.trim().toLowerCase();
  if (card && !["summary", "summary_large_image", "app", "player"].includes(card))
    add("twitter-card-invalid", u, `“${p.twitterCard}”`);
  if (p.ogImage) {
    if (!card) add("twitter-card-missing", u);
    if (!p.ogImageSized) add("og-image-no-size", u);
    const src = urlOr(p.ogImage, p.base),
      c = src && clean(toCrawl(src.href));
    if (c && new URL(c).origin === START_ORIGIN && !shareImages.has(c)) shareImages.set(c, { src: src.href, page: u });
  }
  if (sitewide.h1.has(p)) add("h1-missing-sitewide", u);
  else if (p.h1Count !== 1) add("h1-count", u, `${p.h1Count} H1s`);
  const skips = [];
  let prev = null;
  for (const h of p.headings) {
    if (prev !== null && h.level > prev + 1) skips.push(`H${prev} → H${h.level} (“${h.text.slice(0, 40)}”)`);
    prev = h.level;
  }
  if (skips.length) add("heading-skip", u, skips.slice(0, 3).join("; "));
  if (p.words < 150 && !(p.words < 30 && p.h1Count === 0)) add("thin-page", u, `${p.words} words`);
  const noAlt = p.imgs.filter(i => !("alt" in i)).length;
  if (noAlt) add("img-alt", u, `${noAlt} image(s)`);
  const noDim = p.imgs.filter(
    i => !(i.width && i.height) && i["data-nimg"] !== "fill" && !/position:\s*absolute/i.test(i.style || ""),
  ).length;
  if (noDim) add("img-dimensions", u, `${noDim} image(s)`);
  if (p.imgs[0] && ((p.imgs[0].loading || "").toLowerCase() === "lazy" || p.firstScriptLazy))
    add("lazy-lcp", u, p.imgs[0].src || "");
  // Counts stylesheets, not sizes: one or two are normal, six or more usually means plugin CSS loaded everywhere.
  const blocking = [
    p.blockingJs.length && `${p.blockingJs.length} script(s) without async or defer, e.g. ${p.blockingJs[0]}`,
    p.blockingCss >= 6 && `${p.blockingCss} stylesheets`,
  ].filter(Boolean);
  if (blocking.length) add("render-blocking", u, blocking.join("; "));
  if (p.bytes > 2 * 1024 * 1024) add("html-over-2mb", u, `${Math.round(p.bytes / 1024)} KB`);
  else if (p.bytes > 500 * 1024) add("html-size", u, `${Math.round(p.bytes / 1024)} KB`);
  if (p.elements > 1400) add("dom-size", u, `${p.elements.toLocaleString("en")} elements`);
  if (p.nosnippet) add("nosnippet", u);
  if (p.nofollow && !p.noindex)
    add(
      "page-nofollow",
      u,
      [p.robotsMeta && `meta: “${p.robotsMeta}”`, p.xRobots && `header: “${p.xRobots}”`].filter(Boolean).join(" · "),
    );
  const basics = [!p.doctype && "no doctype", !p.charset && "no charset", !p.viewport && "no mobile viewport"].filter(
    Boolean,
  );
  if (basics.length) add("doc-basics", u, basics.join(", "));
  if (p.charsetMismatch) add("charset-mismatch", u, p.charsetMismatch);
  if (p.refreshTo) add("meta-refresh", u, `→ ${p.refreshTo}`);
  evalRules("REND-10"); // only once a page was checked; PERF-10 waits for Chrome's own test
  if (p.obsolete.length) add("obsolete-tags", u, p.obsolete.map(t => `<${t}>`).join(", "));
  if (p.noStore) add("bfcache-no-store", u, `Cache-Control: ${p.headers.get("cache-control")}`);
  if (p.unload) add("bfcache-unload", u, p.unload);
  if (p.ogUrl && p.canonicals.length) {
    const og = urlOr(p.ogUrl, p.base)?.href,
      c = urlOr(p.canonicals[0], p.base)?.href;
    if (c && og !== c)
      add("og-url-mismatch", u, og ? `og:url ${og} · canonical ${c}` : `og:url isn't a valid URL: ${p.ogUrl}`);
  }
  const prod = test => p.products.find(test);
  let pr;
  if ((pr = prod(x => x.singleAggregate))) add("product-aggregate-offer", u, pr.name);
  if ((pr = prod(x => x.noShipping)))
    add("product-no-shipping", u, `${pr.name}: ${pr.noShipping} of ${pr.offers} offer(s)`);
  if ((pr = prod(x => x.noReturns)))
    add("product-no-returns", u, `${pr.name}: ${pr.noReturns} of ${pr.offers} offer(s)`);
  if (
    p.amounts.length &&
    (pr = prod(x => x.prices.length && !x.prices.some(v => p.amounts.some(a => Math.abs(a - v) < 0.005))))
  )
    add(
      "product-price-mismatch",
      u,
      `schema ${pr.prices.join(" / ")} · page shows ${p.amounts.slice(0, 3).join(", ")}`,
    );
  if (!p.largePreview) add("no-large-preview", u);
  for (const i of p.imgs) {
    try {
      const src = new URL(i.src, p.base);
      if (src.origin === new URL(u).origin && !images.has(src.href)) images.set(src.href, u);
    } catch {}
  }
  if (p.jsonldErrors.length) add("jsonld-invalid", u, p.jsonldErrors[0]);
  const allTypes = [...p.types, ...p.schemaOther]; // Google reads Microdata and RDFa too; only JSON-LD is validated here
  if (!allTypes.length) add("jsonld-none", u);
  else if (!p.types.length) add("schema-not-jsonld", u, p.schemaOther.join(", "));
  if (!isHome(p) && !allTypes.includes("BreadcrumbList")) add("breadcrumb-missing", u);
  if (p.deprecated.length) add("deprecated-schema", u, p.deprecated.join(", "));
  if (p.hasRating) add("rating-review", u);
  if (p.nap.length) evalRules("LOCAL-05");
  // A service-area business may hide its street address (LOCAL-06), so it isn't asked to show it.
  const napGone = p.nap.filter(
    f =>
      ![p, home?.html && home].some(r => r && shows(r, f)) &&
      !(f.kind === "street address" && localBusiness()?.kind === "service-area"),
  );
  if (napGone.length)
    add(
      "nap-not-shown",
      u,
      `${napGone.map(f => `${f.kind} “${f.value}”`).join(" and ")} ${napGone.length > 1 ? "aren't" : "isn't"} shown on this page or the home page`,
    );
  const missingQ = p.faqQs.filter(q => !p.normText.includes(norm(q)));
  if (missingQ.length)
    add("faq-not-visible", u, `${missingQ.length} of ${p.faqQs.length}: “${missingQ[0].slice(0, 60)}”`);
  if (p.links.length > 150) add("too-many-links", u, `${p.links.length} links`);
  const generic = p.links.filter(l =>
    /^(click here|here|read more|learn more|more|this|link|details)$/i.test(l.text.trim()),
  ).length;
  if (generic) add("generic-anchor", u, `${generic} link(s)`);
  if (p.emptyLinks.length) add("link-no-text", u, `${p.emptyLinks.length} link(s), e.g. ${p.emptyLinks[0]}`);
  const insecure = p.anchors
    .map(l => l.href)
    .filter(h => /^http:\/\//i.test(h || "") && ownHosts.has(bareHost(urlOr(h)?.hostname || "")));
  if (insecure.length) add("link-http", u, `${insecure.length} link(s), e.g. ${insecure[0]}`);
  if (smSet.size && !smSet.has(p.url) && !smSet.has(u)) add("missing-from-sitemap", u);
  for (const b of p.crumbs.slice(0, -1)) {
    const t = pages.get(clean(toCrawl(b)));
    if (t && t.status !== 200) add("breadcrumb-dead-level", u, `${b} → ${t.status}`);
  }
}
// A retired type worth keeping gets one note for the site, not a finding.
for (const r of KEPT) {
  const at = htmlPages.filter(p => p.kept.includes(r.type));
  if (at.length)
    notes.push(
      `${r.type} on ${at.length} page(s), e.g. ${at[0].finalUrl}: Google retired ${r.feature} in ${r.since.slice(0, 4)}, but keep it: ${r.note}.`,
    );
}
// Near-duplicate main content: sets of 5-word chunks compared by Dice similarity.
{
  const cand = htmlPages.filter(p => p.shingles && !p.clientOnly && indexable(p)).slice(0, 400);
  for (let i = 0; i < cand.length; i++)
    for (let j = i + 1; j < cand.length; j++) {
      const a = cand[i].shingles,
        b = cand[j].shingles;
      const [small, big] = a.size < b.size ? [a, b] : [b, a];
      if (small.size / big.size < 0.4) continue;
      let inter = 0;
      for (const x of small) if (big.has(x)) inter++;
      const dice = (2 * inter) / (a.size + b.size);
      if (dice > 0.6)
        add("near-duplicate", cand[i].finalUrl, `${Math.round(dice * 100)}% shared with ${cand[j].finalUrl}`);
    }
  if (htmlPages.filter(p => p.shingles).length > 400)
    notes.push("Near-duplicate check compared the first 400 indexable pages only.");
}
for (const { q, pages: ps } of faqMap.values())
  if (ps.length > 1) add("faq-reused", ps[0], `“${q.slice(0, 70)}” on ${ps.length} pages`);
const PER_PAGE_RULES = [
  "AI-01",
  "REND-08",
  "URL-04",
  "META-01",
  "META-02",
  "META-04",
  "META-05",
  "CONTENT-01",
  "CONTENT-02",
  "CONTENT-04",
  "CONTENT-05",
  "CONTENT-08",
  "CONTENT-09",
  "REND-04",
  "SCHEMA-01",
  "SCHEMA-03",
  "SCHEMA-04",
  "SCHEMA-05",
  "SCHEMA-07",
  "MAP-03",
  "LINK-05",
  "LINK-06",
  "PERF-03",
  "PERF-04",
  "PERF-06",
  "REND-09",
  "MEDIA-03",
  "PERF-08",
];
if (checkedPages === 0)
  for (const r of PER_PAGE_RULES)
    if (evaluated.delete(r))
      notChecked.push({
        rule: r,
        area: `${r} ${RULES[r][0]}`,
        reason:
          "No indexable pages were checked (all noindex, non-canonical or failed). For a pre-launch site, re-run with --ignore-noindex.",
      });
for (const [t, us] of titleMap) if (us.length > 1) for (const u of us) add("title-dup", u, t);
for (const [d, us] of descMap) if (us.length > 1) for (const u of us) add("desc-dup", u, d.slice(0, 80));
if (htmlPages.some(p => p.products?.length)) evalRules("SHOP-05");
evalRules("META-08");
checkHreflang(htmlPages, {
  add,
  canonicalFor,
  statusOf: href => pages.get(clean(toCrawl(href)))?.status,
  origin: EXPECT_ORIGIN,
});
// Image weight, format and pixel size from the first 64 KB of each. Only on-site images are read, so no third party
// is contacted, even through a page that redirected off the site. Runs before the Googlebot test; extra.images reuses
// the rows, so each image is asked once.
const onSiteImages = [...images].filter(([src]) => new URL(src).origin === START_ORIGIN),
  imageList = onSiteImages.slice(0, 50);
const imageRows = [];
const imageInfo = new Map(); // caching, CDN and creator data per weighed image
let weighed = 0; // PERF-08 counts as checked only once an image is weighed
for (let i = 0; i < imageList.length; i += CONC)
  await Promise.all(
    imageList.slice(i, i + CONC).map(async ([src, page]) => {
      const r = await firstBytes(src);
      if (!r || r.status < 200 || r.status > 299 || !r.size) return;
      weighed++;
      const { size } = r,
        type = r.type.split(";")[0].trim().toLowerCase(),
        px = imageSize(r.bytes),
        kb = Math.round(size / 1024);
      imageInfo.set(src, { uncached: uncached(r.headers), cdn: cdnOf(r.headers), ...imageMeta(r.bytes) });
      // 500 KB is a local threshold, not Google's; that finding replaces heavy-image rather than adding to it.
      if (size > 500 * 1024) add("image-over-500kb", page, `${src} · ${kb} KB`);
      else if (size > 200 * 1024) add("heavy-image", page, `${src} · ${kb} KB`);
      if (/^image\/(jpeg|png)$/.test(type) && size > 100 * 1024)
        add("legacy-image-format", page, `${src} · ${type} · ${kb} KB`);
      imageRows.push({
        url: src,
        bytes: size,
        width: px?.width ?? null,
        height: px?.height ?? null,
        format: px?.type || type.match(/^image\/([a-z0-9.-]+)/)?.[1] || null,
      });
    }),
  );
if (weighed) evalRules("PERF-08");
if (onSiteImages.length > 50) notes.push(`Image weight was checked for the first 50 of ${onSiteImages.length} images.`);
// Share images: the first 64 KB of up to 20 on-site og:images, enough for the pixel size.
const shareList = [...shareImages].slice(0, 20);
let shareRead = 0,
  shareAway = 0;
for (let i = 0; i < shareList.length; i += CONC)
  await Promise.all(
    shareList.slice(i, i + CONC).map(async ([crawlSrc, { src, page }]) => {
      const r = await firstBytes(crawlSrc);
      if (!r) {
        shareAway++;
        return;
      } // a redirect off the crawled site, which isn't fetched
      if (r.status !== 200 && r.status !== 206)
        return add("og-image-broken", page, `${src} → ${r.status || `no response (${r.error})`}`);
      const size = imageSize(r.bytes);
      if (!size) {
        if (/html/.test(r.type)) add("og-image-broken", page, `${src} → an HTML page, not an image`);
        return;
      } // SVG, AVIF: size unknown
      shareRead++;
      if (size.width < 1200) add("og-image-small", page, `${src} · ${size.width}×${size.height} px`);
    }),
  );
if (shareAway)
  notes.push(
    `${shareAway} share image(s) (og:image) redirect away from the crawled site (often to the public origin), so they couldn't be read and their size wasn't checked.`,
  );
if (shareImages.size && !shareRead)
  notes.push("No share image (og:image) could be read, so share image sizes weren't checked.");
if (shareImages.size > 20)
  notes.push(`Share image size was checked for the first 20 of ${shareImages.size} og:images.`);
// Product schema images: the first 64 KB of up to 20 on-site ones. Google recommends at least 50,000 pixels (width ×
// height) for merchant listing images; only a size actually read counts.
// https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
const productImgs = new Map(); // crawl URL -> { src, page }
for (const p of htmlPages)
  if (indexable(p))
    for (const s of p.productImages || []) {
      const src = urlOr(s, p.finalUrl),
        c = src && clean(toCrawl(src.href));
      if (c && new URL(c).origin === START_ORIGIN && !productImgs.has(c))
        productImgs.set(c, { src: src.href, page: p.finalUrl });
    }
const productList = [...productImgs].slice(0, 20);
let productRead = 0;
for (let i = 0; i < productList.length; i += CONC)
  await Promise.all(
    productList.slice(i, i + CONC).map(async ([crawlSrc, { src, page }]) => {
      const r = await firstBytes(crawlSrc),
        size = r && (r.status === 200 || r.status === 206) ? imageSize(r.bytes) : null;
      if (!size) return; // off the site, broken, SVG or AVIF: not measured
      productRead++;
      const px = size.width * size.height;
      if (px < 50000)
        add(
          "product-image-small",
          page,
          `${src} · ${size.width}×${size.height} px (${px.toLocaleString("en")} pixels)`,
        );
    }),
  );
if (htmlPages.some(p => indexable(p) && p.productImages?.length) && !productRead)
  notes.push(
    "No Product schema image on the crawled site could be read (they're on another host, missing, or SVG or AVIF), so product image sizes weren't checked.",
  );
if (productImgs.size > 20)
  notes.push(`Product image size was checked for the first 20 of ${productImgs.size} Product schema images.`);
if (home && home.html) {
  if (![...home.types, ...home.schemaOther].some(t => ORG_RE.test(t))) add("org-missing", home.finalUrl);
  if (![...home.types, ...home.schemaOther].includes("WebSite")) add("website-missing", home.finalUrl);
}
// Favicon (META-10): the home page's icon links, then /favicon.ico, read only on the crawled site. Google wants a
// square favicon of 48 px or more in BMP, GIF, ICO, PNG, JPEG, PPM or TIFF; a type whose size can't be read (BMP,
// TIFF) passes.
// https://developers.google.com/search/docs/appearance/favicon-in-search
if (home && home.html) {
  const onSite = c => !!c && new URL(c).origin === START_ORIGIN;
  const declared = [...new Set(home.icons.map(h => urlOr(h, home.base)?.href).filter(Boolean))],
    away = declared.some(d => !onSite(clean(toCrawl(d))));
  const tried = await Promise.all(
    [...new Set([...declared.map(d => clean(toCrawl(d))).filter(onSite), START_ORIGIN + "/favicon.ico"])]
      .slice(0, 5)
      .map(async c => ({ path: new URL(c).pathname, r: await firstBytes(c) })),
  );
  const loaded = tried.filter(
    t => t.r && (t.r.status === 200 || t.r.status === 206) && t.r.bytes.length && !/html/i.test(t.r.type),
  );
  const svg = t => /svg/i.test(t.r.type) || /^\s*(<\?xml|<svg)/i.test(t.r.bytes.toString("latin1", 0, 100)),
    size = t => imageSize(t.r.bytes);
  const good = t => {
    const s = size(t);
    return s ? s.type !== "webp" && s.width === s.height && s.width >= 48 : !svg(t) && /^image\//i.test(t.r.type);
  };
  const say = t => {
    const s = size(t);
    return `${t.path}: ${s ? `${s.width}×${s.height} px${s.type === "webp" ? ", WebP" : ""}` : svg(t) ? "SVG" : t.r.type || "unknown type"}`;
  };
  const status = t => (t.r.status === 200 ? "an HTML page" : t.r.status || `no response (${t.r.error})`);
  // An icon that redirects off the site (to a CDN or the public origin) isn't followed, so it can't be judged.
  const movedAway = tried.find(t => !t.r);
  if (loaded.some(good)) evalRules("META-10");
  else if (away || movedAway)
    notChecked.push({
      rule: "META-10",
      area: `META-10 ${RULES["META-10"][0]}`,
      reason: away
        ? "The home page's icon is on another host (often a CDN), and only the crawled site is fetched."
        : `${movedAway.path} redirects away from the crawled site (often to a CDN), and only the crawled site is fetched.`,
    });
  else {
    evalRules("META-10");
    if (loaded.length) add("favicon-unsuitable", home.finalUrl, loaded.map(say).join("; "));
    else
      add(
        "favicon-missing",
        home.finalUrl,
        (declared.length ? "" : "no icon link on the home page, and ") +
          tried.map(t => `${t.path} → ${status(t)}`).join("; "),
      );
  }
}
// Next-page preloading: one site-wide suggestion, only when there's a next page to load. A single-page app's server
// HTML shows neither its links nor the router that loads them, so it can't be judged.
if (htmlPages.length > 1) {
  if (htmlPages.some(p => p.preloads)) evalRules("PERF-09");
  else if (htmlPages.filter(p => p.clientOnly).length > htmlPages.length / 2)
    notChecked.push({
      rule: "PERF-09",
      area: `PERF-09 ${RULES["PERF-09"][0]}`,
      reason:
        "Most pages are built in the browser (a single-page app), so the server HTML shows neither their links nor the router that loads them. A single-page app's router usually loads the next page itself.",
    });
  else {
    evalRules("PERF-09");
    add("no-speculation-rules", (home?.html ? home : htmlPages[0]).finalUrl, `none of ${htmlPages.length} pages`);
  }
}
// Links: broken, through redirects, inbound counts and depth.
const inbound = new Map(),
  bodyInbound = new Map(),
  brokenSeen = new Set(),
  redirSeen = new Set();
for (const p of htmlPages)
  for (const l of p.mainLinks || []) {
    const fin = finalOf(l);
    if (fin !== p.finalUrl) bodyInbound.set(fin, (bodyInbound.get(fin) || 0) + 1);
  }
for (const p of htmlPages)
  for (const l of p.links) {
    const t = pages.get(l.url);
    const fin = finalOf(l.url);
    if (fin !== p.finalUrl) inbound.set(fin, (inbound.get(fin) || 0) + 1);
    if (!t) continue;
    if ((t.status >= 400 || t.status === 0) && !brokenSeen.has(l.url)) {
      brokenSeen.add(l.url);
      add("broken-internal-link", l.url, `status ${t.status}, linked from ${p.finalUrl}`);
    } else if (t.chain && t.chain.length > 1 && !redirSeen.has(l.url)) {
      redirSeen.add(l.url);
      add("link-to-redirect", l.url, `→ ${t.finalUrl} (linked from ${p.finalUrl})`);
    }
  }
for (const [u, e] of smSet) {
  const p = pages.get(u);
  if (!p || !p.html || isHome(p)) continue;
  if (!bodyInbound.get(p.finalUrl))
    add(
      "orphan",
      e.loc,
      inbound.get(p.finalUrl) ? `only nav/footer links (${inbound.get(p.finalUrl)})` : "no links at all",
    );
}
if (home && home.html) {
  const depth = new Map([[home.finalUrl, 0]]);
  const q = [home.finalUrl];
  while (q.length) {
    const cur = q.shift();
    const p = byFinal.get(cur);
    if (!p || !p.links) continue;
    for (const l of p.links) {
      const f = finalOf(l.url);
      if (!depth.has(f)) {
        depth.set(f, depth.get(cur) + 1);
        q.push(f);
      }
    }
  }
  for (const p of htmlPages) {
    const d = depth.get(p.finalUrl);
    if (d > 3 && indexable(p)) add("deep-page", p.finalUrl, `${d} clicks`);
    if (d === undefined) p.depth = null;
    else p.depth = d;
  }
}
// Trailing-slash style.
const styled = htmlPages.filter(p => p.status === 200 && !isHome(p) && !FILE_EXT.test(new URL(p.finalUrl).pathname));
const withS = styled.filter(p => new URL(p.finalUrl).pathname.endsWith("/")),
  withoutS = styled.filter(p => !new URL(p.finalUrl).pathname.endsWith("/"));
let style = SLASH;
if (SLASH === "auto") style = withS.length >= withoutS.length ? "always" : "never";
const off = style === "always" ? withoutS : withS;
if (SLASH !== "auto" || (withS.length && withoutS.length))
  for (const p of off)
    add(
      "trailing-slash-mixed",
      p.finalUrl,
      `expected ${style === "always" ? "a trailing slash" : "no trailing slash"}`,
    );
const slashTemp = [];
for (const p of styled.slice(0, 5)) {
  const x = new URL(p.finalUrl);
  x.pathname = x.pathname.endsWith("/") ? x.pathname.slice(0, -1) : x.pathname + "/";
  const r = await get(x.href);
  if (r.status === 200) add("slash-variant-no-redirect", x.href, `and ${p.finalUrl} both return 200`);
  else if (TEMPORARY.has(r.status) && urlOr(r.location || "", x.href)?.pathname === new URL(p.finalUrl).pathname)
    slashTemp.push([x.href, `${r.status} → ${p.finalUrl}`]);
}
// Dev servers often add the slash with a 302 (http-server does) where production doesn't, so locally it's a note.
if (slashTemp.length && isLocal(START_ORIGIN))
  notes.push(
    `The local server adds or drops the trailing slash with a temporary redirect (${slashTemp[0][0]}: ${slashTemp[0][1]}). Development servers often do; check that production uses a 301 or 308.`,
  );
else for (const [u, detail] of slashTemp) add("slash-redirect-temporary", u, detail);

// ---------- old URLs / redirect sources ----------
const redirectSources = [];
if (URL_LIST) {
  try {
    const raw = readFileSync(URL_LIST, "utf8");
    let items;
    try {
      const j = JSON.parse(raw);
      items = Array.isArray(j) ? j.map(x => (typeof x === "string" ? x : x.source || x.url || x.from)) : Object.keys(j);
    } catch {
      items = raw
        .split(/\r?\n/)
        .map(l => l.split(",")[0].trim().replace(/^"|"$/g, ""))
        .filter(l => l && !l.startsWith("#") && !/^(url|source|from)$/i.test(l));
    }
    redirectSources.push(...items.filter(Boolean));
  } catch (e) {
    notes.push("Could not read --urls: " + e.message);
  }
}
if (NEXT_MANIFEST) {
  try {
    const m = JSON.parse(readFileSync(NEXT_MANIFEST, "utf8"));
    for (const r of m.redirects || [])
      if (!r.internal && r.source && !/[:(*]/.test(r.source)) redirectSources.push(r.source);
  } catch (e) {
    notes.push("Could not read --next-manifest: " + e.message);
  }
}
if (redirectSources.length) {
  evalRules("URL-07");
  const seenR = new Set(),
    list = [];
  for (const src of redirectSources) {
    let x;
    try {
      x = new URL(src, START_ORIGIN);
    } catch {
      continue;
    }
    const p0 = x.pathname,
      alt = p0 === "/" ? p0 : p0.endsWith("/") ? p0.slice(0, -1) : p0 + "/";
    for (const path of [p0, alt]) {
      const full = START_ORIGIN + path + x.search;
      if (!seenR.has(full)) {
        seenR.add(full);
        list.push(full);
      }
    }
  }
  for (const u of list.slice(0, 2000)) {
    const r = await follow(u);
    // Kept with the crawl's records so the report lists it; links-import.mjs and seo-diff.mjs read it from there.
    if (!pages.has(u))
      all.push({ url: u, status: r.status, finalUrl: r.finalUrl, chain: r.chain, error: r.error || null });
    const trail = r.chain.map(c => c.status).join(" → ") + ` → ${r.finalUrl}`;
    if (r.status >= 400 || r.status === 0) add("redirect-broken", u, trail + (r.error ? ` (${r.error})` : ""));
    else {
      if (r.chain.length > 2) add("redirect-chain", u, trail);
      if (r.chain.some((c, i) => TEMPORARY.has(c.status) && !slashOnly(c.url, r.chain[i + 1]?.url ?? r.finalUrl)))
        add("old-url-temporary", u, trail);
    }
  }
  notes.push(`Tested ${Math.min(list.length, 2000)} old/redirect URLs, each with and without a trailing slash.`);
}

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
const browser = OUTSIDE ? findBrowser() : null;
const renderSample = sampleUrls(htmlPages.filter(p => indexable(p) && !p.refreshTo).map(p => p.finalUrl)); // a meta refresh would render its target
// --render all: every page meant to rank (as Lighthouse's all mode takes them), capped, after the time estimate.
const renderEvery =
  browser && RENDER_ALL
    ? renderAll([...new Set(htmlPages.filter(p => indexable(p) && !p.refreshTo).map(p => p.finalUrl))], {
        log: console.log,
      })
    : null;
const renderList = renderEvery?.urls || renderSample;
let renderFailure = null;
if (browser) {
  let rendered = 0;
  for (const u of renderList) {
    try {
      const [rawRes, dom] = await Promise.all([get(u, { manual: false }), renderPage(browser, u)]);
      if (rawRes.status !== 200 || !rawRes.body) {
        renderFailure ||= `the raw HTML of ${u} couldn't be fetched again`;
        continue;
      }
      rendered++;
      const d = compareRendered(rawRes.body, dom),
        say = x => `${x.field}: “${x.raw ?? "none"}” → “${x.rendered ?? "none"}”`;
      const head = d.filter(changesHead),
        text = d.filter(changesText),
        body = d.filter(x => !head.includes(x) && !text.includes(x));
      if (head.length) add("render-changes-head", u, head.map(say).join("; "));
      if (text.length) add("render-changes-text", u, text.map(say).join("; "));
      if (body.length) add("render-adds-content", u, body.map(say).join("; "));
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
if (browser) {
  const v = /** @type {{ checked: number, lab: any[], notes: string[], bfTested?: number }} */ (
    await checkVisual(browser, renderSample, { add, screenshotDir: resolve(dirname(OUT), "screenshots") }).catch(e => ({
      checked: 0,
      lab: [],
      notes: [`the browser didn't start: ${String(e.message).split("\n")[0].slice(0, 160)}`],
    }))
  );
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

// ---------- what Googlebot gets ----------
// The last requests to the site, since a firewall may ban the address that sent a fake Googlebot. Only the crawled
// site is asked: the home page and up to 9 sample pages. A local build shows the app's own bot switches (prerender
// middleware, bot detection); a CDN or firewall shows up only when a staging or live server is crawled. Each page is
// asked at the same time by the same phone without the Googlebot token, so a site that serves phones differently
// serves both alike. A 429 or 5xx is asked once more a second later, so a rate limit or flaky backend hitting one side
// isn't judged.
// Google's smartphone Googlebot, with a current Chrome version.
// https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
const GOOGLEBOT_UA =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.8103.79 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const PHONE_UA = GOOGLEBOT_UA.replace(/ \(compatible; Googlebot.*$/, "");
const pageOf = r =>
  r.status === 200 && /html/.test(r.ct) && r.body ? analyze(r.finalUrl, r.body, r.headers, undefined, page) : null;
const canonOf = (p, base) => (p.canonicals[0] ? (urlOr(p.canonicals[0], base)?.href ?? p.canonicals[0]) : "none");
// A bot challenge: Cloudflare sets cf-mitigated and loads its challenge platform, AWS WAF sets x-amzn-waf-action.
// https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/
// https://docs.aws.amazon.com/waf/latest/developerguide/waf-captcha-and-challenge-actions.html
const challenged = r =>
  /^challenge$/i.test(r.headers.get("cf-mitigated") || "") ||
  /^(challenge|captcha)$/i.test(r.headers.get("x-amzn-waf-action") || "") ||
  /\/cdn-cgi\/challenge-platform\//.test(r.body || "");
// A local build (localhost or a private address) has no CDN or firewall in front, so a refusal there is the app's own.
const NO_FIREWALL = isLocal(START_ORIGIN) || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(START.hostname);
const busy = r => r.status === 429 || r.status >= 500;
const askAgain = async (u, ua) => {
  await sleep(1000);
  return follow(u, ua);
};
const botSample = sampleUrls(htmlPages.map(p => p.url));
let botCompared = 0;
for (let i = 0; i < botSample.length; i += CONC)
  await Promise.all(
    botSample.slice(i, i + CONC).map(async u => {
      let [vr, gr] = await Promise.all([follow(u, PHONE_UA), follow(u, GOOGLEBOT_UA)]);
      if (busy(vr)) vr = await askAgain(u, PHONE_UA);
      const v = pageOf(vr),
        at = vr.finalUrl;
      if (!v) return; // a visitor doesn't get the page now either: nothing to compare
      if (busy(gr)) gr = await askAgain(u, GOOGLEBOT_UA);
      const g = pageOf(gr),
        challenge = challenged(gr) && !challenged(vr);
      botCompared++;
      const got = `Googlebot got ${challenge ? `a bot challenge (${gr.status})` : gr.status || `no answer (${gr.error})`}, a visitor 200`;
      // A firewall that verifies Googlebot by IP is right to refuse this request.
      if ((challenge || [403, 429, 503].includes(gr.status)) && !NO_FIREWALL) return add("googlebot-firewall", at, got);
      if (gr.status >= 400 || gr.status === 0 || challenge) return add("googlebot-blocked", at, got);
      if (g?.noindex && !v.noindex)
        return add("googlebot-blocked", at, "Googlebot gets a noindex that a visitor doesn't");
      const diffs = !g
        ? [`Googlebot got ${gr.status} ${gr.ct || "with no content type"} instead of the page`]
        : [
            gr.finalUrl !== at && `Googlebot is sent to ${gr.finalUrl}`,
            v.noindex && !g.noindex && "only a visitor gets noindex",
            canonOf(g, gr.finalUrl) !== canonOf(v, at) && `canonical: ${canonOf(v, at)} → ${canonOf(g, gr.finalUrl)}`,
            (g.title ?? "") !== (v.title ?? "") && `title: “${v.title ?? "none"}” → “${g.title ?? "none"}”`,
            v.words >= 50 && g.words < v.words / 2 && `${g.words} words for Googlebot, ${v.words} for a visitor`,
          ].filter(Boolean);
      if (diffs.length) add("googlebot-differs", at, diffs.join("; "));
    }),
  );

// ---------- site-wide checks and data; data for the report goes on `extra` ----------
const extra = {};

// Unnamed controls (AI-05 counts as checked once a page has a control), plus WebMCP tools, agent files and writing
// notes for the report; writing notes for the 50 pages with the most.
{
  const tools = [],
    writingNotes = [];
  for (const p of htmlPages) {
    if (!p.agent || !indexable(p) || p.clientOnly) continue;
    const { unnamedFields: f, unnamedButtons: b, webmcpTools, controls } = p.agent;
    if (controls) evalRules("AI-05");
    if (f.length || b.length)
      add(
        "controls-no-name",
        p.finalUrl,
        `${[f.length && `${f.length} field(s)`, b.length && `${b.length} button(s)`].filter(Boolean).join(" and ")}, e.g. \`${f[0] || b[0]}\``,
      );
    if (webmcpTools.length) tools.push({ url: p.finalUrl, tools: webmcpTools });
    const w = p.writing,
      count = w.longSentences + w.longParagraphs + w.stockPhrases.length;
    if (count) writingNotes.push({ url: p.finalUrl, ...w, count });
  }
  writingNotes.sort((a, b) => b.count - a.count || (a.url < b.url ? -1 : 1));
  if (writingNotes.length > 50)
    notes.push(`Writing notes list the 50 pages with the most notes, of ${writingNotes.length}.`);
  const files = await agentFiles(
    u =>
      fetch(u, {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "application/json,*/*;q=0.8" },
        signal: AbortSignal.timeout(15000),
      }),
    START_ORIGIN,
  );
  extra.agents = { pages: tools.slice(0, 50), ...files };
  extra.writingNotes = writingNotes.slice(0, 50).map(({ count, ...n }) => n);
}

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

// On the pages the per-page checks read: unencoded links, wide images without srcset, images far down loaded at once,
// repeated head tags and number-only headings.
for (const p of htmlPages) {
  if (p.clientOnly || !indexable(p)) continue;
  const u = p.finalUrl;
  if (p.unencoded.length)
    add("url-unencoded", u, `${p.unencoded.length} link(s), e.g. ${p.unencoded.slice(0, 3).join(", ")}`);
  if (p.wideImgs.length)
    add("img-no-srcset", u, `${p.wideImgs.length} image(s) over 1,000 px wide, e.g. ${p.wideImgs[0]}`);
  if (p.eagerLate.length)
    add("img-not-lazy", u, `${p.eagerLate.length} image(s) from the 11th on, e.g. ${p.eagerLate[0]}`);
  if (p.dupHead.length) add("duplicate-head-tags", u, p.dupHead.join(", "));
  if (p.numberHeadings.length) add("heading-only-number", u, p.numberHeadings.slice(0, 3).join("; "));
}
// Security (TRUST-01): cookies in Set-Cookie headers on HTML pages, each name once (cookies scripts set aren't seen),
// the home page's HSTS max-age (a year is the preload list's minimum), and Referrer-Policy: unsafe-url in the header
// or the meta tag. In the header the last valid value wins.
// https://hstspreload.org
// https://www.w3.org/TR/referrer-policy/#parse-referrer-policy-from-header
// Load balancer and CDN cookies are skipped, since the site can't change their flags: AWS ALB and ELB stickiness,
// Azure App Service's ARRAffinity, F5 BIG-IP's BIGipServer<pool>, and Cloudflare's own.
// https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/
const INFRA_COOKIE =
  /^(AWSALB(TG)?(CORS)?|AWSALBAPP-\d+|AWSELB|ARRAffinity(SameSite)?|BIGipServer.*|__cf\w+|_cfuvid|cf_clearance|cf_ob_info|cf_use_ob|cf_chl_\w+)$/;
const cookieSeen = new Set();
for (const p of htmlPages)
  for (const c of p.headers.getSetCookie()) {
    const name = c.split(";")[0].split("=")[0].trim();
    if (cookieSeen.has(name) || INFRA_COOKIE.test(name)) continue;
    cookieSeen.add(name);
    const problems = cookieProblems(c, { https: p.finalUrl.startsWith("https:") });
    if (problems.length) add("cookie-flags", p.finalUrl, `“${name}”: ${problems.join(", ")}`);
  }
// A header browsers ignore is hsts-invalid and nothing else. https://www.rfc-editor.org/rfc/rfc6797#section-8.1
const stsHeader = home?.headers?.get("strict-transport-security") || "",
  maxAge = hstsRead(stsHeader)?.invalid ? null : /max-age\s*=\s*"?(\d+)/i.exec(stsHeader)?.[1];
if (maxAge != null && +maxAge < 31536000) {
  const d = Math.round(+maxAge / 86400);
  add(
    "hsts-short",
    home.finalUrl,
    `max-age=${maxAge} (${+maxAge < 86400 ? "under a day" : `${d} day${d === 1 ? "" : "s"}`})`,
  );
}
const POLICIES = new Set([
  "no-referrer",
  "no-referrer-when-downgrade",
  "same-origin",
  "origin",
  "strict-origin",
  "origin-when-cross-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
]);
const policyOf = v =>
  (v || "")
    .split(",")
    .map(t => t.trim().toLowerCase())
    .filter(t => POLICIES.has(t))
    .at(-1);
for (const p of htmlPages) {
  const header = p.headers.get("referrer-policy");
  const unsafe = [
    policyOf(header) === "unsafe-url" && `header: ${header}`,
    policyOf(p.referrerMeta) === "unsafe-url" && `meta: ${p.referrerMeta}`,
  ].filter(Boolean);
  if (unsafe.length) add("referrer-unsafe", p.finalUrl, unsafe.join(" · "));
}
// Other sites are visited only with --outbound-links, a separate opt-in.
const OUTBOUND = !!args["outbound-links"];
const selfHosts = new Set([START_ORIGIN, EXPECT_ORIGIN].map(o => bareHost(new URL(o).host)));
const outbound = new Map(); // another site's URL -> the first page linking to it
for (const p of htmlPages)
  for (const a of p.anchors) {
    const x = a.href && urlOr(a.href.trim(), p.base);
    if (!x || !/^https?:$/.test(x.protocol) || selfHosts.has(bareHost(x.host))) continue;
    x.hash = "";
    if (!outbound.has(x.href)) outbound.set(x.href, p.finalUrl);
  }
if (OUTBOUND) {
  const r = await checkOutbound([...outbound.keys()], { limit: 100 });
  for (const b of r.broken) add("outbound-broken", b.url, `status ${b.status}, linked from ${outbound.get(b.url)}`);
  extra.outboundLinks = { checked: Math.min(outbound.size, 100), ...r };
  if (r.unreachable.length)
    notes.push(
      `${r.unreachable.length} link(s) to other sites couldn't be checked (the site turned the visit away, didn't answer, or isn't a public address), e.g. ${r.unreachable[0].url}: ${r.unreachable[0].reason}. They aren't counted as broken; outboundLinks in seo-crawl.json lists them.`,
    );
  if (outbound.size > 100) notes.push(`Links to other sites: the first 100 of ${outbound.size} were checked.`);
} else if (outbound.size)
  notChecked.push({
    rule: "CRAWL-07",
    area: "CRAWL-07 Links to other sites",
    reason: `The pages link to ${outbound.size} address(es) on other sites, which weren't visited: that contacts other sites, so it needs the owner's own yes. With it, --outbound-links checks up to 100 of them, 4 at a time, for broken links.`,
  });

// META-02: a description that opens with the page's title, all of it or its first 80%, ignoring case and spacing.
// Titles under 20 characters ("Contact us") are skipped: a short title often starts a natural sentence.
for (const p of htmlPages) {
  if (!indexable(p) || !p.title || !p.description) continue;
  const flat = s => s.toLowerCase().replace(/\s+/g, " ").trim(),
    t = flat(p.title);
  if (t.length >= 20 && flat(p.description).startsWith(t.slice(0, Math.ceil(t.length * 0.8))))
    add("desc-starts-with-title", p.finalUrl, `“${p.description.slice(0, 80)}”`);
}

// hreflang sources that disagree, missing versions, lang against hreflang, untranslated versions, invalid lang values,
// and the Translate widget as the only translation.
checkLanguages(
  htmlPages.filter(p => indexable(p) && !p.clientOnly),
  { add, origin: EXPECT_ORIGIN },
);

// extra.images: the images PERF-08 weighed, largest first, with their pixel size, the pages using them and a rough
// estSaving (images.mjs). Built from imageRows, so it makes no requests.
const usedOn = new Map(); // image URL -> pages using it, keyed as in `images`
for (const p of htmlPages)
  if (!p.clientOnly && indexable(p))
    for (const i of p.imgs) {
      const s = urlOr(i.src, p.base)?.href;
      if (s && images.has(s)) (usedOn.get(s) || usedOn.set(s, []).get(s)).push(p.finalUrl);
    }
extra.images = imageRows
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 100)
  .map(x => ({ ...x, pages: [...new Set(usedOn.get(x.url))].slice(0, 10), estSaving: estSaving(x) }));

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

// ---------- security: site-wide ----------
// TRUST-01 on the home page's headers: Permissions-Policy (the rule's pass list names it), what the CSP leaves open,
// HSTS that browsers ignore or that leaves subdomains out, and the preload list's requirements. A Server version
// with a known critical hole is needs-decision, as it may be patched.
// https://www.rfc-editor.org/rfc/rfc6797#section-8.1
// https://hstspreload.org
if (home?.headers) {
  const h = home.headers,
    at = home.finalUrl,
    sts = h.get("strict-transport-security");
  if (!h.get("permissions-policy")) add("sec-headers", at, "Permissions-Policy");
  const gaps = cspProblems(h.get("content-security-policy"));
  if (gaps.length) add("csp-weak", at, gaps.join("; "));
  const s = sts && hstsRead(sts);
  if (s?.invalid) add("hsts-invalid", at, `${s.invalid}, so browsers ignore the whole header: ${sts}`);
  else if (s) {
    if (!s.includeSubDomains) add("hsts-no-subdomains", at, sts);
    extra.hstsPreload = { ready: !s.missing.length, missing: s.missing };
  }
  const sv = serverHoles(h.get("server"));
  if (sv)
    add(
      "server-known-holes",
      at,
      `Server: ${h.get("server")}: ${sv.cves.map(c => `${c.id} (${c.what}, fixed in ${c.fixed})`).join("; ")}`,
    );
}
// A local copy's own files (the crawl origin or another local address) will be on https once deployed, so only other
// sites' http:// files count.
if (EXPECT_ORIGIN.startsWith("https:"))
  for (const p of htmlPages) {
    const bad = (p.insecure || []).filter(r => {
      const o = urlOr(r.url)?.origin;
      return o && o !== START_ORIGIN && !isLocal(o);
    });
    if (bad.length)
      add(
        "mixed-content",
        p.finalUrl,
        `${bad.length} resource${bad.length === 1 ? "" : "s"} over http://: ${bad
          .slice(0, 3)
          .map(r => `${r.kind} ${r.url}`)
          .join(", ")}`,
      );
  }
// Reasons and redirects recorded so far get the same masking as the findings and notes.
for (const n of notChecked) n.reason = redact(n.reason);
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
// CRAWL-10: a parameter page whose clean URL was also crawled, with no canonical dropping the parameters, is an
// indexable copy. It counts as checked only once such a page was crawled. Tracking and paging parameters are
// skipped: Google wants paginated pages to stay indexable.
// https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading
{
  const TRACKING = /^(utm_\w+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|yclid|igshid|mc_cid|mc_eid|_gl|_ga)$/i,
    PAGING = /^(page|p|pg|paged|offset|start)$/i;
  // A copy is the same page: same title as the page without the parameters. A different title is a different page
  // (WordPress's /?page_id=2), and a page listing itself in its own hreflang is a language version (WPML's ?lang=fr).
  const norm = t =>
    String(t || "")
      .trim()
      .toLowerCase();
  const cleanTitles = new Map(
    htmlPages.filter(p => !new URL(p.finalUrl).search).map(p => [new URL(p.finalUrl).pathname, norm(p.title)]),
  );
  const listsItself = p =>
    (p.hreflang || []).some(h => {
      try {
        return new URL(h.href, p.finalUrl).href === p.finalUrl;
      } catch {
        return false;
      }
    });
  for (const p of htmlPages) {
    const x = new URL(p.finalUrl),
      keys = [...new Set(x.searchParams.keys())].filter(k => !TRACKING.test(k) && !PAGING.test(k));
    if (!keys.length || p.clientOnly || !indexable(p) || !cleanTitles.has(x.pathname)) continue;
    if (cleanTitles.get(x.pathname) !== norm(p.title) || listsItself(p)) continue;
    evalRules("CRAWL-10");
    const c = canonicalFor(p);
    if (!c || urlOr(c)?.search)
      add(
        "parameter-page-indexable",
        p.finalUrl,
        `parameters ${keys.join(", ")}; ${c ? `canonical ${c}` : "no canonical"}`,
      );
  }
}

for (const p of htmlPages)
  if (!p.clientOnly && p.badUrls?.length)
    add("url-malformed", p.finalUrl, `${p.badUrls.length} address(es): ${p.badUrls.slice(0, 5).join(", ")}`);
// One section: links from the pages left out aren't known, so depth and orphans can't be judged.
if (SECTION) {
  extra.section = { include: INCLUDE, exclude: EXCLUDE };
  notes.push(
    `Crawled one part of the site: ${[INCLUDE.length && `paths starting with ${INCLUDE.join(" or ")}`, EXCLUDE.length && `leaving out ${EXCLUDE.join(" and ")}`].filter(Boolean).join(", ")}, plus the start page. robots.txt and the sitemap files were still read whole.`,
  );
  for (const rule of ["LINK-01", "LINK-02"]) {
    for (const k of [...findings.keys()]) if (CHECKS[k][0] === rule) findings.delete(k);
    evaluated.delete(rule);
    notChecked.push({
      rule,
      area: `${rule} ${RULES[rule][0]}`,
      reason:
        "Only part of the site was crawled (--include or --exclude), so links from the pages left out aren't known. Crawl the whole site to check this.",
    });
  }
}
// A folder with pages below it (/blog/ for /blog/a/) is a section; every other page counts under "/".
{
  const parts = p => new URL(p.finalUrl).pathname.split("/").filter(Boolean);
  const folders = new Set(
      htmlPages
        .map(parts)
        .filter(s => s.length > 1)
        .map(s => s[0]),
    ),
    count = new Map();
  for (const p of htmlPages) {
    const s = parts(p)[0],
      key = folders.has(s) ? `/${s}/` : "/";
    count.set(key, (count.get(key) || 0) + 1);
  }
  extra.sections = [...count]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 50)
    .map(([path, pages]) => ({ path, pages, share: Math.round((1000 * pages) / htmlPages.length) / 1000 }));
}
// Every URL the crawl knew of, from links and sitemaps, is a floor for the site's size.
if (capped) {
  const listed = [...smSet.keys()].filter(u => new URL(u).origin === START_ORIGIN).length,
    n = x => x.toLocaleString("en-US");
  extra.siteSize = { crawled: fetched, known: seen.size, sitemapUrls: listed };
  notes.push(
    `The crawl stopped at ${n(fetched)} pages (--max). It knew of ${n(seen.size)} URLs on the site from links and sitemaps (the sitemaps list ${n(listed)}${sm.cut ? ", and more past the part read" : ""}), so the site has at least ${n(Math.max(seen.size, listed))} URLs.`,
  );
}
// --gsc-indexing: Google's indexed count on the latest date of Search Console's Page indexing export, beside the
// crawl's indexable pages, never a finding. The export's Chart.csv is undocumented, so columns are found by the
// English export's names (Date first, Indexed, Not indexed); a file without them gets a note, not a guess.
if (typeof args["gsc-indexing"] === "string") {
  const file = args["gsc-indexing"];
  let rows = [];
  try {
    rows = parseCsv(readFileSync(file, "utf8"));
  } catch (e) {
    notes.push(`--gsc-indexing: couldn't read ${file} (${e.message}).`);
  }
  const keys = Object.keys(rows[0] || {}),
    on = keys.find(k => /^indexed$/i.test(k)),
    off = keys.find(k => /^not indexed$/i.test(k)),
    count = s => Number(String(s ?? "").replace(/\D/g, ""));
  const last =
    on && off
      ? rows
          .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r[keys[0]]))
          .sort((a, b) => (a[keys[0]] < b[keys[0]] ? -1 : 1))
          .at(-1)
      : null;
  if (last) {
    extra.indexing = {
      date: last[keys[0]],
      indexed: count(last[on]),
      notIndexed: count(last[off]),
      crawlIndexable: htmlPages.filter(p => indexable(p)).length,
      capped,
    };
    const i = extra.indexing,
      n = x => x.toLocaleString("en-US");
    notes.push(
      `Search Console counted ${n(i.indexed)} indexed pages (and ${n(i.notIndexed)} not indexed) on ${i.date}; this crawl found ${n(i.crawlIndexable)} pages meant to be indexed${capped ? " before it stopped at --max" : ""}. Google counts every URL it knows, old and parameter URLs too, so the two rarely match exactly; a big gap either way is worth a look in the Page indexing report.`,
    );
  } else if (keys.length)
    notes.push(
      `--gsc-indexing: ${file} has no dated rows with Indexed and Not indexed columns. It takes the chart table (Chart.csv) of Search Console's Page indexing export, in English, so Google's indexed count wasn't compared.`,
    );
}
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
                return pageOf(r);
              } catch {
                return null;
              }
            })();
          if (r.status === 404 || r.status === 410)
            for (const f of from) add("hreflang-bad-target", f.url, `${f.lang} → ${target} (status ${r.status})`);
          else if (!there) away.push(`${target} (${r.error || `status ${r.status}`})`);
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
// After every request this crawl makes: what the private-address guard stopped, and whether the crawler slowed down.
if (blocked.size)
  notes.push(
    `The crawler didn't fetch ${blocked.size} address(es) outside the crawled site that are private, local or cloud-metadata addresses: ${[
      ...blocked,
    ]
      .slice(0, 3)
      .map(([u, why]) => `${u} (${why})`)
      .join("; ")}. A redirect there is reported as the redirect itself.`,
  );

aiBotAccess({ robots, robotsRes, star }, { add, extra, startOrigin: START_ORIGIN });
// Bing's AI preferences (AI-03). An indexable page still on noarchive or nocache without the new directive needs a
// decision before 1 Mar 2027; a value Bing doesn't list is flagged. Pages Bing can't index don't matter.
evalRules("AI-03");
for (const p of htmlPages) {
  if (!p.bingAi || !indexable(p)) continue;
  const { legacy, prefs } = p.bingAi,
    at = w => [...new Set(legacy.filter(l => l.where === w).map(l => l.rule))].join(" and ");
  if (legacy.length && !prefs.length)
    add(
      "ai-legacy-noarchive",
      p.finalUrl,
      [at("meta") && `${at("meta")} in a meta tag`, at("header") && `${at("header")} in the X-Robots-Tag header`]
        .filter(Boolean)
        .join("; "),
    );
  const bad = prefs.filter(x => !BING_PREFS[x.name].includes(x.value));
  if (bad.length) add("ai-preference-invalid", p.finalUrl, bad.map(x => `${x.name}:${x.value}`).join(", "));
}
// Findings from checks/page.mjs: comment links to other sites and a script that may trap Back (CONTENT-11), paid text
// sent in full (REND-06), head tags after </head> (REND-08), and an Organization or WebSite whose @id or name differs
// from most pages' (SCHEMA-02). CONTENT-11 stays under NOT_CRAWLABLE.
{
  const read = htmlPages.filter(p => p.pageChecks && indexable(p) && !p.clientOnly);
  for (const { finalUrl: u, pageChecks: r } of read) {
    const away = r.ugc.filter(h => !selfHosts.has(bareHost(new URL(h).host)));
    if (away.length) add("ugc-link-followed", u, `${away.length} link(s), e.g. ${away[0]}`);
    if (r.backTrap) add("back-button-trap", u, r.backTrap);
    if (r.paywall) add("paywall-text-sent", u, `about ${r.paywall.words} words inside ${r.paywall.selector}`);
    if (r.late.length) add("head-tags-late", u, `in the body: ${r.late.join(", ")}`);
  }
  for (const [u, d] of identityDrift(read.map(p => ({ url: p.finalUrl, ...p.pageChecks.identity }))))
    add("site-identity-differs", u, d);
}

aiRobotRules({ robots, robotsRes }, { add, extra, startOrigin: START_ORIGIN });

{
  // Indexable pages exactly one other page links to, the first 20 listed. A one-section crawl doesn't know the links
  // from pages it leaves out, so it's skipped there.
  if (!SECTION) {
    const from = new Map();
    for (const p of htmlPages)
      for (const l of p.links) {
        const f = finalOf(l.url);
        if (f !== p.finalUrl) (from.get(f) || from.set(f, new Set()).get(f)).add(p.finalUrl);
      }
    const once = htmlPages.filter(p => indexable(p) && !isHome(p) && from.get(p.finalUrl)?.size === 1);
    if (once.length)
      extra.linkedOnce = {
        count: once.length,
        pages: once.slice(0, 20).map(p => ({ url: p.finalUrl, from: [...from.get(p.finalUrl)][0] })),
        ...(capped ? { capped: true } : {}),
      };
  }
  // A page#name link whose target lacks that id or <a name>, once each. Pages built only in the browser get their ids
  // from JavaScript, so they aren't judged, nor are pages the crawl didn't read.
  const done = new Set();
  for (const p of htmlPages)
    for (const [to, name] of p.fragLinks || []) {
      const t = byPage.get(finalOf(to)),
        key = t && `${t.finalUrl}#${name}`;
      if (!t || t.clientOnly || done.has(key) || hasName(t.anchorIds, name)) continue;
      done.add(key);
      add("link-fragment-missing", key, `linked from ${p.finalUrl}`);
    }
  // One note if the crawler slowed down. The AI-bot probe below can still pause it.
  const slowed = slowNote(slow);
  if (slowed) notes.push(slowed);
}

// Analytics IDs set up twice (LAUNCH-04) and secret keys (TRUST-01) are checked on every page read, since both
// matter on pages search engines skip too; hidden links (CONTENT-11), nested reviews naming another item (SCHEMA-01)
// and online-only events (SCHEMA-05) only on indexable pages. A key's words leave the page's words before the words
// file is written. App link files are asked only of the crawled origin, without following redirects: neither file
// may be served through one. PDFs linked from a menu or PDF_PAGES+ indexable pages are listed; Microsoft advises
// against relying on PDFs for core content.
// https://about.ads.microsoft.com/en/blog/post/october-2025/optimizing-your-content-for-inclusion-in-ai-search-answers
{
  const read = htmlPages.filter(p => p.hygieneSignals);
  for (const p of read) {
    const h = p.hygieneSignals,
      u = p.finalUrl;
    if (h.analytics.length) add("analytics-tag-twice", u, h.analytics.join("; "));
    if (h.keys.length) add("secret-key-exposed", u, h.keys.join("; "));
    if (h.scrub.length && typeof p.mainWordsText === "string") {
      const drop = new Set(h.scrub);
      p.mainWordsText = p.mainWordsText
        .split(" ")
        .filter(w => !drop.has(w))
        .join(" ");
    }
    if (!indexable(p) || p.clientOnly) continue;
    const away = h.hidden.filter(x => {
      const y = urlOr(x);
      return y && !selfHosts.has(bareHost(y.host));
    });
    if (away.length >= HIDDEN_MIN)
      add("hidden-links", u, `${away.length} hidden link(s) to other sites, e.g. ${away[0]}`);
    if (h.schema.events.length) add("event-online", u, h.schema.events.map(e => `“${e}”`).join(", "));
    if (h.schema.reviews.length) add("review-target-conflict", u, h.schema.reviews.join("; "));
  }
  // Builds often bake a server setting into the scripts browsers get. Each on-site script is read once, most-loaded
  // first, without following redirects, so no other host is asked; an HTML answer (an app shell served for every path)
  // is skipped, and source maps aren't read. JS_CAPS are local limits. A script that redirects isn't read; follow
  // on-site hops if that turns up.
  const scripts = new Map(); // crawl URL -> the pages that load it
  for (const p of read)
    for (const s of p.hygieneSignals.js) (scripts.get(s) || scripts.set(s, []).get(s)).push(p.finalUrl);
  let jsRead = 0,
    jsBytes = 0,
    jsUnread = 0;
  for (const [src, from] of [...scripts].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    if (jsRead >= JS_CAPS.files || jsBytes >= JS_CAPS.all) {
      jsUnread++;
      continue;
    }
    jsRead++;
    const cap = Math.min(JS_CAPS.each, JS_CAPS.all - jsBytes),
      r = await get(src, { accept: "*/*", text: /^(?!text\/html)/i, max: cap });
    jsBytes += r.over ? cap : Buffer.byteLength(r.body);
    if (r.over) {
      jsUnread++;
      continue;
    }
    const keys = [...new Set(secretsIn(r.body).map(k => `${k.label} (${k.shown})`))];
    if (keys.length)
      add(
        "secret-key-exposed",
        from.sort()[0],
        `in the script ${pathKey(src)}${from.length > 1 ? ` (loaded by ${from.length} pages)` : ""}: ${keys.join("; ")}`,
      );
  }
  if (jsUnread)
    notes.push(
      `${jsUnread} of the site's ${scripts.size} script files weren't read for secret keys, because of our own limits: ${JS_CAPS.files} files, ${JS_CAPS.each / 1048576} MB each and ${JS_CAPS.all / 1048576} MB in all. A key in one of them would be missed.`,
    );
  const apps = [];
  for (const [k, platform] of [
    ["android", "Android"],
    ["ios", "iOS"],
  ]) {
    const page = read
      .filter(p => p.hygieneSignals.app[k])
      .map(p => p.finalUrl)
      .sort()[0];
    if (!page) continue;
    let res = { status: 0, type: "", body: "" };
    try {
      const r = await fetch(START_ORIGIN + APP_FILES[k], {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      res = {
        status: r.status,
        type: r.headers.get("content-type") || "",
        body: r.status === 200 && r.body ? (await upTo(r.body, 1 << 18)).toString("utf8") : "",
      };
      if (r.status !== 200) await r.body?.cancel();
    } catch {}
    const bad = appFile(k, res);
    if (bad) apps.push({ platform, file: APP_FILES[k], page, ...bad });
  }
  if (apps.length) extra.appLinks = apps;
  const pdfs = new Map(); // crawl URL -> { pages, menu }
  for (const p of read)
    if (indexable(p) && !p.clientOnly)
      for (const x of p.hygieneSignals.pdfs) {
        const e = pdfs.get(x) || pdfs.set(x, { pages: 0, menu: false }).get(x);
        e.pages++;
        e.menu ||= p.hygieneSignals.navPdfs.includes(x);
      }
  const listed = [...pdfs]
    .filter(([, e]) => e.menu || e.pages >= PDF_PAGES)
    .sort(([a, x], [b, y]) => Number(y.menu) - Number(x.menu) || y.pages - x.pages || a.localeCompare(b));
  if (listed.length)
    extra.pdfLinks = { count: listed.length, pdfs: listed.slice(0, 20).map(([url, e]) => ({ url, ...e })) };
}

// Compares the Markdown served for Accept: text/markdown with the page's words, on the render sample, only when the
// start page served Markdown (mdHome). Cloudflare's conversion drops header, footer and nav, adds front matter and
// appends the JSON-LD in a ```json block, so a converted copy still matches.
// https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/
// Flagged when the Markdown lacks over half the main text's words or over half its words aren't on the page. The
// half-the-words lines and the 50-word minimum are local; a few words would swing the share. One finding, with one
// evidence line per page that differs.
if (mdHome != null)
  for (const u of renderSample) {
    const p = byPage.get(u);
    if (!p?.markdownWords) continue;
    const res = u === START.href ? null : await get(u, { accept: "text/markdown", text: /^text\/markdown/i });
    const text = res ? (res.status === 200 && /^text\/markdown/i.test(res.ct) ? res.body : null) : mdHome;
    if (text == null) continue;
    const md = text
      .replace(/```json[\s\S]*?```|!\[[^\]]*\]\([^)]*\)|<[^>]*>|https?:\/\/\S+/g, " ")
      .replace(/\]\([^)]*\)/g, "]");
    const words = new Set(pickMainWords(md.replace(NOSPACE_RUN, " "))),
      main = p.markdownWords.main.split(" "),
      all = new Set(p.markdownWords.all.split(" "));
    const kept = main.filter(w => words.has(w)).length / main.length,
      extra = words.size ? [...words].filter(w => !all.has(w)).length / words.size : 0;
    if (kept < 0.5 || extra > 0.5)
      add(
        "markdown-differs",
        u,
        `the Markdown has ${Math.round(100 * kept)}% of the page's main words, and ${Math.round(100 * extra)}% of its own words aren't on the page; our own limit is half`,
      );
  }

// Each indexable page's link strength, 0–100, over the link checks' graph; noindex pages pass links on too. Keyed by
// path rather than a column on `pages`: leaner, and the report matches it to Search Console's paths. Skipped on a
// one-section crawl, as linkedOnce is.
if (!SECTION) {
  const { rank, base } = pageRank(new Map(htmlPages.map(p => [p.finalUrl, p.links.map(l => finalOf(l.url))])));
  const s = [
    ...strengthScale(
      rank,
      base,
      htmlPages.filter(p => indexable(p)).map(p => p.finalUrl),
    ),
  ].sort((a, b) => b[1] - a[1]);
  if (s.length)
    extra.linkStrength = {
      pages: Object.fromEntries(
        s.map(([u, v]) => {
          const x = new URL(u);
          return [x.pathname + x.search, v];
        }),
      ),
      median: s[s.length >> 1][1],
      ...(capped ? { capped: true } : {}),
    };
}

// Each indexable page's words and links (as indexes into the same list, redirects followed) for keyword-ideas.mjs.
// A file of its own, so seo-crawl.json doesn't grow: a few KB a page, some 10–25 MB for 5,000 pages. seo-crawl.json
// names the file and both carry the crawl's start time, so keyword-ideas can tell a file left from another crawl.
{
  const kept = htmlPages.filter(p => indexable(p) && !p.clientOnly && typeof p.mainWordsText === "string"),
    at = new Map(kept.map((p, i) => [p.finalUrl, i]));
  const file = OUT.replace(/\.json$/i, "") + ".words.json",
    pathOf = u => {
      const x = new URL(u);
      return x.pathname + x.search;
    };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      tool: "seo-supervisor-crawler-words",
      stamp: t0,
      pages: kept.map(p => ({
        path: pathOf(p.finalUrl),
        words: p.mainWordsText,
        links: [...new Set(p.links.map(l => at.get(finalOf(l.url))).filter(i => i !== undefined))],
        ...(p.mainNoSpace ? { nospace: true } : {}),
      })),
    }),
  );
  extra.pageWords = { file: basename(file), stamp: t0, pages: kept.length };
}

// Click-only elements and missing landmarks on indexable, server-rendered pages; the first 20 lacking a landmark are
// listed.
{
  const bare = [];
  let checked = 0;
  for (const p of htmlPages) {
    if (!p.agent || !indexable(p) || p.clientOnly) continue;
    checked++;
    const { clickOnly, landmarksMissing } = p.agent;
    if (clickOnly.length)
      add("click-only-elements", p.finalUrl, `${clickOnly.length} element(s), e.g. \`${clickOnly[0]}\``);
    if (landmarksMissing.length) bare.push({ url: p.finalUrl, missing: landmarksMissing });
  }
  if (bare.length) extra.landmarks = { checked, count: bare.length, pages: bare.slice(0, 20) };
}
// The Googlebot comparison with AI search crawlers' user agents, on the home page and up to 2 more sample pages, a
// 429 or 5xx asked once more. Posing as another company's crawler counts as outside contact, so it needs --outside
// as well as --ai-bot-probe. An error or challenge the visitor didn't get is a decision (MAP-06): a firewall checking
// the vendor's IPs is right.
// User agents as the vendors publish them; Anthropic names only the Claude-SearchBot token, so its string is built
// around that.
// https://developers.openai.com/api/docs/bots
// https://docs.perplexity.ai/guides/bots
// https://support.claude.com/en/articles/8896518
const AI_PROBE_UAS = {
  "OAI-SearchBot":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot",
  "Claude-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0)",
  PerplexityBot: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
};
if (AI_PROBE && !OUTSIDE)
  notes.push(
    "--ai-bot-probe runs only with outside checks on (--outside) and the owner's own yes: it asks a few pages again as OAI-SearchBot, Claude-SearchBot and PerplexityBot. It didn't run.",
  );
else if (AI_PROBE)
  await Promise.all(
    botSample.slice(0, 3).map(async u => {
      const uas = Object.entries(AI_PROBE_UAS);
      let [vr, ...brs] = await Promise.all([follow(u, PHONE_UA), ...uas.map(([, ua]) => follow(u, ua))]);
      if (busy(vr)) vr = await askAgain(u, PHONE_UA);
      if (!pageOf(vr)) return; // a visitor doesn't get the page now either: nothing to compare
      const got = [];
      let fightMode = false;
      for (let [i, br] of brs.entries()) {
        if (busy(br)) br = await askAgain(u, uas[i][1]);
        // A 402 is Cloudflare's pay per crawl asking for payment, priced in crawler-price: paid access, not a refusal.
        // https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/use-pay-per-crawl-as-ai-owner/crawl-pages/
        if (br.status === 402) {
          const price = br.headers.get("crawler-price");
          (extra.aiBotPaid ??= []).push({
            url: vr.finalUrl,
            bot: uas[i][0],
            ...(price ? { price: price.slice(0, 100) } : {}),
          });
          continue;
        }
        // A Cloudflare challenge points to Bot Fight Mode, which custom firewall rules can't skip (sources at
        // ai-bot-refused in checks/agents.mjs).
        const challenge = challenged(br) && !challenged(vr),
          cf =
            challenge &&
            (/^challenge$/i.test(br.headers.get("cf-mitigated") || "") ||
              /\/cdn-cgi\/challenge-platform\//.test(br.body || ""));
        fightMode ||= cf;
        if (challenge || br.status >= 400 || br.status === 0)
          got.push(
            `${uas[i][0]} got ${challenge ? `a ${cf ? "Cloudflare " : ""}bot challenge (${br.status})` : br.status || `no answer (${br.error})`}`,
          );
      }
      if (got.length)
        add(
          "ai-bot-refused",
          vr.finalUrl,
          `${got.join("; ")}, a visitor 200${fightMode ? ". Cloudflare's Bot Fight Mode is a likely cause: custom firewall rules can't make an exception to it" : ""}`,
        );
    }),
  );

// ---------- structured data: site-wide ----------
// JSON-LD placeholders and deprecated types (SCHEMA-01, SCHEMA-05), and broken schema images (SCHEMA-01): the first
// 64 KB of up to 50 on-site ones, read with firstBytes, which never leaves the site. An error or a web page counts as
// not loading.
{
  const schemaImgs = new Map(),
    away = new Set(); // crawl URL -> { src, page }; images on other hosts
  for (const p of htmlPages) {
    if (p.clientOnly || !indexable(p)) continue;
    if (p.schemaPlaceholder) add("schema-placeholder", p.finalUrl, `“${p.schemaPlaceholder}”`);
    if (p.superseded.length)
      add("schema-superseded", p.finalUrl, p.superseded.map(t => `${t} → ${SUPERSEDED[t]}`).join(", "));
    for (const s of p.schemaImages) {
      const src = urlOr(s, p.base);
      if (!src || !/^https?:$/.test(src.protocol)) continue;
      const c = clean(toCrawl(src.href));
      if (new URL(c).origin !== START_ORIGIN) away.add(src.href);
      else if (!schemaImgs.has(c)) schemaImgs.set(c, { src: src.href, page: p.finalUrl });
    }
  }
  const list = [...schemaImgs].slice(0, 50);
  for (let i = 0; i < list.length; i += CONC)
    await Promise.all(
      list.slice(i, i + CONC).map(async ([crawlSrc, { src, page }]) => {
        const r = await firstBytes(crawlSrc);
        if (!r)
          away.add(src); // redirects off the crawled site, so not followed
        else if (r.status !== 200 && r.status !== 206)
          add("schema-image-broken", page, `${src} → ${r.status || `no response (${r.error})`}`);
        else if (/html/i.test(r.type)) add("schema-image-broken", page, `${src} → an HTML page, not an image`);
      }),
    );
  if (away.size)
    notes.push(
      `${away.size} schema image(s) are on another host (often a CDN) or redirect there, e.g. ${[...away][0]}, so they weren't checked: only the crawled site is fetched.`,
    );
  if (schemaImgs.size > 50) notes.push(`Schema images were checked for the first 50 of ${schemaImgs.size}.`);
}

// ---------- product pages: site-wide ----------
// On indexable pages with Product schema: one finding per check per page. An H1 shared by 3+ product pages counts as
// reused unless it names one of their products (a variant's "Wool coat" names "Wool coat, small"). The report counts
// how many products give each recommended field.
{
  const shop = htmlPages.filter(p => p.shop && indexable(p)),
    byH1 = new Map();
  for (const p of shop) {
    const seen = new Set();
    for (const pr of p.shop)
      for (const x of pr.problems)
        if (!seen.has(x.check)) {
          seen.add(x.check);
          add(`product-${x.check}`, p.finalUrl, x.key ? `${pr.name}: ${x.key} “${x.value}”` : pr.name);
        }
    const h = p.headings.find(x => x.level === 1)?.text,
      k = h && norm(h);
    if (k) (byH1.get(k) || byH1.set(k, { h, pages: [] }).get(k)).pages.push(p);
  }
  for (const [k, { h, pages: ps }] of byH1)
    if (ps.length >= 3 && !ps.some(p => p.shop.some(pr => norm(pr.name).includes(k))))
      for (const p of ps) add("product-h1-reused", p.finalUrl, `“${h}” on ${ps.length} product pages`);
  const all = shop.flatMap(p => p.shop);
  if (all.length)
    extra.productFields = {
      products: all.length,
      ...Object.fromEntries(Object.keys(SHOP_FIELDS).map(f => [f, all.filter(pr => pr.fields.includes(f)).length])),
    };
}

// ---------- images and speed: site-wide ----------
// Alt text, image preload and prerender findings on the pages the per-page checks read, then `media`: the lab LCP
// element per page (Chrome's fetchpriority check is a finding), server response times, deep or wide pages, image
// credits and AI labels, caching and CDN, and Lighthouse's medians. With the CrUX key, the tablet and home-page
// trends. Depth over 32 and over 60 children are local lines taken from older Lighthouse advice.
{
  const media = {},
    live = htmlPages.filter(p => indexable(p) && !p.clientOnly),
    path = u => urlOr(u)?.pathname ?? u;
  for (const p of live) {
    const u = p.finalUrl,
      bad = p.imgs
        .filter(i => "alt" in i)
        .map(i => [i.alt, altProblem(i.alt, i.src)])
        .filter(([, why]) => why);
    if (bad.length)
      add("img-alt-quality", u, `${bad.length} image(s), e.g. “${bad[0][0].trim().slice(0, 60)}” (${bad[0][1]})`);
    if (p.imagePreloads > 1)
      add("image-preloads", u, `${p.imagePreloads} image preloads: ${p.preloadHrefs.join(", ")}`);
    if (p.prerender.length) add("prerender-hint", u, `<link rel="prerender" href="${p.prerender[0]}">`);
  }
  const heroes = new Map();
  for (const [source, runs] of [
    ["PageSpeed", (speed?.samples || []).map(s => [s.url, s.lab?.lcpElement])],
    ["Lighthouse", (lighthouse || []).map(x => [x.url, x.lcpElement])],
  ])
    for (const [url, el] of runs)
      if (el && !heroes.has(path(url)))
        heroes.set(path(url), {
          url,
          element: el.element,
          ...(el.src ? { src: el.src } : {}),
          source,
          hinted: el.fetchpriorityHigh,
        });
  for (const h of heroes.values()) if (h.hinted === false && h.src) add("hero-no-fetchpriority", h.url, h.src);
  if (heroes.size) media.heroImages = [...heroes.values()].map(({ hinted, ...h }) => h);
  const times = htmlPages
    .filter(p => Number.isFinite(p.ms))
    .map(p => ({ url: p.finalUrl, ms: p.ms }))
    .sort((a, b) => a.ms - b.ms);
  // 0.8 s is web.dev's "good" TTFB for real visitors, applied here to a single request from this machine.
  // https://web.dev/articles/ttfb
  if (times.length)
    media.serverTimes = {
      pages: times.length,
      median: times[(times.length - 1) >> 1].ms,
      p95: times[Math.ceil(times.length * 0.95) - 1].ms,
      slow: times
        .filter(t => t.ms > 800)
        .reverse()
        .slice(0, 10),
    };
  const deep = live
    .filter(p => p.domShape.depth > 32)
    .map(p => ({ url: p.finalUrl, depth: p.domShape.depth }))
    .sort((a, b) => b.depth - a.depth);
  const wide = live
    .filter(p => p.domShape.widest.children > 60)
    .map(p => ({ url: p.finalUrl, ...p.domShape.widest }))
    .sort((a, b) => b.children - a.children);
  if (deep.length || wide.length) media.domShape = { deep: deep.slice(0, 20), wide: wide.slice(0, 20) };
  const info = [...imageInfo],
    hosts = {};
  if (info.length)
    media.imageCredits = {
      read: info.length,
      creator: info.filter(([, i]) => i.creator).length,
      ai: info
        .filter(([, i]) => i.ai)
        .map(([s]) => s)
        .slice(0, 20),
      aiCount: info.filter(([, i]) => i.ai).length,
      c2pa: info.filter(([, i]) => i.c2pa).length,
      noCreator: info
        .filter(([, i]) => !i.creator)
        .map(([s]) => s)
        .slice(0, 20),
    };
  for (const p of live)
    for (const i of p.imgs) {
      const x = urlOr(i.src, p.base);
      if (x && /^https?:$/.test(x.protocol) && ![START_ORIGIN, EXPECT_ORIGIN].includes(x.origin))
        hosts[x.host] = (hosts[x.host] || 0) + 1;
    }
  if (info.length || Object.keys(hosts).length)
    media.imageCache = {
      checked: info.length,
      uncached: info
        .filter(([, i]) => i.uncached)
        .map(([s]) => s)
        .slice(0, 20),
      uncachedCount: info.filter(([, i]) => i.uncached).length,
      cdn: info.map(([, i]) => i.cdn).find(Boolean) || null,
      otherHosts: Object.fromEntries(
        Object.entries(hosts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      ),
    };
  if (lighthouse?.length > 1) media.lighthouseMedians = medianScores(lighthouse);
  if (Object.keys(media).length) extra.media = media;
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
}

// REND-11 data from the browser loads above, and --render-page's result.
if (RENDER_PAGE && !OUTSIDE)
  notes.push(
    "--render-page runs only with outside checks on (--outside): rendering runs the page's own scripts, analytics included. It didn't run.",
  );
let moreReason = OUTSIDE
  ? "Chrome or Edge isn't installed (or set CHROME_PATH), so the phone menu and ads couldn't be checked."
  : "Outside checks are off. With the owner's go-ahead, --outside loads sample pages in headless Chrome at phone size (running the site's own scripts) to try the menu button and measure ads.";
if (browser) {
  let chosen = null;
  if (RENDER_PAGE) {
    const u = urlOr(RENDER_PAGE, START.href);
    if (u && /^https?:$/.test(u.protocol)) {
      const res = await get(u.href, { manual: false }).catch(() => null);
      chosen = { url: u.href, steps: RENDER_STEPS, raw: res?.status === 200 && res.body ? res.body : null };
    } else notes.push(`--render-page needs an http or https address; “${RENDER_PAGE}” isn't one, so it didn't run.`);
  }
  const r = await checkMore(browser, renderSample, {
    add,
    screenshotDir: resolve(dirname(OUT), "screenshots"),
    rawWords: new Map(htmlPages.filter(p => !p.clientOnly).map(p => [p.finalUrl, p.words])),
    clean: CLEAN_SHOTS,
    chosen,
  }).catch(e => ({
    checked: 0,
    pages: [],
    chosen: null,
    notes: [`the browser didn't start for the render checks: ${String(e.message).split("\n")[0].slice(0, 160)}`],
  }));
  notes.push(...r.notes);
  if (r.pages.length) extra.renderSample = r.pages;
  if (r.chosen) extra.renderedPage = r.chosen;
  if (r.checked) {
    evalRules("REND-11");
    moreReason = null;
  } else
    moreReason = `The browser at ${browser} couldn't load the sample pages at phone size (${r.notes[0] || "no pages to load"}).`;
}
if (moreReason) notChecked.push({ rule: "REND-11", area: `REND-11 ${RULES["REND-11"][0]}`, reason: moreReason });

// ---------- content: site-wide ----------
// META-02: descriptions that barely match their page, end with the title's brand or are templated; CONTENT-07: guides
// last dated over a year ago; CONTENT-03: keyword use. A description's main words are read as META-09 reads a
// title's, matched by stem or acronym. The 4-word minimum, a quarter on the page and the one-year guide age are local
// lines.
{
  const live = htmlPages.filter(p => indexable(p) && !p.clientOnly);
  for (const p of live) {
    const u = p.finalUrl;
    if (p.description) {
      const dw = titleWords(p.description).filter(w => !brandWords.has(w)),
        onPage = " " + p.normText;
      if (dw.length >= 4 && p.words >= 50) {
        const on = dw.filter(w => onPage.includes(" " + w.slice(0, Math.max(4, w.length - 3)))).length;
        if (on < dw.length / 4 && ![...acronyms(p.description)].some(a => p.caps.has(a)))
          add("desc-mismatch", u, `“${p.description.slice(0, 80)}”: ${on} of ${dw.length} main words are on the page`);
      }
      const tail = p.title && brandTail(p.title, p.description);
      if (tail) add("desc-brand-tail", u, `ends with “${tail}”, as the title does`);
    }
    if (p.guideDate && Date.now() - p.guideDate.time > 365 * 864e5)
      add("stale-guide", u, `newest date ${p.guideDate.date}, from ${p.guideDate.from}`);
  }
  const descs = live
    .filter(p => p.description)
    .map(p => ({ url: p.finalUrl, section: sectionOf(p.finalUrl), desc: p.description }));
  const hits = templatedDescs(descs);
  for (const [u, why] of hits) add("templated-desc", u, why);
  if (hits.length)
    extra.templatedDescriptions = templatedShare(
      descs,
      hits.map(h => h[0]),
    );
  const kw = live.filter(p => p.keywordUse).map(p => ({ url: p.finalUrl, ...p.keywordUse }));
  if (kw.length)
    extra.keywordUse = {
      counts: Object.fromEntries(
        ["natural", "missing", "repetitive", "forced"].map(v => [v, kw.filter(k => k.verdict === v).length]),
      ),
      pages: kw.filter(k => k.verdict !== "natural").slice(0, 50),
    };
}

// ---------- local business: site-wide ----------
// A service-area business whose schema gives a street address no page shows gets a note instead of the address
// finding.
{
  const lb = localBusiness();
  if (lb) extra.localBusiness = lb;
  if (lb?.streetHidden)
    notes.push(
      `The business schema gives the street address “${lb.address?.streetAddress || lb.address?.text}”, but no page shows it, and the site says the business goes to its customers, so the address check skipped it. If customers don't come to that address, take it out of the schema too and keep the town, region and postcode (LOCAL-06). If they do, show it on the site (LOCAL-05).`,
    );
}

// ---------- links to other sites ----------
// Counted from the pages already read, with no requests; only --outbound-links visits them. pages: distinct
// addresses per page; domains: distinct addresses per host (www left off), the 1,000 most linked, which
// links-import.mjs crosses with Search Console's Top linking sites.
{
  const pages = {},
    domains = {};
  for (const p of htmlPages) {
    const here = new Set();
    for (const a of p.anchors) {
      const x = a.href && urlOr(a.href.trim(), p.base);
      if (!x || !/^https?:$/.test(x.protocol) || selfHosts.has(bareHost(x.host))) continue;
      x.hash = "";
      here.add(x.href);
    }
    pages[p.finalUrl] = here.size;
  }
  for (const u of outbound.keys()) {
    const h = bareHost(new URL(u).hostname);
    domains[h] = (domains[h] || 0) + 1;
  }
  extra.linksToOtherSites = {
    pages,
    domains: Object.fromEntries(
      Object.entries(domains)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 1000),
    ),
  };
}

// ---------- trust signals ----------
// E-E-A-T signals for the trust view, never findings or scored; after the security checks, so their findings are in.
// HTTPS counts with no open TRUST-01 or TRUST-07 finding, and is unknown without a public origin.
extra.trustSignals = trustSignals(htmlPages, {
  origin: EXPECT_ORIGIN,
  https: !isPublic(EXPECT_ORIGIN)
    ? null
    : EXPECT_ORIGIN.startsWith("https:") &&
      ![...findings.keys()].some(k => ["TRUST-01", "TRUST-07"].includes(CHECKS[k][0])),
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
for (const [rule, area, reason] of NOT_CRAWLABLE) notChecked.push({ rule, area: `${rule} ${area}`, reason });
// MAP-01 is half the robots.txt Sitemap: line, so only a sitemap finding settles it while robots.txt is down.
if (robotsDown)
  for (const rule of ["MAP-01", "MAP-05", "MAP-06"])
    if (![...findings.keys()].some(k => CHECKS[k][0] === rule))
      notChecked.push({
        rule,
        area: `${rule} ${RULES[rule][0]}`,
        reason: `robots.txt answered ${robotsRes.status ? `status ${robotsRes.status}` : "nothing"}, so its ${rule === "MAP-01" ? "Sitemap: line" : "rules"} couldn't be read. Re-run once it returns 200.`,
      });
// A page missing from the sitemap URLs read may be in the part past SITEMAP_KEEP.
if (sm.cut && findings.delete("missing-from-sitemap") && evaluated.delete("MAP-03"))
  notChecked.push({
    rule: "MAP-03",
    area: `MAP-03 ${RULES["MAP-03"][0]}`,
    reason: sm.filesLeft
      ? "Some crawled pages aren't in the first 60 sitemap files, the most this audit reads, so they may still be in the files after them."
      : `Some crawled pages aren't among the first ${SITEMAP_KEEP.toLocaleString("en-US")} sitemap URLs, the most this audit reads, so they may still be in the rest of the sitemap.`,
  });
if (!redirectSources.length)
  notChecked.push({
    rule: "URL-07",
    area: "URL-07 Old-URL redirects",
    reason: "No redirect list given. Pass --urls (old site URLs) or --next-manifest .next/routes-manifest.json.",
  });
if (!BANNED && !VERIFY)
  notChecked.push({
    rule: "CONTENT-10",
    area: "CONTENT-10 Banned and unconfirmed claims",
    reason: "Pass --banned and --verify with the profile's claim lists.",
  });
if (IGNORE_NOINDEX && evaluated.delete("CRAWL-02"))
  notChecked.push({
    rule: "CRAWL-02",
    area: "CRAWL-02 Pages meant to rank are not noindex",
    reason: "Pre-launch run: noindex is expected now. Re-check after launch (CRAWL-03).",
  });

// ---------- output ----------
const SEV = { blocker: 0, high: 1, "needs-decision": 2, medium: 3, low: 4 };
const out = [];
for (const [key, f] of findings) {
  const [rule, severity, title, why, fix] = CHECKS[key];
  const ex = f.evidence[0] || {};
  const what = `${f.count === 1 ? "Found on" : `${f.count} cases, for example`} ${ex.url || "the site"}${ex.detail ? ` (${ex.detail})` : ""}.`;
  out.push({
    check: key,
    rule,
    severity,
    category: RULES[rule][1],
    title: title(f.count),
    what,
    why,
    fix,
    count: f.count,
    evidence: f.evidence,
    source: "crawler",
    status: severity === "needs-decision" ? "needs-decision" : "open",
  });
}
out.sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.count - a.count);
out.forEach((/** @type {Record<string, any>} */ f, i) => {
  f.id = "C-" + String(i + 1).padStart(3, "0");
});
const failedRules = new Set(out.map(f => f.rule));
const passed = [...evaluated]
  .filter(r => !failedRules.has(r))
  .sort()
  .map(r => ({ rule: r, title: RULES[r][0], category: RULES[r][1] }));
if (capped) notes.push(`Crawl stopped at ${MAX} pages (--max). Some pages were not checked; raise --max.`);
const noteList = notes.map(n => redact(n)); // every note, whichever check wrote it
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
  notChecked,
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
