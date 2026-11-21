#!/usr/bin/env node
// Reports what changed between two crawls. Pages are matched by path, so a local crawl compares with the public site.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
// Retired rich-result types not marked keep: taking one off a page is no loss. FAQPage is kept, since Bing and AI
// engines still read it.
const RETIRED = new Set(
  JSON.parse(readFileSync(new URL("./data/google-rich-results.json", import.meta.url), "utf8"))
    .retired.filter(r => !r.keep)
    .map(r => r.type),
);
const OG = [
  ["ogTitle", "og:title"],
  ["ogImage", "og:image"],
  ["ogDescription", "og:description"],
  ["ogUrl", "og:url"],
];
// "− old · + new" for what went and came, 8 at most.
const changes = (gone, came) => {
  const l = [...gone.map(x => `− ${x}`), ...came.map(x => `+ ${x}`)];
  return l.slice(0, 8).join(" · ") + (l.length > 8 ? ` · and ${l.length - 8} more` : "");
};

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
  const gone = was.filter(l => !now.includes(l)),
    came = now.filter(l => !was.includes(l));
  if (o.status === n.status && !gone.length && !came.length) return null; // comments, spacing or order only
  const detail = [
    o.status !== n.status && `status ${o.status} → ${n.status}`,
    (gone.length || came.length) && changes(gone, came),
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

// Kinds where the page itself changed, so search engines should fetch it again. Links, sitemap listing, speed and pages
// that now fail or are noindex don't count.
const RECRAWL = new Set([
  "status-fixed",
  "noindex-removed",
  "canonical-changed",
  "title-changed",
  "description-changed",
  "h1-added",
  "h1-removed",
  "h1-changed",
  "h2-changed",
  "hreflang-changed",
  "og-added",
  "og-removed",
  "content-shrunk",
  "content-grew",
  "schema-added",
  "schema-removed",
  "schema-retired-removed",
  "schema-fields-added",
  "schema-fields-removed",
  "redirect-added",
  "redirect-changed",
  "redirect-removed",
]);
// Paths to resubmit: those changes plus added pages. Used by indexnow.mjs and connect-keys.mjs submit-bing.
export const changedPages = d =>
  [...(d.regressions || []), ...(d.improvements || []), ...(d.changed || [])]
    .filter(c => RECRAWL.has(c?.kind))
    .map(c => c.path)
    .concat(d.added || []);

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
  const partial = (r, other) =>
    capped(r)
      ? true
      : r.section && JSON.stringify(r.section) !== JSON.stringify(other.section ?? null)
        ? "section"
        : false;
  const goneUnknown = partial(newReport, oldReport),
    addedUnknown = partial(oldReport, newReport);
  const links = !capped(oldReport) && !capped(newReport) && !oldReport.section && !newReport.section;
  // hreflang targets on the site's own hosts compare by path, so a local crawl matches the live one.
  const hosts = r =>
    new Set(
      [r.startUrl, r.siteOrigin]
        .map(u => {
          try {
            return new URL(u).host;
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
  const ownOld = hosts(oldReport),
    ownNew = hosts(newReport);
  const alternates = (p, own) =>
    (p.hreflang || []).map(h => {
      let t = String(h.href);
      try {
        const u = new URL(t, p.url);
        t = own.has(u.host) || u.host === new URL(p.url).host ? u.pathname + u.search : u.href;
      } catch {}
      return `${String(h.lang).toLowerCase()} → ${t}`;
    });
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
      added = [...ns].filter(t => !os.has(t)),
      lost = gone.filter(t => !RETIRED.has(t)),
      retired = gone.filter(t => RETIRED.has(t));
    if (lost.length) change(regressions, "schema-removed", lost.join(", "), [...ns].join(", ") || "none");
    if (retired.length) change(changed, "schema-retired-removed", retired.join(", "), [...ns].join(", ") || "none");
    if (added.length) change(improvements, "schema-added", [...os].join(", ") || "none", added.join(", "));
    if ((o.title || "") !== (n.title || "")) change(n.title ? changed : regressions, "title-changed", o.title, n.title);
    // Fields older crawls didn't record are compared only when both crawls have them.
    const both = k => k in o && k in n;
    if (both("description")) compared.add("description");
    if (both("ogTitle") && both("ogImage")) compared.add("og");
    if (both("words")) compared.add("words");
    if (both("description") && (o.description || "") !== (n.description || ""))
      change(n.description ? changed : regressions, "description-changed", o.description, n.description);
    if (both("h1Text") && o.h1Text && n.h1Text && o.h1Text !== n.h1Text)
      change(changed, "h1-changed", o.h1Text, n.h1Text);
    // H2s that came or went, or a changed count (a repeated heading); a new order alone isn't a change.
    if (both("h2s")) {
      compared.add("h2");
      const went = o.h2s.filter(h => !n.h2s.includes(h)),
        came = n.h2s.filter(h => !o.h2s.includes(h));
      if (went.length || came.length || o.h2s.length !== n.h2s.length)
        changed.push({
          path,
          kind: "h2-changed",
          before: o.h2s.length,
          after: n.h2s.length,
          detail: `${o.h2s.length} → ${n.h2s.length}${went.length || came.length ? `; ${changes(went, came)}` : ""}`,
        });
    }
    // Lost alternates: a regression; only new ones: an improvement; both: a change.
    if (both("hreflang")) {
      compared.add("hreflang");
      const was = alternates(o, ownOld),
        now = alternates(n, ownNew),
        went = was.filter(h => !now.includes(h)),
        came = now.filter(h => !was.includes(h));
      if (went.length || came.length)
        (came.length ? (went.length ? changed : improvements) : regressions).push({
          path,
          kind: "hreflang-changed",
          before: was.join(", ") || "none",
          after: now.join(", ") || "none",
          detail: changes(went, came),
        });
    }
    if (both("ogTitle") && both("ogImage")) {
      const keys = OG.filter(([k]) => both(k)),
        tags = r =>
          keys
            .filter(([k]) => r[k])
            .map(([, t]) => t)
            .join(", ") || null;
      if (keys.some(([k]) => o[k] && !n[k])) change(regressions, "og-removed", tags(o), tags(n));
      if (keys.some(([k]) => !o[k] && n[k])) change(improvements, "og-added", tags(o), tags(n));
    }
    // Thresholds: at least 50 words, and a third fewer or half as many again.
    if (both("words") && o.words - n.words >= 50 && n.words * 1.5 <= o.words)
      change(regressions, "content-shrunk", o.words, n.words);
    if (both("words") && n.words - o.words >= 50 && n.words >= o.words * 1.5)
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
        if (!now || RETIRED.has(type)) continue;
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
  // A section that lost half its pages and at least 10 (a deploy dropped the blog) is one regression on top of the
  // pages gone. The list holds 50 sections, so one missing from a full list may just be past the cut.
  if (links && Array.isArray(oldReport.sections) && Array.isArray(newReport.sections)) {
    compared.add("sections");
    const now = new Map(newReport.sections.map(s => [s.path, s.pages]));
    for (const s of oldReport.sections) {
      const n = now.get(s.path) ?? (newReport.sections.length < 50 ? 0 : null);
      if (n != null && s.pages - n >= 10 && n * 2 <= s.pages)
        regressions.push({ path: s.path, kind: "section-shrunk", before: s.pages, after: n });
    }
  }
  return {
    regressions,
    improvements,
    changed,
    compared: [...compared], // the optional fields both crawls recorded, so the report claims only those
    // Only new pages that load: a new URL in the error list is a broken link target, not an added page. A page the last
    // crawl didn't reach (it stopped at --max, or covered another section) isn't known to be new.
    added: addedUnknown
      ? []
      : [...after]
          .filter(([p, n]) => !before.has(p) && ok(n.status))
          .map(([p]) => p)
          .sort(),
    // A page that now redirects is redirect-added; a URL that failed last time and isn't met now was never a page.
    // A page this crawl didn't reach isn't known to be gone. The reason is true (--max) or "section".
    removed: goneUnknown
      ? []
      : [...before]
          .filter(([p, o]) => ok(o.status) && !after.has(p) && !nowRedirect.has(p))
          .map(([p]) => p)
          .sort(),
    ...(goneUnknown ? { removedUnknown: goneUnknown } : {}),
    ...(addedUnknown ? { addedUnknown } : {}),
  };
}

// One row per crawl, oldest first; each after the first counts its changes from the one before. Unknown counts are
// null.
export const timeline = crawls =>
  crawls.map((r, i) => {
    const d = i && diffCrawls(crawls[i - 1], r);
    return {
      date: r.crawledAt,
      pages: (r.pages || []).length,
      findings: Array.isArray(r.findings) ? r.findings.length : null,
      ...(d && {
        regressions: d.regressions.length,
        improvements: d.improvements.length,
        added: d.addedUnknown ? null : d.added.length,
        removed: d.removedUnknown ? null : d.removed.length,
      }),
    };
  });

// One crawl per crawledAt, oldest first; an unreadable file is named and skipped. Holds every crawl in memory at
// once; for hundreds of history files, keep only the newest ones.
function filed(dir) {
  const byTime = new Map();
  for (const f of existsSync(dir)
    ? readdirSync(dir)
        .filter(f => f.endsWith("-seo-crawl.json"))
        .sort()
    : []) {
    let r = null;
    try {
      r = JSON.parse(readFileSync(join(dir, f), "utf8"));
    } catch {}
    if (typeof r?.crawledAt === "string") byTime.set(r.crawledAt, r);
    else console.error(`seo-diff: skipped ${f} in ${dir}: it isn't a readable crawl.`);
  }
  return [...byTime.values()].sort((a, b) => (a.crawledAt < b.crawledAt ? -1 : 1));
}

// Files a crawl in the history folder under its date, or its date and time when another crawl has that day; never over
// another crawl, and not again when a crawl with its crawledAt is there. Returns the path it wrote, or null.
export function fileCrawl(hist, file, crawl) {
  if (typeof crawl?.crawledAt !== "string" || filed(hist).some(r => r.crawledAt === crawl.crawledAt)) return null;
  const day = join(hist, `${crawl.crawledAt.slice(0, 10)}-seo-crawl.json`),
    at = join(hist, `${crawl.crawledAt.slice(0, 19).replace(/:/g, "-")}-seo-crawl.json`);
  mkdirSync(hist, { recursive: true });
  const to = existsSync(day) ? at : day;
  copyFileSync(file, to);
  return to;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2),
    val = k => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const files = args.filter((a, i) => !a.startsWith("--") && !["--out", "--history"].includes(args[i - 1]));
  const hist = val("--history"),
    out = resolve(val("--out") || "seo-audit/seo-diff.json");
  if (files.length !== (hist ? 1 : 2)) {
    console.error(
      "usage: node seo-diff.mjs old-crawl.json new-crawl.json [--out seo-audit/seo-diff.json]\n       node seo-diff.mjs --history seo-audit/history new-crawl.json [--out seo-audit/seo-diff.json] [--fail-on-regressions]",
    );
    process.exit(1);
  }
  const crawls = files.map(f => JSON.parse(readFileSync(f, "utf8"))),
    newR = crawls.at(-1);
  let oldR = crawls[0],
    rows = null;
  if (hist) {
    if (typeof newR.crawledAt !== "string") {
      console.error(`seo-diff: ${files[0]} has no crawledAt, so it isn't a crawl from seo-crawl.mjs.`);
      process.exit(1);
    }
    const past = filed(hist),
      earlier = past.filter(r => r.crawledAt < newR.crawledAt);
    fileCrawl(hist, files[0], newR);
    oldR = earlier.at(-1);
    rows = oldR && timeline([...earlier, newR]);
  }
  if (!oldR)
    console.log(
      `seo-diff: no earlier crawl in ${hist}, so nothing to compare. This crawl is filed there for the next run.`,
    );
  else {
    const diff = { since: oldR.crawledAt || null, ...diffCrawls(oldR, newR), ...(rows ? { timeline: rows } : {}) };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(diff, null, 2));
    console.log(
      `seo-diff: ${diff.regressions.length} regressions, ${diff.improvements.length} improvements, ${diff.added.length} pages added, ${diff.removed.length} gone · wrote ${out}`,
    );
    if (args.includes("--fail-on-regressions") && diff.regressions.length) process.exitCode = 1;
  }
}
