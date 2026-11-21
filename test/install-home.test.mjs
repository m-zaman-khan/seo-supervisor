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

test("a guide's schema date that isn't a date is skipped, never a crash", async () => {
  const { newestDate } = await import("../skills/seo-supervisor/scripts/checks/content.mjs");
  for (const bad of ["", "N/A", "{{date}}", "Mon, 03 Jun 24", "2024-13-45"])
    assert.equal(
      newestDate("<p>How to bleed a radiator</p>", [{ dateModified: bad }], Date.UTC(2026, 10, 21)),
      null,
      JSON.stringify(bad),
    );
  assert.equal(
    newestDate("", [{ dateModified: "N/A", datePublished: "2025-03-01" }], Date.UTC(2026, 10, 21)).date,
    "2025-03-01",
    "the good date still counts",
  );
});

test("masking secrets leaves ordinary site URLs alone", async () => {
  const { redact } = await import("../skills/seo-supervisor/scripts/lib/redact.mjs");
  for (const u of [
    "https://example.com/home/garden/",
    "https://example.com/c/home/kitchen?sort=asc",
    "https://example.com/Users/guide/",
    "https://shop.example/p?key=blue",
  ])
    assert.equal(redact(u), u, u);
  assert.equal(
    redact("https://example.com/x?api_key=abcd1234efgh5678"),
    "https://example.com/x?api_key=[hidden]",
    "a real secret is still masked",
  );
});

test("findLighthouse looks in the settings folder SEO_SUPERVISOR_HOME names", () => {
  const home = tmp(),
    bin = join(home, "tools", "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "lighthouse"), "");
  assert.equal(findLighthouse({ SEO_SUPERVISOR_HOME: home, PATH: "" }, "/nowhere", "linux"), join(bin, "lighthouse"));
});
