import { hardenAlpha, quantize, pixelOutline } from './pixelart.js';

// Picture operations that run in the browser (the engine asks for them through the bridge).

export async function imageOp(op, file, options) {
  const img = await loadImage(`/library/images/${file}`);
  let canvas = toCanvas(img, img.width, img.height);
  if (op === 'remove_background') removeBackground(canvas, options.tolerance ?? 0.12);
  else if (op === 'seamless') canvas = seamless(canvas, options.blend ?? 0.25);
  else if (op === 'pixelate') canvas = pixelate(canvas, options);
  else throw new Error(`Unknown image operation ${op}`);
  return { png: canvas.toDataURL('image/png').split(',')[1] };
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
  const ref = [0, 1, 2].map((k) => border.reduce((a, i) => a + d[i * 4 + k], 0) / border.length);
  const limit = tolerance * 441;
  const near = (i) => Math.hypot(d[i * 4] - ref[0], d[i * 4 + 1] - ref[1], d[i * 4 + 2] - ref[2]) <= limit;
  const seen = new Uint8Array(w * h);
  const stack = border.filter(near);
  for (const i of stack) seen[i] = 1;
  while (stack.length) {
    const i = stack.pop();
    d[i * 4 + 3] = 0;
    const x = i % w, y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j >= 0 && !seen[j] && near(j)) { seen[j] = 1; stack.push(j); }
    }
  }
  // soften the cut edge by one pixel
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3] === 0) continue;
    const x = i % w, y = (i - x) / w;
    const clear = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => {
      const xx = x + dx, yy = y + dy;
      return xx >= 0 && yy >= 0 && xx < w && yy < h && d[(yy * w + xx) * 4 + 3] === 0;
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
    const band = size * blend;
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
