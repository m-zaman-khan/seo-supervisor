# Local businesses: trades, clinics, service-area businesses (LOCAL)

### LOCAL-01 · Only real service × city combinations · blocker
Generate only the service × city pairs listed in your data, never the full cross product. Pages are at city level; neighbourhoods go inside the city page. A service gets per-city pages only if people search "service + city"; otherwise it gets one metro page. Launch the highest-intent pairs first and the rest in batches over weeks (release flags; a held page returns 404).

### LOCAL-02 · Every city page is genuinely local · blocker
Each page needs a unique intro of 40 words or more naming its own city, at least one local consideration (climate, permits, housing stock, regulations, with sources), at least 2–3 unique FAQs, and real proof from that city (jobs, photos, reviews) rendered on the server from your own data, not a widget. No city-swapped templates; the crawler's `near-duplicate` check must pass. A town with no proof of its own may show proof from the hub town that serves it, saying so plainly.

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
Review requests go to every customer (no gating), every review gets a reply, the GBP website link carries UTM tags, a second GBP exists only for a real staffed location, and there's no engagement manipulation. These are owner actions: report them as decisions or notes.
