// Guard edge cases: refused edits, pages emptied from the shell, bare hex keys and commands in brackets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, tmp } from "./helpers.mjs";
import { run } from "../skills/seo-supervisor/scripts/guard.mjs";
import { checkAction } from "../skills/seo-supervisor/scripts/guard/rules.mjs";

const dir = tmp();
const check = (a, o = {}) => checkAction(a, { mode: "ask", settings: {}, cwd: dir, ...o });
const bash = command => ({ kind: "bash", command });
const asks = (a, rule) => {
  const r = check(a);
  assert.equal(r.decision, "ask", `${JSON.stringify(a).slice(0, 160)} asks`);
  assert.equal(r.rule, rule);
  assert.ok(r.reason && !/undefined/.test(r.reason));
  return r;
};
const allows = a => assert.equal(check(a).decision, "allow", `${JSON.stringify(a).slice(0, 160)} is allowed`);

test("key: a bare 32-character hex key next to a key word is refused; a commit hash or an MD5 in prose isn't", () => {
  const HEX = "0123456789abcdef0123456789abcdef";
  for (const [text, service] of [
    [`my bing key is ${HEX}`, "bing"],
    [`Matomo token_auth: ${HEX.toUpperCase()}`, "matomo"],
    [`api=${HEX}`, ""],
    [`here's the secret\n${HEX} thanks`, ""],
    [`password "${HEX}"`, ""],
    [`AUTH ${HEX}`, ""],
    [`BING_API_KEY=${HEX}`, "bing"],
  ]) {
    const r = check({ kind: "prompt", text });
    assert.equal(r.decision, "deny", text);
    assert.equal(r.rule, "key", text);
    assert.doesNotMatch(r.reason, /0123|abcdef/i, "no piece of the key is repeated");
    assert.match(r.reason, new RegExp(`connect-keys\\.mjs" set ${service || "<service>"}`), text);
  }
  for (const text of [
    `the file's md5 is ${HEX}`,
    `commit ${HEX} fixed it`,
    `${HEX} is the hash of the build`,
    `my bing key is ${HEX}0`,
    `the key decision, made long ago in ${HEX}`,
    `token: ${HEX.slice(1)}`,
    `key ${"0123456789abcdef".repeat(3)}`,
  ])
    allows({ kind: "prompt", text });
  const t = performance.now();
  allows({ kind: "prompt", text: `api key token ${"0123456789abcdef".repeat(2)}0 `.repeat(20000) });
  assert.ok(
    performance.now() - t < 200,
    `a 1 MB message full of key words is read in under 200 ms (${(performance.now() - t).toFixed(0)} ms)`,
  );
  // The same key piped into connect-keys set, or on its command line.
  const S = "node ~/.claude/skills/seo-supervisor/scripts";
  for (const c of [
    `echo ${HEX} | ${S}/connect-keys.mjs set bing`,
    `printf %s '${HEX}' | ${S}/connect-keys.mjs set matomo --url https://stats.x.com`,
    `${S}/connect-keys.mjs set bing ${HEX}`,
  ]) {
    const r = check(bash(c));
    assert.equal(r.decision, "deny", c);
    assert.equal(r.rule, "key", c);
  }
  allows(bash(`cat key.txt | ${S}/connect-keys.mjs set bing`));
  allows(bash(`git show ${HEX.slice(0, 7)} && ${S}/connect-keys.mjs set bing`));
});

test("page-remove: emptying a page or route file from the shell asks; writing real content to it doesn't", () => {
  for (const c of [
    "> app/about/page.tsx",
    ": > page.html",
    ":>page.html",
    "true > page.html",
    `echo "" > page.html`,
    "echo '' >page.html",
    "echo > page.html",
    "echo -n > page.html",
    `printf '' > page.html`,
    `printf "" > app/about/page.tsx`,
    "cat /dev/null > page.html",
    "type nul > page.html",
    "'' > page.html",
    "$null > page.html",
    "cd app/about && > page.tsx",
    "sudo truncate -s 0 page.html",
    "truncate -s0 page.html",
    "truncate --size=0 pages/a.vue",
    "truncate --size 0 page.html",
    "Clear-Content page.html",
    "Clear-Content -Path app\\about\\page.tsx",
    "clc page.html",
    "Set-Content page.html ''",
    "Set-Content -Path page.html -Value ''",
    "Set-Content -Value '' -Path page.html",
    "Set-Content page.html -Value $null",
    "sc page.html ''",
    "Out-File page.html",
    "Out-File -FilePath page.html",
    "Out-File -FilePath page.html -InputObject ''",
    "'' | Out-File page.html",
    "$null | Out-File -FilePath page.html",
    `echo "" | tee page.html`,
    "'' | Set-Content page.html",
    "cp /dev/null page.html",
    "cp -f /dev/null app/about/page.tsx",
    "copy nul page.html",
    "Copy-Item NUL page.html",
    "Copy-Item -Path /dev/null -Destination page.html",
    "(> page.html)",
    "echo $(: > page.html)",
  ]) {
    const r = asks(bash(c), "page-remove");
    assert.match(r.reason, /empties/, c);
    assert.match(r.reason, /missing page/, c);
  }
  // Emptying robots.txt or _redirects from the shell is removing it.
  asks(bash("> public/robots.txt"), "robots");
  asks(bash("truncate -s 0 _redirects"), "redirects");
  // Near-misses: real content, appending, other files, a size that isn't 0, a copy from a real file.
  for (const c of [
    `echo "<h1>Hi</h1>" > page.html`,
    "echo '<h1>Hi</h1>' > page.html",
    `printf '<p>%s</p>' hi > page.html`,
    "cat header.html body.html > page.html",
    "npm run build > page.html",
    `echo "" >> page.html`,
    ": >> page.html",
    "> build.log",
    ": > notes.txt",
    `echo "" > notes.txt`,
    "truncate -s 10 page.html",
    "truncate -s 0 server.log",
    "Clear-Content notes.txt",
    "Set-Content page.html '<h1>Hi</h1>'",
    "Set-Content -Path page.html -Value '<h1>Hi</h1>'",
    "'<h1>Hi</h1>' | Out-File page.html",
    "Get-Content a.html | Out-File page.html",
    "Out-File page.html -Append",
    "Out-File -FilePath page.html -InputObject '<h1>Hi</h1>'",
    "cat a.html | tee page.html",
    "cp template.html page.html",
    "cp /dev/null notes.txt",
    "ls 2>/dev/null",
    "npm test 2>&1 | tee test.log",
    "node build.mjs > out/index.html",
    `echo "> not a redirect" > notes.txt`,
  ])
    allows(bash(c));
});

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
