// Example plugin: a parametric wooden crate generator.
// Plugins are folders in /plugins with an index.js that exports a default function.
// Everything a plugin registers shows up in the window's API, the MCP tools and the CLI.
// defineGenerator (from the props plugin's kit) adds position, rotation, seed and name, and
// builds everything as one group in one undo step.
import { defineGenerator, hex } from '../props/kit.js';

export const description = 'Generates wooden crates with a frame, diagonal braces and optional metal corners.';

export default function register({ registry, z, engine }) {
  defineGenerator(registry, z, engine, {
    name: 'make_crate',
    title: 'Crate',
    description:
      'Build a wooden crate as one group (frame posts, beams, diagonal braces, panels, optional metal corners). ' +
      'Vary seed for different wood tones.',
    input: (z) => z.object({
      size: z.number().min(0.2).max(10).optional().describe('Edge length in metres (default 1)'),
      woodColor: hex(z).optional().describe('Lightest wood tone as hex, e.g. "#c8955c" (default warm oak)'),
      metalCorners: z.boolean().optional(),
      braces: z.boolean().optional().describe('Diagonal braces on front and back (default true)'),
      wear: z.number().min(0).max(1).optional().describe('Age: 0 = new, 1 = very old and dirty'),
    }),
    async build(args, k, root) {
      const s = args.size ?? 1;
      const t = s * 0.12; // beam thickness
      const wood = args.woodColor ?? '#c8955c';
      const tone = (amt) => k.shade(wood, (k.rand() - 0.5) * amt);
      const wear = args.wear ?? 0;
      const seed = args.seed ?? 1;
      // Upright parts get vertical grain (angle 90); a few seeds keep the parts from looking identical.
      const woodMat = (angle = 0, amt = 0.18) => ({
        preset: 'oak', color: tone(amt), roughness: 0.7 + k.rand() * 0.15, wear,
        pattern: { type: 'wood', scale: s * 0.7, angle, seed: seed * 3 + Math.floor(k.rand() * 3) },
      });
      const box = (name, size, position, material, rotation = [0, 0, 0], bevel = t * 0.12) =>
        k.part(root, 'box', name, position, { width: size[0], height: size[1], depth: size[2], bevel }, material, { rotation });

      // recessed panels
      await box('panels', [s - t * 0.9, s - t * 0.9, s - t * 0.9], [0, s / 2, 0], {
        preset: 'floor_planks', color: k.shade(wood, -0.15), roughness: 0.85, wear,
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
    },
  });
}
