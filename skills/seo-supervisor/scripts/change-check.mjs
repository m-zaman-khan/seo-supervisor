#!/usr/bin/env node
// @ts-check
// Whether pages changed on a date gained or lost Search clicks and impressions, against similar unchanged pages.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { proxyNote } from "./lib/proxy.mjs";
import { Fail, anomaliesIn, pagePath, searchConsole } from "./google/search-console.mjs";
import { changedPages } from "./seo-diff.mjs";

// Local thresholds, not Google's. MIN_DAYS keeps every weekday in each window; MIN_TRAFFIC is the changed pages' clicks
// (or impressions) over both windows. MAX_ROWS is Search Console's per-request row limit.
const DAYS = 28,
  MIN_DAYS = 7,
  MIN_CONTROLS = 10,
  MIN_TRAFFIC = 30,
  ROUNDS = 2000,
  MAX_ROWS = 25000;
const METHOD =
  "Each page's change is log((after + 1) / (before + 1)). The result is the changed pages' average change minus the similar unchanged pages' average, shown as a percentage. The likely range is a 90% range: the spread of single pages around their group's average is resampled 2,000 times with a fixed seed, so the same numbers always give the same answer. These are our own rules.";
const fail = msg => {
  throw new Fail(`change-check: ${msg}`);
};
const shift = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const ago = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const s = n => (n === 1 ? "" : "s");

