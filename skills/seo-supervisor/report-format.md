# Report format

The audit is one JSON file, `seo-audit/seo-audit.json`. The same file carries the fix history, so a later fix run updates it instead of starting over. `scripts/render-report.mjs` turns it into two files:
- **`seo-audit/seo-audit.html`:** a self-contained page (offline, light and dark, phone, print). The Overview tab shows the health score, area scores, charts and "Fix first". The Findings, Decisions, Changes, Passed and Limits tabs hold the detail, showing up to 10 evidence rows per finding.
- **`seo-audit/seo-audit.md`:** the full report as Markdown, with every evidence row. Use it for reading in an editor, diffing between runs, and pasting into tickets.
- **`seo-audit/seo-audit.pdf`,** only with `--pdf`: the HTML report printed by the installed Chrome or Edge, every tab in turn, for a client or a manager. Without a browser it says so and writes the other two.

The renderer ends with a short receipt: the score and band, what fixing the blockers unlocks, the open counts and the files written. Repeat it in chat.

**Several sites:** `node scripts/dashboard.mjs <folder> <folder> … [--out dashboard.html]` (or `npx seo-supervisor dashboard`) reads each folder's `seo-audit.json` and prints one line per site, lowest score first, with the same score model. `--out` also writes one offline HTML page linking to each report. It reads local files only.

## The score (computed by the renderer, never by hand)

