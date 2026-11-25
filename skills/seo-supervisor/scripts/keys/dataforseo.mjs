// @ts-check
// The DataForSEO API login for keyword-data.mjs, and its status codes as messages.
import { setLine, fail, DFS_AUTH } from "./http.mjs";

// https://docs.dataforseo.com/v3/auth
// https://dataforseo.com/pricing
export const dataforseo = {
  name: "DataForSEO",
  env: "DATAFORSEO_PASSWORD",
  endpointEnv: "DATAFORSEO_ENDPOINT",
  endpoint: "https://api.dataforseo.com/v3",
  optional: true,
  script: "keyword-data.mjs",
  secret: "API password",
  adds: "monthly searches, keyword difficulty, cost per click and intent for your keyword ideas, and the keywords a competitor ranks for that you don't (node keyword-data.mjs)",
  where: "app.dataforseo.com/api-access",
  fields: [
    {
      id: "login",
      flag: "login",
      env: "DATAFORSEO_LOGIN",
      ask: "Your DataForSEO API login (the email address on app.dataforseo.com/api-access)",
      check: s =>
        /^\S+$/.test(s)
          ? s
          : fail(`the API login is the email address shown on https://app.dataforseo.com/api-access (got "${s}").`),
    },
  ],
  about: k => `the API login ${k.login}`,
  guide: [
    "DataForSEO lets keyword-data.mjs read monthly Google searches, keyword difficulty, cost per click and intent for your keyword ideas, and list the keywords a competitor ranks for that you don't. You pay DataForSEO per request, from your own balance: no subscription.",
    "1. Sign up at https://app.dataforseo.com/register. New accounts get $1 of trial credit; after that the smallest top-up is $50, and the balance doesn't expire.",
    "2. Open https://app.dataforseo.com/api-access. It shows your API login (your email address) and your API password. The API password isn't your account password: DataForSEO makes it for you.",
    `3. In your own terminal run: ${setLine("dataforseo")}`,
    "   It asks for the API login (shown as you type), then the API password. Paste the password and press Enter. It isn't shown, so it stays out of chats and your command history.",
    "Then node keyword-data.mjs --site <your address> --ideas seo-audit/keyword-ideas.json shows what it would send and the most it can cost. Nothing is sent until you add --yes.",
  ],
};

// Errors usually arrive as HTTP 200 with a status_code; 20000 is OK.
// https://docs.dataforseo.com/v3/appendix/errors
export function dataforseoProblem(b) {
  const t = Array.isArray(b?.tasks) ? b.tasks[0] : null;
  const [code, msg] =
    b?.status_code !== 20000
      ? [b?.status_code, b?.status_message]
      : t && t.status_code !== 20000
        ? [t.status_code, t.status_message]
        : [20000, ""];
  if (code === 20000) return null;
  if (code === 40100) return DFS_AUTH;
  if (code === 40200 || code === 40210)
    return `DataForSEO says the account's balance is too low for this request (${code}). Top up at https://app.dataforseo.com, then run again.`;
  if (code === 40202 || code === 40209)
    return `DataForSEO says too many requests right now (${code}). Wait a minute and run again.`;
  return `DataForSEO said: ${String(msg || "no message").trim()} (${code ?? "no status code"}).`;
}
