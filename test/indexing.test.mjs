import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import {
  findSitemaps,
  checkSitemapFiles,
  checkSitemapEntries,
} from "../skills/seo-supervisor/scripts/checks/sitemap.mjs";
import { checkRobots, aiRobotRules } from "../skills/seo-supervisor/scripts/checks/robots.mjs";
import { CHECKS } from "../skills/seo-supervisor/scripts/crawl/catalog.mjs";
import { probeSite } from "../skills/seo-supervisor/scripts/checks/probes.mjs";
import { oldUrls } from "../skills/seo-supervisor/scripts/checks/links.mjs";
import { render } from "../skills/seo-supervisor/scripts/render-report.mjs";
import { deployCheck } from "../skills/seo-supervisor/scripts/deploy-check.mjs";

const O = "https://site.example";
// A finding store like lib/findings.mjs's, for calling one check module directly.
const store = () => {
  const findings = new Map(),
    notes = [],
    evaluated = new Set();
  return {
    findings,
    notes,
    evaluated,
    evalRules: (...r) => r.forEach(x => evaluated.add(x)),
    add: (k, url, detail) => {
      const f = findings.get(k) || findings.set(k, { count: 0, evidence: [] }).get(k);
      f.count++;
      f.evidence.push(detail == null ? { url } : { url, detail });
    },
  };
};
const sitemaps = (files, { listed = true, urls = [O + "/sitemap.xml"] } = {}) => {
  const s = store();
  const fetchSitemap = async u => (files[u] != null ? { status: 200, body: files[u] } : { status: 404 });
  return findSitemaps(urls, listed, { startOrigin: O, notes: s.notes, fetchSitemap, toCrawl: u => u }).then(sm => ({
    sm,
    ...s,
  }));
};

test("a sitemap with 32 KB of spaces after <loc> or <lastmod>, and no closing tag, is read at once", async () => {
  const sp = " ".repeat(32 * 1024);
  for (const body of [
    `<urlset><url><loc>${sp}</url></urlset>`,
    `<urlset><url><loc>${O}/a/</loc><lastmod>${sp}</url></urlset>`,
    `<sitemapindex><sitemap><loc>${sp}</sitemap></sitemapindex>`,
  ]) {
    const t = performance.now();
    await sitemaps({ [O + "/sitemap.xml"]: body });
    assert.ok(performance.now() - t < 1000, `${Math.round(performance.now() - t)} ms for ${body.slice(0, 30)}`);
  }
  // Spaces around a value are trimmed too.
  const { sm } = await sitemaps({
    [O + "/sitemap.xml"]: `<urlset><url><loc>\n  ${O}/a/  \n</loc><lastmod> 2026-11-01 </lastmod></url></urlset>`,
  });
  assert.deepEqual(
    sm.entries.map(e => [e.loc, e.lastmod]),
    [[O + "/a/", "2026-11-01"]],
  );
});

const robotsOf = txt => {
  const s = store();
  const r = checkRobots({ status: 200, body: txt, chain: [] }, { add: s.add, evalRules: s.evalRules, startOrigin: O });
  return { ...r, ...s };
};
test("robots.txt is judged by Googlebot's most specific group, not only User-agent: *", () => {
  // Googlebot's own group blocks the site, which reading only * would miss.
  const own = robotsOf("User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /\n");
  assert.ok(own.findings.has("robots-blocks-all"));
  assert.match(own.findings.get("robots-blocks-all").evidence[0].detail, /Googlebot/);
  // * blocks everything, but Googlebot's own group lets it in: Google crawls, so no blocker for Google.
  const star = robotsOf("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n");
  assert.ok(!star.findings.has("robots-blocks-all"));
  // Googlebot without a group of its own follows *; the two are never combined.
  assert.ok(
    robotsOf("User-agent: *\nDisallow: /\n\nUser-agent: Bingbot\nAllow: /\n").findings.has("robots-blocks-all"),
  );
  assert.ok(
    !robotsOf("User-agent: *\nDisallow: /_next/\n\nUser-agent: Googlebot\nAllow: /\n").findings.has(
      "robots-blocks-assets",
    ),
  );
  assert.ok(
    robotsOf("User-agent: *\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /_next/\n").findings.has(
      "robots-blocks-assets",
    ),
  );
});

