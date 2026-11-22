// @ts-check
// Crawler benchmark on a local synthetic site, with default options and production pauses under the offline guard.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { serveSite } from "./serve.mjs";

const run = promisify(execFile);
// --delay is ms before each HTML answer; --cpu-prof writes a .cpuprofile to open in Chrome DevTools.
const { values: o } = parseArgs({
  options: {
    pages: { type: "string", default: "500" },
    delay: { type: "string", default: "0" },
    concurrency: { type: "string" },
    "cpu-prof": { type: "boolean" },
  },
});
const HERE = new URL(".", import.meta.url),
  ROOT = new URL("../../", HERE);
const at = rel => new URL(rel, ROOT).pathname.replace(/^\/(\w:)/, "$1");
const site = join(tmpdir(), `seo-supervisor-bench-${o.pages}`),
  work = mkdtempSync(join(tmpdir(), "seo-supervisor-bench-run-"));
if (!existsSync(join(site, "sitemap.xml")))
  console.log((await run(process.execPath, [at("test/bench/make-site.mjs"), o.pages, site])).stdout.trim());

// Preloaded into the crawl process, which writes its own CPU time, peak memory and wall time on exit.
const stats = join(work, "stats.json");
const STATS =
  "data:text/javascript," +
  encodeURIComponent(`import { writeFileSync } from "node:fs";
process.on("exit", () => { const u = process.cpuUsage(); writeFileSync(${JSON.stringify(stats)}, JSON.stringify({ wall: performance.now(), cpu: (u.user + u.system) / 1000, rss: process.resourceUsage().maxRSS / 1024 })); });`);
const server = await serveSite(site, { delay: Number(o.delay) });
const prof = join(work, "profile"),
  out = join(work, "seo-crawl.json");
try {
  const args = [
    "--import",
    pathToFileURL(at("test/offline.mjs")).href,
    "--import",
    STATS,
    ...(o["cpu-prof"] ? ["--cpu-prof", "--cpu-prof-dir", prof] : []),
    at("skills/seo-supervisor/scripts/seo-crawl.mjs"),
    "--url",
    server.url,
    "--site-origin",
    "https://www.perf-example.com",
    "--max",
    String(Math.max(1000, Number(o.pages))),
    "--out",
    out,
    ...(o.concurrency ? ["--concurrency", o.concurrency] : []),
  ];
  await run(process.execPath, args, {
    env: { ...process.env, SEO_SUPERVISOR_NO_PAUSES: "" },
    maxBuffer: 64 * 1024 * 1024,
  });
} finally {
  await server.close();
}
const s = JSON.parse(readFileSync(stats, "utf8")),
  crawl = JSON.parse(readFileSync(out, "utf8"));
const sec = ms => `${(ms / 1000).toFixed(1)} s`;
console.log(
  `pages: ${crawl.stats?.htmlPages ?? crawl.pages?.length} crawled (site of ${o.pages}), delay ${o.delay} ms, concurrency ${crawl.options?.concurrency}`,
);
console.log(
  `wall ${sec(s.wall)} · CPU ${sec(s.cpu)} · peak memory ${Math.round(s.rss)} MB · requests ${server.counts.requests} (${server.counts.html} HTML, ${server.counts.ranges} range)`,
);
if (o["cpu-prof"]) console.log(`CPU profile: ${prof}`);
console.log(`crawl output: ${out}`);
