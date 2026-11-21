#!/usr/bin/env node
// Reads the site's own access logs to show how search and AI crawlers actually treat the site.
// Detected per line: Apache/Nginx combined and common format (anything may precede [time], so vhost_combined works),
// or JSON lines, Cloudflare Logpush field names included.
import { createReadStream, existsSync, statSync, readdirSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";
import { BlockList, isIP } from "node:net";

const args = { log: [] };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i].replace(/^--/, ""),
    v = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  if (k === "log") args.log.push(v);
  else args[k] = v;
}
const fail = msg => {
  console.error(`log-scan: ${msg}`);
  process.exit(2);
};
if (!args.log.length || args.log.some(v => typeof v !== "string")) {
  console.error(
    "usage: node log-scan.mjs --log access.log [--log logs/] [--since YYYY-MM-DD] [--site-origin https://x] [--crawl seo-audit/seo-crawl.json] [--verify-ips [folder]] [--out seo-audit/log-scan.json]",
  );
  process.exit(2);
}
const OUT = resolve(typeof args.out === "string" ? args.out : "seo-audit/log-scan.json");
const SINCE = args.since === undefined ? null : Date.parse(`${args.since}T00:00:00Z`);
if (args.since !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(args.since) || isNaN(SINCE)))
  fail(`--since takes a date as YYYY-MM-DD (e.g. 2026-10-01), not "${args.since}".`);
let ORIGIN = "";
if (typeof args["site-origin"] === "string") {
  try {
    ORIGIN = new URL(args["site-origin"]).origin;
  } catch {
    fail(`--site-origin must be a URL like https://www.example.com, not "${args["site-origin"]}".`);
  }
}

// [user-agent token, vendor, group, what the vendor says the bot is for]. Matched as a case-insensitive User-Agent
// substring and the first match wins, so Google's other agents sit above Googlebot. Google-Extended and
// Applebot-Extended are robots.txt tokens, not user agents: Google and Apple crawl as Googlebot and Applebot and apply
// them to later use of the content, so logs can't show them. Google-NotebookLM, Google-GeminiNotebook's former name,
// is supported until August 2026. cohere-ai isn't here: Cohere runs no crawler.
// https://developers.openai.com/api/docs/bots
// https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
// https://developers.google.com/search/docs/crawling-indexing/google-user-triggered-fetchers
// https://docs.cohere.com/docs/cohere-web-crawlers
const BOTS = [
  [
    "Google-CloudVertexBot",
    "Google",
    "other",
    "Crawls a site only when its owner sets up a Vertex AI agent on it; no effect on Google Search",
  ],
  [
    "Google-Agent",
    "Google",
    "ai-search",
    "Browses pages and acts on them for a user, from agents on Google's servers; robots.txt may not apply",
  ],
  ["Google-GeminiNotebook", "Google", "ai-search", "Fetches a page a Gemini Notebook user added as a source"],
  [
    "Google-NotebookLM",
    "Google",
    "ai-search",
    "Fetches a page a NotebookLM user added as a source (the former name of Google-GeminiNotebook)",
  ],
  ["GoogleMessages", "Google", "other", "Builds link previews for URLs sent in Google Messages chats"],
  ["OAI-AdsBot", "OpenAI", "other", "Checks landing pages submitted as ChatGPT ads; not used for training"],
  ["Googlebot", "Google", "search", "Crawls for Google Search, including AI Overviews and AI Mode"],
  ["Bingbot", "Microsoft", "search", "Crawls for Bing; Copilot answers are grounded in Bing's index"],
  ["Applebot", "Apple", "search", "Crawls for Siri, Spotlight and Safari suggestions"],
  ["DuckDuckBot", "DuckDuckGo", "search", "Crawls for DuckDuckGo search"],
  ["YandexBot", "Yandex", "search", "Crawls for Yandex search"],
  ["OAI-SearchBot", "OpenAI", "ai-search", "Crawls so sites can be shown and linked in ChatGPT search"],
  ["ChatGPT-User", "OpenAI", "ai-search", "Fetches a page when a ChatGPT user's request needs it"],
  ["Claude-SearchBot", "Anthropic", "ai-search", "Crawls to improve the search results Claude cites"],
  ["Claude-User", "Anthropic", "ai-search", "Fetches a page when a Claude user's request needs it"],
  ["PerplexityBot", "Perplexity", "ai-search", "Crawls so sites can be shown and linked in Perplexity answers"],
  ["Perplexity-User", "Perplexity", "ai-search", "Fetches a page when a Perplexity user's request needs it"],
  ["MistralAI-User", "Mistral AI", "ai-search", "Fetches a page when a Le Chat user's request needs it"],
  ["GPTBot", "OpenAI", "ai-training", "Collects content to train OpenAI's models"],
  ["ClaudeBot", "Anthropic", "ai-training", "Collects content to train Anthropic's models"],
  ["CCBot", "Common Crawl", "ai-training", "Builds the open Common Crawl dataset, widely used to train AI models"],
  ["Bytespider", "ByteDance", "ai-training", "Collects content to train ByteDance's models"],
  [
    "meta-externalagent",
    "Meta",
    "ai-training",
    "Collects content to train Meta's AI models and index it for Meta's products",
  ],
  [
    "Amazonbot",
    "Amazon",
    "ai-training",
    "Crawls for Amazon's services, including Alexa answers and training Amazon's AI models",
  ],
].map(([name, vendor, group, purpose]) => ({ name, token: name.toLowerCase(), vendor, group, purpose }));
// Every vendor list uses the { prefixes: [{ ipv4Prefix | ipv6Prefix }] } format. Google doesn't tie Gemini Notebook
// or Messages to one of its two user-triggered files, so either counts.
// https://developers.google.com/search/docs/crawling-indexing/verifying-googlebot
const G = "https://developers.google.com/static/crawling/ipranges/",
  GOOGLE_USER = [G + "user-triggered-fetchers-google.json", G + "user-triggered-fetchers.json"],
  CLAUDE = ["https://claude.com/crawling/bots.json"];
