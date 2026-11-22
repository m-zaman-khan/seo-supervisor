// Duplicate analytics IDs, leaked secret keys, CSS-hidden links, app link files, review and event markup, and PDFs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import {
  analyticsTwice,
  secretsIn,
  hiddenLinks,
  appPromo,
  appFile,
} from "../skills/seo-supervisor/scripts/checks/hygiene.mjs";
import { checkJsonLd, onlineOnly, otherReviewed } from "../skills/seo-supervisor/scripts/schema-check.mjs";

const ORIGIN = "https://site.example";
const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const ld = (...nodes) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": nodes })}</script>`;
const page = (title, { head = "", body = "", nav = "" } = {}) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><header><nav><a href="/">Home</a> <a href="/about/">About</a> <a href="/contact/">Contact</a> <a href="/hidden/">Radiators</a> <a href="/events/">Events</a>${nav}</nav></header><main><h1>${title}</h1><p>${COPY}</p>${body}</main><footer>Leeds Heating Ltd</footer></body></html>`;

// Joined at run time so secret scanners don't flag the source. The random part mixes cases and digits, as real keys do.
const STRIPE_SECRET = ["sk", "live", "51Hq" + "Zx9Kd2LmPq7Rt4Vw8YbN3Cf6Gj1Ae5"].join("_");
const STRIPE_RESTRICTED = ["rk", "live", "51Hq" + "Ab3Cd4Ef5Gh6Ij7Kl8Mn9Op0Qr1"].join("_");
const STRIPE_PUBLIC = ["pk", "live", "51Hq" + "Zx9Kd2LmPq7Rt4Vw8YbN3Cf6Gj1Ae5"].join("_");
const STRIPE_TEST = ["sk", "test", "4eC3" + "9HqLyjWDarjtT1zdp7dc"].join("_");
const GITHUB = "gh" + "p_" + "R8f2Kq9LmZ3xW7vT1bN6cY4dH0sJ5aE2gU8i";
const SLACK = ["xo" + "xb", "17653672481", "19874698323", "pdFZKVeTuE8sk7oOcBrzbqgy"].join("-");
const GOOGLE_BROWSER = "AI" + "za" + "SyD3x9Lq2Wm8Rt5Vb7Nc1Kp4Zj6Hf0Gs2Ae";
const PEM = (label, body) => `-----BEGIN ${label}-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END ${label}-----`;
const KEY_BODY = randomBytes(150).toString("base64");

// ---------- the same analytics ID twice ----------
const GA = id =>
  `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`;
const GTM = id =>
  `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');</script>`;
const GTM_BODY = id =>
  `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${id}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;

test("analyticsTwice: one GA4 ID set up in two scripts, or one Tag Manager container loaded twice; one of each is fine", () => {
  assert.deepEqual(analyticsTwice(GA("G-ABC1234567") + GA("G-ABC1234567")), ["G-ABC1234567 set up in 2 scripts"]);
  assert.deepEqual(analyticsTwice(GTM("GTM-K9X2PQ") + GTM_BODY("GTM-K9X2PQ") + GTM("GTM-K9X2PQ")), [
    "GTM-K9X2PQ loaded 2 times",
  ]);
  assert.deepEqual(
    analyticsTwice(
      `${GTM("GTM-K9X2PQ")}<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-K9X2PQ"></script>`,
    ),
    ["GTM-K9X2PQ loaded 2 times"],
    "the snippet plus a plain script tag",
  );
  for (const [why, html] of [
    ["one GA4 snippet", GA("G-ABC1234567")],
    ["two different IDs (a site and a roll-up property)", GA("G-ABC1234567") + GA("G-XYZ7654321")],
    ["Tag Manager's head and body parts", GTM("GTM-K9X2PQ") + GTM_BODY("GTM-K9X2PQ")],
    [
      "a second config call in the same script, for a route change",
      `<script>gtag('config','G-ABC1234567');function route(p){gtag('config','G-ABC1234567',{page_path:p});}</script>`,
    ],
    [
      "JSON data that mentions the ID",
      `${GA("G-ABC1234567")}<script type="application/json">{"ga":"gtag('config','G-ABC1234567')"}</script>`,
    ],
    ["a commented-out copy", `${GA("G-ABC1234567")}<!-- ${GA("G-ABC1234567")} -->`],
  ])
    assert.deepEqual(analyticsTwice(html), [], why);
});

