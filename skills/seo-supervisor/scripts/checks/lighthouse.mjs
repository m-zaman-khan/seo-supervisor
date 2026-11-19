// Optional Lighthouse runs, an outside check: Chrome loads each page and runs its scripts, analytics included.
// No findings: its SEO audits repeat the crawler's, its lab metrics aren't the field data PERF-01 asks for, and no rule
// covers its accessibility or best-practices audits.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

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
    [env.LIGHTHOUSE_PATH, join(home, ".seo-supervisor", "tools", "node_modules", ".bin", exe), ...path].find(
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

function parse(lhr, url) {
  const cats = lhr.categories || {},
    audits = lhr.audits || {};
  const failed = [];
  for (const c of Object.values(cats)) {
    const total = c.auditRefs.reduce((s, r) => s + r.weight, 0) || 1;
    for (const r of c.auditRefs) {
      const a = audits[r.id];
      if (r.weight > 0 && typeof a?.score === "number" && a.score < 0.9)
        failed.push({ id: r.id, title: a.title, category: c.title, cost: (r.weight * (1 - a.score)) / total });
    }
  }
  const map = (o, f) => Object.fromEntries(Object.entries(o).map(([k, id]) => [k, f(id)]));
  return {
    url,
    scores: map(CATEGORIES, id => (cats[id]?.score == null ? null : Math.round(cats[id].score * 100))),
    metrics: map(METRICS, id => audits[id]?.numericValue ?? null),
    // By points lost in the category, so a heavy metric that nearly passes ranks below a light audit that fails.
    failed: failed
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5)
      .map(({ cost, ...f }) => f),
  };
}

/** One Lighthouse run on its defaults (mobile, simulated throttling) with a throwaway Chrome profile. */
export function runLighthouse(bin, url, { chromePath, timeoutMs = 90000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "seo-supervisor-lighthouse-")),
    report = join(dir, "report.json");
  const [file, pre] = command(bin);
  const args = [
    ...pre,
    url,
    "--output=json",
    `--output-path=${report}`,
    "--quiet",
    `--chrome-flags=--headless=new --user-data-dir="${join(dir, "profile")}"`,
    "--only-categories=performance,seo,accessibility,best-practices",
  ];
  const env = chromePath ? { ...process.env, CHROME_PATH: chromePath } : process.env;
  // A timeout kills Lighthouse but can leave its Chrome running on Windows, and the profile then stays in the temp
  // folder. Killing the whole process tree would fix both.
  return new Promise((ok, fail) =>
    execFile(file, args, { env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      let lhr = null;
      try {
        lhr = JSON.parse(readFileSync(report, "utf8"));
      } catch {}
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
      const why = lhr?.runtimeError?.message || (err && (String(stderr).trim().split("\n").pop() || err.message));
      if (why || !lhr) fail(new Error(String(why || "Lighthouse wrote no report").slice(0, 200)));
      else ok(parse(lhr, url));
    }),
  );
}

/** Up to 5 sample pages, home first. One at a time, since parallel runs skew each other's timings. */
export async function checkLighthouse(bin, urls, { chromePath, max = 5 } = {}) {
  const home = u => new URL(u).pathname === "/";
  const sample = [...urls].sort((a, b) => home(b) - home(a)).slice(0, max);
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
  const notes = [
    `Lighthouse ran on ${results.length} of ${tried} sample page(s) (mobile, simulated throttling).${failures.length ? ` Failed: ${failures.join("; ")}` : ""}`,
  ];
  return { results, notes };
}
