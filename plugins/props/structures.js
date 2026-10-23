import { defineGenerator, hex } from './kit.js';

export function register(registry, z, engine) {
  defineGenerator(registry, z, engine, {
    name: 'make_lamp_post',
    title: 'Lamp post',
    description: 'Classic street lamp: moulded base, pole, glass lantern with a glowing bulb and a pointed cap.',
    input: (z) => z.object({
      height: z.number().min(0.5).max(15).optional().describe('Default 2.6 m'),
      lightColor: hex(z).optional(),
      metalColor: hex(z).optional(),
      glow: z.number().min(0).max(30).optional().describe('Default 6'),
      wear: z.number().min(0).max(1).optional(),
    }),
    async build(a, k, root) {
      const H = a.height ?? 2.6, s = H / 2.6;
      const metal = { preset: 'worn_metal', color: a.metalColor ?? '#3b4047', roughness: 0.5, wear: a.wear ?? 0.3, pattern: { scale: 0.5 } };
      const light = a.lightColor ?? '#ffcf80';
      await k.part(root, 'lathe', 'base', [0, 0, 0], {
        points: [[0, 0], [0.17, 0], [0.17, 0.05], [0.12, 0.09], [0.095, 0.3], [0.065, 0.36], [0.05, 0.4], [0, 0.4]].map(([r, y]) => [r * s, y * s]), segments: 40,
      }, metal);
      const top = H - 0.48 * s;
      await k.part(root, 'cylinder', 'pole', [0, (0.4 * s + top) / 2, 0], { radiusTop: 0.032 * s, radiusBottom: 0.04 * s, height: top - 0.4 * s, segments: 24 }, metal);
      await k.part(root, 'torus', 'ring', [0, top - 0.25 * s, 0], { radius: 0.042 * s, tube: 0.012 * s, segments: 24 }, metal, { rotation: [90, 0, 0] });
      await k.part(root, 'cylinder', 'lantern_base', [0, top + 0.015 * s, 0], { radiusTop: 0.1 * s, radiusBottom: 0.07 * s, height: 0.04 * s, segments: 4 }, metal, { rotation: [0, 45, 0] });
      const gh = 0.26 * s, gy = top + 0.035 * s + gh / 2;
      await k.part(root, 'box', 'glass', [0, gy, 0], { width: 0.16 * s, height: gh, depth: 0.16 * s, bevel: 0.004 * s },
        { preset: 'glass', color: '#fff6e0', roughness: 0.08, thickness: 0.01, doubleSided: true });
      await k.part(root, 'sphere', 'bulb', [0, gy, 0], { radius: 0.045 * s, segments: 24 },
        { color: '#ffffff', emissive: light, emissiveIntensity: a.glow ?? 6, roughness: 0.3 });
      for (const x of [-1, 1]) for (const zz of [-1, 1]) {
        await k.part(root, 'box', 'frame', [x * 0.08 * s, gy, zz * 0.08 * s], { width: 0.016 * s, height: gh + 0.01 * s, depth: 0.016 * s, bevel: 0.003 * s }, metal);
      }
      await k.part(root, 'cone', 'cap', [0, gy + gh / 2 + 0.07 * s, 0], { radius: 0.15 * s, height: 0.14 * s, segments: 4 }, metal, { rotation: [0, 45, 0] });
      await k.part(root, 'sphere', 'finial', [0, gy + gh / 2 + 0.15 * s, 0], { radius: 0.022 * s, segments: 16 }, metal);
    },
  });

  defineGenerator(registry, z, engine, {
    name: 'make_fence',
    title: 'Fence',
    description: 'Wooden fence segment along X: posts, rails and pointed pickets ("picket") or just rails ("rail").',
    input: (z) => z.object({
      length: z.number().min(0.3).max(50).optional().describe('Default 3 m'),
      height: z.number().min(0.2).max(5).optional().describe('Default 0.9 m'),
      style: z.enum(['picket', 'rail']).optional(),
      paint: hex(z).optional().describe('Paint colour; leave out for bare wood'),
      wear: z.number().min(0).max(1).optional(),
    }),
    async build(a, k, root) {
      const L = a.length ?? 3, H = a.height ?? 0.9, wear = a.wear ?? 0.3, style = a.style ?? 'picket';
      const wood = (angle) => (a.paint
        ? { preset: 'hand_painted', color: a.paint, wear }
        : { preset: 'oak', color: '#b98a5c', wear, pattern: { type: 'wood', angle, scale: 0.6, seed: k.rand() * 100 | 0 } });
      const posts = Math.max(2, Math.ceil(L / 1.3) + 1);
      const step = L / (posts - 1);
      const post = await k.part(root, 'box', 'post', [-L / 2, H * 0.55, 0], { width: 0.09, height: H * 1.1, depth: 0.09, bevel: 0.01 }, wood(90));
      await k.repeat(post, { count: posts - 1, mode: 'line', offset: [step, 0, 0] });
      const railYs = style === 'rail' ? [H * 0.25, H * 0.55, H * 0.85] : [H * 0.28, H * 0.78];
      for (const y of railYs) {
        await k.part(root, 'box', 'rail', [0, y, 0.065], { width: L, height: 0.085, depth: 0.04, bevel: 0.008 }, wood(0));
      }
      if (style === 'picket') {
        const w = 0.075, gap = 0.05, ph = H * 0.95;
        const count = Math.floor((L - w) / (w + gap));
        const start = -((count * (w + gap)) / 2);
        const picket = await k.part(root, 'extrude', 'picket', [start, 0.03, 0.1], {
          points: [[-w / 2, 0], [w / 2, 0], [w / 2, ph - w * 0.6], [0, ph], [-w / 2, ph - w * 0.6]], holes: [], depth: 0.02, bevel: 0.004, bevelSegments: 2,
        }, wood(90));
        await k.repeat(picket, { count, mode: 'line', offset: [w + gap, 0, 0] });
      }
    },
  });
}
