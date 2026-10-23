import { CommandError } from './registry.js';

// Minimal MagicaVoxel .vox reader: the first model (SIZE + XYZI) and its palette (RGBA).
// MagicaVoxel uses Z as up; we turn that into Y up.
export function parseVox(buf) {
  if (buf.toString('ascii', 0, 4) !== 'VOX ') throw new CommandError('Not a MagicaVoxel .vox file.');
  let size = null, voxels = null, rgba = null;
  const walk = (start, end) => {
    let p = start;
    while (p + 12 <= end) {
      const id = buf.toString('ascii', p, p + 4);
      const content = buf.readUInt32LE(p + 4), children = buf.readUInt32LE(p + 8);
      const c = p + 12;
      if (id === 'SIZE' && !size) size = [buf.readUInt32LE(c), buf.readUInt32LE(c + 4), buf.readUInt32LE(c + 8)];
      if (id === 'XYZI' && !voxels) {
        const n = buf.readUInt32LE(c);
        voxels = [];
        for (let i = 0; i < n; i++) {
          const o = c + 4 + i * 4;
          voxels.push([buf[o], buf[o + 1], buf[o + 2], buf[o + 3]]);
        }
      }
      if (id === 'RGBA') {
        rgba = [];
        for (let i = 0; i < 256; i++) {
          const o = c + i * 4;
          rgba.push(`#${[buf[o], buf[o + 1], buf[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
        }
      }
      if (children) walk(c + content, c + content + children);
      p = c + content + children;
    }
  };
  walk(8, buf.length);
  if (!voxels?.length) throw new CommandError('The .vox file has no voxels.');
  // colour index i means palette entry i-1; without a palette chunk use greys
  const used = [...new Set(voxels.map((v) => v[3]))];
  const palette = used.map((ci) => rgba?.[ci - 1] ?? `#${Math.min(255, ci).toString(16).padStart(2, '0').repeat(3)}`);
  const index = new Map(used.map((ci, i) => [ci, i]));
  const sx = size?.[0] ?? Math.max(...voxels.map((v) => v[0])) + 1, sy = size?.[1] ?? Math.max(...voxels.map((v) => v[1])) + 1;
  return {
    palette,
    voxels: voxels.map(([x, y, z, ci]) => [x - Math.floor(sx / 2), z, Math.floor(sy / 2) - y, index.get(ci)]),
  };
}
