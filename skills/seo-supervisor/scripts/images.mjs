#!/usr/bin/env node
// @ts-check
// Converts the heavy JPEG and PNG files an audit found to WebP or AVIF, and labels images as AI-made in their XMP.
import { createRequire } from "node:module";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { isMain } from "./lib/is-main.mjs";
import { parseArgs } from "./lib/args.mjs";
import { Fail, runMain } from "./lib/cli.mjs";
import { toolsDir } from "./lib/settings-dir.mjs";
import { AI_SOURCES, imageMeta } from "./lib/image-size.mjs";

// Rough saving in bytes. Lossy WebP is 25–34% smaller than JPEG at the same SSIM and lossless WebP 26% smaller than
// PNG; the low end is used. https://developers.google.com/speed/webp
// Resizing is taken to cut bytes in proportion to pixels, a rule of thumb: photos compress unevenly.
const CUT = { jpeg: 0.25, png: 0.26 };
export function estSaving({ bytes, width, format }, maxWidth = 1600) {
  const scale = width > maxWidth ? (maxWidth / width) ** 2 : 1;
  return Math.round(bytes * (1 - scale * (1 - (CUT[format] || 0))));
}

/** @type {(msg: string, code?: number) => never} */
const fail = (msg, code = 2) => {
  throw new Fail("images: " + msg, code);
};
const kb = n => `${Math.round(n / 1024).toLocaleString("en-US")} KB`;
const swapExt = (p, ext) => p.slice(0, p.length - extname(p).length) + "." + ext;
const ADD_ON = "npx seo-supervisor --with-image-tools";
// The path with links resolved, for a folder not made yet too (its nearest existing parent's, plus the rest).
const real = p => {
  try {
    return realpathSync.native(p);
  } catch {
    return dirname(p) === p ? p : join(real(dirname(p)), basename(p));
  }
};
const within = (p, base) => p === base || p.startsWith(base + sep);

