import fs from 'node:fs/promises';
import path from 'node:path';
import { CommandError } from './registry.js';
import { imageInfo } from './images.js';

// Connections to outside AI services that make images, videos and 3D models.
// API keys live in workspace/secrets.json (never in git) or in environment variables,
// and are never sent back through the API.

export const SERVICES = {
  openai: {
    name: 'OpenAI (ChatGPT images)',
    env: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    can: ['image'],
    models: { image: ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-1.5'] },
    signup: 'https://platform.openai.com/api-keys',
  },
  google: {
    name: 'Google Gemini (Nano Banana)',
    env: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    can: ['image'],
    models: { image: ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'] },
    signup: 'https://aistudio.google.com/apikey',
  },
  nanogpt: {
    name: 'NanoGPT (many image and video models)',
    env: 'NANOGPT_API_KEY',
    baseUrl: 'https://nano-gpt.com/api',
    can: ['image', 'video'],
    models: {
      image: ['hidream', 'flux-kontext', 'gpt-image-2', 'openai/gpt-image-2.5/flare/text-to-image'],
      video: ['veo2-video', 'kling-video-v2', 'kling-v21-pro', 'wan-video-image-to-video', 'seedance-lite-video'],
    },
    signup: 'https://nano-gpt.com/api',
  },
  pixellab: {
    name: 'PixelLab (AI pixel art)',
    env: 'PIXELLAB_API_KEY',
    baseUrl: 'https://api.pixellab.ai/v2',
    can: ['image'],
    models: { image: ['pixflux', 'image-to-pixelart'] },
    signup: 'https://www.pixellab.ai/pixellab-api',
  },
  fal: {
    name: 'fal.ai (photo or text → 3D model)',
    env: 'FAL_KEY',
    baseUrl: 'https://queue.fal.run',
    can: ['3d'],
    models: { '3d': ['fal-ai/trellis-2', 'fal-ai/hunyuan-3d/v3.1/pro/image-to-3d', 'fal-ai/hunyuan-3d/v3.1/pro/text-to-3d'] },
    signup: 'https://fal.ai/dashboard/keys',
  },
};

export class Providers {
  constructor(workspace) {
    this.file = path.join(workspace, 'secrets.json');
  }

  async load() {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')); } catch { return {}; }
  }

  async setKey(service, key, baseUrl) {
    if (!SERVICES[service]) throw new CommandError(`Unknown service "${service}". Choose: ${Object.keys(SERVICES).join(', ')}`);
    const all = await this.load();
    const before = all[service] ?? {};
    // a key belongs to its address: a new address without a new key must not receive the old key
    const keep = baseUrl === undefined || baseUrl === before.baseUrl ? before : { ...before, key: undefined };
    all[service] = { ...keep, ...(key !== undefined ? { key } : {}), ...(baseUrl !== undefined ? { baseUrl } : {}) };
    if (all[service].key === '' || all[service].key === null) delete all[service].key;
    await fs.writeFile(this.file, JSON.stringify(all, null, 2));
  }

  async config(service) {
    const def = SERVICES[service];
    if (!def) throw new CommandError(`Unknown service "${service}". Choose: ${Object.keys(SERVICES).join(', ')}`);
    const saved = (await this.load())[service] ?? {};
    const key = saved.key || process.env[def.env];
    return { def, key, baseUrl: (saved.baseUrl || def.baseUrl).replace(/\/$/, '') };
  }

  async status() {
    const out = {};
    for (const id of Object.keys(SERVICES)) {
      const { def, key, baseUrl } = await this.config(id);
      out[id] = { name: def.name, connected: !!key, can: def.can, models: def.models, signup: def.signup, customUrl: baseUrl !== def.baseUrl ? baseUrl : undefined };
    }
    return out;
  }

  async ready(service, capability) {
    const c = await this.config(service);
    if (!c.def.can.includes(capability)) {
      const others = Object.entries(SERVICES).filter(([, s]) => s.can.includes(capability)).map(([k]) => k);
      throw new CommandError(`${c.def.name} cannot make ${capability}. Services that can: ${others.join(', ')}`);
    }
    if (!c.key) throw new CommandError(`${c.def.name} is not connected yet. Add an API key in the window (✨ AI → Services) or set ${c.def.env}. Get a key at ${c.def.signup}`);
    return c;
  }

  // ---- images -------------------------------------------------------------------
  // refs: [{ data: base64, mime }]; returns Buffer
  async image(service, { prompt, model, size, transparent, refs = [] }) {
    const c = await this.ready(service, 'image');
    if (service === 'openai') return openaiImage(c, { prompt, model: model ?? c.def.models.image[0], size, transparent, refs });
    if (service === 'google') return googleImage(c, { prompt, model: model ?? c.def.models.image[0], size, transparent, refs });
    if (service === 'pixellab') return pixellabImage(c, { prompt, model: model ?? c.def.models.image[0], size, transparent, refs });
    return nanogptImage(c, { prompt, model: model ?? c.def.models.image[0], size, refs });
  }

  // ---- video (NanoGPT) --------------------------------------------------------------
  async video(service, { prompt, model, duration, aspect, ref, onStatus }) {
    const c = await this.ready(service, 'video');
    const m = model ?? c.def.models.video[0];
    const body = { model: m, prompt };
    if (duration) body.duration = /kling|wan/.test(m) ? String(duration) : `${duration}s`;
    if (aspect) body.aspect_ratio = aspect;
    if (ref) body.imageDataUrl = `data:${ref.mime};base64,${ref.data}`;
    const start = await api(`${c.baseUrl}/generate-video`, { method: 'POST', headers: bearer(c.key), body });
    const runId = start.runId ?? start.id;
    if (!runId) throw new CommandError(`NanoGPT did not return a job id: ${JSON.stringify(start).slice(0, 200)}`);
    const result = await poll(async () => {
      const s = await api(`${c.baseUrl}/video/status?requestId=${encodeURIComponent(runId)}`, { headers: bearer(c.key) });
      const status = s.data?.status ?? s.status;
      onStatus?.(status);
      if (status === 'COMPLETED') return s;
      if (status === 'FAILED' || status === 'CANCELED') throw new CommandError(`Video failed: ${s.data?.userFriendlyError ?? s.data?.error ?? status}`);
      return null;
    }, 15 * 60_000, POLL_MS);
    const url = result.data?.output?.video?.url;
    if (!url) throw new CommandError('Video finished but no video URL was returned.');
    return download(url);
  }

  // ---- 3D (fal.ai queue) ------------------------------------------------------------
  async model3d(service, { prompt, model, ref, onStatus }) {
    const c = await this.ready(service, '3d');
    const m = model ?? (ref ? 'fal-ai/trellis-2' : 'fal-ai/hunyuan-3d/v3.1/pro/text-to-3d');
    const dataUrl = ref && `data:${ref.mime};base64,${ref.data}`;
    const body = /text-to-3d/.test(m) ? { prompt } : /hunyuan/.test(m) ? { input_image_url: dataUrl } : { image_url: dataUrl };
    if (!/text-to-3d/.test(m) && !ref) throw new CommandError(`${m} needs an image. Give image (an asset id) or use a text-to-3d model.`);
    if (/text-to-3d/.test(m) && !prompt) throw new CommandError(`${m} needs a prompt.`);
    const headers = { Authorization: `Key ${c.key}` };
    const job = await api(`${c.baseUrl}/${m}`, { method: 'POST', headers, body });
    if (!job.status_url || !job.response_url) throw new CommandError(`fal.ai did not queue the job: ${JSON.stringify(job).slice(0, 200)}`);
    // the key only goes to the service's own address, even if a reply points somewhere else
    const own = new URL(c.baseUrl).host;
    for (const u of [job.status_url, job.response_url]) {
      if (new URL(u).host !== own) throw new CommandError(`fal.ai sent a status address on another host (${new URL(u).host}); stopped so your key is not sent there.`);
    }
    await poll(async () => {
      const s = await api(job.status_url, { headers });
      onStatus?.(s.status);
      if (s.status === 'COMPLETED') return s;
      if (s.status === 'FAILED' || s.error) throw new CommandError(`3D generation failed: ${s.error ?? s.status}`);
      return null;
    }, 15 * 60_000, POLL_MS);
    const result = await api(job.response_url, { headers });
    const url = result.model_glb?.url ?? result.model_urls?.glb?.url ?? result.model_mesh?.url;
    if (!url) throw new CommandError(`3D model finished but no GLB was returned: ${JSON.stringify(result).slice(0, 200)}`);
    return download(url);
  }
}

// ---- service details ------------------------------------------------------------------

async function openaiImage(c, { prompt, model, size, transparent, refs }) {
  const extra = transparent ? { background: 'transparent', output_format: 'png' } : { output_format: 'png' };
  let res;
  if (refs.length) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    if (size) form.append('size', size);
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    refs.forEach((r, i) => form.append('image[]', new Blob([Buffer.from(r.data, 'base64')], { type: r.mime }), `ref${i}.png`));
    res = await api(`${c.baseUrl}/images/edits`, { method: 'POST', headers: bearer(c.key), form });
  } else {
    res = await api(`${c.baseUrl}/images/generations`, { method: 'POST', headers: bearer(c.key), body: { model, prompt, n: 1, size: size ?? '1024x1024', ...extra } });
  }
  const item = res.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item?.url) return download(item.url);
  throw new CommandError('OpenAI returned no image.');
}

