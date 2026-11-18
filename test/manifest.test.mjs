import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL } from "./helpers.mjs";

const json = p => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

test("package, plugin and marketplace agree on name and version", () => {
  const pkg = json("package.json"), plugin = json(".claude-plugin/plugin.json"), market = json(".claude-plugin/marketplace.json");
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
  assert.deepEqual(commands.sort(), ["seo-audit.md", "seo-fix.md", "seo-launch.md", "seo-review.md", "seo-setup.md"]);
  for (const c of commands) {
    const body = readFileSync(join(ROOT, "commands", c), "utf8");
    assert.match(body, /^---\ndescription: /, `${c} has frontmatter`);
    assert.match(body, /seo-supervisor/, `${c} invokes the skill`);
  }
});

test("every rule file the skill links to exists", () => {
  const skill = readFileSync(join(SKILL, "SKILL.md"), "utf8");
  const linked = [...skill.matchAll(/`((?:rules|site-types|frameworks|examples)\/[a-z0-9-]+\.(?:md|json|html))`/g)].map(m => m[1]);
  assert.ok(linked.length > 10, "SKILL.md links its rule files");
  for (const rel of new Set(linked)) assert.doesNotThrow(() => readFileSync(join(SKILL, rel)), `${rel} exists`);

  // Root reference files: setup mode's rules live in planning.md.
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
