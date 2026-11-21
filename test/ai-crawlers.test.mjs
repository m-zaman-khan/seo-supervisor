import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import {
  AI_BOTS,
  agentFeatures,
  agentFiles,
  signalPlacement,
} from "../skills/seo-supervisor/scripts/checks/agents.mjs";
import { agenticFlag, runLighthouse, takeAgentic } from "../skills/seo-supervisor/scripts/checks/lighthouse.mjs";

const ORIGIN = "https://site.example";
const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const page = (title, body = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><header><nav><a href="/">Home</a> <a href="/about/">About</a></nav></header><main><h1>${title}</h1><p>${COPY}</p>${body}</main><footer>Leeds Heating Ltd</footer></body></html>`;

async function crawlSite(pages, { robots = "User-agent: *\nAllow: /\n", args = [], env, ...serveOpts } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), robots);
  const site = await serve(dir, serveOpts);
  const origin = args.includes("--site-origin") ? [] : ["--site-origin", ORIGIN];
  try {
    await node(
      [join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, ...origin, "--out", out, ...args],
      env ? { env } : {},
    );
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const details = (r, check) => (findingOf(r, check)?.evidence || []).map(e => e.detail);
const PAGES = {
  "/": page("Boiler repairs and servicing in Leeds", '<button type="button">Book a visit</button>'),
  "/about/": page("About our Leeds heating engineers"),
};

test("an ordinary site raises none of these checks or notes, and every AI bot is allowed", async () => {
  const r = await crawlSite(PAGES);
  for (const key of ["click-only-elements", "content-signal-placement", "ai-bot-refused"])
    assert.ok(!findingOf(r, key), key);
  assert.ok(!r.notes.some(n => /ai-bot-probe/.test(n)), r.notes.join("\n"));
  assert.equal(r.landmarks, undefined, "every page has main, nav, header and footer");
  assert.equal(r.aiBots.length, AI_BOTS.length);
  assert.ok(
    r.aiBots.every(b => b.robots === "allowed"),
    JSON.stringify(r.aiBots),
  );
});

test("each AI bot is allowed, blocked or blocked only by User-agent: *, and misplaced Content-Signal lines are flagged", async () => {
  const robots = [
    "Content-Signal: ai-train=no",
    "User-agent: *",
    "Content-Signal: search=yes, ai-train=no",
    "Disallow: /",
    "",
    "User-agent: OAI-SearchBot",
    "User-agent: PerplexityBot",
    "Allow: /",
    "",
    "User-agent: ClaudeBot",
    "Disallow: /",
    "",
  ].join("\n");
  const r = await crawlSite(PAGES, { robots });
  const bot = name => r.aiBots.find(b => b.bot === name);
  assert.deepEqual(bot("OAI-SearchBot"), { bot: "OAI-SearchBot", vendor: "OpenAI", kind: "search", robots: "allowed" });
  assert.equal(bot("ClaudeBot").robots, "blocked");
  assert.equal(bot("GPTBot").robots, "blocked-by-star", "no group of its own, so the * group applies");
  assert.deepEqual([bot("ChatGPT-User").robots, bot("ChatGPT-User").mayIgnore], ["blocked-by-star", true]);
  const f = findingOf(r, "content-signal-placement");
  assert.deepEqual([f.rule, f.severity], ["MAP-06", "low"]);
  assert.deepEqual(
    details(r, "content-signal-placement"),
    [
      "line 1: Content-Signal comes before any User-agent line, so it belongs to no group",
      "the User-agent: OAI-SearchBot, PerplexityBot group has no Content-Signal line, though other groups do",
    ],
    "the blocked ClaudeBot group needs none",
  );
});

test("Content-Signal placement, line by line", () => {
  const blocks = g => g.rules.some(x => !x.allow && x.path === "/");
  assert.deepEqual(signalPlacement("User-agent: *\nAllow: /\n", blocks), [], "no signal anywhere is fine");
  assert.deepEqual(
    signalPlacement("User-agent: *\nContent-Signal: search=yes\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n", blocks),
    [],
    "Cloudflare's layout: signal in *, blocked bots without",
  );
  assert.deepEqual(
    signalPlacement("User-agent: a\nContent-Signal: search=yes\nUser-agent: b\nAllow: /\n", blocks),
    [],
    "a signal between two user-agent lines covers the whole group",
  );
  assert.deepEqual(signalPlacement("# policy\nContent-Signal: search=yes\n", blocks), [
    "line 2: Content-Signal comes before any User-agent line, so it belongs to no group",
  ]);
});

test("click-only elements and missing landmarks", () => {
  const f =
    agentFeatures(`<html><body><main><div class="buy" onclick="go()">Buy</div><tr onclick="row()"><td>1</td></tr>
    <span onclick="x()" role="button" tabindex="0">OK</span><a href="#" onclick="y()">Link</a><button onclick="z()">B</button>
    <div hidden><div onclick="never()">Hidden</div></div><script>el.innerHTML = '<div onclick="s()">'</script></main>
    <div role="navigation"><a href="/">Home</a></div></body></html>`);
  assert.deepEqual(f.clickOnly, ['<div class="buy">', "<tr>"]);
  assert.deepEqual(f.landmarksMissing, ["header", "footer"], "role=navigation counts as nav");
  const plain = agentFeatures(page("Plain page", "<button>Go</button>"));
  assert.deepEqual([plain.clickOnly, plain.landmarksMissing], [[], []]);
});

test("the crawl flags click-only elements (AI-05) and lists pages without landmarks", async () => {
  const bare = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gas safety checks in Leeds</title></head><body><h1>Gas safety checks in Leeds</h1><p>${COPY}</p><div class="cta" onclick="book()">Book now</div></body></html>`;
  const r = await crawlSite({
    ...PAGES,
    "/about/": page("About our Leeds heating engineers", '<a href="/gas/">Gas safety checks</a>'),
    "/gas/": bare,
  });
  const f = findingOf(r, "click-only-elements");
  assert.deepEqual([f.rule, f.severity, f.count], ["AI-05", "low", 1]);
  assert.match(f.evidence[0].detail, /1 element.*<div class="cta">/);
  assert.equal(r.landmarks.checked, 3);
  assert.deepEqual(
    r.landmarks.pages.map(p => [new URL(p.url).pathname, p.missing]),
    [["/gas/", ["main", "nav", "header", "footer"]]],
  );
});

