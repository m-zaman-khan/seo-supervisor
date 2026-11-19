# Rendering: what crawlers actually see (REND)

Google renders JavaScript, but later and not always. Most AI crawlers (GPTBot, ClaudeBot, PerplexityBot) don't render it at all. Judge pages by the HTML the server sends.

### REND-01 · Content is in the server HTML, not only in JavaScript · blocker
- **Check:** crawler `client-rendered`, plus words per page in `seo-crawl.json`. Spot-check the H1, H2s, JSON-LD and an FAQ answer with the curl commands in `examples/snippets.md`.
- **Pass:** the H1, intro, main copy, FAQ, links and JSON-LD are all in the HTML response. Only interactive widgets need client JavaScript.
- **Fix:** use server rendering or static generation (see the framework file). Never disable SSR for components that contain text.

### REND-02 · Collapsed content stays in the HTML · high
- **Check:** code: accordions, tabs, "show more", FAQ components that render with `{open && …}` or mount on click. Crawler `faq-not-visible` catches FAQ schema whose text is missing.
- **Pass:** collapsed content is rendered and hidden with CSS or a native `<details>` element.
- **Fix:** always render the content; toggle visibility with CSS, `hidden` or `inert`.

### REND-03 · Pages don't depend on a slow or failing API to render · high
- **Check:** code: page data fetching. Does a page call an external or scan API during render?
- **Pass:** page data comes from cached content (build time, ISR, or a cache). Live APIs are called only on user action. If they're down, the page still returns 200 with its content.
- **Fix:** move live calls behind the user action, and give the widget its own error state.

### REND-04 · Navigation uses real `<a href>` links · low
- **Check:** crawler `href-hash`. Code: `onClick` navigation, `href="#"`, `javascript:` links, links rendered only after JavaScript.
- **Fix:** use real links for navigation and `<button>` for actions.

### REND-06 · JavaScript doesn't fight the HTML · blocker
- **Check:** code: client code that edits robots meta, canonicals or status.
- **Pass:**
  - **Noindex:** a noindex in the server HTML can stop rendering, so removing it with JavaScript may never take effect.
  - **Canonical:** set it in the server HTML; JavaScript must not change it.
  - **Status:** only 200 pages are reliably rendered. SPA "not found" views redirect to a URL the server answers with 404, or inject noindex.
  - **Routing:** use the History API, not `#` routes.
- **Crawler:** with outside checks on and Chrome or Edge installed, up to 10 sample pages are rendered headless and compared with the raw HTML: title, canonical, robots, H1, JSON-LD count and link count (`render-changes-head`, and `render-adds-content` under REND-01). Pages with a meta refresh are skipped.

### REND-07 · Mobile shows the same content as desktop · blocker
- **Check:** compare a mobile and a desktop render of key templates (Google indexes mobile-first, fully since 2024).
- **Pass:** same main content, headings, structured data, titles, descriptions, alt text and robots meta on mobile. Primary content isn't hidden behind interaction-only lazy loading.
- **Crawler:** with outside checks on and Chrome or Edge installed, the render sample is also loaded at desktop (1366×768) and phone size (390×844, touch, mobile user agent), with screenshots in `seo-audit/screenshots/`. `mobile-content-missing` flags a page whose visible main text on a phone is under 70% of desktop's, or whose desktop H1 isn't shown on a phone. Without outside checks REND-07 stays under Limits.

### REND-08 · HTML stays under Googlebot's 2 MB limit · high
- **Check:** crawler `html-size` (flags anything over 500 KB; over 2 MB is high).
- **Pass:** Googlebot reads only the first 2 MB of each HTML response; content past that isn't indexed. Keep the title, meta, canonical and JSON-LD early in `<head>`, and move huge inline JSON (hydration data, big lists) out of the document.

### REND-05 · One title, canonical, robots tag and schema graph per page · high
- **Check:** crawler `title-multiple`, `canonical-multiple`. Code: layouts that hard-code a title, or two SEO plugins or helpers both writing tags.
- **Fix:** emit head tags from one place.

### REND-09 · Pages declare a doctype, a charset and a mobile viewport · medium
- **Check:** the crawler: `<!doctype html>` first, a charset (meta tag or Content-Type header) and `<meta name="viewport" content="width=device-width, …">`.
- **Pass:** every page has all three, from the shared layout.
- **Fix:** add them to the root layout. Without a doctype browsers use quirks mode; without a viewport phones show a zoomed-out desktop page, and Google indexes the mobile version.
- **Crawler (outside checks):** on the phone load, `mobile-overflow` flags a page wider than the screen (sideways scrolling) and `mobile-small-text` flags body text under 12 px. Pages without a mobile viewport are left to `doc-basics`.
