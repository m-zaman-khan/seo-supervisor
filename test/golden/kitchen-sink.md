# SEO report: Example Plumbing & Heating "Kitchen Sink" \<test\> Zürich

`https://www.example.com` · 1240 pages crawled · Next.js 16 (App Router) · local-business, services, ecommerce · 20 Nov 2026 · fix

Not ready: two blockers hold the score down, the 80 town pages that only swap the town name and a noindex on the home page. The boiler and heat-pump pages are solid & well linked, and this run fixed the staging canonicals and the sitemap host. Fix the two blockers first, then the slow combi-boiler page, the short HSTS header and the long titles; the owner's call on AI crawlers is under Decisions. Everything else is minor.

**SEO health score: 49/100 (Poor).** Not ready: 2 blockers to fix first.

2 open blockers hold the score at 49 until fixed.

**Fix the 2 blockers and the score rises to 89/100 (Good).** The 2 fixes from this run earned **4** points. You'll see them once the blockers are fixed. F-001 needs you: the agent won't change it without your go-ahead.

## Fix first

What the agent can fix in code. Each line fixes one.

- **F-002** · Blocker · The home page is noindex · `/seo-fix F-002`
- **F-003** · High · HSTS max-age is one day · `/seo-fix F-003`
- **F-004** · High · The combi-boiler page fails Core Web Vitals (LCP 4.6 s) · `/seo-fix F-004`

## Needs you

Your call, your accounts or your go-ahead: the agent won't change these without you.

- **F-001** · Blocker · 80 town pages differ only by the town name
- **F-007** · Decision · robots.txt blocks OAI-SearchBot and PerplexityBot
- Decision · Keep the 80 town pages live while they're rewritten?

All 5 are under Decisions needed, below.

## Area scores

| Area | Score | Open findings | Top issue |
| --- | ---: | ---: | --- |
| Crawling & indexing | 50 | 1 | The home page is noindex |
| Local business | 59 | 1 | 80 town pages differ only by the town name |
| Performance | 65 | 1 | The combi-boiler page fails Core Web Vitals (LCP 4.6 s) |
| Trust & security | 70 | 2 | HSTS max-age is one day |
| Accessibility | 80 | 1 | The booking form's date field has no label |
| AI search | 80 | 1 | robots.txt blocks OAI-SearchBot and PerplexityBot |
| Images & media | 80 | 1 | Gallery images use “image1.jpg”-style names and empty alt text |
| Metadata | 80 | 1 | 14 titles are longer than 60 characters |
| Headings & content | 87 | 1 | The heat-pump guide lost its H1 |
| Structured data | 87 | 1 | Product schema has no aggregateRating |
| Internal linking | 90 | 1 | 3 pages are linked from nowhere |
| E-commerce | 100 | 0 | All checks pass |
| Rendering | 100 | 0 | All checks pass |
| Services | 100 | 0 | All checks pass |
| Sitemaps & robots | 100 | 0 | All checks pass |
| URLs & canonicals | 100 | 0 | All checks pass |

Checked 1,240 pages against 34 rules · 3 checks couldn't run: see Limits of this audit, below.

Open: 12 (2 blocker, 2 high, 1 decision, 3 medium, 4 low) · Fixed: 2 · Rules passing: 22 of 34

Clicks from Google: 1,240 (last 3 months) · Core Web Vitals (real visitors, mobile): pass

## SEO plan

Status: Approved: being built (approved 2026-11-18) · Progress: 57% · 2 already right, 2 to build, 1 built, 1 to create · 2 need you

A local plumbing & heating site with a shop. Setup adds one metadata helper, LocalBusiness and Product schema, and a real `/pricing` page.

After the build, setup also fixes 2 audit findings in code: F-003, F-009.

### Needs your yes

Each needs its own yes; approving the plan doesn't cover them.

- Y1: Redirect example.com to www.example.com (One host for every URL)
- /boilers/: Approve moving the boiler FAQ onto the hub

Declined: Y3: Retire the 2025 offers pages
Declined: /offers/: Keep the offers page?

| Page | Type | Status | Target | Title | Description | H1 | Schema | Parent | Needs you |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| / | Home | Already right | plumber zürich | Plumber & Heating Engineer in Zürich \| Example Plumbing |  | Plumbing & heating in Zürich | Plumber, WebSite |  |  |
| /boilers/ | Service hub | To build | boiler service zürich | Boilers \| Example Plumbing | Boiler service & repair \<same day\>. | Boilers | Service, BreadcrumbList | / | Your yes: Approve moving the boiler FAQ onto the hub |
| /pricing | Pricing page | To create | plumber prices zürich | Prices \| Example Plumbing |  | Prices | WebPage | / | Facts: Confirm the call-out price (draft: drafts/pricing.md) |
| /heat-pumps/ | Service page | Built | heat pump installer | Heat Pumps \| Example Plumbing |  | Heat pumps | Service | / |  |
| /offers/ | Offers | Already right |  |  |  |  |  | / |  |
| /plumber-{town}/ ×24 | Town page | To build | plumber {town} | Plumber in {Town} \| Example Plumbing | Local plumbers in {Town}: jobs, photos & reviews from {Town}. | Plumber in {Town} | Service, BreadcrumbList | / |  |

Intros for new pages (approving the plan approves these words):

- /pricing: Fixed prices for the jobs we do most, from boiler services to gas safety certificates.

## Findings

### F-001 · Blocker · Needs you · 80 town pages differ only by the town name

Status: Open · Area: Local business · Rule: LOCAL-02 · Cases: 80 · Effort: half a day or more

**What's wrong.** Intros and FAQs are one template with `{town}` swapped, so “Zürich” & “Winterthur” read the same; the crawler found 1,204 page pairs sharing over 60% of their main text. Related: CONTENT-04.

**Why it matters.** Google treats pages that only swap a place name as doorway pages and can filter them or hold down the whole site.

**How to fix.** Publish only towns with real local proof (jobs, photos, reviews from that town), each with its own intro and FAQs, in `src/data/towns.ts`. Hold the rest with the publish flag.

Search Console: 310 clicks · 9,800 impressions (last 3 months) on `/plumber-zurich/`

| Where | Detail |
| --- | --- |
| `https://www.example.com/plumber-zurich/` | 74% shared with /plumber-winterthur/ \<main\> & "FAQ" — only “Zürich” differs |
| `https://www.example.com/plumber-winterthur/` | 71% shared with /plumber-uster/ (Winterthur) |
| `https://www.example.com/plumber-uster/` | 72% shared with /plumber-dubendorf/ (Uster) |
| `https://www.example.com/plumber-dubendorf/` | 73% shared with /plumber-wetzikon/ (Dübendorf) |
| `https://www.example.com/plumber-wetzikon/` | 74% shared with /plumber-kloten/ (Wetzikon) |
| `https://www.example.com/plumber-kloten/` | 75% shared with /plumber-horgen/ (Kloten) |
| `https://www.example.com/plumber-horgen/` | 76% shared with /plumber-thalwil/ (Horgen) |
| `https://www.example.com/plumber-thalwil/` | 77% shared with /plumber-adliswil/ (Thalwil) |
| `https://www.example.com/plumber-adliswil/` | 78% shared with /plumber-wadenswil/ (Adliswil) |
| `https://www.example.com/plumber-wadenswil/` | 79% shared with /plumber-bulach/ (Wädenswil) |
| `https://www.example.com/plumber-bulach/` | 80% shared with /plumber-dietikon/ (Bülach) |
| `https://www.example.com/plumber-dietikon/` | 81% shared with /plumber-zurich/ (Dietikon) |
| `src/lib/towns.ts:214` | intro template only swaps `{town}` |

67 more cases not listed.

**Next step.** `/seo-fix F-001` asks you first: the agent won't change this without your go-ahead.

### F-002 · Blocker · The home page is noindex

Status: Open · Area: Crawling & indexing · Rule: CRAWL-02 · Effort: under 30 minutes

**What's wrong.** The home page sends `X-Robots-Tag: noindex` from a leftover staging header in `next.config.ts`.

**Why it matters.** Google drops a noindex page from search, and the home page carries the brand searches.

**How to fix.** Remove the X-Robots-Tag header from `next.config.ts` for production builds.

Search Console: 1,840 clicks · 52,300 impressions · Bing: 14 clicks · 600 impressions · Google Analytics: 3,400 organic visits · Matomo: 3,100 organic visits · PostHog: 800 organic visits (last 3 months) on `/`

Microsoft Clarity (the 3 days before 20 Nov 2026): 120 sessions · average scroll depth 48% · quick backs in 22% of sessions · rage clicks in 3% of sessions · dead clicks in 6% of sessions · excessive scrolling in under 1% of sessions on `/`

| Where | Detail |
| --- | --- |
| `https://www.example.com/` | X-Robots-Tag: noindex, nofollow |
| `next.config.ts:31` | headers() adds X-Robots-Tag for every path |

**Next step.** `/seo-fix F-002` fixes it and checks the fix.

**Check the fix yourself.** `curl -s -D - 'https://www.example.com/' | grep -ioE -e '^x-robots-tag:.*' -e '<meta[^>]*(robots|googlebot)[^>]*>'` It prints the robots meta tags and any X-Robots-Tag header. After the fix, none of them carries the rule this finding names.

### F-004 · High · The combi-boiler page fails Core Web Vitals (LCP 4.6 s)

Status: Open · Area: Performance · Rule: PERF-01 · Cases: 2 · Effort: an hour or two

