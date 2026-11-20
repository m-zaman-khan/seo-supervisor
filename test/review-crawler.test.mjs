// Crawler and check-module edge cases; the one that needs Chrome is in test/browser/review-crawler.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import tls from "node:tls";
import { compareRendered } from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { checkLive } from "../skills/seo-supervisor/scripts/checks/tls.mjs";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";

// No test here may open a TLS connection off this machine: checkLive's probes are stubbed (connect, oldTls, fetchFn).
const tlsConnect = tls.connect;
tls.connect = (opts, ...rest) => {
  if (opts?.host && !/^(localhost|127\.0\.0\.1|::1)$/.test(opts.host))
    throw new Error(`a test opened a TLS connection to ${opts.host}:${opts.port}`);
  return tlsConnect.call(tls, opts, ...rest);
};

const words =
  "This page has enough ordinary words in it to count as a real page with real content, not a thin placeholder, so the other checks can do their work on it without tripping over the length of the copy at all.";
// Write pages ({ "/path/": html }) to a temp folder, crawl it, and return the crawl JSON.
async function crawlPages(pages, extra = [], serveOpts) {
  const dir = tmp();
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir, serveOpts),
    out = join(tmp(), "crawl.json");
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://site.example",
      "--out",
      out,
      ...extra,
    ]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const has = (r, check, path) =>
  r.findings.some(f => f.check === check && (!path || f.evidence.some(e => new URL(e.url).pathname === path)));

test("render diff: entities and URL escaping that Chrome writes differently aren't changes", () => {
  const doc = (title, h1, canonical, links = 4) =>
    `<html><head><title>${title}</title><link rel="canonical" href="${canonical}"></head><body><h1>${h1}</h1>${'<a href="/x">x</a>'.repeat(links)}</body></html>`;
  assert.deepEqual(
    compareRendered(
      doc("Joe&#x27;s Pizza", "Caf&eacute; &amp; Bar", "https://e.com/a?x=1&y=2"),
      doc("Joe's Pizza", "Café &amp; Bar", "https://e.com/a?x=1&amp;y=2"),
    ),
    [],
  );
  assert.deepEqual(
    compareRendered(doc("About &#8211; My&nbsp;Site", "Hi", "/a"), doc("About – My Site", "Hi", "/a")),
    [],
    "WordPress title separator and a no-break space",
  );
  assert.deepEqual(
    compareRendered(doc("T", "H", "/a", 4), doc("T", "H", "/a", 7)),
    [],
    "a few links from a consent banner aren't 'many links'",
  );
  assert.deepEqual(
    compareRendered(doc("T", "H", "/a", 4), doc("T", "H", "/a", 20)).map(d => d.field),
    ["link-count"],
  );
});

test("a malformed og:url or canonical doesn't crash the crawl", async () => {
  const r = await crawlPages({
    "/": `<!doctype html><html><head><title>Broken template values | Brand</title><meta property="og:url" content="https://"><link rel="canonical" href="http://localhost:3000undefined/"></head><body><h1>Home</h1><p>${words}</p></body></html>`,
  });
  assert.ok(
    r.pages.some(p => new URL(p.url).pathname === "/"),
    "the page is crawled, not dropped as a server error",
  );
  assert.ok(!r.findings.some(f => f.check === "server-error"));
  assert.ok(
    r.findings.some(f => f.evidence.some(e => /not a valid URL/.test(e.detail || ""))),
    "the broken canonical is named",
  );
});

test("a one-page site with a starter title is a blocker too", async () => {
  const r = await crawlPages({
    "/": `<!doctype html><html><head><title>Create Next App</title></head><body><main><p>${words}</p></main></body></html>`,
  });
  assert.ok(r.findings.some(f => f.check === "title-missing-sitewide" && f.severity === "blocker"));
});

test("titles and canonicals streamed into the body (Next.js 15.2+) are read", async () => {
  const r = await crawlPages({
    "/": `<!doctype html><html><head><meta charset="utf-8"></head><body><main><h1>Home</h1><p>${words}</p></main><title>Streamed title for the home page</title><link rel="canonical" href="https://site.example/"><meta name="description" content="A description that arrived late in the body, as streamed metadata does on dynamic routes in newer Next.js versions."></body></html>`,
  });
  for (const key of [
    "title-missing",
    "title-missing-sitewide",
    "canonical-missing",
    "canonical-missing-sitewide",
    "desc-missing",
  ])
    assert.ok(!has(r, key), key);
});

