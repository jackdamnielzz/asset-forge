import fs from 'node:fs/promises';
import path from 'node:path';
import { safeName } from '../engine.js';
import { CommandError } from '../registry.js';
import { color } from './common.js';
import { VIEWS } from './render.js';

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
      for (const o of targets) {
        const out = await engine.render({
          view: args.view ?? 'iso', width: size, height: size, target: o.id, isolate: true, ground: false,
          background: args.background ?? 'transparent', padding: args.padding ?? 0.06,
          outline: args.outline === null ? null : { color: args.outline ?? '#1b1c20', width: args.outlineWidth ?? Math.max(1, Math.round(size / 96)) },
        });
        const file = path.join(dir, `${safeName(o.name)}.png`);
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
      'then down-left, left, up-left, up, up-right, right, down-right for 8), columns = animation frames. ' +
      'pixelArt gives crisp pixels with a limited colour palette and an outline. Saves exports/sprites/<filename>.png plus a .json with the layout, and returns the sheet so you can look at it.',
    input: z.object({
      target: z.string().optional().describe('Object or group id; default the whole scene'),
      filename: z.string(),
      directions: z.union([z.literal(1), z.literal(4), z.literal(8)]).optional().describe('Default 8'),
      frameSize: z.number().int().min(8).max(1024).optional().describe('Pixels per frame, default 64'),
      animation: z.string().optional().describe('Animation to sample (see list_animations)'),
      frames: z.number().int().min(1).max(64).optional().describe('Frames per direction when animated, default 8'),
      elevation: z.number().min(0).max(90).optional().describe('Camera angle above the ground in degrees: 0 = side view, 30 = classic isometric (default), 60+ = top-down'),
      pixelArt: z.boolean().optional().describe('Default true'),
      colors: z.number().int().min(2).max(256).optional().describe('Palette size for pixel art, default 24'),
      palette: z.array(color).optional().describe('Force these exact colours (house style)'),
      outline: color.nullable().optional().describe('Pixel outline colour, null for none (default dark)'),
      groundShadow: z.boolean().optional().describe('Keep the soft shadow under the object (default false)'),
    }),
    async handler(args) {
      if (args.target) engine.getObject(args.target);
      if (args.animation && !engine.scene.animations?.[args.animation]) throw new CommandError(`No animation "${args.animation}".`);
      const out = await engine.bridge.request('render_sprites', {
        target: args.target, directions: args.directions ?? 8, frameSize: args.frameSize ?? 64,
        animation: args.animation, frames: args.animation ? args.frames ?? 8 : 1, elevation: args.elevation ?? 30,
        pixelArt: args.pixelArt ?? true, colors: args.colors ?? 24, palette: args.palette,
        outline: args.outline === undefined ? '#16171b' : args.outline, groundShadow: !!args.groundShadow,
      });
      const dir = await exportDir(engine, 'sprites');
      const base = path.join(dir, safeName(args.filename));
      await fs.writeFile(`${base}.png`, Buffer.from(out.png, 'base64'));
      await fs.writeFile(`${base}.json`, JSON.stringify(out.meta, null, 2));
      return { image: out.png, mime: 'image/png', path: `${base}.png`, layout: `${base}.json`, ...out.meta };
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
      for (const o of items) {
        const out = await engine.exportGlb({ target: o.id, collision: col, animations: true, atOrigin: true, name: safeName(o.name) });
        const file = path.join(dir, `${safeName(o.name)}.glb`);
        await fs.writeFile(file, Buffer.from(out.glb, 'base64'));
        files.push(file);
      }
      return { files };
    },
  });
}

async function exportDir(engine, folder) {
  const parts = String(folder).split(/[\\/]+/).filter(Boolean).map(safeName);
  const dir = path.join(engine.paths.exports, ...parts);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function godotDir(project, folder) {
  const root = path.resolve(project);
  try {
    await fs.access(path.join(root, 'project.godot'));
  } catch {
    throw new CommandError(`"${root}" is not a Godot project (no project.godot found).`);
  }
  const parts = String(folder).split(/[\\/]+/).filter(Boolean).map(safeName);
  const dir = path.join(root, ...parts);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
