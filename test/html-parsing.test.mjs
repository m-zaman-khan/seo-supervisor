// @ts-check
import { test } from "node:test";
import assert from "node:assert/strict";
import { attrs, decode } from "../skills/seo-supervisor/scripts/lib/html.mjs";
import { analyze } from "../skills/seo-supervisor/scripts/crawl/page.mjs";
import { trustFeatures } from "../skills/seo-supervisor/scripts/checks/trust.mjs";
import { agentFeatures } from "../skills/seo-supervisor/scripts/checks/agents.mjs";
import { hintsOf } from "../skills/seo-supervisor/scripts/checks/media.mjs";
import { ugcLinks } from "../skills/seo-supervisor/scripts/checks/page.mjs";

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
