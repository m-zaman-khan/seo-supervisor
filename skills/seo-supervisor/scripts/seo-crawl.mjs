#!/usr/bin/env node
// @ts-check
// Read-only SEO crawler: GET and HEAD only, plus a TLS handshake with --check-live.
// Regex HTML parsing is enough for audit evidence. Swap in a real parser if a site breaks it.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileCrawl } from "./seo-diff.mjs";
import { createGunzip } from "node:zlib";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { CHECKS as HREFLANG_CHECKS, checkHreflang } from "./checks/hreflang.mjs";
import { CHECKS as TLS_CHECKS, checkLive } from "./checks/tls.mjs";
import {
  CHECKS as SPEED_CHECKS,
  checkSpeed,
  sampleUrls,
  PSI_ENDPOINT,
  speedTrend,
  CRUX_HISTORY_ENDPOINT,
  labLcpBreakdown,
} from "./checks/speed.mjs";
import { CHECKS as RENDER_CHECKS, findBrowser, renderPage, compareRendered } from "./checks/render.mjs";
import { CHECKS as VISUAL_CHECKS, checkVisual } from "./checks/visual.mjs";
import { checkLighthouse, findLighthouse } from "./checks/lighthouse.mjs";
import { imageSize } from "./lib/image-size.mjs";

import { trustFeatures, trustSignals } from "./checks/trust.mjs";

import { CHECKS as AGENT_CHECKS, agentFeatures, agentFiles } from "./checks/agents.mjs";
import { writingText, writingFeatures } from "./checks/writing.mjs";

import { CHECKS as BUSINESS_CHECKS, checkBusinessType, detectBusinessType } from "./checks/business-type.mjs";

import { CHECKS as TECH_CHECKS, cookieProblems } from "./checks/technical.mjs";
import { CHECKS as OUTBOUND_CHECKS, checkOutbound } from "./checks/outbound.mjs";

import { proxyNote } from "./lib/proxy.mjs";
{
  const n = proxyNote();
  if (n) console.error("note: " + n);
} // once, before any request
import { linkHreflang, mergeHreflang, languageFeatures, checkLanguages } from "./checks/hreflang.mjs";

// Sitemap <xhtml:link> hreflang by crawl URL, built on first use: `sm` is only read later, before the crawl starts.
let smHreflang;
const sitemapHreflang = u =>
  (smHreflang ||= new Map(sm.entries.filter(e => e.hreflang).map(e => [clean(toCrawl(e.loc)), e.hreflang]))).get(
    clean(u),
  ) || [];

import { estSaving } from "./images.mjs";

import { renderAll } from "./checks/render.mjs";

import { createHash } from "node:crypto";

import { SERVER_CHECK, cspProblems, hstsRead, insecureResources, serverHoles } from "./checks/technical.mjs";
import { redact, hideSecrets } from "./lib/redact.mjs";
import { chromeProxyArgs } from "./lib/proxy.mjs";

import { lookup } from "node:dns";
import { promisify } from "node:util";
import { isPublic as publicAddress, guarded } from "./checks/outbound.mjs";
import { otherSiteTargets, linksBack } from "./checks/hreflang.mjs";
import { parseCsv } from "./lib/csv.mjs";

import { AI_BOTS, signalPlacement, bingAiRules, BING_PREFS, VALUED, aiRobots } from "./checks/agents.mjs";

import { SUPERSEDED, placeholderIn } from "./schema-check.mjs";

import { merchantProblems, sellsWithOffer } from "./schema-check.mjs";

import { CHECKS as MEDIA_CHECKS, altProblem, lazySrc, hintsOf, domShape, cdnOf, uncached } from "./checks/media.mjs";
import { imageMeta } from "./lib/image-size.mjs";
import { medianScores, ALL_CAP } from "./checks/lighthouse.mjs";

import { MORE_CHECKS as RENDER_MORE_CHECKS, checkMore } from "./checks/visual.mjs";

