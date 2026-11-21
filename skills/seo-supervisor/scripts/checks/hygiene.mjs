// @ts-check
// Duplicate analytics tags, exposed secret keys, CSS-hidden links and app link files. Every cut-off is a local choice.
// HTML is read with regexes, as in the crawler; swap in a real parser if a site breaks them.

export const HIDDEN_MIN = 3; // links to other sites hidden on one page before it's flagged
export const PDF_PAGES = 3; // pages linking one PDF before the report lists it
// Caps on the site's script files read for secret keys, so huge bundles can't stall the crawl.
export const JS_CAPS = { files: 50, each: 5 * 1024 * 1024, all: 50 * 1024 * 1024 };

export const CHECKS = {
  // A Google tag configured twice may duplicate data unless "Ignore duplicate instances" is on. Google also advises
  // against redundant tag managers, but doesn't say what a second copy of a container does.
  // https://support.google.com/analytics/answer/12015327
  // https://developers.google.com/tag-platform/devguides/prerequisites
  "analytics-tag-twice": [
    "LAUNCH-04",
    "low",
    n => `${n} page(s) set up the same Google Analytics or Tag Manager ID twice`,
    "These pages set up the same Google Analytics 4 measurement ID (G-…) in two separate scripts, or load the same Google Tag Manager container (GTM-…) twice. Google's Analytics help says the same Google tag set up two or more times on a page \"may cause duplicate data or mixed settings\": visits and events can be counted twice, which inflates the numbers you see and import. For Tag Manager, Google's tag guide says to avoid installing redundant tags or tag management systems. It's fine if the Google tag's setting \"Ignore duplicate instances of on-page configuration\" is on, which Google turns on when two tags are combined: the crawler can't see that setting, nor tags added inside Tag Manager.",
    "Keep one copy. A theme or plugin often adds the tag while it's also pasted into the layout or added through Tag Manager, so remove the others. Then open Google Analytics' Realtime report and check that one visit shows one page view.",
  ],
  // Key prefixes each provider documents as secret, and RFC 7468's private-key labels.
  // https://docs.stripe.com/keys
  // https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github
  // https://docs.slack.dev/authentication/tokens
  // https://www.rfc-editor.org/rfc/rfc7468
  "secret-key-exposed": [
    "TRUST-01",
    "high",
    n => `${n} page(s) send a secret key to every visitor`,
    `The HTML of these pages, or a script file on your site that they load, holds a key that its provider says must stay secret. Anyone who opens the page source or the script can copy it and act as you: take payments, read data or post messages, depending on the key. A key in a script file usually got there when the site was built, from a setting meant for the server. Only key formats that are always secret are flagged: Stripe live secret and restricted keys (sk_live_, rk_live_), GitHub tokens (ghp_, github_pat_, gho_, ghu_, ghs_, ghr_), Slack tokens (xoxb-, xoxp-, xapp-, xwfp-) and private-key blocks. Keys made for browsers, such as Google and Firebase web API keys and Stripe publishable keys (pk_live_), aren't. Only script files on your own site are read, never other sites', up to our own limits of ${JS_CAPS.files} files, ${JS_CAPS.each / 1048576} MB each and ${JS_CAPS.all / 1048576} MB in all. The evidence shows only the key's type and first characters.`,
    "Treat it as an emergency. First revoke the key with its provider (Stripe's API keys page, GitHub's token settings, the Slack app's settings) and make a new one: taking it off the page isn't enough, because copies and caches may already exist. Then keep the new key on the server only, read from an environment variable, and check that the build doesn't copy server settings into the page.",
  ],
  // Google's spam policies count CSS-hidden links as content injection, and allow menus, tabs and panels that show and
  // hide content.
  // https://developers.google.com/search/docs/essentials/spam-policies
  // https://web.dev/articles/hacked
  "hidden-links": [
    "CONTENT-11",
    "low",
    n => `${n} page(s) hide links to other sites with CSS`,
    `These pages hold ${HIDDEN_MIN} or more links to other sites inside an element hidden by its own style: display:none, visibility:hidden, a font size or opacity of 0, or moved far off the screen (${HIDDEN_MIN} is our own cut-off). Google's spam policies name hidden links added with CSS as one way hackers inject content into a site, and hidden links meant for search engines break Google's rules whoever added them. This is only a possible issue: it's fine if it's a menu, tab or panel that visitors can open. The page's topic plays no part, only where the links are.`,
    "Look at the links in the page source. If you didn't add them, the site may have been hacked: check Search Console's Security issues report and follow Google's guide at web.dev/articles/hacked, remove the code, then find how it got in (an old plugin or theme, a weak password) and update everything. If it's your own menu or panel, nothing needs to change.",
  ],
  // From otherReviewed and onlineOnly in schema.mjs, which cite their sources.
  "review-target-conflict": [
    "SCHEMA-01",
    "low",
    n => `${n} page(s) have a nested review that names a different item`,
    "A review or rating here sits inside an item, through its review or aggregateRating property, but also names a different item in itemReviewed. Google's review snippet guide says to leave itemReviewed out of a nested review, as the item it sits in is the one reviewed, and since 12 Nov 2025 it asks sites not to say what's reviewed in more than one way. With two answers Google can't tell which item the rating is for, so the stars may not show.",
    "Remove itemReviewed from the nested review or rating. If the review really is about another item, move it out into its own Review that names that item in itemReviewed.",
  ],
  "event-online": [
    "SCHEMA-05",
    "low",
    n => `${n} page(s) mark up online-only events`,
    "These events are online only: their eventAttendanceMode is OnlineEventAttendanceMode, or their only location is a VirtualLocation. On 5 Jun 2025 Google removed the online event properties from its event guide: events must be open to the public and held at a physical location, and \"virtual experiences that have no real-world component aren't supported\". So these events can't show in Google's event results. The markup does no harm, and other search engines may still read it.",
    "Keep it knowingly or remove it, but don't expect Google event results for online-only events. An event that also has a real venue should say MixedEventAttendanceMode and give a Place with an address.",
  ],
};

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};
const noComments = h => h.replace(/<!--[\s\S]*?-->/g, " ");
const JS = /^((text|application)\/(x-)?(java|ecma)script|module)?$/i;

