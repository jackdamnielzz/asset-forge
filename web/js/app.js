import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { SceneView } from './viewer.js';
import { LIGHTING_PRESETS, MATERIAL_PRESETS, PATTERNS, STYLES, DEFAULT_EFFECTS, DEFAULT_STYLE_OPTIONS, FONTS } from '/shared/presets.js';
import { ANIMATION_PRESETS } from '/shared/animations.js';
import { PALETTES } from '/shared/palettes.js';
import { imageOp, videoFrames } from './imageops.js';
import { renderTileset } from './tileset.js';

const DEG = Math.PI / 180;
const role = new URLSearchParams(location.search).get('role') === 'renderer' ? 'renderer' : 'viewer';

const state = { scene: null, library: { images: {} }, selected: null, ws: null, lastCamera: null, anim: { playing: false, name: null, start: 0 } };
let view;

// ---- talking to the engine ----------------------------------------------------

async function api(name, args = {}) {
  const res = await fetch(`/api/commands/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forge-Source': 'window' },
    body: JSON.stringify(args),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error);
  return body.result;
}

async function run(name, args) {
  try { return await api(name, args); } catch (err) { toast(err.message, true); }
}

function connect(onScene) {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', role }));
  ws.onclose = () => { setConn(false); setTimeout(() => connect(onScene), 1000); };
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'hello') {
      setConn(true);
      state.library = msg.library;
      view.setLibrary(msg.library);
      if (role === 'viewer') renderLibrary();
      onScene(msg.scene);
    } else if (msg.type === 'scene') {
      onScene(msg.scene);
    } else if (msg.type === 'library') {
      state.library = msg.library;
      view.setLibrary(msg.library);
      if (role === 'viewer') renderLibrary();
    } else if (msg.type === 'log') {
      if (role === 'viewer') addLog(msg.entry);
    } else if (msg.type === 'request') {
      try {
        view.update(msg.scene);
        const handlers = {
          render: (o) => view.renderImage(o),
          export_glb: (o) => view.exportGlb(o),
          render_sprites: (o) => view.renderSprites(o),
          render_tileset: (o) => renderTileset(o),
          image_op: (o) => imageOp(o.op, o.file, o.options),
          video_frames: (o) => videoFrames(o),
        };
        if (!handlers[msg.kind]) throw new Error(`Unknown request ${msg.kind}`);
        const data = await handlers[msg.kind](msg.opts);
        ws.send(JSON.stringify({ type: 'response', reqId: msg.reqId, ok: true, data }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'response', reqId: msg.reqId, ok: false, error: err.message }));
      } finally {
        if (role === 'viewer' && state.scene) view.update(state.scene);
      }
    }
  };
}

function setConn(on) {
  document.getElementById('conn')?.classList.toggle('on', on);
}

// ---- hidden renderer mode -------------------------------------------------------

function startRenderer() {
  document.body.innerHTML = '<canvas id="r"></canvas>';
  view = new SceneView(document.getElementById('r'), { interactive: false });
  view.resize(256, 256);
  connect((scene) => { state.scene = scene; view.update(scene); });
}

// ---- the window -------------------------------------------------------------------

function startWindow() {
  const canvas = document.getElementById('canvas');
  view = new SceneView(canvas);
  const orbit = new OrbitControls(view.camera, canvas);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;

  const gizmo = new TransformControls(view.camera, canvas);
  gizmo.setSize(0.9);
  view.helpers.add(gizmo.getHelper());
  const selBox = new THREE.BoxHelper(undefined, 0xff8a3d);
  selBox.visible = false;
  view.helpers.add(selBox);

  gizmo.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    if (e.value && state.anim.playing) toggleAnimation(false);
    const node = view.nodes.get(state.selected);
    if (!node) return;
    node.locked = e.value;
    if (!e.value) {
      const o = node.obj;
      run('update_object', {
        id: state.selected,
        position: o.position.toArray().map(round),
        rotation: [o.rotation.x, o.rotation.y, o.rotation.z].map((r) => round(r / DEG, 2)),
        scale: o.scale.toArray().map(round),
      });
    }
  });

  new ResizeObserver(() => view.resize(canvas.clientWidth, canvas.clientHeight)).observe(canvas);

  // click to select
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || gizmo.dragging || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), view.camera);
    const hit = ray.intersectObjects(view.content.children, true).find((h) => h.object.visible);
    select(hit?.object.userData.forgeId ?? null);
  });

  function onScene(scene) {
    const first = !state.scene;
    state.scene = scene;
    view.update(scene);
    const camKey = JSON.stringify(scene.camera);
    if (first || camKey !== state.lastCamera) {
      view.camera.position.fromArray(scene.camera.position);
      orbit.target.fromArray(scene.camera.target);
      orbit.update();
      state.lastCamera = camKey;
    }
    if (state.selected && !scene.objects[state.selected]) state.selected = null;
    syncSelection();
    document.getElementById('project-name').textContent = scene.name;
    document.getElementById('lighting-select').value = scene.environment.lighting;
    document.getElementById('style-select').value = scene.environment.style ?? 'realistic';
    updateAnimControls(scene);
    renderOutliner();
    renderProps();
  }

  function select(id) {
    state.selected = id;
    syncSelection();
    renderOutliner();
    renderProps();
  }
  window.forgeSelect = select;

  function syncSelection() {
    const obj = state.selected && view.objectById(state.selected);
    if (obj) { gizmo.attach(obj); selBox.setFromObject(obj); selBox.visible = true; }
    else { gizmo.detach(); selBox.visible = false; }
  }

  function frameSelected() {
    const center = view.frameCamera(view.camera, 'iso', state.selected ?? undefined);
    orbit.target.copy(center);
    orbit.update();
  }
  window.forgeFrame = frameSelected;

  (function loop() {
    requestAnimationFrame(loop);
    const a = state.anim;
    const anim = a.playing && state.scene?.animations?.[a.name];
    if (anim) view.pose(a.name, (((performance.now() - a.start) / 1000) % anim.duration) / anim.duration);
    orbit.update();
    if (selBox.visible) selBox.update();
    view.draw();
  })();

  // toolbar
  document.querySelectorAll('#mode-tools button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  function setMode(mode) {
    gizmo.setMode(mode);
    document.querySelectorAll('#mode-tools button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  }

  document.getElementById('undo-btn').onclick = () => run('undo');
  document.getElementById('redo-btn').onclick = () => run('redo');
  const lightSel = document.getElementById('lighting-select');
  for (const k of Object.keys(LIGHTING_PRESETS)) lightSel.append(new Option(k, k));
  lightSel.onchange = () => run('set_environment', { lighting: lightSel.value });
  const styleSel = document.getElementById('style-select');
  for (const k of Object.keys(STYLES)) styleSel.append(new Option(k, k));
  styleSel.onchange = () => run('set_style', { style: styleSel.value });
  document.getElementById('render-btn').onclick = openRenderModal;
  document.getElementById('game-btn').onclick = openGameModal;
  document.getElementById('ai-btn').onclick = openAiModal;
  document.getElementById('play-btn').onclick = () => toggleAnimation(!state.anim.playing);
  document.getElementById('anim-select').onchange = (e) => { state.anim.name = e.target.value; if (state.anim.playing) toggleAnimation(true); };
  document.getElementById('snap-select').onchange = (e) => {
    const step = Number(e.target.value);
    gizmo.setTranslationSnap(step || null);
    gizmo.setRotationSnap(step ? 15 * DEG : null);
    gizmo.setScaleSnap(step ? 0.1 : null);
  };
  document.getElementById('export-btn').onclick = exportGlb;
  document.getElementById('project-btn').onclick = openProjectModal;
  document.getElementById('modal-close').onclick = closeModal;
  document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  renderShapeButtons();
  renderGenerators();
  setupImport();

  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); run(e.shiftKey ? 'redo' : 'undo'); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); run('redo'); }
    else if ((e.ctrlKey || e.metaKey) && k === 'd' && state.selected) {
      e.preventDefault();
      run('duplicate_object', { id: state.selected }).then((r) => r && select(r.id));
    }
    else if (k === 'w') setMode('translate');
    else if (k === 'e') setMode('rotate');
    else if (k === 'r') setMode('scale');
    else if (k === 'f') frameSelected();
    else if (k === 'escape') select(null);
    else if ((k === 'delete' || k === 'backspace') && state.selected) run('delete_object', { id: state.selected });
  });

  connect(onScene);
}

// ---- left panel ----------------------------------------------------------------

const ICONS = {
  box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8"/>',
  sphere: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3"/>',
  cylinder: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/>',
  cone: '<path d="M12 3L5 18c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5z"/>',
  torus: '<ellipse cx="12" cy="12" rx="9" ry="5"/><ellipse cx="12" cy="11.5" rx="3.5" ry="1.6"/>',
  plane: '<path d="M3 15l6-6h12l-6 6z"/>',
  capsule: '<rect x="7" y="3" width="10" height="18" rx="5"/>',
  lathe: '<path d="M9 3h6M10 3c0 3-4 5-4 10 0 4 2 8 6 8s6-4 6-8c0-5-4-7-4-10"/>',
  extrude: '<path d="M4 18l4-12h8l4 12z M8 6l2-3h8l2 3"/>',
  text: '<path d="M5 6V4h14v2 M12 4v16 M9 20h6"/>',
  rock: '<path d="M3 18l3-7 5-4 6 2 4 6-2 3z"/>',
  group: '<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 2"/>',
};
const SHAPE_LABELS = { lathe: 'spin', extrude: 'outline' };

function renderShapeButtons() {
  const grid = document.getElementById('shape-grid');
  for (const [type, icon] of Object.entries(ICONS)) {
    const b = document.createElement('button');
    b.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg>${SHAPE_LABELS[type] ?? type}`;
    b.title = `Add ${SHAPE_LABELS[type] ?? type}`;
    b.onclick = async () => {
      const args = { type };
      if (type === 'text') {
        const text = prompt('Text:', 'Hello');
        if (!text) return;
        args.params = { text };
      }
      if (type === 'rock') args.params = { seed: Math.floor(Math.random() * 9999) };
      const sel = state.selected && state.scene.objects[state.selected];
      if (sel?.type === 'group') args.parent = sel.id;
      const r = await run('add_object', args);
      if (r) window.forgeSelect(r.id);
    };
    grid.append(b);
  }
}

