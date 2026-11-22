// @ts-check
// The saved Google sign-in and authorized calls. Signing in stays in google.mjs, so scripts that only read data never
// load a browser, local server or prompts.
import { sign } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Fail, Refused } from "../lib/cli.mjs";
import { loginDir } from "../lib/settings-dir.mjs";

export const SC = "https://www.googleapis.com/auth/webmasters.readonly",
  GA = "https://www.googleapis.com/auth/analytics.readonly";
export const SCOPES = [SC, GA];
// Each address can be overridden with SEO_GOOGLE_<NAME>_URL, e.g. SEO_GOOGLE_SEARCH_CONSOLE_URL.
const DEFAULTS = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  searchConsole: "https://www.googleapis.com/webmasters/v3",
  inspection: "https://searchconsole.googleapis.com/v1",
  analyticsAdmin: "https://analyticsadmin.googleapis.com/v1beta",
  analyticsData: "https://analyticsdata.googleapis.com/v1beta",
};
export const endpointsFrom = (over = {}) =>
  Object.fromEntries(
    Object.entries(DEFAULTS).map(([k, v]) => [
      k,
      over[k] || process.env[`SEO_GOOGLE_${k.replace(/[A-Z]/g, c => "_" + c).toUpperCase()}_URL`] || v,
    ]),
  );
export { Fail, Refused }; // lib/cli.mjs's classes, so instanceof checks agree
export const fail = msg => {
  throw new Fail(msg);
};
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
export const FORM = { "content-type": "application/x-www-form-urlencoded" };

// ---------- the saved sign-in ----------
// In the settings folder, per client with SEO_SUPERVISOR_CLIENT (lib/settings-dir.mjs).
export const tokenFile = (home = homedir()) => join(loginDir(process.env, home), "google.json");
export const load = file => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
// Renamed over the old file, so a crash never leaves half a sign-in.
// Readable by this user only where the system has file modes.
export function save(file, data) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(dirname(file), 0o700); // Windows ignores modes; the file is in the user's own profile there
  const t = `${file}.${process.pid}.tmp`;
  writeFileSync(t, typeof data === "string" ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(t, 0o600);
  renameSync(t, file);
}

export async function tokenRequest(E, params) {
  let r;
  // A missing value (a client with no secret) is left out, never sent as "undefined".
  const body = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ""));
  try {
    r = await fetch(E.token, { method: "POST", headers: FORM, body, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    fail(
      `google: couldn't reach Google's sign-in server (${e.cause?.code || e.message}). Check the internet connection and try again.`,
    );
  }
  const j = /** @type {any} */ (await r.json().catch(() => ({})));
  if (r.ok && j.access_token)
    return {
      access_token: j.access_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000,
      ...(j.refresh_token ? { refresh_token: j.refresh_token } : {}),
      ...(j.scope ? { scope: j.scope } : {}),
    };
  if (j.error === "invalid_grant")
    fail(
      `google: Google didn't accept the sign-in (${j.error_description || "invalid_grant"}). It may have been removed or expired: run node google.mjs connect again.`,
    );
  fail(
    `google: Google's sign-in server answered ${r.status}${j.error ? ` ${j.error}` : ""}${j.error_description ? `: ${j.error_description}` : ""}.`,
  );
}

// Service accounts sign their own RS256 JWT and trade it for an access token. There's no refresh token: a new JWT
// renews it, for the scopes saved with it.
// https://developers.google.com/identity/protocols/oauth2/service-account
function serviceAccountJwt(key) {
  const iat = Math.floor(Date.now() / 1000),
    b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT", ...(key.private_key_id ? { kid: key.private_key_id } : {}) })}.${b64({ iss: key.client_email, scope: key.scope || SCOPES.join(" "), aud: key.token_uri || DEFAULTS.token, iat, exp: iat + 3600 })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), key.private_key).toString("base64url")}`;
}
export const serviceAccountToken = (E, key) =>
  tokenRequest(E, { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountJwt(key) });
function renew(E, s) {
  if (s.method === "service-account") return serviceAccountToken(E, s);
  if (!s.refresh_token) fail("google: the saved sign-in can't renew itself. Run node google.mjs connect again.");
  return tokenRequest(E, {
    grant_type: "refresh_token",
    refresh_token: s.refresh_token,
    client_id: s.client.id,
    client_secret: s.client.secret,
  });
}

// Authorized JSON calls: renews an expired token first, renews once more on a 401, retries a 429 once.
/** @param {{ home?: string, endpoints?: any }} [opts] */
export function session({ home, endpoints } = {}) {
  const E = endpointsFrom(endpoints),
    file = tokenFile(home);
  let s = load(file);
  if (!s)
    fail(
      "google: not connected to Google yet. Run node google.mjs connect (or node google.mjs guide to set it up yourself).",
    );
  const refresh = async () => {
    s = { ...s, ...(await renew(E, s)) };
    save(file, s);
  };
  async function call(url, body, method = body ? "POST" : "GET") {
    let renewed = false,
      retried = false;
    for (;;) {
      if (!s.access_token || Date.now() > s.expires_at - 60000) await refresh();
      const r = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${s.access_token}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      }).catch(e =>
        fail(
          `google: couldn't reach Google (${e.cause?.code || e.message}). Check the internet connection and try again.`,
        ),
      );
      if (r.status === 401 && !renewed) {
        renewed = true;
        await r.text();
        await refresh();
        continue;
      }
      if (r.status === 429 && !retried) {
        retried = true;
        await r.text();
        const ra = Number(r.headers.get("retry-after") ?? 2);
        await sleep(Math.min(isNaN(ra) ? 2 : ra, 30) * 1000);
        continue;
      }
      const j = /** @type {any} */ (await r.json().catch(() => ({})));
      if (r.ok) return j;
      throw Object.assign(new Error(j.error?.message || `HTTP ${r.status}`), { status: r.status });
    }
  }
  return { E, call, store: () => s };
}

export const API_OFF = /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i;
export const whoOf = s => (s.method === "service-account" ? `The service account ${s.client_email}` : undefined);
// A plain sentence for a failed call: what went wrong and how to fix it.
export function explain(e, what, api, who = "The connected Google account") {
  if (e instanceof Fail) return e.message.replace(/^google: /, "");
  if (e.status === 403 && API_OFF.test(e.message))
    return `The ${api.name} is turned off in the Google Cloud project your sign-in uses, so ${what} couldn't be read. Turn it on at https://console.cloud.google.com/apis/library (search "${api.name}", click Enable), wait a minute, then try again.`;
  if (e.status === 403)
    return `${who} doesn't have access to ${what}. Ask the owner to add it under ${api.where}, or connect with an account that has access (node google.mjs disconnect, then connect).`;
  if (e.status === 401) return `Google didn't accept the saved sign-in for ${what}. Run node google.mjs connect again.`;
  if (e.status === 429)
    return `Google said too many requests for ${what} (a usage limit). Try again in a few minutes, or tomorrow.`;
  if (e.status === 404) return `Google couldn't find ${what} (${e.message}).`;
  return `Google answered ${e.status || "with an error"} for ${what}: ${e.message}`;
}
