// @ts-check
// Shared by the non-Claude adapters: tool arguments or a patch as guard actions, and the text the model sees when
// stopped. Undocumented argument names are matched by their usual spellings; an edit that can't be read is allowed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The file as it is on disk, or "" when it isn't there yet. */
export const onDisk = file => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};
/** An object from a value that may be a JSON string (Copilot's toolArgs, Cursor's MCP input), else {}. */
export const obj = v => {
  if (typeof v === "string")
    try {
      v = JSON.parse(v);
    } catch {}
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
};
const first = (o, keys) => keys.map(k => o[k]).find(v => typeof v === "string");

/** Shell commands from a tool's arguments: command as a string, or commands as a string or a list. */
export const bashActions = args =>
  [args.command, ...[].concat(args.commands ?? [])]
    .filter(c => typeof c === "string" && c.trim())
    .map(command => ({ kind: "bash", command }));

/** One file edit or write from a tool's arguments. A whole new text is a write; old and new strings are applied to the
 * file on disk, or compared as they are when the old text isn't found there. */
export function editActions(args, cwd) {
  const path = first(args, ["file_path", "filePath", "path", "target_file", "file"]);
  if (!path) return [];
  const file = resolve(cwd, path),
    before = onDisk(file);
  const whole = first(args, ["content", "contents", "file_text", "text"]);
  if (whole !== undefined) return [{ kind: "edit", file, before, after: whole }];
  const was = first(args, ["old_string", "old_str", "old_text"]),
    now = first(args, ["new_string", "new_str", "new_text", "insert_text"]);
  if (now === undefined) return [];
  return [
    was && before.includes(was)
      ? { kind: "edit", file, before, after: before.replace(was, () => now) }
      : { kind: "edit", file, before: was ?? "", after: now },
  ];
}

/** The actions in an apply_patch patch, the format Codex, Devin and Cline use: "*** Add File: ", "*** Delete File: ",
 * "*** Update File: " with an optional "*** Move to: ", then "@@" hunks of "+", "-" or " " lines. A move deletes the
 * old path. https://github.com/openai/codex/blob/main/codex-rs/apply-patch/src/parser.rs */
export function patchActions(patch, cwd) {
  const out = [];
  /** @type {{ file: string, to?: string, add: boolean, hunks: { old: string[], new: string[] }[] } | null} */
  let cur = null;
  const done = () => {
    if (!cur) return;
    const hunks = cur.hunks.filter(h => h.old.length || h.new.length),
      join = k => hunks.map(h => h[k].join("\n")).join("\n");
    const disk = onDisk(cur.file),
      file = cur.to || cur.file;
    let after = disk;
    for (const h of hunks) {
      const was = h.old.join("\n");
      after = after !== null && was && after.includes(was) ? after.replace(was, () => h.new.join("\n")) : null;
    }
    if (cur.add) out.push({ kind: "edit", file, before: disk, after: join("new") });
    else
      out.push(
        after === null
          ? { kind: "edit", file, before: join("old"), after: join("new") }
          : { kind: "edit", file, before: disk, after },
      );
    if (cur.to) out.push({ kind: "delete", file: cur.file });
    cur = null;
  };
  for (const raw of String(patch).split(/\r?\n/)) {
    const m = raw.trim().match(/^\*\*\* (Add File|Delete File|Update File|Move to): (.+)$/);
    if (m) {
      if (m[1] === "Move to") {
        if (cur) cur.to = resolve(cwd, m[2].trim());
        continue;
      }
      done();
      const file = resolve(cwd, m[2].trim());
      if (m[1] === "Delete File") out.push({ kind: "delete", file });
      else cur = { file, add: m[1] === "Add File", hunks: [{ old: [], new: [] }] };
    } else if (cur && raw.startsWith("@@")) cur.hunks.push({ old: [], new: [] });
    else if (cur && !raw.trim().startsWith("***")) {
      const h = cur.hunks.at(-1),
        sign = raw[0],
        text = raw.slice(1);
      if (cur.add) h.new.push(sign === "+" ? text : raw);
      else if (sign === "+") h.new.push(text);
      else if (sign === "-") h.old.push(text);
      else if (sign === " " || raw === "") {
        h.old.push(text);
        h.new.push(text);
      }
    }
  }
  done();
  return out;
}

/** The text the model sees. A deny not about a key means block mode; an agent with no yes/no prompt turns "ask" into a
 * stop. Both say what to do next. */
export function say(result, canAsk = false) {
  const why = `SEO Supervisor guard: ${result?.reason || "this needs the owner's yes first."}`;
  if (result?.decision === "deny" && result.rule !== "key")
    return `${why} The guard is set to block. Tell the owner what you wanted to do and why; they can do it themselves or change the guard's mode. Don't work around it.`;
  if (result?.decision !== "ask" || canAsk) return why;
  return `${why} This agent can't show a yes/no box, so the step was stopped. Ask the owner in chat. If they say yes, they can do it themselves, or let it through by setting "guard": "off" in seo-audit/settings.json for this one step (and back to "ask" after). Don't work around it.`;
}

/** The answer every adapter gives when the guard lets an action through, unless it says otherwise. */
export const SILENT = { stdout: "", stderr: "", exitCode: 0 };
export const json = (o, exitCode = 0, stderr = "") => ({ stdout: JSON.stringify(o), stderr, exitCode });
