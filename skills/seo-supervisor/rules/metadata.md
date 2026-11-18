# Metadata (META)

### META-01 · Every indexable page has a unique title of a sensible length · high
- **Check:** crawler `title-missing`, `title-long`, `title-short`, `title-dup`, `title-multiple`.
- **Pass:** unique, about 30–60 characters (some projects allow 65), main keyword first, brand once at the end.
- **Fix:** a title pattern per page type in the profile, e.g. tool pages: "DMARC Checker - Free DMARC Record Lookup | Brand". Where pages compete for one phrase, give that phrase to one page and retitle the others (CONTENT-04).
- **Site-wide:** when the title is missing, or one title is shared, on at least 80% of indexable pages (and at least 3), the crawler reports one `*-sitewide` finding as a **blocker**, not one high per page. Keep it a blocker: it's the usual sign of a site with no SEO work.

### META-02 · Every indexable page has a unique meta description of 120–160 characters · medium
- **Check:** crawler `desc-missing`, `desc-length`, `desc-dup`.
- **Pass:** says what the visitor gets and why this page; no template text with a name swapped.
- **Fix:** add a description field to the content model, or generate one per page type from specific data, never from boilerplate.

### META-03 · All metadata comes from one helper · medium
- **Check:** crawler `title-brand-twice` (with `--brand`). Code: how pages set titles, canonicals, Open Graph and robots.
- **Pass:** one helper sets the title, description, canonical, Open Graph, Twitter card and robots. The title template doesn't double the brand.
- **Fix:** centralize it. When a page title already contains the brand, use an absolute title.

### META-04 · Open Graph and Twitter tags on every page; key pages get their own image · low
- **Check:** crawler `og-missing`. Code: does a per-page `openGraph` object replace the inherited image? (A common Next.js trap.)
- **Fix:** set a default image in the helper and generate images for key page types.
- **Crawler:** flags an `og:url` that differs from the page's canonical (`og-url-mismatch`).

### META-05 · The page language is declared · low
- **Check:** crawler `lang-missing`.
- **Fix:** set `<html lang>` in the root layout.

### META-06 · Robots meta depends on page type, using the object form · medium
- **Check:** code: robots values in the metadata helper.
- **Pass:** indexable pages are `index, follow` with `max-image-preview:large` and `max-snippet:-1`. Search, filter and result pages are `noindex, follow`. Account, admin, sign-in and 404 pages are `noindex, nofollow`.
- **Fix:** derive it from the page type. A plain string robots value can silently override the layout's richer object.
- **Crawler:** flags a page whose robots meta and `X-Robots-Tag` header disagree on indexing (`robots-conflict`, high). Search engines follow the stricter of the two.

### META-07 · Google Search Console and Bing Webmaster Tools are verified · medium
- **Check:** code: verification meta or DNS TXT (ask the owner if you can't tell).
- **Fix:** verify a Domain property by DNS; Bing can import it from Search Console. Never ship placeholder verification codes.

### META-08 · hreflang only when there are real language or region versions · low
- **Check:** code: `alternates.languages` or `<link rel="alternate" hreflang>`.
- **Pass:** each version lists all the others and itself, plus `x-default` (for language selectors and auto-redirecting home pages), with fully qualified URLs. Codes are ISO 639-1 language codes with an optional ISO 3166-1 region (`en-GB`); `UK`, `EU` and `es-419` are silently ignored. Each version canonicalizes to itself in the same language. Use one method only (HTML, header or sitemap).
- **Never:** auto-redirect by IP or `Accept-Language` (Googlebot usually crawls from the US with no `Accept-Language`). Use a banner suggesting the other version instead.
- **Fix:** remove one-sided or self-only hreflang that serves no purpose, unless the site deliberately targets one region.
- **Crawler:** checks return links, a self entry, `x-default`, valid ISO 639-1 language and ISO 3166-1 region codes (`en-uk` is invalid; it's `en-gb`), and targets that are 200, indexable and canonical. URLs are compared by path, so relative links and slash variants match.