test("OAuth protected-resource and authorization-server files are listed when they parse", async () => {
  const files = {
    "/.well-known/oauth-protected-resource": { resource: "https://api.example" },
    "/.well-known/oauth-authorization-server": { issuer: "https://auth.example" },
  };
  const fetchFn = async u => {
    const p = new URL(u).pathname;
    return files[p] ? new Response(JSON.stringify(files[p])) : new Response("<!doctype html><p>Not here</p>");
  };
  assert.deepEqual((await agentFiles(fetchFn, "https://shop.example")).wellKnown, [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
  ]);
  const soft = async () => new Response(JSON.stringify({ name: "x" }));
  assert.ok(
    !(await agentFiles(soft, "https://shop.example")).wellKnown.some(p => /oauth/.test(p)),
    "a JSON file without resource or issuer doesn't count",
  );
});

test("the AI crawler probe runs only with --outside and --ai-bot-probe, and flags a refused AI crawler", async () => {
  const seen = new Set();
  const before = (req, res) => {
    const ua = req.headers["user-agent"] || "";
    for (const t of ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"]) if (ua.includes(t)) seen.add(t);
    if (ua.includes("PerplexityBot")) {
      res.writeHead(403, { "Content-Type": "text/html" }).end("<!doctype html><title>Forbidden</title>");
      return true;
    }
    return false;
  };
  const outside = [
      "--site-origin",
      "https://site.test",
      "--outside",
      "--psi-endpoint",
      "http://127.0.0.1:9/runPagespeed",
    ],
    env = { ...process.env, CHROME_PATH: process.execPath };
  const off = await crawlSite(PAGES, { args: outside, env, before });
  assert.equal(seen.size, 0, "no AI user agent without --ai-bot-probe");
  assert.ok(!findingOf(off, "ai-bot-refused"));
  const noOutside = await crawlSite(PAGES, { args: ["--ai-bot-probe"], before });
  assert.equal(seen.size, 0, "nor without --outside");
  assert.ok(
    noOutside.notes.some(n => /--ai-bot-probe runs only with outside checks on/.test(n)),
    noOutside.notes.join("\n"),
  );
  const on = await crawlSite(PAGES, { args: [...outside, "--ai-bot-probe"], env, before });
  assert.deepEqual([...seen].sort(), ["Claude-SearchBot", "OAI-SearchBot", "PerplexityBot"]);
  const f = findingOf(on, "ai-bot-refused");
  assert.deepEqual([f.rule, f.severity, f.count], ["MAP-06", "needs-decision", 2]);
  assert.ok(
    f.evidence.every(e => e.detail === "PerplexityBot got 403, a visitor 200"),
    JSON.stringify(f.evidence),
  );
});

// ---------- log-scan ----------
const logLine = (ip, ua, path, status, i = 0) =>
  `${ip} - - [12/Nov/2026:10:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")} +0000] "GET ${path} HTTP/1.1" ${status} 100 "-" "${ua}"`;
const AIUA = {
  search:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot",
  pplx: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  ads: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-AdsBot/1.0; +https://openai.com/adsbot",
  vertex: "Mozilla/5.0 (compatible; Google-CloudVertexBot)",
  agent:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36 (compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)",
  notebook:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 (compatible; Google-GeminiNotebook; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-gemininotebook)",
  messages: "GoogleMessages",
};
async function scanLog(lines, extra = []) {
  const dir = tmp(),
    log = join(dir, "access.log"),
    out = join(dir, "log-scan.json");
  writeFileSync(log, lines.join("\n") + "\n");
  await node([join(SCRIPTS, "log-scan.mjs"), "--log", log, "--out", out, ...extra]);
  return JSON.parse(readFileSync(out, "utf8"));
}
const LOG = [
  ...Array.from({ length: 6 }, (_, i) => logLine("20.0.0.5", AIUA.search, "/pricing/", 403, i)),
  ...Array.from({ length: 4 }, (_, i) => logLine("198.51.100.1", AIUA.search, "/pricing/", 403, 10 + i)),
  ...Array.from({ length: 6 }, (_, i) => logLine("198.51.100.2", AIUA.pplx, "/", 403, 20 + i)),
  logLine("20.0.0.9", AIUA.ads, "/landing/", 200, 30),
  logLine("::ffff:20.0.0.6", AIUA.search, "/", 200, 31),
  logLine("1.2.3.4", AIUA.vertex, "/", 200, 32),
  logLine("1.2.3.4", AIUA.agent, "/", 200, 33),
  logLine("1.2.3.4", AIUA.notebook, "/", 200, 34),
  logLine("1.2.3.4", AIUA.messages, "/", 200, 35),
  JSON.stringify({
    time: "2026-11-12T10:01:00Z",
    path: "/",
    status: 200,
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    ip: "2001:db8::1",
  }),
];

test("log-scan names OAI-AdsBot and Google's Vertex, Agent, Gemini Notebook and Messages fetchers", async () => {
  const r = await scanLog(LOG);
  const got = name => [r.bots[name]?.vendor, r.bots[name]?.group];
  assert.deepEqual(got("OAI-AdsBot"), ["OpenAI", "other"]);
  assert.deepEqual(got("Google-CloudVertexBot"), ["Google", "other"]);
  assert.deepEqual(got("Google-Agent"), ["Google", "ai-search"]);
  assert.deepEqual(got("Google-GeminiNotebook"), ["Google", "ai-search"]);
  assert.deepEqual(got("GoogleMessages"), ["Google", "other"]);
  assert.equal(r.bots.Googlebot.requests, 1, "Google-Agent's phone user agent isn't counted as Googlebot");
  assert.equal(r.bots["OAI-SearchBot"].ipCheck, undefined, "no IP check without --verify-ips");
  assert.deepEqual(
    details(r, "ai-bots-blocked-in-practice")
      .map(d => d.split(":")[0])
      .sort(),
    ["OAI-SearchBot", "PerplexityBot"],
  );
  assert.ok(
    r.notes.some(n => /--verify-ips/.test(n)),
    "the spoofing note points at --verify-ips",
  );
});

test("--verify-ips checks bot requests against the vendors' published lists, and refusals count only real crawlers", async () => {
  const lists = tmp(),
    list = (...p) =>
      JSON.stringify({
        creationTime: "2026-11-20T00:00:00Z",
        prefixes: p.map(x => (x.includes(":") ? { ipv6Prefix: x } : { ipv4Prefix: x })),
      });
  writeFileSync(join(lists, "searchbot.json"), list("20.0.0.0/24"));
  writeFileSync(join(lists, "perplexitybot.json"), list("30.0.0.0/24"));
  writeFileSync(join(lists, "common-crawlers.json"), list("66.249.64.0/27", "2001:db8::/32"));
  const r = await scanLog(LOG, ["--verify-ips", lists]);
  assert.deepEqual(
    r.bots["OAI-SearchBot"].ipCheck,
    { verified: 7, other: 4, unknown: 0 },
    "an IPv4-mapped IPv6 address counts as its IPv4 one",
  );
  assert.deepEqual(r.bots.Googlebot.ipCheck, { verified: 1, other: 0, unknown: 0 }, "a JSON line's ip field, IPv6");
  assert.deepEqual(r.bots.PerplexityBot.ipCheck, { verified: 0, other: 6, unknown: 0 });
  assert.equal(r.bots["OAI-AdsBot"].ipCheck, undefined, "its list wasn't in the folder, so it isn't checked");
  const refused = details(r, "ai-bots-blocked-in-practice");
  assert.deepEqual(
    refused,
    ["OAI-SearchBot: 6 of 7 requests from OpenAI's addresses (85.7%) refused with 403 or 401"],
    "PerplexityBot's refusals all came from other addresses",
  );
  assert.ok(
    r.notes.some(
      n =>
        /outside the vendor's published list/.test(n) &&
        /PerplexityBot 6 of 6/.test(n) &&
        /OAI-SearchBot 4 of 11/.test(n),
    ),
    r.notes.join("\n"),
  );
});

// ---------- Lighthouse ----------
const LHR = {
  categories: {
    performance: { title: "Performance", score: 0.9, auditRefs: [{ id: "cumulative-layout-shift", weight: 25 }] },
    seo: { title: "SEO", score: 1, auditRefs: [] },
    accessibility: { title: "Accessibility", score: 1, auditRefs: [] },
    "best-practices": { title: "Best Practices", score: 1, auditRefs: [] },
    "agentic-browsing": {
      title: "Agentic Browsing",
      score: 0.5,
      auditRefs: [
        "agent-accessibility-tree",
        "webmcp-form-coverage",
        "webmcp-registered-tools",
        "webmcp-schema-validity",
        "cumulative-layout-shift",
        "llms-txt",
        "ard-schema",
      ].map(id => ({ id, weight: 1 })),
    },
  },
  audits: {
    "cumulative-layout-shift": {
      title: "Cumulative Layout Shift",
      score: 1,
      scoreDisplayMode: "numeric",
      numericValue: 0.01,
    },
    "agent-accessibility-tree": {
      title: "Accessibility tree is not well-formed",
      score: 0,
      scoreDisplayMode: "binary",
    },
    "webmcp-form-coverage": { title: "Forms have WebMCP tools", score: null, scoreDisplayMode: "notApplicable" },
    "webmcp-registered-tools": { title: "Registered WebMCP tools", score: null, scoreDisplayMode: "notApplicable" },
    "webmcp-schema-validity": { title: "WebMCP schemas are valid", score: null, scoreDisplayMode: "notApplicable" },
    "llms-txt": { title: "llms.txt follows recommendations", score: 1, scoreDisplayMode: "notApplicable" },
    "ard-schema": { title: "Agent resource discovery file is valid", score: 0, scoreDisplayMode: "error" },
  },
};
// A stand-in Lighthouse laid out as npm installs it (node_modules/lighthouse/package.json), at a given version.
function fakeLighthouse(version) {
  const dir = join(tmp(), "node_modules", "lighthouse"),
    bin = join(dir, "cli", "index.mjs"),
    log = join(dir, "calls.jsonl");
  mkdirSync(join(dir, "cli"), { recursive: true });
  if (version) writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "lighthouse", version }));
  writeFileSync(
    bin,
    `import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
const lhr = ${JSON.stringify(LHR)}, only = args.find(a => a.startsWith("--only-categories=")).slice(18).split(",");
for (const id of Object.keys(lhr.categories)) if (!only.includes(id)) delete lhr.categories[id];
writeFileSync(args.find(a => a.startsWith("--output-path=")).slice(14), JSON.stringify(lhr));
`,
  );
  return { bin, args: () => JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0]) };
}

