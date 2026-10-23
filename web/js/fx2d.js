import { quantize } from './pixelart.js';

// Pixel-art effects and parallax backgrounds, drawn straight in 2D (no 3D needed).
// Everything is deterministic for a given seed. Looping effects wrap seamlessly.

const RAMPS = {
  explosion: ['#fffbe0', '#ffe066', '#ff9a2e', '#e8442c', '#8a2a2a', '#4a3a3a', '#2c2a30'],
  fire: ['#fff6c8', '#ffd84d', '#ff9426', '#e04424', '#8c2424'],
  smoke: ['#d8d8dc', '#b4b4bc', '#8c8c98', '#686876', '#4a4a56'],
  magic: ['#ffffff', '#f3c4ff', '#c27dff', '#8a4dff', '#4b2ca8'],
  sparks: ['#ffffff', '#fff3a0', '#ffc840', '#ff8a20'],
  glitter: ['#ffffff', '#fff6b0', '#ffe066', '#ffc22e'],
  heal: ['#ffffff', '#c8ffd0', '#6ef08a', '#2fb85a', '#1d7a44'],
  lightning: ['#ffffff', '#e0f4ff', '#9fd8ff', '#4a9cff', '#2a4ad0'],
};

export const EFFECTS = {
  explosion: { loop: false, frames: 10 },
  fire: { loop: true, frames: 8 },
  smoke: { loop: true, frames: 10 },
  magic: { loop: true, frames: 10 },
  sparks: { loop: false, frames: 6 },
  glitter: { loop: true, frames: 8 },
  heal: { loop: true, frames: 10 },
  lightning: { loop: false, frames: 6 },
};

export function renderEffect({ type = 'fire', frames, size = 64, seed = 1, color = null, palette = null, colors = 12 }) {
  const n = frames ?? EFFECTS[type]?.frames ?? 8;
  const ramp = color ? tintRamp(RAMPS[type] ?? RAMPS.fire, color) : RAMPS[type] ?? RAMPS.fire;
  const sheet = document.createElement('canvas');
  sheet.width = size * n;
  sheet.height = size;
  const ctx = sheet.getContext('2d', { willReadFrequently: true });
  const rand = rng(seed);
  const draw = DRAW[type] ?? DRAW.fire;
  const state = draw.setup?.(rand, size, n) ?? null;
  for (let f = 0; f < n; f++) {
    const frame = new Pixels(size);
    draw.frame(frame, { t: f / n, f, n, size, ramp, rand: rng(seed * 31 + f), state });
    frame.blit(ctx, f * size, 0);
  }
  if (palette?.length || colors) {
    const img = ctx.getImageData(0, 0, sheet.width, sheet.height);
    quantize(img, colors, palette);
    ctx.putImageData(img, 0, 0);
  }
  return { png: sheet.toDataURL('image/png').split(',')[1], meta: { frameSize: size, rows: 1, columns: n, rowNames: [type], loop: !!EFFECTS[type]?.loop, fps: 12 } };
}

// ---- the effects ------------------------------------------------------------------------

