import { z } from 'zod';
import { MATERIAL_PRESETS, SHAPE_DEFAULTS } from '../../shared/presets.js';
import { CommandError } from '../registry.js';

export const vec3 = z.array(z.number()).length(3);
export const vec2 = z.array(z.number()).length(2);
export const color = z.string().describe('CSS colour, e.g. "#ff8800" or "orange"');

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
});

export function defaultMaterial(preset = 'plastic') {
  return {
    preset,
    color: '#ffffff', metalness: 0, roughness: 0.5, emissive: '#000000', emissiveIntensity: 1,
    opacity: 1, transmission: 0, ior: 1.5, thickness: 0, clearcoat: 0,
    texture: null, textureRepeat: [1, 1], flatShading: false, doubleSided: false,
    ...MATERIAL_PRESETS[preset],
  };
}

export function applyMaterial(current, input, engine) {
  const base = input.preset ? { ...defaultMaterial(input.preset), texture: current?.texture ?? null } : { ...current };
  const { preset, ...rest } = input;
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) base[k] = v;
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
