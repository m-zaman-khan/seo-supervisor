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
- **Lighthouse, optional.** The installer offers Lighthouse 13 as an add-on (about 170 MB in `~/.seo-supervisor/tools`, never in the project; `--with-lighthouse`, `--no-lighthouse`; a failed install never stops the skill install). With outside checks on, `--lighthouse` runs it on up to 5 sample pages with the installed Chrome or Edge: category scores, lab metrics and the costliest failed audits go into the crawl, plus one Overview line. Information only, no findings.
- **Submit your sitemap to Search Console (optional).** `google.mjs submit-sitemap` is a dry run until the owner says yes; only then does a second short Google screen ask for the one write permission (incremental authorization). It needs Owner or Full permission on the property.
- **The report shows every source per page:** Search Console clicks and impressions, Bing clicks and impressions, and Google Analytics organic visits on findings and plan rows (in the Markdown too), Bing and Analytics totals on the Overview, and Bing's most-linked pages with sample links.
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
