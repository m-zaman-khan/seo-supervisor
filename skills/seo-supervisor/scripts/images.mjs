#!/usr/bin/env node
// Converts the heavy JPEG and PNG files an audit found to WebP or AVIF, with sharp, the optional image add-on.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { isMain } from "./lib/is-main.mjs";

// Rough saving in bytes. Lossy WebP is 25–34% smaller than JPEG at the same SSIM and lossless WebP 26% smaller than
// PNG; the low end is used. https://developers.google.com/speed/webp
// Resizing is taken to cut bytes in proportion to pixels, a rule of thumb: photos compress unevenly.
const CUT = { jpeg: 0.25, png: 0.26 };
export function estSaving({ bytes, width, format }, maxWidth = 1600) {
  const scale = width > maxWidth ? (maxWidth / width) ** 2 : 1;
  return Math.round(bytes * (1 - scale * (1 - (CUT[format] || 0))));
}

class Fail extends Error {
  constructor(msg, code = 2) {
    super("images: " + msg);
    this.code = code;
  }
}
const kb = n => `${Math.round(n / 1024).toLocaleString("en-US")} KB`;
const swapExt = (p, ext) => p.slice(0, p.length - extname(p).length) + "." + ext;
const ADD_ON = "npx seo-supervisor --with-image-tools";

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i].replace(/^--/, "");
    args[k] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  }
  if (typeof args.crawl !== "string" || typeof args.root !== "string")
    throw new Fail(
      "usage: node images.mjs --crawl seo-audit/seo-crawl.json --root <public folder> [--avif] [--max-width 1600] [--out-dir <dir>] [--yes]",
    );
  const maxWidth = args["max-width"] == null ? 1600 : Number(args["max-width"]);
  if (!Number.isInteger(maxWidth) || maxWidth < 1)
    throw new Fail(`--max-width needs a whole number of pixels (got ${args["max-width"]}).`);
  const root = resolve(args.root),
    outDir = typeof args["out-dir"] === "string" ? resolve(args["out-dir"]) : null;
  let crawl;
  try {
    crawl = JSON.parse(readFileSync(args.crawl, "utf8"));
  } catch (e) {
    throw new Fail(`couldn't read ${args.crawl} (${e.code || e.message}).`);
  }
  if (!Array.isArray(crawl?.images))
    throw new Fail(`${args.crawl} has no image list: it was made by an older crawler. Re-run the audit, then this.`, 1);
  if (!existsSync(root)) throw new Fail(`--root ${args.root} doesn't exist.`);

  const show = p => relative(process.cwd(), p).replace(/\\/g, "/") || ".";
  const formats = ["webp", ...(args.avif === true ? ["avif"] : [])];
  const todo = [],
    missing = [],
    outside = [];
  let modern = 0;
  for (const img of crawl.images) {
    // 100 KB is PERF-08's threshold.
    if (!img || typeof img.url !== "string" || !(img.bytes > 100 * 1024)) continue;
    if (!/^(jpeg|png)$/.test(img.format)) {
      if (img.bytes > 200 * 1024) modern++;
      continue;
    }
    let path;
    try {
      path = decodeURIComponent(new URL(img.url).pathname);
    } catch {
      continue;
    }
    const file = join(root, path);
    if (!file.startsWith(root + sep)) {
      outside.push(img.url);
      continue;
    } // a crafted path can't reach outside --root
    if (!existsSync(file) || !statSync(file).isFile()) {
      missing.push(path);
      continue;
    }
    const out = outDir ? join(outDir, relative(root, file)) : file;
    todo.push({
      img,
      file,
      path,
      target: f => swapExt(out, f),
      src: f => swapExt(path, f),
      saving: estSaving(img, maxWidth),
    });
  }
  todo.sort((a, b) => b.saving - a.saving);

  const total = todo.reduce((n, t) => n + t.saving, 0);
  console.log(
    todo.length
      ? `images: ${todo.length} image(s) to convert to ${formats.length > 1 ? "WebP and AVIF" : "WebP"}, about ${kb(total)} smaller in all (a rough estimate for WebP${formats.length > 1 ? "; AVIF is often smaller still" : ""}):`
      : "images: no JPEG or PNG over 100 KB from the crawl was found under --root, so there's nothing to convert.",
  );
  for (const t of todo) {
    const pages = (Array.isArray(t.img.pages) ? t.img.pages : []).slice(0, 3).map(p => {
      try {
        return new URL(p).pathname;
      } catch {
        return String(p);
      }
    });
    console.log(
      `  ${show(t.file)} (${kb(t.img.bytes)}${t.img.width ? `, ${t.img.width} px wide` : ""}) → ${t.src("webp")}, about ${kb(t.saving)} smaller${pages.length ? `; on ${pages.join(", ")}` : ""}`,
    );
  }
  if (missing.length)
    console.log(
      `Not found under ${show(root)}, left alone: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` and ${missing.length - 10} more` : ""}`,
    );
  if (outside.length) console.log(`Outside --root, refused: ${outside.slice(0, 3).join(", ")}`);
  if (modern)
    console.log(
      `${modern} heavy image(s) are already WebP, AVIF or another format; resize or compress those where they're made.`,
    );

  const SHARP = join(homedir(), ".seo-supervisor", "tools", "node_modules", "sharp");
  const installed = existsSync(SHARP);
  if (todo.length && args.yes !== true) {
    console.log(
      `\nDry run: nothing was written. With --yes it writes the new files ${outDir ? `under ${show(outDir)}` : "next to the originals"} and changes nothing else.`,
    );
    if (!installed)
      console.log(
        `It needs the optional image add-on (sharp, about 20 MB in ~/.seo-supervisor/tools, not your project): ${ADD_ON}`,
      );
  }
  if (todo.length && args.yes === true) {
    if (!installed) {
      console.log(
        `\nNothing was converted: the optional image add-on isn't installed. Add it with ${ADD_ON} (sharp, about 20 MB in ~/.seo-supervisor/tools, not your project), then run this again.`,
      );
      return 0;
    }
    let sharp;
    try {
      sharp = createRequire(import.meta.url)(SHARP);
    } catch (e) {
      throw new Fail(`sharp is in ${SHARP} but didn't load (${e.message}). Reinstall it with ${ADD_ON}.`, 1);
    }
    console.log("");
    for (const t of todo)
      for (const f of formats) {
        const out = t.target(f);
        // Nothing is overwritten or deleted: originals stay, and an existing output is left alone.
        if (existsSync(out)) {
          console.log(`  ${show(out)} exists, left alone`);
          continue;
        }
        mkdirSync(dirname(out), { recursive: true });
        const pipe = sharp(t.file).autoOrient().resize({ width: maxWidth, withoutEnlargement: true });
        const info = await (f === "avif" ? pipe.avif() : pipe.webp()).toFile(out);
        const was = statSync(t.file).size;
        console.log(
          `  wrote ${show(out)}: ${kb(info.size)}, was ${kb(was)}${info.size >= was ? " (not smaller: keep using the original)" : ""}`,
        );
      }
  }
  if (todo.length) {
    const t = todo[0],
      alt = formats.includes("avif") ? `<source srcset="${t.src("avif")}" type="image/avif">` : "";
    console.log(
      `\nThen point the markup at the new files${outDir ? `, once they're served next to the originals` : ""}. Keep the original as the fallback:`,
    );
    console.log(
      `  <picture>${alt}<source srcset="${t.src("webp")}" type="image/webp"><img src="${t.path}" alt="…" width="…" height="…"></picture>`,
    );
    console.log(
      "or change the src to the .webp, which every current browser supports. A framework image component (next/image, Astro's <Image>, Nuxt Image) can serve WebP and AVIF for you instead.",
    );
  }
  return 0;
}

// Sets the exit code instead of calling process.exit(), like the other scripts.
if (isMain(import.meta.url))
  process.exitCode = await main().catch(e => {
    if (!(e instanceof Fail)) throw e;
    console.error(e.message);
    return e.code;
  });
