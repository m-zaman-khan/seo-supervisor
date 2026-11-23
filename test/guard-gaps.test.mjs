// Commands and edits the guard must catch, each next to a near-miss that must stay allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, tmp } from "./helpers.mjs";
import { checkAction } from "../skills/seo-supervisor/scripts/guard/rules.mjs";
import { run } from "../skills/seo-supervisor/scripts/guard.mjs";
import { say } from "../skills/seo-supervisor/scripts/guard/adapters/edits.mjs";

const dir = tmp();
const check = (a, o = {}) => checkAction(a, { mode: "ask", settings: {}, cwd: dir, ...o });
const bash = command => ({ kind: "bash", command });
const edit = (file, before, after) => ({ kind: "edit", file: join(dir, file), before, after });
const asks = (a, rule, o) => {
  const r = check(a, o);
  assert.equal(r.decision, "ask", `${JSON.stringify(a).slice(0, 160)} asks`);
  assert.equal(r.rule, rule);
  assert.ok(r.reason && !/undefined/.test(r.reason), "a plain reason");
  return r;
};
const allows = (a, o) => assert.equal(check(a, o).decision, "allow", `${JSON.stringify(a).slice(0, 160)} is allowed`);
const S = "node ~/.claude/skills/seo-supervisor/scripts";
const CRAWL = `${S}/seo-crawl.mjs --url https://x.com`;
const on = (...approved) => ({ settings: { outsideChecks: { on: true, approved } } });

// The hooks.json `if` filters, matched as plugin.test.mjs does.
const hooks = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks;
const groups = Object.values(hooks).flat(),
  handlers = groups.flatMap(g => g.hooks),
  guard = h => /guard\.mjs$/.test(h.args[0]);
const ruleRe = p =>
  new RegExp(
    `^${p
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/ \*$/, "( .*)?")
      .replace(/\*\*\//g, "(.*/)?")
      .replace(/(?<!\.)\*/g, "[^]*")}$`,
    "i",
  );
// A guard handler with no if runs for every call of its group's tools (the shell tools: guard-limits.test.mjs).
const fires = (tool, s) =>
  groups.some(g => g.matcher?.split("|").includes(tool) && g.hooks.some(h => !h.if && guard(h))) ||
  handlers
    .filter(h => h.if?.startsWith(`${tool}(`) && guard(h))
    .some(h => ruleRe(h.if.slice(tool.length + 1, -1)).test(s));

test("the crawler's other outside flags ask unless outsideChecks.approved lists that check", () => {
  const flags = [
    ["--outbound-links", "outbound-links"],
    ["--hreflang-other-sites", "hreflang-other-sites"],
    ["--ai-bot-probe", "ai-bot-probe"],
    ["--desktop", "desktop"],
    ["--render all", "render-all"],
    ["--render=all", "render-all"],
    ["--lighthouse", "lighthouse"],
    ["--lighthouse all", "lighthouse"],
  ];
  for (const [flag, name] of flags) {
    const c = bash(`${CRAWL} --outside ${flag}`);
    assert.match(asks(c, "outside", on("speed", "render")).reason, new RegExp(name), `${flag} names its check`);
    allows(c, on("speed", "render", name));
  }
  // --outbound-links runs without --outside too.
  asks(bash(`${CRAWL} --outbound-links`), "outside");
  allows(bash(`${CRAWL} --outbound-links`), {
    settings: { outsideChecks: { on: false, approved: ["outbound-links"] } },
  });
  // The older "outsideChecks": true approves the first list only, which has lighthouse but not desktop.
  allows(bash(`${CRAWL} --outside --lighthouse`), { settings: { outsideChecks: true } });
  asks(bash(`${CRAWL} --outside --desktop`), "outside", { settings: { outsideChecks: true } });
  // A page on another site to render, and the test-only endpoints that would get the PageSpeed key.
  asks(bash(`${CRAWL} --outside --render-page https://other.com/a`), "outside", on("speed", "render"));
  allows(bash(`${CRAWL} --outside --render-page https://x.com/pricing`), on("speed", "render"));
  asks(bash(`${CRAWL} --outside --psi-endpoint https://example.net/psi`), "outside", on("speed", "render"));
  // Near-misses: --render with a page count isn't render-all, and a plain crawl stays silent.
  allows(bash(`${CRAWL} --outside --clean-screenshots`), on("speed", "render"));
  allows(bash(`${CRAWL} --max 50 --include /blog/`));
  for (const f of [
    "--outbound-links",
    "--hreflang-other-sites",
    "--ai-bot-probe",
    "--desktop",
    "--render all",
    "--lighthouse",
    "--render-page https://a.com",
    "--psi-endpoint x",
    "--crux-endpoint x",
  ]) {
    assert.ok(fires("Bash", `${CRAWL} ${f}`), `Bash if: ${f}`);
    assert.ok(fires("PowerShell", `${CRAWL} ${f}`), `PowerShell if: ${f}`);
  }
});

