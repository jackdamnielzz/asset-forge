import fs from 'node:fs/promises';
import path from 'node:path';
import { CommandError } from './registry.js';

// Full PixelLab support, driven by PixelLab's own OpenAPI specification: every tool and every
// setting PixelLab offers is listed and can be run, without Asset Forge needing an update
// when PixelLab adds something. Pictures from the library are converted to the format
// PixelLab expects, long-running jobs are followed until done, and every picture in the
// result ends up in the library.

const SPEC_MAX_AGE = 24 * 3600_000;
const POLL_MS = Number(process.env.FORGE_POLL_MS) || 3000;
// management endpoints that are not "make something" tools
const HIDDEN = /^\/(uploads|background-jobs|balance|llms\.txt)/;
// where a finished job's results can be fetched, by the id the job returns
const DETAIL_ROUTES = {
  character_id: ['/characters/{id}'],
  object_id: ['/objects/{id}'],
  tileset_id: ['/tilesets/{id}', '/tilesets-sidescroller/{id}'],
  tile_id: ['/tiles-pro/{id}', '/isometric-tiles/{id}'],
  ui_asset_id: ['/ui-assets/{id}'],
  map_object_id: ['/map-objects/{id}'],
};

export class PixelLab {
  constructor(engine) {
    this.engine = engine;
    this.file = path.join(engine.workspace, 'cache', 'pixellab-openapi.json');
    this.cache = null;
  }

  async config() {
    return this.engine.providers.ready('pixellab', 'image');
  }

  // ---- the specification --------------------------------------------------------------

  async spec(refresh = false) {
    if (this.cache && !refresh) return this.cache;
    let stale = true;
    try { stale = Date.now() - (await fs.stat(this.file)).mtimeMs > SPEC_MAX_AGE; } catch {}
    if (!stale && !refresh) {
      try { return (this.cache = JSON.parse(await fs.readFile(this.file, 'utf8'))); } catch {}
    }
    const { baseUrl } = await this.engine.providers.config('pixellab');
    try {
      const res = await fetch(`${baseUrl}/openapi.json`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const spec = await res.json();
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(spec));
      return (this.cache = spec);
    } catch (err) {
      // offline: fall back to the last copy, however old
      try { return (this.cache = JSON.parse(await fs.readFile(this.file, 'utf8'))); } catch {}
      throw new CommandError(`Could not load PixelLab's tool list (${err.message}). Check the internet connection.`);
    }
  }

