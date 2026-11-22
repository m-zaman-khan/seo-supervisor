#!/usr/bin/env node
// @ts-check
// Services connected by an API key alone, and the key store the other scripts share. Keys are saved in
// ~/.seo-supervisor/keys.json, never in the project; a service's environment variable wins over its saved key.
// Exits 0 when done, 1 when a service refuses or can't be reached (or status finds no key), 2 on bad input.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { runMain, warnProxy } from "./lib/cli.mjs";
import { changedPages } from "./seo-diff.mjs";
import { Fail, Refused, fail, domainOf, domainsFor, num } from "./keys/http.mjs";
import { SERVICES, serviceOf, call } from "./keys/services.mjs";
import { keyFile, savedKeys, ask, setKey, removeKey, activeKeys, mask } from "./keys/store.mjs";
import { fetchBing, BATCH, submitBing } from "./keys/bing.mjs";
import { MOZ_MAX, fetchAuthority } from "./keys/authority.mjs";
import { periodFor } from "./keys/visits.mjs";
import { MATOMO_SPLITS, MATOMO_DAILY, matomoUrl, fetchMatomo, testMatomo } from "./keys/matomo.mjs";
import {
  posthogQuery,
  POSTHOG_SPLITS,
  posthogDaily,
  POSTHOG_TEST,
  posthogUrl,
  fetchPosthog,
  testPosthog,
} from "./keys/posthog.mjs";
import { CLARITY_DAYS, fetchClarity } from "./keys/clarity.mjs";
import { YT_TOPICS, fetchYoutube } from "./keys/youtube.mjs";
import { foundOn } from "./lib/findings.mjs";

// Re-exported for the other scripts and the tests.
export { Fail, Refused, domainOf, submitBing, SERVICES, call, keyFile, savedKeys, setKey, removeKey, activeKeys };
const USAGE = `usage: node connect-keys.mjs set bing|openpagerank|ahrefs|matomo|posthog|moz|youtube|clarity|perplexity|openai|googleplaces [<key>]   (no key: it asks, hidden)
       node connect-keys.mjs set matomo [--url <address>] [--site-id <id>] | set posthog [--host us|eu|<address>] [--project-id <id>]
       node connect-keys.mjs status | remove <service> | guide <service> | test matomo|posthog [--yes]
       node connect-keys.mjs fetch --site https://www.example.com [--competitors a.com,b.com] [--days 90] [--out seo-audit/keys.json] [--yes]
            [--topics "topic one, topic two"] [--youtube-channel @handle] [--bing-pages /a,/b] [--bing-sister https://sister.example]
       node connect-keys.mjs submit-bing --site https://www.example.com (--urls changed.txt | --from-diff seo-audit/seo-diff.json) [--yes]`;
function siteOf(s, flag = "--site") {
  let u;
  try {
    u = new URL(s);
  } catch {}
  return u && /^https?:$/.test(u.protocol)
    ? u
    : fail(`${flag} must be the site's address, like https://www.example.com (got ${s})`);
}

// Kept here rather than in keys/bing.mjs: knownChecks() in lib/score.mjs and the rule-ID test scan only scripts/ and
// scripts/checks/ for check names.
function crawlFinding(bing) {
  // Bing lists redirects as issues too, but on their own they're normal.
  const evidence = (bing?.crawlIssues || [])
    .map(c => ({ c, problems: c.issues.filter(w => !w.includes("redirect")) }))
    .filter(x => x.problems.length)
    .map(({ c, problems }) => ({
      url: c.url,
      detail: `${problems.join(", ")}, Bing got HTTP ${c.httpCode ?? "?"}${c.inLinks ? `, ${c.inLinks} links point here` : ""}`,
    }));
  if (!evidence.length) return [];
  const ex = evidence[0];
  return [
    {
      id: "K-001",
      check: "bing-crawl-issues",
      rule: "CRAWL-05",
      severity: "medium",
      category: "Crawling & indexing",
      title: `Bing reports crawl problems on ${evidence.length} URL(s)`,
      what: foundOn(evidence.length, ex),
      why: "Bing Webmaster Tools lists these URLs as failing when Bing crawled them. Pages that error, time out or are blocked can drop out of Bing, and out of AI answers built on Bing's index such as Copilot.",
      fix: "Open each URL. Fix pages that should work (server errors, timeouts, DNS), redirect or stop linking to pages that are gone, and unblock important pages in robots.txt. Bing's list takes a few days to clear after a fix.",
      count: evidence.length,
      evidence: evidence.slice(0, 100),
      source: "bing-webmaster",
      status: "open",
    },
  ];
}

