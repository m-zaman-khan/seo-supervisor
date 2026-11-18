# Changelog

## 1.1.0 (2026-11-18)

- **New `/seo-setup` command** for sites with no SEO yet. It works out what the site is from its own pages, proposes a full SEO plan, stops for approval, builds the technical foundation, drafts copy for the owner to approve, and proves the result with an audit. Re-running it continues from where it stopped. The rules are in `skills/seo-supervisor/planning.md`.
- **A Plan tab in the report** whenever the audit JSON has a `plan`:
  - progress, counts by status, a "Needs your yes" list, the site structure as a tree, and a filterable page table with templates for large page sets
  - the report opens on it while a plan waits for approval
  - the plan also appears in the Markdown twin

  Reports without a plan look exactly as before.
- **The crawler** now records each page's meta description and H1 text, so planned pages can be verified after they're built.
- **Audits** suggest `/seo-setup` when a site has almost no SEO in place.

## 1.0.0 (2026-11-18)

First public release.

- **Modes:** `/seo-audit` (read-only audit and report), `/seo-fix` (fixes with re-checks), `/seo-review` (SEO regressions in a diff or PR) and `/seo-launch` (pass/fail gate plus launch-day steps).
- **Rules:** 149 rules across crawling and indexing, URLs and canonicals, rendering, metadata, content, structured data, sitemaps and robots, internal linking, performance, trust and security, AI search, media and launch monitoring. There are extra rules for tools, local business, content, services and e-commerce sites, and guides for Next.js, Rails and SPAs. Facts were checked on 16–17 Nov 2026.
- **Crawler:** zero-dependency, run against a local production build. It covers status codes, canonicals, noindex, titles, headings, JSON-LD, sitemaps, robots.txt, orphans, soft 404s, near-duplicates, redirect chains, security headers and banned or unconfirmed claims.
- **Content scanner:** finds templated copy, reused FAQs, missing fields and unpublished items in JSON, CSV or Markdown content before it becomes pages.
- **Report:** one offline HTML file, dark by default with a light theme switch. It shows a 0–100 health score with area scores, "what's moving your score", the score fixing the blockers unlocks, and "Needs you" labels on owner-only items. It has tabs for findings, decisions, changes, passed rules and limits, and comes with a full Markdown twin.
- **Safety:** an audit never edits anything. Fix mode never edits CMS content, never hides, removes or noindexes pages, and never changes production indexing without the owner's go-ahead.
- **Install:** as a Claude Code plugin, through `npx seo-supervisor`, or by copying the folder.
