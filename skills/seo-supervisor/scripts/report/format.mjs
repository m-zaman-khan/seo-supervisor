// @ts-check
// Pure escaping and formatting helpers for the report.

export const SEV_LABEL = {
  blocker: "Blocker",
  high: "High",
  "needs-decision": "Decision",
  medium: "Medium",
  low: "Low",
};
export const STATUS_LABEL = {
  open: "Open",
  fixed: "Fixed",
  "wont-fix": "Won't fix",
  "needs-decision": "Needs decision",
  "in-progress": "In progress",
};

// inl escapes too, then turns `code` and **bold** into tags.
export const esc = s =>
  String(s ?? "").replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
export const inl = s =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
export const fmtDate = d => {
  const x = new Date(d || Date.now());
  return isNaN(x.getTime())
    ? String(d)
    : x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
export const num = n => Number(n).toLocaleString("en-US");
export const obj = x => (x && typeof x === "object" ? x : null);
export const plural = (n, w, p = w + "s") => `${num(n)} ${n === 1 ? w : p}`;
export const firstSentence = s => {
  const m = String(s || "").match(/^.*?[.!?](\s|$)/);
  return m ? m[0].trim() : String(s || "");
};
export const ICON = {
  chevron:
    '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 10 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrow:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search:
    '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10.5 10.5 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
export const dot = s => `<i class="dot d-${s}" aria-hidden="true"></i>`;

// The Markdown escapers the report, the plan and issues.mjs share. mdSafe is inl's twin for text that may quote pages
// or other sites: its `code` and **bold** stay, URLs outside code become code spans, and the rest is escaped, so none
// of it can render as a link, an image or a tag.
export const noteMd = s =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\\`*_[\]<>]/g, "\\$&");
export const noteCode = s => "`" + String(s ?? "").replace(/[`\r\n]/g, " ") + "`";
export const notePath = u => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return String(u ?? "");
  }
};
export const cellMd = s => s.replace(/\|/g, "\\|");

// Validators for values read from the audit file.
export const isCount = x => Number.isInteger(x) && x >= 0;
export const isText = x => typeof x === "string" && x !== "";
