// The Chrome tests are in test/browser/crawl.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { ROOT, SCRIPTS, node, tmp } from "./helpers.mjs";

// The fixture site has one planted problem per rule below, and a few things that are deliberately right.
test("the crawler finds every planted problem on the fixture site", async () => {
  const site = await serve(join(ROOT, "test", "fixture-site"));
  const out = join(tmp(), "crawl.json");
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://example-security.com",
      "--banned",
      "lorem ipsum|award-winning",
      "--verify",
      "guaranteed",
      "--out",
      out,
    ]);
  } finally {
    await site.close();
  }
  const report = JSON.parse(readFileSync(out, "utf8"));
  const found = new Set(report.findings.map(f => f.rule));
  const passed = new Set(report.passed.map(p => p.rule));

  const planted = {
    "REND-01": "a page whose content only exists in JavaScript",
    "CRAWL-01": "a sitemap URL blocked by robots.txt",
    "CRAWL-02": "a noindex page listed in the sitemap",
    "CRAWL-07": "an internal link to a 404",
    "LINK-02": "an orphan page only the sitemap links to",
    "URL-04": "a missing canonical and a canonical with a query string",
    "SCHEMA-01": "JSON-LD that doesn't parse",
    "SCHEMA-04": "FAQ schema for questions the page doesn't show",
    "CONTENT-01": "a page with two H1s",
    "CONTENT-09": "placeholder text",
    "CONTENT-10": "a banned claim",
    "AI-01": "an indexable page that blocks snippets",
    "MAP-06": "robots.txt blocking an AI crawler",
  };
  for (const [rule, what] of Object.entries(planted)) assert.ok(found.has(rule), `missed ${rule}: ${what}`);
  assert.ok(
    report.findings.some(f => f.rule === "REND-01" && f.severity === "blocker"),
    "a JS-only page is a blocker",
  );

  // Things the fixture gets right must pass, not be flagged.
  assert.ok(passed.has("CRAWL-05"), "unknown URLs return a real 404, so the soft-404 check passes");
  assert.ok(passed.has("MAP-01"), "the sitemap is found");

  for (const f of report.findings)
    assert.ok(f.what && f.why && f.fix, `${f.rule} "${f.title}" needs what, why and fix`);

  // Each page's description and H1 text are recorded, so a planned page can be checked after it is built.
  const home = report.pages.find(p => new URL(p.url).pathname === "/");
  assert.equal(home.h1Text, "Free security tools");
  assert.match(home.description, /^A perfectly reasonable description/);
});
