// @ts-check
// The benchmark's static server: keep-alive, Range requests, files cached in memory, request counts, and an optional
// delay before each HTML answer to mimic a slower server.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".css": "text/css",
  ".js": "text/javascript",
};

/** @param {string} root @param {{ delay?: number }} [opts] delay: ms before each HTML answer */
export function serveSite(root, { delay = 0 } = {}) {
  const cache = new Map(),
    counts = { requests: 0, html: 0, ranges: 0 };
  const server = createServer((req, res) => {
    counts.requests++;
    const path = decodeURIComponent(new URL(req.url || "/", "http://x").pathname);
    const done = (status, headers, body) => {
      const html = /html/.test(headers["Content-Type"] || "");
      if (html) counts.html++;
      const send = () => res.writeHead(status, headers).end(req.method === "HEAD" ? undefined : body);
      if (delay && html) setTimeout(send, delay);
      else send();
    };
    let file = normalize(join(root, path));
    if (!file.startsWith(normalize(root))) return done(400, {}, "");
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!path.endsWith("/")) return done(301, { Location: path + "/" }, "");
      file = join(file, "index.html");
    }
    if (!existsSync(file))
      return done(404, { "Content-Type": TYPES[".html"] }, "<!doctype html><title>Not found</title><h1>Not found</h1>");
    let body = cache.get(file);
    if (!body) cache.set(file, (body = readFileSync(file)));
    const base = {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    };
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    if (m) {
      counts.ranges++;
      const s = +m[1],
        e = Math.min(m[2] ? +m[2] : body.length - 1, body.length - 1);
      return done(
        206,
        { ...base, "Content-Range": `bytes ${s}-${e}/${body.length}`, "Content-Length": e - s + 1 },
        body.subarray(s, e + 1),
      );
    }
    done(200, { ...base, "Content-Length": body.length }, body);
  });
  server.keepAliveTimeout = 30000;
  return new Promise(ok =>
    server.listen(0, "127.0.0.1", () =>
      ok({
        url: `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`,
        counts,
        close: () => {
          server.closeAllConnections();
          return new Promise(c => server.close(() => c(null)));
        },
      }),
    ),
  );
}
