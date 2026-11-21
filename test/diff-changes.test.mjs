// seo-diff.mjs between two crawls, and Google's announcements from the Search Central blog.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffCrawls, changedPages } from "../skills/seo-supervisor/scripts/seo-diff.mjs";
import { blogPosts } from "../skills/seo-supervisor/scripts/google-updates.mjs";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const read = p => JSON.parse(readFileSync(p, "utf8"));
const kinds = list => list.map(c => `${c.path} ${c.kind}`).sort();
const all = d => [...d.regressions, ...d.improvements, ...d.changed];
const P = (path, extra = {}) => ({
  url: `https://e.com${path}`,
  status: 200,
  noindex: false,
  canonical: `https://e.com${path}`,
  title: path,
  h1: 1,
  schema: [],
  ...extra,
});

const render = async extra => {
  const dir = tmp(),
    data = read(join(SKILL, "examples", "sample-audit.json"));
  Object.assign(data, extra);
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  const html = readFileSync(join(dir, "r.html"), "utf8"),
    md = readFileSync(join(dir, "r.md"), "utf8");
  const panel = id => {
    const i = html.indexOf(`id="p-${id}"`);
    return html.slice(i, html.indexOf('class="tp"', i));
  };
  const mdDiff = md.slice(
    md.indexOf("## Since last audit"),
    md.indexOf("\n## ", md.indexOf("## Since last audit") + 3),
  );
  return { html, md, overview: panel("overview"), diff: panel("diff"), mdDiff };
};
const EMPTY = {
  since: "2026-10-01T09:00:00.000Z",
  regressions: [],
  improvements: [],
  changed: [],
  added: [],
  removed: [],
};

// ---------- A section crawl is a partial crawl ----------
test("a crawl of one section lists no pages as gone or added outside it, and doesn't compare internal links", () => {
  const S = path => P(path, { linksIn: 20 });
  const full = { stats: { capped: false }, pages: [S("/"), S("/blog/a/"), S("/shop/x/")] };
  const blog = {
    stats: { capped: false },
    section: { include: ["/blog/"], exclude: [] },
    pages: [S("/"), P("/blog/a/", { linksIn: 2 })],
  };
  const d = diffCrawls(full, blog);
  assert.deepEqual(d.removed, [], "/shop/x/ was outside the section, not gone");
  assert.equal(d.removedUnknown, "section");
  assert.deepEqual(kinds(d.regressions), [], "20 → 2 links only counts the section's own pages");
  assert.ok(!d.compared.includes("links"));
  const back = diffCrawls(blog, full);
  assert.deepEqual(back.added, [], "/shop/x/ was there before; the last crawl didn't look");
  assert.equal(back.addedUnknown, "section");
  const same = diffCrawls(blog, { ...blog, pages: [S("/")] });
  assert.deepEqual(same.removed, ["/blog/a/"], "the same section both times: a page gone from it is gone");
  assert.ok(!("removedUnknown" in same) && !("addedUnknown" in same));
  const capped = diffCrawls({ stats: { capped: true }, pages: [S("/")] }, full);
  assert.deepEqual(
    [capped.added, capped.addedUnknown],
    [[], true],
    "a last crawl that stopped at --max didn't reach every page either",
  );
});

test("the report says why no page is listed as gone or added after a section crawl", async () => {
  const { html, md } = await render({ diff: { ...EMPTY, removedUnknown: "section", addedUnknown: true } });
  for (const text of [html, md]) {
    assert.ok(
      text.includes(
        "This crawl covered one part of the site (--include or --exclude), so pages outside it aren't listed as gone.",
      ),
    );
    assert.ok(
      text.includes(
        "The last crawl stopped at its page limit (--max), so pages it didn't reach aren't listed as added.",
      ),
    );
  }
});

// ---------- H1 text, H2s and the other Open Graph tags ----------
test("a rewritten H1 is a change when both crawls kept its text; a removed one stays h1-removed", () => {
  const d = diffCrawls(
    {
      pages: [
        P("/a/", { h1Text: "Plumbers in Leeds" }),
        P("/b/", { h1Text: "Boilers" }),
        P("/c/", { h1Text: "Drains" }),
      ],
    },
    { pages: [P("/a/", { h1Text: "Emergency plumbers in Leeds" }), P("/b/", { h1: 0, h1Text: null }), P("/c/")] },
  );
  assert.deepEqual(kinds(all(d)), ["/a/ h1-changed", "/b/ h1-removed"], "/c/: an older crawl has no H1 text");
  assert.deepEqual(
    d.changed.map(c => [c.before, c.after]),
    [["Plumbers in Leeds", "Emergency plumbers in Leeds"]],
  );
});