import {
  CHECKS as CONTENT_CHECKS,
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
// The site's local business (storefront, service-area or hybrid), judged once from every page when the address check
// or the site-wide block first asks.
let localJudged;
const localBusiness = () => (localJudged === undefined ? (localJudged = judgeLocal(htmlPages, shows)) : localJudged); // once, before any request

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
const notes = [];

// ---------- rule and check catalog ----------
const RULES = {
  "CRAWL-01": ["robots.txt lets search engines crawl the site", "Crawling & indexing"],
  "CRAWL-02": ["Pages meant to rank are not set to noindex", "Crawling & indexing"],
  "CRAWL-05": ["Correct HTTP status codes, no soft 404s", "Crawling & indexing"],
  "CRAWL-06": ["Sitemap URLs return 200", "Crawling & indexing"],
  "CRAWL-07": ["No internal links to broken pages", "Crawling & indexing"],
  "CRAWL-08": ["Redirects take one hop and internal links skip them", "Crawling & indexing"],
  "CRAWL-09": ["Bot protection doesn't block real search crawlers", "Crawling & indexing"],
  "URL-01": ["Clean, lowercase, hyphenated URLs", "URLs & canonicals"],
  "URL-02": ["One trailing-slash style, the other variant redirects", "URLs & canonicals"],
  "URL-04": ["Self-referencing, absolute canonical on every indexable page", "URLs & canonicals"],
  "URL-05": ["Every breadcrumb level is a real page", "URLs & canonicals"],
  "URL-07": ["Old URLs redirect to live pages", "URLs & canonicals"],
  "REND-01": ["Content is in the server HTML, not only in JavaScript", "Rendering"],
  "REND-04": ["Links are real <a href> links", "Rendering"],
  "CONTENT-09": ["No placeholder, test or broken-encoding text", "Headings & content"],
  "CONTENT-10": ["No banned or unconfirmed claims on pages", "Headings & content"],
  "META-01": ["Unique titles of a sensible length", "Metadata"],
  "META-02": ["Unique meta descriptions of a sensible length", "Metadata"],
  "META-03": ["Brand appears once in titles", "Metadata"],
  "META-04": ["Open Graph tags for sharing", "Metadata"],
  "META-05": ["Page language declared", "Metadata"],
  "META-09": ["Each title matches what its page is about", "Metadata"],
  "META-10": ["The site has a favicon search results can show", "Metadata"],
  "CONTENT-01": ["Exactly one H1 per page", "Headings & content"],
  "CONTENT-02": ["Heading levels are not skipped", "Headings & content"],
  "CONTENT-04": ["Templated pages have unique content", "Headings & content"],
  "CONTENT-05": ["Indexable pages have substantial content", "Headings & content"],
  "CONTENT-08": ["Images have alt text", "Headings & content"],
  "SCHEMA-01": ["JSON-LD parses without errors", "Structured data"],
  "SHOP-05": ["Product schema from live data", "Structured data"],
  "SCHEMA-02": ["Organization and WebSite schema on the home page", "Structured data"],
  "SCHEMA-03": ["Indexable pages carry structured data", "Structured data"],
  "SCHEMA-04": ["Schema matches what the page visibly shows", "Structured data"],
  "SCHEMA-05": ["No deprecated schema types", "Structured data"],
  "SCHEMA-07": ["BreadcrumbList on pages below the home page", "Structured data"],
  "LOCAL-05": ["Name, address and phone are identical everywhere", "Structured data"],
  "MAP-01": ["XML sitemap exists and is referenced from robots.txt", "Sitemaps & robots"],
  "MAP-02": ["Sitemap lists only canonical, indexable URLs on the right host", "Sitemaps & robots"],
  "MAP-03": ["Indexable pages are in the sitemap", "Sitemaps & robots"],
  "MAP-04": ["Sitemap lastmod dates are real", "Sitemaps & robots"],
  "MAP-05": ["robots.txt blocks only junk, never CSS/JS", "Sitemaps & robots"],
  "MAP-06": ["AI crawler policy is deliberate", "Sitemaps & robots"],
  "MAP-07": ["llms.txt published", "Sitemaps & robots"],
  "LINK-01": ["Pages are within three clicks of the home page", "Internal linking"],
  "LINK-02": ["No orphan pages", "Internal linking"],
  "LINK-05": ["Descriptive anchor text", "Internal linking"],
  "LINK-06": ["Link counts per page stay reasonable", "Internal linking"],
  "PERF-01": ["Core Web Vitals pass on mobile", "Performance"],
  "PERF-03": ["The first image is not lazy-loaded", "Performance"],
  "PERF-04": ["Images reserve their space (width and height)", "Performance"],
  "PERF-09": ["The next page starts loading before the click (speculation rules)", "Performance"],
  "PERF-10": ["Back and Forward are instant (back/forward cache)", "Performance"],
  "PERF-06": ["HTML documents stay lightweight", "Performance"],
  "TRUST-01": ["HTTPS security headers are set", "Trust & security"],
  "TRUST-02": ["security.txt published", "Trust & security"],
  "TRUST-07": ["The HTTPS certificate is trusted, covers every host and renews in time", "Trust & security"],
  "URL-03": ["One host, HTTPS only", "URLs & canonicals"],
  "AI-01": ["Pages are eligible for snippets and AI answers", "AI search"],
  "AI-03": ["Bing/Copilot preferences use the new directives", "AI search"],
  "AI-05": ["Pages work for AI agents that browse", "AI search"],
  "REND-06": ["JavaScript doesn't fight the HTML", "Rendering"],
  "REND-07": ["Mobile shows the same content as desktop", "Rendering"],
  "PERF-07": ["Popups don't block content or crawlers", "Performance"],
  "REND-08": ["HTML stays under Googlebot's 2 MB limit", "Rendering"],
  "META-08": ["hreflang only when there are real language or region versions", "Metadata"],
  "REND-09": ["Pages declare a doctype, a charset and a mobile viewport", "Rendering"],
  "REND-10": ["No obsolete HTML tags (frames, font, center, marquee)", "Rendering"],
  "META-06": ["Robots meta depends on page type, using the object form", "Metadata"],
  "MEDIA-03": ["Each page signals its preferred thumbnail", "Media"],
  "PERF-08": ["Images are a sensible weight and in a modern format", "Performance"],
};

// Types whose Google rich result is retired. One marked keep (FAQPage) is never flagged, but its note still shows.
const GONE = JSON.parse(readFileSync(new URL("./data/google-rich-results.json", import.meta.url), "utf8")).retired;
const RETIRED = GONE.filter(r => !r.keep),
  KEPT = GONE.filter(r => r.keep && r.note);

// key -> [rule, severity, title(n), why, fix]
const CHECKS = {
  "robots-blocks-all": [
    "CRAWL-01",
    "blocker",
    () => "robots.txt blocks the whole site",
    "With `Disallow: /` for every crawler, search engines can't crawl any page, so nothing new gets indexed and existing pages decay.",
    "Allow crawling in production (`Allow: /`). Keep staging out of Google with a noindex header and a password instead.",
  ],
  "robots-server-error": [
    "CRAWL-01",
    "high",
    () => "robots.txt answers with a server error, so Google stops crawling",
    "When robots.txt fails with a 5xx or 429 status, or doesn't answer, Google stops crawling the whole site for the first 12 hours while it retries. After that it uses the last copy it read, for up to 30 days, so rule changes go unseen; if the rest of the site is unreachable too, crawling stops altogether. Only a 404 means “no rules”.",
    "Make `/robots.txt` return 200 with its rules, or 404 if there are none. Check that the server, CDN or framework route that builds it isn't failing, timing out or rate-limiting crawlers.",
  ],
  "sitemap-url-disallowed": [
    "CRAWL-01",
    "high",
    n => `${n} sitemap URL(s) are blocked by robots.txt`,
    "The sitemap asks Google to index these URLs while robots.txt forbids crawling them. Google gets contradictory signals and may index them without content.",
    "Either remove the Disallow rule for these paths or remove the URLs from the sitemap.",
  ],
  "home-noindex": [
    "CRAWL-02",
    "blocker",
    () => "The home page is set to noindex",
    "A noindex home page usually means a staging or launch setting leaked into production. The whole site can drop out of search.",
    "Remove the noindex (meta robots or X-Robots-Tag) in production. Drive it from one environment variable.",
  ],
  "noindex-in-sitemap": [
    "CRAWL-02",
    "high",
    n => `${n} sitemap URL(s) are set to noindex`,
    "The sitemap says “index this” and the page says “don't”. Either the page should rank and the noindex is a bug, or it shouldn't be in the sitemap.",
    "Decide per page type. Remove noindex from pages meant to rank, or drop noindex pages from the sitemap.",
  ],
  "noindex-review": [
    "CRAWL-02",
    "low",
    n => `${n} crawled page(s) are noindex`,
    "Noindex is right for search, filter, account and result pages, and wrong anywhere you want traffic.",
    "Check each against the project's SEO profile. Keep noindex only on page types meant to stay hidden.",
  ],
  "soft-404": [
    "CRAWL-05",
    "high",
    () => "Unknown URLs don't return 404 (soft 404)",
    "A made-up URL returned a page instead of a 404 status. Google wastes crawls on these and may index junk URLs.",
    "Return a real 404 status for unknown paths (and 410 for removed content). Don't redirect unknown URLs to the home page.",
  ],
  "server-error": [
    "CRAWL-05",
    "high",
    n => `${n} URL(s) returned a server error (5xx)`,
    "Repeated 5xx responses make Google crawl less and drop pages from the index.",
    "Find the failing route in the server logs and fix it. A page must not fail because a slow API is down.",
  ],
  "sitemap-bad-status": [
    "CRAWL-06",
    "high",
    n => `${n} sitemap URL(s) don't return 200`,
    "Sitemaps should only list final, working URLs. Redirects and errors in the sitemap waste crawl budget and lower trust in the sitemap.",
    "Generate the sitemap from the same live data the pages use, and list only the final URL of each page.",
  ],
  "broken-internal-link": [
    "CRAWL-07",
    "high",
    n => `${n} internal link target(s) are broken (4xx/5xx)`,
    "Every broken link is a dead end for visitors and crawlers and wastes the authority passed through it.",
    "Fix or remove each link. Filter generated links (related, next, breadcrumbs) through the set of live pages.",
  ],
  "redirect-chain": [
    "CRAWL-08",
    "medium",
    n => `${n} URL(s) redirect through more than one hop`,
    "Each extra hop slows crawling and loses a little signal. Chains also often end somewhere unintended.",
    "Point each old URL straight at its final destination in one 301/308.",
  ],
  "link-to-redirect": [
    "CRAWL-08",
    "low",
    n => `${n} internal link target(s) point at a redirect`,
    "Linking to a redirecting URL costs a hop on every click and crawl.",
    "Update the links to the final URL (often a missing or extra trailing slash).",
  ],
  "googlebot-blocked": [
    "CRAWL-09",
    "high",
    n => `${n} page(s) give Googlebot an error or a noindex that visitors don't get`,
    "Asked with Googlebot's user agent, these pages returned an error or a noindex, while the same request as a visitor got the page. A bot blocker, a firewall rule or a failing prerender service for bots usually does this, and Google drops such pages. A real Googlebot comes from Google's IP addresses, so a firewall that checks IPs can treat it differently than this test shows: some block anything that claims to be Googlebot from other addresses, which is right.",
    "Check the CDN, firewall and bot-protection settings and any prerender service for rules on Googlebot, and let verified Googlebot through. Then run the live test in Search Console's URL Inspection, which uses the real Googlebot.",
  ],
  "googlebot-differs": [
    "CRAWL-09",
    "medium",
    n => `${n} page(s) show Googlebot something different from what visitors get`,
    "Asked with Googlebot's user agent, these pages redirected elsewhere or gave a different canonical, title or much less text than a visitor gets. A prerender service serving stale or broken pages, or code that switches content for bots, does this; showing search engines something other than what visitors see is cloaking under Google's spam policies. A real Googlebot comes from Google's IP addresses, so a firewall that checks IPs can treat it differently than this test shows.",
    "Serve Googlebot the same HTML as visitors: fix or remove the prerender service or bot-specific code, and render pages on the server for everyone. Confirm with the live test in Search Console's URL Inspection.",
  ],
  "googlebot-firewall": [
    "CRAWL-09",
    "needs-decision",
    n => `${n} page(s) turn away requests that claim to be Googlebot`,
    "Asked with Googlebot's user agent, these pages answered 403, 429 or 503 or showed a bot challenge, while the same request as a visitor got the page. A firewall that verifies Google by IP does exactly this, and it's right to: a request that claims to be Googlebot from an address that isn't Google's is a fake, and Cloudflare's fake-Googlebot rule, Wordfence and Sucuri block them. A firewall that goes by the user agent alone blocks the real Googlebot too, and pages then drop out of search. This test runs from this machine, not Google's addresses, so it can't tell the two apart.",
    "Run the live test in Search Console's URL Inspection on one of these pages; it uses the real Googlebot. If it gets the page, the firewall is verifying Google by IP and nothing needs to change. If it doesn't, let verified Googlebot through in the CDN, firewall or bot-protection settings (by Google's IP ranges or the CDN's verified-bots list, not by user agent).",
  ],
  "link-http": [
    "CRAWL-08",
    "medium",
    n => `${n} page(s) link to the site's own pages over http://`,
    "The site runs on HTTPS, so every http:// link to it goes through a redirect on each click and crawl before the page loads, and points search engines at an address that isn't the real one.",
    "Use https:// or a relative path (such as `/pricing/`) in every internal link. Hard-coded http:// links usually sit in old content, menus or a base-URL setting.",
  ],
  "url-format": [
    "URL-01",
    "low",
    n => `${n} URL(s) have uppercase letters, underscores, spaces or double slashes`,
    "Mixed-case and underscored URLs are easy to duplicate and hard to share.",
    "Use lowercase words joined by hyphens. Redirect old variants once.",
  ],
  "trailing-slash-mixed": [
    "URL-02",
    "high",
    n => `${n} page(s) break the site's trailing-slash style`,
    "`/page` and `/page/` are different URLs to search engines. Mixing them splits ranking signals.",
    "Pick one style (record it in the SEO profile), configure the framework to redirect the other, and use it in every link, canonical, sitemap entry and schema URL.",
  ],
  "slash-variant-no-redirect": [
    "URL-02",
    "high",
    n => `${n} page(s) answer 200 on both the slash and no-slash URL`,
    "Both versions return the page, so every page exists twice.",
    "Redirect the non-preferred variant with a 301/308 (in Next.js: `trailingSlash`).",
  ],
  "slash-redirect-temporary": [
    "URL-02",
    "medium",
    n => `${n} page(s) redirect the other trailing-slash form temporarily (302, 303 or 307)`,
    "A temporary redirect tells search engines the other form may come back, so they can keep both URLs and split the page's signals between them.",
    "Make the trailing-slash redirect permanent (301 or 308) in the framework or server config. Hand-written redirects are the usual cause: `res.redirect()` in Express and `redirect_to` in Rails send a 302 unless told otherwise.",
  ],
  "canonical-missing": [
    "URL-04",
    "high",
    n => `${n} indexable page(s) have no canonical tag`,
    "Without a canonical, Google picks one itself among parameter, slash and tracking variants.",
    "Add a self-referencing absolute canonical to every indexable page through the shared metadata helper.",
  ],
  "canonical-multiple": [
    "URL-04",
    "high",
    n => `${n} page(s) declare more than one canonical`,
    "Conflicting canonicals are ignored.",
    "Emit exactly one canonical per page from one place.",
  ],
  "canonical-not-self": [
    "URL-04",
    "medium",
    n => `${n} indexable page(s) canonicalize to a different URL`,
    "That tells Google to rank another URL instead. Right for variants, wrong for pages meant to rank.",
    "Check each against the profile. Pages meant to rank need a canonical to themselves, with the same trailing-slash style.",
  ],
  "noindex-canonical": [
    "CRAWL-02",
    "medium",
    n => `${n} noindex page(s) also name a different page as canonical`,
    "The noindex says “leave this page out of search” while the canonical says “this is a copy of that page, rank that one instead”. Google has called the pair contradictory: it may ignore the canonical, or carry the noindex over to the page it points at.",
    "Pick one per page. A duplicate of another page keeps the canonical and drops the noindex; a page that should stay out of search keeps the noindex and points its canonical at itself, or has none.",
  ],
  "canonical-query": [
    "URL-04",
    "high",
    n => `${n} canonical(s) contain a query string`,
    "Canonicals built from the request URL leak `?utm_` and other parameters, creating duplicates.",
    "Build canonicals from the clean path, never from the incoming request URL.",
  ],
  "canonical-origin": [
    "URL-04",
    "high",
    n => `${n} canonical(s) point at the wrong host`,
    "Canonicals on staging, localhost or the wrong www/https variant send signals to the wrong site.",
    "Set the base URL (e.g. `metadataBase`) from one production origin setting.",
  ],
  "canonical-bad-target": [
    "URL-04",
    "high",
    n => `${n} canonical target(s) don't return 200`,
    "A canonical pointing at a redirect or error is ignored.",
    "Point canonicals at the final, working URL.",
  ],
  "breadcrumb-dead-level": [
    "URL-05",
    "high",
    n => `${n} breadcrumb level URL(s) don't return 200`,
    "Every breadcrumb level except the last is a link on every page below it. A missing hub page is a broken link sitewide.",
    "Create a real hub page for each level, or fix the breadcrumb URL.",
  ],
  "client-rendered": [
    "REND-01",
    "blocker",
    n => `${n} page(s) have almost no content in the server HTML`,
    "The HTML the server sends is nearly empty, so crawlers that don't run JavaScript (most AI crawlers, and Google's first pass) see a blank page.",
    "Server-render or pre-render page content. Only interactive widgets should depend on client JavaScript.",
  ],
  "title-missing-sitewide": [
    "META-01",
    "blocker",
    n => `${n} indexable pages have no title, or all share one default title`,
    "The title is the headline in search results. With none, or one default title such as “Create Next App” on almost every page, search engines write their own and every page looks the same.",
    "Give every page a unique title through the shared metadata helper.",
  ],
  "h1-missing-sitewide": [
    "CONTENT-01",
    "blocker",
    n => `${n} indexable pages have no H1`,
    "Almost no page states its topic in a main heading, so search engines have to guess what each page is about.",
    "Give every page template one H1 that names the page's topic.",
  ],
  "canonical-missing-sitewide": [
    "URL-04",
    "blocker",
    n => `${n} indexable pages have no canonical tag`,
    "With no canonicals anywhere, search engines choose among the slash, parameter and tracking variants of every page themselves.",
    "Add a self-referencing absolute canonical to every indexable page through the shared metadata helper.",
  ],
  "title-multiple": [
    "META-01",
    "high",
    n => `${n} page(s) have more than one <title>`,
    "Two titles usually mean a hard-coded layout title plus a page title, or two SEO plugins. Search engines may pick the wrong one.",
    "Emit the title from one place only.",
  ],
  "href-hash": [
    "REND-04",
    "low",
    n => `${n} page(s) have links without a real destination (href="#", javascript:, or no href)`,
    "Crawlers only follow real URLs. Click-handler navigation hides pages from search engines.",
    "Use real `<a href>` links for navigation and `<button>` for actions.",
  ],
  "placeholder-text": [
    "CONTENT-09",
    "high",
    n => `${n} page(s) show placeholder, test or broken-encoding text`,
    "Lorem ipsum, TODO, template tokens or mangled characters on a live page look unfinished to visitors and quality reviewers.",
    "Replace the text with real content and add a build check that fails on these strings.",
  ],
  "doc-basics": [
    "REND-09",
    "medium",
    n => `${n} page(s) lack a doctype, a charset or a mobile viewport`,
    "Without a doctype browsers fall back to quirks mode; without a viewport the page renders as a zoomed-out desktop page on phones, and Google indexes the mobile version.",
    'Start every page with `<!doctype html>`, `<meta charset="utf-8">` and `<meta name="viewport" content="width=device-width, initial-scale=1">` in the shared layout.',
  ],
  "charset-mismatch": [
    "REND-09",
    "medium",
    n => `${n} page(s) name one character set in the server header and another in the HTML`,
    "Browsers and search engines follow the server's Content-Type header over the page's own meta tag. If the page was saved in the encoding its meta tag names, accented letters, curly quotes and symbols turn into garbage on screen and in search snippets.",
    'Save and serve pages as UTF-8, and make the header (`Content-Type: text/html; charset=utf-8`) and `<meta charset="utf-8">` agree. The header usually comes from the server or CDN settings.',
  ],
  "obsolete-tags": [
    "REND-10",
    "low",
    n => `${n} page(s) use obsolete HTML tags`,
    "Tags such as `<frameset>`, `<frame>`, `<marquee>`, `<blink>`, `<font>` and `<center>` were dropped from HTML years ago. Frames split a page into separate documents that search engines index on their own, and the others are old styling that makes a page look and behave dated.",
    "Replace frames with ordinary pages (an `<iframe>` is fine for embeds), and move what `<font>`, `<center>`, `<marquee>` and `<blink>` do into CSS.",
  ],
  "meta-refresh": [
    "CRAWL-08",
    "medium",
    n => `${n} page(s) redirect with a meta refresh`,
    "A meta refresh is a slow, client-side redirect. Search engines may treat it as a redirect or may index the empty page; visitors see a flash first.",
    "Replace it with a server-side 301/308 redirect to the final URL.",
  ],
  "og-url-mismatch": [
    "META-04",
    "low",
    n => `${n} page(s) have an og:url that differs from the canonical`,
    "Shares then point at a different URL from the one search engines rank, splitting share counts and signals.",
    "Build og:url from the same value as the canonical in the metadata helper.",
  ],
  "robots-conflict": [
    "META-06",
    "high",
    n => `${n} page(s) get contradicting robots rules from the meta tag and the X-Robots-Tag header`,
    "When the two disagree, search engines follow the stricter one, so a page that says “index” in its HTML can still be dropped by a header nobody looks at.",
    "Set robots in one place. Remove the header rule (often a CDN or server config) or make the meta tag match it.",
  ],
  "page-nofollow": [
    "META-06",
    "medium",
    n => `${n} indexable page(s) tell search engines not to follow any of their links (nofollow)`,
    "A page-wide `nofollow` (or `none`) in the robots meta tag or the X-Robots-Tag header stops Google following every link on the page, so the pages it links to are found later and get nothing from it. It's usually a leftover staging setting or a plugin default.",
    'Use `index, follow` (or no robots rule) on pages meant to rank. Put `rel="nofollow"` on the single links that need it instead.',
  ],
  "no-large-preview": [
    "MEDIA-03",
    "low",
    n => `${n} indexable page(s) don't allow large image previews`,
    "Without `max-image-preview:large`, Google shows small thumbnails at most, and pages are less likely to appear with large images in Discover.",
    "Add `max-image-preview:large` to the robots meta of indexable pages through the metadata helper.",
  ],
  "heavy-image": [
    "PERF-08",
    "low",
    n => `${n} image(s) weigh over 200 KB`,
    "Heavy images slow down the largest paint on mobile connections and cost visitors data.",
    "Resize images to their displayed size and compress them, or serve them through the framework's image optimiser.",
  ],
  "legacy-image-format": [
    "PERF-08",
    "low",
    n => `${n} image(s) over 100 KB are served as JPEG or PNG`,
    "WebP and AVIF are usually 25–50% smaller at the same quality, and every current browser supports them.",
    "Serve WebP or AVIF (most image CDNs and framework image components do this from the Accept header).",
  ],
  "mixed-content": [
    "TRUST-01",
    "low",
    n => `${n} HTTPS page(s) load resources over plain HTTP`,
    "Browsers block or warn about insecure resources on secure pages.",
    "Load every resource over HTTPS.",
  ],
  "title-missing": [
    "META-01",
    "high",
    n => `${n} page(s) have no title`,
    "The title is the main headline in search results.",
    "Give every page a unique title through the shared metadata helper.",
  ],
  "title-long": [
    "META-01",
    "medium",
    n => `${n} title(s) are longer than 60 characters`,
    "Long titles get cut off in results, often losing the brand or the key phrase.",
    "Keep titles under about 60 characters, main keyword first.",
  ],
  "title-short": [
    "META-01",
    "low",
    n => `${n} title(s) are shorter than 20 characters`,
    "Very short titles waste the most visible spot in results.",
    "Describe the page: what it is and who it's for, in under 60 characters.",
  ],
  "title-dup": [
    "META-01",
    "high",
    n => `${n} title(s) are shared by more than one page`,
    "Duplicate titles make pages compete with each other and look templated.",
    "Make each title unique, usually by including the page's specific subject.",
  ],
  "title-brand-twice": [
    "META-03",
    "low",
    n => `${n} title(s) repeat the brand`,
    "A title template plus a title that already has the brand doubles it.",
    "Use an absolute title when the brand is already present, or drop it from the page title.",
  ],
  "title-mismatch": [
    "META-09",
    "low",
    n => `${n} page(s) have a title that doesn't match their content`,
    "None of the main words in the title appear anywhere on the page. Google often rewrites such titles in results, and visitors who click expecting one thing find another. It's usually a copied template or a title left over from an older page.",
    "Rewrite the title to name what the page actually covers, using the words of its heading and text.",
  ],
  "desc-missing": [
    "META-02",
    "medium",
    n => `${n} page(s) have no meta description`,
    "Google then writes its own snippet, often from navigation text.",
    "Write a unique 120–160 character description per page: what you get and why.",
  ],
  "desc-length": [
    "META-02",
    "low",
    n => `${n} description(s) are outside 120–160 characters`,
    "Short descriptions undersell the page; long ones get cut off.",
    "Aim for 120–160 characters.",
  ],
  "desc-dup": [
    "META-02",
    "medium",
    n => `${n} description(s) are shared by more than one page`,
    "Duplicate descriptions signal templated pages.",
    "Write a specific description for each page.",
  ],
  "og-missing": [
    "META-04",
    "low",
    n => `${n} page(s) lack og:title or og:image`,
    "Without og:title and og:image, shared links on Slack, LinkedIn and X show a bare URL instead of a card. Where og:description is listed too, the page has no description at all, so each platform guesses its text from the page or shows none.",
    "Emit Open Graph and Twitter tags from the metadata helper, with a default image and per-page images for key pages, and og:description from the page's meta description.",
  ],
  "og-image-broken": [
    "META-04",
    "medium",
    n => `${n} share image(s) don't load`,
    "The og:image URL doesn't return an image, so shared links show no picture and Google can't use it as the page's thumbnail.",
    "Point og:image at an absolute URL on the public site that returns the image with status 200. A moved file or the wrong host in the metadata helper is the usual cause.",
  ],
  "og-image-no-size": [
    "META-04",
    "low",
    n => `${n} page(s) don't declare their share image's size`,
    "Without og:image:width and og:image:height, Facebook and LinkedIn have to download the image before they can lay out the card, so the first share of a page often shows no image.",
    "Emit `og:image:width` and `og:image:height` next to og:image in the metadata helper.",
  ],
  "twitter-card-missing": [
    "META-04",
    "low",
    n => `${n} page(s) have a share image but no twitter:card`,
    "X shows a large image card only when the page asks for one with twitter:card. Without it, X shows at most a small card with a thumbnail, and only when og:type, og:title and og:description are all set.",
    'Add `<meta name="twitter:card" content="summary_large_image">` next to og:image in the metadata helper. X takes the title, description and image from the Open Graph tags.',
  ],
  "twitter-card-invalid": [
    "META-04",
    "low",
    n => `${n} page(s) have a twitter:card value X doesn't know`,
    "X has four card types: summary, summary_large_image, app and player. Any other value, old ones such as gallery, photo and product included, names a card X can't show.",
    "Set twitter:card to `summary_large_image` for pages with a share image, or `summary` for a small square one.",
  ],
  "og-image-small": [
    "MEDIA-03",
    "low",
    n => `${n} share image(s) are narrower than 1200 px`,
    "Google Discover and the large link cards on X, LinkedIn and Facebook need images at least 1200 px wide. Smaller ones show as a small thumbnail or not at all.",
    "Use share images of at least 1200 × 630 px (1.91:1), as a sitewide default and for each key page.",
  ],
  "lang-missing": [
    "META-05",
    "low",
    n => `${n} page(s) don't declare a language`,
    "`<html lang>` helps search engines and screen readers.",
    "Set `lang` on the `<html>` element in the root layout.",
  ],
  "favicon-missing": [
    "META-10",
    "medium",
    () => "The site has no favicon that loads",
    "Google shows the site's favicon next to its name in search results. Without one that loads, results show a generic globe icon, which looks unfinished next to other sites' logos.",
    'Add `<link rel="icon" href="/favicon.png">` to the home page\'s `<head>`, pointing at a square PNG or ICO of at least 48 × 48 px that returns 200. Keep its URL stable and don\'t block it in robots.txt.',
  ],
  "favicon-unsuitable": [
    "META-10",
    "low",
    () => "The favicon is small, not square, or in a format Google Search doesn't list",
    "Google needs a square favicon and recommends one larger than 48 × 48 px. It lists BMP, GIF, ICO, PNG, JPEG, PPM and TIFF as the formats it supports, so an SVG or WebP icon on its own may not show, and a 16 or 32 px icon looks blurred beside results.",
    'Add a square PNG of at least 48 × 48 px (192 × 192 works everywhere), for example `<link rel="icon" href="/icon-192.png" sizes="192x192">`, next to any SVG icon.',
  ],
  "h1-count": [
    "CONTENT-01",
    "high",
    n => `${n} page(s) don't have exactly one H1`,
    "The H1 states the page's topic. None leaves it unclear; several dilute it.",
    "Give every page one H1 matching its main topic. Logos and card titles are not H1s.",
  ],
  "heading-skip": [
    "CONTENT-02",
    "medium",
    n => `${n} page(s) skip heading levels`,
    "Skipped levels break the outline search engines and screen readers use.",
    "Nest headings in order (H1 → H2 → H3). Style with CSS, not heading levels.",
  ],
  "near-duplicate": [
    "CONTENT-04",
    "high",
    n => `${n} pair(s) of indexable pages share most of their main content`,
    "Pages that differ only by a swapped name (a city, product or tool) look like doorway or scaled content. Google can filter them out or hold down the whole site.",
    "Give each page its own substance: specific details, local proof, its own intro and FAQs. Merge or noindex pages that can't be made unique.",
  ],
  "faq-reused": [
    "CONTENT-04",
    "medium",
    n => `${n} FAQ question(s) are reused on more than one page`,
    "Identical FAQs across pages add nothing unique and signal templated content.",
    "Give each page questions specific to it, and keep shared questions on one FAQ page.",
  ],
  "banned-claim": [
    "CONTENT-10",
    "high",
    n => `${n} page(s) contain banned text`,
    "Banned claims (years, licences, guarantees, prices the owner has ruled out) are a legal and trust risk. Matches are leads: read the context, because an honest denial (“No, we don't work 24/7”) is fine.",
    "Remove or reword the claim at its source, and keep the banned list in a build check.",
  ],
  "unconfirmed-claim": [
    "CONTENT-10",
    "needs-decision",
    n => `${n} page(s) contain claims the owner hasn't confirmed`,
    "Unconfirmed claims become false advertising if they turn out wrong.",
    "Ask the owner to confirm each claim. Until then, hold the text or the pages.",
  ],
  "redirect-broken": [
    "URL-07",
    "high",
    n => `${n} old URL(s) end in an error instead of a live page`,
    "Old URLs carry backlinks, bookmarks and printed links. If they end in a 404 or a loop, that traffic and authority is lost.",
    "Point each old URL at its closest live page with one 301/308, covering both trailing-slash forms.",
  ],
  "old-url-temporary": [
    "URL-07",
    "medium",
    n => `${n} old URL(s) redirect temporarily (302, 303 or 307)`,
    "A temporary redirect tells search engines the old URL may come back, so they keep it in results and are slow to pass its links and ranking on to the new page.",
    "For a move that's for good, use a 301 or 308 (in Next.js `permanent: true`; in Express `res.redirect(301, …)`).",
  ],
  "thin-page": [
    "CONTENT-05",
    "medium",
    n => `${n} indexable page(s) have fewer than 150 words`,
    "Thin pages rarely rank and can lower the site's overall quality signals.",
    "Add useful, specific content, merge the page into a stronger one, or noindex it until it grows.",
  ],
  "img-alt": [
    "CONTENT-08",
    "low",
    n => `${n} page(s) have images without an alt attribute`,
    'Alt text describes images to screen readers and image search. Decorative images still need `alt=""`.',
    "Add descriptive alt text to meaningful images and empty alt to decorative ones.",
  ],
  "jsonld-invalid": [
    "SCHEMA-01",
    "high",
    n => `${n} page(s) have JSON-LD that doesn't parse`,
    "Invalid JSON-LD is ignored completely.",
    "Generate JSON-LD with JSON.stringify from data, escape `<`, and validate templates in the Rich Results Test.",
  ],
  "schema-not-jsonld": [
    "SCHEMA-01",
    "low",
    n => `${n} page(s) mark up structured data only in Microdata or RDFa`,
    "Google reads Microdata and RDFa too, so these pages aren't missing structured data. But Google recommends JSON-LD as the easiest to keep right, and this audit validates JSON-LD only, so the markup on these pages wasn't checked for errors or missing fields.",
    "Move the markup to one JSON-LD block built from the page's data (keep the Microdata until the JSON-LD is live), or check these templates in Google's Rich Results Test.",
  ],
  "org-missing": [
    "SCHEMA-02",
    "medium",
    () => "The home page has no Organization (or business) schema",
    "Organization schema identifies who runs the site and anchors every other schema node.",
    "Add one Organization (or the right LocalBusiness subtype) node in the root layout with a stable `@id`.",
  ],
  "website-missing": [
    "SCHEMA-02",
    "low",
    () => "The home page has no WebSite schema",
    "WebSite schema names the site and links pages to the organization.",
    "Add a WebSite node with a stable `@id` and `publisher` pointing at the organization.",
  ],
  "jsonld-none": [
    "SCHEMA-03",
    "low",
    n => `${n} indexable page(s) have no structured data`,
    "Schema tells search and AI engines what each page is.",
    "Add the schema type the profile assigns to each page type.",
  ],
  "nap-not-shown": [
    "LOCAL-05",
    "medium",
    n => `${n} page(s) give a phone number or street address in their business schema that visitors can't see`,
    "Google checks structured data against the visible page, and local rankings lean on the name, address and phone reading the same in the schema, on the site and on the Google Business Profile. A number or address that is only in the schema, or differs from the one shown, weakens that match.",
    "Show the same phone number and street address as the schema, on the page or in the site-wide footer, from one business-details setting that feeds both. With call tracking, keep the real number in the HTML and swap the tracking number in on the client.",
  ],
  "faq-not-visible": [
    "SCHEMA-04",
    "high",
    n => `${n} page(s) mark up FAQ questions that aren't in the page`,
    "Schema that describes content the page doesn't show breaks Google's guidelines and can bring a manual action.",
    "Build FAQPage from the same array that renders the visible FAQ, or remove it.",
  ],
  "rating-review": [
    "SCHEMA-04",
    "needs-decision",
    n => `${n} page(s) carry ratings or reviews in schema`,
    "Ratings must come from real reviews that are visible on the page. Invented or unsourced ratings risk a manual action that removes rich results sitewide.",
    "Confirm each rating's source. Keep it only if real reviews are shown on the page; otherwise remove it.",
  ],
  "deprecated-schema": [
    "SCHEMA-05",
    "low",
    n => `${n} page(s) use schema with no rich result (${RETIRED.map(r => r.type).join(", ")})`,
    `Google ended ${RETIRED.map(r => `${r.feature} (${r.since.slice(0, 4)})`).join(", ")}. The markup does no harm but earns nothing.`,
    "Remove it, or keep it knowingly. Don't promise these rich results.",
  ],
  "breadcrumb-missing": [
    "SCHEMA-07",
    "medium",
    n => `${n} page(s) below the home page have no BreadcrumbList`,
    "Breadcrumb rich results still show in Google and clarify site structure.",
    "Render BreadcrumbList from the same array as the visible breadcrumb.",
  ],
  "sitemap-missing": [
    "MAP-01",
    "high",
    () => "No XML sitemap found",
    "Without a sitemap, new and deep pages are found slowly.",
    "Generate `/sitemap.xml` from the live content data and reference it in robots.txt.",
  ],
  "sitemap-not-in-robots": [
    "MAP-01",
    "low",
    () => "robots.txt doesn't reference the sitemap",
    "The `Sitemap:` line lets every crawler find it without manual submission.",
    "Add `Sitemap: https://…/sitemap.xml` (absolute URL) to robots.txt.",
  ],
  "sitemap-invalid": [
    "MAP-01",
    "high",
    n => `Google can't read ${n} sitemap(s): not valid XML`,
    "A sitemap is read as XML, and XML with one mistake in it (a bare `&` in a URL, a tag that isn't closed, text before `<?xml`, or an HTML page in its place) can't be read. Search Console reports it as a sitemap error, and the URLs in it may never be found from it.",
    "Build the sitemap with the framework's sitemap helper or an XML library instead of joining strings: it writes `&` as `&amp;` and closes every tag. Make sure nothing (a blank line, a PHP notice) is printed before `<?xml`, and that the sitemap URL serves the XML file, not a page.",
  ],
  "sitemap-too-big": [
    "MAP-01",
    "medium",
    n => `${n} sitemap file(s) are over the 50,000-URL or 50 MB limit`,
    "One sitemap file may list at most 50,000 URLs and be at most 50 MB uncompressed. Search Console reports a bigger file as an error, and the URLs past the limit may be ignored.",
    "Split it into sitemaps of up to 50,000 URLs each (one per section works well), list them in a sitemap index (`<sitemapindex>`), and reference the index in robots.txt.",
  ],
  "news-sitemap-tags": [
    "MAP-01",
    "medium",
    n => `${n} news sitemap(s) have articles without Google News's required tags`,
    "Every `<news:news>` entry needs `<news:publication>` with `<news:name>` and `<news:language>`, a `<news:publication_date>` in W3C format, and `<news:title>`. Google reports entries without them as errors and can't use them for news.",
    "Generate each entry from the article record: the publication's name as Google News shows it, an ISO 639 language code (`en`), the time it was first published (`2026-11-17T10:30:00+00:00`) and the headline as it appears on the page.",
  ],
  "news-sitemap-too-many": [
    "MAP-01",
    "medium",
    n => `${n} news sitemap(s) list more than 1,000 articles`,
    "A news sitemap may hold at most 1,000 `<news:news>` entries. Google may skip the rest.",
    "Keep only the last two days of articles in it, and split it into more news sitemaps if that's still over 1,000.",
  ],
  "news-sitemap-old": [
    "MAP-01",
    "low",
    n => `${n} news sitemap(s) list articles older than two days`,
    "Google wants only articles first published in the last two days in a news sitemap. Older ones add noise and push the file toward its 1,000-article limit.",
    "Drop articles older than two days from the news sitemap, or remove their `<news:news>` block; the regular sitemap keeps listing them.",
  ],
  "sitemap-origin": [
    "MAP-02",
    "high",
    n => `${n} sitemap URL(s) use a different host than the site`,
    "Sitemaps listing localhost, staging or the wrong www/https variant point Google at the wrong site.",
    "Build sitemap URLs from one production origin setting.",
  ],
  "sitemap-noncanonical": [
    "MAP-02",
    "high",
    n => `${n} sitemap URL(s) canonicalize elsewhere`,
    "Only canonical URLs belong in the sitemap.",
    "List the canonical URL, or fix the page's canonical.",
  ],
  "missing-from-sitemap": [
    "MAP-03",
    "medium",
    n => `${n} indexable page(s) are missing from the sitemap`,
    "Pages outside the sitemap are discovered and refreshed more slowly.",
    "Generate the sitemap from the same data as the pages so nothing is left out.",
  ],
  "sitemap-lastmod-same": [
    "MAP-04",
    "low",
    () => "Every sitemap lastmod has the same date",
    "Identical dates usually mean the build time was used. Google learns to ignore lastmod that isn't accurate.",
    "Use each record's real last-updated date.",
  ],
  "sitemap-lastmod-future": [
    "MAP-04",
    "low",
    n => `${n} sitemap(s) have lastmod dates in the future`,
    "A page can't have changed after today. Google uses lastmod only on sites where it proves accurate, so impossible dates teach it to ignore the sitemap's dates.",
    "Use each record's real last-updated date, never a scheduled or generated one.",
  ],
  "sitemap-lastmod-invalid": [
    "MAP-04",
    "low",
    n => `${n} sitemap(s) have lastmod values that aren't W3C dates`,
    "Search engines read lastmod only in W3C Datetime format (`2026-11-17` or `2026-11-17T10:30:00+00:00`) and ignore anything else.",
    "Write lastmod as `YYYY-MM-DD` or a full datetime with a timezone (for example with `toISOString()`).",
  ],
  "robots-missing": [
    "MAP-05",
    "medium",
    () => "robots.txt is missing",
    "Crawlers expect it; without it the sitemap isn't advertised and nothing is excluded.",
    "Serve robots.txt that allows crawling, blocks only junk, and lists the sitemap.",
  ],
  "robots-blocks-assets": [
    "MAP-05",
    "medium",
    n => `robots.txt blocks ${n} asset path(s) needed to render pages`,
    "Google renders pages with their CSS and JavaScript. Blocking them can make pages look broken to Google.",
    "Remove Disallow rules for script, style and framework asset paths.",
  ],
  "ai-bots-blocked": [
    "MAP-06",
    "needs-decision",
    n => `robots.txt blocks ${n} AI crawler(s)`,
    "Blocking AI crawlers can keep the site out of ChatGPT, Claude, Perplexity and Google AI answers.",
    "Confirm this is deliberate. A common middle ground blocks training crawlers and allows search crawlers.",
  ],
  "content-signal-invalid": [
    "MAP-06",
    "low",
    n => `robots.txt has ${n} invalid Content-Signal value(s)`,
    "Content-Signal states how AI systems may use the content (search, ai-input, ai-train), each set to yes or no, and Cloudflare is testing a fourth field, use (immediate, reference or full). Anything else is ignored, so the stated preference doesn't apply.",
    "Use only `search`, `ai-input` and `ai-train`, each `yes` or `no`, and optionally `use=immediate`, `use=reference` or `use=full`, for example `Content-Signal: search=yes, ai-train=no`.",
  ],
  "markdown-no-vary": [
    "AI-05",
    "low",
    () => "Markdown responses don't send Vary: Accept",
    "The site returns Markdown to agents that ask for it, but without `Vary: Accept` a cache or CDN can serve that Markdown to browsers, or HTML to agents.",
    "Send `Vary: Accept` with every response whose body depends on the Accept header.",
  ],
  "llms-structure": [
    "MAP-07",
    "low",
    () => "llms.txt doesn't follow the llms.txt format",
    "The format starts with a `# Site name` heading, then a short summary and Markdown lists of links. Tools that read llms.txt expect that structure.",
    "Start with `# Site name`, add a one-line `>` summary, then sections of `- [Page](url): description` links.",
  ],
  "product-aggregate-offer": [
    "SHOP-05",
    "medium",
    n => `${n} product page(s) use AggregateOffer for a single offer`,
    "Merchant listings need an `Offer`. `AggregateOffer` is meant for several sellers, so a shop's own product may not qualify for the shopping features.",
    "Emit an `Offer` with `price`, `priceCurrency` and `availability` for products you sell yourself.",
  ],
  "product-no-shipping": [
    "SHOP-05",
    "low",
    n => `${n} product page(s) have no shipping details in their schema`,
    "Shipping costs and delivery times can show in Google's merchant listings; without them the listing is less complete.",
    "Add `shippingDetails` to each Offer, or a site-wide shipping policy (`hasShippingService` on the Organization).",
  ],
  "product-no-returns": [
    "SHOP-05",
    "low",
    n => `${n} product page(s) have no return policy in their schema`,
    "The return policy can show in merchant listings and helps shoppers choose.",
    "Add `hasMerchantReturnPolicy` to each Offer, or once on the Organization.",
  ],
  "product-image-small": [
    "SHOP-05",
    "low",
    n => `${n} product image(s) are under 50,000 pixels`,
    "Google recommends Product images of at least 50,000 pixels (width × height, such as 250 × 200) for merchant listings. Smaller ones make a weak listing in shopping results and may not be shown.",
    "Use product photos of at least 50,000 pixels, ideally several high-resolution ones in 16:9, 4:3 and 1:1, and list them in the Product schema's `image`.",
  ],
  "product-price-mismatch": [
    "SHOP-05",
    "high",
    n => `${n} product page(s) show a different price from their schema`,
    "Google checks structured data against the visible page; a price mismatch can remove the product's rich results or get the listing disapproved.",
    "Generate the schema price from the same data the page displays.",
  ],
  "deep-page": [
    "LINK-01",
    "low",
    n => `${n} page(s) are more than three clicks from the home page`,
    "Deep pages are crawled less often and look less important.",
    "Link them from hubs or related-content blocks.",
  ],
  "orphan": [
    "LINK-02",
    "medium",
    n => `${n} sitemap page(s) have no internal links pointing to them`,
    "A page only reachable through the sitemap looks unimportant and gets little authority.",
    "Link each one from its hub and from related pages.",
  ],
  "generic-anchor": [
    "LINK-05",
    "low",
    n => `${n} page(s) use generic link text like “click here” or “read more”`,
    "Anchor text tells search engines what the target is about.",
    "Use descriptive anchors such as “check your DMARC record”.",
  ],
  "link-no-text": [
    "LINK-05",
    "medium",
    n => `${n} page(s) have links with no text`,
    "A link with no text, label or image alt tells search engines nothing about the page it points to, and screen readers announce it only as “link”. Icon-only links (social icons, a logo, a cart) are the usual cause.",
    'Give each link visible text, an `aria-label` for icon-only links (`<a href="/cart/" aria-label="Cart">`), or alt text on the image inside it.',
  ],
  "too-many-links": [
    "LINK-06",
    "low",
    n => `${n} page(s) have more than 150 internal links`,
    "Huge link blocks pass little to each target and read like link farms.",
    "Cap related blocks and keep the footer to hubs.",
  ],
  "lazy-lcp": [
    "PERF-03",
    "low",
    n => `${n} page(s) lazy-load the first image`,
    "If the first image is the largest element, lazy-loading it delays LCP. A lazy-loading script (an image whose real file is in `data-src` behind a placeholder) delays it even more, as the script has to run first.",
    'Load the hero image eagerly with high priority (`priority` / `fetchpriority="high"`). In a lazy-loading plugin (Perfmatters, EWWW, WP Rocket, LiteSpeed), exclude the first images or the hero.',
  ],
  "render-blocking": [
    "PERF-03",
    "low",
    n => `${n} page(s) hold up their first paint with scripts or many stylesheets in the <head>`,
    "The browser stops drawing the page until each `<script src>` in the head without `async` or `defer` has downloaded and run, and until every stylesheet has loaded. That delays the first paint and the largest one (LCP), most on slow phones.",
    'Add `defer` to head scripts (or move them to the end of the body); keep only scripts that must run first, such as a consent manager, blocking. Combine stylesheets, load page-specific CSS only where it\'s used, and load non-critical CSS with `media="print" onload="this.media=\'all\'"`.',
  ],
  "img-dimensions": [
    "PERF-04",
    "low",
    n => `${n} page(s) have images without width and height`,
    "Images without dimensions shift the layout as they load (CLS).",
    "Set width and height (or an aspect-ratio box) on every image.",
  ],
  "no-speculation-rules": [
    "PERF-09",
    "low",
    () => "No page asks the browser to start loading the next page early (speculation rules)",
    "Speculation rules let Chrome and Edge start loading a page as soon as a visitor shows they're about to open it (hovering over or pressing a link), so it appears almost at once. A few lines in the shared layout turn this on for the whole site; other browsers ignore them.",
    'Add `<script type="speculationrules">{"prefetch":[{"where":{"href_matches":"/*"},"eagerness":"moderate"}]}</script>` to the shared layout, or send a `Speculation-Rules` header from the server or CDN. Leave out links that change something (log out, add to cart) with a `not` condition.',
  ],
  "bfcache-no-store": [
    "PERF-10",
    "low",
    n => `${n} page(s) are sent with Cache-Control: no-store, which can make Back and Forward reload them`,
    "Browsers keep recently visited pages in memory so Back and Forward show them instantly (the back/forward cache). Other browsers may leave out pages sent with `no-store`; Chrome now keeps them, but only for 3 minutes and not once a cookie changes, so visitors going back often wait for a full reload.",
    "Keep `no-store` for pages with private data (account, checkout). For pages that must always be fresh, send `Cache-Control: no-cache` or `max-age=0` instead: browsers still check for updates, and the page can be kept for Back and Forward.",
  ],
  "bfcache-unload": [
    "PERF-10",
    "low",
    n => `${n} page(s) have an unload handler, which keeps them out of the back/forward cache`,
    "Browsers keep recently visited pages in memory so Back and Forward show them instantly. Firefox leaves out any page with an `unload` handler, and so does Chrome wherever it still runs them; Chrome is phasing `unload` out, so the code may not run at all.",
    "Replace `unload` with `pagehide`, or with `visibilitychange` for sending analytics and saving state. Only inline code was read: with outside checks on, Chrome's own test also catches handlers that third-party scripts add.",
  ],
  "nosnippet": [
    "AI-01",
    "high",
    n => `${n} indexable page(s) block snippets (nosnippet or max-snippet:0)`,
    "Pages that block snippets can't appear as text snippets or be used in Google's AI Overviews and AI Mode.",
    "Remove nosnippet/max-snippet:0 from pages meant to be found; use data-nosnippet on specific sections instead.",
  ],
  "html-over-2mb": [
    "REND-08",
    "high",
    n => `${n} page(s) send more than 2 MB of HTML`,
    "Googlebot reads only the first 2 MB of each HTML response. Anything after that isn't indexed.",
    "Move bulky inline data (hydration JSON, long lists) out of the HTML and keep head tags early.",
  ],
  "html-size": [
    "PERF-06",
    "low",
    n => `${n} page(s) send more than 500 KB of HTML`,
    "Very large HTML slows the first render and often means inlined data that isn't needed.",
    "Move bulky data out of the HTML and paginate long lists.",
  ],
  "dom-size": [
    "PERF-06",
    "low",
    n => `${n} page(s) have more than 1,400 HTML elements`,
    "Every element costs memory and makes each style and layout change slower, so very large pages react late to taps and clicks on phones. Lighthouse flagged pages over about 1,400 elements until version 13. This is counted from the HTML the server sends, so scripts may add more.",
    "Trim repeated markup: paginate or load long lists in parts, drop wrapper `<div>`s, keep inline SVG icons lean, and build menus and pop-ups only when they open.",
  ],
  "sec-headers": [
    "TRUST-01",
    "low",
    n => `The site is missing ${n} recommended security header(s)`,
    "Security headers protect visitors and are a trust signal, especially for technical audiences.",
    "Add the missing headers at the server or framework level.",
  ],
  "security-txt": [
    "TRUST-02",
    "low",
    () => "No /.well-known/security.txt",
    "security.txt tells researchers how to report vulnerabilities.",
    "Publish one following RFC 9116 with Contact and Expires.",
  ],
};

Object.assign(CHECKS, HREFLANG_CHECKS, TLS_CHECKS, SPEED_CHECKS, RENDER_CHECKS, VISUAL_CHECKS);

Object.assign(CHECKS, AGENT_CHECKS);

Object.assign(CHECKS, BUSINESS_CHECKS);

Object.assign(CHECKS, TECH_CHECKS, OUTBOUND_CHECKS);

Object.assign(CHECKS, {
  "desc-starts-with-title": [
    "META-02",
    "low",
    n => `${n} description(s) start by repeating the page title`,
    "Search results show the title right above the description, so a description that opens with the title spends its first, most-read words saying it again.",
    "Open the description with what the page offers or answers, and leave the title's words to the title.",
  ],
});

// Medium, as browsers block http:// scripts, stylesheets and frames on an https page outright. Also raised for head
// and media resources by insecureResources in checks/technical.mjs.
CHECKS["mixed-content"] = [
  "TRUST-01",
  "medium",
  n => `${n} HTTPS page(s) load files over plain http://`,
  "Browsers block http:// scripts, stylesheets, preloads, frames and embeds on an https page, so styles or features break, and they upgrade or block http:// images, video and audio, which then fail if the other server has no https. Chrome also stops showing the page as fully secure.",
  "Load every file over https:// (or a relative URL): fix the theme, template or CMS setting that writes http://. While that's done, `Content-Security-Policy: upgrade-insecure-requests` makes browsers ask for https:// themselves.",
];
Object.assign(CHECKS, SERVER_CHECK);
// Every finding and note passes through lib/redact.mjs on the way in, whichever check adds it: secret query values
// and home folders in findings, and email addresses too in notes, which carry error messages.
// @ts-expect-error TS2630: add is a function declaration, and no annotation allows reassigning one.
{
  const raw = add;
  add = (key, url, detail) =>
    raw(
      key,
      url && redact(url, { emails: false }),
      detail == null ? detail : redact(String(detail), { emails: false }),
    );
}
notes.push = (...xs) =>
  Array.prototype.push.apply(
    notes,
    xs.map(n => redact(n)),
  );

RULES["CRAWL-10"] = ["Parameter, filter, search and result pages stay out of the index", "Crawling & indexing"];
Object.assign(CHECKS, {
  "parameter-page-indexable": [
    "CRAWL-10",
    "medium",
    n => `${n} page(s) with URL parameters can be indexed as copies of another page`,
    "These URLs add parameters (a filter, a sort order, an option) to a page the crawl also found without them, and nothing keeps them out of the index: they have no canonical, or one that keeps the parameters. Google then has several URLs for one page, crawls them all and picks a canonical itself, which may not be the one you want.",
    "Give each parameter version a canonical to the clean URL (or noindex, follow for search and result pages), built from the path, never the request URL. Don't give them a canonical to themselves.",
  ],
  "url-malformed": [
    "CRAWL-07",
    "medium",
    n => `${n} page(s) have links or images whose address can't be read`,
    "A link or image address that isn't a valid URL, such as `https://` with no host or a host with a space in it, leads nowhere: browsers and crawlers can't follow the link or load the image. It's usually a template that built the address from an empty or wrong setting.",
    "Fix the template or content that builds these addresses so each is a full URL (`https://www.example.com/page/`) or a path (`/page/`).",
  ],
});
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

Object.assign(CHECKS, {
  "schema-placeholder": [
    "SCHEMA-01",
    "high",
    n => `${n} page(s) have placeholder text in their structured data`,
    "Template text such as [Business Name], [Phone] or a REPLACE_ token went live in the JSON-LD. Search engines read it as the real name, phone or address, so the business is described wrongly where visitors can't see it.",
    "Fill each field from the site's real data, the same settings that feed the page. `scripts/schema-check.mjs` reports these tokens as errors, so run it on the built pages before each release.",
  ],
  "schema-superseded": [
    "SCHEMA-05",
    "low",
    n => `${n} page(s) use a schema type that schema.org has deprecated`,
    "schema.org marks these types as deprecated and names the type to use instead: LegalService for Attorney, which it calls more inclusive and less ambiguous.",
    "Change the type to the one named (Attorney → LegalService) and keep the same properties.",
  ],
  "schema-image-broken": [
    "SCHEMA-01",
    "medium",
    n => `${n} schema image(s) don't load`,
    "Structured data points at these images (an article's image, a logo, a video thumbnail), but the URL answers with an error or a web page instead of an image. Google asks for image URLs it can crawl and index, and recipes, movies and vacation rentals show as rich results only with an image.",
    "Restore the file, or fix the URL in the data the schema is built from. Use the full https:// URL of an image on the public site.",
  ],
});

// schema-check.mjs holds the value lists (ISO 4217, ItemAvailability). The 3-page shared-H1 cut-off is a local choice.
// https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
// https://developers.google.com/search/docs/specialty/explicit/guidelines
Object.assign(CHECKS, {
  "product-image-missing": [
    "SHOP-05",
    "medium",
    n => `${n} product page(s) sell a product with no image in its schema`,
    "Google's merchant listings require an `image` for a Product sold with an Offer, so these products can't show as merchant listings.",
    "Add the product photos to the Product schema's `image`, from the same data that shows them on the page. Google suggests several high-resolution images in 16:9, 4:3 and 1:1.",
  ],
  "product-price-zero": [
    "SHOP-05",
    "low",
    n => `${n} product page(s) give a price of 0 in their schema`,
    "Google's merchant listings need a price above zero, so a product priced 0 can't show as one. A 0 can also be a price that didn't load when the page was built.",
    "Fill `price` from the live price the page shows. If the product really is free, leave it: product snippets accept a price of 0.",
  ],
  "product-currency-invalid": [
    "SHOP-05",
    "medium",
    n => `${n} product page(s) give a currency that isn't an ISO 4217 code`,
    "Google wants `priceCurrency` as a three-letter ISO 4217 code (USD, EUR, GBP), and merchant listings require it. A symbol such as £ or a word such as Euro isn't one.",
    'Use the three-letter code, such as `"priceCurrency": "GBP"`, from the shop\'s currency setting.',
  ],
  "product-availability-invalid": [
    "SHOP-05",
    "low",
    n => `${n} product page(s) give a stock status that isn't one of schema.org's values`,
    "Google lists schema.org's ItemAvailability values for `availability`, as the full URL (`https://schema.org/InStock`) or the short name (`InStock`), and asks for one. Free text such as “in stock”, or several values at once, isn't one of them.",
    "Map the shop's stock status to one value: `https://schema.org/InStock`, `OutOfStock`, `BackOrder`, `PreOrder` and so on.",
  ],
  "product-brand-placeholder": [
    "SHOP-05",
    "low",
    n => `${n} product page(s) give “N/A” or a similar stand-in as the brand`,
    "N/A, None, Generic or an empty name isn't a brand. Google's Merchant Center help says to leave the brand out when in doubt, rather than guess or make one up.",
    "Leave `brand` out for products that have none. For products the shop makes itself, use the shop's name as the brand, as Merchant Center asks.",
  ],
  "product-price-expired": [
    "SHOP-05",
    "medium",
    n => `${n} product page(s) have a price whose priceValidUntil date has passed`,
    "Google says a merchant listing may not show when `priceValidUntil` is in the past.",
    "Give `priceValidUntil` only for a sale price that really ends, from the same data as the sale, or leave it out.",
  ],
  "product-adult-unlabelled": [
    "SHOP-05",
    "medium",
    n => `${n} adult product page(s) don't label their products as adult in the schema`,
    'These pages label themselves adult for SafeSearch (`<meta name="rating" content="adult">`), but their Product schema has no `hasAdultConsideration`. Google says adult products must use it to label them, and they\'re subject to age and country restrictions.',
    'Add `"hasAdultConsideration": "https://schema.org/SexualContentConsideration"` to each adult Product. It\'s the only value Google Search supports.',
  ],
  "product-h1-reused": [
    "CONTENT-04",
    "medium",
    n => `${n} product page(s) share an H1 that doesn't name their product`,
    "Three or more product pages have the same H1, and it isn't the name of any of their products. It's usually a template heading, such as “Product details” or the shop's name, so each page's main heading says nothing about what it sells.",
    "Make the product's name the H1 of its page, and use H2s for the sections below it (description, specifications, delivery and returns, reviews).",
  ],
});
// Merchant listing fields Google recommends where a product has them; the report counts them.
const SHOP_FIELDS = {
  brand: ["brand"],
  gtin: ["gtin", "gtin8", "gtin12", "gtin13", "gtin14", "isbn", "mpn"],
  sku: ["sku"],
  color: ["color"],
  size: ["size"],
  material: ["material"],
  category: ["category"],
};

Object.assign(CHECKS, MEDIA_CHECKS);

RULES["REND-11"] = ["Phones get a working menu, and pages that aren't crowded with ads", "Rendering"];
Object.assign(CHECKS, RENDER_MORE_CHECKS);
const RENDER_PAGE = typeof args["render-page"] === "string" ? args["render-page"] : null;
const RENDER_STEPS = typeof args["render-steps"] === "string" ? args["render-steps"] : "";
const CLEAN_SHOTS = !!args["clean-screenshots"];

Object.assign(CHECKS, CONTENT_CHECKS);
RULES["CONTENT-07"] ??= ["People and dates are behind the advice", "Headings & content"]; // stale-guide's rule; never passed here

import { CHECKS as PAGE_CHECKS, ugcLinks, backTrap, paywallLeak, lateHead, identityDrift } from "./checks/page.mjs";
Object.assign(CHECKS, PAGE_CHECKS);
RULES["CONTENT-11"] ??= ["Nothing breaks Google's spam policies", "Headings & content"]; // never passed: see NOT_CRAWLABLE

// keyword-ideas.mjs's own word rules, so the words file matches its searches exactly.
const { mainWords: pickMainWords } = await import("./keyword-ideas.mjs");

const findings = new Map(); // key -> {evidence:[], count}
function add(key, url, detail) {
  if (!CHECKS[key]) throw new Error("unknown check " + key);
  let f = findings.get(key);
  if (!f) findings.set(key, (f = { evidence: [], count: 0 }));
  f.count++;
  if (f.evidence.length < 100) f.evidence.push(detail ? { url, detail } : { url });
}
const evaluated = new Set();
const evalRules = (...ids) => ids.forEach(r => evaluated.add(r));

// ---------- fetch helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TEMPORARY = new Set([302, 303, 307]); // redirects that tell search engines the old URL may come back
// A redirect between URLs that differ only by a trailing slash counts under URL-02.
const slashOnly = (a, b) => {
  const x = new URL(a),
    y = new URL(b);
  return (
    x.origin === y.origin && x.search === y.search && x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "")
  );
};
// The private-address guard. The crawled origin is never guarded, so a localhost or LAN site can be crawled. A
// fetch that leaves it (a redirect, a sitemap on another host, an hreflang page on another site) is blocked only when
// it goes to a private, local, reserved or cloud-metadata address (169.254.169.254): checks/outbound.mjs's test on
// the URL, then on the name's DNS answer.
// Limit: the DNS answer is checked before fetch() looks the name up again, so a name that changes its answer in
// between (DNS rebinding) gets through. Connecting through node:http with guarded(), as backlinks.mjs does, closes it.
const blocked = new Map(); // URL -> why it wasn't fetched
const publicLookup = /** @type {(host: string, opts: { all: boolean }) => Promise<unknown>} */ (
  promisify(guarded(lookup))
);
// A crawl of this machine may reach its other ports (a dev server redirecting to its API or asset server). Other
// private addresses and cloud metadata stay blocked even then.
const loopback = h => /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[::1\])$/i.test(h); // 0.0.0.0: what Django and Rails print
async function offLimits(u) {
  let x;
  try {
    x = new URL(u);
  } catch {
    return null;
  }
  if (x.origin === START_ORIGIN) return null;
  if (loopback(new URL(START_ORIGIN).hostname) && loopback(x.hostname)) return null;
  const why = !publicAddress(u)
    ? `${x.host} isn't a public address`
    : await publicLookup(x.hostname, { all: true }).then(
        () => null,
        e => (e.code === "ENOTPUBLIC" ? e.message : null),
      );
  if (why) blocked.set(u, why);
  return why;
}
// A 429 pauses every request to the site for its Retry-After, seconds or a date (local cap 30 s, 2 s when absent),
// then retries once.
// https://developers.google.com/search/docs/crawling-indexing/http-network-errors
let calmUntil = 0;
const retryAfter = v => {
  const ms = /^\d+$/.test(v?.trim() || "") ? v * 1000 : Date.parse(v ?? "") - Date.now();
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), 30000) : 2000;
};
// manual: false goes through follow(), so each hop passes the guard.
async function get(url, { manual = true, text = true, ua = UA } = {}) {
  if (!manual) return follow(url, ua);
  let waited = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (calmUntil > Date.now()) await sleep(calmUntil - Date.now());
      const t = performance.now(); // ms: the time to the response headers
      const res = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429 && !waited) {
        waited = true;
        attempt--;
        calmUntil = Math.max(calmUntil, Date.now() + retryAfter(res.headers.get("retry-after")));
        await res.arrayBuffer().catch(() => {});
        continue;
      }
      const ms = Math.round(performance.now() - t),
        ct = res.headers.get("content-type") || "";
      let body = "";
      if (text && res.status < 300 && /html|xml|text\/plain/.test(ct)) body = await res.text();
      else await res.arrayBuffer().catch(() => {});
      return { status: res.status, headers: res.headers, ct, body, location: res.headers.get("location"), ms };
    } catch (e) {
      if (attempt === 1) return { status: 0, error: String(e.message || e), headers: new Headers(), ct: "", body: "" };
      await sleep(500);
    }
  }
}
// A blocked redirect ends the chain at the redirect itself, which is what the server answered.
async function follow(url, ua) {
  const chain = [];
  let cur = url,
    why = await offLimits(cur);
  if (why) return { status: 0, error: why, chain, finalUrl: cur, headers: new Headers(), ct: "", body: "" };
  for (let i = 0; i < 6; i++) {
    const r = await get(cur, { ua });
    chain.push({ url: cur, status: r.status });
    if (r.status >= 300 && r.status < 400 && r.location) {
      const next = new URL(r.location, cur).href;
      if ((why = await offLimits(next))) return { ...r, chain, finalUrl: cur };
      cur = next;
      continue;
    }
    return { ...r, chain, finalUrl: cur };
  }
  return { status: 0, error: "too many redirects", chain, finalUrl: cur, headers: new Headers(), ct: "", body: "" };
}
// The start of an own-site file by Range request, read no further if the range is ignored. A redirect off the site
// returns null, so no third party is contacted, as does one that maps back onto the same URL, which would loop.
// size is the whole file: Content-Range's total, or Content-Length when the range is ignored.
async function firstBytes(url, max = 65536) {
  try {
    for (let hop = 0; hop < 5; hop++) {
      const r = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": UA, range: `bytes=0-${max - 1}`, accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
        signal: AbortSignal.timeout(15000),
      });
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) {
        await r.body?.cancel();
        const next = clean(toCrawl(new URL(loc, url).href));
        if (!next || next === url || new URL(next).origin !== START_ORIGIN) return null;
        url = next;
        continue;
      }
      const chunks = [];
      let n = 0;
      if (r.body)
        for await (const c of r.body) {
          chunks.push(c);
          if ((n += c.length) >= max) break;
        }
      return {
        status: r.status,
        type: r.headers.get("content-type") || "",
        headers: r.headers,
        bytes: Buffer.concat(chunks),
        size:
          Number(
            r.status === 206 ? r.headers.get("content-range")?.match(/\/(\d+)$/)?.[1] : r.headers.get("content-length"),
          ) || 0,
      };
    }
    return { status: 0, error: "too many redirects" };
  } catch (e) {
    return { status: 0, error: String(e.message || e) };
  }
}

