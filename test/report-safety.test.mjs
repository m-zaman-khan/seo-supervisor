// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL, tmp } from "./helpers.mjs";
import { render } from "../skills/seo-supervisor/scripts/render-report.mjs";

const KITCHEN = JSON.parse(readFileSync(join(ROOT, "test", "golden", "kitchen-sink.json"), "utf8"));
const SAMPLE = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
const copy = x => JSON.parse(JSON.stringify(x));
/** @param {any} raw @param {string | null} [mdFile] */
const rend = (raw, mdFile = "r.md") => render(copy(raw), { dir: tmp(), mdFile });

test("the page's styles have no dead .as.b3-t,.as.b4-t rule", () => {
  const { html } = rend(KITCHEN);
  assert.doesNotMatch(html, /\.as\.b[34]-t/);
  assert.match(html, /\.as\{font:600 16px var\(--mono\);text-align:right\}/, "the .as rule itself stays");
});
