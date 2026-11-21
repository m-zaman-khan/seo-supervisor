// Image and DOM shape checks on the HTML the crawler already fetched.

export const CHECKS = {
  "img-alt-quality": [
    "CONTENT-08",
    "low",
    n => `${n} page(s) have alt text that doesn't describe the image`,
    "Google reads alt text to understand an image and asks for useful, descriptive text, not a list of keywords. A file name, a bare word such as “image”, a string of keywords or a paragraph tells search engines and screen-reader users little about what the picture shows.",
    'Describe what the image shows in its context, in a short sentence (“Engineer fitting a combi boiler in a Leeds kitchen”). Use `alt=""` for decorative images, and put long descriptions in the text or a caption.',
  ],
  "image-preloads": [
    "PERF-03",
    "low",
    n => `${n} page(s) preload more than one image`,
    "A page has one largest image to show first, so one image preload is enough. web.dev advises using preload sparingly: “If too many resources are prioritized, effectively none of them are”, and the extra images compete with the hero for the network.",
    'Keep one image preload, for the hero (with `fetchpriority="high"`), and drop the others. Preloads for other screen sizes (with a `media` attribute) count as one. With Next.js, set `priority` on the hero image only.',
  ],
  "prerender-hint": [
    "PERF-09",
    "low",
    n => `${n} page(s) use the old rel=prerender hint`,
    'Chrome no longer prerenders a page from `<link rel="prerender">`: it only fetches some of its files (NoState Prefetch), and Chrome\'s docs say the hint may be retired. The Speculation Rules API now does what it was meant to.',
    'Replace it with speculation rules: `<script type="speculationrules">{"prerender":[{"urls":["/next-page/"]}]}</script>`, or the prefetch rules PERF-09 describes.',
  ],
  "image-over-500kb": [
    "PERF-08",
    "medium",
    n => `${n} image(s) weigh over 500 KB`,
    "Each of these images costs a phone visitor more than half a megabyte. On a slow connection that alone takes seconds, and when it's the largest image on screen it holds up LCP.",
    "Resize it to the size it's shown at and serve WebP or AVIF, through the framework's image component, the CDN, or scripts/images.mjs.",
  ],
  "hero-no-fetchpriority": [
    "PERF-03",
    "low",
    n => `${n} page(s) load their largest image without fetchpriority="high"`,
    "In a lab load, Chrome found that the largest image on the page (the LCP element) wasn't marked as important. Images start at low priority until the page is laid out, so the hero waits behind other files. web.dev: boosting the LCP image's priority makes LCP happen sooner.",
    'Add `fetchpriority="high"` to the hero `<img>` (and to its preload, if it has one), or `priority` on a Next.js `<Image>`. Only the hero: one high-priority image per page.',
  ],
};

