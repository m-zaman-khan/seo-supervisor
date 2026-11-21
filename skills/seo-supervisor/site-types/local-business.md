# Local businesses: trades, clinics, service-area businesses (LOCAL)

### LOCAL-01 · Only real service × city combinations · blocker
Generate only the service × city pairs listed in your data, never the full cross product. Pages are at city level; neighbourhoods go inside the city page. A service gets per-city pages only if people search "service + city"; otherwise it gets one metro page. Launch the highest-intent pairs first and the rest in batches over weeks (release flags; a held page returns 404).

### LOCAL-02 · Every city page is genuinely local · blocker
Each page needs a unique intro that names its own city and says something specific about the work there, at least one local consideration (climate, permits, housing stock, regulations, with sources), at least 2–3 unique FAQs, and real proof from that city (jobs, photos, reviews) rendered on the server from your own data, not a widget. No city-swapped templates; the crawler's `near-duplicate` check must pass. A town with no proof of its own may show proof from the hub town that serves it, saying so plainly.

### LOCAL-03 · Each page names one city · high
The city in the slug, title, H1 and `areaServed` must match. Other cities appear only in the nearby/sibling link blocks. Mention the city naturally (about 15–30 times per page; 40 or more reads as stuffing).

### LOCAL-04 · Local URLs · medium
At most 3 path segments. The service slug is reused exactly in service × city URLs. In a metro spanning two states, the state goes into the city slug (`kansas-city-ks`). County is data, not part of the URL. Dropped geo layers (e.g. county pages) 301 to the service page.

### LOCAL-05 · NAP is identical everywhere · high
Name, address and phone are identical across the site, schema, Google Business Profile and directories. The GBP name is the real brand with no added keywords. Use a local number: Google's guidelines say "Use a local phone number instead of a central call center helpline number whenever possible" (support.google.com/business/answer/3038177). With call tracking, the real number stays in the HTML and schema; tracking numbers are swapped in client-side. Check: crawler `nap-not-shown` (medium) flags a page whose LocalBusiness `telephone` or `streetAddress` doesn't appear in the visible text of that page or the home page (phone by its last 7 digits in any format; the street with common abbreviations such as St, Rd, Ave, Ste and Str. read as the full word, and each comma-separated part and unit found on its own). OnlineStore, OnlineBusiness and a bare Service aren't local businesses, so they aren't checked. A service-area business that hides its street address (LOCAL-06) isn't asked to show it: only its phone is checked.

### LOCAL-06 · Local business schema · high
One site-wide node of the most specific LocalBusiness subtype (`HVACBusiness`, `Electrician`, `Plumber`, `AutomotiveBusiness` and so on) with a stable `@id`, real address (see the service-area note below), `geo` (numbers), `openingHoursSpecification`, `telephone`, `image`/`logo` and `sameAs` (the GBP URL). A per-city LocalBusiness only where a real staffed office exists. City pages get a `City` (with `containedInPlace` and a `sameAs` to Wikipedia or the official city site) as `areaServed`. Service nodes use `provider` → the business `@id`. No self-serving business rating.

**Service-area businesses:**
- **The rule:** Google says a service-area business that doesn't serve customers at its address "should hide your business address from customers" on its Business Profile. Google's example is a plumber working from home (support.google.com/business/answer/3038177).
- **What the site does:** don't publish that street address on the site or in the schema, and never flag its absence as a finding. Give the town, region, postcode and country in `address`, plus `areaServed`.
- **The cost:** Google's LocalBusiness rich result lists `address` as required, and its examples include a street address. A partial address may therefore not qualify for the rich result. Tell the owner this as a decision; don't push the home address onto the page.

**Check:** the crawler tells the kinds of business apart from the LocalBusiness schema and the page text, and reports it as `localBusiness` (information only, never in the score):
- **Storefront:** a street address in the schema that a page shows, and no sign of travelling to customers.
- **Service-area business:** `areaServed` (or its older name `serviceArea`), or text such as "we come to you", and no street address on any page. The address check (LOCAL-05) then skips the street address. If the schema still gives one, a note asks the owner to take it out or show it.
- **Hybrid:** a street address shown on the site, plus a service area or "we come to you" text (LOCAL-12).

