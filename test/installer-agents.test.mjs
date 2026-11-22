// @ts-check
// The guard's adapters for other agents, and the commands, subagents and hooks the installer writes for them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, SCRIPTS, node, tmp } from "./helpers.mjs";
import { AGENTS, agentByKey, targetsFor } from "../bin/agents.mjs";
import { commandFile, subagentFile } from "../bin/extras.mjs";
import * as codex from "../skills/seo-supervisor/scripts/guard/adapters/codex.mjs";
import * as cursor from "../skills/seo-supervisor/scripts/guard/adapters/cursor.mjs";
import * as copilot from "../skills/seo-supervisor/scripts/guard/adapters/copilot.mjs";
import * as devin from "../skills/seo-supervisor/scripts/guard/adapters/devin.mjs";
import * as cline from "../skills/seo-supervisor/scripts/guard/adapters/cline.mjs";
import { patchActions } from "../skills/seo-supervisor/scripts/guard/adapters/edits.mjs";

const BIN = join(ROOT, "bin", "seo-supervisor.mjs");
const env = home => {
  const e = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "APPDATA", "GROK_HOME", "COPILOT_HOME"])
    delete e[k];
  return e;
};
const ASK = { decision: "ask", reason: "Submitting the sitemap to Google needs the owner's yes.", rule: "outside" };
const DENY = {
  decision: "deny",
  reason: "That message holds an API key. Use connect-keys set <service> instead.",
  rule: "key",
};
const ALLOW = { decision: "allow" };
const out = r => JSON.parse(r.stdout);
const site = () => {
  const d = tmp();
  writeFileSync(join(d, "robots.txt"), "User-agent: *\nAllow: /\n");
  return d;
};

// ---- adapters, against the sample payloads in each vendor's docs ----

test("Codex: Bash and apply_patch become actions; deny and ask both block, a prompt is blocked with decision block", () => {
  // Common fields plus tool_name, tool_use_id and tool_input.command. https://learn.chatgpt.com/docs/hooks
  const bash = {
    session_id: "s1",
    transcript_path: null,
    cwd: "/project",
    hook_event_name: "PreToolUse",
    model: "gpt-5.5",
    turn_id: "t1",
    tool_name: "Bash",
    tool_use_id: "u1",
    tool_input: { command: "node scripts/indexnow.mjs --yes" },
  };
  assert.deepEqual(codex.toActions(bash, "PreToolUse", "/project"), [
    { kind: "bash", command: "node scripts/indexnow.mjs --yes" },
  ]);
  const d = out(codex.respond(DENY, "PreToolUse"));
  assert.equal(d.hookSpecificOutput.permissionDecision, "deny");
  assert.match(d.hookSpecificOutput.permissionDecisionReason, /API key/);
  const a = out(codex.respond(ASK, "PreToolUse"));
  assert.equal(a.hookSpecificOutput.permissionDecision, "deny", "Codex doesn't support ask yet: it's a stop");
  assert.match(a.hookSpecificOutput.permissionDecisionReason, /sitemap.*Ask the owner in chat/s);
  assert.deepEqual(codex.respond(ALLOW, "PreToolUse"), { stdout: "", stderr: "", exitCode: 0 });

  const dir = site();
  const patch = {
    ...bash,
    cwd: dir,
    tool_name: "apply_patch",
    tool_input: {
      command:
        "*** Begin Patch\n*** Update File: robots.txt\n@@\n User-agent: *\n-Allow: /\n+Disallow: /\n*** End Patch\n",
    },
  };
  assert.deepEqual(codex.toActions(patch, "PreToolUse", dir), [
    {
      kind: "edit",
      file: join(dir, "robots.txt"),
      before: "User-agent: *\nAllow: /\n",
      after: "User-agent: *\nDisallow: /\n",
    },
  ]);
  assert.deepEqual(codex.toActions({ ...bash, tool_name: "Read" }, "PreToolUse", dir), [], "other tools are no action");

  assert.deepEqual(
    codex.toActions(
      { ...bash, hook_event_name: "UserPromptSubmit", prompt: "my key is sk-abc" },
      "UserPromptSubmit",
      dir,
    ),
    [{ kind: "prompt", text: "my key is sk-abc" }],
  );
  assert.equal(out(codex.respond(DENY, "UserPromptSubmit")).decision, "block");
});

