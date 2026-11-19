// The Chrome tests are in test/browser/crawl.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { serve } from "./serve.mjs";
import { ROOT, SCRIPTS, node, tmp } from "./helpers.mjs";
import { imageSize } from "../skills/seo-supervisor/scripts/lib/image-size.mjs";
import { findBrowser } from "../skills/seo-supervisor/scripts/checks/render.mjs";

// Just enough of each format's header to carry the pixel size.
const png = (w, h) => {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const jpeg = (w, h) => {
  const app0 = Buffer.alloc(18),
    sof = Buffer.alloc(19);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  sof.writeUInt16BE(0xffc2, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
};
const gif = (w, h) => {
  const b = Buffer.alloc(10);
  b.write("GIF89a", 0, "latin1");
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
};
const webp = (chunk, w, h) => {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "latin1");
  b.write("WEBP", 8, "latin1");
  b.write(chunk, 12, "latin1");
  if (chunk === "VP8X") {
    b.writeUIntLE(w - 1, 24, 3);
    b.writeUIntLE(h - 1, 27, 3);
  }
  if (chunk === "VP8 ") {
    Buffer.from("9d012a", "hex").copy(b, 23);
    b.writeUInt16LE(w, 26);
    b.writeUInt16LE(h, 28);
  }
  if (chunk === "VP8L") {
    b[20] = 0x2f;
    b.writeUInt32LE(((h - 1) << 14) | (w - 1), 21);
  }
  return b;
};
// An ICO directory with one entry per size (0 stands for 256).
const ico = sizes => {
  const b = Buffer.alloc(6 + 16 * sizes.length);
  b.writeUInt16LE(1, 2);
  b.writeUInt16LE(sizes.length, 4);
  sizes.forEach((s, i) => {
    b[6 + 16 * i] = s % 256;
    b[7 + 16 * i] = s % 256;
  });
  return b;
};

test("image sizes are read from PNG, JPEG, GIF, WebP and ICO headers", () => {
  assert.deepEqual(imageSize(ico([16, 32, 256])), { type: "ico", width: 256, height: 256 }, "an ICO's largest entry");
  assert.deepEqual(imageSize(png(1200, 630)), { type: "png", width: 1200, height: 630 });
  assert.deepEqual(imageSize(jpeg(800, 418)), { type: "jpeg", width: 800, height: 418 });
  assert.deepEqual(imageSize(gif(300, 200)), { type: "gif", width: 300, height: 200 });
  for (const chunk of ["VP8X", "VP8 ", "VP8L"])
    assert.deepEqual(imageSize(webp(chunk, 1600, 900)), { type: "webp", width: 1600, height: 900 }, chunk);
  assert.equal(imageSize(Buffer.from("<!doctype html><title>Not found</title>")), null);
  assert.equal(imageSize(jpeg(800, 418).subarray(0, 25)), null, "a cut-off JPEG has no size");
  assert.equal(imageSize(Buffer.alloc(0)), null);
});

// The fixture site has one planted problem per rule below, and a few things that are deliberately right.
test("the crawler finds every planted problem on the fixture site", async () => {
  const shareRequests = [];
  const site = await serve(join(ROOT, "test", "fixture-site"), {
    headers: { "/conflict/": { "X-Robots-Tag": "noindex" } },
    files: {
      "/big.png": { type: "image/png", body: Buffer.alloc(320 * 1024) },
      "/og.png": { type: "image/png", body: png(600, 315) },
      "/og-home.png": { type: "image/png", body: png(1200, 630) },
    },
    before: req => {
      if (/^\/(og|og-home|missing-share)\.png$/.test(req.url)) shareRequests.push(`${req.url} ${req.headers.range}`);
    },
    markdown: { "/": "# Free security tools\n" },
  });
  const out = join(tmp(), "crawl.json");
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://example-security.com",
      "--banned",
      "lorem ipsum|award-winning",
      "--verify",
      "guaranteed",
      "--out",
      out,
    ]);
  } finally {
    await site.close();
  }
  const report = JSON.parse(readFileSync(out, "utf8"));
  const found = new Set(report.findings.map(f => f.rule));
  const passed = new Set(report.passed.map(p => p.rule));

  const planted = {
    "REND-01": "a page whose content only exists in JavaScript",
    "CRAWL-01": "a sitemap URL blocked by robots.txt",
    "CRAWL-02": "a noindex page listed in the sitemap",
    "CRAWL-07": "an internal link to a 404",
    "LINK-02": "an orphan page only the sitemap links to",
    "URL-04": "a missing canonical and a canonical with a query string",
    "SCHEMA-01": "JSON-LD that doesn't parse",
    "SCHEMA-04": "FAQ schema for questions the page doesn't show",
    "CONTENT-01": "a page with two H1s",
    "CONTENT-09": "placeholder text",
    "CONTENT-10": "a banned claim",
    "AI-01": "an indexable page that blocks snippets",
    "MAP-06": "robots.txt blocking an AI crawler",
    "AI-05": "Markdown served without Vary: Accept",
    "META-08": "an hreflang pair without a return link and with an invalid code (/en/, /es/)",
  };
  for (const [rule, what] of Object.entries(planted)) assert.ok(found.has(rule), `missed ${rule}: ${what}`);
  const byCheck = new Map(report.findings.map(f => [f.check, f]));
  const plantedChecks = {
    "doc-basics": "a page with no doctype or viewport (/legacy/)",
    "meta-refresh": "a meta refresh redirect (/legacy/)",
    "og-url-mismatch": "an og:url that differs from the canonical (/legacy/)",
    "robots-conflict": "robots meta index with an X-Robots-Tag noindex header (/conflict/)",
    "no-large-preview": "indexable pages without max-image-preview:large",
    "heavy-image": "a 320 KB image (/big.png)",
    "legacy-image-format": "a PNG over 100 KB (/big.png)",
    "content-signal-invalid": "Content-Signal: ai-train=maybe in robots.txt",
    "markdown-no-vary": "Markdown served for Accept: text/markdown without Vary: Accept",
    "llms-structure": "an llms.txt with no # heading and no links",
    "product-aggregate-offer": "AggregateOffer for one product at one price (/shop/widget/)",
    "product-no-shipping": "an offer without shippingDetails (/shop/widget/)",
    "product-no-returns": "an offer without hasMerchantReturnPolicy (/shop/widget/)",
    "product-price-mismatch": "schema price 19.99 while the page shows $24.99 (/shop/widget/)",
    "sitemap-lastmod-future": "a lastmod in 2099 (/tools/)",
    "sitemap-lastmod-invalid": "a lastmod written 17/11/2026 (/orphan/)",
    "og-image-small": "a 600 px wide share image (/og.png)",
    "og-image-broken": "an og:image that returns 404 (/about/)",
    "og-image-no-size": "og:image without og:image:width and og:image:height",
  };
  for (const [key, what] of Object.entries(plantedChecks)) assert.ok(byCheck.has(key), `missed ${key}: ${what}`);
  const paths = key => (byCheck.get(key)?.evidence || []).map(e => new URL(e.url).pathname);
  for (const key of ["doc-basics", "robots-conflict"])
    assert.ok(!paths(key).includes("/"), `the home page is fine for ${key}`);
  assert.deepEqual(paths("robots-conflict"), ["/conflict/"]);
  for (const rule of ["PERF-01", "REND-06", "REND-07", "PERF-07"])
    assert.match(
      report.notChecked.find(n => n.rule === rule)?.reason || "",
      /Outside checks are off/,
      `${rule} waits for outside checks`,
    );
  assert.ok(
    report.errors.some(e => new URL(e.url).pathname === "/broken/" && e.status === 404),
    "pages that fail are listed, so a later diff sees the status change",
  );
  for (const rule of ["TRUST-07", "URL-03"])
    assert.match(
      report.notChecked.find(n => n.rule === rule)?.reason || "",
      /--check-live/,
      `${rule} waits for --check-live`,
    );
  for (const key of ["product-aggregate-offer", "product-no-shipping", "product-no-returns", "product-price-mismatch"])
    assert.deepEqual(paths(key), ["/shop/widget/"], key);
  assert.ok(
    report.findings.some(f => f.rule === "REND-01" && f.severity === "blocker"),
    "a JS-only page is a blocker",
  );
  assert.ok(
    !byCheck.has("sitemap-priority-changefreq"),
    "<priority> and <changefreq> are ignored by search engines, so they're a note",
  );
  assert.ok(report.notes.some(n => /sitemap\.xml/.test(n) && /<priority> or <changefreq>/.test(n)));
  for (const key of ["sitemap-lastmod-future", "sitemap-lastmod-invalid"]) {
    assert.equal(byCheck.get(key).count, 1, `${key} is counted once per sitemap`);
    assert.equal(byCheck.get(key).evidence[0].url, "https://example-security.com/sitemap.xml");
  }
  assert.match(byCheck.get("sitemap-lastmod-future").evidence[0].detail, /\/tools\/.*2099-01-01/);
  assert.match(byCheck.get("sitemap-lastmod-invalid").evidence[0].detail, /\/orphan\/.*17\/11\/2026/);
  assert.doesNotMatch(
    byCheck.get("sitemap-lastmod-invalid").evidence[0].detail,
    /ssl-checker/,
    "a full W3C datetime with an offset is valid",
  );
  // Share images: one ranged request per unique same-origin image, never a third-party host.
  assert.deepEqual(shareRequests.sort(), [
    "/missing-share.png bytes=0-65535",
    "/og-home.png bytes=0-65535",
    "/og.png bytes=0-65535",
  ]);
  const details = key => (byCheck.get(key)?.evidence || []).map(e => e.detail).join(" | ");
  assert.equal(byCheck.get("og-image-small").count, 1);
  assert.match(details("og-image-small"), /\/og\.png · 600×315/);
  assert.equal(byCheck.get("og-image-broken").count, 1);
  assert.match(details("og-image-broken"), /missing-share\.png → 404/);
  assert.equal(byCheck.get("og-image-broken").severity, "medium");
  assert.doesNotMatch(
    details("og-image-broken") + details("og-image-small"),
    /example\.invalid/,
    "third-party images aren't fetched",
  );
  assert.ok(!paths("og-image-no-size").includes("/"), "the home page declares its share image size");
  assert.ok(paths("og-image-no-size").includes("/tools/"));

  // Things the fixture gets right must pass, not be flagged.
  assert.ok(passed.has("CRAWL-05"), "unknown URLs return a real 404, so the soft-404 check passes");
  assert.ok(passed.has("MAP-01"), "the sitemap is found");

  for (const f of report.findings)
    assert.ok(f.what && f.why && f.fix, `${f.rule} "${f.title}" needs what, why and fix`);

  // Each page's description and H1 text are recorded, so a planned page can be checked after it is built.
  const home = report.pages.find(p => new URL(p.url).pathname === "/");
  assert.equal(home.h1Text, "Free security tools");
  assert.match(home.description, /^A perfectly reasonable description/);
  assert.equal(home.ogImage, "https://example-security.com/og-home.png");
  assert.equal(home.ogTitle, "Free Security Testing Tools | Brand");
  assert.ok(home.words > 100);
});

