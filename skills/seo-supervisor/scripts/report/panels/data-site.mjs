// @ts-check
// The schema inventory on the Site & content tab: pages with the same JSON-LD, Microdata and RDFa types share a row.
// Schema problems are ordinary findings. Types come from the site's markup, so report/panel.mjs escapes them.
import { num, obj, plural, isText, notePath } from "../format.mjs";
import { fromLine } from "../sources.mjs";

export function schemaInventoryPanel({ raw }) {
  const list = x => (Array.isArray(x) ? x.filter(isText) : []);
  const pages = (Array.isArray(raw.pages) ? raw.pages : []).filter(p => obj(p) && isText(p.url));
  const typed = pages
    .map(p => ({ path: notePath(p.url), types: [...new Set([...list(p.schema), ...list(p.schemaOther)])].sort() }))
    .filter(p => p.types.length);
  if (!typed.length) return null;
  const byType = new Map(),
    bySet = new Map();
  for (const p of typed) {
    for (const t of p.types) byType.set(t, (byType.get(t) || 0) + 1);
    const k = p.types.join(", ");
    (bySet.get(k) || bySet.set(k, []).get(k)).push(p.path);
  }
  const types = [...byType].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    sets = [...bySet].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  return {
    tab: "site-content",
    cls: "schemainventory",
    title: "Structured data on each page",
    blocks: [
      {
        p: `${fromLine(raw, "pages")} ${plural(typed.length, "page")} of ${num(pages.length)} crawled ${typed.length === 1 ? "has" : "have"} structured data. By type: ${types
          .slice(0, 20)
          .map(([t, n]) => `${t} ${num(n)}`)
          .join(
            " · ",
          )}${types.length > 20 ? ` and ${num(types.length - 20)} more` : ""}. Information only; schema problems are findings.`.trim(),
      },
      {
        head: ["Types", "Pages", "For example"],
        align: ["---", "---:", "---"],
        cap: 10,
        rows: sets.slice(0, 50).map(([k, l]) => [k, num(l.length), { code: l[0] }]),
      },
    ],
  };
}
