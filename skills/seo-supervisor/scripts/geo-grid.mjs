#!/usr/bin/env node
// @ts-check
// Local rank grid: where a business's place ID ranks in Places text search at each point around it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { isMain } from "./lib/is-main.mjs";
import { proxyNote } from "./lib/proxy.mjs";
import { SERVICES, activeKeys, keyFile, call, Refused, Fail } from "./connect-keys.mjs";

const SIZES = [5, 7, 9],
  SIZE = 7,
  SPACING = 1,
  MIN_SPACING = 0.1,
  MAX_SPACING = 20,
  MAX_KEYWORDS = 3,
  TOP = 20,
  FIND_MAX = 5; // local caps, not API limits
// IDs only keeps grid searches on the free Text Search Essentials IDs Only SKU.
// https://developers.google.com/maps/billing-and-pricing/pricing
const GRID_MASK = "places.id,places.attributions",
  FIND_MASK = "places.id,places.displayName,places.formattedAddress";
const FINDER = "https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder";
const READ = "22 Nov 2026"; // when the prices quoted in the dry run were checked
export const LABEL =
  "Where your business appears in the list Google's Places API returns near each point: an approximation of Google Maps results, not a copy.";
const USAGE = `usage: node geo-grid.mjs --place-id <id> --keywords "plumber, boiler repair" [--center lat,lng] [--size 5|7|9] [--spacing 1] [--out seo-audit/geo-grid.json] [--yes]
       node geo-grid.mjs --find "Business name, town" [--yes]
  --place-id  your business's Google place ID. Find it on Google's Place ID Finder: ${FINDER}
              or with --find, which shows Google's matches and saves the one you pick.
  --keywords  1 to 3, each on its own, like plumber: not "plumber Leeds" or "plumber near me". A place name makes Google ignore each point.
  --size      points a side (default 7). --spacing: km between points (default 1). In the countryside, where businesses
              are far apart, try --spacing 3 to 5.
  --center    the grid's middle, as latitude,longitude. Without it, Google is asked where your business is.`;
const fail = msg => {
  throw new Fail("geo-grid: " + msg);
};
const PLACE_ID = /^[\w-]{10,}$/;
const r5 = x => Math.round(x * 1e5) / 1e5;
const KM_PER_DEG = (6371.0088 * Math.PI) / 180; // mean Earth radius, as in osm.mjs
// https://developers.google.com/maps/documentation/urls/get-started
const mapsLink = id =>
  `https://www.google.com/maps/search/?api=1&query=business&query_place_id=${encodeURIComponent(id)}`;
// Google's text goes to a terminal, so control characters are stripped first.
const clean = s =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .trim();

// Points row by row from the north-west corner; the centre is at floor(size / 2) both ways. Flat steps are fine
// for a few dozen km. Use a geodesic if grids ever span hundreds.
export function gridPoints({ lat, lng }, size, spacingKm) {
  const half = Math.floor(size / 2),
    step = spacingKm / KM_PER_DEG,
    cells = [];
  for (let row = 0; row < size; row++) {
    // A km east spans more degrees of longitude the further the row is from the equator.
    const y = lat + (half - row) * step,
      east = step / Math.cos((y * Math.PI) / 180);
    for (let col = 0; col < size; col++)
      cells.push({ row, col, lat: r5(y), lng: r5(((((lng + (col - half) * east) % 360) + 540) % 360) - 180) });
  }
  return cells;
}
const counts = cells => {
  const n = f => cells.filter(c => f(c.rank)).length,
    found = r => typeof r === "number";
  return {
    top3: n(r => found(r) && r <= 3),
    top10: n(r => found(r) && r <= 10),
    top20: n(found),
    notFound: n(r => r === null),
    failed: n(r => r === "error"),
  };
};
const request = (key, mask, body) => ({
  method: body ? "POST" : "GET",
  redirect: "manual",
  headers: { "x-goog-api-key": key, "x-goog-fieldmask": mask, "content-type": "application/json" },
  ...(body && { body: JSON.stringify(body) }),
});

