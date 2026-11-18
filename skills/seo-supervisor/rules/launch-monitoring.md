# Launch and monitoring (LAUNCH)

### LAUNCH-01 · Crawl staging before launch · high
- Run the crawler against staging (with auth, or a production build on localhost). Zero blockers and zero high findings in CRAWL, URL, REND and MAP before go-live.
- Check the redirect map for the old site: every old URL that has traffic or backlinks 301s to its closest new page in one hop, and nothing that used to get traffic returns 404 (old blog posts, printed short links like `/go/review`).

### LAUNCH-02 · Launch day · high
1. Switch the indexing variable on and run the production noindex check (CRAWL-03).
2. Confirm `http` → `https` and the host redirects (URL-03).
3. Submit the sitemap in Search Console and Bing, and ping IndexNow.
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

### LAUNCH-05 · Watch Search Console every week · medium
- **Pages report:** "Crawled, currently not indexed" on templated pages usually means thin or duplicate content (CONTENT-04/05).
- 404s that have backlinks get redirects.
- Core Web Vitals and enhancement reports.
- Manual actions and security issues.

### LAUNCH-08 · Traffic drops are checked against Google updates first · medium
- Before diagnosing a drop as technical, compare its dates with the Google Search Status Dashboard (status.search.google.com). Recent windows:
  - **Core updates:** Mar, Jun and Dec 2025; Mar, May and Nov 2026.
  - **Spam updates:** Aug 2025; Mar, Jun, Aug and Sep 2026.
- Wait at least a week after an update finishes, compare by search type, and expect recovery to take months, through better content rather than technical tweaks.
- **Search Console reports worth using:** Insights, query groups, the branded-queries filter, annotations, and Generative AI performance.

### LAUNCH-06 · The 404 page helps · low
- A real 404 status, noindex, a short message, and links to the main hubs and popular pages.

### LAUNCH-07 · Roll out large sets of programmatic pages in batches · medium
- Publish the highest-value pages first and the rest over weeks, using release flags (CRAWL-11). Watch indexing after each batch before releasing the next.