`scripts/osm.mjs` asks OpenStreetMap's Nominatim where it places the address, and reports how far that is from `geo`, or the `geo` to add when there's none. It sends the address to an outside service, so it's a dry run until the owner agrees (`--yes`). A service-area business gets no `geo` to add, because a point on the map would show the address it hides.

### LOCAL-07 · Claims and facts · blocker
Publish only owner-confirmed claims (years, licences, guarantees, 24/7, prices, response times). Keep a banned-claims list and grep the rendered HTML for it. Mark services the owner hasn't confirmed as `needs-decision` and leave them unpublished. Unknown hours are a decision, not a guess.

### LOCAL-08 · Mobile conversion without hurting UX signals · medium
A sticky bottom call/quote bar on mobile, the phone number and CTA inside the mobile menu, no popups on load, and no huge quote form inside the hero. Map embeds load on interaction or below the fold, with a `title`.

### LOCAL-09 · Google Business Profile practice · medium
Review requests go to every customer after every job, so new reviews keep arriving. No gating: Google's policy bans asking only happy customers and offering anything in return for a review. Every review gets a reply that answers what the customer said, not a stock line. The GBP website link carries UTM tags, and there's no engagement manipulation.
- **US law on reviews:** the FTC's Trade Regulation Rule on the Use of Consumer Reviews and Testimonials (16 CFR Part 465), in force since 21 October 2024, bans fake reviews (AI-written ones included), buying reviews, reviews by the business's own people that don't say so, hiding bad reviews, review sites the business secretly controls, and fake social-media followers or views. The FTC can seek up to $53,088 per violation from those who break it knowingly: the 2025 figure, kept for 2026 (ftc.gov).
- **The profile links to the right page:** a business with several locations links each profile to that location's own page (LOCAL-15), not only to the home page. Google's guidelines ask for "a website that represents your individual business location", and rule out links that redirect people to other landing pages (support.google.com/business/answer/3038177).
- **Replies that keep clients' secrets:** a clinic, dentist or law firm never confirms in a reply that the reviewer is a patient or client, and never mentions their care or case.
  - **Health (US):** under HIPAA, the HHS has made providers pay for putting patient details in replies to online reviews: New Vision Dental paid $23,000 (2022) and Manasa Health Center $30,000 (2023) (hhs.gov).
  - **Lawyers (US):** the American Bar Association's Formal Opinion 496 (2021) says lawyers "must not disclose information that relates to a client matter" when they reply, and should consider not replying at all. Its sample reply: "Professional obligations do not allow me to respond as I would wish."
  - **A safe reply:** thank the person, say that privacy rules limit what you can say, and give a phone number or email address to talk it through.

A second GBP exists only for a real staffed location, with two exceptions from Google's "Guidelines for representing your business on Google" (support.google.com/business/answer/3038177):
- **Practitioners:** a public-facing practitioner (a doctor, dentist, lawyer, financial planner, or insurance or real estate agent) who can be reached at the verified location during stated hours may have their own profile. The organization keeps its own separate profile for that location. A solo practitioner at a branded organization shares the organization's profile instead, named "[brand]: [practitioner]".
- **Departments:** a public-facing department that runs as a distinct entity may have its own profile. It usually has its own entrance, category and hours. Google's example is a car dealer's "Service & Parts" next to its sales profile. These are owner actions: report them as decisions or notes.

