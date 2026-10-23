import { CommandError } from '../registry.js';
import { vec3 } from './common.js';

const MIRROR_ROT = { x: [1, -1, -1], y: [-1, 1, -1], z: [-1, -1, 1] };
const AXIS = { x: 0, y: 1, z: 2 };

export function register(registry, { z, engine }) {
  registry.define({
    name: 'cut_object',
    title: 'Cut / combine objects',
    category: 'modeling',
    mutates: true,
    description:
      'Combine two shapes. op "subtract" cuts the cutter\'s shape out of the target (holes, windows, keyholes, grooves), ' +
      '"union" melts them into one surface, "intersect" keeps only the overlap. The cutter stays in the scene but is hidden; ' +
      'move or resize it later and the result updates. A target can have several cutters. Cutters cannot be groups.',
    input: z.object({
      target: z.string(),
      cutter: z.string(),
      op: z.enum(['subtract', 'union', 'intersect']).optional(),
      hideCutter: z.boolean().optional().describe('Default true'),
    }),
    handler({ target, cutter, op = 'subtract', hideCutter = true }) {
      const t = engine.getObject(target);
      const c = engine.getObject(cutter);
      if (target === cutter) throw new CommandError('An object cannot cut itself.');
      if (t.type === 'group' || c.type === 'group') throw new CommandError('Cut/combine works on shapes, not groups.');
      t.booleans = (t.booleans ?? []).filter((b) => b.id !== cutter);
      t.booleans.push({ id: cutter, op });
      if (hideCutter) c.visible = false;
      c.cutterFor = target;
      return { target, booleans: t.booleans };
    },
  });

  registry.define({
    name: 'uncut_object',
    title: 'Remove a cut',
    category: 'modeling',
    mutates: true,
    description: 'Undo a cut/combine between target and cutter and show the cutter again.',
    input: z.object({ target: z.string(), cutter: z.string() }),
    handler({ target, cutter }) {
      const t = engine.getObject(target);
      t.booleans = (t.booleans ?? []).filter((b) => b.id !== cutter);
      const c = engine.scene.objects[cutter];
      if (c) { c.visible = true; delete c.cutterFor; }
      return { target, booleans: t.booleans };
    },
  });

  registry.define({
    name: 'repeat_object',
    title: 'Repeat object',
    category: 'modeling',
    mutates: true,
    description:
      'Make copies of an object in a pattern. mode "line": each copy moves by offset (fence posts, stairs). ' +
      'mode "circle": copies spread evenly around a centre on the Y axis, turned to match (wheel spokes, columns around a tower, petals). ' +
      'mode "grid": rows and columns on the ground (tiles, crops). Set group true to collect everything into one new group.',
    input: z.object({
      id: z.string(),
      count: z.number().int().min(1).max(200).describe('Number of extra copies'),
      mode: z.enum(['line', 'circle', 'grid']).optional(),
      offset: vec3.optional().describe('line: step between copies (default [1.2, 0, 0])'),
      center: vec3.optional().describe('circle: centre point (default [0, y, 0] in the parent)'),
      rotate: z.boolean().optional().describe('circle: turn copies to face outward like the original (default true)'),
      columns: z.number().int().min(1).optional().describe('grid: objects per row (default: square-ish)'),
      spacing: z.array(z.number()).length(2).optional().describe('grid: [x, z] distance (default [1.2, 1.2])'),
      group: z.boolean().optional(),
      name: z.string().optional().describe('Name for the new group'),
    }),
    async handler(args, ctx) {
      const src = engine.getObject(args.id);
      const mode = args.mode ?? 'line';
      const ids = [args.id];
      await engine.batch(async () => {
        const total = args.count + 1;
        const cols = args.columns ?? Math.ceil(Math.sqrt(total));
        const center = args.center ?? [0, src.position[1], 0];
        const startAngle = Math.atan2(src.position[0] - center[0], src.position[2] - center[2]);
        const r = Math.hypot(src.position[0] - center[0], src.position[2] - center[2]);
        for (let i = 1; i <= args.count; i++) {
          const { id } = await engine.execute('duplicate_object', { id: args.id, offset: [0, 0, 0] }, ctx.meta);
          const o = engine.scene.objects[id];
          if (mode === 'line') {
            const off = args.offset ?? [1.2, 0, 0];
            o.position = src.position.map((v, k) => v + off[k] * i);
          } else if (mode === 'circle') {
            if (r < 1e-6) throw new CommandError('For a circle, place the object away from the centre first (the distance becomes the radius).');
            const a = startAngle + (i / total) * Math.PI * 2;
            o.position = [center[0] + Math.sin(a) * r, src.position[1], center[2] + Math.cos(a) * r];
            if (args.rotate !== false) o.rotation = [src.rotation[0], src.rotation[1] + (i / total) * 360, src.rotation[2]];
          } else {
            const [sx, sz] = args.spacing ?? [1.2, 1.2];
            o.position = [src.position[0] + (i % cols) * sx, src.position[1], src.position[2] + Math.floor(i / cols) * sz];
          }
          ids.push(id);
        }
        if (args.group) {
          const g = await engine.execute('add_object', { type: 'group', name: args.name ?? `${src.name}_set`, parent: src.parent ?? undefined, position: [0, 0, 0] }, ctx.meta);
          for (const id of ids) engine.scene.objects[id].parent = g.id;
          ids.unshift(g.id);
        }
      });
      engine.changed();
      return { ids };
    },
  });

  registry.define({
    name: 'mirror_object',
    title: 'Mirror object',
    category: 'modeling',
    mutates: true,
    description:
      'Make a mirrored copy of an object (with its children) on the other side of a plane. ' +
      'Build one half (a left wing, a left arm, half a face) and mirror it to get a symmetric whole.',
    input: z.object({
      id: z.string(),
      axis: z.enum(['x', 'y', 'z']).optional().describe('Mirror across this axis (default x = left/right)'),
      center: z.number().optional().describe('Position of the mirror plane on that axis (default 0)'),
      name: z.string().optional(),
    }),
    async handler({ id, axis = 'x', center = 0, name }, ctx) {
      const src = engine.getObject(id);
      const a = AXIS[axis];
      const r = await engine.execute('duplicate_object', { id, offset: [0, 0, 0], name: name ?? `${src.name}_mirror` }, ctx.meta);
      const o = engine.scene.objects[r.id];
      o.position[a] = 2 * center - o.position[a];
      o.rotation = o.rotation.map((v, k) => v * MIRROR_ROT[axis][k]);
      o.scale[a] *= -1;
      return { id: r.id };
    },
  });
}
