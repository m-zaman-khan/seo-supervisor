#!/usr/bin/env node
// @ts-check
// Services connected by an API key alone, and the key store the other scripts share. Keys are saved in
// ~/.seo-supervisor/keys.json, never in the project; a service's environment variable wins over its saved key.
// Exits 0 when done, 1 when a service refuses or can't be reached (or status finds no key), 2 on bad input.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { isMain } from "./lib/is-main.mjs";
import { loginDir } from "./lib/settings-dir.mjs";
import { proxyNote } from "./lib/proxy.mjs";
import { changedPages } from "./seo-diff.mjs";
import {
  Fail,
  Refused,
  fail,
  setLine,
  PASTE,
  address,
  idOf,
  refusal,
  request,
  POST,
  chunks,
  bare,
  domainOf,
  domainsFor,
  hostOf,
  day,
  isDay,
  num,
} from "./keys/http.mjs";
import { perplexity } from "./keys/perplexity.mjs";
import { openai } from "./keys/openai.mjs";
import { googleplaces } from "./keys/googleplaces.mjs";
import { bing, fetchBing, BATCH, submitBing } from "./keys/bing.mjs";

export { Fail, Refused, domainOf, submitBing };
export const SERVICES = {
  bing,
  openpagerank: {
    name: "Open PageRank",
    env: "OPENPAGERANK_KEY",
    endpointEnv: "OPENPAGERANK_ENDPOINT",
    endpoint: "https://openpagerank.keywordseverywhere.com/api/v1.0/getPageRank",
    adds: "a 0–10 authority score for the site and the competitors you name, based on links between sites",
    where: "keywordseverywhere.com/openpagerank",
    guide: [
      "Open PageRank (free, now run by Keywords Everywhere) adds a 0–10 authority score for your site and the competitors you name, based on links between sites.",
      "1. Sign up at https://keywordseverywhere.com/openpagerank and open your Open PageRank dashboard.",
      "2. Create an API key and register the IP address of the computer that will use it.",
      `3. Copy the key, then in your own terminal run: ${setLine("openpagerank")}`,
      PASTE,
      "Since 1 November 2026, free keys only work from that one registered IP address. A 403 error usually means your IP address changed (a new network, a VPN, or your provider changed it): update it in the dashboard. You can change it once a week.",
      "Free keys cover 30,000 domains a month.",
    ],
  },
  ahrefs: {
    name: "Ahrefs Domain Rating",
    env: "AHREFS_KEY",
    endpointEnv: "AHREFS_ENDPOINT",
    endpoint: "https://api.ahrefs.com/v3/public/domain-rating-free",
    adds: "Ahrefs' 0–100 Domain Rating for the site and the competitors you name",
    where: "ahrefs.com → Account settings → API keys",
    guide: [
      "Ahrefs' free Domain Rating adds Ahrefs' 0–100 Domain Rating for your site and the competitors you name. It's free, with a free Ahrefs account.",
      "1. Create a free account at https://ahrefs.com, or sign in.",
      "2. Go to Account settings → API keys and create a key.",
      `3. Copy the key, then in your own terminal run: ${setLine("ahrefs")}`,
      PASTE,
      'Ahrefs\' licence requires every place that shows these numbers to say "Domain Rating by Ahrefs" with a link to https://ahrefs.com/. The report does this for you.',
    ],
  },
  // Matomo and PostHog also need an address and an ID (`fields`), saved with the key: { url, siteId, key }.
  matomo: {
    name: "Matomo",
    env: "MATOMO_TOKEN_AUTH",
    adds: "visits from search engines to each page, from your Matomo",
    where: "Administration (the gear icon) → Personal → Security → Auth tokens",
    fields: [
      {
        id: "url",
        flag: "url",
        env: "MATOMO_URL",
        ask: "Your Matomo address (the one you open Matomo at, like https://analytics.example.com)",
        check: s => address(s, "The Matomo address"),
      },
      {
        id: "siteId",
        flag: "site-id",
        env: "MATOMO_SITE_ID",
        ask: "The site ID (a number, like 1)",
        check: s => idOf(s, "site ID", "in Matomo under Administration → Websites → Manage, in the ID column"),
      },
    ],
    about: k => `site ID ${k.siteId} at ${k.url}`,
    guide: [
      "Matomo adds the visits that came from search engines to each page, from your own Matomo (self-hosted or Matomo Cloud). You need three things: your Matomo address, the site ID and a token.",
      "1. Sign in to Matomo. Its address is the one in your browser's address bar, like https://analytics.example.com or https://example.matomo.cloud.",
      "2. The site ID: open Administration (the gear icon) → Websites → Manage. It's the number in the ID column next to your site.",
      '3. The token: open Administration → Personal → Security, scroll to Auth tokens and click Create new token. Confirm your password, write "SEO Supervisor" as the description, tick "Only allow secure requests" if it\'s offered, and create it. Copy the token straight away: Matomo shows it only once.',
      "   The token reads whatever your Matomo user can, so a user with view access to this one site is enough.",
      `4. In your own terminal run: ${setLine("matomo")}`,
      "   It asks for the address and the site ID (shown as you type), then the token. Paste the token and press Enter. It isn't shown, so it stays out of chats and your command history.",
      "If fetch says the segment hasn't been created, your Matomo only reports on saved segments. Above any report, open the segment menu → Add new segment, choose Channel Type, Is, search, and save it with its reports pre-processed. Matomo fills it in within a few hours; then fetch again.",
      "To check the connection first: node connect-keys.mjs test matomo --yes (it shows your Matomo's version).",
      // https://matomo.org/faq/troubleshooting/faq_50/
      "Matomo's numbers won't match Google Analytics exactly. Matomo doesn't sample data, and Google Analytics can. A visitor who accepts one tool in the consent banner but not the other is counted by only one. And the two tools spot bots and count visits in their own ways. Compare the trends, not the totals.",
    ],
  },
  posthog: {
    name: "PostHog",
    env: "POSTHOG_PERSONAL_API_KEY",
    adds: "visits from search engines to each page, from your PostHog",
    where: "PostHog → Settings → User → Personal API keys",
    fields: [
      {
        id: "host",
        flag: "host",
        env: "POSTHOG_HOST",
        ask: "Your PostHog address: us, eu, or your own PostHog's address",
        check: s =>
          /^(us|eu)$/i.test(s)
            ? `https://${s.toLowerCase()}.posthog.com/`
            : address(s, "The PostHog address").replace(
                /^https:\/\/(us|eu)\.i\.posthog\.com\/$/,
                "https://$1.posthog.com/",
              ),
      },
      {
        id: "projectId",
        flag: "project-id",
        env: "POSTHOG_PROJECT_ID",
        ask: "The project ID (a number)",
        check: s => idOf(s, "project ID", "in PostHog under Settings → Project"),
      },
    ],
    about: k => `project ID ${k.projectId} at ${k.host}`,
    guide: [
      "PostHog adds the visits that came from search engines to each page (the sessions PostHog counts as Organic Search), from your own PostHog. You need three things: the PostHog address, the project ID and a personal API key.",
      "1. Sign in to PostHog. The address is https://us.posthog.com (US cloud), https://eu.posthog.com (EU cloud) or your own PostHog's address.",
      "2. The project ID: open Settings → Project. It's the number shown as Project ID (it's also in the address bar, after /project/).",
      '3. The key: open Settings → User → Personal API keys and click Create personal API key. Name it "SEO Supervisor", let it use only this project, and give it one permission: Query: Read. Copy the key straight away: it starts with phx_ and PostHog shows it only once.',
      "   Not the project key in your site's tracking code (it starts with phc_): that one can only send data, not read it.",
      `4. In your own terminal run: ${setLine("posthog")}`,
      "   It asks for the address (type us, eu or your own address) and the project ID, shown as you type, then the key. Paste the key and press Enter. It isn't shown, so it stays out of chats and your command history.",
      "To check the connection first: node connect-keys.mjs test posthog --yes (it counts the project's pageviews in the last 7 days).",
    ],
  },
  // optional keeps a service off fetch's Limits list when no key is set.
  // https://moz.com/api/docs/guides/authentication
  // https://moz.com/api/docs/methods/DataSiteMetricsFetchAction
  moz: {
    name: "Moz",
    env: "MOZ_TOKEN",
    endpointEnv: "MOZ_ENDPOINT",
    endpoint: "https://api.moz.com/jsonrpc",
    optional: true,
    adds: "Moz's Domain Authority, Spam Score and linking domains for the site and the competitors you name",
    where: "moz.com/api/dashboard",
    guide: [
      "Moz adds its Domain Authority (1 to 100), Spam Score and the number of sites linking to you, for your site and the competitors you name: a second opinion next to Open PageRank and Ahrefs.",
      "1. Sign up for the Moz API at https://moz.com/products/api/pricing and pick the free plan. The API is separate from a Moz Pro subscription. Moz asks for a card but charges nothing unless you upgrade.",
      "2. Open https://moz.com/api/dashboard and generate a token.",
      `3. Copy the token, then in your own terminal run: ${setLine("moz")}`,
      PASTE,
      "The free plan has 50 rows a month and each domain uses one, so fetch reads at most 10 domains a run, your site first. The rows refill every month.",
    ],
  },
  // https://developers.google.com/youtube/v3/determine_quota_cost
  // https://developers.google.com/youtube/v3/docs/search/list
  // https://developers.google.com/youtube/v3/docs/channels/list
  youtube: {
    name: "YouTube Data API",
    env: "YOUTUBE_API_KEY",
    endpointEnv: "YOUTUBE_ENDPOINT",
    endpoint: "https://www.googleapis.com/youtube/v3",
    optional: true,
    adds: "the YouTube videos that rank for your topics, and your channel's subscribers, videos and views",
    where: "console.cloud.google.com → APIs & Services → Credentials",
    guide: [
      "The YouTube Data API adds the videos that rank on YouTube for the topics you name, and your own channel's subscribers, videos and views. It needs a Google Cloud project and an API key; Google gives each project a daily quota.",
      "1. Open https://console.cloud.google.com and pick or create a project.",
      '2. Open APIs & Services → Library, search for "YouTube Data API v3" and click Enable.',
      "3. Open APIs & Services → Credentials → Create credentials → API key. Under API restrictions, limit the key to YouTube Data API v3.",
      `4. Copy the key, then in your own terminal run: ${setLine("youtube")}`,
      PASTE,
      'Then fetch with --topics "topic one, topic two" and --youtube-channel @yourhandle. YouTube allows 100 searches a day, so fetch searches at most 5 topics a run.',
    ],
  },
  // Offered only when the site uses Clarity, like Matomo and PostHog, so it's never listed under Limits when unset.
  // https://learn.microsoft.com/clarity/setup-and-installation/clarity-data-export-api
  clarity: {
    name: "Microsoft Clarity",
    env: "CLARITY_API_TOKEN",
    endpointEnv: "CLARITY_ENDPOINT",
    endpoint: "https://www.clarity.ms/export-data/api/v1/project-live-insights",
    optional: true,
    adds: "what real visitors did on each page in the last 3 days: sessions, scroll depth, quick backs, rage clicks and dead clicks, from your Clarity",
    where: "clarity.microsoft.com → your project → Settings → Data Export",
    guide: [
      "Microsoft Clarity (free) adds what real visitors did on each page in the last 3 days, from your own Clarity: sessions, how far down they scrolled on average, and the share of sessions with quick backs (landing and going straight back), rage clicks (clicking the same spot again and again) and dead clicks (clicks that do nothing).",
      "Clarity's export covers only the last 1 to 3 days, so these are a recent snapshot, not a trend. The heat maps and recordings stay in Clarity's own dashboard.",
      "1. Sign in at https://clarity.microsoft.com and open this site's project. Only a project admin can make a token.",
      "2. Open Settings → Data Export → Generate new API token. Name it SEO-Supervisor (4 to 32 letters, digits, hyphens, underscores or periods, no spaces).",
      "3. Copy the token straight away: Clarity shows it only once. It's long, with two dots in it. It isn't the short project ID in Clarity's tracking code, which can't read data.",
      `4. In your own terminal run: ${setLine("clarity")}`,
      PASTE,
      "Clarity allows 10 requests a day per project, and each fetch uses one. A token reads one project, so for several sites use a client folder each (SEO_SUPERVISOR_CLIENT=<name>). If someone with access leaves the project, Microsoft asks you to replace the token.",
    ],
  },
  perplexity,
  openai,
  googleplaces,
};
const USAGE = `usage: node connect-keys.mjs set bing|openpagerank|ahrefs|matomo|posthog|moz|youtube|clarity|perplexity|openai|googleplaces [<key>]   (no key: it asks, hidden)
       node connect-keys.mjs set matomo [--url <address>] [--site-id <id>] | set posthog [--host us|eu|<address>] [--project-id <id>]
       node connect-keys.mjs status | remove <service> | guide <service> | test matomo|posthog [--yes]
       node connect-keys.mjs fetch --site https://www.example.com [--competitors a.com,b.com] [--days 90] [--out seo-audit/keys.json] [--yes]
            [--topics "topic one, topic two"] [--youtube-channel @handle] [--bing-pages /a,/b] [--bing-sister https://sister.example]
       node connect-keys.mjs submit-bing --site https://www.example.com (--urls changed.txt | --from-diff seo-audit/seo-diff.json) [--yes]`;
