#!/usr/bin/env node
// Services connected by an API key alone: Bing Webmaster Tools, Open PageRank and Ahrefs' free Domain Rating. Keys
// are saved in ~/.seo-supervisor/keys.json, never in the project; a service's environment variable wins over its
// saved key. fetch sends the site's address and domain names to these services, so without --yes it's a dry run
// that prints what it would send. *_ENDPOINT variables point the services at the tests' fakes.
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";

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
};
const USAGE =
  "usage: node connect-keys.mjs set bing|openpagerank|ahrefs [<key>]   (no key: it asks, hidden)\n       node connect-keys.mjs status | remove <service> | guide <service>\n       node connect-keys.mjs fetch --site https://www.example.com [--competitors a.com,b.com] [--out seo-audit/keys.json] [--yes]";
const UA = "seo-supervisor-connect-keys";
const ATTRIBUTION = { text: "Domain Rating by Ahrefs", url: "https://ahrefs.com/" };
const MAX_LINK_PAGES = 10;
class Fail extends Error {} // bad input: exit 2
class Refused extends Error {} // a service said no: noted, the rest still runs, exit 1
const fail = msg => {
  throw new Fail("connect-keys: " + msg);
};
const serviceOf = id =>
  Object.hasOwn(SERVICES, id) ? id : fail(`there's no "${id}" connection. Use bing, openpagerank or ahrefs.`);

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

// The key from the terminal, without showing it, or the first line of piped stdin.
async function readKey(id) {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) {
    let text = "";
    for await (const c of stdin) {
      text += c;
      if (text.includes("\n")) break;
    }
    return (
      text.split(/\r?\n/)[0].trim() ||
      fail(`no key was given. In your own terminal, run ${setLine(id)} and paste the key when it asks.`)
    );
  }
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
export function setKey(id, key) {
  serviceOf(id);
  key = String(key ?? "").trim();
  if (!key || /\s/.test(key))
    fail(`that doesn't look like a key (it's empty or has spaces). Copy it again from ${SERVICES[id].where}.`);
  save({ ...savedKeys(), [id]: key });
}
export function removeKey(id) {
  serviceOf(id);
  const keys = savedKeys();
  if (!(id in keys)) return false;
  delete keys[id];
  save(keys);
  return true;
}
// { bing: { key, from } | null, ... }; an environment variable wins over the saved key.
export function activeKeys(env = process.env) {
  const saved = savedKeys();
  return Object.fromEntries(
    Object.entries(SERVICES).map(([id, s]) => [
      id,
      env[s.env] ? { key: env[s.env], from: s.env } : saved[id] ? { key: saved[id], from: keyFile() } : null,
    ]),
  );
}
const mask = k => (k.length > 8 ? "…" + k.slice(-4) : "…");

