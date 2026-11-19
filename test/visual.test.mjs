import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome } from "../skills/seo-supervisor/scripts/lib/cdp.mjs";
import { CHECKS, checkVisual } from "../skills/seo-supervisor/scripts/checks/visual.mjs";
import { findBrowser } from "../skills/seo-supervisor/scripts/checks/render.mjs";
import { imageSize } from "../skills/seo-supervisor/scripts/lib/image-size.mjs";
import { serve } from "./serve.mjs";
import { SKILL, SCRIPTS, node, tmp } from "./helpers.mjs";

const browser = findBrowser();
const skip = !browser && "Chrome not installed";
const gone = pid => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === "ESRCH";
  }
};

test("the DevTools helper drives a page over the pipe and leaves no browser or profile behind", { skip }, async () => {
  const chrome = await launchChrome(browser);
  try {
    const page = await chrome.newPage();
    assert.equal((await page.send("Runtime.evaluate", { expression: "1+1", returnByValue: true })).result.value, 2);
    await page.close();
  } finally {
    await chrome.close();
  }
  assert.ok(gone(chrome.pid), "the browser process has exited");
  assert.ok(!existsSync(chrome.profile), "the temporary profile is removed");
});

test("a browser that won't start fails fast and cleanly", async () => {
  await assert.rejects(launchChrome(process.execPath, { timeoutMs: 5000 }), /exited|timed out/);
});

const words = n => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const doc = (body, css = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page</title><style>body{margin:0;font:16px/1.5 sans-serif}${css}</style></head><body>${body}</body></html>`;
const SITE = {
  clean: doc(
    `<main><h1>Clean page</h1><p>${words(200)}</p></main><div style="position:fixed;bottom:0;left:0;right:0;height:60px;background:#eee">We use cookies. <button>OK</button></div>`,
  ),
  hidden: doc(
    `<main><h1>Hidden on phones</h1><div class="story"><p>${words(300)}</p></div></main>`,
    "@media (max-width: 600px){.story{display:none}}",
  ),
  heading: doc(
    `<main><h1 class="big">Desktop heading</h1><p>${words(200)}</p></main>`,
    "@media (max-width: 600px){.big{display:none}}",
  ),
  wide: doc(
    `<main><h1>Wide table</h1><table style="width:1200px"><tr><td>${words(40)}</td></tr></table><p>${words(100)}</p></main>`,
  ),
  overlay: doc(
    `<main><h1>Overlay</h1><p>${words(200)}</p></main><div id="promo" style="position:fixed;inset:0;background:#fff">Subscribe to read on</div>`,
  ),
  tiny: doc(`<main><h1>Tiny text</h1><p>${words(200)}</p></main>`, "body{font-size:10px}"),
  // No mobile viewport: laid out 980 px wide and zoomed out. The crawler's doc-basics reports it, so nothing here.
  noviewport: doc(`<main><h1>Desktop layout</h1><p>${words(200)}</p></main>`, "body{font-size:11px}").replace(
    /<meta name="viewport"[^>]*>/,
    "",
  ),
};

test(
  "phone and desktop loads catch hidden content, sideways scrolling, tiny text and full-screen popups",
  { skip, timeout: 120000 },
  async () => {
    const dir = tmp(),
      shots = join(dir, "screenshots");
    for (const [name, html] of Object.entries(SITE)) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, "index.html"), html);
    }
    const site = await serve(dir);
    const found = {};
    const add = (key, url, detail) => {
      assert.ok(CHECKS[key], key);
      (found[new URL(url).pathname.slice(1, -1)] ||= []).push(key);
    };
    let r;
    try {
      r = await checkVisual(
        browser,
        Object.keys(SITE).map(n => `${site.url}/${n}/`),
        { add, screenshotDir: shots },
      );
    } finally {
      await site.close();
    }
    assert.equal(r.checked, 7, r.notes.join(" "));
    assert.deepEqual(
      found,
      {
        hidden: ["mobile-content-missing"],
        heading: ["mobile-content-missing"],
        wide: ["mobile-overflow"],
        overlay: ["mobile-interstitial"],
        tiny: ["mobile-small-text"],
      },
      "the clean page (with a small cookie bar) raises nothing",
    );
    assert.equal(r.lab.length, 7);
    for (const l of r.lab) assert.ok(l.lcp > 0 && l.cls >= 0 && l.tbt >= 0, JSON.stringify(l));
    assert.equal(imageSize(readFileSync(join(shots, "clean-desktop.png"))).width, 1366);
    assert.deepEqual(
      imageSize(readFileSync(join(shots, "clean-mobile.png"))),
      { type: "png", width: 1170, height: 2532 },
      "390×844 at 3× pixel density",
    );
  },
);

test("the overview shows one line of indicative lab speed for the home page", async () => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SKILL, "examples", "sample-audit.json"), "utf8"));
  data.labSpeed = [
    { url: "https://example.com/about/", lcp: 1800, cls: 0, tbt: 90 },
    { url: "https://example.com/", lcp: 3240, cls: 0.041, tbt: 450 },
  ];
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  const line = /Lab speed, slow mobile \(indicative\): LCP 3\.2 s · CLS 0\.04 · TBT 450 ms on the home page/;
  assert.ok(line.test(readFileSync(join(dir, "r.html"), "utf8")), "HTML overview");
  assert.ok(line.test(readFileSync(join(dir, "r.md"), "utf8")), "Markdown overview");
});
