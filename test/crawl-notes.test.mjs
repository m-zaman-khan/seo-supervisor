import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";

async function crawl(files, args = []) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  const site = await serve(dir);
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://site.example",
      "--out",
      out,
      ...args,
    ]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const text = n => Array.from({ length: n }, (_, i) => `Boiler servicing note ${i} for homes across Leeds.`).join(" ");
const page = (title, links = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${title} in Leeds."></head><body><h1>${title}</h1><p>${text(20)}</p>${links}</body></html>`;
const ROBOTS = "User-agent: *\nAllow: /\nSitemap: https://site.example/sitemap.xml\n";
const urlset = paths =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(p => `<url><loc>https://site.example${p}</loc><priority>0.8</priority></url>`).join("")}</urlset>`;

test("<priority> and <changefreq> in several sitemap files make one note, not one per file", async () => {
  const r = await crawl({
    "robots.txt": ROBOTS,
    "index.html": page("Boiler repairs", '<a href="/a/">A</a><a href="/b/">B</a><a href="/c/">C</a>'),
    "a/index.html": page("Boiler servicing"),
    "b/index.html": page("Boiler installs"),
    "c/index.html": page("Boiler prices"),
    "sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["s1", "s2", "s3"].map(s => `<sitemap><loc>https://site.example/${s}.xml</loc></sitemap>`).join("")}</sitemapindex>`,
    "s1.xml": urlset(["/"]),
    "s2.xml": urlset(["/a/", "/b/"]),
    "s3.xml": urlset(["/c/"]),
  });
  const hinted = r.notes.filter(n => /<priority> or <changefreq>/.test(n));
  assert.equal(hinted.length, 1, hinted.join("\n"));
  assert.match(hinted[0], /3 sitemap files/);
  assert.match(hinted[0], /4 of 4 entries/);
});

test("a crawl that stops at --max says so once, with what to do", async () => {
  const r = await crawl(
    {
      "robots.txt": ROBOTS,
      "index.html": page("Boiler repairs", '<a href="/a/">A</a><a href="/b/">B</a><a href="/c/">C</a>'),
      "a/index.html": page("Boiler servicing"),
      "b/index.html": page("Boiler installs"),
      "c/index.html": page("Boiler prices"),
    },
    ["--max", "2"],
  );
  const capped = r.notes.filter(n => /--max/.test(n));
  assert.equal(capped.length, 1, capped.join("\n"));
  assert.match(capped[0], /raise --max/);
});

test("a robots.txt that is really an HTML page is reported as one, not as 'status 200'", async () => {
  const r = await crawl({
    "robots.txt": '<!doctype html><html><head><title>App</title></head><body><div id="root"></div></body></html>',
    "index.html": page("Boiler repairs"),
  });
  const detail = r.findings.find(f => f.check === "robots-missing")?.evidence[0].detail;
  assert.equal(detail, "returns an HTML page instead (soft 404)");
});

test("when every page is drawn by JavaScript, the per-page checks say why they didn't run", async () => {
  const r = await crawl({
    "robots.txt": ROBOTS,
    "index.html":
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>App</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
    "app.js": "document.getElementById('root').textContent = 'Hello';",
  });
  assert.ok(r.findings.some(f => f.check === "client-rendered"));
  const reason = r.notChecked.find(n => n.rule === "META-01")?.reason || "";
  assert.match(reason, /JavaScript/);
  assert.doesNotMatch(reason, /--ignore-noindex/);
});
