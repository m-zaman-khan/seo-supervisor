// @ts-check
// PostHog: the key's entry, search-engine visits by landing page with their splits (HogQL), and the connection test.
import { Refused, setLine, address, idOf, refusal, request, POST, bare, isDay, num } from "./http.mjs";
import { ROWS, splits, once, addVisits, tooMany } from "./visits.mjs";

// Like Matomo, it also needs an address and an ID (`fields`), saved with the key: { host, projectId, key }.
export const posthog = {
  name: "PostHog",
  env: "POSTHOG_PERSONAL_API_KEY",
  adds: "visits from search engines to each page, from your PostHog",
  where: "PostHog → Settings → User → Personal API keys",
  fields: [
    {
      id: "host",
      flag: "host",
      env: "POSTHOG_HOST",
      ask: "Your PostHog address: us, eu, or your own PostHog's address",
      check: s =>
        /^(us|eu)$/i.test(s)
          ? `https://${s.toLowerCase()}.posthog.com/`
          : address(s, "The PostHog address").replace(
              /^https:\/\/(us|eu)\.i\.posthog\.com\/$/,
              "https://$1.posthog.com/",
            ),
    },
    {
      id: "projectId",
      flag: "project-id",
      env: "POSTHOG_PROJECT_ID",
      ask: "The project ID (a number)",
      check: s => idOf(s, "project ID", "in PostHog under Settings → Project"),
    },
  ],
  about: k => `project ID ${k.projectId} at ${k.host}`,
  guide: [
    "PostHog adds the visits that came from search engines to each page (the sessions PostHog counts as Organic Search), from your own PostHog. You need three things: the PostHog address, the project ID and a personal API key.",
    "1. Sign in to PostHog. The address is https://us.posthog.com (US cloud), https://eu.posthog.com (EU cloud) or your own PostHog's address.",
    "2. The project ID: open Settings → Project. It's the number shown as Project ID (it's also in the address bar, after /project/).",
    '3. The key: open Settings → User → Personal API keys and click Create personal API key. Name it "SEO Supervisor", let it use only this project, and give it one permission: Query: Read. Copy the key straight away: it starts with phx_ and PostHog shows it only once.',
    "   Not the project key in your site's tracking code (it starts with phc_): that one can only send data, not read it.",
    `4. In your own terminal run: ${setLine("posthog")}`,
    "   It asks for the address (type us, eu or your own address) and the project ID, shown as you type, then the key. Paste the key and press Enter. It isn't shown, so it stays out of chats and your command history.",
    "To check the connection first: node connect-keys.mjs test posthog --yes (it counts the project's pageviews in the last 7 days).",
  ],
};

// Sessions PostHog files as Organic Search (a search engine as referrer or utm_source, paid search left out, as in
// GA4), by entry page. The site's host is matched here, not sent.
// Without $channel_type, the fallback counts sessions referred by a search engine. These LIKE patterns can count a
// little paid search and Google's other sites; port PostHog's channel_definitions.json if that matters.
// https://posthog.com/docs/data/channel-type
const ENGINES = [
  "%google.%",
  "%bing.com",
  "%duckduckgo.com",
  "%search.yahoo.%",
  "%yandex.%",
  "%baidu.com",
  "%ecosia.org",
  "%qwant.com",
  "%startpage.com",
  "%search.brave.com",
  "%naver.com",
  "%seznam.cz",
];
const organic = (fallback, pre = "") =>
  fallback
    ? `(${ENGINES.map(e => `${pre}$entry_referring_domain LIKE '${e}'`).join(" OR ")})`
    : `${pre}$channel_type = 'Organic Search'`;
const between = (p, field) => `toDate(${field}) BETWEEN toDate('${p.from}') AND toDate('${p.to}')`;
export const posthogQuery = (p, fb) =>
  `SELECT domainWithoutWWW($entry_current_url) AS host, $entry_pathname AS path, count() AS visits FROM sessions WHERE ${organic(fb)} AND ${between(p, "$start_timestamp")} GROUP BY host, path ORDER BY visits DESC LIMIT ${ROWS}`;
// sessions has no device or country, so the splits use its pageviews' $device_type and $geoip_country_code through
// events' `session` join. The events' dates bound the scan; a session starting in the period has its first pageview
// in it.
// https://posthog.com/docs/data/sessions
const posthogSplit = (p, prop, fb) =>
  `SELECT domainWithoutWWW(session.$entry_current_url) AS host, ${prop} AS k, count(DISTINCT $session_id) AS visits FROM events WHERE event = '$pageview' AND ${organic(fb, "session.")} AND ${between(p, "session.$start_timestamp")} AND ${between(p, "timestamp")} GROUP BY host, k ORDER BY visits DESC LIMIT 1000`;
