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
  glow:          { color: '#111111', metalness: 0, roughness: 0.5, emissive: '#39c6ff', emissiveIntensity: 8 },
  // presets with a generated pattern
  oak:           { color: '#c8955c', metalness: 0, roughness: 0.75, pattern: { type: 'wood', scale: 0.6 } },
  dark_wood:     { color: '#7a4f2e', metalness: 0, roughness: 0.7, pattern: { type: 'wood', scale: 0.6 } },
  floor_planks:  { color: '#c08a56', metalness: 0, roughness: 0.7, pattern: { type: 'planks', scale: 1.2 } },
  old_wood:      { color: '#a98a68', metalness: 0, roughness: 0.85, pattern: { type: 'wood', scale: 0.6 }, wear: 0.7 },
  brushed_steel: { color: '#c3c8ce', metalness: 1, roughness: 0.45, pattern: { type: 'metal', scale: 0.5 } },
  worn_metal:    { color: '#a7acb2', metalness: 1, roughness: 0.5, pattern: { type: 'scratched_metal', scale: 0.5 }, wear: 0.4 },
  rusty_metal:   { color: '#ffffff', metalness: 1, roughness: 1, pattern: { type: 'rust', scale: 0.8 } },
  cobblestone:   { color: '#9c978e', metalness: 0, roughness: 0.95, pattern: { type: 'stone', scale: 1.2, bump: 1.5 } },
  brick_wall:    { color: '#ffffff', metalness: 0, roughness: 1, pattern: { type: 'brick', scale: 1.6, bump: 1.4 } },
  floor_tiles:   { color: '#ffffff', metalness: 0, roughness: 1, pattern: { type: 'tiles', scale: 1.2 } },
  cloth:         { color: '#7b3b3b', metalness: 0, roughness: 0.95, pattern: { type: 'fabric', scale: 0.3 } },
  concrete:      { color: '#b4b1ab', metalness: 0, roughness: 0.92, pattern: { type: 'concrete', scale: 1.5 } },
  hand_painted:  { color: '#d9a15b', metalness: 0, roughness: 0.85, pattern: { type: 'painted', scale: 0.8 } },
};

// Generated patterns. "tinted" ones are coloured by the material colour (use the lightest tone);
// "absolute" ones carry their own two colours (pattern.colors = [main, second]).
export const PATTERNS = {
  solid:           { kind: 'tinted', description: 'Plain surface with very subtle variation (used for wear on plain materials)' },
  wood:            { kind: 'tinted', description: 'Wood grain with rings and knots. angle 90 turns the grain for upright parts' },
  planks:          { kind: 'tinted', description: 'Rows of wooden boards with seams' },
  metal:           { kind: 'tinted', description: 'Brushed metal streaks' },
  scratched_metal: { kind: 'tinted', description: 'Metal with many fine scratches' },
  stone:           { kind: 'tinted', description: 'Irregular stones with dark gaps (cobblestone, rock)' },
  concrete:        { kind: 'tinted', description: 'Concrete with pores and soft blotches' },
  fabric:          { kind: 'tinted', description: 'Woven cloth' },
  painted:         { kind: 'tinted', description: 'Hand-painted look with visible brush strokes and banded tones' },
  rust:            { kind: 'absolute', description: 'Metal with rust patches. colors = [metal, rust]', colors: ['#9ea3aa', '#8c3d17'] },
  brick:           { kind: 'absolute', description: 'Brick wall with mortar. colors = [brick, mortar]', colors: ['#8f3a24', '#b8b0a3'] },
  tiles:           { kind: 'absolute', description: 'Square glossy tiles with grout. colors = [tile, grout]', colors: ['#e2e2dc', '#77736d'] },
};

export const STYLES = {
  realistic: 'Physically based materials (default)',
  toon: 'Cartoon look: flat colour bands and dark outlines',
  lowpoly: 'Faceted low-poly look with fewer polygons',
  clay: 'Everything in plain grey clay: great for judging shape and proportions',
};

