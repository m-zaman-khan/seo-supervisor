// @ts-check
// Small HTTP helpers the scripts share.

// Retry-After is an HTTP-date or delay-seconds, and a recipient must accept all three date formats (IMF-fixdate,
// RFC 850 and asctime, which is UTC). Each starts with the day's name.
// https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3
/** How long to wait, in ms (0 for a date already past), or null when the value is missing or isn't one of those.
 * Callers cap it. @param {unknown} value @param {number} [now] */
export function retryAfter(value, now = Date.now()) {
  const s = String(value ?? "").trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  if (!/^[A-Za-z]{3}/.test(s)) return null;
  const t = Date.parse(/\bGMT$/.test(s) ? s : s + " GMT");
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

/** A fetch() body, already decompressed, read up to cap bytes: a Buffer, or null as soon as it passes cap, the rest
 * left unread, so a huge or endless answer can't fill memory.
 * @param {Response} res @param {number} cap */
export async function bodyUpTo(res, cap) {
  const chunks = [];
  let n = 0;
  for await (const c of res.body ?? []) {
    if ((n += c.length) > cap) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