// A one-page site with its public origin at https://example.com; each test passes its own sitemap, or its own sitemap
// files ({ path: { type, body } }, each listed in robots.txt), headers by path, and robots.txt (null for none).
async function crawlOnePage({
  lastmod = "2026-11-17",
  extra = "",
  before,
  files,
  headers,
  robots = `User-agent: *\nAllow: /\n${Object.keys(files || { "/sitemap.xml": 1 })
    .map(p => `Sitemap: https://example.com${p}\n`)
    .join("")}`,
} = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Home</title><link rel="canonical" href="https://example.com/"><meta property="og:image" content="https://example.com/og-loop.png"></head><body><h1>Home</h1></body></html>`,
  );
  if (robots != null) writeFileSync(join(dir, "robots.txt"), robots);
  writeFileSync(
    join(dir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc><lastmod>${lastmod}</lastmod>${extra}</url></urlset>`,
  );
  const site = await serve(dir, { before, files, headers });
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://example.com",
      "--out",
      out,
    ]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}

test("<priority> and <changefreq> are a note and leave MAP-04 passing", async () => {
  const r = await crawlOnePage({ extra: "<changefreq>daily</changefreq><priority>0.8</priority>" });
  assert.ok(!r.findings.some(f => f.check === "sitemap-priority-changefreq"));
  assert.ok(
    r.passed.some(p => p.rule === "MAP-04"),
    "an accurate lastmod is all MAP-04 asks for",
  );
  assert.ok(r.notes.some(n => /<priority> or <changefreq>/.test(n)));
});

test("a lastmod that isn't a real calendar date is invalid", async () => {
  const r = await crawlOnePage({ lastmod: "2026-02-30" });
  assert.match(r.findings.find(f => f.check === "sitemap-lastmod-invalid")?.evidence[0].detail || "", /2026-02-30/);
});

test("an og:image the local server redirects to the public origin is unreadable (a note), not broken", async () => {
  // The public URL maps back onto the crawl URL, so following it would loop.
  const r = await crawlOnePage({
    before(req, res) {
      if (req.url !== "/og-loop.png") return false;
      res.writeHead(301, { Location: "https://example.com/og-loop.png" }).end();
      return true;
    },
  });
  assert.ok(
    !r.findings.some(f => f.check === "og-image-broken"),
    JSON.stringify(r.findings.find(f => f.check === "og-image-broken")?.evidence),
  );
  assert.ok(r.notes.some(n => /share image/.test(n) && /redirect/.test(n)));
});

const xml = body => Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${body}`);
const urlset = (paths, ns = "") =>
  xml(
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${ns}>${paths.map(p => (p.startsWith("<") ? p : `<url><loc>https://example.com${p}</loc></url>`)).join("")}</urlset>`,
  );
const evidenceOf = (r, check) =>
  Object.fromEntries(
    (r.findings.find(f => f.check === check)?.evidence || []).map(e => [new URL(e.url).pathname, e.detail]),
  );

test("gzipped sitemaps and sitemap indexes are read, whatever the URL or content type says", async () => {
  const r = await crawlOnePage({
    files: {
      "/sitemap_index.xml.gz": {
        type: "application/gzip",
        body: gzipSync(
          xml(
            `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/pages.xml.gz</loc></sitemap><sitemap><loc>https://example.com/posts.xml</loc></sitemap></sitemapindex>`,
          ),
        ),
      },
      "/pages.xml.gz": { type: "application/octet-stream", body: gzipSync(urlset(["/"])) },
      // A .gz file the server compresses again: fetch undoes the Content-Encoding, the crawler the gzip inside.
      "/posts.xml": { type: "application/xml", body: gzipSync(gzipSync(urlset(["/about/"]))) },
    },
    headers: { "/posts.xml": { "Content-Encoding": "gzip" } },
  });
  assert.ok(
    !r.findings.some(f =>
      ["sitemap-missing", "missing-from-sitemap", "sitemap-invalid", "sitemap-too-big"].includes(f.check),
    ),
    JSON.stringify(r.findings.map(f => f.check)),
  );
  assert.equal(r.stats.sitemapUrls, 2);
  assert.ok(r.passed.some(p => p.rule === "MAP-01") && r.pages[0].inSitemap);
});

