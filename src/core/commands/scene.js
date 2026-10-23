import { LIGHTING_PRESETS, MATERIAL_PRESETS } from '../../shared/presets.js';
import { CommandError } from '../registry.js';
import { emptyScene } from '../engine.js';
import { vec3, color } from './common.js';

export function register(registry, { z, engine }) {
  registry.define({
    name: 'get_scene',
    title: 'Get scene',
    category: 'scene',
    description: 'Return the whole scene: all objects (ids, transforms, params, materials), environment and camera. Call this first to see what exists.',
    handler: () => engine.scene,
  });

  registry.define({
    name: 'clear_scene',
    title: 'Clear scene',
    category: 'scene',
    mutates: true,
    description: 'Remove all objects. Keeps the project name and environment.',
    handler() {
      engine.scene.objects = {};
      engine.scene.order = [];
      return { ok: true };
    },
  });

  registry.define({
    name: 'set_environment',
    title: 'Set lighting & background',
    category: 'scene',
    mutates: true,
    description:
      'Choose a lighting preset and background. Presets: ' +
      Object.entries(LIGHTING_PRESETS).map(([k, v]) => `${k} (${v.description})`).join(' '),
    input: z.object({
      lighting: z.enum(Object.keys(LIGHTING_PRESETS)).optional(),
      exposure: z.number().min(0.1).max(4).optional().describe('Overall brightness, 1 = normal'),
      background: color.nullable().optional().describe('Background colour, "transparent", or null for the preset default'),
      ground: z.boolean().optional().describe('Show a soft shadow-catching ground'),
      groundColor: color.nullable().optional(),
    }),
    handler(args) {
      for (const [k, v] of Object.entries(args)) if (v !== undefined) engine.scene.environment[k] = v;
      return engine.scene.environment;
    },
  });

  registry.define({
    name: 'set_camera',
    title: 'Set camera',
    category: 'scene',
    mutates: true,
    description: 'Set the scene camera used by the "camera" render view and shown in the window.',
    input: z.object({ position: vec3.optional(), target: vec3.optional() }),
    handler(args) {
      if (args.position) engine.scene.camera.position = args.position;
      if (args.target) engine.scene.camera.target = args.target;
      return engine.scene.camera;
    },
  });

  registry.define({
    name: 'load_scene',
    title: 'Load scene recipe',
    category: 'scene',
    mutates: true,
    description: 'Replace the current scene with a full scene JSON (the format returned by get_scene). Useful for recipes.',
    input: z.object({ scene: z.record(z.string(), z.any()) }),
    handler({ scene }) {
      const base = emptyScene(engine.scene.name);
      const next = { ...base, ...scene, name: engine.scene.name, environment: { ...base.environment, ...scene.environment } };
      if (!next.order) next.order = Object.keys(next.objects ?? {});
      engine.scene.objects = next.objects ?? {};
      engine.scene.order = next.order;
      engine.scene.environment = next.environment;
      engine.scene.camera = next.camera ?? base.camera;
      return { objects: engine.scene.order.length };
    },
  });

  registry.define({
    name: 'undo',
    title: 'Undo',
    category: 'scene',
    description: 'Undo the last change.',
    handler: () => ({ undone: engine.undo() }),
  });

  registry.define({
    name: 'redo',
    title: 'Redo',
    category: 'scene',
    description: 'Redo the last undone change.',
    handler: () => ({ redone: engine.redo() }),
  });

  registry.define({
    name: 'run_batch',
    title: 'Run batch',
    category: 'scene',
    description:
      'Run many commands in one go, as a single undo step. If one fails, everything is rolled back. ' +
      'Use "$N.id" inside string arguments to refer to the id returned by command number N (0-based), e.g. parent: "$0.id".',
    input: z.object({
      commands: z.array(z.object({ command: z.string(), args: z.record(z.string(), z.any()).optional() })).min(1),
    }),
    async handler({ commands }, ctx) {
      const results = [];
      await engine.batch(async () => {
        for (const [i, step] of commands.entries()) {
          if (step.command === 'run_batch') throw new CommandError('run_batch cannot be nested.');
          try {
            results.push(await engine.execute(step.command, resolveRefs(step.args ?? {}, results), ctx.meta));
          } catch (err) {
            throw new CommandError(`Step ${i} (${step.command}) failed: ${err.message}`);
          }
        }
      });
      engine.changed();
      return { results };
    },
  });

  registry.define({
    name: 'list_commands',
    title: 'List commands',
    category: 'help',
    description: 'List every available command (including plugin commands). Pass withSchemas to include input schemas.',
    input: z.object({ withSchemas: z.boolean().optional() }),
    handler({ withSchemas }) {
      return registry.list().map((c) => (withSchemas ? c : { name: c.name, category: c.category, description: c.description }));
    },
  });

  registry.define({
    name: 'list_presets',
    title: 'List presets',
    category: 'help',
    description: 'List material and lighting presets with their values.',
    handler: () => ({
      materials: MATERIAL_PRESETS,
      lighting: Object.fromEntries(Object.entries(LIGHTING_PRESETS).map(([k, v]) => [k, v.description])),
    }),
  });

  registry.define({
    name: 'list_plugins',
    title: 'List plugins',
    category: 'help',
    description: 'List loaded plugins.',
    handler: () => engine.plugins,
  });
}

function resolveRefs(value, results) {
  if (typeof value === 'string') {
    const m = value.match(/^\$(\d+)\.(\w+)$/);
    if (m) {
      const r = results[Number(m[1])];
      if (!r || r[m[2]] === undefined) throw new CommandError(`Reference ${value} not found`);
      return r[m[2]];
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, results));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, results)]));
  return value;
}
