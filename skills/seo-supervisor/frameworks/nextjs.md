# Next.js (App Router)

How the rules map onto Next.js. Check `next.config.*`, `app/layout.tsx`, `app/robots.ts`, `app/sitemap.ts`, the metadata helper (often `lib/seo.ts`) and any `middleware.ts` / `proxy.ts`.

## Audit like this
- **Crawl a production build, not `next dev`:** `next build`, then start it with `node node_modules/next/dist/bin/next start -p 3123`. On Windows, `npx` leaves a stray node process when stopped. Dev mode renders differently.
- **`NEXT_PUBLIC_*` values are baked in at build time.** An existing `.next` build may carry staging values (site URL, indexing flag). Check the canonicals in the crawl and say which build you crawled.
- **Find every page's metadata source:** `export const metadata`, `generateMetadata`, and the layout's title template.

## Next.js 16 with Cache Components (`cacheComponents: true`)
- Route segment config such as `revalidate`, `dynamic` and `dynamicParams` doesn't apply in this mode; caching uses `"use cache"` and `cacheLife`. The `generateStaticParams` / `dynamicParams = false` advice below is for the classic model.
- **Soft 404 risk:** a page can start streaming with status 200 before a `notFound()` inside a dynamic section runs. Unknown slugs then return 200 on the first request (look for an `x-nextjs-postponed` header). Validate the slug at the top of the page, before anything suspends, and confirm with the crawler's soft-404 probe, which always uses a never-seen URL. A second request to the same URL usually returns 404, so a manual `curl` repeated on one URL can look fine. Always test a fresh URL. Don't trust code comments that say it can't happen.

## Patterns that pass

**One metadata helper (META-03, URL-04, META-06)**
```ts
// lib/seo.ts
import type { Metadata } from "next";
export const SITE = process.env.NEXT_PUBLIC_SITE_URL!;           // one production origin
export function pageMeta(p: { title: string; description: string; path: string; noindex?: boolean; nofollow?: boolean; image?: string }): Metadata {
  return {
    title: p.title,                                                // layout template adds " | Brand"
    description: p.description,
    alternates: { canonical: p.path },                             // resolved against metadataBase; path in the site's slash style
    robots: p.noindex
      ? { index: false, follow: !p.nofollow }   // search/filters/results: follow; account/admin/sign-in/404: nofollow too
      : { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
    openGraph: { title: p.title, description: p.description, url: p.path, images: [p.image ?? "/opengraph-image"] },
    twitter: { card: "summary_large_image", title: p.title, description: p.description },
  };
}
// app/layout.tsx: metadataBase: new URL(SITE), title: { default: "…", template: "%s | Brand" }
```
- Setting `openGraph` in a page **replaces** the inherited image unless you include `images` (META-04).
- Use `title: { absolute: … }` when the title already contains the brand.

**Trailing slash (URL-02):** `trailingSlash: true | false` in `next.config`. It 308-redirects the other form. Built-in slash redirects run before your `redirects()`, so legacy redirects can chain (CRAWL-08); put them at the edge or cover both forms.

**robots and staging (CRAWL-01, CRAWL-03, CRAWL-04)**
```ts
// app/robots.ts
export default function robots() {
  if (process.env.SITE_INDEXABLE !== "true") return { rules: [{ userAgent: "*", allow: "/" }] }; // noindex comes from the header below
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/*_rsc="] }], sitemap: `${SITE}/sitemap.xml` };
}
// next.config: headers() → when not indexable, { source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }
```
Per-path headers work the same way, e.g. keeping shareable result links out of the index (TOOL-05, CRAWL-10):
```ts
// next.config.ts
async headers() {
  return [{ source: "/r/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, follow" }] }];
},
```

**Sitemap (MAP-01 to MAP-04):** built from the content source, filtered to published items, with `lastModified` from `updatedAt`. Never `new Date()`. Use `generateSitemaps()` or route handlers when you need an index.
```ts
// app/sitemap.ts
import type { MetadataRoute } from "next";
import { getTools, getPosts } from "@/lib/content";
import { SITE } from "@/lib/seo";

const newest = (d: string[]) => [...d].sort().at(-1);
const url = (path: string) => `${SITE}${path}`;           // paths already in the site's slash style

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tools = (await getTools()).filter(t => t.status === "live");
  const posts = (await getPosts()).filter(p => p.status === "live");
  return [
    { url: url("/tools/"), lastModified: newest(tools.map(t => t.updatedAt)) },
    ...tools.map(t => ({ url: url(`/tools/${t.slug}/`), lastModified: t.updatedAt })),
    ...posts.map(p => ({ url: url(`/blog/${p.slug}/`), lastModified: p.updatedAt })),
    // hubs, browse pages with 3+ items, and other content types the same way
  ];
}
```

**Static pages from data (CRAWL-11, REND-01):** `generateStaticParams()` from published items, `export const dynamicParams = false` (unknown slugs give 404) or `notFound()` in the page, `revalidate` for ISR. `permanentRedirect()` for renamed items.

**Server rendering (REND-01, REND-02):** pages are server components; only widgets are `"use client"`. Never `dynamic(() => import(…), { ssr: false })` for anything with text. Accordions render children always and hide them with CSS.

**JSON-LD (SCHEMA-01)**
```tsx
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
```

**Images and fonts (PERF-03):** `next/image` with `priority` on the LCP image only, `sizes` set, `fill` inside a sized box. `next/font` with `display: "swap"`.

**OG images (META-04):** `opengraph-image.tsx` per route segment using `ImageResponse`.

## Common traps
- No `metadataBase`, so canonicals and OG URLs are relative or point at localhost.
- A robots **string** in a page overriding the layout's robots object.
- `export const dynamic = "force-dynamic"` on pages that could be static, which is slower and can depend on APIs.
- Middleware that redirects signed-in users must never change what crawlers get on public URLs.
