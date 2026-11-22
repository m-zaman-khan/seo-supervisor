#!/usr/bin/env node
// @ts-check
// Reads the site's own access logs to show how search and AI crawlers actually treat the site.
import { createReadStream, existsSync, statSync, readdirSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { basename, dirname, join, resolve } from "node:path";
import { BlockList, isIP } from "node:net";
import { promises as dns } from "node:dns";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain } from "./lib/cli.mjs";
import { findingOf, numbered } from "./lib/findings.mjs";
import { BOTS as BOT_ROWS } from "./checks/agents.mjs";

// --site is the other scripts' name for --site-origin.
const USAGE =
  "usage: node log-scan.mjs --log access.log [--log logs/] [--since YYYY-MM-DD] [--site-origin https://x] [--crawl seo-audit/seo-crawl.json] [--verify-ips [folder]] [--out seo-audit/log-scan.json]";
async function main(argv) {
  const args = parseArgs(argv, {
    flags: ["since", "site-origin", "crawl", "verify-ips", "out"],
    lists: ["log"],
    aliases: { site: "site-origin" },
    positionals: 0,
    usage: USAGE,
  });
  args.log ||= [];
  /** @type {(msg: string) => never} */
  const fail = msg => {
    throw new Fail(`log-scan: ${msg}`);
  };
  if (!args.log.length || args.log.some(v => typeof v !== "string")) throw new Fail(USAGE);
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

  // Matched as a case-insensitive User-Agent substring and the first match wins, so Google's other agents sit above
  // Googlebot in data/ai-bots.json. Rows with no group (Google-Extended, Applebot-Extended, YandexAdditionalBot) are
  // robots.txt tokens, not user agents, so logs can't show them.
  const BOTS = BOT_ROWS.filter(b => b.group).map(({ name, vendor, group, purpose }) => ({
    name,
    token: name.toLowerCase(),
    vendor,
    group,
    purpose,
  }));
  // Every vendor list uses the { prefixes: [{ ipv4Prefix | ipv6Prefix }] } format. Google doesn't tie Gemini Notebook
  // or Messages to one of its two user-triggered files, so either counts.
  // https://developers.google.com/search/docs/crawling-indexing/verifying-googlebot
  // Lists published only as TOML or web pages (a row's ipsAt) can't be read here; UNREADABLE names them in a note.
  const IP_LISTS = Object.fromEntries(BOT_ROWS.filter(b => b.group && b.ips).map(b => [b.name, b.ips]));
  const UNREADABLE = Object.fromEntries(BOT_ROWS.filter(b => b.group && b.ipsAt).map(b => [b.name, b.ipsAt]));
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
        .map(([bot, us]) => /** @type {const} */ ([bot, us.filter(u => loaded.has(u)).map(u => loaded.get(u))]))
        .filter(([, bls]) => bls.length),
    );
  }
  // The log's client address, an IPv4-mapped IPv6 one read as IPv4; null when the line has none.
  const addrOf = ip => {
    const a = String(ip ?? "")
      .trim()
      .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
    return isIP(a) ? a : null;
  };
  const family = a => (isIP(a) === 6 ? "ipv6" : "ipv4");
  // true when ip is in the bot's lists, false when it isn't, null when the line has no address.
  const fromVendor = (name, ip) => {
    const a = addrOf(ip);
    return a ? ipLists.get(name).some(bl => bl.check(a, family(a))) : null;
  };
  // Yandex publishes no IP list: a reverse lookup must give a yandex.ru, .net or .com name whose forward lookup gives
  // the address back. https://yandex.com/support/webmaster/en/robot-workings/check-yandex-robots
  // Lookups use this computer's DNS server, once per distinct address, at most 200 a bot, busiest first. With a folder
  // (OFFLINE) nothing is contacted, so those bots get a note instead.
  const DNS_CHECK = { YandexBot: /(^|\.)yandex\.(ru|net|com)\.?$/i },
    DNS_MAX = 200,
    OFFLINE = typeof args["verify-ips"] === "string";
  // true: the names lead back to the address; false: no name on those domains, or it doesn't lead back; null: no
  // answer.
  const byDns = async (re, a) => {
    try {
      const bl = new BlockList();
      bl.addAddress(a, family(a));
      for (const name of (await dns.reverse(a)).filter(n => re.test(n))) {
        try {
          if ((await dns.lookup(name, { all: true })).some(x => bl.check(x.address, x.family === 6 ? "ipv6" : "ipv4")))
            return true;
        } catch (e) {
          if (e.code !== "ENOTFOUND" && e.code !== "ENODATA") return null;
        }
      }
      return false;
    } catch (e) {
      return e.code === "ENOTFOUND" || e.code === "ENODATA" ? false : null;
    }
  };
  const AI_REFERRERS = [
    "chatgpt.com",
    "chat.openai.com",
    "perplexity.ai",
    "claude.ai",
    "gemini.google.com",
    "copilot.microsoft.com",
  ];
  // Google Search, Images and Discover send a Google domain or the Android app as Referer. Only landing pages count:
  // Google Images loads full-size files with the same Referer.
  // https://developers.google.com/search/docs/monitor-debug/identify-google-search-traffic
  // Known limit: a page path ending in a short extension (/notes.post) reads as a file.
  const GOOGLE_HOST = /^(www\.)?google\.(com|[a-z]{2}|com?\.[a-z]{2})$/,
    GOOGLE_APP = /^android-app:\/\/com\.google\.android\.googlequicksearchbox(\/|$)/i;
  const FILE = /\.(?!html?$|php$|aspx?$)[a-z0-9]{1,5}$/i;

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
    google = new Map(),
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
    const time = r.time && !isNaN(r.time.getTime()) ? r.time : null;
    if (SINCE !== null && !time) {
      stats.undated++;
      return;
    }
    if (SINCE !== null && +time < SINCE) {
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
      } else if (ipLists && DNS_CHECK[bot.name] && !OFFLINE) {
        const a = addrOf(r.ip) ?? "",
          m = (b.dns ||= new Map());
        m.set(a, (m.get(a) || 0) + 1);
      } // checked after reading
      const cls = `${Math.floor(r.status / 100)}xx`;
      if (cls in b.status) b.status[cls]++;
      const p =
        b.paths.get(path) || b.paths.set(path, { n: 0, s5xx: 0, s404: 0, refused: 0, realRefused: 0 }).get(path);
      p.n++;
      if (r.status >= 500) p.s5xx++;
      if (r.status === 404) p.s404++;
      if (r.status === 401 || r.status === 403) {
        p.refused++;
        b.refused++;
        if (ipLists?.has(bot.name) && fromVendor(bot.name, r.ip)) p.realRefused++; // from the vendor's own addresses
      }
      if (time) {
        if (!b.first || time < b.first) b.first = time;
        if (!b.last || time > b.last) b.last = time;
      }
      return;
    }
    if (r.status < 200 || r.status >= 300) return; // a redirect and the page it leads to would be two visits
    const host = hostOf(r.referer),
      page = path.split("?")[0],
      source =
        AI_REFERRERS.find(d => host === d || host.endsWith("." + d)) ||
        (/[?&]utm_source=chatgpt\.com(&|$)/i.test(path) ? "chatgpt.com" : null);
    if (source) {
      const pages = (referrals[source] ||= new Map());
      pages.set(page, (pages.get(page) || 0) + 1);
    }
    if ((GOOGLE_HOST.test(host) || GOOGLE_APP.test(String(r.referer ?? ""))) && !FILE.test(page))
      google.set(page, (google.get(page) || 0) + 1);
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
  // The DNS check, 10 addresses at a time. noAnswer counts requests whose lookup got no answer, or past DNS_MAX. A
  // batch with no answer at all means the DNS server is out of reach, so the rest aren't asked (each would time out).
  for (const b of Object.values(bots))
    if (b.dns) {
      const c = (b.ip = { verified: 0, other: 0, unknown: 0, refused: 0 }),
        list = [...b.dns].sort((x, y) => y[1] - x[1]);
      let down = false;
      b.noAnswer = 0;
      for (let i = 0; i < list.length; i += 10) {
        const batch = list.slice(i, i + 10),
          oks = await Promise.all(
            batch.map(([a], j) => (a && !down && i + j < DNS_MAX ? byDns(DNS_CHECK[b.bot.name], a) : null)),
          );
        batch.forEach(([a, n], j) => {
          c[oks[j] === null ? "unknown" : oks[j] ? "verified" : "other"] += n;
          if (a && oks[j] === null) b.noAnswer += n;
        });
        down ||= batch.some(([a]) => a) && oks.every(ok => ok === null);
      }
    }

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
      .map(
        ([s, pages]) =>
          /** @type {const} */ ([
            s,
            {
              visits: [...pages.values()].reduce((a, b) => a + b, 0),
              topPages: top(pages, v => v, 10).map(([path, visits]) => ({ path, visits })),
            },
          ]),
      )
      .sort((a, b) => b[1].visits - a[1].visits),
  );

  // ---------- findings ----------
  const findings = [];
  const url = p => ORIGIN + p,
    pct = x => `${Math.round(x * 1000) / 10}%`,
    list = ps => ps.map(([p, n]) => `${p} (${n})`).join(", ");
  const finding = (check, rule, severity, category, title, why, fix, evidence, count = evidence.length) => {
    if (evidence.length)
      findings.push(
        findingOf(check, [rule, severity, title, why, fix], { count, evidence }, { source: "server-logs", category }),
      );
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
  const repeated404s = repeated
    .filter(r => !linked(r))
    .map(([path, v]) => ({ path, requests: v.n, bots: [...v.bots] }));
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
      url: url(top(b.paths, checked(b) ? v => v.realRefused : v => v.refused, 1)[0][0]),
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
  numbered(findings, "L");

  notes.unshift(
    ipLists
      ? "User agents can be spoofed, so every count here is requests claiming to be that bot; ipCheck says how many came from the vendor's published addresses (for YandexBot, addresses a DNS check confirms are Yandex's)."
      : "User agents can be spoofed, so every count here is requests claiming to be that bot. Before acting on one bot's numbers, check its IPs against the vendor's published IP list: --verify-ips does that.",
  );
  if (ipLists) {
    const fakes = Object.values(bots)
      .filter(b => b.ip?.other)
      .map(b => `${b.bot.name} ${b.ip.other} of ${b.requests}`);
    if (fakes.length)
      notes.push(
        `Some requests claiming to be a known bot came from addresses outside the vendor's published list (for YandexBot, addresses whose DNS name isn't Yandex's or doesn't lead back to them), so they're most likely fakes (or the log records a proxy's or CDN's address instead of the visitor's): ${fakes.join(", ")}. The finding about refused AI crawlers counts only requests from the vendors' addresses.`,
      );
    const noIp = Object.values(bots)
      .filter(b => b.ip && !checked(b) && !b.noAnswer)
      .map(b => b.bot.name);
    if (noIp.length)
      notes.push(`The log lines for ${noIp.join(", ")} carry no client address, so --verify-ips couldn't check them.`);
    const byDnsOnly = OFFLINE ? Object.keys(bots).filter(n => DNS_CHECK[n]) : [];
    if (byDnsOnly.length)
      notes.push(
        `${byDnsOnly.join(", ")} weren't checked: their vendor publishes no list of addresses to save, and --verify-ips with a folder contacts nothing. Run --verify-ips without a folder to check them in DNS.`,
      );
    for (const b of Object.values(bots).filter(b => b.noAnswer))
      notes.push(
        `${b.noAnswer} ${b.bot.name} request(s) couldn't be checked in DNS, so they're counted as unknown: the DNS server gave no answer${b.dns.size > DNS_MAX ? `, or they came from beyond the ${DNS_MAX} busiest addresses, the most looked up` : ""}. Yandex Webmaster's IP address check tool (Tools → IP address check) checks one address at a time by hand.`,
      );
    const unlisted = Object.keys(bots).filter(n => IP_LISTS[n] && !ipLists.has(n));
    if (unlisted.length) notes.push(`No IP list loaded for ${unlisted.join(", ")}, so those requests weren't checked.`);
    const unreadable = Object.keys(bots).filter(n => UNREADABLE[n]);
    if (unreadable.length)
      notes.push(
        `These vendors publish their addresses in a form --verify-ips can't read yet, so these bots weren't checked: ${unreadable.map(n => `${n} (${UNREADABLE[n]})`).join("; ")}.`,
      );
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
  const googleReferrals = google.size
    ? {
        visits: [...google.values()].reduce((a, b) => a + b, 0),
        topPages: top(google, v => v, 10).map(([path, visits]) => ({ path, visits })),
      }
    : null;
  if (!googleReferrals)
    notes.push(
      "No visits with a Google Search referrer in these logs. Browsers and apps often drop the referrer (private browsing, some new tabs, apps), and common log format doesn't record it, so Search Console's clicks are the real number.",
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
        googleReferrals,
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
  return 0;
}

if (isMain(import.meta.url)) await runMain(() => main(process.argv.slice(2)));
