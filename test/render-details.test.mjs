// The Chrome tests are in test/browser/render-details.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gateOf } from "../skills/seo-supervisor/scripts/checks/render.mjs";
import {
  MORE_CHECKS,
  adShare,
  addsText,
  errorOf,
  menuVerdict,
  parseSteps,
} from "../skills/seo-supervisor/scripts/checks/visual.mjs";
import { serve } from "./serve.mjs";
import { SCRIPTS, node, tmp } from "./helpers.mjs";

const words = n => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const doc = (body, { css = "", title = "Page" } = {}) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{margin:0;font:16px/1.5 sans-serif}${css}</style></head><body>${body}</body></html>`;

// ---------- pure parts, from recorded data ----------
test("a login screen and a paywall are told apart from an ordinary page", () => {
  assert.equal(
    gateOf(
      doc(
        `<main><h1>Sign in</h1><form><input name="u"><input type="password" name="p"><button>Log in</button></form></main>`,
        { title: "Sign in · Acme" },
      ),
    ),
    "a login screen",
  );
  assert.match(
    gateOf(
      doc(
        `<main><h1>Story</h1></main><script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree": false}</script>`,
      ),
    ),
    /^a paywall \(.*isAccessibleForFree/,
  );
  assert.equal(
    gateOf(doc(`<main><h1>Story</h1><p>First lines</p><div class="tp-modal">Subscribe to read on</div></main>`)),
    "a paywall",
  );
  // Ordinary pages: a login box hidden in the header, a post about signing in without a password field, a paywall class
  // only inside a script, and free content marked as free.
  assert.equal(
    gateOf(
      doc(
        `<header><div class="modal" hidden><input type="password"></div></header><main><h1>Boiler repairs</h1></main>`,
        { title: "Boiler repairs in Leeds" },
      ),
    ),
    null,
  );
  assert.equal(gateOf(doc(`<main><h1>How to sign in to your account</h1></main>`, { title: "How to sign in" })), null);
  assert.equal(
    gateOf(
      doc(
        `<main><h1>Story</h1></main><script>const t = '<div class="paywall">'</script><script type="application/ld+json">{"isAccessibleForFree": true}</script>`,
      ),
    ),
    null,
  );
});

test("render steps are read, capped, and an unknown step is refused before Chrome starts", () => {
  assert.deepEqual(parseSteps("scroll; click #more .btn\nwait 500"), [
    { do: "scroll" },
    { do: "click", selector: "#more .btn" },
    { do: "wait", ms: 500 },
  ]);
  assert.deepEqual(parseSteps("wait 99999"), [{ do: "wait", ms: 10000 }], "10 s at most per wait");
  assert.deepEqual(parseSteps(""), []);
  assert.throws(
    () => parseSteps("type secret"),
    /“type secret”: use scroll, click <CSS selector> or wait <milliseconds>/,
    "never types into a page",
  );
  assert.throws(() => parseSteps("click"), /“click”/);
});

test("ads' share of a phone page counts overlapping ads once and only inside the main part", () => {
  assert.equal(
    adShare(
      [
        [100, 400],
        [300, 500],
        [900, 1000],
      ],
      [0, 2000],
    ),
    0.25,
    "100-500 and 900-1000 of 2000 px",
  );
  assert.equal(
    adShare(
      [
        [0, 200],
        [1900, 2300],
      ],
      [100, 2100],
    ),
    0.15,
    "the header and footer parts are left out",
  );
  assert.equal(adShare([], [0, 2000]), null, "no ad seen: nothing to say");
  assert.equal(adShare([[0, 100]], [0, 0]), null);
});

test("a page gets most of its text from JavaScript only past both of our own lines", () => {
  assert.equal(addsText(100, 700), true);
  assert.equal(addsText(100, 199), false, "under twice the HTML's words");
  assert.equal(addsText(100, 250), false, "under 200 words added: a consent banner or a widget");
  assert.equal(addsText(null, 900), false, "no HTML count to compare with");
});

