import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { serve } from "./serve.mjs";
import { checkBacklinks, allNofollow } from "../skills/seo-supervisor/scripts/backlinks.mjs";
import { commonCrawl } from "../skills/seo-supervisor/scripts/commoncrawl.mjs";

// ---------- links-import.mjs ----------
const LINKS = join(SCRIPTS, "links-import.mjs");
async function importLinks(files, { previous, keys, crawl } = {}) {
  const dir = tmp(),
    links = join(dir, "links"),
    out = join(dir, "links.json"),
    args = [];
  mkdirSync(links);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(links, name), text);
  if (previous) {
    writeFileSync(join(dir, "previous.json"), JSON.stringify(previous));
    args.push("--previous", join(dir, "previous.json"));
  }
  if (keys) {
    writeFileSync(join(dir, "keys.json"), JSON.stringify(keys));
    args.push("--keys", join(dir, "keys.json"));
  }
  if (crawl) {
    writeFileSync(join(dir, "crawl.json"), JSON.stringify(crawl));
    args.push("--crawl", join(dir, "crawl.json"));
  }
  const r = await node([LINKS, "--dir", links, "--site", "https://www.acme.com", "--out", out, ...args]);
  return { ...JSON.parse(readFileSync(out, "utf8")), stdout: r.stdout };
}

test("new linking sites come from comparing this Top linking sites export with the previous one", async () => {
  const previous = {
    links: {
      sites: [
        { domain: "old.example", links: 5 },
        { domain: "Gone.example", links: 2 },
      ],
      when: "2026-10-01T00:00:00.000Z",
    },
    linkSummary: { sites: 2, pages: null, bingPages: null },
  };
  const r = await importLinks(
    { "sites.csv": "Site,Linking pages\nold.example,6\nnew.example,3\nfresh.example,9\nacme.com,4\n" },
    { previous },
  );
  assert.deepEqual(
    r.newLinks,
    {
      count: 2,
      sites: [
        { domain: "fresh.example", links: 9 },
        { domain: "new.example", links: 3 },
      ],
      since: "2026-10-01T00:00:00.000Z",
      capped: false,
    },
    "most links first; the site itself isn't a new linking site",
  );
  assert.match(r.stdout, /2 new linking sites/);

  const same = await importLinks({ "sites.csv": "Site,Linking pages\nold.example,6\nGONE.example,1\n" }, { previous });
  assert.equal(same.newLinks, null, "the same sites: nothing new");
  assert.equal(
    (await importLinks({ "sites.csv": "Site,Linking pages\nnew.example,3\n" })).newLinks,
    null,
    "no previous export: nothing to compare",
  );
  assert.equal(
    (
      await importLinks(
        { "sites.csv": "Site,Linking pages\nnew.example,3\n" },
        { previous: { linkSummary: { sites: 4 } } },
      )
    ).newLinks,
    null,
    "a previous run without the list of sites",
  );

  const big = {
    links: {
      sites: Array.from({ length: 1000 }, (_, i) => ({ domain: `s${i}.example`, links: 1 })),
      when: "2026-10-01T00:00:00.000Z",
    },
  };
  const capped = await importLinks(
    { "sites.csv": "Site,Linking pages\ns1.example,3\nbrand-new.example,2\n" },
    { previous: big },
  );
  assert.equal(capped.newLinks.capped, true, "with 1,000 rows, a site past the cut may only look new");
});

const page = (path, more = {}) => ({
  url: `https://www.acme.com${path}`,
  status: 200,
  noindex: false,
  canonical: `https://www.acme.com${path}`,
  ...more,
});
const CRAWL = {
  pages: [
    page("/"),
    page("/guide/"),
    page("/quiet/", { canonical: null }),
    page("/hidden/", { noindex: true }),
    page("/copy/", { canonical: "https://www.acme.com/guide/" }),
    page("/also-quiet/?x=1"),
  ],
  errors: [],
  redirects: [],
};