// The first refusal (bad key, API off, no billing, rate limit) stops the run and marks the remaining points "error".
// Lone 5xx answers aren't retried; add that if Google proves flaky.
export async function runGrid({
  placeId,
  keywords,
  center = null,
  size = SIZE,
  spacingKm = SPACING,
  key,
  endpoint,
  log = s => {},
}) {
  const notes = [],
    date = new Date().toISOString().slice(0, 10);
  const d = await call(
    "googleplaces",
    `${endpoint}/places/${encodeURIComponent(placeId)}`,
    request(key, center ? "id" : "id,location"),
  );
  const ids = new Set([placeId, d?.id].filter(x => typeof x === "string")); // Google may answer with a newer ID
  if (!center) {
    const at = d?.location;
    if (!Number.isFinite(at?.latitude) || !Number.isFinite(at?.longitude))
      throw new Refused(
        "Google has no map position for this business: a business that hides its address (a service-area business) has none. Pass --center latitude,longitude, the middle of the area you serve.",
      );
    // Places coordinates may be cached for 30 days at most (Service Specific Terms 14.3).
    // https://cloud.google.com/maps-platform/terms/maps-service-terms
    center = { lat: at.latitude, lng: at.longitude };
    notes.push(
      `The grid's centre came from Google's Places API, and Google's terms let you keep those coordinates for 30 days at most (Service Specific Terms 14.3). Delete this file by ${new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)}, or run again with --center.`,
    );
  }
  // The bias circle is the largest that fits each point's square, so neighbouring circles touch without overlapping.
  const cells = gridPoints(center, size, spacingKm),
    biasRadiusM = Math.round(spacingKm * 500),
    credits = new Map();
  let stop = null,
    sent = 0;
  const out = [];
  for (const keyword of keywords) {
    const done = [];
    for (const c of cells) {
      let rank = "error";
      if (!stop) {
        try {
          // Without a bias Google ranks for the caller's IP, and a place name in the query overrides the bias, so the
          // query is the bare keyword. Service-area businesses have no address and are only found with the flag set.
          // https://developers.google.com/maps/documentation/places/web-service/text-search
          const b = await call(
            "googleplaces",
            `${endpoint}/places:searchText`,
            request(key, GRID_MASK, {
              textQuery: keyword,
              locationBias: { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: biasRadiusM } },
              includePureServiceAreaBusinesses: true,
            }),
          );
          if (!b || typeof b !== "object")
            throw new Refused(
              "Google Places API's answer isn't the list of places it used to send, so the run stopped. Google may have changed the API.",
            );
          const places = Array.isArray(b.places) ? b.places : []; // Google leaves `places` out when nothing matches
          for (const p of places)
            for (const a of Array.isArray(p?.attributions) ? p.attributions : [])
              if (typeof a?.provider === "string" && a.provider) credits.set(clean(a.provider), clean(a.providerUri));
          // The position is Google's order as returned: the terms forbid re-sorting results (3.2.3(g)).
          const i = places.findIndex(p => ids.has(p?.id));
          rank = i >= 0 && i < TOP ? i + 1 : null;
          sent++;
        } catch (e) {
          if (!(e instanceof Refused)) throw e;
          stop = e.message;
        }
      }
      done.push({ ...c, rank });
    }
    out.push({ keyword, cells: done, ...counts(done) });
    log(`"${keyword}": ${done.filter(c => c.rank !== "error").length} of ${cells.length} points checked`);
  }
  // Places content must carry Google's attribution, plus any third-party credit it sends (3.2.2(b)).
  if (credits.size)
    notes.push(
      `Google's results include data from ${[...credits].map(([p, u]) => (u ? `${p} (${u})` : p)).join(", ")}. Show this credit next to "Google Maps" wherever the grid is shown.`,
    );
  if (stop)
    notes.push(
      `Stopped after ${sent} of ${cells.length * keywords.length} searches: ${stop} The points not checked are marked as errors.`,
    );
  return {
    result: {
      source: "geo-grid",
      date,
      placeId,
      center: { lat: r5(center.lat), lng: r5(center.lng) },
      size,
      spacingKm,
      biasRadiusM,
      attribution: "Google Maps",
      label: LABEL,
      keywords: out,
      notes,
    },
    stop,
  };
}

// One line from the terminal, or the first line piped in.
async function answer(prompt) {
  const { stdin, stderr } = process;
  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stderr });
    try {
      return await rl.question(prompt);
    } catch {
      return "";
    } finally {
      rl.close();
    }
  }
  let text = "";
  for await (const c of stdin) {
    text += c;
    if (text.includes("\n")) break;
  }
  return text.split(/\r?\n/)[0];
}

