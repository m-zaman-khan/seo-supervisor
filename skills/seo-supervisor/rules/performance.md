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
- **Lab speed:** with outside checks on and Chrome or Edge installed, each sample page is also loaded once on a phone with 4× CPU slowdown and slow 4G. LCP, CLS and an approximate TBT go into the crawl as `labSpeed` and one Overview line labelled indicative. They aren't Lighthouse numbers and raise no findings. With the optional Lighthouse add-on and `--lighthouse`, up to 5 sample pages also get a real Lighthouse run, which is information too: lab data never passes or fails PERF-01; use them before launch, when there's no real-user data.

### PERF-02 · Each page loads only its own code · medium
- **Check:** code: shared bundles importing every widget or heavy library; client components wrapping whole pages.
- **Fix:** dynamic import per widget, with server rendering kept on for anything with text.

### PERF-03 · The LCP element loads first · medium
- **Check:** crawler `lazy-lcp`. Code: hero components.
- **Pass:** the LCP is a real `<img>` (never a CSS background) or text. It's never lazy-loaded on any template, and gets `fetchpriority="high"` / framework `priority`. Exactly one preload per page. Fonts use `font-display: swap` and are self-hosted or preloaded.

### PERF-04 · Layout doesn't jump · medium
- **Check:** crawler `img-dimensions`. Code: banners injected after load, results areas that grow, embeds.
- **Pass:** images and embeds have width and height or an aspect-ratio box. Dynamic areas reserve space. Nothing is inserted above content after load.

### PERF-05 · Interactions stay fast · low
- **Check:** code: heavy work on input (parsing, hashing, large lists).
- **Fix:** debounce, move CPU work to a Web Worker, and show progress.

### PERF-06 · Documents and third parties stay light · low
- **Check:** crawler `html-size` (over 500 KB). Code: third-party scripts and iframes (maps, chat, video).
- **Pass:** third-party domains kept to a minimum. Iframes load on interaction or below the fold and carry a descriptive `title`. Images are no more than about 2× their display size and use modern formats.

### PERF-08 · Images are a sensible weight and in a modern format · low
- **Check:** the crawler sends a HEAD request for up to 50 same-origin images on indexable pages, with a browser's `Accept` header.
- **Pass:** no image over 200 KB, and no JPEG or PNG over 100 KB where WebP or AVIF would serve. These are this skill's working thresholds, not Google's; Lighthouse's image audits measure the same thing as savings.
- **Fix:** resize to the displayed size, compress, and serve WebP or AVIF through the framework's image component or the CDN.
