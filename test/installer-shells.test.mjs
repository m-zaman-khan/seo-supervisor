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
import * as copilot from "../skills/seo-supervisor/scripts/guard/adapters/copilot.mjs";
import { run } from "../skills/seo-supervisor/scripts/guard.mjs";

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
    [
      "cursor",
      json(join(at, ".cursor", "hooks.json")).hooks.beforeShellExecution[0].command,
      WIN ? ["ps"] : ["sh"],
      scope === "project" ? "." : undefined,
    ],
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

test("Copilot: edits through apply_patch and str_replace_editor are checked, and the installed matcher names both", async () => {
  // Copilot's edit tools are edit, str_replace_editor and apply_patch, and toolArgs is typed unknown: a patch may come
  // as the whole toolArgs or in a field of it.
  // https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference
  const dir = tmp();
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const patch =
    "*** Begin Patch\n*** Update File: robots.txt\n@@\n User-agent: *\n-Allow: /\n+Disallow: /\n*** End Patch\n";
  const want = [
    {
      kind: "edit",
      file: join(dir, "robots.txt"),
      before: "User-agent: *\nAllow: /\n",
      after: "User-agent: *\nDisallow: /\n",
    },
  ];
  assert.deepEqual(
    copilot.toActions({ cwd: dir, toolName: "apply_patch", toolArgs: patch }, "preToolUse", dir),
    want,
    "the patch as toolArgs",
  );
  assert.deepEqual(
    copilot.toActions(
      { cwd: dir, toolName: "apply_patch", toolArgs: JSON.stringify({ input: patch }) },
      "preToolUse",
      dir,
    ),
    want,
    "the patch in a field",
  );
  assert.deepEqual(
    copilot.toActions(
      {
        cwd: dir,
        toolName: "str_replace_editor",
        toolArgs: { command: "str_replace", path: "robots.txt", old_str: "Allow: /", new_str: "Disallow: /" },
      },
      "preToolUse",
      dir,
    ),
    want,
  );
  const r = await run(
    "copilot",
    { cwd: dir, toolName: "apply_patch", toolArgs: patch },
    { env: {}, event: "preToolUse", cwd: dir },
  );
  assert.equal(JSON.parse(r.stdout).permissionDecision, "ask", "the real rules ask before Disallow: /");

  const home = tmp(),
    cwd = tmp();
  await node([BIN, "--agent", "github-copilot", "--project"], { env: env(home), cwd });
  const m = json(join(cwd, ".github", "hooks", "seo-supervisor-guard.json")).hooks.preToolUse[0].matcher;
  for (const t of ["bash", "powershell", "edit", "create", "apply_patch", "str_replace_editor"])
    assert.match(t, new RegExp(`^(?:${m})$`), t);
  assert.doesNotMatch("view", new RegExp(`^(?:${m})$`));
});

test("Cline: the help and the install say its guard runs in Cline's CLI, SDK and Kanban, not the VS Code or JetBrains extension", async () => {
  // Cline's plugins work only in its SDK, CLI and Kanban, not in the VS Code or JetBrains extensions.
  // https://docs.cline.bot/customization/plugins
  const says = /Cline[^.]*CLI, SDK and Kanban[^.]*not[^.]*VS Code or JetBrains extension/;
  assert.match((await node([BIN, "--help"])).stdout.replace(/\s+/g, " "), says);
  const home = tmp();
  assert.match(
    (await node([BIN, "--agent", "cline", "--yes"], { env: env(home), cwd: home })).stdout.replace(/\s+/g, " "),
    says,
  );
  assert.doesNotMatch(
    (await node([BIN, "--agent", "cline", "--yes", "--no-guard"], { env: env(home), cwd: home })).stdout,
    /Kanban/,
    "no guard, no note",
  );
});

test("uninstall also removes the copies v1.x put in Windsurf's and Goose's old skill folders, and nothing else there", async () => {
  const home = tmp(),
    cwd = tmp();
  const old = [
    join(home, ".codeium", "windsurf", "skills"),
    join(home, ".config", "goose", "skills"),
    join(cwd, ".windsurf", "skills"),
    join(cwd, ".goose", "skills"),
  ];
  for (const d of old)
    for (const name of ["seo-supervisor", "mine"]) {
      mkdirSync(join(d, name), { recursive: true });
      writeFileSync(join(d, name, "SKILL.md"), `---\nname: ${name}\n---\n`);
    }
  const user = await node([BIN, "--uninstall"], { env: env(home), cwd });
  await node([BIN, "--uninstall", "--project"], { env: env(home), cwd });
  for (const d of old) {
    assert.ok(!existsSync(join(d, "seo-supervisor")), `${d}: ours is gone`);
    assert.ok(existsSync(join(d, "mine", "SKILL.md")), `${d}: the owner's skill stays`);
  }
  assert.match(user.stdout, /removed +~\/\.codeium\/windsurf\/skills\/seo-supervisor/);
});

