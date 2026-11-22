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
// Every link built from the audit file goes through this: only a full http(s) URL becomes a link, so javascript:,
// data: and the like stay plain text and a click can't run a script.
export const safeHref = u => (typeof u === "string" && /^https?:\/\//i.test(u) && URL.canParse(u) ? u : null);
// html: the link's text, already escaped. In Markdown, the few characters that would end the link are %-encoded.
export const link = (u, html) => (safeHref(u) ? `<a href="${esc(u)}" rel="noopener">${html}</a>` : html);
export const mdLink = (u, md) =>
  safeHref(u)
    ? `[${md}](${u.replace(/[\s()<>]/g, c => ({ "(": "%28", ")": "%29" })[c] || encodeURIComponent(c))})`
    : md;
// A YYYY-MM-DD prefix is that calendar day on every machine, whatever its time zone; other times are shown in UTC.
export const fmtDate = (d, year = true) => {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(String(d ?? ""))?.[0],
    x = new Date(day ? day + "T00:00:00Z" : d || Date.now());
  return isNaN(x.getTime())
    ? String(d)
    : x.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        ...(year && { year: "numeric" }),
        timeZone: "UTC",
      });
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
export const cellMd = s =>
  String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
const urlsCoded = (s, text) =>
  s
    .split(/(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)'])/)
    .map((q, j) => (j % 2 ? noteCode(q) : text(q)))
    .join("");
export const mdSafe = (s, text = noteMd) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .split(/(`[^`]+`)/)
    .map((p, i) =>
      i % 2
        ? p
        : p
            .split(/\*\*([^*]+)\*\*/)
            .map((q, j) => (j % 2 ? `**${urlsCoded(q, text)}**` : urlsCoded(q, text)))
            .join(""),
    )
    .join("");

// Validators for values read from the audit file.
export const isCount = x => Number.isInteger(x) && x >= 0;
export const isText = x => typeof x === "string" && x !== "";
