// @ts-check
// Loads sample pages at desktop and phone size in an installed Chrome or Edge for the phone, render and lab speed
// checks, with screenshots. The pages' own scripts, analytics included, run.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, containerArgs } from "../lib/cdp.mjs";
import { redact } from "../lib/redact.mjs";
import { addressCheck, guardTab, startGuard } from "./render.mjs";

export const CHECKS = {
  "mobile-content-missing": [
    "REND-07",
    "high",
    n => `${n} page(s) show less content on a phone than on desktop`,
    "Google indexes the mobile version of every page. Text or a heading that only desktop visitors get doesn't count for ranking.",
    "Serve the same main text and H1 at every screen size. Restyle it for small screens (stack it, or collapse it into sections that stay in the HTML) instead of leaving it out of the phone version.",
  ],
  "mobile-overflow": [
    "REND-09",
    "medium",
    n => `${n} page(s) scroll sideways on a phone`,
    "Content wider than the screen makes visitors scroll sideways or zoom out, and reads as a page that isn't built for phones.",
    "Find the wide element (a fixed-width table, image, iframe or long unbroken text) and let it shrink: `max-width: 100%`, `overflow-x: auto` on a wrapper for tables, `overflow-wrap: anywhere` for long words.",
  ],
  "mobile-small-text": [
    "REND-09",
    "low",
    n => `${n} page(s) use body text under 12 px on a phone`,
    "Text this small is hard to read on a phone, so visitors zoom in or leave.",
    "Set body text to at least 16 px on small screens (1rem from the browser's default).",
  ],
  "mobile-interstitial": [
    "PERF-07",
    "high",
    n => `${n} page(s) cover most of the phone screen with a popup on arrival`,
    "Visitors from search see the popup instead of the page they came for. Google's page-experience guidance calls this an intrusive interstitial, and many visitors leave instead of closing it.",
    "Use a small banner instead, or show the popup later (after the visitor interacts). Required age or legal notices should cover only part of the screen.",
  ],
  "input-zoom": [
    "REND-09",
    "low",
    n => `${n} page(s) have form fields with text under 16 px, which iPhones zoom into`,
    "When a visitor taps a field whose text is smaller than 16 px, Safari on iPhone zooms the page in to make it readable (WebKit's rule: 16 px divided by the field's text size), so part of the form moves off the screen while they type.",
    "Set inputs, selects and text areas to `font-size: 16px` (or `1rem`), at least on small screens. Don't stop the zoom with `maximum-scale=1` or `user-scalable=no` in the viewport tag: on Android that also stops visitors zooming in to read.",
  ],
  "tap-targets-small": [
    "REND-09",
    "low",
    n => `${n} page(s) have links or buttons too small and too close together to tap on a phone`,
    "A finger covers more than a small link, so visitors tap the wrong one and have to go back. The accessibility standard (WCAG 2.2, success criterion 2.5.8) asks for at least 24×24 px, or enough space around smaller ones.",
    "Give links and buttons padding so each is at least 24×24 px, or space small ones out: icons in a row need 24 px from the centre of one to the next. Links inside a sentence are fine as they are.",
  ],
  "bfcache-blocked": [
    "PERF-10",
    "medium",
    n => `${n} page(s) load again instead of showing instantly when a visitor goes Back (Chrome's own test)`,
    "Chrome opened the page, went on to another page of the site and pressed Back, and had to load the page again instead of restoring it from memory (the back/forward cache). One in five page views on phones comes from Back or Forward, and a restored page counts as an instant load in Core Web Vitals.",
    "Remove what Chrome names for each page. The usual causes are an `unload` handler (use `pagehide`), `Cache-Control: no-store` on an ordinary page (use `no-cache`), and connections left open (close WebSockets on `pagehide`). Chrome DevTools > Application > Back/forward cache runs the same test.",
  ],
};

const DESKTOP = { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
const SLOW_4G = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
}; // Lighthouse's mobile profile
const sleep = ms => new Promise(ok => setTimeout(ok, ms));

