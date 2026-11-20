import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";
import { serve } from "./serve.mjs";

const CLI = join(SCRIPTS, "links-import.mjs");
// Writes the exports into a links/ folder (files: null leaves the folder out), runs links-import and returns its JSON.
async function importLinks(files, { brand, previous, keys, crawl } = {}) {
  const dir = tmp(),
    links = join(dir, "links"),
    out = join(dir, "links.json"),
    args = [];
  if (files) {
    mkdirSync(links);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(links, name), text);
  }
  if (brand) args.push("--brand", brand);
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
  await node([CLI, "--dir", links, "--site", "https://www.acme.com", "--out", out, ...args]);
  return JSON.parse(readFileSync(out, "utf8"));
}

test("reads the three Search Console link exports by header, in any column order", async () => {
  const r = await importLinks({
    "Top linking sites.csv": '﻿Linking pages,Site,Target pages\n12,news.example,3\n"1,200",blog.example,40\n',
    "Top linked pages.csv":
      "Linking sites,Incoming links,Target page\n2,12,https://www.acme.com/guide/\n3,900,https://www.acme.com/\n",
    "Top linking text.csv": 'Linking text\nAcme Plumbing\n"boiler repair, guide"\n',
    "Latest links.csv": "Linking page,Last crawled\nhttps://news.example/a,2026-11-01\n",
  });
  assert.deepEqual(
    r.links.sites,
    [
      { domain: "blog.example", links: 1200 },
      { domain: "news.example", links: 12 },
    ],
    "counts from Linking pages, most first",
  );
  assert.deepEqual(
    r.links.pages,
    [
      { url: "https://www.acme.com/", links: 900 },
      { url: "https://www.acme.com/guide/", links: 12 },
    ],
    "counts from Incoming links, not Linking sites",
  );
  assert.deepEqual(
    r.links.texts,
    [
      { text: "Acme Plumbing", links: null },
      { text: "boiler repair, guide", links: null },
    ],
    "no count column: links is null",
  );
  assert.equal(r.links.source, "search-console");
  assert.ok(!isNaN(Date.parse(r.links.when)));
  assert.deepEqual(r.linkSummary, { sites: 2, pages: 2, bingPages: null });
  assert.ok(
    r.notes.some(n => n.includes("Latest links.csv") && /backlinks\.mjs/.test(n)),
    "the linking-pages export is pointed at backlinks.mjs, not read as the owner's pages",
  );
});

test("exports from another UI language are recognised by what their columns hold", async () => {
  const r = await importLinks({
    "a.csv": "Website,Verlinkende Seiten,Zielseiten\nblog.example,5,2\n",
    "b.csv": "Zielseite,Eingehende Links\nhttps://www.acme.com/x/,7\n",
    "c.csv": "Linktext\nAcme\n",
  });
  assert.deepEqual(r.links.sites, [{ domain: "blog.example", links: 5 }]);
  assert.deepEqual(r.links.pages, [{ url: "https://www.acme.com/x/", links: 7 }]);
  assert.deepEqual(r.links.texts, [{ text: "Acme", links: null }]);
});