test("product prices in other formats, superscript cents and variant prices aren't mismatches", async () => {
  const product = (offers, shown) =>
    `<!doctype html><html><head><title>A product for the price test | Shop</title><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "P", offers })}</script></head><body><main><h1>P</h1><p>${shown}</p><p>${words}</p></main></body></html>`;
  const offer = price => ({
    "@type": "Offer",
    price,
    priceCurrency: "EUR",
    shippingDetails: {},
    hasMerchantReturnPolicy: {},
  });
  const r = await crawlPages({
    "/": `<!doctype html><html><head><title>Shop home for the price test</title></head><body><main><h1>Shop</h1><p>${words}</p><a href="/fr/">fr</a> <a href="/sup/">sup</a> <a href="/variant/">variant</a> <a href="/wrong/">wrong</a></main></body></html>`,
    "/fr/": product(offer("1299.00"), "Prix : 1 299,00 €"),
    "/sup/": product(offer("49.99"), "$49<sup>99</sup> with 30-day returns"),
    "/variant/": product([offer("10.00"), offer("20.00")], "Large: $20.00"),
    "/wrong/": product(offer("19.99"), "Now only $24.99"),
  });
  for (const p of ["/fr/", "/sup/", "/variant/"]) assert.ok(!has(r, "product-price-mismatch", p), p);
  assert.ok(has(r, "product-price-mismatch", "/wrong/"), "a real mismatch is still caught");
});

test("rules count as passed only when the crawler measured something", async () => {
  const r = await crawlPages({
    "/": `<!doctype html><html><head><title>A page with no images at all</title></head><body><main><h1>Home</h1><p>${words}</p></main></body></html>`,
  });
  const passed = new Set(r.passed.map(p => p.rule));
  assert.ok(!passed.has("PERF-08"), "no image was weighed");
  assert.ok(!passed.has("AI-05"), "the site doesn't negotiate Markdown, so the code check decides AI-05");
});

test("outside checks never send private-network URLs to PageSpeed", async () => {
  const hits = [];
  const psi = createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(500).end();
  });
  await new Promise(ok => psi.listen(0, "127.0.0.1", ok));
  try {
    const dir = tmp();
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><head><title>Staging home page title</title></head><body><h1>Home</h1><p>${words}</p></body></html>`,
    );
    const site = await serve(dir),
      out = join(tmp(), "crawl.json");
    try {
      await node(
        [
          join(SCRIPTS, "seo-crawl.mjs"),
          "--url",
          site.url,
          "--site-origin",
          "http://192.168.1.20:3000",
          "--outside",
          "--psi-endpoint",
          `http://127.0.0.1:${psi.address().port}/r`,
          "--out",
          out,
        ],
        { env: { ...process.env, CHROME_PATH: process.execPath } },
      );
    } finally {
      await site.close();
    }
    assert.equal(hits.length, 0);
  } finally {
    await new Promise(ok => psi.close(ok));
  }
});

test("live checks: subdomain sites aren't probed for www, and an expired certificate is one blocker", async () => {
  const DAY = 864e5,
    NOW = Date.now(),
    calls = [];
  const cert = (left, authorized, san) => ({
    authorized,
    authorizationError: authorized ? null : "CERT_HAS_EXPIRED",
    valid_from: new Date(NOW - 80 * DAY).toUTCString(),
    valid_to: new Date(NOW + left * DAY).toUTCString(),
    subjectaltname: san,
  });
  const ok = async () =>
    new Response("", { status: 301, headers: { location: "https://x/", "strict-transport-security": "max-age=1" } });
  const found = [],
    oldTls = async () => [];
  await checkLive("https://user.github.io", {
    add: k => found.push(k),
    now: NOW,
    connect: async h => (calls.push(h), cert(60, true, "DNS:*.github.io, DNS:github.io")),
    oldTls,
    fetchFn: ok,
  });
  assert.deepEqual(calls, ["user.github.io"], "www.user.github.io isn't a real host to check");
  assert.ok(!found.includes("cert-host-mismatch"));
  const expired = [];
  await checkLive("https://example.com", {
    add: k => expired.push(k),
    now: NOW,
    connect: async () => cert(-1, false, "DNS:example.com, DNS:www.example.com"),
    oldTls,
    fetchFn: ok,
  });
  assert.deepEqual(
    expired.filter(k => k.startsWith("cert-")),
    ["cert-expired"],
  );
});

test("render diff skips a page whose raw HTML couldn't be fetched again", async () => {
  // Every second request from the crawler to /flaky/ fails, so the re-fetch for the render diff gets a 500.
  let n = 0;
  const pages = {
    "/": `<!doctype html><html><head><title>Home page for the flaky test</title></head><body><main><h1>Home</h1><p>${words}</p><a href="/flaky/">flaky</a></main></body></html>`,
    "/flaky/": `<!doctype html><html><head><title>A page that fails on the second fetch</title></head><body><main><h1>Flaky</h1><p>${words}</p></main></body></html>`,
  };
  const dir = tmp();
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  const site = await serve(dir, {
    before: (req, res) => {
      if (req.url === "/flaky/" && /seo-supervisor-crawler/.test(req.headers["user-agent"] || "") && ++n === 2) {
        res.writeHead(500).end("error");
        return true;
      }
    },
  });
  const out = join(tmp(), "crawl.json");
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://site.example",
      "--outside",
      "--psi-endpoint",
      "http://127.0.0.1:9/r",
      "--out",
      out,
    ]);
  } finally {
    await site.close();
  }
  const r = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(!r.findings.some(f => f.check.startsWith("render-") && f.evidence.some(e => e.url.endsWith("/flaky/"))));
});
