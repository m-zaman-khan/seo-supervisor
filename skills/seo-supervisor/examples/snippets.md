# Copy-ready snippets

Replace `example.com`, "Brand" and the paths. Each snippet names the rule it serves. Framework-specific code (metadata helper, robots.ts, sitemap.ts, JSON-LD component, headers) is in `frameworks/`.

## Organization + WebSite, once in the root layout (SCHEMA-02)
```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://example.com/#organization",
      "name": "Brand",
      "url": "https://example.com/",
      "logo": { "@type": "ImageObject", "url": "https://example.com/logo-512.png", "width": 512, "height": 512 },
      "sameAs": ["https://github.com/brand", "https://www.linkedin.com/company/brand", "https://x.com/brand"],
      "contactPoint": { "@type": "ContactPoint", "contactType": "customer support", "email": "support@example.com" }
    },
    {
      "@type": "WebSite",
      "@id": "https://example.com/#website",
      "url": "https://example.com/",
      "name": "Brand",
      "inLanguage": "en",
      "publisher": { "@id": "https://example.com/#organization" }
    }
  ]
}
```

## Tool page `@graph` (TOOL-08, SCHEMA-03)
```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage", "@id": "https://example.com/tools/dmarc-checker/#webpage",
      "url": "https://example.com/tools/dmarc-checker/", "name": "DMARC Checker - Free DMARC Record Lookup",
      "description": "Enter a domain to look up its DMARC record, check the policy and reporting addresses, and get clear steps to fix problems.",
      "isPartOf": { "@id": "https://example.com/#website" },
      "breadcrumb": { "@id": "https://example.com/tools/dmarc-checker/#breadcrumb" },
      "mainEntity": { "@id": "https://example.com/tools/dmarc-checker/#app" }, "dateModified": "2026-11-12" },
    { "@type": "WebApplication", "@id": "https://example.com/tools/dmarc-checker/#app",
      "name": "DMARC Checker", "url": "https://example.com/tools/dmarc-checker/",
      "applicationCategory": "SecurityApplication", "operatingSystem": "Any", "browserRequirements": "Requires JavaScript",
      "isAccessibleForFree": true, "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "publisher": { "@id": "https://example.com/#organization" } },
    { "@type": "BreadcrumbList", "@id": "https://example.com/tools/dmarc-checker/#breadcrumb",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://example.com/" },
        { "@type": "ListItem", "position": 2, "name": "Tools", "item": "https://example.com/tools/" },
        { "@type": "ListItem", "position": 3, "name": "DMARC checker" } ] },
    { "@type": "FAQPage", "@id": "https://example.com/tools/dmarc-checker/#faq",
      "isPartOf": { "@id": "https://example.com/tools/dmarc-checker/#webpage" },
      "mainEntity": [ { "@type": "Question", "name": "What is a good DMARC policy?",
        "acceptedAnswer": { "@type": "Answer", "text": "Start with p=none to collect reports. Once SPF and DKIM pass for all senders, move to p=quarantine, then p=reject." } } ] }
  ]
}
```

## Service page (SVC-03)
```json
{
  "@context": "https://schema.org",
  "@type": "Service",
  "@id": "https://example.com/penetration-testing/api/#service",
  "name": "API Penetration Testing",
  "serviceType": "API penetration testing",
  "url": "https://example.com/penetration-testing/api/",
  "description": "Manual and automated testing of REST and GraphQL APIs against the OWASP API Security Top 10, with a retest included.",
  "provider": { "@id": "https://example.com/#organization" },
  "areaServed": "Worldwide"
}
```

## Heading outline for a tool or guide page (CONTENT-01, CONTENT-02)
```
H1  DMARC Record Checker
  H2  How to use the DMARC checker
  H2  What this tool checks
    H3  Policy (p=)
    H3  Reporting addresses (rua and ruf)
  H2  How to read your results
  H2  Common DMARC problems and fixes
  H2  Frequently asked questions
    H3  What is a good DMARC policy?
    H3  How long does a DMARC change take to work?
  H2  Related tools
```

## security.txt at `/.well-known/security.txt` (TRUST-02)
```
Contact: mailto:security@example.com
Expires: 2027-11-16T00:00:00.000Z
Policy: https://example.com/security/disclosure/
Acknowledgments: https://example.com/security/thanks/
Preferred-Languages: en
Canonical: https://example.com/.well-known/security.txt
```

