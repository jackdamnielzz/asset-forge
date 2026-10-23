import fs from 'node:fs/promises';
import path from 'node:path';
import { safeName } from '../engine.js';
import { CommandError } from '../registry.js';
import { color } from './common.js';
import { VIEWS } from './render.js';
import { PALETTES, resolvePalette } from '../../shared/palettes.js';

const COLLISION = ['box', 'convex', 'mesh', 'none'];

export function register(registry, { z, engine }) {
  const collision = z.enum(COLLISION).optional()
    .describe('Collision shape for Godot: box (fast, default), convex (wraps the shape), mesh (exact, for static level parts), none');

  // Top-level, visible, non-cutter objects: "the assets" in a scene.
  const topLevel = (parent = null) => engine.scene.order
    .map((id) => engine.scene.objects[id])
    .filter((o) => (o.parent ?? null) === parent && o.visible !== false && !o.cutterFor);

  registry.define({
    name: 'make_icons',
    title: 'Make icons',
    category: 'game',
    description:
      'Render inventory/UI icons: one square PNG per object, all with the same angle, light and framing, ' +
      'transparent background and an optional outline. Default: every top-level object in the scene. Files go to exports/<folder>/.',
    input: z.object({
      ids: z.array(z.string()).optional(),
      size: z.number().int().min(16).max(2048).optional().describe('Pixels, default 256'),
      view: z.enum(VIEWS).optional(),
      background: color.optional().describe('Default "transparent"'),
      outline: color.nullable().optional().describe('Outline colour around the icon, null for none (default dark grey)'),
      outlineWidth: z.number().int().min(1).max(16).optional(),
      padding: z.number().min(0).max(0.5).optional().describe('Empty border, fraction of the size (default 0.06)'),
      folder: z.string().optional().describe('Default "icons"'),
    }),
    async handler(args) {
      const targets = args.ids?.map((id) => engine.getObject(id)) ?? topLevel();
      if (!targets.length) throw new CommandError('Nothing to make icons of.');
      const dir = await exportDir(engine, args.folder ?? 'icons');
      const size = args.size ?? 256;
      const files = [];
      const names = fileNames(targets);
      for (const o of targets) {
        const out = await engine.render({
          view: args.view ?? 'iso', width: size, height: size, target: o.id, isolate: true, ground: false,
          background: args.background ?? 'transparent', padding: args.padding ?? 0.06,
          outline: args.outline === null ? null : { color: args.outline ?? '#1b1c20', width: args.outlineWidth ?? Math.max(1, Math.round(size / 96)) },
        });
        const file = path.join(dir, `${names.get(o.id)}.png`);
        await fs.writeFile(file, Buffer.from(out.png, 'base64'));
        files.push(file);
      }
      return { files };
    },
  });

  registry.define({
    name: 'render_sprites',
    title: 'Render sprite sheet',
    category: 'game',
    description:
      'Turn a 3D object into a 2D sprite sheet for 2D games. Rows = directions (1, 4 or 8; row 0 = facing the viewer/down, ' +
      'then down-left, left, up-left, up, up-right, right, down-right for 8), repeated per animation when several are given; columns = frames. ' +
      'pixelArt gives crisp pixels with a limited palette (a named palette like "pico8" or "endesga32", or a colour list), optional dithering, ' +
      'clean-up and an outline (solid, or "selout" = darker shade of the touching colour). maps ["normal", "emission"] also writes a normal map ' +
      '(for Godot 2D lights) and a glow map. pixelsPerMetre keeps several assets at the same scale. ' +
      'With project (a Godot project folder) the files go there plus a SpriteFrames .tres for AnimatedSprite2D. Returns the sheet so you can look at it.',
    input: z.object({
      target: z.string().optional().describe('Object or group id; default the whole scene'),
      filename: z.string(),
      directions: z.union([z.literal(1), z.literal(4), z.literal(8)]).optional().describe('Default 8'),
      frameSize: z.number().int().min(8).max(1024).optional().describe('Pixels per frame, default 64'),
      animation: z.string().optional().describe('One animation to sample (see list_animations)'),
      animations: z.array(z.string()).optional().describe('Several animations in one sheet, e.g. ["idle", "walk", "attack"]'),
      frames: z.number().int().min(1).max(64).optional().describe('Frames per direction when animated, default 8'),
      elevation: z.number().min(0).max(90).optional().describe('Camera angle above the ground: 0 = side view, 30 = classic 2:1 isometric (default), 60+ = top-down'),
      azimuthOffset: z.number().optional().describe('Turn the camera around the object first, in degrees (45 gives diamond-shaped isometric tiles)'),
      pixelsPerMetre: z.number().min(1).max(2048).optional().describe('Fixed scale (e.g. 32); default fits the object in the frame'),
      pixelArt: z.boolean().optional().describe('Default true'),
      colors: z.number().int().min(2).max(256).optional().describe('Palette size when no palette is given, default 24'),
      palette: z.union([z.string(), z.array(color)]).optional(),
      dither: z.number().min(0).max(1).optional().describe('Checkered shading between colours, 0 = none (default), 0.5 = subtle, 1 = strong'),
      outline: color.nullable().optional().describe('Outline colour for the solid style, null for no outline (default dark)'),
      outlineStyle: z.enum(['solid', 'selout']).optional(),
      cleanup: z.boolean().optional().describe('Remove lonely stray pixels (default true)'),
      maps: z.array(z.enum(['normal', 'emission'])).optional(),
      groundShadow: z.boolean().optional().describe('Keep the soft shadow under the object (default false)'),
      project: z.string().optional().describe('Godot project folder: write the sprites there with a SpriteFrames .tres'),
      folder: z.string().optional().describe('Folder inside the Godot project, default "assets/forge/sprites"'),
    }),
    async handler(args) {
      if (args.target) engine.getObject(args.target);
      const names = args.animations ?? (args.animation ? [args.animation] : []);
      for (const n of names) if (!engine.scene.animations?.[n]) throw new CommandError(`No animation "${n}". Existing: ${Object.keys(engine.scene.animations ?? {}).join(', ') || '(none)'}`);
      // without an explicit palette, an active house style's palette is used
      const palette = args.palette ? resolvePalette(args.palette) : engine.scene.environment.housePalette ?? null;
      if (args.palette && !palette) throw new CommandError(`Unknown palette "${args.palette}". Choose: ${Object.keys(PALETTES).join(', ')}`);
      const out = await engine.bridge.request('render_sprites', {
        target: args.target, directions: args.directions ?? 8, frameSize: args.frameSize ?? 64,
        animations: names, frames: names.length ? args.frames ?? 8 : 1, elevation: args.elevation ?? 30, azimuthOffset: args.azimuthOffset ?? 0,
        pixelsPerMetre: args.pixelsPerMetre ?? null, pixelArt: args.pixelArt ?? true, colors: args.colors ?? 24, palette,
        dither: args.dither ?? 0, outline: args.outline === undefined ? '#16171b' : args.outline, outlineStyle: args.outlineStyle ?? 'solid',
        cleanup: args.cleanup ?? true, maps: args.maps ?? [], groundShadow: !!args.groundShadow,
      });
      const folder = args.folder ?? 'assets/forge/sprites';
      const dir = args.project ? await godotDir(args.project, folder) : await exportDir(engine, 'sprites');
      const name = safeName(args.filename);
      const base = path.join(dir, name);
      const files = { color: `${base}.png` };
      await fs.writeFile(files.color, Buffer.from(out.png, 'base64'));
      for (const kind of ['normal', 'emission']) {
        if (!out[kind]) continue;
        files[kind] = `${base}_${kind}.png`;
        await fs.writeFile(files[kind], Buffer.from(out[kind], 'base64'));
      }
      await fs.writeFile(`${base}.json`, JSON.stringify(out.meta, null, 2));
      if (args.project) {
        const res = `res://${folder.replace(/\\/g, '/').replace(/^\/|\/$/g, '')}`;
        files.spriteFrames = `${base}.tres`;
        await fs.writeFile(files.spriteFrames, spriteFramesTres(out.meta, `${res}/${name}.png`, out.normal ? `${res}/${name}_normal.png` : null));
      }
      return { image: out.png, mime: 'image/png', files, ...out.meta };
    },
  });

  registry.define({
    name: 'export_godot',
    title: 'Export to Godot',
    category: 'game',
    description:
      'Export an object (or the scene) as a .glb straight into a Godot 4 project, with a collision shape and animations. ' +
      'Godot imports it automatically when its editor gets focus; drag it into a scene to use it. ' +
      'The object is exported at the origin, so it is easy to place.',
    input: z.object({
      project: z.string().describe('Folder of the Godot project (the one containing project.godot)'),
      folder: z.string().optional().describe('Folder inside the project, default "assets/forge"'),
      filename: z.string().optional().describe('Default: the object\'s name'),
      target: z.string().optional(),
      collision,
    }),
    async handler({ project, folder = 'assets/forge', filename, target, collision: col = 'box' }) {
      const dir = await godotDir(project, folder);
      const o = target ? engine.getObject(target) : null;
      const name = safeName(filename ?? o?.name ?? engine.scene.name);
      const out = await engine.exportGlb({ target, collision: col, animations: true, atOrigin: !!target, name });
      const file = path.join(dir, `${name}.glb`);
      await fs.writeFile(file, Buffer.from(out.glb, 'base64'));
      return { path: file, resPath: `res://${folder.replace(/\\/g, '/').replace(/^\/|\/$/g, '')}/${name}.glb` };
    },
  });

  registry.define({
    name: 'export_each',
    title: 'Export each object',
    category: 'game',
    description:
      'Export every top-level object (or every child of one group, e.g. a level kit) as its own .glb, each at the origin with a collision shape. ' +
      'Without project the files go to exports/<folder>/; with project they go straight into that Godot project.',
    input: z.object({
      group: z.string().optional().describe('Export the children of this group instead of the top-level objects'),
      folder: z.string().optional().describe('Default "kit" (or "assets/forge" inside a Godot project)'),
      project: z.string().optional().describe('Godot project folder (optional)'),
      collision,
    }),
    async handler({ group, folder, project, collision: col = 'box' }) {
      if (group) engine.getObject(group);
      const items = topLevel(group ?? null);
      if (!items.length) throw new CommandError('Nothing to export.');
      const dir = project ? await godotDir(project, folder ?? 'assets/forge') : await exportDir(engine, folder ?? 'kit');
      const files = [];
      const names = fileNames(items);
      for (const o of items) {
        const out = await engine.exportGlb({ target: o.id, collision: col, animations: true, atOrigin: true, name: names.get(o.id) });
        const file = path.join(dir, `${names.get(o.id)}.glb`);
        await fs.writeFile(file, Buffer.from(out.glb, 'base64'));
        files.push(file);
      }
      return { files };
    },
  });
}

