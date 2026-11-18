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
  "no-hsts": [
    "TRUST-01",
    "low",
    () => "The live site sends no Strict-Transport-Security header",
    "Without HSTS, browsers can still make a first plain-HTTP request that can be intercepted.",
    "Send `Strict-Transport-Security: max-age=31536000; includeSubDomains` from the server or CDN.",
  ],
};

const DAY = 864e5;

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
      fail(new Error("timed out"));
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

export async function checkLive(origin, { add, now = Date.now(), connect = tlsCert, fetchFn = fetch }) {
  const notes = [],
    o = new URL(origin),
    host = o.hostname,
    port = Number(o.port) || 443;
  const other = host.startsWith("www.") ? host.slice(4) : "www." + host;
  let c;
  try {
    c = await connect(host, port);
  } catch (e) {
    notes.push(`Live check: couldn't open an HTTPS connection to ${host} (${e.message}).`);
  }
  if (c) {
    if (!c.authorized) add("cert-untrusted", origin, c.authorizationError || "not trusted");
    const to = Date.parse(c.valid_to),
      from = Date.parse(c.valid_from),
      left = to - now;
    if (left < 2 * DAY) add("cert-expired", origin, `valid until ${c.valid_to}`);
    else if (left < Math.min(isNaN(from) ? Infinity : (to - from) / 3, 30 * DAY))
      add("cert-expiring", origin, `${Math.floor(left / DAY)} days left, valid until ${c.valid_to}`);
    // The other host only matters when it answers; then its certificate must name it.
    let oc = null;
    try {
      oc = await connect(other, port);
    } catch {}
    if (oc && !covers(oc.subjectaltname, other))
      add("cert-host-mismatch", `https://${other}`, `certificate names: ${oc.subjectaltname || "none"}`);
  }
  // http:// → https://, with redirects followed by hand to count them.
  try {
    let url = `http://${host}/`,
      hops = 0;
    while (hops < 6) {
      const r = await fetchFn(url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
      const loc = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
      if (!loc) break;
      url = new URL(loc, url).href;
      hops++;
      if (url.startsWith("https:")) break;
    }
    if (!url.startsWith("https:"))
      add("http-not-redirected", `http://${host}/`, hops ? `ends at ${url}` : "answers on plain http");
    else if (hops > 1) add("http-redirect-hops", `http://${host}/`, `${hops} hops to ${url}`);
  } catch (e) {
    notes.push(`Live check: http://${host}/ didn't answer (${e.message}).`);
  }
  try {
    const r = await fetchFn(origin + "/", { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (!r.headers.get("strict-transport-security")) add("no-hsts", origin + "/");
  } catch {}
  return { notes };
}