// pages are URLs or paths; pageSize is smaller only in tests.
/** @param {{ site?: string, date?: string, pages?: string[], days?: number | string, home?: string, endpoints?: any, pageSize?: number }} [opts] */
export async function changeCheck({ site, date, pages = [], days = DAYS, home, endpoints, pageSize = MAX_ROWS } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || isNaN(Date.parse(date)) || shift(date, 0) !== date)
    fail(`--date must be the day the pages changed, like 2026-10-01 (got ${date}).`);
  days = Number(days);
  if (!Number.isInteger(days) || days < MIN_DAYS)
    fail(
      `--days must be a whole number, ${MIN_DAYS} or more (got ${days}). ${MIN_DAYS} is our own minimum, so each window holds every day of the week.`,
    );
  // The change day itself is in neither window.
  const before = { from: shift(date, -days), to: shift(date, -1) },
    after = { from: shift(date, 1), to: shift(date, days) };
  // Search Console's last 2-3 days are provisional, so the after window must end at least 3 days ago.
  const wait = Math.round((Date.parse(after.to) - Date.parse(ago(3))) / 864e5);
  if (wait > 0)
    fail(
      `the ${days} days after the change end on ${after.to}, and Search Console's numbers for the last 3 days aren't final yet. Wait ${wait} more day${s(wait)} and run it again (on ${ago(-wait)} or later), or pass a smaller --days. Nothing was read from Google.`,
    );
  if (before.from < ago(482))
    fail(
      `Search Console keeps 16 months of data, so the ${days} days before ${date} aren't all there any more. Pass a smaller --days. Nothing was read from Google.`,
    );
  const listed = [...new Set(pages.map(p => String(p).trim()).filter(p => p && !p.startsWith("#")))];
  if (!listed.length)
    fail(
      "no changed pages were given. Pass --pages <file> (one URL or path per line) or --from-diff seo-audit/seo-diff.json.",
    );

  const sc = await searchConsole({ site, home, endpoints }),
    host = sc.origin.hostname,
    notes = [];
  // Keyed by pagePath, like the Search Console rows: www and the bare domain are one page.
  const changed = new Set(),
    off = [];
  for (const u of listed) {
    let p = null;
    try {
      const x = new URL(u, sc.origin);
      if (/^https?:$/.test(x.protocol)) p = pagePath(x.href, host);
    } catch {}
    if (p) changed.add(p);
    else off.push(u);
  }
  if (!changed.size)
    fail(
      `none of the pages listed are on ${host} (www and the bare domain count as one), so there's nothing to compare. Check --site and the list.`,
    );
  if (off.length)
    notes.push(
      `${off.length} of the pages listed ${off.length === 1 ? "isn't" : "aren't"} on ${host} (www and the bare domain count as one), so ${off.length === 1 ? "it was" : "they were"} left out: ${off.slice(0, 10).join(", ")}${off.length > 10 ? ` and ${off.length - 10} more` : ""}.`,
    );

  // Web search totals by path for one window, the top 25,000 pages at most.
  const read = async ({ from, to }) => {
    const out = {};
    for (let n = 0; ;) {
      const rowLimit = Math.min(pageSize, MAX_ROWS - n);
      let rows;
      try {
        rows =
          (await sc.query({ startDate: from, endDate: to, type: "web", dimensions: ["page"], rowLimit, startRow: n }))
            .rows || [];
      } catch (e) {
        fail(sc.explain(e));
      }
      for (const r of rows) {
        const p = pagePath(r.keys?.[0], host);
        if (p) {
          const t = (out[p] ||= { clicks: 0, impressions: 0 });
          t.clicks += Number(r.clicks) || 0;
          t.impressions += Number(r.impressions) || 0;
        }
      }
      n += rows.length;
      if (rows.length < rowLimit) break;
      if (n >= MAX_ROWS) {
        notes.push(
          `Search Console has 25,000 or more pages for ${from} to ${to}; only the top 25,000 were read, so pages with the fewest clicks may count as having none.`,
        );
        break;
      }
    }
    return out;
  };
  const b = await read(before),
    a = await read(after),
    none = { clicks: 0, impressions: 0 };
  const rec = p => ({ path: p, before: b[p], after: a[p] || none });
  // A page Search Console didn't show before the change (new, or not in Google's results) has no past to compare with.
  const noPast = [...changed].filter(p => !b[p]).sort(),
    c = [...changed]
      .filter(p => b[p])
      .sort()
      .map(rec);
  if (noPast.length)
    notes.push(
      `${noPast.length} changed page${s(noPast.length)} had no Google Search data in the ${days} days before the change (new pages, or pages Google didn't show), so ${noPast.length === 1 ? "it was" : "they were"} left out: ${noPast.slice(0, 10).join(", ")}${noPast.length > 10 ? ` and ${noPast.length - 10} more` : ""}.`,
    );
  // Google doesn't announce its smaller core updates, so a site-wide move could pass for the change's effect; unchanged
  // pages over the same dates cancel it out. https://developers.google.com/search/docs/appearance/core-updates
  // Control group (a local rule): unlisted pages with half the changed pages' fewest to twice their most clicks before.
  const lo = Math.ceil(Math.min(...c.map(x => x.before.clicks)) / 2),
    hi = Math.max(...c.map(x => x.before.clicks)) * 2;
  const k = c.length
    ? Object.keys(b)
        .filter(p => !changed.has(p) && b[p].clicks >= lo && b[p].clicks <= hi)
        .sort()
        .map(rec)
    : [];
  const sum = (list, w, key) => list.reduce((t, x) => t + x[w][key], 0);
  const totals = list =>
    Object.fromEntries(
      ["clicks", "impressions"].map(key => [key, { before: sum(list, "before", key), after: sum(list, "after", key) }]),
    );

  const estimate = key => {
    const traffic = sum(c, "before", key) + sum(c, "after", key);
    const reason = !c.length
      ? `none of the changed pages had Google Search data in the ${days} days before the change`
      : k.length < MIN_CONTROLS
        ? `too few comparable pages: ${k.length} unchanged page${s(k.length)} had similar clicks before the change, and the check needs at least ${MIN_CONTROLS} (our own minimum)`
        : traffic < MIN_TRAFFIC
          ? `too little traffic: the changed pages had ${traffic} ${key} over both periods, and the check needs at least ${MIN_TRAFFIC} (our own minimum)`
          : null;
    if (reason) return { verdict: "inconclusive", reason };
    const change = x => Math.log((x.after[key] + 1) / (x.before[key] + 1)),
      mean = v => v.reduce((t, y) => t + y, 0) / v.length;
    const cv = c.map(change),
      kv = k.map(change),
      mc = mean(cv),
      mk = mean(kv),
      effect = mc - mk;
    // Pool each page's distance from its group's mean (a lone changed page adds nothing), then resample groups of the
    // same sizes: their difference shows how far apart two groups land with no real change. A seeded 32-bit LCG keeps
    // the range repeatable.
    const pool = [...(cv.length > 1 ? cv.map(y => y - mc) : []), ...kv.map(y => y - mk)];
    let seed = 1;
    const draw = n => {
      let t = 0;
      for (let i = 0; i < n; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        t += pool[Math.floor((seed / 2 ** 32) * pool.length)];
      }
      return t / n;
    };
    const noise = Array.from({ length: ROUNDS }, () => draw(cv.length) - draw(kv.length)).sort((x, y) => x - y);
    const pct = x => Math.round((Math.exp(x) - 1) * 100),
      percent = pct(effect);
    const low = pct(effect - noise[Math.round(0.95 * (ROUNDS - 1))]),
      high = pct(effect - noise[Math.round(0.05 * (ROUNDS - 1))]);
    return {
      verdict: low > 0 ? "likely up" : high < 0 ? "likely down" : "inconclusive",
      percent,
      low,
      high,
      ...(low > 0 || high < 0 ? {} : { reason: "the likely range includes no change" }),
    };
  };
  const clicks = estimate("clicks"),
    impressions = estimate("impressions");

  // Google's documented logging problems in the dates compared (web search only).
  for (const x of anomaliesIn(before.from, after.to))
    notes.push(
      `Google's "Data anomalies in Search Console" page says that ${x.from === x.to ? `on ${x.from}` : `from ${x.from} to ${x.to}`} ${x.what}. This overlaps the dates compared, so those numbers may not be comparable: ${x.url}`,
    );
  return {
    source: "change-check",
    site: sc.origin.origin,
    property: sc.prop,
    changeDate: date,
    days,
    windows: { before, after },
    groups: {
      changed: { pages: c.length, paths: c.map(x => x.path), ...totals(c) },
      control: {
        pages: k.length,
        rule: c.length
          ? `pages not in the list with ${lo} to ${hi} clicks in the ${days} days before the change: half the changed pages' fewest to twice their most (our own rule)`
          : "none: no changed page had data before the change",
        ...totals(k),
      },
    },
    verdict: clicks.verdict,
    clicks,
    impressions,
    method: METHOD,
    notes,
  };
}

