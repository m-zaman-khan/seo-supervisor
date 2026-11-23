// @ts-check
// The Links tab's panels: backlinks, outbound links, internal link ideas and link strength.
import { fmtDate, notePath, num, obj, plural, isCount, isText } from "../format.mjs";
import { byPath } from "../traffic.mjs";

const linkCount = p => plural(Number(p.count) || 0, "link");

export function linkPanels({ raw }) {
  const bing = obj(raw.bing),
    traffic = obj(raw.traffic);
  // Bing's pages with links from other sites; linked also feeds the Bing search line.
  const linked = Array.isArray(bing?.backlinks?.pages) ? bing.backlinks.pages.filter(obj) : [];
  const topLinked = [...linked].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0)).slice(0, 10);
  const linkSample = (Array.isArray(bing?.backlinks?.sample) ? bing.backlinks.sample.filter(obj) : []).slice(0, 5);
  const bingLinks = topLinked.length || linkSample.length;
  // backlinks.mjs: whether known links from other sites are still there. Third-party URLs, escaped where shown.
  const linkCheck = obj(raw.backlinks),
    checkedLinks = Number(linkCheck?.checked) || 0;
  const goneLinks = Array.isArray(linkCheck?.gone) ? linkCheck.gone.filter(obj) : [];
  const linkCheckLine = checkedLinks
    ? `${num(Number(linkCheck.live) || 0)} of ${num(checkedLinks)} known ${checkedLinks === 1 ? "link is" : "links are"} still there; ${num(goneLinks.length)} gone; ${num(Array.isArray(linkCheck.unreachable) ? linkCheck.unreachable.filter(obj).length : 0)} couldn't be checked`
    : "";
  // Search Console's exports, the backlink check and Bing's lists share one collapsed panel. Domains, URLs and counts
  // come from other sites, so they're escaped where shown.
  const scLinks = obj(raw.links),
    scRows = (k, f) =>
      Array.isArray(scLinks?.[k]) ? scLinks[k].filter(x => obj(x) && typeof x[f] === "string" && x[f]) : [];
  const scSites = scRows("sites", "domain"),
    scPages = scRows("pages", "url");
  const scMix = (m =>
    m && ["brand", "address", "generic", "other"].every(k => Number.isFinite(m[k]) && m[k] >= 0 && m[k] <= 1)
      ? m
      : null)(obj(raw.anchorMix));
  const hasSc = !!(scSites.length || scPages.length || scMix),
    linkSources = [hasSc && "Search Console", bingLinks && "Bing"].filter(Boolean).join(" and ");
  // Search Console's tables export at most 1,000 rows, so 1,000 may be more.
  // https://support.google.com/webmasters/answer/9049606
  const scUpTo = n => (n >= 1000 ? "1,000 or more" : num(n));
  const scLine = () => {
    const parts = [
      scSites.length && `${scUpTo(scSites.length)} site${scSites.length === 1 ? " links" : "s link"} to you`,
      scPages.length && `${scUpTo(scPages.length)} of your pages ${scPages.length === 1 ? "has" : "have"} links`,
    ].filter(Boolean);
    return parts.length
      ? `Search Console${Date.parse(scLinks.when) ? ` (export of ${fmtDate(scLinks.when)})` : ""}: ${parts.join(" · ")}`
      : "";
  };
  const scPct = x => `${Math.round(x * 100)}%`;
  const scMixLine = () =>
    `Link text: your brand ${scPct(scMix.brand)} · web address ${scPct(scMix.address)} · generic, like “click here”, ${scPct(scMix.generic)} · other ${scPct(scMix.other)}.`;
  const scInfoLine = () =>
    `${scMix ? "A natural mix is mostly your brand, your web address and words that say what the page is about. " : ""}Information only: it doesn't change the score.`;
  const scCount = x => (Number.isFinite(x.links) ? plural(x.links, "link") : "");
  const scList = (list, f) => ({ rows: list.slice(0, 5).map(x => [{ code: x[f] }, scCount(x)]) });
  // worthALook (links-import.mjs): standout links, each with why and what to look at.
  const looks = (Array.isArray(raw.worthALook) ? raw.worthALook : [])
    .filter(x => obj(x) && ["subject", "why", "look"].every(k => typeof x[k] === "string" && x[k]))
    .slice(0, 10);
  const lookEx = x => (Array.isArray(x.examples) ? x.examples.filter(e => typeof e === "string" && e).slice(0, 5) : []);
  const LOOK_INTRO = "Worth a look: links that stand out. It isn't a score or a finding, and most turn out to be fine.";
  // Other sites' addresses as code, their text escaped. "Bing's" in a label is written into the page as it is.
  const label = s => ({ p: { html: s, md: s } });
  const links = () =>
    (hasSc || bingLinks || linkCheckLine || looks.length) && {
      cls: "links",
      title: `Links from other sites${linkSources ? ` (${linkSources})` : ""}`,
      blocks: [
        scLine() && { p: scLine() },
        scSites.length && { p: "The sites with the most links to you:" },
        scSites.length && scList(scSites, "domain"),
        scPages.length && { p: "Your most-linked pages in Search Console:" },
        scPages.length && scList(scPages, "url"),
        scMix && { p: scMixLine() },
        hasSc && { p: scInfoLine() },
        looks.length && { p: LOOK_INTRO },
        {
          bold: true,
          rows: looks.map(x => [
            x.subject,
            [
              x.why,
              " ",
              x.look,
              lookEx(x).length ? [" For example: ", lookEx(x).map((e, i) => [i ? ", " : "", { code: e }])] : "",
            ],
            ": ",
          ]),
        },
        linkCheckLine && { p: linkCheckLine },
        linkCheckLine && { rows: goneLinks.slice(0, 10).map(g => [{ code: g.url }, g.reason ?? ""]) },
        topLinked.length && {
          p: hasSc ? "Your most-linked pages in Bing:" : "The pages with the most links from other sites:",
        },
        { rows: topLinked.map(p => [{ code: p.url }, linkCount(p)]) },
        linkSample.length &&
          label(hasSc ? "Some of Bing's links to the home page:" : "Some of the links to the home page:"),
        { rows: linkSample.map(s => [{ code: s.url }, s.anchorText || ""]) },
      ],
    };

  // More about links, in one collapsed panel. Names, addresses and link text come from other sites, so each is escaped
  // (code spans in the Markdown).
  const listOf = (x, ok) => (Array.isArray(x) ? x.filter(ok) : []);
  const isDay = x => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x));
  const newSites = (n =>
    n && isCount(n.count) && n.count > 0
      ? { ...n, sites: listOf(n.sites, s => obj(s) && isText(s.domain)).slice(0, 5) }
      : null)(obj(raw.newLinks));
  const noNewLinks = (n => (n && isDay(n.newest) && isDay(n.asOf) ? n : null))(obj(raw.noNewLinks));
  const unlinked = (u =>
    u && isCount(u.count) && u.count > 0 && isCount(u.of) && u.of >= u.count
      ? { ...u, urls: listOf(u.urls, isText).slice(0, 5) }
      : null)(obj(raw.unlinkedPages));
  const nofollowSites = listOf(linkCheck?.nofollowSites, s => obj(s) && isText(s.site) && isCount(s.pages)).slice(
    0,
    10,
  );
  const foundLinks = listOf(linkCheck?.found, f => obj(f) && isText(f.url) && Array.isArray(f.links))
    .flatMap(f =>
      listOf(f.links, l => obj(l) && isText(l.href))
        .slice(0, 1)
        .map(l => ({ url: f.url, ...l })),
    )
    .slice(0, 10);
  const commonCrawl = (c =>
    c && isText(obj(c.crawl)?.name)
      ? {
          name: c.crawl.name,
          site: obj(c.site) && isCount(c.site.captures) ? c.site : null,
          pages: listOf(c.linkingPages, p => obj(p) && isText(p.url) && isText(p.state)),
          sites: listOf(c.linkingSites, isText),
        }
      : null)(obj(raw.commonCrawl));
  // commoncrawl.mjs --rank: the domain's place in Common Crawl's web graph by harmonic centrality, or how far down it
  // isn't.
  const ccRank = (r =>
    r &&
    isText(r.domain) &&
    isText(r.release) &&
    isCount(r.domains) &&
    (r.found === true ? isCount(r.harmonicPos) : r.found === false && isCount(r.scanned))
      ? r
      : null)(obj(obj(raw.commonCrawl)?.rank));
  const outLinks = (o =>
    o && obj(o.pages) && Object.keys(o.pages).length
      ? {
          pages: Object.values(o.pages).filter(isCount),
          domains: Object.entries(obj(o.domains) || {}).filter(([k, v]) => isText(k) && isCount(v)),
        }
      : null)(obj(raw.linksToOtherSites));
  const bingSample = Array.isArray(bing?.backlinks?.sample) ? bing.backlinks.sample.filter(obj).length : 0;
  const moreLinkLines = () => {
    const L = []; // [text, list of [name, detail]]
    if (newSites)
      L.push([
        `${plural(newSites.count, "new site")} ${newSites.count === 1 ? "links" : "link"} to you since the last export${Date.parse(newSites.since) ? ` (${fmtDate(newSites.since)})` : ""}, from Search Console's Top linking sites.${newSites.capped === true ? " Some may be older links: an export holds 1,000 sites at most, so they may have been past the cut before." : ""}`,
        newSites.sites.map(s => [s.domain, isCount(s.links) ? plural(s.links, "link") : ""]),
      ]);
    if (noNewLinks)
      L.push([
        `No new links for 3 months or more: no link in Search Console's Latest links export was found after ${fmtDate(noNewLinks.newest)} (export of ${fmtDate(noNewLinks.asOf)}). New links usually come from new things worth linking to, like original data, a free tool, a guide or real news (LINK-10).`,
        [],
      ]);
    if (unlinked)
      L.push([
        `${num(unlinked.count)} of your ${num(unlinked.of)} crawled pages have no links from other sites in Search Console's list. That's normal for most pages. For the ones that matter most, link to them from your pages that other sites do link to.`,
        unlinked.urls.map(u => [notePath(u), ""]),
      ]);
    if (nofollowSites.length)
      L.push([
        "Sites whose links to you are all nofollow, sponsored or ugc, in the backlink check. Such links are allowed; Google says links marked this way “will generally not be followed”.",
        nofollowSites.map(s => [s.site, plural(s.pages, "page")]),
      ]);
    if (foundLinks.length)
      L.push([
        "Links the backlink check found, with the page each points at and its text:",
        foundLinks.map(f => [
          f.url,
          `→ ${f.href}${isText(f.text) ? ` “${f.text}”` : ""}${isText(f.rel) ? ` (${f.rel})` : ""}`,
        ]),
      ]);
    if (commonCrawl) {
      const s = commonCrawl.site,
        linked = commonCrawl.pages.filter(p => p.state === "links").length,
        absent = commonCrawl.pages.filter(p => p.state === "not-in-crawl").length;
      if (s)
        L.push([
          s.captures
            ? `Common Crawl (${commonCrawl.name}) holds ${s.capped === true ? "1,000 or more" : num(s.captures)} saved copies of your site's pages${s.home === true ? ", the home page among them" : ", but not the home page"}.`
            : `Common Crawl (${commonCrawl.name}) holds none of your site's pages. If robots.txt blocks CCBot, its crawler, that's why.`,
          [],
        ]);
      if (commonCrawl.pages.length)
        L.push([
          `${num(linked)} of ${num(commonCrawl.pages.length)} known linking pages link to you in Common Crawl's saved copies${absent ? `; ${num(absent)} ${absent === 1 ? "isn't" : "aren't"} in its newest crawl` : ""}. commoncrawl.mjs --rank adds your domain's rank in its web graph.`,
          commonCrawl.sites.slice(0, 5).map(h => [h, ""]),
        ]);
    }
    if (ccRank)
      L.push([
        `Common Crawl's web graph (${ccRank.release}): ${ccRank.found ? `${ccRank.domain} is #${num(ccRank.harmonicPos)} of ${num(ccRank.domains)} domains by how well linked it is (harmonic centrality)${isCount(ccRank.pageRankPos) ? `, #${num(ccRank.pageRankPos)} by PageRank` : ""}` : `${ccRank.domain} isn't in the top ${num(ccRank.scanned)} of ${num(ccRank.domains)} domains${ccRank.capped ? " (the read stopped there)" : ""}`}. Common Crawl's own number, not Google's, and information only.`,
        [],
      ]);
    // How much of the link profile the free sources cover.
    // https://support.google.com/webmasters/answer/9049606
    const cover = [
      hasSc &&
        `Google says Search Console's Links report “isn't a comprehensive list of every link on your site”, and each of its tables stops at 1,000 rows${scSites.length >= 1000 ? " (Top linking sites reached it)" : ""}.`,
      bingSample && `Bing's links here are a sample of ${plural(bingSample, "link")} to your home page.`,
      checkedLinks && `The backlink check opened ${plural(checkedLinks, "known linking page")} (100 at most).`,
      commonCrawl && "Common Crawl holds only the pages its monthly crawl reached.",
    ].filter(Boolean);
    if (cover.length)
      L.push([`How much this covers: ${cover.join(" ")} Treat the numbers as a sample, not a full count.`, []]);
    return L;
  };
  const MORE_LINKS_INTRO = "Information only: none of this changes the score.";
  const moreLinks = () => {
    const L = moreLinkLines();
    return (
      L.length && {
        cls: "morelinks",
        title: "More about links",
        blocks: [
          { p: MORE_LINKS_INTRO },
          ...L.flatMap(([t, list]) => [{ p: t }, { rows: list.map(([k, v]) => [{ code: k }, v]) }]),
        ],
      }
    );
  };
  // The site's own outbound links get their own card, apart from the links in; domains escaped.
  const outLinksPanel = () => {
    if (!outLinks) return null;
    const n = outLinks.pages.filter(c => c > 0).length,
      top = [...outLinks.domains].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const all = outLinks.domains.length,
      shown = all > top.length ? `; the top ${top.length} are below` : "";
    return {
      cls: "outlinks",
      title: "Links to other sites",
      blocks: [
        {
          p: `${num(n)} of your ${num(outLinks.pages.length)} crawled pages ${n === 1 ? "links" : "link"} to other sites, ${plural(all, "site")} in all${shown}. Pages that make claims should link to their sources (CONTENT-10). ${MORE_LINKS_INTRO}`,
        },
        { rows: top.map(([d, c]) => [{ code: d }, plural(c, "address", "addresses")]) },
      ],
    };
  };

  // linkIdeas and queryGaps (keyword-ideas.mjs), copied into the audit as they are. Searches and paths are escaped. Up
  // to 10 of each on the page, all of them (50 at most) in the Markdown.
  const ideaRows = (key, list) =>
    (Array.isArray(raw[key]) ? raw[key] : []).filter(
      i =>
        obj(i) &&
        typeof i.page === "string" &&
        typeof i.query === "string" &&
        Number.isFinite(i.impressions) &&
        Array.isArray(i[list]) &&
        i[list].length &&
        i[list].every(s => typeof s === "string"),
    );
  // Google uses links for relevance and to find pages; the query-gap idea is from Chen and Koudas, a preprint.
  // https://developers.google.com/search/docs/crawling-indexing/links-crawlable
  // https://arxiv.org/abs/2610.15033
  const ideaPanel = (cls, title, intro, rows) =>
    rows.length && {
      cls,
      title,
      blocks: [
        { p: intro },
        { rows, cap: 10 },
        rows.length > 10 && {
          page: [`${num(rows.length - 10)} more in `, { code: "seo-audit/keyword-ideas.md" }, "."],
        },
      ],
    };
  const linkIdeas = () =>
    ideaPanel(
      "linkideas",
      "Internal link ideas",
      "Pages that mention a search another page shows for in Google, but don't link to that page. A link from them, in a sentence about the search, helps people and Google find the page that answers it. From Search Console and the crawl. Information only: none of this changes the score.",
      ideaRows("linkIdeas", "from").map(i => [
        { code: i.page },
        [
          `gets ${plural(i.impressions, "impression")} for “${i.query}”. Pages that mention it but don't link to it: `,
          i.from.map((p, n) => [n ? ", " : "", { code: p }]),
        ],
      ]),
    );
  const queryGaps = () =>
    ideaPanel(
      "querygaps",
      "Searches a page doesn't mention",
      "Searches a page shows for in Google whose words its title, H1 and main text don't use. A page can't answer a search well if it never mentions it, and a 2026 study of AI answers (Chen and Koudas, a preprint, not yet peer reviewed) found that pages whose title and paragraphs match the questions people ask get cited more. Add the words only where they fit the page. Information only: none of this changes the score.",
      ideaRows("queryGaps", "missing").map(i => [
        { code: i.page },
        `shows for “${i.query}” (${plural(i.impressions, "impression")}), but doesn't use: ${i.missing.join(", ")}.`,
      ]),
    );
  // Indexable pages with exactly one internal link in: the first 20, capped when the crawl stopped at --max. Paths are
  // escaped.
  const linkedOnce = (o =>
    o && isCount(o.count) && Array.isArray(o.pages)
      ? {
          ...o,
          pages: o.pages.filter(p => obj(p) && typeof p.url === "string" && typeof p.from === "string").slice(0, 20),
        }
      : null)(obj(raw.linkedOnce));
  const linkedOnceIntro = () =>
    `${plural(linkedOnce.count, "page")} that can be indexed ${linkedOnce.count === 1 ? "has" : "have"} only one other page linking to ${linkedOnce.count === 1 ? "it" : "them"}${linkedOnce.count > linkedOnce.pages.length ? `; the first ${num(linkedOnce.pages.length)} are below` : ""}. A page linked from one place is easy to miss: visitors find it only if they open that one page, and crawlers, which find pages by following links, have a single way in, so the page is cut off if that link goes. A link from a hub or a related page helps both.${linkedOnce.capped === true ? " The crawl stopped at --max, so links on pages it didn't read aren't counted." : ""} Information only: it doesn't change the score.`;
  const linkedOncePanel = () =>
    linkedOnce?.pages.length && {
      cls: "linkedonce",
      title: "Pages with one incoming link",
      blocks: [
        { p: linkedOnceIntro() },
        {
          rows: linkedOnce.pages.map(p => [
            { code: notePath(p.url) },
            ["linked only from ", { code: notePath(p.from) }],
          ]),
        },
      ],
    };
  // linkStrength is a local measure, 0–100: PageRank over the site's own links (sources in checks/link-strength.mjs).
  // With Search Console traffic it also lists, of the 20 crawled pages with the most clicks, those in the bottom third
  // of strength, a local rule. Paths are escaped.
  const n0 = x => Number(x) || 0;
  const strength = (s => {
    const pages =
      s && obj(s.pages)
        ? Object.entries(s.pages)
            .filter(([, v]) => Number.isInteger(v) && v >= 0 && v <= 100)
            .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        : [];
    if (!pages.length) return null;
    const asc = pages.map(([, v]) => v).reverse(),
      cut = asc[Math.ceil(asc.length / 3) - 1],
      top = pages[0][1];
    const weak = traffic
      ? pages
          .map(([u, v]) => ({ u, v, t: byPath(traffic, u) }))
          .filter(x => x.t && (n0(x.t.clicks) || n0(x.t.impressions)))
          .sort((a, b) => n0(b.t.clicks) - n0(a.t.clicks) || n0(b.t.impressions) - n0(a.t.impressions))
          .slice(0, 20)
          .filter(x => x.v <= cut && x.v < top)
      : [];
    return { pages, median: isCount(s.median) ? s.median : null, capped: s.capped === true, weak };
  })(obj(raw.linkStrength));
  const LS_LABEL =
    "This is our own measure, computed with the PageRank formula (Brin and Page, 1998) on this site's own links. It's not Google's PageRank, which uses links from the whole web and isn't public.";
  const strengthIntro = () =>
    `How much of the site's own linking reaches each page, from 0 to 100. ${LS_LABEL} A page gets more when more pages link to it, and more again when those pages are strong. 100 is the site's strongest page, and 0 means no more than a page nothing links to. The scale is logarithmic: the home page and a few others usually hold most of the strength, and on a straight scale nearly every other page would read close to 0. Here, twice the share of links is always the same number of extra points. It's relative to the ${plural(strength.pages.length, "page")} this crawl read that can be indexed${strength.median != null ? `; half of them have a strength of ${strength.median} or less` : ""}.${strength.capped ? " The crawl stopped at --max, so links on pages it didn't read aren't counted." : ""} Information only: it doesn't change the score.`;
  const weakIntro = () =>
    `Found in search, but little link strength: of the 20 crawled pages with the most Search Console clicks, then impressions${raw.trafficPeriod ? ` (${String(raw.trafficPeriod).toLowerCase()})` : ""}, these are in the bottom third of the site's strength (our own rule). People already find them in search, so they're worth more links from your own pages. Link to them from the strongest pages above, in a sentence about what they cover, and see Internal link ideas for pages that already mention their searches.`;
  const weakTail = x =>
    `strength ${x.v} · Search Console: ${num(n0(x.t.clicks))} clicks · ${num(n0(x.t.impressions))} impressions`;
  const linkStrength = () =>
    strength && {
      cls: "linkstrength",
      title: "Internal link strength",
      blocks: [
        { p: strengthIntro() },
        { rows: strength.pages.slice(0, 10).map(([u, v]) => [{ code: u }, `strength ${v}`]) },
        strength.weak.length && { p: weakIntro() },
        { rows: strength.weak.map(x => [{ code: x.u }, weakTail(x)]) },
      ],
    };
  return {
    linked,
    links,
    moreLinks,
    outLinks: outLinksPanel,
    linkIdeas,
    queryGaps,
    linkedOnce: linkedOncePanel,
    linkStrength,
  };
}
