// @ts-check
// The Semrush API key, for keyword-data.mjs.
import { setLine, PASTE } from "./http.mjs";

// v4 only: v3 is deprecated and its keys don't work with v4.
// https://developer.semrush.com/api/v4
export const semrush = {
  name: "Semrush",
  env: "SEMRUSH_API_KEY",
  endpointEnv: "SEMRUSH_ENDPOINT",
  endpoint: "https://api.semrush.com/apis/v4",
  optional: true,
  script: "keyword-data.mjs",
  adds: "monthly searches, keyword difficulty, cost per click and intent for your keyword ideas (node keyword-data.mjs)",
  where: "https://www.semrush.com/accounts/api-keys/active",
  guide: [
    "Semrush lets keyword-data.mjs read monthly searches, keyword difficulty, cost per click and intent for your keyword ideas, from your own Semrush account. Each keyword costs 20 API units.",
    "1. The API needs the SEO Toolkit Business plan (or Semrush Advanced or SEO Enterprise), and API units, which Semrush sells separately: a Business plan starts with none. Buy them under Subscription info → API units.",
    "2. Open https://www.semrush.com/accounts/api-keys/active and copy a v4 key, or create one. Semrush shows a new key in full only once. A key made for the older v3 API doesn't work with v4.",
    `3. In your own terminal run: ${setLine("semrush")}`,
    PASTE,
    "Then node keyword-data.mjs --site <your address> --ideas seo-audit/keyword-ideas.json --service semrush shows what it would send and how many units that is. Nothing is sent until you add --yes.",
    "Semrush's terms don't allow keeping its data for more than a month without their written consent, so run it again rather than reusing an old keyword-data.json.",
  ],
};