// "likely up, about +18% compared with the similar unchanged pages (likely range +5% to +33%)", or why it can't say.
const signed = p => `${p > 0 ? "+" : p < 0 ? "-" : ""}${Math.abs(p)}%`;
const said = m =>
  m.percent == null
    ? `inconclusive, ${m.reason}`
    : `${m.verdict}, about ${signed(m.percent)} compared with the similar unchanged pages (likely range ${signed(m.low)} to ${signed(m.high)}${m.verdict === "inconclusive" ? ", which includes no change" : ""})`;

const str = v => (typeof v === "string" ? v : null);
const USAGE =
  "usage: node change-check.mjs --site https://www.example.com --date YYYY-MM-DD (--pages changed.txt | --from-diff seo-audit/seo-diff.json) [--days 28] [--out seo-audit/change-check.json]";
async function main(args) {
  if (!str(args.site) || !str(args.date) || !(str(args.pages) || str(args["from-diff"]))) throw new Fail(USAGE);
  const read = f => {
    try {
      return readFileSync(f, "utf8");
    } catch (e) {
      fail(`can't read ${f} (${e.code || e.message}).`);
    }
  };
  const pages = str(args.pages) ? read(args.pages).split(/\r?\n/) : [];
  if (str(args["from-diff"]))
    try {
      pages.push(...changedPages(JSON.parse(read(args["from-diff"]))));
    } catch (e) {
      if (e instanceof Fail) throw e;
      fail(`${args["from-diff"]} isn't a seo-diff.json (run seo-diff.mjs first).`);
    }
  const r = await changeCheck({ site: args.site, date: args.date, days: str(args.days) || DAYS, pages });
  const out = resolve(str(args.out) || "seo-audit/change-check.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(r, null, 2));
  const { changed, control } = r.groups;
  console.log(
    [
      `change-check: ${changed.pages} changed page${s(changed.pages)} against ${control.pages} similar unchanged page${s(control.pages)} in ${r.property}, ${r.days} days before and after ${r.changeDate} (${r.windows.before.from} to ${r.windows.before.to}, then ${r.windows.after.from} to ${r.windows.after.to}).`,
      `Clicks: ${said(r.clicks)}.`,
      `Impressions: ${said(r.impressions)}.`,
      `This shows what happened to the numbers, not why. Wrote ${out}`,
      ...r.notes.map(n => "note: " + n),
    ].join("\n"),
  );
  return 0;
}

if (isMain(import.meta.url)) {
  const note = proxyNote();
  if (note) console.error("note: " + note);
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i].replace(/^--/, "");
    args[k] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  }
  // Exit by setting the code, not process.exit(): exiting while fetch's sockets close crashes Node on Windows.
  process.exitCode = await main(args).then(null, e => {
    if (!(e instanceof Fail) && e.code !== "SEO_SETTINGS") throw e;
    console.error(e.message);
    return 2;
  });
}
