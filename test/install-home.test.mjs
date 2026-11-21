// The settings folder SEO_SUPERVISOR_HOME and what follows it, and odd input that's skipped or explained, not a crash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp } from "./helpers.mjs";
import { findBrowser } from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { findLighthouse } from "../skills/seo-supervisor/scripts/checks/lighthouse.mjs";

test("findBrowser falls back to the browser --with-browser installed, in the settings folder SEO_SUPERVISOR_HOME names", () => {
  const home = tmp(),
    chrome = join(home, "chrome.exe");
  mkdirSync(join(home, "tools"), { recursive: true });
  writeFileSync(chrome, "");
  writeFileSync(join(home, "tools", "chrome-path.txt"), chrome + "\n");
  assert.equal(
    findBrowser({ SEO_SUPERVISOR_HOME: home }, "linux", p => p === chrome),
    chrome,
  );
  assert.equal(
    findBrowser(
      { SEO_SUPERVISOR_HOME: home, CHROME_PATH: "/x/chrome" },
      "linux",
      p => p === "/x/chrome" || p === chrome,
    ),
    "/x/chrome",
    "CHROME_PATH still comes first",
  );
  assert.equal(
    findBrowser({ SEO_SUPERVISOR_HOME: tmp() }, "linux", () => false),
    null,
  );
});

test("a guide's schema date that isn't a date is skipped, never a crash", async () => {
  const { newestDate } = await import("../skills/seo-supervisor/scripts/checks/content.mjs");
  for (const bad of ["", "N/A", "{{date}}", "Mon, 03 Jun 24", "2024-13-45"])
    assert.equal(
      newestDate("<p>How to bleed a radiator</p>", [{ dateModified: bad }], Date.UTC(2026, 10, 21)),
      null,
      JSON.stringify(bad),
    );
  assert.equal(
    newestDate("", [{ dateModified: "N/A", datePublished: "2025-03-01" }], Date.UTC(2026, 10, 21)).date,
    "2025-03-01",
    "the good date still counts",
  );
});

test("masking secrets leaves ordinary site URLs alone", async () => {
  const { redact } = await import("../skills/seo-supervisor/scripts/lib/redact.mjs");
  for (const u of [
    "https://example.com/home/garden/",
    "https://example.com/c/home/kitchen?sort=asc",
    "https://example.com/Users/guide/",
    "https://shop.example/p?key=blue",
  ])
    assert.equal(redact(u), u, u);
  assert.equal(
    redact("https://example.com/x?api_key=abcd1234efgh5678"),
    "https://example.com/x?api_key=[hidden]",
    "a real secret is still masked",
  );
});

test("a new crawl into seo-crawl.json files the one it replaces in history/ first, once", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { SCRIPTS, node } = await import("./helpers.mjs");
  const { serve } = await import("./serve.mjs");
  const root = tmp(),
    dir = join(tmp(), "seo-audit"),
    out = join(dir, "seo-crawl.json");
  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><html lang="en"><head><title>Boiler repairs in Leeds</title></head><body><h1>Boiler repairs</h1></body></html>',
  );
  const site = await serve(root);
  try {
    const crawl = () => node([join(SCRIPTS, "seo-crawl.mjs"), "--url", site.url, "--out", out]);
    await crawl();
    const first = JSON.parse(readFileSync(out, "utf8")).crawledAt;
    await crawl();
    const hist = join(dir, "history"),
      files = readdirSync(hist);
    assert.equal(files.length, 1, files.join(", "));
    assert.equal(
      JSON.parse(readFileSync(join(hist, files[0]), "utf8")).crawledAt,
      first,
      "the replaced crawl is the one filed",
    );
  } finally {
    await site.close();
  }
});

test("the score model skips null or malformed findings and passed rules instead of crashing", async () => {
  const { normalise, buildRules, score } = await import("../skills/seo-supervisor/scripts/lib/score.mjs");
  const rules = buildRules(normalise([null, "x", { rule: "META-01", severity: "low" }]), [
    null,
    { rule: "MAP-01" },
    { nope: 1 },
  ]);
  assert.deepEqual(rules.map(r => r.key).sort(), ["MAP-01", "META-01"]);
  assert.equal(score(rules).value, 90);
});

test("SEO_SUPERVISOR_HOME expands ~ and never resolves inside the current folder", async () => {
  const { settingsDir } = await import("../skills/seo-supervisor/scripts/lib/settings-dir.mjs");
  const { isAbsolute } = await import("node:path");
  assert.equal(settingsDir({ SEO_SUPERVISOR_HOME: "~/.seo" }, "/home/me"), join("/home/me", ".seo"));
  assert.equal(settingsDir({ SEO_SUPERVISOR_HOME: "~" }, "/home/me"), join("/home/me"));
  assert.throws(() => settingsDir({ SEO_SUPERVISOR_HOME: "settings" }, "/home/me"), /full path/);
  assert.ok(isAbsolute(settingsDir({}, "/home/me")));
});

test("findLighthouse looks in the settings folder SEO_SUPERVISOR_HOME names", () => {
  const home = tmp(),
    bin = join(home, "tools", "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "lighthouse"), "");
  assert.equal(findLighthouse({ SEO_SUPERVISOR_HOME: home, PATH: "" }, "/nowhere", "linux"), join(bin, "lighthouse"));
});

test("a bad SEO_SUPERVISOR_CLIENT or SEO_SUPERVISOR_HOME gives a plain message, not a stack trace", async () => {
  const { SCRIPTS, node } = await import("./helpers.mjs");
  for (const [script, args] of [
    ["connect-keys.mjs", ["status"]],
    ["google.mjs", ["status"]],
  ])
    for (const extra of [{ SEO_SUPERVISOR_CLIENT: "acme corp" }, { SEO_SUPERVISOR_HOME: "relative/dir" }]) {
      const env = { ...process.env, SEO_SUPERVISOR_CLIENT: "", SEO_SUPERVISOR_HOME: "", ...extra };
      await assert.rejects(
        node([join(SCRIPTS, script), ...args], { env }),
        e => e.code === 2 && /SEO_SUPERVISOR_(CLIENT|HOME) must be/.test(e.stderr) && !/\n\s+at /.test(e.stderr),
        `${script} ${JSON.stringify(extra)}`,
      );
    }
});

test("a bad SEO_SUPERVISOR_HOME doesn't crash the Lighthouse lookup a crawl makes", () => {
  assert.equal(findLighthouse({ SEO_SUPERVISOR_HOME: "relative/dir", PATH: "" }, "/nowhere", "linux"), null);
});

test("odd outside answers are skipped, not fatal: an entity past Unicode in a feed, a null RDAP service", async () => {
  const { blogPosts } = await import("../skills/seo-supervisor/scripts/google-updates.mjs");
  const xml = `<rss><channel><item><title>Bad &#x110000; title</title><link>https://developers.google.com/search/blog/x</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  assert.doesNotThrow(() => blogPosts(xml, { from: "2026-11-01", to: "2026-11-30" }));
  const { serverFor } = await import("../skills/seo-supervisor/scripts/rdap.mjs");
  assert.equal(serverFor([null, [["com"], ["https://rdap.example/"]]], ["acme", "com"])?.base, "https://rdap.example/");
});
