// Guard edge cases: refused edits, pages emptied from the shell, bare hex keys and commands in brackets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, tmp } from "./helpers.mjs";
import { run } from "../skills/seo-supervisor/scripts/guard.mjs";

test("Stop: an edit that was refused leaves no reminder; one that happened does", async () => {
  const data = tmp(),
    env = { CLAUDE_PLUGIN_DATA: data },
    p = tmp(),
    file = join(p, "page.html");
  const go = input => run("claude-code", { cwd: p, session_id: "lim", ...input }, { env });
  const tool_input = { file_path: file, content: '<head><link rel="canonical" href="https://x.com/a"></head>' };
  const pre = id => go({ hook_event_name: "PreToolUse", tool_name: "Write", tool_use_id: id, tool_input });
  const post = (id, tool_response) =>
    go({ hook_event_name: "PostToolUse", tool_name: "Write", tool_use_id: id, tool_input, tool_response });
  const stop = async () => (await go({ hook_event_name: "Stop", stop_hook_active: false })).stdout;
  await pre("t1"); // refused: Claude Code's permission system said no, so no PostToolUse follows
  assert.equal(await stop(), "", "a refused edit isn't a change");
  await pre("t2");
  await post("t2", "Error: the file was modified since it was read");
  assert.equal(await stop(), "", "a failed edit isn't one either");
  await pre("t3");
  await post("t3", { filePath: file, type: "create" });
  assert.match(JSON.parse(await stop()).systemMessage, /page\.html/, "a completed edit is");
  // Without a tool_use_id, the file pairs the two.
  await go({ session_id: "lim2", hook_event_name: "PreToolUse", tool_name: "Write", tool_input });
  await go({
    session_id: "lim2",
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input,
    tool_response: { filePath: file, type: "create" },
  });
  assert.match(
    JSON.parse((await go({ session_id: "lim2", hook_event_name: "Stop" })).stdout).systemMessage,
    /page\.html/,
  );
  // hooks.json runs the guard after the same edits it checks before.
  const groups = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks;
  const ifs = ev =>
    groups[ev]
      .filter(g => g.matcher === "Edit|Write|MultiEdit")
      .flatMap(g => g.hooks)
      .filter(h => /guard\.mjs$/.test(h.args[0]))
      .map(h => h.if)
      .sort();
  assert.ok(ifs("PreToolUse").length > 10);
  assert.deepEqual(ifs("PostToolUse"), ifs("PreToolUse"));
});
