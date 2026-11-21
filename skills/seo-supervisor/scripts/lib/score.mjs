// @ts-check
// The score model (documented in report-format.md), shared by render-report.mjs and dashboard.mjs.
// Every checked rule is worth 10 points. A passing rule (or one whose findings are all fixed) earns 10;
// a rule with open findings earns by its worst one: low 8, medium 6, decision 6, high 3, blocker 0.
// Score = earned / possible. Open blockers cap it: 1 → 59, 2 → 49, 3 → 39 … (never below 9). While any open
// finding isn't won't-fix, it stops at 99, so 100 always means nothing is left to fix (rounding alone could reach 100).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
export const SEV = ["blocker", "high", "needs-decision", "medium", "low"];
export const EARN = { blocker: 0, high: 3, "needs-decision": 6, medium: 6, low: 8 };
export const isOpen = f => f.status !== "fixed";

// Findings as the report reads them: an ID, a known severity, a status and an area on each.
export const normalise = list =>
  (Array.isArray(list) ? list : [])
    .filter(f => f && typeof f === "object")
    .map((f, i) => ({
      evidence: [],
      ...f,
      id: f.id || `F-${String(i + 1).padStart(3, "0")}`,
      severity: SEV.includes(f.severity) ? f.severity : "low",
      status: f.status || (f.severity === "needs-decision" ? "needs-decision" : "open"),
      category: f.category || "Other",
    }));

// fixedCountsAsOpen: the score before this run's fixes. assume: findings to treat as fixed (for the "once blockers
// are fixed" score).
export function buildRules(findings, passed = [], { fixedCountsAsOpen = false, assume = _f => false } = {}) {
  const rules = new Map();
  for (const f of findings) {
    const key = f.rule || f.id;
    const r = rules.get(key) || { key, area: f.category, worst: null };
    if (
      !assume(f) &&
      (fixedCountsAsOpen || isOpen(f)) &&
      (r.worst === null || SEV.indexOf(f.severity) < SEV.indexOf(r.worst))
    )
      r.worst = f.severity;
    rules.set(key, r);
  }
  for (const p of Array.isArray(passed) ? passed : [])
    if (typeof p?.rule === "string" && !rules.has(p.rule))
      rules.set(p.rule, { key: p.rule, area: p.category || "Other", worst: null });
  return [...rules.values()];
}
export function score(rules) {
  if (!rules.length) return null;
  const earned = rules.reduce((s, r) => s + (r.worst ? EARN[r.worst] : 10), 0);
  const rawScore = Math.round((100 * earned) / (rules.length * 10));
  const blockers = rules.filter(r => r.worst === "blocker").length;
  const cap = blockers ? Math.max(9, 69 - 10 * blockers) : 100;
  return {
    value: Math.min(rawScore, cap),
    raw: rawScore,
    cap: blockers ? cap : null,
    blockers,
    rules: rules.length,
    passing: rules.filter(r => !r.worst).length,
  };
}
// ---------- the project's own check settings ----------
// seo-audit/settings.json beside the audit file:
//   "checks": { "off": ["no-hsts"], "severity": { "img-alt-quality": "medium" } }
// A check is a finding's `check` id; hand-written findings have none and are left alone. findingsOf is the one place
// these apply, so the report, the score and issues.mjs see the same list. An off check is dropped from the score as if
// it hadn't run; the report lists it. Blockers are never turned off or lowered: a noindex home page or an expired
// certificate can appear on any later run, and a setting written once would hide it from every report after. An
// intended one (noindex before launch) is handled per run, with --ignore-noindex or the audit's review, and noted.