// One button per generator command (from plugins), so new plugins appear automatically.
async function renderGenerators() {
  const box = document.getElementById('generator-grid');
  const commands = await fetch('/api/commands').then((r) => r.json());
  box.innerHTML = '';
  for (const c of commands.filter((x) => x.category === 'generators')) {
    box.append(el('button', {
      title: c.description,
      onclick: async () => {
        const r = await run(c.name, { seed: Math.floor(Math.random() * 9999) });
        if (r?.id) { window.forgeSelect(r.id); window.forgeFrame(); }
      },
    }, c.title.replace(/^Make /, '')));
  }
}

function renderOutliner() {
  const ul = document.getElementById('outliner');
  ul.innerHTML = '';
  const { objects, order } = state.scene;
  if (!order.length) {
    ul.innerHTML = '<li class="empty">Nothing yet: add a shape above.</li>';
    return;
  }
  const walk = (parent, depth) => {
    for (const id of order.filter((oid) => (objects[oid].parent ?? null) === parent)) {
      const o = objects[id];
      const li = document.createElement('li');
      li.className = (id === state.selected ? 'selected ' : '') + (o.visible === false ? 'hidden-obj' : '');
      li.style.paddingLeft = `${6 + depth * 14}px`;
      li.innerHTML = `<button class="eye" title="Show/hide">${o.visible === false ? '◌' : '●'}</button><span class="label"></span><span class="type">${o.cutterFor ? '✂ cutter' : o.type}</span>`;
      li.querySelector('.label').textContent = o.name;
      li.onclick = () => window.forgeSelect(id);
      li.querySelector('.eye').onclick = (e) => { e.stopPropagation(); run('update_object', { id, visible: o.visible === false }); };
      ul.append(li);
      walk(id, depth + 1);
    }
  };
  walk(null, 0);
}

function renderLibrary() {
  const box = document.getElementById('library');
  box.innerHTML = '';
  for (const img of Object.values(state.library.images)) {
    const t = document.createElement('div');
    t.className = 'thumb';
    t.style.backgroundImage = `url(/library/images/${img.file})`;
    t.title = `${img.name} (${img.width}×${img.height}). Click to place as a flat picture; "3D" turns its outline into a solid shape.`;
    t.onclick = async () => {
      const r = await run('add_object', { type: 'image', name: img.name, params: { assetId: img.id } });
      if (r) window.forgeSelect(r.id);
    };
    const solid = el('button', { class: 'thumb-btn', title: 'Make a 3D cut-out of this picture' }, '3D');
    solid.onclick = async (e) => {
      e.stopPropagation();
      const r = await run('add_object', { type: 'cutout', name: `${img.name}_3d`, params: { assetId: img.id } });
      if (r) window.forgeSelect(r.id);
    };
    t.append(solid);
    box.append(t);
  }
  const models = document.getElementById('model-library');
  models.innerHTML = '';
  const list = Object.values(state.library.models ?? {});
  if (list.length) {
    models.append(el('h3', { style: 'margin-top:12px' }, '3D models'), el('div', {}, list.map((m) => el('span', { class: 'chip', title: m.madeBy?.prompt ?? m.name },
      m.name, el('button', { title: 'Place in scene', onclick: async () => { const r = await run('add_object', { type: 'model', name: m.name, params: { assetId: m.id } }); if (r) window.forgeSelect(r.id); } }, '+')))));
  }
}

function setupImport() {
  const input = document.getElementById('file-input');
  document.getElementById('import-btn').onclick = () => input.click();
  input.onchange = () => { importFiles([...input.files], false); input.value = ''; };
  const overlay = document.getElementById('drop-overlay');
  window.addEventListener('dragover', (e) => { e.preventDefault(); overlay.hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) overlay.hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    overlay.hidden = true;
    importFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')), e.target.closest('#viewport') !== null);
  });
}

async function importFiles(files, addToScene) {
  for (const f of files) {
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    const r = await run('import_image', { data, name: f.name.replace(/\.[^.]+$/, ''), addToScene });
    if (r) toast(`Imported ${f.name}`);
    if (r?.objectId) window.forgeSelect(r.objectId);
  }
}

// ---- right panel -------------------------------------------------------------------

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined) e.append(kid);
  return e;
}

function row(label, ...content) {
  return el('div', { class: 'row' }, el('label', {}, label), el('div', {}, ...content));
}

function vecInput(values, step, onCommit) {
  const inputs = values.map((v) => el('input', { type: 'number', step, value: round(v, 3) }));
  inputs.forEach((inp) => inp.addEventListener('change', () => onCommit(inputs.map((i) => Number(i.value)))));
  return el('div', { class: 'vec' }, inputs);
}

function slider(value, min, max, step, onInput, onCommit) {
  const label = el('span', {}, String(round(value, 2)));
  const s = el('input', { type: 'range', min, max, step, value });
  s.addEventListener('input', () => { label.textContent = String(round(Number(s.value), 2)); onInput?.(Number(s.value)); });
  s.addEventListener('change', () => onCommit(Number(s.value)));
  return el('div', { class: 'slider' }, s, label);
}

