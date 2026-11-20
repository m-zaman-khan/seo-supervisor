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
- **Crawler:** with outside checks on and Chrome or Edge installed, up to 10 sample pages are rendered headless and compared with the raw HTML: title, canonical, robots, H1, JSON-LD count and link count (`render-changes-head`, and `render-adds-content` under REND-01). Pages with a meta refresh are skipped. With `--render all` on top of `--outside`, every indexable page is rendered instead of the sample, up to 200 (about 5 s a page); the time estimate prints before the first render, and a note says how many pages the cap left out. When Chrome can't load a page (it reports `net::ERR_…`, shows its own `chrome-error://` page or returns an empty page), that page isn't compared: the failure goes into the notes, and REND-06 stays under Limits when no page rendered.

### REND-07 · Mobile shows the same content as desktop · blocker
- **Check:** compare a mobile and a desktop render of key templates (Google indexes mobile-first, fully since 2024).
- **Pass:** same main content, headings, structured data, titles, descriptions, alt text and robots meta on mobile. Primary content isn't hidden behind interaction-only lazy loading.
- **Crawler:** with outside checks on and Chrome or Edge installed, the render sample is also loaded at desktop (1366×768) and phone size (390×844, touch, mobile user agent), with screenshots in `seo-audit/screenshots/`. `mobile-content-missing` flags a page whose main text on a phone has under 70% of desktop's words, counted from the page's DOM (so sections collapsed with CSS or a closed `<details>` still count), or whose phone H1 shows less than half of the desktop H1's words. Without outside checks REND-07 stays under Limits.

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
- **Charset mismatch:** `charset-mismatch` (medium) flags a page whose Content-Type header and meta charset name different encodings. Names are compared as browsers read them, so `latin1`, `iso-8859-1` and `windows-1252` agree. The header wins, so text saved in the meta tag's encoding comes out garbled; serve and declare UTF-8 in both.
- **Crawler (outside checks):** on the phone load, `mobile-overflow` flags a page wider than the screen (sideways scrolling; overflow clipped with `overflow-x: hidden` or `clip` on html or body isn't flagged) and `mobile-small-text` flags main text (the size most `p`, `li` and `td` text uses) under 12 px. Pages without a mobile viewport are left to `doc-basics`.
- **Tap targets (outside checks):** `tap-targets-small` (low) flags a phone page with links or buttons under 24×24 CSS px whose 24 px circle, centred on each, touches another link or button or another small one's circle (WCAG 2.2 success criterion 2.5.8, Target Size (Minimum), with its spacing exception; Lighthouse 12 replaced its tap-targets audit with this standard's `target-size`). Links inside a sentence, visually hidden skip links and closed off-screen menus don't count. Fix with padding, or 24 px from the centre of one small icon to the next.
- **Form fields (outside checks):** `input-zoom` (low) flags a phone page with visible text fields, selects or text areas whose text is under 16 px, because Safari on iPhone zooms the page in when one is tapped. WebKit's `-[WKWebView _zoomToFocusRect:…]` (`Source/WebKit/UIProcess/API/ios/WKWebViewIOS.mm`) zooms to 16 ÷ the field's text size, capped at the viewport's `maximum-scale`, and skips a change under 10%, so a 15 px field doesn't zoom; `user-scalable=no` stops it too (`_zoomToRevealFocusedElement` in `WKContentViewInteraction.mm`). Sizes are measured in Chrome, which gives unstyled fields 13.33 px, so those count. Hidden, disabled and read-only fields, checkboxes and buttons don't. Fix with `font-size: 16px` (or `1rem`) on fields, not with `maximum-scale=1`, which on Android also stops visitors zooming in to read.
- **Phone text (outside checks, information only):** main text from 12 px up to 16 px on the phone load goes in the notes. It never becomes a finding or changes the score; under 12 px stays `mobile-small-text`.

### REND-10 · No obsolete HTML tags · low
- **Check:** crawler `obsolete-tags`: `<frameset>`, `<frame>`, `<marquee>`, `<blink>`, `<font>` or `<center>` anywhere in the server HTML. `<iframe>` is fine, and so are custom elements such as `<font-awesome-icon>`.
- **Pass:** content lives in ordinary pages, not frames, and styling lives in CSS.
- **Fix:** replace a frameset with real pages, each with its own URL and links (search engines index each frame's document on its own, without the frame around it). Move what `<font>`, `<center>`, `<marquee>` and `<blink>` do into CSS. Old templates and text pasted from word processors are the usual source.
