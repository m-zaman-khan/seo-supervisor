// Site-wide basics: a site with no SEO work gets blockers and a low score; a normal site doesn't.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { ROOT, SCRIPTS, node, tmp } from "./helpers.mjs";

const SITEWIDE = ["title-missing-sitewide", "h1-missing-sitewide", "canonical-missing-sitewide"];

async function crawl(dir, origin) {
  const site = await serve(join(ROOT, "test", dir));
  const out = join(tmp(), "crawl.json");
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--site-origin", origin, "--out", out]);
  } finally {
    await site.close();
  }
  return out;
}

test("a site with no SEO work gets blockers for its missing basics and scores under 60", async () => {
  const out = await crawl("fixture-zero", "https://zero.example");
  const report = JSON.parse(readFileSync(out, "utf8"));
  for (const rule of ["META-01", "CONTENT-01", "URL-04"]) {
    const f = report.findings.find(x => x.rule === rule && x.severity === "blocker");
    assert.ok(f, `${rule} is a blocker`);
    assert.equal(f.count, 4, `${rule} counts every page`);
  }
  for (const key of ["title-missing", "title-short", "title-dup", "h1-missing", "canonical-missing"])
    assert.ok(!report.findings.some(f => f.check === key), `${key} is replaced by the site-wide finding`);
  const html = join(tmp(), "report.html");
  await node([join(SCRIPTS, "render-report.mjs"), out, "--out", html, "--no-md"]);
  const score = Number(readFileSync(html, "utf8").match(/<span class="n">(\d+)<\/span>/)[1]);
  assert.ok(score < 60, `score ${score} should be under 60`);
});

test("a normal site gets no site-wide basics findings", async () => {
  const report = JSON.parse(readFileSync(await crawl("fixture-site", "https://example-security.com"), "utf8"));
  for (const key of SITEWIDE) assert.ok(!report.findings.some(f => f.check === key), key);
});
