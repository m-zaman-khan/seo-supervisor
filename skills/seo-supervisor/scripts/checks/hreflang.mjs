// @ts-check
// hreflang and page-language checks.

// ISO 639-1 languages and ISO 3166-1 alpha-2 regions, the formats Google names.
// https://developers.google.com/search/docs/specialty/international/localized-versions
const LANGS = new Set(
  "aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(
    " ",
  ),
);
const REGIONS = new Set(
  "ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw".split(
    " ",
  ),
);

// A language, optional script (zh-Hant) and optional region, or x-default.
export function validCode(code) {
  const c = code.toLowerCase();
  if (c === "x-default") return true;
  const m = c.match(/^([a-z]{2})(?:-([a-z]{4}))?(?:-([a-z]{2}))?$/);
  return !!m && LANGS.has(m[1]) && (!m[3] || REGIONS.has(m[3]));
}

// Google reads hreflang from the HTML, the Link header and the sitemap alike, so using more than one gains nothing. It
// detects a page's language from its visible text, not hreflang or lang, and recommends a URL per language.
// https://developers.google.com/search/docs/specialty/international/localized-versions
// https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites
export const CHECKS = {
  "hreflang-no-return": [
    "META-08",
    "high",
    n => `${n} hreflang link(s) have no return link`,
    "Search engines ignore an hreflang pair unless both pages point at each other.",
    "Generate hreflang for every language version from one shared list, so each page lists every version, itself included.",
  ],
  "hreflang-invalid-code": [
    "META-08",
    "medium",
    n => `${n} hreflang value(s) aren't valid language or region codes`,
    "Codes search engines can't read are ignored. A common mistake is `en-uk`: the United Kingdom's region code is `gb`.",
    "Use an ISO 639-1 language, optionally followed by an ISO 3166-1 alpha-2 region (for example `en-GB`), or `x-default`.",
  ],
  "hreflang-no-self": [
    "META-08",
    "low",
    n => `${n} page(s) with hreflang don't list themselves`,
    "Each page should include itself in its own hreflang set.",
    "Add the page's own URL with its own language code.",
  ],
  "hreflang-no-xdefault": [
    "META-08",
    "low",
    n => `${n} page(s) with hreflang have no x-default`,
    "x-default tells search engines which version to show visitors whose language matches none of the listed ones.",
    "Add an x-default entry, usually the main version or a language picker.",
  ],
  "hreflang-bad-target": [
    "META-08",
    "high",
    n => `${n} hreflang link(s) point at a URL that isn't a working canonical page`,
    "hreflang must point at the canonical, indexable, 200 version of each page, or the pair is ignored.",
    "Point each hreflang at the final canonical URL of that language version.",
  ],
  "hreflang-sources-disagree": [
    "META-08",
    "medium",
    n => `${n} page(s) pair a language and a URL differently in the HTML, the Link header and the sitemap`,
    "Google reads hreflang from all three places, treats them alike and combines them, and says using more than one brings no benefit. It doesn't say which wins when they conflict, so a version can be paired with the wrong URL or language. Two lists usually drift apart after a URL change, when one is updated and the other isn't.",
    "Keep hreflang in one place (HTML tags, the Link header or the sitemap) and remove the others, or build every one from the same list.",
  ],
  "hreflang-missing-version": [
    "META-08",
    "low",
    n => `${n} page(s) leave out a language version their other versions list`,
    "Each version of a page has to list every version, itself included. These pages lack one the pages they link to list, so search engines may not pair it with them and can show visitors the wrong language.",
    "Build each page's hreflang from one shared list of the page's versions, so they all list the same set.",
  ],
  "lang-hreflang-mismatch": [
    "META-08",
    "low",
    n => `${n} page(s) declare a different language in <html lang> than their hreflang`,
    'The page\'s `lang` says one language while hreflang calls it another. Google ignores `lang` and goes by the visible text, but screen readers pick their pronunciation from it (WCAG 3.1.1) and browsers offer translation from it, so one of the two is wrong, often a layout that hard-codes `lang="en"` for every language.',
    "Set `<html lang>` from the same locale as the page's hreflang code, in the shared layout.",
  ],
  "untranslated-copy": [
    "META-08",
    "medium",
    n => `${n} pair(s) of language versions share their main text`,
    "The versions are listed as different languages, but one wasn't translated. Google works out a page's language from its visible text, so an untranslated version counts as the original language and can't rank for the other one, and the two compete as duplicates.",
    "Translate the title and main text of each version, or drop the untranslated page from hreflang (and the language menu) until it's translated.",
  ],
  "lang-invalid": [
    "META-08",
    "low",
    n => `${n} page(s) have an <html lang> that isn't a language code`,
    "`lang` takes a BCP 47 language tag such as `en` or `de-AT`. A value such as `auto`, `english` or `en_US` names no language, so screen readers and browser translation can't use it.",
    "Set `lang` to the page's language code (`en`, `en-US`, `de-AT`; a hyphen, not an underscore) from the site's locale setting.",
  ],
  "translate-widget": [
    "META-08",
    "low",
    () => "The site is translated only by the Google Translate widget",
    "The widget translates the page in the visitor's browser, on the same URL, after they pick a language. Google indexes the text the page shows and recommends a separate URL for each language version, so search engines see only the original language and the translations never appear in search.",
    "For languages that matter, publish translated pages on their own URLs (`/de/`, `de.example.com`) linked with hreflang. Keep the widget only as an extra for the other languages.",
  ],
  "inlanguage-mismatch": [
    "META-08",
    "low",
    n => `${n} page(s) name a different language in schema inLanguage than in <html lang>`,
    "The structured data says the content is in one language and the page's `lang` says another. One of them was copied from another language version or a sitewide default.",
    "Set `inLanguage` from the same locale as `<html lang>` (a BCP 47 code such as `de-DE`).",
  ],
};