const ATTRIBUTION = { text: "Domain Rating by Ahrefs", url: "https://ahrefs.com/" };
const ROWS = 25000; // the most pages read from Matomo or PostHog, as google.mjs reads from Google Analytics
const serviceOf = id =>
  Object.hasOwn(SERVICES, id)
    ? id
    : fail(
        `there's no "${id}" connection. Use ${Object.keys(SERVICES)
          .join(", ")
          .replace(/, (\w+)$/, " or $1")}.`,
      );
function siteOf(s, flag = "--site") {
  let u;
  try {
    u = new URL(s);
  } catch {}
  return u && /^https?:$/.test(u.protocol)
    ? u
    : fail(`${flag} must be the site's address, like https://www.example.com (got ${s})`);
}

// ---------- keys ----------
export const keyFile = () => join(loginDir(), "keys.json"); // honours SEO_SUPERVISOR_HOME and SEO_SUPERVISOR_CLIENT
export function savedKeys() {
  const f = keyFile();
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    fail(`${f} isn't valid JSON. Fix it or delete it, then set the keys again.`);
  }
}
function save(keys) {
  const f = keyFile();
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  // On Windows chmod only sets the read-only flag, so there the file is as private as the user's profile folder.
  chmodSync(dirname(f), 0o700);
  // Written to a temporary file and renamed over the old one, so a crash never leaves half a keys file.
  const t = `${f}.${process.pid}.tmp`;
  writeFileSync(t, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });
  chmodSync(t, 0o600);
  renameSync(t, f);
}

