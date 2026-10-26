// Draws the BlownSim app icon (a polished, pillowed stainless square on a
// near-black tile) as assets/icon.png. Run: node scripts/make-icon.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';

const N = 1024;
const px = Buffer.alloc(N * N * 4);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// Rounded-square signed distance (normalised coords, -1..1).
const sdBox = (x, y, r, k) => { const qx = Math.abs(x) - r + k, qy = Math.abs(y) - r + k; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - k; };

for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2 - 1, y = (j + 0.5) / N * 2 - 1;
    let col = [0, 0, 0], a = 0;
    const tile = sdBox(x, y, 0.94, 0.22);
    if (tile < 0.004) {
      a = sstep(0.004, -0.004, tile);
      col = [8, 9, 11];
      // Pillow: a squircle-ish dome; edges pinch in like a welded seam.
      const pin = 1 - 0.07 * (Math.cos(x * Math.PI) + Math.cos(y * Math.PI));
      const d = sdBox(x * pin, y * pin, 0.62, 0.14);
      if (d < 0.004) {
        const h = Math.sqrt(clamp(-d / 0.62)) ; // height 0..1
        const gx = -x * 1.1, gy = -y * 1.1;      // fake normal
        const nz = 0.35 + 0.65 * h;
        const nx = gx * (1 - h) * 1.4, ny = gy * (1 - h) * 1.4;
        const l = Math.hypot(nx, ny, nz);
        // Studio reflection: bright soft box top-left, dark floor.
        const rx = nx / l, ry = ny / l;
        let v = 0.18 + 0.55 * clamp(0.5 - 0.9 * ry - 0.5 * rx) + 0.45 * Math.pow(clamp(1 - Math.hypot(rx + 0.35, ry + 0.45) * 2.2), 2);
        v += 0.12 * Math.sin((rx * 3 + ry * 2) * 3.0) * (1 - h); // crease shimmer near the seam
        v = clamp(v);
        const m = sstep(0.004, -0.004, d);
        const c = [205 * v + 30, 210 * v + 30, 218 * v + 32];
        col = col.map((k, n) => k * (1 - m) + c[n] * m);
      }
    }
    const o = (j * N + i) * 4;
    px[o] = clamp(col[0], 0, 255); px[o + 1] = clamp(col[1], 0, 255); px[o + 2] = clamp(col[2], 0, 255); px[o + 3] = Math.round(a * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let j = 0; j < N; j++) px.copy(raw, j * (N * 4 + 1) + 1, j * N * 4, (j + 1) * N * 4);
fs.writeFileSync('assets/icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
console.log('assets/icon.png');