test("a sitemap that isn't well-formed XML is flagged with its line and column; valid XML, a text sitemap and an HTML page at a guessed URL aren't", async () => {
  const unclosed = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></urlset>`;
  const HTML = Buffer.from(
    `<!doctype html><html lang="en"><head><title>Not found</title></head><body><h1>Page not found</h1></body></html>`,
  );
  const [r, guessed] = await Promise.all([
    crawlOnePage({
      files: {
        "/amp.xml": {
          type: "application/xml",
          body: xml(
            `\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/?a=1&b=2</loc></url>\n</urlset>\n`,
          ),
        },
        "/space.xml": { type: "application/xml", body: Buffer.concat([Buffer.from("\n"), urlset(["/"])]) },
        "/page.xml": { type: "text/html; charset=utf-8", body: HTML },
        "/unclosed.xml": { type: "application/xml", body: Buffer.from(unclosed) },
        "/entity.xml": { type: "text/xml", body: urlset(["/caf&eacute;/"]) },
        "/good.xml": {
          type: "application/xml",
          body: Buffer.from([
            0xef,
            0xbb,
            0xbf,
            ...Buffer.from(
              `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<!-- generated -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image='http://www.google.com/schemas/sitemap-image/1.1' xmlns:xhtml="http://www.w3.org/1999/xhtml">\n<url><loc>https://example.com/?a=1&amp;b=2</loc><xhtml:link rel="alternate" hreflang="en" href="https://example.com/"/><image:image><image:loc>https://example.com/a.png</image:loc><image:caption><![CDATA[Tom & Jerry <3]]></image:caption></image:image></url>\n<url><loc>https://example.com/caf&#xE9;/</loc></url>\n</urlset>\n`,
            ),
          ]),
        }, // with a byte-order mark
        "/sitemap.txt": { type: "text/plain", body: Buffer.from("https://example.com/\nhttps://example.com/about/\n") },
      },
    }),
    crawlOnePage({ robots: "User-agent: *\nAllow: /\n", files: { "/sitemap.xml": { type: "text/html", body: HTML } } }),
  ]);
  const f = r.findings.find(f => f.check === "sitemap-invalid"),
    bad = evidenceOf(r, "sitemap-invalid");
  assert.deepEqual([f?.rule, f?.severity], ["MAP-01", "high"]);
  assert.match(f.title, /Google can't read/);
  assert.deepEqual(Object.keys(bad).sort(), ["/amp.xml", "/entity.xml", "/page.xml", "/space.xml", "/unclosed.xml"]);
  assert.match(bad["/amp.xml"], /^line 3, column 37: .*&amp;/);
  assert.match(bad["/space.xml"], /^line 2, column 1: .*<\?xml/);
  assert.match(bad["/page.xml"], /HTML page/);
  assert.match(bad["/unclosed.xml"], new RegExp(`^line 1, column ${unclosed.indexOf("</urlset>") + 1}: .*</url>`));
  assert.match(bad["/entity.xml"], /&eacute;/);
  assert.ok(!r.findings.some(f => f.check === "sitemap-missing"));
  assert.ok(evidenceOf(r, "sitemap-bad-status")["/about/"], "the text sitemap's URLs are read");
  // No sitemap listed anywhere, and the guessed /sitemap.xml is the site's HTML page: that's a missing sitemap.
  assert.ok(!guessed.findings.some(f => f.check === "sitemap-invalid"));
  assert.match(evidenceOf(guessed, "sitemap-missing")["/sitemap.xml"] || "", /HTML page/);
});