test("H2s that change in number or text are one change with what went and came; order alone isn't", () => {
  const d = diffCrawls(
    {
      pages: [
        P("/a/", { h2s: ["Prices", "Areas", "FAQ"] }),
        P("/b/", { h2s: ["One", "Two"] }),
        P("/c/", { h2s: ["Tip", "Tip"] }),
        P("/d/", { h2s: ["X"] }),
      ],
    },
    {
      pages: [
        P("/a/", { h2s: ["Plans and prices", "Areas", "FAQ", "Reviews"] }),
        P("/b/", { h2s: ["Two", "One"] }),
        P("/c/", { h2s: ["Tip"] }),
        P("/d/"),
      ],
    },
  );
  assert.deepEqual(kinds(all(d)), ["/a/ h2-changed", "/c/ h2-changed"], "/d/: an older crawl kept no H2s");
  assert.deepEqual(
    d.changed.find(c => c.path === "/a/"),
    {
      path: "/a/",
      kind: "h2-changed",
      before: 3,
      after: 4,
      detail: "3 → 4; − Prices · + Plans and prices · + Reviews",
    },
  );
  assert.equal(d.changed.find(c => c.path === "/c/").detail, "2 → 1");
  assert.ok(d.compared.includes("h2"));
});

test("og:description and og:url count with og:title and og:image once both crawls keep them", () => {
  const og = { ogTitle: "A", ogImage: "/a.png", ogDescription: "About A", ogUrl: "https://e.com/a/" };
  const d = diffCrawls({ pages: [P("/a/", og)] }, { pages: [P("/a/", { ...og, ogDescription: null })] });
  assert.deepEqual(
    d.regressions.map(c => [c.kind, c.before, c.after]),
    [["og-removed", "og:title, og:image, og:description, og:url", "og:title, og:image, og:url"]],
  );
  const older = diffCrawls(
    { pages: [P("/a/", { ogTitle: "A", ogImage: "/a.png" })] },
    { pages: [P("/a/", { ...og, ogDescription: null })] },
  );
  assert.deepEqual(all(older), [], "the older crawl kept no og:description");
});

// ---------- hreflang ----------
test("hreflang is compared by language and target, with the site's own host read as a path", () => {
  const H = (...pairs) => pairs.map(([lang, href]) => ({ lang, href }));
  const old = {
    siteOrigin: "https://e.com",
    pages: [
      P("/en/", { hreflang: H(["en", "/en/"], ["es", "https://e.com/es/"]) }),
      P("/b/", { hreflang: H(["en", "/b/"], ["de", "/de/b/"]) }),
      P("/c/", { hreflang: [] }),
      P("/d/", { hreflang: H(["en", "/d/"], ["fr", "https://e.fr/d/"]) }),
      P("/e/"),
    ],
  };
  // The new crawl is of the local build: its pages are on 127.0.0.1, and the public origin maps onto it.
  const L = path => ({ ...P(path), url: `http://127.0.0.1:3000${path}`, canonical: `https://e.com${path}` });
  const now = {
    startUrl: "http://127.0.0.1:3000/",
    siteOrigin: "https://e.com",
    pages: [
      { ...L("/en/"), hreflang: H(["EN", "https://e.com/en/"], ["es", "/es/"]) },
      { ...L("/b/"), hreflang: H(["en", "/b/"]) },
      { ...L("/c/"), hreflang: H(["en", "/c/"], ["x-default", "/c/"]) },
      { ...L("/d/"), hreflang: H(["en", "/d/"], ["fr", "https://e.fr/d-fr/"]) },
      { ...L("/e/"), hreflang: H(["en", "/e/"]) },
    ],
  };
  const d = diffCrawls(old, now);
  assert.deepEqual(
    kinds(d.regressions),
    ["/b/ hreflang-changed"],
    "/en/ is the same, written another way; /e/: the older crawl kept none",
  );
  assert.deepEqual(kinds(d.improvements), ["/c/ hreflang-changed"]);
  assert.deepEqual(kinds(d.changed), ["/d/ hreflang-changed"]);
  assert.equal(d.regressions[0].detail, "− de → /de/b/");
  assert.equal(
    d.changed[0].detail,
    "− fr → https://e.fr/d/ · + fr → https://e.fr/d-fr/",
    "another host is shown in full",
  );
  assert.ok(d.compared.includes("hreflang"));
});

