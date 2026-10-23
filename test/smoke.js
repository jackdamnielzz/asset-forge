// End-to-end smoke test: starts a private engine, drives it through the HTTP API
// like an AI would, and checks that rendering and exporting really work.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockAi } from './mock-ai.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7790;
const BASE = `http://127.0.0.1:${PORT}`;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-test-'));

const proc = spawn(process.execPath, ['src/server/index.js', '--no-open'], {
  cwd: ROOT, env: { ...process.env, FORGE_PORT: String(PORT), FORGE_WORKSPACE: workspace, FORGE_POLL_MS: '50', OPENAI_API_KEY: '', GEMINI_API_KEY: '', NANOGPT_API_KEY: '', FAL_KEY: '' }, stdio: ['ignore', 'inherit', 'inherit'],
});

async function call(name, args = {}) {
  const res = await fetch(`${BASE}/api/commands/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forge-Source': 'test' }, body: JSON.stringify(args) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${name}: ${body.error}`);
  return body.result;
}

function check(cond, msg) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`  ok  ${msg}`);
}

let failed = false;
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const commands = await (await fetch(`${BASE}/api/commands`)).json();
  check(commands.length > 20, `${commands.length} commands available`);
  check(commands.some((c) => c.name === 'make_crate'), 'example plugin loaded');

  const box = await call('add_object', { type: 'box', params: { width: 2, bevel: 0.05 }, material: { preset: 'gold' } });
  check(box.id === 'box_1' && box.object.position[1] === 0.5, 'box rests on the ground');
  const bad = await fetch(`${BASE}/api/commands/add_object`, { method: 'POST', body: JSON.stringify({ type: 'box', params: { wdth: 1 } }) }).then((r) => r.json());
  check(!bad.ok && /Allowed/.test(bad.error), 'helpful error for wrong params');

  const crate = await call('make_crate', { position: [2.5, 0, 0], metalCorners: true, seed: 3 });
  const scene = await call('get_scene');
  check(scene.order.filter((id) => scene.objects[id].parent === crate.id).length >= 17, 'crate built from many parts in a group');

  await call('undo');
  check(!(await call('get_scene')).objects[crate.id], 'undo removes the whole crate in one step');
  await call('redo');

  const batch = await call('run_batch', { commands: [
    { command: 'add_object', args: { type: 'group', name: 'lamp' } },
    { command: 'add_object', args: { type: 'sphere', parent: '$0.id', position: [-2, 1.2, 0], material: { preset: 'glow' } } },
  ] });
  check(batch.results[1].object.parent === batch.results[0].id, 'run_batch resolves $N.id references');

  await call('set_environment', { lighting: 'sunset' });
  const shot = await call('render_preview', { view: 'iso', width: 512, height: 512, save: 'smoke' });
  const png = Buffer.from(shot.image, 'base64');
  check(png.readUInt32BE(0) === 0x89504e47 && png.length > 20_000, `render_preview returns a real picture (${Math.round(png.length / 1024)} KB)`);

  const rusty = await call('add_object', { type: 'cylinder', position: [-3, 0.5, 0], material: { preset: 'rusty_metal', wear: 0.5 } });
  check(rusty.object.material.pattern.type === 'rust' && rusty.object.material.pattern.colors.length === 2, 'pattern presets fill in pattern settings');
  const tweaked = await call('set_material', { id: rusty.id, pattern: { scale: 0.4 } });
  check(tweaked.changed[0] === rusty.id && (await call('get_object', { id: rusty.id })).material.pattern.type === 'rust', 'partial pattern update keeps the pattern type');
  for (const style of ['toon', 'clay', 'lowpoly', 'realistic']) {
    await call('set_style', { style });
    const s = await call('render_preview', { width: 256, height: 256 });
    check(Buffer.from(s.image, 'base64').length > 5_000, `renders in ${style} style`);
  }
  await call('set_effects', { ao: false, bloom: false });
  const plain = await call('render_preview', { width: 256, height: 256 });
  check(Buffer.from(plain.image, 'base64').length > 5_000, 'renders with effects switched off');
  await call('set_effects', { ao: true, bloom: true });

  // Phase 3: new shapes, modelling commands and generators
  await call('new_project', { name: 'phase3' });
  for (const type of ['lathe', 'extrude', 'text', 'rock']) {
    const r = await call('add_object', { type });
    check(r.object.params && r.object.type === type, `adds a ${type}`);
  }
  const badPts = await fetch(`${BASE}/api/commands/add_object`, { method: 'POST', body: JSON.stringify({ type: 'lathe', params: { points: [[0]] } }) }).then((r) => r.json());
  check(!badPts.ok && /points/.test(badPts.error), 'rejects broken point lists');
  const wall = await call('add_object', { type: 'box', position: [3, 0.5, 0], params: { depth: 0.2 } });
  const hole = await call('add_object', { type: 'cylinder', position: [3, 0.5, 0], rotation: [90, 0, 0], params: { radiusTop: 0.2, radiusBottom: 0.2 } });
  await call('cut_object', { target: wall.id, cutter: hole.id });
  check((await call('get_object', { id: hole.id })).visible === false, 'cut_object hides the cutter');
  const mirrored = await call('mirror_object', { id: wall.id });
  const m = await call('get_object', { id: mirrored.id });
  check(m.position[0] === -3 && m.scale[0] === -1, 'mirror_object flips position and scale');
  const rep = await call('repeat_object', { id: hole.id, count: 3, mode: 'circle', group: true });
  check(rep.ids.length === 5, 'repeat_object makes copies and a group');
  await call('undo');
  check(!(await call('get_scene')).objects[rep.ids[0]], 'repeat is a single undo step');
  await call('delete_object', { id: hole.id });
  check((await call('get_object', { id: wall.id })).booleans.length === 0, 'deleting a cutter removes the cut');
  const generators = commands.filter((c) => c.category === 'generators').map((c) => c.name);
  check(generators.length >= 11, `${generators.length} generators available`);
  await call('clear_scene');
  for (const [i, g] of generators.entries()) {
    const r = await call(g, { position: [(i % 4) * 1.6, 0, Math.floor(i / 4) * 1.6], seed: i + 1 });
    check(!!r.id, `${g} builds`);
  }
  const genShot = await call('render_preview', { width: 512, height: 512, save: 'generators' });
  check(Buffer.from(genShot.image, 'base64').length > 40_000, 'all generators render together');
  const genGlb = await call('export_glb', { filename: 'generators' });
  check(genGlb.bytes > 100_000, `generators export to GLB (${Math.round(genGlb.bytes / 1024)} KB)`);
  // Phase 4: animation, sprites, icons, Godot export, level kits
  await call('new_project', { name: 'phase4' });
  const coin = await call('make_coin', { symbol: 'G', radius: 0.3 });
  await call('animate_object', { id: coin.id, preset: 'spin', duration: 1.5 });
  await call('animate_object', { id: coin.id, preset: 'bob', params: { height: 0.1 } });
  const anims = await call('list_animations');
  check(anims.idle.tracks.length === 2 && anims.idle.duration === 1.5, 'animations stack on one object');
  const badAnim = await fetch(`${BASE}/api/commands/animate_object`, { method: 'POST', body: JSON.stringify({ id: coin.id, preset: 'spin', params: { speed: 3 } }) }).then((r) => r.json());
  check(!badAnim.ok && /Allowed/.test(badAnim.error), 'helpful error for wrong animation params');
  const sprites = await call('render_sprites', { target: coin.id, filename: 'coin', animation: 'idle', frames: 6, frameSize: 48, directions: 4 });
  const sheet = Buffer.from(sprites.image, 'base64');
  check(sheet.readUInt32BE(16) === 6 * 48 && sheet.readUInt32BE(20) === 4 * 48 && sprites.palette.length > 3, 'sprite sheet has frames x directions and a palette');
  await fs.copyFile(sprites.files.color, path.join(ROOT, 'test', 'last-sprites.png'));
  const chest = await call('make_chest', { position: [2, 0, 0] });
  const lid = Object.values((await call('get_scene')).objects).find((o) => o.parent === chest.id && o.name === 'lid');
  await call('animate_object', { id: lid.id, preset: 'hinge', animation: 'open', duration: 2 });
  const icons = await call('make_icons', { size: 128 });
  check(icons.files.length === 2, 'make_icons renders one icon per object');
  await fs.copyFile(icons.files[1], path.join(ROOT, 'test', 'last-icon.png'));
  const chestGlb = await call('export_glb', { filename: 'chest', target: chest.id, collision: 'convex' });
  const glbText = (await fs.readFile(chestGlb.path)).toString('latin1');
  check(/-convcolonly/.test(glbText) && /"animations"/.test(glbText), 'GLB has a collision shape and animations');
  const godot = path.join(workspace, 'fake-godot');
  await fs.mkdir(godot);
  await fs.writeFile(path.join(godot, 'project.godot'), '[application]\n');
  const g = await call('export_godot', { project: godot, target: coin.id });
  check(g.resPath === 'res://assets/forge/coin.glb', 'export_godot writes into the Godot project');
  const notGodot = await fetch(`${BASE}/api/commands/export_godot`, { method: 'POST', body: JSON.stringify({ project: workspace }) }).then((r) => r.json());
  check(!notGodot.ok && /not a Godot project/.test(notGodot.error), 'export_godot refuses folders without project.godot');
  await call('clear_scene');
  const levelKit = await call('make_level_kit', { style: 'dungeon' });
  const each = await call('export_each', { group: levelKit.id, collision: 'mesh' });
  check(each.files.length === 6, `level kit exports 6 separate pieces`);
  const kitShot = await call('render_preview', { width: 640, height: 360 });
  await fs.writeFile(path.join(ROOT, 'test', 'last-kit.png'), Buffer.from(kitShot.image, 'base64'));

  // Phase 5a: AI services (against a fake server), picture tools, 3D model import
  const ai = await startMockAi(7796, { png: shot.image, glb: await fs.readFile(each.files[0]) });
  try {
    const before = await call('list_ai_services');
    check(Object.keys(before).length === 4 && !before.openai.connected, 'lists AI services, none connected yet');
    const noKey = await fetch(`${BASE}/api/commands/generate_image`, { method: 'POST', body: JSON.stringify({ service: 'openai', prompt: 'a red apple' }) }).then((r) => r.json());
    check(!noKey.ok && /not connected/.test(noKey.error), 'explains how to connect a service');
    for (const s of ['openai', 'google', 'nanogpt', 'fal']) await call('connect_ai_service', { service: s, key: `test-key-${s}`, baseUrl: `${ai.base}/${s}` });
    const status = await call('list_ai_services');
    check(status.google.connected && !JSON.stringify(status).includes('test-key'), 'keys are saved but never sent back');
    const o1 = await call('generate_image', { service: 'openai', prompt: 'a red apple icon', transparent: true });
    const oreq = ai.seen.find((r) => r.url === '/openai/images/generations');
    check(o1.assetId && oreq.headers.authorization === 'Bearer test-key-openai' && oreq.body.background === 'transparent', 'OpenAI: request and image import');
    const g1 = await call('generate_image', { service: 'google', model: 'gemini-nano-banana-2.1', prompt: 'repaint as pixel art', references: [o1.assetId] });
    const greq = ai.seen.find((r) => r.url.includes(':generateContent'));
    check(g1.assetId && greq.headers['x-goog-api-key'] === 'test-key-google' && greq.body.contents[0].parts[1].inline_data.data.length > 100, 'Google Nano Banana: reference image sent');
    const n1 = await call('generate_image', { service: 'nanogpt', model: 'flux-kontext', prompt: 'make it night', references: [g1.assetId], transparent: true });
    const nreq = ai.seen.find((r) => r.url === '/nanogpt/v1/images/generations');
    check(n1.assetId && nreq.body.imageDataUrl.startsWith('data:image/png;base64,'), 'NanoGPT: image-to-image request');
    const vid = await call('generate_video', { service: 'nanogpt', prompt: 'a campfire', image: n1.assetId, duration: 5 });
    check(vid.videoId && ai.seen.some((r) => r.url.startsWith('/nanogpt/video/status?requestId=vid_test1')), 'NanoGPT: video job is polled and saved');
    const m3d = await call('generate_3d', { service: 'fal', image: o1.assetId, size: 1.2 });
    const freq = ai.seen.find((r) => r.url === '/fal/fal-ai/trellis-2');
    check(m3d.objectId && freq.headers.authorization === 'Key test-key-fal' && freq.body.image_url.startsWith('data:image'), 'fal.ai: image → 3D model placed in the scene');
    const modelShot = await call('render_preview', { target: m3d.objectId, width: 256, height: 256 });
    check(Buffer.from(modelShot.image, 'base64').length > 4000, 'AI 3D model renders');
  } finally {
    ai.server.close();
  }
  const px = await call('pixelate_image', { assetId: (await call('list_images'))[0].id, size: 32, palette: 'pico8' });
  check(px.width <= 32 && px.height <= 32, 'picture → pixel art');
  const seam = await call('make_seamless', { assetId: px.assetId });
  check(!!seam.assetId, 'photo → seamless texture');
  const imported = await call('import_model', { path: each.files[1], size: 2 });
  check(!!imported.objectId, 'imports a .glb model');

  // Phase 5b: pixel art — character, sprites with palette/selout/normal map, tileset, Godot resources
  await call('clear_scene');
  const hero = await call('make_character', { weapon: 'sword' });
  const heroAnims = await call('list_animations');
  check(['idle', 'walk', 'run', 'attack', 'jump'].every((a) => heroAnims[a]), 'character comes with idle/walk/run/attack/jump');
  const heroSprites = await call('render_sprites', {
    target: hero.id, filename: 'hero', animations: ['idle', 'walk'], frames: 4, frameSize: 32, directions: 4,
    palette: 'endesga32', outlineStyle: 'selout', dither: 0.4, maps: ['normal'], project: godot,
  });
  const tres = await fs.readFile(heroSprites.files.spriteFrames, 'utf8');
  check(heroSprites.rows === 8 && heroSprites.files.normal && /SpriteFrames/.test(tres) && /&"walk_left"/.test(tres) && /CanvasTexture/.test(tres), 'character sprite sheet + Godot SpriteFrames with normal map');
  await fs.copyFile(heroSprites.files.color, path.join(ROOT, 'test', 'last-hero.png'));
  const tileset = await call('make_tileset', { filename: 'grass_dirt', tileSize: 16, project: godot });
  const tileTres = await fs.readFile(tileset.files.tileset, 'utf8');
  check(/terrain_set_0\/mode = 1/.test(tileTres) && (tileTres.match(/peering_bit/g) ?? []).length === 64, 'tileset + Godot TileSet with corner terrains');
  await fs.copyFile(tileset.files.atlas, path.join(ROOT, 'test', 'last-tiles.png'));

  // Phase 6: recipes, variations, quality check, house styles
  await call('clear_scene');
  const barrel = await call('make_barrel', { position: [1, 0, 0], wear: 0.1 });
  const recipe = await call('get_recipe', { id: barrel.id });
  check(recipe.command === 'make_barrel' && recipe.args.wear === 0.1 && !('position' in recipe.args), 'generators remember their recipe');
  const remade = await call('remake', { id: barrel.id, changes: { wear: 0.9 } });
  const rb = await call('get_object', { id: remade.id });
  check(rb.recipe.args.wear === 0.9 && rb.position[0] === 1, 'remake changes options and keeps the place');
  await call('undo');
  check((await call('get_object', { id: barrel.id })).recipe.args.wear === 0.1, 'remake is one undo step');
  const vars = await call('make_variations', { id: barrel.id, count: 4 });
  check(vars.variations.length === 4 && Buffer.from(vars.image, 'base64').length > 10_000, 'variations are made side by side with a preview');
  await call('keep_variation', { id: vars.variations[2].id });
  const afterKeep = await call('get_scene');
  check(!afterKeep.objects[vars.group] && afterKeep.objects[vars.variations[2].id].position[0] === 1, 'keep_variation replaces the original and tidies up');
  const floaty = await call('add_object', { type: 'box', position: [4, 1.5, 0], params: { bevel: 0 }, material: { color: '#000000' } });
  const q = await call('check_quality', {});
  check(q.score < 100 && q.issues.some((i) => i.object === floaty.id && /Floats/.test(i.message)) && q.issues.some((i) => /sharp edges/.test(i.message)), 'quality check finds floating objects and sharp edges');
  await call('save_recipe', { id: vars.variations[2].id, name: 'my_barrel' });
  const hand = await call('add_object', { type: 'group', name: 'lamp_set' });
  await call('add_object', { type: 'sphere', parent: hand.id, material: { preset: 'glow' } });
  await call('save_recipe', { id: hand.id, name: 'lamp_set' });
  const placed = await call('use_recipe', { name: 'lamp_set', position: [-3, 0, 0] });
  const ps = await call('get_scene');
  check(ps.objects[placed.id].position[0] === -3 && ps.order.some((oid) => ps.objects[oid].parent === placed.id), 'recipes of hand-built objects are placed again with their parts');
  check((await call('list_recipes')).length === 2, 'recipes are listed in the library');
  const styles = await call('list_house_styles');
  check(Object.keys(styles).length >= 3, 'built-in house styles');
  const applied = await call('apply_house_style', { name: 'retro_pixel' });
  const env = (await call('get_scene')).environment;
  const pico = new Set(styles.retro_pixel.palette);
  const colorsNow = Object.values((await call('get_scene')).objects).filter((o) => o.material?.color).map((o) => o.material.color);
  check(applied.recolored > 0 && env.style === 'lowpoly' && colorsNow.every((c) => pico.has(c)), 'house style sets the look and snaps colours to its palette');
  const styled = await call('pixelate_image', { assetId: (await call('list_images'))[0].id, size: 24 });
  check(!!styled.assetId, 'pixel tools use the house-style palette');
  await call('save_house_style', { name: 'my_style' });
  check(!!(await call('list_house_styles')).my_style?.custom, 'own house styles are saved');

  await call('open_project', { name: 'untitled' });

  const img = await call('import_image', { data: shot.image, name: 'my-render', addToScene: true });
  check(img.assetId && img.width === 512 && img.objectId, 'import_image stores image and places it');

  const glb = await call('export_glb', { filename: 'smoke' });
  const head = (await fs.readFile(glb.path)).toString('ascii', 0, 4);
  check(head === 'glTF' && glb.bytes > 10_000, `export_glb writes a valid GLB (${Math.round(glb.bytes / 1024)} KB)`);

  await call('new_project', { name: 'second' });
  const list = await call('list_projects');
  check(list.projects.includes('untitled') && list.current === 'second', 'projects save and switch');

  await fs.copyFile(path.join(workspace, 'exports', 'smoke.png'), path.join(ROOT, 'test', 'last-smoke.png'));
  console.log('\nAll checks passed. Preview saved to test/last-smoke.png');
} catch (err) {
  failed = true;
  console.error(`\n${err.message}`);
} finally {
  proc.kill();
  // A hard kill skips the server's cleanup, so stop its hidden browser too.
  try { process.kill(Number(await fs.readFile(path.join(workspace, '.renderer', `${PORT}.pid`), 'utf8'))); } catch {}
  await new Promise((r) => setTimeout(r, 1000));
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}