const fakeSite = routes => async url => {
  const r = routes[new URL(url).pathname];
  return new Response(r ? r[1] : "", { status: r ? r[0] : 404, headers: { "content-type": "text/plain" } });
};
const deploy = robots =>
  deployCheck("http://site.test", {
    fetchFn: fakeSite({
      "/": [200, `<html><head><link rel="canonical" href="http://site.test/"></head></html>`],
      "/robots.txt": [200, robots],
    }),
  }).then(r => r.checks.find(c => c.id === "robots"));
test("deploy-check reads robots.txt as Googlebot does", async () => {
  assert.equal(
    (await deploy("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n")).state,
    "warning",
    "Googlebot's own group lets it in: not a blocker",
  );
  assert.equal((await deploy("User-agent: *\nAllow: /\n\nUser-agent: googlebot/2.1\nDisallow: /\n")).state, "blocker");
  assert.equal((await deploy("User-agent: *\nDisallow: /\n")).state, "blocker");
  assert.equal((await deploy("User-agent: *\nDisallow: /private\n")).state, "ok");
});

// The file and entry checks on sitemaps read by findSitemaps, as the crawler runs them.
async function sitemapRun(files, opts) {
  const r = await sitemaps(files, opts),
    smUrls = opts?.urls || [O + "/sitemap.xml"];
  checkSitemapFiles(r.sm, smUrls, { add: r.add, findings: r.findings });
  checkSitemapEntries(r.sm, smUrls[0], {
    add: r.add,
    notes: r.notes,
    evalRules: r.evalRules,
    expectOrigin: O,
    startOrigin: O,
    toCrawl: u => u,
    inSection: () => true,
    crawler: { seen: new Set(), queue: [] },
  });
  return r;
}
const urlset = (...locs) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map(l => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

test("a <loc> that isn't a full URL, and a sitemap with no URLs, each get a finding", async () => {
  const bad = await sitemapRun({ [O + "/sitemap.xml"]: urlset(O + "/a/", "/b/", "c.html", "ftp://site.example/d") });
  assert.deepEqual(bad.findings.get("sitemap-url-invalid")?.evidence, [
    { url: O + "/sitemap.xml", detail: "/b/" },
    { url: O + "/sitemap.xml", detail: "c.html" },
    { url: O + "/sitemap.xml", detail: "ftp://site.example/d" },
  ]);
  assert.equal(CHECKS["sitemap-url-invalid"][0], "MAP-02");
  for (const body of [
    urlset(),
    "",
    `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>`,
  ]) {
    const r = await sitemapRun({ [O + "/sitemap.xml"]: body });
    assert.deepEqual(r.findings.get("sitemap-empty")?.evidence, [{ url: O + "/sitemap.xml" }], JSON.stringify(body));
    assert.ok(!r.findings.has("sitemap-missing"), "an empty sitemap is there, just empty");
  }
  // One empty file next to a full one is flagged too.
  const two = await sitemapRun(
    { [O + "/a.xml"]: urlset(O + "/a/"), [O + "/b.xml"]: urlset() },
    { urls: [O + "/a.xml", O + "/b.xml"] },
  );
  assert.deepEqual(two.findings.get("sitemap-empty")?.evidence, [{ url: O + "/b.xml" }]);
});

test("robots-missing is low; a declared sitemap that's broken still gets the usual paths tried; lastmod is flagged at 90% the same", async () => {
  assert.equal(CHECKS["robots-missing"][1], "low");
  // robots.txt names a sitemap that answers 404; the real one is at /sitemap_index.xml.
  const r = await sitemapRun(
    { [O + "/sitemap_index.xml"]: urlset(O + "/a/", O + "/b/") },
    { urls: [O + "/old-sitemap.xml"] },
  );
  assert.deepEqual(
    r.sm.entries.map(e => e.loc),
    [O + "/a/", O + "/b/"],
  );
  assert.ok(!r.findings.has("sitemap-missing"));
  assert.deepEqual(r.findings.get("sitemap-unreachable")?.evidence, [
    { url: O + "/old-sitemap.xml", detail: "status 404" },
  ]);
  // Nothing anywhere: sitemap-missing, not sitemap-unreachable as well.
  const none = await sitemapRun({}, { urls: [O + "/old-sitemap.xml"] });
  assert.ok(none.findings.has("sitemap-missing") && !none.findings.has("sitemap-unreachable"));
  // A guessed /sitemap.xml that 404s isn't a broken declared sitemap.
  const guessed = await sitemapRun({ [O + "/sitemap_index.xml"]: urlset(O + "/a/") }, { listed: false });
  assert.ok(!guessed.findings.has("sitemap-unreachable"));
  // lastmod: 9 of 10 entries share a day.
  const dated = n =>
    `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({ length: n }, (_, i) => `<url><loc>${O}/p${i}/</loc><lastmod>${i ? "2026-11-01" : "2026-03-04"}</lastmod></url>`).join("")}</urlset>`;
  assert.match(
    (await sitemapRun({ [O + "/sitemap.xml"]: dated(10) })).findings.get("sitemap-lastmod-same")?.evidence[0].detail ||
      "",
    /^9 of 10 entries: 2026-11-01/,
  );
  assert.ok(
    !(await sitemapRun({ [O + "/sitemap.xml"]: dated(5) })).findings.has("sitemap-lastmod-same"),
    "4 of 5 is 80%",
  );
});

test("image and video sitemap tags Google has retired get a note", async () => {
  const body = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"><url><loc>${O}/a/</loc><image:image><image:loc>${O}/a.jpg</image:loc><image:caption>A</image:caption><image:title>T</image:title></image:image><video:video><video:thumbnail_loc>${O}/t.jpg</video:thumbnail_loc><video:title>V</video:title><video:description>D</video:description><video:player_loc autoplay="ap=1">${O}/p</video:player_loc><video:category>C</video:category></video:video></url></urlset>`;
  const r = await sitemapRun({ [O + "/sitemap.xml"]: body });
  const note = r.notes.find(n => /retired|removed/.test(n));
  assert.ok(note, r.notes.join("\n"));
  for (const t of ["<image:caption>", "<image:title>", "<video:category>", "autoplay"]) assert.ok(note.includes(t), t);
  assert.ok(!note.includes("<image:loc>"));
  assert.ok(!(await sitemapRun({ [O + "/sitemap.xml"]: urlset(O + "/a/") })).notes.some(n => /retired/.test(n)));
});

// Pages ({ "/path/": html }) served from a temp folder and crawled as O (--site-origin), as crawl-scope.test.mjs does.
const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts. ".repeat(
    2,
  );
