import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Small client for the engine's HTTP API, shared by the MCP server and the CLI.
// If the engine is not running yet, it is started in the background.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASE = (process.env.FORGE_URL ?? `http://127.0.0.1:${process.env.FORGE_PORT ?? 7777}`).replace(/\/$/, '');
// for an Asset Forge shared on another computer
const AUTH = process.env.FORGE_PASSWORD ? { Authorization: `Bearer ${process.env.FORGE_PASSWORD}` } : {};

export async function health() {
  try {
    const res = await fetch(`${BASE}/api/health`, { headers: AUTH, signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function ensureEngine({ open = false } = {}) {
  if (await health()) return;
  if (process.env.FORGE_URL) throw new Error(`Asset Forge is not reachable at ${BASE}`);
  const args = [path.join(ROOT, 'src', 'server', 'index.js')];
  if (!open) args.push('--no-open');
  spawn(process.execPath, args, { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await health()) return;
  }
  throw new Error('Asset Forge did not start. Try running "npm start" in the Asset Forge folder to see the error.');
}

export async function listCommands() {
  const res = await fetch(`${BASE}/api/commands`, { headers: AUTH });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

export async function call(name, args = {}, source = 'api') {
  const res = await fetch(`${BASE}/api/commands/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forge-Source': source, ...AUTH },
    body: JSON.stringify(args),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error);
  return body.result;
}
