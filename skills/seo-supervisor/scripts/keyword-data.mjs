#!/usr/bin/env node
// @ts-check
// Keyword metrics from DataForSEO or Semrush, and competitor gaps from DataForSEO. Dry run unless --yes.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain, warnProxy } from "./lib/cli.mjs";
import { SERVICES, activeKeys, keyFile, call, Refused, domainOf } from "./connect-keys.mjs";
import { dataforseoProblem } from "./keys/dataforseo.mjs";

const MAX_KEYWORDS = 200,
  MAX_COMPETITORS = 3,
  GAP_ROWS = 100; // local caps, not API limits
const DFS_BATCH = 700,
  DFS_TASK = 0.012,
  DFS_ITEM = 0.00012; // dataforseo.com/pricing, Nov 2026
const SEMRUSH_UNITS = 20; // per request: developer.semrush.com/api/v4/seo/keyword-reports
const IDEA_GROUPS = ["almostThere", "gaps", "questions", "extra"];
const USAGE =
  "usage: node keyword-data.mjs --site https://www.example.com (--ideas seo-audit/keyword-ideas.json | --keywords keywords.txt) [--competitors a.com,b.com] [--service dataforseo|semrush] [--country US] [--language en] [--out seo-audit/keyword-data.json] [--yes]";
const fail = msg => {
  throw new Fail("keyword-data: " + msg);
};
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const dollars = x => `$${(Math.ceil(x * 100 - 1e-9) / 100).toFixed(2)}`;
const plural = (n, w) => `${n.toLocaleString("en-US")} ${n === 1 ? w : w + "s"}`;