// Resolves at the load event, or after 15 s for a page that never finishes loading.
const LOADED = `new Promise(ok => { if (document.readyState === "complete") ok(); addEventListener("load", () => ok()); setTimeout(ok, 15000); })`;
// Two animation frames: the page has laid itself out and drawn at a new size; 250 ms at most (a page with no frames).
const DRAWN = `new Promise(ok => { requestAnimationFrame(() => requestAnimationFrame(() => ok())); setTimeout(ok, 250); })`;
// Local cap: each back/forward cache test costs a page load and up to 10 s, so only the first few pages get one.
const BF_PAGES = 3;
// Words come from the DOM, so a collapsed accordion or closed <details> still counts, as it does for Google. The popup
// is the biggest fixed layer on top covering half the screen; consent tools are kept apart.
const MEASURE = `(() => {
  const shown = e => e.checkVisibility({ opacityProperty: true, visibilityProperty: true }), css = e => getComputedStyle(e);
  const main = document.querySelector("main") || document.body, h1 = document.querySelector("h1");
  const vw = innerWidth, vh = innerHeight;
  const name = e => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\\s+/).join(".") : "");
  const cmp = e => /onetrust|cookiebot|cybot|didomi|usercentrics|quantcast|qc-cmp|\\bcmp\\b|consent|cookie/i.test(e.id + " " + (typeof e.className === "string" ? e.className : ""));
  const popup = { cover: 0, by: "" }, consent = { cover: 0, by: "" };
  for (const e of document.body.querySelectorAll("*")) {
    const s = css(e);
    if (s.position !== "fixed" || parseInt(s.zIndex) < 0 || !shown(e)) continue;
    if ((main !== document.body && e.contains(main)) || (h1 && e.contains(h1))) continue; // a layer holding the page is an app shell
    const r = e.getBoundingClientRect(), x0 = Math.max(r.left, 0), x1 = Math.min(r.right, vw), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, vh);
    const share = Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / (vw * vh);
    if (share < 0.5 || !e.contains(document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2))) continue; // a layer behind the content isn't a popup
    let isCmp = [...e.querySelectorAll("[id], [class]")].some(cmp);
    for (let a = e; a && a !== document.body && !isCmp; a = a.parentElement) isCmp = cmp(a);
    const slot = isCmp ? consent : popup;
    if (share > slot.cover) { slot.cover = share; slot.by = name(e); }
  }
  let text = "";
  for (const w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT); w.nextNode();) if (!w.currentNode.parentElement.closest("script, style, noscript, template")) text += " " + w.currentNode.data;
  const sizes = {};
  for (const e of main.querySelectorAll("p, li, td")) { const n = e.textContent.trim().length; if (n && shown(e)) sizes[css(e).fontSize] = (sizes[css(e).fontSize] || 0) + n; }
  return {
    words: text.split(/\\s+/).filter(Boolean).length,
    h1: [...document.querySelectorAll("h1")].filter(shown).map(h => h.innerText.replace(/\\s+/g, " ").trim().toLowerCase()).filter(Boolean),
    viewport: /width\\s*=\\s*device-width/i.test(document.querySelector('meta[name="viewport" i]')?.content || ""),
    scrollWidth: document.documentElement.scrollWidth,
    clipped: [document.documentElement, document.body].some(e => /^(hidden|clip)$/.test(css(e).overflowX)),
    fontSize: parseFloat(Object.entries(sizes).sort((a, b) => b[1] - a[1])[0]?.[0] || css(main).fontSize),
    popup, consent,
  };
})()`;
// A target under 24×24 CSS px fails unless a 24 px circle on its centre touches no other target and no other small
// one's circle. Links in a sentence, visually hidden ones (skip links) and ones off screen sideways (closed drawers)
// are exempt. Whole-box geometry: a clipped or covered target still counts. Lighthouse 12 uses the same rule.
// https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
const TAPS = `(() => {
  const SEL = 'a[href], button, [role="button"], input[type="button" i], input[type="submit" i], input[type="reset" i], input[type="image" i]';
  const css = e => getComputedStyle(e), letters = s => (s.match(/[\\p{L}\\p{N}]/gu) || []).length;
  const inSentence = e => {
    if (css(e).display !== "inline") return false;
    let b = e.parentElement;
    while (b && css(b).display.startsWith("inline")) b = b.parentElement;
    return !!b && letters(b.textContent) > letters(e.textContent);
  };
  const all = [...document.querySelectorAll(SEL)].filter(e => !e.parentElement?.closest(SEL) && e.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    .map(e => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width >= 2 && r.height >= 2 && r.right > 0 && r.left < innerWidth);
  const small = all.filter(x => (x.r.width < 24 || x.r.height < 24) && !inSentence(x.e));
  for (const x of small) x.c = [(x.r.left + x.r.right) / 2, (x.r.top + x.r.bottom) / 2];
  const toBox = ([px, py], r) => Math.hypot(Math.max(r.left - px, 0, px - r.right), Math.max(r.top - py, 0, py - r.bottom));
  const bad = small.filter(x => all.some(y => y !== x && toBox(x.c, y.r) < 12) || small.some(y => y !== x && Math.hypot(x.c[0] - y.c[0], x.c[1] - y.c[1]) < 24));
  const name = e => (e.getAttribute("aria-label") || e.innerText || e.title || e.querySelector("img")?.alt || e.tagName.toLowerCase()).replace(/\\s+/g, " ").trim().slice(0, 40);
  return { count: bad.length, examples: bad.slice(0, 3).map(x => \`“\${name(x.e)}” \${Math.round(x.r.width)}×\${Math.round(x.r.height)} px\`) };
})()`;
// iOS Safari zooms a focused field to 16 ÷ its text size, capped at maximum-scale, skips a change under 10%, and
// doesn't zoom under user-scalable=no. Fields off screen sideways, out of the tab order or inside aria-hidden are
// skipped: a sign-up form's spam trap is all three (Mailchimp's is).
// https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/ios/WKWebViewIOS.mm
const FIELDS = `(() => {
  const vp = (document.querySelector('meta[name="viewport" i]')?.content || "").toLowerCase();
  const max = /user-scalable\\s*=\\s*(no|0)\\b/.test(vp) ? 1 : parseFloat(vp.match(/maximum-scale\\s*=\\s*([\\d.]+)/)?.[1]) || Infinity;
  const NO_KEYS = /^(hidden|checkbox|radio|button|submit|reset|image|file|range|color)$/i;
  const small = [...document.querySelectorAll("input, select, textarea")]
    .filter(e => !(e.tagName === "INPUT" && NO_KEYS.test(e.type)) && !e.disabled && !e.readOnly && e.tabIndex >= 0 && !e.closest('[aria-hidden="true"]') && e.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    .map(e => ({ e, r: e.getBoundingClientRect(), size: parseFloat(getComputedStyle(e).fontSize) }))
    .filter(({ r, size }) => r.width >= 2 && r.height >= 2 && r.right > 0 && r.left < innerWidth && size > 0 && Math.min(16 / size, max) >= 1.1);
  const name = e => (e.labels?.[0]?.innerText || e.getAttribute("aria-label") || e.placeholder || e.name || e.type).replace(/\\s+/g, " ").trim().slice(0, 40);
  return { count: small.length, examples: small.slice(0, 3).map(x => \`“\${name(x.e)}” \${Math.round(x.size * 10) / 10} px\`) };
})()`;
// Installed before the page's scripts. Blocking time is each long task's part over 50 ms, as in Lighthouse's TBT.
// Layout shifts without recent input are kept as [time, score] for clsOf.
const OBSERVE = `window.__seoLab = { lcp: 0, shifts: [], tbt: 0 }; try {
  new PerformanceObserver(l => { for (const e of l.getEntries()) __seoLab.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) __seoLab.shifts.push([e.startTime, e.value]); }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) __seoLab.tbt += Math.max(0, e.duration - 50); }).observe({ type: "longtask", buffered: true });
} catch {}`;
/** The largest session window (shifts under 1 s apart, 5 s at most), not the sum of every shift. Runs in the page too.
 * https://web.dev/articles/cls
 * @param {[number, number][]} shifts [time in ms, score], in time order */
export function clsOf(shifts) {
  let best = 0,
    sum = 0,
    first = 0,
    last = -Infinity;
  for (const [t, v] of shifts) {
    if (t - last < 1000 && t - first < 5000) sum += v;
    else {
      sum = v;
      first = t;
    }
    last = t;
    best = Math.max(best, sum);
  }
  return best;
}

// A phone H1 with at least half the desktop H1's words is the same heading (a desktop-only word or two is fine).
const seg = new Intl.Segmenter(undefined, { granularity: "word" });
const wordsOf = s => [...seg.segment(s)].filter(w => w.isWordLike).map(w => w.segment);
const sameHeading = (desktop, phone) => {
  const have = new Set(wordsOf(phone)),
    want = wordsOf(desktop);
  return want.filter(w => have.has(w)).length >= want.length / 2;
};

async function evaluate(page, expression) {
  const r = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] || r.exceptionDetails.text);
  return r.result.value;
}

