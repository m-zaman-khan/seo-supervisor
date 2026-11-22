// @ts-check
// Where each coding agent reads skills from, and how to tell it's installed. Skill paths follow the open skills CLI.
// https://github.com/vercel-labs/skills
import { existsSync } from "node:fs";
import { join } from "node:path";

const config = c => c.env.XDG_CONFIG_HOME || join(c.home, ".config");
const claudeHome = c => c.env.CLAUDE_CONFIG_DIR || join(c.home, ".claude");
const codexHome = c => c.env.CODEX_HOME || join(c.home, ".codex");
const grokHome = c => c.env.GROK_HOME || join(c.home, ".grok");
// COPILOT_HOME moves ~/.copilot.
// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference
const copilotHome = c => c.env.COPILOT_HOME || join(c.home, ".copilot");
// https://docs.devin.ai/cli/extensibility/skills
const devinHome = c => (c.env.APPDATA ? join(c.env.APPDATA, "devin") : join(config(c), "devin"));
const shared = c => join(c.home, ".agents", "skills"); // read by Codex, Cline, Goose, Zed, Warp and others

// An agent that keeps everything in ~/<dir>, with skills in <dir>/skills.
const plain = (key, name, dir, more = {}) => ({
  key,
  name,
  detect: c => [join(c.home, dir)],
  user: c => join(c.home, dir, "skills"),
  project: `${dir}/skills`,
  ...more,
});

