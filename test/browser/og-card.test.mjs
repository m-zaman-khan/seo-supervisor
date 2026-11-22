import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPTS, node, tmp } from "../helpers.mjs";
import { pngSize } from "../../skills/seo-supervisor/scripts/og-card.mjs";
import { findBrowser } from "../../skills/seo-supervisor/scripts/checks/render.mjs";

const CLI = join(SCRIPTS, "og-card.mjs");

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
