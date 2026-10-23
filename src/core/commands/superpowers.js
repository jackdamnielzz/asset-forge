import fs from 'node:fs/promises';
import path from 'node:path';
import { safeName } from '../engine.js';
import { CommandError } from '../registry.js';
import { BUILTIN_HOUSE_STYLES } from '../../shared/housestyles.js';
import { LIGHTING_PRESETS, STYLES, DEFAULT_EFFECTS, DEFAULT_STYLE_OPTIONS } from '../../shared/presets.js';
import { color } from './common.js';

// Recipes, variations, quality check and house styles: tools that help an AI (or a person)
// iterate towards a good-looking, consistent set of assets.
export function register(registry, { z, engine }) {
  const dir = (kind) => path.join(engine.paths.library, kind);
  const readJson = async (file) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } };
  const subtree = (id) => {
    const ids = [id];
    for (let i = 0; i < ids.length; i++) ids.push(...engine.childrenOf(ids[i]));
    return ids;
  };

  // ---- recipes --------------------------------------------------------------------

  registry.define({
    name: 'get_recipe',
    title: 'Get recipe',
    category: 'recipes',
    description: 'Show how a generator-made object was made (the generator command and its options). Change the options with remake.',
    input: z.object({ id: z.string() }),
    handler({ id }) {
      const o = engine.getObject(id);
      if (!o.recipe) throw new CommandError(`"${o.name}" was not made by a generator, so it has no recipe. save_recipe can still store it as a reusable template.`);
      return o.recipe;
    },
  });

  registry.define({
    name: 'remake',
    title: 'Re-make with changes',
    category: 'recipes',
    description:
      'Rebuild a generator-made object with changed options, e.g. remake { id, changes: { wear: 0.8, woodColor: "#7a5030" } } or a new seed. ' +
      'It keeps its place, rotation, scale and name. Use get_recipe to see the options.',
    input: z.object({ id: z.string(), changes: z.record(z.string(), z.any()).optional() }),
    async handler({ id, changes = {} }, ctx) {
      const o = engine.getObject(id);
      if (!o.recipe) throw new CommandError(`"${o.name}" has no recipe (it was not made by a generator).`);
      const keep = { name: o.name, parent: o.parent, position: [...o.position], rotation: [...o.rotation], scale: [...o.scale] };
      let newId;
      await engine.batch(async () => {
        await engine.execute('delete_object', { id }, ctx.meta);
        const r = await engine.execute(o.recipe.command, { ...o.recipe.args, ...changes, name: keep.name, position: keep.position, rotation: keep.rotation }, ctx.meta);
        newId = r.id;
        Object.assign(engine.scene.objects[newId], { parent: keep.parent, scale: keep.scale });
      });
      engine.changed();
      return { id: newId, recipe: engine.scene.objects[newId].recipe };
    },
  });

  registry.define({
    name: 'save_recipe',
    title: 'Save as recipe',
    category: 'recipes',
    description:
      'Store an object (with everything inside it, its materials, cuts and animations) as a reusable template in the library, ' +
      'so it can be placed again in any project with use_recipe. Generator-made objects are stored as their generator options.',
    input: z.object({ id: z.string(), name: z.string().optional() }),
    async handler({ id, name }) {
      const o = engine.getObject(id);
      const recipeName = safeName(name ?? o.name);
      let recipe;
      if (o.recipe) recipe = { kind: 'generator', ...o.recipe };
      else {
        const ids = subtree(id);
        const set = new Set(ids);
        const extraCutters = ids.flatMap((i) => (engine.scene.objects[i].booleans ?? []).map((b) => b.id)).filter((c) => !set.has(c));
        const all = [...ids, ...extraCutters];
        const allSet = new Set(all);
        recipe = {
          kind: 'objects', root: id,
          objects: all.map((i) => structuredClone(engine.scene.objects[i])),
          animations: Object.fromEntries(Object.entries(engine.scene.animations ?? {})
            .map(([n, a]) => [n, { ...a, tracks: a.tracks.filter((t) => allSet.has(t.target)) }])
            .filter(([, a]) => a.tracks.length)),
        };
      }
      await fs.mkdir(dir('recipes'), { recursive: true });
      await fs.writeFile(path.join(dir('recipes'), `${recipeName}.json`), JSON.stringify({ name: recipeName, saved: new Date().toISOString(), ...recipe }, null, 2));
      engine.library.recipes ??= {};
      engine.library.recipes[recipeName] = { name: recipeName, kind: recipe.kind, command: recipe.command ?? null };
      await engine.saveLibrary();
      engine.emit('library', engine.library);
      return { recipe: recipeName, kind: recipe.kind };
    },
  });

  registry.define({
    name: 'use_recipe',
    title: 'Place a recipe',
    category: 'recipes',
    description: 'Place a saved recipe (template) in the current scene. See list_recipes.',
    input: z.object({ name: z.string(), position: z.array(z.number()).length(3).optional(), changes: z.record(z.string(), z.any()).optional().describe('Generator recipes only: change options') }),
    async handler({ name, position = [0, 0, 0], changes = {} }, ctx) {
      const r = await readJson(path.join(dir('recipes'), `${safeName(name)}.json`));
      if (!r) throw new CommandError(`No recipe "${name}". See list_recipes.`);
      if (r.kind === 'generator') return engine.execute(r.command, { ...r.args, ...changes, position }, ctx.meta);
      let rootId;
      await engine.batch(async () => {
        const map = {};
        for (const o of r.objects) map[o.id] = engine.newId(o.name);
        for (const o of r.objects) {
          const copy = { ...structuredClone(o), id: map[o.id], parent: o.id === r.root ? null : map[o.parent] ?? null };
          if (copy.booleans) copy.booleans = copy.booleans.map((b) => ({ ...b, id: map[b.id] })).filter((b) => b.id);
          if (copy.cutterFor) copy.cutterFor = map[copy.cutterFor];
          if (o.id === r.root) copy.position = position;
          else if (!copy.parent) copy.position = copy.position.map((v, i) => v - r.objects.find((x) => x.id === r.root).position[i] + position[i]);
          engine.scene.objects[copy.id] = copy;
          engine.scene.order.push(copy.id);
        }
        for (const [n, a] of Object.entries(r.animations ?? {})) {
          engine.scene.animations ??= {};
          const target = (engine.scene.animations[n] ??= { duration: a.duration, loop: a.loop, tracks: [] });
          for (const t of a.tracks) target.tracks.push({ ...t, target: map[t.target] });
        }
        rootId = map[r.root];
      });
      engine.changed();
      return { id: rootId };
    },
  });

  registry.define({
    name: 'list_recipes',
    title: 'List recipes',
    category: 'recipes',
    description: 'List the saved recipes (templates) in the library.',
    handler: () => Object.values(engine.library.recipes ?? {}),
  });

  // ---- variations ------------------------------------------------------------------

  registry.define({
    name: 'make_variations',
    title: 'Make variations',
    category: 'recipes',
    description:
      'Make several versions of an object side by side so the best one can be picked. Generator-made objects are rebuilt with new seeds ' +
      '(and optionally other values from "vary", e.g. { "style": ["round", "pine"] }); other objects get new pattern variants and small colour and size changes. ' +
      'Returns a picture of all of them, numbered left to right, top to bottom. Pick one with keep_variation.',
    input: z.object({
      id: z.string(),
      count: z.number().int().min(2).max(24).optional().describe('Default 6'),
      vary: z.record(z.string(), z.array(z.any())).optional(),
      columns: z.number().int().min(1).max(8).optional(),
    }),
    async handler({ id, count = 6, vary = {}, columns }, ctx) {
      const o = engine.getObject(id);
      const info = await engine.bridge.request('inspect', { ids: [id], scene: engine.scene });
      const b = info.objects[id];
      const w = b ? Math.max(0.3, b.max[0] - b.min[0], b.max[2] - b.min[2]) * 1.35 : 1.5;
      const cols = columns ?? Math.ceil(Math.sqrt(count));
      const ids = [];
      let groupId;
      await engine.batch(async () => {
        const g = await engine.execute('add_object', { type: 'group', name: `${o.name}_variations`, position: [o.position[0] + w * 1.2, 0, o.position[2]] }, ctx.meta);
        groupId = g.id;
        for (let i = 0; i < count; i++) {
          const pos = [(i % cols) * w, 0, Math.floor(i / cols) * w];
          let vid;
          if (o.recipe) {
            const picks = Object.fromEntries(Object.entries(vary).map(([k, list]) => [k, list[i % list.length]]));
            const r = await engine.execute(o.recipe.command, { ...o.recipe.args, ...picks, seed: (o.recipe.args.seed ?? 1) * 100 + i + 1, name: `${o.name}_v${i + 1}`, position: pos }, ctx.meta);
            vid = r.id;
          } else {
            const r = await engine.execute('duplicate_object', { id, offset: [0, 0, 0], name: `${o.name}_v${i + 1}` }, ctx.meta);
            vid = r.id;
            engine.scene.objects[vid].position = [pos[0], o.position[1], pos[2]];
            jitter(engine, subtree(vid), i + 1);
          }
          Object.assign(engine.scene.objects[vid], { parent: groupId, variationOf: id });
          ids.push(vid);
        }
      });
      engine.changed();
      const shot = await engine.render({ view: 'iso', width: 900, height: 600, target: groupId, isolate: true });
      return { group: groupId, variations: ids.map((v, i) => ({ number: i + 1, id: v })), image: shot.png, mime: 'image/png' };
    },
  });

  registry.define({
    name: 'keep_variation',
    title: 'Keep this variation',
    category: 'recipes',
    description: 'Keep one variation: it takes the place of the original, and the original and the other variations are removed.',
    input: z.object({ id: z.string() }),
    async handler({ id }, ctx) {
      const v = engine.getObject(id);
      if (!v.variationOf) throw new CommandError(`"${v.name}" is not a variation.`);
      const orig = engine.scene.objects[v.variationOf];
      const group = v.parent;
      await engine.batch(async () => {
        Object.assign(v, { parent: orig?.parent ?? null, position: orig ? [...orig.position] : [0, 0, 0], rotation: orig ? [...orig.rotation] : v.rotation, name: orig?.name ?? v.name });
        delete v.variationOf;
        if (orig) await engine.execute('delete_object', { id: orig.id }, ctx.meta);
        if (group && engine.scene.objects[group]) await engine.execute('delete_object', { id: group }, ctx.meta);
      });
      engine.changed();
      return { id };
    },
  });

  // ---- quality check -----------------------------------------------------------------

  registry.define({
    name: 'check_quality',
    title: 'Quality check',
    category: 'recipes',
    description:
      'Look for problems before delivering assets: floating or loose parts, objects sinking into the ground, odd sizes, too many polygons for a game, ' +
      'missing pictures, and beauty tips (sharp box edges, pure black/white, mirror-smooth metal). Returns a score out of 100 and a list of issues with fixes.',
    input: z.object({ id: z.string().optional().describe('Check one object; default all top-level objects') }),
    async handler({ id }) {
      if (id) engine.getObject(id);
      const s = engine.scene;
      const assets = id ? [id] : s.order.filter((oid) => !s.objects[oid].parent && s.objects[oid].visible !== false && !s.objects[oid].cutterFor);
      const info = await engine.bridge.request('inspect', { ids: assets, parts: true, scene: s });
      const issues = [];
      const add = (severity, object, message, fix) => issues.push({ severity, object, name: s.objects[object]?.name, message, fix });
      for (const aid of assets) {
        const b = info.objects[aid];
        if (!b) continue;
        const size = [0, 1, 2].map((k) => b.max[k] - b.min[k]);
        const big = Math.max(...size);
        if (big > 40) add('warning', aid, `Very large: ${big.toFixed(1)} m across.`, 'Check the scale; most props are 0.2–3 m.');
        if (big < 0.02) add('warning', aid, `Tiny: ${(big * 100).toFixed(1)} cm across.`, 'Check the scale.');
        if (b.min[1] > 0.02) add('warning', aid, `Floats ${(b.min[1] * 100).toFixed(0)} cm above the ground.`, `update_object with position y lowered by ${b.min[1].toFixed(2)}.`);
        if (b.min[1] < -0.05 && size[1] > 0.2) add('tip', aid, `Sinks ${(-b.min[1] * 100).toFixed(0)} cm into the ground.`, 'Raise it unless that is intended.');
        if (b.triangles > 150000) add('warning', aid, `Heavy: ${b.triangles.toLocaleString()} triangles.`, 'Lower segments/detail, or bevelSegments on boxes; games prefer < 20k per prop.');
        else if (b.triangles > 30000) add('tip', aid, `${b.triangles.toLocaleString()} triangles; fine for showcases, a lot for a game prop.`, 'Lower segments/detail if it is for a game.');
        // loose parts: parts that touch no other part and not the ground
        const parts = (b.parts ?? []).filter((p) => p.size > 0);
        if (parts.length > 1) {
          const touch = (p, q) => [0, 1, 2].every((k) => p.min[k] <= q.max[k] + 0.01 && q.min[k] <= p.max[k] + 0.01);
          for (const p of parts) {
            if (p.min[1] <= 0.02) continue;
            if (!parts.some((q) => q !== p && touch(p, q))) add('warning', p.id, `"${s.objects[p.id]?.name}" floats loose, touching nothing.`, 'Move it until it touches the rest, or remove it.');
          }
        }
      }
      // material and shape tips
      const checked = new Set();
      for (const aid of assets) {
        for (const oid of subtree(aid)) {
          const o = s.objects[oid];
          if (!o || checked.has(oid) || o.visible === false) continue;
          checked.add(oid);
          const m = o.material;
          if (o.type === 'box' && o.params.bevel === 0) add('tip', oid, 'Box with perfectly sharp edges looks computer-made.', 'Give it a small bevel (0.01–0.03).');
          if (m?.texture && !engine.library.images[m.texture]) add('error', oid, 'Uses a picture that is no longer in the library.', 'Pick another picture or remove it.');
          if (m && !m.emissiveIntensity && !m.pattern && ['#000000', '#ffffff'].includes(String(m.color).toLowerCase())) add('tip', oid, `Pure ${m.color === '#000000' ? 'black' : 'white'} looks flat.`, 'Use a slightly tinted dark or light colour instead.');
          if (m && m.metalness > 0.8 && m.roughness < 0.06 && m.preset !== 'chrome') add('tip', oid, 'Mirror-smooth metal can look fake.', 'Raise roughness to 0.15–0.35, or use a brushed or worn metal preset.');
        }
      }
      const weight = { error: 30, warning: 12, tip: 3 };
      const score = Math.max(0, 100 - issues.reduce((a, i) => a + weight[i.severity], 0));
      return { score, checked: assets.length, issues };
    },
  });

  // ---- house styles -----------------------------------------------------------------

  const allStyles = async () => {
    const out = { ...BUILTIN_HOUSE_STYLES };
    try {
      for (const f of await fs.readdir(dir('styles'))) if (f.endsWith('.json')) out[f.replace(/\.json$/, '')] = { ...(await readJson(path.join(dir('styles'), f))), custom: true };
    } catch {}
    return out;
  };

  registry.define({
    name: 'list_house_styles',
    title: 'List house styles',
    category: 'style',
    description: 'List house styles: built-in ones and your own saved ones. A house style keeps every asset of one game looking like a family.',
    handler: allStyles,
  });

  registry.define({
    name: 'save_house_style',
    title: 'Save house style',
    category: 'style',
    description:
      'Save a house style: a colour palette plus lighting, style and effects. Without explicit values it takes the current scene\'s look ' +
      'and (if no palette is given) the most used colours in the scene.',
    input: z.object({
      name: z.string(),
      description: z.string().optional(),
      palette: z.array(color).min(2).max(64).optional(),
      lighting: z.enum(Object.keys(LIGHTING_PRESETS)).optional(),
      style: z.enum(Object.keys(STYLES)).optional(),
    }),
    async handler(args) {
      const env = engine.scene.environment;
      const palette = args.palette ?? sceneColors(engine.scene, 16);
      if (palette.length < 2) throw new CommandError('Need at least two colours: give a palette or add some coloured objects first.');
      const style = {
        description: args.description ?? 'Saved from a scene',
        palette, lighting: args.lighting ?? env.lighting, exposure: env.exposure ?? 1, style: args.style ?? env.style ?? 'realistic',
        styleOptions: { ...DEFAULT_STYLE_OPTIONS, ...env.styleOptions }, effects: { ...DEFAULT_EFFECTS, ...env.effects },
      };
      await fs.mkdir(dir('styles'), { recursive: true });
      await fs.writeFile(path.join(dir('styles'), `${safeName(args.name)}.json`), JSON.stringify(style, null, 2));
      return { name: safeName(args.name), ...style };
    },
  });

  registry.define({
    name: 'apply_house_style',
    title: 'Apply house style',
    category: 'style',
    mutates: true,
    description:
      'Apply a house style to the scene: its lighting, style and effects, and (recolor, default true) snap every material colour to the nearest palette colour. ' +
      'While a house style is active, sprite sheets, tilesets and pixel art use its palette unless another palette is given.',
    input: z.object({ name: z.string(), recolor: z.boolean().optional() }),
    async handler({ name, recolor = true }) {
      const st = (await allStyles())[name];
      if (!st) throw new CommandError(`No house style "${name}". See list_house_styles.`);
      const env = engine.scene.environment;
      Object.assign(env, { lighting: st.lighting ?? env.lighting, exposure: st.exposure ?? env.exposure, style: st.style ?? env.style, houseStyle: name, housePalette: st.palette });
      if (st.styleOptions) env.styleOptions = { ...DEFAULT_STYLE_OPTIONS, ...st.styleOptions };
      if (st.effects) env.effects = { ...DEFAULT_EFFECTS, ...st.effects };
      let recolored = 0;
      if (recolor) {
        for (const o of Object.values(engine.scene.objects)) {
          const m = o.material;
          if (!m || o.type === 'model') continue;
          if (m.color) m.color = nearest(st.palette, m.color);
          if (m.emissive && m.emissive !== '#000000' && m.emissiveIntensity > 0) m.emissive = nearest(st.palette, m.emissive);
          if (m.pattern?.colors) m.pattern.colors = m.pattern.colors.map((c) => nearest(st.palette, c));
          recolored++;
        }
      }
      return { houseStyle: name, recolored };
    },
  });
}

