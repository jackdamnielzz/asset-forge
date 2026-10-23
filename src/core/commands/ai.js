import fs from 'node:fs/promises';
import path from 'node:path';
import { SERVICES } from '../providers.js';
import { CommandError } from '../registry.js';
import { safeName } from '../engine.js';
import { storeImage, storeFile } from './assets.js';
import { color } from './common.js';
import { PALETTES, resolvePalette as resolveNamedPalette } from '../../shared/palettes.js';

export function register(registry, { z, engine }) {
  const service = (cap) => z.enum(Object.keys(SERVICES).filter((k) => SERVICES[k].can.includes(cap)));
  const imageRef = async (id) => {
    const a = engine.library.images[id];
    if (!a) throw new CommandError(`Unknown image "${id}". See list_images.`);
    return { data: (await fs.readFile(path.join(engine.paths.images, a.file))).toString('base64'), mime: a.mime };
  };
  const processImage = async (op, assetId, options, name) => {
    const a = engine.library.images[assetId];
    if (!a) throw new CommandError(`Unknown image "${assetId}". See list_images.`);
    const out = await engine.bridge.request('image_op', { op, file: a.file, options });
    const asset = await storeImage(engine, Buffer.from(out.png, 'base64'), name ?? `${a.name}_${op}`, { madeFrom: { assetId, op, options } });
    return { assetId: asset.id, width: asset.width, height: asset.height, image: out.png, mime: 'image/png' };
  };
  const progress = (what) => (status) => engine.emit('log', { command: `${what}: ${status}`, source: 'ai-service', ok: true, time: Date.now() });

  registry.define({
    name: 'list_palettes',
    title: 'List palettes',
    category: 'images',
    description: 'List the built-in pixel-art palettes (use their names wherever a palette is asked for).',
    handler: () => PALETTES,
  });

  registry.define({
    name: 'list_ai_services',
    title: 'List AI services',
    category: 'ai',
    description:
      'Show which outside AI services are connected and what they can make (image, video, 3d) with suggested model names. ' +
      'These services cost money per use on the user\'s own account.',
    handler: () => engine.providers.status(),
  });

  registry.define({
    name: 'connect_ai_service',
    title: 'Connect AI service',
    category: 'ai',
    description: 'Save an API key (and optionally a different server address) for a service. Normally the user does this in the window (✨ AI → Services). Send an empty key to disconnect.',
    input: z.object({ service: z.enum(Object.keys(SERVICES)), key: z.string().optional(), baseUrl: z.string().url().or(z.literal('')).optional() }),
    async handler({ service: s, key, baseUrl }) {
      await engine.providers.setKey(s, key, baseUrl);
      return (await engine.providers.status())[s];
    },
  });

  registry.define({
    name: 'generate_image',
    title: 'Generate image with AI',
    category: 'ai',
    description:
      'Make a picture with an outside AI image model and add it to the library. Services: openai (gpt-image), google (Nano Banana), nanogpt (many models). ' +
      'references = library image ids the AI should follow (edit or restyle them). referenceRender renders a scene object first and sends that as reference — ' +
      'great for "repaint this 3D model as pixel art / hand-painted". Then use it as texture, place it, or make a 3D cut-out. Costs money on the user\'s account.',
    input: z.object({
      service: service('image'),
      prompt: z.string().min(3),
      model: z.string().optional().describe('Model name; see list_ai_services for suggestions'),
      size: z.string().optional().describe('openai/nanogpt: e.g. "1024x1024"; google: aspect ratio like "1:1", "16:9" or size "1K"/"2K"/"4K"'),
      transparent: z.boolean().optional().describe('See-through background (openai natively; others get a white background removed afterwards)'),
      references: z.array(z.string()).max(4).optional(),
      referenceRender: z.object({ target: z.string().optional(), view: z.string().optional() }).optional(),
      name: z.string().optional(),
      place: z.enum(['none', 'image', 'cutout']).optional().describe('Also put it in the scene as a flat picture or a 3D cut-out'),
      textureFor: z.string().optional().describe('Object id to paint the picture onto'),
    }),
    async handler(args) {
      const refs = [];
      for (const id of args.references ?? []) refs.push(await imageRef(id));
      if (args.referenceRender) {
        if (args.referenceRender.target) engine.getObject(args.referenceRender.target);
        const shot = await engine.render({ view: args.referenceRender.view ?? 'iso', width: 1024, height: 1024, target: args.referenceRender.target, isolate: !!args.referenceRender.target, background: '#ffffff', ground: false });
        refs.push({ data: shot.png, mime: 'image/png' });
      }
      progress('generate_image')(`asking ${args.service}…`);
      const buf = await engine.providers.image(args.service, { prompt: args.prompt, model: args.model, size: args.size, transparent: args.transparent, refs });
      let asset = await storeImage(engine, buf, args.name ?? args.prompt.slice(0, 40), { madeBy: { service: args.service, model: args.model ?? null, prompt: args.prompt } });
      if (args.transparent && !['openai', 'pixellab'].includes(args.service)) {
        const cut = await processImage('remove_background', asset.id, { tolerance: 0.12 }, asset.name);
        asset = engine.library.images[cut.assetId];
        asset.madeBy = { service: args.service, model: args.model ?? null, prompt: args.prompt };
      }
      let objectId;
      if (args.place && args.place !== 'none') objectId = (await engine.execute('add_object', { type: args.place, name: asset.name, params: { assetId: asset.id } }, { source: 'ai' })).id;
      if (args.textureFor) await engine.execute('set_material', { id: args.textureFor, texture: asset.id }, { source: 'ai' });
      const file = await fs.readFile(path.join(engine.paths.images, asset.file));
      return { assetId: asset.id, width: asset.width, height: asset.height, objectId, image: file.toString('base64'), mime: asset.mime };
    },
  });

  registry.define({
    name: 'generate_video',
    title: 'Generate video with AI',
    category: 'ai',
    description:
      'Make a short video with an outside AI video model (nanogpt: Veo, Kling, Wan, Seedance...). Give image (a library image id) to animate a picture. ' +
      'Takes one to several minutes. The video goes into the library; turn it into a sprite animation with video_to_sprites. Costs money on the user\'s account.',
    input: z.object({
      service: service('video'),
      prompt: z.string().min(3),
      model: z.string().optional(),
      image: z.string().optional().describe('Library image id to start from (image-to-video)'),
      duration: z.number().int().min(1).max(20).optional().describe('Seconds, model dependent (often 5)'),
      aspect: z.string().optional().describe('e.g. "16:9", "1:1"'),
      name: z.string().optional(),
    }),
    async handler(args) {
      const ref = args.image ? await imageRef(args.image) : null;
      const buf = await engine.providers.video(args.service, { prompt: args.prompt, model: args.model, duration: args.duration, aspect: args.aspect, ref, onStatus: progress('generate_video') });
      const v = await storeFile(engine, 'videos', buf, args.name ?? args.prompt.slice(0, 40), { madeBy: { service: args.service, model: args.model ?? null, prompt: args.prompt } });
      return { videoId: v.id, url: `/library/videos/${v.file}`, bytes: v.bytes };
    },
  });

  registry.define({
    name: 'generate_3d',
    title: 'Generate 3D model with AI',
    category: 'ai',
    description:
      'Make a textured 3D model with an outside AI (fal: Trellis 2 or Hunyuan 3D) from a picture (image = library image id; best with one object on a plain background) ' +
      'or from text (prompt with a text-to-3d model). The model is added to the library and placed in the scene. Takes a few minutes. Costs money on the user\'s account.',
    input: z.object({
      service: service('3d'),
      image: z.string().optional(),
      prompt: z.string().optional(),
      model: z.string().optional(),
      size: z.number().min(0).max(1000).optional().describe('Height in metres in the scene (default 1)'),
      name: z.string().optional(),
    }),
    async handler(args) {
      const ref = args.image ? await imageRef(args.image) : null;
      const buf = await engine.providers.model3d(args.service, { prompt: args.prompt, model: args.model, ref, onStatus: progress('generate_3d') });
      const m = await storeFile(engine, 'models', buf, args.name ?? args.prompt?.slice(0, 40) ?? engine.library.images[args.image]?.name ?? 'ai_model', {
        madeBy: { service: args.service, model: args.model ?? null, prompt: args.prompt ?? null, image: args.image ?? null },
      });
      const obj = await engine.execute('add_object', { type: 'model', name: m.name, params: { assetId: m.id, size: args.size ?? 1 } }, { source: 'ai' });
      return { modelId: m.id, objectId: obj.id };
    },
  });

  registry.define({
    name: 'remove_background',
    title: 'Remove background',
    category: 'images',
    description: 'Make the plain background of a picture see-through (flood fill from the edges). Creates a new library image. tolerance 0-1: how different a colour may be and still count as background.',
    input: z.object({ assetId: z.string(), tolerance: z.number().min(0).max(1).optional(), name: z.string().optional() }),
    handler: ({ assetId, tolerance, name }) => processImage('remove_background', assetId, { tolerance: tolerance ?? 0.12 }, name),
  });

  registry.define({
    name: 'make_seamless',
    title: 'Make seamless texture',
    category: 'images',
    description:
      'Turn a photo (stone, grass, wood, fabric...) into a texture that repeats without visible edges. Creates a new library image. ' +
      'Use it with set_material { texture, textureScale } so it tiles at a real-world size.',
    input: z.object({ assetId: z.string(), blend: z.number().min(0.05).max(0.5).optional().describe('Width of the blended edge, fraction of the image (default 0.25)'), name: z.string().optional() }),
    handler: ({ assetId, blend, name }) => processImage('seamless', assetId, { blend: blend ?? 0.25 }, name),
  });

  registry.define({
    name: 'pixelate_image',
    title: 'Picture → pixel art',
    category: 'images',
    description:
      'Turn any picture (photo, drawing, AI image) into pixel art: scaled down to a small size, limited colour palette, crisp edges and an optional outline. Creates a new library image.',
    input: z.object({
      assetId: z.string(),
      size: z.number().int().min(8).max(512).optional().describe('Longest side in pixels (default 64)'),
      colors: z.number().int().min(2).max(256).optional().describe('Default 16'),
      palette: z.union([z.string(), z.array(color)]).optional().describe('A palette name (see list_palettes) or a list of colours'),
      outline: color.nullable().optional(),
      name: z.string().optional(),
    }),
    async handler({ assetId, size, colors, palette, outline, name }) {
      return processImage('pixelate', assetId, { size: size ?? 64, colors: colors ?? 16, palette: resolvePalette(palette) ?? engine.scene.environment.housePalette ?? null, outline: outline ?? null }, name);
    },
  });

  registry.define({
    name: 'video_to_sprites',
    title: 'Video → sprite sheet',
    category: 'images',
    description:
      'Cut a library video into evenly spaced frames and lay them out as a sprite sheet (optionally as pixel art with the background removed). ' +
      'Great after generate_video: an AI-made animation becomes a game sprite. Saves exports/sprites/<filename>.png and adds it to the library.',
    input: z.object({
      videoId: z.string(),
      filename: z.string(),
      frames: z.number().int().min(2).max(64).optional().describe('Default 8'),
      frameSize: z.number().int().min(8).max(1024).optional().describe('Longest side of one frame, default 96'),
      start: z.number().min(0).optional().describe('Start time in seconds'),
      end: z.number().min(0).optional().describe('End time in seconds (default: end of video)'),
      pixelArt: z.boolean().optional(),
      colors: z.number().int().min(2).max(256).optional(),
      palette: z.union([z.string(), z.array(color)]).optional(),
      removeBackground: z.boolean().optional(),
    }),
    async handler(args) {
      const v = engine.library.videos?.[args.videoId];
      if (!v) throw new CommandError(`Unknown video "${args.videoId}". See list_library.`);
      const out = await engine.bridge.request('video_frames', {
        file: v.file, frames: args.frames ?? 8, frameSize: args.frameSize ?? 96, start: args.start ?? 0, end: args.end,
        pixelArt: !!args.pixelArt, colors: args.colors ?? 24, palette: resolvePalette(args.palette) ?? engine.scene.environment.housePalette ?? null, removeBackground: !!args.removeBackground,
      });
      const dir = path.join(engine.paths.exports, 'sprites');
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${safeName(args.filename)}.png`);
      const buf = Buffer.from(out.png, 'base64');
      await fs.writeFile(file, buf);
      await fs.writeFile(file.replace(/\.png$/, '.json'), JSON.stringify(out.meta, null, 2));
      const asset = await storeImage(engine, buf, args.filename, { madeFrom: { videoId: args.videoId } });
      return { path: file, assetId: asset.id, image: out.png, mime: 'image/png', ...out.meta };
    },
  });
}

function resolvePalette(p) {
  if (!p) return null;
  const colors = resolveNamedPalette(p);
  if (!colors) throw new CommandError(`Unknown palette "${p}". Choose: ${Object.keys(PALETTES).join(', ')}, or give a list of colours.`);
  return colors;
}
