// @ts-check
// Matomo: the key's entry, search-engine visits by landing page with their splits, and the connection test.
import { Refused, setLine, address, idOf, refusal, request, POST, bare, isDay } from "./http.mjs";
import { ROWS, splits, once, addVisits, tooMany } from "./visits.mjs";

// Matomo and PostHog also need an address and an ID (`fields`), saved with the key: { url, siteId, key }.
export const matomo = {
  name: "Matomo",
  env: "MATOMO_TOKEN_AUTH",
  adds: "visits from search engines to each page, from your Matomo",
  where: "Administration (the gear icon) → Personal → Security → Auth tokens",
  fields: [
    {
      id: "url",
      flag: "url",
      env: "MATOMO_URL",
      address: true,
      ask: "Your Matomo address (the one you open Matomo at, like https://analytics.example.com)",
      check: s => address(s, "The Matomo address"),
    },
    {
      id: "siteId",
      flag: "site-id",
      env: "MATOMO_SITE_ID",
      ask: "The site ID (a number, like 1)",
      check: s => idOf(s, "site ID", "in Matomo under Administration → Websites → Manage, in the ID column"),
    },
  ],
  about: k => `site ID ${k.siteId} at ${k.url}`,
  guide: [
    "Matomo adds the visits that came from search engines to each page, from your own Matomo (self-hosted or Matomo Cloud). You need three things: your Matomo address, the site ID and a token.",
    "1. Sign in to Matomo. Its address is the one in your browser's address bar, like https://analytics.example.com or https://example.matomo.cloud.",
    "2. The site ID: open Administration (the gear icon) → Websites → Manage. It's the number in the ID column next to your site.",
    '3. The token: open Administration → Personal → Security, scroll to Auth tokens and click Create new token. Confirm your password, write "SEO Supervisor" as the description, tick "Only allow secure requests" if it\'s offered, and create it. Copy the token straight away: Matomo shows it only once.',
    "   The token reads whatever your Matomo user can, so a user with view access to this one site is enough.",
    `4. In your own terminal run: ${setLine("matomo")}`,
    "   It asks for the address and the site ID (shown as you type), then the token. Paste the token and press Enter. It isn't shown, so it stays out of chats and your command history.",
    "If fetch says the segment hasn't been created, your Matomo only reports on saved segments. Above any report, open the segment menu → Add new segment, choose Channel Type, Is, search, and save it with its reports pre-processed. Matomo fills it in within a few hours; then fetch again.",
    "To check the connection first: node connect-keys.mjs test matomo --yes (it shows your Matomo's version).",
    // https://matomo.org/faq/troubleshooting/faq_50/
    "Matomo's numbers won't match Google Analytics exactly. Matomo doesn't sample data, and Google Analytics can. A visitor who accepts one tool in the consent banner but not the other is counted by only one. And the two tools spot bots and count visits in their own ways. Compare the trends, not the totals.",
  ],
};

// Visits from a search engine (segment referrerType==search) by entry page, most first. Only token_auth goes in the
// POST body; the other parameters aren't secret. The splits cover the whole site ID: the same visits by device type
// and country, every visit by channel (no segment), and search visits by engine. With period=day, VisitsSummary.get
// gives search visits per date, [] for a day with none.
// https://developer.matomo.org/api-reference/reporting-api-legacy
export const MATOMO_SPLITS = {
  byDevice: "DevicesDetection.getType",
  byCountry: "UserCountry.getCountry",
  byChannel: "Referrers.getReferrerType",
  byEngine: "Referrers.getSearchEngines",
};
const MATOMO_ALL = "Referrers.getReferrerType";
export const MATOMO_DAILY = "VisitsSummary.get";
export const matomoUrl = (k, p, method = "Actions.getEntryPageUrls") =>
  `${k.url}index.php?${new URLSearchParams(
    /** @type {any} */ ({
      module: "API",
      method,
      idSite: k.siteId,
      period: method === MATOMO_DAILY ? "day" : "range",
      date: `${p.from},${p.to}`,
      ...(method === MATOMO_ALL ? {} : { segment: "referrerType==search" }),
      ...(method === "Actions.getEntryPageUrls"
        ? { flat: 1, filter_limit: ROWS, filter_sort_column: "entry_nb_visits", filter_sort_order: "desc" }
        : method === MATOMO_DAILY
          ? {}
          : { filter_limit: 10, filter_sort_column: "nb_visits", filter_sort_order: "desc" }),
      format: "JSON",
    }),
  )}`;

export async function fetchMatomo(k, site, period, notes) {
  const want = bare(new URL(site).hostname),
    traffic = {};
  // list: a report's rows; otherwise one object (the daily trend's dates).
  const read = async (method, list = true) => {
    const rows = await request("matomo", matomo, matomoUrl(k, period, method), {
      ...POST,
      body: new URLSearchParams({ token_auth: k.key }),
    });
    if (list ? !Array.isArray(rows) : !rows || typeof rows !== "object" || rows.result === "error")
      throw new Refused(refusal("matomo", matomo, 200, rows, null, new URL(k.url).host));
    return rows;
  };
  const rows = await read();
  // Rows without a URL (Matomo's "Others") and other sites tracked in the same Matomo are left out.
  for (const r of rows) {
    let x;
    try {
      x = new URL(r?.url);
    } catch {
      continue;
    }
    const n = Number(r.entry_nb_visits) || 0;
    if (n > 0 && bare(x.hostname) === want) addVisits(traffic, x.pathname, n);
  }
  if (rows.length >= ROWS) notes.push(tooMany("Matomo"));
  // Countries by code, upper case as PostHog's; "xx" is Matomo's Unknown, not a country.
  const name = (r, field) =>
    field !== "byCountry" ? r?.label : r?.code !== "xx" && typeof r?.code === "string" ? r.code.toUpperCase() : null;
  return {
    period,
    traffic,
    ...(await splits(
      "Matomo",
      MATOMO_SPLITS,
      async (method, field) => (await read(method)).map(r => [name(r, field), r?.nb_visits]),
      notes,
    )),
    ...(await once(
      "Matomo",
      "daily",
      async () =>
        Object.fromEntries(
          Object.entries(await read(MATOMO_DAILY, false))
            .filter(([d]) => isDay(d))
            .map(([d, v]) => [d, Number(v?.nb_visits) || 0]),
        ),
      notes,
    )),
  };
}

// The connection test (test matomo --yes): API.getMatomoVersion answers { value: "5.x" } to a valid token.
export async function testMatomo(k) {
  const b = await request(
    "matomo",
    matomo,
    `${k.url}index.php?${new URLSearchParams({ module: "API", method: "API.getMatomoVersion", format: "JSON" })}`,
    { ...POST, body: new URLSearchParams({ token_auth: k.key }) },
  );
  if (typeof b?.value !== "string") throw new Refused(refusal("matomo", matomo, 200, b, null, new URL(k.url).host));
  return `Matomo ${b.value} at ${k.url} accepted the token.`;
}