function read(file, what) {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    return fail(`can't read ${what} ${file} (${e.code || e.message}).`);
  }
}
function keywordsFrom(ideas, list) {
  const out = new Set(),
    add = k => {
      const t = String(k ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
      if (t) out.add(t);
    };
  if (ideas) {
    let j;
    try {
      j = JSON.parse(read(ideas, "the keyword ideas"));
    } catch (e) {
      if (e instanceof Fail) throw e;
      fail(`${ideas} isn't keyword-ideas.json (run keyword-ideas.mjs first).`);
    }
    for (const g of IDEA_GROUPS) for (const i of Array.isArray(j?.[g]) ? j[g] : []) add(i?.phrase);
  }
  if (list)
    for (const line of read(list, "the keyword file").split(/\r?\n/)) if (!line.trim().startsWith("#")) add(line);
  return [...out];
}

// Both fill `got`, so what was read before a refusal is kept.
async function askDataforseo({ keywords, competitors, domain, place, k, endpoint, log, got }) {
  const headers = {
    authorization: "Basic " + Buffer.from(`${k.login}:${k.key}`).toString("base64"),
    "content-type": "application/json",
  };
  const post = async (path, task) => {
    const b = await call("dataforseo", `${endpoint}/dataforseo_labs/google/${path}/live`, {
      method: "POST",
      redirect: "manual",
      headers,
      body: JSON.stringify([task]),
    });
    const problem = dataforseoProblem(b);
    if (problem) throw new Refused(problem);
    got.spent.usd = Math.round((got.spent.usd + (num(b.cost) ?? 0)) * 1e6) / 1e6;
    const items = b.tasks[0].result?.[0]?.items;
    return Array.isArray(items) ? items : [];
  };
  for (let i = 0; i < keywords.length; i += DFS_BATCH) {
    for (const it of await post("keyword_overview", { keywords: keywords.slice(i, i + DFS_BATCH), ...place })) {
      if (typeof it?.keyword !== "string") continue;
      const main = it.search_intent_info?.main_intent;
      got.rows.push({
        keyword: it.keyword.toLowerCase(),
        volume: num(it.keyword_info?.search_volume),
        difficulty: num(it.keyword_properties?.keyword_difficulty),
        cpc: num(it.keyword_info?.cpc),
        intent: typeof main === "string" ? [main] : [],
      });
    }
    log(`keyword metrics: ${Math.min(i + DFS_BATCH, keywords.length)} of ${keywords.length} keywords asked`);
  }
  for (const rival of competitors) {
    const items = await post("domain_intersection", {
      target1: rival,
      target2: domain,
      intersections: false,
      item_types: ["organic"],
      ...place,
      limit: GAP_ROWS,
    });
    got.competitorRows.push({
      domain: rival,
      keywords: items
        .filter(it => typeof it?.keyword_data?.keyword === "string")
        .map(it => ({
          keyword: it.keyword_data.keyword,
          volume: num(it.keyword_data.keyword_info?.search_volume),
          position: num(it.first_domain_serp_element?.rank_group),
          url: typeof it.first_domain_serp_element?.url === "string" ? it.first_domain_serp_element.url : null,
        })),
    });
  }
}

async function askSemrush({ keywords, country, k, endpoint, log, got }) {
  for (const [i, keyword] of keywords.entries()) {
    const b = await call("semrush", `${endpoint}/keywords/v1/metrics?${new URLSearchParams({ keyword, country })}`, {
      redirect: "manual",
      headers: { authorization: `Apikey ${k.key}` },
    });
    got.spent.units += SEMRUSH_UNITS;
    const d = b?.meta?.success === false ? null : b?.data;
    // cpc comes in cents.
    if (d && typeof d === "object")
      got.rows.push({
        keyword,
        volume: num(d.search_volume),
        difficulty: num(d.keyword_difficulty),
        cpc: num(d.cpc) === null ? null : Math.round(d.cpc) / 100,
        intent: (Array.isArray(d.intents) ? d.intents : [])
          .filter(x => typeof x === "string")
          .map(x => x.toLowerCase()),
      });
    if ((i + 1) % 20 === 0) log(`${i + 1} of ${keywords.length} keywords asked`);
  }
}

function main(argv) {
  const args = parseArgs(argv, {
    flags: ["site", "ideas", "keywords", "competitors", "service", "country", "language", "out"],
    booleans: ["yes"],
    aliases: { rivals: "competitors" },
    positionals: 0,
    usage: USAGE,
  });
  const str = k => (typeof args[k] === "string" ? args[k] : null);
  if (!str("site") || !(str("ideas") || str("keywords"))) throw new Fail(USAGE);
  let site;
  try {
    site = new URL(str("site"));
  } catch {}
  if (!site || !/^https?:$/.test(site.protocol))
    fail(`--site must be the site's address, like https://www.example.com (got ${args.site})`);
  const siteUrl = new URL("/", site).href,
    domain = domainOf(siteUrl);

  const iso = (str("country") || "US").toUpperCase().replace(/^UK$/, "GB");
  const region = /^[A-Z]{2}$/.test(iso) ? new Intl.DisplayNames(["en"], { type: "region" }).of(iso) : null;
  if (!region || region === iso)
    fail(`--country must be a two-letter country code like US or GB (got ${args.country}).`);
  const language = (str("language") || "en").toLowerCase();
  if (!/^[a-z]{2}(-[a-z]+)?$/.test(language))
    fail(`--language must be a language code like en or de (got ${args.language}).`);
  const service = str("service")?.toLowerCase() ?? null;
  if (service && !["dataforseo", "semrush"].includes(service))
    fail(`--service is dataforseo or semrush (got ${args.service}).`);
  const listed = (str("competitors") || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const notes = listed
    .filter(c => !domainOf(c))
    .map(c => `Skipped competitor "${c}": it's not a domain name like rival.com.`);
  const competitors = [...new Set(listed.map(domainOf).filter(d => d && d !== domain))];
  if (competitors.length > MAX_COMPETITORS)
    fail(
      `at most ${MAX_COMPETITORS} competitors a run (our own cap, to keep the cost small; got ${competitors.length}).`,
    );

  const keys = activeKeys(),
    id = service ?? (keys.dataforseo ? "dataforseo" : keys.semrush ? "semrush" : null);
  let keywords = keywordsFrom(str("ideas"), str("keywords"));
  if (!keywords.length) fail("no keywords to ask about: the ideas and the keyword file are empty.");
  if (id === "dataforseo") {
    const long = keywords.filter(w => w.length > 80 || w.split(" ").length > 10);
    if (long.length)
      notes.push(
        `Left out ${plural(long.length, "keyword")} over DataForSEO's 80 characters or 10 words, e.g. "${long[0]}".`,
      );
    keywords = keywords.filter(w => !long.includes(w));
  }
  if (keywords.length > MAX_KEYWORDS) {
    notes.push(`Asked about the first ${MAX_KEYWORDS} of ${keywords.length} keywords (our own cap).`);
    keywords = keywords.slice(0, MAX_KEYWORDS);
  }
  const k = id && keys[id],
    s = id && SERVICES[id],
    endpoint = id && (process.env[s.endpointEnv] || s.endpoint).replace(/\/+$/, "");
  const gaps = id === "dataforseo" ? competitors : [];
  if (id === "semrush" && competitors.length)
    notes.push(
      `Competitor keywords need DataForSEO, so ${competitors.join(", ")} ${competitors.length === 1 ? "isn't" : "aren't"} asked.`,
    );

  if (!args.yes) {
    if (!k) {
      console.log(
        `keyword-data: dry run, nothing sent. No ${id ? s.name : "DataForSEO or Semrush"} key is set, so nothing would be sent. To add one: node connect-keys.mjs guide ${id || "dataforseo"}${id ? "" : " (or guide semrush)"}`,
      );
      return 0;
    }
    const saved = k.from === s.env ? `from ${s.env}` : `saved in ${keyFile()}`;
    const lines =
      id === "dataforseo"
        ? [
            `keyword-data: dry run, nothing sent. With --yes it would ask DataForSEO, with the API login ${k.login} and its password ${saved}, for ${region} (${iso}), in ${language}:`,
            `  POST ${endpoint}/dataforseo_labs/google/keyword_overview/live: ${plural(keywords.length, "keyword")}${keywords.length > DFS_BATCH ? `, in ${Math.ceil(keywords.length / DFS_BATCH)} requests` : ""}`,
            ...gaps.map(
              r =>
                `  POST ${endpoint}/dataforseo_labs/google/domain_intersection/live: up to ${GAP_ROWS} keywords ${r} ranks for and ${domain} doesn't`,
            ),
            `  DataForSEO bills your balance: at most ${dollars(Math.ceil(keywords.length / DFS_BATCH) * DFS_TASK + keywords.length * DFS_ITEM + gaps.length * (DFS_TASK + GAP_ROWS * DFS_ITEM))} ($${DFS_TASK} a request and $${DFS_ITEM} a keyword or row, its price list on 25 Nov 2026).`,
          ]
        : [
            `keyword-data: dry run, nothing sent. With --yes it would ask Semrush, with your key ${saved}, for ${region} (${iso}):`,
            `  Semrush: ${plural(keywords.length, "request")} to GET ${endpoint}/keywords/v1/metrics, one per keyword`,
            `  Semrush takes ${SEMRUSH_UNITS} API units a request, ${(keywords.length * SEMRUSH_UNITS).toLocaleString("en-US")} units in all.`,
          ];
    console.log(
      [
        ...lines,
        "The keywords, exactly as they would be sent:",
        ...keywords.map((w, i) => `  ${i + 1}. ${w}`),
        ...notes,
        `Your keywords${gaps.length ? " and the domain names" : ""} go to ${s.name} at your cost, so re-run with --yes once the owner agrees.`,
      ].join("\n"),
    );
    return 0;
  }
  if (!k)
    fail(
      `no ${id ? s.name : "DataForSEO or Semrush"} key is set. To add one: node connect-keys.mjs guide ${id || "dataforseo"}`,
    );
  return run({
    id,
    k,
    endpoint,
    keywords,
    gaps,
    domain,
    siteUrl,
    iso,
    language,
    notes,
    out: resolve(str("out") || "seo-audit/keyword-data.json"),
  });
}

async function run({ id, k, endpoint, keywords, gaps, domain, siteUrl, iso, language, notes, out }) {
  const log = msg => console.error("keyword-data: " + msg);
  const got = { rows: [], competitorRows: [], spent: id === "dataforseo" ? { usd: 0 } : { units: 0 } };
  let error = null;
  try {
    if (id === "dataforseo")
      await askDataforseo({
        keywords,
        competitors: gaps,
        domain,
        place: { location_name: new Intl.DisplayNames(["en"], { type: "region" }).of(iso), language_code: language },
        k,
        endpoint,
        log,
        got,
      });
    else await askSemrush({ keywords, country: iso, k, endpoint, log, got });
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    error = e.message;
  }
  const found = new Set(got.rows.map(r => r.keyword));
  const result = {
    source: "keyword-data",
    date: new Date().toISOString().slice(0, 10),
    site: siteUrl,
    service: id,
    serviceName: SERVICES[id].name,
    country: iso,
    ...(id === "dataforseo" && { language }),
    keywords: got.rows.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1)),
    notFound: error ? [] : keywords.filter(w => !found.has(w)),
    competitors: got.competitorRows,
    spent: got.spent,
    ...(error && { error }),
    notes,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
  if (error) console.log("keyword-data: " + error);
  console.log(
    `keyword-data: ${got.rows.length} of ${plural(keywords.length, "keyword")} have data, from ${SERVICES[id].name}.`,
  );
  for (const c of got.competitorRows)
    console.log(
      `keyword-data: ${c.domain} ranks for ${plural(c.keywords.length, "keyword")} ${domain} doesn't (the top ${GAP_ROWS} by searches).`,
    );
  for (const n of notes) console.log("keyword-data: " + n);
  console.log(`keyword-data: ${"usd" in got.spent ? `spent ${dollars(got.spent.usd)}` : `used ${got.spent.units.toLocaleString("en-US")} API units`}.
keyword-data: wrote ${out}`);
  return error ? 1 : 0;
}

if (isMain(import.meta.url)) {
  warnProxy();
  await runMain(() => main(process.argv.slice(2)));
}
