// @ts-check
// Renders pages in an installed Chrome or Edge and compares the result with the raw HTML. The page's own scripts,
// analytics included, run behind a guard that keeps them off private addresses.
import { execFile } from "node:child_process";
import { lookup } from "node:dns";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { connect, isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHROME_FLAGS, containerArgs, quietProfile } from "../lib/cdp.mjs";
import { chromeProxyArgs } from "../lib/proxy.mjs";
import { redact } from "../lib/redact.mjs";
import { installedBrowser } from "../lib/settings-dir.mjs";
import { privateIp } from "./outbound.mjs";

export const CHECKS = {
  // Google asks sites not to change the canonical with JavaScript, and not all bots run it.
  // https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
  "render-changes-head": [
    "REND-06",
    "high",
    n => `JavaScript changes the title, canonical or robots tag on ${n} page(s)`,
    "Search engines read the raw HTML first and the rendered page later. When the two disagree, which value wins isn't predictable, and a robots or canonical change can drop a page.",
    "Output the final title, canonical and robots tag in the server HTML and don't change them in client code.",
  ],
  // Low: Google accepts a title or description set by JavaScript, so this matters only to crawlers that don't run it.
  "render-changes-text": [
    "REND-06",
    "low",
    n => `JavaScript changes the meta description or H1 on ${n} page(s)`,
    "Google runs the page's JavaScript and uses what it sets, and says changing the meta description this way is fine. Crawlers that don't run JavaScript, most AI crawlers among them, only ever see the server's description and H1, so they get a different summary of the page.",
    "If the server HTML's description or H1 is a placeholder or out of date, output the final one in the server HTML. If both versions are fine, nothing needs to change.",
  ],
  "render-adds-content": [
    "REND-01",
    "medium",
    n => `${n} page(s) get their H1, schema or many links only after JavaScript runs`,
    "Crawlers that don't run JavaScript (most AI crawlers, and Google's first pass) miss whatever only appears after rendering.",
    "Render the H1, JSON-LD and navigation links on the server; keep client JavaScript for interactivity.",
  ],
};