test("pages nobody links to come from the crawl joined with Top linked pages, information only", async () => {
  const pages = "Target page,Incoming links\nhttps://www.acme.com/,10\nhttp://acme.com/guide/,2\n";
  const r = await importLinks({ "pages.csv": pages }, { crawl: CRAWL });
  assert.deepEqual(
    r.unlinkedPages,
    { count: 2, of: 4, urls: ["https://www.acme.com/quiet/", "https://www.acme.com/also-quiet/?x=1"] },
    "noindex and canonicalised pages are left out; www and http are the same page",
  );
  assert.deepEqual(r.findings, [], "never a finding");

  const bing = await importLinks(
    { "pages.csv": pages },
    {
      crawl: CRAWL,
      keys: {
        bing: {
          backlinks: {
            pages: [
              { url: "https://www.acme.com/quiet/", count: 1 },
              { url: "https://www.acme.com/also-quiet/?x=1", count: 1 },
            ],
          },
        },
      },
    },
  );
  assert.equal(bing.unlinkedPages, null, "Bing's linked pages count too; every page linked is quiet");
  assert.equal(
    (await importLinks({ "sites.csv": "Site,Linking pages\nnew.example,3\n" }, { crawl: CRAWL })).unlinkedPages,
    null,
    "no Top linked pages export: not judged",
  );

  const full =
    "Target page,Incoming links\n" +
    Array.from({ length: 1000 }, (_, i) => `https://www.acme.com/p${i}/,1`).join("\n") +
    "\n";
  const capped = await importLinks({ "pages.csv": full }, { crawl: CRAWL });
  assert.equal(capped.unlinkedPages, null, "a 1,000-row export may leave linked pages out");
  assert.ok(capped.notes.some(n => /1,000/.test(n) && /links from other sites/.test(n)));
});

const out = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}.example`, 1]));
test("sites the crawl links to that also link back are a worthALook kind from 10 sites and 10% of them", async () => {
  const sites = n => "Site,Linking pages\n" + Array.from({ length: n }, (_, i) => `p${i}.example,2`).join("\n") + "\n";
  const crawl = {
    ...CRAWL,
    linksToOtherSites: { pages: {}, domains: { ...out(9), "blog.p9.example": 1, "unrelated.example": 4 } },
  };
  const r = await importLinks({ "sites.csv": sites(20) }, { crawl });
  const item = r.worthALook.find(x => x.kind === "reciprocal");
  assert.ok(item, "10 of 20 linking sites are also linked to (a subdomain counts for its root domain)");
  assert.match(item.why, /10 of the 20 sites/);
  assert.match(item.look, /Link to me and I'll link to you/);
  assert.match(item.look, /Only disavow/);
  assert.equal(item.examples.length, 5);

  const nine = await importLinks(
    { "sites.csv": sites(20) },
    { crawl: { ...CRAWL, linksToOtherSites: { pages: {}, domains: out(9) } } },
  );
  assert.ok(!nine.worthALook.some(x => x.kind === "reciprocal"), "9 sites: quiet");
  const share = await importLinks(
    { "sites.csv": sites(200) },
    { crawl: { ...CRAWL, linksToOtherSites: { pages: {}, domains: out(12) } } },
  );
  assert.ok(!share.worthALook.some(x => x.kind === "reciprocal"), "12 of 200 is under 10%: quiet");
});

const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
test("Latest links dates say when no new link has been found for 3 months or more", async () => {
  const latest = (...days) =>
    "Linking page,Last crawled\n" + days.map((d, i) => `https://s${i}.example/a,${day(d)}`).join("\n") + "\n";
  const r = await importLinks({ "Latest links.csv": latest(200, 130, 400) });
  assert.deepEqual(r.noNewLinks, { newest: day(130), asOf: day(0) });
  assert.equal(
    (await importLinks({ "latest-links.csv": latest(200, 20) })).noNewLinks,
    null,
    "a link found 20 days ago: quiet",
  );
  assert.equal(
    (await importLinks({ "More sample links.csv": latest(200, 130) })).noNewLinks,
    null,
    "a sample isn't sorted by discovery, so it can't tell",
  );
  assert.ok(
    r.notes.some(n => n.includes("Latest links.csv") && /backlinks\.mjs/.test(n)),
    "still pointed at backlinks.mjs",
  );
});

