// @ts-check
// The crawler's HTML helpers, string in, value out: entities, tag attributes, visible text and words, JSON-LD nodes.
// Regex HTML parsing is enough for audit evidence. Swap in a real parser if a site breaks it.

// Named references: the Latin-1 set &nbsp; to &yuml; (U+00A0 to U+00FF in order) and the other HTML 4 punctuation and
// symbols titles use. Names are case-sensitive (&Eacute; is É), with a lowercase fallback for &AMP; and the like.
// &nbsp; reads as a plain space; a numeric reference past U+10FFFF stays as written.
// https://html.spec.whatwg.org/multipage/named-characters.html
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decode = s =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : (ENT[e.toLowerCase()] ?? m),
  );
export function attrs(tag) {
  const out = {};
  const inner = tag.replace(/^<[\w-]+/, "").replace(/\/?>$/, "");
  const re = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}
export const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(m => attrs(m[0]));
export const stripNonContent = h =>
  h
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
export const textOf = h =>
  decode(h.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
// Scripts written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer, Burmese): Intl.Segmenter splits
// them into words, and norm() sets them apart from Latin words next to them ("のBoilerの" holds the word "boiler").
const NOSPACE_CHARS = String.raw`\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Thai}\p{scx=Laoo}\p{scx=Khmr}\p{scx=Mymr}`;
export const NOSPACE = new RegExp(`[${NOSPACE_CHARS}]`, "u"),
  NOSPACE_RUN = new RegExp(`[${NOSPACE_CHARS}]+`, "gu");
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });
export const wordsOf = t =>
  NOSPACE.test(t)
    ? [...SEGMENTER.segment(t)].filter(s => s.isWordLike).map(s => s.segment)
    : t.split(" ").filter(w => /[\p{L}\p{N}]/u.test(w));
export const norm = s =>
  s
    .toLowerCase()
    .replace(NOSPACE_RUN, " $& ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
// Words written in capitals (FAQ, SEO, HVAC; a plural's s dropped), lowercased: the acronyms a text shows.
export const capsOf = s =>
  new Set(
    s
      .split(/[^\p{L}\p{N}]+/u)
      .map(w => /^(\p{Lu}{2,})s?$/u.exec(w)?.[1].toLowerCase())
      .filter(Boolean),
  );
// Frameworks whose router loads the next page itself, without a new document, so speculation rules add little:
// Next.js, Nuxt, Gatsby, SvelteKit, Remix, Astro prefetch, Turbo (Rails), React Router 7, Angular, Docusaurus, Inertia.
export const CLIENT_ROUTER =
  /\/_next\/static\/|\/_nuxt\/|id=["']?___gatsby\b|data-sveltekit-|__remixContext|data-astro-prefetch|data-turbo-track|@hotwired\/turbo|__reactRouterContext|\sng-version=|id=["']?__docusaurus\b|\sdata-page=["'](?:\{|app["'])/;
export const FILE_EXT =
  /\.(pdf|png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|zip|gz|mp4|webm|mp3|woff2?|ttf|otf|csv|xlsx?|docx?|pptx?)$/i;

export function jsonLdNodes(html) {
  const nodes = [],
    errors = [];
  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch (e) {
      errors.push(String(e.message).slice(0, 120));
      continue;
    }
    const walk = d => {
      if (Array.isArray(d)) d.forEach(walk);
      else if (d && typeof d === "object") {
        if (Array.isArray(d["@graph"])) d["@graph"].forEach(walk);
        if (d["@type"]) nodes.push(d);
      }
    };
    walk(data);
  }
  return { nodes, errors };
}
export const typesOf = n => [].concat(n["@type"] || []);
export function deepHas(obj, pred, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 12) return false;
  if (pred(obj)) return true;
  return Object.values(obj).some(v => deepHas(v, pred, depth + 1));
}
export const ORG_RE =
  /(Organization|Corporation|Business|Store|Service|Contractor|Agency|Electrician|Plumber|Locksmith|Dentist|Physician|Attorney|Restaurant|Hotel|AutoRepair|School|NGO)$/;
export function ctx(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  const s = Math.max(0, m.index - 60),
    e = Math.min(text.length, m.index + m[0].length + 60);
  return { match: m[0], snippet: (s ? "…" : "") + text.slice(s, e) + (e < text.length ? "…" : "") };
}
