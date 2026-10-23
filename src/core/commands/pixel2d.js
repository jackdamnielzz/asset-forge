import fs from 'node:fs/promises';
import path from 'node:path';
import { safeName } from '../engine.js';
import { CommandError } from '../registry.js';
import { PALETTES, resolvePalette } from '../../shared/palettes.js';
import { color } from './common.js';
import { storeImage } from './assets.js';
import { exportDir, godotDir, spriteFramesTres } from './game.js';
import { writeAseprite } from '../aseprite.js';

const EFFECT_TYPES = ['explosion', 'fire', 'smoke', 'magic', 'sparks', 'glitter', 'heal', 'lightning'];

export function register(registry, { z, engine }) {
  const paletteArg = z.union([z.string(), z.array(color)]).optional().describe('Palette name (see list_palettes) or colours; default the house style palette');
  const pickPalette = (p) => {
    if (!p) return engine.scene.environment.housePalette ?? null;
    const r = resolvePalette(p);
    if (!r) throw new CommandError(`Unknown palette "${p}". Choose: ${Object.keys(PALETTES).join(', ')}`);
    return r;
  };
  const image = (id) => {
    const a = engine.library.images[id];
    if (!a) throw new CommandError(`Unknown image "${id}". See list_images.`);
    return a;
  };
  const op = (assetId, operation, options = {}) => engine.bridge.request('image_op', { op: operation, file: image(assetId).file, options });
  const saveSheet = async ({ png, meta, filename, folder, project, kind }) => {
    const dir = project ? await godotDir(project, folder ?? `assets/forge/${kind}`) : await exportDir(engine, kind);
    const name = safeName(filename);
    const files = { sheet: path.join(dir, `${name}.png`) };
    const buf = Buffer.from(png, 'base64');
    await fs.writeFile(files.sheet, buf);
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(meta, null, 2));
    if (project && meta.rowNames) {
      files.spriteFrames = path.join(dir, `${name}.tres`);
      const res = `res://${(folder ?? `assets/forge/${kind}`).replace(/\\/g, '/').replace(/^\/|\/$/g, '')}/${name}.png`;
      await fs.writeFile(files.spriteFrames, spriteFramesTres(meta, res, null));
    }
    const asset = await storeImage(engine, buf, name, { madeFrom: { [kind]: meta } });
    return { image: png, mime: 'image/png', assetId: asset.id, files, ...meta };
  };

  // ---- effects & backgrounds -------------------------------------------------------------

  registry.define({
    name: 'make_effect',
    title: 'Make pixel effect',
    category: 'pixel',
    description:
      `Make an animated pixel-art effect as a sprite strip: ${EFFECT_TYPES.join(', ')}. fire, smoke, magic, glitter and heal loop seamlessly; ` +
      'explosion, sparks and lightning play once. color tints it (e.g. green fire); palette snaps it to a palette. ' +
      'With project (a Godot project folder) it also writes a SpriteFrames .tres.',
    input: z.object({
      type: z.enum(EFFECT_TYPES),
      size: z.number().int().min(16).max(256).optional().describe('Frame size in pixels, default 64'),
      frames: z.number().int().min(2).max(32).optional(),
      color: color.optional(),
      palette: paletteArg,
      colors: z.number().int().min(2).max(64).optional().describe('Colour count when no palette (default 12)'),
      seed: z.number().int().optional(),
      filename: z.string().optional(),
      project: z.string().optional(),
      folder: z.string().optional(),
    }),
    async handler(a) {
      const out = await engine.bridge.request('render_effect', { type: a.type, size: a.size ?? 64, frames: a.frames, color: a.color, palette: pickPalette(a.palette), colors: a.colors ?? 12, seed: a.seed ?? 1 });
      return saveSheet({ ...out, filename: a.filename ?? a.type, folder: a.folder, project: a.project, kind: 'effects' });
    },
  });

  registry.define({
    name: 'make_parallax',
    title: 'Make parallax background',
    category: 'pixel',
    description:
      'Make a layered pixel-art background for side-scrolling games: sky, far, middle and near layers that each repeat seamlessly sideways. ' +
      'Themes: mountains, forest, city, clouds. Time: day, sunset, night. Saves every layer as a PNG plus a preview and suggested scroll speeds.',
    input: z.object({
      theme: z.enum(['mountains', 'forest', 'city', 'clouds']).optional(),
      time: z.enum(['day', 'sunset', 'night']).optional(),
      width: z.number().int().min(64).max(2048).optional().describe('Default 320'),
      height: z.number().int().min(64).max(1024).optional().describe('Default 180'),
      palette: paletteArg,
      colors: z.number().int().min(2).max(64).optional(),
      seed: z.number().int().optional(),
      filename: z.string().optional(),
      project: z.string().optional(),
      folder: z.string().optional(),
    }),
    async handler(a) {
      const out = await engine.bridge.request('render_parallax', {
        theme: a.theme ?? 'mountains', time: a.time ?? 'day', width: a.width ?? 320, height: a.height ?? 180,
        palette: pickPalette(a.palette), colors: a.colors ?? 24, seed: a.seed ?? 1,
      });
      const name = safeName(a.filename ?? `${a.theme ?? 'mountains'}_${a.time ?? 'day'}`);
      const dir = a.project ? await godotDir(a.project, a.folder ?? 'assets/forge/backgrounds') : await exportDir(engine, 'backgrounds');
      const files = [];
      for (const [i, layer] of out.layers.entries()) {
        const f = path.join(dir, `${name}_layer${i}.png`);
        await fs.writeFile(f, Buffer.from(layer, 'base64'));
        files.push(f);
      }
      const preview = path.join(dir, `${name}_preview.png`);
      await fs.writeFile(preview, Buffer.from(out.preview, 'base64'));
      await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(out.meta, null, 2));
      const asset = await storeImage(engine, Buffer.from(out.preview, 'base64'), `${name}_preview`);
      return { ...out.meta, image: out.preview, mime: 'image/png', assetId: asset.id, layers: files, preview };
    },
  });

  // ---- colour tools -------------------------------------------------------------------

  registry.define({
    name: 'recolor_image',
    title: 'Swap colours',
    category: 'pixel',
    description: 'Swap exact colours in a picture, e.g. map { "#3f7fd1": "#d13f3f" } turns a blue shirt red. Creates a new library image. Use extract_palette to see which colours a picture uses.',
    input: z.object({ assetId: z.string(), map: z.record(z.string(), color), name: z.string().optional() }),
    async handler({ assetId, map, name }) {
      const out = await op(assetId, 'recolor', { map });
      const asset = await storeImage(engine, Buffer.from(out.png, 'base64'), name ?? `${image(assetId).name}_recolor`, { madeFrom: { assetId, recolor: map } });
      return { assetId: asset.id, image: out.png, mime: 'image/png' };
    },
  });

  registry.define({
    name: 'make_palette_variants',
    title: 'Colour variants',
    category: 'pixel',
    description: 'Make colour versions of a sprite by turning every colour around the colour wheel (a red, green and blue slime from one design). Creates new library images.',
    input: z.object({
      assetId: z.string(),
      count: z.number().int().min(1).max(12).optional().describe('Default 3'),
      saturation: z.number().min(0).max(2).optional().describe('1 = unchanged'),
    }),
    async handler({ assetId, count = 3, saturation = 1 }) {
      const variants = [];
      for (let i = 1; i <= count; i++) {
        const degrees = Math.round((360 / (count + 1)) * i);
        const out = await op(assetId, 'hue', { degrees, saturation });
        const asset = await storeImage(engine, Buffer.from(out.png, 'base64'), `${image(assetId).name}_hue${degrees}`, { madeFrom: { assetId, hue: degrees } });
        variants.push({ assetId: asset.id, degrees });
      }
      return { variants };
    },
  });

  registry.define({
    name: 'extract_palette',
    title: 'Steal a palette',
    category: 'pixel',
    description: 'Pick the main colours out of any picture (sorted dark to light). Optionally save them as a house style so all your art can use them.',
    input: z.object({ assetId: z.string(), count: z.number().int().min(2).max(64).optional(), saveAsHouseStyle: z.string().optional() }),
    async handler({ assetId, count = 16, saveAsHouseStyle }, ctx) {
      const { colors } = await op(assetId, 'extract_palette', { count });
      if (saveAsHouseStyle) await engine.execute('save_house_style', { name: saveAsHouseStyle, palette: colors, description: `Colours from ${image(assetId).name}` }, ctx.meta);
      return { colors, savedAs: saveAsHouseStyle ?? null };
    },
  });

  registry.define({
    name: 'check_pixel_style',
    title: 'Pixel style check',
    category: 'pixel',
    description: 'Check a pixel-art picture for common problems: blurry half-transparent pixels, too many colours, colours outside the palette, lonely stray pixels, and a size that does not fit the tile grid.',
    input: z.object({ assetId: z.string(), palette: paletteArg, maxColors: z.number().int().optional().describe('Default 32'), grid: z.number().int().optional().describe('Tile/frame size the picture should be a multiple of') }),
    async handler({ assetId, palette, maxColors = 32, grid }) {
      const pal = pickPalette(palette);
      const s = await op(assetId, 'analyze', { palette: pal });
      const issues = [];
      if (s.semiTransparent) issues.push(`${s.semiTransparent} half-transparent pixels (look blurry in pixel art). Fix: pixelate_image or remove_background.`);
      if (s.colorCount > maxColors) issues.push(`${s.colorCount} colours; pixel art usually uses at most ${maxColors}. Fix: pixelate_image with a palette.`);
      if (pal && s.offPalette) issues.push(`${s.offPalette} pixels use colours outside the palette.`);
      if (s.lonelyPixels > Math.max(3, (s.width * s.height) / 400)) issues.push(`${s.lonelyPixels} lonely stray pixels (noise). Fix: render with cleanup or touch up in the pixel editor.`);
      if (grid && (s.width % grid || s.height % grid)) issues.push(`Size ${s.width}x${s.height} is not a multiple of the ${grid}px grid.`);
      return { ...s, ok: !issues.length, issues };
    },
  });

  registry.define({
    name: 'paint_pixels',
    title: 'Paint pixels',
    category: 'pixel',
    description:
      'Edit a picture pixel by pixel: pixels = [[x, y, "#hex" or null to erase]], fills = [[x, y, "#hex" or null]] flood-fills the area of the same colour. ' +
      'Coordinates start at the top-left (0, 0). Creates a new library image (the original stays) unless replace is true.',
    input: z.object({
      assetId: z.string(),
      pixels: z.array(z.tuple([z.number().int(), z.number().int(), color.nullable()])).optional(),
      fills: z.array(z.tuple([z.number().int(), z.number().int(), color.nullable()])).optional(),
      name: z.string().optional(),
    }),
    async handler({ assetId, pixels = [], fills = [], name }) {
      const out = await op(assetId, 'paint', { pixels, fills });
      const asset = await storeImage(engine, Buffer.from(out.png, 'base64'), name ?? `${image(assetId).name}_edit`, { madeFrom: { assetId, edit: true } });
      return { assetId: asset.id, image: out.png, mime: 'image/png' };
    },
  });

  // ---- sheets -----------------------------------------------------------------------------

  registry.define({
    name: 'export_aseprite',
    title: 'Export to Aseprite',
    category: 'pixel',
    description:
      'Turn a sprite sheet from the library into an .aseprite file (one frame per cell, a tag per row so every animation/direction is named) to keep working in Aseprite. ' +
      'Give the frame size; rowNames name the tags (render_sprites returns them).',
    input: z.object({
      assetId: z.string(),
      frameWidth: z.number().int().min(1),
      frameHeight: z.number().int().min(1).optional(),
      fps: z.number().min(1).max(60).optional().describe('Default 10'),
      rowNames: z.array(z.string()).optional(),
      filename: z.string().optional(),
    }),
    async handler({ assetId, frameWidth, frameHeight, fps = 10, rowNames, filename }) {
      const { width, height, rgba } = await op(assetId, 'rgba');
      const fw = frameWidth, fh = frameHeight ?? frameWidth;
      if (width % fw || height % fh) throw new CommandError(`The picture (${width}x${height}) does not divide into ${fw}x${fh} frames.`);
      const cols = width / fw, rows = height / fh;
      const src = Buffer.from(rgba, 'base64');
      const frames = [];
      const tags = [];
      for (let r = 0; r < rows; r++) {
        tags.push({ name: rowNames?.[r] ?? `row${r + 1}`, from: frames.length, to: frames.length + cols - 1 });
        for (let c = 0; c < cols; c++) {
          const buf = Buffer.alloc(fw * fh * 4);
          for (let y = 0; y < fh; y++) src.copy(buf, y * fw * 4, ((r * fh + y) * width + c * fw) * 4, ((r * fh + y) * width + c * fw + fw) * 4);
          frames.push({ rgba: buf, duration: Math.round(1000 / fps) });
        }
      }
      const file = path.join(await exportDir(engine, 'aseprite'), `${safeName(filename ?? image(assetId).name)}.aseprite`);
      await fs.writeFile(file, writeAseprite({ width: fw, height: fh, frames, tags }));
      return { path: file, frames: frames.length, tags: tags.map((t) => t.name) };
    },
  });

  registry.define({
    name: 'make_prop_sheet',
    title: 'Prop sheet',
    category: 'pixel',
    description: 'Render several objects as pixel-art props with the same camera, scale and palette, packed into one sheet (with a .json listing where each one is). Default: all top-level objects.',
    input: z.object({
      ids: z.array(z.string()).optional(),
      frameSize: z.number().int().min(8).max(512).optional().describe('Default 48'),
      pixelsPerMetre: z.number().min(1).optional().describe('Same scale for all, e.g. 32 (default fits each)'),
      elevation: z.number().min(0).max(90).optional(),
      palette: paletteArg,
      outlineStyle: z.enum(['solid', 'selout', 'none']).optional(),
      filename: z.string().optional(),
    }),
    async handler(a) {
      const ids = a.ids ?? engine.scene.order.filter((id) => { const o = engine.scene.objects[id]; return !o.parent && o.visible !== false && !o.cutterFor; });
      if (!ids.length) throw new CommandError('No objects to put on the sheet.');
      for (const id of ids) engine.getObject(id);
      const out = await engine.bridge.request('sprite_atlas', {
        targets: ids, frameSize: a.frameSize ?? 48, pixelsPerMetre: a.pixelsPerMetre ?? null, elevation: a.elevation ?? 30, palette: pickPalette(a.palette),
        outlineStyle: a.outlineStyle === 'none' ? 'solid' : a.outlineStyle ?? 'selout', outline: a.outlineStyle === 'none' ? null : '#16171b',
      });
      return saveSheet({ ...out, filename: a.filename ?? 'props', kind: 'sheets' });
    },
  });

  registry.define({
    name: 'make_iso_tiles',
    title: 'Isometric tiles',
    category: 'pixel',
    description:
      'Render the pieces of a level kit (or other objects) as pixel-art isometric tiles: classic 2:1 diamond view, all at exactly the same scale so they line up on an isometric grid. ' +
      'Give the kit group id (from make_level_kit); its children become the tiles.',
    input: z.object({
      group: z.string().optional().describe('A group whose children are the tiles'),
      ids: z.array(z.string()).optional(),
      tileWidth: z.number().int().min(16).max(512).optional().describe('Width of one floor diamond in pixels, default 64'),
      gridSize: z.number().min(0.1).optional().describe('Size of one grid cell in metres (default 2, like make_level_kit)'),
      palette: paletteArg,
      filename: z.string().optional(),
    }),
    async handler(a) {
      const ids = a.ids ?? (a.group ? engine.childrenOf(a.group).filter((id) => !engine.scene.objects[id].cutterFor) : []);
      if (!ids.length) throw new CommandError('Give a group (e.g. a level kit) or ids.');
      const tw = a.tileWidth ?? 64, grid = a.gridSize ?? 2;
      // a grid cell's diagonal spans the tile width in a 45° view
      const ppm = tw / (grid * Math.SQRT2);
      const out = await engine.bridge.request('sprite_atlas', {
        targets: ids, frameSize: Math.round(tw * 1.5), pixelsPerMetre: ppm, elevation: 30, azimuthOffset: 45,
        palette: pickPalette(a.palette), outlineStyle: 'selout', outline: '#16171b',
      });
      return saveSheet({ ...out, filename: a.filename ?? 'iso_tiles', kind: 'sheets' });
    },
  });
}
