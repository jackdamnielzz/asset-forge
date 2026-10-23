import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { CommandRegistry, CommandError } from './registry.js';
import { registerBuiltins } from './commands/index.js';
import { DEFAULT_EFFECTS, DEFAULT_STYLE_OPTIONS } from '../shared/presets.js';

const HISTORY_LIMIT = 100;

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
    this.plugins = [];
    this._batchDepth = 0;
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
    this.scene = loaded ?? emptyScene(last);
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

  async execute(name, args = {}, meta = {}) {
    const def = this.registry.commands.get(name);
    const mutates = def?.mutates;
    const before = mutates && this._batchDepth === 0 ? structuredClone(this.scene) : null;
    const result = await this.registry.execute(name, args, { engine: this, scene: this.scene, meta });
    if (before) {
      this.undoStack.push(before);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }
    this.emit('log', { command: name, source: meta.source ?? 'unknown', ok: true, time: Date.now() });
    if (mutates) this.changed();
    return result ?? { ok: true };
  }

  // Run several commands as one undo step.
  async batch(fn) {
    const before = structuredClone(this.scene);
    this._batchDepth++;
    try {
      return await fn();
    } catch (err) {
      this.scene = before;
      this.changed();
      throw err;
    } finally {
      this._batchDepth--;
      if (this._batchDepth === 0) {
        this.undoStack.push(before);
        this.redoStack = [];
      }
    }
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.scene);
    this.scene = this.undoStack.pop();
    this.changed();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.scene);
    this.scene = this.redoStack.pop();
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

  newId(base) {
    const clean = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'object';
    let n = 1;
    while (this.scene.objects[`${clean}_${n}`]) n++;
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
  }

  async saveLibrary() {
    await fs.writeFile(path.join(this.paths.library, 'library.json'), JSON.stringify(this.library, null, 2));
  }

  async loadScene(scene) {
    await this.saveCurrent();
    this.scene = scene;
    this.undoStack = [];
    this.redoStack = [];
    this.changed();
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
