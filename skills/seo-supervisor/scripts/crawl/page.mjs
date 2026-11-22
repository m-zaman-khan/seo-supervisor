// @ts-check
// Reads one crawled page into the record the checks use. site.toCrawl and site.sitemapHreflang are functions because
// the public origin can change mid-crawl.
import {
  CLIENT_ROUTER,
  ORG_RE,
  NOSPACE_RUN,
  attrs,
  capsOf,
  ctx,
  deepHas,
  jsonLdNodes,
  norm,
  stripNonContent,
  tagsOf,
  textOf,
  typesOf,
  wordsOf,
} from "../lib/html.mjs";
import { clean, urlOr } from "./fetch.mjs";
import { RETIRED, KEPT, SHOP_FIELDS } from "./catalog.mjs";
import { trustFeatures } from "../checks/trust.mjs";
import { VALUED, agentFeatures, bingAiRules } from "../checks/agents.mjs";
import { writingText, writingFeatures } from "../checks/writing.mjs";
import { linkHreflang, mergeHreflang, languageFeatures } from "../checks/hreflang.mjs";
import { insecureResources } from "../checks/technical.mjs";
import { ugcLinks, backTrap, paywallLeak, lateHead } from "../checks/page.mjs";
import { fragmentLinks } from "../checks/crawl.mjs";
import { analyticsTwice, secretsIn, hiddenLinks, appPromo } from "../checks/hygiene.mjs";
import { SUPERSEDED, placeholderIn, merchantProblems, sellsWithOffer, reviewEventProblems } from "../schema-check.mjs";
import { mainWords as pickMainWords } from "../keyword-ideas.mjs";
import { lazySrc, hintsOf, domShape } from "../checks/media.mjs";
import { obsoleteMore, keywordUse, isGuide, newestDate } from "../checks/content.mjs";
import { localFeatures } from "../checks/local.mjs";

// Google's rules from one robots meta content or X-Robots-Tag line. A "<crawler>:" prefix holds for the rules after it,
// and only unprefixed and googlebot rules count. "none" is noindex plus nofollow.
// https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
export const agentRule = t => {
  const m = /^\s*([a-z][\w-]*)\s*:\s*(.*)$/.exec(t);
  return m && !VALUED.test(m[1]) ? m : null;
};
function googleRobots(s) {
  let agent = null;
  const out = [];
  for (let t of (s || "").toLowerCase().split(",")) {
    const m = agentRule(t);
    if (m) [, agent, t] = m;
    t = t.trim().replace(/\s*:\s*/, ":");
    if (t && (!agent || agent === "googlebot")) out.push(...(t === "none" ? ["noindex", "nofollow"] : [t]));
  }
  return out;
}
// Consent managers have to run before anything else, so a blocking script from one is fine.
const CONSENT_HOST =
  /(^|\.)(cookiebot\.(com|eu)|cookielaw\.org|onetrust\.com|usercentrics\.eu|privacy-center\.org|iubenda\.com|cookieyes\.com|termly\.io|osano\.com)$/i;
