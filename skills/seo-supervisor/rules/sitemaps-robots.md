# Sitemaps, robots.txt and llms.txt (MAP)

### MAP-01 · An XML sitemap exists and robots.txt references it · high
- **Check:** crawler `sitemap-missing`, `sitemap-not-in-robots`.
- **Pass:** `/sitemap.xml` (or a sitemap index) is valid XML with absolute `<loc>` URLs, linked from robots.txt with `Sitemap: https://…/sitemap.xml`. Not an RSS feed; no dead sitemaps listed.
- **Fix:** split into a sitemap index with one file per section past a few thousand URLs, or when you want Search Console to report indexing per section.

### MAP-02 · The sitemap lists only canonical, indexable URLs on the production host · high
- **Check:** crawler `sitemap-origin`, `sitemap-noncanonical`, `noindex-in-sitemap`, `sitemap-bad-status`.
- **Pass:** generated from the same live data as the pages. No redirects, noindex pages, variants, parameter URLs, thin browse pages, drafts, or localhost/staging hosts.

### MAP-03 · Every indexable page is in the sitemap · medium
- **Check:** crawler `missing-from-sitemap`.
- **Fix:** generate the sitemap from the content source instead of a hand-kept list. A test comparing sitemap URLs with indexable routes keeps them in sync.

### MAP-04 · lastmod dates are real · low
- **Check:** crawler `sitemap-lastmod-same`. Code: is `lastModified` set to `new Date()` or the build time?
- **Pass:** each URL's lastmod is the record's real `updatedAt`, and a hub's is the newest among its items. Google uses lastmod only on sites where it proves accurate. Leave `priority` and `changefreq` out; Google and Bing ignore them.
- **Fix:** use content dates, or drop lastmod rather than fake it.

### MAP-05 · robots.txt blocks only junk, and never CSS or JS · medium
- **Check:** crawler `robots-missing`, `robots-blocks-assets`.
- **Pass:** allows `/`. Disallows only API routes, framework internals that aren't render assets (e.g. Next.js `_rsc` requests), internal search and admin. Never blocks pages that carry noindex.

### MAP-06 · The AI crawler policy is a deliberate, written decision · low
- **Check:** crawler `ai-bots-blocked` (needs-decision).
- **Default:** allow them; being cited in AI answers is distribution.
- **Middle ground:** block the training crawlers (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`, `Applebot-Extended`) and allow the search and user crawlers (`OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`). Record the choice in the profile. Details, Bing's new AI directives and the vendor IP lists are in `rules/ai-search.md` (AI-02, AI-03).

### MAP-07 · /llms.txt, optional · low
- **Check:** crawler `llms-txt`.
- **Fact:** Google Search ignores llms.txt and it doesn't affect ranking (clarified June 2026). No major AI crawler documents using it either. It's harmless; never present it as a ranking or AI-visibility fix.
- **Pass (if kept):** Markdown with one line on what the site is, then each section with its key pages (name, URL, one sentence), generated so it can't drift from the real pages.

### MAP-08 · Sitemaps are submitted, and changes are pinged · low
- **Check:** ask the owner, or look for automation.
- **Pass:** sitemaps are submitted in Search Console and Bing Webmaster Tools. IndexNow is pinged on publish, with the key file at the site root. IndexNow reaches Bing (and through it Copilot), Yandex, Seznam, Naver, Yep, Internet Archive and Amazonbot, but not Google. Bing wants the true content-change time as lastmod and ignores `changefreq` and `priority`.