// ---------- backlinks.mjs ----------
const SITE = "https://www.example.com";
const anyAddress = { allow: async () => true };
const html = body => ({ type: "text/html; charset=utf-8", body: `<!doctype html><title>t</title>${body}` });

test("the backlink check records each link's target and text, and a linking page that's nofollow as a whole", async () => {
  const srv = await serve(tmp(), {
    files: {
      "/a": html(
        `<a href="https://www.example.com/pricing">See <b>pricing</b> &amp; plans</a> <a href="https://example.com/"><img alt="Example logo" src="x.png"></a>`,
      ),
      "/meta": html(`<meta name="robots" content="noindex, nofollow"><a href="https://www.example.com/">us</a>`),
      "/header": html(`<a href="https://www.example.com/">us</a>`),
      "/bing": html(`<a href="https://www.example.com/">us</a>`),
      "/wrapped": html(`<a href="https://www.youtube.com/redirect?q=https%3A%2F%2Fwww.example.com%2Fdemo">demo</a>`),
    },
    headers: { "/header": { "X-Robots-Tag": "googlebot: nofollow" }, "/bing": { "X-Robots-Tag": "bingbot: nofollow" } },
  });
  try {
    const { backlinks } = await checkBacklinks(
      ["/a", "/meta", "/header", "/bing", "/wrapped"].map(p => srv.url + p),
      SITE,
      anyAddress,
    );
    const found = Object.fromEntries(backlinks.found.map(f => [f.url.slice(srv.url.length), f]));
    assert.deepEqual(
      found["/a"].links,
      [
        { href: "https://www.example.com/pricing", text: "See pricing & plans", rel: "" },
        { href: "https://example.com/", text: "Example logo", rel: "" },
      ],
      "text without tags, an image link's alt",
    );
    assert.equal(
      found["/wrapped"].links[0].href,
      "https://www.example.com/demo",
      "the address a redirect wrapper holds",
    );
    assert.equal(found["/meta"].pageNofollow, "robots meta tag");
    assert.equal(found["/header"].pageNofollow, "X-Robots-Tag header");
    assert.equal(found["/bing"].pageNofollow, undefined, "a rule for another crawler doesn't count");
    assert.deepEqual(backlinks.nofollow, [
      { url: srv.url + "/meta", rel: "nofollow", page: "robots meta tag" },
      { url: srv.url + "/header", rel: "nofollow", page: "X-Robots-Tag header" },
    ]);
  } finally {
    await srv.close();
  }
});

test("linking sites whose every live link is nofollow, sponsored or ugc are summarised", () => {
  const live = [
    { url: "https://a.example/1", rel: "nofollow" },
    { url: "https://www.a.example/2", rel: null, page: "robots meta tag" },
    { url: "https://b.example/1", rel: "sponsored" },
    { url: "https://b.example/2", rel: null },
    { url: "https://c.example/1", rel: null },
  ];
  assert.deepEqual(allNofollow(live), [{ site: "a.example", pages: 2 }]);
  assert.deepEqual(allNofollow([{ url: "https://c.example/1", rel: null }]), [], "a followed link: quiet");
});

// ---------- seo-crawl.mjs ----------
test("every crawl counts links to other sites per page, with no request to them", async () => {
  const root = tmp(),
    hits = [];
  mkdirSync(join(root, "about"));
  writeFileSync(
    join(root, "index.html"),
    `<!doctype html><html lang="en"><title>Home page of the site</title><a href="https://en.wikipedia.org/wiki/SEO">w</a> <a href="https://www.w3.org/">w3</a> <a href="https://en.wikipedia.org/wiki/SEO#x">again</a> <a href="/about/">about</a> <a href="mailto:x@y.example">m</a></html>`,
  );
  writeFileSync(
    join(root, "about", "index.html"),
    `<!doctype html><html lang="en"><title>About the site</title><a href="/">home</a></html>`,
  );
  const site = await serve(root, {
      before(req) {
        hits.push(req.url);
        return false;
      },
    }),
    file = join(tmp(), "crawl.json");
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--site-origin",
      "https://site.example",
      "--out",
      file,
    ]);
  } finally {
    await site.close();
  }
  const c = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(c.linksToOtherSites, {
    pages: { [site.url + "/"]: 2, [site.url + "/about/"]: 0 },
    domains: { "en.wikipedia.org": 1, "w3.org": 1 },
  });
  assert.ok(!c.findings.some(f => f.check === "outbound-broken"), "information only");
});

