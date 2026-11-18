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
};

const pathKey = u => u.pathname.replace(/\/+$/, "") || "/";

export function checkHreflang(pages, { add, canonicalFor, statusOf, origin }) {
  const byPath = new Map(pages.map(p => [pathKey(new URL(p.finalUrl)), p]));
  // Links to the page's own or the public origin are ours and compared by path; other hosts can't be verified.
  const entriesOf = p =>
    (p.hreflang || []).flatMap(h => {
      try {
        const u = new URL(h.href, p.finalUrl);
        return [
          {
            lang: h.lang.toLowerCase(),
            href: u.href,
            ours: u.origin === origin || u.origin === new URL(p.finalUrl).origin,
            path: pathKey(u),
          },
        ];
      } catch {
        return [];
      }
    });
  for (const p of pages) {
    if (!p.hreflang?.length) continue;
    const u = p.finalUrl,
      self = pathKey(new URL(u)),
      entries = entriesOf(p);
    for (const h of p.hreflang) if (!validCode(h.lang)) add("hreflang-invalid-code", u, h.lang);
    if (!entries.some(e => e.ours && e.path === self)) add("hreflang-no-self", u);
    if (!entries.some(e => e.lang === "x-default")) add("hreflang-no-xdefault", u);
    for (const e of entries) {
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
      if (!entriesOf(t).some(b => b.ours && b.path === self))
        add("hreflang-no-return", u, `${e.lang} → ${e.href} doesn't link back`);
    }
  }
}
