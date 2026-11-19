// The Chrome tests are in test/browser/crawl.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { ROOT, SCRIPTS, node, tmp } from "./helpers.mjs";
import { imageSize } from "../skills/seo-supervisor/scripts/lib/image-size.mjs";

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

test("image sizes are read from PNG, JPEG, GIF and WebP headers", () => {
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
    "sitemap-priority-changefreq": "<priority> and <changefreq> in the sitemap",
    "og-image-small": "a 600 px wide share image (/og.png)",
    "og-image-broken": "an og:image that returns 404 (/about/)",
    "og-image-no-size": "og:image without og:image:width and og:image:height",
  };
  for (const [key, what] of Object.entries(plantedChecks)) assert.ok(byCheck.has(key), `missed ${key}: ${what}`);
  const paths = key => (byCheck.get(key)?.evidence || []).map(e => new URL(e.url).pathname);
  for (const key of ["doc-basics", "robots-conflict"])
    assert.ok(!paths(key).includes("/"), `the home page is fine for ${key}`);
  assert.deepEqual(paths("robots-conflict"), ["/conflict/"]);
  for (const rule of ["PERF-01", "REND-06"])
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
  for (const key of ["sitemap-lastmod-future", "sitemap-lastmod-invalid", "sitemap-priority-changefreq"]) {
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
