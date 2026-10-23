import { z } from 'zod';
import { MATERIAL_PRESETS, SHAPE_DEFAULTS, PATTERNS, FONTS, OBJECT_TYPES } from '../../shared/presets.js';
import { CommandError } from '../registry.js';
import { toHex } from '../../shared/colors.js';

export const vec3 = z.array(z.number()).length(3);
export const vec2 = z.array(z.number()).length(2);
// Colours are stored as "#rrggbb" (names and "#rgb" are converted), so colour maths works on them.
export const color = z.string().transform((c, ctx) => {
  if (String(c).trim().toLowerCase() === 'transparent') return 'transparent';
  const hex = toHex(c);
  if (!hex) ctx.addIssue({ code: 'custom', message: `"${c}" is not a colour; use e.g. "#ff8800" or "orange"` });
  return hex ?? c;
}).describe('CSS colour, e.g. "#ff8800" or "orange"');

export const patternInput = z.object({
  type: z.enum(Object.keys(PATTERNS)).optional()
    .describe(`Generated surface pattern: ${Object.entries(PATTERNS).map(([k, v]) => `${k} (${v.description})`).join('; ')}`),
  scale: z.number().min(0.02).max(20).optional().describe('Size of one pattern tile in metres (default 1)'),
  seed: z.number().int().optional().describe('Different seed = different but similar-looking variation'),
  variation: z.number().min(0).max(1).optional().describe('How much the pattern varies (knots, tint differences, rust amount)'),
  bump: z.number().min(0).max(4).optional().describe('Depth of the surface relief, 0 = flat'),
  angle: z.number().optional().describe('0 or 90: turns the pattern (e.g. vertical wood grain on posts)'),
  colors: z.array(color).max(2).optional().describe('Only for two-colour patterns (rust, brick, tiles): [main, second]'),
});

export const materialInput = z.object({
  preset: z.enum(Object.keys(MATERIAL_PRESETS)).optional()
    .describe(`Start from a preset (resets other material values first): ${Object.keys(MATERIAL_PRESETS).join(', ')}`),
  color: color.optional(),
  metalness: z.number().min(0).max(1).optional().describe('0 = non-metal, 1 = metal'),
  roughness: z.number().min(0).max(1).optional().describe('0 = mirror-smooth, 1 = fully matte'),
  emissive: color.optional().describe('Glow colour'),
  emissiveIntensity: z.number().min(0).max(50).optional(),
  opacity: z.number().min(0).max(1).optional(),
  transmission: z.number().min(0).max(1).optional().describe('Glass-like transparency'),
  ior: z.number().min(1).max(2.5).optional(),
  thickness: z.number().min(0).optional(),
  clearcoat: z.number().min(0).max(1).optional().describe('Glossy lacquer layer on top'),
  texture: z.string().nullable().optional().describe('Image asset id from import_image, or null to remove'),
  textureRepeat: vec2.optional().describe('How often the texture repeats [u, v]'),
  flatShading: z.boolean().optional().describe('Faceted low-poly look'),
  doubleSided: z.boolean().optional(),
  pattern: patternInput.nullable().optional()
    .describe('Generated surface (wood, rust, brick...). For tinted patterns the material colour is the lightest tone. null removes it. Partial objects update the current pattern.'),
  wear: z.number().min(0).max(1).optional().describe('Age: 0 = brand new, 1 = very old (grime, scratches, faded colour, darker worn edges on bevelled boxes)'),
});

export function defaultMaterial(preset = 'plastic') {
  const p = MATERIAL_PRESETS[preset];
  return {
    preset,
    color: '#ffffff', metalness: 0, roughness: 0.5, emissive: '#000000', emissiveIntensity: 1,
    opacity: 1, transmission: 0, ior: 1.5, thickness: 0, clearcoat: 0,
    texture: null, textureRepeat: [1, 1], flatShading: false, doubleSided: false,
    wear: 0,
    ...p,
    pattern: p.pattern ? fillPattern(p.pattern) : null,
  };
}

export function fillPattern(p) {
  const meta = PATTERNS[p.type];
  if (!meta) throw new CommandError(`Pattern needs a type: ${Object.keys(PATTERNS).join(', ')}`);
  return { scale: 1, seed: 1, variation: 0.5, bump: 1, angle: 0, ...p, colors: p.colors ?? meta.colors ?? null };
}

export function applyMaterial(current, input, engine) {
  const base = input.preset ? { ...defaultMaterial(input.preset), texture: current?.texture ?? null } : { ...current };
  const { preset, pattern, ...rest } = input;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) base[k] = v;
  if (pattern === null) base.pattern = null;
  else if (pattern) {
    const sameType = !pattern.type || pattern.type === base.pattern?.type;
    const merged = sameType ? { ...(base.pattern ?? {}), ...pattern } : { ...pattern };
    if (!sameType && !pattern.colors) delete merged.colors;
    base.pattern = fillPattern(merged);
  }
  // only a newly chosen picture is checked, so objects whose picture was deleted from the library can still be edited
  if (input.texture && !engine.library.images[input.texture]) {
    throw new CommandError(`Unknown image asset "${base.texture}". Call list_images or import_image first.`);
  }
  return base;
}

