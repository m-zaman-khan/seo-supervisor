import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
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
  // Taken out of the page on phones: not in the mobile version Google indexes.
  hidden: doc(
    `<main><h1>Removed on phones</h1><div class="story"><p>${words(300)}</p></div></main><script>if (innerWidth < 600) document.querySelector(".story").remove()</script>`,
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
  newsletter: doc(
    `<main><h1>Newsletter modal</h1><p>${words(200)}</p></main><div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50"><div class="modal" style="background:#fff;margin:25vh 16px;padding:24px">Join our newsletter <input type="email"> <button>Sign up</button></div></div>`,
  ),
  tiny: doc(`<main><h1>Tiny text</h1><p>${words(200)}</p></main>`, "body{font-size:10px}"),
  // No mobile viewport: laid out 980 px wide and zoomed out. The crawler's doc-basics reports it, so nothing here.
  noviewport: doc(`<main><h1>Desktop layout</h1><p>${words(200)}</p></main>`, "body{font-size:11px}").replace(
    /<meta name="viewport"[^>]*>/,
    "",
  ),
  // Still in the page on phones, just collapsed: none of these is a finding.
  accordion: doc(
    `<main><h1>Accordion</h1><p>${words(40)}</p>${[1, 2, 3].map(i => `<section><h2>Part ${i}</h2><div class="panel"><p>${words(80)}</p></div></section>`).join("")}</main>`,
    "@media (max-width:600px){.panel{display:none}}",
  ),
  details: doc(
    `<main><h1>Details</h1><p>${words(40)}</p><details open class="d"><summary>More</summary><p>${words(200)}</p></details></main><script>if (innerWidth < 600) document.querySelector(".d").open = false</script>`,
  ),
  h1span: doc(
    `<main><h1>Fast <span class="hidden-on-mobile">and friendly </span>websites</h1><p>${words(200)}</p></main>`,
    "@media (max-width:600px){.hidden-on-mobile{display:none}}",
  ),
  appshell: doc(
    `<div class="shell"><main><h1>App shell</h1><p>${words(200)}</p></main></div>`,
    ".shell{position:fixed;inset:0;overflow:auto}",
  ),
  stickyhero: doc(
    `<main><section style="height:300vh"><div style="position:sticky;top:0;height:100vh;background:#def"><h1>Sticky hero</h1></div></section><p>${words(200)}</p></main>`,
  ),
  consent: doc(
    `<main><h1>Consent</h1><p>${words(200)}</p></main><div id="onetrust-consent-sdk" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999"><div style="background:#fff;margin:30vh 20px;padding:20px">We use cookies <button>Accept</button></div></div>`,
  ),
  offcanvas: doc(
    `<nav class="drawer">${words(10)}</nav><main><h1>Off canvas</h1><p>${words(200)}</p></main>`,
    "body{overflow-x:hidden}.drawer{position:absolute;top:0;left:100%;width:300px}",
  ),
  aos: doc(
    `<main><h1>Animate</h1><p style="transform:translateX(200px)">${words(200)}</p></main>`,
    "html,body{overflow-x:hidden}",
  ),
  rem: doc(
    `<main><h1>Rem</h1><p style="font-size:1.6rem">${words(200)}</p></main>`,
    "html{font-size:62.5%}body{font-size:inherit}",
  ),
  alert: doc(`<main><h1>Alert</h1><p>${words(200)}</p></main><script>alert("Welcome!")</script>`),
};

test(
  "phone and desktop loads catch removed content, sideways scrolling, tiny text and full-screen popups",
  { skip, timeout: 300000 },
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
    const urls = Object.keys(SITE).map(n => `${site.url}/${n}/`),
      r = { checked: 0, lab: [], notes: [] };
    try {
      for (let i = 0; i < urls.length; i += 10) {
        // it checks 10 pages per run
        const x = await checkVisual(browser, urls.slice(i, i + 10), { add, screenshotDir: shots });
        r.checked += x.checked;
        r.lab.push(...x.lab);
        r.notes.push(...x.notes);
      }
    } finally {
      await site.close();
    }
    const n = Object.keys(SITE).length;
    assert.equal(r.checked, n, r.notes.join(" "));
    assert.deepEqual(
      found,
      {
        hidden: ["mobile-content-missing"],
        heading: ["mobile-content-missing"],
        wide: ["mobile-overflow"],
        overlay: ["mobile-interstitial"],
        newsletter: ["mobile-interstitial"],
        tiny: ["mobile-small-text"],
      },
      "collapsed sections, a desktop-only word in the H1, app shells, sticky heroes, consent tools, clipped overflow, rem text and alert() raise nothing",
    );
    assert.ok(
      r.notes.some(t => /consent/i.test(t) && t.includes("/consent/") && /onetrust/.test(t)),
      r.notes.join(" "),
    );
    assert.equal(r.lab.length, n);
    for (const l of r.lab) assert.ok(l.lcp > 0 && l.cls >= 0 && l.tbt >= 0, JSON.stringify(l));
    assert.equal(imageSize(readFileSync(join(shots, "clean-desktop.png"))).width, 1366);
    assert.deepEqual(
      imageSize(readFileSync(join(shots, "clean-mobile.png"))),
      { type: "png", width: 1170, height: 2532 },
      "390×844 at 3× pixel density",
    );
  },
);

