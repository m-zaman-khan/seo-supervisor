// @ts-check
// The render comparison, lazy-lcp against Chrome's LCP check, LCP discovery, Report-Only CSP, hreflang and HSTS.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECKS as RENDER_CHECKS,
  changesHead,
  changesText,
  compareRendered,
} from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { labLcpElement } from "../skills/seo-supervisor/scripts/checks/speed.mjs";
import { mediaData } from "../skills/seo-supervisor/scripts/checks/assets.mjs";
import { probeSite } from "../skills/seo-supervisor/scripts/checks/probes.mjs";
import { checkHreflang, otherSiteTargets } from "../skills/seo-supervisor/scripts/checks/hreflang.mjs";
import { CHECKS as TECH } from "../skills/seo-supervisor/scripts/checks/technical.mjs";
import { CHECKS as TLS } from "../skills/seo-supervisor/scripts/checks/tls.mjs";
import { CHECKS } from "../skills/seo-supervisor/scripts/crawl/catalog.mjs";
import { createFindings } from "../skills/seo-supervisor/scripts/lib/findings.mjs";

const doc = ({ title = "Boilers", body = "", ld = /** @type {string[]} */ ([]) } = {}) =>
  `<!doctype html><html><head><title>${title}</title>${ld.map(t => `<script type="application/ld+json">{"@context":"https://schema.org","@type":"${t}"}</script>`).join("")}</head><body>${body}</body></html>`;
const words = (prefix, n) =>
  Array.from(
    { length: n },
    (_, i) => `${prefix}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`,
  ).join(" ");

test("the render comparison names the schema types and words that appear only after JavaScript", () => {
  const swapped = compareRendered(doc({ ld: ["Organization"] }), doc({ ld: ["Product"] }));
  assert.deepEqual(
    swapped,
    [{ field: "jsonld-types", raw: "Organization", rendered: "Product" }],
    "a swapped type with the same count is caught",
  );
  assert.deepEqual(
    compareRendered(doc({ ld: ["Thing"] }), doc({ ld: ["Thing", "Thing"] })).map(x => x.field),
    ["jsonld-count"],
    "a repeated type is still a count",
  );
  assert.deepEqual(compareRendered(doc({ ld: ["Organization"] }), doc({ ld: ["Organization", "BreadcrumbList"] })), [
    { field: "jsonld-types", raw: "Organization", rendered: "BreadcrumbList" },
  ]);
  // Server text replaced by other text of the same length: the words that only JavaScript shows.
  const replaced = compareRendered(
    doc({ body: `<p>${words("old", 150)}</p>` }),
    doc({ body: `<p>${words("new", 150)}</p>` }),
  );
  assert.deepEqual(
    replaced.map(x => x.field),
    ["words"],
  );
  assert.match(String(replaced[0].rendered), /^150 words only after JavaScript, e\.g\. newaa, newba, newca/);
  assert.equal(replaced[0].raw, "150 words");
  assert.ok(
    !changesHead(replaced[0]) && !changesText(replaced[0]),
    "REND-01's render-adds-content, not a head or text change",
  );
  // A consent banner's few dozen words, and entities written differently, aren't "only after JavaScript".
  assert.deepEqual(
    compareRendered(
      doc({ body: `<p>${words("p", 300)}</p>` }),
      doc({ body: `<p>${words("p", 300)}</p><div>${words("cookie", 60)}</div>` }),
    ),
    [],
  );
  assert.deepEqual(
    compareRendered(doc({ body: "<p>Caf&eacute; &amp; bar</p>" }), doc({ body: "<p>Café &amp; bar</p>" })),
    [],
  );
  assert.deepEqual(
    compareRendered(doc({ body: `<script>var x = "${words("js", 200)}"</script>` }), doc({ body: "" })),
    [],
    "script text isn't page text",
  );
});