test("anchor texts are sorted into brand, web address, generic and other", async () => {
  const texts = { "Top linking text.csv": "Linking text\nAcme Plumbing\nacme.com\nclick here\nboiler repair guide\n" };
  const quarter = { brand: 0.25, address: 0.25, generic: 0.25, other: 0.25 };
  const named = await importLinks(texts, { brand: "Acme" });
  assert.deepEqual(named.anchorMix, quarter);
  assert.ok(
    named.notes.some(n => n.includes("“Acme”") && n.includes("--brand")),
    "says where the brand words came from",
  );
  const guessed = await importLinks(texts);
  assert.deepEqual(guessed.anchorMix, quarter, "without --brand, the brand is the site's domain name");
  assert.ok(guessed.notes.some(n => n.includes("“acme”") && /site's address/.test(n)));
  const ace = await importLinks(
    { "t.csv": "Linking text\nAce Hardware\nspace heaters\nhttps://www.ace.com/tools\nRead more\n" },
    { brand: "Ace" },
  );
  assert.deepEqual(ace.anchorMix, quarter, "a brand inside another word (sp-ace) isn't the brand");
  const counted = await importLinks({ "t.csv": "Linking text,Links\nAcme,3\nclick here,1\n" });
  assert.deepEqual(
    counted.anchorMix,
    { brand: 0.75, address: 0, generic: 0.25, other: 0 },
    "shares of links when the export counts them",
  );
});

const sitesCsv = n =>
  "Site,Linking pages\n" + Array.from({ length: n }, (_, i) => `s${i}.example,${n - i}`).join("\n") + "\n";
const summary = (sites, bingPages = null) => ({ linkSummary: { sites, pages: null, bingPages } });

test("a 30% and 10+ drop since the previous file is links-dropped; a smaller one isn't", async () => {
  const drop = await importLinks({ "s.csv": sitesCsv(70) }, { previous: summary(100) });
  assert.deepEqual(drop.linksChange, { kind: "links-dropped", what: "sites", before: 100, after: 70 });
  for (const [before, after] of [
    [100, 71],
    [20, 13],
    [70, 90],
  ]) {
    const r = await importLinks({ "s.csv": sitesCsv(after) }, { previous: summary(before) });
    assert.equal(r.linksChange, null, `${before} → ${after}`);
  }
  const keys = {
    site: "https://www.acme.com/",
    bing: {
      backlinks: {
        pages: Array.from({ length: 25 }, (_, i) => ({ url: `https://www.acme.com/p${i}/`, count: 1 })),
        sample: [],
      },
    },
  };
  const bing = await importLinks({ "s.csv": sitesCsv(70) }, { previous: summary(70, 40), keys });
  assert.equal(bing.linkSummary.bingPages, 25);
  assert.deepEqual(
    bing.linksChange,
    { kind: "links-dropped", what: "bingPages", before: 40, after: 25 },
    "Bing's linked pages count too",
  );
});

test("no export this time is not a drop", async () => {
  const previous = { links: { sites: [], texts: [], pages: [] }, ...summary(100, 40) };
  for (const files of [{}, null]) {
    const r = await importLinks(files, { previous });
    assert.equal(r.links, null);
    assert.equal(r.anchorMix, null);
    assert.equal(r.linksChange, null, "no data isn't zero links");
    assert.deepEqual(r.linkSummary, { sites: null, pages: null, bingPages: null });
    assert.ok(
      r.notes.some(n => /No Search Console links export/.test(n)),
      "a note says no export was found",
    );
  }
  const textOnly = await importLinks({ "t.csv": "Linking text\nAcme\n" }, { previous });
  assert.equal(textOnly.linkSummary.sites, null, "no linking-sites export this time");
  assert.equal(textOnly.linksChange, null);
});

test("a page other sites link to that now returns 404 is linked-page-broken; a live one isn't", async () => {
  const L = "http://127.0.0.1:3000";
  const crawl = {
    pages: [
      { url: `${L}/`, status: 200 },
      { url: `${L}/guide/`, status: 200 },
    ],
    errors: [
      { url: `${L}/old-guide/`, status: 404 },
      { url: `${L}/retired/`, status: 410 },
      { url: `${L}/loop/`, status: 0 },
      { url: `${L}/flaky/`, status: 500 },
    ],
    redirects: [
      { from: `${L}/loop/`, to: null, status: 302 },
      { from: `${L}/promo/`, to: `${L}/`, status: 301 },
      { from: `${L}/tools`, to: `${L}/tools/`, status: 301 },
    ],
  };
  const csv =
    "Target page,Incoming links\n" +
    ["/", "/guide/", "/old-guide/", "/loop/", "/promo/", "/tools", "/flaky/", "/never-crawled/"]
      .map((p, i) => `https://www.acme.com${p},${90 - i * 10}`)
      .join("\n") +
    "\nhttps://blog.acme.com/old-guide/,5\n";
  const keys = {
    bing: {
      backlinks: {
        pages: [
          { url: "https://www.acme.com/retired/", count: 3 },
          { url: "https://www.acme.com/old-guide/", count: 70 },
        ],
        sample: [],
      },
    },
  };
  const r = await importLinks({ "p.csv": csv }, { crawl, keys });
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.deepEqual(
    [f.check, f.rule, f.severity, f.category, f.source, f.status, f.count],
    ["linked-page-broken", "URL-07", "medium", "URLs & canonicals", "links-import", "open", 4],
  );
  assert.deepEqual(
    f.evidence,
    [
      { url: "https://www.acme.com/old-guide/", detail: "returns 404 · 70 links from other sites (Search Console)" },
      { url: "https://www.acme.com/loop/", detail: "redirects in a loop · 60 links from other sites (Search Console)" },
      {
        url: "https://www.acme.com/promo/",
        detail: "redirects to the home page · 50 links from other sites (Search Console)",
      },
      { url: "https://www.acme.com/retired/", detail: "returns 410 · 3 links from other sites (Bing)" },
    ],
    "most links first; the home page, a live page, a slash redirect and a server error aren't findings",
  );
  assert.match(f.what, /^4 cases, for example `https:\/\/www\.acme\.com\/old-guide\/` \(returns 404/);
  assert.match(f.fix, /301/);
  assert.ok(
    r.notes.some(n => /^1 of the pages other sites link to wasn't reached by the crawl/.test(n) && /--urls/.test(n)),
    "/never-crawled/ isn't judged; blog.acme.com is another host",
  );

  const none = await importLinks({ "p.csv": csv });
  assert.deepEqual(none.findings, [], "without --crawl there's nothing to cross-check");
  const live = await importLinks({ "p.csv": "Target page,Incoming links\nhttps://www.acme.com/guide/,9\n" }, { crawl });
  assert.deepEqual(live.findings, []);
});

test("the home page's other addresses redirecting to it aren't linked-page-broken", async () => {
  const L = "http://127.0.0.1:3000",
    aliases = ["/index.html", "/default.aspx", "/home", "/Home/", "/en/", "/en-us/", "/pt-BR"];
  const crawl = {
    pages: [{ url: `${L}/`, status: 200 }],
    redirects: [...aliases, "/promo/", "/english/"].map(p => ({ from: L + p, to: `${L}/`, status: 301 })),
  };
  const csv =
    "Target page,Incoming links\n" +
    [...aliases, "/promo/", "/english/"].map(p => `https://www.acme.com${p},5`).join("\n") +
    "\n";
  const r = await importLinks({ "p.csv": csv }, { crawl });
  assert.deepEqual(
    r.findings[0].evidence.map(e => e.url),
    ["https://www.acme.com/promo/", "https://www.acme.com/english/"],
  );
});

test("linked pages the crawl didn't reach, passed to the crawler with --urls, are judged", async () => {
  const dir = tmp(),
    list = join(dir, "old-urls.txt"),
    out = join(dir, "crawl.json");
  writeFileSync(
    join(dir, "index.html"),
    "<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1></body></html>",
  );
  writeFileSync(list, "/old-guide/\n/promo/\n");
  const site = await serve(dir, {
    before: (req, res) => (req.url.startsWith("/promo") ? (res.writeHead(301, { Location: "/" }).end(), true) : false),
  });
  try {
    await node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--urls", list, "--out", out]);
  } finally {
    await site.close();
  }
  const csv = "Target page,Incoming links\nhttps://www.acme.com/old-guide/,9\nhttps://www.acme.com/promo/,4\n";
  const r = await importLinks({ "p.csv": csv }, { crawl: JSON.parse(readFileSync(out, "utf8")) });
  assert.deepEqual(r.findings[0]?.evidence, [
    { url: "https://www.acme.com/old-guide/", detail: "returns 404 · 9 links from other sites (Search Console)" },
    {
      url: "https://www.acme.com/promo/",
      detail: "redirects to the home page · 4 links from other sites (Search Console)",
    },
  ]);
  assert.ok(!r.notes.some(n => /reached by the crawl/.test(n)));
});

// ---------- the report ----------
const SAMPLE = join(SKILL, "examples", "sample-audit.json");
const render = async edit => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(SAMPLE, "utf8"));
  edit(data);
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};
const XSS = "<img src=x onerror=alert(1)>";
const LINKS = () => ({
  links: {
    sites: [
      { domain: `${XSS}.example`, links: 1200 },
      ...[2, 3, 4, 5, 6, 7].map(n => ({ domain: `site${n}.example`, links: 100 - n })),
    ],
    texts: [{ text: XSS, links: null }],
    pages: [
      { url: "https://security.example/<b>x</b>", links: 40 },
      { url: "https://security.example/tools/", links: 9 },
    ],
    source: "search-console",
    when: "2026-11-18T09:00:00.000Z",
  },
  linkSummary: { sites: 7, pages: 2, bingPages: null },
  anchorMix: { brand: 0.4, address: 0.2, generic: 0.1, other: 0.3 },
  linksChange: { kind: "links-dropped", what: "sites", before: 120, after: 7 },
});
const tab = (html, id) =>
  html.slice(html.indexOf(`id="p-${id}"`), html.indexOf('<section class="tp"', html.indexOf(`id="p-${id}"`)));

test("the report shows a link summary and the anchor mix, and Since last audit shows the drop", async () => {
  const none = await render(() => {}),
    r = await render(d => Object.assign(d, LINKS()));
  const scoreOf = html => html.match(/<p class="big[^"]*"><span class="n">(\d+)<\/span>/)[1];
  assert.equal(scoreOf(r.html), scoreOf(none.html), "information only: the score is unchanged");
  assert.equal(r.md.match(/\*\*SEO health score: [^*]+\*\*/)[0], none.md.match(/\*\*SEO health score: [^*]+\*\*/)[0]);

  const det = tab(r.html, "overview").match(/<details class="how links">[\s\S]*?<\/details>/)?.[0];
  assert.ok(det, "on the Overview");
  assert.match(det, /<summary>Links from other sites \(Search Console\)<\/summary>/);
  assert.ok(det.includes("Search Console (export of 18 Nov 2026): 7 sites link to you · 2 of your pages have links"));
  assert.ok(
    det.includes("<li><b><code>&lt;img src=x onerror=alert(1)&gt;.example</code></b><span>1,200 links</span></li>"),
    "domains escaped",
  );
  assert.ok(det.includes("site5.example") && !det.includes("site6.example"), "the top 5 sites");
  assert.ok(det.includes("<code>https://security.example/&lt;b&gt;x&lt;/b&gt;</code>"), "pages escaped");
  assert.ok(det.includes("Link text: your brand 40% · web address 20% · generic, like “click here”, 10% · other 30%"));
  assert.match(det, /doesn&#39;t change the score/);
  assert.doesNotMatch(r.html, /<img src=x|<b>x<\/b>/);

  const since = tab(r.html, "diff");
  assert.ok(since.includes("<h2>Links dropped</h2>"), "in Since last audit");
  assert.ok(since.includes("<b>Sites linking to you (Search Console)</b><span>120 → 7 (−94%) since the last audit."));
  assert.match(since, /backlinks\.mjs/);
  assert.ok(!tab(none.html, "diff").includes("Links dropped"));

  assert.match(r.md, /^## Links from other sites \(Search Console\)$/m);
  assert.ok(
    r.md.includes("\n- `<img src=x onerror=alert(1)>.example` 1,200 links\n"),
    "Markdown: domains in code spans",
  );
  assert.ok(
    r.md.includes("\nLink text: your brand 40% · web address 20% · generic, like “click here”, 10% · other 30%.\n"),
  );
  const mdSince = r.md.split("\n## Since last audit\n")[1].split("\n## ")[0];
  assert.ok(
    mdSince.includes(
      "\n### Links dropped\n\n- Sites linking to you (Search Console): 120 → 7 (−94%) since the last audit.",
    ),
  );

  const both = await render(d => {
    Object.assign(d, LINKS());
    d.bing = { backlinks: { pages: [{ url: "https://security.example/", count: 4 }], sample: [] } };
  });
  assert.match(both.html, /<summary>Links from other sites \(Search Console and Bing\)<\/summary>/);
  assert.ok(both.html.includes("<p>Your most-linked pages in Bing:</p>"), "Bing's list says it's Bing's");

  for (const junk of [
    d => {
      d.links = "x";
      d.anchorMix = { brand: "<b>" };
      d.linksChange = { kind: "links-dropped", what: XSS, before: "a", after: 1 };
    },
    d => {
      d.links = { sites: [null, 7], pages: "y", texts: [] };
      d.linksChange = { kind: "other", what: "sites", before: 100, after: 1 };
    },
  ]) {
    const j = await render(junk);
    assert.equal(j.html, none.html, "junk adds nothing");
    assert.equal(j.md, none.md);
  }
});
