#!/usr/bin/env node
// Keyword ideas from real sources only, each labelled with its source. No volumes or difficulty: those need paid data,
// so none are guessed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { addTraffic } from "./gsc-import.mjs";
import { classify } from "./links-import.mjs";

const USAGE =
  'usage: node keyword-ideas.mjs --google seo-audit/google.json | --gsc seo-audit/gsc.json [--crawl seo-audit/seo-crawl.json] [--brand "Acme"] [--extra seo-audit/keyword-extra.json] [--out seo-audit/keyword-ideas.json]';
class Fail extends Error {}
const MIN_IMPRESSIONS = 10; // as gsc-import's query-competition: under 10 is the long tail
const MAX = 50; // ideas per group, most impressions first

// Words: lower case, accents dropped ("Café" is "cafe"), anything but letters and digits splits them.
const norm = s =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
// Scripts written without spaces between words, as seo-crawl.mjs lists them: no reliable words, so no gap is claimed.
const NOSPACE = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Thai}\p{scx=Laoo}\p{scx=Khmr}\p{scx=Mymr}]/u;
// Words that don't say what a query is about: question words, filler and short function words in English, Spanish,
// French, German, Portuguese and Italian (accents dropped). Words under 3 letters are skipped anyway.
const STOP = new Set(
  (
    "what whats how why when where who whom whose which can could does did doing are was were been being have has had " +
    "should would will shall may might must the and for with from into your yours you our ours out about near nearby best top cheap cheapest " +
    "free online official good great versus than that this these those there their them they its not any all some much many more most get " +
    "just also very only own same such too here myself yourself " +
    "para por con sin los las del una uno unos unas que como mas sobre entre desde hasta cual cuales donde cuando quien porque esta este esto son " +
    "les des une pour avec dans sur par aux est sont qui quoi comment pourquoi quel quelle quels quelles sans chez leur leurs vous nous " +
    "der die das den dem und mit fur von ein eine einen einem einer auf aus bei nach zum zur ist sind wie warum wann welche welcher welches oder " +
    "com dos das uma uns umas sem nos nas pelo pela onde quando qual quais " +
    "per della delle dei degli gli che come nel nella nei sul sulla dove quale quali perche"
  ).split(" "),
);
const mainWords = s => [
  ...new Set(
    norm(s)
      .split(" ")
      .filter(w => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w)),
  ),
];
// One word holds the other with up to 3 more letters, so plurals and simple endings match ("repair", "repairs",
// "precios"). Prefix matching only, no stemming or synonyms ("plumber" and "plumbing" differ). Add a per-language
// stemmer if false gaps show up.
const same = (a, b) => {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return a === b || (s.length >= 3 && l.startsWith(s) && l.length - s.length <= 3);
};
// A page is about a query when its title and H1 hold the query's main words. With 3 or more, all but one is enough: the
// extra word is usually a place or a detail ("boiler servicing leeds" on a page titled "Boiler servicing").
const covers = (pageWords, words) =>
  words.filter(w => pageWords.some(p => same(w, p))).length >= (words.length >= 3 ? words.length - 1 : words.length);
