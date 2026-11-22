// @ts-check
// knownChecks() reads crawl/catalog.mjs too, so turning a crawler check off gives no "isn't a check" warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECKS } from "../skills/seo-supervisor/scripts/crawl/catalog.mjs";
import { applyChecks, knownChecks } from "../skills/seo-supervisor/scripts/lib/score.mjs";

test("every crawler check in crawl/catalog.mjs is a known check, so settings.json can turn it off without a warning", () => {
  const known = knownChecks();
  assert.deepEqual(
    Object.keys(CHECKS).filter(id => !known.has(id)),
    [],
    "crawler checks knownChecks() can't see",
  );
  // Crawler-only checks: the catalog's own entries, not a checks/*.mjs module's.
  const off = [
    "robots-blocks-all",
    "sitemap-missing",
    "canonical-missing",
    "mixed-content",
    "markdown-differs",
    "product-image-missing",
  ];
  const r = applyChecks(
    [
      { check: "robots-blocks-all", rule: "CRAWL-01", severity: "blocker" },
      { check: "mixed-content", rule: "TRUST-01", severity: "medium" },
    ],
    { off },
  );
  assert.deepEqual(
    r.warnings.filter(w => /isn't a check/.test(w)),
    [],
  );
  assert.deepEqual(
    r.findings.map(f => f.check),
    ["robots-blocks-all"],
    "blockers stay; the rest are turned off",
  );
});