**What's wrong.** The hero image is a 2.4 MB JPEG loaded lazily; real visitors wait 4.6 s for it. Related: PERF-08.

**Why it matters.** Slow pages lose visitors and rank lower in close calls.

**How to fix.** Serve the hero as WebP at 1,600 px, give it `fetchpriority="high"` and drop `loading="lazy"` in `src/components/Hero.tsx`.

Search Console: 420 clicks · 18,000 impressions · Google Analytics: 340 organic visits · Matomo: 31 organic visits · PostHog: 12 organic visits (last 3 months) on `/boilers/combi/`

Microsoft Clarity (the 3 days before 20 Nov 2026): 40 sessions · average scroll depth 61% · quick backs in 35% of sessions on `/boilers/combi/`

| Where | Detail |
| --- | --- |
| `https://www.example.com/boilers/combi/` | LCP 4.6 s (poor), hero.jpg 2.4 MB, loading="lazy" |
| `https://www.example.com/boilers/` | LCP 3.1 s, same hero component |

**Next step.** `/seo-fix F-004` fixes it and checks the fix.

### F-003 · High · HSTS max-age is one day

Status: Open · Area: Trust & security · Rule: TRUST-01 · Effort: under 30 minutes

**What's wrong.** `Strict-Transport-Security: max-age=86400` on every page; the preload list asks for a year and **includeSubDomains**.

**Why it matters.** A short HSTS lifetime leaves visitors open to downgrade attacks between visits.

**How to fix.** Set `max-age=31536000; includeSubDomains` in the CDN's response headers.

Search Console: 1,840 clicks · 52,300 impressions · Bing: 14 clicks · 600 impressions · Google Analytics: 3,400 organic visits · Matomo: 3,100 organic visits · PostHog: 800 organic visits (last 3 months) on `/`

Microsoft Clarity (the 3 days before 20 Nov 2026): 120 sessions · average scroll depth 48% · quick backs in 22% of sessions · rage clicks in 3% of sessions · dead clicks in 6% of sessions · excessive scrolling in under 1% of sessions on `/`

| Where | Detail |
| --- | --- |
| `https://www.example.com/` | Strict-Transport-Security: max-age=86400 |

**Next step.** `/seo-fix F-003` fixes it and checks the fix.

**Check the fix yourself.** `curl -sI 'https://www.example.com/'` It prints the status and the response headers. After the fix, the header or status this finding names is right.

### F-007 · Decision · robots.txt blocks OAI-SearchBot and PerplexityBot

Status: Needs decision · Area: AI search · Rule: AI-02

**What's wrong.** The robots file blocks every AI crawler, including the search crawlers that decide whether the site is cited in AI answers.

**Why it matters.** Blocking search crawlers keeps a local business out of AI answers; blocking only training crawlers is a common middle ground.

**How to fix.** Decide the policy and record it in the SEO profile.

**Decision needed.** Should AI search crawlers be allowed?

- Allow all AI crawlers
- Block training crawlers only (GPTBot, ClaudeBot, Google-Extended, CCBot)
- Block all (current)

Recommended: Block training only, so the business can still be cited in AI answers.

| Where | Detail |
| --- | --- |
| `https://www.example.com/robots.txt` | User-agent: OAI-SearchBot / Disallow: / |

**Next step.** `/seo-fix F-007` asks you first: the agent won't change this without your go-ahead.

### F-010 · Medium · Product schema has no aggregateRating

Status: Won't fix · Area: Structured data · Rule: SCHEMA-03 · Cases: 40

**What's wrong.** The 40 shop products give no `aggregateRating`, so no review stars can show.

**Why it matters.** Review stars can lift clicks on product results.

**How to fix.** Add aggregateRating from the review system once it collects real reviews.

| Where | Detail |
| --- | --- |
| `https://www.example.com/shop/thermostat-x2/` | Product without aggregateRating |

39 more cases not listed.

### F-008 · Medium · 14 titles are longer than 60 characters

Status: In progress · Area: Metadata · Rule: META-01 · Cases: 14 · Effort: an hour or two

**What's wrong.** Service titles append “Fast & Friendly” and the brand, e.g. 74 characters for the boiler-repair page.

**Why it matters.** Long titles get cut off in results, often losing the brand or the key phrase.

**How to fix.** Shorten the service title pattern in `src/lib/seo.ts` to “{Service} in {Town} | Example Plumbing”.

| Where | Detail |
| --- | --- |
| `https://www.example.com/boilers/repair/` | 74 chars: Boiler Repair Zürich - Fast & Friendly \<24/7\> \| Example Plumbing & Heating |
| `https://www.example.com/search?q=boiler&page=2` | 68 chars, "Search results" page |

12 more cases not listed.

**Next step.** `/seo-fix F-008` fixes it and checks the fix.

### F-009 · Medium · The heat-pump guide lost its H1

Status: Open · Area: Headings & content · Rule: CONTENT-01

**What's wrong.** A layout change turned the H1 into a styled `<div>`.

**Why it matters.** The H1 tells people and search engines what the page is about.

**How to fix.** Restore the `<h1>` in `src/app/blog/[slug]/page.tsx`.

| Where | Detail |
| --- | --- |
| `https://www.example.com/blog/heat-pump-guide/` | no \<h1\> in the server HTML |

**Next step.** `/seo-fix F-009` fixes it and checks the fix.

### F-013 · Low · Needs you · Gallery images use “image1.jpg”-style names and empty alt text

Status: Open · Area: Images & media · Rule: MEDIA-01 · Cases: 18

**What's wrong.** 18 gallery photos have `alt=""` and file names like `IMG_0042.jpg`.

**Why it matters.** Image search can't tell what the photos show.

**How to fix.** Write short alt text in the CMS gallery fields.

| Where | Detail |
| --- | --- |
| `https://www.example.com/gallery/` | 18 of 18 images have alt="" |

17 more cases not listed.

**Next step.** `/seo-fix F-013` asks you first: the agent won't change this without your go-ahead.

### F-011 · Low · 3 pages are linked from nowhere

Status: Open · Area: Internal linking · Rule: LINK-02 · Cases: 3 · Effort: under 30 minutes

**What's wrong.** Old landing pages, such as O'Brien's partner page, have no internal links.

**Why it matters.** Pages nothing links to are found late and rank poorly.

**How to fix.** Link them from `/about/` or retire them with a 301.

| Where | Detail |
| --- | --- |
| `https://www.example.com/o'brien-partners/` | 0 internal links in |
| `https://www.example.com/offers/spring-2025/` | 0 internal links in |
| `https://partner.example.org/plumbers` | another site's page, left out of page scores |

**Next step.** `/seo-fix F-011` fixes it and checks the fix.

### F-012 · Low · The booking form's date field has no label

Status: Open · Area: Accessibility

**What's wrong.** The date input has a placeholder but no `<label>`.

**Why it matters.** Screen-reader users can't tell what to type.

**How to fix.** Add a visible `<label for>` in `BookingForm.tsx`.

| Where | Detail |
| --- | --- |
| `src/components/BookingForm.tsx:48` | \<input type="date" placeholder="When?"\> |

**Next step.** `/seo-fix F-012` fixes it and checks the fix.

### F-014 · Low · No /.well-known/security.txt

Status: Open · Area: Trust & security · Rule: TRUST-02

**What's wrong.** The path returns 404.

**Why it matters.** A missing security contact slows down people who want to report a problem.

**How to fix.** Publish one following RFC 9116.

**Next step.** `/seo-fix F-014` fixes it and checks the fix.

### F-006 · High · The sitemap listed localhost URLs

Status: Fixed · Area: Sitemaps & robots · Rule: MAP-02 · Cases: 1240

**What's wrong.** All 1,240 `<loc>` entries used `http://localhost:3000`.

**Why it matters.** Google ignores sitemap URLs on the wrong host, so new pages are found slowly.

**How to fix.** Build sitemap URLs from the production origin.

**What was done.** sitemap.ts uses the same SITE\_URL constant as the metadata helper. Files: `src/app/sitemap.ts`. Verified: re-crawl 20 Nov: all 1,240 URLs on `https://www.example.com`.

| Where | Detail |
| --- | --- |
| `https://www.example.com/sitemap.xml` | \<loc\>`http://localhost:3000/boilers/`\</loc\> |

1239 more cases not listed.

### F-005 · High · 52 canonicals pointed at the staging host

Status: Fixed · Area: URLs & canonicals · Rule: URL-04 · Cases: 52

**What's wrong.** Canonicals used `https://staging.example.com` because `NEXT_PUBLIC_SITE_URL` was unset in the production build.

**Why it matters.** Canonicals on the wrong host send ranking signals to a site that shouldn't be indexed.

**How to fix.** Set the production origin in one place and use it for `metadataBase`.

**What was done.** metadataBase now reads SITE\_URL, which fails the build if missing; production env updated. Files: `src/lib/seo.ts`, `next.config.ts`. Verified: re-crawl 20 Nov: 0 canonicals on the wrong host.

Search Console: 0 clicks · 2,400 impressions (last 3 months) on `/heat-pumps/`

| Where | Detail |
| --- | --- |
| `https://www.example.com/heat-pumps/` | canonical → `https://staging.example.com/heat-pumps/` |

51 more cases not listed.

**Check the fix yourself.** `curl -s -D - 'https://www.example.com/heat-pumps/' | grep -ioE -e '^link:.*canonical.*' -e '<link[^>]*canonical[^>]*>'` It prints the page's canonical. After the fix, there's exactly one, naming the URL you want in search.

