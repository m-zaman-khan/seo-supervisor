// gsc-import.mjs: Search Console CSV exports read into traffic, low-CTR and competing-page findings, and the report.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const G = join(ROOT, "test", "fixtures", "gsc");
async function importGsc(extra = []) {
  const out = join(tmp(), "gsc.json");
  await node([
    join(SCRIPTS, "gsc-import.mjs"),
    "--pages",
    join(G, "Pages.csv"),
    "--queries",
    join(G, "Queries.csv"),
    "--site-origin",
    "https://example.com",
    "--out",
    out,
    ...extra,
  ]);
  return JSON.parse(readFileSync(out, "utf8"));
}
const byRule = (r, rule) => r.findings.find(f => f.rule === rule);
const paths = f => f.evidence.map(e => new URL(e.url).pathname + new URL(e.url).search);

test("real export quirks parse: a BOM, quoted commas, percent CTRs; paths are keyed without the origin", async () => {
  const r = await importGsc();
  assert.deepEqual(r.traffic["/pricing/"], { clicks: 12, impressions: 3000, ctr: 0.004, position: 4.2 });
  assert.equal(r.traffic["/search?q=a,b"].impressions, 60, "a quoted URL with a comma stays one cell");
  assert.ok(
    Object.keys(r.traffic).every(k => k.startsWith("/")),
    "no origin and no BOM in the keys",
  );
  assert.equal(r.queries[1].query, "pricing, plans");
  assert.equal(r.queries[0].ctr, 0.06);
  assert.equal(r.period, "Last 3 months", "read from the export's Filters.csv");
});

test("low CTR and almost-page-one pages become findings", async () => {
  const r = await importGsc();
  assert.deepEqual(
    paths(byRule(r, "INTENT-03")),
    ["/pricing/"],
    "0.4% at position 4 against a 3.3% median for similar positions",
  );
  assert.deepEqual(paths(byRule(r, "INTENT-04")).sort(), ["/guide/", "/search?q=a,b"]);
  for (const f of r.findings)
    assert.ok(
      f.id && f.title && f.what && f.why && f.fix && f.source === "search-console" && f.category === "Search intent",
      f.rule,
    );
});

test("pages competing for one query are reported only from per-page exports", async () => {
  assert.equal(byRule(await importGsc(), "INTENT-02"), undefined);
  const r = await importGsc(["--page-queries", join(G, "page-queries")]);
  const f = byRule(r, "INTENT-02");
  assert.equal(f.count, 1);
  assert.match(f.evidence[0].detail, /pricing, plans/);
  assert.equal(r.pageQueries["/plans/"][0].query, "pricing, plans");
});

test("the report shows Search Console traffic on a finding about that page", async () => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  const f = data.findings.find(x => (x.evidence || []).some(e => e.url && /^https?:/.test(e.url)));
  const path = new URL(f.evidence.find(e => /^https?:/.test(e.url)).url).pathname;
  const row = data.plan.pages.find(r => r.url);
  data.traffic = {
    [path]: { clicks: 1234, impressions: 56789, ctr: 0.0217, position: 6.1 },
    [new URL(row.url, "https://x.invalid").pathname]: { clicks: 77, impressions: 880, ctr: 0.0875, position: 3 },
  };
  data.trafficPeriod = "Last 3 months";
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  const html = readFileSync(join(dir, "r.html"), "utf8");
  assert.match(html, /1,234 clicks · 56,789 impressions \(last 3 months\)/);
  assert.match(
    html,
    /<dt>Search traffic<\/dt><dd>77 clicks · 880 impressions/,
    "plan rows show the traffic of their page",
  );
});

// Real exports in other UI languages, duplicate URL variants, and long-tail overlaps.
import { mkdirSync } from "node:fs";
const run = async (dir, extra = []) => {
  const out = join(dir, "gsc.json");
  await node([join(SCRIPTS, "gsc-import.mjs"), "--pages", join(dir, "Pages.csv"), "--out", out, ...extra]);
  return JSON.parse(readFileSync(out, "utf8"));
};

test("a German export (translated headers, comma decimals, dotted thousands) imports by column position", async () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "Pages.csv"),
    '"Top-Seiten","Klicks","Impressionen","CTR","Position"\nhttps://example.com/a/,500,"10.000","5,1 %","3,1"\n',
  );
  writeFileSync(join(dir, "Filters.csv"), "Filter,Wert\nSuchtyp,Web\nDatum,Letzte 3 Monate\n");
  const r = await run(dir);
  assert.deepEqual(r.traffic["/a/"], { clicks: 500, impressions: 10000, ctr: 0.051, position: 3.1 });
  assert.equal(r.period, "Letzte 3 Monate");
});

test("a file that isn't a Pages export fails with a clear message instead of importing zeros", async () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "Pages.csv"),
    "Top queries,Clicks,Impressions,CTR,Position\nsecurity tools,300,5000,6%,2.5\n",
  );
  await assert.rejects(run(dir), e => /isn't a Search Console Pages export/.test(e.stderr));
  writeFileSync(
    join(dir, "Pages.csv"),
    "Top pages;Clicks;Impressions;CTR;Position\nhttps://example.com/;500;10000;5%;3.1\n",
  );
  await assert.rejects(run(dir), e => /isn't a Search Console Pages export/.test(e.stderr));
});

test("URL variants that map to one path add up instead of overwriting each other", async () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "Pages.csv"),
    "Top pages,Clicks,Impressions,CTR,Position\nhttps://www.example.com/p/,900,9000,10%,2\nhttp://example.com/p/,5,1000,0.5%,12\n",
  );
  const t = (await run(dir, ["--site-origin", "https://example.com"])).traffic["/p/"];
  assert.equal(t.clicks, 905);
  assert.equal(t.impressions, 10000);
  assert.equal(t.position, 3);
});

test("pages sharing only long-tail or home-page queries aren't reported as competing", async () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "Pages.csv"),
    "Top pages,Clicks,Impressions,CTR,Position\nhttps://example.com/a/,1,100,1%,9\n",
  );
  const pq = (name, page, rows) => {
    mkdirSync(join(dir, "pq", name), { recursive: true });
    writeFileSync(join(dir, "pq", name, "Queries.csv"), "Top queries,Clicks,Impressions,CTR,Position\n" + rows);
    writeFileSync(join(dir, "pq", name, "Filters.csv"), `Filter,Value\nPage,${page}\n`);
  };
  pq("a", "https://example.com/a/", "rare tail query,0,1,0%,40\nbrand,5,400,1.2%,1\n");
  pq("b", "https://example.com/b/", "rare tail query,0,2,0%,38\n");
  pq("home", "https://example.com/", "brand,90,4000,2.2%,1\n");
  const r = await run(dir, ["--page-queries", join(dir, "pq")]);
  assert.equal(
    r.findings.find(f => f.rule === "INTENT-02"),
    undefined,
  );
});
