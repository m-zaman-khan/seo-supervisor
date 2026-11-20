import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import {
  checkHreflang,
  checkLanguages,
  linkHreflang,
  mergeHreflang,
} from "../skills/seo-supervisor/scripts/checks/hreflang.mjs";

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

// ---------- language checks over the crawl ----------
// Pages ({ "/path/": html }) crawled as https://example.com; sitemap: the <url> entries of /sitemap.xml, listed in
// robots.txt.
async function crawl(pages, { sitemap, headers } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(
    join(dir, "robots.txt"),
    `User-agent: *\nAllow: /\n${sitemap ? "Sitemap: https://example.com/sitemap.xml\n" : ""}`,
  );
  const files = sitemap
    ? {
        "/sitemap.xml": {
          type: "application/xml",
          body: Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${sitemap}</urlset>`,
          ),
        },
      }
    : {};
  const site = await serve(dir, { files, headers });
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
const html = (lang, title, body = "", head = "") =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><main><h1>${title}</h1>${body}</main></body></html>`;
const tags = (...pairs) =>
  pairs.map(([lang, path]) => `<link rel="alternate" hreflang="${lang}" href="https://example.com${path}">`).join("");
const xlinks = (...pairs) =>
  pairs
    .map(([lang, path]) => `<xhtml:link rel="alternate" hreflang="${lang}" href="https://example.com${path}"/>`)
    .join("");
const LANGS = [
  ["en", "/en/"],
  ["de", "/de/"],
  ["es", "/es/"],
  ["x-default", "/en/"],
];
const EN =
  "<p>Our team repairs boilers and heating systems across the region. We answer calls within two hours, carry common parts in every van, and explain each repair before any work starts. Every job comes with a written guarantee and a clear price agreed in advance. Book a visit online or call the office during working hours to speak with an engineer today.</p>";
const DE =
  "<p>Unser Team repariert Heizkessel und Heizungsanlagen in der ganzen Region. Wir melden uns innerhalb von zwei Stunden, haben gängige Ersatzteile in jedem Wagen und erklären jede Reparatur, bevor die Arbeit beginnt. Jeder Auftrag kommt mit einer schriftlichen Garantie und einem klaren Preis, der vorher vereinbart wird. Buchen Sie online einen Termin oder rufen Sie während der Bürozeiten an.</p>";
const ES =
  "<p>Nuestro equipo repara calderas y sistemas de calefacción en toda la región. Respondemos en dos horas, llevamos piezas comunes en cada furgoneta y explicamos cada reparación antes de empezar. Cada trabajo incluye una garantía por escrito y un precio claro acordado de antemano. Reserve una visita en línea o llame a la oficina en horario laboral para hablar con un técnico.</p>";
const webPage = lang =>
  `<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","inLanguage":"${lang}"}</script>`;
const NEW_CHECKS = [
  "hreflang-sources-disagree",
  "hreflang-missing-version",
  "lang-hreflang-mismatch",
  "untranslated-copy",
  "lang-invalid",
  "translate-widget",
  "inlanguage-mismatch",
];
const evidence = (report, key) => report.findings.find(f => f.check === key)?.evidence || [];
const paths = (report, key) => evidence(report, key).map(e => new URL(e.url).pathname);

// A properly translated site: English, German and Spanish, each version's hreflang in one of the three places Google
// reads it (the HTML, the Link header, the sitemap), the English one in two that agree. /about/'s sitemap entry adds a
// French version its HTML doesn't list.
let goodRun;
const good = () =>
  (goodRun ||= crawl(
    {
      "/": html(
        "en",
        "Boiler repair and heating service",
        '<a href="/en/">English</a> <a href="/de/">Deutsch</a> <a href="/es/">Español</a> <a href="/about/">About</a>',
      ),
      "/en/": html("en-GB", "Boiler repair across the region", EN, tags(...LANGS) + webPage("en-GB")),
      "/de/": html("de-DE", "Heizungsreparatur in der Region", DE, webPage("de-DE")),
      "/es/": html("es", "Reparación de calderas en la región", ES),
      "/about/": html(
        "en",
        "About the heating engineers",
        EN.replace("Our team", "The about page: our team"),
        tags(["en", "/about/"], ["x-default", "/about/"]),
      ),
    },
    {
      headers: {
        "/de/": {
          Link: `<https://example.com/style.css>; rel=preload; as=style, ${LANGS.map(([l, p]) => `<https://example.com${p}>; rel="alternate"; hreflang="${l}"`).join(", ")}`,
        },
      },
      sitemap: [
        `<url><loc>https://example.com/en/</loc>${xlinks(...LANGS)}</url>`,
        `<url><loc>https://example.com/es/</loc>${xlinks(...LANGS)}</url>`,
        `<url><loc>https://example.com/about/</loc>${xlinks(["en", "/about/"], ["x-default", "/about/"], ["fr", "/fr/about/"])}</url>`,
      ].join(""),
    },
  ));

test("an HTTP Link header's hreflang alternates are read, other links skipped", () => {
  assert.deepEqual(
    linkHreflang(
      '<https://example.com/a.css>; rel=preload; as=style, <https://example.com/de/>; rel="alternate"; hreflang="de", </fr/>;rel=alternate;hreflang=fr',
    ),
    [
      { lang: "de", href: "https://example.com/de/" },
      { lang: "fr", href: "/fr/" },
    ],
  );
  assert.deepEqual(linkHreflang(null), []);
});

test("hreflang from the Link header and the sitemap is merged with the page's; a source listing less isn't a conflict", async () => {
  const report = await good();
  // /de/ has hreflang only in its Link header and /es/ only in the sitemap: unmerged, /en/ would have no return links.
  for (const key of ["hreflang-no-return", "hreflang-no-self", "hreflang-no-xdefault", "hreflang-missing-version"])
    assert.deepEqual(paths(report, key), [], key);
  assert.deepEqual(
    paths(report, "hreflang-sources-disagree"),
    [],
    "/about/'s sitemap adds fr, which Google combines with the HTML's",
  );
});

test("hreflang sources conflict when a code has another URL or a URL another language, not when one lists less", () => {
  const list = (...pairs) => pairs.map(([lang, path]) => ({ lang, href: `https://example.com${path}` }));
  const conflict = (html, header) =>
    mergeHreflang({ html, header, sitemap: [] }, "https://example.com/en/").hreflangDisagree;
  assert.equal(
    conflict(list(["en", "/en/"], ["de", "/de/"], ["x-default", "/en/"]), list(["en", "/en/"], ["de", "/de/"])),
    null,
  );
  assert.equal(
    conflict(list(["en", "/en/"], ["de", "/de/"], ["de-AT", "/de/"]), list(["de-AT", "/de/"])),
    null,
    "the same URL under a second code the other source lists too",
  );
  assert.equal(conflict(list(["x-default", "/en/"]), list(["en", "/en/"])), null, "x-default shares a version's URL");
  assert.equal(
    conflict(list(["en", "/en/"], ["de", "/de/"]), list(["en", "/en/"], ["de", "/de-de/"])),
    "the HTML lists de → https://example.com/de/, the Link header lists de → https://example.com/de-de/",
  );
  assert.equal(
    conflict(list(["en", "/en/"], ["de", "/de/"]), list(["en", "/en/"], ["fr", "/de/"])),
    "the HTML lists de → https://example.com/de/, the Link header lists fr → https://example.com/de/",
  );
  assert.equal(
    mergeHreflang(
      { html: list(["en", "/en/"]), header: list(["en", "/en/"], ["de", "/de/"]) },
      "https://example.com/en/",
    ).hreflang.length,
    2,
    "merged once each",
  );
});

test("a language version missing from a cluster is flagged; a complete cluster isn't", () => {
  const versions = d => [
    { lang: "en-GB", href: `/en/${d}/` },
    { lang: "de", href: `/de/${d}/` },
    { lang: "fr", href: `/fr/${d}/` },
    { lang: "x-default", href: `/en/${d}/` },
  ];
  const pages = [
    page("/en/a/", versions("a"), { lang: "en" }),
    page("/de/a/", versions("a"), { lang: "de-DE" }),
    page("/fr/a/", versions("a"), { lang: "FR" }),
    page(
      "/en/b/",
      versions("b").filter(h => h.lang !== "fr"),
      { lang: "en" },
    ),
    page("/de/b/", versions("b"), { lang: "de" }),
    page("/fr/b/", versions("b"), { lang: "en" }),
  ];
  const found = [];
  checkLanguages(pages, {
    add: (key, url, detail) => found.push({ key, path: new URL(url).pathname, detail }),
    origin: "https://example.com",
  });
  assert.deepEqual(
    found.map(f => [f.key, f.path]),
    [
      ["hreflang-missing-version", "/en/b/"],
      ["lang-hreflang-mismatch", "/fr/b/"],
    ].sort((a, b) => (a[1] < b[1] ? -1 : 1)),
  );
  assert.match(
    found.find(f => f.key === "hreflang-missing-version").detail,
    /^fr → \/fr\/b\/ \(listed by .*\/de\/b\/\)$/,
  );
  assert.match(found.find(f => f.key === "lang-hreflang-mismatch").detail, /lang="en".*fr/);
});

const languages = pages => {
  const found = [];
  checkLanguages(pages, {
    add: (key, url, detail) => found.push({ key, path: new URL(url).pathname, detail }),
    origin: "https://example.com",
  });
  return found;
};

test("a version that isn't published isn't asked for; a crawled, indexable one or one on another site is", () => {
  const en = page(
    "/en/post",
    [
      { lang: "en", href: "/en/post" },
      { lang: "de", href: "/de/post" },
      { lang: "fr", href: "/fr/post" },
    ],
    { lang: "en" },
  );
  const de = page(
    "/de/post",
    [
      { lang: "en", href: "/en/post" },
      { lang: "de", href: "/de/post" },
    ],
    { lang: "de" },
  );
  assert.deepEqual(languages([en, de]), [], "/fr/post is a 404, so it isn't among the crawled pages");
  const found = languages([en, de, page("/fr/post", en.hreflang, { lang: "fr" })]);
  assert.deepEqual(
    found.map(f => [f.key, f.path]),
    [["hreflang-missing-version", "/de/post"]],
  );
  assert.match(found[0].detail, /^fr → \/fr\/post \(listed by .*\/en\/post\)$/);
  // Another host can't be crawled, so its versions are taken as listed.
  en.hreflang[2].href = "https://example.fr/post";
  assert.deepEqual(
    languages([en, de]).map(f => [f.key, f.path]),
    [["hreflang-missing-version", "/de/post"]],
  );
});

test("a product name kept as the title isn't an untranslated copy; the same title with half the main text, or 80% of it, is", () => {
  // 5-word sets of the main text, as the crawler builds them; the English version of each pair has text(0, 100).
  const text = (from, to) => new Set(Array.from({ length: to - from }, (_, i) => `shingle ${from + i}`));
  const pairs = [
    ["p", "Samsung Galaxy S25 Ultra 512 GB | Samsung", text(100, 200)], // translated main text
    ["q", "Galaxy S25 Ultra phone case | Samsung", text(40, 140)], // 60%, under a title of four words once the model number and the brand are left out
    ["r", "Boiler repair and heating service in your area", text(40, 140)], // 60%, under a title of eight words
    ["s", "Boiler repair across the region", text(15, 115), "Heizungsreparatur in der Region"],
  ]; // 85%, under translated titles
  const found = languages([
    ...pairs.flatMap(([d, title, de, deTitle = title]) =>
      ["en", "de"].map(l =>
        page(
          `/${l}/${d}/`,
          [
            { lang: "en", href: `/en/${d}/` },
            { lang: "de", href: `/de/${d}/` },
          ],
          { lang: l, title: l === "en" ? title : deTitle, shingles: l === "en" ? text(0, 100) : de },
        ),
      ),
    ),
    // "Samsung" is in most of the site's titles, so it's a brand word.
    page("/en/", [], { lang: "en", title: "Phones, TVs and home appliances | Samsung" }),
    page("/de/", [], { lang: "de", title: "Handys, Fernseher und Haushaltsgeräte | Samsung" }),
  ]);
  assert.deepEqual(
    found.map(f => [f.key, f.path]),
    [
      ["untranslated-copy", "/de/r/"],
      ["untranslated-copy", "/de/s/"],
    ],
  );
  assert.match(
    found[0].detail,
    /\/de\/r\/ \(de\) and .*\/en\/r\/ \(en\) have the same title “Boiler repair and heating service in your area” and share 60% of their main text$/,
  );
  assert.match(found[1].detail, /\(en\) share 85% of their main text$/);
});

test("a Translate widget is flagged on a one-language site, not on one with real language versions without hreflang", () => {
  const widget = (path, lang) => page(path, [], { lang, translateWidget: true });
  assert.deepEqual(
    languages([widget("/", "en"), widget("/about/", "en-GB"), page("/contact/", [], {})]).map(f => [f.key, f.path]),
    [["translate-widget", "/"]],
  );
  assert.deepEqual(
    languages([widget("/", "en"), widget("/de/", "de"), widget("/fr/", "fr")]),
    [],
    "/de/ and /fr/ are real language versions",
  );
});

test("untranslated copies, lang=auto, a Translate widget and inLanguage mismatches are flagged; a properly translated pair isn't", async () => {
  const TITLE = "Boiler repair and heating service in your area";
  const WIDGET =
    '<div id="google_translate_element"></div><script src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>';
  const [bad, widget, ok] = await Promise.all([
    crawl({
      "/": html(
        "en",
        "Heating engineers for the whole region",
        '<a href="/en/">English</a> <a href="/de/">Deutsch</a> <a href="/auto/">Auto</a> <a href="/schema/">Schema</a>',
      ),
      "/en/": html("en", TITLE, EN + WIDGET, tags(["en", "/en/"], ["de", "/de/"], ["x-default", "/en/"])),
      "/de/": html("de", TITLE, EN, tags(["en", "/en/"], ["de", "/de/"], ["x-default", "/en/"])),
      "/auto/": html("auto", "A page whose language is left to the browser"),
      "/schema/": html("en", "A page whose schema names another language", "", webPage("de")),
    }),
    crawl({
      "/": html("en", "Heating engineers for the whole region", WIDGET + '<a href="/about/">About</a>'),
      "/about/": html("en", "About the heating engineers", "", "<style>.goog-te-banner-frame{display:none}</style>"),
    }),
    good(),
  ]);
  assert.deepEqual(paths(bad, "untranslated-copy"), ["/de/"]);
  assert.match(
    evidence(bad, "untranslated-copy")[0].detail,
    /\/de\/ \(de\) and .*\/en\/ \(en\) have the same title “Boiler repair.*” and share 100% of their main text/,
  );
  assert.deepEqual(paths(bad, "lang-invalid"), ["/auto/"]);
  assert.deepEqual(paths(bad, "inlanguage-mismatch"), ["/schema/"]);
  assert.match(evidence(bad, "inlanguage-mismatch")[0].detail, /lang="en".*inLanguage "de"/);
  assert.deepEqual(paths(bad, "translate-widget"), [], "the site has real language versions as well");
  assert.equal(evidence(widget, "translate-widget").length, 1, "once for the site");
  assert.match(evidence(widget, "translate-widget")[0].detail, /2 page\(s\)/);
  for (const key of NEW_CHECKS)
    assert.deepEqual(paths(ok, key), [], `${key} stays quiet on a properly translated site`);
  assert.deepEqual(
    NEW_CHECKS.flatMap(k => paths(widget, k)),
    ["/"],
    "only the widget on the widget site",
  );
});
