// @ts-check
// Probes run after the crawl: soft 404, llms.txt, Markdown negotiation, security.txt and security headers.
import { isLocal } from "../crawl/fetch.mjs";

// Returns the start page's Markdown, or null, for site-hygiene.mjs markdownCheck. checkLive is --check-live, which
// reads HSTS on the live origin itself; pages (the crawl's records) give the top sections to probe.
export async function probeSite({
  start: START,
  startOrigin: START_ORIGIN,
  expectOrigin: EXPECT_ORIGIN,
  checkLive: CHECK_LIVE,
  ua: UA,
  home,
  add,
  evalRules,
  notes,
  follow,
  get,
}) {
  evalRules("CRAWL-05", "URL-02", "TRUST-01", "TRUST-02");
  const probe = await follow(`${START_ORIGIN}/seo-supervisor-404-probe-${Date.now().toString(36)}`);
  if (probe.status === 200)
    add(
      "soft-404",
      probe.chain[0].url,
      probe.chain.length > 1 ? `redirected to ${probe.finalUrl} (200)` : "returned 200",
    );
  // A missing llms.txt is only low and never a ranking fix: Google says it neither harms nor helps rankings. An HTML
  // page there counts as missing.
  evalRules("MAP-07");
  const llms = await get(START_ORIGIN + "/llms.txt", { manual: false });
  if (llms.status !== 200 || /<html/i.test(llms.body || ""))
    add(
      "llms-txt-missing",
      START_ORIGIN + "/llms.txt",
      llms.status === 200 ? "returns an HTML page instead" : `status ${llms.status}`,
    );
  else {
    const problems = [
      !/^# \S/.test(llms.body.replace(/^\uFEFF/, "").trimStart()) && "no # heading first",
      !/\[[^\]]+\]\([^)\s]+\)/.test(llms.body) && "no Markdown links",
    ].filter(Boolean);
    if (problems.length) add("llms-structure", START_ORIGIN + "/llms.txt", problems.join(", "));
  }
  // A Markdown response must vary on Accept so caches keep it apart from the HTML. AI-05 counts as checked only when
  // the site serves Markdown; otherwise the code-level check decides it. mdHome saves markdownCheck a second fetch.
  /** @type {string | null} */
  let mdHome = null;
  try {
    // redirect: manual keeps the probe on the crawled URL; only its own answer matters.
    const md = await fetch(START.href, {
      redirect: "manual",
      headers: { "user-agent": UA, accept: "text/markdown" },
      signal: AbortSignal.timeout(15000),
    });
    if (/^text\/markdown/i.test(md.headers.get("content-type") || "")) evalRules("AI-05");
    const vary = (md.headers.get("vary") || "")
      .toLowerCase()
      .split(",")
      .map(v => v.trim()); // Accept-Encoding isn't Accept
    if (
      /^text\/markdown/i.test(md.headers.get("content-type") || "") &&
      !vary.includes("accept") &&
      !vary.includes("*")
    )
      add("markdown-no-vary", START.href, `Vary: ${md.headers.get("vary") || "(none)"}`);
    if (md.status === 200 && /^text\/markdown/i.test(md.headers.get("content-type") || "")) mdHome = await md.text();
    else await md.body?.cancel();
  } catch {}
  const sectxt = await get(START_ORIGIN + "/.well-known/security.txt", { manual: false });
  if (sectxt.status !== 200 || /<html/i.test(sectxt.body || ""))
    add(
      "security-txt",
      START_ORIGIN + "/.well-known/security.txt",
      sectxt.status === 200 ? "returns an HTML page instead (soft 404)" : `status ${sectxt.status}`,
    );
  if (home && home.headers) {
    const h = home.headers,
      missing = [];
    if (
      !CHECK_LIVE &&
      EXPECT_ORIGIN.startsWith("https") &&
      START_ORIGIN.startsWith("https") &&
      !h.get("strict-transport-security")
    )
      missing.push("Strict-Transport-Security");
    if (!h.get("x-content-type-options")) missing.push("X-Content-Type-Options");
    if (!h.get("referrer-policy")) missing.push("Referrer-Policy");
    // A Report-Only policy monitors without enforcing, so it doesn't count as a CSP.
    // https://www.w3.org/TR/CSP3/#cspro-header
    if (!h.get("content-security-policy"))
      missing.push(
        h.get("content-security-policy-report-only")
          ? "Content-Security-Policy (only a Report-Only policy, which blocks nothing)"
          : "Content-Security-Policy",
      );
    if (!h.get("x-frame-options") && !/frame-ancestors/i.test(h.get("content-security-policy") || ""))
      missing.push("X-Frame-Options or CSP frame-ancestors");
    for (const m of missing) add("sec-headers", home.finalUrl, m);
    if (isLocal(START_ORIGIN))
      notes.push(
        "Security headers were read from a local server; production headers set by a CDN or proxy may differ.",
      );
  }
  return mdHome;
}
