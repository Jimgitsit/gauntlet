// Renders web/public/apple-touch-icon.png from the plates in web/src/mark.ts:
// the same armored fist the sidebar draws. Self-contained rasterizer with
// analytic anti-aliasing and a hand-rolled PNG encoder, no native deps.
// Run: bun tools/gen-icon.ts

import { deflateSync } from "node:zlib";
import { PLATES, TILE, type Plate } from "../web/src/mark";

const SIZE = 180;
const SCALE = SIZE / 24;
const OUT = new URL("../web/public/apple-touch-icon.png", import.meta.url);

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// Coverage of a rounded rectangle at pixel (px, py), 1px anti-aliased edge.
// The rectangle may be rotated about its centre.
function plateCoverage(px: number, py: number, p: Plate): number {
  const cx = (p.x + p.w / 2) * SCALE;
  const cy = (p.y + p.h / 2) * SCALE;
  let dx = px + 0.5 - cx;
  let dy = py + 0.5 - cy;
  if (p.rot) {
    const a = (-p.rot * Math.PI) / 180;
    const rx = dx * Math.cos(a) - dy * Math.sin(a);
    const ry = dx * Math.sin(a) + dy * Math.cos(a);
    dx = rx;
    dy = ry;
  }
  const hw = (p.w / 2) * SCALE;
  const hh = (p.h / 2) * SCALE;
  const r = p.r * SCALE;
  const qx = Math.abs(dx) - hw + r;
  const qy = Math.abs(dy) - hh + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  const d = outside + inside - r;
  return clamp(0.5 - d, 0, 1);
}

const bg = hex(TILE);
const buf = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const col: RGB = [bg[0], bg[1], bg[2]];
    for (const p of PLATES) {
      const cov = plateCoverage(px, py, p);
      if (cov > 0) {
        const c = hex(p.fill);
        for (let i = 0; i < 3; i++) {
          col[i] = mix(col[i], c[i], cov);
        }
      }
    }
    const o = (py * SIZE + px) * 4;
    buf[o] = Math.round(col[0]);
    buf[o + 1] = Math.round(col[1]);
    buf[o + 2] = Math.round(col[2]);
    buf[o + 3] = 255;
  }
}

// ---- minimal PNG (truecolor + alpha) ----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) {
    c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  buf.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = deflateSync(raw);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
await Bun.write(OUT, png);
console.log(`wrote ${OUT.pathname} (${png.length} bytes, ${SIZE}x${SIZE})`);