// ---------- secret keys ----------
test("secretsIn: keys always secret are found and masked to their type and first characters; browser keys and examples aren't", () => {
  const found = secretsIn(
    `<script>const s = "${STRIPE_SECRET}", r = '${STRIPE_RESTRICTED}';</script><pre>${GITHUB}</pre><!-- ${SLACK} --><script>var k = \`${PEM("RSA PRIVATE KEY", KEY_BODY)}\`;</script>`,
  );
  assert.deepEqual(
    found.map(s => s.label),
    ["a private key", "a Stripe live secret key", "a Stripe live restricted key", "a GitHub token", "a Slack token"],
  );
  assert.deepEqual(
    found.map(s => s.shown),
    ["BEGIN RSA PRIVATE KEY", "sk_live_51Hq…", "rk_live_51Hq…", "ghp_R8f2…", "xoxb-1765…"],
  );
  for (const s of found) assert.ok(s.raw.length > 20, "the raw key stays in memory only, for scrubbing");
  assert.deepEqual(
    secretsIn(PEM("PRIVATE KEY", KEY_BODY).replace(/\n/g, "\\n")).map(s => s.shown),
    ["BEGIN PRIVATE KEY"],
    "a key in a JS string with \\n escapes",
  );
  for (const [why, html] of [
    [
      "a Google browser key (Firebase web config)",
      `<script>firebase.initializeApp({ apiKey: "${GOOGLE_BROWSER}", authDomain: "site.firebaseapp.com" });</script>`,
    ],
    ["a Stripe publishable key", `<script>Stripe("${STRIPE_PUBLIC}")</script>`],
    ["a Stripe test key, as tutorials show", `<code>${STRIPE_TEST}</code>`],
    [
      "placeholders",
      `<code>${["sk", "live", "x".repeat(24)].join("_")}</code> <code>${"gh" + "p_" + "X".repeat(36)}</code> <code>sk_live_YOUR_SECRET_KEY</code>`,
    ],
    ["a public key", PEM("PUBLIC KEY", KEY_BODY)],
    ["a private key example with its body left out", PEM("PRIVATE KEY", "MIIEvQIBADANBg...")],
    ["a word that only starts like a prefix", "<p>Ask the ghp_ team or the sk_live_ desk.</p>"],
  ])
    assert.deepEqual(secretsIn(html), [], why);
});

// ---------- links hidden with CSS ----------
const LINKS = (n, host = "spam") =>
  Array.from({ length: n }, (_, i) => `<a href="https://${host}${i}.example/p">cheap ${i}</a>`).join(" ");
test("hiddenLinks: links in an element hidden by its own style; the topic of the page and visible links don't count", () => {
  assert.equal(hiddenLinks(`<div style="display:none">${LINKS(3)}</div>`).length, 3);
  assert.equal(
    hiddenLinks(
      `<div style="position:absolute; left:-9999px">${LINKS(2)}</div><span style="font-size:0">${LINKS(1)}</span>`,
    ).length,
    3,
  );
  assert.equal(
    hiddenLinks(`<a style="opacity:0" href="https://x.example/">.</a>`).length,
    1,
    "a link hidden by its own style",
  );
  assert.deepEqual(
    hiddenLinks(`<div style="display:none"><a href="/about/">About</a></div>`),
    [],
    "only absolute links, to be checked against the site's hosts",
  );
  for (const [why, html] of [
    [
      "visible links, whatever the topic",
      `<p>Best online casino bonuses and cheap pharmacy deals:</p>${LINKS(5, "casino")}`,
    ],
    ["a class-hidden menu", `<ul class="hidden">${LINKS(4)}</ul>`],
    ["opacity 0.5 and a small font", `<div style="opacity:0.5;font-size:0.8em">${LINKS(4)}</div>`],
    ["a little off-screen", `<div style="left:-20px">${LINKS(4)}</div>`],
  ])
    assert.deepEqual(hiddenLinks(html), [], why);
});

