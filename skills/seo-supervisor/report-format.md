# Report format

The audit is one JSON file, `seo-audit/seo-audit.json`. The same file carries the fix history, so a later fix run updates it instead of starting over. `scripts/render-report.mjs` turns it into two files:
- **`seo-audit/seo-audit.html`:** a self-contained page (offline, light and dark, phone, print). The Overview tab shows the health score, area scores, charts and "Fix first". The Findings, Decisions, Changes, Passed and Limits tabs hold the detail, showing up to 10 evidence rows per finding.
- **`seo-audit/seo-audit.md`:** the full report as Markdown, with every evidence row. Use it for reading in an editor, diffing between runs, and pasting into tickets.

## The score (computed by the renderer, never by hand)

- Every checked rule is worth 10 points: each rule in `passed`, plus each distinct `rule` among `findings`. A finding without a rule counts as its own rule.
- A rule earns 10 if it passes or all its findings are `fixed`. Otherwise it earns by its worst open finding: low 8, medium 6, needs-decision 6, high 3, blocker 0. `wont-fix` counts as open.
- **Score** = points earned ÷ points possible × 100, rounded.
- **Blocker cap:** each open blocker caps the score. One caps it at 59, two at 49, three at 39, and so on, never below 9. The report says when the cap applies, and shows the score the site reaches once the open blockers are fixed: the same model, with those blockers treated as fixed. After a fix run it shows the change: the total's, or the checked-rules score's when the cap holds the total still.
- **Area scores** use the same rules within each `category`.
- **Bands:**

| Score | Band |
| --- | --- |
| 90–100 | Excellent |
| 75–89 | Good |
| 60–74 | Fair |
| 40–59 | Poor |
| 0–39 | Critical |

Consequences for the JSON:
- Give every finding a `rule` and a `category`; they drive the area scores.
- Record passed rules with their `category`.
- Don't list a rule as both passed and failing.
- Rules under `notChecked` don't count either way.

## Build it in this order

1. Start from `seo-audit/seo-crawl.json` and, if you ran it, `seo-audit/content-scan.json`. Copy their `findings`, `passed`, `notChecked` and `notes`. Their findings already carry `what`, `why` and `fix`; rewrite `what` in plainer words when you can say more than the example.
2. Review each finding against the SEO profile. Keep it, change its severity, or drop it and say why in `notes`. **Merge** findings that share a root cause into one: e.g. near-duplicate pages (crawler), templated intros (content scan) and reused FAQs all come from one template, so they become one finding listing every symptom in `what`.
3. Add the findings from the code and content inspection, with `file` and `line` evidence.
4. Add `decisions` for questions only the owner can answer.
5. Add `notChecked` for anything you couldn't verify or that doesn't apply, with the reason (e.g. "Core Web Vitals field data: site not live yet", "SHOP rules: not an e-commerce site").
6. Write `summary`: two or three plain sentences. **The first sentence is the verdict**; the report shows it at the top and you repeat it in chat.

## Shape (illustrative values)

```json
{
  "site": {
    "name": "Example Plumbing Co",
    "url": "https://www.example-plumbing.com",
    "framework": "Next.js 16 (App Router)",
    "siteTypes": ["local-business", "services"],
    "profile": "docs/seo-profile.md"
  },
  "run": { "mode": "audit", "date": "2026-11-17", "pagesCrawled": 120, "auditor": "seo-supervisor" },
  "summary": "The build is solid, but the 80 city pages are templated and would launch together. Fix the two blockers first, then the soft 404.",
  "findings": [
    {
      "id": "F-001",
      "rule": "LOCAL-02",
      "severity": "blocker",
      "category": "Local business",
      "status": "open",
      "title": "80 city pages differ only by the town name",
      "what": "Intros and FAQs are the same template with {city} swapped; the crawler found 1,204 page pairs sharing over 60% of their main text. Related: CONTENT-04.",
      "why": "Google treats pages that only swap a place name as doorway pages and can filter them or hold down the whole site.",
      "evidence": [
        { "url": "https://www.example-plumbing.com/drain-cleaning-springfield/", "detail": "74% shared with /drain-cleaning-shelbyville/" },
        { "file": "src/lib/content.ts", "line": 214, "detail": "intro template only swaps {city}" }
      ],
      "count": 1204,
      "fix": "Publish only cities with real local proof (jobs, photos, reviews from that town), each with its own intro and FAQs, in `src/data/cities.ts`. Hold the rest with the publish flag."
    }
  ],
  "decisions": [
    {
      "question": "Is commercial drain work actually offered?",
      "context": "The content data marks it unconfirmed, but 20 city pages exist for it.",
      "options": ["Yes, keep the pages", "No, remove them and 301 to /services/"],
      "recommendation": "Keep them unpublished until the owner confirms."
    }
  ],
  "passed": [
    { "rule": "URL-04", "title": "Self-referencing, absolute canonical on every indexable page", "category": "URLs & canonicals", "detail": "src/lib/seo.ts:41 builds it from SITE_URL + path" }
  ],
  "notChecked": [{ "area": "Core Web Vitals field data", "reason": "No CrUX data for a site that isn't live yet." }],
  "notes": ["Crawled a production build on localhost:3123 with --ignore-noindex (pre-launch)."]
}
```

