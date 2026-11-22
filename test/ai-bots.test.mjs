// @ts-check
// scripts/data/ai-bots.json drives the robots table, ai-bots-blocked, log-scan's bot list and the AI crawler probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import { AI_BOTS, BOTS } from "../skills/seo-supervisor/scripts/checks/agents.mjs";
import { aiBotAccess, checkRobots } from "../skills/seo-supervisor/scripts/checks/robots.mjs";

const DATA = JSON.parse(readFileSync(join(SCRIPTS, "data", "ai-bots.json"), "utf8"));

// The ai-bots-blocked evidence and the robots table for one robots.txt, without a crawl.
function readRobots(body) {
  const found = [],
    extra = {},
    add = (check, url, detail) => found.push({ check, detail });
  const { robots, star } = checkRobots(
    { status: 200, body },
    { add, evalRules: () => {}, startOrigin: "https://site.example" },
  );
  aiBotAccess({ robots, robotsRes: { body }, star }, { add, extra, startOrigin: "https://site.example" });
  return { blocked: found.filter(f => f.check === "ai-bots-blocked").map(f => f.detail), table: extra.aiBots };
}

test("every row of the data file is well formed", () => {
  const names = DATA.map(b => b.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, "no name twice");
  for (const b of DATA) {
    assert.ok(b.vendor && (b.kind || b.group), b.name);
    if (b.kind) assert.match(b.kind, /^(search|training|user|other)$/, b.name);
    if (b.group) {
      assert.match(b.group, /^(search|ai-search|ai-training|other)$/, b.name);
      assert.ok(b.purpose, b.name);
    }
    for (const u of b.ips || []) assert.match(u, /^https:\/\//, b.name);
  }
});

test("the robots table is the data file's AI crawlers, in its order", () => {
  assert.deepEqual(BOTS, DATA);
  assert.deepEqual(
    AI_BOTS.map(b => b[0]),
    DATA.filter(b => b.kind).map(b => b.name),
  );
  assert.deepEqual(
    DATA.filter(b => b.probeUa).map(b => b.name),
    ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"],
    "the probe's three user agents",
  );
});

test("ai-bots-blocked names exactly the bots the table shows as blocked by their own group", () => {
  const { blocked, table } = readRobots(
    [
      "User-agent: MistralAI-Index",
      "Disallow: /",
      "",
      "User-agent: YandexAdditional",
      "Disallow: /",
      "",
      "User-agent: GPTBot",
      "Disallow: /",
      "",
      "User-agent: Googlebot",
      "Disallow: /",
      "",
      "User-agent: *",
      "Disallow: /private/",
    ].join("\n"),
  );
  assert.deepEqual(
    blocked,
    table.filter(b => b.robots === "blocked").map(b => b.bot),
  );
  assert.deepEqual(
    blocked.toSorted(),
    ["GPTBot", "MistralAI-Index", "YandexAdditionalBot"],
    "by name or the second name Yandex accepts; Applebot's Googlebot fallback isn't its own group",
  );
});

test("Meta's WebIndexer and ExternalAds crawlers are listed; YandexAdditional doesn't follow User-agent: *", () => {
  const row = name => DATA.find(b => b.name === name);
  assert.deepEqual([row("Meta-WebIndexer")?.kind, row("Meta-WebIndexer")?.group], ["search", "ai-search"]);
  assert.deepEqual([row("Meta-ExternalAds")?.kind, row("Meta-ExternalAds")?.group], ["other", "other"]);
  const { table, blocked } = readRobots("User-agent: *\nDisallow: /\n");
  const bot = name => table.find(b => b.bot === name);
  assert.equal(bot("YandexAdditionalBot").robots, "allowed", "Yandex: it reads only a group that names it");
  assert.equal(bot("Meta-WebIndexer").robots, "blocked-by-star");
  assert.equal(bot("Meta-ExternalAds").robots, "blocked-by-star");
  assert.deepEqual(blocked, [], "a * block is robots-blocks-all, not this finding");
});

test("Anthropic's retired names are in no list and raise nothing", () => {
  assert.ok(!DATA.some(b => /^(anthropic-ai|claude-web)$/i.test(b.name)));
  assert.deepEqual(readRobots("User-agent: anthropic-ai\nUser-agent: Claude-Web\nDisallow: /\n").blocked, []);
});

test("log-scan's bots are the data file's bots that visit, with their vendor, group and purpose", async () => {
  const visiting = DATA.filter(b => b.group),
    dir = tmp(),
    log = join(dir, "access.log"),
    out = join(dir, "log-scan.json");
  writeFileSync(
    log,
    visiting
      .map(
        (b, i) =>
          `1.2.3.4 - - [12/Nov/2026:10:00:${String(i % 60).padStart(2, "0")} +0000] "GET / HTTP/1.1" 200 100 "-" "Mozilla/5.0 (compatible; ${b.name}/1.1)"`,
      )
      .join("\n") + "\n",
  );
  await node([join(SCRIPTS, "log-scan.mjs"), "--log", log, "--out", out]);
  const r = JSON.parse(readFileSync(out, "utf8"));
  for (const b of visiting)
    assert.deepEqual(
      [r.bots[b.name]?.vendor, r.bots[b.name]?.group, r.bots[b.name]?.purpose],
      [b.vendor, b.group, b.purpose],
      b.name,
    );
  assert.equal(Object.keys(r.bots).length, visiting.length, "robots.txt-only names never match a visit");
});

test("the AI search lines follow Google's pages, and the rendering line claims nothing vendors don't say", () => {
  const ai = readFileSync(join(SKILL, "rules", "ai-search.md"), "utf8").split("\n");
  const training = ai.find(l => l.includes("**Training** crawlers")) || "";
  assert.match(training, /support\.google\.com\/webmasters\/answer\/16908024/);
  assert.match(training, /doesn't remove the site from AI Overviews or AI Mode/);
  const preferred = ai.find(l => l.includes("preferred sources")) || "";
  assert.match(preferred, /Search generative AI/);
  assert.match(preferred, /subdomain/);
  assert.doesNotMatch(
    readFileSync(join(SKILL, "rules", "rendering.md"), "utf8").split("\n")[2],
    /don't render it at all/,
  );
});