test("a title JavaScript sets or changes is the low render-changes-text; canonical and robots stay high", () => {
  const d = compareRendered(doc({ title: "Loading…" }), doc({ title: "Boiler repairs in Leeds" }));
  assert.deepEqual(d, [{ field: "title", raw: "Loading…", rendered: "Boiler repairs in Leeds" }]);
  assert.ok(changesText(d[0]) && !changesHead(d[0]));
  assert.ok(changesText({ field: "title", raw: null }), "a title only JavaScript sets is fine for Google too");
  assert.ok(["canonical", "robots"].every(field => changesHead({ field }) && !changesText({ field })));
  const [, sevHead, titleHead, whyHead, fixHead] = RENDER_CHECKS["render-changes-head"];
  assert.equal(sevHead, "high");
  assert.match(titleHead(2), /canonical or robots tag on 2 page/);
  assert.doesNotMatch(`${titleHead(2)} ${whyHead} ${fixHead}`, /\btitle\b/);
  const [, sevText, titleText, whyText] = RENDER_CHECKS["render-changes-text"];
  assert.equal(sevText, "low");
  assert.match(titleText(1), /title, meta description or H1/);
  assert.match(whyText, /title/);
});

// A Lighthouse 13 lab run whose LCP is an image, with Chrome's LCP request discovery checklist.
const lab = (src, { eager = true, discoverable = true } = {}) => ({
  "lcp-breakdown-insight": {
    details: { type: "list", items: [{ type: "node", nodeLabel: "Hero", snippet: `<img src="${src}">` }] },
  },
  "lcp-discovery-insight": {
    details: {
      type: "list",
      items: [
        {
          type: "checklist",
          items: {
            priorityHinted: { label: "a", value: true },
            requestDiscoverable: { label: "b", value: discoverable },
            eagerlyLoaded: { label: "c", value: eager },
          },
        },
      ],
    },
  },
});

test("the lab LCP element keeps Chrome's eagerlyLoaded and requestDiscoverable answers", () => {
  assert.deepEqual(labLcpElement(lab("/hero.jpg", { eager: false, discoverable: false })), {
    element: "Hero",
    src: "/hero.jpg",
    fetchpriorityHigh: true,
    eager: false,
    discoverable: false,
  });
  assert.deepEqual(
    labLcpElement({ "lcp-breakdown-insight": { details: { items: [{ type: "node", selector: "h1" }] } } }),
    { element: "h1" },
    "a text LCP has no checklist",
  );
});

test("lazy-lcp follows Chrome's LCP check where a lab run read the page; an LCP image only CSS or a script asks for is flagged", () => {
  const O = "https://e.example",
    { findings, add } = createFindings(CHECKS);
  // The crawler's first-image guesses: /a (wrong: the lab says its LCP image isn't lazy), /b (right), /c (no lab run).
  for (const p of ["/a", "/b", "/c"]) add("lazy-lcp", O + p, `${p}-logo.png`);
  const el = (path, o) => [O + path, labLcpElement(lab(`${path}.jpg`, o))];
  const speed = {
    samples: [el("/a", {}), el("/b", { eager: false })].map(([url, lcpElement]) => ({ url, lab: { lcpElement } })),
  };
  const lighthouse = [el("/d", { eager: false }), el("/e", { discoverable: false })].map(([url, lcpElement]) => ({
    url,
    lcpElement,
  }));
  const extra = /** @type {Record<string, any>} */ ({});
  mediaData(
    { htmlPages: [], add, extra, startOrigin: O, expectOrigin: O, indexable: () => true, findings },
    { speed, lighthouse, imageInfo: new Map() },
  );
  const lazy = findings.get("lazy-lcp");
  assert.deepEqual(
    lazy.evidence.map(e => e.url),
    [O + "/b", O + "/c", O + "/d"],
    "the wrong guess goes, the lab's own find is added",
  );
  assert.equal(lazy.count, 3);
  assert.match(lazy.evidence[2].detail, /\/d\.jpg.*Lighthouse.*loading="lazy"/);
  assert.deepEqual(findings.get("lcp-not-discoverable")?.evidence, [{ url: O + "/e", detail: "/e.jpg" }]);
  assert.ok(
    extra.media.heroImages.every(h => !("eager" in h) && !("discoverable" in h) && !("hinted" in h)),
    "the report's hero list is unchanged",
  );
  const [rule, severity] = CHECKS["lcp-not-discoverable"];
  assert.deepEqual([rule, severity], ["PERF-03", "low"]);
  // Only the guess the lab overruled goes: a store with that one guess ends up without the finding.
  const one = createFindings(CHECKS);
  one.add("lazy-lcp", O + "/a", "logo.png");
  mediaData(
    {
      htmlPages: [],
      add: one.add,
      extra: {},
      startOrigin: O,
      expectOrigin: O,
      indexable: () => true,
      findings: one.findings,
    },
    {
      speed: { samples: [{ url: O + "/a/", lab: { lcpElement: labLcpElement(lab("/a.jpg")) } }] },
      lighthouse: [],
      imageInfo: new Map(),
    },
  );
  assert.ok(!one.findings.has("lazy-lcp"), "slash variants are the same page");
});

