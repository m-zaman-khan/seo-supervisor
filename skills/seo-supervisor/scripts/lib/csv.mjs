// @ts-check
// CSV to an array of objects keyed by the first row. Handles quotes, doubled quotes, CRLF and a leading BOM.
export function parseCsv(txt) {
  txt = txt.replace(/^﻿/, "");
  const rows = [];
  let row = [],
    cell = "",
    q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"' && txt[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && txt[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter(r => r.some(x => x.trim()));
  if (!head) return [];
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