// Each service runs only when its key is set. problems holds the refusals, also kept in result.notes.
// bingPages and bingSister add Bing's links to chosen pages and to a sister site in the same account.
export async function fetchKeys({
  site,
  competitors = [],
  keys = activeKeys(),
  endpoints = {},
  days = 90,
  topics = [],
  channel = null,
  bingPages = [],
  bingSister = null,
}) {
  const siteUrl = new URL("/", site).href,
    notes = [],
    problems = [],
    notChecked = [];
  const domains = domainsFor(siteUrl, competitors);
  const end = id => endpoints[id] || SERVICES[id].endpoint;
  let bing = null,
    matomo = null,
    posthog = null,
    youtube = null,
    clarity = null;
  const run = async (id, fn) => {
    const s = SERVICES[id];
    // Analytics services (those with fields) go under Limits only when the site uses one, which SKILL.md decides.
    // Optional extras never do.
    if (!keys[id]) {
      if (!s.fields && !s.optional)
        notChecked.push({
          area: `${s.name}: ${s.adds}`,
          reason: `No key set. To connect it: node connect-keys.mjs guide ${id}`,
        });
      return;
    }
    try {
      await fn(s.fields ? keys[id] : (keys[id].key ?? keys[id]));
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      problems.push(e.message);
      notes.push(e.message);
      notChecked.push({ area: `${s.name}: ${s.adds}`, reason: e.message });
    }
  };
  await run("bing", async key => {
    bing = await fetchBing(key, siteUrl, end("bing"), notes, { pages: bingPages, sister: bingSister });
  });
  const { authority, attribution, moz } = await fetchAuthority(run, keys, domains, end, notes);
  await run("youtube", async key => {
    if (!topics.length && !channel) {
      notes.push(
        "A YouTube key is set, but fetch got no --topics or --youtube-channel, so YouTube wasn't asked anything.",
      );
      return;
    }
    youtube = await fetchYoutube(key, end("youtube"), { topics, channel }, notes);
  });
  const period = periodFor(days);
  await run("matomo", async k => {
    matomo = await fetchMatomo(k, siteUrl, period, notes);
  });
  await run("posthog", async k => {
    posthog = await fetchPosthog(k, siteUrl, period, notes);
  });
  await run("clarity", async key => {
    clarity = await fetchClarity(key, end("clarity"), siteUrl, notes);
  });
  return {
    result: {
      source: "keys",
      when: new Date().toISOString(),
      site: siteUrl,
      bing,
      authority,
      attribution,
      moz,
      youtube,
      matomo,
      posthog,
      clarity,
      findings: crawlFinding(bing),
      notChecked,
      notes,
    },
    problems,
  };
}

