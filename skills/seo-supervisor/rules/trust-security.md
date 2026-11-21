# Trust and security (TRUST)

### TRUST-01 · HTTPS with security headers · low (high for security, finance and health sites)
- **Check:** crawler `sec-headers` (now including `Permissions-Policy`), `mixed-content`. Check production too: CDNs often add or strip headers.
- **Mixed content (`mixed-content`, medium):** an https page (or, on a local crawl, a page whose public origin is https) that loads another site's files over `http://`: stylesheets, preloads and scripts in the head, and images (`srcset` too), video, audio, `<source>`, `<track>`, embeds, objects and frames. Browsers block the first kind outright (W3C Mixed Content) and upgrade or block the rest. A page or header CSP with `upgrade-insecure-requests` passes, and a local build's own files don't count.
- **Pass:** HTTPS only. `Strict-Transport-Security`, `Content-Security-Policy` (with `frame-ancestors`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. No HTTP resources on HTTPS pages.
- **Live check:** `--check-live` reads HSTS from the production origin itself (`no-hsts`), since a CDN often adds or strips it.
- **Old TLS:** `--check-live` also tries a TLS 1.0 and a TLS 1.1 handshake with the production origin (`tls-old-versions`, low). RFC 8996 (2021) says neither may be used; turn both off at the server or CDN and keep TLS 1.2 and 1.3. A handshake that fails or times out counts as refused.
- **Crawler, each low:**
  - `cookie-flags`: a cookie in a `Set-Cookie` header on an HTML page without `HttpOnly` or `SameSite`, or without `Secure` on an HTTPS crawl (local dev servers leave it off). Cookies that scripts set (analytics, consent banners) aren't seen, a CSRF-token cookie may skip `HttpOnly` because a script must read it, and cookies being deleted are skipped.
  - `hsts-short`: the home page's HSTS `max-age` is under 31536000 (a year, the minimum hstspreload.org asks for).
  - `referrer-unsafe`: `Referrer-Policy: unsafe-url` in the header (the last valid value counts) or in `<meta name="referrer">`. The W3C spec calls it unsafe: it leaks full addresses from HTTPS pages to insecure sites.
  - `csp-weak`: the home page's `Content-Security-Policy` lets scripts run inline (`'unsafe-inline'` with no nonce or hash) or through `'unsafe-eval'`, lets them load from any site (`*`, `http:`, `https:`, `data:` without `'strict-dynamic'`), has no `script-src`/`default-src` or `object-src`/`default-src`, or has a nonce policy with no `base-uri`. These are the gaps Google's CSP Evaluator reports; the strict form web.dev recommends is `script-src 'nonce-…' 'strict-dynamic'; object-src 'none'; base-uri 'none'`. Several policies all apply, so a gap counts only when every policy has it.
  - `hsts-invalid`: the first HSTS header (the only one browsers read) repeats a directive, has no `max-age` or a `max-age` that isn't whole seconds, or breaks the syntax. RFC 6797 says browsers then ignore the whole header, so the site has no HSTS.
  - `hsts-no-subdomains`: a valid HSTS header without `includeSubDomains`. Check that every subdomain works over HTTPS before adding it.
- **HSTS preload (information):** the report says whether the home page's header meets the preload list's header rules (hstspreload.org: `max-age` of at least 31536000, `includeSubDomains`, `preload`) and what it lacks. The list also needs the header on the bare domain, http:// sent to https:// on the same host first, and every subdomain on HTTPS. Joining is optional and slow to undo, so it never changes the score.
- **Server version (`server-known-holes`, needs-decision):** a `Server` header naming an Apache httpd or nginx version that the maker's own advisory lists with a hole at its top rating (Apache "critical": 2.4.49 and 2.4.50, CVE-2021-41773 and CVE-2021-42013; 2.4.55 to 2.4.70, CVE-2026-119618 in mod_http2. nginx "major": 1.9.5 to 1.31.8, CVE-2026-123007 in HTTP/2; fixed in mainline 1.31.9 and stable 1.30.7, so 1.30.7 to 1.30.x is safe while 1.31.0 to 1.31.8 is not). A distribution's build (`Apache/2.4.62 (Ubuntu)`) is skipped, as distributions patch without changing the version, and so is a header without a version. Ask the owner whether it's patched. The list was checked on 2026-11-21 and is due for a re-check by 2027-05-21 (`checks/technical.mjs`).
- **The audit's own safety:** headless Chrome (renders, phone and desktop loads) and Lighthouse can't reach private or cloud-metadata addresses (169.254.169.254, `metadata.google.internal`, 10.x, 192.168.x, other loopback addresses): a name counts by every address it resolves to, and only the site's own addresses stay open. Renders and Lighthouse go through a local guard proxy; phone and desktop loads check each request and run without service workers. With the owner's own proxy set (`HTTPS_PROXY`), Chrome goes through that instead and a note says the guard is off. Home folders, email addresses and tokens are masked in error messages, and secret query values (`token`, `key`, `password`, `signature`, `credential`…) in reported URLs.

### TRUST-02 · /.well-known/security.txt is published · low (high for security companies)
- **Check:** crawler `security-txt`.
- **Pass:** RFC 9116 with `Contact` and `Expires` (renewed before it lapses), plus `Policy` and `Canonical`.

### TRUST-03 · Privacy is stated wherever visitors enter data · medium
- **Check:** content: forms, tools, calculators.
- **Pass:** one line by the form says what's stored and for how long, linking to the privacy policy. Secrets (passwords, tokens, keys) are processed in the browser and never logged, put in URLs or sent to analytics.

### TRUST-04 · Who's behind the site is clear · medium
- **Check:** content: About, Contact, author pages, methodology or "how we test" pages, editorial policy.
- **Pass:** a real organization with a contact route, named experts with credentials (CONTENT-07), and how claims and results are produced. Tool sites need a methodology page per tool family that names its standards, data sources and limits (TOOL-11).
- **Trust view:** the crawler's About, contact, Organization schema and policy signals show in the Overview's "Trust signals (E-E-A-T)" view with what to add; they're suggestions that never change the score, and this rule is still judged from the content.

### TRUST-05 · No fake trust signals · blocker
- **Check:** content and schema: ratings, review counts, testimonials, "as seen in" logos, certifications, years in business, team photos.
- **Pass:** every one is real and verifiable. Imported or AI-rewritten reviews are never presented as verified (in some places, such as the UK under the DMCC Act 2024, this is illegal). Review requests go to every customer, with no gating.
- **US law:** the FTC's Consumer Reviews and Testimonials Rule (16 CFR Part 465), in force since 21 October 2024, bans fake and AI-written reviews, bought reviews, reviews by the business's own people that don't say so, and hiding bad reviews. The FTC can seek civil penalties of up to $53,088 per violation (ftc.gov).
- **Fix:** remove anything unsourced. Ask the owner (`needs-decision`) rather than keep it.

### TRUST-06 · The site passes its own claims · medium
- **Check:** whatever the site sells or tests, it does well itself. A security company scores well on security headers (with HSTS on the preload list once stable) and DNS: SPF, DKIM, DMARC at `p=reject`, CAA, and DNSSEC where the DNS host supports it. A speed agency passes CWV. An accessibility firm passes WCAG basics.

### TRUST-07 · The HTTPS certificate is trusted, covers every host and renews in time · blocker
- **Check:** `--check-live` on the production origin: trust, both the apex and www host (when the other host answers), and time left.
- **Pass:** trusted; covers every host that answers; and not yet near expiry: more time left than a third of its lifetime or 30 days, whichever is sooner. A healthy 6-day certificate with 4 days left passes.
- **Severity:** blocker when untrusted, missing a host, expired or under 2 days left; high when less time is left than a third of its lifetime or 30 days, whichever is sooner (30 days when the lifetime can't be read). The threshold scales because certificates are getting shorter: CA/Browser Forum limits fall to 200 days from March 2026 and 47 days by 2029, and some CAs issue 6-day certificates. A healthy short certificate isn't flagged.
- **Fix:** automatic renewal at the host or CDN, issued for both hosts.
- **Connection:** with `--check-live`, an HTTPS connection that fails is high. `https-unreachable`: the server refused the connection, dropped it or timed out. `https-missing`: no HTTPS at all, because port 443 doesn't speak TLS for the host name, or plain `http://` serves the site while `https://` doesn't connect. A production host that doesn't resolve in DNS is a note, and TRUST-07 and URL-03 stay under Limits.
