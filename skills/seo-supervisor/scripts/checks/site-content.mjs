// @ts-check
import { SHOP_FIELDS } from "../crawl/catalog.mjs";
import { norm } from "../lib/html.mjs";
import { identityDrift } from "./page.mjs";
import { brandTail, sectionOf, templatedDescs, templatedShare } from "./content.mjs";
import { quote } from "../lib/findings.mjs";

export function pageMarkup(site) {
  const { htmlPages, add, indexable } = site;
  for (const p of htmlPages) {
    if (p.clientOnly || !indexable(p)) continue;
    const u = p.finalUrl;
    if (p.unencoded.length)
      add("url-unencoded", u, `${p.unencoded.length} link(s), e.g. ${p.unencoded.slice(0, 3).join(", ")}`);
    if (p.wideImgs.length)
      add("img-no-srcset", u, `${p.wideImgs.length} image(s) over 1,000 px wide, e.g. ${p.wideImgs[0]}`);
    if (p.eagerLate.length)
      add("img-not-lazy", u, `${p.eagerLate.length} image(s) from the 11th on, e.g. ${p.eagerLate[0]}`);
    if (p.dupHead.length) add("duplicate-head-tags", u, p.dupHead.join(", "));
    if (p.numberHeadings.length) add("heading-only-number", u, p.numberHeadings.slice(0, 3).join("; "));
  }
}

// Titles under 20 characters ("Contact us") are skipped: a short title often starts a natural sentence.
export function descStartsWithTitle(site) {
  const { htmlPages, add, indexable } = site;
  for (const p of htmlPages) {
    if (!indexable(p) || !p.title || !p.description) continue;
    const flat = s => s.toLowerCase().replace(/\s+/g, " ").trim(),
      t = flat(p.title);
    if (t.length >= 20 && flat(p.description).startsWith(t.slice(0, Math.ceil(t.length * 0.8))))
      add("desc-starts-with-title", p.finalUrl, `“${p.description.slice(0, 80)}”`);
  }
}

// Findings from page.mjs's per-page checks. CONTENT-11 stays under NOT_CRAWLABLE.
export function pageSignals(site) {
  const { htmlPages, add, indexable, selfHosts, bareHost } = site;
  const read = htmlPages.filter(p => p.pageChecks && indexable(p) && !p.clientOnly);
  for (const { finalUrl: u, pageChecks: r } of read) {
    const away = r.ugc.filter(h => !selfHosts.has(bareHost(new URL(h).host)));
    if (away.length) add("ugc-link-followed", u, `${away.length} link(s), e.g. ${away[0]}`);
    if (r.backTrap) add("back-button-trap", u, r.backTrap);
    if (r.paywall) add("paywall-text-sent", u, `about ${r.paywall.words} words inside ${r.paywall.selector}`);
    if (r.late.length) add("head-tags-late", u, `in the body: ${r.late.join(", ")}`);
  }
  for (const [u, d] of identityDrift(read.map(p => ({ url: p.finalUrl, ...p.pageChecks.identity }))))
    add("site-identity-differs", u, d);
}

// One finding per check per page. An H1 shared by 3+ product pages counts as reused unless it names one of their
// products (a variant's "Wool coat" names "Wool coat, small").
export function shopChecks(site) {
  const { htmlPages, add, extra, indexable } = site;
  const shop = htmlPages.filter(p => p.shop && indexable(p)),
    byH1 = new Map();
  for (const p of shop) {
    const reported = new Set();
    for (const pr of p.shop)
      for (const x of pr.problems)
        if (!reported.has(x.check)) {
          reported.add(x.check);
          add(`product-${x.check}`, p.finalUrl, x.key ? `${pr.name}: ${x.key} “${x.value}”` : pr.name);
        }
    const h = p.headings.find(x => x.level === 1)?.text,
      k = h && norm(h);
    if (k) (byH1.get(k) || byH1.set(k, { h, pages: [] }).get(k)).pages.push(p);
  }
  for (const [k, { h, pages: ps }] of byH1)
    if (ps.length >= 3 && !ps.some(p => p.shop.some(pr => norm(pr.name).includes(k))))
      for (const p of ps) add("product-h1-reused", p.finalUrl, `“${h}” on ${ps.length} product pages`);
  const products = shop.flatMap(p => p.shop);
  if (products.length)
    extra.productFields = {
      products: products.length,
      ...Object.fromEntries(
        Object.keys(SHOP_FIELDS).map(f => [f, products.filter(pr => pr.fields.includes(f)).length]),
      ),
    };
}

// A description's main words are read as META-09 reads a title's, matched by stem or acronym. The 4-word minimum, a
// quarter on the page and the one-year guide age are local lines. titleWords, brandWords and acronyms come from
// checkPages.
export function contentChecks(site, { titleWords, brandWords, acronyms }) {
  const { htmlPages, add, extra, indexable } = site;
  const read = htmlPages.filter(p => indexable(p) && !p.clientOnly);
  for (const p of read) {
    const u = p.finalUrl;
    if (p.description) {
      const dw = titleWords(p.description).filter(w => !brandWords.has(w)),
        onPage = " " + p.normText;
      if (dw.length >= 4 && p.words >= 50) {
        const on = dw.filter(w => onPage.includes(" " + w.slice(0, Math.max(4, w.length - 3)))).length;
        if (on < dw.length / 4 && ![...acronyms(p.description)].some(a => p.caps.has(a)))
          add("desc-mismatch", u, `“${p.description.slice(0, 80)}”: ${on} of ${dw.length} main words are on the page`);
      }
      const tail = p.title && brandTail(p.title, p.description);
      if (tail) add("desc-brand-tail", u, `ends with “${tail}”, as the title does`);
    }
    if (p.guideDate && Date.now() - p.guideDate.time > 365 * 864e5)
      add("stale-guide", u, `newest date ${p.guideDate.date}, from ${p.guideDate.from}`);
  }
  const descs = read
    .filter(p => p.description)
    .map(p => ({ url: p.finalUrl, section: sectionOf(p.finalUrl), desc: p.description }));
  const hits = templatedDescs(descs);
  for (const [u, why] of hits) add("templated-desc", u, why);
  if (hits.length)
    extra.templatedDescriptions = templatedShare(
      descs,
      hits.map(h => h[0]),
    );
  const kw = read.filter(p => p.keywordUse).map(p => ({ url: p.finalUrl, ...p.keywordUse }));
  if (kw.length)
    extra.keywordUse = {
      counts: Object.fromEntries(
        ["natural", "missing", "repetitive", "forced"].map(v => [v, kw.filter(k => k.verdict === v).length]),
      ),
      pages: kw.filter(k => k.verdict !== "natural").slice(0, 50),
    };
}

// A service-area business whose schema gives a street address no page shows gets a note instead of the address
// finding. localBusiness comes from checkPages and judges on its first call.
export function localData(site, localBusiness) {
  const { notes, extra } = site;
  const lb = localBusiness();
  if (lb) extra.localBusiness = lb;
  if (lb?.streetHidden)
    notes.push(
      `The business schema gives the street address ${quote(lb.address?.streetAddress || lb.address?.text)}, but no page shows it, and the site says the business goes to its customers, so the address check skipped it. If customers don't come to that address, take it out of the schema too and keep the town, region and postcode (LOCAL-06). If they do, show it on the site (LOCAL-05).`,
    );
}
