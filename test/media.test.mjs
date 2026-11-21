// Image checks and speed data: PageSpeed, CrUX, the LCP element, server response times and Lighthouse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { crc32 } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";
import { altProblem, lazySrc, domShape, hintsOf } from "../skills/seo-supervisor/scripts/checks/media.mjs";
import { imageMeta, imageSize } from "../skills/seo-supervisor/scripts/lib/image-size.mjs";
import { withAiLabel } from "../skills/seo-supervisor/scripts/images.mjs";
import { band, checkSpeed, labLcpElement, speedTrend } from "../skills/seo-supervisor/scripts/checks/speed.mjs";
import { checkLighthouse, medianScores, runLighthouse } from "../skills/seo-supervisor/scripts/checks/lighthouse.mjs";

const ORIGIN = "https://site.example";
const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const page = (title, body = "", head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;

// A JPEG of w × h px: SOI, a JFIF APP0, a baseline frame header, then zeros up to `size` bytes, then EOI.
const jpeg = (w, h, size = 2000) =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    Buffer.from([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.alloc(Math.max(0, size - 41)),
    Buffer.from([0xff, 0xd9]),
  ]);
const chunk = (type, data) => {
  const t = Buffer.from(type, "latin1"),
    len = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
const png = (w, h) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "latin1"),
    chunk("IHDR", ihdr),
    chunk("IDAT", Buffer.from([0x78, 1, 1, 0, 0, 0xff, 0xff, 0, 0, 0, 1])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
// PNG chunks as [type, data, crc ok].
const pngChunks = b => {
  const out = [];
  for (let i = 8; i + 12 <= b.length;) {
    const n = b.readUInt32BE(i),
      type = b.toString("latin1", i + 4, i + 8),
      data = b.subarray(i + 8, i + 8 + n);
    out.push([type, data, b.readUInt32BE(i + 8 + n) === crc32(b.subarray(i + 4, i + 8 + n))]);
    i += 12 + n;
  }
  return out;
};
const XMP = inner =>
  `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">${inner}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
const app1 = xmp => {
  const body = Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"), Buffer.from(xmp, "utf8")]),
    head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
};
const withApp1 = (j, xmp) => Buffer.concat([j.subarray(0, 20), app1(xmp), j.subarray(20)]);
const CREATOR = "<dc:creator><rdf:Seq><rdf:li>Ann Example</rdf:li></rdf:Seq></dc:creator>";
const DST = "http://cv.iptc.org/newscodes/digitalsourcetype/";

// ---------- pure helpers ----------

test("alt text that is a file name, a generic word, a keyword list or very long is flagged; real descriptions aren't", () => {
  assert.equal(altProblem("IMG_4032.jpg", "/a/IMG_4032.jpg"), "a file name");
  assert.equal(altProblem("DSC 0042", "/p.jpg"), "a file name");
  assert.equal(altProblem("hero-banner-2", "/img/hero-banner-2.webp"), "a file name");
  assert.equal(altProblem("Image", "/x.jpg"), "a generic word");
  assert.equal(altProblem("photo.", "/x.jpg"), "a generic word");
  assert.equal(
    altProblem("plumber, plumbing, leeds plumber, emergency plumber, boiler repair", "/x.jpg"),
    "a keyword list",
  );
  assert.equal(altProblem("A".repeat(151), "/x.jpg"), "over 150 characters");
  for (const ok of [
    "",
    "Engineer fitting a combi boiler in a Leeds kitchen",
    "Logo",
    "Team photo, Leeds office, 2026",
    "team",
  ])
    assert.equal(altProblem(ok, "/img/team.jpg"), null, ok);
});

test("a lazy loader's real file is found behind its placeholder", () => {
  const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  assert.equal(
    lazySrc({ src: "data:image/svg+xml,%3Csvg%3E", "data-src": "/hero.jpg", class: "perfmatters-lazy" }),
    "/hero.jpg",
    "Perfmatters",
  );
  assert.equal(lazySrc({ src: gif, "data-src": "/a.jpg", class: "lazyload" }), "/a.jpg", "EWWW, lazysizes");
  assert.equal(
    lazySrc({ src: "data:image/svg+xml,x", "data-lazy-src": "/b.jpg", "data-lazy-srcset": "/b.jpg 1x" }),
    "/b.jpg",
    "WP Rocket",
  );
  assert.equal(
    lazySrc({ "data-srcset": "/c-400.jpg 400w, /c-800.jpg 800w", class: "lazyload" }),
    "/c-400.jpg",
    "only a srcset",
  );
  assert.equal(
    lazySrc({ src: "/plugins/a3-lazy-load/lazy_placeholder.gif", "data-src": "/d.jpg", class: "lazy lazy-hidden" }),
    "/d.jpg",
    "a3 Lazy Load's placeholder file",
  );
  assert.equal(
    lazySrc({ src: "/real.jpg", "data-src": "/real-large.jpg" }),
    null,
    "a real src with a data-src isn't a lazy loader",
  );
  assert.equal(lazySrc({ src: "/real.jpg", loading: "lazy" }), null, "native lazy loading is lazy-lcp's own case");
});

test("depth and the widest element are read from the HTML, with end tags HTML lets you leave out", () => {
  const deep = domShape(`<body>${"<div>".repeat(40)}x${"</div>".repeat(40)}</body>`);
  assert.equal(deep.depth, 41, "body plus 40 divs");
  const wide = domShape(
    `<body><ul class="menu main">${"<li>item".repeat(70)}</ul><p>a<p>b<p>c<table>${"<tr><td>1<td>2".repeat(5)}</table></body>`,
  );
  assert.deepEqual(wide.widest, { tag: "ul.menu", children: 70 });
  assert.ok(wide.depth <= 5, `unclosed li, p, tr and td don't nest: ${wide.depth}`);
  const quiet = domShape(
    `<body><header><nav><a href="/">Home</a><img src="/a.png"><br></nav></header><main><svg><path d="M0"/><path d="M1"/></svg><script>for(;;)"<div><div>"</script></main></body>`,
  );
  assert.ok(quiet.depth <= 5 && quiet.widest.children <= 3, JSON.stringify(quiet));
});

