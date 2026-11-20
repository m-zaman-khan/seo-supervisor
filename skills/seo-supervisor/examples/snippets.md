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

## Google rich results (SCHEMA-03, SCHEMA-08)

One snippet per result type Google still shows, from its search gallery (checked 20 Nov 2026; the full list with each type's required and recommended properties is in `scripts/data/google-rich-results.json`). Each one passes `scripts/schema-check.mjs` with no errors. Use only the parts that are true for the page, and run one URL per template through Google's Rich Results Test.

Ratings and reviews: only real ones shown on the same page (SCHEMA-04). The numbers below are placeholders; if the page shows no ratings, leave `aggregateRating` and `review` out. FAQ, how-to, sitelinks search box, fact check, special announcement and estimated salary results are gone (SCHEMA-05), so they have no snippet here.

### Product, merchant listing and review (SHOP-05)
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Trail running shoe",
  "image": ["https://example.com/photos/trail-shoe-1x1.jpg", "https://example.com/photos/trail-shoe-16x9.jpg"],
  "description": "A light trail shoe with a grippy sole and a wide toe box.",
  "sku": "TRS-042",
  "brand": { "@type": "Brand", "name": "Brand" },
  "offers": {
    "@type": "Offer",
    "url": "https://example.com/shoes/trail-shoe/",
    "price": "89.00",
    "priceCurrency": "GBP",
    "availability": "https://schema.org/InStock",
    "itemCondition": "https://schema.org/NewCondition",
    "shippingDetails": {
      "@type": "OfferShippingDetails",
      "shippingRate": { "@type": "MonetaryAmount", "value": "4.95", "currency": "GBP" },
      "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "GB" },
      "deliveryTime": {
        "@type": "ShippingDeliveryTime",
        "handlingTime": { "@type": "QuantitativeValue", "minValue": 0, "maxValue": 1, "unitCode": "DAY" },
        "transitTime": { "@type": "QuantitativeValue", "minValue": 1, "maxValue": 3, "unitCode": "DAY" }
      }
    },
    "hasMerchantReturnPolicy": {
      "@type": "MerchantReturnPolicy",
      "applicableCountry": "GB",
      "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
      "merchantReturnDays": 30,
      "returnFees": "https://schema.org/FreeReturn"
    }
  },
  "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.4", "reviewCount": "89", "bestRating": "5" },
  "review": {
    "@type": "Review",
    "author": { "@type": "Person", "name": "Sam Lee" },
    "datePublished": "2026-10-02",
    "reviewRating": { "@type": "Rating", "ratingValue": "5", "bestRating": "5" }
  }
}
```

### Product variants (one page for all sizes and colours)
```json
{
  "@context": "https://schema.org",
  "@type": "ProductGroup",
  "name": "Wool winter coat",
  "description": "A warm wool coat in two sizes and two colours.",
  "url": "https://example.com/coats/wool-coat/",
  "brand": { "@type": "Brand", "name": "Brand" },
  "productGroupID": "WC-01",
  "variesBy": ["https://schema.org/size", "https://schema.org/color"],
  "hasVariant": [
    { "@type": "Product", "sku": "WC-01-S-GRN", "name": "Wool winter coat, small, green", "description": "Small green wool coat.", "size": "small", "color": "green",
      "image": "https://example.com/photos/coat-small-green.jpg",
      "offers": { "@type": "Offer", "url": "https://example.com/coats/wool-coat/?size=small&color=green", "price": "119.00", "priceCurrency": "GBP", "availability": "https://schema.org/InStock" } },
    { "@type": "Product", "sku": "WC-01-L-BLU", "name": "Wool winter coat, large, blue", "description": "Large blue wool coat.", "size": "large", "color": "blue",
      "image": "https://example.com/photos/coat-large-blue.jpg",
      "offers": { "@type": "Offer", "url": "https://example.com/coats/wool-coat/?size=large&color=blue", "price": "129.00", "priceCurrency": "GBP", "availability": "https://schema.org/InStock" } }
  ]
}
```

### Store-wide returns, shipping and loyalty program (on the Organization, SHOP-05)
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": "https://example.com/#organization",
  "name": "Brand",
  "url": "https://example.com/",
  "logo": "https://example.com/logo-512.png",
  "hasMerchantReturnPolicy": {
    "@type": "MerchantReturnPolicy",
    "applicableCountry": "GB",
    "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
    "merchantReturnDays": 30,
    "returnFees": "https://schema.org/FreeReturn",
    "returnMethod": "https://schema.org/ReturnByMail"
  },
  "hasShippingService": {
    "@type": "ShippingService",
    "name": "Standard delivery",
    "shippingConditions": {
      "@type": "ShippingConditions",
      "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "GB" },
      "shippingRate": { "@type": "MonetaryAmount", "value": "4.95", "currency": "GBP" }
    }
  },
  "hasMemberProgram": {
    "@type": "MemberProgram",
    "name": "Brand Club",
    "description": "Free to join: members get free delivery and earn points on every order.",
    "url": "https://example.com/club/",
    "hasTiers": {
      "@type": "MemberProgramTier",
      "@id": "https://example.com/club/#member",
      "name": "Member",
      "hasTierBenefit": "https://schema.org/TierBenefitLoyaltyPoints",
      "hasTierRequirement": "Free sign-up",
      "url": "https://example.com/club/"
    }
  }
}
```