test("apply_patch: added, deleted and moved files, and hunks that don't match the file on disk", () => {
  const dir = site();
  const acts = patchActions(
    [
      "*** Begin Patch",
      "*** Add File: app/robots.ts",
      "+export default {}",
      "*** Delete File: pages/old.html",
      "*** Update File: pages/a.html",
      "*** Move to: pages/b.html",
      "@@",
      "-<title>A</title>",
      "+<title>B</title>",
      "*** End Patch",
    ].join("\n"),
    dir,
  );
  assert.deepEqual(
    acts,
    [
      { kind: "edit", file: join(dir, "app", "robots.ts"), before: "", after: "export default {}" },
      { kind: "delete", file: join(dir, "pages", "old.html") },
      { kind: "edit", file: join(dir, "pages", "b.html"), before: "<title>A</title>", after: "<title>B</title>" },
      { kind: "delete", file: join(dir, "pages", "a.html") },
    ],
    "a move also removes the old page",
  );
});

test("Cursor: the shell hook can ask, an edit can only be stopped, and every answer is JSON", () => {
  // beforeShellExecution input and the preToolUse sample. https://cursor.com/docs/hooks
  const shell = { command: "node scripts/gsc.mjs submit-sitemap --yes", cwd: "/project", sandbox: false };
  assert.deepEqual(cursor.toActions(shell, "beforeShellExecution", "/project"), [
    { kind: "bash", command: shell.command },
  ]);
  const a = out(cursor.respond(ASK, "beforeShellExecution"));
  assert.equal(a.permission, "ask");
  assert.match(a.user_message, /sitemap/);
  assert.doesNotMatch(a.agent_message, /yes\/no box/, "Cursor shows the ask itself");
  assert.deepEqual(
    out(cursor.respond(ALLOW, "beforeShellExecution")),
    { permission: "allow" },
    "silence would be invalid JSON, which blocks",
  );

  const dir = site();
  const write = {
    tool_name: "Write",
    tool_input: { file_path: join(dir, "robots.txt"), contents: "User-agent: *\nDisallow: /\n" },
    tool_use_id: "abc123",
    cwd: dir,
    model: "m",
  };
  assert.deepEqual(cursor.toActions(write, "preToolUse", dir), [
    {
      kind: "edit",
      file: join(dir, "robots.txt"),
      before: "User-agent: *\nAllow: /\n",
      after: "User-agent: *\nDisallow: /\n",
    },
  ]);
  const e = out(cursor.respond(ASK, "preToolUse"));
  assert.equal(e.permission, "deny", "preToolUse doesn't enforce ask today");
  assert.match(e.agent_message, /Ask the owner in chat/);
  assert.deepEqual(
    cursor.toActions({ ...write, tool_name: "Delete", tool_input: { path: "pages/a.html" } }, "preToolUse", dir),
    [{ kind: "delete", file: join(dir, "pages", "a.html") }],
  );

  const prompt = { prompt: "here's my key", attachments: [{ type: "file", file_path: "/project/a.md" }] };
  assert.deepEqual(cursor.toActions(prompt, "beforeSubmitPrompt", dir), [{ kind: "prompt", text: "here's my key" }]);
  assert.equal(out(cursor.respond(DENY, "beforeSubmitPrompt")).continue, false);
  assert.deepEqual(out(cursor.respond(ALLOW, "beforeSubmitPrompt")), { continue: true });
});