test("image preloads count once per hero, and rel=prerender is found", () => {
  assert.deepEqual(
    hintsOf(
      `<link rel="preload" as="image" href="/a.jpg"><link rel=preload as=image imagesrcset="/b.jpg 1x, /b2.jpg 2x"><link rel="preload" as="font" href="/f.woff2" crossorigin>`,
    ),
    { imagePreloads: 2, preloadHrefs: ["/a.jpg", "/b.jpg"], prerender: [] },
  );
  assert.equal(
    hintsOf(
      `<link rel="preload" as="image" href="/m.jpg" media="(max-width: 600px)"><link rel="preload" as="image" href="/d.jpg" media="(min-width: 601px)">`,
    ).imagePreloads,
    1,
    "one hero per screen size",
  );
  assert.deepEqual(
    hintsOf(`<!-- <link rel="prerender" href="/old/"> --><link rel="prerender" href="/next/">`).prerender,
    ["/next/"],
  );
  assert.equal(
    hintsOf(
      `<link rel="preload" as="image" href="/hero.jpg" fetchpriority="high"><link rel="modulepreload" href="/a.js">`,
    ).imagePreloads,
    1,
  );
});

test("creator, the IPTC digital source type and a C2PA manifest are read from an image's first bytes", () => {
  const j = jpeg(800, 600);
  assert.deepEqual(imageMeta(j), { creator: null, sourceType: null, ai: false, c2pa: false });
  assert.deepEqual(
    imageMeta(
      withApp1(j, XMP(`${CREATOR}<Iptc4xmpExt:DigitalSourceType>${DST}digitalCapture</Iptc4xmpExt:DigitalSourceType>`)),
    ),
    { creator: "Ann Example", sourceType: "digitalCapture", ai: false, c2pa: false },
  );
  assert.deepEqual(
    imageMeta(
      withApp1(j, XMP(`<Iptc4xmpExt:DigitalSourceType rdf:resource="${DST}compositeWithTrainedAlgorithmicMedia"/>`)),
    ),
    { creator: null, sourceType: "compositeWithTrainedAlgorithmicMedia", ai: true, c2pa: false },
  );
  // IIM's By-line (2:80) in a Photoshop APP13 block, and a JUMBF box labelled c2pa in APP11.
  const iim = Buffer.concat([
    Buffer.from([0xff, 0xed, 0, 30]),
    Buffer.from("Photoshop 3.0\0", "latin1"),
    Buffer.from([0x1c, 2, 0x50, 0, 8]),
    Buffer.from("Bo Smith", "latin1"),
    Buffer.alloc(3),
  ]);
  const jumbf = Buffer.concat([
    Buffer.from([0xff, 0xeb, 0, 40, 0x4a, 0x50]),
    Buffer.from("....jumb....jumd", "latin1"),
    Buffer.alloc(17),
    Buffer.from("c2pa\0", "latin1"),
    Buffer.alloc(5),
  ]);
  assert.deepEqual(imageMeta(Buffer.concat([j.subarray(0, 20), iim, jumbf, j.subarray(20)])), {
    creator: "Bo Smith",
    sourceType: null,
    ai: false,
    c2pa: true,
  });
});

