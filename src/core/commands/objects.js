import { OBJECT_TYPES, SHAPE_DEFAULTS, SHAPE_NOTES, restingHeight } from '../../shared/presets.js';
import { CommandError } from '../registry.js';
import { vec3, materialInput, defaultMaterial, applyMaterial, buildParams, toScale } from './common.js';

export function register(registry, { z, engine }) {
  const scale = z.union([vec3, z.number()]).describe('Scale [x, y, z] or one number for all axes');

  registry.define({
    name: 'add_object',
    title: 'Add object',
    category: 'objects',
    mutates: true,
    description:
      'Add a shape to the scene. Units are metres, Y is up, rotation is in degrees. ' +
      'If no position is given the object rests on the ground at the origin. ' +
      `Params per type (with defaults): ${Object.entries(SHAPE_DEFAULTS).filter(([t]) => t !== 'group').map(([t, p]) => `${t} ${JSON.stringify(p)}`).join('; ')}. ` +
      `Notes: ${Object.entries(SHAPE_NOTES).map(([t, n]) => `${t}: ${n}`).join('. ')}. ` +
      'Tip: boxes have a "bevel" param (rounded edges) which makes them look far more real; keep it above 0.',
    input: z.object({
      type: z.enum(OBJECT_TYPES),
      name: z.string().optional(),
      parent: z.string().optional().describe('Id of a group to put this object in'),
      position: vec3.optional(),
      rotation: vec3.optional(),
      scale: scale.optional(),
      params: z.record(z.string(), z.any()).optional().describe('Shape size settings, see description'),
      material: materialInput.optional(),
      visible: z.boolean().optional(),
    }),
    handler(args) {
      if (args.parent) engine.getObject(args.parent);
      const params = buildParams(args.type, {}, args.params, engine);
      const id = engine.newId(args.name ?? args.type);
      const obj = {
        id,
        name: args.name ?? id,
        type: args.type,
        parent: args.parent ?? null,
        position: args.position ?? [0, args.parent ? 0 : restingHeight(args.type, params), 0],
        rotation: args.rotation ?? [0, 0, 0],
        scale: toScale(args.scale ?? 1),
        visible: args.visible ?? true,
        params,
        material: args.type === 'group' ? null : applyMaterial(defaultMaterial(), args.material ?? {}, engine),
      };
      if ((args.type === 'image' || args.type === 'cutout') && !args.material?.texture) {
        obj.material = { ...obj.material, texture: params.assetId, doubleSided: true, roughness: 0.8 };
      }
      engine.scene.objects[id] = obj;
      engine.scene.order.push(id);
      return { id, object: obj };
    },
  });

  registry.define({
    name: 'update_object',
    title: 'Update object',
    category: 'objects',
    mutates: true,
    description: 'Change an object\'s name, transform, shape params, visibility or parent. Only the fields you pass change; params are merged.',
    input: z.object({
      id: z.string(),
      name: z.string().optional(),
      parent: z.string().nullable().optional().describe('Group id, or null to move to the top level'),
      position: vec3.optional(),
      rotation: vec3.optional(),
      scale: scale.optional(),
      params: z.record(z.string(), z.any()).optional(),
      visible: z.boolean().optional(),
    }),
    handler(args) {
      const obj = engine.getObject(args.id);
      if (args.parent) {
        engine.getObject(args.parent);
        if (args.parent === obj.id || isDescendant(engine, args.parent, obj.id)) throw new CommandError('An object cannot be placed inside itself.');
      }
      if (args.params) obj.params = buildParams(obj.type, obj.params, args.params, engine);
      for (const k of ['name', 'parent', 'position', 'rotation', 'visible']) if (args[k] !== undefined) obj[k] = args[k];
      if (args.scale !== undefined) obj.scale = toScale(args.scale);
      return { id: obj.id, object: obj };
    },
  });

  registry.define({
    name: 'set_material',
    title: 'Set material',
    category: 'objects',
    mutates: true,
    description:
      'Change the surface look of one or more objects. Applying to a group changes everything inside it. ' +
      'Use a preset as a starting point, then tweak colour/roughness/metalness.',
    input: materialInput.extend({
      id: z.string().optional(),
      ids: z.array(z.string()).optional(),
    }),
    handler({ id, ids, ...mat }) {
      const targets = [...(ids ?? []), ...(id ? [id] : [])];
      if (!targets.length) throw new CommandError('Pass id or ids.');
      const all = new Set();
      for (const t of targets) collect(engine, t, all);
      const changed = [];
      for (const oid of all) {
        const obj = engine.scene.objects[oid];
        if (obj.type === 'group') continue;
        obj.material = applyMaterial(obj.material, mat, engine);
        changed.push(oid);
      }
      return { changed };
    },
  });

  registry.define({
    name: 'delete_object',
    title: 'Delete object',
    category: 'objects',
    mutates: true,
    description: 'Remove an object (and everything inside it if it is a group).',
    input: z.object({ id: z.string() }),
    handler({ id }) {
      engine.getObject(id);
      const all = new Set();
      collect(engine, id, all);
      for (const oid of all) delete engine.scene.objects[oid];
      engine.scene.order = engine.scene.order.filter((oid) => !all.has(oid));
      for (const o of Object.values(engine.scene.objects)) {
        if (o.booleans) o.booleans = o.booleans.filter((b) => !all.has(b.id));
      }
      for (const a of Object.values(engine.scene.animations ?? {})) a.tracks = a.tracks.filter((t) => !all.has(t.target));
      return { deleted: [...all] };
    },
  });

  registry.define({
    name: 'duplicate_object',
    title: 'Duplicate object',
    category: 'objects',
    mutates: true,
    description: 'Copy an object (with its children). The copy is moved by offset (default 1.2 m along X).',
    input: z.object({ id: z.string(), offset: vec3.optional(), name: z.string().optional() }),
    handler({ id, offset = [1.2, 0, 0], name }) {
      const src = engine.getObject(id);
      const map = {};
      const copy = (oid, parent) => {
        const o = structuredClone(engine.scene.objects[oid]);
        const nid = engine.newId(oid === id && name ? name : o.name);
        map[oid] = nid;
        Object.assign(o, { id: nid, parent, name: oid === id && name ? name : nid });
        engine.scene.objects[nid] = o;
        engine.scene.order.push(nid);
        for (const child of engine.childrenOf(oid).filter((c) => !map[c])) copy(child, nid);
        return o;
      };
      const root = copy(id, src.parent);
      root.position = root.position.map((v, i) => v + offset[i]);
      // copies move like the original
      for (const a of Object.values(engine.scene.animations ?? {})) {
        for (const t of a.tracks.filter((tr) => map[tr.target])) a.tracks.push({ ...structuredClone(t), target: map[t.target] });
      }
      return { id: root.id, mapping: map };
    },
  });

  registry.define({
    name: 'get_object',
    title: 'Get object',
    category: 'objects',
    description: 'Return all details of one object.',
    input: z.object({ id: z.string() }),
    handler: ({ id }) => engine.getObject(id),
  });
}

function collect(engine, id, set) {
  engine.getObject(id);
  set.add(id);
  for (const c of engine.childrenOf(id)) collect(engine, c, set);
}

function isDescendant(engine, id, ancestor) {
  let cur = engine.scene.objects[id];
  while (cur?.parent) {
    if (cur.parent === ancestor) return true;
    cur = engine.scene.objects[cur.parent];
  }
  return false;
}
