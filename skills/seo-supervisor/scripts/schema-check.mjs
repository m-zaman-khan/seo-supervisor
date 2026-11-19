#!/usr/bin/env node
// Checks JSON-LD structured data offline, against the schema.org vocabulary and Google's rich-result requirements.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";

const VOCAB = JSON.parse(readFileSync(new URL("./data/schema-vocab.json", import.meta.url), "utf8"));
// Null-prototype maps, so "toString" or "__proto__" in a page is just an unknown name.
const bare = o => Object.assign(Object.create(null), o);
const TYPES = bare(VOCAB.types),
  PROPS = bare(VOCAB.props);

// Google's rich-result requirements; each rule's doc is its source. A rule covers its type and every subtype. A
// missing required property is an error, a missing recommended one a warning; a nested list means "one of these".
// except: a subtype it doesn't cover; under: only when nested in that type; top: only when not nested; standalone:
// also required when not nested, or nested as the rule's `via` property; lastMayOmit: the last item of its list may
// leave that one out; alsoOn: { prop: key }, the prop may sit on the object in that key instead (a breadcrumb's name
// on its item).
const G = "https://developers.google.com/search/docs/appearance/structured-data/";
const RULES = [
  {
    type: "Product",
    except: "ProductGroup",
    for: "Google product snippets",
    doc: G + "product-snippet",
    required: ["name"],
    standalone: [["offers", "review", "aggregateRating"]],
    via: "hasVariant",
    recommended: ["image", "description"],
  },
  {
    type: "Offer",
    except: "AggregateOffer",
    under: "Product",
    for: "Google merchant listings",
    doc: G + "merchant-listing",
    required: [
      ["price", "priceSpecification"],
      ["priceCurrency", "priceSpecification"],
    ],
    recommended: ["availability"],
  },
  {
    type: "AggregateOffer",
    under: "Product",
    for: "Google product snippets",
    doc: G + "product-snippet",
    required: ["lowPrice", "priceCurrency"],
    recommended: ["highPrice", "offerCount"],
  },
  {
    type: "Review",
    for: "Google review snippets",
    doc: G + "review-snippet",
    required: ["author", "reviewRating"],
    standalone: ["itemReviewed"],
    recommended: ["datePublished"],
  },
  {
    type: "Rating",
    under: "Review",
    for: "Google review snippets",
    doc: G + "review-snippet",
    required: ["ratingValue"],
  },
  {
    type: "AggregateRating",
    for: "Google review snippets",
    doc: G + "review-snippet",
    required: ["ratingValue", ["ratingCount", "reviewCount"]],
    standalone: ["itemReviewed"],
    recommended: ["bestRating"],
  },
  {
    type: "Article",
    for: "Google article results",
    doc: G + "article",
    required: [],
    recommended: ["headline", "image", "datePublished", "dateModified", "author"],
  },
  { type: "BreadcrumbList", for: "Google breadcrumbs", doc: G + "breadcrumb", required: ["itemListElement"] },
  {
    type: "ListItem",
    under: "BreadcrumbList",
    for: "Google breadcrumbs",
    doc: G + "breadcrumb",
    required: ["position", "name", "item"],
    lastMayOmit: "item",
    alsoOn: { name: "item" },
  },
  {
    type: "Organization",
    top: true,
    for: "Google organization details",
    doc: G + "organization",
    required: [],
    recommended: ["name", "url", "logo"],
  },
  {
    type: "LocalBusiness",
    for: "Google local business results",
    doc: G + "local-business",
    required: ["name", "address"],
    recommended: ["telephone", "url", "geo", "openingHoursSpecification"],
  },
  {
    type: "Event",
    for: "Google event results",
    doc: G + "event",
    required: ["name", "startDate", "location"],
    recommended: ["description", "endDate", "eventStatus", "image", "offers", "organizer", "performer"],
  },
  { type: "Place", under: "Event", for: "Google event results", doc: G + "event", required: ["address"] },
  {
    type: "JobPosting",
    for: "Google job listings",
    doc: G + "job-posting",
    required: [
      "title",
      "datePosted",
      "description",
      "hiringOrganization",
      ["jobLocation", "applicantLocationRequirements"],
    ],
    recommended: ["validThrough", "baseSalary", "employmentType"],
  },
  {
    type: "Recipe",
    for: "Google recipe results",
    doc: G + "recipe",
    required: ["name", "image"],
    recommended: ["author", "datePublished", "description", "recipeIngredient", "recipeInstructions", "totalTime"],
  },
  {
    type: "VideoObject",
    for: "Google video results",
    doc: G + "video",
    required: ["name", "thumbnailUrl", "uploadDate"],
    recommended: ["description", ["contentUrl", "embedUrl"], "duration"],
  },
  // Google ended FAQ rich results on 7 May 2026; Bing and AI engines still read FAQPage, so only its structure is
  // checked.
  {
    type: "FAQPage",
    for: "a well-formed FAQPage (Google shows no FAQ rich results since May 2026)",
    doc: "https://schema.org/FAQPage",
    required: ["mainEntity"],
  },
  {
    type: "Question",
    under: "FAQPage",
    for: "a well-formed FAQPage (Google shows no FAQ rich results since May 2026)",
    doc: "https://schema.org/FAQPage",
    required: ["name", "acceptedAnswer"],
  },
  {
    type: "Answer",
    under: "Question",
    for: "a well-formed FAQPage or Q&A",
    doc: "https://schema.org/Answer",
    required: ["text"],
  },
];

