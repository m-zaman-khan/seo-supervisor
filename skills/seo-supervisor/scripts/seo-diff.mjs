#!/usr/bin/env node
// Reports what changed between two crawls. Pages are matched by path, so a local crawl compares with the public site.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { LIMITS, fmtCwv } from "./checks/speed.mjs";

const pathOf = u => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const ok = s => s === 200;

// Speed compares like with like, by path. Field data is slower when any Core Web Vital crosses its limit, or moves 20%
// and at least 300 ms (LCP), 50 ms (INP) or 0.05 (CLS). Lab runs swing more, so lab LCP must move 40% and 1 s, and a
// Lighthouse score 15 points. Each SPEED row: name, value by URL (null when none), verdict (-1 slower, 1 faster,
// 0 no real change).
const lcpMove = (o, n, share, ms) => {
  const d = n.lcp - o.lcp;
  return Math.abs(d) >= Math.max(ms, o.lcp * share) ? -Math.sign(d) : 0;
};
const crossed = (o, n, worse) =>
  Object.entries(LIMITS).some(
    ([k, lim]) => o[k] != null && n[k] != null && (worse ? o[k] <= lim && n[k] > lim : o[k] > lim && n[k] <= lim),
  );
const REAL_MOVE = { lcp: 300, inp: 50, cls: 0.05 };
const realMove = (o, n) => {
  const v = Object.entries(REAL_MOVE)
    .filter(([k]) => o[k] != null && n[k] != null)
    .map(([k, min]) => {
      const d = n[k] - o[k];
      return Math.abs(d) >= Math.max(min, o[k] * 0.2) ? -Math.sign(d) : 0;
    });
  return v.includes(-1) ? -1 : v.includes(1) ? 1 : 0;
};
const real = (o, n) => (crossed(o, n, true) ? -1 : realMove(o, n) || (crossed(o, n, false) ? 1 : 0));
const field = samples => samples?.map(s => [s.url, s.field?.lcp != null ? s.field : null]);
const SPEED = [
  ["real visitors", r => field(r.speed?.samples), real, fmtCwv],
  ["real visitors, desktop", r => field(r.speed?.desktop?.samples), real, fmtCwv],
  [
    "lab test",
    r => r.labSpeed?.map(l => [l.url, l.lcp != null ? l : null]),
    (o, n) => lcpMove(o, n, 0.4, 1000),
    fmtCwv,
  ],
  [
    "Lighthouse",
    r => r.lighthouse?.map(l => [l.url, l.scores?.performance ?? null]),
    (o, n) => (Math.abs(n - o) >= 15 ? Math.sign(n - o) : 0),
    v => `performance score ${v}`,
  ],
];

// Each rule is tagged with its group's user agents, so a rule moving between crawlers shows. As in the crawler, a
// User-agent line after a rule starts a new group.
function robotsLines(text) {
  let agents = [],
    ruled = true;
  const out = [];
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(),
      key = line.split(":")[0].trim().toLowerCase();
    if (!line) continue;
    if (key === "user-agent") {
      if (ruled) agents = [];
      ruled = false;
      agents.push(line.slice(line.indexOf(":") + 1).trim());
      continue;
    }
    if (key === "allow" || key === "disallow") {
      ruled = true;
      out.push(`${line} (${agents.join(", ") || "no user agent"})`);
    } else out.push(line);
  }
  return out;
}
// Compares the first 50 KB the crawl keeps; a change past that (rare: Google reads 500 KiB) changes only the hash.
function robotsChange(o, n) {
  if (o.status === n.status && o.hash === n.hash) return null;
  const was = robotsLines(o.text),
    now = robotsLines(n.text);
  const lines = [
    ...was.filter(l => !now.includes(l)).map(l => `− ${l}`),
    ...now.filter(l => !was.includes(l)).map(l => `+ ${l}`),
  ];
  if (o.status === n.status && !lines.length) return null; // comments, spacing or order only
  const detail = [
    o.status !== n.status && `status ${o.status} → ${n.status}`,
    lines.length && lines.slice(0, 8).join(" · ") + (lines.length > 8 ? ` · and ${lines.length - 8} more` : ""),
  ]
    .filter(Boolean)
    .join("; ");
  return {
    path: "/robots.txt",
    kind: "robots-changed",
    before: `status ${o.status}`,
    after: `status ${n.status}`,
    detail,
  };
}
const permanent = s => s === 301 || s === 308;
// A redirect's target by path when it stays on the same host, in full when it leaves it; null when it never ends.
const target = r => {
  if (r.to == null) return null;
  try {
    const t = new URL(r.to),
      f = new URL(r.from);
    return t.origin === f.origin ? t.pathname + t.search : t.href;
  } catch {
    return r.to;
  }
};
const redirectText = r => (target(r) == null ? "a redirect loop" : `${r.status} to ${target(r)}`);

