import { hardenAlpha, quantize, pixelOutline } from './pixelart.js';

// Picture operations that run in the browser (the engine asks for them through the bridge).

export async function imageOp(op, file, options) {
  const img = await loadImage(`/library/images/${file}`);
  let canvas = toCanvas(img, img.width, img.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = () => ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (op === 'remove_background') removeBackground(canvas, options.tolerance ?? 0.12);
  else if (op === 'seamless') canvas = seamless(canvas, options.blend ?? 0.25);
  else if (op === 'pixelate') canvas = pixelate(canvas, options);
  else if (op === 'recolor') { const img = data(); recolor(img, options.map); ctx.putImageData(img, 0, 0); }
  else if (op === 'hue') { const img = data(); hueShift(img, options.degrees ?? 0, options.saturation ?? 1); ctx.putImageData(img, 0, 0); }
  else if (op === 'paint') { const img = data(); paint(img, options); ctx.putImageData(img, 0, 0); }
  else if (op === 'extract_palette') return { colors: extractPalette(data(), options.count ?? 16) };
  else if (op === 'analyze') return analyze(data(), options);
  else if (op === 'rgba') { const img = data(); return { width: img.width, height: img.height, rgba: bytesToBase64(img.data) }; }
  else throw new Error(`Unknown image operation ${op}`);
  return { png: canvas.toDataURL('image/png').split(',')[1] };
}

// ---- colour tools ----------------------------------------------------------------------

// Exact colour swaps: { "#from": "#to" }.
function recolor(img, map) {
  const lut = new Map(Object.entries(map).map(([a, b]) => [hexKey(a), rgbOf(b)]));
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const to = lut.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    if (to) { d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2]; }
  }
}

function hueShift(img, degrees, sat) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const [r, g, b] = hslToRgb((h + degrees / 360 + 1) % 1, Math.min(1, s * sat), l);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
}

// Set single pixels and flood-fill areas: { pixels: [[x, y, "#hex" | null]], fills: [[x, y, "#hex" | null]] }.
function paint(img, { pixels = [], fills = [] }) {
  const { width: w, height: h, data: d } = img;
  const put = (i, c) => { if (c === null) { d[i * 4 + 3] = 0; return; } const [r, g, b] = rgbOf(c); d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; };
  for (const [x, y, c] of pixels) if (x >= 0 && y >= 0 && x < w && y < h) put(y * w + x, c);
  for (const [x, y, c] of fills) {
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const start = y * w + x;
    const key = (i) => (d[i * 4 + 3] === 0 ? -1 : (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2]);
    const target = key(start);
    const seen = new Uint8Array(w * h);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop();
      put(i, c);
      const px = i % w, py = (i - px) / w;
      for (const j of [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && key(j) === target) { seen[j] = 1; stack.push(j); }
      }
    }
  }
}

function extractPalette(img, count) {
  const copy = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  // let quantize pick the colours, then sort them from dark to light
  return quantize(copy, count).sort((a, b) => lum(a) - lum(b));
}

// Numbers for the pixel style check.
function analyze(img, { palette = null }) {
  const { width: w, height: h, data: d } = img;
  const colors = new Set();
  let semi = 0, offPalette = 0, lonely = 0;
  const pal = palette?.length ? new Set(palette.map((c) => hexKey(c))) : null;
  const key = (i) => (d[i * 4 + 3] === 0 ? -1 : (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2]);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3];
    if (!a) continue;
    if (a < 255) semi++;
    const k = key(i);
    colors.add(k);
    if (pal && !pal.has(k)) offPalette++;
    const x = i % w, y = (i - x) / w;
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
      const ns = [key(i - 1), key(i + 1), key(i - w), key(i + w)];
      if (!ns.includes(k) && ns.every((n) => n === ns[0])) lonely++;
    }
  }
  return { width: w, height: h, colorCount: colors.size, semiTransparent: semi, offPalette, lonelyPixels: lonely };
}