test("the AI label goes into a JPEG's or PNG's XMP without touching the pixels, and reads back", () => {
  const j = jpeg(800, 600),
    labelled = withAiLabel(j);
  assert.deepEqual(imageMeta(labelled), {
    creator: null,
    sourceType: "trainedAlgorithmicMedia",
    ai: true,
    c2pa: false,
  });
  assert.deepEqual(imageSize(labelled), { type: "jpeg", width: 800, height: 600 });
  assert.ok(labelled.subarray(0, 20).equals(j.subarray(0, 20)), "the JFIF header stays first");
  assert.ok(
    labelled.subarray(-j.length + 20).equals(j.subarray(20)),
    "everything after the header is byte for byte the same",
  );
  // An existing XMP packet keeps what it says (the creator) and gains the label.
  const kept = withAiLabel(withApp1(j, XMP(CREATOR)), "compositeSynthetic");
  assert.deepEqual(imageMeta(kept), {
    creator: "Ann Example",
    sourceType: "compositeSynthetic",
    ai: true,
    c2pa: false,
  });
  assert.equal(
    (kept.toString("latin1").match(/http:\/\/ns\.adobe\.com\/xap\/1\.0\//g) || []).length,
    1,
    "one XMP segment, edited in place",
  );
  assert.throws(() => withAiLabel(kept), /already labelled: compositeSynthetic/);
  assert.throws(() => withAiLabel(j, "digitalCapture"), /source/);
  const p = png(64, 32),
    lp = withAiLabel(p),
    chunks = pngChunks(lp);
  assert.deepEqual(
    chunks.map(c => c[0]),
    ["IHDR", "iTXt", "IDAT", "IEND"],
    "the XMP chunk goes before the image data",
  );
  assert.ok(
    chunks.every(c => c[2]),
    "every chunk's CRC is right",
  );
  assert.match(chunks[1][1].toString("latin1"), /^XML:com\.adobe\.xmp\0\0\0\0\0/);
  assert.equal(imageMeta(lp).sourceType, "trainedAlgorithmicMedia");
  assert.deepEqual(imageSize(lp), { type: "png", width: 64, height: 32 });
  assert.throws(() => withAiLabel(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), /JPEG or PNG/);
});

test("images.mjs --label-ai is a dry run until --yes, then keeps the original and reads the label back", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "hero.jpg"), jpeg(1200, 800));
  writeFileSync(join(dir, "icon.png"), png(48, 48));
  writeFileSync(join(dir, "x.webp"), Buffer.from("RIFF\0\0\0\0WEBPVP8 "));
  const run = (...a) =>
    node([join(SCRIPTS, "images.mjs"), "--label-ai", "hero.jpg,icon.png,x.webp,gone.jpg", ...a], { cwd: dir }).catch(
      e => e,
    );
  const dry = await run();
  assert.match(dry.stdout, /Dry run: nothing was written/);
  assert.match(dry.stdout, /hero\.jpg/);
  assert.match(dry.stdout, /x\.webp.*JPEG or PNG/);
  assert.match(dry.stdout, /gone\.jpg.*not found/i);
  assert.ok(!existsSync(join(dir, "hero.original.jpg")), "nothing written");
  assert.equal(imageMeta(readFileSync(join(dir, "hero.jpg"))).sourceType, null);
  const yes = await run("--yes");
  assert.match(yes.stdout, /labelled hero\.jpg.*hero\.original\.jpg.*read back: trainedAlgorithmicMedia/);
  assert.ok(readFileSync(join(dir, "hero.original.jpg")).equals(jpeg(1200, 800)), "the original is kept as it was");
  assert.equal(imageMeta(readFileSync(join(dir, "hero.jpg"))).sourceType, "trainedAlgorithmicMedia");
  assert.equal(imageMeta(readFileSync(join(dir, "icon.png"))).sourceType, "trainedAlgorithmicMedia");
  assert.equal(yes.code, 1, "files left alone (not found, wrong format) make the exit code 1");
  // A second run never overwrites the kept original.
  const again = await run("--yes");
  assert.match(again.stdout, /hero\.jpg.*already labelled/);
  assert.ok(readFileSync(join(dir, "hero.original.jpg")).equals(jpeg(1200, 800)));
});

test("FCP and TTFB get Google's bands; Core Web Vitals keep theirs", () => {
  assert.deepEqual([band("fcp", 1800), band("fcp", 2500), band("fcp", 3001)], ["good", "needs improvement", "poor"]);
  assert.deepEqual([band("ttfb", 800), band("ttfb", 1800), band("ttfb", 1801)], ["good", "needs improvement", "poor"]);
  assert.equal(band("lcp", 2600), "needs improvement");
});

// A PageSpeed answer: field data with distributions, FCP and TTFB, and a Lighthouse 13 lab run whose LCP is an image
// without fetchpriority="high".
const dist = (g, n, p) => [
  { min: 0, max: 1, proportion: g },
  { min: 1, max: 2, proportion: n },
  { min: 2, proportion: p },
];
const PSI = {
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100, distributions: dist(0.81, 0.12, 0.07) },
      INTERACTION_TO_NEXT_PAINT: { percentile: 180, distributions: dist(0.9, 0.08, 0.02) },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, distributions: dist(0.95, 0.03, 0.02) },
      FIRST_CONTENTFUL_PAINT_MS: { percentile: 1600, distributions: dist(0.7, 0.2, 0.1) },
      EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 900, distributions: dist(0.6, 0.3, 0.1) },
    },
  },
  lighthouseResult: {
    lighthouseVersion: "13.0.1",
    audits: {
      "largest-contentful-paint": { numericValue: 2400 },
      "lcp-breakdown-insight": {
        details: {
          type: "list",
          items: [
            { type: "table", items: [{ subpart: "timeToFirstByte", duration: 500 }] },
            {
              type: "node",
              selector: "main > img.hero",
              nodeLabel: "Engineer at work",
              snippet: '<img class="hero" src="/hero.jpg?w=1200&amp;q=80" alt="Engineer at work">',
            },
          ],
        },
      },
      "lcp-discovery-insight": {
        details: {
          type: "list",
          items: [
            {
              type: "checklist",
              items: {
                priorityHinted: { label: "fetchpriority=high should be applied", value: false },
                requestDiscoverable: { label: "x", value: true },
                eagerlyLoaded: { label: "y", value: true },
              },
            },
            { type: "node", snippet: "<img>" },
          ],
        },
      },
    },
  },
};

