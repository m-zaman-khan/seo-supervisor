// @ts-check
// Masks what a saved or shared report must not carry: secret query values in URLs, well-known token
// formats, home-folder paths and, in error text, email addresses.
import { homedir } from "node:os";

// Query parameters whose value is a secret: a token, key, password, signature or credential (X-Amz-Signature,
// X-Goog-Credential) as a whole word of the name, so "keyword" or "monkey" aren't. Session IDs stay: the sitemap check
// shows them as evidence. "key" and "pass" alone are often filters (?key=blue), so they need a prefix (api_key,
// access-key); a bare auth= is a token (Firebase's REST API). After a # too: OAuth's implicit flow puts
// #access_token= there.
const SECRET_PARAM =
  /([?&;#](?:(?:[\w.-]*[-_.])?(?:token|apikey|secret|password|passwd|pwd|signature|sig|credential|auth)|[\w.-]*[-_.](?:key|pass))=)[^&#\s"'<>;,]*/gi;
// Tokens recognisable on their own: bearer tokens and Basic logins, Google API keys (AIza…), OAuth access and refresh
// tokens (ya29., 1//) and client secrets (GOCSPX-), JWTs, GitHub token prefixes, Slack tokens and webhook URLs, Stripe
// secret and restricted keys, AWS access key IDs (AKIA, temporary ASIA), PostHog personal keys and Perplexity keys.
// OpenAI documents no key format, so the sk- pattern is a heuristic: sk- and 20+ letters and digits with no hyphen
// after, or sk-proj-, sk-admin- or Anthropic's sk-ant-api03- and 20+ key characters, never right after / or a word
// (/blog/sk-guide-internationalization1 isn't one). The minimum lengths match checks/hygiene.mjs, so the short form it
// shows on purpose (sk_live_51Hq…) stays readable.
// https://docs.slack.dev/authentication/tokens
// https://docs.stripe.com/keys
// https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html
// https://posthog.com/docs/api
// https://docs.perplexity.ai/guides/api-key-management
const TOKENS = [
  /\b(Bearer\s+)[\w.~+/-]+=*/gi,
  /\b(Authorization:\s*Basic\s+)[A-Za-z0-9+/]+=*/gi,
  /\bAIza[\w-]{35}\b/g,
  /\bya29\.[\w.-]+/g,
  /(?<![\w/])1\/\/[\w-]{20,}/g,
  /\bGOCSPX-[\w-]+/g,
  /\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{40,})/g,
  /\b(?:xox[abeprs]|xapp|xwfp)-[A-Za-z0-9-]{20,}/g,
  /(hooks\.slack\.com\/)[\w/-]+/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bphx_\w{16,}/g,
  /\bpplx-[A-Za-z0-9]{16,}/g,
  /\bsk-[\w-]*?[A-Za-z0-9]{20}[\w-]*/g,
];
// A login in a web address (https://user:password@host): the user name and password go.
const USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@"'<>]+@/gi;
// A home folder's name ends at the next \ or /. One with spaces (C:\Users\Jane Doe\…) counts only up to 4 words,
// and only when a separator, a quote or the end of the text follows.
const HOMES =
  /(?:\b[A-Za-z]:\\Users\\|\/Users\/|\/home\/)(?:[^\\/\s"':]+(?: [^\\/\s"':]+){1,3}(?=[\\/"'`]|$)|[^\\/\s"':]+)/g;
// An address standing on its own, not a path segment such as logo@2x.png.
const EMAIL = /(?<![^\s<("':=,;[])[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi;

/** Secret query values and token formats replaced with [hidden]; the rest of the text as it was. */
export const hideSecrets = s =>
  TOKENS.reduce(
    (t, re) => t.replace(re, (m, keep) => (typeof keep === "string" ? keep : "") + "[hidden]"),
    String(s).replace(SECRET_PARAM, "$1[hidden]").replace(USERINFO, "$1[hidden]@"),
  );

// Web addresses: a site's own /home/ or /Users/ path is a page, not a home folder, so folder masking skips them.
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

/** hideSecrets, plus home folders as ~ outside web addresses and, unless emails: false, email addresses as [email]. */
export function redact(s, { home = homedir(), emails = true } = {}) {
  const t = hideSecrets(s);
  const folders = part => {
    let x = part;
    if (home && home.length > 3) for (const h of new Set([home, home.replace(/\\/g, "/")])) x = x.split(h).join("~");
    x = x.replace(HOMES, "~");
    return emails ? x.replace(EMAIL, "[email]") : x;
  };
  let out = "",
    at = 0;
  for (const m of t.matchAll(URL_RE)) {
    out += folders(t.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + folders(t.slice(at));
}
