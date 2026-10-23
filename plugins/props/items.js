import { defineGenerator, hex } from './kit.js';

export function register(registry, z, engine) {
  defineGenerator(registry, z, engine, {
    name: 'make_potion',
    title: 'Potion',
    description: 'Glass potion bottle with glowing liquid and a cork. Shapes: round, tall, flask.',
    input: (z) => z.object({
      height: z.number().min(0.05).max(3).optional().describe('Default 0.3 m'),
      shape: z.enum(['round', 'tall', 'flask']).optional(),
      liquidColor: hex(z).optional(),
      fill: z.number().min(0.1).max(1).optional().describe('How full, default 0.7'),
      glow: z.number().min(0).max(20).optional().describe('Liquid glow, default 2 (0 = none)'),
    }),
    async build(a, k, root) {
      const H = a.height ?? 0.3, shape = a.shape ?? 'round', color = a.liquidColor ?? '#ff3d7f', fill = a.fill ?? 0.7;
      // outer profile as [radius, y]; the body ends where the neck starts
      const neckR = H * 0.09, neckY = H * 0.7;
      const body = {
        round: [[H * 0.2, 0], [H * 0.3, H * 0.08], [H * 0.32, H * 0.28], [H * 0.26, H * 0.48], [H * 0.14, H * 0.6], [neckR, neckY]],
        tall: [[H * 0.14, 0], [H * 0.16, H * 0.03], [H * 0.16, H * 0.52], [H * 0.12, H * 0.62], [neckR, neckY]],
        flask: [[H * 0.26, 0], [H * 0.28, H * 0.03], [H * 0.12, H * 0.55], [neckR, neckY]],
      }[shape];
      const glassPts = [[0, 0], ...body, [neckR, H * 0.9], [neckR * 1.3, H * 0.92], [neckR * 1.3, H * 0.96], [neckR * 0.85, H * 0.96]];
      await k.part(root, 'lathe', 'bottle', [0, 0, 0], { points: glassPts, segments: 48 },
        { preset: 'glass', color: '#eef6ff', roughness: 0.04, thickness: 0.02, doubleSided: true });

      // liquid: the inside of the body, cut off at the fill height
      const inset = 0.88;
      const maxY = body[body.length - 2][1] * fill + H * 0.02;
      const inner = [[0, H * 0.015]];
      for (const [r, y] of body) {
        if (y > maxY) break;
        inner.push([r * inset, Math.max(H * 0.015, y)]);
      }
      const lastR = interpolate(body, maxY) * inset;
      inner.push([lastR, maxY], [0, maxY]);
      await k.part(root, 'lathe', 'liquid', [0, 0, 0], { points: inner, segments: 48 },
        // not see-through itself: glass cannot show see-through things behind it
        { color, metalness: 0, roughness: 0.15, clearcoat: 1, emissive: color, emissiveIntensity: a.glow ?? 2 });

      await k.part(root, 'cylinder', 'cork', [0, H * 0.98, 0], { radiusTop: neckR * 1.15, radiusBottom: neckR * 0.85, height: H * 0.12, segments: 24 },
        { preset: 'concrete', color: '#c49a6c', roughness: 0.95, pattern: { type: 'concrete', scale: 0.05, bump: 2 } });
    },
  });

  defineGenerator(registry, z, engine, {
    name: 'make_sword',
    title: 'Sword',
    description: 'Standing sword: bevelled blade with a groove (fuller), crossguard, wrapped grip and pommel.',
    input: (z) => z.object({
      length: z.number().min(0.2).max(5).optional().describe('Total length, default 1 m'),
      bladeWidth: z.number().min(0.01).max(1).optional().describe('Default 0.09 m'),
      guardColor: hex(z).optional(),
      gripColor: hex(z).optional(),
      wear: z.number().min(0).max(1).optional(),
    }),
    async build(a, k, root) {
      const L = a.length ?? 1, bw = (a.bladeWidth ?? 0.09) / 2, s = L;
      const th = 0.012 * s;
      const gold = { preset: 'gold', color: a.guardColor ?? '#e0a83c', roughness: 0.3 };
      const steel = { preset: 'brushed_steel', color: '#d4d8dd', roughness: 0.28, wear: a.wear ?? 0, pattern: { type: 'metal', scale: 0.3 } };
      await k.part(root, 'sphere', 'pommel', [0, 0.03 * s, 0], { radius: 0.03 * s, segments: 32 }, gold);
      await k.part(root, 'lathe', 'grip', [0, 0.055 * s, 0], {
        points: [[0, 0], [0.016 * s, 0], ...Array.from({ length: 9 }, (_, i) => [(i % 2 ? 0.019 : 0.016) * s, (0.02 + i * 0.018) * s]), [0.016 * s, 0.18 * s], [0, 0.18 * s]], segments: 24,
      }, { preset: 'cloth', color: a.gripColor ?? '#5a3a22', roughness: 0.75, pattern: { type: 'fabric', scale: 0.04, bump: 1.5 } });
      await k.part(root, 'box', 'guard', [0, 0.25 * s, 0], { width: 0.22 * s, height: 0.032 * s, depth: 0.05 * s, bevel: 0.012 * s }, gold);
      const bladeLen = L - 0.27 * s;
      const blade = await k.part(root, 'extrude', 'blade', [0, 0.265 * s, 0], {
        points: [[-bw, 0], [bw, 0], [bw * 0.9, bladeLen * 0.84], [0, bladeLen], [-bw * 0.9, bladeLen * 0.84]],
        holes: [], depth: th, bevel: th * 0.45, bevelSegments: 2,
      }, steel);
      for (const zz of [th * 0.55, -th * 0.55]) {
        const groove = await k.part(root, 'box', 'fuller', [0, 0.265 * s + bladeLen * 0.38, zz], { width: bw * 0.38, height: bladeLen * 0.6, depth: th * 0.45, bevel: 0 }, steel);
        await k.cut(blade, groove);
      }
    },
  });

  defineGenerator(registry, z, engine, {
    name: 'make_coin',
    title: 'Coin',
    description: 'Coin with a raised rim and an embossed symbol (letters/numbers). count > 1 makes a stack.',
    input: (z) => z.object({
      radius: z.number().min(0.005).max(2).optional().describe('Default 0.06 m'),
      symbol: z.string().max(3).optional().describe('Up to 3 letters or digits, default "$"'),
      material: z.enum(['gold', 'copper', 'steel', 'chrome']).optional(),
      count: z.number().int().min(1).max(40).optional(),
      upright: z.boolean().optional().describe('Stand the coin on its edge, facing forward (for spinning pickups)'),
    }),
    async build(a, k, root) {
      const r = a.radius ?? 0.06, t = r * 0.2;
      const mat = { preset: a.material ?? 'gold' };
      const coin = await k.group(root, 'coin', a.upright ? [0, r, -t * 0.36] : [0, 0, 0], a.upright ? [90, 0, 0] : undefined);
      await k.part(coin, 'lathe', 'coin_body', [0, 0, 0], {
        points: [[0, 0], [r * 0.97, 0], [r, t * 0.1], [r, t * 0.9], [r * 0.97, t], [r * 0.85, t], [r * 0.83, t * 0.72], [0, t * 0.72]], segments: 64,
      }, mat);
      const size = r * 0.95;
      await k.part(coin, 'text', 'symbol', [0, t * 0.72, size * 0.36], { text: a.symbol ?? '$', size, depth: t * 0.3, bevel: t * 0.05, font: 'helvetiker_bold' }, mat, { rotation: [-90, 0, 0] });
      if ((a.count ?? 1) > 1 && !a.upright) await k.repeat(coin, { count: a.count - 1, mode: 'line', offset: [0, t * 1.02, 0] });
    },
  });
}

// Radius of a [radius, y] profile at height y.
function interpolate(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const [r0, y0] = pts[i - 1], [r1, y1] = pts[i];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / Math.max(1e-6, y1 - y0);
  }
  return pts[pts.length - 1][0];
}
