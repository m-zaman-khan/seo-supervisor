// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SCRIPTS, node, tmp } from "./helpers.mjs";
import { render } from "../skills/seo-supervisor/scripts/render-report.mjs";

const GOLDEN = join(ROOT, "test", "golden"),
  INPUT = join(GOLDEN, "kitchen-sink.json");

test("render() writes nothing and returns the page, the Markdown and the receipt the command writes", async () => {
  const dir = tmp(),
    out = join(dir, "r.html"),
    md = join(dir, "r.md");
  const { stdout } = await node([join(SCRIPTS, "render-report.mjs"), INPUT, "--out", out]);
  const raw = JSON.parse(readFileSync(INPUT, "utf8")),
    got = render(raw, { dir: GOLDEN, mdFile: "r.md" });
  assert.equal(got.html, readFileSync(out, "utf8"));
  assert.equal(got.md, readFileSync(md, "utf8"));
  assert.equal(stdout.trimEnd(), [...got.receipt, `Wrote: ${out}, ${md}`].join("\n"));
  const plain = render(raw, { dir: GOLDEN });
  assert.equal(plain.md, null, "no Markdown file, no Markdown");
  assert.doesNotMatch(plain.html, /r\.md/);
});

test("the installed skill has the report's styles and script, and the npm package ships the skill folder", async () => {
  const home = tmp(),
    env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "APPDATA", "GROK_HOME"]) delete env[k];
  await node([join(ROOT, "bin", "seo-supervisor.mjs"), "--agent", "claude-code", "--yes"], { env });
  const report = join(home, ".claude", "skills", "seo-supervisor", "scripts", "report");
  for (const f of ["styles.css", "client.js", "format.mjs"]) assert.ok(existsSync(join(report, f)), f);
  assert.ok(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).files.includes("skills/"));
});
