// The score model (documented in report-format.md), shared by render-report.mjs and dashboard.mjs.
// Every checked rule is worth 10 points. A passing rule (or one whose findings are all fixed) earns 10;
// a rule with open findings earns by its worst one: low 8, medium 6, decision 6, high 3, blocker 0.
// Score = earned / possible. Open blockers cap it: 1 → 59, 2 → 49, 3 → 39 … (never below 9).
export const SEV = ["blocker", "high", "needs-decision", "medium", "low"];
export const EARN = { blocker: 0, high: 3, "needs-decision": 6, medium: 6, low: 8 };
export const isOpen = f => f.status !== "fixed";

// Findings as the report reads them: an ID, a known severity, a status and an area on each.
export const normalise = list =>
  (Array.isArray(list) ? list : []).map((f, i) => ({
    evidence: [],
    ...f,
    id: f.id || `F-${String(i + 1).padStart(3, "0")}`,
    severity: SEV.includes(f.severity) ? f.severity : "low",
    status: f.status || (f.severity === "needs-decision" ? "needs-decision" : "open"),
    category: f.category || "Other",
  }));

// fixedCountsAsOpen: the score before this run's fixes. assume: findings to treat as fixed (for the "once blockers
// are fixed" score).
export function buildRules(findings, passed = [], { fixedCountsAsOpen = false, assume = () => false } = {}) {
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
  for (const p of passed || [])
    if (!rules.has(p.rule)) rules.set(p.rule, { key: p.rule, area: p.category || "Other", worst: null });
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
