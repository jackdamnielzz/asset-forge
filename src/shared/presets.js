// Presets shared by the engine (Node) and the viewer (browser).
// Keep this file free of imports so both sides can load it directly.

export const MATERIAL_PRESETS = {
  plastic:       { color: '#d9d9d9', metalness: 0, roughness: 0.42, clearcoat: 0.25 },
  matte:         { color: '#cfcfcf', metalness: 0, roughness: 0.9 },
  ceramic:       { color: '#f2efe9', metalness: 0, roughness: 0.18, clearcoat: 1 },
  rubber:        { color: '#26272b', metalness: 0, roughness: 0.92 },
  wood:          { color: '#8b5a2b', metalness: 0, roughness: 0.72 },
  stone:         { color: '#8a8780', metalness: 0, roughness: 0.95 },
  steel:         { color: '#b9bec5', metalness: 1, roughness: 0.32 },
  brushed_metal: { color: '#a9adb3', metalness: 1, roughness: 0.55 },
  chrome:        { color: '#ffffff', metalness: 1, roughness: 0.04 },
  gold:          { color: '#ffc45c', metalness: 1, roughness: 0.22 },
  copper:        { color: '#e0805a', metalness: 1, roughness: 0.3 },
  glass:         { color: '#ffffff', metalness: 0, roughness: 0.03, transmission: 1, ior: 1.5, thickness: 0.4 },
  glow:          { color: '#111111', metalness: 0, roughness: 0.5, emissive: '#39c6ff', emissiveIntensity: 3 },
};

export const LIGHTING_PRESETS = {
  studio: {
    description: 'Neutral soft studio light. Best default for judging shape and material.',
    env: 'room', envIntensity: 0.9, background: '#2b2e35', exposure: 1.0,
    lights: [
      { type: 'directional', color: '#ffffff', intensity: 2.2, position: [4, 7, 5], shadow: true },
      { type: 'directional', color: '#c8d8ff', intensity: 0.6, position: [-5, 3, -4] },
    ],
  },
  product: {
    description: 'Bright clean white backdrop, like a webshop product photo.',
    env: 'room', envIntensity: 1.2, background: '#eceef1', exposure: 1.05,
    lights: [
      { type: 'directional', color: '#ffffff', intensity: 1.8, position: [3, 8, 4], shadow: true },
      { type: 'directional', color: '#ffffff', intensity: 0.7, position: [-4, 4, 2] },
    ],
  },
  outdoor: {
    description: 'Daylight: blue sky and a warm sun.',
    env: 'sky', sky: ['#5f9fe0', '#cfe4f7', '#8a8270'], envIntensity: 1.0, background: '#9cc7ee', exposure: 1.0,
    lights: [
      { type: 'directional', color: '#fff1d6', intensity: 3.0, position: [6, 9, 3], shadow: true },
    ],
  },
  sunset: {
    description: 'Low orange sun with purple shadows. Warm and cinematic.',
    env: 'sky', sky: ['#3b2a5c', '#ff9a5a', '#3a2630'], envIntensity: 0.8, background: '#3d2c4d', exposure: 1.05,
    lights: [
      { type: 'directional', color: '#ffa060', intensity: 3.2, position: [8, 2.5, 2], shadow: true },
      { type: 'directional', color: '#7a6cff', intensity: 0.5, position: [-5, 4, -3] },
    ],
  },
  night: {
    description: 'Cool blue moonlight with a bright rim. Moody.',
    env: 'sky', sky: ['#05070f', '#1b2a4a', '#05060a'], envIntensity: 0.45, background: '#0b0f1a', exposure: 1.1,
    lights: [
      { type: 'directional', color: '#9fb8ff', intensity: 1.6, position: [-4, 6, -3], shadow: true },
      { type: 'directional', color: '#5f7dff', intensity: 1.2, position: [3, 2, -6] },
    ],
  },
  dramatic: {
    description: 'One hard key light and a strong rim on a dark background.',
    env: 'room', envIntensity: 0.25, background: '#121316', exposure: 1.0,
    lights: [
      { type: 'directional', color: '#ffffff', intensity: 3.5, position: [5, 6, 2], shadow: true },
      { type: 'directional', color: '#ffd9a8', intensity: 2.0, position: [-3, 3, -6] },
    ],
  },
};

export const OBJECT_TYPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule', 'image', 'group'];

export const SHAPE_DEFAULTS = {
  box:      { width: 1, height: 1, depth: 1, bevel: 0.04, bevelSegments: 4 },
  sphere:   { radius: 0.5, segments: 48 },
  cylinder: { radiusTop: 0.5, radiusBottom: 0.5, height: 1, segments: 48 },
  cone:     { radius: 0.5, height: 1, segments: 48 },
  torus:    { radius: 0.4, tube: 0.15, segments: 48 },
  plane:    { width: 1, height: 1 },
  capsule:  { radius: 0.3, length: 0.6, segments: 24 },
  image:    { assetId: null, width: 1, height: 1 },
  group:    {},
};

// Half the height of a shape, used to rest new objects on the ground.
export function restingHeight(type, p) {
  switch (type) {
    case 'box': case 'cylinder': case 'cone': case 'plane': case 'image': return (p.height ?? 1) / 2;
    case 'sphere': return p.radius ?? 0.5;
    case 'torus': return (p.radius ?? 0.4) + (p.tube ?? 0.15);
    case 'capsule': return (p.length ?? 0.6) / 2 + (p.radius ?? 0.3);
    default: return 0;
  }
}
