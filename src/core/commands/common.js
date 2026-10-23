import { z } from 'zod';
import { MATERIAL_PRESETS, SHAPE_DEFAULTS, PATTERNS } from '../../shared/presets.js';
import { CommandError } from '../registry.js';

export const vec3 = z.array(z.number()).length(3);
export const vec2 = z.array(z.number()).length(2);
export const color = z.string().describe('CSS colour, e.g. "#ff8800" or "orange"');

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
  if (base.texture && !engine.library.images[base.texture]) {
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
  const params = { ...defaults, ...current, ...given };
  for (const [k, v] of Object.entries(params)) {
    if (k !== 'assetId' && typeof v !== 'number') throw new CommandError(`Param ${k} must be a number`);
  }
  if (type === 'image') {
    const asset = engine.library.images[params.assetId];
    if (!asset) throw new CommandError('Image objects need params.assetId (from import_image).');
    if (given.height !== undefined && given.width === undefined) params.width = params.height * (asset.width / asset.height);
    else params.height = params.width * (asset.height / asset.width);
  }
  return params;
}

export function toScale(s) {
  return typeof s === 'number' ? [s, s, s] : s;
}
