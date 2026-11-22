// @ts-check
// The crawler's finding store. Per check key: a count and the first 100 evidence lines ({ url, detail? }), plus the
// rules evaluated. scrub(text) runs on every URL and detail on the way in, so the crawler's masking of secret keys and
// home folders covers every check's evidence.

/**
 * @param {Record<string, any[]>} checks the catalog, key -> [rule, severity, title(n), why, fix]; an unknown key throws
 * @param {(text: string) => string} [scrub]
 */
export function createFindings(checks, scrub = s => s) {
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
  const evaluated = new Set();
  const evalRules = (...ids) => ids.forEach(r => evaluated.add(r));
  return { findings, add, evaluated, evalRules };
}