### LOCAL-10 · No links to retired Business Profile features · medium
The site mustn't send people to Business Profile features Google has switched off. A button or link that leads nowhere loses the customer at the moment they want to get in touch.
- **Chat:** no "Message us on Google" buttons and no Business Messages chat widgets. Business Profile chat and call history ended on 31 July 2024.
- **Old profile websites:** no links to a `*.business.site` address, in the footer, in schema `sameAs` or anywhere else. Those sites were turned off in March 2024, and their redirect to the profile stopped in June 2024.
- **Questions on the listing:** no "ask your question on our Google listing" wording. Google began removing Q&A from Business Profiles in December 2025 and answers questions with AI in Maps instead. Put common customer questions in an FAQ on the site and in the profile description, which those answers draw on (LOCAL-12 has the description's rules).

**Check:** grep the code and content for `business.site`, "message us on google", "business messages" and Q&A wording.

**Fix:** point the button or link at the site's own contact page, the phone number, or the Maps profile link (`sameAs`).

### LOCAL-11 · The Business Profile's primary category is the most specific one that fits · high
Google says the categories on a Business Profile affect local ranking. The primary category describes the business as a whole and is as specific as the list allows: Google's example is "Nail salon", not "Salon". If nothing specific fits, a broader category is fine; you can't make one up. Secondary categories cover departments or services the business really offers, never one for every product, and never one used as a keyword. Changing a category can mean verifying the business again. The LocalBusiness subtype in schema (LOCAL-06) follows the same choice. The skill can't see the profile: ask the owner which categories it uses, and report the answer as a decision or a note.

**Nearby competitors:** with the owner's yes, `scripts/osm.mjs` lists businesses of the same type near the business from OpenStreetMap (within 2 km unless `--radius` says otherwise), with their number per km². It's context, never a finding: volunteers keep OpenStreetMap, so it can miss businesses or list closed ones, and it isn't Google's data. The report credits it as "© OpenStreetMap contributors", as its licence (ODbL) asks.

### LOCAL-12 · The Business Profile is verified and complete · medium
Google says businesses with complete, accurate information are more likely to show in local results, and a verified profile is more likely to show in search.
- **Verified:** the owner controls the profile and can edit it.
- **Hours:** the regular hours, plus special hours for holidays and other one-off days. Google suggests confirming holiday hours even when they're the same as usual.
- **Services:** every service the business offers, each with a short description. A price goes in the service's price field, never in a custom service's name; Google rejects those names.
- **Service area:** a business that travels to customers lists the cities, postal codes or regions it serves (up to 20). If customers don't come to the address, the address is removed from the profile. Google's guidelines keep the area within about two hours' drive of the base.
- **Storefront and service area (hybrid):** a business that serves customers at its address and also goes to them enters "both your address and service area" (support.google.com/business/answer/9157481). On the site, keep the address on the page and in the schema, and add the area as `areaServed` (LOCAL-06).
- **Description:** up to 750 characters, with no links or HTML, and no promotions, prices or sales (support.google.com/business/answer/3039617 and 3038177). Our own advice: start with the main service and the area served, in plain words, and answer the questions customers ask most (LOCAL-10).
- **Attributes:** facts such as Wi-Fi, cash only or a wheelchair-accessible entrance. The owner sets some; others may come from what customers report (support.google.com/business/answer/9049526). Set every one that's true.
- **Menu or services link:** one link to the menu, or to a list of services (support.google.com/business/answer/6218037). Point it at the site's own menu or services page. Google doesn't allow a menu link that goes straight to another company's ordering or delivery service (answer 3038177).
- **Booking link:** a link to the page where customers book, or a booking provider that works with Google, chosen under Bookings (support.google.com/business/answer/7475773). Up to 10 links of each kind (answer 6218037).
- **Photos and videos:** a logo, a cover photo, and real photos of the outside, the inside, the team and the work, in focus and well lit. Google suggests at least three each of the outside, the inside, the team and the work. Videos can be up to 30 seconds and 75 MB, at 720p or higher (support.google.com/business/answer/6103862).

**What to watch:** the profile's Performance report shows how people found it and what they did, with figures such as searches, views, calls, website clicks, direction requests, messages and bookings (support.google.com/business/answer/9918094). Ask the owner for these each month: they show what the profile brings in, and the skill can't see them.

The skill can't see the profile. These are owner actions: report them as decisions or notes, never as measured findings.

### LOCAL-13 · The business is on Bing and Apple Maps too · low
Both listings are free. Name, address, phone and hours match the site and the Google profile exactly (LOCAL-05).
- **Bing Places for Business** (bing.com/forbusiness, which replaced bingplaces.com in October 2025): the listing shows in Bing search and Bing Maps. It can import the Google profile; check what it copied.
- **Apple Business** (business.apple.com): how the business shows in Apple Maps, Siri, Mail and Wallet. It replaced Apple Business Connect in April 2026, and existing listings moved across.

These are owner actions: report them as decisions or notes.

### LOCAL-14 · The directories for the trade are claimed, with the same NAP · low
Claim the profile on the directories customers in that trade use, with name, address and phone exactly as on the site (LOCAL-05):
- **Restaurants:** Yelp, Tripadvisor, OpenTable.
- **Healthcare:** Healthgrades, Zocdoc.
- **Legal:** Avvo, Justia, Martindale-Hubbell, FindLaw.
- **Home services:** BBB, Nextdoor, Thumbtack, Yelp.
- **Real estate:** Zillow, Realtor.com.
- **Car dealers:** Cars.com, Autotrader, CarGurus, DealerRater.
- **Any trade (US):** Yellow Pages (yellowpages.com), Manta, Foursquare.

**Data aggregators (US):** Data Axle, Foursquare and TransUnion's Digital Business Profile (formerly Neustar Localeze) sell business listing data that maps, apps and directories reuse. Check what each holds for the business, so a wrong name, address or phone doesn't spread.

A place in a "best of" round-up from a real local publication is worth earning (LINK-10). Never pay for one: Google treats a paid link as link spam unless it's marked `rel="sponsored"` or `rel="nofollow"`. These are owner actions: report them as decisions or notes.

### LOCAL-15 · Every location has its own page, linked from the store locator · high
A business with more than one location gives each one its own page, rendered on the server, with that location's address, phone, hours (LOCAL-16) and directions.
- **The locator links to every page:** Google "can only crawl your link if it's an `<a>` HTML element" with an `href` (developers.google.com/search/docs/crawling-indexing/links-crawlable), and "Googlebot generally doesn't try to submit searches into a search box" (developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure). A locator that is only a search box or a map widget hides the location pages, so list them all as plain links too, for example by region.
- **Schema:** each location page has its own LocalBusiness node with its own `@id`, as Google asks: "Define each local business location as a LocalBusiness type" (developers.google.com/search/docs/appearance/structured-data/local-business). Point it at the brand with `parentOrganization` → the brand's Organization `@id`. schema.org replaced `branchOf` with `parentOrganization`, so don't use `branchOf`.
- **URLs:** Google states no preference between subfolders and subdomains ("do whatever makes sense for your business", developers.google.com/search/docs/fundamentals/seo-starter-guide). Our own advice: put locations in a subfolder (`/locations/leeds/`), not a subdomain each, because one site is simpler to run and measure.
- **The profile:** each location's Business Profile links to its own page (LOCAL-09).

**Check:** every location page turns up in the crawl, which follows only links.

### LOCAL-16 · Opening hours and holiday hours are on the page · medium
Show the regular opening hours as text on the contact page and on each location page, and change them for holidays and other one-off closures, in step with the profile's special hours (LOCAL-12).
- **Schema:** the same hours go in `openingHoursSpecification`. Seasonal or holiday hours add `validFrom` and `validThrough` (YYYY-MM-DD); without them, the hours count all year (developers.google.com/search/docs/appearance/structured-data/local-business).
- **On the page, not only in the schema:** Google's rule is "Don't mark up content that is not visible to readers of the page" (developers.google.com/search/docs/appearance/structured-data/sd-policies).
- **Only confirmed hours:** hours the owner hasn't confirmed are a decision, not a guess (LOCAL-07).
