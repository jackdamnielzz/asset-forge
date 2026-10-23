// A fake AI server that answers like OpenAI, Google Gemini, NanoGPT and fal.ai do
// (following their public docs), so the connections can be tested without real keys.
import http from 'node:http';
import fs from 'node:fs/promises';

export function startMockAi(port, { png, glb }) {
  const seen = [];
  const base = `http://127.0.0.1:${port}`;
  let videoPolls = 0;
  let tilesetPolls = 0;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const body = req.headers['content-type']?.includes('json') && raw.length ? JSON.parse(raw) : null;
    seen.push({ method: req.method, url: req.url, headers: req.headers, body, raw: raw.toString('latin1', 0, 2000) });
    const json = (o, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, base);
    if (u.pathname === '/openai/images/generations' || u.pathname === '/openai/images/edits') return json({ data: [{ b64_json: png }] });
    if (u.pathname.startsWith('/google/models/') && u.pathname.endsWith(':generateContent')) {
      return json({ candidates: [{ content: { parts: [{ text: 'here you go' }, { inlineData: { mimeType: 'image/png', data: png } }] } }] });
    }
    if (u.pathname === '/pixellab/create-image-pixflux' || u.pathname === '/pixellab/image-to-pixelart') return json({ usage: { type: 'usd', usd: 0.01 }, image: { type: 'base64', base64: png, format: 'png' } });
    if (u.pathname === '/pixellab/openapi.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(await fs.readFile(new URL('./fixtures/pixellab-openapi.json', import.meta.url))); }
    if (u.pathname === '/pixellab/balance') return json({ credits: { type: 'usd', usd: 0 }, subscription: { type: 'generations', status: 'active', generations: 1999, total: 2000 } });
    if (u.pathname === '/pixellab/create-tileset') return json({ background_job_id: 'job1', tileset_id: 'ts1', status: 'processing', usage: { type: 'usd', usd: 0 } }, 202);
    if (u.pathname === '/pixellab/background-jobs/job1') {
      tilesetPolls++;
      return json(tilesetPolls < 2 ? { id: 'job1', status: 'processing', created_at: 'x' } : { id: 'job1', status: 'completed', created_at: 'x', last_response: { tileset_id: 'ts1' }, usage: { type: 'usd', usd: 0.02 } });
    }
    if (u.pathname === '/pixellab/tilesets/ts1') return json({ id: 'ts1', tiles: [{ name: 'grass', image: { type: 'base64', base64: png } }, { name: 'water', image: { type: 'base64', base64: png } }], preview_url: `${base}/files/preview.png` });
    if (u.pathname === '/files/preview.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from(png, 'base64')); }
    if (u.pathname === '/pixellab/objects/obj9/animations') return json({ ok: true, object_id: 'obj9', animation_id: 'anim1' });
    if (u.pathname === '/nanogpt/v1/images/generations') return json({ created: 1, data: [{ b64_json: png }], cost: 0.01 });
    if (u.pathname === '/nanogpt/generate-video') return json({ runId: 'vid_test1', id: 'vid_test1', status: 'pending' }, 202);
    if (u.pathname === '/nanogpt/video/status') {
      videoPolls++;
      return json({ data: videoPolls < 2 ? { status: 'IN_PROGRESS' } : { status: 'COMPLETED', output: { video: { url: `${base}/files/video.mp4` } } } });
    }
    if (u.pathname === '/fal/fal-ai/trellis-2') return json({ request_id: 'r1', status_url: `${base}/fal/requests/r1/status`, response_url: `${base}/fal/requests/r1` });
    if (u.pathname === '/fal/requests/r1/status') return json({ status: 'COMPLETED' });
    if (u.pathname === '/fal/requests/r1') return json({ model_glb: { url: `${base}/files/model.glb` } });
    if (u.pathname === '/files/model.glb') { res.writeHead(200); return res.end(glb); }
    if (u.pathname === '/files/video.mp4') {
      // just enough of an MP4 header to be recognised as a video file
      const fake = Buffer.alloc(64);
      fake.writeUInt32BE(24, 0);
      fake.write('ftypisom', 4, 'ascii');
      res.writeHead(200);
      return res.end(fake);
    }
    json({ error: { message: `mock: unknown ${u.pathname}` } }, 404);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, seen, base })));
}
