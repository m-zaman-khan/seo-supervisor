// Filler and stock phrases: a short local list.
const STOCK = [
  "in today's fast-paced world",
  "in today's digital age",
  "ever-evolving landscape",
  "it's important to note",
  "it's worth noting",
  "delve into",
  "a testament to",
  "unlock the power of",
  "unlock the full potential",
  "harness the power of",
  "to the next level",
  "look no further",
  "game-changer",
  "cutting-edge",
  "state-of-the-art",
  "rest assured",
  "without further ado",
  "embark on a journey",
  "navigate the complexities",
  "seamlessly integrate",
  "plays a crucial role",
  "plays a vital role",
];
// Phrases hold letters, spaces, apostrophes and hyphens only. A curly apostrophe matches too, and a hyphen may be a
// space or nothing.
const STOCK_RE = STOCK.map(p => [
  p,
  new RegExp(`\\b${p.replace(/'/g, "['’]").replace(/-/g, "[- ]?").replace(/ /g, "\\s+")}\\b`, "i"),
]);

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = s =>
  s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|\w+);/gi, (m, e) => {
    if (e[0] !== "#") return ENT[e.toLowerCase()] ?? m;
    const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
// What's left out: code, tables, maths, forms' option lists and anything that isn't read as text.
const SKIP =
  /<(pre|code|kbd|samp|var|table|math|select|textarea|script|style|noscript|template|svg)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi;
// A <p> ends at </p>, the next <p> or a block element, as browsers close it. Only <p> text is read; text in bare
// <div>s and list items isn't, so a page built without <p> gets no notes rather than wrong ones.
const PARA =
  /<p\b[^>]*>([\s\S]*?)(?=<\/p>|<p\b|<\/?(?:div|section|article|main|aside|header|footer|nav|ul|ol|li|dl|h[1-6]|blockquote|figure|form|table|body)\b|$)/gi;

// The page's main HTML as plain text: one paragraph per <p>, separated by a blank line, and a <br> as a line break.
export function writingText(html) {
  return [...html.replace(SKIP, " ").matchAll(PARA)]
    .map(m =>
      decode(
        m[1]
          .replace(/\s+/g, " ")
          .replace(/<br\b[^>]*>/gi, "\n")
          .replace(/<[^>]+>/g, " "),
      )
        .replace(/[^\S\n]+/g, " ")
        .replace(/ ?\n ?/g, "\n")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}

const SENTENCES = new Intl.Segmenter("en", { granularity: "sentence" });
const wordsOf = s => s.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
const syllables = w => {
  w = w.toLowerCase().replace(/[^a-z]/g, "");
  let n = (w.match(/[aeiouy]+/g) || []).length;
  if (n > 1 && /[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) n--; // a silent final e ("make"), but not "table"
  return Math.max(1, n);
};
const quote = s => (s.length > 300 ? s.slice(0, 299) + "…" : s);
// A stock phrase with up to 4 words either side, inside its own paragraph, so rewrite mode can find it in the source.
// The 100 characters before it keep the backward search short.
const inContext = (para, re) => {
  const m = re.exec(para);
  const before = para.slice(Math.max(0, m.index - 100), m.index).match(/(?:\S+\s+){0,4}\S*$/)[0];
  const after = para.slice(m.index + m[0].length).match(/^\S*(?:\s+\S+){0,4}/)[0];
  return quote((before + m[0] + after).replace(/\s+/g, " "));
};

export function writingFeatures(text, lang) {
  const none = {
    longSentences: 0,
    longestSentence: null,
    longParagraphs: 0,
    stockPhrases: [],
    readingEase: null,
    examples: [],
  };
  // English only: the thresholds, the phrases and the formula are all English ones.
  if (!/^en(?![a-z])/i.test(lang || "")) return none;
  const paras = String(text || "")
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);
  const sentences = paras
    .flatMap(p => [...SENTENCES.segment(p)].map(s => s.segment.replace(/\s+/g, " ").trim()))
    .map(s => [s, wordsOf(s)])
    .filter(([, w]) => w.length);
  // Over 35 words a sentence or 150 a paragraph is long: rough local guides, not Google's.
  const long = sentences.filter(([, w]) => w.length > 35);
  const longest = long.reduce((a, b) => (b[1].length > a[1].length ? b : a), long[0]);
  const words = sentences.flatMap(([, w]) => w);
  // Flesch, "A new readability yardstick", Journal of Applied Psychology 32(3), 1948. Syllables are counted by vowel
  // groups, so it's a rough guide.
  const ease =
    206.835 -
    1.015 * (words.length / sentences.length) -
    84.6 * (words.reduce((n, w) => n + syllables(w), 0) / words.length);
  const stock = STOCK_RE.flatMap(([p, re]) => {
    const para = paras.find(x => re.test(x));
    return para ? [[p, inContext(para, re)]] : [];
  });
  return {
    longSentences: long.length,
    longestSentence: longest ? quote(longest[0]) : null,
    longParagraphs: paras.filter(p => wordsOf(p).length > 150).length,
    stockPhrases: stock.map(([p]) => p),
    readingEase: words.length >= 100 ? Math.max(0, Math.min(100, Math.round(ease))) : null, // too few words make it noise
    // The first 12 words of up to 3 long sentences, then each stock phrase in context.
    examples: [
      ...long.slice(0, 3).map(([s]) => quote(s.split(" ").slice(0, 12).join(" ") + "…")),
      ...stock.map(([, c]) => c),
    ],
  };
}