const IP_LISTS = {
  Googlebot: [G + "common-crawlers.json"],
  "Google-CloudVertexBot": [G + "common-crawlers.json"],
  "Google-Agent": [G + "user-triggered-agents.json"],
  "Google-GeminiNotebook": GOOGLE_USER,
  "Google-NotebookLM": GOOGLE_USER,
  GoogleMessages: GOOGLE_USER,
  Bingbot: ["https://www.bing.com/toolbox/bingbot.json"],
  Applebot: ["https://search.developer.apple.com/applebot.json"],
  CCBot: ["https://index.commoncrawl.org/ccbot.json"],
  "OAI-SearchBot": ["https://openai.com/searchbot.json"],
  "ChatGPT-User": ["https://openai.com/chatgpt-user.json"],
  GPTBot: ["https://openai.com/gptbot.json"],
  "OAI-AdsBot": ["https://openai.com/adsbot.json"],
  "Claude-SearchBot": CLAUDE,
  "Claude-User": CLAUDE,
  ClaudeBot: CLAUDE,
  PerplexityBot: ["https://www.perplexity.ai/perplexitybot.json"],
  "Perplexity-User": ["https://www.perplexity.ai/perplexity-user.json"],
};
// bot name -> the BlockLists of its lists that loaded; null without --verify-ips. A folder holds lists saved under
// their own file names (searchbot.json, common-crawlers.json …); a list that's missing or unreadable is skipped.
// Downloading sends one GET per list and nothing about the site.
let ipLists = null;
if (args["verify-ips"] !== undefined) {
  const from = args["verify-ips"],
    loaded = new Map();
  for (const u of new Set(Object.values(IP_LISTS).flat())) {
    try {
      const j =
        typeof from === "string"
          ? JSON.parse(readFileSync(join(from, basename(new URL(u).pathname)), "utf8"))
          : await (await fetch(u, { signal: AbortSignal.timeout(20000) })).json();
      const bl = new BlockList();
      for (const p of j.prefixes || []) {
        const [net, bits] = String(p.ipv4Prefix || p.ipv6Prefix || "").split("/"),
          v = isIP(net);
        if (v) bl.addSubnet(net, Number(bits ?? (v === 6 ? 128 : 32)), v === 6 ? "ipv6" : "ipv4");
      }
      loaded.set(u, bl);
    } catch {}
  }
  ipLists = new Map(
    Object.entries(IP_LISTS)
      .map(([bot, us]) => [bot, us.filter(u => loaded.has(u)).map(u => loaded.get(u))])
      .filter(([, bls]) => bls.length),
  );
}
// true when ip is in the bot's lists, false when it isn't, null when the line has no address.
const fromVendor = (name, ip) => {
  const a = String(ip ?? "")
      .trim()
      .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, ""),
    v = isIP(a);
  return v ? ipLists.get(name).some(bl => bl.check(a, v === 6 ? "ipv6" : "ipv4")) : null;
};
const AI_REFERRERS = [
  "chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
];

