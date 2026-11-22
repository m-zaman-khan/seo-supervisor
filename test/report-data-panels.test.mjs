// @ts-check
// The data panels, and the result files in seo-audit/ that fill in what the audit JSON lacks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, tmp } from "./helpers.mjs";
import { panelHtml, panelMd } from "../skills/seo-supervisor/scripts/report/panel.mjs";
import {
  logsPanel,
  brandTrendPanel,
  topSearchesPanel,
  keywordIdeasPanel,
  indexVerdictPanel,
} from "../skills/seo-supervisor/scripts/report/panels/data-search.mjs";
import { schemaInventoryPanel } from "../skills/seo-supervisor/scripts/report/panels/data-site.mjs";
import { loadSources, fromFile } from "../skills/seo-supervisor/scripts/report/sources.mjs";
import { render } from "../skills/seo-supervisor/scripts/render-report.mjs";

const PANELS = {
  logsPanel,
  brandTrendPanel,
  topSearchesPanel,
  keywordIdeasPanel,
  indexVerdictPanel,
  schemaInventoryPanel,
};
const TABS = ["search-ai", "speed", "links", "site-content", "since"];
const sink = () => JSON.parse(readFileSync(join(ROOT, "test", "golden", "kitchen-sink.json"), "utf8"));
const draw = vm => ({ html: panelHtml(vm), md: panelMd(vm).join("\n") });