test("the Agentic browsing category is asked for only from Lighthouse 13.3 on", () => {
  assert.equal(agenticFlag(fakeLighthouse("13.6.0").bin), ",agentic-browsing");
  assert.equal(agenticFlag(fakeLighthouse("14.0.1").bin), ",agentic-browsing");
  assert.equal(agenticFlag(fakeLighthouse("13.2.0").bin), "", "an older Lighthouse refuses an unknown category");
  assert.equal(agenticFlag(fakeLighthouse(null).bin), "", "unknown version");
});

test("takeAgentic counts checks as Lighthouse does and takes the category out of the scored ones", () => {
  const lhr = structuredClone(LHR);
  assert.deepEqual(takeAgentic(lhr), {
    passed: 1,
    total: 3,
    failed: [
      { id: "agent-accessibility-tree", title: "Accessibility tree is not well-formed" },
      { id: "ard-schema", title: "Agent resource discovery file is valid" },
    ],
  });
  assert.equal(lhr.categories["agentic-browsing"], undefined);
  assert.equal(takeAgentic({ categories: {}, audits: {} }), null);
});

test("a Lighthouse 13.6 run reports the category on its own, and the four scored categories are as before", async () => {
  const lh = fakeLighthouse("13.6.0");
  const r = await runLighthouse(lh.bin, "http://127.0.0.1:1/");
  assert.ok(
    lh.args().includes("--only-categories=performance,seo,accessibility,best-practices,agentic-browsing"),
    lh.args().join(" "),
  );
  assert.deepEqual(r.agentic, {
    passed: 1,
    total: 3,
    failed: [
      { id: "agent-accessibility-tree", title: "Accessibility tree is not well-formed" },
      { id: "ard-schema", title: "Agent resource discovery file is valid" },
    ],
  });
  assert.deepEqual(Object.keys(r.scores), ["performance", "seo", "accessibility", "bestPractices"]);
  assert.ok(
    ![...r.failed, ...r.detail].some(a => /agent|ard|webmcp/.test(a.id)),
    "agentic audits aren't among the costliest failed audits",
  );
  const old = fakeLighthouse("13.2.0"),
    o = await runLighthouse(old.bin, "http://127.0.0.1:1/");
  assert.ok(old.args().includes("--only-categories=performance,seo,accessibility,best-practices"));
  assert.equal(o.agentic, undefined);
});

