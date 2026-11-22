// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { gzipSync } from "node:zlib";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { createFetcher, pinnedFetch } from "../skills/seo-supervisor/scripts/crawl/fetch.mjs";
import { findSitemaps } from "../skills/seo-supervisor/scripts/checks/sitemap.mjs";
import { bodyUpTo } from "../skills/seo-supervisor/scripts/lib/http.mjs";

const COPY =
  "Our engineers repair boilers, radiators, pumps and leaking pipes across Leeds, Bradford, Harrogate and York. Every visit starts with a written estimate, careful diagnosis and honest advice about replacement versus repair.";
const page = (title, body = "", head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;
const pathOf = u => new URL(u, "http://x").pathname;
const urlset = locs =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map(l => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000100000001008060000001ff3ff61", "hex");
// Resolves with "hang" when p hasn't settled in ms.
const within = (p, ms) =>
  Promise.race([
    p.then(
      v => ({ v }),
      e => ({ e }),
    ),
    new Promise(ok => setTimeout(ok, ms, "hang")),
  ]);
async function listen(handler) {
  const server = createServer(handler);
  await new Promise(ok => server.listen(0, "127.0.0.1", () => ok(null)));
  const origin = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  return {
    origin,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
// The site's pages (path -> HTML) on the test server, robots.txt, and before(req, res) for anything else; the crawl
// JSON and the crawler's stdout.
async function crawlSite(pages, { robots = "User-agent: *\nAllow: /\n", args = [], env = {}, before, files } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), robots);
  const site = await serve(dir, { before, files });
  let stdout;
  try {
    ({ stdout } = await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--out", out, ...args], {
      env: { ...process.env, ...env },
    }));
  } finally {
    await site.close();
  }
  return { r: JSON.parse(readFileSync(out, "utf8")), stdout: String(stdout) };
}

// A gzip body that stops halfway (the server stalls, or drops the connection) must end the read, not hang it.
const HALF_GZIP = gzipSync(randomBytes(100000)).subarray(0, 2000);
test("an off-site gzip answer that stalls halfway is read no further once the request's time is up", async () => {
  const site = await listen((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" });
    res.write(HALF_GZIP);
  });
  try {
    const t = Date.now(),
      res = await pinnedFetch(site.origin + "/", { headers: {}, signal: AbortSignal.timeout(300) }, undefined);
    const got = await within(bodyUpTo(res, 1 << 20), 3000);
    assert.notEqual(got, "hang", "the body read was still waiting 3 s after the request's 300 ms timeout");
    assert.ok(got.e, "the read fails rather than returning half a body");
    assert.ok(Date.now() - t < 3000);
  } finally {
    site.close();
  }
});

test("an off-site gzip answer whose connection drops halfway gives a failed request, not a crawl that waits forever", async () => {
  let hits = 0;
  const site = await listen((req, res) => {
    hits++;
    res.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" });
    res.write(HALF_GZIP);
    setTimeout(() => req.socket.destroy(), 100);
  });
  try {
    // Off the crawled site (another host), so the request goes through the pinned connection.
    const { get } = createFetcher({ startOrigin: "https://site.example", ua: "test", toCrawl: u => u });
    const got = await within(get(site.origin + "/"), 5000);
    assert.notEqual(got, "hang", "get() was still waiting 5 s after the connection dropped");
    assert.equal(got.v.status, 0, JSON.stringify(got.v));
    assert.equal(hits, 2, "asked once more after the drop, as for any failed request");
  } finally {
    site.close();
  }
});
