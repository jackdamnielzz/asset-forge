// Real Godot test: exports assets into a temporary Godot project, lets Godot import them and
// runs test/godot/check.gd inside Godot. Needs Godot 4 (set GODOT to its console executable
// if it is not found automatically).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7793;
const godot = [
  process.env.GODOT,
  'C:/tools/Godot_v4.6.2-stable_win64.exe/Godot_v4.6.2-stable_win64_console.exe',
  'C:/Program Files/Godot/godot.exe',
  '/usr/bin/godot', '/usr/local/bin/godot', '/Applications/Godot.app/Contents/MacOS/Godot',
].find((p) => p && existsSync(p));
if (!godot) {
  console.log('Godot not found; set GODOT to the Godot 4 (console) executable. Skipping.');
  process.exit(0);
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-godot-'));
const workspace = path.join(tmp, 'workspace');
const project = path.join(tmp, 'project');
await fs.mkdir(project, { recursive: true });
await fs.writeFile(path.join(project, 'project.godot'), 'config_version=5\n\n[application]\n\nconfig/name="Forge Import Test"\n\n[rendering]\n\nrenderer/rendering_method="gl_compatibility"\n');
await fs.copyFile(path.join(ROOT, 'test', 'godot', 'check.gd'), path.join(project, 'check.gd'));

const engine = spawn(process.execPath, ['src/server/index.js', '--no-open'], { cwd: ROOT, env: { ...process.env, FORGE_PORT: String(PORT), FORGE_WORKSPACE: workspace, FORGE_NO_BACKUP: '1' }, stdio: 'ignore' });
const call = async (name, args = {}) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/commands/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }).then((x) => x.json());
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.result;
};

let code = 1;
try {
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/health`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const chest = await call('make_chest', { seed: 2 });
  const lid = Object.values((await call('get_scene')).objects).find((o) => o.parent === chest.id && o.name === 'lid');
  await call('animate_object', { id: lid.id, preset: 'hinge', animation: 'open', duration: 2 });
  await call('export_godot', { project, target: chest.id, collision: 'convex' });
  await call('clear_scene');
  const kit = await call('make_level_kit', { style: 'dungeon' });
  await call('export_each', { group: kit.id, project, collision: 'mesh', folder: 'assets/forge/kit' });
  await call('clear_scene');
  const hero = await call('make_character', { weapon: 'sword' });
  await call('render_sprites', { target: hero.id, filename: 'hero', animations: ['idle', 'walk'], frames: 4, frameSize: 32, directions: 4, maps: ['normal'], project });
  await call('make_tileset', { filename: 'grass_dirt', tileSize: 16, project });
  await call('make_effect', { type: 'fire', size: 32, project });

  console.log(`Godot: ${godot}`);
  execFileSync(godot, ['--headless', '--path', project, '--import'], { stdio: 'ignore', timeout: 300_000 });
  const out = execFileSync(godot, ['--headless', '--path', project, '--script', 'res://check.gd'], { encoding: 'utf8', timeout: 120_000 });
  console.log(out.split('\n').filter((l) => /^(OK|FAIL|RESULT)/.test(l)).join('\n'));
  code = /RESULT: 0 problem/.test(out) ? 0 : 1;
} catch (err) {
  console.error(err.stdout?.toString() ?? '', err.message);
} finally {
  engine.kill();
  try { process.kill(Number(await fs.readFile(path.join(workspace, '.renderer', `${PORT}.pid`), 'utf8'))); } catch {}
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
}