// Local lines, apart from Google's warning against keyword-stuffed alt text. Empty alt is right for decorative images.
// https://developers.google.com/search/docs/appearance/google-images
const GENERIC = /^(image|img|photo|picture|pic|graphic|icon|banner|untitled|placeholder)s?$/i;
export function altProblem(alt, src = "") {
  const a = String(alt ?? "").trim();
  if (!a) return null;
  let stem = String(src)
    .split(/[?#]/)[0]
    .split("/")
    .pop()
    .replace(/\.[a-z0-9]+$/i, "");
  try {
    stem = decodeURIComponent(stem);
  } catch {}
  if (
    /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic)$/i.test(a) ||
    /^(img|dsc|dscn|dcim|pxl|mvimg|screenshot)[\s_-]?\d/i.test(a) ||
    (/[-_\d]/.test(stem) && a.toLowerCase() === stem.toLowerCase())
  )
    return "a file name";
  if (GENERIC.test(a.replace(/[^\p{L}\s]/gu, "").trim())) return "a generic word";
  if (a.length > 150) return "over 150 characters";
  const parts = a.split(",");
  if (parts.length >= 4 && parts.every(p => p.trim().split(/\s+/).length <= 3)) return "a keyword list";
  return null;
}

// The real image behind a lazy-loading script (lazysizes, Perfmatters, EWWW, WP Rocket, LiteSpeed): used when src is
// missing or a data: placeholder, or the image carries the loader's lazy class.
export function lazySrc(i) {
  const real =
    i["data-src"] ||
    i["data-lazy-src"] ||
    i["data-original"] ||
    (i["data-srcset"] || i["data-lazy-srcset"] || "").trim().split(/\s+/)[0];
  if (!real || /^data:/i.test(real)) return null;
  return !i.src || /^data:/i.test(i.src) || /\blazy/i.test(i.class || "") ? real : null;
}

// <link> tags outside comments and <noscript>, for the image-preload and rel=prerender checks. Image preloads with
// a media attribute are one hero per screen size, so together they count as one.
const linkTags = html =>
  [...html.replace(/<!--[\s\S]*?-->|<noscript\b[\s\S]*?<\/noscript>/gi, " ").matchAll(/<link\b[^>]*>/gi)].map(m => {
    const a = {};
    for (const x of m[0].matchAll(/([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
      a[x[1].toLowerCase()] = x[2] ?? x[3] ?? x[4] ?? "";
    return { ...a, rels: (a.rel || "").toLowerCase().split(/\s+/) };
  });
export function hintsOf(html) {
  const links = linkTags(html),
    img = links.filter(l => l.rels.includes("preload") && (l.as || "").toLowerCase() === "image");
  return {
    // Preloads with a media attribute are one hero per screen size, so together they count as one.
    imagePreloads: img.filter(l => !("media" in l)).length + (img.some(l => "media" in l) ? 1 : 0),
    preloadHrefs: img
      .map(l => l.href || (l.imagesrcset || "").trim().split(/\s+/)[0])
      .filter(Boolean)
      .slice(0, 3),
    prerender: links
      .filter(l => l.rels.includes("prerender"))
      .map(l => l.href || "")
      .slice(0, 3),
  };
}

// Optional end tags (li, p, td, option…) close the open one when the next starts, so unclosed lists don't read as
// nesting. Not HTML's full parsing rules, but enough for the 32-deep and 60-children lines; use a real parser if finer
// counts matter.
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const AUTO = {
  li: [["li"], /^(ul|ol|menu)$/],
  dt: [["dt", "dd"], /^dl$/],
  dd: [["dt", "dd"], /^dl$/],
  tr: [["tr"], /^(table|thead|tbody|tfoot)$/],
  td: [["td", "th"], /^(tr|table)$/],
  th: [["td", "th"], /^(tr|table)$/],
  option: [["option"], /^(select|datalist|optgroup)$/],
  p: [["p"], /^$/],
};
export function domShape(html) {
  const stack = [],
    kids = []; // open elements (tag.class), their tag names, and each one's child count
  let depth = 0,
    widest = { tag: null, children: 0 };
  const src = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi, "<$1></$1>");
  const name = t => t.split(".")[0];
  for (const m of src.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*?)(\/?)>/gi)) {
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map(name).lastIndexOf(tag);
      if (i >= 0) {
        stack.length = i;
        kids.length = i;
      }
      continue;
    }
    if (AUTO[tag]) {
      const [same, scope] = AUTO[tag],
        i = Math.max(...same.map(s => stack.map(name).lastIndexOf(s)));
      if (i >= 0 && !stack.slice(i + 1).some(t => scope.test(name(t)))) {
        stack.length = i;
        kids.length = i;
      }
    }
    if (kids.length && ++kids[kids.length - 1] > widest.children)
      widest = { tag: stack[stack.length - 1], children: kids[kids.length - 1] };
    if (VOID.has(tag) || m[4]) {
      depth = Math.max(depth, stack.length + 1);
      continue;
    }
    const cls = /\bclass\s*=\s*["']?([^\s"'>]+)/i.exec(m[3])?.[1];
    stack.push(cls ? `${tag}.${cls}` : tag);
    kids.push(0);
    depth = Math.max(depth, stack.length);
  }
  return { depth, widest };
}

// A response header only that CDN sends.
const CDN_HEADERS = [
  ["cf-cache-status", "Cloudflare"],
  ["x-amz-cf-id", "Amazon CloudFront"],
  ["x-vercel-cache", "Vercel"],
  ["x-nf-request-id", "Netlify"],
  ["cdn-pullzone", "Bunny"],
  ["x-azure-ref", "Azure Front Door"],
  ["x-fastly-request-id", "Fastly"],
];
export const cdnOf = h => CDN_HEADERS.find(([k]) => h.has(k))?.[1] ?? null;
// Lighthouse flags static files browsers can't cache.
// https://developer.chrome.com/docs/lighthouse/performance/uses-long-cache-ttl
export function uncached(h) {
  const cc = (h.get("cache-control") || "").toLowerCase();
  if (/no-store|no-cache/.test(cc)) return true;
  const age = /(?:^|[,\s])max-age\s*=\s*(\d+)/.exec(cc)?.[1];
  return age != null ? Number(age) === 0 : !h.has("expires");
}