// A CHROME_PATH with no file there (a typo, or a Git Bash /c/... path on Windows) throws rather than quietly running a
// browser nobody chose.
export function findBrowser(env = process.env, platform = process.platform, exists = existsSync) {
  const pf = env.PROGRAMFILES ?? env.ProgramFiles,
    pf86 = env["PROGRAMFILES(X86)"] ?? env["ProgramFiles(x86)"],
    local = env.LOCALAPPDATA ?? env.LocalAppData;
  const candidates =
    {
      win32: [pf, pf86, local]
        .filter(Boolean)
        .flatMap(base => [
          `${base}\\Google\\Chrome\\Application\\chrome.exe`,
          `${base}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]),
      darwin: [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      ],
      linux: [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
        "/snap/bin/chromium",
      ],
    }[platform] || [];
  // Last, the browser `npx seo-supervisor --with-browser` installed in the settings folder.
  return [env.CHROME_PATH, ...candidates].find(p => p && exists(p)) || installedBrowser(env) || null;
}

// Why Chrome showed something other than the site's page, or null. Compared as is, an error page would read as a
// JavaScript title change. Newer Chrome prints "Page load failed" and dumps nothing; older ones dump an error page.
// The markers are tag attributes, which page text can't fake: the dump escapes text's "<" as "&lt;".
export function chromeError(dom, stderr = "") {
  const failed = stderr.match(/Page load failed: (net::ERR_\w+)/);
  if (failed) return failed[1];
  if (
    /<[a-z][^>]*="chrome-error:\/\/|<div\b[^>]*\bid="main-frame-error"|<body\b[^>]*\bclass="[^"]*\bneterror\b/i.test(
      dom,
    )
  )
    return dom.match(/\b(?:net::)?ERR_[A-Z_]+\b/)?.[0] || "Chrome's error page";
  return dom.trim() ? null : "an empty page";
}

// When given, guard's flags replace launchChrome's proxy flags. host ({ platform, uid, env, exists }) is for tests.
export const renderArgs = (profile, url, host = {}, guard = null) => [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  ...CHROME_FLAGS,
  ...containerArgs(host),
  ...(guard || chromeProxyArgs(host.env)),
  `--user-data-dir=${profile}`,
  "--virtual-time-budget=5000",
  "--dump-dom",
  url,
];

// ---------- the browser guard ----------
// Page scripts must not reach private addresses or the cloud metadata service (169.254.169.254), whose answers could
// end up in the report. The site's own addresses stay open (a local build's API on another port), as does loopback
// for a local site. Every address a name resolves to is checked, so a public name for a private address is refused.
// The returned check resolves to the host's addresses, or null when the host is refused.
export async function addressCheck(siteUrl, { dns = lookup } = {}) {
  const resolve = host =>
    isIP(host)
      ? Promise.resolve([host])
      : new Promise((ok, fail) => dns(host, { all: true }, (e, list) => (e ? fail(e) : ok(list.map(a => a.address)))));
  const bare = h => h.replace(/^\[|\]$/g, "");
  const own = new Set(await resolve(bare(new URL(siteUrl).hostname)).catch(() => []));
  if ([...own].some(a => /^127\.|^::1$/.test(a))) own.add("127.0.0.1").add("::1");
  const seen = new Map();
  return host => {
    host = bare(host);
    if (!seen.has(host))
      seen.set(
        host,
        resolve(host).then(
          list => (list.length && list.every(a => own.has(a) || !privateIp(a)) ? list : null),
          () => null,
        ),
      );
    return seen.get(host);
  };
}

/** A local proxy for every request a guarded Chrome makes. It connects only to the address it checked, so a name can't
 * pass the check and then resolve elsewhere. Returns null when HTTPS_PROXY or HTTP_PROXY is set, since the guard
 * doesn't chain to another proxy; add that if the guard is needed behind a company proxy. */
export async function startGuard(siteUrl, { dns = lookup, env = process.env } = {}) {
  if (chromeProxyArgs(env).length) return null;
  const check = await addressCheck(siteUrl, { dns }),
    blocked = [],
    sockets = new Set();
  const refuse = what => {
    if (blocked.length < 100) blocked.push(what);
  };
  let closed = false; // a request still being checked when Chrome hangs up or the guard closes opens nothing
  // Node connects to the checked addresses only, trying each in turn (localhost may be ::1 or 127.0.0.1).
  const pinned = list => (name, opts, cb) =>
    opts?.all
      ? cb(
          null,
          list.map(address => ({ address, family: isIP(address) })),
        )
      : cb(null, list[0], isIP(list[0]));
  const server = createServer(async (req, res) => {
    let u, ips;
    try {
      u = new URL(req.url);
      ips = /^http:$/.test(u.protocol) && (await check(u.hostname));
    } catch {}
    if (closed || res.destroyed) return res.destroy();
    if (!ips) {
      if (u) refuse(u.href);
      res
        .writeHead(403, { "content-type": "text/plain" })
        .end("seo-supervisor: not a public address, so the browser may not load it");
      return;
    }
    const headers = { ...req.headers };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const up = httpRequest(
      {
        host: u.hostname.replace(/^\[|\]$/g, ""),
        port: u.port || 80,
        lookup: pinned(ips),
        method: req.method,
        path: u.pathname + u.search,
        headers,
        setHost: false,
      },
      r => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    up.on("error", () => res.destroy());
    res.on("close", () => up.destroy());
    req.pipe(up);
  });
  server.on("connect", async (req, sock, head) => {
    let target, ips, up;
    sockets.add(sock);
    sock
      .on("close", () => {
        sockets.delete(sock);
        up?.destroy();
      })
      .on("error", () => {});
    try {
      target = new URL(`http://${req.url}`);
      ips = await check(target.hostname);
    } catch {}
    if (closed || sock.destroyed) return sock.destroy();
    if (!ips) {
      refuse(req.url);
      sock.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    up = connect(
      { host: target.hostname.replace(/^\[|\]$/g, ""), port: Number(target.port) || 443, lookup: pinned(ips) },
      () => {
        sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        up.write(head);
        up.pipe(sock).on("error", () => {});
        sock.pipe(up);
      },
    );
    up.on("close", () => sock.destroy()).on("error", () => sock.destroy());
  });
  await /** @type {Promise<void>} */ (new Promise(ok => server.listen(0, "127.0.0.1", ok)));
  server.unref(); // a guard left open never keeps the process alive
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  return {
    port,
    blocked,
    args: [
      `--proxy-server=http://127.0.0.1:${port}`,
      `--proxy-bypass-list=<-loopback>;${new URL(siteUrl).host}`,
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    ],
    close: () => {
      closed = true;
      for (const s of sockets) s.destroy();
      server.closeAllConnections();
      return new Promise(ok => server.close(() => ok()));
    },
  };
}

// The DOM after scripts ran, behind the guard, from a throwaway profile so a running browser isn't touched. No switch
// turns service workers off, so the guard checks their requests and WebSockets, and each profile is deleted after use
// so a worker never runs again. Errors are redacted because Chrome's command line names the temporary profile, under
// the home folder.
/**
 * @param {string} browser
 * @param {string} url
 * @param {{ timeoutMs?: number, dns?: typeof lookup }} [options] */
export async function renderPage(browser, url, { timeoutMs = 20000, dns } = {}) {
  const profile = quietProfile(mkdtempSync(join(tmpdir(), "seo-supervisor-render-")));
  const guard = await startGuard(url, { dns });
  const args = renderArgs(profile, url, {}, guard?.args);
  try {
    return await new Promise((ok, fail) =>
      execFile(browser, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        const why = err ? null : chromeError(stdout, stderr),
          gate = err || why ? null : gateOf(stdout);
        if (err) {
          err.message = redact(err.message);
          err.stderr = stderr;
          fail(err);
        } else if (why) fail(Object.assign(new Error(redact(`Chrome couldn't load ${url}: ${why}`)), { stderr }));
        else if (gate)
          fail(new Error(redact(`Chrome showed ${gate} at ${url}, so it wasn't compared with the raw HTML`)));
        else ok(stdout);
      }),
    );
  } finally {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
    await guard?.close();
  }
}