// A fresh tab per load, so emulation and throttling never leak into the next. After the load event the page settles
// until Chrome's networkIdle (500 ms of quiet) or settleMs, whichever comes first.
async function visit(chrome, url, { device, userAgent, lab = false, settleMs, deadline, checkAddress }, read) {
  const page = await chrome.newPage();
  page.on("Page.javascriptDialogOpening", () =>
    page.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {}),
  ); // alert() would stall the page
  // Chrome sends the events again for the blank tab when they're switched on, so only this load's (its loaderId) count.
  const idle = new Set();
  let quiet = () => {};
  page.on("Page.lifecycleEvent", p => {
    if (p.name === "networkIdle") {
      idle.add(p.loaderId);
      quiet();
    }
  });
  const load = async () => {
    await guardTab(page, checkAddress);
    await page.send("Page.enable");
    await page.send("Page.setLifecycleEventsEnabled", { enabled: true });
    await page.send("Page.bringToFront"); // a background tab gets no animation frames
    await page.send("Emulation.setDeviceMetricsOverride", device);
    await page.send("Emulation.setUserAgentOverride", { userAgent });
    if (device.mobile) await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    if (lab) {
      await page.send("Network.enable");
      await page.send("Network.setCacheDisabled", { cacheDisabled: true }); // the earlier loads filled the shared cache
      await page.send("Network.emulateNetworkConditions", SLOW_4G);
      await page.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await page.send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVE });
    }
    const nav = await page.send("Page.navigate", { url });
    if (nav.errorText) throw new Error(nav.errorText);
    await evaluate(page, LOADED).catch(() => sleep(1000)); // a script redirect replaces the document mid-wait
    await new Promise(ok => {
      const t = setTimeout(ok, settleMs);
      quiet = () => {
        if (idle.has(nav.loaderId)) {
          clearTimeout(t);
          ok(undefined);
        }
      };
      quiet();
    });
    return await read(page);
  };
  let timer;
  const late = new Promise((_, fail) => {
    timer = setTimeout(
      fail,
      Math.max(0, deadline - Date.now()),
      new Error("the page was still busy when its time ran out"),
    );
  });
  try {
    return await Promise.race([load(), late]);
  } finally {
    clearTimeout(timer);
    await page.close().catch(() => {});
  }
}

// Chrome's own back/forward cache test, as DevTools runs it: from the loaded page go on to `next`, then press Back.
// Resolves to Chrome's reasons for not restoring the page ([] when it did), or null when Chrome didn't say in time.
async function goBack(page, next) {
  const told = new Promise(ok => {
    page.on("Page.backForwardCacheNotUsed", p => ok(p.notRestoredExplanations || []));
    page.on("Page.frameNavigated", p => {
      if (p.type === "BackForwardCacheRestore" && !p.frame.parentId) ok([]);
    });
    setTimeout(ok, 10000, null).unref();
  });
  const nav = await page.send("Page.navigate", { url: next });
  if (nav.errorText) throw new Error(nav.errorText);
  await evaluate(page, LOADED).catch(() => sleep(1000));
  const { currentIndex, entries } = await page.send("Page.getNavigationHistory");
  await page.send("Page.navigateToHistoryEntry", { entryId: entries[currentIndex - 1].id });
  return told;
}
// Plain words for the common reasons, Chrome's names for the rest; "Circumstantial" ones aren't the page's fault.
/** @type {[RegExp, string][]} */
const REASONS = [
  [/^UnloadHandler.*SubFrame/, "an unload handler in an embedded frame"],
  [/^UnloadHandler/, "an unload handler"],
  [/NoStore.*Cookie/i, "Cache-Control: no-store on a page whose cookies changed"],
  [/NoStore/i, "Cache-Control: no-store"],
  [/^WebSocket/, "an open WebSocket connection"],
];
const blockersOf = explanations => [
  ...new Set(
    explanations
      .filter(e => e.type !== "Circumstantial")
      .map(e => REASONS.find(([re]) => re.test(e.reason))?.[1] ?? e.reason),
  ),
];

const slugOf = (url, used) => {
  const base =
    new URL(url).pathname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "home";
  let slug = base;
  for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
  used.add(slug);
  return slug;
};

/** @typedef {(id: string, url: string, evidence: string) => void} AddFinding */
/** pageBudgetMs covers all three of a page's loads, so a page that hangs (a busy loop, a dialog) can't stall the run.
 * @param {string} browser
 * @param {string[]} urls
 * @param {{ add?: AddFinding, screenshotDir?: string, pageBudgetMs?: number }} [options] */