test(
  "a stuck page uses up its time budget, not the run; a stuck lab load is reported as lab speed",
  { skip, timeout: 120000 },
  async () => {
    const dir = tmp(),
      busy = ms => `<script>for (const t = Date.now(); Date.now() - t < ${ms};);</script>`;
    const pages = {
      busy: doc(`<main><h1>Busy</h1><p>${words(100)}</p></main>${busy(15000)}`),
      labbusy: doc(
        `<main><h1>Busy in the lab</h1><p>${words(100)}</p></main><script>if (window.__seoLab) for (const t = Date.now(); Date.now() - t < 15000;);</script>`,
        "body{font-size:10px}",
      ),
    };
    for (const [name, html] of Object.entries(pages)) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, "index.html"), html);
    }
    const site = await serve(dir),
      found = [],
      t0 = Date.now();
    let r;
    try {
      r = await checkVisual(
        browser,
        Object.keys(pages).map(n => `${site.url}/${n}/`),
        { add: (key, url) => found.push(`${key} ${new URL(url).pathname}`), pageBudgetMs: 8000 },
      );
    } finally {
      await site.close();
    }
    assert.ok(Date.now() - t0 < 40000, `took ${Date.now() - t0} ms`);
    assert.equal(r.checked, 1, r.notes.join(" "));
    assert.deepEqual(
      found,
      ["mobile-small-text /labbusy/"],
      "the phone checks still count when only the lab load is stuck",
    );
    assert.ok(
      r.notes.some(t => /^Couldn't load .*\/busy\/ for the phone checks/.test(t)),
      r.notes.join(" "),
    );
    assert.ok(
      r.notes.some(t => /^Couldn't measure lab speed for .*\/labbusy\//.test(t)),
      r.notes.join(" "),
    );
    assert.ok(!r.notes.some(t => /labbusy.*phone checks/.test(t)), r.notes.join(" "));
    assert.deepEqual(r.lab, []);
  },
);

// Chrome escapes non-ASCII as \uXXXX in protocol JSON, so this guards the decoding rather than reproducing a split.
test("the DevTools helper round-trips multi-byte text longer than one pipe read", { skip }, async () => {
  const chrome = await launchChrome(browser);
  try {
    const page = await chrome.newPage();
    const value = (
      await page.send("Runtime.evaluate", { expression: `"日本語のテキスト😀".repeat(20000)`, returnByValue: true })
    ).result.value;
    assert.ok(value === "日本語のテキスト😀".repeat(20000), "no replacement characters");
  } finally {
    await chrome.close();
  }
});

test("SIGINT or SIGTERM takes the browser and its temporary profile down too", { skip, timeout: 60000 }, async () => {
  for (const sig of ["SIGINT", "SIGTERM"]) {
    // process.emit delivers the signal the same way on every OS; on Windows a real one can't be caught.
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { launchChrome } from ${JSON.stringify(pathToFileURL(join(SCRIPTS, "lib", "cdp.mjs")).href)};
const c = await launchChrome(${JSON.stringify(browser)});
console.log(JSON.stringify({ pid: c.pid, profile: c.profile }));
setInterval(() => {}, 1000);
setTimeout(() => process.emit(${JSON.stringify(sig)}, ${JSON.stringify(sig)}), 200);`,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let out = "";
    child.stdout.on("data", d => {
      out += d;
    });
    const ended = await Promise.race([
      new Promise(ok => child.once("exit", () => ok(true))),
      new Promise(ok => setTimeout(ok, 20000, false)),
    ]);
    if (!ended) child.kill("SIGKILL");
    const { pid, profile } = JSON.parse(out);
    for (let i = 0; i < 50 && !gone(pid); i++) await new Promise(ok => setTimeout(ok, 100));
    try {
      assert.ok(ended, `${sig}: the process exits`);
      assert.ok(gone(pid), `${sig}: the browser has exited`);
      assert.ok(!existsSync(profile), `${sig}: the temporary profile is removed`);
    } finally {
      if (!gone(pid)) process.kill(pid);
    }
  }
});

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
