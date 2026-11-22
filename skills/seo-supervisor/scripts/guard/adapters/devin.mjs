// @ts-check
// Devin hooks, for Devin Local, Devin Desktop and the Devin CLI.
// https://docs.devin.ai/cli/extensibility/hooks/overview
import { bashActions, editActions, json, obj, patchActions, say, SILENT } from "./edits.mjs";

export function toActions(input, event, cwd) {
  const here = typeof input?.cwd === "string" ? input.cwd : cwd;
  if (event === "UserPromptSubmit")
    return typeof input?.prompt === "string" ? [{ kind: "prompt", text: input.prompt }] : [];
  const args = obj(input?.tool_input);
  if (input?.tool_name === "exec") return bashActions(args);
  if (input?.tool_name === "apply_patch") {
    const p = Object.values(args).find(v => typeof v === "string" && v.includes("*** Begin Patch"));
    return p ? patchActions(p, here) : [];
  }
  if (input?.tool_name === "edit" || input?.tool_name === "write") return editActions(args, here);
  return [];
}

export function respond(result) {
  if (!result || result.decision === "allow") return SILENT;
  const reason = say(result);
  return json({ decision: "block", reason }, 2, reason);
}
