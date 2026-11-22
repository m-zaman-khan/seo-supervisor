// @ts-check
// Read-only Search Console access with the saved sign-in. It loads only session.mjs, none of the sign-in flow
// (browser, local server, prompts).
import { SC, SCOPES, Fail, Refused, fail, session, whoOf, explain } from "./session.mjs";

export { Fail, Refused };
export const SC_API = { name: "Google Search Console API", where: "Search Console → Settings → Users and permissions" };
// Logging problems Google lists, so a change they caused isn't read as real. type limits one to that search type.
// Add new ones from the same page.
const DISCOVER_LOSS = "Discover clicks and impressions were under-counted";
const ANOMALIES = [
  {
    from: "2025-05-13",
    to: "2026-04-27",
    what: "impressions weren't counted accurately, so CTR and average position were off too (clicks weren't affected)",
  },
  { from: "2026-05-07", to: "2026-05-08", type: "discover", what: DISCOVER_LOSS },
  { from: "2026-05-21", to: "2026-05-21", type: "discover", what: DISCOVER_LOSS },
  { from: "2026-06-24", to: "2026-06-24", type: "discover", what: DISCOVER_LOSS },
  { from: "2026-08-13", to: "2026-08-13", type: "discover", what: DISCOVER_LOSS },
].map(a => ({ ...a, url: "https://support.google.com/webmasters/answer/6211453" }));
export const anomaliesIn = (from, to, type) => ANOMALIES.filter(a => a.type === type && a.from <= to && a.to >= from);
// Shared by fetch, change-check and deploy-check. span names the dates read, e.g. "the dates compared".
export const anomalyNote = (a, span) =>
  `Google's "Data anomalies in Search Console" page says that ${a.from === a.to ? `on ${a.from}` : `from ${a.from} to ${a.to}`} ${a.what}. This overlaps ${span}, so a change in those numbers may not be real: ${a.url}`;

export const httpUrl = (u, what, eg) => {
  let x;
  try {
    x = new URL(u);
  } catch {}
  if (!x || !/^https?:$/.test(x.protocol)) fail(`google: ${what}, like ${eg} (got ${u}).`);
  return x;
};

// Wraps a refused call as Refused with plain words; a Fail (no usable sign-in) passes through.
export const refused = (e, words) => (e instanceof Fail ? e : new Refused(words));

// The property: a domain property covering the host, else the longest URL-prefix property the site sits under.
export async function pickProperty(g, origin, who) {
  let sites;
  try {
    sites = ((await g.call(`${g.E.searchConsole}/sites`)).siteEntry || []).filter(
      x => x.permissionLevel !== "siteUnverifiedUser",
    );
  } catch (e) {
    throw refused(e, explain(e, "the list of Search Console properties", SC_API, who));
  }
  const h = origin.hostname,
    href = origin.origin + origin.pathname;
  const prop = (
    sites.find(
      x => x.siteUrl.startsWith("sc-domain:") && (h === x.siteUrl.slice(10) || h.endsWith("." + x.siteUrl.slice(10))),
    ) || sites.filter(x => href.startsWith(x.siteUrl)).sort((a, b) => b.siteUrl.length - a.siteUrl.length)[0]
  )?.siteUrl;
  if (!prop)
    throw new Refused(
      `${origin.origin} isn't in the Search Console properties this account can see (${sites.map(x => x.siteUrl).join(", ") || "it can't see any"}). Add and verify the site in Search Console, or connect with the Google account that has it.`,
    );
  return prop;
}
// A Search Console address as a path on the site's host, else null. www and apex count as one host, as in gsc-import.
// Tracking parameters are dropped so the row counts for the page itself; other parameters stay as written.
export const bare = x => x.replace(/^www\./, "");
export const pagePath = (u, host) => {
  try {
    const x = new URL(u);
    return bare(x.hostname) === bare(host) ? x.pathname + x.search : null;
  } catch {
    return null;
  }
};
// Fails early when Search Console access wasn't granted at sign-in.
export function scSession(opts) {
  const g = session(opts),
    s = g.store(),
    scope = s.scope || SCOPES.join(" ");
  if (!scope.includes(SC))
    fail(
      "google: Search Console access wasn't granted when you signed in. Run node google.mjs connect again and leave the Search Console box ticked.",
    );
  return { g, scope, who: whoOf(s) };
}
// The site's property and a Search Analytics query on it for other scripts, with token renewal and plain errors.
/** @param {{ site?: string, home?: string, endpoints?: any }} [opts] */
export async function searchConsole({ site, home, endpoints } = {}) {
  const origin = httpUrl(site, "--site must be the site's address", "https://www.example.com");
  const { g, who } = scSession({ home, endpoints }),
    prop = await pickProperty(g, origin, who);
  return {
    origin,
    prop,
    query: body => g.call(`${g.E.searchConsole}/sites/${encodeURIComponent(prop)}/searchAnalytics/query`, body),
    explain: e => explain(e, `${prop} in Search Console`, SC_API, who),
  };
}
// ---------- periods and rows ----------
// Search Console keeps the last 2-3 days provisional, so a period ends 3 days ago. The period before has the same
// length. Dates are UTC days.
export const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
export const lastFinal = () => daysAgo(3);
export const periodOf = days => ({ endDate: lastFinal(), startDate: daysAgo(days + 2) });
export const periodBefore = days => ({ startDate: daysAgo(2 * days + 2), endDate: daysAgo(days + 3) });
// Validates --days the same way in every script. who is the script's name.
/** @param {unknown} v @param {string} who */
export const daysOf = (v, who, min = 1, max = 480, why = "Search Console keeps 16 months") => {
  const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max
    ? n
    : fail(
        `${who}: --days must be a whole number from ${min} to ${max} (got ${v === true ? "no number" : v}). ${why}.`,
      );
};
// The top 25,000 Search Analytics rows at most, pageSize per request. sa(body) queries the current period; dates
// replace it for the period before. A list cut at 25,000 is noted under label.
export async function readRows(
  sa,
  dimensions,
  dates = {},
  pageSize = 25000,
  notes = [],
  label = dates.startDate ? "the period before" : "this period",
) {
  const rows = [];
  while (rows.length < 25000) {
    const rowLimit = Math.min(pageSize, 25000 - rows.length),
      got = (await sa({ ...dates, dimensions, rowLimit, startRow: rows.length })).rows || [];
    rows.push(...got);
    if (got.length < rowLimit) break;
  }
  if (rows.length >= 25000)
    notes.push(
      `Search Console has 25,000 or more ${{ page: "pages", query: "queries" }[dimensions.join()] || "page and query pairs"} for ${label}; only the top 25,000 were read, so the least-searched ones are left out.`,
    );
  return rows;
}

// A domain property covers its subdomains; a URL-prefix property only addresses that start with it.
export const inProperty = (prop, u) => {
  const d = prop.startsWith("sc-domain:") && prop.slice(10);
  return d ? u.hostname === d || u.hostname.endsWith("." + d) : u.href.startsWith(prop);
};
