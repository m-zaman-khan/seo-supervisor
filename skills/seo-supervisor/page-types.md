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
- ContactPage and BreadcrumbList schema. The name, address and phone stay in the root layout's Organization node (SCHEMA-03).

## Service
- One page per service intent, of the kind of page that ranks for it (SVC-01, INTENT-01).
- The answer first: what the service is, who it's for, what it costs or how pricing works (CONTENT-06, SVC-02).
- Proof on the page: case studies, sample work, credentials, real client logos with permission (SVC-02, TRUST-05).
- Service schema with `provider` pointing at `#organization` and `areaServed` (SVC-03, SCHEMA-03).
- Links up to the services hub, across to sibling services, and in from the guides and tools that prove the expertise (SVC-04, LINK-03).
- Its own words, not a template with one word swapped (CONTENT-04).

## Product
- The product's name as the H1, with H2 sections for what applies (SHOP-09).
- Specs in a table; a size guide and care details where they apply (SHOP-09).
- A meta description with the price, or "from £X" (SHOP-09, META-02).
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

## Comparison ("X vs Y", "alternatives to X", "best X")
- Only competitors the owner names, and only facts from their own pages, linked and dated (SVC-05, SVC-08).
- A short verdict first, then the table, then a section per criterion that says where each one wins (CONTENT-06, SVC-08).
- Full prices as of a date, hidden costs included, and ratings from review sites as linked text, never in schema (SVC-08).
- Calls to action after the verdict, after the table and at the end, never inside a competitor's section (SVC-08).
- Article (or WebPage) and ItemList schema, with no invented scores or ratings (SVC-05, SCHEMA-04).

## Case study
Real work for a real client, published with the client's permission. Never invent a client, a number or a quote (CONTENT-10, TRUST-05). Skip any part the owner has no facts for. This is a common order, not a template; follow what the story needs:
1. The result first, in one line: what changed, measured, and over what period.
2. The client: who they are. Their name and logo only with permission.
3. The challenge, in the client's terms.
4. The approach: what was done, and by whom.
5. The measured results: how they were measured, and the period. Before and after only from real data (CONTENT-10).
6. The timeline.
7. A testimonial in the client's own words, with their name, role and permission. It's never rewritten (`rewrite.md`).
8. A next step into the matching service (SVC-04).

Don't mark the testimonial up as a Review to win stars: Google treats reviews a business controls about itself as self-serving, and those pages are "ineligible for star review feature" (Google's review snippet docs; SVC-03, SCHEMA-04).

## Hybrid (service plus education)
For a phrase whose results mix guides and service pages (`strategy.md`, INTENT-01).
- The offer first, briefly: what the service is, who it's for, the price or how pricing works, and the next step (CONTENT-06, SVC-02).
- Then the teaching part: the questions searchers ask, each answered fully, with sources for facts (CONTENT-06, CONTENT-10).
- Calls to action after the offer and at the end, not in every section.
- A named writer or reviewer with credentials, since the teaching is advice (CONTENT-07).
- Service schema for the offer (SVC-03). No schema for content the page doesn't show (SCHEMA-04).
- One page, not a service page and a guide competing for the same phrase (INTENT-02).

## Language or region version
Read each version as a local customer would. The crawler checks hreflang and untranslated main text (META-08); these it can't:
- **Money:** prices in that market's currency, written the local way.
- **Units:** metric or imperial, and sizes (clothing, paper) as that market uses them.
- **Dates, times and numbers:** the local format (21/11/2026 or 11/21/2026; 1,000.50 or 1.000,50).
- **Local law:** the privacy and cookie notices, returns, warranty and claims fit that country. Legal text is the owner's (or their lawyer's): flag it, never write it.
- **Brands and examples:** products, payment methods, carriers and examples that exist in that market, not ones only the home market knows.
- **Untranslated bits:** buttons, form labels and error messages, alt text, the title and description, schema text, and the emails the site sends. `untranslated-copy` covers only the main text.
- **Contact:** a local phone number and address where the business has one.

Report what's wrong as owner items with `fixBy: "owner"`. Never machine-translate (SKILL.md fix step 12).

**Targeting a country.** Google says country-code domains (`example.de`) "provide a strong signal to both users and search engines that your site is explicitly intended for a certain country". A `.com` with a folder per country (`/de/`) works too. Other signals Google names: local addresses and phone numbers, the local language and currency, links from other local sites, and a Business Profile. Google ignores locational meta tags. hreflang does a different job: it tells Google which version suits which language or region, and Google still uses it. Search Console's country setting is gone: "The International Targeting report has been deprecated", and its country targeting "is no longer supported". Sources: Google's "Managing multi-regional and multilingual sites" (developers.google.com/search/docs/specialty/international/managing-multi-regional-sites) and Search Console Help, "The International Targeting report is deprecated" (support.google.com/webmasters/answer/12474899), both checked 21 Nov 2026.

**Google features that show only in some regions** (Google's "Regional differences in Search experience", developers.google.com/search/docs/appearance/aggregator-features, checked 21 Nov 2026):
- **EEA:** aggregator and supplier units for hotels, flights, ground transport, local businesses, things to do and products; structured data carousels, which need structured data markup; job sites features; and an "ecosystem carousel" next to weather, sports, finance and translate answers.
- **Türkiye:** places sites features, with links to aggregator sites for hotels and local businesses, and structured data carousels for hotels, local businesses and vacation rentals.
- **South Africa:** a badge and refinement chip for South African businesses on some kinds of searches, and structured data carousels.

Results checked from one country can look different from another, so record the market with the results (`strategy.md`). Never promise one of these features outside its region.
