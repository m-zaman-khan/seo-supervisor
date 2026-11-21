#!/usr/bin/env node
// @ts-check
// Nearby businesses of the same kind, and a check of the business's address, from OpenStreetMap. Context for the
// report: never a finding, never scored.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { proxyNote } from "./lib/proxy.mjs";
import { VERSION } from "./update-check.mjs";
import { BUSINESS_TYPES } from "./checks/business-type.mjs";

// Nominatim allows 1 request per second and no bulk geocoding, and wants results cached.
// https://operations.osmfoundation.org/policies/nominatim/
// overpass-api.de allows 10,000 queries and 1 GB a day; commercial use should run its own server (OSM_OVERPASS).
// https://wiki.openstreetmap.org/wiki/Overpass_API
const NOMINATIM = "https://nominatim.openstreetmap.org/search",
  OVERPASS = "https://overpass-api.de/api/interpreter";
const UA = `seo-supervisor-osm/${VERSION} (+https://github.com/m-zaman-khan/seo-supervisor)`;
export // The data is ODbL; this credit, linked to the copyright page, is the accepted attribution.
// https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
const CREDIT = "© OpenStreetMap contributors";
const USAGE =
  'usage: node osm.mjs --crawl seo-audit/seo-crawl.json [--type plumber] [--near 53.7976,-1.5453] [--address "12 Park Row, Leeds"] [--radius 2000] [--out seo-audit/osm.json] [--yes]';
// The 10 km cap keeps the Overpass query small.
const RADIUS = 2000,
  MAX_RADIUS = 10000,
  CAP = 16 * 1024 * 1024,
  BUSY = new Set([429, 503, 504]);

// Tags per id in data/business-types.json. "a=b&c=d" needs both; null is an online business or a kind OpenStreetMap
// has no tag for.
// https://wiki.openstreetmap.org/wiki/Map_features
export const OSM_TAGS = {
  restaurant: ["amenity=restaurant"],
  cafe: ["amenity=cafe"],
  bar: ["amenity=bar", "amenity=pub"],
  bakery: ["shop=bakery"],
  dentist: ["amenity=dentist"],
  physician: ["amenity=doctors"],
  clinic: ["amenity=clinic"],
  hospital: ["amenity=hospital"],
  pharmacy: ["amenity=pharmacy"],
  optician: ["shop=optician"],
  lawyer: ["office=lawyer"],
  "real-estate": ["office=estate_agent"],
  "car-dealer": ["shop=car"],
  hotel: ["tourism=hotel"],
  motel: ["tourism=motel"],
  "bed-and-breakfast": ["tourism=guest_house"],
  hostel: ["tourism=hostel"],
  resort: ["leisure=resort"],
  campground: ["tourism=camp_site"],
  "vacation-rental": ["tourism=apartment"],
  plumber: ["craft=plumber"],
  electrician: ["craft=electrician"],
  hvac: ["craft=hvac"],
  roofer: ["craft=roofer"],
  builder: ["craft=builder", "office=construction_company"],
  painter: ["craft=painter"],
  locksmith: ["shop=locksmith", "craft=locksmith"],
  movers: ["office=moving_company"],
  "beauty-salon": ["shop=beauty"],
  "hair-salon": ["shop=hairdresser"],
  "nail-salon": ["shop=beauty&beauty=nails"],
  "day-spa": ["shop=beauty&beauty=spa"],
  gym: ["leisure=fitness_centre"],
  "online-store": null,
  "clothing-store": ["shop=clothes"],
  florist: ["shop=florist"],
  "book-store": ["shop=books"],
  "jewelry-store": ["shop=jewelry"],
  "furniture-store": ["shop=furniture"],
  "hardware-store": ["shop=hardware", "shop=doityourself"],
  "pet-store": ["shop=pet"],
  "bike-store": ["shop=bicycle"],
  "grocery-store": ["shop=supermarket", "shop=greengrocer", "shop=convenience"],
  software: null,
  school: ["amenity=school"],
  university: ["amenity=university", "amenity=college"],
  education: ["amenity=prep_school", "amenity=language_school"],
  publisher: null,
};

