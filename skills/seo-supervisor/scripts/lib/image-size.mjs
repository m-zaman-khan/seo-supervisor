// @ts-check
// Pixel size from the first bytes of a PNG, JPEG, GIF, WebP or ICO file: { type, width, height }, or null when the
// bytes aren't one of those formats or the header is cut off. Headers only, so the first 64 KB is plenty.
export function imageSize(b) {
  const at = (s, i) => b.length >= i + s.length && b.toString("latin1", i, i + s.length) === s;
  const size = (type, width, height) => (width > 0 && height > 0 ? { type, width, height } : null);
  if (at("\x89PNG\r\n\x1a\n", 0) && at("IHDR", 12) && b.length >= 24)
    return size("png", b.readUInt32BE(16), b.readUInt32BE(20));
  if ((at("GIF87a", 0) || at("GIF89a", 0)) && b.length >= 10) return size("gif", b.readUInt16LE(6), b.readUInt16LE(8));
  // ICO: a directory of 16-byte entries, width and height one byte each (0 is 256); the largest entry counts.
  if (at("\0\0\x01\0", 0) && b.length >= 22 && b.length >= 6 + 16 * b.readUInt16LE(4)) {
    const e = Array.from({ length: b.readUInt16LE(4) }, (_, i) => [b[6 + 16 * i] || 256, b[7 + 16 * i] || 256]).sort(
      (x, y) => y[0] - x[0],
    )[0];
    return e ? size("ico", e[0], e[1]) : null;
  }
  if (at("RIFF", 0) && at("WEBP", 8)) {
    if (at("VP8X", 12) && b.length >= 30) return size("webp", 1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
    if (at("VP8 ", 12) && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)
      return size("webp", b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
    if (at("VP8L", 12) && b.length >= 25 && b[20] === 0x2f) {
      const v = b.readUInt32LE(21);
      return size("webp", (v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1);
    }
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: walk the segments to the first start-of-frame marker (C0–CF, except DHT C4, JPG C8 and DAC CC).
    for (let i = 2; i + 9 <= b.length;) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) {
        i++;
        continue;
      } // fill byte
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return size("jpeg", b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
        i += 2;
        continue;
      } // markers without a length
      if (m === 0xd9 || m === 0xda) return null; // end of image or scan data before any frame header
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

// Who made an image and how, from the first bytes of a JPEG, PNG or AVIF file: { creator, sourceType, ai, c2pa }.
// creator is XMP's dc:creator, else IIM's 2:80 By-line; sourceType is the term ending XMP's
// Iptc4xmpExt:DigitalSourceType URI (IPTC Photo Metadata Standard 2025.1). ai: one of the four terms Google reads as
// made by an algorithm. c2pa: a JUMBF box labelled "c2pa" in JPEG's APP11 segments or PNG's caBX chunk (C2PA 2.2,
// appendix A.3). WebP keeps XMP and C2PA at the end of the file, so they're rarely in the first bytes.
// https://developers.google.com/search/docs/appearance/structured-data/image-license-metadata
export const AI_SOURCES = [
  "trainedAlgorithmicMedia",
  "compositeWithTrainedAlgorithmicMedia",
  "compositeSynthetic",
  "algorithmicMedia",
];
export function imageMeta(b) {
  const s = b.toString("latin1"),
    x0 = s.indexOf("<x:xmpmeta"),
    x1 = s.indexOf("</x:xmpmeta>", x0);
  const xmp = x0 >= 0 && x1 > x0 ? b.toString("utf8", x0, x1) : "";
  const dst =
    /:DigitalSourceType\s*=\s*"([^"]+)"|:DigitalSourceType\b[^>]*?rdf:resource\s*=\s*"([^"]+)"|:DigitalSourceType\s*>\s*([^<\s]+)\s*</.exec(
      xmp,
    );
  const sourceType = dst ? (dst[1] || dst[2] || dst[3]).replace(/^.*\//, "") : null;
  const i = s.indexOf("\x1c\x02\x50"),
    byline =
      i >= 0 && i + 5 <= b.length
        ? b.toString("utf8", i + 5, Math.min(b.length, i + 5 + b.readUInt16BE(i + 3))).trim()
        : "";
  const creator = /<dc:creator\b[^>]*>[\s\S]*?<rdf:li\b[^>]*>([^<]+)</.exec(xmp)?.[1].trim() || byline || null;
  return { creator, sourceType, ai: AI_SOURCES.includes(sourceType), c2pa: /jumd[\s\S]{17}c2pa/.test(s) };
}
