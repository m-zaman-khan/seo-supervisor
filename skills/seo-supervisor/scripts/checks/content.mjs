// Content checks shared by the crawler and content-scan.mjs. Thresholds are local unless a source is named.

const norm = s =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const SENT = new Intl.Segmenter("en", { granularity: "sentence" });
const sentences = t => [...SENT.segment(String(t ?? ""))].map(s => s.segment.trim()).filter(Boolean);
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The crawler's findings; content-scan.mjs defines its own.
export const CHECKS = {
  "desc-mismatch": [
    "META-02",
    "low",
    n => `${n} description(s) barely match their page`,
    "Fewer than a quarter of the description's main words are on the page. Google uses a description only when it may describe the page better than the page's own text, so this one is likely replaced in results, and visitors who click expect something else. It's usually a copied template or a description left over from an older page.",
    "Rewrite the description from what the page actually says and offers.",
  ],
  "desc-brand-tail": [
    "META-02",
    "low",
    n => `${n} description(s) end with the same brand as their title`,
    "The title already ends with the brand, and results show the title right above the description, so the brand at the end of the description spends space saying it again.",
    "End the description with what the visitor gets, and leave the brand to the title.",
  ],
  "templated-desc": [
    "META-02",
    "medium",
    n => `${n} description(s) end in a stock call to action or an ending other pages share`,
    "Descriptions built from one template (a closing “Learn more”, or the same last sentence on many pages) all read alike in results and give searchers no reason to pick this page.",
    "Write each description from what the page offers, in about 120–160 characters; leave calls to action to the page itself.",
  ],
  "stale-guide": [
    "CONTENT-07",
    "low",
    n => `${n} guide(s) were last dated over a year ago`,
    "CONTENT-07 asks for guides to be reviewed every 6 to 12 months, and this guide's newest date (schema dateModified or datePublished, a <time> tag, or a visible “updated” or “published” date) is older than that. Readers take an old date as a sign the advice may be out of date. The 12-month line is our own, not Google's.",
    "Review the guide. If it changed, update it and its date; if it's still right, add a “last reviewed” date. Never move a date without a real review (CONTENT-12).",
  ],
};

// ---------- titles ----------
// Results cut titles at a pixel width. CJK characters are about two Latin letters wide and combining marks take no
// room. A rough count, not Google's.
const WIDE = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Hang}　-〿！-｠￠-￦]/u;
export const titleWidth = t => [...String(t)].reduce((n, c) => n + (/\p{M}/u.test(c) ? 0 : WIDE.test(c) ? 2 : 1), 0);
export const widthText = t => {
  const n = [...t].length,
    w = titleWidth(t);
  return w === n ? `${n} chars` : `${n} characters, about as wide as ${w} Latin ones`;
};

// ---------- obsolete tags ----------
// Obsolete elements beyond the six the crawler already finds (frameset, frame, marquee, blink, font, center).
// https://html.spec.whatwg.org/multipage/obsolete.html
const OBSOLETE_MORE = /<(acronym|applet|basefont|bgsound|big|dir|isindex|nobr|spacer|strike|tt)(?=[\s>\/])/gi;
export const obsoleteMore = html => [
  ...new Set(
    [...html.replace(/<(script|style|template)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, " ").matchAll(OBSOLETE_MORE)].map(
      m => m[1].toLowerCase(),
    ),
  ),
];

// ---------- descriptions ----------
const SEP = String.raw`(?:[|·•»–—-]|::)`;
// Returns the title's brand tail ("… | Brand") when the description also ends with it after a separator.
export function brandTail(title, desc) {
  const parts = String(title).split(new RegExp(`\\s+${SEP}\\s+`));
  const tail = parts.length > 1 ? parts.at(-1).trim() : "";
  if (tail.length < 2 || tail.length > 40) return null;
  return new RegExp(`(?:^|\\s)${SEP}\\s*${escRe(tail)}[\\s.!]*$`, "i").test(String(desc).trim()) ? tail : null;
}

const CTA =
  /(?:learn more|click here|contact us today|find out more|read more|discover more|find out how|see more|call (?:us )?(?:today|now)|contact us now|get in touch today|get started today|shop now|book now|order now)[.!…\s]*$/i;
