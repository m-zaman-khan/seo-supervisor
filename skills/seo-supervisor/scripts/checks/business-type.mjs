// Picks the schema.org type that fits the business from home page keywords and the site's existing business types.
// Keyword evidence, not a model, so every audit gives the same answer. A test checks data/business-types.json against
// data/schema-vocab.json; its fields follow https://developers.google.com/search/docs/appearance/structured-data/
import { readFileSync } from "node:fs";

const read = f => JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));
export const BUSINESS_TYPES = read("../data/business-types.json");
// Null prototype, so a page's "constructor" or "__proto__" type is just an unknown name.
const TYPES = Object.assign(Object.create(null), read("../data/schema-vocab.json").types);
const cache = new Map();
const ancestors = t =>
  cache.get(t) || cache.set(t, new Set([t, ...(TYPES[t] || []).flatMap(p => [...ancestors(p)])])).get(t);
const isA = (t, base) => ancestors(t).has(base);

export const CHECKS = {
  "schema-too-generic": [
    "SCHEMA-02",
    "medium",
    () => "The business schema uses a general type where a specific one fits",
    "The home page says plainly what kind of business this is, but its schema calls it only a `LocalBusiness`, an `Organization` or another broad type. Google asks for the most specific type that fits: it tells search engines what the business does, and some fields exist only on the specific type, such as a restaurant's `menu` and `servesCuisine` or a hotel's `checkinTime`.",
    "Change the business node's `@type` to the type the evidence names, keep its `@id`, and add the type's key fields where the site has the facts. `examples/snippets.md` (Business types) has an example for each kind of business, and `scripts/data/business-types.json` lists the fields, the Google feature each can unlock and the usual mistakes.",
  ],
  "business-type-unclear": [
    "SCHEMA-02",
    "needs-decision",
    () => "The home page points to two kinds of business",
    "The home page's title or main heading matches two kinds of business, and the schema names neither yet. The schema type should say what the business is, and a wrong specific type is worse than a general one, so this needs the owner's answer.",
    'Tell the agent which of the two (the evidence names both) describes the business, and the business node gets that type and its key fields. If it really is both, Google accepts a list, such as `"@type": ["Dentist", "MedicalClinic"]`.',
  ],
};