// What set still needs. Piped stdin gives a line each, in order; a terminal asks for the address and ID in plain view
// (they aren't secret), then for the key without showing it.
async function ask(id, missing, needKey) {
  const { stdin, stderr } = process,
    values = {};
  if (!stdin.isTTY) {
    let text = "";
    const n = missing.length + (needKey ? 1 : 0);
    for await (const c of stdin) {
      text += c;
      if (text.split("\n").length > n) break;
    }
    const lines = text.split(/\r?\n/).map(s => s.trim());
    missing.forEach((f, i) => {
      values[f.id] = lines[i];
    });
    return {
      values,
      key: needKey
        ? lines[missing.length] ||
          fail(`no key was given. In your own terminal, run ${setLine(id)} and paste the key when it asks.`)
        : undefined,
    };
  }
  if (missing.length) {
    const rl = createInterface({ input: stdin, output: stderr });
    rl.on("SIGINT", () => rl.close());
    try {
      for (const f of missing) values[f.id] = await rl.question(`${f.ask}: `);
    } catch {
      fail("cancelled, nothing was saved.");
    } finally {
      rl.close();
    }
  }
  return { values, key: needKey ? await readKey(id) : undefined };
}
// The key from the terminal, without showing it.
async function readKey(id) {
  const { stdin, stderr } = process;
  stderr.write(`Paste the ${SERVICES[id].name} key and press Enter (it isn't shown): `);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  return new Promise((ok, no) => {
    let key = "";
    const done = () => {
      stdin.setRawMode(false);
      stdin.off("data", onData);
      stdin.pause();
      stderr.write("\n");
    };
    const onData = s => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          done();
          return ok(key);
        }
        if (ch === "\u0003") {
          done();
          return no(new Fail("connect-keys: cancelled, nothing was saved."));
        }
        if (ch === "\u007f" || ch === "\b") {
          if (key) {
            key = key.slice(0, -1);
            stderr.write("\b \b");
          }
        } else {
          key += ch;
          stderr.write("*");
        }
      }
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}
// values: Matomo's or PostHog's address and ID, checked and tidied before anything is saved.
export function setKey(id, key, values = {}) {
  const s = SERVICES[serviceOf(id)];
  key = String(key ?? "").trim();
  if (!key || /\s/.test(key))
    fail(`that doesn't look like a key (it's empty or has spaces). Copy it again from ${s.where}.`);
  if (id === "posthog" && key.startsWith("phc_"))
    fail(
      `that's the project key from your site's tracking code (it starts with phc_), which can only send data to PostHog. Reading needs a personal API key, which starts with phx_. To make one: node connect-keys.mjs guide posthog`,
    );
  // Microsoft: "Access to the API is secured via JWT tokens", three parts joined by dots.
  if (id === "clarity" && !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key))
    fail(
      `that isn't a Clarity API token: those are long, with two dots in them. A short code like the one in Clarity's tracking code is the project ID, which can't read data. To make a token: node connect-keys.mjs guide clarity`,
    );
  const extra = Object.fromEntries((s.fields || []).map(f => [f.id, f.check(String(values[f.id] ?? "").trim())]));
  save({ ...savedKeys(), [id]: s.fields ? { ...extra, key } : key });
}
export function removeKey(id) {
  serviceOf(id);
  const keys = savedKeys();
  if (!(id in keys)) return false;
  delete keys[id];
  save(keys);
  return true;
}
// { bing: { key, from } | null, matomo: { key, from, url, siteId } | null, ... }; an environment variable wins over the
// saved value. Matomo and PostHog count as set only with their address and ID too.
export function activeKeys(env = process.env) {
  const saved = savedKeys();
  return Object.fromEntries(
    Object.entries(SERVICES).map(([id, s]) => {
      const v = saved[id],
        savedKey = s.fields ? v?.key : v;
      const k = env[s.env] ? { key: env[s.env], from: s.env } : savedKey ? { key: savedKey, from: keyFile() } : null;
      for (const f of (k && s.fields) || []) k[f.id] = env[f.env] ? f.check(env[f.env].trim()) : v?.[f.id];
      return [id, k && (s.fields || []).every(f => k[f.id]) ? k : null];
    }),
  );
}
const mask = k => (k.length > 8 ? "…" + k.slice(-4) : "…");

// ---------- requests ----------
// ai-answers.mjs and geo-grid.mjs call services through this too.
export const call = (id, url, init) => request(id, SERVICES[id], url, init);

// ---------- Matomo and PostHog: visits from search engines by landing page ----------
// The same days google.mjs reads Google Analytics for, ending 3 days ago, so the numbers line up.
const periodFor = days => ({ from: day(Date.now() - (days + 2) * 864e5), to: day(Date.now() - 3 * 864e5) });
// Matomo: visits from a search engine (segment referrerType==search) by entry page, most first. Only token_auth goes
// in the POST body; the other parameters aren't secret. The splits cover the whole site ID: the same visits by
// device type and country, every visit by channel (no segment), and search visits by engine. With period=day,
// VisitsSummary.get gives search visits per date, [] for a day with none.
// https://developer.matomo.org/api-reference/reporting-api-legacy
const MATOMO_SPLITS = {
  byDevice: "DevicesDetection.getType",
  byCountry: "UserCountry.getCountry",
  byChannel: "Referrers.getReferrerType",
  byEngine: "Referrers.getSearchEngines",
};
const MATOMO_ALL = "Referrers.getReferrerType",
  MATOMO_DAILY = "VisitsSummary.get";
const matomoUrl = (k, p, method = "Actions.getEntryPageUrls") =>
  `${k.url}index.php?${new URLSearchParams(
    /** @type {any} */ ({
      module: "API",
      method,
      idSite: k.siteId,
      period: method === MATOMO_DAILY ? "day" : "range",
      date: `${p.from},${p.to}`,
      ...(method === MATOMO_ALL ? {} : { segment: "referrerType==search" }),
      ...(method === "Actions.getEntryPageUrls"
        ? { flat: 1, filter_limit: ROWS, filter_sort_column: "entry_nb_visits", filter_sort_order: "desc" }
        : method === MATOMO_DAILY
          ? {}
          : { filter_limit: 10, filter_sort_column: "nb_visits", filter_sort_order: "desc" }),
      format: "JSON",
    }),
  )}`;
// PostHog: sessions it files as Organic Search (a search engine as referrer or utm_source, paid search left out, as
// in GA4), by entry page. The site's host is matched here, not sent.
// Without $channel_type, the fallback counts sessions referred by a search engine. These LIKE patterns can count a
// little paid search and Google's other sites; port PostHog's channel_definitions.json if that matters.
// https://posthog.com/docs/data/channel-type
const ENGINES = [
  "%google.%",
  "%bing.com",
  "%duckduckgo.com",
  "%search.yahoo.%",
  "%yandex.%",
  "%baidu.com",
  "%ecosia.org",
  "%qwant.com",
  "%startpage.com",
  "%search.brave.com",
  "%naver.com",
  "%seznam.cz",
];
const organic = (fallback, pre = "") =>
  fallback
    ? `(${ENGINES.map(e => `${pre}$entry_referring_domain LIKE '${e}'`).join(" OR ")})`
    : `${pre}$channel_type = 'Organic Search'`;