// items: [{ url, desc, title? }]. Duplicate descriptions are left to desc-dup, and fewer than 3 hits isn't a template.
export function templatedDescs(items, { titleRepeat = false } = {}) {
  const uses = new Map();
  for (const x of items) {
    const k = String(x.desc ?? "").trim();
    if (k) uses.set(k, (uses.get(k) || 0) + 1);
  }
  const own = items
    .filter(x => uses.get(String(x.desc ?? "").trim()) === 1)
    .map(x => {
      const s = sentences(x.desc);
      return { ...x, d: String(x.desc).trim(), end: s.length > 1 ? s.at(-1) : null };
    });
  const endings = new Map();
  for (const x of own) {
    const k = x.end && norm(x.end);
    if (k && k.split(" ").length >= 3) endings.set(k, (endings.get(k) || 0) + 1);
  }
  const hits = [];
  for (const x of own) {
    const cta = x.d.match(CTA),
      shared = x.end ? endings.get(norm(x.end)) : 0,
      t = String(x.title ?? "").trim();
    if (cta) hits.push([x.url, `ends with “${cta[0].trim()}”`]);
    else if (shared >= 3) hits.push([x.url, `ends with “${x.end}”, like ${shared - 1} other description(s)`]);
    else if (
      titleRepeat &&
      t.length >= 10 &&
      x.d.toLowerCase().startsWith(t.toLowerCase()) &&
      x.d
        .slice(t.length)
        .split(/\s+/)
        .filter(w => /[\p{L}\p{N}]/u.test(w)).length < 5
    )
      hits.push([x.url, `repeats the title “${t}”`]);
  }
  return hits.length >= 3 ? hits : [];
}

// A URL's first folder ("/locations/" for /locations/leeds/); a top-level page is in none.
export const sectionOf = u => {
  try {
    const p = new URL(u, "http://x").pathname.split("/").filter(Boolean);
    return p.length > 1 ? `/${p[0]}/` : "";
  } catch {
    return "";
  }
};
// items: [{ url, section }]. A cluster is a section where 3 or more pages and at least half of its pages are templated.
// Verdict: cluster when clusters hold 80% of the templated pages, site-wide when half the site is templated, else scattered.
export function templatedShare(items, hitUrls) {
  const hit = new Set(hitUrls),
    per = new Map();
  for (const x of items) {
    const s = per.get(x.section) || per.set(x.section, { section: x.section, pages: 0, templated: 0 }).get(x.section);
    s.pages++;
    if (hit.has(x.url)) s.templated++;
  }
  const templated = items.filter(x => hit.has(x.url)).length;
  const clusters = [...per.values()]
    .filter(s => s.section && s.templated >= 3 && s.templated >= s.pages / 2)
    .sort((a, b) => b.templated - a.templated);
  const inClusters = clusters.reduce((n, s) => n + s.templated, 0),
    share = items.length ? templated / items.length : 0;
  const verdict = !templated
    ? "none"
    : inClusters >= 0.8 * templated
      ? "cluster"
      : share >= 0.5
        ? "site-wide"
        : "scattered";
  return {
    pages: items.length,
    templated,
    share: Math.round(share * 100) / 100,
    clusters,
    outsideClusters: templated - inClusters,
    verdict,
  };
}

