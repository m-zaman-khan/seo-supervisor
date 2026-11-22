// @ts-check
// The crawler's HTTP layer: the private-address guard, the 429/503 brake and URL helpers.
import { lookup } from "node:dns";
import { get as httpGet, request as httpRequest } from "node:http";
import { get as httpsGet, request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { guarded, isPublic, loopback } from "../lib/net.mjs";
import { bodyUpTo, retryAfter } from "../lib/http.mjs";
import { brake, sleep } from "../checks/crawl.mjs";

export const TEMPORARY = new Set([302, 303, 307]); // redirects that tell search engines the old URL may come back
// A redirect between URLs that differ only by a trailing slash counts under URL-02.
export const slashOnly = (a, b) => {
  const x = new URL(a),
    y = new URL(b);
  return (
    x.origin === y.origin && x.search === y.search && x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "")
  );
};
const SITEMAP_MAX = 50 * 1024 * 1024; // the sitemap protocol's limit per file, uncompressed
// Local cap on an unpacked page body, which also stops a small gzip that unpacks huge.
export const PAGE_MAX = 10 * 1024 * 1024;
// Reads one chunk past max when there's more, so callers can tell the body was cut.
export async function upTo(stream, max) {
  const chunks = [];
  let n = 0;
  for await (const c of stream) {
    chunks.push(c);
    if ((n += c.length) > max) break;
  }
  return Buffer.concat(chunks);
}

// A local dev server, for notes. Narrower than the private-address test on purpose: tests run a "staging" server on
// 127.0.0.2.
export const isLocal = o => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(o);
// Only a public host may be sent to an outside service.
export { isPublic };
export const urlOr = (u, base) => {
  try {
    return new URL(u, base);
  } catch {
    return null;
  }
}; // template bugs produce invalid URLs
// Backs toCrawl: rewrites public-origin URLs onto the crawled origin.
export function mapOrigin(u, SITE_ORIGIN, START_ORIGIN) {
  try {
    const x = new URL(u);
    if (SITE_ORIGIN && x.origin === SITE_ORIGIN && SITE_ORIGIN !== START_ORIGIN)
      return START_ORIGIN + x.pathname + x.search;
    return x.href;
  } catch {
    return u;
  }
}
export function clean(u, base) {
  try {
    const x = new URL(u, base);
    x.hash = "";
    return x.href;
  } catch {
    return null;
  }
}
export const pathKey = u => {
  const x = new URL(u);
  return x.pathname + x.search;
};

// fetch() for off-site URLs, connecting through guarded() so the address connected to is the one checked. The body is
// unpacked through pipeline(), not pipe(), so a timeout or dropped connection errors instead of hanging the unpacker.
// Exported for tests.
const UNPACK = { gzip: createGunzip, "x-gzip": createGunzip, deflate: createInflate, br: createBrotliDecompress };
const pinnedFetch = (url, { headers, signal }, dns) =>
  new Promise((ok, ko) => {
    (url.startsWith("https:") ? httpsRequest : httpRequest)(
      url,
      { headers: { ...headers, "accept-encoding": "gzip, deflate, br" }, signal, lookup: guarded(dns) },
      res => {
        try {
          const h = new Headers();
          for (let i = 0; i < res.rawHeaders.length; i += 2) h.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
          const unpack = UNPACK[(h.get("content-encoding") || "").trim().toLowerCase()];
          ok(
            new Response(
              [204, 205, 304].includes(res.statusCode)
                ? null
                : /** @type {ReadableStream} */ (Readable.toWeb(unpack ? res.pipe(unpack()) : res)),
              { status: res.statusCode, headers: h },
            ),
          );
        } catch (e) {
          res.destroy();
          ko(e);
        }
      },
    )
      .on("error", ko)
      .end();
  });

