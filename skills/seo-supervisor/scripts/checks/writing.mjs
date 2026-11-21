// Plain-language writing notes for English pages, and a reading-ease check for CI when run on its own.
// English only: the thresholds, the phrases and the formula are all English ones. Over 35 words a sentence or 150 a
// paragraph is long: rough local guides, not Google's. Stock phrases come from a short local list.
// Reading ease: Flesch, "A new readability yardstick", Journal of Applied Psychology 32(3), 1948. Syllables are
// counted by vowel groups, so it's a rough guide.
// The CI check (examples/hooks/reading-ease.yml): the default pass mark, 60, is where Flesch's table moves from
// "standard" to "fairly difficult". It never touches the audit or its score.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isMain } from "../lib/is-main.mjs";

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

// The opt-in CI check (examples/hooks/reading-ease.yml). The default pass mark, 60, is where Flesch's table moves from
// "standard" to "fairly difficult". It never touches the audit or its score.
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2),
    at = args.indexOf("--min"),
    min = at >= 0 ? Number(args[at + 1]) : 60;
  const inputs = args.filter((a, i) => !a.startsWith("--") && !(at >= 0 && i === at + 1));
  if (!inputs.length || !(min >= 0 && min <= 100) || inputs.some(p => !existsSync(p))) {
    console.error(
      "usage: node writing.mjs <file|folder ...> [--min 60]   (the pass mark is a reading ease from 0 to 100; every path must exist)",
    );
    process.exit(2);
  }
  const walk = d =>
    readdirSync(d, { withFileTypes: true }).flatMap(e =>
      e.isDirectory()
        ? e.name.startsWith(".") || e.name === "node_modules"
          ? []
          : walk(join(d, e.name))
        : /\.html?$/i.test(e.name)
          ? [join(d, e.name)]
          : [],
    );
  const pages = inputs.flatMap(p =>
    statSync(p).isDirectory() ? walk(p).map(f => [f, relative(p, f).split(sep).join("/")]) : [[p, p]],
  );
  const scored = [];
  for (const [file, name] of pages) {
    const html = readFileSync(file, "utf8"),
      lang = html.match(/<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i)?.[1];
    const body = html.replace(/^[\s\S]*?<body\b[^>]*>/i, "");
    const main =
      body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
      body.replace(/<(header|nav|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
    const ease = writingFeatures(writingText(main), lang).readingEase;
    if (ease != null) scored.push([ease, name]);
  }
  const low = scored.filter(([e]) => e < min);
  console.log(
    `Reading ease (Flesch 1948: 0 to 100, higher is easier). SEO Supervisor's own check, not Google's; it never changes the audit score.\nPass mark: ${min}.`,
  );
  for (const [e, name] of scored) console.log(`${String(e).padStart(5)}  ${name}${e < min ? `  below ${min}` : ""}`);
  if (pages.length > scored.length)
    console.log(`Skipped ${pages.length - scored.length} page(s): not English, or under 100 words.`);
  console.log(
    !scored.length
      ? "No English page had 100 words or more to score."
      : low.length
        ? `${low.length} of ${scored.length} pages scored below ${min}.`
        : `All ${scored.length} pages scored ${min} or more.`,
  );
  process.exitCode = low.length ? 1 : 0;
}