### Review of something you don't sell (review snippet)
```json
{
  "@context": "https://schema.org",
  "@type": "Review",
  "itemReviewed": { "@type": "Book", "name": "The Garden Year", "author": { "@type": "Person", "name": "Ana Ruiz" } },
  "author": { "@type": "Person", "name": "Sam Lee" },
  "datePublished": "2026-10-02",
  "reviewRating": { "@type": "Rating", "ratingValue": "4", "bestRating": "5" },
  "reviewBody": "Clear, practical and beautifully illustrated."
}
```

### Employer rating (on a site that collects reviews of employers)
```json
{
  "@context": "https://schema.org",
  "@type": "EmployerAggregateRating",
  "itemReviewed": { "@type": "Organization", "name": "Acme Builders", "sameAs": "https://acme-builders.example.com/" },
  "ratingValue": "4.1",
  "ratingCount": "212",
  "bestRating": "5",
  "worstRating": "1"
}
```

### Local business (LOCAL-05)
```json
{
  "@context": "https://schema.org",
  "@type": "Plumber",
  "@id": "https://example.com/#business",
  "name": "Brand Plumbing",
  "url": "https://example.com/",
  "logo": "https://example.com/logo-512.png",
  "image": "https://example.com/photos/van.jpg",
  "telephone": "+44 113 496 0000",
  "priceRange": "££",
  "address": { "@type": "PostalAddress", "streetAddress": "1 High Street", "addressLocality": "Leeds", "postalCode": "LS1 1AA", "addressCountry": "GB" },
  "geo": { "@type": "GeoCoordinates", "latitude": 53.79648, "longitude": -1.54785 },
  "openingHoursSpecification": [{ "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "opens": "08:00", "closes": "18:00" }]
}
```

### Article, with the parts to read aloud (speakable)
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Council approves new cycle lanes for the city centre",
  "image": ["https://example.com/photos/cycle-lanes-16x9.jpg"],
  "datePublished": "2026-11-18T08:00:00+00:00",
  "dateModified": "2026-11-18T11:30:00+00:00",
  "author": [{ "@type": "Person", "name": "Jo Patel", "url": "https://example.com/authors/jo-patel/" }],
  "speakable": { "@type": "SpeakableSpecification", "cssSelector": [".headline", ".summary"] }
}
```

### Article behind a paywall (so Google doesn't read it as cloaking)
```json
{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "What the new energy price cap means for your bills",
  "image": ["https://example.com/photos/energy-bills-16x9.jpg"],
  "datePublished": "2026-11-19T07:00:00+00:00",
  "dateModified": "2026-11-19T07:00:00+00:00",
  "author": [{ "@type": "Person", "name": "Jo Patel", "url": "https://example.com/authors/jo-patel/" }],
  "isAccessibleForFree": false,
  "hasPart": { "@type": "WebPageElement", "isAccessibleForFree": false, "cssSelector": ".paywall" }
}
```

### Breadcrumb (SCHEMA-07)
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Guides", "item": "https://example.com/guides/" },
    { "@type": "ListItem", "position": 2, "name": "Heating", "item": "https://example.com/guides/heating/" },
    { "@type": "ListItem", "position": 3, "name": "Bleeding a radiator" }
  ]
}
```

