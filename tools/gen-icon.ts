// Renders web/public/apple-touch-icon.png for Gauntlet: three repo "lanes"
// (the dashboard's signature element) on the dark surface. Self-contained:
// analytic anti-aliasing plus a hand-rolled PNG encoder, no native deps.
// Run: bun tools/gen-icon.ts

import { deflateSync } from "node:zlib";

const SIZE = 180;
const OUT = new URL("../web/public/apple-touch-icon.png", import.meta.url);

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// Dark-mode status palette from web/src/styles.css.
const BG = hex("#15181D");
const BLOCKED = hex("#D9483F");
const HUMAN = hex("#8E78E6");
const READY = hex("#35A063");
const AUTHOR = hex("#C9841C");

// Coverage of an axis-aligned rounded rectangle, 1px anti-aliased edge.
function roundedRect(px: number, py: number, x: number, y: number, w: number, h: number, r: number): number {
  const cx = clamp(px + 0.5, x + r, x + w - r);
  const cy = clamp(py + 0.5, y + r, y + h - r);
  const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) - r;
  return clamp(0.5 - d, 0, 1);
}

interface Segment {
  color: RGB;
  share: number;
}

// Each lane: total width as a share of the drawable width, then its segments.
const LANES: { width: number; segments: Segment[] }[] = [
  { width: 1, segments: [{ color: BLOCKED, share: 0.22 }, { color: HUMAN, share: 0.3 }, { color: READY, share: 0.48 }] },
  { width: 0.72, segments: [{ color: HUMAN, share: 0.35 }, { color: AUTHOR, share: 0.25 }, { color: READY, share: 0.4 }] },
  { width: 0.5, segments: [{ color: BLOCKED, share: 0.3 }, { color: READY, share: 0.7 }] },
];

const PAD = 34;
const LANE_H = 24;
const GAP_Y = 20;
const GAP_X = 3;
const RADIUS = 6;
const drawable = SIZE - PAD * 2;
const totalH = LANES.length * LANE_H + (LANES.length - 1) * GAP_Y;
const top = (SIZE - totalH) / 2;

const buf = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const col: RGB = [BG[0], BG[1], BG[2]];
    LANES.forEach((lane, li) => {
      const y = top + li * (LANE_H + GAP_Y);
      const laneW = drawable * lane.width;
      let x = PAD;
      for (const seg of lane.segments) {
        const w = laneW * seg.share - GAP_X;
        const cov = roundedRect(px, py, x, y, w, LANE_H, RADIUS);
        if (cov > 0) {
          for (let i = 0; i < 3; i++) {
            col[i] = mix(col[i], seg.color[i], cov);
          }
        }
        x += laneW * seg.share;
      }
    });
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
