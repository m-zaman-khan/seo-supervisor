// Every guard rule has a near-miss that must stay allowed; the guard fails open and answers fast.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { SCRIPTS, tmp } from "./helpers.mjs";
import { checkAction } from "../skills/seo-supervisor/scripts/guard/rules.mjs";
import { guardMode } from "../skills/seo-supervisor/scripts/guard/mode.mjs";
import { run } from "../skills/seo-supervisor/scripts/guard.mjs";

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

test("outside: our scripts with --yes ask, the same commands without it are allowed", () => {
  const cases = [
    `${S}/google.mjs submit-sitemap --site https://x.com --sitemap https://x.com/sitemap.xml`,
    `${S}/connect-keys.mjs submit-bing --site https://x.com --urls changed.txt`,
    `${S}/connect-keys.mjs fetch --site https://x.com`,
    `${S}/indexnow.mjs submit --site https://x.com --key abc --from-sitemap https://x.com/sitemap.xml`,
    `${S}/issues.mjs --audit seo-audit/seo-audit.json`,
    `npx seo-supervisor issues --audit seo-audit/seo-audit.json`,
    `${S}/ai-answers.mjs --site https://x.com --questions q.txt`,
    `${S}/geo-grid.mjs --find "Bob's Plumbing, Leeds"`,
    `${S}/rdap.mjs --site https://x.com`,
    `${S}/osm.mjs --crawl seo-audit/seo-crawl.json`,
    `${S}/commoncrawl.mjs --site https://x.com`,
    `${S}/backlinks.mjs --site https://x.com --csv links.csv`,
    `${S}/google-updates.mjs --since 2026-10-01`,
    `${S}/images.mjs --crawl seo-audit/seo-crawl.json --root public`,
    `${S}/images.mjs --label-ai public/hero.jpg`,
  ];
  for (const c of cases) {
    asks(bash(`${c} --yes`), "outside");
    allows(bash(c));
  }
  // Inside a compound command, from PowerShell with a Windows path, and quoted.
  asks(bash(`cd site && ${S}/rdap.mjs --site https://x.com --yes`), "outside");
  asks(
    bash(
      `& node "C:\\Users\\Sam Lee\\.claude\\skills\\seo-supervisor\\scripts\\indexnow.mjs" submit --site https://x.com --yes`,
    ),
    "outside",
  );
  assert.match(check(bash(`${S}/ai-answers.mjs --site https://x.com --questions q.txt --yes`)).reason, /costs money/);
  // Near-misses: other tools' --yes, and the crawl without --yes.
  allows(bash("npm install --yes"));
  allows(bash("npx --yes seo-supervisor --with-browser"));
  allows(bash(`${S}/seo-crawl.mjs http://localhost:3000 --out seo-audit/seo-crawl.json`));
});

test("outside: log-scan --verify-ips, schema-check --allow-remote and a crawl with --outside", () => {
  asks(bash(`${S}/log-scan.mjs --log access.log --verify-ips`), "outside");
  asks(bash(`${S}/log-scan.mjs --verify-ips --log access.log`), "outside");
  allows(bash(`${S}/log-scan.mjs --log access.log --verify-ips saved-lists`)); // saved copies: contacts nothing
  asks(bash(`${S}/schema-check.mjs https://x.com/ --allow-remote`), "outside");
  allows(bash(`${S}/schema-check.mjs out/`));
  const crawl = bash(`${S}/seo-crawl.mjs https://x.com --outside`);
  asks(crawl, "outside");
  allows(crawl, { settings: { outsideChecks: { on: true, approved: ["speed"] } } });
  allows(crawl, { settings: { outsideChecks: true } });
  asks(crawl, "outside", { settings: { outsideChecks: { on: false } } });
});