export async function checkVisual(browser, urls, { add, screenshotDir, pageBudgetMs = 50000 } = {}) {
  const notes = [],
    lab = [],
    used = new Set(),
    smallText = [];
  const why = e => redact(String(e.message).split("\n")[0]).slice(0, 120);
  const checkAddress = urls.length ? await addressCheck(urls[0]) : null; // the sample is the site's own pages
  let checked = 0,
    bfTested = 0;
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
  // The render guard's proxy also covers what the tab can't see: other-site frames and WebSockets.
  const guard = urls.length ? await startGuard(urls[0]) : null;
  const chrome = await launchChrome(browser, { args: guard?.args || [] }).catch(async e => {
    await guard?.close();
    throw e;
  }); // a browser that won't start leaves no guard open
  try {
    const { userAgent: ua } = await chrome.send("Browser.getVersion");
    const desktopUa = ua.replace("HeadlessChrome/", "Chrome/");
    const phoneUa = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ua.match(/Chrome\/(\d+)/)?.[1] || "130"}.0.0.0 Mobile Safari/537.36`;
    const list = urls.slice(0, 10);
    for (const [i, url] of list.entries()) {
      const slug = slugOf(url, used),
        deadline = Date.now() + pageBudgetMs;
      const shoot = (page, name) =>
        screenshotDir &&
        page
          .send("Page.captureScreenshot", { format: "png" })
          .then(s => writeFileSync(join(screenshotDir, `${slug}-${name}.png`), Buffer.from(s.data, "base64")));
      try {
        // One load at a time, so the lab load has the CPU to itself. Popups get a second after load to appear.
        const d = await visit(
          chrome,
          url,
          { device: DESKTOP, userAgent: desktopUa, settleMs: 200, deadline, checkAddress },
          async p => {
            await shoot(p, "desktop");
            return evaluate(p, MEASURE);
          },
        );
        const m = await visit(
          chrome,
          url,
          { device: PHONE, userAgent: phoneUa, settleMs: 1000, deadline, checkAddress },
          async p => {
            await shoot(p, "mobile");
            return {
              ...(await evaluate(p, MEASURE)),
              taps: await evaluate(p, TAPS),
              fields: await evaluate(p, FIELDS),
            };
          },
        );
        checked++;
        // Word counts below 30 are too small to compare. A real diff of the text would also catch swapped content.
        const fewer = d.words >= 30 && m.words < 0.7 * d.words,
          lostH1 = d.h1[0] && !m.h1.some(h => sameHeading(d.h1[0], h));
        if (fewer || lostH1)
          add(
            "mobile-content-missing",
            url,
            [
              fewer && `${m.words} words on a phone vs ${d.words} on desktop`,
              lostH1 && `the H1 “${d.h1[0]}” isn't shown on a phone`,
            ]
              .filter(Boolean)
              .join("; "),
          );
        // Without a mobile viewport the page is laid out 980 px wide and zoomed out; the crawler's doc-basics reports that.
        // Overflow that html or body clips can't be scrolled to.
        if (m.viewport && !m.clipped && m.scrollWidth > PHONE.width + 2)
          add("mobile-overflow", url, `${m.scrollWidth} px wide on a ${PHONE.width} px screen`);
        if (m.viewport && m.fontSize < 12) add("mobile-small-text", url, `main text ${m.fontSize} px`);
        else if (m.viewport && m.fontSize < 16)
          smallText.push(`${new URL(url).pathname} (${Math.round(m.fontSize * 10) / 10} px)`);
        if (m.viewport && m.taps.count)
          add(
            "tap-targets-small",
            url,
            `${m.taps.count} ${m.taps.count === 1 ? "link or button" : "links or buttons"} under 24×24 px with too little space around them, for example ${m.taps.examples.join(", ")}`,
          );
        if (m.viewport && m.fields.count)
          add(
            "input-zoom",
            url,
            `${m.fields.count} form field${m.fields.count === 1 ? "" : "s"} with text under 16 px, for example ${m.fields.examples.join(", ")}`,
          );
        if (m.popup.cover)
          add(
            "mobile-interstitial",
            url,
            `${m.popup.by} covers ${Math.round(m.popup.cover * 100)}% of the screen on arrival`,
          );
        // Consent and other legally required notices are exempt from Google's intrusive-interstitial guidance.
        // https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials
        if (m.consent.cover)
          notes.push(
            `On a phone, ${url} opens with a consent popup (${m.consent.by}) over ${Math.round(m.consent.cover * 100)}% of the screen. Legally required notices are exempt from Google's intrusive-interstitial guidance, so it isn't a finding; a bottom banner keeps the page readable.`,
          );
      } catch (e) {
        notes.push(`Couldn't load ${url} for the phone checks (${why(e)}).`);
        continue;
      }
      try {
        const v = await visit(
          chrome,
          url,
          { device: PHONE, userAgent: phoneUa, lab: true, settleMs: 500, deadline, checkAddress },
          p => evaluate(p, `({ ...__seoLab, cls: (${clsOf})(__seoLab.shifts), shifts: null })`),
        );
        lab.push({
          url,
          lcp: v.lcp ? Math.round(v.lcp) : null,
          cls: Math.round(v.cls * 1000) / 1000,
          tbt: Math.round(v.tbt),
        });
      } catch (e) {
        notes.push(`Couldn't measure lab speed for ${url} (${why(e)}).`);
      }
      if (list.length > 1 && i < BF_PAGES)
        try {
          // Back needs a page to come back from: the next one in the sample
          const reasons = await visit(
            chrome,
            url,
            { device: DESKTOP, userAgent: desktopUa, settleMs: 200, deadline, checkAddress },
            p => goBack(p, list[(i + 1) % list.length]),
          );
          if (reasons) {
            bfTested++;
            const blockers = blockersOf(reasons);
            if (blockers.length) add("bfcache-blocked", url, `Chrome names: ${blockers.join("; ")}`);
          } else notes.push(`Chrome didn't report the back/forward cache test on ${url} within 10 s.`);
        } catch (e) {
          notes.push(`Couldn't run the back/forward cache test on ${url} (${why(e)}).`);
        }
    }
  } finally {
    await chrome.close();
    await guard?.close();
  }
  if (checked)
    notes.push(
      `Loaded ${checked} sample page(s) at desktop (1366×768) and phone (390×844) size${screenshotDir ? ", with screenshots" : ""}${bfTested ? `, and ran Chrome's back/forward cache test on ${bfTested} of them` : ""}. Lab speed comes from one phone load with 4× CPU slowdown on slow 4G: indicative only, it won't match Lighthouse.`,
    );
  if (smallText.length)
    notes.push(
      `On a phone, the main text is under 16 px on ${smallText.length} page${smallText.length === 1 ? "" : "s"}: ${smallText.join(", ")}. Information only: 16 px is the browsers' default text size, and main text under 12 px is a finding (mobile-small-text).`,
    );
  if (checked && containerArgs().length)
    notes.push(
      "Chrome ran without its security sandbox (--no-sandbox), because this runs as root on Linux or inside a container, where the sandbox can't start. The sample pages' scripts ran with fewer protections than in a normal browser; to keep the sandbox, run the audit as an ordinary user outside a container.",
    );
  return { checked, lab, notes, bfTested }; // bfTested: the pages Chrome's back/forward test actually ran on
}

// ---------- more from the render sample ----------
// checkMore loads each sample page again at desktop and phone size, in its own browser, for the render checks. Every
// load goes through visit() and its guard. --render-page renders one chosen page after its steps, which only scroll,
// click and wait: nothing is ever typed into a page.
import { compareRendered, gateOf } from "./render.mjs";

export const MORE_CHECKS = {
  "render-adds-text": [
    "REND-01",
    "medium",
    n => `${n} page(s) get most of their text only after JavaScript runs`,
    "The HTML the server sends holds less than half of the words the page shows; JavaScript adds the rest. Crawlers that don't run JavaScript (most AI crawlers, and Google's first pass) see only the part in the HTML.",
    "Render the text on the server (server rendering or static generation) and keep client JavaScript for interactivity. If a widget adds it (reviews, related items), pick one that can output HTML on the server.",
  ],
  "mobile-menu-closed": [
    "REND-11",
    "low",
    n => `${n} page(s) have a phone menu button that doesn't open the menu`,
    "On a phone these pages hide their menu links behind a button, and when Chrome tapped the button the links still didn't show. Visitors on phones can't reach the rest of the site from the menu.",
    "Tap the button on a real phone. It needs a click handler that shows the menu (or use a `<details>` element), the menu must not open behind another layer, and `aria-expanded` should follow the menu's state.",
  ],
  "mobile-ad-density": [
    "REND-11",
    "medium",
    n => `${n} page(s) are more than 30% ads on a phone`,
    "Ads take more than 30% of the page's height on a phone, measured between the header and the footer. The Coalition for Better Ads lists mobile ad density over 30% among the ad experiences people find most annoying (betterads.org/mobile-ad-density-higher-than-30), and Google's page-experience questions ask whether a page avoids “an excessive amount of ads that distract from or interfere with the main content”.",
    "Show fewer ad slots on phones: drop some in-content units and sticky stacks, and keep ads under 30% of the height between the header and the footer.",
  ],
};

// Local lines: twice the HTML's words and at least 200 more, since a consent banner or small widget adds less.
export const addsText = (html, rendered) => html != null && rendered >= 2 * html && rendered - html >= 200;