## Field rules

| Field | Rule |
| --- | --- |
| `id` | `F-001`, `F-002` and so on. **Never renumber** on later runs; fix history depends on stable IDs. New findings get the next free number. |
| `rule` | The rule ID from `rules/` or `site-types/`. When several rules cover the problem, use the **most specific** one (a site-type rule beats a general rule), name the others in `what` ("Related: CONTENT-04"), and take the **highest** severity among them. |
| `severity` | `blocker`, `high`, `medium`, `low` or `needs-decision`. Definitions are in SKILL.md. |
| `status` | `open`, `needs-decision`, `in-progress`, `fixed` or `wont-fix`. `fixed` requires a re-check. |
| `title` | States the problem, with a count if it applies: "12 titles are longer than 60 characters". Not "Title issues". |
| `what` | What is wrong, in plain words, with numbers. Written for the site owner, not for an SEO expert. |
| `why` | The consequence: lost rankings, missed indexing, a penalty risk, wasted crawl budget. |
| `evidence` | Up to 100 items. Each has a `url`, or a `file` plus `line`, and a short `detail`. Group repeated issues into one finding and set `count` to the full total. Use public URLs (the crawler's local URLs mapped to the production origin) unless production is still a different, old site; then keep the local URLs and say so in `notes`. |
| `fix` | The concrete change and *where* to make it: the shared helper or file, not "every page". |
| `fixBy` | Optional. Set it to `"owner"` when only the owner can resolve the finding: content or facts, CMS edits, business decisions, removing pages. The report labels it **Needs you**, and fix mode leaves it alone without the owner's go-ahead. Leave it out when the agent can fix the finding. |
| `effort` | Optional. Roughly how long the fix takes: `"quick"` (under 30 minutes), `"hours"` (an hour or two) or `"half-day"` (half a day or more). Set it when you write the finding. The report shows it on the finding card ("Effort: an hour or two"); any other value shows nothing. |
| `decision` | Optional, for findings that need an owner's call: `{ "question", "options": [], "recommendation" }`. |
| `fixed` | Fix mode only: `{ "summary": "what changed", "files": ["src/lib/seo.ts"], "verified": "re-crawl 17 Nov: 0 titles over 60" }`. |
| `passed[].detail` | Optional evidence for a pass, e.g. the `file:line` that implements it. |

## Optional data (each one adds to the report only when present)

| Field | From | Shown as |
| --- | --- | --- |
| `diff` | `seo-diff.mjs`, copied as is: `{ since, regressions[], improvements[], changed[], added[], removed[] }`, each change `{ path, kind, before, after }` (speed changes also carry `source`, schema-field changes `detail`), plus `compared[]`, the optional fields both crawls recorded | A "Since last audit" tab, counting regressions. Absent on a first audit. Besides status, noindex, canonical, H1, title, description, social tags and page length, it shows pages that got slower or faster (`speed-slower`/`speed-faster`) and schema types that lost or gained fields (`schema-fields-removed`/`-added`, e.g. "Product lost aggregateRating, offers"). Speed counts only a real change, and never compares one source with another: real visitors, LCP moved 20% and 300 ms or a Core Web Vital crossed its limit; lab load, LCP moved 40% and 1 s; Lighthouse, the performance score moved 15 points. |
| `traffic`, `trafficPeriod` | `traffic` and `period` from `gsc-import.mjs` or `google.mjs fetch` (same shape: by path, `clicks`, `impressions`, `ctr`, `position`) | One traffic line on findings (HTML and Markdown) and in plan rows' "Search traffic" about that page, with the Bing and Google Analytics numbers when present: "Search Console: 120 clicks · 4,300 impressions · Bing: 14 clicks · 600 impressions · Google Analytics: 340 organic visits (last 3 months)". In plan rows, Search Console alone needs no label. Pages match by path and query, then by path. |
| `analytics` | `analytics` from `google.mjs fetch`: GA4 organic sessions by landing page, `{ "/path": { sessions, engaged } }`, for the same period as `trafficPeriod` | "Google Analytics: 340 organic visits" in the traffic line, and one Overview line: "Google Analytics: 5,320 organic visits to 210 landing pages (last 90 days)". |
| `speed` | The crawler with `--outside`: `{ strategy, samples[], trend?, lcpBreakdown? }`, each sample `{ url, field, origin, lab }`; `lcpBreakdown` is `{ source: "real visitors" \| "lab", url, ttfb, loadDelay, loadDuration, renderDelay }` in ms, from CrUX with `CRUX_API_KEY`, else the home page's lab run | One Overview line: "Real-user speed (mobile): LCP 2.1 s · INP 180 ms · CLS 0.05 (passes)". With `lcpBreakdown`, one more line after the lab-speed line naming LCP's biggest part with its fix: "LCP breakdown (real visitors): most of the time goes on the wait before the main image starts loading (1.2 s). Preload the hero image, give it fetchpriority="high" and don't lazy-load it." |
| `labSpeed` | The crawler with `--outside` and Chrome or Edge installed: `[{ url, lcp, cls, tbt }]` from one throttled phone load per sample page (lcp and tbt in ms) | One Overview line under the speed line: "Lab speed, slow mobile (indicative): LCP 3.2 s · CLS 0.04 · TBT 450 ms on the home page". |
| `lighthouse` | The crawler with `--outside --lighthouse` and Lighthouse installed: `[{ url, scores: { performance, seo, accessibility, bestPractices }, metrics: { lcp, cls, tbt, fcp, speedIndex }, failed: [{ id, title, category }] }]` | One Overview line after the lab-speed line: "Lighthouse (mobile, home page): Performance 72 · SEO 92 · Accessibility 88 · Best practices 96". With more than 5 pages (`--lighthouse all`) it adds the lowest scores: ". Lowest performance of 140 pages: /blog/ 31 · /shop/ 38 · /about/ 45". Each result also carries `lcpParts`. Information only, no findings. |
| `googleUpdates` | `google-updates.mjs`, copied as is: `{ from, to, updates: [{ name, start, end, url }], note? }` (`end` null while an update still rolls out; `note` when the window is older than the feed's 12 months) | One quiet line on the Overview and on the Since-last-audit tab: "Google ranking updates in this period: March 2026 core update (5–19 Mar) · …", or that none were announced. Dates only, never a cause. |
| `matomo`, `posthog` | `connect-keys.mjs`, copied as is: `{ period: { from, to }, traffic: { "/path": { visits } } }`, visits from search engines by landing page | "Matomo: 31 organic visits" (or "PostHog: …") in the traffic line, and one Overview line: "Matomo: 5,351 organic visits to 2 landing pages (2026-08-20 to 2026-11-16)". |
| `backlinks` | `backlinks.mjs`, copied as is: `{ when, checked, live, gone: [{ url, reason }], unreachable: [{ url, reason }], nofollow: [{ url, rel }] }` | In "Links from other sites": "X of Y known links are still there; Z gone; W couldn't be checked", then up to 10 gone links with reasons, escaped. Its `backlinks-gone` finding (LAUNCH-05) is an ordinary finding. |
| `authority`, `attribution` | `connect-keys.mjs`: `[{ domain, openPageRank, ahrefsDR }]` (the site, then competitors) and `{ text, url }` when Ahrefs data is present | One Overview line: "Authority: Open PageRank 3.6 · Domain Rating 21 · rival.com: 5.1 / 40", with "Domain Rating by Ahrefs" linked beside it (licence requirement). |
| `bing` | `connect-keys.mjs`, copied as is: `{ siteUrl, period: { from, to }, traffic: { "/path": { clicks, impressions } }, queries[], backlinks: { pages: [{ url, count }], sample: [{ url, anchorText }] }, crawlIssues[] }` | "Bing: 14 clicks · 600 impressions" in the traffic line; one Overview line: "Bing (2026-05-18 to 2026-11-15): 1,240 clicks · 30,100 impressions · 85 pages have links from other sites"; and a collapsed "Links from other sites (Bing)" on the Overview (a section in the Markdown) with the 10 most-linked pages and up to 5 links to the home page with their anchor text, all escaped. `queries` is data for the agent; the `bing-crawl-issues` finding (CRAWL-05) is an ordinary finding. |

Findings from `gsc-import.mjs` (INTENT-02…04) and the intent checks (INTENT-01, INTENT-05) are ordinary findings in the "Search intent" area. Findings from `google.mjs fetch` are ordinary findings too: key pages Google hasn't indexed (CRAWL-02), a different Google-chosen canonical (URL-04) and sitemap errors (MAP-01). Skipped or failed connections go under Limits with the reason and never change the score.

## The plan (setup mode only)

`/seo-setup` adds a top-level `plan`. Without it, the report is unchanged. How to fill it is in `planning.md`.

```json
"plan": {
  "status": "proposed",
  "approvedOn": "2026-11-18",
  "summary": "A marketing site with docs. Setup adds one metadata helper, a sitemap, schema and the missing /docs page.",
  "yes": [{ "id": "Y1", "what": "Redirect www to the apex domain", "why": "One host for every URL", "approved": false }],
  "pages": [
    { "url": "/pricing", "type": "Pricing page", "status": "to-build", "target": "acme pricing",
      "intent": "Someone comparing plans before signing up", "title": "Pricing | Acme", "description": "…", "h1": "Simple pricing",
      "schema": ["WebPage", "BreadcrumbList"], "parent": "/", "linksTo": ["/features"],
      "owner": { "needs": "facts", "what": "Confirm the current plan prices", "done": false }, "finding": "F-004" },
    { "pattern": "/docs/{slug}", "count": 24, "built": 0, "type": "Docs article", "status": "to-build",
      "title": "{Article title} | Acme docs", "samples": [{ "url": "/docs/install", "title": "Install Acme | Acme docs" }] }
  ]
}
```

| Field | Rule |
| --- | --- |
| `plan.status` | `proposed`: waiting for the owner. `approved`: being built. `built`: all of the agent's work is done (owner items can still be open). |
| `pages[].status` | `exists` (already right), `to-build`, `built` (done and re-checked) or `to-create` (a proposed new page). |
| `pages[].owner` | The owner's part: `needs` (`copy`, `facts`, `decision` or `yes`), `what`, `draft` (path relative to the report, e.g. `drafts/privacy.md`) and `done`. Shown as **Needs you** until `done` is true. |
| `pages[].intro` | For a new missing-parent page: its 1–2 sentence intro, built only from facts already on the site. Shown on the Plan tab; approving the plan approves these exact words. |
| `pages[].from` | The old URL when a page moves. The redirect is part of building the row, and it always needs its own yes on a live site. |
| Pattern rows | Used for sets of more than 20 pages. `pattern` + `count` (and `built`, the pages done so far). `title`, `description` and `h1` hold templates, plus up to 3 `samples` with resolved values. |
| `plan.alsoFixes` | IDs of open findings setup will also fix in code after approval. It never includes owner items, decisions or yes items. Shown on the Plan tab, so approving the plan approves these fixes. |
| `yes[]` | Site-level items that need their own yes. `approved: true` records a yes, and `declined: true` records a no. A declined item stays as a record and is never carried out. A row's `owner` can be `declined` the same way. |
| `finding` | The related finding's ID, linked from the row. |

**Progress** (computed by the renderer): each row counts once. A row that `exists` or is `built` counts 1. A pattern row in any other status counts `built ÷ count`. Anything else counts 0. Progress is the average, as a percentage.

**Default tab:** while `plan.status` is `proposed`, the report opens on the Plan tab.

## Writing well

- Plain words. "Google can't see this page's text" beats "CSR hydration issue".
- Numbers over adjectives: "38 of 40 pages" rather than "most pages".
- One problem per finding. When one helper causes three symptoms, write one finding and list the symptoms in `what`.
- `wont-fix` needs a reason in `fixed.summary` or `notes`, and the matching accepted exception goes in the SEO profile.