const cache = new Map();
const ancestors = t =>
  cache.get(t) || cache.set(t, new Set([t, ...(TYPES[t] || []).flatMap(p => [...ancestors(p)])])).get(t);
const isA = (t, base) => ancestors(t).has(base);
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
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
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

  function google(v, path, known, parent, last, via) {
    const seen = new Set();
    for (const r of RULES) {
      if (
        !known.some(t => isA(t, r.type) && !(r.except && isA(t, r.except))) ||
        (r.under && !parent?.some(p => isA(p, r.under))) ||
        (r.top && parent)
      )
        continue;
      const need = [...r.required, ...(parent && via !== r.via ? [] : r.standalone || [])].filter(
        x => !(last && x === r.lastMayOmit),
      );
      const present = k =>
        has(v, k) ||
        (r.alsoOn?.[k] && [].concat(v[r.alsoOn[k]] ?? []).some(o => o && typeof o === "object" && has(o, k)));
      for (const [list, severity, verb] of [
        [need, "error", "required"],
        [r.recommended || [], "warning", "recommended"],
      ])
        for (const x of list) {
          const label = []
            .concat(x)
            .map(k => `"${k}"`)
            .join(" or ");
          if ([].concat(x).some(present) || seen.has(label)) continue;
          seen.add(label);
          add(
            severity,
            verb === "required" ? "required-missing" : "recommended-missing",
            path,
            known,
            `missing ${label}, ${verb} for ${r.for}`,
            { doc: r.doc },
          );
        }
    }
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
    for (const [key, val] of Object.entries(v)) {
      if (key === "@graph") {
        walk(val, `${path}.@graph`, null, true);
        continue;
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
      walk(val, `${path}.${key}`, known.length ? known : parent, true, k);
    }
    if (known.length) google(v, path, known, parent, last, via);
  }

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

const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;
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
      const u = new URL(input);
      if (!allowRemote && !LOCAL.test(u.hostname)) {
        console.error(
          `schema-check: ${input} isn't on this machine. This is a local tool; pass --allow-remote to fetch other hosts.`,
        );
        process.exit(2);
      }
      try {
        const res = await fetch(u);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        take(
          checkText(
            input,
            await res.text(),
            /json/i.test(res.headers.get("content-type") || "") || /\.json(ld)?$/i.test(u.pathname),
          ),
        );
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
    if (!existsSync(input)) {
      console.error(`schema-check: ${input} doesn't exist`);
      process.exit(2);
    }
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
    process.exitCode = 2;
  }
}

if (isMain(import.meta.url)) {
  const usage = () => {
    console.error(
      "usage: node schema-check.mjs <file|folder|url ...> [--json out.json] [--quiet] [--allow-remote]\n       node schema-check.mjs --hook [copilot]   (reads an agent hook payload on stdin)",
    );
    process.exit(2);
  };
  const argv = process.argv.slice(2),
    opts = {},
    inputs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") {
      opts.json = argv[++i];
      if (!opts.json) usage();
    } else if (a === "--hook") opts.hook = argv[i + 1] === "copilot" ? argv[++i] : true;
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--allow-remote") opts.allowRemote = true;
    else if (a.startsWith("--")) usage();
    else inputs.push(a);
  }
  if (opts.hook) await hook(opts.hook);
  else {
    if (!inputs.length) usage();
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
        `schema-check: ${plural(r.files, "file")}, ${plural(r.items, "item")}, ${plural(errors, "error")}, ${plural(warnings, "warning")}${notes ? `, ${plural(notes, "note")}` : ""} · schema.org ${VOCAB.version}`,
      );
      for (const i of r.issues) if (!opts.quiet || i.severity === "error") console.log(format(i));
    }
    process.exitCode = errors ? 1 : 0;
  }
}
