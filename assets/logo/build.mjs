// Renders the logo PNGs from assets/logo/icon.svg and docs/favicon.svg in local headless Chrome; nothing is fetched.
// docs/social.png also has to be uploaded by hand as the GitHub repo's social preview.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchChrome } from "../../skills/seo-supervisor/scripts/lib/cdp.mjs";
import { findBrowser } from "../../skills/seo-supervisor/scripts/checks/render.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p, enc) => readFileSync(join(root, p), enc);
const master = read("assets/logo/icon.svg", "utf8"),
  small = read("docs/favicon.svg", "utf8");
const square = svg => svg.replace(/ rx="\d+"/, ""); // full bleed
const data = (type, buf) => `data:${type};base64,${Buffer.from(buf).toString("base64")}`;
const img = (svg, s) => `<img src="${data("image/svg+xml", svg)}" width="${s}" height="${s}" alt="">`;
const font = (name, file) =>
  `@font-face{font-family:${name};src:url(${data("font/woff2", read(`docs/fonts/${file}`))}) format("woff2");font-weight:100 900}`;

const social = `<style>${font("Display", "bricolage-grotesque.woff2")}${font("Sans", "geist.woff2")}${font("Mono", "geist-mono.woff2")}
body{background:#0e131a;color:#e6ebf2}
.card{box-sizing:border-box;width:1280px;height:640px;display:flex;align-items:center;justify-content:center;gap:64px}
.card img{width:232px;height:232px;flex:none}
h1{font:700 92px/1 Display;letter-spacing:-.025em;margin:0 0 22px}
p{font:400 33px/1.35 Sans;color:#c3ccd8;margin:0 0 34px;max-width:21em;text-wrap:balance}
code{font:500 28px/1 Mono;color:#e6ebf2;background:#1c2a39;border-radius:10px;padding:14px 20px;display:inline-block}
</style><div class="card">${img(master, 232)}<div><h1>SEO Supervisor</h1>
<p>Audits, fixes and guards your site's SEO from inside your coding agent.</p><code>npx seo-supervisor</code></div></div>`;

// Full bleed where the host rounds the corners itself: the plugin directory and iOS.
const JOBS = [
  [".claude-plugin/icon.png", 1024, img(square(master), 1024)],
  ["assets/logo/icon-256.png", 256, img(master, 256)],
  ["docs/apple-touch-icon.png", 180, img(square(master), 180)],
  ["docs/favicon-32.png", 32, img(small, 32)], // for browsers without SVG favicons
  ["docs/social.png", [1280, 640], social],
];

const dir = mkdtempSync(join(tmpdir(), "seo-supervisor-logo-"));
const chrome = await launchChrome(findBrowser());
try {
  for (const [out, size, body] of JOBS) {
    const [width, height] = [size].flat().length > 1 ? size : [size, size];
    const page = join(dir, "page.html");
    writeFileSync(
      page,
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}img{display:block}</style>${body}`,
    );
    const tab = await chrome.newPage();
    await tab.send("Page.enable");
    await tab.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await tab.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } }); // keeps the rounded corners transparent
    const loaded = new Promise(ok => tab.on("Page.loadEventFired", ok));
    await tab.send("Page.navigate", { url: pathToFileURL(page).href });
    await loaded;
    await tab.send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => 1)", awaitPromise: true });
    const shot = await tab.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    writeFileSync(join(root, out), Buffer.from(shot.data, "base64"));
    await tab.close();
    console.log(`${out}  ${width}x${height}`);
  }
} finally {
  await chrome.close();
  rmSync(dir, { recursive: true, force: true });
}
