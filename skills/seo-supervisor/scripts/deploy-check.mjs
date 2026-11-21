#!/usr/bin/env node
// @ts-check
// Fast post-deploy check for CI: exits 1 on anything that keeps search engines out, 2 on bad usage.
import { promisify } from "node:util";
import { lookup as dnsLookup } from "node:dns";
import { isMain } from "./lib/is-main.mjs";
import { proxyNote } from "./lib/proxy.mjs";
import { guarded, isPublic } from "./checks/outbound.mjs";
import { tlsCert } from "./checks/tls.mjs";
import { VERSION } from "./update-check.mjs";

const UA = "seo-supervisor-deploy-check/" + VERSION,
  TIMEOUT = 10000,
  DAY = 864e5;

// Redirects are followed by hand, 5 at most. Off the site's origin the address must be public, and pinnedGet connects
// only to the address it checked, so a name can't pass the check and then resolve elsewhere (DNS rebinding).
async function load(url, origin, { fetchFn, lookup }) {
  const hops = [];
  try {
    for (let i = 0; i <= 5; i++) {
      if (new URL(url).origin !== origin) {
        if (!isPublic(url))
          return { error: `${new URL(url).host} isn't a public address, so it wasn't visited`, url, hops };
        const bad = await /** @type {(host: string, opts: { all: boolean }) => Promise<unknown>} */ (
          promisify(guarded(lookup))
        )(new URL(url).hostname, { all: true }).then(
          () => null,
          e => (e.code === "ENOTPUBLIC" ? e.message : null),
        );
        if (bad) return { error: bad, url, hops };
      }
      const res = await fetchFn(url, {
        redirect: "manual",
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const loc = res.status >= 300 && res.status < 400 && res.headers.get("location");
      if (!loc) return { res, url, hops };
      await res.body?.cancel();
      hops.push(res.status);
      url = new URL(loc, url).href;
    }
    return { error: "it redirects more than 5 times", url, hops };
  } catch (e) {
    return {
      error:
        e.name === "TimeoutError"
          ? `no answer within ${TIMEOUT / 1000} seconds`
          : why(e.cause?.code) || e.cause?.message || e.message,
      url,
      hops,
    };
  }
}
const WHY = {
  ECONNREFUSED: "the server refused the connection",
  ECONNRESET: "the connection was dropped",
  ETIMEDOUT: "the connection timed out",
  ENOTFOUND: "the name isn't in DNS",
  EAI_AGAIN: "DNS didn't answer",
  CERT_HAS_EXPIRED: "the certificate has expired",
};
const why = code => code && (WHY[code] ? `${WHY[code]} (${code})` : code);

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};
const tags = (html, el) => html.match(new RegExp(`<${el}\\b[^>]*>`, "gi")) || [];
// noindex, or none (which includes it). Another crawler's directive, and max-image-preview's "none" value, aren't
// Google's noindex. https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
// Known limit: a directive after another crawler's name ("otherbot: nofollow, noindex") reads as everyone's. Carry the
// crawler name across the list, as backlinks.mjs pageNofollow does, if that matters.
function noindexOf(html, header) {
  const meta = tags(html, "meta")
    .filter(t => /^(robots|googlebot)$/i.test(attr(t, "name") || ""))
    .find(t => (attr(t, "content") || "").split(",").some(d => /^(noindex|none)$/i.test(d.trim())));
  if (meta) return `a meta tag says ${meta}`;
  const h = (header || "")
    .split(",")
    .map(d => d.trim())
    .find(d => {
      const m = /^(?:([a-z][\w-]*)\s*:\s*)?(noindex|none)$/i.exec(d);
      return m && (!m[1] || /^googlebot$/i.test(m[1]));
    });
  return h ? `the X-Robots-Tag header says ${h}` : null;
}

// Reads robots.txt as the crawler's parseRobots and allowedBy do: a crawler follows the groups naming it, combined,
// else the * groups; the longest rule matching a path wins, an allow on a tie; rules with no path are ignored.
// https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#order-of-precedence-for-user-agents
// https://www.rfc-editor.org/rfc/rfc9309#section-2.2.1
function readRobots(txt) {
  const groups = [],
    sitemaps = [];
  let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(),
      i = line.indexOf(":");
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(),
      v = line.slice(i + 1).trim();
    if (k === "sitemap" && v) sitemaps.push(v);
    else if (k === "user-agent") {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(v.startsWith("*") ? "*" : (/^[A-Za-z_-]+/.exec(v)?.[0] || v).toLowerCase());
    } else if ((k === "allow" || k === "disallow") && cur && v) cur.rules.push({ allow: k === "allow", path: v });
  }
  const own = a => groups.filter(g => g.agents.includes(a)).flatMap(g => g.rules);
  // "*" matches anything, a "$" at the end anchors the path.
  const re = p =>
    new RegExp(
      "^" +
        p
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\\\$$/, "$"),
    );

  const blocksHome = a => {
    const best = (own(a).length ? own(a) : own("*"))
      .filter(r => re(r.path).test("/"))
      .sort((x, y) => y.path.length - x.path.length || +y.allow - +x.allow)[0];
    return !!best && !best.allow;
  };
  return { sitemaps, blocksHome, ownGroup: a => own(a).length > 0 };
}