// ---------- HTML helpers ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = s =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : (ENT[e.toLowerCase()] ?? m),
  );
function attrs(tag) {
  const out = {};
  const inner = tag.replace(/^<[\w-]+/, "").replace(/\/?>$/, "");
  const re = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}
const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(m => attrs(m[0]));
const stripNonContent = h =>
  h
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
const textOf = h =>
  decode(h.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
// Scripts written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer, Burmese): Intl.Segmenter splits
// them into words, and norm() sets them apart from Latin words next to them ("のBoilerの" holds the word "boiler").
const NOSPACE_CHARS = String.raw`\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Thai}\p{scx=Laoo}\p{scx=Khmr}\p{scx=Mymr}`;
const NOSPACE = new RegExp(`[${NOSPACE_CHARS}]`, "u"),
  NOSPACE_RUN = new RegExp(`[${NOSPACE_CHARS}]+`, "gu");
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });
const wordsOf = t =>
  NOSPACE.test(t)
    ? [...SEGMENTER.segment(t)].filter(s => s.isWordLike).map(s => s.segment)
    : t.split(" ").filter(w => /[\p{L}\p{N}]/u.test(w));
const norm = s =>
  s
    .toLowerCase()
    .replace(NOSPACE_RUN, " $& ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
// Words written in capitals (FAQ, SEO, HVAC; a plural's s dropped), lowercased: the acronyms a text shows.
const capsOf = s =>
  new Set(
    s
      .split(/[^\p{L}\p{N}]+/u)
      .map(w => /^(\p{Lu}{2,})s?$/u.exec(w)?.[1].toLowerCase())
      .filter(Boolean),
  );
// Frameworks whose router loads the next page itself, without a new document, so speculation rules add little:
// Next.js, Nuxt, Gatsby, SvelteKit, Remix, Astro prefetch, Turbo (Rails), React Router 7, Angular, Docusaurus, Inertia.
const CLIENT_ROUTER =
  /\/_next\/static\/|\/_nuxt\/|id=["']?___gatsby\b|data-sveltekit-|__remixContext|data-astro-prefetch|data-turbo-track|@hotwired\/turbo|__reactRouterContext|\sng-version=|id=["']?__docusaurus\b|\sdata-page=["'](?:\{|app["'])/;
const FILE_EXT =
  /\.(pdf|png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|zip|gz|mp4|webm|mp3|woff2?|ttf|otf|csv|xlsx?|docx?|pptx?)$/i;

function jsonLdNodes(html) {
  const nodes = [],
    errors = [];
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch (e) {
      errors.push(String(e.message).slice(0, 120));
      continue;
    }
    const walk = d => {
      if (Array.isArray(d)) d.forEach(walk);
      else if (d && typeof d === "object") {
        if (Array.isArray(d["@graph"])) d["@graph"].forEach(walk);
        if (d["@type"]) nodes.push(d);
      }
    };
    walk(data);
  }
  return { nodes, errors };
}
const typesOf = n => [].concat(n["@type"] || []);
function deepHas(obj, pred, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 12) return false;
  if (pred(obj)) return true;
  return Object.values(obj).some(v => deepHas(v, pred, depth + 1));
}
const ORG_RE =
  /(Organization|Corporation|Business|Store|Service|Contractor|Agency|Electrician|Plumber|Locksmith|Dentist|Physician|Attorney|Restaurant|Hotel|AutoRepair|School|NGO)$/;

// Google's rules from one robots meta content or X-Robots-Tag line. A "<crawler>:" prefix holds for the rules after it,
// and only unprefixed and googlebot rules count. "none" is noindex plus nofollow.
// https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
const agentRule = t => {
  const m = /^\s*([a-z][\w-]*)\s*:\s*(.*)$/.exec(t);
  return m && !VALUED.test(m[1]) ? m : null;
};
function googleRobots(s) {
  let agent = null;
  const out = [];
  for (let t of (s || "").toLowerCase().split(",")) {
    const m = agentRule(t);
    if (m) [, agent, t] = m;
    t = t.trim().replace(/\s*:\s*/, ":");
    if (t && (!agent || agent === "googlebot")) out.push(...(t === "none" ? ["noindex", "nofollow"] : [t]));
  }
  return out;
}
function ctx(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  const s = Math.max(0, m.index - 60),
    e = Math.min(text.length, m.index + m[0].length + 60);
  return { match: m[0], snippet: (s ? "…" : "") + text.slice(s, e) + (e < text.length ? "…" : "") };
}
// Consent managers have to run before anything else, so a blocking script from one is fine.
const CONSENT_HOST =
  /(^|\.)(cookiebot\.(com|eu)|cookielaw\.org|onetrust\.com|usercentrics\.eu|privacy-center\.org|iubenda\.com|cookieyes\.com|termly\.io|osano\.com)$/i;
// xRobotsLines: the X-Robots-Tag lines kept apart, when crawlOne read them raw.
function analyze(url, html, headers, xRobotsLines) {
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html;
  const bodyStart = html.search(/<body\b/i);
  const bodyRaw = bodyStart >= 0 ? html.slice(bodyStart) : html;
  const body = stripNonContent(bodyRaw);
  const text = textOf(body);
  const words = wordsOf(text).length;
  // Next.js 15.2+ can stream metadata into <body> for non-bot visitors, so metas after the head count too. Only what
  // follows the head is read: </head> and <body> are optional, and minifiers drop them.
  const metas = [
    ...tagsOf(head, "meta"),
    ...tagsOf(stripNonContent(html.slice(Math.max(head.length, bodyStart))), "meta"),
  ];
  const meta = n => metas.find(m => (m.name || m.property || "").toLowerCase() === n)?.content;
  const titleM = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const titleCount = (stripNonContent(head).match(/<title\b/gi) || []).length; // an inline SVG's <title> isn't one, nor is a script's
  const PH =
    /\b[Ll]orem [Ii]psum\b|\bTODO\b|\bTBD\b|\{\{\s*[\w.]+\s*\}\}|\[(?:[A-Z][A-Z _]{2,29})\]|�|\b(?:We|You|They|It|Don|Can|Isn|Won|Doesn|Didn|That|There)\?(?:ve|re|s|t|ll|d)\b/;
  const robotsTags = tagsOf(html, "meta").filter(m => ["robots", "googlebot"].includes((m.name || "").toLowerCase())); // Google honours robots meta in <body> too
  const robotsMeta = robotsTags
    .map(m => m.content || "")
    .join(",")
    .toLowerCase();
  const xRobots = (headers.get("x-robots-tag") || "").toLowerCase();
  const metaRules = robotsTags.flatMap(m => googleRobots(m.content)),
    headerRules = (xRobotsLines?.length ? xRobotsLines : [xRobots]).flatMap(googleRobots),
    directives = [...metaRules, ...headerRules];
  const hreflang = tagsOf(head, "link")
    .filter(l => (l.rel || "").toLowerCase().split(/\s+/).includes("alternate") && l.hreflang && l.href)
    .map(l => ({ lang: l.hreflang, href: l.href }));
  // Render-blocking: head scripts without async, defer or type="module" (other types don't run, and browsers skip
  // nomodule), except consent managers', and stylesheets for every screen. Comments hide old IE shims, and <noscript>
  // holds the fallbacks of stylesheets loaded later, so both are stripped.
  const headOnly = (headEnd > 0 ? html.slice(0, headEnd) : bodyStart > 0 ? html.slice(0, bodyStart) : "").replace(
    /<!--[\s\S]*?-->|<noscript\b[\s\S]*?<\/noscript>/gi,
    " ",
  );
  const blockingJs = tagsOf(headOnly, "script")
    .filter(
      s =>
        s.src &&
        !["async", "defer", "nomodule"].some(k => k in s) &&
        /^((text|application)\/(x-)?(java|ecma)script)?$/i.test((s.type || "").trim()) &&
        !CONSENT_HOST.test(urlOr(s.src, url)?.hostname || ""),
    )
    .map(s => s.src);
  const blockingCss = tagsOf(headOnly, "link").filter(l => {
    const rel = (l.rel || "").toLowerCase().split(/\s+/);
    return (
      rel.includes("stylesheet") &&
      !rel.includes("alternate") &&
      !("disabled" in l) &&
      /^(all|screen)?$/i.test((l.media || "").trim())
    );
  }).length;
  // The favicon links Google reads, with the body as the fallback.
  // https://developers.google.com/search/docs/appearance/favicon-in-search
  const iconsIn = h =>
    tagsOf(h, "link")
      .filter(
        l =>
          l.href &&
          (l.rel || "")
            .toLowerCase()
            .split(/\s+/)
            .some(r => ["icon", "apple-touch-icon", "apple-touch-icon-precomposed"].includes(r)),
      )
      .map(l => l.href);
  const icons = iconsIn(head).length ? iconsIn(head) : iconsIn(body);
  const canonIn = h =>
    tagsOf(h, "link")
      .filter(l => (l.rel || "").toLowerCase().split(/\s+/).includes("canonical"))
      .map(l => l.href);
  const canon = canonIn(head).length ? canonIn(head) : canonIn(body);
  const headings = [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({
    level: +m[1],
    text: textOf(m[2]),
  }));
  const anchors = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({
    href: attrs("<a " + m[1] + ">").href,
    text: textOf(m[2]),
  }));
  const imgs = tagsOf(body, "img");
  const { nodes, errors } = jsonLdNodes(html);
  const types = [...new Set(nodes.flatMap(typesOf))];
  // Microdata (itemtype) and RDFa (typeof) types: "https://schema.org/Product" and "schema:Product" read as Product.
  const schemaOther = [
    ...new Set(
      [...stripNonContent(html).matchAll(/<[a-z][\w-]*\s[^>]*(?:itemtype|typeof)\s*=[^>]*>/gi)]
        .flatMap(m => {
          const a = attrs(m[0]);
          return `${a.itemtype || ""} ${a.typeof || ""}`.trim().split(/\s+/);
        })
        .map(t => t.replace(/^.*[\/#:]/, ""))
        .filter(Boolean),
    ),
  ];
  // Top-level field names per type, merged across blocks, so a later crawl can tell which fields went missing.
  const schemaProps = {};
  for (const n of nodes)
    for (const t of typesOf(n))
      schemaProps[t] = [
        ...new Set([...(schemaProps[t] || []), ...Object.keys(n).filter(k => !k.startsWith("@"))]),
      ].sort();
  const faqQs = nodes
    .filter(n => typesOf(n).includes("FAQPage"))
    .flatMap(n => [].concat(n.mainEntity || []))
    .map(q => q && q.name)
    .filter(Boolean);
  const crumbs = nodes
    .filter(n => typesOf(n).includes("BreadcrumbList"))
    .flatMap(n => [].concat(n.itemListElement || []))
    .map(i => i && (typeof i.item === "string" ? i.item : i.item && (i.item["@id"] || i.item.url)))
    .filter(Boolean);
  const hasRating = nodes.some(n =>
    deepHas(n, o => "aggregateRating" in o || typesOf(o).some(t => t === "AggregateRating" || t === "Review")),
  );
  // Matched at any depth, as schema-check.mjs does; a `top` type (Occupation) only when not nested.
  const uses = r => (r.top ? types.includes(r.type) : nodes.some(n => deepHas(n, o => typesOf(o).includes(r.type))));
  const deprecated = RETIRED.filter(uses).map(r => r.type),
    kept = KEPT.filter(uses).map(r => r.type);
  const phMatch = text.match(PH);
  const mainM = body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const mainHtml = mainM ? mainM[1] : body.replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const mw = wordsOf(textOf(mainHtml).toLowerCase());
  const mainHrefs = [...mainHtml.matchAll(/<a\b([^>]*)>/gi)].map(m => attrs("<a " + m[1] + ">").href).filter(Boolean);
  let shingles = null;
  if (mw.length >= 50) {
    shingles = new Set();
    for (let i = 0; i + 5 <= mw.length; i++) shingles.add(mw.slice(i, i + 5).join(" "));
  }
  // Phone and street address from local business schema (LOCAL-05). Organization, Corporation, online-only businesses
  // and Service aren't local.
  const nap = [
    ...new Map(
      nodes
        .filter(n =>
          typesOf(n).some(
            t =>
              ORG_RE.test(t) &&
              !/(Organization|Corporation|NGO|School)$|^(OnlineStore|OnlineBusiness|Service)$/.test(t),
          ),
        )
        .flatMap(n => [
          ...[]
            .concat(n.telephone || [])
            .filter(t => typeof t === "string" && t.replace(/\D/g, "").length >= 7)
            .map(value => ({ kind: "phone", value })),
          ...[]
            .concat(n.address || [])
            .map(a => (typeof a === "string" ? a : a?.streetAddress))
            .filter(s => typeof s === "string" && norm(s))
            .map(value => ({ kind: "street address", value })),
        ])
        .map(f => [f.kind + f.value, f]),
    ).values(),
  ];
  // Merchant listing fields (SHOP-05).
  // https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
  const products = nodes
    .filter(n => typesOf(n).includes("Product"))
    .map(n => {
      const offers = [].concat(n.offers || []).filter(o => o && typeof o === "object");
      const orgHas = key => nodes.some(o => typesOf(o).some(t => ORG_RE.test(t)) && o[key]);
      const prices = offers
        .map(o => o.price ?? o.lowPrice)
        .filter(v => v != null && !isNaN(parseFloat(v)))
        .map(v => Number(String(v).replace(/,/g, "")));
      // Every offer needs its own shipping and returns, an AggregateOffer's listed offers included, unless the
      // organization sets them once.
      const each = offers.flatMap(o =>
        typesOf(o).includes("AggregateOffer") && o.offers
          ? [].concat(o.offers).filter(x => x && typeof x === "object")
          : [o],
      );
      return {
        name: n.name || "a product",
        offers: each.length,
        singleAggregate: offers.some(
          o =>
            typesOf(o).includes("AggregateOffer") &&
            (o.offerCount == null ||
              Number(o.offerCount) <= 1 ||
              (o.highPrice != null && Number(o.highPrice) === Number(o.lowPrice))),
        ),
        noShipping: orgHas("hasShippingService") ? 0 : each.filter(o => !o.shippingDetails).length,
        noReturns:
          n.hasMerchantReturnPolicy || orgHas("hasMerchantReturnPolicy")
            ? 0
            : each.filter(o => !o.hasMerchantReturnPolicy).length,
        prices, // every offer's price: the page may show any one variant
      };
    });
  // Parses a shown amount whatever its thousands and decimal separators.
  const toNum = s => {
    s = s.replace(/\s/g, "");
    const i = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    return i >= 0 && s.length - i - 1 !== 3
      ? Number(s.slice(0, i).replace(/[.,]/g, "") + "." + s.slice(i + 1))
      : Number(s.replace(/[.,]/g, ""));
  };
  // A number is grouped in threes ("1 299,00", "10.000", "1,299.00") or plain ("29.99"), and "$49 99" (superscript
  // cents) reads as 49.99 too. Every reading is kept, so a mismatch needs all of them to differ from the schema.
  const NUM = String.raw`\d{1,3}(?:[.,\s  ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`,
    CUR = String.raw`[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD|INR)\b`;
  const amounts = products.length
    ? [
        ...text.matchAll(
          new RegExp(
            `(?:${CUR})\\s?(${NUM})(?:\\s(\\d{2})(?!\\d))?|(${NUM})\\s?(?:[€£]|\\b(?:USD|EUR|GBP|CAD|AUD|INR)\\b)`,
            "g",
          ),
        ),
      ]
        .flatMap(m => {
          const n = toNum(m[1] ?? m[3]);
          return m[2] && !/[.,]\d{1,2}$/.test(m[1]) ? [n, n + Number(m[2]) / 100] : [n];
        })
        .filter(x => !isNaN(x))
    : [];
  const refresh = metas.find(m => (m["http-equiv"] || "").toLowerCase() === "refresh")?.content || "";
  const emptyRoot = /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(bodyRaw);
  // An unload handler keeps the page out of the back/forward cache.
  // https://web.dev/articles/bfcache
  const inlineJs = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join("\n");
  const unload = /addEventListener\(\s*["'`]unload["'`]|\bonunload\s*=/.test(inlineJs)
    ? "an unload listener in an inline script"
    : /<[a-z][^>]*\sonunload\s*=/i.test(html)
      ? "an onunload attribute"
      : null;
  // Links with no accessible name: no text (an SVG's <title> counts), aria-label, aria-labelledby, title, or alt or
  // label inside. aria-hidden links (a card's image link beside its text link) are skipped, as axe and Lighthouse do.
  const emptyLinks = [
    ...bodyRaw
      .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, " ")
      .matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi),
  ]
    .map(m => [attrs("<a " + m[1] + ">"), m[2]])
    .filter(
      ([a, inner]) =>
        "href" in a &&
        a["aria-hidden"]?.trim().toLowerCase() !== "true" &&
        ![a["aria-label"], a["aria-labelledby"], a.title].some(v => v?.trim()) &&
        !textOf(inner) &&
        !/\s(alt|aria-label|aria-labelledby|title)\s*=\s*["']?\s*[^\s"'>]/i.test(inner),
    )
    .map(([a]) => a.href);
  // The header's charset wins over the meta tag's; names are compared as browsers read them ("latin1" is windows-1252).
  const label = s =>
      (s || "")
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase() || null,
    encoding = s => {
      try {
        return new TextDecoder(s).encoding;
      } catch {
        return s;
      }
    };
  const headerCs = label((headers.get("content-type") || "").match(/charset=([^;\s]+)/i)?.[1]);
  const metaCs = label(
    metas
      .map(
        m =>
          m.charset ||
          (/^content-type$/i.test(m["http-equiv"] || "") && (m.content || "").match(/charset=([^;\s]+)/i)?.[1]),
      )
      .find(Boolean),
  );
  // Obsolete tags are looked for in the whole document, since a frameset takes the body's place.
  const obsolete = [
    ...new Set(
      [
        ...html
          .replace(/<(script|style|template)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, " ")
          .matchAll(/<(frameset|frame|marquee|blink|font|center)(?=[\s>\/])/gi),
      ].map(m => m[1].toLowerCase()),
    ),
  ];
  const rec = {
    // Relative URLs resolve against the first <base href>, itself resolved against the page URL, as browsers do.
    base: urlOr(tagsOf(head, "base").find(b => b.href)?.href ?? url, url)?.href ?? url,
    title: titleM ? textOf(titleM[1]) : null,
    description: meta("description") ?? null,
    ogTitle: meta("og:title") ?? null,
    ogImage: meta("og:image") ?? null,
    ogUrl: meta("og:url") ?? null,
    ogDescription: meta("og:description") ?? null,
    ogImageSized: !!(meta("og:image:width") && meta("og:image:height")),
    // X reads twitter: tags from name= and falls back to property=, and the last twitter:card on the page wins.
    // From X's cards getting-started guide, archived 30 May 2025.
    twitterCard: metas.findLast(m => (m.name || m.property || "").toLowerCase() === "twitter:card")?.content ?? null,
    doctype: /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype html/i.test(html.replace(/^\uFEFF/, "")),
    charset:
      metas.some(m => m.charset || /charset=/i.test(m.content || "")) ||
      /charset=/i.test(headers.get("content-type") || ""),
    viewport: /width\s*=\s*device-width/i.test(meta("viewport") || ""),
    refreshTo: (refresh.match(/url\s*=\s*['"]?([^'"\s;]+)/i) || [])[1] || null,
    robotsMeta,
    xRobots,
    lang: (html.match(/<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i) || [])[1] || null,
    noindex: directives.includes("noindex"),
    nofollow: directives.includes("nofollow"),
    metaRules,
    headerRules,
    canonicals: canon,
    hreflang,
    products,
    amounts,
    nosnippet: directives.some(r => r === "nosnippet" || r === "max-snippet:0"),
    largePreview: directives.includes("max-image-preview:large"),
    headings,
    h1Count: headings.filter(h => h.level === 1).length,
    words,
    normText: norm(text),
    caps: capsOf(text),
    anchors,
    imgs,
    icons,
    blockingJs,
    blockingCss,
    nap,
    types,
    schemaOther,
    schemaProps,
    jsonldErrors: errors,
    faqQs,
    crumbs,
    hasRating,
    deprecated,
    kept,
    emptyRoot,
    mainHrefs,
    banned: BANNED ? ctx(text, BANNED) : null,
    unconfirmed: VERIFY ? ctx(text, VERIFY) : null,
    shingles,
    titleCount,
    placeholder: phMatch ? phMatch[0] : null,
    hashLinks: anchors.filter(l => !l.href || l.href === "#" || /^javascript:/i.test(l.href)).length,
    scripts: (html.match(/<script\b[^>]*\bsrc=/gi) || []).length,
    bytes: Buffer.byteLength(html),
    noStore: /\bno-store\b/i.test(headers.get("cache-control") || ""),
    unload,
    emptyLinks,
    obsolete,
    charsetMismatch:
      headerCs && metaCs && encoding(headerCs) !== encoding(metaCs) ? `header: ${headerCs} · meta: ${metaCs}` : null,
    preloads:
      /<script\b[^>]*\btype\s*=\s*["']?speculationrules/i.test(html) ||
      headers.has("speculation-rules") ||
      CLIENT_ROUTER.test(html),
    // Body elements as Lighthouse counts them; what a script, style, noscript or template holds isn't in the DOM tree.
    elements: (
      bodyRaw
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "<$1>")
        .match(/<[a-z][\w-]*/gi) || []
    ).length,
  };
  // E-E-A-T signals for the report's trust view.
  rec.trust = trustFeatures(html, url, rec.base);

  rec.agent = agentFeatures(html);
  rec.writing = writingFeatures(writingText(mainHtml), rec.lang);

  // The home page's main text feeds the business-type guess, minus post teasers (two or more <article>s).
  if (url === START.href || new URL(url).pathname === "/")
    rec.bizText = textOf(
      (mainHtml.match(/<article\b/gi) || []).length > 1
        ? mainHtml.replace(/<article\b[\s\S]*?<\/article>/gi, " ")
        : mainHtml,
    );

  // Links with a space or non-ASCII character in the path or query. A non-ASCII host is fine: browsers punycode it.
  const rawPath = h => h.replace(/^(?:[a-z][\w+.-]*:)?\/\/[^/?#]*/i, "").split("#")[0];
  rec.unencoded = [
    ...new Set(
      anchors
        .map(a => a.href?.trim())
        .filter(h => h && !/^(mailto|tel|javascript|sms|data):/i.test(h) && /[^\x21-\x7e]/.test(rawPath(h))),
    ),
  ];
  // Wide images without srcset; one in a <picture> has its own sources, and SVG scales.
  const realSrc = i => i.src && !/^data:/i.test(i.src);
  rec.wideImgs = tagsOf(body.replace(/<picture\b[\s\S]*?<\/picture>/gi, " "), "img")
    .filter(
      i => realSrc(i) && parseInt(i.width) > 1000 && !i.srcset && !i["data-srcset"] && !/\.svg(?:[?#]|$)/i.test(i.src),
    )
    .map(i => `${i.src} (${parseInt(i.width)} px)`);
  // Images from the 11th on with no loading attribute (an explicit eager is a choice), bar script-loaded and tiny ones.
  rec.eagerLate = imgs
    .slice(10)
    .filter(i => realSrc(i) && !("loading" in i) && !i["data-src"] && !(parseInt(i.width) < 100))
    .map(i => i.src);

  // hreflang from the HTML, Link header and sitemap is merged before the checks run, noting where sources disagree;
  // also the Translate widget and schema inLanguage.
  Object.assign(
    rec,
    mergeHreflang(
      { html: hreflang, header: linkHreflang(headers.get("link")), sitemap: sitemapHreflang(url) },
      url,
      toCrawl,
    ),
    languageFeatures(html, nodes),
  );

  rec.dupHead = ["description", "robots", "viewport", "og:title"]
    .map(
      n =>
        /** @type {[string, number]} */ ([
          n,
          metas.filter(m => (m.name || m.property || "").toLowerCase() === n).length,
        ]),
    )
    .filter(([, c]) => c > 1)
    .map(([n, c]) => `${c} × ${n}`);
  rec.numberHeadings = headings
    .filter(
      h => /^[#№]?[+\-−]?[$€£¥]?\d[\d.,\s]*(?:[kmb%x×])?\+?\.?$/i.test(h.text) && !/^(1[5-9]|20)\d\d$/.test(h.text),
    )
    .map(h => `H${h.level} “${h.text}”`);
  rec.referrerMeta = meta("referrer") ?? null;

  // http:// files in the head and body, judged later site-wide against the public origin.
  rec.insecure = insecureResources(html, headers.get("content-security-policy") || "");

  // Hrefs and srcs no URL parser can read, which the crawl would otherwise skip silently.
  rec.badUrls = [
    ...new Set(
      [...anchors.map(a => a.href), ...imgs.map(i => i.src)].filter(h => h?.trim() && !urlOr(h.trim(), rec.base)),
    ),
  ];

  // Inputs for checks/page.mjs: comment-section links, a script that may trap Back, paid text sent in full, head tags
  // after </head>, and the top-level Organization (not Service) and WebSite nodes' @id and name.
  const idNodes = pred => nodes.filter(n => typesOf(n).some(pred)).map(n => ({ id: n["@id"], name: n.name }));
  rec.pageChecks = {
    ugc: ugcLinks(body)
      .map(h => urlOr(h, rec.base))
      .filter(x => x && /^https?:$/.test(x.protocol))
      .map(x => x.href),
    backTrap: backTrap(html),
    paywall: paywallLeak(body, nodes),
    late: lateHead(html),
    identity: { org: idNodes(t => ORG_RE.test(t) && t !== "Service"), site: idNodes(t => t === "WebSite") },
  };

  // Words of the title, H1s and main text, for keyword-ideas.mjs. Runs of a script written without spaces are dropped
  // (no words to match), and a page mostly in one is marked, so no missing search is claimed for it.
  {
    const t = [rec.title || "", ...headings.filter(h => h.level === 1).map(h => h.text), textOf(mainHtml)].join(" "),
      ns = (t.match(NOSPACE_RUN) || []).join("").length;
    rec.mainWordsText = pickMainWords(t.replace(NOSPACE_RUN, " ")).join(" ");
    rec.mainNoSpace = ns * 2 > (t.match(/\p{L}/gu) || []).length;
  }

  // Bing's AI rules (AI-03), kept only on pages that have any.
  {
    const b = bingAiRules(
      tagsOf(html, "meta")
        .filter(m => /^(robots|bingbot)$/i.test(m.name || ""))
        .map(m => m.content || ""),
      xRobotsLines?.length ? xRobotsLines : [headers.get("x-robots-tag") || ""],
    );
    if (b.legacy.length || b.prefs.length) rec.bingAi = b;
  }

  // JSON-LD placeholders, deprecated types (at any JSON-LD depth, and in Microdata or RDFa) and schema image URLs:
  // image, logo and thumbnailUrl, as a string or an ImageObject's contentUrl or url.
  rec.schemaPlaceholder = placeholderIn(JSON.stringify(nodes));
  rec.superseded = Object.keys(SUPERSEDED).filter(
    t => schemaOther.includes(t) || nodes.some(n => deepHas(n, o => typesOf(o).includes(t))),
  );
  const schemaImages = new Set(),
    pick = (o, d) => {
      if (!o || typeof o !== "object" || d > 12) return;
      for (const k of ["image", "logo", "thumbnailUrl"])
        for (const x of [].concat(o[k] ?? [])) {
          const s = typeof x === "string" ? x : x?.contentUrl || x?.url;
          if (typeof s === "string" && s.trim()) schemaImages.add(s.trim());
        }
      Object.values(o).forEach(x => pick(x, d + 1));
    };
  nodes.forEach(n => pick(n, 0));
  rec.schemaImages = [...schemaImages];

  // Per Product: merchant listing problems, a missing required image, no adult label on a page rated adult for
  // SafeSearch, and the recommended fields given. A stand-in brand doesn't count as one.
  const shopNodes = nodes.filter(n => typesOf(n).includes("Product"));
  if (shopNodes.length) {
    const adult = metas.some(
      m =>
        (m.name || "").toLowerCase() === "rating" &&
        /^(adult|RTA-5042-1996-1400-1577-RTA)$/i.test((m.content || "").trim()),
    );
    const filled = (n, k) => n[k] != null && n[k] !== "" && !(Array.isArray(n[k]) && !n[k].length);
    rec.shop = shopNodes.map(n => {
      const problems = merchantProblems(n);
      if (sellsWithOffer(n) && !filled(n, "image")) problems.push({ check: "image-missing" });
      if (
        adult &&
        ![]
          .concat(n.hasAdultConsideration ?? [])
          .some(x => /SexualContentConsideration$/.test(typeof x === "string" ? x : x?.["@id"] || ""))
      )
        problems.push({ check: "adult-unlabelled" });
      const fields = Object.keys(SHOP_FIELDS).filter(
        f =>
          SHOP_FIELDS[f].some(k => filled(n, k)) &&
          !(f === "brand" && problems.some(x => x.check === "brand-placeholder")),
      );
      return { name: typeof n.name === "string" && n.name ? n.name : "a product", problems, fields };
    });
  }

  // A lazy-loading script's image (data-src behind a placeholder) is read as its real file, so it's weighed and named,
  // and the first image's counts for lazy-lcp. Also image preloads, rel=prerender, and the page's depth and widest
  // element.
  const lazy = imgs.map(lazySrc);
  rec.firstScriptLazy = !!lazy[0];
  imgs.forEach((i, k) => {
    if (lazy[k]) i.src = lazy[k];
  });
  Object.assign(rec, hintsOf(html), { domShape: domShape(bodyRaw) });

  // The rest of HTML's obsolete tags (REND-10), a guide's newest date (CONTENT-07) and keyword use on English pages
  // (CONTENT-03). Dates are read from the whole body, not the main text, since an article's <header> often holds them.
  rec.obsolete.push(...obsoleteMore(html));
  rec.guideDate = isGuide(url, rec.title, types) ? newestDate(body, nodes) : null;
  rec.keywordUse = /^en(?![a-z])/i.test(rec.lang || "")
    ? keywordUse({ title: rec.title, headings, description: rec.description || "", text: textOf(mainHtml) })
    : null;

  // Local business schema, plus "we come to you" wording in the text.
  rec.local = localFeatures(nodes, text);

  return rec;
}

// ---------- robots ----------
// A user-agent counts by its name up to the first character other than a letter, "_" or "-", so "GPTBot/1.1" is
// GPTBot, as in Google's open-source parser and RFC 9309. versioned: the lines that carried more, for a note.
// https://github.com/google/robotstxt
// https://www.rfc-editor.org/rfc/rfc9309#section-2.2.1
function parseRobots(txt) {
  const groups = [];
  let cur = null;
  const sitemaps = [],
    versioned = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(),
      v = line.slice(i + 1).trim();
    if (k === "sitemap") {
      sitemaps.push(v);
      continue;
    }
    if (k === "user-agent") {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] }));
      const name = v.startsWith("*") ? "*" : /^[A-Za-z_-]+/.exec(v)?.[0] || v;
      if (name !== v && name !== "*") versioned.push(v);
      cur.agents.push(name.toLowerCase());
      continue;
    }
    if ((k === "allow" || k === "disallow") && cur) cur.rules.push({ allow: k === "allow", path: v });
  }
  return { groups, sitemaps, versioned };
}
const ruleRe = p =>
  new RegExp(
    "^" +
      p
        .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\\\$$/, "$")
        .replace(/\$$/, "$"),
  );
function allowedBy(group, path) {
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (!r.path) continue;
    if (
      ruleRe(r.path).test(path) &&
      (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))
    )
      best = r;
  }
  return !best || best.allow;
}
// Every group naming the crawler, combined into one, as RFC 9309 2.2.1 requires.
const groupFor = (robots, agent) => {
  const a = agent.toLowerCase(),
    gs = robots.groups.filter(g => g.agents.includes(a));
  return gs.length ? { agents: [a], rules: gs.flatMap(g => g.rules) } : null;
};

// ---------- sitemap ----------
const SITEMAP_MAX = 50 * 1024 * 1024; // the protocol's limit per file, uncompressed
const SITEMAP_URLS = 50000; // the protocol's limit per file: Google reads no further
const SITEMAP_KEEP = 200000; // URLs kept from all the sitemap files, far more than a crawl fetches
// Reads one chunk past max when there's more, so callers can tell the body was cut.
async function upTo(stream, max) {
  const chunks = [];
  let n = 0;
  for await (const c of stream) {
    chunks.push(c);
    if ((n += c.length) > max) break;
  }
  return Buffer.concat(chunks);
}
// Gunzips by the magic bytes, whatever the content type says: fetch undoes only Content-Encoding, and a .gz file may
// be compressed twice. Redirects are followed by hand, 5 at most, so each hop passes the guard.
async function fetchSitemap(url, retry = true) {
  try {
    let res;
    for (let hop = 0; ; hop++) {
      const why = await offLimits(url);
      if (why) return { status: 0, error: why };
      res = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": UA, accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" },
        signal: AbortSignal.timeout(60000),
      });
      const loc = res.headers.get("location");
      if (res.status < 300 || res.status > 399 || !loc || hop === 5) break;
      await res.body?.cancel();
      url = new URL(loc, url).href;
    }
    if (res.status !== 200 || !res.body) {
      await res.body?.cancel();
      return { status: res.status };
    }
    let buf = await upTo(res.body, SITEMAP_MAX);
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      const gz = createGunzip();
      gz.end(buf);
      buf = await upTo(gz, SITEMAP_MAX).catch(() => null);
      if (!buf) return { status: 200, body: "", broken: "it's a gzip file that doesn't unzip" };
    }
    const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
    return { status: 200, body: buf.toString("utf8", bom, SITEMAP_MAX), tooBig: buf.length > SITEMAP_MAX };
  } catch (e) {
    if (retry) {
      await sleep(500);
      return fetchSitemap(url, false);
    }
    return { status: 0, error: String(e.message || e) };
  }
}
const XML_TAG =
  /<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_:][\w.:-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>|<\/([A-Za-z_][\w.:-]*)\s*>/y;
const BAD_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/;
function xmlError(s) {
  const at = (i, why) =>
    `line ${(s.slice(0, i).match(/\n/g) || []).length + 1}, column ${i - s.lastIndexOf("\n", i - 1)}: ${why}`;
  const entity = (t, i) => {
    const k = t.search(BAD_ENTITY);
    if (k < 0) return null;
    const name = /^&[^\s&;<]{1,20};/.exec(t.slice(k))?.[0];
    return at(
      i + k,
      name ? `${name} isn't defined in XML (only &amp; &lt; &gt; &quot; &apos; are)` : "a bare & (write it as &amp;)",
    );
  };
  const HTML = "it's an HTML page, not a sitemap";
  const decl = s.search(/<\?xml[\s?]/);
  if (decl > 0) return at(decl, "there's text or a blank line before <?xml …?>, which has to come first");
  const stack = [];
  let i = 0,
    roots = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i),
      text = s.slice(i, lt < 0 ? s.length : lt);
    if (/\S/.test(text)) {
      if (!stack.length)
        return at(
          i + text.search(/\S/),
          roots ? "there's text after the last closing tag" : "there's text before the first tag",
        );
      const e = entity(text, i);
      if (e) return e;
    }
    if (lt < 0) break;
    const skip = [
      ["<!--", "-->", "a comment isn't closed with -->"],
      ["<![CDATA[", "]]>", "a CDATA section isn't closed with ]]>"],
      ["<?", "?>", "a <?…?> instruction isn't closed"],
    ].find(([open]) => s.startsWith(open, lt));
    if (skip) {
      const e = s.indexOf(skip[1], lt + skip[0].length);
      if (e < 0) return at(lt, skip[2]);
      i = e + skip[1].length;
      continue;
    }
    if (s.startsWith("<!", lt)) {
      if (/^<!doctype\s+html\b/i.test(s.slice(lt, lt + 20))) return at(lt, HTML);
      const e = s.indexOf(">", lt);
      if (e < 0) return at(lt, "a <!DOCTYPE> isn't closed");
      i = e + 1;
      continue;
    }
    XML_TAG.lastIndex = lt;
    const m = XML_TAG.exec(s);
    if (!m) return at(lt, `a broken tag: ${s.slice(lt, lt + 30).split("\n")[0]}…`);
    i = XML_TAG.lastIndex;
    if (m[4]) {
      const open = stack.pop();
      if (open !== m[4])
        return at(lt, open ? `</${m[4]}> where </${open}> was expected` : `</${m[4]}> has no opening tag`);
      continue;
    }
    const e = entity(m[2], lt + 1 + m[1].length);
    if (e) return e;
    if (!stack.length) {
      if (roots++) return at(lt, "a second root element after the first one closed");
      if (/^html$/i.test(m[1])) return at(lt, HTML);
    }
    if (!m[3]) stack.push(m[1]);
  }
  if (stack.length) return at(s.length, `the file ends before </${stack.at(-1)}>`);
  return roots ? null : at(0, "there are no XML tags in it");
}
// A tag's text (CDATA unwrapped), or undefined when it's missing or empty.
const tagText = (h, t) =>
  (h?.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() ||
  undefined;
// listed is false for the guessed /sitemap.xml, where an HTML page means no sitemap. cut means SITEMAP_KEEP URLs were
// kept and the rest, with any files after them, went unread.
/** @typedef {{ url: string, status: number, html?: boolean, invalid?: string, tooBig?: boolean, urls?: number, nestedIn?: string }} SitemapFile */
async function readSitemaps(urls, listed = true) {
  const entries = [],
    seen = new Set(),
    files = /** @type {SitemapFile[]} */ ([]);
  let cut = false;
  const queue = urls.map(u => [u, listed, null]); // [url, named, the sitemap index that lists it]
  while (queue.length && files.length < 60 && !cut) {
    const [u, named, parent] = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    const r = await fetchSitemap(toCrawl(u)),
      body = r.body || "";
    if (r.status !== 200 || !(body.trim() || r.broken)) {
      files.push({ url: u, status: r.status });
      continue;
    }
    const file = { url: u, status: 200 };
    files.push(file);
    if (!named && /^\s*<(!doctype\s+html|html)\b/i.test(body)) {
      file.html = true;
      continue;
    }
    const bad = r.broken || (body.includes("<") && !r.tooBig && xmlError(body));
    if (bad) file.invalid = bad;
    if (r.tooBig) file.tooBig = true;
    // A text sitemap: one URL per line.
    if (!body.includes("<")) {
      const lines = body.split(/\s*\n\s*/).filter(l => /^https?:\/\/\S+$/.test(l));
      file.urls = lines.length;
      for (const l of lines.slice(0, SITEMAP_URLS)) {
        if (entries.length === SITEMAP_KEEP) {
          cut = true;
          break;
        }
        entries.push({ loc: l, lastmod: null, sitemap: u, hints: false });
      }
      continue;
    }
    // Search Console reports an index listed in another index as an error; its sitemaps are still read here.
    if (/<sitemapindex\b/i.test(body)) {
      if (parent) file.nestedIn = parent;
      for (const m of body.matchAll(/<sitemap\b[\s\S]*?<loc>\s*([\s\S]*?)\s*<\/loc>/gi))
        queue.push([decode(m[1].trim()), true, u]);
      continue;
    }
    // Google accepts an RSS 2.0 or Atom 1.0 feed as a sitemap of recent URLs. An Atom entry's own link has rel
    // alternate or no rel. Feed dates (RFC 822 in RSS) aren't W3C dates, so lastmod is left out.
    // https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
    if (!/<urlset\b/i.test(body) && /<(rss|feed)\b/i.test(body)) {
      const locs = [
        ...[...body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(
          m => tagText(m[1], "link") && decode(tagText(m[1], "link")),
        ),
        ...[...body.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(
          m => tagsOf(m[1], "link").find(l => l.href && /^(alternate)?$/i.test((l.rel || "").trim()))?.href,
        ),
      ].filter(Boolean);
      file.urls = locs.length;
      for (const loc of locs.slice(0, SITEMAP_URLS)) {
        if (entries.length === SITEMAP_KEEP) {
          cut = true;
          break;
        }
        entries.push({ loc, lastmod: null, sitemap: u, hints: false });
      }
      continue;
    }
    file.urls = 0;
    const hasNews = body.includes("<news:news");
    for (const m of body.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
      // Past a file's 50,000 URLs, or the 200,000 kept in all, the rest is only counted, for sitemap-too-big.
      if (entries.length === SITEMAP_KEEP) cut = true;
      if (cut || file.urls === SITEMAP_URLS) {
        const rest = /<url\b/gi;
        rest.lastIndex = m.index;
        while (rest.exec(body)) file.urls++;
        break;
      }
      file.urls++;
      const loc = (m[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
      const lastmod = (m[1].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i) || [])[1];
      if (!loc) continue;
      const e = {
        loc: decode(loc.trim()),
        lastmod: lastmod ? lastmod.trim() : null,
        sitemap: u,
        hints: /<(priority|changefreq)>/i.test(m[1]),
      };
      // Google News entries: the tags Google requires, and the first-published date.
      const news = hasNews ? tagText(m[1], "news:news") : undefined,
        pub = tagText(news, "news:publication");
      if (news)
        e.news = {
          date: tagText(news, "news:publication_date"),
          missing: ["news:publication", "news:name", "news:language", "news:publication_date", "news:title"].filter(
            t => !tagText(t === "news:name" || t === "news:language" ? pub : news, t),
          ),
        };
      // Each <video:video> needs a thumbnail, title, description (2,048 characters at most) and a content or player
      // URL; each <image:image> needs <image:loc>, and a page may list 1,000 images at most.
      if (m[1].includes("<video:video"))
        e.videos = [...m[1].matchAll(/<video:video\b[^>]*>([\s\S]*?)<\/video:video>/g)].map(([, v]) =>
          [
            ...["video:thumbnail_loc", "video:title", "video:description"]
              .filter(t => !tagText(v, t))
              .map(t => `no <${t}>`),
            tagText(v, "video:description")?.length > 2048 && "a description over 2,048 characters",
            !tagText(v, "video:content_loc") &&
              !tagText(v, "video:player_loc") &&
              "no <video:content_loc> or <video:player_loc>",
          ].filter(Boolean),
        );
      if (m[1].includes("<image:image")) {
        const imgs = [...m[1].matchAll(/<image:image\b[^>]*\/>|<image:image\b[^>]*>([\s\S]*?)<\/image:image>/g)];
        e.images = { count: imgs.length, noLoc: imgs.filter(x => !tagText(x[1], "image:loc")).length };
      }
      // hreflang alternates (<xhtml:link rel="alternate" hreflang href>), which Google reads here as in the HTML.
      if (/<[\w.-]+:link\b/.test(m[1]))
        e.hreflang = [...m[1].matchAll(/<[\w.-]+:link\b[^>]*>/g)]
          .map(t => attrs(t[0]))
          .filter(a => (a.rel || "").toLowerCase().split(/\s+/).includes("alternate") && a.hreflang && a.href)
          .map(a => ({ lang: a.hreflang, href: a.href }));
      // A page listed again in an image, video or news sitemap isn't a duplicate.
      e.media = !!(e.news || e.videos || e.images);
      entries.push(e);
    }
  }
  // Files still queued after the 60-file limit went unread too, so pages in them can't be called missing.
  const filesLeft = !cut && queue.some(([u]) => !seen.has(u));
  return { entries, files, cut: cut || filesLeft, filesLeft };
}

// ---------- URL helpers ----------
const isLocal = o => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(o);
// Only a public host may be sent to an outside service: no private IP, intranet or reserved name.
const isPublic = o => {
  try {
    const h = new URL(o).hostname;
    return (
      !isLocal(o) &&
      h.includes(".") &&
      !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.)/.test(h) &&
      !/\.(local|internal|lan|localhost|test|home\.arpa)$/i.test(h)
    );
  } catch {
    return false;
  }
};
const urlOr = (u, base) => {
  try {
    return new URL(u, base);
  } catch {
    return null;
  }
}; // template bugs produce invalid URLs
function toCrawl(u) {
  // maps public-origin URLs onto the crawl origin
  try {
    const x = new URL(u);
    if (SITE_ORIGIN && x.origin === SITE_ORIGIN && SITE_ORIGIN !== START_ORIGIN)
      return START_ORIGIN + x.pathname + x.search;
    return x.href;
  } catch {
    return u;
  }
}
function clean(u, base) {
  try {
    const x = new URL(u, base);
    x.hash = "";
    return x.href;
  } catch {
    return null;
  }
}
const pathKey = u => {
  const x = new URL(u);
  return x.pathname + x.search;
};

// ---------- crawl ----------
const pages = new Map(); // requested crawl URL -> record
const queue = [];
const seen = new Set();
let fetched = 0,
  capped = false;
function enqueue(u, from) {
  const c = clean(u, from);
  if (!c) return;
  const x = new URL(c);
  if (x.origin !== START_ORIGIN) return;
  if (FILE_EXT.test(x.pathname)) return;
  if (x.search && !INCLUDE_QUERY) return;
  if (!inSection(x.pathname) && c !== clean(START.href)) return; // the start page is always the way in
  if (seen.has(c)) return;
  seen.add(c);
  queue.push(c);
}
// A page's raw X-Robots-Tag lines, or null. fetch joins repeated headers with commas, so "bingbot: noarchive" then
// "noindex" would read as one value whose noindex is Bing's.
const xRobotsLines = url =>
  new Promise(ok => {
    const req = (url.startsWith("https:") ? httpsGet : httpGet)(
      url,
      { headers: { "user-agent": UA, accept: "text/html" }, timeout: 15000 },
      res => {
        const lines = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2)
          if (res.rawHeaders[i].toLowerCase() === "x-robots-tag") lines.push(res.rawHeaders[i + 1]);
        res.destroy();
        ok(res.statusCode === 200 ? lines : null);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout"))).on("error", () => ok(null));
  });
// Product schema images, for the pixel size Google recommends (SHOP-05).
const productImages = html =>
  jsonLdNodes(html)
    .nodes.filter(n => typesOf(n).includes("Product"))
    .flatMap(n => [].concat(n.image || []))
    .map(i => (typeof i === "string" ? i : i?.contentUrl || i?.url))
    .filter(i => typeof i === "string");
async function crawlOne(u) {
  const r = await follow(u);
  const rec = {
    url: u,
    status: r.status,
    finalUrl: r.finalUrl,
    chain: r.chain,
    error: r.error || null,
    headers: r.headers,
    ms: r.ms,
  };
  pages.set(u, rec);
  if (r.status === 200 && /html/.test(r.ct) && r.body) {
    // Only a crawler prefix makes the joined header ambiguous, so the lines are read apart only then.
    const xrt = r.headers.get("x-robots-tag");
    // A check that throws skips this page's checks with a note. The page answered 200, so it's never reported as a
    // server error or a broken link.
    let a;
    try {
      a = analyze(
        r.finalUrl,
        r.body,
        r.headers,
        xrt && xrt.toLowerCase().split(",").some(agentRule) ? await xRobotsLines(r.finalUrl) : null,
      );
    } catch (e) {
      notes.push(
        `A check couldn't read ${r.finalUrl} (${String(e.message).split("\n")[0].slice(0, 120)}), so that page's checks were skipped.`,
      );
      return;
    }
    Object.assign(rec, a, { html: true, productImages: productImages(r.body) });
    rec.links = [];
    rec.mainLinks = new Set(a.mainHrefs.map(h => clean(h, a.base)).filter(Boolean));
    for (const l of a.anchors) {
      if (!l.href || /^(mailto|tel|javascript|sms):/i.test(l.href)) continue;
      const c = clean(l.href, a.base);
      if (!c) continue;
      if (new URL(c).origin !== START_ORIGIN) continue;
      rec.links.push({ url: c, text: l.text });
      enqueue(c, r.finalUrl);
    }
    for (const b of a.crumbs) enqueue(toCrawl(b), r.finalUrl);
    for (const c of a.canonicals.slice(0, 1)) {
      const x = c && urlOr(c, a.base);
      if (x) enqueue(toCrawl(x.href), r.finalUrl);
    }
  }
}
async function runQueue() {
  await new Promise(done => {
    let active = 0;
    const pump = () => {
      while (active < CONC && queue.length && fetched < MAX) {
        const u = queue.shift();
        active++;
        fetched++;
        crawlOne(u)
          .catch(e => pages.set(u, { url: u, status: 0, error: String(e) }))
          .finally(() => {
            active--;
            pump();
          });
      }
      if (fetched >= MAX && queue.length) capped = true;
      if (active === 0 && (!queue.length || fetched >= MAX)) done();
    };
    pump();
  });
}

// ---------- main ----------
const t0 = Date.now();
const robotsRes = await follow(START_ORIGIN + "/robots.txt");
const robots =
  robotsRes.status === 200 && robotsRes.body && !/<html/i.test(robotsRes.body) ? parseRobots(robotsRes.body) : null;
// Google treats a 4xx other than 429 as no rules, and a 5xx, 429 or no answer as a server error that halts crawling.
// After five redirects it treats the file as missing.
// https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
const robotsHops = robotsRes.error === "too many redirects" ? robotsRes.chain.map(c => c.url) : null;
const robotsDown = !robotsHops && (robotsRes.status >= 500 || robotsRes.status === 429 || robotsRes.status === 0);
evalRules("CRAWL-01", ...(robotsDown ? [] : ["MAP-01", "MAP-05", "MAP-06"]));
const star = robots ? groupFor(robots, "*") : null;
if (robotsDown)
  add(
    "robots-server-error",
    START_ORIGIN + "/robots.txt",
    robotsRes.status ? `status ${robotsRes.status}` : `no answer: ${robotsRes.error}`,
  );
else if (robotsHops) {
  const again = robotsHops.findIndex((u, i) => robotsHops.indexOf(u) < i);
  add(
    "robots-missing",
    START_ORIGIN + "/robots.txt",
    `${again > 0 ? `a redirect loop: ${[...robotsHops.slice(0, again), robotsHops[again]].join(" → ")}` : `more than 5 redirects: ${robotsHops[0]} → … → ${robotsHops.at(-1)}`}. Google stops after 5 and reads that as no robots.txt`,
  );
} else if (!robots) add("robots-missing", START_ORIGIN + "/robots.txt", `status ${robotsRes.status}`);
else {
  if (star && !allowedBy(star, "/"))
    add("robots-blocks-all", START_ORIGIN + "/robots.txt", "User-agent: * is not allowed to crawl /");
  for (const p of ["/_next/static/x.js", "/assets/x.js", "/static/x.css", "/x.css", "/x.js"])
    if (star && !allowedBy(star, p) && allowedBy(star, "/"))
      add("robots-blocks-assets", START_ORIGIN + "/robots.txt", `blocks ${p.replace(/x\.(js|css)$/, "")}`);
  const AI = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-SearchBot",
    "Claude-User",
    "anthropic-ai",
    "Claude-Web",
    "PerplexityBot",
    "Google-Extended",
    "CCBot",
    "Applebot-Extended",
    "Bytespider",
    "meta-externalagent",
  ];
  for (const bot of AI) {
    const g = groupFor(robots, bot);
    if (g && !allowedBy(g, "/")) add("ai-bots-blocked", START_ORIGIN + "/robots.txt", bot);
  }
  if (!robots.sitemaps.length) add("sitemap-not-in-robots", START_ORIGIN + "/robots.txt");
  // A line may start with the path it applies to: `Content-Signal: /blog/ search=yes`. https://contentsignals.org
  for (const m of robotsRes.body.matchAll(/^\s*content-signal\s*:\s*(?:\/\S*\s+)?(.*)$/gim))
    for (const pair of m[1]
      .split(",")
      .map(x => x.trim())
      .filter(Boolean)) {
      // The Content Signals Policy's three keys, plus the use= field Cloudflare is testing in its managed robots.txt.
      const [k, v] = pair.split("=").map(x => (x || "").trim().toLowerCase());
      if (!/^(?:(?:search|ai-input|ai-train)=(?:yes|no)|use=(?:immediate|reference|full))$/.test(`${k}=${v}`))
        add("content-signal-invalid", START_ORIGIN + "/robots.txt", pair);
    }
}
const smUrls = robots && robots.sitemaps.length ? robots.sitemaps : [START_ORIGIN + "/sitemap.xml"];
const firstSm = smUrls[0];
if (!SITE_ORIGIN) {
  try {
    const o = new URL(firstSm).origin;
    if (o !== START_ORIGIN) SITE_ORIGIN = o;
  } catch {}
}
const smListed = !!(robots && robots.sitemaps.length);
let sm = await readSitemaps(smUrls, smListed);
// With no Sitemap: line, the plugins' index names, then WordPress core's (since 5.5).
for (const path of ["/sitemap_index.xml", "/sitemap-index.xml", "/wp-sitemap.xml"]) {
  if (sm.entries.length || smListed) break;
  const alt = await readSitemaps([START_ORIGIN + path], false);
  if (alt.entries.length) sm = alt;
}
if (sm.filesLeft)
  notes.push(
    "The sitemap index lists more than 60 sitemap files. Only the first 60 were read, so the URLs in the rest weren't checked.",
  );
else if (sm.cut)
  notes.push(
    `The sitemaps list more than ${SITEMAP_KEEP.toLocaleString("en-US")} URLs. Only the first ${SITEMAP_KEEP.toLocaleString("en-US")} were read, so the rest, and any sitemap files after them, weren't checked.`,
  );
if (!SITE_ORIGIN && sm.entries.length) {
  try {
    const o = new URL(sm.entries[0].loc).origin;
    if (o !== START_ORIGIN && !isLocal(o)) SITE_ORIGIN = o;
  } catch {}
}
for (const f of sm.files) {
  if (f.invalid) add("sitemap-invalid", f.url, f.invalid);
  if (f.tooBig || f.urls > 50000)
    add("sitemap-too-big", f.url, f.tooBig ? "over 50 MB uncompressed" : `${f.urls.toLocaleString("en-US")} URLs`);
  if (f.nestedIn) add("sitemap-index-nested", f.url, `listed in ${f.nestedIn}`);
}
if (!sm.entries.length && !findings.has("sitemap-invalid"))
  add(
    "sitemap-missing",
    smUrls.join(", "),
    sm.files.map(f => `${f.url} → ${f.status}${f.html ? ", an HTML page" : ""}`).join("; ") || undefined,
  );
// The home page goes first: its canonical may give the public origin.
enqueue(START.href);
await runQueue();
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
const smSet = new Map(); // crawl URL -> entry
evalRules("MAP-02", "MAP-04");
// Google asks to keep session IDs out of URLs: the common names and ASP.NET's (S(…)) path form.
// https://developers.google.com/search/docs/crawling-indexing/url-structure
const SESSION_ID =
  /[;?&](?:jsessionid|phpsessid|sessionid|session_id|sessid|aspsessionid[a-z]*|cftoken)=[^&#;]*|\/\(S\([a-z0-9]+\)\)/i;
for (const e of sm.entries) {
  // A <loc> must be under 2,048 characters, and Google ignores #fragments. https://www.sitemaps.org/protocol.html
  if (e.loc.length >= 2048)
    add(
      "sitemap-url-too-long",
      e.sitemap,
      `${e.loc.slice(0, 80)}… (${e.loc.length.toLocaleString("en-US")} characters)`,
    );
  const sid = SESSION_ID.exec(e.loc)?.[0];
  if (sid || e.loc.includes("#")) add("sitemap-session-ids", e.loc, sid ? `session ID ${sid}` : "a #fragment");
  let o;
  try {
    o = new URL(e.loc).origin;
  } catch {
    continue;
  }
  if (o !== EXPECT_ORIGIN) add("sitemap-origin", e.loc, `expected ${EXPECT_ORIGIN}`);
  const c = clean(toCrawl(e.loc));
  if (!c) continue;
  smSet.set(c, e);
  if (new URL(c).origin === START_ORIGIN && !seen.has(c) && inSection(new URL(c).pathname)) {
    seen.add(c);
    queue.push(c);
  }
}
const lm = sm.entries.map(e => (e.lastmod || "").slice(0, 10)).filter(Boolean);
if (lm.length >= 5 && new Set(lm).size === 1)
  add("sitemap-lastmod-same", firstSm, `all ${lm.length} entries: ${lm[0]}`);
// Per sitemap file: lastmod after tomorrow (a day of slack for time zones) or not a W3C date, and tags Google ignores.
const W3C_DATE =
  /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d))?)?)?$/;
