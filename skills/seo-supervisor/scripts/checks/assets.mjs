// @ts-check
// Image, favicon, stylesheet and schema image checks, and the image and media data for the report.
// Files are read with firstBytes, which never leaves the crawled site.
import { RULES } from "../crawl/catalog.mjs";
import { clean, urlOr } from "../crawl/fetch.mjs";
import { isBusinessType } from "../lib/business.mjs";
import { pool } from "../crawl/queue.mjs";
import { imageSize, imageMeta } from "../lib/image-size.mjs";
import { altProblem, cdnOf, uncached } from "./media.mjs";
import { medianScores } from "./lighthouse.mjs";
import { estSaving } from "../images.mjs";
import { SUPERSEDED } from "./schema.mjs";
// images and shareImages come from checkPages in site-pages.mjs.
export async function checkAssets(site, { images, shareImages }) {
  const {
    htmlPages,
    home,
    add,
    evalRules,
    notes,
    notChecked,
    startOrigin: START_ORIGIN,
    conc: CONC,
    firstBytes,
    toCrawl,
    indexable,
  } = site;
  // Only on-site images are read, so no third party is contacted, even through a page that redirected off the site.
  const onSiteImages = [...images].filter(([src]) => new URL(src).origin === START_ORIGIN),
    imageList = onSiteImages.slice(0, 50);
  const shareList = [...shareImages].slice(0, 20);
  const productImgs = new Map(); // crawl URL -> { src, page }
  for (const p of htmlPages)
    if (indexable(p))
      for (const s of p.productImages || []) {
        const src = urlOr(s, p.finalUrl),
          c = src && clean(toCrawl(src.href));
        if (c && new URL(c).origin === START_ORIGIN && !productImgs.has(c))
          productImgs.set(c, { src: src.href, page: p.finalUrl });
      }
  const productList = [...productImgs].slice(0, 20);
  const onSite = c => !!c && new URL(c).origin === START_ORIGIN;
  const declared = home?.html ? [...new Set(home.icons.map(h => urlOr(h, home.base)?.href).filter(Boolean))] : [];
  const icons = home?.html
    ? [...new Set([...declared.map(d => clean(toCrawl(d))).filter(onSite), START_ORIGIN + "/favicon.ico"])].slice(0, 5)
    : [];
  // One pool fetches every file below, schema images included. firstBytes keeps each answer, so the loops below
  // make no new requests and a file several checks use is fetched once.
  await pool(
    [
      ...new Set([
        ...imageList.map(([s]) => s),
        ...shareList.map(([c]) => c),
        ...productList.map(([c]) => c),
        ...icons,
        ...schemaImageUrls(site).list.map(([c]) => c),
      ]),
    ],
    CONC,
    u => firstBytes(u),
  );
  const imageRows = [];
  const imageInfo = new Map(); // caching, CDN and creator data per weighed image
  let weighed = 0; // PERF-08 counts as checked only when at least one image could be weighed
  for (const [src, page] of imageList) {
    const r = await firstBytes(src);
    if (!r || r.status < 200 || r.status > 299 || !r.size) continue;
    weighed++;
    const { size } = r,
      type = r.type.split(";")[0].trim().toLowerCase(),
      px = imageSize(r.bytes),
      kb = Math.round(size / 1024);
    imageInfo.set(src, { uncached: uncached(r.headers), cdn: cdnOf(r.headers), ...imageMeta(r.bytes) });
    // 500 KB is a local threshold, not Google's; that finding replaces heavy-image rather than adding to it.
    if (size > 500 * 1024) add("image-over-500kb", page, `${src} · ${kb} KB`);
    else if (size > 200 * 1024) add("heavy-image", page, `${src} · ${kb} KB`);
    if (/^image\/(jpeg|png)$/.test(type) && size > 100 * 1024)
      add("legacy-image-format", page, `${src} · ${type} · ${kb} KB`);
    imageRows.push({
      url: src,
      bytes: size,
      width: px?.width ?? null,
      height: px?.height ?? null,
      format: px?.type || type.match(/^image\/([a-z0-9.-]+)/)?.[1] || null,
    });
  }
  if (weighed) evalRules("PERF-08");
  if (onSiteImages.length > 50)
    notes.push(`Image weight was checked for the first 50 of ${onSiteImages.length} images.`);
  // The first 64 KB that firstBytes reads is enough for the pixel size.
  let shareRead = 0,
    shareAway = 0;
  for (const [crawlSrc, { src, page }] of shareList) {
    const r = await firstBytes(crawlSrc);
    if (!r) {
      shareAway++;
      continue;
    } // redirects off the crawled site, so not fetched
    if (r.status !== 200 && r.status !== 206) {
      add("og-image-broken", page, `${src} → ${r.status || `no response (${r.error})`}`);
      continue;
    }
    const size = imageSize(r.bytes);
    if (!size) {
      if (/html/.test(r.type)) add("og-image-broken", page, `${src} → an HTML page, not an image`);
      continue;
    } // SVG, AVIF: size unknown
    shareRead++;
    if (size.width < 1200) add("og-image-small", page, `${src} · ${size.width}×${size.height} px`);
  }
  if (shareAway)
    notes.push(
      `${shareAway} share image(s) (og:image) redirect away from the crawled site (often to the public origin), so they couldn't be read and their size wasn't checked.`,
    );
  if (shareImages.size && !shareRead)
    notes.push("No share image (og:image) could be read, so share image sizes weren't checked.");
  if (shareImages.size > 20)
    notes.push(`Share image size was checked for the first 20 of ${shareImages.size} og:images.`);
  let productRead = 0;
  for (const [crawlSrc, { src, page }] of productList) {
    const r = await firstBytes(crawlSrc),
      size = r && (r.status === 200 || r.status === 206) ? imageSize(r.bytes) : null;
    if (!size) continue; // off the site, broken, SVG or AVIF: not measured
    productRead++;
    // Google recommends at least 50,000 pixels (width × height) for merchant listing images.
    // https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
    const px = size.width * size.height;
    if (px < 50000)
      add("product-image-small", page, `${src} · ${size.width}×${size.height} px (${px.toLocaleString("en")} pixels)`);
  }
  if (htmlPages.some(p => indexable(p) && p.productImages?.length) && !productRead)
    notes.push(
      "No Product schema image on the crawled site could be read (they're on another host, missing, or SVG or AVIF), so product image sizes weren't checked.",
    );
  if (productImgs.size > 20)
    notes.push(`Product image size was checked for the first 20 of ${productImgs.size} Product schema images.`);
  if (home && home.html) {
    if (![...home.types, ...home.schemaOther].some(isBusinessType)) add("org-missing", home.finalUrl);
    if (![...home.types, ...home.schemaOther].includes("WebSite")) add("website-missing", home.finalUrl);
  }
  // Google wants a square favicon of 48 px or more in BMP, GIF, ICO, PNG, JPEG, PPM or TIFF. A type whose size can't
  // be read (BMP, TIFF) passes. https://developers.google.com/search/docs/appearance/favicon-in-search
  if (home && home.html) {
    const away = declared.some(d => !onSite(clean(toCrawl(d))));
    const tried = await Promise.all(icons.map(async c => ({ path: new URL(c).pathname, r: await firstBytes(c) })));
    const loaded = tried.filter(
      t => t.r && (t.r.status === 200 || t.r.status === 206) && t.r.bytes.length && !/html/i.test(t.r.type),
    );
    const svg = t => /svg/i.test(t.r.type) || /^\s*(<\?xml|<svg)/i.test(t.r.bytes.toString("latin1", 0, 100)),
      size = t => imageSize(t.r.bytes);
    const good = t => {
      const s = size(t);
      return s ? s.type !== "webp" && s.width === s.height && s.width >= 48 : !svg(t) && /^image\//i.test(t.r.type);
    };
    const say = t => {
      const s = size(t);
      return `${t.path}: ${s ? `${s.width}×${s.height} px${s.type === "webp" ? ", WebP" : ""}` : svg(t) ? "SVG" : t.r.type || "unknown type"}`;
    };
    const status = t => (t.r.status === 200 ? "an HTML page" : t.r.status || `no response (${t.r.error})`);
    // An icon that redirects off the site (to a CDN or the public origin) isn't followed, so it can't be judged.
    const movedAway = tried.find(t => !t.r);
    if (loaded.some(good)) evalRules("META-10");
    else if (away || movedAway)
      notChecked.push({
        rule: "META-10",
        area: `META-10 ${RULES["META-10"][0]}`,
        reason: away
          ? "The home page's icon is on another host (often a CDN), and only the crawled site is fetched."
          : `${movedAway.path} redirects away from the crawled site (often to a CDN), and only the crawled site is fetched.`,
      });
    else {
      evalRules("META-10");
      if (loaded.length) add("favicon-unsuitable", home.finalUrl, loaded.map(say).join("; "));
      else
        add(
          "favicon-missing",
          home.finalUrl,
          (declared.length ? "" : "no icon link on the home page, and ") +
            tried.map(t => `${t.path} → ${status(t)}`).join("; "),
        );
    }
  }
  // One site-wide suggestion, only when there's a next page to load. A single-page app's server HTML shows neither
  // its links nor the router that loads them, so it can't be judged.
  if (htmlPages.length > 1) {
    if (htmlPages.some(p => p.preloads)) evalRules("PERF-09");
    else if (htmlPages.filter(p => p.clientOnly).length > htmlPages.length / 2)
      notChecked.push({
        rule: "PERF-09",
        area: `PERF-09 ${RULES["PERF-09"][0]}`,
        reason:
          "Most pages are built in the browser (a single-page app), so the server HTML shows neither their links nor the router that loads them. A single-page app's router usually loads the next page itself.",
      });
    else {
      evalRules("PERF-09");
      add("no-speculation-rules", (home?.html ? home : htmlPages[0]).finalUrl, `none of ${htmlPages.length} pages`);
    }
  }
  return { imageRows, imageInfo };
}