test("wrappers, subshells, $( ), shell strings, variables and the bin's own subcommands can't hide --yes", () => {
  const g = `${S}/google.mjs submit-sitemap --site https://x.com --sitemap https://x.com/sitemap.xml --yes`;
  for (const c of [
    `timeout 60 ${g}`,
    `timeout -s KILL 5m ${g}`,
    `stdbuf -oL ${g}`,
    `stdbuf -o L -e L ${g}`,
    `(${g})`,
    `echo $(${g})`,
    `echo "$(${g})"`,
    `bash -c "${g}"`,
    `sh -lc '${g}'`,
    `powershell -Command "${g}"`,
    `pwsh -NoProfile -c "${g}"`,
    `cmd /c ${g}`,
    `cmd.exe /C "${g}"`,
  ])
    asks(bash(c), "outside");
  // A variable where --yes could hide.
  for (const c of [
    `Y=--yes; ${S}/rdap.mjs --site https://x.com $Y`,
    `${S}/rdap.mjs --site https://x.com \${FLAGS}`,
    `${S}/indexnow.mjs submit %YES%`,
    `${S}/rdap.mjs --site x $(echo --yes)`,
    `${CRAWL} $EXTRA`,
  ])
    asks(bash(c), "outside");
  // The bin's issues, run from the repo or as npx seo-supervisor@version.
  for (const c of [
    "node bin/seo-supervisor.mjs issues --audit a.json --yes",
    "npx seo-supervisor@latest issues --yes",
    "npx seo-supervisor@1.2.0 issues --yes",
    "npx -y seo-supervisor issues --yes",
    "bunx seo-supervisor issues --yes",
  ])
    asks(bash(c), "outside");
  // Near-misses: the dry runs, a variable in the script's own path, a URL with %-escapes, other tools' -c.
  for (const c of [
    `timeout 60 ${S}/rdap.mjs --site https://x.com`,
    `(${S}/rdap.mjs --site https://x.com)`,
    `bash -c "npm test"`,
    `cmd /c dir`,
    `node "$SKILL/scripts/rdap.mjs" --site https://x.com`,
    `${S}/rdap.mjs --site https://x.com/caf%C3%A9%E2%80%99s`,
    "npx seo-supervisor@latest deploy-check --site https://x.com",
    "node bin/seo-supervisor.mjs issues --audit a.json",
    `echo $(date) && ${S}/rdap.mjs --site https://x.com`,
  ])
    allows(bash(c));
  // Deletes inside shell strings and subshells too.
  asks(bash('bash -c "rm public/robots.txt"'), "robots");
  asks(bash("(rm public/robots.txt)"), "robots");
  for (const c of [
    'bash -c "rm public/robots.txt"',
    "sh -lc 'rm public/robots.txt'",
    "cmd /c del public\\robots.txt",
    'powershell -Command "Remove-Item public/robots.txt"',
    "pwsh -c Remove-Item x",
    `${S}/rdap.mjs --site x $Y`,
  ])
    assert.ok(fires("Bash", c) && fires("PowerShell", c.replace(/^sh -lc/, "bash -c")), `if fires: ${c}`);
});