// The regex allows 2026-02-30; a real day survives the round trip through Date.
const realDay = s => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return !d || new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
};
const validLastmod = s => W3C_DATE.test(s) && realDay(s);
const bySitemap = new Map();
for (const e of sm.entries) (bySitemap.get(e.sitemap) || bySitemap.set(e.sitemap, []).get(e.sitemap)).push(e);
// The same URL twice in one file or in two regular sitemaps; a media or news entry for a listed page is fine.
const plainIn = new Map(),
  inFile = new Set(),
  dupes = new Map(); // URL -> first regular file; "file URL"; file -> [[URL, other file]]
for (const e of sm.entries) {
  const key = `${e.sitemap} ${e.loc}`,
    other = inFile.has(key) ? e.sitemap : !e.media && plainIn.get(e.loc);
  inFile.add(key);
  if (!e.media && !plainIn.has(e.loc)) plainIn.set(e.loc, e.sitemap);
  if (other) (dupes.get(e.sitemap) || dupes.set(e.sitemap, []).get(e.sitemap)).push([e.loc, other]);
}
for (const [file, ds] of dupes)
  add(
    "sitemap-duplicate-urls",
    file,
    `${ds.length.toLocaleString("en-US")} URL(s) listed more than once, e.g. ${ds[0][0]} ${ds[0][1] === file ? "twice in this file" : `(also in ${ds[0][1]})`}`,
  );
