import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Builders for the more advanced shape types: spin (lathe), extrude, text, rock and
// image cut-outs. All of them return a BufferGeometry with position, normal and uv.

export function latheGeometry(p, lowpoly) {
  const pts = p.points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  return new THREE.LatheGeometry(pts, lowpoly ? Math.min(p.segments, 10) : p.segments);
}

export function extrudeGeometry(p) {
  const shape = new THREE.Shape(p.points.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of p.holes ?? []) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const opts = extrudeOptions(p.depth, p.bevel, p.bevelSegments);
  const g = new THREE.ExtrudeGeometry(shape, opts);
  g.translate(0, 0, -opts.depth / 2); // the bevel adds the same amount on both sides, so this centres it
  return g;
}

export function textGeometry(p, font) {
  if (!font) return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  const g = new TextGeometry(p.text, {
    font, size: p.size, depth: p.depth, curveSegments: 8,
    bevelEnabled: p.bevel > 0, bevelThickness: p.bevel, bevelSize: p.bevel * 0.6, bevelSegments: 3,
  });
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  return g;
}

// A lumpy stone: a subdivided ball pushed in and out by 3D noise, with a flat bottom.
export function rockGeometry(p) {
  let g = new THREE.IcosahedronGeometry(1, p.detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const n = noise3(p.seed);
  const v = new THREE.Vector3();
  const floor = -(1 - p.flatten);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const big = n.fbm(v.x * 1.3 + 3, v.y * 1.3, v.z * 1.3, 3);
    const small = n.fbm(v.x * 4, v.y * 4 + 7, v.z * 4, 2);
    const d = 1 + (big - 0.5) * 2 * p.roughness + (small - 0.5) * p.roughness * 0.5;
    v.multiplyScalar(d);
    v.y *= 1 - p.flatten * 0.3;
    if (v.y < floor) v.y = floor + (v.y - floor) * 0.08;
    pos.setXYZ(i, v.x * p.radius, v.y * p.radius, v.z * p.radius);
  }
  if (p.sharpness > 0.5) g = g.toNonIndexed();
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

// Image cut-out: the outline of the picture, extruded, with the picture on the front.
export function cutoutGeometry(p, loops) {
  const w = p.width, h = p.height;
  const shapes = loopsToShapes(loops, w, h);
  if (!shapes.length) return new THREE.PlaneGeometry(w, h);
  const uvGen = {
    generateTopUV: (geo, v, a, b, c) => [a, b, c].map((i) => new THREE.Vector2(v[i * 3] / w + 0.5, v[i * 3 + 1] / h + 0.5)),
    generateSideWallUV: (geo, v, a, b, c, d) => [a, b, c, d].map((i) => new THREE.Vector2(v[i * 3] / w + 0.5, v[i * 3 + 1] / h + 0.5)),
  };
  const opts = extrudeOptions(p.depth, p.bevel, 2);
  const g = new THREE.ExtrudeGeometry(shapes, { ...opts, UVGenerator: uvGen, curveSegments: 1 });
  g.translate(0, 0, -opts.depth / 2);
  return g;
}

function extrudeOptions(depth, bevel, segments) {
  const b = Math.min(bevel, depth / 2.5);
  return { depth: Math.max(0.0001, depth - 2 * Math.max(0, b)), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: Math.max(1, Math.round(segments)), curveSegments: 16, steps: 1 };
}

// ---- image outline tracing ----------------------------------------------------------

// Returns closed outlines in 0..1 image coordinates (y down) of the solid part of an image.
// Transparent pictures use their transparency; others are compared to the corner colour.
export function traceImage(img, threshold = 0.5) {
  const max = 220;
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const W = Math.max(2, Math.round(img.width * s)), H = Math.max(2, Math.round(img.height * s));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;

  let transparent = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) transparent++;
  const useAlpha = transparent > W * H * 0.02;
  const corners = [0, W - 1, (H - 1) * W, H * W - 1].map((i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
  const bg = [0, 1, 2].map((k) => corners.reduce((a, cc) => a + cc[k], 0) / 4);
  const solidAt = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const i = (y * W + x) * 4;
    if (useAlpha) return d[i + 3] / 255 > threshold ? 1 : 0;
    const dist = Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]) / 441;
    return dist > threshold * 0.3 ? 1 : 0;
  };

  // marching squares over a grid padded by one empty cell on every side
  const segs = [];
  const key = (x2, y2) => x2 * 100000 + y2;
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const tl = solidAt(x, y), tr = solidAt(x + 1, y), br = solidAt(x + 1, y + 1), bl = solidAt(x, y + 1);
      const cs = tl * 8 + tr * 4 + br * 2 + bl;
      if (cs === 0 || cs === 15) continue;
      const T = [2 * x + 1, 2 * y], R = [2 * x + 2, 2 * y + 1], B = [2 * x + 1, 2 * y + 2], L = [2 * x, 2 * y + 1];
      const table = {
        1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[T, R]], 5: [[T, R], [L, B]], 6: [[T, B]], 7: [[T, L]],
        8: [[T, L]], 9: [[T, B]], 10: [[L, T], [B, R]], 11: [[T, R]], 12: [[L, R]], 13: [[B, R]], 14: [[L, B]],
      };
      for (const sg of table[cs]) segs.push(sg);
    }
  }
  const byPoint = new Map();
  segs.forEach((sg, i) => {
    for (const pt of sg) {
      const k = key(pt[0], pt[1]);
      if (!byPoint.has(k)) byPoint.set(k, []);
      byPoint.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop = [segs[i][0]];
    let cur = segs[i][1];
    for (let guard = 0; guard < segs.length; guard++) {
      loop.push(cur);
      const next = byPoint.get(key(cur[0], cur[1])).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      const sg = segs[next];
      cur = sg[0][0] === cur[0] && sg[0][1] === cur[1] ? sg[1] : sg[0];
    }
    if (loop.length > 6) {
      const pts = loop.map(([x2, y2]) => [x2 / 2, y2 / 2]);
      const smooth = chaikin(simplify(pts, 0.35));
      const area = Math.abs(signedArea(smooth));
      if (area > W * H * 0.0008) loops.push(simplify(smooth, 0.5).map(([x, y]) => [x / W, y / H]));
    }
  }
  return loops;
}

function loopsToShapes(loops, w, h) {
  const pts = loops.map((l) => l.map(([u, v]) => new THREE.Vector2((u - 0.5) * w, (0.5 - v) * h)));
  const depth = pts.map((l, i) => pts.filter((o, j) => j !== i && inside(l[0], o)).length);
  const shapes = [];
  pts.forEach((l, i) => {
    if (depth[i] % 2) return;
    const shape = new THREE.Shape(l);
    pts.forEach((hole, j) => {
      if (depth[j] === depth[i] + 1 && inside(hole[0], l)) shape.holes.push(new THREE.Path(hole));
    });
    shapes.push(shape);
  });
  return shapes;
}

function inside(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// Ramer–Douglas–Peucker for a closed loop.
function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  const rdp = (s, e, out) => {
    let maxD = 0, idx = -1;
    const [x1, y1] = pts[s], [x2, y2] = pts[e];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = pts[i];
      const dd = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / len;
      if (dd > maxD) { maxD = dd; idx = i; }
    }
    if (maxD > eps) { rdp(s, idx, out); rdp(idx, e, out); } else out.push(pts[s]);
  };
  const mid = Math.floor(pts.length / 2);
  const out = [];
  rdp(0, mid, out);
  rdp(mid, pts.length - 1, out);
  return out;
}

function chaikin(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    out.push([x1 * 0.75 + x2 * 0.25, y1 * 0.75 + y2 * 0.25], [x1 * 0.25 + x2 * 0.75, y1 * 0.25 + y2 * 0.75]);
  }
  return out;
}

// ---- 3D value noise for rocks ------------------------------------------------------

function noise3(seed) {
  const s = (seed * 2654435761) >>> 0;
  const hash = (x, y, z) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + s) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const value = (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const f = (t) => t * t * (3 - 2 * t);
    const fx = f(x - ix), fy = f(y - iy), fz = f(z - iz);
    const l = (a, b, t) => a + (b - a) * t;
    const c = (dx, dy, dz) => hash(ix + dx, iy + dy, iz + dz);
    return l(
      l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
      l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
  };
  return {
    fbm(x, y, z, oct) {
      let sum = 0, amp = 0.5, norm = 0, f = 1;
      for (let o = 0; o < oct; o++) { sum += amp * value(x * f, y * f, z * f); norm += amp; amp *= 0.5; f *= 2; }
      return sum / norm;
    },
  };
}
