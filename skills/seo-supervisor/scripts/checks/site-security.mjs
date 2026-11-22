// @ts-check
import { cookieProblems, cspProblems, hstsRead, serverHoles } from "./technical.mjs";
import { isLocal, urlOr } from "../crawl/fetch.mjs";

// Only Set-Cookie headers are seen, not cookies scripts set.
export function cookiesAndPolicies(site) {
  const { htmlPages, home, add } = site;
  // Load balancer and CDN cookies are skipped, since the site can't change their flags: AWS ALB and ELB stickiness,
  // Azure App Service's ARRAffinity, F5 BIG-IP's BIGipServer<pool>, and Cloudflare's own.
  // https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/
  const INFRA_COOKIE =
    /^(AWSALB(TG)?(CORS)?|AWSALBAPP-\d+|AWSELB|ARRAffinity(SameSite)?|BIGipServer.*|__cf\w+|_cfuvid|cf_clearance|cf_ob_info|cf_use_ob|cf_chl_\w+)$/;
  const cookieSeen = new Set();
  for (const p of htmlPages)
    for (const c of p.headers.getSetCookie()) {
      const name = c.split(";")[0].split("=")[0].trim();
      if (cookieSeen.has(name) || INFRA_COOKIE.test(name)) continue;
      cookieSeen.add(name);
      const problems = cookieProblems(c, { https: p.finalUrl.startsWith("https:") });
      if (problems.length) add("cookie-flags", p.finalUrl, `“${name}”: ${problems.join(", ")}`);
    }
  const POLICIES = new Set([
    "no-referrer",
    "no-referrer-when-downgrade",
    "same-origin",
    "origin",
    "strict-origin",
    "origin-when-cross-origin",
    "strict-origin-when-cross-origin",
    "unsafe-url",
  ]);
  // In the header the last valid value wins. https://www.w3.org/TR/referrer-policy/#parse-referrer-policy-from-header
  const policyOf = v =>
    (v || "")
      .split(",")
      .map(t => t.trim().toLowerCase())
      .filter(t => POLICIES.has(t))
      .at(-1);
  for (const p of htmlPages) {
    const header = p.headers.get("referrer-policy");
    const unsafe = [
      policyOf(header) === "unsafe-url" && `header: ${header}`,
      policyOf(p.referrerMeta) === "unsafe-url" && `meta: ${p.referrerMeta}`,
    ].filter(Boolean);
    if (unsafe.length) add("referrer-unsafe", p.finalUrl, unsafe.join(" · "));
  }
}

// Headers are checked on the home page, mixed content on every page. A Server version with a known hole is
// needs-decision, as it may be patched. A missing HSTS header is tls.mjs's no-hsts.
export function securityHeaders(site) {
  const { htmlPages, home, add, extra, startOrigin: START_ORIGIN, expectOrigin: EXPECT_ORIGIN } = site;
  if (home?.headers) {
    const h = home.headers,
      at = home.finalUrl,
      sts = h.get("strict-transport-security");
    if (!h.get("permissions-policy")) add("sec-headers", at, "Permissions-Policy");
    const gaps = cspProblems(h.get("content-security-policy"));
    if (gaps.length) add("csp-weak", at, gaps.join("; "));
    const s = sts && hstsRead(sts);
    // A header browsers ignore is hsts-invalid and nothing else. https://www.rfc-editor.org/rfc/rfc6797#section-8.1
    if (s?.invalid) add("hsts-invalid", at, `${s.invalid}, so browsers ignore the whole header: ${sts}`);
    else if (s) {
      // A year is the preload list's minimum. https://hstspreload.org
      if (s.maxAge < 31536000) {
        const d = Math.round(s.maxAge / 86400);
        add(
          "hsts-short",
          at,
          `max-age=${s.maxAge} (${s.maxAge < 86400 ? "under a day" : `${d} day${d === 1 ? "" : "s"}`})`,
        );
      }
      if (!s.includeSubDomains) add("hsts-no-subdomains", at, sts);
      extra.hstsPreload = { ready: !s.missing.length, missing: s.missing };
    }
    const sv = serverHoles(h.get("server"));
    if (sv)
      add(
        "server-known-holes",
        at,
        `Server: ${h.get("server")}: ${sv.cves.map(c => `${c.id} (${c.what}, fixed in ${c.fixed})`).join("; ")}`,
      );
  }
  // A local copy's own files (the crawl origin or another local address) will be on https once deployed, so only other
  // sites' http:// files count.
  if (EXPECT_ORIGIN.startsWith("https:"))
    for (const p of htmlPages) {
      const bad = (p.insecure || []).filter(r => {
        const o = urlOr(r.url)?.origin;
        return o && o !== START_ORIGIN && !isLocal(o);
      });
      if (bad.length)
        add(
          "mixed-content",
          p.finalUrl,
          `${bad.length} resource${bad.length === 1 ? "" : "s"} over http://: ${bad
            .slice(0, 3)
            .map(r => `${r.kind} ${r.url}`)
            .join(", ")}`,
        );
    }
}