  // Resolve $refs and "X or null" unions into a plain, readable schema. Pictures are marked x-image.
  simplify(schema, spec, depth = 0) {
    if (!schema || depth > 6) return schema ?? {};
    if (schema.$ref) {
      const name = schema.$ref.split('/').pop();
      const target = spec.components?.schemas?.[name] ?? {};
      if (name === 'Base64Image' || isBase64Image(target)) return { type: 'object', 'x-image': true, title: schema.title ?? 'Image', description: schema.description ?? target.description?.split('\n')[0] };
      return this.simplify({ ...target, title: schema.title ?? target.title, description: schema.description ?? target.description }, spec, depth + 1);
    }
    for (const key of ['anyOf', 'oneOf']) {
      if (schema[key]) {
        const opts = schema[key].filter((s) => s.type !== 'null');
        const nullable = opts.length < schema[key].length;
        if (opts.length === 1) return { ...this.simplify(opts[0], spec, depth + 1), ...pick(schema, ['title', 'description', 'default']), nullable };
        return { ...pick(schema, ['title', 'description', 'default']), anyOf: opts.map((s) => this.simplify(s, spec, depth + 1)), nullable };
      }
    }
    if (schema.allOf?.length === 1) return this.simplify({ ...schema.allOf[0], ...pick(schema, ['title', 'description', 'default']) }, spec, depth + 1);
    const out = { ...schema };
    if (out.properties) out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, this.simplify(v, spec, depth + 1)]));
    if (out.items) out.items = this.simplify(out.items, spec, depth + 1);
    return out;
  }

  async tools() {
    const spec = await this.spec();
    const list = [];
    for (const [p, methods] of Object.entries(spec.paths ?? {})) {
      const op = methods.post;
      if (!op || HIDDEN.test(p)) continue;
      const body = op.requestBody?.content?.['application/json']?.schema;
      const pathParams = (op.parameters ?? []).filter((x) => x.in === 'path').map((x) => x.name);
      list.push({
        tool: p.replace(/^\//, ''),
        title: op.summary ?? p,
        category: category(p),
        background: !!op.responses?.['202'] || /background_job_id/.test(JSON.stringify(this.simplify(op.responses?.['200']?.content?.['application/json']?.schema ?? {}, spec))),
        pathParams,
        hasBody: !!body,
      });
    }
    return list.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  }

  async info(tool) {
    const spec = await this.spec();
    const op = spec.paths?.[`/${tool}`]?.post;
    if (!op) throw new CommandError(`PixelLab has no tool "${tool}". See pixellab_tools.`);
    const body = op.requestBody?.content?.['application/json']?.schema;
    return {
      tool,
      title: op.summary,
      description: op.description ?? '',
      pathParams: (op.parameters ?? []).filter((x) => x.in === 'path').map((x) => ({ name: x.name, description: x.description ?? '' })),
      params: body ? this.simplify(body, spec) : { type: 'object', properties: {} },
    };
  }

  // ---- running tools ---------------------------------------------------------------------

  // params may name pictures by library id ("img_..."), or { render: objectId } for a render.
  async run(tool, params = {}, { pathParams = {}, onStatus } = {}) {
    const c = await this.config();
    const info = await this.info(tool);
    let route = `/${tool}`;
    for (const { name } of info.pathParams) {
      if (!pathParams[name]) throw new CommandError(`"${tool}" needs ${name}.`);
      route = route.replace(`{${name}}`, encodeURIComponent(pathParams[name]));
    }
    const body = await this.convertImages(params, info.params);
    const first = await this.request(c, 'POST', route, body);
    let response = first, usage = first?.usage ?? null;
    const jobId = first?.background_job_id ?? (first?.status === 'processing' ? first?.id : null);
    if (jobId) {
      const job = await this.waitForJob(c, jobId, onStatus);
      response = { ...first, ...(job.last_response ?? {}) };
      usage = job.usage ?? usage;
    }
    const images = [];
    await this.collectImages(c, response, images);
    if (jobId && !images.length) {
      // results that are stored in the PixelLab account: fetch them by their id
      for (const [key, routes] of Object.entries(DETAIL_ROUTES)) {
        const id = response?.[key];
        if (!id) continue;
        for (const r of routes) {
          try {
            const detail = await this.request(c, 'GET', r.replace('{id}', encodeURIComponent(id)));
            await this.collectImages(c, detail, images);
            if (images.length) break;
          } catch {}
        }
      }
    }
    return { images, usage, response: stripImages(response), jobId };
  }

  async waitForJob(c, id, onStatus) {
    const end = Date.now() + 20 * 60_000;
    while (Date.now() < end) {
      const job = await this.request(c, 'GET', `/background-jobs/${encodeURIComponent(id)}`);
      onStatus?.(job.status);
      if (job.status === 'completed') return job;
      if (job.status === 'failed' || job.status === 'cancelled') {
        const why = job.last_response?.error ?? job.last_response?.detail ?? job.status;
        throw new CommandError(`PixelLab job failed: ${typeof why === 'string' ? why : JSON.stringify(why)}`);
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    throw new CommandError('PixelLab took too long; the job may still finish in your PixelLab account.');
  }

  async request(c, method, route, body) {
    const res = await fetch(`${c.baseUrl}${route}`, {
      method,
      headers: { Authorization: `Bearer ${c.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10 * 60_000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!res.ok) {
      const d = json?.detail;
      const msg = Array.isArray(d) ? d.map((x) => `${(x.loc ?? []).slice(1).join('.')}: ${x.msg}`).join('; ') : d ?? json?.error ?? text.slice(0, 300);
      const hint = res.status === 402 ? ' (not enough PixelLab credits or generations)' : res.status === 429 ? ' (too many requests; wait a moment)' : '';
      throw new CommandError(`PixelLab: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}${hint} [HTTP ${res.status}]`);
    }
    return json ?? {};
  }

  // Swap library picture ids for the base64 image objects PixelLab wants, following the schema.
  async convertImages(value, schema) {
    if (value === null || value === undefined) return value;
    if (schema?.['x-image']) {
      if (typeof value === 'string' || value?.asset || value?.render) return this.imagePayload(value);
      return value;
    }
    if (schema?.anyOf) {
      const img = schema.anyOf.find((s) => s['x-image']);
      if (img && (typeof value === 'string' || value?.asset || value?.render)) return this.imagePayload(value);
    }
    if (Array.isArray(value)) return Promise.all(value.map((v) => this.convertImages(v, schema?.items)));
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = await this.convertImages(v, schema?.properties?.[k]);
      return out;
    }
    return value;
  }

  async imagePayload(ref) {
    if (typeof ref === 'object' && ref.render) {
      this.engine.getObject(ref.render);
      const shot = await this.engine.render({ view: ref.view ?? 'iso', width: ref.size ?? 256, height: ref.size ?? 256, target: ref.render, isolate: true, ground: false, background: 'transparent' });
      return { type: 'base64', base64: shot.png, format: 'png' };
    }
    const id = typeof ref === 'string' ? ref : ref.asset;
    const a = this.engine.library.images[id];
    if (!a) throw new CommandError(`Unknown library image "${id}". See list_images.`);
    const buf = await fs.readFile(path.join(this.engine.paths.images, a.file));
    return { type: 'base64', base64: buf.toString('base64'), format: a.mime === 'image/jpeg' ? 'jpeg' : a.mime === 'image/gif' ? 'gif' : 'png' };
  }

  // Find every picture in a response: base64 objects, data URLs and links to image files.
  async collectImages(c, value, out, label = '') {
    if (!value || out.length > 200) return;
    if (Array.isArray(value)) {
      for (const [i, v] of value.entries()) await this.collectImages(c, v, out, label ? `${label}_${i + 1}` : `${i + 1}`);
      return;
    }
    if (typeof value === 'object') {
      if (typeof value.base64 === 'string' && value.base64.length > 50) {
        out.push({ label, buf: Buffer.from(value.base64, 'base64') });
        return;
      }
      for (const [k, v] of Object.entries(value)) await this.collectImages(c, v, out, label ? `${label}_${k}` : k);
      return;
    }
    if (typeof value !== 'string') return;
    if (value.startsWith('data:image/')) out.push({ label, buf: Buffer.from(value.split(',')[1], 'base64') });
    else if (/^https?:\/\/\S+\.(png|gif|webp|jpe?g)(\?\S*)?$/i.test(value)) {
      try {
        const res = await fetch(value, { signal: AbortSignal.timeout(60_000) });
        if (res.ok) out.push({ label, buf: Buffer.from(await res.arrayBuffer()) });
      } catch {}
    }
  }

  async balance() {
    return this.request(await this.config(), 'GET', '/balance');
  }
}

function isBase64Image(s) {
  return s?.properties?.base64 && s?.properties?.type && Object.keys(s.properties).length <= 3;
}

function pick(o, keys) {
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
}

function category(p) {
  if (/vfx/.test(p)) return 'Effects';
  if (/font|ui/.test(p)) return 'UI & fonts';
  if (/tile|map-object/.test(p)) return 'Tiles & maps';
  if (/animat|interpolation|lip-sync|talking|vocal|skeleton/.test(p)) return 'Animation';
  if (/character|rotate|rotations|portrait|outfit|object/.test(p)) return 'Characters & objects';
  if (/edit|inpaint|correct|resize|reduce|remove-background|unzoom|normal-map|to-pixelart|to-text/.test(p)) return 'Editing & conversion';
  if (/image|generate|pixflux|bitforge|pixen|style/.test(p)) return 'Images';
  return 'Other';
}

// Leave out bulky base64 data when reporting a response back.
function stripImages(v) {
  if (Array.isArray(v)) return v.map(stripImages);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x?.base64 === 'string' ? '[image]' : stripImages(x)]));
  if (typeof v === 'string' && v.length > 300) return `${v.slice(0, 60)}…`;
  return v;
}