async function main(argv) {
  const args = parseArgs(argv, {
    flags: ["crawl", "root", "max-width", "out-dir", "label-ai", "source"],
    booleans: ["avif", "follow-links", "yes"],
    positionals: 0,
  });
  if (args["label-ai"] !== undefined) return labelMain(args);
  if (typeof args.crawl !== "string" || typeof args.root !== "string")
    fail(
      "usage: node images.mjs --crawl seo-audit/seo-crawl.json --root <public folder> [--avif] [--max-width 1600] [--out-dir <dir>] [--follow-links] [--yes]",
    );
  const mw = args["max-width"] ?? "1600",
    maxWidth = Number(mw);
  if (!/^\d+$/.test(mw) || maxWidth < 320)
    fail(`--max-width needs a width in pixels, 320 or more (got ${mw === true ? "no value" : mw}).`);
  const root = resolve(args.root),
    outDir = typeof args["out-dir"] === "string" ? resolve(args["out-dir"]) : null;
  let crawl;
  try {
    crawl = JSON.parse(readFileSync(args.crawl, "utf8"));
  } catch (e) {
    fail(`couldn't read ${args.crawl} (${e.code || e.message}).`);
  }
  if (!Array.isArray(crawl?.images))
    fail(`${args.crawl} has no image list: it was made by an older crawler. Re-run the audit, then this.`, 1);
  if (!existsSync(root)) fail(`--root ${args.root} doesn't exist.`);

  const show = p => relative(process.cwd(), p).replace(/\\/g, "/") || ".";
  const formats = ["webp", ...(args.avif === true ? ["avif"] : [])];
  const todo = [],
    missing = [],
    outside = [],
    notFiles = [],
    linked = [],
    seen = new Set();
  const realRoot = real(root),
    realOut = outDir ? real(outDir) : realRoot;
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
    // A script that makes images (timthumb.php?src=a.jpg) isn't the image file; a ?v=3 on photo.jpg is fine.
    if (!/\.(jpe?g|png)$/i.test(path)) {
      notFiles.push(img.url);
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
    const out = outDir ? join(outDir, relative(root, file)) : file,
      key = real(file);
    // A symlink or junction leading outside --root or --out-dir needs --follow-links; Laravel's public/storage is one.
    if (args["follow-links"] !== true && !(within(key, realRoot) && within(real(dirname(out)), realOut))) {
      linked.push(path);
      continue;
    }
    if (seen.has(key)) continue; // the same file by another URL (%7a for z, another ?v=)
    seen.add(key);
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
  if (notFiles.length)
    console.log(
      `Not a .jpg, .jpeg or .png file (a script makes these), left alone: ${notFiles.slice(0, 3).join(", ")}${notFiles.length > 3 ? ` and ${notFiles.length - 3} more` : ""}`,
    );
  if (linked.length)
    console.log(
      `Reached through a link that leads outside ${outDir ? "--root or --out-dir" : "--root"}, refused: ${linked.slice(0, 3).join(", ")}${linked.length > 3 ? ` and ${linked.length - 3} more` : ""}. Add --follow-links if that link is meant to be followed (Laravel's public/storage is one).`,
    );
  if (modern)
    console.log(
      `${modern} heavy image(s) are already WebP, AVIF or another format; resize or compress those where they're made.`,
    );

  // sharp is an optional add-on kept in the tools folder, never in the project.
  const SHARP = join(toolsDir(), "node_modules", "sharp");
  const installed = existsSync(SHARP);
  if (todo.length && args.yes !== true) {
    console.log(
      `\nDry run: nothing was written. With --yes it writes the new files ${outDir ? `under ${show(outDir)}` : "next to the originals"} and changes nothing else.`,
    );
    if (!installed)
      console.log(
        `It needs the optional image add-on (sharp, about 20 MB in ${toolsDir()}, not your project): ${ADD_ON}`,
      );
  }
  let failed = 0;
  if (todo.length && args.yes === true) {
    if (!installed) {
      console.log(
        `\nNothing was converted: the optional image add-on isn't installed. Add it with ${ADD_ON} (sharp, about 20 MB in ${toolsDir()}, not your project), then run this again.`,
      );
      return 0;
    }
    let sharp;
    try {
      sharp = createRequire(import.meta.url)(SHARP);
    } catch (e) {
      fail(`sharp is in ${SHARP} but didn't load (${e.message}). Reinstall it with ${ADD_ON}.`, 1);
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
        let info;
        try {
          mkdirSync(dirname(out), { recursive: true });
          const pipe = sharp(t.file).autoOrient().resize({ width: maxWidth, withoutEnlargement: true });
          info = await (f === "avif" ? pipe.avif() : pipe.webp()).toFile(out);
        } catch (e) {
          // too many pixels, a corrupt file: name it and carry on with the rest
          failed++;
          rmSync(out, { force: true }); // only a half-written file of this run's: out didn't exist above
          console.log(`  couldn't convert ${show(t.file)} (${e.message}), left alone`);
          break;
        }
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
  return failed ? 1 : 0;
}

// ---------- the AI label ----------
// Only the metadata changes, so the image isn't re-encoded and sharp isn't needed.
// Iptc4xmpExt:DigitalSourceType takes a URI from IPTC's digitalsourcetype vocabulary.
// https://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata
// XMP sits in a JPEG APP1 segment after XMP_ID, and in a PNG iTXt chunk keyed PNG_KEY (XMP specification, part 3).
const IPTC_NS = "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
  DST = "http://cv.iptc.org/newscodes/digitalsourcetype/";
const XMP_ID = "http://ns.adobe.com/xap/1.0/\0",
  PNG_KEY = "XML:com.adobe.xmp";
// The label added to the packet's first rdf:Description, or a new packet when the file has none.
function labelPacket(xmp, source) {
  const attr = ` Iptc4xmpExt:DigitalSourceType="${DST}${source}"`;
  if (!xmp)
    return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:Iptc4xmpExt="${IPTC_NS}"${attr}/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const m = /<rdf:Description\b[^>]*?(?=\/?>)/.exec(xmp);
  if (!m) throw new Error("its XMP has no rdf:Description to add the label to");
  const end = m.index + m[0].length;
  return (
    xmp.slice(0, end) +
    (/\sxmlns:Iptc4xmpExt\s*=/.test(m[0]) ? "" : ` xmlns:Iptc4xmpExt="${IPTC_NS}"`) +
    attr +
    xmp.slice(end)
  );
}
const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = b => {
  let c = ~0;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return ~c >>> 0;
};
const pngChunk = (type, data) => {
  const t = Buffer.from(type, "latin1"),
    n = Buffer.alloc(4),
    c = Buffer.alloc(4);
  n.writeUInt32BE(data.length);
  c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([n, t, data, c]);
};
function labelJpeg(b, source) {
  // The leading APPn segments (JFIF, Exif, XMP…): an XMP one is edited in place, else the new one goes after them.
  let i = 2,
    seg = null;
  while (i + 4 <= b.length && b[i] === 0xff && b[i + 1] >= 0xe0 && b[i + 1] <= 0xef) {
    const end = i + 2 + b.readUInt16BE(i + 2);
    if (b[i + 1] === 0xe1 && b.toString("latin1", i + 4, i + 4 + XMP_ID.length) === XMP_ID) seg = [i, end];
    i = end;
  }
  const old = seg ? b.toString("utf8", seg[0] + 4 + XMP_ID.length, seg[1]) : "";
  const body = Buffer.concat([Buffer.from(XMP_ID, "latin1"), Buffer.from(labelPacket(old, source), "utf8")]),
    head = Buffer.from([0xff, 0xe1, 0, 0]);
  if (body.length + 2 > 0xffff) throw new Error("its XMP would be over the 64 KB one JPEG segment holds");
  head.writeUInt16BE(body.length + 2, 2);
  const [s, e] = seg || [i, i];
  return Buffer.concat([b.subarray(0, s), head, body, b.subarray(e)]);
}
function labelPng(b, source) {
  let i = 8,
    seg = null,
    idat = null;
  while (i + 12 <= b.length) {
    const n = b.readUInt32BE(i),
      type = b.toString("latin1", i + 4, i + 8);
    if (type === "iTXt" && b.toString("latin1", i + 8, i + 9 + PNG_KEY.length) === PNG_KEY + "\0")
      seg = [i, i + 12 + n];
    if (type === "IDAT") idat ??= i;
    i += 12 + n;
  }
  if (idat == null) throw new Error("it has no image data (IDAT)");
  let old = "";
  if (seg) {
    // keyword\0, compression flag, method, language\0, translated keyword\0, then the text
    const d = b.subarray(seg[0] + 8, seg[1] - 4),
      k = PNG_KEY.length + 1;
    if (d[k] !== 0) throw new Error("its XMP is compressed, which this doesn't edit");
    const lang = d.indexOf(0, k + 2) + 1;
    old = d.toString("utf8", d.indexOf(0, lang) + 1);
  }
  const data = Buffer.concat([
    Buffer.from(PNG_KEY + "\0\0\0\0\0", "latin1"),
    Buffer.from(labelPacket(old, source), "utf8"),
  ]);
  const [s, e] = seg || [idat, idat]; // XMP goes before the image data
  return Buffer.concat([b.subarray(0, s), pngChunk("iTXt", data), b.subarray(e)]);
}
/** The file's bytes with the AI label added to its XMP, image data untouched; throws when it can't be labelled. */
export function withAiLabel(b, source = "trainedAlgorithmicMedia") {
  if (!AI_SOURCES.includes(source))
    throw new Error(`the source must be one of ${AI_SOURCES.join(", ")} (got ${source})`);
  const jpeg = b[0] === 0xff && b[1] === 0xd8,
    png = b.toString("latin1", 0, 8) === "\x89PNG\r\n\x1a\n";
  if (!jpeg && !png) throw new Error("only a JPEG or PNG file can be labelled here");
  const had = imageMeta(b).sourceType;
  if (had) throw new Error(`already labelled: ${had}`);
  return jpeg ? labelJpeg(b, source) : labelPng(b, source);
}

function labelMain(args) {
  const list =
    typeof args["label-ai"] === "string"
      ? args["label-ai"]
          .split(",")
          .map(s => s.trim())
          .filter(Boolean)
      : [];
  const source = typeof args.source === "string" ? args.source : "trainedAlgorithmicMedia";
  if (!list.length)
    fail("usage: node images.mjs --label-ai <file>[,<file>…] [--source trainedAlgorithmicMedia] [--yes]");
  if (!AI_SOURCES.includes(source)) fail(`--source must be one of ${AI_SOURCES.join(", ")} (got ${source}).`);
  const show = p => relative(process.cwd(), p).replace(/\\/g, "/") || ".";
  const todo = [],
    skipped = [],
    seen = new Set();
  for (const f of list) {
    const file = resolve(f),
      backup = file.slice(0, file.length - extname(file).length) + ".original" + extname(file);
    if (seen.has(file)) continue; // the same file named twice ("a.jpg,./a.jpg") is labelled once
    seen.add(file);
    if (!existsSync(file) || !statSync(file).isFile()) {
      skipped.push(`${f}: not found`);
      continue;
    }
    let out;
    try {
      out = withAiLabel(readFileSync(file), source);
    } catch (e) {
      skipped.push(`${f}: ${e.message}`);
      continue;
    }
    if (existsSync(backup)) {
      skipped.push(`${f}: ${show(backup)} already exists, so the original couldn't be kept`);
      continue;
    }
    todo.push({ file, backup, out });
  }
  console.log(
    todo.length
      ? `images: ${todo.length} file(s) to label as made with generative AI (IPTC digital source type ${source}):`
      : "images: no file here can be labelled.",
  );
  for (const t of todo) console.log(`  ${show(t.file)}`);
  if (skipped.length) console.log(`Left alone:\n${skipped.map(s => `  ${s}`).join("\n")}`);
  let failed = 0;
  if (todo.length && args.yes !== true)
    console.log(
      `\nDry run: nothing was written. With --yes each file gets the label in its XMP metadata (the image itself isn't re-encoded), and the original is kept next to it as name.original.ext.`,
    );
  else
    for (const t of todo) {
      copyFileSync(t.file, t.backup, constants.COPYFILE_EXCL);
      writeFileSync(t.file, t.out);
      const back = imageMeta(readFileSync(t.file)).sourceType;
      if (back === source) {
        console.log(`  labelled ${show(t.file)}, original kept as ${show(t.backup)}; read back: ${back}`);
        continue;
      }
      copyFileSync(t.backup, t.file); // put the original back
      failed++;
      console.log(`  couldn't label ${show(t.file)}: the label didn't read back, so the original was put back`);
    }
  if (todo.length && args.yes === true)
    console.log(
      "\nImage CDNs and optimisers often strip metadata. Run the audit again once these are live: it reads the label from the served files.",
    );
  return failed || skipped.length ? 1 : 0;
}

if (isMain(import.meta.url)) await runMain(() => main(process.argv.slice(2)));