function renderProps() {
  const root = document.getElementById('props');
  // Don't rebuild while the user is typing in the panel.
  if (root.contains(document.activeElement) && document.activeElement.matches('input[type=text], input[type=number], textarea')) return;
  root.innerHTML = '';
  const o = state.selected && state.scene.objects[state.selected];
  root.append(o ? objectPanel(o) : environmentPanel());
}

function objectPanel(o) {
  const id = o.id;
  const upd = (patch) => run('update_object', { id, ...patch });
  const mat = (patch) => run('set_material', { id, ...patch });
  const live = (fn) => { const m = view.objectById(id)?.material; if (m) fn(m); };

  const parts = [
    el('h3', {}, `${o.type} · ${id}`),
    el('div', { class: 'prop-group' },
      row('Name', el('input', { type: 'text', value: o.name, onchange: (e) => upd({ name: e.target.value }) })),
      row('Position', vecInput(o.position, 0.1, (v) => upd({ position: v }))),
      row('Rotation°', vecInput(o.rotation, 5, (v) => upd({ rotation: v }))),
      row('Scale', vecInput(o.scale, 0.1, (v) => upd({ scale: v }))),
    ),
  ];

  const paramKeys = Object.keys(o.params).filter((k) => k !== 'assetId');
  if (paramKeys.length) {
    parts.push(el('h3', {}, 'Shape'), el('div', { class: 'prop-group' }, paramKeys.map((k) => paramRow(o, k, upd))));
  }
  if (o.type !== 'group') parts.push(modelingPanel(o));
  parts.push(animationPanel(o));

  if (o.material) {
    const m = o.material;
    const preset = el('select', { onchange: (e) => e.target.value && mat({ preset: e.target.value }) },
      el('option', { value: '' }, 'Apply preset…'),
      Object.keys(MATERIAL_PRESETS).map((p) => el('option', { value: p }, p)));
    const texSel = el('select', { onchange: (e) => mat({ texture: e.target.value || null }) },
      el('option', { value: '' }, 'none'),
      Object.values(state.library.images).map((img) => el('option', { value: img.id, selected: img.id === m.texture }, img.name)));

    parts.push(el('h3', {}, `Material${m.preset ? ` · ${m.preset}` : ''}`), el('div', { class: 'prop-group' },
      row('Preset', preset),
      row('Colour', el('div', { class: 'color-row' },
        el('input', { type: 'color', value: toHex(m.color), oninput: (e) => live((x) => x.color.set(e.target.value)), onchange: (e) => mat({ color: e.target.value }) }),
        el('span', { class: 'muted' }, m.color))),
      row('Metal', slider(m.metalness, 0, 1, 0.01, (v) => live((x) => { x.metalness = v; }), (v) => mat({ metalness: v }))),
      row('Rough', slider(m.roughness, 0, 1, 0.01, (v) => live((x) => { x.roughness = v; }), (v) => mat({ roughness: v }))),
      row('Gloss coat', slider(m.clearcoat ?? 0, 0, 1, 0.01, (v) => live((x) => { x.clearcoat = v; }), (v) => mat({ clearcoat: v }))),
      row('Glass', slider(m.transmission ?? 0, 0, 1, 0.01, (v) => live((x) => { x.transmission = v; }), (v) => mat({ transmission: v }))),
      row('Opacity', slider(m.opacity ?? 1, 0, 1, 0.01, null, (v) => mat({ opacity: v }))),
      row('Glow', el('div', { class: 'color-row' },
        el('input', { type: 'color', value: toHex(m.emissive ?? '#000000'), onchange: (e) => mat({ emissive: e.target.value }) }),
        slider(m.emissiveIntensity ?? 1, 0, 10, 0.1, (v) => live((x) => { x.emissiveIntensity = v; }), (v) => mat({ emissiveIntensity: v })))),
      row('Picture', texSel),
      m.texture ? row('Repeat', vecInputN(m.textureRepeat ?? [1, 1], 0.5, (v) => mat({ textureRepeat: v }))) : null,
      row('Faceted', el('input', { type: 'checkbox', checked: !!m.flatShading, onchange: (e) => mat({ flatShading: e.target.checked }) })),
    ));
    if (o.type !== 'image') parts.push(surfacePanel(m, mat));
  }

  parts.push(el('div', { class: 'btn-row' },
    el('button', { onclick: () => run('duplicate_object', { id }).then((r) => r && window.forgeSelect(r.id)) }, 'Duplicate'),
    el('button', { onclick: () => window.forgeFrame() }, 'Frame'),
    el('button', { class: 'danger', onclick: () => run('delete_object', { id }) }, 'Delete'),
  ));
  return el('div', {}, parts);
}

function paramRow(o, k, upd) {
  const v = o.params[k];
  const set = (val) => upd({ params: { [k]: val } });
  if (k === 'bevel') return row('bevel', slider(v, 0, 0.3, 0.005, null, set));
  if (k === 'font') return row('font', el('select', { onchange: (e) => set(e.target.value) }, FONTS.map((f) => el('option', { value: f, selected: f === v }, f.replace('_', ' ')))));
  if (typeof v === 'string') return row(k, el('input', { type: 'text', value: v, onchange: (e) => set(e.target.value) }));
  if (Array.isArray(v)) {
    // point lists: edit as JSON text, e.g. [[0,0],[0.3,0.5]]
    return row(k, el('textarea', {
      spellcheck: 'false',
      onchange: (e) => { try { set(JSON.parse(e.target.value)); } catch { toast(`${k}: not valid JSON`, true); } },
    }, JSON.stringify(v)));
  }
  return row(k, el('input', { type: 'number', step: /segments|detail|seed/i.test(k) ? 1 : 0.05, value: round(v, 3), onchange: (e) => set(Number(e.target.value)) }));
}

// Mirror, repeat and cut/combine.
function modelingPanel(o) {
  const { objects } = state.scene;
  const id = o.id;
  const items = [];
  if (o.cutterFor && objects[o.cutterFor]) {
    items.push(el('p', { class: 'hint' }, `This shape is used to cut "${objects[o.cutterFor].name}". It is hidden; show it to move it, then hide it again.`),
      el('div', { class: 'btn-row' },
        el('button', { onclick: () => run('update_object', { id, visible: o.visible === false }) }, o.visible === false ? 'Show cutter' : 'Hide cutter'),
        el('button', { onclick: () => run('uncut_object', { target: o.cutterFor, cutter: id }) }, 'Stop cutting')));
  }
  if (o.booleans?.length) {
    items.push(row('Cut by', el('div', {}, o.booleans.map((b) => el('span', { class: 'chip' },
      `${b.op} ${objects[b.id]?.name ?? b.id}`,
      el('button', { title: 'Remove', onclick: () => run('uncut_object', { target: id, cutter: b.id }) }, '✕'))))));
  }
  const others = state.scene.order.filter((oid) => oid !== id && objects[oid].type !== 'group');
  const cutterSel = el('select', {}, el('option', { value: '' }, 'choose shape…'), others.map((oid) => el('option', { value: oid }, objects[oid].name)));
  const opSel = el('select', {}, ['subtract', 'union', 'intersect'].map((op) => el('option', { value: op }, op)));
  items.push(
    row('Cut with', el('div', { class: 'color-row' }, cutterSel, opSel,
      el('button', { class: 'tiny', onclick: () => cutterSel.value && run('cut_object', { target: id, cutter: cutterSel.value, op: opSel.value }) }, 'apply'))),
    el('div', { class: 'btn-row' },
      el('button', { title: 'Mirrored copy on the other side (left/right)', onclick: () => run('mirror_object', { id }).then((r) => r && window.forgeSelect(r.id)) }, '⇋ Mirror'),
      el('button', {
        title: 'Copies in a row',
        onclick: () => {
          const n = Number(prompt('How many extra copies in a row?', '4'));
          if (n > 0) run('repeat_object', { id, count: n, mode: 'line', offset: [objectWidth(o) * 1.15, 0, 0] });
        },
      }, '⋯ Repeat'),
      el('button', {
        title: 'Copies in a circle around the centre (place the object away from the centre first)',
        onclick: () => {
          const n = Number(prompt('How many extra copies around the circle?', '7'));
          if (n > 0) run('repeat_object', { id, count: n, mode: 'circle' });
        },
      }, '◌ Circle')),
  );
  return el('div', {}, el('h3', {}, 'Modelling'), el('div', { class: 'prop-group' }, items));
}

