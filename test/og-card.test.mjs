// OG cards without a browser; the test that launches Chrome is in test/browser/og-card.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "./helpers.mjs";
import { cardHtml, pngSize } from "../skills/seo-supervisor/scripts/og-card.mjs";
import { findBrowser } from "../skills/seo-supervisor/scripts/checks/render.mjs";

const CLI = join(SCRIPTS, "og-card.mjs");

test("cardHtml is a self-contained 1200x630 page with the title escaped", () => {
  const html = cardHtml({ title: `Fish & <Chips> "fresh"`, subtitle: "<b>daily</b>", brand: "Joe's" });
  assert.match(html, /Fish &amp; &lt;Chips&gt; &quot;fresh&quot;/);
  assert.match(html, /&lt;b&gt;daily&lt;\/b&gt;/);
  assert.match(html, /Joe&#39;s/);
  assert.ok(!html.includes("<Chips>") && !html.includes("<b>daily"), "nothing from the input is markup");
  assert.match(html, /width:\s*1200px/);
  assert.match(html, /height:\s*630px/);
  assert.ok(!/https?:\/\//.test(html), "no network: no external fonts, styles or images");
});

test("long titles get a smaller size class; bad colours are refused", () => {
  const cls = title => cardHtml({ title }).match(/class="title (title-\w+)"/)[1];
  assert.equal(cls("Pricing"), "title-lg");
  assert.equal(cls("A".repeat(60)), "title-md");
  assert.equal(cls("A".repeat(110)), "title-sm");
  assert.throws(() => cardHtml({ title: "x", accent: "red;}body{display:none" }), /accent/);
});

test("pngSize reads width and height from the PNG header", () => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(1200, 16);
  b.writeUInt32BE(630, 20);
  assert.deepEqual(pngSize(b), { width: 1200, height: 630 });
  assert.equal(pngSize(Buffer.from("not a png at all, just some text")), null);
});

test("the CLI exits 2 with a clear message when CHROME_PATH isn't a browser", async () => {
  const out = join(tmp(), "home.png");
  await assert.rejects(
    node([CLI, "--title", "Home", "--out", out], { env: { ...process.env, CHROME_PATH: process.execPath } }),
    e => e.code === 2 && /isn't Chrome or Edge/.test(e.stderr) && /CHROME_PATH/.test(e.stderr),
  );
});

test("batch file names: a non-ASCII slug isn't home.png, and names that differ only in case collide", async () => {
  const dir = tmp(),
    pages = join(dir, "pages.json");
  const runWith = list => {
    writeFileSync(pages, JSON.stringify(list));
    return node([CLI, "--pages", pages, "--out-dir", join(dir, "og")], {
      env: { ...process.env, CHROME_PATH: process.execPath },
    }).then(
      () => "",
      e => e.stderr,
    );
  };
  assert.doesNotMatch(
    await runWith([
      { slug: "/", title: "Home" },
      { slug: "/日本語/", title: "Japanese" },
      { slug: "/中文/", title: "Chinese" },
    ]),
    /two pages/,
  );
  assert.match(
    await runWith([
      { slug: "/About/", title: "About" },
      { slug: "/about/", title: "About us" },
    ]),
    /two pages would both write/,
  );
});

const browser = findBrowser();
test(
  "a real card renders at exactly 1200x630, single and batch",
  { skip: !browser && "Chrome not installed" },
  async () => {
    const dir = tmp(),
      logo = join(dir, "logo.svg"),
      pages = join(dir, "pages.json");
    writeFileSync(
      logo,
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#2459c9"/></svg>`,
    );
    await node([
      CLI,
      "--title",
      "Plans and pricing for small teams",
      "--subtitle",
      "Start free",
      "--brand",
      "Example",
      "--logo",
      logo,
      "--out",
      join(dir, "single.png"),
    ]);
    assert.deepEqual(pngSize(readFileSync(join(dir, "single.png"))), { width: 1200, height: 630 });

    writeFileSync(
      pages,
      JSON.stringify([
        { slug: "/", title: "Home" },
        { slug: "/blog/first-post/", title: "A".repeat(120), subtitle: "Long one" },
        { slug: "/日本語/", title: "日本語のページ" },
      ]),
    );
    const { stdout } = await node([CLI, "--pages", pages, "--brand", "Example", "--out-dir", join(dir, "og")]);
    assert.match(stdout, /3 card/);
    const files = readdirSync(join(dir, "og")).sort();
    assert.equal(files.length, 3, files.join(", "));
    assert.deepEqual(files.slice(0, 2), ["blog-first-post.png", "home.png"]);
    assert.match(files[2], /^page-[0-9a-f]{8}\.png$/, "a short hash-based name for an all-non-ASCII slug");
    for (const f of files) assert.deepEqual(pngSize(readFileSync(join(dir, "og", f))), { width: 1200, height: 630 }, f);
  },
);