test("PageSpeed's visit shares, FCP, TTFB, the LCP element and the Lighthouse version are kept", async () => {
  const r = await checkSpeed(["https://e.example/"], {
    add: () => {},
    fetchFn: async () => new Response(JSON.stringify(PSI)),
  });
  const s = r.samples[0];
  assert.deepEqual(s.field, {
    lcp: 2100,
    inp: 180,
    cls: 0.05,
    fcp: 1600,
    ttfb: 900,
    shares: {
      lcp: [0.81, 0.12, 0.07],
      inp: [0.9, 0.08, 0.02],
      cls: [0.95, 0.03, 0.02],
      fcp: [0.7, 0.2, 0.1],
      ttfb: [0.6, 0.3, 0.1],
    },
  });
  assert.deepEqual(s.lab.lcpElement, {
    element: "Engineer at work",
    src: "/hero.jpg?w=1200&q=80",
    fetchpriorityHigh: false,
  });
  assert.equal(s.lab.version, "13.0.1");
  assert.equal(labLcpElement({}), null);
  assert.deepEqual(
    labLcpElement({
      "lcp-breakdown-insight": { details: { items: [{ type: "node", selector: "h1", snippet: '<h1 class="t">' }] } },
    }),
    { element: "h1" },
    "a text LCP has no file and no fetchpriority check",
  );
});

// A stand-in for the CrUX History API: 25 weekly periods, a page-level record for the home page, and phone and tablet.
const series = (a, b) => Array.from({ length: 25 }, (_, i) => Math.round(a + ((b - a) * i) / 24));
const date = d => {
  const x = new Date(Date.UTC(2026, 4, 11) + d * 864e5);
  return { year: x.getUTCFullYear(), month: x.getUTCMonth() + 1, day: x.getUTCDate() };
};
function cruxRecord({ formFactor = "PHONE", url } = {}) {
  const k = formFactor === "TABLET" ? 0.8 : url ? 1.1 : 1;
  const lcp = series(3100 * k, 2400 * k).map((x, i) => (i === 3 ? null : x));
  return {
    record: {
      key: { formFactor, ...(url ? { url } : { origin: ORIGIN }) },
      metrics: {
        largest_contentful_paint: { percentilesTimeseries: { p75s: lcp } },
        interaction_to_next_paint: { percentilesTimeseries: { p75s: series(240, 190) } },
        cumulative_layout_shift: { percentilesTimeseries: { p75s: series(12, 5).map(x => (x / 100).toFixed(2)) } },
        largest_contentful_paint_image_time_to_first_byte: { percentilesTimeseries: { p75s: series(900, 600) } },
        largest_contentful_paint_image_resource_load_delay: { percentilesTimeseries: { p75s: series(300, 200) } },
        largest_contentful_paint_image_resource_load_duration: { percentilesTimeseries: { p75s: series(500, 300) } },
        largest_contentful_paint_image_element_render_delay: { percentilesTimeseries: { p75s: series(100, 150) } },
      },
      collectionPeriods: Array.from({ length: 25 }, (_, i) => ({ firstDate: date(i * 7), lastDate: date(i * 7 + 27) })),
    },
  };
}

