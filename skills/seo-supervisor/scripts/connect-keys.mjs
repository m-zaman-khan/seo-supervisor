#!/usr/bin/env node
// Services connected by an API key alone: Bing Webmaster Tools, Open PageRank, Ahrefs' free Domain Rating, Matomo and
// PostHog. Keys, with Matomo's and PostHog's addresses and IDs, are saved in ~/.seo-supervisor/keys.json, never in the
// project; a service's environment variable wins over its saved value. fetch sends the site's address and domain
// names to these services, and submit-bing asks Bing to crawl URLs, so without --yes each is a dry run that prints
// what it would send. *_ENDPOINT variables point the services at the tests' fakes; Matomo and PostHog use their
// saved address instead.
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { isMain } from "./lib/is-main.mjs";
import { proxyNote } from "./lib/proxy.mjs";
import { changedPages } from "./seo-diff.mjs";

const setLine = id => `node connect-keys.mjs set ${id}`;
const PASTE =
  "   Paste the key when it asks and press Enter. It isn't shown, so it stays out of chats and your command history.";
export const SERVICES = {
  bing: {
    name: "Bing Webmaster Tools",
    env: "BING_WEBMASTER_KEY",
    endpointEnv: "BING_WEBMASTER_ENDPOINT",
    endpoint: "https://ssl.bing.com/webmaster/api.svc/json",
    adds: "Bing clicks and impressions by page and query, the pages other sites link to, and problems Bing hit crawling the site",
    where: "bing.com/webmasters → Settings → API Access",
    guide: [
      "Bing Webmaster Tools (free) adds Bing clicks and impressions by page and query, the pages other sites link to, and the problems Bing hit while crawling your site.",
      "1. Sign in at https://www.bing.com/webmasters with a Microsoft, Google or Facebook account.",
      '2. Add your site and verify it. If the site is already in Google Search Console, choose "Import from Google Search Console": it\'s the quickest way.',
      "3. Open Settings → API Access (Settings is at the top right). Read and accept the terms, then click Generate API Key.",
      `4. Copy the key, then in your own terminal run: ${setLine("bing")}`,
      PASTE,
      "One key covers every site verified in your account. Keep it private: anyone who has it can read and change your Bing Webmaster Tools settings.",
    ],
  },
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
    ],
  },
};
const USAGE = `usage: node connect-keys.mjs set bing|openpagerank|ahrefs|matomo|posthog [<key>]   (no key: it asks, hidden)
       node connect-keys.mjs set matomo [--url <address>] [--site-id <id>] | set posthog [--host us|eu|<address>] [--project-id <id>]
       node connect-keys.mjs status | remove <service> | guide <service>
       node connect-keys.mjs fetch --site https://www.example.com [--competitors a.com,b.com] [--days 90] [--out seo-audit/keys.json] [--yes]
       node connect-keys.mjs submit-bing --site https://www.example.com (--urls changed.txt | --from-diff seo-audit/seo-diff.json) [--yes]`;
const UA = "seo-supervisor-connect-keys";
const ATTRIBUTION = { text: "Domain Rating by Ahrefs", url: "https://ahrefs.com/" };
const MAX_LINK_PAGES = 10;
const ROWS = 25000; // the most pages read from Matomo or PostHog, as google.mjs reads from Google Analytics
class Fail extends Error {} // bad input: exit 2
class Refused extends Error {} // a service said no: noted, the rest still runs, exit 1
const fail = msg => {
  throw new Fail("connect-keys: " + msg);
};
const serviceOf = id =>
  Object.hasOwn(SERVICES, id)
    ? id
    : fail(`there's no "${id}" connection. Use bing, openpagerank, ahrefs, matomo or posthog.`);
