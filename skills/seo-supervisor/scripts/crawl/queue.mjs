// @ts-check
// The crawl queue. seo-crawl.mjs runs it twice: the start page first, then the sitemap's URLs and every link found.
import { FILE_EXT } from "../lib/html.mjs";
import { PAGE_MAX, clean, urlOr } from "./fetch.mjs";
import { agentRule, analyze, productImages } from "./page.mjs";
import { challengeHeaders } from "../checks/bots.mjs";

/** Runs fn over items, at most conc at once, so the checks' own requests keep to --concurrency. Results come back in
 * item order, so findings don't depend on which answer came first.
 * @template T, R
 * @param {T[]} items
 * @param {number} conc
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>} */
export async function pool(items, conc, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(conc, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * @param {{ start: URL, startOrigin: string, max: number, conc: number, includeQuery: boolean, inSection: (path: string) => boolean,
 *   fetcher: { follow: Function, xRobotsLines: Function }, page: any, toCrawl: (u: string) => string, notes: string[] }} o
 */
export function createCrawler({
  start: START,
  startOrigin: START_ORIGIN,
  max: MAX,
  conc: CONC,
  includeQuery: INCLUDE_QUERY,
  inSection,
  fetcher: { follow, xRobotsLines },
  page,
  toCrawl,
  notes,
}) {
  const pages = new Map(); // requested crawl URL -> record
  const queue = [];
  const seen = new Set(),
    challenges = []; // challenges: the URLs a bot challenge answered
  let fetched = 0,
    capped = false;
  function enqueue(u, from) {
    const c = clean(u, from);
    if (!c) return;
    const x = new URL(c);
    if (x.origin !== START_ORIGIN) return;
    if (FILE_EXT.test(x.pathname)) return;
    // Cloudflare serves its own endpoints under /cdn-cgi/ on every site it fronts; they aren't the site's pages.
    // https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/
    if (x.pathname.startsWith("/cdn-cgi/")) return;
    if (x.search && !INCLUDE_QUERY) return;
    if (!inSection(x.pathname) && c !== clean(START.href)) return; // the start page is always the way in
    if (seen.has(c)) return;
    seen.add(c);
    queue.push(c);
  }
  async function crawlOne(u) {
    const r = await follow(u);
    // A bot challenge isn't the page, so it stays out of the records and is never reported as broken; seo-crawl.mjs
    // notes it as not checked.
    if (challengeHeaders(r)) {
      challenges.push(r.finalUrl);
      return;
    }
    const rec = {
      url: u,
      status: r.status,
      finalUrl: r.finalUrl,
      chain: r.chain,
      error: r.error || null,
      headers: r.headers,
      ms: r.ms,
    };
    pages.set(u, rec);
    if (r.status === 200 && /html/.test(r.ct) && r.body) {
      // Only a crawler prefix makes the joined header ambiguous, so the lines are read apart only then.
      const xrt = r.headers.get("x-robots-tag");
      // A check that throws skips this page's checks with a note. The page answered 200, so it's never reported as a
      // server error or a broken link.
      let a;
      try {
        a = analyze(
          r.finalUrl,
          r.body,
          r.headers,
          xrt && xrt.toLowerCase().split(",").some(agentRule) ? await xRobotsLines(r.finalUrl) : null,
          page,
        );
      } catch (e) {
        notes.push(
          `A check couldn't read ${r.finalUrl} (${String(e.message).split("\n")[0].slice(0, 120)}), so that page's checks were skipped.`,
        );
        return;
      }
      Object.assign(rec, a, { html: true, productImages: productImages(r.body) });
      rec.links = [];
      rec.mainLinks = new Set(a.mainHrefs.map(h => clean(h, a.base)).filter(Boolean));
      for (const l of a.anchors) {
        if (!l.href || /^(mailto|tel|javascript|sms):/i.test(l.href)) continue;
        const c = clean(l.href, a.base);
        if (!c) continue;
        if (new URL(c).origin !== START_ORIGIN) continue;
        rec.links.push({ url: c, text: l.text });
        enqueue(c, r.finalUrl);
      }
      for (const b of a.crumbs) enqueue(toCrawl(b), r.finalUrl);
      for (const c of a.canonicals.slice(0, 1)) {
        const x = c && urlOr(c, a.base);
        if (x) enqueue(toCrawl(x.href), r.finalUrl);
      }
    } else if (r.over) {
      // seo-crawl.mjs still flags it as over Googlebot's 2 MB
      rec.over = true;
      notes.push(
        `${r.finalUrl} is over ${PAGE_MAX / 1048576} MB (once unpacked), our own limit for one page, so it wasn't read or checked.`,
      );
    }
  }
  async function runQueue() {
    await new Promise(done => {
      let active = 0;
      const pump = () => {
        while (active < CONC && queue.length && fetched < MAX) {
          const u = queue.shift();
          active++;
          fetched++;
          crawlOne(u)
            .catch(e => pages.set(u, { url: u, status: 0, error: String(e) }))
            .finally(() => {
              active--;
              pump();
            });
        }
        if (fetched >= MAX && queue.length) capped = true;
        if (active === 0 && (!queue.length || fetched >= MAX)) done();
      };
      pump();
    });
  }
  return {
    pages,
    queue,
    seen,
    challenges,
    enqueue,
    run: runQueue,
    get fetched() {
      return fetched;
    },
    get capped() {
      return capped;
    },
  };
}
