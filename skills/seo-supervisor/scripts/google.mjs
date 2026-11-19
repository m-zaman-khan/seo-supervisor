#!/usr/bin/env node
// Search Console and GA4 data for the audit, read-only.
// The sign-in is saved in the home folder, never in the project.
// Each Google address can be overridden with SEO_GOOGLE_<NAME>_URL, e.g. SEO_GOOGLE_SEARCH_CONSOLE_URL.
// SEO_GOOGLE_SHARED_CLIENT_ID and SEO_GOOGLE_SHARED_CLIENT_SECRET override the shared client; empty means none.
import { createHash, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { SHARED_CLIENT } from "./lib/google-client.mjs";
import { addTraffic, gscFindings } from "./gsc-import.mjs";

const SC = "https://www.googleapis.com/auth/webmasters.readonly",
  GA = "https://www.googleapis.com/auth/analytics.readonly";
const SCOPES = [SC, GA];
const DEFAULTS = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  searchConsole: "https://www.googleapis.com/webmasters/v3",
  inspection: "https://searchconsole.googleapis.com/v1",
  analyticsAdmin: "https://analyticsadmin.googleapis.com/v1beta",
  analyticsData: "https://analyticsdata.googleapis.com/v1beta",
};
const endpointsFrom = (over = {}) =>
  Object.fromEntries(
    Object.entries(DEFAULTS).map(([k, v]) => [
      k,
      over[k] || process.env[`SEO_GOOGLE_${k.replace(/[A-Z]/g, c => "_" + c).toUpperCase()}_URL`] || v,
    ]),
  );
const SC_API = { name: "Google Search Console API", where: "Search Console → Settings → Users and permissions" };
const ADMIN_API = {
  name: "Google Analytics Admin API",
  where: "Google Analytics → Admin → Property access management",
};
const DATA_API = { name: "Google Analytics Data API", where: ADMIN_API.where };

class Fail extends Error {}
const fail = msg => {
  throw new Fail(msg);
};
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const FORM = { "content-type": "application/x-www-form-urlencoded" };

export const challengeFor = verifier => createHash("sha256").update(verifier).digest("base64url");
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: challengeFor(verifier) };
}

// ---------- the saved sign-in ----------
const tokenFile = (home = homedir()) => join(home, ".seo-supervisor", "google.json");
const pendingFile = () => join(homedir(), ".seo-supervisor", "pending-signin.txt");
const load = file => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
// Renamed over the old file, so a crash never leaves half a sign-in.
// Readable by this user only where the system has file modes.
function save(file, data) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  chmodSync(dirname(file), 0o700); // Windows ignores modes; the file is in the user's own profile there
  const t = `${file}.${process.pid}.tmp`;
  writeFileSync(t, typeof data === "string" ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(t, 0o600);
  renameSync(t, file);
}
const readJson = f => {
  let t;
  try {
    t = readFileSync(f, "utf8");
  } catch (e) {
    fail(`google: can't read ${f} (${e.code || e.message}).`);
  }
  try {
    return JSON.parse(t);
  } catch {
    fail(`google: ${f} isn't a JSON file from Google Cloud.`);
  }
};

