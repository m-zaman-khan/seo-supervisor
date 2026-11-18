// The report renderer, and the parts of the page render step that need no Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const SAMPLE = join(SKILL, "examples", "sample-audit.json");

test("the report renders the score, the unlock line and the owner labels, fully offline", async () => {
  const out = join(tmp(), "seo-audit.html");
  await node([join(SCRIPTS, "render-report.mjs"), SAMPLE, "--out", out]);
  const html = readFileSync(out, "utf8");

  assert.match(html, /<title>SEO report · Example Security \(sample data\)<\/title>/);
  assert.match(html, /<span class="n">49<\/span>/, "two open blockers cap the score at 49");
  assert.match(html, /score rises to/, "the panel shows what fixing the blockers unlocks");
  assert.match(html, /class="to [^"]*">90</, "fixing both blockers takes the sample to 90");
  assert.match(html, /Needs you/, "owner-only findings are labelled");
  assert.match(html, /class="theme-btn"/, "theme switch");
  assert.match(html, /@font-face\{font-family:"Geist"/, "fonts are embedded, not fetched");
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href="https?:/i, "no external scripts, styles or fonts");

  const md = readFileSync(out.replace(/\.html$/, ".md"), "utf8");
  assert.match(md, /Fix the 2 blockers and the score rises to 90\/100/);
  assert.match(md, /## Findings/);
});

test("the live demo and the bundled sample are up to date (run `npm run demo` after changing the renderer)", async () => {
  const dir = tmp();
  // docs/index.html is rendered without the Markdown twin; the bundled sample comes with sample-report.md.
  await node([join(SCRIPTS, "render-report.mjs"), SAMPLE, "--out", join(dir, "index.html"), "--no-md"]);
  await node([join(SCRIPTS, "render-report.mjs"), SAMPLE, "--out", join(dir, "sample-report.html")]);
  const pairs = [
    [join(ROOT, "docs", "index.html"), join(dir, "index.html")],
    [join(SKILL, "examples", "sample-report.html"), join(dir, "sample-report.html")],
    [join(SKILL, "examples", "sample-report.md"), join(dir, "sample-report.md")],
  ];
  for (const [committed, fresh] of pairs) {
    assert.ok(existsSync(committed), `${committed} exists`);
    assert.equal(readFileSync(committed, "utf8"), readFileSync(fresh, "utf8"), `${committed} matches a fresh render`);
  }
});
