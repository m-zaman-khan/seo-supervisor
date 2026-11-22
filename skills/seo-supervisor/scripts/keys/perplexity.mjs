// @ts-check
import { setLine, PASTE } from "./http.mjs";

// answers: ai-answers.mjs uses it; fetch doesn't. Each answer searches the web first, so it gets 2 minutes, not the
// usual 30 seconds.
// https://docs.perplexity.ai/docs/getting-started/quickstart
export const perplexity = {
  name: "Perplexity",
  env: "PERPLEXITY_API_KEY",
  endpointEnv: "PERPLEXITY_ENDPOINT",
  endpoint: "https://api.perplexity.ai/v1/agent",
  optional: true,
  answers: true,
  timeout: 120000,
  adds: "whether Perplexity's answers to your customers' questions cite your site (node ai-answers.mjs)",
  where: "console.perplexity.ai → API Keys",
  guide: [
    "Perplexity's API lets ai-answers.mjs ask Perplexity the questions your customers ask, and count how often its answers cite your site. It uses your own key, and Perplexity bills each answer to your account.",
    "1. Sign in at https://console.perplexity.ai and create or pick a project.",
    "2. Open API Keys (https://console.perplexity.ai/project/keys) and click + Generate API Key. Copy the key straight away: the console shows it only once.",
    "3. The API needs credits: sign-up credit alone isn't enough. Buy credits on the Billing page (https://console.perplexity.ai/project/billing).",
    `4. In your own terminal run: ${setLine("perplexity")}`,
    PASTE,
    "Then node ai-answers.mjs --site <your address> --questions <file> shows what it would send and how many requests that is. Nothing is sent until you add --yes.",
  ],
};
