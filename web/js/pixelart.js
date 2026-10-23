// 2D clean-up steps for sprites and icons: hard edges, limited palette, outlines.

// Make every pixel either fully opaque or fully transparent.
export function hardenAlpha(img, cutoff = 110) {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= cutoff ? 255 : 0;
}

// Reduce to a limited palette. With `palette` (hex list) those exact colours are used;
// otherwise the best `count` colours are chosen with median cut over all opaque pixels,
// so every frame of a sheet shares one palette.
// dither 0..1 adds an ordered (Bayer) pattern before snapping, so smooth shading turns
// into the classic checkered pixel-art transitions instead of hard bands.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.47);

export function quantize(img, count = 24, palette = null, dither = 0) {
  const d = img.data;
  const w = img.width;
  const pixels = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) pixels.push([d[i], d[i + 1], d[i + 2]]);
  if (!pixels.length) return [];
  const colors = palette?.length ? palette.map(hexToRgb) : medianCut(pixels, count);
  const spread = dither * Math.min(64, 255 / Math.max(2, Math.cbrt(colors.length)));
  const cache = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (spread) {
      const px = (i >> 2) % w, py = Math.floor((i >> 2) / w);
      const o = BAYER[(py & 3) * 4 + (px & 3)] * spread;
      r = clamp255(r + o); g = clamp255(g + o); b = clamp255(b + o);
    }
    const c = nearest(colors, r, g, b, cache);
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
  }
  return colors.map(toHex);
}

function nearest(colors, r, g, b, cache) {
  const key = (r << 16) | (g << 8) | b;
  let c = cache?.get(key);
  if (c) return c;
  let best = Infinity;
  for (const p of colors) {
    // weighted distance: the eye is most sensitive to green
    const dist = 2 * (p[0] - r) ** 2 + 4 * (p[1] - g) ** 2 + 3 * (p[2] - b) ** 2;
    if (dist < best) { best = dist; c = p; }
  }
  cache?.set(key, c);
  return c;
}

// Outline in a darker shade of the colour it touches ("selective outline", how pixel
// artists often do it). With a palette, the shade is snapped to the palette.
export function seloutOutline(img, palette = null, darkness = 0.45) {
  const { width: w, height: h, data: d } = img;
  const colors = palette?.length ? palette.map(hexToRgb) : null;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      const n = [x > 0 && i - 1, x < w - 1 && i + 1, y > 0 && i - w, y < h - 1 && i + w].find((j) => j !== false && solid[j]);
      if (n === undefined) continue;
      let c = [d[n * 4] * darkness, d[n * 4 + 1] * darkness, d[n * 4 + 2] * darkness * 1.1].map(clamp255);
      if (colors) c = nearest(colors, c[0], c[1], c[2]);
      d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
    }
  }
}

// Remove lonely pixels: a pixel unlike all four neighbours, while most neighbours agree,
// takes the neighbours' colour. Also fills one-pixel holes.
export function cleanupPixels(img) {
  const { width: w, height: h, data: d } = img;
  const src = new Uint8ClampedArray(d);
  const key = (i) => (src[i * 4 + 3] === 0 ? -1 : (src[i * 4] << 16) | (src[i * 4 + 1] << 8) | src[i * 4 + 2]);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const me = key(i);
      const ns = [i - 1, i + 1, i - w, i + w];
      const keys = ns.map(key);
      if (keys.includes(me)) continue;
      const counts = new Map();
      keys.forEach((k, j) => counts.set(k, [(counts.get(k)?.[0] ?? 0) + 1, ns[j]]));
      const [, [count, from]] = [...counts.entries()].sort((a, b) => b[1][0] - a[1][0])[0];
      if (count < 3) continue;
      for (let k = 0; k < 4; k++) d[i * 4 + k] = src[from * 4 + k];
    }
  }
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
const toHex = ([r, g, b]) => `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;

// One-pixel outline around opaque areas (4-neighbour), drawn into transparent pixels.
export function pixelOutline(img, hex) {
  const [r, g, b] = hexToRgb(hex);
  const { width: w, height: h, data: d } = img;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      const near = (x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w]);
      if (near) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
    }
  }
}

// Smooth outline of `width` pixels behind a picture with soft (anti-aliased) edges.
export function softOutline(img, hex, width) {
  const [r, g, b] = hexToRgb(hex);
  const { width: w, height: h, data: d } = img;
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] > 40 ? 1 : 0;
  for (let pass = 0; pass < width; pass++) {
    const next = mask.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (mask[i]) continue;
        for (let dy = -1; dy <= 1 && !next[i]; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) { next[i] = 1; break; }
          }
        }
      }
    }
    mask = next;
  }
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const a = d[i * 4 + 3] / 255;
    d[i * 4] = Math.round(d[i * 4] * a + r * (1 - a));
    d[i * 4 + 1] = Math.round(d[i * 4 + 1] * a + g * (1 - a));
    d[i * 4 + 2] = Math.round(d[i * 4 + 2] * a + b * (1 - a));
    d[i * 4 + 3] = 255;
  }
}

function medianCut(pixels, count) {
  let boxes = [pixels];
  while (boxes.length < count) {
    // split the box with the widest colour range
    let bi = -1, bestRange = -1, axis = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let a = 0; a < 3; a++) {
        let lo = 255, hi = 0;
        for (const p of box) { if (p[a] < lo) lo = p[a]; if (p[a] > hi) hi = p[a]; }
        if (hi - lo > bestRange) { bestRange = hi - lo; bi = i; axis = a; }
      }
    });
    if (bi < 0 || bestRange <= 0) break;
    const box = boxes[bi].sort((p, q) => p[axis] - q[axis]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((box) => {
    const s = [0, 0, 0];
    for (const p of box) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return s.map((v) => Math.round(v / box.length));
  });
}

function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