test("the phone menu verdict", () => {
  assert.equal(menuVerdict({ hidden: 1 }), "none-needed", "fewer than 3 hidden menu links");
  assert.equal(menuVerdict({ hidden: 6, toggle: null }), "no-button");
  assert.equal(menuVerdict({ hidden: 6, toggle: "Menu", covered: true }), "covered");
  assert.equal(menuVerdict({ hidden: 6, toggle: "Menu", revealed: 6 }), "opens");
  assert.equal(menuVerdict({ hidden: 6, toggle: "Menu", revealed: 2 }), "closed");
  assert.deepEqual(MORE_CHECKS["mobile-menu-closed"].slice(0, 2), ["REND-11", "low"]);
  assert.deepEqual(MORE_CHECKS["mobile-ad-density"].slice(0, 2), ["REND-11", "medium"]);
  assert.deepEqual(MORE_CHECKS["render-adds-text"].slice(0, 2), ["REND-01", "medium"]);
});

test("browser errors are read from DevTools events: exceptions, console.error and failed loads", () => {
  assert.equal(
    errorOf("Runtime.exceptionThrown", {
      exceptionDetails: {
        text: "Uncaught",
        url: "https://x.example/app.js?v=3",
        lineNumber: 11,
        exception: { description: "TypeError: a is undefined\n    at f (app.js:12:3)" },
      },
    }),
    "TypeError: a is undefined (app.js:12)",
  );
  assert.equal(
    errorOf("Runtime.exceptionThrown", {
      exceptionDetails: { text: "Uncaught", exception: { type: "string", value: "boom" } },
    }),
    "Uncaught boom",
  );
  assert.equal(
    errorOf("Runtime.consoleAPICalled", {
      type: "error",
      args: [
        { type: "string", value: "Failed:" },
        { type: "object", description: "Error: no key" },
      ],
    }),
    "console.error: Failed: Error: no key",
  );
  assert.equal(errorOf("Runtime.consoleAPICalled", { type: "log", args: [{ value: "hi" }] }), null);
  assert.equal(
    errorOf("Log.entryAdded", {
      entry: {
        level: "error",
        source: "network",
        text: "Failed to load resource: the server responded with a status of 404 (Not Found)",
        url: "https://x.example/img/a.png",
      },
    }),
    "Failed to load resource: the server responded with a status of 404 (Not Found) (a.png)",
  );
  assert.equal(
    errorOf("Log.entryAdded", {
      entry: { level: "error", text: "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT", url: "http://10.0.0.1/x" },
    }),
    null,
    "a request the audit itself blocked isn't the page's error",
  );
  assert.equal(
    errorOf("Log.entryAdded", {
      entry: {
        level: "error",
        text: "Failed to load resource: the server responded with a status of 404 (Not Found)",
        url: "https://x.example/favicon.ico",
      },
    }),
    null,
    "the browser asks for /favicon.ico on its own",
  );
  assert.equal(errorOf("Log.entryAdded", { entry: { level: "warning", text: "x" } }), null);
});

// ---------- the report ----------
const report = async edit => {
  const dir = tmp(),
    data = JSON.parse(readFileSync(join(SCRIPTS, "..", "examples", "sample-audit.json"), "utf8"));
  edit(data);
  writeFileSync(join(dir, "a.json"), JSON.stringify(data));
  await node([join(SCRIPTS, "render-report.mjs"), join(dir, "a.json"), "--out", join(dir, "r.html")]);
  return { html: readFileSync(join(dir, "r.html"), "utf8"), md: readFileSync(join(dir, "r.md"), "utf8") };
};
const EVIL = "<img src=x onerror=alert(1)>";

