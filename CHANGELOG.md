# Changelog

## 2.0.0 (2026-11-18)

Deeper checks, optional real-world data and search intent. Everything still works with no keys, and nothing leaves the machine by default.

- **Since last audit.** `seo-diff.mjs` compares two crawls by path (so a local crawl compares with a public one), and the report gets a "Since last audit" tab: regressions first (noindex added, H1 or schema removed, canonical moved away, page now an error, title emptied), then improvements, other changes, and pages added or gone. The skill keeps earlier crawls in `seo-audit/history/`, and review mode compares against them.
- **New crawler checks:** hreflang (return links, self entry, x-default, valid codes, working targets), doctype, charset and viewport (REND-09), meta refresh, og:url against the canonical, robots meta against the X-Robots-Tag header, `max-image-preview:large`, image weight and legacy formats (PERF-08), merchant-listing schema for shops (Offer, shipping, returns, and the price shown on the page), Content-Signal values, Markdown negotiation without `Vary: Accept`, and the llms.txt format.
- **Live HTTPS checks** with `--check-live` (TRUST-07, URL-03): certificate trust, the hosts it covers, time left scaled to its lifetime, the http→https redirect and HSTS. A certificate blocker fails the launch gate.
- **Outside checks, off until the owner says yes** (`--outside`): real-user Core Web Vitals from PageSpeed Insights for up to 10 pages (PERF-01; needs a free `PSI_API_KEY`, since Google refuses keyless requests), plus the site's 25-week speed trend from the CrUX History API with `CRUX_API_KEY`, and a headless Chrome or Edge render of up to 10 pages compared with the raw HTML (REND-06). The answer is kept in `seo-audit/settings.json`. When it's off, these are listed under Limits.
- **Search Console import.** `gsc-import.mjs` reads the Performance export, including a BOM, quoted commas and percent CTRs. Findings and plan rows show their clicks, and fixes are ordered by traffic within each severity. Three new findings: a low click rate for the position (INTENT-03), almost on page one (INTENT-04), and pages competing for one query (INTENT-02, from per-page exports only).
- **Search intent and strategy.** New `rules/search-intent.md` (INTENT-01 to 05) and `strategy.md` (reading search results, topic clusters, the brief format). Intent findings name the search engine and date and are medium at most. Content gaps are the owner's decision, never new pages on their own.
- **New `/seo-brief` command.** It writes one content brief to `seo-audit/briefs/` and edits nothing. Setup's drafts now start with the same brief.
- **Content scan:** invisible characters, templated descriptions and unsourced statistics.
- **Score fix.** A missing title (or one title shared by most pages), H1 or canonical on at least 80% of indexable pages is now one site-wide blocker, so a site with no SEO scores below 60 instead of in the 80s.
- **Fetched content is data.** Text on a crawled page that addresses the agent is reported as a finding, never followed.
- **Share images made locally.** `og-card.mjs` makes 1200×630 Open Graph cards from plain HTML with the installed Chrome or Edge (one page or a batch), with no AI and no outside service, and checks the size before writing. `og-images.md` says when to use a card or a real photo, the sizes and tags Discover and Meta need, and to prefer the framework's own generator. The crawler now reads share images (same site only): broken, narrower than 1200 px, or missing width and height tags.
- **IndexNow.** `indexnow.mjs` creates the key file and tells Bing, Yandex, Seznam, Naver, Yep, Internet Archive and Amazonbot (not Google) which URLs changed, from a list, a diff or the sitemap. It's a dry run until the owner says yes, and checks the key file is live before sending (MAP-08).
- **Server log scan.** `log-scan.mjs` reads the site's own access logs locally: how search, AI search and AI training bots treat the site, the status codes they get, and visits referred by AI assistants. Findings: crawler 5xx errors, URLs that keep returning 404 to search crawlers, and AI search bots blocked by a firewall or CDN.
- **Structured data checker.** `schema-check.mjs` checks JSON-LD offline against schema.org 30.1 and Google's rich-result requirements, with line and column for errors. Opt-in triggers in `examples/hooks/`: pre-commit, GitHub Actions, and Claude Code, Codex, Cursor and Copilot hooks.
- **More checks:** sitemap lastmod dates in the future or not in W3C format, and priority/changefreq tags Google ignores (MAP-04). "Since last audit" also compares descriptions, Open Graph tags and big word-count changes.
- **Phone and desktop checks.** Outside checks now load the sample pages at desktop and phone size in headless Chrome or Edge, driven over the DevTools pipe with no dependencies. They save screenshots to `seo-audit/screenshots/`, flag content missing on phones (REND-07), sideways scrolling and tiny text (REND-09) and full-screen popups (PERF-07), and add an indicative lab-speed line for sites that aren't live yet.
- **Node 22 or newer** is now required (Node 20 reached end of life on 30 April 2026). CI runs on Node 22, 24 and 26.
- **Connect Google Search Console and Analytics (optional, read-only).** `google.mjs` signs in with Google in the browser, or uses the owner's own Desktop client or a service-account key (`guide` has the steps). `fetch` pulls pages, queries and page-by-query data in the same shape as the CSV import, inspects up to 20 key pages (not indexed: CRAWL-02; Google chose a different canonical: URL-04), reads submitted sitemaps (errors: MAP-01) and adds GA4 organic sessions by landing page. The login stays in `~/.seo-supervisor/google.json`, readable only by the owner; `status` shows it and `disconnect` withdraws it at Google.
- **Key-only connections (optional).** `connect-keys.mjs` connects Bing Webmaster Tools (Bing clicks and impressions, linked pages, Bing's crawl problems), Open PageRank and Ahrefs' free Domain Rating (authority for the site and named competitors, shown on the Overview with Ahrefs' credit) with a pasted API key. Fetching is a dry run until `--yes`.
- **Update notices.** At most once a week the agent checks npm for a newer SEO Supervisor (only the package name is sent) and mentions it once, with the update command. It never updates by itself. Off with `update-check.mjs off`, `SEO_SUPERVISOR_NO_UPDATE_CHECK=1`, and in CI. The report footer now names the version that made it.
- **Lighthouse, optional.** The installer offers Lighthouse 13 as an add-on (about 170 MB in `~/.seo-supervisor/tools`, never in the project; `--with-lighthouse`, `--no-lighthouse`; a failed install never stops the skill install). With outside checks on, `--lighthouse` runs it on up to 5 sample pages with the installed Chrome or Edge: category scores, lab metrics and the costliest failed audits go into the crawl, plus one Overview line. Information only, no findings.
- **Submit your sitemap to Search Console (optional).** `google.mjs submit-sitemap` is a dry run until the owner says yes; only then does a second short Google screen ask for the one write permission (incremental authorization). It needs Owner or Full permission on the property.
- **The report shows every source per page:** Search Console clicks and impressions, Bing clicks and impressions, and Google Analytics organic visits on findings and plan rows (in the Markdown too), Bing and Analytics totals on the Overview, and Bing's most-linked pages with sample links.
- **LCP breakdown.** The Overview names the biggest of LCP's four parts (server response, the wait before the main image starts loading, its download, drawing it) with the fix for that part. It uses real visitors with `CRUX_API_KEY`, else the home page's lab run (PageSpeed or Lighthouse). Fixed: a CrUX week with no data no longer reads as "LCP 0.0 s" in the trend.
- **Since last audit, more comparisons:** pages that got slower or faster (real visitors, lab load and Lighthouse compared separately, each with its own threshold so noise isn't reported) and schema types that lost or gained fields (e.g. "Product lost offers").
- **New crawler checks:** next-page preloading (PERF-09); back/forward cache hints, plus Chrome's own back/forward test with outside checks (PERF-10); pages over 1,400 elements; links with no text; http:// internal links on HTTPS sites; titles that don't match their page (META-09); charset header and meta disagreeing; obsolete tags (REND-10).
- **Lighthouse on every page.** `--lighthouse all` runs it on every indexable page, up to 200, and prints the time estimate first. The report line adds the lowest-scoring pages.
- **Google ranking updates.** `google-updates.mjs` reads Google's public Search Status Dashboard and lists the ranking updates in the period, on the Overview and Since last audit, so an owner can tell a drop that came with a Google update from one the site caused. It sends nothing about the site, needs outside checks, and never claims an update caused anything.
- **Matomo and PostHog (optional).** `connect-keys.mjs` adds visits from search engines by landing page from either, in each page's traffic line and as Overview totals. Offered only when the site uses one; the token or key is typed at a hidden prompt and never goes in a URL (Matomo's in the request body, PostHog's in a header), and redirects aren't followed.
- **Known backlinks.** `backlinks.mjs` revisits the pages that link to the site (from Bing, a Search Console links export or a list) and reports which still link, which are gone (LAUNCH-05) and which couldn't be checked. Dry run until the owner says yes.
- **New guidance:** how to build fair "X vs Y" and "alternatives to X" pages (SVC-08), and no links to retired Google Business Profile features: chat, `business.site` websites and Q&A (LOCAL-10).
- **More from Search Console.** `google.mjs fetch` adds:
  - image, video, news and Discover results
  - clicks by device and country
  - the change from the period before, with the pages that dropped most
  - rich-result errors from URL Inspection (SCHEMA-08)
  - `--inspect`/`--inspect-urls` to choose the pages to inspect
  - a note when the period overlaps a data anomaly on Google's own page
- **Sitemaps.**
  - Gzipped sitemaps and indexes are read (up to 50 MB uncompressed), and so are text sitemaps.
  - New checks: sitemaps that aren't valid XML (`sitemap-invalid`, with line and column), files over 50,000 URLs or 50 MB (`sitemap-too-big`), and News sitemap rules.
  - A robots.txt answering 5xx, 429 or nothing is `robots-server-error` (CRAWL-01, high), not "missing".
- **Live checks.**
  - The other host (www or bare domain) must redirect to the preferred one in one permanent hop with the path kept (URL-03).
  - A failed HTTPS connection is a finding (TRUST-07).
  - Temporary redirects are flagged where a permanent one belongs.
  - Chrome's own error pages no longer raise false render findings.
- **Crawler fixes:**
  - robots `none` counts as noindex and nofollow.
  - X-Robots-Tag rules for other bots no longer count for Google.
  - `Vary: Accept` is matched exactly.
  - Chinese, Japanese and Thai pages are counted in words.
  - A missing llms.txt is a note, not a finding.
  - `lang` and `<base href>` are read on every page.
  - Every offer of a product is checked for shipping and returns.
  - Cloudflare's `use=` Content-Signal key is accepted.
  - Book Actions is no longer listed as retired.
- **New crawler checks:**
  - noindex with a canonical to another page (CRAWL-02)
  - page-level nofollow (META-06)
  - Microdata and RDFa recognised, with JSON-LD suggested (SCHEMA-01)
  - favicon for search results (META-10)
  - render-blocking scripts in the head (PERF-03)
  - a local business's phone and address shown on the page (LOCAL-05)
  - what Googlebot gets compared with what a visitor gets (CRAWL-09). A firewall that blocks requests only claiming to be Googlebot is a decision for the owner, not a finding, since that is the right setup when it verifies Google by IP.
  - product images under Google's 50,000-pixel minimum (SHOP-05)
- **Local, shop and links guidance:**
  - Business Profile category and completeness (LOCAL-11, LOCAL-12)
  - Bing Places and Apple Business (LOCAL-13)
  - trade directories (LOCAL-14)
  - steady reviews (LOCAL-09)
  - Merchant Center free listings (SHOP-08)
  - earning links honestly (LINK-10)
  - what to check when security warnings appear (LAUNCH-05)
- **No word-count targets:** thin-page is a page to look at, not a word goal, and posts and city intros carry no word counts. LAUNCH-08 no longer lists update dates from memory.
- **Fixed:** a page reached through a redirect (a link or canonical to an old address) was counted twice, which doubled its findings and could make it look like a duplicate of itself.
- **Score views.**
  - The crawler measures 11 trust signals (`trustSignals`): about page, contact, organisation schema, author bylines and pages, dates, sources, customer proof, policies, HTTPS and own images.
  - The Overview shows them as "Trust signals (E-E-A-T) 73/100 · 8 of 11 found", with what to add. It's labelled as SEO Supervisor's own check, not a Google score, and missing signals never change the health score.
  - "Local SEO" and "Content quality" show the existing area scores under clearer names.
- **Free backlink data.** `links-import.mjs` reads Search Console's Top linking sites, Top linking text and Top linked pages exports, plus Bing's linked pages, into `links`, `linkSummary`, `anchorMix` and `linksChange`.
  - The Overview shows a link summary and the link-text mix.
  - "Since last audit" shows "Links dropped" (30% and at least 10).
  - LINK-10 explains why there are no toxic-link scores.
  - Local files only, and information only.
- **Agent readiness and writing.**
  - `controls-no-name` (AI-05, low): form fields and buttons with no accessible name.
  - An information-only AI agents note lists WebMCP tools, a UCP profile (`/.well-known/ucp`), an RFC 9727 API catalog and an A2A agent card, read only from the crawled site.
  - New CONTENT-13 "Plain language", with writing notes on English pages: sentences over 35 words, paragraphs over 150, about 20 stock phrases and Flesch reading ease. Code and tables are left out, and the notes never change the score.
- **Schema by business type (SCHEMA-02).** `scripts/data/business-types.json` maps 48 business types, checked against schema.org 30.1, to their schema.org type.
  - The crawl records `businessType`.
  - `schema-too-generic` (medium) and `business-type-unclear` (needs-decision) are new.
  - `examples/snippets.md` gains a business-types section.
- **Small technical checks (all low):**
  - sitemap duplicates, nested sitemap indexes, video and image sitemap tags, session IDs and over-long sitemap URLs
  - unencoded links
  - wide images without `srcset`, and late images without lazy loading
  - repeated head tags and number-only headings
  - cookie flags, short HSTS and `Referrer-Policy: unsafe-url`
  - old TLS 1.0/1.1 (with `--check-live`)
  - small tap targets on phones (WCAG 2.2 SC 2.5.8, with outside checks)
  - broken links to other sites, behind their own opt-in `--outbound-links` (`outboundLinks`)
- **Rich results and speed.**
  - Google's rich-result rules are kept as data (`scripts/data/google-rich-results.json`, 62 rules, checked against the search gallery). Retired types are flagged (SCHEMA-05). There's a snippet for every type.
  - Fixed: a recommended property no longer hides a missing required one.
  - Desktop speed is behind its own opt-in `--desktop`, with good / needs improvement / poor bands.
  - INP and CLS now count in "Since last audit".
  - `desc-starts-with-title` (META-02) is new.
  - `page-types.md` gives a checklist per page type.
- **Search Console position summary** (`positions`) on the Overview.
- **Consent per check.** `settings.json` records which outside checks the owner approved (`outsideChecks.approved`). `--desktop` and `--outbound-links` each need their own yes.
- **Proxy and containers.**
  - `NODE_USE_ENV_PROXY` is supported, with a reminder when a proxy is set without it.
  - Chrome gets `--proxy-server`.
  - As root or inside Docker, Podman or Kubernetes, Chrome runs with `--no-sandbox --disable-dev-shm-usage`, and the report says so.
- **Effort on each fix.** Findings can carry `effort` (`quick`, `hours`, `half-day`), shown on each card.
- **Language checks (META-08).** hreflang is read from the HTML, the HTTP `Link` header and the sitemap's `<xhtml:link>`, and checked as one set. New findings:
  - sources that disagree
  - a language version a page leaves out
  - `<html lang>` or schema `inLanguage` that doesn't match hreflang
  - language versions with the same title or main text
  - `lang` values such as `auto`
  - the Google Translate widget as a site's only translation
- **Images by possible saving.** The crawl lists the images it weighed with a rough saving (`images`), and the report shows the top 15, information only. `images.mjs` converts heavy JPEG and PNG files to WebP (and AVIF) with the optional sharp add-on (`--with-image-tools`, about 20 MB, outside the project). It's a dry run until `--yes`, keeps the originals and prints the markup to change.
- **More "Since last audit".** The crawl records `robotsTxt` and `redirects`. Seven new kinds: `robots-changed`, `left-sitemap`, `joined-sitemap`, `lost-internal-links`, `redirect-changed`, `redirect-added`, `redirect-removed`. "Since last audit" lines are escaped in Markdown.
- **Linked pages that broke.** `links-import.mjs --crawl` flags pages other sites link to that now return 404 or 410, loop, or redirect to the home page (`linked-page-broken`, URL-07).
- **Render every page.** `--render all` (with `--outside`, its own opt-in) renders every indexable page, up to 200, after printing the time estimate.
- **Phone fields and text.** `input-zoom` (REND-09, low) flags form fields that iPhones zoom into, following WebKit's own rule. Phone main text under 16 px is noted, information only.
- **Lighthouse details.** Every failed audit with up to 10 files each (`lighthouse[].detail`), in a collapsed panel. Information only.
- **Matomo and PostHog by device and country.** Search visits by device type and for the top 10 countries, one quiet Overview line each.
- **Bing URL submission (optional).** `connect-keys.mjs submit-bing` is a dry run until the owner says yes. It sends only the site's own URLs, and reads Bing's quota first (500 a request).
- Setup and fix offer each connection once; a skip is listed under Limits and never changes the score. Keys are typed at a hidden prompt in the owner's own terminal, never in chat; Google sign-in prints its link for agents (`--print-url`, `~/.seo-supervisor/pending-signin.txt`). Search Console findings flag only pages Google really excluded; pages Google doesn't know yet are notes.
- **Fewer false findings:** the log scan needs 5 server errors and 1% before a finding, and repeated 404s become findings only for pages the site links to; sitemap priority/changefreq tags are a note; IndexNow refuses a key file that redirects to another host.
- **Off-site presence for AI answers:** with outside checks on, the agent looks the brand up on Wikipedia, Reddit, YouTube, LinkedIn and directories, and reports gaps as owner decisions.
- The schema checker's vocabulary comes from Schema.org (CC BY-SA 3.0); see `NOTICE`.

## 1.2.0 (2026-11-18)

- **`/seo-setup` now takes a site from zero to fully set up in one go.** After building the SEO foundation, it also fixes the audit's other code findings (forms, results output, rendering, speed, headers). Fix mode's usual rules apply: fixed at the root, re-checked, and anything that needs the owner is left as Needs you.
- **The fixes are shown before you approve.** The plan lists them in a new `plan.alsoFixes` field, and the Plan tab shows them as links to the findings, so approving the plan approves those fixes too.

## 1.1.0 (2026-11-18)

- **New `/seo-setup` command** for sites with no SEO yet. It works out what the site is from its own pages, proposes a full SEO plan, stops for approval, builds the technical foundation, drafts copy for the owner to approve, and proves the result with an audit. Re-running it continues from where it stopped. The rules are in `skills/seo-supervisor/planning.md`.
- **A Plan tab in the report** whenever the audit JSON has a `plan`:
  - progress, counts by status, a "Needs your yes" list, the site structure as a tree, and a filterable page table with templates for large page sets
  - the report opens on it while a plan waits for approval
  - the plan also appears in the Markdown twin

  Reports without a plan look exactly as before.
- **The crawler** now records each page's meta description and H1 text, so planned pages can be verified after they're built.
- **Audits** suggest `/seo-setup` when a site has almost no SEO in place.
- **The installer asks where and for which agents.** `npx seo-supervisor` asks whether to install for you or for this project, then shows a checklist of 20 coding agents (Claude Code, Codex, Cursor, Windsurf, Gemini CLI, GitHub Copilot, OpenCode, Grok and more). The ones on your machine are found and ticked. Each agent gets the skill in its own folder, and Claude Code also gets the commands. `--agent`, `--scope` and `--yes` skip the questions. The old `--agents` flag now adds the shared `.agents` folder in whichever scope you chose.

## 1.0.0 (2026-11-18)

First public release.

- **Modes:** `/seo-audit` (read-only audit and report), `/seo-fix` (fixes with re-checks), `/seo-review` (SEO regressions in a diff or PR) and `/seo-launch` (pass/fail gate plus launch-day steps).
- **Rules:** 149 rules across crawling and indexing, URLs and canonicals, rendering, metadata, content, structured data, sitemaps and robots, internal linking, performance, trust and security, AI search, media and launch monitoring. There are extra rules for tools, local business, content, services and e-commerce sites, and guides for Next.js, Rails and SPAs. Facts were checked on 16–17 Nov 2026.
- **Crawler:** zero-dependency, run against a local production build. It covers status codes, canonicals, noindex, titles, headings, JSON-LD, sitemaps, robots.txt, orphans, soft 404s, near-duplicates, redirect chains, security headers and banned or unconfirmed claims.
- **Content scanner:** finds templated copy, reused FAQs, missing fields and unpublished items in JSON, CSV or Markdown content before it becomes pages.
- **Report:** one offline HTML file, dark by default with a light theme switch. It shows a 0–100 health score with area scores, "what's moving your score", the score fixing the blockers unlocks, and "Needs you" labels on owner-only items. It has tabs for findings, decisions, changes, passed rules and limits, and comes with a full Markdown twin.
- **Safety:** an audit never edits anything. Fix mode never edits CMS content, never hides, removes or noindexes pages, and never changes production indexing without the owner's go-ahead.
- **Install:** as a Claude Code plugin, through `npx seo-supervisor`, or by copying the folder.