// ---------- parsing ----------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const clfTime = s => {
  // "10/Oct/2026:13:55:36 +0500"
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(s),
    mo = m && MONTHS.indexOf(m[2].toLowerCase()) + 1;
  return mo ? new Date(`${m[3]}-${String(mo).padStart(2, "0")}-${m[1]}T${m[4]}${m[5]}:${m[6]}`) : null;
};
const anyTime = v => {
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) v = Number(v);
  if (typeof v === "number") return new Date(v > 1e15 ? v / 1e6 : v > 1e11 ? v : v * 1000); // ns, ms or s since 1970
  return typeof v === "string" ? clfTime(v) || new Date(v) : null;
};
const pick = (o, ...keys) => {
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
};
const Q = String.raw`"((?:[^"\\]|\\.)*)"`; // a quoted field; Apache escapes quotes inside it as \"
// Detected per line: Apache/Nginx combined and common format (anything may precede [time], so vhost_combined works),
// or JSON lines, Cloudflare Logpush field names included.
const CLF = new RegExp(String.raw`\[([^\]]+)\] ${Q} (\d{3}) \S+(?: ${Q} ${Q})?`);
const parse = line => {
  if (line[0] === "{") {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      return null;
    }
    return {
      time: anyTime(
        pick(o, "time", "timestamp", "@timestamp", "date", "time_local", "time_iso8601", "EdgeStartTimestamp"),
      ),
      target: pick(o, "path", "url", "uri", "request_uri", "ClientRequestURI", "ClientRequestPath"),
      status: Number(pick(o, "status", "status_code", "EdgeResponseStatus")),
      ua: pick(o, "ua", "user_agent", "userAgent", "http_user_agent", "ClientRequestUserAgent"),
      referer: pick(o, "referer", "referrer", "http_referer", "ClientRequestReferer"),
      ip: pick(o, "ip", "remote_addr", "client_ip", "clientIp", "ClientIP", "remote_ip", "remoteIp"),
    };
  }
  const m = CLF.exec(line);
  // The client address is the third field before [time] (host ident user), whatever comes before it.
  return (
    m && {
      time: clfTime(m[1]),
      target: m[2].split(" ")[1],
      status: Number(m[3]),
      ua: m[5],
      referer: m[4],
      ip: /(\S+) \S+ \S+ \[/.exec(line)?.[1],
    }
  );
};
// Path plus query, whether the log wrote "/a?b" or "https://host/a?b".
const pathOf = t => {
  try {
    const u = new URL(t, "http://x.invalid");
    return u.pathname + u.search;
  } catch {
    return null;
  }
};
const hostOf = s => {
  try {
    return new URL(s).hostname.toLowerCase();
  } catch {
    return "";
  }
};
// Paths the crawl reached, which it only does through internal links, the sitemap or the start URL.
let CRAWLED = null;
if (args.crawl !== undefined) {
  try {
    const c = JSON.parse(readFileSync(args.crawl, "utf8"));
    CRAWLED = new Set([...c.pages, ...(c.errors || [])].map(p => pathOf(p.url)));
  } catch {
    fail(`--crawl takes the crawler's seo-audit/seo-crawl.json, and ${args.crawl} isn't one.`);
  }
}

// ---------- reading ----------
const files = [];
for (const p of args.log) {
  if (!existsSync(p)) fail(`${p} doesn't exist. Pass an access log, a .gz of one, or a folder of them.`);
  if (statSync(p).isDirectory())
    files.push(
      ...readdirSync(p)
        .sort()
        .map(f => join(p, f))
        .filter(f => statSync(f).isFile()),
    );
  else files.push(p);
}
if (!files.length) fail(`no files in ${args.log.join(", ")}.`);

// One Map entry per distinct path per bot, held in memory: fine for a few million paths. Stream to disk past that.
const bots = {},
  referrals = {},
  period = { from: null, to: null },
  notes = [];
