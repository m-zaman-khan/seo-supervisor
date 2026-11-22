#!/usr/bin/env node
// @ts-check
// Audits content data (JSON, CSV or a Markdown folder) before it becomes pages.

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { parseCsv } from "./lib/csv.mjs";
import { join, dirname, resolve, extname, basename } from "node:path";
import {
  titleWidth,
  widthText,
  templatedDescs,
  templatedShare,
  sectionOf,
  claimsIn,
  invisibleChar,
} from "./checks/content.mjs";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain } from "./lib/cli.mjs";
import { createFindings } from "./lib/findings.mjs";

const FLAGS = [
  "in",
  "csv",
  "md",
  "items",
  "id",
  "url",
  "title",
  "desc",
  "text",
  "faq",
  "publish",
  "group",
  "strip",
  "required",
  "banned",
  "verify",
  "threshold",
  "date",
  "max-age",
  "fail-on",
  "out",
];

function main(argv) {
  const args = parseArgs(argv, { flags: FLAGS, positionals: 0 });
  if (!["in", "csv", "md"].some(k => typeof args[k] === "string"))
    throw new Fail(
      "Usage: node content-scan.mjs --in content.json | --csv file.csv | --md dir  [--id] [--url] [--title] [--desc] [--text] [--faq] [--publish] [--group] [--strip] [--required] [--banned] [--verify] [--threshold 0.5] [--date field] [--max-age 12] [--fail-on checks] [--out file]",
    );
  const list = v =>
    typeof v === "string"
      ? v
          .split(",")
          .map(s => s.trim())
          .filter(Boolean)
      : [];
  const get = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
  const OUT = resolve(typeof args.out === "string" ? args.out : "seo-audit/content-scan.json");
  const THRESH = Number(args.threshold || 0.5);
  const regex = (flag, src, flags) => {
    try {
      return new RegExp(src, flags);
    } catch (e) {
      throw new Fail(`content-scan: --${flag} isn't a valid regular expression (${e.message}).`);
    }
  };
  const STRIP = typeof args.strip === "string" ? regex("strip", `\\b(${args.strip})\\b`, "gi") : null;
  const BANNED = typeof args.banned === "string" ? regex("banned", args.banned, "i") : null;
  const VERIFY = typeof args.verify === "string" ? regex("verify", args.verify, "i") : null;
  const MAX_AGE = Number(args["max-age"] || 12); // months: the far end of CONTENT-07's 6–12 month review cycle
  const FAIL_ON = list(args["fail-on"]);
  // Placeholders, plus mojibake: U+FFFD and curly apostrophes turned into "?" (We?re, Don?t).
  const PH =
    /\b[Ll]orem [Ii]psum\b|\bTODO\b|\bTBD\b|\{\{\s*[\w.]+\s*\}\}|\[(?:[A-Z][A-Z _]{2,29})\]|�|\b(?:We|You|They|It|Don|Can|Isn|Won|Doesn|Didn|That|There)\?(?:ve|re|s|t|ll|d)\b/;

  function walk(d) {
    return readdirSync(d).flatMap(f => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }
  function parseMd(file) {
    const raw = readFileSync(file, "utf8");
    const rec = { _file: file, slug: basename(file, extname(file)) };
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    const fm = m ? m[1] : "",
      body = m ? m[2] : raw;
    for (const line of fm.split(/\r?\n/)) {
      const k = line.match(/^([\w-]+):\s*(.*)$/);
      if (k) rec[k[1]] = k[2].replace(/^["']|["']$/g, "");
    }
    rec.body = body;
    return rec;
  }
  let records = [],
    source = "";
  if (typeof args.in === "string") {
    source = args.in;
    let data;
    const text = readFileSync(args.in, "utf8");
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Fail(
        `content-scan: ${args.in} isn't JSON (${e.message}). Dump the content as JSON first, or pass --csv or --md.`,
      );
    }
    if (typeof args.items === "string") data = get(data, args.items);
    if (Array.isArray(data)) records = data;
    else if (data && typeof data === "object") {
      const vals = Object.entries(data);
      records = vals.every(([, v]) => Array.isArray(v))
        ? vals.flatMap(([k, v]) => v.map(r => ({ _type: k, ...r })))
        : vals.map(([k, v]) => ({ _key: k, ...v }));
    }
  } else if (typeof args.csv === "string") {
    source = args.csv;
    records = parseCsv(readFileSync(args.csv, "utf8"));
  } else {
    source = args.md;
    records = walk(args.md)
      .filter(f => /\.mdx?$/.test(f))
      .map(parseMd);
  }
  records = records.filter(r => r && typeof r === "object");

  const ID = typeof args.id === "string" ? args.id : null;
  const idOf = (r, i) => String((ID && get(r, ID)) ?? r.slug ?? r.id ?? r._key ?? r.title ?? `#${i + 1}`);
  const urlOf = (r, i) =>
    typeof args.url === "string" ? args.url.replace(/\{([\w.]+)\}/g, (_, k) => get(r, k) ?? "") : idOf(r, i);
  const str = v =>
    v == null
      ? ""
      : Array.isArray(v)
        ? v.map(str).join(" ")
        : typeof v === "object"
          ? Object.values(v).map(str).join(" ")
          : String(v);
  const norm = s =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  let textFields = list(args.text);
  if (!textFields.length && records.length) {
    const lens = {};
    for (const r of records.slice(0, 50))
      for (const [k, v] of Object.entries(r)) if (typeof v === "string") lens[k] = (lens[k] || 0) + v.length;
    const best = Object.entries(lens).sort((a, b) => b[1] - a[1])[0];
    if (best) textFields = [best[0]];
  }
  // A record's own name words are removed too, so a swapped city or product name can't hide templated copy.
  const own = r =>
    [ID && get(r, ID), r.slug, r.title, r.name, r.city, r.location]
      .filter(Boolean)
      .map(x => norm(String(x).replace(/-/g, " ")))
      .filter(x => x.length > 2);
  function cleanText(r) {
    let t = norm(textFields.map(f => str(get(r, f))).join(" "));
    if (STRIP) t = t.replace(new RegExp(STRIP.source, "gi"), " ");
    for (const o of own(r)) t = t.split(o).join(" ");
    return t.replace(/\s+/g, " ").trim();
  }
  const shingles = t => {
    const w = t.split(" ").filter(Boolean);
    const s = new Set();
    for (let i = 0; i + 5 <= w.length; i++) s.add(w.slice(i, i + 5).join(" "));
    return s;
  };
  const isLive = v => /^(1|true|yes|y|live|published|publish)$/i.test(String(v ?? "").trim());
  function ctx(text, re) {
    const m = re.exec(text);
    if (!m) return null;
    const s = Math.max(0, m.index - 50),
      e = Math.min(text.length, m.index + m[0].length + 50);
    return `“${m[0]}” in: ${s ? "…" : ""}${text.slice(s, e)}${e < text.length ? "…" : ""}`;
  }

  const CHECKS = {
    "templated-text": [
      "CONTENT-04",
      "high",
      n => `${n} pair(s) of items share most of their copy`,
      "Items whose text differs only by a swapped name (city, product, tool) become doorway or scaled-content pages.",
      "Write specific copy per item, or merge and hold the items that can't be made unique.",
    ],
    "few-distinct-texts": [
      "CONTENT-04",
      "high",
      n => `Only ${n} distinct text(s) once names are removed`,
      "When hundreds of items collapse to a handful of texts after removing the swapped name, the pages are templates.",
      "Treat each template as one page's worth of content; add real per-item substance before publishing more.",
    ],
    "faq-reused": [
      "CONTENT-04",
      "medium",
      n => `${n} FAQ question(s) are reused across items`,
      "Identical FAQs on many pages add nothing unique.",
      "Write questions specific to each item; keep shared questions on one FAQ page.",
    ],
    "missing-field": [
      "CONTENT-05",
      "high",
      n => `${n} item(s) are missing required fields`,
      "Required fields (local proof, unique intro, author) are what make a page worth indexing.",
      "Fill the fields, or keep the item unpublished until they're filled.",
    ],
    "unpublished": [
      "CRAWL-11",
      "needs-decision",
      n => `${n} item(s) are marked unpublished`,
      "Unpublished items must not be routable, linked or in the sitemap. Check the code actually honours this flag.",
      "Filter every route, static-params list, sitemap and link block by the publish flag.",
    ],
    "title-length": [
      "META-01",
      "medium",
      n => `${n} title(s) outside 20–60 characters`,
      "Long titles get cut off in results; very short ones waste the spot.",
      "Keep titles about 30–60 characters, main keyword first.",
    ],
    "title-dup": [
      "META-01",
      "high",
      n => `${n} title(s) shared by more than one item`,
      "Duplicate titles make pages compete with each other.",
      "Make each title specific to its item.",
    ],
    "desc-length": [
      "META-02",
      "low",
      n => `${n} description(s) outside 120–160 characters`,
      "Short descriptions undersell the page; long ones get cut off.",
      "Aim for 120–160 characters.",
    ],
    "desc-dup": [
      "META-02",
      "medium",
      n => `${n} description(s) shared by more than one item`,
      "Duplicate descriptions signal templated pages.",
      "Write a specific description per item.",
    ],
    "placeholder": [
      "CONTENT-09",
      "high",
      n => `${n} item(s) contain placeholder or broken text`,
      "Placeholders and mangled characters look unfinished.",
      "Replace them with real content; keep the patterns in a build check.",
    ],
    "invisible-unicode": [
      "CONTENT-09",
      "medium",
      n => `${n} item(s) contain invisible characters`,
      "Zero-width spaces, stray byte-order marks and soft hyphens usually come from copy-pasting. Direction controls can change the order text is read in (the “Trojan Source” trick, CVE-2021-42574), and Unicode tag characters are invisible copies of letters that can hide a whole message. All of them split words for search engines and break matching, while readers see nothing wrong.",
      "Strip them at the source, and normalise pasted text when content is saved.",
    ],
    "templated-desc": [
      "META-02",
      "medium",
      n => `${n} description(s) repeat their title, end in a stock call to action, or end like other descriptions`,
      "Descriptions built from one template (the title again, a closing “Learn more”, or the same last sentence on many items) all read alike in results and give searchers no reason to pick this page.",
      "Write each description from what the page offers, in about 120–160 characters; leave calls to action to the page itself.",
    ],
    "unsourced-stat": [
      "CONTENT-10",
      "needs-decision",
      n => `${n} item(s) make a claim with no source nearby`,
      "Figures and claims like “73% of drivers”, “grew 40%”, “3x faster”, “$3.2 billion”, “by 2030 … will” or “a Gartner study found” can't be checked by readers or quality reviewers without a source next to them, and become a liability if they're wrong.",
      "Put the source next to each claim (a link, a [1] or [^1] footnote, “Source:” or “Via:”), or remove the claim until the owner can back it.",
    ],
    "stale-data": [
      "CONTENT-07",
      "low",
      n => `${n} item(s) haven't been updated in over ${MAX_AGE} months`,
      `Pages built from old data (prices, opening hours, figures, rules) go out of date without anyone noticing. CONTENT-07 asks for a review every 6 to 12 months; ${MAX_AGE === 12 ? "the 12-month line is our own" : `--max-age set it to ${MAX_AGE} months`}.`,
      "Review the items and update their data, or confirm it's still right and record the review date. Never move the date without a real review (CONTENT-12).",
    ],
    "banned": [
      "CONTENT-10",
      "high",
      n => `${n} item(s) contain banned text`,
      "Banned claims are a legal and trust risk. Matches are leads: an honest denial is fine.",
      "Remove or reword the claim at its source.",
    ],
    "unconfirmed": [
      "CONTENT-10",
      "needs-decision",
      n => `${n} item(s) contain claims the owner hasn't confirmed`,
      "Unconfirmed claims become false advertising if they turn out wrong.",
      "Get each claim confirmed, or hold it.",
    ],
  };
  const store = createFindings(CHECKS),
    { add, setCount } = store;

  const live = typeof args.publish === "string" ? records.filter(r => isLive(get(r, args.publish))) : records;
  const stats = {
    records: records.length,
    published: typeof args.publish === "string" ? live.length : null,
    textFields,
  };
  if (typeof args.publish === "string")
    records.forEach((r, i) => {
      if (!isLive(get(r, args.publish)))
        add("unpublished", urlOf(r, i), `${args.publish} = ${JSON.stringify(get(r, args.publish) ?? null)}`);
    });

  // Near-duplicates by 5-word shingles and the Dice coefficient, within each group. Pairwise, so capped at 1,500 items.
  const items = records
    .map((r, i) => ({
      r,
      i,
      url: urlOf(r, i),
      group: typeof args.group === "string" ? String(get(r, args.group) ?? "") : "",
      text: cleanText(r),
    }))
    .filter(x => x.text.split(" ").length >= 20);
  const distinct = new Set(items.map(x => x.text));
  stats.compared = items.length;
  stats.distinctTexts = distinct.size;
  if (items.length >= 10 && distinct.size <= items.length * 0.25) {
    add(
      "few-distinct-texts",
      source,
      `${items.length} items → ${distinct.size} distinct text(s) in ${textFields.join(", ")}`,
    );
    setCount("few-distinct-texts", distinct.size);
  }
  const sh = items.map(x => shingles(x.text));
  let pairs = 0;
  for (let a = 0; a < items.length && a < 1500; a++)
    for (let b = a + 1; b < items.length && b < 1500; b++) {
      if (items[a].group !== items[b].group) continue;
      const A = sh[a],
        B = sh[b];
      if (!A.size || !B.size) continue;
      const [s1, s2] = A.size < B.size ? [A, B] : [B, A];
      if (s1.size / s2.size < 0.3) continue;
      let inter = 0;
      for (const x of s1) if (s2.has(x)) inter++;
      const d = (2 * inter) / (A.size + B.size);
      if (d > THRESH) {
        pairs++;
        add("templated-text", items[a].url, `${Math.round(d * 100)}% shared with ${items[b].url}`);
      }
    }
  setCount("templated-text", pairs);

  if (typeof args.faq === "string") {
    const qmap = new Map();
    records.forEach((r, i) => {
      for (const f of [].concat(get(r, args.faq) || [])) {
        const q = typeof f === "string" ? f : f && (f.q || f.question || f.name);
        if (!q) continue;
        let k = norm(q);
        if (STRIP) k = k.replace(new RegExp(STRIP.source, "gi"), " ").replace(/\s+/g, " ").trim();
        (qmap.get(k) || qmap.set(k, { q, urls: [] }).get(k)).urls.push(urlOf(r, i));
      }
    });
    let reused = 0;
    for (const { q, urls } of qmap.values())
      if (urls.length > 1) {
        reused++;
        add("faq-reused", urls[0], `“${q.slice(0, 70)}” on ${urls.length} items`);
      }
    setCount("faq-reused", reused);
  }
  const req = list(args.required);
  if (req.length)
    records.forEach((r, i) => {
      const miss = req.filter(f => !str(get(r, f)).trim());
      if (miss.length) add("missing-field", urlOf(r, i), `missing: ${miss.join(", ")}`);
    });
  // A title's length is its width: Chinese, Japanese and Korean characters count as two.
  for (const [field, lenKey, dupKey, lo, hi, len, lenText] of [
    [args.title, "title-length", "title-dup", 20, 60, titleWidth, widthText],
    [args.desc, "desc-length", "desc-dup", 120, 160, v => v.length, v => `${v.length} chars`],
  ]) {
    if (typeof field !== "string") continue;
    const m = new Map();
    live.forEach(r => {
      const i = records.indexOf(r);
      const v = str(get(r, field)).trim();
      if (!v) return;
      if (len(v) < lo || len(v) > hi) add(lenKey, urlOf(r, i), `${lenText(v)}: ${v.slice(0, 80)}`);
      (m.get(v) || m.set(v, []).get(v)).push(urlOf(r, i));
    });
    for (const [v, us] of m) if (us.length > 1) for (const u of us) add(dupKey, u, v.slice(0, 80));
  }
  // A shared ending counts only on 3+ items. The share is split by --group or the URL's first folder.
  if (typeof args.desc === "string") {
    const descs = live
      .map(r => {
        const i = records.indexOf(r),
          url = urlOf(r, i);
        return {
          url,
          section: typeof args.group === "string" ? String(get(r, args.group) ?? "") : sectionOf(url),
          desc: str(get(r, args.desc)).trim(),
          title: typeof args.title === "string" ? str(get(r, args.title)).trim() : "",
        };
      })
      .filter(x => x.desc);
    const hits = templatedDescs(descs, { titleRepeat: true });
    for (const [u, why] of hits) add("templated-desc", u, why);
    if (hits.length)
      stats.templatedDescriptions = templatedShare(
        descs,
        hits.map(h => h[0]),
      );
  }
  // Without --date, the first of these fields that half the items fill.
  const DATE_KEYS = [
    "dateModified",
    "updatedAt",
    "updated_at",
    "updated",
    "lastUpdated",
    "last_updated",
    "lastModified",
    "modified",
    "lastReviewed",
    "last_reviewed",
    "reviewed",
  ];
  const dateField =
    typeof args.date === "string"
      ? args.date
      : DATE_KEYS.find(k => records.filter(r => str(get(r, k)).trim()).length >= records.length / 2);
  if (dateField)
    live.forEach(r => {
      const v = str(get(r, dateField)).trim(),
        t = Date.parse(v);
      if (t && Date.now() - t > MAX_AGE * 30.44 * 864e5)
        add("stale-data", urlOf(r, records.indexOf(r)), `${dateField}: ${v}`);
    });
  const fieldNames = [...new Set(records.flatMap(r => Object.keys(r)))].filter(k => !k.startsWith("_")).slice(0, 100);
  stats.fields = Object.fromEntries(
    fieldNames.map(k => {
      const filled = records.filter(r => str(r[k]).trim()).length;
      return [k, { filled, missing: records.length - filled }];
    }),
  );
  const missingNote = fieldNames
    .filter(k => stats.fields[k].missing)
    .map(k => `${k} ${stats.fields[k].missing} of ${records.length}`);
  const claims = [];
  records.forEach((r, i) => {
    const all = str(r);
    const inv = invisibleChar(all);
    if (inv) {
      const at = inv.index;
      add(
        "invisible-unicode",
        urlOf(r, i),
        `${inv.code} (${inv.name}) in “${all.slice(Math.max(0, at - 20), at)}⟨here⟩${all.slice(at + inv.char.length, at + 20)}”`,
      );
    }
    // A schema.org `citation` field sources every claim in the item.
    const cited = !!str(get(r, "citation")).trim();
    const own = Object.entries(r)
      .filter(([k]) => !k.startsWith("_") && k !== "citation")
      .flatMap(([, v]) => claimsIn(str(v)))
      .map(c => ({ url: urlOf(r, i), ...c, sourced: c.sourced || cited }));
    claims.push(...own);
    const bare = own.filter(c => !c.sourced);
    if (bare.length)
      add(
        "unsourced-stat",
        urlOf(r, i),
        `${bare.length} of ${own.length} claims have no source nearby (${Math.round((100 * bare.length) / own.length)}%): ${bare
          .slice(0, 5)
          .map(c => `“${c.claim}” (${c.kind})`)
          .join("; ")}${bare.length > 5 ? `; and ${bare.length - 5} more` : ""}`,
      );
    const ph = all.match(PH);
    if (ph) add("placeholder", urlOf(r, i), `“${ph[0]}”`);
    if (BANNED) {
      const c = ctx(all, BANNED);
      if (c) add("banned", urlOf(r, i), c);
    }
    if (VERIFY) {
      const c = ctx(all, VERIFY);
      if (c) add("unconfirmed", urlOf(r, i), c);
    }
  });

  const findings = store.list({ source: "content-scan", prefix: "D", category: "Content data" });
  stats.claims = { total: claims.length, unsourced: claims.filter(c => !c.sourced).length };
  const notes = [
    `Scanned ${records.length} records from ${source}; compared ${items.length} texts (${distinct.size} distinct after removing names).`,
  ];
  if (missingNote.length) notes.push(`Missing values: ${missingNote.join(", ")}.`);
  if (claims.length > 1000) notes.push(`claims lists the first 1,000 of ${claims.length} claims.`);
  const report = {
    tool: "seo-supervisor-content-scan",
    scannedAt: new Date().toISOString(),
    source,
    options: {
      text: textFields,
      group: args.group || null,
      strip: args.strip || null,
      threshold: THRESH,
      date: dateField || null,
      maxAge: MAX_AGE,
    },
    stats,
    findings,
    claims: claims.slice(0, 1000),
    passed: [],
    notChecked: [],
    notes,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(
    `content-scan: ${records.length} records, ${findings.length} findings ${JSON.stringify(findings.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {}))} → ${OUT}`,
  );
  // --fail-on lets CI stop a publish. For unsourced-stat, a single unsourced claim is enough.
  const failed = findings.filter(f => FAIL_ON.includes(f.check));
  if (failed.length) {
    console.error(`content-scan: failing on ${failed.map(f => `${f.check} (${f.count})`).join(", ")}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) await runMain(() => main(process.argv.slice(2)));
