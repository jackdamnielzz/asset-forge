import fs from 'node:fs/promises';
import path from 'node:path';
import { safeName } from '../engine.js';
import { color } from './common.js';

export const VIEWS = ['iso', 'iso_back', 'front', 'back', 'left', 'right', 'top', 'camera'];

export function register(registry, { z, engine }) {
  const renderInput = z.object({
    view: z.enum(VIEWS).optional().describe('Camera angle. iso = 3/4 view from the front-right (default). camera = the scene camera.'),
    width: z.number().int().min(64).max(4096).optional(),
    height: z.number().int().min(64).max(4096).optional(),
    target: z.string().optional().describe('Object id to frame; default frames everything visible'),
    background: color.optional().describe('Override background, or "transparent"'),
    ground: z.boolean().optional().describe('Override whether the ground/shadow is shown'),
  });

  registry.define({
    name: 'render_preview',
    title: 'Render preview',
    category: 'render',
    description:
      'Render a picture of the scene and return it, so you can SEE the result. ' +
      'Use this after every few changes to check quality: proportions, lighting, materials, gaps between parts.',
    input: renderInput.extend({ save: z.string().optional().describe('Also save as exports/<save>.png') }),
    async handler(args) {
      const out = await engine.render({ view: 'iso', width: 768, height: 768, ...args });
      let savedTo;
      if (args.save) savedTo = await writeExport(engine, `${safeName(args.save)}.png`, out.png);
      return { image: out.png, mime: 'image/png', width: out.width, height: out.height, savedTo };
    },
  });

  registry.define({
    name: 'export_png',
    title: 'Export PNG',
    category: 'render',
    description: 'Render a high-quality PNG file into the exports folder. Transparent background by default.',
    input: renderInput.extend({ filename: z.string() }),
    async handler({ filename, ...args }) {
      const out = await engine.render({ view: 'iso', width: 1024, height: 1024, background: 'transparent', ground: false, ...args });
      return { path: await writeExport(engine, `${safeName(filename)}.png`, out.png), width: out.width, height: out.height };
    },
  });

  registry.define({
    name: 'export_glb',
    title: 'Export GLB',
    category: 'render',
    description: 'Export the scene (or one object/group) as a .glb 3D model file with textures embedded. Opens in Godot, Unity, Unreal and Blender.',
    input: z.object({ filename: z.string(), target: z.string().optional().describe('Object or group id; default exports everything visible') }),
    async handler({ filename, target }) {
      if (target) engine.getObject(target);
      const out = await engine.exportGlb({ target });
      const file = await writeExport(engine, `${safeName(filename)}.glb`, out.glb);
      return { path: file, bytes: Buffer.from(out.glb, 'base64').length };
    },
  });
}

async function writeExport(engine, file, base64) {
  const full = path.join(engine.paths.exports, file);
  await fs.writeFile(full, Buffer.from(base64, 'base64'));
  return full;
}
