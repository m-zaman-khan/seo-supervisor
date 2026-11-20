#!/usr/bin/env node
// Summarises Search Console's Links exports, the only source as the API has no Links report: who links to the site,
// the link-text mix, and changes since the last audit. Each table exports at most 1,000 rows, "~" and "-" export
// as 0, and link text is merged case-insensitively.
// https://support.google.com/webmasters/answer/9049606
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseCsv } from "./lib/csv.mjs";

const USAGE =
  'usage: node links-import.mjs --dir seo-audit/links --site https://www.example.com [--brand "Acme"] [--keys seo-audit/keys.json] [--previous <earlier links.json>] [--crawl seo-audit/seo-crawl.json] [--out seo-audit/links.json]';
class Fail extends Error {}
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
  const out = rows
    .map(r => ({ [FIELD[kind]]: r[key], links: n ? count(r[n]) : null }))
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
// The brand when its words appear as whole words, also run together ("AcmePlumbing" for "Acme Plumbing", and back),
// so "Ace" isn't found inside "space".
const hasBrand = (text, brand) => {
  const w = norm(text).split(" "),
    b = norm(brand).replace(/ /g, "");
  return !!b && w.some((_, i) => w.slice(i).some((_, j) => w.slice(i, i + j + 1).join("") === b));
};
export const classify = (text, brand) =>
  ADDRESS.test(String(text).trim())
    ? "address"
    : hasBrand(text, brand)
      ? "brand"
      : GENERIC.has(norm(text))
        ? "generic"
        : "other";

// Shares from 0 to 1 of the links with text: of links when the export counts them, else of the texts listed (Search
// Console merges duplicates).
export function anchorMix(texts, brand) {
  const w = texts.every(t => t.links != null) ? t => t.links : () => 1,
    total = texts.reduce((s, t) => s + w(t), 0);
  if (!total) return null;
  const mix = { brand: 0, address: 0, generic: 0, other: 0 };
  for (const t of texts) mix[classify(t.text, brand)] += w(t);
  for (const k in mix) mix[k] = Math.round((mix[k] / total) * 1000) / 1000;
  return mix;
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
  const args = {};
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      args[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    }
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
  for (const f of all
    .filter(f => /\.csv$/i.test(f))
    .sort((a, b) => statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)) {
    const x = readExport(readFileSync(join(dir, f), "utf8"), site.href);
    if (!x.kind)
      notes.push(
        `${f} isn't Search Console's Top linking sites, Top linking text or Top linked pages export, so it wasn't read. A list of linking pages (Latest links or More sample links) goes to backlinks.mjs --csv instead, which checks those links are still there.`,
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

  const brand = str("brand") || bare(site.hostname).split(".")[0];
  if (links?.texts.length)
    notes.push(
      str("brand")
        ? `Link text counts as your brand when it contains “${brand}” (from --brand).`
        : `Link text counts as your brand when it contains “${brand}”, taken from the site's address. Pass --brand with the business name if it's different.`,
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
  let findings = [];
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
    const checked = brokenLinked(
      [...(links?.pages || []).map(p => ({ ...p, source: "Search Console" })), ...bing],
      crawl,
      site,
    );
    findings = checked.findings;
    const n = checked.unreached;
    if (n)
      notes.push(
        `${n} of the pages other sites link to ${n === 1 ? "wasn't" : "weren't"} reached by the crawl, so whether ${n === 1 ? "it still works" : "they still work"} wasn't checked. List them in a file, one per line, and pass it to seo-crawl.mjs with --urls: it tests each one.`,
      );
  }
  const result = {
    links,
    linkSummary,
    anchorMix: links?.texts.length ? anchorMix(links.texts, brand) : null,
    linksChange: linksChange(obj(previous?.linkSummary), linkSummary),
    findings,
    notes,
  };

  const out = resolve(str("out") || "seo-audit/links.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
  const c = result.linksChange;
  console.log(
    `links-import: ${links ? `${links.sites.length} linking sites, ${links.pages.length} linked pages, ${links.texts.length} link texts` : "no Search Console export"}${c ? ` · ${c.what} dropped ${c.before} → ${c.after}` : ""}${findings.length ? ` · ${findings[0].count} linked page(s) broken` : ""} · wrote ${out}`,
  );
  return 0;
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    console.error(e.message);
    process.exitCode = 2;
  }
}
