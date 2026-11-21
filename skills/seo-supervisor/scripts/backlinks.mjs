#!/usr/bin/env node
// @ts-check
// Checks that known backlinks still exist: opens each linking page and looks for an <a href> to the site.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { lookup } from "node:dns";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseCsv } from "./lib/csv.mjs";
import { isPublic, guarded } from "./checks/outbound.mjs";

const USAGE =
  "usage: node backlinks.mjs --site https://www.example.com (--keys seo-audit/keys.json | --csv links.csv | --urls links.txt) [--out seo-audit/backlinks.json] [--yes]";
const UA = "seo-supervisor-backlinks",
  MAX = 100,
  AT_ONCE = 4,
  HOPS = 5,
  MB = 5,
  CAP = MB * 1024 * 1024;
export class Fail extends Error {}
const fail = msg => {
  throw new Fail("backlinks: " + msg);
};
const obj = x => (x && typeof x === "object" ? x : null);
const bare = h => h.toLowerCase().replace(/^www\./, "");
const open = (u, opts) =>
  new Promise((ok, ko) => (u.startsWith("https:") ? httpsGet : httpGet)(u, opts, ok).on("error", ko));

const ATTR = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const attrs = tag => {
  const a = {};
  for (const m of tag.replace(/^<\w+|>$/g, "").matchAll(ATTR)) a[m[1].toLowerCase()] ??= m[2] ?? m[3] ?? m[4] ?? "";
  return a;
};
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = s =>
  s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|\w+);/gi, (m, e) => {
    if (e[0] !== "#") return ENT[e.toLowerCase()] ?? m;
    const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
// A link through a redirect wrapper (youtube.com/redirect?q=…, l.facebook.com/l.php?u=…) counts for the address it
// wraps.
const WRAPS = ["q", "u", "url", "target", "to", "dest"];
const wrapped = u =>
  WRAPS.flatMap(k => u.searchParams.getAll(k)).flatMap(v => {
    try {
      return [new URL(v)];
    } catch {
      return [];
    }
  });
const clean = html => html.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>/gi, "");
// Each <a href> to the site as { href, text, rel }; www, the bare domain, http and https are one site. Text falls back
// to an image's alt, and rel keeps only nofollow, sponsored and ugc.
// Raw HTML only: links a script adds aren't seen, and unread() guesses when that's the case.
export function linksTo(html, base, host) {
  const out = [],
    page = clean(html);
  for (const m of page.matchAll(/<a\s[^>]*>/gi)) {
    const a = attrs(m[0]);
    let u;
    try {
      u = new URL(decode(a.href.trim()), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol)) continue;
    const to = [u, ...wrapped(u)].find(t => /^https?:$/.test(t.protocol) && bare(t.hostname) === host);
    if (!to) continue;
    const inner = page.slice(m.index + m[0].length, m.index + m[0].length + 3000).split(/<\/a\s*>|<a\s/i)[0];
    const words = decode(inner.replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    const alt = /<img\s[^>]*>/i.exec(inner);
    const text = (
      words ||
      (alt
        ? decode(attrs(alt[0]).alt || "")
            .replace(/\s+/g, " ")
            .trim()
        : "")
    ).slice(0, 200);
    out.push({
      href: to.href,
      text,
      rel: (a.rel || "")
        .toLowerCase()
        .split(/\s+/)
        .filter(t => ["nofollow", "sponsored", "ugc"].includes(t))
        .join(" "),
    });
  }
  return out;
}

// A page-wide nofollow or none, in a robots or googlebot meta tag or an X-Robots-Tag line for all crawlers or
// googlebot. Rules for another crawler ("bingbot: nofollow") don't count.
// https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
const NOFOLLOW = /^(nofollow|none)$/i;
export function pageNofollow(html, headerLines = []) {
  const metas = [...clean(html).matchAll(/<meta\s[^>]*>/gi)]
    .map(([t]) => attrs(t))
    .filter(a => /^(robots|googlebot)$/i.test((a.name || "").trim()));
  if (
    metas.some(a =>
      decode(a.content || "")
        .split(",")
        .some(r => NOFOLLOW.test(r.trim())),
    )
  )
    return "robots meta tag";
  for (const line of headerLines) {
    let bot = null;
    for (const part of String(line).split(",")) {
      const m = /^\s*([a-z][\w-]*)\s*:\s*(.*)$/i.exec(part),
        rule =
          m && !/^(unavailable_after|max-snippet|max-image-preview|max-video-preview)$/i.test(m[1])
            ? ((bot = m[1].toLowerCase()), m[2])
            : part;
      if ((!bot || bot === "googlebot") && NOFOLLOW.test(rule.trim())) return "X-Robots-Tag header";
    }
  }
  return null;
}
// X-Robots-Tag lines from rawHeaders, kept apart because a `bot:` prefix scopes only its own line.
export const robotsLines = raw =>
  raw.flatMap((v, i) => (i % 2 && raw[i - 1].toLowerCase() === "x-robots-tag" ? [v] : []));

// Why a page without the link may not really be gone: truncated, behind a consent screen, built by a script, or naming
// the site without a link. "" when the page was clearly read.
// Heuristics on text size and keywords; a headless browser would settle them, at the cost of a dependency.
function unread(page, cut, moved, host) {
  if (cut) return `the page is very large: only its first ${MB} MB were read, and the link isn't in them`;
  const html = page.replace(/<!--[\s\S]*?-->|<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    (moved && /consent|gdpr|cookie/i.test(new URL(moved).hostname + new URL(moved).pathname)) ||
    (text.length < 2000 && /\bcookies?\b/i.test(text) && /\b(accept|agree|reject|consent)/i.test(text))
  )
    return "it shows a cookie or privacy consent screen instead of the page, so its links couldn't be read";
  if (
    text.length < 200 ||
    /<(\w+)\b[^>]*\bid\s*=\s*["']?(root|app|__next|__nuxt|react-root|app-root|__pws_root__)(?=["'\s>])[^>]*>\s*<\/\1>/i.test(
      html,
    )
  )
    return "it looks built by JavaScript: its HTML has almost no content, so its links couldn't be read";
  if (!/<a\s/i.test(html)) return "the page has no links at all in its HTML, so a script probably adds them";
  if (new RegExp(`(^|[^\\w.-])(www\\.)?${host.replace(/\./g, "\\.")}(?![\\w-]|\\.\\w)`, "i").test(page))
    return `the page mentions ${host} but no link to it was found (a script may add it), so it couldn't be confirmed`;
  return "";
}

// pinnedGet follows redirects by hand so every hop gets the public-address check. robots.txt isn't read: each visit is
// one requested page, like opening it in a browser, not a crawl.
async function visit(url, host, allow, timeout, lookup) {
  const signal = AbortSignal.timeout(timeout),
    opts = { signal, lookup, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } };
  const no = reason => ({ state: "unreachable", reason });
  let u = url;
  try {
    for (let hop = 0; hop <= HOPS; hop++) {
      if (!(await allow(u)))
        return no(
          hop
            ? `it redirects to ${u}, which isn't a public web address, so that wasn't visited`
            : "isn't a public web address, so it wasn't visited",
        );
      const r = await open(u, opts),
        status = r.statusCode,
        ok = status >= 200 && status < 300;
      const to = status >= 300 && status < 400 && r.headers.location,
        type = (r.headers["content-type"] || "").split(";")[0].trim();
      if (to || !ok || (type && !/html/i.test(type))) r.destroy();
      if (to) {
        u = new URL(to, u).href;
        continue;
      }
      if (status === 404 || status === 410)
        return {
          state: "gone",
          reason: `the page answered ${status}: ${status === 404 ? "it no longer exists" : "it was removed"}`,
        };
      if (!ok)
        return no(
          `the site answered ${status}${status === 401 || status === 403 ? ", turning the visit away" : status >= 500 ? ", an error on their side" : ""}`,
        );
      if (type && !/html/i.test(type)) return no(`it isn't a web page (${type}), so its links couldn't be read`);
      const chunks = [];
      let n = 0;
      for await (const c of r) {
        chunks.push(c);
        if ((n += c.length) > CAP) break;
      }
      const page = Buffer.concat(chunks).toString();
      if (!type && !/<!doctype html|<html[\s>]/i.test(page.slice(0, 1024)))
        return no(
          "it didn't say what kind of file it is and doesn't look like a web page, so its links couldn't be read",
        );
      const links = linksTo(page, u, host);
      if (links.length)
        return {
          state: "live",
          rel: links.every(l => l.rel) ? [...new Set(links.flatMap(l => l.rel.split(" ")))].join(" ") : null,
          links: links.slice(0, 5),
          page: pageNofollow(page, robotsLines(r.rawHeaders)),
        };
      const why = unread(page, n > CAP, u !== url && u, host);
      return why
        ? no(why)
        : {
            state: "gone",
            reason: `the page loads but no longer links to your site${u !== url ? `; it now redirects to ${u}` : ""}`,
          };
    }
    return no(`it redirects more than ${HOPS} times`);
  } catch (e) {
    return no(
      signal.aborted
        ? `no answer within ${timeout / 1000} seconds`
        : e.code === "ENOTPUBLIC"
          ? e.message
          : `couldn't connect (${e.code || e.cause?.code || e.message})`,
    );
  }
}