// Mobile ad density as the Better Ads Standard measures it: ad heights, overlaps counted once, over the height between
// header and footer. https://www.betterads.org/mobile-ad-density-higher-than-30/
export function adShare(ads, [top, bottom]) {
  if (!ads.length || bottom - top < 1) return null;
  let sum = 0,
    end = -Infinity;
  for (const [a, b] of ads
    .map(([a, b]) => [Math.max(a, top), Math.min(b, bottom)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]))
    if (b > end) {
      sum += b - Math.max(a, end);
      end = b;
    }
  return Math.round((sum / (bottom - top)) * 100) / 100;
}

// Local lines: under 3 hidden links needs no button, and a menu opens when it shows at least half of them.
export function menuVerdict({ hidden = 0, toggle, covered, revealed = 0 }) {
  return hidden < 3
    ? "none-needed"
    : !toggle
      ? "no-button"
      : covered
        ? "covered"
        : revealed >= hidden / 2
          ? "opens"
          : "closed";
}

// --render-steps: "scroll; click <CSS selector>; wait <ms>", by semicolons or lines, 20 steps and 10 s a wait at most.
export function parseSteps(text = "") {
  return String(text)
    .split(/[;\n]/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map(s => {
      const [, verb, rest] = s.match(/^(\w+)\s*(.*)$/) || [];
      if (verb === "scroll" && !rest) return { do: "scroll" };
      if (verb === "click" && rest) return { do: "click", selector: rest };
      if (verb === "wait" && /^\d+$/.test(rest)) return { do: "wait", ms: Math.min(Number(rest), 10000) };
      throw new Error(`can't read the step “${s}”: use scroll, click <CSS selector> or wait <milliseconds>`);
    });
}

// A request the guard blocked (ERR_BLOCKED_BY_CLIENT) isn't the page's error, nor is the /favicon.ico the browser asks
// for on its own (META-10 covers favicons).
export function errorOf(method, p) {
  const line = s =>
    String(s ?? "")
      .split("\n")[0]
      .trim()
      .slice(0, 200);
  const at = (url, n) =>
    url ? ` (${url.split(/[?#]/)[0].split("/").pop() || url}${n != null ? `:${n + 1}` : ""})` : "";
  if (method === "Runtime.exceptionThrown") {
    const d = p.exceptionDetails || {},
      x = d.exception || {};
    return line(x.description || (x.value !== undefined ? `${d.text} ${x.value}` : d.text)) + at(d.url, d.lineNumber);
  }
  if (method === "Runtime.consoleAPICalled")
    return p.type === "error"
      ? line(`console.error: ${(p.args || []).map(a => a.value ?? a.description ?? "").join(" ")}`)
      : null;
  if (method === "Log.entryAdded") {
    const e = p.entry || {};
    return e.level === "error" && !/ERR_BLOCKED_BY_CLIENT/.test(e.text) && !/\/favicon\.ico$/.test(e.url || "")
      ? line(e.text) + at(e.url)
      : null;
  }
  return null;
}

// For the type checker only, which has Node's types and no DOM. The functions below run in the page as source text,
// as `(${fn})(args)`, so each is self-contained and uses the page's own globals.
const {
  document,
  getComputedStyle,
  NodeFilter,
  DOMParser,
  location,
  innerWidth,
  innerHeight,
  scrollY,
  scrollBy,
  scrollTo,
} = /** @type {any} */ ({});
// Words are counted as the crawler counts them, without consent and chat widgets. Hidden text leaves out accordions,
// tabs, menus and dialogs, which Google's spam policies don't count as hidden. raw is HTML to count the same way.
// https://developers.google.com/search/docs/essentials/spam-policies#hidden-text-and-links
function pageMore(withHtml, raw) {
  const css = e => getComputedStyle(e),
    shown = e => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const cls = e => `${e.id} ${e.getAttribute("class") || ""}`;
  const memo = f => {
    const m = new Map(),
      g = e => {
        if (!m.has(e)) m.set(e, f(e, g));
        return m.get(e);
      };
    return g;
  };
  const JUNK =
    /onetrust|cookiebot|cybot|didomi|usercentrics|quantcast|qc-cmp|\bcmp\b|consent|cookie|intercom|drift|crisp|zendesk|hubspot-messages|tawk|livechat|tidio|freshchat|olark|chat/i;
  const junk = memo((e, self) => !!e && e.tagName !== "BODY" && (JUNK.test(cls(e)) || self(e.parentElement)));
  const SEG = new Intl.Segmenter(undefined, { granularity: "word" }),
    NOSPACE = /[\p{scx=Han}\p{scx=Hira}\p{scx=Kana}\p{scx=Thai}\p{scx=Laoo}\p{scx=Khmr}\p{scx=Mymr}]/u;
  const count = t =>
    NOSPACE.test(t)
      ? [...SEG.segment(t)].filter(s => s.isWordLike).length
      : t.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  const textsOf = d => {
    const out = [];
    if (d.body)
      for (const w = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT); w.nextNode();) {
        const p = w.currentNode.parentElement;
        if (p && w.currentNode.data.trim() && !p.closest("script, style, noscript, template, svg, title"))
          out.push([w.currentNode.data, p]);
      }
    return out;
  };
  const wordsIn = d =>
    count(
      textsOf(d)
        .filter(([, p]) => !junk(p))
        .map(([t]) => t)
        .join(" "),
    );
  const vw = innerWidth,
    vh = innerHeight,
    texts = textsOf(document);
  const box = e => e.getBoundingClientRect(),
    across = e => {
      const r = box(e);
      return shown(e) && r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw;
    };
  const first = e => across(e) && box(e).top < vh && box(e).bottom > 0;
  const label = e => (e.innerText || e.value || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
  const h1 = [...document.querySelectorAll("h1")].find(shown);
  const cta = [
    ...document.querySelectorAll('button, [role="button"], input[type="submit" i], input[type="button" i], a[href]'),
  ].find(e => {
    if (
      e.closest('nav, [role="navigation"], footer, form[role="search"]') ||
      e.matches("[aria-expanded], [aria-controls], [aria-haspopup]") ||
      junk(e) ||
      !first(e)
    )
      return false;
    const t = label(e);
    if (t.length < 2 || t.length > 40 || !/\p{L}/u.test(t)) return false;
    return (
      !e.matches("a") ||
      /\b(btn|button|cta)\b/i.test(cls(e)) ||
      !/^(rgba\(0, 0, 0, 0\)|transparent)$/.test(css(e).backgroundColor)
    );
  });
  const here = location.href.split("#")[0],
    frag = a => {
      try {
        return decodeURIComponent(a.hash.slice(1));
      } catch {
        return a.hash.slice(1);
      }
    };
  const broken = [
    ...new Set(
      [...document.querySelectorAll('a[href*="#"]')]
        .filter(
          a =>
            a.href.split("#")[0] === here &&
            a.hash.length > 1 &&
            !/^#([!\/:]|top$)/i.test(a.hash) &&
            !a.matches('[role="button"], [role="tab"], [aria-controls], [data-toggle], [data-bs-toggle]'),
        )
        .map(frag)
        .filter(id => !document.getElementById(id) && !document.getElementsByName(id).length),
    ),
  ].slice(0, 10);
  const target =
    [...document.querySelectorAll("h2[id], h3[id], section[id]")].find(
      e => shown(e) && box(e).top + scrollY >= 1.5 * vh,
    )?.id || null;
  const AD =
    'ins.adsbygoogle, [id^="div-gpt-ad"], [id^="google_ads_iframe"], iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"], iframe[src*="amazon-adsystem.com"], iframe[src*="adnxs.com"], [data-ad-slot], [data-ad-unit-path], amp-ad, .advertisement, .ad-slot, .ad-unit, .ad-container';
  const ads = [...document.querySelectorAll(AD)]
    .filter(shown)
    .map(box)
    .filter(r => r.height >= 20 && r.width >= 50)
    .map(r => [r.top + scrollY, r.bottom + scrollY]);
  const outside = e => !e.closest("main, article") && shown(e);
  const hdr = [...document.querySelectorAll('header, [role="banner"]')].find(outside),
    ftr = [...document.querySelectorAll('footer, [role="contentinfo"]')].filter(outside).pop();
  const controlled = new Set(
    [...document.querySelectorAll("[aria-controls]")]
      .flatMap(e => e.getAttribute("aria-controls").split(/\s+/))
      .filter(Boolean),
  );
  const SKIP =
    'details, dialog, nav, [role="navigation"], [role="menu"], [role="menubar"], [role="tabpanel"], [role="dialog"], [role="tooltip"], [aria-modal="true"], [hidden="until-found"], select, datalist, button, [role="button"], label';
  const TOGGLED =
    /accordion|collaps|tab-?pane|tabpanel|tab-content|dropdown|sub-?menu|mega-?menu|modal|popup|popover|tooltip|offcanvas|drawer|slide|carousel|swiper|faq|menu/i;
  const SR =
    /\b(sr-only|visually-?hidden|screen-reader-text|screen-reader-only|a11y-hidden|assistive-text|element-invisible|u-hidden-visually)\b/i;
  const hideOf = memo((e, self) => {
    if (!e || e.tagName === "BODY") return null;
    const up = self(e.parentElement);
    if (up === "skip" || e.matches(SKIP) || TOGGLED.test(cls(e)) || controlled.has(e.id) || junk(e)) return "skip";
    if (up) return up;
    const s = css(e);
    const how = e.hidden
      ? "hidden attribute"
      : s.display === "none"
        ? "display:none"
        : e.getAttribute("aria-hidden") === "true"
          ? "aria-hidden"
          : SR.test(cls(e)) ||
              (s.position === "absolute" &&
                e.offsetWidth <= 1 &&
                e.offsetHeight <= 1 &&
                (s.overflow === "hidden" || s.clip !== "auto"))
            ? "screen-reader only"
            : null;
    return how ? { how, block: e } : null;
  });
  const blocks = new Map(),
    by = {};
  let hiddenWords = 0;
  for (const [t, p] of texts) {
    const h = hideOf(p),
      n = h && h !== "skip" ? count(t) : 0;
    if (!n) continue;
    hiddenWords += n;
    by[h.how] = (by[h.how] || 0) + n;
    const b = blocks.get(h.block) || blocks.set(h.block, { how: h.how, words: 0, text: "" }).get(h.block);
    b.words += n;
    if (b.text.length < 80) b.text += " " + t.trim();
  }
  return {
    words: wordsIn(document),
    ...(raw != null ? { rawWords: wordsIn(new DOMParser().parseFromString(raw, "text/html")) } : {}),
    h1: h1 ? first(h1) : null,
    cta: cta ? label(cta) : null,
    nav: [
      ...new Set(
        [...document.querySelectorAll('nav a[href], [role="navigation"] a[href]')].filter(across).map(a => a.href),
      ),
    ].slice(0, 60),
    broken,
    target,
    ads,
    region: [hdr ? box(hdr).bottom + scrollY : 0, ftr ? box(ftr).top + scrollY : document.documentElement.scrollHeight],
    hidden: {
      words: hiddenWords,
      by,
      examples: [...blocks.values()]
        .sort((a, b) => b.words - a.words)
        .slice(0, 3)
        .map(b => ({ how: b.how, words: b.words, text: b.text.replace(/\s+/g, " ").trim().slice(0, 80) })),
    },
    ...(withHtml ? { html: document.documentElement.outerHTML } : {}),
  };
}
// The desktop nav links (`nav`) a phone hides everywhere on the page, and the button that should show them, by its name.
function menuFind(nav) {
  const shown = e => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const reach = e => {
    const r = e.getBoundingClientRect();
    return shown(e) && r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth;
  };
  const links = [...document.querySelectorAll("a[href]")],
    hrefs = nav.filter(h => !links.some(a => a.href === h && reach(a)));
  if (hrefs.length < 3) return { hidden: hrefs.length };
  const here = location.href.split("#")[0];
  const name = e =>
    `${e.getAttribute("aria-label") || ""} ${e.innerText || ""} ${e.title || ""} ${e.id} ${e.getAttribute("class") || ""} ${e.getAttribute("aria-controls") || ""}`;
  const toggle = [
    ...document.querySelectorAll(
      'button, [role="button"], a[href], label[for], summary, [aria-controls], [aria-expanded]',
    ),
  ].find(
    e =>
      reach(e) &&
      e.getBoundingClientRect().top < innerHeight &&
      !(e.matches("a[href]") && e.href.split("#")[0] !== here) &&
      /menu|navigation|\bnav\b|hamburger|burger|navbar-toggle|nav-toggle|toggle-nav/i.test(name(e)),
  );
  if (!toggle) return { hidden: hrefs.length, toggle: null };
  const r = toggle.getBoundingClientRect(),
    x = r.left + r.width / 2,
    y = r.top + r.height / 2,
    top = document.elementFromPoint(x, y);
  return {
    hidden: hrefs.length,
    hrefs,
    x,
    y,
    covered: !(top && (top === toggle || toggle.contains(top) || top.contains(toggle))),
    toggle:
      (toggle.getAttribute("aria-label") || toggle.innerText || toggle.title || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40) || "the menu button",
  };
}
// After the tap, the menu links shown: as soon as half of them show (menuVerdict's line for a menu that opens), else
// what shows after `ms` (menus slide in).
function menuReached(hrefs, ms) {
  const reach = e => {
    const r = e.getBoundingClientRect();
    return (
      e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
      r.width > 0 &&
      r.height > 0 &&
      r.right > 0 &&
      r.left < innerWidth
    );
  };
  const count = () => {
    const links = [...document.querySelectorAll("a[href]")];
    return hrefs.filter(h => links.some(a => a.href === h && reach(a))).length;
  };
  const end = Date.now() + ms;
  return new Promise(ok => {
    const tick = () => {
      const n = count();
      if (n >= hrefs.length / 2 || Date.now() >= end) ok(n);
      else setTimeout(tick, 50);
    };
    tick();
  });
}
// After a load at #id: still at the target, and the #id still in the address? (Google's "Read more" deep links.)
function landed(id) {
  const t = document.getElementById(id);
  if (!t) return null;
  const r = t.getBoundingClientRect(),
    inView = r.bottom > 0 && r.top < innerHeight,
    kept = location.hash.slice(1) === id || location.hash.slice(1) === encodeURIComponent(id);
  return inView && kept ? "ok" : inView ? "hash-removed" : kept ? "scrolled-away" : "both";
}
// Down the page a screen at a time so lazy images and infinite lists load (40 screens at most), then back to the top.
async function scrollAll() {
  const wait = ms => new Promise(ok => setTimeout(ok, ms)),
    root = document.scrollingElement || document.documentElement;
  for (let i = 0; i < 40 && scrollY + innerHeight < root.scrollHeight - 1; i++) {
    const y = scrollY;
    scrollBy(0, Math.max(200, innerHeight * 0.8));
    await wait(150);
    if (scrollY === y) break;
  }
  await wait(300);
  scrollTo(0, 0);
  await Promise.race([Promise.all([...document.images].map(i => i.decode().catch(() => {}))), wait(3000)]);
}
// Hides cookie bars and chat widgets (fixed or sticky layers named so, or inside one) for a clean screenshot; false
// shows them again.
function hideJunk(on) {
  const JUNK =
    /onetrust|cookiebot|cybot|didomi|usercentrics|quantcast|qc-cmp|\bcmp\b|consent|cookie|intercom|drift|crisp|zendesk|hubspot-messages|tawk|livechat|tidio|freshchat|olark|chat/i;
  document.getElementById("seo-supervisor-hide")?.remove();
  if (!on) return 0;
  let n = 0;
  for (const e of document.querySelectorAll("body *")) {
    if (!/^(fixed|sticky)$/.test(getComputedStyle(e).position)) continue;
    let hit = false;
    for (let a = e; a && a !== document.body && !hit; a = a.parentElement)
      hit = JUNK.test(
        `${a.id} ${a.getAttribute("class") || ""} ${a.tagName === "IFRAME" ? `${a.src} ${a.title}` : ""}`,
      );
    if (hit) {
      e.setAttribute("data-seo-supervisor-hide", "");
      n++;
    }
  }
  const style = document.createElement("style");
  style.id = "seo-supervisor-hide";
  style.textContent = "[data-seo-supervisor-hide]{display:none!important}";
  document.head.append(style);
  return n;
}
function clickOn(selector) {
  const e = document.querySelector(selector);
  if (!e) return false;
  e.scrollIntoView({ block: "center" });
  e.click();
  return true;
}

// Local cap, in CSS px: Chrome can't draw much past 16,384 px.
const FULL_MAX = 12000;
// Resized in the desktop load, not loaded again, so a page that lays itself out only on load keeps its 1366 px layout.
const SIZES = [
  ["desktop-1920", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }],
  ["tablet", { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false }],
];
const shoot = async (page, file, opts = { format: "png" }) =>
  writeFileSync(file, Buffer.from((await page.send("Page.captureScreenshot", opts)).data, "base64"));
