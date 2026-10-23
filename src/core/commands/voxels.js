import { CommandError } from '../registry.js';
import { readSource } from './assets.js';
import { parseVox } from '../vox.js';
import { color } from './common.js';

// Voxel objects: a grid of little blocks (3D pixels). params.voxels = [[x, y, z, paletteIndex]],
// params.palette = colours, params.voxelSize = block size in metres. y is up, y = 0 rests on the ground.
export function register(registry, { z, engine }) {
  const cell = z.array(z.number().int()).length(3);
  const colored = z.tuple([z.number().int(), z.number().int(), z.number().int(), color]);
  const place = async (name, data, voxelSize, ctx) =>
    engine.execute('add_object', { type: 'voxels', name, params: { voxelSize, ...data }, material: { preset: 'matte', color: '#ffffff', roughness: 0.8 } }, ctx.meta);

  registry.define({
    name: 'edit_voxels',
    title: 'Edit voxels',
    category: 'voxels',
    mutates: true,
    description:
      'Add, remove or recolour blocks of a voxel object. add/paint = [[x, y, z, "#hex"]], remove = [[x, y, z]]. ' +
      'Coordinates are whole numbers; y is up and y = 0 is the bottom layer. Make a new voxel object with add_object { type: "voxels" }.',
    input: z.object({ id: z.string(), add: z.array(colored).optional(), remove: z.array(cell).optional(), paint: z.array(colored).optional() }),
    handler({ id, add = [], remove = [], paint = [] }) {
      const o = engine.getObject(id);
      if (o.type !== 'voxels') throw new CommandError(`"${o.name}" is not a voxel object.`);
      const map = new Map(o.params.voxels.map((v) => [`${v[0]},${v[1]},${v[2]}`, v]));
      const palette = [...o.params.palette];
      const colorIndex = (hex) => {
        let i = palette.findIndex((c) => c.toLowerCase() === hex.toLowerCase());
        if (i < 0) { if (palette.length >= 256) throw new CommandError('A voxel object can use at most 256 colours.'); palette.push(hex); i = palette.length - 1; }
        return i;
      };
      for (const [x, y, zz] of remove) map.delete(`${x},${y},${zz}`);
      for (const [x, y, zz, c] of add) map.set(`${x},${y},${zz}`, [x, y, zz, colorIndex(c)]);
      for (const [x, y, zz, c] of paint) { const v = map.get(`${x},${y},${zz}`); if (v) v[3] = colorIndex(c); }
      if (!map.size) throw new CommandError('A voxel object needs at least one block; delete the object instead.');
      o.params = { ...o.params, voxels: [...map.values()], palette };
      return { id, blocks: map.size, colors: palette.length };
    },
  });

  registry.define({
    name: 'voxels_from_image',
    title: 'Pixel sprite → 3D blocks',
    category: 'voxels',
    description:
      'Turn a pixel-art picture into a 3D voxel object: every pixel becomes a block (depth = how many blocks thick). ' +
      'Great for bringing 2D pixel items (swords, potions, coins) into a 3D game. Pictures bigger than maxSize are refused; make them small first with pixelate_image.',
    input: z.object({
      assetId: z.string(),
      voxelSize: z.number().min(0.001).max(10).optional().describe('Block size in metres, default 0.05'),
      depth: z.number().int().min(1).max(32).optional().describe('Blocks thick, default 2'),
      maxSize: z.number().int().min(8).max(256).optional().describe('Default 96'),
      name: z.string().optional(),
    }),
    async handler({ assetId, voxelSize = 0.05, depth = 2, maxSize = 96, name }, ctx) {
      const a = engine.library.images[assetId];
      if (!a) throw new CommandError(`Unknown image "${assetId}".`);
      const { width: w, height: h, rgba } = await engine.bridge.request('image_op', { op: 'rgba', file: a.file, options: {} });
      if (Math.max(w, h) > maxSize) throw new CommandError(`The picture is ${w}x${h}; that would be a lot of blocks. Use pixelate_image (size ${maxSize} or less) first.`);
      const px = Buffer.from(rgba, 'base64');
      const palette = [], index = new Map(), voxels = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (px[i + 3] < 128) continue;
          const hex = `#${[px[i], px[i + 1], px[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
          if (!index.has(hex)) {
            // voxels hold at most 256 colours: after that, use the closest colour already in use (no holes)
            if (palette.length < 256) { index.set(hex, palette.length); palette.push(hex); }
            else index.set(hex, closest(palette, px[i], px[i + 1], px[i + 2]));
          }
          for (let d = 0; d < depth; d++) voxels.push([x - Math.floor(w / 2), h - 1 - y, d - Math.floor(depth / 2), index.get(hex)]);
        }
      }
      if (!voxels.length) throw new CommandError('The picture has no solid pixels.');
      const r = await place(name ?? `${a.name}_3d`, { voxels, palette }, voxelSize, ctx);
      return { id: r.id, blocks: voxels.length };
    },
  });

  registry.define({
    name: 'import_vox',
    title: 'Import MagicaVoxel',
    category: 'voxels',
    description: 'Import a MagicaVoxel .vox model as a voxel object (editable with edit_voxels). Give exactly one of path, url or data.',
    input: z.object({ path: z.string().optional(), url: z.string().url().optional(), data: z.string().optional(), voxelSize: z.number().min(0.001).max(10).optional(), name: z.string().optional() }),
    async handler(args, ctx) {
      const { buf, name } = await readSource(args, 'vox');
      const data = parseVox(buf);
      const r = await place(args.name ?? name, data, args.voxelSize ?? 0.05, ctx);
      return { id: r.id, blocks: data.voxels.length, colors: data.palette.length };
    },
  });
}

// Index of the palette colour nearest to r, g, b.
function closest(palette, r, g, b) {
  let best = 0, bd = Infinity;
  palette.forEach((c, i) => {
    const n = parseInt(c.slice(1), 16);
    const d = ((n >> 16) - r) ** 2 + (((n >> 8) & 255) - g) ** 2 + ((n & 255) - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
