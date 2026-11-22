// @ts-check
// How findings are stored, named and printed; old ids keep working through ID_ALIASES.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL, tmp } from "./helpers.mjs";
import { ID_ALIASES, RULES, currentId } from "../skills/seo-supervisor/scripts/crawl/catalog.mjs";
import { applyChecks, findingsOf, knownChecks } from "../skills/seo-supervisor/scripts/lib/score.mjs";
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

// ---------- rule titles ----------
test("the crawler's rule titles are the rule docs' headings, word for word", () => {
  const doc = new Map();
  for (const dir of ["rules", "site-types"])
    for (const f of readdirSync(join(SKILL, dir)))
      for (const m of readFileSync(join(SKILL, dir, f), "utf8").matchAll(/^### ([A-Z]+-\d+) · (.+?) · /gm))
        doc.set(m[1], m[2]);
  const drift = Object.entries(RULES)
    .filter(([id, [title]]) => doc.get(id) !== title)
    .map(([id, [title]]) => `${id}: “${title}” vs “${doc.get(id)}”`);
  assert.deepEqual(drift, []);
});

// ---------- knownChecks ----------
test("knownChecks sees a check on the same line as its catalog's opening brace, and no product-problem codes", () => {
  const known = knownChecks();
  assert.ok(known.has("server-known-holes"), 'SERVER_CHECK = { "server-known-holes": … is on one line');
  for (const id of [
    "product-image-missing",
    "product-adult-unlabelled",
    "backlinks-gone",
    "bing-crawl-issues",
    "linked-page-broken",
    "low-ctr",
    "bot-errors",
  ])
    assert.ok(known.has(id), id);
  for (const id of ["image-missing", "adult-unlabelled"])
    assert.ok(!known.has(id), `${id} is a product problem's code; its finding is product-${id}`);
  const r = applyChecks([{ check: "server-known-holes", rule: "TRUST-01", severity: "needs-decision" }], {
    off: ["server-known-holes"],
  });
  assert.deepEqual([r.findings, r.warnings], [[], []]);
});

test("settings that named a product problem by its short code apply to its finding", () => {
  const audit = {
    findings: [
      { ...F("F-001", "product-image-missing", "medium"), rule: "SHOP-05" },
      { ...F("F-002", "product-adult-unlabelled", "medium"), rule: "SHOP-05" },
    ],
  };
  const r = findingsOf(
    audit,
    auditDir({ checks: { off: ["image-missing"], severity: { "adult-unlabelled": "low" } } }),
  );
  assert.deepEqual(
    r.findings.map(f => [f.id, f.severity]),
    [["F-002", "low"]],
  );
  assert.equal(r.warnings.filter(w => /isn't a check/.test(w)).length, 0);
});
