// seo-diff.mjs flags a jump in new pages of at least 50 and 20%.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { diffCrawls } from "../skills/seo-supervisor/scripts/seo-diff.mjs";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const read = p => JSON.parse(readFileSync(p, "utf8"));
const P = path => ({
  url: `https://e.com${path}`,
  status: 200,
  noindex: false,
  canonical: `https://e.com${path}`,
  title: `Title of ${path}`,
  h1: 1,
  schema: [],
});
const paths = (n, f) => Array.from({ length: n }, (_, i) => f(String(i).padStart(3, "0")));
const crawl = (list, extra = {}) => ({
  crawledAt: "2026-10-01T09:00:00.000Z",
  stats: { capped: false },
  pages: list.map(P),
  ...extra,
});
// The last crawl: the home page and `n - 1` blog posts.
const site = n => ["/", ...paths(n - 1, i => `/blog/post-${i}/`)];

const render = async diff => {
  const dir = tmp(),
    data = read(join(SKILL, "examples", "sample-audit.json"));
  if (diff) data.diff = diff;
  else delete data.diff;
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  const html = readFileSync(join(dir, "r.html"), "utf8"),
    md = readFileSync(join(dir, "r.md"), "utf8");
  const i = html.indexOf('id="p-diff"');
  return {
    html,
    md,
    diff: i < 0 ? "" : html.slice(i, html.indexOf('class="tp"', i)).replaceAll("&#39;", "'"),
    mdDiff: md.includes("## Since last audit")
      ? md.slice(md.indexOf("## Since last audit"), md.indexOf("\n## ", md.indexOf("## Since last audit") + 3))
      : "",
  };
};
const LINE = /new pages appeared since the last audit/;

test("a big jump in new pages lists them by folder, with examples from different folders", async () => {
  const old = site(300),
    added = [
      ...paths(180, i => `/cheap-pills/buy-${i}/`),
      ...paths(12, i => `/blog/new-${i}/`),
      "/about-us/",
      "/contact/",
    ];
  const d = diffCrawls(crawl(old), crawl([...old, ...added]));
  assert.equal(d.added.length, 194);
  const b = d.addedBurst;
  assert.deepEqual([b.pages, b.before, b.share], [194, 300, 0.647]);
  assert.deepEqual(
    b.sections,
    [
      { path: "/cheap-pills/", pages: 180 },
      { path: "/blog/", pages: 12 },
      { path: "/", pages: 2 },
    ],
    "a folder with pages below it is a section; /about-us/ and /contact/ are top-level pages",
  );
  assert.equal(b.examples.length, 10);
  assert.deepEqual(
    b.examples.slice(0, 4).map(e => e.path),
    ["/cheap-pills/buy-000/", "/blog/new-000/", "/about-us/", "/cheap-pills/buy-001/"],
    "one from each folder in turn, largest first",
  );
  assert.deepEqual(
    new Set(b.examples.map(e => e.path.split("/")[1])).size,
    4,
    "not the first 10 alphabetically, which would be /about-us/ and nine /blog/ pages",
  );
  assert.equal(b.examples[0].title, "Title of /cheap-pills/buy-000/");

  const dir = tmp(),
    out = join(dir, "seo-diff.json");
  writeFileSync(join(dir, "old.json"), JSON.stringify(crawl(old)));
  writeFileSync(
    join(dir, "new.json"),
    JSON.stringify(crawl([...old, ...added], { crawledAt: "2026-11-01T09:00:00.000Z" })),
  );
  await node([join(SCRIPTS, "seo-diff.mjs"), join(dir, "old.json"), join(dir, "new.json"), "--out", out]);
  assert.deepEqual(read(out).addedBurst, b);

  const r = await render({
    since: "2026-10-01T09:00:00.000Z",
    regressions: [],
    improvements: [],
    changed: [],
    added: d.added,
    removed: [],
    addedBurst: b,
  });
  const line =
    "194 new pages appeared since the last audit (on 1 Oct 2026), 65% more than the 300 pages it found. If you didn't add them, check for hacked or spam pages";
  for (const [where, text] of [
    ["HTML", r.diff],
    ["Markdown", r.mdDiff],
  ]) {
    assert.ok(text.includes(line), where);
    assert.ok(
      text.includes("https://support.google.com/webmasters/answer/9044101#hacked-url-injection"),
      `${where}: Google's help on hacked content`,
    );
    assert.ok(text.includes("Our own line"), `${where}: the threshold is labelled ours`);
    assert.ok(text.includes("Information only: it doesn't change the score."), where);
  }
  assert.ok(r.diff.indexOf(line) < r.diff.indexOf("Compared with the crawl of"), "at the top of Since last audit");
  assert.ok(r.mdDiff.indexOf(line) < r.mdDiff.indexOf("Compared with the crawl of"), "at the top in the Markdown too");
  assert.ok(r.diff.includes("New pages by folder: /cheap-pills/ 180 · /blog/ 12 · / (top level) 2"));
  assert.ok(r.mdDiff.includes("New pages by folder: `/cheap-pills/` 180 · `/blog/` 12 · `/` (top level) 2"));
  assert.ok(
    r.diff.includes("<li><b><code>/cheap-pills/buy-000/</code></b><span>Title of /cheap-pills/buy-000/</span></li>"),
  );
  assert.ok(r.mdDiff.includes("- `/blog/new-000/` Title of /blog/new-000/"));
  assert.doesNotMatch(
    r.diff + r.mdDiff,
    /hacked\b(?! or spam| content|-url)|spam words|off-topic/i,
    "no claim the site was hacked, and no topic judgment",
  );
});

