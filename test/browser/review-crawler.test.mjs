// With --outside and no CHROME_PATH the crawler renders in the installed Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "../serve.mjs";
import { SCRIPTS, node, tmp } from "../helpers.mjs";

const words =
  "This page has enough ordinary words in it to count as a real page with real content, not a thin placeholder, so the other checks can do their work on it without tripping over the length of the copy at all.";

test("render diff skips a page whose raw HTML couldn't be fetched again", async () => {
  // Every second request from the crawler to /flaky/ fails, so the re-fetch for the render diff gets a 500.
  let n = 0;
  const pages = {
    "/": `<!doctype html><html><head><title>Home page for the flaky test</title></head><body><main><h1>Home</h1><p>${words}</p><a href="/flaky/">flaky</a></main></body></html>`,
    "/flaky/": `<!doctype html><html><head><title>A page that fails on the second fetch</title></head><body><main><h1>Flaky</h1><p>${words}</p></main></body></html>`,
  };
  const dir = tmp();
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  const site = await serve(dir, {
    before: (req, res) => {
      if (req.url === "/flaky/" && /seo-supervisor-crawler/.test(req.headers["user-agent"] || "") && ++n === 2) {
        res.writeHead(500).end("error");
        return true;
      }
    },
  });
  const out = join(tmp(), "crawl.json");
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://site.example",
      "--outside",
      "--psi-endpoint",
      "http://127.0.0.1:9/r",
      "--out",
      out,
    ]);
  } finally {
    await site.close();
  }
  const r = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(!r.findings.some(f => f.check.startsWith("render-") && f.evidence.some(e => e.url.endsWith("/flaky/"))));
});
