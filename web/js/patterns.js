// Generated ("procedural") materials. Every pattern is computed pixel by pixel from
// seamless noise, so textures tile without visible edges and look the same every time
// for the same seed. Output: a colour map, a roughness/metalness map and a normal map.
//
// "Tinted" patterns produce brightness only; the material colour colours them in.
// "Absolute" patterns (two colours, e.g. brick + mortar) carry their own colours.

const TAU = Math.PI * 2;

export function generatePattern(spec, size = 512) {
  const S = size;
  const n = new Noise(spec.seed ?? 1);
  const wear = clamp(spec.wear ?? 0, 0, 1);
  const variation = clamp(spec.variation ?? 0.5, 0, 1);
  const colors = (spec.colors ?? []).map(hexToRgb);
  const swap = Math.round((spec.angle ?? 0) / 90) % 2 === 1;
  const fn = PATTERNS[spec.type] ?? PATTERNS.solid;
  const sample = fn(n, { variation, colors, wear });

  const col = new Float32Array(S * S * 3);
  const rough = new Float32Array(S * S);
  const metal = new Float32Array(S * S);
  const height = new Float32Array(S * S);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let u = (x + 0.5) / S, v = 1 - (y + 0.5) / S;
      if (swap) [u, v] = [v, u];
      const p = sample(u, v);
      const i = y * S + x;
      col[i * 3] = p[0]; col[i * 3 + 1] = p[1]; col[i * 3 + 2] = p[2];
      rough[i] = p[3]; metal[i] = p[4]; height[i] = p[5];
    }
  }
  if (wear > 0) applyWear(n, S, wear, col, rough, metal, height, spec.type);

  return {
    color: toCanvas(S, (i) => [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]].map(linear01ToByte)),
    orm: toCanvas(S, (i) => [255, byte(rough[i]), byte(metal[i])]),
    normal: toCanvas(S, normalFromHeight(S, height, spec.bump ?? 1)),
  };
}

// ---- the patterns ----------------------------------------------------------------
// Each returns sample(u, v) -> [r, g, b, roughnessFactor, metalnessFactor, height], values 0..1.