### Course list, shown as a carousel (at least three courses)
```json
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "item": { "@type": "Course", "url": "https://example.com/courses/plumbing-basics/", "name": "Plumbing basics", "description": "Pipes, joints and simple repairs, in six short lessons.", "provider": { "@type": "Organization", "name": "Brand", "sameAs": "https://example.com/" } } },
    { "@type": "ListItem", "position": 2, "item": { "@type": "Course", "url": "https://example.com/courses/boiler-care/", "name": "Boiler care", "description": "Keep a gas boiler safe and efficient between services.", "provider": { "@type": "Organization", "name": "Brand", "sameAs": "https://example.com/" } } },
    { "@type": "ListItem", "position": 3, "item": { "@type": "Course", "url": "https://example.com/courses/bathroom-fitting/", "name": "Bathroom fitting", "description": "Plan and fit a bathroom suite, from the first measurements to the last seal.", "provider": { "@type": "Organization", "name": "Brand", "sameAs": "https://example.com/" } } }
  ]
}
```

### Movie
```json
{
  "@context": "https://schema.org",
  "@type": "Movie",
  "name": "The Long Winter",
  "url": "https://example.com/films/the-long-winter/",
  "image": "https://example.com/posters/the-long-winter.jpg",
  "dateCreated": "2025-03-14",
  "director": { "@type": "Person", "name": "Ana Ruiz" }
}
```

### Event
```json
{
  "@context": "https://schema.org",
  "@type": "Event",
  "name": "Winter craft fair",
  "description": "Forty local makers selling prints, pottery, knitwear and food, with workshops for children.",
  "startDate": "2026-12-05T10:00:00+00:00",
  "endDate": "2026-12-05T16:00:00+00:00",
  "eventStatus": "https://schema.org/EventScheduled",
  "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
  "location": { "@type": "Place", "name": "Example Hall", "address": { "@type": "PostalAddress", "streetAddress": "1 High Street", "addressLocality": "Leeds", "postalCode": "LS1 1AA", "addressCountry": "GB" } },
  "image": ["https://example.com/photos/craft-fair-16x9.jpg"],
  "offers": { "@type": "Offer", "url": "https://example.com/events/craft-fair/", "price": "5.00", "priceCurrency": "GBP", "availability": "https://schema.org/InStock", "validFrom": "2026-11-01T09:00:00+00:00" },
  "organizer": { "@type": "Organization", "name": "Brand", "url": "https://example.com/" },
  "performer": { "@type": "PerformingGroup", "name": "Leeds Community Choir" }
}
```

### Job posting
```json
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Plumbing apprentice",
  "description": "<p>Learn the trade on real jobs across Leeds, with a day a week at college. Full training, a van once you qualify, and a guaranteed job at the end.</p>",
  "datePosted": "2026-11-15",
  "validThrough": "2026-12-31T23:59:00+00:00",
  "employmentType": "FULL_TIME",
  "hiringOrganization": { "@type": "Organization", "name": "Brand", "sameAs": "https://example.com/", "logo": "https://example.com/logo-512.png" },
  "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "streetAddress": "1 High Street", "addressLocality": "Leeds", "postalCode": "LS1 1AA", "addressCountry": "GB" } },
  "baseSalary": { "@type": "MonetaryAmount", "currency": "GBP", "value": { "@type": "QuantitativeValue", "value": 24000, "unitText": "YEAR" } }
}
```

### Recipe
```json
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Leek and potato soup",
  "image": ["https://example.com/photos/soup-1x1.jpg", "https://example.com/photos/soup-4x3.jpg", "https://example.com/photos/soup-16x9.jpg"],
  "author": { "@type": "Person", "name": "Ana Ruiz" },
  "datePublished": "2026-10-01",
  "description": "A thick, comforting soup, ready in 40 minutes.",
  "prepTime": "PT10M",
  "cookTime": "PT30M",
  "totalTime": "PT40M",
  "recipeYield": "4",
  "recipeCategory": "Soup",
  "recipeCuisine": "British",
  "keywords": "leek soup, potato soup",
  "nutrition": { "@type": "NutritionInformation", "calories": "210 calories" },
  "recipeIngredient": ["3 leeks, sliced", "2 potatoes, diced", "1 litre vegetable stock"],
  "recipeInstructions": [
    { "@type": "HowToStep", "text": "Soften the leeks in butter for 10 minutes." },
    { "@type": "HowToStep", "text": "Add the potatoes and stock and simmer for 20 minutes." },
    { "@type": "HowToStep", "text": "Blend until smooth and season to taste." }
  ]
}
```