const reason = e => (e.name === "TimeoutError" ? "no answer within 60 seconds" : e.cause?.code || e.message);
// body is null when the answer isn't JSON.
async function call(url, init = {}) {
  const r = await fetch(url, {
    ...init,
    headers: { "user-agent": UA, accept: "application/json", ...init.headers },
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  const chunks = [];
  let n = 0;
  for await (const c of r.body ?? []) {
    if ((n += c.length) > CAP) throw new Error("the answer is over 16 MB");
    chunks.push(c);
  }
  try {
    return { status: r.status, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { status: r.status, body: null };
  }
}
const busy = (who, status, what) =>
  `${who} answered HTTP ${status}${BUSY.has(status) ? " (busy)" : ""}, so ${what}. Try again later.`;
const rad = d => (d * Math.PI) / 180;
// Great-circle distance in metres (haversine, the Earth's mean radius).
const metres = (a, b) =>
  2 *
  6371008.8 *
  Math.asin(
    Math.sqrt(
      Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2,
    ),
  );
const point = (lat, lon) => {
  lat = typeof lat === "string" && lat.trim() ? +lat : lat;
  lon = typeof lon === "string" && lon.trim() ? +lon : lon;
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon }
    : null;
};
const same = s =>
  String(s || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const km = m => (m < 1000 ? `${m} m` : `${+(m / 1000).toFixed(1)} km`);

// A service-area business's street is never sent, only its town, region, postcode and country.
export function addressOf(local) {
  const a = local?.address,
    sab = local?.kind === "service-area";
  if (!a || typeof a !== "object") return null;
  if (a.text) return sab ? null : a.text;
  return (
    [...(sab ? [] : [a.streetAddress]), a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
      .filter(s => typeof s === "string" && s.trim())
      .join(", ") || null
  );
}

// local is the crawl's localBusiness; cached is the last run's geocode, reused for the same address as Nominatim asks.
export async function lookupOsm({
  type,
  near = null,
  address = null,
  radius = RADIUS,
  local = null,
  cached = null,
  nominatim = NOMINATIM,
  overpass = OVERPASS,
}) {
  const notes = [],
    out =
      /** @type {{ source: string, when: string, credit: string, licence: string, copyright: string, nearby?: any, geocode?: any }} */ ({
        source: "openstreetmap",
        when: new Date().toISOString(),
        credit: CREDIT,
        licence: "ODbL 1.0",
        copyright: "https://www.openstreetmap.org/copyright",
      });
  const sab = local?.kind === "service-area",
    schemaGeo = point(local?.geo?.lat, local?.geo?.lon);
  let center = near ? { ...near, from: "--near" } : schemaGeo ? { ...schemaGeo, from: "the schema's geo" } : null;
  // One Nominatim request a run: to check a storefront's address, or to find a centre when there's none.
  if (address && (!sab || !center)) {
    try {
      const reuse = cached?.query === address && point(cached.found?.lat, cached.found?.lon);
      const u = new URL(nominatim);
      u.search = new URLSearchParams({ q: address, format: "jsonv2", limit: "1" }).toString();
      const { status, body } = reuse
        ? { status: 200, body: [{ lat: cached.found.lat, lon: cached.found.lon, display_name: cached.found.label }] }
        : await call(u);
      if (status !== 200 || !Array.isArray(body)) notes.push(busy("Nominatim", status, "the address wasn't looked up"));
      else {
        const hit = point(body[0]?.lat, body[0]?.lon),
          found = hit && { ...hit, label: typeof body[0].display_name === "string" ? body[0].display_name : null };
        out.geocode = {
          query: address,
          found: found || null,
          schemaGeo,
          distanceM: found && schemaGeo ? Math.round(metres(found, schemaGeo)) : null,
          suggestGeo: !!found && !schemaGeo && !sab,
        };
        if (!center && found)
          center = {
            lat: found.lat,
            lon: found.lon,
            from: sab ? "the town, via Nominatim" : "the address, via Nominatim",
          };
      }
    } catch (e) {
      notes.push(`Couldn't reach Nominatim (${reason(e)}), so the address wasn't looked up.`);
    }
  }
  if (!center) {
    notes.push(
      "No centre for the nearby search: OpenStreetMap couldn't place the address. Pass --near with the business's latitude and longitude.",
    );
    return { ...out, notes };
  }
  // One Overpass query a run; a busy answer ends it with no retry.
  const tags = OSM_TAGS[type];
  const query = `[out:json][timeout:25];(${tags
    .map(
      t =>
        `nwr${t
          .split("&")
          .map(kv => `["${kv.split("=")[0]}"="${kv.split("=")[1]}"]`)
          .join("")}(around:${radius},${center.lat},${center.lon});`,
    )
    .join("")});out center;`;
  try {
    const { status, body } = await call(overpass, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }).toString(),
    });
    if (status !== 200 || !Array.isArray(body?.elements)) {
      notes.push(busy("Overpass", status, "nearby businesses weren't counted"));
      return { ...out, notes };
    }
    const own = same(local?.name); // the business itself, left out by name
    const places = body.elements
      .map(e => ({
        name: typeof e.tags?.name === "string" && e.tags.name.trim() ? e.tags.name.trim() : null,
        at: point(e.lat ?? e.center?.lat, e.lon ?? e.center?.lon),
        osm: `${e.type}/${e.id}`,
      }))
      .filter(p => p.at && (!own || same(p.name) !== own))
      .map(p => ({ ...p, distanceM: Math.round(metres(center, p.at)) }))
      .filter(p => p.distanceM <= radius)
      .sort((a, b) => a.distanceM - b.distanceM);
    // perKm2 is a local measure over the search circle, not an OpenStreetMap figure.
    out.nearby = {
      type,
      label: BUSINESS_TYPES.find(b => b.id === type)?.label || type,
      tags,
      center: { lat: center.lat, lon: center.lon },
      centerFrom: center.from,
      radiusM: radius,
      count: places.length,
      unnamed: places.filter(p => !p.name).length,
      perKm2: +(places.length / (Math.PI * (radius / 1000) ** 2)).toFixed(2),
      places: places
        .filter(p => p.name)
        .slice(0, 20)
        .map(p => ({ name: p.name, distanceM: Math.round(p.distanceM / 10) * 10, osm: p.osm })),
    };
  } catch (e) {
    notes.push(`Couldn't reach Overpass (${reason(e)}), so nearby businesses weren't counted.`);
  }
  return { ...out, notes };
}

class Fail extends Error {}
async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      args[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    }
  const str = k => (typeof args[k] === "string" ? args[k].trim() : null);
  let crawl = null;
  if (str("crawl")) {
    try {
      crawl = JSON.parse(readFileSync(str("crawl"), "utf8"));
    } catch (e) {
      throw new Fail(`osm: couldn't read --crawl ${str("crawl")} (${e.code || e.message}).`);
    }
  }
  const local = crawl?.localBusiness && typeof crawl.localBusiness === "object" ? crawl.localBusiness : null;
  const ids = Object.keys(OSM_TAGS)
    .filter(k => OSM_TAGS[k])
    .join(", ");
  const type = str("type") || (typeof crawl?.businessType?.guess === "string" ? crawl.businessType.guess : null);
  if (!type)
    throw new Fail(
      `osm: no business type. Pass --type with one of: ${ids}; or --crawl with a crawl that guessed it.\n${USAGE}`,
    );
  if (!Object.hasOwn(OSM_TAGS, type)) throw new Fail(`osm: unknown --type "${type}". Use one of: ${ids}.`);
  const label = BUSINESS_TYPES.find(b => b.id === type)?.label || type;
  if (!OSM_TAGS[type])
    throw new Fail(`osm: ${label} isn't a place on a map, so there are no nearby businesses to count.`);
  let near = null;
  if (args.near !== undefined) {
    const [a, b] = String(args.near).split(",");
    near = point(a, b);
    if (!near) throw new Fail(`osm: --near must be latitude,longitude, like 53.7976,-1.5453 (got ${args.near}).`);
  }
  const radius = args.radius === undefined ? RADIUS : Number(args.radius);
  if (!Number.isInteger(radius) || radius < 100 || radius > MAX_RADIUS)
    throw new Fail(`osm: --radius must be whole metres from 100 to ${MAX_RADIUS} (got ${args.radius}).`);
  const address = str("address") || addressOf(local),
    schemaGeo = point(local?.geo?.lat, local?.geo?.lon),
    sab = local?.kind === "service-area";
  if (!near && !schemaGeo && !address)
    throw new Fail(
      `osm: no place to search around. Pass --near latitude,longitude or --address, or --crawl with a crawl that found the business's address.\n${USAGE}`,
    );
  // OSM_NOMINATIM and OSM_OVERPASS point at another server, or the tests' fakes.
  const nominatim = process.env.OSM_NOMINATIM || NOMINATIM,
    overpass = process.env.OSM_OVERPASS || OVERPASS;
  const geocodes = !!address && (!sab || (!near && !schemaGeo));

  if (args.yes !== true) {
    const around = near
      ? `${near.lat}, ${near.lon} (--near)`
      : schemaGeo
        ? `${schemaGeo.lat}, ${schemaGeo.lon} (the schema's geo)`
        : "the point Nominatim gives";
    console.log(
      [
        "osm: dry run, nothing sent. With --yes it would:",
        ...(geocodes
          ? [
              `- send the address “${address}” to Nominatim (${new URL(nominatim).host}), one request, to ${sab ? "find the town" : "see where OpenStreetMap places it"};`,
            ]
          : []),
        `- ask Overpass (${new URL(overpass).host}), in one request, for ${label} places (${OSM_TAGS[type].join(", ")}) within ${km(radius)} of ${around}.`,
        `No key is needed. The data is ${CREDIT}, free under the Open Database License (ODbL), and the report credits it.`,
        "For commercial use, the Overpass wiki asks for a self-hosted or paid Overpass server: set OSM_OVERPASS to its address.",
        "These go to outside services, so re-run with --yes once the owner agrees.",
      ].join("\n"),
    );
    return 0;
  }
  {
    const n = proxyNote();
    if (n) console.error("note: " + n);
  }
  const out = resolve(str("out") || "seo-audit/osm.json");
  let cached = null;
  try {
    cached = JSON.parse(readFileSync(out, "utf8")).geocode;
  } catch {}
  const result = await lookupOsm({
    type,
    near,
    address: geocodes ? address : null,
    radius,
    local,
    cached,
    nominatim,
    overpass,
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
  for (const n of result.notes) console.log("note: " + n);
  const nb = result.nearby,
    g = result.geocode;
  console.log(
    `osm: ${nb ? `${nb.count} other ${label} place(s) within ${km(radius)} (${nb.perKm2} per km²)` : "nearby businesses not counted"}${g ? ` · address ${g.found ? "found" : "not found"}` : ""} · ${CREDIT} · wrote ${out}`,
  );
  return 0;
}

// Exit by setting the code, not process.exit(): exiting while sockets close crashes Node on Windows.
if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2)).then(null, e => {
    if (!(e instanceof Fail)) throw e;
    console.error(e.message);
    return 2;
  });
}
