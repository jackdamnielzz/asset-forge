import { AI_GUIDE, API_NOTES } from '../shared/ai-guide.js';

// Documentation generated from the live command list, so it always matches the software:
// an OpenAPI 3.1 file (for ChatGPT actions, LangChain, n8n and other tools), llms.txt
// (a compact guide for AIs), a Markdown reference and an HTML page.

const CATEGORY_TITLES = {
  scene: 'Scene', objects: 'Objects', modeling: 'Modelling', animation: 'Animation', render: 'Pictures & exports',
  game: 'Game assets', generators: 'Generators', pixel: 'Pixel art', images: 'Picture tools', voxels: 'Voxels',
  assets: 'Library: importing', library: 'Library', recipes: 'Recipes, variations & quality', style: 'House styles',
  ai: 'AI services', pixellab: 'PixelLab (all tools)', project: 'Projects, versions & backups', help: 'Help',
};

const TAG_DESCRIPTIONS = {
  scene: 'The scene as a whole: what is in it, lighting, style, effects, camera, undo and batches.',
  objects: 'Adding, changing, colouring and removing shapes.',
  modeling: 'Cutting, combining, mirroring, repeating and grouping shapes.',
  animation: 'Movement presets and keyframes that play in the window and go into exports.',
  render: 'Pictures you can look at, and 3D/picture files to deliver.',
  game: 'Icons, sprite sheets and exports straight into Godot projects.',
  generators: 'Whole ready-made props built in one call, with options and a seed.',
  pixel: 'Pixel-art tools: effects, backgrounds, colour tools, style check, sheets and Aseprite.',
  images: 'Picture tools and AI-made videos turned into sprites.',
  voxels: 'Block models: editing, from pixel art, and MagicaVoxel import.',
  assets: 'Bringing pictures and 3D models into the library.',
  library: 'Finished assets with thumbnails and tags; searching and placing them.',
  recipes: 'Re-making, variations and the quality check.',
  style: 'One consistent look (palette, light, style) for a whole game.',
  ai: 'Outside AI services for images, video and 3D (cost money).',
  pixellab: 'Every PixelLab tool with every setting (cost PixelLab generations).',
  project: 'Projects, version history, checkpoints and backups.',
  help: 'Lists of commands, presets and plugins.',
};

