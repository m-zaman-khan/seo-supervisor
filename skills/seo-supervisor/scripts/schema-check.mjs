#!/usr/bin/env node
// @ts-check
// Checks JSON-LD structured data offline, against the schema.org vocabulary and Google's rich-result requirements.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain, warnProxy } from "./lib/cli.mjs";
import { bodyUpTo } from "./lib/http.mjs";
import { loopback } from "./lib/net.mjs";
import { ancestors, isA, isLocalBusinessType } from "./lib/business.mjs";
import {
  EVENT_DOC,
  MERCHANT_DOC,
  REVIEW_DOC,
  SUPERSEDED,
  merchantProblems,
  onlineOnly,
  otherReviewed,
  placeholderIn,
  sellsWithOffer,
} from "./checks/schema.mjs";
// The shared checks live in checks/schema.mjs and are re-exported here for callers of this module.
export {
  ISO_4217,
  SUPERSEDED,
  merchantProblems,
  onlineOnly,
  otherReviewed,
  placeholderIn,
  reviewEventProblems,
  sellsWithOffer,
} from "./checks/schema.mjs";

const VOCAB = JSON.parse(readFileSync(new URL("./data/schema-vocab.json", import.meta.url), "utf8"));
// Null-prototype maps, so "toString" or "__proto__" in a page is just an unknown name.
const bare = o => Object.assign(Object.create(null), o);
const TYPES = bare(VOCAB.types),
  PROPS = bare(VOCAB.props);

// The file's `about` explains each rule field. A missing required property is an error, a missing recommended one a
// warning; a nested list means "one of these".
// https://developers.google.com/search/docs/appearance/structured-data/search-gallery
const GOOGLE = JSON.parse(readFileSync(new URL("./data/google-rich-results.json", import.meta.url), "utf8"));

const RULES = [
  ...GOOGLE.supported,
  // Merchant listings need an image, checked on top-level Products only: one nested as isSimilarTo or itemOffered isn't
  // a listing, and Google's variants doc doesn't say whether a variant may take the group's image. Brand, GTIN, colour
  // and the like apply only to some products, so the crawler's report counts them instead.
  {
    type: "Product",
    except: "ProductGroup",
    top: true,
    feature: "Google merchant listings",
    doc: MERCHANT_DOC,
    required: ["image"],
    test: sellsWithOffer,
  },
  // Google ended FAQ rich results on 7 May 2026; Bing and AI engines still read FAQPage, so only its structure is
  // checked.
  {
    type: "FAQPage",
    feature: "a well-formed FAQPage (Google shows no FAQ rich results since May 2026)",
    doc: "https://schema.org/FAQPage",
    required: ["mainEntity"],
  },
  {
    type: "Question",
    under: "FAQPage",
    feature: "a well-formed FAQPage (Google shows no FAQ rich results since May 2026)",
    doc: "https://schema.org/FAQPage",
    required: ["name", "acceptedAnswer"],
  },
  {
    type: "Answer",
    under: "Question",
    feature: "a well-formed FAQPage or Q&A",
    doc: "https://schema.org/Answer",
    required: ["text"],
  },
];
const RETIRED = GOOGLE.retired.filter(r => !r.keep),
  KEPT = GOOGLE.retired.filter(r => r.keep && r.note);
const docOf = type => GOOGLE.supported.find(r => r.type === type).doc;

const monthOf = d =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const byDomain = Object.create(null);
for (const [p, [domains]] of Object.entries(PROPS)) for (const d of domains) (byDomain[d] ||= []).push(p);
const allowedCache = new Map();
const allowed = t =>
  allowedCache.get(t) || allowedCache.set(t, new Set([...ancestors(t)].flatMap(a => byDomain[a] || []))).get(t);
const lowerMap = o => bare(Object.fromEntries(Object.keys(o).map(k => [k.toLowerCase(), k])));
const TYPE_LC = lowerMap(TYPES),
  PROP_LC = lowerMap(PROPS);
