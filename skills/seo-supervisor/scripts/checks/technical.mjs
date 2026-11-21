// @ts-check
// Small technical checks the crawler runs (sitemaps, links, images, head tags, headings, security headers and cookies).

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
  "csp-weak": [
    "TRUST-01",
    "low",
    () => "The Content-Security-Policy doesn't stop injected scripts",
    "The policy is there, but it lets scripts run inline or from any site, or leaves plugins or the page's `<base>` tag open, so a script an attacker slips into the page can still run. These are the gaps Google's CSP Evaluator reports. A `'nonce-…'` or `'sha256-…'` source makes browsers ignore `'unsafe-inline'`, and `'strict-dynamic'` makes them ignore host and `https:` sources, so those fallbacks for old browsers aren't counted.",
    "Move to a strict policy, as web.dev's \"Mitigate cross-site scripting with a strict CSP\" shows: `script-src 'nonce-{random}' 'strict-dynamic'; object-src 'none'; base-uri 'none'`, with a new nonce on every response (Next.js, Rails and Django can add it). Try it as `Content-Security-Policy-Report-Only` first.",
  ],
  "hsts-invalid": [
    "TRUST-01",
    "low",
    () => "The Strict-Transport-Security header is broken, so browsers ignore it",
    "RFC 6797, the HSTS standard, says every directive may appear only once and `max-age` is required, and browsers must ignore a header that breaks these rules. The site then has no HSTS at all, whatever the header says.",
    "Send exactly one header with each directive once, such as `Strict-Transport-Security: max-age=31536000; includeSubDomains`. When the server and the CDN both add one, remove it from one of them.",
  ],
  "hsts-no-subdomains": [
    "TRUST-01",
    "low",
    () => "HSTS doesn't cover subdomains (no includeSubDomains)",
    "Without `includeSubDomains`, a subdomain such as `shop.` or an old `mail.` can still be opened over plain HTTP, where a cookie set for the whole domain can be read or changed. The HSTS preload list (hstspreload.org) also requires it.",
    "Check that every subdomain works over HTTPS first (the directive switches HTTP off for all of them), then add `includeSubDomains`: `Strict-Transport-Security: max-age=31536000; includeSubDomains`.",
  ],
};
// Not low like the rest, so the crawler adds it to its catalog itself: the version may already be patched.
export const SERVER_CHECK = {
  "server-known-holes": [
    "TRUST-01",
    "needs-decision",
    () => "The web server's version has known critical security holes",
    'The `Server` header names a version that its maker\'s security advisories list with a critical hole (Apache\'s "critical", nginx\'s "major", their highest ratings). Linux distributions and hosts often fix holes without changing the version number, so it may already be patched; a hacked server can serve spam and malware, which gets pages flagged or dropped from search.',
    "Ask the host or whoever runs the server whether this version is patched, and update it if not. Then hide the version: `ServerTokens Prod` in Apache, `server_tokens off;` in nginx.",
  ],
};

