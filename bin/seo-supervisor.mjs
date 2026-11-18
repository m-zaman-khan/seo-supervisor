#!/usr/bin/env node
// Installs the SEO Supervisor skill and its /seo-* commands. Zero dependencies.
//   npx seo-supervisor              install for you, in every project (~/.claude)
//   npx seo-supervisor --project    install into this project (./.claude), to commit for your team
//   npx seo-supervisor --agents     also install for other agents that read ~/.agents/skills
//   npx seo-supervisor --uninstall  remove it again
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "seo-supervisor";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const FLAGS = ["--project", "--agents", "--uninstall", "--force", "--help", "-h", "--version", "-v"];
const args = process.argv.slice(2);
const has = (...f) => f.some(x => args.includes(x));

const HELP = `SEO Supervisor ${version}

Usage: npx seo-supervisor [options]

  (no options)   Install for you, in every project (~/.claude)
  --project      Install into this project (./.claude), to commit for your team
  --agents       Also install the skill for other agents (~/.agents/skills)
  --uninstall    Remove what this installer added
  --force        Replace a skill folder or command file that isn't SEO Supervisor's
  --version      Print the version
`;

const bad = args.find(a => !FLAGS.includes(a));
if (bad) { console.error(`Unknown option: ${bad}\n\n${HELP}`); process.exit(2); }
if (has("--help", "-h")) { console.log(HELP); process.exit(0); }
if (has("--version", "-v")) { console.log(version); process.exit(0); }

const home = homedir();
const base = has("--project") ? join(process.cwd(), ".claude") : join(home, ".claude");
const show = p => (p.startsWith(home) ? "~" + p.slice(home.length) : p).replace(/\\/g, "/");
const targets = [{ skills: join(base, "skills"), commands: join(base, "commands") }];
if (has("--agents")) targets.push({ skills: join(home, ".agents", "skills"), commands: null });

const SRC_SKILL = join(ROOT, "skills", NAME);
const SRC_COMMANDS = join(ROOT, "commands");
const commandFiles = readdirSync(SRC_COMMANDS).filter(f => f.endsWith(".md"));

// Only ever replace or remove what this package installed.
const ownsSkill = dir => {
  try { return /^name:\s*seo-supervisor\s*$/m.test(readFileSync(join(dir, "SKILL.md"), "utf8")); } catch { return false; }
};
const ownsCommand = file => {
  try { return readFileSync(file, "utf8").includes(NAME); } catch { return false; }
};
const force = has("--force");
let problems = 0;

for (const t of targets) {
  const skillDir = join(t.skills, NAME);
  if (has("--uninstall")) {
    if (ownsSkill(skillDir)) { rmSync(skillDir, { recursive: true, force: true }); console.log(`removed  ${show(skillDir)}`); }
    for (const f of t.commands ? commandFiles : []) {
      const file = join(t.commands, f);
      if (ownsCommand(file)) { rmSync(file); console.log(`removed  ${show(file)}`); }
    }
    continue;
  }

  if (existsSync(skillDir) && !ownsSkill(skillDir) && !force) {
    console.error(`skipped  ${show(skillDir)}: it exists and isn't SEO Supervisor (use --force to replace it)`);
    problems++;
  } else {
    rmSync(skillDir, { recursive: true, force: true });
    mkdirSync(t.skills, { recursive: true });
    cpSync(SRC_SKILL, skillDir, { recursive: true });
    console.log(`skill    ${show(skillDir)}`);
  }

  if (!t.commands) continue;
  mkdirSync(t.commands, { recursive: true });
  const added = [];
  for (const f of commandFiles) {
    const file = join(t.commands, f);
    if (existsSync(file) && !ownsCommand(file) && !force) {
      console.error(`skipped  ${show(file)}: a different /${f.slice(0, -3)} command exists (use --force to replace it)`);
      problems++;
      continue;
    }
    cpSync(join(SRC_COMMANDS, f), file);
    added.push("/" + f.slice(0, -3));
  }
  if (added.length) console.log(`commands ${added.join(" ")}  (${show(t.commands)})`);
}

if (has("--uninstall")) console.log(`\nSEO Supervisor uninstalled.`);
else console.log(`\nSEO Supervisor ${version} installed. Open Claude Code in your project and run /seo-audit.`);
process.exit(problems ? 1 : 0);
