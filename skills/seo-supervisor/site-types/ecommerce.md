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
- **Merchant listings:** the crawler checks each Product's offers: an `Offer` rather than `AggregateOffer` for a single seller and price (medium), `shippingDetails` and `hasMerchantReturnPolicy` on the offer or once on the Organization (low each), and a schema price that appears on the page (high when it doesn't). Variants belong in a `ProductGroup` with `hasVariant` and `variesBy`; check that in code, the crawler doesn't.

### SHOP-06 · Reviews are real · blocker
Only genuine buyer reviews, with whole stars per review and decimals only in averages. Never present imported, scraped or AI-rewritten reviews as verified (illegal in some places, e.g. the UK's DMCC Act 2024, with fines up to 10% of global turnover). Send one review request 7–14 days after delivery. Skip product FAQs until there's real per-product content; identical templated FAQs are worthless.

### SHOP-07 · International · medium
`hreflang` for every language or region version (self plus `x-default`), currency per region, and `<html lang>` set.
