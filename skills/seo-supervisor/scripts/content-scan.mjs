#!/usr/bin/env node
// Audits content data (JSON, CSV or a Markdown folder) before it becomes pages.

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { parseCsv } from "./lib/csv.mjs";
import { join, dirname, resolve, extname, basename } from "node:path";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
if (!args.in && !args.csv && !args.md) {
  console.error(
    "Usage: node content-scan.mjs --in content.json | --csv file.csv | --md dir  [--id] [--url] [--title] [--desc] [--text] [--faq] [--publish] [--group] [--strip] [--required] [--banned] [--verify] [--threshold 0.5] [--out file]",
  );
  process.exit(2);
}
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
const STRIP = typeof args.strip === "string" ? new RegExp(`\\b(${args.strip})\\b`, "gi") : null;
const BANNED = typeof args.banned === "string" ? new RegExp(args.banned, "i") : null;
const VERIFY = typeof args.verify === "string" ? new RegExp(args.verify, "i") : null;
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
if (args.in) {
  source = args.in;
  let data = JSON.parse(readFileSync(args.in, "utf8"));
  if (typeof args.items === "string") data = get(data, args.items);
  if (Array.isArray(data)) records = data;
  else if (data && typeof data === "object") {
    const vals = Object.entries(data);
    records = vals.every(([, v]) => Array.isArray(v))
      ? vals.flatMap(([k, v]) => v.map(r => ({ _type: k, ...r })))
      : vals.map(([k, v]) => ({ _key: k, ...v }));
  }
} else if (args.csv) {
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
const found = new Map();
const add = (k, url, detail) => {
  let f = found.get(k);
  if (!f) found.set(k, (f = { count: 0, evidence: [] }));
  f.count++;
  if (f.evidence.length < 100) f.evidence.push(detail ? { url, detail } : { url });
};
const setCount = (k, n) => {
  const f = found.get(k);
  if (f) f.count = n;
};

const live = typeof args.publish === "string" ? records.filter(r => isLive(get(r, args.publish))) : records;
const stats = { records: records.length, published: typeof args.publish === "string" ? live.length : null, textFields };
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
for (const [field, lenKey, dupKey, lo, hi] of [
  [args.title, "title-length", "title-dup", 20, 60],
  [args.desc, "desc-length", "desc-dup", 120, 160],
]) {
  if (typeof field !== "string") continue;
  const m = new Map();
  live.forEach(r => {
    const i = records.indexOf(r);
    const v = str(get(r, field)).trim();
    if (!v) return;
    if (v.length < lo || v.length > hi) add(lenKey, urlOf(r, i), `${v.length} chars: ${v.slice(0, 80)}`);
    (m.get(v) || m.set(v, []).get(v)).push(urlOf(r, i));
  });
  for (const [v, us] of m) if (us.length > 1) for (const u of us) add(dupKey, u, v.slice(0, 80));
}

records.forEach((r, i) => {
  const all = str(r);
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

// ---------- output ----------
const SEV = { blocker: 0, high: 1, "needs-decision": 2, medium: 3, low: 4 };
const findings = [...found]
  .map(([k, f]) => {
    const [rule, severity, title, why, fix] = CHECKS[k];
    const ex = f.evidence[0] || {};
    return {
      check: k,
      rule,
      severity,
      category: "Content data",
      title: title(f.count),
      what: `${f.count === 1 ? "Found in" : "For example"} ${ex.url}${ex.detail ? ` (${ex.detail})` : ""}.`,
      why,
      fix,
      count: f.count,
      evidence: f.evidence,
      source: "content-scan",
      status: severity === "needs-decision" ? "needs-decision" : "open",
    };
  })
  .sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.count - a.count);
findings.forEach((f, i) => {
  f.id = "D-" + String(i + 1).padStart(3, "0");
});
const report = {
  tool: "seo-supervisor-content-scan",
  scannedAt: new Date().toISOString(),
  source,
  options: { text: textFields, group: args.group || null, strip: args.strip || null, threshold: THRESH },
  stats,
  findings,
  passed: [],
  notChecked: [],
  notes: [
    `Scanned ${records.length} records from ${source}; compared ${items.length} texts (${distinct.size} distinct after removing names).`,
  ],
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(
  `content-scan: ${records.length} records, ${findings.length} findings ${JSON.stringify(findings.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {}))} → ${OUT}`,
);
