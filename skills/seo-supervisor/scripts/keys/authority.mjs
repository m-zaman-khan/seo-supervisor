// @ts-check
// Authority scores for the site and its competitors: Open PageRank, Ahrefs' free Domain Rating and Moz.
import { randomUUID } from "node:crypto";
import { Refused, setLine, PASTE, refusal, request, chunks, domainOf } from "./http.mjs";

export const openpagerank = {
  name: "Open PageRank",
  env: "OPENPAGERANK_KEY",
  endpointEnv: "OPENPAGERANK_ENDPOINT",
  endpoint: "https://openpagerank.keywordseverywhere.com/api/v1.0/getPageRank",
  adds: "a 0–10 authority score for the site and the competitors you name, based on links between sites",
  where: "keywordseverywhere.com/openpagerank",
  guide: [
    "Open PageRank (free, now run by Keywords Everywhere) adds a 0–10 authority score for your site and the competitors you name, based on links between sites.",
    "1. Sign up at https://keywordseverywhere.com/openpagerank and open your Open PageRank dashboard.",
    "2. Create an API key and register the IP address of the computer that will use it.",
    `3. Copy the key, then in your own terminal run: ${setLine("openpagerank")}`,
    PASTE,
    "Since 1 November 2026, free keys only work from that one registered IP address. A 403 error usually means your IP address changed (a new network, a VPN, or your provider changed it): update it in the dashboard. You can change it once a week.",
    "Free keys cover 30,000 domains a month.",
  ],
};
export const ahrefs = {
  name: "Ahrefs Domain Rating",
  env: "AHREFS_KEY",
  endpointEnv: "AHREFS_ENDPOINT",
  endpoint: "https://api.ahrefs.com/v3/public/domain-rating-free",
  adds: "Ahrefs' 0–100 Domain Rating for the site and the competitors you name",
  where: "ahrefs.com → Account settings → API keys",
  guide: [
    "Ahrefs' free Domain Rating adds Ahrefs' 0–100 Domain Rating for your site and the competitors you name. It's free, with a free Ahrefs account.",
    "1. Create a free account at https://ahrefs.com, or sign in.",
    "2. Go to Account settings → API keys and create a key.",
    `3. Copy the key, then in your own terminal run: ${setLine("ahrefs")}`,
    PASTE,
    'Ahrefs\' licence requires every place that shows these numbers to say "Domain Rating by Ahrefs" with a link to https://ahrefs.com/. The report does this for you.',
  ],
};
// optional keeps it off fetch's Limits list when no key is set.
// https://moz.com/api/docs/guides/authentication
export const moz = {
  name: "Moz",
  env: "MOZ_TOKEN",
  endpointEnv: "MOZ_ENDPOINT",
  endpoint: "https://api.moz.com/jsonrpc",
  optional: true,
  adds: "Moz's Domain Authority, Spam Score and linking domains for the site and the competitors you name",
  where: "moz.com/api/dashboard",
  guide: [
    "Moz adds its Domain Authority (1 to 100), Spam Score and the number of sites linking to you, for your site and the competitors you name: a second opinion next to Open PageRank and Ahrefs.",
    "1. Sign up for the Moz API at https://moz.com/products/api/pricing and pick the free plan. The API is separate from a Moz Pro subscription. Moz asks for a card but charges nothing unless you upgrade.",
    "2. Open https://moz.com/api/dashboard and generate a token.",
    `3. Copy the token, then in your own terminal run: ${setLine("moz")}`,
    PASTE,
    "The free plan has 50 rows a month and each domain uses one, so fetch reads at most 10 domains a run, your site first. The rows refill every month.",
  ],
};
const ATTRIBUTION = { text: "Domain Rating by Ahrefs", url: "https://ahrefs.com/" };
export const MOZ_MAX = 10;

// Each read goes through fetchKeys' run(id, fn), which skips a service with no key and notes a refusal. end(id) is
// the service's address. Returns { authority, attribution, moz }.
export async function fetchAuthority(run, keys, domains, end, notes) {
  const authority =
    keys.openpagerank || keys.ahrefs ? domains.map(domain => ({ domain, openPageRank: null, ahrefsDR: null })) : [];
  const set = (domain, field, v) => {
    const a = authority.find(x => x.domain === domain);
    if (a) a[field] = v;
  };
  let attribution = null,
    mozRows = null;
  await run("openpagerank", async key => {
    for (const list of chunks(domains, 100)) {
      const b = await request(
        "openpagerank",
        openpagerank,
        `${end("openpagerank")}?${list.map(d => "domains[]=" + encodeURIComponent(d)).join("&")}`,
        { headers: { "API-OPR": key } },
      );
      for (const r of b?.response || [])
        set(
          domainOf(r.domain || ""),
          "openPageRank",
          r.status_code === 200 && !r.error && r.page_rank_decimal != null ? Number(r.page_rank_decimal) : null,
        );
    }
  });
  await run("ahrefs", async key => {
    for (const list of chunks(domains, 1000)) {
      const b = await request("ahrefs", ahrefs, end("ahrefs"), {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ targets: list }),
      });
      for (const t of b?.domain_rating?.targets || [])
        set(domainOf(t.target || ""), "ahrefsDR", typeof t.domain_rating === "number" ? t.domain_rating : null);
      attribution = {
        ...ATTRIBUTION,
        license: b?.domain_rating?.license || "https://ahrefs.com/legal/domain-rating-license",
      };
    }
  });
  // Moz's data.site.metrics.fetch with scope "domain" uses one row a call, and the free plan has 50 rows a month, so a
  // run reads at most MOZ_MAX domains. Domains already read are kept on a refusal.
  await run("moz", async key => {
    mozRows = [];
    if (domains.length > MOZ_MAX)
      notes.push(
        `Moz: read the first ${MOZ_MAX} of ${domains.length} domains. Each uses one of the free plan's 50 rows a month.`,
      );
    for (const domain of domains.slice(0, MOZ_MAX)) {
      const b = await request("moz", moz, end("moz"), {
        method: "POST",
        headers: { "x-moz-token": key, "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "data.site.metrics.fetch",
          params: { data: { site_query: { query: domain, scope: "domain" } } },
        }),
      });
      if (b?.error) throw new Refused(refusal("moz", moz, Number(b.error.status || b.error.httpStatus) || 400, b));
      const m = b?.result?.site_metrics || {},
        n = v => (typeof v === "number" && v >= 0 ? v : null); // Spam Score -1: Moz has none
      mozRows.push({
        domain,
        domainAuthority: n(m.domain_authority),
        spamScore: n(m.spam_score),
        linkingDomains: n(m.root_domains_to_root_domain),
        inboundLinks: n(m.external_pages_to_root_domain),
      });
    }
  });
  return { authority, attribution, moz: mozRows };
}