const PATTERNS = {
  solid: (n) => (u, v) => {
    const f = n.fbm(u, v, 6, 6, 4);
    return grey(0.93 + f * 0.07, 0.95 + f * 0.05, 1, f * 0.2);
  },

  wood: (n, o) => woodSample(n, o, 1),

  planks: (n, o) => {
    const boards = 4;
    const wood = woodSample(n, o, 4);
    return (u, v) => {
      const row = Math.floor(v * boards);
      const offset = n.hash(row, 7);
      const uu = (u + offset) % 1;
      const p = wood(uu, (v + row * 0.37) % 1);
      const tint = 0.85 + n.hash(row, Math.floor(uu * 2) + 3) * 0.15 * (0.5 + o.variation);
      const inRow = (v * boards) % 1;
      const seamV = Math.min(inRow, 1 - inRow) * 30;
      const joint = Math.abs(((uu * 2) % 1) - 0.5) * 2;
      const seamU = (1 - joint) * 60;
      const gap = clamp(Math.min(seamV, seamU), 0, 1);
      const s = tint * (0.35 + 0.65 * gap);
      return [p[0] * s, p[1] * s, p[2] * s, p[3], 1, p[5] * gap - (1 - gap) * 0.6];
    };
  },

  metal: (n) => (u, v) => {
    const streak = n.fbm(u, v, 4, 256, 3);
    const blot = n.fbm(u, v, 3, 3, 4);
    const b = 0.86 + streak * 0.1 + blot * 0.04;
    return grey(b, 0.75 + streak * 0.25, 1, streak * 0.1);
  },

  scratched_metal: (n) => {
    const scratches = new LineField(n, 140, 0.15);
    return (u, v) => {
      const streak = n.fbm(u, v, 4, 128, 3);
      const blot = n.fbm(u, v, 4, 4, 4);
      const s = scratches.at(u, v);
      const b = 0.82 + streak * 0.08 + blot * 0.06 + s * 0.12;
      return grey(Math.min(1, b), 0.7 + blot * 0.3 - s * 0.2, 1, streak * 0.1 - s * 0.3);
    };
  },

  rust: (n, o) => {
    const metalCol = o.colors[0] ?? [0.62, 0.64, 0.67];
    const rustA = o.colors[1] ?? [0.55, 0.24, 0.09];
    const rustB = [rustA[0] * 0.55, rustA[1] * 0.5, rustA[2] * 0.45];
    const amount = 0.35 + o.variation * 0.4;
    return (u, v) => {
      const f = n.fbm(u, v, 3, 3, 6);
      const mask = smoothstep(1 - amount - 0.08, 1 - amount + 0.08, f + n.fbm(u, v, 16, 16, 3) * 0.25);
      const grain = n.fbm(u, v, 48, 48, 3);
      const r = mix3(rustB, rustA, grain);
      const streak = n.fbm(u, v, 4, 160, 2);
      const m = metalCol.map((c) => c * (0.88 + streak * 0.12));
      const c = mix3(m, r, mask);
      return [c[0], c[1], c[2], 0.45 + mask * 0.55, 1 - mask, -mask * 0.4 + grain * mask * 0.3];
    };
  },

  stone: (n, o) => (u, v) => {
    const w = n.worley(u, v, 5);
    const edge = smoothstep(0.02, 0.09, w.f2 - w.f1);
    const tint = 0.78 + n.hashId(w.id) * 0.22 * (0.4 + o.variation);
    const detail = n.fbm(u, v, 24, 24, 4);
    const b = (0.45 + 0.55 * edge) * tint * (0.85 + detail * 0.15);
    return grey(b, 0.85 + detail * 0.15, 1, edge * (0.6 + (1 - w.f1) * 0.4) + detail * 0.15);
  },

  brick: (n, o) => {
    const brick = o.colors[0] ?? [0.56, 0.22, 0.14];
    const mortar = o.colors[1] ?? [0.72, 0.69, 0.64];
    const rows = 8, perRow = 4;
    return (u, v) => {
      const row = Math.floor(v * rows);
      const bu = u * perRow + (row % 2 ? 0.5 : 0);
      const col = Math.floor(bu);
      const fu = bu - col, fv = v * rows - row;
      // distance to the nearest mortar line, measured in brick heights
      const m = Math.min(Math.min(fu, 1 - fu) * (rows / perRow), Math.min(fv, 1 - fv));
      const inBrick = smoothstep(0.05, 0.1, m);
      const id = n.hash(row, ((col % perRow) + perRow) % perRow);
      const tint = 0.78 + id * 0.3 * (0.4 + o.variation);
      const d = n.fbm(u, v, 32, 32, 4);
      const b = brick.map((c) => c * tint * (0.85 + d * 0.2));
      const mo = mortar.map((c) => c * (0.85 + d * 0.15));
      const c = mix3(mo, b, inBrick);
      return [c[0], c[1], c[2], 0.85 + d * 0.15, 0, inBrick * (0.7 + d * 0.3)];
    };
  },

  tiles: (n, o) => {
    const tile = o.colors[0] ?? [0.88, 0.88, 0.86];
    const grout = o.colors[1] ?? [0.45, 0.44, 0.42];
    const count = 4;
    return (u, v) => {
      const fu = (u * count) % 1, fv = (v * count) % 1;
      const m = Math.min(fu, 1 - fu, fv, 1 - fv);
      const inTile = smoothstep(0.02, 0.045, m);
      const id = n.hash(Math.floor(u * count), Math.floor(v * count));
      const tint = 0.92 + id * 0.08 * (0.5 + o.variation);
      const d = n.fbm(u, v, 16, 16, 3);
      const c = mix3(grout.map((x) => x * (0.9 + d * 0.1)), tile.map((x) => x * tint), inTile);
      return [c[0], c[1], c[2], 1 + (0.35 + d * 0.15 - 1) * inTile, 0, inTile * 0.8 + smoothstep(0.045, 0.1, m) * 0.2];
    };
  },

  fabric: (n) => (u, v) => {
    const N = 48;
    const a = Math.sin(u * N * TAU) * 0.5 + 0.5;
    const b = Math.sin(v * N * TAU) * 0.5 + 0.5;
    const over = (Math.floor(u * N * 2) + Math.floor(v * N * 2)) % 2;
    const thread = over ? a : b;
    const fuzz = n.fbm(u, v, 64, 64, 2);
    const blot = n.fbm(u, v, 4, 4, 3);
    const br = 0.72 + thread * 0.2 + fuzz * 0.08 - blot * 0.05;
    return grey(br, 1, 1, thread * 0.6 + fuzz * 0.2);
  },

  concrete: (n) => (u, v) => {
    const big = n.fbm(u, v, 3, 3, 5);
    const fine = n.fbm(u, v, 64, 64, 2);
    const pore = smoothstep(0.78, 0.86, n.fbm(u, v, 40, 40, 2));
    const b = (0.78 + big * 0.14 + fine * 0.08) * (1 - pore * 0.4);
    return grey(b, 0.9 + fine * 0.1, 1, big * 0.2 + fine * 0.1 - pore * 0.5);
  },

  painted: (n, o) => (u, v) => {
    const region = n.fbm(u, v, 3, 3, 3);
    const strokeA = n.fbm(u, v, 3, 24, 3);
    const strokeB = n.fbm(u, v, 24, 3, 3);
    const stroke = region > 0.5 ? strokeA : strokeB;
    const t = region * 0.6 + stroke * 0.4;
    const steps = 4;
    const q = Math.round(t * steps) / steps;
    const b = 0.68 + q * 0.32 * (0.6 + o.variation * 0.6);
    return grey(Math.min(1, b), 1, 1, stroke * 0.25);
  },
};

