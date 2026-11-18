#!/usr/bin/env node
// Read-only SEO crawler: GET requests only.
// Regex HTML parsing is enough for audit evidence. Swap in a real parser if a site breaks it.

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const VERSION = "1.0.0";
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
  "CONTENT-01": ["Exactly one H1 per page", "Headings & content"],
  "CONTENT-02": ["Heading levels are not skipped", "Headings & content"],
  "CONTENT-04": ["Templated pages have unique content", "Headings & content"],
  "CONTENT-05": ["Indexable pages have substantial content", "Headings & content"],
  "CONTENT-08": ["Images have alt text", "Headings & content"],
  "SCHEMA-01": ["JSON-LD parses without errors", "Structured data"],
  "SCHEMA-02": ["Organization and WebSite schema on the home page", "Structured data"],
  "SCHEMA-03": ["Indexable pages carry structured data", "Structured data"],
  "SCHEMA-04": ["Schema matches what the page visibly shows", "Structured data"],
  "SCHEMA-05": ["No deprecated schema types", "Structured data"],
  "SCHEMA-07": ["BreadcrumbList on pages below the home page", "Structured data"],
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
  "PERF-03": ["The first image is not lazy-loaded", "Performance"],
  "PERF-04": ["Images reserve their space (width and height)", "Performance"],
  "PERF-06": ["HTML documents stay lightweight", "Performance"],
  "TRUST-01": ["HTTPS security headers are set", "Trust & security"],
  "TRUST-02": ["security.txt published", "Trust & security"],
  "AI-01": ["Pages are eligible for snippets and AI answers", "AI search"],
  "REND-08": ["HTML stays under Googlebot's 2 MB limit", "Rendering"],
};