// ---------- Smaller content changes ----------
test("a page that lost a third of its words (50 or more) or grew by half is reported", () => {
  const d = diffCrawls(
    {
      pages: [
        P("/a/", { words: 300 }),
        P("/b/", { words: 300 }),
        P("/c/", { words: 200 }),
        P("/d/", { words: 90 }),
        P("/e/", { words: 60 }),
      ],
    },
    {
      pages: [
        P("/a/", { words: 190 }),
        P("/b/", { words: 230 }),
        P("/c/", { words: 300 }),
        P("/d/", { words: 50 }),
        P("/e/", { words: 100 }),
      ],
    },
  );
  assert.deepEqual(
    kinds(all(d)),
    ["/a/ content-shrunk", "/c/ content-grew"],
    "/b/ lost under a third, /d/ and /e/ moved fewer than 50 words",
  );
});

// ---------- Retired schema ----------
test("removing a type whose rich result Google retired is a change, not a regression; FAQPage is still kept", () => {
  const d = diffCrawls(
    {
      pages: [
        P("/a/", { schema: ["Article", "HowTo"] }),
        P("/b/", { schema: ["Product", "SpecialAnnouncement", "Organization"] }),
        P("/c/", { schema: ["FAQPage"] }),
        P("/d/", { schema: ["HowTo"], schemaProps: { HowTo: ["name", "step"] } }),
      ],
    },
    {
      pages: [
        P("/a/", { schema: ["Article"] }),
        P("/b/", { schema: ["Product"] }),
        P("/c/", { schema: [] }),
        P("/d/", { schema: ["HowTo"], schemaProps: { HowTo: ["name"] } }),
      ],
    },
  );
  assert.deepEqual(
    kinds(d.regressions),
    ["/b/ schema-removed", "/c/ schema-removed"],
    "FAQPage is kept: Bing and AI engines still read it",
  );
  assert.deepEqual(d.regressions.find(c => c.path === "/b/").before, "Organization");
  assert.deepEqual(
    kinds(d.changed),
    ["/a/ schema-retired-removed", "/b/ schema-retired-removed"],
    "/d/: a retired type's fields aren't compared",
  );
  assert.deepEqual(d.changed.find(c => c.path === "/b/").before, "SpecialAnnouncement");
});

// ---------- Site sections ----------
test("a section that lost half its pages and at least 10 is a regression, only when both crawls were whole", () => {
  const sec = (...s) => s.map(([path, pages]) => ({ path, pages, share: 0 }));
  const old = {
    stats: { capped: false },
    pages: [],
    sections: sec(["/blog/", 40], ["/shop/", 15], ["/docs/", 20], ["/", 5]),
  };
  const now = { stats: { capped: false }, pages: [], sections: sec(["/blog/", 12], ["/shop/", 9], ["/", 5]) };
  const d = diffCrawls(old, now);
  assert.deepEqual(
    d.regressions.map(c => [c.path, c.kind, c.before, c.after]),
    [
      ["/blog/", "section-shrunk", 40, 12],
      ["/docs/", "section-shrunk", 20, 0],
    ],
    "/shop/ lost only 6",
  );
  assert.ok(d.compared.includes("sections"));
  assert.deepEqual(
    diffCrawls(old, { ...now, stats: { capped: true } }).regressions,
    [],
    "a crawl that stopped at --max",
  );
  assert.deepEqual(
    diffCrawls(old, { ...now, section: { include: ["/blog/"], exclude: [] } }).regressions,
    [],
    "a crawl of one section",
  );
});

test("the pages to announce include heading, hreflang and retired-schema changes, not a shrunk section", () => {
  const c = (path, kind) => ({ path, kind });
  const d = {
    regressions: [c("/b/", "hreflang-changed"), c("/blog/", "section-shrunk")],
    improvements: [],
    changed: [c("/a/", "h1-changed"), c("/c/", "h2-changed"), c("/d/", "schema-retired-removed")],
    added: [],
  };
  assert.deepEqual(changedPages(d), ["/b/", "/a/", "/c/", "/d/"]);
});

