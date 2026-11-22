// @ts-check
// Whether a schema.org type is a business, read from schema.org's type tree (data/schema-vocab.json) so every subtype
// counts, not only the names a pattern happens to list.
import { readFileSync } from "node:fs";

/** @type {Record<string, string[]> | undefined} */
let types;
// Null prototype, so a page's "constructor" or "__proto__" type is just an unknown name.
/** schema.org's types, each with its parent types. */
export const schemaTypes = () =>
  (types ??= Object.assign(
    Object.create(null),
    JSON.parse(readFileSync(new URL("../data/schema-vocab.json", import.meta.url), "utf8")).types,
  ));
const cache = new Map();
/** A type and every type above it in schema.org's tree. @type {(t: string) => Set<string>} */
export const ancestors = t =>
  cache.get(t) || cache.set(t, new Set([t, ...(schemaTypes()[t] || []).flatMap(p => [...ancestors(p)])])).get(t);
/** @param {string} t @param {string} base */
export const isA = (t, base) => ancestors(t).has(base);
// A page may write the type as a schema.org URL ("https://schema.org/Bakery") or with a prefix ("schema:Bakery").
const term = t => (typeof t === "string" ? t.trim().replace(/^(?:https?:\/\/schema\.org\/|schema:)/, "") : "");
/** Organization or any subtype: a company, shop, clinic, school or club. A Service, Person, Brand or WebSite isn't. */
export const isBusinessType = t => isA(term(t), "Organization");
/** LocalBusiness or any subtype: a business with a place customers visit, or an area it serves. An online-only shop,
 *  a Corporation or a School isn't one. */
export const isLocalBusinessType = t => isA(term(t), "LocalBusiness");
