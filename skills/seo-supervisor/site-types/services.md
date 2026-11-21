# Services, agencies and SaaS: money pages (SVC)

### SVC-01 · One page per service intent · high
Each service page targets one primary keyword that no other page targets. Merge thin, closely related services into one page. Service slugs are unique across the site. Never change the URL of a page that already gets impressions. Where the home page, a service page and a location page compete for one phrase, give the phrase to one of them and retitle the others.

### SVC-02 · Proof on the page · high
Case studies, sample reports or deliverables, real client logos (with permission), process, pricing or how pricing works, credentials, and FAQs. Sections with no real data are hidden rather than filled with placeholders; carry a cost keyword in an FAQ instead of a fake price table. Sample reports are redacted.

### SVC-03 · Service schema · medium
Service with `serviceType`, `provider` → `#organization`, `areaServed`, `url`, and `hasOfferCatalog` for sub-services. Pricing pages use one Offer per plan with real prices. No ratings unless real reviews are shown on that page.

### SVC-04 · Paths into the money pages · high
Every free resource (guides, tools, templates, comparisons, glossary) has a next step that leads to the matching service, and service pages link back to the resources that prove expertise (LINK-03). Sibling services link both ways.

### SVC-05 · Comparison pages are fair · high
"Best X" and "X vs Y" pages need real criteria, a dated review, a disclosure that you're one of the options, and no invented scores or ratings for anyone (yours included) in copy or schema. Use Article + ItemList.

### SVC-06 · Product and feature pages only for what exists · blocker
Platform or feature pages go live only when the feature works. Until then they return 404 and appear in no nav, sitemap or link (CRAWL-11).

### SVC-07 · Navigation · medium
Mega-menu column headings are real links, panels stay under about 600 px tall, long lists end with an "All … →" link, there's no hidden duplicate mobile menu in the DOM, and programmatic pages (service × city) stay out of the nav.

### SVC-08 · How to build "X vs Y", "alternatives to X" and "best X" pages · medium
Build them only for competitors the owner names and comparisons people actually search for. Every competitor fact comes from the competitor's own public pages, linked, with the date it was checked. Until the owner confirms a fact, it's `needs-decision` and the page stays unpublished. The brief for one of these pages adds a matrix, a phrase plan and the gaps in rival comparisons (`strategy.md`, Comparison briefs).
- **Phrases people search:** "X vs Y", "X vs Y pricing", "is X better than Y", "X alternatives", "X review" and "best X for [use case]". Use only phrases with a recorded source (`strategy.md`). Check what ranks for each (INTENT-01) before giving it its own page: often it fits as a section of a page that already exists.
- **Titles and H1:** patterns, not fill-ins; the words come from what the page really says.
  - "X vs Y: {the main difference, in a few words}"
  - "X alternatives: {how many} options for {who}"
  - "Best {category} for {use case}"
  - "X review: {what was tested}", only for a real review by someone who used it
  - The H1 says the same in plain words and may drop the brand.
- **"X vs Y":**
  - Open with a short verdict ("Choose X if…, choose Y if…").
  - Then a table of the criteria a buyer weighs: price as of a date, main features, limits, support, who each suits.
  - Then a section per criterion that says plainly where the competitor wins. Pages that only praise their author read as ads and don't get cited.
  - End with notes on switching between the two, and FAQs.
- **"Alternatives to X":**
  - Start with why people look for alternatives, from reviews or forums the owner points to.
  - Then each option with who it's best for, its price as of a date, and one honest drawback. Yours is labelled as yours (SVC-05).
- **"Best [category]" round-ups and multi-product tables:**
  - Say on the page how the products were chosen and judged, and include only products someone really used or tested, or say plainly how each was judged.
  - Each entry gives who it's best for, its price as of a date, its benefits and a real drawback, and evidence of use such as screenshots or test results.
  - Google's review guidance asks for these (Google, "How to write reviews", developers.google.com/search/docs/specialty/ecommerce/write-high-quality-reviews, checked 21 Nov 2026): "Discuss the benefits and drawbacks"; "Provide evidence such as visuals, audio, or other links of your own experience"; "Ensure there is enough useful content in your ranked lists for them to stand on their own".
  - The table is a real `<table>`: one row per product, a column per criterion, header cells, and prices with their date. A value the owner hasn't confirmed stays `[owner: …]`.
  - Your own product is labelled as yours, and placing it first needs the same evidence as any other (SVC-05). Never invent scores, ranks or ratings.
  - Where a product is sold in several places, Google suggests linking to more than one seller.
- **Calls to action:** one after the opening verdict, one after the table, and one at the end. Never inside a competitor's section, and never dressed up as a neutral link.
- **Prices:** compare the full cost a buyer pays, as of a date: the plan price and billing period, setup or onboarding fees, per-seat or usage charges, add-ons needed for the compared feature, and the price after any first-year discount. Show hidden costs for your own product too.
- **Ratings from review sites:** quote them only as text, with a link to the source and the date, such as "4.5 on G2 (21 Nov 2026)". Never copy them into schema: Google's review snippet rules say "Don't aggregate reviews or ratings from other websites" (developers.google.com/search/docs/appearance/structured-data/review-snippet). Never round a rating up.
- **Paid links:** if the site earns from a link, the page says so. Ads and paid placements carry `rel="sponsored"` (Google, "Qualify your outbound links").
- **Years and re-checks:** a year goes in the title only if someone updates the page every year. `dateModified` changes only when the content does. Re-check the facts on a schedule the owner sets, and whenever a competitor changes its prices (SVC-09).
- **Names and logos:** use competitors' names as plain words. Don't use their logos or anything else that suggests they endorse the page.
- **Schema:** Article (or WebPage) plus an ItemList of the options. Don't add Product or AggregateRating for a competitor, or for yourself, unless real reviews are shown on that page.
- **Links:** link the page from the matching service and pricing pages, and give it a next step into the matching service (SVC-04).

### SVC-09 · SaaS: watch competitors, and keep product facts right for AI answers · low
For a SaaS with comparison pages. It goes beyond SVC-08's re-check. The owner names the competitors and decides how often. It visits their sites, so it needs the `competitors` yes (`strategy.md`, Competitor analysis).
- **What to watch for each competitor:** the pricing page (plans, prices, limits, the free tier), feature and integration pages, release notes, their own comparison pages that name this product, and new pages that show for the site's target phrases.
- **What changed:** compare with the last `seo-audit/competitors.md` and list each change with its link and date. A change that makes one of the site's pages wrong is a to-do for the owner. The page stays as it is until the owner confirms the new fact (SVC-08).
- **Product facts in AI answers:** AI search tools repeat what they find, so check:
  - Prices, plan limits, integrations and supported platforms are text in the HTML the server sends (REND-01), not only in images, a pricing calculator or tabs that load later.
  - The pricing page, the docs, the comparison pages and the schema take these facts from one source, so no page says something different.
  - AI search crawlers are allowed or blocked on purpose (AI-02), and key pages can be quoted in AI answers (AI-01).
  - What other sites say about the product, including old prices and features, comes from the off-site lookup (AI-06).
  - Nothing is written for AI systems instead of people (AI-04, CONTENT-11).

Report what you find as owner decisions or notes. Nothing here is a measured finding.
