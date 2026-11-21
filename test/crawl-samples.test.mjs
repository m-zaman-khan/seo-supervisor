// The Markdown comparison (AI-05) on every page of the render sample, and secret keys (TRUST-01) in the site's scripts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";

const ORIGIN = "https://site.example";
// 50+ distinct words of main text, so a page is long enough to compare (as in data-checks.test.mjs).
const COPY =
  "Our engineers repair boilers, radiators, thermostats and leaking pipes across Leeds, Bradford, Wakefield and Harrogate. Every visit starts with a written estimate, a careful safety inspection and honest advice about replacing worn parts. We carry common spares in each van, finish most jobs within a single morning, tidy away dust and packaging afterwards, and guarantee labour for twelve months. Landlords receive certificates by email; homeowners can book evenings, weekends or emergency callouts through our friendly office team.";
const OLD =
  "Spring offer: half price gutter cleaning, window washing, patio jet washing and garden fence painting for loyal customers. Call before Easter to claim the voucher, valid on Tuesdays only while stocks last.";
const page = (title, head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="Boiler repairs in Leeds">${head}</head><body><header><nav><a href="/">Home</a> <a href="/about/">About</a> <a href="/services/">Services</a></nav></header><main><h1>${title}</h1><p>${COPY}</p></main><footer>Leeds Heating Ltd, registered in England</footer></body></html>`;
const md = title => `# ${title}\n\n${COPY}\n`;

// Joined at run time, so no key-shaped string sits in the source for secret scanners to stop.
const STRIPE_SECRET = ["sk", "live", "51Hq" + "Zx9Kd2LmPq7Rt4Vw8YbN3Cf6Gj1Ae5"].join("_");
const STRIPE_PUBLIC = ["pk", "live", "51Hq" + "Zx9Kd2LmPq7Rt4Vw8YbN3Cf6Gj1Ae5"].join("_");
const GITHUB = "gh" + "p_" + "R8f2Kq9LmZ3xW7vT1bN6cY4dH0sJ5aE2gU8i";
const GOOGLE_BROWSER = "AI" + "za" + "SyD3x9Lq2Wm8Rt5Vb7Nc1Kp4Zj6Hf0Gs2Ae";
const js = s => ({ type: "text/javascript; charset=utf-8", body: Buffer.from(s) });

// Logs every request (path and Accept header), so a test can prove what was and wasn't asked.
async function logged(dir, opts = {}) {
  const log = [];
  const site = await serve(dir, {
    ...opts,
    before: req => {
      log.push({ path: new URL(req.url, "http://x").pathname, accept: req.headers.accept || "" });
      return false;
    },
  });
  return { ...site, log };
}
async function crawlSite(pages, opts = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), "User-agent: *\nAllow: /\n");
  const site = await logged(dir, {
    headers: { "/": { Vary: "Accept" }, "/about/": { Vary: "Accept" }, "/services/": { Vary: "Accept" } },
    ...opts,
  });
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
    log: site.log,
  };
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const byPath = (r, check) =>
  Object.fromEntries((findingOf(r, check)?.evidence || []).map(e => [new URL(e.url).pathname, e.detail]));
const askedFor = (log, re) =>
  log
    .filter(l => re.test(l.accept))
    .map(l => l.path)
    .sort();
const PAGES = {
  "/": page("Boiler repairs in Leeds"),
  "/about/": page("About our Leeds engineers"),
  "/services/": page("Our heating services"),
};

// ---------- Markdown on the render sample ----------
test("Markdown that drifted on a page other than the home page is found; the start page's Markdown is asked once", async () => {
  const { r, log } = await crawlSite(PAGES, {
    markdown: {
      "/": md("Boiler repairs in Leeds"),
      "/about/": md("About our Leeds engineers"),
      "/services/": `# Our heating services\n\n${OLD}\n`,
    },
  });
  const f = findingOf(r, "markdown-differs");
  assert.deepEqual([f?.rule, f?.severity, f?.count], ["AI-05", "low", 1], JSON.stringify(f?.evidence));
  assert.deepEqual(
    Object.keys(byPath(r, "markdown-differs")),
    ["/services/"],
    "one evidence line, on the page that drifted",
  );
  assert.match(
    f.evidence[0].detail,
    /^the Markdown has \d+% of the page's main words, and \d+% of its own words aren't on the page; our own limit is half$/,
  );
  assert.equal(f.title, "The Markdown version of a page says something different from the page");
  assert.deepEqual(
    askedFor(log, /text\/markdown/),
    ["/", "/about/", "/services/"],
    "each sampled page asked once; the probe's answer serves the start page",
  );
});

test("a site that serves no Markdown is asked for none beyond the probe", async () => {
  const { r, log } = await crawlSite(PAGES);
  assert.equal(findingOf(r, "markdown-differs"), undefined);
  assert.deepEqual(askedFor(log, /text\/markdown/), ["/"], "only the start page's probe");
});