test("an edit that turns the guard off or down, turns outside checks on or widens approved asks; Bash writes to it ask", async () => {
  const f = "seo-audit/settings.json",
    j = o => JSON.stringify(o, null, 2);
  for (const [b, a] of [
    [{}, { guard: "off" }],
    [{ guard: "block" }, { guard: "ask" }],
    [{ guard: "block" }, {}],
    [{ guard: "ask" }, { guard: "off" }],
    [{}, { outsideChecks: { on: true } }],
    [{ outsideChecks: { on: false } }, { outsideChecks: true }],
    [
      { outsideChecks: { on: true, approved: ["speed"] } },
      { outsideChecks: { on: true, approved: ["speed", "outbound-links"] } },
    ],
    [{ outsideChecks: true }, { outsideChecks: { on: true, approved: ["speed", "desktop"] } }],
  ])
    asks(edit(f, j(b), j(a)), "settings");
  asks(edit("clients/acme/seo-audit/settings.json", j({ guard: "block" }), j({ guard: "off" })), "settings");
  asks(edit(f, j({ guard: "block" }), "{ not json"), "settings");
  // Near-misses: raising the guard, narrowing approved, the old true written out as its list, other settings.
  for (const [b, a] of [
    [{ guard: "off" }, { guard: "ask" }],
    [{ guard: "ask" }, { guard: "block" }],
    [
      { outsideChecks: { on: true, approved: ["speed", "render"] } },
      { outsideChecks: { on: true, approved: ["speed"] } },
    ],
    [
      { outsideChecks: true },
      { outsideChecks: { on: true, approved: ["speed", "render", "lighthouse", "intent", "brand", "updates"] } },
    ],
    [{ checks: { off: [] } }, { checks: { off: ["META-01"] } }],
    [{}, { outsideChecks: { on: false } }],
  ])
    allows(edit(f, j(b), j(a)));
  allows(edit("app/settings.json", "{}", j({ guard: "off" })));
  // Claude Code's Write reaches the guard, and the if list starts it for that file only.
  const p = tmp();
  mkdirSync(join(p, "seo-audit"));
  const w = await run(
    "claude-code",
    {
      hook_event_name: "PreToolUse",
      session_id: "gaps",
      cwd: p,
      tool_name: "Write",
      tool_input: { file_path: join(p, f), content: '{"guard":"off"}' },
    },
    { env: {} },
  );
  assert.equal(JSON.parse(w.stdout).hookSpecificOutput.permissionDecision, "ask");
  assert.ok(fires("Edit", "seo-audit/settings.json") && fires("Edit", "clients/acme/seo-audit/settings.json"));
  assert.ok(!fires("Edit", "package.json") && !fires("Edit", "app/settings.json"));
  // Writes from the shell.
  for (const c of [
    `echo '{"guard":"off"}' > seo-audit/settings.json`,
    `echo '{}' >seo-audit/settings.json`,
    "jq . x.json | tee seo-audit/settings.json",
    `Set-Content -Path seo-audit\\settings.json -Value '{"guard":"off"}'`,
    `'{"guard":"off"}' | Out-File seo-audit/settings.json`,
    "cp other.json seo-audit/settings.json",
    "sed -i s/ask/off/ seo-audit/settings.json",
  ]) {
    asks(bash(c), "settings");
    assert.ok(fires("Bash", c) || fires("PowerShell", c), `if fires: ${c}`);
  }
  for (const c of [
    "cat seo-audit/settings.json",
    "jq .guard seo-audit/settings.json",
    "cp seo-audit/settings.json /tmp/backup.json",
    "Get-Content seo-audit/settings.json",
  ])
    allows(bash(c));
  // An agent that can't ask isn't told to switch the guard off to let a settings change through.
  assert.doesNotMatch(say({ decision: "ask", rule: "settings", reason: "x" }), /"guard": "off"/);
  assert.match(say({ decision: "ask", rule: "robots", reason: "x" }), /"guard": "off"/);
  // Removing a file that sets block lowers the guard to ask.
  writeFileSync(join(p, f), j({ guard: "block" }));
  assert.equal(checkAction(bash("rm seo-audit/settings.json"), { cwd: p }).rule, "settings");
  writeFileSync(join(p, f), j({ guard: "ask" }));
  assert.equal(checkAction(bash("rm seo-audit/settings.json"), { cwd: p }).decision, "allow");
});

test("PowerShell renames and moves of pages ask, and the hook fires for them, unlink, rmdir and git -C", () => {
  mkdirSync(join(dir, "app", "blog"), { recursive: true });
  writeFileSync(join(dir, "app", "blog", "page.tsx"), "export default () => null;");
  for (const c of [
    "Rename-Item pages\\about.html about-us.html",
    "Rename-Item -Path app\\blog -NewName posts",
    "Rename-Item -NewName posts -Path app\\blog",
    "rni pages\\about.html b.html",
    "ren pages\\about.html b.html",
    "move pages\\about.html x.html",
    "rename pages\\about.html b.html",
  ])
    asks(bash(c), "page-remove");
  allows(bash("Rename-Item notes.txt old-notes.txt"));
  for (const c of ["Rename-Item -Path app\\blog -NewName posts"]) assert.ok(fires("PowerShell", c), c);
  for (const c of [
    "unlink public/robots.txt",
    "rmdir app/blog",
    "git -C site mv pages/a.html pages/b.html",
    "git -C site rm pages/a.html",
  ])
    assert.ok(fires("Bash", c), `Bash if: ${c}`);
  assert.ok(fires("PowerShell", "git -C site mv pages/a.html pages/b.html"));
});

