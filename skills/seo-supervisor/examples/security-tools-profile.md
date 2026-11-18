# SEO profile: Security tools and services site (example)

<!-- A finished profile: a cybersecurity company with free public tools, guides and penetration-testing services.
     "Brand" and example-security.com are placeholders. -->

Last reviewed: 2026-11-17 · Owner: Head of web

## Site
- **Production origin:** https://example-security.com
- **Staging / previews:** noindex header + password on every non-production deployment
- **Framework:** Next.js App Router; tools served by a separate API
- **Site types:** tools · content · services
- **Brand in titles:** "Brand", template `%s | Brand`
- **Content source:** tool registry served by the API (`/v1/tools`), CMS for blog, learn, templates, checklists and glossary

## Decisions
| Decision | Value | Why |
| --- | --- | --- |
| Trailing slash | **always** | Agreed URL map; `trailingSlash: true` |
| Preferred host | apex | |
| AI crawlers | allow all | Citations in AI answers are distribution for a free-tools brand |
| Staging protection | noindex header + auth | |
| Sitemap lastmod | content `updatedAt` | |
| Pagination | `?page=N`, self-canonical | |
| Thin browse pages | noindex below 3 items | |
| Scan results | shown on the tool page; share links `/r/{id}/` noindex and expire | |
| Platform pages | live only when the feature works | |
| FAQ schema | only where the FAQ is visible | No Google rich result since May 2026; Bing and AI engines still read it |

## URL map
| Pattern | Page type | Breadcrumb | Indexable | Schema |
| --- | --- | --- | --- | --- |
| `/resources/` | Hub | Home › Resources | yes | CollectionPage, ItemList |
| `/blog/` | Hub | Home › Resources › Blog | yes | CollectionPage, ItemList |
| `/blog/{post}/` | Post | Home › Resources › Blog › {Category} › {Post} | yes | BlogPosting |
| `/blog/{category}/` | Browse | Home › Resources › Blog › {Category} | 3+ posts | CollectionPage |
| `/blog/{category}/{sub}/` | Browse | … › {Category} › {Sub} | 3+ posts | CollectionPage |
| `/learn/{guide}/` | Guide | Home › Resources › Learn › {Topic} › {Guide} | yes | Article |
| `/learn/{topic}/` | Browse | Home › Resources › Learn › {Topic} | 3+ guides | CollectionPage |
| `/tools/{tool}/` | Tool | Home › Resources › Tools › {Tool} | yes | WebPage, WebApplication (SecurityApplication), FAQPage |
| `/templates/{template}/` | Download | Home › Resources › Templates › {Template} | yes | DigitalDocument |
| `/checklists/{checklist}/` | Download | Home › Resources › Checklists › {Checklist} | yes | DigitalDocument |
| `/glossary/{term}/` | Term | Home › Resources › Glossary › {Term} | yes | DefinedTerm |
| `/compare/{comparison}/` | Comparison | Home › Compare › {Comparison} | yes | Article, ItemList |
| `/paths/{path}/` | Path | Home › Paths › {Path} | yes | WebPage, ItemList |
| `/penetration-testing/{target}/` | Service | Home › Penetration testing › {Target} | yes | Service |
| `/penetration-testing/sample-report/{target}/` | Sample report | … › Sample report › {Target} | yes | WebPage |
| `/compliance/{framework}/` | Service | Home › Compliance › {Framework} | yes | Service |
| `/solutions/{solution}/` | Service | Home › Solutions › {Solution} | yes | Service |
| `/pricing/` | Pricing | Home › Pricing | yes | Service + Offers |
| `/platform/{feature}/` | Product | – | only when live | – |
| `/r/{id}/` | Scan result | – | noindex | none |

"Resources" appears only in the breadcrumb, never in URLs. Every breadcrumb parent is a real page. Post and category slugs share `/blog/{slug}/`, and guide and topic slugs share `/learn/{slug}/`, so a unique check covers both.

## Hubs that must exist
`/resources/`, `/blog/`, `/learn/`, `/tools/`, `/templates/`, `/checklists/`, `/glossary/`, `/compare/`, `/paths/`, `/penetration-testing/`, `/penetration-testing/sample-report/`, `/compliance/`, `/solutions/`

## Noindex by design
Scan result links, internal search, browse pages under 3 items, account and sign-in.

## Internal linking
- **Up:** breadcrumb as in the map.
- **Across:** 3–6 tools from the same family, and 3–5 posts or guides from the same category or topic.
- **Forward / loops:** blog post → glossary → learn guide → tool → template or checklist → path → service page → back to posts and guides. Inside each tool family, "next check" links form a loop.

## Claims
- **Banned:** customer counts, certifications or awards not on the confirmed list, invented ratings.

## Accepted exceptions
| Rule | Where | Why accepted | Until |
| --- | --- | --- | --- |
| TRUST-01 is treated as high | whole site | A security brand must pass its own header checks | permanent |
