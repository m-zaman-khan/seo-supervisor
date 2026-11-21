// Optional Lighthouse runs, an outside check: Chrome loads each page and runs its scripts, analytics included.
// No findings: its SEO audits repeat the crawler's, its lab metrics aren't the field data PERF-01 asks for, and no rule
// covers its accessibility or best-practices audits.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { labLcpParts, labLcpElement } from "./speed.mjs";
import { containerArgs } from "../lib/cdp.mjs";
import { chromeProxyArgs } from "../lib/proxy.mjs";
import { redact } from "../lib/redact.mjs";
import { startGuard } from "./render.mjs";
import { toolsDir } from "../lib/settings-dir.mjs";

const CATEGORIES = {
  performance: "performance",
  seo: "seo",
  accessibility: "accessibility",
  bestPractices: "best-practices",
};
const METRICS = {
  lcp: "largest-contentful-paint",
  cls: "cumulative-layout-shift",
  tbt: "total-blocking-time",
  fcp: "first-contentful-paint",
  speedIndex: "speed-index",
};

/** LIGHTHOUSE_PATH, then the installer's copy in the settings tools folder, then lighthouse on PATH; null if none. */
export function findLighthouse(env = process.env, home = homedir(), platform = process.platform) {
  const exe = platform === "win32" ? "lighthouse.cmd" : "lighthouse";
  const path = (env.PATH ?? env.Path ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map(d => join(d, exe));
  return (
    [env.LIGHTHOUSE_PATH, join(toolsDir(env, home), "node_modules", ".bin", exe), ...path].find(
      p => p && existsSync(p),
    ) || null
  );
}

// Windows can't start a .cmd without a shell, so an npm shim is followed to its script, run with this Node. Other .cmd
// wrappers fail to start; pointing LIGHTHOUSE_PATH at the script itself gets around that.
function command(bin) {
  const js = /\.cmd$/i.test(bin) ? readFileSync(bin, "utf8").match(/"%~?dp0%?\\([^"]+\.[cm]?js)"/i)?.[1] : null;
  if (js) return [process.execPath, [join(dirname(bin), js)]];
  return /\.[cm]?js$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
}

// The files or page elements an audit's details.items point at, each once, up to 10. An insight's "list" nests its
// tables.
const UNSCORED = new Set(["informative", "notApplicable", "manual", "error"]);
const rowsOf = d => (Array.isArray(d?.items) ? d.items.flatMap(i => (Array.isArray(i?.items) ? i.items : [i])) : []);
const filesOf = d =>
  [
    ...new Set(
      rowsOf(d)
        .map(i => [i?.url, i?.source?.url, i?.node?.selector].find(s => typeof s === "string" && s))
        .filter(Boolean),
    ),
  ]
    .slice(0, 10)
    .map(s => s.slice(0, 300));

function parse(lhr, url) {
  const cats = lhr.categories || {},
    audits = lhr.audits || {};
  const failed = [],
    detail = new Map();
  for (const c of Object.values(cats)) {
    const total = c.auditRefs.reduce((s, r) => s + r.weight, 0) || 1;
    for (const r of c.auditRefs) {
      const a = audits[r.id];
      if (typeof a?.score !== "number" || a.score >= 0.9) continue;
      const cost = (r.weight * (1 - a.score)) / total;
      if (r.weight > 0) failed.push({ id: r.id, title: a.title, category: c.title, cost });
      // Every failed audit, weighted or not: most opportunities and diagnostics weigh nothing but name the files.
      if (!detail.has(r.id) && !UNSCORED.has(a.scoreDisplayMode))
        detail.set(r.id, {
          id: r.id,
          title: a.title,
          category: c.title,
          cost,
          score: a.score,
          items: filesOf(a.details),
        });
    }
  }
  const map = (o, f) => Object.fromEntries(Object.entries(o).map(([k, id]) => [k, f(id)]));
  return {
    url,
    scores: map(CATEGORIES, id => (cats[id]?.score == null ? null : Math.round(cats[id].score * 100))),
    metrics: map(METRICS, id => audits[id]?.numericValue ?? null),
    lcpParts: labLcpParts(audits),
    lcpElement: labLcpElement(audits),
    // Each audit at 0.9 or more counts once, as Lighthouse's "Passed audits" list counts them.
    passed: new Set(
      Object.values(cats)
        .flatMap(c => c.auditRefs.map(r => r.id))
        .filter(id => audits[id]?.score >= 0.9 && !UNSCORED.has(audits[id].scoreDisplayMode)),
    ).size,
    version: typeof lhr.lighthouseVersion === "string" ? lhr.lighthouseVersion : null,
    // By points lost in the category, so a heavy metric that nearly passes ranks below a light audit that fails.
    failed: failed
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5)
      .map(({ cost, ...f }) => f),
    // The same order, then the weightless audits, lowest score first.
    detail: [...detail.values()].sort((a, b) => b.cost - a.cost || a.score - b.score).map(({ cost, score, ...d }) => d),
  };
}

