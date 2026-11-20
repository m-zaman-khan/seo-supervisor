// Writing notes (CONTENT-13): long sentences, long paragraphs, stock phrases and reading ease.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { writingFeatures, writingText } from "../skills/seo-supervisor/scripts/checks/writing.mjs";

const LONG =
  "This sentence keeps going with one more clause after another so that it runs well past the point where a reader would want a full stop, and then it adds a few more words to be sure it is long.";
const STOCK = "In today’s fast-paced world, we delve into what makes a real game changer for your home.";
const PARA = "We fix boilers, taps and leaks across the whole city. ".repeat(16).trim(); // 160 words
const SHORT = "We answer the phone fast. A real person picks up. We give a price before we start. ".repeat(4).trim();
const NONE = {
  longSentences: 0,
  longestSentence: null,
  longParagraphs: 0,
  stockPhrases: [],
  readingEase: null,
  examples: [],
};
// What rewrite mode searches the source for: the first 12 words of a long sentence, and each stock phrase in context.
const EXAMPLES = [
  "This sentence keeps going with one more clause after another so that…",
  "In today’s fast-paced world, we delve into what",
  "today’s fast-paced world, we delve into what makes a real",
  "what makes a real game changer for your home.",
];

test("long sentences, long paragraphs and stock phrases are noted, and reading ease shows for English", () => {
  const w = writingFeatures([STOCK, LONG, PARA].join("\n\n"), "en-GB");
  assert.equal(w.longSentences, 1);
  assert.equal(w.longestSentence, LONG);
  assert.equal(w.longParagraphs, 1, "160 words in one paragraph");
  assert.deepEqual(
    w.stockPhrases,
    ["in today's fast-paced world", "delve into", "game-changer"],
    "curly apostrophes and a space for the hyphen still match",
  );
  assert.ok(Number.isInteger(w.readingEase) && w.readingEase >= 0 && w.readingEase <= 100, String(w.readingEase));
  // Flesch: 206.835 − 1.015 × 6 words a sentence − 84.6 × 2 syllables a word = 31.5.
  assert.equal(writingFeatures("Happy children quickly enter wooden houses. ".repeat(20), "en").readingEase, 32);
  assert.equal(writingFeatures("The cat sat on the mat. ".repeat(20), "en").readingEase, 100, "kept within 0 to 100");
  assert.equal(writingFeatures(SHORT, "en").readingEase, null, "under 100 words is too little to score");
  assert.deepEqual(writingFeatures(SHORT, "en"), NONE, "short, plain text has nothing to note");
  // From HTML: paragraphs, a <br> ends a line, and unclosed <p> tags still end at the next block.
  assert.equal(
    writingText(`<h1>Title</h1><p>One &amp; two.\n  Still one.</p><p>Address<br>Leeds<div>x</div><p>Last`),
    "One & two. Still one.\n\nAddress\nLeeds\n\nLast",
  );
});

test("examples quote up to 3 long sentences, cut to 12 words, and each stock phrase with the words around it", () => {
  assert.deepEqual(writingFeatures([STOCK, LONG, PARA].join("\n\n"), "en").examples, EXAMPLES);
  const many = writingFeatures(Array(5).fill(LONG).join(" "), "en");
  assert.equal(many.longSentences, 5);
  assert.deepEqual(many.examples, Array(3).fill(EXAMPLES[0]), "capped at 3 sentences");
  assert.deepEqual(
    writingFeatures(`Our “game-changer” deal.\n\n${SHORT}`, "en").examples,
    ["Our “game-changer” deal."],
    "context stays in the phrase's own paragraph",
  );
});

test("code, tables and non-English text don't produce notes or reading ease", async () => {
  const code = `<p>Run this:</p><pre><code>${LONG} ${PARA}</code></pre><p>Then call <code>${LONG}</code> once.</p>
    <table><tr><td><p>${PARA}</p></td></tr></table><p>${SHORT}</p>`;
  assert.ok(!writingText(code).includes("clause"), "code blocks, inline code and tables are left out");
  assert.deepEqual(writingFeatures(writingText(code), "en"), NONE);
  const german =
    "Dieser Satz ist absichtlich sehr lang, weil er immer weiter geht und noch einen Nebensatz anhängt, damit er über die Grenze von fünfunddreißig Wörtern kommt, die für englische Texte gedacht ist und hier nicht gilt, auch wenn er wirklich lang ist. ".repeat(
      6,
    );
  assert.deepEqual(writingFeatures(german, "de"), NONE);
  assert.deepEqual(
    writingFeatures([LONG, PARA, STOCK].join("\n\n"), null),
    NONE,
    "with no language declared nothing is assumed",
  );

  const r = await writingSite();
  assert.deepEqual(
    r.writingNotes.map(n => new URL(n.url).pathname),
    ["/guide/"],
    "the code page, the German page and the plain home page have no notes",
  );
  const [n] = r.writingNotes;
  assert.deepEqual(
    [n.longSentences, n.longParagraphs, n.stockPhrases, n.longestSentence],
    [1, 1, ["in today's fast-paced world", "delve into", "game-changer"], LONG],
  );
  assert.deepEqual(n.examples, EXAMPLES, "the crawl passes the examples on");
  assert.ok(Number.isInteger(n.readingEase));
  assert.ok(
    !r.findings.some(f => /writing|sentence|paragraph|reading/i.test(f.check + f.title)),
    "notes are never findings",
  );
});