// A #fragment is the same page.
const pick = urls => {
  const all = [
    ...new Set(
      urls.map(s => {
        try {
          const u = new URL(s);
          u.hash = "";
          return u.href;
        } catch {
          return String(s);
        }
      }),
    ),
  ];
  return { list: all.slice(0, MAX), extra: Math.max(0, all.length - MAX) };
};
const capNote = extra => `${extra} more linking page(s) weren't checked: at most ${MAX} are visited per run.`;

// URLs in the finding's text go in code spans, so in Markdown another site's address can't become a link with
// misleading text.
const code = s => s.replace(/https?:\/\/\S+/g, u => "`" + u.replace(/`/g, "%60") + "`");

// Linking sites whose every live page holds its links back (rel or page-wide nofollow), most pages first.
// https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links
export function allNofollow(live) {
  const sites = new Map();
  for (const r of live) {
    let h;
    try {
      h = bare(new URL(r.url).hostname);
    } catch {
      continue;
    }
    const s = sites.get(h) || { site: h, pages: 0, followed: false };
    s.pages++;
    s.followed ||= !(r.rel || r.page);
    sites.set(h, s);
  }
  return [...sites.values()]
    .filter(s => !s.followed)
    .sort((a, b) => b.pages - a.pages)
    .map(({ site, pages }) => ({ site, pages }));
}

// `allow` vets each address before a request; `dns` (dns.lookup's signature) resolves the address checked and used.
export async function checkBacklinks(urls, site, { allow = isPublic, timeout = 15000, dns = lookup } = {}) {
  const host = bare(new URL(site).hostname),
    { list, extra } = pick(urls),
    results = [],
    connect = guarded(dns);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        results[i] = { url: list[i], ...(await visit(list[i], host, allow, timeout, connect)) };
      }
    }),
  );
  const of = state => results.filter(r => r.state === state);
  const gone = of("gone").map(({ url, reason }) => ({ url, reason }));
  // A page is nofollow when every link to the site carries a rel value, or the whole page is nofollow.
  const backlinks = {
    when: new Date().toISOString(),
    checked: list.length,
    live: of("live").length,
    gone,
    unreachable: of("unreachable").map(({ url, reason }) => ({ url, reason })),
    nofollow: of("live")
      .filter(r => r.rel || r.page)
      .map(({ url, rel, page }) => ({ url, rel: rel || "nofollow", ...(page && { page }) })),
    nofollowSites: allNofollow(of("live")),
    found: of("live").map(({ url, links, page }) => ({ url, links, ...(page && { pageNofollow: page }) })),
  };
  const findings = gone.length
    ? [
        {
          id: "B-001",
          check: "backlinks-gone",
          rule: "LAUNCH-05",
          severity: "low",
          category: "Launch & monitoring",
          title: `${gone.length} known link(s) from other sites are gone`,
          what: `${gone.length === 1 ? "Found on" : `${gone.length} cases, for example`} ${code(gone[0].url)} (${code(gone[0].reason)}).`,
          why: "Links from other sites help search engines find your pages and trust them. After a redesign or a move, links quietly break or get removed, and what they brought goes with them.",
          fix: "Open each page in a browser first to confirm the link is really gone. If the page still mentions you, ask the site to put the link back or update it. If the link pointed at a page of yours that moved or no longer works, redirect that old address to the closest live page with a 301, then ask the site to update the link.",
          count: gone.length,
          evidence: gone.map(g => ({ url: g.url, detail: g.reason })),
          source: "backlinks",
          status: "open",
        },
      ]
    : [];
  return { backlinks, findings, notes: extra ? [capNote(extra)] : [] };
}

