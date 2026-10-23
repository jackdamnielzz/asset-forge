import { defineGenerator, hex } from './kit.js';

export function register(registry, z, engine) {
  defineGenerator(registry, z, engine, {
    name: 'make_rock',
    title: 'Rock',
    description: 'Natural stone: a single boulder, a cluster, or scattered pebbles. Optional moss on top.',
    input: (z) => z.object({
      size: z.number().min(0.05).max(20).optional().describe('Approximate size of the biggest stone, default 0.7 m'),
      style: z.enum(['boulder', 'cluster', 'pebbles']).optional(),
      color: hex(z).optional().describe('Lightest stone tone'),
      moss: z.boolean().optional(),
      lowpoly: z.boolean().optional().describe('Faceted stones'),
    }),
    async build(a, k, root) {
      const size = a.size ?? 0.7, color = a.color ?? '#a19d95';
      const stone = (seed) => ({ preset: 'concrete', color: k.shade(color, k.range(-0.12, 0.05)), roughness: 0.92, pattern: { type: 'concrete', scale: size * 1.2, bump: 1.8, seed } });
      const rock = async (name, r, position, seed) => {
        const shape = { radius: r, detail: a.lowpoly ? 1 : 4, roughness: k.range(0.28, 0.42), flatten: k.range(0.25, 0.45), sharpness: a.lowpoly ? 1 : 0, seed };
        const id = await k.part(root, 'rock', name, position, shape,
          stone(seed), { rotation: [0, k.range(0, 360), 0], scale: [k.range(0.9, 1.25), k.range(0.75, 1), k.range(0.85, 1.15)] });
        if (a.moss) {
          // the same stone, slightly bigger, so the moss follows the rock's own bumps
          const moss = await k.part(root, 'rock', `${name}_moss`, position,
            { ...shape, radius: r * 1.03 },
            { preset: 'cloth', color: '#5f8a3a', roughness: 1, pattern: { type: 'fabric', scale: 0.08, bump: 2 } }, { rotation: [0, 0, 0] });
          const engineObj = engine.scene.objects;
          Object.assign(engineObj[moss], { rotation: [...engineObj[id].rotation], scale: [...engineObj[id].scale] });
          // keep only the top of the moss shell
          const cap = await k.part(root, 'box', `${name}_moss_cap`, [position[0], position[1] + r * 1.75, position[2]],
            { width: r * 3, height: r * 1.3, depth: r * 3, bevel: 0 }, {}, { rotation: [k.range(-14, 14), 0, k.range(-14, 14)] }); // tilted: a natural, uneven moss line
          await k.cut(moss, cap, 'intersect');
        }
        return id;
      };
      const style = a.style ?? 'boulder';
      if (style === 'boulder') await rock('boulder', size / 2, [0, 0, 0], k.rand() * 1e4 | 0);
      else if (style === 'cluster') {
        await rock('big', size / 2, [0, 0, 0], k.rand() * 1e4 | 0);
        const n = 2 + Math.floor(k.rand() * 3);
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + k.range(-0.4, 0.4);
          const r = size * k.range(0.15, 0.3);
          await rock('small', r, [Math.cos(ang) * size * 0.55, 0, Math.sin(ang) * size * 0.55], k.rand() * 1e4 | 0);
        }
      } else {
        const n = 6 + Math.floor(k.rand() * 6);
        for (let i = 0; i < n; i++) {
          await rock('pebble', size * k.range(0.06, 0.14), [k.range(-size, size), 0, k.range(-size, size)], k.rand() * 1e4 | 0);
        }
      }
    },
  });

  defineGenerator(registry, z, engine, {
    name: 'make_tree',
    title: 'Tree',
    description: 'Stylised tree: "round" (leafy blobs), "pine" (stacked cones) or "dead" (bare branches).',
    input: (z) => z.object({
      height: z.number().min(0.3).max(30).optional().describe('Default 2.6 m'),
      style: z.enum(['round', 'pine', 'dead']).optional(),
      leafColor: hex(z).optional(),
      trunkColor: hex(z).optional(),
      lowpoly: z.boolean().optional(),
    }),
    async build(a, k, root) {
      const H = a.height ?? 2.6, style = a.style ?? 'round';
      const leaf = a.leafColor ?? (style === 'pine' ? '#3f7a45' : '#6aa84f');
      const bark = { preset: 'dark_wood', color: a.trunkColor ?? '#8a6243', roughness: 0.9, pattern: { type: 'wood', angle: 90, scale: 0.5, bump: 2, variation: 0.8 } };
      const trunkH = style === 'pine' ? H * 0.35 : style === 'dead' ? H * 0.75 : H * 0.55;
      const tr = H * 0.045;
      await k.part(root, 'lathe', 'trunk', [0, 0, 0], {
        points: [[0, 0], [tr * 1.9, 0], [tr * 1.25, trunkH * 0.08], [tr, trunkH * 0.3], [tr * 0.8, trunkH], [0, trunkH]], segments: a.lowpoly ? 7 : 24,
      }, bark);

      if (style === 'round') {
        const blobs = 4 + Math.floor(k.rand() * 3);
        // rock shapes are built standing on y = 0, so y below is the bottom of each blob
        const crownR = H * 0.24;
        await leafBlob(k, root, 'crown', crownR, [0, trunkH - crownR * 0.6, 0], leaf, a.lowpoly);
        for (let i = 0; i < blobs; i++) {
          const ang = (i / blobs) * Math.PI * 2 + k.range(-0.3, 0.3);
          const r = crownR * k.range(0.55, 0.8);
          await leafBlob(k, root, 'leaves', r, [Math.cos(ang) * crownR * 0.75, trunkH - crownR * 0.6 + k.range(0, 0.5) * crownR, Math.sin(ang) * crownR * 0.75], leaf, a.lowpoly);
        }
      } else if (style === 'pine') {
        const layers = 4;
        for (let i = 0; i < layers; i++) {
          const t = i / layers;
          const r = H * 0.27 * (1 - t * 0.7);
          const ch = H * 0.32 * (1 - t * 0.35);
          await k.part(root, 'cone', 'needles', [0, trunkH * 0.75 + t * H * 0.55 + ch / 2, 0], { radius: r, height: ch, segments: a.lowpoly ? 7 : 32 },
            { preset: 'hand_painted', color: k.shade(leaf, t * 0.15), roughness: 0.9 }, { rotation: [0, k.range(0, 360), 0] });
        }
      } else {
        const n = 5;
        for (let i = 0; i < n; i++) {
          const y = trunkH * k.range(0.45, 0.95);
          const len = H * k.range(0.18, 0.32);
          const br = tr * 0.45 * (1 - y / trunkH * 0.4);
          const ang = (i / n) * 360 + k.range(-25, 25);
          const branch = await k.group(root, 'branch', [0, y, 0], [0, ang, k.range(-65, -40)]);
          await k.part(branch, 'lathe', 'branch_wood', [0, 0, 0], { points: [[0, 0], [br, 0], [br * 0.3, len], [0, len]], segments: 10 }, bark);
        }
      }
    },
  });

  defineGenerator(registry, z, engine, {
    name: 'make_crystal',
    title: 'Crystal',
    description: 'Cluster of glowing hexagonal crystals growing from a small rock.',
    input: (z) => z.object({
      height: z.number().min(0.05).max(10).optional().describe('Tallest crystal, default 0.8 m'),
      count: z.number().int().min(1).max(15).optional().describe('Default 6'),
      color: hex(z).optional().describe('Crystal colour, default icy blue'),
      glow: z.number().min(0).max(20).optional().describe('Glow strength, default 1 (0 = no glow; above 3 turns white-hot)'),
    }),
    async build(a, k, root) {
      const H = a.height ?? 0.8, n = a.count ?? 6, color = a.color ?? '#7fd6ff';
      await k.part(root, 'rock', 'base', [0, 0, 0], { radius: H * 0.32, detail: 3, roughness: 0.35, flatten: 0.55, sharpness: 0, seed: k.rand() * 1e4 | 0 },
        { preset: 'concrete', color: '#5c5a63', pattern: { type: 'concrete', scale: 0.6, bump: 2 } }, { scale: [1.3, 0.6, 1.1] });
      for (let i = 0; i < n; i++) {
        const main = i === 0;
        const h = main ? H : H * k.range(0.35, 0.75);
        const r = h * k.range(0.11, 0.15);
        const ang = (i / n) * Math.PI * 2;
        const dist = main ? 0 : H * k.range(0.08, 0.18);
        await k.part(root, 'lathe', main ? 'crystal_main' : 'crystal', [Math.cos(ang) * dist, H * 0.08, Math.sin(ang) * dist],
          { points: [[0, -h * 0.1], [r, -h * 0.1], [r, h * 0.72], [0, h]], segments: 6 },
          { color: k.shade(color, -0.35), metalness: 0, roughness: 0.1, clearcoat: 1, flatShading: true, emissive: color, emissiveIntensity: (a.glow ?? 1) * (main ? 1.4 : 1) },
          { rotation: main ? [0, k.range(0, 60), 0] : [Math.sin(ang) * k.range(20, 40), k.range(0, 60), -Math.cos(ang) * k.range(20, 40)] });
      }
    },
  });
}

async function leafBlob(k, root, name, r, position, color, lowpoly) {
  return k.part(root, 'rock', name, position, { radius: r, detail: lowpoly ? 1 : 3, roughness: 0.3, flatten: 0, sharpness: lowpoly ? 1 : 0, seed: k.rand() * 1e4 | 0 },
    { preset: 'hand_painted', color: k.shade(color, k.range(-0.12, 0.08)), roughness: 0.9, pattern: { type: 'painted', scale: r * 1.5 } },
    { rotation: [0, k.range(0, 360), 0] });
}
