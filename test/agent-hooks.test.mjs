// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { SCRIPTS } from "./helpers.mjs";

const guard = (agent, event, stdin) =>
  spawnSync(process.execPath, [join(SCRIPTS, "guard.mjs"), "--agent", agent, "--event", event], {
    input: stdin,
    encoding: "utf8",
  });

test("the guard's own error still answers allow in the agent's format, so Cursor never blocks on empty output", () => {
  const r = guard("cursor", "beforeShellExecution", "{ not json");
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { permission: "allow" });
  assert.match(r.stderr, /allowed the action after its own error/);
});

test("schema-check --hook cursor hands structured data errors back to Cursor as additional_context", async () => {
  const { writeFileSync } = await import("node:fs");
  const { tmp } = await import("./helpers.mjs");
  const dir = tmp(),
    file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Prodcut","name":"Boiler"}</script></head><body></body></html>',
  );
  const r = spawnSync(process.execPath, [join(SCRIPTS, "schema-check.mjs"), "--hook", "cursor"], {
    input: JSON.stringify({
      hook_event_name: "postToolUse",
      tool_name: "Write",
      tool_input: { file_path: file },
      cwd: dir,
    }),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.match(out.additional_context, /structured data error/);
  assert.match(out.additional_context, /Prodcut/);
});

test("schema-check --hook copilot finds the file an apply_patch edit touched, whichever field holds the patch", async () => {
  const { writeFileSync } = await import("node:fs");
  const { tmp } = await import("./helpers.mjs");
  const dir = tmp(),
    file = join(dir, "page.html");
  writeFileSync(
    file,
    '<!doctype html><html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Prodcut","name":"Boiler"}</script></head><body></body></html>',
  );
  const patch = "*** Begin Patch\n*** Update File: page.html\n@@\n-old\n+new\n*** End Patch";
  for (const toolArgs of [JSON.stringify({ input: patch }), patch]) {
    const r = spawnSync(process.execPath, [join(SCRIPTS, "schema-check.mjs"), "--hook", "copilot"], {
      input: JSON.stringify({ toolName: "apply_patch", toolArgs, cwd: dir }),
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(JSON.parse(r.stdout).additionalContext, /Prodcut/);
  }
});

test("an unknown agent after an error stays silent on stdout and allows", () => {
  const r = guard("no-such-agent", "x", "{}");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});
