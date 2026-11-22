// @ts-check
// Headings, thin pages, long titles, orphans, the near-duplicate chunk index and the "how to tell it worked" lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";
import { CHECKS, CONTENT_RENAMED } from "../skills/seo-supervisor/scripts/crawl/catalog.mjs";
import { nearPairs } from "../skills/seo-supervisor/scripts/checks/site-pages.mjs";
import { applyChecks } from "../skills/seo-supervisor/scripts/lib/score.mjs";

const ORIGIN = "https://site.example";
const TEXT =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ";
const page = ({ title, main, nav = "" }) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="canonical" href="${ORIGIN}/"></head><body><header><nav>${nav}</nav></header><main>${main}</main><footer><a href="/">Home</a></footer></body></html>`;
const words = n => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const PAGES = {
  "/": page({
    title: "Northwind Plumbing in Leeds and York",
    nav: `<a href="/nav-only/">Menu page</a>`,
    main:
      `<h1>Plumbing in Leeds</h1><p>${TEXT.repeat(6)}</p>` +
      ["two-h1", "no-h1", "skip", "short", "long-title"].map(p => `<a href="/${p}/">${p}</a>`).join(" "),
  }),
  "/two-h1/": page({
    title: "Boiler repair in Leeds | Northwind",
    main: `<h1>Boiler repair</h1><h1>Call us</h1><p>${TEXT.repeat(6)}</p>`,
  }),
  "/no-h1/": page({
    title: "Radiator fitting in Leeds | Northwind",
    main: `<h2>Radiators</h2><p>${TEXT.repeat(6)}</p>`,
  }),
  "/skip/": page({
    title: "Leak detection in Leeds | Northwind",
    main: `<h1>Leak detection</h1><h3>How we find leaks</h3><p>${TEXT.repeat(6)}</p>`,
  }),
  "/short/": page({ title: "Contact Northwind Plumbing", main: `<h1>Contact us</h1><p>${words(60)}</p>` }),
  "/long-title/": page({
    title: "Emergency plumbers in Leeds, York, Harrogate and Wakefield, open every day | Northwind",
    main: `<h1>Emergency plumbers</h1><p>${TEXT.repeat(6)}</p>`,
  }),
  "/nav-only/": page({
    title: "Gas safety checks in Leeds | Northwind",
    main: `<h1>Gas safety checks</h1><p>${TEXT.repeat(6)}</p>`,
  }),
  "/orphan/": page({
    title: "Old offer page in Leeds | Northwind",
    main: `<h1>Old offer</h1><p>${TEXT.repeat(6)}</p>`,
  }),
};

let crawled;
async function crawl() {
  if (crawled) return crawled;
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(PAGES)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html.replace(`${ORIGIN}/"`, `${ORIGIN}${p}"`));
  }
  writeFileSync(join(dir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  writeFileSync(
    join(dir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(
      PAGES,
    )
      .map(p => `<url><loc>${ORIGIN}${p}</loc></url>`)
      .join("")}</urlset>`,
  );
  const site = await serve(dir);
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--site-origin", ORIGIN, "--out", out]);
  } finally {
    await site.close();
  }
  return (crawled = JSON.parse(readFileSync(out, "utf8")));
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const pathsOf = (r, check) => (findingOf(r, check)?.evidence || []).map(e => new URL(e.url).pathname).sort();