// ---------- report ----------
const renderReport = async data => {
  const dir = tmp();
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};

test("the AI panel shows the bot table, landmarks and Lighthouse's agentic checks, escaped, and never changes the score", async () => {
  const evil = "<img src=x onerror=alert(1)>";
  const base = {
    site: { name: "Site", url: ORIGIN },
    run: { date: "2026-11-21" },
    findings: [],
    passed: [{ rule: "AI-05", title: "Pages work for AI agents that browse", category: "AI search" }],
  };
  const data = {
    ...base,
    aiBots: [
      { bot: "GPTBot", vendor: "OpenAI", kind: "training", robots: "blocked-by-star" },
      { bot: "ChatGPT-User", vendor: "OpenAI", kind: "user", robots: "allowed", mayIgnore: true },
      { bot: evil, vendor: evil, kind: "search", robots: "blocked" },
    ],
    landmarks: { checked: 4, count: 1, pages: [{ url: `${ORIGIN}/gas/${evil}`, missing: ["main", "nav"] }] },
    lighthouse: [
      {
        url: `${ORIGIN}/`,
        scores: {},
        metrics: {},
        failed: [],
        detail: [],
        agentic: {
          passed: 1,
          total: 3,
          failed: [{ id: "agent-accessibility-tree", title: `Accessibility tree ${evil}` }],
        },
      },
    ],
  };
  const withAi = await renderReport(data),
    without = await renderReport({ ...base, lighthouse: [{ ...data.lighthouse[0], agentic: undefined }] });
  const panel = withAi.html.match(/\n {4}<details class="how aibots">[\s\S]*?<\/details>(?=\n|$)/)?.[0];
  assert.ok(panel, "an AI crawlers panel");
  assert.equal(
    withAi.html.replace(panel, ""),
    without.html,
    "the panel is the only change: the score and areas are the same",
  );
  assert.ok(
    panel.includes("Blocked by <code>User-agent: *</code>") &&
      panel.includes("may ignore robots.txt") &&
      panel.includes("1 of 3 checks passed"),
    panel,
  );
  assert.ok(panel.includes("<code>/gas/") && panel.includes("main, nav"), panel);
  assert.ok(
    !withAi.html.includes("<img src=x") && withAi.html.includes("&lt;img src=x onerror=alert(1)&gt;"),
    "crawled and Lighthouse text is escaped",
  );
  const section = withAi.md.match(/## AI crawlers and agents\n[\s\S]*?\n\n(?=## |$)/)?.[0];
  assert.ok(section && section.includes("| GPTBot | OpenAI |"), withAi.md);
  assert.equal(withAi.md.replace(section, ""), without.md);
  assert.ok(!/(^|[^\\])<img src=x/m.test(withAi.md));
  assert.equal(without.html.includes('class="how aibots"'), false, "nothing without the data");
});
