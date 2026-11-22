// @ts-check
// https://code.claude.com/docs/en/hooks
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { seoSensitive } from "../rules.mjs";

const QUIET = Object.freeze({ stdout: "", stderr: "", exitCode: 0 });
const out = o => ({ stdout: JSON.stringify(o), stderr: "", exitCode: 0 });
const str = v => (typeof v === "string" ? v : "");

/** The hook payload as guard actions. A Write's before is the file on disk; an Edit's after is that file, edited. */
export function toActions(input, event, cwd) {
  if (event === "UserPromptSubmit") return [{ kind: "prompt", text: str(input?.prompt) }];
  if (event !== "PreToolUse") return [];
  const tool = input?.tool_name,
    ti = input?.tool_input || {};
  if (tool === "Bash" || tool === "PowerShell") return [{ kind: "bash", command: str(ti.command) }];
  // MultiEdit is legacy but the permissions page still names it, so its edits list is read when present.
  if (!["Write", "Edit", "MultiEdit"].includes(tool) || !str(ti.file_path)) return [];
  const file = resolve(cwd, ti.file_path);
  let disk = null;
  try {
    disk = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch {}
  if (tool === "Write") return [{ kind: "edit", file, before: disk ?? "", after: str(ti.content) }];
  const edits = (tool === "Edit" ? [ti] : Array.isArray(ti.edits) ? ti.edits : []).map(e => ({
    o: str(e?.old_string).replace(/\r\n/g, "\n"),
    n: str(e?.new_string).replace(/\r\n/g, "\n"),
    all: e?.replace_all === true,
  }));
  let after = disk;
  if (disk != null)
    for (const { o, n, all } of edits) if (o) after = all ? after.split(o).join(n) : after.replace(o, () => n);
  // An unreadable file, or an old_string that isn't in it: judge the edited snippets on their own.
  if (disk == null || (after === disk && edits.some(e => e.o !== e.n)))
    return edits.map(e => ({ kind: "edit", file, before: e.o, after: e.n }));
  return [{ kind: "edit", file, before: disk, after }];
}

/** @param {{ decision: string, reason?: string, rule?: string }} r */
export function respond(r, event) {
  // No output leaves the normal permission flow.
  if (!r || r.decision === "allow") return QUIET;
  // The block reason is shown to the user; suppressOriginalPrompt keeps the prompt, and so a pasted key, out of it.
  if (event === "UserPromptSubmit")
    return out({
      decision: "block",
      reason: r.reason,
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", suppressOriginalPrompt: true },
    });
  if (event !== "PreToolUse") return QUIET;
  const why =
    r.decision === "deny" && r.rule !== "key"
      ? `${r.reason} The guard is in block mode, so it stopped this. Ask the owner in chat: they can run it themselves, or set the guard to ask.`
      : r.reason;
  // "ask" shows the reason to the user in the permission prompt; "deny" shows it to Claude.
  return out({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: r.decision,
      permissionDecisionReason: `SEO Supervisor: ${why}`,
    },
  });
}

// ---------- the review reminder (Stop) ----------
// One small notes file per session, in the plugin's data folder.
const stateFile = (input, env) =>
  join(
    env.CLAUDE_PLUGIN_DATA || join(tmpdir(), "seo-supervisor"),
    "guard-sessions",
    `${String(input.session_id)
      .replace(/[^\w-]/g, "_")
      .slice(0, 100)}.json`,
  );
const load = f => {
  try {
    const s = JSON.parse(readFileSync(f, "utf8"));
    return { changed: [].concat(s.changed || []), noted: [].concat(s.noted || []) };
  } catch {
    return { changed: [], noted: [] };
  }
};
// A note that can't be saved is skipped: the reminder must never stop the guard's own checks.
const save = (f, s) => {
  try {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(s));
  } catch {}
};
const shown = (f, cwd) => {
  const p = relative(cwd, f);
  return (p.startsWith("..") || isAbsolute(p) ? f : p).replace(/\\/g, "/");
};
const list = a => (a.length > 3 ? `${a.slice(0, 3).join(", ")} and ${a.length - 3} more` : a.join(", "));

/** Notes the SEO files an edit touches, clears them when a review runs, and on Stop reminds the user once. Returns the
 * hook's answer for the events only this handles (PostToolUse, Stop), else null. */
export function session(input, event, cwd, actions, env = process.env) {
  if (!input?.session_id) return event === "Stop" || event === "PostToolUse" ? QUIET : null;
  const f = stateFile(input, env),
    reviewed = () => save(f, { changed: [], noted: [] });
  if (event === "PreToolUse") {
    const files = actions.filter(a => a.kind === "edit" && seoSensitive(a, cwd)).map(a => shown(a.file, cwd));
    if (files.length) {
      const s = load(f);
      s.changed = [...new Set([...s.changed, ...files])];
      save(f, s);
    }
    return null;
  }
  // /seo-review typed by the user, or the review skill or seo-reviewer subagent started by Claude.
  if (event === "UserPromptSubmit") {
    if (/^\s*\/(seo-supervisor:)?seo-review\b/.test(str(input.prompt))) reviewed();
    return null;
  }
  if (event === "PostToolUse") {
    const ti = input.tool_input || {};
    if (/seo-review/.test(`${str(ti.subagent_type)} ${str(ti.skill)}`)) reviewed();
    return QUIET;
  }
  if (event !== "Stop" || input.stop_hook_active) return event === "Stop" ? QUIET : null;
  const s = load(f),
    fresh = s.changed.filter(x => !s.noted.includes(x));
  if (!fresh.length) return QUIET;
  save(f, { changed: s.changed, noted: s.changed });
  // systemMessage is shown to the user and doesn't keep Claude going.
  return out({
    systemMessage: `SEO Supervisor: this session changed what search engines read (${list(fresh)}), and no SEO review has run since. Run /seo-review to check those changes before they go live.`,
  });
}