// English question words followed by at least two more words ("can opener" isn't a question), or a question mark in
// any language.
const QUESTION =
  /^(what|what['’]?s|how|why|when|where|who|whom|whose|which|can|could|does|do|did|is|are|should|would)\s+\S+\s+\S+|[?？¿]/i;
// The same escaping as render-report.mjs, which doesn't export it: a backslash before each special character.
const md = s =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\\`*_[\]<>|]/g, "\\$&");
const pathOf = u => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return String(u);
  }
};
const valid = r =>
  r && typeof r.query === "string" && r.query.trim() && Number.isFinite(r.impressions) && Number.isFinite(r.position);

// search is google.json or gsc.json; words is the page-words file that crawl.pageWords names, or null.
export function keywordIdeas({ search, crawl = null, brand, extra = [] }) {
  const notes = [];
  const pageQueries = search.pageQueries && typeof search.pageQueries === "object" ? search.pageQueries : {};
  let rows = (Array.isArray(search.queries) ? search.queries : []).filter(valid);
  // Only per-page exports: the site's queries are their sum (position weighted by impressions, as for pages).
  if (!rows.length) {
    const sum = {};
    for (const list of Object.values(pageQueries))
      for (const r of (Array.isArray(list) ? list : []).filter(valid))
        addTraffic(sum, r.query, {
          clicks: r.clicks || 0,
          impressions: r.impressions,
          ctr: r.ctr || 0,
          position: r.position,
        });
    rows = Object.entries(sum).map(([query, m]) => ({ query, ...m }));
  }
  if (!rows.length) notes.push("The Search Console data has no queries, so only the --extra phrases are listed.");
  // The page that shows for each query: the one with most of its impressions.
  const top = new Map();
  for (const [path, list] of Object.entries(pageQueries))
    for (const r of (Array.isArray(list) ? list : []).filter(valid)) {
      const k = r.query.toLowerCase(),
        t = top.get(k);
      if (!t || r.impressions > t.impressions) top.set(k, { path, impressions: r.impressions });
    }

  const site = search.site || crawl?.siteOrigin,
    host = (() => {
      try {
        return new URL(site).hostname.replace(/^www\./, "").split(".")[0];
      } catch {
        return "";
      }
    })();
  const brandName = brand || crawl?.options?.brand || host;
  notes.push(
    brandName
      ? `Brand queries are left out using “${brandName}”${brand ? " (from --brand)" : crawl?.options?.brand ? " (the crawl's --brand)" : ", taken from the site's address. Pass --brand with the business name if it's different"}.`
      : "No brand name was given or found, so brand queries weren't left out. Pass --brand with the business name.",
  );

  const pages = Array.isArray(crawl?.pages)
    ? crawl.pages
        .filter(p => p?.url)
        .map(p => ({ path: pathOf(p.url), words: mainWords(`${p.title || ""} ${p.h1Text || ""}`) }))
    : null;
  // The page whose title or H1 is about the phrase, null when none is, undefined when that can't be judged.
  const about = phrase =>
    !pages || NOSPACE.test(phrase) ? undefined : (pages.find(p => covers(p.words, mainWords(phrase)))?.path ?? null);
  if (!pages)
    notes.push(
      "Without --crawl, page titles and H1s weren't read, so “shown for, but no page is about it” wasn't checked.",
    );
  const unjudged = pages ? rows.filter(r => NOSPACE.test(r.query)).length : 0;
  if (unjudged)
    notes.push(
      `${unjudged} quer${unjudged === 1 ? "y is" : "ies are"} in a script written without spaces between words, so whether a page is about ${unjudged === 1 ? "it" : "them"} wasn't judged.`,
    );

  const almostThere = [],
    gaps = pages ? [] : null,
    questions = [];
  for (const r of [...rows].sort((a, b) => b.impressions - a.impressions)) {
    if (r.impressions < MIN_IMPRESSIONS) continue;
    const kind = classify(r.query, brandName || ""),
      page = top.get(r.query.toLowerCase())?.path ?? null;
    const idea = use => ({
      phrase: r.query,
      source: "Search Console",
      evidence: { impressions: r.impressions, clicks: r.clicks ?? 0, position: r.position, page },
      use,
    });
    if (kind === "other" && r.position >= 8 && r.position <= 20) {
      almostThere.push(
        idea(
          page
            ? `Improve ${page} for this query: answer it clearly, use its words in a heading if they fit, and link to the page from related pages.`
            : "Find the page that shows for it in Search Console (Performance, filter by this query, then Pages), and answer the query clearly on that page.",
        ),
      );
    } else if (QUESTION.test(r.query) && (kind === "other" || kind === "brand")) {
      // Brand questions stay: "does acme deliver to ireland" is a good FAQ entry.
      const a = about(r.query);
      questions.push(
        idea(
          a
            ? `Answer it in a short section or an FAQ on ${a}, which is already about this.`
            : `${a === null ? "No page is about this yet. " : ""}Answer it in an FAQ or a section on the page that fits best.`,
        ),
      );
    } else if (kind === "other" && gaps && about(r.query) === null) {
      gaps.push(
        idea("No page's title or H1 is about this. A new page, or a section on a related page, could answer it."),
      );
    }
  }

  const list = Array.isArray(extra) ? extra : [];
  const ok = list.filter(
    e => typeof e?.phrase === "string" && e.phrase.trim() && typeof e.source === "string" && e.source.trim(),
  );
  if (ok.length < list.length)
    notes.push(
      `${list.length - ok.length} entr${list.length - ok.length === 1 ? "y" : "ies"} in --extra ${list.length - ok.length === 1 ? "was" : "were"} skipped: each needs a phrase and a source.`,
    );
  const seen = new Set(),
    byQuery = new Map(rows.map(r => [norm(r.query), r]));
  const fromOutside = ok
    .filter(e => {
      const k = norm(e.phrase) + "\n" + e.source.trim();
      return !seen.has(k) && seen.add(k);
    })
    .map(e => {
      const a = about(e.phrase),
        r = byQuery.get(norm(e.phrase));
      return {
        phrase: e.phrase.trim(),
        source: e.source.trim(),
        evidence: r
          ? {
              impressions: r.impressions,
              clicks: r.clicks ?? 0,
              position: r.position,
              page: top.get(r.query.toLowerCase())?.path ?? null,
            }
          : null,
        use: a
          ? `${a} is already about this: check it answers it well.`
          : a === null
            ? "No page's title or H1 is about this. A new page or a section, if it fits what the site offers."
            : "Check whether a page already covers it; if not, a new page or a section, if it fits what the site offers.",
      };
    });

  const cap = (name, g) => {
    if (g && g.length > MAX)
      notes.push(`${name}: only the first ${MAX} of ${g.length} are listed, most impressions first.`);
    return g && g.slice(0, MAX);
  };
  notes.push(
    "Almost there is per query. Search Console's almost-page-one finding (INTENT-04) is per page: a page at position 8 to 20 overall. The two often overlap, but a page can rank well overall and still be almost there for one query. These ideas aren't findings and never change the score.",
    // https://developers.google.com/search/blog/2022/10/performance-data-deep-dive
    "Search Console hides rare queries to protect searchers' privacy (ones fewer than a few dozen people searched in two to three months), so some real searches aren't here.",
    "There are no search volumes or difficulty scores: those need paid data, and none are guessed.",
    "You pick which ideas become targets. Only the ones you pick go into the profile's Target phrases table, with their source.",
  );
  return {
    tool: "seo-supervisor-keyword-ideas",
    period: search.period ?? null,
    brand: brandName || null,
    almostThere: cap("Almost there", almostThere),
    gaps: cap("Shown for, but no page is about it", gaps),
    questions: cap("Questions people search", questions),
    extra: cap("Ideas from search results and competitors", fromOutside),
    notes,
  };
}

