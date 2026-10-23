import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CommandError } from '../registry.js';
import { imageInfo } from '../images.js';

// Read the bytes of a file given as exactly one of { path, url, data }.
export async function readSource(args, fallback = 'asset') {
  const sources = ['path', 'url', 'data'].filter((k) => args[k]);
  if (sources.length !== 1) throw new CommandError('Give exactly one of path, url or data.');
  if (args.path) {
    const buf = await fs.readFile(args.path).catch(() => { throw new CommandError(`Cannot read file ${args.path}`); });
    return { buf, name: path.parse(args.path).name };
  }
  if (args.url) {
    let res;
    try {
      res = await fetch(args.url, { signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      throw new CommandError(`Download failed: ${err.name === 'TimeoutError' ? 'it took longer than 2 minutes' : err.message}`);
    }
    if (!res.ok) throw new CommandError(`Download failed: HTTP ${res.status}`);
    return { buf: await readLimited(res), name: path.parse(new URL(args.url).pathname).name || fallback };
  }
  return { buf: Buffer.from(args.data.replace(/^data:[^,]+,/, ''), 'base64'), name: fallback };
}

// Read a download, but stop at MAX_DOWNLOAD so a huge or endless file cannot fill the memory.
const MAX_DOWNLOAD = 500 * 1024 * 1024;
async function readLimited(res) {
  if (Number(res.headers.get('content-length')) > MAX_DOWNLOAD) throw new CommandError('Download is too big (over 500 MB).');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_DOWNLOAD) throw new CommandError('Download is too big (over 500 MB).');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function storeImage(engine, buf, name, meta = {}) {
  const info = imageInfo(buf);
  if (!info) throw new CommandError('Not a supported image (PNG, JPG, WebP or GIF).');
  const id = `img_${hash(buf)}`;
  const file = `${id}.${info.format}`;
  await fs.writeFile(path.join(engine.paths.images, file), buf);
  engine.library.images[id] = { id, name, file, width: info.width, height: info.height, mime: info.mime, added: new Date().toISOString(), ...meta };
  await engine.saveLibrary();
  engine.emit('library', engine.library);
  return engine.library.images[id];
}

// 3D models (.glb) and videos (.mp4/.webm) are stored the same way, in their own lists.
export async function storeFile(engine, kind, buf, name, meta = {}) {
  const ext = kind === 'models' ? 'glb' : detectVideo(buf);
  if (kind === 'models' && buf.toString('ascii', 0, 4) !== 'glTF') throw new CommandError('Only binary glTF (.glb) models are supported.');
  const id = `${kind === 'models' ? 'mdl' : 'vid'}_${hash(buf)}`;
  const dir = path.join(engine.paths.library, kind);
  await fs.mkdir(dir, { recursive: true });
  const file = `${id}.${ext}`;
  await fs.writeFile(path.join(dir, file), buf);
  engine.library[kind] ??= {};
  engine.library[kind][id] = { id, name, file, bytes: buf.length, added: new Date().toISOString(), ...meta };
  await engine.saveLibrary();
  engine.emit('library', engine.library);
  return engine.library[kind][id];
}

const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);

function detectVideo(buf) {
  if (buf.toString('ascii', 4, 8) === 'ftyp') return 'mp4';
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  throw new CommandError('Not a supported video (MP4 or WebM).');
}

export function register(registry, { z, engine }) {
  registry.define({
    name: 'import_image',
    title: 'Import image',
    category: 'assets',
    description:
      'Add a picture (PNG, JPG, WebP, GIF) to the image library so it can be used as a texture or as an image object. ' +
      'Give exactly one of: path (file on this computer), url (http/https), or data (base64 or data: URL). ' +
      'Returns assetId. Set addToScene to also place it in the scene as a flat picture. ' +
      'Tip for AIs with their own image tools (e.g. PixelLab): generate the picture there, then import it here with data or url.',
    input: z.object({
      path: z.string().optional(),
      url: z.string().url().optional(),
      data: z.string().optional(),
      name: z.string().optional(),
      addToScene: z.boolean().optional(),
    }),
    async handler(args) {
      const { buf, name } = await readSource(args, 'image');
      const asset = await storeImage(engine, buf, args.name ?? name);
      let objectId;
      if (args.addToScene) {
        const r = await engine.execute('add_object', { type: 'image', name: asset.name, params: { assetId: asset.id } }, { source: 'import' });
        objectId = r.id;
      }
      return { assetId: asset.id, width: asset.width, height: asset.height, objectId };
    },
  });

  registry.define({
    name: 'import_model',
    title: 'Import 3D model',
    category: 'assets',
    description:
      'Add a ready-made 3D model (.glb, e.g. from Sketchfab, Blender, an AI 3D service or Asset Forge itself) to the library ' +
      'and place it in the scene as a "model" object. Give exactly one of path, url or data. size = height in metres (0 keeps the original size).',
    input: z.object({
      path: z.string().optional(),
      url: z.string().url().optional(),
      data: z.string().optional(),
      name: z.string().optional(),
      addToScene: z.boolean().optional().describe('Default true'),
      size: z.number().min(0).max(1000).optional(),
    }),
    async handler(args) {
      const { buf, name } = await readSource(args, 'model');
      const asset = await storeFile(engine, 'models', buf, args.name ?? name);
      let objectId;
      if (args.addToScene !== false) {
        const r = await engine.execute('add_object', { type: 'model', name: asset.name, params: { assetId: asset.id, size: args.size ?? 1 } }, { source: 'import' });
        objectId = r.id;
      }
      return { modelId: asset.id, objectId };
    },
  });

  registry.define({
    name: 'list_images',
    title: 'List images',
    category: 'assets',
    description: 'List all images in the library (id, name, size, and how AI-made ones were made).',
    handler: () => Object.values(engine.library.images),
  });

  registry.define({
    name: 'list_library',
    title: 'List library',
    category: 'assets',
    description: 'List everything in the library: images, 3D models and videos.',
    handler: () => ({
      images: Object.values(engine.library.images),
      models: Object.values(engine.library.models ?? {}),
      videos: Object.values(engine.library.videos ?? {}),
    }),
  });
}
