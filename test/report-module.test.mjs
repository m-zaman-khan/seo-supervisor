// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
