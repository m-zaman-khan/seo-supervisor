#!/usr/bin/env node
// @ts-check
// Reads an unzipped Search Console Performance export, and the AI report exports, into traffic per page and findings.
// google.mjs builds the same output from the API and reuses addTraffic() and gscFindings().
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseCsv } from "./lib/csv.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain } from "./lib/cli.mjs";

// http/https and www variants of a page add up; position is weighted by impressions.
export function addTraffic(traffic, path, m) {
  const t = traffic[path];
  if (!t) {
    traffic[path] = m;
    return;
  }
  const clicks = t.clicks + m.clicks,
    impressions = t.impressions + m.impressions;
  traffic[path] = {
    clicks,
    impressions,
    ctr: impressions ? Math.round((clicks / impressions) * 10000) / 10000 : 0,
    position: impressions
      ? Math.round(((t.position * t.impressions + m.position * m.impressions) / impressions) * 10) / 10
      : m.position,
  };
}

// traffic and pageQueries are keyed by path; urls gives each path's full URL for the evidence.
export function gscFindings(traffic, pageQueries, urls) {
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
    for (const q of list)
      if (q.impressions >= 10 && path !== "/") (byQuery[q.query.toLowerCase()] ||= []).push([path, q]);
  const competing = Object.values(byQuery)
    .map(l => l.sort((a, b) => b[1].impressions - a[1].impressions))
    .filter(l => l.length > 1 && l[1][1].impressions >= 0.2 * l.reduce((n, [, q]) => n + q.impressions, 0))
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
  return findings;
}

// Search Console's AI export has the page column, then Impressions, with "~" and "-" downloaded as zeros. Bing doesn't
// document its columns, so the number is the column named like `metric`, else the first number column after the pages.
// https://support.google.com/webmasters/answer/16984139
const toCount = s => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d ? Number(d) : NaN;
};
function aiReport(rows, metric, host) {
  const cols = Object.keys(rows[0] || {}),
    isUrl = v => /^https?:\/\//i.test(v || "");
  const page = cols.find(c => rows.some(r => isUrl(r[c])));
  const value =
    cols.find(c => c !== page && new RegExp(metric, "i").test(c)) ||
    cols.slice(cols.indexOf(page) + 1).find(c => rows.every(r => !r[c] || !isNaN(toCount(r[c]))));
  if (!page || !value) return null;
  const pages = {};
  for (const r of rows) {
    let u;
    try {
      u = new URL(r[page]);
    } catch {
      continue;
    }
    const n = toCount(r[value]);
    if (n > 0 && (!host || u.hostname.replace(/^www\./, "") === host))
      pages[u.pathname + u.search] = { [metric]: (pages[u.pathname + u.search]?.[metric] || 0) + n };
  }
  const sorted = Object.entries(pages).sort((a, b) => b[1][metric] - a[1][metric]);
  return { [metric]: sorted.reduce((s, [, v]) => s + v[metric], 0), pages: Object.fromEntries(sorted) };
}

