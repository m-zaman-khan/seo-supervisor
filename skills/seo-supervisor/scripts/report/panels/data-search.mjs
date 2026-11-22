// @ts-check
// Search & AI panels from the tools' results. Each returns a view model, or null with nothing to show; report/panel.mjs
// escapes the text from logs, Search Console and the crawl.
import { fmtDate, num, obj, plural, isCount, isText, notePath } from "../format.mjs";
import { fromLine, periodOf, sameSource } from "../sources.mjs";

const arr = x => (Array.isArray(x) ? x.filter(obj) : []);
const fin = Number.isFinite;
const pct = (was, now) =>
  was > 0 ? `${now >= was ? "+" : "−"}${Math.abs(Math.round((100 * (now - was)) / was))}%` : "";
const MD_MAX = 50; // Markdown rows, a local cap (the page shows 10)

// logScan is log-scan.json whole. User agents can be spoofed, so every count is "requests claiming to be". Only 404s
// the site doesn't link to show here, as linked ones are findings. Kinds are data/ai-bots.json's groups.
const KIND = { search: "Search", "ai-search": "AI search or answers", "ai-training": "AI training", other: "Other" };
export function logsPanel({ raw }) {
  const l = obj(raw.logScan);
  if (!l) return null;
  const bots = Object.entries(obj(l.bots) || {})
    .filter(([, b]) => obj(b) && isCount(b.requests) && b.requests > 0)
    .sort((a, b) => b[1].requests - a[1].requests);
  const ai = Object.entries(obj(l.aiReferrals) || {})
    .filter(([, r]) => obj(r) && isCount(r.visits) && r.visits > 0)
    .sort((a, b) => b[1].visits - a[1].visits);
  const g = obj(l.googleReferrals),
    google = g && isCount(g.visits) && g.visits > 0 ? g : null;
  const lost = arr(l.repeated404s).filter(r => isText(r.path) && isCount(r.requests));
  if (!bots.length && !ai.length && !google && !lost.length) return null;
  const tops = list =>
    arr(list)
      .filter(p => isText(p.path) && isCount(p.visits))
      .slice(0, 3)
      .flatMap((p, i) => [i ? ", " : "", { code: p.path }, ` ${num(p.visits)}`]);
  const ip = b =>
    obj(b.ipCheck) && isCount(b.ipCheck.verified)
      ? `${num(b.ipCheck.verified)} from ${b.vendor || "the vendor"}'s addresses`
      : "";
  const p = obj(l.period),
    when =
      p && [p.from, p.to].every(d => typeof d === "string" && d)
        ? ` Logs from ${fmtDate(p.from)} to ${fmtDate(p.to)}.`
        : "";
  return {
    tab: "search-ai",
    cls: "logs",
    title: "Server logs",
    blocks: [
      {
        p: `${fromLine(raw, "logScan")}${when} User agents can be spoofed, so each count is requests claiming to be that bot. Information only: none of this changes the score.`.trim(),
      },
      bots.length && {
        head: ["Bot", "Vendor", "Kind", "Requests", "Paths"],
        align: ["---", "---", "---", "---:", "---:"],
        cap: 10,
        rows: bots
          .slice(0, MD_MAX)
          .map(([name, b]) => [
            { code: name },
            String(b.vendor ?? ""),
            KIND[b.group] || String(b.group ?? ""),
            `${num(b.requests)}${ip(b) ? ` (${ip(b)})` : ""}`,
            isCount(b.paths) ? num(b.paths) : "",
          ]),
      },
      ai.length && {
        sub: "Visits referred by AI assistants",
        heading: "Visits referred by AI assistants",
        blocks: [
          {
            rows: ai.map(([s, r]) => [
              { code: s },
              [
                `${plural(r.visits, "visit")}`,
                ...(tops(r.topPages).length ? [" · top pages: ", ...tops(r.topPages)] : []),
              ],
            ]),
          },
        ],
      },
      google && {
        sub: "Visits referred by Google Search",
        heading: "Visits referred by Google Search",
        blocks: [
          {
            p: [
              `${plural(google.visits, "visit")} with a Google Search referrer`,
              ...(tops(google.topPages).length ? [" · top pages: ", ...tops(google.topPages)] : []),
              ". Browsers and apps often drop the referrer, so Search Console's clicks are the real number.",
            ],
          },
        ],
      },
      lost.length && {
        sub: "URLs that keep answering 404 to search crawlers",
        heading: "URLs that keep answering 404 to search crawlers",
        blocks: [
          {
            p: "The site doesn't link to these. A 404 is right for a removed page; if one moved, 301 it to its new home.",
          },
          {
            rows: lost.slice(0, MD_MAX).map(r => {
              const who = Array.isArray(r.bots) ? r.bots.filter(isText) : [];
              return [
                { code: r.path },
                `${plural(r.requests, "request")}${who.length ? ` from ${who.join(", ")}` : ""}`,
              ];
            }),
            cap: 10,
          },
        ],
      },
    ],
  };
}

