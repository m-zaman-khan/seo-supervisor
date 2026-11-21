// Contradicting AI crawler rules, aipref Content-Usage lines, Cloudflare's block and the --ai-bot-probe messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { aiRobots } from "../skills/seo-supervisor/scripts/checks/agents.mjs";

const ORIGIN = "https://site.example";
const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const page = title =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><header><nav><a href="/">Home</a> <a href="/about/">About</a></nav></header><main><h1>${title}</h1><p>${COPY}</p></main><footer>Leeds Heating Ltd</footer></body></html>`;
const PAGES = {
  "/": page("Boiler repairs and servicing in Leeds"),
  "/about/": page("About our Leeds heating engineers"),
};
async function crawlSite({ robots = "User-agent: *\nAllow: /\n", args = [], env, ...serveOpts } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(PAGES)) {
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

// Longest match wins and a tie goes to Allow, as the crawler's reader does for plain paths.
// https://www.rfc-editor.org/rfc/rfc9309#section-2.2.2
const allowed = (g, path) => {
  let best = null;
  for (const r of g.rules)
    if (
      r.path &&
      path.startsWith(r.path) &&
      (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))
    )
      best = r;
  return !best || best.allow;
};
const conflicts = txt => aiRobots(txt, allowed).conflicts;
const lines = (...l) => l.join("\n") + "\n";

// ---------- Contradicting AI crawler rules ----------
test("clean robots.txt files raise no contradiction: blocking training while allowing search is a policy", () => {
  const clean = {
    "plain": lines("User-agent: *", "Allow: /"),
    "no robots rules for AI at all": lines(
      "User-agent: *",
      "Disallow: /admin/",
      "",
      "Sitemap: https://site.example/sitemap.xml",
    ),
    "training out, search and user fetchers in": lines(
      "User-agent: GPTBot",
      "User-agent: ClaudeBot",
      "User-agent: Google-Extended",
      "Disallow: /",
      "",
      "User-agent: *",
      "Allow: /",
    ),
    "shared opt-out with the training crawlers blocked by name": lines(
      "User-agent: __usage_ai-training",
      "Disallow: /",
      "",
      "User-agent: GPTBot",
      "User-agent: ClaudeBot",
      "Disallow: /",
      "",
      "User-agent: OAI-SearchBot",
      "User-agent: ChatGPT-User",
      "Allow: /",
    ),
    "Cloudflare's layout: the signal in *, blocked training bots without": lines(
      "User-agent: *",
      "Content-Signal: search=yes, ai-train=no",
      "Allow: /",
      "",
      "User-agent: GPTBot",
      "User-agent: CCBot",
      "Disallow: /",
    ),
    "a signal copied into a blocked training group agrees with it": lines(
      "User-agent: GPTBot",
      "Content-Signal: search=yes, ai-train=no",
      "Disallow: /",
      "",
      "User-agent: *",
      "Content-Signal: search=yes, ai-train=no",
      "Allow: /",
    ),
    "search crawlers say search=yes, everyone else no training": lines(
      "User-agent: OAI-SearchBot",
      "User-agent: Claude-SearchBot",
      "Content-Signal: search=yes, ai-input=yes",
      "Allow: /",
      "",
      "User-agent: *",
      "Content-Signal: ai-train=no",
      "Disallow: /private/",
    ),
    "search and user fetcher of one vendor both blocked": lines(
      "User-agent: PerplexityBot",
      "User-agent: Perplexity-User",
      "Disallow: /",
      "",
      "User-agent: *",
      "Allow: /",
    ),
    "everything blocked alike": lines("User-agent: *", "Disallow: /"),
    "the copy-ready file in rules/ai-search.md": lines(
      "User-agent: OAI-SearchBot",
      "User-agent: Claude-SearchBot",
      "User-agent: PerplexityBot",
      "User-agent: ChatGPT-User",
      "User-agent: Claude-User",
      "User-agent: Perplexity-User",
      "Content-Signal: search=yes, ai-input=yes, ai-train=no",
      "Disallow: /search/",
      "",
      "User-agent: GPTBot",
      "User-agent: ClaudeBot",
      "User-agent: Google-Extended",
      "User-agent: Applebot-Extended",
      "User-agent: CCBot",
      "Disallow: /",
      "",
      "User-agent: *",
      "Content-Signal: search=yes, ai-input=yes, ai-train=no",
      "Disallow: /search/",
    ),
    "shared opt-out and ai-train=no agree": lines(
      "User-agent: __usage_ai-training",
      "Disallow: /",
      "",
      "User-agent: *",
      "Content-Signal: search=yes, ai-train=no",
      "Allow: /",
    ),
    "a path-scoped yes on an open path": lines(
      "User-agent: *",
      "Content-Signal: /blog/ search=yes, ai-train=yes",
      "Disallow: /admin/",
    ),
    "the same signal repeated in Cloudflare's block and the site's own": lines(
      "User-agent: *",
      "Content-Signal: search=yes,ai-train=no",
      "Allow: /",
      "",
      "User-agent: *",
      "Content-Signal: ai-train=no",
      "Disallow: /wp-admin/",
    ),
  };
  for (const [name, txt] of Object.entries(clean)) assert.deepEqual(conflicts(txt), [], name);
});

test("a vendor's search crawler and its user fetcher getting opposite rules is named, either way round", () => {
  assert.deepEqual(conflicts(lines("User-agent: OAI-SearchBot", "Allow: /", "", "User-agent: *", "Disallow: /")), [
    "OAI-SearchBot, OpenAI's AI search crawler, is allowed, but ChatGPT-User, which fetches pages a person asks OpenAI's assistant for, is blocked by the `User-agent: *` group.",
  ]);
  assert.deepEqual(conflicts(lines("User-agent: Claude-SearchBot", "Disallow: /", "", "User-agent: *", "Allow: /")), [
    "Claude-User, which fetches pages a person asks Anthropic's assistant for, is allowed, but Claude-SearchBot, Anthropic's AI search crawler, is blocked by its own group.",
  ]);
});

test("a Content-Signal line that says the opposite of its group's Allow and Disallow lines is named", () => {
  assert.deepEqual(conflicts(lines("User-agent: *", "Content-Signal: search=yes, ai-train=no", "Disallow: /")), [
    "The `User-agent: *` group's Content-Signal line says search=yes, but its Disallow lines keep those crawlers out of the whole site.",
  ]);
  assert.deepEqual(
    conflicts(
      lines("User-agent: GPTBot", "Content-Signal: ai-train=yes", "Disallow: /", "", "User-agent: *", "Allow: /"),
    ),
    [
      "The `User-agent: GPTBot` group's Content-Signal line says ai-train=yes, but its Disallow lines keep those crawlers out of the whole site.",
    ],
  );
  assert.deepEqual(conflicts(lines("User-agent: *", "Content-Signal: /blog/ search=yes", "Disallow: /blog/")), [
    "The `User-agent: *` group's Content-Signal line says search=yes for /blog/, but its Disallow lines keep those crawlers out of /blog/.",
  ]);
  assert.deepEqual(
    conflicts(
      lines(
        "User-agent: GPTBot",
        "User-agent: ClaudeBot",
        "Content-Signal: ai-train=no",
        "Allow: /",
        "",
        "User-agent: *",
        "Allow: /",
      ),
    ),
    [
      "The `User-agent: GPTBot, ClaudeBot` group lets its crawlers in, but its Content-Signal line says ai-train=no, though these are AI training crawlers.",
    ],
  );
  assert.deepEqual(
    conflicts(
      lines("User-agent: OAI-SearchBot", "Content-Signal: search=no", "Allow: /", "", "User-agent: *", "Allow: /"),
    ),
    [
      "The `User-agent: OAI-SearchBot` group lets its crawlers in, but its Content-Signal line says search=no, though these are AI search crawlers.",
    ],
  );
  assert.deepEqual(
    conflicts(
      lines(
        "User-agent: *",
        "Content-Signal: search=yes, ai-train=no",
        "Allow: /",
        "",
        "User-agent: *",
        "Content-Signal: ai-train=yes",
      ),
    ),
    ["The `User-agent: *` group says ai-train=no in one Content-Signal line and ai-train=yes in another."],
    "two * groups are one group to a crawler",
  );
});

test("the shared training opt-out against a training crawler's own Allow, or against a Content-Signal line, is named", () => {
  assert.deepEqual(
    conflicts(
      lines(
        "User-agent: __usage_ai-training",
        "Disallow: /",
        "",
        "User-agent: ClaudeBot",
        "User-agent: GPTBot",
        "Allow: /",
        "",
        "User-agent: *",
        "Allow: /",
      ),
    ),
    [
      "The shared AI-training opt-out (`User-agent: __usage_ai-training`) refuses training for the whole site, but GPTBot and ClaudeBot have their own groups that let them in. A crawler's own group can win over the shared one: Anthropic says it follows rules that name ClaudeBot first.",
    ],
  );
  assert.deepEqual(
    conflicts(
      lines(
        "User-agent: __usage_ai-training",
        "Disallow: /",
        "",
        "User-agent: *",
        "Content-Signal: ai-train=yes",
        "Allow: /",
      ),
    ),
    [
      "The shared AI-training opt-out (`User-agent: __usage_ai-training`) refuses training for the whole site, but the Content-Signal line in the `User-agent: *` group says ai-train=yes.",
    ],
  );
  assert.deepEqual(
    conflicts(
      lines(
        "User-agent: __usage_ai-training",
        "Allow: /",
        "",
        "User-agent: *",
        "Content-Signal: ai-train=no",
        "Allow: /",
      ),
    ),
    [
      "The shared AI-training opt-out (`User-agent: __usage_ai-training`) allows training for the whole site, but the Content-Signal line in the `User-agent: *` group says ai-train=no.",
    ],
  );
});

test("Content-Usage lines are kept as written, with their group", () => {
  const { usage } = aiRobots(
    lines(
      "Content-Usage: train-ai=n",
      "User-agent: *",
      "Content-Usage: train-ai=n, search=y # our policy",
      "Allow: /",
      "",
      "User-agent: GPTBot",
      "Content-Usage: /blog/ train-ai=y",
      "Disallow: /private/",
    ),
    allowed,
  );
  assert.deepEqual(usage, [
    { agents: null, rule: "train-ai=n" },
    { agents: "*", rule: "train-ai=n, search=y" },
    { agents: "GPTBot", rule: "/blog/ train-ai=y" },
  ]);
});

test("the crawl reports contradictions as ai-robots-conflict (MAP-06), and lists Content-Usage lines and Cloudflare's sync block", async () => {
  const robots = lines(
    "# BEGIN Cloudflare Bot Preference Sync",
    "User-agent: GPTBot",
    "Disallow: /",
    "# END Cloudflare Bot Preference Sync",
    "",
    "User-agent: OAI-SearchBot",
    "Allow: /",
    "",
    "User-agent: ChatGPT-User",
    "Disallow: /",
    "",
    "User-agent: *",
    "Content-Usage: train-ai=n",
    "Allow: /",
  );
  const r = await crawlSite({ robots });
  const f = findingOf(r, "ai-robots-conflict");
  assert.deepEqual([f.rule, f.severity, f.count], ["MAP-06", "needs-decision", 1]);
  assert.match(f.evidence[0].detail, /^OAI-SearchBot, OpenAI's AI search crawler, is allowed, but ChatGPT-User/);
  assert.equal(new URL(f.evidence[0].url).pathname, "/robots.txt");
  assert.match(f.why, /valid policy/);
  assert.deepEqual(r.contentUsage, [{ agents: "*", rule: "train-ai=n" }]);
  assert.equal(r.botPreferenceSync, true);
  const plain = await crawlSite();
  assert.ok(!findingOf(plain, "ai-robots-conflict"));
  assert.deepEqual([plain.contentUsage, plain.botPreferenceSync], [undefined, undefined]);
});

// ---------- Probe messages ----------
test("the AI crawler probe reports a 402 as paid access, and names Bot Fight Mode for a Cloudflare challenge", async () => {
  const before = (req, res) => {
    const ua = req.headers["user-agent"] || "";
    if (ua.includes("OAI-SearchBot")) {
      res.writeHead(402, { "Content-Type": "text/plain", "crawler-price": "USD 0.01" }).end("Payment required");
      return true;
    }
    if (ua.includes("PerplexityBot")) {
      res
        .writeHead(403, { "Content-Type": "text/html", "cf-mitigated": "challenge" })
        .end("<!doctype html><title>Just a moment...</title>");
      return true;
    }
    return false;
  };
  const args = [
    "--site-origin",
    "https://site.test",
    "--outside",
    "--psi-endpoint",
    "http://127.0.0.1:9/runPagespeed",
    "--ai-bot-probe",
  ];
  const r = await crawlSite({ args, env: { ...process.env, CHROME_PATH: process.execPath }, before });
  const f = findingOf(r, "ai-bot-refused");
  assert.equal(f.count, 2);
  for (const e of f.evidence) {
    assert.ok(e.detail.startsWith("PerplexityBot got a Cloudflare bot challenge (403), a visitor 200"), e.detail);
    assert.match(e.detail, /Bot Fight Mode is a likely cause/);
    assert.doesNotMatch(e.detail, /OAI-SearchBot/, "a 402 isn't a refusal");
  }
  assert.match(f.fix, /Bot Fight Mode/);
  assert.deepEqual(r.aiBotPaid.map(p => [new URL(p.url).pathname, p.bot, p.price]).sort(), [
    ["/", "OAI-SearchBot", "USD 0.01"],
    ["/about/", "OAI-SearchBot", "USD 0.01"],
  ]);
});

// ---------- report ----------
const renderReport = async data => {
  const dir = tmp();
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};

test("the AI panel shows Brave's fallback, Content-Usage lines, the sync block and paid pages, escaped, and never changes the score", async () => {
  const evil = "<img src=x onerror=alert(1)>";
  const base = {
    site: { name: "Site", url: ORIGIN },
    run: { date: "2026-11-22" },
    findings: [],
    passed: [{ rule: "AI-05", title: "Pages work for AI agents that browse", category: "AI search" }],
  };
  const aiBots = [{ bot: "GPTBot", vendor: "OpenAI", kind: "training", robots: "blocked" }];
  const data = {
    ...base,
    aiBots,
    botPreferenceSync: true,
    contentUsage: [
      { agents: "*", rule: `train-ai=n ${evil}` },
      { agents: null, rule: "search=y" },
    ],
    aiBotPaid: [{ url: `${ORIGIN}/pricing/`, bot: "OAI-SearchBot", price: `USD 0.01 ${evil}` }],
  };
  const on = await renderReport(data),
    only = await renderReport({ ...base, aiBots });
  const panel = s =>
    s.match(/\n {4}<details class="how aibots">[\s\S]*?<\/details>(?=\n|$)/)?.[0] ?? assert.fail("no AI panel");
  assert.equal(
    on.html.replace(panel(on.html), ""),
    only.html.replace(panel(only.html), ""),
    "only the AI panel changes: the score and areas are the same",
  );
  for (const s of [panel(on.html), on.md]) {
    assert.match(s, /Brave/);
    assert.match(s, /noindex/);
    assert.match(s, /Bot Preference Sync/);
    assert.match(s, /can differ from the one in the code/);
    assert.match(s, /Content-Usage: train-ai=n/);
    assert.match(s, /aren(?:'|&#39;)t final/);
    assert.match(s, /402 Payment Required/);
    assert.match(s, /OAI-SearchBot/);
    assert.match(s, /crawler-price: USD 0\.01/);
  }
  assert.ok(panel(on.html).includes("/pricing/"));
  assert.ok(
    !on.html.includes("<img src=x") && on.html.includes("&lt;img src=x onerror=alert(1)&gt;"),
    "crawled text is escaped",
  );
  assert.ok(!/(^|[^\\`])<img src=x/m.test(on.md.replace(/`[^`]*`/g, "")), "and in the Markdown");
  assert.match(panel(only.html), /Brave/, "Brave's note comes with the robots table");
  const none = await renderReport(base);
  assert.ok(!none.html.includes("Brave"), "no robots table, no Brave note");
});