test("a Report-Only CSP alone doesn't count as a Content-Security-Policy", async () => {
  const run = async headers => {
    const found = [],
      O = "http://127.0.0.1:9";
    await probeSite({
      start: new URL(O + "/"),
      startOrigin: O,
      expectOrigin: O,
      checkLive: false,
      ua: "test",
      home: {
        finalUrl: O + "/",
        headers: new Headers({
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "x-frame-options": "DENY",
          ...headers,
        }),
      },
      add: (key, url, detail) => found.push([key, detail]),
      evalRules: () => {},
      notes: [],
      follow: async () => ({ status: 404, chain: [] }),
      get: async () => ({ status: 404, body: "" }),
    });
    return found.filter(([k]) => k === "sec-headers").map(([, d]) => d);
  };
  const only = await run({ "content-security-policy-report-only": "script-src 'self'" });
  assert.equal(only.length, 1);
  assert.match(only[0], /^Content-Security-Policy \(only a Report-Only policy, which blocks nothing\)$/);
  assert.deepEqual(
    await run({
      "content-security-policy": "script-src 'self'",
      "content-security-policy-report-only": "script-src 'none'",
    }),
    [],
  );
  assert.deepEqual(await run({}), ["Content-Security-Policy"]);
});

test("hreflang to our own host over http:// or the other www host is our site at the wrong address, not another site", () => {
  const LOCAL = "http://127.0.0.1:4000",
    origin = "https://example.com";
  const page = (path, hreflang) => ({ finalUrl: LOCAL + path, status: 200, noindex: false, canonicals: [], hreflang });
  const en = page("/en/", [
    { lang: "en", href: "/en/" },
    { lang: "x-default", href: "/en/" },
    { lang: "de", href: "http://example.com/de/" },
    { lang: "fr", href: "https://www.example.com/fr/" },
    { lang: "es", href: "https://example.es/" },
  ]);
  const de = page("/de/", [
    { lang: "de", href: "/de/" },
    { lang: "en", href: "http://www.example.com/en/" },
    { lang: "x-default", href: "/en/" },
  ]);
  const fr = page("/fr/", [
    { lang: "fr", href: "/fr/" },
    { lang: "en", href: "/en/" },
    { lang: "x-default", href: "/en/" },
  ]);
  const found = [];
  checkHreflang([en, de, fr], {
    add: (key, url, detail) => found.push({ key, url, detail }),
    canonicalFor: () => null,
    statusOf: () => undefined,
    origin,
  });
  const bad = found.filter(f => f.key === "hreflang-bad-target");
  assert.deepEqual(
    bad.map(f => f.detail.split(" (")[0]),
    ["de → http://example.com/de/", "fr → https://www.example.com/fr/", "en → http://www.example.com/en/"],
  );
  assert.match(
    bad[0].detail,
    /\(this site at another address, http:\/\/example\.com; its pages are at https:\/\/example\.com\)$/,
  );
  assert.deepEqual(
    found.filter(f => f.key !== "hreflang-bad-target"),
    [],
    "no extra no-return or no-self for the same link",
  );
  assert.deepEqual(
    [...otherSiteTargets([en, de, fr], origin).keys()],
    ["https://example.es/"],
    "only real other sites are left for --hreflang-other-sites",
  );
});

test("the HSTS findings keep the HSTS advice without pushing the preload list", () => {
  const text = id => TECH[id].slice(2).join(" ");
  assert.doesNotMatch(text("hsts-short"), /hstspreload\.org asks|preload list (also )?requires/i);
  assert.match(text("hsts-short"), /preload list's minimum/);
  assert.match(text("hsts-short"), /in stages/);
  assert.doesNotMatch(text("hsts-no-subdomains"), /preload list.*requires/i);
  assert.match(text("hsts-no-subdomains"), /includeSubDomains/);
  assert.match(TLS["no-hsts"][4], /in stages/);
  for (const id of ["hsts-short", "hsts-no-subdomains", "hsts-invalid"])
    assert.doesNotMatch(text(id), /add `?preload|join the (preload )?list/i);
});
