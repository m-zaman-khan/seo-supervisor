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