// ---------- keyword use ----------
// For English pages. The phrase is the 2- or 3-word run from the title's main part (most words of 4+ letters) that the
// text uses most. The 5% and 3% lines are local, from CONTENT-03's "no density targets above about 2–3%".
const EDGE = new Set(
  "a an and are as at be by for from in into is it of on or our the their to vs with we you your my".split(" "),
);
export function keywordUse({ title, headings = [], description = "", text }) {
  const words = norm(text).split(" ").filter(Boolean);
  if (words.length < 150) return null;
  const main = seg => seg.filter(w => w.length >= 4 && !EDGE.has(w)).length;
  const seg = String(title ?? "")
    .split(new RegExp(`\\s+${SEP}\\s+|:\\s+`))
    .map(s => norm(s).split(" ").filter(Boolean))
    .reduce((a, b) => (main(b) > main(a) ? b : a));
  const cands = [];
  for (const n of [3, 2])
    for (let i = 0; i + n <= seg.length; i++) {
      const w = seg.slice(i, i + n);
      if (!EDGE.has(w[0]) && !EDGE.has(w.at(-1)) && w.some(x => x.length >= 4)) cands.push(w.join(" "));
    }
  if (!cands.length) return null;
  const padded = ` ${words.join(" ")} `,
    count = p => padded.match(new RegExp(`(?<= )${p}(?= )`, "g"))?.length || 0;
  const phrase = cands.reduce((a, b) => (count(b) > count(a) ? b : a));
  const has = s => ` ${norm(s)} `.includes(` ${phrase} `),
    h1 = headings.find(h => h.level === 1)?.text || "";
  const subs = headings.filter(h => h.level > 1).map(h => h.text),
    inSubs = subs.filter(has).length;
  const first = ` ${words.slice(0, 100).join(" ")} `.includes(` ${phrase} `);
  const density = Math.round((1000 * count(phrase) * phrase.split(" ").length) / words.length) / 10;
  const spots = [
    has(title) && "title",
    has(h1) && "H1",
    first && "first paragraph",
    headings.some(h => h.level === 2 && has(h.text)) && "H2",
    has(description) && "description",
  ].filter(Boolean);
  const verdict =
    density > 5 || (inSubs >= 3 && inSubs > subs.length / 2)
      ? "forced"
      : density > 3
        ? "repetitive"
        : !has(h1) && !first
          ? "missing"
          : "natural";
  return { phrase, verdict, density, spots };
}

