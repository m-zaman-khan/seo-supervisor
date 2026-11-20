# What each page type needs

A short checklist per page type, for planning a page, building one, or reviewing one by reading it. These are judgment checks, not crawler checks: each line points at the rule that has the details, the crawler check and the fix. A line that doesn't fit the site (no reviews, no physical address) is skipped, never filled with made-up data.

**Every page**, whatever its type:
- A unique title that says what the page is (META-01, META-09) and a unique description that doesn't open by repeating it (META-02).
- One H1 and no skipped heading levels (CONTENT-01, CONTENT-02).
- A self-referencing canonical (URL-04), a place in the sitemap (MAP-03) and no noindex unless it's meant to stay out (CRAWL-02).
- Its text in the server HTML, not added later by JavaScript (REND-01).
- A share image (META-04, MEDIA-03), and below the home page, a breadcrumb that matches its schema (URL-05, SCHEMA-07).
- Within three clicks of the home page, with descriptive link text (LINK-01, LINK-05).

## Home
- The first screen says who the business is, what it offers and for whom, in the searcher's words (CONTENT-06).
- The title names the brand and what it does, never just "Home" (META-01).
- Organization (or the most specific business type) and WebSite schema, once, in the root layout, with stable `@id`s (SCHEMA-02). A local business shows the same name, address and phone as everywhere else (LOCAL-05).
- Links to every hub and main section (LINK-01, LINK-07).
- A favicon search results can show (META-10).
- The hero image loads first and isn't lazy-loaded (PERF-03), and nothing covers the page on arrival (PERF-07).

## About
- Who's behind the site: real people, roles, credentials and how claims are made (TRUST-04, CONTENT-07).
- Only facts the owner has confirmed: no invented years, numbers, awards or badges (CONTENT-10, TRUST-05).
- Links to the team or author pages and to the contact page (TRUST-04).
- No second Organization block: it points at the root layout's `#organization` (SCHEMA-02).

## Contact
- Name, address and phone as text, identical to the Business Profile and the schema (LOCAL-05).
- On a phone, the number and the call or quote button are easy to reach, with no popup on load (LOCAL-08, PERF-07).
- One line by the form says what's stored and links to the privacy policy (TRUST-03).
- It's indexable and in the sitemap: people search for a business's contact details (CRAWL-02, MAP-03).

## Service
- One page per service intent, of the kind of page that ranks for it (SVC-01, INTENT-01).
- The answer first: what the service is, who it's for, what it costs or how pricing works (CONTENT-06, SVC-02).
- Proof on the page: case studies, sample work, credentials, real client logos with permission (SVC-02, TRUST-05).
- Service schema with `provider` pointing at `#organization` and `areaServed` (SVC-03, SCHEMA-03).
- Links up to the services hub, across to sibling services, and in from the guides and tools that prove the expertise (SVC-04, LINK-03).
- Its own words, not a template with one word swapped (CONTENT-04).

## Product
- Product schema built from live data: price, currency, stock, shipping and returns, matching what the page shows (SHOP-05, SCHEMA-04).
- One page for all variants, which point to it (SHOP-02); out-of-stock and discontinued products handled as SHOP-04 says.
- Ratings and reviews only when real ones are shown on the page (SHOP-06, SCHEMA-04).
- Real `<img>` product photos, described, at a sensible weight (MEDIA-01, MEDIA-02, PERF-08).
- A breadcrumb to its one primary category (SCHEMA-07, URL-09).
- Listed free through Google Merchant Center (SHOP-08).

## Category
- A place in a clear hierarchy: type, category, product (SHOP-01).
- Enough text to help someone choose, not only a grid (CONTENT-05).
- Links to every item, paginated, and items link back (LINK-07); pages 2 and on are crawlable and canonical to themselves (URL-08).
- Filters and sorting stay out of the index (SHOP-03, CRAWL-10).
- CollectionPage and ItemList in the order shown, plus BreadcrumbList (SCHEMA-03).
- Its URL can't clash with a product's (URL-06).

## Article
- The answer first, in the searcher's words, with tables or numbered steps where they help (CONTENT-06).
- A named author with an author page, and a visible date that changes only with real edits (CONTENT-07, BLOG-04, CONTENT-12).
- Original work, with sources for its claims; never scaled or rewritten from others (AI-04, CONTENT-10, BLOG-05, CONTENT-11).
- Article or BlogPosting schema with `author`, `datePublished`, `dateModified` and an image (SCHEMA-03).
- Links to its pillar page and related posts, and on to the matching service or tool (BLOG-01, LINK-03).
- Snippets aren't blocked, so it can appear in AI answers (AI-01).

## Location
- Only where the business really works, with content that's truly about that place (LOCAL-01, LOCAL-02).
- One city per page, in a consistent URL pattern (LOCAL-03, LOCAL-04).
- The same name, address and phone as the Business Profile, with the most specific LocalBusiness type in its schema (LOCAL-05, LOCAL-06).
- Every claim about the place is true: no invented local customers, reviews or addresses (LOCAL-07).
- Linked from the locations hub, and to the services offered there (LINK-03).
