// A small pixel editor for library pictures: pencil, eraser, fill, colour picker, mirror
// drawing, frames with onion skin, undo. Saving adds the result to the library as a new picture
// (through the import_image command, so the original stays untouched).

export async function openPixelEditor({ asset, palette = [], el, openModal, closeModal, run, toast }) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `/library/images/${asset.file}`; });
  const W = img.width, H = img.height;
  if (W * H > 512 * 512) return toast('This picture is too big for the pixel editor (max 512×512). Make a pixel-art version first.', true);
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  let data = sctx.getImageData(0, 0, W, H);
  const undo = [];

  const st = { tool: 'pencil', color: palette[0] ?? '#16171b', mirrorX: false, mirrorY: false, fw: W, fh: H, frame: 0, onion: false, zoom: 1 };
  const own = [...new Set(scanColors(data))].slice(0, 48);
  const colors = [...new Set([...palette, ...own])].slice(0, 64);

  const view = el('canvas', { class: 'pixel-canvas' });
  const vctx = view.getContext('2d');
  const frameLabel = el('span', { class: 'muted' });
  const picker = el('input', { type: 'color', value: st.color, oninput: (e) => { st.color = e.target.value; } });
  const toolButtons = {};
  const tool = (name, label, key) => (toolButtons[name] = el('button', { title: `${label} (${key})`, onclick: () => setTool(name) }, label));
  const setTool = (name) => { st.tool = name; for (const [k, b] of Object.entries(toolButtons)) b.classList.toggle('active', k === name); };
  const fwInput = el('input', { type: 'number', min: 1, max: W, value: W, style: 'width:64px' });
  const fhInput = el('input', { type: 'number', min: 1, max: H, value: H, style: 'width:64px' });

  const frames = () => Math.max(1, Math.floor(W / st.fw) * Math.floor(H / st.fh));
  const origin = () => { const cols = Math.max(1, Math.floor(W / st.fw)); return [(st.frame % cols) * st.fw, Math.floor(st.frame / cols) * st.fh]; };

  const layout = () => {
    st.zoom = Math.max(2, Math.min(24, Math.floor(Math.min(620 / st.fw, 460 / st.fh))));
    view.width = st.fw * st.zoom;
    view.height = st.fh * st.zoom;
    draw();
  };

  const draw = () => {
    const z = st.zoom, [ox, oy] = origin();
    vctx.imageSmoothingEnabled = false;
    for (let y = 0; y < st.fh; y++) for (let x = 0; x < st.fw; x++) {
      vctx.fillStyle = (x + y) & 1 ? '#2a2d34' : '#22252b';
      vctx.fillRect(x * z, y * z, z, z);
    }
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    tmp.getContext('2d').putImageData(data, 0, 0);
    if (st.onion && st.frame > 0) {
      const cols = Math.max(1, Math.floor(W / st.fw));
      const px = ((st.frame - 1) % cols) * st.fw, py = Math.floor((st.frame - 1) / cols) * st.fh;
      vctx.globalAlpha = 0.3;
      vctx.drawImage(tmp, px, py, st.fw, st.fh, 0, 0, st.fw * z, st.fh * z);
      vctx.globalAlpha = 1;
    }
    vctx.drawImage(tmp, ox, oy, st.fw, st.fh, 0, 0, st.fw * z, st.fh * z);
    if (z >= 6) {
      vctx.strokeStyle = 'rgba(255,255,255,0.06)';
      vctx.beginPath();
      for (let x = 0; x <= st.fw; x++) { vctx.moveTo(x * z + 0.5, 0); vctx.lineTo(x * z + 0.5, st.fh * z); }
      for (let y = 0; y <= st.fh; y++) { vctx.moveTo(0, y * z + 0.5); vctx.lineTo(st.fw * z, y * z + 0.5); }
      vctx.stroke();
    }
    frameLabel.textContent = frames() > 1 ? `frame ${st.frame + 1} / ${frames()}` : `${W}×${H}`;
  };

  const setPixel = (x, y, hex) => {
    const [ox, oy] = origin();
    const targets = [[x, y]];
    if (st.mirrorX) targets.push([st.fw - 1 - x, y]);
    if (st.mirrorY) targets.push([x, st.fh - 1 - y]);
    if (st.mirrorX && st.mirrorY) targets.push([st.fw - 1 - x, st.fh - 1 - y]);
    for (const [tx, ty] of targets) {
      if (tx < 0 || ty < 0 || tx >= st.fw || ty >= st.fh) continue;
      const i = ((oy + ty) * W + ox + tx) * 4;
      if (hex === null) { data.data[i + 3] = 0; continue; }
      const n = parseInt(hex.slice(1), 16);
      data.data.set([n >> 16, (n >> 8) & 255, n & 255, 255], i);
    }
  };

  const fill = (x, y, hex) => {
    const [ox, oy] = origin();
    const d = data.data;
    const key = (px, py) => { const i = ((oy + py) * W + ox + px) * 4; return d[i + 3] === 0 ? -1 : (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; };
    const target = key(x, y);
    const seen = new Set([`${x},${y}`]);
    const stack = [[x, y]];
    while (stack.length) {
      const [px, py] = stack.pop();
      setPixel(px, py, hex);
      for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
        if (nx < 0 || ny < 0 || nx >= st.fw || ny >= st.fh || seen.has(`${nx},${ny}`) || key(nx, ny) !== target) continue;
        seen.add(`${nx},${ny}`);
        stack.push([nx, ny]);
      }
    }
  };

  const at = (e) => { const r = view.getBoundingClientRect(); return [Math.floor(((e.clientX - r.left) / r.width) * st.fw), Math.floor(((e.clientY - r.top) / r.height) * st.fh)]; };
  let painting = false;
  const apply = (e) => {
    const [x, y] = at(e);
    if (x < 0 || y < 0 || x >= st.fw || y >= st.fh) return;
    if (st.tool === 'picker') {
      const [ox, oy] = origin();
      const i = ((oy + y) * W + ox + x) * 4;
      if (data.data[i + 3]) { st.color = `#${[0, 1, 2].map((k) => data.data[i + k].toString(16).padStart(2, '0')).join('')}`; picker.value = st.color; setTool('pencil'); }
      return;
    }
    if (st.tool === 'fill') fill(x, y, st.color);
    else setPixel(x, y, st.tool === 'eraser' ? null : st.color);
    draw();
  };
  view.addEventListener('pointerdown', (e) => {
    undo.push(new ImageData(new Uint8ClampedArray(data.data), W, H));
    if (undo.length > 60) undo.shift();
    painting = st.tool === 'pencil' || st.tool === 'eraser';
    try { view.setPointerCapture(e.pointerId); } catch { /* not a real pointer (e.g. a pen lifted already) */ }
    apply(e);
  });
  view.addEventListener('pointermove', (e) => { if (painting) apply(e); });
  view.addEventListener('pointerup', () => { painting = false; });
  view.addEventListener('contextmenu', (e) => e.preventDefault());

  const keys = (e) => {
    if (!document.body.contains(view)) return window.removeEventListener('keydown', keys);
    if (e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (undo.length) { data = undo.pop(); draw(); } }
    else if (k === 'b' || k === 'p') setTool('pencil');
    else if (k === 'e') setTool('eraser');
    else if (k === 'g' || k === 'f') setTool('fill');
    else if (k === 'i') setTool('picker');
    else if (k === 'arrowright') { st.frame = (st.frame + 1) % frames(); draw(); }
    else if (k === 'arrowleft') { st.frame = (st.frame - 1 + frames()) % frames(); draw(); }
  };
  window.addEventListener('keydown', keys);

  const save = async () => {
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    out.getContext('2d').putImageData(data, 0, 0);
    const r = await run('import_image', { data: out.toDataURL('image/png'), name: `${asset.name}_edit` });
    if (r) { toast('Saved as a new picture in the library'); closeModal(); }
  };

  const body = el('div', { class: 'pixel-editor' },
    el('div', { class: 'btn-row' },
      tool('pencil', '✏ Pencil', 'B'), tool('eraser', '⌫ Eraser', 'E'), tool('fill', '🪣 Fill', 'G'), tool('picker', '💧 Pick', 'I'),
      el('label', { class: 'inline' }, el('input', { type: 'checkbox', onchange: (e) => { st.mirrorX = e.target.checked; } }), ' mirror ↔'),
      el('label', { class: 'inline' }, el('input', { type: 'checkbox', onchange: (e) => { st.mirrorY = e.target.checked; } }), ' mirror ↕'),
      picker),
    el('div', { class: 'swatches' }, colors.map((c) => el('span', { style: `background:${c};cursor:pointer;width:20px;height:20px`, title: c, onclick: () => { st.color = c; picker.value = c; setTool('pencil'); } }))),
    el('div', { class: 'pixel-stage' }, view),
    el('div', { class: 'btn-row' },
      el('label', { class: 'inline' }, 'Frame size ', fwInput, ' × ', fhInput),
      el('button', { class: 'tiny', onclick: () => { st.fw = Math.max(1, Math.min(W, Number(fwInput.value))); st.fh = Math.max(1, Math.min(H, Number(fhInput.value))); st.frame = 0; layout(); } }, 'apply'),
      el('button', { onclick: () => { st.frame = (st.frame - 1 + frames()) % frames(); draw(); } }, '◀'),
      frameLabel,
      el('button', { onclick: () => { st.frame = (st.frame + 1) % frames(); draw(); } }, '▶'),
      el('label', { class: 'inline' }, el('input', { type: 'checkbox', onchange: (e) => { st.onion = e.target.checked; draw(); } }), ' onion skin'),
      el('button', { onclick: () => { if (undo.length) { data = undo.pop(); draw(); } } }, '↶ Undo'),
      el('button', { class: 'primary', onclick: save }, 'Save as new picture')),
    el('p', { class: 'hint' }, 'Keys: B pencil, E eraser, G fill, I pick colour, ←/→ frames, Ctrl+Z undo. Set the frame size to edit a sprite sheet frame by frame; onion skin shows the previous frame faintly.'));
  openModal(`Pixel editor · ${asset.name}`, body);
  setTool('pencil');
  layout();
}

function scanColors(img) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < img.data.length && out.length < 64; i += 4) {
    if (!img.data[i + 3]) continue;
    const hex = `#${[0, 1, 2].map((k) => img.data[i + k].toString(16).padStart(2, '0')).join('')}`;
    if (!seen.has(hex)) { seen.add(hex); out.push(hex); }
  }
  return out;
}