### Video, with key moments
```json
{
  "@context": "https://schema.org",
  "@type": "VideoObject",
  "name": "How to bleed a radiator",
  "description": "A two-minute guide to bleeding a radiator safely.",
  "thumbnailUrl": ["https://example.com/video/bleed-radiator-16x9.jpg"],
  "uploadDate": "2026-10-10T08:00:00+00:00",
  "duration": "PT2M10S",
  "contentUrl": "https://example.com/video/bleed-radiator.mp4",
  "embedUrl": "https://example.com/embed/bleed-radiator",
  "hasPart": [
    { "@type": "Clip", "name": "Turn the heating off", "startOffset": 0, "endOffset": 25, "url": "https://example.com/video/bleed-radiator/?t=0" },
    { "@type": "Clip", "name": "Open the bleed valve", "startOffset": 25, "endOffset": 80, "url": "https://example.com/video/bleed-radiator/?t=25" }
  ]
}
```

### Image licence details (Licensable badge in Google Images, MEDIA rules)
```json
{
  "@context": "https://schema.org",
  "@type": "ImageObject",
  "contentUrl": "https://example.com/photos/black-labrador-puppy.jpg",
  "license": "https://example.com/image-licence/",
  "acquireLicensePage": "https://example.com/how-to-use-our-photos/",
  "creditText": "Brand Photography",
  "creator": { "@type": "Person", "name": "Ana Ruiz" },
  "copyrightNotice": "© 2026 Brand"
}
```

### Discussion forum thread
```json
{
  "@context": "https://schema.org",
  "@type": "DiscussionForumPosting",
  "headline": "Best way to bleed an old radiator?",
  "text": "The valve on my 1970s radiator won't turn. Is there a safe way to free it?",
  "url": "https://example.com/forum/threads/1234/",
  "author": { "@type": "Person", "name": "PipeFixer", "url": "https://example.com/forum/users/pipefixer/" },
  "datePublished": "2026-11-02T09:15:00+00:00",
  "interactionStatistic": { "@type": "InteractionCounter", "interactionType": "https://schema.org/LikeAction", "userInteractionCount": 12 },
  "comment": [{
    "@type": "Comment",
    "text": "Soak it in penetrating oil overnight, then use a proper bleed key.",
    "author": { "@type": "Person", "name": "OldHand", "url": "https://example.com/forum/users/oldhand/" },
    "datePublished": "2026-11-02T10:02:00+00:00"
  }]
}
```

### Q&A page (one question, answers from users)
```json
{
  "@context": "https://schema.org",
  "@type": "QAPage",
  "mainEntity": {
    "@type": "Question",
    "name": "How often should a boiler be serviced?",
    "text": "My gas boiler is three years old. How often does it need a service?",
    "answerCount": 2,
    "datePublished": "2026-10-20T10:00:00+00:00",
    "author": { "@type": "Person", "name": "Chris", "url": "https://example.com/users/chris/" },
    "acceptedAnswer": { "@type": "Answer", "text": "Once a year. Most warranties also require a yearly service by a Gas Safe engineer.", "datePublished": "2026-10-20T11:00:00+00:00", "upvoteCount": 14, "url": "https://example.com/questions/boiler-service/#answer-1", "author": { "@type": "Person", "name": "Jo Patel", "url": "https://example.com/users/jo/" } },
    "suggestedAnswer": [{ "@type": "Answer", "text": "Every year, ideally before winter when engineers get busy.", "datePublished": "2026-10-21T09:00:00+00:00", "upvoteCount": 3, "url": "https://example.com/questions/boiler-service/#answer-2", "author": { "@type": "Person", "name": "Sam", "url": "https://example.com/users/sam/" } }]
  }
}
```