test("h1-count is split into h1-missing and h1-multiple, both low; heading-skip is low and about screen readers", async () => {
  const r = await crawl();
  assert.equal(findingOf(r, "h1-count"), undefined, "the old id is gone");
  assert.deepEqual(pathsOf(r, "h1-missing"), ["/no-h1/"]);
  assert.deepEqual(pathsOf(r, "h1-multiple"), ["/two-h1/"]);
  assert.equal(findingOf(r, "h1-multiple").evidence[0].detail, "2 H1s");
  for (const id of ["h1-missing", "h1-multiple", "heading-skip"]) assert.equal(findingOf(r, id)?.severity, "low", id);
  assert.ok(pathsOf(r, "heading-skip").includes("/skip/"));
  assert.match(CHECKS["heading-skip"][3], /[Ss]creen readers/);
  assert.match(CHECKS["heading-skip"][3], /Google Search doesn't mind/);
  assert.doesNotMatch(CHECKS["heading-skip"][3], /search engines .*use/);
  assert.match(CHECKS["h1-multiple"][3], /no ideal number of headings/);
  assert.equal(CHECKS["h1-missing-sitewide"][1], "blocker", "a site with no H1s anywhere stays a blocker");
});

test("the old id maps to the new ones, for settings.json and the diff", () => {
  assert.deepEqual(CONTENT_RENAMED["h1-count"], ["h1-missing", "h1-multiple"]);
  assert.deepEqual(CONTENT_RENAMED.orphan, ["orphan", "nav-only-links"]);
  for (const ids of Object.values(CONTENT_RENAMED)) for (const id of ids) assert.ok(CHECKS[id], id);
});

// Passes once applyChecks (lib/score.mjs) reads ID_ALIASES; drop `todo` then.
test(
  "a settings.json that turns h1-count off turns off both h1 checks",
  { todo: "applyChecks reads ID_ALIASES" },
  () => {
    const F = check => ({ id: check, check, severity: "low", rule: "CONTENT-01", evidence: [] });
    const r = applyChecks(
      [F("h1-missing"), F("h1-multiple"), F("title-short")],
      { off: ["h1-count"] },
      new Set(Object.keys(CHECKS)),
    );
    assert.deepEqual(
      r.findings.map(f => f.check),
      ["title-short"],
    );
    assert.deepEqual(r.warnings, []);
  },
);

test("thin-page and title-long are low and say what Google says", async () => {
  const r = await crawl();
  assert.ok(pathsOf(r, "thin-page").includes("/short/"));
  assert.deepEqual(pathsOf(r, "title-long"), ["/long-title/"]);
  for (const id of ["thin-page", "title-long"]) assert.equal(findingOf(r, id).severity, "low", id);
  assert.doesNotMatch(CHECKS["thin-page"][3], /rarely rank/);
  assert.match(CHECKS["thin-page"][3], /no word count target/);
  assert.match(CHECKS["thin-page"][3], /our own/);
  assert.match(CHECKS["title-long"][3], /no length limit/);
  assert.match(CHECKS["title-long"][3], /our own/);
});

test("a page with no links at all is an orphan; one linked only from the menu or footer is its own low finding", async () => {
  const r = await crawl();
  assert.deepEqual(pathsOf(r, "orphan"), ["/orphan/"]);
  assert.equal(findingOf(r, "orphan").severity, "medium");
  assert.equal(findingOf(r, "orphan").evidence[0].detail, "no links at all");
  assert.deepEqual(pathsOf(r, "nav-only-links"), ["/nav-only/"]);
  assert.equal(findingOf(r, "nav-only-links").severity, "low");
  assert.equal(findingOf(r, "nav-only-links").evidence[0].detail, "only menu, footer or sidebar links (1)");
});

const ruleSeverity = (file, id) =>
  readFileSync(join(SKILL, "rules", file), "utf8").match(new RegExp(`^### ${id} · .* · (\\S+)`, "m"))?.[1];
test("LINK-01's severity in its rule matches the crawler's, and LINK-02 doesn't say menu links don't count", () => {
  assert.equal(ruleSeverity("internal-linking.md", "LINK-01"), CHECKS["deep-page"][1]);
  assert.equal(ruleSeverity("internal-linking.md", "LINK-02"), CHECKS.orphan[1]);
  const md = readFileSync(join(SKILL, "rules", "internal-linking.md"), "utf8");
  assert.doesNotMatch(md, /don't count/);
  assert.match(md, /`nav-only-links`/);
  assert.equal(ruleSeverity("content.md", "CONTENT-02"), "low");
});

// Every pair compared: the reference the chunk index must match.
function allPairs(sets) {
  const out = [];
  for (let i = 0; i < sets.length; i++)
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i],
        b = sets[j],
        [small, big] = a.size < b.size ? [a, b] : [b, a];
      if (small.size / big.size < 0.4) continue;
      let inter = 0;
      for (const x of small) if (big.has(x)) inter++;
      const dice = (2 * inter) / (a.size + b.size);
      if (dice > 0.6) out.push([i, j, dice]);
    }
  return out;
}

test("the chunk index finds the same near-duplicate pairs as comparing every pair, in the same order", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const base = Array.from({ length: 12 }, () =>
    Array.from({ length: 80 + Math.floor(rnd() * 120) }, () => `w${Math.floor(rnd() * 5000)}`),
  );
  // Pages built from a few templates with some chunks swapped, so many pairs sit near the 60% line.
  const sets = Array.from({ length: 150 }, () => {
    const t = base[Math.floor(rnd() * base.length)],
      keep = 0.3 + rnd() * 0.7;
    return new Set(t.map(x => (rnd() < keep ? x : `u${Math.floor(rnd() * 1e6)}`)));
  });
  const want = allPairs(sets);
  assert.ok(want.length > 50, `${want.length} planted pairs`);
  assert.deepEqual(nearPairs(sets), want);
});

test("pages past the 400th are compared too", () => {
  const sets = Array.from({ length: 450 }, (_, i) => new Set(Array.from({ length: 60 }, (_, k) => `p${i}-${k}`)));
  sets[449] = new Set(sets[440]);
  assert.deepEqual(
    nearPairs(sets).map(([i, j, d]) => [i, j, d]),
    [[440, 449, 1]],
  );
});

test("every rule area has a 'how to tell it worked' line, and each grow-plan item has a Watch line", () => {
  const areas = new Set();
  for (const d of ["rules", "site-types"])
    for (const f of readdirSync(join(SKILL, d)))
      for (const m of readFileSync(join(SKILL, d, f), "utf8").matchAll(/^### ([A-Z]+)-\d+/gm)) areas.add(m[1]);
  const grow = readFileSync(join(SKILL, "grow.md"), "utf8");
  const table = grow.split("## How to tell it worked")[1]?.split("\n## ")[0] || "";
  const rows = table.split("\n").filter(l => /^\| `/.test(l));
  for (const a of areas)
    assert.ok(
      rows.some(l => l.split("|")[1].includes(`\`${a}\``)),
      `no row for ${a}`,
    );
  for (const l of rows) assert.equal(l.split("|").length, 7, `five cells: area, number, where, which way, when: ${l}`);
  assert.match(grow, /- \*\*Watch:\*\* \{/);
});