const page = (title, body = "", head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;
async function crawlSite(pages, { robots = "User-agent: *\nAllow: /\n", args = [], start = "/", ...serveOpts } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  if (robots != null) writeFileSync(join(dir, "robots.txt"), robots);
  const site = await serve(dir, serveOpts);
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url + start, "--site-origin", O, "--out", out, ...args]);
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const pathsOf = (r, check) => (findingOf(r, check)?.evidence || []).map(e => new URL(e.url).pathname).sort();
const smFile = (...paths) => ({ type: "application/xml", body: Buffer.from(urlset(...paths.map(p => O + p))) });
let mappedRun;
const mapped = () =>
  (mappedRun ||= crawlSite(
    {
      "/": page(
        "Boiler repairs in Leeds",
        `<a href="/a/">A</a> <a href="/b/">B</a> <a href="/gone/">Old offer</a> <a href="${O}/linked/">Linked by full URL</a> <a href="/guide/">Guide</a>`,
      ),
      "/guide/": page("How to fix a 404 error page on your site"),
      "/a/": page("Boiler servicing", "", `<link rel="canonical" href="${O}/b/">`),
      "/b/": page("Boiler servicing in Leeds", "", `<link rel="canonical" href="${O}/b/">`),
      "/gone/": page("Page not found"),
      "/linked/": page("Radiator repairs"),
    },
    {
      robots: `User-agent: *\nAllow: /\nSitemap: ${O}/sitemap.xml\n`,
      files: { "/sitemap.xml": smFile("/", "/a/", "/b/") },
    },
  ));

