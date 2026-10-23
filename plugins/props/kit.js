// Shared helpers for the prop generators: define a generator command and build its parts.

export function defineGenerator(registry, z, engine, { name, title, description, input, build }) {
  registry.define({
    name,
    title,
    category: 'generators',
    description: `${description} Builds one group and returns its id. Common options: position, seed (different variation), name.`,
    input: input(z).extend({
      position: z.array(z.number()).length(3).optional(),
      rotation: z.array(z.number()).length(3).optional().describe('Degrees'),
      seed: z.number().int().optional(),
      name: z.string().optional(),
    }),
    async handler(args, ctx) {
      let id;
      await engine.batch(async () => {
        const k = kit(engine, ctx, args.seed ?? 1);
        const root = await k.add({ type: 'group', name: args.name ?? title.toLowerCase().replace(/\s+/g, '_'), position: args.position ?? [0, 0, 0], rotation: args.rotation });
        id = root.id;
        await build(args, k, id);
      });
      engine.changed();
      return { id };
    },
  });
}

export function kit(engine, ctx, seed) {
  const rand = mulberry32(seed);
  const add = (a) => engine.execute('add_object', a, ctx.meta);
  return {
    meta: ctx.meta,
    rand,
    // random number between a and b
    range: (a, b) => a + rand() * (b - a),
    add,
    part: (parent, type, name, position, params, material, extra = {}) =>
      add({ type, name, parent, position, params, material, ...extra }).then((r) => r.id),
    group: (parent, name, position = [0, 0, 0], rotation) =>
      add({ type: 'group', name, parent, position, rotation }).then((r) => r.id),
    cut: (target, cutter, op = 'subtract') => engine.execute('cut_object', { target, cutter, op }, ctx.meta),
    repeat: (id, args) => engine.execute('repeat_object', { id, ...args }, ctx.meta),
    mirror: (id, args) => engine.execute('mirror_object', { id, ...args }, ctx.meta),
    update: (id, args) => engine.execute('update_object', { id, ...args }, ctx.meta),
    shade,
  };
}

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Lighten (amount > 0) or darken (amount < 0) a hex colour.
export function shade(hex, amount) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amount))));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export const hex = (z) => z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like "#aa7744"');