export const summary = b =>
  `${b.live} of ${b.checked} known ${b.checked === 1 ? "link is" : "links are"} still there; ${b.gone.length} gone; ${b.unreachable.length} couldn't be checked`;

// ---------- inputs ----------
const read = f => {
  try {
    return readFileSync(f, "utf8");
  } catch (e) {
    fail(`can't read ${f} (${e.code || e.message})`);
  }
};
// keys.json, or an audit JSON with bing copied in. backlinks.sample lists linking pages; .pages are the site's own.
function fromKeys(f) {
  let j;
  try {
    j = JSON.parse(read(f));
  } catch (e) {
    if (e instanceof Fail) throw e;
    fail(`${f} isn't JSON. Pass the keys.json that connect-keys.mjs fetch writes.`);
  }
  const sample = obj(obj(obj(j)?.bing)?.backlinks)?.sample;
  return (Array.isArray(sample) ? sample : []).map(s => obj(s)?.url).filter(u => typeof u === "string");
}
// Search Console's "Latest links" export names the column "Linking page" in English; in another UI language it's
// the first column that holds URLs.
function fromCsv(f) {
  const rows = parseCsv(read(f)),
    heads = Object.keys(rows[0] || {});
  const col =
    heads.find(h => /^linking page$/i.test(h)) ||
    heads.find(h => rows.some(r => r[h]) && rows.every(r => !r[h] || /^https?:\/\//i.test(r[h])));
  if (!col)
    fail(
      `${f} has no "Linking page" column. In Search Console open Links, then Export external links → Latest links, and pass that CSV.`,
    );
  return rows.map(r => r[col]).filter(Boolean);
}
const fromText = f =>
  read(f)
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith("#"))
    .map(s => (/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : "https://" + s));
// commoncrawl.mjs reads the same three inputs.
export const linkingPages = ({ keys, csv, urls }) => [
  ...(keys ? fromKeys(keys) : []),
  ...(csv ? fromCsv(csv) : []),
  ...(urls ? fromText(urls) : []),
];

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      args[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    }
  const str = k => (typeof args[k] === "string" ? args[k] : null);
  if (!str("site") || !(str("keys") || str("csv") || str("urls"))) throw new Fail(USAGE);
  let site;
  try {
    site = new URL(args.site);
  } catch {}
  if (!site || !/^https?:$/.test(site.protocol))
    fail(`--site must be the site's address, like https://www.example.com (got ${args.site})`);
  const urls = linkingPages({ keys: str("keys"), csv: str("csv"), urls: str("urls") });
  const { list, extra } = pick(urls);
  if (!list.length) {
    console.log("backlinks: the files given list no linking pages, so there's nothing to check.");
    return 0;
  }

  if (args.yes !== true) {
    const hosts = {},
      refused = list.filter(u => !isPublic(u));
    for (const u of list)
      if (isPublic(u)) {
        const h = new URL(u).hostname;
        hosts[h] = (hosts[h] || 0) + 1;
      }
    const top = Object.entries(hosts).sort((a, b) => b[1] - a[1]);
    console.log(
      [
        `backlinks: dry run, nothing visited. With --yes it would visit ${list.length - refused.length} page(s) on ${top.length} site(s), ${AT_ONCE} at a time, to see whether each still links to ${site.hostname}:`,
        ...top.slice(0, 20).map(([h, n]) => `  ${h}: ${n}`),
        ...(top.length > 20 ? [`  … and ${top.length - 20} more sites`] : []),
        ...(refused.length
          ? [`${refused.length} address${refused.length === 1 ? " isn't" : "es aren't"} public and would be skipped.`]
          : []),
        ...(extra ? [capNote(extra)] : []),
        "These are other people's sites, visited from this computer: re-run with --yes once the owner agrees.",
      ].join("\n"),
    );
    return 0;
  }
  const result = await checkBacklinks(list, site.href);
  const out = resolve(str("out") || "seo-audit/backlinks.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
  for (const n of result.notes) console.log("backlinks: " + n);
  console.log(`backlinks: ${summary(result.backlinks)} · wrote ${out}`);
  return 0;
}

// Exit by setting the code, not process.exit(): exiting while sockets close crashes Node on Windows.
if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2)).then(null, e => {
    if (!(e instanceof Fail)) throw e;
    console.error(e.message);
    return 2;
  });
}