const stats = { files: files.length, lines: 0, parsed: 0, unparsed: 0, beforeSince: 0, undated: 0 };
let sawUa = false;
const iso = d => d && d.toISOString();
const handle = raw => {
  const line = raw.replace(/^﻿/, "").trim();
  if (!line) return;
  stats.lines++;
  const r = parse(line),
    path = r && typeof r.target === "string" ? pathOf(r.target) : null;
  if (!path || !(r.status >= 100 && r.status < 600)) {
    stats.unparsed++;
    return;
  }
  const time = r.time && !isNaN(r.time) ? r.time : null;
  if (SINCE !== null && !time) {
    stats.undated++;
    return;
  }
  if (SINCE !== null && time < SINCE) {
    stats.beforeSince++;
    return;
  }
  stats.parsed++;
  if (r.ua != null) sawUa = true;
  if (time) {
    if (!period.from || time < period.from) period.from = time;
    if (!period.to || time > period.to) period.to = time;
  }
  const ua = String(r.ua ?? "").toLowerCase(),
    bot = BOTS.find(b => ua.includes(b.token));
  if (bot) {
    const b = (bots[bot.name] ||= {
      bot,
      requests: 0,
      refused: 0,
      status: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
      paths: new Map(),
      first: null,
      last: null,
      ip: null,
    });
    b.requests++;
    if (ipLists?.has(bot.name)) {
      const ok = fromVendor(bot.name, r.ip),
        c = (b.ip ||= { verified: 0, other: 0, unknown: 0, refused: 0 });
      c[ok === null ? "unknown" : ok ? "verified" : "other"]++;
      if (ok && (r.status === 401 || r.status === 403)) c.refused++;
    }
    const cls = `${Math.floor(r.status / 100)}xx`;
    if (cls in b.status) b.status[cls]++;
    const p = b.paths.get(path) || b.paths.set(path, { n: 0, s5xx: 0, s404: 0, refused: 0 }).get(path);
    p.n++;
    if (r.status >= 500) p.s5xx++;
    if (r.status === 404) p.s404++;
    if (r.status === 401 || r.status === 403) {
      p.refused++;
      b.refused++;
    }
    if (time) {
      if (!b.first || time < b.first) b.first = time;
      if (!b.last || time > b.last) b.last = time;
    }
    return;
  }
  if (r.status < 200 || r.status >= 300) return; // a redirect and the page it leads to would be two visits
  const host = hostOf(r.referer),
    source =
      AI_REFERRERS.find(d => host === d || host.endsWith("." + d)) ||
      (/[?&]utm_source=chatgpt\.com(&|$)/i.test(path) ? "chatgpt.com" : null);
  if (source) {
    const pages = (referrals[source] ||= new Map()),
      page = path.split("?")[0];
    pages.set(page, (pages.get(page) || 0) + 1);
  }
};
for (const f of files) {
  const input = f.endsWith(".gz") ? pipeline(createReadStream(f), createGunzip(), () => {}) : createReadStream(f);
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) handle(line);
  } catch (e) {
    if (files.length === 1) fail(`couldn't read ${f}: ${e.message}`);
    notes.push(`Couldn't read ${f} (${e.message}), so it was skipped from there on.`);
  }
}
const named = files.length === 1 ? files[0] : `${files.length} files in ${args.log.join(", ")}`;
if (!stats.lines) fail(`${named} has no log lines.`);
if (!stats.parsed && !stats.beforeSince && !stats.undated)
  fail(
    `${named} isn't an access log: none of its ${stats.lines} line(s) is Apache/Nginx combined or common log format, or JSON lines with a time, path or url, status and user agent.`,
  );

// ---------- summary ----------
const top = (map, value, n) =>
  [...map]
    .filter(([, v]) => value(v) > 0)
    .sort((a, b) => value(b[1]) - value(a[1]))
    .slice(0, n);
const botsOut = Object.fromEntries(
  Object.values(bots)
    .sort((a, b) => b.requests - a.requests)
    .map(b => [
      b.bot.name,
      {
        vendor: b.bot.vendor,
        group: b.bot.group,
        purpose: b.bot.purpose,
        requests: b.requests,
        paths: b.paths.size,
        status: b.status,
        topPaths: top(b.paths, v => v.n, 10).map(([path, v]) => ({ path, requests: v.n })),
        firstSeen: iso(b.first),
        lastSeen: iso(b.last),
        ...(b.ip ? { ipCheck: { verified: b.ip.verified, other: b.ip.other, unknown: b.ip.unknown } } : {}),
      },
    ]),
);
const aiReferrals = Object.fromEntries(
  Object.entries(referrals)
    .map(([s, pages]) => [
      s,
      {
        visits: [...pages.values()].reduce((a, b) => a + b, 0),
        topPages: top(pages, v => v, 10).map(([path, visits]) => ({ path, visits })),
      },
    ])
    .sort((a, b) => b[1].visits - a[1].visits),
);

// ---------- findings ----------
const findings = [];
const url = p => ORIGIN + p,
  pct = x => `${Math.round(x * 1000) / 10}%`,
  list = ps => ps.map(([p, n]) => `${p} (${n})`).join(", ");
