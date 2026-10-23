import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

// A hidden browser that runs the viewer in "renderer" mode, so pictures and
// exports work even when nobody has the window open.
const CANDIDATES = [
  process.env.FORGE_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
].filter(Boolean);

export function findBrowser() {
  return CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

// If the server was killed hard last time, its hidden browser may still be running.
// Stop it, but only after checking the PID really belongs to a Chrome/Edge process.
export function killStaleRenderer(pidFile) {
  let pid;
  try { pid = Number(fs.readFileSync(pidFile, 'utf8')); } catch { return; }
  fs.rmSync(pidFile, { force: true });
  if (!pid) return;
  try {
    const name = process.platform === 'win32'
      ? execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
      : execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
    if (/chrome|msedge|edge|chromium/i.test(name)) process.kill(pid);
  } catch {}
}

// We start the browser ourselves and then attach to it: puppeteer's own launcher
// fails with some Edge versions, while this works for both Chrome and Edge.
export async function launchHeadlessRenderer(url, profileDir, pidFile) {
  const executablePath = findBrowser();
  if (!executablePath) throw new Error('No Chrome or Edge found for background rendering. Set FORGE_BROWSER to a browser path.');
  const dir = path.resolve(profileDir);
  fs.mkdirSync(dir, { recursive: true });
  const portFile = path.join(dir, 'DevToolsActivePort');
  fs.rmSync(portFile, { force: true });

  const proc = spawn(executablePath, [
    '--headless', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  if (pidFile) fs.writeFileSync(pidFile, String(proc.pid));

  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]); } catch {}
  }
  if (!port) {
    proc.kill();
    throw new Error(`Browser did not start (${executablePath})`);
  }

  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
  browser.on('disconnected', () => proc.kill());
  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') console.error(`[renderer] ${msg.text()}`); });
  page.on('pageerror', (err) => console.error(`[renderer] ${err.message}`));
  await page.goto(url, { waitUntil: 'load' });
  return browser;
}
