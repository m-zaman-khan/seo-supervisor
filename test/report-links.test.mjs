// Report links point at ids that exist, so they work without the script.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL, tmp } from "./helpers.mjs";
import { render } from "../skills/seo-supervisor/scripts/render-report.mjs";

test("every #link in the sample report points at an element id", () => {
  const raw = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  const { html } = render(raw, { dir: tmp(), mdFile: "seo-audit.md" });
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const targets = [...new Set([...html.matchAll(/href="#([^"]+)"/g)].map(m => m[1]))];
  assert.ok(targets.length > 10, "the sample report has in-page links");
  assert.deepEqual(
    targets.filter(t => !ids.has(t)),
    [],
  );
});

test("every draft the sample report links to ships next to it, in the bundled sample and the docs demo", () => {
  const raw = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  const { html } = render(raw, { dir: tmp(), mdFile: "seo-audit.md" });
  const drafts = [...new Set([...html.matchAll(/href="(drafts\/[^"]+)"/g)].map(m => m[1]))];
  assert.ok(drafts.length, "the sample links a draft");
  for (const d of drafts) {
    const source = readFileSync(join(SKILL, "examples", d), "utf8");
    assert.equal(
      readFileSync(join(SKILL, "..", "..", "docs", d), "utf8"),
      source,
      `docs/${d} matches the bundled sample's`,
    );
  }
});

test("the router opens a tab from its panel id as well as its short name", () => {
  const client = readFileSync(join(SKILL, "scripts", "report", "client.js"), "utf8");
  assert.match(client, /if\(show\(h\)\|\|\(h\.slice\(0,2\)==='p-'&&show\(h\.slice\(2\)\)\)\)return;/);
});
