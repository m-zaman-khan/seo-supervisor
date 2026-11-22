// @ts-check
// The slash commands' frontmatter, and every script and flag they and SKILL.md name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL } from "./helpers.mjs";

const S = join(SKILL, "scripts");
const NAMES = ["audit", "brief", "connect", "fix", "grow", "launch", "review", "rewrite", "setup", "watch"].map(
  n => `seo-${n}`,
);
const read = (/** @type {string} */ p) => readFileSync(p, "utf8");
const cmd = (/** @type {string} */ n) => read(join(ROOT, "commands", `${n}.md`));
const skill = read(join(SKILL, "SKILL.md"));
// One exact script per rule, never a folder wildcard. ${CLAUDE_PLUGIN_ROOT} is substituted in a plugin's allowed-tools.
// https://code.claude.com/docs/en/skills
const RULE =
  /^Bash\(node \$\{CLAUDE_PLUGIN_ROOT\}\/skills\/seo-supervisor\/scripts\/([a-z-]+)\.mjs(?: [a-z-]+)*(?: \*)?\)$/;

/** Frontmatter as { key: string | string[] }; throws on a line it can't read. @param {string} text */
const front = text => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "frontmatter between --- lines");
  /** @type {Record<string, string | string[]>} */ const out = {};
  let list = "";
  for (const line of m[1].split("\n")) {
    const item = line.match(/^ {2}- (.+)$/),
      kv = line.match(/^([a-z-]+):(?: (.*))?$/);
    if (item && list) /** @type {string[]} */ (out[list]).push(item[1]);
    else if (kv && kv[2] === undefined) {
      list = kv[1];
      out[list] = [];
    } else if (kv) {
      list = "";
      out[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, "$2");
    } else assert.fail(`unreadable frontmatter line: ${line}`);
  }
  return out;
};

/** Is --flag (or a subcommand word) in the script's own source? @param {string} script @param {string} flag */
const accepts = (script, flag) => {
  const src = read(join(S, script));
  return src.includes(`"${flag}"`) || src.includes(`--${flag}`) || src.includes(`'${flag}'`);
};

test("all ten commands exist, with valid frontmatter", () => {
  assert.deepEqual(
    readdirSync(join(ROOT, "commands"))
      .filter(f => f.endsWith(".md"))
      .sort(),
    NAMES.map(n => `${n}.md`),
  );
  for (const n of NAMES) {
    const text = cmd(n),
      f = front(text);
    for (const k of Object.keys(f))
      assert.ok(
        ["description", "argument-hint", "allowed-tools", "disable-model-invocation"].includes(k),
        `${n}: known key ${k}`,
      );
    assert.ok(
      typeof f.description === "string" && f.description.length > 40 && f.description.length <= 1536,
      `${n}: description`,
    );
    assert.match(String(f.description), /\?/, `${n}: the description names a question it answers`);
    assert.match(String(f.description), /\/seo-[a-z]+/, `${n}: the description points to its neighbour`);
    assert.doesNotMatch(String(f.description), /[<>]/, `${n}: no angle brackets (they show as &lt;)`);
    assert.ok(typeof f["argument-hint"] === "string" && /^\[.+\]$/.test(f["argument-hint"]), `${n}: argument-hint`);
    assert.match(text, /\*\*seo-supervisor\*\* skill/, `${n} invokes the skill`);
    assert.equal(
      f["disable-model-invocation"],
      ["seo-fix", "seo-rewrite", "seo-setup"].includes(n) ? "true" : undefined,
      `${n}: only fix, rewrite and setup are owner-only`,
    );
    const rules = f["allowed-tools"];
    assert.ok(Array.isArray(rules) && rules.length, `${n}: allowed-tools pre-approves its scripts`);
    for (const r of rules) {
      const m = r.match(RULE);
      assert.ok(m, `${n}: ${r} names one script exactly`);
      assert.ok(existsSync(join(S, `${m[1]}.mjs`)), `${n}: ${m[1]}.mjs exists`);
      // A subcommand (google.mjs fetch) must be one its usage line names.
      for (const word of r
        .replace(/ \*\)$|\)$/, "")
        .split(" ")
        .slice(2))
        assert.match(
          read(join(S, `${m[1]}.mjs`)).match(/usage: [^`]*`/i)?.[0] || "",
          new RegExp(`\\b${word}\\b`),
          `${n}: ${m[1]}.mjs has ${word}`,
        );
    }
    for (const risky of ["ai-answers", "geo-grid", "issues", "indexnow", "images", "og-card", "disavow"])
      assert.ok(!rules.some(r => r.includes(`/${risky}.mjs`)), `${n}: ${risky}.mjs keeps its permission prompt`);
    assert.ok(
      !rules.some(r =>
        /google\.mjs \*|connect-keys\.mjs \*|google\.mjs (?:connect|submit)|connect-keys\.mjs (?:set|fetch|submit|remove|test)/.test(
          r,
        ),
      ),
      `${n}: account writes keep their prompt`,
    );
  }
});