// Small random changes for variations of hand-built objects.
function jitter(engine, ids, seed) {
  let s = seed * 9301 + 49297;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (const id of ids) {
    const o = engine.scene.objects[id];
    if (o.material) {
      if (o.material.pattern) o.material.pattern.seed = Math.floor(rand() * 9999);
      o.material.color = shiftColor(o.material.color, (rand() - 0.5) * 0.16);
    }
  }
  const root = engine.scene.objects[ids[0]];
  const k = 0.9 + rand() * 0.2;
  root.scale = root.scale.map((v) => v * k);
  root.rotation = [root.rotation[0], root.rotation[1] + (rand() - 0.5) * 30, root.rotation[2]];
}

function shiftColor(hex, amount) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return hex;
  const f = (v, k) => Math.max(0, Math.min(255, Math.round(v * (1 + amount * k))));
  const r = f(n >> 16, 1), g = f((n >> 8) & 255, 0.6), b = f(n & 255, -0.4);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function nearest(palette, hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return hex;
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  let best = palette[0], bd = Infinity;
  for (const p of palette) {
    const m = parseInt(p.replace('#', ''), 16);
    const d = 2 * ((m >> 16) - r) ** 2 + 4 * (((m >> 8) & 255) - g) ** 2 + 3 * ((m & 255) - b) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// Most used material colours in a scene (rough grouping), for saving a house style.
function sceneColors(scene, max) {
  const counts = new Map();
  for (const o of Object.values(scene.objects)) {
    for (const c of [o.material?.color, ...(o.material?.pattern?.colors ?? [])]) {
      if (!c || !/^#[0-9a-f]{6}$/i.test(c)) continue;
      const n = parseInt(c.slice(1), 16);
      const key = ((n >> 16) & 0xf0) << 16 | (((n >> 8) & 0xf0) << 8) | (n & 0xf0);
      const e = counts.get(key) ?? { c: c.toLowerCase(), n: 0 };
      e.n++;
      counts.set(key, e);
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, max).map((e) => e.c);
}