// ---- animation ---------------------------------------------------------------------

function animationPanel(o) {
  const anims = state.scene.animations ?? {};
  const mine = Object.entries(anims).flatMap(([name, a]) => a.tracks
    .map((t, i) => ({ name, t, i }))
    .filter(({ t }) => t.target === o.id));
  const presetSel = el('select', {}, Object.entries(ANIMATION_PRESETS).map(([k, v]) => el('option', { value: k, title: v.description }, k)));
  const nameInput = el('input', { type: 'text', value: state.anim.name ?? 'idle', title: 'Animation name (idle, open, hit...)' });
  return el('div', {},
    el('h3', {}, 'Animation'),
    el('div', { class: 'prop-group' },
      mine.length ? row('Moves', el('div', {}, mine.map(({ name, t }) => el('span', { class: 'chip' }, `${name}: ${t.preset ?? 'keys'}`,
        el('button', { title: 'Remove', onclick: () => run('remove_animation', { animation: name, id: o.id }) }, '✕'))))) : null,
      row('Add', el('div', { class: 'color-row' }, presetSel,
        el('button', {
          class: 'tiny',
          onclick: async () => {
            const animation = nameInput.value.trim() || 'idle';
            if (await run('animate_object', { id: o.id, preset: presetSel.value, animation })) {
              state.anim.name = animation;
              toggleAnimation(true);
            }
          },
        }, 'add'))),
      row('Into', nameInput),
      o.type !== 'group' && o.parent ? el('p', { class: 'hint' }, 'Tip: to move a whole thing (like a chest lid) select its group in the object list.') : null,
    ));
}

function updateAnimControls(scene) {
  const names = Object.keys(scene.animations ?? {});
  document.getElementById('anim-controls').hidden = !names.length;
  const sel = document.getElementById('anim-select');
  if (sel.dataset.names !== names.join(',')) {
    sel.innerHTML = '';
    for (const n of names) sel.append(new Option(n, n));
    sel.dataset.names = names.join(',');
  }
  if (!names.includes(state.anim.name)) state.anim.name = names[0] ?? null;
  if (!names.length && state.anim.playing) toggleAnimation(false);
  sel.value = state.anim.name ?? '';
}

function toggleAnimation(play) {
  state.anim.playing = play && !!state.anim.name;
  state.anim.start = performance.now();
  if (!state.anim.playing) view.resetPose();
  document.getElementById('play-btn').textContent = state.anim.playing ? '⏸' : '▶';
}

function objectWidth(o) {
  const p = o.params;
  const w = p.width ?? (p.radius ? p.radius * 2 : p.radiusBottom ? p.radiusBottom * 2 : 1);
  return w * Math.abs(o.scale[0]);
}

// Generated pattern + age controls.
function surfacePanel(m, mat) {
  const p = m.pattern;
  const typeSel = el('select', { onchange: (e) => mat({ pattern: e.target.value ? { type: e.target.value } : null }) },
    el('option', { value: '' }, 'none'),
    Object.keys(PATTERNS).filter((k) => k !== 'solid').map((k) => el('option', { value: k, selected: p?.type === k }, k.replace('_', ' '))));
  const rows = [row('Pattern', typeSel)];
  if (p) {
    rows.push(
      el('p', { class: 'hint' }, PATTERNS[p.type]?.description ?? ''),
      row('Size (m)', el('input', { type: 'number', step: 0.1, min: 0.02, value: p.scale, onchange: (e) => mat({ pattern: { scale: Number(e.target.value) } }) })),
      row('Variation', slider(p.variation, 0, 1, 0.05, null, (v) => mat({ pattern: { variation: v } }))),
      row('Relief', slider(p.bump, 0, 4, 0.1, null, (v) => mat({ pattern: { bump: v } }))),
      row('Variant', el('div', { class: 'color-row' },
        el('span', { class: 'muted' }, `#${p.seed}`),
        el('button', { class: 'tiny', title: 'Try another variation', onclick: () => mat({ pattern: { seed: Math.floor(Math.random() * 9999) } }) }, '🎲 new'),
        el('label', { class: 'inline' }, el('input', { type: 'checkbox', checked: p.angle === 90, onchange: (e) => mat({ pattern: { angle: e.target.checked ? 90 : 0 } }) }), ' turn 90°'))),
    );
    if (PATTERNS[p.type]?.kind === 'absolute') {
      const cols = p.colors ?? PATTERNS[p.type].colors;
      rows.push(row('Colours', el('div', { class: 'color-row' }, cols.map((c, i) => el('input', {
        type: 'color', value: toHex(c), onchange: (e) => { const next = [...cols]; next[i] = e.target.value; mat({ pattern: { colors: next } }); },
      })))));
    }
  }
  rows.push(row('Age', slider(m.wear ?? 0, 0, 1, 0.05, null, (v) => mat({ wear: v }))));
  return el('div', {}, el('h3', {}, 'Surface'), el('div', { class: 'prop-group' }, rows));
}

function vecInputN(values, step, onCommit) {
  const inputs = values.map((v) => el('input', { type: 'number', step, value: v }));
  inputs.forEach((inp) => inp.addEventListener('change', () => onCommit(inputs.map((i) => Number(i.value)))));
  return el('div', { class: 'vec', style: `grid-template-columns: repeat(${values.length}, 1fr)` }, inputs);
}

function environmentPanel() {
  const env = state.scene.environment;
  const preset = LIGHTING_PRESETS[env.lighting];
  const setEnv = (patch) => run('set_environment', patch);
  return el('div', {},
    el('h3', {}, 'Scene'),
    el('div', { class: 'prop-group' },
      row('Lighting', el('select', { onchange: (e) => setEnv({ lighting: e.target.value }) },
        Object.keys(LIGHTING_PRESETS).map((k) => el('option', { value: k, selected: k === env.lighting }, k)))),
      el('p', { class: 'hint' }, preset?.description ?? ''),
      row('Brightness', slider(env.exposure ?? 1, 0.2, 3, 0.05, (v) => { view.renderer.toneMappingExposure = v * preset.exposure; }, (v) => setEnv({ exposure: v }))),
      row('Background', el('div', { class: 'color-row' },
        el('input', { type: 'color', value: toHex(env.background && env.background !== 'transparent' ? env.background : preset.background), onchange: (e) => setEnv({ background: e.target.value }) }),
        el('button', { class: 'tiny', onclick: () => setEnv({ background: null }) }, 'reset'),
        el('button', { class: 'tiny', onclick: () => setEnv({ background: 'transparent' }) }, 'none'))),
      row('Ground', el('input', { type: 'checkbox', checked: env.ground !== false, onchange: (e) => setEnv({ ground: e.target.checked }) })),
    ),
    stylePanel(env),
    el('h3', {}, 'Connect an AI'),
    el('p', { class: 'big-hint' },
      'Everything you can click here, an AI can do too. In Claude Code, inside the Asset Forge folder, the tool connects automatically. ',
      'Other AIs and scripts can use the HTTP API at ', el('code', {}, `${location.origin}/api/commands`), '.'),
    el('p', { class: 'hint' }, 'Select an object to edit it. Drop images anywhere to import them.'),
  );
}

