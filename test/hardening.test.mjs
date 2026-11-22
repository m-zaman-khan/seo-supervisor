// @ts-check
// Edge cases: capped agent-file reads, a redirecting home page, --help, secrets in crawled URLs, old finding ids.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { Readable, pipeline } from "node:stream";
import { createGzip } from "node:zlib";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { hideSecrets, redact } from "../skills/seo-supervisor/scripts/lib/redact.mjs";
import { findingsOf } from "../skills/seo-supervisor/scripts/lib/score.mjs";

const COPY =
  "Our engineers repair boilers, radiators, pumps and leaking pipes across Leeds, Bradford, Harrogate and York. ".repeat(
    8,
  );
const page = (title, body = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="About ${title} in Leeds"></head><body><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;
const pathOf = u => new URL(u, "http://x").pathname;
const MEMORY =
  "data:text/javascript," +
  encodeURIComponent(`import { writeFileSync } from "node:fs";
process.on("exit", () => { if (process.env.TEST_RSS_FILE) writeFileSync(process.env.TEST_RSS_FILE, String(process.resourceUsage().maxRSS)); });`);

// The site's pages (path -> HTML) on the test server, and before(req, res) for anything else; the crawl's JSON.
async function crawlSite(pages, { before, url = "/", args = [], env = {} } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir, { before });
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url + url, "--out", out, ...args], {
      env: { ...process.env, ...env },
    });
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}

test("an agent file that's a gzip bomb (1 GB of spaces at /.well-known/agent-card.json) is read up to 1 MB: the crawl stays small", async t => {
  const before = (req, res) => {
    const p = pathOf(req.url);
    if (p === "/.well-known/api-catalog")
      return !!res.writeHead(200, { "Content-Type": "application/linkset+json" }).end('{"linkset":[]}');
    if (p !== "/.well-known/agent-card.json") return false;
    res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    const spaces = Buffer.alloc(1 << 16, 32);
    pipeline(
      Readable.from(
        (function* () {
          for (let i = 0; i < (1 << 30) / spaces.length; i++) yield spaces;
        })(),
      ),
      createGzip({ level: 1 }),
      res,
      () => {},
    );
    return true;
  };
  const rss = join(tmp(), "rss.txt");
  const r = await crawlSite(
    { "/": page("Boiler repairs in Leeds") },
    {
      before,
      args: ["--concurrency", "1"],
      env: { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${MEMORY}`.trim(), TEST_RSS_FILE: rss },
    },
  );
  assert.deepEqual(
    r.agents.wellKnown,
    ["/.well-known/api-catalog"],
    "a small file is still read; the bomb isn't a file",
  );
  const mb = Number(readFileSync(rss, "utf8")) / 1024;
  t.diagnostic(`peak memory ${Math.round(mb)} MB`);
  assert.ok(mb < 400, `peak memory ${Math.round(mb)} MB`);
});
