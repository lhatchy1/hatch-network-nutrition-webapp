// Generates placeholder PWA icons (192 and 512 PNGs) using only Node built-ins.
// Re-run with `npm run icons` after editing the design below.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BG = [16, 149, 193, 255]; // Pico primary blue
const FG = [255, 255, 255, 255];

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const png = makePng(size, drawIcon(size));
  writeFileSync(join(outDir, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}

// Simple design: rounded-corner background, white ring, "MP" monogram-ish
// rendered as two filled vertical bars (no font rendering required).
function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const corner = size * 0.19;
  const ringOuter = size * 0.42;
  const ringInner = size * 0.36;
  const barW = size * 0.05;
  const barH = size * 0.30;
  const barY0 = size * 0.36;
  const barY1 = barY0 + barH;
  const leftBars = [size * 0.40, size * 0.50];
  const rightBar = size * 0.62;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let c = [0, 0, 0, 0];

      if (insideRoundedRect(x, y, size, corner)) {
        c = BG;
        const d = Math.hypot(x - cx, y - cy);
        if (d <= ringOuter && d >= ringInner) c = FG;
        // Two left bars + one right bar (loosely "MP")
        for (const bx of leftBars) {
          if (x >= bx - barW / 2 && x <= bx + barW / 2 && y >= barY0 && y <= barY1) c = FG;
        }
        if (x >= rightBar - barW / 2 && x <= rightBar + barW / 2 && y >= barY0 && y <= barY1) c = FG;
        // Dot above right bar
        if (Math.hypot(x - rightBar, y - (barY0 - size * 0.04)) <= size * 0.025) c = FG;
      }
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
    }
  }
  return px;
}

function insideRoundedRect(x, y, size, r) {
  if (x < 0 || y < 0 || x >= size || y >= size) return false;
  if (x >= r && x <= size - r) return true;
  if (y >= r && y <= size - r) return true;
  // Corner regions: check distance from corner centre.
  const cx = x < r ? r : size - r;
  const cy = y < r ? r : size - r;
  return Math.hypot(x - cx, y - cy) <= r;
}

function makePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rowLen = 1 + size * 4;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * rowLen + 1 + x * 4;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      raw[dst + 3] = rgba[src + 3];
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
