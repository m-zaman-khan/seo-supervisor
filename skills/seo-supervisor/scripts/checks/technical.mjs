// Small technical checks the crawler runs (sitemaps, links, images, head tags, headings, security headers and cookies).
// Sources: the sitemaps.org protocol (URLs under 2,048 characters), Search Console's Sitemaps report help (nested
// sitemap indexes), Google's video sitemap, image sitemap and URL structure docs (session IDs, fragments,
// percent-encoding), web.dev on responsive images and lazy loading, ogp.me (repeated og:image is an array), Google's
// robots meta docs (the more restrictive rule applies), WCAG 2.2 SC 2.4.6, hstspreload.org (max-age of a year), the
// W3C Referrer Policy spec (unsafe-url) and MDN's Set-Cookie reference.

export const CHECKS = {
  "sitemap-duplicate-urls": [
    "MAP-01",
    "low",
    n => `${n} sitemap file(s) list the same URL more than once`,
    "The same address appears twice in one sitemap, or in two regular sitemaps. The copy adds nothing, takes one of the file's 50,000 places, and usually means two parts of the sitemap code list the same pages; when the copies give different lastmod dates, at least one is wrong. A page listed again in an image, video or news sitemap is fine.",
    "Build the sitemap from one list of pages, and when it's split into several files, give each page to exactly one of them.",
  ],
  // https://support.google.com/webmasters/answer/7451001
  "sitemap-index-nested": [
    "MAP-01",
    "low",
    n => `${n} sitemap index(es) are listed inside another sitemap index`,
    "A sitemap index may list only sitemaps, not other sitemap indexes. Search Console reports a nested one as an error (“Nested sitemap indexes”), so the sitemaps it lists may not be read through it.",
    "List every sitemap file directly in one top-level sitemap index (and reference that in robots.txt), and remove the entry that points at the other index.",
  ],
  // https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps
  "video-sitemap-tags": [
    "MAP-01",
    "low",
    n => `${n} video sitemap(s) have videos without Google's required tags`,
    "Each `<video:video>` entry needs `<video:thumbnail_loc>`, `<video:title>`, `<video:description>` (at most 2,048 characters) and either `<video:content_loc>` or `<video:player_loc>`. Google can't use an entry that lacks one, so the video may not appear in video results.",
    "Generate each entry from the video record: the thumbnail URL, the title and description shown on the page, and the URL of the video file (`content_loc`, which Google prefers) or of its player (`player_loc`).",
  ],
  // https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps
  "image-sitemap-tags": [
    "MAP-01",
    "low",
    n => `${n} image sitemap(s) have image entries Google can't use`,
    "Each `<image:image>` needs an `<image:loc>` with the image's URL, and one page may list at most 1,000 images. An entry without the URL tells Google nothing.",
    "Give every `<image:image>` its `<image:loc>`, and list at most 1,000 images per page, the ones that matter most.",
  ],
  // https://developers.google.com/search/docs/crawling-indexing/url-structure
  "sitemap-session-ids": [
    "MAP-02",
    "low",
    n => `${n} sitemap URL(s) contain a session ID or a #fragment`,
    "A session ID gives the same page a new address for every visitor, so search engines crawl copies of it; Google asks sites to keep session IDs out of URLs. Google ignores everything after `#`, so a #fragment URL is only a copy of the page without it.",
    "List the plain URL of each page: drop the session parameter (keep sessions in a cookie) and the #fragment.",
  ],
  // https://www.sitemaps.org/protocol.html
  "sitemap-url-too-long": [
    "MAP-02",
    "low",
    n => `${n} sitemap URL(s) are 2,048 characters or longer`,
    "The sitemap protocol requires every URL to be under 2,048 characters, so a longer one breaks the format. An address that long is usually a filter or tracking URL that shouldn't be listed at all.",
    "List the page's short canonical URL instead, or leave the URL out of the sitemap.",
  ],
  // https://developers.google.com/search/docs/crawling-indexing/url-structure
  "url-unencoded": [
    "URL-01",
    "low",
    n => `${n} page(s) link to addresses with unencoded spaces or non-ASCII letters`,
    "Web addresses may only contain plain ASCII characters, so spaces and letters such as é or ü must be percent-encoded (`/caf%C3%A9/` for `/café/`), as Google recommends. Browsers quietly fix such links, but other tools, apps and email clients often break them.",
    "Build links with the framework's URL helper or `encodeURI()`, and use hyphens instead of spaces in slugs.",
  ],
  // https://web.dev/articles/serve-responsive-images
  "img-no-srcset": [
    "PERF-08",
    "low",
    n => `${n} page(s) send large images at full size to every screen (no srcset)`,
    "These images are over 1,000 px wide (from their `width` attribute) with no `srcset`, so phones download the full desktop size. web.dev says that can use 2–4 times the data needed, and it slows the page. 1,000 px is this skill's working level, not a Google threshold.",
    "Give large images a `srcset` with three to five widths and a `sizes` attribute, or use the framework's image component (such as Next.js `<Image>`), which writes them.",
  ],
  // https://web.dev/articles/browser-level-image-lazy-loading
  "img-not-lazy": [
    "PERF-03",
    "low",
    n => `${n} page(s) load images far down the page straight away`,
    "From the 11th image on, which is usually below a phone's first screen, these images have no `loading` attribute, so the browser fetches them all at once and they compete with the first images for bandwidth. web.dev advises `loading=\"lazy\"` for images outside the first screen. The 11th image is this skill's working level, as the crawler can't see the layout.",
    'Add `loading="lazy"` to images further down the page. Keep it off the first few images, and never put it on the main image.',
  ],
  // Open Graph allows repeated og:image as an array; Google applies the more restrictive robots rule.
  // https://ogp.me/#array
  // https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
  "duplicate-head-tags": [
    "META-03",
    "low",
    n => `${n} page(s) have the same head tag more than once`,
    "Two meta descriptions, robots tags, viewports or og:title tags on one page usually mean the layout and the page, or two SEO plugins, both set them. Search engines and link previews then pick one or combine them (Google applies the strictest robots rule), so the result may not be the one you meant. Several og:image tags are fine: Open Graph allows a list of images.",
    "Set each tag in one place, the shared metadata helper, and remove the copy from the layout or the second plugin.",
  ],
  // https://www.w3.org/TR/WCAG22/#headings-and-labels
  "heading-only-number": [
    "CONTENT-02",
    "low",
    n => `${n} page(s) have headings that are only a number`,
    "A heading such as “250+” or “01” says nothing about the section under it. Screen readers list headings so visitors can skim, search engines read them for the page's topics, and WCAG asks that headings describe their section. Years aren't counted.",
    "Put the words in the heading (“250+ boilers fitted”), or show the number as styled text and keep headings for the section titles.",
  ],
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie
  "cookie-flags": [
    "TRUST-01",
    "low",
    n => `${n} cookie(s) the server sets lack Secure, HttpOnly or SameSite`,
    "These cookies come in the server's `Set-Cookie` headers on its pages. Without `Secure` a cookie can travel over plain HTTP, without `HttpOnly` any script on the page (an injected one too) can read it, and without `SameSite` some browsers send it along with requests from other sites. Cookies that scripts set themselves (analytics, consent) aren't checked, and `Secure` is checked only on an HTTPS crawl.",
    "Set `Secure; HttpOnly; SameSite=Lax` in the framework's session and cookie settings. Leave `HttpOnly` off only for a cookie a script must read, such as a CSRF token the page's JavaScript sends back (those are skipped).",
  ],
  // https://hstspreload.org
  "hsts-short": [
    "TRUST-01",
    "low",
    () => "HSTS lasts less than a year",
    "The `Strict-Transport-Security` header's `max-age` is under 31,536,000 seconds (one year), the minimum hstspreload.org asks for. Browsers forget the HTTPS-only rule sooner, so a returning visitor's first request can go over plain HTTP again.",
    "Raise it to `max-age=31536000` or more (`63072000`, two years, is common) once HTTPS works on every page and subdomain.",
  ],
  // https://www.w3.org/TR/referrer-policy/#referrer-policy-unsafe-url
  "referrer-unsafe": [
    "TRUST-01",
    "low",
    n => `${n} page(s) set Referrer-Policy: unsafe-url`,
    "With `unsafe-url` the page's full address, path and query included, goes to every site it links to or loads from, even over plain HTTP. The W3C standard calls it unsafe for that reason: it leaks addresses from HTTPS pages to insecure sites.",
    'Use `strict-origin-when-cross-origin` in the `Referrer-Policy` header (or `<meta name="referrer">`), or remove the setting.',
  ],
};

// What a Set-Cookie header leaves out: Secure (judged only on HTTPS, as a local dev server leaves it off on purpose),
// HttpOnly (except on a CSRF token, which a script has to read) and SameSite. A cookie being deleted needs nothing.
export function cookieProblems(header, { https }) {
  const [pair, ...parts] = header.split(";"),
    name = pair.split("=")[0].trim();
  const at = Object.fromEntries(
    parts.map(p => {
      const i = p.indexOf("=");
      return [(i < 0 ? p : p.slice(0, i)).trim().toLowerCase(), i < 0 ? "" : p.slice(i + 1).trim()];
    }),
  );
  if (("max-age" in at && Number(at["max-age"]) <= 0) || Date.parse(at.expires) < Date.now()) return [];
  return [
    https && !("secure" in at) && "no Secure",
    !("httponly" in at) && !/csrf|xsrf/i.test(name) && "no HttpOnly",
    !("samesite" in at) && "no SameSite",
  ].filter(Boolean);
}