// Extras besides the skill: commands from commands/*.md ("md" as is, "roo" without $ARGUMENTS, "toml" for Gemini CLI),
// subagents from agents/*.md, and hooks that run scripts/guard.mjs, each in the agent's own format.
/** @typedef {{ user: string | ((c: any) => string), project: string, format: string }} Place */
/** @type {{ key: string, name: string, aliases?: string[], detect: (c: any) => string[], user: string | ((c: any) => string), project: string, commands?: Place, subagents?: Place, hooks?: Place }[]} */
export const AGENTS = [
  {
    key: "claude-code",
    name: "Claude Code",
    detect: c => [claudeHome(c)],
    user: c => join(claudeHome(c), "skills"),
    project: ".claude/skills",
    commands: { user: c => join(claudeHome(c), "commands"), project: ".claude/commands", format: "md" },
  },
  // Codex reads a project's .codex/hooks.json only once the project is trusted.
  // https://learn.chatgpt.com/docs/hooks
  {
    key: "codex",
    name: "Codex",
    detect: c => [codexHome(c)],
    user: shared,
    project: ".agents/skills",
    hooks: { user: c => join(codexHome(c), "hooks.json"), project: ".codex/hooks.json", format: "codex" },
  },
  // https://cursor.com/docs/hooks
  // https://cursor.com/docs/subagents
  {
    key: "cursor",
    name: "Cursor",
    detect: c => [join(c.home, ".cursor")],
    user: c => join(c.home, ".cursor", "skills"),
    project: ".agents/skills",
    hooks: { user: c => join(c.home, ".cursor", "hooks.json"), project: ".cursor/hooks.json", format: "cursor" },
    subagents: { user: c => join(c.home, ".cursor", "agents"), project: ".cursor/agents", format: "cursor" },
  },
  // Devin replaced Windsurf, whose docs redirect to docs.devin.ai. Project hooks own the whole .devin/hooks.v1.json;
  // user hooks sit under the "hooks" key of config.json.
  {
    key: "devin",
    aliases: ["windsurf"],
    name: "Devin (formerly Windsurf)",
    detect: c => [devinHome(c), join(c.home, ".codeium", "windsurf")],
    user: c => join(devinHome(c), "skills"),
    project: ".devin/skills",
    hooks: { user: c => join(devinHome(c), "config.json"), project: ".devin/hooks.v1.json", format: "devin" },
  },
  // https://geminicli.com/docs/cli/custom-commands
  {
    key: "gemini-cli",
    name: "Gemini CLI",
    detect: c => [join(c.home, ".gemini")],
    user: c => join(c.home, ".gemini", "skills"),
    project: ".agents/skills",
    commands: { user: c => join(c.home, ".gemini", "commands"), project: ".gemini/commands", format: "toml" },
  },
  // The app and the CLI both read ~/.gemini/config/skills.
  // https://antigravity.google/docs/customization-discovery
  {
    key: "antigravity",
    name: "Antigravity",
    detect: c => ["config", "antigravity", "antigravity-cli"].map(d => join(c.home, ".gemini", d)),
    user: c => join(c.home, ".gemini", "config", "skills"),
    project: ".agents/skills",
  },
  // Copilot CLI loads every *.json in its hooks folders, and custom agents as *.agent.md.
  // https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference
  {
    key: "github-copilot",
    name: "GitHub Copilot",
    detect: c => [copilotHome(c)],
    user: c => join(copilotHome(c), "skills"),
    project: ".agents/skills",
    hooks: {
      user: c => join(copilotHome(c), "hooks", "seo-supervisor-guard.json"),
      project: ".github/hooks/seo-supervisor-guard.json",
      format: "copilot",
    },
    subagents: { user: c => join(copilotHome(c), "agents"), project: ".github/agents", format: "copilot" },
  },
  // https://opencode.ai/docs/commands
  // https://opencode.ai/docs/agents
  {
    key: "opencode",
    name: "OpenCode",
    detect: c => [join(config(c), "opencode")],
    user: c => join(config(c), "opencode", "skills"),
    project: ".agents/skills",
    commands: { user: c => join(config(c), "opencode", "commands"), project: ".opencode/commands", format: "md" },
    subagents: { user: c => join(config(c), "opencode", "agents"), project: ".opencode/agents", format: "opencode" },
  },
  {
    key: "grok",
    name: "Grok Build",
    detect: c => [grokHome(c)],
    user: c => join(grokHome(c), "skills"),
    project: ".grok/skills",
  },
  // https://docs.cline.bot/customization/plugins
  {
    key: "cline",
    name: "Cline",
    detect: c => [join(c.home, ".cline")],
    user: shared,
    project: ".agents/skills",
    hooks: {
      user: c => join(c.home, ".cline", "plugins", "seo-supervisor-guard.js"),
      project: ".cline/plugins/seo-supervisor-guard.js",
      format: "cline",
    },
  },
  // The IDE and the CLI both read these folders.
  // https://kiro.dev/docs/skills
  plain("kiro-cli", "Kiro", ".kiro", { aliases: ["kiro"] }),
  // Roo commands have no argument placeholder.
  // https://roocodeinc.github.io/Roo-Code/features/slash-commands
  plain("roo", "Roo Code", ".roo", {
    commands: { user: c => join(c.home, ".roo", "commands"), project: ".roo/commands", format: "roo" },
  }),
  // Continue's docs don't describe SKILL.md skills. The row keeps --agent continue working, labelled as unconfirmed.
  // https://docs.continue.dev
  plain("continue", "Continue (unconfirmed folder)", ".continue"),
  {
    key: "amp",
    name: "Amp",
    detect: c => [join(config(c), "amp")],
    user: c => join(config(c), "agents", "skills"),
    project: ".agents/skills",
  },
  // https://goose-docs.ai/docs/guides/context-engineering/using-skills
  { key: "goose", name: "Goose", detect: c => [join(config(c), "goose")], user: shared, project: ".agents/skills" },
  plain("junie", "Junie", ".junie"),
  plain("qwen-code", "Qwen Code", ".qwen"),
  plain("trae", "Trae", ".trae"),
  // https://docs.augmentcode.com/cli/skills
  // https://docs.augmentcode.com/cli/custom-commands
  plain("augment", "Augment", ".augment", {
    commands: { user: c => join(c.home, ".augment", "commands"), project: ".augment/commands", format: "md" },
  }),
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

/** Looks an agent up by key or alias (windsurf finds devin). */
export const agentByKey = key => AGENTS.find(a => a.key === key || a.aliases?.includes(key));

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
    const t = byDir.get(skills) || byDir.set(skills, { skills, agents: [], extras: [] }).get(skills);
    if (t.agents.includes(a.name)) continue;
    t.agents.push(a.name);
    for (const kind of ["commands", "subagents", "hooks"])
      if (a[kind])
        t.extras.push({
          key: a.key,
          kind,
          path: resolve(scope === "project" ? a[kind].project : a[kind].user, c),
          format: a[kind].format,
        });
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
