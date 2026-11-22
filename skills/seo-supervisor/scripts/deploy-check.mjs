#!/usr/bin/env node
// @ts-check
// Fast post-deploy check for CI: exits 1 on anything that keeps search engines out, 2 on bad usage.
import { lookup as dnsLookup } from "node:dns";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain, warnProxy } from "./lib/cli.mjs";
import { isPublic, pinnedGet } from "./lib/net.mjs";
import { tlsCert } from "./checks/tls.mjs";
import { allowedBy, groupFor, groupOf, parseRobots } from "./lib/robots.mjs";
import { VERSION } from "./update-check.mjs";
import { anomaliesIn, anomalyNote, searchConsole } from "./google/search-console.mjs";

const UA = "seo-supervisor-deploy-check/" + VERSION,
  TIMEOUT = 10000,
  DAY = 864e5;

// Redirects are followed by hand, 5 at most. Off the site's origin the address must be public, and pinnedGet connects
// only to the address it checked, so a name can't pass the check and then resolve elsewhere (DNS rebinding).
async function load(url, origin, { fetchFn, lookup }) {
  let hops = 0;
  try {
    for (; hops <= 5; hops++) {
      if (new URL(url).origin !== origin) {
        if (!isPublic(url))
          return { error: `${new URL(url).host} isn't a public address, so it wasn't visited`, url, hops };
        let asked = 0;
        const got = await pinnedGet(url, {
          headers: { "user-agent": UA },
          dns: lookup,
          timeout: TIMEOUT,
          hops: 5 - hops,
          allow: u => (asked++, isPublic(u)),
          read: (r, u) => ({ res: asResponse(r), url: u }),
        });
        return got.reason
          ? { error: got.reason.replace(/^couldn't connect \((\w+)\)$/, (m, c) => (WHY[c] ? why(c) : m)), url, hops }
          : { ...got, hops: hops + asked - 1 };
      }
      const res = await fetchFn(url, {
        redirect: "manual",
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const loc = res.status >= 300 && res.status < 400 && res.headers.get("location");
      if (!loc) return { res, url, hops };
      await res.body?.cancel();
      url = new URL(loc, url).href;
    }
    return { error: "it redirects more than 5 times", url, hops };
  } catch (e) {
    return {
      error:
        e.name === "TimeoutError"
          ? `no answer within ${TIMEOUT / 1000} seconds`
          : why(e.cause?.code) || e.cause?.message || e.message,
      url,
      hops,
    };
  }
}
// pinnedGet's answer, shaped like the parts of a fetch() Response the checks read.
const asResponse = r => ({
  status: r.statusCode,
  headers: {
    get: k => {
      const v = r.headers[k.toLowerCase()];
      return v == null ? null : [v].flat().join(", ");
    },
  },
  text: async () => {
    let s = "";
    r.setEncoding("utf8");
    for await (const c of r) s += c;
    return s;
  },
  body: {
    cancel: async () => {
      r.destroy();
    },
  },
});
const WHY = {
  ECONNREFUSED: "the server refused the connection",
  ECONNRESET: "the connection was dropped",
  ETIMEDOUT: "the connection timed out",
  ENOTFOUND: "the name isn't in DNS",
  EAI_AGAIN: "DNS didn't answer",
  CERT_HAS_EXPIRED: "the certificate has expired",
};
const why = code => code && (WHY[code] ? `${WHY[code]} (${code})` : code);

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};
const tags = (html, el) => html.match(new RegExp(`<${el}\\b[^>]*>`, "gi")) || [];
// noindex, or none (which includes it). Another crawler's directive, and max-image-preview's "none" value, aren't
// Google's noindex. https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
// Known limit: a directive after another crawler's name ("otherbot: nofollow, noindex") reads as everyone's. Carry the
// crawler name across the list, as backlinks.mjs pageNofollow does, if that matters.
function noindexOf(html, header) {
  const meta = tags(html, "meta")
    .filter(t => /^(robots|googlebot)$/i.test(attr(t, "name") || ""))
    .find(t => (attr(t, "content") || "").split(",").some(d => /^(noindex|none)$/i.test(d.trim())));
  if (meta) return `a meta tag says ${meta}`;
  const h = (header || "")
    .split(",")
    .map(d => d.trim())
    .find(d => {
      const m = /^(?:([a-z][\w-]*)\s*:\s*)?(noindex|none)$/i.exec(d);
      return m && (!m[1] || /^googlebot$/i.test(m[1]));
    });
  return h ? `the X-Robots-Tag header says ${h}` : null;
}

/** The checks, in order, each { id, state: "ok" | "warning" | "blocker" | "skipped", text }.
 * @param {string} site
 * @param {{ fetchFn?: typeof fetch, connect?: typeof tlsCert, lookup?: any, now?: number }} [options] */
export async function deployCheck(
  site,
  { fetchFn = fetch, connect = tlsCert, lookup = dnsLookup, now = Date.now() } = {},
) {
  const t0 = Date.now(),
    origin = new URL(site).origin,
    o = { fetchFn, lookup },
    checks = [];
  const put = (id, state, text) => checks.push({ id, state, text });
  const https = origin.startsWith("https:"),
    host = new URL(origin).hostname,
    port = Number(new URL(origin).port) || 443;
  const [home, robots, cert] = await Promise.all([
    load(origin + "/", origin, o).then(async r => ({
      ...r,
      body: r.res?.status === 200 ? await r.res.text().catch(() => "") : (await r.res?.body?.cancel(), ""),
    })),
    load(origin + "/robots.txt", origin, o).then(async r => ({
      ...r,
      body: r.res?.status === 200 ? await r.res.text().catch(() => "") : (await r.res?.body?.cancel(), ""),
    })),
    https
      ? connect(host, port, TIMEOUT).then(
          c => ({ c, error: null }),
          e => ({ c: null, error: why(e.code) || e.message }),
        )
      : null,
  ]);
  const via = home.hops ? ` after ${home.hops === 1 ? "a redirect" : `${home.hops} redirects`} to ${home.url}` : "";
  const homeOk = home.res?.status === 200;
  if (home.error) put("home", "blocker", `The home page didn't answer: ${home.error}.`);
  else put("home", homeOk ? "ok" : "blocker", `The home page answers ${home.res.status}${via}.`);
  if (!homeOk) put("noindex", "skipped", "The home page didn't load, so its robots rules weren't read.");
  else {
    const n = noindexOf(home.body, home.res.headers.get("x-robots-tag"));
    put(
      "noindex",
      n ? "blocker" : "ok",
      n
        ? `The home page is noindex: ${n}. Search engines drop it, and often the whole site follows.`
        : "The home page isn't noindex.",
    );
  }
  // Google halts crawling the whole site while robots.txt answers 5xx or 429, and reads a 4xx as no rules. Right after
  // a deploy that halt is immediate, so it's a blocker.
  // https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
  const rs = robots.res?.status,
    txt = rs === 200 && !/<html/i.test(robots.body) ? robots.body : null;
  // Googlebot obeys only its own group, or `User-agent: *` when it has none.
  const rules = txt != null ? parseRobots(txt) : null,
    ownGoogle = rules && groupFor(rules, "googlebot");
  if (robots.error || rs >= 500 || rs === 429)
    put(
      "robots",
      "blocker",
      `robots.txt ${robots.error ? `didn't answer: ${robots.error}` : `answers ${rs}`}. Google stops crawling the whole site while it fails.`,
    );
  else if (!rules)
    put(
      "robots",
      "warning",
      `robots.txt ${rs === 200 ? "is an HTML page, not a robots.txt file" : `answers ${rs}`}, so Google reads it as no rules: nothing is blocked, and no sitemap is listed there.`,
    );
  else if (!allowedBy(groupOf(rules, "googlebot"), "/"))
    put(
      "robots",
      "blocker",
      ownGoogle
        ? "robots.txt blocks Googlebot from the whole site (its own User-agent: Googlebot group)."
        : "robots.txt blocks every crawler without a group of its own (User-agent: *) from the whole site, Googlebot included.",
    );
  else if (!allowedBy(groupFor(rules, "*"), "/"))
    put(
      "robots",
      "warning",
      "robots.txt blocks every crawler without a group of its own (User-agent: *) from the whole site. Googlebot has its own group that lets it in, but Bing and other search engines without a group are kept out.",
    );
  else put("robots", "ok", "robots.txt doesn't block the home page.");
  if (!rules?.sitemaps.length)
    put(
      "sitemap",
      "warning",
      rules ? "robots.txt lists no sitemap (no Sitemap: line)." : "No sitemap could be read from robots.txt.",
    );
  else {
    const list = rules.sitemaps.slice(0, 5),
      got = await Promise.all(
        list.map(u => {
          try {
            return load(new URL(u).href, origin, o).then(async r => (await r.res?.body?.cancel(), r));
          } catch {
            return { error: "it isn't a valid URL", url: u, hops: [] };
          }
        }),
      );
    const bad = got.map((r, i) => [list[i], r]).filter(([, r]) => r.res?.status !== 200);
    put(
      "sitemap",
      bad.length ? "warning" : "ok",
      bad.length
        ? `The sitemap ${bad.map(([u, r]) => `${u} ${r.error ? `wasn't reached: ${r.error}` : `answers ${r.res.status}`}`).join("; ")}.`
        : `robots.txt lists ${list.length === 1 ? "the sitemap" : `${list.length} sitemaps`}, and ${list.length === 1 ? "it answers" : "each answers"} 200.`,
    );
  }
  if (!homeOk) put("canonical", "skipped", "The home page didn't load, so its canonical wasn't read.");
  else {
    const hrefs = tags(home.body, "link")
      .filter(t => (attr(t, "rel") || "").toLowerCase().split(/\s+/).includes("canonical"))
      .map(t => attr(t, "href") || "");
    const self = new URL(home.url);
    self.hash = "";
    const to =
      hrefs.length === 1
        ? (() => {
            try {
              const x = new URL(hrefs[0], home.url);
              x.hash = "";
              return x.href;
            } catch {
              return hrefs[0];
            }
          })()
        : null;
    if (!hrefs.length) put("canonical", "warning", "The home page has no canonical tag.");
    else if (hrefs.length > 1)
      put(
        "canonical",
        "warning",
        `The home page has ${hrefs.length} canonical tags, so search engines ignore them all.`,
      );
    else
      put(
        "canonical",
        to === self.href ? "ok" : "warning",
        to === self.href
          ? "The home page's canonical points to itself."
          : `The home page's canonical points to ${to}, not to itself (${self.href}).`,
      );
  }
  // Same thresholds as checks/tls.mjs checkLive. Under a third of its lifetime and under 30 days left usually means
  // automatic renewal stopped.
  if (!cert) put("certificate", "skipped", "The site isn't on https://, so there's no certificate to check.");
  else if (!cert.c) put("certificate", "warning", `The certificate couldn't be read: ${cert.error}.`);
  else {
    const c = cert.c,
      to = Date.parse(c.valid_to),
      from = Date.parse(c.valid_from),
      left = to - now,
      days = Math.floor(left / DAY);
    if (!c.authorized && c.authorizationError !== "CERT_HAS_EXPIRED")
      put(
        "certificate",
        "blocker",
        `The certificate isn't trusted (${c.authorizationError || "not trusted"}). Browsers show a full-page warning.`,
      );
    else if (left < 2 * DAY)
      put(
        "certificate",
        "blocker",
        left < 0
          ? `The certificate expired on ${c.valid_to}.`
          : `The certificate expires within 2 days (${c.valid_to}). Renew it now.`,
      );
    else if (left < Math.min(isNaN(from) ? Infinity : (to - from) / 3, 30 * DAY))
      put(
        "certificate",
        "warning",
        `The certificate has ${days} days left (until ${c.valid_to}). Automatic renewal may have stopped.`,
      );
    else put("certificate", "ok", `The certificate has ${days} days left (until ${c.valid_to}).`);
  }
  const count = s => checks.filter(c => c.state === s).length;
  return {
    site: origin,
    checkedAt: new Date(now).toISOString(),
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    blockers: count("blocker"),
    warnings: count("warning"),
    checks,
  };
}

// ---------- --search-console: Google Search clicks hour by hour ----------
// Local thresholds: warn at a 30% fall in clicks, judged only with 100+ clicks a week before; with fewer, an ordinary
// slow hour looks like a fall.
const HOUR = 36e5,
  WEEK = 7 * DAY,
  DROP = 30,
  MIN_CLICKS = 100;
// Search Analytics takes dates, and returns hours, in Pacific Time.
// https://developers.google.com/webmaster-tools/v1/searchanalytics/query
const ptDate = t => new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); // YYYY-MM-DD
const utc = t => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const iso = t => new Date(t).toISOString();
const pct = (a, b) => (b ? Math.round((a / b - 1) * 100) : null);
const pc = p => (p == null ? "" : ` (${p > 0 ? "+" : ""}${p}%)`),
  vs = (a, b, p) => `${a}, against ${b} in the same hours a week before${pc(p)}`;
const SINCE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

/** Clicks in the hours since `since` (an ISO time; default Google's last 24 hours) beside the same hours a week before,
 * as { state: "ok" | "warning" | "too-little-data" | "skipped", text, ... }. Never throws for Google's answers.
 * @param {{ site: string, since?: string | null, now?: number, home?: string, endpoints?: any }} opts */
export async function searchHourly({ site, since, now = Date.now(), home, endpoints }) {
  const skip = text => ({ state: "skipped", text }),
    t = since ? Date.parse(since) : null;
  if (t != null && t > now) return skip(`--since (${since}) is in the future, so there's nothing to compare yet.`);
  if (t != null && t < now - 2 * DAY)
    return skip(
      `--since (${since}) is more than 2 days ago. Google keeps hourly data for 10 days, and the same hours a week before have to fit in them. For an older deploy, change-check.mjs compares whole days.`,
    );
  let sc, res;
  try {
    sc = await searchConsole({ site, home, endpoints });
    // Hourly data covers up to 10 days and may be partial; Google suggests comparing with the same day a week before.
    // https://developers.google.com/search/blog/2025/04/san-hourly-data
    res = await sc.query({
      startDate: ptDate(now - 9 * DAY),
      endDate: ptDate(now),
      type: "web",
      dimensions: ["hour"],
      dataState: "hourly_all",
    });
  } catch (e) {
    return skip(`Google Search wasn't read: ${sc ? sc.explain(e) : String(e.message).replace(/^google: /, "")}`);
  }
  const little = text => ({ state: "too-little-data", property: sc.prop, text: `${text} This isn't a drop.` });
  const got = new Map();
  for (const r of res.rows || []) {
    const h = Date.parse(r.keys?.[0]);
    if (!isNaN(h)) got.set(h, { clicks: Number(r.clicks) || 0, impressions: Number(r.impressions) || 0 });
  }
  if (!got.size)
    return little("Too little data to tell: Search Console has no hourly data for this site in the last 10 days.");
  // Up to Google's latest hour; the deploy's own hour is left out (Pacific offsets are whole hours, so hours line up).
  const end = Math.max(...got.keys()) + HOUR,
    from = t != null ? Math.ceil(t / HOUR) * HOUR : end - 24 * HOUR;
  if (from >= end)
    return little(
      `Too early to tell: Google's hourly data so far ends at ${utc(end)}, before the first full hour after the deploy. It shows up a few hours late, so run this again later.`,
    );
  const none = { clicks: 0, impressions: 0 },
    hours = []; // an hour with no row had no impressions
  for (let h = from; h < end; h += HOUR)
    hours.push({ hour: iso(h), ...(got.get(h) || none), weekBefore: got.get(h - WEEK) || none });
  const sum = (k, wb) => hours.reduce((s, x) => s + (wb ? x.weekBefore[k] : x[k]), 0);
  const after = { from: iso(from), to: iso(end), clicks: sum("clicks"), impressions: sum("impressions") };
  const before = {
    from: iso(from - WEEK),
    to: iso(end - WEEK),
    clicks: sum("clicks", true),
    impressions: sum("impressions", true),
  };
  const change = { clicks: pct(after.clicks, before.clicks), impressions: pct(after.impressions, before.impressions) };
  const span = `${hours.length} hour${hours.length === 1 ? "" : "s"} from ${utc(from)} to ${utc(end)}`,
    imp = ` Impressions: ${after.impressions} against ${before.impressions}${pc(change.impressions)}.`;
  // firstIncompleteHour is the first hour Google is still collecting; the API's prose spells it first_incomplete_hour.
  const notes = [],
    m = res.metadata || {},
    open = Date.parse(m.firstIncompleteHour ?? m.first_incomplete_hour);
  if (open < end)
    notes.push(
      `Google is still collecting the data for the hours from ${utc(Math.max(open, from))} on, so those numbers may still change.`,
    );
  for (const a of anomaliesIn(ptDate(from - WEEK), ptDate(end))) notes.push(anomalyNote(a, "the hours compared"));
  const base = {
    property: sc.prop,
    after,
    before,
    change,
    hours,
    stillCollectingFrom: isNaN(open) ? null : iso(open),
    notes,
  };
  if (before.clicks < MIN_CLICKS)
    return {
      ...base,
      state: "too-little-data",
      text: `Too little data to tell: ${before.clicks} Google Search clicks in the same hours a week before, and a fair comparison needs at least ${MIN_CLICKS} (our own minimum). This isn't a drop. The ${span} had ${after.clicks} clicks and ${after.impressions} impressions.`,
    };
  if (change.clicks <= -DROP)
    return {
      ...base,
      state: "warning",
      text: `Google Search clicks fell ${-change.clicks}% in the ${span}: ${vs(after.clicks, before.clicks)}.${imp} A fall of ${DROP}% or more is our own line for this warning. Look at what the deploy changed, then check again in a few hours.`,
    };
  return {
    ...base,
    state: "ok",
    text: `Google Search clicks in the ${span}: ${vs(after.clicks, before.clicks, change.clicks)}.${imp}`,
  };
}

const LABEL = { ok: "OK", warning: "WARNING", blocker: "BLOCKER", skipped: "SKIPPED", "too-little-data": "INFO" };
const NOISY =
  "Hourly data is fresh and noisy: a slow hour, a holiday or a Google update can move it, so take it as a hint, not proof. This part never fails the deploy check.";
const hourlyOf = h => [
  "",
  "Google Search clicks, hour by hour, from your Search Console:",
  `  ${LABEL[h.state].padEnd(8)} ${h.text}`,
  ...[...(h.notes || []), ...(h.state === "skipped" ? [] : [NOISY])].map(n => `           ${n}`),
];
export const textOf = r =>
  [
    `Deploy check for ${r.site} (${r.seconds} s)`,
    ...r.checks.map(c => `  ${LABEL[c.state].padEnd(8)} ${c.text}`),
    r.blockers
      ? `${r.blockers} blocker${r.blockers === 1 ? "" : "s"}${r.warnings ? ` and ${r.warnings} warning${r.warnings === 1 ? "" : "s"}` : ""}. A blocker can keep the site out of search: fix it now.`
      : r.warnings
        ? `No blockers, ${r.warnings} warning${r.warnings === 1 ? "" : "s"}. Fix ${r.warnings === 1 ? "it" : "them"} soon; a full audit gives the detail.`
        : "Everything checked is fine.",
    ...(r.searchConsole ? hourlyOf(r.searchConsole) : []),
  ].join("\n");

const USAGE = `Usage: node deploy-check.mjs --site https://www.example.com [--json] [--search-console [--since 2026-11-21T14:30Z]]
The site's address must start with http:// or https://.
--search-console also compares Google Search clicks since the deploy with the same hours a week before, from your own
Search Console (sign in first with node google.mjs connect). --since is when the deploy went out, with its time zone,
at most 2 days ago; without it, the last 24 hours. It only warns: it never fails the check.`;

if (isMain(import.meta.url)) {
  await runMain(async () => {
    const a = parseArgs(process.argv.slice(2), {
      flags: ["site", "since"],
      booleans: ["json", "search-console"],
      positionals: 0,
      usage: USAGE,
    });
    const site = typeof a.site === "string" ? a.site : null,
      since = a.since === undefined ? null : typeof a.since === "string" ? a.since : "",
      gsc = a["search-console"] === true;
    let ok = false;
    try {
      ok = !!site && /^https?:$/.test(new URL(site).protocol);
    } catch {}
    if (since != null && !(gsc && SINCE.test(since) && !isNaN(Date.parse(since)))) ok = false;
    if (!ok) throw new Fail(USAGE);
    warnProxy();
    const [r, hourly] = await Promise.all([deployCheck(site), gsc ? searchHourly({ site, since }) : null]);
    if (hourly) r.searchConsole = hourly;
    console.log(a.json ? JSON.stringify(r, null, 2) : textOf(r));
    return r.blockers ? 1 : 0; // blockers only: the Search Console part never changes it
  });
}
