# Interactive tools: checkers, calculators, generators, scanners (TOOL)

Public tools rank as pages, so the tool page is the SEO page. These rules add to `rules/`. Copy-ready JSON-LD for tool pages is in `examples/snippets.md`.

### TOOL-01 · One tool registry drives everything · high
One list (a DB table or typed file) is the source for pages, static params, the sitemap, related links, llms.txt and schema.
```ts
type Tool = {
  slug: string;            // "ssl-checker": the words people search; permanent (URL-01)
  name: string;            // "SSL Checker"
  family: string;          // "ssl-tls": groups tools on the hub; not part of the URL unless the profile says so
  status: "draft" | "live" | "retired";
  summary: string;         // 120–160 chars → meta description
  intro: string;           // 40–60 words → answer-first paragraph under the H1
  checks: string[];        // what the tool tests, in plain words
  faqs: { q: string; a: string }[];
  related: string[];       // 3–6 sibling slugs, same family
  next: string[];          // 1–2 "next check" slugs
  guides: string[];        // guide slugs that explain findings
  templates: string[];     // template/checklist slugs that help fix findings
  updatedAt: string;       // last real content OR check-logic change (not deploys, dependency bumps, CSS)
  redirectFrom?: string[]; // old slugs → 301s
  successor?: string;      // retired tools: where to send visitors
};
```
- Only `live` tools are routable, listed and linked. `retired` with a successor 301s to it; without one, it returns 410 and leaves the sitemap. `draft` returns 404 in production.
- When tools come from a separate API, serve the registry from a cacheable endpoint (`GET /v1/tools`, `GET /v1/tools/{slug}`, with `ETag` and `Cache-Control`). The site reads it at build or revalidation time, never per visitor.
- The engineers who build each tool write 4–6 real FAQs while building it. Take the questions from support tickets, Reddit threads and "People also ask". Each answer is 40–60 words, and its first sentence answers the question directly.

### TOOL-02 · The tool page follows a fixed order · high
1. Breadcrumb.
2. H1 with the tool name people search for ("DMARC Record Checker").
3. Intro of 40–60 words.
4. **The tool, visible without scrolling** on desktop and mobile.
5. How to use it (3–5 steps).
6. What it checks.
7. How to read your results.
8. Common problems and fixes (links to guides).
9. FAQ: each question is an H3 under the FAQ H2.
10. Related tools and the next check.
11. Call to action (API, monitoring, paid plan).

Under the H1 or at the end, a line reads "Reviewed by {name}, {credential} · Updated {date}", linked to the author page (CONTENT-07).

### TOOL-03 · Input fields are real form markup · high
- One `<form>` per tool, a visible `<label for>` on every field, and helper text linked with `aria-describedby`. Placeholder text is not a label: it disappears when someone types and many screen readers skip it.
- A real submit `<button>`, so Enter works. Its text and the labels use the searched words: "Check SSL certificate", "Scan security headers", "Look up DMARC record"; "Domain or URL", "Email address to test". Never "Submit".
- Input types:
  - **Domain / host:** `type=text inputmode=url autocapitalize=none spellcheck=false`. `type=url` rejects `example.com`. Accept `https://example.com/path` and strip it down yourself.
  - **Email:** `type=email`.
  - **Port:** `inputmode=numeric` with a 1–65535 check.
  - **IP:** `type=text`. IPv6 has letters and colons.
  - **Password checker:** `type=password` with a show button and `autocomplete=off`.
- Errors are text tied to the field (`aria-describedby`, `role=alert`) that say how to fix it: "Enter a domain without spaces, like example.com."
- A "Try an example" button fills the field and runs the check. Use a domain you control or a public test domain (e.g. `badssl.com` subdomains for TLS).
```html
<form id="dmarc-form" action="/tools/dmarc-checker/" method="get">
  <label for="domain">Domain</label>
  <input id="domain" name="domain" type="text" inputmode="url" autocapitalize="none" spellcheck="false"
         placeholder="example.com" required aria-describedby="domain-help domain-error">
  <p id="domain-help">Enter a domain like example.com. We look up _dmarc.example.com.</p>
  <p id="domain-error" role="alert" hidden></p>
  <button type="submit">Check DMARC record</button>
</form>
```

### TOOL-04 · Results are real HTML · high
- **Structure:** a "Results for {domain}" heading, then one sub-heading per group of checks. Tables are real `<table>`s with a `<caption>` and `<th scope>`; key/value data uses `<dl>`. Nothing lives only in a canvas, an image or a tooltip.
- **Status:** written in words ("Pass", "Warning", "Fail"), with icons marked `aria-hidden`. A–F grades are shown as text, not colour alone.
- **Layout:** the results area reserves its space, so it doesn't push content down (CLS).
- **Waiting and failure:** loading text names the step and the usual time ("Checking certificate chain… usually 3–5 seconds"). Errors give the cause and the fix ("We couldn't reach example.com on port 443. Check the domain resolves and the port is open.").
- **Finding codes:** each finding has a stable code that maps, through the registry, to a fix guide and a related tool:
```json
{ "target": "example.com", "grade": "B", "findings": [
  { "code": "HSTS_MISSING", "severity": "warning", "title": "HSTS header is missing",
    "detail": "Browsers may connect over plain HTTP before redirecting.",
    "guide": "how-to-set-up-hsts", "nextTool": "hsts-checker" } ] }
```
- **Sharing:** results can be copied or exported (text, Markdown, JSON) with a link back to the tool.

