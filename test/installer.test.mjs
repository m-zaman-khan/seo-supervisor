import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { AGENTS, detectAgents, targetsFor } from "../bin/agents.mjs";
import { multiSelect, select } from "../bin/prompt.mjs";
import { ROOT, node, tmp } from "./helpers.mjs";

const BIN = join(ROOT, "bin", "seo-supervisor.mjs");
// A clean environment: no real agent folders or overrides can leak into a test.
const env = home => {
  const e = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "APPDATA", "GROK_HOME"]) delete e[k];
  return e;
};
const ctx = (home, cwd = home) => ({ home, cwd, env: env(home) });

test("every agent has a key, a name and both skill folders", () => {
  assert.ok(AGENTS.length >= 15);
  for (const a of AGENTS) assert.ok(a.key && a.name && a.user && a.project, a.key);
  for (const key of ["claude-code", "codex", "cursor", "windsurf", "gemini-cli", "github-copilot", "opencode", "grok"])
    assert.ok(
      AGENTS.some(a => a.key === key),
      key,
    );
});

test("agents are detected from their folders in the home directory", () => {
  const home = tmp();
  for (const d of [".cursor", ".codex", join(".config", "opencode")]) mkdirSync(join(home, d), { recursive: true });
  const found = detectAgents(ctx(home));
  for (const key of ["cursor", "codex", "opencode"]) assert.ok(found.includes(key), key);
  assert.ok(!found.includes("windsurf") && !found.includes("claude-code"));
  const codexHome = tmp();
  assert.ok(
    detectAgents({ ...ctx(tmp()), env: { ...env(tmp()), CODEX_HOME: codexHome } }).includes("codex"),
    "CODEX_HOME is respected",
  );
});

test("targets give each agent its own folder, share folders once, and send commands to Claude Code", () => {
  const home = tmp(),
    cwd = tmp();
  const project = targetsFor(["claude-code", "codex", "cursor"], "project", ctx(home, cwd));
  const shared = project.find(t => t.skills === join(cwd, ".agents", "skills"));
  assert.deepEqual(shared.agents, ["Codex", "Cursor"], "Codex and Cursor share .agents/skills in a project");
  const claude = project.find(t => t.skills === join(cwd, ".claude", "skills"));
  assert.equal(claude.commands, join(cwd, ".claude", "commands"));
  assert.equal(project.length, 2);

  const user = targetsFor(["codex", "cursor"], "user", ctx(home, cwd));
  assert.deepEqual(
    user.map(t => t.skills).sort(),
    [join(home, ".agents", "skills"), join(home, ".cursor", "skills")].sort(),
  );
  assert.ok(
    user.every(t => !t.commands),
    "only Claude Code gets slash commands",
  );
});

// Keys as a terminal sends them.
const DOWN = "\x1b[B",
  SPACE = " ",
  ENTER = "\r";
const keys = (input, ...seq) => {
  let i = 0;
  const next = () => {
    if (i < seq.length) {
      input.write(seq[i++]);
      setImmediate(next);
    }
  };
  setImmediate(next);
};

test("the checklist toggles with space, selects all with a, and confirms with enter", async () => {
  const items = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
    { value: "c", label: "C" },
  ];
  let input = new PassThrough(),
    output = new PassThrough();
  let picked = multiSelect({ message: "Agents", items, selected: ["a"], input, output });
  keys(input, DOWN, SPACE, ENTER);
  assert.deepEqual(await picked, ["a", "b"]);

  input = new PassThrough();
  output = new PassThrough();
  picked = multiSelect({ message: "Agents", items, selected: [], input, output });
  keys(input, ENTER, "a", ENTER); // enter with nothing selected is refused
  assert.deepEqual(await picked, ["a", "b", "c"]);
});

test("the single choice moves with the arrows and confirms with enter", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const picked = select({
    message: "Install for",
    items: [
      { value: "user", label: "Me" },
      { value: "project", label: "This project" },
    ],
    input,
    output,
  });
  keys(input, DOWN, ENTER);
  assert.equal(await picked, "project");
});

test("--agent and --scope install straight into those agents' folders, without questions", async () => {
  const home = tmp(),
    cwd = tmp();
  await node([BIN, "--agent", "cursor,codex", "--yes"], { env: env(home), cwd });
  assert.ok(existsSync(join(home, ".cursor", "skills", "seo-supervisor", "SKILL.md")));
  assert.ok(existsSync(join(home, ".agents", "skills", "seo-supervisor", "SKILL.md")));
  assert.ok(!existsSync(join(home, ".claude")), "Claude Code was not chosen");

  await node([BIN, "--agent", "claude-code,cursor", "--scope", "project", "--yes"], { env: env(home), cwd });
  assert.ok(existsSync(join(cwd, ".claude", "skills", "seo-supervisor", "SKILL.md")));
  assert.ok(existsSync(join(cwd, ".claude", "commands", "seo-setup.md")));
  assert.ok(existsSync(join(cwd, ".agents", "skills", "seo-supervisor", "SKILL.md")));

  await node([BIN, "--uninstall", "--scope", "project"], { env: env(home), cwd });
  assert.ok(
    !existsSync(join(cwd, ".claude", "skills", "seo-supervisor")) &&
      !existsSync(join(cwd, ".agents", "skills", "seo-supervisor")),
  );
});