async function tokenRequest(E, params) {
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
  const j = await r.json().catch(() => ({}));
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

// Service accounts trade a self-signed RS256 JWT for an access token. There's no refresh token: a new JWT renews it.
// https://developers.google.com/identity/protocols/oauth2/service-account
function serviceAccountJwt(key) {
  const iat = Math.floor(Date.now() / 1000),
    b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT", ...(key.private_key_id ? { kid: key.private_key_id } : {}) })}.${b64({ iss: key.client_email, scope: SCOPES.join(" "), aud: key.token_uri || DEFAULTS.token, iat, exp: iat + 3600 })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), key.private_key).toString("base64url")}`;
}
const serviceAccountToken = (E, key) =>
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
function session({ home, endpoints } = {}) {
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
  async function call(url, body) {
    let renewed = false,
      retried = false;
    for (;;) {
      if (!s.access_token || Date.now() > s.expires_at - 60000) await refresh();
      const r = await fetch(url, {
        method: body ? "POST" : "GET",
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
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      throw Object.assign(new Error(j.error?.message || `HTTP ${r.status}`), { status: r.status });
    }
  }
  return { E, call, store: () => s };
}

function explain(e, what, api, who = "The connected Google account") {
  if (e instanceof Fail) return e.message.replace(/^google: /, "");
  if (e.status === 403 && /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(e.message))
    return `The ${api.name} is turned off in the Google Cloud project your sign-in uses, so ${what} couldn't be read. Turn it on at https://console.cloud.google.com/apis/library (search "${api.name}", click Enable), wait a minute, then try again.`;
  if (e.status === 403)
    return `${who} doesn't have access to ${what}. Ask the owner to add it under ${api.where}, or connect with an account that has access (node google.mjs disconnect, then connect).`;
  if (e.status === 401) return `Google didn't accept the saved sign-in for ${what}. Run node google.mjs connect again.`;
  if (e.status === 429)
    return `Google said too many requests for ${what} (a usage limit). Try again in a few minutes, or tomorrow.`;
  if (e.status === 404) return `Google couldn't find ${what} (${e.message}).`;
  return `Google answered ${e.status || "with an error"} for ${what}: ${e.message}`;
}

// ---------- fetch ----------
// crawl, a parsed seo-crawl.json, lets URL Inspection sample key pages with no search traffic yet.
export async function fetchGoogle({ site, days = 90, ga4Property, crawl, pageSize = 25000, home, endpoints } = {}) {
  let origin;
  try {
    origin = new URL(site);
  } catch {}
  if (!origin || !/^https?:$/.test(origin.protocol))
    fail(`google: --site must be the site's address, like https://www.example.com (got ${site}).`);
  days = Math.round(Number(days));
  if (!(days >= 1 && days <= 480)) fail("google: --days must be between 1 and 480 (Search Console keeps 16 months).");
  const g = session({ home, endpoints }),
    { E } = g,
    notes = [],
    s0 = g.store();
  const who = s0.method === "service-account" ? `The service account ${s0.client_email}` : undefined;
  const scope = s0.scope || SCOPES.join(" ");
  if (!scope.includes(SC))
    fail(
      "google: Search Console access wasn't granted when you signed in. Run node google.mjs connect again and leave the Search Console box ticked.",
    );
  // A failed section becomes a note. A fatal one stops the pull, except on 429: a used-up quota is still only a note.
  const attempt = async (what, api, fn, fatal = false) => {
    try {
      return await fn();
    } catch (e) {
      const msg = explain(e, what, api, who);
      if (fatal && e.status !== 429) fail("google: " + msg);
      notes.push(msg);
    }
  };

  // Search Console's last 2-3 days are provisional, so the period ends 3 days ago.
  const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const endDate = day(3),
    startDate = day(days + 2),
    period = `Last ${days} days, ${startDate} to ${endDate}`;

  // The property: a domain property covering the host, else the longest URL-prefix property the site sits under.
  let sites;
  try {
    sites = ((await g.call(`${E.searchConsole}/sites`)).siteEntry || []).filter(
      x => x.permissionLevel !== "siteUnverifiedUser",
    );
  } catch (e) {
    fail("google: " + explain(e, "the list of Search Console properties", SC_API, who));
  }
  const h = origin.hostname,
    href = origin.origin + origin.pathname;
  const prop = (
    sites.find(
      x => x.siteUrl.startsWith("sc-domain:") && (h === x.siteUrl.slice(10) || h.endsWith("." + x.siteUrl.slice(10))),
    ) || sites.filter(x => href.startsWith(x.siteUrl)).sort((a, b) => b.siteUrl.length - a.siteUrl.length)[0]
  )?.siteUrl;
  if (!prop)
    fail(
      `google: ${origin.origin} isn't in the Search Console properties this account can see (${sites.map(x => x.siteUrl).join(", ") || "it can't see any"}). Add and verify the site in Search Console, or connect with the Google account that has it.`,
    );
  const scBase = `${E.searchConsole}/sites/${encodeURIComponent(prop)}`;

  // www and apex count as one host, as in gsc-import; other subdomains of a domain property are left out.
  const bare = x => x.replace(/^www\./, "");
  const pathOf = u => {
    try {
      const x = new URL(u);
      return bare(x.hostname) === bare(h) ? x.pathname + x.search : null;
    } catch {
      return null;
    }
  };
  const metrics = r => ({
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: Math.round(r.ctr * 10000) / 10000,
    position: Math.round(r.position * 10) / 10,
  });
  const rowsFor = async dimensions => {
    const rows = [];
    while (rows.length < 25000) {
      const rowLimit = Math.min(pageSize, 25000 - rows.length),
        got =
          (
            await g.call(`${scBase}/searchAnalytics/query`, {
              startDate,
              endDate,
              dimensions,
              type: "web",
              rowLimit,
              startRow: rows.length,
            })
          ).rows || [];
      rows.push(...got);
      if (got.length < rowLimit) break;
    }
    if (rows.length >= 25000)
      notes.push(
        `Search Console has 25,000 or more ${{ page: "pages", query: "queries" }[dimensions.join()] || "page and query pairs"} for this period; only the top 25,000 were read, so the least-searched ones are left out.`,
      );
    return rows;
  };
  const traffic = {},
    urls = {},
    pageQueries = {},
    pq = {};
  let queries = [];
  await attempt(
    `${prop} in Search Console`,
    SC_API,
    async () => {
      for (const r of await rowsFor(["page"])) {
        const p = pathOf(r.keys[0]);
        if (p) {
          urls[p] ||= r.keys[0];
          addTraffic(traffic, p, metrics(r));
        }
      }
      queries = (await rowsFor(["query"])).map(r => ({ query: r.keys[0], ...metrics(r) }));
      for (const r of await rowsFor(["page", "query"])) {
        const p = pathOf(r.keys[0]);
        if (p) {
          urls[p] ||= r.keys[0];
          addTraffic((pq[p] ||= {}), r.keys[1], metrics(r));
        }
      }
      for (const [p, list] of Object.entries(pq))
        pageQueries[p] = Object.entries(list).map(([query, m]) => ({ query, ...m }));
    },
    true,
  );

  // URL Inspection samples the home page, up to 10 crawled pages (shallowest, most linked), then top pages by
  // clicks, 20 in all; Google allows 2,000 a day. The crawl may be of a local build, so only its paths are used.
  const pathOnly = u => {
    try {
      const x = new URL(u);
      return x.pathname + x.search;
    } catch {
      return null;
    }
  };
  const crawled = (crawl?.pages || [])
    .filter(p => p.status === 200 && !p.noindex)
    .sort((a, b) => (a.depth ?? 99) - (b.depth ?? 99) || (b.linksIn || 0) - (a.linksIn || 0))
    .map(p => pathOnly(p.url))
    .filter(Boolean);
  const top = Object.entries(traffic)
    .sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions)
    .map(([p]) => p);
  const inspection = [];
  await attempt("URL Inspection in Search Console", SC_API, async () => {
    for (const p of [...new Set(["/", ...crawled.slice(0, 10), ...top])].slice(0, 20)) {
      const url = urls[p] || new URL(p, origin).href;
      const r =
          (await g.call(`${E.inspection}/urlInspection/index:inspect`, { inspectionUrl: url, siteUrl: prop }))
            .inspectionResult || {},
        x = r.indexStatusResult || {};
      inspection.push({
        url,
        verdict: x.verdict ?? null,
        coverageState: x.coverageState ?? null,
        indexingState: x.indexingState ?? null,
        robotsTxtState: x.robotsTxtState ?? null,
        pageFetchState: x.pageFetchState ?? null,
        googleCanonical: x.googleCanonical ?? null,
        userCanonical: x.userCanonical ?? null,
        lastCrawlTime: x.lastCrawlTime ?? null,
        link: r.inspectionResultLink ?? null,
      });
    }
  });

  const sitemaps = [];
  await attempt("the sitemaps in Search Console", SC_API, async () => {
    for (const x of (await g.call(`${scBase}/sitemaps`)).sitemap || [])
      sitemaps.push({
        path: x.path,
        lastSubmitted: x.lastSubmitted ?? null,
        lastDownloaded: x.lastDownloaded ?? null,
        isPending: !!x.isPending,
        errors: Number(x.errors || 0),
        warnings: Number(x.warnings || 0),
      });
    if (!sitemaps.length)
      notes.push(
        `No sitemap is submitted in Search Console for ${prop}. Submit one under Indexing → Sitemaps so Google finds new and changed pages sooner.`,
      );
  });

  // GA4: --ga4-property, else the one property whose web stream is this site (even when it's the only one).
  const analytics = {};
  let gaProp = ga4Property ? String(ga4Property).replace(/^properties\//, "") : null;
  if (!scope.includes(GA))
    notes.push(
      "Google Analytics wasn't included when you signed in, so there's no visit data. To add it, run node google.mjs connect again and leave the Google Analytics box ticked.",
    );
  else {
    if (!gaProp)
      await attempt("the Google Analytics property list", ADMIN_API, async () => {
        const props = (
          (await g.call(`${E.analyticsAdmin}/accountSummaries?pageSize=200`)).accountSummaries || []
        ).flatMap(a => (a.propertySummaries || []).map(p => ({ id: p.property.split("/")[1], name: p.displayName })));
        if (!props.length) {
          notes.push(
            "The connected account can't see any Google Analytics 4 property, so there's no visit data. Add it under " +
              ADMIN_API.where +
              ".",
          );
          return;
        }
        // Only the first 50 properties' web streams are checked; accounts with more pass --ga4-property.
        const hostOf = u => {
          try {
            return bare(new URL(/^https?:/.test(u) ? u : "https://" + u).hostname);
          } catch {
            return null;
          }
        };
        const matches = [],
          name = p => `${p.name} (${p.id})`;
        for (const p of props.slice(0, 50))
          if (
            ((await g.call(`${E.analyticsAdmin}/properties/${p.id}/dataStreams`)).dataStreams || []).some(
              d => hostOf(d.webStreamData?.defaultUri || "") === bare(h),
            )
          )
            matches.push(p);
        if (matches.length === 1) gaProp = matches[0].id;
        else if (props.length === 1)
          notes.push(
            `The only Google Analytics 4 property this account can see, ${name(props[0])}, has no web stream for ${h}, so its visits weren't used. If it is this site's property, run fetch again with --ga4-property ${props[0].id}.`,
          );
        else
          notes.push(
            `${matches.length ? "Several" : "None of the"} Google Analytics 4 properties ${matches.length ? "match" : "matches"} ${h}. Pick one with --ga4-property <id>: ${(matches.length ? matches : props).slice(0, 10).map(name).join(", ")}.`,
          );
      });
    if (gaProp)
      await attempt(`Google Analytics property ${gaProp}`, DATA_API, async () => {
        const rep = await g.call(`${E.analyticsData}/properties/${gaProp}:runReport`, {
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: "landingPage" }],
          metrics: [{ name: "sessions" }, { name: "engagedSessions" }],
          dimensionFilter: {
            filter: {
              fieldName: "sessionDefaultChannelGroup",
              stringFilter: { matchType: "EXACT", value: "Organic Search" },
            },
          },
          limit: 25000,
        });
        for (const r of rep.rows || []) {
          const p = r.dimensionValues?.[0]?.value;
          if (p && p !== "(not set)")
            analytics[p] = { sessions: Number(r.metricValues[0].value), engaged: Number(r.metricValues[1].value) };
        }
        if (rep.rowCount > 25000)
          notes.push(`Google Analytics has ${rep.rowCount} organic landing pages; only the top 25,000 are included.`);
      });
  }

  // ---------- findings ----------
  const own = [];
  const finding = (check, rule, severity, category, title, why, fix, evidence) => {
    if (!evidence.length) return;
    own.push({
      check,
      rule,
      severity,
      category,
      title,
      what: `${evidence.length === 1 ? "Found on" : `${evidence.length} cases, for example`} ${evidence[0].url} (${evidence[0].detail}).`,
      why,
      fix,
      count: evidence.length,
      evidence,
      source: "search-console",
      status: "open",
    });
  };
  // Only states where Google left the page out are findings. Others are notes: "URL is unknown to Google" is often a
  // page that isn't live yet, "Page with redirect" a redirect doing its job.
  const EXCLUDED =
    /currently not indexed|noindex|blocked by robots\.txt|duplicate|soft 404|not found|server error|redirect error|blocked due to/i;
  const outOfIndex = inspection.filter(i => i.verdict === "FAIL" || i.verdict === "NEUTRAL"),
    other = outOfIndex.filter(i => !EXCLUDED.test(i.coverageState || ""));
  if (other.length)
    notes.push(
      `URL Inspection: ${other.length} inspected page(s) aren't in Google's index for a reason that usually isn't a problem: ${other
        .slice(0, 10)
        .map(i => `${i.url} (${i.coverageState || "no reason given"})`)
        .join(
          ", ",
        )}. "URL is unknown to Google" means Google hasn't found the page yet: if it's live, link to it and list it in the sitemap. "Page with redirect" means Google indexes the redirect's target instead.`,
    );
  const notIndexed = outOfIndex
    .filter(i => !other.includes(i))
    .map(i => ({
      url: i.url,
      detail: `${i.coverageState}${i.lastCrawlTime ? `, last crawled ${i.lastCrawlTime.slice(0, 10)}` : ""}`,
    }));
  finding(
    "gsc-not-indexed",
    "CRAWL-02",
    "high",
    "Crawling & indexing",
    `${notIndexed.length} key page(s) aren't in Google's index`,
    "Search Console's URL Inspection says Google hasn't indexed these pages, so they can't appear in search at all.",
    "Open each page in Search Console's URL Inspection to see the reason. Fix what it names (a noindex, a robots.txt block, a redirect, thin or duplicate content), link to the page from related pages, then click Request indexing.",
    notIndexed,
  );
  const canon = inspection
    .filter(i => i.googleCanonical && i.userCanonical && i.googleCanonical !== i.userCanonical)
    .map(i => ({ url: i.url, detail: `Google chose ${i.googleCanonical}, the page declares ${i.userCanonical}` }));
  finding(
    "gsc-canonical-differs",
    "URL-04",
    "medium",
    "URLs & canonicals",
    `${canon.length} page(s) where Google picked a different canonical than the page declares`,
    "Google ranks the URL it picked instead, so links and signals collect there and the declared page may not show.",
    "Make the canonical tag, internal links, the sitemap and redirects all point at the same URL. If the two pages are near-duplicates, make them clearly different or merge them.",
    canon,
  );
  const broken = sitemaps
    .filter(x => x.errors > 0)
    .map(x => ({
      url: x.path,
      detail: `${x.errors} errors, ${x.warnings} warnings${x.lastDownloaded ? `, last read ${x.lastDownloaded.slice(0, 10)}` : ""}`,
    }));
  finding(
    "gsc-sitemap-errors",
    "MAP-01",
    "medium",
    "Sitemaps & robots",
    `${broken.length} submitted sitemap(s) have errors in Search Console`,
    "Search Console couldn't read all of these sitemaps, so Google may miss new pages or keep old ones.",
    "Open Search Console → Indexing → Sitemaps and click each sitemap to see the error. Fix the file (valid XML, full URLs on this site, at most 50,000 URLs and 50 MB), then resubmit it.",
    broken,
  );
  const findings = [...gscFindings(traffic, pageQueries, urls), ...own].map((f, i) => ({
    ...f,
    id: "G-" + String(i + 1).padStart(3, "0"),
  }));

  return {
    source: "google",
    site: origin.origin,
    properties: { searchConsole: prop, analytics: gaProp },
    period,
    traffic,
    queries,
    pageQueries,
    inspection,
    sitemaps,
    analytics,
    findings,
    notes,
  };
}

// ---------- connect ----------
const SHARED_MISSING = `google: Sign in with Google isn't set up yet in this copy of SEO Supervisor (the project's shared Google sign-in hasn't been added).
You can set it up yourself instead, in about 10 minutes:
  1. Run: node google.mjs guide
  2. Follow its steps to make your own Google sign-in file.
  3. Run: node google.mjs connect --client-file <the file you downloaded>`;

function openBrowser(url) {
  // cmd reads & as a command separator, so it's escaped; the empty "" is start's window title.
  const [cmd, argv] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  try {
    spawn(cmd, argv, { stdio: "ignore", detached: true, windowsHide: true })
      .on("error", () => {})
      .unref();
  } catch {} // the link is printed too
}

// Answers Google's redirect to the loopback address; ignores requests whose state doesn't match.
const waitForCode = (server, state) =>
  new Promise((ok, no) => {
    const timer = setTimeout(
      () =>
        no(
          new Fail(
            "google: no sign-in within 5 minutes, so nothing was saved. Run node google.mjs connect again when you're ready.",
          ),
        ),
      5 * 60000,
    );
    server.on("request", (req, res) => {
      const page = (status, text) =>
        res
          .writeHead(status, { "content-type": "text/html; charset=utf-8", connection: "close" })
          .end(
            `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SEO Supervisor</title><body style="font:18px/1.5 system-ui,sans-serif;max-width:32em;margin:15vh auto;padding:0 16px"><p>${text}</p>`,
          );
      let q;
      try {
        q = new URL(req.url, "http://127.0.0.1").searchParams;
      } catch {
        return page(400, "That address isn't valid.");
      }
      if (!q.has("code") && !q.has("error")) return page(404, "Nothing here.");
      if (q.get("state") !== state)
        return page(
          400,
          "This sign-in doesn't match the one the terminal started. Go back to the terminal and run connect again.",
        );
      clearTimeout(timer);
      if (q.has("error")) {
        page(200, "Sign-in was cancelled. You can close this tab.");
        no(
          new Fail(
            `google: sign-in didn't finish (${q.get("error")}), so nothing was saved. Run node google.mjs connect to try again.`,
          ),
        );
        return;
      }
      page(200, "<b>Signed in.</b> You can close this tab and go back to the terminal.");
      ok(q.get("code"));
    });
  });

const revoke = async (E, s) => {
  const r = await fetch(E.revoke, {
    method: "POST",
    headers: FORM,
    body: new URLSearchParams({ token: s.refresh_token || s.access_token }),
    signal: AbortSignal.timeout(30000),
  });
  await r.text();
  return r;
};
// Withdraws the sign-in being replaced, best effort. Not when it used the same client: Google withdraws the whole
// grant for that client and account, which would cancel the sign-in just made.
async function revokeReplaced(E, old, clientId) {
  if (
    !old ||
    old.method === "service-account" ||
    !(old.refresh_token || old.access_token) ||
    old.client?.id === clientId
  )
    return;
  try {
    await revoke(E, old);
  } catch {}
}

// A key or client file inside the project could end up committed, and connect has already copied what it needs.
function leftInProject(f) {
  const rel = relative(process.cwd(), resolve(f));
  return rel && !isAbsolute(rel) && !/^\.\.([\\/]|$)/.test(rel)
    ? `\nWarning: ${f} is inside this project and is no longer needed (its contents are saved in ~/.seo-supervisor). Delete it, and never commit it.`
    : "";
}

async function connect(args) {
  const E = endpointsFrom(),
    file = tokenFile(),
    now = new Date().toISOString(),
    old = load(file);
  const keyFile = str(args["service-account"]),
    clientFile = str(args["client-file"]);
  const json = keyFile || clientFile ? readJson(keyFile || clientFile) : null;
  if (json?.type === "service_account") {
    if (!json.client_email || !json.private_key)
      fail(
        `google: ${keyFile || clientFile} is missing client_email or private_key. Download a new JSON key for the service account.`,
      );
    const t = await serviceAccountToken(E, json);
    save(file, {
      method: "service-account",
      client_email: json.client_email,
      private_key_id: json.private_key_id,
      private_key: json.private_key,
      token_uri: json.token_uri,
      scope: SCOPES.join(" "),
      ...t,
      connected_at: now,
    });
    await revokeReplaced(E, old);
    console.log(
      `google: connected as the service account ${json.client_email}.\nIt sees the Search Console and GA4 properties where this email was added as a user.\nSaved to ${file} (only your user account can read it).${leftInProject(keyFile || clientFile)}`,
    );
    return 0;
  }
  if (keyFile)
    fail(
      `google: ${keyFile} isn't a service-account key. In Google Cloud open IAM & Admin → Service accounts → your account → Keys → Add key → JSON.`,
    );
  let client, method;
  if (clientFile) {
    const c = json.installed;
    if (!c?.client_id)
      fail(
        json.web
          ? `google: ${clientFile} is a "Web application" client. Signing in from the terminal needs a "Desktop app" client: create one (node google.mjs guide) and download its JSON.`
          : `google: ${clientFile} isn't a Google sign-in (OAuth client) file. Download it from your Desktop app client's page in Google Cloud.`,
      );
    // Google's sign-in for Desktop app clients needs the secret, so stop before the browser opens.
    if (!c.client_secret)
      fail(
        `google: ${clientFile} has no client secret, so Google would refuse the sign-in. Download it again from Google Cloud (Clients → your Desktop app client). If that download has no secret either, click Add secret on the same page and download the JSON straight away.`,
      );
    client = { id: c.client_id, secret: c.client_secret, file: resolve(clientFile) };
    method = "own-client";
  } else {
    // The env vars override the shared client; empty means none.
    const env = process.env;
    client = {
      id: env.SEO_GOOGLE_SHARED_CLIENT_ID ?? SHARED_CLIENT.id,
      secret: env.SEO_GOOGLE_SHARED_CLIENT_SECRET ?? SHARED_CLIENT.secret,
    };
    if (!client.id || !client.secret) fail(SHARED_MISSING);
    method = "shared";
  }

  const { verifier, challenge } = pkce(),
    state = randomBytes(16).toString("base64url");
  const server = createServer();
  await new Promise((ok, no) => server.once("error", no).listen(0, "127.0.0.1", ok));
  const redirect_uri = `http://127.0.0.1:${server.address().port}`;
  const url = `${E.auth}?${new URLSearchParams({ client_id: client.id, redirect_uri, response_type: "code", scope: SCOPES.join(" "), code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent" })}`;
  // The link also goes to a file, for a caller running this in the background that can't see its output yet.
  const pending = pendingFile();
  let code;
  try {
    save(pending, url + "\n");
    const text = `${args["print-url"] === true ? url + "\n" : ""}google: opening Google's sign-in page in your browser. If it doesn't open, copy this link into your browser:\n\n  ${url}\n\nThe link is also in ${pending} until signing in is done.\nWaiting for you to finish signing in (up to 5 minutes)...\n`;
    await new Promise(ok => process.stdout.write(text, ok)); // flushed before the wait, also into a pipe
    if (args["no-browser"] !== true) openBrowser(url);
    code = await waitForCode(server, state);
  } finally {
    rmSync(pending, { force: true });
    server.close();
    setTimeout(() => server.closeAllConnections(), 1000).unref();
  }

  const t = await tokenRequest(E, {
    code,
    client_id: client.id,
    client_secret: client.secret,
    redirect_uri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const scope = t.scope || SCOPES.join(" ");
  save(file, { method, client, ...t, scope, connected_at: now });
  await revokeReplaced(E, old, client.id);
  console.log(
    `google: connected. Search Console: ${scope.includes(SC) ? "yes" : "no (not allowed)"} · Google Analytics: ${scope.includes(GA) ? "yes" : "no (not allowed)"}.\nSaved to ${file} (only your user account can read it).${t.refresh_token ? "" : "\nGoogle didn't send a long-lived sign-in, so you'll need to connect again in about an hour."}${clientFile ? leftInProject(clientFile) : ""}\nNext: node google.mjs fetch --site https://your-site`,
  );
  return 0;
}

async function status() {
  const file = tokenFile(),
    s = load(file);
  if (!s) {
    console.log(
      "google: Not connected. Run node google.mjs connect to sign in with Google, or node google.mjs guide to set it up yourself.",
    );
    return 1;
  }
  const scope = s.scope || "";
  const how =
    s.method === "service-account"
      ? `a service account (${s.client_email})`
      : s.method === "own-client"
        ? `your own Google Cloud client (${s.client.id}${s.client.file ? `, from ${s.client.file}` : ""})`
        : `Sign in with Google (SEO Supervisor's shared sign-in, ${s.client.id})`;
  const lines = [
    `Connected with: ${how}`,
    `Connected on: ${(s.connected_at || "unknown").slice(0, 10)}`,
    `Access: ${[scope.includes(SC) && "Search Console (read-only)", scope.includes(GA) && "Google Analytics (read-only)"].filter(Boolean).join(", ") || "none"}`,
    `Access token: ${s.expires_at > Date.now() ? `valid until ${new Date(s.expires_at).toISOString().slice(0, 16).replace("T", " ")} UTC` : "expired"}${s.refresh_token || s.private_key ? " (renews automatically)" : " (run connect again)"}`,
    `Saved in: ${file}`,
  ];
  try {
    const g = session();
    lines.push(
      `Search Console properties: ${((await g.call(`${g.E.searchConsole}/sites`)).siteEntry || []).map(x => x.siteUrl).join(", ") || "none"}`,
    );
    if (scope.includes(GA)) {
      try {
        lines.push(
          `Google Analytics 4 properties: ${((await g.call(`${g.E.analyticsAdmin}/accountSummaries?pageSize=200`)).accountSummaries || []).flatMap(a => (a.propertySummaries || []).map(p => `${p.displayName} (${p.property.split("/")[1]})`)).join(", ") || "none"}`,
        );
      } catch (e) {
        lines.push(
          `Google Analytics 4 properties: couldn't list them. ${explain(e, "the Google Analytics property list", ADMIN_API)}`,
        );
      }
    }
  } catch (e) {
    lines.push(
      `Search Console properties: couldn't list them. ${explain(e, "the Search Console property list", SC_API)}`,
    );
  }
  console.log(lines.join("\n"));
  return 0;
}

async function disconnect() {
  const file = tokenFile(),
    s = load(file);
  if (!s && existsSync(file)) {
    rmSync(file, { force: true });
    console.log(
      `google: the saved sign-in (${file}) couldn't be read, so it was deleted. To withdraw access at Google too, open https://myaccount.google.com/connections.`,
    );
    return 0;
  }
  if (!s) {
    console.log("google: not connected, nothing to remove.");
    return 0;
  }
  let revoked = "";
  if (s.method !== "service-account") {
    try {
      const r = await revoke(endpointsFrom(), s);
      revoked = r.ok
        ? "Google has withdrawn SEO Supervisor's access."
        : `Google didn't confirm withdrawing access (${r.status}); it may have been withdrawn already.`;
    } catch (e) {
      revoked = `Couldn't reach Google to withdraw access (${e.cause?.code || e.message}).`;
    }
  }
  rmSync(file, { force: true });
  console.log(
    [
      `google: disconnected. Removed the saved sign-in (${file}).`,
      revoked,
      s.method === "service-account"
        ? `The service account ${s.client_email} keeps the access you gave it: remove it under ${SC_API.where} and ${ADMIN_API.where}, or delete its key in Google Cloud.`
        : "You can check or remove access any time at https://myaccount.google.com/connections.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return 0;
}

const GUIDE = `Set up Google access yourself (about 10 minutes). Pick one.

A. Your own sign-in (best for most people)
  1. Open https://console.cloud.google.com/auth/overview/personal and sign in with the Google account that sees your site in Search Console.
  2. Follow the steps to create a project and a client. When asked for the application type, choose "Desktop app".
  3. Turn on three APIs. Open https://console.cloud.google.com/apis/library, search for each one and click Enable:
     "Google Search Console API", "Google Analytics Data API" and "Google Analytics Admin API".
  4. On the client's page, click "Download JSON". Keep the file private.
  5. Run: node google.mjs connect --client-file <the downloaded file>
     Your browser opens. Sign in and allow read-only access. Then delete the downloaded file: connect keeps what it needs.
  If you made the client through the regular Google Cloud setup instead of the personal page in step 1, also open
  Google Auth Platform → Audience → Publish app, so sign-ins don't expire after 7 days.

B. A service account (for servers and CI; no browser)
  1. In Google Cloud, open IAM & Admin → Service accounts and create one. Then open it → Keys → Add key → JSON. Keep the file private.
  2. Turn on the same three APIs as in A, step 3.
  3. In Search Console, open Settings → Users and permissions → Add user, and add the service account's email (it ends in .iam.gserviceaccount.com) with Restricted permission.
  4. In Google Analytics, open Admin → Property access management → Add users, and add the same email as a Viewer.
  5. Run: node google.mjs connect --service-account <the key file>

Either way, access is read-only. Undo it any time with: node google.mjs disconnect`;

async function fetchCli(args) {
  if (!str(args.site)) throw new Fail(USAGE);
  const crawlPath = str(args.crawl) || "seo-audit/seo-crawl.json";
  let crawl = null;
  if (existsSync(crawlPath))
    try {
      crawl = JSON.parse(readFileSync(crawlPath, "utf8"));
    } catch {}
  const out = resolve(str(args.out) || "seo-audit/google.json");
  const r = await fetchGoogle({
    site: args.site,
    days: str(args.days) || 90,
    ga4Property: str(args["ga4-property"]),
    crawl,
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(r, null, 2));
  console.log(
    `google: ${r.properties.searchConsole}${r.properties.analytics ? ` and GA4 property ${r.properties.analytics}` : ""} · ${Object.keys(r.traffic).length} pages, ${r.queries.length} queries, ${r.inspection.length} URLs inspected, ${r.sitemaps.length} sitemaps, ${Object.keys(r.analytics).length} GA4 landing pages, ${r.findings.length} findings · wrote ${out}`,
  );
  for (const n of r.notes) console.log("note: " + n);
  return 0;
}

const str = v => (typeof v === "string" ? v : null);
const USAGE = `usage: node google.mjs connect [--client-file client_secret.json | --service-account key.json] [--no-browser] [--print-url]
       node google.mjs guide | status | disconnect
       node google.mjs fetch --site https://www.example.com [--days 90] [--ga4-property <id>] [--crawl seo-audit/seo-crawl.json] [--out seo-audit/google.json]`;
// Exit codes as in connect-keys.mjs: 1 when Google refuses or can't be reached, or status finds nothing connected;
// 2 on bad input or no usable sign-in.
if (isMain(import.meta.url)) {
  const cmd = process.argv[2],
    args = {};
  for (let i = 3; i < process.argv.length; i++) {
    const k = process.argv[i].replace(/^--/, "");
    args[k] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  }
  const run = {
    connect,
    status,
    disconnect,
    fetch: fetchCli,
    guide: async () => {
      console.log(GUIDE);
      return 0;
    },
  }[cmd];
  // Exit by setting the code, not process.exit(): exiting while fetch's sockets close crashes Node on Windows.
  process.exitCode = await (run ? run(args) : Promise.reject(new Fail(USAGE))).then(null, e => {
    if (!(e instanceof Fail)) throw e;
    console.error(e.message);
    return 2;
  });
}
