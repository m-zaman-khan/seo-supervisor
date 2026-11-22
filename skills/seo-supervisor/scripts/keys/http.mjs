// @ts-check
// Shared by connect-keys.mjs's services: errors, checks on typed addresses and IDs, one request with a plain refusal,
// and helpers. Callers pass their SERVICES entry in, so service modules can use this without an import loop.
const UA = "seo-supervisor-connect-keys";
export class Fail extends Error {} // bad input: exit 2
export class Refused extends Error {} // a service said no: noted, the rest still runs, exit 1
export const fail = msg => {
  throw new Fail("connect-keys: " + msg);
};
export const setLine = id => `node connect-keys.mjs set ${id}`;
export const PASTE =
  "   Paste the key when it asks and press Enter. It isn't shown, so it stays out of chats and your command history.";
// A typed address, kept as origin and path ending in "/": https:// added when missing, a page such as index.php and
// anything after it dropped. Plain http only on this computer, since the token travels with it.
export function address(s, what) {
  let x;
  try {
    x = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "https://" + s);
  } catch {}
  if (!x || !/^https?:$/.test(x.protocol)) fail(`${what} isn't a web address (got "${s}").`);
  if (x.protocol === "http:" && !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(x.hostname))
    fail(`${what} must start with https://. Over plain http:// your token would travel unencrypted.`);
  return x.origin + x.pathname.replace(/[^/]*\.php$/, "").replace(/\/*$/, "/");
}
export function idOf(s, what, where) {
  return /^\d+$/.test(s) ? s : fail(`the ${what} is a number, like 1 or 3 (got "${s}"). Find it ${where}.`);
}
// https://learn.microsoft.com/dotnet/api/microsoft.bing.webmaster.api.interfaces.apierrorcode
const BING_ERRORS = { 3: "key", 4: "busy", 5: "busy", 6: "blocked", 7: "url", 14: "site" };
// Matomo and PostHog live at a typed address, so a wrong address, site or project ID gets its own message.
// Matomo answers errors as { result: "error", message }, often with HTTP 200; PostHog as { detail } with the status.
function addressed(id, s, status, body, host, moved) {
  const fix = `Check it with node connect-keys.mjs guide ${id}, then run: ${setLine(id)}`,
    msg = String(body?.message || body?.detail || "");
  if (status >= 300 && status < 400)
    return `${s.name}: ${host} sent the request on to ${moved || "another address"}, so nothing was read. Set the address it goes to instead. ${fix}`;
  if (body === null && status < 500)
    return `${s.name}: ${host} didn't answer like ${s.name} (HTTP ${status}), so the address is probably wrong. Use the address you open ${s.name} at in your browser. ${fix}`;
  if (id === "matomo") {
    if (/authenticat|token/i.test(msg))
      return `Matomo didn't accept the token: it's mistyped, expired or was deleted. Create a new one under ${s.where}, then run: ${setLine(id)}`;
    if (/segment/i.test(msg))
      return `Matomo hasn't processed the segment for visits from search engines, so it has no report yet. In Matomo, open the segment menu above any report → Add new segment, choose Channel Type, Is, search, and save it with its reports pre-processed. Matomo fills it in within a few hours; then fetch again.`;
    if (/access|website id|idsite/i.test(msg))
      return `Matomo says this token can't see the site ID you set (${msg}). Check the site ID under Administration → Websites → Manage, and that the token's user has at least view access to that site. Then run: ${setLine(id)}`;
    if (body?.result === "error") return `Matomo said: ${msg}`;
  }
  if (id === "posthog") {
    if (status === 401)
      return `PostHog didn't accept the key (401): it's mistyped or was deleted, or it belongs to the other PostHog region (a US key doesn't work on eu.posthog.com, nor an EU key on us.posthog.com). ${fix}`;
    if (status === 403 && /scope/i.test(msg))
      return `PostHog says the key isn't allowed to read data (it lacks the Query Read permission). Create a personal API key with Query: Read under ${s.where}, then run: ${setLine(id)}`;
    if (status === 403 || status === 404)
      return `PostHog has no project with the ID you set that this key may use (${status}${msg ? `: ${msg}` : ""}). Check the project ID under Settings → Project, and that the key is allowed to use that project. ${fix}`;
    if (status === 400)
      return `PostHog couldn't run the query for visits from search engines (${msg || 400}). If it keeps happening, PostHog may have changed.`;
  }
  return null;
}
// s: the service's entry in SERVICES. retry: the Retry-After header, in seconds or as a date (lib/http.mjs).
export function refusal(id, s, status, body, retryAfter, host, moved) {
  if (s.fields) {
    const m = addressed(id, s, status, body, host, moved);
    if (m) return m;
  }
  const bing = id === "bing" ? BING_ERRORS[body?.ErrorCode] : null;
  // Moz's -32670 (HTTP 403, insufficient-quota) is a used-up month; it's checked before the call runs, so it costs
  // nothing. https://moz.com/api/docs/guides/error-handling
  if (id === "moz" && (body?.error?.code === -32670 || /quota/i.test(body?.error?.data?.issue || "")))
    return `Moz says the rows for this month are used up (the free plan has 50 rows a month, one per domain). Nothing was charged for this request. The rows refill next month, or you can upgrade at moz.com/products/api/pricing.`;
  // quotaExceeded and rateLimitExceeded are YouTube's; a turned-off API and a bad key are Google Cloud's general
  // errors, matched by reason or message as google.mjs does. https://developers.google.com/youtube/v3/docs/errors
  if (id === "youtube") {
    const why = String(body?.error?.errors?.[0]?.reason || body?.error?.status || ""),
      msg = String(body?.error?.message || "");
    if (/quotaExceeded|rateLimitExceeded/.test(why))
      return `YouTube Data API says the key's quota is used up for now (search has 100 calls a day, everything else 10,000 units a day). Try again tomorrow.`;
    if (/accessNotConfigured|SERVICE_DISABLED/.test(why) || /has not been used|is disabled/i.test(msg))
      return `YouTube Data API v3 isn't turned on in the key's Google Cloud project. Open console.cloud.google.com → APIs & Services → Library, search "YouTube Data API v3" and click Enable, wait a minute, then fetch again.`;
    if (/keyInvalid|API_KEY_INVALID/.test(why) || /API key not valid/i.test(msg))
      return `YouTube Data API didn't accept the key: it's mistyped, deleted, or limited to other APIs. Check it at ${s.where}, then run: ${setLine(id)}`;
  }
  // Microsoft's error table: 401 a missing, invalid or expired token, 403 "Token not authorized for operation", 429
  // "Exceeded daily limit" (10 requests per project per day).
  if (id === "clarity") {
    if (status === 401)
      return `Microsoft Clarity didn't accept the token (401): it's mistyped, expired or was replaced. Make a new one under ${s.where}, then run: ${setLine(id)}`;
    if (status === 403)
      return `Microsoft Clarity says this token can't read the project's data (403). A project admin can make a new token under ${s.where}; then run: ${setLine(id)}`;
    if (status === 429)
      return `Microsoft Clarity allows 10 requests a day per project, and today's are used up (429). Fetch again tomorrow.`;
  }
  // Google Cloud's ErrorInfo reasons come in error.details. A Place Details 404 means an obsolete or wrong place ID.
  // https://github.com/googleapis/googleapis/blob/master/google/api/error_reason.proto
  // https://developers.google.com/maps/documentation/places/web-service/place-id
  if (id === "googleplaces") {
    const why = (Array.isArray(body?.error?.details) ? body.error.details : []).map(d => d?.reason).join(" "),
      msg = String(body?.error?.message || "");
    if (/API_KEY_INVALID/.test(why) || /API key not valid/i.test(msg))
      return `Google Places API didn't accept the key: it's mistyped or was deleted. Check it at ${s.where}, then run: ${setLine(id)}`;
    if (/API_KEY_SERVICE_BLOCKED/.test(why))
      return `The key isn't allowed to use Places API (New). At ${s.where}, open the key and select Places API (New) under API restrictions, then run again.`;
    if (/SERVICE_DISABLED/.test(why) || /has not been used|is disabled/i.test(msg))
      return `Places API (New) isn't turned on in the key's Google Cloud project. Open console.cloud.google.com/apis/library/places.googleapis.com and click Enable, wait a few minutes, then run again.`;
    if (/BILLING_DISABLED/.test(why) || /billing/i.test(msg))
      return `Google says billing isn't turned on for the key's Google Cloud project. Google requires it for the Places API even when your use stays within the free amounts. Turn it on at console.cloud.google.com/billing, then run again.`;
    if (status === 404)
      return `Google has no place with this place ID (404): it's mistyped, or out of date (a place ID can change when a business moves or Google updates its data). Find the current one at https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder or with geo-grid.mjs --find.`;
  }
  // Perplexity's 402 is an account with no credits. An OpenAI 429 whose error.code names credits or a spend or usage
  // limit, or whose type is insufficient_quota, isn't a rate limit, so retrying won't help.
  // https://docs.perplexity.ai/docs/resources/faq
  // https://developers.openai.com/api/docs/guides/error-codes
  if (id === "perplexity" && status === 402)
    return `Perplexity says the account has no API credits left (402). Buy credits on the Billing page (console.perplexity.ai/project/billing), or turn on auto top-up, then run again.`;
  if (
    id === "openai" &&
    status === 429 &&
    /credit|spend_limit|usage_limit|insufficient_quota/.test(`${body?.error?.code} ${body?.error?.type}`)
  )
    return `OpenAI says the account can't pay for more requests (${body.error.code || body.error.type}): it has no credits left, or reached a spend or usage limit. Add credits or raise the limit at platform.openai.com/settings/organization/billing, then run again. Trying again before that won't help.`;
  if (status === 401 || bing === "key")
    return `${s.name} didn't accept the key (${status === 401 ? 401 : "InvalidApiKey"}): it's mistyped, or it was deleted or replaced. Get the current key at ${s.where}, then run: ${setLine(id)}`;
  if (id === "openpagerank" && status === 403)
    return `Open PageRank refused the request (403): your IP address isn't the one registered for this key. Free keys only work from one registered IP address, so your internet connection or IP has probably changed. Update the IP in your Open PageRank dashboard (keywordseverywhere.com/openpagerank); it can change once a week.`;
  if (status === 429 || bing === "busy")
    return `${s.name} says too many requests (${status === 429 ? 429 : "throttled"}): the key's limit is used up for now. ${retryAfter ? `Wait ${retryAfter} seconds` : "Wait a while"} and run again.`;
  if (bing === "site")
    return `Bing Webmaster Tools says this key's account can't see the site (NotAuthorized). Verify the site in Bing Webmaster Tools with the same account the key belongs to.`;
  if (bing === "blocked")
    return `Bing Webmaster Tools says the account is blocked (UserBlocked). Sign in at bing.com/webmasters to see why.`;
  if (bing === "url")
    return `Bing Webmaster Tools refused a URL (InvalidUrl): every URL must be on the site exactly as it's verified in Bing Webmaster Tools (the same https:// and www). Check the site's address there and pass it as --site.`;
  if (status === 403)
    return `${s.name} refused the request (403): the key isn't allowed to do this. Check the key at ${s.where}, then run: ${setLine(id)}`;
  const detail =
    body?.Message ||
    body?.message ||
    body?.detail ||
    body?.error?.message ||
    (typeof body?.error === "string" ? body.error : "") ||
    (Array.isArray(body) ? body.join(" ") : "");
  return `${s.name} answered ${status}${detail ? ` (${detail})` : ""}. Try again later; if it keeps happening, the service may have changed.`;
}
// One call to a service; connect-keys.mjs's call(id, url, init) passes SERVICES[id] as s.
export async function request(id, s, url, init = {}) {
  const host = new URL(url).host;
  let r;
  try {
    r = await fetch(url, {
      ...init,
      headers: { "user-agent": UA, ...init.headers },
      signal: AbortSignal.timeout(s.timeout || 30000),
    });
  } catch (e) {
    throw new Refused(
      `${s.name}: couldn't reach ${host} (${e.cause?.code || e.message}). Check the internet connection${s.fields ? ` and the ${s.name} address (node connect-keys.mjs status shows it)` : ""} and try again.`,
    );
  }
  const text = await r.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!r.ok)
    throw new Refused(refusal(id, s, r.status, body, r.headers.get("retry-after"), host, r.headers.get("location")));
  return body;
}
// A redirect isn't followed: on a 307 or 308 the token would go along to wherever it points.
export const POST = { method: "POST", redirect: "manual" };

// ---------- helpers ----------
export const chunks = (list, n) =>
  Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
export const bare = h => h.toLowerCase().replace(/^www\./, "");
export const domainOf = s => {
  try {
    const h = bare(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "https://" + s).hostname);
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : null;
  } catch {
    return null;
  }
};
// The site's domain and the competitors', each once; a site with no domain name (localhost) is left out.
export const domainsFor = (siteUrl, competitors) =>
  [domainOf(siteUrl), ...competitors.map(domainOf)].filter((d, i, all) => d && all.indexOf(d) === i);
export const hostOf = u => {
  try {
    return bare(new URL(u).hostname);
  } catch {
    return null;
  }
};
export const day = ms => new Date(ms).toISOString().slice(0, 10);
export const isDay = d => /^\d{4}-\d\d-\d\d$/.test(d);
export const num = n => n.toLocaleString("en-US");