// The whole page after scrolling through it, at CSS-pixel size, as JPEG to keep the files small.
async function fullPage(page, file, device) {
  await evaluate(page, `(${scrollAll})()`);
  const { cssContentSize: c } = await page.send("Page.getLayoutMetrics");
  await shoot(page, file, {
    format: "jpeg",
    quality: 70,
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: Math.ceil(c.width),
      height: Math.min(Math.ceil(c.height), FULL_MAX),
      scale: 1 / device.deviceScaleFactor,
    },
  });
}
async function cleanShot(page, file) {
  if (await evaluate(page, `(${hideJunk})(true)`)) await shoot(page, file);
  await evaluate(page, `(${hideJunk})(false)`);
}
// The tab's browser errors go into `errors` from before the page loads: visit() opens its tab with chrome.newPage().
const watch = (chrome, errors) => ({
  ...chrome,
  async newPage() {
    const page = await chrome.newPage();
    for (const m of ["Runtime.exceptionThrown", "Runtime.consoleAPICalled", "Log.entryAdded"])
      page.on(m, p => {
        const e = errorOf(m, p);
        if (e) errors.add(e);
      });
    await page.send("Runtime.enable");
    await page.send("Log.enable");
    return page;
  },
});

async function userAgents(chrome) {
  const { userAgent: ua } = await chrome.send("Browser.getVersion");
  return {
    desktop: ua.replace("HeadlessChrome/", "Chrome/"),
    phone: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ua.match(/Chrome\/(\d+)/)?.[1] || "130"}.0.0.0 Mobile Safari/537.36`,
  };
}

/** Loads the render sample again, up to 10 pages; pages gives each page's data for the report. rawWords is the
 * crawler's word count per URL; clean adds screenshots without cookie bars and chat widgets; chosen is rendered at
 * phone size after its steps.
 * @param {string} browser
 * @param {string[]} urls
 * @param {{ add?: AddFinding, screenshotDir?: string, rawWords?: Map<string, number>, clean?: boolean, chosen?: { url: string, steps?: string, raw?: string | null } | null, pageBudgetMs?: number }} [options] */
export async function checkMore(
  browser,
  urls,
  { add, screenshotDir, rawWords = new Map(), clean = false, chosen = null, pageBudgetMs = 60000 } = {},
) {
  const pages = [],
    notes = [],
    used = new Set(),
    why = e => String(e.message).split("\n")[0].slice(0, 120);
  const list = urls.slice(0, 10),
    gates = [],
    noButton = [];
  let checked = 0,
    picked = null,
    steps = [];
  if (chosen)
    try {
      steps = parseSteps(chosen.steps);
    } catch (e) {
      notes.push(`--render-steps: ${e.message}. The page you chose wasn't rendered.`);
      chosen = null;
    }
  if (!list.length && !chosen) return { checked, pages, chosen: picked, notes };
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
  // The same guard as checkVisual: every request is checked against the site's own addresses.
  const checkAddress = await addressCheck(list[0] ?? chosen.url),
    guard = await startGuard(list[0] ?? chosen.url);
  const chrome = await launchChrome(browser, { args: guard?.args || [] }).catch(async e => {
    await guard?.close();
    throw e;
  });
  try {
    const ua = await userAgents(chrome);
    for (const url of list) {
      const slug = slugOf(url, used),
        deadline = Date.now() + pageBudgetMs,
        errors = new Set(),
        tab = watch(chrome, errors);
      const shots = async (page, kind) => {
        if (!screenshotDir) return;
        const at = name => join(screenshotDir, `${slug}-${kind}-${name}`);
        await fullPage(page, at("full.jpg"), kind === "desktop" ? DESKTOP : PHONE);
        if (clean) await cleanShot(page, at("clean.png"));
        if (kind === "desktop")
          for (const [name, size] of SIZES) {
            await page.send("Emulation.setDeviceMetricsOverride", size);
            await evaluate(page, DRAWN);
            await shoot(page, join(screenshotDir, `${slug}-${name}.png`));
          }
      };
      let d, m;
      try {
        d = await visit(
          tab,
          url,
          { device: DESKTOP, userAgent: ua.desktop, settleMs: 500, deadline, checkAddress },
          async p => {
            const x = await evaluate(p, `(${pageMore})(true)`);
            x.gate = gateOf(x.html);
            delete x.html;
            if (!x.gate) await shots(p, "desktop");
            return x;
          },
        );
        if (d.gate) {
          gates.push(`${new URL(url).pathname} (${d.gate})`);
          pages.push({ url, gate: d.gate, errors: [...errors].slice(0, 10) });
          continue;
        }
        m = await visit(
          tab,
          url,
          { device: PHONE, userAgent: ua.phone, settleMs: 1000, deadline, checkAddress },
          async p => {
            const x = await evaluate(p, `(${pageMore})(false)`);
            await shots(p, "mobile");
            await evaluate(p, `(${hideJunk})(true)`); // a cookie bar or chat bubble mustn't take the tap
            x.menu = await evaluate(p, `(${menuFind})(${JSON.stringify(d.nav)})`);
            if (x.menu.toggle && !x.menu.covered) {
              for (const type of ["mousePressed", "mouseReleased"])
                await p.send("Input.dispatchMouseEvent", {
                  type,
                  x: x.menu.x,
                  y: x.menu.y,
                  button: "left",
                  clickCount: 1,
                });
              x.menu.revealed = await evaluate(p, `(${menuReached})(${JSON.stringify(x.menu.hrefs)}, 700)`);
            }
            return x;
          },
        );
      } catch (e) {
        notes.push(`Couldn't load ${url} for the render checks (${why(e)}).`);
        continue;
      }
      checked++;
      const rec = {
        url,
        h1: { desktop: d.h1, phone: m.h1 },
        cta: { desktop: d.cta, phone: m.cta },
        words: { html: rawWords.get(url) ?? null, rendered: d.words },
        menu: menuVerdict(m.menu),
        ads: adShare(m.ads, m.region),
      };
      if (d.hidden.words) rec.hidden = d.hidden;
      if (d.broken.length || d.target) rec.jumpLinks = { broken: d.broken, deepLink: null, target: d.target };
      if (d.target)
        try {
          rec.jumpLinks.deepLink = await visit(
            tab,
            `${url.split("#")[0]}#${encodeURIComponent(d.target)}`,
            { device: DESKTOP, userAgent: ua.desktop, settleMs: 1500, deadline, checkAddress },
            p => evaluate(p, `(${landed})(${JSON.stringify(d.target)})`),
          );
        } catch (e) {
          notes.push(`Couldn't test a jump to #${d.target} on ${url} (${why(e)}).`);
        }
      rec.errors = [...errors].slice(0, 10);
      pages.push(rec);
      if (addsText(rec.words.html, rec.words.rendered))
        add(
          "render-adds-text",
          url,
          `${rec.words.html} words in the HTML, ${rec.words.rendered} after JavaScript runs`,
        );
      if (rec.menu === "closed")
        add(
          "mobile-menu-closed",
          url,
          `the menu button “${m.menu.toggle}” showed ${m.menu.revealed} of the ${m.menu.hidden} menu links desktop shows`,
        );
      if (rec.menu === "no-button") noButton.push(new URL(url).pathname);
      if (rec.ads > 0.3)
        add(
          "mobile-ad-density",
          url,
          `ads take ${Math.round(rec.ads * 100)}% of the page's height on a phone, between the header and the footer`,
        );
    }
    if (chosen) {
      const errors = new Set();
      try {
        const x = await visit(
          watch(chrome, errors),
          chosen.url,
          { device: PHONE, userAgent: ua.phone, settleMs: 1000, deadline: Date.now() + 120000, checkAddress },
          async p => {
            for (const s of steps) {
              if (s.do === "scroll") await evaluate(p, `(${scrollAll})()`);
              else if (s.do === "wait") await sleep(s.ms);
              else if (await evaluate(p, `(${clickOn})(${JSON.stringify(s.selector)})`)) await sleep(500);
              else
                notes.push(
                  `--render-steps: nothing on the page you chose matched “${s.selector}”, so that click was skipped.`,
                );
            }
            const r = await evaluate(p, `(${pageMore})(true, ${JSON.stringify(chosen.raw ?? null)})`);
            if (screenshotDir) {
              await shoot(p, join(screenshotDir, "chosen-mobile.png"));
              await fullPage(p, join(screenshotDir, "chosen-mobile-full.jpg"), PHONE);
            }
            return r;
          },
        );
        picked = {
          url: chosen.url,
          steps: steps.length ? chosen.steps.trim() : null,
          words: { html: x.rawWords ?? null, rendered: x.words },
          changes: chosen.raw ? compareRendered(chosen.raw, x.html) : [],
          gate: gateOf(x.html),
          errors: [...errors].slice(0, 10),
        };
        notes.push(
          `Rendered the page you chose, ${chosen.url}, at phone size${steps.length ? " after your steps" : ""}${screenshotDir ? ", with screenshots (chosen-mobile.png and chosen-mobile-full.jpg)" : ""}. Information only.`,
        );
      } catch (e) {
        notes.push(`Couldn't render the page you chose, ${chosen.url} (${why(e)}).`);
      }
    }
  } finally {
    await chrome.close();
    await guard?.close();
  }
  if (checked)
    notes.push(
      `Loaded ${checked} sample page(s) again at desktop and phone size for browser errors, the first screen, the phone menu, ads, hidden text and jump links${screenshotDir ? `, with whole-page, 1920×1080 and 768×1024 (tablet) screenshots${clean ? " and copies without cookie bars and chat widgets" : ""}` : ""}.`,
    );
  if (checked && screenshotDir)
    notes.push(
      `The screenshots are in ${screenshotDir}. Look through them for text that overlaps or is cut off, images that are stretched, squashed or blurry, and layouts that break at one of the sizes, and report what you find with the file name.`,
    );
  if (gates.length)
    notes.push(
      `Chrome got a login screen or a paywall instead of the page on ${gates.join(", ")}. Reported only: nothing was typed in, and these weren't measured as the page.`,
    );
  if (noButton.length)
    notes.push(
      `On a phone, ${noButton.join(", ")} ${noButton.length === 1 ? "hides" : "hide"} the menu links desktop shows, and no menu button was found to open them. Check the menu by hand on a phone.`,
    );
  return { checked, pages, chosen: picked, notes };
}