### Profile page (an author or member page)
```json
{
  "@context": "https://schema.org",
  "@type": "ProfilePage",
  "dateCreated": "2024-06-01T09:00:00+00:00",
  "dateModified": "2026-11-01T14:20:00+00:00",
  "mainEntity": {
    "@type": "Person",
    "name": "Jo Patel",
    "alternateName": "jopatel",
    "identifier": "1234",
    "description": "Heating engineer and writer of our boiler guides.",
    "image": "https://example.com/authors/jo-patel.jpg",
    "sameAs": ["https://www.linkedin.com/in/example"]
  }
}
```

### Software app (only with real ratings shown on the page)
```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Brand Budget",
  "operatingSystem": "Android, iOS",
  "applicationCategory": "FinanceApplication",
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "GBP" },
  "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.6", "ratingCount": "1250", "bestRating": "5" }
}
```

### Vacation rental (Google also wants at least 8 photos: bedroom, bathroom and living area)
```json
{
  "@context": "https://schema.org",
  "@type": "VacationRental",
  "additionalType": "Cottage",
  "identifier": "COT-118",
  "name": "Riverside cottage",
  "url": "https://example.com/stays/riverside-cottage/",
  "image": ["https://example.com/stays/riverside/1.jpg", "https://example.com/stays/riverside/2.jpg", "https://example.com/stays/riverside/3.jpg"],
  "latitude": 54.37158,
  "longitude": -2.91046,
  "address": { "@type": "PostalAddress", "streetAddress": "2 River Lane", "addressLocality": "Ambleside", "postalCode": "LA22 0AA", "addressCountry": "GB" },
  "checkinTime": "15:00:00+00:00",
  "checkoutTime": "10:00:00+00:00",
  "containsPlace": {
    "@type": "Accommodation",
    "additionalType": "EntirePlace",
    "occupancy": { "@type": "QuantitativeValue", "value": 4 },
    "numberOfBedrooms": 2,
    "numberOfBathroomsTotal": 1,
    "amenityFeature": [{ "@type": "LocationFeatureSpecification", "name": "wifi", "value": true }]
  }
}
```

### Dataset (Google Dataset Search only, not Google Search results)
```json
{
  "@context": "https://schema.org",
  "@type": "Dataset",
  "name": "Leeds household water use, 2020 to 2025",
  "description": "Monthly household water use for each Leeds postcode district from 2020 to 2025, in litres per household per day, from smart meter readings.",
  "url": "https://example.com/data/water-use/",
  "identifier": "https://doi.org/10.1234/example.5678",
  "keywords": ["water use", "households", "Leeds"],
  "license": "https://creativecommons.org/licenses/by/4.0/",
  "isAccessibleForFree": true,
  "version": "2.1",
  "creator": { "@type": "Organization", "name": "Brand", "url": "https://example.com/" },
  "includedInDataCatalog": { "@type": "DataCatalog", "name": "Brand open data", "url": "https://example.com/data/" },
  "distribution": [{ "@type": "DataDownload", "encodingFormat": "text/csv", "contentUrl": "https://example.com/data/water-use.csv" }]
}
```

### Flashcards (education Q&A)
```json
{
  "@context": "https://schema.org",
  "@type": "Quiz",
  "about": { "@type": "Thing", "name": "Blood" },
  "educationalAlignment": [{ "@type": "AlignmentObject", "alignmentType": "educationalSubject", "targetName": "Biology" }],
  "hasPart": [{
    "@type": "Question",
    "eduQuestionType": "Flashcard",
    "text": "What carries oxygen in red blood cells?",
    "acceptedAnswer": { "@type": "Answer", "text": "Haemoglobin" }
  }]
}
```

### Math solver
```json
{
  "@context": "https://schema.org",
  "@type": ["MathSolver", "LearningResource"],
  "name": "Brand equation solver",
  "url": "https://example.com/solver/",
  "usageInfo": "https://example.com/privacy/",
  "inLanguage": "en",
  "learningResourceType": "Math Solver",
  "potentialAction": [{
    "@type": "SolveMathAction",
    "target": "https://example.com/solver/?q={math_expression_string}",
    "mathExpression-input": "required name=math_expression_string",
    "eduQuestionType": ["Polynomial Equation", "Derivative"]
  }]
}
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
