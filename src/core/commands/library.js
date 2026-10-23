import fs from 'node:fs/promises';
import path from 'node:path';
import { safeName } from '../engine.js';
import { CommandError } from '../registry.js';

// The asset library: finished assets (saved as recipes with a thumbnail), plus all images
// and 3D models, with tags and descriptions, searchable from the window and by AIs.
export function register(registry, { z, engine }) {
  const lib = engine.library;
  const thumbs = path.join(engine.paths.library, 'thumbs');
  const tagList = z.array(z.string().min(1).max(40)).max(30);
  const kinds = ['asset', 'image', 'model'];
  const entry = (kind, id) => {
    const list = kind === 'asset' ? (lib.assets ??= {}) : kind === 'image' ? lib.images : (lib.models ??= {});
    const e = list[id];
    if (!e) throw new CommandError(`No ${kind} "${id}" in the library. See search_library.`);
    return { list, e };
  };
  const saveLib = async () => { await engine.saveLibrary(); engine.emit('library', engine.library); };

  registry.define({
    name: 'save_asset',
    title: 'Save to asset library',
    category: 'library',
    description:
      'Save a finished object to the asset library with a thumbnail, tags and a description, so it can be found (search_library) and placed in any project (place_asset). ' +
      'Tags like "prop", "medieval", "wood", "pixel" make searching easy.',
    input: z.object({ id: z.string(), name: z.string().optional(), tags: tagList.optional(), description: z.string().max(500).optional() }),
    async handler({ id, name, tags = [], description = '' }, ctx) {
      const o = engine.getObject(id);
      const assetName = safeName(name ?? o.name);
      await engine.execute('save_recipe', { id, name: assetName }, ctx.meta);
      const shot = await engine.render({ view: 'iso', width: 256, height: 256, target: id, isolate: true, ground: false, background: 'transparent', padding: 0.04 });
      await fs.mkdir(thumbs, { recursive: true });
      await fs.writeFile(path.join(thumbs, `${assetName}.png`), Buffer.from(shot.png, 'base64'));
      (lib.assets ??= {})[assetName] = {
        id: assetName, name: assetName, tags: normalizeTags(tags), description, thumb: `${assetName}.png`, recipe: assetName,
        madeWith: o.recipe?.command ?? null, project: engine.scene.name, saved: new Date().toISOString(),
      };
      await saveLib();
      return { asset: assetName, image: shot.png, mime: 'image/png' };
    },
  });

  registry.define({
    name: 'place_asset',
    title: 'Place asset',
    category: 'library',
    description: 'Place a saved library asset in the current scene.',
    input: z.object({ name: z.string(), position: z.array(z.number()).length(3).optional() }),
    async handler({ name, position }, ctx) {
      const { e } = entry('asset', name);
      return engine.execute('use_recipe', { name: e.recipe, position }, ctx.meta);
    },
  });

  registry.define({
    name: 'tag_item',
    title: 'Tag library item',
    category: 'library',
    description: 'Set the tags (and optionally the description or name) of a library asset, image or model.',
    input: z.object({ kind: z.enum(kinds), id: z.string(), tags: tagList.optional(), description: z.string().max(500).optional(), name: z.string().optional() }),
    async handler({ kind, id, tags, description, name }) {
      const { e } = entry(kind, id);
      if (tags) e.tags = normalizeTags(tags);
      if (description !== undefined) e.description = description;
      if (name) e.name = name;
      await saveLib();
      return e;
    },
  });

  registry.define({
    name: 'search_library',
    title: 'Search library',
    category: 'library',
    description:
      'Search everything in the library: saved assets, images and 3D models, by words (name, tags, description, the prompt an AI image was made with) and/or tags. ' +
      'Without a query it lists everything, newest first.',
    input: z.object({ query: z.string().optional(), tags: tagList.optional(), kind: z.enum(kinds).optional(), limit: z.number().int().min(1).max(500).optional() }),
    handler({ query = '', tags = [], kind, limit = 100 }) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const want = normalizeTags(tags);
      const items = [
        ...Object.values(lib.assets ?? {}).map((e) => ({ kind: 'asset', ...e, thumbUrl: `/library/thumbs/${e.thumb}` })),
        ...Object.values(lib.images).map((e) => ({ kind: 'image', ...e, thumbUrl: `/library/images/${e.file}` })),
        ...Object.values(lib.models ?? {}).map((e) => ({ kind: 'model', ...e, thumbUrl: null })),
      ].filter((i) => !kind || i.kind === kind);
      const scored = items.map((i) => {
        const hay = [i.name, i.description, ...(i.tags ?? []), i.madeBy?.prompt, i.madeWith].filter(Boolean).join(' ').toLowerCase();
        const score = words.reduce((s, w) => s + (hay.includes(w) ? (i.name?.toLowerCase().includes(w) ? 3 : 1) : 0), 0);
        const tagOk = want.every((t) => (i.tags ?? []).includes(t));
        return { i, score, ok: tagOk && (!words.length || score > 0) };
      }).filter((s) => s.ok);
      scored.sort((a, b) => b.score - a.score || String(b.i.saved ?? b.i.added).localeCompare(String(a.i.saved ?? a.i.added)));
      const allTags = [...new Set(items.flatMap((i) => i.tags ?? []))].sort();
      return { total: scored.length, tags: allTags, items: scored.slice(0, limit).map((s) => s.i) };
    },
  });

  registry.define({
    name: 'delete_library_item',
    title: 'Delete from library',
    category: 'library',
    description:
      'Permanently remove an asset, image or model from the library (its file too). Ask the user first. ' +
      'An image or model that objects in the open project still use is only removed with force: true (those objects then lose it).',
    input: z.object({ kind: z.enum(kinds), id: z.string(), force: z.boolean().optional().describe('Also remove it when objects in the open project still use it') }),
    async handler({ kind, id, force = false }) {
      const { list, e } = entry(kind, id);
      const users = Object.values(engine.scene.objects)
        .filter((o) => (kind === 'image' && (o.material?.texture === id || o.params?.assetId === id)) || (kind === 'model' && o.params?.assetId === id))
        .map((o) => o.id);
      if (users.length && !force) throw new CommandError(`"${id}" is still used by ${users.join(', ')}. Pass force: true to remove it anyway.`);
      const files = kind === 'asset'
        ? [path.join(thumbs, e.thumb), path.join(engine.paths.library, 'recipes', `${e.recipe}.json`)]
        : kind === 'image' ? [path.join(engine.paths.images, e.file)] : [path.join(engine.paths.library, 'models', e.file)];
      for (const f of files) await fs.rm(f, { force: true });
      delete list[id];
      if (kind === 'asset') delete lib.recipes?.[e.recipe];
      await saveLib();
      return { deleted: id, ...(users.length ? { brokenObjects: users } : {}) };
    },
  });
}

function normalizeTags(tags) {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
