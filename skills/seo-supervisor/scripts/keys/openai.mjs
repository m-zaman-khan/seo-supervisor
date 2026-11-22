// @ts-check
import { setLine, PASTE } from "./http.mjs";

// answers: ai-answers.mjs uses it; fetch doesn't. Each answer searches the web first, so it gets 2 minutes, not the
// usual 30 seconds.
// https://developers.openai.com/api/docs/quickstart
export const openai = {
  name: "OpenAI",
  env: "OPENAI_API_KEY",
  endpointEnv: "OPENAI_ENDPOINT",
  endpoint: "https://api.openai.com/v1/responses",
  optional: true,
  answers: true,
  timeout: 120000,
  adds: "whether the model ChatGPT uses, searching the web, cites your site when it answers your customers' questions (node ai-answers.mjs)",
  where: "platform.openai.com/api-keys",
  guide: [
    "OpenAI's API lets ai-answers.mjs ask the model ChatGPT uses, with web search, the questions your customers ask, and count how often its answers cite your site. It uses your own key, and OpenAI bills each answer to your account.",
    "1. Sign in at https://platform.openai.com.",
    "2. Open https://platform.openai.com/api-keys and create a new secret key. Copy it and keep it private.",
    "3. The API needs credits: add them on the billing page (https://platform.openai.com/account/billing/overview).",
    `4. In your own terminal run: ${setLine("openai")}`,
    PASTE,
    "Then node ai-answers.mjs --site <your address> --questions <file> shows what it would send and how many requests that is. Nothing is sent until you add --yes.",
  ],
};