test("the CrUX history keeps every week, 4-week averages, the latest period, and asks per page or tablet", async () => {
  const sent = [],
    fetchFn = async (u, o) => {
      const b = JSON.parse(o.body);
      sent.push(b);
      return new Response(JSON.stringify(cruxRecord(b)));
    };
  const t = await speedTrend(ORIGIN, { key: "k", fetchFn });
  assert.equal(t.trend.series.lcp.length, 25);
  assert.equal(t.trend.series.lcp[3], null, "a week with too few visits stays null, in its place");
  assert.deepEqual(t.trend.lcp, [3100, 2400], "first and last, as before");
  const avg = xs => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  assert.deepEqual(
    t.trend.avg4.lcp,
    [avg([3100, 3071, 3042, 2983]), avg(series(3100, 2400).slice(-4))],
    "the first four and last four weeks that have a value",
  );
  assert.ok(
    Math.abs(t.trend.avg4.cls[0] - 0.115) < 0.006 && Math.abs(t.trend.avg4.cls[1] - 0.055) < 0.006,
    String(t.trend.avg4.cls),
  );
  assert.deepEqual(t.trend.period, { from: "2026-10-26", to: "2026-11-22" });
  assert.equal(t.trend.weeks, 25);
  const tablet = await speedTrend(ORIGIN, { key: "k", fetchFn, formFactor: "TABLET" });
  assert.deepEqual(sent[1], { ...sent[0], formFactor: "TABLET" });
  assert.deepEqual(tablet.trend.lcp, [2480, 1920]);
  assert.equal(tablet.lcpBreakdown.ttfb, 600);
  const home = await speedTrend(`${ORIGIN}/`, { key: "k", fetchFn, page: true });
  assert.equal(sent[2].url, `${ORIGIN}/`);
  assert.equal(sent[2].origin, undefined);
  assert.deepEqual(home.trend.lcp, [3410, 2640]);
  const gone = await speedTrend(`${ORIGIN}/`, {
    key: "k",
    page: true,
    fetchFn: async () => new Response("{}", { status: 404 }),
  });
  assert.match(gone.note, /home page|this page/i);
});

// ---------- Lighthouse ----------

