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
    "seo-connect.md",
    "seo-fix.md",
    "seo-grow.md",
    "seo-launch.md",
    "seo-review.md",
    "seo-rewrite.md",
    "seo-setup.md",
    "seo-watch.md",
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
  for (const doc of ["planning.md", "report-format.md", "profile-template.md", "rewrite.md", "grow.md", "audience.md"])
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
    "google.mjs",
    "connect-keys.mjs",
    "log-scan.mjs",
    "backlinks.mjs",
    ...["checks", "crawl"].flatMap(d => readdirSync(join(S, d)).map(f => join(d, f))),
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
    /^---\ndescription: "Write an SEO content brief for a topic or page\.[^"\n]*"\nargument-hint: "\[topic or URL\]"\n/,
  );
  assert.match(brief, /seo-audit\/briefs\//);
  assert.match(
    readFileSync(join(ROOT, "NOTICE"), "utf8"),
    /Schema\.org[\s\S]*CC BY-SA 3\.0/,
    "the bundled Schema.org vocabulary keeps the credit its licence requires",
  );
});

test("rewrite mode: the agent rewrites, nothing changes without the owner's yes, and facts stay as they are", () => {
  const cmd = readFileSync(join(ROOT, "commands", "seo-rewrite.md"), "utf8"),
    rewrite = readFileSync(join(SKILL, "rewrite.md"), "utf8");
  assert.match(
    cmd,
    /^---\ndescription: "[^"\n]+"\nargument-hint: '\[page, file, or "writing notes"\]'\n(?:[a-z-]+:.*\n|  - .*\n)*---\n/,
  );
  assert.match(cmd, /\*\*rewrite\*\* mode/);
  assert.match(cmd, /`rewrite\.md`/);
  for (const re of [
    /before → after/,
    /owner's yes/,
    /fix steps 3–4/,
    /no API/i,
    /Invent nothing/,
    /`examples`/,
    /re-crawl/i,
    /English/,
  ])
    assert.match(rewrite, re);
  for (const kept of [
    "facts",
    "numbers",
    "prices",
    "dates",
    "names",
    "legal",
    "quotes",
    "testimonials",
    "code",
    "URLs",
    "links",
    "target phrases",
  ])
    assert.ok(rewrite.toLowerCase().includes(kept.toLowerCase()), `rewrite.md names ${kept}`);
});

test("keyword ideas from search results need the search-results check approved, and the grow command says what else gets written", () => {
  const read = p => readFileSync(join(SKILL, p), "utf8");
  const skill = read("SKILL.md"),
    ideas = skill.split("**Keyword ideas** (brief")[1].split("\n### ")[0];
  for (const [name, text] of [
    ["SKILL.md", ideas],
    ["strategy.md", read("strategy.md").split("Ideas from search results")[1].split("\n- ")[0]],
    ["grow.md", read("grow.md")],
  ])
    assert.match(
      text,
      /`intent` in `outsideChecks\.approved`|`intent` is in `outsideChecks\.approved`/,
      `${name}: only with \`intent\` in outsideChecks.approved`,
    );
  assert.match(ideas, /"Acme Plumbing\|Acme"/, "SKILL.md says how to pass several brand names");
  const cmd = readFileSync(join(ROOT, "commands", "seo-grow.md"), "utf8");
  assert.doesNotMatch(
    cmd,
    /Write only `seo-audit\/grow-plan\.md`/,
    "keyword-ideas.mjs and the audience check write their own files",
  );
  assert.match(cmd, /keyword-ideas/);
});

test("the docs agree with the code and keep every outside or content step behind the owner", () => {
  const read = p => readFileSync(join(ROOT, p), "utf8");
  const S = "skills/seo-supervisor/";
  const trust = read(S + "rules/trust-security.md");
  assert.doesNotMatch(trust, /and at least 30 days/, "TRUST-07 passes healthy short certificates");
  assert.match(trust, /whichever is sooner/);
  const launch = read("commands/seo-launch.md");
  assert.match(launch, /--check-live/);
  assert.match(launch, /TRUST-07/);
  assert.match(read(S + "SKILL.md"), /draft profile's phrases don't count/);
  const intent = read(S + "rules/search-intent.md");
  for (const id of ["INTENT-01", "INTENT-04"])
    assert.match(
      intent.split(`### ${id} ·`)[1].split("\n### ")[0],
      /`fixBy: "owner"`/,
      `${id} content changes are the owner's`,
    );
  assert.match(
    read(S + "strategy.md")
      .split("## Topic clusters")[1]
      .split("\n## ")[0],
    /outside checks/i,
    "cluster lookups need the opt-in",
  );
  for (const [file, id] of [
    ["rules/metadata.md", "META-01"],
    ["rules/content.md", "CONTENT-01"],
    ["rules/urls.md", "URL-04"],
  ])
    assert.match(
      read(S + file)
        .split(`### ${id} ·`)[1]
        .split("\n### ")[0],
      /80%.*blocker/,
      `${id} documents the site-wide blocker`,
    );
  const readme = read("README.md");
  assert.doesNotMatch(readme, /no API keys?\b/i);
  assert.match(readme, /`\/seo-brief`, `\/seo-rewrite`, `\/seo-grow`, `\/seo-watch` and `\/seo-connect` commands/);
  assert.match(
    read(S + "NOTICE"),
    /Schema\.org[\s\S]*CC BY-SA 3\.0/,
    "installed skill copies carry the Schema.org credit",
  );
});

test("every outside action is named before the owner says yes, and launch mode edits nothing", () => {
  const read = p => readFileSync(join(ROOT, p), "utf8");
  const skill = read("skills/seo-supervisor/SKILL.md"),
    readme = read("README.md");
  assert.match(skill, /naming each of them/);
  assert.match(skill, /off-site brand lookups/);
  assert.match(skill, /Launch mode edits nothing/);
  assert.match(readme, /Saying yes allows these/);
  assert.match(readme, /\*\*IndexNow\*\* sends the URLs of changed pages/);
  for (const action of [/Google ranking updates/, /backlink check\*\* visits/, /Matomo or PostHog/])
    assert.match(readme, action);
  for (const action of [/google-updates\.mjs[^\n]*--yes/, /backlinks\.mjs[^\n]*Add `--yes` once the owner agrees/])
    assert.match(skill, action);
  assert.doesNotMatch(
    readme,
    /The only key it can use|Nothing leaves your machine unless you switch on outside checks/,
  );
  assert.doesNotMatch(
    read("skills/seo-supervisor/report-format.md"),
    /\|\n\n\| `authority`/,
    "the authority row stays inside the table",
  );
});
