// @ts-check
// GitHub Copilot CLI and cloud agent hooks.
// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference
import { bashActions, editActions, json, obj, say, SILENT } from "./edits.mjs";

export function toActions(input, event, cwd) {
  const here = typeof input?.cwd === "string" ? input.cwd : cwd;
  if (event === "userPromptTransformed")
    return typeof input?.prompt === "string" ? [{ kind: "prompt", text: input.prompt }] : [];
  // toolArgs may be a JSON string and is typed unknown, so a patch is whichever value holds "*** Begin Patch".
  const args = obj(input?.toolArgs);
  if (input?.toolName === "bash" || input?.toolName === "powershell") return bashActions(args);
  if (input?.toolName === "edit" || input?.toolName === "create") return editActions(args, here);
  return [];
}

export function respond(result, event) {
  if (!result || result.decision === "allow") return SILENT;
  // userPromptSubmitted can't block, so userPromptTransformed swaps a prompt holding a key for the guard's note and the
  // model never sees the key.
  if (event === "userPromptTransformed")
    return json({
      modifiedTransformedPrompt: `${say(result)} The owner's message was held back, so you didn't see it. Tell the owner why, in those words.`,
    });
  // The CLI shows an ask; the cloud agent and autopilot treat it as deny.
  return json({
    permissionDecision: result.decision === "ask" ? "ask" : "deny",
    permissionDecisionReason: say(result, result.decision === "ask"),
  });
}
