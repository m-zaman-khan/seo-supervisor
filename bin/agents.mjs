// @ts-check
// Where each coding agent reads skills from, and how to tell it's installed. Skill paths follow the open skills CLI.
// https://github.com/vercel-labs/skills
import { existsSync } from "node:fs";
import { join } from "node:path";

const config = c => c.env.XDG_CONFIG_HOME || join(c.home, ".config");
const claudeHome = c => c.env.CLAUDE_CONFIG_DIR || join(c.home, ".claude");
const codexHome = c => c.env.CODEX_HOME || join(c.home, ".codex");
const grokHome = c => c.env.GROK_HOME || join(c.home, ".grok");
const shared = c => join(c.home, ".agents", "skills"); // read by Codex, Cline, Goose, Zed, Warp and others

// An agent that keeps everything in ~/<dir>, with skills in <dir>/skills.
const plain = (key, name, dir) => ({
  key,
  name,
  detect: c => [join(c.home, dir)],
  user: c => join(c.home, dir, "skills"),
  project: `${dir}/skills`,
});

export const AGENTS = [
  {
    key: "claude-code",
    name: "Claude Code",
    detect: c => [claudeHome(c)],
    user: c => join(claudeHome(c), "skills"),
    project: ".claude/skills",
    commands: { user: c => join(claudeHome(c), "commands"), project: ".claude/commands" },
  },
  { key: "codex", name: "Codex", detect: c => [codexHome(c)], user: shared, project: ".agents/skills" },
  {
    key: "cursor",
    name: "Cursor",
    detect: c => [join(c.home, ".cursor")],
    user: c => join(c.home, ".cursor", "skills"),
    project: ".agents/skills",
  },
  {
    key: "windsurf",
    name: "Windsurf",
    detect: c => [join(c.home, ".codeium", "windsurf")],
    user: c => join(c.home, ".codeium", "windsurf", "skills"),
    project: ".windsurf/skills",
  },
  {
    key: "gemini-cli",
    name: "Gemini CLI",
    detect: c => [join(c.home, ".gemini")],
    user: c => join(c.home, ".gemini", "skills"),
    project: ".agents/skills",
  },
  {
    key: "github-copilot",
    name: "GitHub Copilot",
    detect: c => [join(c.home, ".copilot")],
    user: c => join(c.home, ".copilot", "skills"),
    project: ".agents/skills",
  },
  {
    key: "opencode",
    name: "OpenCode",
    detect: c => [join(config(c), "opencode")],
    user: c => join(config(c), "opencode", "skills"),
    project: ".agents/skills",
  },
  {
    key: "grok",
    name: "Grok Build",
    detect: c => [grokHome(c)],
    user: c => join(grokHome(c), "skills"),
    project: ".grok/skills",
  },
  { key: "cline", name: "Cline", detect: c => [join(c.home, ".cline")], user: shared, project: ".agents/skills" },
  plain("kiro-cli", "Kiro CLI", ".kiro"),
  plain("roo", "Roo Code", ".roo"),
  plain("continue", "Continue", ".continue"),
  {
    key: "amp",
    name: "Amp",
    detect: c => [join(config(c), "amp")],
    user: c => join(config(c), "agents", "skills"),
    project: ".agents/skills",
  },
  {
    key: "goose",
    name: "Goose",
    detect: c => [join(config(c), "goose")],
    user: c => join(config(c), "goose", "skills"),
    project: ".goose/skills",
  },
  plain("junie", "Junie", ".junie"),
  plain("qwen-code", "Qwen Code", ".qwen"),
  plain("trae", "Trae", ".trae"),
  plain("augment", "Augment", ".augment"),
  {
    key: "zed",
    name: "Zed",
    detect: c => [join(config(c), "zed"), ...(c.env.APPDATA ? [join(c.env.APPDATA, "Zed")] : [])],
    user: shared,
    project: ".agents/skills",
  },
  { key: "warp", name: "Warp", detect: c => [join(c.home, ".warp")], user: shared, project: ".agents/skills" },
  {
    key: "other",
    name: "Other agents (shared .agents folder)",
    detect: () => [],
    user: shared,
    project: ".agents/skills",
  },
];

export const agentByKey = key => AGENTS.find(a => a.key === key);

/** Keys of the agents whose home folder exists, in table order. */
export function detectAgents(c, exists = existsSync) {
  return AGENTS.filter(a => a.detect(c).some(p => exists(p))).map(a => a.key);
}

const resolve = (where, c) => (typeof where === "function" ? where(c) : join(c.cwd, ...where.split("/")));

/** One install target per skills folder, so agents that share a folder get one copy. Each extra is
 * { key, kind: "commands" | "subagents" | "hooks", path, format }. */
export function targetsFor(keys, scope, c) {
  const byDir = new Map();
  for (const key of keys) {
    const a = agentByKey(key);
    const skills = resolve(scope === "project" ? a.project : a.user, c);
    const t = byDir.get(skills) || byDir.set(skills, { skills, agents: [] }).get(skills);
    t.agents.push(a.name);
    if (a.commands) t.commands = resolve(scope === "project" ? a.commands.project : a.commands.user, c);
  }
  return [...byDir.values()];
}

/** Every skills folder any agent could use in this scope, plus the legacy ones, for uninstall. */
export function allTargets(scope, c) {
  return targetsFor(
    AGENTS.map(a => a.key),
    scope,
    c,
  );
}