// xRobotsLines: the X-Robots-Tag lines kept apart, when crawlOne (crawl/queue.mjs) read them raw.
export function analyze(url, html, headers, xRobotsLines, site) {
  const { start: START, startOrigin: START_ORIGIN, banned: BANNED, verify: VERIFY, toCrawl, sitemapHreflang } = site;
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html;
  const bodyStart = html.search(/<body\b/i);
  const bodyRaw = bodyStart >= 0 ? html.slice(bodyStart) : html;
  const body = stripNonContent(bodyRaw);
  const text = textOf(body);
  const words = wordsOf(text).length;
  // Next.js 15.2+ can stream metadata into <body> for non-bot visitors, so metas after the head count too. Only what
  // follows the head is read: </head> and <body> are optional, and minifiers drop them.
  const metas = [
    ...tagsOf(head, "meta"),
    ...tagsOf(stripNonContent(html.slice(Math.max(head.length, bodyStart))), "meta"),
  ];
  const meta = n => metas.find(m => (m.name || m.property || "").toLowerCase() === n)?.content;
  const titleM = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const titleCount = (stripNonContent(head).match(/<title\b/gi) || []).length; // an inline SVG's <title> isn't one, nor is a script's
  const PH =
    /\b[Ll]orem [Ii]psum\b|\bTODO\b|\bTBD\b|\{\{\s*[\w.]+\s*\}\}|\[(?:[A-Z][A-Z _]{2,29})\]|�|\b(?:We|You|They|It|Don|Can|Isn|Won|Doesn|Didn|That|There)\?(?:ve|re|s|t|ll|d)\b/;
  const robotsTags = tagsOf(html, "meta").filter(m => ["robots", "googlebot"].includes((m.name || "").toLowerCase())); // Google honours robots meta in <body> too
  const robotsMeta = robotsTags
    .map(m => m.content || "")
    .join(",")
    .toLowerCase();
  const xRobots = (headers.get("x-robots-tag") || "").toLowerCase();
  const metaRules = robotsTags.flatMap(m => googleRobots(m.content)),
    headerRules = (xRobotsLines?.length ? xRobotsLines : [xRobots]).flatMap(googleRobots),
    directives = [...metaRules, ...headerRules];
  const hreflang = tagsOf(head, "link")
    .filter(l => (l.rel || "").toLowerCase().split(/\s+/).includes("alternate") && l.hreflang && l.href)
    .map(l => ({ lang: l.hreflang, href: l.href }));
  // Render-blocking: head scripts without async, defer or type="module" (other types don't run, and browsers skip
  // nomodule), except consent managers', and stylesheets for every screen. Comments hide old IE shims, and <noscript>
  // holds the fallbacks of stylesheets loaded later, so both are stripped.
  const headOnly = (headEnd > 0 ? html.slice(0, headEnd) : bodyStart > 0 ? html.slice(0, bodyStart) : "").replace(
    /<!--[\s\S]*?-->|<noscript\b[\s\S]*?<\/noscript>/gi,
    " ",
  );
  const blockingJs = tagsOf(headOnly, "script")
    .filter(
      s =>
        s.src &&
        !["async", "defer", "nomodule"].some(k => k in s) &&
        /^((text|application)\/(x-)?(java|ecma)script)?$/i.test((s.type || "").trim()) &&
        !CONSENT_HOST.test(urlOr(s.src, url)?.hostname || ""),
    )
    .map(s => s.src);
  const blockingCss = tagsOf(headOnly, "link").filter(l => {
    const rel = (l.rel || "").toLowerCase().split(/\s+/);
    return (
      rel.includes("stylesheet") &&
      !rel.includes("alternate") &&
      !("disabled" in l) &&
      /^(all|screen)?$/i.test((l.media || "").trim())
    );
  }).length;
  // The favicon links Google reads, with the body as the fallback.
  // https://developers.google.com/search/docs/appearance/favicon-in-search
  const iconsIn = h =>
    tagsOf(h, "link")
      .filter(
        l =>
          l.href &&
          (l.rel || "")
            .toLowerCase()
            .split(/\s+/)
            .some(r => ["icon", "apple-touch-icon", "apple-touch-icon-precomposed"].includes(r)),
      )
      .map(l => l.href);
  const icons = iconsIn(head).length ? iconsIn(head) : iconsIn(body);
  const canonIn = h =>
    tagsOf(h, "link")
      .filter(l => (l.rel || "").toLowerCase().split(/\s+/).includes("canonical"))
      .map(l => l.href);
  const canon = canonIn(head).length ? canonIn(head) : canonIn(body);
  const headings = [...body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({
    level: +m[1],
    text: textOf(m[2]),
  }));
  const anchors = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({
    href: attrs("<a " + m[1] + ">").href,
    text: textOf(m[2]),
  }));
  const imgs = tagsOf(body, "img");
  const { nodes, errors } = jsonLdNodes(html);
  const types = [...new Set(nodes.flatMap(typesOf))];
  // Microdata (itemtype) and RDFa (typeof) types: "https://schema.org/Product" and "schema:Product" read as Product.
  const schemaOther = [
    ...new Set(
      [...stripNonContent(html).matchAll(/<[a-z][\w-]*\s[^>]*(?:itemtype|typeof)\s*=[^>]*>/gi)]
        .flatMap(m => {
          const a = attrs(m[0]);
          return `${a.itemtype || ""} ${a.typeof || ""}`.trim().split(/\s+/);
        })
        .map(t => t.replace(/^.*[\/#:]/, ""))
        .filter(Boolean),
    ),
  ];
  // Top-level field names per type, merged across blocks, so a later crawl can tell which fields went missing.
  const schemaProps = {};
  for (const n of nodes)
    for (const t of typesOf(n))
      schemaProps[t] = [
        ...new Set([...(schemaProps[t] || []), ...Object.keys(n).filter(k => !k.startsWith("@"))]),
      ].sort();
  const faqQs = nodes
    .filter(n => typesOf(n).includes("FAQPage"))
    .flatMap(n => [].concat(n.mainEntity || []))
    .map(q => q && q.name)
    .filter(Boolean);
  const crumbs = nodes
    .filter(n => typesOf(n).includes("BreadcrumbList"))
    .flatMap(n => [].concat(n.itemListElement || []))
    .map(i => i && (typeof i.item === "string" ? i.item : i.item && (i.item["@id"] || i.item.url)))
    .filter(Boolean);
  const hasRating = nodes.some(n =>
    deepHas(n, o => "aggregateRating" in o || typesOf(o).some(t => t === "AggregateRating" || t === "Review")),
  );
  // Matched at any depth, as schema-check.mjs does; a `top` type (Occupation) only when not nested.
  const uses = r => (r.top ? types.includes(r.type) : nodes.some(n => deepHas(n, o => typesOf(o).includes(r.type))));
  const deprecated = RETIRED.filter(uses).map(r => r.type),
    kept = KEPT.filter(uses).map(r => r.type);
  const phMatch = text.match(PH);
  const mainM = body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const mainHtml = mainM ? mainM[1] : body.replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
  const mw = wordsOf(textOf(mainHtml).toLowerCase());
  const mainHrefs = [...mainHtml.matchAll(/<a\b([^>]*)>/gi)].map(m => attrs("<a " + m[1] + ">").href).filter(Boolean);
  let shingles = null;
  if (mw.length >= 50) {
    shingles = new Set();
    for (let i = 0; i + 5 <= mw.length; i++) shingles.add(mw.slice(i, i + 5).join(" "));
  }
  // Phone and street address from local business schema (LOCAL-05). Organization, Corporation, online-only businesses
  // and Service aren't local.
  const nap = [
    ...new Map(
      nodes
        .filter(n =>
          typesOf(n).some(
            t =>
              ORG_RE.test(t) &&
              !/(Organization|Corporation|NGO|School)$|^(OnlineStore|OnlineBusiness|Service)$/.test(t),
          ),
        )
        .flatMap(n => [
          ...[]
            .concat(n.telephone || [])
            .filter(t => typeof t === "string" && t.replace(/\D/g, "").length >= 7)
            .map(value => ({ kind: "phone", value })),
          ...[]
            .concat(n.address || [])
            .map(a => (typeof a === "string" ? a : a?.streetAddress))
            .filter(s => typeof s === "string" && norm(s))
            .map(value => ({ kind: "street address", value })),
        ])
        .map(f => [f.kind + f.value, f]),
    ).values(),
  ];
  // Merchant listing fields (SHOP-05).
  // https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
  const products = nodes
    .filter(n => typesOf(n).includes("Product"))
    .map(n => {
      const offers = [].concat(n.offers || []).filter(o => o && typeof o === "object");
      const orgHas = key => nodes.some(o => typesOf(o).some(t => ORG_RE.test(t)) && o[key]);
      const prices = offers
        .map(o => o.price ?? o.lowPrice)
        .filter(v => v != null && !isNaN(parseFloat(v)))
        .map(v => Number(String(v).replace(/,/g, "")));
      // Every offer needs its own shipping and returns, an AggregateOffer's listed offers included, unless the
      // organization sets them once.
      const each = offers.flatMap(o =>
        typesOf(o).includes("AggregateOffer") && o.offers
          ? [].concat(o.offers).filter(x => x && typeof x === "object")
          : [o],
      );
      return {
        name: n.name || "a product",
        offers: each.length,
        singleAggregate: offers.some(
          o =>
            typesOf(o).includes("AggregateOffer") &&
            (o.offerCount == null ||
              Number(o.offerCount) <= 1 ||
              (o.highPrice != null && Number(o.highPrice) === Number(o.lowPrice))),
        ),
        noShipping: orgHas("hasShippingService") ? 0 : each.filter(o => !o.shippingDetails).length,
        noReturns:
          n.hasMerchantReturnPolicy || orgHas("hasMerchantReturnPolicy")
            ? 0
            : each.filter(o => !o.hasMerchantReturnPolicy).length,
        prices, // every offer's price: the page may show any one variant
      };
    });
  // Parses a shown amount whatever its thousands and decimal separators.
  const toNum = s => {
    s = s.replace(/\s/g, "");
    const i = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    return i >= 0 && s.length - i - 1 !== 3
      ? Number(s.slice(0, i).replace(/[.,]/g, "") + "." + s.slice(i + 1))
      : Number(s.replace(/[.,]/g, ""));
  };
  // A number is grouped in threes ("1 299,00", "10.000", "1,299.00") or plain ("29.99"), and "$49 99" (superscript
  // cents) reads as 49.99 too. Every reading is kept, so a mismatch needs all of them to differ from the schema.
  const NUM = String.raw`\d{1,3}(?:[.,\s  ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`,
    CUR = String.raw`[$€£¥₹]|\b(?:USD|EUR|GBP|CAD|AUD|INR)\b`;
  const amounts = products.length
    ? [
        ...text.matchAll(
          new RegExp(
            `(?:${CUR})\\s?(${NUM})(?:\\s(\\d{2})(?!\\d))?|(${NUM})\\s?(?:[€£]|\\b(?:USD|EUR|GBP|CAD|AUD|INR)\\b)`,
            "g",
          ),
        ),
      ]
        .flatMap(m => {
          const n = toNum(m[1] ?? m[3]);
          return m[2] && !/[.,]\d{1,2}$/.test(m[1]) ? [n, n + Number(m[2]) / 100] : [n];
        })
        .filter(x => !isNaN(x))
    : [];
  const refresh = metas.find(m => (m["http-equiv"] || "").toLowerCase() === "refresh")?.content || "";
  const emptyRoot = /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(bodyRaw);
  // An unload handler keeps the page out of the back/forward cache.
  // https://web.dev/articles/bfcache
  const inlineJs = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join("\n");
  const unload = /addEventListener\(\s*["'`]unload["'`]|\bonunload\s*=/.test(inlineJs)
    ? "an unload listener in an inline script"
    : /<[a-z][^>]*\sonunload\s*=/i.test(html)
      ? "an onunload attribute"
      : null;
  // Links with no accessible name: no text (an SVG's <title> counts), aria-label, aria-labelledby, title, or alt or
  // label inside. aria-hidden links (a card's image link beside its text link) are skipped, as axe and Lighthouse do.
  const emptyLinks = [
    ...bodyRaw
      .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, " ")
      .matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi),
  ]
    .map(m => [attrs("<a " + m[1] + ">"), m[2]])
    .filter(
      ([a, inner]) =>
        "href" in a &&
        a["aria-hidden"]?.trim().toLowerCase() !== "true" &&
        ![a["aria-label"], a["aria-labelledby"], a.title].some(v => v?.trim()) &&
        !textOf(inner) &&
        !/\s(alt|aria-label|aria-labelledby|title)\s*=\s*["']?\s*[^\s"'>]/i.test(inner),
    )
    .map(([a]) => a.href);
  // The header's charset wins over the meta tag's; names are compared as browsers read them ("latin1" is windows-1252).
  const label = s =>
      (s || "")
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase() || null,
    encoding = s => {
      try {
        return new TextDecoder(s).encoding;
      } catch {
        return s;
      }
    };
  const headerCs = label((headers.get("content-type") || "").match(/charset=([^;\s]+)/i)?.[1]);
  const metaCs = label(
    metas
      .map(
        m =>
          m.charset ||
          (/^content-type$/i.test(m["http-equiv"] || "") && (m.content || "").match(/charset=([^;\s]+)/i)?.[1]),
      )
      .find(Boolean),
  );
  // Obsolete tags are looked for in the whole document, since a frameset takes the body's place.
  const obsolete = [
    ...new Set(
      [
        ...html
          .replace(/<(script|style|template)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, " ")
          .matchAll(/<(frameset|frame|marquee|blink|font|center)(?=[\s>\/])/gi),
      ].map(m => m[1].toLowerCase()),
    ),
  ];
  const rec = {
    // Relative URLs resolve against the first <base href>, itself resolved against the page URL, as browsers do.
    base: urlOr(tagsOf(head, "base").find(b => b.href)?.href ?? url, url)?.href ?? url,
    title: titleM ? textOf(titleM[1]) : null,
    description: meta("description") ?? null,
    ogTitle: meta("og:title") ?? null,
    ogImage: meta("og:image") ?? null,
    ogUrl: meta("og:url") ?? null,
    ogDescription: meta("og:description") ?? null,
    ogImageSized: !!(meta("og:image:width") && meta("og:image:height")),
    // X reads twitter: tags from name= and falls back to property=, and the last twitter:card on the page wins.
    // From X's cards getting-started guide, archived 30 May 2025.
    twitterCard: metas.findLast(m => (m.name || m.property || "").toLowerCase() === "twitter:card")?.content ?? null,
    doctype: /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype html/i.test(html.replace(/^\uFEFF/, "")),
    charset:
      metas.some(m => m.charset || /charset=/i.test(m.content || "")) ||
      /charset=/i.test(headers.get("content-type") || ""),
    viewport: /width\s*=\s*device-width/i.test(meta("viewport") || ""),
    refreshTo: (refresh.match(/url\s*=\s*['"]?([^'"\s;]+)/i) || [])[1] || null,
    robotsMeta,
    xRobots,
    lang: (html.match(/<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i) || [])[1] || null,
    noindex: directives.includes("noindex"),
    nofollow: directives.includes("nofollow"),
    metaRules,
    headerRules,
    canonicals: canon,
    hreflang,
    products,
    amounts,
    nosnippet: directives.some(r => r === "nosnippet" || r === "max-snippet:0"),
    largePreview: directives.includes("max-image-preview:large"),
    headings,
    h1Count: headings.filter(h => h.level === 1).length,
    words,
    normText: norm(text),
    caps: capsOf(text),
    anchors,
    imgs,
    icons,
    blockingJs,
    blockingCss,
    nap,
    types,
    schemaOther,
    schemaProps,
    jsonldErrors: errors,
    faqQs,
    crumbs,
    hasRating,
    deprecated,
    kept,
    emptyRoot,
    mainHrefs,
    banned: BANNED ? ctx(text, BANNED) : null,
    unconfirmed: VERIFY ? ctx(text, VERIFY) : null,
    shingles,
    titleCount,
    placeholder: phMatch ? phMatch[0] : null,
    hashLinks: anchors.filter(l => !l.href || l.href === "#" || /^javascript:/i.test(l.href)).length,
    scripts: (html.match(/<script\b[^>]*\bsrc=/gi) || []).length,
    bytes: Buffer.byteLength(html),
    noStore: /\bno-store\b/i.test(headers.get("cache-control") || ""),
    unload,
    emptyLinks,
    obsolete,
    charsetMismatch:
      headerCs && metaCs && encoding(headerCs) !== encoding(metaCs) ? `header: ${headerCs} · meta: ${metaCs}` : null,
    preloads:
      /<script\b[^>]*\btype\s*=\s*["']?speculationrules/i.test(html) ||
      headers.has("speculation-rules") ||
      CLIENT_ROUTER.test(html),
    // Body elements as Lighthouse counts them; what a script, style, noscript or template holds isn't in the DOM tree.
    elements: (
      bodyRaw
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "<$1>")
        .match(/<[a-z][\w-]*/gi) || []
    ).length,
  };
  rec.trust = trustFeatures(html, url, rec.base);

  rec.agent = agentFeatures(html);
  rec.writing = writingFeatures(writingText(mainHtml), rec.lang);

  // The home page's main text feeds the business-type guess, minus post teasers (two or more <article>s).
  if (url === START.href || new URL(url).pathname === "/")
    rec.bizText = textOf(
      (mainHtml.match(/<article\b/gi) || []).length > 1
        ? mainHtml.replace(/<article\b[\s\S]*?<\/article>/gi, " ")
        : mainHtml,
    );

  // Links with a space or non-ASCII character in the path or query. A non-ASCII host is fine: browsers punycode it.
  const rawPath = h => h.replace(/^(?:[a-z][\w+.-]*:)?\/\/[^/?#]*/i, "").split("#")[0];
  rec.unencoded = [
    ...new Set(
      anchors
        .map(a => a.href?.trim())
        .filter(h => h && !/^(mailto|tel|javascript|sms|data):/i.test(h) && /[^\x21-\x7e]/.test(rawPath(h))),
    ),
  ];
  // Wide images without srcset; one in a <picture> has its own sources, and SVG scales.
  const realSrc = i => i.src && !/^data:/i.test(i.src);
  rec.wideImgs = tagsOf(body.replace(/<picture\b[\s\S]*?<\/picture>/gi, " "), "img")
    .filter(
      i => realSrc(i) && parseInt(i.width) > 1000 && !i.srcset && !i["data-srcset"] && !/\.svg(?:[?#]|$)/i.test(i.src),
    )
    .map(i => `${i.src} (${parseInt(i.width)} px)`);
  // Images from the 11th on with no loading attribute (an explicit eager is a choice), bar script-loaded and tiny ones.
  rec.eagerLate = imgs
    .slice(10)
    .filter(i => realSrc(i) && !("loading" in i) && !i["data-src"] && !(parseInt(i.width) < 100))
    .map(i => i.src);

  // hreflang from the HTML, Link header and sitemap is merged before the checks run, noting where sources disagree.
  Object.assign(
    rec,
    mergeHreflang(
      { html: hreflang, header: linkHreflang(headers.get("link")), sitemap: sitemapHreflang(url) },
      url,
      toCrawl,
    ),
    languageFeatures(html, nodes),
  );

  // Number-only headings are flagged, years aside.
  rec.dupHead = ["description", "robots", "viewport", "og:title"]
    .map(
      n =>
        /** @type {[string, number]} */ ([
          n,
          metas.filter(m => (m.name || m.property || "").toLowerCase() === n).length,
        ]),
    )
    .filter(([, c]) => c > 1)
    .map(([n, c]) => `${c} × ${n}`);
  rec.numberHeadings = headings
    .filter(
      h => /^[#№]?[+\-−]?[$€£¥]?\d[\d.,\s]*(?:[kmb%x×])?\+?\.?$/i.test(h.text) && !/^(1[5-9]|20)\d\d$/.test(h.text),
    )
    .map(h => `H${h.level} “${h.text}”`);
  rec.referrerMeta = meta("referrer") ?? null;

  // http:// files in the head and body, judged later site-wide against the public origin.
  rec.insecure = insecureResources(html, headers.get("content-security-policy") || "");

  // Hrefs and srcs no URL parser can read, which the crawl would otherwise skip silently.
  rec.badUrls = [
    ...new Set(
      [...anchors.map(a => a.href), ...imgs.map(i => i.src)].filter(h => h?.trim() && !urlOr(h.trim(), rec.base)),
    ),
  ];

  // Inputs for checks/page.mjs. identity takes the business (not Service) and WebSite nodes' @id and name.
  const idNodes = pred => nodes.filter(n => typesOf(n).some(pred)).map(n => ({ id: n["@id"], name: n.name }));
  rec.pageChecks = {
    ugc: ugcLinks(body)
      .map(h => urlOr(h, rec.base))
      .filter(x => x && /^https?:$/.test(x.protocol))
      .map(x => x.href),
    backTrap: backTrap(html),
    paywall: paywallLeak(body, nodes),
    late: lateHead(html),
    identity: { org: idNodes(t => ORG_RE.test(t) && t !== "Service"), site: idNodes(t => t === "WebSite") },
  };

  // Fragment targets (every id, and <a name>) and the links that jump to one, for checks/crawl.mjs.
  rec.anchorIds = new Set(
    [
      ...html
        .replace(/<(script|style|template)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, " ")
        .matchAll(/<([a-z][\w-]*)\s[^>]*\b(?:id|name)\s*=[^>]*>/gi),
    ]
      .flatMap(m => {
        const a = attrs(m[0]);
        return [a.id, m[1].toLowerCase() === "a" ? a.name : null];
      })
      .filter(Boolean),
  );
  rec.fragLinks = fragmentLinks(
    [...body.matchAll(/<a\b[^>]*>/gi)].map(m => attrs(m[0])),
    rec.base,
  ).map(([u, name]) => [clean(toCrawl(u)), name]);

  // Inputs for checks/hygiene.mjs. A secret key leaves analyze only as its type and first characters; its words are
  // kept just to scrub them from the words file.
  {
    const keys = secretsIn(html),
      navHrefs = [...body.matchAll(/<nav\b[\s\S]*?<\/nav>/gi)].flatMap(m => tagsOf(m[0], "a").map(a => a.href));
    const own = h => {
      const x = urlOr((h || "").trim(), rec.base),
        c = x && /^https?:$/.test(x.protocol) ? clean(toCrawl(x.href)) : null;
      return c && new URL(c).origin === START_ORIGIN ? c : null;
    };
    const pdfOf = h => {
      const c = own(h);
      return c && /\.pdf$/i.test(new URL(c).pathname) ? c : null;
    };
    rec.hygieneSignals = {
      analytics: analyticsTwice(html),
      keys: keys.map(k => `${k.label} (${k.shown})`),
      scrub: keys.flatMap(k => pickMainWords(k.raw)),
      hidden: hiddenLinks(body),
      app: appPromo(html),
      schema: reviewEventProblems(nodes),
      pdfs: [...new Set(anchors.map(a => pdfOf(a.href)).filter(Boolean))],
      navPdfs: [...new Set(navHrefs.map(pdfOf).filter(Boolean))],
      js: [
        ...new Set(
          tagsOf(html.replace(/<!--[\s\S]*?-->/g, " "), "script")
            .map(s => s.src && own(s.src))
            .filter(Boolean),
        ),
      ],
    };
  }

  // Words for the Markdown comparison: the main text, and all a reader sees. Kept on every page with 50+ main words,
  // as the Markdown sample is picked after the crawl, and joined into strings to save memory.
  {
    const w = s => pickMainWords(s.replace(NOSPACE_RUN, " ")),
      main = w(textOf(mainHtml));
    if (main.length >= 50)
      rec.markdownWords = {
        main: main.join(" "),
        all: w([rec.title, rec.description, rec.ogTitle, rec.ogDescription, text].join(" ")).join(" "),
      };
  }

  // Words of the title, H1s and main text, for keyword-ideas.mjs. Runs of a script written without spaces are dropped
  // (no words to match), and a page mostly in one is marked, so no missing search is claimed for it.
  {
    const t = [rec.title || "", ...headings.filter(h => h.level === 1).map(h => h.text), textOf(mainHtml)].join(" "),
      ns = (t.match(NOSPACE_RUN) || []).join("").length;
    rec.mainWordsText = pickMainWords(t.replace(NOSPACE_RUN, " ")).join(" ");
    rec.mainNoSpace = ns * 2 > (t.match(/\p{L}/gu) || []).length;
  }

  // Bing's AI rules (AI-03), kept only on pages that have any.
  {
    const b = bingAiRules(
      tagsOf(html, "meta")
        .filter(m => /^(robots|bingbot)$/i.test(m.name || ""))
        .map(m => m.content || ""),
      xRobotsLines?.length ? xRobotsLines : [headers.get("x-robots-tag") || ""],
    );
    if (b.legacy.length || b.prefs.length) rec.bingAi = b;
  }

  rec.schemaPlaceholder = placeholderIn(JSON.stringify(nodes));
  // Deprecated types count at any JSON-LD depth, and in Microdata or RDFa.
  rec.superseded = Object.keys(SUPERSEDED).filter(
    t => schemaOther.includes(t) || nodes.some(n => deepHas(n, o => typesOf(o).includes(t))),
  );
  const schemaImages = new Set(),
    pick = (o, d) => {
      if (!o || typeof o !== "object" || d > 12) return;
      for (const k of ["image", "logo", "thumbnailUrl"])
        for (const x of [].concat(o[k] ?? [])) {
          const s = typeof x === "string" ? x : x?.contentUrl || x?.url;
          if (typeof s === "string" && s.trim()) schemaImages.add(s.trim());
        }
      Object.values(o).forEach(x => pick(x, d + 1));
    };
  nodes.forEach(n => pick(n, 0));
  rec.schemaImages = [...schemaImages];

  // Per Product: merchant listing problems, a missing required image, no adult label on a page rated adult for
  // SafeSearch, and the recommended fields given. A stand-in brand doesn't count as one.
  const shopNodes = nodes.filter(n => typesOf(n).includes("Product"));
  if (shopNodes.length) {
    const adult = metas.some(
      m =>
        (m.name || "").toLowerCase() === "rating" &&
        /^(adult|RTA-5042-1996-1400-1577-RTA)$/i.test((m.content || "").trim()),
    );
    const filled = (n, k) => n[k] != null && n[k] !== "" && !(Array.isArray(n[k]) && !n[k].length);
    rec.shop = shopNodes.map(n => {
      const problems = merchantProblems(n);
      if (sellsWithOffer(n) && !filled(n, "image")) problems.push({ check: "image-missing" });
      if (
        adult &&
        ![]
          .concat(n.hasAdultConsideration ?? [])
          .some(x => /SexualContentConsideration$/.test(typeof x === "string" ? x : x?.["@id"] || ""))
      )
        problems.push({ check: "adult-unlabelled" });
      const fields = Object.keys(SHOP_FIELDS).filter(
        f =>
          SHOP_FIELDS[f].some(k => filled(n, k)) &&
          !(f === "brand" && problems.some(x => x.check === "brand-placeholder")),
      );
      return { name: typeof n.name === "string" && n.name ? n.name : "a product", problems, fields };
    });
  }

  // A lazy-loading script's image (data-src behind a placeholder) is read as its real file, so it's weighed and named.
  // The LCP guess is the fetchpriority="high" image, else the first not declared under 100 × 100 px or named an icon.
  const lazy = imgs.map(lazySrc);
  rec.firstScriptLazy = !!lazy[0];
  imgs.forEach((i, k) => {
    if (lazy[k]) i.src = lazy[k];
  });
  Object.assign(rec, hintsOf(html), { domShape: domShape(bodyRaw) });

  // Dates are read from the whole body, not the main text, since an article's <header> often holds them.
  rec.obsolete.push(...obsoleteMore(html));
  rec.guideDate = isGuide(url, rec.title, types) ? newestDate(body, nodes) : null;
  rec.keywordUse = /^en(?![a-z])/i.test(rec.lang || "")
    ? keywordUse({ title: rec.title, headings, description: rec.description || "", text: textOf(mainHtml) })
    : null;

  // Local business schema, plus "we come to you" wording in the text.
  rec.local = localFeatures(nodes, text);

  return rec;
}
// Product schema images, for the pixel size Google recommends (SHOP-05).
export const productImages = html =>
  jsonLdNodes(html)
    .nodes.filter(n => typesOf(n).includes("Product"))
    .flatMap(n => [].concat(n.image || []))
    .map(i => (typeof i === "string" ? i : i?.contentUrl || i?.url))
    .filter(i => typeof i === "string");