// ---------- the Agentic browsing category ----------
// Lighthouse 13.3 added the experimental agentic-browsing category: it needs Chrome 150 or later and has no 0–100
// score. Lighthouse refuses a category it doesn't know, so it's asked for only when the package.json above the bin's
// script says 13.3 or later.
// https://developer.chrome.com/docs/lighthouse/agentic-browsing
import { realpathSync } from "node:fs";
const AGENTIC = "agentic-browsing";
export function agenticFlag(bin) {
  try {
    for (let dir = dirname(realpathSync(command(bin)[1][0] ?? bin)), i = 0; i < 4; i++, dir = dirname(dir)) {
      const p = join(dir, "package.json");
      const pkg = existsSync(p) && JSON.parse(readFileSync(p, "utf8"));
      if (pkg?.name !== "lighthouse") continue;
      const [major, minor] = String(pkg.version).split(".").map(Number);
      return major > 13 || (major === 13 && minor >= 3) ? "," + AGENTIC : "";
    }
  } catch {}
  return "";
}
/** Checks passed out of those that count, and the failed ones, as Lighthouse's report-utils.js counts them: a pass is
 * 0.9 or more, and manual, not-applicable and informative audits don't count. Null without the category. It's removed
 * from lhr so its audits don't join the scored categories' failed audits. */
export function takeAgentic(lhr) {
  const c = lhr?.categories?.[AGENTIC];
  if (!c) return null;
  delete lhr.categories[AGENTIC];
  const counted = (c.auditRefs || [])
    .filter(r => r.group !== "hidden")
    .map(r => ({ id: r.id, ...lhr.audits?.[r.id] }))
    .filter(a => !["manual", "notApplicable", "informative"].includes(a.scoreDisplayMode));
  const failed = counted.filter(a => a.scoreDisplayMode === "error" || !(Number(a.score) >= 0.9));
  return {
    passed: counted.length - failed.length,
    total: counted.length,
    failed: failed.map(a => ({ id: a.id, title: String(a.title ?? a.id) })),
  };
}

/** One Lighthouse run on its defaults (mobile, simulated throttling) with a throwaway Chrome profile. Chrome gets
 * launchChrome's container flags and the render guard instead of proxy flags, so the page can't steer it to a private
 * or cloud-metadata address; with a configured proxy, that proxy's flags instead. host ({ platform, uid, env, exists })
 * is for tests. Failure messages are redacted. */
