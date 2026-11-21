// Whether a local business is a storefront, a service-area business or a hybrid, from its schema and visible text.
// The kind is never a finding or scored; it keeps nap-not-shown quiet for a service-area business hiding its street.
// Google: a service-area business hides an address it doesn't serve customers at, and a hybrid gives both.
// https://support.google.com/business/answer/3038177
// https://support.google.com/business/answer/9157481
import { readFileSync } from "node:fs";

// LocalBusiness and its subtypes, from schema.org's type tree.
// OnlineStore, Organization and a bare Service aren't local businesses.
const TYPES = JSON.parse(readFileSync(new URL("../data/schema-vocab.json", import.meta.url), "utf8")).types;
const isLocal = t => t === "LocalBusiness" || (Object.hasOwn(TYPES, t) && TYPES[t].some(isLocal));
const typesOf = n => [].concat(n?.["@type"] || []).filter(t => typeof t === "string");
const str = v => (typeof v === "string" && v.trim() ? v.trim() : null);
const ADDRESS = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"];
// "We'll come to you" and the like. English only, a few common phrasings; other languages need their own.
const COME =
  /\b(?:we|our (?:team|engineers?|technicians?|fitters?|staff|vans?))(?:['’]ll| will| can)? (?:come|comes|travel|travels|drive|drives) (?:out )?to (?:you|your (?:home|house|door|doorstep|office|site|premises|business|workplace|location|address))\b/i;
const pathOf = u => {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
};
const coord = v => (typeof v === "number" || (typeof v === "string" && v.trim()) ? Number(v) : NaN);

// One page's local business nodes and come-to-you phrase, or null when it has neither.
export function localFeatures(nodes, text) {
  const biz = nodes
    .filter(n => typesOf(n).some(isLocal))
    .map(n => {
      const a = [].concat(n.address || []).find(x => str(x) || (x && typeof x === "object"));
      const g = [].concat(n.geo || [])[0],
        lat = coord(g?.latitude),
        lon = coord(g?.longitude);
      // serviceArea is areaServed's older name; an area is a name, a Place with a name, or a shape (GeoCircle, GeoShape).
      const areas = [...[].concat(n.areaServed || []), ...[].concat(n.serviceArea || [])]
        .map(x => str(x) || str(x?.name) || typesOf(x)[0])
        .filter(Boolean);
      return {
        name: str(n.name),
        type: typesOf(n).find(isLocal),
        street: str(a) || str(a?.streetAddress),
        address: str(a)
          ? { text: str(a) }
          : a
            ? Object.fromEntries(ADDRESS.map(k => [k, str(a[k]) || str(a[k]?.name)]).filter(([, v]) => v))
            : null,
        geo: g && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null,
        areas,
      };
    });
  const come = String(text || "").match(COME);
  return biz.length || come ? { biz, comeToYou: come?.[0] || null } : null;
}

// shows(page, { kind, value }) is the address check's visible-text test. Returns null when no page has local business
// schema; kind is null when nothing says either way.
export function judgeLocal(pages, shows) {
  const at = pages.filter(p => p.local?.biz.length);
  if (!at.length) return null;
  const biz = at.flatMap(p => p.local.biz),
    first = biz[0];
  const streets = [...new Set(biz.map(b => b.street).filter(Boolean))];
  const shown = streets.map(s => [s, pages.find(p => shows(p, { kind: "street address", value: s }))]);
  const areas = [...new Set(biz.flatMap(b => b.areas))];
  const come = pages.find(p => p.local?.comeToYou);
  const serves = areas.length > 0 || !!come,
    onSite = shown.some(([, p]) => p);
  const kind = streets.length
    ? onSite
      ? serves
        ? "hybrid"
        : "storefront"
      : serves
        ? "service-area"
        : "storefront"
    : serves
      ? "service-area"
      : null;
  const evidence = [
    `schema: ${first.type}${first.name ? ` “${first.name}”` : ""} on ${pathOf(at[0].finalUrl)}`,
    ...shown.map(
      ([s, p]) =>
        `street address “${s}” in the schema, ${p ? `shown on ${pathOf(p.finalUrl)}` : "not shown on any page"}`,
    ),
    ...(streets.length ? [] : ["no street address in the schema"]),
    ...(areas.length
      ? [`areaServed: ${areas.slice(0, 5).join(", ")}${areas.length > 5 ? ` and ${areas.length - 5} more` : ""}`]
      : []),
    ...(come ? [`text: “${come.local.comeToYou}” on ${pathOf(come.finalUrl)}`] : []),
  ];
  return {
    kind,
    name: first.name,
    type: first.type,
    address: biz.find(b => b.address)?.address || null,
    geo: biz.find(b => b.geo)?.geo || null,
    areas: areas.slice(0, 20),
    evidence,
    streetHidden: kind === "service-area" && streets.length > 0,
  };
}
