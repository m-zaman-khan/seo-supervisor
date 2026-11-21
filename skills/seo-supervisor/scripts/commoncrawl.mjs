#!/usr/bin/env node
// Common Crawl's view of a site: its pages in the newest crawl, its domain rank, and whether the saved copies of known
// linking pages link to it. The linking sites themselves are never visited.
// Only the newest crawl is asked; add older ones from collinfo.json if too few linking pages turn up. One request at a
// time, 1 s apart: Common Crawl calls the index's rate limits strict but publishes no number. A busy answer stops all
// further lookups. Only Common Crawl's own hosts are asked: the index must be on collinfo.json's host, and redirects
// aren't followed. A byte-range request reads just one saved copy, a few KB.
// https://commoncrawl.org/blog/you-can-now-build-directly-on-common-crawl-from-the-browser
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { createGunzip, gunzipSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import { isMain } from "./lib/is-main.mjs";
import { Fail, linkingPages, linksTo, pageNofollow } from "./backlinks.mjs";

const USAGE =
  'usage: node commoncrawl.mjs --site https://www.example.com [--keys seo-audit/keys.json] [--csv "Latest links.csv"] [--urls links.txt] [--rank [--rank-max-mb 500]] [--out seo-audit/commoncrawl.json] [--yes]';
// SEO_CC_* point the script at the tests' local servers.
const UA = "seo-supervisor-commoncrawl",
  COLLINFO = process.env.SEO_CC_COLLINFO || "https://index.commoncrawl.org/collinfo.json",
  DATA = "https://data.commoncrawl.org/";
const GRAPHINFO = process.env.SEO_CC_GRAPHINFO || "https://index.commoncrawl.org/graphinfo.json",
  GRAPH = process.env.SEO_CC_GRAPH || "https://data.commoncrawl.org/projects/hyperlinkgraph/";
const MAX = 20,
  KB = 1024,
  MB = 1024 * KB,
  BUSY = new Set([429, 503, 504]);
// Byte caps: the crawl list, the site's index lines (1,000 at most), one page's index lines, one saved record.
const CAP = { list: MB, site: MB, page: 64 * KB, record: MB };
const bare = h => h.toLowerCase().replace(/^www\./, "");

// body is null when the answer exceeds cap. Redirects are errors so only Common Crawl's own hosts are ever asked.
async function get(url, cap, headers = {}) {
  const r = await fetch(url, {
    headers: { "user-agent": UA, ...headers },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const chunks = [];
  let n = 0;
  for await (const c of r.body ?? []) {
    if ((n += c.length) > cap) break;
    chunks.push(c);
  }
  return { status: r.status, body: n > cap ? null : Buffer.concat(chunks) };
}
const jsonLines = buf =>
  buf
    .toString("utf8")
    .split("\n")
    .flatMap(l => {
      try {
        const x = JSON.parse(l);
        return x && typeof x === "object" ? [x] : [];
      } catch {
        return [];
      }
    });
const why = e => (e.name === "TimeoutError" ? "no answer within 30 seconds" : e.cause?.code || e.message);

// Splits a WARC response record into the crawled page's X-Robots-Tag values and its body.
function warc(buf) {
  const s = buf.toString("utf8"),
    a = s.indexOf("\r\n\r\n"),
    b = s.indexOf("\r\n\r\n", a + 4);
  if (a < 0 || b < 0) return null;
  const headers = s
    .slice(a + 4, b)
    .split("\r\n")
    .slice(1)
    .map(l => l.split(/:(.*)/s))
    .filter(([k, v]) => v != null && k.trim().toLowerCase() === "x-robots-tag")
    .map(([, v]) => v.trim());
  return { headers, body: s.slice(b + 4) };
}

// The domain ranks file is gzipped TSV, most-linked first, with reversed domains: harmonicc_pos, harmonicc_val,
// pr_pos, pr_val, host_rev, n_hosts. With no per-domain lookup it's streamed (about 2.5 GB in all) and never stored,
// stopping at the domain or the cap; 500 MB covers about the top 27 million domains. The edges file is never read, so
// linking sites come only from linking pages already known.
// https://data.commoncrawl.org/projects/hyperlinkgraph/
export const RANK_CAP_MB = 500;
// The registered domain, reversed as the graph writes it (shop.acme.co.uk gives uk.co.acme). A two-letter TLD after a
// label of 3 letters or fewer counts as the suffix; use the Public Suffix List if a domain comes out wrong.
export function rankDomain(hostname) {
  const l = bare(hostname).split(".");
  return l
    .slice(l.length >= 3 && l.at(-1).length === 2 && l.at(-2).length <= 3 ? -3 : -2)
    .reverse()
    .join(".");
}
export async function domainRank(site, { graphinfo = GRAPHINFO, graph = GRAPH, capBytes = RANK_CAP_MB * MB } = {}) {
  const rev = rankDomain(new URL(site).hostname),
    domain = rev.split(".").reverse().join("."),
    checked = new Date().toISOString().slice(0, 10);
  let g;
  try {
    const r = await get(graphinfo, CAP.list),
      list = r.status === 200 && r.body ? JSON.parse(r.body) : null;
    // The id goes into a URL path, so only letters, digits, . _ and -, never "..".
    // A host-only graph has no domain ranks.
    g =
      Array.isArray(list) &&
      list.find(
        x =>
          typeof x?.id === "string" &&
          /^[A-Za-z0-9._-]+$/.test(x.id) &&
          !x.id.includes("..") &&
          x.stats?.domain?.nodes > 0,
      );
  } catch (e) {
    return {
      domain,
      checked,
      found: null,
      note: `Couldn't read Common Crawl's list of web graphs (${why(e)}), so the rank wasn't looked up.`,
    };
  }
  if (!g)
    return {
      domain,
      checked,
      found: null,
      note: "Common Crawl's list of web graphs had no domain graph, so the rank wasn't looked up.",
    };
  const domains = g.stats.domain.nodes,
    ac = new AbortController();
  let res;
  try {
    res = await fetch(`${graph}${g.id}/domain/${g.id}-domain-ranks.txt.gz`, {
      headers: { "user-agent": UA },
      redirect: "error",
      signal: ac.signal,
    });
  } catch (e) {
    return {
      release: g.id,
      domain,
      checked,
      found: null,
      note: `Couldn't reach Common Crawl's rank file (${why(e)}).`,
    };
  }
  if (res.status !== 200 || !res.body) {
    ac.abort();
    return {
      release: g.id,
      domain,
      checked,
      found: null,
      note: `Common Crawl's rank file answered ${res.status}, so the rank wasn't read.`,
    };
  }
  const src = Readable.fromWeb(res.body),
    gz = createGunzip();
  let bytes = 0,
    capped = false,
    scanned = 0,
    hit = null,
    rest = "";
  src.on("error", () => {});
  src.pipe(gz);
  // Added after pipe(), so the chunk that crosses the cap still reaches gunzip.
  src.on("data", c => {
    bytes += c.length;
    if (bytes > capBytes && !capped) {
      capped = true;
      src.unpipe(gz);
      gz.end();
    }
  });
  try {
    read: for await (const chunk of gz) {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop();
      for (const line of lines) {
        if (!line || line[0] === "#") continue;
        const f = line.split("\t");
        scanned = Number(f[0]) || scanned;
        if (f[4] === rev) {
          hit = f;
          break read;
        }
      }
    }
  } catch {
    /* A stream cut at the cap ends in a gzip error; lines already read still count. */
  }
  if (!hit && !capped && rest) {
    const f = rest.split("\t");
    if (f[4] === rev) hit = f;
  } // a last line with no newline
  ac.abort();
  src.destroy();
  gz.destroy();
  if (hit)
    return {
      release: g.id,
      domain,
      checked,
      found: true,
      harmonicPos: Number(hit[0]),
      harmonic: Number(hit[1]),
      pageRankPos: Number(hit[2]),
      pageRank: Number(hit[3]),
      hosts: Number(hit[5]),
      domains,
    };
  return { release: g.id, domain, checked, found: false, capped, scanned, domains, readMB: Math.round(bytes / MB) };
}

// pages are known linking pages. collinfo, data and pause are for tests.
export async function commonCrawl(site, pages, { collinfo = COLLINFO, data = DATA, pause = 1000 } = {}) {
  const notes = [],
    host = bare(new URL(site).hostname);
  // Only the newest crawl is asked; add older ones from collinfo.json if too few linking pages turn up.
  let crawl;
  try {
    const r = await get(collinfo, CAP.list),
      newest = r.status === 200 && r.body ? JSON.parse(r.body)?.[0] : null;
    if (typeof newest?.id !== "string" || typeof newest["cdx-api"] !== "string")
      throw new Error(`its list of crawls answered ${r.status}`);
    crawl = {
      id: newest.id,
      name: typeof newest.name === "string" ? newest.name : newest.id,
      api: new URL(newest["cdx-api"]),
    };
  } catch (e) {
    notes.push(`Couldn't read Common Crawl's list of crawls (${why(e)}), so nothing was looked up.`);
    return { commonCrawl: null, notes };
  }
  // The list could point the index anywhere; only collinfo.json's own host is trusted.
  if (crawl.api.origin !== new URL(collinfo).origin) {
    notes.push(
      `Common Crawl's list of crawls points its index at ${crawl.api.host}, not ${new URL(collinfo).host}, so it wasn't used.`,
    );
    return { commonCrawl: null, notes };
  }

  // One request at a time, 1 s apart: Common Crawl calls the index's rate limits strict but publishes no number. A busy
  // answer stops all further lookups.
  let asked = 0,
    busy = null;
  const index = async (params, cap) => {
    if (asked++) await sleep(pause);
    const r = await get(`${crawl.api.href}?${new URLSearchParams({ ...params, output: "json" })}`, cap);
    if (BUSY.has(r.status)) busy = r.status;
    return r;
  };

  // Up to 1,000 of the site's captures, subdomains included.
  let siteInfo = null;
  try {
    const r = await index({ url: host, matchType: "domain", fl: "url", limit: "1000" }, CAP.site);
    const caps = r.status === 404 ? [] : r.status === 200 && r.body ? jsonLines(r.body) : null;
    const isHome = u => {
      try {
        const x = new URL(u);
        return bare(x.hostname) === host && x.pathname === "/" && !x.search;
      } catch {
        return false;
      }
    };
    if (caps)
      siteInfo = {
        captures: caps.length,
        capped: caps.length >= 1000,
        pages: new Set(caps.map(c => c.url)).size,
        home: caps.some(c => isHome(c.url)),
      };
    else
      notes.push(
        `Common Crawl's index answered ${r.status} about ${host}, so whether the site is in it wasn't found out.`,
      );
    if (caps && !caps.length)
      notes.push(
        `Common Crawl's newest crawl (${crawl.name}) has none of ${host}'s pages. If robots.txt blocks CCBot, Common Crawl's crawler, that's why (commoncrawl.org/ccbot).`,
      );
  } catch (e) {
    notes.push(`Couldn't ask Common Crawl's index about ${host} (${why(e)}).`);
  }

  // A linking page's saved copy in the crawl, and the links to the site in it.
  async function look(url) {
    if (busy) return { state: "not-checked" };
    try {
      const r = await index({ url, limit: "5" }, CAP.page);
      if (busy) return { state: "not-checked" };
      if (r.status === 404) return { state: "not-in-crawl" };
      if (r.status !== 200 || !r.body)
        return { state: "not-checked", reason: `Common Crawl's index answered ${r.status}` };
      const caps = jsonLines(r.body),
        c = caps.find(x => x.status === "200") || caps[0];
      if (!c) return { state: "not-in-crawl" };
      const captured = /^\d{8}/.test(c.timestamp)
          ? `${c.timestamp.slice(0, 4)}-${c.timestamp.slice(4, 6)}-${c.timestamp.slice(6, 8)}`
          : null,
        at = captured ? { captured } : {};
      if (c.status !== "200")
        return { state: "not-read", ...at, reason: `Common Crawl's crawler got status ${c.status} for it` };
      if (!/html/i.test(c.mime || "")) return { state: "not-read", ...at, reason: "it isn't a web page" };
      const offset = Number(c.offset),
        length = Number(c.length);
      if (
        !/^crawl-data\/[\w./-]+$/.test(c.filename || "") ||
        c.filename.includes("..") ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length <= 0
      )
        return { state: "not-read", ...at, reason: "Common Crawl's index didn't say where the saved copy is" };
      if (length > CAP.record)
        return { state: "not-read", ...at, reason: "its saved copy is larger than 1 MB, so it wasn't downloaded" };
      // A byte-range request reads just this record, a few KB.
      // https://commoncrawl.org/blog/you-can-now-build-directly-on-common-crawl-from-the-browser
      const d = await get(new URL(c.filename, data).href, CAP.record, {
        range: `bytes=${offset}-${offset + length - 1}`,
      });
      if (d.status !== 206 || !d.body)
        return { state: "not-read", ...at, reason: `Common Crawl's data server answered ${d.status}` };
      let rec = null;
      try {
        rec = warc(gunzipSync(d.body));
      } catch {}
      // A page that isn't HTML text (still compressed, or cut off) isn't judged.
      if (!rec || !/<[a-z!]/i.test(rec.body.slice(0, 4096)))
        return { state: "not-read", ...at, reason: "its saved copy couldn't be read" };
      const links = linksTo(rec.body, url, host),
        page = pageNofollow(rec.body, rec.headers);
      return {
        state: links.length ? "links" : "no-link",
        ...at,
        ...(links.length && { links }),
        ...(page && { pageNofollow: page }),
      };
    } catch (e) {
      return { state: "not-checked", reason: `couldn't reach Common Crawl (${why(e)})` };
    }
  }
  const all = [...new Set(pages)],
    list = all.slice(0, MAX),
    linking = [];
  for (const url of list) linking.push({ url, ...(await look(url)) });
  const skipped = linking.filter(p => p.state === "not-checked" && !p.reason).length;
  if (busy && skipped)
    notes.push(
      `Common Crawl's index server is busy (it answered ${busy}), so ${skipped} linking page${skipped === 1 ? " wasn't" : "s weren't"} looked up. Try again later.`,
    );
  if (all.length > MAX)
    notes.push(`${all.length - MAX} more linking pages weren't looked up: at most ${MAX} are looked up per run.`);
  const sites = [...new Set(linking.filter(p => p.state === "links").map(p => bare(new URL(p.url).hostname)))];
  return {
    commonCrawl: {
      when: new Date().toISOString(),
      crawl: { id: crawl.id, name: crawl.name },
      site: siteInfo,
      linkingPages: linking,
      linkingSites: sites,
    },
    notes,
  };
}

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      args[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    }
  const str = k => (typeof args[k] === "string" ? args[k] : null);
  if (!str("site")) throw new Fail(USAGE);
  let site;
  try {
    site = new URL(args.site);
  } catch {}
  if (!site || !/^https?:$/.test(site.protocol))
    throw new Fail(`commoncrawl: --site must be the site's address, like https://www.example.com (got ${args.site})`);
  const pages = [
    ...new Set(
      linkingPages({ keys: str("keys"), csv: str("csv"), urls: str("urls") }).filter(u => /^https?:\/\//i.test(u)),
    ),
  ];
  const n = Math.min(pages.length, MAX),
    host = bare(site.hostname),
    out = resolve(str("out") || "seo-audit/commoncrawl.json");
  const capMb = str("rank-max-mb") ? Number(args["rank-max-mb"]) : RANK_CAP_MB;
  if (args.rank && !(Number.isFinite(capMb) && capMb >= 10 && capMb <= 3000))
    throw new Fail(
      "commoncrawl: --rank-max-mb must be a number of MB from 10 to 3000 (the whole rank file is about 2,500).",
    );
  // A rank under 90 days old is reused: the graph changes monthly and the read is large.
  let saved = null;
  try {
    const r = JSON.parse(readFileSync(out, "utf8"))?.commonCrawl?.rank;
    if (
      r?.domain === rankDomain(site.hostname).split(".").reverse().join(".") &&
      r.found !== null &&
      Date.now() - Date.parse(r.checked) < 90 * 864e5
    )
      saved = r;
  } catch {}

  if (args.yes !== true) {
    const most = CAP.list + CAP.site + n * (CAP.page + CAP.record);
    console.log(
      [
        `commoncrawl: dry run, nothing downloaded. With --yes it would ask Common Crawl's index (index.commoncrawl.org) whether ${host} is in its newest crawl${n ? `, and look up ${n} known linking page${n === 1 ? "" : "s"}, reading each saved copy from data.commoncrawl.org` : ""}.`,
        `That's at most ${2 + 2 * n} requests, one at a time, and at most ${(most / MB).toFixed(1)} MB, usually much less. The linking sites themselves aren't visited.`,
        ...(pages.length > MAX
          ? [`${pages.length - MAX} more linking pages would be left out: at most ${MAX} are looked up per run.`]
          : []),
        args.rank
          ? saved
            ? `The site's rank in Common Crawl's web graph was looked up on ${saved.checked} and would be reused, with no download.`
            : `With --rank it would also read the site's rank from Common Crawl's web graph (data.commoncrawl.org): the ranks file is about 2.5 GB in all, read as it downloads and never stored, stopping once ${rankDomain(site.hostname).split(".").reverse().join(".")} is found or after ${capMb} MB. Well-linked sites are found early.`
          : "The site's rank in Common Crawl's web graph isn't read without --rank: that streams a large file.",
        "Re-run with --yes once the owner agrees.",
      ].join("\n"),
    );
    return 0;
  }
  const result = await commonCrawl(site.href, pages);
  if (args.rank) {
    const rank = saved || (await domainRank(site.href, { capBytes: capMb * MB }));
    if (rank.note) result.notes.push(rank.note);
    result.commonCrawl = { ...(result.commonCrawl || {}), rank };
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
  for (const note of result.notes) console.log("commoncrawl: " + note);
  const cc = result.commonCrawl,
    s = cc?.site,
    rk = cc?.rank,
    num = x => x.toLocaleString("en-US");
  const rankLine =
    !rk || rk.found === null
      ? ""
      : rk.found
        ? ` · rank #${num(rk.harmonicPos)} of ${num(rk.domains)} domains (${rk.release})`
        : ` · not in the top ${num(rk.scanned)} of ${num(rk.domains)} domains${rk.capped ? ` (read ${rk.readMB} MB)` : ""}`;
  console.log(
    `commoncrawl: ${cc?.crawl ? `${cc.crawl.name}: ${s ? `${s.capped ? "1,000 or more" : s.captures} saved page(s) of ${host}` : "the site wasn't looked up"}${n ? ` · ${cc.linkingSites.length} linking site(s) found linking to you in its copies` : ""}` : "the index wasn't looked up"}${rankLine} · wrote ${out}`,
  );
  return 0;
}

// The input files are read by backlinks.mjs; its errors are renamed to this script.
if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2)).then(null, e => {
    if (!(e instanceof Fail)) throw e;
    console.error(e.message.replace(/^backlinks: /, "commoncrawl: "));
    return 2;
  });
}