test("key: a key in a prompt is refused, even inside other text; a URL like /blog/sk-guide-… isn't", () => {
  const keys = [
    "here's my key:sk-proj-abcdefghijklmnopqrstuvwxyz1234 thanks",
    'set it to {"apiKey":"AIzaSyA1234567890abcdefghijklmnopqrstuv"} please',
    "token (ghp_abcdefghijklmnopqrstuvwxyz0123456789) for issues",
    "pplx-abcdefghijklmnop1234",
  ];
  for (const text of keys) {
    const r = check({ kind: "prompt", text });
    assert.equal(r.decision, "deny", text);
    assert.equal(r.rule, "key");
    assert.match(r.reason, /connect-keys\.mjs" set/);
    assert.doesNotMatch(r.reason, /abcdefghijklmnop/, "the key is never repeated");
  }
  assert.match(check({ kind: "prompt", text: keys[0] }).reason, /set openai/);
  for (const text of [
    "audit https://x.com/blog/sk-guide-internationalization1 please",
    "keys start with sk- and then letters",
    "we send a Bearer token in the header",
    "the key=blue filter on /shop?key=blue",
    "noindex the tag pages",
  ])
    allows({ kind: "prompt", text });
  // A key on the connect-keys command line is refused; without it the script asks for the key, hidden.
  const r = check(bash(`${S}/connect-keys.mjs set openai sk-proj-abcdefghijklmnopqrstuvwxyz1234`));
  assert.equal(r.decision, "deny");
  assert.equal(r.rule, "key");
  allows(bash(`${S}/connect-keys.mjs set openai`));
  allows(bash(`${S}/connect-keys.mjs set matomo --url https://stats.x.com --site-id 3`));
});

test("noindex: adding it in a robots meta tag, a metadata object or an X-Robots-Tag asks; prose and comments don't", () => {
  asks(
    edit(
      "app/layout.html",
      "<head><title>A</title></head>",
      '<head><title>A</title><meta name="robots" content="noindex, nofollow"></head>',
    ),
    "noindex",
  );
  asks(edit("app/page.html", "<head></head>", "<head><meta content='none' name='googlebot'></head>"), "noindex");
  asks(
    edit(
      "app/layout.tsx",
      "export const metadata = { title: 'A' };",
      "export const metadata = {\n  title: 'A',\n  robots: { index: false, follow: true },\n};",
    ),
    "noindex",
  );
  asks(
    edit("public/_headers", "/*\n  X-Frame-Options: DENY\n", "/*\n  X-Frame-Options: DENY\n  X-Robots-Tag: noindex\n"),
    "noindex",
  );
  asks(edit(".htaccess", "", 'Header set X-Robots-Tag "noindex, nofollow"\n'), "noindex");
  asks(
    edit(
      "next.config.mjs",
      "headers: [{ key: 'X-Frame-Options', value: 'DENY' }]",
      "headers: [{ key: 'X-Robots-Tag', value: 'noindex' }]",
    ),
    "noindex",
  );
  asks(edit("content/blog/a.md", "---\ntitle: A\n---\nHello", "---\ntitle: A\nrobots: noindex\n---\nHello"), "noindex");
  asks(edit("pages/index.jsx", "<NextSeo title='A' />", "<NextSeo title='A' noindex={true} />"), "noindex");
  // Near-misses: the word in prose or a comment, an index robots tag, an existing noindex left alone.
  allows(edit("content/blog/a.md", "Hello", "Use noindex on thin tag pages, and never on the home page."));
  allows(edit("app/page.tsx", "const a = 1;", "// noindex later, once the owner decides\nconst a = 1;"));
  allows(edit("app/layout.html", "<head></head>", '<head><meta name="robots" content="index, follow"></head>'));
  allows(
    edit(
      "app/draft.html",
      '<meta name="robots" content="noindex"><p>Old</p>',
      '<meta name="robots" content="noindex"><p>New text</p>',
    ),
  );
});

test("robots: any robots.txt edit asks, naming Disallow: /, Googlebot or a removed sitemap line", () => {
  const before = "User-agent: *\nDisallow: /admin/\n\nSitemap: https://x.com/sitemap.xml\n";
  assert.match(
    asks(edit("public/robots.txt", before, before.replace("/admin/", "/")), "robots").reason,
    /Every page would drop out of Google/,
  );
  assert.match(
    asks(edit("public/robots.txt", before, `User-agent: Googlebot\nDisallow: /\n\n${before}`), "robots").reason,
    /Googlebot/,
  );
  assert.match(asks(edit("public/robots.txt", before, before.replace(/Sitemap:.*\n/, "")), "robots").reason, /Sitemap/);
  assert.match(
    asks(edit("public/robots.txt", before, before.replace("/admin/", "/admin/\nDisallow: /cart/")), "robots").reason,
    /Disallow: \/cart\//,
  );
  asks(
    edit("app/robots.ts", "rules: { userAgent: '*', allow: '/' }", "rules: { userAgent: '*', disallow: '/' }"),
    "robots",
  );
  asks(edit("nuxt.config.ts", "modules: []", "modules: ['@nuxtjs/robots'], robots: { disallow: ['/'] }"), "robots");
  // Near-misses: a page that talks about robots.txt, and a robots.txt that didn't change.
  allows(edit("content/blog/robots.md", "Hi", "Add `Disallow: /` to robots.txt only on staging."));
  allows(edit("public/robots.txt", before, before));
});

test("ai-policy: rules for the AI crawlers in data/ai-bots.json ask", () => {
  const before = "User-agent: *\nAllow: /\n";
  assert.match(
    asks(edit("public/robots.txt", before, `${before}\nUser-agent: GPTBot\nDisallow: /\n`), "ai-policy").reason,
    /GPTBot/,
  );
  asks(edit("public/robots.txt", `${before}\nUser-agent: ClaudeBot\nDisallow: /\n`, before), "ai-policy");
  asks(
    edit(
      "app/robots.ts",
      "rules: [{ userAgent: '*', allow: '/' }]",
      "rules: [{ userAgent: '*', allow: '/' }, { userAgent: 'PerplexityBot', disallow: '/' }]",
    ),
    "ai-policy",
  );
  // Near-miss: a blog post about AI crawlers.
  allows(edit("content/blog/ai.md", "Hi", "GPTBot and ClaudeBot read robots.txt like any crawler."));
});

test("redirects: changes to redirect rules ask; other edits to the same files don't", () => {
  const next =
    "module.exports = {\n  images: { domains: ['a.com'] },\n  async redirects() {\n    return [{ source: '/old', destination: '/new', permanent: true }];\n  },\n};\n";
  asks(edit("next.config.js", next, next.replace("permanent: true", "permanent: false")), "redirects");
  asks(
    edit("next.config.js", next, next.replace("];", ", { source: '/a', destination: '/b', permanent: true }];")),
    "redirects",
  );
  allows(edit("next.config.js", next, next.replace("'a.com'", "'b.com'")));
  asks(
    edit(
      "astro.config.mjs",
      "export default defineConfig({ redirects: {\n  '/a': '/b',\n} });",
      "export default defineConfig({ redirects: {\n  '/a': '/b',\n  '/c': '/d',\n} });",
    ),
    "redirects",
  );
  asks(edit("public/_redirects", "/old /new 301\n", "/old /new 301\n/blog/* /news/:splat 301\n"), "redirects");
  asks(edit(".htaccess", "RewriteEngine On\n", "RewriteEngine On\nRewriteRule ^old$ /new [R=301,L]\n"), "redirects");
  allows(
    edit(
      ".htaccess",
      "AddOutputFilterByType DEFLATE text/html\n",
      "AddOutputFilterByType DEFLATE text/html text/css\n",
    ),
  );
  const vercel =
    '{\n  "redirects": [\n    { "source": "/a", "destination": "/b", "permanent": true }\n  ],\n  "headers": []\n}\n';
  asks(edit("vercel.json", vercel, vercel.replace('"permanent": true', '"permanent": false')), "redirects");
  allows(
    edit("vercel.json", vercel, vercel.replace('"headers": []', '"headers": [{ "source": "/(.*)", "headers": [] }]')),
  );
  asks(
    edit(
      "netlify.toml",
      '[build]\n  command = "npm run build"\n',
      '[build]\n  command = "npm run build"\n\n[[redirects]]\n  from = "/old"\n  to = "/new"\n',
    ),
    "redirects",
  );
});

test("page-remove: deleting, moving or emptying a page or route file asks; other files and new pages don't", () => {
  for (const c of [
    "rm app/blog/page.tsx",
    "rm pages/index.mjs",
    "git rm content/posts/hello.md",
    "git mv pages/about.tsx pages/company.tsx",
    "mv src/pages/a.astro src/pages/b.astro",
    "rm -f about.html",
    "del public\\old.html",
  ])
    asks(bash(c), "page-remove");
  asks(bash("Remove-Item -Path src/routes/blog/+page.svelte -Force"), "page-remove");
  mkdirSync(join(dir, "app", "blog"), { recursive: true });
  writeFileSync(join(dir, "app", "blog", "page.tsx"), "export default () => null;");
  asks(bash("rm -rf app/blog"), "page-remove");
  asks({ kind: "delete", file: join(dir, "pages", "pricing.vue") }, "page-remove");
  asks(edit("app/pricing/page.tsx", "export default function P() { return <h1>Pricing</h1>; }", ""), "page-remove");
  asks(bash("rm public/robots.txt"), "robots");
  asks(bash("git rm _redirects"), "redirects");
  // Near-misses: other files, editing a page's text, adding a new page.
  for (const c of [
    "rm -rf node_modules .next",
    "rm src/lib/util.ts",
    "git mv README.md docs/README.md",
    "rm -rf app/components",
    "mv notes.txt old-notes.txt",
  ])
    allows(bash(c));
  allows(edit("app/pricing/page.tsx", "<h1>Pricing</h1>", "<h1>Plans and pricing</h1>"));
  allows(edit("app/new-page/page.tsx", "", "export default function N() { return <h1>New</h1>; }"));
});

test("canonical: changing or removing one asks; adding one to a new page or prose doesn't", () => {
  const html = '<head>\n<link rel="canonical" href="https://x.com/a">\n</head>';
  assert.match(asks(edit("a.html", html, html.replace("/a", "/b")), "canonical").reason, /changes/);
  assert.match(asks(edit("a.html", html, "<head>\n</head>"), "canonical").reason, /removes/);
  asks(edit("app/a/page.tsx", "alternates: { canonical: '/a' },", "alternates: { canonical: '/b' },"), "canonical");
  asks(edit("content/a.md", "---\ncanonical_url: https://x.com/a\n---", "---\n---"), "canonical");
  allows(edit("b.html", "", html));
  allows(edit("content/a.md", "The canonical guide to tiling.", "The canonical guide to tiling, updated."));
  allows(edit("a.html", html, html.replace("</head>", "<title>A</title>\n</head>")));
});

test("modes: off allows everything, block turns ask into deny, a key is denied in ask mode too", () => {
  const risky = bash(`${S}/rdap.mjs --site https://x.com --yes`),
    key = { kind: "prompt", text: "sk-proj-abcdefghijklmnopqrstuvwxyz1234" };
  assert.equal(check(risky, { mode: "off" }).decision, "allow");
  assert.equal(check(key, { mode: "off" }).decision, "allow");
  assert.equal(check(risky, { mode: "block" }).decision, "deny");
  assert.equal(check(key, { mode: "block" }).decision, "deny");
  assert.equal(check(risky, { mode: "ask" }).decision, "ask");
  assert.equal(check(risky, { mode: "nonsense" }).decision, "ask", "an unknown mode stays safe");

  const p = tmp();
  mkdirSync(join(p, "seo-audit"));
  writeFileSync(join(p, "seo-audit", "settings.json"), '{ "guard": "block" }');
  assert.equal(guardMode({}, p), "block", "seo-audit/settings.json");
  assert.equal(guardMode({ SEO_SUPERVISOR_GUARD: "off" }, p), "off", "the environment beats settings.json");
  assert.equal(
    guardMode({ CLAUDE_PLUGIN_OPTION_GUARD_MODE: "ask", SEO_SUPERVISOR_GUARD: "off" }, p),
    "ask",
    "the plugin setting comes first",
  );
  assert.equal(
    guardMode({ CLAUDE_PLUGIN_OPTION_GUARD_MODE: "", SEO_SUPERVISOR_GUARD: "OFF" }, p),
    "off",
    "an empty plugin setting is skipped; case doesn't matter",
  );
  assert.equal(guardMode({}, tmp()), "ask", "the default is on, asking");
  assert.equal(guardMode({ SEO_SUPERVISOR_GUARD: "warn" }, tmp()), "ask", "an unknown value means ask");
});

// ---------- the Claude Code adapter, through run() and the CLI ----------
const GUARD = join(SCRIPTS, "guard.mjs");
const cli = (input, env = {}) =>
  spawnSync(process.execPath, [GUARD, "--agent", "claude-code"], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, SEO_SUPERVISOR_GUARD: "", CLAUDE_PLUGIN_OPTION_GUARD_MODE: "", ...env },
  });