// ---------- commoncrawl.mjs ----------
const CC = join(SCRIPTS, "commoncrawl.mjs");
const record = (url, body, headers = "") =>
  gzipSync(
    `WARC/1.0\r\nWARC-Type: response\r\nWARC-Target-URI: ${url}\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\n${headers}\r\n<!doctype html>${body}\r\n\r\n`,
  );
// One local server plays Common Crawl: collinfo.json, the CDX index and the WARC files (byte ranges only).
async function commonCrawlServer({ busy = false, api } = {}) {
  const recs = [
    [
      "https://news.example/story",
      record(
        "https://news.example/story",
        `<p>We use <a href="https://www.acme.com/tools/" rel="ugc">Acme's &lt;tools&gt;</a>.</p>`,
      ),
    ],
    [
      "https://blog.example/post",
      record("https://blog.example/post", `<p>No link here.</p>`, "X-Robots-Tag: nofollow\r\n"),
    ],
  ];
  let at = 100;
  const lines = {},
    file = Buffer.concat([
      Buffer.alloc(100),
      ...recs.map(([url, r]) => {
        lines[url] = {
          url,
          timestamp: "20261005123456",
          status: "200",
          mime: "text/html",
          filename: "crawl-data/CC-TEST/x.warc.gz",
          offset: String(at),
          length: String(r.length),
        };
        at += r.length;
        return r;
      }),
    ]);
  lines["https://big.example/page"] = {
    url: "https://big.example/page",
    timestamp: "20261005123456",
    status: "200",
    mime: "text/html",
    filename: "crawl-data/CC-TEST/x.warc.gz",
    offset: "0",
    length: String(5 * 1024 * 1024),
  };
  lines["https://moved.example/a"] = {
    url: "https://moved.example/a",
    timestamp: "20261005123456",
    status: "301",
    mime: "unk",
    filename: "crawl-data/CC-TEST/x.warc.gz",
    offset: "0",
    length: "10",
  };
  const hits = [];
  const srv = await serve(tmp(), {
    before(req, res) {
      const u = new URL(req.url, "http://x");
      hits.push({
        path: u.pathname,
        q: Object.fromEntries(u.searchParams),
        ua: req.headers["user-agent"],
        range: req.headers.range,
      });
      if (u.pathname === "/collinfo.json") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify([
            { id: "CC-TEST", name: "October 2026 Index", "cdx-api": api || `http://${req.headers.host}/CC-TEST-index` },
            { id: "CC-OLD", name: "Old", "cdx-api": `http://${req.headers.host}/CC-OLD-index` },
          ]),
        );
        return true;
      }
      if (u.pathname === "/CC-TEST-index") {
        const q = u.searchParams.get("url");
        if (u.searchParams.get("matchType") === "domain") {
          const caps = [
            ["https://www.acme.com/", "200"],
            ["https://www.acme.com/a", "200"],
            ["https://www.acme.com/a", "301"],
          ];
          res
            .writeHead(200)
            .end(
              caps.map(([url, status]) => JSON.stringify({ url, status, timestamp: "20261005000000" })).join("\n") +
                "\n",
            );
          return true;
        }
        if (busy) {
          res.writeHead(503).end("Slow down");
          return true;
        }
        if (!lines[q]) {
          res.writeHead(404).end(JSON.stringify({ message: `No Captures found for: ${q}` }));
          return true;
        }
        res.writeHead(200).end(JSON.stringify(lines[q]) + "\n");
        return true;
      }
      if (u.pathname === "/crawl-data/CC-TEST/x.warc.gz") {
        const [, a, b] = /bytes=(\d+)-(\d+)/.exec(req.headers.range || "") || [];
        if (a == null) {
          res.writeHead(200).end(file);
          return true;
        }
        res.writeHead(206, { "Content-Range": `bytes ${a}-${b}/${file.length}` }).end(file.subarray(+a, +b + 1));
        return true;
      }
      res.writeHead(404).end();
      return true;
    },
  });
  return { ...srv, hits, opts: { collinfo: srv.url + "/collinfo.json", data: srv.url + "/", pause: 0 } };
}

