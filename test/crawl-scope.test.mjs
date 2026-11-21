import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { otherSiteTargets, linksBack } from "../skills/seo-supervisor/scripts/checks/hreflang.mjs";

const ORIGIN = "https://site.example";
const COPY =
  "Our engineers fix leaks, radiators and hot water faults across the city every day of the week, with a clear written estimate before any work starts and a tidy finish afterwards. ".repeat(
    2,
  );
const page = (title, body = "", head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head><body><main><h1>${title}</h1><p>${COPY}</p>${body}</main></body></html>`;
const xml = body => ({ type: "application/xml", body: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${body}`) });
const urlset = paths =>
  xml(
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(p => `<url><loc>${ORIGIN}${p.replace(/&/g, "&amp;")}</loc></url>`).join("")}</urlset>`,
  );

// Pages ({ "/path/": html }) served from a temp folder and crawled as ORIGIN.
async function crawlSite(pages, { robots = "User-agent: *\nAllow: /\n", args = [], env, ...serveOpts } = {}) {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  for (const [p, html] of Object.entries(pages)) {
    mkdirSync(join(dir, p), { recursive: true });
    writeFileSync(join(dir, p, "index.html"), html);
  }
  writeFileSync(join(dir, "robots.txt"), robots);
  const site = await serve(dir, serveOpts);
  const origin = args.includes("--site-origin") ? [] : ["--site-origin", ORIGIN];
  try {
    await node(
      [join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, ...origin, "--out", out, ...args],
      env ? { env } : {},
    );
  } finally {
    await site.close();
  }
  return JSON.parse(readFileSync(out, "utf8"));
}
const findingOf = (r, check) => r.findings.find(f => f.check === check);
const where = e => {
  const u = new URL(e.url);
  return u.pathname + u.search;
};
const pathsOf = (r, check) => (findingOf(r, check)?.evidence || []).map(where).sort();
const crawledPaths = r => r.pages.map(p => where(p)).sort();

// An ordinary site, used by every "stays quiet" assertion below.
let plainRun;
const plain = () =>
  (plainRun ||= crawlSite(
    {
      "/": page(
        "Boiler repairs and servicing in Leeds",
        '<a href="/about/">About the team</a> <img src="/logo.png" alt="Logo" width="10" height="10">',
      ),
      "/about/": page("About our Leeds heating engineers"),
    },
    {
      robots: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`,
      files: { "/sitemap.xml": urlset(["/", "/about/"]) },
    },
  ));

