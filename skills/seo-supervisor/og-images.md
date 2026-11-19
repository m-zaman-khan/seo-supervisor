# Share images (Open Graph)

The image a link shows when it's shared in chat apps and social feeds, and one of the images Google may use as a page's thumbnail (MEDIA-03). The rule is META-04.

## Card or photo

- **A real photo** when the page has an image that shows what it is about: products, recipes, places, people, events, articles with a lead photo. Google Discover wants these too.
- **A generated card** (title, brand, colours) for pages with no such image: home, pricing, docs, tools, categories, blog posts without a lead photo.
- Put a default card in the shared layout so no page goes without one. Give key page types their own image.
- Never use a logo alone, or a text-heavy card, as the main image of an article that should appear in Discover. Use the article's photo there.

## Sizes and tags

- **1200×630 PNG** (about 1.91:1). Meta wants at least 1200×630, about 1.91:1, and at most 8 MB. X uses the same image with `twitter:card` set to `summary_large_image`.
- **Google Discover:** at least 1200 px wide, plus `max-image-preview:large` in the robots meta (MEDIA-03).
- Always set the size and alt text. The alt text says what the image shows; for a card, its text.

```html
<meta property="og:image" content="https://www.example.com/og/pricing.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Plans and pricing, Example Co">
<meta name="twitter:card" content="summary_large_image">
```

- Use an absolute URL that returns 200 without a login and isn't blocked by robots.txt.
- Social apps cache images. After changing one, give it a new file name or a `?v=2` query.

## How to make cards

Use what the site already has first:

- **Next.js:** `opengraph-image.tsx` with `ImageResponse` from `next/og`. It's built in, needs no package, and Next writes the `og:image` width, height, type and alt tags itself.
- **Astro, SvelteKit, Nuxt and others:** if the project already uses Satori (`satori`, `@vercel/og`, `astro-og-canvas`, `nuxt-og-image`), add a card the same way.
- **Anything else, or a static site:** `<skill-dir>/scripts/og-card.mjs` below. Don't add a package just for cards.

```tsx
// app/blog/[slug]/opengraph-image.tsx
import { ImageResponse } from "next/og";
import { getPost } from "@/lib/posts";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Example Co blog post"; // one alt for every page under this route

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "#0b1220", color: "#fff" }}>
      <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.2 }}>{post.title}</div>
      <div style={{ fontSize: 30 }}>Example Co</div>
    </div>,
    size,
  );
}
```

Satori supports flexbox and a subset of CSS. Any element with more than one child needs `display: flex`.

## og-card.mjs

Makes 1200×630 PNG cards on this machine with the installed Chrome or Edge. It uses no AI and no outside service. The card is plain HTML with system fonts, a title that gets smaller as it gets longer (3 lines at most), a subtitle, the brand bottom-left, and text in white or near-black, whichever contrasts more with the background.

```bash
node <skill-dir>/scripts/og-card.mjs --title "Plans and pricing" --subtitle "Start free" --brand "Example Co" \
  --accent "#2459c9" --background "#0b1220" --logo public/logo.svg --out public/og/pricing.png

# One card per page. pages.json: [{ "slug": "/pricing/", "title": "Plans and pricing", "subtitle": "Start free" }]
node <skill-dir>/scripts/og-card.mjs --pages seo-audit/og-pages.json --brand "Example Co" --out-dir public/og/
```

- The file name comes from the slug: `/blog/first-post/` becomes `blog-first-post.png`, and `/` becomes `home.png`.
- Take the colours and logo from the site's own styles. A logo can be SVG, PNG, JPEG or WebP.
- Ask the owner where the images go (usually `public/og/`) before writing them. Then point each page's `og:image` at its file.
- With no Chrome or Edge, it exits with code 2. `CHROME_PATH` picks a browser.
- It checks every image is exactly 1200×630 and writes nothing when it isn't.

## AI images

Only when the owner asks for them, through your own image tool, at the owner's cost.

- Never for cards with text. Generated lettering is often wrong.
- Never as a stand-in for a real product, place or person.
- Label them: set IPTC `DigitalSourceType` to `trainedAlgorithmicMedia` (`http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia`) in the image's metadata.
