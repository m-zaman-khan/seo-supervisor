// Page states, phone menus, jump links and render steps in real Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome } from "../../skills/seo-supervisor/scripts/lib/cdp.mjs";
import { findBrowser, renderPage } from "../../skills/seo-supervisor/scripts/checks/render.mjs";
import { MORE_CHECKS, checkMore } from "../../skills/seo-supervisor/scripts/checks/visual.mjs";
import { imageSize } from "../../skills/seo-supervisor/scripts/lib/image-size.mjs";
import { serve } from "../serve.mjs";
import { SCRIPTS, node, tmp } from "../helpers.mjs";

const browser = findBrowser();
const skip = !browser && "Chrome not installed";
const words = n => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const doc = (body, { css = "", title = "Page" } = {}) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{margin:0;font:16px/1.5 sans-serif}${css}</style></head><body>${body}</body></html>`;

const nav = `<header><nav id="nav">${["/a/", "/b/", "/c/", "/d/", "/e/", "/f/"].map(h => `<a href="${h}">Link ${h}</a>`).join(" ")}</nav><button id="tog" aria-expanded="false" aria-controls="nav">Menu</button></header>`;
const navCss =
  "#tog{display:none}@media (max-width:600px){#nav{display:none}#tog{display:block}#nav.open{display:block}}";
const SITE = {
  // Nothing to report: H1 and a button up top, a phone menu that opens, a jump link to a real target, a cookie bar.
  clean: doc(
    `${nav}<main><h1>Clean page</h1><a class="btn" href="/contact/" style="background:#036;color:#fff;padding:8px">Get a quote</a><p><a href="#details">Details</a> ${words(150)}</p><div style="height:1600px"></div><h2 id="details">Details</h2><p>${words(100)}</p></main><div id="cookie-bar" style="position:fixed;bottom:0;left:0;right:0;background:#eee">We use cookies. <button>OK</button></div><script>tog.onclick = () => nav.classList.toggle("open")</script>`,
    { css: navCss },
  ),
  errors: doc(
    `<main><h1>Errors</h1><p>${words(100)}</p><img src="/missing.png" alt=""></main><script>console.error("boom"); null.x;</script>`,
  ),
  jsadded: doc(
    `<main><h1>Added</h1><p>${words(20)}</p><div id="more"></div></main><script>document.getElementById("more").textContent = ${JSON.stringify(words(400))}</script>`,
  ),
  // The menu button does nothing.
  menu: doc(`${nav}<main><h1>Broken menu</h1><p>${words(100)}</p></main>`, { css: navCss }),
  ads: doc(
    `<main><h1>Ads</h1><p>${words(40)}</p>${'<ins class="adsbygoogle" style="display:block;height:300px;background:#fc0"></ins>'.repeat(3)}<p>${words(40)}</p></main>`,
  ),
  fold: doc(`<div style="height:120vh;background:#ccc"></div><main><h1>Below the fold</h1><p>${words(100)}</p></main>`),
  hidden: doc(
    `<main><h1>Hidden</h1><p>${words(100)}</p><div style="display:none">${words(200)}</div><span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden">${words(30)}</span><details><summary>FAQ</summary><p>${words(200)}</p></details><div class="tab-pane" hidden>${words(100)}</div></main>`,
  ),
  // Scrolls to the top and drops the #fragment once loaded, as some routers do.
  jump: doc(
    `<main><h1>Jump</h1><p><a href="#missing">Missing</a> ${words(100)}</p><div style="height:1600px"></div><h2 id="part">Part</h2><p>${words(100)}</p></main><script>addEventListener("load", () => setTimeout(() => { scrollTo(0, 0); history.replaceState(null, "", location.pathname); }, 100))</script>`,
  ),
  login: doc(
    `<main><h1>Sign in</h1><form><input name="email"><input type="password" name="pw"><button>Log in</button></form></main>`,
    { title: "Sign in" },
  ),
  // The --render-page target: more text after a click.
  feed: doc(
    `<main><h1>Feed</h1><p>${words(50)}</p><div id="list"></div><button id="more">Load more</button></main><script>document.getElementById("more").onclick = () => document.getElementById("list").textContent += " ${words(300)}"</script>`,
  ),
};