// ---------- Content-Security-Policy ----------
// The gaps Google's CSP Evaluator flags: 'unsafe-inline' without a nonce or hash (browsers ignore it beside one),
// 'unsafe-eval', any-host script sources without 'strict-dynamic' (which makes browsers ignore them), no script or
// object limit, and no base-uri on a nonce policy (or a hash one with 'strict-dynamic').
// https://github.com/google/csp-evaluator
// https://web.dev/articles/strict-csp
const directives = policy =>
  new Map(
    policy
      .split(";")
      .map(d => d.trim().split(/\s+/))
      .filter(([n]) => n)
      .map(([n, ...v]) => [n.toLowerCase(), v.map(s => (/^'(nonce|sha\d+)-/i.test(s) ? s : s.toLowerCase()))]),
  );
function policyGaps(policy) {
  const d = directives(policy),
    scripts = d.get("script-src") ?? d.get("default-src"),
    out = [];
  if (!scripts) out.push("no script-src or default-src, so scripts aren't limited");
  else {
    const keyed = scripts.some(s => /^'(nonce|sha\d+)-/i.test(s)),
      dynamic = scripts.includes("'strict-dynamic'");
    if (scripts.includes("'unsafe-inline'") && !keyed) out.push("scripts may run inline ('unsafe-inline')");
    if (scripts.includes("'unsafe-eval'")) out.push("scripts may run eval() ('unsafe-eval')");
    const any = dynamic
      ? []
      : scripts.filter(s => ["*", "http:", "https:", "data:", "http://*", "https://*"].includes(s));
    if (any.length) out.push(`scripts may load from any site (${any.join(", ")})`);
    if (!d.has("base-uri") && scripts.some(s => /^'nonce-/i.test(s) || (dynamic && /^'sha\d+-/i.test(s))))
      out.push("no base-uri, so an injected <base> tag can move the page's scripts");
  }
  if (!(d.get("object-src") ?? d.get("default-src"))?.length)
    out.push("no object-src or default-src, so plugins aren't limited");
  return out;
}
/** What a Content-Security-Policy header value leaves open, in plain words ([] for none). Several policies all apply,
 * so a gap counts only when every policy has it. */
export function cspProblems(header) {
  const each = String(header || "")
    .split(",")
    .filter(p => p.trim())
    .map(policyGaps);
  return each.length ? each.reduce((a, b) => a.filter(x => b.includes(x))) : [];
}

// ---------- Strict-Transport-Security ----------
// Browsers use only the first header field (8.1). In it each directive may appear once, max-age (whole seconds, quotes
// allowed) is required, unknown directives are ignored, and a field that breaks the syntax is ignored whole (6.1).
// https://www.rfc-editor.org/rfc/rfc6797#section-6.1
// The preload list needs max-age of at least 31536000, includeSubDomains and preload, but hstspreload.org recommends
// against preloading, so findings advise HSTS and never the list. https://hstspreload.org
// fetch joins repeated fields with ", ", which this syntax never contains, so the first field ends at the first comma.
const TOKEN = /^[!#$%&'*+.^_`|~\w-]+$/;
export function hstsRead(header) {
  const seen = new Map();
  let invalid = null;
  for (const part of String(header || "")
    .split(",")[0]
    .split(";")
    .map(p => p.trim())
    .filter(Boolean)) {
    const [, name, value] = part.match(/^([^=\s]+)\s*(?:=\s*(.*))?$/) || [];
    if (!name || !TOKEN.test(name) || (value != null && !/^("[^"]*"|[!#$%&'*+.^_`|~\w-]+)$/.test(value))) {
      invalid ||= "it doesn't follow the header's syntax (directives separated by ;)";
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) invalid ||= `${name} appears twice`;
    seen.set(key, value?.replace(/^"|"$/g, "") ?? "");
  }
  const raw = seen.get("max-age"),
    maxAge = raw != null && /^\d+$/.test(raw) ? Number(raw) : null;
  if (raw == null) invalid ||= "there's no max-age, which is required";
  else if (maxAge == null) invalid ||= "max-age isn't a whole number of seconds";
  const includeSubDomains = seen.has("includesubdomains"),
    preload = seen.has("preload");
  const missing = [
    !(maxAge >= 31536000) && "a max-age of at least 31536000",
    !includeSubDomains && "includeSubDomains",
    !preload && "preload",
  ].filter(Boolean);
  return { maxAge, includeSubDomains, preload, invalid, missing };
}

// ---------- mixed content ----------
// What an https page loads: stylesheets, preloads and scripts, which browsers block, and media, embeds and frames,
// which they upgrade or block. Links, canonicals and icons aren't loads here. upgrade-insecure-requests in a page or
// header CSP makes the browser fetch them all over https.
// https://www.w3.org/TR/mixed-content/
// https://www.w3.org/TR/upgrade-insecure-requests/
/** @type {[string, string, (l: Record<string, string>) => string | null][]} */
const LOADS = [
  [
    "link",
    "href",
    l => {
      const rel = (l.rel || "").toLowerCase().split(/\s+/);
      return rel.includes("stylesheet")
        ? "stylesheet"
        : rel.some(r => r === "preload" || r === "modulepreload")
          ? "preload"
          : null;
    },
  ],
  ["script", "src", () => "script"],
  ["img", "src", () => "image"],
  ["img", "srcset", () => "image"],
  ["video", "src", () => "video"],
  ["video", "poster", () => "image"],
  ["source", "src", () => "media"],
  ["source", "srcset", () => "image"],
  ["track", "src", () => "media"],
  ["audio", "src", () => "audio"],
  ["embed", "src", () => "embed"],
  ["object", "data", () => "embed"],
  ["iframe", "src", () => "frame"],
];
const attrsOf = tag =>
  Object.fromEntries(
    [...tag.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)]
      .slice(1)
      .map(m => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? ""]),
  );
/** The http:// files an https page loads, as { kind, url } in document order. cspHeader is the page's CSP header,
 * if any. */
export function insecureResources(html, cspHeader = "") {
  const doc = String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/(<(script|style|template|noscript)\b[^>]*>)[\s\S]*?<\/\2>/gi, "$1");
  const metaCsp = [...doc.matchAll(/<meta\b[^>]*>/gi)]
    .map(m => attrsOf(m[0]))
    .filter(m => /^content-security-policy$/i.test(m["http-equiv"] || ""))
    .map(m => m.content || "");
  if ([cspHeader, ...metaCsp].some(c => /(^|[;,\s])upgrade-insecure-requests(\s*[;,]|\s*$)/i.test(c || ""))) return [];
  const out = [];
  for (const m of doc.matchAll(/<(link|script|img|video|source|track|audio|embed|object|iframe)\b[^>]*>/gi)) {
    const a = attrsOf(m[0]),
      name = m[1].toLowerCase();
    for (const [tag, attr, kindOf] of LOADS) {
      const kind = tag === name && a[attr] && kindOf(a);
      if (kind)
        for (const url of attr === "srcset" ? a[attr].split(",").map(c => c.trim().split(/\s+/)[0]) : [a[attr].trim()])
          if (/^http:\/\//i.test(url)) out.push({ kind, url });
    }
  }
  return out;
}

// ---------- server software ----------
// Versions the maker's own advisories list with a hole at its top rating (Apache's "critical", nginx's "major").
// Checked 2026-11-21; CHECK AGAIN BY 2027-05-21, and add or drop versions. Apache httpd and nginx only; add PHP, IIS
// and others when a vendor advisory rates one of their versions critical.
// https://httpd.apache.org/security/vulnerabilities_24.html
// https://nginx.org/en/security_advisories.html
const v = s => s.split(".").map(Number),
  lt = (a, b) => {
    const x = v(a),
      y = v(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return false;
  };
const within = (ver, from, to) => !lt(ver, from) && !lt(to, ver);
const HOLES = {
  Apache: [
    { id: "CVE-2021-41773", what: "path traversal and file disclosure", hits: x => x === "2.4.49", fixed: "2.4.50" },
    {
      id: "CVE-2021-42013",
      what: "path traversal and remote code execution",
      hits: x => within(x, "2.4.49", "2.4.50"),
      fixed: "2.4.51",
    },
    {
      id: "CVE-2026-119618",
      what: "heap corruption and remote code execution in mod_http2",
      hits: x => within(x, "2.4.55", "2.4.70"),
      fixed: "2.4.71",
    },
  ],
  nginx: [
    // Not vulnerable: 1.31.9+ and the stable 1.30.7+.
    {
      id: "CVE-2026-123007",
      what: "memory corruption in HTTP/2 flow control",
      hits: x => within(x, "1.9.5", "1.31.8") && !within(x, "1.30.7", "1.30.999"),
      fixed: "1.30.7 or 1.31.9",
    },
  ],
};
// A distribution's build (Apache/2.4.62 (Ubuntu)) is skipped: distributions patch without changing the version.
const DISTRO =
  /\((?:Ubuntu|Debian|Red Hat|CentOS|Fedora|Rocky|AlmaLinux|Amazon|Oracle|SUSE|Linux\/SUSE|openSUSE|Raspbian|Gentoo|Mageia)/i;
/** The Server header's software and its listed holes ({ name, cves: [{ id, what, fixed }] }), or null. */
export function serverHoles(server) {
  const m = String(server || "").match(/^(Apache|nginx)\/(\d+\.\d+\.\d+)\b/i);
  if (!m || DISTRO.test(server)) return null;
  const sw = m[1].toLowerCase() === "nginx" ? "nginx" : "Apache",
    cves = HOLES[sw].filter(h => h.hits(m[2])).map(({ id, what, fixed }) => ({ id, what, fixed }));
  return cves.length ? { name: `${sw === "Apache" ? "Apache httpd" : "nginx"} ${m[2]}`, cves } : null;
}

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