test("Copilot: toolArgs as a JSON string, ask and deny, and a key held back from the model", () => {
  // The camelCase preToolUse input.
  // https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference
  const bash = {
    sessionId: "s1",
    timestamp: 1767225600000,
    cwd: "/project",
    toolName: "bash",
    toolArgs: JSON.stringify({ command: "git rm pages/about.html" }),
  };
  assert.deepEqual(copilot.toActions(bash, "preToolUse", "/project"), [
    { kind: "bash", command: "git rm pages/about.html" },
  ]);
  assert.deepEqual(out(copilot.respond(ASK, "preToolUse")).permissionDecision, "ask");
  assert.equal(out(copilot.respond(DENY, "preToolUse")).permissionDecision, "deny");
  assert.equal(copilot.respond(ALLOW, "preToolUse").stdout, "", "empty output keeps the default");

  const dir = site();
  const edit = {
    ...bash,
    cwd: dir,
    toolName: "edit",
    toolArgs: { path: "robots.txt", old_str: "Allow: /", new_str: "Disallow: /" },
  };
  assert.deepEqual(copilot.toActions(edit, "preToolUse", dir), [
    {
      kind: "edit",
      file: join(dir, "robots.txt"),
      before: "User-agent: *\nAllow: /\n",
      after: "User-agent: *\nDisallow: /\n",
    },
  ]);
  assert.deepEqual(copilot.toActions({ ...edit, toolName: "view" }, "preToolUse", dir), []);

  const prompt = { sessionId: "s1", timestamp: 1, cwd: dir, prompt: "key: AIzaSy…", transformedPrompt: "key: AIzaSy…" };
  assert.deepEqual(copilot.toActions(prompt, "userPromptTransformed", dir), [{ kind: "prompt", text: prompt.prompt }]);
  const held = out(copilot.respond(DENY, "userPromptTransformed")).modifiedTransformedPrompt;
  assert.match(held, /API key/);
  assert.doesNotMatch(held, /AIzaSy/);
});

test("Devin: exec and edits become actions; a stop is exit 2 with decision block", () => {
  // The command hook input sample. https://docs.devin.ai/cli/extensibility/hooks/overview
  const exec = {
    hook_event_name: "PreToolUse",
    tool_name: "exec",
    tool_input: { command: "rm -rf /" },
    session_id: "3f8d1c2a-...",
    prompt_id: "b71e9d40-...",
  };
  assert.deepEqual(devin.toActions(exec, "PreToolUse", "/p"), [{ kind: "bash", command: "rm -rf /" }]);
  const r = devin.respond(ASK, "PreToolUse");
  assert.equal(r.exitCode, 2);
  assert.equal(out(r).decision, "block");
  assert.match(r.stderr, /Ask the owner in chat/);
  assert.deepEqual(devin.respond(ALLOW, "PreToolUse"), { stdout: "", stderr: "", exitCode: 0 });
  const dir = site();
  assert.equal(
    devin.toActions(
      { ...exec, cwd: dir, tool_name: "write", tool_input: { file_path: "robots.txt", content: "" } },
      "PreToolUse",
      dir,
    )[0].after,
    "",
  );
  assert.deepEqual(devin.toActions({ hook_event_name: "UserPromptSubmit", prompt: "hi" }, "UserPromptSubmit", dir), [
    { kind: "prompt", text: "hi" },
  ]);
});

test("Cline: the plugin's payload becomes actions; ask needs the owner's approval and deny skips the call", () => {
  const dir = site();
  assert.deepEqual(
    cline.toActions(
      { tool: "run_commands", input: { commands: ["git mv pages/a.html pages/b.html"] }, cwd: dir },
      "beforeTool",
      dir,
    ),
    [{ kind: "bash", command: "git mv pages/a.html pages/b.html" }],
  );
  assert.deepEqual(
    cline.toActions(
      { tool: "editor", input: { path: "robots.txt", old_text: "Allow", new_text: "Disallow" }, cwd: dir },
      "beforeTool",
      dir,
    )[0].after,
    "User-agent: *\nDisallow: /\n",
  );
  assert.deepEqual(out(cline.respond(ASK)), {
    policy: { autoApprove: false },
    appendContext: `SEO Supervisor guard: ${ASK.reason}`,
  });
  assert.equal(out(cline.respond(DENY)).skip, true);
  assert.equal(cline.respond(ALLOW).stdout, "");
});