test(
  "render checks in Chrome: errors, JavaScript text, the first screen, menus, ads, hidden text, jump links, gates, screenshots and a chosen page",
  { skip, timeout: 300000 },
  async () => {
    const dir = tmp(),
      shots = join(dir, "screenshots");
    for (const [name, html] of Object.entries(SITE)) {
      mkdirSync(join(dir, name));
      writeFileSync(join(dir, name, "index.html"), html);
    }
    const site = await serve(dir),
      found = {},
      at = n => `${site.url}/${n}/`;
    const add = (key, url, detail) => {
      assert.ok(MORE_CHECKS[key], key);
      (found[new URL(url).pathname.slice(1, -1)] ||= []).push(key);
      found[`${key} detail`] = detail;
    };
    let r;
    try {
      r = await checkMore(
        browser,
        Object.keys(SITE)
          .filter(n => n !== "feed")
          .map(at),
        {
          add,
          screenshotDir: shots,
          clean: true,
          rawWords: new Map([
            [at("clean"), 272],
            [at("jsadded"), 22],
          ]),
          chosen: { url: at("feed"), steps: "scroll; click #more; wait 200", raw: SITE.feed },
        },
      );
    } finally {
      await site.close();
    }
    const page = n => r.pages.find(p => p.url === at(n));
    assert.equal(r.checked, 8, r.notes.join(" "));
    assert.deepEqual(
      Object.fromEntries(Object.entries(found).filter(([k]) => !k.includes(" "))),
      { jsadded: ["render-adds-text"], menu: ["mobile-menu-closed"], ads: ["mobile-ad-density"] },
      "the clean page and the rest stay quiet",
    );
    assert.match(found["render-adds-text detail"], /^22 words in the HTML, 4\d\d after JavaScript runs$/);
    assert.match(found["mobile-menu-closed detail"], /“Menu” showed 0 of the 6 menu links/);
    assert.match(found["mobile-ad-density detail"], /ads take \d+% of the page's height on a phone/);

    assert.deepEqual(page("clean").h1, { desktop: true, phone: true });
    assert.deepEqual(page("clean").cta, { desktop: "Get a quote", phone: "Get a quote" });
    assert.equal(page("clean").menu, "opens");
    assert.equal(page("clean").jumpLinks?.deepLink, "ok");
    assert.deepEqual(page("clean").errors, []);
    assert.deepEqual(page("fold").h1, { desktop: false, phone: false });
    assert.deepEqual(page("fold").cta, { desktop: null, phone: null });
    const errs = page("errors").errors.join("\n");
    assert.match(errs, /TypeError: Cannot read properties of null/);
    assert.match(errs, /console\.error: boom/);
    assert.match(errs, /404.*\(missing\.png\)/);
    assert.deepEqual(
      page("hidden").hidden.by,
      { "display:none": 200, "screen-reader only": 30 },
      "the closed <details> and the hidden tab aren't counted",
    );
    assert.deepEqual(page("jump").jumpLinks.broken, ["missing"]);
    assert.equal(page("jump").jumpLinks.deepLink, "both", "scrolled away and dropped the #fragment");
    assert.equal(page("login").gate, "a login screen");
    assert.equal(page("login").h1, undefined, "a login screen isn't measured as the page");

    for (const f of [
      "clean-desktop-full.jpg",
      "clean-mobile-full.jpg",
      "clean-desktop-clean.png",
      "clean-mobile-clean.png",
    ])
      assert.ok(existsSync(join(shots, f)), f);
    assert.ok(!existsSync(join(shots, "errors-desktop-clean.png")), "no clean copy when there was nothing to hide");
    assert.equal(imageSize(readFileSync(join(shots, "clean-desktop-1920.png"))).width, 1920);
    assert.equal(imageSize(readFileSync(join(shots, "clean-tablet.png"))).width, 768);
    const full = imageSize(readFileSync(join(shots, "clean-mobile-full.jpg")));
    assert.equal(full.width, 390, "whole-page shots are at CSS pixels");
    assert.ok(full.height > 1800, `the whole page, ${full.height} px`);

    assert.equal(r.chosen.url, at("feed"));
    assert.ok(r.chosen.words.rendered >= r.chosen.words.html + 300, JSON.stringify(r.chosen.words));
    assert.equal(r.chosen.steps, "scroll; click #more; wait 200");
    assert.ok(existsSync(join(shots, "chosen-mobile-full.jpg")));
    assert.ok(
      r.notes.some(n => /Look through them for text that overlaps or is cut off/.test(n)),
      r.notes.join("\n"),
    );
  },
);

test(
  "Chrome: a render that lands on a login screen isn't compared, and launchChrome takes extra flags",
  { skip, timeout: 180000 },
  async t => {
    const dir = tmp();
    mkdirSync(join(dir, "login"));
    writeFileSync(join(dir, "login", "index.html"), SITE.login);
    const site = await serve(dir);
    try {
      await assert.rejects(
        renderPage(browser, `${site.url}/login/`),
        /Chrome showed a login screen at .*\/login\/, so it wasn't compared with the raw HTML/,
      );
    } catch (e) {
      if (/sandbox/i.test(`${e.message} ${e.stderr || ""}`)) return t.skip("Chrome sandbox unavailable here");
      throw e;
    } finally {
      await site.close();
    }
    const chrome = await launchChrome(browser, { args: ["--user-agent=seo-supervisor-test"] });
    try {
      const page = await chrome.newPage();
      assert.equal(
        (await page.send("Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true })).result.value,
        "seo-supervisor-test",
      );
    } finally {
      await chrome.close();
    }
  },
);

test(
  "the crawler with --outside: render sample data, REND-11, and the chosen page with its steps",
  { skip, timeout: 400000 },
  async () => {
    const dir = tmp(),
      out = join(tmp(), "crawl.json");
    const pages = {
      "/": doc(`<main><h1>Boiler repairs in Leeds</h1><p>${words(120)}</p><a href="/added/">Added</a></main>`, {
        title: "Boiler repairs in Leeds",
      }),
      "/added/": SITE.jsadded.replace("<title>Page", "<title>Added text"),
      "/feed/": SITE.feed.replace("<title>Page", "<title>Feed"),
    };
    for (const [p, html] of Object.entries(pages)) {
      mkdirSync(join(dir, p), { recursive: true });
      writeFileSync(join(dir, p, "index.html"), html);
    }
    const site = await serve(dir);
    try {
      await node(
        [
          join(SCRIPTS, "seo-crawl.mjs"),
          "--url",
          site.url,
          "--site-origin",
          "https://site.example",
          "--outside",
          "--psi-endpoint",
          "http://127.0.0.1:9/runPagespeed",
          "--out",
          out,
          "--render-page",
          `${site.url}/feed/`,
          "--render-steps",
          "click #more",
        ],
        { timeout: 380000 },
      );
    } finally {
      await site.close();
    }
    const r = JSON.parse(readFileSync(out, "utf8"));
    assert.ok(
      r.passed.some(p => p.rule === "REND-11"),
      JSON.stringify(r.notChecked.find(n => n.rule === "REND-11")),
    );
    assert.ok(
      r.renderSample.some(p => p.url.endsWith("/added/")),
      JSON.stringify(r.renderSample),
    );
    assert.deepEqual(
      r.findings.find(f => f.check === "render-adds-text")?.evidence.map(e => new URL(e.url).pathname),
      ["/added/"],
    );
    assert.equal(new URL(r.renderedPage.url).pathname, "/feed/");
    assert.ok(r.renderedPage.words.rendered > r.renderedPage.words.html + 250, JSON.stringify(r.renderedPage));
    assert.ok(existsSync(join(out, "..", "screenshots", "chosen-mobile-full.jpg")));
  },
);
