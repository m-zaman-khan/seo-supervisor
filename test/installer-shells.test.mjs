// @ts-check
// Installed hook commands run in each agent's own shell, from home folders with ' & ( and spaces in their names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, node, tmp } from "./helpers.mjs";
import * as devin from "../skills/seo-supervisor/scripts/guard/adapters/devin.mjs";

const BIN = join(ROOT, "bin", "seo-supervisor.mjs");
const env = home => {
  const e = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of [
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "APPDATA",
    "GROK_HOME",
    "COPILOT_HOME",
    "SEO_SUPERVISOR_GUARD",
    "DEVIN_PROJECT_DIR",
  ])
    delete e[k];
  return e;
};
const ASK = { decision: "ask", reason: "Submitting the sitemap to Google needs the owner's yes.", rule: "outside" };
const json = p => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

// ---- running a hook command the way each agent does ----
const WIN = process.platform === "win32";
const HAS_SH = spawnSync("sh", ["-c", "exit 0"]).status === 0; // POSIX sh, or Git's sh on Windows (never WSL's bash)
const SHELL = {
  sh: c => ["sh", ["-c", c], {}],
  ps: c => ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", c], {}],
  // Codex on Windows runs %COMSPEC% /C "<command>".
  // https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/command_runner.rs
  cmd: c => ["cmd.exe", ["/d", "/c", `"${c}"`], { windowsVerbatimArguments: true }],
};
const ALL = WIN ? ["cmd", "ps", ...(HAS_SH ? ["sh"] : [])] : ["sh"];
const CMD = "node scripts/indexnow.mjs --yes"; // the guard asks before this one
const PAYLOAD = {
  codex: { tool_name: "Bash", tool_input: { command: CMD } },
  cursor: { command: CMD },
  copilot: { toolName: "bash", toolArgs: JSON.stringify({ command: CMD }) },
  devin: { tool_name: "exec", tool_input: { command: CMD } },
};
const STOPPED = {
  codex: o => o.hookSpecificOutput.permissionDecision === "deny",
  cursor: o => o.permission === "ask",
  copilot: o => o.permissionDecision === "ask",
  devin: o => o.decision === "block",
};
/** Every PreToolUse-style hook command an install wrote, with the shells this platform runs it in. */
function hookCommands(at, scope) {
  const codex = json(join(at, ".codex", "hooks.json")).hooks.PreToolUse[0].hooks[0];
  const copilot = json(join(at, scope === "user" ? ".copilot/hooks" : ".github/hooks", "seo-supervisor-guard.json"))
    .hooks.preToolUse[0];
  const devin =
    scope === "user"
      ? json(join(at, ".config", "devin", "config.json")).hooks
      : json(join(at, ".devin", "hooks.v1.json"));
  return [
    // Codex runs commandWindows on Windows and command elsewhere; without commandWindows, command runs everywhere.
    ["codex", codex.command, codex.commandWindows ? (HAS_SH ? ["sh"] : []) : ALL],
    ...(codex.commandWindows ? [["codex", codex.commandWindows, WIN ? ["cmd", "ps"] : []]] : []),
    // Cursor's desktop app runs hooks through PowerShell on Windows, and project hooks from the project root.
    // https://cursor.com/docs/hooks
    ["cursor", json(join(at, ".cursor", "hooks.json")).hooks.beforeShellExecution[0].command, WIN ? ["ps"] : ["sh"]],
    ["copilot", copilot.bash, HAS_SH ? ["sh"] : [], copilot.cwd],
    ["copilot", copilot.powershell, WIN ? ["ps"] : [], copilot.cwd],
    ["devin", devin.PreToolUse[0].hooks[0].command, ALL], // Devin's docs don't name its shell
  ];
}
/** Runs each command in each of its shells from cwd (a Copilot entry from its own cwd, which is the repository root's)
 * and checks the guard answered: it stopped the step, exit 0. */
function runsEverywhere(list, cwd, { root = cwd, extraEnv = {} } = {}) {
  let runs = 0;
  for (const [agent, command, shells, entryCwd] of list)
    for (const sh of shells) {
      const [exe, args, o] = SHELL[sh](command),
        at = entryCwd ? join(root, entryCwd) : cwd;
      const r = spawnSync(exe, args, {
        ...o,
        cwd: at,
        encoding: "utf8",
        input: JSON.stringify({ ...PAYLOAD[agent], cwd: at }),
        env: { ...env(tmp()), ...extraEnv },
        timeout: 60000,
      });
      const said = `${agent} in ${sh}: ${command}\nexit ${r.status}\n${r.stdout}\n${r.stderr}`;
      assert.equal(r.status, 0, said);
      assert.ok(STOPPED[agent](JSON.parse(r.stdout)), said);
      runs++;
    }
  return runs;
}

test("a home folder with letters outside ASCII gets the whole skill (Node 24's cpSync writes to a garbled folder on Windows)", async () => {
  const home = join(tmp(), "José D’Souza"),
    cwd = tmp();
  mkdirSync(home);
  await node([BIN, "--agent", "codex", "--yes"], { env: env(home), cwd });
  assert.ok(existsSync(join(home, ".agents", "skills", "seo-supervisor", "scripts", "guard.mjs")));
  assert.ok(existsSync(join(home, ".agents", "skills", "seo-supervisor", ".seo-supervisor-install.json")));
});

for (const name of ["D'Souza", "A&B", "x(1)", "D’Souza", "Sam Lee"]) {
  test(`every hook command quotes the guard's path for its shell: a home folder named ${name}`, async () => {
    // Copilot's preToolUse denies the tool when its hook fails, so a path that breaks the command line stops every tool
    // call; elsewhere the guard silently doesn't run.
    // https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference
    const home = join(tmp(), name),
      cwd = tmp();
    mkdirSync(home);
    await node([BIN, "--agent", "codex,cursor,github-copilot,devin", "--yes"], { env: env(home), cwd });
    const runs = runsEverywhere(hookCommands(home, "user"), cwd);
    assert.ok(runs >= 4, `${runs} shell runs`);
  });
}

test("Devin: a stop is decision block with exit 0, which every shell passes through (PowerShell turns exit 2 into 1)", () => {
  // A Devin hook blocks by exiting 2 or printing a "decision": "block" object; any other non-zero exit is only logged.
  // https://docs.devin.ai/cli/extensibility/hooks/overview
  const r = devin.respond(ASK);
  assert.equal(r.exitCode, 0);
  assert.equal(JSON.parse(r.stdout).decision, "block");
  assert.match(JSON.parse(r.stdout).reason, /sitemap.*Ask the owner in chat/s);
});