// --site is the other scripts' name for --site-origin.
function main(argv) {
  const args = parseArgs(argv, {
    flags: ["pages", "queries", "page-queries", "site-origin", "out", "ai-google", "ai-bing"],
    aliases: { site: "site-origin" },
    positionals: 0,
  });
  const AI = [
    ["ai-google", "google", "impressions", "Search Console Generative AI performance", "then Impressions"],
    ["ai-bing", "bing", "citations", "Bing Webmaster Tools AI Performance", "and a Citations column"],
  ].filter(([flag]) => typeof args[flag] === "string");
  if (typeof args.pages !== "string" && !AI.length)
    throw new Fail(
      "usage: node gsc-import.mjs --pages Pages.csv [--queries Queries.csv] [--page-queries dir/] [--site-origin https://x] [--out seo-audit/gsc.json]\n       node gsc-import.mjs --ai-google Pages.csv [--ai-bing ai-pages.csv] [--site-origin https://x] [--out seo-audit/ai-reports.json]",
    );
  const OUT = resolve(
    typeof args.out === "string"
      ? args.out
      : typeof args.pages === "string"
        ? "seo-audit/gsc.json"
        : "seo-audit/ai-reports.json",
  );
  let host = null;
  if (typeof args["site-origin"] === "string")
    try {
      host = new URL(args["site-origin"]).hostname.replace(/^www\./, "");
    } catch {
      throw new Fail(
        `gsc-import: --site-origin must be the site's address, like https://www.example.com (got ${args["site-origin"]}).`,
      );
    }
  const aiReports = AI.length
    ? Object.fromEntries(
        AI.map(([flag, id, metric, what, cols]) => {
          const r = aiReport(parseCsv(readFileSync(args[flag], "utf8")), metric, host);
          if (!r)
            throw new Fail(
              `gsc-import: ${args[flag]} isn't a ${what} export of pages. Expected a column of page addresses ${cols}, as the report's download writes them.`,
            );
          return [id, r];
        }),
      )
    : null;
  if (typeof args.pages !== "string") {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ source: "ai-reports", aiReports }, null, 2));
    console.log(
      `gsc-import: AI reports for ${Object.values(aiReports)
        .map(r => Object.keys(r.pages).length)
        .join(" and ")} pages · wrote ${OUT}`,
    );
    return 0;
  }

  // Search Console writes the dimension, Clicks, Impressions, CTR and Position in that order in every UI language,
  // so columns are read by position. Counts drop every separator ("10.000", "1 234"); CTR and position take
  // "," or "." as the decimal mark ("5,1 %" -> 5.1).
  const count = s => {
    const d = String(s ?? "").replace(/\D/g, "");
    return d ? Number(d) : NaN;
  };
  const decimal = s => {
    s = String(s ?? "").replace(/[\s %]/g, "");
    const i = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
    return Number(i < 0 ? s : s.slice(0, i).replace(/[.,]/g, "") + "." + s.slice(i + 1));
  };
  const metrics = v => ({
    clicks: count(v[1]),
    impressions: count(v[2]),
    ctr: Math.round(decimal(v[3]) * 100) / 10000,
    position: decimal(v[4]),
  });
  const rowsOf = file => parseCsv(readFileSync(file, "utf8")).map(r => Object.values(r));
  const notExport = (file, what) => {
    throw new Fail(
      `gsc-import: ${file} isn't a Search Console ${what} export. Expected ${what === "Pages" ? "a URL" : "a query"}, then Clicks, Impressions, CTR and Position, comma-separated, as Search Console's "Export → Download CSV" writes them.`,
    );
  };
  const pathOf = u => {
    try {
      const x = new URL(u);
      return host && x.hostname.replace(/^www\./, "") !== host ? null : x.pathname + x.search;
    } catch {
      return null;
    }
  };
  // Filters.csv: rows of (filter, value) in the UI's language; the page filter's value is a URL.
  const filters = file => (existsSync(file) ? rowsOf(file) : []);
  const periodOf = rows => rows.find(v => /dat|fecha|p[ée]riod/i.test(v[0] || ""))?.[1] ?? null;

  const traffic = {},
    urls = {};
  const pageRows = rowsOf(args.pages);
  if (
    !pageRows.length ||
    pageRows.some(v => v.length < 5 || !/^https?:\/\//i.test(v[0]) || isNaN(count(v[1])) || isNaN(count(v[2])))
  )
    notExport(args.pages, "Pages");
  for (const v of pageRows) {
    const path = pathOf(v[0]);
    if (!path) continue;
    urls[path] ||= v[0];
    addTraffic(traffic, path, metrics(v));
  }
  const queryRows = typeof args.queries === "string" ? rowsOf(args.queries) : [];
  if (queryRows.some(v => v.length < 5 || isNaN(count(v[2])))) notExport(args.queries, "Queries");
  const queries = queryRows.map(v => ({ query: v[0], ...metrics(v) }));
  const period = periodOf(filters(join(dirname(resolve(args.pages)), "Filters.csv")));

  // Per-page exports: each folder's Filters.csv names the page its Queries.csv belongs to.
  const pageQueries = {};
  if (typeof args["page-queries"] === "string") {
    for (const d of readdirSync(args["page-queries"])) {
      const dir = join(args["page-queries"], d);
      if (!statSync(dir).isDirectory() || !existsSync(join(dir, "Queries.csv"))) continue;
      const page = filters(join(dir, "Filters.csv")).find(v => /^https?:\/\//i.test(v[1] || ""))?.[1] || "",
        path = pathOf(page);
      if (path) urls[path] ||= page;
      if (path)
        pageQueries[path] = rowsOf(join(dir, "Queries.csv"))
          .filter(v => v.length >= 5)
          .map(v => ({ query: v[0], ...metrics(v) }));
    }
  }

  const findings = gscFindings(traffic, pageQueries, urls);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      { source: "search-console", period, traffic, queries, pageQueries, findings, ...(aiReports && { aiReports }) },
      null,
      2,
    ),
  );
  console.log(
    `gsc-import: ${Object.keys(traffic).length} pages, ${queries.length} queries, ${Object.keys(pageQueries).length} per-page exports, ${findings.length} findings · wrote ${OUT}`,
  );
  return 0;
}

if (isMain(import.meta.url)) await runMain(() => main(process.argv.slice(2)));