// A typed address, kept as origin and path ending in "/": https:// added when missing, a page such as index.php and
// anything after it dropped. Plain http only on this computer, since the token travels with it.
function address(s, what) {
  let x;
  try {
    x = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "https://" + s);
  } catch {}
  if (!x || !/^https?:$/.test(x.protocol)) fail(`${what} isn't a web address (got "${s}").`);
  if (x.protocol === "http:" && !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(x.hostname))
    fail(`${what} must start with https://. Over plain http:// your token would travel unencrypted.`);
  return x.origin + x.pathname.replace(/[^/]*\.php$/, "").replace(/\/*$/, "/");
}
function idOf(s, what, where) {
  return /^\d+$/.test(s) ? s : fail(`the ${what} is a number, like 1 or 3 (got "${s}"). Find it ${where}.`);
}
function siteOf(s) {
  let u;
  try {
    u = new URL(s);
  } catch {}
  return u && /^https?:$/.test(u.protocol)
    ? u
    : fail(`--site must be the site's address, like https://www.example.com (got ${s})`);
}

// ---------- keys ----------
export const keyFile = () => join(homedir(), ".seo-supervisor", "keys.json");
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
// https://learn.microsoft.com/dotnet/api/microsoft.bing.webmaster.api.interfaces.apierrorcode
const BING_ERRORS = { 3: "key", 4: "busy", 5: "busy", 6: "blocked", 7: "url", 14: "site" };
// Matomo and PostHog live at a typed address, so a wrong address, site or project ID gets its own message.
// Matomo answers errors as { result: "error", message }, often with HTTP 200; PostHog as { detail } with the status.
function addressed(id, status, body, host, moved) {
  const s = SERVICES[id],
    fix = `Check it with node connect-keys.mjs guide ${id}, then run: ${setLine(id)}`,
    msg = String(body?.message || body?.detail || "");
  if (status >= 300 && status < 400)
    return `${s.name}: ${host} sent the request on to ${moved || "another address"}, so nothing was read. Set the address it goes to instead. ${fix}`;
  if (body === null && status < 500)
    return `${s.name}: ${host} didn't answer like ${s.name} (HTTP ${status}), so the address is probably wrong. Use the address you open ${s.name} at in your browser. ${fix}`;
  if (id === "matomo") {
    if (/authenticat|token/i.test(msg))
      return `Matomo didn't accept the token: it's mistyped, expired or was deleted. Create a new one under ${s.where}, then run: ${setLine(id)}`;
    if (/segment/i.test(msg))
      return `Matomo hasn't processed the segment for visits from search engines, so it has no report yet. In Matomo, open the segment menu above any report → Add new segment, choose Channel Type, Is, search, and save it with its reports pre-processed. Matomo fills it in within a few hours; then fetch again.`;
    if (/access|website id|idsite/i.test(msg))
      return `Matomo says this token can't see the site ID you set (${msg}). Check the site ID under Administration → Websites → Manage, and that the token's user has at least view access to that site. Then run: ${setLine(id)}`;
    if (body?.result === "error") return `Matomo said: ${msg}`;
  }
  if (id === "posthog") {
    if (status === 401)
      return `PostHog didn't accept the key (401): it's mistyped or was deleted, or it belongs to the other PostHog region (a US key doesn't work on eu.posthog.com, nor an EU key on us.posthog.com). ${fix}`;
    if (status === 403 && /scope/i.test(msg))
      return `PostHog says the key isn't allowed to read data (it lacks the Query Read permission). Create a personal API key with Query: Read under ${s.where}, then run: ${setLine(id)}`;
    if (status === 403 || status === 404)
      return `PostHog has no project with the ID you set that this key may use (${status}${msg ? `: ${msg}` : ""}). Check the project ID under Settings → Project, and that the key is allowed to use that project. ${fix}`;
    if (status === 400)
      return `PostHog couldn't run the query for visits from search engines (${msg || 400}). If it keeps happening, PostHog may have changed.`;
  }
  return null;
}
function refusal(id, status, body, retryAfter, host, moved) {
  const s = SERVICES[id];
  if (s.fields) {
    const m = addressed(id, status, body, host, moved);
    if (m) return m;
  }
  const bing = id === "bing" ? BING_ERRORS[body?.ErrorCode] : null;
  if (status === 401 || bing === "key")
    return `${s.name} didn't accept the key (${status === 401 ? 401 : "InvalidApiKey"}): it's mistyped, or it was deleted or replaced. Get the current key at ${s.where}, then run: ${setLine(id)}`;
  if (id === "openpagerank" && status === 403)
    return `Open PageRank refused the request (403): your IP address isn't the one registered for this key. Free keys only work from one registered IP address, so your internet connection or IP has probably changed. Update the IP in your Open PageRank dashboard (keywordseverywhere.com/openpagerank); it can change once a week.`;
  if (status === 429 || bing === "busy")
    return `${s.name} says too many requests (${status === 429 ? 429 : "throttled"}): the key's limit is used up for now. ${retryAfter ? `Wait ${retryAfter} seconds` : "Wait a while"} and run again.`;
  if (bing === "site")
    return `Bing Webmaster Tools says this key's account can't see the site (NotAuthorized). Verify the site in Bing Webmaster Tools with the same account the key belongs to.`;
  if (bing === "blocked")
    return `Bing Webmaster Tools says the account is blocked (UserBlocked). Sign in at bing.com/webmasters to see why.`;
  if (bing === "url")
    return `Bing Webmaster Tools refused a URL (InvalidUrl): every URL must be on the site exactly as it's verified in Bing Webmaster Tools (the same https:// and www). Check the site's address there and pass it as --site.`;
  if (status === 403)
    return `${s.name} refused the request (403): the key isn't allowed to do this. Check the key at ${s.where}, then run: ${setLine(id)}`;
  const detail =
    body?.Message || body?.message || body?.detail || body?.error || (Array.isArray(body) ? body.join(" ") : "");
  return `${s.name} answered ${status}${detail ? ` (${detail})` : ""}. Try again later; if it keeps happening, the service may have changed.`;
}
async function call(id, url, init = {}) {
  const s = SERVICES[id],
    host = new URL(url).host;
  let r;
  try {
    r = await fetch(url, {
      ...init,
      headers: { "user-agent": UA, ...init.headers },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new Refused(
      `${s.name}: couldn't reach ${host} (${e.cause?.code || e.message}). Check the internet connection${s.fields ? ` and the ${s.name} address (node connect-keys.mjs status shows it)` : ""} and try again.`,
    );
  }
  const text = await r.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!r.ok)
    throw new Refused(refusal(id, r.status, body, r.headers.get("retry-after"), host, r.headers.get("location")));
  return body;
}
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const bare = h => h.toLowerCase().replace(/^www\./, "");
export const domainOf = s => {
  try {
    const h = bare(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "https://" + s).hostname);
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null;
  } catch {
    return null;
  }
};
// The site's domain and the competitors', each once; a site with no domain name (localhost) is left out.
const domainsFor = (siteUrl, competitors) =>
  [domainOf(siteUrl), ...competitors.map(domainOf)].filter((d, i, all) => d && all.indexOf(d) === i);

// ---------- Bing Webmaster Tools ----------
// CrawlIssues is a flags enum; JSON sends the number, XML the names, so both are read.
const ISSUES = [
  ["Code301", 1, "permanent redirect (301)"],
  ["Code302", 2, "temporary redirect (302)"],
  ["Code4xx", 4, "client error (4xx)"],
  ["Code5xx", 8, "server error (5xx)"],
  ["BlockedByRobotsTxt", 16, "blocked by robots.txt"],
  ["ContainsMalware", 32, "contains malware"],
  ["ImportantUrlBlockedByRobotsTxt", 64, "important page blocked by robots.txt"],
  ["DnsErrors", 128, "DNS error"],
  ["TimeOutErrors", 256, "timed out"],
];
const issueBits = v =>
  typeof v === "number"
    ? v
    : String(v ?? "")
        .split(/[\s,]+/)
        .reduce((n, s) => n | (ISSUES.find(i => i[0] === s)?.[1] || 0), 0);
const day = ms => new Date(ms).toISOString().slice(0, 10);

// Bing takes the key only as ?apikey= (or OAuth). It's never printed, and call()'s errors name the host, not the
// URL.
const bingGet =
  (key, base) =>
  (method, params = {}) =>
    call("bing", `${base}/${method}?${new URLSearchParams({ ...params, apikey: key })}`).then(b => b?.d);
// Bing's own URL for the site (its www and https), which every other Bing call takes as siteUrl.
async function bingSite(get, site) {
  const want = new URL(site).hostname,
    hostOf = u => {
      try {
        return new URL(u).hostname;
      } catch {
        return "";
      }
    };
  const sites = (await get("GetUserSites")) || [];
  const match = sites.find(s => hostOf(s.Url) === want) || sites.find(s => bare(hostOf(s.Url)) === bare(want));
  if (!match)
    throw new Refused(
      `Bing Webmaster Tools: ${want} isn't in your Bing Webmaster Tools account. Add and verify it at bing.com/webmasters (it can import your sites from Google Search Console), then run again.`,
    );
  if (match.IsVerified === false)
    throw new Refused(
      `Bing Webmaster Tools: ${want} is in your account but isn't verified yet. Finish verifying it at bing.com/webmasters, then run again.`,
    );
  return match.Url;
}

async function fetchBing(key, site, base, notes) {
  const get = bingGet(key, base),
    want = new URL(site).hostname,
    siteUrl = await bingSite(get, site);

  const add = (map, k, r) => {
    if (k == null) return;
    const t = map.get(k) || { clicks: 0, impressions: 0 };
    t.clicks += r.Clicks || 0;
    t.impressions += r.Impressions || 0;
    map.set(k, t);
  };
  const queryRows = (await get("GetQueryStats", { siteUrl })) || [],
    q = new Map();
  for (const r of queryRows) add(q, r.Query, r);
  const queries = [...q].map(([query, t]) => ({ query, ...t })).sort((a, b) => b.impressions - a.impressions);
  // GetPageStats has the page's URL in Query. http/https and www/apex variants of one page add up, as in gsc-import.
  const pathOf = u => {
    try {
      const x = new URL(u);
      return bare(x.hostname) === bare(want) ? x.pathname + x.search : null;
    } catch {
      return null;
    }
  };
  const pageRows = (await get("GetPageStats", { siteUrl })) || [],
    p = new Map();
  for (const r of pageRows) add(p, pathOf(r.Query), r);
  const dates = [...queryRows, ...pageRows]
    .map(r => Number(/\/Date\((-?\d+)/.exec(r.Date || "")?.[1]))
    .filter(Number.isFinite);

  const pages = [];
  let total = 1;
  for (let page = 0; page < Math.min(total, MAX_LINK_PAGES); page++) {
    const d = await get("GetLinkCounts", { siteUrl, page });
    pages.push(...(d?.Links || []).map(l => ({ url: l.Url, count: l.Count })));
    total = d?.TotalPages || 0;
  }
  if (total > MAX_LINK_PAGES)
    notes.push(`Bing lists inbound links in ${total} pages of results; only the first ${MAX_LINK_PAGES} were read.`);
  const links = await get("GetUrlLinks", { siteUrl, link: new URL("/", siteUrl).href, page: 0 });
  const sample = (links?.Details || []).map(l => ({ url: l.Url, anchorText: l.AnchorText }));

  let crawlIssues = null;
  try {
    crawlIssues = ((await get("GetCrawlIssues", { siteUrl })) || []).map(r => {
      const bits = issueBits(r.Issues);
      return {
        url: r.Url,
        httpCode: r.HttpCode ?? null,
        issues: ISSUES.filter(i => bits & i[1]).map(i => i[2]),
        inLinks: r.InLinks ?? null,
      };
    });
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    notes.push(`Bing didn't give crawl issues, so they weren't checked: ${e.message}`);
  }

  return {
    siteUrl,
    period: dates.length ? { from: day(Math.min(...dates)), to: day(Math.max(...dates)) } : null,
    traffic: Object.fromEntries(p),
    queries,
    backlinks: { pages: pages.sort((a, b) => b.count - a.count), sample },
    crawlIssues,
  };
}

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

// ---------- Bing URL submission: a write to Bing, so the CLI runs it only with --yes ----------
// SubmitUrlBatch takes at most 500 URLs a batch, within what GetUrlSubmissionQuota reports. The quota differs per site,
// so it's read each time, never assumed. Returns { siteUrl, quota, sent, notSent, error }.
// https://learn.microsoft.com/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.submiturlbatch
const BATCH = 500;
export async function submitBing({ key, site, urls, endpoint }) {
  const get = bingGet(key, endpoint),
    siteUrl = await bingSite(get, site);
  const q = await get("GetUrlSubmissionQuota", { siteUrl }),
    left = v => (v == null || !(Number(v) >= 0) ? null : Math.floor(Number(v)));
  const quota = { daily: left(q?.DailyQuota), monthly: left(q?.MonthlyQuota) };
  if (quota.daily == null)
    throw new Refused(
      "Bing Webmaster Tools didn't say how many URLs it takes today (GetUrlSubmissionQuota), so nothing was sent. Try again later.",
    );
  const fits = urls.slice(0, Math.min(quota.daily, quota.monthly ?? quota.daily));
  let sent = 0,
    error = null;
  for (const urlList of chunks(fits, BATCH)) {
    try {
      await call("bing", `${endpoint}/SubmitUrlBatch?${new URLSearchParams({ apikey: key })}`, {
        ...POST,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ siteUrl, urlList }),
      });
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      error = e.message;
      break;
    }
    sent += urlList.length;
  }
  return { siteUrl, quota, sent, notSent: urls.slice(sent), error };
}

// ---------- Matomo and PostHog: visits from search engines by landing page ----------
// The same days google.mjs reads Google Analytics for, ending 3 days ago, so the numbers line up.
const periodFor = days => ({ from: day(Date.now() - (days + 2) * 864e5), to: day(Date.now() - 3 * 864e5) });
// Matomo: visits from a search engine (segment referrerType==search) by entry page, most first. Only token_auth goes
// in the POST body; the other parameters aren't secret. The splits, the same visits by device type and by country,
// cover the whole site ID; their rows are { label, code, nb_visits }.
// https://developer.matomo.org/api-reference/reporting-api-legacy
const MATOMO_SPLITS = { byDevice: "DevicesDetection.getType", byCountry: "UserCountry.getCountry" };
const matomoUrl = (k, p, method = "Actions.getEntryPageUrls") =>
  `${k.url}index.php?${new URLSearchParams({
    module: "API",
    method,
    idSite: k.siteId,
    period: "range",
    date: `${p.from},${p.to}`,
    segment: "referrerType==search",
    ...(method === "Actions.getEntryPageUrls"
      ? { flat: 1, filter_limit: ROWS, filter_sort_column: "entry_nb_visits" }
      : { filter_limit: 10, filter_sort_column: "nb_visits" }),
    filter_sort_order: "desc",
    format: "JSON",
  })}`;
// PostHog: sessions it files as Organic Search (a search engine as referrer or utm_source, paid search left out, as
// in GA4), by entry page. The site's host is matched here, not sent.
const posthogQuery = p =>
  `SELECT domainWithoutWWW($entry_current_url) AS host, $entry_pathname AS path, count() AS visits FROM sessions WHERE $channel_type = 'Organic Search' AND toDate($start_timestamp) BETWEEN toDate('${p.from}') AND toDate('${p.to}') GROUP BY host, path ORDER BY visits DESC LIMIT ${ROWS}`;
// sessions has no device or country, so the splits use its pageviews' $device_type and $geoip_country_code through
// events' `session` join. The events' dates bound the scan; a session starting in the period has its first pageview
// in it.
// https://posthog.com/docs/data/sessions
const POSTHOG_SPLITS = { byDevice: "properties.$device_type", byCountry: "properties.$geoip_country_code" };
const posthogSplit = (p, prop) =>
  `SELECT domainWithoutWWW(session.$entry_current_url) AS host, ${prop} AS k, count(DISTINCT $session_id) AS visits FROM events WHERE event = '$pageview' AND session.$channel_type = 'Organic Search' AND toDate(session.$start_timestamp) BETWEEN toDate('${p.from}') AND toDate('${p.to}') AND toDate(timestamp) BETWEEN toDate('${p.from}') AND toDate('${p.to}') GROUP BY host, k ORDER BY visits DESC LIMIT 1000`;
const posthogUrl = k => `${k.host}api/projects/${k.projectId}/query/`;
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
const SPLIT_NAME = { byDevice: "by device", byCountry: "by country" };
// A split that fails is noted; the visits by landing page stay.
async function splits(name, fields, read, notes) {
  const out = {};
  for (const [field, what] of Object.entries(fields)) {
    try {
      out[field] = top10(await read(what, field));
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      notes.push(`${name}'s visits from search engines ${SPLIT_NAME[field]} weren't read: ${e.message}`);
    }
  }
  return out;
}
// One page's http/https, www/apex and tracking-parameter variants add up, by path as GA4's landing page is.
const addVisits = (map, path, n) => {
  map[path] = { visits: (map[path]?.visits || 0) + n };
};
const tooMany = name =>
  `${name} has ${ROWS.toLocaleString("en-US")} or more pages with visits from search engines for this period; only the top ${ROWS.toLocaleString("en-US")} were read.`;
// A redirect isn't followed: on a 307 or 308 the token would go along to wherever it points.
const POST = { method: "POST", redirect: "manual" };

async function fetchMatomo(k, site, period, notes) {
  const want = bare(new URL(site).hostname),
    traffic = {};
  const read = async method => {
    const rows = await call("matomo", matomoUrl(k, period, method), {
      ...POST,
      body: new URLSearchParams({ token_auth: k.key }),
    });
    if (!Array.isArray(rows)) throw new Refused(refusal("matomo", 200, rows, null, new URL(k.url).host));
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
    field === "byDevice" ? r?.label : r?.code !== "xx" && typeof r?.code === "string" ? r.code.toUpperCase() : null;
  return {
    period,
    traffic,
    ...(await splits(
      "Matomo",
      MATOMO_SPLITS,
      async (method, field) => (await read(method)).map(r => [name(r, field), r?.nb_visits]),
      notes,
    )),
  };
}

async function fetchPosthog(k, site, period, notes) {
  const want = bare(new URL(site).hostname),
    traffic = {};
  const read = async query => {
    const b = await call("posthog", posthogUrl(k), {
      ...POST,
      headers: { authorization: `Bearer ${k.key}`, "content-type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    });
    if (!Array.isArray(b?.results)) throw new Refused(refusal("posthog", 200, null, null, new URL(k.host).host));
    return b.results;
  };
  const mine = rows => rows.filter(r => Array.isArray(r) && bare(String(r[0] ?? "")) === want);
  const rows = await read(posthogQuery(period));
  for (const [, path, n] of mine(rows)) if (/^\//.test(path) && Number(n) > 0) addVisits(traffic, path, Number(n));
  if (rows.length >= ROWS) notes.push(tooMany("PostHog"));
  return {
    period,
    traffic,
    ...(await splits(
      "PostHog",
      POSTHOG_SPLITS,
      async (prop, field) =>
        mine(await read(posthogSplit(period, prop))).map(([, v, n]) => [
          field === "byCountry" && typeof v === "string" ? v.toUpperCase() : v,
          n,
        ]),
      notes,
    )),
  };
}

// Each service runs only when its key is set. problems holds the refusals, also kept in result.notes.
// bingPages and bingSister add Bing's links to chosen pages and to a sister site in the same account.
export async function fetchKeys({ site, competitors = [], keys = activeKeys(), endpoints = {}, days = 90 }) {
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
    posthog = null;
  const run = async (id, fn) => {
    const s = SERVICES[id];
    // Analytics services (those with fields) go under Limits only when the site uses one, which SKILL.md decides.
    // Optional extras never do.
    if (!keys[id]) {
      if (!s.fields)
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
    bing = await fetchBing(key, siteUrl, end("bing"), notes);
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
  const period = periodFor(days);
  await run("matomo", async k => {
    matomo = await fetchMatomo(k, siteUrl, period, notes);
  });
  await run("posthog", async k => {
    posthog = await fetchPosthog(k, siteUrl, period, notes);
  });
  return {
    result: {
      source: "keys",
      when: new Date().toISOString(),
      site: siteUrl,
      bing,
      authority,
      attribution,
      matomo,
      posthog,
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

    if (args.yes !== true) {
      const list = domains.slice(0, 10).join(", ") + (domains.length > 10 ? ` … and ${domains.length - 10} more` : "");
      const { matomo: m, posthog: p } = keys;
      const lines = Object.entries(SERVICES).map(([id, s]) =>
        !keys[id]
          ? `  ${s.name}: not set, skipped (to add it: node connect-keys.mjs guide ${id})`
          : id === "matomo"
            ? `  Matomo: your token (in the request body, never in the address) and site ID ${m.siteId}, to ${new URL(m.url).host}:${[undefined, ...Object.values(MATOMO_SPLITS)].map(method => `\n    POST ${matomoUrl(m, period, method)}`).join("")}`
            : id === "posthog"
              ? `  PostHog: your key and project ID ${p.projectId}, to ${new URL(p.host).host}:${[posthogQuery(period), ...Object.values(POSTHOG_SPLITS).map(prop => posthogSplit(period, prop))].map(q => `\n    POST ${posthogUrl(p)} with the query: ${q}`).join("")}`
              : `  ${s.name}: ${id === "bing" ? `your site's address (${siteUrl})` : `${domains.length} domain name(s) (${list})`} and your key, to ${new URL(endpoints[id]).host}`,
      );
      console.log(
        `connect-keys: dry run, nothing sent. With --yes it would send:\n${lines.join("\n")}${skipNote.length ? "\n" + skipNote.join("\n") : ""}\nThese go to outside services, so re-run with --yes once the owner agrees.`,
      );
      return 0;
    }
    const { result, problems } = await fetchKeys({ site: siteUrl, competitors, keys, endpoints, days });
    result.notes.push(...skipNote);
    const out = resolve(str("out") || "seo-audit/keys.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(result, null, 2));
    for (const p of problems) console.log("connect-keys: " + p);
    const b = result.bing,
      visits = (name, x) => (x ? `${name} ${Object.keys(x.traffic).length} pages · ` : "");
    console.log(
      `connect-keys: ${b ? `Bing ${Object.keys(b.traffic).length} pages, ${b.queries.length} queries, ${b.backlinks.pages.length} linked pages${b.crawlIssues ? `, ${b.crawlIssues.length} crawl issues` : ""} · ` : ""}${result.authority.length ? `authority for ${result.authority.length} domain(s) · ` : ""}${visits("Matomo", result.matomo)}${visits("PostHog", result.posthog)}${result.findings.length} finding(s) · wrote ${out}`,
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
const num = n => n.toLocaleString("en-US");

// Not process.exit(): exiting while fetch's sockets close crashes Node on Windows.
if (isMain(import.meta.url)) {
  {
    const n = proxyNote();
    if (n) console.error("note: " + n);
  } // once, before any request is sent
  process.exitCode = await main(process.argv.slice(2)).then(null, e => {
    if (!(e instanceof Fail)) throw e;
    console.error(e.message);
    return 2;
  });
}