// ---------- the same analytics ID twice (LAUNCH-04) ----------
// IDs set up per JavaScript <script>: a GA4 gtag('config', …) ID, or a Tag Manager container in its snippet or a
// gtm.js?id= src. An ID counts once per element, so a second config call there (a route change) isn't a copy, and
// Tag Manager's <noscript> iframe is its own second half.
const CONFIG = /\bgtag\s*\(\s*["']config["']\s*,\s*["'](G-[A-Z0-9]{4,})["']/g,
  CONTAINER = /\b(GTM-[A-Z0-9]{4,})\b/g;
export function analyticsTwice(html) {
  const seen = new Map();
  for (const [, a, js] of noComments(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!JS.test((attr(a, "type") || "").trim())) continue;
    const ids = new Set([...js.matchAll(CONFIG)].map(m => m[1]));
    const src = attr(a, "src") || "";
    if (/googletagmanager\.com\/gtm\.js/i.test(src)) for (const [, id] of src.matchAll(CONTAINER)) ids.add(id);
    if (/googletagmanager\.com\/gtm\.js/i.test(js)) for (const [, id] of js.matchAll(CONTAINER)) ids.add(id);
    for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
  }
  return [...seen]
    .filter(([, n]) => n > 1)
    .map(([id, n]) => (id.startsWith("GTM-") ? `${id} loaded ${n} times` : `${id} set up in ${n} scripts`));
}

// ---------- secret keys in the HTML and the site's own script files (TRUST-01) ----------
// Formats documented as secret (sources at secret-key-exposed). Keys made for browsers are left out on purpose: Google
// and Firebase API keys, Firebase web config, Stripe publishable keys. So are Stripe test keys, which tutorials show
// and which can't move money, and Stripe organization keys, whose live form isn't documented.
// https://firebase.google.com/docs/projects/api-keys
const KEYS = [
  ["a private key", /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?)-----([\s\S]{0,12000}?)-----END \1-----/g],
  ["a Stripe live secret key", /\bsk_live_[A-Za-z0-9]{20,}/g, true],
  ["a Stripe live restricted key", /\brk_live_[A-Za-z0-9]{20,}/g, true],
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g, true],
  ["a Slack token", /\b(?:xox[bp]|xapp|xwfp|xoxe\.xox[bp]|xoxe\.xapp)-[A-Za-z0-9-]{20,}/g],
];
const PREFIX = /^(?:[sr]k_live_|gh[pousr]_|github_pat_|xoxe\.(?:xox[bp]|xapp)-|xox[bp]-|xapp-|xwfp-)/;
// Rules out placeholders such as sk_live_xxxx or ghp_YOUR_TOKEN; base62 keys (bothCases) need both letter cases.
// Shape only: add GitHub's token checksum if made-up keys that look real get flagged.
const realKey = (tail, bothCases) =>
  /\d/.test(tail) &&
  /[a-z]/i.test(tail) &&
  new Set(tail).size >= 10 &&
  (!bothCases || (/[a-z]/.test(tail) && /[A-Z]/.test(tail)));
/** Secret keys in HTML or script text as { label, shown, raw }; shown is the type prefix and first 4 characters, or
 * a key block's label. */
export function secretsIn(html) {
  const out = [];
  for (const [label, re, bothCases] of KEYS)
    for (const m of html.matchAll(re)) {
      if (label === "a private key") {
        // A real key block holds 60 or more base64 characters; a shortened sample doesn't.
        const body = m[2].replace(/\\[nr]/g, "\n").replace(/^[\w-]+:.*$/gm, "");
        if (/\.\.\.|…/.test(body) || (body.match(/[A-Za-z0-9+/]/g) || []).length < 60) continue;
        out.push({ label, shown: `BEGIN ${m[1]}`, raw: m[0] });
        continue;
      }
      const prefix = PREFIX.exec(m[0])?.[0] ?? "",
        tail = m[0].slice(prefix.length);
      if (realKey(tail, bothCases)) out.push({ label, shown: `${prefix}${tail.slice(0, 4)}…`, raw: m[0] });
    }
  return out;
}
/** The text with each secret key secretsIn finds replaced by its shown form. */
export const maskKeys = s => secretsIn(s).reduce((t, k) => t.split(k.raw).join(k.shown), s);

