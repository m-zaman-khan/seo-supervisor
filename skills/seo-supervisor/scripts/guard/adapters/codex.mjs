// @ts-check
// https://learn.chatgpt.com/docs/hooks
import { bashActions, json, patchActions, say, SILENT } from "./edits.mjs";

export function toActions(input, event, cwd) {
  if (event === "UserPromptSubmit")
    return typeof input?.prompt === "string" ? [{ kind: "prompt", text: input.prompt }] : [];
  const args = input?.tool_input ?? {};
  if (input?.tool_name === "Bash") return bashActions(args);
  if (input?.tool_name === "apply_patch" && typeof args.command === "string") return patchActions(args.command, cwd);
  return [];
}

export function respond(result, event) {
  if (!result || result.decision === "allow") return SILENT;
  if (event === "UserPromptSubmit") return json({ decision: "block", reason: say(result) });
  // Codex parses "ask" but doesn't support it yet: the hook is marked failed and the tool runs. So an ask is a deny
  // with the reason, and the agent asks in chat.
  return json({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: say(result),
    },
  });
}
