# Launch and monitoring (LAUNCH)

### LAUNCH-01 · Crawl staging before launch · high
- Run the crawler against staging (with auth, or a production build on localhost). Zero blockers and zero high findings in CRAWL, URL, REND and MAP before go-live.
- Check the redirect map for the old site: every old URL that has traffic or backlinks 301s to its closest new page in one hop, and nothing that used to get traffic returns 404 (old blog posts, printed short links like `/go/review`).

### LAUNCH-02 · Launch day · high
1. Switch the indexing variable on and run the production noindex check (CRAWL-03).
2. Confirm `http` → `https` and the host redirects (URL-03).
3. Submit the sitemap in Search Console and Bing, and ping IndexNow (`scripts/indexnow.mjs`, after deploy and with the owner's yes).
4. Run URL Inspection on the home page, the main hubs and the 10 most important pages, and request indexing.
5. Re-run the crawler against production with `--concurrency 2`.

### LAUNCH-03 · The build fails on SEO regressions · high
- **Check:** CI config.
- **Pass:** a content or route validator runs in prebuild or CI and fails on:
  - duplicate or wrongly sized titles and descriptions
  - not exactly one H1, or skipped heading levels
  - FAQ schema without a visible FAQ
  - links to unknown or unpublished slugs
  - orphan pages
  - near-duplicate intros
  - reused FAQ questions
  - placeholder and banned strings
  - a slug changed without a redirect
- When a rule fires, rewrite the content; never weaken the rule. The crawler can also run in CI against a preview deployment: fail the job when `seo-crawl.json` has blocker or high findings.

### LAUNCH-04 · Measure what visitors do · medium
- Analytics events on the actions that matter (form submit, tool run, call click, add to cart, next-step link clicks). Never send what a visitor typed, secrets or scanned domains. Tool sites: use the event list in TOOL-12.
- **Consent Mode (EU):** with Google's Consent Mode, a visitor who declines analytics cookies isn't counted like the others. The basic setup blocks the Google tag until consent, so nothing is collected. The advanced setup sends cookieless pings, which Analytics models only when the property qualifies (support.google.com/analytics/answer/9976101). Either way, Analytics counts fewer search visits from the EU than Search Console counts clicks. Compare trends, not totals, and don't read the gap as lost traffic.
- **Crawler (`analytics-tag-twice`, low):** the same GA4 ID set up in two scripts, or one Tag Manager container loaded twice. Google says the same Google tag configured twice "may cause duplicate data or mixed settings"; fine when the tag's "Ignore duplicate instances of on-page configuration" setting is on. Tags inside Tag Manager aren't seen.

### LAUNCH-05 · Watch Search Console every week · medium
- **Pages report:** "Crawled, currently not indexed" on templated pages usually means thin or duplicate content (CONTENT-04/05).
- 404s that have backlinks get redirects. `scripts/links-import.mjs --crawl seo-audit/seo-crawl.json` checks Search Console's Top linked pages and Bing's linked pages against the crawl: one that returns 404 or 410, redirects in a loop, or redirects to the home page is `linked-page-broken` (URL-07).
- **Since last audit:** besides the pages themselves, `seo-diff.mjs` compares robots.txt (`robots-changed`, with the rules that went and came), sitemap listing (`left-sitemap`, `joined-sitemap`), internal links in (`lost-internal-links`: fell by half and by at least 5) and the redirects the crawl met (`redirect-changed`, `redirect-added`, `redirect-removed`), each only when both crawls recorded it.
- Known backlinks still link (`backlinks-gone`, `scripts/backlinks.mjs`, after a redesign or move). For each gone one, ask the site to restore or update the link. If it pointed at a page that moved, 301 the old address to the closest live page.
- Core Web Vitals and enhancement reports.
- Manual actions and security issues.
- **Security warnings:** if traffic drops suddenly or visitors say the browser warned them off the site, check Search Console → Security issues (hacked content, malware, harmful downloads, deceptive pages). Also enter the site at Google's Transparency Report site status (transparencyreport.google.com/safe-browsing/search), which works without Search Console access. Updates can take a few days to reach Search Console. Fix every affected page, then select Request Review in the Security issues report. These are owner checks: report them as notes.

### LAUNCH-08 · Traffic drops are checked against Google updates first · medium
- Before diagnosing a drop as technical, compare its dates with the Google Search Status Dashboard (status.search.google.com). With outside checks on, `scripts/google-updates.mjs` reads it live for the period (`googleUpdates`, one line in the report). With them off, send the owner to the dashboard to check the dates themselves. Don't list update dates from memory: they go out of date.
- Wait at least a week after an update finishes, compare by search type, and expect recovery to take months, through better content rather than technical tweaks.
- **Search Console reports worth using:** Insights, query groups, the branded-queries filter, annotations, and Generative AI performance.
- **EU click rates around March 2024:** from March 2024, Google changed its results in Europe for the Digital Markets Act: new units pointing to comparison sites, and some features removed, such as the Google Flights unit (blog.google, "Complying with the Digital Markets Act", 5 March 2024). Google expected more traffic to go to large aggregators and less to direct suppliers. Don't compare EU click-through rates from before March 2024 with later ones.

### LAUNCH-06 · The 404 page helps · low
- A real 404 status, noindex, a short message, and links to the main hubs and popular pages.

### LAUNCH-07 · Roll out large sets of programmatic pages in batches · medium
- Publish the highest-value pages first and the rest over weeks, using release flags (CRAWL-11). Watch indexing after each batch before releasing the next.