test("Common Crawl's index says whether the site is in it, and its saved copies of known linking pages show the links", async () => {
  const srv = await commonCrawlServer();
  try {
    const pages = [
      "https://news.example/story",
      "https://blog.example/post",
      "https://nowhere.example/x",
      "https://big.example/page",
      "https://moved.example/a",
    ];
    const { commonCrawl: cc, notes } = await commonCrawl("https://www.acme.com", pages, srv.opts);
    assert.deepEqual(
      cc.crawl,
      { id: "CC-TEST", name: "October 2026 Index" },
      "the newest crawl, first in collinfo.json",
    );
    assert.deepEqual(cc.site, { captures: 3, capped: false, pages: 2, home: true });
    const by = Object.fromEntries(cc.linkingPages.map(p => [p.url, p]));
    assert.deepEqual(by["https://news.example/story"], {
      url: "https://news.example/story",
      state: "links",
      captured: "2026-10-05",
      links: [{ href: "https://www.acme.com/tools/", text: "Acme's <tools>", rel: "ugc" }],
    });
    assert.equal(by["https://blog.example/post"].state, "no-link");
    assert.equal(by["https://nowhere.example/x"].state, "not-in-crawl");
    assert.equal(by["https://big.example/page"].state, "not-read");
    assert.match(by["https://big.example/page"].reason, /larger than 1 MB/);
    assert.equal(by["https://moved.example/a"].state, "not-read");
    assert.match(by["https://moved.example/a"].reason, /301/);
    assert.deepEqual(cc.linkingSites, ["news.example"]);
    assert.deepEqual(notes, []);
    const site = srv.hits.find(h => h.q.matchType === "domain");
    assert.equal(site.q.url, "acme.com", "the whole domain, www and subdomains");
    assert.ok(
      srv.hits.every(h => h.ua === "seo-supervisor-commoncrawl"),
      "a clear user agent",
    );
    assert.ok(
      srv.hits.filter(h => h.path.startsWith("/crawl-data/")).every(h => /^bytes=\d+-\d+$/.test(h.range)),
      "only the saved page's bytes are read, never a whole file",
    );
    assert.equal(
      srv.hits.filter(h => h.path.startsWith("/crawl-data/")).length,
      2,
      "the big and moved pages aren't downloaded",
    );
  } finally {
    await srv.close();
  }
});

test("Common Crawl: a busy index stops the lookups, and an index address elsewhere isn't used", async () => {
  const busy = await commonCrawlServer({ busy: true });
  try {
    const { commonCrawl: cc, notes } = await commonCrawl(
      "https://www.acme.com",
      ["https://news.example/story", "https://blog.example/post"],
      busy.opts,
    );
    assert.deepEqual(
      cc.linkingPages.map(p => p.state),
      ["not-checked", "not-checked"],
    );
    assert.equal(
      busy.hits.filter(h => h.path === "/CC-TEST-index" && !h.q.matchType).length,
      1,
      "one refusal, then no more asking",
    );
    assert.ok(notes.some(n => /busy/.test(n) && /503/.test(n)));
  } finally {
    await busy.close();
  }
  const moved = await commonCrawlServer({ api: "https://elsewhere.example/index" });
  try {
    const { commonCrawl: cc, notes } = await commonCrawl(
      "https://www.acme.com",
      ["https://news.example/story"],
      moved.opts,
    );
    assert.equal(cc, null);
    assert.ok(notes.some(n => /elsewhere\.example/.test(n)));
    assert.deepEqual(
      moved.hits.map(h => h.path),
      ["/collinfo.json"],
    );
  } finally {
    await moved.close();
  }
});

