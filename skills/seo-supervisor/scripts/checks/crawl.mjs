// @ts-check
// Links to a #name the target page lacks, and the crawler's back-off when a site asks it to slow down.

export const CHECKS = {
  "link-fragment-missing": [
    "CRAWL-07",
    "low",
    n => `${n} link(s) jump to a part of a page that isn't there`,
    "A link that ends in `#name` should open its page at the element with `id=\"name\"`. When the page has no such element, the browser opens it at the top, and the visitor has to look for the part the link promised. This check reads the HTML the server sends: an id that the page's own JavaScript adds later isn't seen, so open one of these links in a browser before changing anything. Pages built only in the browser aren't checked, since their ids come from JavaScript.",
    'Give the section the id the link uses (`<h2 id="prices">`), or change the link to the id the section has. Ids must match exactly, capital letters included.',
  ],
};

// Tab, menu and dialog toggles: a script reads their #name, so they're skipped, as in visual.mjs.
const widget = a =>
  /^(button|tab)$/i.test((a.role || "").trim()) || ["aria-controls", "data-toggle", "data-bs-toggle"].some(k => k in a);
/** Links to a #name, as unique [page URL without the hash, name] pairs. Skips a bare # and #top (browsers read both
 * as the page top), router hashes (#/… and #!…) and non-http schemes. Of a text fragment, only the part before :~:
 * is a name.
 * @param {{ href?: string, role?: string }[]} anchors
 * @param {string} base
 * @returns {[string, string][]} */
export function fragmentLinks(anchors, base) {
  const out = new Map();
  for (const a of anchors) {
    if (!a.href?.includes("#") || widget(a)) continue;
    let u;
    try {
      u = new URL(a.href.trim(), base);
    } catch {
      continue;
    }
    const name = u.hash.slice(1).split(":~:")[0];
    if (!/^https?:$/.test(u.protocol) || !name || /^top$/i.test(name) || /^[!/]/.test(name)) continue;
    u.hash = "";
    out.set(`${u.href}#${name}`, [u.href, name]);
  }
  return [...out.values()];
}
/** Matches the #name as written or percent-decoded, as browsers try both. Ids are case-sensitive.
 * @param {Set<string>} ids
 * @param {string} name */
export const hasName = (ids, name) => {
  if (ids.has(name)) return true;
  try {
    return ids.has(decodeURIComponent(name));
  } catch {
    return false;
  }
};

/** Every fixed wait in the crawler, speed.mjs's PageSpeed retry included. SEO_SUPERVISOR_NO_PAUSES makes them 0 ms:
 * the tests' offline guard sets it, and it isn't a user setting.
 * @param {number} ms */
export const sleep = ms => new Promise(ok => setTimeout(ok, process.env.SEO_SUPERVISOR_NO_PAUSES ? 0 : ms));

// Back-off after a 429, 503 or no answer: `until` is when requests may resume, `ms` the total paused, `busy` and
// `silent` the causes. Pauses stop at PAUSE_CAP in total so a struggling site can't stall the crawl; `full` marks that.
export const PAUSE_CAP = 120000;
export function brake(cap = PAUSE_CAP) {
  const s = {
    until: 0,
    ms: 0,
    busy: 0,
    silent: 0,
    full: false,
    /** Pause every request until `ms` from `now`, within what's left of the cap. */
    pause(ms, now = Date.now()) {
      const from = Math.max(s.until, now),
        want = now + ms - from,
        more = Math.min(want, cap - s.ms);
      if (want > more) s.full = true;
      if (more > 0) {
        s.ms += more;
        s.until = from + more;
      }
    },
  };
  return s;
}
// The crawl note, or null when nothing slowed the crawl. Google advises a 429 or 503 only for a few hours, two days at
// most (Search Central blog, "Moving to a CDN without overwhelming your origin", 11 Nov 2026).
/** @param {{ busy: number, silent: number, ms: number, full: boolean }} s */
export function slowNote({ busy, silent, ms, full }) {
  if (!busy && !silent) return null;
  const n = (k, one) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const why = [
    busy && `the site sent ${n(busy, "answer")} of 429 (too many requests) or 503 (server busy)`,
    silent && `${n(silent, "request")} got no answer (the connection dropped or timed out)`,
  ]
    .filter(Boolean)
    .join(", and ");
  const time = ms >= 1000 ? `${Math.round(ms / 1000)} s` : "under a second";
  return `The crawler slowed down: ${why}. It paused every request to the site for ${time} in all, then asked each of those pages once more${full ? `. The pauses stopped at ${PAUSE_CAP / 60000} minutes in all, our own limit, so later ones were asked again at once` : ""}. A page that still failed is reported as a server error.${busy ? " Google says to answer 429 or 503 only for a short time (a few hours, 1 to 2 days at most), so if this happens on the live site, check the server's or CDN's rate limits." : ""}`;
}
