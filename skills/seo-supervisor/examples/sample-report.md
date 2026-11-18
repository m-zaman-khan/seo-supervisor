# SEO report: Example Security (sample data)

https://security.example · 214 pages crawled · Next.js 16 (App Router) · tools, content, services · 17 Nov 2026 · fix

**SEO health score: 49/100 (Poor).** Not ready: 2 blockers to fix first.

2 open blockers hold the score at 49 until fixed.

**Fix the 2 blockers and the score rises to 90/100 (Excellent).** The 2 fixes from this run earned **7** points. You'll see them once the blockers are fixed. F-002 needs you: the agent won't change it without your go-ahead.

Close to launch-ready: the tool pages are server-rendered and well structured, but two blockers remain. Shareable scan reports are indexable, and 36 DNS-lookup tool pages share most of their text. Two earlier fixes (canonicals and the sitemap host) are in and verified.

Open: 7 (2 blocker, 1 high, 1 decision, 2 medium, 1 low) · Fixed: 2 · Rules passing: 14 of 21

## Area scores

| Area | Score | Open findings | Top issue |
| --- | ---: | ---: | --- |
| Interactive tools | 53 | 2 | 1,240 shareable scan reports are indexable |
| Headings & content | 59 | 1 | 36 tool pages share most of their text |
| AI search | 60 | 1 | robots.txt blocks OAI-SearchBot and PerplexityBot |
| Metadata | 60 | 1 | 14 titles are longer than 60 characters |
| Crawling & indexing | 65 | 1 | Unknown URLs return 200 on the first request (soft 404) |
| Trust & security | 80 | 1 | No /.well-known/security.txt |
| Internal linking | 100 | 0 | All checks pass |
| Performance | 100 | 0 | All checks pass |
| Rendering | 100 | 0 | All checks pass |
| Sitemaps & robots | 100 | 0 | All checks pass |
| Structured data | 100 | 0 | All checks pass |
| URLs & canonicals | 100 | 0 | All checks pass |

## SEO plan

Status: Built (approved 2026-11-16) · Progress: 83% · 1 already right, 4 built, 1 to create · 2 need you

A free security-tools site with a docs section. Setup added one metadata helper, the sitemap and robots.txt, Organization and SoftwareApplication schema, breadcrumbs, and the missing /docs parent page. The security disclosure page is waiting for the owner to approve its draft.

Setup also fixed 2 audit findings in code: F-003, F-004.

| Page | Type | Status | Target | Title | Description | H1 | Schema | Parent | Needs you |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| / | Home | Already right | free website security tools | Free Website Security Tools \| Example Security |  | Free security tools | Organization, WebSite |  |  |
| /tools | Tools listing | Built | website security checker tools | Security Checkers: SSL, DNS, Headers \| Example Security |  | Security tools | CollectionPage, ItemList, BreadcrumbList | / |  |
| /tools/{slug} ×36 | Tool page | Built | {tool} checker | {Tool name}: Free {Check} \| Example Security | Check {thing} for any domain in seconds. Free, no sign-up: see what's wrong and how to fix it. | {Tool name} | WebApplication, BreadcrumbList | /tools |  |
| /pricing | Pricing page | Built | security monitoring pricing | Pricing \| Example Security |  | Simple pricing for teams | WebPage, BreadcrumbList | / | Facts: Confirm the Team plan price before it goes into the page copy |
| /docs | Docs hub | Built | example security api docs | Docs \| Example Security |  | Docs | CollectionPage, BreadcrumbList | / |  |
| /security | Disclosure policy | To create | example security vulnerability disclosure | Report a Vulnerability \| Example Security |  | Report a vulnerability | WebPage | / | Copy: Approve the drafted disclosure policy and add the security contact (draft: drafts/security.md) |

Intros for new pages (approving the plan approves these words):

- /docs: Guides and API reference for Example Security. Start with the API guide to run checks from your own scripts.

## Decisions needed

### Launch the 36 DNS tools now or after rewriting?

They're live in staging and linked from the tools hub.

- Rewrite first (2–3 days)
- Launch 6 core types now, hold the rest

**Recommended:** Launch the 6 most-searched types now with unique copy and hold the rest.

### F-008: Should AI search crawlers be allowed?

The robots file blocks every AI crawler, including the search crawlers that decide whether the site is cited in ChatGPT and Perplexity answers.

- Allow all AI crawlers
- Block training crawlers only (GPTBot, ClaudeBot, Google-Extended, CCBot)
- Block all (current)

**Recommended:** Block training only, so the tools can still be cited in AI answers.