// Godot 4 SpriteFrames resource: one animation per sheet row, frames cut from the sheet
// with AtlasTextures. With a normal map, frames use a CanvasTexture so 2D lights work.
export function spriteFramesTres(meta, colorPath, normalPath) {
  const ext = [`[ext_resource type="Texture2D" path="${colorPath}" id="1_color"]`];
  const subs = [];
  let atlas = 'ExtResource("1_color")';
  if (normalPath) {
    ext.push(`[ext_resource type="Texture2D" path="${normalPath}" id="2_normal"]`);
    subs.push('[sub_resource type="CanvasTexture" id="CanvasTexture_sheet"]\ndiffuse_texture = ExtResource("1_color")\nnormal_texture = ExtResource("2_normal")');
    atlas = 'SubResource("CanvasTexture_sheet")';
  }
  const anims = meta.rowNames.map((rowName, r) => {
    const frames = [];
    for (let c = 0; c < meta.columns; c++) {
      const id = `AtlasTexture_${r}_${c}`;
      subs.push(`[sub_resource type="AtlasTexture" id="${id}"]\natlas = ${atlas}\nregion = Rect2(${c * meta.frameSize}, ${r * meta.frameSize}, ${meta.frameSize}, ${meta.frameSize})`);
      frames.push(`{\n"duration": 1.0,\n"texture": SubResource("${id}")\n}`);
    }
    return `{\n"frames": [${frames.join(', ')}],\n"loop": true,\n"name": &"${rowName}",\n"speed": ${(meta.fps ?? 5).toFixed(1)}\n}`;
  });
  return `[gd_resource type="SpriteFrames" load_steps=${ext.length + subs.length + 1} format=3]\n\n${ext.join('\n')}\n\n${subs.join('\n\n')}\n\n[resource]\nanimations = [${anims.join(', ')}]\n`;
}

// One file name per object; objects with the same name get _2, _3 … instead of overwriting each other.
function fileNames(objects) {
  const used = new Set();
  const names = new Map();
  for (const o of objects) {
    const base = safeName(o.name);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    used.add(name.toLowerCase());
    names.set(o.id, name);
  }
  return names;
}

export async function exportDir(engine, folder) {
  const dir = path.join(engine.paths.exports, ...folderParts(folder));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// A folder inside exports or a Godot project: "a/b" is fine, ".." (going up and out) is not.
function folderParts(folder) {
  const parts = String(folder).split(/[\\/]+/).filter(Boolean).map(safeName);
  if (parts.some((p) => /^\.+$/.test(p))) throw new CommandError('folder must stay inside its base folder: no "." or ".." parts.');
  return parts;
}

export async function godotDir(project, folder) {
  const root = path.resolve(project);
  try {
    await fs.access(path.join(root, 'project.godot'));
  } catch {
    throw new CommandError(`"${root}" is not a Godot project (no project.godot found).`);
  }
  const dir = path.join(root, ...folderParts(folder));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
