# SEO profile: {Site name}

<!-- Copy to the project as docs/seo-profile.md. The seo-supervisor skill reads it before every audit.
     Facts here beat the skill's defaults. Keep it short and current. -->

Last reviewed: {YYYY-MM-DD} · Owner: {role}

## Site
- **Launch state:** live / pre-launch (whole site noindex until {sign-off}; switch: `{SITE_INDEXABLE}`)
- **Production origin:** https://www.example.com
- **Staging / previews:** https://staging.example.com (noindex header + password)
- **Framework:** {e.g. Next.js 16 App Router, Rails 8, Vite SPA}
- **Site types:** {tools · local-business · content · services · ecommerce}
- **Brand in titles:** "{Brand}", template `%s | {Brand}`
- **Content source:** {where titles, slugs, FAQs and publish flags live, e.g. `src/data/tools.ts`, Sanity, Postgres}

## Goals
Asked once, in setup or grow mode, in the owner's own words. Never guessed; "not sure" is a fine answer.
- **What the site is for:** {e.g. quote requests by phone, product sign-ups, ad revenue}
- **The number that shows it's working (KPI):** {e.g. quote calls from search each month} · measured in {GA4 event / Search Console clicks / the CRM}
- **Budget:** {who does the work: the agent and the owner only / a writer / an agency} · {money for content, tools or photos, or none}
- **Timeline:** {a launch date, a busy season, or no deadline}
- **Out of scope:** {e.g. no blog, no paid links, no new pages before the redesign}

## Decisions
| Decision | Value | Why |
| --- | --- | --- |
| Trailing slash | always / never | |
| Preferred host | apex / www | |
| AI crawlers | allow all / block training only / block all | |
| Staging protection | noindex header + auth | Disallow can still leak URLs |
| Sitemap lastmod | content `updatedAt` | |
| Pagination | `?page=N`, self-canonical | |
| Thin browse pages | noindex below {3} items | |
| FAQ schema | only where the FAQ is visible | No Google rich result since May 2026 |
| Title / description limits | ≤60 / 120–160 | |

## URL map
| Pattern | Page type | Breadcrumb | Indexable | Sitemap | Schema |
| --- | --- | --- | --- | --- | --- |
| `/` | Home | – | yes | yes | Organization, WebSite |
| `/{section}/` | Hub | Home › {Section} | yes | yes | CollectionPage, ItemList, BreadcrumbList |
| `/{section}/{item}/` | {type} | Home › {Section} › {Item} | yes | yes | {…} |
| `/search/` | Search | – | noindex | no | – |

## Hubs that must exist
{Every breadcrumb level and section landing page, e.g. `/resources/`, `/blog/`, `/tools/`.}

## Noindex by design
{Page types meant to stay hidden: internal search, filters, account, shareable results, thin browse pages.}

## Internal linking
- **Up:** {breadcrumb rule}
- **Across:** {siblings: how many, chosen by what}
- **Forward / loops:** {e.g. blog → glossary → guide → tool → template → path → service → blog}

## Claims
- **Confirmed (may be published):** {…}
- **Banned (never publish):** {…}

## Accepted exceptions
| Rule | Where | Why accepted | Until |
| --- | --- | --- | --- |

## Audiences
Only audiences the owner named, 1 to 4. Never invented personas. Used by the audience check (`audience.md`).

| Audience | What they come for | Key pages |
| --- | --- | --- |
| {Landlords} | {a fixed price for a gas safety certificate} | {/gas-safety/, /pricing/} |

## Connections
Which accounts belong to this site. IDs only: logins and keys stay in the settings folder, never here.
- **Settings client:** {acme} · for agencies: run every script with `SEO_SUPERVISOR_CLIENT=acme`, so this client's Google sign-in and keys stay in their own folder. Leave it out for a single site.
- **Search Console property:** {sc-domain:example.com} · `google.mjs fetch` picks the domain property, else the longest URL prefix; check it names this one.
- **Google Analytics 4 property:** {123456789} · passed as `google.mjs fetch --ga4-property 123456789`.
- **Bing Webmaster Tools site:** {https://www.example.com/}
- **Matomo site ID / PostHog project ID:** {…}

## Outside checks
**Outside checks:** {on / off} · asked {date}
On means the audit may send up to 10 public URLs to Google PageSpeed Insights, render up to 10 pages in headless Chrome (the site's own scripts run), and look up target phrases with the agent's web search.

## Target phrases
Only phrases with a recorded source. Never guessed; no invented volumes.

| Page | Phrase | Source |
| --- | --- | --- |
| {/pricing/} | {phrase} | {owner · Search Console page export, {date} · approved plan, {date}} |

## Topic clusters
Only clusters the owner confirmed (`strategy.md`, Topic clusters).

| Pillar | Posts | Confirmed |
| --- | --- | --- |
| {/guides/boilers/} | {/blog/boiler-pressure/, /blog/bleed-radiator/} | {owner, {date}} |
