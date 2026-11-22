// @ts-check
// Slash commands, subagents and the guard hook, each in the agent's own format (bin/agents.mjs). Every path an install
// creates is recorded in the skill folder, so --uninstall removes exactly that. A hook entry is ours only if it runs
// this skill's guard.mjs.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

export const NAME = "seo-supervisor";
// Command names from earlier versions, so uninstall removes those files too when they're ours.
export const RETIRED_COMMANDS = [];
const RECORD = ".seo-supervisor-install.json";
const OURS = /seo-supervisor[\\/]+scripts[\\/]+guard\.mjs/;
const mine = text => typeof text === "string" && text.includes(NAME);

// Recorded paths are relative to the scope's root (home or project), so a committed project install can be removed on
// another machine.
export function readRecord(skillDir) {
  try {
    return JSON.parse(readFileSync(join(skillDir, RECORD), "utf8")).created || [];
  } catch {
    return [];
  }
}
export const writeRecord = (skillDir, created) =>
  writeFileSync(join(skillDir, RECORD), JSON.stringify({ created: [...new Set(created)] }, null, 2) + "\n");

/** Makes a folder, remembering each folder that wasn't there before. */
export function mkdirs(dir, created, root) {
  const missing = [];
  for (let d = dir; !existsSync(d) && dirname(d) !== d; d = dirname(d)) missing.unshift(d);
  mkdirSync(dir, { recursive: true });
  for (const d of missing) created.push(rel(root, d));
}
const rel = (root, p) => {
  const r = relative(root, p);
  return r.startsWith("..") || isAbsolute(r) ? p : r.split("\\").join("/");
};
const abs = (root, p) => (isAbsolute(p) ? p : join(root, p));
/** Writes a file, remembering it (and its new folders) when it's new. */
function put(file, text, created, root) {
  mkdirs(dirname(file), created, root);
  if (!existsSync(file)) created.push(rel(root, file));
  writeFileSync(file, text);
}

/** Removes recorded folders once they're empty, deepest first. Files are left alone: a created file that's still
 * there may have gained someone else's hooks since. */
export function prune(created, root) {
  for (const p of [...new Set(created)].map(x => abs(root, x)).sort((a, b) => b.length - a.length)) {
    try {
      if (readdirSync(p).length === 0) rmdirSync(p);
    } catch {}
  }
}

