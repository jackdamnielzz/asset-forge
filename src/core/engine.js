import { EventEmitter } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { CommandRegistry, CommandError, AccessError } from './registry.js';
import { registerBuiltins } from './commands/index.js';
import { DEFAULT_EFFECTS, DEFAULT_STYLE_OPTIONS } from '../shared/presets.js';
import { Providers } from './providers.js';
import { History } from './history.js';

const HISTORY_LIMIT = 100;
const actionContext = new AsyncLocalStorage();

export function emptyScene(name = 'untitled') {
  return {
    version: 1,
    name,
    objects: {},
    order: [],
    environment: {
      lighting: 'studio', exposure: 1, background: null, ground: true, groundColor: null,
      style: 'realistic', styleOptions: { ...DEFAULT_STYLE_OPTIONS }, effects: { ...DEFAULT_EFFECTS },
    },
    camera: { position: [3.2, 2.4, 4.2], target: [0, 0.5, 0] },
    animations: {},
  };
}

// The engine owns the scene, its history and the workspace on disk.
// It never draws anything itself: drawing (render/export) is delegated to a
// connected viewer through `bridge`, which the server provides.
export class Engine extends EventEmitter {
  constructor({ workspace, pluginDirs = [] }) {
    super();
    this.workspace = workspace;
    this.paths = {
      projects: path.join(workspace, 'projects'),
      library: path.join(workspace, 'library'),
      images: path.join(workspace, 'library', 'images'),
      exports: path.join(workspace, 'exports'),
    };
    this.pluginDirs = pluginDirs;
    this.registry = new CommandRegistry();
    this.scene = emptyScene();
    this.undoStack = [];
    this.redoStack = [];
    this.library = { images: {} };
    this.bridge = null;
    this.providers = new Providers(workspace);
    this.history = new History(workspace);
    this.plugins = [];
    this._queue = Promise.resolve();
    this._saveTimer = null;
  }

  async init() {
    for (const p of Object.values(this.paths)) await fs.mkdir(p, { recursive: true });
    this.library = (await readJson(path.join(this.paths.library, 'library.json'))) ?? { images: {} };
    registerBuiltins(this.registry, { z, engine: this });
    await this.loadPlugins();
    const state = await readJson(path.join(this.workspace, 'state.json'));
    const last = state?.current ?? 'untitled';
    const loaded = await readJson(this.projectFile(last));
    // the file name decides where it saves, even if the name inside the file differs (a copied file)
    this.scene = loaded ? { ...loaded, name: safeName(last) } : emptyScene(last);
    // a dated copy of everything once a day (skipped for throwaway test workspaces)
    if (!process.env.FORGE_NO_BACKUP && (await this.history.lastBackupAge()) > 24 * 3600_000) {
      this.history.backup().catch((err) => console.error(`[backup] ${err.message}`));
    }
  }