export function buildParams(type, current, given = {}, engine) {
  const defaults = SHAPE_DEFAULTS[type];
  const unknown = Object.keys(given).filter((k) => !(k in defaults));
  if (unknown.length) {
    throw new CommandError(`Unknown params for ${type}: ${unknown.join(', ')}. Allowed: ${Object.keys(defaults).join(', ') || '(none)'}`);
  }
  const params = { ...structuredClone(defaults), ...current, ...given };
  for (const [k, v] of Object.entries(params)) {
    if (k === 'assetId') continue;
    const want = Array.isArray(defaults[k]) ? 'array' : typeof defaults[k];
    const got = Array.isArray(v) ? 'array' : typeof v;
    if (want !== got) throw new CommandError(`Param ${k} must be a ${want}`);
  }
  if (type === 'lathe') checkPoints(params.points, 2, 'lathe points ([radius, y] pairs)');
  if (type === 'extrude') {
    checkPoints(params.points, 3, 'extrude points ([x, y] pairs)');
    params.holes.forEach((h, i) => checkPoints(h, 3, `extrude hole ${i}`));
  }
  if (type === 'text') {
    if (!params.text.trim()) throw new CommandError('Text cannot be empty.');
    if (!FONTS.includes(params.font)) throw new CommandError(`Unknown font. Choose: ${FONTS.join(', ')}`);
  }
  if (type === 'rock') params.detail = Math.max(0, Math.min(5, Math.round(params.detail)));
  if (type === 'voxels') {
    const n = params.palette.length;
    if (!n || n > 256 || !params.palette.every((c) => typeof c === 'string')) throw new CommandError('voxels palette: 1–256 colours like "#aa7744"');
    const ok = params.voxels.length > 0 && params.voxels.every((v) => Array.isArray(v) && v.length === 4 && v.every(Number.isInteger) && v[3] >= 0 && v[3] < n);
    if (!ok) throw new CommandError('voxels: need [[x, y, z, paletteIndex], ...] with whole numbers and an index into the palette');
    if (params.voxels.length > 200000) throw new CommandError('Too many voxels (max 200,000).');
  }
  const newAsset = given.assetId !== undefined || !current.assetId;
  if (type === 'model' && newAsset && !engine.library.models?.[params.assetId]) {
    throw new CommandError('Model objects need params.assetId from import_model or generate_3d (see list_library).');
  }
  if (type === 'image' || type === 'cutout') {
    const asset = engine.library.images[params.assetId];
    if (!asset && newAsset) throw new CommandError(`${type} objects need params.assetId (from import_image).`);
    // keep the picture's proportions (a picture deleted from the library keeps the last size)
    if (asset && given.height !== undefined && given.width === undefined) params.width = params.height * (asset.width / asset.height);
    else if (asset) params.height = params.width * (asset.height / asset.width);
  }
  return params;
}

function checkPoints(points, min, what) {
  const ok = Array.isArray(points) && points.length >= min
    && points.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)));
  if (!ok) throw new CommandError(`${what}: need at least ${min} points like [[0, 0], [0.5, 1]]`);
}

export function toScale(s) {
  return typeof s === 'number' ? [s, s, s] : s;
}

// Check a scene that comes from outside (load_scene, a project file, an old version) before using it:
// every id in order must exist, parents must exist without loops, and every shape needs a material.
// Small gaps are filled in; things that cannot be repaired give a clear error.
export function checkScene(scene) {
  const objects = scene.objects ?? {};
  if (typeof objects !== 'object' || Array.isArray(objects)) throw new CommandError('scene.objects must be an object of { id: object }.');
  const ids = Object.keys(objects);
  const order = Array.isArray(scene.order) ? scene.order.filter((id, i, all) => objects[id] && all.indexOf(id) === i) : [];
  for (const id of ids) if (!order.includes(id)) order.push(id);
  const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
  for (const id of ids) {
    const o = objects[id];
    if (!o || typeof o !== 'object') throw new CommandError(`Object "${id}" is not an object.`);
    if (!OBJECT_TYPES.includes(o.type)) throw new CommandError(`Object "${id}" has unknown type "${o.type}". Types: ${OBJECT_TYPES.join(', ')}`);
    o.id = id;
    o.name = typeof o.name === 'string' ? o.name : id;
    o.parent = o.parent && objects[o.parent] ? o.parent : null;
    if (!isVec3(o.position)) o.position = [0, 0, 0];
    if (!isVec3(o.rotation)) o.rotation = [0, 0, 0];
    o.scale = isVec3(o.scale) ? o.scale : typeof o.scale === 'number' ? toScale(o.scale) : [1, 1, 1];
    if (!o.params || typeof o.params !== 'object') o.params = structuredClone(SHAPE_DEFAULTS[o.type]);
    if (o.type === 'group') o.material = null;
    else if (!o.material || typeof o.material !== 'object') o.material = defaultMaterial();
    if (o.booleans !== undefined) o.booleans = Array.isArray(o.booleans) ? o.booleans.filter((b) => b && objects[b.id]) : [];
  }
  for (const id of ids) {
    const seen = new Set([id]);
    for (let p = objects[id].parent; p; p = objects[p].parent) {
      if (seen.has(p)) throw new CommandError(`Objects "${[...seen].join('", "')}" are inside each other in a loop.`);
      seen.add(p);
    }
  }
  return { ...scene, objects, order, animations: scene.animations && typeof scene.animations === 'object' ? scene.animations : {} };
}
