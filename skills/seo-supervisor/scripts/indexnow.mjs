#!/usr/bin/env node
// @ts-check
// Tells the IndexNow engines (Bing, Yandex, Seznam, Naver, Yep, Internet Archive, Amazonbot) which URLs changed.
// Google doesn't use IndexNow.
// https://www.indexnow.org/documentation
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain, warnProxy } from "./lib/cli.mjs";
import { bodyUpTo } from "./lib/http.mjs";
import { isPublic } from "./lib/net.mjs";
import { changedPages } from "./seo-diff.mjs";

const USAGE =
  "usage: node indexnow.mjs key --public-dir <dir> [--site https://x]\n       node indexnow.mjs submit --site https://x --key <key> (--urls file.txt | --from-diff seo-diff.json | --from-sitemap https://x/sitemap.xml) [--endpoint url] [--out seo-audit/indexnow.json] [--yes]";
const fail = msg => {
  throw new Fail("indexnow: " + msg);
};
const KEY = /^[a-zA-Z0-9-]{8,128}$/;
const UA = "seo-supervisor-indexnow";
// A sitemap may be at most 50 MB uncompressed, so neither the answer nor a .gz's output is read past that: a
// decompression bomb can't fill memory.
// https://www.sitemaps.org/protocol.html
const SITEMAP_MAX = 52428800;
const siteOf = s => {
  try {
    const u = new URL(s);
    if (/^https?:$/.test(u.protocol)) return u;
  } catch {}
  fail(`--site must be the site's origin, like https://www.example.com (got ${s})`);
};

const read = f => {
  try {
    return readFileSync(f, "utf8");
  } catch (e) {
    fail(`can't read ${f} (${e.code || e.message})`);
  }
};
const getText = async u => {
  let r, b;
  try {
    r = await fetch(u, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
    if (r.ok) b = await bodyUpTo(r, SITEMAP_MAX);
  } catch (e) {
    fail(`couldn't fetch ${u} (${e.cause?.code || e.message})`);
  }
  if (!r.ok) fail(`${u} returned ${r.status}`);
  if (!b) fail(`${u} is over 50 MB, more than a sitemap may be (sitemaps.org)`);
  // A gzipped sitemap (sitemap.xml.gz) starts with gzip's magic bytes 1f 8b; a server that already decoded it doesn't.
  if (b[0] !== 0x1f || b[1] !== 0x8b) return b.toString("utf8");
  try {
    return gunzipSync(b, { maxOutputLength: SITEMAP_MAX }).toString("utf8");
  } catch (e) {
    fail(
      e.code === "ERR_BUFFER_TOO_LARGE"
        ? `${u} unpacks to more than 50 MB, more than a sitemap may be (sitemaps.org)`
        : `${u} looks gzipped but couldn't be unpacked`,
    );
  }
};
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = s =>
  s
    .trim()
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
      e[0] === "#"
        ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
        : (ENT[e.toLowerCase()] ?? m),
    );
const locs = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?<loc>([\\s\\S]*?)</loc>`, "gi"))].map(m => decode(m[1]));
// An index is followed one level, to children on its own host or a public address: the index itself may be local, but
// it can't point this script at a private network.
async function sitemapLocs(u) {
  const xml = await getText(u);
  if (!/<sitemapindex\b/i.test(xml)) return locs(xml, "url");
  const out = [],
    host = new URL(u).host;
  for (const child of locs(xml, "sitemap")) {
    let same = false;
    try {
      same = new URL(child).host === host;
    } catch {}
    if (same || isPublic(child)) out.push(...locs(await getText(child), "url"));
    else console.log(`indexnow: skipped the child sitemap ${child}: it isn't on ${host} or a public web address.`);
  }
  return out;
}

const MEANING = {
  200: "accepted, the URLs were submitted",
  202: "accepted, the URLs were received while IndexNow still validates the key",
  400: "bad request, the request isn't in IndexNow's format",
  403: "refused, the key file isn't reachable or doesn't match the key",
  422: "refused, some URLs don't belong to the host or the key doesn't match",
  429: "refused, too many requests (IndexNow treats this as possible spam); wait before submitting again",
};