// The brand trend needs `previous`, Google's brand label for the period before, set only when Google labelled all of
// it. The current split alone is already a search line.
const side = x => (obj(x) && fin(x.clicks) && fin(x.impressions) ? x : null);
export function brandTrendPanel({ raw }) {
  const b = obj(raw.brandSplit),
    was = obj(b?.previous);
  if (!side(b?.branded) || !side(b?.nonBranded) || !side(was?.branded) || !side(was?.nonBranded)) return null;
  const period = periodOf(raw, "brandSplit");
  const row = (label, x) => [
    label,
    num(x.branded.clicks),
    num(x.branded.impressions),
    num(x.nonBranded.clicks),
    num(x.nonBranded.impressions),
  ];
  const move = k =>
    `${num(was[k].clicks)} → ${num(b[k].clicks)} clicks${pct(was[k].clicks, b[k].clicks) ? ` (${pct(was[k].clicks, b[k].clicks)})` : ""}`;
  return {
    tab: "search-ai",
    cls: "brandtrend",
    title: "Brand and other searches over time",
    blocks: [
      {
        p: `${fromLine(raw, "brandSplit")} Brand searches, as Google labels them: ${move("branded")}; other searches: ${move("nonBranded")}. Growth that comes only from people who already know the brand isn't new reach. Information only.`.trim(),
      },
      {
        head: ["Period", "Brand clicks", "Brand impressions", "Other clicks", "Other impressions"],
        align: ["---", "---:", "---:", "---:", "---:"],
        rows: [
          row(isText(was.from) && isText(was.to) ? `${was.from} to ${was.to}` : "The period before", was),
          row(isText(period) ? period : "This period", b),
        ],
      },
    ],
  };
}

// Pages and period come from the same source as the queries, else the pages' own source. Searches are third-party
// text, escaped.
export function topSearchesPanel({ raw }) {
  const of = raw.queries === undefined ? "traffic" : "queries",
    traffic = obj(sameSource(raw, of, "traffic")),
    period = periodOf(raw, of);
  const byClicks = (a, b) => b.clicks - a.clicks || b.impressions - a.impressions;
  const searches = arr(raw.queries)
    .filter(q => isText(q.query) && fin(q.clicks) && fin(q.impressions))
    .sort(byClicks);
  const pages = Object.entries(traffic || {})
    .filter(([, t]) => obj(t) && fin(t.clicks) && fin(t.impressions))
    .map(([path, t]) => ({ path, ...t }))
    .sort(byClicks);
  if (!searches.length && !pages.length) return null;
  return {
    tab: "search-ai",
    cls: "topsearches",
    title: "Top searches and pages",
    blocks: [
      {
        p: `${fromLine(raw, of)}${isText(period) ? ` Google Search, ${period.charAt(0).toLowerCase()}${period.slice(1)}.` : ""} Google hides searches very few people make, so the searches add up to fewer clicks than the pages. Information only.`.trim(),
      },
      searches.length && {
        sub: "What people search to find you",
        heading: "What people search to find you",
        blocks: [
          {
            head: ["Search", "Clicks", "Impressions", "Position"],
            align: ["---", "---:", "---:", "---:"],
            cap: 10,
            rows: searches
              .slice(0, MD_MAX)
              .map(q => [q.query, num(q.clicks), num(q.impressions), fin(q.position) ? String(q.position) : ""]),
          },
        ],
      },
      pages.length && {
        sub: "Pages with the most clicks",
        heading: "Pages with the most clicks",
        blocks: [
          {
            head: ["Page", "Clicks", "Impressions"],
            align: ["---", "---:", "---:"],
            cap: 10,
            rows: pages.slice(0, MD_MAX).map(t => [{ code: t.path }, num(t.clicks), num(t.impressions)]),
          },
        ],
      },
    ],
  };
}

