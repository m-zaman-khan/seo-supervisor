// A finding's effort label, on its report card and in the Markdown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const render = async edit => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  edit(data);
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};
const section = (md, id) => md.split(`\n### ${id} `)[1].split("\n### ")[0];

test("a finding's effort shows on its card and in the Markdown, and only the allowed values show", async () => {
  const { html, md } = await render(d => {
    const f = id => d.findings.find(x => x.id === id);
    f("F-001").effort = "quick";
    f("F-002").effort = "hours";
    f("F-003").effort = "half-day";
    f("F-004").effort = "<img src=x onerror=alert(1)>";
    f("F-005").effort = "a week";
  });
  for (const label of ["under 30 minutes", "an hour or two", "half a day or more"])
    assert.ok(html.includes(`<span>Effort: ${label}</span>`), `card shows ${label}`);
  assert.equal(html.match(/Effort: /g).length, 3, "unknown values show nothing");
  assert.doesNotMatch(html + md, /onerror|a week/);
  assert.match(section(md, "F-001"), /^Status: [^\n]* · Effort: under 30 minutes$/m);
  assert.match(section(md, "F-003"), /· Effort: half a day or more$/m);
  assert.doesNotMatch(section(md, "F-004") + section(md, "F-006"), /Effort/);
});

test("findings without an effort render exactly as before", async () => {
  const { html, md } = await render(() => {});
  assert.doesNotMatch(html + md, /Effort/);
});
