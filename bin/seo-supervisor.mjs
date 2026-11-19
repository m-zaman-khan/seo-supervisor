#!/usr/bin/env node
// Installs the skill into the chosen coding agents (bin/agents.mjs), with its /seo-* commands for Claude Code.
// No dependencies.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, agentByKey, allTargets, detectAgents, targetsFor } from "./agents.mjs";
import { multiSelect, select } from "./prompt.mjs";

const NAME = "seo-supervisor";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const HELP = `SEO Supervisor ${version}

Usage: npx seo-supervisor [options]

With no options it asks where to install and for which agents.

  --agent <keys>    Comma-separated agents, or "all". No questions about agents.
  --scope <scope>   "user" (you, in every project) or "project" (this folder, to commit for your team)
  --project         Same as --scope project
  --yes, -y         No questions: the agents it finds (Claude Code if none), user scope
  --uninstall       Remove what this installer added, in the chosen scope (user by default)
  --force           Replace a skill folder or command file that isn't SEO Supervisor's
  --with-lighthouse Also install the optional Lighthouse add-on (about 170 MB, in ~/.seo-supervisor/tools, not your project)
  --no-lighthouse   Don't ask about Lighthouse
  --version         Print the version

Agent keys: ${AGENTS.map(a => a.key).join(", ")}
`;

