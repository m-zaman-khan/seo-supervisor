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
    "Google indexes the mobile version of every page. Text or a heading that only desktop visitors see doesn't count for ranking.",
    "Show the same main text and H1 at every screen size. Restyle it for small screens (stack it, or collapse it into sections that stay in the HTML) instead of hiding it.",
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
// Read in the page: visible main text and H1s, page width, body text size, and the biggest fixed or sticky top layer.
const MEASURE = `(() => {
  const shown = e => e.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const main = document.querySelector("main") || document.body;
  const vw = innerWidth, vh = innerHeight;
  let cover = 0, coverBy = "";
  for (const e of document.body.querySelectorAll("*")) {
    const s = getComputedStyle(e);
    if ((s.position !== "fixed" && s.position !== "sticky") || parseInt(s.zIndex) < 0 || !shown(e)) continue;
    const r = e.getBoundingClientRect(), x0 = Math.max(r.left, 0), x1 = Math.min(r.right, vw), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, vh);
    const share = Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / (vw * vh);
    if (share <= cover || !e.contains(document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2))) continue; // a layer behind the content isn't a popup
    cover = share; coverBy = e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\\s+/).join(".") : "");
  }
  return {
    words: shown(main) ? main.innerText.split(/\\s+/).filter(Boolean).length : 0,
    h1: [...document.querySelectorAll("h1")].filter(shown).map(h => h.innerText.replace(/\\s+/g, " ").trim().toLowerCase()).filter(Boolean),
    viewport: /width\\s*=\\s*device-width/i.test(document.querySelector('meta[name="viewport" i]')?.content || ""),
    scrollWidth: document.documentElement.scrollWidth,
    fontSize: parseFloat(getComputedStyle(document.body).fontSize),
    cover, coverBy,
  };
})()`;
// Installed before the page's scripts. Blocking time is each long task's part over 50 ms, as in Lighthouse's TBT.
const OBSERVE = `window.__seoLab = { lcp: 0, cls: 0, tbt: 0 }; try {
  new PerformanceObserver(l => { for (const e of l.getEntries()) __seoLab.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) __seoLab.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) __seoLab.tbt += Math.max(0, e.duration - 50); }).observe({ type: "longtask", buffered: true });
} catch {}`;

async function evaluate(page, expression) {
  const r = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] || r.exceptionDetails.text);
  return r.result.value;
}

// A fresh tab per load, so emulation and throttling never leak into the next. After the load event the page settles
// until Chrome's networkIdle (500 ms of quiet) or settleMs, whichever comes first.
async function visit(chrome, url, { device, userAgent, lab = false, settleMs }, read) {
  const page = await chrome.newPage();
  try {
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
  } finally {
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

export async function checkVisual(browser, urls, { add, screenshotDir } = {}) {
  const notes = [],
    lab = [],
    used = new Set();
  let checked = 0;
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
  const chrome = await launchChrome(browser);
  try {
    const { userAgent: ua } = await chrome.send("Browser.getVersion");
    const desktopUa = ua.replace("HeadlessChrome/", "Chrome/");
    const phoneUa = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ua.match(/Chrome\/(\d+)/)?.[1] || "130"}.0.0.0 Mobile Safari/537.36`;
    for (const url of urls.slice(0, 10)) {
      const slug = slugOf(url, used);
      const shoot = (page, name) =>
        screenshotDir &&
        page
          .send("Page.captureScreenshot", { format: "png" })
          .then(s => writeFileSync(join(screenshotDir, `${slug}-${name}.png`), Buffer.from(s.data, "base64")));
      try {
        // One load at a time, so the lab load has the CPU to itself. Popups get a second after load to appear.
        const d = await visit(chrome, url, { device: DESKTOP, userAgent: desktopUa, settleMs: 200 }, async p => {
          await shoot(p, "desktop");
          return evaluate(p, MEASURE);
        });
        const m = await visit(chrome, url, { device: PHONE, userAgent: phoneUa, settleMs: 1000 }, async p => {
          await shoot(p, "mobile");
          return evaluate(p, MEASURE);
        });
        checked++;
        // Word counts below 30 are too small to compare. A real diff of the text would also catch swapped content.
        const lostH1 = d.h1[0] && !m.h1.includes(d.h1[0]);
        if ((d.words >= 30 && m.words < 0.7 * d.words) || lostH1)
          add(
            "mobile-content-missing",
            url,
            [
              m.words < 0.7 * d.words && `${m.words} words on a phone vs ${d.words} on desktop`,
              lostH1 && `the H1 “${d.h1[0]}” isn't shown on a phone`,
            ]
              .filter(Boolean)
              .join("; "),
          );
        // Without a mobile viewport the page is laid out 980 px wide and zoomed out; the crawler's doc-basics reports that.
        if (m.viewport && m.scrollWidth > PHONE.width + 2)
          add("mobile-overflow", url, `${m.scrollWidth} px wide on a ${PHONE.width} px screen`);
        if (m.viewport && m.fontSize < 12) add("mobile-small-text", url, `body text ${m.fontSize} px`);
        if (m.cover >= 0.5)
          add("mobile-interstitial", url, `${m.coverBy} covers ${Math.round(m.cover * 100)}% of the screen on arrival`);
        const v = await visit(chrome, url, { device: PHONE, userAgent: phoneUa, lab: true, settleMs: 500 }, p =>
          evaluate(p, "window.__seoLab"),
        );
        lab.push({
          url,
          lcp: v.lcp ? Math.round(v.lcp) : null,
          cls: Math.round(v.cls * 1000) / 1000,
          tbt: Math.round(v.tbt),
        });
      } catch (e) {
        notes.push(`Couldn't load ${url} for the phone checks (${String(e.message).split("\n")[0].slice(0, 120)}).`);
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
