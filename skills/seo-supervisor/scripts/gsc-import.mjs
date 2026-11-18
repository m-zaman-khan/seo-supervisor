#!/usr/bin/env node
// Reads an unzipped Search Console Performance export into traffic per page and findings.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseCsv } from "./lib/csv.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, "");
  args[k] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
if (typeof args.pages !== "string") {
  console.error(
    "usage: node gsc-import.mjs --pages Pages.csv [--queries Queries.csv] [--page-queries dir/] [--site-origin https://x] [--out seo-audit/gsc.json]",
  );
  process.exit(2);
}
const OUT = resolve(typeof args.out === "string" ? args.out : "seo-audit/gsc.json");
const host =
  typeof args["site-origin"] === "string" ? new URL(args["site-origin"]).hostname.replace(/^www\./, "") : null;

// Exports may use a decimal comma: "4,5%" reads as 4.5 and "1,234" as 1234.
const number = s => {
  s = String(s ?? "")
    .trim()
    .replace(/%$/, "");
  s = /,\d{1,2}$/.test(s) && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, "");
  return Number(s);
};
const metrics = r => ({
  clicks: number(r.Clicks),
  impressions: number(r.Impressions),
  ctr: Math.round(number(r.CTR) * 100) / 10000,
  position: number(r.Position),
});
const firstCol = r => r[Object.keys(r)[0]];
const pathOf = u => {
  try {
    const x = new URL(u);
    return host && x.hostname.replace(/^www\./, "") !== host ? null : x.pathname + x.search;
  } catch {
    return null;
  }
};
const filter = (file, name) =>
  existsSync(file)
    ? (parseCsv(readFileSync(file, "utf8")).find(r => (r.Filter || "").toLowerCase().startsWith(name))?.Value ?? null)
    : null;

const traffic = {},
  urls = {};
for (const r of parseCsv(readFileSync(args.pages, "utf8"))) {
  const url = firstCol(r),
    path = pathOf(url);
  if (!path) continue;
  traffic[path] = metrics(r);
  urls[path] = url;
}
const queries =
  typeof args.queries === "string"
    ? parseCsv(readFileSync(args.queries, "utf8")).map(r => ({ query: firstCol(r), ...metrics(r) }))
    : [];
const period = filter(join(dirname(resolve(args.pages)), "Filters.csv"), "date");

// Per-page exports: each folder's Filters.csv names the page its Queries.csv belongs to.
const pageQueries = {};
if (typeof args["page-queries"] === "string") {
  for (const d of readdirSync(args["page-queries"])) {
    const dir = join(args["page-queries"], d);
    if (!statSync(dir).isDirectory() || !existsSync(join(dir, "Queries.csv"))) continue;
    const page = filter(join(dir, "Filters.csv"), "page") || "",
      path = pathOf(page);
    if (path) urls[path] ||= page;
    if (path)
      pageQueries[path] = parseCsv(readFileSync(join(dir, "Queries.csv"), "utf8")).map(r => ({
        query: firstCol(r),
        ...metrics(r),
      }));
  }
}

// ---------- findings ----------
const findings = [];
const fmtN = n => n.toLocaleString("en-US"),
  pct = x => `${Math.round(x * 1000) / 10}%`;
const finding = (check, rule, severity, title, why, fix, evidence) => {
  if (!evidence.length) return;
  const ex = evidence[0];
  findings.push({
    check,
    rule,
    severity,
    category: "Search intent",
    title,
    what: `${evidence.length === 1 ? "Found on" : `${evidence.length} cases, for example`} ${ex.url} (${ex.detail}).`,
    why,
    fix,
    count: evidence.length,
    evidence,
    source: "search-console",
    status: "open",
  });
};
// Low CTR: under half the median CTR of pages at a similar position (needs 3+ such pages to compare against).
const bucket = p => (p < 4 ? "1-3" : p < 8 ? "4-7" : p <= 10 ? "8-10" : p <= 20 ? "11-20" : "21+");
const groups = {};
for (const [path, t] of Object.entries(traffic))
  if (t.impressions >= 100) (groups[bucket(t.position)] ||= []).push([path, t]);
const median = xs => {
  const s = [...xs].sort((a, b) => a - b),
    m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const lowCtr = [];
for (const list of Object.values(groups)) {
  if (list.length < 3) continue;
  const med = median(list.map(([, t]) => t.ctr));
  for (const [path, t] of list)
    if (t.ctr < med / 2)
      lowCtr.push({
        url: urls[path],
        detail: `CTR ${pct(t.ctr)} at position ${t.position}, similar pages ${pct(med)}, ${fmtN(t.impressions)} impressions`,
      });
}
finding(
  "low-ctr",
  "INTENT-03",
  "low",
  `${lowCtr.length} page(s) get far fewer clicks than similar pages at the same position`,
  "Search Console shows these pages appearing often but rarely clicked: half the click rate or less of the site's other pages at a similar position. The title and description usually decide that click.",
  "Rewrite the title and meta description to match what people searching want, using the page's top queries. Keep them accurate.",
  lowCtr,
);
const nearTop = Object.entries(traffic)
  .filter(([, t]) => t.position >= 8 && t.position <= 20 && t.impressions >= 50)
  .sort((a, b) => b[1].impressions - a[1].impressions)
  .map(([path, t]) => ({ url: urls[path], detail: `position ${t.position}, ${fmtN(t.impressions)} impressions` }));
finding(
  "almost-page-one",
  "INTENT-04",
  "low",
  `${nearTop.length} page(s) rank just below the top results (position 8–20)`,
  "These pages already get impressions and sit at the bottom of page one or on page two, where a small improvement brings them into view.",
  "Work on these first: match the main query's intent, strengthen the content and add internal links from related pages.",
  nearTop,
);
// Competing pages (per-page exports only): two or more pages each with a real share of one query's impressions.
// The home page is left out (it shows for brand queries by design), and so is the long tail (under 10 impressions).
const byQuery = {};
for (const [path, list] of Object.entries(pageQueries))
  for (const q of list) if (q.impressions > 0) (byQuery[q.query.toLowerCase()] ||= []).push([path, q]);
const competing = Object.values(byQuery)
  .filter(l => l.length > 1)
  .map(l => ({
    url: urls[l[0][0]],
    detail: `“${l[0][1].query}”: ${l.map(([p, q]) => `${p} (${fmtN(q.impressions)} impressions, position ${q.position})`).join(" · ")}`,
  }));
finding(
  "query-competition",
  "INTENT-02",
  "medium",
  `${competing.length} quer${competing.length === 1 ? "y has" : "ies have"} two or more of the site's pages competing`,
  "Search Console shows several of the site's pages getting impressions for the same query, so they split clicks and links and none ranks as well as one page would.",
  "Pick one page per query and make it the clear answer. Link the others to it, and merge or refocus pages that cover the same thing.",
  competing,
);
findings.forEach((f, i) => {
  f.id = "G-" + String(i + 1).padStart(3, "0");
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({ source: "search-console", period, traffic, queries, pageQueries, findings }, null, 2),
);
console.log(
  `gsc-import: ${Object.keys(traffic).length} pages, ${queries.length} queries, ${Object.keys(pageQueries).length} per-page exports, ${findings.length} findings · wrote ${OUT}`,
);