function stylePanel(env) {
  const style = env.style ?? 'realistic';
  const so = { ...DEFAULT_STYLE_OPTIONS, ...env.styleOptions };
  const fx = { ...DEFAULT_EFFECTS, ...env.effects };
  const setStyle = (patch) => run('set_style', patch);
  const setFx = (patch) => run('set_effects', patch);
  return el('div', {},
    el('h3', {}, 'Style'),
    el('div', { class: 'prop-group' },
      row('Look', el('select', { onchange: (e) => setStyle({ style: e.target.value }) },
        Object.keys(STYLES).map((k) => el('option', { value: k, selected: k === style }, k)))),
      el('p', { class: 'hint' }, STYLES[style]),
      style === 'toon' ? [
        row('Outline', slider(so.outlineWidth, 0, 5, 0.1, null, (v) => setStyle({ outlineWidth: v }))),
        row('Bands', slider(so.toonSteps, 2, 6, 1, null, (v) => setStyle({ toonSteps: v }))),
      ] : null,
    ),
    el('h3', {}, 'Effects'),
    el('div', { class: 'prop-group' },
      row('Soft shadows', el('div', { class: 'color-row' },
        el('input', { type: 'checkbox', checked: fx.ao, onchange: (e) => setFx({ ao: e.target.checked }) }),
        slider(fx.aoStrength, 0, 3, 0.1, null, (v) => setFx({ aoStrength: v })))),
      row('Glow', el('div', { class: 'color-row' },
        el('input', { type: 'checkbox', checked: fx.bloom, onchange: (e) => setFx({ bloom: e.target.checked }) }),
        slider(fx.bloomStrength, 0, 3, 0.1, null, (v) => setFx({ bloomStrength: v })))),
      style === 'toon' ? el('p', { class: 'hint' }, 'Soft shadows are switched off in toon style.') : null,
    ),
  );
}

// ---- modals ------------------------------------------------------------------

function openModal(title, body) {
  document.getElementById('modal-title').textContent = title;
  const b = document.getElementById('modal-body');
  b.innerHTML = '';
  b.append(body);
  document.getElementById('modal').hidden = false;
}

function closeModal() {
  document.getElementById('modal').hidden = true;
}

function openRenderModal() {
  const viewSel = el('select', {}, ['iso', 'iso_back', 'front', 'back', 'left', 'right', 'top'].map((v) => el('option', { value: v }, v)));
  const sizeSel = el('select', {}, [512, 1024, 2048].map((s) => el('option', { value: s, selected: s === 1024 }, `${s}×${s}`)));
  const transparent = el('input', { type: 'checkbox' });
  const out = el('div', {}, el('p', { class: 'muted' }, 'Choose an angle and press Render.'));
  const go = async () => {
    out.innerHTML = '<p class="muted">Rendering…</p>';
    const size = Number(sizeSel.value);
    const args = { view: viewSel.value, width: size, height: size };
    if (transparent.checked) Object.assign(args, { background: 'transparent', ground: false });
    const r = await run('render_preview', args);
    if (!r) { out.innerHTML = ''; return; }
    const src = `data:image/png;base64,${r.image}`;
    out.innerHTML = '';
    out.append(el('img', { src }), el('div', { class: 'btn-row' },
      el('a', { href: src, download: `${state.scene.name}-${viewSel.value}.png` }, el('button', { class: 'primary' }, 'Download PNG'))));
  };
  openModal('Render picture', el('div', {},
    el('div', { class: 'btn-row' }, el('label', { class: 'inline' }, 'Angle ', viewSel), el('label', { class: 'inline' }, 'Size ', sizeSel),
      el('label', { class: 'inline' }, transparent, ' Transparent'), el('button', { class: 'primary', onclick: go }, 'Render')),
    out));
  go();
}

// A window with tabs; remembers the last tab per window.
function tabbedModal(title, tabs, key) {
  const bar = el('div', { class: 'tabs' });
  const content = el('div', {});
  const show = (name) => {
    for (const b of bar.children) b.classList.toggle('active', b.textContent === name);
    content.innerHTML = '';
    content.append(tabs[name]());
    try { localStorage.setItem(key, name); } catch {}
  };
  for (const name of Object.keys(tabs)) bar.append(el('button', { onclick: () => show(name) }, name));
  openModal(title, el('div', {}, bar, content));
  let last = Object.keys(tabs)[0];
  try { last = localStorage.getItem(key) || last; } catch {}
  show(tabs[last] ? last : Object.keys(tabs)[0]);
}

// Icons, sprite sheets, tilesets and Godot export in one window.
function openGameModal() {
  tabbedModal('Game assets', { Icons: iconsTab, Sprites: spritesTab, Tiles: tilesTab, Godot: godotTab }, 'forge.gameTab');
}

function godotProject() {
  try { return localStorage.getItem('forge.godotProject') ?? ''; } catch { return ''; }
}

const paletteSelect = (value = '') => sel([['', 'automatic'], ...Object.entries(PALETTES).map(([k, p]) => [k, `${k} (${p.colors.length})`])], value);
const imageSelect = (value) => sel([['', 'none'], ...Object.values(state.library.images).map((i) => [i.id, i.name])], value);

function tilesTab() {
  const types = Object.keys(PATTERNS).filter((k) => !['solid'].includes(k));
  const base = sel(types.map((t) => [t]), 'dirt');
  const overlay = sel(types.map((t) => [t]), 'grass');
  const size = sel([[8], [16], [24], [32], [48], [64]], 16);
  const palette = paletteSelect();
  const edge = el('input', { type: 'checkbox', checked: true });
  const rough = el('input', { type: 'number', min: 0, max: 1, step: 0.05, value: 0.35 });
  const name = el('input', { type: 'text', value: 'grass_dirt' });
  const toGodot = el('input', { type: 'checkbox', checked: !!godotProject() });
  const out = el('div', {});
  const go = async () => {
    out.innerHTML = '<p class="muted">Making tiles…</p>';
    const args = { filename: name.value || 'tiles', base: { type: base.value }, overlay: { type: overlay.value }, tileSize: Number(size.value), edge: edge.checked, roughness: Number(rough.value), seed: Math.floor(Math.random() * 9999) };
    if (palette.value) args.palette = palette.value;
    if (toGodot.checked && godotProject()) args.project = godotProject();
    const r = await run('make_tileset', args);
    out.innerHTML = '';
    if (!r) return;
    out.append(el('img', { src: `data:image/png;base64,${r.image}`, class: 'pixelated', style: `width:${r.tileSize * 4 * Math.max(2, Math.floor(256 / (r.tileSize * 4)))}px` }),
      el('p', { class: 'hint' }, `16 tiles of ${r.tileSize}px. ${r.files.tileset ? `Godot TileSet: ${r.files.tileset} (paint with the terrain tool).` : `Saved as ${r.files.atlas}.`}`));
  };
  return el('div', {},
    el('p', { class: 'hint' }, 'A seamless pixel tileset where one ground blends into another, with every corner combination, so maps paint without seams. Press again for a new variation.'),
    el('div', { class: 'form-grid' }, field('Ground', base), field('Blends into', overlay), field('Tile size', size), field('Palette', palette),
      field('Wobbly border (0-1)', rough), field('File name', name), el('label', { class: 'check' }, edge, ' Dark rim'),
      el('label', { class: 'check', title: godotProject() ? godotProject() : 'Set a Godot project in the Godot tab first' }, toGodot, ' Send to Godot project')),
    el('button', { class: 'primary', onclick: go }, 'Make tileset'), out);
}

