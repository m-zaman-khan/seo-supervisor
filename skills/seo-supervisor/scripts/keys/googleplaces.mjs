// @ts-check
import { setLine, PASTE } from "./http.mjs";

// script: geo-grid.mjs uses it; fetch doesn't. The project needs billing enabled. The key goes in the X-Goog-Api-Key
// header, never in an address. Prices are in geo-grid.mjs.
// https://developers.google.com/maps/documentation/places/web-service/get-api-key
export const googleplaces = {
  name: "Google Places API",
  env: "GOOGLE_PLACES_API_KEY",
  endpointEnv: "GOOGLE_PLACES_ENDPOINT",
  endpoint: "https://places.googleapis.com/v1",
  optional: true,
  script: "geo-grid.mjs",
  adds: "where your business appears in the list Google's Places API returns near each point of a grid around it (node geo-grid.mjs)",
  where: "console.cloud.google.com → Google Maps Platform → Keys & Credentials",
  guide: [
    "Google's Places API (New) lets geo-grid.mjs check where your business appears in the list Google returns for a keyword near each point of a grid around it. It uses your own Google Maps Platform key. Asking for place IDs only, as geo-grid does, is listed as free without limit on Google's price list (read 22 Nov 2026).",
    "1. Open https://console.cloud.google.com and pick or create a project.",
    "2. Turn on billing for the project: https://console.cloud.google.com/projectselector/billing. Google requires billing for the Places API even when your use stays within the free amounts.",
    "3. Open https://console.cloud.google.com/apis/library/places.googleapis.com and click Enable. Check that it says Places API (New). It can take a few minutes to start working.",
    "4. Open Google Maps Platform → Keys & Credentials (https://console.cloud.google.com/projectselector/google/maps-apis/credentials) and click Create credentials → API key. Under API restrictions, keep only Places API (New) selected, so the key can't be used for anything else.",
    `5. Copy the key, then in your own terminal run: ${setLine("googleplaces")}`,
    PASTE,
    'Then node geo-grid.mjs --place-id <your place ID> --keywords "plumber" shows what it would send and how many requests that is. Nothing is sent until you add --yes. Your place ID is on Google\'s Place ID Finder: https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder',
  ],
};
