// @ts-check
// E-E-A-T signals for the report's trust view, read from the crawled HTML. They're never findings or scored: Google
// says E-E-A-T isn't a ranking factor, so the view is a local check, not a Google score.
// https://developers.google.com/search/docs/fundamentals/creating-helpful-content
// HTML is read with regexes; page names and paths are matched in English and a few European languages.
import { attrs, jsonLdNodes, textOf } from "../lib/html.mjs";

// a is the attribute text after the tag name.
const attr = (a, name) => attrs("<a " + a + ">")[name] ?? null;
const words = s =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const bare = h => (h || "").toLowerCase().replace(/^www\./, "");
const hostOf = u => {
  try {
    return bare(new URL(u).hostname);
  } catch {
    return "";
  }
};
const pathOf = u => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const uniq = (list, n = 3) => [...new Set(list.filter(Boolean))].slice(0, n);
const typesOf = n => [].concat(n["@type"] || []).filter(t => typeof t === "string");
const deepHas = (o, pred, depth = 0) =>
  !!o && typeof o === "object" && depth < 12 && (pred(o) || Object.values(o).some(v => deepHas(v, pred, depth + 1)));

// Google's Article markup takes Article, NewsArticle and BlogPosting; their subtypes end the same way.
// https://developers.google.com/search/docs/appearance/structured-data/article
const ARTICLE = /(Article|BlogPosting)$/;
const SHOP = /^(Product|ProductGroup|Offer|AggregateOffer)$/;
// The crawler's ORG_RE without Service, which isn't an organization. A node with a logo counts too, so a LocalBusiness
// subtype outside the list (HairSalon, Bakery) is still read.
const ORG =
  /(Organization|Corporation|Business|Store|Contractor|Agency|Electrician|Plumber|Locksmith|Dentist|Physician|Attorney|Restaurant|Hotel|AutoRepair|School|NGO)$/;
const NOT_ORG = /^(Product|ProductGroup|Service|Brand|Person|WebSite|WebPage|Offer|ImageObject)$/;

// Path segments (file extension dropped) and link texts that name each kind of page.
const ABOUT_SEG =
  /^(about|about-us|about-me|who-we-are|our-story|our-team|team|meet-the-team|company|ueber-uns|uber-uns|a-propos|qui-sommes-nous|sobre|sobre-nosotros|quienes-somos|chi-siamo|over-ons|om-oss)$/;
const ABOUT_TXT =
  /^(about|about us|about me|who we are|our story|our team|meet the team|the team|über uns|a propos|à propos|qui sommes-nous|sobre nosotros|quiénes somos|chi siamo|over ons|om oss)$/;
const CONTACT_SEG =
  /^(contact|contact-us|contacts|get-in-touch|kontakt|contacto|contato|contatti|nous-contacter|contactez-nous)$/;
const CONTACT_TXT =
  /^(contact|contact us|get in touch|kontakt|contacto|contáctenos|contatti|nous contacter|contactez-nous)$/;
const POLICY = {
  privacy: [
    /privacy|datenschutz|privacidad|privacidade|confidentialite|riservatezza/,
    /privacy|datenschutz|privacidad|confidentialité/,
  ],
  terms: [
    /terms|conditions|condiciones|nutzungsbedingungen|terminos|^(tos|agb|cgv|cgu)$/,
    /\bterms\b|conditions|\bagb\b|términos|condiciones|\bcgv\b|\bcgu\b/,
  ],
  returns: [
    /^([\w-]+-)?(returns?|refunds?|retours?|widerruf[\w-]*|devoluciones)(-[\w-]+)?$/,
    /\b(returns|refunds|refund policy|return policy|retours|widerruf\w*|devoluciones)\b/,
  ],
};
const PROOF_SEG =
  /^(testimonials?|reviews|case-stud(y|ies)|customer-stor(y|ies)|success-stor(y|ies)|customers|clients)$/;
const PROOF_TXT =
  /\b(testimonials?|reviews|customer reviews?|case stud(y|ies)|customer stor(y|ies)|success stor(y|ies)|what (our )?(clients|customers) (say|think))\b/;
