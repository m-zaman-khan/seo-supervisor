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