// ---------- Secret keys in the site's own script files ----------
test("a key in a same-origin bundle that two pages load is fetched and reported once, masked, and written nowhere", async () => {
  const bundle = `(()=>{const c={stripe:"${STRIPE_SECRET}",gh:"${GITHUB}"};window.cfg=c;window.cfg2={stripe:"${STRIPE_SECRET}"}})();`;
  const {
    r,
    text,
    words,
    console: out,
    log,
  } = await crawlSite(
    {
      "/": page("Boiler repairs in Leeds", '<script src="/assets/app.js" defer></script>'),
      "/about/": page("About our Leeds engineers", `<script type="module" src="${ORIGIN}/assets/app.js"></script>`), // the public origin, mapped onto the crawl
      "/services/": page("Our heating services", '<!-- <script src="/assets/old.js"></script> -->'),
    },
    { files: { "/assets/app.js": js(bundle), "/assets/old.js": js(`var k="${GITHUB}"`) } },
  );
  const f = findingOf(r, "secret-key-exposed");
  assert.deepEqual([f?.rule, f?.severity, f?.count], ["TRUST-01", "high", 1], JSON.stringify(f?.evidence));
  assert.deepEqual(byPath(r, "secret-key-exposed"), {
    "/": "in the script /assets/app.js (loaded by 2 pages): a Stripe live secret key (sk_live_51Hq…); a GitHub token (ghp_R8f2…)",
  });
  assert.deepEqual(
    log.filter(l => l.path.startsWith("/assets/")).map(l => l.path),
    ["/assets/app.js"],
    "fetched once; a commented-out script isn't loaded, so it isn't read",
  );
  for (const key of [STRIPE_SECRET, GITHUB, STRIPE_SECRET.slice(12), GITHUB.slice(8)]) {
    assert.ok(!text.includes(key), "the crawl JSON never holds the key");
    assert.ok(!words.toLowerCase().includes(key.toLowerCase()), "nor the words file");
    assert.ok(!out.includes(key), "nor the console");
  }
});

test("a third-party script is never fetched, and browser keys in the site's own script aren't flagged", async () => {
  const other = await logged(tmp(), { files: { "/vendor.js": js(`var s="${STRIPE_SECRET}"`) } });
  try {
    const { r, log } = await crawlSite(
      {
        "/": page(
          "Boiler repairs in Leeds",
          `<script src="${other.url}/vendor.js"></script><script src="https://cdn.example/lib.js"></script><script src="/js/site.js"></script>`,
        ),
        "/about/": page("About our Leeds engineers"),
        "/services/": page("Our heating services"),
      },
      {
        files: {
          "/js/site.js": js(`firebase.initializeApp({apiKey:"${GOOGLE_BROWSER}"});Stripe("${STRIPE_PUBLIC}");`),
        },
      },
    );
    assert.deepEqual(other.log, [], "the other host got no request at all");
    assert.deepEqual(
      log.filter(l => l.path.endsWith(".js")).map(l => l.path),
      ["/js/site.js"],
      "the site's own script was read",
    );
    assert.equal(
      findingOf(r, "secret-key-exposed"),
      undefined,
      JSON.stringify(findingOf(r, "secret-key-exposed")?.evidence),
    );
    assert.ok(!r.notes.some(n => /script files weren't read/.test(n)), "no cap was hit");
  } finally {
    await other.close();
  }
});

test("our own caps: 50 script files, and none over 5 MB; a note says how many weren't read", async () => {
  const files = { "/js/a-big.js": js(`var g="${GITHUB}";` + "x".repeat(6 * 1024 * 1024)) },
    tags = ['<script src="/js/a-big.js"></script>'];
  for (let i = 0; i < 51; i++) {
    const name = `/js/f${String(i).padStart(2, "0")}.js`;
    files[name] = js(i === 0 ? `var t="${GITHUB}"` : i === 50 ? `var s="${STRIPE_SECRET}"` : `var n=${i}`);
    tags.push(`<script src="${name}"></script>`);
  }
  const { r, log } = await crawlSite({ ...PAGES, "/": page("Boiler repairs in Leeds", tags.join("")) }, { files });
  assert.equal(log.filter(l => l.path.startsWith("/js/")).length, 50, "50 files asked for, the big one among them");
  assert.deepEqual(
    byPath(r, "secret-key-exposed"),
    { "/": "in the script /js/f00.js: a GitHub token (ghp_R8f2…)" },
    "the big file and the 52nd weren't read",
  );
  const note = r.notes.find(n => /script files weren't read/.test(n));
  assert.match(note ?? "", /^3 of the site's 52 script files weren't read/);
  assert.match(note, /our own/);
});