### Checking a fix yourself

Some findings show a command to check the fix yourself, once it's live. They're for a terminal: macOS, Linux, Git Bash or WSL. Windows 10 and 11 have curl built in: in PowerShell, type curl.exe instead of curl (plain curl there is a different command), and run the ones with grep in Git Bash or WSL. Nothing runs them for you.

## Decisions needed

### Keep the 80 town pages live while they're rewritten?

They're linked from the footer & the service-area map.

- Rewrite first (2–3 days)
- Keep the 12 towns with real jobs live, hold the rest

**Recommended:** Keep the 12 towns with real local proof live and hold the rest.

### Is the emergency call-out price still CHF 120?

### F-007: Should AI search crawlers be allowed?

The robots file blocks every AI crawler, including the search crawlers that decide whether the site is cited in AI answers.

- Allow all AI crawlers
- Block training crawlers only (GPTBot, ClaudeBot, Google-Extended, CCBot)
- Block all (current)

**Recommended:** Block training only, so the business can still be cited in AI answers.

### Your tasks

Findings only you can resolve: a setting on your host or an account, your content or your facts. The agent won't change them without your go-ahead.

- **F-001** 80 town pages differ only by the town name · Blocker
- **F-013** Gallery images use “image1.jpg”-style names and empty alt text · Low

## Search & AI

Information only: nothing here changes the score.

### Search at a glance

Search clicks: 1,240 → 980 (−21%) · impressions: 41,000 → 45,200 (+10%) vs the previous 90 days

Biggest drops in search clicks: /boilers/combi/ 210 → 90 · /plumber-uster/ 60 → 20

Clicks from other Google results: Discover 300 · Google Images 120 · Google Lens and Circle to Search 8 (last 3 months)

Search by device: mobile 600 clicks · 30,000 impressions; desktop 340 clicks · 14,000 impressions; tablet 40 clicks · 1,200 impressions (last 3 months)

Brand searches, as Google labels them: 80 clicks · 1,200 impressions; other searches: 900 clicks · 44,000 impressions (last 3 months)

Search clicks by country: CHE 820 · DEU 90 · AUT 40 (last 3 months)

Google's data anomalies page (https://status.example.org/search-data-anomalies) lists problems in this period: 2026-10-02 to 2026-10-04: impressions under-reported for some properties. A change in these numbers may not be real.

Bing (2026-05-18 to 2026-11-15): 23 clicks · 1,010 impressions · 3 pages have links from other sites

Google Analytics: 5,320 organic visits to 3 landing pages (last 3 months)

Matomo: 3,551 organic visits to 3 landing pages (2026-08-22 to 2026-11-19)

PostHog: 812 organic visits to 2 landing pages (2026-08-22 to 2026-11-19)

Microsoft Clarity (the 3 days before 20 Nov 2026): 165 sessions on 3 pages · most quick backs: /boilers/combi/ 35%, / 22% · most rage clicks: / 3% (pages with 10 or more sessions)

Search Console queries by average position: 12% in the top 3 · 41% in the top 10 · 59% beyond, of 840 queries (last 3 months)

Matomo organic visits by device: desktop 2,100 · smartphone 1,300 (2026-08-22 to 2026-11-19)

Matomo organic visits by country: CH 2,900 · DE 120 (2026-08-22 to 2026-11-19)

PostHog organic visits by device: desktop 500 · mobile 312 (2026-08-22 to 2026-11-19)

PostHog organic visits by country: CH 700 · AT 40 (2026-08-22 to 2026-11-19)

Google ranking updates in this period: August 2026 spam update (26–29 Aug) · October 2026 core update (28 Oct – 12 Nov) · November 2026 \<reviews\> update (17 Nov, still rolling out)

### Top searches and pages

Google Search, last 3 months. Google hides searches very few people make, so the searches add up to fewer clicks than the pages. Information only.

#### What people search to find you

| Search | Clicks | Impressions | Position |
| --- | ---: | ---: | ---: |
| combi boiler cost | 310 | 9,100 | 4.2 |
| emergency plumber \<zurich\> | 220 | 4,800 | 2.1 |
| boiler service near me | 40 | 6,200 | 11.3 |

#### Pages with the most clicks

| Page | Clicks | Impressions |
| --- | ---: | ---: |
| `/` | 1,840 | 52,300 |
| `/boilers/` | 960 | 31,200 |
| `/boilers/combi/` | 420 | 18,000 |
| `/plumber-zurich/` | 310 | 9,800 |
| `/blog/boiler-sizes/` | 120 | 9,800 |
| `/heat-pumps/` | 0 | 2,400 |

### Brand and other searches over time

Brand searches, as Google labels them: 60 → 80 clicks (+33%); other searches: 1,200 → 900 clicks (−25%). Growth that comes only from people who already know the brand isn't new reach. Information only.

| Period | Brand clicks | Brand impressions | Other clicks | Other impressions |
| --- | ---: | ---: | ---: | ---: |
| 2026-05-22 to 2026-08-19 | 60 | 1,000 | 1,200 | 50,000 |
| Last 3 months | 80 | 1,200 | 900 | 44,000 |

### Google's index verdict on key pages

Search Console's URL Inspection, for 3 pages: 2 valid · 1 excluded. Pages Google hasn't indexed are also findings. Information only.

| Page | Verdict | Google says | Last crawled |
| --- | --- | --- | --- |
| `/` | Valid | Submitted and indexed | 18 Nov 2026 |
| `/boilers/combi/` | Excluded | Crawled - currently not indexed | 2 Nov 2026 |
| `/plumber-zurich/` | Valid | Submitted and indexed; Google chose /zurich/ as the canonical | 15 Nov 2026 |

### New searches

New searches this period, with no impressions in the period before: combi boiler cost \<2026\> & fitting (900 impressions) · wärmepumpe zürich (300 impressions). Google hides searches very few people make, so a few of these may have shown the site before. Information only.

### From your connections

Domain age (RDAP): example.com registered 1995-08-14 (Example Registrar, Inc. \<reg\>) · rival.example registered 2014-03-02

YouTube channel Example Plumbing & Heating: 1,200 subscribers · 48 videos · 230,000 views

Top YouTube videos for “how to bleed a radiator”: 1 of 2 from your channel · first: Bleed a radiator in 5 minutes \<easy\> (Example Plumbing & Heating)

Search Console totals for the whole property: 1,240 clicks · 45,200 impressions. The queries listed cover 79% of the clicks; Google doesn't list rare queries.

Google Analytics organic: 5,320 sessions from 4,100 users · mobile 3,000 · desktop 2,320 (last 3 months)

Google Analytics organic sessions by country: Switzerland 4,800 · Germany 300

Google Analytics AI Assistant channel: 42 sessions (ChatGPT 30 · Perplexity 12)

Matomo visits by channel: search 3,520 · direct 900 · website 210 (2026-08-22 to 2026-11-19)

Matomo search visits by search engine: Google 3,300 · Bing 180 · DuckDuckGo 40 (2026-08-22 to 2026-11-19)

PostHog visits by referrer: search.example.org 600 · direct 300 · search.example.net 12 (2026-08-22 to 2026-11-19)

Google AI Overviews and AI Mode: 3,400 impressions on 4 pages (top: / 2,000 · /boilers/ 900 · /heat-pumps/ 300)

Bing AI answers: 120 citations of 2 pages (top: /blog/boiler-sizes/ 80 · / 40)

Bing: 3 sites link to www.example.net but not to this site: guide.example.org, forum.example.org, directory.example.org

### Google Search Central

Google Search Central announcements in this period: Update to the site reputation policy & “parasite” pages (28 Aug) · A new \<report\> in Search Console (5 Nov)

### Keyword ideas

From Search Console. You pick which ideas become targets. There are no search volumes: those need paid data, and none are guessed. Information only.

#### Almost there

Searches at position 8 to 20 with impressions: a small improvement can bring them onto page one.

- boiler service near me: 6,200 impressions, position 11.3, shows `/boilers/service/`

#### Shown for, but no page is about it

Searches below page one where no page's title or H1 holds the search's main words. A new page or a section could answer them.

- heat pump grants: 900 impressions, position 24, shows `/`

#### Questions people search

Each could be an FAQ entry or a section on the page that fits best.

- how long does a boiler last: 450 impressions, position 7.1, shows `/boilers/`

### Searches a page doesn't mention

Searches a page shows for in Google whose words its title, H1 and main text don't use. A page can't answer a search well if it never mentions it, and a 2026 study of AI answers (Chen and Koudas, a preprint, not yet peer reviewed) found that pages whose title and paragraphs match the questions people ask get cited more. Add the words only where they fit the page. Information only: none of this changes the score.

- `/heat-pumps/` shows for “wärmepumpe \<preis\>” (600 impressions), but doesn't use: wärmepumpe, preis.
- `/blog/post-1/` shows for “gap 1” (560 impressions), but doesn't use: word.
- `/blog/post-2/` shows for “gap 2” (520 impressions), but doesn't use: word.
- `/blog/post-3/` shows for “gap 3” (480 impressions), but doesn't use: word.
- `/blog/post-4/` shows for “gap 4” (440 impressions), but doesn't use: word.
- `/blog/post-5/` shows for “gap 5” (400 impressions), but doesn't use: word.
- `/blog/post-6/` shows for “gap 6” (360 impressions), but doesn't use: word.
- `/blog/post-7/` shows for “gap 7” (320 impressions), but doesn't use: word.
- `/blog/post-8/` shows for “gap 8” (280 impressions), but doesn't use: word.
- `/blog/post-9/` shows for “gap 9” (240 impressions), but doesn't use: word.
- `/blog/post-10/` shows for “gap 10” (200 impressions), but doesn't use: word.