// A page takes a browser start and up to 5 s of virtual time, about 5 s on a typical site. The cap keeps a
// --render all run near a quarter of an hour.
export const RENDER_SECONDS_PER_PAGE = 5,
  RENDER_ALL_CAP = 200;

/** The pages for --render all, home first. note says how many the cap left out, or is null.
 * @param {string[]} urls
 * @param {{ max?: number, log?: (message: string) => void }} [options] */
export function renderAll(urls, { max = RENDER_ALL_CAP, log = () => {} } = {}) {
  const home = u => new URL(u).pathname === "/";
  const list = [...urls].sort((a, b) => +home(b) - +home(a)).slice(0, max);
  const minutes = Math.max(1, Math.round((list.length * RENDER_SECONDS_PER_PAGE) / 60));
  log(
    `Rendering ${list.length} page${list.length === 1 ? "" : "s"} in the browser, about ${minutes} minute${minutes === 1 ? "" : "s"} (roughly ${RENDER_SECONDS_PER_PAGE} seconds a page), one at a time.`,
  );
  return {
    urls: list,
    note:
      urls.length > max
        ? `Rendering stopped at ${max} pages, the cap for --render all; ${urls.length - max} more page(s) weren't rendered.`
        : null,
  };
}

// Chrome's DOM dump writes characters out literally, so both sides are fully decoded before comparing.
const NAMED = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  middot: "·",
  bull: "•",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  aacute: "á",
  agrave: "à",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  ccedil: "ç",
  ouml: "ö",
  uuml: "ü",
  auml: "ä",
  szlig: "ß",
};
const decode = s =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return m;
      }
    })
    .replace(/&#(\d+);/g, (m, d) => {
      try {
        return String.fromCodePoint(Number(d));
      } catch {
        return m;
      }
    })
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/[\s ]+/g, " ")
    .trim();
