// Bing's AI preferences (AI-03), AI bot names, the training opt-out, log-scan's AI bots, Search Console's Lens data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import { AI_BOTS, bingAiRules } from "../skills/seo-supervisor/scripts/checks/agents.mjs";

const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const page = (title, head = "", body = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><header><nav><a href="/">Home</a></nav></header><main><h1>${title}</h1><p>${COPY}</p>${body}</main><footer>Leeds Heating Ltd</footer></body></html>`;
async function crawlSite(pages, { robots = "User-agent: *\nAllow: /\n", headers = {} } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), robots);
  const site = await serve(dir, { headers });
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://site.example",
      "--out",
      out,
    ]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const byPath = (r, check) =>
  Object.fromEntries((findingOf(r, check)?.evidence || []).map(e => [new URL(e.url).pathname, e.detail]));
const links = ["/a/", "/b/", "/c/", "/d/", "/e/", "/f/"].map(p => `<a href="${p}">Page ${p}</a>`).join(" ");

// ---------- Bing's AI preferences ----------
test("bingAiRules: Bing's rules from robots/bingbot meta tags and unprefixed or bingbot: header lines", () => {
  assert.deepEqual(bingAiRules(["noarchive"], []), { legacy: [{ rule: "noarchive", where: "meta" }], prefs: [] });
  assert.deepEqual(bingAiRules(["NoCache, ai-grounding: DisallowExtended"], []), {
    legacy: [{ rule: "nocache", where: "meta" }],
    prefs: [{ name: "ai-grounding", value: "disallowextended" }],
  });
  assert.deepEqual(bingAiRules([], ["bingbot: ai-training:disallow, noarchive"]), {
    legacy: [{ rule: "noarchive", where: "header" }],
    prefs: [{ name: "ai-training", value: "disallow" }],
  });
  assert.deepEqual(
    bingAiRules([], ["googlebot: noarchive", "otherbot: nocache"]),
    { legacy: [], prefs: [] },
    "rules for other crawlers aren't Bing's",
  );
  assert.deepEqual(bingAiRules([], ["noindex"]), { legacy: [], prefs: [] });
});

test("AI-03: indexable pages that still use noarchive or nocache need a decision; invalid ai-grounding/ai-training values are flagged", async () => {
  const r = await crawlSite(
    {
      "/": page("Boiler repairs and servicing in Leeds", "", links),
      "/a/": page("Boiler servicing prices", '<meta name="robots" content="noarchive">'),
      "/b/": page("Emergency plumber in Leeds", '<meta name="bingbot" content="noarchive, ai-grounding:disallow">'),
      "/c/": page(
        "Radiator repairs",
        '<meta name="Bingbot" content="ai-grounding:block, ai-training:disallowextended">',
      ),
      "/d/": page("Hot water faults"),
      "/e/": page("Gas safety checks"),
      "/f/": page("Old offers page", '<meta name="robots" content="noindex, noarchive">'),
    },
    { headers: { "/d/": { "X-Robots-Tag": "bingbot: nocache" }, "/e/": { "X-Robots-Tag": "googlebot: noarchive" } } },
  );
  const legacy = findingOf(r, "ai-legacy-noarchive");
  assert.deepEqual([legacy.rule, legacy.severity, legacy.count], ["AI-03", "needs-decision", 2]);
  assert.deepEqual(
    byPath(r, "ai-legacy-noarchive"),
    { "/a/": "noarchive in a meta tag", "/d/": "nocache in the X-Robots-Tag header" },
    "/b/ already has the new directive, /e/'s rule is Google's, /f/ isn't indexable",
  );
  assert.match(legacy.why, /1 Feb 2027/);
  assert.match(legacy.why, /1 Mar 2027/);
  assert.match(legacy.why, /Amazon/);
  assert.match(legacy.fix, /ai-grounding:disallow/);
  const bad = findingOf(r, "ai-preference-invalid");
  assert.deepEqual([bad.rule, bad.severity, bad.count], ["AI-03", "low", 1]);
  assert.deepEqual(byPath(r, "ai-preference-invalid"), { "/c/": "ai-grounding:block, ai-training:disallowextended" });
  assert.ok(!r.pages.find(p => new URL(p.url).pathname === "/").bingAi, "pages with no Bing rules carry nothing extra");
});

// ---------- Bot names, Applebot's Googlebot fallback, the shared training opt-out ----------
test("the robots table knows Apple, Amazon, DuckDuckGo, Mistral, Meta and Yandex bots, Applebot follows the Googlebot group, and the shared training opt-out is read", async () => {
  for (const name of [
    "Applebot",
    "Amazonbot",
    "Amzn-SearchBot",
    "Amzn-User",
    "DuckAssistBot",
    "MistralAI-Index",
    "MistralAI-Training",
    "MistralAI-User",
    "Meta-ExternalFetcher",
    "YandexAdditionalBot",
  ])
    assert.ok(
      AI_BOTS.some(b => b[0] === name),
      name,
    );
  assert.ok(
    !AI_BOTS.some(b => b[0] === "Claude-Agent"),
    "Anthropic doesn't say how robots.txt applies to it, so it's in the logs table only",
  );
  const robots = [
    "User-agent: Googlebot",
    "Disallow: /",
    "",
    "User-agent: *",
    "Allow: /",
    "",
    "User-agent: YandexAdditional",
    "Disallow: /",
    "",
    "User-agent: MistralAI-Training",
    "Disallow: /",
    "",
    "User-agent: __usage_ai-training",
    "Disallow: /",
    "",
  ].join("\n");
  const r = await crawlSite({ "/": page("Boiler repairs and servicing in Leeds") }, { robots });
  const bot = name => r.aiBots.find(b => b.bot === name);
  assert.deepEqual(
    bot("Applebot"),
    { bot: "Applebot", vendor: "Apple", kind: "search", robots: "blocked-by-googlebot" },
    "Apple: an unnamed Applebot follows the Googlebot rules",
  );
  assert.equal(bot("YandexAdditionalBot").robots, "blocked", "Yandex accepts either name");
  assert.equal(bot("MistralAI-Training").robots, "blocked");
  assert.equal(bot("MistralAI-Index").robots, "allowed");
  assert.deepEqual([bot("Amzn-User").mayIgnore, bot("Meta-ExternalFetcher").mayIgnore], [true, true]);
  assert.equal(r.trainingOptOut, "blocked");
  const plain = await crawlSite(
    { "/": page("Boiler repairs and servicing in Leeds") },
    { robots: "User-agent: *\nDisallow: /private/\n" },
  );
  assert.equal(plain.trainingOptOut, "not-set", "a * group doesn't cover the shared token");
  assert.equal(plain.aiBots.find(b => b.bot === "Applebot").robots, "allowed");
});

const render = async extra => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  writeFileSync(join(dir, "a.json"), JSON.stringify({ ...data, ...extra }));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};

test("the report shows the Googlebot fallback and the shared training opt-out, as information", async () => {
  const aiBots = [{ bot: "Applebot", vendor: "Apple", kind: "search", robots: "blocked-by-googlebot" }];
  const unset = await render({ aiBots, trainingOptOut: "not-set" });
  for (const s of [unset.html, unset.md]) {
    assert.ok(s.includes("Blocked by the Googlebot group"), "Applebot's status");
    assert.match(s, /__usage_ai-training/);
    assert.match(s, /not in robots\.txt/);
    assert.match(s, /group doesn(?:'|&#39;)t cover it/);
    assert.match(s, /Anthropic honours it since 30 Oct 2026/);
  }
  const set = await render({ aiBots, trainingOptOut: "blocked" });
  assert.match(set.html, /refuses AI training for the whole site/);
  const odd = await render({ aiBots, trainingOptOut: "<b>x</b>" });
  assert.doesNotMatch(odd.html + odd.md, /__usage_ai-training|<b>x/, "an unknown value shows nothing");
});

test("the report shows Google's brand split and Lens results on the Overview", async () => {
  const { html, md } = await render({
    brandSplit: { branded: { clicks: 80, impressions: 1200 }, nonBranded: { clicks: 75, impressions: 5000 } },
    searchTypes: { webMultimodal: { clicks: 6, impressions: 400, pages: {} } },
  });
  for (const s of [html, md]) {
    assert.ok(
      s.includes(
        "Brand searches, as Google labels them: 80 clicks · 1,200 impressions; other searches: 75 clicks · 5,000 impressions",
      ),
      "brand line",
    );
    assert.ok(s.includes("Google Lens and Circle to Search 6"), "the multimodal results join the other Google results");
  }
  const odd = await render({ brandSplit: { branded: { clicks: "<b>1</b>" } } });
  assert.doesNotMatch(odd.html + odd.md, /Brand searches/);
});

// ---------- log-scan: the AI bots and Google visits ----------
const line = (ip, ua, path, status, ref = "-", i = 0) =>
  `${ip} - - [12/Nov/2026:10:00:${String(i % 60).padStart(2, "0")} +0000] "GET ${path} HTTP/1.1" ${status} 100 "${ref}" "${ua}"`;
const BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";
async function scanLog(lines, extra = []) {
  const dir = tmp(),
    log = join(dir, "access.log"),
    out = join(dir, "log-scan.json");
  writeFileSync(log, lines.join("\n") + "\n");
  await node([join(SCRIPTS, "log-scan.mjs"), "--log", log, "--out", out, ...extra]);
  return JSON.parse(readFileSync(out, "utf8"));
}

test("log-scan names Claude-Agent and the Mistral, DuckDuckGo, Amazon and Meta bots, with their purposes", async () => {
  const UA = {
    "Claude-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-Agent/1.0) Chrome/154.0.0.0 Safari/537.36",
    "MistralAI-Index":
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-Index/1.0; +https://docs.mistral.ai/robots)",
    "MistralAI-Training":
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-Training/1.0; +https://docs.mistral.ai/robots)",
    "DuckAssistBot": "DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)",
    "Amzn-SearchBot":
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-SearchBot/0.1) Chrome/119.0.6045.214 Safari/537.36",
    "Amzn-User":
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-User/0.1) Chrome/119.0.6045.214 Safari/537.36",
    "Meta-ExternalFetcher":
      "meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/web-crawlers)",
  };
  const r = await scanLog(Object.values(UA).map((ua, i) => line("1.2.3.4", ua, "/", 200, "-", i)));
  const got = name => [r.bots[name]?.vendor, r.bots[name]?.group];
  assert.deepEqual(got("Claude-Agent"), ["Anthropic", "ai-search"]);
  assert.deepEqual(got("MistralAI-Index"), ["Mistral AI", "ai-search"]);
  assert.deepEqual(got("MistralAI-Training"), ["Mistral AI", "ai-training"]);
  assert.deepEqual(got("DuckAssistBot"), ["DuckDuckGo", "ai-search"]);
  assert.deepEqual(got("Amzn-SearchBot"), ["Amazon", "ai-search"]);
  assert.deepEqual(got("Amzn-User"), ["Amazon", "ai-search"]);
  assert.deepEqual(got("Meta-ExternalFetcher"), ["Meta", "ai-search"]);
  assert.equal(r.bots["Amazonbot"], undefined, "Amzn- user agents aren't Amazonbot");
  assert.ok(Object.keys(r.bots).length === 7, Object.keys(r.bots).join());
});

test("log-scan --verify-ips reads DuckDuckGo's and Mistral's lists, and says which bots have no list it can read", async () => {
  const lists = tmp(),
    list = p => JSON.stringify({ creationTime: "2026-09-01T12:44:58.000000", prefixes: [{ ipv4Prefix: p }] });
  writeFileSync(join(lists, "duckassistbot.json"), list("104.43.54.0/24"));
  writeFileSync(join(lists, "mistralai-index-ips.json"), list("135.225.57.92/32"));
  const r = await scanLog(
    [
      line("104.43.54.127", "DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)", "/", 200),
      line(
        "9.9.9.9",
        "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-Index/1.0; +https://docs.mistral.ai/robots)",
        "/",
        200,
      ),
      line(
        "1.2.3.4",
        "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-Agent/1.0) Chrome/154.0.0.0 Safari/537.36",
        "/",
        200,
      ),
    ],
    ["--verify-ips", lists],
  );
  assert.deepEqual(r.bots.DuckAssistBot.ipCheck, { verified: 1, other: 0, unknown: 0 });
  assert.deepEqual(r.bots["MistralAI-Index"].ipCheck, { verified: 0, other: 1, unknown: 0 });
  assert.ok(
    r.notes.some(n => /Claude-Agent/.test(n) && /claude\.com\/\.well-known\/sail/.test(n)),
    r.notes.join("\n"),
  );
});

test("log-scan counts visits from Google Search by landing page, from Google's documented referrers only", async () => {
  const r = await scanLog([
    line("5.5.5.1", BROWSER, "/pricing/", 200, "https://www.google.com/", 1),
    line("5.5.5.2", BROWSER, "/pricing/?utm_source=x", 200, "https://www.google.co.uk/", 2),
    line(
      "5.5.5.3",
      BROWSER,
      "/guide/",
      200,
      "android-app://com.google.android.googlequicksearchbox/https/www.google.com",
      3,
    ),
    line("5.5.5.4", BROWSER, "/images/boiler.jpg", 200, "https://www.google.com/", 4),
    line("5.5.5.5", BROWSER, "/x/", 200, "https://mail.google.com/", 5),
    line("5.5.5.6", BROWSER, "/old/", 301, "https://www.google.com/", 6),
    line("5.5.5.7", BROWSER, "/y/", 200, "https://www.google.evil.example/", 7),
    line("5.5.5.8", BROWSER, "/z/", 200, "https://google.com.br/", 8),
  ]);
  assert.deepEqual(
    r.googleReferrals,
    {
      visits: 4,
      topPages: [
        { path: "/pricing/", visits: 2 },
        { path: "/guide/", visits: 1 },
        { path: "/z/", visits: 1 },
      ],
    },
    "images and files, Gmail, redirects and look-alike hosts aren't Google Search landings",
  );
  const none = await scanLog([line("5.5.5.1", BROWSER, "/", 200)]);
  assert.equal(none.googleReferrals, null);
  assert.ok(
    none.notes.some(n => /No visits with a Google Search referrer/.test(n)),
    none.notes.join("\n"),
  );
});