const DRAW = {
  explosion: {
    setup: (rand, S) => ({
      bits: Array.from({ length: 40 }, () => ({ a: rand() * Math.PI * 2, v: 0.25 + rand() * 0.6, r: 1 + rand() * 2.5 })),
      sparks: Array.from({ length: 18 }, () => ({ a: rand() * Math.PI * 2, v: 0.5 + rand() * 0.5 })),
    }),
    frame(p, { t, size: S, ramp, state }) {
      const c = S / 2;
      const grow = Math.min(1, t * 2.2);
      // fireball: hot core early, then cooling smoke puffs drifting up
      for (const b of state.bits) {
        const d = b.v * grow * S * 0.38;
        const x = c + Math.cos(b.a) * d, y = c + Math.sin(b.a) * d - t * t * S * 0.15;
        const heat = Math.min(ramp.length - 1, Math.floor(t * ramp.length * 1.1 + b.v * 1.5));
        const r = b.r * (1 + t * 2.2) * S / 64 * (1 - Math.max(0, t - 0.75) * 2.5);
        if (r > 0.3) p.disc(x, y, r, ramp[heat]);
      }
      if (t < 0.35) p.disc(c, c, (0.12 + t) * S * 0.45, ramp[Math.floor(t * 6)]);
      if (t > 0.05 && t < 0.4) p.ring(c, c, t * S * 1.2, Math.max(1, S / 48), ramp[1]);
      for (const s of state.sparks) {
        if (t > 0.6) break;
        const d = s.v * t * S * 0.9;
        p.dot(c + Math.cos(s.a) * d, c + Math.sin(s.a) * d + t * t * S * 0.3, ramp[t < 0.3 ? 0 : 1]);
      }
    },
  },
  fire: {
    setup: (rand, S, n) => ({ parts: Array.from({ length: 34 }, () => ({ s: rand(), x: (rand() - 0.5) * 0.5, life: 0.5 + rand() * 0.5, r: 0.06 + rand() * 0.07, sway: rand() * 6 })) }),
    frame(p, { t, size: S, ramp, state }) {
      loopParticles(state.parts, t, (q, age) => {
        const k = age / q.life;
        const x = S / 2 + (q.x * (1 - k) + Math.sin(q.sway + k * 5) * 0.06) * S;
        const y = S * 0.92 - k * S * 0.75;
        const r = q.r * S * (1 - k * 0.8);
        p.disc(x, y, r, ramp[Math.min(ramp.length - 1, Math.floor(k * ramp.length))]);
      });
    },
  },
  smoke: {
    setup: (rand) => ({ parts: Array.from({ length: 16 }, () => ({ s: rand(), x: (rand() - 0.5) * 0.3, life: 0.8 + rand() * 0.2, r: 0.08 + rand() * 0.06, drift: (rand() - 0.5) * 0.3 })) }),
    frame(p, { t, size: S, ramp, state }) {
      loopParticles(state.parts, t, (q, age) => {
        const k = age / q.life;
        const x = S / 2 + (q.x + q.drift * k) * S, y = S * 0.95 - k * S * 0.85;
        const r = q.r * S * (0.6 + k * 1.4);
        if (k < 0.92) p.disc(x, y, r, ramp[Math.min(ramp.length - 1, Math.floor(k * ramp.length))], k > 0.6 ? 0.5 : 1);
      });
    },
  },
  magic: {
    setup: (rand) => ({ parts: Array.from({ length: 22 }, () => ({ s: rand(), a: rand() * Math.PI * 2, life: 0.6 + rand() * 0.4, rad: 0.15 + rand() * 0.2 })) }),
    frame(p, { t, size: S, ramp, state }) {
      p.ring(S / 2, S * 0.82, S * 0.3, 1, ramp[3], 0.55);
      loopParticles(state.parts, t, (q, age) => {
        const k = age / q.life;
        const a = q.a + k * Math.PI * 3;
        const x = S / 2 + Math.cos(a) * q.rad * S * (1 - k * 0.5), y = S * 0.82 - k * S * 0.65 + Math.sin(a) * q.rad * S * 0.25;
        const c = ramp[Math.min(ramp.length - 1, Math.floor(k * ramp.length))];
        if (k < 0.15 || (k > 0.5 && k < 0.6)) p.star(x, y, c); else p.dot(x, y, c);
      });
    },
  },
  sparks: {
    setup: (rand) => ({ parts: Array.from({ length: 16 }, () => ({ a: rand() * Math.PI * 2, v: 0.6 + rand() * 0.5 })) }),
    frame(p, { t, size: S, ramp, state }) {
      const c = S / 2;
      if (t < 0.2) p.star(c, c, ramp[0], Math.max(2, S / 10));
      for (const q of state.parts) {
        const d1 = q.v * t * S * 0.45, d0 = Math.max(0, d1 - S * 0.12 * (1 - t));
        p.line(c + Math.cos(q.a) * d0, c + Math.sin(q.a) * d0, c + Math.cos(q.a) * d1, c + Math.sin(q.a) * d1, ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))]);
      }
    },
  },
  glitter: {
    setup: (rand) => ({ parts: Array.from({ length: 14 }, () => ({ s: rand(), x: 0.1 + rand() * 0.8, y: 0.1 + rand() * 0.8, life: 0.3 + rand() * 0.3 })) }),
    frame(p, { t, size: S, ramp, state }) {
      loopParticles(state.parts, t, (q, age) => {
        const k = age / q.life;
        const c = ramp[Math.min(ramp.length - 1, Math.floor(Math.abs(k - 0.5) * 2 * ramp.length))];
        if (k > 0.3 && k < 0.7) p.star(q.x * S, q.y * S, c, Math.max(2, S / 20)); else p.dot(q.x * S, q.y * S, c);
      });
    },
  },
  heal: {
    setup: (rand) => ({ parts: Array.from({ length: 10 }, () => ({ s: rand(), x: 0.2 + rand() * 0.6, life: 0.7 + rand() * 0.3 })) }),
    frame(p, { t, size: S, ramp, state }) {
      p.ring(S / 2, S * 0.85, S * 0.32, 1, ramp[2], 0.6);
      loopParticles(state.parts, t, (q, age) => {
        const k = age / q.life;
        p.plus(q.x * S, S * 0.85 - k * S * 0.7, Math.max(1, Math.round(S / 24)), ramp[Math.min(ramp.length - 1, Math.floor(k * ramp.length))]);
      });
    },
  },
  lightning: {
    frame(p, { f, n, size: S, ramp, rand }) {
      if (f >= n - 1) return;
      let x = S / 2 + (rand() - 0.5) * S * 0.2, y = 0;
      const col = f < 2 ? ramp[0] : ramp[Math.min(ramp.length - 1, f)];
      while (y < S) {
        const nx = x + (rand() - 0.5) * S * 0.25, ny = y + S * (0.08 + rand() * 0.08);
        p.line(x, y, nx, ny, col);
        p.line(x + 1, y, nx + 1, ny, ramp[2]);
        if (rand() < 0.25) p.line(nx, ny, nx + (rand() - 0.5) * S * 0.3, ny + S * 0.12, ramp[3]);
        x = nx; y = ny;
      }
    },
  },
};