for (const [file, es] of bySitemap) {
  const videos = es.flatMap(e => (e.videos || []).map(missing => ({ loc: e.loc, missing }))),
    badVideos = videos.filter(v => v.missing.length);
  if (badVideos.length)
    add(
      "video-sitemap-tags",
      file,
      `${badVideos.length} of ${videos.length} videos, e.g. ${badVideos[0].loc}: ${badVideos[0].missing.join(", ")}`,
    );
  const pictured = es.filter(e => e.images),
    badImages = pictured.filter(e => e.images.noLoc || e.images.count > 1000);
  if (badImages.length) {
    const { loc, images: i } = badImages[0];
    add(
      "image-sitemap-tags",
      file,
      `${badImages.length} of ${pictured.length} pages with images, e.g. ${loc}: ${[i.noLoc && `${i.noLoc} <image:image> without <image:loc>`, i.count > 1000 && `${i.count.toLocaleString("en-US")} images (1,000 at most)`].filter(Boolean).join(", ")}`,
    );
  }
  const dated = es.filter(e => e.lastmod),
    eg = list => `${list.length} of ${es.length} entries, e.g. ${list[0].loc}: ${list[0].lastmod}`;
  const invalid = dated.filter(e => !validLastmod(e.lastmod)),
    future = dated.filter(e => validLastmod(e.lastmod) && Date.parse(e.lastmod) > Date.now() + 864e5);
  if (future.length) add("sitemap-lastmod-future", file, eg(future));
  if (invalid.length) add("sitemap-lastmod-invalid", file, eg(invalid));
  // Ignored, not harmful, so a note rather than a finding.
  const hinted = es.filter(e => e.hints).length;
  if (hinted)
    notes.push(
      `${file}: ${hinted} of ${es.length} entries use <priority> or <changefreq>. Google and Bing ignore both, so they can go when the sitemap code is next touched; an accurate lastmod is the signal that counts.`,
    );
  // A news sitemap, per Google's rules: the required tags, a full W3C date, articles from the last two days (a day
  // of slack for time zones and date-only values), and at most 1,000 of them.
  const news = es.filter(e => e.news);
  if (!news.length) continue;
  const say = (list, what) => `${list.length} of ${news.length} articles, e.g. ${list[0].loc}: ${what(list[0].news)}`;
  const newsDate = d => !!d && d.length >= 10 && validLastmod(d);
  const untagged = news.filter(e => e.news.missing.length || !newsDate(e.news.date)),
    old = news.filter(e => newsDate(e.news.date) && Date.parse(e.news.date) < Date.now() - 3 * 864e5);
  if (untagged.length)
    add(
      "news-sitemap-tags",
      file,
      say(untagged, n =>
        n.missing.length
          ? `no ${n.missing.map(t => `<${t}>`).join(", ")}`
          : `publication date “${n.date}” isn't a W3C date such as 2026-11-17 or 2026-11-17T10:30:00+00:00`,
      ),
    );
  if (old.length)
    add(
      "news-sitemap-old",
      file,
      say(old, n => n.date),
    );
  if (news.length > 1000) add("news-sitemap-too-many", file, `${news.length.toLocaleString("en-US")} articles`);
}
await runQueue();