// One crawl's request state. toCrawl is a function because seo-crawl.mjs may learn the public origin mid-crawl (from
// robots.txt, the sitemap or the home page's canonical). Tests pass their own dns.
export function createFetcher({ startOrigin: START_ORIGIN, ua: UA, toCrawl, dns = lookup }) {
  const blocked = new Map(); // URL -> why it wasn't fetched
  const publicLookup = /** @type {(host: string, opts: { all: boolean }) => Promise<unknown>} */ (
    promisify(guarded(dns))
  );
  // The crawled origin is never guarded, so a localhost or LAN site can be crawled, and a localhost crawl may reach
  // other local ports (a dev server redirecting to its API). Anything else on a private, reserved or cloud-metadata
  // address is blocked.
  const onSite = x => x.origin === START_ORIGIN || (loopback(new URL(START_ORIGIN).hostname) && loopback(x.hostname));
  async function offLimits(u) {
    let x;
    try {
      x = new URL(u);
    } catch {
      return null;
    }
    if (onSite(x)) return null;
    const why = !isPublic(u)
      ? `${x.host} isn't a public address`
      : await publicLookup(x.hostname, { all: true }).then(
          () => null,
          e => (e.code === "ENOTPUBLIC" ? e.message : null),
        );
    if (why) blocked.set(u, why);
    return why;
  }
  // Off-site requests connect to the address the guard checked, so a name can't resolve differently the second time
  // (DNS rebinding).
  const request = (url, init) => (onSite(new URL(url)) ? fetch(url, init) : pinnedFetch(url, init, dns));
  // A 429 pauses every request to the site for its Retry-After (local cap 30 s, 2 s when absent), then retries once.
  // Own-site requests also pause on a 503, Google's other temporary brake, and for 2 s on no answer. Bot comparisons
  // retry busy answers themselves, and a 503 to a bot may be a firewall, so only a 429 pauses them. brake() caps the
  // pauses at 2 minutes in all.
  // https://developers.google.com/search/docs/crawling-indexing/http-network-errors
  const slow = brake();
  // manual: false goes through follow(), so each hop passes the guard. text is the content-type pattern of 2xx bodies
  // to read (true: HTML, XML, plain text). A body over max comes back empty and marked `over`, and an unread body is
  // drained only up to PAGE_MAX, so no endless answer can fill memory.
  async function get(
    url,
    {
      manual = true,
      text = /** @type {boolean | RegExp} */ (true),
      ua = UA,
      accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      max = PAGE_MAX,
    } = {},
  ) {
    if (!manual) return follow(url, ua);
    const own = ua === UA && urlOr(url)?.origin === START_ORIGIN;
    let waited = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (slow.until > Date.now()) await sleep(slow.until - Date.now());
        const t = performance.now(); // time to the response headers, in ms
        const res = await request(url, {
          redirect: "manual",
          headers: { "user-agent": ua, accept },
          signal: AbortSignal.timeout(20000),
        });
        if ((res.status === 429 || (res.status === 503 && own)) && !waited) {
          waited = true;
          attempt--;
          slow.busy++;
          slow.pause(Math.min(retryAfter(res.headers.get("retry-after")) ?? 2000, 30000));
          await bodyUpTo(res, PAGE_MAX).catch(() => {});
          continue;
        }
        const ms = Math.round(performance.now() - t),
          ct = res.headers.get("content-type") || "";
        const want = text === true ? /html|xml|text\/plain/ : text;
        let body = "",
          over = false;
        if (want && res.status < 300 && want.test(ct)) {
          const b = await bodyUpTo(res, max);
          if (!(over = !b)) body = new TextDecoder().decode(b);
        } else await bodyUpTo(res, PAGE_MAX).catch(() => {});
        return { status: res.status, headers: res.headers, ct, body, location: res.headers.get("location"), ms, over };
      } catch (e) {
        // The guard refused the resolved address at connect time, so a retry would fail the same way.
        if (e.code === "ENOTPUBLIC")
          return { status: 0, error: e.message, refused: true, headers: new Headers(), ct: "", body: "" };
        if (attempt === 1)
          return { status: 0, error: String(e.message || e), headers: new Headers(), ct: "", body: "" };
        if (own) {
          slow.silent++;
          slow.pause(2000);
        } else await sleep(500);
      }
    }
  }
  // A blocked redirect ends the chain at the redirect itself, which is what the server answered. Google follows 10 hops
  // for pages and 5 for robots.txt, so seo-crawl.mjs passes 5 there.
  // https://developers.google.com/search/docs/crawling-indexing/http-network-errors
  // https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
  async function follow(url, ua, hops = 10) {
    const chain = [];
    let cur = url,
      why = await offLimits(cur),
      last = null;
    if (why) return { status: 0, error: why, chain, finalUrl: cur, headers: new Headers(), ct: "", body: "" };
    for (let i = 0; i <= hops; i++) {
      const r = await get(cur, { ua });
      if (r.refused) {
        blocked.set(cur, r.error);
        return last ? { ...last, chain, finalUrl: chain.at(-1).url } : { ...r, chain, finalUrl: cur };
      }
      chain.push({ url: cur, status: r.status });
      if (r.status >= 300 && r.status < 400 && r.location) {
        const next = new URL(r.location, cur).href;
        if ((why = await offLimits(next))) return { ...r, chain, finalUrl: cur };
        last = r;
        cur = next;
        continue;
      }
      return { ...r, chain, finalUrl: cur };
    }
    return { status: 0, error: "too many redirects", chain, finalUrl: cur, headers: new Headers(), ct: "", body: "" };
  }
  // The start of an own-site file by Range request, read no further if the range is ignored. A redirect off the site
  // returns null, so no third party is contacted, as does one that maps back onto the same URL, which would loop.
  // size is the whole file: Content-Range's total, or Content-Length when the range is ignored. Answers are cached per
  // URL and max, since several checks read the same file, and a 429 or 503 slows the crawl and retries once.
  const starts = new Map();
  const firstBytes = (url, max = 65536) => {
    const k = `${max} ${url}`;
    return starts.get(k) ?? starts.set(k, readStart(url, max)).get(k);
  };
  async function readStart(url, max) {
    try {
      for (let hop = 0; hop < 5; hop++) {
        if (slow.until > Date.now()) await sleep(slow.until - Date.now());
        const r = await fetch(url, {
          redirect: "manual",
          headers: { "user-agent": UA, range: `bytes=0-${max - 1}`, accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
          signal: AbortSignal.timeout(15000),
        });
        const loc = r.headers.get("location");
        if (r.status >= 300 && r.status < 400 && loc) {
          await r.body?.cancel();
          const next = clean(toCrawl(new URL(loc, url).href));
          if (!next || next === url || new URL(next).origin !== START_ORIGIN) return null;
          url = next;
          continue;
        }
        const chunks = [];
        let n = 0;
        if (r.body)
          for await (const c of r.body) {
            chunks.push(c);
            if ((n += c.length) >= max) break;
          }
        return {
          status: r.status,
          type: r.headers.get("content-type") || "",
          headers: r.headers,
          bytes: Buffer.concat(chunks),
          size:
            Number(
              r.status === 206
                ? r.headers.get("content-range")?.match(/\/(\d+)$/)?.[1]
                : r.headers.get("content-length"),
            ) || 0,
        };
      }
      return { status: 0, error: "too many redirects" };
    } catch (e) {
      return { status: 0, error: String(e.message || e) };
    }
  }
  // Gunzips by the magic bytes, whatever the content type says: fetch undoes only Content-Encoding, and a .gz file may
  // be compressed twice. Redirects are followed by hand, 5 at most, so each hop passes the guard.
  async function fetchSitemap(url, retry = true) {
    try {
      let res;
      for (let hop = 0; ; hop++) {
        const why = await offLimits(url);
        if (why) return { status: 0, error: why };
        res = await request(url, {
          redirect: "manual",
          headers: { "user-agent": UA, accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" },
          signal: AbortSignal.timeout(60000),
        });
        const loc = res.headers.get("location");
        if (res.status < 300 || res.status > 399 || !loc || hop === 5) break;
        await res.body?.cancel();
        url = new URL(loc, url).href;
      }
      if (res.status !== 200 || !res.body) {
        await res.body?.cancel();
        return { status: res.status };
      }
      let buf = await upTo(res.body, SITEMAP_MAX);
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        const gz = createGunzip();
        gz.end(buf);
        buf = await upTo(gz, SITEMAP_MAX).catch(() => null);
        if (!buf) return { status: 200, body: "", broken: "it's a gzip file that doesn't unzip" };
      }
      const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
      return { status: 200, body: buf.toString("utf8", bom, SITEMAP_MAX), tooBig: buf.length > SITEMAP_MAX };
    } catch (e) {
      if (e.code === "ENOTPUBLIC") {
        blocked.set(url, e.message);
        return { status: 0, error: e.message };
      }
      if (retry) {
        await sleep(500);
        return fetchSitemap(url, false);
      }
      return { status: 0, error: String(e.message || e) };
    }
  }
  // Raw header lines, since fetch joins repeated headers with commas: "bingbot: noarchive" then "noindex" would read as
  // one value whose noindex is Bing's.
  const xRobotsLines = url =>
    new Promise(ok => {
      const req = (url.startsWith("https:") ? httpsGet : httpGet)(
        url,
        {
          headers: { "user-agent": UA, accept: "text/html" },
          timeout: 15000,
          ...(onSite(new URL(url)) ? {} : { lookup: guarded(dns) }),
        },
        res => {
          const lines = [];
          for (let i = 0; i < res.rawHeaders.length; i += 2)
            if (res.rawHeaders[i].toLowerCase() === "x-robots-tag") lines.push(res.rawHeaders[i + 1]);
          res.destroy();
          ok(res.statusCode === 200 ? lines : null);
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout"))).on("error", () => ok(null));
    });
  return { get, follow, firstBytes, fetchSitemap, xRobotsLines, blocked, slow };
}