test("an ordinary site raises none of these checks, notes or data", async () => {
  const r = await plain();
  for (const key of ["parameter-page-indexable", "url-malformed"]) assert.ok(!findingOf(r, key), key);
  assert.ok(
    !r.passed.some(p => p.rule === "CRAWL-10") && !r.findings.some(f => f.rule === "CRAWL-10"),
    "CRAWL-10 counts only once a parameter page was crawled",
  );
  assert.ok(!r.notes.some(n => /robots\.txt names|didn't fetch|other sites/.test(n)), r.notes.join("\n"));
  assert.equal(r.siteSize, undefined);
  assert.equal(r.indexing, undefined);
  assert.equal(r.section, undefined);
  assert.ok(!r.notChecked.some(n => /other sites/.test(n.area)));
  assert.deepEqual(r.sections, [{ path: "/", pages: 2, share: 1 }]);
});

test("robots.txt groups with a /version tag match the bare name, and repeated groups for one bot are merged", async () => {
  const r = await crawlSite(
    { "/": page("Boiler repairs and servicing in Leeds") },
    {
      robots: [
        "User-agent: *",
        "Allow: /",
        "",
        "User-agent: GPTBot/1.1",
        "Disallow: /",
        "",
        "User-agent: ClaudeBot",
        "Disallow: /private/",
        "",
        "User-agent: ClaudeBot",
        "Disallow: /",
        "",
      ].join("\n"),
    },
  );
  assert.deepEqual((findingOf(r, "ai-bots-blocked")?.evidence || []).map(e => e.detail).sort(), [
    "ClaudeBot",
    "GPTBot",
  ]);
  const note = r.notes.find(n => /robots\.txt names/.test(n));
  assert.match(note || "", /GPTBot\/1\.1/);
  assert.match(note, /User-agent: GPTBot`/, "advises the bare name");
});

test("RSS and Atom feeds listed as sitemaps give their item and entry links", async () => {
  const rss = xml(
    `<rss version="2.0"><channel><title>Blog</title><link>${ORIGIN}/</link><item><title>A</title><link>${ORIGIN}/a/</link><pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate></item><item><title>B</title><link><![CDATA[${ORIGIN}/b/]]></link></item></channel></rss>`,
  );
  const atom = xml(
    `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><link href="${ORIGIN}/"/><entry><title>C</title><link rel="edit" href="${ORIGIN}/edit/c"/><link rel="alternate" href="${ORIGIN}/c/"/><updated>2026-11-17T10:00:00Z</updated></entry></feed>`,
  );
  const r = await crawlSite(
    {
      "/": page("Boiler repairs and servicing in Leeds"),
      "/a/": page("Article A about boilers"),
      "/b/": page("Article B about radiators"),
      "/c/": page("Article C about hot water"),
    },
    {
      robots: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/feed.xml\nSitemap: ${ORIGIN}/atom.xml\n`,
      files: { "/feed.xml": rss, "/atom.xml": atom },
    },
  );
  assert.deepEqual(
    r.stats.sitemapFiles.map(f => [new URL(f.url).pathname, f.urls]),
    [
      ["/feed.xml", 2],
      ["/atom.xml", 1],
    ],
  );
  assert.equal(r.stats.sitemapUrls, 3);
  assert.deepEqual(
    crawledPaths(r),
    ["/", "/a/", "/b/", "/c/"],
    "the feed's own <link> to the home page isn't a listed URL, nor is an edit link",
  );
  for (const key of ["sitemap-missing", "sitemap-invalid", "sitemap-lastmod-invalid"])
    assert.ok(!findingOf(r, key), key);
});

test("with no Sitemap: line, /sitemap-index.xml and /wp-sitemap.xml are tried too", async () => {
  const pages = { "/": page("Boiler repairs and servicing in Leeds"), "/a/": page("Article A about boilers") };
  const [index, wp] = await Promise.all([
    crawlSite(pages, { files: { "/sitemap-index.xml": urlset(["/", "/a/"]) } }),
    crawlSite(pages, {
      files: {
        "/wp-sitemap.xml": xml(
          `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${ORIGIN}/wp-sitemap-posts-post-1.xml</loc></sitemap></sitemapindex>`,
        ),
        "/wp-sitemap-posts-post-1.xml": urlset(["/", "/a/"]),
      },
    }),
  ]);
  for (const r of [index, wp]) {
    assert.equal(r.stats.sitemapUrls, 2);
    assert.ok(!findingOf(r, "sitemap-missing"));
  }
  assert.deepEqual(
    wp.stats.sitemapFiles.map(f => new URL(f.url).pathname),
    ["/wp-sitemap.xml", "/wp-sitemap-posts-post-1.xml"],
  );
});

test("an indexable copy of a page under a URL parameter is flagged; tracking, paging and canonicalized ones aren't", async () => {
  const r = await crawlSite(
    {
      "/": page("Boiler repairs and servicing in Leeds"),
      "/filter/": page("Radiators for every room"),
      "/shop/": page("Shop boilers and parts", "", `<link rel="canonical" href="${ORIGIN}/shop/">`),
    },
    {
      robots: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`,
      files: {
        "/sitemap.xml": urlset([
          "/",
          "/filter/",
          "/filter/?color=red&size=2",
          "/filter/?utm_source=news&gclid=1",
          "/filter/?page=2",
          "/shop/",
          "/shop/?color=red",
          "/blog/?sort=new",
        ]),
      },
    },
  );
  assert.deepEqual(pathsOf(r, "parameter-page-indexable"), ["/filter/?color=red&size=2"]);
  const f = findingOf(r, "parameter-page-indexable");
  assert.deepEqual([f.rule, f.severity], ["CRAWL-10", "medium"]);
  assert.match(f.evidence[0].detail, /color, size/);
});

test("a language version on ?lang= and a different page on ?page_id= aren't copies", async () => {
  const fr = page(
    "À propos de nos chauffagistes à Leeds",
    "",
    `<link rel="alternate" hreflang="fr" href="${ORIGIN}/about/?lang=fr"><link rel="alternate" hreflang="en" href="${ORIGIN}/about/">`,
  );
  const r = await crawlSite(
    {
      "/": page("Boiler repairs and servicing in Leeds"),
      "/about/": page(
        "About our Leeds heating engineers",
        "",
        `<link rel="alternate" hreflang="en" href="${ORIGIN}/about/"><link rel="alternate" hreflang="fr" href="${ORIGIN}/about/?lang=fr">`,
      ),
    },
    {
      robots: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`,
      files: { "/sitemap.xml": urlset(["/", "/about/", "/about/?lang=fr", "/?page_id=2"]) },
      before: (req, res) => {
        if (req.url === "/about/?lang=fr")
          return (res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fr), true);
        if (req.url === "/?page_id=2")
          return (
            res
              .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
              .end(page("Sample page for our boiler guide")),
            true
          );
        return false;
      },
    },
  );
  assert.deepEqual(
    pathsOf(r, "parameter-page-indexable"),
    [],
    JSON.stringify(findingOf(r, "parameter-page-indexable")?.evidence),
  );
});