test("section, heading, hreflang and retired-schema changes show in Since last audit with plain labels, escaped", async () => {
  const diff = {
    ...EMPTY,
    compared: ["h2", "hreflang", "sections"],
    regressions: [
      { path: "/blog/", kind: "section-shrunk", before: 40, after: 12 },
      {
        path: "/b/",
        kind: "hreflang-changed",
        before: "de → /de/b/, en → /b/",
        after: "en → /b/",
        detail: "− de → /de/b/",
      },
    ],
    changed: [
      { path: "/a/", kind: "h1-changed", before: "Plumbers", after: "<b>Emergency</b> plumbers" },
      { path: "/c/", kind: "h2-changed", before: 3, after: 4, detail: "3 → 4; + Reviews" },
      { path: "/d/", kind: "schema-retired-removed", before: "HowTo", after: "Article" },
    ],
  };
  const { html, md } = await render({ diff });
  for (const text of [
    "Section shrank: 40 → 12",
    "hreflang changed: − de → /de/b/",
    "H2s changed: 3 → 4; + Reviews",
    "Retired schema removed: HowTo → Article",
  ]) {
    assert.ok(html.includes(text), text);
    assert.ok(md.includes(text), text);
  }
  assert.ok(html.includes("H1 changed: Plumbers → &lt;b&gt;Emergency&lt;/b&gt; plumbers"));
  assert.ok(md.includes("H1 changed: Plumbers → \\<b\\>Emergency\\</b\\> plumbers"));
  const said = (await render({ diff: { ...EMPTY, compared: ["h2", "hreflang", "sections"] } })).html.match(
    /<h2>Nothing changed<\/h2><p>([^<]*)<\/p>/,
  )[1];
  assert.equal(
    said,
    "Every page has the same status, indexing, canonical, title, H1, H2s, hreflang and schema as last time, and no section lost half its pages.",
  );
});

// ---------- History, scheduled runs and the timeline ----------
const crawl = (crawledAt, pages, extra = {}) => ({
  tool: "seo-supervisor-crawler",
  crawledAt,
  stats: { capped: false },
  findings: [{ check: "x" }],
  pages: pages.map(p => P(p)),
  ...extra,
});

test("--history compares with the newest crawl filed there, adds a timeline of all of them, and files this crawl", async () => {
  const dir = tmp(),
    hist = join(dir, "history"),
    out = join(dir, "seo-diff.json"),
    now = join(dir, "seo-crawl.json");
  mkdirSync(hist);
  writeFileSync(
    join(hist, "2026-10-01-seo-crawl.json"),
    JSON.stringify(crawl("2026-10-01T09:00:00.000Z", ["/", "/a/", "/b/"])),
  );
  writeFileSync(
    join(hist, "2026-10-15-seo-crawl.json"),
    JSON.stringify(crawl("2026-10-15T09:00:00.000Z", ["/", "/a/", "/b/", "/c/"])),
  );
  writeFileSync(join(hist, "2026-10-15-links.json"), "{}");
  writeFileSync(join(hist, "2026-09-01-seo-crawl.json"), "not json");
  writeFileSync(now, JSON.stringify(crawl("2026-11-01T09:00:00.000Z", ["/", "/a/", "/c/", "/d/"])));
  const run = (...extra) => node([join(SCRIPTS, "seo-diff.mjs"), "--history", hist, now, "--out", out, ...extra]);
  const { stderr } = await run();
  assert.match(stderr, /2026-09-01-seo-crawl\.json/, "an unreadable file is named and skipped");
  const d = read(out);
  assert.equal(d.since, "2026-10-15T09:00:00.000Z");
  assert.deepEqual([d.added, d.removed], [["/d/"], ["/b/"]]);
  assert.deepEqual(d.timeline, [
    { date: "2026-10-01T09:00:00.000Z", pages: 3, findings: 1 },
    { date: "2026-10-15T09:00:00.000Z", pages: 4, findings: 1, regressions: 0, improvements: 0, added: 1, removed: 0 },
    { date: "2026-11-01T09:00:00.000Z", pages: 4, findings: 1, regressions: 0, improvements: 0, added: 1, removed: 1 },
  ]);
  assert.deepEqual(read(join(hist, "2026-11-01-seo-crawl.json")), read(now), "filed under its own date");
  const files = readdirSync(hist).sort();
  await run();
  assert.deepEqual(readdirSync(hist).sort(), files, "the same crawl isn't filed twice");
  // A second crawl on the same day gets the time in its name, so the first isn't overwritten.
  writeFileSync(now, JSON.stringify(crawl("2026-11-01T15:30:00.000Z", ["/", "/a/"])));
  await run();
  assert.equal(read(out).since, "2026-11-01T09:00:00.000Z");
  assert.ok(existsSync(join(hist, "2026-11-01T15-30-00-seo-crawl.json")));
  assert.equal(read(join(hist, "2026-11-01-seo-crawl.json")).crawledAt, "2026-11-01T09:00:00.000Z");
  assert.equal(read(out).timeline.length, 4);
});