// Each adapter runs through guard.mjs's dispatcher, with a stub check and with the real rules, and once through the
// command line the installed hooks use.
const GUARD = join(SCRIPTS, "guard.mjs");
test(
  "guard.mjs runs each adapter, with a stub check and with the real rules",
  { skip: !existsSync(GUARD) && "scripts/guard.mjs is missing" },
  async () => {
    const { run } = await import(pathToFileURL(GUARD).href);
    const r = await run(
      "devin",
      { hook_event_name: "PreToolUse", tool_name: "exec", tool_input: { command: "x" } },
      { check: () => ASK, event: "PreToolUse" },
    );
    assert.equal(r.exitCode, 2);

    const dir = site(),
      opts = event => ({ env: {}, event, cwd: dir }); // no mode set: ask
    const block = "User-agent: *\nDisallow: /\n";
    const cases = [
      [
        "codex",
        "PreToolUse",
        {
          cwd: dir,
          tool_name: "apply_patch",
          tool_input: {
            command:
              "*** Begin Patch\n*** Update File: robots.txt\n@@\n User-agent: *\n-Allow: /\n+Disallow: /\n*** End Patch\n",
          },
        },
        x => out(x).hookSpecificOutput.permissionDecisionReason,
      ],
      [
        "cursor",
        "preToolUse",
        { cwd: dir, tool_name: "Write", tool_input: { file_path: join(dir, "robots.txt"), content: block } },
        x => out(x).agent_message,
      ],
      [
        "copilot",
        "preToolUse",
        {
          cwd: dir,
          toolName: "edit",
          toolArgs: JSON.stringify({ path: "robots.txt", old_str: "Allow: /", new_str: "Disallow: /" }),
        },
        x => out(x).permissionDecisionReason,
      ],
      [
        "devin",
        "PreToolUse",
        { tool_name: "write", tool_input: { file_path: join(dir, "robots.txt"), content: block } },
        x => x.stderr,
      ],
      [
        "cline",
        "beforeTool",
        { tool: "editor", input: { path: "robots.txt", old_text: "Allow: /", new_text: "Disallow: /" }, cwd: dir },
        x => out(x).appendContext,
      ],
    ];
    for (const [agent, event, input, said] of cases)
      assert.match(
        said(await run(agent, input, opts(event))),
        /SEO Supervisor guard: .*(Disallow|drop out)/s,
        `${agent} stops Disallow: /`,
      );
    assert.equal(
      (
        await run(
          "codex",
          { cwd: dir, tool_name: "Bash", tool_input: { command: "node seo-crawl.mjs --url http://localhost:3000" } },
          opts("PreToolUse"),
        )
      ).stdout,
      "",
      "a plain crawl stays silent",
    );
    assert.deepEqual(out(await run("cursor", { command: "npm test", cwd: dir }, opts("beforeShellExecution"))), {
      permission: "allow",
    });
    assert.equal(
      out(await run("cursor", { command: "node scripts/indexnow.mjs --yes", cwd: dir }, opts("beforeShellExecution")))
        .permission,
      "ask",
    );
    const key = await run(
      "copilot",
      { cwd: dir, prompt: "my key is sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD", transformedPrompt: "x" },
      opts("userPromptTransformed"),
    );
    assert.doesNotMatch(out(key).modifiedTransformedPrompt, /abcdefghij/, "the key never reaches the model");

    const cli = spawnSync(process.execPath, [GUARD, "--agent", "cursor", "--event", "beforeShellExecution"], {
      input: JSON.stringify({ command: "git rm pages/about.html", cwd: dir }),
      encoding: "utf8",
      env: { ...process.env, SEO_SUPERVISOR_GUARD: "block" },
    });
    assert.equal(cli.status, 0);
    assert.match(JSON.parse(cli.stdout).agent_message, /set to block/);
  },
);

// ---- the installer ----

const files = dir => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : []);
const EXTRAS = [
  "claude-code",
  "codex",
  "cursor",
  "devin",
  "gemini-cli",
  "antigravity",
  "github-copilot",
  "opencode",
  "cline",
  "roo",
  "augment",
];
const COMMANDS = readdirSync(join(ROOT, "commands"))
  .filter(f => f.endsWith(".md"))
  .map(f => f.slice(0, -3));