// ---- AI services ----------------------------------------------------------------

function openAiModal() {
  tabbedModal('AI and picture tools', { Image: aiImageTab, Video: aiVideoTab, '3D model': ai3dTab, 'Picture tools': pictureToolsTab, Services: aiServicesTab }, 'forge.aiTab');
}

async function aiServices() {
  return (await run('list_ai_services')) ?? {};
}

const costNote = () => el('p', { class: 'hint' }, 'These services run on your own account and cost a little money per use. Connect them under Services.');

function serviceSelect(services, cap) {
  const ids = Object.keys(services).filter((k) => services[k].can.includes(cap));
  return sel(ids.map((k) => [k, `${services[k].name}${services[k].connected ? '' : ' — not connected'}`]), ids.find((k) => services[k].connected) ?? ids[0]);
}

function modelInput(services, serviceSel, cap) {
  const list = el('datalist', { id: `models-${cap}` });
  const input = el('input', { type: 'text', list: `models-${cap}`, placeholder: 'default' });
  const fill = () => { list.innerHTML = ''; for (const m of services[serviceSel.value]?.models?.[cap] ?? []) list.append(el('option', { value: m })); input.value = ''; };
  serviceSel.addEventListener('change', fill);
  fill();
  return el('span', {}, input, list);
}

function asyncTab(build) {
  const box = el('div', {}, el('p', { class: 'muted' }, 'Loading…'));
  aiServices().then((services) => { box.innerHTML = ''; box.append(build(services)); });
  return box;
}

function aiImageTab() {
  return asyncTab((services) => {
    const service = serviceSelect(services, 'image');
    const model = modelInput(services, service, 'image');
    const prompt = el('textarea', { placeholder: 'e.g. a mossy stone wall texture, top-down, game art' });
    const size = el('input', { type: 'text', placeholder: '1024x1024 or 1:1' });
    const transparent = el('input', { type: 'checkbox' });
    const ref = imageSelect('');
    const useRender = el('input', { type: 'checkbox' });
    const out = el('div', {});
    const go = async () => {
      out.innerHTML = '<p class="muted">The AI is painting… this can take up to a minute.</p>';
      const args = { service: service.value, prompt: prompt.value, transparent: transparent.checked };
      if (model.firstChild.value) args.model = model.firstChild.value;
      if (size.value) args.size = size.value;
      if (ref.value) args.references = [ref.value];
      if (useRender.checked) args.referenceRender = state.selected ? { target: state.selected } : {};
      const r = await run('generate_image', args);
      out.innerHTML = '';
      if (r) out.append(el('img', { src: `data:${r.mime};base64,${r.image}`, style: 'max-height:340px' }), imageActions(r.assetId));
    };
    return el('div', {}, costNote(),
      el('div', { class: 'form-grid' }, field('Service', service), field('Model', model), field('Size', size), field('Follow this picture', ref),
        el('label', { class: 'check' }, transparent, ' See-through background'),
        el('label', { class: 'check', title: 'Renders the selected object (or the scene) and lets the AI repaint it' }, useRender, ' Repaint my 3D render')),
      field('What should it make?', prompt), el('div', { style: 'height:8px' }),
      el('button', { class: 'primary', onclick: go }, '✨ Generate'), out);
  });
}

// What to do with a picture once it is in the library.
function imageActions(assetId) {
  const after = async (p) => { const r = await p; if (r?.id || r?.objectId) window.forgeSelect(r.id ?? r.objectId); if (r) toast('Done'); };
  return el('div', { class: 'btn-row' },
    el('button', { onclick: () => after(run('add_object', { type: 'image', params: { assetId } })) }, 'Place flat'),
    el('button', { onclick: () => after(run('add_object', { type: 'cutout', params: { assetId } })) }, 'Make 3D cut-out'),
    el('button', { disabled: !state.selected, onclick: () => after(run('set_material', { id: state.selected, texture: assetId })) }, 'Paint on selected'),
    el('button', { onclick: () => after(run('pixelate_image', { assetId })) }, 'Pixel art version'),
    el('button', { onclick: () => after(run('make_seamless', { assetId })) }, 'Seamless texture'),
    el('button', { onclick: () => after(run('remove_background', { assetId })) }, 'Remove background'));
}

function aiVideoTab() {
  return asyncTab((services) => {
    const service = serviceSelect(services, 'video');
    const model = modelInput(services, service, 'video');
    const prompt = el('textarea', { placeholder: 'e.g. a flickering campfire, side view, plain dark background' });
    const ref = imageSelect('');
    const duration = el('input', { type: 'number', min: 1, max: 20, value: 5 });
    const aspect = el('input', { type: 'text', value: '1:1' });
    const out = el('div', {});
    const go = async () => {
      out.innerHTML = '<p class="muted">Making the video… this usually takes 1–5 minutes. You can keep working; progress shows in the bottom bar.</p>';
      const args = { service: service.value, prompt: prompt.value, duration: Number(duration.value), aspect: aspect.value };
      if (model.firstChild.value) args.model = model.firstChild.value;
      if (ref.value) args.image = ref.value;
      const r = await run('generate_video', args);
      out.innerHTML = '';
      if (!r) return;
      const frames = el('input', { type: 'number', min: 2, max: 64, value: 8 });
      const fsize = el('input', { type: 'number', min: 8, max: 512, value: 64 });
      const pixel = el('input', { type: 'checkbox', checked: true });
      const cut = el('input', { type: 'checkbox', checked: true });
      const sheet = el('div', {});
      out.append(el('video', { src: r.url, controls: true, loop: true, autoplay: true, muted: true, style: 'max-width:100%;max-height:300px' }),
        el('h3', {}, 'Turn into a sprite animation'),
        el('div', { class: 'form-grid' }, field('Frames', frames), field('Frame size', fsize), el('label', { class: 'check' }, pixel, ' Pixel art'), el('label', { class: 'check' }, cut, ' Remove background')),
        el('button', {
          onclick: async () => {
            const s = await run('video_to_sprites', { videoId: r.videoId, filename: `video_${Date.now()}`, frames: Number(frames.value), frameSize: Number(fsize.value), pixelArt: pixel.checked, removeBackground: cut.checked });
            sheet.innerHTML = '';
            if (s) sheet.append(el('img', { src: `data:image/png;base64,${s.image}`, class: 'pixelated' }), el('p', { class: 'hint' }, `Saved as ${s.path}`));
          },
        }, 'Make sprite sheet'), sheet);
    };
    return el('div', {}, costNote(),
      el('div', { class: 'form-grid' }, field('Service', service), field('Model', model), field('Start from picture', ref), field('Seconds', duration), field('Aspect ratio', aspect)),
      field('What should happen?', prompt), el('div', { style: 'height:8px' }),
      el('button', { class: 'primary', onclick: go }, '✨ Make video'), out);
  });
}