// ---------- app link files ----------
const ASSETLINKS = JSON.stringify([
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "com.example",
      sha256_cert_fingerprints: [
        "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5",
      ],
    },
  },
]);
const AASA = JSON.stringify({
  applinks: { details: [{ appIDs: ["ABCDE12345.com.example.app"], components: [{ "/": "/buy/*" }] }] },
});
test("appPromo and appFile: which app a page promotes, and whether its file is there and in the documented shape", () => {
  assert.deepEqual(
    appPromo('<a href="https://play.google.com/store/apps/details?id=com.example&amp;hl=en">Get it on Google Play</a>'),
    { android: true, ios: false },
  );
  assert.deepEqual(appPromo('<a href="https://apps.apple.com/gb/app/example/id123456789">App Store</a>'), {
    android: false,
    ios: true,
  });
  assert.deepEqual(
    appPromo(
      '<meta name="apple-itunes-app" content="app-id=123456789"><link rel="alternate" href="android-app://com.example/https/site.example/">',
    ),
    { android: true, ios: true },
  );
  assert.deepEqual(
    appPromo(
      '<a href="https://play.google.com/store/movies">Films</a><!-- <a href="https://apps.apple.com/app/id1">x</a> -->',
    ),
    { android: false, ios: false },
    "not an app page, and comments don't count",
  );
  const json = "application/json";
  assert.equal(appFile("android", { status: 200, type: json, body: ASSETLINKS }), null);
  assert.equal(
    appFile("ios", { status: 200, type: "application/octet-stream", body: AASA }),
    null,
    "Apple's guide names no content type",
  );
  assert.equal(
    appFile("ios", {
      status: 200,
      type: json,
      body: JSON.stringify({
        applinks: { apps: [], details: [{ appID: "ABCDE12345.com.example.app", paths: ["*"] }] },
      }),
    }),
    null,
    "the older appID form",
  );
  assert.deepEqual(appFile("android", { status: 404, type: "text/html", body: "" }), {
    missing: true,
    problem: "isn't there (404)",
  });
  assert.deepEqual(appFile("android", { status: 200, type: "text/html", body: "<!doctype html><title>Home</title>" }), {
    missing: true,
    problem: "isn't there: the server sends a web page instead",
  });
  assert.deepEqual(appFile("android", { status: 301, type: "", body: "" }), {
    missing: false,
    problem: "redirects (301); Android reads the file only when it's served directly",
  });
  assert.deepEqual(appFile("android", { status: 200, type: json, body: "[{relation: x}]" }), {
    missing: false,
    problem: "isn't valid JSON",
  });
  assert.deepEqual(appFile("android", { status: 200, type: "text/plain", body: ASSETLINKS }), {
    missing: false,
    problem: "is sent as text/plain; Android needs application/json",
  });
  assert.match(
    appFile("android", { status: 200, type: json, body: "[]" })?.problem ?? "",
    /no statement for an Android app/,
  );
  assert.match(
    appFile("ios", { status: 200, type: json, body: JSON.stringify({ webcredentials: { apps: ["A.b"] } }) })?.problem ??
      "",
    /no applinks details/,
  );
  assert.deepEqual(appFile("ios", { status: 503, type: "", body: "" }), { missing: false, problem: "answers 503" });
});