const LHR = {
  lighthouseVersion: "13.0.1",
  categories: {
    performance: {
      title: "Performance",
      score: 0.5,
      auditRefs: [
        { id: "largest-contentful-paint", weight: 25 },
        { id: "uses-rel-preconnect", weight: 0 },
        { id: "lcp-breakdown-insight", weight: 0 },
      ],
    },
    seo: {
      title: "SEO",
      score: 0.9,
      auditRefs: [
        { id: "document-title", weight: 1 },
        { id: "meta-description", weight: 1 },
        { id: "structured-data", weight: 0 },
      ],
    },
    accessibility: {
      title: "Accessibility",
      score: 1,
      auditRefs: [
        { id: "image-alt", weight: 10 },
        { id: "document-title", weight: 3 },
      ],
    },
    "best-practices": { title: "Best Practices", score: 1, auditRefs: [{ id: "is-on-https", weight: 5 }] },
  },
  audits: {
    "largest-contentful-paint": { title: "LCP", score: 0.3, numericValue: 4100 },
    "uses-rel-preconnect": { title: "Preconnect", score: 1 },
    "lcp-breakdown-insight": {
      title: "LCP breakdown",
      score: null,
      scoreDisplayMode: "informative",
      details: { type: "list", items: [{ type: "node", nodeLabel: "Hero", snippet: '<img src="/hero.jpg">' }] },
    },
    "document-title": { title: "Title", score: 1 },
    "meta-description": { title: "Description", score: 0 },
    "structured-data": { title: "SD", score: null, scoreDisplayMode: "manual" },
    "image-alt": { title: "Alt", score: 1 },
    "is-on-https": { title: "HTTPS", score: 1 },
  },
};
function fakeLighthouse(lhr = LHR) {
  const dir = tmp(),
    bin = join(dir, "fake-lighthouse.mjs"),
    log = join(dir, "calls.txt");
  writeFileSync(
    bin,
    `import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2), url = args.find(a => !a.startsWith("--"));
appendFileSync(${JSON.stringify(log)}, url + "\\n");
writeFileSync(args.find(a => a.startsWith("--output-path=")).slice(14), JSON.stringify(${JSON.stringify(lhr)}));
`,
  );
  return { bin, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

test("a Lighthouse run keeps its version, its passed-audit count and its LCP element", async () => {
  const r = await runLighthouse(fakeLighthouse().bin, "http://127.0.0.1:1/");
  assert.equal(r.version, "13.0.1");
  assert.equal(
    r.passed,
    4,
    "each passing audit once, though document-title sits in two categories; manual and informative ones aside",
  );
  assert.deepEqual(r.lcpElement, { element: "Hero", src: "/hero.jpg" });
});

test("the median score per category across pages", () => {
  const run = (p, s) => ({
    url: `https://e.example${p}`,
    scores: { performance: p === "/c/" ? null : s, seo: 90, accessibility: s + 10, bestPractices: 100 },
  });
  assert.deepEqual(medianScores([run("/", 40), run("/a/", 60), run("/b/", 80), run("/c/", 99)]), {
    pages: 4,
    performance: 60,
    seo: 90,
    accessibility: 80,
    bestPractices: 100,
  });
  assert.deepEqual(
    medianScores([run("/", 40), run("/a/", 61)]),
    { pages: 2, performance: 51, seo: 90, accessibility: 61, bestPractices: 100 },
    "an even count takes the middle two's mean, rounded",
  );
});

test("a custom page count says it stopped at the number asked for, not at the cap", async () => {
  const lh = fakeLighthouse(),
    o = "http://127.0.0.1:1";
  const r = await checkLighthouse(lh.bin, [`${o}/a/`, `${o}/`, `${o}/b/`, `${o}/c/`], { all: true, max: 3 });
  assert.equal(lh.calls().length, 3);
  assert.ok(
    r.notes.some(n => /stopped at 3 pages, the number asked for; 1 more page/.test(n)),
    r.notes.join("\n"),
  );
});

// ---------- the crawler ----------

// Pages ({ "/path/": html }) served from a temp folder and crawled as ORIGIN; node stands in for the browser, so no
// real Chrome starts and outside checks stay quick.
async function crawlSite(pages, { args = [], env = {}, ...serveOpts } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await serve(dir, serveOpts);
  const origin = args.includes("--no-origin") ? [] : ["--site-origin", ORIGIN];
  try {
    await node(
      [
        join(SCRIPTS, "seo-crawl.mjs"),
        "--url",
        site.url,
        ...origin,
        "--out",
        out,
        ...args.filter(a => a !== "--no-origin"),
      ],
      { env: { ...process.env, CHROME_PATH: process.execPath, PSI_API_KEY: "", CRUX_API_KEY: "", ...env } },
    );
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const MEDIA_CHECKS = [
  "img-alt-quality",
  "image-preloads",
  "prerender-hint",
  "image-over-500kb",
  "hero-no-fetchpriority",
];

test("an ordinary site raises none of these checks and only quiet information", async () => {
  const r = await crawlSite(
    {
      "/": page(
        "Boiler repairs and servicing in Leeds",
        '<a href="/about/">About the team</a> <img src="/team.jpg" alt="Our three engineers outside the Leeds office" width="800" height="600" fetchpriority="high">',
        '<link rel="preload" as="image" href="/team.jpg" fetchpriority="high"><link rel="preload" as="font" href="/f.woff2" crossorigin>',
      ),
      "/about/": page("About our Leeds heating engineers", '<img src="/logo.png" alt="" width="40" height="40">'),
    },
    {
      files: {
        "/team.jpg": { type: "image/jpeg", body: jpeg(800, 600, 40000) },
        "/logo.png": { type: "image/png", body: png(40, 40) },
      },
      headers: { "/team.jpg": { "Cache-Control": "public, max-age=31536000" } },
    },
  );
  for (const key of [...MEDIA_CHECKS, "lazy-lcp", "heavy-image"]) assert.ok(!findingOf(r, key), key);
  const m = r.media;
  assert.equal(m.serverTimes.pages, 2);
  assert.ok(Number.isInteger(m.serverTimes.median) && m.serverTimes.median >= 0);
  assert.deepEqual(m.serverTimes.slow, []);
  assert.equal(m.domShape, undefined, "no page is over the lines");
  assert.deepEqual(
    { ...m.imageCredits, noCreator: m.imageCredits.noCreator.map(u => new URL(u).pathname).sort() },
    { read: 2, creator: 0, ai: [], aiCount: 0, c2pa: 0, noCreator: ["/logo.png", "/team.jpg"] },
  );
  assert.equal(m.imageCache.uncachedCount, 1, "the real total, beside the list of up to 20");
  assert.equal(m.imageCache.uncached.length, 1, "the logo is served with no cache lifetime");
  assert.equal(m.heroImages, undefined, "no lab run, no hero");
});

test("the image and page-shape problems these checks look for, on one site", async () => {
  const hero = withAiLabel(jpeg(2400, 1600, 600 * 1024));
  const big = `<ul class="menu">${Array.from({ length: 70 }, (_, i) => `<li><a href="/">Link ${i}</a>`).join("")}</ul>`;
  const r = await crawlSite(
    {
      "/": page(
        "Boiler repairs and servicing in Leeds",
        `<img src="data:image/svg+xml,%3Csvg%3E" data-src="/hero.jpg" class="perfmatters-lazy" alt="Engineer fitting a boiler" width="1200" height="800">
       <img src="/a.jpg" alt="IMG_4032.jpg" width="10" height="10"><img src="/a.jpg" alt="image" width="10" height="10"><img src="/a.jpg" alt="plumber, plumbing, leeds plumber, emergency plumber" width="10" height="10">
       <a href="/deep/">Deep</a>`,
        '<link rel="preload" as="image" href="/hero.jpg"><link rel="preload" as="image" href="/a.jpg"><link rel="prerender" href="/deep/">',
      ),
      "/deep/": page("A deeply nested page about radiators", `${"<div>".repeat(35)}deep${"</div>".repeat(35)}${big}`),
    },
    {
      files: { "/hero.jpg": { type: "image/jpeg", body: hero }, "/a.jpg": { type: "image/jpeg", body: jpeg(10, 10) } },
      headers: {
        "/hero.jpg": { "Cache-Control": "no-store", "cf-cache-status": "MISS" },
        "/a.jpg": { "Cache-Control": "max-age=0" },
      },
    },
  );
  assert.match(
    findingOf(r, "lazy-lcp")?.evidence[0].detail || "",
    /\/hero\.jpg/,
    "a lazy-loading script on the first image counts",
  );
  assert.match(
    findingOf(r, "image-over-500kb")?.evidence[0].detail || "",
    /hero\.jpg · 600 KB/,
    "the image behind the placeholder was weighed",
  );
  assert.equal(findingOf(r, "image-over-500kb").severity, "medium");
  assert.ok(!findingOf(r, "heavy-image"), "an image over 500 KB isn't counted twice");
  assert.ok(r.images.some(i => /\/hero\.jpg$/.test(i.url) && i.width === 2400));
  assert.match(findingOf(r, "img-alt-quality")?.evidence[0].detail || "", /3 image\(s\).*IMG_4032\.jpg.*a file name/);
  assert.equal(findingOf(r, "img-alt-quality").rule, "CONTENT-08");
  assert.match(findingOf(r, "image-preloads")?.evidence[0].detail || "", /2 image preloads: \/hero\.jpg, \/a\.jpg/);
  assert.match(findingOf(r, "prerender-hint")?.evidence[0].detail || "", /\/deep\//);
  assert.equal(findingOf(r, "prerender-hint").rule, "PERF-09");
  const m = r.media;
  assert.deepEqual(
    m.domShape.deep.map(d => [new URL(d.url).pathname, d.depth >= 36]),
    [["/deep/", true]],
  );
  assert.deepEqual(
    m.domShape.wide.map(d => [new URL(d.url).pathname, d.tag, d.children]),
    [["/deep/", "ul.menu", 70]],
  );
  assert.equal(m.imageCredits.ai.length, 1);
  assert.match(m.imageCredits.ai[0], /\/hero\.jpg$/);
  assert.deepEqual(m.imageCache.uncached.map(u => u.replace(/^.*\//, "")).sort(), ["a.jpg", "hero.jpg"]);
  assert.equal(m.imageCache.cdn, "Cloudflare");
  assert.ok(!r.passed.some(p => p.rule === "PERF-01"));
});

// PageSpeed and CrUX stand-ins on one local server.
async function fakeGoogle() {
  const crux = [];
  const server = createServer((req, res) => {
    let body = "";
    req
      .on("data", c => (body += c))
      .on("end", () => {
        if (req.url.startsWith("/psi"))
          return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(PSI));
        const b = JSON.parse(body || "{}");
        crux.push(b);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(cruxRecord(b)));
      });
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const at = `http://127.0.0.1:${server.address().port}`;
  return { psi: `${at}/psi`, crux: `${at}/crux`, sent: crux, close: () => new Promise(ok => server.close(ok)) };
}

test("a crawl keeps the hero from the lab run, fetchpriority, tablet and home-page trends", async () => {
  const g = await fakeGoogle();
  try {
    const r = await crawlSite(
      {
        "/": page(
          "Boiler repairs and servicing in Leeds",
          '<img src="/hero.jpg" alt="Engineer at work" width="1200" height="800">',
        ),
      },
      { args: ["--outside", "--psi-endpoint", g.psi, "--crux-endpoint", g.crux], env: { CRUX_API_KEY: "k" } },
    );
    assert.match(findingOf(r, "hero-no-fetchpriority")?.evidence[0].detail || "", /\/hero\.jpg\?w=1200&q=80/);
    assert.deepEqual(r.media.heroImages, [
      { url: `${ORIGIN}/`, element: "Engineer at work", src: "/hero.jpg?w=1200&q=80", source: "PageSpeed" },
    ]);
    assert.deepEqual(
      g.sent.map(b => [b.formFactor, b.url ? "page" : "origin"]),
      [
        ["PHONE", "origin"],
        ["TABLET", "origin"],
        ["PHONE", "page"],
      ],
    );
    assert.deepEqual(r.speed.tablet.trend.lcp, [2480, 1920]);
    assert.equal(r.speed.tablet.lcpBreakdown.source, "real visitors");
    assert.deepEqual(r.speed.pageTrend.url, `${ORIGIN}/`);
    assert.deepEqual(r.speed.pageTrend.trend.lcp, [3410, 2640]);
    assert.ok(r.speed.trend.series && r.speed.trend.avg4 && r.speed.trend.period);
    assert.equal(r.speed.samples[0].field.fcp, 1600);
  } finally {
    await g.close();
  }
});

test("--lighthouse N runs that many pages, and the medians are kept", async () => {
  const lh = fakeLighthouse();
  const pages = {
    "/": page("Boiler repairs and servicing in Leeds", '<a href="/a/">A</a> <a href="/b/">B</a> <a href="/c/">C</a>'),
  };
  for (const p of ["a", "b", "c"]) pages[`/${p}/`] = page(`Page ${p} about heating repairs`);
  const r = await crawlSite(pages, {
    args: ["--no-origin", "--outside", "--lighthouse", "3"],
    env: { LIGHTHOUSE_PATH: lh.bin },
  });
  assert.equal(lh.calls().length, 3);
  assert.equal(new URL(lh.calls()[0]).pathname, "/");
  assert.ok(
    r.notes.some(
      n =>
        /Lighthouse ran on 3 of 3 page/.test(n) && /stopped at 3 pages, the number asked for/.test(r.notes.join(" ")),
    ),
    r.notes.join("\n"),
  );
  assert.deepEqual(r.media.lighthouseMedians, {
    pages: 3,
    performance: 50,
    seo: 90,
    accessibility: 100,
    bestPractices: 100,
  });
  assert.equal(r.lighthouse[0].passed, 4);
});

// ---------- the report ----------

test("the report's media panel shows this information, escaped, and nothing without it", async () => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  const render = async d => {
    writeFileSync(join(dir, "a.json"), JSON.stringify(d));
    await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
    return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
  };
  const { speed, ...bare } = data,
    none = await render(bare);
  assert.doesNotMatch(none.html, /Speed and image details/);
  assert.doesNotMatch(none.md, /Speed and image details/);
  const field = {
    lcp: 2100,
    inp: 180,
    cls: 0.05,
    fcp: 1600,
    ttfb: 900,
    shares: { lcp: [0.81, 0.12, 0.07], inp: [0.9, 0.08, 0.02], cls: [0.95, 0.03, 0.02] },
  };
  const trend = {
    weeks: 25,
    lcp: [3100, 2400],
    inp: [240, 190],
    cls: [0.12, 0.05],
    avg4: { lcp: [3080, 2460], inp: [236, 192], cls: [0.12, 0.05] },
    period: { from: "2026-10-26", to: "2026-11-22" },
  };
  data.speed = {
    strategy: "mobile",
    samples: [{ url: "https://example.com/", field, origin: null, lab: { version: "13.0.1" } }],
    trend,
    tablet: {
      trend: { ...trend, lcp: [2500, 1900] },
      lcpBreakdown: {
        source: "real visitors",
        url: "https://example.com",
        ttfb: 600,
        loadDelay: 100,
        loadDuration: 100,
        renderDelay: 100,
      },
    },
    pageTrend: { url: "https://example.com/", trend: { ...trend, lcp: [3400, 2600] } },
  };
  data.lighthouse = [
    {
      url: "https://example.com/",
      version: "13.0.1",
      passed: 41,
      scores: {},
      metrics: {},
      failed: [],
      detail: [
        { id: "a", title: "A", items: [] },
        { id: "b", title: "B", items: [] },
      ],
    },
  ];
  data.media = {
    serverTimes: { pages: 12, median: 120, p95: 840, slow: [{ url: "https://example.com/slow/<b>", ms: 1200 }] },
    heroImages: [{ url: "https://example.com/", element: "Hero <img>", src: "/hero.jpg", source: "PageSpeed" }],
    lighthouseMedians: { pages: 7, performance: 64, seo: 92, accessibility: 88, bestPractices: 96 },
    imageCredits: {
      read: 8,
      creator: 2,
      ai: ["https://example.com/ai.jpg"],
      c2pa: 1,
      noCreator: ["https://example.com/a.jpg"],
    },
    imageCache: {
      checked: 8,
      uncached: ["https://example.com/a.jpg"],
      cdn: "Cloudflare",
      otherHosts: { "cdn.example.net": 4 },
    },
    domShape: {
      deep: [{ url: "https://example.com/x/", depth: 40 }],
      wide: [{ url: "https://example.com/y/", tag: "ul.menu", children: 70 }],
    },
  };
  const { html, md } = await render(data);
  for (const text of [html, md]) {
    assert.match(text, /Speed and image details/);
    assert.match(text, /good \/ needs improvement \/ poor: LCP 81% \/ 12% \/ 7%/);
    assert.match(text, /FCP 1\.6 s \(good\) · TTFB 0\.9 s \(needs improvement\)/);
    assert.match(text, /26 Oct – 22 Nov 2026/);
    assert.match(text, /4-week averages: LCP 3\.1 → 2\.5 s · INP 236 → 192 ms · CLS 0\.12 → 0\.05/);
    assert.match(text, /Home page alone: LCP 3\.4 → 2\.6 s/);
    assert.match(
      text,
      /Tablet \(whole site\): LCP 2\.5 → 1\.9 s over 25 weeks; most of the LCP goes on the server(&#39;|')s response \(0\.6 s\)/,
    );
    assert.match(
      text,
      /Lighthouse medians across 7 pages: Performance 64 · SEO 92 · Accessibility 88 · Best practices 96/,
    );
    assert.match(text, /Lighthouse 13\.0\.1: \/ passed 41 audits, failed 2/);
    assert.match(text, /median 120 ms/);
    assert.match(text, /Cloudflare/);
    assert.match(text, /ul\.menu/);
  }
  assert.match(html, /Hero &lt;img&gt;/, "crawled text is escaped");
  assert.doesNotMatch(html, /Hero <img>/);
  assert.match(md, /Hero \\<img\\>/);
});

test("images.mjs --label-ai with the same file named twice labels it once, no crash", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "hero.jpg"), jpeg(400, 300));
  const r = await node([join(SCRIPTS, "images.mjs"), "--label-ai", "hero.jpg,./hero.jpg", "--yes"], { cwd: dir });
  assert.match(r.stdout, /hero\.jpg/);
  assert.ok(existsSync(join(dir, "hero.original.jpg")));
});
