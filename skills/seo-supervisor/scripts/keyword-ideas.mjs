#!/usr/bin/env node
// @ts-check
// Keyword ideas from real sources only, each labelled with its source. No volumes or difficulty: keyword-data.mjs adds
// those.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain } from "./lib/cli.mjs";
import { addTraffic } from "./gsc-import.mjs";
import { classify, withSiteName } from "./links-import.mjs";

const USAGE =
  'usage: node keyword-ideas.mjs --google seo-audit/google.json | --gsc seo-audit/gsc.json [--crawl seo-audit/seo-crawl.json] [--brand "Acme"] [--extra seo-audit/keyword-extra.json] [--out seo-audit/keyword-ideas.json]';
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
export const mainWords = s => [
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
// English question words followed by at least two more words ("how much" alone isn't a question), or a question mark in
// any language. "can", "do", "is" and the like start a question only before a pronoun or an article, so "can opener
// electric" and "do it yourself bathroom" aren't questions.
const QUESTION =
  /^(?:(?:what|what['’]?s|how|why|when|where|who|whom|whose|which)\s+\S+\s+\S+|(?!do\s+it\s+yourself\b)(?:can|could|does|do|did|is|are|should|would|will)\s+(?:i|you|we|they|he|she|it|my|your|our|their|a|an|the|this|that|these|those|there|anyone|someone|people)\s+\S+)|[?？¿]/i;
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
export function keywordIdeas({ search, crawl = null, brand, extra = [], words = null }) {
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
        return new URL(site).hostname;
      } catch {
        return "";
      }
    })();
  const given = brand || crawl?.options?.brand,
    brandName = host ? withSiteName(given, host) : given || "";
  notes.push(
    brandName
      ? `Brand queries are left out using “${brandName.split("|").join("” or “")}”${given ? ` (${brand ? "from --brand" : "the crawl's --brand"}${host ? " and the site's address" : ""})` : ", taken from the site's address. Pass --brand with the business name if it's different"}.`
      : "No brand name was given or found, so brand queries weren't left out. Pass --brand with the business name.",
  );

  // Pages with a title or H1 to compare. A crawl that stopped at its page limit, or whose pages have neither (blocked,
  // or built in the browser), can't show that no page is about a query, so gaps aren't judged.
  const crawled = Array.isArray(crawl?.pages) ? crawl.pages.filter(p => p?.url && (p.title || p.h1Text)) : null;
  const pages =
    crawled?.length && !crawl.stats?.capped
      ? crawled.map(p => ({ path: pathOf(p.url), words: mainWords(`${p.title || ""} ${p.h1Text || ""}`) }))
      : null;
  // The page whose title or H1 is about the phrase, null when none is, undefined when that can't be judged.
  const about = phrase =>
    !pages || NOSPACE.test(phrase) ? undefined : (pages.find(p => covers(p.words, mainWords(phrase)))?.path ?? null);
  if (!crawl)
    notes.push(
      "Without --crawl, page titles and H1s weren't read, so “shown for, but no page is about it” wasn't checked.",
    );
  else if (crawl.stats?.capped && crawled?.length)
    notes.push(
      "The crawl stopped at its page limit (--max), so a page it didn't reach may be about a query. “Shown for, but no page is about it” wasn't checked.",
    );
  else if (!pages)
    notes.push(
      "No crawled page has a title or H1 (the crawl may have been blocked, or the pages are built in the browser), so “shown for, but no page is about it” wasn't checked.",
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
            : `${a === null && r.position > 10 ? "No page is about this yet. " : ""}Answer it in an FAQ or a section on the page that fits best.`,
        ),
      );
    } else if (kind === "other" && gaps && r.position > 10 && about(r.query) === null) {
      // On page one (position 10 or better), Google already sees a page as about the query, whatever its title says.
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

  // From the crawl's page words: searches a page shows for whose words its text lacks by covers()'s rule, and pages
  // that hold a search's words but don't link to its top page. Within one site, pages whose title and paragraphs match
  // the questions people ask are cited more by AI answers (a preprint). https://arxiv.org/abs/2610.15033
  const pw = crawl?.pageWords,
    side =
      pw && words?.stamp === pw.stamp && Array.isArray(words.pages)
        ? words.pages.filter(p => typeof p?.path === "string" && typeof p.words === "string")
        : null;
  const why = !Object.values(pageQueries).some(l => Array.isArray(l) && l.some(valid))
    ? "the Search Console data has no per-page queries (google.mjs fetch reads them; with exports, use gsc-import.mjs --page-queries)"
    : !crawl
      ? "there's no --crawl"
      : !pw
        ? "the crawl has no page words, so an older crawler made it (run seo-crawl.mjs again)"
        : !side
          ? `${pw.file} is missing or from another crawl (run seo-crawl.mjs again)`
          : null;
  let linkIdeas = null,
    queryGaps = null;
  if (why) notes.push(`Internal link ideas and searches a page doesn't mention weren't checked: ${why}.`);
  else {
    const pairs = Object.entries(pageQueries)
      .flatMap(([path, list]) =>
        (Array.isArray(list) ? list : [])
          .filter(
            r =>
              valid(r) &&
              r.impressions >= MIN_IMPRESSIONS &&
              !NOSPACE.test(r.query) &&
              classify(r.query, brandName || "") === "other",
          )
          .map(r => ({ path, r, w: mainWords(r.query) })),
      )
      .filter(x => x.w.length)
      .sort((a, b) => b.r.impressions - a.r.impressions);
    // Each page's words are read once, against the searches' words only, and matched as same() matches them: a page
    // word holds a search word equal to it, one it starts with plus up to 3 letters, or one that starts with it plus up
    // to 3.
    const want = new Set(pairs.flatMap(x => x.w)),
      longer = new Map(),
      withWord = new Map(),
      push = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v);
    for (const s of want) for (let i = 1; i <= 3 && s.length - i >= 3; i++) push(longer, s.slice(0, -i), s);
    const held = side.map(p => {
      const h = new Set();
      for (const w of p.words.split(" ")) {
        if (want.has(w)) h.add(w);
        for (let i = 1; i <= 3 && w.length - i >= 3; i++) if (want.has(w.slice(0, -i))) h.add(w.slice(0, -i));
        for (const s of longer.get(w) || []) h.add(s);
      }
      return h;
    });
    held.forEach((h, i) => {
      for (const s of h) push(withWord, s, i);
    });
    const at = new Map(side.map((p, i) => [p.path, i])),
      enough = (n, w) => n >= (w.length >= 3 ? w.length - 1 : w.length); // covers()'s rule
    const unread = new Set(),
      spaceless = new Set(),
      pages = n => `${n} page${n === 1 ? "" : "s"}`;
    linkIdeas = [];
    queryGaps = [];
    for (const { path, r, w } of pairs) {
      const x = at.get(path),
        ev = { page: path, query: r.query, impressions: r.impressions, clicks: r.clicks ?? 0, position: r.position };
      if (x === undefined) {
        unread.add(path);
        continue;
      }
      const missing = w.filter(s => !held[x].has(s));
      if (side[x].nospace) spaceless.add(path);
      else if (!enough(w.length - missing.length, w)) queryGaps.push({ ...ev, missing });
      // One page to link to for each search; past MAX + 1 ideas, the rest aren't looked for (most impressions come
      // first).
      if (linkIdeas.length > MAX || top.get(r.query.toLowerCase())?.path !== path) continue;
      const count = new Map();
      for (const s of w) for (const a of withWord.get(s) || []) count.set(a, (count.get(a) || 0) + 1);
      // Pages holding every word first, then the crawl's order (roughly nearest the home page first).
      const from = [...count]
        .filter(([a, n]) => a !== x && enough(n, w) && !(Array.isArray(side[a].links) && side[a].links.includes(x)))
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, 3)
        .map(([a]) => side[a].path);
      if (from.length) linkIdeas.push({ ...ev, from });
    }
    if (linkIdeas.length > MAX) {
      notes.push(`Internal link ideas: only the ${MAX} with the most impressions are listed, and there are more.`);
      linkIdeas.length = MAX;
    }
    if (unread.size)
      notes.push(
        `${pages(unread.size)} with Search Console queries ${unread.size === 1 ? "isn't" : "aren't"} among the crawl's indexable pages (not reached, noindex, pointing elsewhere with a canonical, or built in the browser), so ${unread.size === 1 ? "it wasn't" : "they weren't"} checked for link ideas or searches ${unread.size === 1 ? "it doesn't" : "they don't"} mention.`,
      );
    if (spaceless.size)
      notes.push(
        `${pages(spaceless.size)} ${spaceless.size === 1 ? "is" : "are"} mostly in a script written without spaces between words, so which searches ${spaceless.size === 1 ? "it doesn't" : "they don't"} mention wasn't judged.`,
      );
  }

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
    linkIdeas: cap("Internal link ideas", linkIdeas),
    queryGaps: cap("Searches a page doesn't mention", queryGaps),
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
    "Queries with impressions, below page one, where no page's title or H1 holds the query's main words. Brand queries are left out.",
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
const LIMITS = `Searches with at least ${MIN_IMPRESSIONS} impressions on the page, brand searches left out. At most ${MAX}, most impressions first (our own limit).`;
// https://developers.google.com/search/docs/crawling-indexing/links-crawlable
const PAGE_GROUPS = /** @type {[string, string, string, string, (i: any) => string[]][]} */ ([
  [
    "linkIdeas",
    "Internal link ideas",
    `A page shows in Google for a search, and other pages mention that search in their title, H1 or main text but don't link to it. Google uses links to find pages and to judge what they're about, and a link's words tell people and Google what the page is. So a link from those pages, in a sentence about the search, could help. ${LIMITS} Up to 3 pages each (our own limit), those using every word first.`,
    "Pages that mention it but don't link to it",
    i => i.from,
  ],
  [
    "queryGaps",
    "Searches a page doesn't mention",
    `Searches a page shows in Google for, whose words its title, H1 and main text don't use. A page can't answer a search well if it never mentions it. A 2026 study of AI answers found that, within one site, pages whose title and paragraphs match the questions people ask get cited more (Chen and Koudas, a preprint, not yet peer reviewed). Add the words only where they fit what the page is about. ${LIMITS}`,
    "Words the page doesn't use",
    i => i.missing,
  ],
]);

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
  for (const [key, title, what, col, list] of PAGE_GROUPS) {
    L.push(`## ${title}`, "", what, "");
    const g = r[key];
    if (!g) {
      L.push("Not checked: the notes say why.", "");
      continue;
    }
    if (!g.length) {
      L.push("None.", "");
      continue;
    }
    L.push(
      `| Page | Search | Evidence | ${col} |`,
      "| --- | --- | --- | --- |",
      ...g.map(
        i =>
          `| ${md(i.page)} | ${md(i.query)} | ${n(i.impressions)} impressions on this page, ${n(i.clicks)} clicks, position ${i.position} | ${list(i).map(md).join(", ")} |`,
      ),
      "",
    );
  }
  L.push("## Notes", "", ...r.notes.map(x => `- ${md(x)}`), "");
  return L.join("\n");
}

