# Structured data: JSON-LD (SCHEMA)

> Facts checked **16 Nov 2026** against Google Search Central (Book actions **19 Nov 2026**). Verify again if this is more than about six months old.
> **Still earn Google rich results:** Breadcrumb, Software app (needs a real rating or review), Article, Organization, Profile page, Product / merchant listing, Review snippet, Local business, Event, Recipe, Video, Dataset, Q&A and discussion forum, Course list, Education Q&A, Employer aggregate rating, Image metadata, Job posting, Math solver, Movie, Paywalled content, Vacation rental, Speakable (beta) and carousels. The full list, with each type's required properties and the date it was checked against Google's search gallery, is in `scripts/data/google-rich-results.json`.
> **Gone:**
> - FAQ rich results (removed for every site on 7 May 2026)
> - HowTo (Sept 2023)
> - sitelinks search box / SearchAction (Nov 2024)
> - Course Info, ClaimReview, Estimated Salary, Learning Video, Special Announcement and Vehicle Listing (phased out from June 2025)
> - Practice Problem (Jan 2026)
>
> **Book actions** were announced for phase-out in June 2025, but Google removed that notice on 5 Nov 2025 because a Search feature still uses the markup. It's live, and open only to book providers Google accepts as partners.
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
> **Sale dates (merchant listings):** a sale is the active price plus a second price marked `priceType: "https://schema.org/StrikethroughPrice"`. Give the sale's start in `validFrom` and its end in `validThrough` or `priceValidUntil`, in ISO 8601 with a time and timezone (`2026-11-30T23:59:59+00:00`), the start no later than the end. On the Offer they apply when its `price` is the sale price; on a UnitPriceSpecification use `validFrom` and `validThrough` (`priceValidUntil` doesn't apply there). A `priceValidUntil` in the past can stop the listing showing. Source: Google's merchant listing doc, checked 21 Nov 2026.
>
> **Reviews:** no fake or undisclosed incentivised reviews, on the page or in markup. Self-serving reviews in LocalBusiness or Organization markup never earn stars.
>
> **Not needed for AI search:** Google says no schema is required for AI Overviews or AI Mode.
>
> **Not a ranking factor:** schema makes a page eligible for rich results and tells engines what it is, but it doesn't move a page up. "Structured data won't make your site rank better" (John Mueller, Google, April 2025), and Google's general structured data guidelines say markup "does not guarantee" a rich result. Never promise rankings from it.

