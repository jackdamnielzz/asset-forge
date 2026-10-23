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