const pre = (tool_name, tool_input, extra = {}) => ({
  hook_event_name: "PreToolUse",
  session_id: "s1",
  cwd: dir,
  tool_name,
  tool_input,
  ...extra,
});

test("Claude Code: PreToolUse answers ask (or deny in block mode) with the reason, and nothing when allowed", () => {
  const r = cli(pre("Bash", { command: `${S}/indexnow.mjs submit --site https://x.com --key k --urls u.txt --yes` }));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, "PreToolUse");
  assert.equal(out.permissionDecision, "ask");
  assert.match(out.permissionDecisionReason, /IndexNow/);
  const b = JSON.parse(
    cli(pre("Bash", { command: `${S}/indexnow.mjs submit --yes` }), { CLAUDE_PLUGIN_OPTION_GUARD_MODE: "block" })
      .stdout,
  ).hookSpecificOutput;
  assert.equal(b.permissionDecision, "deny");
  assert.match(b.permissionDecisionReason, /block mode/);
  const quiet = cli(pre("Bash", { command: "npm test" }));
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, "");
  assert.equal(quiet.stderr, "");
});

test("Claude Code: an Edit is checked against the whole file on disk, a Write against what it replaces", async () => {
  const p = tmp();
  mkdirSync(join(p, "app"));
  writeFileSync(
    join(p, "app", "layout.tsx"),
    "export const metadata = {\n  title: 'A',\n  robots: { index: true },\n};\n",
  );
  const opts = { env: {} };
  const e = await run(
    "claude-code",
    pre(
      "Edit",
      { file_path: join(p, "app", "layout.tsx"), old_string: "index: true", new_string: "index: false" },
      { cwd: p, session_id: "edit" },
    ),
    opts,
  );
  assert.equal(
    JSON.parse(e.stdout).hookSpecificOutput.permissionDecision,
    "ask",
    "robots: { index: false } is only visible with the whole file",
  );
  writeFileSync(join(p, "app", "page.tsx"), "export default function H() { return <h1>Home</h1>; }\n");
  const w = await run(
    "claude-code",
    pre("Write", { file_path: join(p, "app", "page.tsx"), content: "" }, { cwd: p, session_id: "edit" }),
    opts,
  );
  assert.match(JSON.parse(w.stdout).hookSpecificOutput.permissionDecisionReason, /missing page/);
  const m = await run(
    "claude-code",
    pre(
      "MultiEdit",
      { file_path: join(p, "app", "page.tsx"), edits: [{ old_string: "Home", new_string: "Welcome" }] },
      { cwd: p, session_id: "edit" },
    ),
    opts,
  );
  assert.equal(m.stdout, "", "editing a page's text is allowed");
});

