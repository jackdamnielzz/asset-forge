import { safeName } from '../engine.js';
import { PixelLab } from '../pixellab.js';
import { storeImage } from './assets.js';

// Every PixelLab tool with every setting, read from PixelLab's own specification.
export function register(registry, { z, engine }) {
  const pl = new PixelLab(engine);
  engine.pixellab = pl;

  registry.define({
    name: 'pixellab_tools',
    title: 'PixelLab tools',
    category: 'pixellab',
    description:
      'List every tool PixelLab offers (images, characters in 4/8 directions, animations, tilesets, isometric tiles, UI, fonts, effects, editing...), ' +
      'read live from PixelLab\'s own specification. Use pixellab_tool_info to see all settings of one tool and pixellab_run to use it. Needs a connected PixelLab key.',
    input: z.object({ category: z.string().optional(), refresh: z.boolean().optional().describe('Reload the list from PixelLab') }),
    async handler({ category, refresh }) {
      await pl.config();
      if (refresh) await pl.spec(true);
      const tools = await pl.tools();
      return category ? tools.filter((t) => t.category.toLowerCase().includes(category.toLowerCase())) : tools;
    },
  });

  registry.define({
    name: 'pixellab_tool_info',
    title: 'PixelLab tool settings',
    category: 'pixellab',
    description:
      'All settings of one PixelLab tool with their descriptions, allowed values, defaults and limits (as a JSON schema). ' +
      'Fields marked x-image take a picture: give a library image id ("img_..."), or { "render": "<object id>" } to send a render of a 3D object.',
    input: z.object({ tool: z.string() }),
    async handler({ tool }) {
      await pl.config();
      return pl.info(tool.replace(/^\//, ''));
    },
  });

  registry.define({
    name: 'pixellab_run',
    title: 'Run PixelLab tool',
    category: 'pixellab',
    description:
      'Run any PixelLab tool with any of its settings (see pixellab_tool_info). Pictures go in as library ids or { render: objectId }. ' +
      'Long jobs (characters, animations, tilesets...) are followed until finished. Every picture in the result is added to the library; ' +
      'the first one is returned so you can look at it. This costs PixelLab generations or credits: ask the user first.',
    input: z.object({
      tool: z.string(),
      params: z.record(z.string(), z.any()).optional(),
      pathParams: z.record(z.string(), z.string()).optional().describe('For tools with an id in their address, e.g. { "object_id": "..." }'),
      name: z.string().optional().describe('Base name for the pictures in the library'),
    }),
    async handler({ tool, params = {}, pathParams = {}, name }) {
      const t = tool.replace(/^\//, '');
      const status = (s) => engine.emit('log', { command: `pixellab ${t}: ${s}`, source: 'ai-service', ok: true, time: Date.now() });
      status('sent');
      const out = await pl.run(t, params, { pathParams, onStatus: status });
      const base = safeName(name ?? params.description ?? params.prompt ?? t).slice(0, 40);
      const assets = [];
      for (const [i, img] of out.images.entries()) {
        try {
          const a = await storeImage(engine, img.buf, out.images.length > 1 ? `${base}_${img.label || i + 1}` : base, { madeBy: { service: 'pixellab', tool: t, prompt: params.description ?? params.prompt ?? null } });
          assets.push({ assetId: a.id, label: img.label, width: a.width, height: a.height });
        } catch { /* not an image we can store (e.g. a zip) */ }
      }
      const first = assets[0] && out.images.find((_, i) => i === 0);
      return {
        tool: t, assets, usage: out.usage, jobId: out.jobId, response: out.response,
        ...(first ? { image: first.buf.toString('base64'), mime: 'image/png' } : {}),
        note: assets.length ? undefined : 'No pictures in the result; see response (e.g. ids of things saved in your PixelLab account).',
      };
    },
  });

  registry.define({
    name: 'pixellab_balance',
    title: 'PixelLab balance',
    category: 'pixellab',
    description: 'Show the remaining PixelLab credits and subscription generations (free to call).',
    handler: () => pl.balance(),
  });
}
