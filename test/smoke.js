// End-to-end smoke test: starts a private engine, drives it through the HTTP API
// like an AI would, and checks that rendering and exporting really work.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7790;
const BASE = `http://127.0.0.1:${PORT}`;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-test-'));

const proc = spawn(process.execPath, ['src/server/index.js', '--no-open'], {
  cwd: ROOT, env: { ...process.env, FORGE_PORT: String(PORT), FORGE_WORKSPACE: workspace }, stdio: ['ignore', 'inherit', 'inherit'],
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
  await fs.copyFile(sprites.path, path.join(ROOT, 'test', 'last-sprites.png'));
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
