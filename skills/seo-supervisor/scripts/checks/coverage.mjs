// @ts-check
// Crawl coverage: parameter copies, soft 404s, malformed URLs, sections, site size and Search Console's indexed count.
import { readFileSync } from "node:fs";
import { CHECKS, RULES } from "../crawl/catalog.mjs";
import { urlOr } from "../crawl/fetch.mjs";
import { parseCsv } from "../lib/csv.mjs";

// include and exclude are --include and --exclude; sm is the sitemaps read; gscIndexing is --gsc-indexing's file.
export function checkCoverage(
  site,
  { section: SECTION, include: INCLUDE, exclude: EXCLUDE, crawler, sm, gscIndexing },
) {
  const {
    htmlPages,
    smSet,
    add,
    evalRules,
    evaluated,
    findings,
    notes,
    notChecked,
    extra,
    startOrigin: START_ORIGIN,
    indexable,
    canonicalFor,
  } = site;
  const { seen, fetched, capped } = crawler;
  // A parameter page whose clean URL was also crawled, with no canonical dropping the parameters, is an indexable copy.
  // Tracking and paging parameters are skipped: Google wants paginated pages to stay indexable.
  // https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading
  {
    const TRACKING = /^(utm_\w+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|yclid|igshid|mc_cid|mc_eid|_gl|_ga)$/i,
      PAGING = /^(page|p|pg|paged|offset|start)$/i;
    // A copy is the same page: same title as the page without the parameters. A different title is a different page
    // (WordPress's /?page_id=2), and a page that lists itself in its own hreflang is a language version (WPML's ?lang=fr).
    const titleKey = t =>
      String(t || "")
        .trim()
        .toLowerCase();
    const cleanTitles = new Map(
      htmlPages.filter(p => !new URL(p.finalUrl).search).map(p => [new URL(p.finalUrl).pathname, titleKey(p.title)]),
    );
    const listsItself = p =>
      (p.hreflang || []).some(h => {
        try {
          return new URL(h.href, p.finalUrl).href === p.finalUrl;
        } catch {
          return false;
        }
      });
    for (const p of htmlPages) {
      const x = new URL(p.finalUrl),
        keys = [...new Set(x.searchParams.keys())].filter(k => !TRACKING.test(k) && !PAGING.test(k));
      if (!keys.length || p.clientOnly || !indexable(p) || !cleanTitles.has(x.pathname)) continue;
      if (cleanTitles.get(x.pathname) !== titleKey(p.title) || listsItself(p)) continue;
      evalRules("CRAWL-10");
      const c = canonicalFor(p);
      if (!c || urlOr(c)?.search)
        add(
          "parameter-page-indexable",
          p.finalUrl,
          `parameters ${keys.join(", ")}; ${c ? `canonical ${c}` : "no canonical"}`,
        );
    }
  }
  for (const p of htmlPages)
    if (!p.clientOnly && p.badUrls?.length)
      add("url-malformed", p.finalUrl, `${p.badUrls.length} address(es): ${p.badUrls.slice(0, 5).join(", ")}`);
  // One section: links from the pages left out aren't known, so depth and orphans can't be judged.
  if (SECTION) {
    extra.section = { include: INCLUDE, exclude: EXCLUDE };
    notes.push(
      `Crawled one part of the site: ${[INCLUDE.length && `paths starting with ${INCLUDE.join(" or ")}`, EXCLUDE.length && `leaving out ${EXCLUDE.join(" and ")}`].filter(Boolean).join(", ")}, plus the start page. robots.txt and the sitemap files were still read whole.`,
    );
    for (const rule of ["LINK-01", "LINK-02"]) {
      for (const k of [...findings.keys()]) if (CHECKS[k][0] === rule) findings.delete(k);
      evaluated.delete(rule);
      notChecked.push({
        rule,
        area: `${rule} ${RULES[rule][0]}`,
        reason:
          "Only part of the site was crawled (--include or --exclude), so links from the pages left out aren't known. Crawl the whole site to check this.",
      });
    }
  }
  // A folder with pages below it (/blog/ for /blog/a/) is a section; every other page counts under "/".
  {
    const parts = p => new URL(p.finalUrl).pathname.split("/").filter(Boolean);
    const folders = new Set(
        htmlPages
          .map(parts)
          .filter(s => s.length > 1)
          .map(s => s[0]),
      ),
      count = new Map();
    for (const p of htmlPages) {
      const s = parts(p)[0],
        key = folders.has(s) ? `/${s}/` : "/";
      count.set(key, (count.get(key) || 0) + 1);
    }
    extra.sections = [...count]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 50)
      .map(([path, pages]) => ({ path, pages, share: Math.round((1000 * pages) / htmlPages.length) / 1000 }));
  }
  // Every URL the crawl knew of, from links and sitemaps, is a floor for the site's size.
  if (capped) {
    const listed = [...smSet.keys()].filter(u => new URL(u).origin === START_ORIGIN).length,
      n = x => x.toLocaleString("en-US");
    extra.siteSize = { crawled: fetched, known: seen.size, sitemapUrls: listed };
    notes.push(
      `The crawl stopped at ${n(fetched)} pages (--max). It knew of ${n(seen.size)} URLs on the site from links and sitemaps (the sitemaps list ${n(listed)}${sm.cut ? ", and more past the part read" : ""}), so the site has at least ${n(Math.max(seen.size, listed))} URLs.`,
    );
  }
  // The Page indexing export's Chart.csv is undocumented, so columns are found by the English export's names (Date
  // first, Indexed, Not indexed). A file without them gets a note, not a guess.
  if (typeof gscIndexing === "string") {
    const file = gscIndexing;
    let rows = [];
    try {
      rows = parseCsv(readFileSync(file, "utf8"));
    } catch (e) {
      notes.push(`--gsc-indexing: couldn't read ${file} (${e.message}).`);
    }
    const keys = Object.keys(rows[0] || {}),
      on = keys.find(k => /^indexed$/i.test(k)),
      off = keys.find(k => /^not indexed$/i.test(k)),
      count = s => Number(String(s ?? "").replace(/\D/g, ""));
    const last =
      on && off
        ? rows
            .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r[keys[0]]))
            .sort((a, b) => (a[keys[0]] < b[keys[0]] ? -1 : 1))
            .at(-1)
        : null;
    if (last) {
      extra.indexing = {
        date: last[keys[0]],
        indexed: count(last[on]),
        notIndexed: count(last[off]),
        crawlIndexable: htmlPages.filter(p => indexable(p)).length,
        capped,
      };
      const i = extra.indexing,
        n = x => x.toLocaleString("en-US");
      notes.push(
        `Search Console counted ${n(i.indexed)} indexed pages (and ${n(i.notIndexed)} not indexed) on ${i.date}; this crawl found ${n(i.crawlIndexable)} pages meant to be indexed${capped ? " before it stopped at --max" : ""}. Google counts every URL it knows, old and parameter URLs too, so the two rarely match exactly; a big gap either way is worth a look in the Page indexing report.`,
      );
    } else if (keys.length)
      notes.push(
        `--gsc-indexing: ${file} has no dated rows with Indexed and Not indexed columns. It takes the chart table (Chart.csv) of Search Console's Page indexing export, in English, so Google's indexed count wasn't compared.`,
      );
  }
}
