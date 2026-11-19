// The render diff without Chrome; the Chrome tests are in test/browser/render-diff.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareRendered, findBrowser, renderPage } from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { serve } from "./serve.mjs";
import { ROOT, SCRIPTS, node, tmp } from "./helpers.mjs";

const page = ({
  title = "Widgets | Brand",
  canonical = "https://example.com/widgets/",
  robots = "index, follow",
  h1 = "<h1>Widgets</h1>",
  jsonld = 1,
  links = 4,
} = {}) =>
  `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${canonical}"><meta name="robots" content="${robots}">${'<script type="application/ld+json">{"@type":"Thing"}</script>'.repeat(jsonld)}</head><body>${h1}${'<a href="/x/">x</a>'.repeat(links)}</body></html>`;
const fields = (a, b) =>
  compareRendered(a, b)
    .map(d => d.field)
    .sort();

test("identical raw and rendered HTML differ in nothing", () => {
  assert.deepEqual(compareRendered(page(), page()), []);
});

test("JavaScript changing the title, canonical or robots tag is reported with both values", () => {
  const d = compareRendered(page(), page({ title: "Loading…", canonical: "https://example.com/", robots: "noindex" }));
  assert.deepEqual(d.map(x => x.field).sort(), ["canonical", "robots", "title"]);
  assert.deepEqual(
    d.find(x => x.field === "title"),
    { field: "title", raw: "Widgets | Brand", rendered: "Loading…" },
  );
});

test("an H1, JSON-LD or many links that appear only after rendering are reported", () => {
  assert.deepEqual(fields(page({ h1: "" }), page()), ["h1"]);
  assert.deepEqual(fields(page({ jsonld: 0 }), page({ jsonld: 2 })), ["jsonld-count"]);
  assert.deepEqual(fields(page({ links: 4 }), page({ links: 6 })), [], "1.5× more links is still fine");
  assert.deepEqual(fields(page({ links: 4 }), page({ links: 20 })), ["link-count"], "1.5× more and at least 10 more");
});

test("Chrome or Edge is found in the standard places, CHROME_PATH first", () => {
  const has = paths => p => paths.includes(p);
  assert.equal(
    findBrowser({ CHROME_PATH: "/opt/chrome" }, "linux", has(["/opt/chrome", "/usr/bin/google-chrome"])),
    "/opt/chrome",
  );
  assert.equal(findBrowser({}, "linux", has(["/usr/bin/chromium"])), "/usr/bin/chromium");
  assert.equal(
    findBrowser({}, "darwin", has(["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"])),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  );
  assert.equal(
    findBrowser(
      { "PROGRAMFILES(X86)": "C:\\Program Files (x86)" },
      "win32",
      has(["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]),
    ),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  );
  assert.equal(
    findBrowser({}, "linux", () => false),
    null,
  );
});

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
      // CHROME_PATH points at something that isn't a browser, so every render fails.
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

test("when every render fails, REND-06 is listed as not checked instead of passing", async () => {
  const site = await serve(join(ROOT, "test", "fixture-zero"));
  const out = join(tmp(), "crawl.json");
  try {
    // CHROME_PATH points at something that isn't a browser, so every render fails.
    await node(
      [
        join(SCRIPTS, "seo-crawl.mjs"),
        "--url",
        site.url,
        "--site-origin",
        "https://zero.example",
        "--outside",
        "--psi-endpoint",
        "http://127.0.0.1:9/runPagespeed",
        "--out",
        out,
      ],
      { env: { ...process.env, CHROME_PATH: process.execPath } },
    );
  } finally {
    await site.close();
  }
  const r = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(!r.passed.some(p => p.rule === "REND-06"));
  assert.match(r.notChecked.find(n => n.rule === "REND-06")?.reason || "", /couldn't render/);
  for (const rule of ["REND-07", "PERF-07"])
    assert.match(r.notChecked.find(n => n.rule === rule)?.reason || "", /couldn't load/);
});
