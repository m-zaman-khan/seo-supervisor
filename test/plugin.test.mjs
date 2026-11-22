// hooks/hooks.json, the subagents and the plugin settings, against the formats in the Claude Code docs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.mjs";

const json = p => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const hooks = json("hooks/hooks.json").hooks;
const groups = Object.entries(hooks).flatMap(([event, gs]) => gs.map(g => ({ event, ...g })));
const handlers = groups.flatMap(g => g.hooks.map(h => ({ event: g.event, matcher: g.matcher, ...h })));
// A permission-rule pattern: * is any text; a trailing " *" also matches the bare command; **/ is any folder.
// https://code.claude.com/docs/en/permissions
const ruleRe = p =>
  new RegExp(
    `^${p
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/ \*$/, "( .*)?")
      .replace(/\*\*\//g, "(.*/)?")
      .replace(/(?<!\.)\*/g, "[^]*")}$`,
    "i",
  );
const ifs = tool =>
  handlers
    .filter(h => h.event === "PreToolUse" && h.if?.startsWith(`${tool}(`))
    .map(h => ruleRe(h.if.slice(tool.length + 1, -1)));
const fires = (tool, s) => ifs(tool).some(re => re.test(s));

test("hooks.json: the documented shape, and every command runs a real file through node in exec form", () => {
  assert.deepEqual(Object.keys(hooks).sort(), ["PostToolUse", "PreToolUse", "Stop", "UserPromptSubmit"]);
  for (const g of groups) {
    if (["UserPromptSubmit", "Stop"].includes(g.event))
      assert.equal(g.matcher, undefined, `${g.event} has no matcher support`);
    else assert.match(g.matcher, /^[A-Za-z|]+$/, "an exact tool list");
  }
  for (const h of handlers) {
    assert.equal(h.type, "command");
    assert.equal(h.command, "node");
    assert.ok(
      Array.isArray(h.args) && h.args[0].startsWith("${CLAUDE_PLUGIN_ROOT}/"),
      "exec form, so the path needs no quoting",
    );
    assert.ok(existsSync(join(ROOT, h.args[0].slice("${CLAUDE_PLUGIN_ROOT}/".length))), `${h.args[0]} exists`);
    assert.ok(h.timeout > 0 && h.timeout <= 30, "a short timeout: a stuck hook fails open");
    if (h.if) {
      assert.ok(["PreToolUse", "PostToolUse"].includes(h.event), "if only on tool events");
      assert.match(h.if, new RegExp(`^(${h.matcher})\\(.+\\)$`), `${h.if} names its group's tool`);
    }
    assert.doesNotMatch(JSON.stringify(h), /user_config/, "the mode comes from CLAUDE_PLUGIN_OPTION_GUARD_MODE");
  }
  const guard = handlers.filter(h => /guard\.mjs$/.test(h.args[0]));
  for (const h of guard) assert.deepEqual(h.args.slice(1), ["--agent", "claude-code"]);
  assert.ok(
    handlers.some(h => h.event === "PostToolUse" && /schema-check\.mjs$/.test(h.args[0]) && h.args[1] === "--hook"),
    "PostToolUse runs the structured data check",
  );
  assert.ok(
    handlers.filter(h => h.event === "PreToolUse").every(h => h.if),
    "PreToolUse never starts Node without an if filter",
  );
});

test("hooks.json: the if filters start the guard for what it guards and not for everyday work", () => {
  for (const c of [
    "node scripts/rdap.mjs --site https://x.com --yes",
    "node scripts/seo-crawl.mjs https://x.com --outside",
    "node scripts/schema-check.mjs https://x.com --allow-remote",
    "node scripts/log-scan.mjs --log a.log --verify-ips",
    "node scripts/connect-keys.mjs set openai sk-x",
    "rm app/blog/page.tsx",
    "rm -rf app/blog",
    "git rm content/a.md",
    "git mv pages/a.tsx pages/b.tsx",
    "mv a.html b.html",
    "del old.html",
  ])
    assert.ok(fires("Bash", c), `Bash: ${c}`);
  for (const c of [
    "Remove-Item -Path src/pages/a.astro",
    "Move-Item a.html b.html",
    "node scripts\\rdap.mjs --yes",
    "git rm a.md",
  ])
    assert.ok(fires("PowerShell", c), `PowerShell: ${c}`);
  for (const c of [
    "npm test",
    "git status",
    "ls -la",
    "node scripts/seo-crawl.mjs http://localhost:3000",
    "cat robots.txt",
    "npm run build",
  ])
    assert.ok(!fires("Bash", c), `not for: ${c}`);
  const files = [
    "public/robots.txt",
    "app/robots.ts",
    "next.config.mjs",
    "astro.config.mjs",
    "nuxt.config.ts",
    "public/_redirects",
    "public/_headers",
    ".htaccess",
    "vercel.json",
    "netlify.toml",
    "firebase.json",
    "staticwebapp.config.json",
    "web.config",
    "Caddyfile",
    "nginx.conf",
    "config/routes.rb",
    "app/urls.py",
    "app/blog/page.tsx",
    "src/pages/index.astro",
    "pages/a.vue",
    "src/routes/+page.svelte",
    "content/a.md",
    "content/b.mdx",
    "index.html",
    "a.htm",
    "views/layout.erb",
    "theme/layout.liquid",
    "_includes/head.njk",
    "about.php",
    "public/sitemap.xml",
    "templates/base.hbs",
    "app/layout.jsx",
    "src/head.mjs",
    "lib/seo.cjs",
  ];
  for (const f of files) assert.ok(fires("Edit", f), `Edit: ${f}`);
  for (const f of [
    "src/styles.css",
    "Dockerfile",
    "public/logo.png",
    "data/prices.csv",
    "main.go",
    ".env",
    "package.json",
  ])
    assert.ok(!fires("Edit", f), `PreToolUse not for: ${f}`);
});

