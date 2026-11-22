// @ts-check
// The crawler's link checks and link data. site is the crawl's context (seo-crawl.mjs).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { TEMPORARY, isLocal, slashOnly, urlOr } from "../crawl/fetch.mjs";
import { FILE_EXT } from "../lib/html.mjs";
import { checkOutbound } from "./outbound.mjs";
import { hasName } from "./crawl.mjs";
import { pageRank, scale as strengthScale } from "./link-strength.mjs";
import { quote } from "../lib/findings.mjs";

// Returns inbound (final URL -> links to it, the pages list's linksIn) and sets each page's depth. A bad link's
// evidence, here and for other sites below, is the page holding it, the one to fix; the detail names the target. Each
// target is reported once, from the first page found linking to it.
export function checkLinks(site) {
  const { pages, htmlPages, byFinal, home, smSet, add, finalOf, isHome, indexable } = site;
  const inbound = new Map(),
    bodyInbound = new Map(),
    brokenSeen = new Set(),
    redirSeen = new Set();
  for (const p of htmlPages)
    for (const l of p.mainLinks || []) {
      const fin = finalOf(l);
      if (fin !== p.finalUrl) bodyInbound.set(fin, (bodyInbound.get(fin) || 0) + 1);
    }
  for (const p of htmlPages)
    for (const l of p.links) {
      const t = pages.get(l.url);
      const fin = finalOf(l.url);
      if (fin !== p.finalUrl) inbound.set(fin, (inbound.get(fin) || 0) + 1);
      if (!t) continue;
      if ((t.status >= 400 || t.status === 0) && !brokenSeen.has(l.url)) {
        brokenSeen.add(l.url);
        add("broken-internal-link", p.finalUrl, `links to ${l.url}: status ${t.status}`);
      } else if (t.chain && t.chain.length > 1 && !redirSeen.has(l.url)) {
        redirSeen.add(l.url);
        add("link-to-redirect", p.finalUrl, `links to ${l.url}, which redirects to ${t.finalUrl}`);
      }
    }
  for (const [u, e] of smSet) {
    const p = pages.get(u);
    if (!p || !p.html || isHome(p)) continue;
    if (!bodyInbound.get(p.finalUrl))
      add(
        "orphan",
        e.loc,
        inbound.get(p.finalUrl) ? `only nav/footer links (${inbound.get(p.finalUrl)})` : "no links at all",
      );
  }
  if (home && home.html) {
    const depth = new Map([[home.finalUrl, 0]]);
    const q = [home.finalUrl];
    while (q.length) {
      const cur = q.shift();
      const p = byFinal.get(cur);
      if (!p || !p.links) continue;
      for (const l of p.links) {
        const f = finalOf(l.url);
        if (!depth.has(f)) {
          depth.set(f, depth.get(cur) + 1);
          q.push(f);
        }
      }
    }
    for (const p of htmlPages) {
      const d = depth.get(p.finalUrl);
      if (d > 3 && indexable(p)) add("deep-page", p.finalUrl, `${d} clicks`);
      if (d === undefined) p.depth = null;
      else p.depth = d;
    }
  }
  return { inbound };
}

// SLASH is --trailing-slash (auto, always or never). Returns the style found or set.
export async function slashStyle(site, SLASH) {
  const { htmlPages, add, notes, startOrigin: START_ORIGIN, get, isHome } = site;
  const styled = htmlPages.filter(p => p.status === 200 && !isHome(p) && !FILE_EXT.test(new URL(p.finalUrl).pathname));
  const withS = styled.filter(p => new URL(p.finalUrl).pathname.endsWith("/")),
    withoutS = styled.filter(p => !new URL(p.finalUrl).pathname.endsWith("/"));
  let style = SLASH;
  if (SLASH === "auto") style = withS.length >= withoutS.length ? "always" : "never";
  const off = style === "always" ? withoutS : withS;
  if (SLASH !== "auto" || (withS.length && withoutS.length))
    for (const p of off)
      add(
        "trailing-slash-mixed",
        p.finalUrl,
        `expected ${style === "always" ? "a trailing slash" : "no trailing slash"}`,
      );
  const slashTemp = [];
  for (const p of styled.slice(0, 5)) {
    const x = new URL(p.finalUrl);
    x.pathname = x.pathname.endsWith("/") ? x.pathname.slice(0, -1) : x.pathname + "/";
    const r = await get(x.href);
    if (r.status === 200) add("slash-variant-no-redirect", x.href, `and ${p.finalUrl} both return 200`);
    else if (TEMPORARY.has(r.status) && urlOr(r.location || "", x.href)?.pathname === new URL(p.finalUrl).pathname)
      slashTemp.push([x.href, `${r.status} → ${p.finalUrl}`]);
  }
  // Dev servers often add the slash with a 302 (http-server does) where production doesn't, so locally it's a note.
  if (slashTemp.length && isLocal(START_ORIGIN))
    notes.push(
      `The local server adds or drops the trailing slash with a temporary redirect (${slashTemp[0][0]}: ${slashTemp[0][1]}). Development servers often do; check that production uses a 301 or 308.`,
    );
  else for (const [u, detail] of slashTemp) add("slash-redirect-temporary", u, detail);
  return style;
}