let writingRun;
function writingSite() {
  return (writingRun ||= (async () => {
    const doc = (lang, title, body) =>
      `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;
    const pages = {
      "/": doc(
        "en",
        "Northwind Plumbing",
        `<p>${SHORT}</p><a href="/guide/">Guide</a> <a href="/code/">Code</a> <a href="/de/">Deutsch</a>`,
      ),
      "/guide/": doc("en", "Boiler guide", `<p>${STOCK}</p><p>${LONG}</p><p>${PARA}</p>`),
      "/code/": doc(
        "en",
        "Our booking API",
        `<p>${SHORT}</p><pre><code>${LONG} ${PARA}</code></pre><table><tr><td><p>${PARA}</p></td></tr></table>`,
      ),
      "/de/": doc(
        "de",
        "Heizungsratgeber",
        `<p>${"Dieser Satz ist absichtlich sehr lang, weil er immer weiter geht und noch einen Nebensatz anhängt, damit er über die Grenze von fünfunddreißig Wörtern kommt, die für englische Texte gedacht ist und hier nicht gilt. ".repeat(5)}</p>`,
      ),
    };
    const dir = tmp(),
      out = join(tmp(), "crawl.json");
    for (const [p, html] of Object.entries(pages)) {
      mkdirSync(join(dir, p), { recursive: true });
      writeFileSync(join(dir, p, "index.html"), html);
    }
    writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
    const site = await serve(dir);
    try {
      await node([
        join(SCRIPTS, "seo-crawl.mjs"),
        "--url",
        site.url,
        "--site-origin",
        "https://site.example",
        "--out",
        out,
      ]);
    } finally {
      await site.close();
    }
    return JSON.parse(readFileSync(out, "utf8"));
  })());
}
const render = async data => {
  const dir = tmp();
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};

test("writing notes and agent info never change the score", async () => {
  const r = await writingSite(),
    evil = "<img src=x onerror=alert(1)>";
  const data = {
    ...r,
    writingNotes: [
      ...r.writingNotes,
      {
        url: `https://site.example/${evil}`,
        longSentences: 2,
        longestSentence: `Quoted ${evil} text`,
        longParagraphs: 0,
        stockPhrases: [],
        readingEase: 55,
        examples: [`Start ${evil}…`, { bad: evil }],
      },
    ],
    agents: {
      pages: [{ url: "https://site.example/book/", tools: [evil] }],
      ucp: evil,
      wellKnown: ["/.well-known/agent-card.json"],
    },
  };
  const withInfo = await render(data),
    without = await render({ ...r, writingNotes: undefined, agents: undefined });
  const panels = withInfo.html.match(/\n {4}<details class="how (agents|writing)">[\s\S]*?<\/details>/g) || [];
  assert.equal(panels.length, 2, "an AI agents and a Writing notes panel");
  assert.equal(
    panels.reduce((h, p) => h.replace(p, ""), withInfo.html),
    without.html,
    "the panels are the only change: the score and areas are the same",
  );
  const sections = withInfo.md.match(/## (AI agents|Writing notes)\n[\s\S]*?\n\n(?=## )/g) || [];
  assert.equal(sections.length, 2);
  assert.equal(
    sections.reduce((m, s) => m.replace(s, ""), withInfo.md),
    without.md,
  );
  const writing = panels.find(p => p.includes("how writing"));
  assert.ok(
    writing.includes("<code>/guide/</code>") &&
      writing.includes("1 sentence over 35 words") &&
      writing.includes("stock phrases: “in today&#39;s fast-paced world”"),
    writing,
  );
  assert.match(writing, /not a Google score|never change the score/);
  assert.ok(
    !withInfo.html.includes("<img src=x") && withInfo.html.includes("&lt;img src=x onerror=alert(1)&gt;"),
    "crawled text is escaped",
  );
  assert.ok(!/(^|[^\\])<img src=x/m.test(withInfo.md) && withInfo.md.includes("\\<img src=x onerror=alert(1)\\>"));
});