test("agents: two subagents with a clear description, limited tools, maxTurns, and the skill referred to, not copied", () => {
  const files = readdirSync(join(ROOT, "agents")).sort();
  assert.deepEqual(files, ["seo-auditor.md", "seo-reviewer.md"]);
  const TOOLS = new Set(["Read", "Grep", "Glob", "Bash", "Write", "Edit", "PowerShell", "WebFetch", "WebSearch"]);
  // The fields plugin agents support; hooks, mcpServers, permissionMode and initialPrompt are ignored there.
  // https://code.claude.com/docs/en/plugins-reference
  const KEYS = new Set([
    "name",
    "description",
    "model",
    "effort",
    "maxTurns",
    "autoCompactWindow",
    "tools",
    "disallowedTools",
    "skills",
    "memory",
    "background",
    "omitClaudeMd",
    "isolation",
    "color",
  ]);
  for (const f of files) {
    const text = readFileSync(join(ROOT, "agents", f), "utf8"),
      m = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/.exec(text);
    assert.ok(m, `${f} has frontmatter`);
    const fm = Object.fromEntries(
      m[1].split("\n").map(l => {
        const i = l.indexOf(":");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
    );
    for (const k of Object.keys(fm)) assert.ok(KEYS.has(k), `${f}: ${k} is a supported field`);
    assert.equal(fm.name, f.replace(/\.md$/, ""));
    assert.doesNotMatch(fm.name, /:/);
    assert.ok(
      fm.description.length > 80 && /^(Runs|Reviews)/.test(fm.description) && /Use (when|after)/.test(fm.description),
      `${f}: says what it does and when to use it`,
    );
    const tools = fm.tools.split(/,\s*/);
    assert.ok(
      tools.every(t => TOOLS.has(t)) && tools.length <= 6 && !tools.includes("Edit"),
      `${f}: a short tool list, no Edit`,
    );
    assert.ok(Number(fm.maxTurns) > 0 && Number(fm.maxTurns) <= 100, `${f}: maxTurns`);
    const body = m[2];
    assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/seo-supervisor\/SKILL\.md/, `${f} follows SKILL.md`);
    assert.match(body, /seo-audit\//, `${f} writes under seo-audit/`);
    assert.match(body, /short summary/i);
    assert.match(body, /Never add `--yes`/);
    assert.ok(body.length < 3000, `${f} refers to the skill instead of copying it`);
  }
  assert.match(
    readFileSync(join(ROOT, "agents", "seo-auditor.md"), "utf8"),
    /\$\{user_config\.site_url\}/,
    "the auditor reads the site setting",
  );
});

test("plugin.json: userConfig asks for the site address and the guard mode (default ask), and package.json ships hooks and agents", () => {
  const plugin = json(".claude-plugin/plugin.json"),
    pkg = json("package.json");
  assert.ok(plugin.version, "a version");
  const cfg = plugin.userConfig;
  assert.deepEqual(Object.keys(cfg).sort(), ["guard_mode", "site_url"]);
  // Each option is a strict object: an unknown key stops the plugin loading.
  // https://code.claude.com/docs/en/plugins-reference
  const OPTION = new Set([
    "type",
    "title",
    "description",
    "required",
    "default",
    "options",
    "multiple",
    "sensitive",
    "min",
    "max",
  ]);
  for (const [k, o] of Object.entries(cfg)) {
    assert.match(k, /^[A-Za-z_][A-Za-z0-9_]*$/);
    for (const f of Object.keys(o)) assert.ok(OPTION.has(f), `${k}.${f} is a documented field`);
    assert.equal(o.type, "string");
    assert.ok(o.title && o.description);
    assert.notEqual(o.sensitive, true, "neither is a secret, so skills and agents can read them");
  }
  assert.equal(cfg.guard_mode.default, "ask");
  for (const m of ["ask", "block", "off"]) assert.match(cfg.guard_mode.description, new RegExp(`\\b${m}\\b`));
  for (const d of ["hooks/", "agents/"]) assert.ok(pkg.files.includes(d), `package.json files has ${d}`);
});