const finding = (check, rule, severity, category, title, why, fix, evidence, count = evidence.length) => {
  if (!evidence.length) return;
  const ex = evidence[0];
  findings.push({
    check,
    rule,
    severity,
    category,
    title: title(count),
    what: `${count === 1 ? "Found on" : `${count} cases, for example`} ${ex.url} (${ex.detail}).`,
    why,
    fix,
    count,
    evidence,
    source: "server-logs",
    status: severity === "needs-decision" ? "needs-decision" : "open",
  });
};
const crawlers = Object.values(bots).filter(b => b.requests >= 5);

// A few server errors are noise; a pattern is at least 5 errors and 1% of the bot's requests.
const failingBots = Object.values(bots).filter(
  b =>
    (b.bot.group === "search" || b.bot.group === "ai-search") &&
    b.status["5xx"] >= 5 &&
    b.status["5xx"] / b.requests >= 0.01,
);
const errors = failingBots.map(b => {
  const failing = top(b.paths, v => v.s5xx, 3).map(([p, v]) => [p, v.s5xx]);
  return {
    url: url(failing[0][0]),
    detail: `${b.bot.name}: ${b.status["5xx"]} of ${b.requests} requests (${pct(b.status["5xx"] / b.requests)}) got a server error, most on ${list(failing)}`,
  };
});
const inGroup = g => failingBots.filter(b => b.bot.group === g).length;
const who = [
  inGroup("search") && `${inGroup("search")} search crawler(s)`,
  inGroup("ai-search") && `${inGroup("ai-search")} AI search or answer bot(s)`,
]
  .filter(Boolean)
  .join(" and ");
finding(
  "bot-errors",
  "CRAWL-05",
  failingBots.some(b => b.status["5xx"] >= 50 || b.status["5xx"] / b.requests >= 0.05) ? "high" : "medium",
  "Crawling & indexing",
  () => `${who} got server errors (5xx) on 1% or more of their requests`,
  "Requests claiming to be these crawlers got 5xx responses. Crawlers slow down on a site that keeps failing, and pages that fail again and again drop out of the index and out of AI answers.",
  "Look up the failing routes in the server's error log at those times and fix them; a page must not fail because a slow API or database is down. Planned maintenance that answers 503 with a Retry-After header is fine and needs no fix.",
  errors,
);

// Bots and scanners probe for these on every site; a 404 is the right answer, so they're left out.
const PROBE = /^\/(\.env|wp-|xmlrpc\.php|\.git(\/|$))/i;
const notFound = new Map();
for (const b of Object.values(bots))
  if (b.bot.group === "search")
    for (const [p, v] of b.paths)
      if (v.s404 && !PROBE.test(p)) {
        const x = notFound.get(p) || notFound.set(p, { n: 0, bots: new Set() }).get(p);
        x.n += v.s404;
        x.bots.add(b.bot.name);
      }
const repeated = top(notFound, v => (v.n >= 5 ? v.n : 0), Infinity);
// A 404 is right for a removed page, so only the ones the site itself still links to (per --crawl) are findings.
const linked = ([p]) => !!CRAWLED?.has(p),
  linked404 = repeated.filter(linked);
const repeated404s = repeated.filter(r => !linked(r)).map(([path, v]) => ({ path, requests: v.n, bots: [...v.bots] }));
finding(
  "bot-404s",
  "CRAWL-07",
  "medium",
  "Crawling & indexing",
  n => `${n} URL(s) the site links to keep returning 404 to search crawlers`,
  "Search crawlers keep asking for these URLs and get a 404, and the site's own links or sitemap still point at them, so visitors hit the same dead ends.",
  "If the page moved, 301 the old URL to its new home and update the links. If it's gone for good, keep the 404 or return 410 and remove the internal links and sitemap entries that still point at it (the crawler's broken-internal-link check lists them).",
  linked404
    .slice(0, 20)
    .map(([p, v]) => ({ url: url(p), detail: `404 for ${v.n} requests from ${[...v.bots].join(", ")}` })),
  linked404.length,
);
if (repeated404s.length)
  notes.push(
    `${repeated404s.length} URL(s) keep returning 404 to search crawlers (listed under repeated404s)${CRAWLED ? " and the site doesn't link to them" : ""}. A 404 is the right answer for a removed page; if one moved, 301 it to its new home${CRAWLED ? "." : ", and pass --crawl seo-audit/seo-crawl.json to see which are linked from the site."}`,
  );

