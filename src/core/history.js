import fs from 'node:fs/promises';
import path from 'node:path';

// Version history per project and whole-workspace backups.
// - A version is a copy of the project file. One is made automatically at most every few
//   minutes while working, and always before big changes (clearing, loading, restoring).
// - A backup is a dated copy of the whole workspace (projects, library, history), made
//   automatically once a day when the engine starts, and on request.
const AUTO_EVERY_MS = 3 * 60_000;
const KEEP_AUTO = 60;
const KEEP_BACKUPS = 7;

export class History {
  constructor(workspace) {
    this.workspace = workspace;
    this.root = path.join(workspace, 'history');
    this.backups = path.join(path.dirname(workspace), `${path.basename(workspace)}-backups`);
    this.lastAuto = new Map();
  }

  dir(project) {
    return path.join(this.root, project);
  }

  // kind: 'auto' (timed), 'safety' (before a big change) or 'checkpoint' (by hand)
  async save(scene, kind = 'auto', note = '') {
    if (kind === 'auto') {
      const last = this.lastAuto.get(scene.name) ?? 0;
      if (Date.now() - last < AUTO_EVERY_MS) return null;
    }
    if (kind !== 'checkpoint' && !scene.order?.length) return null; // nothing worth keeping
    this.lastAuto.set(scene.name, Date.now());
    const d = this.dir(scene.name);
    await fs.mkdir(d, { recursive: true });
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}_${kind}`;
    await fs.writeFile(path.join(d, `${id}.forge.json`), JSON.stringify({ ...scene, _version: { kind, note, objects: scene.order.length, time: new Date().toISOString() } }));
    await this.prune(scene.name);
    return id;
  }

  async list(project) {
    let files = [];
    try { files = (await fs.readdir(this.dir(project))).filter((f) => f.endsWith('.forge.json')); } catch {}
    const out = [];
    for (const f of files.sort().reverse()) {
      const id = f.replace(/\.forge\.json$/, '');
      let meta = {};
      try { meta = JSON.parse(await fs.readFile(path.join(this.dir(project), f), 'utf8'))._version ?? {}; } catch {}
      out.push({ id, kind: meta.kind ?? id.split('_').pop(), note: meta.note ?? '', objects: meta.objects ?? null, time: meta.time ?? null });
    }
    return out;
  }

  async read(project, id) {
    const file = path.join(this.dir(project), `${path.basename(id)}.forge.json`);
    const scene = JSON.parse(await fs.readFile(file, 'utf8'));
    delete scene._version;
    return scene;
  }

  // keep every checkpoint, and the newest automatic/safety versions
  async prune(project) {
    const versions = await this.list(project);
    const auto = versions.filter((v) => v.kind !== 'checkpoint');
    for (const v of auto.slice(KEEP_AUTO)) await fs.rm(path.join(this.dir(project), `${v.id}.forge.json`), { force: true });
  }

  // Copy projects, library and history to <workspace>-backups/<date>.
  async backup(target) {
    const base = target ?? this.backups;
    const dest = path.join(base, new Date().toISOString().replace(/[:.]/g, '-'));
    await fs.mkdir(dest, { recursive: true });
    for (const part of ['projects', 'library', 'history']) {
      const src = path.join(this.workspace, part);
      try { await fs.cp(src, path.join(dest, part), { recursive: true }); } catch {}
    }
    if (!target) {
      const all = (await fs.readdir(base)).sort();
      for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) await fs.rm(path.join(base, old), { recursive: true, force: true });
    }
    return dest;
  }

  async lastBackupAge() {
    try {
      const all = (await fs.readdir(this.backups)).sort();
      if (!all.length) return Infinity;
      return Date.now() - (await fs.stat(path.join(this.backups, all[all.length - 1]))).mtimeMs;
    } catch { return Infinity; }
  }
}
