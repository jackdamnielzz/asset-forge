import { defineGenerator, hex } from './kit.js';

export function register(registry, z, engine) {
  defineGenerator(registry, z, engine, {
    name: 'make_barrel',
    title: 'Barrel',
    description: 'Wooden barrel with bulging staves, a lid and metal hoops.',
    input: (z) => z.object({
      height: z.number().min(0.2).max(5).optional().describe('Default 1 m'),
      radius: z.number().min(0.05).max(3).optional().describe('Widest radius, default 0.36 m'),
      woodColor: hex(z).optional(),
      metalColor: hex(z).optional(),
      wear: z.number().min(0).max(1).optional(),
    }),
    async build(a, k, root) {
      const h = a.height ?? 1, r = a.radius ?? 0.36, wear = a.wear ?? 0.25;
      const wood = a.woodColor ?? '#c08a56', metal = a.metalColor ?? '#5d6168';
      const profile = (t) => r * (0.86 + 0.14 * Math.sin(Math.PI * t)); // radius at height fraction t
      const points = [[0, 0]];
      for (let i = 0; i <= 10; i++) points.push([profile(i / 10), (i / 10) * h]);
      points.push([0, h]);
      const staveWidth = (2 * Math.PI * r) / 14;
      await k.part(root, 'lathe', 'staves', [0, 0, 0], { points, segments: 56 },
        { preset: 'floor_planks', color: wood, wear, pattern: { type: 'planks', angle: 90, scale: staveWidth * 4, seed: k.rand() * 1000 | 0 } });
      await k.part(root, 'cylinder', 'lid', [0, h - 0.012, 0], { radiusTop: profile(1) * 0.93, radiusBottom: profile(1) * 0.93, height: 0.03, segments: 48 },
        { preset: 'oak', color: k.shade(wood, -0.08), wear });
      for (const t of [0.08, 0.3, 0.7, 0.92]) {
        await k.part(root, 'torus', 'hoop', [0, t * h, 0], { radius: profile(t) + 0.004, tube: Math.max(0.008, r * 0.035), segments: 48 },
          { preset: 'worn_metal', color: metal, wear: Math.max(0.3, wear), pattern: { scale: 0.4 } }, { rotation: [90, 0, 0], scale: [1, 1, 0.45] });
      }
    },
  });

  defineGenerator(registry, z, engine, {
    name: 'make_chest',
    title: 'Chest',
    description: 'Treasure chest with a rounded lid, metal bands, corner caps and a lock with a keyhole. Can be open with gold inside.',
    input: (z) => z.object({
      width: z.number().min(0.2).max(5).optional().describe('Default 0.9 m'),
      depth: z.number().min(0.15).max(5).optional().describe('Default 0.55 m'),
      height: z.number().min(0.1).max(5).optional().describe('Body height without lid, default 0.42 m'),
      open: z.boolean().optional().describe('Open lid (default false)'),
      treasure: z.boolean().optional().describe('Gold coins inside (visible when open; default true)'),
      woodColor: hex(z).optional(),
      metalColor: hex(z).optional(),
      wear: z.number().min(0).max(1).optional(),
    }),
    async build(a, k, root) {
      const w = a.width ?? 0.9, d = a.depth ?? 0.55, h = a.height ?? 0.42, wear = a.wear ?? 0.2;
      const wood = a.woodColor ?? '#b0763f';
      const metalMat = { preset: 'worn_metal', color: a.metalColor ?? '#6b6f76', wear: Math.max(0.25, wear), pattern: { scale: 0.4 } };
      const goldMat = { preset: 'gold', color: '#f2b948' };
      const woodMat = { preset: 'floor_planks', color: wood, wear, pattern: { scale: h * 1.6, seed: 7 } };
      const t = 0.022; // wall thickness

      // body: a box with the inside cut away
      const body = await k.part(root, 'box', 'body', [0, h / 2, 0], { width: w, height: h, depth: d, bevel: 0.012 }, woodMat);
      const hollow = await k.part(root, 'box', 'hollow', [0, h / 2 + t, 0], { width: w - 2 * t, height: h, depth: d - 2 * t, bevel: 0.004 }, woodMat);
      await k.cut(body, hollow);

      // metal bands and corners on the body
      for (const x of [-w * 0.32, w * 0.32]) {
        await k.part(root, 'box', 'band', [x, h / 2, 0], { width: 0.05, height: h + 0.006, depth: d + 0.012, bevel: 0.004 }, metalMat);
      }
      for (const x of [-1, 1]) for (const zz of [-1, 1]) {
        await k.part(root, 'box', 'corner', [x * (w / 2 - 0.025), 0.035, zz * (d / 2 - 0.025)], { width: 0.062, height: 0.07, depth: 0.062, bevel: 0.006 }, metalMat);
      }

      // lid, hinged at the back: the lid group's origin is the hinge
      const hinge = await k.group(root, 'lid', [0, h, -d / 2], [a.open ? -105 : 0, 0, 0]);
      const lidParams = { radiusTop: d / 2, radiusBottom: d / 2, height: w, segments: 40, thetaLength: 180 };
      const lid = await k.part(hinge, 'cylinder', 'lid_top', [0, 0, d / 2], lidParams,
        { preset: 'floor_planks', color: wood, wear, pattern: { scale: d * 1.2, seed: 9 } }, { rotation: [0, 0, 90] });
      const lidHollow = await k.part(hinge, 'cylinder', 'lid_hollow', [0, 0, d / 2], { ...lidParams, radiusTop: d / 2 - t, radiusBottom: d / 2 - t, height: w - 2 * t }, woodMat, { rotation: [0, 0, 90] });
      await k.cut(lid, lidHollow);
      for (const x of [-w * 0.32, w * 0.32]) {
        await k.part(hinge, 'cylinder', 'lid_band', [x, 0, d / 2], { radiusTop: d / 2 + 0.006, radiusBottom: d / 2 + 0.006, height: 0.05, segments: 40, thetaLength: 180 }, metalMat, { rotation: [0, 0, 90] });
      }

      // lock plate with keyhole, on the front of the lid edge
      const plate = await k.part(hinge, 'box', 'lock', [0, 0.0, d + 0.012], { width: 0.1, height: 0.12, depth: 0.022, bevel: 0.006 }, goldMat);
      const hole = await k.part(hinge, 'cylinder', 'keyhole', [0, 0.012, d + 0.02], { radiusTop: 0.012, radiusBottom: 0.012, height: 0.05, segments: 20 }, goldMat, { rotation: [90, 0, 0] });
      const slot = await k.part(hinge, 'box', 'keyslot', [0, -0.012, d + 0.02], { width: 0.01, height: 0.035, depth: 0.05, bevel: 0 }, goldMat);
      await k.cut(plate, hole);
      await k.cut(plate, slot);

      if (a.treasure !== false) {
        const pile = await k.group(root, 'treasure', [0, h - 0.07, 0]);
        await k.part(pile, 'rock', 'gold_heap', [0, -0.02, 0], { radius: Math.min(w, d) * 0.42, detail: 3, roughness: 0.25, flatten: 0.6, sharpness: 0, seed: 5 },
          { preset: 'gold', color: '#e9ad3a', roughness: 0.35 }, { scale: [(w - 2 * t) / (Math.min(w, d) * 0.85), 0.5, (d - 2 * t) / (Math.min(w, d) * 0.85)] });
        for (let i = 0; i < 9; i++) {
          await k.part(pile, 'cylinder', 'coin', [k.range(-w * 0.32, w * 0.32), 0.05 + k.rand() * 0.03, k.range(-d * 0.3, d * 0.3)],
            { radiusTop: 0.03, radiusBottom: 0.03, height: 0.006, segments: 24 }, goldMat, { rotation: [k.range(-40, 40), 0, k.range(-40, 40)] });
        }
      }
    },
  });
}