async function find({ text, key, from, endpoint, placeFile, yes }) {
  if (!yes) {
    console.log(
      [
        `geo-grid: dry run, nothing sent. With --yes it would send "${text}" to Google's Places API (New) at ${new URL(endpoint).host} once, ${from}, and ask for up to ${FIND_MAX} matches with their place ID, name and address.`,
        `That request is billed as Text Search Pro: on ${READ} Google's price list showed 5,000 free a month, then $32.00 per 1,000 (developers.google.com/maps/billing-and-pricing/pricing).`,
        "You pick your business from the list. Only its place ID is saved: Google's terms don't allow saving names or addresses.",
        "Re-run with --yes once the owner agrees.",
      ].join("\n"),
    );
    return 0;
  }
  const b = await call(
    "googleplaces",
    `${endpoint}/places:searchText`,
    request(key, FIND_MASK, { textQuery: text, pageSize: FIND_MAX }),
  );
  const found = (Array.isArray(b?.places) ? b.places : [])
    .filter(p => typeof p?.id === "string" && PLACE_ID.test(p.id))
    .slice(0, FIND_MAX);
  if (!found.length) {
    console.log(
      `geo-grid: Google found no match for "${text}". Try the name as it shows on Google Maps, with the town.`,
    );
    return 1;
  }
  console.log(
    `geo-grid: Google's matches for "${text}" (shown here, not saved):\n${found.map((p, i) => `  ${i + 1}. ${[clean(p.displayName?.text), clean(p.formattedAddress)].filter(Boolean).join(", ")}\n     place ID ${p.id}`).join("\n")}\nResults: Google Maps`,
  );
  const n = Number(
    (await answer(`Which one is your business? Type its number and press Enter (just Enter for none): `)).trim(),
  );
  if (!(Number.isInteger(n) && n >= 1 && n <= found.length)) {
    console.log(`geo-grid: Nothing saved. Run again and type a number, or pass --place-id to geo-grid.mjs.`);
    return 0;
  }
  // Only place_id may be cached; names and addresses are shown, never saved (Service Specific Terms 3).
  mkdirSync(dirname(placeFile), { recursive: true });
  writeFileSync(placeFile, JSON.stringify({ placeId: found[n - 1].id }, null, 2) + "\n");
  console.log(
    `geo-grid: saved place ID ${found[n - 1].id} in ${placeFile} (only the ID). Check it's yours: ${mapsLink(found[n - 1].id)}\nNext: node geo-grid.mjs --keywords "your keyword" reads it from there.`,
  );
  return 0;
}