test("link hrefs and image srcs no URL parser can read are listed", async () => {
  const r = await crawlSite({
    "/": page(
      "Boiler repairs and servicing in Leeds",
      '<a href="http://exa mple.com/">Partner</a> <a href="https://">Empty</a> <img src="https://:443/logo.png" alt="Logo"> <a href="/ok/">Fine</a> <a href="mailto:a@b.example">Mail</a>',
    ),
  });
  const f = findingOf(r, "url-malformed");
  assert.deepEqual([f?.rule, f?.severity, f?.count], ["CRAWL-07", "medium", 1]);
  assert.match(
    f.evidence[0].detail,
    /^3 address\(es\): http:\/\/exa mple\.com\/, https:\/\/, https:\/\/:443\/logo\.png$/,
  );
});

test("a 429 makes the crawler wait for Retry-After, then ask again", async () => {
  const asked = [];
  const r = await crawlSite(
    {
      "/": page("Boiler repairs and servicing in Leeds", '<a href="/about/">About</a>'),
      "/about/": page("About our Leeds heating engineers"),
    },
    {
      before(req, res) {
        if (req.url !== "/about/" || !/seo-supervisor-crawler/.test(req.headers["user-agent"])) return false;
        asked.push(Date.now());
        if (asked.length > 1) return false;
        res.writeHead(429, { "Retry-After": "1" }).end();
        return true;
      },
    },
  );
  assert.equal(r.pages.find(p => new URL(p.url).pathname === "/about/")?.status, 200);
  assert.deepEqual(r.errors, []);
  assert.ok(asked[1] - asked[0] >= 900, `asked again after ${asked[1] - asked[0]} ms`);
});

