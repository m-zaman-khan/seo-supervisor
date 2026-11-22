// @ts-check
// Per-page checks for seo-crawl.mjs. Thresholds are local, and HTML is read with regexes, as in the crawler.
import { attrs, headEndOf } from "../lib/html.mjs";

const PAID_WORDS = 150; // local threshold for paid text sent in full
export const CHECKS = {
  // Google suggests rel ugc or nofollow on every link in untrusted content.
  // https://developers.google.com/search/docs/monitor-debug/prevent-abuse
  "ugc-link-followed": [
    "CONTENT-11",
    "low",
    n => `${n} page(s) have links to other sites in comments without rel="ugc" or rel="nofollow"`,
    'Spammers leave comments to get links to their own sites. Google\'s guidance on user-generated spam says to add `rel="ugc"` or `rel="nofollow"` to all links in content from users you don\'t trust, so those links pass nothing on and the spam isn\'t worth posting. These links sit in a comment section (WordPress-style comment markup, or schema.org Comment markup) and carry neither, nor `rel="sponsored"`. Links your own staff added in a reply, or from users you trust, can stay as they are.',
    'Add `rel="ugc"` (or `rel="nofollow ugc"`) to links in comments, through the comment template or the comment plugin\'s settings. Google also suggests holding comments for approval and keeping posts from new users out of search (noindex) until they\'ve earned trust.',
  ],
  // Spam since 15 Jun 2026. Google names no code, so the pattern is local.
  // https://developers.google.com/search/blog/2026/04/back-button-hijacking
  "back-button-trap": [
    "CONTENT-11",
    "low",
    n => `${n} page(s) have a script that may stop the Back button working`,
    "Since 15 Jun 2026 Google treats back-button hijacking as spam: a site that changes the browser's history so that Back doesn't return visitors to the page they came from can get a manual action or lose rankings. Google says it can come from a site's ad platform or the libraries it includes. An inline script on these pages adds or changes a history entry as the page loads, with no click (`history.pushState` or `replaceState`), and sends the visitor to another page when they press Back (a `popstate` handler). That's only a possible issue: single-page apps, galleries and filters use the same calls properly. It's fine if pressing Back still takes you to where you came from.",
    'Open the page from another page, then press Back: you should land where you started. If you don\'t, find the script (often an ad, popup or "before you go" offer) and remove it or turn that feature off. Change the history only when the visitor moves within the page, never on load.',
  ],
  // Hiding sent content with JavaScript isn't a reliable paywall to Google. Applebot skips pages marked
  // isAccessibleForFree false as AI context, judged on the page-level markup only.
  // https://developers.google.com/search/docs/crawling-indexing/javascript/fix-search-javascript
  // https://support.apple.com/en-us/119829
  "paywall-text-sent": [
    "REND-06",
    "low",
    n => `${n} paywalled page(s) send the paid text to every visitor`,
    `The page's structured data marks a section as paid (\`isAccessibleForFree: false\`, with \`hasPart\` naming its CSS class), but the HTML this crawler got without logging in already holds ${PAID_WORDS} or more words in that section (our own cut-off). Google says sending the full text and hiding it with JavaScript "isn't a reliable way to limit access": anyone can read it in the page source or with scripts turned off. Google adds that it makes it hard for Google to tell which content is paid and which isn't. This is fine if the page is free to this visitor on purpose, such as a metered site's free articles. Separately, Apple's Applebot doesn't use pages marked \`isAccessibleForFree: false\` as context for AI answers in Apple products; that follows the page-level markup, whatever the HTML holds.`,
    'Send the paid section only once the server has confirmed the visitor may read it; Google says the paywall should provide the full content only "once the subscription status is confirmed". Keep the paywall structured data as it is.',
  ],
  // Google reads only the first 2 MB, accepts a canonical only in the head, ends the head at the first element it
  // can't hold, and reads robots meta anywhere. Next.js 15.2+ streams metadata into the body for all but its bot list.
  // https://developers.google.com/search/blog/2026/03/crawler-blog-post
  // https://developers.google.com/search/docs/crawling-indexing/valid-page-metadata
  // https://nextjs.org/blog/next-15-2
  "head-tags-late": [
    "REND-08",
    "low",
    n => `${n} page(s) send their title, description, canonical, robots or hreflang tag after the <head> ends`,
    "These tags came after the page's `<head>` had ended. For Google the head also ends early, at the first element a head can't hold, such as an `<img>`, an `<iframe>` or a tracking pixel: Google then stops reading the head, so the tags after it count as being in the body. Google asks for the title, meta tags and canonical early in the HTML, because it reads only the first 2 MB of a page, and it accepts a canonical only inside the `<head>`, so one sent in the body works only if the page's JavaScript moves it there. Google does read a robots tag anywhere in the page. Next.js 15.2 and later send metadata late on purpose when it loads slowly (\"streamed metadata\"): browsers and Googlebot, which runs JavaScript, get it in the body, while the bots on Next.js's own list, such as Bingbot, Applebot and the link previews of X, Slack and Facebook, get it in the head. This crawler (user agent seo-supervisor-crawler) isn't on that list, so it saw what a browser gets.",
    "Put these tags in the `<head>`, before any element that doesn't belong there (move an `<img>`, `<iframe>` or tracking pixel into the body). In Next.js, make `generateMetadata` fast (cache the data it reads), or list the bots that should get the head version in `htmlLimitedBots` in next.config; `/.*/` turns streaming off. Elsewhere, check the template, component or plugin that writes the tags into the body.",
  ],
  // Google supports relative canonicals but recommends absolute ones, in the HTML and the HTTP header.
  // https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
  "canonical-relative": [
    "URL-04",
    "low",
    n => `${n} page(s) give their canonical as a relative URL`,
    "The canonical is written without the site's address (`/page/` or `//host/page/`). Google supports relative canonicals but recommends full URLs: a relative one points at whatever host serves the page, so a staging or test copy that gets crawled names itself as the canonical.",
    "Write the canonical as a full URL on the production origin (`https://www.example.com/page/`), built from one setting such as Next.js `metadataBase`, in the HTML and in any `Link` header.",
  ],
  // One Organization and one WebSite node, with stable @ids, on every page.
  "site-identity-differs": [
    "SCHEMA-02",
    "low",
    n => `${n} page(s) describe the site's organization or website with a different @id or name`,
    "Organization and WebSite structured data say who runs the site and what it's called. Each should be one node with the same `@id` and name on every page, so that every page points at the same organization and site. On these pages the node uses a different `@id` from the one most pages use, or the same `@id` with a different name, so the pages disagree about who runs the site. A relative `@id` such as `#organization` is read against the page it's on, so on `/about/` it names `/about/#organization`, another node from the home page's.",
    "Output the Organization and WebSite nodes from one place, such as the root layout, with fixed `@id`s (`https://your-site/#organization`, `https://your-site/#website`), and take their names from one setting.",
  ],
};