function ai3dTab() {
  return asyncTab((services) => {
    const service = serviceSelect(services, '3d');
    const model = modelInput(services, service, '3d');
    const ref = imageSelect('');
    const prompt = el('textarea', { placeholder: 'Only for text-to-3D models, e.g. a wooden treasure chest with iron bands' });
    const size = el('input', { type: 'number', min: 0, step: 0.1, value: 1 });
    const out = el('div', {});
    const go = async () => {
      out.innerHTML = '<p class="muted">Building the 3D model… this takes a few minutes.</p>';
      const args = { service: service.value, size: Number(size.value) };
      if (model.firstChild.value) args.model = model.firstChild.value;
      if (ref.value) args.image = ref.value;
      if (prompt.value) args.prompt = prompt.value;
      const r = await run('generate_3d', args);
      out.innerHTML = '';
      if (r) { out.append(el('p', {}, 'The model is in your scene and in the library (3D models).')); window.forgeSelect(r.objectId); window.forgeFrame(); }
    };
    return el('div', {}, costNote(),
      el('p', { class: 'hint' }, 'Best results: a picture of one object on a plain background (make one in the Image tab, with a see-through background).'),
      el('div', { class: 'form-grid' }, field('Service', service), field('Model', model), field('From picture', ref), field('Height in scene (m)', size)),
      field('Or describe it (text-to-3D models)', prompt), el('div', { style: 'height:8px' }),
      el('button', { class: 'primary', onclick: go }, '✨ Make 3D model'), out);
  });
}

function pictureToolsTab() {
  const pick = imageSelect(Object.keys(state.library.images)[0] ?? '');
  const size = el('input', { type: 'number', min: 8, max: 512, value: 64 });
  const colors = el('input', { type: 'number', min: 2, max: 256, value: 16 });
  const palette = paletteSelect();
  const out = el('div', {});
  const show = (r) => { out.innerHTML = ''; if (r) out.append(el('img', { src: `data:image/png;base64,${r.image}`, class: 'pixelated', style: 'max-height:300px' }), imageActions(r.assetId)); };
  const need = (fn) => async () => { if (!pick.value) return toast('Import or choose a picture first', true); out.innerHTML = '<p class="muted">Working…</p>'; show(await fn()); };
  return el('div', {},
    el('p', { class: 'hint' }, 'Free tools that work on pictures in your library (photos, drawings, AI images). Each makes a new picture, the original stays.'),
    el('div', { class: 'form-grid' }, field('Picture', pick), field('Pixel art size', size), field('Colours', colors), field('Palette', palette)),
    el('div', { class: 'btn-row' },
      el('button', { class: 'primary', onclick: need(() => run('pixelate_image', { assetId: pick.value, size: Number(size.value), colors: Number(colors.value), ...(palette.value ? { palette: palette.value } : {}), outline: '#16171b' })) }, 'Picture → pixel art'),
      el('button', { onclick: need(() => run('remove_background', { assetId: pick.value })) }, 'Remove background'),
      el('button', { onclick: need(() => run('make_seamless', { assetId: pick.value })) }, 'Photo → seamless texture')),
    out);
}

function aiServicesTab() {
  return asyncTab((services) => el('div', {},
    el('p', { class: 'hint' }, 'Paste an API key to connect a service. Keys are stored only on this computer (workspace/secrets.json) and are never shown again or sent anywhere except to that service.'),
    Object.entries(services).map(([id, s]) => {
      const key = el('input', { type: 'password', placeholder: s.connected ? '•••••••• (connected; paste to replace)' : 'API key', autocomplete: 'off' });
      const url = el('input', { type: 'text', placeholder: 'default address', value: s.customUrl ?? '' });
      return el('div', { class: 'prop-group' },
        el('h3', {}, `${s.connected ? '🟢' : '⚪'} ${s.name}`),
        el('p', { class: 'hint' }, `Can make: ${s.can.join(', ')}. `, el('a', { href: s.signup, target: '_blank', rel: 'noopener' }, 'Get a key')),
        el('div', { class: 'form-grid' }, field('API key', key), field('Server address (optional)', url)),
        el('div', { class: 'btn-row' },
          el('button', { onclick: async () => { if (await run('connect_ai_service', { service: id, ...(key.value ? { key: key.value } : {}), baseUrl: url.value })) { toast('Saved'); openAiModal(); } } }, 'Save'),
          s.connected ? el('button', { class: 'danger', onclick: async () => { if (await run('connect_ai_service', { service: id, key: '' })) openAiModal(); } }, 'Disconnect') : null));
    })));
}

const exportUrl = (file) => `/exports/${file.split(/[\\/]exports[\\/]/)[1].replace(/\\/g, '/')}?t=${Date.now()}`;
const sel = (options, value) => el('select', {}, options.map(([v, label]) => el('option', { value: v, selected: String(v) === String(value) }, label ?? v)));
const field = (label, input) => el('label', {}, label, input);
const selectedObj = () => (state.selected ? state.scene.objects[state.selected] : null);

function iconsTab() {
  const size = sel([[64], [128], [256], [512]], 256);
  const view = sel([['iso'], ['front'], ['iso_back'], ['left'], ['right'], ['top']], 'iso');
  const useOutline = el('input', { type: 'checkbox', checked: true });
  const outline = el('input', { type: 'color', value: '#1b1c20' });
  const scope = sel([['all', 'every object in the scene'], ['selected', 'only the selected object']], selectedObj() ? 'selected' : 'all');
  const out = el('div', { class: 'icon-grid' });
  const go = async () => {
    out.innerHTML = '<p class="muted">Rendering icons…</p>';
    const args = { size: Number(size.value), view: view.value, outline: useOutline.checked ? outline.value : null };
    if (scope.value === 'selected' && state.selected) args.ids = [state.selected];
    const r = await run('make_icons', args);
    out.innerHTML = '';
    if (r) for (const f of r.files) out.append(el('a', { href: exportUrl(f), target: '_blank', title: f }, el('img', { src: exportUrl(f) })));
  };
  return el('div', {},
    el('p', { class: 'hint' }, 'One square picture per object, all with the same angle and light, on a see-through background. Saved in workspace/exports/icons.'),
    el('div', { class: 'form-grid' }, field('Size (pixels)', size), field('Angle', view), field('Which objects', scope),
      el('label', { class: 'check' }, useOutline, ' Outline ', outline)),
    el('button', { class: 'primary', onclick: go }, 'Make icons'), out);
}