// key -> [rule, severity, title(n), why, fix]
const CHECKS = {
  "robots-blocks-all": [
    "CRAWL-01",
    "blocker",
    () => "robots.txt blocks the whole site",
    "With `Disallow: /` for every crawler, search engines can't crawl any page, so nothing new gets indexed and existing pages decay.",
    "Allow crawling in production (`Allow: /`). Keep staging out of Google with a noindex header and a password instead.",
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
    "Shared links on Slack, LinkedIn and X show a bare URL instead of a card.",
    "Emit Open Graph and Twitter tags from the metadata helper, with a default image and per-page images for key pages.",
  ],
  "lang-missing": [
    "META-05",
    "low",
    () => "Pages don't declare a language",
    "`<html lang>` helps search engines and screen readers.",
    "Set `lang` on the `<html>` element in the root layout.",
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
    n => `${n} page(s) use schema with no rich result (HowTo, SearchAction)`,
    "HowTo rich results ended in 2023 and the sitelinks search box in 2024. The markup does no harm but earns nothing.",
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
  "llms-txt": [
    "MAP-07",
    "low",
    () => "No /llms.txt",
    "llms.txt gives AI tools a short, clean map of the site.",
    "Publish a Markdown llms.txt generated from the same data as the sitemap.",
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
    "If the first image is the largest element, lazy-loading it delays LCP.",
    'Load the hero image eagerly with high priority (`priority` / `fetchpriority="high"`).',
  ],
  "img-dimensions": [
    "PERF-04",
    "low",
    n => `${n} page(s) have images without width and height`,
    "Images without dimensions shift the layout as they load (CLS).",
    "Set width and height (or an aspect-ratio box) on every image.",
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
async function get(url, { manual = true, text = true } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: manual ? "manual" : "follow",
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        signal: AbortSignal.timeout(20000),
      });
      const ct = res.headers.get("content-type") || "";
      let body = "";
      if (text && res.status < 300 && /html|xml|text\/plain/.test(ct)) body = await res.text();
      else await res.arrayBuffer().catch(() => {});
      return { status: res.status, headers: res.headers, ct, body, location: res.headers.get("location") };
    } catch (e) {
      if (attempt === 1) return { status: 0, error: String(e.message || e), headers: new Headers(), ct: "", body: "" };
      await sleep(500);
    }
  }
}
async function follow(url) {
  const chain = [];
  let cur = url;
  for (let i = 0; i < 6; i++) {
    const r = await get(cur);
    chain.push({ url: cur, status: r.status });
    if (r.status >= 300 && r.status < 400 && r.location) {
      cur = new URL(r.location, cur).href;
      continue;
    }
    return { ...r, chain, finalUrl: cur };
  }
  return { status: 0, error: "too many redirects", chain, finalUrl: cur, headers: new Headers(), ct: "", body: "" };
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
const norm = s =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
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

function ctx(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  const s = Math.max(0, m.index - 60),
    e = Math.min(text.length, m.index + m[0].length + 60);
  return { match: m[0], snippet: (s ? "…" : "") + text.slice(s, e) + (e < text.length ? "…" : "") };
}
function analyze(url, html, headers) {
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html;
  const bodyStart = html.search(/<body\b/i);
  const bodyRaw = bodyStart >= 0 ? html.slice(bodyStart) : html;
  const body = stripNonContent(bodyRaw);
  const text = textOf(body);
  const words = text ? text.split(" ").filter(w => /[\p{L}\p{N}]/u.test(w)).length : 0;
  const metas = tagsOf(head, "meta");
  const meta = n => metas.find(m => (m.name || m.property || "").toLowerCase() === n)?.content;
  const titleM = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const titleCount = (head.match(/<title\b/gi) || []).length;
  const PH =
    /\b[Ll]orem [Ii]psum\b|\bTODO\b|\bTBD\b|\{\{\s*[\w.]+\s*\}\}|\[(?:[A-Z][A-Z _]{2,29})\]|�|\b(?:We|You|They|It|Don|Can|Isn|Won|Doesn|Didn|That|There)\?(?:ve|re|s|t|ll|d)\b/;
  const robotsMeta = tagsOf(html, "meta")
    .filter(m => ["robots", "googlebot"].includes((m.name || "").toLowerCase()))
    .map(m => m.content || "")
    .join(",")
    .toLowerCase(); // Google honours robots meta in <body> too
  const xRobots = (headers.get("x-robots-tag") || "").toLowerCase();
  const canon = tagsOf(head, "link")
    .filter(l => (l.rel || "").toLowerCase().split(/\s+/).includes("canonical"))
    .map(l => l.href);
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
  const deprecated = [
    ...new Set([
      ...types.filter(t => t === "HowTo"),
      ...(nodes.some(n => deepHas(n, o => typesOf(o).includes("SearchAction"))) ? ["SearchAction"] : []),
    ]),
  ];
  const phMatch = text.match(PH);
  const mainM = body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const mainHtml = mainM ? mainM[1] : body.replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const mw = textOf(mainHtml)
    .toLowerCase()
    .split(" ")
    .filter(w => /[\p{L}\p{N}]/u.test(w));
  const mainHrefs = [...mainHtml.matchAll(/<a\b([^>]*)>/gi)].map(m => attrs("<a " + m[1] + ">").href).filter(Boolean);
  let shingles = null;
  if (mw.length >= 50) {
    shingles = new Set();
    for (let i = 0; i + 5 <= mw.length; i++) shingles.add(mw.slice(i, i + 5).join(" "));
  }
  const emptyRoot = /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(bodyRaw);
  return {
    title: titleM ? textOf(titleM[1]) : null,
    description: meta("description") ?? null,
    ogTitle: meta("og:title") ?? null,
    ogImage: meta("og:image") ?? null,
    lang: (html.match(/<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i) || [])[1] || null,
    noindex: /noindex/.test(robotsMeta) || /noindex/.test(xRobots),
    canonicals: canon,
    nosnippet: /nosnippet|max-snippet\s*:\s*0\b/.test(robotsMeta + "," + xRobots),
    headings,
    h1Count: headings.filter(h => h.level === 1).length,
    words,
    normText: norm(text),
    anchors,
    imgs,
    types,
    jsonldErrors: errors,
    faqQs,
    crumbs,
    hasRating,
    deprecated,
    emptyRoot,
    mainHrefs,
    banned: BANNED ? ctx(text, BANNED) : null,
    unconfirmed: VERIFY ? ctx(text, VERIFY) : null,
    shingles,
    titleCount,
    placeholder: phMatch ? phMatch[0] : null,
    hashLinks: anchors.filter(l => !l.href || l.href === "#" || /^javascript:/i.test(l.href)).length,
    mixed: url.startsWith("https:") && /\ssrc\s*=\s*["']http:\/\//i.test(bodyRaw),
    scripts: (html.match(/<script\b[^>]*\bsrc=/gi) || []).length,
    bytes: Buffer.byteLength(html),
  };
}

// ---------- robots ----------
function parseRobots(txt) {
  const groups = [];
  let cur = null;
  const sitemaps = [];
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
      cur.agents.push(v.toLowerCase());
      continue;
    }
    if ((k === "allow" || k === "disallow") && cur) cur.rules.push({ allow: k === "allow", path: v });
  }
  return { groups, sitemaps };
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
const groupFor = (robots, agent) => robots.groups.find(g => g.agents.includes(agent.toLowerCase())) || null;

// ---------- sitemap ----------
async function readSitemaps(urls) {
  const entries = [],
    seen = new Set(),
    files = [];
  const queue = [...urls];
  while (queue.length && files.length < 60) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    const r = await get(toCrawl(u), { manual: false });
    if (r.status !== 200 || !r.body) {
      files.push({ url: u, status: r.status });
      continue;
    }
    files.push({ url: u, status: 200 });
    if (/<sitemapindex\b/i.test(r.body)) {
      for (const m of r.body.matchAll(/<sitemap\b[\s\S]*?<loc>\s*([\s\S]*?)\s*<\/loc>/gi))
        queue.push(decode(m[1].trim()));
      continue;
    }
    for (const m of r.body.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
      const loc = (m[1].match(/<loc>\s*([\s\S]*?)\s*<\/loc>/i) || [])[1];
      const lastmod = (m[1].match(/<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/i) || [])[1];
      if (loc) entries.push({ loc: decode(loc.trim()), lastmod: lastmod ? lastmod.trim() : null });
    }
  }
  return { entries, files };
}

