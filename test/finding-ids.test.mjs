// @ts-check
// How findings are stored, named and printed; old ids keep working through ID_ALIASES.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp } from "./helpers.mjs";
import { ID_ALIASES, currentId } from "../skills/seo-supervisor/scripts/crawl/catalog.mjs";
import { findingsOf } from "../skills/seo-supervisor/scripts/lib/score.mjs";
import { diffCrawls, timeline } from "../skills/seo-supervisor/scripts/seo-diff.mjs";

// A rename for the test only, taken out again after each test that adds it.
const renamed = fn => () => {
  ID_ALIASES["old-id"] = "title-long";
  try {
    return fn();
  } finally {
    delete ID_ALIASES["old-id"];
  }
};
const F = (id, check, severity = "low") => ({
  id,
  check,
  rule: "META-01",
  severity,
  status: "open",
  category: "Metadata",
  title: check,
  evidence: [{ url: "https://www.example.com/" }],
});
const auditDir = settings => {
  const dir = join(tmp(), "seo-audit");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
  return dir;
};

// ---------- the old-to-new id table ----------
test(
  "currentId follows ID_ALIASES (renames of renames too) and leaves every other id alone",
  renamed(() => {
    assert.equal(currentId("old-id"), "title-long");
    assert.equal(currentId("title-long"), "title-long");
    assert.equal(currentId("constructor"), "constructor", "only the table's own keys");
    ID_ALIASES["older-id"] = "old-id";
    try {
      assert.equal(currentId("older-id"), "title-long");
    } finally {
      delete ID_ALIASES["older-id"];
    }
  }),
);

test(
  "an old id in settings.json's off and severity lists still applies, with a note to rename it",
  renamed(() => {
    const audit = { findings: [F("F-001", "title-long"), F("F-002", "desc-dup", "medium")] };
    const off = findingsOf(audit, auditDir({ checks: { off: ["old-id"] } }));
    assert.deepEqual(
      off.findings.map(f => f.id),
      ["F-002"],
      "the old id turns the renamed check off",
    );
    assert.deepEqual(off.off, [{ check: "title-long", count: 1 }]);
    assert.equal(off.warnings.filter(w => /isn't a check/.test(w)).length, 0);
    assert.match(off.warnings.join("\n"), /“old-id” is now called “title-long”/);
    const sev = findingsOf(audit, auditDir({ checks: { severity: { "old-id": "high" } } }));
    assert.deepEqual(
      sev.findings.map(f => [f.check, f.severity]),
      [
        ["title-long", "high"],
        ["desc-dup", "medium"],
      ],
    );
  }),
);

test(
  "an audit or crawl written before a rename reads as the new id, so settings with the new id apply to it",
  renamed(() => {
    const old = { findings: [F("F-001", "old-id"), F("F-002", "desc-dup", "medium")] };
    const r = findingsOf(old, auditDir({ checks: { off: ["title-long"] } }));
    assert.deepEqual(
      r.findings.map(f => f.id),
      ["F-002"],
    );
    assert.deepEqual(r.warnings, []);
    const kept = findingsOf({ findings: [{ ...F("F-001", "old-id"), status: "wont-fix" }] }, auditDir({}));
    assert.deepEqual(
      kept.findings.map(f => [f.check, f.status]),
      [["title-long", "wont-fix"]],
      "a won't-fix finding keeps its status under the new id",
    );
  }),
);

test(
  "a history crawl with an old id shows neither a fixed nor a new finding in Since last audit",
  renamed(() => {
    const page = { url: "https://www.example.com/", status: 200, title: "Home" };
    const before = {
      crawledAt: "2026-11-01T00:00:00Z",
      pages: [page],
      findings: [{ check: "old-id", rule: "META-01", severity: "low", count: 1 }],
    };
    const after = {
      crawledAt: "2026-11-22T00:00:00Z",
      pages: [page],
      findings: [{ check: "title-long", rule: "META-01", severity: "low", count: 1 }],
    };
    const d = diffCrawls(before, after);
    assert.deepEqual(
      [d.regressions, d.improvements, d.changed, d.added, d.removed],
      [[], [], [], [], []],
      "seo-diff compares pages, never finding ids",
    );
    assert.deepEqual(
      timeline([before, after]).map(r => r.findings),
      [1, 1],
    );
  }),
);