// ---------- requests ----------
const BING_ERRORS = { 3: "key", 4: "busy", 5: "busy", 6: "blocked", 14: "site" };
function refusal(id, status, body, retryAfter) {
  const s = SERVICES[id];
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
  if (status === 403)
    return `${s.name} refused the request (403): the key isn't allowed to do this. Check the key at ${s.where}, then run: ${setLine(id)}`;
  const detail = body?.Message || body?.error || (Array.isArray(body) ? body.join(" ") : "");
  return `${s.name} answered ${status}${detail ? ` (${detail})` : ""}. Try again later; if it keeps happening, the service may have changed.`;
}
async function call(id, url, init = {}) {
  let r;
  try {
    r = await fetch(url, {
      ...init,
      headers: { "user-agent": UA, ...init.headers },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new Refused(
      `${SERVICES[id].name}: couldn't reach ${new URL(url).host} (${e.cause?.code || e.message}). Check the internet connection and try again.`,
    );
  }
  const text = await r.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!r.ok) throw new Refused(refusal(id, r.status, body, r.headers.get("retry-after")));
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

async function fetchBing(key, site, base, notes) {
  const get = (method, params = {}) =>
    call("bing", `${base}/${method}?${new URLSearchParams({ ...params, apikey: key })}`).then(b => b?.d);
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
  const siteUrl = match.Url;

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

// Each service runs only when its key is set. problems holds the refusals, also kept in result.notes.
// bingPages and bingSister add Bing's links to chosen pages and to a sister site in the same account.
export async function fetchKeys({ site, competitors = [], keys = activeKeys(), endpoints = {} }) {
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
    attribution = null;
  const run = async (id, fn) => {
    const s = SERVICES[id];
    if (!keys[id]) {
      notChecked.push({
        area: `${s.name}: ${s.adds}`,
        reason: `No key set. To connect it: node connect-keys.mjs guide ${id}`,
      });
      return;
    }
    try {
      await fn(keys[id].key ?? keys[id]);
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
  return {
    result: {
      source: "keys",
      when: new Date().toISOString(),
      site: siteUrl,
      bing,
      authority,
      attribution,
      findings: crawlFinding(bing),
      notChecked,
      notes,
    },
    problems,
  };
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const args = {};
  for (let i = 0; i < rest.length; i++)
    if (rest[i].startsWith("--")) {
      const k = rest[i].slice(2);
      args[k] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true;
    }
  const str = k => (typeof args[k] === "string" ? args[k] : null);

  if (cmd === "set") {
    if (!rest[0]) throw new Fail(USAGE);
    setKey(rest[0], rest[1] ?? (await readKey(serviceOf(rest[0]))));
    console.log(
      `connect-keys: saved the ${SERVICES[rest[0]].name} key in ${keyFile()} (only your user account can read it). ${process.env[SERVICES[rest[0]].env] ? `Note: ${SERVICES[rest[0]].env} is also set and wins over the saved key.` : ""}`.trim(),
    );
  } else if (cmd === "remove") {
    if (!rest[0]) throw new Fail(USAGE);
    console.log(
      removeKey(rest[0])
        ? `connect-keys: removed the ${SERVICES[rest[0]].name} key.`
        : `connect-keys: no saved ${SERVICES[rest[0]].name} key to remove.`,
    );
  } else if (cmd === "guide") {
    if (!rest[0]) throw new Fail(USAGE);
    console.log(SERVICES[serviceOf(rest[0])].guide.join("\n"));
  } else if (cmd === "status") {
    const keys = activeKeys();
    for (const [id, s] of Object.entries(SERVICES)) {
      const k = keys[id];
      console.log(
        k
          ? `${s.name}: set (${mask(k.key)}, ${k.from === s.env ? `from ${s.env}` : `saved in ${k.from}`})`
          : `${s.name}: not set. It adds ${s.adds}. To get a key: node connect-keys.mjs guide ${id}`,
      );
    }
  } else if (cmd === "fetch") {
    if (!str("site")) throw new Fail(USAGE);
    let site;
    try {
      site = new URL(args.site);
    } catch {}
    if (!site || !/^https?:$/.test(site.protocol))
      fail(`--site must be the site's address, like https://www.example.com (got ${args.site})`);
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
      const lines = Object.entries(SERVICES).map(([id, s]) =>
        !keys[id]
          ? `  ${s.name}: not set, skipped (to add it: node connect-keys.mjs guide ${id})`
          : `  ${s.name}: ${id === "bing" ? `your site's address (${siteUrl})` : `${domains.length} domain name(s) (${list})`} and your key, to ${new URL(endpoints[id]).host}`,
      );
      console.log(
        `connect-keys: dry run, nothing sent. With --yes it would send:\n${lines.join("\n")}${skipNote.length ? "\n" + skipNote.join("\n") : ""}\nThese go to outside services, so re-run with --yes once the owner agrees.`,
      );
      return 0;
    }
    const { result, problems } = await fetchKeys({ site: siteUrl, competitors, keys, endpoints });
    result.notes.push(...skipNote);
    const out = resolve(str("out") || "seo-audit/keys.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(result, null, 2));
    for (const p of problems) console.log("connect-keys: " + p);
    const b = result.bing;
    console.log(
      `connect-keys: ${b ? `Bing ${Object.keys(b.traffic).length} pages, ${b.queries.length} queries, ${b.backlinks.pages.length} linked pages${b.crawlIssues ? `, ${b.crawlIssues.length} crawl issues` : ""} · ` : ""}${result.authority.length ? `authority for ${result.authority.length} domain(s) · ` : ""}${result.findings.length} finding(s) · wrote ${out}`,
    );
    return problems.length ? 1 : 0;
  } else throw new Fail(USAGE);
  return 0;
}

// Not process.exit(): exiting while fetch's sockets close crashes Node on Windows.
if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2)).then(null, e => {
    if (!(e instanceof Fail)) throw e;
    console.error(e.message);
    return 2;
  });
}