// ---------- URL helpers ----------
const isLocal = o => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(o);
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
  if (seen.has(c)) return;
  seen.add(c);
  queue.push(c);
}
async function crawlOne(u) {
  const r = await follow(u);
  const rec = {
    url: u,
    status: r.status,
    finalUrl: r.finalUrl,
    chain: r.chain,
    error: r.error || null,
    headers: r.headers,
  };
  pages.set(u, rec);
  if (r.status === 200 && /html/.test(r.ct) && r.body) {
    const a = analyze(r.finalUrl, r.body, r.headers);
    Object.assign(rec, a, { html: true });
    rec.links = [];
    rec.mainLinks = new Set(a.mainHrefs.map(h => clean(h, r.finalUrl)).filter(Boolean));
    for (const l of a.anchors) {
      if (!l.href || /^(mailto|tel|javascript|sms):/i.test(l.href)) continue;
      const c = clean(l.href, r.finalUrl);
      if (!c) continue;
      if (new URL(c).origin !== START_ORIGIN) continue;
      rec.links.push({ url: c, text: l.text });
      enqueue(c, r.finalUrl);
    }
    for (const b of a.crumbs) enqueue(toCrawl(b), r.finalUrl);
    for (const c of a.canonicals.slice(0, 1)) if (c) enqueue(toCrawl(new URL(c, r.finalUrl).href), r.finalUrl);
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
const robotsRes = await get(START_ORIGIN + "/robots.txt", { manual: false });
const robots =
  robotsRes.status === 200 && robotsRes.body && !/<html/i.test(robotsRes.body) ? parseRobots(robotsRes.body) : null;
evalRules("CRAWL-01", "MAP-05", "MAP-06", "MAP-01");
const star = robots ? groupFor(robots, "*") : null;
if (!robots) add("robots-missing", START_ORIGIN + "/robots.txt", `status ${robotsRes.status}`);
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
}
const smUrls = robots && robots.sitemaps.length ? robots.sitemaps : [START_ORIGIN + "/sitemap.xml"];
const firstSm = smUrls[0];
if (!SITE_ORIGIN) {
  try {
    const o = new URL(firstSm).origin;
    if (o !== START_ORIGIN) SITE_ORIGIN = o;
  } catch {}
}
let sm = await readSitemaps(smUrls);
if (!sm.entries.length && !(robots && robots.sitemaps.length)) {
  const alt = await readSitemaps([START_ORIGIN + "/sitemap_index.xml"]);
  if (alt.entries.length) sm = alt;
}
if (!SITE_ORIGIN && sm.entries.length) {
  try {
    const o = new URL(sm.entries[0].loc).origin;
    if (o !== START_ORIGIN && !isLocal(o)) SITE_ORIGIN = o;
  } catch {}
}
if (!sm.entries.length)
  add("sitemap-missing", smUrls.join(", "), sm.files.map(f => `${f.url} → ${f.status}`).join("; ") || undefined);
// The home page goes first: its canonical may give the public origin.
enqueue(START.href);
await runQueue();
const home = pages.get(START.href);
if (!SITE_ORIGIN && home && home.canonicals && home.canonicals[0]) {
  try {
    const o = new URL(home.canonicals[0], home.finalUrl).origin;
    if (o !== START_ORIGIN && !isLocal(o)) SITE_ORIGIN = o;
  } catch {}
}
const EXPECT_ORIGIN = SITE_ORIGIN || START_ORIGIN;
if (SITE_ORIGIN && SITE_ORIGIN !== START_ORIGIN)
  notes.push(`Public origin ${SITE_ORIGIN} was mapped onto ${START_ORIGIN} for crawling.`);
const smSet = new Map(); // crawl URL -> entry
evalRules("MAP-02", "MAP-04");
for (const e of sm.entries) {
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
  if (new URL(c).origin === START_ORIGIN && !seen.has(c)) {
    seen.add(c);
    queue.push(c);
  }
}
const lm = sm.entries.map(e => (e.lastmod || "").slice(0, 10)).filter(Boolean);
if (lm.length >= 5 && new Set(lm).size === 1)
  add("sitemap-lastmod-same", firstSm, `all ${lm.length} entries: ${lm[0]}`);
await runQueue();

// Probes: soft 404, slash variants, well-known files and security headers.
evalRules("CRAWL-05", "URL-02", "MAP-07", "TRUST-01", "TRUST-02");
const probe = await follow(`${START_ORIGIN}/seo-supervisor-404-probe-${Date.now().toString(36)}`);
if (probe.status === 200)
  add(
    "soft-404",
    probe.chain[0].url,
    probe.chain.length > 1 ? `redirected to ${probe.finalUrl} (200)` : "returned 200",
  );
const llms = await get(START_ORIGIN + "/llms.txt", { manual: false });
if (llms.status !== 200 || /<html/i.test(llms.body || ""))
  add(
    "llms-txt",
    START_ORIGIN + "/llms.txt",
    llms.status === 200 ? "returns an HTML page instead (soft 404)" : `status ${llms.status}`,
  );
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
  if (EXPECT_ORIGIN.startsWith("https") && START_ORIGIN.startsWith("https") && !h.get("strict-transport-security"))
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
);
if (BRAND) evalRules("META-03");
if (BANNED || VERIFY) evalRules("CONTENT-10");
const all = [...pages.values()];
const byFinal = new Map();
for (const p of all) if (p.finalUrl) byFinal.set(p.finalUrl, p);
const htmlPages = all.filter(p => p.html);
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
  return c ? new URL(c, p.finalUrl).href : null;
};
const samePath = (a, b) => new URL(a).pathname === new URL(b).pathname;
const indexable = p =>
  p.html &&
  (IGNORE_NOINDEX || !p.noindex) &&
  (() => {
    const c = canonicalFor(p);
    return !c || samePath(toCrawl(c), p.finalUrl);
  })();
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
  if (p.noindex && !IGNORE_NOINDEX) continue;

  if (!p.canonicals.length) add("canonical-missing", u);
  else {
    if (p.canonicals.length > 1) add("canonical-multiple", u, p.canonicals.join(" | "));
    const c = new URL(p.canonicals[0], u);
    if (c.search) add("canonical-query", u, c.href);
    if (c.origin !== EXPECT_ORIGIN) add("canonical-origin", u, c.href);
    if (!samePath(toCrawl(c.href), u)) add("canonical-not-self", u, `→ ${c.href}`);
    const t = pages.get(clean(toCrawl(c.href)));
    if (t && (t.status !== 200 || (t.chain && t.chain.length > 1)))
      add("canonical-bad-target", u, `${c.href} → ${t.chain && t.chain.length > 1 ? "redirect" : t.status}`);
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
  if (p.mixed) add("mixed-content", u);
  if (!p.title) add("title-missing", u);
  else {
    if (p.title.length > 60) add("title-long", u, `${p.title.length} chars: ${p.title}`);
    else if (p.title.length < 20) add("title-short", u, p.title);
    (titleMap.get(p.title) || titleMap.set(p.title, []).get(p.title)).push(u);
    if (BRAND && p.title.split(BRAND).length > 2) add("title-brand-twice", u, p.title);
  }
  if (!p.description) add("desc-missing", u);
  else {
    if (p.description.length < 120 || p.description.length > 160)
      add("desc-length", u, `${p.description.length} chars`);
    (descMap.get(p.description) || descMap.set(p.description, []).get(p.description)).push(u);
  }
  if (!p.ogTitle || !p.ogImage)
    add("og-missing", u, [!p.ogTitle && "og:title", !p.ogImage && "og:image"].filter(Boolean).join(", "));
  if (p.h1Count !== 1) add("h1-count", u, `${p.h1Count} H1s`);
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
  if (p.imgs[0] && (p.imgs[0].loading || "").toLowerCase() === "lazy") add("lazy-lcp", u, p.imgs[0].src || "");
  if (p.bytes > 2 * 1024 * 1024) add("html-over-2mb", u, `${Math.round(p.bytes / 1024)} KB`);
  else if (p.bytes > 500 * 1024) add("html-size", u, `${Math.round(p.bytes / 1024)} KB`);
  if (p.nosnippet) add("nosnippet", u);
  if (p.jsonldErrors.length) add("jsonld-invalid", u, p.jsonldErrors[0]);
  if (!p.types.length) add("jsonld-none", u);
  if (!isHome(p) && !p.types.includes("BreadcrumbList")) add("breadcrumb-missing", u);
  if (p.deprecated.length) add("deprecated-schema", u, p.deprecated.join(", "));
  if (p.hasRating) add("rating-review", u);
  const missingQ = p.faqQs.filter(q => !p.normText.includes(norm(q)));
  if (missingQ.length)
    add("faq-not-visible", u, `${missingQ.length} of ${p.faqQs.length}: “${missingQ[0].slice(0, 60)}”`);
  if (p.links.length > 150) add("too-many-links", u, `${p.links.length} links`);
  const generic = p.links.filter(l =>
    /^(click here|here|read more|learn more|more|this|link|details)$/i.test(l.text.trim()),
  ).length;
  if (generic) add("generic-anchor", u, `${generic} link(s)`);
  if (smSet.size && !smSet.has(p.url) && !smSet.has(u)) add("missing-from-sitemap", u);
  for (const b of p.crumbs.slice(0, -1)) {
    const t = pages.get(clean(toCrawl(b)));
    if (t && t.status !== 200) add("breadcrumb-dead-level", u, `${b} → ${t.status}`);
  }
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
if (home && home.html) {
  if (!home.lang) add("lang-missing", home.finalUrl);
  if (!home.types.some(t => ORG_RE.test(t))) add("org-missing", home.finalUrl);
  if (!home.types.includes("WebSite")) add("website-missing", home.finalUrl);
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
for (const p of styled.slice(0, 5)) {
  const x = new URL(p.finalUrl);
  x.pathname = x.pathname.endsWith("/") ? x.pathname.slice(0, -1) : x.pathname + "/";
  const r = await get(x.href);
  if (r.status === 200) add("slash-variant-no-redirect", x.href, `and ${p.finalUrl} both return 200`);
}

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
    const trail = r.chain.map(c => c.status).join(" → ") + ` → ${r.finalUrl}`;
    if (r.status >= 400 || r.status === 0) add("redirect-broken", u, trail + (r.error ? ` (${r.error})` : ""));
    else if (r.chain.length > 2) add("redirect-chain", u, trail);
  }
  notes.push(`Tested ${Math.min(list.length, 2000)} old/redirect URLs, each with and without a trailing slash.`);
}