test("Claude Code: a key in a prompt blocks it without echoing the prompt back", () => {
  const r = cli({
    hook_event_name: "UserPromptSubmit",
    session_id: "s1",
    cwd: dir,
    prompt: "use sk-proj-abcdefghijklmnopqrstuvwxyz1234 for openai",
  });
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, "block");
  assert.equal(out.hookSpecificOutput.suppressOriginalPrompt, true);
  assert.doesNotMatch(r.stdout, /abcdefghijklmnop/);
  assert.equal(
    cli({ hook_event_name: "UserPromptSubmit", session_id: "s1", cwd: dir, prompt: "audit the site" }).stdout,
    "",
  );
});

test("Claude Code: Stop notes SEO changes once, stays quiet after /seo-review and when stop_hook_active", async () => {
  const data = tmp(),
    env = { CLAUDE_PLUGIN_DATA: data },
    p = tmp();
  const go = input => run("claude-code", { cwd: p, ...input }, { env });
  const stop = (session_id, extra = {}) =>
    go({ hook_event_name: "Stop", session_id, stop_hook_active: false, ...extra });
  await go(
    pre(
      "Write",
      { file_path: join(p, "public", "robots.txt"), content: "User-agent: *\nAllow: /\n" },
      { cwd: p, session_id: "a" },
    ),
  );
  await go(
    pre(
      "Write",
      { file_path: join(p, "src", "util.ts"), content: "export const x = 1;\n" },
      { cwd: p, session_id: "a" },
    ),
  );
  assert.equal(
    (await stop("a", { stop_hook_active: true })).stdout,
    "",
    "never while a stop hook is already continuing",
  );
  const note = JSON.parse((await stop("a")).stdout);
  assert.match(note.systemMessage, /robots\.txt/);
  assert.match(note.systemMessage, /\/seo-review/);
  assert.doesNotMatch(note.systemMessage, /util\.ts/);
  assert.equal(note.decision, undefined, "it never blocks");
  assert.equal((await stop("a")).stdout, "", "once per change");
  // After a review, no note; a session with no SEO changes gets none.
  await go(
    pre(
      "Write",
      { file_path: join(p, "app", "layout.tsx"), content: "<meta name='description' content='x' />" },
      { cwd: p, session_id: "b" },
    ),
  );
  await go({ hook_event_name: "UserPromptSubmit", session_id: "b", prompt: "/seo-supervisor:seo-review" });
  assert.equal((await stop("b")).stdout, "");
  await go(pre("Write", { file_path: join(p, "public", "robots.txt"), content: "x" }, { cwd: p, session_id: "c" }));
  await go({
    hook_event_name: "PostToolUse",
    session_id: "c",
    tool_name: "Agent",
    tool_input: { subagent_type: "seo-supervisor:seo-reviewer" },
  });
  assert.equal((await stop("c")).stdout, "", "the reviewer subagent counts as a review");
  assert.equal((await stop("none")).stdout, "");
  assert.ok(readdirSync(data).length, "the session notes live in the plugin's data folder");
});