// ---------- Review and Event markup ----------
const REVIEW = (extra = {}) => ({
  "@type": "Review",
  author: { "@type": "Person", name: "Ana" },
  reviewRating: { "@type": "Rating", ratingValue: 4 },
  ...extra,
});
const PRODUCT = (review, extra = {}) => ({
  "@context": "https://schema.org",
  "@type": "Product",
  "@id": "https://site.example/kettle/#product",
  name: "Copper kettle",
  review,
  ...extra,
});
test("otherReviewed and onlineOnly: a nested review that names another item, and events with no real-world place", () => {
  assert.equal(
    otherReviewed(PRODUCT(), REVIEW({ itemReviewed: { "@type": "Product", name: "Steel kettle" } })),
    "Steel kettle",
  );
  assert.equal(
    otherReviewed(PRODUCT(), REVIEW({ itemReviewed: { "@id": "https://site.example/other/#product" } })),
    "https://site.example/other/#product",
  );
  for (const [why, r] of [
    ["no itemReviewed", REVIEW()],
    ["the same @id", REVIEW({ itemReviewed: { "@id": "https://site.example/kettle/#product", name: "Kettle" } })],
    ["the same name", REVIEW({ itemReviewed: { "@type": "Product", name: " copper  Kettle" } })],
    ["nothing to compare", REVIEW({ itemReviewed: { "@type": "Product" } })],
  ])
    assert.equal(otherReviewed(PRODUCT(), r), null, why);
  const ev = (mode, location) => ({
    "@type": "Event",
    name: "Talk",
    startDate: "2026-12-01T19:00:00+00:00",
    ...(mode ? { eventAttendanceMode: `https://schema.org/${mode}` } : {}),
    ...(location ? { location } : {}),
  });
  const ONLINE = { "@type": "VirtualLocation", url: "https://site.example/live/" },
    HALL = { "@type": "Place", name: "Town Hall", address: "1 High St, Leeds" };
  assert.ok(onlineOnly(ev("OnlineEventAttendanceMode", ONLINE)));
  assert.ok(onlineOnly(ev(null, ONLINE)), "only a VirtualLocation");
  assert.ok(onlineOnly(ev("OnlineEventAttendanceMode")), "online mode, no location");
  for (const [why, e] of [
    ["mixed", ev("MixedEventAttendanceMode", [ONLINE, HALL])],
    ["offline", ev("OfflineEventAttendanceMode", HALL)],
    ["a place, no mode", ev(null, HALL)],
    ["online mode with a real place too", ev("OnlineEventAttendanceMode", [ONLINE, HALL])],
    ["an address as text", ev(null, "1 High St, Leeds")],
  ])
    assert.ok(!onlineOnly(e), why);
});

test("schema-check warns on both: review-target-conflict (SCHEMA-01) and event-online (SCHEMA-05)", () => {
  const issues = o =>
    checkJsonLd(JSON.stringify(o)).filter(i => ["review-target-conflict", "event-online"].includes(i.check));
  const [r] = issues(
    PRODUCT(REVIEW({ itemReviewed: { "@type": "Product", name: "Steel kettle" } }), {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: 4,
        ratingCount: 2,
        itemReviewed: { "@type": "Product", name: "Copper kettle" },
      },
    }),
  );
  assert.deepEqual(
    [r.severity, r.rule, r.path, r.doc],
    [
      "warning",
      "SCHEMA-01",
      "$.review",
      "https://developers.google.com/search/docs/appearance/structured-data/review-snippet",
    ],
  );
  assert.match(r.message, /"Steel kettle"/);
  assert.equal(
    issues(PRODUCT(REVIEW({ itemReviewed: { "@type": "Product", name: "Steel kettle" } }))).length,
    1,
    "the aggregate rating naming its own item isn't flagged",
  );
  assert.deepEqual(
    issues({
      "@context": "https://schema.org",
      ...REVIEW({ itemReviewed: { "@type": "Product", name: "Steel kettle" } }),
    }),
    [],
    "a top-level review uses itemReviewed as Google asks",
  );
  const [e] = issues({
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: "Live stream",
    startDate: "2026-12-01T19:00:00+00:00",
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: { "@type": "VirtualLocation", url: "https://site.example/live/" },
  });
  assert.deepEqual(
    [e.severity, e.rule, e.doc],
    ["warning", "SCHEMA-05", "https://developers.google.com/search/docs/appearance/structured-data/event"],
  );
  assert.deepEqual(
    issues({
      "@context": "https://schema.org",
      "@type": "Event",
      name: "Gig",
      startDate: "2026-12-01T19:00:00+00:00",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: { "@type": "Place", name: "Hall", address: "1 High St" },
    }),
    [],
  );
});

// ---------- the crawl ----------
async function crawlSite(pages, files = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir, { files });
  let run;
  try {
    run = await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--site-origin", ORIGIN, "--out", out]);
  } finally {
    await site.close();
  }
  const text = readFileSync(out, "utf8");
  return {
    r: JSON.parse(text),
    text,
    words: readFileSync(out.replace(/\.json$/, ".words.json"), "utf8"),
    console: run.stdout + run.stderr,
  };
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const byPath = (r, check) =>
  Object.fromEntries((findingOf(r, check)?.evidence || []).map(e => [new URL(e.url).pathname, e.detail]));
