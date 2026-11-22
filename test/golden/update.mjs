// @ts-check
// Writes the golden snapshots: the crawl JSON of fixture-site and fixture-zero (and of fixture-site without
// --site-origin, so the crawler finds the public origin itself), and the report rendered from kitchen-sink.json, an
// audit that fills every panel. A pure code move must leave them byte-identical, so whatever varies between runs is
// pinned or normalised:
// - Date is frozen at 2026-11-20 12:00 UTC (dates, durations, the 404 probe's name, checks against today), and
//   TZ=UTC as the report's dates are local;
// - --concurrency 1, as parallel requests finish in a different order each run;
// - the server's port, temp paths, response times, the tool's version, and the fonts' base64 (hashed).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "../../skills/seo-supervisor/scripts/lib/is-main.mjs";
import { serve } from "../serve.mjs";
import { ROOT, SCRIPTS, node, tmp } from "../helpers.mjs";

export const DIR = fileURLToPath(new URL(".", import.meta.url));
const CLOCK =
  "data:text/javascript," +
  encodeURIComponent(`const T = Date.parse("2026-11-20T12:00:00Z"), D = Date;
globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } };`);
const ENV = { ...process.env, TZ: "UTC", CHROME_PATH: process.execPath, PSI_API_KEY: "", CRUX_API_KEY: "" };
const CRAWLS = { "fixture-site": "https://example-security.com", "fixture-zero": "https://zero.example" };

const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const tmpPaths = [tmpdir(), tmpdir().replaceAll("\\", "/"), JSON.stringify(tmpdir()).slice(1, -1)];
const common = text => tmpPaths.reduce((t, p) => t.replaceAll(p, "<tmp>"), text).replaceAll(VERSION, "<version>");

// origin null: no --site-origin, so the crawler finds the public origin itself and changes it while it crawls; a module
// that kept an early copy would crawl or map the wrong URLs. served: the fixture server's options.
async function crawl(fixture, origin, served = {}) {
  const site = await serve(join(ROOT, "test", fixture), served),
    out = join(tmp(), "seo-crawl.json");
  try {
    await node(
      [
        "--import",
        CLOCK,
        join(SCRIPTS, "seo-crawl.mjs"),
        "--url",
        site.url,
        ...(origin ? ["--site-origin", origin] : []),
        "--concurrency",
        "1",
        "--out",
        out,
      ],
      { env: ENV },
    );
  } finally {
    await site.close();
  }
  const r = JSON.parse(readFileSync(out, "utf8").replaceAll(new URL(site.url).host, "127.0.0.1:<port>"));
  if (r.media?.serverTimes) Object.assign(r.media.serverTimes, { median: 0, p95: 0 });
  return common(JSON.stringify(r, null, 2)) + "\n";
}

async function report() {
  const out = join(tmp(), "kitchen-sink.html");
  await node(["--import", CLOCK, join(SCRIPTS, "render-report.mjs"), join(DIR, "kitchen-sink.json"), "--out", out], {
    env: ENV,
  });
  const fonts = s =>
    s.replace(
      /(base64,)([A-Za-z0-9+/=]{200,})/g,
      (_, p, b64) => `${p}<sha256 ${createHash("sha256").update(b64).digest("hex").slice(0, 16)}>`,
    );
  return {
    "kitchen-sink.html": common(fonts(readFileSync(out, "utf8"))),
    "kitchen-sink.md": common(readFileSync(out.replace(/\.html$/, ".md"), "utf8")),
  };
}

// fixture-site with no Sitemap: line in robots.txt and no /sitemap.xml, so the public origin comes from the home page's
// canonical, the last place the crawler looks: after the home page is crawled, while the crawl is under way.
const LATE_ORIGIN = {
  files: {
    "/robots.txt": {
      type: "text/plain; charset=utf-8",
      body: readFileSync(join(ROOT, "test", "fixture-site", "robots.txt"), "utf8").replace(/^Sitemap:.*\n?/gim, ""),
    },
  },
  before: (req, res) => new URL(req.url, "http://x").pathname === "/sitemap.xml" && !!res.writeHead(404).end(),
};

/** Every snapshot, by file name in test/golden/. */
export async function build() {
  const [site, zero, found, rendered] = await Promise.all([
    crawl("fixture-site", CRAWLS["fixture-site"]),
    crawl("fixture-zero", CRAWLS["fixture-zero"]),
    crawl("fixture-site", null, LATE_ORIGIN),
    report(),
  ]);
  return {
    "fixture-site.crawl.json": site,
    "fixture-zero.crawl.json": zero,
    "fixture-site-found-origin.crawl.json": found,
    ...rendered,
  };
}

if (isMain(import.meta.url)) {
  for (const [name, text] of Object.entries(await build())) {
    writeFileSync(join(DIR, name), text);
    console.log(`wrote test/golden/${name} (${text.length} characters)`);
  }
}