const strOf = args => k => (typeof args[k] === "string" ? args[k] : null);

async function key(args) {
  const str = strOf(args),
    dir = str("public-dir");
  if (!dir) throw new Fail(USAGE);
  if (!existsSync(dir) || !statSync(dir).isDirectory())
    fail(
      `${dir} isn't a folder. Pass the committed folder the site serves at its root, like public/ or static/ (not the build output, which the next build wipes).`,
    );
  const site = str("site") && siteOf(args.site);
  const existing = readdirSync(dir, { withFileTypes: true })
    .filter(f => f.isFile() && f.name.endsWith(".txt"))
    .map(f => f.name.slice(0, -4))
    .find(k => KEY.test(k) && readFileSync(join(dir, k + ".txt"), "utf8").trim() === k);
  const k = existing || randomBytes(16).toString("hex");
  if (!existing) writeFileSync(join(dir, k + ".txt"), k, { flag: "wx" }); // wx: never overwrites a file that's already there
  console.log(
    `indexnow: ${existing ? "reusing the key file" : "wrote"} ${join(dir, k + ".txt")}\nkey: ${k}\nOnce deployed it must open at ${site ? new URL(`/${k}.txt`, site).href : `https://<your-site>/${k}.txt`} (the site root). Then submit with --key ${k}.`,
  );
  return 0;
}

