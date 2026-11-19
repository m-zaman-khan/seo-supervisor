// Pixel size from the first bytes of a PNG, JPEG, GIF or WebP file: { type, width, height }, or null when the
// bytes aren't one of those formats or the header is cut off. Headers only, so the first 64 KB is plenty.
export function imageSize(b) {
  const at = (s, i) => b.length >= i + s.length && b.toString("latin1", i, i + s.length) === s;
  const size = (type, width, height) => (width > 0 && height > 0 ? { type, width, height } : null);
  if (at("\x89PNG\r\n\x1a\n", 0) && at("IHDR", 12) && b.length >= 24)
    return size("png", b.readUInt32BE(16), b.readUInt32BE(20));
  if ((at("GIF87a", 0) || at("GIF89a", 0)) && b.length >= 10) return size("gif", b.readUInt16LE(6), b.readUInt16LE(8));
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
