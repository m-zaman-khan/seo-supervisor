# Structured data: JSON-LD (SCHEMA)

> Facts checked **16 Nov 2026** against Google Search Central. Verify again if this is more than about six months old.
> **Still earn Google rich results:** Breadcrumb, Software app (needs a real rating or review), Article, Organization, Profile page, Product / merchant listing, Review snippet, Local business, Event, Recipe, Video, Dataset, Q&A and discussion forum.
> **Gone:**
> - FAQ rich results (removed for every site on 7 May 2026)
> - HowTo (Sept 2023)
> - sitelinks search box / SearchAction (Nov 2024)
> - Book Actions, Course Info, ClaimReview, Estimated Salary, Learning Video, Special Announcement and Vehicle Listing (phased out from June 2025)
> - Practice Problem (Jan 2026)
>
> Leftover markup of these types is harmless dead weight. FAQPage is still valid schema that Bing and AI engines read, so keep it only where the FAQ is visible. Dataset markup now serves Dataset Search only.
>
> **Added recently:**
> - Offer `priceType` and `validForMemberTier`
> - loyalty programs
> - return and shipping policies at Organization level
> - Product `category`
> - VideoObject `creator`
> - new Discussion forum and Q&A properties
>
> **Reviews:** no fake or undisclosed incentivised reviews, on the page or in markup. Self-serving reviews in LocalBusiness or Organization markup never earn stars.
>
> **Not needed for AI search:** Google says no schema is required for AI Overviews or AI Mode.

### SCHEMA-01 · JSON-LD parses and comes from data · high
- **Check:** crawler `jsonld-invalid`. Code: the JSON-LD component.
- **Pass:** built with `JSON.stringify` from typed data, with `<` escaped (`<`) so no string can close the script tag. Never string templates. No relative URLs, staging hosts or `new Date()` dates.

### SCHEMA-02 · Organization (or the right business subtype) and WebSite, once, with stable `@id`s · medium
- **Check:** crawler `org-missing`, `website-missing`. Code: root layout.
- **Pass:** one node each, in the root layout: `https://site/#organization` and `https://site/#website`. Other nodes reference them by `@id` (`publisher`, `provider`, `isPartOf`) instead of repeating them. `sameAs` lists real profiles.

### SCHEMA-03 · Each page type carries the schema the profile assigns · medium
- **Check:** crawler `jsonld-none` and the `schema` list per page in `seo-crawl.json`, compared with the profile's schema column.

| Page type | Schema |
| --- | --- |
| Every page | Organization, WebSite (root layout) |
| Hubs, categories, browse pages | CollectionPage, ItemList (items in the order shown on the page), BreadcrumbList |
| Interactive tool | WebPage, WebApplication (`applicationCategory` from Google's list, e.g. `SecurityApplication`, `UtilitiesApplication`; `operatingSystem: "Any"`; Offer `price: "0"`), BreadcrumbList, FAQPage if visible |
| Article, guide, post | Article or BlogPosting with `author` (Person with author page), `datePublished`, `dateModified`, BreadcrumbList |
| Author page | ProfilePage, Person (`jobTitle`, `sameAs`, `knowsAbout`) |
| Service page | Service (`serviceType`, `provider` → `#organization`, `areaServed`), BreadcrumbList |
| Local business | The most specific LocalBusiness subtype with real NAP, `geo`, `openingHoursSpecification`, `sameAs` (Google profile) |
| Product | Product with Offer (merchant listing) or AggregateOffer (product snippet only), plus shipping, return policy and warranty when they apply |
| Glossary | DefinedTermSet on the glossary hub; DefinedTerm on each term page, pointing back with `inDefinedTermSet` |
| Comparison | Article, ItemList of the products compared (no ratings for anyone, yours included) |
| Path / guided sequence | WebPage, ItemList of the steps in order, each pointing to its guide, tool or template |
| Download (template, checklist) | CreativeWork or DigitalDocument with `name`, `description`, `encodingFormat`, `dateModified` |
| Sample report | WebPage, plus DigitalDocument when it's a download (client details redacted) |
| Pricing | Service or SoftwareApplication with one Offer per plan |
| Search, result and account pages | None |

CollectionPage, ItemList, DefinedTerm, CreativeWork and Service earn no Google rich result. Add them anyway: they tell Bing and AI engines what each page is. Full examples are in `examples/snippets.md`.

### SCHEMA-04 · Schema matches what the page visibly shows · blocker
- **Check:** crawler `faq-not-visible`, `rating-review`. Code: where FAQ, breadcrumb and rating schema come from.
- **Pass:** FAQPage is built from the same array that renders the visible FAQ, and BreadcrumbList from the same array as the visible trail. Ratings and reviews appear in schema only when real reviews are shown on that page. No self-serving Organization or LocalBusiness rating. No Organization rating attached to a WebApplication. Nothing imported, scraped or AI-rewritten is presented as a verified review.
- **Fix:** remove any rating that isn't sourced; that's a decision for the owner (`needs-decision`). Never invent one. Leaving the rating out keeps the markup valid; it just shows no stars. To earn stars honestly, collect ratings on the page (e.g. "Was this useful?"), show the average and count there, and build `aggregateRating` from that data. A fake rating can cost the whole site its rich results through a manual action.

### SCHEMA-05 · No schema kept for rich results that no longer exist · low
- **Check:** crawler `deprecated-schema`.
- **Fix:** remove HowTo and SearchAction, or keep them knowingly. Never promise these rich results.

### SCHEMA-06 · No visitor input in schema · high
- **Check:** code: tool results, search terms or form values flowing into JSON-LD.
- **Fix:** schema describes the page, never data a visitor typed in or a scanned domain.

### SCHEMA-07 · BreadcrumbList on every page below the home page · medium
- **Check:** crawler `breadcrumb-missing`, and URL-05.

### SCHEMA-08 · Every template is validated · medium
- **Check:** `scripts/schema-check.mjs` on the built pages or a local URL, offline (schema.org vocabulary, value shapes, Google's required and recommended properties; FAQPage structure only). Then one URL per template through Google's Rich Results Test. After launch, watch the enhancement reports in Search Console.
- Facts that must match the visible page: phone, email, address, prices, hours.