test("without a terminal it installs into the agents it detects", async () => {
  const home = tmp();
  mkdirSync(join(home, ".cursor"), { recursive: true });
  await node([BIN], { env: env(home), cwd: home });
  assert.ok(existsSync(join(home, ".cursor", "skills", "seo-supervisor", "SKILL.md")));
  assert.ok(!existsSync(join(home, ".claude")), "only the detected agent");
});

// A stand-in for npm: records its arguments and exits with the given code. Nothing is downloaded.
function fakeNpm(exit = 0) {
  const dir = tmp(),
    bin = join(dir, "npm.mjs"),
    log = join(dir, "args.json");
  writeFileSync(
    bin,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(${exit});\n`,
  );
  return { bin, args: () => (existsSync(log) ? JSON.parse(readFileSync(log, "utf8")) : null) };
}
const [major, minor] = process.versions.node.split(".").map(Number);
const lighthouseNode = !(major > 22 || (major === 22 && minor >= 19)) && "Lighthouse 13 needs Node 22.19 or later";
const tools = home => join(home, ".seo-supervisor", "tools");

test(
  "--with-lighthouse installs Lighthouse with npm into ~/.seo-supervisor/tools, not the project",
  { skip: lighthouseNode },
  async () => {
    const home = tmp(),
      npm = fakeNpm();
    const r = await node([BIN, "--agent", "cursor", "--with-lighthouse"], {
      env: { ...env(home), SEO_SUPERVISOR_NPM: npm.bin },
      cwd: home,
    });
    assert.deepEqual(npm.args(), ["install", "--prefix", tools(home), "lighthouse@13", "--no-audit", "--no-fund"]);
    assert.match(r.stdout, /Installing Lighthouse/);
    assert.ok(existsSync(join(home, ".cursor", "skills", "seo-supervisor", "SKILL.md")), "the skill is installed too");
  },
);

test("without a terminal, with --yes or with --no-lighthouse, Lighthouse isn't installed", async () => {
  for (const extra of [[], ["--yes"], ["--no-lighthouse"]]) {
    const home = tmp(),
      npm = fakeNpm();
    await node([BIN, "--agent", "cursor", ...extra], { env: { ...env(home), SEO_SUPERVISOR_NPM: npm.bin }, cwd: home });
    assert.equal(npm.args(), null, `npm wasn't called (${extra.join(" ") || "no flags"})`);
  }
});

test("a failed Lighthouse install says so and the skill install still succeeds", { skip: lighthouseNode }, async () => {
  const home = tmp(),
    npm = fakeNpm(1);
  const r = await node([BIN, "--agent", "cursor", "--with-lighthouse"], {
    env: { ...env(home), SEO_SUPERVISOR_NPM: npm.bin },
    cwd: home,
  });
  assert.ok(npm.args(), "npm was called");
  assert.match(r.stdout + r.stderr, /Lighthouse wasn't installed/);
  assert.match(r.stdout + r.stderr, /works without it/);
  assert.match(r.stdout, /installed for Cursor/);
  assert.ok(existsSync(join(home, ".cursor", "skills", "seo-supervisor", "SKILL.md")));
});

test("--uninstall leaves the Lighthouse tools folder alone and says how to remove it", async () => {
  const home = tmp();
  mkdirSync(join(tools(home), "node_modules"), { recursive: true });
  const r = await node([BIN, "--uninstall"], { env: env(home), cwd: home });
  assert.ok(existsSync(tools(home)));
  assert.match(r.stdout, /Lighthouse/);
  assert.match(r.stdout, /~\/\.seo-supervisor\/tools/);
});

test("--with-image-tools installs sharp into the tools folder, not the project", async () => {
  const home = tmp(),
    cwd = tmp(),
    npm = fakeNpm();
  const r = await node([BIN, "--agent", "cursor", "--with-image-tools"], {
    env: { ...env(home), SEO_SUPERVISOR_NPM: npm.bin },
    cwd,
  });
  assert.deepEqual(npm.args(), ["install", "--prefix", tools(home), "sharp@0.35", "--no-audit", "--no-fund"]);
  assert.match(r.stdout, /Installing sharp/);
  assert.ok(existsSync(join(home, ".cursor", "skills", "seo-supervisor", "SKILL.md")), "the skill is installed too");

  const failed = fakeNpm(1);
  const f = await node([BIN, "--agent", "cursor", "--with-image-tools"], {
    env: { ...env(home), SEO_SUPERVISOR_NPM: failed.bin },
    cwd,
  });
  assert.match(f.stdout + f.stderr, /sharp wasn't installed.*works without it/);
  assert.match(f.stdout, /installed for Cursor/, "a failed add-on never fails the install");

  mkdirSync(join(tools(home), "node_modules"), { recursive: true });
  const u = await node([BIN, "--uninstall"], { env: env(home), cwd });
  assert.match(u.stdout, /sharp/, "--uninstall names the image add-on too");
});

test("an unknown agent key fails with the list of valid keys", async () => {
  await assert.rejects(
    node([BIN, "--agent", "notepad", "--yes"], { env: env(tmp()) }),
    err => /Unknown agent: notepad/.test(err.stderr) && /claude-code/.test(err.stderr),
  );
});

test("the install output stays short: no update-notice line (the agent mentions new versions when there are any)", async () => {
  const home = tmp();
  const { stdout } = await node([BIN, "--agent", "cursor", "--yes"], { env: env(home), cwd: home });
  assert.doesNotMatch(stdout, /update notice|update-check/i);
});
