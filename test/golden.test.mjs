// @ts-check
// test/golden/update.mjs says what the snapshots hold and how they're kept stable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIR, build } from "./golden/update.mjs";

// The first line that differs, cut around the first differing character, and how many lines differ in all.
function shortDiff(want, got) {
  const a = want.split("\n"),
    b = got.split("\n");
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const x = a[i] ?? "(end of file)",
    y = b[i] ?? "(end of file)";
  let c = 0;
  while (c < x.length && x[c] === y[c]) c++;
  const cut = s => (s.length > 160 ? `${c > 60 ? "…" : ""}${s.slice(Math.max(0, c - 60), c + 100)}…` : s);
  const n = Array.from({ length: Math.max(a.length, b.length) }, (_, k) => a[k] !== b[k]).filter(Boolean).length;
  return `first difference at line ${i + 1}, ${n} line(s) differ (${a.length} lines saved, ${b.length} now):\n  saved: ${cut(x)}\n  now:   ${cut(y)}`;
}

test(
  "the crawl of both fixture sites and the kitchen-sink report match the saved golden outputs",
  { timeout: 120000 },
  async () => {
    const now = await build(),
      changed = [];
    const lf = s => s.replace(/\r\n/g, "\n"); // git checks text files out with LF (.gitattributes); this covers a CRLF copy
    for (const [name, text] of Object.entries(now)) {
      const saved = lf(readFileSync(join(DIR, name), "utf8"));
      if (saved !== lf(text)) changed.push(`${name}: ${shortDiff(saved, lf(text))}`);
    }
    if (changed.length)
      assert.fail(
        `${changed.join("\n")}\nIf the change is intended, rewrite the snapshots with: node test/golden/update.mjs`,
      );
  },
);
