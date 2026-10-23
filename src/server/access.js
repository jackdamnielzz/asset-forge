import crypto from 'node:crypto';
import os from 'node:os';

// Who may use the engine.
// - This computer may always, but only from Asset Forge's own pages or from tools that are not
//   web pages: requests that a website in the browser makes (they carry a foreign Origin) are refused,
//   and so are requests for a different host name (DNS rebinding).
// - Other computers only when sharing is switched on, and only with the password. They cannot
//   touch files on this computer by path, nor change AI service settings.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FILE_ARGS = ['path', 'project', 'to'];
const LOCAL_ONLY_COMMANDS = new Set(['connect_ai_service', 'open_window']);

export function createAccess({ port, host, password, trustLocal = true }) {
  const sharing = !LOOPBACK.has(host) && host !== 'localhost';
  if (sharing && (!password || password.length < 8)) {
    throw new Error('Sharing on the network needs a password of at least 8 characters (set FORGE_PASSWORD).');
  }
  const sessions = new Map(); // token -> expiry
  const failures = new Map(); // ip -> { count, until }
  const localNames = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

  const isLocal = (req) => trustLocal && LOOPBACK.has(req.socket.remoteAddress);
  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    return !origin || origin === 'null' ? !origin : new URL(origin).host === req.headers.host;
  };
  const hostAllowed = (req) => sharing || localNames.has(String(req.headers.host).toLowerCase());
  const tokenOf = (req) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return { bearer: auth.slice(7) };
    const m = /(?:^|;\s*)forge_session=([a-f0-9]{64})/.exec(req.headers.cookie ?? '');
    return { session: m?.[1] };
  };
  const passwordOk = (given) => {
    if (!password || typeof given !== 'string') return false;
    const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(password).digest();
    return crypto.timingSafeEqual(a, b);
  };
  const authed = (req) => {
    if (isLocal(req)) return true;
    const t = tokenOf(req);
    if (t.bearer) return passwordOk(t.bearer);
    const exp = t.session && sessions.get(t.session);
    return !!exp && exp > Date.now();
  };

  return {
    sharing,
    // Decide about an HTTP request or WebSocket upgrade: null = allowed, otherwise [status, message].
    check(req, { page = false } = {}) {
      if (!hostAllowed(req)) return [421, 'Unknown host name'];
      if (!sameOrigin(req)) return [403, 'Requests from other websites are not allowed'];
      if (!authed(req)) return page ? [302, '/login'] : [401, 'Password needed: open this address in a browser and log in, or send Authorization: Bearer <password>'];
      return null;
    },
    // Extra limits for commands from other computers.
    commandAllowed(req, name, args) {
      if (isLocal(req)) return null;
      if (LOCAL_ONLY_COMMANDS.has(name)) return `"${name}" only works on the computer running Asset Forge.`;
      if (args && FILE_ARGS.some((k) => k in args)) return 'Working with files by path only works on the computer running Asset Forge; send data or url instead.';
      return null;
    },
    async login(req, given) {
      const ip = req.socket.remoteAddress;
      const f = failures.get(ip);
      if (f && f.until > Date.now()) return { error: 'Too many wrong passwords; wait a minute.' };
      if (!passwordOk(given)) {
        const count = (f?.count ?? 0) + 1;
        failures.set(ip, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
        await new Promise((r) => setTimeout(r, 600));
        return { error: 'Wrong password.' };
      }
      failures.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + 7 * 24 * 3600_000);
      return { token };
    },
    addresses() {
      if (!sharing) return [];
      return Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => `http://${n.address}:${port}`);
    },
  };
}

export const LOGIN_PAGE = (error = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Asset Forge · log in</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16181d;color:#e6e8ec;font:14px "Segoe UI",system-ui,sans-serif}
form{background:#1e2128;border:1px solid #323743;border-radius:12px;padding:28px;width:min(320px,86vw);display:flex;flex-direction:column;gap:12px}
h1{font-size:18px;margin:0}h1 span{color:#ff8a3d}input,button{font:inherit;padding:9px 11px;border-radius:7px;border:1px solid #323743;background:#16181d;color:inherit}
button{background:#ff8a3d;border-color:#ff8a3d;color:#1b1206;font-weight:600;cursor:pointer}.err{color:#ff8a8a;margin:0}</style></head>
<body><form method="post" action="/login"><h1><span>◆</span> Asset Forge</h1><p style="margin:0;color:#9198a5">This Asset Forge is shared. Enter the password.</p>
${error ? `<p class="err">${error.replace(/[<>&]/g, '')}</p>` : ''}<input type="password" name="password" autofocus autocomplete="current-password" placeholder="Password">
<button>Log in</button></form></body></html>`;
