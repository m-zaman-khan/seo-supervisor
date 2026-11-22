// @ts-check
// Every connection connect-keys.mjs knows, in the order status, fetch and the dry run list them. Each entry lives in
// its own module.
import { fail, request } from "./http.mjs";
import { bing } from "./bing.mjs";
import { openpagerank, ahrefs, moz } from "./authority.mjs";
import { matomo } from "./matomo.mjs";
import { posthog } from "./posthog.mjs";
import { youtube } from "./youtube.mjs";
import { clarity } from "./clarity.mjs";
import { perplexity } from "./perplexity.mjs";
import { openai } from "./openai.mjs";
import { googleplaces } from "./googleplaces.mjs";

export const SERVICES = {
  bing,
  openpagerank,
  ahrefs,
  matomo,
  posthog,
  moz,
  youtube,
  clarity,
  perplexity,
  openai,
  googleplaces,
};
export const serviceOf = id =>
  Object.hasOwn(SERVICES, id)
    ? id
    : fail(
        `there's no "${id}" connection. Use ${Object.keys(SERVICES)
          .join(", ")
          .replace(/, (\w+)$/, " or $1")}.`,
      );
// ai-answers.mjs and geo-grid.mjs call services through this too.
export const call = (id, url, init) => request(id, SERVICES[id], url, init);