// keywordIdeas is keyword-ideas.json whole; its link ideas and missing searches have their own panels. Phrases come
// from Search Console and pages from the crawl, so both are escaped.
const IDEAS = [
  [
    "almostThere",
    "Almost there",
    "Searches at position 8 to 20 with impressions: a small improvement can bring them onto page one.",
  ],
  [
    "gaps",
    "Shown for, but no page is about it",
    "Searches below page one where no page's title or H1 holds the search's main words. A new page or a section could answer them.",
  ],
  ["questions", "Questions people search", "Each could be an FAQ entry or a section on the page that fits best."],
];
export function keywordIdeasPanel({ raw }) {
  const k = obj(raw.keywordIdeas);
  const groups = IDEAS.map(
    ([key, title, what]) =>
      /** @type {[string, string, any[]]} */ ([title, what, arr(k?.[key]).filter(i => isText(i.phrase))]),
  ).filter(([, , list]) => list.length);
  if (!groups.length) return null;
  const ev = e =>
    obj(e) && fin(e.impressions)
      ? [
          `${plural(e.impressions, "impression")}${fin(e.position) ? `, position ${e.position}` : ""}`,
          ...(isText(e.page) ? [", shows ", { code: e.page }] : []),
        ]
      : "";
  return {
    tab: "search-ai",
    cls: "keywordideas",
    title: "Keyword ideas",
    blocks: [
      {
        p: `${fromLine(raw, "keywordIdeas")} From Search Console. You pick which ideas become targets. There are no search volumes: those need paid data, and none are guessed. Information only.`.trim(),
      },
      ...groups.map(([title, what, list]) => ({
        sub: `${title} (${num(list.length)})`,
        heading: title,
        blocks: [{ p: what }, { rows: list.slice(0, MD_MAX).map(i => [i.phrase, ev(i.evidence), ": "]), cap: 10 }],
      })),
    ],
  };
}

// URL Inspection verdicts as Google defines them; coverageState is Google's own text.
// https://developers.google.com/webmaster-tools/v1/urlInspection.index/UrlInspectionResult
const VERDICT = {
  PASS: "Valid",
  FAIL: "Error",
  NEUTRAL: "Excluded",
  PARTIAL: "Partial",
  VERDICT_UNSPECIFIED: "Unknown",
};
export function indexVerdictPanel({ raw }) {
  const pages = arr(raw.inspection).filter(i => isText(i.url));
  if (!pages.length) return null;
  const n = {};
  for (const i of pages) n[VERDICT[i.verdict] || "Unknown"] = (n[VERDICT[i.verdict] || "Unknown"] || 0) + 1;
  const count = Object.entries(n)
    .map(([v, k]) => `${num(k)} ${v.toLowerCase()}`)
    .join(" · ");
  return {
    tab: "search-ai",
    cls: "indexverdict",
    title: "Google's index verdict on key pages",
    blocks: [
      {
        p: `${fromLine(raw, "inspection")} Search Console's URL Inspection, for ${plural(pages.length, "page")}: ${count}. Pages Google hasn't indexed are also findings. Information only.`.trim(),
      },
      {
        head: ["Page", "Verdict", "Google says", "Last crawled"],
        align: ["---", "---", "---", "---"],
        cap: 10,
        rows: pages.map(i => [
          { code: notePath(i.url) },
          VERDICT[i.verdict] || "Unknown",
          [
            String(i.coverageState ?? ""),
            isText(i.googleCanonical) && isText(i.userCanonical) && i.googleCanonical !== i.userCanonical
              ? `; Google chose ${notePath(i.googleCanonical)} as the canonical`
              : "",
          ],
          isText(i.lastCrawlTime) ? fmtDate(i.lastCrawlTime) : "",
        ]),
      },
    ],
  };
}
