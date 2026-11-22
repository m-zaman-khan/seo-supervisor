#!/usr/bin/env node
// @ts-check
// Makes 1200x630 Open Graph cards locally: plain HTML with system fonts, screenshotted in headless Chrome or Edge.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isMain } from "./lib/is-main.mjs";
import { findBrowser } from "./checks/render.mjs";
import { CHROME_FLAGS, quietProfile } from "./lib/cdp.mjs";

const W = 1200,
  H = 630;
const esc = s =>
  String(s ?? "").replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const hex = (v, name) => {
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v))
    throw new Error(`${name} must be a hex colour like #2459c9, got "${v}"`);
  return v.length === 4 ? "#" + [...v.slice(1)].map(c => c + c).join("") : v;
};
// WCAG relative luminance, so the text is whichever of white or near-black contrasts more with the background.
const lum = v =>
  [1, 3, 5]
    .map(i => parseInt(v.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

// logo: an image URL the page can load offline (the CLI passes a data: URI).
/** @param {{ title?: string, subtitle?: string, brand?: string, accent?: string, background?: string, logo?: string }} [card] */
export function cardHtml({
  title,
  subtitle = "",
  brand = "",
  accent = "#2459c9",
  background = "#0b1220",
  logo = "",
} = {}) {
  const bg = hex(background, "background"),
    ac = hex(accent, "accent");
  const ink = contrast("#ffffff", bg) >= contrast("#0b1220", bg) ? "#ffffff" : "#0b1220";
  const len = String(title ?? "").length,
    size = len <= 40 ? "title-lg" : len <= 80 ? "title-md" : "title-sm";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
body { background: ${bg}; color: ${ink}; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif; }
.card { box-sizing: border-box; width: ${W}px; height: ${H}px; padding: 72px 80px 64px; display: flex; flex-direction: column; border-bottom: 10px solid ${ac}; }
.bar { width: 120px; height: 10px; border-radius: 5px; background: ${ac}; margin-bottom: 40px; flex: none; }
.title { margin: 0; font-weight: 800; letter-spacing: -0.02em; line-height: 1.2; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.title-lg { font-size: 80px; } .title-md { font-size: 64px; } .title-sm { font-size: 52px; }
.subtitle { margin: 24px 0 0; font-size: 32px; line-height: 1.35; opacity: 0.82; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.brand { margin-top: auto; display: flex; align-items: center; gap: 18px; font-size: 30px; font-weight: 700; flex: none; }
.brand img { height: 56px; max-width: 220px; object-fit: contain; }
</style></head>
<body><main class="card">
<div class="bar"></div>
<h1 class="title ${size}">${esc(title)}</h1>
${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ""}
<div class="brand">${logo ? `<img src="${esc(logo)}" alt="">` : ""}${brand ? `<span>${esc(brand)}</span>` : ""}</div>
</main></body></html>
`;
}

// { width, height } from a PNG's IHDR chunk, or null when it isn't a PNG.
export function pngSize(buf) {
  if (
    !buf ||
    buf.length < 24 ||
    buf.readUInt32BE(0) !== 0x89504e47 ||
    buf.readUInt32BE(4) !== 0x0d0a1a0a ||
    buf.toString("latin1", 12, 16) !== "IHDR"
  )
    return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

class CardError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Chrome's command line for one screenshot, with Chrome's own background traffic off (CHROME_FLAGS).
export const shotArgs = (page, png, profile, extra = []) => [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  `--window-size=${W},${H}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  ...CHROME_FLAGS,
  ...extra,
  `--screenshot=${png}`,
  `--user-data-dir=${profile}`,
  pathToFileURL(page).href,
];

// One headless screenshot from a throwaway profile; resolves with the error (or null), never rejects.
function shoot(browser, page, png, extra = []) {
  const profile = quietProfile(mkdtempSync(join(tmpdir(), "seo-supervisor-og-profile-")));
  return new Promise(ok =>
    execFile(browser, shotArgs(page, png, profile, extra), { timeout: 30000 }, (err, stdout, stderr) => {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
      ok(err ? Object.assign(err, { stderr }) : null);
    }),
  );
}

// Renders into a temp folder first, so a failed render never replaces an existing image.
async function renderCard(browser, opts, out) {
  const work = mkdtempSync(join(tmpdir(), "seo-supervisor-og-"));
  try {
    const page = join(work, "card.html"),
      png = join(work, "card.png");
    writeFileSync(page, cardHtml(opts));
    const err = await shoot(browser, page, png);
    if (!existsSync(png)) {
      const why = String(err?.stderr || err?.message || "")
        .trim()
        .split(/\r?\n/)[0];
      throw new CardError(
        `og-card: ${browser} didn't take a screenshot, so it isn't Chrome or Edge or it failed to start${why ? ` (${why})` : ""}. Set CHROME_PATH to a Chrome or Edge executable.`,
        2,
      );
    }
    let size = pngSize(readFileSync(png));
    // Headless Chrome on Windows can clamp the window size; retry once with a transparent default background.
    // No crop fallback: if clamping persists, capture a larger window and crop the PNG (node:zlib).
    if (size?.width !== W || size?.height !== H) {
      rmSync(png, { force: true });
      await shoot(browser, page, png, ["--default-background-color=00000000"]);
      size = existsSync(png) ? pngSize(readFileSync(png)) : null;
    }
    if (size?.width !== W || size?.height !== H)
      throw new CardError(
        `og-card: ${browser} made a ${size ? `${size.width}x${size.height}` : "unreadable"} image instead of ${W}x${H}. Its headless window size was clamped (reported for Chrome on Windows). Update the browser or try the other one with CHROME_PATH (Chrome or Edge). Nothing was written to ${out}.`,
        1,
      );
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(png, out);
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {}
  }
}

const MIME = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
// "/blog/first-post/" -> "blog-first-post"; "/" -> "home"; "/日本語/" (no ASCII letters or digits) -> "page-" + a
// short hash. Only word characters and dashes, so it can't leave --out-dir.
const fileOf = slug => {
  const s = String(slug ?? "")
      .trim()
      .replace(/^\/+|\/+$/g, ""),
    name = s.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
  return (name || (s ? `page-${createHash("sha256").update(s).digest("hex").slice(0, 8)}` : "home")) + ".png";
};

if (isMain(import.meta.url)) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i].replace(/^--/, "");
    args[k] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  }
  const fail = (msg, code = 2) => {
    console.error(msg);
    process.exit(code);
  };
  const single = typeof args.title === "string" && typeof args.out === "string",
    batch = typeof args.pages === "string" && typeof args["out-dir"] === "string";
  if (!single && !batch)
    fail(`usage: node og-card.mjs --title "..." [--subtitle ...] [--brand ...] [--accent #2459c9] [--background #0b1220] [--logo logo.svg|png] --out public/og/home.png
       node og-card.mjs --pages pages.json --out-dir public/og/ [--brand ... --accent ... --background ... --logo ...]`);

  const shared = {};
  for (const k of ["brand", "accent", "background"]) if (typeof args[k] === "string") shared[k] = args[k];
  if (typeof args.logo === "string") {
    const mime = MIME[extname(args.logo).toLowerCase()];
    if (!mime) fail(`og-card: --logo must be .svg, .png, .jpg or .webp, got ${args.logo}`);
    if (!existsSync(args.logo)) fail(`og-card: logo not found: ${args.logo}`);
    shared.logo = `data:${mime};base64,${readFileSync(args.logo).toString("base64")}`;
  }

  let jobs;
  if (single)
    jobs = [
      [
        { ...shared, title: args.title, subtitle: typeof args.subtitle === "string" ? args.subtitle : "" },
        resolve(args.out),
      ],
    ];
  else {
    let pages;
    try {
      pages = JSON.parse(readFileSync(args.pages, "utf8"));
    } catch (e) {
      fail(`og-card: can't read ${args.pages} as JSON: ${e.message}`);
    }
    if (!Array.isArray(pages) || !pages.length || pages.some(p => !p || typeof p.title !== "string" || !p.title))
      fail(`og-card: ${args.pages} must be a non-empty array of { "slug", "title", "subtitle" } with a title in each`);
    jobs = pages.map(p => [
      { ...shared, title: p.title, subtitle: p.subtitle || "" },
      resolve(args["out-dir"], fileOf(p.slug)),
    ]);
    const seen = new Set();
    // Case-insensitive: About.png and about.png are one file on Windows and macOS.
    for (const [, out] of jobs) {
      if (seen.has(out.toLowerCase())) fail(`og-card: two pages would both write ${out}; give them different slugs`);
      seen.add(out.toLowerCase());
    }
  }
  try {
    for (const [opts] of jobs) cardHtml(opts);
  } catch (e) {
    fail(`og-card: ${e.message}`);
  }

  let browser = null;
  try {
    browser = findBrowser();
  } catch (e) {
    fail(`og-card: ${e.message}`);
  }
  if (!browser) fail("og-card: no Chrome or Edge found. Install one, or set CHROME_PATH to its executable.");
  try {
    for (const [opts, out] of jobs) await renderCard(browser, opts, out);
  } catch (e) {
    fail(e.message, e instanceof CardError ? e.code : 1);
  }
  console.log(
    single
      ? `og-card: wrote ${jobs[0][1]} (${W}x${H})`
      : `og-card: wrote ${jobs.length} card(s) (${W}x${H}) to ${resolve(args["out-dir"])}`,
  );
}