// ---------- what the crawler cannot check ----------
const NOT_CRAWLABLE = [
  ["PERF-01", "Core Web Vitals", "Needs field data (Search Console, CrUX) or a Lighthouse run."],
  [
    "CRAWL-09",
    "Bot protection and firewall",
    "A local crawl can't see CDN or WAF behaviour toward Googlebot; check the CDN settings and URL Inspection after launch.",
  ],
  [
    "CRAWL-11",
    "Drafts and publish flags",
    "The crawler can't see publish flags; check the content layer (scripts/content-scan.mjs).",
  ],
  [
    "URL-03",
    "http→https and www redirects",
    "Probe production's http:// and other-host variants, or check server/CDN config.",
  ],
  ["SCHEMA-08", "Rich result eligibility", "Run one URL per template through Google's Rich Results Test."],
  ["META-07", "Search Console and Bing verification", "Check DNS or ask the owner."],
  ["LINK-03", "Circular linking design", "Needs a read of the related-content code and data."],
  ["CONTENT-03", "Keyword targeting and cannibalization", "Needs the content plan or Search Console query data."],
  [
    "CONTENT-11",
    "Spam policies (scaled content, doorways, site reputation, back-button hijacking)",
    "Needs a read of content strategy and scripts; the near-duplicate check covers part of it.",
  ],
  ["REND-07", "Mobile/desktop parity", "Compare a mobile and desktop render of key templates."],
  ["PERF-07", "Popups and interstitials", "Needs a browser look at first load on mobile."],
  [
    "AI-02",
    "AI crawler access through the CDN/WAF",
    "robots.txt is checked; firewall behaviour toward OAI-SearchBot, Claude-SearchBot and PerplexityBot isn't visible locally.",
  ],
];
for (const [rule, area, reason] of NOT_CRAWLABLE) notChecked.push({ rule, area: `${rule} ${area}`, reason });
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
out.forEach((f, i) => {
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
  stats: {
    fetched,
    htmlPages: htmlPages.length,
    sitemapUrls: sm.entries.length,
    sitemapFiles: sm.files,
    robotsTxt: robotsRes.status,
  },
  notes,
  findings: out,
  passed,
  notChecked,
  pages: htmlPages.map(p => ({
    url: p.finalUrl,
    status: p.status,
    depth: p.depth ?? null,
    inSitemap: smSet.has(p.url),
    noindex: p.noindex,
    canonical: canonicalFor(p),
    title: p.title,
    words: p.words,
    h1: p.h1Count,
    schema: p.types,
    linksOut: p.links.length,
    linksIn: inbound.get(p.finalUrl) || 0,
  })),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
const counts = out.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {});
console.log(
  `seo-crawl: ${htmlPages.length} HTML pages (${fetched} fetched), ${sm.entries.length} sitemap URLs, ${out.length} findings ` +
    JSON.stringify(counts) +
    `, ${passed.length} rules passed`,
);
for (const n of notes) console.log("note: " + n);
console.log("wrote " + OUT);
