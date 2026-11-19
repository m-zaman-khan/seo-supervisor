#!/usr/bin/env node
// Checks that known backlinks still exist: opens each linking page and looks for an <a href> to the site. Visiting
// other people's sites is an outside action, so without --yes it's a dry run that visits nothing.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { lookup } from "node:dns";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { BlockList, isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseCsv } from "./lib/csv.mjs";

const USAGE =
  "usage: node backlinks.mjs --site https://www.example.com (--keys seo-audit/keys.json | --csv links.csv | --urls links.txt) [--out seo-audit/backlinks.json] [--yes]";
const UA = "seo-supervisor-backlinks",
  MAX = 100,
  AT_ONCE = 4,
  HOPS = 5,
  MB = 5,
  CAP = MB * 1024 * 1024;
class Fail extends Error {}
const fail = msg => {
  throw new Fail("backlinks: " + msg);
};
const obj = x => (x && typeof x === "object" ? x : null);
const bare = h => h.toLowerCase().replace(/^www\./, "");

// Private, local and reserved addresses: what seo-crawl.mjs's isPublic refuses, plus benchmarking, multicast, reserved
// and broadcast, NAT64 and IPv4 inside IPv6 (BlockList reads ::ffff:127.0.0.1 as 127.0.0.1). A non-IP counts too.
const PRIVATE = new BlockList();
for (const s of [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/3",
  "::/96",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8",
  "64:ff9b::/96",
  "64:ff9b:1::/48",
]) {
  const [a, n] = s.split("/");
  PRIVATE.addSubnet(a, +n, isIP(a) === 6 ? "ipv6" : "ipv4");
}
const privateIp = a => !isIP(a) || PRIVATE.check(a, isIP(a) === 6 ? "ipv6" : "ipv4");
// The address: no private IP, no intranet or reserved name. The name's own answer is checked when connecting (guarded).
const isPublic = u => {
  try {
    const { protocol, hostname: h } = new URL(u);
    return (
      /^https?:$/.test(protocol) &&
      h.includes(".") &&
      !(/^[\d.]+$/.test(h) && privateIp(h)) &&
      !/\.(local|internal|lan|localhost|test|home\.arpa)$/i.test(h)
    );
  } catch {
    return false;
  }
};
// The lookup every request connects with, so the address checked is the one used: a name can't pass a check and then
// answer differently (DNS rebinding). A name that doesn't resolve fails the visit.
const guarded = dns => (name, opts, cb) =>
  dns(name, opts, (err, addr, family) => {
    const bad = !err && (Array.isArray(addr) ? addr.map(a => a.address) : [addr]).find(privateIp);
    bad
      ? cb(
          Object.assign(new Error(`${name} points at a private or local address (${bad}), so it wasn't visited`), {
            code: "ENOTPUBLIC",
          }),
        )
      : cb(err, addr, family);
  });
const open = (u, opts) =>
  new Promise((ok, ko) => (u.startsWith("https:") ? httpsGet : httpGet)(u, opts, ok).on("error", ko));

const ATTR = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
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
function linksTo(html, base, host) {
  const out = [];
  for (const [tag] of html.replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>/gi, "").matchAll(/<a\s[^>]*>/gi)) {
    const a = {};
    for (const m of tag.slice(2, -1).matchAll(ATTR)) a[m[1].toLowerCase()] ??= m[2] ?? m[3] ?? m[4] ?? "";
    let u;
    try {
      u = new URL(a.href.trim().replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (
      /^https?:$/.test(u.protocol) &&
      [u, ...wrapped(u)].some(t => /^https?:$/.test(t.protocol) && bare(t.hostname) === host)
    )
      out.push(
        (a.rel || "")
          .toLowerCase()
          .split(/\s+/)
          .filter(t => ["nofollow", "sponsored", "ugc"].includes(t)),
      );
  }
  return out;
}

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
        return { state: "live", rel: links.every(l => l.length) ? [...new Set(links.flat())].join(" ") : null };
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
  const backlinks = {
    when: new Date().toISOString(),
    checked: list.length,
    live: of("live").length,
    gone,
    unreachable: of("unreachable").map(({ url, reason }) => ({ url, reason })),
    nofollow: of("live")
      .filter(r => r.rel)
      .map(({ url, rel }) => ({ url, rel })),
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
  const urls = [
    ...(str("keys") ? fromKeys(args.keys) : []),
    ...(str("csv") ? fromCsv(args.csv) : []),
    ...(str("urls") ? fromText(args.urls) : []),
  ];
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