// byReferrer: every session by its referring domain ($direct when there was none), not only those from search.
export const POSTHOG_SPLITS = {
  byDevice: (p, fb) => posthogSplit(p, "properties.$device_type", fb),
  byCountry: (p, fb) => posthogSplit(p, "properties.$geoip_country_code", fb),
  byReferrer: p =>
    `SELECT domainWithoutWWW($entry_current_url) AS host, $entry_referring_domain AS k, count() AS visits FROM sessions WHERE ${between(p, "$start_timestamp")} GROUP BY host, k ORDER BY visits DESC LIMIT 1000`,
};
// Pageviews and visitors (distinct_id) per day, in the sessions from search.
export const posthogDaily = (p, fb) =>
  `SELECT domainWithoutWWW(session.$entry_current_url) AS host, toString(toDate(timestamp)) AS d, count() AS pageviews, count(DISTINCT distinct_id) AS visitors FROM events WHERE event = '$pageview' AND ${organic(fb, "session.")} AND ${between(p, "session.$start_timestamp")} AND ${between(p, "timestamp")} GROUP BY host, d ORDER BY d LIMIT 1000`;
export const POSTHOG_TEST =
  "SELECT count() FROM events WHERE event = '$pageview' AND timestamp > now() - INTERVAL 7 DAY";
export const posthogUrl = k => `${k.host}api/projects/${k.projectId}/query/`;
async function posthogRead(k, query) {
  const b = await request("posthog", posthog, posthogUrl(k), {
    ...POST,
    headers: { authorization: `Bearer ${k.key}`, "content-type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!Array.isArray(b?.results)) throw new Refused(refusal("posthog", posthog, 200, null, null, new URL(k.host).host));
  return b.results;
}

export async function fetchPosthog(k, site, period, notes) {
  const want = bare(new URL(site).hostname),
    traffic = {},
    read = q => posthogRead(k, q);
  const mine = rows => rows.filter(r => Array.isArray(r) && bare(String(r[0] ?? "")) === want);
  let fallback = false,
    rows;
  try {
    rows = await read(posthogQuery(period));
  } catch (e) {
    if (!(e instanceof Refused) || !/channel_type/.test(e.message)) throw e;
    fallback = true;
    rows = await read(posthogQuery(period, true));
    notes.push(
      "PostHog couldn't use $channel_type here (an older PostHog?), so visits from search were counted from search engines' referring domains instead. That list is our own and may count a little paid search.",
    );
  }
  for (const [, path, n] of mine(rows)) if (/^\//.test(path) && Number(n) > 0) addVisits(traffic, path, Number(n));
  if (rows.length >= ROWS) notes.push(tooMany("PostHog"));
  const split = await splits(
    "PostHog",
    POSTHOG_SPLITS,
    async (q, field) =>
      mine(await read(q(period, fallback))).map(([, v, n]) => [
        field === "byCountry" && typeof v === "string" ? v.toUpperCase() : v,
        n,
      ]),
    notes,
  );
  const daily = await once(
    "PostHog",
    "daily",
    async () =>
      Object.fromEntries(
        mine(await read(posthogDaily(period, fallback)))
          .filter(r => isDay(r[1]))
          .map(([, d, pv, v]) => [d, { pageviews: Number(pv) || 0, visitors: Number(v) || 0 }]),
      ),
    notes,
  );
  // Zero visits from search mean something only if PostHog records referrers at all ($direct is its value for none).
  const check = {};
  if (!Object.keys(traffic).length && split.byReferrer) {
    const seen = Object.keys(split.byReferrer);
    check.referrersCaptured = seen.some(r => r !== "$direct");
    if (!check.referrersCaptured)
      notes.push(
        seen.length
          ? "PostHog shows zero visits from search, but no visit to this site in the period has a referrer ($direct only), so PostHog can't tell visits from search apart. Check that the site's PostHog setup keeps the referrer; until then, don't trust the zero."
          : "PostHog shows zero visits from search, but it recorded no visits to this site at all in the period, so the zero says nothing. Check that PostHog's code is on the site and that the project ID is this site's, and that referrers reach it.",
      );
  }
  return { period, organicBy: fallback ? "referrer" : "channel", traffic, ...split, ...daily, ...check };
}

// The connection test (test posthog --yes): the project's pageviews in the last 7 days.
export async function testPosthog(k) {
  const n = Number((await posthogRead(k, POSTHOG_TEST))[0]?.[0]) || 0,
    who = `PostHog project ${k.projectId} at ${k.host} accepted the key`;
  return n
    ? `${who}: ${num(n)} pageviews in the last 7 days.`
    : `${who}, but has no $pageview events in the last 7 days. Check that PostHog's code is on the site and sends pageviews.`;
}