/** The checks, in order, each { id, state: "ok" | "warning" | "blocker" | "skipped", text }.
 * @param {string} site
 * @param {{ fetchFn?: typeof fetch, connect?: typeof tlsCert, lookup?: any, now?: number }} [options] */
export async function deployCheck(
  site,
  { fetchFn = fetch, connect = tlsCert, lookup = dnsLookup, now = Date.now() } = {},
) {
  const t0 = Date.now(),
    origin = new URL(site).origin,
    o = { fetchFn, lookup },
    checks = [];
  const put = (id, state, text) => checks.push({ id, state, text });
  const https = origin.startsWith("https:"),
    host = new URL(origin).hostname,
    port = Number(new URL(origin).port) || 443;
  const [home, robots, cert] = await Promise.all([
    load(origin + "/", origin, o).then(async r => ({
      ...r,
      body: r.res?.status === 200 ? await r.res.text().catch(() => "") : (await r.res?.body?.cancel(), ""),
    })),
    load(origin + "/robots.txt", origin, o).then(async r => ({
      ...r,
      body: r.res?.status === 200 ? await r.res.text().catch(() => "") : (await r.res?.body?.cancel(), ""),
    })),
    https
      ? connect(host, port, TIMEOUT).then(
          c => ({ c, error: null }),
          e => ({ c: null, error: why(e.code) || e.message }),
        )
      : null,
  ]);
  const via = home.hops.length
    ? ` after ${home.hops.length === 1 ? "a redirect" : `${home.hops.length} redirects`} to ${home.url}`
    : "";
  const homeOk = home.res?.status === 200;
  if (home.error) put("home", "blocker", `The home page didn't answer: ${home.error}.`);
  else put("home", homeOk ? "ok" : "blocker", `The home page answers ${home.res.status}${via}.`);
  if (!homeOk) put("noindex", "skipped", "The home page didn't load, so its robots rules weren't read.");
  else {
    const n = noindexOf(home.body, home.res.headers.get("x-robots-tag"));
    put(
      "noindex",
      n ? "blocker" : "ok",
      n
        ? `The home page is noindex: ${n}. Search engines drop it, and often the whole site follows.`
        : "The home page isn't noindex.",
    );
  }
  // Google halts crawling the whole site while robots.txt answers 5xx or 429, and reads a 4xx as no rules. Right after
  // a deploy that halt is immediate, so it's a blocker.
  // https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
  const rs = robots.res?.status,
    txt = rs === 200 && !/<html/i.test(robots.body) ? robots.body : null;
  const rules = txt != null ? readRobots(txt) : null;
  if (robots.error || rs >= 500 || rs === 429)
    put(
      "robots",
      "blocker",
      `robots.txt ${robots.error ? `didn't answer: ${robots.error}` : `answers ${rs}`}. Google stops crawling the whole site while it fails.`,
    );
  else if (!rules)
    put(
      "robots",
      "warning",
      `robots.txt ${rs === 200 ? "is an HTML page, not a robots.txt file" : `answers ${rs}`}, so Google reads it as no rules: nothing is blocked, and no sitemap is listed there.`,
    );
  else if (rules.blocksHome("*"))
    put(
      "robots",
      "blocker",
      "robots.txt blocks every crawler without a group of its own (User-agent: *) from the whole site.",
    );
  else if (rules.ownGroup("googlebot") && rules.blocksHome("googlebot"))
    put("robots", "blocker", "robots.txt blocks Googlebot from the whole site (its own User-agent: Googlebot group).");
  else put("robots", "ok", "robots.txt doesn't block the home page.");
  if (!rules?.sitemaps.length)
    put(
      "sitemap",
      "warning",
      rules ? "robots.txt lists no sitemap (no Sitemap: line)." : "No sitemap could be read from robots.txt.",
    );
  else {
    const list = rules.sitemaps.slice(0, 5),
      got = await Promise.all(
        list.map(u => {
          try {
            return load(new URL(u).href, origin, o).then(async r => (await r.res?.body?.cancel(), r));
          } catch {
            return { error: "it isn't a valid URL", url: u, hops: [] };
          }
        }),
      );
    const bad = got.map((r, i) => [list[i], r]).filter(([, r]) => r.res?.status !== 200);
    put(
      "sitemap",
      bad.length ? "warning" : "ok",
      bad.length
        ? `The sitemap ${bad.map(([u, r]) => `${u} ${r.error ? `wasn't reached: ${r.error}` : `answers ${r.res.status}`}`).join("; ")}.`
        : `robots.txt lists ${list.length === 1 ? "the sitemap" : `${list.length} sitemaps`}, and ${list.length === 1 ? "it answers" : "each answers"} 200.`,
    );
  }
  if (!homeOk) put("canonical", "skipped", "The home page didn't load, so its canonical wasn't read.");
  else {
    const hrefs = tags(home.body, "link")
      .filter(t => (attr(t, "rel") || "").toLowerCase().split(/\s+/).includes("canonical"))
      .map(t => attr(t, "href") || "");
    const self = new URL(home.url);
    self.hash = "";
    const to =
      hrefs.length === 1
        ? (() => {
            try {
              const x = new URL(hrefs[0], home.url);
              x.hash = "";
              return x.href;
            } catch {
              return hrefs[0];
            }
          })()
        : null;
    if (!hrefs.length) put("canonical", "warning", "The home page has no canonical tag.");
    else if (hrefs.length > 1)
      put(
        "canonical",
        "warning",
        `The home page has ${hrefs.length} canonical tags, so search engines ignore them all.`,
      );
    else
      put(
        "canonical",
        to === self.href ? "ok" : "warning",
        to === self.href
          ? "The home page's canonical points to itself."
          : `The home page's canonical points to ${to}, not to itself (${self.href}).`,
      );
  }
  // Same thresholds as checks/tls.mjs checkLive. Under a third of its lifetime and under 30 days left usually means
  // automatic renewal stopped.
  if (!cert) put("certificate", "skipped", "The site isn't on https://, so there's no certificate to check.");
  else if (!cert.c) put("certificate", "warning", `The certificate couldn't be read: ${cert.error}.`);
  else {
    const c = cert.c,
      to = Date.parse(c.valid_to),
      from = Date.parse(c.valid_from),
      left = to - now,
      days = Math.floor(left / DAY);
    if (!c.authorized && c.authorizationError !== "CERT_HAS_EXPIRED")
      put(
        "certificate",
        "blocker",
        `The certificate isn't trusted (${c.authorizationError || "not trusted"}). Browsers show a full-page warning.`,
      );
    else if (left < 2 * DAY)
      put(
        "certificate",
        "blocker",
        left < 0
          ? `The certificate expired on ${c.valid_to}.`
          : `The certificate expires within 2 days (${c.valid_to}). Renew it now.`,
      );
    else if (left < Math.min(isNaN(from) ? Infinity : (to - from) / 3, 30 * DAY))
      put(
        "certificate",
        "warning",
        `The certificate has ${days} days left (until ${c.valid_to}). Automatic renewal may have stopped.`,
      );
    else put("certificate", "ok", `The certificate has ${days} days left (until ${c.valid_to}).`);
  }
  const count = s => checks.filter(c => c.state === s).length;
  return {
    site: origin,
    checkedAt: new Date(now).toISOString(),
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    blockers: count("blocker"),
    warnings: count("warning"),
    checks,
  };
}