// With --verify-ips, only requests from the vendor's addresses count (a fake is rightly refused), once any line had
// one.
const checked = b => b.ip && b.ip.verified + b.ip.other > 0;
const refused = crawlers
  .filter(b => b.bot.group === "ai-search")
  .map(b => [b, ...(checked(b) ? [b.ip.refused, b.ip.verified] : [b.refused, b.requests])])
  .filter(([, n, of]) => of >= 5 && n / of > 0.5)
  .map(([b, n, of]) => ({
    url: url(top(b.paths, v => v.refused, 1)[0][0]),
    detail: `${b.bot.name}: ${n} of ${of} requests${checked(b) ? ` from ${b.bot.vendor}'s addresses` : ""} (${pct(n / of)}) refused with 403 or 401`,
  }));
finding(
  "ai-bots-blocked-in-practice",
  "MAP-06",
  "needs-decision",
  "Sitemaps & robots",
  n => `${n} AI search crawler(s) are mostly refused by the server (403/401)`,
  "Requests claiming to be these AI search crawlers are mostly refused. That's usually a firewall, CDN bot setting or security plugin, and robots.txt doesn't show it, so the site can be left out of ChatGPT, Claude or Perplexity answers without anyone deciding that. Spoofed bots are rightly refused, so check the IPs first.",
  "Decide whether these crawlers should reach the site and record it in the profile (MAP-06). To allow them, let the vendor's published IP ranges through the WAF or CDN bot rules (openai.com/searchbot.json, perplexity.ai/perplexitybot.json); to keep them out, a robots.txt rule says so openly.",
  refused,
);
findings.forEach((f, i) => {
  f.id = "L-" + String(i + 1).padStart(3, "0");
});

notes.unshift(
  ipLists
    ? "User agents can be spoofed, so every count here is requests claiming to be that bot; ipCheck says how many came from the vendor's published addresses."
    : "User agents can be spoofed, so every count here is requests claiming to be that bot. Before acting on one bot's numbers, check its IPs against the vendor's published IP list: --verify-ips does that.",
);
if (ipLists) {
  const fakes = Object.values(bots)
    .filter(b => b.ip?.other)
    .map(b => `${b.bot.name} ${b.ip.other} of ${b.requests}`);
  if (fakes.length)
    notes.push(
      `Some requests claiming to be a known bot came from addresses outside the vendor's published list, so they're most likely fakes (or the log records a proxy's or CDN's address instead of the visitor's): ${fakes.join(", ")}. The finding about refused AI crawlers counts only requests from the vendors' addresses.`,
    );
  const noIp = Object.values(bots)
    .filter(b => b.ip && !checked(b))
    .map(b => b.bot.name);
  if (noIp.length)
    notes.push(`The log lines for ${noIp.join(", ")} carry no client address, so --verify-ips couldn't check them.`);
  const unlisted = Object.keys(bots).filter(n => IP_LISTS[n] && !ipLists.has(n));
  if (unlisted.length) notes.push(`No IP list loaded for ${unlisted.join(", ")}, so those requests weren't checked.`);
}
if (stats.parsed && !sawUa)
  notes.push(
    "These logs don't record user agents, so bots can't be told apart. Log in the combined format (or JSON with the user agent) to see crawler activity.",
  );
else if (!Object.values(bots).some(b => b.bot.group === "ai-search"))
  notes.push(
    `No requests claiming to be an AI search or answer bot (${BOTS.filter(b => b.group === "ai-search")
      .map(b => b.name)
      .join(
        ", ",
      )}) in these logs. That's common and not a problem by itself; if the site wants to be cited in AI answers, check robots.txt and the firewall let them in (MAP-06).`,
  );
if (!Object.keys(aiReferrals).length)
  notes.push(
    `No visits referred by AI assistants (${AI_REFERRERS.join(", ")}, or utm_source=chatgpt.com) in these logs. Some assistants and apps send no referrer, so this undercounts anyway.`,
  );

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      source: "server-logs",
      since: args.since ?? null,
      period: { from: iso(period.from), to: iso(period.to) },
      stats,
      bots: botsOut,
      aiReferrals,
      repeated404s,
      notes,
      findings,
    },
    null,
    2,
  ),
);
console.log(
  `log-scan: ${stats.lines} lines from ${stats.files} file(s) (${stats.unparsed} unparsed), ${Object.keys(botsOut).length} bots, ${Object.keys(aiReferrals).length} AI referral sources, ${findings.length} findings · wrote ${OUT}`,
);
