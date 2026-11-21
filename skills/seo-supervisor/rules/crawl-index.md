# Crawling and indexing (CRAWL)

Can search engines reach the pages, and are they allowed to index the right ones? Every rule lists how to check it: **crawler** (a check name in `seo-crawl.json`) and/or **code** (what to inspect).

### CRAWL-01 · robots.txt lets search engines crawl the site · blocker
- **Check:** crawler `robots-blocks-all`, `sitemap-url-disallowed`, and `robots-server-error` (high). That one fires when robots.txt answers 5xx, 429 or nothing: Google then stops crawling the whole site for 12 hours and uses its last copy for up to 30 days. Code: the robots file or route and its environment switch.
- **Pass:** production allows `/` for `User-agent: *`, and no URL in the sitemap is disallowed.
- **Fix:** allow crawling in production. Disallow only junk (see MAP-05). Use noindex, not `Disallow`, for pages that shouldn't rank: Google must crawl a page to see its noindex.

### CRAWL-02 · Pages meant to rank are not set to noindex · blocker
- **Check:** crawler `home-noindex`, `noindex-in-sitemap`, `noindex-review`. Code: metadata robots values, `X-Robots-Tag` headers, middleware.
- **How robots rules are read:** as Google reads them. `none` is `noindex, nofollow`. Only `<meta name="robots">` and `<meta name="googlebot">` count, not tags for other crawlers. In `X-Robots-Tag`, a crawler prefix holds for the rules after it (`otherbot: noindex, nofollow` is all for otherbot), and only unprefixed and `googlebot:` rules count.
- **noindex with a canonical elsewhere:** `noindex-canonical` (medium) flags a noindex page whose canonical names a different page (another host or path; a trailing slash alone doesn't count). The two signals contradict: keep the canonical for a duplicate, or the noindex with a self-canonical (or none) for a page that should stay hidden.
- **Pass:** only page types the profile lists as hidden (search, filters, account, results, thin browse pages) are noindex.
- **Pre-launch:** when the profile says the whole site is noindex until sign-off, that's expected, not a blocker. Crawl with `--ignore-noindex` so the other checks still run, and confirm CRAWL-03 will lift the noindex at launch.
- **Fix:** drive every noindex rule from the page type, with one environment variable for "whole site hidden".

### CRAWL-03 · Indexing is controlled by one environment variable and checked after deploy · high
- **Check:** code: grep for robots and noindex logic; there should be one variable (e.g. `SITE_INDEXABLE`) feeding robots.txt, meta robots and headers.
- **Pass:** production sets it; a post-deploy step fails if production serves noindex.
- **Fix:** add the check to the deploy pipeline:
  ```bash
  curl -sI "$SITE/" | grep -qi '^x-robots-tag:.*noindex' && exit 1
  curl -s  "$SITE/" | grep -qi '<meta[^>]*name="robots"[^>]*noindex' && exit 1
  ```

### CRAWL-04 · Staging and previews are hidden with noindex plus a password · high
- **Check:** code: deployment config and middleware for non-production environments.
- **Pass:** staging sends `X-Robots-Tag: noindex, nofollow` on every response (including sitemap and robots routes) and sits behind auth or deployment protection. Preview deployments do the same.
- **Fix:** don't rely on `Disallow: /`. A blocked URL can still be indexed from links alone, and Google can't see a noindex it isn't allowed to crawl.

### CRAWL-05 · Correct status codes, and no soft 404s · high
- **Check:** crawler `soft-404`, `server-error`. Code: not-found handling, retired-content handling, maintenance mode.
- **Pass:** 200 for live pages. 404 for unknown URLs. 410 for content removed for good. 301/308 for moved content. 503 with `Retry-After` during maintenance.
- **Fix:** never return a 200 "not found" page, and never redirect unknown URLs to the home page.
- **Check (logs):** `log-scan.mjs` `bot-errors`: a search crawler or AI answer bot got at least 5 server errors and at least 1% of its requests failed; high from 5% or 50 errors, otherwise medium. Planned-maintenance 503s with Retry-After are fine.

### CRAWL-06 · Sitemap URLs return 200 · high
- **Check:** crawler `sitemap-bad-status`.
- **Fix:** generate the sitemap from live data; list final URLs only.

### CRAWL-07 · No internal links to broken pages · high
- **Check:** crawler `broken-internal-link`. Code: generated link blocks (related, next, breadcrumbs, footer).
- **Fix:** fix or remove the link, and filter generated links through the set of live pages (LINK-04).
- **Unreadable addresses:** `url-malformed` (medium) lists link hrefs and image srcs that aren't valid URLs at all, such as `https://` with no host or a host with a space in it. Browsers and crawlers can't follow them; a template usually built them from an empty setting.
- **Links to a missing #section:** `link-fragment-missing` (low) is a link to `page#name` where the crawled page has no element with `id="name"` and no `<a name="name">` (matched as written or percent-decoded; ids are case-sensitive). Left out: a bare `#` and `#top`, router addresses (`#/…`, `#!…`), text fragments (`#:~:text=`), links that open tabs, menus or dialogs (`role="tab"` or `"button"`, `aria-controls`, `data-toggle`), pages the crawl didn't read, and pages built only in the browser, whose ids come from JavaScript. It reads the server HTML, so an id a script adds later isn't seen: open one link in a browser before changing it.
- **Links to other sites:** only with `--outbound-links`, its own owner opt-in, since it visits other sites. Up to 100 distinct outside URLs, 4 at a time, HEAD then GET, 15 s each, and never a private or local address (checked on every redirect and at connect time). `outbound-broken` (low) is a 404 or 410. A refusal (403, 429), a server error or no answer is "couldn't check": it's in the notes and in `outboundLinks`, never counted as broken. Without the flag, Limits lists the outside links as not checked.
- **Check (logs):** `log-scan.mjs --crawl seo-audit/seo-crawl.json` `bot-404s`: URLs the site itself links to (or lists in its sitemap) that search crawlers requested 5 or more times and got a 404. Other repeated 404s are only listed (`repeated404s`), and probe paths such as `/.env` or `/wp-*` are ignored. A 404 or 410 for pages gone for good is fine.

### CRAWL-08 · Redirects take one hop, and internal links skip them · medium
- **Check:** crawler `redirect-chain`, `link-to-redirect`. Code: redirect config, middleware, nginx/CDN rules.
- **Pass:** every old URL goes straight to its final destination. Internal links already point at final URLs, usually with the right trailing slash.
- **Fix:** collapse the chains. Watch frameworks whose trailing-slash redirect runs before custom redirects: put legacy redirects at the edge so they cover both slash forms in one hop.
- **Crawler:** also flags meta refresh redirects (`meta-refresh`, medium); replace them with a server-side 301/308. A redirect (or a sitemap) that leaves the crawled site for a private, local or cloud-metadata address isn't fetched; the crawl keeps the redirect as the answer and says so in a note. The crawled site itself is never blocked, so a localhost or LAN server crawls as usual.
- **http:// links:** on an HTTPS site, `link-http` (medium) flags pages linking to the site's own host (with or without `www`) as `http://`: each click and crawl takes a redirect hop first. Use `https://` or relative paths. Insecure resources on HTTPS pages are TRUST-01's `mixed-content`.

### CRAWL-09 · Bot protection doesn't block real search crawlers · high
- **Check:** code and CDN config: WAF, bot-fight modes, captchas, rate limits.
- **Crawler:** after every other request to the site, the home page and up to 9 sample pages are asked again as Google's smartphone Googlebot and compared with the same phone without the Googlebot token. A 429 or 5xx is asked again once before it counts.
  - `googlebot-blocked` (high): an error or noindex that only Googlebot gets.
  - `googlebot-firewall` (needs-decision): on a staging or live server, a 403, 429 or 503 or a bot challenge that only Googlebot gets. A firewall that verifies Google by IP does this to a fake Googlebot, which is right; on a local build it's `googlebot-blocked`.
  - `googlebot-differs` (medium): a different redirect, canonical or title, or under half the text (possible cloaking or a broken prerender).
  
  A real Googlebot comes from Google's IP addresses, so CRAWL-09 never passes on this test alone; confirm with URL Inspection's live test.
- **Pass:** HTML pages are never challenged. Captchas and rate limits sit on actions (form submits, APIs), not on page loads. Crawlers are verified by reverse DNS or the CDN's verified-bots list, not by user agent.
- **Fix:** exempt HTML routes and verified bots. Under load, answer crawlers with 503 or 429 for hours (at most 1–2 days), never 403 or a challenge page. Verify Googlebot by IP using Google's published ranges (now under `developers.google.com/crawling/`). After launch, confirm a 200 with Search Console's URL Inspection live test.

### CRAWL-10 · Parameter, filter, search and result pages stay out of the index · medium
- **Check:** crawler `parameter-page-indexable` (medium), on parameter URLs the crawl meets (from the sitemap, or links with `--include-query`): a page whose URL adds parameters to a page the crawl also found without them, and that has no canonical or one that keeps the parameters. Tracking parameters (`utm_*`, `gclid`, `fbclid`, `msclkid` and other click IDs) and paging ones (`page`, `p`, `paged`, `offset`, `start`) are left out, since paginated pages stay indexable (URL-08). CRAWL-10 counts as checked only once such a page was crawled. Code: how list filters, sorting, internal search and shareable results build URLs.
- **Pass:** each page type sends one signal, not both:
  - Filter and sort versions of a list send a canonical to the clean URL.
  - Internal search and shareable results send `noindex, follow` and no canonical to another page.
  
  Noindex together with a canonical elsewhere gives Google mixed signals (crawler `noindex-canonical`). None of these pages is in the sitemap or blocked in robots.txt.
- **Fix:** add the robots rule per page type in the metadata helper. Expire shareable result links.

### CRAWL-12 · Crawl budget, only for large sites · low (high on large sites)
- **Applies when:** roughly 1M+ pages changing weekly, 10k+ changing daily, or many "Discovered – currently not indexed" URLs (Google says these aren't exact thresholds). Below that, don't raise crawl budget.
- **Pass:** removed pages return 404/410; no soft 404s or redirect chains; accurate lastmod; `304 Not Modified` supported; facet URLs that shouldn't be in Search are blocked in robots.txt (noindex does **not** save crawl budget); few 5xx or 429 responses.
- **No crawl-rate setting:** Google retired Search Console's crawl rate limiter on 8 January 2024 (Search Central blog, November 2023), so the rate can't be set by hand. To slow Googlebot for a while, answer with 503 or 429 (see CRAWL-09).
- **Crawler:** the audit's own crawler backs off too. On a 429 it pauses every request to the site for the `Retry-After` time (30 s at most, our own cap; 2 s when none is given), then asks once more.
- **Big sites:** when the crawl stops at `--max`, a note (and `siteSize` in `seo-crawl.json`) gives the URLs it knew of from links and sitemaps, a floor for the site's size. To audit one part of a big site, use `--include` and `--exclude` (comma-separated path prefixes, such as `--include /blog/ --exclude /blog/tag/`); the start page is still the way in, robots.txt and the sitemaps are still read whole, and LINK-01 and LINK-02 are then listed as not checked, since links from the pages left out aren't known.
- **Indexed vs intended:** with `--gsc-indexing <Chart.csv>`, the chart table of Search Console's Page indexing export (Indexing → Pages → Export, unzipped, in English), the crawl notes Google's latest indexed and not-indexed counts beside its own count of pages meant to be indexed (`indexing` in `seo-crawl.json`). Information only, never scored: Google counts every URL it knows, so the two rarely match exactly, but a big gap either way is worth a look.

### CRAWL-11 · Unreleased content is unreachable · high
- **Check:** code: draft/publish/release flags in the content layer, and whether routes, static params, the sitemap and link blocks all respect them.
- **Pass:** a draft returns 404, appears in no sitemap or link, and private previews use a secret, uncached, noindex URL.
- **Fix:** filter by the publish flag in one shared query that every consumer uses.
