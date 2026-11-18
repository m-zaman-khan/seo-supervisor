import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, node, tmp } from "./helpers.mjs";

const BIN = join(ROOT, "bin", "seo-supervisor.mjs");
const COMMANDS = ["seo-audit", "seo-fix", "seo-review", "seo-launch"];
const withHome = home => ({ env: { ...process.env, HOME: home, USERPROFILE: home } });

test("npx seo-supervisor installs, updates and uninstalls cleanly", async () => {
  const home = tmp();
  const skill = join(home, ".claude", "skills", "seo-supervisor");

  await node([BIN], withHome(home));
  assert.ok(existsSync(join(skill, "SKILL.md")));
  assert.ok(existsSync(join(skill, "scripts", "seo-crawl.mjs")));
  assert.ok(existsSync(join(skill, "scripts", "fonts", "geist.woff2")));
  for (const c of COMMANDS) assert.ok(existsSync(join(home, ".claude", "commands", `${c}.md`)), `/${c}`);

  await node([BIN], withHome(home)); // running it again updates in place

  await node([BIN, "--uninstall"], withHome(home));
  assert.ok(!existsSync(skill));
  for (const c of COMMANDS) assert.ok(!existsSync(join(home, ".claude", "commands", `${c}.md`)));
});

test("--project installs into ./.claude and --agents adds ~/.agents/skills", async () => {
  const home = tmp(), project = tmp();
  await node([BIN, "--project", "--agents"], { ...withHome(home), cwd: project });
  assert.ok(existsSync(join(project, ".claude", "skills", "seo-supervisor", "SKILL.md")));
  assert.ok(existsSync(join(project, ".claude", "commands", "seo-audit.md")));
  assert.ok(existsSync(join(home, ".agents", "skills", "seo-supervisor", "SKILL.md")));
  assert.ok(!existsSync(join(home, ".claude")), "--project leaves ~/.claude alone");
});

test("it never overwrites someone else's command or skill without --force", async () => {
  const home = tmp();
  const commands = join(home, ".claude", "commands");
  mkdirSync(commands, { recursive: true });
  writeFileSync(join(commands, "seo-audit.md"), "my own audit command\n");

  await assert.rejects(node([BIN], withHome(home)), "exits non-zero when it skips something");
  assert.equal(readFileSync(join(commands, "seo-audit.md"), "utf8"), "my own audit command\n");
  assert.ok(existsSync(join(commands, "seo-fix.md")), "the other commands still install");

  await node([BIN, "--uninstall"], withHome(home));
  assert.equal(readFileSync(join(commands, "seo-audit.md"), "utf8"), "my own audit command\n", "uninstall leaves it alone too");

  await node([BIN, "--force"], withHome(home));
  assert.match(readFileSync(join(commands, "seo-audit.md"), "utf8"), /seo-supervisor/);
});

test("unknown options fail with the usage text", async () => {
  await assert.rejects(node([BIN, "--nope"]), err => /Usage: npx seo-supervisor/.test(err.stderr));
});
