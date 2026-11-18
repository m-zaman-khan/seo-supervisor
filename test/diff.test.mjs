import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffCrawls } from "../skills/seo-supervisor/scripts/seo-diff.mjs";
import { ROOT, SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const OLD = join(ROOT, "test", "fixtures", "crawl-old.json"),
  NEW = join(ROOT, "test", "fixtures", "crawl-new.json");
const read = p => JSON.parse(readFileSync(p, "utf8"));
const kinds = list => list.map(c => `${c.path} ${c.kind}`).sort();

test("two crawls are compared page by page, by path", () => {
  const d = diffCrawls(read(OLD), read(NEW));
  assert.deepEqual(kinds(d.regressions), [
    "/a/ noindex-added",
    "/c/ canonical-changed",
    "/d/ h1-removed",
    "/f/ schema-removed",
    "/h/ status-error",
    "/j/ title-changed",
  ]);
  assert.deepEqual(kinds(d.improvements), [
    "/b/ noindex-removed",
    "/e/ h1-added",
    "/g/ schema-added",
    "/i/ status-fixed",
  ]);
  assert.deepEqual(kinds(d.changed), ["/k/ title-changed"], "a new non-empty title is neutral");
  assert.deepEqual(d.added, ["/new/"]);
  assert.deepEqual(d.removed, ["/gone/"], "/about/ moved from a local to the public origin and is the same page");
  const c = d.regressions.find(x => x.kind === "canonical-changed");
  assert.deepEqual([c.before, c.after], ["https://example.com/c/", "https://example.com/a/"]);
});

test("the CLI writes the diff with the old crawl's date", async () => {
  const out = join(tmp(), "seo-diff.json");
  await node([join(SCRIPTS, "seo-diff.mjs"), OLD, NEW, "--out", out]);
  const d = read(out);
  assert.equal(d.since, "2026-10-01T09:00:00.000Z");
  assert.equal(d.regressions.length, 6);
});

const render = async diff => {
  const dir = tmp(),
    data = read(join(SKILL, "examples", "sample-audit.json"));
  if (diff) data.diff = diff;
  else delete data.diff;
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};

test("the report shows a Since last audit tab with the regression count", async () => {
  const { html, md } = await render({ since: "2026-10-01T09:00:00.000Z", ...diffCrawls(read(OLD), read(NEW)) });
  assert.match(html, /id="t-diff"[^>]*>Since last audit<span class="cnt">6<\/span>/);
  assert.match(html, /Now noindex/);
  assert.match(md, /## Since last audit/);
});

test("without a diff there's no Since last audit tab", async () => {
  const { html } = await render(null);
  assert.doesNotMatch(html, /id="t-diff"/);
});
