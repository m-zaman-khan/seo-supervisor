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
Name, address and phone are identical across the site, schema, Google Business Profile and directories. The GBP name is the real brand with no added keywords. With call tracking, the real number stays in the HTML and schema; tracking numbers are swapped in client-side.

### LOCAL-06 · Local business schema · high
One site-wide node of the most specific LocalBusiness subtype (`HVACBusiness`, `Electrician`, `Plumber`, `AutomotiveBusiness` and so on) with a stable `@id`, real address, `geo` (numbers), `openingHoursSpecification`, `telephone`, `image`/`logo` and `sameAs` (the GBP URL). A per-city LocalBusiness only where a real staffed office exists. City pages get a `City` (with `containedInPlace` and a `sameAs` to Wikipedia or the official city site) as `areaServed`. Service nodes use `provider` → the business `@id`. No self-serving business rating.

### LOCAL-07 · Claims and facts · blocker
Publish only owner-confirmed claims (years, licences, guarantees, 24/7, prices, response times). Keep a banned-claims list and grep the rendered HTML for it. Mark services the owner hasn't confirmed as `needs-decision` and leave them unpublished. Unknown hours are a decision, not a guess.

### LOCAL-08 · Mobile conversion without hurting UX signals · medium
A sticky bottom call/quote bar on mobile, the phone number and CTA inside the mobile menu, no popups on load, and no huge quote form inside the hero. Map embeds load on interaction or below the fold, with a `title`.

### LOCAL-09 · Google Business Profile practice · medium
Review requests go to every customer after every job, so new reviews keep arriving. No gating: Google's policy bans asking only happy customers and offering anything in return for a review. Every review gets a reply that answers what the customer said, not a stock line. The GBP website link carries UTM tags, a second GBP exists only for a real staffed location, and there's no engagement manipulation. These are owner actions: report them as decisions or notes.

### LOCAL-10 · No links to retired Business Profile features · medium
The site mustn't send people to Business Profile features Google has switched off. A button or link that leads nowhere loses the customer at the moment they want to get in touch.
- **Chat:** no "Message us on Google" buttons and no Business Messages chat widgets. Business Profile chat and call history ended on 31 July 2024.
- **Old profile websites:** no links to a `*.business.site` address, in the footer, in schema `sameAs` or anywhere else. Those sites were turned off in March 2024, and their redirect to the profile stopped in June 2024.
- **Questions on the listing:** no "ask your question on our Google listing" wording. Google began removing Q&A from Business Profiles in December 2025 and answers questions with AI in Maps instead. Put common customer questions in an FAQ on the site and in the profile description, which those answers draw on.

**Check:** grep the code and content for `business.site`, "message us on google", "business messages" and Q&A wording.

**Fix:** point the button or link at the site's own contact page, the phone number, or the Maps profile link (`sameAs`).

### LOCAL-11 · The Business Profile's primary category is the most specific one that fits · high
Google says the categories on a Business Profile affect local ranking. The primary category describes the business as a whole and is as specific as the list allows: Google's example is "Nail salon", not "Salon". If nothing specific fits, a broader category is fine; you can't make one up. Secondary categories cover departments or services the business really offers, never one for every product, and never one used as a keyword. Changing a category can mean verifying the business again. The LocalBusiness subtype in schema (LOCAL-06) follows the same choice. The skill can't see the profile: ask the owner which categories it uses, and report the answer as a decision or a note.

### LOCAL-12 · The Business Profile is verified and complete · medium
Google says businesses with complete, accurate information are more likely to show in local results, and a verified profile is more likely to show in search.
- **Verified:** the owner controls the profile and can edit it.
- **Hours:** the regular hours, plus special hours for holidays and other one-off days. Google suggests confirming holiday hours even when they're the same as usual.
- **Services:** every service the business offers, each with a short description. A price goes in the service's price field, never in a custom service's name; Google rejects those names.
- **Service area:** a business that travels to customers lists the cities, postal codes or regions it serves (up to 20). If customers don't come to the address, the address is removed from the profile. Google's guidelines keep the area within about two hours' drive of the base.
- **Photos:** a logo, a cover photo, and real photos of the outside, the inside, the team and the work, in focus and well lit. Google suggests at least three each of the outside, the inside, the team and the work.

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

A place in a "best of" round-up from a real local publication is worth earning (LINK-10). Never pay for one: Google treats a paid link as link spam unless it's marked `rel="sponsored"` or `rel="nofollow"`. These are owner actions: report them as decisions or notes.
