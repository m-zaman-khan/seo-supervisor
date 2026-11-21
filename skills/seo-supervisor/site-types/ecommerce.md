# E-commerce and catalogues (SHOP)

### SHOP-01 · A clear catalogue hierarchy · high
Type → category → product (master) → variant. Distinct prefixes for listing and product URLs, with a guard against slug clashes. Normalise tokens (`128gb`, `1tb`) and keep a fixed token order per product class, with full brand names. Modifiers like "refurbished" go in the title, not the URL.

### SHOP-02 · Variants consolidate to the master · high
Variant pages are reachable through crawlable `<a href>` links, are `index,follow`, canonicalize to the master, and stay out of the sitemap. Condition or grade is a query parameter, never a path. An unknown suffix 301s to the master. If the picker falls back to another option, the URL follows (302 to the variant actually shown).

### SHOP-03 · Faceted navigation doesn't explode the index · blocker
Only facets that people search (brand, series, sometimes a key attribute) get indexable, self-canonical pages with their own copy. Colour, price, sort and combinations get `noindex,follow` plus a canonical to the clean listing. Pagination stays indexable and self-canonical.

### SHOP-04 · Stock and lifecycle · high
| Situation | What to do |
| --- | --- |
| One SKU out of stock | Grey it out; the page stays indexed. |
| Whole model out of stock | The page stays live with "notify me". |
| Replaced by a successor | 301 to the successor. |
| Gone for good | 410, and remove it from the sitemap. |

