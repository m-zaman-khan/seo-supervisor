# Performance and Core Web Vitals (PERF)

> Thresholds checked **16 Nov 2026**, unchanged since INP replaced FID (March 2024): LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, measured at the 75th percentile of real mobile visits.

> Google says only Core Web Vitals are used by its ranking systems; other page-experience factors (HTTPS, popups) "don't directly help your website rank". Rate those by their effect on visitors and crawling, not as ranking levers.

### PERF-07 · Popups don't block content or crawlers · high
- **Check:** code: modals, consent walls, age gates, app banners.
- **Pass:** no popup covers the whole page on arrival. Users aren't redirected to a separate consent or input page (Googlebot would see only that page). Required gates (age, legal) overlay the content instead of replacing it.
- **Crawler:** with outside checks on, `mobile-interstitial` flags a fixed layer covering half the phone screen or more about a second after load. Sticky elements, app shells (layers holding `<main>` or the H1) and small cookie bars don't count, and a consent tool's layer is a note, since legally required notices are exempt. Popups shown later or on scroll still need a manual look.

### PERF-01 · Core Web Vitals pass on mobile · high
- **Check:** field data (Search Console CWV report, PageSpeed Insights or CrUX) when the site is live; lab data (Lighthouse) before launch. The crawler can't measure CWV, so list it under `notChecked` unless you ran one of these.
- **Fix:** send real-user metrics to analytics with the `web-vitals` library, and fix the worst template first.
- **Data source:** with outside checks on, the crawler (`--outside`) fetches field data from PageSpeed Insights for the home page and one URL per section, up to 10, and flags a section whose 75th-percentile LCP, INP or CLS fails (`cwv-fail`). It needs a free PageSpeed Insights API key in `PSI_API_KEY`: Google refuses almost all keyless requests. Without the key, without outside checks, or before launch, PERF-01 stays under Limits.
- **Lab speed:** with outside checks on and Chrome or Edge installed, each sample page is also loaded once on a phone with 4× CPU slowdown and slow 4G. LCP, CLS and an approximate TBT go into the crawl as `labSpeed` and one Overview line labelled indicative. They aren't Lighthouse numbers and raise no findings. With the optional Lighthouse add-on and `--lighthouse`, up to 5 sample pages also get a real Lighthouse run, which is information too: lab data never passes or fails PERF-01; use them before launch, when there's no real-user data. `--lighthouse all` runs it on every indexable page (up to 200, about 20 seconds a page).
- **LCP breakdown:** the Overview names the biggest of LCP's four parts (server response, the wait before the main image starts loading, its download, drawing it) with the fix for that part. It comes from real visitors with `CRUX_API_KEY`, else from the home page's lab run.
- **Since last audit** says a page got slower or faster only when the change is real, and never compares one source with another:
  - Real visitors: LCP moved 20% and 300 ms, or a Core Web Vital crossed its limit.
  - Lab load: LCP moved 40% and 1 s.
  - Lighthouse: the performance score moved 15 points.

### PERF-02 · Each page loads only its own code · medium
- **Check:** code: shared bundles importing every widget or heavy library; client components wrapping whole pages.
- **Fix:** dynamic import per widget, with server rendering kept on for anything with text.

