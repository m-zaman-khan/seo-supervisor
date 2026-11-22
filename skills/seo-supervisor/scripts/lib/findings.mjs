// @ts-check
// The finding store for the crawler and content-scan.mjs; other scripts build findings with findingOf and foundOn. Per
// check key: a count and the first 100 evidence lines ({ url, detail? }), plus the rules evaluated and those that
// couldn't be checked. scrub(text) runs on every URL and detail on the way in, so the crawler's masking of secret keys
// and home folders covers every check's evidence.

const ORDER = { blocker: 0, high: 1, "needs-decision": 2, medium: 3, low: 4 };

/**
 * @param {Record<string, any[]>} checks the catalog, key -> [rule, severity, title(n), why, fix]; an unknown key throws
 * @param {(text: string) => string} [scrub]
 * @param {Record<string, string[]>} [rules] rule id -> [title, category]: skip's area and list's category
 */
export function createFindings(checks, scrub = s => s, rules = {}) {
  const findings = new Map(); // key -> {evidence:[], count}
  function add(key, url, detail) {
    if (!checks[key]) throw new Error("unknown check " + key);
    url = url && scrub(url);
    if (detail != null) detail = scrub(String(detail));
    let f = findings.get(key);
    if (!f) findings.set(key, (f = { evidence: [], count: 0 }));
    f.count++;
    if (f.evidence.length < 100) f.evidence.push(detail ? { url, detail } : { url });
  }
  // A check that counts something other than its evidence lines (pairs, distinct texts) sets its own total.
  const setCount = (key, n) => {
    const f = findings.get(key);
    if (f) f.count = n;
  };
  const evaluated = new Set();
  const evalRules = (...ids) => ids.forEach(r => evaluated.add(r));
  // A rule this run couldn't check and why; the area is the rule and its title unless one is given.
  const notChecked = [];
  const skip = (rule, reason, area = `${rule} ${rules[rule]?.[0] ?? ""}`.trim()) => {
    notChecked.push({ rule, area, reason });
  };
  // The findings to write: worst first, then the most cases, numbered <prefix>-001 on. category: the area they all go
  // under, by default their rule's.
  /** @param {{ source: string, prefix: string, category?: string }} o */
  function list({ source, prefix, category }) {
    const out = [...findings].map(([key, f]) =>
      findingOf(key, checks[key], f, { source, category: category ?? rules[checks[key][0]][1] }),
    );
    return numbered(
      out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.count - a.count),
      prefix,
    );
  }
  return { findings, add, setCount, evaluated, evalRules, notChecked, skip, list };
}

/**
 * One finding as every script writes it, from its catalog entry and its evidence.
 * @param {string} check @param {any[]} entry [rule, severity, title(n), why, fix]
 * @param {{ count: number, evidence: any[] }} found @param {{ source: string, category: string }} where
 */
export function findingOf(check, entry, { count, evidence }, { source, category }) {
  const [rule, severity, title, why, fix] = entry;
  return {
    check,
    rule,
    severity,
    category,
    title: title(count),
    what: foundOn(count, evidence[0]),
    why,
    fix,
    count,
    evidence,
    source,
    status: severity === "needs-decision" ? "needs-decision" : "open",
  };
}

/** Gives each finding its id in list order, <prefix>-001 on (C- for the crawler, D- content-scan, L- log-scan). */
export function numbered(list, prefix) {
  list.forEach((f, i) => {
    f.id = `${prefix}-${String(i + 1).padStart(3, "0")}`;
  });
  return list;
}

// Site text quoted in a note the agent reads on stdout: JSON-escaped in double quotes, so a line break or quote can't
// pass as the tool's own words, and cut to 80 characters, so a hidden instruction can't come through whole. This
// guards the agent's reading, not HTML; the report escapes notes itself.
export const quote = (text, max = 80) => {
  const c = [...String(text)];
  return JSON.stringify(c.length > max ? c.slice(0, max - 1).join("") + "…" : c.join(""));
};

// A finding's `what`: "Found on <url> (<detail>)." for one case, "<n> cases, for example <url> (<detail>)." for more.
// The evidence URL and each bare web address in the detail go in a code span, backticks written %60 so the span can't
// end early, so the report shows them as code, never links. The rest is left to the report's own escaping.
const codeSpan = u => "`" + String(u).replace(/`/g, "%60") + "`";
const WEB_ADDRESS = /(?<!`)https?:\/\/[^\s<>"`]*[^\s<>"`.,;:!?)']/g;
/** @param {number} count @param {{ url?: string, detail?: any }} [example] the first evidence item */
export function foundOn(count, { url, detail } = {}) {
  const more = detail != null && detail !== "" ? ` (${String(detail).replace(WEB_ADDRESS, codeSpan)})` : "";
  return `${count === 1 ? "Found on" : `${count} cases, for example`} ${url ? codeSpan(url) : "the site"}${more}.`;
}