const hexKey = (hex) => parseInt(String(hex).replace('#', ''), 16);
const rgbOf = (hex) => { const n = hexKey(hex); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = (hex) => { const [r, g, b] = rgbOf(hex); return r * 0.3 + g * 0.59 + b * 0.11; };

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (!s) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Evenly spaced frames from a video, laid out side by side.
export async function videoFrames({ file, frames = 8, frameSize = 96, start = 0, end, pixelArt, colors, palette, removeBackground: cut }) {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = `/library/videos/${file}`;
  await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = () => rej(new Error('This browser cannot play the video.')); });
  const stop = Math.min(end ?? video.duration, video.duration);
  const s = frameSize / Math.max(video.videoWidth, video.videoHeight);
  const fw = Math.max(1, Math.round(video.videoWidth * s)), fh = Math.max(1, Math.round(video.videoHeight * s));
  const sheet = document.createElement('canvas');
  sheet.width = fw * frames;
  sheet.height = fh;
  const ctx = sheet.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  for (let i = 0; i < frames; i++) {
    video.currentTime = start + ((stop - start) * i) / frames;
    await new Promise((res) => { video.onseeked = res; });
    const frame = toCanvas(video, fw, fh);
    if (cut) removeBackground(frame, 0.15);
    ctx.drawImage(frame, i * fw, 0);
  }
  let usedPalette = null;
  if (pixelArt) {
    const data = ctx.getImageData(0, 0, sheet.width, sheet.height);
    hardenAlpha(data);
    usedPalette = quantize(data, colors ?? 24, palette);
    ctx.putImageData(data, 0, 0);
  }
  return {
    png: sheet.toDataURL('image/png').split(',')[1],
    meta: { frameWidth: fw, frameHeight: fh, rows: 1, columns: frames, fps: Math.round((frames / Math.max(0.01, stop - start)) * 100) / 100, palette: usedPalette },
  };
}

// Flood fill from the borders: pixels similar to the border colour become transparent.
export function removeBackground(canvas, tolerance) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  // the background colour comes from the visible border pixels only; already see-through pixels
  // (stored as black) would otherwise make dark outlines look like background
  const visible = border.filter((i) => d[i * 4 + 3] > 0);
  if (!visible.length) return;
  const ref = [0, 1, 2].map((k) => visible.reduce((a, i) => a + d[i * 4 + k], 0) / visible.length);
  const limit = tolerance * 441;
  const near = (i) => d[i * 4 + 3] === 0 || Math.hypot(d[i * 4] - ref[0], d[i * 4 + 1] - ref[1], d[i * 4 + 2] - ref[2]) <= limit;
  const seen = new Uint8Array(w * h);
  const cleared = new Uint8Array(w * h);
  const stack = border.filter(near);
  for (const i of stack) seen[i] = 1;
  while (stack.length) {
    const i = stack.pop();
    if (d[i * 4 + 3] > 0) cleared[i] = 1;
    d[i * 4 + 3] = 0;
    const x = i % w, y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !seen[j] && near(j)) { seen[j] = 1; stack.push(j); }
    }
  }
  // soften the new cut edge by one pixel (edges that were already see-through stay as they were)
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3] === 0) continue;
    const x = i % w, y = (i - x) / w;
    const clear = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => {
      const xx = x + dx, yy = y + dy;
      return xx >= 0 && yy >= 0 && xx < w && yy < h && cleared[yy * w + xx];
    });
    if (clear) d[i * 4 + 3] = 160;
  }
  ctx.putImageData(img, 0, 0);
}

// Make a picture tile: per axis, blend it with a half-shifted copy near the edges, so
// the left/right (then top/bottom) borders continue into each other.
export function seamless(canvas, blend) {
  const pass = (src, horizontal) => {
    const w = src.width, h = src.height;
    const shifted = document.createElement('canvas');
    shifted.width = w; shifted.height = h;
    const sc = shifted.getContext('2d');
    const half = horizontal ? Math.floor(w / 2) : Math.floor(h / 2);
    if (horizontal) { sc.drawImage(src, -half, 0); sc.drawImage(src, w - half, 0); } else { sc.drawImage(src, 0, -half); sc.drawImage(src, 0, h - half); }
    const a = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    const b = sc.getImageData(0, 0, w, h);
    const size = horizontal ? w : h;
    const band = Math.max(1, size * blend); // blend 0 would divide by zero
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = horizontal ? x : y;
        const dist = Math.min(p, size - 1 - p);
        const t = Math.min(1, dist / band); // 0 at the edge (use shifted copy), 1 inside (original)
        const m = t * t * (3 - 2 * t);
        const i = (y * w + x) * 4;
        for (let k = 0; k < 4; k++) a.data[i + k] = a.data[i + k] * m + b.data[i + k] * (1 - m);
      }
    }
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d').putImageData(a, 0, 0);
    return out;
  };
  return pass(pass(canvas, true), false);
}

export function pixelate(canvas, { size = 64, colors = 16, palette = null, outline = null }) {
  const s = Math.min(1, size / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * s)), h = Math.max(1, Math.round(canvas.height * s));
  // average down in steps for a cleaner result than one big jump
  let src = canvas;
  while (src.width / 2 > w) src = toCanvas(src, Math.round(src.width / 2), Math.round(src.height / 2));
  const out = toCanvas(src, w, h);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  hardenAlpha(img);
  quantize(img, colors, palette);
  if (outline) pixelOutline(img, outline);
  ctx.putImageData(img, 0, 0);
  return out;
}

function toCanvas(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${src}`));
    img.src = src;
  });
}