// Probes: soft 404, slash variants, well-known files and security headers.
evalRules("CRAWL-05", "URL-02", "TRUST-01", "TRUST-02");
const probe = await follow(`${START_ORIGIN}/seo-supervisor-404-probe-${Date.now().toString(36)}`);
if (probe.status === 200)
  add(
    "soft-404",
    probe.chain[0].url,
    probe.chain.length > 1 ? `redirected to ${probe.finalUrl} (200)` : "returned 200",
  );
// llms.txt is optional (MAP-07), so a missing one is a note, not a finding; one that exists has its format checked.
const llms = await get(START_ORIGIN + "/llms.txt", { manual: false });
if (llms.status !== 200 || /<html/i.test(llms.body || ""))
  notes.push(
    `No /llms.txt (${llms.status === 200 ? "it returns an HTML page" : `status ${llms.status}`}). It's optional: Google ignores it and no major AI crawler documents reading it, so it isn't scored.`,
  );
else {
  evalRules("MAP-07");
  const problems = [
    !/^# \S/.test(llms.body.replace(/^\uFEFF/, "").trimStart()) && "no # heading first",
    !/\[[^\]]+\]\([^)\s]+\)/.test(llms.body) && "no Markdown links",
  ].filter(Boolean);
  if (problems.length) add("llms-structure", START_ORIGIN + "/llms.txt", problems.join(", "));
}
// A Markdown response must vary on Accept so caches keep it apart from the HTML. AI-05 counts as checked only when
// the site serves Markdown; otherwise the code-level check decides it.
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
  await md.body?.cancel();
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
      const head = d.filter(x => ["title", "canonical", "robots"].includes(x.field)),
        body = d.filter(x => !head.includes(x));
      if (head.length) add("render-changes-head", u, head.map(say).join("; "));
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
const pageOf = r => (r.status === 200 && /html/.test(r.ct) && r.body ? analyze(r.finalUrl, r.body, r.headers) : null);
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

