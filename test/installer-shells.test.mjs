// @ts-check
// Installed hook commands run in each agent's own shell, from home folders with ' & ( and spaces in their names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, node, tmp } from "./helpers.mjs";
import * as devin from "../skills/seo-supervisor/scripts/guard/adapters/devin.mjs";

const BIN = join(ROOT, "bin", "seo-supervisor.mjs");
const env = home => {
  const e = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of [
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "APPDATA",
    "GROK_HOME",
    "COPILOT_HOME",
    "SEO_SUPERVISOR_GUARD",
    "DEVIN_PROJECT_DIR",
  ])
    delete e[k];
  return e;
};
const ASK = { decision: "ask", reason: "Submitting the sitemap to Google needs the owner's yes.", rule: "outside" };

test("Devin: a stop is decision block with exit 0, which every shell passes through (PowerShell turns exit 2 into 1)", () => {
  // A Devin hook blocks by exiting 2 or printing a "decision": "block" object; any other non-zero exit is only logged.
  // https://docs.devin.ai/cli/extensibility/hooks/overview
  const r = devin.respond(ASK);
  assert.equal(r.exitCode, 0);
  assert.equal(JSON.parse(r.stdout).decision, "block");
  assert.match(JSON.parse(r.stdout).reason, /sitemap.*Ask the owner in chat/s);
});
