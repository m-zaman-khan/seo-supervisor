// @ts-check
// Sample pages asked again as Googlebot and as AI search crawlers, each compared with a phone visitor.
import { analyze } from "../crawl/page.mjs";
import { isLocal, urlOr } from "../crawl/fetch.mjs";
import { sleep } from "./crawl.mjs";
import { BOTS } from "./agents.mjs";

// ---------- what Googlebot gets ----------
// Google's smartphone Googlebot, with a current Chrome version.
// https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers
const GOOGLEBOT_UA =
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.8103.79 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
// The same phone without the Googlebot token, so a site that serves phones differently serves both alike.
const PHONE_UA = GOOGLEBOT_UA.replace(/ \(compatible; Googlebot.*$/, "");
// A response as a page, or null when it isn't HTML, with the sitemap's hreflang alternates merged in as analyze()
// does. page is analyze()'s context (crawl/page.mjs).
export const readPage = (r, page) =>
  r.status === 200 && /html/.test(r.ct) && r.body ? analyze(r.finalUrl, r.body, r.headers, undefined, page) : null;
const canonOf = (p, base) => (p.canonicals[0] ? (urlOr(p.canonicals[0], base)?.href ?? p.canonicals[0]) : "none");
// A bot challenge: Cloudflare sets cf-mitigated and loads its challenge platform, AWS WAF sets x-amzn-waf-action.
// https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/
// https://docs.aws.amazon.com/waf/latest/developerguide/waf-captcha-and-challenge-actions.html
const challenged = r =>
  /^challenge$/i.test(r.headers.get("cf-mitigated") || "") ||
  /^(challenge|captcha)$/i.test(r.headers.get("x-amzn-waf-action") || "") ||
  /\/cdn-cgi\/challenge-platform\//.test(r.body || "");
// A 429 or 5xx is asked once more a second later, so a rate limit or flaky backend hitting one side isn't judged.
const busy = r => r.status === 429 || r.status >= 500;

// Runs last, since a firewall may ban the address that sent a fake Googlebot. Only the crawled site is asked.
// botSample is the home page and up to 9 sample pages (sampleUrls). Returns how many pages were compared.
export async function compareGooglebot(site, { page, botSample }) {
  const { add, start: START, startOrigin: START_ORIGIN, conc: CONC, follow } = site;
  const pageOf = r => readPage(r, page),
    askAgain = async (u, ua) => {
      await sleep(1000);
      return follow(u, ua);
    };
  // A local build has no CDN or firewall in front, so a refusal there is the app's own (prerender middleware, bot
  // detection). CDN and firewall rules only show when a staging or live server is crawled.
  const NO_FIREWALL = isLocal(START_ORIGIN) || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(START.hostname);
  let botCompared = 0;
  for (let i = 0; i < botSample.length; i += CONC)
    await Promise.all(
      botSample.slice(i, i + CONC).map(async u => {
        let [vr, gr] = await Promise.all([follow(u, PHONE_UA), follow(u, GOOGLEBOT_UA)]);
        if (busy(vr)) vr = await askAgain(u, PHONE_UA);
        const v = pageOf(vr),
          at = vr.finalUrl;
        if (!v) return; // the visitor didn't get the page either: nothing to compare
        if (busy(gr)) gr = await askAgain(u, GOOGLEBOT_UA);
        const g = pageOf(gr),
          challenge = challenged(gr) && !challenged(vr);
        botCompared++;
        const got = `Googlebot got ${challenge ? `a bot challenge (${gr.status})` : gr.status || `no answer (${gr.error})`}, a visitor 200`;
        // A firewall that verifies Googlebot by IP is right to refuse this request.
        if ((challenge || [403, 429, 503].includes(gr.status)) && !NO_FIREWALL)
          return add("googlebot-firewall", at, got);
        if (gr.status >= 400 || gr.status === 0 || challenge) return add("googlebot-blocked", at, got);
        if (g?.noindex && !v.noindex)
          return add("googlebot-blocked", at, "Googlebot gets a noindex that a visitor doesn't");
        const diffs = !g
          ? [`Googlebot got ${gr.status} ${gr.ct || "with no content type"} instead of the page`]
          : [
              gr.finalUrl !== at && `Googlebot is sent to ${gr.finalUrl}`,
              v.noindex && !g.noindex && "only a visitor gets noindex",
              canonOf(g, gr.finalUrl) !== canonOf(v, at) && `canonical: ${canonOf(v, at)} → ${canonOf(g, gr.finalUrl)}`,
              (g.title ?? "") !== (v.title ?? "") && `title: “${v.title ?? "none"}” → “${g.title ?? "none"}”`,
              v.words >= 50 && g.words < v.words / 2 && `${g.words} words for Googlebot, ${v.words} for a visitor`,
            ].filter(Boolean);
        if (diffs.length) add("googlebot-differs", at, diffs.join("; "));
      }),
    );
  return botCompared;
}

// The Googlebot comparison with AI search crawlers' user agents, on the home page and up to 2 more sample pages.
// Posing as another company's crawler counts as outside contact, so it needs --outside as well as --ai-bot-probe. An
// error or challenge the visitor didn't get is a decision (MAP-06): a firewall checking the vendor's IPs is right.
export async function aiBotProbe(site, { page, botSample, aiProbe: AI_PROBE, outside: OUTSIDE }) {
  const { add, notes, extra, follow } = site;
  const pageOf = r => readPage(r, page),
    askAgain = async (u, ua) => {
      await sleep(1000);
      return follow(u, ua);
    };
  // User agents as the vendors publish them; Anthropic names only the Claude-SearchBot token, so its string is built
  // around that.
  // https://developers.openai.com/api/docs/bots
  // https://docs.perplexity.ai/guides/bots
  // https://support.claude.com/en/articles/8896518
  const AI_PROBE_UAS = Object.fromEntries(BOTS.filter(b => b.probeUa).map(b => [b.name, b.probeUa])); // data/ai-bots.json
  if (AI_PROBE && !OUTSIDE)
    notes.push(
      "--ai-bot-probe runs only with outside checks on (--outside) and the owner's own yes: it asks a few pages again as OAI-SearchBot, Claude-SearchBot and PerplexityBot. It didn't run.",
    );
  else if (AI_PROBE)
    await Promise.all(
      botSample.slice(0, 3).map(async u => {
        const uas = Object.entries(AI_PROBE_UAS);
        let [vr, ...brs] = await Promise.all([follow(u, PHONE_UA), ...uas.map(([, ua]) => follow(u, ua))]);
        if (busy(vr)) vr = await askAgain(u, PHONE_UA);
        if (!pageOf(vr)) return; // the visitor didn't get the page either: nothing to compare
        const got = [];
        let fightMode = false;
        for (let [i, br] of brs.entries()) {
          if (busy(br)) br = await askAgain(u, uas[i][1]);
          // A 402 is Cloudflare's pay per crawl asking for payment, priced in crawler-price: paid access, not a refusal.
          // https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/use-pay-per-crawl-as-ai-owner/crawl-pages/
          if (br.status === 402) {
            const price = br.headers.get("crawler-price");
            (extra.aiBotPaid ??= []).push({
              url: vr.finalUrl,
              bot: uas[i][0],
              ...(price ? { price: price.slice(0, 100) } : {}),
            });
            continue;
          }
          // A Cloudflare challenge points to Bot Fight Mode, which custom firewall rules can't skip (sources at
          // ai-bot-refused in agents.mjs).
          const challenge = challenged(br) && !challenged(vr),
            cf =
              challenge &&
              (/^challenge$/i.test(br.headers.get("cf-mitigated") || "") ||
                /\/cdn-cgi\/challenge-platform\//.test(br.body || ""));
          fightMode ||= cf;
          if (challenge || br.status >= 400 || br.status === 0)
            got.push(
              `${uas[i][0]} got ${challenge ? `a ${cf ? "Cloudflare " : ""}bot challenge (${br.status})` : br.status || `no answer (${br.error})`}`,
            );
        }
        if (got.length)
          add(
            "ai-bot-refused",
            vr.finalUrl,
            `${got.join("; ")}, a visitor 200${fightMode ? ". Cloudflare's Bot Fight Mode is a likely cause: custom firewall rules can't make an exception to it" : ""}`,
          );
      }),
    );
}
