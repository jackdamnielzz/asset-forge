import { generatePattern } from './patterns.js';
import { quantize } from './pixelart.js';

// Pixel-art tileset with corner-based transitions between two ground types.
// 16 tiles cover every combination of the four corners (terrain A or B). Tiles that share
// corners also share edges exactly, so any arrangement joins without seams.
// Tile index bits: 1 = top-left, 2 = top-right, 4 = bottom-left, 8 = bottom-right corner is B.
export async function renderTileset({ base, overlay, tileSize = 16, palette = null, colors = 16, edge = true, roughness = 0.35, seed = 1 }) {
  const T = tileSize;
  const texture = (t, s) => {
    // generate big, then average down: smoother pixels than generating tiny
    const big = generatePattern({ type: t.type, colors: t.colors ?? null, seed: t.seed ?? s, variation: 0.5, wear: 0, bump: 0 }, T * 4).color;
    const small = document.createElement('canvas');
    small.width = small.height = T;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(big, 0, 0, T, T);
    return ctx.getImageData(0, 0, T, T).data;
  };
  const A = texture(base, seed), B = texture(overlay, seed + 7);

  const atlas = document.createElement('canvas');
  atlas.width = atlas.height = T * 4;
  const ctx = atlas.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(T * 4, T * 4);
  const noise = periodicNoise(seed, T);

  // mask > 0.5 means terrain B; only depends on the corner flags and on noise that repeats per tile
  const maskAt = (bits, x, y) => {
    const u = Math.min(1, Math.max(0, (x + 0.5) / T)), v = Math.min(1, Math.max(0, (y + 0.5) / T));
    const tl = bits & 1 ? 1 : 0, tr = bits & 2 ? 1 : 0, bl = bits & 4 ? 1 : 0, br = bits & 8 ? 1 : 0;
    const s = (t) => t * t * (3 - 2 * t);
    const top = tl + (tr - tl) * s(u), bottom = bl + (br - bl) * s(u);
    const m = top + (bottom - top) * s(v);
    return m + (noise(x, y) - 0.5) * roughness * 2;
  };

  for (let bits = 0; bits < 16; bits++) {
    const ox = (bits % 4) * T, oy = Math.floor(bits / 4) * T;
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const isB = maskAt(bits, x, y) > 0.5;
        const src = isB ? B : A;
        const si = (y * T + x) * 4;
        let r = src[si], g = src[si + 1], b = src[si + 2];
        // darker rim where A meets B: reads as a little step up onto the other ground
        if (edge && !isB && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => maskAt(bits, x + dx, y + dy) > 0.5)) {
          r *= 0.62; g *= 0.62; b *= 0.66;
        }
        const di = ((oy + y) * T * 4 + ox + x) * 4;
        img.data[di] = r; img.data[di + 1] = g; img.data[di + 2] = b; img.data[di + 3] = 255;
      }
    }
  }
  // no pixel clean-up here: it would look across tile borders in the atlas and break the seams
  const usedPalette = quantize(img, colors, palette);
  ctx.putImageData(img, 0, 0);
  return {
    png: atlas.toDataURL('image/png').split(',')[1],
    meta: { tileSize: T, columns: 4, rows: 4, bits: 'index = 1*topLeft + 2*topRight + 4*bottomLeft + 8*bottomRight (1 = overlay terrain)', palette: usedPalette },
  };
}

// Smooth noise that repeats every `period` pixels in x and y.
function periodicNoise(seed, period) {
  const cells = Math.max(2, Math.round(period / 4));
  const hash = (x, y) => {
    let h = (Math.imul(((x % cells) + cells) % cells, 374761393) + Math.imul(((y % cells) + cells) % cells, 668265263) + seed * 2654435761) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (px, py) => {
    const x = (px / period) * cells, y = (py / period) * cells;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