// ---- commands ----
const frontmatter = md => {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return { head: m ? m[1] : "", body: m ? md.slice(m[0].length) : md };
};
const field = (head, k) => head.match(new RegExp(`^${k}:[^\\n]*(?:\\n[ \\t]+[^\\n]*)*`, "m"))?.[0];
const unquote = v => {
  const s = v.trim();
  return /^["'].*["']$/.test(s) ? s.slice(1, -1) : s;
};
/** A command file in one agent's format: { name, text }. Roo has no argument placeholder, so its text points at what
 * follows the command. Gemini CLI gets TOML with {{args}}; a JSON string is a valid TOML basic string. */
export function commandFile(file, md, format) {
  const base = file.replace(/\.md$/, "");
  if (format === "roo") return { name: `${base}.md`, text: md.replaceAll("$ARGUMENTS", "the text after the command") };
  if (format !== "toml") return { name: `${base}.md`, text: md };
  const { head, body } = frontmatter(md),
    desc = field(head, "description");
  return {
    name: `${base}.toml`,
    text: `${desc ? `description = ${JSON.stringify(unquote(desc.slice(12)))}\n` : ""}prompt = ${JSON.stringify(body.trim().replaceAll("$ARGUMENTS", "{{args}}"))}\n`,
  };
}

// ---- subagents ----
/** A Claude Code subagent (agents/*.md) in another agent's format: { name, text }, or null without a name. Only name,
 * description and instructions carry over, since tool and model names differ per agent. ${CLAUDE_PLUGIN_ROOT} becomes
 * skillDir, and the plugin-only site setting is replaced with a note. */
export function subagentFile(md, format, skillDir = "") {
  const { head, body } = frontmatter(md),
    name = field(head, "name"),
    desc = field(head, "description");
  if (!name) return null;
  const id = unquote(name.slice(5)),
    note = `\n\n<!-- Installed by ${NAME}; npx ${NAME} --uninstall removes it. -->\n`;
  const fm = { cursor: [name, desc, "model: inherit"], opencode: [desc, "mode: subagent"], copilot: [name, desc] }[
    format
  ].filter(Boolean);
  const text = body
    .trimEnd()
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/skills/seo-supervisor", skillDir)
    .replaceAll("`${user_config.site_url}`", "(only in the Claude Code plugin)");
  return {
    name: format === "copilot" ? `${id}.agent.md` : `${id}.md`,
    text: `---\n${fm.join("\n")}\n---\n${text}${note}`,
  };
}

// ---- the guard's hook entries ----
// The guard's path is always quoted for the shell that runs it, so ' & ( ) or a space in a home folder can't break the
// command. sh writes ' as '\''; PowerShell doubles ' and the curly quotes it also reads as '; cmd needs only "…", as a
// Windows path can't hold a ". Known gap, rare in home folders: % under cmd, or $ and ` where PowerShell reads "…".
// Codex runs $SHELL -lc, or cmd via commandWindows on Windows; Cursor runs PowerShell on Windows, else sh; Copilot has
// bash and powershell fields. Devin's docs don't say, so Windows gets "…", read alike by cmd, PowerShell and Git Bash.
// https://learn.chatgpt.com/docs/hooks
// https://cursor.com/docs/hooks
const QUOTE = {
  sh: p => `'${p.replaceAll("'", "'\\''")}'`,
  ps: p => `'${p.replace(/['‘’‚‛]/g, "$&$&")}'`,
  cmd: p => `"${p}"`,
};
/** The hook entries for one agent, by event. guard is absolute, or relative to the project for a project install. */
function entries(format, guard) {
  const win = process.platform === "win32";
  const run = (event, shell) =>
    `node ${guard.startsWith("$(") ? `"${guard}"` : QUOTE[shell](guard)} --agent ${format} --event ${event}`;
  if (format === "cursor") {
    const c = e => ({ command: run(e, win ? "ps" : "sh") });
    return {
      beforeShellExecution: [c("beforeShellExecution")],
      preToolUse: [{ ...c("preToolUse"), matcher: "Write|Delete" }],
      beforeSubmitPrompt: [c("beforeSubmitPrompt")],
    };
  }
  if (format === "copilot") {
    // Copilot's preToolUse denies the tool when a command hook fails, so a missing node must still exit 0.
    const cp = event => ({
      type: "command",
      bash: `${run(event, "sh")} || true`,
      powershell: `${run(event, "ps")}; exit 0`,
      timeoutSec: 10,
    });
    return {
      preToolUse: [{ ...cp("preToolUse"), matcher: "bash|powershell|edit|create" }],
      userPromptTransformed: [cp("userPromptTransformed")],
    };
  }
  const hook = event =>
    format === "codex"
      ? {
          type: "command",
          command: run(event, "sh"),
          commandWindows: run(event, "cmd"),
          statusMessage: "SEO Supervisor guard",
        }
      : { type: "command", command: run(event, win ? "cmd" : "sh"), timeout: 10 };
  const group = (event, matcher) => ({ ...(matcher !== undefined ? { matcher } : {}), hooks: [hook(event)] });
  if (format === "codex")
    return { PreToolUse: [group("PreToolUse", "^(Bash|apply_patch)$")], UserPromptSubmit: [group("UserPromptSubmit")] };
  return {
    PreToolUse: [group("PreToolUse", "^(exec|edit|write|apply_patch)$")],
    UserPromptSubmit: [group("UserPromptSubmit", "")],
  };
}
// Cline runs plugins in a worker, so the plugin runs the guard in a child process and returns what it prints. A
// missing node, a crash or a timeout lets the call through, so the guard can't lock up the agent. A relative guard path
// resolves from the project root, two folders above .cline/plugins, whatever folder the session started in.
// https://docs.cline.bot/sdk/plugins
const clinePlugin =
  guard => `// SEO Supervisor's guard for Cline. Installed by npx ${NAME}; npx ${NAME} --uninstall removes it.
import { spawnSync } from "node:child_process";
import { isAbsolute, join } from "node:path";
const GUARD = ${JSON.stringify(guard)};
let cwd = process.cwd();
export default {
  name: "seo-supervisor-guard",
  manifest: { capabilities: ["hooks"] },
  setup(api, ctx) { if (ctx && ctx.cwd) cwd = ctx.cwd; },
  hooks: {
    beforeTool(context) {
      const r = spawnSync("node", [isAbsolute(GUARD) ? GUARD : join(cwd, GUARD), "--agent", "cline", "--event", "beforeTool"], { cwd, encoding: "utf8", timeout: 2500,
        input: JSON.stringify({ tool: context && context.toolCall && context.toolCall.name, input: context && context.input, cwd }) });
      try { return r.status === 0 && r.stdout.trim() ? JSON.parse(r.stdout) : undefined; } catch { return undefined; }
    },
  },
};
`;

// Where the events live in each JSON hook file: the whole file (Devin's hooks.v1.json) or its "hooks" key.
const eventsOf = (format, file, o) =>
  format === "devin" && file.endsWith("hooks.v1.json")
    ? o
    : (o.hooks = o.hooks && typeof o.hooks === "object" ? o.hooks : {});
const fresh = format => (format === "cursor" ? { version: 1, hooks: {} } : format === "codex" ? { hooks: {} } : {});
/** Takes the guard's entries out of an events map, keeping every other hook, including those in a shared group. */
function strip(events) {
  for (const [event, list] of Object.entries(events)) {
    if (!Array.isArray(list) || !OURS.test(JSON.stringify(list))) continue;
    const kept = [];
    for (const item of list) {
      if (!Array.isArray(item?.hooks)) {
        if (!OURS.test(JSON.stringify(item))) kept.push(item);
        continue;
      }
      const hooks = item.hooks.filter(h => !OURS.test(JSON.stringify(h)));
      if (hooks.length) kept.push({ ...item, hooks });
    }
    if (kept.length) events[event] = kept;
    else delete events[event];
  }
}
const readJson = file => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

/** Adds the guard for one agent (replacing an older copy). project: guard is relative to the project root.
 * Returns a problem message, or null. */
export function addHooks(format, file, guard, created, root) {
  if (format === "copilot")
    return (
      put(file, JSON.stringify({ version: 1, hooks: entries(format, guard) }, null, 2) + "\n", created, root),
      null
    );
  if (format === "cline") return (put(file, clinePlugin(guard), created, root), null);
  let o;
  try {
    o = readJson(file) ?? fresh(format);
  } catch {
    return `${file} isn't valid JSON, so the guard wasn't added to it`;
  }
  const events = eventsOf(format, file, o);
  strip(events);
  for (const [event, list] of Object.entries(entries(format, guard)))
    events[event] = [...(Array.isArray(events[event]) ? events[event] : []), ...list];
  put(file, JSON.stringify(o, null, 2) + "\n", created, root);
  return null;
}

/** Takes the guard out of one agent's hook file (and Codex's config.toml), deleting a file the install created once
 * nothing else is left. Returns [what, file] pairs: "removed", or "kept" when other hooks remain. */
export function removeHooks(format, file, created, root) {
  if (!existsSync(file)) return false;
  if (format === "copilot" || format === "cline") {
    if (!OURS.test(readFileSync(file, "utf8"))) return false;
    rmSync(file);
    return true;
  }
  let o;
  try {
    o = readJson(file);
  } catch {
    return false;
  }
  if (!o || !OURS.test(JSON.stringify(o))) return false;
  strip(eventsOf(format, file, o));
  // Devin's user config.json holds other settings too: an emptied "hooks" key goes.
  if (format === "devin" && o.hooks && !Object.keys(o.hooks).length) delete o.hooks;
  const ours = created.includes(rel(root, file)),
    empty = JSON.stringify(o) === JSON.stringify(fresh(format));
  if (ours && empty) rmSync(file);
  else writeFileSync(file, JSON.stringify(o, null, 2) + "\n");
  return true;
}

/** Installs one target's extras. src: { commands: [[file, md]], subagents: [md] }. guard: false skips the hook (and
 * takes an older one out). Returns lines to print and problems. */
export function installExtras(t, { src, guard, force, scope, root, created, show }) {
  const lines = [],
    problems = [];
  const ref = p => (scope === "project" ? rel(root, p) : p.split("\\").join("/")); // a committed project install names its own files
  const skillRef = ref(join(t.skills, NAME)),
    guardRef = `${skillRef}/scripts/guard.mjs`;
  for (const x of t.extras) {
    if (x.kind === "hooks") {
      if (!guard) {
        if (removeHooks(x.format, x.path, created, root))
          lines.push(`removed  the guard from ${show(x.path)} (--no-guard)`);
        continue;
      }
      // Codex runs hooks from the session's folder, so a project install names the guard from the repository's root.
      const err = addHooks(
        x.format,
        x.path,
        scope === "project" && x.format === "codex" ? `$(git rev-parse --show-toplevel)/${guardRef}` : guardRef,
        created,
        root,
      );
      if (err) problems.push(err);
      else lines.push(`guard    ${show(x.path)}`);
      continue;
    }
    const files =
      x.kind === "commands"
        ? src.commands.map(([f, md]) => commandFile(f, md, x.format))
        : src.subagents.map(md => subagentFile(md, x.format, skillRef)).filter(Boolean);
    const added = [];
    for (const { name, text } of files) {
      const file = join(x.path, name);
      if (existsSync(file) && !mine(readFileSync(file, "utf8")) && !force) {
        problems.push(`${show(file)}: a different one exists (use --force to replace it)`);
        continue;
      }
      put(file, text, created, root);
      added.push(name.replace(/(\.agent)?\.(md|toml)$/, ""));
    }
    if (added.length)
      lines.push(
        `${x.kind === "commands" ? "commands" : "agents  "} ${added.map(n => (x.kind === "commands" ? "/" : "") + n).join(" ")}  (${show(x.path)})`,
      );
  }
  return { lines, problems };
}

/** Removes one target's extras: its commands (current and retired names), subagents and guard entries. Returns
 * [what, file] pairs: "removed", or "kept" for a hook file that only lost the guard. */
export function removeExtras(t, { src, created, root }) {
  const gone = [];
  for (const x of t.extras) {
    if (x.kind === "hooks") {
      if (removeHooks(x.format, x.path, created, root)) gone.push(x.path);
      continue;
    }
    const names =
      x.kind === "commands"
        ? [...src.commands.map(([f]) => f), ...RETIRED_COMMANDS.map(n => `${n}.md`)].map(
            f => commandFile(f, "", x.format).name,
          )
        : src.subagents.map(md => subagentFile(md, x.format)?.name).filter(Boolean);
    for (const name of names) {
      const file = join(x.path, name);
      try {
        if (mine(readFileSync(file, "utf8"))) {
          rmSync(file);
          gone.push(file);
        }
      } catch {}
    }
  }
  return gone;
}