const GROUPS = [
  [
    "almostThere",
    "Almost there",
    "Queries at position 8 to 20 with impressions, and the page that shows for each. A small improvement can bring them onto page one.",
  ],
  [
    "gaps",
    "Shown for, but no page is about it",
    "Queries with impressions where no page's title or H1 holds the query's main words. Brand queries are left out.",
  ],
  [
    "questions",
    "Questions people search",
    "Question-shaped queries, found by English question words or a question mark in any language. Each could be an FAQ or a section.",
  ],
  [
    "extra",
    "Ideas from search results and competitors",
    "Phrases collected with outside checks on. Each keeps the source it came from.",
  ],
];

export function ideasMarkdown(r) {
  const n = x => Number(x).toLocaleString("en-US");
  const L = [
    "# Keyword ideas",
    "",
    `From Search Console${r.period ? ` (${md(r.period)})` : ""}. Information only: you pick which ideas become targets.`,
    "",
  ];
  for (const [key, title, what] of GROUPS) {
    L.push(`## ${title}`, "", what, "");
    const g = r[key];
    if (!g) {
      L.push("Not checked: run with --crawl to read page titles and H1s.", "");
      continue;
    }
    if (!g.length) {
      L.push("None.", "");
      continue;
    }
    L.push("| Phrase | Source | Evidence | Suggested use |", "| --- | --- | --- | --- |");
    for (const i of g) {
      const e = i.evidence,
        ev = e
          ? `${n(e.impressions)} impressions, ${n(e.clicks)} clicks, position ${e.position}${e.page ? `, shows ${md(e.page)}` : ""}`
          : "";
      L.push(`| ${md(i.phrase)} | ${md(i.source)} | ${ev} | ${md(i.use)} |`);
    }
    L.push("");
  }
  L.push("## Notes", "", ...r.notes.map(x => `- ${md(x)}`), "");
  return L.join("\n");
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      args[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    }
  const str = k => (typeof args[k] === "string" ? args[k] : null);
  const file = str("google") || str("gsc");
  if (!file || (str("google") && str("gsc"))) throw new Fail(USAGE);
  const read = f => {
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      throw new Fail(
        `keyword-ideas: can't read ${f} (${e.code === "ENOENT" ? "it isn't there" : e.code || "it isn't JSON"}).`,
      );
    }
  };
  const search = read(file),
    crawl = str("crawl") ? read(args.crawl) : null,
    extra = str("extra") ? read(args.extra) : [];
  if (!search || typeof search !== "object")
    throw new Fail(`keyword-ideas: ${file} isn't google.mjs's or gsc-import.mjs's output.`);
  if (crawl && !Array.isArray(crawl.pages))
    throw new Fail(`keyword-ideas: ${args.crawl} isn't the crawler's seo-crawl.json (it has no pages list).`);
  if (!Array.isArray(extra))
    throw new Fail(`keyword-ideas: ${args.extra} must be a JSON list of { "phrase", "source" }.`);
  const any = l => Array.isArray(l) && l.some(valid);
  if (!any(search.queries) && !Object.values(search.pageQueries || {}).some(any) && !extra.length)
    throw new Fail(
      `keyword-ideas: ${file} has no search queries. Import Search Console's Queries export with gsc-import.mjs --queries, or run google.mjs fetch, then try again.`,
    );
  const r = keywordIdeas({ search, crawl, brand: str("brand"), extra });
  const out = resolve(str("out") || "seo-audit/keyword-ideas.json"),
    mdOut = out.replace(/\.json$/i, "") + ".md";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(r, null, 2));
  writeFileSync(mdOut, ideasMarkdown(r));
  console.log(
    `keyword-ideas: ${r.almostThere.length} almost there, ${r.gaps ? `${r.gaps.length} with no page about them` : "pages not checked (no --crawl)"}, ${r.questions.length} questions, ${r.extra.length} from outside checks · wrote ${out} and ${mdOut}`,
  );
  return 0;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    console.error(e.message);
    process.exitCode = 2;
  }
}