for (const scope of ["user", "project"]) {
  test(`${scope} scope: every agent's commands, subagents and guard install, and uninstall leaves the folder empty`, async () => {
    const home = tmp(),
      cwd = tmp(),
      at = scope === "project" ? cwd : home;
    await node([BIN, "--agent", EXTRAS.join(","), "--scope", scope, "--yes"], { env: env(home), cwd });
    const read = p => readFileSync(join(at, p), "utf8");
    for (const c of COMMANDS) {
      assert.ok(
        existsSync(join(at, scope === "user" ? ".config/opencode/commands" : ".opencode/commands", `${c}.md`)),
        `OpenCode /${c}`,
      );
      assert.ok(
        existsSync(join(at, ".roo", "commands", `${c}.md`)) && existsSync(join(at, ".augment", "commands", `${c}.md`)),
        `Roo and Augment /${c}`,
      );
      assert.ok(existsSync(join(at, ".gemini", "commands", `${c}.toml`)), `Gemini CLI /${c}`);
    }
    const hooks = {
      codex: scope === "user" ? ".codex/hooks.json" : ".codex/hooks.json",
      cursor: ".cursor/hooks.json",
      copilot:
        scope === "user" ? ".copilot/hooks/seo-supervisor-guard.json" : ".github/hooks/seo-supervisor-guard.json",
      devin: scope === "user" ? ".config/devin/config.json" : ".devin/hooks.v1.json",
      cline: ".cline/plugins/seo-supervisor-guard.js",
    };
    for (const [agent, p] of Object.entries(hooks))
      assert.match(
        read(p),
        agent === "cline"
          ? /guard\.mjs"[\s\S]*"--agent", "cline", "--event", "beforeTool"/
          : new RegExp(`scripts/guard\\.mjs(\\\\")? --agent ${agent} --event \\w+`),
        `${agent} guard in ${p}`,
      );
    if (scope === "project")
      assert.match(
        read(".cursor/hooks.json"),
        /"node \.agents\/skills\/seo-supervisor\/scripts\/guard\.mjs --agent cursor --event beforeShellExecution"/,
        "a committed project install names the guard relative to the project",
      );
    if (scope === "project")
      assert.match(read(".codex/hooks.json"), /\$\(git rev-parse --show-toplevel\)\/\.agents\/skills/);
    for (const [agent, p] of Object.entries(hooks)) {
      const skill = targetsFor([agentByKey(agent === "copilot" ? "github-copilot" : agent).key], scope, {
        home,
        cwd,
        env: env(home),
      })[0].skills;
      if (scope === "user")
        assert.ok(
          read(p).includes(join(skill, "seo-supervisor", "scripts", "guard.mjs").split("\\").join("/")),
          `${agent}'s guard is its own skill copy`,
        );
    }
    if (existsSync(join(ROOT, "agents")))
      for (const f of readdirSync(join(ROOT, "agents")).filter(f => f.endsWith(".md"))) {
        assert.ok(existsSync(join(at, ".cursor", "agents", f)), `Cursor subagent ${f}`);
        assert.ok(
          existsSync(
            join(at, scope === "user" ? ".copilot/agents" : ".github/agents", f.replace(/\.md$/, ".agent.md")),
          ),
          `Copilot subagent ${f}`,
        );
      }

    if (scope === "project") {
      // again: an update in place
      await node([BIN, "--agent", EXTRAS.join(","), "--scope", scope, "--yes"], { env: env(home), cwd });
      assert.equal(
        (read(".cursor/hooks.json").match(/--agent cursor --event preToolUse/g) || []).length,
        1,
        "no second copy of the guard",
      );
    }

    await node([BIN, "--uninstall", "--scope", scope], { env: env(home), cwd });
    assert.deepEqual(files(at), [], "nothing left behind");
    if (scope === "project") assert.deepEqual(files(home), []);
  });
}

test("--no-guard installs the skill and commands without any hook, and takes out a guard added before", async () => {
  const home = tmp(),
    cwd = tmp();
  await node([BIN, "--agent", "cursor,codex,github-copilot,devin,cline", "--project"], { env: env(home), cwd });
  assert.ok(existsSync(join(cwd, ".cursor", "hooks.json")));
  await node([BIN, "--agent", "cursor,codex,github-copilot,devin,cline,opencode", "--project", "--no-guard"], {
    env: env(home),
    cwd,
  });
  for (const p of [
    ".cursor/hooks.json",
    ".codex/hooks.json",
    ".github/hooks",
    ".devin/hooks.v1.json",
    ".cline/plugins",
  ])
    assert.ok(!existsSync(join(cwd, p)), `${p} is gone`);
  assert.ok(
    existsSync(join(cwd, ".agents", "skills", "seo-supervisor", "SKILL.md")) &&
      existsSync(join(cwd, ".opencode", "commands", "seo-audit.md")),
  );

  const fresh = tmp();
  const { stdout } = await node([BIN, "--agent", "cursor", "--project", "--no-guard"], { env: env(home), cwd: fresh });
  assert.ok(!existsSync(join(fresh, ".cursor", "hooks.json")) && !/guard /.test(stdout), "no hook at all");
});

