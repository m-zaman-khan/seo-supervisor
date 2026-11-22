// @ts-check
// Fills data the audit JSON lacks from the result files the tools write beside it, so no panel depends on the audit
// copying them. Findings, passed rules, notChecked and notes are never read from here, so no file changes the score.
// - The audit wins: a group (the fields one panel reads) comes from the audit if it has any of them, never mixed.
// - A file for another site, or over 30 days older than the crawl, is skipped with a note.
// - An unreadable file gets a note; a missing one stays quiet, as the tool wasn't run.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isPublic } from "../lib/net.mjs";
import { fmtDate, obj } from "./format.mjs";

const STALE_DAYS = 30; // local threshold
// [file, what it is, groups]. A group lists the audit fields one panel reads; "to=from" is the file's `from` field read
// as the audit's `to`, and "to=*" the whole file.
const SOURCES = /** @type {[string, string, string[][]][]} */ ([
  [
    "seo-crawl.json",
    "the crawl",
    [
      ["speed", "labSpeed", "lighthouse", "media", "images"],
      ["trustSignals"],
      ["agents", "aiBots", "trainingOptOut", "contentUsage", "botPreferenceSync", "aiBotPaid", "landmarks"],
      ["writingNotes"],
      ["hstsPreload"],
      ["sections", "siteSize", "indexing"],
      ["templatedDescriptions", "keywordUse"],
      ["productFields"],
      ["renderSample", "renderedPage"],
      ["localBusiness"],
      ["linkedOnce", "linkStrength"],
      ["linksToOtherSites"],
      ["appLinks", "pdfLinks"],
      ["pages"],
    ],
  ],
  ["seo-diff.json", "the history check", [["diff=*"]]],
  [
    "google.json",
    "Google Search Console",
    [
      ["traffic", "trafficPeriod=period", "analytics"],
      ["trafficChange", "searchTypes", "byDevice", "byCountry", "anomalies", "positions"],
      ["queries"],
      ["brandSplit"],
      ["inspection"],
      ["siteTotals", "analyticsDetail"],
      ["newQueries"],
    ],
  ],
  [
    "keys.json",
    "your connected services",
    [["bing"], ["authority", "attribution"], ["moz"], ["youtube"], ["matomo"], ["posthog"], ["clarity"]],
  ],
  ["log-scan.json", "your server logs", [["logScan=*"]]],
  ["keyword-ideas.json", "keyword ideas", [["keywordIdeas=*"], ["linkIdeas"], ["queryGaps"]]],
  ["geo-grid.json", "the local rank grid", [["geoGrid=*"]]],
  ["ai-answers.json", "the AI answer check", [["aiAnswers=*"]]],
  ["change-check.json", "the change check", [["changeCheck=*"]]],
]);

// Where a file-supplied field came from. json is the whole file, for a panel that needs a companion field from it.
const FROM = Symbol("result files");
/** @param {any} raw @param {string} field */
export const fromFile = (raw, field) => raw?.[FROM]?.[field] ?? null;
/** "From your server logs (log-scan.json, 12 Nov 2026)." when a file supplied the field, else "". An undated file
 * says "file saved 12 Nov 2026" instead. @param {any} raw @param {string} field */
export const fromLine = (raw, field) => {
  const f = fromFile(raw, field);
  return f ? `From ${f.what} (${f.file}, ${fmtDate(f.date)}).` : "";
};

// The site a URL names, www or not; null for a local or missing address, which can't be compared.
const hostOf = u =>
  typeof u === "string" && isPublic(u) ? new URL(u).hostname.toLowerCase().replace(/^www\./, "") : null;
// log-scan.json falls back to the first address in its findings. Files that name no site are taken as this folder's;
// give them a `site` field if folders get shared between sites.
const siteOf = j => (typeof j.site === "string" ? j.site : (j.siteOrigin ?? j.findings?.[0]?.evidence?.[0]?.url));
const isDate = d => typeof d === "string" && !isNaN(Date.parse(d));

/**
 * notShown has a note for each file that had data but couldn't be used. Raw tool output (a crawl or content scan
 * rendered on its own) is returned as it is.
 * @param {any} raw the audit JSON
 * @param {string} dir the audit file's folder
 * @returns {{ raw: any, notShown: { what: string, why: string }[] }}
 */
export function loadSources(raw, dir) {
  if (raw.tool) return { raw, notShown: [] };
  const out = { ...raw },
    from = {},
    notShown = [];
  const site = hostOf(raw.site?.url ?? raw.siteOrigin),
    crawled = isDate(raw.run?.date) ? raw.run.date : null;
  for (const [file, what, groups] of SOURCES) {
    // Only the groups the audit has none of; a file that would add nothing isn't read.
    const want = groups.map(g => g.map(f => f.split("="))).filter(g => g.every(([to]) => raw[to] === undefined));
    if (!want.length) continue;
    const path = join(dir, file),
      note = why => notShown.push({ what: `${what[0].toUpperCase()}${what.slice(1)} (${file})`, why });
    let j, mtime;
    try {
      mtime = statSync(path).mtime;
      j = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT")
        note(
          `It couldn't be read (${e.code === "EISDIR" ? "it's a folder" : e.code || "it isn't valid JSON"}), so its data isn't shown. Run the tool again to rewrite it.`,
        );
      continue;
    }
    if (!obj(j) || Array.isArray(j)) {
      note(
        "It couldn't be read (it isn't one JSON object), so its data isn't shown. Run the tool again to rewrite it.",
      );
      continue;
    }
    // A file with nothing for the missing groups loses nothing, so it needs no note either.
    if (!want.some(g => g.some(([to, key = to]) => key === "*" || j[key] != null))) continue;
    const theirs = hostOf(siteOf(j));
    if (site && theirs && site !== theirs) {
      note(
        `It's for ${new URL(siteOf(j)).hostname}, and this audit is for ${new URL(raw.site?.url ?? raw.siteOrigin).hostname}, so its data isn't shown.`,
      );
      continue;
    }
    const date = [j.crawledAt, j.when, j.date].find(isDate) ?? mtime.toISOString();
    if (crawled && Date.parse(crawled) - Date.parse(date) > STALE_DAYS * 864e5) {
      note(
        `It's from ${fmtDate(date)}, more than ${STALE_DAYS} days before this audit's crawl (${fmtDate(crawled)}; our own line), so it's out of date and isn't shown. Run the tool again.`,
      );
      continue;
    }
    for (const g of want)
      for (const [to, key = to] of g) {
        const v = key === "*" ? j : j[key];
        if (v !== undefined) {
          out[to] = v;
          from[to] = { file, what, date, json: j };
        }
      }
  }
  return { raw: Object.assign(out, { [FROM]: { ...raw[FROM], ...from } }), notShown };
}
