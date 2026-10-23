import { CommandError } from './registry.js';

const MAX_VOXELS = 200_000; // the same limit as voxel objects

// Minimal MagicaVoxel .vox reader: the first model (SIZE + XYZI) and its palette (RGBA).
// MagicaVoxel uses Z as up; we turn that into Y up.
// Every size in the file is checked against the real file, so a broken file gives an error, not a crash.
export function parseVox(buf) {
  if (buf.length < 8 || buf.toString('ascii', 0, 4) !== 'VOX ') throw new CommandError('Not a MagicaVoxel .vox file.');
  const broken = () => new CommandError('The .vox file is damaged (a part is longer than the file).');
  let size = null, voxels = null, rgba = null;
  const walk = (start, end, depth) => {
    if (depth > 64) throw broken();
    let p = start;
    while (p + 12 <= end) {
      const id = buf.toString('ascii', p, p + 4);
      const content = buf.readUInt32LE(p + 4), children = buf.readUInt32LE(p + 8);
      const c = p + 12;
      if (c + content + children > end) throw broken();
      if (id === 'SIZE' && !size) {
        if (content < 12) throw broken();
        size = [buf.readUInt32LE(c), buf.readUInt32LE(c + 4), buf.readUInt32LE(c + 8)];
      }
      if (id === 'XYZI' && !voxels) {
        if (content < 4) throw broken();
        const n = buf.readUInt32LE(c);
        if (4 + n * 4 > content) throw broken();
        if (n > MAX_VOXELS) throw new CommandError(`The .vox model has ${n} voxels; the most Asset Forge takes is ${MAX_VOXELS}.`);
        voxels = [];
        for (let i = 0; i < n; i++) {
          const o = c + 4 + i * 4;
          voxels.push([buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]);
        }
      }
      if (id === 'RGBA') {
        if (content < 1024) throw broken();
        rgba = [];
        for (let i = 0; i < 256; i++) {
          const o = c + i * 4;
          rgba.push(`#${[buf[o], buf[o + 1], buf[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
        }
      }
      if (children) walk(c + content, c + content + children, depth + 1);
      p = c + content + children;
    }
  };
  walk(8, buf.length, 0);
  if (!voxels?.length) throw new CommandError('The .vox file has no voxels.');
  // colour index i means palette entry i-1; without a palette chunk use greys
  const used = [...new Set(voxels.map((v) => v[3]))];
  const palette = used.map((ci) => rgba?.[ci - 1] ?? `#${Math.min(255, ci).toString(16).padStart(2, '0').repeat(3)}`);
  const index = new Map(used.map((ci, i) => [ci, i]));
  const most = (axis) => voxels.reduce((m, v) => Math.max(m, v[axis]), 0) + 1;
  const sx = size?.[0] ?? most(0), sy = size?.[1] ?? most(1);
  return {
    palette,
    voxels: voxels.map(([x, y, z, ci]) => [x - Math.floor(sx / 2), z, Math.floor(sy / 2) - y, index.get(ci)]),
  };
}