### SCHEMA-01 · JSON-LD parses and comes from data · high
- **Check:** crawler `jsonld-invalid`, `schema-placeholder` (high: template text such as `[Business Name]`, `[Phone]` or a `REPLACE_` token in the JSON-LD; `schema-check.mjs` reports it as `placeholder`) and `schema-image-broken` (medium: an `image`, `logo` or `thumbnailUrl` on the crawled site that answers with an error or a web page; up to 50 are fetched, and images on other hosts aren't). Code: the JSON-LD component.
- **Pass:** built with `JSON.stringify` from typed data, with `<` escaped (`<`) so no string can close the script tag. Never string templates. No relative URLs, staging hosts or `new Date()` dates.
- **Microdata and RDFa:** the crawler records their types (`itemtype`, `typeof`) per page as `schemaOther`, and they count as structured data for SCHEMA-02, SCHEMA-03 and SCHEMA-07. A page with only Microdata or RDFa gets `schema-not-jsonld` (low): Google reads them, but recommends JSON-LD, and the crawler and `schema-check.mjs` validate JSON-LD only.

### SCHEMA-02 · Organization (or the right business subtype) and WebSite, once, with stable `@id`s · medium
- **Check:** crawler `org-missing`, `website-missing`, and `site-identity-differs` (low): an indexable page whose top-level Organization (or business) or WebSite node has the `@id` most pages use but another name, or that name with another `@id` (the site's value is the `@id` on the most pages, at least 2, ahead of any other). A node that only references the `@id`, without a name, is fine; one sharing neither `@id` nor name is another organization (a partner, a client) and isn't judged; without `@id`s nothing is flagged. Code: root layout.
- **Pass:** one node each, in the root layout: `https://site/#organization` and `https://site/#website`. Other nodes reference them by `@id` (`publisher`, `provider`, `isPartOf`) instead of repeating them. `sameAs` lists real profiles.
- **Business type:** crawler `schema-too-generic` (medium) when the home page's title or H1 plainly names one kind of business but the schema says only `LocalBusiness`, `Organization` or another broad parent; it names the specific type from `scripts/data/business-types.json`, since Google asks for "the most specific LocalBusiness sub-type possible". Two kinds named alike give `business-type-unclear` (needs-decision), and words only in the body text, in post teasers or on other pages raise nothing.

### SCHEMA-03 · Each page type carries the schema the profile assigns · medium
- **Check:** crawler `jsonld-none` (no JSON-LD, Microdata or RDFa at all) and the `schema` list per page in `seo-crawl.json` (plus `schemaOther` for Microdata and RDFa), compared with the profile's schema column.

| Page type | Schema |
| --- | --- |
| Every page | Organization, WebSite (root layout) |
| Hubs, categories, browse pages | CollectionPage, ItemList (items in the order shown on the page), BreadcrumbList |
| Interactive tool | WebPage, WebApplication (`applicationCategory` from Google's list, e.g. `SecurityApplication`, `UtilitiesApplication`; `operatingSystem: "Any"`; Offer `price: "0"`), BreadcrumbList, FAQPage if visible |
| Article, guide, post | Article or BlogPosting with `author` (Person with author page), `datePublished`, `dateModified`, BreadcrumbList |
| Author page | ProfilePage, Person (`jobTitle`, `sameAs`, `knowsAbout`) |
| Service page | Service (`serviceType`, `provider` → `#organization`, `areaServed`), BreadcrumbList |
| Local business | The most specific LocalBusiness subtype with real NAP, `geo` (latitude and longitude to at least 5 decimal places), `openingHoursSpecification`, `priceRange` if it has one (under 100 characters, such as `$10-15` or `$$`), `sameAs` (Google profile) |
| Contact page | ContactPage, BreadcrumbList. The name, address and phone stay in the root layout's Organization node (`#organization`), not in a second copy |
| Product | Product with Offer (merchant listing) or AggregateOffer (product snippet only), plus shipping, return policy and warranty when they apply |
| Brand page | CollectionPage with `about` → Brand (`name`, `logo`), ItemList, BreadcrumbList |
| Glossary | DefinedTermSet on the glossary hub; DefinedTerm on each term page, pointing back with `inDefinedTermSet` |
| Comparison | Article, ItemList of the products compared (no ratings for anyone, yours included) |
| Path / guided sequence | WebPage, ItemList of the steps in order, each pointing to its guide, tool or template |
| Download (template, checklist) | CreativeWork or DigitalDocument with `name`, `description`, `encodingFormat`, `dateModified` |
| Sample report | WebPage, plus DigitalDocument when it's a download (client details redacted) |
| Pricing | Service or SoftwareApplication with one Offer per plan |
| SaaS home and feature pages | SoftwareApplication (WebApplication for an app that runs in the browser) with `name`, `applicationCategory`, `operatingSystem` and `offers`, once, on the home page, with a stable `@id` (`https://site/#app`) and `publisher` → `#organization`. Feature pages: WebPage with `about` → `#app`, BreadcrumbList. Google shows the app result only with a real rating (SCHEMA-04) |
| SaaS docs and help articles | TechArticle (schema.org's Article type for technical docs) with `dateModified`, BreadcrumbList. Google's article docs name only Article, NewsArticle and BlogPosting |
| Case study | Article with `about` → the customer (an Organization) and `mentions` → the product or service by `@id`, BreadcrumbList. No Review or rating: a customer story isn't a review (SCHEMA-04) |
| Search, result and account pages | None |

CollectionPage, ItemList, DefinedTerm, CreativeWork, ContactPage and Service earn no Google rich result. Add them anyway: they tell Bing and AI engines what each page is. Full examples are in `examples/snippets.md`.

### SCHEMA-04 · Schema matches what the page visibly shows · blocker
- **Check:** crawler `faq-not-visible`, `rating-review`, and `rating-self-serving` (low): a rating or review of the site's own business, on its Organization or LocalBusiness node or in a Review naming it in `itemReviewed`. The site's own business is the business at the top of the home page's schema, matched on other pages by `@id` or name. Google's review snippet guide (updated 8 Sep 2026, read 22 Nov 2026): when a business "controls the reviews about itself", its pages that use LocalBusiness or any other Organization structured data are "ineligible for star review feature", markup and embedded review widgets alike. Code: where FAQ, breadcrumb and rating schema come from.
- **Pass:** FAQPage is built from the same array that renders the visible FAQ, and BreadcrumbList from the same array as the visible trail. Ratings and reviews appear in schema only when real reviews are shown on that page. No self-serving Organization or LocalBusiness rating. No Organization rating attached to a WebApplication. Nothing imported, scraped or AI-rewritten is presented as a verified review.
- **Fix:** remove any rating that isn't sourced; that's a decision for the owner (`needs-decision`). Never invent one. Leaving the rating out keeps the markup valid; it just shows no stars. To earn stars honestly, collect ratings on the page (e.g. "Was this useful?"), show the average and count there, and build `aggregateRating` from that data. Google recommends accepting only ratings that come with a review comment and the author's name: not required, but it shows readers why (review snippet docs, added 15 Jan 2025). A fake rating can cost the whole site its rich results through a manual action.

### SCHEMA-05 · No schema kept for rich results that no longer exist · low
- **Check:** crawler `deprecated-schema`, and `scripts/schema-check.mjs` warns `type-retired` with Google's source, for each type in the `retired` list of `scripts/data/google-rich-results.json`: HowTo (Sept 2023), SearchAction (the sitelinks search box, Nov 2024), and SpecialAnnouncement and a top-level Occupation (estimated salary), phased out from June 2025.
- **ClaimReview** lost its rich result in June 2025, but it's marked `keep`, because Google's Fact Check Explorer still reads it. It gets an information note (`type-kept`), never a finding, so fact-checkers aren't told to remove it.
- Types are matched exactly, so a Recipe, a kind of HowTo in schema.org, isn't flagged.
- **Deprecated in schema.org:** `Attorney`, which schema.org replaced with `LegalService` (https://schema.org/Attorney), gets crawler `schema-superseded` (low) and a `type-superseded` warning from `schema-check.mjs`, in JSON-LD, Microdata or RDFa. The fix is a one-word change.
- **Search Console and the Rich Results Test no longer report retired types:** Google dropped them from both as it retired them (How-to in Oct 2023, the sitelinks search box in Nov 2024, the June 2025 types from Sept 2025, practice problems from Jan 2026). A clean enhancement report says nothing about this markup; the crawler and `schema-check.mjs` still see it.
- **Not flagged:** FAQPage, which Bing and AI engines still read: keep it where the FAQ is visible (SCHEMA-04). Course info, learning video, vehicle listing and practice problem results are gone too, but their types (Course, VideoObject, Quiz, Car) still serve live results or describe the item to other engines.
- **Online-only events (`event-online`, low; schema-check warning):** Event markup with `OnlineEventAttendanceMode` and no real place, or only a `VirtualLocation`. Google removed the online event properties on 5 Jun 2025: its event results need a physical location. Harmless; keep it knowingly.
- **Fix:** remove the markup, or keep it knowingly: it does no harm. Never promise these rich results.

### SCHEMA-06 · No visitor input in schema · high
- **Check:** code: tool results, search terms or form values flowing into JSON-LD.
- **Fix:** schema describes the page, never data a visitor typed in or a scanned domain.

### SCHEMA-07 · BreadcrumbList on every page below the home page · medium
- **Check:** crawler `breadcrumb-missing`, and URL-05.
- **Desktop only:** since January 2025 Google shows breadcrumbs in desktop results only; on phones the result shows just the domain (Search Central blog, 23 Jan 2025). Keep the markup: Google still uses it on desktop, and the Search Console report and the Rich Results Test still cover it.

### SCHEMA-08 · Every template is validated · medium
- **Check:** `scripts/schema-check.mjs` on the built pages or a local URL, offline: the schema.org vocabulary, value shapes, and Google's required and recommended properties for every rich-result type in its search gallery (`scripts/data/google-rich-results.json`, with the date it was checked; FAQPage structure only). JSON-LD with template tags (`{{`, `{%`, `<%`) is a note to check the built output; ProductGroups and Products nested as `isSimilarTo`, `itemOffered` or `itemReviewed` don't need offers. It also reports a top-level item with no `@type` and any empty `@type` (errors; an untyped nested value or a bare `@id` reference is fine), and warns when a business's `latitude` or `longitude` has fewer than 5 decimal places (`value-geo`; Google's local business and vacation rental docs) or its `priceRange` is 100 characters or more (`value-price-range`; Google then shows no price range). Then one URL per template through Google's Rich Results Test. After launch, watch the enhancement reports in Search Console. It also warns when a review or rating nested through `review` or `aggregateRating` names a different item in `itemReviewed` (`review-target-conflict`; the crawler reports it under SCHEMA-01): Google says to leave `itemReviewed` out of a nested review, and since 12 Nov 2025 to avoid saying what's reviewed in more than one way.
- **What it never asks for:** recommended lists leave out what Google marks "if applicable" and every rating. A software app with no rating or review is a note (`rating-missing`), not an error, because Google shows the result only with one and it must come from real reviews shown on the page (SCHEMA-04).
- **Copy-ready code:** the "Google rich results" section of `examples/snippets.md` has one snippet per type, each passing `schema-check.mjs`.
- Facts that must match the visible page: phone, email, address, prices, hours.
- **Refresh:** when the data file's `checked` date is more than about six months old, re-read the search gallery and each feature's page.
