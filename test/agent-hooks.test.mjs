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

test("an unknown agent after an error stays silent on stdout and allows", () => {
  const r = guard("no-such-agent", "x", "{}");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});