test("the report shows what the browser saw on the render sample and the chosen page, escaped, and nothing without it", async () => {
  const { html, md } = await report(d => {
    d.renderSample = [
      {
        url: "https://www.acme.com/",
        h1: { desktop: true, phone: true },
        cta: { desktop: "Get a quote", phone: "Get a quote" },
        words: { html: 400, rendered: 420 },
        errors: [],
        menu: "opens",
        ads: null,
      },
      {
        url: "https://www.acme.com/blog/",
        h1: { desktop: true, phone: false },
        cta: { desktop: null, phone: null },
        words: { html: 50, rendered: 900 },
        errors: [`TypeError: ${EVIL} (app.js:3)`, "console.error: boom"],
        hidden: {
          words: 230,
          by: { "display:none": 200, "screen-reader only": 30 },
          examples: [{ how: "display:none", words: 200, text: `keyword ${EVIL}` }],
        },
        jumpLinks: { broken: [`faq${EVIL}`], deepLink: "scrolled-away", target: "pricing" },
        menu: "no-button",
        ads: 0.42,
      },
      { url: "https://www.acme.com/account/", gate: "a login screen", errors: [] },
    ];
    d.renderedPage = {
      url: `https://www.acme.com/feed/?q=${EVIL}`,
      steps: "scroll; click #more",
      words: { html: 50, rendered: 640 },
      changes: [{ field: "link-count", raw: 3, rendered: 40 }],
      errors: [],
      gate: null,
    };
  });
  const det = html.match(/<details class="how render">[\s\S]*?<\/details>/)?.[0];
  assert.ok(det, "a collapsed section on the Site & content tab");
  assert.match(det, /<summary>What the browser saw<\/summary>/);
  assert.match(
    det,
    /On a phone, the H1 is on the first screen on 1 of 2 pages and a button on 1 of 2; on desktop, 2 of 2 and 1 of 2/,
  );
  assert.match(det, /<code>\/blog\/<\/code>/);
  assert.match(det, /2 browser errors, first: TypeError: &lt;img src=x onerror=alert\(1\)&gt; \(app\.js:3\)/);
  assert.match(det, /230 hidden words \(display:none 200, screen-reader only 30\), most in “keyword &lt;img/);
  assert.match(det, /a link to #faq&lt;img src=x onerror=alert\(1\)&gt;, which isn&#39;t on the page/);
  assert.match(det, /opened at #pricing, the page scrolled away from it/);
  assert.match(det, /no menu button found on a phone/);
  assert.match(det, /showed a login screen, so it wasn&#39;t compared/);
  assert.match(det, /You chose <code>\/feed\/\?q=%3Cimg/, "the address is percent-encoded");
  assert.match(det, /50 words in the HTML, 640 after JavaScript and the steps \(scroll; click #more\)/);
  assert.match(det, /link-count: 3 → 40/);
  assert.ok(!det.includes(EVIL), "crawled text is escaped");
  assert.match(md, /^### What the browser saw$/m);
  assert.match(
    md,
    /- `\/blog\/` .*2 browser errors, first: TypeError: \\<img src=x onerror=alert\(1\)\\> \(app\.js:3\)/,
  );
  assert.ok(!md.includes(EVIL));

  const none = await report(() => {});
  assert.ok(!none.html.includes('class="how render"'));
  assert.doesNotMatch(none.md, /What the browser saw/);
});

test("--render-page and --clean-screenshots without --outside: nothing renders and the notes say why", async () => {
  const dir = tmp(),
    out = join(tmp(), "crawl.json");
  writeFileSync(join(dir, "index.html"), doc(`<main><h1>Home</h1><p>${words(60)}</p></main>`));
  const site = await serve(dir);
  try {
    await node([
      join(SCRIPTS, "seo-crawl.mjs"),
      "--url",
      site.url,
      "--out",
      out,
      "--render-page",
      `${site.url}/`,
      "--render-steps",
      "scroll",
      "--clean-screenshots",
    ]);
  } finally {
    await site.close();
  }
  const r = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(
    r.notes.some(n => /^--render-page runs only with outside checks on \(--outside\)/.test(n)),
    r.notes.join("\n"),
  );
  assert.match(r.notChecked.find(n => n.rule === "REND-11")?.reason || "", /^Outside checks are off/);
  assert.equal(r.renderSample, undefined);
  assert.equal(r.renderedPage, undefined);
});