// ---------- guide dates ----------
export const isGuide = (url, title, types = []) => {
  let p = "";
  try {
    p = new URL(url).pathname;
  } catch {}
  return (
    /\/(?:guides?|how-?to|tutorials?)(?:\/|$)/i.test(p) ||
    /^how to\b|\bguide\b/i.test(title || "") ||
    types.includes("HowTo")
  );
};
const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
const MON = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const DATE = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+${MON},?\s+\d{4}|${MON}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|${MON}\s+\d{4})`;
const VISIBLE = new RegExp(String.raw`\b(?:updated|reviewed|modified|published|posted)(?:\s+on)?\s*:?\s*${DATE}`, "gi");
const timeOf = s => {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return Date.parse(s.slice(0, 10));
  // Schema values can be anything ("N/A", "{{date}}"), so no four-digit year or no month name means NaN.
  const l = s.toLowerCase(),
    year = l.match(/\b\d{4}\b/)?.[0],
    month = MONTHS.findIndex(m => l.includes(m));
  if (!year || month < 0) return NaN;
  return Date.UTC(+year, month, +(l.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/)?.[1] || 1));
};
// The page's newest date from schema, <time datetime> or a visible "updated" date, ignoring dates over two days
// ahead. Returns { time, date, from } or null.
export function newestDate(html, nodes = [], now = Date.now()) {
  const found = [
    ...nodes.flatMap(n => ["dateModified", "datePublished"].filter(k => typeof n[k] === "string").map(k => [n[k], k])),
    ...[...html.matchAll(/<time\b[^>]*\bdatetime\s*=\s*["']?(\d{4}-\d{2}-\d{2})/gi)].map(m => [m[1], "<time>"]),
    ...[
      ...html
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .matchAll(VISIBLE),
    ].map(m => [m[1], "a visible date"]),
  ]
    .map(([s, from]) => ({ time: timeOf(s), from }))
    .filter(x => x.time > Date.UTC(1995, 0, 1) && x.time <= now + 2 * 864e5);
  if (!found.length) return null;
  const best = found.reduce((a, b) => (b.time > a.time ? b : a));
  return { time: best.time, date: new Date(best.time).toISOString().slice(0, 10), from: best.from };
}

// ---------- claims ----------
// One claim per sentence, the first kind that matches. Each pattern needs a figure, a trend or a named study, so
// prices, discounts ("save 20%"), opening hours and founding years aren't claims.
const PEOPLE = String.raw`(?:customers|clients|users|teams|companies|businesses|people|members|subscribers|downloads|installs|students|developers|brands|organi[sz]ations|patients|readers|visitors|homes|drivers|families|websites|stores|shops|merchants|creators)`;
const NAMED =
  /\b((?:(?:[A-Z][\w&.'’-]*|\d{4})\s+){1,4})(?:study|survey|report|poll|analysis|paper|research|data|researchers|analysts)\s+(?:found|finds|shows?|showed|suggests?|suggested|says|said|reveal(?:s|ed)|estimates?|estimated|predicts?|predicted|reports?|reported|conclude[sd]?)\b/;
const NOT_NAME = new Set(
  "a an the one our their his her its this that these those new recent latest independent further early earlier previous some many other more most several another major large small leading internal academic scientific industry market customer annual global national local official what why how when where who which so but and yet also then here there now today".split(
    " ",
  ),
);
const YEAR = String.raw`(?:19|20)\d{2}`;
const BY_YEAR = new RegExp(String.raw`\bby\s+(?:the\s+(?:end|start|middle)\s+of\s+)?${YEAR}\b`, "i"),
  IN_YEAR = new RegExp(String.raw`\b(?:in|since|from|between)\s+${YEAR}\b`, "i");
const FORECAST = /\b(?:will|(?:is|are)\s+(?:expected|projected|forecast|predicted|set|likely)\s+to)\b/i;
const TREND =
  /\b(?:doubled|tripled|quadrupled|halved|(?:grown|grew|risen|rose|fallen|fell|dropped|increased|decreased|declined|jumped|surged|soared)\s+(?:by\s+)?(?:\d|a\s+(?:third|quarter|half)|half|tenfold|twofold|threefold))/i;
const MEASURE = /\d|\b(?:half|a\s+third|a\s+quarter|double|twice|triple|majority|most|million|billion)\b/i;
const KINDS = [
  [
    "named source",
    s => {
      const m = s.match(NAMED);
      return (
        m &&
        m[1]
          .trim()
          .split(/\s+/)
          .some(w => /^[A-Z]/.test(w) && !NOT_NAME.has(w.toLowerCase()))
      );
    },
  ],
  ["study", /\b(?:studies|research|surveys?)\s+(?:show|shows|suggests?|proves?|found|finds|has shown|have shown)\b/i],
  ["statistic", /\b\d{1,3}(?:\.\d+)?\s?%\s+of\b/i],
  [
    "percentage",
    /\b(?:grew|grow|grows|grown|rose|rise|rises|risen|increased?|increases|decreased?|decreases|fell|fall|falls|fallen|dropped|drops?|declined?|declines|jumped|jumps?|cuts?|reduced?|reduces|boost(?:s|ed)?|improved?|improves|lower(?:s|ed)?|raised?|raises|doubled)\s+(?:[\w'’-]+\s+){0,3}?(?:by\s+)?(?:up\s+to\s+|over\s+|more\s+than\s+|nearly\s+|almost\s+|about\s+|around\s+|roughly\s+)?\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?%\s+(?:more|less|fewer|faster|slower|higher|lower|cheaper|better|bigger|smaller|increase|decrease|growth|drop|rise|reduction|improvement|boost|jump|gain)\b/i,
  ],
  [
    "multiplier",
    /\b(?:\d+(?:\.\d+)?\s?[x×]|(?:\d+(?:\.\d+)?|two|three|four|five|ten)\s+times)\s+(?:faster|slower|more|less|fewer|cheaper|better|higher|lower|bigger|smaller|quicker|larger|greater|safer|stronger|longer)\b/i,
  ],
  [
    "big number",
    new RegExp(
      String.raw`[$€£¥]\s?\d+(?:[.,]\d+)?\s?(?:million|billion|trillion|bn|m)\b|\b\d+(?:[.,]\d+)?\s?(?:million|billion|trillion)\b|\b(?:\d{2,3}(?:,\d{3})+|\d(?:,\d{3}){2,}|\d{5,}|[1-9]\d{1,2}k)\+?\s+(?:(?:happy|satisfied|active|paying|monthly|registered|loyal)\s+)?${PEOPLE}\b`,
      "i",
    ),
  ],
  [
    "dated claim",
    s =>
      (BY_YEAR.test(s) && FORECAST.test(s) && MEASURE.test(s.replace(new RegExp(`\\b${YEAR}\\b`, "g"), ""))) ||
      (IN_YEAR.test(s) && TREND.test(s)),
  ],
];
// A source counts in the claim's sentence or the next, unless the next is a claim with its own source. A named study
// already names its source, so "according to" isn't enough for it: it needs a link or footnote.
const LINKED = /https?:\/\/|\]\(|\[\^?\d+\]|\[\^[\w-]+\]|<a\s[^>]*href|\bsources?\s*:|\bvia\s*:/i;
const CITED = new RegExp(`${LINKED.source}|\\baccording to\\b`, "i");
const kindOf = x => KINDS.find(([, t]) => (typeof t === "function" ? t(x) : t.test(x)))?.[0];
export function claimsIn(text) {
  const s = [...SENT.segment(String(text ?? ""))].map(x => x.segment).filter(x => x.trim()),
    kinds = s.map(x => kindOf(x.trim())),
    out = [];
  s.forEach((raw, i) => {
    const x = raw.trim(),
      kind = kinds[i],
      next = i + 1 < s.length && !kinds[i + 1] ? s[i + 1] : "";
    // Joined untrimmed: a footnote's "[" can end one sentence and "^1]" start the next.
    if (kind)
      out.push({
        kind,
        claim: x.length > 200 ? x.slice(0, 199) + "…" : x,
        sourced: (kind === "named source" ? LINKED : CITED).test(raw + next),
      });
  });
  return out;
}

// ---------- hidden characters ----------
// Always hidden: zero-width space, word joiner, BOM, invisible maths operators (U+2061–2064), and tag characters
// (U+E0000–E007F) outside an emoji flag's tag sequence (🏴 + tag letters + cancel tag).
// https://www.unicode.org/reports/tr51/
// Soft hyphens and zero-width (non-)joiners count only inside Latin words, bidi controls only in text with no RTL
// script, the Hangul filler only with no other Hangul, and the Mongolian vowel separator only with no Mongolian.
const ALWAYS =
  /[​⁠﻿⁡-⁤]|[\u{E0000}-\u{E002F}\u{E003A}-\u{E0060}\u{E007B}-\u{E007E}]|(?<!\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{0,6})[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}\u{E007F}]/u;
const IN_LATIN = /(?<=[A-Za-z])[­‌‍](?=[A-Za-z])/;
const BIDI = /[‎‏‪-‮⁦-⁩]/,
  RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}]/u;
const NAMES = {
  "​": "zero-width space",
  "⁠": "word joiner",
  "﻿": "byte-order mark",
  "­": "soft hyphen",
  "‌": "zero-width non-joiner",
  "‍": "zero-width joiner",
  "⁡": "function application",
  "⁢": "invisible times",
  "⁣": "invisible separator",
  "⁤": "invisible plus",
  "‎": "left-to-right mark",
  "‏": "right-to-left mark",
  "‪": "left-to-right embedding",
  "‫": "right-to-left embedding",
  "‬": "pop directional formatting",
  "‭": "left-to-right override",
  "‮": "right-to-left override",
  "⁦": "left-to-right isolate",
  "⁧": "right-to-left isolate",
  "⁨": "first strong isolate",
  "⁩": "pop directional isolate",
  "ㅤ": "Hangul filler",
  "᠎": "Mongolian vowel separator",
};
// The first hidden character: { index, char, code, name } or null.
export function invisibleChar(text) {
  const t = String(text ?? "");
  const res = [
    ALWAYS,
    IN_LATIN,
    !RTL.test(t) && BIDI,
    !/[ᄀ-ᇿㄱ-ㅣㅥ-ㆎ가-힯]/.test(t) && /ㅤ/,
    !/[᠀-᠍᠏-᢯]/.test(t) && /᠎/,
  ].filter(Boolean);
  const m = res
    .map(re => re.exec(t))
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)[0];
  if (!m) return null;
  const cp = m[0].codePointAt(0);
  return {
    index: m.index,
    char: m[0],
    code: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
    name: NAMES[m[0]] || "tag character",
  };
}