test("a sitemap file over 50,000 URLs or 50 MB uncompressed is flagged, and read no further than 50 MB", async () => {
  const huge = gzipSync(
    Buffer.concat([
      xml(
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url><!-- `,
      ),
      Buffer.alloc(51 * 1024 * 1024, "x"),
      Buffer.from(" --></urlset>"),
    ]),
  );
  const r = await crawlOnePage({
    files: {
      "/many.xml": { type: "application/xml", body: urlset(Array(50001).fill("/")) }, // one URL repeated, so the crawl stays one page
      "/huge.xml.gz": { type: "application/gzip", body: huge },
      "/fine.xml": { type: "application/xml", body: urlset(Array(50000).fill("/")) },
    },
  });
  const f = r.findings.find(f => f.check === "sitemap-too-big"),
    big = evidenceOf(r, "sitemap-too-big");
  assert.deepEqual([f?.rule, f?.severity], ["MAP-01", "medium"]);
  assert.deepEqual(Object.keys(big).sort(), ["/huge.xml.gz", "/many.xml"]);
  assert.match(big["/many.xml"], /50,001 URLs/);
  assert.match(big["/huge.xml.gz"], /over 50 MB/);
  assert.ok(!r.findings.some(f => f.check === "sitemap-invalid"), "a file cut at 50 MB isn't called broken XML");
});

test("news sitemaps: required tags, articles from the last two days and at most 1,000 per file; a correct one and a normal sitemap pass", async () => {
  const NS = ` xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"`,
    old = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  const article = ({
    date = new Date().toISOString(),
    lang = "<news:language>en</news:language>",
    title = "<news:title>Council approves new park</news:title>",
  } = {}) =>
    `<url><loc>https://example.com/</loc><news:news><news:publication><news:name>The Daily Example</news:name>${lang}</news:publication><news:publication_date>${date}</news:publication_date>${title}</news:news></url>`;
  const r = await crawlOnePage({
    files: {
      "/sitemap.xml": { type: "application/xml", body: urlset(["/"]) },
      "/news.xml": {
        type: "application/xml",
        body: urlset([article(), article({ date: new Date().toISOString().slice(0, 10) })], NS),
      },
      "/news-bad.xml": {
        type: "application/xml",
        body: urlset(
          [article({ lang: "", title: "" }), article({ date: "November 17, 2026" }), article({ date: old })],
          NS,
        ),
      },
      "/news-big.xml": { type: "application/xml", body: urlset(Array(1001).fill(article()), NS) },
    },
  });
  const sev = check => {
    const f = r.findings.find(f => f.check === check);
    return [f?.rule, f?.severity];
  };
  assert.deepEqual(sev("news-sitemap-tags"), ["MAP-01", "medium"]);
  assert.deepEqual(sev("news-sitemap-too-many"), ["MAP-01", "medium"]);
  assert.deepEqual(sev("news-sitemap-old"), ["MAP-01", "low"]);
  assert.deepEqual(Object.keys(evidenceOf(r, "news-sitemap-tags")), ["/news-bad.xml"]);
  assert.match(
    evidenceOf(r, "news-sitemap-tags")["/news-bad.xml"],
    /^2 of 3 articles, e\.g\. https:\/\/example\.com\/: no <news:language>, <news:title>/,
  );
  assert.deepEqual(Object.keys(evidenceOf(r, "news-sitemap-old")), ["/news-bad.xml"]);
  assert.match(
    evidenceOf(r, "news-sitemap-old")["/news-bad.xml"],
    new RegExp(`^1 of 3 articles, e\\.g\\. https://example\\.com/: ${old}`),
  );
  assert.deepEqual(evidenceOf(r, "news-sitemap-too-many"), { "/news-big.xml": "1,001 articles" });
  assert.ok(!r.findings.some(f => f.check === "sitemap-invalid"));
});

test("robots.txt answering 5xx or 429 is a high crawl finding, and its rules count as unread; a 404 is still a missing file", async () => {
  const answer = status => (req, res) => req.url === "/robots.txt" && (res.writeHead(status).end("busy"), true);
  const [down, busy, silent, missing, fine] = await Promise.all([
    crawlOnePage({ before: answer(503) }),
    crawlOnePage({ before: answer(429) }),
    crawlOnePage({ before: req => req.url === "/robots.txt" && (req.socket.destroy(), true) }),
    crawlOnePage({ robots: null }),
    crawlOnePage(),
  ]);
  assert.match(
    evidenceOf(silent, "robots-server-error")["/robots.txt"] || "",
    /^no answer/,
    "Google treats a network error as a server error",
  );
  for (const r of [down, busy, silent]) {
    const f = r.findings.find(f => f.check === "robots-server-error");
    assert.deepEqual([f?.rule, f?.severity], ["CRAWL-01", "high"]);
    assert.ok(!r.findings.some(f => f.check === "robots-missing"));
    for (const rule of ["MAP-05", "MAP-06"])
      assert.ok(
        !r.passed.some(p => p.rule === rule) &&
          r.notChecked.some(n => n.rule === rule && /couldn't be read/.test(n.reason)),
        rule,
      );
  }
  assert.equal(evidenceOf(down, "robots-server-error")["/robots.txt"], "status 503");
  assert.equal(evidenceOf(busy, "robots-server-error")["/robots.txt"], "status 429");
  const m = missing.findings.find(f => f.check === "robots-missing");
  assert.deepEqual([m?.rule, m?.severity], ["MAP-05", "medium"]);
  assert.ok(
    !missing.findings.some(f => f.check === "robots-server-error") && missing.passed.some(p => p.rule === "CRAWL-01"),
  );
  assert.ok(!fine.findings.some(f => /^robots-/.test(f.check)));
  for (const rule of ["CRAWL-01", "MAP-05", "MAP-06"])
    assert.ok(
      fine.passed.some(p => p.rule === rule),
      rule,
    );
});

// Pages ({ "/path/": html }) in a temp folder, crawled as the site at `origin`; `args` and `env` go to the crawler.
async function crawlSite(pages, serveOpts, origin = "https://site.example", { args = [], env } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir, serveOpts);
  try {
    await node(
      [join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--site-origin", origin, "--out", out, ...args],
      env ? { env } : {},
    );
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
// Outside checks with a closed local port standing in for PageSpeed, so nothing leaves the machine.
const OUTSIDE = ["--outside", "--psi-endpoint", "http://127.0.0.1:9/runPagespeed"];
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const pathsOf = (r, check) => (findingOf(r, check)?.evidence || []).map(e => new URL(e.url).pathname).sort();

// A plumber's site with one planted problem per page; every title ends in the brand, as most sites' titles do.
const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const PRIVACY =
  "We collect your name, email address and phone number when you contact us. We keep these details for two years and never sell them to anyone. You can ask us to delete your data at any time by writing to our office or emailing the team. Under the UK GDPR our web server also logs your IP address. ".repeat(
    2,
  );
const plumber = (title, h1, body, { head = '<meta charset="utf-8">', bodyAttrs = "" } = {}) =>
  `<!doctype html><html lang="en"><head>${head}<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body${bodyAttrs}><main><h1>${h1}</h1><p>${COPY}</p>${body}</main></body></html>`;
const PLUMBER = {
  // Brand-heavy: the title is only the brand, which the page's own text never repeats.
  "/": plumber(
    "Welcome to Northwind Plumbing",
    "Welcome",
    `<script>addEventListener("beforeunload", () => {}); addEventListener("pagehide", () => {});</script>
    ${["boilers", "privacy-notice", "nostore", "unload", "parts", "links", "latin", "alias", "old", "faq", "hvac", "lpg"].map(p => `<a href="/${p}/">Go to ${p}</a>`).join(" ")}`,
  ),
  "/boilers/": plumber("Emergency Boiler Repairs | Northwind Plumbing", "Emergency boiler repairs", ""),
  // A privacy notice under a sales title. "IP" isn't read as "Installation Prices": two-letter initials are too common.
  "/privacy-notice/": plumber(
    "Kitchen Tap Installation Prices | Northwind Plumbing",
    "How we handle your personal data",
    `<p>${PRIVACY}</p>`,
  ),
  // Titles whose words the page shows only as an acronym, or that share one with the H1.
  "/faq/": plumber(
    "Frequently Asked Questions | Northwind Plumbing",
    "FAQ",
    "<h2>How quickly can you come out?</h2><p>Within two hours anywhere in the city.</p>",
  ),
  "/hvac/": plumber("Heating, Ventilation and Air Conditioning | Northwind", "HVAC servicing", ""),
  "/lpg/": plumber("LPG Boiler Conversions | Northwind Plumbing", "LPG for rural homes", ""),
  "/nostore/": plumber("Yearly Boiler Servicing | Northwind Plumbing", "Yearly boiler servicing", ""),
  "/unload/": plumber(
    "Leak Detection Services | Northwind Plumbing",
    "Finding hidden leaks",
    `<script>window.addEventListener('unload', function () { navigator.sendBeacon("/log"); });</script>`,
  ),
  "/parts/": plumber(
    "Spare Parts Catalogue | Northwind Plumbing",
    "Spare parts catalogue",
    `<ul>${"<li>Valve</li>".repeat(1450)}</ul>`,
  ),
  "/links/": plumber(
    "Useful Links and Contacts | Northwind Plumbing",
    "Useful links and contacts",
    `
    <a href="/boilers/"></a> <a href="/boilers/"><img src="data:," alt=""></a>
    <a href="/boilers/" aria-label="Boiler repairs"><svg viewBox="0 0 1 1"><path d="M0 0"/></svg></a> <a href="/boilers/"><svg><title>Boiler repairs</title></svg></a>
    <a href="/boilers/"><img src="data:," alt="Boiler repairs"></a> <a href="/boilers/" title="Boiler repairs"><i class="icon"></i></a> <a href="/boilers/"><span class="visually-hidden">Boiler repairs</span></a> <a name="top"></a>
    <a href="/boilers/" aria-hidden="true" tabindex="-1"><img src="data:," alt=""></a> <a href="/boilers/">Boiler repairs</a>
    <a href="http://site.example/boilers/">Boilers over http</a> <a href="HTTP://www.site.example/">Home over http</a> <a href="https://site.example/boilers/">Boilers</a> <a href="http://elsewhere.example/">Another site</a>
    <iframe src="about:blank" title="Map"></iframe> <font-awesome-icon icon="phone"></font-awesome-icon> <center-box>Call us</center-box>`,
  ),
  "/latin/": plumber("Water Heater Installation | Northwind Plumbing", "Water heater installation", ""),
  // ISO-8859-1 and windows-1252 are the same encoding to browsers.
  "/alias/": plumber("Shower Pump Fitting | Northwind Plumbing", "Shower pump fitting", "", {
    head: '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">',
  }),
  "/old/": plumber(
    "Our Company History | Northwind Plumbing",
    "Our company history",
    "<center>Since 1998</center> <font color=red>Call now</font> <marquee>Open today</marquee>",
    { bodyAttrs: ' onunload="track()"' },
  ),
};
let plumberRun;
const plumberSite = () =>
  (plumberRun ||= crawlSite(PLUMBER, {
    headers: {
      "/nostore/": { "Cache-Control": "no-store" },
      "/latin/": { "Content-Type": "text/html; charset=iso-8859-1" },
      "/alias/": { "Content-Type": "text/html; charset=ISO-8859-1" },
    },
  }));

test("back/forward cache hints: pages sent with no-store, and inline unload handlers", async () => {
  const r = await plumberSite();
  assert.deepEqual(pathsOf(r, "bfcache-no-store"), ["/nostore/"]);
  assert.deepEqual(pathsOf(r, "bfcache-unload"), ["/old/", "/unload/"], "beforeunload and pagehide are fine");
  for (const key of ["bfcache-no-store", "bfcache-unload"])
    assert.deepEqual([findingOf(r, key).rule, findingOf(r, key).severity], ["PERF-10", "low"], key);
  assert.match(findingOf(r, "bfcache-no-store").why, /Chrome/, "says what Chrome does with no-store pages now");
  assert.ok(!r.notChecked.some(n => n.rule === "PERF-10"), "a hint is a finding even without Chrome's own test");
});

// A clean two-page site; `head` goes into both pages' <head>, `body` into the home page's.
const two = (head = "", body = "") => ({
  "/": plumber(
    "Boiler Repairs and Servicing in Leeds",
    "Boiler repairs and servicing in Leeds",
    `<a href="/about/">About the team</a>${body}`,
    { head: `<meta charset="utf-8">${head}` },
  ),
  "/about/": plumber("About Our Leeds Engineers", "About our Leeds engineers", "", {
    head: `<meta charset="utf-8">${head}`,
  }),
});

test("speculation rules: one suggestion for a multi-page site with none; a rules script, the header or a client-side router counts", async () => {
  const r = await plumberSite();
  assert.deepEqual(pathsOf(r, "no-speculation-rules"), ["/"]);
  assert.deepEqual(
    [
      findingOf(r, "no-speculation-rules").rule,
      findingOf(r, "no-speculation-rules").severity,
      findingOf(r, "no-speculation-rules").count,
    ],
    ["PERF-09", "low", 1],
  );
  const runs = [
    await crawlSite(
      two(
        `<script type="speculationrules">{"prefetch":[{"where":{"href_matches":"/*"},"eagerness":"moderate"}]}</script>`,
      ),
    ),
    await crawlSite(two(), { headers: { "/": { "Speculation-Rules": '"/speculation.json"' } } }),
    await crawlSite(two('<script src="/_next/static/chunks/main.js" async></script>')),
  ];
  for (const run of runs) {
    assert.ok(
      !findingOf(run, "no-speculation-rules"),
      JSON.stringify(findingOf(run, "no-speculation-rules")?.evidence),
    );
    assert.ok(run.passed.some(p => p.rule === "PERF-09"));
  }
  for (const rule of ["REND-10", "META-09"])
    assert.ok(
      runs[0].passed.some(p => p.rule === rule),
      `${rule} passes on a clean site`,
    );
  const one = await crawlOnePage();
  assert.ok(
    !findingOf(one, "no-speculation-rules") && !one.passed.some(p => p.rule === "PERF-09"),
    "a one-page site has no next page to load",
  );
});

// Rails 8's default layout: the stylesheet and import map carry data-turbo-track, and the import map loads Turbo.
const RAILS = `<link rel="stylesheet" href="/assets/application-8b441ae0.css" data-turbo-track="reload"><script type="importmap" data-turbo-track="reload">{"imports":{"application":"/assets/application-bfcdf840.js","@hotwired/turbo-rails":"/assets/turbo.min-3e48f180.js","@hotwired/stimulus":"/assets/stimulus.min-4b1e420e.js"}}</script><script type="module">import "application"</script>`;
const VITE_SHELL = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Northwind Plumbing</title><script type="module" crossorigin src="/assets/index-DiwrgTda.js"></script></head><body><div id="root"></div></body></html>`;

test("speculation rules: Turbo, React Router, Angular, Docusaurus and Inertia sites aren't flagged; a single-page app is listed as not checked", async () => {
  const routers = {
    rails: two(RAILS),
    "react-router": two("", `<script>window.__reactRouterContext = {"basename":"/","future":{}};</script>`),
    angular: two("", `<app-root ng-version="19.2.0" ng-server-context="ssr"></app-root>`),
    docusaurus: two("", `<div id="__docusaurus"></div>`),
    inertia: two(
      "",
      `<div id="app" data-page="{&quot;component&quot;:&quot;Home&quot;,&quot;props&quot;:{},&quot;url&quot;:&quot;/&quot;}"></div>`,
    ),
  };
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/about/", "/pricing/"].map(p => `<url><loc>https://site.example${p}</loc></url>`).join("")}</urlset>`;
  const [spa, ...runs] = await Promise.all([
    crawlSite(
      { "/": VITE_SHELL, "/about/": VITE_SHELL, "/pricing/": VITE_SHELL },
      { files: { "/sitemap.xml": { type: "application/xml", body: Buffer.from(sitemap) } } },
    ),
    ...Object.values(routers).map(pages => crawlSite(pages)),
  ]);
  for (const [i, name] of Object.keys(routers).entries()) {
    assert.ok(!findingOf(runs[i], "no-speculation-rules"), `${name}: its router loads the next page itself`);
    assert.ok(
      runs[i].passed.some(p => p.rule === "PERF-09"),
      name,
    );
  }
  assert.equal(spa.stats.htmlPages, 3);
  assert.ok(
    !findingOf(spa, "no-speculation-rules") && !spa.passed.some(p => p.rule === "PERF-09"),
    JSON.stringify(findingOf(spa, "no-speculation-rules")?.evidence),
  );
  assert.match(spa.notChecked.find(n => n.rule === "PERF-09")?.reason || "", /built in the browser/);
});

test("PERF-10 passes only on Chrome's own test: without it, it's listed as not checked with the reason", async () => {
  const [offline, noBrowser] = await Promise.all([
    crawlSite(two()),
    // CHROME_PATH points at something that isn't a browser, so it can't load a page.
    crawlSite(two(), {}, undefined, { args: OUTSIDE, env: { ...process.env, CHROME_PATH: process.execPath } }),
  ]);
  for (const r of [offline, noBrowser])
    assert.ok(
      !r.passed.some(p => p.rule === "PERF-10") && !r.findings.some(f => f.rule === "PERF-10"),
      JSON.stringify(r.passed),
    );
  assert.match(
    offline.notChecked.find(n => n.rule === "PERF-10")?.reason || "",
    /^Chrome's back\/forward cache test didn't run: outside checks are off/,
  );
  assert.match(
    noBrowser.notChecked.find(n => n.rule === "PERF-10")?.reason || "",
    /^Chrome's back\/forward cache test didn't run: the browser couldn't load the sample pages/,
  );
});

test(
  "PERF-10 on a one-page site: Back needs a second page, so Chrome's test can't run",
  { skip: !findBrowser() && "Chrome not installed", timeout: 120000 },
  async () => {
    const r = await crawlSite({ "/": two()["/"].replace('<a href="/about/">About the team</a>', "") }, {}, undefined, {
      args: OUTSIDE,
    });
    assert.equal(r.stats.htmlPages, 1);
    assert.ok(!r.passed.some(p => p.rule === "PERF-10"));
    assert.match(r.notChecked.find(n => n.rule === "PERF-10")?.reason || "", /only one page could be tested/);
  },
);

test("pages over Lighthouse's 1,400-element level are flagged", async () => {
  const r = await plumberSite(),
    f = findingOf(r, "dom-size");
  assert.deepEqual(pathsOf(r, "dom-size"), ["/parts/"]);
  assert.deepEqual([f.rule, f.severity], ["PERF-06", "low"]);
  assert.match(f.evidence[0].detail, /^1,45\d elements/);
});

test("links with no text, label, title or image alt are flagged; labelled icon links and aria-hidden card links aren't", async () => {
  const r = await plumberSite(),
    f = findingOf(r, "link-no-text");
  assert.deepEqual(pathsOf(r, "link-no-text"), ["/links/"]);
  assert.deepEqual([f.rule, f.severity], ["LINK-05", "medium"]);
  assert.match(
    f.evidence[0].detail,
    /^2 link\(s\), e\.g\. \/boilers\/$/,
    "an empty link and one around an image with empty alt; screen readers skip an aria-hidden one",
  );
});

test("links to the site's own pages over http:// on an HTTPS site are flagged, other sites' links aren't", async () => {
  const r = await plumberSite(),
    f = findingOf(r, "link-http");
  assert.deepEqual(pathsOf(r, "link-http"), ["/links/"]);
  assert.deepEqual([f.rule, f.severity], ["CRAWL-08", "medium"]);
  assert.equal(
    f.evidence[0].detail,
    "2 link(s), e.g. http://site.example/boilers/",
    "the www host counts as the same site",
  );
  const plain = await crawlSite(
    { "/": plumber("Boiler Repairs in Leeds", "Boiler repairs", '<a href="http://site.example/">Home</a>') },
    {},
    "http://site.example",
  );
  assert.ok(!findingOf(plain, "link-http"), "a site that isn't on HTTPS yet has nothing to redirect to");
});

test("a title none of whose main words are on the page is flagged; normal, brand-only and acronym titles aren't", async () => {
  const r = await plumberSite(),
    f = findingOf(r, "title-mismatch");
  // "Welcome to Northwind Plumbing" on / is all brand (in most titles) and a stopword, so there's nothing to compare.
  // /faq/ shows "FAQ", /hvac/ "HVAC" (and/of/the are skipped), and /lpg/'s H1 shares "LPG" with its title.
  assert.deepEqual(pathsOf(r, "title-mismatch"), ["/privacy-notice/"]);
  assert.deepEqual([f.rule, f.severity], ["META-09", "low"]);
  assert.equal(
    f.evidence[0].detail,
    "“Kitchen Tap Installation Prices | Northwind Plumbing”: kitchen, installation, prices aren't on the page",
  );
});

test("a charset header that disagrees with the page's meta charset is flagged; names for the same encoding agree", async () => {
  const r = await plumberSite(),
    f = findingOf(r, "charset-mismatch");
  assert.deepEqual(
    pathsOf(r, "charset-mismatch"),
    ["/latin/"],
    "ISO-8859-1 and windows-1252 are one encoding to browsers",
  );
  assert.deepEqual([f.rule, f.severity], ["REND-09", "medium"]);
  assert.equal(f.evidence[0].detail, "header: iso-8859-1 · meta: utf-8");
});

test("obsolete tags are flagged; iframes and custom elements named like them aren't", async () => {
  const r = await plumberSite(),
    f = findingOf(r, "obsolete-tags");
  assert.deepEqual(
    pathsOf(r, "obsolete-tags"),
    ["/old/"],
    "/links/ has an iframe, <font-awesome-icon> and <center-box>",
  );
  assert.deepEqual([f.rule, f.severity, f.evidence[0].detail], ["REND-10", "low", "<center>, <font>, <marquee>"]);
  const frames = await crawlSite({
    "/": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Framed Boiler Repairs Site</title></head><frameset cols="50%,50%"><frame src="/menu.html"><frame src="/main.html"></frameset></html>`,
  });
  assert.equal(
    findingOf(frames, "obsolete-tags")?.evidence[0].detail,
    "<frameset>, <frame>",
    "a frameset page has no body",
  );
});

// A site of plumber pages ({ "/path/": [title, head, body] }); the home page links to every other page.
const site = pages =>
  Object.fromEntries(
    Object.entries(pages).map(([p, [title, head = "", body = ""]], _, all) => [
      p,
      plumber(
        title,
        title,
        p === "/"
          ? body +
              all
                .filter(([q]) => q !== "/")
                .map(([q]) => `<a href="${q}">${q}</a>`)
                .join(" ")
          : body,
        { head: `<meta charset="utf-8">${head}` },
      ),
    ]),
  );
const file = (type, body) => ({ type, body: Buffer.from(body) });
const pathOf = r => p => new URL(p.url).pathname;

test("robots rules: none means noindex and nofollow, other crawlers' rules don't count, a nofollow page and noindex with a canonical elsewhere are flagged", async () => {
  const r = await crawlSite(
    site({
      "/": ["Boiler Repairs and Servicing in Leeds"],
      "/none/": ["Robots None Page in Leeds", '<meta name="robots" content="none">'],
      "/otherbot/": ["Other Crawler Rules in Leeds"],
      "/googlebot/": ["Googlebot Header Rules in Leeds"],
      "/bingbot/": ["Bing Meta Rules in Leeds", '<meta name="bingbot" content="noindex, nofollow">'],
      "/nofollow/": ["Nofollow Page in Leeds", '<meta name="robots" content="index, nofollow">'],
      "/elsewhere/": [
        "Noindex Canonical Elsewhere in Leeds",
        '<meta name="robots" content="noindex"><link rel="canonical" href="https://site.example/">',
      ],
      "/hidden/": [
        "Hidden Page in Leeds",
        '<meta name="robots" content="noindex, nofollow"><link rel="canonical" href="https://site.example/hidden/">',
      ],
    }),
    {
      headers: {
        "/otherbot/": { "X-Robots-Tag": "otherbot: noindex, nofollow, nosnippet" },
        "/googlebot/": { "X-Robots-Tag": "googlebot: noindex" },
      },
    },
  );
  assert.deepEqual(
    r.pages
      .filter(p => p.noindex)
      .map(pathOf(r))
      .sort(),
    ["/elsewhere/", "/googlebot/", "/hidden/", "/none/"],
  );
  assert.deepEqual(
    pathsOf(r, "page-nofollow"),
    ["/nofollow/"],
    "noindex, nofollow is fine, and otherbot's and bingbot's rules aren't Google's",
  );
  assert.deepEqual([findingOf(r, "page-nofollow").rule, findingOf(r, "page-nofollow").severity], ["META-06", "medium"]);
  assert.ok(!findingOf(r, "nosnippet"), "otherbot: nosnippet isn't for Google");
  assert.ok(!findingOf(r, "robots-conflict"));
  assert.deepEqual(
    pathsOf(r, "noindex-canonical"),
    ["/elsewhere/"],
    "a noindex page with a canonical to itself is fine",
  );
  assert.deepEqual(
    [findingOf(r, "noindex-canonical").rule, findingOf(r, "noindex-canonical").severity],
    ["CRAWL-02", "medium"],
  );
});

test("Markdown answers need Vary: Accept itself (or *); Accept-Encoding isn't it", async () => {
  const runs = await Promise.all(
    ["Accept-Encoding", "Accept-Encoding, Accept", "*"].map(v =>
      crawlSite(two(), { markdown: { "/": "# Boiler repairs\n" }, headers: { "/": { Vary: v } } }),
    ),
  );
  assert.equal(findingOf(runs[0], "markdown-no-vary")?.evidence[0].detail, "Vary: Accept-Encoding");
  for (const r of runs.slice(1))
    assert.ok(
      !findingOf(r, "markdown-no-vary") && r.passed.some(p => p.rule === "AI-05"),
      JSON.stringify(findingOf(r, "markdown-no-vary")?.evidence),
    );
});

test("Chinese, Japanese and Thai pages are counted in words, so thin-page and near-duplicate work there", async () => {
  const ZH_A =
    "我们的工程师每天在城市各处修理漏水和散热器。每次开工之前，我们都会提供清楚的书面报价。工作完成后，我们会把现场打扫干净。";
  const ZH_B =
    "这家餐厅提供新鲜的海鲜和本地蔬菜。厨师每天早上去市场挑选食材。周末晚上最好提前预订座位，节假日也照常营业。";
  const JA = "最新のBoilerの修理は私たちのエンジニアにお任せください。見積もりは無料で、作業の前に必ずご説明します。";
  const TH = "ช่างของเราซ่อมท่อรั่วทั่วเมืองทุกวัน เราให้ใบเสนอราคาที่ชัดเจนก่อนเริ่มงานทุกครั้ง และทำความสะอาดหลังงานเสร็จ";
  const page = (lang, title, text, links = "", h1 = title) =>
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${h1}</h1><p>${text}</p>${links}</main><script src="/app.js"></script></body></html>`;
  const r = await crawlSite({
    "/": page(
      "zh",
      "北风水暖维修服务",
      ZH_A.repeat(6),
      ["food", "copy", "short", "ja", "th"].map(p => `<a href="/${p}/">${p}</a>`).join(" "),
    ),
    "/food/": page("zh", "海鲜餐厅", ZH_B.repeat(6)),
    "/copy/": page("zh", "水暖维修服务", ZH_A.repeat(6)),
    "/short/": page("zh", "简短页面", ZH_B),
    "/ja/": page("ja", "Boiler Service | ノースウィンド", JA.repeat(6), "", "ボイラーの修理"),
    "/th/": page("th", "ซ่อมท่อ", TH.repeat(8)),
  });
  const words = Object.fromEntries(r.pages.map(p => [pathOf(r)(p), p.words]));
  for (const p of ["/", "/food/", "/copy/", "/ja/", "/th/"]) assert.ok(words[p] >= 150, `${p}: ${words[p]} words`);
  assert.deepEqual(pathsOf(r, "thin-page"), ["/short/"]);
  assert.ok(!findingOf(r, "client-rendered"));
  const dup = findingOf(r, "near-duplicate");
  assert.equal(dup?.count, 1);
  assert.match(dup.evidence[0].url + dup.evidence[0].detail, /\/copy\//);
  assert.ok(!pathsOf(r, "title-mismatch").includes("/ja/"), "“Boiler” is on the page, written next to Japanese");
});

test("a missing llms.txt is a note, not a finding (it's optional); a well-formed one passes MAP-07", async () => {
  const [none, good] = await Promise.all([
    crawlOnePage(),
    crawlSite(two(), {
      files: {
        "/llms.txt": file(
          "text/plain; charset=utf-8",
          "# Northwind Plumbing\n\n> Boiler repairs in Leeds.\n\n- [About](https://site.example/about/): the team\n",
        ),
      },
    }),
  ]);
  assert.ok(!none.findings.some(f => f.rule === "MAP-07"));
  assert.ok(!none.passed.some(p => p.rule === "MAP-07"), "nothing was measured, so MAP-07 doesn't pass either");
  assert.ok(none.notes.some(n => /llms\.txt/.test(n) && /optional/.test(n)));
  assert.ok(good.passed.some(p => p.rule === "MAP-07"));
});

test("the rule text matches the checks: short titles, and Book actions still in use", () => {
  const read = f => readFileSync(join(ROOT, "skills", "seo-supervisor", "rules", f), "utf8");
  assert.match(read("metadata.md"), /`title-short` \(flagged under 20 characters; aim for about 30–60\)/);
  const sd = read("structured-data.md");
  assert.doesNotMatch(sd.split("**Gone:**")[1].split("\n>\n")[0], /Book/);
  assert.match(sd, /Book actions[^\n]*5 Nov 2025/);
  assert.match(read("sitemaps-robots.md").split("### MAP-07 ·")[1].split("\n### ")[0], /note/);
});

test("every indexable page is checked for a language, not only the home page", async () => {
  const r = await crawlSite({ ...two(), "/about/": two()["/about/"].replace(' lang="en"', "") });
  assert.deepEqual(pathsOf(r, "lang-missing"), ["/about/"]);
});

test("<base href> is used to resolve links, canonicals and images", async () => {
  const images = [];
  const r = await crawlSite(
    site({
      "/": ["Boiler Repairs and Servicing in Leeds", "", '<a href="/guides/boilers/">Boiler guide</a>'],
      "/guides/boilers/": [
        "Boiler Buying Guide for Leeds",
        '<base href="/guides/"><link rel="canonical" href="boilers/"><meta property="og:image" content="og.png">',
        '<a href="radiators/">Radiator guide</a>',
      ],
      "/guides/radiators/": [
        "Radiator Buying Guide for Leeds",
        '<link rel="canonical" href="https://site.example/guides/radiators/">',
      ],
    }),
    {
      before: req => {
        if (/og\.png$/.test(req.url)) images.push(req.url);
      },
    },
  );
  assert.ok(!findingOf(r, "broken-internal-link"), JSON.stringify(findingOf(r, "broken-internal-link")?.evidence));
  assert.ok(!pathsOf(r, "canonical-not-self").includes("/guides/boilers/"));
  assert.equal(new URL(r.pages.find(p => pathOf(r)(p) === "/guides/boilers/").canonical).pathname, "/guides/boilers/");
  assert.deepEqual(images, ["/guides/og.png"]);
});

test("every offer of a product needs shipping and returns, not just one", async () => {
  const full = {
    shippingDetails: { "@type": "OfferShippingDetails" },
    hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy" },
  };
  const product = offers =>
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Combi boiler", offers: offers.map(o => ({ "@type": "Offer", price: "20.00", priceCurrency: "GBP", ...o })) })}</script>`;
  const r = await crawlSite(
    site({
      "/": ["Boiler Repairs and Servicing in Leeds"],
      "/mixed/": ["Combi Boiler in Two Sizes", product([full, {}]), "<p>£20.00</p>"],
      "/complete/": ["Combi Boiler With Delivery", product([full, full]), "<p>£20.00</p>"],
    }),
  );
  for (const key of ["product-no-shipping", "product-no-returns"]) {
    assert.deepEqual(pathsOf(r, key), ["/mixed/"], key);
    assert.equal(findingOf(r, key).evidence[0].detail, "Combi boiler: 1 of 2 offer(s)");
  }
});

test("Content-Signal accepts Cloudflare's use= field", async () => {
  const robots = line => ({ files: { "/robots.txt": file("text/plain", `User-agent: *\n${line}\nAllow: /\n`) } });
  const [cf, bad] = await Promise.all([
    crawlSite(two(), robots("Content-Signal: search=yes, ai-train=no, use=reference")),
    crawlSite(two(), robots("Content-Signal: search=yes, use=maybe")),
  ]);
  assert.ok(
    !findingOf(cf, "content-signal-invalid"),
    JSON.stringify(findingOf(cf, "content-signal-invalid")?.evidence),
  );
  assert.equal(findingOf(bad, "content-signal-invalid")?.evidence[0].detail, "use=maybe");
});

test("Microdata and RDFa count as structured data, with a low note that only JSON-LD is validated", async () => {
  const r = await crawlSite(
    site({
      "/": ["Boiler Repairs and Servicing in Leeds"],
      "/micro/": [
        "Combi Boiler Microdata Page",
        "",
        '<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Combi boiler</span></div><ol itemscope itemtype="https://schema.org/BreadcrumbList"><li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem"><a itemprop="item" href="/"><span itemprop="name">Home</span></a></li></ol>',
      ],
      "/rdfa/": [
        "Northwind RDFa Business Page",
        "",
        '<div vocab="https://schema.org/" typeof="LocalBusiness"><span property="name">Northwind</span></div><ol vocab="https://schema.org/" typeof="BreadcrumbList"><li property="itemListElement" typeof="ListItem"><a property="item" typeof="WebPage" href="/"><span property="name">Home</span></a></li></ol>',
      ],
      "/plain/": [
        "Plain Page Without Any Markup",
        "",
        '<script>if (typeof window !== "undefined") document.title += "";</script><p data-typeof="x">No markup here</p>',
      ],
    }),
  );
  assert.deepEqual(pathsOf(r, "jsonld-none"), ["/", "/plain/"]);
  assert.deepEqual(pathsOf(r, "breadcrumb-missing"), ["/plain/"]);
  assert.deepEqual(pathsOf(r, "schema-not-jsonld"), ["/micro/", "/rdfa/"]);
  assert.deepEqual(
    [findingOf(r, "schema-not-jsonld").rule, findingOf(r, "schema-not-jsonld").severity],
    ["SCHEMA-01", "low"],
  );
  const other = p => r.pages.find(x => pathOf(r)(x) === p).schemaOther;
  assert.deepEqual(other("/micro/"), ["Product", "BreadcrumbList", "ListItem"]);
  assert.deepEqual(other("/rdfa/"), ["LocalBusiness", "BreadcrumbList", "ListItem", "WebPage"]);
  assert.deepEqual(other("/plain/"), []);
});

test("favicon: missing or broken is medium, small, oblong or SVG-only is low, a good one passes, one on another host isn't checked", async () => {
  const [none, broken, good, small, svg, cdn, oblong] = await Promise.all([
    crawlSite(two()),
    crawlSite(two('<link rel="icon" href="/missing.png">')),
    crawlSite(
      two('<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple.png">'),
      {
        files: {
          "/icon.svg": file("image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg'/>"),
          "/apple.png": { type: "image/png", body: png(180, 180) },
        },
      },
    ),
    crawlSite(two(), { files: { "/favicon.ico": { type: "image/x-icon", body: ico([16, 32]) } } }),
    crawlSite(two('<link rel="icon" href="/icon.svg">'), {
      files: { "/icon.svg": file("image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg'/>") },
    }),
    crawlSite(two('<link rel="shortcut icon" href="https://cdn.example.net/icon.png">')),
    crawlSite(two('<link rel="icon" href="/wide.png">'), {
      files: { "/wide.png": { type: "image/png", body: png(96, 48) } },
    }),
  ]);
  const fav = r =>
    r.findings.filter(f => /^favicon-/.test(f.check)).map(f => [f.check, f.rule, f.severity, f.evidence[0].detail]);
  assert.deepEqual(fav(oblong), [["favicon-unsuitable", "META-10", "low", "/wide.png: 96×48 px"]]);
  assert.deepEqual(fav(none), [
    ["favicon-missing", "META-10", "medium", "no icon link on the home page, and /favicon.ico → 404"],
  ]);
  assert.deepEqual(fav(broken), [["favicon-missing", "META-10", "medium", "/missing.png → 404; /favicon.ico → 404"]]);
  assert.deepEqual(fav(good), []);
  assert.ok(good.passed.some(p => p.rule === "META-10"));
  assert.deepEqual(fav(small), [["favicon-unsuitable", "META-10", "low", "/favicon.ico: 32×32 px"]]);
  assert.deepEqual(fav(svg), [["favicon-unsuitable", "META-10", "low", "/icon.svg: SVG"]]);
  assert.deepEqual(fav(cdn), []);
  assert.ok(!cdn.passed.some(p => p.rule === "META-10"));
  assert.match(cdn.notChecked.find(n => n.rule === "META-10")?.reason || "", /another host/);
});

test("render-blocking scripts in the head, and many stylesheets, are flagged; deferred, async, module and body scripts aren't", async () => {
  const css = n => Array.from({ length: n }, (_, i) => `<link rel="stylesheet" href="/s${i}.css">`).join("");
  const r = await crawlSite(
    site({
      "/": ["Boiler Repairs and Servicing in Leeds", `<script src="/js/jquery.js"></script>${css(2)}`],
      "/fine/": [
        "Deferred Scripts and Two Stylesheets",
        `<script src="/a.js" defer></script><script src="/b.js" async></script><script type="module" src="/c.js"></script><script src="/legacy.js" nomodule></script><script type="application/ld+json">{}</script><!--[if lt IE 9]><script src="/html5shiv.js"></script><![endif]-->${css(2)}<link rel="stylesheet" href="/print.css" media="print">`,
        '<script src="/late.js"></script>',
      ],
      "/css/": ["Six Stylesheets in the Head", css(6)],
    }),
  );
  assert.deepEqual(pathsOf(r, "render-blocking"), ["/", "/css/"]);
  const f = findingOf(r, "render-blocking"),
    d = Object.fromEntries(f.evidence.map(e => [new URL(e.url).pathname, e.detail]));
  assert.deepEqual([f.rule, f.severity], ["PERF-03", "low"]);
  assert.equal(d["/"], "1 script(s) without async or defer, e.g. /js/jquery.js");
  assert.equal(d["/css/"], "6 stylesheets");
});

test("a local business's schema phone and street address must show on the page or the home page", async () => {
  const biz = telephone =>
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Plumber", name: "Northwind Plumbing", telephone, address: { "@type": "PostalAddress", streetAddress: "12 Park Row", addressLocality: "Leeds" } })}</script>`;
  const r = await crawlSite(
    site({
      "/": ["Boiler Repairs and Servicing in Leeds", "", "<footer>Call us on (0113) 496-0000, any day.</footer>"],
      "/contact/": ["Contact Northwind Plumbing", biz("+44 113 496 0000"), "<p>Visit us at 12 Park Row, Leeds.</p>"],
      "/services/": ["Plumbing Services in Leeds", biz("+44 113 496 0000")],
      "/wrong/": ["Plumbing Prices in Leeds", biz("+44 113 496 9999"), "<p>12 Park Row</p>"],
    }),
  );
  assert.deepEqual(pathsOf(r, "nap-not-shown"), ["/services/", "/wrong/"]);
  const f = findingOf(r, "nap-not-shown"),
    d = Object.fromEntries(f.evidence.map(e => [new URL(e.url).pathname, e.detail]));
  assert.deepEqual([f.rule, f.severity], ["LOCAL-05", "medium"]);
  assert.equal(d["/services/"], "street address “12 Park Row” isn't shown on this page or the home page");
  assert.equal(d["/wrong/"], "phone “+44 113 496 9999” isn't shown on this page or the home page");
});