// Particles live on a loop: each has a start time s (0..1) and a lifetime; at time t
// every particle is drawn at its age modulo the loop, so the last frame flows into the first.
function loopParticles(parts, t, drawOne) {
  for (const q of parts) {
    for (let k = 0; k < 2; k++) {
      const age = ((t - q.s + 1) % 1) + k;
      if (age < q.life) drawOne(q, age);
    }
  }
}

// ---- parallax backgrounds -----------------------------------------------------------------

const SKIES = {
  day: { sky: ['#5fa8e8', '#9fd0f5', '#d8f0ff'], far: '#8fb4d0', mid: '#5a8a6a', near: '#3d6a45', ground: '#2f5235', light: '#fff4c0' },
  sunset: { sky: ['#3b2a5c', '#c2577a', '#ffb070'], far: '#7a4f78', mid: '#523a5e', near: '#35263f', ground: '#24192c', light: '#ffd27a' },
  night: { sky: ['#05070f', '#141d3a', '#26355e'], far: '#26304f', mid: '#1b233b', near: '#121828', ground: '#0b0f1a', light: '#f2f0d8' },
};

export function renderParallax({ theme = 'mountains', time = 'day', width = 320, height = 180, seed = 1, palette = null, colors = 24 }) {
  const c = SKIES[time] ?? SKIES.day;
  const rand = rng(seed);
  const layers = [];
  const layer = () => { const p = new Pixels(width, height); layers.push(p); return p; };

  // sky: a vertical gradient through the sky colours, with a fine 4x4 dither between steps
  const sky = layer();
  const steps = 6;
  const shades = [];
  for (let i = 0; i <= (c.sky.length - 1) * steps; i++) {
    const k = i / steps, j = Math.min(c.sky.length - 2, Math.floor(k));
    shades.push(mix(c.sky[j], c.sky[j + 1], k - j));
  }
  for (let y = 0; y < height; y++) {
    const pos = (y / (height * 0.85)) * (shades.length - 1);
    for (let x = 0; x < width; x++) {
      const d = BAYER4[(y & 3) * 4 + (x & 3)];
      sky.set(x, y, shades[Math.max(0, Math.min(shades.length - 1, Math.floor(pos + d)))]);
    }
  }
  if (time === 'night') for (let i = 0; i < width / 6; i++) sky.set(Math.floor(rand() * width), Math.floor(rand() * height * 0.6), rand() < 0.2 ? '#ffffff' : '#9fb0d8');
  sky.disc(width * 0.78, height * (time === 'sunset' ? 0.55 : 0.22), height * 0.08, c.light);

  // a zigzag of about `period` pixels that fits the width a whole number of times, so layers tile without a jump
  const saw = (x, period) => {
    const n = Math.max(1, Math.round(width / period));
    return Math.abs(((x * n / width) % 1) * 2 - 1);
  };
  const ridge = (p, base, amp, freq, col, jag = 0) => {
    const h = periodic1d(rng(seed + base * 100), width, freq);
    for (let x = 0; x < width; x++) {
      const top = Math.round(height * base - h(x) * height * amp - (jag ? saw(x, 13) * 6 * jag : 0));
      for (let y = Math.max(0, top); y < height; y++) p.set(x, y, col);
    }
  };
  if (theme === 'mountains') {
    // peaks: overlapping triangles that wrap around, with a lit side and snow caps
    const p = layer();
    const peaks = Array.from({ length: 7 }, () => ({ x: rand() * width, h: height * (0.25 + rand() * 0.3), w: width * (0.12 + rand() * 0.1) }));
    const lit = mix(c.far, c.light, 0.25), snow = mix(c.far, '#ffffff', 0.7);
    for (let x = 0; x < width; x++) {
      let best = 0, side = 0, peakH = 0;
      for (const pk of peaks) {
        for (const o of [-width, 0, width]) {
          const dx = x - (pk.x + o);
          const hgt = pk.h * (1 - Math.abs(dx) / pk.w);
          if (hgt > best) { best = hgt; side = dx < 0 ? 1 : 0; peakH = pk.h; }
        }
      }
      const base = height * 0.72;
      const top = Math.round(base - best);
      // snow covers the upper part of each peak, with a slightly ragged lower edge
      const snowLine = base - peakH * 0.72 + Math.round(saw(x, 7) * 6) - 3;
      for (let y = Math.max(0, top); y < height; y++) p.set(x, y, y < snowLine ? snow : side ? lit : c.far);
    }
  }
  if (theme === 'forest') ridge(layer(), 0.62, 0.22, 3, c.far);
  if (theme === 'city') {
    const p = layer();
    let x = 0;
    while (x < width) {
      const w = 10 + Math.floor(rand() * 18), h = height * (0.2 + rand() * 0.35);
      const ww = Math.min(w, width - x);
      p.rect(x, height - h, ww, h, c.far);
      for (let wy = height - h + 4; wy < height - 6; wy += 6) for (let wx = x + 2; wx < x + ww - 2; wx += 4) if (rand() < (time === 'night' ? 0.45 : 0.15)) p.rect(wx, wy, 2, 3, time === 'night' ? '#ffd86a' : mix(c.far, '#ffffff', 0.35));
      x += ww + 1 + Math.floor(rand() * 3);
    }
  }
  if (theme === 'clouds' || theme === 'mountains') {
    const p = layer();
    // flat clouds: a few overlapping squashed puffs on a flat bottom
    const cloud = mix(c.sky[c.sky.length - 1], '#ffffff', time === 'night' ? 0.05 : 0.55);
    const shadow = mix(cloud, c.sky[0], 0.25);
    for (let i = 0; i < 5; i++) {
      const cx = rand() * width, cy = height * (0.1 + rand() * 0.25), w = width * (0.07 + rand() * 0.08);
      for (let k = 0; k < 6; k++) {
        const px = cx + (rand() - 0.5) * w * 1.6, r = w * (0.25 + rand() * 0.2);
        p.ellipseWrap(px, cy - r * 0.2, r, r * 0.5, cloud, cy + w * 0.12, shadow);
      }
    }
  }
  // middle hills, with trees for forest
  const mid = layer();
  ridge(mid, 0.78, 0.14, 4, c.mid);
  if (theme === 'forest') {
    const h = periodic1d(rng(seed + 78), width, 4);
    for (let x = 0; x < width; x += 5 + Math.floor(rand() * 5)) {
      const base = Math.round(height * 0.78 - h(x) * height * 0.14), th = 12 + rand() * 18;
      for (let k = 0; k < th; k++) { const half = Math.round((k / th) * 5); for (let dx = -half; dx <= half; dx++) mid.set((x + dx + width) % width, Math.round(base - th + k), c.mid); }
    }
  }
  // near ground
  const near = layer();
  ridge(near, 0.92, 0.06, 6, c.near);
  for (let x = 0; x < width; x++) for (let y = Math.round(height * 0.97); y < height; y++) near.set(x, y, c.ground);

  // limited palette across all layers
  const out = layers.map((p) => p.toCanvas());
  if (palette?.length || colors) {
    const strip = document.createElement('canvas');
    strip.width = width; strip.height = height * out.length;
    const sctx = strip.getContext('2d', { willReadFrequently: true });
    out.forEach((cv, i) => sctx.drawImage(cv, 0, i * height));
    const img = sctx.getImageData(0, 0, width, strip.height);
    quantize(img, colors, palette);
    sctx.putImageData(img, 0, 0);
    out.forEach((cv, i) => { const x = cv.getContext('2d'); x.clearRect(0, 0, width, height); x.drawImage(strip, 0, -i * height); });
  }
  const preview = document.createElement('canvas');
  preview.width = width; preview.height = height;
  for (const cv of out) preview.getContext('2d').drawImage(cv, 0, 0);
  return {
    layers: out.map((cv) => cv.toDataURL('image/png').split(',')[1]),
    preview: preview.toDataURL('image/png').split(',')[1],
    // back layers scroll slower; the sky stays put
    meta: { width, height, layers: out.length, scrollSpeeds: out.map((_, i) => Math.round((i / Math.max(1, out.length - 1)) * 100) / 100) },
  };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16);