// Builds extra.images from the rows checkAssets weighed, so it makes no requests. images comes from checkPages.
export function imageList(site, { images, imageRows }) {
  const { htmlPages, extra, indexable } = site;
  const usedOn = new Map(); // image URL -> pages using it, keyed as in `images`
  for (const p of htmlPages)
    if (!p.clientOnly && indexable(p))
      for (const i of p.imgs) {
        const s = urlOr(i.src, p.base)?.href;
        if (s && images.has(s)) (usedOn.get(s) || usedOn.set(s, []).get(s)).push(p.finalUrl);
      }
  extra.images = imageRows
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 100)
    .map(x => ({ ...x, pages: [...new Set(usedOn.get(x.url))].slice(0, 10), estSaving: estSaving(x) }));
}

// Up to 50 on-site schema images as [crawl URL, { src, page }], and the off-site ones. checkAssets fetches them early.
function schemaImageUrls({ htmlPages, startOrigin: START_ORIGIN, toCrawl, indexable }) {
  const schemaImgs = new Map(),
    away = new Set(); // crawl URL -> { src, page }; images on other hosts
  for (const p of htmlPages) {
    if (p.clientOnly || !indexable(p)) continue;
    for (const s of p.schemaImages) {
      const src = urlOr(s, p.base);
      if (!src || !/^https?:$/.test(src.protocol)) continue;
      const c = clean(toCrawl(src.href));
      if (new URL(c).origin !== START_ORIGIN) away.add(src.href);
      else if (!schemaImgs.has(c)) schemaImgs.set(c, { src: src.href, page: p.finalUrl });
    }
  }
  return { list: [...schemaImgs].slice(0, 50), size: schemaImgs.size, away };
}
// JSON-LD placeholders, superseded types and broken schema images. Off-site images are never fetched.
export async function schemaImages(site) {
  const { htmlPages, add, notes, firstBytes, indexable } = site;
  for (const p of htmlPages) {
    if (p.clientOnly || !indexable(p)) continue;
    if (p.schemaPlaceholder) add("schema-placeholder", p.finalUrl, `“${p.schemaPlaceholder}”`);
    if (p.superseded.length)
      add("schema-superseded", p.finalUrl, p.superseded.map(t => `${t} → ${SUPERSEDED[t]}`).join(", "));
  }
  const { list, size, away } = schemaImageUrls(site);
  for (const [crawlSrc, { src, page }] of list) {
    // already fetched in checkAssets' pool
    const r = await firstBytes(crawlSrc);
    if (!r)
      away.add(src); // redirects off the crawled site, so not followed
    else if (r.status !== 200 && r.status !== 206)
      add("schema-image-broken", page, `${src} → ${r.status || `no response (${r.error})`}`);
    else if (/html/i.test(r.type)) add("schema-image-broken", page, `${src} → an HTML page, not an image`);
  }
  if (away.size)
    notes.push(
      `${away.size} schema image(s) are on another host (often a CDN) or redirect there, e.g. ${[...away][0]}, so they weren't checked: only the crawled site is fetched.`,
    );
  if (size > 50) notes.push(`Schema images were checked for the first 50 of ${size}.`);
}