## llms.txt (MAP-07, optional)
```
# Brand

> One sentence on what the site and company do.

## Tools
- [SSL Checker](https://example.com/tools/ssl-checker/): Checks a certificate's chain, expiry and hostname match.

## Services
- [API penetration testing](https://example.com/penetration-testing/api/): Testing of REST and GraphQL APIs against the OWASP API Top 10.
```

## IndexNow ping (MAP-08)
```bash
# Host the key at https://example.com/<key>.txt first. Reaches Bing, Yandex, Seznam, Naver and others; not Google.
curl -X POST "https://api.indexnow.org/indexnow" -H "Content-Type: application/json; charset=utf-8" \
  -d '{"host":"example.com","key":"<key>","keyLocation":"https://example.com/<key>.txt","urlList":["https://example.com/tools/dmarc-checker/"]}'
```

## Quick checks with curl (REND-01, URL-02, CRAWL-03)
```bash
URL=https://example.com/tools/dmarc-checker/
# What a crawler without JavaScript sees. Each line should print something.
curl -s "$URL" | grep -o '<h1[^>]*>[^<]*'
curl -s "$URL" | grep -c '<h2'
curl -s "$URL" | grep -o 'application/ld+json'
curl -s "$URL" | grep -o 'What is a good DMARC policy'          # an FAQ answer is in the HTML
# Trailing slash (site uses slashes): a 308/301 to the slashed URL, while files stay 200 with no slash
curl -sI https://example.com/tools/dmarc-checker | head -1
curl -sI https://example.com/sitemap.xml | head -1
# Production must not be noindex (run after every deploy; fail the pipeline on output)
curl -sI https://example.com/ | grep -i '^x-robots-tag:.*noindex'
curl -s  https://example.com/ | grep -i '<meta[^>]*name="robots"[^>]*noindex'
```

## Business types (SCHEMA-02, LOCAL-06)