test("normal growth shows nothing extra: a few new pages, or many on a big site", async () => {
  const small = diffCrawls(crawl(site(100)), crawl([...site(100), ...paths(10, i => `/blog/new-${i}/`)]));
  assert.equal(small.added.length, 10);
  assert.ok(!("addedBurst" in small));
  const big = diffCrawls(crawl(site(1000)), crawl([...site(1000), ...paths(150, i => `/blog/new-${i}/`)]));
  assert.ok(!("addedBurst" in big), "150 new pages on a 1,000-page site is 15%, under our 20% line");
  const r = await render({
    since: "2026-10-01T09:00:00.000Z",
    regressions: [],
    improvements: [],
    changed: [],
    added: small.added,
    removed: [],
  });
  assert.ok(r.diff.includes("Pages added"));
  assert.doesNotMatch(r.diff + r.mdDiff, LINE);
});

test("a first audit, with nothing to compare, shows nothing", async () => {
  const r = await render(null);
  assert.equal(r.diff, "", "no Since last audit tab");
  assert.doesNotMatch(r.html + r.md, LINE);
  assert.ok(
    !("addedBurst" in diffCrawls({ pages: [] }, crawl(site(200)))),
    "a last crawl with no pages that loaded has nothing to compare",
  );
  assert.ok(
    !("addedBurst" in diffCrawls(crawl(site(10), { stats: { capped: true }, options: { max: 10 } }), crawl(site(200)))),
    "a last crawl that stopped at --max: pages it didn't reach aren't known to be new",
  );
});

test("our own line at its edges: at least 50 new pages and at least 20% more", () => {
  const grow = (was, n) => diffCrawls(crawl(site(was)), crawl([...site(was), ...paths(n, i => `/x/p-${i}/`)]));
  assert.equal(grow(250, 50).addedBurst?.pages, 50, "50 new on 250 is exactly 20%");
  assert.ok(!("addedBurst" in grow(251, 50)), "50 new on 251 is just under 20%");
  assert.ok(!("addedBurst" in grow(100, 49)), "49 new is under 50, however small the site");
  assert.equal(grow(100, 50).addedBurst?.pages, 50);
});

test("paths and titles in the examples are escaped in HTML and Markdown", async () => {
  const b = {
    pages: 60,
    before: 100,
    share: 0.6,
    sections: [{ path: "/<i>x</i>/", pages: 60 }],
    examples: [
      { path: "/<i>x</i>/a&b/", title: "<script>alert(1)</script> *cheap* [pills]" },
      { path: "/`x`/", title: null },
    ],
  };
  const r = await render({
    since: "2026-10-01T09:00:00.000Z",
    regressions: [],
    improvements: [],
    changed: [],
    added: ["/a/"],
    removed: [],
    addedBurst: b,
  });
  assert.ok(r.diff.includes("<code>/&lt;i&gt;x&lt;/i&gt;/a&amp;b/</code>"));
  assert.ok(r.diff.includes("&lt;script&gt;alert(1)&lt;/script&gt; *cheap* [pills]"));
  assert.ok(r.diff.includes("/&lt;i&gt;x&lt;/i&gt;/ 60"));
  assert.ok(!r.html.includes("<script>alert(1)"));
  assert.ok(
    r.mdDiff.includes("- `/<i>x</i>/a&b/` \\<script\\>alert(1)\\</script\\> \\*cheap\\* \\[pills\\]"),
    "a code span keeps the path as is; the title's Markdown is escaped",
  );
  assert.ok(r.mdDiff.includes("- `/ x /` no title"), "a backtick can't end the code span");
});