// "Doctor's Café & Bar" becomes " doctors cafe and bar ", padded so every word sits between two spaces.
const norm = s =>
  ` ${String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
// Phrases that contain a trade's word without being that trade. They match as keywords mapped to null, so the trade
// can't match those words.
const NOT_TRADES = [
  "pub sub",
  "dental insurance",
  "dental plan",
  "screen real estate",
  "last resort",
  "website builder",
  "site builder",
  "page builder",
  "form builder",
  "app builder",
  "online store builder",
  "back to school",
  "old school",
  "school holidays",
  "animal hospital",
  "vet clinic",
  "veterinary clinic",
];
const WORD = new Map([
  ...NOT_TRADES.map(k => [norm(k).trim(), null]),
  ...BUSINESS_TYPES.flatMap(b => b.keywords.map(k => [norm(k).trim(), b])),
]);
// Longest phrase first, so "dental clinic" is the dentist's and not a clinic.
const KW = new RegExp(`(?<= )(${[...WORD.keys()].sort((a, b) => b.length - a.length).join("|")})(?:e?s)?(?= )`, "g");
// A trade straight after "for", or before "software", "marketing" and the like, names a business that serves the trade
// ("software for dental clinics", "dental practice software"), so the phrase counts for nothing.
const SERVES = /^ (?:software|apps?|crm|pos|platform|systems?|marketing|seo|websites?|leads|booking) /;
const hitsIn = s => {
  const t = norm(s);
  return [...t.matchAll(KW)]
    .filter(
      m => WORD.get(m[1]) && !t.slice(0, m.index).endsWith(" for ") && !SERVES.test(t.slice(m.index + m[0].length)),
    )
    .map(m => [WORD.get(m[1]), m[0]]);
};

// pages: [{ url, title, h1, text, types }]. text is the main text without post teasers; types come from JSON-LD,
// Microdata and RDFa. The home page is the one at "/", else the first.
function judge(pages) {
  const home =
    pages.find(p => {
      try {
        return new URL(p.url).pathname === "/";
      } catch {
        return false;
      }
    }) || pages[0];
  // Any Organization type counts, LocalBusiness and its subtypes included.
  const siteTypes = [...new Set(pages.flatMap(p => p.types || []))].filter(
    t => typeof t === "string" && isA(t, "Organization"),
  );
  const by = new Map(),
    at = b => by.get(b) || by.set(b, { b, schema: [], title: [], h1: [], text: new Set() }).get(b);
  if (home) {
    for (const b of BUSINESS_TYPES) {
      const s = siteTypes.filter(t => isA(t, b.types[0]));
      if (s.length) at(b).schema = s;
    }
    for (const [b, w] of hitsIn(home.title)) at(b).title.push(w);
    for (const [b, w] of hitsIn(home.h1)) at(b).h1.push(w);
    for (const [b, w] of hitsIn(home.text)) at(b).text.add(w);
  }
  // Schema the site already has counts most, then the title and the H1, then up to three different words in the text.
  const list = [...by.values()]
    .map(c => ({
      ...c,
      head: !!(c.schema.length || c.title.length || c.h1.length),
      score: (c.schema.length && 6) + (c.title.length && 3) + (c.h1.length && 3) + Math.min(c.text.size, 3),
    }))
    .sort((x, y) => y.score - x.score || BUSINESS_TYPES.indexOf(x.b) - BUSINESS_TYPES.indexOf(y.b));
  const [top, next] = list;
  if (!top) return { home, siteTypes, list, bt: { guess: null, alternatives: [], evidence: [], confidence: "none" } };
  // Strong: the schema says so, or the title or H1 does and nothing else comes close.
  const strong = top.schema.length > 0 || (top.head && !next?.head && (next?.score || 0) * 2 <= top.score);
  const shown = list.slice(0, 3),
    words = (c, k) => [...new Set(c[k])].map(w => `${w} (${c.b.types[0]})`);
  const line = (label, k) => {
    const w = shown.flatMap(c => words(c, k));
    return w.length ? [`${label}: ${w.join(", ")}`] : [];
  };
  const evidence = [
    ...(shown.some(c => c.schema.length) ? [`schema: ${[...new Set(shown.flatMap(c => c.schema))].join(", ")}`] : []),
    ...line(`title “${home.title}”`, "title"),
    ...line(`H1 “${home.h1}”`, "h1"),
    ...line("home page text", "text"),
  ];
  return {
    home,
    siteTypes,
    list,
    bt: {
      guess: top.b.id,
      alternatives: list.slice(1, 3).map(c => c.b.id),
      evidence,
      confidence: strong ? "strong" : "weak",
    },
  };
}

export const detectBusinessType = pages => judge(pages).bt;

// Adds schema-too-generic or business-type-unclear for the home page and returns the guess. Google asks for the most
// specific subtype that fits. https://developers.google.com/search/docs/appearance/structured-data/local-business
export function checkBusinessType(pages, add) {
  const {
    home,
    siteTypes,
    list: [a, b],
    bt,
  } = judge(pages);
  const fits = c => siteTypes.some(t => c.b.types.some(x => isA(t, x)));
  const said = c =>
    [
      ["title", c.title],
      ["H1", c.h1],
      ["home page text", [...c.text]],
    ]
      .filter(([, w]) => w.length)
      .map(([s, w]) => `${s}: ${[...new Set(w)].join(", ")}`)
      .join(", ");
  if (bt.confidence === "strong" && !fits(a)) {
    const broad = siteTypes.filter(t => isA(a.b.types[0], t));
    if (broad.length)
      add("schema-too-generic", home.url, `use ${a.b.types.join(" or ")} instead of ${broad.join(", ")}; ${said(a)}`);
  } else if (bt.confidence === "weak" && a.head && b?.head && !fits(a) && !fits(b)) {
    add(
      "business-type-unclear",
      home.url,
      `${a.b.types[0]} or ${b.b.types[0]}? ${a.b.types[0]}: ${said(a)}; ${b.b.types[0]}: ${said(b)}`,
    );
  }
  return bt;
}