// /blog/ has two posts and a tag page; the rest of the site is top-level pages.
const SECTIONED = {
  "/": page(
    "Boiler repairs and servicing in Leeds",
    ["/blog/", "/blog/a/", "/blog/tag/boilers/", "/about/", "/contact/"].map(p => `<a href="${p}">${p}</a>`).join(" "),
  ),
  "/blog/": page("The boiler blog"),
  "/blog/a/": page("How to bleed a radiator"),
  "/blog/tag/boilers/": page("Posts about boilers"),
  "/about/": page("About our Leeds heating engineers"),
  "/contact/": page("Contact the Leeds team"),
};
const SECTIONED_MAP = {
  robots: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`,
  files: { "/sitemap.xml": urlset(Object.keys(SECTIONED)) },
};

test("--include and --exclude crawl one section, and the link checks that need the whole site say so", async () => {
  const r = await crawlSite(SECTIONED, { ...SECTIONED_MAP, args: ["--include", "/blog/", "--exclude", "blog/tag/"] });
  assert.deepEqual(crawledPaths(r), ["/", "/blog/", "/blog/a/"], "the start page, then only the section");
  assert.deepEqual(r.section, { include: ["/blog/"], exclude: ["/blog/tag/"] });
  for (const rule of ["LINK-01", "LINK-02"]) {
    assert.ok(!r.findings.some(f => f.rule === rule) && !r.passed.some(p => p.rule === rule), rule);
    assert.match(r.notChecked.find(n => n.rule === rule)?.reason || "", /--include or --exclude/);
  }
  assert.ok(r.notes.some(n => /paths starting with \/blog\//.test(n)));
});

test("pages per top-level section, and the site's size when the crawl stops at --max", async () => {
  const [all, capped] = await Promise.all([
    crawlSite(SECTIONED, SECTIONED_MAP),
    crawlSite(SECTIONED, { ...SECTIONED_MAP, args: ["--max", "2"] }),
  ]);
  assert.deepEqual(all.sections, [
    { path: "/", pages: 3, share: 0.5 },
    { path: "/blog/", pages: 3, share: 0.5 },
  ]);
  assert.equal(all.siteSize, undefined);
  assert.deepEqual(capped.siteSize, { crawled: 2, known: 6, sitemapUrls: 6 });
  assert.ok(
    capped.notes.some(n => /at least 6 URLs/.test(n)),
    capped.notes.join("\n"),
  );
});

test("Search Console's indexed count from the Page indexing export, beside the crawl's indexable count", async () => {
  const dir = tmp(),
    chart = join(dir, "Chart.csv"),
    perf = join(dir, "Pages.csv");
  writeFileSync(chart, '﻿Date,Not indexed,Indexed,Impressions\n2026-11-01,10,3,100\n2026-11-19,"1,204",4,200\n');
  writeFileSync(perf, "Top pages,Clicks,Impressions,CTR,Position\nhttps://site.example/,1,10,10%,3\n");
  const pages = {
    "/": page("Boiler repairs and servicing in Leeds", '<a href="/about/">About</a>'),
    "/about/": page("About our Leeds heating engineers"),
  };
  const [good, bad] = await Promise.all([
    crawlSite(pages, { args: ["--gsc-indexing", chart] }),
    crawlSite(pages, { args: ["--gsc-indexing", perf] }),
  ]);
  assert.deepEqual(good.indexing, {
    date: "2026-11-19",
    indexed: 4,
    notIndexed: 1204,
    crawlIndexable: 2,
    capped: false,
  });
  assert.ok(
    good.notes.some(n => /Search Console counted 4 indexed pages/.test(n)),
    good.notes.join("\n"),
  );
  assert.deepEqual(
    good.findings.map(f => f.check),
    bad.findings.map(f => f.check),
    "information only: no finding of its own",
  );
  assert.equal(bad.indexing, undefined);
  assert.ok(
    bad.notes.some(n => /--gsc-indexing/.test(n) && /Indexed/.test(n)),
    bad.notes.join("\n"),
  );
});

test("hreflang targets on other sites, and whether they link back", () => {
  const LOCAL = "http://127.0.0.1:4000";
  const pages = [
    {
      finalUrl: `${LOCAL}/en/`,
      hreflang: [
        { lang: "en", href: `${ORIGIN}/en/` },
        { lang: "de", href: "https://example.de/" },
        { lang: "x-default", href: "/en/" },
      ],
    },
    {
      finalUrl: `${LOCAL}/fr/`,
      hreflang: [
        { lang: "fr", href: "/fr/" },
        { lang: "de", href: "https://example.de/" },
      ],
    },
  ];
  assert.deepEqual(
    [...otherSiteTargets(pages, ORIGIN)],
    [
      [
        "https://example.de/",
        [
          { url: `${LOCAL}/en/`, lang: "de" },
          { url: `${LOCAL}/fr/`, lang: "de" },
        ],
      ],
    ],
  );
  const same = u => u.replace(ORIGIN, LOCAL);
  const back = [
    { lang: "en", href: `${ORIGIN}/en` },
    { lang: "de", href: "/" },
  ];
  assert.equal(
    linksBack(back, "https://example.de/", `${LOCAL}/en/`, same),
    true,
    "the public URL, without its slash, is the page",
  );
  assert.equal(linksBack(back, "https://example.de/", `${LOCAL}/fr/`, same), false);
  assert.equal(
    linksBack([{ lang: "en", href: "https://www.site.example/en/" }], "https://example.de/", `${LOCAL}/en/`, same),
    false,
    "another host isn't the page",
  );
});

test("other sites' hreflang pages are visited only with --outside and --hreflang-other-sites, and never at a private address", async () => {
  const pages = {
    "/": page(
      "Boiler repairs and servicing in Leeds",
      "",
      `<link rel="alternate" hreflang="en" href="https://site.test/"><link rel="alternate" hreflang="de" href="http://10.0.0.1:9/de/"><link rel="alternate" hreflang="x-default" href="https://site.test/">`,
    ),
  };
  // A closed local port stands in for PageSpeed, and node for the browser, so nothing leaves the machine.
  const outside = [
      "--site-origin",
      "https://site.test",
      "--outside",
      "--psi-endpoint",
      "http://127.0.0.1:9/runPagespeed",
    ],
    env = { ...process.env, CHROME_PATH: process.execPath };
  const [off, noYes, on] = await Promise.all([
    crawlSite(pages, { args: ["--site-origin", "https://site.test"] }),
    crawlSite(pages, { args: outside, env }),
    crawlSite(pages, { args: [...outside, "--hreflang-other-sites"], env }),
  ]);
  for (const r of [off, noYes])
    assert.match(
      r.notChecked.find(n => n.rule === "META-08" && /other sites/.test(n.area))?.reason || "",
      /1 hreflang target.*--hreflang-other-sites/,
    );
  assert.ok(!on.notChecked.some(n => /other sites/.test(n.area)));
  assert.ok(
    on.notes.some(n => /10\.0\.0\.1:9/.test(n) && /isn't a public address/.test(n)),
    on.notes.join("\n"),
  );
  assert.ok(
    !findingOf(on, "hreflang-no-return") && !findingOf(on, "hreflang-bad-target"),
    "a target that couldn't be visited isn't judged",
  );
});

test("the crawler doesn't follow a redirect or fetch a sitemap that leaves the site for a private or metadata address", async () => {
  const r = await crawlSite(
    {
      "/": page("Boiler repairs and servicing in Leeds", '<a href="/go/">Go</a> <a href="/about/">About</a>'),
      "/about/": page("About our Leeds heating engineers"),
    },
    {
      robots: `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\nSitemap: http://10.0.0.1/sitemap.xml\n`,
      files: { "/sitemap.xml": urlset(["/", "/about/"]) },
      before: (req, res) =>
        req.url === "/go/" &&
        (res.writeHead(301, { Location: "http://169.254.169.254/latest/meta-data/" }).end(), true),
    },
  );
  assert.deepEqual(crawledPaths(r), ["/", "/about/"], "the local site itself is crawled as usual");
  const note = r.notes.find(n => /didn't fetch/.test(n)) || "";
  assert.match(note, /169\.254\.169\.254/);
  assert.match(note, /10\.0\.0\.1/);
  assert.ok(!findingOf(r, "server-error"), "the redirect it didn't follow isn't a server error");
  assert.deepEqual(r.stats.sitemapFiles.find(f => f.url === "http://10.0.0.1/sitemap.xml")?.status, 0);
});