// Positional words per command: set <service> [<key>], remove|guide|test <service>.
const WORDS = { set: 2, remove: 1, guide: 1, test: 1 };
const FLAGS = [
  "site",
  "competitors",
  "days",
  "out",
  "topics",
  "youtube-channel",
  "bing-pages",
  "bing-sister",
  "urls",
  "from-diff",
  ...Object.values(SERVICES).flatMap(s => (s.fields || []).map(f => f.flag)),
];
async function main(argv) {
  const [cmd, ...rest] = argv;
  const { _: pos, ...args } = parseArgs(rest, {
    flags: FLAGS,
    booleans: ["yes"],
    positionals: Object.hasOwn(WORDS, cmd) ? WORDS[cmd] : 0,
  });
  const str = k => (typeof args[k] === "string" ? args[k] : null);

  if (cmd === "set") {
    if (!pos[0]) throw new Fail(USAGE);
    const id = serviceOf(pos[0]),
      fields = SERVICES[id].fields || [];
    const values = Object.fromEntries(fields.map(f => [f.id, str(f.flag)])),
      missing = fields.filter(f => !values[f.id]);
    let key = pos[1];
    if (key == null || missing.length) {
      const got = await ask(id, missing, key == null);
      Object.assign(values, got.values);
      key ??= got.key;
    }
    setKey(id, key, values);
    console.log(
      `connect-keys: saved the ${SERVICES[id].name} key in ${keyFile()} (only your user account can read it). ${process.env[SERVICES[id].env] ? `Note: ${SERVICES[id].env} is also set and wins over the saved key.` : ""}`.trim(),
    );
  } else if (cmd === "remove") {
    if (!pos[0]) throw new Fail(USAGE);
    console.log(
      removeKey(pos[0])
        ? `connect-keys: removed the ${SERVICES[pos[0]].name} key.`
        : `connect-keys: no saved ${SERVICES[pos[0]].name} key to remove.`,
    );
  } else if (cmd === "guide") {
    if (!pos[0]) throw new Fail(USAGE);
    console.log(SERVICES[serviceOf(pos[0])].guide.join("\n"));
  } else if (cmd === "test") {
    const id = pos[0] && serviceOf(pos[0]);
    if (id !== "matomo" && id !== "posthog")
      fail("test works for matomo or posthog: node connect-keys.mjs test matomo|posthog [--yes]");
    const k = activeKeys()[id];
    if (!k) fail(`${SERVICES[id].name} isn't set up yet. To connect it: node connect-keys.mjs guide ${id}`);
    if (args.yes !== true) {
      console.log(
        `connect-keys: dry run, nothing sent. With --yes it would send your ${id === "matomo" ? `token to ${new URL(k.url).host} and ask for Matomo's version (API.getMatomoVersion)` : `key to ${new URL(k.host).host} and count project ${k.projectId}'s pageviews in the last 7 days (the query: ${POSTHOG_TEST})`}. Re-run with --yes once the owner agrees.`,
      );
      return 0;
    }
    console.log("connect-keys: " + (await (id === "matomo" ? testMatomo(k) : testPosthog(k)))); // runMain prints a refusal and exits 1
  } else if (cmd === "status") {
    const keys = activeKeys();
    for (const [id, s] of Object.entries(SERVICES)) {
      const k = keys[id];
      console.log(
        k
          ? `${s.name}: set (${mask(k.key)}, ${k.from === s.env ? `from ${s.env}` : `saved in ${k.from}`})${s.about ? ` for ${s.about(k)}` : ""}`
          : `${s.name}: not set. It adds ${s.adds}. To get a key: node connect-keys.mjs guide ${id}`,
      );
    }
  } else if (cmd === "fetch") {
    if (!str("site")) throw new Fail(USAGE);
    const site = siteOf(args.site);
    const days = args.days === undefined ? 90 : Number(str("days"));
    if (!(Number.isInteger(days) && days >= 1 && days <= 480))
      fail(`--days must be a whole number from 1 to 480, as with google.mjs (got ${args.days}).`);
    const period = periodFor(days);
    const listed = (str("competitors") || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    const skipped = listed.filter(c => !domainOf(c));
    const competitors = listed.filter(c => domainOf(c));
    const keys = activeKeys(),
      siteUrl = new URL("/", site).href;
    // *_ENDPOINT variables point services at the tests' fakes; Matomo and PostHog use the saved address instead.
    const endpoints = Object.fromEntries(
      Object.entries(SERVICES).map(([id, s]) => [id, process.env[s.endpointEnv] || s.endpoint]),
    );
    const domains = domainsFor(siteUrl, competitors);
    const skipNote = skipped.map(c => `Skipped competitor "${c}": it's not a domain name like rival.com.`);
    const listOf = s =>
      (s || "")
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);
    const topics = listOf(str("topics")),
      channel = str("youtube-channel"),
      bingPages = listOf(str("bing-pages"));
    const bingSister = str("bing-sister") && siteOf(args["bing-sister"], "--bing-sister").href;

    if (args.yes !== true) {
      const list = ds => ds.slice(0, 10).join(", ") + (ds.length > 10 ? ` … and ${ds.length - 10} more` : "");
      const { matomo: m, posthog: p } = keys;
      const yt =
        topics.length || channel
          ? `your key, ${Math.min(topics.length, YT_TOPICS)} topic search(es)${topics.length ? ` (${topics.slice(0, YT_TOPICS).join(", ")})` : ""}${channel ? ` and the channel ${channel}` : ""}`
          : "nothing (no --topics or --youtube-channel given)";
      const bingWhat = `your site's address (${siteUrl})${bingPages.length ? `, ${bingPages.length} chosen page(s) for their links` : ""}${bingSister ? `, the sister site ${bingSister}` : ""}`;
      const lines = Object.entries(SERVICES)
        .filter(([, s]) => !s.answers && !s.script)
        .map(([id, s]) =>
          !keys[id]
            ? `  ${s.name}: not set, skipped (to add it: node connect-keys.mjs guide ${id})`
            : id === "matomo"
              ? `  Matomo: your token (in the request body, never in the address) and site ID ${m.siteId}, to ${new URL(m.url).host}:${[undefined, ...Object.values(MATOMO_SPLITS), MATOMO_DAILY].map(method => `\n    POST ${matomoUrl(m, period, method)}`).join("")}`
              : id === "posthog"
                ? `  PostHog: your key and project ID ${p.projectId}, to ${new URL(p.host).host}:${[posthogQuery(period), ...Object.values(POSTHOG_SPLITS).map(q => q(period)), posthogDaily(period)].map(q => `\n    POST ${posthogUrl(p)} with the query: ${q}`).join("")}`
                : id === "youtube"
                  ? `  YouTube Data API: ${yt}, to ${new URL(endpoints[id]).host}`
                  : id === "clarity"
                    ? `  Microsoft Clarity: your token only, to ${new URL(endpoints[id]).host}: GET ${endpoints[id]}?numOfDays=${CLARITY_DAYS}&dimension1=URL (nothing about your site: the token names the Clarity project). It uses 1 of the 10 requests Clarity allows a project each day.`
                    : `  ${s.name}: ${id === "bing" ? bingWhat : id === "moz" ? `${Math.min(domains.length, MOZ_MAX)} domain name(s) (${list(domains.slice(0, MOZ_MAX))})` : `${domains.length} domain name(s) (${list(domains)})`} and your key, to ${new URL(endpoints[id]).host}`,
        );
      console.log(
        `connect-keys: dry run, nothing sent. With --yes it would send:\n${lines.join("\n")}${skipNote.length ? "\n" + skipNote.join("\n") : ""}\nThese go to outside services, so re-run with --yes once the owner agrees.`,
      );
      return 0;
    }
    const { result, problems } = await fetchKeys({
      site: siteUrl,
      competitors,
      keys,
      endpoints,
      days,
      topics,
      channel,
      bingPages,
      bingSister,
    });
    result.notes.push(...skipNote);
    const out = resolve(str("out") || "seo-audit/keys.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(result, null, 2));
    for (const p of problems) console.log("connect-keys: " + p);
    const b = result.bing,
      visits = (name, x) => (x ? `${name} ${Object.keys(x.traffic).length} pages · ` : "");
    console.log(
      `connect-keys: ${b ? `Bing ${Object.keys(b.traffic).length} pages, ${b.queries.length} queries, ${b.backlinks.pages.length} linked pages${b.crawlIssues ? `, ${b.crawlIssues.length} crawl issues` : ""} · ` : ""}${result.authority.length ? `authority for ${result.authority.length} domain(s) · ` : ""}${result.moz?.length ? `Moz for ${result.moz.length} domain(s) · ` : ""}${result.youtube ? `YouTube ${result.youtube.topics.length} topic(s) · ` : ""}${visits("Matomo", result.matomo)}${visits("PostHog", result.posthog)}${result.clarity ? `Clarity ${Object.keys(result.clarity.traffic).length} pages · ` : ""}${result.findings.length} finding(s) · wrote ${out}`,
    );
    return problems.length ? 1 : 0;
  } else if (cmd === "submit-bing") {
    if (!str("site") || !(str("urls") || str("from-diff"))) throw new Fail(USAGE);
    const site = siteOf(args.site),
      key = activeKeys().bing?.key;
    if (!key) fail("no Bing Webmaster Tools key is set. To connect it: node connect-keys.mjs guide bing");
    const read = f => {
      try {
        return readFileSync(f, "utf8");
      } catch (e) {
        fail(`can't read ${f} (${e.code || e.message}).`);
      }
    };
    const found = [];
    if (str("urls"))
      found.push(
        ...read(args.urls)
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(s => s && !s.startsWith("#")),
      );
    if (str("from-diff")) {
      let d;
      try {
        d = JSON.parse(read(args["from-diff"]));
      } catch (e) {
        if (e instanceof Fail) throw e;
        fail(`${args["from-diff"]} isn't a seo-diff.json (run seo-diff.mjs first).`);
      }
      found.push(...changedPages(d));
    }
    // Bing takes only the site's own URLs, so anything off-origin is dropped before sending.
    const kept = new Set(),
      others = [];
    for (const s of found.filter(s => typeof s === "string")) {
      let u;
      try {
        u = /^(https?:\/\/|\/)/i.test(s) ? new URL(s, site) : null;
      } catch {}
      if (u?.origin === site.origin) {
        u.hash = "";
        kept.add(u.href);
      } else others.push(s);
    }
    const urls = [...kept];
    if (others.length)
      console.log(
        `connect-keys: left out ${others.length} URL(s) that aren't on ${site.origin} (Bing only takes the site's own URLs), e.g. ${others[0]}`,
      );
    if (!urls.length) {
      console.log(`connect-keys: no URLs on ${site.origin} to submit.`);
      return 0;
    }
    if (args.yes !== true) {
      console.log(
        `connect-keys: dry run, nothing sent. With --yes it would ask Bing Webmaster Tools, with your key, for the site's URL submission quota (GetUrlSubmissionQuota), then submit as many of these ${urls.length} URL(s) as fit in it (SubmitUrlBatch, up to ${BATCH} a request):\n${urls
          .slice(0, 20)
          .map(u => "  " + u)
          .join(
            "\n",
          )}${urls.length > 20 ? `\n  … and ${urls.length - 20} more` : ""}\nIndexNow (indexnow.mjs) already tells Bing about changed pages; this asks Bing directly. It's a write to the owner's Bing Webmaster Tools account, so re-run with --yes once the owner agrees.`,
      );
      return 0;
    }
    const r = await submitBing({
      key,
      site: site.href,
      urls,
      endpoint: process.env[SERVICES.bing.endpointEnv] || SERVICES.bing.endpoint,
    });
    const { quota, sent, notSent, error } = r;
    console.log(
      `connect-keys: Bing's URL submission quota for ${r.siteUrl}: ${num(quota.daily)} URL(s) today${quota.monthly != null ? `, ${num(quota.monthly)} this month` : ""}.`,
    );
    if (!sent && !error) {
      console.log("connect-keys: the quota is used up, so nothing was sent. Submit again on another day.");
      return 1;
    }
    if (sent) console.log(`connect-keys: submitted ${sent} URL(s) to Bing Webmaster Tools.`);
    if (error) console.log(`connect-keys: ${error}`);
    if (notSent.length)
      console.log(
        `connect-keys: ${notSent.length} URL(s) ${error ? "weren't sent" : "didn't fit in the quota and weren't sent"}, starting with ${notSent[0]}. Submit them on another day.`,
      );
    return error ? 1 : 0;
  } else throw new Fail(USAGE);
  return 0;
}

if (isMain(import.meta.url)) {
  warnProxy(); // once, before any request is sent
  await runMain(() => main(process.argv.slice(2)));
}