test("a sitemap URL whose page is canonical to another URL is sitemap-noncanonical", async () => {
  const r = await mapped();
  assert.deepEqual(pathsOf(r, "sitemap-noncanonical"), ["/a/"]);
  assert.match(findingOf(r, "sitemap-noncanonical").evidence[0].detail, /canonical → https:\/\/site\.example\/b\//);
});

test("a small, well-linked site without a sitemap gets the low sitemap-missing-small; a big, capped or deep one keeps sitemap-missing", async () => {
  const pages = {
    "/": page("Boiler repairs in Leeds", '<a href="/about/">About</a>'),
    "/about/": page("About our engineers"),
  };
  const small = await crawlSite(pages, { robots: null });
  assert.equal(findingOf(small, "sitemap-missing-small")?.severity, "low");
  assert.ok(!findingOf(small, "sitemap-missing"));
  assert.equal(findingOf(small, "robots-missing")?.severity, "low");
  // Stopped by --max: the site's size isn't known.
  const capped = await crawlSite(pages, { robots: null, args: ["--max", "1"] });
  assert.ok(findingOf(capped, "sitemap-missing") && !findingOf(capped, "sitemap-missing-small"));
  // A page more than three clicks from the home page: not linked well enough to go without one.
  const deep = await crawlSite(
    {
      "/": page("Home page", '<a href="/1/">1</a>'),
      "/1/": page("One", '<a href="/2/">2</a>'),
      "/2/": page("Two", '<a href="/3/">3</a>'),
      "/3/": page("Three", '<a href="/4/">4</a>'),
      "/4/": page("Four"),
    },
    { robots: null },
  );
  assert.ok(
    findingOf(deep, "deep-page") && findingOf(deep, "sitemap-missing") && !findingOf(deep, "sitemap-missing-small"),
  );
});

test("a 200 page whose title or H1 reads like an error page is soft-404-page", async () => {
  const r = await mapped();
  assert.deepEqual(pathsOf(r, "soft-404-page"), ["/gone/"]);
  assert.equal(findingOf(r, "soft-404-page").severity, "high");
});

test("a made-up URL is probed in each top section; a 200 with noindex is the low soft-404-noindex", async () => {
  // The fetcher's follow and get, answered from memory: /blog/ answers 200 for any slug, /shop/ 200 with a noindex, the
  // rest 404. (An in-process fetch here trips a libuv assertion on Windows under --test-force-exit.)
  const answer = u => {
    const p = new URL(u).pathname,
      body = p.startsWith("/blog/")
        ? page("Blog post")
        : p.startsWith("/shop/")
          ? page("Shop", "", '<meta name="robots" content="noindex">')
          : null;
    return {
      status: body ? 200 : 404,
      body: body || "",
      headers: new Headers(),
      chain: [{ url: u, status: body ? 200 : 404 }],
      finalUrl: u,
    };
  };
  const asked = [],
    follow = async u => (asked.push(new URL(u).pathname), answer(u)),
    get = async u => answer(u);
  const realFetch = globalThis.fetch,
    st = store();
  globalThis.fetch = async () => new Response("", { status: 404 }); // the Markdown probe
  try {
    const pages = new Map(
      ["/", "/blog/a/", "/blog/b/", "/shop/x/", "/about/"].map(p => [
        O + p,
        { url: O + p, finalUrl: O + p, html: true, status: 200 },
      ]),
    );
    await probeSite({
      start: new URL(O + "/"),
      startOrigin: O,
      expectOrigin: O,
      checkLive: false,
      ua: "seo-supervisor-test",
      home: null,
      add: st.add,
      evalRules: st.evalRules,
      notes: st.notes,
      follow,
      get,
      pages,
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(
    asked.map(p => p.replace(/[^/]+$/, "")),
    ["/", "/blog/", "/shop/"],
    "the root, then each section with pages below it",
  );
  const at = k => (st.findings.get(k)?.evidence || []).map(e => new URL(e.url).pathname);
  assert.equal(at("soft-404").length, 1);
  assert.match(at("soft-404")[0], /^\/blog\/seo-supervisor-404-probe-/);
  assert.equal(at("soft-404-noindex").length, 1);
  assert.match(at("soft-404-noindex")[0], /^\/shop\/seo-supervisor-404-probe-/);
  assert.equal(CHECKS["soft-404-noindex"][1], "low");
});

test("many old URLs redirecting to the home page, or to one single page, are flagged", async () => {
  const list = join(tmp(), "old.txt");
  const merged = Array.from({ length: 10 }, (_, i) => `/m${i}`);
  writeFileSync(list, ["/old-a", "/old-b", "/old-c/", "/kept", "/two-1", ...merged].join("\n"));
  const target = p =>
    p.startsWith("/old-") ? "/" : p.startsWith("/m") ? "/merged/" : p.startsWith("/two-") ? "/two/" : "/kept/";
  const follow = async u => {
    const to = O + target(new URL(u).pathname);
    return to === u
      ? { status: 200, finalUrl: u, chain: [{ url: u, status: 200 }] }
      : {
          status: 200,
          finalUrl: to,
          chain: [
            { url: u, status: 301 },
            { url: to, status: 200 },
          ],
        };
  };
  const st = store();
  await oldUrls(
    { pages: new Map(), all: [], add: st.add, evalRules: st.evalRules, notes: st.notes, startOrigin: O, follow },
    { urlList: list, nextManifest: null },
  );
  const ev = st.findings.get("old-urls-same-target")?.evidence || [];
  assert.deepEqual(
    ev.map(e => e.url),
    [O + "/", O + "/merged/"],
  );
  assert.match(ev[0].detail, /^3 old URLs redirect here, e\.g\. \/old-a, \/old-b, \/old-c/);
  assert.match(ev[1].detail, /^10 old URLs/);
  assert.equal(CHECKS["old-urls-same-target"][0], "URL-07");
});

test("on a local crawl with --site-origin, a link written as a full public URL is followed on the crawl", async () => {
  const r = await mapped();
  assert.ok(
    r.pages.some(p => new URL(p.url).pathname === "/linked/"),
    r.pages.map(p => p.url).join(" "),
  );
});

test("a one-URL check (--max 1 on a deep URL) reads that page alone", async () => {
  const r = await crawlSite(
    {
      "/": page("Boiler repairs in Leeds", '<a href="/a/">A</a>'),
      "/a/": page("Boiler servicing", '<a href="/a/b/">B</a>'),
      "/a/b/": page("Boiler servicing prices"),
    },
    { start: "/a/b/", args: ["--max", "1"] },
  );
  assert.deepEqual(
    r.pages.map(p => new URL(p.url).pathname),
    ["/a/b/"],
  );
  assert.equal(r.stats.fetched, 1);
  // Its own page checks ran on it.
  assert.ok(r.findings.some(f => f.check === "canonical-missing" && new URL(f.evidence[0].url).pathname === "/a/b/"));
});

test("both Cloudflare robots.txt blocks are recognised, in any case, and the report names both", () => {
  for (const body of [
    "# BEGIN Cloudflare Managed content\nUser-agent: GPTBot\nDisallow: /\n# END Cloudflare Managed Content\n",
    "# begin cloudflare bot preference sync\nUser-agent: GPTBot\nDisallow: /\n",
    "# BEGIN CLOUDFLARE MANAGED CONTENT\n",
  ]) {
    const extra = {},
      s = store();
    aiRobotRules({ robots: { groups: [] }, robotsRes: { body } }, { add: s.add, extra, startOrigin: O });
    assert.equal(extra.botPreferenceSync, true, body);
  }
  const extra = {};
  aiRobotRules(
    {
      robots: { groups: [] },
      robotsRes: { body: "# Cloudflare Managed content is mentioned here\nUser-agent: *\nAllow: /\n" },
    },
    { add: () => {}, extra, startOrigin: O },
  );
  assert.equal(extra.botPreferenceSync, undefined, "only the BEGIN line counts");
  const sink = JSON.parse(readFileSync(new URL("./golden/kitchen-sink.json", import.meta.url), "utf8"));
  assert.equal(sink.botPreferenceSync, true);
  const { md } = render(sink, { dir: tmp(), mdFile: "r.md" });
  assert.match(md, /# BEGIN Cloudflare Managed content/);
  assert.match(md, /# BEGIN Cloudflare Bot Preference Sync/);
});