// Old URLs and redirect sources (URL-07), from --urls and --next-manifest, each tried with and without a trailing
// slash; their records join site.all. Returns the sources read.
export async function oldUrls(site, { urlList: URL_LIST, nextManifest: NEXT_MANIFEST }) {
  const { pages, all, add, evalRules, notes, startOrigin: START_ORIGIN, follow } = site;
  const redirectSources = [];
  if (URL_LIST) {
    try {
      const raw = readFileSync(URL_LIST, "utf8");
      let items;
      try {
        const j = JSON.parse(raw);
        items = Array.isArray(j)
          ? j.map(x => (typeof x === "string" ? x : x.source || x.url || x.from))
          : Object.keys(j);
      } catch {
        items = raw
          .split(/\r?\n/)
          .map(l => l.split(",")[0].trim().replace(/^"|"$/g, ""))
          .filter(l => l && !l.startsWith("#") && !/^(url|source|from)$/i.test(l));
      }
      redirectSources.push(...items.filter(Boolean));
    } catch (e) {
      notes.push("Could not read --urls: " + e.message);
    }
  }
  if (NEXT_MANIFEST) {
    try {
      const m = JSON.parse(readFileSync(NEXT_MANIFEST, "utf8"));
      for (const r of m.redirects || [])
        if (!r.internal && r.source && !/[:(*]/.test(r.source)) redirectSources.push(r.source);
    } catch (e) {
      notes.push("Could not read --next-manifest: " + e.message);
    }
  }
  if (redirectSources.length) {
    evalRules("URL-07");
    const seenR = new Set(),
      list = [];
    for (const src of redirectSources) {
      let x;
      try {
        x = new URL(src, START_ORIGIN);
      } catch {
        continue;
      }
      const p0 = x.pathname,
        alt = p0 === "/" ? p0 : p0.endsWith("/") ? p0.slice(0, -1) : p0 + "/";
      for (const path of [p0, alt]) {
        const full = START_ORIGIN + path + x.search;
        if (!seenR.has(full)) {
          seenR.add(full);
          list.push(full);
        }
      }
    }
    for (const u of list.slice(0, 2000)) {
      const r = await follow(u);
      // Kept with the crawl's records so the report lists it; links-import.mjs and seo-diff.mjs read it from there.
      if (!pages.has(u))
        all.push({ url: u, status: r.status, finalUrl: r.finalUrl, chain: r.chain, error: r.error || null });
      const trail = r.chain.map(c => c.status).join(" → ") + ` → ${r.finalUrl}`;
      if (r.status >= 400 || r.status === 0) add("redirect-broken", u, trail + (r.error ? ` (${r.error})` : ""));
      else {
        if (r.chain.length > 2) add("redirect-chain", u, trail);
        if (r.chain.some((c, i) => TEMPORARY.has(c.status) && !slashOnly(c.url, r.chain[i + 1]?.url ?? r.finalUrl)))
          add("old-url-temporary", u, trail);
      }
    }
    notes.push(`Tested ${Math.min(list.length, 2000)} old/redirect URLs, each with and without a trailing slash.`);
  }
  return redirectSources;
}

// Other sites are visited only with --outbound-links (OUTBOUND), since that contacts them.
export async function outboundLinks(site, OUTBOUND) {
  const { htmlPages, add, notes, notChecked, extra, selfHosts, bareHost } = site;
  const outbound = new Map(); // another site's URL -> the first page linking to it
  for (const p of htmlPages)
    for (const a of p.anchors) {
      const x = a.href && urlOr(a.href.trim(), p.base);
      if (!x || !/^https?:$/.test(x.protocol) || selfHosts.has(bareHost(x.host))) continue;
      x.hash = "";
      if (!outbound.has(x.href)) outbound.set(x.href, p.finalUrl);
    }
  if (OUTBOUND) {
    const r = await checkOutbound([...outbound.keys()], { limit: 100 });
    for (const b of r.broken) add("outbound-broken", outbound.get(b.url), `links to ${b.url}: status ${b.status}`);
    extra.outboundLinks = { checked: Math.min(outbound.size, 100), ...r };
    if (r.unreachable.length)
      notes.push(
        `${r.unreachable.length} link(s) to other sites couldn't be checked (the site turned the visit away, didn't answer, or isn't a public address), e.g. ${quote(r.unreachable[0].url)}: ${r.unreachable[0].reason}. They aren't counted as broken; outboundLinks in seo-crawl.json lists them.`,
      );
    if (outbound.size > 100) notes.push(`Links to other sites: the first 100 of ${outbound.size} were checked.`);
  } else if (outbound.size)
    notChecked.push({
      rule: "CRAWL-07",
      area: "CRAWL-07 Links to other sites",
      reason: `The pages link to ${outbound.size} address(es) on other sites, which weren't visited: that contacts other sites, so it needs the owner's own yes. With it, --outbound-links checks up to 100 of them, 4 at a time, for broken links.`,
    });
  return outbound;
}

// SECTION: a one-section crawl (--include or --exclude); capped: the crawl stopped at --max.
export function linkedOnce(site, { section: SECTION, capped }) {
  const { htmlPages, byPage, add, extra, finalOf, isHome, indexable } = site;
  // Indexable pages exactly one other page links to, the first 20 listed. A one-section crawl doesn't know the links
  // from pages it leaves out, so it's skipped there.
  if (!SECTION) {
    const from = new Map();
    for (const p of htmlPages)
      for (const l of p.links) {
        const f = finalOf(l.url);
        if (f !== p.finalUrl) (from.get(f) || from.set(f, new Set()).get(f)).add(p.finalUrl);
      }
    const once = htmlPages.filter(p => indexable(p) && !isHome(p) && from.get(p.finalUrl)?.size === 1);
    if (once.length)
      extra.linkedOnce = {
        count: once.length,
        pages: once.slice(0, 20).map(p => ({ url: p.finalUrl, from: [...from.get(p.finalUrl)][0] })),
        ...(capped ? { capped: true } : {}),
      };
  }
  // A page#name link whose target lacks that id or <a name>, once each. Pages built only in the browser get their ids
  // from JavaScript, so they aren't judged, nor are pages the crawl didn't read.
  const done = new Set();
  for (const p of htmlPages)
    for (const [to, name] of p.fragLinks || []) {
      const t = byPage.get(finalOf(to)),
        key = t && `${t.finalUrl}#${name}`;
      if (!t || t.clientOnly || done.has(key) || hasName(t.anchorIds, name)) continue;
      done.add(key);
      add("link-fragment-missing", p.finalUrl, `links to ${key}, but that page has no such part`);
    }
}

// Each indexable page's link strength, 0–100, over the link checks' graph; noindex pages pass links on too. Keyed by
// path rather than a column on `pages`: leaner, and the report matches it to Search Console's paths. Skipped on a
// one-section crawl, as linkedOnce is.
export function linkStrength(site, { section: SECTION, capped }) {
  const { htmlPages, extra, finalOf, indexable } = site;
  if (!SECTION) {
    const { rank, base } = pageRank(new Map(htmlPages.map(p => [p.finalUrl, p.links.map(l => finalOf(l.url))])));
    const s = [
      ...strengthScale(
        rank,
        base,
        htmlPages.filter(p => indexable(p)).map(p => p.finalUrl),
      ),
    ].sort((a, b) => b[1] - a[1]);
    if (s.length)
      extra.linkStrength = {
        pages: Object.fromEntries(
          s.map(([u, v]) => {
            const x = new URL(u);
            return [x.pathname + x.search, v];
          }),
        ),
        median: s[s.length >> 1][1],
        ...(capped ? { capped: true } : {}),
      };
  }
}

// Each indexable page's words and links (as indexes into the same list) for keyword-ideas.mjs. A file of its own, so
// seo-crawl.json doesn't grow: a few KB a page, some 10–25 MB for 5,000 pages. Both files carry the crawl's start
// time (t0), so keyword-ideas can tell a file left from another crawl. OUT is the crawl file.
export function pageWords(site, { out: OUT, stamp: t0 }) {
  const { htmlPages, extra, finalOf, indexable } = site;
  const kept = htmlPages.filter(p => indexable(p) && !p.clientOnly && typeof p.mainWordsText === "string"),
    at = new Map(kept.map((p, i) => [p.finalUrl, i]));
  const file = OUT.replace(/\.json$/i, "") + ".words.json",
    pathOf = u => {
      const x = new URL(u);
      return x.pathname + x.search;
    };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      tool: "seo-supervisor-crawler-words",
      stamp: t0,
      pages: kept.map(p => ({
        path: pathOf(p.finalUrl),
        words: p.mainWordsText,
        links: [...new Set(p.links.map(l => at.get(finalOf(l.url))).filter(i => i !== undefined))],
        ...(p.mainNoSpace ? { nospace: true } : {}),
      })),
    }),
  );
  extra.pageWords = { file: basename(file), stamp: t0, pages: kept.length };
}

// Links to other sites, counted from the pages already read with no requests. pages: distinct addresses per page;
// domains: distinct addresses per host (www left off), the 1,000 most linked, which links-import.mjs crosses with
// Search Console's Top linking sites.
export function otherSites(site, outbound) {
  const { htmlPages, extra, selfHosts, bareHost } = site;
  const perPage = {},
    domains = {};
  for (const p of htmlPages) {
    const here = new Set();
    for (const a of p.anchors) {
      const x = a.href && urlOr(a.href.trim(), p.base);
      if (!x || !/^https?:$/.test(x.protocol) || selfHosts.has(bareHost(x.host))) continue;
      x.hash = "";
      here.add(x.href);
    }
    perPage[p.finalUrl] = here.size;
  }
  for (const u of outbound.keys()) {
    const h = bareHost(new URL(u).hostname);
    domains[h] = (domains[h] || 0) + 1;
  }
  extra.linksToOtherSites = {
    pages: perPage,
    domains: Object.fromEntries(
      Object.entries(domains)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 1000),
    ),
  };
}
