#!/usr/bin/env node
// Rebuilds schema-vocab.json for schema-check.mjs from one schema.org release. Run by hand for each new release.
// https://schema.org/docs/releases.html
// Output: types (name -> parents) and props (name -> [domain types, range types]); the checker resolves inheritance.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [version, flag, from] = process.argv.slice(2);
if (!/^\d+\.\d+$/.test(version || "") || (flag && (flag !== "--from" || !from))) {
  console.error("usage: node build-schema-vocab.mjs <schema.org version, e.g. 30.1> [--from file.jsonld]");
  process.exit(2);
}
const SOURCE = `https://schema.org/version/${version}/schemaorg-current-https.jsonld`;
let text;
if (from) text = readFileSync(from, "utf8");
else {
  const res = await fetch(SOURCE);
  if (!res.ok) {
    console.error(`build-schema-vocab: ${SOURCE} returned ${res.status}`);
    process.exit(1);
  }
  text = await res.text();
}

const name = id => String(id).replace(/^schema:/, "");
const ids = v =>
  []
    .concat(v ?? [])
    .map(x => x["@id"])
    .filter(id => id?.startsWith("schema:"))
    .map(name)
    .sort();
const types = {},
  props = {};
for (const n of JSON.parse(text)["@graph"]) {
  if (!n["@id"]?.startsWith("schema:")) continue;
  const kinds = [].concat(n["@type"]);
  if (kinds.includes("rdfs:Class")) types[name(n["@id"])] = ids(n["rdfs:subClassOf"]);
  else if (kinds.includes("rdf:Property"))
    props[name(n["@id"])] = [ids(n["schema:domainIncludes"]), ids(n["schema:rangeIncludes"])];
}
const sorted = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const out = fileURLToPath(new URL("./schema-vocab.json", import.meta.url));
writeFileSync(
  out,
  JSON.stringify({
    version,
    source: SOURCE,
    license:
      "Schema.org vocabulary (https://schema.org), licensed under the Creative Commons Attribution-ShareAlike 3.0 licence (CC BY-SA 3.0, https://creativecommons.org/licenses/by-sa/3.0/). Reduced to type, parent, domain and range names by build-schema-vocab.mjs.",
    types: sorted(types),
    props: sorted(props),
  }) + "\n",
);
console.log(
  `build-schema-vocab: schema.org ${version}, ${Object.keys(types).length} types, ${Object.keys(props).length} properties · wrote ${out}`,
);
