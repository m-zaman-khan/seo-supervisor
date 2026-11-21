// @ts-check
// Internal link strength: how much of a site's own linking reaches each page.

/** Each page's share of the site's own links, by the 1998 PageRank paper's formula: base share (1 − d)/n, shares
 * summing to 1. It isn't Google's PageRank, which uses the whole web and has changed a lot since.
 * `out` maps every crawled page to the final URLs it links to; self-links, repeats and targets not in `out` (broken,
 * not HTML, past --max) are ignored, so strength is relative to the crawl. A page with no links to other crawled pages
 * spreads its share over every page. Stops when shares move less than 1e-10 in all, or after 200 rounds, a cap that
 * only guards against a bug since 0.85^200 is far below that.
 * Brin and Page, "The Anatomy of a Large-Scale Hypertextual Web Search Engine" (1998).
 * https://developers.google.com/search/docs/appearance/ranking-systems-guide
 * @param {Map<string, Iterable<string>>} out
 * @param {number} [d] damping, 0.85 as in the paper
 * @returns {{ rank: Map<string, number>, base: number }} `base` is the share of a page no other page links to */
export function pageRank(out, d = 0.85) {
  const ids = [...out.keys()],
    n = ids.length,
    at = new Map(ids.map((u, i) => [u, i]));
  if (!n) return { rank: new Map(), base: 0 };
  const links = ids.map((u, i) =>
    [...new Set([...(out.get(u) || [])].map(t => at.get(t)))].filter(j => j !== undefined && j !== i),
  );
  let pr = new Float64Array(n).fill(1 / n),
    base = 1 / n;
  for (let round = 0; round < 200; round++) {
    let spread = 0;
    for (let i = 0; i < n; i++) if (!links[i].length) spread += pr[i];
    base = (1 - d + d * spread) / n;
    const next = new Float64Array(n).fill(base);
    for (let i = 0; i < n; i++)
      if (links[i].length) {
        const s = (d * pr[i]) / links[i].length;
        for (const j of links[i]) next[j] += s;
      }
    let moved = 0;
    for (let i = 0; i < n; i++) moved += Math.abs(next[i] - pr[i]);
    pr = next;
    if (moved < 1e-10) break;
  }
  return { rank: new Map(ids.map((u, i) => [u, pr[i]])), base };
}

/** 0–100 for the pages in `keep`: 0 is the base share (no inbound links), 100 the strongest page kept. Logarithmic,
 * since the home and menu pages hold most of the share and a linear scale squeezes the rest into 0–5; here doubling
 * a share adds the same points anywhere. With no links at all, every page is 0.
 * @param {Map<string, number>} rank
 * @param {number} base
 * @param {string[]} [keep]
 * @returns {Map<string, number>} */
export function scale(rank, base, keep = [...rank.keys()]) {
  const top = keep.reduce((m, u) => Math.max(m, rank.get(u) ?? 0), 0),
    span = Math.log(top / base);
  return new Map(
    keep.map(u => [
      u,
      span > 1e-9 ? Math.min(100, Math.max(0, Math.round((100 * Math.log((rank.get(u) ?? base) / base)) / span))) : 0,
    ]),
  );
}
