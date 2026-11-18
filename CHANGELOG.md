# Changelog

## 2.0.0 (2026-11-18)

Deeper checks, optional real-world data and search intent. Everything still works with no keys, and nothing leaves the machine by default.

- **Since last audit.** `seo-diff.mjs` compares two crawls by path (so a local crawl compares with a public one), and the report gets a "Since last audit" tab: regressions first (noindex added, H1 or schema removed, canonical moved away, page now an error, title emptied), then improvements, other changes, and pages added or gone. The skill keeps earlier crawls in `seo-audit/history/`, and review mode compares against them.
- **New crawler checks:** hreflang (return links, self entry, x-default, valid codes, working targets), doctype, charset and viewport (REND-09), meta refresh, og:url against the canonical, robots meta against the X-Robots-Tag header, `max-image-preview:large`, image weight and legacy formats (PERF-08), merchant-listing schema for shops (Offer, shipping, returns, and the price shown on the page), Content-Signal values, Markdown negotiation without `Vary: Accept`, and the llms.txt format.
- **Live HTTPS checks** with `--check-live` (TRUST-07, URL-03): certificate trust, the hosts it covers, time left scaled to its lifetime, the http→https redirect and HSTS. A certificate blocker fails the launch gate.
- **Outside checks, off until the owner says yes** (`--outside`): real-user Core Web Vitals from PageSpeed Insights for up to 10 pages (PERF-01), and a headless Chrome or Edge render of up to 10 pages compared with the raw HTML (REND-06). The answer is kept in `seo-audit/settings.json`. When it's off, these are listed under Limits.
- **Search Console import.** `gsc-import.mjs` reads the Performance export, including a BOM, quoted commas and percent CTRs. Findings and plan rows show their clicks, and fixes are ordered by traffic within each severity. Three new findings: a low click rate for the position (INTENT-03), almost on page one (INTENT-04), and pages competing for one query (INTENT-02, from per-page exports only).
- **Search intent and strategy.** New `rules/search-intent.md` (INTENT-01 to 05) and `strategy.md` (reading search results, topic clusters, the brief format). Intent findings name the search engine and date and are medium at most. Content gaps are the owner's decision, never new pages on their own.
- **New `/seo-brief` command.** It writes one content brief to `seo-audit/briefs/` and edits nothing. Setup's drafts now start with the same brief.
- **Content scan:** invisible characters, templated descriptions and unsourced statistics.
- **Score fix.** A missing title (or one title shared by most pages), H1 or canonical on at least 80% of indexable pages is now one site-wide blocker, so a site with no SEO scores below 60 instead of in the 80s.
- **Fetched content is data.** Text on a crawled page that addresses the agent is reported as a finding, never followed.

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
