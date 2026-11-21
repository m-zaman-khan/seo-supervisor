# URLs, canonicals and breadcrumbs (URL)

### URL-01 · One clean URL pattern per content type · high
- **Check:** crawler `url-format`. Code: route folders, slug generation.
- **Pass:** lowercase words joined by hyphens, using the words people actually search (`dmarc-checker`, `ssl-certificate-checker`, not `tool-17` or `dmarc-v2`). No IDs, dates, file extensions or version numbers in slugs. Each content type has a fixed prefix from the profile's URL map. Slugs are permanent; tools, guides and posts get linked from forums and docs for years.
- **Fix:** follow the profile's URL map. When a slug must change, 301 the old one (URL-07).
- **Unencoded links:** crawler `url-unencoded` (low) flags links whose path or query holds a space or a non-ASCII letter (`/my page/`, `/café/`). Google's URL structure guide asks for non-ASCII characters to be percent-encoded (`/caf%C3%A9/`). A non-ASCII host name is fine, and so are spaces around the address.

### URL-02 · One trailing-slash style, with the other variant redirecting · high
- **Check:** crawler `trailing-slash-mixed`, `slash-variant-no-redirect`, `slash-redirect-temporary`, `link-to-redirect`. Code: framework config (`trailingSlash` in Next.js), link helpers, canonical and sitemap builders.
- **Pass:** the profile names the style. Every page uses it, the other variant 301/308-redirects, and every internal link, canonical, sitemap `<loc>` and JSON-LD URL matches. Files keep no slash (`/sitemap.xml`, `/robots.txt`, `/llms.txt`).
- **Fix:** set it once in the framework, then fix the URL builders. Don't hand-edit links.
- **Temporary redirect:** `slash-redirect-temporary` (medium) flags the other variant redirecting with a 302, 303 or 307 on a staging or live server. Against a local dev server it's a note instead: dev servers often add the slash with a 302 (http-server does) where production doesn't.

### URL-03 · One host, HTTPS only · high
- **Check:** code: server/CDN config. Probe `http://` and the other `www` variant against production when you're allowed to.
- **Pass:** `http` and the non-preferred host 301 to `https://` plus the preferred host in one hop. Retired staging hosts redirect or sit behind auth.
- **Fix:** add the redirects at the edge (nginx, CDN or host settings).
- **Live check:** `--check-live` follows `http://` on the production host and flags no redirect (high) or more than one hop to HTTPS (medium). It also asks the other host (with or without `www`) for its `http://` and `https://` home page and one deeper page: `host-not-redirected` (high) when it shows the site itself, so every page exists twice; `host-redirect-hops` (medium) for more than one hop (an `http://` to `https://` step on the same host first is allowed, as HSTS preloading requires); `host-redirect-drops-path` (medium) when the deeper page lands on the home page. `redirect-temporary` (medium) flags a 302, 303 or 307 on any of these redirects, the http→https one included. An other host that doesn't resolve or answer is fine: the site has one host. Before launch it's listed under Limits, and so it is while the production host doesn't resolve.

### URL-04 · Every indexable page has a self-referencing, absolute canonical · high
- **Check:** crawler `canonical-missing`, `canonical-multiple`, `canonical-not-self`, `canonical-query`, `canonical-origin`, `canonical-bad-target`. Code: the metadata helper.
- **Pass:** exactly one canonical, absolute, on the production origin, with the right slash style and no query string, pointing at a 200 page. Variants (parameters, prefill links, product variants) canonicalize to the master page.
- **Fix:** build canonicals from the clean path plus one base-URL setting. Never build them from the request URL, which leaks `?utm_` tags.
- **After a fix:** Google may keep pages in a duplicate cluster for up to two weeks after the fix ("Fix canonicalization issues", Google Search Central), so URL Inspection can still show the old canonical for a while. Don't change the canonical again in the meantime.
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
- **Crawler:** with `--urls` (old site URLs) or `--next-manifest`, each old URL is tested with and without its trailing slash: `redirect-broken` (high) when it ends in an error, `redirect-chain` (CRAWL-08) for more than one hop, and `old-url-temporary` (medium) for a 302, 303 or 307. A hop that only adds or drops the trailing slash is left to URL-02.
- **Linked pages that broke:** `scripts/links-import.mjs --crawl seo-audit/seo-crawl.json` matches the pages other sites link to (Search Console's Top linked pages, Bing's linked pages) with the crawl by path. One that returns 404 or 410, redirects in a loop, or redirects to the home page (Google: "might be treated as a soft 404 error") is `linked-page-broken` (medium); the home page's own other addresses (`/index.html`, `/home`, a bare language prefix like `/en/`) are left out. Fix: a 301 to the closest live page. Linked pages the crawl didn't reach aren't judged: pass them to the crawler with `--urls`, which records the ones that fail or redirect in the crawl's errors and redirects, and run links-import again.

### URL-08 · Pagination is crawlable and self-canonical · medium
- **Check:** crawler pages with `?page=` or `/page/N/`. Code: list components.
- **Pass:** page 2 and beyond are reachable through real `<a href>` links. Each page is indexable with a canonical to itself, not to page 1. Sort-order variants canonicalize to the unsorted page.
- **Fix:** render real pagination links and per-page canonicals.

### URL-09 · Every content item has one primary parent · medium
- **Check:** code: content model.
- **Pass:** where URLs are flat but breadcrumbs show a category or topic, every item has exactly one required primary category or topic. Changing it changes the breadcrumb, never the URL.
- **Fix:** add a required `primaryCategory` (or similar) field.