async function googleImage(c, { prompt, model, size, transparent, refs }) {
  const parts = [{ text: transparent ? `${prompt}\n\nPlace the subject alone on a plain, pure white background with no shadow.` : prompt }];
  for (const r of refs) parts.push({ inline_data: { mime_type: r.mime, data: r.data } });
  const imageConfig = {};
  if (size && /^\d+:\d+$/.test(size)) imageConfig.aspectRatio = size;
  if (size && /^\d+K$/.test(size)) imageConfig.imageSize = size;
  const body = { contents: [{ parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(Object.keys(imageConfig).length ? { imageConfig } : {}) } };
  const res = await api(`${c.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': c.key }, body });
  for (const p of res.candidates?.[0]?.content?.parts ?? []) {
    const d = p.inlineData?.data ?? p.inline_data?.data;
    if (d) return Buffer.from(d, 'base64');
  }
  const text = (res.candidates?.[0]?.content?.parts ?? []).map((p) => p.text).filter(Boolean).join(' ');
  throw new CommandError(`Gemini returned no image${text ? `: ${text.slice(0, 200)}` : ''}`);
}

// PixelLab: "pixflux" makes pixel art from text (a reference becomes its starting image);
// "image-to-pixelart" turns the reference picture itself into pixel art.
async function pixellabImage(c, { prompt, model, size, transparent, refs }) {
  const [w, h] = (size && /^\d+x\d+$/.test(size) ? size : '64x64').split('x').map(Number);
  const b64 = (r) => ({ type: 'base64', base64: r.data, format: r.mime === 'image/jpeg' ? 'jpeg' : 'png' });
  let res;
  if (model === 'image-to-pixelart') {
    if (!refs.length) throw new CommandError('image-to-pixelart needs a reference picture (references or referenceRender).');
    const info = imageInfo(Buffer.from(refs[0].data, 'base64'));
    res = await api(`${c.baseUrl}/image-to-pixelart`, {
      method: 'POST', headers: bearer(c.key),
      body: { image: b64(refs[0]), image_size: { width: info?.width ?? 512, height: info?.height ?? 512 }, output_size: { width: w, height: h } },
    });
  } else {
    const body = { description: prompt, image_size: { width: w, height: h }, no_background: !!transparent };
    if (refs.length) body.init_image = b64(refs[0]);
    res = await api(`${c.baseUrl}/create-image-pixflux`, { method: 'POST', headers: bearer(c.key), body });
  }
  if (res.image?.base64) return Buffer.from(res.image.base64, 'base64');
  throw new CommandError('PixelLab returned no image.');
}

async function nanogptImage(c, { prompt, model, size, refs }) {
  const body = { model, prompt, n: 1, response_format: 'b64_json' };
  if (size) body.size = size;
  if (refs.length === 1) body.imageDataUrl = `data:${refs[0].mime};base64,${refs[0].data}`;
  if (refs.length > 1) body.imageDataUrls = refs.map((r) => `data:${r.mime};base64,${r.data}`);
  const res = await api(`${c.baseUrl}/v1/images/generations`, { method: 'POST', headers: bearer(c.key), body });
  const item = res.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item?.url) return download(item.url);
  throw new CommandError('NanoGPT returned no image.');
}

// ---- helpers ---------------------------------------------------------------------------

const POLL_MS = Number(process.env.FORGE_POLL_MS) || 4000;
const bearer = (key) => ({ Authorization: `Bearer ${key}` });

async function api(url, { method = 'GET', headers = {}, body, form } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: form ? headers : { 'Content-Type': 'application/json', ...headers },
      body: form ?? (body ? JSON.stringify(body) : undefined),
      signal: AbortSignal.timeout(10 * 60_000),
    });
  } catch (err) {
    throw new CommandError(`Could not reach ${new URL(url).host}: ${err.message}`);
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.error ?? json?.message ?? json?.detail ?? text.slice(0, 300);
    throw new CommandError(`${new URL(url).host} said: ${typeof msg === 'string' ? msg : JSON.stringify(msg)} (HTTP ${res.status})`);
  }
  if (!json) throw new CommandError(`${new URL(url).host} sent something that is not JSON.`);
  return json;
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new CommandError(`Download failed (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function poll(check, timeoutMs, everyMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await check();
    if (r) return r;
    await new Promise((res) => setTimeout(res, everyMs));
  }
  throw new CommandError('The service took too long; try again later.');
}
