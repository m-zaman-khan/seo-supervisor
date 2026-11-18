import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { findBrowser } from "../skills/seo-supervisor/scripts/checks/render.mjs";
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
    /Real-user speed \(mobile\): LCP 2\.1 s · INP 180 ms · CLS 0\.05 \(passes\)/,
  );
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