// ---- arguments ----
const opts = {};
const argv = process.argv.slice(2);
for (let n = 0; n < argv.length; n++) {
  const a = argv[n];
  if (a === "--agent" || a === "--scope") {
    opts[a.slice(2)] = argv[++n];
    continue;
  }
  if (a === "--with-lighthouse" || a === "--no-lighthouse") {
    opts.lighthouse = a === "--with-lighthouse";
    continue;
  }
  const flag = {
    "--project": "project",
    "--agents": "agents",
    "--uninstall": "uninstall",
    "--force": "force",
    "--yes": "yes",
    "-y": "yes",
    "--help": "help",
    "-h": "help",
    "--version": "version",
    "-v": "version",
  }[a];
  if (!flag) {
    console.error(`Unknown option: ${a}\n\n${HELP}`);
    process.exit(2);
  }
  opts[flag] = true;
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (opts.version) {
  console.log(version);
  process.exit(0);
}

const c = { home: homedir(), cwd: process.cwd(), env: process.env };
const show = p => (p.startsWith(c.home) ? "~" + p.slice(c.home.length) : p).replace(/\\/g, "/");
const TOOLS = join(c.home, ".seo-supervisor", "tools"); // the optional Lighthouse add-on, outside the package and the project
let scope = opts.scope || (opts.project ? "project" : null);
if (scope && !["user", "project"].includes(scope)) {
  console.error(`Unknown scope: ${scope}. Use "user" or "project".`);
  process.exit(2);
}

let keys = null;
if (opts.agent) {
  keys =
    opts.agent === "all"
      ? AGENTS.map(a => a.key)
      : opts.agent
          .split(",")
          .map(s => s.trim())
          .filter(Boolean);
  const bad = keys.find(k => !agentByKey(k));
  if (bad) {
    console.error(`Unknown agent: ${bad}\nAgent keys: ${AGENTS.map(a => a.key).join(", ")}`);
    process.exit(2);
  }
}

// ---- what this package owns ----
const SRC_SKILL = join(ROOT, "skills", NAME);
const SRC_COMMANDS = join(ROOT, "commands");
const commandFiles = readdirSync(SRC_COMMANDS).filter(f => f.endsWith(".md"));
const ownsSkill = dir => {
  try {
    return /^name:\s*seo-supervisor\s*$/m.test(readFileSync(join(dir, "SKILL.md"), "utf8"));
  } catch {
    return false;
  }
};
const ownsCommand = file => {
  try {
    return readFileSync(file, "utf8").includes(NAME);
  } catch {
    return false;
  }
};

// ---- uninstall ----
if (opts.uninstall) {
  scope ||= "user";
  let removed = 0;
  for (const t of allTargets(scope, c)) {
    const dir = join(t.skills, NAME);
    if (ownsSkill(dir)) {
      rmSync(dir, { recursive: true, force: true });
      console.log(`removed  ${show(dir)}`);
      removed++;
    }
    for (const f of t.commands ? commandFiles : []) {
      const file = join(t.commands, f);
      if (ownsCommand(file)) {
        rmSync(file);
        console.log(`removed  ${show(file)}`);
        removed++;
      }
    }
  }
  console.log(removed ? "\nSEO Supervisor uninstalled." : `\nNothing to remove in the ${scope} scope.`);
  if (existsSync(TOOLS))
    console.log(
      `Lighthouse stays in ${show(TOOLS)} (about 170 MB), shared by every install. To remove it too, delete that folder: ${TOOLS}`,
    );
  process.exit(0);
}

// ---- questions (only in a real terminal, and only for what flags didn't settle) ----
const interactive = !opts.yes && process.stdin.isTTY && process.stdout.isTTY && !process.env.CI;
const detected = detectAgents(c);
const fallback = detected.length ? detected : ["claude-code"];
try {
  if (interactive) console.log(`\nSEO Supervisor ${version}\n`);
  if (!scope) {
    scope = interactive
      ? await select({
          message: "Install for",
          items: [
            { value: "user", label: "Me, in every project", hint: "each agent's folder in your home directory" },
            { value: "project", label: "This project only", hint: `${show(c.cwd)}, to commit for your team` },
          ],
        })
      : "user";
  }
  if (!keys) {
    if (interactive) {
      const order = [...AGENTS].sort((a, b) => Number(detected.includes(b.key)) - Number(detected.includes(a.key)));
      const where = a => show(targetsFor([a.key], scope, c)[0].skills);
      keys = await multiSelect({
        message: "Which agents?",
        items: order.map(a => ({
          value: a.key,
          label: a.name.padEnd(36),
          hint: `${detected.includes(a.key) ? "found · " : ""}${where(a)}`,
        })),
        selected: opts.agents ? [...fallback, "other"] : fallback,
      });
    } else keys = opts.agents ? [...fallback, "other"] : fallback;
  } else if (opts.agents && !keys.includes("other")) keys.push("other");
  if (opts.lighthouse === undefined && interactive && !existsSync(join(TOOLS, "node_modules", "lighthouse"))) {
    opts.lighthouse = await select({
      message: `Add Lighthouse for speed and quality scores? It's optional, about 170 MB, installed in ${show(TOOLS)} (not your project).`,
      items: [
        { value: false, label: "No" },
        { value: true, label: "Yes, install it" },
      ],
    });
  }
} catch (e) {
  if (e.code === "CANCELLED") {
    console.log("\nCancelled. Nothing was installed.");
    process.exit(130);
  }
  throw e;
}

// ---- install ----
let problems = 0;
const names = [];
let installedAt = null; // the first skill folder written, for the update-notice line
if (interactive) console.log("");
for (const t of targetsFor(keys, scope, c)) {
  const dir = join(t.skills, NAME);
  installedAt ||= dir;
  if (existsSync(dir) && !ownsSkill(dir) && !opts.force) {
    console.error(`skipped  ${show(dir)}: it exists and isn't SEO Supervisor (use --force to replace it)`);
    problems++;
  } else {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(t.skills, { recursive: true });
    cpSync(SRC_SKILL, dir, { recursive: true });
    console.log(`skill    ${show(dir)}  (${t.agents.join(", ")})`);
    names.push(...t.agents);
  }
  if (!t.commands) continue;
  mkdirSync(t.commands, { recursive: true });
  const added = [];
  for (const f of commandFiles) {
    const file = join(t.commands, f);
    if (existsSync(file) && !ownsCommand(file) && !opts.force) {
      console.error(
        `skipped  ${show(file)}: a different /${f.slice(0, -3)} command exists (use --force to replace it)`,
      );
      problems++;
      continue;
    }
    cpSync(join(SRC_COMMANDS, f), file);
    added.push("/" + f.slice(0, -3));
  }
  if (added.length) console.log(`commands ${added.join(" ")}  (${show(t.commands)})`);
}

// ---- optional Lighthouse add-on in TOOLS: a failure never fails the install, since the skill works without it ----
if (opts.lighthouse) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19))
    console.error(
      `\nLighthouse wasn't installed: Lighthouse 13 needs Node 22.19 or later, this is ${process.versions.node}. The skill works without it.`,
    );
  else {
    console.log(`\nInstalling Lighthouse into ${show(TOOLS)} (about 170 MB, usually a minute or two)...`);
    const npm = c.env.SEO_SUPERVISOR_NPM || "npm",
      args = ["install", "--prefix", TOOLS, "lighthouse@13", "--no-audit", "--no-fund"];
    // A .js bin runs with this Node. On Windows npm is npm.cmd, which only starts through a shell. Only parts with spaces
    // are quoted: cmd gives a quoted batch name found on PATH the wrong %~dp0, and npm.cmd then can't find npm.
    const r = /\.[cm]?js$/i.test(npm)
      ? spawnSync(process.execPath, [npm, ...args], { stdio: "inherit" })
      : process.platform === "win32"
        ? spawnSync([npm, ...args].map(a => (/\s/.test(a) ? `"${a}"` : a)).join(" "), { stdio: "inherit", shell: true })
        : spawnSync(npm, args, { stdio: "inherit" });
    if (r.status === 0) console.log(`lighthouse ${show(TOOLS)}  (the crawler runs it with --outside --lighthouse)`);
    else
      console.error(
        `Lighthouse wasn't installed (${r.error ? r.error.message : `npm exited with code ${r.status}`}). The skill works without it; try again later with npx seo-supervisor --with-lighthouse, or npm i -g lighthouse.`,
      );
  }
}

const usesClaude = keys.includes("claude-code");
console.log(`\nSEO Supervisor ${version} installed for ${names.join(", ") || "nothing"}.`);
if (names.length && installedAt)
  console.log(
    `Update notices are on: at most once a week the skill asks npm whether a newer version exists (only the package name is sent). Turn them off with: node "${join(installedAt, "scripts", "update-check.mjs")}" off`,
  );
console.log(
  usesClaude
    ? `In Claude Code run /seo-audit (or /seo-setup for a site with no SEO yet).${names.length > 1 ? ' In the other agents, ask: "audit the SEO of this site".' : ""}`
    : `Open your agent and ask: "audit the SEO of this site".`,
);
process.exit(problems ? 1 : 0);