// Takes a whole tag or just the attribute text after its name.
const attr = (tag, name) => attrs(tag)[name] ?? null;
const strip = h => h.replace(/<(script|style|noscript|template|svg|textarea)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, " ");
const SEG = new Intl.Segmenter(undefined, { granularity: "word" });
const wordCount = h => [...SEG.segment(h.replace(/<[^>]+>/g, " "))].filter(s => s.isWordLike).length;

// Index just past the matching end tag, or -1. Optional end tags aren't inferred, so an element left open is skipped;
// a real parser would fix that.
function elementEnd(html, i, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = i;
  let depth = 0;
  for (let m; (m = re.exec(html));)
    if (!m[1]) depth++;
    else if (--depth === 0) return re.lastIndex;
  return -1;
}
// [start, end] of each element whose start tag passes test, outermost only.
function regions(html, test) {
  const out = [];
  for (const m of html.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)) {
    if ((out.length && m.index < out[out.length - 1][1]) || !test(m[0])) continue;
    const end = elementEnd(html, m.index, m[1]);
    if (end > 0) out.push([m.index, end]);
  }
  return out;
}

// ---------- links in user content (CONTENT-11) ----------
// Only documented comment markup counts: WordPress's comment template and schema.org Comment in Microdata or RDFa.
// A bare "comment" class doesn't (code highlighters use it), nor do forums or reviews a site may write itself.
const UGC_CLASS = /^(comments-area|comment-list|commentlist|comment-body|comment-content)$/;
const ugcArea = tag =>
  /comment/i.test(tag) &&
  (/^(comments|comment-\d+)$/.test(attr(tag, "id") || "") ||
    (attr(tag, "class") || "").split(/\s+/).some(c => UGC_CLASS.test(c)) ||
    `${attr(tag, "itemtype") || ""} ${attr(tag, "typeof") || ""}`
      .split(/\s+/)
      .some(t => /(^|[\/#:])(Comment|UserComments)$/.test(t)));
// Links there without rel ugc, nofollow or sponsored. body is the page body without scripts.
export const ugcLinks = body =>
  regions(body, ugcArea)
    .flatMap(([s, e]) => [...body.slice(s, e).matchAll(/<a\b[^>]*>/gi)].map(m => m[0]))
    .filter(a => !/\b(ugc|nofollow|sponsored)\b/i.test(attr(a, "rel") || ""))
    .map(a => attr(a, "href")?.trim())
    .filter(Boolean);

// ---------- back-button hijacking (CONTENT-11) ----------
// One inline script that changes history with no user event in it (so on load or a timer) and whose popstate handler
// navigates within its first 400 characters, a local window.
const PUSH = /\bhistory\s*\.\s*(pushState|replaceState)\s*\(/,
  POP = /\baddEventListener\s*\(\s*["'`]popstate["'`]|\bonpopstate\s*=/;
const AWAY = /\blocation\s*(?:\.\s*href\s*)?=(?!=)|\blocation\s*\.\s*(?:replace|assign)\s*\(/;
const USER =
  /\baddEventListener\s*\(\s*["'`](?:click|submit|change|input|keydown|keyup|keypress|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend)["'`]|\bon(?:click|submit|change|input|keydown|keyup|mousedown|pointerdown|touchstart)\s*=|\.on\(\s*["'](?:click|submit|change)|\.(?:click|submit|change)\(\s*function/;
export function backTrap(html) {
  for (const [, a, js] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (
      /\ssrc\s*=/i.test(a) ||
      !/^((text|application)\/(x-)?(java|ecma)script|module)?$/i.test((attr(a, "type") || "").trim())
    )
      continue;
    const push = PUSH.exec(js),
      pop = POP.exec(js);
    if (push && pop && !USER.test(js) && AWAY.test(js.slice(pop.index, pop.index + 400)))
      return `an inline script calls history.${push[1]} with no click, and sends the visitor to another page on Back (popstate)`;
  }
  return null;
}

// ---------- paid text sent in full (REND-06) ----------
// Google's paywall markup: isAccessibleForFree false, with hasPart elements marked the same and a .class cssSelector.
// https://developers.google.com/search/docs/appearance/structured-data/paywalled-content
const paid = v => v === false || /^false$/i.test(String(v ?? ""));
export function paywallLeak(body, nodes) {
  const classes = new Set(),
    walk = (o, d) => {
      if (!o || typeof o !== "object" || d > 12) return;
      if (paid(o.isAccessibleForFree))
        for (const part of [].concat(o.hasPart ?? []))
          if (part && paid(part.isAccessibleForFree))
            for (const s of [].concat(part.cssSelector ?? []))
              if (typeof s === "string" && /^\.[\w-]+$/.test(s.trim())) classes.add(s.trim().slice(1));
      Object.values(o).forEach(x => walk(x, d + 1));
    };
  nodes.forEach(n => walk(n, 0));
  if (!classes.size) return null;
  const has = tag => (attr(tag, "class") || "").split(/\s+/).some(c => classes.has(c));
  const words = regions(body, tag => /class/i.test(tag) && has(tag)).reduce(
    (n, [s, e]) => n + wordCount(body.slice(s, e)),
    0,
  );
  return words >= PAID_WORDS ? { selector: [...classes].map(c => "." + c).join(", "), words } : null;
}

// ---------- head tags after the head ends (REND-08) ----------
// The head ends where Google ends it (headEndOf): at </head>, <body> or the first element a head can't hold.
// When nothing ends it (at < 0), no tag can be called late.
export function lateHead(html, at = headEndOf(html).at) {
  if (at < 0) return [];
  const found = new Set();
  for (const [tag, name] of strip(html.slice(at)).matchAll(/<(title|meta|link)\b[^>]*>/gi)) {
    const t = name.toLowerCase(),
      n = (attr(tag, "name") || "").toLowerCase(),
      rel = (attr(tag, "rel") || "").toLowerCase().split(/\s+/);
    if (t === "title") found.add("title");
    else if (t === "meta" && n === "description") found.add("description");
    else if (t === "meta" && (n === "robots" || n === "googlebot")) found.add("robots");
    else if (t === "link" && rel.includes("canonical")) found.add("canonical");
    else if (t === "link" && rel.includes("alternate") && attr(tag, "hreflang")) found.add("hreflang");
  }
  return ["title", "description", "canonical", "robots", "hreflang"].filter(x => found.has(x));
}

// ---------- the site's identity (SCHEMA-02) ----------
// The most common value and its count, or [] when there's none or a tie.
const tally = list => {
  const m = new Map();
  for (const k of list) m.set(k, (m.get(k) || 0) + 1);
  const [[top, n] = [], [, next] = []] = [...m].sort((a, b) => b[1] - a[1]);
  return n > (next ?? 0) ? [top, n] : [];
};
// A relative @id ("#organization") resolves against the page it's on, so it names a different node on each page.
// https://www.w3.org/TR/json-ld11/#iris
const idOf = (id, page) => {
  if (typeof id !== "string" || !id.trim()) return null;
  for (const base of [undefined, page])
    try {
      return new URL(id.trim(), base).href;
    } catch {}
  return id.trim();
};
const nameOf = s => (typeof s === "string" && s.trim() ? s.replace(/\s+/g, " ").trim() : null);
// pages: [{ url, org: [{ id, name }], site: [{ id, name }] }]. The site's @id is the one most pages use, and its name
// the one most of those give. A node with neither is another organization (a partner, a client), and without @ids one
// organization can't be told from two, so neither is flagged. Returns url -> detail.
export function identityDrift(pages) {
  const out = new Map(),
    note = (url, s) => out.set(url, out.has(url) ? `${out.get(url)}; ${s}` : s);
  for (const [kind, label] of [
    ["org", "Organization"],
    ["site", "WebSite"],
  ]) {
    const nodes = pages.map(p => p[kind].map(x => ({ id: idOf(x.id, p.url), name: nameOf(x.name) })));
    const [id, onPages] = tally(nodes.flatMap(ns => [...new Set(ns.map(x => x.id).filter(Boolean))]));
    if (!id || onPages < 2) continue;
    const [name] = tally(nodes.flatMap(ns => [...new Set(ns.filter(x => x.id === id && x.name).map(x => x.name))]));
    nodes.forEach((ns, i) => {
      if (ns.some(x => x.id === id && (!name || !x.name || x.name === name))) return;
      const renamed = ns.find(x => x.id === id),
        moved = name && ns.find(x => x.id && x.name === name);
      if (renamed) note(pages[i].url, `${label} name “${renamed.name}” for ${id}, where other pages say “${name}”`);
      else if (moved) note(pages[i].url, `${label} @id ${moved.id}, where other pages use ${id}`);
    });
  }
  return out;
}