test("smaller gaps: cd in the same command, mv -t, alternates shorthand, middleware and proxy redirects, template files", () => {
  mkdirSync(join(dir, "app", "blog"), { recursive: true });
  writeFileSync(join(dir, "app", "blog", "page.tsx"), "export default () => null;");
  asks(bash("cd app && rm -rf blog"), "page-remove");
  asks(bash("cd app; cd ..; rm -rf app/blog"), "page-remove");
  asks(bash("Set-Location app; Remove-Item -Recurse blog"), "page-remove");
  asks(bash("git -C app rm -r blog"), "page-remove");
  allows(bash("cd app && rm -rf components"));
  for (const c of [
    "mv -t archive pages/about.html",
    "mv --target-directory=archive pages/about.html",
    "mv --target-directory archive pages/about.html",
  ])
    asks(bash(c), "page-remove");
  allows(bash("mv -t archive notes.txt"));
  // alternates: { canonical } shorthand.
  asks(
    edit(
      "app/a/page.tsx",
      "import { canonical } from './seo';\nexport const metadata = { alternates: { canonical } };",
      "import { canonical } from './seo';\nexport const metadata = { alternates: {} };",
    ),
    "canonical",
  );
  asks(
    edit(
      "app/a/page.tsx",
      "export const metadata = { alternates: { languages, canonical } };",
      "export const metadata = { alternates: { languages } };",
    ),
    "canonical",
  );
  asks(
    edit(
      "app/a/page.tsx",
      "const canonical = '/a';\nexport const metadata = { alternates: { canonical } };",
      "const canonical = '/b';\nexport const metadata = { alternates: { canonical } };",
    ),
    "canonical",
  );
  // Next.js middleware, and proxy, its name since Next.js 16.
  const mw =
    "import { NextResponse } from 'next/server';\nexport function middleware(req) {\n  return NextResponse.next();\n}\n";
  for (const f of ["middleware.ts", "src/middleware.js", "proxy.ts"])
    asks(
      edit(f, mw, mw.replace("NextResponse.next()", "NextResponse.redirect(new URL('/new', req.url), 308)")),
      "redirects",
    );
  allows(edit("middleware.ts", mw, mw.replace("return", "const t = Date.now();\n  return")));
  // Template files are pages, and the hook fires for them.
  for (const ext of ["ejs", "twig", "pug", "jinja", "j2", "cshtml", "tmpl"]) {
    asks(bash(`rm pages/about.${ext}`), "page-remove");
    assert.ok(fires("Edit", `templates/base.${ext}`), `Edit if: .${ext}`);
    asks(
      edit(`templates/base.${ext}`, "<head></head>", '<head><meta name="robots" content="noindex"></head>'),
      "noindex",
    );
  }
  assert.ok(fires("Edit", "content/a.markdown"));
});

test("speed: a long X-Robots-Tag or robots line can't stall the guard", () => {
  for (const after of [
    "x-robots-tag" + " ".repeat(4000) + "a".repeat(4000),
    "robots=" + " ".repeat(4000) + "b".repeat(4000),
    "noindex" + " ".repeat(4000) + "=" + " ".repeat(4000),
    "X-Robots-Tag: all " + "a".repeat(100000),
  ]) {
    const t = performance.now();
    check(edit("a.html", "", after));
    assert.ok(
      performance.now() - t < 2000,
      `${after.slice(0, 20)}… in under 2 s (${(performance.now() - t).toFixed(0)} ms)`,
    );
  }
  // Unclosed blocks in a config file, and unclosed meta tags.
  for (const [file, after] of [
    ["next.config.js", "redirects [".repeat(20000)],
    ["a.html", ("<meta " + "a".repeat(50)).repeat(20000)],
  ]) {
    const t = performance.now();
    check(edit(file, "", after));
    assert.ok(
      performance.now() - t < 2000,
      `${after.slice(0, 12)}… in under 2 s (${(performance.now() - t).toFixed(0)} ms)`,
    );
  }
});

test("false positives: prose about robots and X-Robots-Tag, and edits elsewhere on a one-line page", () => {
  allows(edit("content/a.md", "Hi", "Robots: none of them read the footer."));
  allows(edit("content/a.md", "Hi", "The X-Robots-Tag header is something none of us use."));
  allows(edit("content/a.md", "Hi", "Robots: noindex is what we use on tag pages."));
  // Still caught: the real forms.
  asks(edit("public/_headers", "/*\n", "/*\n  X-Robots-Tag: none\n"), "noindex");
  asks(edit("content/a.md", "---\ntitle: A\n---", "---\ntitle: A\nrobots: none\n---"), "noindex");
  asks(
    edit("app/layout.tsx", "export const metadata = {};", "export const metadata = { robots: 'noindex, nofollow' };"),
    "noindex",
  );
  asks(
    edit("app/layout.tsx", "export const metadata = {};", "export const metadata = { robots: 'noindex nofollow' };"),
    "noindex",
  );
  const page =
    '<!doctype html><html><head><title>A</title><link rel="canonical" href="https://x.com/a"><meta name="description" content="d"></head><body><p>Old text</p></body></html>';
  allows(edit("a.html", page, page.replace("Old text", "New text")));
  asks(edit("a.html", page, page.replace("https://x.com/a", "https://x.com/b")), "canonical");
  asks(edit("a.html", page, page.replace('<link rel="canonical" href="https://x.com/a">', "")), "canonical");
});
