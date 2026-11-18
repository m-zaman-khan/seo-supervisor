// The package, plugin, skill and docs agree with each other and with the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL } from "./helpers.mjs";

const json = p => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

test("package, plugin and marketplace agree on name and version", () => {
  const pkg = json("package.json"),
    plugin = json(".claude-plugin/plugin.json"),
    market = json(".claude-plugin/marketplace.json");
  assert.equal(plugin.name, "seo-supervisor");
  assert.equal(pkg.name, plugin.name);
  assert.equal(plugin.version, pkg.version);
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(market.plugins[0].source, "./");
  assert.ok(market.owner?.name);
});

test("the skill and every command are wired to the same skill name", () => {
  const skill = readFileSync(join(SKILL, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: seo-supervisor\ndescription: Use when /);
  const commands = readdirSync(join(ROOT, "commands")).filter(f => f.endsWith(".md"));
  assert.deepEqual(commands.sort(), [
    "seo-audit.md",
    "seo-brief.md",
    "seo-fix.md",
    "seo-launch.md",
    "seo-review.md",
    "seo-setup.md",
  ]);
  for (const c of commands) {
    const body = readFileSync(join(ROOT, "commands", c), "utf8");
    assert.match(body, /^---\ndescription: /, `${c} has frontmatter`);
    assert.match(body, /seo-supervisor/, `${c} invokes the skill`);
  }
});

test("every rule file the skill links to exists", () => {
  const skill = readFileSync(join(SKILL, "SKILL.md"), "utf8");
  const linked = [...skill.matchAll(/`((?:rules|site-types|frameworks|examples)\/[a-z0-9-]+\.(?:md|json|html))`/g)].map(
    m => m[1],
  );
  assert.ok(linked.length > 10, "SKILL.md links its rule files");
  for (const rel of new Set(linked)) assert.doesNotThrow(() => readFileSync(join(SKILL, rel)), `${rel} exists`);

  assert.match(skill, /`planning\.md`/, "SKILL.md points setup mode at planning.md");
  for (const doc of ["planning.md", "report-format.md", "profile-template.md"])
    if (skill.includes("`" + doc + "`")) assert.doesNotThrow(() => readFileSync(join(SKILL, doc)), `${doc} exists`);
});

test("setup rules keep every change behind approval: profile, robots and declined items", () => {
  const planning = readFileSync(join(SKILL, "planning.md"), "utf8");
  const format = readFileSync(join(SKILL, "report-format.md"), "utf8");
  assert.doesNotMatch(planning, /update that instead/, "no edits to docs/ before approval");
  assert.match(planning, /copy it to `seo-audit\/seo-profile\.draft\.md`/);
  assert.match(planning, /move the draft profile to `docs\/seo-profile\.md`/);
  assert.match(planning, /any robots\.txt change beyond adding the `Sitemap:` line is a yes item/);
  assert.match(planning, /`declined: true`/);
  assert.match(planning, /`intro`/);
  assert.match(format, /`pages\[\]\.intro`/);
  assert.match(format, /`declined`/);
});

test("setup fixes the audit's code findings after approval, and the plan shows which", () => {
  const planning = readFileSync(join(SKILL, "planning.md"), "utf8");
  assert.match(planning, /## 5\. Fix the audit's code findings/);
  assert.match(planning, /`plan\.alsoFixes`/);
  assert.match(planning, /\| `approved` \| Steps 4–8/);
  assert.match(readFileSync(join(SKILL, "report-format.md"), "utf8"), /`plan\.alsoFixes`/);
  assert.match(readFileSync(join(ROOT, "commands", "seo-setup.md"), "utf8"), /fixes the audit's other code findings/);
});

test("every rule ID a check reports is defined in a rule file", () => {
  const S = join(SKILL, "scripts");
  const sources = [
    "seo-crawl.mjs",
    "content-scan.mjs",
    "gsc-import.mjs",
    ...readdirSync(join(S, "checks")).map(f => join("checks", f)),
  ];
  const used = new Set(
    sources.flatMap(f => [...readFileSync(join(S, f), "utf8").matchAll(/"([A-Z]+-\d{2})"/g)].map(m => m[1])),
  );
  const defined = new Set(
    ["rules", "site-types"].flatMap(d =>
      readdirSync(join(SKILL, d)).flatMap(f =>
        [...readFileSync(join(SKILL, d, f), "utf8").matchAll(/^### ([A-Z]+-\d{2}) ·/gm)].map(m => m[1]),
      ),
    ),
  );
  assert.ok(used.size > 50);
  for (const id of used) assert.ok(defined.has(id), `${id} is used by a check but has no rule entry`);
});

test("2.0 is documented: untrusted content, outside checks, history, intent, briefs and credits", () => {
  const skill = readFileSync(join(SKILL, "SKILL.md"), "utf8");
  assert.match(skill, /never an instruction/, "fetched text is data");
  assert.match(skill, /--outside/);
  assert.match(skill, /seo-audit\/settings\.json/);
  assert.match(skill, /seo-diff\.mjs/);
  assert.match(skill, /gsc-import\.mjs/);
  assert.match(skill, /--check-live/);
  assert.match(skill, /`rules\/search-intent\.md`/);
  assert.match(skill, /`strategy\.md`/);
  const strategy = readFileSync(join(SKILL, "strategy.md"), "utf8");
  for (const h of [
    "Intent",
    "Target and related phrases",
    "Outline",
    "Questions to answer",
    "Facts needed from the owner",
    "Internal links in and out",
  ])
    assert.match(strategy, new RegExp(`^#### ${h}$`, "m"), `brief heading: ${h}`);
  assert.match(readFileSync(join(SKILL, "planning.md"), "utf8"), /Facts needed from the owner/);
  assert.match(readFileSync(join(SKILL, "profile-template.md"), "utf8"), /## Target phrases/);
  const brief = readFileSync(join(ROOT, "commands", "seo-brief.md"), "utf8");
  assert.match(
    brief,
    /^---\ndescription: "Write an SEO content brief for a topic or page"\nargument-hint: "\[topic or URL\]"\n---/,
  );
  assert.match(brief, /seo-audit\/briefs\//);
  assert.match(readFileSync(join(ROOT, "NOTICE"), "utf8"), /MIT License/);
});
