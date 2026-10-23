// Draws the Asset Forge icon (a faceted orange gem on a dark rounded tile) and writes
// web/icon-256.png, web/icon-512.png and assets/icon.ico (16–256 px). No libraries needed.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function draw(S) {
  const px = new Uint8Array(S * S * 4);
  const ss = 4; // supersampling for smooth edges
  const tile = '#20232b', rim = '#3a3f4b';
  const facets = { top: '#ffb070', left: '#ff8a3d', right: '#e0661f', bottom: '#b8481a' };
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / S * 2 - 1, v = (y + (sy + 0.5) / ss) / S * 2 - 1;
          // rounded square tile
          const r = 0.22, q = [Math.max(Math.abs(u) - (0.94 - r), 0), Math.max(Math.abs(v) - (0.94 - r), 0)];
          const inTile = Math.hypot(q[0], q[1]) <= r;
          if (!inTile) continue;
          const edge = Math.hypot(q[0], q[1]) > r - 0.04 || Math.max(Math.abs(u), Math.abs(v)) > 0.9;
          let c = rgb(edge ? rim : tile);
          // gem: a diamond split into four facets around a light centre
          const d = Math.abs(u) / 0.62 + Math.abs(v + 0.02) / 0.74;
          if (d <= 1) {
            const inner = Math.abs(u) / 0.26 + Math.abs(v + 0.12) / 0.3 <= 1;
            const f = inner ? '#ffd9a8' : v < -0.12 ? (u < 0 ? facets.top : facets.left) : u < 0 ? facets.right : facets.bottom;
            c = rgb(d > 0.94 ? '#7a2e0e' : f);
          }
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255;
        }
      }
      const n = ss * ss, i = (y * S + x) * 4;
      const a = acc[3] / n;
      px[i] = a ? acc[0] / (acc[3] / 255) : 0;
      px[i + 1] = a ? acc[1] / (acc[3] / 255) : 0;
      px[i + 2] = a ? acc[2] / (acc[3] / 255) : 0;
      px[i + 3] = a;
    }
  }
  return encodePng(S, S, px);
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// ICO file with PNG-compressed images (supported since Windows Vista).
function encodeIco(pngs) {
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...pngs.map((p) => p.data)]);
}

fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'web', 'icon-256.png'), draw(256));
fs.writeFileSync(path.join(ROOT, 'web', 'icon-512.png'), draw(512));
fs.writeFileSync(path.join(ROOT, 'assets', 'icon.ico'), encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: draw(size) }))));
console.log('Wrote web/icon-256.png, web/icon-512.png and assets/icon.ico');