test("the owner's own hooks are kept: ours are added beside them and taken out again, exactly", async () => {
  const home = tmp(),
    cwd = tmp();
  const owner = {
    ".cursor/hooks.json": {
      version: 1,
      hooks: {
        beforeShellExecution: [{ command: "./hooks/approve-network.sh", matcher: "curl|wget" }],
        afterFileEdit: [{ command: "./format.sh" }],
      },
    },
    ".codex/hooks.json": {
      description: "team hooks",
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "python3 policy.py" }] }] },
    },
    ".devin/hooks.v1.json": { Stop: [{ matcher: "", hooks: [{ type: "command", command: "./notify.sh" }] }] },
  };
  for (const [p, o] of Object.entries(owner)) {
    mkdirSync(join(cwd, p, ".."), { recursive: true });
    writeFileSync(join(cwd, p), JSON.stringify(o));
  }
  const devinUser = join(home, ".config", "devin", "config.json");
  mkdirSync(join(devinUser, ".."), { recursive: true });
  writeFileSync(devinUser, JSON.stringify({ theme: "dark" }));

  await node([BIN, "--agent", "cursor,codex,devin", "--project"], { env: env(home), cwd });
  await node([BIN, "--agent", "devin", "--yes"], { env: env(home), cwd });
  const cur = JSON.parse(readFileSync(join(cwd, ".cursor/hooks.json"), "utf8"));
  assert.deepEqual(cur.hooks.afterFileEdit, owner[".cursor/hooks.json"].hooks.afterFileEdit);
  assert.equal(cur.hooks.beforeShellExecution.length, 2, "the owner's shell hook and ours");
  assert.equal(JSON.parse(readFileSync(join(cwd, ".codex/hooks.json"), "utf8")).hooks.PreToolUse.length, 2);
  assert.ok(JSON.parse(readFileSync(join(cwd, ".devin/hooks.v1.json"), "utf8")).Stop);
  const dv = JSON.parse(readFileSync(devinUser, "utf8"));
  assert.equal(dv.theme, "dark");
  assert.ok(dv.hooks.PreToolUse);

  await node([BIN, "--uninstall", "--project"], { env: env(home), cwd });
  await node([BIN, "--uninstall"], { env: env(home), cwd });
  for (const [p, o] of Object.entries(owner))
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, p), "utf8")), o, `${p} is as the owner had it`);
  assert.deepEqual(JSON.parse(readFileSync(devinUser, "utf8")), { theme: "dark" });
  assert.deepEqual(
    files(cwd).filter(f => !Object.keys(owner).some(p => p.startsWith(f.split("\\").join("/")))),
    [],
    "and nothing else is left",
  );
});

test("a hook file that isn't valid JSON is left alone and reported", async () => {
  const home = tmp(),
    cwd = tmp();
  mkdirSync(join(cwd, ".cursor"));
  writeFileSync(join(cwd, ".cursor", "hooks.json"), "{ not json");
  await assert.rejects(node([BIN, "--agent", "cursor", "--project"], { env: env(home), cwd }), e =>
    /isn't valid JSON/.test(e.stderr),
  );
  assert.equal(readFileSync(join(cwd, ".cursor", "hooks.json"), "utf8"), "{ not json");
});

test("commands are converted for Roo (no $ARGUMENTS) and Gemini CLI (TOML with {{args}})", () => {
  const md =
    '---\ndescription: "Audit this site\'s SEO"\nargument-hint: "[url]"\n---\nUse the **seo-supervisor** skill.\n\nExtra details: $ARGUMENTS\n';
  assert.deepEqual(commandFile("seo-audit.md", md, "md"), { name: "seo-audit.md", text: md });
  assert.doesNotMatch(commandFile("seo-audit.md", md, "roo").text, /\$ARGUMENTS/);
  const toml = commandFile("seo-audit.md", md, "toml");
  assert.equal(toml.name, "seo-audit.toml");
  assert.equal(
    toml.text,
    `description = "Audit this site's SEO"\nprompt = "Use the **seo-supervisor** skill.\\n\\nExtra details: {{args}}"\n`,
  );
  // Every real command converts, whatever commands/ holds.
  for (const f of COMMANDS)
    assert.match(
      commandFile(`${f}.md`, readFileSync(join(ROOT, "commands", `${f}.md`), "utf8"), "toml").text,
      /^description = ".+"\nprompt = ".*\{\{args\}\}/s,
      f,
    );
});

