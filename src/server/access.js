import crypto from 'node:crypto';
import os from 'node:os';
import net from 'node:net';
import dns from 'node:dns/promises';

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
  const hostName = (req) => String(req.headers.host).toLowerCase();
  // When sharing, other computers reach us by this computer's addresses or name; any other
  // host name is a website pointing its own name at us (DNS rebinding).
  const sharedNames = () => new Set([
    ...addressList().map((a) => `${a}:${port}`),
    `${os.hostname().toLowerCase()}:${port}`, `${os.hostname().toLowerCase()}.local:${port}`,
  ]);

  // "This computer" means a loopback connection that also used a local host name.
  const isLocal = (req) => trustLocal && LOOPBACK.has(req.socket.remoteAddress) && localNames.has(hostName(req));
  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (!origin || origin === 'null') return !origin;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  };
  const hostAllowed = (req) => localNames.has(hostName(req)) || (sharing && sharedNames().has(hostName(req)));
  const lockedOut = (ip) => (failures.get(ip)?.until ?? 0) > Date.now();
  const failed = (ip) => {
    const count = (failures.get(ip)?.count ?? 0) + 1;
    failures.set(ip, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
  };
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
    if (t.bearer) {
      // the same limit as the log-in page: 5 wrong passwords lock this address for a minute
      const ip = req.socket.remoteAddress;
      if (lockedOut(ip)) return false;
      if (passwordOk(t.bearer)) { failures.delete(ip); return true; }
      failed(ip);
      return false;
    }
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
    // Callers that get the extra limits of commandLimit (the engine checks every command they run).
    isRemote: (req) => !isLocal(req),
    async login(req, given) {
      const ip = req.socket.remoteAddress;
      if (lockedOut(ip)) return { error: 'Too many wrong passwords; wait a minute.' };
      if (!passwordOk(given)) {
        failed(ip);
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
      return addressList().map((a) => `http://${a}:${port}`);
    },
  };
}

function addressList() {
  return Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
}

// Extra limits for commands from other computers: null = allowed, otherwise the reason.
// They cannot touch files by path, change AI settings, or make us download from this
// computer or its local network.
export async function commandLimit(name, args) {
  if (LOCAL_ONLY_COMMANDS.has(name)) return `"${name}" only works on the computer running Asset Forge.`;
  if (FILE_ARGS.some((k) => k in args)) return 'Working with files by path only works on the computer running Asset Forge; send data or url instead.';
  if (typeof args.url === 'string' && !(await publicUrl(args.url))) {
    return 'From another computer, url must be a public http(s) address (not this computer or its local network); send data instead.';
  }
  return null;
}

async function publicUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  try {
    const found = await dns.lookup(u.hostname.replace(/^\[|\]$/g, ''), { all: true });
    return found.length > 0 && found.every((a) => !privateAddress(a.address));
  } catch {
    return false;
  }
}

function privateAddress(ip) {
  const v4 = ip.replace(/^::ffff:/i, '');
  if (net.isIPv4(v4)) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128) || a >= 224;
  }
  const s = ip.toLowerCase();
  return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
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