const LABEL = { ok: "OK", warning: "WARNING", blocker: "BLOCKER", skipped: "SKIPPED" };
export const textOf = r =>
  [
    `Deploy check for ${r.site} (${r.seconds} s)`,
    ...r.checks.map(c => `  ${LABEL[c.state].padEnd(8)} ${c.text}`),
    r.blockers
      ? `${r.blockers} blocker${r.blockers === 1 ? "" : "s"}${r.warnings ? ` and ${r.warnings} warning${r.warnings === 1 ? "" : "s"}` : ""}. A blocker can keep the site out of search: fix it now.`
      : r.warnings
        ? `No blockers, ${r.warnings} warning${r.warnings === 1 ? "" : "s"}. Fix ${r.warnings === 1 ? "it" : "them"} soon; a full audit gives the detail.`
        : "Everything checked is fine.",
  ].join("\n");

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2),
    i = argv.indexOf("--site"),
    site = i >= 0 ? argv[i + 1] : null;
  let ok = false;
  try {
    ok = !!site && /^https?:$/.test(new URL(site).protocol);
  } catch {}
  if (!ok) {
    console.error(
      "Usage: node deploy-check.mjs --site https://www.example.com [--json]\nThe site's address must start with http:// or https://.",
    );
    process.exitCode = 2;
  } else {
    const note = proxyNote();
    if (note) console.error("note: " + note);
    const r = await deployCheck(String(site));
    console.log(argv.includes("--json") ? JSON.stringify(r, null, 2) : textOf(r));
    // Not process.exit(): exiting while fetch's sockets close crashes Node on Windows.
    process.exitCode = r.blockers ? 1 : 0;
  }
}
