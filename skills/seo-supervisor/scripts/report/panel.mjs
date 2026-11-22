// @ts-check
// Topic-tab panels, each built once as a view model and drawn by panelHtml and panelMd, so the page and the Markdown
// can't drift apart. Escaping happens here, the same way for every panel. A panel with nothing to show is null.
import { cellMd, esc, inl, mdSafe, noteCode, noteMd, num } from "./format.mjs";

/**
 * Text: a string (escaped), { code } (a code span), { b } (bold), { id } (a finding's id: a link on the page, plain in
 * the Markdown), { inl } (report text with `code` in it: inl on the page, mdSafe in the Markdown), { html, md }
 * (already written for each, where the two differ), or a list of these, joined.
 * @typedef {any} Text
 * A block, one of:
 *   { quiet }               a quiet line (outside a collapsed panel), a paragraph in the Markdown
 *   { p }                   a paragraph
 *   { rows, cap, bold }     a list of [key, value?, sep?] rows: "- key value" in the Markdown (sep, " " unless
 *                           given, goes between; bold: the key is bold there); on the page a value left out has no
 *                           <span>; cap: the page shows that many, the Markdown all
 *   { head, align, rows, cap } a table (align: the Markdown's alignment row, like "---:")
 *   { sub, heading, blocks } a list inside a panel: a plain <details> on the page (sub its summary), ### in the
 *                           Markdown
 *   { panel }               a whole panel after this one's lines: its own collapsed panel on the page, ### in the
 *                           Markdown
 *   { page }                a paragraph only the page shows (the Markdown lists everything, so it needs no "more in")
 *   { md }, { html, md }    lines only the Markdown has; or markup and lines already written for each (a credit
 *                           with a link)
 *   any block with mdOnly   left off the page (the page shows the first few, the Markdown all)
 * @typedef {any} Block
 * @typedef {{ cls?: string, title: string, summary?: Text, blocks: (Block | false | null | undefined | "" | 0)[] } | null} Panel
 *   cls: the collapsed panel's hook class (left out: the blocks sit on the page as they are); summary: the page's
 *   summary when it isn't the title.
 */

// Anything that isn't an object (a string, or a number or nothing read from the audit file) is text.
/** @param {Text} t */
const H = t =>
  typeof t === "string"
    ? esc(t)
    : Array.isArray(t)
      ? t.map(H).join("")
      : "code" in t
        ? `<code>${esc(t.code)}</code>`
        : "b" in t
          ? `<b>${esc(t.b)}</b>`
          : "id" in t
            ? `<a href="#${esc(t.id)}">${esc(t.id)}</a>`
            : "inl" in t
              ? inl(t.inl)
              : t.html;
/** @param {Text} t */
const M = t =>
  typeof t === "string"
    ? noteMd(t)
    : Array.isArray(t)
      ? t.map(M).join("")
      : "code" in t
        ? noteCode(t.code)
        : "b" in t
          ? `**${noteMd(t.b)}**`
          : "id" in t
            ? noteMd(t.id)
            : "inl" in t
              ? mdSafe(t.inl)
              : t.md;
const capped = b => (b.cap ? b.rows.slice(0, b.cap) : b.rows);

/** @param {Block} b @returns {string} */
function blockHtml(b) {
  if ("quiet" in b) return `\n    <p class="quiet">${H(b.quiet)}</p>`;
  if ("p" in b || "page" in b) return `<p>${H(b.p ?? b.page)}</p>`;
  if ("head" in b)
    return `<div class="tablewrap"><table><thead><tr>${b.head.map(h => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${capped(
      b,
    )
      .map(r => `<tr>${r.map(c => `<td>${H(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div>`;
  if ("rows" in b)
    return b.rows.length
      ? `<ul class="lim">${capped(b)
          .map(([k, v]) => `<li><b>${H(k)}</b>${v === undefined ? "" : `<span>${H(v)}</span>`}</li>`)
          .join("")}</ul>`
      : "";
  if ("sub" in b)
    return `<details><summary>${H(b.sub)}</summary>${b.blocks.filter(Boolean).map(blockHtml).join("")}</details>`;
  if ("panel" in b) return panelHtml(b.panel);
  return "";
}
/** @param {Block} b @returns {string[]} */
function blockMd(b) {
  if ("quiet" in b || "p" in b) return [M(b.quiet ?? b.p), ""];
  if ("head" in b)
    return [
      `| ${b.head.join(" | ")} |`,
      `| ${b.align.join(" | ")} |`,
      ...b.rows.map(r => `| ${r.map(c => cellMd(M(c))).join(" | ")} |`),
      "",
    ];
  if ("rows" in b)
    return b.rows.length
      ? [
          ...b.rows.map(
            ([k, v, sep = " "]) => `- ${b.bold ? `**${M(k)}**` : M(k)}${v === undefined || v === "" ? "" : sep + M(v)}`,
          ),
          "",
        ]
      : [];
  if ("sub" in b) return [`### ${M(b.heading ?? b.sub)}`, "", ...b.blocks.filter(Boolean).flatMap(blockMd)];
  if ("panel" in b) return panelMd(b.panel, "###");
  if ("md" in b) return b.md;
  return [];
}

/** The panel on the page: a collapsed <details>, or its quiet lines as they are. @param {Panel} p */
export function panelHtml(p) {
  if (!p) return "";
  const body = p.blocks.filter(Boolean).map(blockHtml).join("");
  return p.cls
    ? `\n    <details class="how ${p.cls}"><summary>${H(p.summary ?? p.title)}</summary>${body}</details>`
    : body;
}
/** The panel in the Markdown: a ## section (### when level is given). @param {Panel} p @param {string} [level] */
export function panelMd(p, level = "##") {
  return p ? [`${level} ${p.title}`, "", ...p.blocks.filter(Boolean).flatMap(blockMd)] : [];
}
/**
 * A panel's [page, Markdown] pair, for the Overview's panel list.
 * @param {() => Panel | false | "" | 0 | undefined} vm
 */
export const drawn = vm => [() => panelHtml(vm() || null), () => panelMd(vm() || null)];
/** The page's note under a capped list: the Markdown has every row. @param {number} n @param {string | null} mdFile */
export const listedIn = (n, mdFile) =>
  mdFile && { page: [`All ${num(n)} pages are listed in `, { code: mdFile }, "."] };