function spritesTab() {
  const o = selectedObj();
  const anims = Object.keys(state.scene.animations ?? {});
  const dirs = sel([[1, '1 (front only)'], [4, '4 directions'], [8, '8 directions']], 8);
  const size = sel([[16], [24], [32], [48], [64], [96], [128], [256]], 64);
  const elev = el('input', { type: 'number', min: 0, max: 90, step: 5, value: 30 });
  const turn = el('input', { type: 'number', step: 45, value: 0 });
  const ppm = el('input', { type: 'number', min: 0, step: 4, value: 0, title: '0 = fit the object in the frame' });
  const pixel = el('input', { type: 'checkbox', checked: true });
  const palette = paletteSelect();
  const colors = el('input', { type: 'number', min: 2, max: 256, value: 24 });
  const dither = el('input', { type: 'number', min: 0, max: 1, step: 0.1, value: 0 });
  const outlineStyle = sel([['solid', 'one colour'], ['selout', 'darker shade (selout)'], ['none', 'no outline']], 'selout');
  const outline = el('input', { type: 'color', value: '#16171b' });
  const normal = el('input', { type: 'checkbox' });
  const glow = el('input', { type: 'checkbox' });
  const animBoxes = anims.map((a) => el('input', { type: 'checkbox', value: a, checked: a === state.anim.name }));
  const frames = el('input', { type: 'number', min: 1, max: 64, value: 8 });
  const name = el('input', { type: 'text', value: o?.name ?? state.scene.name });
  const toGodot = el('input', { type: 'checkbox', checked: false });
  const out = el('div', {});
  const go = async () => {
    out.innerHTML = '<p class="muted">Rendering sprite sheet…</p>';
    const chosen = animBoxes.filter((b) => b.checked).map((b) => b.value);
    const args = {
      filename: name.value || 'sprites', directions: Number(dirs.value), frameSize: Number(size.value), elevation: Number(elev.value),
      azimuthOffset: Number(turn.value), pixelArt: pixel.checked, colors: Number(colors.value), dither: Number(dither.value),
      outlineStyle: outlineStyle.value === 'none' ? 'solid' : outlineStyle.value, outline: outlineStyle.value === 'none' ? null : outline.value,
      maps: [normal.checked && 'normal', glow.checked && 'emission'].filter(Boolean),
    };
    if (Number(ppm.value) > 0) args.pixelsPerMetre = Number(ppm.value);
    if (palette.value) args.palette = palette.value;
    if (o) args.target = o.id;
    if (chosen.length) Object.assign(args, { animations: chosen, frames: Number(frames.value) });
    if (toGodot.checked && godotProject()) args.project = godotProject();
    const r = await run('render_sprites', args);
    out.innerHTML = '';
    if (!r) return;
    const src = `data:image/png;base64,${r.image}`;
    const zoom = Math.max(1, Math.min(4, Math.floor(760 / (r.columns * r.frameSize))));
    out.append(
      el('img', { src, class: 'pixelated', style: `width:${r.columns * r.frameSize * zoom}px` }),
      el('p', { class: 'hint' }, `${r.rows} rows (${r.rowNames.join(', ')}) × ${r.columns} frames of ${r.frameSize}px${r.fps ? `, ${r.fps} fps` : ''}. Files: ${Object.values(r.files).join(', ')}`),
      el('a', { href: src, download: `${args.filename}.png` }, el('button', {}, 'Download PNG')));
  };
  return el('div', {},
    el('p', { class: 'hint' }, `Turns ${o ? `"${o.name}"` : 'the whole scene'} into a 2D sprite sheet: rows are directions (per animation), columns are frames. Select an object first to render only that.`),
    el('div', { class: 'form-grid' },
      field('Directions', dirs), field('Frame size (pixels)', size), field('Camera height (0 side, 30 iso, 60+ top-down)', elev),
      field('Turn camera first (°, 45 = diamond iso)', turn), field('Pixels per metre (0 = fit)', ppm), field('File name', name),
      el('label', { class: 'check' }, pixel, ' Pixel art'), field('Palette', palette), field('Colours (automatic palette)', colors),
      field('Dithering (0-1)', dither), field('Outline', outlineStyle), el('label', { class: 'check' }, ' Outline colour ', outline),
      el('label', { class: 'check', title: 'For Godot 2D lights' }, normal, ' Normal map'), el('label', { class: 'check', title: 'Glowing parts only' }, glow, ' Glow map'),
      field('Frames per direction', frames),
      el('label', { class: 'check', title: godotProject() || 'Set a Godot project in the Godot tab first' }, toGodot, ' Send to Godot (+ SpriteFrames)')),
    anims.length ? el('div', { class: 'prop-group' }, el('h3', {}, 'Animations to include'), el('div', { class: 'btn-row' }, animBoxes.map((b) => el('label', { class: 'inline' }, b, ` ${b.value}`)))) : el('p', { class: 'hint' }, 'No animations yet: the sheet will be one still frame per direction.'),
    el('button', { class: 'primary', onclick: go }, 'Make sprite sheet'), out);
}

function godotTab() {
  let saved = '';
  try { saved = localStorage.getItem('forge.godotProject') ?? ''; } catch {}
  const project = el('input', { type: 'text', value: saved, placeholder: 'D:\\Programmeren\\games\\my-game' });
  const folder = el('input', { type: 'text', value: 'assets/forge' });
  const collision = sel([['box', 'box (fast)'], ['convex', 'convex (wraps the shape)'], ['mesh', 'exact (static level parts)'], ['none']], 'box');
  const out = el('div', {});
  const o = selectedObj();
  const exportWith = async (command, extra) => {
    try { localStorage.setItem('forge.godotProject', project.value); } catch {}
    out.innerHTML = '<p class="muted">Exporting…</p>';
    const r = await run(command, { project: project.value, folder: folder.value, collision: collision.value, ...extra });
    out.innerHTML = '';
    if (r) {
      const files = r.files ?? [r.path];
      out.append(el('p', {}, `Exported ${files.length} file${files.length > 1 ? 's' : ''}. Switch to Godot: it imports them automatically.`),
        el('ul', { class: 'hint' }, files.map((f) => el('li', {}, f))));
    }
  };
  return el('div', {},
    el('p', { class: 'hint' }, 'Sends .glb files straight into a Godot 4 project, with a collision shape (so players cannot walk through) and animations (Godot makes an AnimationPlayer). Each object lands at the origin, ready to place.'),
    el('div', { class: 'form-grid' }, field('Godot project folder (contains project.godot)', project), field('Folder inside the project', folder), field('Collision', collision)),
    el('div', { class: 'btn-row' },
      el('button', { class: 'primary', disabled: !o, title: o ? '' : 'Select an object first', onclick: () => exportWith('export_godot', { target: o.id }) }, o ? `Export "${o.name}"` : 'Export selected'),
      el('button', { onclick: () => exportWith('export_each', o?.type === 'group' && state.scene.order.some((id) => state.scene.objects[id].parent === o.id) && confirm(`Export each piece inside "${o.name}" separately?\n\nOK = pieces of this group, Cancel = every object in the scene`) ? { group: o.id } : {}) }, 'Export each object separately'),
      el('button', { onclick: () => exportWith('export_godot', { filename: state.scene.name }) }, 'Export whole scene as one')),
    out);
}

async function exportGlb() {
  const name = prompt('File name for the 3D model (.glb):', state.scene.name);
  if (!name) return;
  const target = state.selected && confirm('Export only the selected object?\n\nOK = selected only, Cancel = whole scene') ? state.selected : undefined;
  const r = await run('export_glb', { filename: name, target });
  if (r) toast(`Saved ${r.path} (${Math.round(r.bytes / 1024)} KB)`);
}

async function openProjectModal() {
  const list = await run('list_projects');
  if (!list) return;
  openModal('Projects', el('div', { class: 'menu-list' },
    el('p', { class: 'muted' }, 'Projects save automatically after every change.'),
    el('button', { class: 'primary', onclick: async () => { const n = prompt('Name for the new project:'); if (n && await run('new_project', { name: n })) closeModal(); } }, '+ New project'),
    el('button', { onclick: async () => { const n = prompt('Save a copy as:', `${state.scene.name}-copy`); if (n && await run('save_project_as', { name: n })) closeModal(); } }, 'Save as…'),
    el('h3', {}, 'Open'),
    list.projects.map((p) => el('button', { onclick: async () => { if (await run('open_project', { name: p })) closeModal(); } }, p === list.current ? `${p}  (open)` : p)),
  ));
}

// ---- log & helpers -------------------------------------------------------------

let aiTimer;
function addLog(entry) {
  const log = document.getElementById('log');
  const ai = entry.source !== 'window';
  const e = el('span', { class: `entry${ai ? ' ai' : ''}${entry.ok ? '' : ' err'}` },
    `${new Date(entry.time).toLocaleTimeString()} `, el('b', {}, entry.command), ` · ${entry.source}${entry.ok ? '' : ` · ${entry.error}`}`);
  log.prepend(e);
  while (log.children.length > 12) log.lastChild.remove();
  if (ai) {
    const badge = document.getElementById('ai-badge');
    badge.hidden = false;
    clearTimeout(aiTimer);
    aiTimer = setTimeout(() => { badge.hidden = true; }, 2500);
  }
}

function toast(text, err = false) {
  const t = el('div', { class: `toast${err ? ' err' : ''}` }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), err ? 5000 : 2500);
}

function round(v, d = 4) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function toHex(c) {
  return `#${new THREE.Color(c).getHexString()}`;
}

if (role === 'renderer') startRenderer();
else startWindow();