// ---- tiny pixel canvas ------------------------------------------------------------------------

class Pixels {
  constructor(w, h = w) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  set(x, y, hex, alpha = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b] = rgb(hex), i = (y * this.w + x) * 4;
    if (alpha < 1 && ((x + y) & 1)) return; // dithered transparency
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = 255;
  }
  get(x, y) { return this.d[(y * this.w + x) * 4 + 3]; }
  dot(x, y, c) { this.set(x, y, c); }
  disc(cx, cy, r, c, alpha = 1) { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, c, alpha); }
  discWrap(cx, cy, r, c) { for (const o of [-this.w, 0, this.w]) this.disc(cx + o, cy, r, c); }
  // ellipse cut off flat at `floor`, with the lower band in a shadow colour
  ellipseWrap(cx, cy, rx, ry, c, floor, shade) {
    for (const o of [-this.w, 0, this.w]) {
      for (let y = Math.floor(cy - ry); y <= Math.min(cy + ry, floor); y++) {
        for (let x = Math.floor(cx + o - rx); x <= cx + o + rx; x++) {
          if (((x - cx - o) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.set(x, y, y > floor - ry * 0.35 ? shade : c);
        }
      }
    }
  }
  ring(cx, cy, r, w, c, alpha = 1) { for (let y = Math.floor(cy - r - w); y <= cy + r + w; y++) for (let x = Math.floor(cx - r - w); x <= cx + r + w; x++) { const d = Math.hypot(x - cx, (y - cy) * (alpha < 1 ? 2.5 : 1)); if (Math.abs(d - r) <= w / 2 + 0.3) this.set(x, y, c, alpha); } }
  rect(x, y, w, h, c) { for (let j = Math.floor(y); j < y + h; j++) for (let i = Math.floor(x); i < x + w; i++) this.set(i, j, c); }
  line(x0, y0, x1, y1, c) { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0))); for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c); }
  star(x, y, c, s = 2) { this.set(x, y, c); for (let k = 1; k <= s; k++) { this.set(x + k, y, c); this.set(x - k, y, c); this.set(x, y + k, c); this.set(x, y - k, c); } }
  plus(x, y, s, c) { for (let k = -s * 2; k <= s * 2; k++) for (let t = -Math.floor(s / 2); t <= Math.floor(s / 2); t++) { this.set(x + k, y + t, c); this.set(x + t, y + k, c); } }
  blit(ctx, ox, oy) { const img = new ImageData(this.d, this.w, this.h); ctx.putImageData(img, ox, oy); }
  toCanvas() { const c = document.createElement('canvas'); c.width = this.w; c.height = this.h; this.blit(c.getContext('2d'), 0, 0); return c; }
}

