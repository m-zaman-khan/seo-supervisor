# Crawling and indexing (CRAWL)

Can search engines reach the pages, and are they allowed to index the right ones? Every rule lists how to check it: **crawler** (a check name in `seo-crawl.json`) and/or **code** (what to inspect).

### CRAWL-01 · robots.txt lets search engines crawl the site · blocker
- **Check:** crawler `robots-blocks-all`, `sitemap-url-disallowed`. Code: the robots file or route and its environment switch.
- **Pass:** production allows `/` for `User-agent: *`, and no URL in the sitemap is disallowed.
- **Fix:** allow crawling in production. Disallow only junk (see MAP-05). Use noindex, not `Disallow`, for pages that shouldn't rank: Google must crawl a page to see its noindex.

### CRAWL-02 · Pages meant to rank are not set to noindex · blocker
- **Check:** crawler `home-noindex`, `noindex-in-sitemap`, `noindex-review`. Code: metadata robots values, `X-Robots-Tag` headers, middleware.
- **How robots rules are read:** as Google reads them. `none` is `noindex, nofollow`. Only `<meta name="robots">` and `<meta name="googlebot">` count, not tags for other crawlers. In `X-Robots-Tag`, a crawler prefix holds for the rules after it (`otherbot: noindex, nofollow` is all for otherbot), and only unprefixed and `googlebot:` rules count.
- **noindex with a canonical elsewhere:** `noindex-canonical` (medium) flags a noindex page whose canonical names a different page. The two signals contradict: keep the canonical for a duplicate, or the noindex with a self-canonical (or none) for a page that should stay hidden.
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
- **Check (logs):** `log-scan.mjs --crawl seo-audit/seo-crawl.json` `bot-404s`: URLs the site itself links to (or lists in its sitemap) that search crawlers requested 5 or more times and got a 404. Other repeated 404s are only listed (`repeated404s`), and probe paths such as `/.env` or `/wp-*` are ignored. A 404 or 410 for pages gone for good is fine.

### CRAWL-08 · Redirects take one hop, and internal links skip them · medium
- **Check:** crawler `redirect-chain`, `link-to-redirect`. Code: redirect config, middleware, nginx/CDN rules.
- **Pass:** every old URL goes straight to its final destination. Internal links already point at final URLs, usually with the right trailing slash.
- **Fix:** collapse the chains. Watch frameworks whose trailing-slash redirect runs before custom redirects: put legacy redirects at the edge so they cover both slash forms in one hop.
- **Crawler:** also flags meta refresh redirects (`meta-refresh`, medium); replace them with a server-side 301/308.
- **http:// links:** on an HTTPS site, `link-http` (medium) flags pages linking to the site's own host (with or without `www`) as `http://`: each click and crawl takes a redirect hop first. Use `https://` or relative paths. Insecure resources on HTTPS pages are TRUST-01's `mixed-content`.

### CRAWL-09 · Bot protection doesn't block real search crawlers · high
- **Check:** code and CDN config: WAF, bot-fight modes, captchas, rate limits.
- **Pass:** HTML pages are never challenged. Captchas and rate limits sit on actions (form submits, APIs), not on page loads. Crawlers are verified by reverse DNS or the CDN's verified-bots list, not by user agent.
- **Fix:** exempt HTML routes and verified bots. Under load, answer crawlers with 503 or 429 for hours (at most 1–2 days), never 403 or a challenge page. Verify Googlebot by IP using Google's published ranges (now under `developers.google.com/crawling/`). After launch, confirm a 200 with Search Console's URL Inspection live test.

### CRAWL-10 · Parameter, filter, search and result pages stay out of the index · medium
- **Check:** crawler with `--include-query` on a sample. Code: how list filters, sorting, internal search and shareable results build URLs.
- **Pass:** these pages send `noindex, follow` and a canonical to the clean URL (or none, for results). They're not in the sitemap and not blocked in robots.txt.
- **Fix:** add the robots rule per page type in the metadata helper. Expire shareable result links.

### CRAWL-12 · Crawl budget, only for large sites · low (high on large sites)
- **Applies when:** roughly 1M+ pages changing weekly, 10k+ changing daily, or many "Discovered – currently not indexed" URLs (Google says these aren't exact thresholds). Below that, don't raise crawl budget.
- **Pass:** removed pages return 404/410; no soft 404s or redirect chains; accurate lastmod; `304 Not Modified` supported; facet URLs that shouldn't be in Search are blocked in robots.txt (noindex does **not** save crawl budget); few 5xx or 429 responses.

### CRAWL-11 · Unreleased content is unreachable · high
- **Check:** code: draft/publish/release flags in the content layer, and whether routes, static params, the sitemap and link blocks all respect them.
- **Pass:** a draft returns 404, appears in no sitemap or link, and private previews use a secret, uncached, noindex URL.
- **Fix:** filter by the publish flag in one shared query that every consumer uses.
