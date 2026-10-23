import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CommandError } from '../registry.js';
import { imageInfo } from '../images.js';

export function register(registry, { z, engine }) {
  registry.define({
    name: 'import_image',
    title: 'Import image',
    category: 'assets',
    description:
      'Add a picture (PNG, JPG, WebP, GIF) to the image library so it can be used as a texture or as an image object. ' +
      'Give exactly one of: path (file on this computer), url (http/https), or data (base64 or data: URL). ' +
      'Returns assetId. Set addToScene to also place it in the scene as a flat picture.',
    input: z.object({
      path: z.string().optional(),
      url: z.string().url().optional(),
      data: z.string().optional(),
      name: z.string().optional(),
      addToScene: z.boolean().optional(),
    }),
    async handler(args) {
      const sources = ['path', 'url', 'data'].filter((k) => args[k]);
      if (sources.length !== 1) throw new CommandError('Give exactly one of path, url or data.');
      let buf;
      let fallbackName = 'image';
      if (args.path) {
        buf = await fs.readFile(args.path).catch(() => { throw new CommandError(`Cannot read file ${args.path}`); });
        fallbackName = path.parse(args.path).name;
      } else if (args.url) {
        const res = await fetch(args.url);
        if (!res.ok) throw new CommandError(`Download failed: HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
        fallbackName = path.parse(new URL(args.url).pathname).name || 'image';
      } else {
        buf = Buffer.from(args.data.replace(/^data:[^,]+,/, ''), 'base64');
      }
      const info = imageInfo(buf);
      if (!info) throw new CommandError('Not a supported image (PNG, JPG, WebP or GIF).');
      const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
      const id = `img_${hash}`;
      const file = `${id}.${info.format}`;
      await fs.writeFile(path.join(engine.paths.images, file), buf);
      engine.library.images[id] = {
        id, name: args.name ?? fallbackName, file, width: info.width, height: info.height, mime: info.mime, added: new Date().toISOString(),
      };
      await engine.saveLibrary();
      engine.emit('library', engine.library);
      let objectId;
      if (args.addToScene) {
        const r = await engine.execute('add_object', { type: 'image', name: args.name ?? fallbackName, params: { assetId: id } }, { source: 'import' });
        objectId = r.id;
      }
      return { assetId: id, width: info.width, height: info.height, objectId };
    },
  });

  registry.define({
    name: 'list_images',
    title: 'List images',
    category: 'assets',
    description: 'List all images in the library (id, name, size).',
    handler: () => Object.values(engine.library.images),
  });
}