test("owner hook files keep their look: Cursor's version, their indent, a BOM and CRLF; uninstall gives them back byte for byte", async () => {
  const home = tmp(),
    cwd = tmp();
  const cursorFile = join(cwd, ".cursor", "hooks.json"),
    devinFile = join(cwd, ".devin", "hooks.v1.json"),
    codexFile = join(cwd, ".codex", "hooks.json");
  for (const f of [cursorFile, devinFile, codexFile]) mkdirSync(join(f, ".."), { recursive: true });
  const devinText =
    "﻿" +
    JSON.stringify({ Stop: [{ matcher: "", hooks: [{ type: "command", command: "./notify.sh" }] }] }, null, 4).replace(
      /\n/g,
      "\r\n",
    ) +
    "\r\n";
  const codexText = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } }); // one line, no newline
  writeFileSync(cursorFile, "{}\n");
  writeFileSync(devinFile, devinText);
  writeFileSync(codexFile, codexText);
  await node([BIN, "--agent", "cursor,devin,codex", "--project"], { env: env(home), cwd });
  // Cursor requires version, a positive integer (1). https://cursor.com/docs/hooks
  assert.equal(json(cursorFile).version, 1);
  const d = readFileSync(devinFile, "utf8");
  assert.ok(
    d.startsWith('﻿{\r\n    "Stop"') && d.endsWith("}\r\n") && !/[^\r]\n/.test(d),
    "the BOM, CRLF and four spaces stay",
  );
  assert.ok(json(devinFile).PreToolUse);
  assert.ok(!readFileSync(codexFile, "utf8").includes("\n"), "a one-line file stays one line");
  await node([BIN, "--uninstall", "--project"], { env: env(home), cwd });
  assert.equal(readFileSync(devinFile, "utf8"), devinText, "byte for byte");
  assert.equal(readFileSync(codexFile, "utf8"), codexText);
  assert.equal(json(cursorFile).version, 1);
});

test("uninstall says kept for an owner's hook file it took the guard out of, and removed for files it deleted", async () => {
  const home = tmp(),
    cwd = tmp();
  mkdirSync(join(cwd, ".cursor"));
  writeFileSync(
    join(cwd, ".cursor", "hooks.json"),
    JSON.stringify({ version: 1, hooks: { stop: [{ command: "./mine.sh" }] } }),
  );
  await node([BIN, "--agent", "cursor,github-copilot", "--project"], { env: env(home), cwd });
  const { stdout } = await node([BIN, "--uninstall", "--project"], { env: env(home), cwd });
  const line = f => stdout.split("\n").find(l => l.replace(/\\/g, "/").includes(f)) || "";
  assert.match(line(".cursor/hooks.json"), /^kept +\S.*hooks\.json +\(the guard is out; your own hooks stay\)/);
  assert.match(line(".github/hooks/seo-supervisor-guard.json"), /^removed +/);
});

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

test("a project install's guard runs when the agent starts in a subfolder, in each shell, and in a teammate's clone", async () => {
  const home = tmp(),
    project = join(tmp(), "site"),
    sub = join(project, "src", "app");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(project, "robots.txt"), "User-agent: *\nAllow: /\n");
  await node([BIN, "--agent", "codex,cursor,github-copilot,devin,cline", "--project"], {
    env: env(home),
    cwd: project,
  });
  for (const f of [
    ".codex/hooks.json",
    ".cursor/hooks.json",
    ".github/hooks/seo-supervisor-guard.json",
    ".devin/hooks.v1.json",
    ".cline/plugins/seo-supervisor-guard.js",
  ]) {
    const t = readFileSync(join(project, f), "utf8");
    assert.ok(
      !t.includes(project) && !t.includes(project.split("\\").join("/")) && !t.includes(home),
      `${f} names no folder of this machine`,
    );
  }
  const clone = join(tmp(), "teammate's copy");
  cpSync(project, clone, { recursive: true });
  for (const root of [project, clone]) {
    const from = join(root, "src", "app");
    runsEverywhere(hookCommands(root, "project"), from, { root });
    // Devin sets DEVIN_PROJECT_DIR to the project root. https://docs.devin.ai/cli/extensibility/hooks/overview
    const dv = hookCommands(root, "project").filter(([a]) => a === "devin");
    runsEverywhere(dv, tmp(), { root, extraEnv: { DEVIN_PROJECT_DIR: root } });

    // Cline's plugin runs in a worker inside Cline, with the session's folder as ctx.cwd.
    // https://docs.cline.bot/sdk/plugins
    const plugin = (
      await import(pathToFileURL(join(root, ".cline", "plugins", "seo-supervisor-guard.js")).href + `?${Math.random()}`)
    ).default;
    plugin.setup({}, { cwd: from });
    const r = plugin.hooks.beforeTool({
      toolCall: { name: "editor" },
      input: { path: join(root, "robots.txt"), old_text: "Allow: /", new_text: "Disallow: /" },
    });
    assert.ok(r && (r.skip || r.policy), `Cline's guard answered from a subfolder of ${root}: ${JSON.stringify(r)}`);
  }
});

test("Devin: a stop is decision block with exit 0, which every shell passes through (PowerShell turns exit 2 into 1)", () => {
  // A Devin hook blocks by exiting 2 or printing a "decision": "block" object; any other non-zero exit is only logged.
  // https://docs.devin.ai/cli/extensibility/hooks/overview
  const r = devin.respond(ASK);
  assert.equal(r.exitCode, 0);
  assert.equal(JSON.parse(r.stdout).decision, "block");
  assert.match(JSON.parse(r.stdout).reason, /sitemap.*Ask the owner in chat/s);
});
