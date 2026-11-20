import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { findBrowser } from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { labLcpBreakdown, labLcpParts } from "../skills/seo-supervisor/scripts/checks/speed.mjs";
import { ROOT, SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const fixture = name => readFileSync(join(ROOT, "test", "fixtures", name), "utf8");

// A stand-in for the PageSpeed Insights API: /pricing/ is slow, everything else passes.
// With quotaGone it answers like Google does when the keyless daily quota is used up.
async function fakePsi({ quotaGone = false } = {}) {
  const hits = [];
  const server = createServer((req, res) => {
    const target = new URL(req.url, "http://x").searchParams.get("url") || "";
    hits.push(target);
    if (quotaGone) {
      res
        .writeHead(429, { "Content-Type": "application/json" })
        .end('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}');
      return;
    }
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(fixture(target.includes("/pricing/") ? "psi-fail.json" : "psi-pass.json"));
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${server.address().port}/runPagespeed`,
    hits,
    close: () => new Promise(ok => server.close(ok)),
  };
}
async function crawl(extra) {
  const site = await serve(join(ROOT, "test", "fixture-zero"));
  const out = join(tmp(), "crawl.json");
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://zero.example",
      "--out",
      out,
      ...extra,
    ]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}

test("with outside checks on, failing real-user Core Web Vitals become a finding", async () => {
  const psi = await fakePsi();
  try {
    const r = await crawl(["--outside", "--psi-endpoint", psi.url]);
    assert.ok(psi.hits.length >= 1 && psi.hits.length <= 10, `sampled ${psi.hits.length} URLs`);
    assert.ok(
      psi.hits.every(u => u.startsWith("https://zero.example/")),
      "the public URLs are checked, not the local ones",
    );
    const f = r.findings.find(x => x.check === "cwv-fail");
    assert.ok(f, "cwv-fail");
    assert.equal(f.rule, "PERF-01");
    assert.deepEqual(
      f.evidence.map(e => new URL(e.url).pathname),
      ["/pricing/"],
    );
    assert.match(f.evidence[0].detail, /LCP 4\.1 s/);
    assert.ok(r.speed.samples.length === psi.hits.length);
    assert.ok(!r.notChecked.some(n => n.rule === "PERF-01"));
    if (findBrowser())
      assert.ok(
        r.notes.some(n => /^Rendered \d+ of \d+ sample page/.test(n)),
        "outside checks also render sample pages when Chrome is installed",
      );
    else assert.match(r.notChecked.find(n => n.rule === "REND-06")?.reason || "", /isn't installed/);
  } finally {
    await psi.close();
  }
});

test("without outside checks, nothing is sent to PageSpeed and PERF-01 is listed as not checked", async () => {
  const psi = await fakePsi();
  try {
    const r = await crawl(["--psi-endpoint", psi.url]);
    assert.equal(psi.hits.length, 0, "zero requests");
    assert.match(r.notChecked.find(n => n.rule === "PERF-01")?.reason || "", /outside checks/i);
    assert.equal(r.speed, undefined);
  } finally {
    await psi.close();
  }
});

test("the overview shows one line of real-user speed", async () => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  data.speed = {
    strategy: "mobile",
    samples: [
      {
        url: "https://example.com/",
        field: { lcp: 2100, inp: 180, cls: 0.05 },
        origin: { lcp: 2100, inp: 180, cls: 0.05 },
        lab: { lcp: 2350, cls: 0.03, tbt: 120 },
      },
    ],
  };
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  assert.match(
    readFileSync(join(dir, "r.html"), "utf8"),
    /Real-user speed \(mobile\): LCP 2\.1 s \(good\) · INP 180 ms \(good\) · CLS 0\.05 \(good\), passes Core Web Vitals/,
  );
  data.speed.samples[0].origin = { lcp: 4200, inp: 180, cls: 0.3 };
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  const line =
    /Real-user speed \(mobile\): LCP 4\.2 s \(poor\) · INP 180 ms \(good\) · CLS 0\.3 \(poor\), fails Core Web Vitals/;
  for (const f of ["r.html", "r.md"]) assert.match(readFileSync(join(dir, f), "utf8"), line, f);
});

test("when PageSpeed refuses (no key, quota used up), it stops asking and PERF-01 is not counted as passed", async () => {
  const psi = await fakePsi({ quotaGone: true });
  try {
    const r = await crawl(["--outside", "--psi-endpoint", psi.url]);
    assert.equal(psi.hits.length, 2, "the first URL and one retry, then no more requests");
    assert.ok(!r.passed.some(p => p.rule === "PERF-01"), "nothing was measured, so nothing passed");
    assert.match(r.notChecked.find(n => n.rule === "PERF-01")?.reason || "", /PSI_API_KEY/);
    assert.equal(r.notes.filter(n => n.startsWith("PageSpeed")).length, 1, "one note, not one per URL");
    assert.equal(r.speed, undefined);
  } finally {
    await psi.close();
  }
});

// A stand-in for the CrUX History API: 25 weekly p75 values per metric, LCP improving from 3.1 s to 2.4 s,
// the four parts of an image LCP, and a week with too few visits (null), as the real API marks it.
async function fakeCrux() {
  const hits = [];
  const server = createServer((req, res) => {
    let body = "";
    req
      .on("data", c => (body += c))
      .on("end", () => {
        hits.push({ url: req.url, body: JSON.parse(body || "{}") });
        const series = (a, b) => Array.from({ length: 25 }, (_, i) => a + ((b - a) * i) / 24);
        const date = d => ({ year: 2026, month: 5 + Math.floor(d / 28), day: 1 + (d % 28) });
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            record: {
              key: { origin: "https://zero.example", formFactor: "PHONE" },
              metrics: {
                largest_contentful_paint: { percentilesTimeseries: { p75s: series(3100, 2400) } },
                interaction_to_next_paint: { percentilesTimeseries: { p75s: series(240, 190) } },
                cumulative_layout_shift: {
                  percentilesTimeseries: { p75s: series(0.12, 0.05).map((x, i) => (i ? x.toFixed(2) : null)) },
                },
                largest_contentful_paint_image_time_to_first_byte: {
                  percentilesTimeseries: { p75s: series(900, 400) },
                },
                largest_contentful_paint_image_resource_load_delay: {
                  percentilesTimeseries: { p75s: series(600, 1200) },
                },
                largest_contentful_paint_image_resource_load_duration: {
                  percentilesTimeseries: { p75s: series(500, 300) },
                },
                largest_contentful_paint_image_element_render_delay: {
                  percentilesTimeseries: { p75s: series(100, 150) },
                },
              },
              collectionPeriods: Array.from({ length: 25 }, (_, i) => ({
                firstDate: date(i * 7),
                lastDate: date(i * 7 + 27),
              })),
            },
          }),
        );
      });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1/records:queryHistoryRecord`,
    hits,
    close: () => new Promise(ok => server.close(ok)),
  };
}

test("with a CrUX key, the 25-week speed trend is fetched for the public origin; without one, nothing is sent", async () => {
  const psi = await fakePsi(),
    crux = await fakeCrux();
  try {
    const crawlWith = async env => {
      const site = await serve(join(ROOT, "test", "fixture-zero"));
      const out = join(tmp(), "crawl.json");
      try {
        await node(
          [
            join(SCRIPTS, "seo-crawl.mjs"),
            "--url",
            site.url,
            "--site-origin",
            "https://zero.example",
            "--outside",
            "--psi-endpoint",
            psi.url,
            "--crux-endpoint",
            crux.url,
            "--out",
            out,
          ],
          { env: { ...process.env, CRUX_API_KEY: "", PSI_API_KEY: "", ...env } },
        );
      } finally {
        await site.close();
      }
      return JSON.parse(readFileSync(out, "utf8"));
    };
    const none = await crawlWith({});
    assert.equal(crux.hits.length, 0, "no key, no request");
    assert.equal(none.speed.trend, undefined);
    assert.deepEqual(
      none.speed.lcpBreakdown,
      { source: "lab", url: "https://zero.example/", ttfb: 600, loadDelay: 200, loadDuration: 300, renderDelay: 1250 },
      "without real-user parts, PageSpeed's lab run of the home page",
    );
    const r = await crawlWith({ CRUX_API_KEY: "test-key" });
    assert.equal(crux.hits.length, 1, "the LCP parts come in the same request as the trend");
    assert.match(crux.hits[0].url, /key=test-key/);
    assert.equal(crux.hits[0].body.origin, "https://zero.example");
    assert.ok(crux.hits[0].body.metrics.includes("largest_contentful_paint_image_resource_load_delay"));
    assert.deepEqual(
      { weeks: r.speed.trend.weeks, lcp: r.speed.trend.lcp, cls: r.speed.trend.cls },
      { weeks: 25, lcp: [3100, 2400], cls: [0.12, 0.05] },
      "a week with no value is skipped, not read as 0",
    );
    assert.deepEqual(
      r.speed.lcpBreakdown,
      {
        source: "real visitors",
        url: "https://zero.example",
        ttfb: 400,
        loadDelay: 1200,
        loadDuration: 300,
        renderDelay: 150,
      },
      "the latest week, from real visitors",
    );
  } finally {
    await psi.close();
    await crux.close();
  }
});

test("Lighthouse's LCP breakdown is read in ms; a text LCP has no image to wait for or download", () => {
  const audits = rows => ({
    "lcp-breakdown-insight": { details: { type: "list", items: [{ type: "table", items: rows }, { type: "node" }] } },
  });
  assert.deepEqual(
    labLcpParts(
      audits([
        { subpart: "timeToFirstByte", duration: 812.6 },
        { subpart: "elementRenderDelay", duration: 400 },
      ]),
    ),
    { ttfb: 813, loadDelay: 0, loadDuration: 0, renderDelay: 400 },
  );
  assert.equal(labLcpParts({}), null, "no breakdown audit, no breakdown");
  assert.equal(labLcpParts(audits([])), null);
});

test("the lab breakdown comes from the home page's run, else the first page that has one", () => {
  const parts = ttfb => ({ ttfb, loadDelay: 0, loadDuration: 0, renderDelay: 100 });
  const runs = [
    { url: "https://e.com/a/", lcpParts: parts(1) },
    { url: "https://e.com/b/" },
    { url: "http://127.0.0.1:9/", lcpParts: parts(3) },
  ];
  assert.deepEqual(labLcpBreakdown(runs), { source: "lab", url: "http://127.0.0.1:9/", ...parts(3) });
  assert.deepEqual(labLcpBreakdown(runs.slice(0, 2)), { source: "lab", url: "https://e.com/a/", ...parts(1) });
  assert.equal(labLcpBreakdown([{ url: "https://e.com/" }]), null);
});

const overview = async lcpBreakdown => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  data.speed = {
    strategy: "mobile",
    samples: [{ url: "https://example.com/", field: { lcp: 2600, inp: 180, cls: 0.05 }, origin: null, lab: {} }],
    lcpBreakdown,
  };
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};

test("the overview names the biggest part of LCP, with what to do about it", async () => {
  const { html, md } = await overview({
    source: "real visitors",
    url: "https://example.com",
    ttfb: 400,
    loadDelay: 1200,
    loadDuration: 300,
    renderDelay: 150,
  });
  for (const text of [html, md])
    assert.match(
      text,
      /LCP breakdown \(real visitors\): most of the time goes on the wait before the main image starts loading \(1\.2 s\)\. Preload the hero image, give it fetchpriority=(&quot;|")high(&quot;|") and don(&#39;|')t lazy-load it\./,
    );
  const lab = await overview({
    source: "lab",
    url: "https://example.com/pricing/",
    ttfb: 1500,
    loadDelay: 0,
    loadDuration: 0,
    renderDelay: 300,
  });
  assert.match(
    lab.md,
    /LCP breakdown \(lab test, \/pricing\/\): most of the time goes on the server's response \(1\.5 s\)\. Cache pages, serve them from a CDN or use a faster server\./,
  );
  assert.match(
    (
      await overview({
        source: "lab",
        url: "https://example.com/",
        ttfb: 100,
        loadDelay: 0,
        loadDuration: 2000,
        renderDelay: 300,
      })
    ).md,
    /lab test, home page\): most of the time goes on downloading the main image \(2\.0 s\)\. Make it smaller and serve it in a modern format \(WebP or AVIF\)\./,
  );
  assert.match(
    (
      await overview({
        source: "lab",
        url: "https://example.com/",
        ttfb: 100,
        loadDelay: 0,
        loadDuration: 0,
        renderDelay: 900,
      })
    ).md,
    /drawing it on screen \(0\.9 s\)\. Cut render-blocking CSS and JavaScript, and build the page on the server rather than in the browser\./,
  );
  assert.doesNotMatch((await overview(undefined)).html, /LCP breakdown/);
});

test("the overview adds the trend to the speed line", async () => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  data.speed = {
    strategy: "mobile",
    samples: [
      {
        url: "https://example.com/",
        field: { lcp: 2400, inp: 190, cls: 0.05 },
        origin: { lcp: 2400, inp: 190, cls: 0.05 },
        lab: {},
      },
    ],
    trend: { weeks: 25, lcp: [3100, 2400], inp: [240, 190], cls: [0.12, 0.05] },
  };
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  assert.match(readFileSync(join(dir, "r.html"), "utf8"), /over 25 weeks: LCP 3\.1 → 2\.4 s \(better\)/);
});
