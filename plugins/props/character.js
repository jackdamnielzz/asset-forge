import { defineGenerator, hex } from './kit.js';

// A simple jointed puppet for sprite characters. Limbs are groups placed at the joints,
// so animations can swing them naturally. It faces +Z (towards the default camera).
export function register(registry, z, engine) {
  defineGenerator(registry, z, engine, {
    name: 'make_character',
    title: 'Character',
    description:
      'A jointed game character (chibi or normal proportions) with hair or a hat, clothes colours and an optional weapon/shield, ' +
      'plus ready-made animations: idle, walk, run, attack, jump. Made for 8-direction sprite sheets: ' +
      'render_sprites { target, animations: ["idle","walk","attack"], directions: 8 } — and it also exports as an animated 3D model.',
    input: (z) => z.object({
      style: z.enum(['chibi', 'normal']).optional().describe('chibi = big head, reads well at small sprite sizes (default)'),
      height: z.number().min(0.2).max(10).optional().describe('Default 1 m'),
      skin: hex(z).optional(),
      hair: hex(z).optional(),
      shirt: hex(z).optional(),
      pants: hex(z).optional(),
      shoes: hex(z).optional(),
      hat: z.enum(['none', 'wizard', 'helmet', 'hood']).optional(),
      weapon: z.enum(['none', 'sword', 'staff']).optional(),
      shield: z.boolean().optional(),
      animations: z.boolean().optional().describe('Add the ready-made animations (default true)'),
    }),
    async build(a, k, root) {
      const H = a.height ?? 1, chibi = (a.style ?? 'chibi') === 'chibi';
      const P = chibi
        ? { head: 0.36, torso: 0.27, leg: 0.24, arm: 0.24, width: 0.3, limb: 0.1 }
        : { head: 0.16, torso: 0.33, leg: 0.42, arm: 0.36, width: 0.26, limb: 0.075 };
      const u = (v) => v * H;
      const matte = (c, extra = {}) => ({ preset: 'matte', color: c, roughness: 0.75, ...extra });
      const skin = matte(a.skin ?? '#f1c4a0'), hair = matte(a.hair ?? '#5a3825'), shirt = matte(a.shirt ?? '#3f7fd1');
      const pants = matte(a.pants ?? '#3b3f58'), shoes = matte(a.shoes ?? '#4a3326');
      const box = (parent, name, size, pos, mat, bevel = 0.18) =>
        k.part(parent, 'box', name, pos, { width: u(size[0]), height: u(size[1]), depth: u(size[2]), bevel: u(Math.min(...size) * bevel) }, mat);

      const legLen = P.leg, torsoH = P.torso, headH = P.head;
      const hips = await k.group(root, 'hips', [0, u(legLen), 0]);
      await box(hips, 'torso', [P.width, torsoH, P.width * 0.62], [0, u(torsoH / 2), 0], shirt);
      await box(hips, 'belt', [P.width * 1.02, torsoH * 0.12, P.width * 0.66], [0, u(torsoH * 0.08), 0], matte('#3a2a1e'));

      // head with face, hair or hat
      const neck = await k.group(hips, 'head', [0, u(torsoH), 0]);
      const hw = chibi ? headH * 0.95 : headH * 0.85;
      await box(neck, 'face', [hw, headH, hw * 0.92], [0, u(headH / 2), 0], skin, 0.28);
      for (const x of [-1, 1]) {
        await box(neck, 'eye', [hw * 0.13, headH * 0.2, 0.02 / H], [u(x * hw * 0.22), u(headH * 0.48), u(hw * 0.46)], matte('#1d1d26', { roughness: 0.3 }), 0.3);
      }
      const hat = a.hat ?? 'none';
      if (hat === 'none' || hat === 'hood') {
        await box(neck, 'hair', [hw * 1.08, headH * 0.38, hw * 1.0], [0, u(headH * 0.86), u(-hw * 0.03)], hat === 'hood' ? shirt : hair, 0.3);
        await box(neck, 'hair_back', [hw * 1.06, headH * 0.7, hw * 0.3], [0, u(headH * 0.6), u(-hw * 0.38)], hat === 'hood' ? shirt : hair, 0.3);
      }
      if (hat === 'wizard') {
        await k.part(neck, 'cylinder', 'hat_brim', [0, u(headH * 0.98), 0], { radiusTop: u(hw * 0.85), radiusBottom: u(hw * 0.85), height: u(0.02), segments: 24 }, matte('#4b2f7a'));
        await k.part(neck, 'cone', 'hat', [0, u(headH * 0.98 + headH * 0.45), 0], { radius: u(hw * 0.5), height: u(headH * 0.9), segments: 24 }, matte('#4b2f7a'), { rotation: [-8, 0, 0] });
      }
      if (hat === 'helmet') {
        await k.part(neck, 'lathe', 'helmet', [0, u(headH * 0.45), 0], {
          points: [[0, u(headH * 0.62)], [u(hw * 0.42), u(headH * 0.55)], [u(hw * 0.6), u(headH * 0.3)], [u(hw * 0.62), 0], [u(hw * 0.58), 0]], segments: 32,
        }, { preset: 'steel', color: '#aab2bb', roughness: 0.35 });
      }

      // arms swing from the shoulders; hands at the end
      const armW = P.limb, armLen = P.arm;
      const arms = {};
      for (const [side, x] of [['L', 1], ['R', -1]]) {
        const shoulder = await k.group(hips, `arm_${side}`, [u(x * (P.width / 2 + armW / 2 + 0.005)), u(torsoH * 0.9), 0]);
        await box(shoulder, 'sleeve', [armW, armLen * 0.55, armW], [0, u(-armLen * 0.27), 0], shirt);
        await box(shoulder, 'arm', [armW * 0.9, armLen * 0.5, armW * 0.9], [0, u(-armLen * 0.72), 0], skin);
        arms[side] = shoulder;
      }
      // legs swing from the hips (children of the root so the body can bob separately)
      const legs = {};
      for (const [side, x] of [['L', 1], ['R', -1]]) {
        const hip = await k.group(root, `leg_${side}`, [u(x * P.width * 0.24), u(legLen), 0]);
        await box(hip, 'leg', [P.limb * 1.05, legLen * 0.8, P.limb * 1.1], [0, u(-legLen * 0.42), 0], pants);
        await box(hip, 'shoe', [P.limb * 1.15, legLen * 0.22, P.limb * 1.6], [0, u(-legLen * 0.89), u(P.limb * 0.2)], shoes);
        legs[side] = hip;
      }

      // equipment in the right hand / on the left arm
      const hand = [0, u(-armLen * 0.95), u(armW * 0.2)];
      if (a.weapon === 'sword') {
        const grip = await k.group(arms.R, 'sword', hand, [90, 0, 0]);
        await k.part(grip, 'box', 'blade', [0, u(0.22), 0], { width: u(0.05), height: u(0.36), depth: u(0.012), bevel: u(0.004) }, { preset: 'chrome', color: '#d9dee4', roughness: 0.15 });
        await k.part(grip, 'box', 'guard', [0, u(0.035), 0], { width: u(0.13), height: u(0.025), depth: u(0.03), bevel: u(0.006) }, { preset: 'gold' });
      }
      if (a.weapon === 'staff') {
        const grip = await k.group(arms.R, 'staff', hand);
        await k.part(grip, 'cylinder', 'pole', [0, u(0.1), 0], { radiusTop: u(0.016), radiusBottom: u(0.016), height: u(0.85), segments: 10 }, { preset: 'dark_wood', color: '#6e4a2d' });
        await k.part(grip, 'sphere', 'orb', [0, u(0.55), 0], { radius: u(0.05), segments: 20 }, { color: '#1a1030', emissive: '#a66bff', emissiveIntensity: 5 });
      }
      if (a.shield) {
        await k.part(arms.L, 'cylinder', 'shield', [u(armW * 0.7), u(-armLen * 0.6), 0], { radiusTop: u(0.13), radiusBottom: u(0.13), height: u(0.03), segments: 24 },
          { preset: 'worn_metal', color: '#8a3b2e', wear: 0.3 }, { rotation: [0, 0, 90] });
      }

      if (a.animations === false) return;
      const anim = (id, preset, params, animation, extra = {}) => engine.execute('animate_object', { id, preset, params, animation, ...extra }, k.meta);
      const keys = (id, animation, duration, list) => engine.execute('set_keyframes', { id, animation, duration, keys: list }, k.meta);
      // idle: breathing and a gentle arm sway
      await anim(hips, 'bob', { height: u(0.012) }, 'idle', { duration: 2 });
      await anim(arms.L, 'swing', { axis: 'x', angle: 4 }, 'idle');
      await anim(arms.R, 'swing', { axis: 'x', angle: 4 }, 'idle', { offset: 0.5 });
      // walk: legs and arms in opposite pairs, body bobbing twice per step cycle
      await anim(legs.L, 'swing', { axis: 'x', angle: 28 }, 'walk', { duration: 0.8 });
      await anim(legs.R, 'swing', { axis: 'x', angle: 28 }, 'walk', { offset: 0.5 });
      await anim(arms.L, 'swing', { axis: 'x', angle: 24 }, 'walk', { offset: 0.5 });
      await anim(arms.R, 'swing', { axis: 'x', angle: 24 }, 'walk');
      await anim(hips, 'bob', { height: u(0.02) }, 'walk', { speed: 2 });
      // run: bigger swings, faster, leaning forward
      await anim(legs.L, 'swing', { axis: 'x', angle: 48 }, 'run', { duration: 0.55 });
      await anim(legs.R, 'swing', { axis: 'x', angle: 48 }, 'run', { offset: 0.5 });
      await anim(arms.L, 'swing', { axis: 'x', angle: 45 }, 'run', { offset: 0.5 });
      await anim(arms.R, 'swing', { axis: 'x', angle: 45 }, 'run');
      await anim(hips, 'bob', { height: u(0.035) }, 'run', { speed: 2 });
      await keys(hips, 'run', 0.55, [{ t: 0, rotation: [12, 0, 0] }, { t: 1, rotation: [12, 0, 0] }]);
      // attack: wind up over the head, strike down, return
      await keys(arms.R, 'attack', 0.6, [
        { t: 0, rotation: [0, 0, 0] }, { t: 0.35, rotation: [-150, 0, -10] }, { t: 0.55, rotation: [35, 0, 0] }, { t: 1, rotation: [0, 0, 0] },
      ]);
      await keys(hips, 'attack', 0.6, [{ t: 0, rotation: [0, 0, 0] }, { t: 0.35, rotation: [-6, 12, 0] }, { t: 0.55, rotation: [10, -8, 0] }, { t: 1, rotation: [0, 0, 0] }]);
      // jump: crouch, leap with tucked legs, land
      await keys(root, 'jump', 0.8, [
        { t: 0, position: [0, 0, 0] }, { t: 0.15, position: [0, u(-0.04), 0] }, { t: 0.5, position: [0, u(0.35), 0] }, { t: 0.85, position: [0, 0, 0] }, { t: 1, position: [0, 0, 0] },
      ]);
      for (const leg of [legs.L, legs.R]) {
        await keys(leg, 'jump', 0.8, [{ t: 0, rotation: [0, 0, 0] }, { t: 0.5, rotation: [-35, 0, 0] }, { t: 0.85, rotation: [0, 0, 0] }, { t: 1, rotation: [0, 0, 0] }]);
      }
      for (const arm of [arms.L, arms.R]) {
        await keys(arm, 'jump', 0.8, [{ t: 0, rotation: [0, 0, 0] }, { t: 0.5, rotation: [-160, 0, 0] }, { t: 0.85, rotation: [0, 0, 0] }, { t: 1, rotation: [0, 0, 0] }]);
      }
    },
  });
}