### AI crawlers and agents

Information only: none of this changes the score. The table shows whether robots.txt lets each AI crawler in, by its own group or, when it has none, by the User-agent: * group. Fetchers for a user get a page a person asked for, and some vendors say robots.txt may not apply to them.

| Crawler | Vendor | Kind | robots.txt |
| --- | --- | --- | --- |
| GPTBot | OpenAI | Training | Blocked |
| OAI-SearchBot | OpenAI | AI search | Blocked |
| ChatGPT-User | OpenAI | Fetches for a user | Allowed (may ignore robots.txt) |
| ClaudeBot | Anthropic | Training | Blocked by `User-agent: *` |
| PerplexityBot | Perplexity | AI search | Blocked |
| Applebot-Extended | Apple | Training | Blocked by the Googlebot group (Apple follows it when Applebot isn't named) |
| CCBot | Common Crawl | Other | Blocked |

Shared AI-training opt-out (`User-agent: __usage_ai-training`, an IETF draft): set for some paths only. Anthropic honours it since 30 Oct 2026, and Bing from 1 Feb 2027; Google plans to in 2027.

Brave Search's crawler has no user agent of its own, so robots.txt can't name it, and it won't crawl a page Googlebot can't. Brave says robots.txt doesn't keep a page out of its results: a `noindex` robots meta tag does.

This robots.txt has a block that Cloudflare adds, marked `# BEGIN Cloudflare Managed content` or `# BEGIN Cloudflare Bot Preference Sync`. Cloudflare's managed robots.txt and its Bot Preference Sync (announced 21 Aug 2026) write the AI crawler choices made in Cloudflare's dashboard into the live robots.txt, in front of the site's own lines. So the robots.txt the site serves can differ from the one in the code: change those crawlers in Cloudflare's dashboard, as editing the file in the code won't change that block.

Content-Usage lines in robots.txt, shown as written. They come from the IETF's AI preferences drafts (August and September 2026), which aren't final, so the crawl doesn't judge them.

- `User-agent: *`: `Content-Usage: train-ai=n`
- No group (above the first User-agent line): `Content-Usage: search=y, train-ai=n`

Asked as an AI search crawler, these pages answered 402 Payment Required: the site asks crawlers to pay for the page. Cloudflare's pay per crawl answers this way, with the price in a crawler-price header. That's paid access, not a refusal, so it isn't a finding.

- `/guides/heat-pumps/` OAI-SearchBot · crawler-price: USD 0.01
- `/guides/boilers/` PerplexityBot

2 of 1,240 pages lack one or more landmarks (main, nav, header, footer), which screen readers and AI agents use to find their way around a page (AI-05).

- `/offers/spring-2025/` no main, nav
- `/gallery/` no footer

Lighthouse's Agentic browsing checks (experimental; Lighthouse 13.3 or later with Chrome 150 or later): whether AI agents can read and use the page. There's no 0–100 score, only the checks passed.

- `/` 5 of 7 checks passed; failing: Buttons have names agents can read; Form fields have labels & descriptions

### AI agents

What the site offers AI agents, listed for information: none of it is a finding or changes the score. WebMCP is a Chrome experiment that lets a page offer tools to AI agents, and its API is still changing; only inline scripts and forms were read. UCP is the open standard behind checkout in Google's AI Mode and Gemini.

- `/book/?step=1&ref=nav` WebMCP tools: bookVisit, getQuote \<beta\>
- `/.well-known/ucp` UCP shop profile, version 2026-01-11
- `/.well-known/api-catalog` API catalog (RFC 9727)
- `/.well-known/agent-card.json` A2A agent card
- `/.well-known/oauth-protected-resource` OAuth protected resource (RFC 9728)

### Server logs

Logs from 21 Oct 2026 to 19 Nov 2026. User agents can be spoofed, so each count is requests claiming to be that bot. Information only: none of this changes the score.

| Bot | Vendor | Kind | Requests | Paths |
| --- | --- | --- | ---: | ---: |
| `Googlebot` | Google | Search | 9,200 (9,150 from Google's addresses) | 1,180 |
| `GPTBot` | OpenAI | AI training | 1,400 | 600 |
| `OAI-SearchBot` | OpenAI | AI search or answers | 310 | 140 |

#### Visits referred by AI assistants

- `chatgpt.com` 84 visits · top pages: `/boilers/combi/` 40, `/` 22
- `perplexity.ai` 9 visits · top pages: `/faq/` 9

#### Visits referred by Google Search

2,310 visits with a Google Search referrer · top pages: `/` 900, `/boilers/` 610. Browsers and apps often drop the referrer, so Search Console's clicks are the real number.

#### URLs that keep answering 404 to search crawlers

The site doesn't link to these. A 404 is right for a removed page; if one moved, 301 it to its new home.

- `/old-offers/` 46 requests from Googlebot, bingbot

### AI answer check

Whether AI answer engines cited your site when they answered the questions you chose, asked through each provider's API with your own keys. These answers can differ from what people see in the ChatGPT or Perplexity apps, which add personal settings and location, and answers change from day to day. So this is a sample to compare over time, not a ranking. Information only: it doesn't change the score.

#### Perplexity

Perplexity (sonar): your site was cited in 2 of 6 answers (a sample: 3 questions, asked 2 times each, on 2026-11-19).

Rivals:

- rival.example cited in 4 of 6 answers
- boilers.example.org cited in 1 of 6 answers

Your pages cited:

- `/boilers/` cited in 2 answers
- `/plumber-zurich/` cited in 1 answer

Questions whose answers never cited your site:

- Who fits heat pumps near Winterthur?

#### OpenAI

OpenAI (example-model-1 \<mini\>): your site was cited in 0 of 3 answers (a sample: 3 questions, asked 2 times each, on 2026-11-19).

OpenAI stopped after 3 answers: rate limited (429) after 3 answers

Rivals:

- rival.example cited in 2 of 3 answers

## Speed

Information only: nothing here changes the score.

### Speed at a glance

Real-user speed (mobile): LCP 2.4 s (good) · INP 180 ms (good) · CLS 0.05 (good), passes Core Web Vitals · over 25 weeks: LCP 2.8 → 2.4 s (better)

Real-user speed (desktop): LCP 1.6 s (good) · INP 90 ms (good) · CLS 0.12 (needs improvement) · over 25 weeks: LCP 1.9 → 1.6 s (better)

Lab speed, slow mobile (indicative): LCP 3.2 s · CLS 0.04 · TBT 450 ms on the home page

LCP breakdown (real visitors): most of the time goes on the wait before the main image starts loading (1.2 s). Preload the hero image, give it fetchpriority="high" and don't lazy-load it.

Lighthouse (mobile, home page): Performance 72 · SEO 92 · Accessibility 88 · Best practices 96. Lowest performance of 12 pages: /shop/ 31 · /blog/boiler-sizes/ 35 · /boilers/combi/ 41

### Lighthouse details

Every audit each Lighthouse run failed, with the files or page elements it names (10 at most). The accessibility ones are under Lighthouse's accessibility checks. Information only: Lighthouse's lab results don't change the score.

#### `/`

- Efficiently encode images (Performance): `/images/hero.jpg`, `/images/boiler & pipes.png`

#### `/boilers/`

- Efficiently encode images (Performance): `/images/hero.jpg`, `/images/boiler & pipes.png`

#### `/boilers/combi/`

- Efficiently encode images (Performance): `/images/hero.jpg`, `/images/boiler & pipes.png`

#### `/heat-pumps/`

- Efficiently encode images (Performance): `/images/hero.jpg`, `/images/boiler & pipes.png`

#### `/blog/`

- Efficiently encode images (Performance): `/images/hero.jpg`, `/images/boiler & pipes.png`

#### `/blog/boiler-sizes/`

- Efficiently encode images (Performance): `/images/hero.jpg`, `/images/boiler & pipes.png`

#### `/contact/`

- Efficiently encode images (Performance): `/images/hero.jpg`, `/images/boiler & pipes.png`

#### `/plumber-zurich/`

- Efficiently encode images (Performance): `/images/hero.jpg`, `/images/boiler & pipes.png`

#### `/plumber-winterthur/`

- Efficiently encode images (Performance): `/images/hero.jpg`, `/images/boiler & pipes.png`

#### `/shop/`

- Efficiently encode images (Performance): `/images/hero.jpg`, `/images/boiler & pipes.png`

#### `/shop/thermostat-x2/`

- Efficiently encode images (Performance): `/images/hero.jpg`, `/images/boiler & pipes.png`

### Speed and image details

Information only: none of this changes the score.

Share of real visits that were good / needs improvement / poor: LCP 78% / 15% / 7% · INP 81% / 14% / 5% · CLS 90% / 7% / 3% · FCP 70% / 20% / 10% · TTFB 60% / 30% / 10%.

Other real-user numbers, not Core Web Vitals: FCP 1.5 s (good) · TTFB 0.9 s (needs improvement). Google's lines: FCP good up to 1.8 s, poor over 3 s; TTFB good up to 0.8 s, poor over 1.8 s, as a rough guide.

Real-user data period: CrUX's latest 28 days, 19 Oct – 15 Nov 2026.

Over 25 weeks (first week → latest): INP 220 → 180 ms · CLS 0.08 → 0.05. 4-week averages: LCP 2.8 → 2.4 s · INP 215 → 182 ms · CLS 0.08 → 0.05 (the first four weeks against the last four).

Home page alone: LCP 2.9 → 2.5 s · INP 230 → 190 ms · CLS 0.09 → 0.04 over 25 weeks.

Tablet (whole site): LCP 2.6 → 2.3 s over 25 weeks; most of the LCP goes on downloading the main image (0.9 s).

Largest paint in the lab (the LCP element): / → /images/hero zürich.jpg (img.hero), lab · /boilers/combi/ → h1.title \<text\>.

Lighthouse medians across 12 pages: Performance 61 · SEO 91 · Accessibility 82 · Best practices 96.

Lighthouse 13.3.0: / passed 40 audits, failed 3 · /boilers/ passed 39 audits, failed 2 · /boilers/combi/ passed 38 audits, failed 2 · /heat-pumps/ passed 37 audits, failed 2 · /blog/ passed 36 audits, failed 2 and 7 more.

PageSpeed's lab runs used Lighthouse 13.0.2.

Server response time, one request per page from this machine, 1,240 pages: median 210 ms, the slowest 5% from 900 ms. Over 0.8 s (web.dev's “good” time to first byte for real visitors): /shop/ 1.4 s · /search?q=boiler&page=2 2.1 s.

Nested more than 32 levels deep (our own line, from older Lighthouse advice): /shop/thermostat-x2/ 41 levels. Deep nesting usually means wrapper elements that could go.

An element with more than 60 children (our own line): /plumber-zurich/ ul (140). Long lists can load in parts.

Image credits, read from 120 images: 40 name a creator, 1 is labelled as made with AI (/images/ai-van.png), 2 carry Content Credentials (C2PA). No creator: /images/photo-3.png · /images/photo-4.jpg.

Image caching: 7 of 200 images are sent with no cache lifetime (/images/photo-1.png · /images/photo-2.jpg), so browsers download them again on every visit. They come through Example CDN. Images on other hosts: img.example.net (30) · cdn.example.org (4).

### Images by possible saving

A rough estimate of what WebP and resizing to 1,600 px wide would save: Google measured lossy WebP 25–34% smaller than JPEG and lossless WebP 26% smaller than PNG, and the low end is used. Information only: it never changes the score. With your yes, scripts/images.mjs converts the JPEG and PNG ones and keeps the originals (it needs the optional image add-on: npx seo-supervisor --with-image-tools).

| Image | Size | Format | Possible saving |
| --- | ---: | --- | ---: |
| `/images/hero%20z%C3%BCrich.jpg` | 2,344 KB | jpeg · 3200 × 2000 px | about 1,758 KB |
| `/images/photo-1.png` | 2,227 KB | png · 3100 × 2000 px | about 1,660 KB |
| `/images/photo-2.jpg` | 2,109 KB | jpeg · 3000 × 2000 px | about 1,563 KB |
| `/images/photo-3.png` | 1,992 KB | png · 2900 × 2000 px | about 1,465 KB |
| `/images/photo-4.jpg` | 1,875 KB | jpeg · 2800 × 2000 px | about 1,367 KB |
| `/images/photo-5.png` | 1,758 KB | png · 2700 × 2000 px | about 1,270 KB |
| `/images/photo-6.jpg` | 1,641 KB | jpeg · 2600 × 2000 px | about 1,172 KB |
| `/images/photo-7.png` | 1,523 KB | png · 2500 × 2000 px | about 1,074 KB |
| `/images/photo-8.jpg` | 1,406 KB | jpeg · 2400 × 2000 px | about 977 KB |
| `/images/photo-9.png` | 1,289 KB | png · 2300 × 2000 px | about 879 KB |
| `/images/photo-10.jpg` | 1,172 KB | jpeg · 2200 × 2000 px | about 781 KB |
| `/images/photo-11.png` | 1,055 KB | png · 2100 × 2000 px | about 684 KB |
| `/images/photo-12.jpg` | 938 KB | jpeg · 2000 × 2000 px | about 586 KB |
| `/images/photo-13.png` | 820 KB | png · 1900 × 2000 px | about 488 KB |
| `/images/photo-14.jpg` | 703 KB | jpeg · 1800 × 2000 px | about 391 KB |

## Links

Information only: nothing here changes the score.

### Internal link strength

How much of the site's own linking reaches each page, from 0 to 100. This is our own measure, computed with the PageRank formula (Brin and Page, 1998) on this site's own links. It's not Google's PageRank, which uses links from the whole web and isn't public. A page gets more when more pages link to it, and more again when those pages are strong. 100 is the site's strongest page, and 0 means no more than a page nothing links to. The scale is logarithmic: the home page and a few others usually hold most of the strength, and on a straight scale nearly every other page would read close to 0. Here, twice the share of links is always the same number of extra points. It's relative to the 15 pages this crawl read that can be indexed; half of them have a strength of 40 or less. The crawl stopped at --max, so links on pages it didn't read aren't counted. Information only: it doesn't change the score.

- `/` strength 100
- `/boilers/` strength 81
- `/contact/` strength 77
- `/plumber-zurich/` strength 60
- `/heat-pumps/` strength 55
- `/shop/` strength 50
- `/about/` strength 44
- `/blog/` strength 40
- `/gallery/` strength 30
- `/emergency/` strength 25

Found in search, but little link strength: of the 20 crawled pages with the most Search Console clicks, then impressions (last 3 months), these are in the bottom third of the site's strength (our own rule). People already find them in search, so they're worth more links from your own pages. Link to them from the strongest pages above, in a sentence about what they cover, and see Internal link ideas for pages that already mention their searches.

- `/boilers/combi/` strength 12 · Search Console: 420 clicks · 18,000 impressions
- `/blog/boiler-sizes/` strength 8 · Search Console: 120 clicks · 9,800 impressions

### Pages with one incoming link

23 pages that can be indexed have only one other page linking to them; the first 20 are below. A page linked from one place is easy to miss: visitors find it only if they open that one page, and crawlers, which find pages by following links, have a single way in, so the page is cut off if that link goes. A link from a hub or a related page helps both. The crawl stopped at --max, so links on pages it didn't read aren't counted. Information only: it doesn't change the score.

- `/blog/post-20/` linked only from `/blog/?page=2&sort=new`
- `/blog/post-21/` linked only from `/blog/`
- `/blog/post-22/` linked only from `/blog/`
- `/blog/post-23/` linked only from `/blog/`
- `/blog/post-24/` linked only from `/blog/`
- `/blog/post-25/` linked only from `/blog/`
- `/blog/post-26/` linked only from `/blog/`
- `/blog/post-27/` linked only from `/blog/`
- `/blog/post-28/` linked only from `/blog/`
- `/blog/post-29/` linked only from `/blog/`
- `/blog/post-30/` linked only from `/blog/`
- `/blog/post-31/` linked only from `/blog/`
- `/blog/post-32/` linked only from `/blog/`
- `/blog/post-33/` linked only from `/blog/`
- `/blog/post-34/` linked only from `/blog/`
- `/blog/post-35/` linked only from `/blog/`
- `/blog/post-36/` linked only from `/blog/`
- `/blog/post-37/` linked only from `/blog/`
- `/blog/post-38/` linked only from `/blog/`
- `/blog/post-39/` linked only from `/blog/`

### Internal link ideas

Pages that mention a search another page shows for in Google, but don't link to that page. A link from them, in a sentence about the search, helps people and Google find the page that answers it. From Search Console and the crawl. Information only: none of this changes the score.

- `/boilers/combi/` gets 900 impressions for “combi boiler & tank”. Pages that mention it but don't link to it: `/boilers/`, `/blog/boiler-sizes/`
- `/blog/post-1/` gets 850 impressions for “query 1”. Pages that mention it but don't link to it: `/boilers/`, `/blog/boiler-sizes/`
- `/blog/post-2/` gets 800 impressions for “query 2”. Pages that mention it but don't link to it: `/boilers/`, `/blog/boiler-sizes/`
- `/blog/post-3/` gets 750 impressions for “query 3”. Pages that mention it but don't link to it: `/boilers/`, `/blog/boiler-sizes/`
- `/blog/post-4/` gets 700 impressions for “query 4”. Pages that mention it but don't link to it: `/boilers/`, `/blog/boiler-sizes/`
- `/blog/post-5/` gets 650 impressions for “query 5”. Pages that mention it but don't link to it: `/boilers/`, `/blog/boiler-sizes/`
- `/blog/post-6/` gets 600 impressions for “query 6”. Pages that mention it but don't link to it: `/boilers/`, `/blog/boiler-sizes/`
- `/blog/post-7/` gets 550 impressions for “query 7”. Pages that mention it but don't link to it: `/boilers/`, `/blog/boiler-sizes/`
- `/blog/post-8/` gets 500 impressions for “query 8”. Pages that mention it but don't link to it: `/boilers/`, `/blog/boiler-sizes/`
- `/blog/post-9/` gets 450 impressions for “query 9”. Pages that mention it but don't link to it: `/boilers/`, `/blog/boiler-sizes/`
- `/blog/post-10/` gets 400 impressions for “query 10”. Pages that mention it but don't link to it: `/boilers/`, `/blog/boiler-sizes/`

### Authority

Authority: Open PageRank 3.6; rival.example: Open PageRank 5.1

### Links from other sites (Search Console and Bing)

Search Console (export of 18 Nov 2026): 6 sites link to you · 3 of your pages have links

The sites with the most links to you:

- `blog.example.org` 140 links
- `directory.example.org` 96 links
- `news.example.net` 22 links
- `forum.example.org` 9 links
- `café.example` 4 links

Your most-linked pages in Search Console:

- `https://www.example.com/` 210 links
- `https://www.example.com/boilers/` 40 links
- `https://www.example.com/blog/boiler-sizes/` 12 links

Link text: your brand 40% · web address 20% · generic, like “click here”, 10% · other 30%.

A natural mix is mostly your brand, your web address and words that say what the page is about. Information only: it doesn't change the score.

Worth a look: links that stand out. It isn't a score or a finding, and most turn out to be fine.

- **directory.example.org**: 96 links from 96 of its pages to 1 of yours, 31% of all links. See whether it's a footer or sidebar link you asked for. For example: `https://directory.example.org/plumbers?page=1&sort=az`, `https://directory.example.org/zurich/`
- **“cheap boiler repair” and 11 similar texts**: 80% of 15 link texts are descriptive phrases. Check they came from real mentions, not a link scheme.

34 of 40 known links are still there; 2 gone; 1 couldn't be checked

- `https://news.example.org/old-story` 404 \<Not Found\>
- `https://blog.example.org/2019/plumbers` the link to the site was removed

Your most-linked pages in Bing:

- `https://www.example.com/` 120 links
- `https://www.example.com/boilers/` 34 links
- `https://www.example.com/blog/boiler-sizes/` 12 links

Some of Bing's links to the home page:

- `https://blog.example.org/heating-tips` Example Plumbing & Heating
- `https://news.example.net/local-firms` a \<trusted\> plumber

### More about links

Information only: none of this changes the score.

6 new sites link to you since the last export (18 Aug 2026), from Search Console's Top linking sites. Some may be older links: an export holds 1,000 sites at most, so they may have been past the cut before.

- `guide.example.org` 4 links
- `news.example.net` 2 links
- `café.example`
- `school.example.org` 1 link
- `club.example.org` 1 link

No new links for 3 months or more: no link in Search Console's Latest links export was found after 30 Jul 2026 (export of 18 Nov 2026). New links usually come from new things worth linking to, like original data, a free tool, a guide or real news (LINK-10).

900 of your 1,180 crawled pages have no links from other sites in Search Console's list. That's normal for most pages. For the ones that matter most, link to them from your pages that other sites do link to.

- `/heat-pumps/`
- `/boilers/repair/`
- `/plumber-uster/`
- `/contact/`
- `/gallery/`

Sites whose links to you are all nofollow, sponsored or ugc, in the backlink check. Such links are allowed; Google says links marked this way “will generally not be followed”.

- `forum.example.org` 3 pages

Links the backlink check found, with the page each points at and its text:

- `https://blog.example.org/heating-tips` → https://www.example.com/boilers/ “boiler guide & prices” (ugc)
- `https://news.example.net/local-firms` → https://www.example.com/

Common Crawl (CC-MAIN-2026-44) holds 840 saved copies of your site's pages, the home page among them.

1 of 3 known linking pages link to you in Common Crawl's saved copies; 1 isn't in its newest crawl. commoncrawl.mjs --rank adds your domain's rank in its web graph.

- `blog.example.org`
- `news.example.org`
- `forum.example.org`

Common Crawl's web graph (cc-main-2026-jul-aug-oct): example.com is #1,203,456 of 120,000,000 domains by how well linked it is (harmonic centrality), #2,345,678 by PageRank. Common Crawl's own number, not Google's, and information only.

How much this covers: Google says Search Console's Links report “isn't a comprehensive list of every link on your site”, and each of its tables stops at 1,000 rows. Bing's links here are a sample of 2 links to your home page. The backlink check opened 40 known linking pages (100 at most). Common Crawl holds only the pages its monthly crawl reached. Treat the numbers as a sample, not a full count.

### Links to other sites

2 of your 3 crawled pages link to other sites, 6 sites in all; the top 5 are below. Pages that make claims should link to their sources (CONTENT-10). Information only: none of this changes the score.

- `supplier.example.org` 40 addresses
- `maps.example.net` 30 addresses
- `standards.example.org` 12 addresses
- `café.example` 3 addresses
- `news.example.net` 2 addresses

## Site & content

Information only: nothing here changes the score.

### Score views

Estimates, not part of the score.

| View | Score | What it is |
| --- | ---: | --- |
| Trust signals (E-E-A-T) | 70/100 | 7 of 10 signals found · missing: author pages, sources cited, customer reviews. SEO Supervisor's own check, not a Google score |
| Local SEO | 59/100 | The Local business area's score |
| Content quality | 87/100 | The Headings & content area's score |

Trust signals to add. They're suggestions, not findings: they never change the score, and not every signal fits every site.

- **Author pages:** Link each author's name to a page about them (role, experience, credentials), and give the author a `url` in the schema. See CONTENT-07.
- **Sources cited:** Link the source next to each fact and figure in your content. See CONTENT-10.
- **Customer reviews:** Show real reviews, testimonials or case studies from customers. Only real ones count: never invent or edit them. See TRUST-05.

Trust signals found:

- **About page:** /about/ linked from the footer
- **Contact details:** tel: and mailto: links on every page
- **Organization schema:** Plumber schema on /
- **Author names:** “By Anna Example” on articles
- **Dates on articles:** datePublished on 38 of 40 articles
- **Policies:** privacy, terms & returns pages
- **HTTPS and security headers:** HTTPS on every page

### Structured data on each page

4 pages of 5 crawled have structured data. By type: BreadcrumbList 3 · Product 2 · Organization 1 · Plumber 1 · WebSite 1. Information only; schema problems are findings.

| Types | Pages | For example |
| --- | ---: | --- |
| BreadcrumbList, Product | 2 | `/boilers/combi/` |
| BreadcrumbList, Plumber | 1 | `/plumber-zurich/` |
| Organization, WebSite | 1 | `/` |

### Local business

Information only: none of this changes the score. 250 m is our own line for the address check.

A business like this (schema.org files Plumber under home and construction) usually goes to its customers, and its schema gives a street address. If customers come to that address too, keep it on the site and in the schema, and list the towns it serves as areaServed (LOCAL-12). If they don't, Google asks a business to hide an address where it doesn't serve customers (LOCAL-06).

- LocalBusiness schema with a street address
- “We come to you” on /emergency/
- areaServed lists 12 towns
- Opening hours for the showroom
- A map embed on /contact/
- Phone number in the header

OpenStreetMap lists 14 other places of the same kind (plumbers) within 2 km of the schema's geo: about 1.1 per km². Context only: volunteers keep OpenStreetMap, so it can miss businesses or list closed ones.

- Müller & Söhne \<Sanitär\> 350 m
- Plumber 1 550 m
- Plumber 2 700 m
- Plumber 3 850 m
- Plumber 4 1 km
- Plumber 5 1.1 km
- Plumber 6 1.3 km
- Plumber 7 1.4 km
- Plumber 8 1.6 km
- Plumber 9 1.8 km

OpenStreetMap's Nominatim places “1 Example Street, 8000 Zürich” 420 m from the schema's geo. Check which is right on a map: geo should mark the business's own door (LOCAL-06).

Map data © OpenStreetMap contributors, under the Open Database License (https://www.openstreetmap.org/copyright).

### Local rank grid

Where your business appears in the list Google's Places API returns near each spot: an approximation of Google Maps results, not a copy. Each square is a spot 1.5 km apart around your business, north at the top, and the outlined square is your business. Checked on 19 Nov 2026. Information only: it doesn't change the score.

#### plumber

Top 3 at 7 of 25 spots · top 10 at 16 · not in the top 20 at 3 · 1 not checked

```
North
 12   8   5   9 20+
  6   3   2   4  15
  4   2 [1]   3  11
  7   3   2   -  18
20+  10   6  14 20+
```

#### emergency plumber & heating

Top 3 at 1 of 25 spots · top 10 at 6 · not in the top 20 at 13

```
North
20+ 20+  19 20+ 20+
20+  11   7  13 20+
 16   5 [2]   6 20+
20+   9   4  12 20+
20+ 20+  17 20+ 20+
```

Places data: Google Maps

Some results include data © Example Maps Partner.

Two spots were checked again after a timeout.

### Writing notes

Long sentences, long paragraphs and stock phrases on English pages, with Flesch reading ease (0 to 100, higher is easier) as a rough guide. Code and tables are left out. These notes help the writing; they never change the score.

- `/blog/heat-pump-guide/` 11 sentences over 35 words · stock phrases: “in today's fast-paced world”, “look no further” · reading ease 40 · longest sentence: “When you choose a heat pump & a buffer tank for an older house in Zürich, there are many “rules of thumb”…”
- `/blog/post-1/` 10 sentences over 35 words · 1 paragraph over 150 words · stock phrases: “peace of mind” · reading ease 41 · longest sentence: “Sentence 1 runs on and on”
- `/blog/post-2/` 9 sentences over 35 words · 2 paragraphs over 150 words · reading ease 42 · longest sentence: “Sentence 2 runs on and on”
- `/blog/post-3/` 8 sentences over 35 words · stock phrases: “peace of mind” · reading ease 43 · longest sentence: “Sentence 3 runs on and on”
- `/blog/post-4/` 7 sentences over 35 words · 1 paragraph over 150 words · reading ease 44 · longest sentence: “Sentence 4 runs on and on”
- `/blog/post-5/` 6 sentences over 35 words · 2 paragraphs over 150 words · stock phrases: “peace of mind” · reading ease 45 · longest sentence: “Sentence 5 runs on and on”
- `/blog/post-6/` 5 sentences over 35 words · reading ease 46 · longest sentence: “Sentence 6 runs on and on”
- `/blog/post-7/` 4 sentences over 35 words · 1 paragraph over 150 words · stock phrases: “peace of mind” · reading ease 47 · longest sentence: “Sentence 7 runs on and on”
- `/blog/post-8/` 3 sentences over 35 words · 2 paragraphs over 150 words · reading ease 48 · longest sentence: “Sentence 8 runs on and on”
- `/blog/post-9/` 2 sentences over 35 words · stock phrases: “peace of mind” · reading ease 49 · longest sentence: “Sentence 9 runs on and on”
- `/blog/post-10/` 1 sentence over 35 words · 1 paragraph over 150 words · longest sentence: “Sentence 10 runs on and on”

### Descriptions and keyword use

How the descriptions and the main keyword are written, for information: these notes never change the score. Each English page's main phrase is taken from its title; the 3% and 5% lines are our own, from CONTENT-03's “no density targets above about 2–3%”.

210 of 600 descriptions (35%) end in a stock call to action or in a last sentence other pages share. Verdict: a cluster. Most are in `/plumber-<town>/` (72 of 80 pages), `/blog/` (60 of 400 pages), so that section's template is the fix.

Keyword use on 440 English pages: 400 natural · 30 missing · 8 repetitive · 2 forced.

- `/plumber-zurich/` “plumber Zürich & area”: missing, not in the H1 or the first 100 words
- `/blog/post-1/` “phrase 1”: repetitive, over 3% of the words (3.5% of the words)
- `/blog/post-2/` “phrase 2”: forced, over 5% of the words, or in most subheadings (4% of the words)
- `/blog/post-3/` “phrase 3”: missing, not in the H1 or the first 100 words
- `/blog/post-4/` “phrase 4”: repetitive, over 3% of the words (5% of the words)
- `/blog/post-5/` “phrase 5”: forced, over 5% of the words, or in most subheadings (5.5% of the words)
- `/blog/post-6/` “phrase 6”: missing, not in the H1 or the first 100 words
- `/blog/post-7/` “phrase 7”: repetitive, over 3% of the words (6.5% of the words)
- `/blog/post-8/` “phrase 8”: forced, over 5% of the words, or in most subheadings (7% of the words)
- `/blog/post-9/` “phrase 9”: missing, not in the H1 or the first 100 words
- `/blog/post-10/` “phrase 10”: repetitive, over 3% of the words (8% of the words)
- `/blog/post-11/` “phrase 11”: forced, over 5% of the words, or in most subheadings (8.5% of the words)

### Audience check

What your key pages give each audience you named, with evidence from the page. It's a checklist, not a score: it never changes the score or the findings. A missing item becomes new text only through brief or rewrite mode, and only with your yes.

#### Landlords & property managers

What they come for: a fixed price for a gas safety certificate. Checked on 2026-11-19.

- `/gas-safety/`
  - On the page: Who it's for: “Landlord gas safety certificates” in the H1 · Next step: a Book button above the fold
  - Missing: No price on the page or linked from it · No reviews from landlords
- `/pricing/`
  - On the page: Prices for boiler services \<from CHF 120\>

#### Homeowners in Zürich

What they come for: an emergency plumber tonight. Checked on 2026-11-19.

- `/emergency/`
  - On the page: 24/7 phone number in the header
  - Missing: No call-out price

### Product data

Of 40 products in the schema: 38 with a brand, 12 with a GTIN or MPN, 40 with a SKU, 5 with a colour, 9 with a size, 3 with a material, 30 with a category. Google recommends each one where the product has it, so a GTIN, colour or material can rightly be missing. Information only: it doesn't change the score.

### Page scores

Each page with open findings, scored with the same rules as the site but counting only the findings listed for that page. It's SEO Supervisor's own score, not Google's, and it doesn't change the site score. Pages come from the findings' examples, so a finding with more cases than examples can affect pages not listed here.

| Page | Score | Open findings |
| --- | ---: | --- |
| `/` | 59/100 | F-002, F-003 |
| `/plumber-adliswil/` | 59/100 | F-001 |
| `/plumber-bulach/` | 59/100 | F-001 |
| `/plumber-dietikon/` | 59/100 | F-001 |
| `/plumber-dubendorf/` | 59/100 | F-001 |
| `/plumber-horgen/` | 59/100 | F-001 |
| `/plumber-kloten/` | 59/100 | F-001 |
| `/plumber-thalwil/` | 59/100 | F-001 |
| `/plumber-uster/` | 59/100 | F-001 |
| `/plumber-wadenswil/` | 59/100 | F-001 |
| `/plumber-wetzikon/` | 59/100 | F-001 |
| `/plumber-winterthur/` | 59/100 | F-001 |
| `/plumber-zurich/` | 59/100 | F-001 |
| `/boilers/` | 98/100 | F-004 |
| `/boilers/combi/` | 98/100 | F-004 |
| `/blog/heat-pump-guide/` | 99/100 | F-009 |
| `/boilers/repair/` | 99/100 | F-008 |
| `/gallery/` | 99/100 | F-013 |
| `/o'brien-partners/` | 99/100 | F-011 |
| `/offers/spring-2025/` | 99/100 | F-011 |
| `/search?q=boiler&page=2` | 99/100 | F-008 |
| `/shop/thermostat-x2/` | 99/100 | F-010 |

### Crawl coverage

The crawl stopped at 1,240 pages (--max). It knew of 1,610 URLs on the site from links and sitemaps (the sitemaps list 1,580), so the site has at least 1,610 URLs.

Search Console counted 1,102 indexed pages (and 380 not indexed) on 2026-11-18; this crawl found 1,180 pages meant to be indexed before it stopped at --max. Information only: it doesn't change the score.

#### Site sections

How the crawled pages split across the site's top-level folders. Pages with nothing below them count as top-level pages (/). Information only.

| Section | Pages | Share |
| --- | ---: | ---: |
| `/` | 40 | 3% |
| `/blog/` | 600 | 48% |
| `/plumber-<town>/` | 80 | 6% |
| `/shop/` | 420 | 34% |
| `/boilers/` | 100 | 8% |

### What the browser saw

The sample pages loaded again in Chrome at desktop and phone size. Information only; what is a finding is listed with the other findings.

On a phone, the H1 is on the first screen on 1 of 3 pages and a button on 2 of 3; on desktop, 2 of 3 and 3 of 3. The first screen and the button are our own measures, not Google rules.

- `/boilers/combi/` 2 browser errors, first: TypeError: Cannot read properties of undefined (reading 'price') \<at Hero\> · the H1 isn't on the first screen on a phone · 120 hidden words (display:none 100, aria-hidden 20), most in “Free “no-fix-no-fee” guarantee & more” · links to #prices, #faq, which aren't on the page · opened at #reviews, the page scrolled away from it · no menu button found on a phone
- `/shop/` the H1 isn't on the first screen on a phone · the H1 isn't on the first screen on desktop · a link to #top, which isn't on the page · the phone menu button is covered by another layer
- `/account/` showed a login screen, so it wasn't compared or measured

You chose `/heat-pumps/?model=x2&size=8kw`: 120 words in the HTML, 940 after JavaScript and the steps (click #accept, scroll to #prices). What changed: h1: none → Heat pumps & \<buffers\>; title: Loading… → Heat pumps | Example Plumbing. It showed a cookie wall. 1 browser error, first: ReferenceError: dataLayer is not defined.

### HSTS preload

HSTS preload: not ready yet. The header still needs a max-age of at least 31536000 (one year) and includeSubDomains and preload. hstspreload.org also needs the header on the bare domain, http:// sent to https:// on the same host first, and every subdomain on HTTPS. Joining the list is optional and slow to undo. Information only: it doesn't change the score.

### App links and PDFs

The site links to its app. Phones open the site's links in the app only when a file on the site names the app. Google's post on app deep links (2 May 2025) says they don't change how Google ranks or shows pages: they take people from search results straight into the app. Information only: none of this changes the score.

- Android: `/.well-known/assetlinks.json` It's missing (404). That's fine if the app doesn't open the site's links.
- iOS: `/.well-known/apple-app-site-association` It isn't valid JSON \<unexpected token\>. iPhones won't open the site's links in the app until it's fixed.

PDFs on the site that 3 or more pages link to (our own cut-off), or that the menu links to. Microsoft Advertising's guide to AI search answers (8 Oct 2025) says to avoid relying on PDFs for core information: search engines can read text PDFs, but they often lack the headings and other structure HTML gives. If any of these hold something important, such as prices, a menu, specifications or opening hours, put it on an HTML page too. Information only: none of this changes the score.

- `/files/price-list%202026.pdf` linked from 14 pages, including the menu
- `/files/warranty.pdf` linked from 3 pages

### Lighthouse's accessibility checks

Lighthouse's own accessibility checks that failed on each page it ran, with the page elements it names (10 at most). Each check is pass or fail. They're Lighthouse's checks, not SEO Supervisor's, and they can't find everything: some problems, such as keyboard focus that gets trapped, only a person can check. Information only: they don't change the score.

#### `/` (Accessibility 88 · 2 failed checks)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-0.jpg">`, `img.gallery-thumb`
- Background and foreground colors do not have a sufficient contrast ratio: `a.footer-link`, `p.small <muted>`

#### `/boilers/` (Accessibility 87 · 1 failed check)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-1.jpg">`, `img.gallery-thumb`

#### `/boilers/combi/` (Accessibility 86 · 1 failed check)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-2.jpg">`, `img.gallery-thumb`

#### `/heat-pumps/` (Accessibility 85 · 1 failed check)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-3.jpg">`, `img.gallery-thumb`

#### `/blog/` (Accessibility 84 · 1 failed check)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-4.jpg">`, `img.gallery-thumb`

#### `/blog/boiler-sizes/` (Accessibility 83 · 1 failed check)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-5.jpg">`, `img.gallery-thumb`

#### `/contact/` (Accessibility 82 · 1 failed check)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-6.jpg">`, `img.gallery-thumb`

#### `/plumber-zurich/` (Accessibility 81 · 1 failed check)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-7.jpg">`, `img.gallery-thumb`

#### `/plumber-winterthur/` (Accessibility 80 · 1 failed check)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-8.jpg">`, `img.gallery-thumb`

#### `/shop/` (Accessibility 79 · 1 failed check)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-9.jpg">`, `img.gallery-thumb`

#### `/shop/thermostat-x2/` (Accessibility 78 · 1 failed check)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-10.jpg">`, `img.gallery-thumb`

#### `/about/` (Accessibility 77 · 1 failed check)

- Image elements do not have \`\[alt\]\` attributes: `<img src="/images/van-11.jpg">`, `img.gallery-thumb`

## Since last audit

### Many new pages

212 new pages appeared since the last audit (on 20 Oct 2026), 35% more than the 600 pages it found. If you didn't add them, check for hacked or spam pages: see Google's help on hacked content, https://support.google.com/webmasters/answer/9044101#hacked-url-injection

New pages by folder: `/blog/` 150 · `/` (top level) 2 · `/shop/` 40 · other folders 20

Some of them, from different folders:

- `/blog/post-100/` Cheap \<pills\> & more
- `/shop/valve-k1/` no title
- `/new-page/` Neue Seite für Zürich

Our own line: this shows when at least 50 pages are new and they add at least 20% to the pages the last audit found. Information only: it doesn't change the score.

Compared with the crawl of 20 Oct 2026.

Google ranking updates in this period: August 2026 spam update (26–29 Aug) · October 2026 core update (28 Oct – 12 Nov) · November 2026 \<reviews\> update (17 Nov, still rolling out)

Google Search Central announcements in this period: Update to the site reputation policy & “parasite” pages (28 Aug) · A new \<report\> in Search Console (5 Nov)

### Regressions

- `/blog/heat-pump-guide/` H1 removed: 1 → 0
- `/boilers/combi/` Now slower (real visitors): LCP 3.1 s → LCP 4.6 s
- `/` Now noindex: index → noindex
- `/guides/dns/` Now an error: 200 → 500
- `/shop/thermostat-x2/` Schema fields removed: Product lost aggregateRating, offers
- `/robots.txt` robots.txt changed: − Allow: /blog/ · + Disallow: /search?q=\* & /cart/
- `/plumber-uster/` Left the sitemap: listed → none
- `/de/` hreflang changed: hreflang changed: − de → /de/b/
- `/about/` Open Graph tags removed: og:title, og:image → none
- `/blog/post-3/` Word count fell: 900 → 410
- `/old-offer/` Redirect changed: 301 → /offers/ → 302 → /

### Improvements

- `/heat-pumps/` Canonical changed: https://staging.example.com/heat-pumps/ → https://www.example.com/heat-pumps/
- `/contact/` Error fixed: 404 → 200
- `/` Now faster (lab): LCP 4.2 s → LCP 3.2 s
- `/gallery/` Schema added: none → ImageGallery
- `/emergency/` H1 added: 0 → 1

### Other changes

- `/boilers/repair/` Title changed: Boiler Repair → Boiler Repair Zürich - Fast & Friendly \<24/7\> | Example Plumbing & Heating
- `/boilers/` Description changed: Boilers. → Boiler service & “same-day” repair.
- `/pricing/` H1 changed: Prices → Prices & fees
- `/blog/boiler-sizes/` H2s changed: H2s changed: 3 → 4; − Prices · + Plans and prices
- `/faq/` Retired schema removed: HowTo
- `/heat-pumps/` Joined the sitemap: none → listed
- `/waermepumpen/` Now redirects: none → 301 → /heat-pumps/
- `/kontakt/` Redirect removed: 301 → /contact/ → none
- `/shop/` Open Graph tags added: none → og:description, og:url
- `/blog/post-4/` Word count grew: 300 → 820
- `/shop/valve-k1/` Schema fields added: Product gained gtin13
- `/offers/spring-2025/` No longer noindex: noindex → index
- `/gallery/old/` Schema removed: ImageGallery → none
- `/beta/` a-future-kind: x → y

This crawl stopped at its page limit (--max), so pages it didn't reach aren't listed as gone.

### Pages added

- `/blog/post-100/`
- `/blog/post-101/`
- `/heat-pumps/air-to-water/`
- `/plumber-uster/`
- `/shop/valve-k1/`

### Links dropped

- Sites linking to you (Search Console): 120 → 70 (−42%) since the last audit. Information only: it doesn't change the score. To find which links went, run the backlink check (backlinks.mjs) on Search Console's Latest links export or Bing's sample: it lists the links that are gone.

### Audit timeline

Every crawl filed in seo-audit/history, newest first, each compared with the one before it. Crawler findings are the crawler's own count, before the audit's review. – means it couldn't be told: that crawl or the one before covered part of the site. Information only.

| Crawl | Pages | Crawler findings | Regressions | Improvements | Pages added | Pages gone |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 Nov 2026 | 1,240 | 33 | 11 | 5 | 212 | – |
| 20 Oct 2026 | 1,028 | 35 | 1 | 3 | 12 | 134 |
| 20 Aug 2026 | 1,150 | 38 | 2 | 5 | 60 | 10 |
| 21 Jul 2026 | 1,100 | 40 | – | – | – | – |

### Change check

Change check, 3 pages changed on 1 Oct 2026, 28 days before and after: Google Search clicks likely up, about +18% compared with 20 similar unchanged pages (likely range +5% to +33%). This shows what happened to the numbers, not why. Information only.

## What was changed

- **F-006** The sitemap listed localhost URLs: sitemap.ts uses the same SITE\_URL constant as the metadata helper. (`src/app/sitemap.ts`). Verified: re-crawl 20 Nov: all 1,240 URLs on `https://www.example.com`
- **F-005** 52 canonicals pointed at the staging host: metadataBase now reads SITE\_URL, which fails the build if missing; production env updated. (`src/lib/seo.ts`, `next.config.ts`). Verified: re-crawl 20 Nov: 0 canonicals on the wrong host

## Passed checks

- **REND-01** Content is in the server HTML, not only in JavaScript (src/app/\[slug\]/page.tsx is a server component)
- **REND-02** Collapsed content stays in the HTML
- **CONTENT-02** Heading levels are not skipped
- **CONTENT-05** No thin pages
- **SCHEMA-01** JSON-LD parses without errors
- **SCHEMA-02** LocalBusiness and WebSite schema on the home page (src/app/layout.tsx:44)
- **URL-02** One trailing-slash style, the other variant redirects
- **URL-07** Old URLs 301 to their new address
- **MAP-01** The sitemap is valid XML
- **MAP-05** robots.txt answers 200 and names the sitemap
- **CRAWL-07** No internal links to broken pages
- **LINK-01** Every page is within 3 clicks of the home page
- **LOCAL-01** Name, address & phone match across the site
- **LOCAL-06** The address is in the LocalBusiness schema
- **PERF-03** The first image is not lazy-loaded on most templates
- **META-03** Every page has a meta description
- **AI-01** An llms.txt is not required and none is served
- **TRUST-03** Privacy and terms pages are linked from every page
- **SHOP-01** Products have price and availability
- **SVC-01** Each service has its own page

## Limits of this audit

- **Core Web Vitals for the town pages:** Too few Chrome visits for field data; the lab numbers are on the Overview.
- **SHOP-05:** Merchant Center feed: no access to the account.
- **CDN/WAF behaviour toward search & AI crawlers:** Can't be seen from a crawl; check after launch with **URL Inspection**.
- Crawled `https://www.example.com` with `--outside --lighthouse all`, stopped at 1,240 pages (--max).
- F-010 is won't fix: the owner has no review system yet, so there are no real ratings to mark up (accepted in the SEO profile).
- Matomo & PostHog numbers cover 22 Aug to 19 Nov 2026; Clarity's cover the 3 days before 20 Nov.

## How the score works

Every checked rule is worth 10 points. A rule that passes, or whose findings are all fixed, earns 10. A rule with open findings earns by its worst one: low 8, medium or decision 6, high 3, blocker 0. The score is the share of points earned. Each open blocker caps it: one at 59, two at 49, three at 39. While any finding is open, except one marked won't fix, it stops at 99: 100 means nothing is left to fix. While a blocker is open, the panel also shows the score you reach once it is fixed. Area scores use the same rules within each area. This is SEO Supervisor's own score, not Google's: it counts only the rules this audit checked, and search engines don't use it.