const hint = (lc, t) =>
  lc[t.toLowerCase()] && lc[t.toLowerCase()] !== t ? `; did you mean "${lc[t.toLowerCase()]}"?` : "";
const term = s => s.replace(/^(?:https?:\/\/schema\.org\/|schema:)/, "");
const has = (o, k) => o[k] != null && o[k] !== "" && !(Array.isArray(o[k]) && !o[k].length);
const list = x => [].concat(x ?? []);
const clip = s => (s.length > 60 ? s.slice(0, 57) + "…" : s);
const ISO_DATE =
  /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)?)?$/;
const NUMERIC = new Set(["Number", "Integer", "Float"]);

/** Checks one JSON-LD block. Returns issues; `pos` is the character offset in `text` they point at. */
export function checkJsonLd(text) {
  // Hugo, Jekyll, Liquid, Eleventy, Django/Jinja ({{ }}, {% %}, {# #}) and ERB/EJS (<% %>): the JSON-LD only exists
  // once built.
  if (/\{\{|\{%|\{#|<%/.test(text))
    return [
      {
        severity: "note",
        check: "templated",
        rule: "SCHEMA-08",
        path: "$",
        type: "",
        message: "templated; check the built output",
        pos: text.length - text.trimStart().length,
      },
    ];
  let data;
  // Each object's numbers as the page wrote them, so a latitude of 53.79640 keeps its five decimal places.
  const written = new WeakMap();
  function keepSource(k, v, c) {
    if (typeof v === "number" && c?.source) (written.get(this) || written.set(this, {}).get(this))[k] = c.source;
    return v;
  }
  try {
    data = JSON.parse(text.replace(/^﻿/, ""), keepSource);
  } catch (e) {
    const pos = Number(/at position (\d+)/.exec(e.message)?.[1] ?? text.length);
    return [
      {
        severity: "error",
        check: "json-invalid",
        rule: "SCHEMA-01",
        path: "$",
        type: "",
        message: `the JSON doesn't parse: ${e.message.replace(/ in JSON at position.*$/s, "")}`,
        pos,
      },
    ];
  }
  const issues = [];
  // Points at the key's first occurrence in the block, not a full JSON position map: enough to find the line.
  const add = (severity, check, path, types, message, extra = {}) => {
    const { key, ...rest } = extra;
    issues.push({
      severity,
      check,
      rule: "SCHEMA-08",
      path,
      type: types.join(", "),
      message,
      ...rest,
      pos: key ? Math.max(0, text.indexOf(JSON.stringify(key))) : 0,
    });
  };

  function shape(key, k, x, path, types) {
    const [, range] = PROPS[k],
      s = typeof x === "string" ? x.trim() : null;
    if (s != null && range.includes("URL") && !range.includes("Text")) {
      if (/^\.{0,2}\//.test(s))
        add(
          "warning",
          "value-url",
          path,
          types,
          `"${key}" is a relative URL ("${clip(s)}"); use the full https:// URL`,
          { key },
        );
      else if (!/^[a-z][a-z\d+.-]*:\S+$/i.test(s))
        add("error", "value-url", path, types, `"${key}" should be a URL, not "${clip(s)}"`, { key });
    }
    if (
      range.length &&
      range.every(r => r === "Date" || r === "DateTime") &&
      (s != null || typeof x === "number") &&
      !ISO_DATE.test(String(s ?? x))
    )
      add(
        "error",
        "value-date",
        path,
        types,
        `"${key}" should be an ISO 8601 date such as 2026-11-19 or 2026-11-19T09:30:00+01:00, not "${clip(String(x))}"`,
        { key },
      );
    if (range.length && range.every(r => NUMERIC.has(r)) && s != null && !/^-?\d+(\.\d+)?$/.test(s))
      add("error", "value-number", path, types, `"${key}" should be a number, not "${clip(s)}"`, { key });
    if (/^(price|lowPrice|highPrice)$/.test(k) && s != null && !/^\d+(\.\d+)?$/.test(s))
      add(
        "warning",
        "value-price",
        path,
        types,
        `"${key}" is "${clip(s)}"; Google wants digits with a dot for decimals, no currency symbol or thousands separator`,
        { key },
      );
  }

  // A rule applies to its type and subtypes, minus `except`, nested `under` one of its types (through `as`), and only
  // when the item has one of the `when` properties ("*": any value, else that value in any case, so false matches
  // "False" and "https://schema.org/ReturnShippingFees" matches "ReturnShippingFees").
  const applies = (r, v, known, parent, via) =>
    known.some(t => isA(t, r.type) && !list(r.except).some(e => isA(t, e))) &&
    (!r.under || !!parent?.some(p => list(r.under).some(u => isA(p, u)))) &&
    !(r.top && parent) &&
    !(r.as && via !== r.as) &&
    (!r.when ||
      Object.entries(r.when).some(([k, want]) =>
        want === "*"
          ? has(v, k)
          : list(v[k]).some(x => term(String(x).trim()).toLowerCase() === String(want).toLowerCase()),
      )) &&
    (!r.test || r.test(v));

  function google(v, path, known, parent, last, via) {
    const seen = new Set(),
      rules = RULES.filter(r => applies(r, v, known, parent, via));
    const label = x =>
      list(x)
        .map(k => `"${k}"`)
        .join(" or ");
    // Every rule's required properties first, so one rule's recommended "name" never hides another's required one.
    for (const verb of ["required", "recommended"])
      for (const r of rules) {
        const present = k =>
          has(v, k) || (r.alsoOn?.[k] && list(v[r.alsoOn[k]]).some(o => o && typeof o === "object" && has(o, k)));
        const props =
          verb === "required"
            ? [...r.required, ...(parent && via !== r.via ? [] : r.standalone || [])].filter(
                x => !(last && x === r.lastMayOmit),
              )
            : r.recommended || [];
        for (const x of props) {
          if (list(x).some(present) || seen.has(label(x))) continue;
          seen.add(label(x));
          // An item with r.elsewhere (a forum post's url) may stand for one shown in full on another page.
          if (verb === "required" && Array.isArray(x) && r.elsewhere && has(v, r.elsewhere))
            add(
              "note",
              "required-elsewhere",
              path,
              known,
              `no ${label(x)}: fine if this item stands for one shown on another page, at its "${r.elsewhere}" (a category page, a thread's later pages); on its own page, ${r.feature} require one`,
              { doc: r.doc },
            );
          else
            add(
              verb === "required" ? "error" : "warning",
              `${verb}-missing`,
              path,
              known,
              `missing ${label(x)}, ${verb} for ${r.feature}`,
              { doc: r.doc },
            );
        }
        // A rating can't be filled in like a missing name: it has to come from real reviews shown on the page.
        if (
          verb === "recommended" &&
          r.needsRating &&
          !r.needsRating.some(present) &&
          !seen.has(label(r.needsRating))
        ) {
          seen.add(label(r.needsRating));
          add(
            "note",
            "rating-missing",
            path,
            known,
            `no ${label(r.needsRating)}: ${r.feature} show only with one. Add it only from real reviews shown on this page (SCHEMA-04); never make one up`,
            { doc: r.doc },
          );
        }
      }
    // Exact types only: a Recipe is a HowTo in schema.org, and still earns recipe results.
    for (const r of RETIRED)
      if (known.includes(r.type) && !(r.top && parent))
        add(
          "warning",
          "type-retired",
          path,
          known,
          `Google retired ${r.feature} in ${monthOf(r.since)}, so "${r.type}" no longer earns a Google rich result. It does no harm: remove it, or keep it knowingly`,
          { doc: r.source, rule: "SCHEMA-05", key: r.type },
        );
    // A retired type still worth keeping gets a note, not a warning.
    for (const r of KEPT)
      if (known.includes(r.type) && !(r.top && parent))
        add(
          "note",
          "type-kept",
          path,
          known,
          `Google retired ${r.feature} in ${monthOf(r.since)}, but keep "${r.type}": ${r.note}`,
          { doc: r.source, rule: "SCHEMA-05", key: r.type },
        );
    for (const t of known)
      if (SUPERSEDED[t])
        add(
          "warning",
          "type-superseded",
          path,
          known,
          `schema.org has deprecated "${t}" and says to use "${SUPERSEDED[t]}" instead`,
          { doc: `https://schema.org/${t}`, rule: "SCHEMA-05", key: t },
        );
  }

  // A business's map pin and price range, as Google's local business and vacation rental docs set them.
  function business(v, path, known) {
    if (!known.some(isLocalBusinessType)) return;
    const doc = docOf(known.some(t => isA(t, "VacationRental")) ? "VacationRental" : "LocalBusiness");
    // Both docs want latitude and longitude to at least 5 decimal places.
    for (const o of [v, ...list(v.geo)])
      for (const k of ["latitude", "longitude"]) {
        if (!o || typeof o !== "object" || o[k] == null) continue;
        const s = String(written.get(o)?.[k] ?? o[k]).trim(),
          m = /^[+-]?\d+(?:\.(\d*))?$/.exec(s),
          n = m?.[1]?.length ?? 0;
        if (m && n < 5)
          add(
            "warning",
            "value-geo",
            path,
            known,
            `"${k}" is ${s} (${n} decimal place${n === 1 ? "" : "s"}); Google wants at least 5, so the map pin lands on the right building`,
            { doc, key: k },
          );
      }
    const range = typeof v.priceRange === "string" ? v.priceRange.trim().length : 0;
    if (range >= 100)
      add(
        "warning",
        "value-price-range",
        path,
        known,
        `"priceRange" is ${range} characters; Google shows no price range at 100 characters or more ("$10-15" or "$$$" is the form it wants)`,
        { doc: docOf("LocalBusiness"), key: "priceRange" },
      );
  }

  // EU energy labels need the EPREL code; a shop serving Norway, Switzerland or the UK without codes may give
  // certificationRating instead. Google still reads hasEnergyConsumptionDetails but recommends hasCertification.
  function merchant(v, path, known) {
    if (known.some(t => isA(t, "Product"))) {
      for (const x of merchantProblems(v))
        add(x.severity, `value-${x.check}`, path, known, x.message, { doc: MERCHANT_DOC, key: x.key });
      if (has(v, "hasEnergyConsumptionDetails"))
        add(
          "note",
          "energy-details",
          path,
          known,
          `Google still reads "hasEnergyConsumptionDetails", but now recommends an energy label in "hasCertification" instead`,
          { doc: MERCHANT_DOC, key: "hasEnergyConsumptionDetails" },
        );
    }
    if (
      known.some(t => isA(t, "Certification")) &&
      list(v.name).some(n => String(n).trim().toUpperCase() === "EPREL") &&
      !has(v, "certificationIdentification")
    )
      add(
        "note",
        "eprel-code",
        path,
        known,
        `an EU energy label ("EPREL") needs "certificationIdentification", the product's code in the EPREL database; only a shop serving Norway, Switzerland or the UK without one may give "certificationRating" instead`,
        { doc: MERCHANT_DOC, key: "name" },
      );
  }

  function walk(v, path, parent, last, via) {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`, parent, i === v.length - 1, via));
    if (!v || typeof v !== "object") return;
    const types = []
      .concat(v["@type"] ?? [])
      .filter(t => typeof t === "string")
      .map(term)
      .filter(t => !t.includes(":"));
    const known = types.filter(t => TYPES[t]);
    for (const t of types)
      if (!TYPES[t])
        add("error", "type-unknown", path, types, `"${t}" isn't a schema.org type${hint(TYPE_LC, t)}`, { key: t });
    // An empty @type anywhere; no @type on a top-level or @graph item that has properties (via is unset only there),
    // unless its @id names an item typed elsewhere in the block, which it adds to. Nested values may go untyped.
    if (Object.hasOwn(v, "@type") && !list(v["@type"]).some(t => typeof t === "string" && t.trim()))
      add("error", "type-empty", path, [], `"@type" is empty; name the type, such as "Organization" or "Article"`, {
        key: "@type",
      });
    else if (
      via === undefined &&
      !Object.hasOwn(v, "@type") &&
      Object.keys(v).some(k => !k.startsWith("@")) &&
      !typedIds.has(v["@id"])
    )
      add(
        "error",
        "type-missing",
        path,
        [],
        `this item has no "@type", so search engines can't tell what it describes; add one, such as "Organization" or "Article"`,
      );
    for (const [key, val] of Object.entries(v)) {
      if (key === "@graph") {
        walk(val, `${path}.@graph`, null, true);
        continue;
      }
      for (const x of list(val)) {
        const ph = typeof x === "string" && placeholderIn(x);
        if (ph)
          add(
            "error",
            "placeholder",
            path,
            known,
            `"${key}" holds the placeholder "${ph}"; fill in the real value from the site's data`,
            { rule: "SCHEMA-01", key },
          );
      }
      const k = term(key);
      if (key.startsWith("@") || k.includes(":")) continue; // JSON-LD keywords and other vocabularies
      if (/-(input|output)$/.test(k) && PROPS[k.replace(/-(input|output)$/, "")]) continue; // Action annotations: "query-input"
      if (known.length) {
        if (!PROPS[k])
          add("error", "prop-unknown", path, known, `"${key}" isn't a schema.org property${hint(PROP_LC, k)}`, { key });
        else if (!known.some(t => allowed(t).has(k))) {
          const where = PROPS[k][0];
          add(
            "error",
            "prop-unknown",
            path,
            known,
            `"${key}" isn't a property of ${known.join(" or ")}; schema.org defines it for ${where.slice(0, 4).join(", ")}${where.length > 4 ? " and others" : ""}`,
            { key },
          );
        } else for (const x of [].concat(val)) shape(key, k, x, path, known);
      }
      if (known.length && (k === "review" || k === "aggregateRating"))
        for (const c of list(val)) {
          const other = otherReviewed(v, c);
          if (other)
            add(
              "warning",
              "review-target-conflict",
              `${path}.${key}`,
              known,
              `this nested ${k === "review" ? "review" : "rating"} names "${clip(other)}" in "itemReviewed", but Google takes the item it sits in as the one reviewed; leave "itemReviewed" out, or move the review out on its own`,
              { doc: REVIEW_DOC, rule: "SCHEMA-01", key: "itemReviewed" },
            );
        }
      walk(val, `${path}.${key}`, known.length ? known : parent, true, k);
    }
    if (known.length) {
      google(v, path, known, parent, last, via);
      business(v, path, known);
      merchant(v, path, known);
    }
    if (known.some(t => isA(t, "Event")) && onlineOnly(v))
      add(
        "warning",
        "event-online",
        path,
        known,
        `this event is online only; since 5 Jun 2025 Google's event results need a physical location, so it can't show there. It does no harm: keep it for other engines, or remove it`,
        { doc: EVENT_DOC, rule: "SCHEMA-05", key: "eventAttendanceMode" },
      );
  }

  const typedIds = new Set(),
    scan = x => {
      if (x && typeof x === "object") {
        if (has(x, "@type") && typeof x["@id"] === "string") typedIds.add(x["@id"]);
        Object.values(x).forEach(scan);
      }
    };
  scan(data);

  for (const [root, path] of Array.isArray(data) ? data.map((d, i) => [d, `$[${i}]`]) : [[data, "$"]]) {
    if (!root || typeof root !== "object") continue;
    if (root["@context"] === undefined)
      add("error", "context-missing", path, [], `no "@context"; add "@context": "https://schema.org"`);
    else if (!JSON.stringify(root["@context"]).includes("schema.org")) continue; // another vocabulary, so not checked here
    walk(root, path, null, true);
  }
  return issues;
}

const CHECKABLE = /\.(html?|jsonld|json)$/i;
const lineAt = (text, i) => text.slice(0, i).split("\n").length;
const blocksOf = html =>
  [...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/gi)]
    .filter(m => /\btype\s*=\s*["']?application\/ld\+json/i.test(m[1]))
    .map(m => ({ body: m[2], start: m.index + m[1].length }));

/** Checks one file's text: JSON-LD (json = true) or HTML. Returns null when a .json file isn't JSON-LD. */
function checkText(name, text, json) {
  if (json && !/\.jsonld$/i.test(name) && !/"@(context|type|graph)"/.test(text)) return null; // package.json, manifest.json…
  const blocks = json ? [{ body: text, start: 0 }] : blocksOf(text);
  const issues = blocks.flatMap((b, n) =>
    checkJsonLd(b.body).map(({ pos, ...i }) => {
      const at = b.start + pos,
        line = lineAt(text, at);
      return {
        file: name,
        line,
        block: n + 1,
        ...i,
        ...(i.check === "json-invalid" && {
          message: `${i.message} (line ${line}, column ${at - text.lastIndexOf("\n", at - 1)})`,
        }),
      };
    }),
  );
  return { items: blocks.length, issues };
}

function* walkDir(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkDir(p);
    else if (CHECKABLE.test(e.name)) yield p;
  }
}

// Redirects are followed by hand so every hop gets the same loopback test as the URL itself. 50 MB is a local cap.
const MAX_HOPS = 5,
  MAX_BYTES = 50 * 1024 * 1024;
async function fetchPage(input, allowRemote) {
  let u = new URL(input);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(30000) });
    const to = res.status >= 300 && res.status < 400 && res.headers.get("location");
    if (!to) {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await bodyUpTo(res, MAX_BYTES);
      if (!body) throw new Error("it's over 50 MB");
      return {
        u,
        text: body.toString("utf8"),
        json: /json/i.test(res.headers.get("content-type") || "") || /\.json(ld)?$/i.test(u.pathname),
      };
    }
    const next = new URL(to, u);
    if (!/^https?:$/.test(next.protocol) || (!allowRemote && !loopback(next.hostname)))
      throw new Error(`it redirects to ${next.href}, which isn't on this machine (pass --allow-remote to follow it)`);
    u = next;
  }
  throw new Error(`it redirects more than ${MAX_HOPS} times`);
}

async function checkInputs(inputs, { allowRemote = false } = {}) {
  const out = { files: 0, items: 0, issues: [] };
  const take = r => {
    if (r) {
      out.files++;
      out.items += r.items;
      out.issues.push(...r.issues);
    }
  };
  const show = f => {
    const r = relative(process.cwd(), f);
    return r && !r.startsWith("..") && !isAbsolute(r) ? r : f;
  };
  for (const input of inputs) {
    if (/^https?:\/\//i.test(input)) {
      let u;
      try {
        u = new URL(input);
      } catch {
        throw new Fail(`schema-check: ${input} isn't a web address.`);
      }
      if (!allowRemote && !loopback(u.hostname))
        throw new Fail(
          `schema-check: ${input} isn't on this machine. This is a local tool; pass --allow-remote to fetch other hosts.`,
        );
      try {
        const page = await fetchPage(input, allowRemote);
        take(checkText(input, page.text, page.json));
      } catch (e) {
        out.issues.push({
          file: input,
          line: 0,
          block: 0,
          severity: "error",
          check: "fetch-failed",
          rule: "SCHEMA-08",
          path: "",
          type: "",
          message: `couldn't fetch it: ${e.cause?.code || e.message}`,
        });
      }
      continue;
    }
    if (!existsSync(input)) throw new Fail(`schema-check: ${input} doesn't exist`);
    const files = statSync(input).isDirectory() ? [...walkDir(input)] : [input];
    for (const f of files) take(checkText(show(f), readFileSync(f, "utf8"), /\.json(ld)?$/i.test(f)));
  }
  return out;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const format = i =>
  `  ${i.file}:${i.line}  ${i.severity}  ${i.path}${i.type ? ` (${i.type})` : ""}: ${i.message}${i.doc ? ` · ${i.doc}` : ""}`;

// Paths come from the tool-input fields only, never from the text written: Cursor's file_path, Claude Code's
// tool_input, Copilot's toolArgs (maybe a JSON string), and the file headers of a Codex apply_patch.
function pathsIn(payload) {
  const obj = v => {
    if (typeof v === "string")
      try {
        v = JSON.parse(v);
      } catch {}
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  };
  const input = obj(payload?.tool_input),
    out = new Set();
  if (typeof payload?.file_path === "string") out.add(payload.file_path);
  for (const src of [input, obj(payload?.toolArgs)])
    for (const k of ["file_path", "filePath", "path"]) if (typeof src[k] === "string") out.add(src[k]);
  for (const c of [].concat(input.command ?? []))
    if (typeof c === "string")
      for (const m of c.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm)) out.add(m[1].trim());
  return out;
}

async function hook(mode) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  } // not a hook payload: stay silent
  const base = typeof payload?.cwd === "string" ? payload.cwd : process.cwd();
  const files = [...pathsIn(payload)]
    .map(p => resolve(base, p))
    .filter(p => CHECKABLE.test(p) && existsSync(p) && statSync(p).isFile());
  if (!files.length) return;
  const errors = (await checkInputs(files)).issues.filter(i => i.severity === "error");
  if (!errors.length) return;
  const text = `schema-check found ${plural(errors.length, "structured data error")}. Fix them in the source that renders this JSON-LD:\n${errors.map(format).join("\n")}`;
  // Copilot and Cursor take the text as JSON context; other hosts show a hook's stderr on exit 2.
  if (mode === "copilot") console.log(JSON.stringify({ additionalContext: text }));
  else {
    console.error(text);
    return 2;
  }
}

// Every word that isn't an option is a file, folder or URL to check; after --hook, copilot or cursor is its mode.
async function main(argv) {
  const USAGE =
    "usage: node schema-check.mjs <file|folder|url ...> [--json out.json] [--quiet] [--allow-remote]\n       node schema-check.mjs --hook [copilot]   (reads an agent hook payload on stdin)";
  const args = parseArgs(argv, { flags: ["json"], booleans: ["hook", "quiet", "allow-remote"] }),
    inputs = args._;
  if (args.hook) return hook(inputs[0] === "copilot" ? "copilot" : true);
  if (!inputs.length || args.json === true) throw new Fail(USAGE);
  const opts = { json: args.json, quiet: !!args.quiet, allowRemote: !!args["allow-remote"] };
  if (inputs.some(a => /^https?:\/\//i.test(a))) warnProxy(); // only URLs are fetched
  const r = await checkInputs(inputs, opts);
  const count = s => r.issues.filter(i => i.severity === s).length,
    errors = count("error"),
    warnings = count("warning"),
    notes = count("note");
  if (opts.json) {
    mkdirSync(dirname(resolve(opts.json)), { recursive: true });
    writeFileSync(
      opts.json,
      JSON.stringify(
        {
          tool: "schema-check",
          vocabulary: `schema.org ${VOCAB.version}`,
          googleRulesChecked: GOOGLE.checked,
          files: r.files,
          items: r.items,
          errors,
          warnings,
          notes,
          issues: r.issues,
        },
        null,
        2,
      ),
    );
  }
  if (!opts.quiet || errors) {
    console.log(
      `schema-check: ${plural(r.files, "file")}, ${plural(r.items, "item")}, ${plural(errors, "error")}, ${plural(warnings, "warning")}${notes ? `, ${plural(notes, "note")}` : ""} · schema.org ${VOCAB.version} · Google's rules as of ${GOOGLE.checked}`,
    );
    for (const i of r.issues) if (!opts.quiet || i.severity === "error") console.log(format(i));
  }
  return errors ? 1 : 0;
}

if (isMain(import.meta.url)) await runMain(() => main(process.argv.slice(2)));
