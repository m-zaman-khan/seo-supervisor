import { test } from "node:test";
import assert from "node:assert/strict";
import { checkHreflang } from "../skills/seo-supervisor/scripts/checks/hreflang.mjs";

// Pages are crawled locally while their hreflang links use the public origin, as on a real pre-launch audit.
const LOCAL = "http://127.0.0.1:4000";
const page = (path, hreflang, extra = {}) => ({
  finalUrl: LOCAL + path,
  status: 200,
  noindex: false,
  canonicals: [],
  hreflang,
  ...extra,
});
const run = (pages, statuses = {}) => {
  const found = [];
  checkHreflang(pages, {
    add: (key, url, detail) => found.push({ key, url, detail }),
    canonicalFor: p => (p.canonicals[0] ? new URL(p.canonicals[0], p.finalUrl).href : null),
    statusOf: href => statuses[new URL(href).pathname],
    origin: "https://example.com",
  });
  return found;
};

test("a correct pair passes, with uppercase codes, relative and absolute hrefs and slash variants", () => {
  const en = page("/en/", [
    { lang: "en-GB", href: "https://example.com/en" },
    { lang: "es", href: "/es/" },
    { lang: "x-default", href: "/en/" },
  ]);
  const es = page("/es/", [
    { lang: "es", href: "https://example.com/es/" },
    { lang: "EN-GB", href: "../en/" },
    { lang: "x-default", href: "https://example.com/en/" },
  ]);
  assert.deepEqual(run([en, es]), []);
});

test("en-uk is an invalid code (the UK's region code is gb), and three-letter languages are invalid", () => {
  const found = run([
    page("/", [
      { lang: "en-uk", href: "/" },
      { lang: "eng", href: "/" },
      { lang: "x-default", href: "/" },
    ]),
  ]);
  assert.deepEqual(
    found.filter(f => f.key === "hreflang-invalid-code").map(f => f.detail),
    ["en-uk", "eng"],
  );
});

test("a missing return link is flagged on the page whose link isn't returned", () => {
  const en = page("/en/", [
    { lang: "en", href: "/en/" },
    { lang: "es", href: "/es/" },
    { lang: "x-default", href: "/en/" },
  ]);
  const es = page("/es/", [
    { lang: "es", href: "/es/" },
    { lang: "x-default", href: "/es/" },
  ]);
  const found = run([en, es]);
  assert.deepEqual(
    found.filter(f => f.key === "hreflang-no-return").map(f => new URL(f.url).pathname),
    ["/en/"],
  );
});

test("a page that doesn't list itself or an x-default is flagged", () => {
  const found = run([
    page("/en/", [{ lang: "es", href: "/es/" }]),
    page("/es/", [
      { lang: "es", href: "/es/" },
      { lang: "en", href: "/en/" },
      { lang: "x-default", href: "/en/" },
    ]),
  ]);
  assert.ok(found.some(f => f.key === "hreflang-no-self" && f.url.endsWith("/en/")));
  assert.ok(found.some(f => f.key === "hreflang-no-xdefault" && f.url.endsWith("/en/")));
});

test("hreflang pointing at a noindex, non-canonical or broken URL is flagged", () => {
  const en = page("/en/", [
    { lang: "en", href: "/en/" },
    { lang: "de", href: "/de/" },
    { lang: "fr", href: "/fr/" },
    { lang: "it", href: "/it/" },
    { lang: "x-default", href: "/en/" },
  ]);
  const back = [{ lang: "en", href: "/en/" }];
  const de = page("/de/", back, { noindex: true });
  const fr = page("/fr/", back, { canonicals: ["https://example.com/en/"] });
  const found = run([en, de, fr], { "/it/": 404 });
  assert.deepEqual(
    found
      .filter(f => f.key === "hreflang-bad-target")
      .map(f => f.detail.split(" ")[0])
      .sort(),
    ["de", "fr", "it"],
  );
});
