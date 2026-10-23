// Writes the API documentation into the repository (docs/API.md, docs/openapi.json, llms.txt)
// by starting a private engine and asking it, so the files match the software exactly.
// Run with: npm run docs
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7794;
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-docs-'));
const engine = spawn(process.execPath, ['src/server/index.js', '--no-open'], {
  cwd: ROOT, env: { ...process.env, FORGE_PORT: String(PORT), FORGE_WORKSPACE: workspace, FORGE_NO_BACKUP: '1' }, stdio: 'ignore',
});
try {
  const base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  await fs.mkdir(path.join(ROOT, 'docs'), { recursive: true });
  const files = { 'docs/API.md': '/docs/api.md', 'docs/openapi.json': '/api/openapi.json', 'llms.txt': '/llms.txt' };
  for (const [file, route] of Object.entries(files)) {
    let body = await (await fetch(`${base}${route}`)).text();
    if (file.endsWith('.json')) body = JSON.stringify(JSON.parse(body), null, 2);
    // links in the files point at the running engine; in the repository point at the files instead
    if (file === 'llms.txt') body = body.replace('(/api/openapi.json)', '(docs/openapi.json)').replace('(/docs/api.md)', '(docs/API.md)');
    await fs.writeFile(path.join(ROOT, file), body);
    console.log(`wrote ${file} (${Math.round(body.length / 1024)} KB)`);
  }
} finally {
  engine.kill();
  await new Promise((r) => setTimeout(r, 500));
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
}
