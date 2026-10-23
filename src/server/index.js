import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { Engine } from '../core/engine.js';
import { CommandError, AccessError } from '../core/registry.js';
import { launchHeadlessRenderer, killStaleRenderer } from './headless.js';
import { createAccess, commandLimit, LOGIN_PAGE } from './access.js';
import * as docs from '../core/docs.js';

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
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

let access;
try {
  access = createAccess({ port: PORT, host: HOST, password: process.env.FORGE_PASSWORD, trustLocal: process.env.FORGE_TRUST_LOCAL !== '0' });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const engine = new Engine({
  workspace: path.resolve(process.env.FORGE_WORKSPACE ?? path.join(ROOT, 'workspace')),
  pluginDirs: [path.join(ROOT, 'plugins')],
});
await engine.init();
engine.guard = commandLimit;
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
    if (!client) throw new CommandError('The renderer went away while starting; try again.');
    const reqId = ++reqCounter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(reqId); reject(new CommandError(`${kind} timed out`)); }, 90_000);
      pending.set(reqId, { resolve, reject, timer, client });
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

    // log-in page for other computers when sharing is on
    if (p === '/login') {
      const denied = access.check(req);
      if (denied && denied[0] !== 401) return json(res, denied[0], { ok: false, error: denied[1] });
      if (req.method === 'POST') {
        const form = new URLSearchParams(await readBody(req));
        const r = await access.login(req, form.get('password'));
        if (r.error) return html(res, 401, LOGIN_PAGE(r.error));
        res.writeHead(303, { Location: '/', 'Set-Cookie': `forge_session=${r.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800` });
        return res.end();
      }
      return html(res, 200, LOGIN_PAGE());
    }
    const isPage = req.method === 'GET' && !p.startsWith('/api/');
    const denied = access.check(req, { page: isPage });
    if (denied) {
      if (denied[0] === 302) { res.writeHead(302, { Location: denied[1] }); return res.end(); }
      return json(res, denied[0], { ok: false, error: denied[1] });
    }

    if (p === '/api/health') return json(res, 200, { ok: true, app: 'asset-forge', version: VERSION, project: engine.scene.name });
    if (p === '/api/access') return json(res, 200, { sharing: access.sharing, addresses: access.addresses() });
    // documentation, generated from the live command list
    if (p === '/api/openapi.json') return json(res, 200, docs.openapi(engine.registry.list(), { version: VERSION }));
    if (p === '/llms.txt') return text(res, docs.llmsTxt(engine.registry.list(), { version: VERSION }), 'text/plain; charset=utf-8');
    if (p === '/docs/api.md') return text(res, docs.markdown(engine.registry.list(), { version: VERSION }), 'text/markdown; charset=utf-8');
    if (p === '/docs' || p === '/docs/') return html(res, 200, docs.html(engine.registry.list(), { version: VERSION }));
    if (p === '/api/commands' && req.method === 'GET') return json(res, 200, engine.registry.list());
    if (p === '/api/scene') return json(res, 200, engine.scene);
    if (p === '/api/library') return json(res, 200, engine.library);
    if (p.startsWith('/api/commands/') && req.method === 'POST') {
      const name = p.slice('/api/commands/'.length);
      const body = await readBody(req);
      let args;
      try { args = body.length ? JSON.parse(body) : {}; } catch { return json(res, 400, { ok: false, error: 'Body must be JSON' }); }
      try {
        const result = await engine.execute(name, args, { source: req.headers['x-forge-source'] ?? 'http', remote: access.isRemote(req) });
        if (url.searchParams.get('format') === 'png' && result?.image) {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          return res.end(Buffer.from(result.image, 'base64'));
        }
        return json(res, 200, { ok: true, result });
      } catch (err) {
        const known = err instanceof CommandError;
        if (!known) console.error(err);
        engine.emit('log', { command: name, source: req.headers['x-forge-source'] ?? 'http', ok: false, error: err.message, time: Date.now() });
        return json(res, err instanceof AccessError ? 403 : known ? 400 : 500, { ok: false, error: err.message });
      }
    }

    if (p === '/' || p === '/index.html') return sendFile(res, path.join(ROOT, 'web', 'index.html'));
    if (p.startsWith('/library/images/')) {
      // an image can also be asked for by its id (the window may know the id before the library update arrives)
      const rel = p.slice('/library/images/'.length);
      return sendFile(res, safeJoin(engine.paths.images, Object.hasOwn(engine.library.images, rel) ? engine.library.images[rel].file : rel));
    }
    if (p.startsWith('/library/models/')) return sendFile(res, safeJoin(path.join(engine.paths.library, 'models'), p.slice('/library/models/'.length)));
    if (p.startsWith('/library/thumbs/')) return sendFile(res, safeJoin(path.join(engine.paths.library, 'thumbs'), p.slice('/library/thumbs/'.length)));
    if (p.startsWith('/library/videos/')) return sendFile(res, safeJoin(path.join(engine.paths.library, 'videos'), p.slice('/library/videos/'.length)));
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

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  let denied;
  try {
    denied = new URL(req.url, URL_BASE).pathname !== '/ws' ? [404, 'Not found'] : access.check(req);
  } catch {
    denied = [400, 'Bad request'];
  }
  if (denied) {
    socket.end(`HTTP/1.1 ${denied[0] === 302 ? 401 : denied[0]} Denied\r\nConnection: close\r\n\r\n`);
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
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
      if (!p || p.client !== client) return;
      pending.delete(msg.reqId);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new CommandError(msg.error));
    }
  });
  ws.on('close', () => {
    clients.delete(client);
    // requests this renderer was still working on will never be answered
    for (const [reqId, p] of pending) {
      if (p.client !== client) continue;
      pending.delete(reqId);
      clearTimeout(p.timer);
      p.reject(new CommandError('The renderer closed before finishing; try again.'));
    }
  });
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
  if (access.sharing) console.log(`Shared on the network (password required) at: ${access.addresses().join(', ') || `port ${PORT}`}`);
  if (!process.argv.includes('--no-open') && !process.env.FORGE_NO_OPEN) openInBrowser(URL_BASE);
});

// --idle-exit=N: stop by itself after N minutes without an open window or API calls
// (the desktop shortcut starts the engine invisibly, so it should not run forever).
let lastActivity = Date.now();
server.on('request', () => { lastActivity = Date.now(); });
const idleArg = process.argv.find((a) => a.startsWith('--idle-exit='));
if (idleArg) {
  const minutes = Number(idleArg.split('=')[1]) || 10;
  setInterval(() => {
    const viewers = [...clients].some((c) => c.role === 'viewer');
    if (viewers) lastActivity = Date.now();
    else if (Date.now() - lastActivity > minutes * 60_000) {
      console.log(`No window open for ${minutes} minutes; stopping.`);
      shutdown();
    }
  }, 30_000).unref();
}

async function shutdown() {
  await engine.saveCurrent().catch(() => {});
  await headless?.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---- helpers ----------------------------------------------------------------

function text(res, body, type) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

function html(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

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