async function submit(args) {
  const str = strOf(args);
  if (!str("site") || !str("key") || !(str("urls") || str("from-diff") || str("from-sitemap"))) throw new Fail(USAGE);
  const site = siteOf(args.site),
    key = args.key;
  if (!KEY.test(key)) fail(`--key must be 8 to 128 letters, digits or dashes, as IndexNow requires (got "${key}").`);
  const keyLocation = new URL(`/${key}.txt`, site).href;
  const ENDPOINT = str("endpoint") || "https://api.indexnow.org/indexnow";
  // A dry run writes its own file, so it never overwrites the record of a real send.
  const OUT = resolve(str("out") || "seo-audit/indexnow.json"),
    DRY_OUT = OUT.replace(/(\.json)?$/i, "-dryrun.json");

  // "www.example.com/about" is a URL without its scheme; "page.html" and "docs/setup" stay paths.
  const schemeless = s =>
    /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$)/i.test(s) &&
    !/^[^/]*\.(html?|php|aspx?|jsp|xml|txt|json|pdf)(\/|$)/i.test(s);
  const found = [];
  if (str("urls"))
    found.push(
      ...read(args.urls)
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(s => s && !s.startsWith("#"))
        .map(s => (schemeless(s) ? "https://" + s : s)),
    );
  if (str("from-diff")) {
    let d;
    try {
      d = JSON.parse(read(args["from-diff"]));
    } catch (e) {
      if (e instanceof Fail) throw e;
      fail(`${args["from-diff"]} isn't a seo-diff.json (run seo-diff.mjs first).`);
    }
    // seo-diff already leaves failing URLs out of the added pages.
    found.push(...changedPages(d));
  }
  if (str("from-sitemap")) found.push(...(await sitemapLocs(args["from-sitemap"])));

  // IndexNow refuses the whole batch (422) when a URL belongs to another host, so only this host's URLs go.
  const kept = new Set(),
    skipped = [];
  for (const s of found) {
    let u;
    try {
      u = new URL(s, site);
    } catch {
      skipped.push(s);
      continue;
    }
    u.hash = "";
    if (u.host === site.host && /^https?:$/.test(u.protocol)) kept.add(u.href);
    else skipped.push(s);
  }
  const urls = [...kept];
  if (skipped.length)
    console.log(
      `indexnow: skipped ${skipped.length} URL(s) on another host (IndexNow only takes ${site.host}'s own URLs), e.g. ${skipped[0]}`,
    );
  if (!urls.length) {
    console.log(`indexnow: no URLs on ${site.host} to submit.`);
    return 0;
  }
  // IndexNow takes at most 10,000 URLs per POST.
  const batches = [];
  for (let i = 0; i < urls.length; i += 10000) batches.push(urls.slice(i, i + 10000));
  const record = (sent, results) => {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      sent ? OUT : DRY_OUT,
      JSON.stringify(
        {
          when: new Date().toISOString(),
          sent,
          endpoint: ENDPOINT,
          host: site.host,
          keyLocation,
          count: urls.length,
          skipped: skipped.length,
          batches: results,
          urls,
        },
        null,
        2,
      ),
    );
  };

  if (!args.yes) {
    record(false, []);
    console.log(
      `indexnow: dry run, nothing sent. It would POST ${urls.length} URL(s) for ${site.host} to ${ENDPOINT} in ${batches.length} batch(es), with keyLocation ${keyLocation}:\n${urls
        .slice(0, 20)
        .map(u => "  " + u)
        .join(
          "\n",
        )}${urls.length > 20 ? `\n  … and ${urls.length - 20} more` : ""}\nThe full list is in ${DRY_OUT}. Sending tells outside search engines about these URLs: re-run with --yes once the owner approves and ${keyLocation} is live.`,
    );
    return 0;
  }

  let check;
  // Redirects aren't followed: IndexNow wants the key at keyLocation itself, and a redirect to another host means
  // --site is wrong.
  try {
    const r = await fetch(keyLocation, {
      redirect: "manual",
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(20000),
    });
    check = {
      status: r.status,
      body: String((await bodyUpTo(r, 1024)) ?? "").trim(),
      location: r.headers.get("location"),
    };
  } catch (e) {
    check = { status: e.cause?.code || e.message, body: "" };
  }
  let moved;
  try {
    moved = check.location && new URL(check.location, keyLocation);
  } catch {}
  if (moved && moved.host !== site.host)
    fail(
      `${keyLocation} redirects to ${moved.href}: your site answers at ${moved.host}; use --site ${moved.origin}. Nothing was sent.`,
    );
  if (check.status !== 200 || check.body !== key)
    fail(
      `the key file isn't deployed yet: ${keyLocation} ${check.status === 200 ? "doesn't contain the key" : `returned ${check.status}`}. Deploy it (node indexnow.mjs key --public-dir <the folder served at the site root>), check it opens in a browser, then re-run. Nothing was sent.`,
    );

  const results = [];
  for (const [i, list] of batches.entries()) {
    let status = null,
      meaning,
      detail = "";
    try {
      const r = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", "user-agent": UA },
        body: JSON.stringify({ host: site.host, key, keyLocation, urlList: list }),
        signal: AbortSignal.timeout(30000),
      });
      status = r.status;
      detail = (await r.text()).trim().slice(0, 300);
      meaning = MEANING[status] || "unexpected response";
    } catch (e) {
      meaning = `no response (${e.cause?.code || e.message})`;
    }
    const ok = status === 200 || status === 202;
    results.push({ urls: list.length, status, meaning, ...(!ok && detail ? { detail } : {}) });
    console.log(
      `indexnow: batch ${i + 1}/${batches.length} (${list.length} URLs): ${status ?? "-"} ${meaning}${!ok && detail ? `: ${detail}` : ""}`,
    );
    if (!ok) {
      if (i + 1 < batches.length) console.log(`indexnow: stopped, ${batches.length - i - 1} batch(es) not sent.`);
      break;
    }
  }
  record(true, results);
  console.log(`indexnow: wrote ${OUT}`);
  return results.every(r => r.status === 200 || r.status === 202) ? 0 : 1;
}

if (isMain(import.meta.url))
  await runMain(() => {
    const args = parseArgs(process.argv.slice(2), {
        flags: ["public-dir", "site", "key", "urls", "from-diff", "from-sitemap", "endpoint", "out"],
        booleans: ["yes"],
        positionals: 1,
        usage: USAGE,
      }),
      cmd = args._[0];
    if (cmd !== "key") warnProxy(); // once, before any request: key only writes a local file
    return cmd === "key" ? key(args) : cmd === "submit" ? submit(args) : Promise.reject(new Fail(USAGE));
  });