test("bad input fails open: malformed JSON, an unknown agent, missing fields", () => {
  for (const input of [
    "not json",
    "",
    "[1,2",
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit" }),
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: 42 } }),
  ]) {
    const r = cli(input);
    assert.equal(r.status, 0, `exit 0 for ${input}`);
    assert.equal(r.stdout, "", `allowed: ${input}`);
    assert.ok(r.stderr.split("\n").filter(Boolean).length <= 1, "at most one stderr line");
  }
  const bad = cli("not json");
  assert.match(bad.stderr, /allowed/);
  const u = spawnSync(process.execPath, [GUARD, "--agent", "../../etc"], { input: "{}", encoding: "utf8" });
  assert.equal(u.status, 0);
  assert.equal(u.stdout, "");
  assert.match(u.stderr, /allowed/);
  assert.equal(check({ kind: "edit" }).decision, "allow");
  assert.equal(check(null).decision, "allow");
  assert.equal(check({ kind: "bash", command: "'unclosed" }).decision, "allow");
});

// The guard's own work is timed; Node's start isn't, since it's the machine's (over 250 ms on some Windows setups
// with a virus scanner). The hooks' `if` filters keep Node from starting at all for unrelated edits; every shell
// command starts it (guard-limits.test.mjs).
test("speed: the guard answers in under 200 ms", async () => {
  const big = "<p>text</p>\n".repeat(80000); // about 1 MB
  let t = performance.now();
  assert.equal(check(edit("big.html", big, big + '<meta name="robots" content="noindex">')).rule, "noindex");
  assert.ok(
    performance.now() - t < 200,
    `a 1 MB edit is checked in under 200 ms (${(performance.now() - t).toFixed(0)} ms)`,
  );
  const input = pre("Bash", { command: `${S}/rdap.mjs --site https://x.com --yes` });
  t = performance.now();
  await run("claude-code", input, { env: {} });
  assert.ok(performance.now() - t < 200, "a hook call, adapter and mode included, in under 200 ms");
  const best = f =>
    Math.min(
      ...[0, 1, 2].map(() => {
        const s = performance.now();
        f();
        return performance.now() - s;
      }),
    );
  const hook = best(() => cli(input)),
    bare = best(() => spawnSync(process.execPath, ["-e", "0"]));
  assert.ok(
    hook - bare < 200,
    `the CLI adds under 200 ms to Node's own start (hook ${hook.toFixed(0)} ms, bare Node ${bare.toFixed(0)} ms)`,
  );
});