const HYGIENE = ["analytics-tag-twice", "secret-key-exposed", "hidden-links", "review-target-conflict", "event-online"];

test("a clean site raises none of these checks: browser keys, one analytics snippet, visible links on a casino page", async () => {
  const { r } = await crawlSite({
    "/": page("Boiler repairs in Leeds", {
      head:
        GA("G-ABC1234567") +
        `<script>firebase.initializeApp({ apiKey: "${GOOGLE_BROWSER}" }); Stripe("${STRIPE_PUBLIC}");</script>`,
    }),
    "/about/": page("Casino and pharmacy partners", {
      head: GTM("GTM-K9X2PQ"),
      body: `<p>Our favourite online casino bonuses and pharmacy deals:</p>${LINKS(6, "casino")}<a href="/files/menu.pdf">Menu</a>`,
    }),
  });
  assert.equal(r.stats.htmlPages, 2, "both pages were read");
  for (const key of HYGIENE) assert.ok(!findingOf(r, key), key);
  assert.equal(r.appLinks, undefined, "no app promoted, so no app link files were asked for");
  assert.equal(r.pdfLinks, undefined, "a PDF linked from one page isn't listed");
});

test("the crawl finds each problem on its page, never writes the secret anywhere, and lists app files and PDFs as information", async () => {
  const pdfNav = '<a href="/files/menu.pdf">Menu (PDF)</a>';
  const {
    r,
    text,
    words,
    console: out,
  } = await crawlSite(
    {
      "/": page("Boiler repairs in Leeds", {
        head: GA("G-ABC1234567"),
        body: `${GA("G-ABC1234567")}<a href="https://play.google.com/store/apps/details?id=com.example">Get the app</a>`,
        nav: pdfNav,
      }),
      "/about/": page("About our engineers", {
        nav: pdfNav,
        body: '<meta name="apple-itunes-app" content="app-id=123456789"><a href="/files/prices.pdf">Prices</a>',
      }),
      "/contact/": page("Contact us", {
        nav: pdfNav,
        head: `<script>const stripe = "${STRIPE_SECRET}";</script>`,
        body: `<p>Debug token: <code>${GITHUB}</code></p><a href="/files/prices.pdf">Prices</a>`,
      }),
      "/hidden/": page("Radiators", {
        body: `<div style="display:none">${LINKS(3)}<a href="${ORIGIN}/about/">ours</a></div><a href="/files/prices.pdf">Prices</a>`,
      }),
      "/events/": page("Events", {
        head: ld(
          {
            "@type": "Event",
            name: "Boiler care webinar",
            startDate: "2026-12-01T19:00:00+00:00",
            eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
            location: { "@type": "VirtualLocation", url: `${ORIGIN}/live/` },
          },
          {
            "@type": "Product",
            name: "Copper kettle",
            review: REVIEW({ itemReviewed: { "@type": "Product", name: "Steel kettle" } }),
          },
        ),
      }),
    },
    { "/.well-known/assetlinks.json": { type: "application/json", body: Buffer.from("[{relation: broken}]") } },
  );

  assert.equal(r.stats.htmlPages, 5, "every page was read");
  const f = findingOf(r, "secret-key-exposed");
  assert.deepEqual([f.rule, f.severity, f.count], ["TRUST-01", "high", 1]);
  assert.deepEqual(byPath(r, "secret-key-exposed"), {
    "/contact/": "a Stripe live secret key (sk_live_51Hq…); a GitHub token (ghp_R8f2…)",
  });
  assert.match(f.fix, /revoke/i);
  for (const key of [STRIPE_SECRET, GITHUB, STRIPE_SECRET.slice(12), GITHUB.slice(8)]) {
    assert.ok(!text.includes(key), "the crawl JSON never holds the key");
    assert.ok(!words.toLowerCase().includes(key.toLowerCase()), "nor the words file");
    assert.ok(!out.includes(key), "nor the console");
  }

  assert.deepEqual(byPath(r, "analytics-tag-twice"), { "/": "G-ABC1234567 set up in 2 scripts" });
  assert.deepEqual(
    [findingOf(r, "analytics-tag-twice").rule, findingOf(r, "analytics-tag-twice").severity],
    ["LAUNCH-04", "low"],
  );
  assert.deepEqual(
    byPath(r, "hidden-links"),
    { "/hidden/": "3 hidden link(s) to other sites, e.g. https://spam0.example/p" },
    "the link to the site itself doesn't count",
  );
  assert.deepEqual([findingOf(r, "hidden-links").rule, findingOf(r, "hidden-links").severity], ["CONTENT-11", "low"]);
  assert.deepEqual(byPath(r, "event-online"), { "/events/": "“Boiler care webinar”" });
  assert.deepEqual([findingOf(r, "event-online").rule, findingOf(r, "event-online").severity], ["SCHEMA-05", "low"]);
  assert.deepEqual(byPath(r, "review-target-conflict"), {
    "/events/": "a review in “Copper kettle” names “Steel kettle”",
  });
  assert.deepEqual(
    [findingOf(r, "review-target-conflict").rule, findingOf(r, "review-target-conflict").severity],
    ["SCHEMA-01", "low"],
  );

  assert.deepEqual(r.appLinks, [
    {
      platform: "Android",
      file: "/.well-known/assetlinks.json",
      page: `${new URL(r.startUrl).origin}/`,
      missing: false,
      problem: "isn't valid JSON",
    },
    {
      platform: "iOS",
      file: "/.well-known/apple-app-site-association",
      page: `${new URL(r.startUrl).origin}/about/`,
      missing: true,
      problem: "isn't there (404)",
    },
  ]);
  assert.deepEqual(
    r.pdfLinks.pdfs.map(p => [new URL(p.url).pathname, p.pages, p.menu]),
    [
      ["/files/menu.pdf", 3, true],
      ["/files/prices.pdf", 3, false],
    ],
  );
  assert.equal(r.pdfLinks.count, 2);
});

