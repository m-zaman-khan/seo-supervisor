// Live-origin HTTPS checks (certificate, redirects, HSTS), run only with --check-live against the production origin.
import tls from "node:tls";

export const CHECKS = {
  "cert-untrusted": [
    "TRUST-07",
    "blocker",
    () => "The HTTPS certificate isn't trusted",
    "Browsers show a full-page security warning and search engines may not crawl the site over HTTPS.",
    "Install a certificate from a trusted authority with its full chain (most hosts and CDNs do this automatically).",
  ],
  "cert-expired": [
    "TRUST-07",
    "blocker",
    () => "The HTTPS certificate has expired or expires within 2 days",
    "Once it expires, every visitor gets a security warning and crawlers stop fetching pages.",
    "Renew the certificate now and turn on automatic renewal.",
  ],
  "cert-expiring": [
    "TRUST-07",
    "high",
    () => "The HTTPS certificate expires soon",
    "Less than a third of its lifetime (and under 30 days) is left, which usually means automatic renewal has stopped working.",
    "Check the renewal job or the host's certificate settings and renew it.",
  ],
  "cert-host-mismatch": [
    "TRUST-07",
    "blocker",
    n => `The HTTPS certificate doesn't cover ${n} of the site's host names`,
    "Visitors who type the other host (with or without www) get a security warning before any redirect can happen.",
    "Issue the certificate for both the apex and the www host, then redirect one to the other.",
  ],
  "https-unreachable": [
    "TRUST-07",
    "high",
    () => "The HTTPS server refused the connection or timed out",
    "Nobody could open the site over HTTPS during the check: the server or CDN refused the connection, dropped it or didn't answer in time. If it keeps happening, Google crawls less and pages drop out of search.",
    "Check that the server or CDN is up and accepts connections on port 443, and that no firewall or rate limit blocks them. Run the check again to tell a lasting fault from a passing one.",
  ],
  "https-missing": [
    "TRUST-07",
    "high",
    () => "The site has no working HTTPS",
    "Nothing answers with HTTPS for this host name: the server speaks only plain http://, or has no certificate set up for this name. Browsers mark every page “Not secure” and https:// links to the site fail.",
    "Turn on HTTPS for this host name at the host or CDN (most issue a free certificate automatically), then redirect http:// to https:// with a 301.",
  ],
  "http-not-redirected": [
    "URL-03",
    "high",
    () => "http:// doesn't redirect to https://",
    "The site is reachable on plain HTTP, so two versions exist and visitors can land on the insecure one.",
    "Redirect every http:// URL to its https:// version with a 301 at the server or CDN.",
  ],
  "http-redirect-hops": [
    "URL-03",
    "medium",
    () => "http:// takes more than one redirect to reach https://",
    "Every extra hop slows the first visit and loses a little signal.",
    "Redirect http:// straight to the final https:// host in one 301.",
  ],
  "host-not-redirected": [
    "URL-03",
    "high",
    () => "The other host (with or without www) shows the site instead of redirecting",
    "The site answers on both host names, so every page exists twice. Links and ranking signals split between the two, and Google picks one of them itself.",
    "Redirect every URL on the other host to the same path on the preferred host with a 301, at the DNS host, CDN or server.",
  ],
  "host-redirect-hops": [
    "URL-03",
    "medium",
    () => "The other host takes more than one redirect to reach the preferred host",
    "Every extra hop slows the visit and loses a little signal. (An http:// to https:// step on the same host first is fine.)",
    "Redirect the other host straight to https:// on the preferred host in one 301.",
  ],
  "host-redirect-drops-path": [
    "URL-03",
    "medium",
    () => "The other host sends deeper pages to the home page",
    "Links to pages on the other host (often old links with or without www) land on the home page instead of the page they named, so visitors get lost and Google treats them as soft 404s.",
    "Keep the path when redirecting: `www.example.com/pricing/` must go to `example.com/pricing/`.",
  ],
  "redirect-temporary": [
    "URL-03",
    "medium",
    n => `${n} redirect(s) to the main https:// host are temporary (302, 303 or 307)`,
    "A temporary redirect tells search engines the old address may come back, so they can keep the http:// or other-host address in results and pass less signal to the real one.",
    "Make the redirect permanent: a 301 or 308 at the server or CDN.",
  ],
  "no-hsts": [
    "TRUST-01",
    "low",
    () => "The live site sends no Strict-Transport-Security header",
    "Without HSTS, browsers can still make a first plain-HTTP request that can be intercepted.",
    "Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` from the server or CDN.",
  ],
};

const DAY = 864e5;
const TEMPORARY = new Set([302, 303, 307]);

// The peer certificate of host:port, with whether it's trusted for that host name.
export function tlsCert(host, port = 443, timeoutMs = 10000) {
  return new Promise((ok, fail) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const c = socket.getPeerCertificate();
      ok({
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
        valid_from: c.valid_from,
        valid_to: c.valid_to,
        subjectaltname: c.subjectaltname || "",
      });
      socket.end();
    });
    socket.on("timeout", () => {
      socket.destroy();
      fail(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
    });
    socket.on("error", fail);
  });
}

const covers = (san, host) =>
  san
    .split(",")
    .map(s => s.trim().replace(/^DNS:/i, "").toLowerCase())
    .some(
      n =>
        n === host ||
        (n.startsWith("*.") && host.endsWith(n.slice(1)) && host.split(".").length === n.split(".").length),
    );