// ---------- crawling: site-wide ----------
// A versioned user-agent still matches by its bare name, so this is a note, not a finding.
if (robots?.versioned.length) {
  const v = robots.versioned[0],
    bare = /^[A-Za-z_-]+/.exec(v)[0];
  notes.push(
    `robots.txt names ${robots.versioned.map(x => `\`User-agent: ${x}\``).join(", ")} with more than the crawler's name. Google reads only the name, up to the first character that isn't a letter, "_" or "-", so ${v} counts as ${bare}. RFC 9309 allows only those characters, so other crawlers may not match it: write the bare name, such as \`User-agent: ${bare}\`.`,
  );
}
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

// ---------- AI crawlers: site-wide ----------
// Each AI bot's access in agents.mjs's list: its own group, else `User-agent: *`. Then Content-Signal lines crawlers
// won't read (MAP-06, low).
// https://www.rfc-editor.org/rfc/rfc9309#section-2.2.1
if (robots) {
  // A second name the vendor accepts counts as the bot's own group. A fallback group comes before `User-agent: *`:
  // Applebot follows Googlebot's when it isn't named. https://support.apple.com/en-us/119829
  extra.aiBots = AI_BOTS.map(([bot, vendor, kind, mayIgnore, { alias, fallback } = {}]) => {
    const own = groupFor(robots, bot) || (alias ? groupFor(robots, alias) : null),
      via = !own && fallback ? groupFor(robots, fallback) : null,
      g = own || via || star;
    return {
      bot,
      vendor,
      kind,
      robots:
        !g || allowedBy(g, "/")
          ? "allowed"
          : own
            ? "blocked"
            : via
              ? `blocked-by-${fallback.toLowerCase()}`
              : "blocked-by-star",
      ...(mayIgnore ? { mayIgnore } : {}),
    };
  });
  // The shared AI-training opt-out (IETF draft-kelley-aipref-training-preference-signal) matches only its own group.
  const shared = groupFor(robots, "__usage_ai-training");
  extra.trainingOptOut = !shared
    ? "not-set"
    : !allowedBy(shared, "/")
      ? "blocked"
      : shared.rules.some(x => !x.allow && x.path)
        ? "partly"
        : "allowed";
  for (const d of signalPlacement(robotsRes.body, g => !allowedBy(g, "/")))
    add("content-signal-placement", START_ORIGIN + "/robots.txt", d);
}
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

// AI crawler rules in robots.txt that contradict each other (MAP-06, needs-decision), aipref Content-Usage lines, and
// Cloudflare's Bot Preference Sync block, which Cloudflare prepends to robots.txt between "# BEGIN Cloudflare Bot
// Preference Sync" and "# END Cloudflare Bot Preference Sync".
// https://blog.cloudflare.com/bot-preference-sync
if (robots) {
  const ai = aiRobots(robotsRes.body, allowedBy);
  for (const c of ai.conflicts) add("ai-robots-conflict", START_ORIGIN + "/robots.txt", c);
  if (ai.usage.length) extra.contentUsage = ai.usage;
  if (/^\s*#\s*BEGIN Cloudflare Bot Preference Sync\b/im.test(robotsRes.body)) extra.botPreferenceSync = true;
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
  notes,
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
for (const n of notes) console.log("note: " + n);
console.log("wrote " + OUT);
