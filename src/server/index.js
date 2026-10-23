import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { Engine } from '../core/engine.js';
import { CommandError } from '../core/registry.js';
import { launchHeadlessRenderer, killStaleRenderer } from './headless.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.FORGE_PORT ?? 7777);
const HOST = process.env.FORGE_HOST ?? '127.0.0.1';
const URL_BASE = `http://127.0.0.1:${PORT}`;
const VERSION = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')).version;

const STATIC = {
  '/web/': path.join(ROOT, 'web'),
  '/shared/': path.join(ROOT, 'src', 'shared'),
  '/vendor/three/': path.join(ROOT, 'node_modules', 'three'),
  '/vendor/three-mesh-bvh/': path.join(ROOT, 'node_modules', 'three-mesh-bvh'),
  '/vendor/three-bvh-csg/': path.join(ROOT, 'node_modules', 'three-bvh-csg'),
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
};

const engine = new Engine({
  workspace: path.resolve(process.env.FORGE_WORKSPACE ?? path.join(ROOT, 'workspace')),
  pluginDirs: [path.join(ROOT, 'plugins')],
});
await engine.init();
const RENDERER_PID = path.join(engine.workspace, '.renderer', `${PORT}.pid`);
await fs.mkdir(path.dirname(RENDERER_PID), { recursive: true });
killStaleRenderer(RENDERER_PID);

// ---- connection to viewers / renderer --------------------------------------

const clients = new Set();
let headless = null;
let headlessStarting = null;
let reqCounter = 0;
const pending = new Map();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === 1) c.ws.send(data);
}

function pickRenderer() {
  const all = [...clients].filter((c) => c.ready);
  return all.find((c) => c.role === 'renderer') ?? null;
}

async function ensureRenderer() {
  const existing = pickRenderer();
  if (existing) return existing;
  if (!headlessStarting) {
    headlessStarting = (async () => {
      headless?.close().catch(() => {});
      headless = await launchHeadlessRenderer(`${URL_BASE}/?role=renderer`, path.join(engine.workspace, '.renderer', String(PORT)), RENDERER_PID);
      headless.on('disconnected', () => { headless = null; });
      for (let i = 0; i < 200; i++) {
        if (pickRenderer()) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Background renderer did not start in time.');
    })().finally(() => { headlessStarting = null; });
  }
  try {
    await headlessStarting;
    return pickRenderer();
  } catch (err) {
    // Fall back to an open window if the hidden browser cannot start.
    const viewer = [...clients].find((c) => c.ready);
    if (viewer) return viewer;
    throw new CommandError(`Rendering needs a browser: ${err.message}`);
  }
}

engine.bridge = {
  async request(kind, opts) {
    const client = await ensureRenderer();
    const reqId = ++reqCounter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(reqId); reject(new CommandError(`${kind} timed out`)); }, 90_000);
      pending.set(reqId, { resolve, reject, timer });
      client.ws.send(JSON.stringify({ type: 'request', reqId, kind, opts, scene: engine.scene }));
    });
  },
};

engine.on('change', (scene) => broadcast({ type: 'scene', scene }));
engine.on('library', (library) => broadcast({ type: 'library', library }));
engine.on('log', (entry) => broadcast({ type: 'log', entry }));

// Commands that only make sense when a server exists.
engine.registry.define({
  name: 'open_window',
  title: 'Open window',
  category: 'help',
  description: 'Open the Asset Forge window in the default web browser so the user can watch live.',
  handler() {
    openInBrowser(URL_BASE);
    return { url: URL_BASE };
  },
});

// ---- HTTP -------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, URL_BASE);
    const p = decodeURIComponent(url.pathname);

    if (p === '/api/health') return json(res, 200, { ok: true, app: 'asset-forge', version: VERSION, project: engine.scene.name });
    if (p === '/api/commands' && req.method === 'GET') return json(res, 200, engine.registry.list());
    if (p === '/api/scene') return json(res, 200, engine.scene);
    if (p === '/api/library') return json(res, 200, engine.library);
    if (p.startsWith('/api/commands/') && req.method === 'POST') {
      const name = p.slice('/api/commands/'.length);
      const body = await readBody(req);
      let args;
      try { args = body.length ? JSON.parse(body) : {}; } catch { return json(res, 400, { ok: false, error: 'Body must be JSON' }); }
      try {
        const result = await engine.execute(name, args, { source: req.headers['x-forge-source'] ?? 'http' });
        if (url.searchParams.get('format') === 'png' && result?.image) {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          return res.end(Buffer.from(result.image, 'base64'));
        }
        return json(res, 200, { ok: true, result });
      } catch (err) {
        const known = err instanceof CommandError;
        if (!known) console.error(err);
        engine.emit('log', { command: name, source: req.headers['x-forge-source'] ?? 'http', ok: false, error: err.message, time: Date.now() });
        return json(res, known ? 400 : 500, { ok: false, error: err.message });
      }
    }

    if (p === '/' || p === '/index.html') return sendFile(res, path.join(ROOT, 'web', 'index.html'));
    if (p.startsWith('/library/images/')) return sendFile(res, safeJoin(engine.paths.images, p.slice('/library/images/'.length)));
    if (p.startsWith('/exports/')) return sendFile(res, safeJoin(engine.paths.exports, p.slice('/exports/'.length)));
    for (const [prefix, dir] of Object.entries(STATIC)) {
      if (p.startsWith(prefix)) return sendFile(res, safeJoin(dir, p.slice(prefix.length)));
    }
    json(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    console.error(err);
    json(res, 500, { ok: false, error: err.message });
  }
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const client = { ws, role: 'viewer', ready: false };
  clients.add(client);
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'hello') {
      client.role = msg.role === 'renderer' ? 'renderer' : 'viewer';
      client.ready = true;
      ws.send(JSON.stringify({ type: 'hello', scene: engine.scene, library: engine.library, plugins: engine.plugins, version: VERSION }));
    } else if (msg.type === 'response') {
      const p = pending.get(msg.reqId);
      if (!p) return;
      pending.delete(msg.reqId);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new CommandError(msg.error));
    }
  });
  ws.on('close', () => clients.delete(client));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use: Asset Forge is probably already running at ${URL_BASE}`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`Asset Forge ${VERSION} running at ${URL_BASE}`);
  console.log(`Project: ${engine.scene.name} | workspace: ${engine.workspace}`);
  if (engine.plugins.length) console.log(`Plugins: ${engine.plugins.map((p) => p.name).join(', ')}`);
  if (!process.argv.includes('--no-open') && !process.env.FORGE_NO_OPEN) openInBrowser(URL_BASE);
});

async function shutdown() {
  await engine.saveCurrent().catch(() => {});
  await headless?.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---- helpers ----------------------------------------------------------------

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeJoin(dir, rel) {
  const full = path.resolve(dir, rel);
  return full.startsWith(path.resolve(dir) + path.sep) ? full : null;
}

async function sendFile(res, file) {
  if (!file) return json(res, 403, { ok: false, error: 'Forbidden' });
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    json(res, 404, { ok: false, error: 'Not found' });
  }
}

function openInBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}