  async loadPlugins() {
    for (const dir of this.pluginDirs) {
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries.filter((d) => d.isDirectory())) {
        const entry = path.join(dir, e.name, 'index.js');
        try {
          const mod = await import(pathToFileURL(entry).href);
          await mod.default({ registry: this.registry, z, engine: this });
          this.plugins.push({ name: e.name, description: mod.description ?? '' });
        } catch (err) {
          console.error(`[plugins] failed to load ${e.name}: ${err.message}`);
        }
      }
    }
  }

  // ---- commands -----------------------------------------------------------

  // Every user-level action becomes exactly one undo step: the outermost command or
  // batch takes the snapshot, anything it runs inside is part of that same step.
  async execute(name, args = {}, meta = {}) {
    // Callers from other computers are checked here, so commands run inside run_batch or a
    // generator are checked too. `guard` is set by the server.
    if (meta.remote && this.guard) {
      const denied = await this.guard(name, args ?? {});
      if (denied) throw new AccessError(denied);
    }
    const def = this.registry.commands.get(name);
    const mutates = def?.mutates;
    const result = mutates
      ? await this.recorded(() => this.registry.execute(name, args, { engine: this, scene: this.scene, meta }))
      : await this.registry.execute(name, args, { engine: this, scene: this.scene, meta });
    // Generators leave a recipe on the object they build, so it can be re-made with changes later.
    if (def?.category === 'generators' && result?.id && this.scene.objects[result.id]) {
      const { position, rotation, name: _n, ...rest } = args;
      this.scene.objects[result.id].recipe = { command: name, args: rest };
      this.changed(); // the generator already announced its object; announce it again with its recipe
    }
    this.emit('log', { command: name, source: meta.source ?? 'unknown', ok: true, time: Date.now() });
    if (mutates) this.changed();
    return result ?? { ok: true };
  }

  // Run several commands as one undo step; if anything fails, everything is rolled back.
  async batch(fn) {
    return this.recorded(fn);
  }

  // Changes from different callers (the window and an AI at the same time) run one after
  // another; AsyncLocalStorage tells a nested call apart from a concurrent one.
  async recorded(fn) {
    if (actionContext.getStore()) return fn();
    return this.exclusive(async () => {
      const before = structuredClone(this.scene);
      try {
        const result = await fn();
        // a step that switched project (e.g. open_project inside a batch) starts a fresh history
        if (before.name === this.scene.name) {
          this.undoStack.push(before);
          if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
          this.redoStack = [];
        }
        return result;
      } catch (err) {
        this.scene = before;
        this.changed();
        throw err;
      }
    });
  }

  // Run fn when no other change is running (undo, redo and project switches wait their turn too).
  async exclusive(fn) {
    if (actionContext.getStore()) return fn();
    const run = () => actionContext.run(true, fn);
    const next = this._queue.then(run, run);
    this._queue = next.catch(() => {});
    return next;
  }

  undo() {
    return this.exclusive(() => this.step(this.undoStack, this.redoStack));
  }

  redo() {
    return this.exclusive(() => this.step(this.redoStack, this.undoStack));
  }

  step(from, to) {
    if (!from.length) return false;
    to.push(this.scene);
    const name = this.scene.name;
    // snapshots from before "save project as" still carry the old name; stay in this project
    this.scene = { ...from.pop(), name };
    this.changed();
    return true;
  }

  changed() {
    this.emit('change', this.scene);
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveCurrent().catch((e) => console.error(e)), 400);
  }

  // ---- scene helpers ------------------------------------------------------

  getObject(id) {
    const obj = this.scene.objects[id];
    if (!obj) throw new CommandError(`No object with id "${id}". Call get_scene to see object ids.`);
    return obj;
  }

  // `reserved` is for handing out several ids before the objects are added (each id is added to it).
  newId(base, reserved = null) {
    const clean = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'object';
    let n = 1;
    while (this.scene.objects[`${clean}_${n}`] || reserved?.has(`${clean}_${n}`)) n++;
    reserved?.add(`${clean}_${n}`);
    return `${clean}_${n}`;
  }

  childrenOf(id) {
    return this.scene.order.filter((oid) => this.scene.objects[oid].parent === id);
  }

  // ---- persistence --------------------------------------------------------

  projectFile(name) {
    return path.join(this.paths.projects, `${safeName(name)}.forge.json`);
  }

  async saveCurrent() {
    clearTimeout(this._saveTimer);
    await fs.writeFile(this.projectFile(this.scene.name), JSON.stringify(this.scene, null, 2));
    await fs.writeFile(path.join(this.workspace, 'state.json'), JSON.stringify({ current: this.scene.name }));
    await this.history.save(this.scene, 'auto');
  }

  async saveLibrary() {
    await fs.writeFile(path.join(this.paths.library, 'library.json'), JSON.stringify(this.library, null, 2));
  }

  loadScene(scene) {
    return this.exclusive(async () => {
      await this.saveCurrent();
      await this.history.save(this.scene, 'safety', 'before switching or loading');
      this.scene = scene;
      this.undoStack = [];
      this.redoStack = [];
      await this.saveCurrent();
      this.changed();
    });
  }

  async render(opts) {
    if (!this.bridge) throw new CommandError('No renderer available.');
    return this.bridge.request('render', opts);
  }

  async exportGlb(opts) {
    if (!this.bridge) throw new CommandError('No renderer available.');
    return this.bridge.request('export_glb', opts);
  }
}

export function safeName(name) {
  const s = String(name).trim().replace(/[^a-zA-Z0-9 _.-]+/g, '').replace(/\s+/g, '-');
  if (!s) throw new CommandError('Name must contain letters or numbers.');
  return s;
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}