export function openapi(commands, { version }) {
  const paths = {
    '/api/health': get('health', 'Is Asset Forge running?', 'Returns { ok, app, version, project }.'),
    '/api/commands': get('listAllCommands', 'List all commands', 'Every command with its description and JSON input schema.'),
    '/api/scene': get('currentScene', 'The current scene', 'All objects with transforms, shape settings and materials, plus environment, camera and animations.'),
    '/api/library': get('library', 'The library', 'Images, 3D models, videos, recipes and saved assets.'),
    '/api/openapi.json': get('openapi', 'This OpenAPI description', 'The machine-readable description of every command.'),
  };
  for (const c of commands) {
    const hasRequired = (c.inputSchema.required ?? []).length > 0;
    paths[`/api/commands/${c.name}`] = {
      post: {
        operationId: c.name,
        summary: c.title,
        description: c.description,
        tags: [CATEGORY_TITLES[c.category] ?? c.category],
        ...(c.name.startsWith('render_preview') ? { parameters: [{ name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['png'] }, description: 'png: answer with the picture itself instead of JSON' }] } : {}),
        requestBody: { required: hasRequired, content: { 'application/json': { schema: c.inputSchema, example: example(c.inputSchema) } } },
        responses: {
          200: { description: 'Done', content: { 'application/json': { schema: { type: 'object', properties: { ok: { const: true }, result: { description: 'What the command returns (see its description)' } }, required: ['ok'] } } } },
          400: { $ref: '#/components/responses/Error' },
          401: { description: 'Password needed (only when Asset Forge is shared on a network)' },
          403: { description: 'Not allowed (e.g. a file path from another computer, or a request from another website)' },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Asset Forge API', version, description: `${AI_GUIDE}\n\n${API_NOTES}`, license: { name: 'Proprietary (private project)', identifier: 'LicenseRef-Proprietary' } },
    servers: [
      { url: 'http://127.0.0.1:7777', description: 'On the computer running Asset Forge' },
      { url: 'http://{host}:7777', description: 'Asset Forge shared on a network (needs the password)', variables: { host: { default: '192.168.1.10' } } },
    ],
    security: [{}, { bearerAuth: [] }],
    tags: Object.entries(CATEGORY_TITLES).map(([cat, name]) => ({ name, description: TAG_DESCRIPTIONS[cat] ?? name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'The sharing password; not needed on the same computer' } },
      responses: {
        Error: { description: 'Wrong input or the command failed; error explains why and how to fix it', content: { 'application/json': { schema: { type: 'object', properties: { ok: { const: false }, error: { type: 'string' } } } } } },
      },
    },
  };
}

export function llmsTxt(commands, { version }) {
  const groups = byCategory(commands);
  const lines = [
    '# Asset Forge', '',
    `> An AI-controllable 3D and pixel-art asset creation tool (version ${version}). ${commands.length} commands over a simple HTTP API and MCP.`, '',
    AI_GUIDE, '', API_NOTES, '',
    '## Full documentation', '',
    '- [OpenAPI 3.1 description](/api/openapi.json): every command with its full input schema',
    '- [API reference](/docs/api.md): every command and every setting explained, with examples',
    '- [Command list (JSON)](/api/commands)', '',
  ];
  for (const [cat, list] of groups) {
    lines.push(`## ${CATEGORY_TITLES[cat] ?? cat}`, '');
    for (const c of list) lines.push(`- ${c.name}: ${firstSentence(c.description)}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function markdown(commands, { version }) {
  const groups = byCategory(commands);
  const out = [
    '# Asset Forge API reference', '',
    `Version ${version} · ${commands.length} commands · generated from the software itself (\`npm run docs\`), so it always matches.`, '',
    '## How to call', '', API_NOTES, '',
    'Example:', '', '```bash',
    'curl -X POST http://127.0.0.1:7777/api/commands/add_object -H "Content-Type: application/json" -d \'{"type":"box","material":{"preset":"oak"}}\'',
    '```', '',
    '## Guide for AIs', '', '```text', AI_GUIDE, '```', '',
    '## Contents', '',
    ...groups.map(([cat, list]) => `- **${CATEGORY_TITLES[cat] ?? cat}**: ${list.map((c) => `[${c.name}](#${c.name})`).join(', ')}`), '',
  ];
  for (const [cat, list] of groups) {
    out.push(`## ${CATEGORY_TITLES[cat] ?? cat}`, '');
    for (const c of list) {
      out.push(`### ${c.name}`, '', `**${c.title}**${c.mutates ? ' · changes the scene (one undo step)' : ''}`, '', c.description, '');
      const props = Object.entries(c.inputSchema.properties ?? {});
      if (props.length) {
        const req = new Set(c.inputSchema.required ?? []);
        out.push('| Input | Type | Required | Description |', '|---|---|---|---|');
        for (const [k, p] of props) out.push(`| \`${k}\` | ${typeOf(p)} | ${req.has(k) ? 'yes' : ''} | ${cell(describe(p))} |`);
        out.push('');
      } else out.push('_No inputs._', '');
      out.push('```json', `POST /api/commands/${c.name}`, JSON.stringify(example(c.inputSchema)), '```', '');
    }
  }
  return out.join('\n');
}

export function html(commands, { version }) {
  const groups = byCategory(commands);
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  const section = (c) => {
    const req = new Set(c.inputSchema.required ?? []);
    const rows = Object.entries(c.inputSchema.properties ?? {}).map(([k, p]) => `<tr><td><code>${esc(k)}</code>${req.has(k) ? ' <b>*</b>' : ''}</td><td>${esc(typeOf(p))}</td><td>${esc(describe(p))}</td></tr>`).join('');
    return `<section class="cmd" id="${c.name}" data-text="${esc(`${c.name} ${c.title} ${c.description}`.toLowerCase())}"><h3>${c.name} <small>${esc(c.title)}</small></h3><p>${esc(c.description)}</p>${rows ? `<table><tr><th>Input</th><th>Type</th><th>Description</th></tr>${rows}</table>` : '<p class="muted">No inputs.</p>'}<pre>POST /api/commands/${c.name}\n${esc(JSON.stringify(example(c.inputSchema), null, 1))}</pre></section>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Asset Forge API</title>
<link rel="icon" type="image/png" href="/web/icon-256.png"><style>
:root{color-scheme:dark}body{margin:0;background:#16181d;color:#e6e8ec;font:14px/1.5 "Segoe UI",system-ui,sans-serif}
header{position:sticky;top:0;background:#1e2128;border-bottom:1px solid #323743;padding:12px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header h1{font-size:18px;margin:0}header h1 span{color:#ff8a3d}input{background:#16181d;color:inherit;border:1px solid #323743;border-radius:6px;padding:7px 10px;min-width:260px}
main{max-width:1000px;margin:0 auto;padding:16px 20px 60px}a{color:#3dc6ff}h2{margin-top:36px;border-bottom:1px solid #323743;padding-bottom:6px}
.cmd{background:#1e2128;border:1px solid #323743;border-radius:10px;padding:4px 16px 10px;margin:12px 0}.cmd h3 small{color:#9198a5;font-weight:400;font-size:13px;margin-left:6px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-top:1px solid #323743;padding:5px 6px;text-align:left;vertical-align:top}th{color:#9198a5;font-weight:600}
code,pre{font-family:Consolas,ui-monospace,monospace}pre{background:#111317;border-radius:6px;padding:8px 10px;overflow:auto;font-size:12px;white-space:pre-wrap}.muted{color:#9198a5}
</style></head><body><header><h1><span>◆</span> Asset Forge API</h1><span class="muted">v${esc(version)} · ${commands.length} commands</span>
<input id="q" placeholder="Search commands…" autofocus><a href="/api/openapi.json">OpenAPI</a><a href="/llms.txt">llms.txt</a><a href="/docs/api.md">Markdown</a></header>
<main><h2>How to call</h2><pre>${esc(API_NOTES)}</pre><h2>Guide for AIs</h2><pre>${esc(AI_GUIDE)}</pre>
${groups.map(([cat, list]) => `<h2 class="cat">${esc(CATEGORY_TITLES[cat] ?? cat)}</h2>${list.map(section).join('')}`).join('')}</main>
<script>document.getElementById('q').addEventListener('input',e=>{const q=e.target.value.toLowerCase();for(const s of document.querySelectorAll('.cmd'))s.style.display=!q||s.dataset.text.includes(q)?'':'none'})</script></body></html>`;
}

// ---- helpers --------------------------------------------------------------------------

function get(operationId, summary, description) {
  return { get: { operationId, summary, description, responses: { 200: { description: 'OK' }, 401: { description: 'Password needed (only when shared on a network)' } } } };
}

function byCategory(commands) {
  const order = Object.keys(CATEGORY_TITLES);
  const map = new Map();
  for (const c of commands) { if (!map.has(c.category)) map.set(c.category, []); map.get(c.category).push(c); }
  return [...map.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
}

function firstSentence(s) {
  const m = String(s).match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim();
}

function typeOf(p) {
  if (p.enum) return 'one of';
  if (p.anyOf) return p.anyOf.map(typeOf).filter((t, i, a) => a.indexOf(t) === i).join(' or ');
  if (p.type === 'array') return `list of ${p.items ? typeOf(p.items) : 'values'}`;
  return Array.isArray(p.type) ? p.type.join(' or ') : p.type ?? 'any';
}

function describe(p) {
  const bits = [p.description ?? ''];
  if (p.enum) bits.push(`Allowed: ${p.enum.map((v) => JSON.stringify(v)).join(', ')}.`);
  if (p.minimum !== undefined || p.maximum !== undefined) bits.push(`Range ${p.minimum ?? '…'} to ${p.maximum ?? '…'}.`);
  if (p.minItems !== undefined && p.minItems === p.maxItems) bits.push(`Exactly ${p.minItems} values.`);
  if (p.default !== undefined) bits.push(`Default ${JSON.stringify(p.default)}.`);
  return bits.filter(Boolean).join(' ');
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

// A small example body with every required input filled in.
export function example(schema) {
  const out = {};
  for (const k of schema.required ?? []) out[k] = sample(schema.properties?.[k] ?? {}, k);
  return out;
}

function sample(p, key) {
  if (p.default !== undefined) return p.default;
  if (p.enum) return p.enum[0];
  if (p.anyOf) return sample(p.anyOf.find((x) => x.type !== 'null') ?? {}, key);
  const t = Array.isArray(p.type) ? p.type[0] : p.type;
  if (t === 'string') {
    let s;
    if (/id$/i.test(key)) s = `${key.replace(/Id$|_id$/i, '')}_1`;
    else if (key === 'name' || key === 'filename') s = 'my_asset';
    else if (/prompt|description|query|note/i.test(key)) s = 'a wooden treasure chest';
    else if (p.format === 'uri' || key === 'url') s = 'https://example.com/picture.png';
    else if (/color|colour|hex/i.test(`${key} ${p.pattern ?? ''}`)) s = '#c8955c';
    else s = 'example';
    return p.minLength && s.length < p.minLength ? s.padEnd(p.minLength, 'x') : s;
  }
  if (t === 'integer' || t === 'number') return p.minimum ?? 1;
  if (t === 'boolean') return true;
  if (t === 'array') return p.minItems ? Array.from({ length: p.minItems }, () => sample(p.items ?? {}, key)) : [];
  if (t === 'object') return example(p);
  return null;
}
