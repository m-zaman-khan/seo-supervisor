# Sitemaps, robots.txt and llms.txt (MAP)

### MAP-01 · An XML sitemap exists and robots.txt references it · high
- **Check:** crawler `sitemap-missing`, `sitemap-not-in-robots`, `sitemap-invalid` (high: not well-formed XML, with the line and column where it breaks, such as a bare `&`, an unclosed tag, an entity like `&nbsp;`, text before `<?xml`, or an HTML page at a listed sitemap URL), `sitemap-too-big` (medium: over 50,000 URLs or 50 MB uncompressed in one file). Gzipped sitemaps (`.xml.gz`, or a gzip body whatever the content type) and text sitemaps (one URL per line) are read too; each file is read no further than 50 MB uncompressed. An HTML page at the guessed `/sitemap.xml` counts as no sitemap.
- **News sitemaps** (`<news:news>` entries), only when one exists: `news-sitemap-tags` (medium: an entry without `<news:publication>` holding `<news:name>` and `<news:language>`, `<news:publication_date>` as a full W3C date, or `<news:title>`), `news-sitemap-too-many` (medium: over 1,000 articles in one file), `news-sitemap-old` (low: articles first published over two days ago, with a day of slack).
- **Pass:** `/sitemap.xml` (or a sitemap index) is valid XML with absolute `<loc>` URLs, linked from robots.txt with `Sitemap: https://…/sitemap.xml`. Not an RSS feed; no dead sitemaps listed.
- **Fix:** split into a sitemap index with one file per section past a few thousand URLs, or when you want Search Console to report indexing per section. Over 50,000 URLs or 50 MB, splitting is required.

### MAP-02 · The sitemap lists only canonical, indexable URLs on the production host · high
- **Check:** crawler `sitemap-origin`, `sitemap-noncanonical`, `noindex-in-sitemap`, `sitemap-bad-status`.
- **Pass:** generated from the same live data as the pages. No redirects, noindex pages, variants, parameter URLs, thin browse pages, drafts, or localhost/staging hosts.

### MAP-03 · Every indexable page is in the sitemap · medium
- **Check:** crawler `missing-from-sitemap`.
- **Fix:** generate the sitemap from the content source instead of a hand-kept list. A test comparing sitemap URLs with indexable routes keeps them in sync.

### MAP-04 · lastmod dates are real · low
- **Check:** crawler `sitemap-lastmod-same`, `sitemap-lastmod-future` (a date after tomorrow), `sitemap-lastmod-invalid` (not a W3C date, or not a real calendar date such as 2026-02-30), each low and counted once per sitemap. `<priority>` and `<changefreq>` get a note only: Google ignores them. Code: is `lastModified` set to `new Date()` or the build time?
- **Pass:** each URL's lastmod is the record's real `updatedAt`, and a hub's is the newest among its items. Google uses lastmod only on sites where it proves accurate. Leave `priority` and `changefreq` out; Google and Bing ignore them.
- **Fix:** use content dates, or drop lastmod rather than fake it.

### MAP-05 · robots.txt blocks only junk, and never CSS or JS · medium
- **Check:** crawler `robots-missing` (a 4xx other than 429: Google reads it as no rules), `robots-blocks-assets`. A robots.txt answering 5xx, 429 or nothing is `robots-server-error` under CRAWL-01 (high), and MAP-05 and MAP-06 are then listed as not checked.
- **Pass:** allows `/`. Disallows only API routes, framework internals that aren't render assets (e.g. Next.js `_rsc` requests), internal search and admin. Never blocks pages that carry noindex.

### MAP-06 · The AI crawler policy is a deliberate, written decision · low
- **Check:** crawler `ai-bots-blocked` (needs-decision).
- **Default:** allow them; being cited in AI answers is distribution.
- **Middle ground:** block the training crawlers (`GPTBot`, `ClaudeBot`, `Google-Extended`, `CCBot`, `Applebot-Extended`) and allow the search and user crawlers (`OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`). Record the choice in the profile. Details, Bing's new AI directives and the vendor IP lists are in `rules/ai-search.md` (AI-02, AI-03).
- **Content-Signal:** a `Content-Signal:` line in robots.txt (e.g. `search=yes, ai-train=no`) is an emerging way to state the policy. The crawler flags only invalid values (keys other than `search`, `ai-input`, `ai-train` with `yes`/`no`, or Cloudflare's optional `use` with `immediate`, `reference` or `full`), at low severity. Leaving it out is fine.
- **Logs:** `log-scan.mjs` flags AI search bots mostly refused with 403/401 by a firewall or CDN (`ai-bots-blocked-in-practice`, needs-decision), which robots.txt doesn't show.

### MAP-07 · /llms.txt, optional · low
- **Check:** a missing llms.txt is a note in the crawl, not a finding, and MAP-07 isn't scored for it. A file that exists has its format checked (below).
- **Fact:** Google Search ignores llms.txt and it doesn't affect ranking (clarified June 2026). No major AI crawler documents using it either. It's harmless; never present it as a ranking or AI-visibility fix.
- **Pass (if kept):** Markdown with one line on what the site is, then each section with its key pages (name, URL, one sentence), generated so it can't drift from the real pages.
- **Structure:** when llms.txt exists, the crawler checks it starts with a `# Site name` heading and contains Markdown links (`llms-structure`, low).

### MAP-08 · Sitemaps are submitted, and changes are pinged · low
- **Check:** ask the owner, or look for automation. `scripts/indexnow.mjs` sets up the key file (`key --public-dir public/`) and sends the ping (`submit … --from-diff seo-audit/seo-diff.json`, or `--urls`, `--from-sitemap`). It's a dry run until `--yes` (writing `seo-audit/indexnow-dryrun.json`), checks the key file is live on that exact host first, and writes `seo-audit/indexnow.json`. The key file belongs in the committed folder served at the site root (e.g. `public/`), not the build output.
- **Pass:** sitemaps are submitted in Search Console and Bing Webmaster Tools. IndexNow is pinged on publish, with the key file at the site root. IndexNow reaches Bing (and through it Copilot), Yandex, Seznam, Naver, Yep, Internet Archive and Amazonbot, but not Google. Bing wants the true content-change time as lastmod and ignores `changefreq` and `priority`.