test("a first crawl is only filed, and --fail-on-regressions exits 1 for a scheduled run to notice", async () => {
  const dir = tmp(),
    hist = join(dir, "history"),
    out = join(dir, "seo-diff.json"),
    now = join(dir, "seo-crawl.json");
  writeFileSync(now, JSON.stringify(crawl("2026-11-01T09:00:00.000Z", ["/", "/a/"])));
  const run = () =>
    node([join(SCRIPTS, "seo-diff.mjs"), "--history", hist, now, "--out", out, "--fail-on-regressions"]);
  const { stdout } = await run();
  assert.match(stdout, /no earlier crawl/);
  assert.ok(!existsSync(out), "nothing to compare, so no Since last audit tab");
  assert.ok(existsSync(join(hist, "2026-11-01-seo-crawl.json")));
  writeFileSync(
    now,
    JSON.stringify(crawl("2026-11-08T09:00:00.000Z", ["/", "/a/"], { pages: [P("/"), P("/a/", { noindex: true })] })),
  );
  await assert.rejects(run(), e => e.code === 1 && /1 regression/.test(e.stdout));
  assert.deepEqual(
    read(out).regressions.map(c => c.kind),
    ["noindex-added"],
    "written before it exits",
  );
});

test("the Overview shows the audit timeline once there are three crawls, newest first", async () => {
  const timeline = [
    { date: "2026-10-01T09:00:00.000Z", pages: 3, findings: 7 },
    { date: "2026-10-15T09:00:00.000Z", pages: 4, findings: 5, regressions: 2, improvements: 1, added: 1, removed: 0 },
    {
      date: "2026-11-01T09:00:00.000Z",
      pages: 1200,
      findings: 4,
      regressions: 0,
      improvements: 3,
      added: null,
      removed: null,
    },
    { date: "<script>", pages: "x" },
  ];
  const { overview, md } = await render({ diff: { ...EMPTY, timeline } });
  assert.match(overview, /<summary>Audit timeline<\/summary>/);
  assert.ok(overview.indexOf("1 Nov 2026") < overview.indexOf("15 Oct 2026"), "newest first");
  assert.ok(overview.includes("<td>1 Nov 2026</td><td>1,200</td><td>4</td><td>0</td><td>3</td><td>–</td><td>–</td>"));
  assert.doesNotMatch(overview, /<script>/);
  assert.ok(md.includes("## Audit timeline"));
  assert.ok(md.includes("| 15 Oct 2026 | 4 | 5 | 2 | 1 | 1 | 0 |"));
  const two = await render({ diff: { ...EMPTY, timeline: timeline.slice(0, 2) } });
  assert.doesNotMatch(two.html, /Audit timeline/, "two crawls are what Since last audit already shows");
});

// ---------- Google's announcements, from the Search Central blog ----------
// Items shaped like the blog's RSS 2.0 feed: https://developers.google.com/search/blog/feed.xml
const item = (title, date, slug) =>
  `<item><title>${title}</title><link>https://developers.google.com/search/blog/${slug}</link><description><![CDATA[<p>Text</p>]]></description><pubDate>${date} 00:00:00 +0000</pubDate><guid isPermaLink="false">${slug}</guid></item>`;
const FEED_XML = `<?xml version="1.0" encoding="UTF-8" ?><rss version="2.0"><channel><title>Google Search Central Blog</title>
${item("Update to the Site Reputation Policy", "Fri, 28 Aug 2026", "2026/08/update-site-reputation-policy")}
${item("Search Central Live in Zurich is back!", "Wed, 04 Nov 2026", "2026/11/search-central-live-zurich-2026")}
${item("Platform properties roll out globally &amp; a new guide", "Tue, 21 Jul 2026", "2026/07/platform-properties")}
${item("Supporting a shared AI training control for websites&#39; owners", "Fri, 30 Oct 2026", "2026/10/ai-training-control")}
</channel></rss>`;

test("the blog feed gives each post in the period with its title, date and link, events left out", () => {
  assert.deepEqual(
    blogPosts(FEED_XML, { from: "2026-08-01", to: "2026-11-21" }),
    [
      {
        title: "Update to the Site Reputation Policy",
        date: "2026-08-28",
        url: "https://developers.google.com/search/blog/2026/08/update-site-reputation-policy",
      },
      {
        title: "Supporting a shared AI training control for websites' owners",
        date: "2026-10-30",
        url: "https://developers.google.com/search/blog/2026/10/ai-training-control",
      },
    ],
    "July's post is before the period, and Search Central Live is an event",
  );
  assert.deepEqual(blogPosts("<html>not a feed</html>", { from: "2026-01-01", to: "2026-12-31" }), []);
});

