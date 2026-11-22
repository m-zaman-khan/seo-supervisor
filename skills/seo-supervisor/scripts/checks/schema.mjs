// @ts-check
// Structured data checks shared by the crawler and schema-check.mjs, which re-exports them.
import { isA, schemaTypes } from "../lib/business.mjs";

const term = s => s.replace(/^(?:https?:\/\/schema\.org\/|schema:)/, "");
const list = x => [].concat(x ?? []);
const clip = s => (s.length > 60 ? s.slice(0, 57) + "…" : s);

// A merchant listing is a Product sold with an Offer, not an AggregateOffer. It needs an image, a price above zero, an
// ISO 4217 priceCurrency and one availability value, as the URL or its short name. The crawler reads these too.
export const MERCHANT_DOC = "https://developers.google.com/search/docs/appearance/structured-data/merchant-listing";
// Every current alphabetic code in ISO 4217 List One, as its maintenance agency SIX published it on 17 Sep 2026.
export const ISO_4217 = new Set(
  (
    "AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE " +
    "CHF CHW CLF CLP CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR " +
    "ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK " +
    "MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP " +
    "STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAD XAF XAG XAU XBA XBB XBC XBD " +
    "XCD XCG XDR XOF XPD XPF XPT XSU XTS XUA XXX YER ZAR ZMW ZWG"
  ).split(" "),
);
// ItemAvailability's members in schema.org V30.1. Google lists ten and accepts short names; MadeToOrder and Reserved
// are schema.org's too, so they aren't flagged.
// https://schema.org/ItemAvailability
const AVAILABILITY = new Set(
  "BackOrder Discontinued InStock InStoreOnly LimitedAvailability MadeToOrder OnlineOnly OutOfStock PreOrder PreSale Reserved SoldOut".split(
    " ",
  ),
);
// Stand-ins for a brand. Merchant Center's help says to leave brand out rather than guess, and to use the shop's name
// for its own products.
const NO_BRAND =
  /^(?:n\/?a|none|no brand|unbranded|generic|unknown|not applicable|does not exist|null|undefined|-+)?$/i;
const typeIs = (o, t) => list(o?.["@type"]).some(x => typeof x === "string" && term(x) === t);
/** A Product sold with an Offer rather than an AggregateOffer: one Google's merchant listings are for. */
export const sellsWithOffer = p =>
  list(p?.offers).some(o => o && typeof o === "object" && !typeIs(o, "AggregateOffer"));
/** The values in a Product's offers and brand that Google's merchant listings reject or ignore. */
export function merchantProblems(p) {
  const out = [],
    say = (check, severity, key, value, message) => out.push({ check, severity, key, value: String(value), message });
  for (const o of list(p?.offers).filter(o => o && typeof o === "object")) {
    const specs = list(o.priceSpecification).filter(s => s && typeof s === "object");
    const price = o.price ?? specs.find(s => !/StrikethroughPrice$/.test(String(s.priceType ?? "")))?.price;
    if (!typeIs(o, "AggregateOffer") && String(price ?? "").trim() !== "" && Number(price) === 0)
      say(
        "price-zero",
        "warning",
        "price",
        price,
        `"price" is ${price}; Google's merchant listings need a price above zero (product snippets accept 0)`,
      );
    for (const c of [o.priceCurrency, ...specs.map(s => s.priceCurrency)])
      if (typeof c === "string" && !ISO_4217.has(c.trim().toUpperCase()))
        say(
          "currency-invalid",
          "error",
          "priceCurrency",
          c,
          `"priceCurrency" is "${clip(c)}"; Google wants a three-letter ISO 4217 code, such as "USD", "EUR" or "GBP"`,
        );
    const av = list(o.availability).map(x => (typeof x === "string" ? x : x?.["@id"]));
    if (av.length > 1)
      say(
        "availability-invalid",
        "warning",
        "availability",
        av.join(", "),
        `"availability" has ${av.length} values; Google wants one, such as "https://schema.org/InStock"`,
      );
    else if (av.length && !(typeof av[0] === "string" && AVAILABILITY.has(term(av[0].trim()))))
      say(
        "availability-invalid",
        "warning",
        "availability",
        av[0],
        `"availability" is "${clip(String(av[0]))}"; use one of schema.org's ItemAvailability values, such as "https://schema.org/InStock" or "https://schema.org/OutOfStock"`,
      );
    if (typeof o.priceValidUntil === "string" && Date.parse(o.priceValidUntil) < Date.now() - 864e5)
      say(
        "price-expired",
        "warning",
        "priceValidUntil",
        o.priceValidUntil,
        `"priceValidUntil" is ${clip(o.priceValidUntil)}, in the past; Google says the listing may not show`,
      );
  }
  for (const b of list(p?.brand)) {
    const name = typeof b === "string" ? b : b && typeof b === "object" && "name" in b ? b.name : null;
    if (typeof name === "string" && NO_BRAND.test(name.trim()))
      say(
        "brand-placeholder",
        "warning",
        "brand",
        name,
        `the brand is "${clip(name)}", which isn't a brand; leave "brand" out when there's none, or use the shop's name for products it makes itself`,
      );
  }
  return out;
}