test("every script a command or SKILL.md names exists, and every flag next to it is one the script accepts", () => {
  const texts = [["SKILL.md", skill], ...NAMES.map(n => [`${n}.md`, cmd(n)])];
  let scripts = 0,
    flags = 0;
  for (const [file, text] of texts) {
    for (const [, name] of text.matchAll(/\b([a-z][a-z0-9-]*)\.mjs\b/g)) {
      scripts++;
      assert.ok(
        existsSync(join(S, `${name}.mjs`)) ||
          existsSync(join(S, "lib", `${name}.mjs`)) ||
          existsSync(join(ROOT, "bin", `${name}.mjs`)),
        `${file}: ${name}.mjs exists`,
      );
    }
    for (const [, span] of text.matchAll(/`([^`\n]*\.mjs[^`\n]*)`/g)) {
      const script = span.match(/\b([a-z][a-z0-9-]*\.mjs)\b/)?.[1];
      if (!script || !existsSync(join(S, script))) continue;
      for (const [, flag] of span.matchAll(/(?:^|\s|\[|\()--([a-z][a-z0-9-]*)/g)) {
        flags++;
        assert.ok(accepts(script, flag), `${file}: ${script} accepts --${flag} (in \`${span}\`)`);
      }
    }
  }
  assert.ok(scripts > 60 && flags > 80, `${scripts} script names and ${flags} flags checked`);
});

test("the modes table has ten rows, routes plain words, and points both ways", () => {
  const table = skill.split("## Modes")[1].split("\n\n")[1];
  const rows = table
    .split("\n")
    .filter(l => /^\| \*\*[a-z]+\*\*/.test(l))
    .map(l => l.match(/\*\*([a-z]+)\*\*/)?.[1]);
  assert.deepEqual(rows, ["audit", "fix", "review", "launch", "setup", "brief", "rewrite", "grow", "watch", "connect"]);
  for (const ask of ["is ChatGPT citing me?", "where do I rank around town?", "did my change help?", "is my setup OK?"])
    assert.ok(skill.includes(ask), `routes "${ask}"`);
  assert.match(skill, /one-page audit|checks that one page/i);
  for (const [a, b] of [
    ["seo-audit", "seo-review"],
    ["seo-fix", "seo-setup"],
    ["seo-brief", "seo-rewrite"],
    ["seo-grow", "seo-watch"],
    ["seo-launch", "seo-watch"],
    ["seo-connect", "seo-audit"],
  ]) {
    assert.ok(cmd(a).includes(`/${b}`), `/${a} points to /${b}`);
    assert.ok(cmd(b).includes(`/${a}`), `/${b} points to /${a}`);
  }
  assert.match(skill, /## Guard/);
  const desc = skill.match(/^description: (.*)$/m)?.[1] || "";
  assert.ok(desc.startsWith("Use when ") && desc.length <= 1536, `skill description: ${desc.length} characters`);
  for (const q of ["did my change help?", "citing me?", "around town?", "setup"])
    assert.ok(desc.includes(q), `the skill description names "${q}"`);
});

test("watch never writes over the audit's files, and connect keeps keys at the hidden prompt", () => {
  const watch = cmd("seo-watch"),
    connect = cmd("seo-connect");
  assert.match(watch, /seo-audit\/watch\//);
  for (const span of watch.matchAll(/--out (\S+)/g))
    assert.match(span[1], /^seo-audit\/watch\//, `watch writes ${span[1]}`);
  assert.doesNotMatch(watch, /--history seo-audit\/history/, "watch doesn't file its crawl in the audit's history");
  for (const s of ["seo-diff", "change-check", "google-updates", "dashboard", "deploy-check"])
    assert.match(watch, new RegExp(`${s}\\.mjs`), `watch runs ${s}`);
  assert.match(watch, /scheduled-runs\.md/);
  assert.match(connect, /doctor\.mjs/);
  assert.match(connect, /hidden prompt/);
  assert.match(connect, /[Nn]ever ask for a key in chat/);
  assert.ok(connect.indexOf("doctor.mjs") < connect.indexOf("connect-keys.mjs"), "doctor runs first");
});

test("the other eight name the scripts, steps and questions they offer", () => {
  const audit = cmd("seo-audit");
  assert.match(audit, /--max 1/);
  for (const w of ["GitHub issues", "AI answer", "geo-grid", "connections"])
    assert.ok(audit.includes(w), `audit offers ${w}`);
  const launch = cmd("seo-launch");
  for (const w of ["deploy-check.mjs", "indexnow.mjs", "--urls", "Change of Address"])
    assert.ok(launch.includes(w), `launch: ${w}`);
  const review = cmd("seo-review");
  for (const w of ["review-crawl.json", "seo-diff.mjs", "schema-check.mjs"])
    assert.ok(review.includes(w), `review: ${w}`);
  const fix = cmd("seo-fix");
  for (const w of ["AI crawler policy", "merging", "unpublishing"])
    assert.ok(fix.includes(w), `fix asks first about ${w}`);
  const brief = cmd("seo-brief");
  assert.match(brief, /`intent` in `outsideChecks\.approved`/);
  assert.match(brief, /keyword-ideas\.mjs/);
  assert.match(cmd("seo-grow"), /change-check\.mjs/);
  const grow = read(join(SKILL, "grow.md"));
  assert.match(grow, /## Considered, not recommended\n\| Idea \| What we found \| Why not \|/);
  assert.match(grow.split("## Stage 6")[1].split("\n## ")[0], /change-check\.mjs/);
  for (const t of [cmd("seo-setup"), read(join(SKILL, "planning.md"))])
    assert.match(t, /Setup builds what's missing; fix mode fixes findings/);
  assert.match(read(join(SKILL, "rules", "launch-monitoring.md")), /deploy-check\.mjs/);
});

test("the README, package and marketplace list all ten commands", () => {
  const readme = read(join(ROOT, "README.md")),
    table = readme.split("## Commands")[1].split("\n## ")[0];
  for (const n of NAMES) assert.match(table, new RegExp("`/" + n + "[ `]"), `README table: /${n}`);
  for (const desc of [
    JSON.parse(read(join(ROOT, "package.json"))).description,
    ...(m => [m.description, m.plugins[0].description])(
      JSON.parse(read(join(ROOT, ".claude-plugin", "marketplace.json"))),
    ),
  ])
    for (const w of ["audit", "fix", "review", "launch", "setup", "brief", "rewrite", "grow", "watch", "connect"])
      assert.match(desc, new RegExp(w, "i"), `${desc.slice(0, 40)}…: ${w}`);
});
