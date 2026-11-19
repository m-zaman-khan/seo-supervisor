// Loads sample pages at desktop and phone size in an installed Chrome or Edge for the phone and lab speed checks,
// with screenshots. The pages' own scripts, analytics included, run.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome } from "../lib/cdp.mjs";

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
// Installed before the page's scripts. Blocking time is each long task's part over 50 ms, as in Lighthouse's TBT.
const OBSERVE = `window.__seoLab = { lcp: 0, cls: 0, tbt: 0 }; try {
  new PerformanceObserver(l => { for (const e of l.getEntries()) __seoLab.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) __seoLab.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) __seoLab.tbt += Math.max(0, e.duration - 50); }).observe({ type: "longtask", buffered: true });
} catch {}`;

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
async function visit(chrome, url, { device, userAgent, lab = false, settleMs, deadline }, read) {
  const page = await chrome.newPage();
  page.on("Page.javascriptDialogOpening", () =>
    page.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {}),
  ); // alert() would stall the page
  const load = async () => {
    await page.send("Page.enable");
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
    await sleep(settleMs);
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

// pageBudgetMs covers all three of a page's loads, so a page that hangs (a busy loop, a dialog) can't stall the run.
export async function checkVisual(browser, urls, { add, screenshotDir, pageBudgetMs = 50000 } = {}) {
  const notes = [],
    lab = [],
    used = new Set();
  const why = e => String(e.message).split("\n")[0].slice(0, 120);
  let checked = 0;
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
  const chrome = await launchChrome(browser);
  try {
    const { userAgent: ua } = await chrome.send("Browser.getVersion");
    const desktopUa = ua.replace("HeadlessChrome/", "Chrome/");
    const phoneUa = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ua.match(/Chrome\/(\d+)/)?.[1] || "130"}.0.0.0 Mobile Safari/537.36`;
    for (const url of urls.slice(0, 10)) {
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
          { device: DESKTOP, userAgent: desktopUa, settleMs: 200, deadline },
          async p => {
            await shoot(p, "desktop");
            return evaluate(p, MEASURE);
          },
        );
        const m = await visit(chrome, url, { device: PHONE, userAgent: phoneUa, settleMs: 1000, deadline }, async p => {
          await shoot(p, "mobile");
          return evaluate(p, MEASURE);
        });
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
          { device: PHONE, userAgent: phoneUa, lab: true, settleMs: 500, deadline },
          p => evaluate(p, "window.__seoLab"),
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
    }
  } finally {
    await chrome.close();
  }
  if (checked)
    notes.push(
      `Loaded ${checked} sample page(s) at desktop (1366×768) and phone (390×844) size${screenshotDir ? ", with screenshots" : ""}. Lab speed comes from one phone load with 4× CPU slowdown on slow 4G: indicative only, it won't match Lighthouse.`,
    );
  return { checked, lab, notes };
}
