// @ts-check
// Shared by the Matomo and PostHog reads: the period, the row cap, the top-10 splits and visits by path.
import { Refused } from "./http.mjs";
import { periodOf } from "../google/search-console.mjs";

export const ROWS = 25000; // the most pages read from Matomo or PostHog, as google.mjs reads from Google Analytics
// The same days google.mjs reads Google Analytics for, ending 3 days ago, so the numbers line up.
export const periodFor = days => {
  const p = periodOf(days);
  return { from: p.startDate, to: p.endDate };
};
// [name, visits] pairs to { name: { visits } } for the top 10; a pair without a name or visits is dropped.
const top10 = pairs => {
  const m = new Map();
  for (const [k, v] of pairs) if (typeof k === "string" && k && Number(v) > 0) m.set(k, (m.get(k) || 0) + Number(v));
  return Object.fromEntries(
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, visits]) => [k, { visits }]),
  );
};
const SPLIT_NAME = {
  byDevice: "visits from search engines by device",
  byCountry: "visits from search engines by country",
  byChannel: "visits by channel",
  byEngine: "visits from search engines by search engine",
  byReferrer: "visits by referrer",
  daily: "visits from search engines per day",
};
// A split that fails is noted; the visits by landing page stay. once: one read that isn't a top 10 (the daily trend).
export async function splits(name, fields, read, notes) {
  const out = {};
  for (const [field, what] of Object.entries(fields)) {
    try {
      out[field] = top10(await read(what, field));
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      notes.push(`${name}'s ${SPLIT_NAME[field]} weren't read: ${e.message}`);
    }
  }
  return out;
}
export async function once(name, field, fn, notes) {
  try {
    return { [field]: await fn() };
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    notes.push(`${name}'s ${SPLIT_NAME[field]} weren't read: ${e.message}`);
    return {};
  }
}
// One page's http/https, www/apex and tracking-parameter variants add up, by path as GA4's landing page is.
export const addVisits = (map, path, n) => {
  map[path] = { visits: (map[path]?.visits || 0) + n };
};
export const tooMany = name =>
  `${name} has ${ROWS.toLocaleString("en-US")} or more pages with visits from search engines for this period; only the top ${ROWS.toLocaleString("en-US")} were read.`;