const between = (p, field) => `toDate(${field}) BETWEEN toDate('${p.from}') AND toDate('${p.to}')`;
const posthogQuery = (p, fb) =>
  `SELECT domainWithoutWWW($entry_current_url) AS host, $entry_pathname AS path, count() AS visits FROM sessions WHERE ${organic(fb)} AND ${between(p, "$start_timestamp")} GROUP BY host, path ORDER BY visits DESC LIMIT ${ROWS}`;
// sessions has no device or country, so the splits use its pageviews' $device_type and $geoip_country_code through
// events' `session` join. The events' dates bound the scan; a session starting in the period has its first pageview
// in it.
// https://posthog.com/docs/data/sessions
const posthogSplit = (p, prop, fb) =>
  `SELECT domainWithoutWWW(session.$entry_current_url) AS host, ${prop} AS k, count(DISTINCT $session_id) AS visits FROM events WHERE event = '$pageview' AND ${organic(fb, "session.")} AND ${between(p, "session.$start_timestamp")} AND ${between(p, "timestamp")} GROUP BY host, k ORDER BY visits DESC LIMIT 1000`;
// byReferrer: every session by its referring domain ($direct when there was none), not only those from search.
const POSTHOG_SPLITS = {
  byDevice: (p, fb) => posthogSplit(p, "properties.$device_type", fb),
  byCountry: (p, fb) => posthogSplit(p, "properties.$geoip_country_code", fb),
  byReferrer: p =>
    `SELECT domainWithoutWWW($entry_current_url) AS host, $entry_referring_domain AS k, count() AS visits FROM sessions WHERE ${between(p, "$start_timestamp")} GROUP BY host, k ORDER BY visits DESC LIMIT 1000`,
};
// Pageviews and visitors (distinct_id) per day, in the sessions from search.
const posthogDaily = (p, fb) =>
  `SELECT domainWithoutWWW(session.$entry_current_url) AS host, toString(toDate(timestamp)) AS d, count() AS pageviews, count(DISTINCT distinct_id) AS visitors FROM events WHERE event = '$pageview' AND ${organic(fb, "session.")} AND ${between(p, "session.$start_timestamp")} AND ${between(p, "timestamp")} GROUP BY host, d ORDER BY d LIMIT 1000`;