const REVIEW_WIDGET =
  /<(?:script|iframe)\b[^>]*\ssrc\s*=\s*["']?[^"'\s>]*(trustpilot\.com|yotpo\.com|judge\.me|reviews\.io|feefo\.com|okendo\.io|stamped\.io|bazaarvoice\.com)/i;
const AUTHOR_PATH = /(^|\/)(author|authors|team|people|staff|contributors?|writers?)\/[^/]+/;
const MONTH =
  "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec";
const DATE_TXT = new RegExp(
  `\\b(\\d{1,2}(st|nd|rd|th)?\\s+(of\\s+)?(${MONTH})\\.?,?\\s+\\d{4}|(${MONTH})\\.?\\s+\\d{1,2}(st|nd|rd|th)?,?\\s+\\d{4})\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`,
);
// Links that share or follow rather than cite, and images that aren't the site's own.
const SOCIAL =
  /(^|\.)(facebook\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|pinterest\.[a-z.]+|tiktok\.com|whatsapp\.com|wa\.me|t\.me|threads\.net|bsky\.app|reddit\.com|youtube\.com|youtu\.be)$/;
// Only stock photos hot-linked from these hosts are spotted; downloaded and self-hosted ones can't be.
const STOCK =
  /(^|\.)(unsplash\.com|pexels\.com|pixabay\.com|istockphoto\.com|shutterstock\.com|gettyimages\.[a-z.]+|stock\.adobe\.com|ftcdn\.net|depositphotos\.com|dreamstime\.com|123rf\.com|placehold\.co|placeholder\.com|picsum\.photos|gravatar\.com)$/i;
// content-scan.mjs's unsourced-stat pattern, read on the page's main text.
const STAT =
  /\b\d{1,3}(?:\.\d+)?\s?%\s+of\b|\b(?:studies|research|surveys?)\s+(?:show|shows|suggests?|proves?|found|finds|has shown|have shown)\b/i;
const CITED = /https?:\/\/|\[\d+\]|\bsource:|\baccording to\b/i;

// One page's evidence for each signal. The crawler passes what it already parsed: the JSON-LD nodes, the HTML from
// <body> on, and resolve(href), which returns a URL against base, or null.
export function trustFeatures(html, url, base = url) {
  const nodes = jsonLdNodes(html).nodes,
    types = nodes.flatMap(typesOf);
  const body = (i => (i >= 0 ? html.slice(i) : html))(html.search(/<body\b/i)).replace(
    /<(script|style|template)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi,
    " ",
  );
  const main =
    body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    body.replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
  // Each href is resolved once, however many kinds of page ask about it.
  const read = new Map(),
    at = h => {
      let r = read.get(h);
      if (!r) {
        let u = null;
        try {
          u = new URL(h, base);
        } catch {}
        if (u && !/^https?:$/.test(u.protocol)) u = null;
        read.set(
          h,
          (r = {
            u,
            segs: (u?.pathname.toLowerCase() || "")
              .split("/")
              .filter(Boolean)
              .map(s => s.replace(/\.(html?|php|aspx?)$/, "")),
          }),
        );
      }
      return r;
    };
  const abs = h => at(h).u,
    segsOf = h => at(h).segs,
    own = hostOf(url);
  const linksIn = h =>
    [...h.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({
      a: m[1],
      href: attr(m[1], "href") || "",
      text: words(textOf(m[2])),
    }));
  const links = linksIn(body),
    self = segsOf(url),
    selfPath = pathOf(url);
  // Links anywhere on the page (menu, body or footer) to a page of this kind, plus the page itself when it is one.
  const to = (seg, txt) =>
    uniq([
      ...(self.some(s => seg.test(s)) ? [selfPath] : []),
      ...links.filter(l => abs(l.href) && (segsOf(l.href).some(s => seg.test(s)) || txt.test(l.text))).map(l => l.href),
    ]);

  const article = types.some(t => ARTICLE.test(t)),
    shop = types.some(t => SHOP.test(t));
  const byId = id => nodes.find(n => n["@id"] === id);
  const authors = nodes
    .filter(n => typesOf(n).some(t => ARTICLE.test(t)))
    .flatMap(n => [].concat(n.author || []))
    .map(a =>
      typeof a === "string"
        ? { name: a }
        : a && typeof a === "object"
          ? { ...(a["@id"] && byId(a["@id"])), ...a }
          : null,
    )
    .filter(Boolean);
  // Bylines in the markup: rel="author", and class or itemprop "author" or "byline" (not a comment's author). A product
  // page's itemprop="author" is usually a customer's review, so it isn't a byline there.
  const marked =
    shop && !article
      ? []
      : [
          ...body.matchAll(
            /<([a-z][\w-]*)\b([^>]*\b(?:class|itemprop|rel)\s*=\s*["']?[^"'>]*\b(?:authors?|byline)\b[^>]*)>([\s\S]*?)<\/\1>/gi,
          ),
        ].filter(m => !/comment/i.test(m[2]));
  // A byline's first link is the author's; later ones are usually its category or date archive.
  const authorLink = h =>
    linksIn(h)
      .map(l => l.href)
      .find(h => abs(h));
  const outLinks = uniq(
    linksIn(main)
      .filter(l => !/\bsponsored\b/i.test(attr(l.a, "rel") || ""))
      .map(l => abs(l.href))
      .filter(u => u && bare(u.hostname) !== own && !SOCIAL.test(bare(u.hostname)))
      .map(u => bare(u.hostname)),
    10,
  );
  const mainText = textOf(main),
    stat = mainText.match(STAT);
  // Any Organization subtype counts, a HairSalon or Bakery too.
  const org = nodes.filter(n => typesOf(n).some(t => ORG.test(t) || (n.logo && !NOT_ORG.test(t))));
  const forms = [...body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  return {
    about: [...to(ABOUT_SEG, ABOUT_TXT), ...(types.includes("AboutPage") ? [selfPath] : [])].slice(0, 3),
    contact: uniq([
      ...to(CONTACT_SEG, CONTACT_TXT),
      ...(types.includes("ContactPage") ? [selfPath] : []),
      links.some(l => /^mailto:/i.test(l.href) || /\/cdn-cgi\/l\/email-protection/i.test(l.href)) && "an email link",
      links.some(l => /^tel:/i.test(l.href)) && "a phone link",
      /[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}\b/i.test(textOf(body)) && "an email address",
    ]),
    authorByline: uniq([
      ...authors.map(a => (typeof a.name === "string" && a.name.trim()) || "author in the Article schema"),
      ...marked.map(m => textOf(m[3]).slice(0, 60)),
    ]),
    authorPage: uniq([
      ...authors.map(a => typeof a.url === "string" && a.url),
      ...nodes.filter(n => typesOf(n).includes("Person")).map(n => typeof n.url === "string" && n.url),
      ...[...html.matchAll(/<(?:a|link)\b([^>]*\brel\s*=\s*["']?[^"'>]*\bauthor\b[^>]*)>/gi)]
        .map(m => attr(m[1], "href"))
        .filter(h => h && abs(h) && !/\.txt$/i.test(h)),
      ...marked.map(m => authorLink(m[3])),
      (types.includes("ProfilePage") || AUTHOR_PATH.test(selfPath)) && selfPath,
    ]),
    dateShown: uniq([
      ...nodes.flatMap(n => [n.datePublished, n.dateModified]).filter(d => typeof d === "string"),
      ...[...body.matchAll(/<time\b([^>]*)>([\s\S]*?)<\/time>/gi)].map(m => attr(m[1], "datetime") || textOf(m[2])),
      ...[...body.matchAll(/<[a-z]+\b([^>]*\bitemprop\s*=\s*["']?(?:datePublished|dateModified)\b[^>]*)>/gi)].map(
        m => attr(m[1], "content") || attr(m[1], "datetime"),
      ),
      mainText.match(DATE_TXT)?.[0],
    ]),
    outLinks,
    proof: uniq([
      nodes.some(n =>
        deepHas(
          n,
          o =>
            "aggregateRating" in o || "review" in o || typesOf(o).some(t => t === "AggregateRating" || t === "Review"),
        ),
      ) && "reviews in the schema",
      ...[...body.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
        .map(m => textOf(m[1]))
        .filter(t => PROOF_TXT.test(words(t))),
      ...to(PROOF_SEG, PROOF_TXT),
      REVIEW_WIDGET.test(html) && "a reviews widget",
    ]),
    policies: Object.fromEntries(Object.entries(POLICY).map(([k, [seg, txt]]) => [k, to(seg, txt)[0] || null])),
    ownMedia: uniq(
      [...main.matchAll(/<(?:img|video|source)\b([^>]*)>/gi)]
        .map(m => ({
          src: attr(m[1], "src") || attr(m[1], "data-src") || (attr(m[1], "srcset") || "").trim().split(/[\s,]+/)[0],
          w: attr(m[1], "width"),
          h: attr(m[1], "height"),
        }))
        .filter(
          i =>
            i.src &&
            !/^data:/i.test(i.src) &&
            i.w !== "1" &&
            i.h !== "1" &&
            abs(i.src) &&
            !STOCK.test(abs(i.src).hostname),
        )
        .map(i => i.src),
    ),
    articleLike:
      article ||
      nodes.some(n => typeof n.datePublished === "string") ||
      self.some(s => /^(blog|news|articles)$/.test(s)),
    shopLike: shop,
    // A form with a field for the visitor's own data: not a search box, a button, a hidden field or a choice.
    collectsData: forms.some(
      ([, a, inner]) =>
        !/\brole\s*=\s*["']?search|\baction\s*=\s*["']?[^"'\s>]*search/i.test(a) &&
        [...inner.matchAll(/<(input|textarea)\b([^>]*)>/gi)].some(
          ([, tag, at]) =>
            (tag.toLowerCase() === "textarea" ||
              !/^(hidden|submit|button|reset|image|search|checkbox|radio|range|color|number)$/i.test(
                attr(at, "type") || "text",
              )) &&
            !/^(q|s|query|search|search_query|keywords?|term)$/i.test(attr(at, "name") || ""),
        ),
    ),
    // Google recommends name, logo and sameAs on the home page or the page about the organization.
    // https://developers.google.com/search/docs/appearance/structured-data/organization
    org: org.length
      ? {
          name: org.map(n => n.name).find(v => typeof v === "string" && v.trim()) || null,
          logo: org.map(n => n.logo).find(Boolean) || null,
          sameAs: [...new Set(org.flatMap(n => [].concat(n.sameAs || [])).filter(s => typeof s === "string"))],
        }
      : null,
    unsourcedStat: stat && !outLinks.length && !CITED.test(mainText) ? stat[0] : null,
  };
}

// [id, label, rule, what to add]. Labels read in a list: "missing: author pages, sources cited".
const SIGNALS = [
  [
    "about",
    "About page",
    "TRUST-04",
    "Add an About page that says who runs the site and why visitors can trust it, and link it from the main menu or the footer.",
  ],
  [
    "contact",
    "Contact details",
    "TRUST-04",
    "Add a Contact page, or show an email address or phone number, and link it from every page.",
  ],
  [
    "org-schema",
    "Organization schema",
    "SCHEMA-02",
    "Add Organization schema (or your business type) to the home page with the business's `name`, `logo` and `sameAs` links to its official profiles.",
  ],
  [
    "author-byline",
    "Author names",
    "CONTENT-07",
    "Name the author on each article, on the page and as `author` in its Article schema.",
  ],
  [
    "author-page",
    "Author pages",
    "CONTENT-07",
    "Link each author's name to a page about them (role, experience, credentials), and give the author a `url` in the schema.",
  ],
  [
    "dates",
    "Dates on articles",
    "CONTENT-07",
    "Show when each article was published or last reviewed, and add `datePublished` and `dateModified` to its schema. Change them only with real edits (CONTENT-12).",
  ],
  ["sources", "Sources cited", "CONTENT-10", "Link the source next to each fact and figure in your content."],
  [
    "customer-proof",
    "Customer reviews",
    "TRUST-05",
    "Show real reviews, testimonials or case studies from customers. Only real ones count: never invent or edit them.",
  ],
  ["policies", "Policies", "TRUST-03", ""],
  [
    "https",
    "HTTPS and security headers",
    "TRUST-01",
    "Serve every page over HTTPS and fix the open security findings (TRUST-01, TRUST-07).",
  ],
  [
    "own-media",
    "Own images",
    null,
    "Use your own photos, screenshots or diagrams on content pages, rather than none or stock photos.",
  ],
];
const POLICY_NAME = { privacy: "a privacy policy", terms: "terms of service", returns: "a returns policy" };
const list = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] || "");

// site: { origin, https (null when unknown), localHeaders (a local crawl's missing security headers), orgSchema,
// unsourcedStats (null when unknown) }. Author signals apply only with articles, terms only where the site sells or
// collects data, returns only on shops.
export function trustSignals(pages, site) {
  const own = hostOf(site.origin);
  const T = pages.filter(p => p?.trust).map(p => ({ ...p.trust, at: pathOf(p.finalUrl || p.url || "") }));
  const first = get => {
    for (const t of T) {
      const v = [].concat(get(t) || []).find(Boolean);
      if (v) return `${v} on ${t.at}`;
    }
    return null;
  };
  const articles = T.some(t => t.articleLike),
    shop = T.some(t => t.shopLike),
    collects = T.some(t => t.collectsData);
  const org = site.orgSchema,
    orgHas = org ? ["name", "logo", "sameAs"].filter(k => [].concat(org[k] || []).length) : [];
  const orgLacks = ["name", "logo", "sameAs"].filter(k => !orgHas.includes(k));
  const need = ["privacy", ...(shop || collects ? ["terms"] : []), ...(shop ? ["returns"] : [])];
  const policy = Object.fromEntries(need.map(k => [k, first(t => t.policies?.[k])])),
    lacking = need.filter(k => !policy[k]);
  const outside = first(t => (t.outLinks || []).filter(h => h !== own && !h.endsWith("." + own)));
  const stat = site.unsourcedStats ? first(t => t.unsourcedStat && `“${t.unsourcedStat}” with no source`) : null;
  const sig = {
    about: { found: first(t => t.about) },
    contact: { found: first(t => t.contact) },
    "org-schema": org
      ? {
          found: !orgLacks.length && `${list(orgHas)} in the Organization schema`,
          evidence: `the Organization schema has no ${list(orgLacks)}`,
          add: !orgLacks.length
            ? null
            : `Add ${list(orgLacks.map(k => `\`${k}\``))} to the Organization schema on the home page.`,
        }
      : { evidence: "no Organization schema" },
    "author-byline": { applies: articles, found: first(t => t.authorByline) },
    "author-page": { applies: articles, found: first(t => t.authorPage) },
    dates: { applies: articles, found: first(t => t.dateShown) },
    sources: { found: !stat && outside && `links to ${outside}`, evidence: stat },
    "customer-proof": { found: first(t => t.proof) },
    policies: {
      found: !lacking.length && need.map(k => policy[k]).join(" · "),
      evidence: lacking.length ? `no link to ${list(lacking.map(k => POLICY_NAME[k]))}` : null,
      add: `Add ${list(lacking.length ? lacking.map(k => POLICY_NAME[k]) : need.map(k => POLICY_NAME[k]))} and link ${lacking.length === 1 || need.length === 1 ? "it" : "them"} from the footer.`,
    },
    https:
      site.https == null
        ? { applies: false, evidence: "can't be told from a local crawl: pass --site-origin" }
        : {
            found: site.https && `${site.origin}, with no open security findings`,
            evidence: /^https:/.test(site.origin)
              ? "HTTPS, with open security findings"
              : "the site isn't served over HTTPS",
          },
    "own-media": { found: first(t => t.ownMedia) },
  };
  return SIGNALS.map(([id, label, rule, add]) => {
    const s = sig[id];
    return {
      id,
      label,
      rule,
      applies: s.applies ?? true,
      found: !!s.found,
      evidence: s.found || s.evidence || null,
      add: s.add || add,
    };
  });
}
