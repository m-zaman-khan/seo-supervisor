// @ts-check
// Per-page checks over every crawled HTML page, plus the site-wide ones that need the same pass.
import { allowedBy } from "./robots.mjs";
import { checkHreflang } from "./hreflang.mjs";
import { titleWidth, widthText } from "./content.mjs";
import { judgeLocal } from "./local.mjs";
import { KEPT, RULES } from "../crawl/catalog.mjs";
import { clean, urlOr } from "../crawl/fetch.mjs";
import { NOSPACE, capsOf, norm } from "../lib/html.mjs";

export function checkPages(site) {
  const {
    all,
    pages,
    htmlPages,
    home,
    smSet,
    robots,
    star,
    add,
    evalRules,
    evaluated,
    notes,
    notChecked,
    ignoreNoindex: IGNORE_NOINDEX,
    brand: BRAND,
    startOrigin: START_ORIGIN,
    expectOrigin: EXPECT_ORIGIN,
    toCrawl,
    isHome,
    canonicalFor,
    samePath,
    indexable,
    bareHost,
  } = site;
  for (const p of all) {
    if (p.status >= 500 || p.status === 0) add("server-error", p.url, p.error || `status ${p.status}`);
    if (p.chain && p.chain.length > 2)
      add("redirect-chain", p.url, p.chain.map(c => `${c.status}`).join(" → ") + ` → ${p.finalUrl}`);
    const x = new URL(p.url);
    if (/[A-Z]/.test(x.pathname) || /_/.test(x.pathname) || /%20| /.test(x.pathname) || /\/\//.test(x.pathname))
      add("url-format", p.url);
  }
  for (const [u, e] of smSet) {
    const p = pages.get(u);
    if (!p) continue;
    if (p.status !== 200 || p.chain.length > 1)
      add("sitemap-bad-status", e.loc, p.chain.length > 1 ? `redirects to ${p.finalUrl}` : `status ${p.status}`);
    else if (p.html && p.noindex && !IGNORE_NOINDEX) add("noindex-in-sitemap", e.loc);
    if (robots && star && !allowedBy(star, new URL(u).pathname)) add("sitemap-url-disallowed", e.loc);
  }
  const titleMap = new Map(),
    descMap = new Map(),
    faqMap = new Map();
  let checkedPages = 0;
  const images = new Map(); // same-origin image URL -> first indexable page using it
  const shareImages = new Map(); // og:image on the crawled site (crawl URL) -> { src, page }
  const noindexShare = htmlPages.length ? htmlPages.filter(p => p.noindex).length / htmlPages.length : 0;
  if (IGNORE_NOINDEX)
    notes.push(
      "Ran with --ignore-noindex: noindex pages were checked as if indexable (pre-launch audit). Noindex findings were not raised.",
    );
  else if (noindexShare > 0.5)
    notes.push(
      `${Math.round(noindexShare * 100)}% of pages are noindex. If the site is pre-launch, re-run with --ignore-noindex; per-page checks skipped those pages.`,
    );
  // A basic missing on most pages is a site-wide blocker (the usual no-SEO site), reported once instead of per page.
  const sitewide = (() => {
    const idx = htmlPages.filter(
      p => indexable(p) && !(p.words < 30 && p.h1Count === 0 && (p.emptyRoot || p.scripts > 0)),
    );
    const titles = new Map();
    for (const p of idx) if (p.title) titles.set(p.title, (titles.get(p.title) || 0) + 1);
    const [topTitle, topCount] = [...titles].sort((a, b) => b[1] - a[1])[0] || [];
    const defaultTitle = topCount >= 0.8 * idx.length ? topTitle : undefined;
    const hits = test => {
      const s = new Set(idx.filter(test));
      return s.size >= 3 && s.size >= 0.8 * idx.length ? s : new Set();
    };
    // A framework's starter title marks a site with no SEO work at any size, even a one-page site.
    const STARTER =
      /^(create next app|create react app|react app|vite \+ (react|vue|svelte|preact|lit|solid|ts)( \+ ts)?|vite app|nuxt( app)?|sveltekit( app)?|remix app|astro|welcome to (next\.js|remix|astro|nuxt)!?|gatsby (default )?starter|my gatsby site|angular ?app|document|untitled( document)?)$/i;
    const starter = new Set(idx.filter(p => !p.title || STARTER.test(p.title.trim())));
    const starterSitewide =
      idx.some(p => p.title && STARTER.test(p.title.trim())) && starter.size >= 0.8 * idx.length ? starter : null;
    return {
      title: starterSitewide || hits(p => !p.title || p.title === defaultTitle),
      h1: hits(p => p.h1Count === 0),
      canonical: hits(p => !p.canonicals.length),
    };
  })();
  const ownHosts = new Set(
    EXPECT_ORIGIN.startsWith("https:")
      ? [EXPECT_ORIGIN, START_ORIGIN].filter(o => o.startsWith("https:")).map(o => bareHost(new URL(o).hostname))
      : [],
  );
  // Title words worth looking for: 4+ letters, not a stopword, not a brand word (one in most titles). Words in scripts
  // written without spaces (Chinese, Japanese, Thai) can't be matched word by word, so they're left out.
  const STOP = new Set(
    "about after also been before best does each free from have here home into just like many more most much near official online only over page site some such than that them then there these they this those very website welcome were what when where which while will with your".split(
      " ",
    ),
  );
  const titleWords = t => [
    ...new Set(
      norm(t)
        .split(" ")
        .filter(w => /^\p{L}{4,}$/u.test(w) && !NOSPACE.test(w) && !STOP.has(w)),
    ),
  ];
  const brandWords = (() => {
    // every word, so a short one ("UK" in "Acme UK") is brand too
    const sets = htmlPages.filter(p => p.title && indexable(p)).map(p => new Set(norm(p.title).split(" "))),
      n = new Map();
    for (const s of sets) for (const w of s) n.set(w, (n.get(w) || 0) + 1);
    return new Set([...[...n].filter(([, c]) => c > sets.length / 2).map(([w]) => w), ...norm(BRAND).split(" ")]);
  })();
  // A title's capitalised words ("LPG") and the initials of 3+ words in a row, skipping and/of/the ("Heating,
  // Ventilation and Air Conditioning" is hvac). Two letters ("IP") would match too much by chance.
  const LINKING = new Set("a an and for in of on the to".split(" "));
  const acronyms = t => {
    const w = norm(t)
        .split(" ")
        .filter(x => x && !LINKING.has(x) && !brandWords.has(x)),
      out = new Set([...capsOf(t)].filter(x => !brandWords.has(x)));
    for (let i = 0; i < w.length; i++)
      for (let j = i + 3; j <= w.length; j++)
        out.add(
          w
            .slice(i, j)
            .map(x => x[0])
            .join(""),
        );
    return out;
  };
  // "12 High Street" and "12 High St." both become "12 high st", and "Hauptstraße 5" becomes "hauptstr 5".
  const STREET_WORDS = {
    street: "st",
    road: "rd",
    avenue: "ave",
    suite: "ste",
    apartment: "apt",
    boulevard: "blvd",
    drive: "dr",
    lane: "ln",
  };
  const streetForm = s =>
    norm(s)
      .replace(/stra(?:ß|ss)e\b/g, "str")
      .replace(/\b(?:street|road|avenue|suite|apartment|boulevard|drive|lane)\b/g, w => STREET_WORDS[w]);
  // A phone matches on its last 7 digits in any grouping ("+44 113 496 0000" is shown by "(0113) 496-0000"). An address
  // matches part by part, units included, so "12 High Road Suite 4" is shown by "Ste. 4, 12 High Rd".
  const shows = (p, f) => {
    if (f.kind === "phone")
      return new RegExp(f.value.replace(/\D/g, "").slice(-7).split("").join(" ?") + "(?!\\d)").test(p.normText);
    const text = ` ${streetForm(p.normText)} `;
    return f.value
      .split(",")
      .flatMap(s => streetForm(s).split(/ (?=(?:ste|apt|unit|flat) )/))
      .filter(Boolean)
      .every(part => text.includes(` ${part} `));
  };
  // Judged once, from every page, when the address check or the site-wide block first asks.
  let localJudged;
  const localBusiness = () => (localJudged === undefined ? (localJudged = judgeLocal(htmlPages, shows)) : localJudged);
  for (const p of htmlPages) {
    const u = p.finalUrl;
    if (!IGNORE_NOINDEX) {
      if (isHome(p) && p.noindex) add("home-noindex", u);
      else if (p.noindex && !smSet.has(p.url)) add("noindex-review", u);
    }
    if (p.banned) add("banned-claim", u, `“${p.banned.match}” in: ${p.banned.snippet}`);
    if (p.unconfirmed) add("unconfirmed-claim", u, `“${p.unconfirmed.match}” in: ${p.unconfirmed.snippet}`);
    if (p.words < 30 && p.h1Count === 0 && (p.emptyRoot || p.scripts > 0)) {
      add("client-rendered", u, `${p.words} words in server HTML`);
      p.clientOnly = true;
      continue;
    }
    const says = rs =>
      rs.includes("noindex") ? "noindex" : rs.some(r => r === "index" || r === "all") ? "index" : null;
    if (says(p.metaRules) && says(p.headerRules) && says(p.metaRules) !== says(p.headerRules))
      add("robots-conflict", u, `meta: “${p.robotsMeta}” · header: “${p.xRobots}”`);
    if (p.noindex && !IGNORE_NOINDEX) {
      // Another page is another host or path; a trailing slash alone doesn't make one.
      const c = canonicalFor(p),
        to = c && urlOr(toCrawl(c)),
        at = new URL(u),
        bare = x => x.pathname.replace(/\/$/, "");
      if (to && (to.origin !== at.origin || bare(to) !== bare(at))) add("noindex-canonical", u, `→ ${c}`);
      continue;
    }
    if (sitewide.canonical.has(p)) add("canonical-missing-sitewide", u);
    else if (!p.canonicals.length) add("canonical-missing", u);
    else {
      if (p.canonicals.length > 1) add("canonical-multiple", u, p.canonicals.join(" | "));
      const c = urlOr(p.canonicals[0], p.base);
      if (!c) add("canonical-bad-target", u, `not a valid URL: ${p.canonicals[0]}`);
      else {
        if (c.search) add("canonical-query", u, c.href);
        if (c.origin !== EXPECT_ORIGIN) add("canonical-origin", u, c.href);
        if (!samePath(toCrawl(c.href), u)) add("canonical-not-self", u, `→ ${c.href}`);
        const t = pages.get(clean(toCrawl(c.href)));
        if (t && (t.status !== 200 || (t.chain && t.chain.length > 1)))
          add("canonical-bad-target", u, `${c.href} → ${t.chain && t.chain.length > 1 ? "redirect" : t.status}`);
      }
    }
    if (!indexable(p)) continue;
    checkedPages++;
    for (const q of p.faqQs) {
      const k = norm(q);
      if (k) (faqMap.get(k) || faqMap.set(k, { q, pages: [] }).get(k)).pages.push(u);
    }
    if (p.titleCount > 1) add("title-multiple", u, `${p.titleCount} <title> tags`);
    if (p.placeholder) add("placeholder-text", u, `“${p.placeholder}”`);
    if (p.hashLinks) add("href-hash", u, `${p.hashLinks} link(s)`);
    if (!p.lang) add("lang-missing", u);
    if (sitewide.title.has(p)) add("title-missing-sitewide", u, p.title ? `“${p.title}”` : undefined);
    else if (!p.title) add("title-missing", u);
    else {
      if (titleWidth(p.title) > 60)
        add("title-long", u, `${widthText(p.title)}: ${p.title}`); // CJK characters count as two
      else if (titleWidth(p.title) < 20) add("title-short", u, p.title);
      (titleMap.get(p.title) || titleMap.set(p.title, []).get(p.title)).push(u);
      if (BRAND && p.title.split(BRAND).length > 2) add("title-brand-twice", u, p.title);
    }
    // Errs towards not flagging: a word counts when its stem is on the page ("pricing" finds "prices"), an acronym when
    // the page shows it in capitals, and the H1 counts as page text.
    const tw = p.title ? titleWords(p.title).filter(w => !brandWords.has(w)) : [];
    if (tw.length >= 2 && p.words >= 50) {
      evalRules("META-09");
      const onPage = " " + p.normText;
      if (
        !tw.some(w => onPage.includes(" " + w.slice(0, Math.max(4, w.length - 3)))) &&
        ![...acronyms(p.title)].some(a => p.caps.has(a))
      )
        add("title-mismatch", u, `“${p.title}”: ${tw.join(", ")} aren't on the page`);
    }
    if (!p.description) add("desc-missing", u);
    else {
      if (p.description.length < 120 || p.description.length > 160)
        add("desc-length", u, `${p.description.length} chars`);
      (descMap.get(p.description) || descMap.set(p.description, []).get(p.description)).push(u);
    }
    // og:description is optional (https://ogp.me), but X falls back only to it and LinkedIn requires it. None says
    // whether the meta description stands in, so it's listed only when that's missing too, and only beside a missing
    // og:title or og:image: alone it's desc-missing's.
    const noOg = [!p.ogTitle && "og:title", !p.ogImage && "og:image"].filter(Boolean);
    if (noOg.length)
      add(
        "og-missing",
        u,
        [...noOg, !p.ogDescription && !p.description && "og:description"].filter(Boolean).join(", "),
      );
    // Without twitter:card, X shows at most the small summary card. A page with no share image gets og-missing instead.
    // From X's cards markup guide, archived 30 May 2025; X has since taken its card docs down.
    const card = p.twitterCard?.trim().toLowerCase();
    if (card && !["summary", "summary_large_image", "app", "player"].includes(card))
      add("twitter-card-invalid", u, `“${p.twitterCard}”`);
    if (p.ogImage) {
      if (!card) add("twitter-card-missing", u);
      if (!p.ogImageSized) add("og-image-no-size", u);
      const src = urlOr(p.ogImage, p.base),
        c = src && clean(toCrawl(src.href));
      if (c && new URL(c).origin === START_ORIGIN && !shareImages.has(c))
        shareImages.set(c, { src: src.href, page: u });
    }
    if (sitewide.h1.has(p)) add("h1-missing-sitewide", u);
    else if (p.h1Count !== 1) add("h1-count", u, `${p.h1Count} H1s`);
    const skips = [];
    let prev = null;
    for (const h of p.headings) {
      if (prev !== null && h.level > prev + 1) skips.push(`H${prev} → H${h.level} (“${h.text.slice(0, 40)}”)`);
      prev = h.level;
    }
    if (skips.length) add("heading-skip", u, skips.slice(0, 3).join("; "));
    if (p.words < 150 && !(p.words < 30 && p.h1Count === 0)) add("thin-page", u, `${p.words} words`);
    const noAlt = p.imgs.filter(i => !("alt" in i)).length;
    if (noAlt) add("img-alt", u, `${noAlt} image(s)`);
    const noDim = p.imgs.filter(
      i => !(i.width && i.height) && i["data-nimg"] !== "fill" && !/position:\s*absolute/i.test(i.style || ""),
    ).length;
    if (noDim) add("img-dimensions", u, `${noDim} image(s)`);
    if (p.imgs[0] && ((p.imgs[0].loading || "").toLowerCase() === "lazy" || p.firstScriptLazy))
      add("lazy-lcp", u, p.imgs[0].src || "");
    // Counts stylesheets, not sizes: one or two are normal, six or more usually means plugin CSS loaded everywhere.
    const blocking = [
      p.blockingJs.length && `${p.blockingJs.length} script(s) without async or defer, e.g. ${p.blockingJs[0]}`,
      p.blockingCss >= 6 && `${p.blockingCss} stylesheets`,
    ].filter(Boolean);
    if (blocking.length) add("render-blocking", u, blocking.join("; "));
    if (p.bytes > 2 * 1024 * 1024) add("html-over-2mb", u, `${Math.round(p.bytes / 1024)} KB`);
    else if (p.bytes > 500 * 1024) add("html-size", u, `${Math.round(p.bytes / 1024)} KB`);
    if (p.elements > 1400) add("dom-size", u, `${p.elements.toLocaleString("en")} elements`);
    if (p.nosnippet) add("nosnippet", u);
    if (p.nofollow && !p.noindex)
      add(
        "page-nofollow",
        u,
        [p.robotsMeta && `meta: “${p.robotsMeta}”`, p.xRobots && `header: “${p.xRobots}”`].filter(Boolean).join(" · "),
      );
    const basics = [!p.doctype && "no doctype", !p.charset && "no charset", !p.viewport && "no mobile viewport"].filter(
      Boolean,
    );
    if (basics.length) add("doc-basics", u, basics.join(", "));
    if (p.charsetMismatch) add("charset-mismatch", u, p.charsetMismatch);
    if (p.refreshTo) add("meta-refresh", u, `→ ${p.refreshTo}`);
    evalRules("REND-10"); // only once a page was checked; PERF-10 waits for Chrome's own test
    if (p.obsolete.length) add("obsolete-tags", u, p.obsolete.map(t => `<${t}>`).join(", "));
    if (p.noStore) add("bfcache-no-store", u, `Cache-Control: ${p.headers.get("cache-control")}`);
    if (p.unload) add("bfcache-unload", u, p.unload);
    if (p.ogUrl && p.canonicals.length) {
      const og = urlOr(p.ogUrl, p.base)?.href,
        c = urlOr(p.canonicals[0], p.base)?.href;
      if (c && og !== c)
        add("og-url-mismatch", u, og ? `og:url ${og} · canonical ${c}` : `og:url isn't a valid URL: ${p.ogUrl}`);
    }
    const prod = test => p.products.find(test);
    let pr;
    if ((pr = prod(x => x.singleAggregate))) add("product-aggregate-offer", u, pr.name);
    if ((pr = prod(x => x.noShipping)))
      add("product-no-shipping", u, `${pr.name}: ${pr.noShipping} of ${pr.offers} offer(s)`);
    if ((pr = prod(x => x.noReturns)))
      add("product-no-returns", u, `${pr.name}: ${pr.noReturns} of ${pr.offers} offer(s)`);
    if (
      p.amounts.length &&
      (pr = prod(x => x.prices.length && !x.prices.some(v => p.amounts.some(a => Math.abs(a - v) < 0.005))))
    )
      add(
        "product-price-mismatch",
        u,
        `schema ${pr.prices.join(" / ")} · page shows ${p.amounts.slice(0, 3).join(", ")}`,
      );
    if (!p.largePreview) add("no-large-preview", u);
    for (const i of p.imgs) {
      try {
        const src = new URL(i.src, p.base);
        if (src.origin === new URL(u).origin && !images.has(src.href)) images.set(src.href, u);
      } catch {}
    }
    if (p.jsonldErrors.length) add("jsonld-invalid", u, p.jsonldErrors[0]);
    const allTypes = [...p.types, ...p.schemaOther]; // Google reads Microdata and RDFa too; only JSON-LD is validated here
    if (!allTypes.length) add("jsonld-none", u);
    else if (!p.types.length) add("schema-not-jsonld", u, p.schemaOther.join(", "));
    if (!isHome(p) && !allTypes.includes("BreadcrumbList")) add("breadcrumb-missing", u);
    if (p.deprecated.length) add("deprecated-schema", u, p.deprecated.join(", "));
    if (p.hasRating) add("rating-review", u);
    if (p.nap.length) evalRules("LOCAL-05");
    // A service-area business may hide its street address (LOCAL-06), so it isn't asked to show it.
    const napGone = p.nap.filter(
      f =>
        ![p, home?.html && home].some(r => r && shows(r, f)) &&
        !(f.kind === "street address" && localBusiness()?.kind === "service-area"),
    );
    if (napGone.length)
      add(
        "nap-not-shown",
        u,
        `${napGone.map(f => `${f.kind} “${f.value}”`).join(" and ")} ${napGone.length > 1 ? "aren't" : "isn't"} shown on this page or the home page`,
      );
    const missingQ = p.faqQs.filter(q => !p.normText.includes(norm(q)));
    if (missingQ.length)
      add("faq-not-visible", u, `${missingQ.length} of ${p.faqQs.length}: “${missingQ[0].slice(0, 60)}”`);
    if (p.links.length > 150) add("too-many-links", u, `${p.links.length} links`);
    const generic = p.links.filter(l =>
      /^(click here|here|read more|learn more|more|this|link|details)$/i.test(l.text.trim()),
    ).length;
    if (generic) add("generic-anchor", u, `${generic} link(s)`);
    if (p.emptyLinks.length) add("link-no-text", u, `${p.emptyLinks.length} link(s), e.g. ${p.emptyLinks[0]}`);
    const insecure = p.anchors
      .map(l => l.href)
      .filter(h => /^http:\/\//i.test(h || "") && ownHosts.has(bareHost(urlOr(h)?.hostname || "")));
    if (insecure.length) add("link-http", u, `${insecure.length} link(s), e.g. ${insecure[0]}`);
    if (smSet.size && !smSet.has(p.url) && !smSet.has(u)) add("missing-from-sitemap", u);
    for (const b of p.crumbs.slice(0, -1)) {
      const t = pages.get(clean(toCrawl(b)));
      if (t && t.status !== 200) add("breadcrumb-dead-level", u, `${b} → ${t.status}`);
    }
  }
  // A retired type worth keeping gets one note for the site, not a finding.
  for (const r of KEPT) {
    const at = htmlPages.filter(p => p.kept.includes(r.type));
    if (at.length)
      notes.push(
        `${r.type} on ${at.length} page(s), e.g. ${at[0].finalUrl}: Google retired ${r.feature} in ${r.since.slice(0, 4)}, but keep it: ${r.note}.`,
      );
  }
  // Near-duplicate main content: 5-word shingles with Dice similarity over 0.6. Every pair is compared, so 400 pages at
  // most; a set under 0.4 of the other's size can't reach 0.6, so that pair is skipped.
  {
    const cand = htmlPages.filter(p => p.shingles && !p.clientOnly && indexable(p)).slice(0, 400);
    for (let i = 0; i < cand.length; i++)
      for (let j = i + 1; j < cand.length; j++) {
        const a = cand[i].shingles,
          b = cand[j].shingles;
        const [small, big] = a.size < b.size ? [a, b] : [b, a];
        if (small.size / big.size < 0.4) continue;
        let inter = 0;
        for (const x of small) if (big.has(x)) inter++;
        const dice = (2 * inter) / (a.size + b.size);
        if (dice > 0.6)
          add("near-duplicate", cand[i].finalUrl, `${Math.round(dice * 100)}% shared with ${cand[j].finalUrl}`);
      }
    if (htmlPages.filter(p => p.shingles).length > 400)
      notes.push("Near-duplicate check compared the first 400 indexable pages only.");
  }
  for (const { q, pages: ps } of faqMap.values())
    if (ps.length > 1) add("faq-reused", ps[0], `“${q.slice(0, 70)}” on ${ps.length} pages`);
  const PER_PAGE_RULES = [
    "AI-01",
    "REND-08",
    "URL-04",
    "META-01",
    "META-02",
    "META-04",
    "META-05",
    "CONTENT-01",
    "CONTENT-02",
    "CONTENT-04",
    "CONTENT-05",
    "CONTENT-08",
    "CONTENT-09",
    "REND-04",
    "SCHEMA-01",
    "SCHEMA-03",
    "SCHEMA-04",
    "SCHEMA-05",
    "SCHEMA-07",
    "MAP-03",
    "LINK-05",
    "LINK-06",
    "PERF-03",
    "PERF-04",
    "PERF-06",
    "REND-09",
    "MEDIA-03",
    "PERF-08",
  ];
  if (checkedPages === 0)
    for (const r of PER_PAGE_RULES)
      if (evaluated.delete(r))
        notChecked.push({
          rule: r,
          area: `${r} ${RULES[r][0]}`,
          reason:
            "No indexable pages were checked (all noindex, non-canonical or failed). For a pre-launch site, re-run with --ignore-noindex.",
        });
  for (const [t, us] of titleMap) if (us.length > 1) for (const u of us) add("title-dup", u, t);
  for (const [d, us] of descMap) if (us.length > 1) for (const u of us) add("desc-dup", u, d.slice(0, 80));
  if (htmlPages.some(p => p.products?.length)) evalRules("SHOP-05");
  evalRules("META-08");
  checkHreflang(htmlPages, {
    add,
    canonicalFor,
    statusOf: href => pages.get(clean(toCrawl(href)))?.status,
    origin: EXPECT_ORIGIN,
  });
  return { checkedPages, images, shareImages, titleWords, brandWords, acronyms, localBusiness };
}