### SHOP-05 · Product schema from live data · high
Product with an Offer (`price`, `priceCurrency`, `availability`, `itemCondition`) for merchant listings; `AggregateOffer` only qualifies for product snippets. Add `MerchantReturnPolicy` (country, return window, days, method, fees) and shipping details. `ReturnFeesCustomerResponsibility` carries no fee amount. Warranty and return numbers come from one config that feeds the UI, meta, schema, feeds and llms.txt. Generate from live data, never stored or scraped blobs. Remove unknown legal fields instead of showing placeholders.
- **Merchant listings:** the crawler checks each Product's offers: an `Offer` rather than `AggregateOffer` for a single seller and price (medium), `shippingDetails` and `hasMerchantReturnPolicy` on every offer (an `AggregateOffer`'s listed offers included) or once on the Organization (low each), and a schema price that appears on the page (high when it doesn't). Variants belong in a `ProductGroup` with `hasVariant` and `variesBy`; check that in code, the crawler doesn't.
- **Image size:** the crawler reads the pixel size of up to 20 Product schema `image`s on the crawled site and flags any under 50,000 pixels, width × height (`product-image-small`, low), the minimum Google recommends for merchant listings, ideally with several high-resolution images in 16:9, 4:3 and 1:1. Images on another host, SVG and AVIF can't be measured; a note says so, and image size isn't counted as checked.
- **Values Google rejects:** the crawler reads each indexable page with Product schema, and `scripts/schema-check.mjs` each Product, against Google's merchant listing doc (developers.google.com/search/docs/appearance/structured-data/merchant-listing, read 21 Nov 2026):
  - A Product sold with an `Offer` needs an `image` (`product-image-missing`, medium; an error in schema-check). One with an `AggregateOffer` only earns product snippets, which just recommend one.
  - The price is above zero (`product-price-zero`, low). Product snippets accept 0; merchant listings don't.
  - `priceCurrency` is a three-letter ISO 4217 code, checked against ISO's current list (`product-currency-invalid`, medium; an error in schema-check). `£` or `Euro` isn't one.
  - `availability` is one of schema.org's ItemAvailability values, as the full URL (`https://schema.org/InStock`) or the short name (`InStock`), which Google also takes (`product-availability-invalid`, low).
  - `priceValidUntil` isn't in the past: Google says the listing may not show then (`product-price-expired`, medium).
  - The brand isn't N/A, None, Generic or empty (`product-brand-placeholder`, low). Merchant Center's brand help says "When in doubt don't provide a brand", and for products the shop makes itself, to use the shop's name.
- **Recommended fields:** a brand, a GTIN (or an MPN), the SKU, colour, size, material and category, wherever the product has them. Many products rightly lack some, so they're never flagged: the report counts how many products give each (`productFields` in `seo-crawl.json`, information only). Google doesn't list `seller` for merchant listings.
- **Adult products:** Google says adult-oriented products "must use" `hasAdultConsideration`, and Search supports only `https://schema.org/SexualContentConsideration`. The crawler flags a page that labels itself adult for SafeSearch (`<meta name="rating" content="adult">`, or the RTA label) when its Product has no such value (`product-adult-unlabelled`, medium). It can't tell an adult product on a page without that tag.
- **EU energy label:** a Certification in the Product's `hasCertification`, with `issuedBy` an Organization named `European_Commission` (or `EC`), `"name": "EPREL"` and `certificationIdentification` set to the product's code in the EPREL database, which Google requires for European energy labels. A shop serving Norway, Switzerland or the UK without EPREL codes may give `certificationRating` instead (such as `"ratingValue": "A+"`, `"bestRating": "A++"`, `"worstRating": "D"`). Up to 10 certifications per product. `schema-check.mjs` notes an EPREL label without its code, and the older `hasEnergyConsumptionDetails`, which Google still reads but no longer recommends.
- **Category:** `category` takes plain text (`"Dresses"`, or a path such as `"Special Occasion > Wedding & Bridal Party Dresses"`) or a CategoryCode from Google's product taxonomy: `{"@type": "CategoryCode", "inCodeSet": "https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt", "codeValue": "2271"}`, with the category's ID or its full path (`"Apparel & Accessories > Clothing > Dresses"`) as `codeValue`. In a Merchant Center feed, `google_product_category` takes the ID or the full path, never both. It's optional: Google gives every product a category itself.
- **Brand pages:** a page for each brand the shop stocks is a category page (SHOP-01, SHOP-03), with CollectionPage whose `about` points at a Brand (`name`, `logo`), an ItemList of its products in the order shown, and BreadcrumbList. It earns no Google rich result, but it tells Bing and AI engines what the page is. Each Product's `brand` names the same Brand.

### SHOP-06 · Reviews are real · blocker
Only genuine buyer reviews, with whole stars per review and decimals only in averages. Never present imported, scraped or AI-rewritten reviews as verified (illegal in some places, e.g. the UK's DMCC Act 2024, with fines up to 10% of global turnover). Send one review request 7–14 days after delivery. Skip product FAQs until there's real per-product content; identical templated FAQs are worthless.

### SHOP-07 · International · medium
`hreflang` for every language or region version (self plus `x-default`), currency per region, and `<html lang>` set.

### SHOP-08 · Products are listed free through Google Merchant Center · medium
Merchant Center is Google's free tool for putting a shop's products on Google. With free listings, products can show at no cost on Search, the Shopping tab, Images, Maps, YouTube and Gemini. A shop that sells online should claim it: verify the site in Merchant Center, then send the products with a product feed, or let Google read the Product structured data the pages already have (SHOP-05). Google checks the site for new products at least once a day.

The feed data must match the page. When the price differs, Google can disapprove the product, and a price that JavaScript adds after the page loads triggers an error. Too many products with the wrong availability can get the account suspended.

**Check:** the feed, the schema and the page take price and availability from the same live data, and the price is in the HTML the server sends.

Setting up the account is an owner action: report it as a decision or a note.

**AI-written titles and descriptions:** Merchant Center's "AI-generated content" rules: titles written with generative AI go in `structured_title`, not `title`, and descriptions "must" go in `structured_description`, each with its text in `content` and `digital_source_type` set to `trained_algorithmic_media`. Images made with generative AI must keep their IPTC DigitalSourceType metadata. Ask the owner whether the feed's text is AI-written; the crawler can't tell.

**AI checkout (UCP):** the Universal Commerce Protocol is the open standard behind checkout in Google's AI Mode and Gemini. Google started with eligible US retailers (blog.google, 11 Jan 2026), and shops set it up through Merchant Center (developers.google.com/merchant/ucp); ask the shop platform whether it does this for you. The crawler lists the shop's UCP profile (`/.well-known/ucp`) when there is one, as information only. Taking part is the owner's decision. Two other open standards do the same job elsewhere: the Agentic Commerce Protocol (ACP), from OpenAI and Stripe, for checkout through AI platforms such as ChatGPT, which each take businesses by application (agenticcommerce.dev), and x402, for paying over the web itself: a server answers an unpaid request with HTTP 402 Payment Required, and the client, often an AI agent, pays, mostly in stablecoins, and tries again (x402.org). The crawler doesn't look for either.

### SHOP-09 · Product pages answer the buyer's questions · medium
Our own practice, unless a source is named:
- **Headings:** the H1 is the product's name. The sections below it are H2s, such as Description, Specifications, Size guide, Care, Delivery and returns, Reviews and Questions, using only the ones that apply. The crawler flags 3 or more product pages that share an H1 naming none of their products, usually a template heading such as "Product details" (`product-h1-reused`, CONTENT-04, medium; the 3 is our own cut-off). Variants whose H1 names their product, such as "Wool coat" for "Wool coat, small", are fine.
- **Specifications in a table:** sizes, weight, materials, compatibility and the like go in an HTML `<table>`, a row for each, not only in a paragraph, so shoppers can scan and compare them. The values match the schema's (SCHEMA-04).
- **Size and care:** clothes, shoes and anything else that has to fit get a size guide on the page (measurements, and how it fits). Products that need looking after get their care details (washing, cleaning, storage). These are the questions buyers ask before they buy.
- **Price in the meta description:** name the price, or "from £X" for a product with variants, next to what the product is. Google's snippet guide: "product pages might have the key bits of information—price, age, manufacturer—scattered throughout a page. A good meta description can bring all this data together." Build it from the same live price as the page (META-02, SHOP-05).
- **Copy from the manufacturer:** a description copied from the manufacturer is the text every other shop selling the item has, so the page adds nothing of its own (CONTENT-04). Google's helpful content questions ask whether content that draws on other sources avoids "simply copying or rewriting those sources". Write it in the shop's own words: who it's for, how it fits or works, what buyers ask. To check, with outside checks on and `copy` in `outsideChecks.approved`, search one sentence from one product description, in quotes, with your web search tool; the same sentence on many other shops means it's the manufacturer's. That sends the sentence to your search provider. Without that yes, ask the owner where the descriptions come from.
