// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { checkLighthouse, findLighthouse, runLighthouse } from "../skills/seo-supervisor/scripts/checks/lighthouse.mjs";
import { ROOT, SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";
import { CHROME_FLAGS } from "../skills/seo-supervisor/scripts/lib/cdp.mjs";

// Four category scores, the five metrics, and audits that pass, fail, weigh nothing or aren't scored.
const ref = (id, weight) => ({ id, weight });
const LHR = {
  categories: {
    performance: {
      title: "Performance",
      score: 0.72,
      auditRefs: [
        ref("largest-contentful-paint", 25),
        ref("total-blocking-time", 30),
        ref("cumulative-layout-shift", 25),
        ref("first-contentful-paint", 10),
        ref("speed-index", 10),
        ref("render-blocking-resources", 0),
        ref("unused-javascript", 0),
        ref("diagnostics", 0),
      ],
    },
    seo: {
      title: "SEO",
      score: 0.92,
      auditRefs: [
        ref("meta-description", 1),
        ref("document-title", 1),
        ref("http-status-code", 1),
        ref("structured-data", 0),
        ref("link-text", 1),
      ],
    },
    accessibility: {
      title: "Accessibility",
      score: 0.88,
      auditRefs: [ref("color-contrast", 3), ref("image-alt", 10), ref("button-name", 10)],
    },
    "best-practices": {
      title: "Best Practices",
      score: 0.96,
      auditRefs: [ref("errors-in-console", 1), ref("is-on-https", 5)],
    },
  },
  audits: {
    "largest-contentful-paint": { title: "Largest Contentful Paint", score: 0.45, numericValue: 4100 },
    "total-blocking-time": { title: "Total Blocking Time", score: 0.6, numericValue: 520 },
    "cumulative-layout-shift": { title: "Cumulative Layout Shift", score: 1, numericValue: 0.02 },
    "first-contentful-paint": { title: "First Contentful Paint", score: 0.8, numericValue: 2100 },
    "speed-index": { title: "Speed Index", score: 0.7, numericValue: 4300 },
    "render-blocking-resources": {
      title: "Eliminate render-blocking resources",
      score: 0,
      details: {
        type: "opportunity",
        items: [
          { url: "https://cdn.example/app.js?v=<b>1</b>", wastedMs: 300 },
          { url: "https://cdn.example/app.js?v=<b>1</b>", wastedMs: 20 },
          { url: "http://127.0.0.1:1/style.css" },
        ],
      },
    },
    "unused-javascript": {
      title: "Reduce unused JavaScript",
      score: 0.3,
      details: {
        type: "opportunity",
        items: Array.from({ length: 12 }, (_, i) => ({ url: `http://127.0.0.1:1/chunk-${i}.js` })),
      },
    },
    "diagnostics": {
      title: "Diagnostics",
      score: 0,
      scoreDisplayMode: "informative",
      details: { type: "debugdata", items: [{ url: "http://127.0.0.1:1/never.js" }] },
    },
    "meta-description": { title: "Document does not have a meta description", score: 0 },
    "document-title": { title: "Document has a `<title>` element", score: 1 },
    "http-status-code": { title: "Page has successful HTTP status code", score: 1 },
    "structured-data": { title: "Structured data is valid", score: null, scoreDisplayMode: "manual" },
    "link-text": { title: "Links have descriptive text", score: 1 },
    "color-contrast": {
      title: "Background and foreground colors do not have a sufficient contrast ratio.",
      score: 0,
      details: {
        type: "table",
        items: [{ node: { type: "node", selector: "footer > p.small", snippet: '<p class="small">' } }],
      },
    },
    "image-alt": { title: "Image elements have `[alt]` attributes", score: 1 },
    "button-name": { title: "Buttons do not have an accessible name", score: 0 },
    "errors-in-console": { title: "Browser errors were logged to the console", score: 0 },
    "is-on-https": { title: "Uses HTTPS", score: 1 },
    "lcp-breakdown-insight": {
      title: "LCP breakdown",
      score: 0,
      details: {
        type: "list",
        items: [
          {
            type: "table",
            items: [
              { subpart: "timeToFirstByte", duration: 700 },
              { subpart: "resourceLoadDelay", duration: 2100 },
              { subpart: "resourceLoadDuration", duration: 900 },
              { subpart: "elementRenderDelay", duration: 400 },
            ],
          },
        ],
      },
    },
  },
};

// Stand-in lighthouse CLI: logs how it was called, fails for /broken/ URLs, otherwise writes the report above.
function fakeLighthouse(dir = tmp()) {
  const bin = join(dir, "fake-lighthouse.mjs"),
    log = join(dir, "calls.jsonl");
  writeFileSync(
    bin,
    `import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2), url = args.find(a => !a.startsWith("--"));
const dir = args.find(a => a.startsWith("--chrome-flags="))?.match(/--user-data-dir="([^"]+)"/)?.[1];
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, chrome: process.env.CHROME_PATH || null, profileExisted: !!dir }) + "\\n");
if (url.includes("/broken")) { console.error("Runtime error encountered: the page didn't load"); process.exit(1); }
writeFileSync(args.find(a => a.startsWith("--output-path=")).slice(14), JSON.stringify({ requestedUrl: url, ...${JSON.stringify(LHR)} }));
`,
  );
  return {
    bin,
    log,
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .trim()
            .split("\n")
            .map(l => JSON.parse(l))
        : [],
  };
}

test("a Lighthouse run gives category scores, the five metrics and the top failed audits by weight", async () => {
  const lh = fakeLighthouse();
  const r = await runLighthouse(lh.bin, "http://127.0.0.1:1/", { chromePath: "/opt/chrome" });
  assert.deepEqual(r.scores, { performance: 72, seo: 92, accessibility: 88, bestPractices: 96 });
  assert.deepEqual(r.metrics, { lcp: 4100, cls: 0.02, tbt: 520, fcp: 2100, speedIndex: 4300 });
  assert.deepEqual(r.lcpParts, { ttfb: 700, loadDelay: 2100, loadDuration: 900, renderDelay: 400 });
  // Ordered by the points each costs its category: weight × shortfall ÷ the category's total weight.
  assert.deepEqual(
    r.failed.map(f => f.id),
    ["button-name", "meta-description", "errors-in-console", "largest-contentful-paint", "color-contrast"],
  );
  assert.deepEqual(r.failed[0], {
    id: "button-name",
    title: "Buttons do not have an accessible name",
    category: "Accessibility",
  });
  assert.equal(r.url, "http://127.0.0.1:1/");

  const [call] = lh.calls();
  for (const flag of ["--output=json", "--quiet", "--only-categories=performance,seo,accessibility,best-practices"])
    assert.ok(call.args.includes(flag), flag);
  assert.equal(call.args[0], "http://127.0.0.1:1/");
  const flags = call.args.find(a => a.startsWith("--chrome-flags="));
  assert.match(
    flags.replace(` ${CHROME_FLAGS.map(f => (f.includes(" ") ? f.replace("=", '="') + '"' : f)).join(" ")}`, ""),
    /^--chrome-flags=--headless=new (--\S+ )*--user-data-dir="[^"]+"$/,
    "container and proxy flags, if any, in between (r11: and CHROME_FLAGS)",
  );
  assert.equal(call.chrome, "/opt/chrome", "the browser goes to Lighthouse as CHROME_PATH");
  assert.ok(!existsSync(flags.match(/--user-data-dir="([^"]+)"/)[1]), "the temporary profile is removed afterwards");
  assert.ok(!existsSync(call.args.find(a => a.startsWith("--output-path=")).slice(14)), "so is the report file");
});

test("Lighthouse detail lists each failed audit with its files, escaped", async () => {
  const lh = fakeLighthouse();
  const r = await runLighthouse(lh.bin, "http://127.0.0.1:1/");
  // Every audit under 0.9, weighted or not, the costliest first; passing, unscored and informative ones aren't listed.
  assert.deepEqual(
    r.detail.map(d => d.id),
    [
      "button-name",
      "meta-description",
      "errors-in-console",
      "largest-contentful-paint",
      "color-contrast",
      "total-blocking-time",
      "speed-index",
      "first-contentful-paint",
      "render-blocking-resources",
      "unused-javascript",
    ],
  );
  const by = id => r.detail.find(d => d.id === id);
  assert.deepEqual(
    by("render-blocking-resources"),
    {
      id: "render-blocking-resources",
      title: "Eliminate render-blocking resources",
      category: "Performance",
      items: ["https://cdn.example/app.js?v=<b>1</b>", "http://127.0.0.1:1/style.css"],
    },
    "each file once",
  );
  assert.deepEqual(by("color-contrast").items, ["footer > p.small"], "an element when the audit names no file");
  assert.equal(by("unused-javascript").items.length, 10, "10 files an audit at most");
  assert.deepEqual(by("button-name").items, []);
  assert.equal(r.failed.length, 5, "the top five stay as they were");

  // The report: a collapsed panel with a list per page, escaped.
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  writeFileSync(join(dir, "plain.json"), JSON.stringify(data));
  data.lighthouse = [
    { ...r, url: "https://example.com/" },
    {
      url: "https://example.com/blog/<x>/",
      scores: {},
      metrics: {},
      failed: [],
      detail: [
        {
          id: "x",
          title: "Avoid `<marquee>` **now**",
          category: "Best Practices",
          items: ["https://cdn.example/a.js?q=`x`|y"],
        },
      ],
    },
  ];
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  for (const f of ["plain", "a"])
    await node([join(SCRIPTS, "render-report.mjs"), join(dir, `${f}.json`), "--out", join(dir, `${f}.html`)]);
  const html = readFileSync(join(dir, "a.html"), "utf8"),
    md = readFileSync(join(dir, "a.md"), "utf8");
  const has = (re, s) => assert.ok(re.test(s), String(re)); // the report is too long to print on a miss
  has(/<details class="how lhdetail"><summary>Lighthouse details<\/summary>/, html);
  has(/<details><summary><code>\/blog\/%3Cx%3E\/<\/code>/, html);
  has(/<code>https:\/\/cdn\.example\/app\.js\?v=&lt;b&gt;1&lt;\/b&gt;<\/code>/, html);
  has(/Avoid <code>&lt;marquee&gt;<\/code>/, html);
  assert.ok(!/v=<b>|<marquee>|\/<x>\//.test(html), "escaped");
  has(/^## Lighthouse details$/m, md);
  has(/^- Reduce unused JavaScript \(Performance\): `http:\/\/127\.0\.0\.1:1\/chunk-0\.js`/m, md);
  has(
    /^- Avoid \\`\\<marquee\\>\\` \\\*\\\*now\\\*\\\* \(Best Practices\): `https:\/\/cdn\.example\/a\.js\?q= x \|y`$/m,
    md,
  );
  const scoreOf = s => s.match(/<p class="big[^"]*"><span class="n">(\d+)/)[1];
  assert.equal(
    scoreOf(html),
    scoreOf(readFileSync(join(dir, "plain.html"), "utf8")),
    "information only: the score doesn't move",
  );
});

test("Lighthouse's Chrome gets the container and proxy flags through --chrome-flags", async () => {
  const lh = fakeLighthouse(),
    P = "http://proxy.corp:8080";
  await runLighthouse(lh.bin, "http://127.0.0.1:1/", {
    host: { platform: "linux", uid: 0, env: { HTTP_PROXY: P, HTTPS_PROXY: P }, exists: () => false },
  });
  const flags = lh.calls()[0].args.find(a => a.startsWith("--chrome-flags="));
  // Chrome's own background traffic is off too (CHROME_FLAGS, right after --headless=new).
  assert.match(
    flags.replace(` ${CHROME_FLAGS.map(f => (f.includes(" ") ? f.replace("=", '="') + '"' : f)).join(" ")}`, ""),
    /^--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage --proxy-server=http:\/\/proxy\.corp:8080 --proxy-bypass-list=update\.googleapis\.com --user-data-dir="[^"]+"$/,
  );
});

test("a failed run rejects with the CLI's message", async () => {
  const lh = fakeLighthouse();
  await assert.rejects(runLighthouse(lh.bin, "http://127.0.0.1:1/broken/"), /didn't load/);
});

test("an npm .cmd shim is followed to the script it starts (Windows can't run one without a shell)", async () => {
  const dir = tmp();
  for (const d of ["pkg", ".bin"]) mkdirSync(join(dir, d));
  const lh = fakeLighthouse(join(dir, "pkg"));
  const shim = join(dir, ".bin", "lighthouse.cmd");
  writeFileSync(
    shim,
    '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\..\\pkg\\fake-lighthouse.mjs" %*\r\n',
  );
  const r = await runLighthouse(shim, "http://127.0.0.1:1/");
  assert.equal(r.scores.performance, 72);
  assert.equal(lh.calls().length, 1);
});

test("findLighthouse: LIGHTHOUSE_PATH, then ~/.seo-supervisor/tools, then PATH, else null", () => {
  const home = tmp(),
    onPath = tmp(),
    own = join(tmp(), "lh.mjs");
  const exe = process.platform === "win32" ? "lighthouse.cmd" : "lighthouse";
  writeFileSync(own, "");
  assert.equal(findLighthouse({ PATH: onPath }, home), null, "nothing installed");
  writeFileSync(join(onPath, exe), "");
  assert.equal(findLighthouse({ PATH: onPath }, home), join(onPath, exe), "on PATH");
  const bin = join(home, ".seo-supervisor", "tools", "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, exe), "");
  assert.equal(findLighthouse({ PATH: onPath }, home), join(bin, exe), "the installer's copy beats PATH");
  assert.equal(findLighthouse({ PATH: onPath, LIGHTHOUSE_PATH: own }, home), own, "LIGHTHOUSE_PATH beats both");
});

test("checkLighthouse runs up to five pages, home first, and notes the ones that fail", async () => {
  const lh = fakeLighthouse(),
    o = "http://127.0.0.1:1";
  const urls = [`${o}/a/`, `${o}/broken/`, `${o}/c/`, `${o}/d/`, `${o}/e/`, `${o}/f/`, `${o}/`];
  const r = await checkLighthouse(lh.bin, urls, { chromePath: "/opt/chrome" });
  assert.deepEqual(
    lh.calls().map(c => new URL(c.args[0]).pathname),
    ["/", "/a/", "/broken/", "/c/", "/d/"],
  );
  assert.deepEqual(
    r.results.map(x => new URL(x.url).pathname),
    ["/", "/a/", "/c/", "/d/"],
  );
  assert.ok(
    r.notes.some(n => /Lighthouse ran on 4 of 5 sample page/.test(n) && /\/broken\//.test(n)),
    r.notes.join("\n"),
  );
});

test("checkLighthouse with all runs every page up to the cap, estimates the time first and notes the cut", async () => {
  const lh = fakeLighthouse(),
    o = "http://127.0.0.1:1",
    logged = [];
  const urls = [`${o}/a/`, `${o}/b/`, `${o}/`, `${o}/c/`, `${o}/d/`];
  const r = await checkLighthouse(lh.bin, urls, { all: true, max: 4, log: m => logged.push([m, lh.calls().length]) });
  assert.deepEqual(
    lh.calls().map(c => new URL(c.args[0]).pathname),
    ["/", "/a/", "/b/", "/c/"],
    "home first, then in crawl order",
  );
  assert.equal(logged.length, 1);
  assert.match(logged[0][0], /^Lighthouse: 4 pages, about 1 minute \(roughly 20 seconds a page\)/);
  assert.equal(logged[0][1], 0, "printed before the first run");
  assert.ok(
    r.notes.some(n => /Lighthouse ran on 4 of 4 page/.test(n) && !/sample/.test(n)),
    r.notes.join("\n"),
  );
  assert.ok(
    r.notes.some(n => /stopped at 4 pages/.test(n) && /1 more page/.test(n)),
    r.notes.join("\n"),
  );
});

test("checkLighthouse with all stops at 200 pages unless told otherwise, and lists only the first few failures", async () => {
  const lh = fakeLighthouse(),
    o = "http://127.0.0.1:1",
    logged = [];
  const urls = [`${o}/`, ...Array.from({ length: 7 }, (_, i) => `${o}/broken/${i}/`)];
  const r = await checkLighthouse(lh.bin, urls, { all: true, log: m => logged.push(m) });
  assert.equal(lh.calls().length, 8);
  assert.match(logged[0], /8 pages, about 3 minutes/);
  assert.ok(!r.notes.some(n => /stopped at/.test(n)), "no cut under the cap");
  assert.ok(
    r.notes.some(n => /\/broken\/4\/.*and 2 more/.test(n) && !/\/broken\/5\//.test(n)),
    r.notes.join("\n"),
  );
});

// The crawler, with the fake for Lighthouse and node standing in for the browser (so no real Chrome starts), and a
// closed local port standing in for PageSpeed (fixture-site's public origin would otherwise send it to Google).
async function crawl(extra, env, fixture = "fixture-zero") {
  const site = await serve(join(ROOT, "test", fixture));
  const out = join(tmp(), "crawl.json");
  let stdout;
  try {
    ({ stdout } = await node(
      [
        join(SCRIPTS, "seo-crawl.mjs"),
        "--url",
        site.url,
        "--out",
        out,
        "--psi-endpoint",
        "http://127.0.0.1:9/runPagespeed",
        ...extra,
      ],
      { env: { ...process.env, CHROME_PATH: process.execPath, PSI_API_KEY: "", CRUX_API_KEY: "", ...env } },
    ));
  } finally {
    await site.close();
  }
  return Object.assign(JSON.parse(readFileSync(out, "utf8")), { stdout });
}

test("the crawler with --lighthouse all runs every indexable page, not just the sample, and prints the estimate", async () => {
  const lh = fakeLighthouse();
  const r = await crawl(["--outside", "--lighthouse", "all"], { LIGHTHOUSE_PATH: lh.bin }, "fixture-site");
  const ran = lh.calls().map(c => new URL(c.args[0]).pathname);
  // The render sample takes one page per top-level folder; all mode takes both tools pages.
  for (const p of ["/", "/tools/dmarc-checker/", "/tools/ssl-checker/"]) assert.ok(ran.includes(p), `${p} in ${ran}`);
  assert.ok(!ran.includes("/noindexed/"), "noindex pages aren't meant to rank, so they're left out");
  assert.equal(r.lighthouse.length, ran.length);
  assert.match(
    r.stdout,
    new RegExp(`Lighthouse: ${ran.length} pages, about \\d+ minutes? \\(roughly 20 seconds a page\\)`),
  );
  // --lighthouse=all works too (the argument parser reads it as a key of its own).
  const lh2 = fakeLighthouse(),
    r2 = await crawl(["--outside", "--lighthouse=all"], { LIGHTHOUSE_PATH: lh2.bin });
  assert.ok(
    lh2.calls().length && r2.notes.some(n => /^Lighthouse ran on \d+ of \d+ page/.test(n)),
    r2.notes.join("\n"),
  );
});

test("the crawler with --outside --lighthouse runs it on the render sample and records the results", async () => {
  const lh = fakeLighthouse();
  const r = await crawl(["--outside", "--lighthouse"], { LIGHTHOUSE_PATH: lh.bin });
  const calls = lh.calls();
  assert.ok(calls.length >= 1 && calls.length <= 5, `${calls.length} runs`);
  assert.equal(new URL(calls[0].args[0]).pathname, "/", "home page first");
  assert.ok(
    calls.every(c => c.chrome === process.execPath),
    "the browser findBrowser() picked goes in as CHROME_PATH",
  );
  assert.equal(r.lighthouse.length, calls.length);
  assert.deepEqual(r.lighthouse[0].scores, { performance: 72, seo: 92, accessibility: 88, bestPractices: 96 });
  assert.equal(r.lighthouse[0].metrics.lcp, 4100);
  assert.equal(r.lighthouse[0].failed.length, 5);
  assert.ok(!r.findings.some(f => /lighthouse/.test(f.check)), "scores are information, not findings");
});

test("without --outside, --lighthouse doesn't run it and says why", async () => {
  const lh = fakeLighthouse();
  const r = await crawl(["--lighthouse"], { LIGHTHOUSE_PATH: lh.bin });
  assert.equal(lh.calls().length, 0, "the fake wasn't invoked");
  assert.ok(!r.lighthouse);
  assert.ok(
    r.notes.some(n => /Lighthouse/.test(n) && /--outside/.test(n)),
    r.notes.join("\n"),
  );
});

test("when Lighthouse isn't installed, a note says how to add it", async () => {
  const home = tmp();
  const r = await crawl(["--outside", "--lighthouse"], {
    LIGHTHOUSE_PATH: "",
    HOME: home,
    USERPROFILE: home,
    PATH: tmp(),
  });
  assert.ok(!r.lighthouse);
  assert.ok(
    r.notes.some(n => /npx seo-supervisor --with-lighthouse/.test(n) && /npm i -g lighthouse/.test(n)),
    r.notes.join("\n"),
  );
});

test("the overview shows one Lighthouse line for the home page", async () => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  const run = (url, p) => ({
    url,
    scores: { performance: p, seo: 92, accessibility: 88, bestPractices: 96 },
    metrics: {},
    failed: [],
  });
  data.lighthouse = [run("https://example.com/about/", 50), run("https://example.com/", 72)];
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  const line = /Lighthouse \(mobile, home page\): Performance 72 · SEO 92 · Accessibility 88 · Best practices 96/;
  assert.ok(line.test(readFileSync(join(dir, "r.html"), "utf8")), "HTML overview");
  assert.ok(line.test(readFileSync(join(dir, "r.md"), "utf8")), "Markdown overview");
  assert.doesNotMatch(
    readFileSync(join(dir, "r.md"), "utf8"),
    /Lowest performance/,
    "two pages: no list of the slowest",
  );
});

test("with more than five Lighthouse pages, the line adds the three with the lowest performance score", async () => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  const run = (path, p) => ({
    url: `https://example.com${path}`,
    scores: { performance: p, seo: 92, accessibility: 88, bestPractices: 96 },
    metrics: {},
    failed: [],
  });
  data.lighthouse = [
    run("/", 72),
    run("/a/", 90),
    run("/blog/", 31),
    run("/b/", 64),
    run("/shop/", 38),
    run("/c/", null),
    run("/about/", 45),
  ];
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  const line =
    /Lighthouse \(mobile, home page\): Performance 72 · SEO 92 · Accessibility 88 · Best practices 96\. Lowest performance of 6 pages: \/blog\/ 31 · \/shop\/ 38 · \/about\/ 45/; // a run with no score isn't counted
  assert.ok(line.test(readFileSync(join(dir, "r.html"), "utf8")), "HTML overview");
  assert.ok(line.test(readFileSync(join(dir, "r.md"), "utf8")), "Markdown overview");
});
