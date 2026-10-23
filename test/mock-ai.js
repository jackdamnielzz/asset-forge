// A fake AI server that answers like OpenAI, Google Gemini, NanoGPT and fal.ai do
// (following their public docs), so the connections can be tested without real keys.
import http from 'node:http';

export function startMockAi(port, { png, glb }) {
  const seen = [];
  const base = `http://127.0.0.1:${port}`;
  let videoPolls = 0;
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