export function diffCrawls(oldReport, newReport) {
  // Working pages plus the crawl's error records, so a page that now fails is a status change, not "gone".
  const index = r => new Map([...(r.pages || []), ...(r.errors || [])].map(p => [pathOf(p.url), p]));
  const before = index(oldReport),
    after = index(newReport);
  const regressions = [],
    improvements = [],
    changed = [],
    compared = new Set();
  // Sitemap listing only when both crawls read the whole sitemap: one that failed this time is sitemap-missing, and a
  // file that failed or went unread past a limit isn't every page in it leaving. An older crawl is whole when every
  // file answered 200.
  const wholeSitemap = r =>
    (r.pages || []).some(p => p.inSitemap) &&
    (r.stats?.sitemapComplete ?? (r.stats?.sitemapFiles || []).every(f => f.status === 200));
  const sitemaps = wholeSitemap(oldReport) && wholeSitemap(newReport);
  if (sitemaps) compared.add("sitemap");
  // A crawl that stopped at --max, or covered one part of the site (--include/--exclude, recorded as `section`) the
  // other didn't, missed pages the other has: they aren't gone (or new). Internal links and section sizes only when
  // both crawls were whole: linksIn counts links on the pages crawled.
  const capped = r => r.stats?.capped ?? r.stats?.fetched >= r.options?.max;
  const links = !capped(oldReport) && !capped(newReport);
  const hasRedirects = Array.isArray(oldReport.redirects) && Array.isArray(newReport.redirects);
  const redirectsOf = r => new Map((r.redirects || []).map(x => [pathOf(x.from), x]));
  const wasRedirect = redirectsOf(oldReport),
    nowRedirect = hasRedirects ? redirectsOf(newReport) : new Map();
  for (const [path, o] of before) {
    const n = after.get(path);
    if (!n) continue;
    const change = (list, kind, b, a) => list.push({ path, kind, before: b ?? null, after: a ?? null });
    if (ok(o.status) && !ok(n.status)) {
      change(regressions, "status-error", o.status, n.status);
      continue;
    }
    if (!ok(o.status) && ok(n.status)) {
      change(improvements, "status-fixed", o.status, n.status);
      continue;
    }
    if (!ok(n.status)) continue;
    if (!o.noindex && n.noindex) change(regressions, "noindex-added", "index", "noindex");
    if (o.noindex && !n.noindex) change(improvements, "noindex-removed", "noindex", "index");
    const oc = o.canonical ? pathOf(o.canonical) : null,
      nc = n.canonical ? pathOf(n.canonical) : null;
    // Better: it now points at itself, or no longer points elsewhere. Worse: it lost its self-canonical or points away.
    if (oc !== nc)
      change(
        nc === path || (nc === null && oc !== path) ? improvements : regressions,
        "canonical-changed",
        o.canonical,
        n.canonical,
      );
    if (o.h1 > 0 && !n.h1) change(regressions, "h1-removed", o.h1, n.h1);
    if (!o.h1 && n.h1 > 0) change(improvements, "h1-added", o.h1, n.h1);
    const os = new Set(o.schema || []),
      ns = new Set(n.schema || []);
    const gone = [...os].filter(t => !ns.has(t)),
      added = [...ns].filter(t => !os.has(t));
    if (gone.length) change(regressions, "schema-removed", gone.join(", "), [...ns].join(", ") || "none");
    if (added.length) change(improvements, "schema-added", [...os].join(", ") || "none", added.join(", "));
    if ((o.title || "") !== (n.title || "")) change(n.title ? changed : regressions, "title-changed", o.title, n.title);
    // Fields older crawls didn't record are compared only when both crawls have them.
    const both = k => k in o && k in n;
    if (both("description")) compared.add("description");
    if (both("ogTitle") && both("ogImage")) compared.add("og");
    if (both("words")) compared.add("words");
    if (both("description") && (o.description || "") !== (n.description || ""))
      change(n.description ? changed : regressions, "description-changed", o.description, n.description);
    if (both("ogTitle") && both("ogImage")) {
      const tags = r => [r.ogTitle && "og:title", r.ogImage && "og:image"].filter(Boolean).join(", ") || null;
      if ((o.ogTitle && !n.ogTitle) || (o.ogImage && !n.ogImage)) change(regressions, "og-removed", tags(o), tags(n));
      if ((!o.ogTitle && n.ogTitle) || (!o.ogImage && n.ogImage)) change(improvements, "og-added", tags(o), tags(n));
    }
    if (both("words") && o.words - n.words >= 100 && n.words < o.words / 2)
      change(regressions, "content-shrunk", o.words, n.words);
    if (both("words") && n.words - o.words >= 100 && n.words > o.words * 2)
      change(changed, "content-grew", o.words, n.words);
    // Noindex pages and pages canonical elsewhere belong out of the sitemap; their own change kind says why.
    if (sitemaps && both("inSitemap") && !n.noindex && (!nc || nc === path)) {
      if (o.inSitemap && !n.inSitemap) change(regressions, "left-sitemap", "listed", "not listed");
      if (!o.inSitemap && n.inSitemap) change(improvements, "joined-sitemap", "not listed", "listed");
    }
    if (links && both("linksIn")) compared.add("links");
    if (links && both("linksIn") && o.linksIn - n.linksIn >= 5 && n.linksIn * 2 <= o.linksIn)
      change(regressions, "lost-internal-links", o.linksIn, n.linksIn);
    // Field names only, per type both crawls have: prices and dates change every crawl.
    if (both("schemaProps")) {
      compared.add("schemaProps");
      for (const [type, was] of Object.entries(o.schemaProps)) {
        const now = n.schemaProps[type];
        if (!now) continue;
        const lost = was.filter(k => !now.includes(k)),
          got = now.filter(k => !was.includes(k));
        if (lost.length)
          regressions.push({
            path,
            kind: "schema-fields-removed",
            detail: `${type} lost ${lost.join(", ")}`,
            before: was.join(", "),
            after: now.join(", "),
          });
        if (got.length)
          improvements.push({
            path,
            kind: "schema-fields-added",
            detail: `${type} gained ${got.join(", ")}`,
            before: was.join(", "),
            after: now.join(", "),
          });
      }
    }
  }
  if (oldReport.robotsTxt && newReport.robotsTxt) {
    compared.add("robots");
    const c = robotsChange(oldReport.robotsTxt, newReport.robotsTxt);
    if (c) changed.push(c);
  }
  if (hasRedirects) {
    compared.add("redirects");
    for (const [path, n] of nowRedirect) {
      const o = wasRedirect.get(path),
        was = before.get(path);
      // A new target or a loop is a regression; the same target made permanent is an improvement, made temporary a
      // regression. 301 and 308, or 302, 303 and 307, swapping (a server change) is no change.
      const moved = o && target(o) !== target(n);
      if (o && (moved || permanent(o.status) !== permanent(n.status)))
        (moved || permanent(o.status) ? regressions : improvements).push({
          path,
          kind: "redirect-changed",
          before: redirectText(o),
          after: redirectText(n),
        });
      // Only a URL the last crawl had as a page or an error: one first met this time isn't a new redirect.
      if (!o && was) changed.push({ path, kind: "redirect-added", before: was.status, after: redirectText(n) });
    }
    // Only a URL this crawl reached: one no longer linked isn't a removed redirect. Ending in an error is a regression.
    for (const [path, o] of wasRedirect) {
      const now = after.get(path);
      if (now && !nowRedirect.has(path))
        (ok(now.status) ? changed : regressions).push({
          path,
          kind: "redirect-removed",
          before: redirectText(o),
          after: now.status,
        });
    }
  }
  for (const [source, read, judge, fmt] of SPEED) {
    const was = new Map((read(oldReport) || []).filter(([, v]) => v != null).map(([u, v]) => [pathOf(u), v]));
    for (const [u, now] of read(newReport) || []) {
      const path = pathOf(u),
        old = was.get(path);
      if (now == null || old == null) continue;
      compared.add("speed");
      const v = judge(old, now);
      if (v)
        (v < 0 ? regressions : improvements).push({
          path,
          kind: v < 0 ? "speed-slower" : "speed-faster",
          source,
          before: fmt(old),
          after: fmt(now),
        });
    }
  }
  return {
    regressions,
    improvements,
    changed,
    compared: [...compared], // the optional fields both crawls recorded, so the report claims only those
    // Only new pages that load: a new URL in the error list is a broken link target, not an added page.
    added: [...after]
      .filter(([p, n]) => !before.has(p) && ok(n.status))
      .map(([p]) => p)
      .sort(),
    removed: [...before.keys()].filter(p => !after.has(p) && !nowRedirect.has(p)).sort(), // a page that now redirects is redirect-added
  };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
  const outAt = args.indexOf("--out");
  if (files.length !== 2) {
    console.error("usage: node seo-diff.mjs old-crawl.json new-crawl.json [--out seo-audit/seo-diff.json]");
    process.exit(1);
  }
  const [oldR, newR] = files.map(f => JSON.parse(readFileSync(f, "utf8")));
  const out = resolve(outAt >= 0 ? args[outAt + 1] : "seo-audit/seo-diff.json");
  const diff = { since: oldR.crawledAt || null, ...diffCrawls(oldR, newR) };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(diff, null, 2));
  console.log(
    `seo-diff: ${diff.regressions.length} regressions, ${diff.improvements.length} improvements, ${diff.added.length} pages added, ${diff.removed.length} gone · wrote ${out}`,
  );
}
