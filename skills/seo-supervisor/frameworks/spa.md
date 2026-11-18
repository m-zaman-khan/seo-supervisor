# Single-page apps: React, Vue or Vite without server rendering

A client-rendered SPA serves an empty shell (`<div id="root"></div>`), which fails REND-01 for most crawlers. The crawler flags it as `client-rendered`.

## Options, best first
1. **Move the public pages to a framework that renders on the server or at build time** (Next.js, Remix, Astro, Nuxt, SvelteKit). Keep the app part as a client app behind login.
2. **Pre-render the public routes at build time** (vike / vite-plugin-ssr prerender, react-snap, Astro islands for marketing pages). Every route gets real HTML with its own title, meta, canonical and JSON-LD.
3. **Last resort:** a single landing page with complete static HTML in `index.html`. Client-only meta (react-helmet) is invisible to crawlers that don't run JavaScript.

## Hosting traps
- **Soft 404s (CRAWL-05):** a catch-all rewrite to `index.html` (`vercel.json` rewrites, Netlify `/* /index.html 200`) returns 200 for every unknown URL. Pre-render a real `404.html` and rewrite only known routes, or return 404 from the edge.
- **Sitemaps and robots** are static files in `public/`. Generate `sitemap.xml` at build time from the route list.
- **Trailing slash:** set the host's `trailingSlash` / `cleanUrls` option and keep links consistent.
- **Hash routing** (`/#/page`) is invisible to search engines. Use history routing.