const sameUrl = (a, b) => {
  try {
    return new URL(a, "https://x.invalid/").href === new URL(b, "https://x.invalid/").href;
  } catch {
    return a === b;
  }
};
const attrsOf = tag =>
  Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [
      m[1].toLowerCase(),
      m[2] ?? m[3] ?? m[4],
    ]),
  );
function read(html) {
  const tags = name => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map(m => attrsOf(m[0]));
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return {
    title: title ? decode(title[1]) : null,
    canonical: (c => (c == null ? null : decode(c)))(
      tags("link").find(l => (l.rel || "").toLowerCase().split(/\s+/).includes("canonical"))?.href,
    ),
    robots:
      tags("meta")
        .find(m => (m.name || "").toLowerCase() === "robots")
        ?.content?.toLowerCase()
        .replace(/\s+/g, "") ?? null,
    description: (c => (c == null ? null : decode(c)))(
      tags("meta").find(m => (m.name || "").toLowerCase() === "description")?.content,
    ),
    h1: h1 ? decode(h1[1].replace(/<[^>]+>/g, " ")) : null,
    jsonld: (html.match(/<script\b[^>]*application\/ld\+json/gi) || []).length,
    links: (html.match(/<a\b[^>]*\bhref\s*=/gi) || []).length,
  };
}

export function compareRendered(rawHtml, renderedHtml) {
  const a = read(rawHtml),
    b = read(renderedHtml),
    out = [];
  for (const field of ["title", "canonical", "robots", "description", "h1"]) {
    const same =
      field === "canonical" && a.canonical && b.canonical
        ? sameUrl(a.canonical, b.canonical)
        : (a[field] ?? "") === (b[field] ?? "");
    if (!same) out.push({ field, raw: a[field], rendered: b[field] });
  }
  if (b.jsonld > a.jsonld) out.push({ field: "jsonld-count", raw: a.jsonld, rendered: b.jsonld });
  // At least 10 more, since a consent banner in a fresh profile adds a few.
  if (b.links > a.links * 1.5 && b.links - a.links >= 10)
    out.push({ field: "link-count", raw: a.links, rendered: b.links });
  return out;
}
// An H1 only JavaScript adds is render-adds-content's, with the JSON-LD, words and link count.
export const changesHead = x => ["title", "canonical", "robots"].includes(x.field);
export const changesText = x => x.field === "description" || (x.field === "h1" && !!x.raw);

// A login screen or paywall where the page should be, or null; never filled in or clicked through. A login needs the
// title or H1 to say so, so a login box in the header doesn't count. tp-modal and tp-backdrop are Piano's paywall.
// https://developers.google.com/search/docs/appearance/structured-data/paywalled-content
export function gateOf(html) {
  const markup = html.replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, " ");
  const text = re => (markup.match(re)?.[1] || "").replace(/<[^>]+>/g, " ");
  if (
    /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(markup) &&
    /\b(log ?in|sign ?in)\b/i.test(
      `${text(/<title\b[^>]*>([\s\S]*?)<\/title>/i)} ${text(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)}`,
    )
  )
    return "a login screen";
  if (/"isAccessibleForFree"\s*:\s*(false|"false")/i.test(html))
    return "a paywall (its structured data says isAccessibleForFree: false)";
  if (/<[a-z][^>]*\s(?:id|class)\s*=\s*["'][^"']*\b(?:paywall|regwall|tp-modal|tp-backdrop)\b/i.test(markup))
    return "a paywall";
  return null;
}