// ---------- links hidden with CSS (CONTENT-11) ----------
// Hidden by the element's own style; screen-reader-only text moves far less than -1000px. Classes aren't read: menus
// hidden by a class are the usual, honest case.
const HIDDEN =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px|em|rem|pt|%)?(?![.\d])|opacity\s*:\s*0(?:\.0*)?(?![.\d])|(?:left|top|text-indent|margin-left)\s*:\s*-\d{4,}(?:\.\d+)?px)/i;
const ABS = /^https?:\/\//i;
// Absolute hrefs of hidden links and links inside hidden elements; the crawler keeps other sites' only. An element ends
// at the first end tag of its name, so a nested one of the same name undercounts, never overcounts; balance the tags
// if that misses real cases.
export function hiddenLinks(body) {
  const out = [];
  let until = 0;
  for (const m of body.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    if (m.index < until || !HIDDEN.test(attr(m[2], "style") || "")) continue;
    const start = m.index + m[0].length,
      close = body.slice(start).search(new RegExp(`</${m[1]}\\s*>`, "i"));
    if (close < 0) continue;
    until = start + close;
    const hrefs =
      m[1].toLowerCase() === "a"
        ? [attr(m[2], "href")]
        : [...body.slice(start, until).matchAll(/<a\b[^>]*>/gi)].map(x => attr(x[0], "href"));
    out.push(...hrefs.map(h => (h || "").trim().replace(/&amp;/g, "&")).filter(h => ABS.test(h)));
  }
  return out;
}

// ---------- app link files ----------
// A page promotes an app with a Google Play or App Store link, Apple's Smart App Banner tag or an android-app://
// alternate. Deep links don't change how Search shows pages.
// https://developers.google.com/search/blog/2025/05/app-deep-links
export function appPromo(html) {
  const h = noComments(html);
  return {
    android:
      /\bhref\s*=\s*["']?https?:\/\/play\.google\.com\/store\/apps\/details\?/i.test(h) ||
      /<link\b[^>]*\bhref\s*=\s*["']?android-app:\/\//i.test(h),
    ios:
      /\bhref\s*=\s*["']?https?:\/\/(?:apps|itunes)\.apple\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?app\//i.test(h) ||
      /<meta\b[^>]*\bname\s*=\s*["']?apple-itunes-app\b/i.test(h),
  };
}
// Android needs assetlinks.json as application/json with no redirects. Apple's file must not redirect either and lists
// app IDs in applinks details (appID is the older form); Apple names no content type.
// https://developer.android.com/training/app-links/configure-assetlinks
// https://developer.apple.com/documentation/xcode/supporting-associated-domains
export const APP_FILES = { android: "/.well-known/assetlinks.json", ios: "/.well-known/apple-app-site-association" };
const handlesUrls = s =>
  [].concat(s?.relation ?? []).includes("delegate_permission/common.handle_all_urls") &&
  s?.target?.namespace === "android_app" &&
  typeof s.target.package_name === "string" &&
  Array.isArray(s.target.sha256_cert_fingerprints) &&
  s.target.sha256_cert_fingerprints.length > 0;
const appIds = d => (Array.isArray(d?.appIDs) && d.appIDs.length > 0) || typeof d?.appID === "string";
// null when the file is fine, else { missing, problem }. A missing file (404, 410 or a web page) is fine for an app
// that doesn't open the site's links.
export function appFile(kind, { status, type, body }) {
  const os = kind === "android" ? "Android" : "Apple";
  if (status === 404 || status === 410) return { missing: true, problem: `isn't there (${status})` };
  if (status >= 300 && status < 400)
    return { missing: false, problem: `redirects (${status}); ${os} reads the file only when it's served directly` };
  if (status !== 200) return { missing: false, problem: `answers ${status || "nothing"}` };
  if (/^\s*</.test(body)) return { missing: true, problem: "isn't there: the server sends a web page instead" };
  let j;
  try {
    j = JSON.parse(body.replace(/^﻿/, ""));
  } catch {
    return { missing: false, problem: "isn't valid JSON" };
  }
  if (kind === "android") {
    if (!/^application\/json\b/i.test(type.trim()))
      return {
        missing: false,
        problem: `is sent as ${type.split(";")[0].trim() || "no content type"}; Android needs application/json`,
      };
    return Array.isArray(j) && j.some(handlesUrls)
      ? null
      : {
          missing: false,
          problem:
            "has no statement for an Android app (the relation delegate_permission/common.handle_all_urls, with a package_name and sha256_cert_fingerprints)",
        };
  }
  return j && typeof j === "object" && Array.isArray(j.applinks?.details) && j.applinks.details.some(appIds)
    ? null
    : { missing: false, problem: "has no applinks details with appIDs, which universal links need" };
}
