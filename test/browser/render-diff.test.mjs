import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareRendered, findBrowser, renderPage } from "../../skills/seo-supervisor/scripts/checks/render.mjs";
import { serve } from "../serve.mjs";
import { ROOT, SCRIPTS, node, tmp } from "../helpers.mjs";

const browser = findBrowser();
test(
  "a real headless render shows what the page's JavaScript changed",
  { skip: !browser && "Chrome not installed" },
  async t => {
    const dir = tmp();
    mkdirSync(join(dir, "app"));
    writeFileSync(
      join(dir, "app", "index.html"),
      `<!doctype html><html><head><title>Raw title</title></head><body><a href="/">home</a><script>document.title = "Set by script"; document.body.insertAdjacentHTML("beforeend", "<h1>Added by script</h1>");</script></body></html>`,
    );
    const site = await serve(dir);
    try {
      let html;
      try {
        html = await renderPage(browser, site.url + "/app/");
      } catch (e) {
        if (/sandbox/i.test(`${e.message} ${e.stderr || ""}`)) return t.skip("Chrome sandbox unavailable here");
        throw e;
      }
      const d = compareRendered(
        `<!doctype html><html><head><title>Raw title</title></head><body><a href="/">home</a></body></html>`,
        html,
      );
      assert.deepEqual(d.map(x => x.field).sort(), ["h1", "title"]);
    } finally {
      await site.close();
    }
  },
);

test(
  "pages that redirect with a meta refresh aren't rendered (the browser would show the target page); the same sample gets the phone checks",
  { skip: !browser && "Chrome not installed", timeout: 240000 },
  async () => {
    const site = await serve(join(ROOT, "test", "fixture-site"));
    const dir = tmp(),
      out = join(dir, "crawl.json");
    try {
      // A closed local port stands in for PageSpeed, so nothing leaves the machine.
      await node([
        join(SCRIPTS, "seo-crawl.mjs"),
        "--url",
        site.url,
        "--site-origin",
        "https://example-security.com",
        "--outside",
        "--psi-endpoint",
        "http://127.0.0.1:9/runPagespeed",
        "--out",
        out,
      ]);
    } finally {
      await site.close();
    }
    const r = JSON.parse(readFileSync(out, "utf8"));
    const rendered = r.findings
      .filter(f => f.check.startsWith("render-"))
      .flatMap(f => f.evidence.map(e => new URL(e.url).pathname));
    assert.ok(!rendered.includes("/legacy/"), "/legacy/ refreshes to /about/");
    for (const rule of ["REND-07", "PERF-07"])
      assert.ok(
        !r.notChecked.some(n => n.rule === rule),
        `${rule} is checked: ${r.notChecked.find(n => n.rule === rule)?.reason}`,
      );
    assert.ok(r.passed.some(p => p.rule === "REND-07") || r.findings.some(f => f.rule === "REND-07"));
    assert.ok(
      r.labSpeed.length && r.labSpeed.every(l => l.url && "lcp" in l && "cls" in l && "tbt" in l),
      "lab speed is in the crawl output",
    );
    const shots = readdirSync(join(dir, "screenshots"));
    assert.ok(shots.includes("home-desktop.png") && shots.includes("home-mobile.png"), "screenshots sit next to --out");
    assert.ok(!shots.some(s => s.startsWith("legacy-")));
  },
);