function woodSample(n, o, ringScale) {
  const rings = 6 * ringScale;
  return (u, v) => {
    const warp = n.fbm(u, v, 2, 4, 4) * 1.6;
    const t = v * rings + warp + n.fbm(u, v, 1, 2, 2) * 0.5;
    const ring = Math.pow(Math.abs(Math.sin(t * Math.PI)), 0.6);
    const grain = n.fbm(u, v, 4, 96, 3);
    const knot = smoothstep(0.82, 0.92, n.fbm(u, v, 3, 6, 3)) * (0.3 + o.variation * 0.5);
    const b = (0.62 + ring * 0.3 + grain * 0.12) * (1 - knot * 0.45);
    return [b, b * 0.97, b * 0.93, 0.85 + grain * 0.15, 1, ring * 0.35 + grain * 0.25 - knot * 0.3];
  };
}

// ---- wear: grime, scratches, faded colour, dents ---------------------------------

function applyWear(n, S, wear, col, rough, metal, height, type) {
  const scratches = new LineField(n.fork(91), Math.round(20 + wear * 120), 0.12);
  const metallic = type === 'metal' || type === 'scratched_metal' || type === 'rust';
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = (x + 0.5) / S, v = 1 - (y + 0.5) / S;
      const g = n.fbm(u + 0.31, v + 0.17, 4, 4, 5);
      const grime = smoothstep(0.62 - wear * 0.35, 0.82 - wear * 0.2, g) * wear;
      const s = scratches.at(u, v) * wear;
      let r = col[i * 3], gg = col[i * 3 + 1], b = col[i * 3 + 2];
      const lum = r * 0.3 + gg * 0.59 + b * 0.11;
      const fade = wear * 0.3;
      r += (lum - r) * fade; gg += (lum - gg) * fade; b += (lum - b) * fade;
      const dark = 1 - grime * 0.45;
      const scratch = metallic ? 1 + s * 0.35 : 1 - s * 0.25;
      col[i * 3] = Math.min(1, r * dark * scratch);
      col[i * 3 + 1] = Math.min(1, gg * dark * scratch * (1 - grime * 0.04));
      col[i * 3 + 2] = Math.min(1, b * dark * scratch * (1 - grime * 0.1));
      rough[i] = Math.min(1, rough[i] + grime * 0.25);
      height[i] += (n.fbm(u, v, 6, 6, 3) - 0.5) * wear * 0.3 - s * 0.3;
      if (metallic) metal[i] *= 1 - grime * 0.5;
    }
  }
}