async function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++)
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      args[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    }
  const str = k => (typeof args[k] === "string" ? args[k].trim() : null),
    yes = args.yes === true;
  const out = resolve(str("out") || "seo-audit/geo-grid.json"),
    placeFile = join(dirname(out), "geo-grid-place.json");
  const k = activeKeys().googleplaces,
    s = SERVICES.googleplaces,
    endpoint = (process.env[s.endpointEnv] || s.endpoint).replace(/\/+$/, "");
  const from = k ? `with your key ${k.from === s.env ? `from ${s.env}` : `saved in ${keyFile()}`}` : "with your key";
  const needKey = () =>
    k?.key || fail("no Google Places key is set. To add one: node connect-keys.mjs guide googleplaces");
  if (str("find")) return find({ text: str("find"), key: yes && needKey(), from, endpoint, placeFile, yes });

  let saved = null;
  if (!str("place-id"))
    try {
      saved = JSON.parse(readFileSync(placeFile, "utf8")).placeId;
    } catch {}
  const placeId = str("place-id") || (typeof saved === "string" ? saved : null);
  if (!placeId && !str("keywords")) throw new Fail(USAGE);
  if (!placeId)
    fail(
      `no place ID. Pass --place-id <id> (Google's Place ID Finder: ${FINDER}), or find it with --find "Business name, town".`,
    );
  if (!PLACE_ID.test(placeId))
    fail(
      `"${placeId}" isn't a place ID: those are long codes of letters, digits, - and _, like ChIJN1t_tDeuEmsRUsoyG83frY4. Find yours on Google's Place ID Finder: ${FINDER}`,
    );
  const keywords = [
    ...new Set(
      (str("keywords") || "")
        .split(",")
        .map(x => x.trim().replace(/\s+/g, " "))
        .filter(Boolean),
    ),
  ];
  if (!keywords.length)
    fail(
      `--keywords needs 1 to ${MAX_KEYWORDS} keywords, separated by commas, like --keywords "plumber, boiler repair".`,
    );
  if (keywords.length > MAX_KEYWORDS)
    fail(
      `${keywords.length} keywords, but a run takes at most ${MAX_KEYWORDS} (our own cap, to keep it small). Keep the ones that matter most.`,
    );
  const size = args.size === undefined ? SIZE : Number(str("size"));
  if (!SIZES.includes(size)) fail(`--size must be 5, 7 or 9 points a side (got ${args.size}).`);
  const spacingKm = args.spacing === undefined ? SPACING : Number(str("spacing"));
  if (!(spacingKm >= MIN_SPACING && spacingKm <= MAX_SPACING))
    fail(`--spacing must be from ${MIN_SPACING} to ${MAX_SPACING} km (our own limits; got ${args.spacing}).`);
  let center = null;
  if (args.center !== undefined) {
    const [lat, lng] = String(args.center)
      .split(",")
      .map(x => (x.trim() ? Number(x) : NaN));
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180))
      fail(`--center must be latitude,longitude, like 53.7976,-1.5453 (got ${args.center}).`);
    center = { lat, lng };
  }

  const searches = size * size * keywords.length,
    across = Number(((size - 1) * spacingKm).toFixed(2));
  if (!yes) {
    console.log(
      [
        `geo-grid: dry run, nothing sent. With --yes it would ask Google's Places API (New) at ${new URL(endpoint).host}, ${from}:`,
        center
          ? `  1 check that the place ID ${placeId} is still current (Place Details, the ID only).`
          : `  1 lookup of where your business is on the map (Place Details for place ID ${placeId}, the location field only).`,
        `  ${searches} searches: one at each point of a ${size} × ${size} grid, ${spacingKm} km apart (${across} km across), ${keywords.length === 1 ? "for the keyword" : `for each of ${keywords.length} keywords`} (${keywords.map(w => `"${w}"`).join(", ")}), centred on ${center ? `${center.lat}, ${center.lng}` : "your business"}.`,
        `  ${searches + 1} requests in all.`,
        `Each search sends the keyword alone, one point's latitude and longitude, a ${Math.round(spacingKm * 500)} m circle around it that Google favours, and a request for place IDs only. Nothing about your site goes.`,
        `Cost: on ${READ} Google's price list (developers.google.com/maps/billing-and-pricing/pricing) listed searches for place IDs only (Text Search Essentials IDs Only) as free without limit, and ${center ? "the place ID check (Place Details Essentials IDs Only) as free without limit too" : "the location lookup (Place Details Essentials) at 10,000 free a month, then $5.00 per 1,000"}. Google still requires billing to be turned on in the key's project.`,
        `Check the place ID is yours: ${mapsLink(placeId)}`,
        "If your Google billing address is in the European Economic Area (EEA), Google's EEA terms apply. Their list of allowed uses for Places API results doesn't include rank tracking, though place IDs are left out of that limit. Whether to run this is your decision (cloud.google.com/terms/maps-platform/eea-places-api-permitted-uses).",
        ...(k
          ? []
          : [
              "No Google Places key is set yet, so nothing could be sent. To add one: node connect-keys.mjs guide googleplaces",
            ]),
        "The keywords and the points go to Google with your key, so re-run with --yes once the owner agrees.",
      ].join("\n"),
    );
    return 0;
  }
  const r = await runGrid({
    placeId,
    keywords,
    center,
    size,
    spacingKm,
    key: needKey(),
    endpoint,
    log: x => console.error("geo-grid: " + x),
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(r.result, null, 2));
  for (const w of r.result.keywords)
    console.log(
      `geo-grid: "${w.keyword}": in the top 3 at ${w.top3} of ${w.cells.length} points · top 10 at ${w.top10} · not in the top ${TOP} at ${w.notFound}${w.failed ? ` · errors at ${w.failed}` : ""}`,
    );
  for (const n of r.result.notes) console.log("geo-grid: " + n);
  console.log(`geo-grid: ${LABEL}\ngeo-grid: Results: Google Maps\ngeo-grid: wrote ${out}`);
  return r.stop ? 1 : 0;
}

if (isMain(import.meta.url)) {
  {
    const n = proxyNote();
    if (n) console.error("note: " + n);
  }
  process.exitCode = await main(process.argv.slice(2)).then(null, e => {
    if (e instanceof Refused) {
      console.log("geo-grid: " + e.message);
      return 1;
    }
    if (!(e instanceof Fail) && e.code !== "SEO_SETTINGS") throw e;
    console.error(e.message);
    return 2;
  });
}
