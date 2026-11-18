// Static server for the fixture site that answers like a real one: a directory URL without its slash 301s,
// directories serve index.html, and anything missing is a real 404.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8" };

// headers: extra response headers by path; files: generated files by path ({ type, body });
// markdown: a Markdown body by path, served when the request asks for text/markdown.
// before(req, res): return true when it has answered the request itself.
export function serve(root, { headers = {}, files = {} } = {}) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = normalize(join(root, path));
    if (!file.startsWith(normalize(root))) {
      res.writeHead(400).end();
      return;
    }
    const extra = headers[path] || {};
    if (files[path]) {
      res
        .writeHead(200, { "Content-Type": files[path].type, "Content-Length": files[path].body.length, ...extra })
        .end(files[path].body);
      return;
    }
    try {
      const s = await stat(file);
      if (s.isDirectory()) {
        if (!path.endsWith("/")) {
          res.writeHead(301, { Location: path + "/" }).end();
          return;
        }
        const body = await readFile(join(file, "index.html"));
        res.writeHead(200, { "Content-Type": TYPES[".html"], ...extra }).end(body);
        return;
      }
      res
        .writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" })
        .end(await readFile(file));
    } catch {
      res
        .writeHead(404, { "Content-Type": TYPES[".html"] })
        .end("<!doctype html><title>Not found</title><h1>Not found</h1>");
    }
  });
  return new Promise(ok =>
    server.listen(0, "127.0.0.1", () =>
      ok({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(c => server.close(c)) }),
    ),
  );
}