function main(argv) {
  const args = parseArgs(argv, {
    flags: ["google", "gsc", "crawl", "brand", "extra", "out"],
    positionals: 0,
    usage: USAGE,
  });
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
  // Only pageWords' file name is used, so nothing outside the crawl's folder is read. keywordIdeas notes a missing
  // file.
  let words = null;
  if (typeof crawl?.pageWords?.file === "string")
    try {
      words = JSON.parse(readFileSync(join(dirname(resolve(args.crawl)), basename(crawl.pageWords.file)), "utf8"));
    } catch {
      /* noted */
    }
  const r = keywordIdeas({ search, crawl, brand: str("brand"), extra, words });
  const out = resolve(str("out") || "seo-audit/keyword-ideas.json"),
    mdOut = out.replace(/\.json$/i, "") + ".md";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(r, null, 2));
  writeFileSync(mdOut, ideasMarkdown(r));
  console.log(
    `keyword-ideas: ${r.almostThere.length} almost there, ${r.gaps ? `${r.gaps.length} with no page about them` : "pages not checked (no --crawl)"}, ${r.questions.length} questions, ${r.extra.length} from outside checks, ${r.linkIdeas ? `${r.linkIdeas.length} internal link ideas, ${r.queryGaps.length} searches a page doesn't mention` : "link ideas not checked (see the notes)"} · wrote ${out} and ${mdOut}`,
  );
  return 0;
}

if (isMain(import.meta.url)) await runMain(() => main(process.argv.slice(2)));
