#!/usr/bin/env node
// @ts-check
// Summarises Search Console's Links exports, the only source as the API has no Links report: who links to the site,
// the link-text mix, and changes since the last audit.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { domainToUnicode } from "node:url";
import { isMain } from "./lib/is-main.mjs";
import { parseCsv } from "./lib/csv.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain } from "./lib/cli.mjs";

const USAGE =
  'usage: node links-import.mjs --dir seo-audit/links --site https://www.example.com [--brand "Acme"] [--keys seo-audit/keys.json] [--previous <earlier links.json>] [--crawl seo-audit/seo-crawl.json] [--out seo-audit/links.json]';
const obj = x => (x && typeof x === "object" ? x : null);
const bare = h => h.toLowerCase().replace(/^www\./, "");

// The tables' first column and their link count, as the English UI names them. Google's help names the tables, not
// the columns; with other headers a file still counts when it has one text column holding the site's page URLs,
// domains or link text.
const KEY = {
  sites: /^(top )?linking sites?$|^sites?$|^domains?$/i,
  texts: /^(top )?linking texts?$|^link texts?$|^anchor texts?$/i,
  pages: /^(top )?linked pages?$|^target (pages?|urls?)$|^pages?$|^urls?$/i,
};
const COUNT = /^(incoming |external )?links$|^linking pages$/i;
const FIELD = { sites: "domain", texts: "text", pages: "url" };
const NAME = { sites: "Top linking sites", texts: "Top linking text", pages: "Top linked pages" };
const NUM = /^\d[\d.,\s  ']*$/,
  DOMAIN = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+$/u;
// "~" and "-" export as 0, and each table holds at most 1,000 rows.
// https://support.google.com/webmasters/answer/9049606
const count = s => Number(String(s).replace(/\D/g, "") || 0); // "1,200", "1.200" and "1 200" are all 1200

// One export: { kind: "sites" | "texts" | "pages", rows } most links first, or { kind: null } when it's none of the
// three.
export function readExport(text, site) {
  const rows = parseCsv(text),
    heads = Object.keys(rows[0] || {});
  const numeric = h => rows.some(r => r[h]) && rows.every(r => !r[h] || NUM.test(r[h]));
  const words = heads.filter(h => !numeric(h)),
    nums = heads.filter(numeric);
  let kind = Object.keys(KEY).find(k => words.some(h => KEY[k].test(h)));
  if (!kind && words.length !== 1) return { kind: null }; // e.g. Latest links: linking page and date
  const key = kind ? words.find(h => KEY[kind].test(h)) : words[0],
    vals = rows.map(r => r[key]).filter(Boolean);
  const host = bare(new URL(site).hostname);
  const onSite = v => {
    try {
      const h = bare(new URL(v).hostname);
      return /^https?:\/\//i.test(v) && (h === host || h.endsWith("." + host));
    } catch {
      return false;
    }
  };
  // Other sites' URLs are linking pages (Latest links in another language), not this site's linked pages.
  kind ||= !vals.length
    ? null
    : vals.every(onSite)
      ? "pages"
      : vals.some(v => /^https?:\/\//i.test(v))
        ? null
        : vals.every(v => DOMAIN.test(v))
          ? "sites"
          : "texts";
  if (!kind) return { kind: null };
  const n = nums.find(h => COUNT.test(h)) || nums[0];
  // Top linking sites also has Target pages: how many of the site's pages each one links to. In another language it's
  // the other number column.
  const t =
    kind !== "sites"
      ? undefined
      : nums.find(h => /^target pages?$/i.test(h)) || (nums.length === 2 ? nums.find(h => h !== n) : null);
  const out = rows
    .map(r => ({
      [FIELD[kind]]: r[key],
      links: n ? count(r[n]) : null,
      ...(t !== undefined && { targets: t ? count(r[t]) : null }),
    }))
    .filter(r => kind === "texts" || r[FIELD[kind]]);
  return { kind, rows: out.sort((a, b) => (b.links ?? 0) - (a.links ?? 0)) };
}

// Google calls "click here", "read more", "website" and "article" too generic; the rest are the same kind of words.
// https://developers.google.com/search/docs/crawling-indexing/links-crawlable
const GENERIC = new Set([
  "click here",
  "here",
  "click",
  "read more",
  "more",
  "learn more",
  "find out more",
  "more info",
  "details",
  "website",
  "web site",
  "this website",
  "the website",
  "site",
  "this site",
  "visit",
  "visit site",
  "visit website",
  "link",
  "this link",
  "article",
  "this article",
  "source",
  "home",
  "homepage",
  "home page",
  "this",
  "page",
  "this page",
  "continue reading",
]);
const norm = s =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
// Anything shaped like a host name is an address, so "Node.js" counts as one. That's rare in link text.
const ADDRESS = /^(https?:\/\/)?[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d+)?([/?#]\S*)?$/iu;
// The brand when one of its names ("Acme Plumbing|Acme") appears as whole words, also run together ("AcmePlumbing" for
// "Acme Plumbing", and back), so "Ace" isn't found inside "space". A legal ending ("Ltd", "Inc", "GmbH") isn't needed.
const LEGAL = / (ltd|limited|inc|llc|llp|plc|gmbh|co|corp|company|pty|bv|ag|sa|srl|sarl)$/;
const brandNames = brand =>
  String(brand ?? "")
    .split("|")
    .map(b => {
      let n = norm(b);
      while (LEGAL.test(n)) n = n.replace(LEGAL, "");
      return n.replace(/ /g, "");
    })
    .filter(Boolean);
const hasBrand = (text, brand) => {
  const w = norm(text).split(" ");
  return brandNames(brand).some(b => w.some((_, i) => w.slice(i).some((_, j) => w.slice(i, i + j + 1).join("") === b)));
};
export const classify = (text, brand) =>
  ADDRESS.test(String(text).trim())
    ? "address"
    : hasBrand(text, brand)
      ? "brand"
      : GENERIC.has(norm(text))
        ? "generic"
        : "other";
// The site's name from its address, as Unicode: the label before the public suffix, so shop.acme.com and acme.co.uk
// give "acme" and xn--bcher-kva.de gives "bücher". A two-letter country code after a label of 3 letters or fewer counts
// as the suffix (co.uk, com.au). Use the Public Suffix List if a site's name comes out wrong.
export const siteName = host => {
  const l = domainToUnicode(bare(host)).split(".");
  return (
    l[Math.max(l.length >= 3 && l.at(-1).length === 2 && l.at(-2).length <= 3 ? l.length - 3 : l.length - 2, 0)] || ""
  );
};
// The brand names to match: the given ones ("Acme Plumbing|Acme") plus the site's name, each once.
export const withSiteName = (brand, host) => {
  const seen = new Set();
  return [...String(brand ?? "").split("|"), siteName(host)]
    .map(s => s.trim())
    .filter(s => {
      const k = brandNames(s)[0];
      return k && !seen.has(k) && seen.add(k);
    })
    .join("|");
};
// Links with no text (usually image links): Search Console exports them as empty rows. They have no words to judge.
const hasText = t => norm(t ?? "") !== "";

// Shares from 0 to 1 of the links with text: of links when the export counts them, else of the texts listed (Search
// Console merges duplicates).
export function anchorMix(texts, brand) {
  texts = texts.filter(t => hasText(t.text));
  const w = texts.every(t => t.links != null) ? t => t.links : () => 1,
    total = texts.reduce((s, t) => s + w(t), 0);
  if (!total) return null;
  const mix = { brand: 0, address: 0, generic: 0, other: 0 };
  for (const t of texts) mix[classify(t.text, brand)] += w(t);
  for (const k in mix) mix[k] = Math.round((mix[k] / total) * 1000) / 1000;
  return mix;
}

// Never a score or a finding, and never called "toxic": Google can usually judge links on its own and most sites never
// need the disavow tool, so each item says why it's listed and what to look at.
// https://support.google.com/webmasters/answer/2648487
// The cut-offs below are local lines for "stands out"; Google publishes none.
const ONLY = "Only disavow links you know are paid or were made to manipulate rankings.";
// https://developers.google.com/search/docs/essentials/spam-policies#link-spam
const SPAM =
  "Google's spam policies count “links with optimized anchor text in articles, guest posts, or press releases distributed on other sites” as link spam.";
const pct = x => `${Math.round(x * 100)}%`;
// outDomains: the crawl's linksToOtherSites.domains ({ host: count }), the sites the crawled pages link to.
export function worthALook({ sites = [], texts = [], sample = [], outDomains }, site, brand) {
  const own = bare(site.hostname),
    mine = h => {
      const b = bare(h);
      return b === own || b.endsWith("." + own);
    };
  const out = [],
    others = sites.filter(s => !mine(s.domain)),
    total = others.reduce((n, s) => n + (s.links || 0), 0);
  // Sitewide-looking: many of one site's pages link to few of this site's, and they're a big share of all links.
  for (const s of others
    .filter(s => s.links >= 50 && s.targets != null && s.targets <= 3 && s.links >= total * 0.2)
    .slice(0, 5))
    out.push({
      kind: "sitewide",
      subject: s.domain,
      why: `Links to you from ${s.links.toLocaleString("en-US")} of its pages, but to only ${s.targets} of yours: ${pct(s.links / total)} of all the links Search Console listed. A link on every page like this is usually in a footer or sidebar.`,
      look: `That's fine from a partner, a client, a supplier or another site you run. If you don't know the site, open a few of its pages and look at the link and its words. ${ONLY}`,
    });
  // Link text: 3 in 4 descriptive (not brand, address or generic), from at least 10 texts with words.
  const named = texts.filter(t => hasText(t.text)),
    mix = named.length >= 10 && anchorMix(named, brand);
  if (mix && mix.other >= 0.75)
    out.push({
      kind: "keyword-text",
      subject: "Link text to your site",
      why: `${pct(mix.other)} of the link text is descriptive words, not your brand (read as “${String(brand)
        .split("|")
        .map(s => s.trim())
        .filter(Boolean)
        .join("” or “")}”) or your web address.`,
      look: `That's normal when people link to articles by their titles. It's worth a look if you, or someone you paid, placed links: ${SPAM} ${ONLY}`,
      examples: named
        .filter(t => classify(t.text, brand) === "other")
        .slice(0, 5)
        .map(t => t.text),
    });
  // Bing's sample of links to the home page: the same descriptive words from 3 or more sites. People who link on their
  // own rarely pick the same words.
  const same = new Map();
  for (const l of sample) {
    let h;
    try {
      h = bare(new URL(l.url).hostname);
    } catch {
      continue;
    }
    if (
      mine(h) ||
      typeof l.anchorText !== "string" ||
      !hasText(l.anchorText) ||
      classify(l.anchorText, brand) !== "other"
    )
      continue;
    const k = norm(l.anchorText),
      g = same.get(k) || { text: l.anchorText.trim(), hosts: new Set(), urls: [] };
    g.hosts.add(h);
    g.urls.push(l.url);
    same.set(k, g);
  }
  for (const g of [...same.values()]
    .filter(g => g.hosts.size >= 3)
    .sort((a, b) => b.hosts.size - a.hosts.size)
    .slice(0, 5))
    out.push({
      kind: "same-text",
      subject: g.text,
      why: `The same link text comes from ${g.hosts.size} different sites in Bing's sample of links to your home page. People who link on their own rarely pick the same words.`,
      look: `Check whether you, or someone you paid, placed these links. ${SPAM} ${ONLY}`,
      examples: g.urls.slice(0, 5),
    });
  // Reciprocal: sites that link to you and that your crawled pages link to (a subdomain counts for its root domain, as
  // Search Console lists sites by root domain). 10 or more sites and 10% of the linking sites listed are local lines.
  const to = Object.keys(obj(outDomains) || {}).map(bare);
  const both = others.filter(s => {
    const d = bare(s.domain);
    return to.some(h => h === d || h.endsWith("." + d));
  });
  if (both.length >= 10 && both.length * 10 >= others.length)
    out.push({
      kind: "reciprocal",
      subject: "Sites you link to that link back",
      why: `You link to ${both.length} of the ${others.length} sites that link to you, so many of the links go both ways.`,
      look: `That's normal between partners, suppliers and sites that cover each other. It's worth a look if the links were swapped to get links: Google's spam policies count “Excessive link exchanges ("Link to me and I'll link to you") or partner pages exclusively for the sake of cross-linking” as link spam. ${ONLY}`,
      examples: both.slice(0, 5).map(s => s.domain),
    });
  return out;
}

// An empty previous list may mean there was no export, so it isn't compared. Each export stops at 1,000 rows, so with
// either at 1,000 a "new" site may only have been past the cut before (capped).
export function newLinks(before, after, site) {
  if (!Array.isArray(before?.sites) || !before.sites.length || !after?.length) return null;
  const own = bare(site.hostname),
    key = d => bare(String(d ?? "")),
    mine = d => d === own || d.endsWith("." + own) || own.endsWith("." + d);
  const had = new Set(before.sites.map(s => key(obj(s)?.domain)));
  const fresh = after.filter(s => !had.has(key(s.domain)) && !mine(key(s.domain)));
  return fresh.length
    ? {
        count: fresh.length,
        sites: fresh.slice(0, 100).map(({ domain, links }) => ({ domain, links })),
        since: typeof before.when === "string" ? before.when : null,
        capped: before.sites.length >= 1000 || after.length >= 1000,
      }
    : null;
}

// Indexable crawled pages missing from Search Console's and Bing's linked pages, matched by path as in brokenLinked().
// Most pages of any site have no links from other sites, so this is never a finding.
export function unlinkedPages(linked, crawl, site) {
  const host = bare(site.hostname),
    url = u => {
      try {
        return new URL(u);
      } catch {
        return null;
      }
    },
    pathOf = x => x.pathname + x.search;
  const has = new Set(
    linked
      .map(l => url(l.url))
      .filter(u => u && bare(u.hostname) === host)
      .map(pathOf),
  );
  const pages = crawl.pages.filter(
    p =>
      obj(p) &&
      !p.noindex &&
      url(p.url) &&
      (!p.canonical || pathOf(url(p.canonical) || url(p.url)) === pathOf(url(p.url))),
  );
  const none = pages.filter(p => !has.has(pathOf(url(p.url))));
  return none.length ? { count: none.length, of: pages.length, urls: none.slice(0, 100).map(p => p.url) } : null;
}

// Latest links' date column (the linking page's last crawl) is never earlier than the day a link was found, so its
// newest date bounds when any link in it was found. https://support.google.com/webmasters/answer/9049606
const ISO = /^\d{4}-\d{2}-\d{2}/;
export function newestLink(text) {
  const rows = parseCsv(text),
    heads = Object.keys(rows[0] || {});
  const col = heads.find(h => rows.some(r => r[h]) && rows.every(r => !r[h] || ISO.test(r[h])));
  return (
    (col
      ? rows
          .map(r => String(r[col]).slice(0, 10))
          .filter(d => ISO.test(d) && !isNaN(Date.parse(d)))
          .sort()
      : []
    ).at(-1) || null
  );
}
// No new link found for 3 months or more before the export's date: { newest, asOf }, or null.
export function noNewLinks(newest, asOf) {
  if (!newest) return null;
  const cut = new Date(asOf);
  cut.setUTCMonth(cut.getUTCMonth() - 3);
  return newest < cut.toISOString().slice(0, 10) ? { newest, asOf: new Date(asOf).toISOString().slice(0, 10) } : null;
}

// Linking sites (Search Console) or Bing's linked pages fell by 30% or more and by at least 10. A count is compared
// only when both summaries have it: an export missing this time is no data, not zero links. The bigger fall is
// reported.
export function linksChange(before, after) {
  const fell = ["sites", "bingPages"]
    .filter(
      k =>
        Number.isFinite(before?.[k]) &&
        Number.isFinite(after[k]) &&
        before[k] - after[k] >= 10 &&
        (before[k] - after[k]) * 10 >= before[k] * 3,
    )
    .sort((a, b) => after[a] / before[a] - after[b] / before[b]);
  return fell.length ? { kind: "links-dropped", what: fell[0], before: before[fell[0]], after: after[fell[0]] } : null;
}

// Linked pages the crawl found broken: 404 or 410, a redirect loop, or a redirect to the home page, which Google may
// treat as a soft 404. https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes
// Matched by path so a local crawl works; other hosts' pages and pages the crawl didn't reach aren't judged.
export function brokenLinked(linked, crawl, site) {
  const host = bare(site.hostname),
    url = u => {
      try {
        return new URL(u);
      } catch {
        return null;
      }
    },
    pathOf = x => x.pathname + x.search;
  const byPath = list =>
    new Map(
      (list || [])
        .map(x => [url(x.url ?? x.from), x])
        .filter(([u]) => u)
        .map(([u, x]) => [pathOf(u), x]),
    );
  const pages = byPath(crawl.pages),
    errors = byPath(crawl.errors),
    redirects = byPath(crawl.redirects);
  // The home page's other addresses (index.html, default.aspx, /home, a bare language prefix like /en/ or /en-us/)
  // belong there.
  const homeAlias = p => /^\/((index|default)\.\w+|home\/?|[a-z]{2}([-_][a-z]{2})?\/?)$/i.test(p);
  const toHome = r => {
    const t = url(r.to),
      f = url(r.from);
    return (
      !!t &&
      !!f &&
      t.pathname === "/" &&
      !t.search &&
      pathOf(f) !== "/" &&
      !homeAlias(f.pathname) &&
      (t.origin === f.origin || bare(t.hostname) === host)
    );
  };
  const seen = new Set(),
    broken = [];
  let unreached = 0;
  for (const l of linked) {
    const u = url(l.url);
    if (!u || bare(u.hostname) !== host || seen.has(pathOf(u))) continue;
    seen.add(pathOf(u));
    const r = redirects.get(pathOf(u)),
      status = errors.get(pathOf(u))?.status;
    const why =
      r && r.to == null
        ? "redirects in a loop"
        : r && toHome(r)
          ? "redirects to the home page"
          : status === 404 || status === 410
            ? `returns ${status}`
            : null;
    const n = l.links,
      from =
        n == null
          ? "linked from other sites"
          : `${n.toLocaleString("en-US")} link${n === 1 ? "" : "s"} from other sites`;
    if (why) broken.push({ url: l.url, links: n ?? 0, detail: `${why} · ${from} (${l.source})` });
    else if (!r && !pages.has(pathOf(u)) && !errors.has(pathOf(u))) unreached++;
  }
  broken.sort((a, b) => b.links - a.links);
  const findings = broken.length
    ? [
        {
          id: "I-001",
          check: "linked-page-broken",
          rule: "URL-07",
          severity: "medium",
          category: "URLs & canonicals",
          title: `${broken.length} page(s) other sites link to are broken or redirect to the home page`,
          what: `${broken.length === 1 ? "Found on" : `${broken.length} cases, for example`} \`${broken[0].url.replace(/`/g, "%60")}\` (${broken[0].detail}).`,
          why: "Other sites link to these pages, but they now return 404 or 410, redirect in a loop, or redirect to the home page, which Google may treat as a soft 404. Visitors who follow those links hit a dead end, and what the links brought the site is lost.",
          fix: "Redirect each one with a 301 to the closest live page: the page that replaced it, or its section, never just the home page. If the content is gone for good and nothing comes close, keep the 404 or 410 and ask the linking sites to update the link (Search Console's Links report lists them).",
          count: broken.length,
          evidence: broken.slice(0, 100).map(b => ({ url: b.url, detail: b.detail })),
          source: "links-import",
          status: "open",
        },
      ]
    : [];
  return { findings, unreached };
}

function main(argv) {
  const args = parseArgs(argv, { flags: ["dir", "site", "brand", "keys", "previous", "crawl", "out"], positionals: 0 });
  const str = k => (typeof args[k] === "string" ? args[k] : null);
  if (!str("dir") || !str("site")) throw new Fail(USAGE);
  let site;
  try {
    site = new URL(args.site);
  } catch {}
  if (!site || !/^https?:$/.test(site.protocol))
    throw new Fail(`links-import: --site must be the site's address, like https://www.example.com (got ${args.site})`);
  const notes = [],
    dir = resolve(args.dir);
  // Subfolders too, so several zips can be unzipped side by side. Files are told apart by their columns, not names.
  const all = existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir, { recursive: true }).map(String) : [];

  // Newest file first, so a second export of the same table replaces the older one.
  // A list of linking pages whose name says "latest" is read as Latest links, for its newest date: More sample links
  // has the same columns, but it's a sample, so its dates say nothing about new links.
  const got = {};
  let latest = null;
  for (const f of all
    .filter(f => /\.csv$/i.test(f))
    .sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)) {
    const text = readFileSync(join(dir, f), "utf8"),
      x = readExport(text, site.href),
      newest = !x.kind && /latest/i.test(basename(f)) ? newestLink(text) : null;
    if (newest && !latest) latest = { newest, when: statSync(join(dir, f)).mtime };
    if (!x.kind)
      notes.push(
        newest
          ? `${f} was read as Search Console's Latest links export, for the date of the newest link. To check those links are still there, pass it to backlinks.mjs --csv.`
          : `${f} isn't Search Console's Top linking sites, Top linking text or Top linked pages export, so it wasn't read. A list of linking pages (Latest links or More sample links) goes to backlinks.mjs --csv instead, which checks those links are still there. Keep "latest" in the name of the Latest links export: its dates show whether new links still arrive.`,
      );
    else if (got[x.kind]) notes.push(`${f} is another ${NAME[x.kind]} export; the newer ${got[x.kind].f} was used.`);
    else got[x.kind] = { f, rows: x.rows, when: statSync(join(dir, f)).mtime };
  }
  const kinds = Object.keys(got),
    rows = k => got[k]?.rows || [];
  const links = kinds.length
    ? {
        sites: rows("sites"),
        texts: rows("texts"),
        pages: rows("pages"),
        source: "search-console",
        when: new Date(Math.max(...kinds.map(k => got[k].when))).toISOString(),
      }
    : null;
  const zips = all.filter(f => /\.zip$/i.test(f)).length;
  if (!links)
    notes.push(
      `No Search Console links export was found in ${args.dir}${zips ? ` (${zips} zip file${zips === 1 ? " is" : "s are"} there: unzip ${zips === 1 ? "it" : "them"} first)` : ""}, so links from other sites weren't summarised this time. In Search Console, open Links, click More under Top linking sites, Top linking text and Top linked pages, and export each as CSV into that folder.`,
    );

  const brand = withSiteName(str("brand"), site.hostname);
  if (links?.texts.length)
    notes.push(
      `Link text counts as your brand when it contains “${brand.split("|").join("” or “")}”${str("brand") ? " (from --brand and the site's address)" : ", taken from the site's address. Pass --brand with the business name if it's different"}.`,
    );
  const readJson = (f, what) => {
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      notes.push(
        `Couldn't read ${f} (${e.code === "ENOENT" ? "it isn't there" : e.code || "it isn't JSON"}), so ${what}.`,
      );
      return null;
    }
  };
  const keys = str("keys") ? readJson(args.keys, "Bing's linked pages weren't counted") : null;
  const linkSummary = {
    sites: got.sites ? links.sites.length : null,
    pages: got.pages ? links.pages.length : null,
    bingPages: Array.isArray(keys?.bing?.backlinks?.pages) ? keys.bing.backlinks.pages.length : null,
  };
  const previous = str("previous") ? readJson(args.previous, "there was nothing to compare with") : null;
  // Checked against the crawl's data only; nothing is fetched.
  let findings = [],
    unlinked = null;
  const crawl = str("crawl")
    ? readJson(args.crawl, "the pages other sites link to weren't checked against the crawl")
    : null;
  if (crawl && !Array.isArray(crawl.pages))
    notes.push(
      `${args.crawl} isn't the crawler's seo-crawl.json, so the pages other sites link to weren't checked against it.`,
    );
  else if (crawl) {
    const bing = Array.isArray(keys?.bing?.backlinks?.pages)
      ? keys.bing.backlinks.pages.filter(obj).map(p => ({ url: p.url, links: p.count ?? null, source: "Bing" }))
      : [];
    // Pages with no links from other sites: only from a Top linked pages export under 1,000 rows, the most it holds.
    if (got.pages && links.pages.length >= 1000)
      notes.push(
        "Top linked pages has 1,000 rows, the most an export holds, so pages past the cut may have links from other sites too: the pages with none weren't listed.",
      );
    else if (got.pages) unlinked = unlinkedPages([...links.pages, ...bing], crawl, site);
    const checked = brokenLinked(
      [...(links?.pages || []).map(p => ({ ...p, source: "Search Console" })), ...bing],
      crawl,
      site,
    );
    findings = checked.findings;
    const n = checked.unreached;
    if (n)
      notes.push(
        `${n} of the pages other sites link to ${n === 1 ? "wasn't" : "weren't"} reached by the crawl, so whether ${n === 1 ? "it still works" : "they still work"} wasn't checked. List them in a file, one per line, pass it to seo-crawl.mjs with --urls and run links-import again: the ones that fail or redirect are judged then.`,
      );
  }
  const sample = Array.isArray(keys?.bing?.backlinks?.sample) ? keys.bing.backlinks.sample.filter(obj) : [];
  const look = worthALook(
    { sites: links?.sites, texts: links?.texts, sample, outDomains: obj(crawl?.linksToOtherSites)?.domains },
    site,
    brand,
  );
  const result = {
    links,
    linkSummary,
    anchorMix: links?.texts.length ? anchorMix(links.texts, brand) : null,
    linksChange: linksChange(obj(previous?.linkSummary), linkSummary),
    newLinks: got.sites ? newLinks(obj(previous?.links), links.sites, site) : null,
    noNewLinks: latest && noNewLinks(latest.newest, latest.when),
    unlinkedPages: unlinked,
    worthALook: look,
    findings,
    notes,
  };

  const out = resolve(str("out") || "seo-audit/links.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
  const c = result.linksChange;
  console.log(
    `links-import: ${links ? `${links.sites.length} linking sites, ${links.pages.length} linked pages, ${links.texts.length} link texts` : "no Search Console export"}${c ? ` · ${c.what} dropped ${c.before} → ${c.after}` : ""}${result.newLinks ? ` · ${result.newLinks.count} new linking site${result.newLinks.count === 1 ? "" : "s"}` : ""}${result.noNewLinks ? ` · no new links found since ${result.noNewLinks.newest}` : ""}${findings.length ? ` · ${findings[0].count} linked page(s) broken` : ""}${look.length ? ` · ${look.length} worth a look` : ""} · wrote ${out}`,
  );
  return 0;
}

if (isMain(import.meta.url)) await runMain(() => main(process.argv.slice(2)));