### TOOL-05 · Scan results stay out of the index; prefill links help · high
- Show results on the tool page itself. Never index `/report/example.com`-style pages: thousands of thin, near-identical pages that also publish data about other people's domains.
- Shareable report links (`/r/{id}/`) send `X-Robots-Tag: noindex, follow` (header snippet in `frameworks/nextjs.md`), stay out of the sitemap, aren't blocked in robots.txt, and expire.
- Prefill links (`/tools/ssl-checker/?domain=example.com`) fill the field and run the check, which earns links from docs and forums. The canonical stays the clean URL, and the H1, intro and FAQ render exactly as on the clean URL.
- Never mark up scanned data in schema.

### TOOL-06 · Secrets never leave the browser · blocker
Password, hash, JWT, key and Base64 tools run client-side and say so under the form: "Runs in your browser. Nothing you enter is sent to our servers." Inputs never go into URLs, logs or analytics events.

### TOOL-07 · Abuse protection never blocks crawlers · high
- Rate-limit the endpoint that runs checks, per IP. Show a captcha (e.g. Cloudflare Turnstile) only on submit, and only after a visitor passes the limit. Never challenge the HTML page.
- **Passive checks** (DNS records, headers, certificates) are open to anyone. **Active checks** (port scans, crawls) run only against targets the visitor has verified, e.g. with a DNS TXT record.
- The CDN or WAF lets verified search and AI-search bots through (CRAWL-09, AI-02).

### TOOL-08 · Tool schema · medium
- WebPage, WebApplication (`applicationCategory` from Google's list, e.g. `SecurityApplication`; `operatingSystem: "Any"`; `browserRequirements`; `isAccessibleForFree: true`; Offer `price: "0"`), BreadcrumbList, and FAQPage when the FAQ is visible, all in one `@graph` linked by `@id` (full example in `examples/snippets.md`).
- **Ratings:** a rating only from real ratings collected and shown on the page. Leaving `aggregateRating` out keeps the markup valid; it just won't show stars. To earn stars, add an on-page "Was this useful?" rating, show the average and count, and build `aggregateRating` from that data. A made-up rating can cost the whole site its rich results.

### TOOL-09 · Up, sideways, forward: the loops · medium
- **Up:** breadcrumb to the tools hub and to `/resources/` (or whatever the profile's parent is).
- **Sideways:** 3–6 siblings from the registry's `related` list, or from the same family if `related` is empty.
- **Forward:** 1–2 `next` checks; the last tool in a family points back to the first.
- **Cross-family bridge:** where a check belongs to two families (SPF and DMARC are email settings stored in DNS), one bridge link per tool.
- **Guides:** findings link to fix guides, and each guide has a "Test it now" link near the top and again at the end.
```ts
export function toolLinks(tool: Tool, liveTools: Map<string, Tool>, liveGuides: Map<string, Guide>) {
  const live = (slugs: string[]) => slugs.map(s => liveTools.get(s)).filter((t): t is Tool => !!t);
  const listed = live(tool.related);
  const siblings = (listed.length ? listed : [...liveTools.values()].filter(t => t.family === tool.family && t.slug !== tool.slug)).slice(0, 6);
  return { up: "/tools/", siblings, next: live(tool.next).slice(0, 2),
           guides: tool.guides.map(g => liveGuides.get(g)).filter((g): g is Guide => !!g) };
}
```

### TOOL-10 · Acceptable use is published and enforced · medium
An acceptable-use page says what the tools may be used against, and the code enforces it (TOOL-07). It goes with a vulnerability disclosure policy and `security.txt` (TRUST-02).

### TOOL-11 · A methodology page per tool family · medium
Each family says how its checks work and links from the tool's "What this tool checks" section:
- **Standards:** e.g. RFC 7489 for DMARC, RFC 6797 for HSTS, Mozilla's TLS recommendations, the OWASP Secure Headers Project.
- **Data sources:** where the results come from.
- **Limits:** what the tool can't detect.

This builds trust, and other sites cite it.

### TOOL-12 · Tool usage is measured · medium
Analytics events: `tool_view`, `tool_submit`, `tool_result` (with status), `tool_error`, `copy_result`, `next_check_click`, `guide_click`. Never include the scanned domain, typed input or secrets.
