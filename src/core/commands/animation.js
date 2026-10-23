import { ANIMATION_PRESETS } from '../../shared/animations.js';
import { CommandError } from '../registry.js';
import { vec3 } from './common.js';

export function register(registry, { z, engine }) {
  const anims = () => (engine.scene.animations ??= {});
  const getAnim = (name, create, duration) => {
    const all = anims();
    if (!Object.hasOwn(all, name)) {
      if (!create) throw new CommandError(`No animation "${name}". Existing: ${Object.keys(all).join(', ') || '(none)'}`);
      all[name] = { duration: duration ?? 2, loop: true, tracks: [] };
    }
    if (duration) all[name].duration = duration;
    return all[name];
  };
  const animName = z.string().regex(/^[a-zA-Z0-9_-]+$/)
    .refine((n) => !['__proto__', 'constructor', 'prototype'].includes(n), 'That name is reserved; choose another.').optional().describe('Animation name, default "idle". One scene can hold several (idle, open, hit...)');

  registry.define({
    name: 'animate_object',
    title: 'Animate object',
    category: 'animation',
    mutates: true,
    description:
      'Add a ready-made movement to an object or group. Presets: ' +
      Object.entries(ANIMATION_PRESETS).map(([k, v]) => `${k} (${v.description}; params ${JSON.stringify(v.params)})`).join('; ') + '. ' +
      'Several presets on the same object add up (e.g. spin + bob for a pickup). Animations loop over "duration" seconds; ' +
      'they show in the window, in sprite sheets and in exported GLB files (Godot gets an AnimationPlayer).',
    input: z.object({
      id: z.string(),
      preset: z.enum(Object.keys(ANIMATION_PRESETS)),
      params: z.record(z.string(), z.any()).optional(),
      animation: animName,
      duration: z.number().min(0.1).max(120).optional().describe('Seconds for one loop of the whole animation'),
      speed: z.number().int().min(1).max(16).optional().describe('Repeat this movement N times per loop (whole numbers keep loops seamless)'),
      offset: z.number().min(0).max(1).optional().describe('Start later in the cycle (0..1), to make copies move out of step'),
    }),
    handler({ id, preset, params = {}, animation = 'idle', duration, speed, offset }) {
      engine.getObject(id);
      const known = ANIMATION_PRESETS[preset].params;
      const unknown = Object.keys(params).filter((k) => !(k in known));
      if (unknown.length) throw new CommandError(`Unknown params for ${preset}: ${unknown.join(', ')}. Allowed: ${Object.keys(known).join(', ')}`);
      const a = getAnim(animation, true, duration);
      a.tracks.push({ target: id, preset, params, speed: speed ?? 1, offset: offset ?? 0 });
      return { animation, ...a };
    },
  });

  registry.define({
    name: 'set_keyframes',
    title: 'Set keyframes',
    category: 'animation',
    mutates: true,
    description:
      'Custom movement for an object: keys = [{ t: 0..1, position?: [x,y,z], rotation?: [deg,deg,deg], scale?: [x,y,z] }]. ' +
      'Values are offsets from the object\'s normal pose (scale multiplies). Replaces earlier custom keys for that object in this animation. ' +
      'For a seamless loop, make the last key equal to the first.',
    input: z.object({
      id: z.string(),
      animation: animName,
      duration: z.number().min(0.1).max(120).optional(),
      keys: z.array(z.object({ t: z.number().min(0).max(1), position: vec3.optional(), rotation: vec3.optional(), scale: vec3.optional() })).min(2),
    }),
    handler({ id, animation = 'idle', duration, keys }) {
      engine.getObject(id);
      const a = getAnim(animation, true, duration);
      a.tracks = a.tracks.filter((t) => !(t.target === id && t.keys));
      a.tracks.push({ target: id, keys });
      return { animation, ...a };
    },
  });

  registry.define({
    name: 'set_animation',
    title: 'Animation settings',
    category: 'animation',
    mutates: true,
    description: 'Change an animation\'s length (seconds), looping, or name.',
    input: z.object({ animation: z.string(), duration: z.number().min(0.1).max(120).optional(), loop: z.boolean().optional(), rename: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional() }),
    handler({ animation, duration, loop, rename }) {
      const a = getAnim(animation, false);
      if (duration) a.duration = duration;
      if (loop !== undefined) a.loop = loop;
      if (rename && rename !== animation) {
        if (anims()[rename]) throw new CommandError(`Animation "${rename}" already exists.`);
        anims()[rename] = a;
        delete anims()[animation];
      }
      return { animation: rename ?? animation, ...a };
    },
  });

  registry.define({
    name: 'remove_animation',
    title: 'Remove animation',
    category: 'animation',
    mutates: true,
    description: 'Remove the movement of one object from an animation (give id), or the whole animation (no id).',
    input: z.object({ animation: z.string(), id: z.string().optional() }),
    handler({ animation, id }) {
      const a = getAnim(animation, false);
      if (id) a.tracks = a.tracks.filter((t) => t.target !== id);
      if (!id || !a.tracks.length) delete anims()[animation];
      return { animations: Object.keys(anims()) };
    },
  });

  registry.define({
    name: 'list_animations',
    title: 'List animations',
    category: 'animation',
    description: 'List the scene\'s animations with their tracks.',
    handler: () => anims(),
  });
}
