// The helpers are copies of crawl.test.mjs's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "../serve.mjs";
import { SCRIPTS, node, tmp } from "../helpers.mjs";
import { findBrowser } from "../../skills/seo-supervisor/scripts/checks/render.mjs";

// Pages ({ "/path/": html }) in a temp folder, crawled as the site at `origin`; `args` and `env` go to the crawler.
async function crawlSite(pages, serveOpts, origin = "https://site.example", { args = [], env } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir, serveOpts);
  try {
    await node(
      [join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--site-origin", origin, "--out", out, ...args],
      env ? { env } : {},
    );
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
// Outside checks with a closed local port standing in for PageSpeed, so nothing leaves the machine.
const OUTSIDE = ["--outside", "--psi-endpoint", "http://127.0.0.1:9/runPagespeed"];
// A plumber's site with one planted problem per page; every title ends in the brand, as most sites' titles do.
const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const plumber = (title, h1, body, { head = '<meta charset="utf-8">', bodyAttrs = "" } = {}) =>
  `<!doctype html><html lang="en"><head>${head}<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body${bodyAttrs}><main><h1>${h1}</h1><p>${COPY}</p>${body}</main></body></html>`;
// A clean two-page site; `head` goes into both pages' <head>, `body` into the home page's.
const two = (head = "", body = "") => ({
  "/": plumber(
    "Boiler Repairs and Servicing in Leeds",
    "Boiler repairs and servicing in Leeds",
    `<a href="/about/">About the team</a>${body}`,
    { head: `<meta charset="utf-8">${head}` },
  ),
  "/about/": plumber("About Our Leeds Engineers", "About our Leeds engineers", "", {
    head: `<meta charset="utf-8">${head}`,
  }),
});

test(
  "PERF-10 on a one-page site: Back needs a second page, so Chrome's test can't run",
  { skip: !findBrowser() && "Chrome not installed", timeout: 120000 },
  async () => {
    const r = await crawlSite({ "/": two()["/"].replace('<a href="/about/">About the team</a>', "") }, {}, undefined, {
      args: OUTSIDE,
    });
    assert.equal(r.stats.htmlPages, 1);
    assert.ok(!r.passed.some(p => p.rule === "PERF-10"));
    assert.match(r.notChecked.find(n => n.rule === "PERF-10")?.reason || "", /only one page could be tested/);
  },
);
