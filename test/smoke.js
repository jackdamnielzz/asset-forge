// End-to-end smoke test: starts a private engine, drives it through the HTTP API
// like an AI would, and checks that rendering and exporting really work.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { startMockAi } from './mock-ai.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7790;
const BASE = `http://127.0.0.1:${PORT}`;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-test-'));

const proc = spawn(process.execPath, ['src/server/index.js', '--no-open'], {
  cwd: ROOT, env: { ...process.env, FORGE_PORT: String(PORT), FORGE_WORKSPACE: workspace, FORGE_NO_BACKUP: '1', FORGE_POLL_MS: '50', OPENAI_API_KEY: '', GEMINI_API_KEY: '', NANOGPT_API_KEY: '', FAL_KEY: '' }, stdio: ['ignore', 'inherit', 'inherit'],
});

async function call(name, args = {}) {
  const res = await fetch(`${BASE}/api/commands/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forge-Source': 'test' }, body: JSON.stringify(args) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${name}: ${body.error}`);
  return body.result;
}

// For calls that are expected to fail: returns { status, ok, error }.
async function attempt(name, args = {}, base = BASE, headers = {}) {
  const res = await fetch(`${base}/api/commands/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(args) });
  return { status: res.status, ...(await res.json()) };
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
    check(Object.keys(before).length === 5 && !before.openai.connected, 'lists AI services, none connected yet');
    const noKey = await fetch(`${BASE}/api/commands/generate_image`, { method: 'POST', body: JSON.stringify({ service: 'openai', prompt: 'a red apple' }) }).then((r) => r.json());
    check(!noKey.ok && /not connected/.test(noKey.error), 'explains how to connect a service');
    for (const s of ['openai', 'google', 'nanogpt', 'pixellab', 'fal']) await call('connect_ai_service', { service: s, key: `test-key-${s}`, baseUrl: `${ai.base}/${s}` });
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
    const pl = await call('generate_image', { service: 'pixellab', prompt: 'a tiny knight', size: '48x48', transparent: true, references: [o1.assetId] });
    const plreq = ai.seen.find((r) => r.url === '/pixellab/create-image-pixflux');
    check(pl.assetId && plreq.headers.authorization === 'Bearer test-key-pixellab' && plreq.body.image_size.width === 48 && plreq.body.no_background && plreq.body.init_image.type === 'base64', 'PixelLab: pixflux request with a starting image');
    // full PixelLab: tools and settings read from PixelLab's own specification
    const plTools = await call('pixellab_tools');
    check(plTools.some((t) => t.tool === 'create-tileset' && t.background) && plTools.some((t) => t.tool === 'objects/{object_id}/animations'), 'PixelLab tools are read from its specification');
    const plInfo = await call('pixellab_tool_info', { tool: 'create-image-pixflux' });
    check(plInfo.params.properties.outline.enum.length === 4 && plInfo.params.properties.init_image['x-image'] && plInfo.params.properties.image_size.properties.width.maximum === 400, 'PixelLab settings come with choices, limits and picture fields');
    const plRun = await call('pixellab_run', { tool: 'create-image-pixflux', params: { description: 'a gem', image_size: { width: 32, height: 32 }, outline: 'selective outline', init_image: o1.assetId } });
    const plReq = ai.seen.filter((r) => r.url === '/pixellab/create-image-pixflux').pop();
    check(plRun.assets.length === 1 && plReq.body.outline === 'selective outline' && plReq.body.init_image.type === 'base64' && plReq.body.init_image.base64.length > 100, 'pixellab_run sends every setting and converts library pictures');
    const plJob = await call('pixellab_run', { tool: 'create-tileset', params: { lower_description: 'water', upper_description: 'grass' } });
    check(plJob.jobId === 'job1' && plJob.assets.length === 3, `long PixelLab jobs are followed and all pictures collected (${plJob.assets.length})`);
    const plPath = await call('pixellab_run', { tool: 'objects/{object_id}/animations', params: { action: 'wave' }, pathParams: { object_id: 'obj9' } });
    check(plPath.response.animation_id === 'anim1' && plPath.note, 'tools with an id in their address work and report non-picture results');
    const plBad = await fetch(`${BASE}/api/commands/pixellab_run`, { method: 'POST', body: JSON.stringify({ tool: 'objects/{object_id}/animations', params: { action: 'x' } }) }).then((r) => r.json());
    check(!plBad.ok && /needs object_id/.test(plBad.error), 'asks for missing ids');
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
  const modelBox = await call('add_object', { type: 'box' });
  const modelCut = await attempt('cut_object', { target: imported.objectId, cutter: modelBox.id });
  check(!modelCut.ok && /imported models/.test(modelCut.error), 'imported models cannot be cut (clear message)');

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

  // Phase 7: effects, backgrounds, colour tools, style check, pixel edits, Aseprite, sheets, voxels
  for (const type of ['explosion', 'fire', 'smoke', 'magic', 'sparks', 'glitter', 'heal', 'lightning']) {
    const fx = await call('make_effect', { type, size: 32 });
    if (type === 'fire') check(fx.columns === 8 && fx.loop && fx.files.sheet.endsWith('fire.png'), 'effects render as sprite strips');
  }
  const bg = await call('make_parallax', { theme: 'mountains', time: 'sunset', width: 256, height: 144 });
  check(bg.layers.length >= 4 && bg.scrollSpeeds[0] === 0, 'parallax background with layers and scroll speeds');
  await fs.copyFile(bg.preview, path.join(ROOT, 'test', 'last-parallax.png'));
  const pixelPic = await call('pixelate_image', { assetId: (await call('list_images'))[0].id, size: 32, palette: 'pico8' });
  const pal = await call('extract_palette', { assetId: pixelPic.assetId, count: 8, saveAsHouseStyle: 'stolen' });
  check(pal.colors.length > 2 && (await call('list_house_styles')).stolen, 'steals a palette and saves it as a house style');
  const variants = await call('make_palette_variants', { assetId: pixelPic.assetId, count: 3 });
  const swapped = await call('recolor_image', { assetId: pixelPic.assetId, map: { [pal.colors[0]]: '#ff00ff' } });
  check(variants.variants.length === 3 && swapped.assetId, 'colour variants and colour swaps');
  const painted = await call('paint_pixels', { assetId: pixelPic.assetId, pixels: [[0, 0, '#ff0000'], [1, 0, null]], fills: [[5, 5, '#00ff00']] });
  check(!!painted.assetId, 'paints pixels and flood-fills');
  const style = await call('check_pixel_style', { assetId: shot && (await call('list_images'))[0].id });
  check(!style.ok && style.issues.length > 0, 'pixel style check flags a non-pixel picture');
  const cleanStyle = await call('check_pixel_style', { assetId: pixelPic.assetId, palette: 'pico8' });
  check(cleanStyle.semiTransparent === 0 && cleanStyle.offPalette === 0, 'pixel style check passes clean pixel art');
  const heroImg = await call('import_image', { path: heroSprites.files.color, name: 'hero' });
  const ase = await call('export_aseprite', { assetId: heroImg.assetId, frameWidth: 32, rowNames: heroSprites.rowNames });
  const aseBuf = await fs.readFile(ase.path);
  check(aseBuf.readUInt16LE(4) === 0xa5e0 && aseBuf.readUInt16LE(6) === 32 && aseBuf.readUInt32LE(0) === aseBuf.length && ase.tags[2] === heroSprites.rowNames[2], 'Aseprite file with frames and tags');
  await call('clear_scene');
  const kit2 = await call('make_level_kit', { style: 'cottage' });
  const iso = await call('make_iso_tiles', { group: kit2.id, tileWidth: 48 });
  check(iso.cells.length === 6 && iso.files.sheet, 'isometric tiles from a level kit');
  await fs.copyFile(iso.files.sheet, path.join(ROOT, 'test', 'last-iso.png'));
  await call('clear_scene');
  await call('make_barrel', { position: [-1, 0, 0] });
  await call('make_crystal', { position: [1, 0, 0] });
  const props = await call('make_prop_sheet', { frameSize: 32, palette: 'endesga32' });
  check(props.cells.length === 2, 'prop sheet with shared palette');
  const vox = await call('add_object', { type: 'voxels', params: { voxelSize: 0.1, voxels: [[0, 0, 0, 0], [1, 0, 0, 1]], palette: ['#aa4422', '#2266aa'] } });
  await call('edit_voxels', { id: vox.id, add: [[0, 1, 0, '#ffcc00']], remove: [[1, 0, 0]] });
  const voxObj = await call('get_object', { id: vox.id });
  check(voxObj.params.voxels.length === 2 && voxObj.params.palette.includes('#ffcc00'), 'edits voxels (add, remove, new colour)');
  const fromPic = await call('voxels_from_image', { assetId: pixelPic.assetId, depth: 1 });
  check(fromPic.blocks > 50, 'pixel picture → 3D blocks');
  // a tiny MagicaVoxel file: 2 voxels, palette with 2 colours
  const chunk = (id, content, children = Buffer.alloc(0)) => { const h = Buffer.alloc(12); h.write(id, 0, 'ascii'); h.writeUInt32LE(content.length, 4); h.writeUInt32LE(children.length, 8); return Buffer.concat([h, content, children]); };
  const sizeC = Buffer.alloc(12); sizeC.writeUInt32LE(2, 0); sizeC.writeUInt32LE(2, 4); sizeC.writeUInt32LE(2, 8);
  const xyzi = Buffer.from([2, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 2]);
  const rgba = Buffer.alloc(1024); rgba.set([255, 0, 0, 255], 0); rgba.set([0, 0, 255, 255], 4);
  const voxFile = Buffer.concat([Buffer.from('VOX '), Buffer.from([150, 0, 0, 0]), chunk('MAIN', Buffer.alloc(0), Buffer.concat([chunk('SIZE', sizeC), chunk('XYZI', xyzi), chunk('RGBA', rgba)]))]);
  const vimp = await call('import_vox', { data: voxFile.toString('base64'), name: 'tiny' });
  const vo = await call('get_object', { id: vimp.id });
  check(vimp.blocks === 2 && vo.params.palette.includes('#ff0000') && vo.params.voxels.some((v) => v[1] === 1), 'imports a MagicaVoxel .vox (Z up becomes Y up)');
  // a damaged file that claims 4 billion voxels must give an error, not crash the engine
  const liar = Buffer.from(voxFile); liar.writeUInt32LE(0xffffffff, voxFile.indexOf('XYZI') + 12);
  const badVox = await attempt('import_vox', { data: liar.toString('base64') });
  check(badVox.status === 400 && /damaged/.test(badVox.error) && (await call('get_scene')).objects[vimp.id], 'damaged .vox files give a clear error');
  const voxShot = await call('render_preview', { width: 256, height: 256 });
  check(Buffer.from(voxShot.image, 'base64').length > 5000, 'voxels render');

  // Phase 8: size reference, asset library, access protection
  const sized = await call('render_preview', { target: vox.id, sizeReference: true, width: 256, height: 256 });
  check(Buffer.from(sized.image, 'base64').length > 5000, 'renders with a 1.8 m size reference');
  const saved = await call('save_asset', { id: fromPic.id, tags: ['Pixel', 'prop'], description: 'blocky test item' });
  check(Buffer.from(saved.image, 'base64').length > 1000, 'save_asset stores a thumbnail');
  const found = await call('search_library', { query: 'blocky', tags: ['pixel'] });
  check(found.items.length === 1 && found.items[0].kind === 'asset' && found.tags.includes('prop'), 'search finds assets by words and tags');
  const thumb = await fetch(`${BASE}${found.items[0].thumbUrl}`);
  check(thumb.ok && thumb.headers.get('content-type') === 'image/png', 'thumbnails are served');
  const placedAsset = await call('place_asset', { name: saved.asset, position: [3, 0, 0] });
  check(!!placedAsset.id, 'places a library asset');
  await call('tag_item', { kind: 'image', id: pixelPic.assetId, tags: ['palette-test'] });
  check((await call('search_library', { tags: ['palette-test'] })).items[0]?.id === pixelPic.assetId, 'tags images');
  await call('delete_library_item', { kind: 'asset', id: saved.asset });
  check(!(await call('search_library', { query: 'blocky' })).items.some((i) => i.kind === 'asset'), 'deletes from the library');
  const csrf = await fetch(`${BASE}/api/commands/clear_scene`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' }, body: '{}' });
  check(csrf.status === 403, 'refuses commands sent by other websites');
  // fetch() does not let you change the Host header, so use a plain request
  const rebind = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: PORT, path: '/api/scene', headers: { Host: 'attacker.example:7790' } }, (r) => { r.resume(); resolve(r.statusCode); }));
  check(rebind === 421, 'refuses unknown host names');

  // Documentation for other AIs: complete and generated from the live command list
  const spec = await (await fetch(`${BASE}/api/openapi.json`)).json();
  const allCommands = await (await fetch(`${BASE}/api/commands`)).json();
  const documented = allCommands.filter((c) => spec.paths[`/api/commands/${c.name}`]?.post?.operationId === c.name);
  check(spec.openapi === '3.1.0' && documented.length === allCommands.length, `OpenAPI describes all ${allCommands.length} commands`);
  const undocumented = allCommands.flatMap((c) => Object.entries(c.inputSchema.properties ?? {}).filter(([, p]) => !p.description).map(([k]) => `${c.name}.${k}`));
  check(!undocumented.length, `every input is explained${undocumented.length ? ` (missing: ${undocumented.join(', ')})` : ''}`);
  const llms = await (await fetch(`${BASE}/llms.txt`)).text();
  check(allCommands.every((c) => llms.includes(`- ${c.name}:`)), 'llms.txt lists every command');
  const md = await (await fetch(`${BASE}/docs/api.md`)).text();
  const page = await (await fetch(`${BASE}/docs`)).text();
  check(allCommands.every((c) => md.includes(`### ${c.name}`)) && page.includes('id="add_object"'), 'API reference and docs page cover every command');

  // Versions, backups, grouping
  await call('new_project', { name: 'history' });
  const a1 = await call('add_object', { type: 'box', position: [1, 0.5, 0] });
  const a2 = await call('add_object', { type: 'sphere', position: [3, 0.5, 2] });
  const cp = await call('save_checkpoint', { note: 'two shapes' });
  await call('clear_scene');
  const versions = await call('list_versions');
  check(versions.some((v) => v.id === cp.id && v.kind === 'checkpoint') && versions.some((v) => v.kind === 'safety'), 'checkpoints and a safety version before clearing');
  await call('restore_version', { id: cp.id });
  check((await call('get_scene')).order.length === 2, 'restores an earlier version');
  const grp = await call('group_objects', { ids: [a1.id, a2.id], name: 'pair' });
  const gObj = await call('get_object', { id: grp.id });
  check(gObj.position[0] === 2 && (await call('get_object', { id: a1.id })).position[0] === -1, 'group sits in the middle, objects keep their place');
  await call('update_object', { id: grp.id, rotation: [0, 90, 0], position: [10, 0, 0] });
  await call('ungroup', { id: grp.id });
  const after = await call('get_object', { id: a1.id });
  // local (-1, 0, -1) turned 90° around Y lands at (-1, 0, 1), plus the group's (10, 0, 0)
  check(after.parent === null && Math.abs(after.position[0] - 9) < 1e-4 && Math.abs(after.position[2] - 1) < 1e-4 && Math.abs(after.rotation[1] - 90) < 1e-4,
    `ungroup keeps world position and rotation (${after.position.join(', ')})`);
  const backupDir = path.join(workspace, 'usb-stick');
  const bk = await call('backup_now', { to: backupDir });
  check((await fs.readdir(path.join(bk.folder, 'projects'))).some((f) => f.startsWith('history')), 'backs up projects to a chosen folder');

  await call('open_project', { name: 'untitled' });

  const img = await call('import_image', { data: shot.image, name: 'my-render', addToScene: true });
  check(img.assetId && img.width === 512 && img.objectId, 'import_image stores image and places it');

  const glb = await call('export_glb', { filename: 'smoke' });
  const head = (await fs.readFile(glb.path)).toString('ascii', 0, 4);
  check(head === 'glTF' && glb.bytes > 10_000, `export_glb writes a valid GLB (${Math.round(glb.bytes / 1024)} KB)`);

  await call('new_project', { name: 'second' });
  const list = await call('list_projects');
  check(list.projects.includes('untitled') && list.current === 'second', 'projects save and switch');

  // save as: never silently overwrite another project; undo afterwards stays in the copy
  await call('add_object', { type: 'sphere' });
  const taken = await attempt('save_project_as', { name: 'untitled' });
  check(!taken.ok && /already exists/.test(taken.error), 'save_project_as refuses a name that is taken');
  await call('save_project_as', { name: 'third' });
  await call('undo');
  check((await call('list_projects')).current === 'third', 'undo after save_project_as stays in the new project');
  await call('add_object', { type: 'box' });
  const escape = await attempt('make_icons', { folder: '../../escape' });
  check(!escape.ok && /inside its base folder/.test(escape.error), 'export folders cannot go up and out of exports');
  const fixed = await call('load_scene', { scene: { objects: { a: { type: 'box', parent: 'gone', material: null } }, order: ['a', 'missing'] } });
  const fixedScene = await call('get_scene');
  check(fixed.objects === 1 && fixedScene.objects.a.parent === null && fixedScene.objects.a.material, 'load_scene repairs missing references');
  const badType = await attempt('load_scene', { scene: { objects: { x: { type: '<img src=x>' } } } });
  check(!badType.ok && /unknown type/.test(badType.error), 'load_scene refuses unknown object types');

  // A second engine that treats every caller as "another computer": password needed.
  const SHARE = 7792;
  const shareWs = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-share-'));
  const shared = spawn(process.execPath, ['src/server/index.js', '--no-open'], {
    cwd: ROOT, env: { ...process.env, FORGE_PORT: String(SHARE), FORGE_WORKSPACE: shareWs, FORGE_NO_BACKUP: '1', FORGE_PASSWORD: 'correct-horse-9', FORGE_TRUST_LOCAL: '0' }, stdio: 'ignore',
  });
  try {
    const sb = `http://127.0.0.1:${SHARE}`;
    for (let i = 0; i < 40; i++) { try { await fetch(`${sb}/login`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
    check((await fetch(`${sb}/api/scene`)).status === 401, 'shared engine: API needs the password');
    const page = await fetch(`${sb}/`, { redirect: 'manual' });
    check(page.status === 302 && page.headers.get('location') === '/login', 'shared engine: pages send you to the log-in page');
    const wrong = await fetch(`${sb}/login`, { method: 'POST', body: 'password=nope', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
    check(wrong.status === 401, 'shared engine: wrong password is refused');
    const good = await fetch(`${sb}/login`, { method: 'POST', body: 'password=correct-horse-9', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
    const cookie = good.headers.get('set-cookie')?.split(';')[0];
    check(good.status === 303 && (await fetch(`${sb}/api/scene`, { headers: { Cookie: cookie } })).ok, 'shared engine: log-in gives a session');
    const bearer = { Authorization: 'Bearer correct-horse-9', 'Content-Type': 'application/json' };
    check((await fetch(`${sb}/api/commands/get_scene`, { method: 'POST', headers: bearer, body: '{}' })).ok, 'shared engine: AIs can use the password as a bearer token');
    const fileRead = await fetch(`${sb}/api/commands/import_image`, { method: 'POST', headers: bearer, body: JSON.stringify({ path: 'C:/Windows/win.ini' }) });
    check(fileRead.status === 403, 'shared engine: other computers cannot read files by path');
    const keys = await fetch(`${sb}/api/commands/connect_ai_service`, { method: 'POST', headers: bearer, body: JSON.stringify({ service: 'openai', baseUrl: 'https://evil.example' }) });
    check(keys.status === 403, 'shared engine: other computers cannot change AI service settings');
    const wrapped = await attempt('run_batch', { commands: [{ command: 'connect_ai_service', args: { service: 'openai', baseUrl: 'https://evil.example' } }] }, sb, bearer);
    const wrappedFile = await attempt('run_batch', { commands: [{ command: 'list_versions', args: { project: '../..' } }] }, sb, bearer);
    check(wrapped.status === 403 && wrappedFile.status === 403, 'shared engine: run_batch cannot get around those limits');
    const inside = await attempt('import_image', { url: `${sb}/web/icon-256.png` }, sb, bearer);
    check(inside.status === 403 && /public/.test(inside.error), 'shared engine: other computers cannot make it download from this computer');
    const rawStatus = (headers) => new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port: SHARE, path: '/api/health', headers }, (res) => { res.resume(); resolve(res.statusCode); });
      r.on('error', () => resolve(0));
      r.end();
    });
    check((await rawStatus({ Host: `evil.example:${SHARE}`, Authorization: 'Bearer correct-horse-9' })) === 421, 'shared engine: unknown host names are refused (DNS rebinding)');
    await rawStatus({ Host: `127.0.0.1:${SHARE}`, Origin: 'not a url', Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' });
    check((await rawStatus({ Host: `127.0.0.1:${SHARE}`, Authorization: 'Bearer correct-horse-9' })) === 200, 'shared engine: a broken Origin does not crash it');
    for (let i = 0; i < 5; i++) await rawStatus({ Host: `127.0.0.1:${SHARE}`, Authorization: 'Bearer wrong-guess' });
    check((await rawStatus({ Host: `127.0.0.1:${SHARE}`, Authorization: 'Bearer correct-horse-9' })) === 401, 'shared engine: 5 wrong passwords lock the API for a minute');
  } finally {
    shared.kill();
    await new Promise((r) => setTimeout(r, 500));
    await fs.rm(shareWs, { recursive: true, force: true }).catch(() => {});
  }

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
