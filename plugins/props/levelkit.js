import { defineGenerator } from './kit.js';

// Materials per style: floor, wall, trim (frames, beams) and accent (optional glow strips).
const STYLES = {
  dungeon: {
    floor: { preset: 'cobblestone', color: '#8f8a82' },
    wall: { preset: 'cobblestone', color: '#9a958d', pattern: { type: 'stone', scale: 1.4, bump: 1.8 } },
    trim: { preset: 'dark_wood', color: '#6f4a2e', pattern: { type: 'wood', scale: 0.6 } },
    pillar: { preset: 'concrete', color: '#a7a39b', pattern: { type: 'concrete', scale: 1, bump: 2 } },
  },
  cottage: {
    floor: { preset: 'floor_planks', color: '#c69660' },
    wall: { preset: 'concrete', color: '#ece3d0', pattern: { type: 'concrete', scale: 2, bump: 0.6 } },
    trim: { preset: 'dark_wood', color: '#7b5233', pattern: { type: 'wood', scale: 0.7 } },
    pillar: { preset: 'dark_wood', color: '#7b5233', pattern: { type: 'wood', scale: 0.7, angle: 90 } },
  },
  scifi: {
    floor: { preset: 'floor_tiles', pattern: { type: 'tiles', scale: 1, colors: ['#5a6068', '#2a2e33'] } },
    wall: { preset: 'brushed_steel', color: '#a9b1ba', roughness: 0.45 },
    trim: { preset: 'worn_metal', color: '#4a5058', wear: 0.2 },
    pillar: { preset: 'worn_metal', color: '#5c636c' },
    accent: { color: '#0b2530', emissive: '#3ad7ff', emissiveIntensity: 6 },
  },
};

export function register(registry, z, engine) {
  defineGenerator(registry, z, engine, {
    name: 'make_level_kit',
    title: 'Level kit',
    description:
      'A set of matching building pieces that snap together on a grid: floor, wall, wall with door, wall with window, ' +
      'pillar and stairs. Each piece is its own group (child of the kit) laid out in a row; every piece is gridSize wide. ' +
      'Floors are centred on their origin with the top at y = 0; walls stand on their origin line (turn them 90° for corners). ' +
      'Export them as separate files with export_each { group: <kit id> } (e.g. for a Godot GridMap).',
    input: (z) => z.object({
      style: z.enum(Object.keys(STYLES)).optional().describe('dungeon (default), cottage, scifi'),
      gridSize: z.number().min(0.5).max(10).optional().describe('Default 2 m'),
      wallHeight: z.number().min(0.5).max(10).optional().describe('Default 2.6 m'),
      wallThickness: z.number().min(0.05).max(2).optional().describe('Default 0.25 m'),
      wear: z.number().min(0).max(1).optional(),
    }),
    async build(a, k, root) {
      const g = a.gridSize ?? 2, h = a.wallHeight ?? 2.6, t = a.wallThickness ?? 0.25, wear = a.wear ?? 0.2;
      const st = STYLES[a.style ?? 'dungeon'];
      const mat = (m) => ({ ...m, wear: Math.max(wear, m.wear ?? 0) });
      let slot = 0;
      const piece = (name) => k.group(root, name, [slot++ * (g + 1), 0, 0]);
      const wallBox = (p, name = 'wall') => k.part(p, 'box', name, [0, h / 2, 0], { width: g, height: h, depth: t, bevel: 0.02 }, mat(st.wall));
      const trim = (p, name, size, pos) => k.part(p, 'box', name, pos, { width: size[0], height: size[1], depth: size[2], bevel: 0.012 }, mat(st.trim));

      // floor
      let p = await piece('floor');
      await k.part(p, 'box', 'floor_tile', [0, -0.05, 0], { width: g, height: 0.1, depth: g, bevel: 0.01 }, mat(st.floor));

      // plain wall with a base board and a top beam
      p = await piece('wall');
      await wallBox(p);
      await trim(p, 'base', [g, 0.12, t + 0.03], [0, 0.06, 0]);
      await trim(p, 'top', [g, 0.1, t + 0.03], [0, h - 0.05, 0]);
      if (st.accent) await k.part(p, 'box', 'glow_strip', [0, h * 0.55, t / 2 + 0.006], { width: g * 0.9, height: 0.04, depth: 0.012, bevel: 0.004 }, st.accent);

      // wall with a doorway and a frame
      p = await piece('wall_door');
      const dw = Math.min(1.0, g * 0.55), dh = Math.min(2.1, h * 0.82);
      const wd = await wallBox(p);
      const doorHole = await k.part(p, 'box', 'door_cutter', [0, dh / 2 - 0.01, 0], { width: dw, height: dh, depth: t * 3, bevel: 0 }, {});
      await k.cut(wd, doorHole);
      for (const x of [-1, 1]) await trim(p, 'door_post', [0.1, dh + 0.05, t + 0.06], [x * (dw / 2 + 0.05), dh / 2, 0]);
      await trim(p, 'door_lintel', [dw + 0.3, 0.12, t + 0.06], [0, dh + 0.06, 0]);

      // wall with a window and a sill
      p = await piece('wall_window');
      const ws = Math.min(0.9, g * 0.45), wy = h * 0.55;
      const ww = await wallBox(p);
      const winHole = await k.part(p, 'box', 'window_cutter', [0, wy, 0], { width: ws, height: ws, depth: t * 3, bevel: 0 }, {});
      await k.cut(ww, winHole);
      await trim(p, 'sill', [ws + 0.2, 0.07, t + 0.12], [0, wy - ws / 2 - 0.035, 0.03]);
      await trim(p, 'window_bar', [0.04, ws, 0.04], [0, wy, 0]);

      // pillar for corners and wall ends
      p = await piece('pillar');
      const pr = t * 0.85;
      await k.part(p, 'lathe', 'column', [0, 0, 0], {
        points: [[0, 0], [pr * 1.35, 0], [pr * 1.35, 0.14], [pr, 0.22], [pr * 0.92, h - 0.22], [pr * 1.35, h - 0.12], [pr * 1.35, h], [0, h]],
        segments: a.style === 'cottage' ? 4 : 24,
      }, mat(st.pillar), { rotation: [0, 45, 0] });

      // stairs rising over one grid cell
      p = await piece('stairs');
      const steps = Math.max(4, Math.round(h / 0.2));
      const rise = h / steps, run = g / steps;
      for (let i = 0; i < steps; i++) {
        await k.part(p, 'box', 'step', [0, (rise * (i + 1)) / 2, -g / 2 + run * (i + 0.5)], { width: g, height: rise * (i + 1), depth: run, bevel: 0.01 }, mat(st.floor));
      }
    },
  });
}