// ---------- the report ----------
const renderReport = async data => {
  const dir = tmp();
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  return { html: readFileSync(join(dir, "a.html"), "utf8"), md: readFileSync(join(dir, "a.md"), "utf8") };
};

test("the report lists app link files and PDFs as information, escaped, and never changes the score", async () => {
  const evil = "<img src=x onerror=alert(1)>";
  const base = {
    site: { name: "Site", url: ORIGIN },
    run: { date: "2026-11-22" },
    findings: [],
    passed: [{ rule: "SCHEMA-01", title: "JSON-LD parses without errors", category: "Structured data" }],
  };
  const data = {
    ...base,
    appLinks: [
      {
        platform: "Android",
        file: "/.well-known/assetlinks.json",
        page: `${ORIGIN}/`,
        missing: false,
        problem: `isn't valid JSON ${evil}`,
      },
      {
        platform: "iOS",
        file: "/.well-known/apple-app-site-association",
        page: `${ORIGIN}/app/`,
        missing: true,
        problem: "isn't there (404)",
      },
    ],
    pdfLinks: { count: 1, pdfs: [{ url: `${ORIGIN}/files/menu${evil}.pdf`, pages: 4, menu: true }] },
  };
  const on = await renderReport(data),
    off = await renderReport(base);
  const panel = s =>
    s.match(/\n {4}<details class="how hygiene">[\s\S]*?<\/details>(?=\n|$)/)?.[0] ?? assert.fail("no hygiene panel");
  const tabOf = (h, id) =>
    h.slice(h.indexOf(`id="p-${id}"`), h.indexOf('<section class="tp"', h.indexOf(`id="p-${id}"`)));
  assert.ok(tabOf(on.html, "site-content").includes(panel(on.html)), "on the Site & content tab");
  for (const t of ["overview", "findings", "limits"])
    assert.equal(
      tabOf(on.html, t),
      tabOf(off.html, t),
      `only the panel is added: the score and areas are the same (${t})`,
    );
  assert.ok(!off.html.includes('class="how hygiene"') && !off.md.includes("App links and PDFs"));
  for (const s of [panel(on.html), on.md]) {
    assert.match(s, /assetlinks\.json/);
    assert.match(s, /fine if the app doesn(?:'|&#39;)t open/);
    assert.match(s, /Microsoft Advertising/);
    assert.match(s, /prices, a menu, specifications or opening hours/);
    assert.match(s, /Information only/);
  }
  assert.ok(!on.html.includes(evil) && !on.md.includes(evil), "crawled text is escaped");
});