const pathKey = u => u.pathname.replace(/\/+$/, "") || "/";
// Links to the page's own or the public origin are ours and compared by path; other hosts can't be verified. A variant
// is the site's host on the other protocol or with or without www: ours, but not where the pages live, so a bad target.
const bareHost = u => u.host.replace(/^www\./i, "");
const entriesOf = (p, origin) =>
  (p.hreflang || []).flatMap(h => {
    try {
      const u = new URL(h.href, p.finalUrl),
        homes = [origin, p.finalUrl].filter(Boolean).map(o => new URL(o)),
        exact = homes.some(o => o.origin === u.origin);
      const variant = !exact && /^https?:$/.test(u.protocol) && homes.some(o => bareHost(o) === bareHost(u)),
        ours = exact || variant;
      return [
        {
          lang: h.lang.toLowerCase(),
          href: u.href,
          raw: h.href,
          ours,
          variant,
          path: pathKey(u),
          where: ours ? pathKey(u) : u.href,
        },
      ];
    } catch {
      return [];
    }
  });

export function checkHreflang(pages, { add, canonicalFor, statusOf, origin }) {
  const byPath = new Map(pages.map(p => [pathKey(new URL(p.finalUrl)), p]));
  for (const p of pages) {
    if (!p.hreflang?.length) continue;
    const u = p.finalUrl,
      self = pathKey(new URL(u)),
      entries = entriesOf(p, origin);
    for (const h of p.hreflang) if (!validCode(h.lang)) add("hreflang-invalid-code", u, h.lang);
    if (!entries.some(e => e.ours && e.path === self)) add("hreflang-no-self", u);
    if (!entries.some(e => e.lang === "x-default")) add("hreflang-no-xdefault", u);
    for (const e of entries) {
      if (e.variant) {
        add(
          "hreflang-bad-target",
          u,
          `${e.lang} → ${e.href} (this site at another address, ${new URL(e.href).origin}; its pages are at ${origin})`,
        );
        continue;
      }
      if (!e.ours || e.path === self) continue;
      const t = byPath.get(e.path);
      if (!t) {
        const s = statusOf(e.href);
        if (s !== undefined && s !== 200) add("hreflang-bad-target", u, `${e.lang} → ${e.href} (status ${s})`);
        continue;
      }
      const c = canonicalFor(t);
      const why =
        t.status !== 200
          ? `status ${t.status}`
          : t.noindex
            ? "noindex"
            : c && pathKey(new URL(c)) !== e.path
              ? `canonical is ${c}`
              : null;
      if (why) {
        add("hreflang-bad-target", u, `${e.lang} → ${e.href} (${why})`);
        continue;
      }
      if (!entriesOf(t, origin).some(b => b.ours && b.path === self))
        add("hreflang-no-return", u, `${e.lang} → ${e.href} doesn't link back`);
    }
  }
}

