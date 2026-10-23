import { LIGHTING_PRESETS, MATERIAL_PRESETS, PATTERNS, STYLES, DEFAULT_EFFECTS, DEFAULT_STYLE_OPTIONS } from '../../shared/presets.js';
import { CommandError, AccessError } from '../registry.js';
import { emptyScene } from '../engine.js';
import { vec3, color, checkScene } from './common.js';

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
    description: 'Remove all objects. Keeps the project name and environment. A version is saved first (see list_versions).',
    async handler() {
      await engine.history.save(engine.scene, 'safety', 'before clearing the scene');
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
    name: 'set_style',
    title: 'Set style',
    category: 'scene',
    mutates: true,
    description:
      'Switch the overall look of the whole scene without changing the objects. Styles: ' +
      Object.entries(STYLES).map(([k, v]) => `${k} (${v})`).join('; ') + '. ' +
      'Tip: "clay" is useful to judge shapes; switch back to "realistic" afterwards.',
    input: z.object({
      style: z.enum(Object.keys(STYLES)).optional(),
      outlineWidth: z.number().min(0).max(5).optional().describe('Toon style: outline thickness, 0 = none'),
      outlineColor: color.optional().describe('Toon style: outline colour'),
      toonSteps: z.number().int().min(2).max(6).optional().describe('Toon style: number of light/shadow bands'),
    }),
    handler({ style, ...opts }) {
      const env = engine.scene.environment;
      if (style) env.style = style;
      env.styleOptions = { ...DEFAULT_STYLE_OPTIONS, ...env.styleOptions };
      for (const [k, v] of Object.entries(opts)) if (v !== undefined) env.styleOptions[k] = v;
      return { style: env.style, ...env.styleOptions };
    },
  });

  registry.define({
    name: 'set_effects',
    title: 'Set picture effects',
    category: 'scene',
    mutates: true,
    description:
      'Picture effects. ao = soft contact shadows in corners and where objects touch (makes things look grounded). ' +
      'bloom = soft glow around bright and glowing (emissive) parts. Both are on by default.',
    input: z.object({
      ao: z.boolean().optional(),
      aoStrength: z.number().min(0).max(3).optional(),
      bloom: z.boolean().optional(),
      bloomStrength: z.number().min(0).max(3).optional(),
      bloomThreshold: z.number().min(0).max(5).optional().describe('How bright something must be before it glows (default 2.5 = only glowing parts; lower = brightly lit surfaces glow too)'),
    }),
    handler(args) {
      const env = engine.scene.environment;
      env.effects = { ...DEFAULT_EFFECTS, ...env.effects };
      for (const [k, v] of Object.entries(args)) if (v !== undefined) env.effects[k] = v;
      return env.effects;
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
    async handler({ scene }) {
      await engine.history.save(engine.scene, 'safety', 'before loading a scene recipe');
      const base = emptyScene(engine.scene.name);
      const next = checkScene({ ...base, ...scene, name: engine.scene.name, environment: { ...base.environment, ...scene.environment } });
      engine.scene.objects = next.objects;
      engine.scene.order = next.order;
      engine.scene.environment = next.environment;
      engine.scene.camera = next.camera ?? base.camera;
      engine.scene.animations = next.animations ?? {};
      return { objects: engine.scene.order.length };
    },
  });

  registry.define({
    name: 'undo',
    title: 'Undo',
    category: 'scene',
    description: 'Undo the last change.',
    handler: async () => ({ undone: await engine.undo() }),
  });

  registry.define({
    name: 'redo',
    title: 'Redo',
    category: 'scene',
    description: 'Redo the last undone change.',
    handler: async () => ({ redone: await engine.redo() }),
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
            const Kind = err instanceof AccessError ? AccessError : CommandError;
            throw new Kind(`Step ${i} (${step.command}) failed: ${err.message}`);
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
    description: 'List material presets, generated patterns, styles and lighting presets.',
    handler: () => ({
      materials: MATERIAL_PRESETS,
      patterns: Object.fromEntries(Object.entries(PATTERNS).map(([k, v]) => [k, v.description])),
      styles: STYLES,
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
