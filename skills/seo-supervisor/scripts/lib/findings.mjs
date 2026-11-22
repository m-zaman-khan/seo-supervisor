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
