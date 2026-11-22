#!/usr/bin/env node
// @ts-check
// Google ranking updates, and optionally Search Central blog posts, that overlap a period. Dates only: it never says an
// update caused a traffic change.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain, warnProxy } from "./lib/cli.mjs";

// The Search Status Dashboard's history, in Google Cloud's status format.
export const FEED = "https://status.search.google.com/incidents.json";
// The feed holds the last 365 days only (its history pages go back further, as HTML), so an older period gets a note.
const FEED_DAYS = 365;
const ymd = t => {
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
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

// RSS 2.0 holding only the latest 10 posts, hence the note on older periods.
const BLOG = "https://developers.google.com/search/blog/feed.xml";
const XML_ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = s =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) =>
      e[0] === "#"
        ? (n => (n <= 0x10ffff ? String.fromCodePoint(n) : m))(
            e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1),
          )
        : (XML_ENT[e] ?? m),
    )
    .trim(); // code points past U+10FFFF stay as written
const tag = (item, name) => unxml(item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "");
// Event posts (Search Central Live and its Deep Dives) are left out by title; every other post counts.
const EVENT = /\bSearch Central Live\b|\bDeep Dive\b/i;
const feedPosts = xml =>
  [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map(m => ({ title: tag(m[1], "title"), date: ymd(tag(m[1], "pubDate")), url: tag(m[1], "link") }))
    .filter(p => p.title && p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
/** Blog posts dated from..to (inclusive), events left out, oldest first. */
export const blogPosts = (xml, { from, to }) =>
  feedPosts(xml).filter(p => p.date >= from && p.date <= to && !EVENT.test(p.title));

/** @type {(msg: string, code?: number) => never} */
const fail = (msg, code = 2) => {
  throw new Fail("google-updates: " + msg, code);
};

const USAGE =
  "usage: node google-updates.mjs [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--since YYYY-MM-DD] [--out seo-audit/google-updates.json] [--endpoint url] [--blog [url]] [--yes]";
async function main(argv) {
  const args = parseArgs(argv, {
    flags: ["from", "to", "since", "out", "endpoint", "blog"],
    booleans: ["yes"],
    positionals: 0,
    usage: USAGE,
  });
  // A date, or the date part of a timestamp; "2026-02-30" isn't one.
  const day = k => {
    if (args[k] == null) return null;
    const s = String(args[k]).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || ymd(s + "T00:00:00Z") !== s)
      fail(`--${k} needs a date as YYYY-MM-DD (got ${args[k]}).`);
    return s;
  };
  const today = ymd(Date.now()),
    back = n => ymd(Date.now() - n * 864e5);
  const to = day("to") || today,
    from = day("from") || day("since") || back(90);
  if (from > to) fail(`the period starts (${from}) after it ends (${to}); the start must come before the end.`);
  // --endpoint, GOOGLE_STATUS_ENDPOINT and a URL after --blog point at the tests' feeds.
  const feed = typeof args.endpoint === "string" ? args.endpoint : process.env.GOOGLE_STATUS_ENDPOINT || FEED;
  const OUT = resolve(typeof args.out === "string" ? args.out : "seo-audit/google-updates.json");
  const blog = args.blog ? (typeof args.blog === "string" ? args.blog : BLOG) : null;

  if (!args.yes) {
    console.log(
      `google-updates: dry run, nothing fetched. With --yes it reads ${feed} (Google's public status feed: one plain GET, nothing about your site is sent)${blog ? ` and ${blog} (the Google Search Central blog's feed, the same way)` : ""} and lists Google's ranking updates${blog ? " and blog posts" : ""} from ${from} to ${to} in ${OUT}.`,
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
    fail(`couldn't reach ${feed} (${e.cause?.code || e.message}). Nothing was written.`, 1);
  }
  if (!r.ok) fail(`${feed} returned ${r.status}. Nothing was written.`, 1);
  try {
    list = await r.json();
  } catch {}
  if (!Array.isArray(list)) fail(`${feed} isn't the list of incidents it used to be. Nothing was written.`, 1);
  // Google announces several ranking updates a year, so a year of incidents with none marked Ranking means the labels
  // changed, not a quiet year. Writing an empty list would make the report say none were announced.
  if (list.length && !list.some(isRanking))
    fail(
      `none of the ${list.length} incidents in ${feed} is marked Ranking, so the feed's format may have changed. Nothing was written.`,
      1,
    );

  const updates = rankingUpdates(list, { from, to, feed });
  const notes =
    from < back(FEED_DAYS)
      ? [`Google's feed covers the last 12 months, so updates before ${back(FEED_DAYS)} aren't listed.`]
      : [];
  // The blog is extra: when its feed fails, the ranking updates are still written, with a note instead of posts.
  let posts = null;
  if (blog) {
    let xml = null,
      why;
    try {
      const b = await fetch(blog, {
        headers: { "user-agent": "seo-supervisor-google-updates" },
        signal: AbortSignal.timeout(20000),
      });
      if (b.ok) xml = await b.text();
      else why = `returned ${b.status}`;
    } catch (e) {
      why = `couldn't be reached (${e.cause?.code || e.message})`;
    }
    const all = xml == null ? [] : feedPosts(xml);
    if (xml != null && !all.length) why = "had no posts in the format it used to have";
    if (why) notes.push(`Google's Search Central blog's feed ${why}, so its posts aren't listed.`);
    else {
      posts = blogPosts(xml, { from, to });
      const oldest = all[0].date,
        day = new Date(oldest + "T00:00:00Z").toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        });
      if (oldest > from)
        notes.push(
          `The Search Central blog's feed holds its latest posts only, back to ${day}, so earlier posts aren't listed.`,
        );
    }
  }
  const note = notes.join(" ") || null;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      { googleUpdates: { from, to, updates, ...(posts ? { posts } : {}), ...(note ? { note } : {}) } },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `google-updates: ${updates.length} Google ranking update${updates.length === 1 ? "" : "s"} from ${from} to ${to}${updates.length ? ":" : "."}`,
  );
  for (const u of updates) console.log(`  ${u.name}: ${u.start}${u.end ? ` to ${u.end}` : ", still rolling out"}`);
  if (posts)
    console.log(
      `google-updates: ${posts.length} Search Central blog post${posts.length === 1 ? "" : "s"} in the period${posts.length ? ":" : "."}`,
    );
  for (const p of posts || []) console.log(`  ${p.date}: ${p.title}`);
  if (note) console.log("note: " + note);
  console.log("wrote " + OUT);
  return 0;
}

if (isMain(import.meta.url)) {
  warnProxy(); // once, before any request
  await runMain(() => main(process.argv.slice(2)));
}