// Alt text, image preload and prerender findings, then extra.media: LCP elements, server times, DOM shape, image
// credits and caching. speed and lighthouse are the outside checks' results; imageInfo is checkAssets'.
export function mediaData(site, { speed, lighthouse, imageInfo }) {
  const { htmlPages, add, extra, startOrigin: START_ORIGIN, expectOrigin: EXPECT_ORIGIN, indexable } = site;
  const media = {},
    read = htmlPages.filter(p => indexable(p) && !p.clientOnly),
    path = u => urlOr(u)?.pathname ?? u;
  for (const p of read) {
    const u = p.finalUrl,
      bad = p.imgs
        .filter(i => "alt" in i)
        .map(i => [i.alt, altProblem(i.alt, i.src)])
        .filter(([, why]) => why);
    if (bad.length)
      add("img-alt-quality", u, `${bad.length} image(s), e.g. “${bad[0][0].trim().slice(0, 60)}” (${bad[0][1]})`);
    if (p.imagePreloads > 1)
      add("image-preloads", u, `${p.imagePreloads} image preloads: ${p.preloadHrefs.join(", ")}`);
    if (p.prerender.length) add("prerender-hint", u, `<link rel="prerender" href="${p.prerender[0]}">`);
  }
  const heroes = new Map();
  for (const [source, runs] of [
    ["PageSpeed", (speed?.samples || []).map(s => [s.url, s.lab?.lcpElement])],
    ["Lighthouse", (lighthouse || []).map(x => [x.url, x.lcpElement])],
  ])
    for (const [url, el] of runs)
      if (el && !heroes.has(path(url)))
        heroes.set(path(url), {
          url,
          element: el.element,
          ...(el.src ? { src: el.src } : {}),
          source,
          hinted: el.fetchpriorityHigh,
          eager: el.eager,
          discoverable: el.discoverable,
        });
  for (const h of heroes.values()) if (h.hinted === false && h.src) add("hero-no-fetchpriority", h.url, h.src);
  // A lab run's LCP element overrules the per-page checks' first-image guess (often a logo) for lazy-lcp, both ways.
  const guess = site.findings.get("lazy-lcp"),
    page = u => path(u).replace(/\/+$/, "");
  for (const h of heroes.values()) {
    const at = guess ? guess.evidence.findIndex(e => page(e.url) === page(h.url)) : -1;
    if (h.eager === true && at >= 0) {
      guess.evidence.splice(at, 1);
      guess.count--;
    } else if (h.eager === false && at < 0)
      add("lazy-lcp", h.url, `${h.src || h.element} (${h.source}: the LCP image has loading="lazy")`);
    // An LCP image only CSS or a script requests isn't discoverable from the HTML.
    // https://web.dev/articles/optimize-lcp
    if (h.discoverable === false) add("lcp-not-discoverable", h.url, h.src || h.element);
  }
  if (guess && !guess.count) site.findings.delete("lazy-lcp");
  if (heroes.size) media.heroImages = [...heroes.values()].map(({ hinted, eager, discoverable, ...h }) => h);
  const times = htmlPages
    .filter(p => Number.isFinite(p.ms))
    .map(p => ({ url: p.finalUrl, ms: p.ms }))
    .sort((a, b) => a.ms - b.ms);
  // 0.8 s is web.dev's "good" TTFB for real visitors, applied here to a single request from this machine.
  // https://web.dev/articles/ttfb
  if (times.length)
    media.serverTimes = {
      pages: times.length,
      median: times[(times.length - 1) >> 1].ms,
      p95: times[Math.ceil(times.length * 0.95) - 1].ms,
      slow: times
        .filter(t => t.ms > 800)
        .reverse()
        .slice(0, 10),
    };
  // Depth over 32 and over 60 children are local lines taken from older Lighthouse advice.
  const deep = read
    .filter(p => p.domShape.depth > 32)
    .map(p => ({ url: p.finalUrl, depth: p.domShape.depth }))
    .sort((a, b) => b.depth - a.depth);
  const wide = read
    .filter(p => p.domShape.widest.children > 60)
    .map(p => ({ url: p.finalUrl, ...p.domShape.widest }))
    .sort((a, b) => b.children - a.children);
  if (deep.length || wide.length) media.domShape = { deep: deep.slice(0, 20), wide: wide.slice(0, 20) };
  const info = [...imageInfo],
    hosts = {};
  if (info.length)
    media.imageCredits = {
      read: info.length,
      creator: info.filter(([, i]) => i.creator).length,
      ai: info
        .filter(([, i]) => i.ai)
        .map(([s]) => s)
        .slice(0, 20),
      aiCount: info.filter(([, i]) => i.ai).length,
      c2pa: info.filter(([, i]) => i.c2pa).length,
      noCreator: info
        .filter(([, i]) => !i.creator)
        .map(([s]) => s)
        .slice(0, 20),
    };
  for (const p of read)
    for (const i of p.imgs) {
      const x = urlOr(i.src, p.base);
      if (x && /^https?:$/.test(x.protocol) && ![START_ORIGIN, EXPECT_ORIGIN].includes(x.origin))
        hosts[x.host] = (hosts[x.host] || 0) + 1;
    }
  if (info.length || Object.keys(hosts).length)
    media.imageCache = {
      checked: info.length,
      uncached: info
        .filter(([, i]) => i.uncached)
        .map(([s]) => s)
        .slice(0, 20),
      uncachedCount: info.filter(([, i]) => i.uncached).length,
      cdn: info.map(([, i]) => i.cdn).find(Boolean) || null,
      otherHosts: Object.fromEntries(
        Object.entries(hosts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      ),
    };
  if (lighthouse?.length > 1) media.lighthouseMedians = medianScores(lighthouse);
  if (Object.keys(media).length) extra.media = media;
}
