// @ts-check
// Probes run after the crawl: soft 404, llms.txt, Markdown negotiation, security.txt and security headers.
import { isLocal } from "../crawl/fetch.mjs";
import { pool } from "../crawl/queue.mjs";
import { tagsOf } from "../lib/html.mjs";

const noindexed = r => /\b(noindex|none)\b/i.test(r.headers?.get?.("x-robots-tag") || "") || tagsOf(r.body || "", "meta").some(m => /^(robots|googlebot)$/i.test(m.name || "") && /\b(noindex|none)\b/i.test(m.content || ""));

// Returns the start page's Markdown, or null, for site-hygiene.mjs markdownCheck. checkLive is --check-live, which
// reads HSTS on the live origin itself; pages (the crawl's records) give the top sections to probe.
export async function probeSite({ start: START, startOrigin: START_ORIGIN, expectOrigin: EXPECT_ORIGIN, checkLive: CHECK_LIVE, conc: CONC = 1, home, add, evalRules, notes, follow, get, pages = new Map() }) {
  evalRules("CRAWL-05", "URL-02", "TRUST-01", "TRUST-02");
  // A made-up URL at the root and in up to 10 top sections (local cap), largest first, since a dynamic route
  // (/blog/[slug]) can answer 200 for any slug. Once the root answers 200 the sections would only repeat it. A 200 with
  // noindex is low: Google accepts noindex on error pages where a real status is impractical.
  // https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
  const id = Date.now().toString(36), sections = new Map();
  for (const p of pages.values()) { const s = p.html && p.finalUrl && new URL(p.finalUrl).pathname.split("/").filter(Boolean); if (s?.length > 1) sections.set(s[0], (sections.get(s[0]) || 0) + 1); }
  for (const path of ["", ...[...sections].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s]) => `/${s}`)]) {
    const probe = await follow(`${START_ORIGIN}${path}/seo-supervisor-404-probe-${id}`);
    if (probe.status !== 200) continue;
    add(noindexed(probe) ? "soft-404-noindex" : "soft-404", probe.chain[0].url, probe.chain.length > 1 ? `redirected to ${probe.finalUrl} (200)` : "returned 200");
    if (!path) break;
  }
  // The Markdown request isn't followed, so only the crawled URL's own answer counts.
  const [llms, md, sectxt] = await pool([
    () => get(START_ORIGIN + "/llms.txt", { manual: false }),
    () => get(START.href, { accept: "text/markdown", text: /^text/markdown/i }),
    () => get(START_ORIGIN + "/.well-known/security.txt", { manual: false }),
  ], CONC, f => f());
  // A missing llms.txt is only low and never a ranking fix: Google says it neither harms nor helps rankings. An HTML
  // page there counts as missing.
  evalRules("MAP-07");
  if (llms.status !== 200 || /<html/i.test(llms.body || "")) add("llms-txt-missing", START_ORIGIN + "/llms.txt", llms.status === 200 ? "returns an HTML page instead" : `status ${llms.status}`);
  else {
    const problems = [!/^# \S/.test(llms.body.replace(/^\uFEFF/, "").trimStart()) && "no # heading first", !/\[[^\]]+\]\([^)\s]+\)/.test(llms.body) && "no Markdown links"].filter(Boolean);
    if (problems.length) add("llms-structure", START_ORIGIN + "/llms.txt", problems.join(", "));
  }
  // A Markdown response must vary on Accept so caches keep it apart from the HTML. AI-05 counts as checked only when
  // the site serves Markdown; otherwise the code-level check decides it. mdHome saves markdownCheck a second fetch.
  /** @type {string | null} */
  let mdHome = null;
  const isMd = /^text\/markdown/i.test(md.ct);
  if (isMd) evalRules("AI-05");
  const vary = (md.headers.get("vary") || "").toLowerCase().split(",").map(v => v.trim()); // Accept-Encoding isn't Accept
  if (isMd && !vary.includes("accept") && !vary.includes("*")) add("markdown-no-vary", START.href, `Vary: ${md.headers.get("vary") || "(none)"}`);
  if (md.status === 200 && isMd && !md.over) mdHome = md.body;
  if (sectxt.status !== 200 || /<html/i.test(sectxt.body || "")) add("security-txt", START_ORIGIN + "/.well-known/security.txt", sectxt.status === 200 ? "returns an HTML page instead (soft 404)" : `status ${sectxt.status}`);
  if (home && home.headers) {
    const h = home.headers, missing = [];
    if (!CHECK_LIVE && EXPECT_ORIGIN.startsWith("https") && START_ORIGIN.startsWith("https") && !h.get("strict-transport-security")) missing.push("Strict-Transport-Security");
    if (!h.get("x-content-type-options")) missing.push("X-Content-Type-Options");
    if (!h.get("referrer-policy")) missing.push("Referrer-Policy");
    // A Report-Only policy monitors without enforcing, so it doesn't count as a CSP.
    // https://www.w3.org/TR/CSP3/#cspro-header
    if (!h.get("content-security-policy")) missing.push(h.get("content-security-policy-report-only") ? "Content-Security-Policy (only a Report-Only policy, which blocks nothing)" : "Content-Security-Policy");
    if (!h.get("x-frame-options") && !/frame-ancestors/i.test(h.get("content-security-policy") || "")) missing.push("X-Frame-Options or CSP frame-ancestors");
    for (const m of missing) add("sec-headers", home.finalUrl, m);
    if (isLocal(START_ORIGIN)) notes.push("Security headers were read from a local server; production headers set by a CDN or proxy may differ.");
  }
  return mdHome;
}