async function fakeGoogle({ blogStatus = 200 } = {}) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === "/incidents.json") res.writeHead(200, { "Content-Type": "application/json" }).end("[]");
    else res.writeHead(blogStatus, { "Content-Type": "application/rss+xml" }).end(FEED_XML);
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    status: `${base}/incidents.json`,
    blog: `${base}/feed.xml`,
    hits,
    close: () => new Promise(ok => server.close(ok)),
  };
}
const updates = args =>
  node([join(SCRIPTS, "google-updates.mjs"), ...args], { env: { ...process.env, GOOGLE_STATUS_ENDPOINT: "" } });

test("--blog also lists the Search Central blog's posts in the period, and says when the feed starts after the period", async () => {
  const g = await fakeGoogle(),
    out = join(tmp(), "g.json");
  try {
    const dry = await updates([
      "--from",
      "2026-06-01",
      "--to",
      "2026-11-21",
      "--endpoint",
      g.status,
      "--blog",
      g.blog,
      "--out",
      out,
    ]);
    assert.ok(dry.stdout.includes(g.blog) && !existsSync(out) && !g.hits.length, "the dry run names the blog feed too");
    const { stdout } = await updates([
      "--from",
      "2026-06-01",
      "--to",
      "2026-11-21",
      "--endpoint",
      g.status,
      "--blog",
      g.blog,
      "--out",
      out,
      "--yes",
    ]);
    assert.deepEqual(g.hits.sort(), ["GET /feed.xml", "GET /incidents.json"]);
    const r = read(out).googleUpdates;
    assert.deepEqual(
      r.posts.map(p => p.date),
      ["2026-07-21", "2026-08-28", "2026-10-30"],
    );
    assert.match(r.note, /blog's feed holds its latest posts only, back to 21 Jul 2026/);
    assert.match(stdout, /3 Search Central blog posts/);
  } finally {
    await g.close();
  }
});

test("a blog feed that fails still writes the ranking updates, with a note", async () => {
  const g = await fakeGoogle({ blogStatus: 503 }),
    out = join(tmp(), "g.json");
  try {
    await updates([
      "--from",
      "2026-08-01",
      "--to",
      "2026-11-21",
      "--endpoint",
      g.status,
      "--blog",
      g.blog,
      "--out",
      out,
      "--yes",
    ]);
    const r = read(out).googleUpdates;
    assert.deepEqual(r.updates, []);
    assert.ok(!("posts" in r));
    assert.match(r.note, /blog's feed returned 503/);
  } finally {
    await g.close();
  }
});

test("the report lists the blog's posts on the Overview and in Since last audit, escaped, dates only", async () => {
  const googleUpdates = {
    from: "2026-08-01",
    to: "2026-11-21",
    updates: [],
    posts: [
      {
        title: "Update to the Site Reputation Policy",
        date: "2026-08-28",
        url: "https://developers.google.com/search/blog/2026/08/update-site-reputation-policy",
      },
      { title: "AI <b>Mode</b> rolls out", date: "2026-10-30", url: "javascript:alert(1)" },
      { title: "", date: "2026-10-31" },
    ],
  };
  const { overview, diff, md, mdDiff } = await render({ googleUpdates });
  const text =
    "Google Search Central announcements in this period: Update to the Site Reputation Policy (28 Aug) · AI &lt;b&gt;Mode&lt;/b&gt; rolls out (30 Oct)";
  for (const [where, html] of [
    ["Overview", overview],
    ["Since last audit", diff],
  ])
    assert.ok(html.replace(/<a [^>]*>|<\/a>/g, "").includes(text), where);
  assert.match(
    diff,
    /<a href="https:\/\/developers\.google\.com\/search\/blog\/2026\/08\/update-site-reputation-policy" rel="noopener">Update to the Site Reputation Policy<\/a>/,
  );
  assert.doesNotMatch(diff, /javascript:/);
  const line =
    "Google Search Central announcements in this period: Update to the Site Reputation Policy (28 Aug) · AI \\<b\\>Mode\\</b\\> rolls out (30 Oct)";
  assert.ok(
    mdDiff.includes(line) && md.indexOf(line) < md.indexOf("## Since last audit"),
    "in the Markdown's Overview and Since last audit",
  );
});