// Thin random lines (scratches) that wrap around the texture edges.
class LineField {
  constructor(n, count, maxLen) {
    this.S = 256;
    this.mask = new Float32Array(this.S * this.S);
    const dir = n.hash(1, 2) * Math.PI;
    for (let k = 0; k < count; k++) {
      let x = n.hash(k, 11) * this.S, y = n.hash(k, 12) * this.S;
      const a = dir + (n.hash(k, 13) - 0.5) * 0.9;
      const len = (0.02 + n.hash(k, 14) * maxLen) * this.S;
      const strength = 0.4 + n.hash(k, 15) * 0.6;
      for (let t = 0; t < len; t++) {
        const xi = ((Math.round(x) % this.S) + this.S) % this.S, yi = ((Math.round(y) % this.S) + this.S) % this.S;
        const i = yi * this.S + xi;
        this.mask[i] = Math.max(this.mask[i], strength * (1 - Math.abs(t / len - 0.5) * 1.2));
        x += Math.cos(a); y += Math.sin(a);
      }
    }
  }
  at(u, v) {
    const x = Math.floor(u * this.S) % this.S, y = Math.floor(v * this.S) % this.S;
    return this.mask[y * this.S + x];
  }
}

// ---- seamless noise ------------------------------------------------------------------

class Noise {
  constructor(seed) {
    this.seed = (seed * 2654435761) >>> 0;
  }
  fork(k) {
    const f = new Noise(0);
    f.seed = (this.seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
    return f;
  }
  hash(x, y) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + this.seed) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  hashId(id) {
    return this.hash(id, 99);
  }
  // Value noise that repeats every (px, py) lattice cells.
  value(x, y, px, py) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = mod(ix, px), x1 = mod(ix + 1, px), y0 = mod(iy, py), y1 = mod(iy + 1, py);
    const a = this.hash(x0, y0), b = this.hash(x1, y0), c = this.hash(x0, y1), d = this.hash(x1, y1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  // Layered noise; frequencies are whole numbers so the result tiles seamlessly.
  fbm(u, v, fu, fv, octaves) {
    let sum = 0, amp = 0.5, norm = 0, mu = Math.max(1, Math.round(fu)), mv = Math.max(1, Math.round(fv));
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.value(u * mu, v * mv, mu, mv);
      norm += amp;
      amp *= 0.5; mu *= 2; mv *= 2;
    }
    return sum / norm;
  }
  // Cellular noise: distance to the nearest and second-nearest random point.
  worley(u, v, freq) {
    const x = u * freq, y = v * freq;
    const ix = Math.floor(x), iy = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = mod(ix + dx, freq), cy = mod(iy + dy, freq);
        const px = ix + dx + this.hash(cx, cy + 500), py = iy + dy + this.hash(cx + 500, cy);
        const d = Math.hypot(px - x, py - y);
        if (d < f1) { f2 = f1; f1 = d; id = cy * freq + cx; } else if (d < f2) f2 = d;
      }
    }
    return { f1, f2, id };
  }
}

// ---- helpers -------------------------------------------------------------------------

function normalFromHeight(S, h, bump) {
  const k = bump * S / 48;
  return (i) => {
    const x = i % S, y = (i - x) / S;
    const l = h[y * S + mod(x - 1, S)], r = h[y * S + mod(x + 1, S)];
    const up = h[mod(y - 1, S) * S + x], dn = h[mod(y + 1, S) * S + x];
    let nx = -(r - l) * k, ny = -(up - dn) * k, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    return [byte(nx / len * 0.5 + 0.5), byte(ny / len * 0.5 + 0.5), byte(nz / len * 0.5 + 0.5)];
  };
}

function toCanvas(S, pixel) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const p = pixel(i);
    img.data[i * 4] = p[0]; img.data[i * 4 + 1] = p[1]; img.data[i * 4 + 2] = p[2]; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const grey = (b, rough, metal, h) => [b, b, b, clamp(rough, 0, 1), metal, h];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mod = (a, m) => ((a % m) + m) % m;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const byte = (v) => Math.round(clamp(v, 0, 1) * 255);
// Pattern colours are authored in display (sRGB) values.
const linear01ToByte = byte;

function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
