#!/usr/bin/env node
// Checks that known backlinks still exist: opens each linking page and looks for an <a href> to the site. Visiting
// other people's sites is an outside action, so without --yes it's a dry run that visits nothing.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseCsv } from "./lib/csv.mjs";

const USAGE =
  "usage: node backlinks.mjs --site https://www.example.com (--keys seo-audit/keys.json | --csv links.csv | --urls links.txt) [--out seo-audit/backlinks.json] [--yes]";
const UA = "seo-supervisor-backlinks",
  MAX = 100,
  AT_ONCE = 4,
  HOPS = 5;
class Fail extends Error {}
const fail = msg => {
  throw new Fail("backlinks: " + msg);
};
const obj = x => (x && typeof x === "object" ? x : null);
const bare = h => h.toLowerCase().replace(/^www\./, "");

// The same address test as seo-crawl.mjs's isPublic: no private or local IP, no intranet or reserved name.
const PRIVATE =
  /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)|^(::1?|f[cd].*|fe[89ab].*)$/i;
const privateIp = a => PRIVATE.test(a.replace(/^::ffff:/i, ""));
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
// Also refuses a public name that resolves to a private address; one that doesn't resolve is left for fetch to report.
// fetch resolves the name again, so an answer that changes in between (DNS rebinding) gets through. Pin the address
// with a custom dispatcher if that matters.
const reachable = async u =>
  isPublic(u) && (await lookup(new URL(u).hostname, { all: true }).catch(() => [])).every(a => !privateIp(a.address));

// Each <a href> to the site, as the rel values that hold it back (nofollow, sponsored, ugc); www, the bare domain,
// http and https are one site. Raw HTML only: links a script adds aren't seen, which is why the fix says to open the
// page first.
const ATTR = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
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
    if (/^https?:$/.test(u.protocol) && bare(u.hostname) === host)
      out.push(
        (a.rel || "")
          .toLowerCase()
          .split(/\s+/)
          .filter(t => ["nofollow", "sponsored", "ugc"].includes(t)),
      );
  }
  return out;
}

// pinnedGet follows redirects by hand so every hop gets the public-address check. robots.txt isn't read: each visit is
// one requested page, like opening it in a browser, not a crawl.
async function visit(url, host, allow, timeout) {
  const signal = AbortSignal.timeout(timeout),
    headers = { "user-agent": UA, accept: "text/html,application/xhtml+xml" };
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
      const r = await fetch(u, { redirect: "manual", signal, headers });
      const to = r.status >= 300 && r.status < 400 && r.headers.get("location");
      if (to) {
        await r.body?.cancel();
        u = new URL(to, u).href;
        continue;
      }
      const type = (r.headers.get("content-type") || "").split(";")[0].trim();
      if (!r.ok || (type && !/html/i.test(type))) await r.body?.cancel();
      if (r.status === 404 || r.status === 410)
        return {
          state: "gone",
          reason: `the page answered ${r.status}: ${r.status === 404 ? "it no longer exists" : "it was removed"}`,
        };
      if (!r.ok)
        return no(
          `the site answered ${r.status}${r.status === 401 || r.status === 403 ? ", turning the visit away" : r.status >= 500 ? ", an error on their side" : ""}`,
        );
      if (type && !/html/i.test(type)) return no(`it isn't a web page (${type}), so its links couldn't be read`);
      const links = linksTo(await r.text(), u, host);
      if (!links.length)
        return {
          state: "gone",
          reason: `the page loads but no longer links to your site${u !== url ? ` (it now redirects to ${u})` : ""}`,
        };
      return { state: "live", rel: links.every(l => l.length) ? [...new Set(links.flat())].join(" ") : null };
    }
    return no(`it redirects more than ${HOPS} times`);
  } catch (e) {
    return no(
      e.name === "TimeoutError"
        ? `no answer within ${timeout / 1000} seconds`
        : `couldn't connect (${e.cause?.code || e.message})`,
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

export async function checkBacklinks(urls, site, { allow = reachable, timeout = 15000 } = {}) {
  const host = bare(new URL(site).hostname),
    { list, extra } = pick(urls),
    results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        results[i] = { url: list[i], ...(await visit(list[i], host, allow, timeout)) };
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
          what: `${gone.length === 1 ? "Found on" : `${gone.length} cases, for example`} ${gone[0].url} (${gone[0].reason}).`,
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

// Not process.exit(): exiting while fetch's sockets close crashes Node on Windows.
if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2)).then(null, e => {
    if (!(e instanceof Fail)) throw e;
    console.error(e.message);
    return 2;
  });
}