One business node in the root layout, in place of the plain Organization in the first snippet: same `@id`, with the type `scripts/data/business-types.json` gives for the business (the crawl's `businessType`). That file also lists each type's key fields, the Google feature it can unlock and the usual mistakes. Google asks for the most specific type that fits. A business that really is two trades can list both, as in Google's own example: `"@type": ["Electrician", "Plumber", "Locksmith"]`. Put in only facts the site already shows, and leave out `aggregateRating` and `review` for your own business: Google uses them only on sites that collect reviews of other businesses. Software and tools keep an Organization and put a WebApplication on each tool page (the tool page snippet above).

### Restaurant, café, bar or bakery
```json
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "@id": "https://example.com/#organization",
  "name": "Brand Trattoria", "url": "https://example.com/", "telephone": "+44 113 496 0000",
  "address": { "@type": "PostalAddress", "streetAddress": "12 High Street", "addressLocality": "Leeds", "postalCode": "LS1 4AB", "addressCountry": "GB" },
  "geo": { "@type": "GeoCoordinates", "latitude": 53.79648, "longitude": -1.54785 },
  "servesCuisine": ["Italian", "Pizza"], "menu": "https://example.com/menu/", "acceptsReservations": true, "priceRange": "££",
  "openingHoursSpecification": [{ "@type": "OpeningHoursSpecification", "dayOfWeek": ["https://schema.org/Tuesday", "https://schema.org/Wednesday", "https://schema.org/Thursday", "https://schema.org/Friday", "https://schema.org/Saturday"], "opens": "12:00", "closes": "22:00" }]
}
```

### Dentist, doctor, clinic, pharmacy or optician
```json
{
  "@context": "https://schema.org",
  "@type": "Dentist",
  "@id": "https://example.com/#organization",
  "name": "Brand Dental", "url": "https://example.com/", "telephone": "+44 113 496 0001",
  "address": { "@type": "PostalAddress", "streetAddress": "4 Park Row", "addressLocality": "Leeds", "postalCode": "LS1 5HD", "addressCountry": "GB" },
  "isAcceptingNewPatients": true,
  "openingHoursSpecification": [{ "@type": "OpeningHoursSpecification", "dayOfWeek": ["https://schema.org/Monday", "https://schema.org/Tuesday", "https://schema.org/Wednesday", "https://schema.org/Thursday", "https://schema.org/Friday"], "opens": "08:30", "closes": "17:30" }]
}
```

### Lawyer or law firm
`LegalService`, not `Attorney`, which schema.org has deprecated.
```json
{
  "@context": "https://schema.org",
  "@type": "LegalService",
  "@id": "https://example.com/#organization",
  "name": "Brand Solicitors", "url": "https://example.com/", "telephone": "+44 113 496 0002",
  "address": { "@type": "PostalAddress", "streetAddress": "1 Albion Place", "addressLocality": "Leeds", "postalCode": "LS1 6JL", "addressCountry": "GB" },
  "knowsAbout": ["Family law", "Conveyancing", "Wills and probate"],
  "areaServed": { "@type": "City", "name": "Leeds" }
}
```

### Estate agent
```json
{
  "@context": "https://schema.org",
  "@type": "RealEstateAgent",
  "@id": "https://example.com/#organization",
  "name": "Brand Estates", "url": "https://example.com/", "telephone": "+44 113 496 0003",
  "address": { "@type": "PostalAddress", "streetAddress": "22 Commercial Street", "addressLocality": "Leeds", "postalCode": "LS1 6EX", "addressCountry": "GB" },
  "areaServed": [{ "@type": "City", "name": "Leeds" }, { "@type": "City", "name": "Harrogate" }]
}
```

### Car dealer, with sales, service and parts as departments
Each department is named "{business} {department}", as Google's local business doc asks, with its own hours and phone.
```json
{
  "@context": "https://schema.org",
  "@type": "AutoDealer",
  "@id": "https://example.com/#organization",
  "name": "Brand Motors", "url": "https://example.com/", "telephone": "+44 113 496 0004",
  "address": { "@type": "PostalAddress", "streetAddress": "100 Kirkstall Road", "addressLocality": "Leeds", "postalCode": "LS4 2AA", "addressCountry": "GB" },
  "brand": { "@type": "Brand", "name": "Example Cars" },
  "department": [
    { "@type": "AutoRepair", "name": "Brand Motors Service", "telephone": "+44 113 496 0005",
      "address": { "@type": "PostalAddress", "streetAddress": "100 Kirkstall Road", "addressLocality": "Leeds", "postalCode": "LS4 2AA", "addressCountry": "GB" },
      "openingHoursSpecification": [{ "@type": "OpeningHoursSpecification", "dayOfWeek": ["https://schema.org/Monday", "https://schema.org/Tuesday", "https://schema.org/Wednesday", "https://schema.org/Thursday", "https://schema.org/Friday"], "opens": "07:30", "closes": "18:00" }] },
    { "@type": "AutoPartsStore", "name": "Brand Motors Parts", "telephone": "+44 113 496 0006",
      "address": { "@type": "PostalAddress", "streetAddress": "100 Kirkstall Road", "addressLocality": "Leeds", "postalCode": "LS4 2AA", "addressCountry": "GB" } }
  ]
}
```

### Hotel, B&B, hostel, campsite or holiday let
`starRating` only when an official body (a tourist board or hotel association) gave it.
```json
{
  "@context": "https://schema.org",
  "@type": "Hotel",
  "@id": "https://example.com/#organization",
  "name": "Brand House Hotel", "url": "https://example.com/", "telephone": "+44 113 496 0007",
  "address": { "@type": "PostalAddress", "streetAddress": "8 Station Road", "addressLocality": "York", "postalCode": "YO1 6HT", "addressCountry": "GB" },
  "checkinTime": "15:00", "checkoutTime": "11:00", "numberOfRooms": 24, "petsAllowed": true,
  "amenityFeature": [{ "@type": "LocationFeatureSpecification", "name": "Free Wi-Fi", "value": true }, { "@type": "LocationFeatureSpecification", "name": "Parking", "value": true }]
}
```

### Plumber, electrician, roofer and other trades
Towns served go in `areaServed`; a separate node only for a real staffed office (LOCAL-06).
```json
{
  "@context": "https://schema.org",
  "@type": "Plumber",
  "@id": "https://example.com/#organization",
  "name": "Brand Plumbing", "url": "https://example.com/", "telephone": "+44 113 496 0008",
  "address": { "@type": "PostalAddress", "streetAddress": "3 Mill Lane", "addressLocality": "Leeds", "postalCode": "LS6 2BB", "addressCountry": "GB" },
  "areaServed": [{ "@type": "City", "name": "Leeds" }, { "@type": "City", "name": "Bradford" }],
  "openingHoursSpecification": [{ "@type": "OpeningHoursSpecification", "dayOfWeek": ["https://schema.org/Monday", "https://schema.org/Tuesday", "https://schema.org/Wednesday", "https://schema.org/Thursday", "https://schema.org/Friday"], "opens": "08:00", "closes": "18:00" }]
}
```

### Hair salon, barber, nail salon, beauty salon or day spa
```json
{
  "@context": "https://schema.org",
  "@type": "HairSalon",
  "@id": "https://example.com/#organization",
  "name": "Brand Hair", "url": "https://example.com/", "telephone": "+44 113 496 0009", "priceRange": "££",
  "address": { "@type": "PostalAddress", "streetAddress": "15 Boar Lane", "addressLocality": "Leeds", "postalCode": "LS1 6EN", "addressCountry": "GB" },
  "openingHoursSpecification": [{ "@type": "OpeningHoursSpecification", "dayOfWeek": ["https://schema.org/Tuesday", "https://schema.org/Wednesday", "https://schema.org/Thursday", "https://schema.org/Friday", "https://schema.org/Saturday"], "opens": "09:00", "closes": "18:00" }]
}
```

### Gym
```json
{
  "@context": "https://schema.org",
  "@type": "ExerciseGym",
  "@id": "https://example.com/#organization",
  "name": "Brand Fitness", "url": "https://example.com/", "telephone": "+44 113 496 0010",
  "address": { "@type": "PostalAddress", "streetAddress": "50 Wellington Street", "addressLocality": "Leeds", "postalCode": "LS1 2DE", "addressCountry": "GB" },
  "amenityFeature": [{ "@type": "LocationFeatureSpecification", "name": "Showers", "value": true }],
  "openingHoursSpecification": [{ "@type": "OpeningHoursSpecification", "dayOfWeek": ["https://schema.org/Monday", "https://schema.org/Tuesday", "https://schema.org/Wednesday", "https://schema.org/Thursday", "https://schema.org/Friday"], "opens": "06:00", "closes": "22:00" }]
}
```

### Online shop
`OnlineStore`, as Google recommends for ecommerce. A shop people can visit uses its Store type (ClothingStore, Florist and so on) with an address, like the local businesses above. One return policy here covers every product.
```json
{
  "@context": "https://schema.org",
  "@type": "OnlineStore",
  "@id": "https://example.com/#organization",
  "name": "Brand", "url": "https://example.com/", "logo": "https://example.com/logo-512.png",
  "sameAs": ["https://www.instagram.com/brand"],
  "contactPoint": { "@type": "ContactPoint", "contactType": "customer service", "email": "help@example.com" },
  "hasMerchantReturnPolicy": { "@type": "MerchantReturnPolicy", "applicableCountry": "GB", "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow", "merchantReturnDays": 30, "returnMethod": "https://schema.org/ReturnByMail", "returnFees": "https://schema.org/FreeReturn" }
}
```

### School, college or training provider
`School`, `CollegeOrUniversity`, or `EducationalOrganization` for training and tutoring. Each course page can carry `Course` for Google's course list.
```json
{
  "@context": "https://schema.org",
  "@type": "School",
  "@id": "https://example.com/#organization",
  "name": "Brand Primary School", "url": "https://example.com/", "logo": "https://example.com/logo-512.png", "telephone": "+44 113 496 0011",
  "address": { "@type": "PostalAddress", "streetAddress": "Church Road", "addressLocality": "Leeds", "postalCode": "LS12 1AA", "addressCountry": "GB" }
}
```

### News publisher or magazine
```json
{
  "@context": "https://schema.org",
  "@type": "NewsMediaOrganization",
  "@id": "https://example.com/#organization",
  "name": "Brand News", "url": "https://example.com/", "logo": "https://example.com/logo-512.png",
  "sameAs": ["https://x.com/brandnews"],
  "masthead": "https://example.com/about/team/",
  "publishingPrinciples": "https://example.com/about/standards/",
  "correctionsPolicy": "https://example.com/about/corrections/",
  "ethicsPolicy": "https://example.com/about/ethics/"
}
```
