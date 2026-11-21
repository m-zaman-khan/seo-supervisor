// A missing llms.txt is a low MAP-07 finding, because AI tools read it and Google doesn't. It's worded honestly: a map
// for AI tools, never a ranking boost. Local fixtures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";

const page = title =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>Boiler repairs and servicing across Leeds, with a written price before any work starts.</p></main></body></html>`;

async function crawlSite(files = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), page("Boiler Repairs and Servicing in Leeds"));
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir, { files });
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://site.example",
      "--out",
      out,
    ]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const file = (type, body) => ({ type, body: Buffer.from(body) });
const findingOf = (r, check) => r.findings.find(f => f.check === check);

test("no llms.txt, or an HTML page at /llms.txt, is a low MAP-07 finding; a valid one is neither finding and passes", async () => {
  const [none, html, good] = await Promise.all([
    crawlSite(),
    crawlSite({
      "/llms.txt": file(
        "text/html; charset=utf-8",
        "<!doctype html><html><head><title>Home</title></head><body>Welcome</body></html>",
      ),
    }),
    crawlSite({
      "/llms.txt": file(
        "text/plain; charset=utf-8",
        "# Northwind Plumbing\n\n> Boiler repairs in Leeds.\n\n- [About](https://site.example/about/): the team\n",
      ),
    }),
  ]);
  const f = findingOf(none, "llms-txt-missing");
  assert.ok(f, JSON.stringify(none.findings.map(x => x.check)));
  assert.deepEqual([f.rule, f.severity, f.count], ["MAP-07", "low", 1]);
  assert.match(f.evidence[0].url, /\/llms\.txt$/);
  assert.match(f.evidence[0].detail, /404/);
  // A map some AI tools read, in Google's own words, and never a ranking boost.
  assert.match(f.why, /AI tools/);
  assert.match(f.why, /developer docs/);
  assert.match(f.why, /“will neither harm nor help your site's visibility or rankings in Google Search”/);
  assert.match(f.why, /isn't a ranking factor/);
  assert.doesNotMatch(f.title + f.why + f.fix, /boost|improves? (your )?rank|helps? (you )?rank/i);
  assert.match(f.fix, /`# Site name`/);
  assert.match(f.fix, /examples\/snippets\.md/);
  assert.match(f.fix, /seo-audit\/settings\.json/);
  assert.ok(!none.notes.some(n => /llms\.txt/.test(n)), "no separate note: " + none.notes.join("\n"));
  assert.ok(!none.passed.some(p => p.rule === "MAP-07"));

  assert.match(
    findingOf(html, "llms-txt-missing")?.evidence[0].detail || "",
    /HTML page/,
    "an HTML page there counts as missing",
  );
  assert.ok(!findingOf(html, "llms-structure"), "an HTML page isn't checked as llms.txt");

  for (const key of ["llms-txt-missing", "llms-structure"]) assert.ok(!findingOf(good, key), key);
  assert.ok(good.passed.some(p => p.rule === "MAP-07"));
});

test("MAP-07's rule text names the check, says it can be turned off, and keeps it off the ranking claims", () => {
  const map07 = readFileSync(join(SKILL, "rules", "sitemaps-robots.md"), "utf8")
    .split("### MAP-07 ·")[1]
    .split("\n### ")[0];
  assert.match(map07, /`llms-txt-missing`/);
  assert.match(map07, /`llms-structure`/);
  assert.match(map07, /settings\.json/);
  assert.match(map07, /neither harm nor help/);
  assert.doesNotMatch(map07, /a note in the crawl/);
  const myth = readFileSync(join(SKILL, "rules", "ai-search.md"), "utf8")
    .split("## Myths to correct in reports")[1]
    .split("\n")[1];
  assert.match(myth, /^- llms\.txt, Markdown copies/, "the myth line is there");
  assert.match(myth, /MAP-07/, "and says why the audit still reports a missing one");
});