// hreflang targets on other sites, as target URL -> [{ url, lang }] of the pages listing them. The crawler visits them
// only with --outside and --hreflang-other-sites.
export function otherSiteTargets(pages, origin) {
  const out = new Map();
  for (const p of pages)
    for (const e of entriesOf(p, origin))
      if (!e.ours) (out.get(e.href) || out.set(e.href, []).get(e.href)).push({ url: p.finalUrl, lang: e.lang });
  return out;
}
// Whether hreflang names `back` by origin and path, trailing slashes aside; same maps the public origin onto the
// crawled one. Google ignores a pair without the return link.
export const linksBack = (hreflang, base, back, same = u => u) =>
  hreflang.some(h => {
    try {
      const u = new URL(same(new URL(h.href, base).href)),
        b = new URL(back);
      return u.origin === b.origin && pathKey(u) === pathKey(b);
    } catch {
      return false;
    }
  });

// The Link header form Google documents:
// Link: <url1>; rel="alternate"; hreflang="de", <url2>; rel="alternate"; hreflang="fr"
const LINK = /<([^>]*)>((?:\s*;\s*[\w*.-]+\s*(?:=\s*(?:"[^"]*"|[^\s;,]*))?)*)/g,
  PARAM = /;\s*([\w*.-]+)\s*(?:=\s*(?:"([^"]*)"|([^\s;,]*)))?/g;
export const linkHreflang = header =>
  [...(header || "").matchAll(LINK)].flatMap(([, href, params]) => {
    const p = Object.fromEntries([...params.matchAll(PARAM)].map(m => [m[1].toLowerCase(), m[2] ?? m[3] ?? ""]));
    return p.rel?.toLowerCase().split(/\s+/).includes("alternate") && p.hreflang
      ? [{ lang: p.hreflang, href: href.trim() }]
      : [];
  });

// One page's hreflang merged from { html, header, sitemap }, one entry per language and target, and the first conflict
// between sources. same maps an absolute URL onto the one it's compared as (the public origin onto the crawled one).
const SOURCE = { html: "the HTML", header: "the Link header", sitemap: "the sitemap" };
export function mergeHreflang(sources, base, same = u => u) {
  const at = h => {
    try {
      const u = new URL(same(new URL(h.href, base).href));
      return `${u.origin}${pathKey(u)}${u.search}`;
    } catch {
      return h.href;
    }
  };
  const lists = Object.entries(sources)
    .filter(([, l]) => l?.length)
    .map(
      ([s, l]) =>
        /** @type {[string, Map<string, any>]} */ ([
          s,
          new Map(
            l.map(h => {
              const e = { h, lang: h.lang.toLowerCase(), url: at(h) };
              return [`${e.lang} ${e.url}`, e];
            }),
          ),
        ]),
    );
  const merged = new Map();
  for (const [, l] of lists) for (const [k, e] of l) if (!merged.has(k)) merged.set(k, e.h);
  // Google combines the sources, so an entry missing from one isn't a conflict. A conflict is the same code at another
  // URL, or the same URL under another language (x-default may share a version's URL).
  let disagree = null;
  for (const [i, [a, la]] of lists.entries())
    for (const [b, lb] of lists.slice(i + 1)) {
      const theirs = [...lb].filter(([k]) => !la.has(k)).map(([, o]) => o);
      for (const [k, e] of la) {
        const o =
          !disagree &&
          !lb.has(k) &&
          theirs.find(o => o.lang === e.lang || (o.url === e.url && e.lang !== "x-default" && o.lang !== "x-default"));
        if (o) disagree = `${SOURCE[a]} lists ${e.h.lang} → ${e.h.href}, ${SOURCE[b]} lists ${o.h.lang} → ${o.h.href}`;
      }
    }
  return { hreflang: [...merged.values()], hreflangDisagree: disagree };
}

// The Translate widget (its loader, or the goog-te-* classes it adds, which sites style or hide) and schema inLanguage
// values (text, or a Language's alternateName).
export const languageFeatures = (html, nodes) => ({
  translateWidget: /translate\.google\.[a-z.]+\/translate_a\/element\.js|\bgoog-te-[a-z]/i.test(html),
  inLanguage: [
    ...new Set(
      nodes
        .flatMap(n => [].concat(n.inLanguage || []))
        .map(l => (typeof l === "string" ? l : l?.alternateName))
        .filter(l => typeof l === "string")
        .map(l => l.trim()),
    ),
  ],
});

// A BCP 47 tag as HTML lang takes it: a 2–3 letter language (or x-/i- private and grandfathered tags), then subtags.
const LANG_TAG = /^(?:[a-z]{2,3}|[xi])(?:-[a-z\d]{1,8})*$/i;
const ALIAS = { nb: "no", nn: "no", iw: "he", in: "id", ji: "yi" }; // Norwegian's three codes, and retired ones
const primary = c => {
  const l = c.toLowerCase().split("-")[0];
  return ALIAS[l] || l;
};
const flat = s => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const words = s =>
  flat(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const dice = (a, b) => {
  if (!a || !b) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
};

// pages: the indexable crawled pages, with merged hreflang, lang, title, shingles (5-word sets of the main text),
// hreflangDisagree, translateWidget and inLanguage.
export function checkLanguages(pages, { add, origin }) {
  const byPath = new Map(pages.map(p => [pathKey(new URL(p.finalUrl)), p]));
  const ent = new Map(pages.map(p => [p, entriesOf(p, origin).filter(e => e.lang !== "x-default")]));
  const listedAs = new Map(); // path -> the codes any page lists it under
  for (const es of ent.values())
    for (const e of es) if (e.ours) (listedAs.get(e.path) || listedAs.set(e.path, new Set()).get(e.path)).add(e.lang);
  // Words that name the page: no model numbers (words with digits) and no brand words (in over half the titles), so a
  // product name kept in every language isn't counted.
  const titled = pages.filter(p => p.title),
    inTitles = new Map();
  for (const p of titled) for (const w of new Set(words(p.title))) inTitles.set(w, (inTitles.get(w) || 0) + 1);
  const naming = t => words(t).filter(w => !/\p{N}/u.test(w) && !(inTitles.get(w) > titled.length / 2)).length;
  const pairs = new Set(),
    langs = new Set();
  // Of two versions sharing their text, the original is the x-default one, else the one in the home page's language,
  // else the one closer to the home page, else the first by URL; the other is the copy. Never the order pages finished
  // loading in, which changes from run to run.
  const xDefault = new Set(
    pages.flatMap(p =>
      entriesOf(p, origin)
        .filter(e => e.lang === "x-default" && e.ours)
        .map(e => e.path),
    ),
  );
  const home = byPath.get("/"),
    homeLang = home?.lang && LANG_TAG.test(home.lang) ? primary(home.lang) : null;
  const rank = (q, l) => (xDefault.has(pathKey(new URL(q.finalUrl))) ? 2 : l === homeLang ? 1 : 0);
  for (const p of pages) {
    const u = p.finalUrl,
      self = pathKey(new URL(u)),
      es = ent.get(p);
    if (p.hreflangDisagree) add("hreflang-sources-disagree", u, p.hreflangDisagree);
    const lang = p.lang && LANG_TAG.test(p.lang) ? primary(p.lang) : null;
    if (lang) langs.add(lang);
    if (p.lang && !lang) add("lang-invalid", u, `lang="${p.lang}"`);
    const codes = [...(listedAs.get(self) || [])];
    if (lang && codes.length && !codes.some(c => primary(c) === lang))
      add("lang-hreflang-mismatch", u, `<html lang="${p.lang}">, hreflang lists it as ${codes.join(", ")}`);
    const schema = (p.inLanguage || []).filter(c => LANG_TAG.test(c));
    if (lang && schema.length && !schema.some(c => primary(c) === lang))
      add(
        "inlanguage-mismatch",
        u,
        `<html lang="${p.lang}">, schema inLanguage ${schema.map(c => `"${c}"`).join(", ")}`,
      );
    // Versions the listed pages know that this one lists under neither code nor URL; and versions in different
    // languages sharing a title or main text (en-GB and en-US may share theirs, so only the primary language counts).
    const selfCode = es.find(e => e.ours && e.path === self)?.lang,
      mine = selfCode ? primary(selfCode) : lang,
      missing = new Map();
    for (const e of es) {
      const t = e.ours && e.path !== self && byPath.get(e.path);
      if (!t) continue;
      // A version on the site counts only if crawled and indexable, which is all pages holds. One on another host
      // can't be checked, so it counts.
      for (const f of ent.get(t))
        if (
          (!f.ours || (f.path !== self && byPath.has(f.path))) &&
          !missing.has(f.lang) &&
          !es.some(x => x.lang === f.lang || x.where === f.where)
        )
          missing.set(f.lang, `${f.lang} → ${f.raw} (listed by ${t.finalUrl})`);
      const theirs = primary(e.lang),
        pair = [u, t.finalUrl].sort().join(" ");
      if (!mine || mine === theirs || pairs.has(pair)) continue;
      pairs.add(pair);
      // Conservative: 80% of the main text, or the same title of five naming words or more and half the main text.
      const title = flat(p.title) && flat(p.title) === flat(t.title) && naming(p.title) >= 5,
        same = dice(p.shingles, t.shingles);
      if (same >= 0.8 || (title && same >= 0.5)) {
        const pFirst =
            rank(p, mine) - rank(t, theirs) ||
            (t.depth ?? Infinity) - (p.depth ?? Infinity) ||
            (u < t.finalUrl ? 1 : -1),
          [copy, copyLang, orig, origLang] = pFirst > 0 ? [t, theirs, p, mine] : [p, mine, t, theirs];
        add(
          "untranslated-copy",
          copy.finalUrl,
          `${copy.finalUrl} (${copyLang}) and ${orig.finalUrl} (${origLang}) ${title ? `have the same title “${copy.title}” and ` : ""}share ${Math.round(same * 100)}% of their main text`,
        );
      }
    }
    if (missing.size) add("hreflang-missing-version", u, [...missing.values()].join("; "));
  }
  // The widget as the site's only translation: every page is in one language, and none lists versions in two.
  const widget = pages.filter(p => p.translateWidget);
  if (widget.length && langs.size <= 1 && ![...ent.values()].some(es => new Set(es.map(e => primary(e.lang))).size > 1))
    add(
      "translate-widget",
      widget[0].finalUrl,
      `on ${widget.length} page(s); every page is in one language and none lists language versions with hreflang`,
    );
}