test("each data panel renders from the kitchen-sink audit, with a topic tab, on the page and in the Markdown", () => {
  const m = { raw: sink() };
  for (const [name, panel] of Object.entries(PANELS)) {
    const vm = panel(m);
    assert.ok(vm, `${name} drew nothing from kitchen-sink.json`);
    assert.ok(TABS.includes(vm.tab), `${name}'s tab is ${vm.tab}`);
    const { html, md } = draw(vm);
    assert.match(html, /<details class="how /, name);
    assert.match(md, new RegExp(`^## ${vm.title}`), name);
  }
  const text = Object.values(PANELS)
    .map(p => draw(p(m)).md)
    .join("\n");
  for (const want of [
    "claiming to be",
    "Googlebot",
    "chatgpt.com",
    "/old-offers/",
    "−25%",
    "combi boiler cost",
    "boiler service near me",
    "Excluded",
    "Valid",
    "BreadcrumbList",
    "Product",
  ])
    assert.ok(text.includes(want), `missing ${want}`);
});

test("each data panel is null when its data is missing or empty", () => {
  const empty = {
    logScan: { bots: {}, aiReferrals: {}, googleReferrals: null, repeated404s: [] },
    brandSplit: { branded: { clicks: 1, impressions: 2 }, nonBranded: { clicks: 3, impressions: 4 } },
    queries: [],
    traffic: {},
    keywordIdeas: { almostThere: [], gaps: null, questions: [] },
    inspection: [],
    pages: [{ url: "https://x.com/", schema: [] }],
  };
  for (const [name, panel] of Object.entries(PANELS)) {
    assert.equal(panel({ raw: {} }), null, `${name} with no data`);
    assert.equal(panel({ raw: empty }), null, `${name} with empty data`);
  }
});

test("text from logs, Search Console and the crawl is escaped on the page and in the Markdown", () => {
  const x = "<script>alert(1)</script>";
  const raw = {
    logScan: {
      period: { from: "2026-11-01T00:00:00.000Z", to: "2026-11-14T00:00:00.000Z" },
      bots: { [x]: { vendor: x, group: "search", requests: 9, paths: 2 } },
      aiReferrals: { [x]: { visits: 3, topPages: [{ path: "/" + x, visits: 3 }] } },
      googleReferrals: { visits: 4, topPages: [{ path: "/" + x, visits: 4 }] },
      repeated404s: [{ path: "/" + x, requests: 7, bots: [x] }],
    },
    brandSplit: {
      branded: { clicks: 1, impressions: 2 },
      nonBranded: { clicks: 3, impressions: 4 },
      previous: { from: x, to: x, branded: { clicks: 1, impressions: 2 }, nonBranded: { clicks: 3, impressions: 4 } },
    },
    queries: [{ query: x, clicks: 5, impressions: 50, position: 3 }],
    traffic: { ["/" + x]: { clicks: 5, impressions: 50 } },
    keywordIdeas: {
      almostThere: [{ phrase: x, evidence: { impressions: 20, clicks: 0, position: 9, page: "/" + x } }],
      gaps: [],
      questions: [],
    },
    inspection: [
      { url: "https://x.com/" + x, verdict: "PASS", coverageState: x, lastCrawlTime: "2026-11-01T00:00:00Z" },
    ],
    pages: [{ url: "https://x.com/" + x, schema: [x], schemaOther: [] }],
  };
  for (const [name, panel] of Object.entries(PANELS)) {
    const { html, md } = draw(panel({ raw }));
    assert.ok(!html.includes("<script>"), `${name} page`);
    assert.ok(html.includes("&lt;script&gt;"), `${name} page shows the text escaped`);
    assert.ok(!/(^|[^\\])<script>/m.test(md.replace(/`[^`\n]*`/g, "")), `${name} Markdown, outside code spans`);
  }
});

// ---------- loadSources ----------
const audit = (more = {}) => ({
  site: { name: "Example", url: "https://www.example.com" },
  run: { date: "2026-11-20" },
  findings: [],
  passed: [],
  ...more,
});
function folder(files, ages = {}) {
  const dir = tmp();
  for (const [name, body] of Object.entries(files)) {
    const f = join(dir, name);
    writeFileSync(f, typeof body === "string" ? body : JSON.stringify(body));
    if (ages[name]) {
      const t = new Date(Date.parse("2026-11-20T12:00:00Z") - ages[name] * 864e5);
      utimesSync(f, t, t);
    }
  }
  return dir;
}
const google = (more = {}) => ({
  source: "google",
  site: "https://example.com",
  period: "Last 90 days, 2026-08-20 to 2026-11-17",
  traffic: { "/": { clicks: 9, impressions: 90 } },
  queries: [{ query: "boiler", clicks: 9, impressions: 90, position: 2 }],
  brandSplit: { branded: { clicks: 1, impressions: 2 }, nonBranded: { clicks: 3, impressions: 4 } },
  inspection: [{ url: "https://example.com/", verdict: "PASS" }],
  ...more,
});

test("loadSources fills what the audit lacks from a same-site file (www or not), dated, and leaves the input alone", () => {
  const raw = audit(),
    dir = folder(
      { "google.json": google(), "log-scan.json": { source: "server-logs", bots: {} } },
      { "google.json": 3 },
    );
  const { raw: out, notShown } = loadSources(raw, dir);
  assert.deepEqual(notShown, []);
  assert.equal(out.queries[0].query, "boiler");
  assert.deepEqual(out.inspection, google().inspection);
  assert.equal(out.trafficPeriod, google().period, "a renamed field");
  assert.equal(out.logScan.source, "server-logs", "a whole file");
  assert.equal(raw.queries, undefined, "the audit object itself isn't changed");
  assert.equal(fromFile(out, "queries").file, "google.json");
  assert.match(
    draw(topSearchesPanel({ raw: out })).md,
    /From Google Search Console \(google\.json, file saved 17 Nov 2026\)/,
    "google.json has no date of its own, so its line says the date is when it was saved",
  );
});

test("loadSources: the audit wins, a panel's fields come from one source, and nothing touches findings or the score", () => {
  const mine = { branded: { clicks: 50, impressions: 60 }, nonBranded: { clicks: 70, impressions: 80 } };
  const raw = audit({
    brandSplit: mine,
    trafficChange: { current: {} },
    findings: [{ id: "F-1", rule: "META-01", severity: "high", category: "Meta", status: "open", title: "t" }],
  });
  const dir = folder({
    "google.json": google({
      trafficChange: { current: { clicks: 1 } },
      byDevice: { MOBILE: { clicks: 1, impressions: 1 } },
      findings: [{ id: "G-1", rule: "CRAWL-02", severity: "blocker" }],
    }),
  });
  const { raw: out } = loadSources(raw, dir);
  assert.deepEqual(out.brandSplit, mine, "the audit's own brand split stays");
  assert.equal(fromFile(out, "brandSplit"), null);
  assert.deepEqual(out.trafficChange, { current: {} });
  assert.equal(out.byDevice, undefined, "the search lines come from the audit, so none of them from the file");
  assert.equal(out.findings.length, 1);
  assert.equal(out.findings[0].id, "F-1");
  assert.ok(out.queries, "a group the audit lacks is still filled");
  const score = r => render(r, { dir }).receipt[0];
  assert.equal(score(raw), render(raw, { dir: tmp() }).receipt[0], "the files never change the score");
});

test("loadSources skips another site's file and a stale one with a note, and is quiet for a missing file", () => {
  const dir = folder(
    {
      "google.json": google({ site: "https://other-site.org" }),
      "log-scan.json": { source: "server-logs", bots: {} },
      "keyword-ideas.json": { almostThere: [] },
    },
    { "log-scan.json": 45, "keyword-ideas.json": 20 },
  );
  const { raw: out, notShown } = loadSources(audit(), dir);
  assert.equal(out.queries, undefined);
  assert.equal(out.logScan, undefined);
  assert.ok(out.keywordIdeas, "20 days older is within the line");
  assert.equal(notShown.length, 2);
  const other = notShown.find(n => /google\.json/.test(n.what)),
    stale = notShown.find(n => /log-scan\.json/.test(n.what));
  assert.match(other.why, /other-site\.org/);
  assert.match(other.why, /www\.example\.com/);
  assert.match(stale.why, /more than 30 days/);
  assert.match(stale.why, /our own/);
  // Missing files: nothing to say (the tool wasn't run).
  assert.deepEqual(loadSources(audit(), tmp()).notShown, []);
  // A stale or other-site file whose data the audit already has stays quiet too: nothing was lost.
  assert.deepEqual(
    loadSources(audit({ logScan: {} }), folder({ "log-scan.json": { bots: {} } }, { "log-scan.json": 45 })).notShown,
    [],
  );
  assert.deepEqual(
    loadSources(audit(), folder({ "keys.json": { site: "https://other-site.org", moz: null } })).notShown,
    [],
    "a file with no data for the gaps",
  );
});

test("loadSources notes a file it can't read, and leaves raw tool output (a crawl) alone", () => {
  const dir = folder({ "google.json": "{ not json", "keys.json": "[1, 2]" });
  mkdirSync(join(dir, "geo-grid.json"));
  const { notShown } = loadSources(audit(), dir);
  assert.deepEqual(notShown.map(n => n.what).sort(), [
    "Google Search Console (google.json)",
    "The local rank grid (geo-grid.json)",
    "Your connected services (keys.json)",
  ]);
  for (const n of notShown) assert.match(n.why, /couldn't be read/);
  const crawl = { tool: "seo-supervisor-crawler", siteOrigin: "https://www.example.com", findings: [] };
  assert.equal(loadSources(crawl, folder({ "google.json": google() })).raw, crawl);
});

test("render() reads the folder's files: a brand split only google.json has reaches the Overview", () => {
  const dir = folder({ "google.json": google() }),
    scored = audit({ passed: [{ rule: "META-01", title: "Titles", category: "Meta" }] });
  const { md } = render(scored, { dir, mdFile: "seo-audit.md" });
  assert.match(String(md), /Brand searches, as Google labels them: 1 clicks/);
  assert.doesNotMatch(String(render(scored, { dir: tmp(), mdFile: "seo-audit.md" }).md), /Brand searches/);
});
