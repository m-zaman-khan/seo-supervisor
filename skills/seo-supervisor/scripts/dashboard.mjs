#!/usr/bin/env node
// Several sites at a glance from local audits. Scores come from lib/score.mjs, so they match each seo-audit.html.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { buildRules, bandOf, isOpen, normalise, score, OWN_SCORE } from "./lib/score.mjs";
import { isMain } from "./lib/is-main.mjs";

const fmtDate = d => {
  const x = new Date(d);
  return d && !isNaN(x) ? x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
};
const plural = (n, w) => `${n} ${n === 1 ? w : w + "s"}`;

export function summaryOf(dir) {
  const file = [join(dir, "seo-audit.json"), join(dir, "seo-audit", "seo-audit.json")].find(f => existsSync(f));
  if (!file) return { dir, problem: "no seo-audit.json" };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { dir, problem: `${file} can't be read as JSON` };
  }
  const findings = normalise(raw.findings),
    passed = Array.isArray(raw.passed) ? raw.passed : [],
    open = findings.filter(isOpen);
  const s = score(buildRules(findings, passed)),
    count = sev => open.filter(f => f.severity === sev).length;
  return {
    dir,
    report: file.replace(/\.json$/i, ".html"),
    name: String(raw.site?.name || basename(dirname(resolve(file)))),
    url: typeof raw.site?.url === "string" ? raw.site.url : "",
    date: fmtDate(raw.run?.date),
    score: s,
    open: open.length,
    blockers: count("blocker"),
    high: count("high"),
    unlock: s?.cap ? score(buildRules(findings, passed, { assume: f => f.severity === "blocker" })) : null,
    regressions: Array.isArray(raw.diff?.regressions) ? raw.diff.regressions.length : null,
  };
}

const scoreText = x => (x.score ? `${x.score.value}/100 (${bandOf(x.score.value)[1]})` : "not scored");
const issuesText = x =>
  [x.blockers && plural(x.blockers, "blocker"), x.high && `${x.high} high`, `${x.open} open`]
    .filter(Boolean)
    .join(", ");
export const lineOf = x =>
  x.problem
    ? `${x.dir}: ${x.problem}`
    : [
        x.name,
        scoreText(x),
        issuesText(x),
        x.unlock && `${x.unlock.value} once the blockers are fixed`,
        x.regressions && plural(x.regressions, "regression") + " since the last audit",
        x.date && `audited ${x.date}`,
      ]
        .filter(Boolean)
        .join(" · ");
// Lowest score first, unscored after, folders with no audit last.
export const order = list =>
  [...list].sort(
    (a, b) =>
      !!a.problem - !!b.problem ||
      (a.score?.value ?? 101) - (b.score?.value ?? 101) ||
      String(a.name).localeCompare(String(b.name)),
  );

const esc = s =>
  String(s ?? "").replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
export function dashboardHtml(list, out) {
  const link = x => {
    const r = relative(dirname(out), x.report).split(/[\\/]/).map(encodeURIComponent).join("/");
    return existsSync(x.report) ? `<a href="${esc(r)}">Open report</a>` : `<span class="mute">Not rendered yet</span>`;
  };
  const rows = list
    .map(x =>
      x.problem
        ? `<tr><td colspan="5"><code>${esc(x.dir)}</code></td><td class="mute">${esc(x.problem)}</td></tr>`
        : `<tr><td><b>${esc(x.name)}</b>${x.url ? `<br><span class="mute">${esc(x.url.replace(/^https?:\/\//, ""))}</span>` : ""}</td><td>${x.score ? `<span class="n ${bandOf(x.score.value)[2]}">${x.score.value}</span> ${esc(bandOf(x.score.value)[1])}${x.unlock ? `<br><span class="mute">${x.unlock.value} once the blockers are fixed</span>` : ""}` : "Not scored"}</td><td>${esc(issuesText(x))}</td><td>${x.regressions == null ? `<span class="mute">First audit</span>` : x.regressions ? esc(plural(x.regressions, "regression")) : "None"}</td><td>${esc(x.date)}</td><td>${link(x)}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>SEO dashboard</title>
<style>
:root{--bg:#f4f6f9;--panel:#fff;--ink:#1c2a39;--mute:#5d6878;--line:#e2e6ec;--b1:#c03030;--b2:#b5541a;--b3:#8a6400;--b4:#3f7f2e;--b5:#1d7444}
@media (prefers-color-scheme:dark){:root{--bg:#0e131a;--panel:#151c26;--ink:#e6ebf2;--mute:#98a3b3;--line:#232c39;--b1:#ef6464;--b2:#f38b4a;--b3:#efb93b;--b4:#86c873;--b5:#45b97a}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:1100px;margin:0 auto;padding:28px 16px 48px}
h1{font-size:26px;margin:0 0 4px}
.mute{color:var(--mute);font-size:13.5px}
.wrap{overflow-x:auto;margin-top:20px;background:var(--panel);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;min-width:640px}
th,td{text-align:left;vertical-align:top;padding:10px 14px;border-top:1px solid var(--line)}
thead th{border-top:0;font-size:12.5px;color:var(--mute);font-weight:600}
.n{font:700 22px/1 ui-monospace,Menlo,Consolas,monospace}.b1{color:var(--b1)}.b2{color:var(--b2)}.b3{color:var(--b3)}.b4{color:var(--b4)}.b5{color:var(--b5)}
a{color:inherit}
code{font:13px ui-monospace,Menlo,Consolas,monospace;overflow-wrap:anywhere}
</style>
</head>
<body>
<main>
<h1>SEO dashboard</h1>
<p class="mute">${esc(plural(list.filter(x => !x.problem).length, "site"))}, lowest score first · made ${esc(fmtDate(Date.now()))} from the audits on this computer. The health score is ${OWN_SCORE}.</p>
<div class="wrap"><table>
<thead><tr><th scope="col">Site</th><th scope="col">SEO health score</th><th scope="col">Open issues</th><th scope="col">Since last audit</th><th scope="col">Audited</th><th scope="col">Report</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>
</main>
</body>
</html>
`;
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2),
    at = argv.indexOf("--out"),
    outArg = at >= 0 ? argv[at + 1] : null;
  if (at >= 0 && !outArg) {
    console.error("Usage: node dashboard.mjs [folder ...] [--out dashboard.html]");
    process.exit(2);
  }
  const dirs = argv.filter((a, i) => !a.startsWith("--") && !(at >= 0 && i === at + 1));
  const list = order((dirs.length ? dirs : ["seo-audit"]).map(summaryOf));
  for (const x of list) console.log(lineOf(x));
  if (outArg) {
    const out = resolve(outArg);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, dashboardHtml(list, out));
    console.log(`Wrote ${out}`);
  }
}
