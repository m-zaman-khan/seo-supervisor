# Trust and security (TRUST)

### TRUST-01 · HTTPS with security headers · low (high for security, finance and health sites)
- **Check:** crawler `sec-headers`, `mixed-content`. Check production too: CDNs often add or strip headers.
- **Pass:** HTTPS only. `Strict-Transport-Security`, `Content-Security-Policy` (with `frame-ancestors`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. No HTTP resources on HTTPS pages.
- **Live check:** `--check-live` reads HSTS from the production origin itself (`no-hsts`), since a CDN often adds or strips it.

### TRUST-02 · /.well-known/security.txt is published · low (high for security companies)
- **Check:** crawler `security-txt`.
- **Pass:** RFC 9116 with `Contact` and `Expires` (renewed before it lapses), plus `Policy` and `Canonical`.

### TRUST-03 · Privacy is stated wherever visitors enter data · medium
- **Check:** content: forms, tools, calculators.
- **Pass:** one line by the form says what's stored and for how long, linking to the privacy policy. Secrets (passwords, tokens, keys) are processed in the browser and never logged, put in URLs or sent to analytics.

### TRUST-04 · Who's behind the site is clear · medium
- **Check:** content: About, Contact, author pages, methodology or "how we test" pages, editorial policy.
- **Pass:** a real organization with a contact route, named experts with credentials (CONTENT-07), and how claims and results are produced. Tool sites need a methodology page per tool family that names its standards, data sources and limits (TOOL-11).

### TRUST-05 · No fake trust signals · blocker
- **Check:** content and schema: ratings, review counts, testimonials, "as seen in" logos, certifications, years in business, team photos.
- **Pass:** every one is real and verifiable. Imported or AI-rewritten reviews are never presented as verified (in some places, such as the UK under the DMCC Act 2024, this is illegal). Review requests go to every customer, with no gating.
- **Fix:** remove anything unsourced. Ask the owner (`needs-decision`) rather than keep it.

### TRUST-06 · The site passes its own claims · medium
- **Check:** whatever the site sells or tests, it does well itself. A security company scores well on security headers (with HSTS on the preload list once stable) and DNS: SPF, DKIM, DMARC at `p=reject`, CAA, and DNSSEC where the DNS host supports it. A speed agency passes CWV. An accessibility firm passes WCAG basics.

### TRUST-07 · The HTTPS certificate is trusted, covers every host and renews in time · blocker
- **Check:** `--check-live` on the production origin: trust, both the apex and www host (when the other host answers), and time left.
- **Pass:** trusted; covers every host that answers; and not yet near expiry: more time left than a third of its lifetime or 30 days, whichever is sooner. A healthy 6-day certificate with 4 days left passes.
- **Severity:** blocker when untrusted, missing a host, expired or under 2 days left; high when less time is left than a third of its lifetime or 30 days, whichever is sooner (30 days when the lifetime can't be read). The threshold scales because certificates are getting shorter: CA/Browser Forum limits fall to 200 days from March 2026 and 47 days by 2029, and some CAs issue 6-day certificates. A healthy short certificate isn't flagged.
- **Fix:** automatic renewal at the host or CDN, issued for both hosts.