### PERF-03 · The LCP element loads first · medium
- **Check:** crawler `lazy-lcp`, and `render-blocking` (low): a `<script src>` in the `<head>` without `async`, `defer` or `type="module"` (other script types, `nomodule` and scripts in comments don't count), or six or more stylesheets for every screen (no `media`, or `all`/`screen`). One or two stylesheets are normal and aren't flagged. Code: hero components.
- **Pass:** the LCP is a real `<img>` (never a CSS background) or text. It's never lazy-loaded on any template, and gets `fetchpriority="high"` / framework `priority`. Exactly one preload per page. Fonts use `font-display: swap` and are self-hosted or preloaded.

### PERF-04 · Layout doesn't jump · medium
- **Check:** crawler `img-dimensions`. Code: banners injected after load, results areas that grow, embeds.
- **Pass:** images and embeds have width and height or an aspect-ratio box. Dynamic areas reserve space. Nothing is inserted above content after load.

### PERF-05 · Interactions stay fast · low
- **Check:** code: heavy work on input (parsing, hashing, large lists).
- **Fix:** debounce, move CPU work to a Web Worker, and show progress.

### PERF-06 · Documents and third parties stay light · low
- **Check:** crawler `html-size` (over 500 KB) and `dom-size` (over 1,400 elements in the body of the server HTML; scripts may add more). Code: third-party scripts and iframes (maps, chat, video).
- **DOM size:** 1,400 body elements is the level Lighthouse's "Avoid an excessive DOM size" audit flagged until Lighthouse 13 (October 2025). Its successor, the "Optimize DOM size" insight, flags slow style and layout work (over 40 ms) instead of a count, which is what large pages cause.
- **Pass:** third-party domains kept to a minimum. Iframes load on interaction or below the fold and carry a descriptive `title`. Images are no more than about 2× their display size and use modern formats.

### PERF-08 · Images are a sensible weight and in a modern format · low
- **Check:** the crawler sends a HEAD request for up to 50 same-origin images on indexable pages, with a browser's `Accept` header.
- **Pass:** no image over 200 KB, and no JPEG or PNG over 100 KB where WebP or AVIF would serve. These are this skill's working thresholds, not Google's; Lighthouse's image audits measure the same thing as savings.
- **Fix:** resize to the displayed size, compress, and serve WebP or AVIF through the framework's image component or the CDN.

### PERF-09 · The next page starts loading before the click (speculation rules) · low
- **Check:** crawler `no-speculation-rules`: one suggestion when a site with more than one page has no `<script type="speculationrules">` on any page and no `Speculation-Rules` response header. Sites whose router already loads the next page itself (Next.js, Nuxt, Gatsby, SvelteKit, Remix, React Router 7, Astro prefetch, Rails with Turbo, Angular, Docusaurus, Inertia) aren't flagged: their links don't load a new document, and Turbo 8 already prefetches on hover. When most pages are built in the browser (a Vite or Create React App single-page app with a sitemap), the server HTML shows neither the links nor the router, so PERF-09 is listed under Limits instead.
- **Pass:** the shared layout prefetches same-site links once a visitor is about to open one (`"eagerness": "moderate"`: on hover or press), and leaves out links that change something (log out, add to cart). Prerendering is faster still but runs the next page's scripts and analytics early, so keep it to a few likely pages.
- **Fix:** `<script type="speculationrules">{"prefetch":[{"where":{"and":[{"href_matches":"/*"},{"not":{"href_matches":"/logout"}}]},"eagerness":"moderate"}]}</script>` in the layout, or a `Speculation-Rules` header pointing at a JSON file of the same rules. WordPress 6.8 and later adds rules itself, and some CDNs send the header as a setting. Chrome and Edge use the rules; other browsers ignore them.

### PERF-10 · Back and Forward are instant (back/forward cache) · low (medium when Chrome's own test fails)
> Checked **19 Nov 2026** against web.dev/articles/bfcache and developer.chrome.com/docs/web-platform/bfcache-ccns. Chrome now keeps pages sent with `Cache-Control: no-store` (rolled out from Chrome 116, planned for all users by April 2025), but drops them when a cookie changes, after 3 minutes, or when they use WebSocket, WebTransport or WebRTC; other browsers may still refuse them. Firefox refuses pages with an `unload` handler; Chrome has deprecated `unload`, but headless Chrome 157 still refused such a page.
- **Check:** on every indexable page the crawler flags `bfcache-no-store` (an HTML page sent with `Cache-Control: no-store`) and `bfcache-unload` (an `unload` listener in an inline script, `onunload =`, or an `onunload` attribute), both low. They're hints: external scripts aren't read, and browsers differ.
- **Real test:** with outside checks on and Chrome or Edge installed, each page in the render sample gets Chrome's own test, as DevTools runs it: load the page, go to the next sample page, press Back. `bfcache-blocked` (medium) lists Chrome's reasons when the page had to load again; reasons Chrome marks circumstantial (memory, the test itself) are left out. When it ran, a failed real test is the stronger evidence and the hints are leads. PERF-10 passes only when this test ran on at least one page: without it (outside checks off, no Chrome or Edge, a one-page sample, or a timeout on every page) a hint still raises its finding, and otherwise PERF-10 is listed under Limits with the reason.
- **Pass:** ordinary pages are sent with `no-cache` or `max-age=0`, keeping `no-store` for pages with private data. No `unload` handlers in the site's code or its third-party scripts: `pagehide`, or `visibilitychange` for analytics and saving state. Open connections (WebSocket, WebRTC) close on `pagehide` and reopen on `pageshow`.
- **Fix:** Chrome DevTools > Application > Back/forward cache > Test names each blocker. In Chromium browsers `Permissions-Policy: unload=()` also stops third-party scripts from adding `unload` handlers.
