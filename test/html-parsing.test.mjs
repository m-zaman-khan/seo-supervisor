// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { attrs, decode } from "../skills/seo-supervisor/scripts/lib/html.mjs";
import { analyze, readLight } from "../skills/seo-supervisor/scripts/crawl/page.mjs";
import { readPage } from "../skills/seo-supervisor/scripts/checks/bots.mjs";
import { trustFeatures } from "../skills/seo-supervisor/scripts/checks/trust.mjs";
import { agentFeatures } from "../skills/seo-supervisor/scripts/checks/agents.mjs";
import { hintsOf } from "../skills/seo-supervisor/scripts/checks/media.mjs";
import { lateHead, ugcLinks } from "../skills/seo-supervisor/scripts/checks/page.mjs";

const ctx = {
  start: new URL("https://site.example/"),
  startOrigin: "https://site.example",
  banned: null,
  verify: null,
  toCrawl: u => u,
  sitemapHreflang: () => [],
};
const read = (html, url = "https://site.example/pricing/", headers = {}) =>
  analyze(url, html, new Headers({ "content-type": "text/html", ...headers }), null, ctx);
const page = (head, body = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

test("decode: numeric references, and the named ones titles use (HTML's named character references)", () => {
  assert.equal(
    decode("Pricing &ndash; Acme &mdash; it&rsquo;s &hellip; &copy; 2026 &trade;"),
    "Pricing – Acme — it’s … © 2026 ™",
  );
  assert.equal(
    decode("&Eacute;t&eacute; &agrave; Z&uuml;rich, &euro;5 &amp; &AMP; &lt;&gt; &quot;&apos;"),
    "Été à Zürich, €5 & & <> \"'",
    "names are case-sensitive; &AMP; is one too",
  );
  assert.equal(decode("&#8211; &#x2014; &#X41;"), "– — A");
  assert.equal(decode("a&nbsp;b"), "a b", "&nbsp; reads as a plain space");
  assert.equal(
    decode("&#x110000; &#99999999; &nosuch; & ;"),
    "&#x110000; &#99999999; &nosuch; & ;",
    "past U+10FFFF and unknown names stay as written, no error",
  );
});

test("a title with &ndash; is measured by its characters, not its entity text", () => {
  const rec = read(
    page(
      '<title>Pricing &ndash; Acme Plumbing &amp; Heating</title><meta name=description content="Fixed prices &mdash; no surprises">',
    ),
  );
  assert.equal(rec.title, "Pricing – Acme Plumbing & Heating");
  assert.equal(rec.title.length, 33);
  assert.equal(rec.description, "Fixed prices — no surprises");
});

test("attrs: the first of two same-named attributes wins, as in browsers, and values are decoded", () => {
  assert.deepEqual(attrs('<a href="/one" HREF="/two" title="x href=/three" data-x=\'&#169;\' hidden>'), {
    href: "/one",
    title: "x href=/three",
    "data-x": "©",
    hidden: "",
  });
  assert.equal(attrs("<a constructor=yes>").constructor, "yes", "a name Object.prototype has is still read");
  assert.deepEqual(
    attrs("<a href=/blog/>"),
    { href: "/blog/" },
    "an unquoted value keeps its last slash, as in browsers",
  );
  assert.deepEqual(attrs('<img src="/a.png"/>'), { src: "/a.png" });
  assert.deepEqual(attrs("<input disabled/>"), { disabled: "" });
});

test("the page modules read attributes alike: decoded, the first one wins, a value isn't taken for an attribute", () => {
  // The trust view's links (the about page here), comment links, preload hrefs and form controls.
  const html = page(
    '<link rel="preload" as="image" href="/hero.jpg?w=1&amp;h=2">',
    `<footer><a title="x href=/nope" href="/about-us/">Who we are</a></footer>
     <div id="comments" class="comments-area"><a href="https://spam.example/?a=1&#38;b=2" href="https://other.example/">x</a></div>
     <form><input type="text" aria-label="Your&#32;name"><input type="text" title="&nbsp;"></form>`,
  );
  assert.deepEqual(trustFeatures(html, "https://site.example/").about, ["/about-us/"]);
  assert.deepEqual(ugcLinks(html), ["https://spam.example/?a=1&b=2"]);
  assert.deepEqual(hintsOf(html).preloadHrefs, ["/hero.jpg?w=1&h=2"]);
  const a = agentFeatures(html);
  assert.equal(a.controls, 2);
  assert.deepEqual(a.unnamedFields, ['<input type="text">'], "a title of only &nbsp; is no name");
});

test("readLight: the title, canonical, Google's robots rules, words and hreflang, as analyze reads them", () => {
  const html = page(
    `<title>Prices &ndash; Acme</title><link rel=canonical href="/prices/"><link rel="alternate" hreflang="de" href="https://site.example/de/preise/"><meta name="googlebot" content="nofollow">`,
    `<main><h1>Prices</h1><p>Fixed prices for every repair, agreed before the work starts.</p></main><script>var x = "not words";</script>`,
  );
  const headers = {
    "x-robots-tag": "otherbot: noindex, googlebot: noarchive",
    link: '<https://site.example/fr/prix/>; rel="alternate"; hreflang="fr"',
  };
  const light = readLight(html, "https://site.example/prices/?a=1", new Headers(headers)),
    full = read(html, "https://site.example/prices/?a=1", headers);
  assert.deepEqual(light, {
    title: "Prices – Acme",
    canonical: "https://site.example/prices/",
    robots: ["nofollow", "noarchive"],
    words: full.words,
    hreflang: [
      { lang: "de", href: "https://site.example/de/preise/" },
      { lang: "fr", href: "https://site.example/fr/prix/" },
    ],
  });
  assert.equal(full.words, 11);
  assert.deepEqual([...full.metaRules, ...full.headerRules], light.robots);
  // readPage serves the bot comparison and hreflang on other sites; it reads only HTML pages that answered 200.
  const ctx2 = { ...ctx, sitemapHreflang: () => [{ lang: "es", href: "https://site.example/es/" }] };
  assert.deepEqual(
    readPage(
      { status: 200, ct: "text/html", body: html, finalUrl: "https://site.example/prices/", headers: new Headers() },
      ctx2,
    ).hreflang.map(h => h.lang),
    ["de", "es"],
  );
  assert.equal(
    readPage(
      { status: 404, ct: "text/html", body: html, finalUrl: "https://site.example/x/", headers: new Headers() },
      ctx2,
    ),
    null,
  );
});

// Google ends the head at the first element other than title, meta, link, script, style, base, noscript or template.
// https://developers.google.com/search/docs/crawling-indexing/valid-page-metadata
test("lateHead: the head ends at the first element the head can't hold, and canonical, robots and hreflang tags after it are late", () => {
  const tags =
    '<link rel="canonical" href="/x/"><meta name="robots" content="noindex"><link rel="alternate" hreflang="de" href="/de/">';
  assert.deepEqual(
    lateHead(`<html><head><title>T</title><img src="/pixel.gif">${tags}</head><body><p>x</p></body></html>`),
    ["canonical", "robots", "hreflang"],
  );
  assert.deepEqual(
    lateHead(
      `<html><head><title>T</title><iframe src="/tag"></iframe><meta name="description" content="d"></head><body></body></html>`,
    ),
    ["description"],
  );
  assert.deepEqual(
    lateHead(
      `<html><head><script>document.write("<img src=x>")</script><!-- <iframe> --><noscript><img src="/p.gif"></noscript><style>p{}</style><template><div></div></template><base href="/">${tags}</head><body></body></html>`,
    ),
    [],
    "what scripts, comments, noscript and templates hold doesn't end the head",
  );
  assert.deepEqual(
    lateHead(`<html><head><title>T</title></head><body>${tags}</body></html>`),
    ["canonical", "robots", "hreflang"],
    "after </head> too, hreflang included",
  );
  const rec = read(page(`<title>T</title><img src="/pixel.gif">${tags}`));
  assert.deepEqual(
    [rec.pageChecks.late, rec.pageChecks.lateAt],
    [["canonical", "robots", "hreflang"], "<img>"],
    "the crawl keeps the element that ended the head",
  );
  assert.equal(read(page("<title>T</title>", tags)).pageChecks.lateAt, null, "a tag in the body needs no such note");
});