// Every check id the scripts can write, read from their own text: catalog entries (`"id": ["RULE-01", "severity", …`,
// at a line's start or right after `{` or `,`, so `SERVER_CHECK = { "id": [` counts too; `CHECKS["id"] = [`) and findings
// written directly (`check: "id", rule: …`, `finding("id", …)`). A bare `check: "…"` is left out: the crawler's product
// problems use one for a code its finding prefixes (image-missing is product-image-missing).
// A pattern scan, so a check written any other way reads as unknown; add its pattern here if one is.
export function knownChecks(dir = new URL("..", import.meta.url)) {
  const ids = new Set(),
    files = [];
  for (const d of [dir, new URL("checks/", dir)])
    try {
      files.push(
        ...readdirSync(d)
          .filter(f => f.endsWith(".mjs"))
          .map(f => new URL(f, d)),
      );
    } catch {}
  const re =
    /^\s*"?([a-z0-9]+(?:-[a-z0-9]+)*)"?:\s*\[\s*"[A-Z]+-\d+",\s*"(?:blocker|high|medium|low|needs-decision)"|CHECKS\["([a-z0-9-]+)"\] = \[|\bcheck:\s*"([a-z0-9-]+)"|\bfinding\(\s*"([a-z0-9-]+)"/gm;
  for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(re)) ids.add(m[1] || m[2] || m[3] || m[4]);
  return ids;
}
const plainObj = x => x && typeof x === "object" && !Array.isArray(x);
/** @returns {{ findings: any[], off: { check: string, count: number }[], changed: { check: string, to: string, count: number }[], warnings: string[] }} */
export function applyChecks(findings, settings, known = null) {
  if (settings == null) return { findings, off: [], changed: [], warnings: [] };
  if (
    !plainObj(settings) ||
    (settings.off != null && !Array.isArray(settings.off)) ||
    (settings.severity != null && !plainObj(settings.severity))
  )
    return {
      findings,
      off: [],
      changed: [],
      warnings: [
        `"checks" in settings.json should be { "off": ["check-id"], "severity": { "check-id": "low" } }, so it was ignored.`,
      ],
    };
  const warnings = new Set(),
    ids = new Set([...(known || knownChecks()), ...findings.map(f => f.check).filter(Boolean)]);
  const valid = id =>
    ids.has(id) ||
    void warnings.add(
      `“${id}” isn't a check SEO Supervisor knows, so its setting was ignored. The check names are the "check" values in seo-crawl.json.`,
    );
  const off = new Map((settings.off || []).filter(valid).map(id => [id, 0]));
  const changed = new Map(
    Object.entries(settings.severity || {})
      .filter(
        ([id, s]) =>
          valid(id) &&
          (SEV.includes(s) ||
            void warnings.add(
              `“${s}” isn't a severity, so ${id} keeps its own. Use blocker, high, needs-decision, medium or low.`,
            )),
      )
      .map(([id, to]) => [id, { to, count: 0 }]),
  );
  const kept = [];
  for (const f of findings) {
    const blocker = f.severity === "blocker",
      to = changed.get(f.check);
    if (off.has(f.check)) {
      if (!blocker) {
        off.set(f.check, off.get(f.check) + 1);
        continue;
      }
      warnings.add(
        `${f.check} found a blocker (${f.id}), so it stays on: blockers can't be turned off in settings.json.`,
      );
    }
    if (to && to.to !== f.severity) {
      if (blocker) {
        warnings.add(
          `${f.check} found a blocker (${f.id}), so it stays a blocker: blockers can't be lowered in settings.json.`,
        );
        kept.push(f);
        continue;
      }
      to.count++;
      kept.push({ ...f, severity: to.to });
      continue;
    }
    kept.push(f);
  }
  return {
    findings: kept,
    off: [...off].map(([check, count]) => ({ check, count })),
    changed: [...changed].map(([check, c]) => ({ check, ...c })),
    warnings: [...warnings],
  };
}
// The audit's findings as every reader sees them: normalised, then the settings beside the audit file (dir) applied.
// A renamed check's old id (crawl/catalog.mjs ID_ALIASES) reads as its new one, in the settings and in an audit made
// before the rename, so neither stops applying.
export function findingsOf(raw, dir) {
  const file = join(dir, "settings.json");
  let settings = null,
    bad = null;
  if (existsSync(file))
    try {
      settings = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      bad = `${basename(dir)}/settings.json isn't valid JSON, so its check settings weren't read.`;
    }
  const r = applyChecks(normalise(raw?.findings), plainObj(settings) ? settings.checks : undefined);
  return { ...r, warnings: [...(bad ? [bad] : []), ...r.warnings] };
}

export const BANDS = [
  [90, "Excellent", "b5"],
  [75, "Good", "b4"],
  [60, "Fair", "b3"],
  [40, "Poor", "b2"],
  [0, "Critical", "b1"],
];
export const bandOf = v => BANDS.find(([min]) => v >= min);
// The same words in every report and tool that shows this score.
export const OWN_SCORE = "SEO Supervisor's own score, not Google's";
