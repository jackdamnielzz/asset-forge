import fs from 'node:fs/promises';
import path from 'node:path';
import { safeName } from '../engine.js';
import { CommandError } from '../registry.js';
import { PATTERNS } from '../../shared/presets.js';
import { PALETTES, resolvePalette } from '../../shared/palettes.js';
import { color } from './common.js';
import { storeImage } from './assets.js';
import { exportDir, godotDir } from './game.js';

export function register(registry, { z, engine }) {
  const terrain = z.object({
    name: z.string().optional(),
    type: z.enum(Object.keys(PATTERNS)).describe('Pattern: grass, dirt, sand, water, stone, planks, brick, tiles, concrete...'),
    colors: z.array(color).max(2).optional(),
    seed: z.number().int().optional(),
  });

  registry.define({
    name: 'make_tileset',
    title: 'Make pixel tileset',
    category: 'game',
    description:
      'Generate a seamless pixel-art tileset where one ground type (overlay, e.g. grass) blends into another (base, e.g. dirt): 16 tiles covering every corner combination, ' +
      'so any map paints without seams. Saves a 4x4 tile atlas. With project (a Godot 4 project folder) it also writes a TileSet .tres with terrains set up ' +
      '("match corners"), so you can paint with the terrain tool. Adds the atlas to the image library and returns it so you can look at it.',
    input: z.object({
      base: terrain.optional().describe('Default dirt'),
      overlay: terrain.optional().describe('Default grass'),
      tileSize: z.number().int().min(8).max(128).optional().describe('Pixels per tile, default 16'),
      palette: z.union([z.string(), z.array(color)]).optional().describe('Palette name (see list_palettes) or colours'),
      colors: z.number().int().min(2).max(64).optional().describe('Number of colours when no palette is given (default 16)'),
      edge: z.boolean().optional().describe('Dark rim where the two grounds meet (default true)'),
      roughness: z.number().min(0).max(1).optional().describe('How wobbly the border between the grounds is (default 0.35)'),
      seed: z.number().int().optional(),
      filename: z.string(),
      project: z.string().optional(),
      folder: z.string().optional().describe('Folder inside the Godot project, default "assets/forge/tiles"'),
    }),
    async handler(args) {
      const base = { type: 'dirt', ...args.base };
      const overlay = { type: 'grass', ...args.overlay };
      base.name = args.base?.name ?? base.type;
      overlay.name = args.overlay?.name ?? overlay.type;
      const palette = args.palette ? resolvePalette(args.palette) : null;
      if (args.palette && !palette) throw new CommandError(`Unknown palette "${args.palette}". Choose: ${Object.keys(PALETTES).join(', ')}`);
      const out = await engine.bridge.request('render_tileset', {
        base, overlay, tileSize: args.tileSize ?? 16, palette, colors: args.colors ?? 16, edge: args.edge ?? true, roughness: args.roughness ?? 0.35, seed: args.seed ?? 1,
      });
      const folder = args.folder ?? 'assets/forge/tiles';
      const dir = args.project ? await godotDir(args.project, folder) : await exportDir(engine, 'tiles');
      const name = safeName(args.filename);
      const files = { atlas: path.join(dir, `${name}.png`) };
      const buf = Buffer.from(out.png, 'base64');
      await fs.writeFile(files.atlas, buf);
      await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ ...out.meta, base: base.name, overlay: overlay.name }, null, 2));
      if (args.project) {
        files.tileset = path.join(dir, `${name}.tres`);
        const res = `res://${folder.replace(/\\/g, '/').replace(/^\/|\/$/g, '')}/${name}.png`;
        await fs.writeFile(files.tileset, tileSetTres(res, out.meta.tileSize, base.name, overlay.name));
      }
      const asset = await storeImage(engine, buf, name, { madeFrom: { tileset: { base: base.name, overlay: overlay.name } } });
      return { image: out.png, mime: 'image/png', assetId: asset.id, files, ...out.meta };
    },
  });
}

// Godot 4 TileSet with one "match corners" terrain set: terrain 0 = base, 1 = overlay.
function tileSetTres(texturePath, T, baseName, overlayName) {
  const lines = [];
  for (let bits = 0; bits < 16; bits++) {
    const x = bits % 4, y = Math.floor(bits / 4);
    const corner = (b) => (bits & b ? 1 : 0);
    const count = [1, 2, 4, 8].filter((b) => bits & b).length;
    lines.push(
      `${x}:${y}/0 = 0`,
      `${x}:${y}/0/terrain_set = 0`,
      `${x}:${y}/0/terrain = ${count >= 2 ? 1 : 0}`,
      `${x}:${y}/0/terrains_peering_bit/top_left_corner = ${corner(1)}`,
      `${x}:${y}/0/terrains_peering_bit/top_right_corner = ${corner(2)}`,
      `${x}:${y}/0/terrains_peering_bit/bottom_left_corner = ${corner(4)}`,
      `${x}:${y}/0/terrains_peering_bit/bottom_right_corner = ${corner(8)}`,
    );
  }
  return `[gd_resource type="TileSet" load_steps=3 format=3]

[ext_resource type="Texture2D" path="${texturePath}" id="1_atlas"]

[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_forge"]
texture = ExtResource("1_atlas")
texture_region_size = Vector2i(${T}, ${T})
${lines.join('\n')}

[resource]
tile_size = Vector2i(${T}, ${T})
terrain_set_0/mode = 1
terrain_set_0/terrain_0/name = "${baseName}"
terrain_set_0/terrain_0/color = Color(0.6, 0.42, 0.25, 1)
terrain_set_0/terrain_1/name = "${overlayName}"
terrain_set_0/terrain_1/color = Color(0.35, 0.7, 0.3, 1)
sources/0 = SubResource("TileSetAtlasSource_forge")
`;
}