test("Common Crawl without --yes is a dry run that says what it would download, and contacts nothing", async () => {
  const dir = tmp(),
    file = join(dir, "cc.json");
  writeFileSync(join(dir, "list.txt"), "https://news.example/a\nhttps://blog.example/b\n");
  const r = await node([CC, "--site", "https://www.acme.com", "--urls", join(dir, "list.txt"), "--out", file]);
  assert.match(r.stdout, /dry run/i);
  assert.match(r.stdout, /index\.commoncrawl\.org/);
  assert.match(r.stdout, /2 known linking pages/);
  assert.match(r.stdout, /at most \d+(\.\d)? MB/);
  assert.match(r.stdout, /2\.4 GB/, "says why the full web graph isn't downloaded");
  assert.match(r.stdout, /--yes/);
  assert.ok(!existsSync(file), "a dry run writes nothing");
});

// ---------- the report ----------
const render = async edit => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SCRIPTS, "..", "examples", "sample-audit.json"), "utf8"));
  edit(data);
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};
const EVIL = "<img src=x onerror=alert(1)>";

test("the report's More about links section shows the imported link data, escaped, and nothing without it", async () => {
  const { html, md } = await render(d => {
    d.links = { sites: [{ domain: "a.example", links: 3 }], pages: [], texts: [], when: "2026-11-20T00:00:00.000Z" };
    d.newLinks = {
      count: 2,
      sites: [
        { domain: `new${EVIL}.example`, links: 3 },
        { domain: "fresh.example", links: 1 },
      ],
      since: "2026-10-01T00:00:00.000Z",
      capped: false,
    };
    d.noNewLinks = { newest: "2026-07-01", asOf: "2026-11-20" };
    d.unlinkedPages = { count: 2, of: 9, urls: ["https://www.acme.com/quiet/", `https://www.acme.com/${EVIL}`] };
    d.backlinks = {
      checked: 3,
      live: 2,
      gone: [],
      unreachable: [],
      nofollow: [],
      nofollowSites: [{ site: "nf.example", pages: 2 }],
      found: [
        { url: "https://news.example/s", links: [{ href: "https://www.acme.com/", text: `Acme ${EVIL}`, rel: "" }] },
      ],
    };
    d.commonCrawl = {
      crawl: { id: "CC-MAIN-2026-43", name: "October 2026 Index" },
      site: { captures: 1000, capped: true, pages: 640, home: true },
      linkingPages: [
        { url: "https://news.example/s", state: "links" },
        { url: "https://b.example/", state: "no-link" },
        { url: "https://c.example/", state: "not-in-crawl" },
      ],
      linkingSites: ["news.example"],
    };
    d.linksToOtherSites = {
      pages: { "https://www.acme.com/": 3, "https://www.acme.com/about/": 0 },
      domains: { "w3.org": 2, "wikipedia.org": 1 },
    };
  });
  const det = html.match(/<details class="how morelinks">[\s\S]*?<\/details>/)?.[0];
  assert.ok(det, "a collapsed section on the Overview");
  assert.match(det, /<summary>More about links<\/summary>/);
  assert.match(det, /2 new sites link to you since the last export \(1 Oct 2026\)/);
  assert.ok(det.includes("new&lt;img src=x onerror=alert(1)&gt;.example"));
  assert.match(det, /found after 1 Jul 2026/);
  assert.match(det, /2 of your 9 crawled pages/);
  assert.match(det, /nf\.example/);
  assert.match(det, /Acme &lt;img/);
  assert.match(det, /October 2026 Index/);
  assert.match(det, /1,000 or more/);
  assert.match(det, /1 of 3 known linking pages/);
  assert.match(det, /1 of your 2 crawled pages links to other sites/);
  assert.match(det, /isn(&#39;|')t a comprehensive list/, "how much the free data covers");
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(md, /^## More about links$/m);
  assert.ok(md.includes("`new<img src=x onerror=alert(1)>.example`"), "third-party names in code spans");
  assert.ok(md.includes("isn't a comprehensive list"));

  const none = await render(() => {});
  for (const junk of [
    {
      newLinks: "x",
      noNewLinks: { newest: "soon" },
      unlinkedPages: { count: "2" },
      commonCrawl: [],
      linksToOtherSites: { pages: "x" },
    },
    { backlinks: { nofollowSites: "x", found: 3 } },
  ]) {
    const r = await render(d => Object.assign(d, junk));
    assert.equal(r.html, none.html, `junk ${JSON.stringify(junk)} adds nothing`);
    assert.equal(r.md, none.md);
  }
});
