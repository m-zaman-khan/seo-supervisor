// Commands and edits the guard must catch, each next to a near-miss that must stay allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, tmp } from "./helpers.mjs";
import { checkAction } from "../skills/seo-supervisor/scripts/guard/rules.mjs";
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
const CRAWL = `${S}/seo-crawl.mjs --url https://x.com`;
const on = (...approved) => ({ settings: { outsideChecks: { on: true, approved } } });

// The hooks.json `if` filters, matched as plugin.test.mjs does.
const hooks = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8")).hooks;
const handlers = Object.values(hooks)
  .flat()
  .flatMap(g => g.hooks);
const ruleRe = p =>
  new RegExp(
    `^${p
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/ \*$/, "( .*)?")
      .replace(/\*\*\//g, "(.*/)?")
      .replace(/(?<!\.)\*/g, "[^]*")}$`,
    "i",
  );
const fires = (tool, s) =>
  handlers
    .filter(h => h.if?.startsWith(`${tool}(`) && /guard\.mjs$/.test(h.args[0]))
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