test("subagents are converted for Cursor, OpenCode and Copilot", () => {
  // A fixture in Claude Code's subagent format, so the test doesn't depend on agents/seo-reviewer.md.
  const md =
    "---\nname: seo-reviewer\ndescription: Reviews a diff or PR for SEO problems.\ntools: Read, Grep, Glob, Bash\nmodel: sonnet\n---\nUse the seo-supervisor skill in review mode.\n";
  const cur = subagentFile(md, "cursor"),
    oc = subagentFile(md, "opencode"),
    cp = subagentFile(md, "copilot");
  assert.equal(cur.name, "seo-reviewer.md");
  assert.match(
    cur.text,
    /^---\nname: seo-reviewer\ndescription: Reviews a diff or PR for SEO problems\.\nmodel: inherit\n---\nUse the seo-supervisor skill/,
  );
  assert.match(oc.text, /^---\ndescription: Reviews a diff or PR for SEO problems\.\nmode: subagent\n---\n/);
  assert.equal(cp.name, "seo-reviewer.agent.md");
  for (const f of [cur, oc, cp])
    assert.doesNotMatch(f.text, /tools:|model: sonnet/, "Claude's tool names and models don't carry over");
  assert.equal(subagentFile("no frontmatter", "cursor"), null);
  // The plugin's real subagents name ${CLAUDE_PLUGIN_ROOT}, which only Claude Code fills in.
  for (const f of existsSync(join(ROOT, "agents")) ? readdirSync(join(ROOT, "agents")) : []) {
    const t = subagentFile(
      readFileSync(join(ROOT, "agents", f), "utf8"),
      "cursor",
      ".agents/skills/seo-supervisor",
    ).text;
    assert.doesNotMatch(t, /\$\{CLAUDE_PLUGIN_ROOT\}|\$\{user_config/, f);
    assert.match(t, /`\.agents\/skills\/seo-supervisor\/SKILL\.md`/, f);
  }
});

test("the agent table: Devin replaces Windsurf (the old key still works), Antigravity and Kiro, shared folders for Goose", async () => {
  assert.equal(agentByKey("windsurf"), agentByKey("devin"));
  assert.equal(agentByKey("kiro-cli").name, "Kiro");
  const c = { home: "/h", cwd: "/p", env: {} };
  assert.equal(targetsFor(["devin"], "user", c)[0].skills, join("/h", ".config", "devin", "skills"));
  assert.equal(
    targetsFor(["devin"], "user", { ...c, env: { APPDATA: "/ad" } })[0].skills,
    join("/ad", "devin", "skills"),
    "%APPDATA%\\devin on Windows",
  );
  assert.equal(targetsFor(["devin"], "project", c)[0].skills, join("/p", ".devin", "skills"));
  assert.equal(targetsFor(["antigravity"], "user", c)[0].skills, join("/h", ".gemini", "config", "skills"));
  assert.equal(targetsFor(["goose"], "user", c)[0].skills, join("/h", ".agents", "skills"));
  assert.equal(targetsFor(["goose"], "project", c)[0].skills, join("/p", ".agents", "skills"));
  assert.ok(
    AGENTS.every(a => a.name.length <= 36),
    "names fit the checklist",
  );

  const home = tmp();
  await node([BIN, "--agent", "windsurf", "--yes"], { env: env(home), cwd: home });
  assert.ok(existsSync(join(home, ".config", "devin", "skills", "seo-supervisor", "SKILL.md")));
});

test("the Cursor example hook runs on postToolUse, whose output reaches the agent", () => {
  const h = JSON.parse(
    readFileSync(join(ROOT, "skills", "seo-supervisor", "examples", "hooks", "cursor-hooks.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(h.hooks), ["postToolUse"]);
  assert.match(h.hooks.postToolUse[0].command, /schema-check\.mjs --hook cursor$/);
});