test("the report shows the site's sections, its size past --max and Search Console's indexed count, escaped", async () => {
  const dir = tmp();
  writeFileSync(
    join(dir, "a.json"),
    JSON.stringify({
      tool: "seo-supervisor-crawler",
      version: "2.0.0",
      siteOrigin: ORIGIN,
      crawledAt: "2026-11-21T10:00:00Z",
      stats: { htmlPages: 4 },
      findings: [],
      notChecked: [],
      notes: [],
      passed: [
        { rule: "CRAWL-01", title: "robots.txt lets search engines crawl the site", category: "Crawling & indexing" },
      ],
      sections: [
        { path: "/blog/", pages: 3, share: 0.75 },
        { path: "/<x>|y/", pages: 1, share: 0.25 },
      ],
      siteSize: { crawled: 4, known: 900, sitemapUrls: 850 },
      indexing: { date: "2026-11-19", indexed: 400, notIndexed: 1204, crawlIndexable: 4, capped: true },
    }),
  );
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "a.html")]);
  const html = readFileSync(join(dir, "a.html"), "utf8"),
    md = readFileSync(join(dir, "a.md"), "utf8");
  assert.match(html, /Site sections/);
  assert.match(html, /<code>\/&lt;x&gt;\|y\/<\/code><\/td><td>1<\/td><td>25%<\/td>/);
  assert.ok(!html.includes("/<x>"));
  assert.match(html, /at least 900 URLs/);
  assert.match(html, /Search Console counted 400 indexed pages/);
  assert.match(md, /## Crawl coverage\n\nThe crawl stopped/);
  assert.match(md, /### Site sections/);
  assert.match(md, /\| `\/<x>\\\|y\/` \| 1 \| 25% \|/);
  assert.match(md, /at least 900 URLs/);
});
