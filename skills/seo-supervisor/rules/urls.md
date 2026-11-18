# URLs, canonicals and breadcrumbs (URL)

### URL-01 · One clean URL pattern per content type · high
- **Check:** crawler `url-format`. Code: route folders, slug generation.
- **Pass:** lowercase words joined by hyphens, using the words people actually search (`dmarc-checker`, `ssl-certificate-checker`, not `tool-17` or `dmarc-v2`). No IDs, dates, file extensions or version numbers in slugs. Each content type has a fixed prefix from the profile's URL map. Slugs are permanent; tools, guides and posts get linked from forums and docs for years.
- **Fix:** follow the profile's URL map. When a slug must change, 301 the old one (URL-07).

### URL-02 · One trailing-slash style, with the other variant redirecting · high
- **Check:** crawler `trailing-slash-mixed`, `slash-variant-no-redirect`, `link-to-redirect`. Code: framework config (`trailingSlash` in Next.js), link helpers, canonical and sitemap builders.
- **Pass:** the profile names the style. Every page uses it, the other variant 301/308-redirects, and every internal link, canonical, sitemap `<loc>` and JSON-LD URL matches. Files keep no slash (`/sitemap.xml`, `/robots.txt`, `/llms.txt`).
- **Fix:** set it once in the framework, then fix the URL builders. Don't hand-edit links.

### URL-03 · One host, HTTPS only · high
- **Check:** code: server/CDN config. Probe `http://` and the other `www` variant against production when you're allowed to.
- **Pass:** `http` and the non-preferred host 301 to `https://` plus the preferred host in one hop. Retired staging hosts redirect or sit behind auth.
- **Fix:** add the redirects at the edge (nginx, CDN or host settings).
- **Live check:** `--check-live` follows `http://` on the production host and flags no redirect (high) or more than one hop to HTTPS (medium). Before launch it's listed under Limits.

### URL-04 · Every indexable page has a self-referencing, absolute canonical · high
- **Check:** crawler `canonical-missing`, `canonical-multiple`, `canonical-not-self`, `canonical-query`, `canonical-origin`, `canonical-bad-target`. Code: the metadata helper.
- **Pass:** exactly one canonical, absolute, on the production origin, with the right slash style and no query string, pointing at a 200 page. Variants (parameters, prefill links, product variants) canonicalize to the master page.
- **Fix:** build canonicals from the clean path plus one base-URL setting. Never build them from the request URL, which leaks `?utm_` tags.
- **Site-wide:** when the canonical is missing on at least 80% of indexable pages (and at least 3), the crawler reports one `*-sitewide` finding as a **blocker**, not one high per page. Keep it a blocker: it's the usual sign of a site with no SEO work.

### URL-05 · Breadcrumbs are visible, match their schema, and every level is a real page · high
- **Check:** crawler `breadcrumb-dead-level`, `breadcrumb-missing`. Code: breadcrumb component and BreadcrumbList builder.
- **Pass:** one array renders both the visible trail and BreadcrumbList. Every level except the last is a live hub page. Levels that exist only in the breadcrumb (e.g. "Resources" with no URL prefix) still have a real page at their URL.
- **Fix:** create the missing hub pages, and share one breadcrumb source.

### URL-06 · Item slugs can't clash with browse pages · medium
- **Check:** code: where items and categories share a namespace (e.g. `/blog/{post}/` and `/blog/{category}/`).
- **Pass:** a unique check covers both item and category slugs in each shared namespace, enforced in the database or a build check. Words the site will need later (`page`, `feed`, `tag`, `search`, `category`) are reserved.
- **Fix:** add the constraint and rename any clash with a redirect.

### URL-07 · Renames redirect automatically · medium
- **Check:** code: redirect source. Look for a `redirectFrom` (or similar) field on content and a build check that fails when a slug changes without a redirect.
- **Pass:** redirects are generated from data, go to the final URL in one hop, and every target resolves.
- **Fix:** add the field and the build check. Never change the URL of a page that already gets search impressions unless the owner agrees.

### URL-08 · Pagination is crawlable and self-canonical · medium
- **Check:** crawler pages with `?page=` or `/page/N/`. Code: list components.
- **Pass:** page 2 and beyond are reachable through real `<a href>` links. Each page is indexable with a canonical to itself, not to page 1. Sort-order variants canonicalize to the unsorted page.
- **Fix:** render real pagination links and per-page canonicals.

### URL-09 · Every content item has one primary parent · medium
- **Check:** code: content model.
- **Pass:** where URLs are flat but breadcrumbs show a category or topic, every item has exactly one required primary category or topic. Changing it changes the breadcrumb, never the URL.
- **Fix:** add a required `primaryCategory` (or similar) field.
