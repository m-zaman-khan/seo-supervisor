#!/usr/bin/env node
// Reports what changed between two crawls. Pages are matched by path, so a local crawl compares with the public site.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const pathOf = u => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const ok = s => s === 200;

export function diffCrawls(oldReport, newReport) {
  // Working pages plus the crawl's error records, so a page that now fails is a status change, not "gone".
  const index = r => new Map([...(r.pages || []), ...(r.errors || [])].map(p => [pathOf(p.url), p]));
  const before = index(oldReport),
    after = index(newReport);
  const regressions = [],
    improvements = [],
    changed = [];
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
  }
  return {
    regressions,
    improvements,
    changed,
    added: [...after.keys()].filter(p => !before.has(p)).sort(),
    removed: [...before.keys()].filter(p => !after.has(p)).sort(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
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