// Redirects followed by hand until stop(url) or an answer that isn't one: each hop's status and the URL it came from.
async function walk(url, fetchFn, stop) {
  const hops = [];
  while (hops.length < 6 && !stop(url)) {
    const r = await fetchFn(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!loc) return { hops, url, status: r.status };
    hops.push({ from: url, status: r.status });
    url = new URL(loc, url).href;
  }
  return { hops, url, status: null };
}
const trail = w => `${w.hops.map(h => h.status).join(" → ")} → ${w.url}`;

export async function checkLive(origin, { add, now = Date.now(), connect = tlsCert, fetchFn = fetch, path }) {
  const notes = [],
    o = new URL(origin),
    host = o.hostname,
    port = Number(o.port) || 443;
  // The www/apex pair only exists for www.X and for a registrable apex (example.com, example.co.uk);
  // a subdomain such as user.github.io or blog.example.com has no www twin to check.
  const labels = host.split("."),
    apex =
      labels.length === 2 ||
      (labels.length === 3 && /^(co|com|org|net|ac|gov|edu)$/.test(labels[1]) && labels[2].length === 2);
  const other = host.startsWith("www.") ? host.slice(4) : apex ? "www." + host : null;
  const temporary = (from, w) => {
    if (w.hops.some(h => TEMPORARY.has(h.status))) add("redirect-temporary", from, trail(w));
  };
  let c, failed;
  try {
    c = await connect(host, port);
  } catch (e) {
    failed = e;
  }
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(failed?.code)) {
    notes.push(
      `Live check: ${host} doesn't resolve in DNS, so the certificate and redirects couldn't be checked. Check --site-origin, or run --check-live once the site is live.`,
    );
    return { notes, unresolved: true };
  }
  if (c) {
    // Node also calls an expired certificate untrusted; it's reported once, as expired.
    if (!c.authorized && c.authorizationError !== "CERT_HAS_EXPIRED")
      add("cert-untrusted", origin, c.authorizationError || "not trusted");
    const to = Date.parse(c.valid_to),
      from = Date.parse(c.valid_from),
      left = to - now;
    if (left < 2 * DAY) add("cert-expired", origin, `valid until ${c.valid_to}`);
    else if (left < Math.min(isNaN(from) ? Infinity : (to - from) / 3, 30 * DAY))
      add("cert-expiring", origin, `${Math.floor(left / DAY)} days left, valid until ${c.valid_to}`);
    // The other host only matters when it answers; then its certificate must name it.
    let oc = null;
    if (other)
      try {
        oc = await connect(other, port);
      } catch {}
    if (oc && !covers(oc.subjectaltname, other))
      add("cert-host-mismatch", `https://${other}`, `certificate names: ${oc.subjectaltname || "none"}`);
  }
  // http:// → https://, with redirects followed by hand to count them.
  let http = null;
  try {
    http = await walk(`http://${host}/`, fetchFn, u => u.startsWith("https:"));
    if (!http.url.startsWith("https:"))
      add("http-not-redirected", `http://${host}/`, http.hops.length ? `ends at ${http.url}` : "answers on plain http");
    else if (http.hops.length > 1)
      add("http-redirect-hops", `http://${host}/`, `${http.hops.length} hops to ${http.url}`);
    temporary(`http://${host}/`, http);
  } catch (e) {
    notes.push(`Live check: http://${host}/ didn't answer (${e.message}).`);
  }
  // No HTTPS connection: no HTTPS at all when port 443 doesn't speak TLS or plain http:// serves the site instead;
  // otherwise the server refused, dropped or didn't answer.
  if (failed) {
    const down =
      /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)$/.test(failed.code) &&
      !(http?.status && !http.url.startsWith("https:"));
    add(down ? "https-unreachable" : "https-missing", origin, failed.message);
  }
  // The other host: its http and https home page, and one deeper page, must reach https on this host in one permanent
  // hop with the path kept. One that doesn't resolve or answer is fine: there's only one host.
  if (other)
    for (const p of ["/", ...(path && path !== "/" ? [path] : [])])
      for (const scheme of ["http", "https"]) {
        const from = `${scheme}://${other}${p}`,
          here = u => {
            const x = new URL(u);
            return x.hostname === host && x.protocol === "https:";
          };
        let w;
        try {
          w = await walk(from, fetchFn, u => here(u) || ![host, other].includes(new URL(u).hostname));
        } catch {
          continue;
        }
        if (!here(w.url)) {
          if (new URL(w.url).hostname === other && w.status >= 200 && w.status < 300)
            add(
              "host-not-redirected",
              from,
              w.hops.length ? `ends at ${w.url} (${w.status})` : `answers ${w.status} itself`,
            );
          continue;
        }
        // hstspreload.org asks http:// to go to https:// on the same host first, so that step doesn't count.
        const upgrade = scheme === "http" && (w.hops[1]?.from ?? w.url) === `https://${other}${p}`;
        if (w.hops.length - upgrade > 1) add("host-redirect-hops", from, `${w.hops.length} hops to ${w.url}`);
        if (p !== "/" && new URL(w.url).pathname === "/") add("host-redirect-drops-path", from, `→ ${w.url}`);
        temporary(from, w);
      }
  try {
    const r = await fetchFn(origin + "/", { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (!r.headers.get("strict-transport-security")) add("no-hsts", origin + "/");
  } catch {}
  return { notes };
}
