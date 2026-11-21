// The grid has no base map: Google's terms forbid showing Places content on a non-Google map (14.2).
// https://cloud.google.com/maps-platform/terms/maps-service-terms
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, SKILL, node, tmp } from "./helpers.mjs";

const XSS = "<img src=x onerror=alert(1)>";
const render = async extra => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  writeFileSync(join(dir, "a.json"), JSON.stringify({ ...data, ...extra }));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};
// A 5×5 grid: position row + col + 1 from the north-west corner, unranked in the south-east, one failed request.
const cells = size =>
  Array.from({ length: size * size }, (_, i) => {
    const row = Math.floor(i / size),
      col = i % size;
    return {
      row,
      col,
      lat: 53.8 - row * 0.009,
      lng: -1.55 + col * 0.015,
      rank: row === 4 && col === 0 ? "error" : row + col >= 7 ? null : row + col + 1,
    };
  });
const GRID = {
  source: "geo-grid",
  date: "2026-11-22",
  placeId: "ChIJabc",
  center: { lat: 53.782, lng: -1.52 },
  size: 5,
  spacingKm: 1,
  biasRadiusM: 500,
  attribution: "Google Maps",
  label: "ignored: the report writes its own label",
  keywords: [
    { keyword: `plumber ${XSS}`, cells: cells(5) },
    { keyword: "boiler repair", cells: cells(5) },
  ],
  notes: [],
};

test("the geo-grid panel draws each keyword's grid with positions, the centre outlined, a legend, the label and the Google Maps credit", async () => {
  const before = await render({});
  assert.doesNotMatch(before.html + before.md, /Local rank grid/);
  const { html, md } = await render({ geoGrid: GRID });
  assert.match(html, /<summary>Local rank grid<\/summary>/);
  assert.match(html, /an approximation of Google Maps results, not a copy/);
  assert.equal((html.match(/class="gg-grid"/g) || []).length, 2, "one grid per keyword");
  assert.equal((html.match(/<span class="gg-c /g) || []).length, 50, "5×5 squares per keyword");
  assert.equal((html.match(/ gg-centre"/g) || []).length, 2, "the business's square is marked in each grid");
  // Counted from the cells, not taken from the file: top 3 where row+col <= 2 (6 squares), top 10 where
  // row+col <= 6 (24 squares; here all 22 numbered ones minus the failed one at row 4, col 0), not in the top 20
  // where row+col >= 7 (3).
  assert.match(html, /Top 3 at 6 of 25 spots · top 10 at 21 · not in the top 20 at 3 · 1 not checked/);
  assert.match(html, /title="2 km north, 2 km west: position 1"/, "the corner square says where it is");
  assert.match(html, /title="Your business: position 5"/);
  assert.match(html, /Places data: Google Maps/);
  for (const t of ["1–3", "4–10", "11–20", "Not in the top 20", "Not checked"]) assert.ok(html.includes(t), t);
  assert.match(html, /role="img" aria-label="plumber &lt;img src=x onerror=alert\(1\)&gt;: top 3 at 6 of 25 spots/);
  assert.doesNotMatch(html, /<img src=x/);
  // The Markdown: an aligned grid of numbers, north at the top, the centre in brackets.
  assert.match(md, /## Local rank grid/);
  assert.match(md, /```\nNorth\n {2}1 {3}2 {3}3 {3}4 {3}5\n/);
  assert.match(md, /\[5\]/);
  assert.match(md, /20\+/);
  assert.match(md, /Places data: Google Maps/);
  assert.doesNotMatch(md, /(?<!\\)<img src=x/);
  const scores = s => s.match(/\d+\/100/g);
  assert.deepEqual(scores(html), scores(before.html), "information only: no score moves");
});

test("the geo-grid panel shows the run's notes, which carry any third-party credit Google's terms require, escaped", async () => {
  const credit = `Google's results include data from ${XSS} (https://example.org/). Show this credit next to "Google Maps" wherever the grid is shown.`;
  const { html, md } = await render({ geoGrid: { ...GRID, notes: [credit, 42, "Stopped after 30 of 50 searches."] } });
  const panel = html.slice(
    html.indexOf('class="how geogrid"'),
    html.indexOf("</details>", html.indexOf('class="how geogrid"')),
  );
  assert.match(panel, /Google&#39;s results include data from &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(panel, /Stopped after 30 of 50 searches\./);
  assert.doesNotMatch(panel, /<img src=x|>42</, "escaped, and only text notes");
  assert.match(md, /Google's results include data from \\<img src=x onerror=alert\(1\)\\>/);
});

test("the geo-grid panel shows nothing for data it can't trust", async () => {
  for (const geoGrid of [
    { ...GRID, size: 6 },
    { ...GRID, keywords: [] },
    { ...GRID, keywords: [{ keyword: "x", cells: [{ row: 9, col: 9, rank: 1 }] }] },
    "nope",
  ]) {
    const { html, md } = await render({ geoGrid });
    assert.doesNotMatch(html + md, /Local rank grid/, JSON.stringify(geoGrid).slice(0, 60));
  }
  const odd = await render({
    geoGrid: {
      ...GRID,
      keywords: [
        {
          keyword: "plumber",
          cells: cells(5).map(c =>
            c.row === 0 && c.col === 0
              ? { ...c, rank: 99 }
              : c.row === 1 && c.col === 1
                ? { ...c, rank: "<b>1</b>" }
                : c,
          ),
        },
      ],
    },
  });
  const holes = await render({ geoGrid: { ...GRID, keywords: [{ keyword: "plumber", cells: cells(5).slice(1) }] } });
  assert.doesNotMatch(holes.html, /Local rank grid/, "a grid with a missing square isn't drawn");
  const panel = odd.html.slice(
    odd.html.indexOf('class="how geogrid"'),
    odd.html.indexOf("</details>", odd.html.indexOf('class="how geogrid"')),
  );
  assert.match(
    panel,
    /title="2 km north, 2 km west: not in the top 20">20\+</,
    "a position outside 1–20 reads as not in the top 20",
  );
  assert.doesNotMatch(panel, /<b>1<\/b>|>99</);
});