- Every checked rule is worth 10 points: each rule in `passed`, plus each distinct `rule` among `findings`. A finding without a rule counts as its own rule.
- A rule earns 10 if it passes or all its findings are `fixed`. Otherwise it earns by its worst open finding: low 8, medium 6, needs-decision 6, high 3, blocker 0. `wont-fix` counts as open.
- **Score** = points earned ÷ points possible × 100, rounded.
- **Blocker cap:** each open blocker caps the score. One caps it at 59, two at 49, three at 39, and so on, never below 9. The report says when the cap applies, and shows the score the site reaches once the open blockers are fixed: the same model, with those blockers treated as fixed. After a fix run it shows the change: the total's, or the checked-rules score's when the cap holds the total still.
- **Area scores** use the same rules within each `category`.
- **It's our score, not Google's.** "How this score works" says so: it counts only the rules the audit checked, and search engines don't use it. Never call it a Google score or a ranking.
- **Page scores:** each page with open findings gets its own score, shown collapsed on the Overview (the 10 lowest) and in full in the Markdown. It's the same model over the site's checked rules, counting only the open findings whose `evidence` names that page. Pages come from evidence URLs on the site's own host (`www.` or not); other sites' pages and files such as `sitemap.xml` and `robots.txt` are left out. It's labelled "SEO Supervisor's own score, not Google's" and never changes the site or area scores. Since evidence holds examples, a finding with a bigger `count` can touch pages not listed.
- **Score views:** with `trustSignals`, the Overview adds a "Score views" panel. **Trust signals (E-E-A-T)** is signals found ÷ signals that apply × 100, rounded (8 of 11 is 73), labelled "SEO Supervisor's own check, not a Google score". Missing signals are suggestions listed with what to add: they aren't findings and never change the overall or area scores. **Local SEO** and **Content quality** are the "Local business" and "Headings & content" area scores under those names, each shown only when its area has checked rules.
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
2. Review each finding against the SEO profile. Keep it, change its severity, or drop it and say why in `notes`. **Merge** findings that share a root cause into one: e.g. near-duplicate pages (crawler), templated intros (content scan) and reused FAQs all come from one template, so they become one finding listing every symptom in `what`. Then look **across areas** for the patterns below. When the same pages show both signs, write one finding about the cause: name its rule as the field rules say, list the other rules as "Related:" in `what`, and take the highest severity.

   | Same pages show | Usually means | The one finding |
   | --- | --- | --- |
   | Thin pages (CONTENT-05) and two pages for one query (INTENT-02) | Several weak pages split one topic | Merge them into one hub page and 301 the rest to it (URL-07). Merging and removing pages is the owner's call: `fixBy: "owner"`. |
   | Templated text (CONTENT-04) and duplicate titles or descriptions (META-01, META-02) | One template fills them all | Fix the template, with each page's own facts. |
   | Orphan pages (LINK-02) also missing from the sitemap (MAP-03) | Pages the site has forgotten | Link them from their hub and list them, or let the owner retire them. |
   | Sitemap URLs that redirect or fail (CRAWL-06) and canonicals that disagree (URL-04) | Sitemap and canonical are built from different URL sources | Build both from the one URL helper. |
   | Content, links or H1 only after JavaScript (REND-01) and missing H1 or schema in the crawl (CONTENT-01, SCHEMA-03) | The page is built in the browser | One REND-01 finding listing what's missing from the server HTML. |
   | Slow LCP (PERF-01) and heavy images (PERF-08) | The hero image | One PERF-01 finding naming the image and its fix. |
   | noindex (CRAWL-02) on pages the sitemap lists (MAP-02) | The two signals disagree | One finding with a decision: which is meant? |

   These are our own rules of thumb, not Google's. Merge only when the evidence shows the same pages; two problems that only sit in the same area stay two findings.
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
| `trustSignals` | `seo-crawl.mjs`, copied as is: `[{ id, label, rule, applies, found, evidence, add }]`, 11 signals in this order: `about`, `contact`, `org-schema`, `author-byline`, `author-page`, `dates`, `sources`, `customer-proof`, `policies`, `https`, `own-media`. `applies` is false for the author and date signals on a site with no articles, and for `https` when only a local origin is known; `policies` asks for terms only where the site sells or collects data, and for returns only on a shop | The "Score views" panel on the Overview (a section in the Markdown): "Trust signals (E-E-A-T) 73/100 · 8 of 11 signals found · missing: author pages, sources cited, customer reviews", labelled "SEO Supervisor's own check, not a Google score", the missing signals with what to add, and the Local SEO and Content quality rows. Information only: never findings, never in the score. |
| `diff` | `seo-diff.mjs`, copied as is: `{ since, regressions[], improvements[], changed[], added[], removed[] }`, each change `{ path, kind, before, after }` (speed changes also carry `source`, schema-field changes `detail`), plus `compared[]`, the optional fields both crawls recorded. It also compares robots.txt (`robots-changed`, with the rules that went and came as `detail`), sitemap listing (`left-sitemap`/`joined-sitemap`), internal links in (`lost-internal-links`, halved and at least 5 fewer) and redirects (`redirect-changed`/`-added`/`-removed`), each only when both crawls recorded it; `compared` may hold `robots`, `sitemap`, `links`, `redirects` | A "Since last audit" tab, counting regressions. Absent on a first audit. Besides status, noindex, canonical, H1, title, description, social tags and page length, it shows pages that got slower or faster (`speed-slower`/`speed-faster`) and schema types that lost or gained fields (`schema-fields-removed`/`-added`, e.g. "Product lost aggregateRating, offers"). Speed counts only a real change, and never compares one source with another: real visitors (phone and desktop each, never mixed), a Core Web Vital crossed its limit or moved 20% and at least 300 ms (LCP), 50 ms (INP) or 0.05 (CLS); lab load, LCP moved 40% and 1 s; Lighthouse, the performance score moved 15 points. More kinds, partial crawls and `timeline` are under "Since last audit" below. |
| `traffic`, `trafficPeriod` | `traffic` and `period` from `gsc-import.mjs` or `google.mjs fetch` (same shape: by path, `clicks`, `impressions`, `ctr`, `position`) | One traffic line on findings (HTML and Markdown) and in plan rows' "Search traffic" about that page, with the Bing and Google Analytics numbers when present: "Search Console: 120 clicks · 4,300 impressions · Bing: 14 clicks · 600 impressions · Google Analytics: 340 organic visits (last 3 months)". In plan rows, Search Console alone needs no label. Pages match by path and query, then by path. |
| `analytics` | `analytics` from `google.mjs fetch`: GA4 organic sessions by landing page, `{ "/path": { sessions, engaged } }`, for the same period as `trafficPeriod` | "Google Analytics: 340 organic visits" in the traffic line, and one Overview line: "Google Analytics: 5,320 organic visits to 210 landing pages (last 90 days)". |
| `speed` | The crawler with `--outside`: `{ strategy, samples[], trend?, lcpBreakdown? }`, each sample `{ url, field, origin, lab }`; `lcpBreakdown` is `{ source: "real visitors" \| "lab", url, ttfb, loadDelay, loadDuration, renderDelay }` in ms, from CrUX with `CRUX_API_KEY`, else the home page's lab run | One Overview line with Google's band for each metric: "Real-user speed (mobile): LCP 2.1 s (good) · INP 180 ms (good) · CLS 0.05 (good), passes Core Web Vitals". With `lcpBreakdown`, one more line after the lab-speed line naming LCP's biggest part with its fix: "LCP breakdown (real visitors): most of the time goes on the wait before the main image starts loading (1.2 s). Preload the hero image, give it fetchpriority="high" and don't lazy-load it." Also, in the collapsed "Speed and image details" panel (information only): each sample's `field` and `origin` add `fcp`, `ttfb` (ms) and `shares` (each metric's good / needs improvement / poor shares, 0 to 1), and its `lab` adds `lcpElement` and `version` (PageSpeed's Lighthouse); `trend` adds `avg4` (the first four weeks against the last four), `series` (each week's p75, `null` for a week with too few visits), `periods` and `period` (`{ from, to }`, the latest 28 days); with `CRUX_API_KEY`, `tablet` (`{ trend, lcpBreakdown? }`) and `pageTrend` (`{ url, trend }`, the home page alone). |
| `labSpeed` | The crawler with `--outside` and Chrome or Edge installed: `[{ url, lcp, cls, tbt }]` from one throttled phone load per sample page (lcp and tbt in ms) | One Overview line under the speed line: "Lab speed, slow mobile (indicative): LCP 3.2 s · CLS 0.04 · TBT 450 ms on the home page". |
| `lighthouse` | The crawler with `--outside --lighthouse` and Lighthouse installed: `[{ url, scores: { performance, seo, accessibility, bestPractices }, metrics: { lcp, cls, tbt, fcp, speedIndex }, failed: [{ id, title, category }] }]` | One Overview line after the lab-speed line: "Lighthouse (mobile, home page): Performance 72 · SEO 92 · Accessibility 88 · Best practices 96". With more than 5 pages (`--lighthouse all`) it adds the lowest scores: ". Lowest performance of 140 pages: /blog/ 31 · /shop/ 38 · /about/ 45". Each result also carries `lcpParts` and `detail: [{ id, title, category, items[] }]`, every audit scoring under 0.9 with up to 10 files or elements each. A collapsed "Lighthouse details" panel lists them per page (10 pages in the HTML, all in the Markdown), escaped. Each result also has `passed` (audits scoring 0.9 or more), `version` and `lcpElement`, shown in "Speed and image details"; `--lighthouse 20` runs that many pages. With Lighthouse 13.3 or later, `agentic: { passed, total, failed: [{ id, title }] }` holds the Agentic browsing checks (phone only, no 0–100 score), shown in "AI crawlers and agents". Information only, no findings. |
| `googleUpdates` | `google-updates.mjs`, copied as is: `{ from, to, updates: [{ name, start, end, url }], note? }` (`end` null while an update still rolls out; `note` when the window is older than the feed's 12 months) | One quiet line on the Overview and on the Since-last-audit tab: "Google ranking updates in this period: March 2026 core update (5–19 Mar) · …", or that none were announced. Dates only, never a cause. |
| `matomo`, `posthog` | `connect-keys.mjs`, copied as is: `{ period: { from, to }, traffic: { "/path": { visits } } }`, visits from search engines by landing page | "Matomo: 31 organic visits" (or "PostHog: …") in the traffic line, and one Overview line: "Matomo: 5,351 organic visits to 2 landing pages (2026-08-20 to 2026-11-16)". `byDevice` and `byCountry` (`{ name: { visits } }`, the top 10) add one quiet line each: "Matomo organic visits by device: desktop 120 · smartphone 40", "… by country: US 100 · DE 99". Information only. |
| `backlinks` | `backlinks.mjs`, copied as is: `{ when, checked, live, gone: [{ url, reason }], unreachable: [{ url, reason }], nofollow: [{ url, rel }] }` | In "Links from other sites": "X of Y known links are still there; Z gone; W couldn't be checked", then up to 10 gone links with reasons, escaped. Its `backlinks-gone` finding (LAUNCH-05) is an ordinary finding. It also has `found: [{ url, links: [{ href, text, rel }], pageNofollow? }]` (each live page's links to the site, up to 5) and `nofollowSites: [{ site, pages }]` (sites whose every live link is nofollow, sponsored or ugc), and a `nofollow` entry carries `page` when the whole page is nofollow. "More about links" shows up to 10 of each, escaped. Information only. |
| `links`, `anchorMix` | `links-import.mjs`, copied as is. `links`: `{ sites: [{ domain, links, targets? }], texts: [{ text, links }], pages: [{ url, links }], source: "search-console", when }` from Search Console's Top linking sites, Top linking text and Top linked pages exports, or `null` when there was no export (a text's `links` is `null` when the export has no count). `anchorMix`: `{ brand, address, generic, other }`, shares from 0 to 1 | First in "Links from other sites (Search Console)" on the Overview (a section in the Markdown): "Search Console (export of 18 Nov 2026): 42 sites link to you · 18 of your pages have links" (a full 1,000-row export, Search Console's limit, reads "1,000 or more"), the 5 sites and 5 pages with the most links, and "Link text: your brand 40% · web address 20% · generic, like “click here”, 10% · other 30%.", all escaped. With Bing data too, the heading reads "(Search Console and Bing)" and Bing's lists say they're Bing's. Information only: no findings, no score. |
| `worthALook` | `links-import.mjs`, copied as is: `[{ kind, subject, why, look, examples? }]`. `kind` is `sitewide` (one site linking from 50 or more of its pages to 3 or fewer of yours, and at least 20% of all links), `keyword-text` (75% or more of at least 10 link texts are descriptive phrases) or `same-text` (the same descriptive words from 3 or more sites in Bing's sample). `targets` on a site is how many of your pages it links to | A "Worth a look" list in the Links panel (and the Markdown), escaped, each with why it's listed and what to look at. Information only: no findings, no score, never called toxic. |
| `linkSummary` | `links-import.mjs`: `{ sites, pages, bingPages }`, how many linking sites and linked pages the exports list and how many pages Bing lists (`bing.backlinks.pages`); `null` for a source that wasn't there | Not shown. Kept for the next audit's `links-import.mjs --previous`. |
| `linksChange` | `links-import.mjs --previous`: `{ kind: "links-dropped", what: "sites" \| "bingPages", before, after }`, or `null` | "Links dropped" in Since last audit: "Sites linking to you (Search Console): 120 → 70 (−42%) since the last audit", pointing to `backlinks.mjs` to find which links went. A drop is 30% or more and at least 10, counted only when both audits have that number: an export missing one time is no data, not a drop. Information only. |
| `trafficChange` | `google.mjs fetch`, copied as is: `{ previous: { from, to, clicks, impressions }, current: { … }, drops: [{ path, before, after }] }` (a drop: at least 20 clicks and 30% lost) | One Overview line: "Search clicks: 1,240 → 980 (−21%) · impressions … vs the previous 90 days", then the 5 biggest drops. |
| `searchTypes` | `google.mjs fetch`: `{ image \| video \| news \| googleNews \| discover: { clicks, impressions, pages } }`, only types with impressions | One Overview line: "Clicks from other Google results: Discover 300 · Google Images 120". |
| `byDevice`, `byCountry` | `google.mjs fetch`: site-wide clicks and impressions by device, and for the top 10 countries | One quiet Overview line each. |
| `anomalies` | `google.mjs fetch`: data anomalies Google documents that overlap the period (e.g. the impressions logging error from 13 May 2025 to 27 April 2026) | One Overview line naming Google's "Data anomalies in Search Console" page, so a change isn't misread as real. |
| `authority`, `attribution` | `connect-keys.mjs`: `[{ domain, openPageRank, ahrefsDR }]` (the site, then competitors) and `{ text, url }` when Ahrefs data is present | One Overview line: "Authority: Open PageRank 3.6 · Domain Rating 21 · rival.com: 5.1 / 40", with "Domain Rating by Ahrefs" linked beside it (licence requirement). |
| `bing` | `connect-keys.mjs`, copied as is: `{ siteUrl, period: { from, to }, traffic: { "/path": { clicks, impressions } }, queries[], backlinks: { pages: [{ url, count }], sample: [{ url, anchorText }] }, crawlIssues[] }` | "Bing: 14 clicks · 600 impressions" in the traffic line; one Overview line: "Bing (2026-05-18 to 2026-11-15): 1,240 clicks · 30,100 impressions · 85 pages have links from other sites"; and a collapsed "Links from other sites (Bing)" on the Overview (a section in the Markdown) with the 10 most-linked pages and up to 5 links to the home page with their anchor text, all escaped. `queries` is data for the agent; the `bing-crawl-issues` finding (CRAWL-05) is an ordinary finding. |
| `agents` | The crawler, copied as is: `{ pages: [{ url, tools[] }], ucp, wellKnown[] }`: the WebMCP tools on each page (up to 50 pages), the UCP shop profile's version (`"unknown"` when it gives none, `null` when there's no profile) and the agent files found (`/.well-known/api-catalog`, `/.well-known/agent-card.json`) | A collapsed "AI agents" note on the Overview (a section in the Markdown) listing them, escaped, only when something was found. Information only: no findings, no score (AI-05). |
| `writingNotes` | The crawler, copied as is: `[{ url, longSentences, longestSentence, longParagraphs, stockPhrases[], readingEase, examples[] }]`, English pages with at least one note, most notes first, up to 50; `readingEase` is Flesch's 0–100, `null` under 100 words; `examples` holds the first 12 words of up to 3 long sentences, then each stock phrase in context, for rewrite mode to find each passage (not shown in the report) | A collapsed "Writing notes" panel on the Overview with the 10 pages with the most notes, escaped; the Markdown lists them all. Information only: never findings, never scored (CONTENT-13). |
| `businessType` | The crawler: `{ guess, alternatives[], evidence[], confidence }` (`confidence` is `strong`, `weak` or `none`), from the home page and the site's schema, using `scripts/data/business-types.json` | Not drawn. The agent reads it in setup and fix mode, and asks the owner when it's unclear. Its findings (`schema-too-generic`, `business-type-unclear`, SCHEMA-02) are ordinary findings. |
| `outboundLinks` | The crawler with `--outbound-links` (its own opt-in): `{ checked, broken: [{ url, status }], unreachable: [{ url, reason }] }` | Its `outbound-broken` finding (CRAWL-07) is an ordinary finding. Without the flag, and when pages link to other sites, Limits says links to other sites weren't checked. |
| `positions` | `google.mjs fetch`: `{ queries, top3, top10, beyond }`, shares from 0 to 1 of queries by average position (`top10` includes `top3`) | One quiet Overview line. Information only. |
| `speed.desktop` | The crawler with `--outside --desktop` (its own opt-in): the same shape as `speed`, with `strategy: "desktop"` | One quiet Overview line with good / needs improvement / poor bands per metric (Google's thresholds: LCP 2.5/4 s, INP 200/500 ms, CLS 0.1/0.25). Information only: no finding, no score change. |
| `images` | The crawler: `[{ url, bytes, width, height, format, pages, estSaving }]`, the images it weighed, largest first, up to 100; `estSaving` is a rough estimate (lossy WebP is about 25% smaller than JPEG, lossless about 26% smaller than PNG, plus resizing past 1,600 px wide) | A collapsed "Images by possible saving" table with the top 15, escaped. Information only. `images.mjs` converts them with the optional sharp add-on, only with the owner's yes. |
| `robotsTxt`, `redirects` | The crawler: `{ status, hash, text }` and `[{ from, to, status }]` | Not shown. Kept so the next audit's "Since last audit" can compare them. |
| `hstsPreload` | The crawler: `{ ready, missing[] }`, the home page's HSTS header against the preload list's header rules (TRUST-01) | One quiet Overview line: "HSTS preload: the header meets the list's rules", or what it still needs, plus what hstspreload.org also asks for. Information only. |
| `sections`, `siteSize`, `indexing` | The crawler. `sections`: `[{ path, pages, share }]`, the crawled pages per top-level folder (pages with nothing below them count as `/`), largest first, up to 50, `share` from 0 to 1. `siteSize`: `{ crawled, known, sitemapUrls }`, only when the crawl stopped at `--max`. `indexing`: `{ date, indexed, notIndexed, crawlIndexable, capped }`, from `--gsc-indexing` (Search Console's Page indexing chart export) | "Crawl coverage" on the Overview (a section in the Markdown): a line on the site's size past `--max`, a line with Search Console's indexed count beside the crawl's, and, with two or more sections, a collapsed "Site sections" table (up to 20), escaped. Information only. |
| `section` | The crawler with `--include` or `--exclude`: `{ include[], exclude[] }` | Not shown, and no need to copy it. `seo-diff.mjs` reads it from the crawl, so a section crawl counts as partial. |
| `templatedDescriptions`, `keywordUse` | The crawler, copied as is. `templatedDescriptions`: `{ pages, templated, share, clusters: [{ section, pages, templated }], outsideClusters, verdict }`, `verdict` being `cluster`, `site-wide` or `scattered` (META-02). `keywordUse`: `{ counts: { natural, missing, repetitive, forced }, pages: [{ url, phrase, verdict, density, spots }] }`, English pages whose verdict isn't `natural`, up to 50 (CONTENT-03) | A collapsed "Descriptions and keyword use" panel: the templated share with its verdict, then the keyword-use counts and up to 10 pages (all in the Markdown), escaped. The 3% and 5% lines are our own. Information only. |
| `newLinks`, `noNewLinks`, `unlinkedPages` | `links-import.mjs`, copied as is. `newLinks`: `{ count, sites: [{ domain, links }], since, capped }`, linking sites the `--previous` export didn't list (the first 100; `capped` when either export hit 1,000 rows). `noNewLinks`: `{ newest, asOf }`, when a Latest links export has no link newer than 3 months before its date. `unlinkedPages`: `{ count, of, urls }`, with `--crawl`, the crawled indexable pages no other site links to (the first 100) | In "More about links" on the Overview (a section in the Markdown): up to 5 new sites, the no-new-links line, and up to 5 pages without links, escaped. Information only. |
| `linksToOtherSites` | The crawler, every crawl, with no request: `{ pages: { url: count }, domains: { host: count } }`, each page's distinct links to other sites, and the 1,000 most-linked hosts | One line in "More about links" with the 5 most-linked sites. Information only. `--outbound-links` is the check that visits them. |
| `commonCrawl` | `commoncrawl.mjs --yes`, copied as is: `{ when, crawl: { id, name }, site: { captures, capped, pages, home }, linkingPages: [{ url, state, captured?, links?, pageNofollow?, reason? }], linkingSites[] }`; `state` is `links`, `no-link`, `not-in-crawl`, `not-read` or `not-checked` | In "More about links": how many saved copies of the site the newest crawl holds, and how many known linking pages link to the site in their saved copies. Information only. |
| `moz`, `youtube` | `connect-keys.mjs fetch`, copied as is. `moz`: `[{ domain, domainAuthority, spamScore, linkingDomains, inboundLinks }]`. `youtube`: `{ channel: { id, title, subscribers, videos, views }, topics: [{ topic, videos: [{ id, url, title, channel, published, own }] }] }` | Lines in a collapsed "From your connections" panel on the Overview (a section in the Markdown), escaped. Information only. |
| `bing.backlinks.byPage`, `bing.sister` | `connect-keys.mjs fetch` with `--bing-pages` (up to 20) and `--bing-sister`: `byPage` is `{ "/path": [{ url, anchorText }] }`; `sister` is `{ site, onlySister[], shared }`, the sites that link to the sister site but not to this one | `sister` is one line in "From your connections", up to 10 sites. `byPage` isn't drawn: it's data for the agent. Information only. |
| `matomo.byChannel`, `matomo.byEngine`, `matomo.daily`; `posthog.byReferrer`, `posthog.daily`, `posthog.organicBy`, `posthog.referrersCaptured` | `connect-keys.mjs fetch`, inside `matomo` and `posthog`. The splits are `{ name: { visits } }`. Matomo's `daily` is `{ date: visits }`, PostHog's `{ date: { pageviews, visitors } }`. `organicBy` is `channel` or `referrer`; `referrersCaptured` is false when no visit had a referrer | Lines in "From your connections": visits by channel, by search engine and by referrer, and a warning when PostHog saw no referrers. `daily` isn't drawn. Information only. |
| `domainAge` | `rdap.mjs --yes`: `[{ domain, registered, expires, registrar, server }]`, the site and the competitors named | One line in "From your connections": "Domain age (RDAP): example.com registered 2014-03-02 (registrar) · …". Information only. |
| `siteTotals`, `analyticsDetail` | `google.mjs fetch`. `siteTotals`: `{ clicks, impressions, ctr, position, queryClicks, complete }`, the whole property, with whether the queries listed cover every click. `analyticsDetail`: `{ sessions, users, daily, byDevice, byCountry, aiAssistant: { sessions, bySource } }`, GA4 organic sessions, and the "AI Assistant" channel's sessions by source | Lines in "From your connections": the property totals, organic sessions and users by device and country, and the AI Assistant channel. Information only. |
| `inspection[].crawledAs`, `inspection[].referringUrls` | `google.mjs fetch`, in `google.json` only: how Google crawled each inspected page (`DESKTOP` or `MOBILE`) and the first 10 pages it says link to it | Not copied, not shown. Read them in `google.json` when a key page isn't indexed. |
| `aiReports` | `gsc-import.mjs --ai-google <csv> --ai-bing <csv>`: `{ google: { impressions, pages: { "/path": { impressions } } }, bing: { citations, pages: { "/path": { citations } } } }`, from Search Console's Generative AI performance and Bing's AI Performance exports | Lines in "From your connections" with the totals and the top 3 pages. Information only. |
| `productFields` | The crawler: `{ products, brand, gtin, sku, color, size, material, category }`, how many Products in the schema give each field Google recommends for merchant listings (`gtin` counts a GTIN or MPN) | One quiet Overview line ("Product data" in the Markdown): "Of 40 products in the schema: 38 with a brand, 12 with a GTIN or MPN, …". Google recommends each only where the product has one. Information only. |
| `media` | The crawler, copied as is: `{ heroImages: [{ url, element, src?, source }], serverTimes: { pages, median, p95, slow[] }, domShape: { deep[], wide[] }, imageCredits: { read, creator, ai[], c2pa, noCreator[] }, imageCache: { checked, uncached[], cdn, otherHosts }, lighthouseMedians: { pages, performance, seo, accessibility, bestPractices } }`. `heroImages` needs a lab run; `serverTimes` are one request per page from this machine (ms); deep is over 32 levels and wide over 60 children, our own lines; `lighthouseMedians` needs 2 or more runs | A collapsed "Speed and image details" panel on the Overview (a section in the Markdown), with the `speed` and `lighthouse` extras above, escaped. Information only. Its findings (`img-alt-quality`, `image-preloads`, `hero-no-fetchpriority`, `prerender-hint`, `image-over-500kb`) are ordinary findings. |
| `renderSample`, `renderedPage` | The crawler with `--outside`, when Chrome or Edge is installed. `renderSample`: `[{ url, gate?, h1: { desktop, phone }, cta: { desktop, phone }, words: { html, rendered }, menu, ads, hidden?, jumpLinks?, errors[] }]`, the sample loaded again; `gate` names a login or paywall screen, and that page isn't compared or measured. `renderedPage`: `{ url, steps, words, changes, gate, errors }`, from `--render-page` and `--render-steps` | A collapsed "What the browser saw" panel on the Overview (a section in the Markdown): the first-screen summary, then pages with browser errors, an H1 off the first screen, hidden text, jump-link problems, menu notes or a login or paywall screen, then the chosen page's HTML against what the browser showed. Escaped. Information only; `render-adds-text`, `mobile-menu-closed` and `mobile-ad-density` are ordinary findings. |
| `localBusiness` | The crawler: `{ kind, name, type, address, geo, areas, evidence, streetHidden }`; `kind` is `storefront`, `service-area`, `hybrid` or `null`, told from the LocalBusiness schema and the visible text | The "Local business" panel on the Overview (a section in the Markdown): the kind with up to 6 pieces of evidence, escaped. Information only. |
| `nearby`, `geocode` | `osm.mjs --yes`, copied from `osm.json`. `nearby`: `{ type, label, tags, center, centerFrom, radiusM, count, unnamed, perKm2, places: [{ name, distanceM, osm }] }`, places of the same kind within the radius (2 km unless set). `geocode`: `{ query, found, schemaGeo, distanceM, suggestGeo }`, where Nominatim places the address | In the "Local business" panel: how many similar places are near and the 10 closest, then whether the address and the schema's `geo` agree (250 m is our own line), or the point to add as `geo`. Credited "© OpenStreetMap contributors" (ODbL) wherever it shows, escaped. Context only: never findings, never in the score. |
| `aiBots`, `landmarks` | The crawler. `aiBots`: `[{ bot, vendor, kind, robots, mayIgnore? }]`, each AI crawler; `robots` is `allowed`, `blocked` (its own group) or `blocked-by-star` (by `User-agent: *`). `landmarks`: `{ checked, count, pages: [{ url, missing[] }] }`, pages without a main, nav, header or footer landmark, the first 20 (AI-05) | A collapsed "AI crawlers and agents" panel on the Overview (a section in the Markdown): a table of the crawlers, the landmark line and its pages, and Lighthouse's Agentic browsing checks (`lighthouse[].agentic`), escaped. Information only. |
| `bots.<name>.ipCheck` | `log-scan.mjs --verify-ips`, in `log-scan.json` only: `{ verified, other, unknown }`, that bot's requests from the vendor's published addresses, from other addresses, and from lines with no address | Not copied, not shown. Quote it in chat beside the bot counts: requests from other addresses are likely fakes. |

Findings from `gsc-import.mjs` (INTENT-02…04) and the intent checks (INTENT-01, INTENT-05) are ordinary findings in the "Search intent" area. Findings from `google.mjs fetch` are ordinary findings too: key pages Google hasn't indexed (CRAWL-02), a different Google-chosen canonical (URL-04), sitemap errors (MAP-01) and rich-result errors Google reports for inspected pages (SCHEMA-08, `gsc-rich-result-errors`). Skipped or failed connections go under Limits with the reason and never change the score.

## Since last audit

`seo-diff.mjs --history seo-audit/history seo-audit/seo-crawl.json --out seo-audit/seo-diff.json` compares the crawl with the newest one filed in `seo-audit/history/`, adds `timeline`, and files the crawl there as `<date>-seo-crawl.json` (with the time too when another crawl has that day; never over another crawl). The first crawl is only filed, and no diff is written. Two files given by hand still work as before. `--fail-on-regressions` exits 1 after writing, for scheduled runs (`examples/scheduled-runs.md`).

More of `diff`, each compared only when both crawls recorded the field (`compared` then holds `h2`, `hreflang` or `sections`):

| Kind | Where | What |
| --- | --- | --- |
| `h1-changed` | Other changes | The H1's text (`h1Text`) is different. A removed H1 stays `h1-removed`. |
| `h2-changed` | Other changes | H2s came or went, or their count changed: "H2s changed: 3 → 4; − Prices · + Plans and prices". A new order alone isn't a change. |
| `hreflang-changed` | Regression when alternates only went, improvement when they only came, else other changes | Each language and its target, with targets on the site's own hosts read as paths, so a local crawl matches the live one: "hreflang changed: − de → /de/b/". |
| `schema-retired-removed` | Other changes | A type whose rich result Google retired (`retired` in `google-rich-results.json`, except the ones marked `keep`) was taken off. Not a regression; removing FAQPage still is. A retired type's fields aren't compared. |
| `section-shrunk` | Regression | A top-level section (the crawl's `sections`) lost half its pages and at least 10 (our own line): "Section shrank: 40 → 12". Never sent to IndexNow or Bing. |

- **Open Graph:** `og-removed` and `og-added` also count `og:description` and `og:url` once both crawls keep them.
- **Length:** `content-shrunk` and `content-grew` now need at least 50 words and a third fewer, or half as many again (our own lines).
- **Partial crawls:** a crawl that stopped at `--max`, or covered one part of the site (`section`, from `--include`/`--exclude`) that the other crawl didn't, missed pages. When it's the new crawl, `removed` is empty and `removedUnknown` is `true` (`--max`) or `"section"`; when it's the last one, `added` is empty and `addedUnknown` says why. Since last audit says why in a plain sentence. Internal links and sections are compared only when both crawls were whole.
- **`timeline`:** `[{ date, pages, findings, regressions, improvements, added, removed }]`, one row per filed crawl, oldest first. Each row after the first counts its changes from the row before; `null` means it couldn't be told. From 3 rows on, a collapsed "Audit timeline" table on the Overview (a section in the Markdown), newest first, 100 rows at most. Information only.
- **`googleUpdates.posts`:** `google-updates.mjs --blog` adds `[{ title, date, url }]`, the Google Search Central blog's posts in the period (launches and policy changes; Search Central Live events left out). One quiet line on the Overview and in Since last audit: "Google Search Central announcements in this period: Update to the Site Reputation Policy (28 Aug) · …", titles escaped and linked. Dates only, never a cause.

## Audiences (the audience check)

Written by you, not a script, as `audience.md` says. Leave it out when the owner named no audiences.

```json
"audiences": [
  { "name": "Landlords", "wants": "a fixed price for a gas safety certificate", "checked": "2026-11-21",
    "pages": [
      { "url": "https://www.example-plumbing.com/gas-safety/",
        "has": ["Who it's for: “Landlord gas safety certificates” in the H1", "Next step: a Book button above the fold"],
        "missing": ["No price on the page or linked from it", "No reviews from landlords"] }
    ] }
]
```

| Field | Rule |
| --- | --- |
| `name`, `wants` | The audience exactly as the owner named it, and what they come for. Never an invented persona. |
| `checked` | The date of the check, `YYYY-MM-DD`. |
| `pages[]` | Up to 5 key pages, each with its `url`. |
| `has`, `missing` | Short lines, each with evidence from the page: a quote, or where you looked. Up to 10 in each list. |

Shown as a collapsed "Audience check" panel on the Overview (a section in the Markdown): each audience, then each page with "On the page:" and "Missing:". Everything is escaped, since it can quote page text. The report shows at most 4 audiences, 5 pages each and 10 items a list, and skips entries that are malformed or empty. Information only: no score, no percentages, no findings, and it never changes the score.

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
