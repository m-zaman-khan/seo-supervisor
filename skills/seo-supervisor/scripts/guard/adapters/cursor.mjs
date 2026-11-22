// @ts-check
// https://cursor.com/docs/hooks
import { resolve } from "node:path";
import { bashActions, editActions, json, obj, say } from "./edits.mjs";

export function toActions(input, event, cwd) {
  const here = typeof input?.cwd === "string" ? input.cwd : cwd;
  if (event === "beforeSubmitPrompt")
    return typeof input?.prompt === "string" ? [{ kind: "prompt", text: input.prompt }] : [];
  if (event === "beforeShellExecution") return bashActions(input ?? {});
  const args = obj(input?.tool_input);
  if (input?.tool_name === "Shell") return bashActions(args);
  if (input?.tool_name === "Delete") {
    const p = ["path", "file_path", "target_file"].map(k => args[k]).find(v => typeof v === "string");
    return p ? [{ kind: "delete", file: resolve(here, p) }] : [];
  }
  if (input?.tool_name === "Write") return editActions(args, here);
  return [];
}

export function respond(result, event) {
  const decision = result?.decision || "allow";
  if (event === "beforeSubmitPrompt")
    return json(decision === "allow" ? { continue: true } : { continue: false, user_message: say(result) });
  // Output that isn't valid JSON blocks a permission hook and there's no "no opinion" answer, so allow is stated
  // outright, as Cursor's sample hooks do. Cursor merges hooks so deny beats ask beats allow, making allow neutral;
  // whether it also skips Cursor's own approval prompt isn't documented.
  if (decision === "allow") return json({ permission: "allow" });
  // preToolUse accepts "ask" but doesn't enforce it, so an ask on an edit is a deny with the reason.
  const ask = decision === "ask" && event === "beforeShellExecution",
    text = say(result, ask);
  return json({ permission: ask ? "ask" : "deny", user_message: text, agent_message: text });
}