function periodic1d(rand, period, freq) {
  const pts = Array.from({ length: freq * 4 }, () => rand());
  return (x) => {
    const u = ((x / period) * pts.length) % pts.length;
    const i = Math.floor(u), f = u - i, s = f * f * (3 - 2 * f);
    const a = pts[i % pts.length], b = pts[(i + 1) % pts.length];
    const coarse = a + (b - a) * s;
    const j = (Math.floor(u * 3) % pts.length), g = u * 3 - Math.floor(u * 3);
    const fine = pts[j] + (pts[(j + 1) % pts.length] - pts[j]) * g * g * (3 - 2 * g);
    return coarse * 0.8 + fine * 0.2;
  };
}

function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function rgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mix(a, b, t) { const x = rgb(a), y = rgb(b); return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`; }

// Shift a colour ramp towards a target hue while keeping its brightness steps.
function tintRamp(ramp, target) {
  const [tr, tg, tb] = rgb(target);
  return ramp.map((hex, i) => {
    const [r, g, b] = rgb(hex);
    const lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
    const tl = (tr * 0.3 + tg * 0.59 + tb * 0.11) / 255 || 1;
    const k = i === 0 ? 0.35 : 1;
    return mix(hex, `#${[tr, tg, tb].map((v) => Math.min(255, Math.round((v * lum) / tl)).toString(16).padStart(2, '0')).join('')}`, k);
  });
}