// Types schema.org deprecates, and the type it names instead. The crawler reads this list too.
// https://schema.org/Attorney
export const SUPERSEDED = { Attorney: "LegalService" };
// Template placeholders: a bracketed field name ([Business Name], [Phone], [CITY]) or a REPLACE_ token. Only field
// names count, so "[Updated]" in a headline isn't one.
const BRACKET =
  /\[(?:(?:your|the|insert|enter|add) )?(?:business|company|brand|site|store|shop|city|town|street|state|county|region|country|zip|postcode|postal|phone|telephone|email|e-mail|address|name|url|website|domain|logo|price|hours)(?: (?:name|number|address|url|code|here))?\]/i;
const REPLACE = /\bREPLACE_[A-Z0-9_]*|\bREPLACE[_ ]?ME\b/;
export const placeholderIn = s => (BRACKET.exec(s) || REPLACE.exec(s))?.[0] ?? null;

// A nested review or rating should leave out itemReviewed, as the parent is the item reviewed, and since 12 Nov 2025
// Google asks sites not to name it more than one way. Only a different item is flagged, told apart by @id when both
// have one, else by name.
// https://developers.google.com/search/updates
export const REVIEW_DOC = "https://developers.google.com/search/docs/appearance/structured-data/review-snippet";
const nameKey = s => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().toLowerCase() : "");
/** The other item a review or rating nested in `parent` names in itemReviewed (its name or @id), or null. */
export function otherReviewed(parent, child) {
  if (!parent || typeof parent !== "object" || !child || typeof child !== "object") return null;
  const own = [parent["@id"], parent.url, parent.name].map(nameKey).filter(Boolean);
  for (const it of list(child.itemReviewed)) {
    if (typeof it === "string") {
      if (it.trim() && own.length && !own.includes(nameKey(it))) return it.trim();
      continue;
    }
    if (!it || typeof it !== "object") continue;
    if (typeof it["@id"] === "string" && typeof parent["@id"] === "string") {
      if (it["@id"].trim() !== parent["@id"].trim()) return nameKey(it.name) ? it.name.trim() : it["@id"].trim();
    } else if (nameKey(it.name) && nameKey(parent.name) && nameKey(it.name) !== nameKey(parent.name))
      return it.name.trim();
  }
  return null;
}
// Google's event results need a physical location; the online event properties went on 5 Jun 2025. Online mode with no
// other place, or only VirtualLocations, is online only; Mixed or Offline mode, a Place or a text address isn't.
export const EVENT_DOC = "https://developers.google.com/search/docs/appearance/structured-data/event";
/** True when an Event has no real-world place. */
export function onlineOnly(e) {
  const mode = list(e?.eventAttendanceMode).map(x =>
    term(String((x && typeof x === "object" ? x["@id"] : x) ?? "").trim()),
  );
  if (mode.some(m => /^(Offline|Mixed)EventAttendanceMode$/.test(m))) return false;
  const locs = list(e?.location).filter(l => l != null && l !== ""),
    virtual = l => typeIs(l, "VirtualLocation");
  return mode.includes("OnlineEventAttendanceMode") ? locs.every(virtual) : locs.length > 0 && locs.every(virtual);
}
/** For the crawler: the names of online-only events and each nested review or rating naming another item, at any depth;
 *  the business nodes at the top (orgs) and the businesses rated here (rated), as { id, name, type, kind }. */
export function reviewEventProblems(nodes) {
  const events = [],
    reviews = [],
    seen = new Set();
  const walk = (o, d) => {
    if (!o || typeof o !== "object" || d > 12 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) return o.forEach(x => walk(x, d + 1));
    const types = list(o["@type"])
      .filter(t => typeof t === "string")
      .map(term)
      .filter(t => schemaTypes()[t]);
    if (types.some(t => isA(t, "Event")) && onlineOnly(o))
      events.push(typeof o.name === "string" && o.name.trim() ? o.name.trim() : "an event");
    for (const k of ["review", "aggregateRating"])
      for (const c of list(o[k])) {
        const other = otherReviewed(o, c);
        if (other)
          reviews.push(
            `${k === "review" ? "a review" : "a rating"} in “${nameKey(o.name) ? o.name.trim() : types[0] || "an item"}” names “${other}”`,
          );
      }
    Object.values(o).forEach(x => walk(x, d + 1));
  };
  nodes.forEach(n => walk(n, 0));
  return { events, reviews };
}