export const DEFAULT_EFFECTS = { ao: true, aoStrength: 1, bloom: true, bloomStrength: 0.6, bloomThreshold: 2.5 };
export const DEFAULT_STYLE_OPTIONS = { outlineWidth: 1, outlineColor: '#1b1c20', toonSteps: 3 };

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

export const OBJECT_TYPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'capsule', 'lathe', 'extrude', 'text', 'rock', 'image', 'cutout', 'group'];

export const SHAPE_DEFAULTS = {
  box:      { width: 1, height: 1, depth: 1, bevel: 0.04, bevelSegments: 4 },
  sphere:   { radius: 0.5, segments: 48 },
  cylinder: { radiusTop: 0.5, radiusBottom: 0.5, height: 1, segments: 48, thetaLength: 360 },
  cone:     { radius: 0.5, height: 1, segments: 48 },
  torus:    { radius: 0.4, tube: 0.15, segments: 48 },
  plane:    { width: 1, height: 1 },
  capsule:  { radius: 0.3, length: 0.6, segments: 24 },
  lathe:    { points: [[0, 0], [0.3, 0], [0.38, 0.25], [0.3, 0.6], [0.15, 0.75], [0.15, 0.9], [0, 0.9]], segments: 48 },
  extrude:  { points: [[-0.4, 0], [0.4, 0], [0.4, 0.5], [0, 0.9], [-0.4, 0.5]], holes: [], depth: 0.2, bevel: 0.02, bevelSegments: 3 },
  text:     { text: 'Hello', size: 0.3, depth: 0.08, bevel: 0.008, font: 'helvetiker_bold' },
  rock:     { radius: 0.5, detail: 3, roughness: 0.35, flatten: 0.35, sharpness: 0.5, seed: 1 },
  image:    { assetId: null, width: 1, height: 1 },
  cutout:   { assetId: null, width: 1, height: 1, depth: 0.05, bevel: 0.006, threshold: 0.5 },
  group:    {},
};

// Extra explanation for shape params, shown to AIs in the add_object description.
export const SHAPE_NOTES = {
  cylinder: 'thetaLength (degrees) < 360 makes a partial cylinder centred on its local +X side; e.g. thetaLength 180 with rotation [0, 0, 90] is a rounded chest lid pointing up',
  lathe: 'points = profile [[radius, y], ...] from bottom to top, spun around the Y axis. Start/end at radius 0 to close it (bottles, vases, barrels, chess pieces)',
  extrude: 'points = flat outline [[x, y], ...] pushed out by depth along Z; holes = list of outlines (blades, signs, gears, logos)',
  text: 'fonts: helvetiker_regular, helvetiker_bold, optimer_regular, optimer_bold, gentilis_regular, gentilis_bold',
  rock: 'lumpy natural stone. roughness = bumpiness, flatten = flat bottom, sharpness 0 = smooth, 1 = faceted. Different seed = different rock',
  cutout: 'turns an image into a solid shape that follows its outline (transparent PNGs work best). threshold 0-1 decides what counts as background',
};

export const FONTS = ['helvetiker_regular', 'helvetiker_bold', 'optimer_regular', 'optimer_bold', 'gentilis_regular', 'gentilis_bold'];

// Height at which a new object's origin is placed so it rests on the ground.
export function restingHeight(type, p) {
  switch (type) {
    case 'box': case 'cylinder': case 'cone': case 'plane': case 'image': case 'cutout': return (p.height ?? 1) / 2;
    case 'sphere': return p.radius ?? 0.5;
    case 'torus': return (p.radius ?? 0.4) + (p.tube ?? 0.15);
    case 'capsule': return (p.length ?? 0.6) / 2 + (p.radius ?? 0.3);
    case 'lathe': case 'extrude': return -Math.min(...(p.points ?? [[0, 0]]).map((pt) => pt[1]));
    default: return 0; // text and rock are built standing on y = 0
  }
}