## What was changed

- **F-004** The sitemap listed localhost URLs: sitemap.ts uses the same SITE_URL constant as the metadata helper. (`src/app/sitemap.ts`). Verified: re-crawl 17 Nov: all 214 URLs on https://security.example
- **F-003** 52 canonicals pointed at the staging host: metadataBase now reads SITE_URL, which fails the build if missing; production env updated. (`src/lib/seo.ts`, `next.config.ts`). Verified: re-crawl 17 Nov: 0 canonicals on the wrong host

## Findings

### F-001 · Blocker · 1,240 shareable scan reports are indexable

Status: Open · Area: Interactive tools · Rule: TOOL-05 · Cases: 1240

**What's wrong.** Every scan creates a public `/r/{id}/` page with no noindex. 1,240 were found through internal links, each showing another company's domain and results. Related: CRAWL-10.

**Why it matters.** Thousands of thin, near-identical pages look like scaled content to Google, and they publish data about other people's domains.

**How to fix.** Send `X-Robots-Tag: noindex, follow` for `/r/:path*` in `next.config.ts` headers, keep them out of the sitemap, and expire them after 30 days.

| Where | Detail |
| --- | --- |
| https://security.example/r/8f2k1/ | 200, no robots meta, no X-Robots-Tag |
| `src/app/r/[id]/page.tsx:12` | metadata has no robots field |

1238 more cases not listed.

### F-002 · Blocker · Needs you · 36 tool pages share most of their text

Status: Open · Area: Headings & content · Rule: CONTENT-04 · Cases: 418

**What's wrong.** The DNS-record tools (A, AAAA, MX, TXT, CNAME and 31 more) use one intro, one how-to and one FAQ set with only the record type swapped. The crawler found 418 page pairs sharing over 60% of their main text; the content scan found 36 intros collapse to 2 distinct texts.

**Why it matters.** Pages that differ only by a swapped name are treated as scaled or doorway content and can hold down the whole site.

**How to fix.** Write a specific intro, checks and FAQs for each record type in `src/data/tools/dns.ts`, or merge the rare types into one DNS lookup tool with a type selector.

| Where | Detail |
| --- | --- |
| https://security.example/tools/mx-lookup/ | 78% shared with /tools/txt-lookup/ |
| `src/data/tools/dns.ts:8` | intro: `Look up the ${type} records for any domain…` |

416 more cases not listed.

### F-005 · High · Unknown URLs return 200 on the first request (soft 404)

Status: Open · Area: Crawling & indexing · Rule: CRAWL-05

**What's wrong.** A never-seen URL like `/tools/does-not-exist/` returns 200 with an empty page the first time, then 404 on later requests.

**Why it matters.** Google wastes crawls on these and may index junk URLs.

**How to fix.** Validate the slug at the top of `src/app/tools/[slug]/page.tsx` and call `notFound()` before anything suspends.

| Where | Detail |
| --- | --- |
| https://security.example/seo-supervisor-404-probe-x1/ | 200, x-nextjs-postponed: 1 |

### F-008 · Decision · robots.txt blocks OAI-SearchBot and PerplexityBot

Status: Needs decision · Area: AI search · Rule: AI-02

**What's wrong.** The robots file blocks every AI crawler, including the search crawlers that decide whether the site is cited in ChatGPT and Perplexity answers.

**Why it matters.** Blocking search crawlers keeps a free-tools brand out of AI answers; blocking only training crawlers is a common middle ground.

**How to fix.** Decide the policy and record it in the SEO profile.

**Decision needed.** Should AI search crawlers be allowed?

- Allow all AI crawlers
- Block training crawlers only (GPTBot, ClaudeBot, Google-Extended, CCBot)
- Block all (current)

Recommended: Block training only, so the tools can still be cited in AI answers.

| Where | Detail |
| --- | --- |
| https://security.example/robots.txt | User-agent: OAI-SearchBot / Disallow: / |

### F-007 · Medium · 14 titles are longer than 60 characters

Status: Open · Area: Metadata · Rule: META-01 · Cases: 14

**What's wrong.** Tool titles append “Free Online Tool” and the brand, e.g. 74 characters for the SSL checker.

**Why it matters.** Long titles get cut off in results, often losing the brand or the key phrase.

**How to fix.** Shorten the tool title pattern in `src/lib/seo.ts` to “{Tool} - Free {Thing} Check”.

| Where | Detail |
| --- | --- |
| https://security.example/tools/ssl-checker/ | 74 chars: SSL Certificate Checker - Free Online SSL Test Tool \| Example Security |

