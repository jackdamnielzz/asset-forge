// Animation presets, shared by the engine (validation, docs) and the viewer (playback,
// sprites, GLB export). Every preset returns an offset from the object's normal pose
// at time t (0..1 through the animation): position/rotation are added, scale multiplied.
// All looping presets end where they start, so loops are seamless.

const TAU = Math.PI * 2;
const AXES = { x: 0, y: 1, z: 2 };
const vecOn = (axis, v) => { const out = [0, 0, 0]; out[AXES[axis] ?? 1] = v; return out; };
const smooth = (t) => t * t * (3 - 2 * t);

export const ANIMATION_PRESETS = {
  spin: {
    description: 'Turn around an axis (coins, pickups, turntables). turns = full turns per loop',
    params: { axis: 'y', turns: 1 },
    sample: (p, t) => ({ rotation: vecOn(p.axis, 360 * p.turns * t) }),
  },
  bob: {
    description: 'Float up and down (pickups, floating crystals). height in metres',
    params: { height: 0.08 },
    sample: (p, t) => ({ position: [0, Math.sin(t * TAU) * p.height, 0] }),
  },
  pulse: {
    description: 'Grow and shrink a little (heartbeat, magic). amount 0.1 = 10%',
    params: { amount: 0.1 },
    sample: (p, t) => { const s = 1 + Math.sin(t * TAU) * p.amount; return { scale: [s, s, s] }; },
  },
  swing: {
    description: 'Rock back and forth around an axis (signs, lanterns, pendulums). angle in degrees',
    params: { axis: 'z', angle: 15 },
    sample: (p, t) => ({ rotation: vecOn(p.axis, Math.sin(t * TAU) * p.angle) }),
  },
  hinge: {
    description: 'Open and close around the object\'s own origin, like a door or a chest lid (use the lid/door group). angle in degrees; pingpong false = open once',
    params: { axis: 'x', angle: -100, pingpong: true },
    sample: (p, t) => ({ rotation: vecOn(p.axis, p.angle * (p.pingpong ? (1 - Math.cos(t * TAU)) / 2 : smooth(t))) }),
  },
  shake: {
    description: 'Jitter in place (hit reaction, rumbling). amount in metres',
    params: { amount: 0.02 },
    sample: (p, t) => ({ position: [Math.sin(t * TAU * 7) * p.amount, Math.sin(t * TAU * 11 + 1) * p.amount * 0.5, Math.sin(t * TAU * 5 + 2) * p.amount] }),
  },
  hop: {
    description: 'Jump up and land with a little squash (cute pickups, characters). height in metres',
    params: { height: 0.25 },
    sample: (p, t) => {
      const air = Math.sin(t * Math.PI);
      const squash = t < 0.12 ? 1 - (0.12 - t) * 1.2 : t > 0.88 ? 1 - (t - 0.88) * 1.2 : 1;
      return { position: [0, air * p.height, 0], scale: [2 - squash, squash, 2 - squash] };
    },
  },
};

// Custom keyframes: [{ t: 0..1, position?, rotation?, scale? }] (offsets like the presets).
export function sampleKeys(keys, t) {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const out = {};
  for (const prop of ['position', 'rotation', 'scale']) {
    const ks = sorted.filter((k) => k[prop]);
    if (!ks.length) continue;
    let a = ks[0], b = ks[ks.length - 1];
    for (let i = 0; i < ks.length - 1; i++) if (t >= ks[i].t && t <= ks[i + 1].t) { a = ks[i]; b = ks[i + 1]; break; }
    const span = b.t - a.t;
    const f = span > 0 ? smooth(Math.min(1, Math.max(0, (t - a.t) / span))) : 0;
    out[prop] = a[prop].map((v, i) => v + (b[prop][i] - v) * f);
  }
  return out;
}

// Combined offset of every track in an animation that targets `id`.
export function sampleObject(animation, id, t) {
  const total = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  let any = false;
  for (const track of animation.tracks) {
    if (track.target !== id) continue;
    const preset = ANIMATION_PRESETS[track.preset];
    const local = ((t * (track.speed ?? 1)) + (track.offset ?? 0)) % 1;
    const o = track.keys ? sampleKeys(track.keys, local) : preset ? preset.sample({ ...preset.params, ...track.params }, local) : {};
    if (o.position) total.position = total.position.map((v, i) => v + o.position[i]);
    if (o.rotation) total.rotation = total.rotation.map((v, i) => v + o.rotation[i]);
    if (o.scale) total.scale = total.scale.map((v, i) => v * o.scale[i]);
    any = true;
  }
  return any ? total : null;
}
