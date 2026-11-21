// The settings folder SEO_SUPERVISOR_HOME and what follows it, and odd input that's skipped or explained, not a crash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp } from "./helpers.mjs";
import { findBrowser } from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { findLighthouse } from "../skills/seo-supervisor/scripts/checks/lighthouse.mjs";

test("findBrowser falls back to the browser --with-browser installed, in the settings folder SEO_SUPERVISOR_HOME names", () => {
  const home = tmp(),
    chrome = join(home, "chrome.exe");
  mkdirSync(join(home, "tools"), { recursive: true });
  writeFileSync(chrome, "");
  writeFileSync(join(home, "tools", "chrome-path.txt"), chrome + "\n");
  assert.equal(
    findBrowser({ SEO_SUPERVISOR_HOME: home }, "linux", p => p === chrome),
    chrome,
  );
  assert.equal(
    findBrowser(
      { SEO_SUPERVISOR_HOME: home, CHROME_PATH: "/x/chrome" },
      "linux",
      p => p === "/x/chrome" || p === chrome,
    ),
    "/x/chrome",
    "CHROME_PATH still comes first",
  );
  assert.equal(
    findBrowser({ SEO_SUPERVISOR_HOME: tmp() }, "linux", () => false),
    null,
  );
});

test("findLighthouse looks in the settings folder SEO_SUPERVISOR_HOME names", () => {
  const home = tmp(),
    bin = join(home, "tools", "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "lighthouse"), "");
  assert.equal(findLighthouse({ SEO_SUPERVISOR_HOME: home, PATH: "" }, "/nowhere", "linux"), join(bin, "lighthouse"));
});