const POSTHOG_TEST = "SELECT count() FROM events WHERE event = '$pageview' AND timestamp > now() - INTERVAL 7 DAY";
const posthogUrl = k => `${k.host}api/projects/${k.projectId}/query/`;
async function posthogRead(k, query) {
  const b = await call("posthog", posthogUrl(k), {
    ...POST,
    headers: { authorization: `Bearer ${k.key}`, "content-type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!Array.isArray(b?.results))
    throw new Refused(refusal("posthog", SERVICES.posthog, 200, null, null, new URL(k.host).host));
  return b.results;
}
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
async function splits(name, fields, read, notes) {
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
async function once(name, field, fn, notes) {
  try {
    return { [field]: await fn() };
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    notes.push(`${name}'s ${SPLIT_NAME[field]} weren't read: ${e.message}`);
    return {};
  }
}
// One page's http/https, www/apex and tracking-parameter variants add up, by path as GA4's landing page is.
const addVisits = (map, path, n) => {
  map[path] = { visits: (map[path]?.visits || 0) + n };
};
const tooMany = name =>
  `${name} has ${ROWS.toLocaleString("en-US")} or more pages with visits from search engines for this period; only the top ${ROWS.toLocaleString("en-US")} were read.`;

async function fetchMatomo(k, site, period, notes) {
  const want = bare(new URL(site).hostname),
    traffic = {};
  // list: a report's rows; otherwise one object (the daily trend's dates).
  const read = async (method, list = true) => {
    const rows = await call("matomo", matomoUrl(k, period, method), {
      ...POST,
      body: new URLSearchParams({ token_auth: k.key }),
    });
    if (list ? !Array.isArray(rows) : !rows || typeof rows !== "object" || rows.result === "error")
      throw new Refused(refusal("matomo", SERVICES.matomo, 200, rows, null, new URL(k.url).host));
    return rows;
  };
  const rows = await read();
  // Rows without a URL (Matomo's "Others") and other sites tracked in the same Matomo are left out.
  for (const r of rows) {
    let x;
    try {
      x = new URL(r?.url);
    } catch {
      continue;
    }
    const n = Number(r.entry_nb_visits) || 0;
    if (n > 0 && bare(x.hostname) === want) addVisits(traffic, x.pathname, n);
  }
  if (rows.length >= ROWS) notes.push(tooMany("Matomo"));
  // Countries by code, upper case as PostHog's; "xx" is Matomo's Unknown, not a country.
  const name = (r, field) =>
    field !== "byCountry" ? r?.label : r?.code !== "xx" && typeof r?.code === "string" ? r.code.toUpperCase() : null;
  return {
    period,
    traffic,
    ...(await splits(
      "Matomo",
      MATOMO_SPLITS,
      async (method, field) => (await read(method)).map(r => [name(r, field), r?.nb_visits]),
      notes,
    )),
    ...(await once(
      "Matomo",
      "daily",
      async () =>
        Object.fromEntries(
          Object.entries(await read(MATOMO_DAILY, false))
            .filter(([d]) => isDay(d))
            .map(([d, v]) => [d, Number(v?.nb_visits) || 0]),
        ),
      notes,
    )),
  };
}

async function fetchPosthog(k, site, period, notes) {
  const want = bare(new URL(site).hostname),
    traffic = {},
    read = q => posthogRead(k, q);
  const mine = rows => rows.filter(r => Array.isArray(r) && bare(String(r[0] ?? "")) === want);
  let fallback = false,
    rows;
  try {
    rows = await read(posthogQuery(period));
  } catch (e) {
    if (!(e instanceof Refused) || !/channel_type/.test(e.message)) throw e;
    fallback = true;
    rows = await read(posthogQuery(period, true));
    notes.push(
      "PostHog couldn't use $channel_type here (an older PostHog?), so visits from search were counted from search engines' referring domains instead. That list is our own and may count a little paid search.",
    );
  }
  for (const [, path, n] of mine(rows)) if (/^\//.test(path) && Number(n) > 0) addVisits(traffic, path, Number(n));
  if (rows.length >= ROWS) notes.push(tooMany("PostHog"));
  const split = await splits(
    "PostHog",
    POSTHOG_SPLITS,
    async (q, field) =>
      mine(await read(q(period, fallback))).map(([, v, n]) => [
        field === "byCountry" && typeof v === "string" ? v.toUpperCase() : v,
        n,
      ]),
    notes,
  );
  const daily = await once(
    "PostHog",
    "daily",
    async () =>
      Object.fromEntries(
        mine(await read(posthogDaily(period, fallback)))
          .filter(r => isDay(r[1]))
          .map(([, d, pv, v]) => [d, { pageviews: Number(pv) || 0, visitors: Number(v) || 0 }]),
      ),
    notes,
  );
  // Zero visits from search mean something only if PostHog records referrers at all ($direct is its value for none).
  const check = {};
  if (!Object.keys(traffic).length && split.byReferrer) {
    const seen = Object.keys(split.byReferrer);
    check.referrersCaptured = seen.some(r => r !== "$direct");
    if (!check.referrersCaptured)
      notes.push(
        seen.length
          ? "PostHog shows zero visits from search, but no visit to this site in the period has a referrer ($direct only), so PostHog can't tell visits from search apart. Check that the site's PostHog setup keeps the referrer; until then, don't trust the zero."
          : "PostHog shows zero visits from search, but it recorded no visits to this site at all in the period, so the zero says nothing. Check that PostHog's code is on the site and that the project ID is this site's, and that referrers reach it.",
      );
  }
  return { period, organicBy: fallback ? "referrer" : "channel", traffic, ...split, ...daily, ...check };
}

// Connection tests (test matomo|posthog --yes). API.getMatomoVersion answers { value: "5.x" } to a valid token.
async function testMatomo(k) {
  const b = await call(
    "matomo",
    `${k.url}index.php?${new URLSearchParams({ module: "API", method: "API.getMatomoVersion", format: "JSON" })}`,
    { ...POST, body: new URLSearchParams({ token_auth: k.key }) },
  );
  if (typeof b?.value !== "string")
    throw new Refused(refusal("matomo", SERVICES.matomo, 200, b, null, new URL(k.url).host));
  return `Matomo ${b.value} at ${k.url} accepted the token.`;
}
async function testPosthog(k) {
  const n = Number((await posthogRead(k, POSTHOG_TEST))[0]?.[0]) || 0,
    who = `PostHog project ${k.projectId} at ${k.host} accepted the key`;
  return n
    ? `${who}: ${num(n)} pageviews in the last 7 days.`
    : `${who}, but has no $pageview events in the last 7 days. Check that PostHog's code is on the site and sends pageviews.`;
}

// ---------- Microsoft Clarity: what visitors did on each page ----------
// The token names the project, so nothing about the site is sent and its pages are matched here. The answer is a list
// of { metricName, information: [rows] }, at most 1,000 rows over the last 72 hours. Only Traffic's fields are
// documented; the other metric names come from Microsoft's Clarity MCP server 1.0.5. Undocumented fields are read only
// when present, a missing one is named in a note, never guessed, and names match ignoring case and spaces.
const CLARITY_DAYS = 3,
  CLARITY_ROWS = 1000,
  PCT = "sessionsWithMetricPercentage";
/** @type {Record<string, [string, string, string]>} metricName → [output field, Clarity's field, plain name] */
const CLARITY_METRICS = {
  scrolldepth: ["scrollDepth", "averageScrollDepth", "average scroll depth"],
  quickbackclick: ["quickBacks", PCT, "quick backs"],
  rageclickcount: ["rageClicks", PCT, "rage clicks"],
  deadclickcount: ["deadClicks", PCT, "dead clicks"],
  excessivescroll: ["excessiveScroll", PCT, "excessive scrolling"],
};
const squash = s =>
  String(s ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
const fieldOf = (row, name) => Object.keys(row).find(k => k.toLowerCase() === name.toLowerCase());
async function fetchClarity(key, base, site, notes) {
  const body = await call(
    "clarity",
    `${base}?${new URLSearchParams({ numOfDays: String(CLARITY_DAYS), dimension1: "URL" })}`,
    { headers: { authorization: `Bearer ${key}` }, redirect: "manual" },
  ); // the token never follows a redirect
  const rowsOf = m => (Array.isArray(m?.information) ? m.information.filter(r => r && typeof r === "object") : []);
  const metric = name => (Array.isArray(body) ? body.find(m => squash(m?.metricName) === name) : null),
    traffic = metric("traffic");
  if (!traffic || !Array.isArray(traffic.information))
    throw new Refused(
      "Microsoft Clarity's answer isn't the list of metrics by page it used to be (it has no Traffic), so nothing was read. Clarity may have changed its export.",
    );
  // A row's page: its URL on this site (www or not, http or https), by path; tracking parameters and the like add up.
  const want = bare(new URL(site).hostname),
    urlOf = r => {
      const k = fieldOf(r, "url");
      return k && typeof r[k] === "string" && r[k] ? r[k] : null;
    };
  const pathOf = u => {
    try {
      const x = new URL(u, site);
      return bare(x.hostname) === want ? x.pathname : null;
    } catch {
      return null;
    }
  };
  const pages = {},
    weight = new Map(),
    others = new Set();
  for (const r of rowsOf(traffic)) {
    const u = urlOf(r),
      p = u && pathOf(u),
      n = Number(r[fieldOf(r, "totalSessionCount") ?? ""]);
    if (!u || !(n > 0)) continue;
    if (!p) {
      others.add(hostOf(u) || u);
      continue;
    }
    weight.set(u, n);
    const t = (pages[p] ||= { sessions: 0, botSessions: 0 });
    t.sessions += n;
    t.botSessions += Number(r[fieldOf(r, "totalBotSessionCount") ?? ""]) || 0;
  }
  // Averages and shares, weighted by each URL's sessions, for the pages Traffic has.
  const unread = []; // "dead clicks without sessionsWithMetricPercentage (it sent …)"
  for (const [name, [field, theirs, plain]] of Object.entries(CLARITY_METRICS)) {
    const rows = rowsOf(metric(name)),
      sums = {};
    if (!rows.length) continue;
    if (!rows.some(r => fieldOf(r, theirs))) {
      unread.push(
        `${plain} without ${theirs} (it sent ${
          [...new Set(rows.flatMap(Object.keys))]
            .filter(k => k.toLowerCase() !== "url")
            .slice(0, 5)
            .join(", ") || "no fields"
        })`,
      );
      continue;
    }
    for (const r of rows) {
      const u = urlOf(r),
        p = u && pathOf(u),
        v = Number(r[fieldOf(r, theirs) ?? ""]);
      if (!p || !pages[p] || !(v >= 0 && v <= 100)) continue;
      const w = weight.get(u) || 1,
        s = (sums[p] ||= [0, 0]);
      s[0] += v * w;
      s[1] += w;
    }
    for (const [p, [sum, w]] of Object.entries(sums)) pages[p][field] = Math.round((10 * sum) / w) / 10;
  }
  if (unread.length)
    notes.push(
      `Microsoft Clarity sent ${unread.join("; ")}, the field this version reads, so ${unread.length === 1 ? "that's" : "those are"} left out. Clarity may have changed its export.`,
    );
  if (rowsOf(traffic).length >= CLARITY_ROWS)
    notes.push(
      `Microsoft Clarity sends at most ${num(CLARITY_ROWS)} rows and can't page through more, so pages with fewer sessions may be missing.`,
    );
  if (!Object.keys(pages).length)
    notes.push(
      others.size
        ? `Microsoft Clarity has sessions only on other sites (${[...others].slice(0, 3).join(", ")}), none on ${want}: check that the token is for this site's Clarity project.`
        : `Microsoft Clarity recorded no sessions in the last ${CLARITY_DAYS} days. Check that Clarity's code is on the site and that the token is for this site's project.`,
    );
  return { days: CLARITY_DAYS, read: day(Date.now()), traffic: pages };
}

// ---------- YouTube ----------
// channels.list costs 1 unit of 10,000 a day; search.list has its own bucket of 100 calls a day, so a run makes at
// most YT_TOPICS searches. The key goes as ?key=. It's never printed, and call()'s errors name the host, not the URL.
const YT_TOPICS = 5,
  CHANNEL_ID = /^UC[\w-]{22}$/;
async function fetchYoutube(key, base, { topics, channel }, notes) {
  const get = (path, params) => call("youtube", `${base}/${path}?${new URLSearchParams({ ...params, key })}`);
  const n = v => (v != null && Number(v) >= 0 ? Number(v) : null),
    out = { channel: null, topics: [] };
  if (channel) {
    const c = (
        await get("channels", {
          part: "snippet,statistics",
          ...(CHANNEL_ID.test(channel) ? { id: channel } : { forHandle: channel }),
        })
      )?.items?.[0],
      st = c?.statistics || {};
    if (c)
      out.channel = {
        id: c.id,
        title: c.snippet?.title ?? null,
        subscribers: st.hiddenSubscriberCount ? null : n(st.subscriberCount),
        videos: n(st.videoCount),
        views: n(st.viewCount),
      };
    else
      notes.push(
        `YouTube has no channel ${channel}. Check the handle (it starts with @) or the channel ID (it starts with UC).`,
      );
  }
  if (topics.length > YT_TOPICS)
    notes.push(
      `YouTube: searched the first ${YT_TOPICS} of ${topics.length} topics. Search allows 100 calls a day; run fetch again another day with the rest.`,
    );
  for (const topic of topics.slice(0, YT_TOPICS)) {
    const items = (await get("search", { part: "snippet", type: "video", maxResults: 10, q: topic }))?.items || [];
    out.topics.push({
      topic,
      videos: items
        .filter(i => typeof i?.id?.videoId === "string")
        .map(({ id: { videoId }, snippet }) =>
          (s => ({
            id: videoId,
            url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
            title: s.title ?? "",
            channel: s.channelTitle ?? "",
            published: isDay(String(s.publishedAt).slice(0, 10)) ? s.publishedAt.slice(0, 10) : null,
            own: !!out.channel && s.channelId === out.channel.id,
          }))(snippet && typeof snippet === "object" ? snippet : {}),
        ),
    });
  }
  return out;
}

// Kept here rather than in keys/bing.mjs: knownChecks() in lib/score.mjs and the rule-ID test scan only scripts/ and
// scripts/checks/ for check names.
function crawlFinding(bing) {
  // Bing lists redirects as issues too, but on their own they're normal.
  const evidence = (bing?.crawlIssues || [])
    .map(c => ({ c, problems: c.issues.filter(w => !w.includes("redirect")) }))
    .filter(x => x.problems.length)
    .map(({ c, problems }) => ({
      url: c.url,
      detail: `${problems.join(", ")}, Bing got HTTP ${c.httpCode ?? "?"}${c.inLinks ? `, ${c.inLinks} links point here` : ""}`,
    }));
  if (!evidence.length) return [];
  const ex = evidence[0];
  return [
    {
      id: "K-001",
      check: "bing-crawl-issues",
      rule: "CRAWL-05",
      severity: "medium",
      category: "Crawling & indexing",
      title: `Bing reports crawl problems on ${evidence.length} URL(s)`,
      what: `${evidence.length === 1 ? "Found on" : `${evidence.length} cases, for example`} ${ex.url} (${ex.detail}).`,
      why: "Bing Webmaster Tools lists these URLs as failing when Bing crawled them. Pages that error, time out or are blocked can drop out of Bing, and out of AI answers built on Bing's index such as Copilot.",
      fix: "Open each URL. Fix pages that should work (server errors, timeouts, DNS), redirect or stop linking to pages that are gone, and unblock important pages in robots.txt. Bing's list takes a few days to clear after a fix.",
      count: evidence.length,
      evidence: evidence.slice(0, 100),
      source: "bing-webmaster",
      status: "open",
    },
  ];
}

// Each service runs only when its key is set. problems holds the refusals, also kept in result.notes.
// bingPages and bingSister add Bing's links to chosen pages and to a sister site in the same account.
const MOZ_MAX = 10;
export async function fetchKeys({
  site,
  competitors = [],
  keys = activeKeys(),
  endpoints = {},
  days = 90,
  topics = [],
  channel = null,
  bingPages = [],
  bingSister = null,
}) {
  const siteUrl = new URL("/", site).href,
    notes = [],
    problems = [],
    notChecked = [];
  const domains = domainsFor(siteUrl, competitors);
  const end = id => endpoints[id] || SERVICES[id].endpoint;
  const authority =
    keys.openpagerank || keys.ahrefs ? domains.map(domain => ({ domain, openPageRank: null, ahrefsDR: null })) : [];
  const set = (domain, field, v) => {
    const a = authority.find(x => x.domain === domain);
    if (a) a[field] = v;
  };
  let bing = null,
    attribution = null,
    matomo = null,
    posthog = null,
    moz = null,
    youtube = null,
    clarity = null;
  const run = async (id, fn) => {
    const s = SERVICES[id];
    // Analytics services (those with fields) go under Limits only when the site uses one, which SKILL.md decides.
    // Optional extras never do.
    if (!keys[id]) {
      if (!s.fields && !s.optional)
        notChecked.push({
          area: `${s.name}: ${s.adds}`,
          reason: `No key set. To connect it: node connect-keys.mjs guide ${id}`,
        });
      return;
    }
    try {
      await fn(s.fields ? keys[id] : (keys[id].key ?? keys[id]));
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      problems.push(e.message);
      notes.push(e.message);
      notChecked.push({ area: `${s.name}: ${s.adds}`, reason: e.message });
    }
  };
  await run("bing", async key => {
    bing = await fetchBing(key, siteUrl, end("bing"), notes, { pages: bingPages, sister: bingSister });
  });
  await run("openpagerank", async key => {
    for (const list of chunks(domains, 100)) {
      const b = await call(
        "openpagerank",
        `${end("openpagerank")}?${list.map(d => "domains[]=" + encodeURIComponent(d)).join("&")}`,
        { headers: { "API-OPR": key } },
      );
      for (const r of b?.response || [])
        set(
          domainOf(r.domain || ""),
          "openPageRank",
          r.status_code === 200 && !r.error && r.page_rank_decimal != null ? Number(r.page_rank_decimal) : null,
        );
    }
  });
  await run("ahrefs", async key => {
    for (const list of chunks(domains, 1000)) {
      const b = await call("ahrefs", end("ahrefs"), {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ targets: list }),
      });
      for (const t of b?.domain_rating?.targets || [])
        set(domainOf(t.target || ""), "ahrefsDR", typeof t.domain_rating === "number" ? t.domain_rating : null);
      attribution = {
        ...ATTRIBUTION,
        license: b?.domain_rating?.license || "https://ahrefs.com/legal/domain-rating-license",
      };
    }
  });
  // Moz's data.site.metrics.fetch with scope "domain" uses one row a call, and the free plan has 50 rows a month, so a
  // run reads at most MOZ_MAX domains. Domains already read are kept on a refusal.
  await run("moz", async key => {
    moz = [];
    if (domains.length > MOZ_MAX)
      notes.push(
        `Moz: read the first ${MOZ_MAX} of ${domains.length} domains. Each uses one of the free plan's 50 rows a month.`,
      );
    for (const domain of domains.slice(0, MOZ_MAX)) {
      const b = await call("moz", end("moz"), {
        method: "POST",
        headers: { "x-moz-token": key, "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "data.site.metrics.fetch",
          params: { data: { site_query: { query: domain, scope: "domain" } } },
        }),
      });
      if (b?.error)
        throw new Refused(refusal("moz", SERVICES.moz, Number(b.error.status || b.error.httpStatus) || 400, b));
      const m = b?.result?.site_metrics || {},
        n = v => (typeof v === "number" && v >= 0 ? v : null); // Spam Score -1: Moz has none
      moz.push({
        domain,
        domainAuthority: n(m.domain_authority),
        spamScore: n(m.spam_score),
        linkingDomains: n(m.root_domains_to_root_domain),
        inboundLinks: n(m.external_pages_to_root_domain),
      });
    }
  });
  await run("youtube", async key => {
    if (!topics.length && !channel) {
      notes.push(
        "A YouTube key is set, but fetch got no --topics or --youtube-channel, so YouTube wasn't asked anything.",
      );
      return;
    }
    youtube = await fetchYoutube(key, end("youtube"), { topics, channel }, notes);
  });
  const period = periodFor(days);
  await run("matomo", async k => {
    matomo = await fetchMatomo(k, siteUrl, period, notes);
  });
  await run("posthog", async k => {
    posthog = await fetchPosthog(k, siteUrl, period, notes);
  });
  await run("clarity", async key => {
    clarity = await fetchClarity(key, end("clarity"), siteUrl, notes);
  });
  return {
    result: {
      source: "keys",
      when: new Date().toISOString(),
      site: siteUrl,
      bing,
      authority,
      attribution,
      moz,
      youtube,
      matomo,
      posthog,
      clarity,
      findings: crawlFinding(bing),
      notChecked,
      notes,
    },
    problems,
  };
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const args = {},
    pos = [];
  for (let i = 0; i < rest.length; i++)
    if (rest[i].startsWith("--")) {
      const k = rest[i].slice(2);
      args[k] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true;
    } else pos.push(rest[i]);
  const str = k => (typeof args[k] === "string" ? args[k] : null);

  if (cmd === "set") {
    if (!pos[0]) throw new Fail(USAGE);
    const id = serviceOf(pos[0]),
      fields = SERVICES[id].fields || [];
    const values = Object.fromEntries(fields.map(f => [f.id, str(f.flag)])),
      missing = fields.filter(f => !values[f.id]);
    let key = pos[1];
    if (key == null || missing.length) {
      const got = await ask(id, missing, key == null);
      Object.assign(values, got.values);
      key ??= got.key;
    }
    setKey(id, key, values);
    console.log(
      `connect-keys: saved the ${SERVICES[id].name} key in ${keyFile()} (only your user account can read it). ${process.env[SERVICES[id].env] ? `Note: ${SERVICES[id].env} is also set and wins over the saved key.` : ""}`.trim(),
    );
  } else if (cmd === "remove") {
    if (!pos[0]) throw new Fail(USAGE);
    console.log(
      removeKey(pos[0])
        ? `connect-keys: removed the ${SERVICES[pos[0]].name} key.`
        : `connect-keys: no saved ${SERVICES[pos[0]].name} key to remove.`,
    );
  } else if (cmd === "guide") {
    if (!pos[0]) throw new Fail(USAGE);
    console.log(SERVICES[serviceOf(pos[0])].guide.join("\n"));
  } else if (cmd === "test") {
    const id = pos[0] && serviceOf(pos[0]);
    if (id !== "matomo" && id !== "posthog")
      fail("test works for matomo or posthog: node connect-keys.mjs test matomo|posthog [--yes]");
    const k = activeKeys()[id];
    if (!k) fail(`${SERVICES[id].name} isn't set up yet. To connect it: node connect-keys.mjs guide ${id}`);
    if (args.yes !== true) {
      console.log(
        `connect-keys: dry run, nothing sent. With --yes it would send your ${id === "matomo" ? `token to ${new URL(k.url).host} and ask for Matomo's version (API.getMatomoVersion)` : `key to ${new URL(k.host).host} and count project ${k.projectId}'s pageviews in the last 7 days (the query: ${POSTHOG_TEST})`}. Re-run with --yes once the owner agrees.`,
      );
      return 0;
    }
    try {
      console.log("connect-keys: " + (await (id === "matomo" ? testMatomo(k) : testPosthog(k))));
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      console.log("connect-keys: " + e.message);
      return 1;
    }
  } else if (cmd === "status") {
    const keys = activeKeys();
    for (const [id, s] of Object.entries(SERVICES)) {
      const k = keys[id];
      console.log(
        k
          ? `${s.name}: set (${mask(k.key)}, ${k.from === s.env ? `from ${s.env}` : `saved in ${k.from}`})${s.about ? ` for ${s.about(k)}` : ""}`
          : `${s.name}: not set. It adds ${s.adds}. To get a key: node connect-keys.mjs guide ${id}`,
      );
    }
  } else if (cmd === "fetch") {
    if (!str("site")) throw new Fail(USAGE);
    const site = siteOf(args.site);
    const days = args.days === undefined ? 90 : Number(str("days"));
    if (!(Number.isInteger(days) && days >= 1 && days <= 480))
      fail(`--days must be a whole number from 1 to 480, as with google.mjs (got ${args.days}).`);
    const period = periodFor(days);
    const listed = (str("competitors") || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    const skipped = listed.filter(c => !domainOf(c));
    const competitors = listed.filter(c => domainOf(c));
    const keys = activeKeys(),
      siteUrl = new URL("/", site).href;
    // *_ENDPOINT variables point services at the tests' fakes; Matomo and PostHog use the saved address instead.
    const endpoints = Object.fromEntries(
      Object.entries(SERVICES).map(([id, s]) => [id, process.env[s.endpointEnv] || s.endpoint]),
    );
    const domains = domainsFor(siteUrl, competitors);
    const skipNote = skipped.map(c => `Skipped competitor "${c}": it's not a domain name like rival.com.`);
    const listOf = s =>
      (s || "")
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);
    const topics = listOf(str("topics")),
      channel = str("youtube-channel"),
      bingPages = listOf(str("bing-pages"));
    const bingSister = str("bing-sister") && siteOf(args["bing-sister"], "--bing-sister").href;

    if (args.yes !== true) {
      const list = ds => ds.slice(0, 10).join(", ") + (ds.length > 10 ? ` … and ${ds.length - 10} more` : "");
      const { matomo: m, posthog: p } = keys;
      const yt =
        topics.length || channel
          ? `your key, ${Math.min(topics.length, YT_TOPICS)} topic search(es)${topics.length ? ` (${topics.slice(0, YT_TOPICS).join(", ")})` : ""}${channel ? ` and the channel ${channel}` : ""}`
          : "nothing (no --topics or --youtube-channel given)";
      const bingWhat = `your site's address (${siteUrl})${bingPages.length ? `, ${bingPages.length} chosen page(s) for their links` : ""}${bingSister ? `, the sister site ${bingSister}` : ""}`;
      const lines = Object.entries(SERVICES)
        .filter(([, s]) => !s.answers && !s.script)
        .map(([id, s]) =>
          !keys[id]
            ? `  ${s.name}: not set, skipped (to add it: node connect-keys.mjs guide ${id})`
            : id === "matomo"
              ? `  Matomo: your token (in the request body, never in the address) and site ID ${m.siteId}, to ${new URL(m.url).host}:${[undefined, ...Object.values(MATOMO_SPLITS), MATOMO_DAILY].map(method => `\n    POST ${matomoUrl(m, period, method)}`).join("")}`
              : id === "posthog"
                ? `  PostHog: your key and project ID ${p.projectId}, to ${new URL(p.host).host}:${[posthogQuery(period), ...Object.values(POSTHOG_SPLITS).map(q => q(period)), posthogDaily(period)].map(q => `\n    POST ${posthogUrl(p)} with the query: ${q}`).join("")}`
                : id === "youtube"
                  ? `  YouTube Data API: ${yt}, to ${new URL(endpoints[id]).host}`
                  : id === "clarity"
                    ? `  Microsoft Clarity: your token only, to ${new URL(endpoints[id]).host}: GET ${endpoints[id]}?numOfDays=${CLARITY_DAYS}&dimension1=URL (nothing about your site: the token names the Clarity project). It uses 1 of the 10 requests Clarity allows a project each day.`
                    : `  ${s.name}: ${id === "bing" ? bingWhat : id === "moz" ? `${Math.min(domains.length, MOZ_MAX)} domain name(s) (${list(domains.slice(0, MOZ_MAX))})` : `${domains.length} domain name(s) (${list(domains)})`} and your key, to ${new URL(endpoints[id]).host}`,
        );
      console.log(
        `connect-keys: dry run, nothing sent. With --yes it would send:\n${lines.join("\n")}${skipNote.length ? "\n" + skipNote.join("\n") : ""}\nThese go to outside services, so re-run with --yes once the owner agrees.`,
      );
      return 0;
    }
    const { result, problems } = await fetchKeys({
      site: siteUrl,
      competitors,
      keys,
      endpoints,
      days,
      topics,
      channel,
      bingPages,
      bingSister,
    });
    result.notes.push(...skipNote);
    const out = resolve(str("out") || "seo-audit/keys.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(result, null, 2));
    for (const p of problems) console.log("connect-keys: " + p);
    const b = result.bing,
      visits = (name, x) => (x ? `${name} ${Object.keys(x.traffic).length} pages · ` : "");
    console.log(
      `connect-keys: ${b ? `Bing ${Object.keys(b.traffic).length} pages, ${b.queries.length} queries, ${b.backlinks.pages.length} linked pages${b.crawlIssues ? `, ${b.crawlIssues.length} crawl issues` : ""} · ` : ""}${result.authority.length ? `authority for ${result.authority.length} domain(s) · ` : ""}${result.moz?.length ? `Moz for ${result.moz.length} domain(s) · ` : ""}${result.youtube ? `YouTube ${result.youtube.topics.length} topic(s) · ` : ""}${visits("Matomo", result.matomo)}${visits("PostHog", result.posthog)}${result.clarity ? `Clarity ${Object.keys(result.clarity.traffic).length} pages · ` : ""}${result.findings.length} finding(s) · wrote ${out}`,
    );
    return problems.length ? 1 : 0;
  } else if (cmd === "submit-bing") {
    if (!str("site") || !(str("urls") || str("from-diff"))) throw new Fail(USAGE);
    const site = siteOf(args.site),
      key = activeKeys().bing?.key;
    if (!key) fail("no Bing Webmaster Tools key is set. To connect it: node connect-keys.mjs guide bing");
    const read = f => {
      try {
        return readFileSync(f, "utf8");
      } catch (e) {
        fail(`can't read ${f} (${e.code || e.message}).`);
      }
    };
    const found = [];
    if (str("urls"))
      found.push(
        ...read(args.urls)
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(s => s && !s.startsWith("#")),
      );
    if (str("from-diff")) {
      let d;
      try {
        d = JSON.parse(read(args["from-diff"]));
      } catch (e) {
        if (e instanceof Fail) throw e;
        fail(`${args["from-diff"]} isn't a seo-diff.json (run seo-diff.mjs first).`);
      }
      found.push(...changedPages(d));
    }
    // Bing takes only the site's own URLs, so anything off-origin is dropped before sending.
    const kept = new Set(),
      others = [];
    for (const s of found.filter(s => typeof s === "string")) {
      let u;
      try {
        u = /^(https?:\/\/|\/)/i.test(s) ? new URL(s, site) : null;
      } catch {}
      if (u?.origin === site.origin) {
        u.hash = "";
        kept.add(u.href);
      } else others.push(s);
    }
    const urls = [...kept];
    if (others.length)
      console.log(
        `connect-keys: left out ${others.length} URL(s) that aren't on ${site.origin} (Bing only takes the site's own URLs), e.g. ${others[0]}`,
      );
    if (!urls.length) {
      console.log(`connect-keys: no URLs on ${site.origin} to submit.`);
      return 0;
    }
    if (args.yes !== true) {
      console.log(
        `connect-keys: dry run, nothing sent. With --yes it would ask Bing Webmaster Tools, with your key, for the site's URL submission quota (GetUrlSubmissionQuota), then submit as many of these ${urls.length} URL(s) as fit in it (SubmitUrlBatch, up to ${BATCH} a request):\n${urls
          .slice(0, 20)
          .map(u => "  " + u)
          .join(
            "\n",
          )}${urls.length > 20 ? `\n  … and ${urls.length - 20} more` : ""}\nIndexNow (indexnow.mjs) already tells Bing about changed pages; this asks Bing directly. It's a write to the owner's Bing Webmaster Tools account, so re-run with --yes once the owner agrees.`,
      );
      return 0;
    }
    let r;
    try {
      r = await submitBing({
        key,
        site: site.href,
        urls,
        endpoint: process.env[SERVICES.bing.endpointEnv] || SERVICES.bing.endpoint,
      });
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      console.log("connect-keys: " + e.message);
      return 1;
    }
    const { quota, sent, notSent, error } = r;
    console.log(
      `connect-keys: Bing's URL submission quota for ${r.siteUrl}: ${num(quota.daily)} URL(s) today${quota.monthly != null ? `, ${num(quota.monthly)} this month` : ""}.`,
    );
    if (!sent && !error) {
      console.log("connect-keys: the quota is used up, so nothing was sent. Submit again on another day.");
      return 1;
    }
    if (sent) console.log(`connect-keys: submitted ${sent} URL(s) to Bing Webmaster Tools.`);
    if (error) console.log(`connect-keys: ${error}`);
    if (notSent.length)
      console.log(
        `connect-keys: ${notSent.length} URL(s) ${error ? "weren't sent" : "didn't fit in the quota and weren't sent"}, starting with ${notSent[0]}. Submit them on another day.`,
      );
    return error ? 1 : 0;
  } else throw new Fail(USAGE);
  return 0;
}

// Not process.exit(): exiting while fetch's sockets close crashes Node on Windows.
if (isMain(import.meta.url)) {
  {
    const n = proxyNote();
    if (n) console.error("note: " + n);
  } // once, before any request is sent
  process.exitCode = await main(process.argv.slice(2)).then(null, e => {
    if (!(e instanceof Fail) && e.code !== "SEO_SETTINGS") throw e;
    console.error(e.message);
    return 2;
  });
}