13 more cases not listed.

### F-006 · Medium · 9 tool forms use placeholder text instead of labels

Status: Open · Area: Interactive tools · Rule: TOOL-03 · Cases: 9

**What's wrong.** The domain field on 9 tools has `placeholder="Enter domain"` and no `<label>`; errors appear only as a red border.

**Why it matters.** Unlabelled fields hurt accessibility and leave the page without clear text about what it does; visitors who hit an error leave.

**How to fix.** Add a visible `<label for>`, helper text via `aria-describedby`, and a text error with `role=alert` in the shared `DomainInput` component.

| Where | Detail |
| --- | --- |
| `src/components/tools/DomainInput.tsx:21` | <input placeholder="Enter domain"> |

8 more cases not listed.

### F-009 · Low · No /.well-known/security.txt

Status: Open · Area: Trust & security · Rule: TRUST-02

**What's wrong.** The path returns 404.

**Why it matters.** Researchers look for it first; a security company without one looks careless.

**How to fix.** Publish one following RFC 9116 (template in the skill's examples/snippets.md).

| Where | Detail |
| --- | --- |
| https://security.example/.well-known/security.txt | status 404 |

### F-004 · High · The sitemap listed localhost URLs

Status: Fixed · Area: Sitemaps & robots · Rule: MAP-02 · Cases: 214

**What's wrong.** All 214 `<loc>` entries used `http://localhost:3000`.

**Why it matters.** Google ignores sitemap URLs on the wrong host, so new pages are found slowly.

**How to fix.** Build sitemap URLs from the production origin.

**What was done.** sitemap.ts uses the same SITE_URL constant as the metadata helper. Files: `src/app/sitemap.ts`. Verified: re-crawl 17 Nov: all 214 URLs on https://security.example.

| Where | Detail |
| --- | --- |
| https://security.example/sitemap.xml | <loc>http://localhost:3000/tools/</loc> |

213 more cases not listed.

### F-003 · High · 52 canonicals pointed at the staging host

Status: Fixed · Area: URLs & canonicals · Rule: URL-04 · Cases: 52

**What's wrong.** Canonicals on tool and guide pages used `https://staging.security.example` because `NEXT_PUBLIC_SITE_URL` was unset in the production build.

**Why it matters.** Canonicals on the wrong host send ranking signals to a site that shouldn't be indexed.

**How to fix.** Set the production origin in one place and use it for `metadataBase`.

**What was done.** metadataBase now reads SITE_URL, which fails the build if missing; production env updated. Files: `src/lib/seo.ts`, `next.config.ts`. Verified: re-crawl 17 Nov: 0 canonicals on the wrong host.

| Where | Detail |
| --- | --- |
| https://security.example/tools/ssl-checker/ | canonical → https://staging.security.example/tools/ssl-checker/ |

51 more cases not listed.

## Passed checks

- **REND-01** Content is in the server HTML, not only in JavaScript (src/app/tools/[slug]/page.tsx is a server component)
- **REND-02** Collapsed content stays in the HTML
- **CONTENT-01** Exactly one H1 per page
- **CONTENT-02** Heading levels are not skipped
- **SCHEMA-01** JSON-LD parses without errors
- **SCHEMA-02** Organization and WebSite schema on the home page (src/app/layout.tsx:44)
- **SCHEMA-04** Schema matches what the page visibly shows
- **URL-02** One trailing-slash style, the other variant redirects
- **CRAWL-07** No internal links to broken pages
- **LINK-02** No orphan pages
- **TOOL-06** Secrets never leave the browser (JWT and hash tools run client-side)
- **PERF-03** The first image is not lazy-loaded

## Limits of this audit

- **Core Web Vitals field data:** Site not live yet; no CrUX data. Lighthouse lab scores are in notes.
- **CDN/WAF behaviour toward search and AI crawlers:** Can't be seen from a local crawl; check after launch with URL Inspection.
- Crawled a production build on localhost:3123, mapped to https://security.example.
- Lighthouse (mobile, lab): LCP 1.9 s, CLS 0.02, TBT 140 ms on the SSL checker.

## How the score works

Every checked rule is worth 10 points. A rule that passes, or whose findings are all fixed, earns 10. A rule with open findings earns by its worst one: low 8, medium or decision 6, high 3, blocker 0. The score is the share of points earned. Each open blocker caps it: one at 59, two at 49, three at 39. While a blocker is open, the panel also shows the score you reach once it is fixed. Area scores use the same rules within each area.
