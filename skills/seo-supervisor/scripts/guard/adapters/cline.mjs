// @ts-check
// Cline's hooks are plugin functions: the installed .cline/plugins/seo-supervisor-guard.js runs this guard with
// { tool, input, cwd } on stdin and returns what it prints. Plugins run only in Cline's SDK, CLI and Kanban, so the
// guard doesn't reach the VS Code and JetBrains extensions.
// https://docs.cline.bot/sdk/plugins
// Known gap: no Cline hook sees the prompt before the model does, so a key pasted in chat isn't caught.
import { bashActions, editActions, json, obj, patchActions, say, SILENT } from "./edits.mjs";

// The built-in tools' argument names aren't documented, so edits.mjs tries the usual spellings.
// https://docs.cline.bot/tools-reference/all-cline-tools
export function toActions(input, event, cwd) {
  const here = typeof input?.cwd === "string" ? input.cwd : cwd,
    args = obj(input?.input);
  if (input?.tool === "run_commands") return bashActions(args);
  if (input?.tool === "apply_patch") {
    const p = Object.values(args).find(v => typeof v === "string" && v.includes("*** Begin Patch"));
    return p ? patchActions(p, here) : [];
  }
  if (input?.tool === "editor") return editActions(args, here);
  return [];
}

// skip blocks the call and gives the model the reason; autoApprove: false makes Cline ask the user.
export function respond(result) {
  if (!result || result.decision === "allow") return SILENT;
  if (result.decision === "ask") return json({ policy: { autoApprove: false }, appendContext: say(result, true) });
  return json({ skip: true, reason: say(result) });
}
