import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL, SCRIPTS, node, tmp } from "../helpers.mjs";
import { findBrowser } from "../../skills/seo-supervisor/scripts/checks/render.mjs";

const SAMPLE = join(SKILL, "examples", "sample-audit.json");
const RENDER = join(SCRIPTS, "render-report.mjs");
const renderAudit = async (data, extra = []) => {
  const dir = tmp();
  writeFileSync(join(dir, "seo-audit.json"), JSON.stringify(data));
  const r = await node([RENDER, join(dir, "seo-audit.json"), ...extra]);
  return {
    dir,
    stdout: r.stdout,
    html: readFileSync(join(dir, "seo-audit.html"), "utf8"),
    md: readFileSync(join(dir, "seo-audit.md"), "utf8"),
  };
};

const browser = findBrowser();
test(
  "--pdf prints the report to a PDF with the installed Chrome or Edge",
  { skip: !browser && "no Chrome or Edge here", timeout: 180000 },
  async () => {
    const { dir, stdout } = await renderAudit(JSON.parse(readFileSync(SAMPLE, "utf8")), ["--pdf"]);
    const pdf = join(dir, "seo-audit.pdf");
    assert.ok(existsSync(pdf), stdout);
    assert.equal(readFileSync(pdf).subarray(0, 5).toString(), "%PDF-");
    assert.ok(statSync(pdf).size > 20000, "more than an empty page");
    assert.match(stdout, /seo-audit\.pdf/);
  },
);
