// Example plugin: a parametric wooden crate generator.
// Plugins are folders in /plugins with an index.js that exports a default function.
// Everything a plugin registers shows up in the window's API, the MCP tools and the CLI.

export const description = 'Generates wooden crates with a frame, diagonal braces and optional metal corners.';

export default function register({ registry, z, engine }) {
  registry.define({
    name: 'make_crate',
    title: 'Make crate',
    category: 'generators',
    description:
      'Build a wooden crate as one group (frame posts, beams, diagonal braces, panels, optional metal corners). ' +
      'Returns the group id. Vary seed for different wood tones.',
    input: z.object({
      size: z.number().min(0.2).max(10).optional().describe('Edge length in metres (default 1)'),
      position: z.array(z.number()).length(3).optional(),
      woodColor: z.string().optional().describe('Lightest wood tone as hex, e.g. "#c8955c" (default warm oak)'),
      metalCorners: z.boolean().optional(),
      braces: z.boolean().optional().describe('Diagonal braces on front and back (default true)'),
      seed: z.number().int().optional(),
      wear: z.number().min(0).max(1).optional().describe('Age: 0 = new, 1 = very old and dirty'),
      name: z.string().optional(),
    }),
    async handler(args, ctx) {
      const s = args.size ?? 1;
      const t = s * 0.12; // beam thickness
      const wood = args.woodColor ?? '#c8955c';
      const rand = mulberry32(args.seed ?? 1);
      const tone = (amt) => shade(wood, (rand() - 0.5) * amt);
      const meta = ctx.meta;
      const add = (a) => engine.execute('add_object', a, meta);
      const wear = args.wear ?? 0;
      const seed = args.seed ?? 1;
      // Upright parts get vertical grain (angle 90); a few seeds keep the parts from looking identical.
      const woodMat = (angle = 0, amt = 0.18) => ({
        preset: 'oak', color: tone(amt), roughness: 0.7 + rand() * 0.15, wear,
        pattern: { type: 'wood', scale: s * 0.7, angle, seed: seed * 3 + Math.floor(rand() * 3) },
      });

      let groupId;
      await engine.batch(async () => {
        const group = await add({ type: 'group', name: args.name ?? 'crate', position: args.position ?? [0, 0, 0] });
        groupId = group.id;
        const box = (name, size, position, material, rotation = [0, 0, 0], bevel = t * 0.12) =>
          add({ type: 'box', name, parent: groupId, position, rotation, params: { width: size[0], height: size[1], depth: size[2], bevel }, material });

        // recessed panels
        await box('panels', [s - t * 0.9, s - t * 0.9, s - t * 0.9], [0, s / 2, 0], {
          preset: 'floor_planks', color: shade(wood, -0.15), roughness: 0.85, wear,
          pattern: { scale: s * 0.9, seed },
        }, [0, 0, 0], t * 0.05);

        // corner posts
        const h = s / 2 - t / 2;
        for (const [x, z] of [[-h, -h], [h, -h], [-h, h], [h, h]]) {
          await box('post', [t, s, t], [x, s / 2, z], woodMat(90));
        }
        // top and bottom beams
        for (const y of [t / 2, s - t / 2]) {
          for (const z of [-h, h]) await box('beam', [s - 2 * t, t, t], [0, y, z], woodMat());
          for (const x of [-h, h]) await box('beam', [t, t, s - 2 * t], [x, y, 0], woodMat());
        }
        // diagonal braces on front/back
        if (args.braces !== false) {
          const len = (s - 2 * t) * Math.SQRT2 * 0.97;
          for (const z of [h + t * 0.15, -h - t * 0.15]) {
            await box('brace', [len, t * 0.8, t * 0.5], [0, s / 2, z], woodMat(), [0, 0, z > 0 ? 45 : -45]);
          }
        }
        // metal corners
        if (args.metalCorners) {
          const c = s / 2 - t * 0.5;
          for (const x of [-c, c]) for (const y of [t * 0.5, s - t * 0.5]) for (const z of [-c, c]) {
            await box('corner', [t * 1.18, t * 1.18, t * 1.18], [x, y, z], {
              preset: 'worn_metal', color: '#8a9097', wear: Math.max(0.2, wear), pattern: { scale: s * 0.5 },
            }, [0, 0, 0], t * 0.15);
          }
        }
      });
      engine.changed();
      return { id: groupId };
    },
  });
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, amount) {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + amount))));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