export async function runLighthouse(bin, url, { chromePath, timeoutMs = 90000, host = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "seo-supervisor-lighthouse-")),
    report = join(dir, "report.json");
  const [file, pre] = command(bin);
  const guard = await startGuard(url, { env: host.env ?? process.env });
  const chromeFlags = [
    "--headless=new",
    ...containerArgs(host),
    ...(guard?.args || chromeProxyArgs(host.env)),
    `--user-data-dir="${join(dir, "profile")}"`,
  ].join(" ");
  const args = [
    ...pre,
    url,
    "--output=json",
    `--output-path=${report}`,
    "--quiet",
    `--chrome-flags=${chromeFlags}`,
    `--only-categories=performance,seo,accessibility,best-practices${agenticFlag(bin)}`,
  ];
  const env = chromePath ? { ...process.env, CHROME_PATH: chromePath } : process.env;
  // A timeout kills Lighthouse but can leave its Chrome running on Windows, and the profile then stays in the temp
  // folder. Killing the whole process tree would fix both.
  try {
    return await new Promise((ok, fail) =>
      execFile(file, args, { env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        let lhr = null;
        try {
          lhr = JSON.parse(readFileSync(report, "utf8"));
        } catch {}
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
        const why = lhr?.runtimeError?.message || (err && (String(stderr).trim().split("\n").pop() || err.message));
        if (why || !lhr) fail(new Error(redact(String(why || "Lighthouse wrote no report")).slice(0, 200)));
        else {
          const agentic = takeAgentic(lhr);
          ok({ ...parse(lhr, url), ...(agentic ? { agentic } : {}) });
        }
      }),
    );
  } finally {
    await guard?.close();
  }
}

// A run takes about 15–25 s a page on a laptop, longer for heavy pages (the timeout is 90 s). ALL_CAP keeps an
// all-pages run near an hour.
export const SECONDS_PER_PAGE = 20,
  ALL_CAP = 200;

/** Up to 5 sample pages, or with `all` every page up to max, home first. One at a time, since parallel runs skew each
 * other's timings. log gets the time estimate before the first run. */
export async function checkLighthouse(
  bin,
  urls,
  { chromePath, all = false, max = all ? ALL_CAP : 5, log = () => {} } = {},
) {
  const home = u => new URL(u).pathname === "/";
  const sample = [...urls].sort((a, b) => home(b) - home(a)).slice(0, max);
  const minutes = Math.max(1, Math.round((sample.length * SECONDS_PER_PAGE) / 60));
  log(
    `Lighthouse: ${sample.length} page${sample.length === 1 ? "" : "s"}, about ${minutes} minute${minutes === 1 ? "" : "s"} (roughly ${SECONDS_PER_PAGE} seconds a page), one at a time.`,
  );
  const results = [],
    failures = [];
  for (const url of sample) {
    try {
      results.push(await runLighthouse(bin, url, { chromePath }));
    } catch (e) {
      failures.push(`${new URL(url).pathname}: ${e.message.split("\n")[0]}`);
      if (!results.length) break; // the first page failing usually means Lighthouse or Chrome can't start
    }
  }
  const tried = results.length + failures.length;
  const failed = failures.length
    ? ` Failed: ${failures.slice(0, 5).join("; ")}${failures.length > 5 ? ` and ${failures.length - 5} more` : ""}`
    : "";
  const notes = [
    `Lighthouse ran on ${results.length} of ${tried} ${all ? "" : "sample "}page(s) (mobile, simulated throttling).${failed}`,
  ];
  if (all && urls.length > max)
    notes.push(
      `Lighthouse stopped at ${max} pages, ${max === ALL_CAP ? "its cap for a run on every page" : "the number asked for"}; ${urls.length - max} more page(s) weren't run.`,
    );
  return { results, notes };
}

/** The median score per category across the runs that have one (the middle two's mean, rounded, for an even count). */
export function medianScores(results) {
  const mid = xs => {
    const s = [...xs].sort((a, b) => a - b),
      h = s.length >> 1;
    return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2);
  };
  return {
    pages: results.length,
    ...Object.fromEntries(
      Object.keys(CATEGORIES)
        .map(k => [k, results.map(r => r.scores?.[k]).filter(Number.isFinite)])
        .filter(([, xs]) => xs.length)
        .map(([k, xs]) => [k, mid(xs)]),
    ),
  };
}
