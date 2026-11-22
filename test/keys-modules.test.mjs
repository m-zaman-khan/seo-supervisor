// What a script split into modules can quietly break: connect-keys.mjs over keys/, google.mjs over google/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { SCRIPTS } from "./helpers.mjs";

const keys = await import("../skills/seo-supervisor/scripts/connect-keys.mjs");
const google = await import("../skills/seo-supervisor/scripts/google.mjs");
const sc = await import("../skills/seo-supervisor/scripts/google/search-console.mjs");
const http = await import("../skills/seo-supervisor/scripts/keys/http.mjs");

test("every name other scripts and the tests import from connect-keys.mjs and google.mjs is exported there", () => {
  assert.deepEqual(Object.keys(keys).sort(), [
    "Fail",
    "Refused",
    "SERVICES",
    "activeKeys",
    "call",
    "domainOf",
    "fetchKeys",
    "keyFile",
    "removeKey",
    "savedKeys",
    "setKey",
    "submitBing",
  ]);
  assert.deepEqual(Object.keys(google).sort(), [
    "Fail",
    "anomaliesIn",
    "challengeFor",
    "fetchGoogle",
    "pagePath",
    "pkce",
    "positionShares",
    "searchConsole",
  ]);
  // One class each, so `instanceof` catches errors thrown inside keys/ and google/.
  assert.equal(keys.Fail, http.Fail);
  assert.equal(keys.Refused, http.Refused);
  assert.equal(google.Fail, sc.Fail);
  assert.equal(google.searchConsole, sc.searchConsole);
  assert.deepEqual(
    Object.keys(keys.SERVICES),
    [
      "bing",
      "openpagerank",
      "ahrefs",
      "matomo",
      "posthog",
      "moz",
      "youtube",
      "clarity",
      "perplexity",
      "openai",
      "googleplaces",
    ],
    "the order status and the dry run list them in",
  );
});

// The relative modules a script imports, followed through each file's static imports.
function reached(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const m of readFileSync(file, "utf8").matchAll(/^(?:import|export) [^;]*?from "(\.{1,2}\/[^"]+)"/gm))
    reached(join(dirname(file), m[1]), seen);
  return seen;
}
const rel = set => [...set].map(f => relative(SCRIPTS, f).split("\\").join("/"));

test("change-check.mjs and deploy-check.mjs reach Search Console without the sign-in code", () => {
  for (const script of ["change-check.mjs", "deploy-check.mjs"]) {
    const got = rel(reached(join(SCRIPTS, script)));
    assert.ok(got.includes("google/search-console.mjs"), script);
    for (const no of ["google.mjs", "lib/google-client.mjs", "gsc-import.mjs"])
      assert.ok(!got.includes(no), `${script} loads ${no}`);
  }
  // The modules they load start no browser, no local web server and no prompt.
  for (const f of ["google/search-console.mjs", "google/session.mjs"])
    assert.doesNotMatch(
      readFileSync(join(SCRIPTS, f), "utf8"),
      /from "node:(http|child_process|readline\/promises)"/,
      f,
    );
});

test("keys/ and google/ hold no check names or rule IDs, which only scripts/ and scripts/checks/ are read for", () => {
  // lib/score.mjs knownChecks() and the rule-ID test in manifest.test.mjs scan those two folders, so a finding built in
  // keys/ or google/ would read as unknown in settings.json. Findings stay in connect-keys.mjs and google.mjs.
  for (const dir of ["keys", "google"])
    for (const f of readdirSync(join(SCRIPTS, dir))) {
      const text = readFileSync(join(SCRIPTS, dir, f), "utf8");
      assert.doesNotMatch(text, /\bcheck: "|\bfinding\("|"[A-Z]+-\d{2}"/, `${dir}/${f}`);
    }
});
