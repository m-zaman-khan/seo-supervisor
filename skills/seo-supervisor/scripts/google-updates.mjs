#!/usr/bin/env node
// Google ranking updates that overlap a period, from the Search Status Dashboard's history (Google Cloud's status
// format). Dates only: it never says an update caused a traffic change.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { proxyNote } from "./lib/proxy.mjs";

// The Search Status Dashboard's history, in Google Cloud's status format.
export const FEED = "https://status.search.google.com/incidents.json";
// The feed holds the last 365 days only (its history pages go back further, as HTML), so an older period gets a note.
const FEED_DAYS = 365;
const ymd = t => {
  const d = new Date(t);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

const isRanking = i =>
  i?.service_name === "Ranking" ||
  (Array.isArray(i?.affected_products) && i.affected_products.some(p => p?.title === "Ranking"));

/** Ranking incidents whose rollout overlaps from..to (inclusive dates), oldest first. */
export function rankingUpdates(incidents, { from, to, feed = FEED }) {
  return incidents
    .filter(isRanking)
    .map(i => ({
      name: String(i.external_desc || "").trim(),
      start: ymd(i.begin),
      end: i.end ? ymd(i.end) : null,
      url: i.id ? new URL(`incidents/${encodeURIComponent(i.id)}`, feed).href : null,
    }))
    .filter(u => u.name && u.start && u.start <= to && (u.end ?? "9999-12-31") >= from)
    .sort((a, b) => a.start.localeCompare(b.start));
}

class Fail extends Error {
  constructor(msg, code = 2) {
    super("google-updates: " + msg);
    this.code = code;
  }
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i].replace(/^--/, "");
    args[k] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  }
  // A date, or the date part of a timestamp; "2026-02-30" isn't one.
  const day = k => {
    if (args[k] == null) return null;
    const s = String(args[k]).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || ymd(s + "T00:00:00Z") !== s)
      throw new Fail(`--${k} needs a date as YYYY-MM-DD (got ${args[k]}).`);
    return s;
  };
  const today = ymd(Date.now()),
    back = n => ymd(Date.now() - n * 864e5);
  const to = day("to") || today,
    from = day("from") || day("since") || back(90);
  if (from > to)
    throw new Fail(`the period starts (${from}) after it ends (${to}); the start must come before the end.`);
  // --endpoint, GOOGLE_STATUS_ENDPOINT and a URL after --blog point at the tests' feeds.
  const feed = typeof args.endpoint === "string" ? args.endpoint : process.env.GOOGLE_STATUS_ENDPOINT || FEED;
  const OUT = resolve(typeof args.out === "string" ? args.out : "seo-audit/google-updates.json");

  if (args.yes !== true) {
    console.log(
      `google-updates: dry run, nothing fetched. With --yes it reads ${feed} (Google's public status feed: one plain GET, nothing about your site is sent) and lists Google's ranking updates from ${from} to ${to} in ${OUT}.`,
    );
    return 0;
  }
  let r, list;
  try {
    r = await fetch(feed, {
      headers: { "user-agent": "seo-supervisor-google-updates" },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Fail(`couldn't reach ${feed} (${e.cause?.code || e.message}). Nothing was written.`, 1);
  }
  if (!r.ok) throw new Fail(`${feed} returned ${r.status}. Nothing was written.`, 1);
  try {
    list = await r.json();
  } catch {}
  if (!Array.isArray(list))
    throw new Fail(`${feed} isn't the list of incidents it used to be. Nothing was written.`, 1);
  // Google announces several ranking updates a year, so a year of incidents with none marked Ranking means the labels
  // changed, not a quiet year. Writing an empty list would make the report say none were announced.
  if (list.length && !list.some(isRanking))
    throw new Fail(
      `none of the ${list.length} incidents in ${feed} is marked Ranking, so the feed's format may have changed. Nothing was written.`,
      1,
    );

  const updates = rankingUpdates(list, { from, to, feed });
  const note =
    from < back(FEED_DAYS)
      ? `Google's feed covers the last 12 months, so updates before ${back(FEED_DAYS)} aren't listed.`
      : null;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({ googleUpdates: { from, to, updates, ...(note ? { note } : {}) } }, null, 2) + "\n",
  );
  console.log(
    `google-updates: ${updates.length} Google ranking update${updates.length === 1 ? "" : "s"} from ${from} to ${to}${updates.length ? ":" : "."}`,
  );
  for (const u of updates) console.log(`  ${u.name}: ${u.start}${u.end ? ` to ${u.end}` : ", still rolling out"}`);
  if (note) console.log("note: " + note);
  console.log("wrote " + OUT);
  return 0;
}

// Not process.exit(): exiting while fetch's sockets close crashes Node on Windows.
if (isMain(import.meta.url)) {
  {
    const n = proxyNote();
    if (n) console.error("note: " + n);
  } // once, before any request is sent
  process.exitCode = await main().catch(e => {
    if (!(e instanceof Fail)) throw e;
    console.error(e.message);
    return e.code;
  });
}
