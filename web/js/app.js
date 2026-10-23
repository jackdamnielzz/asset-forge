import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { SceneView } from './viewer.js';
import { LIGHTING_PRESETS, MATERIAL_PRESETS, PATTERNS, STYLES, DEFAULT_EFFECTS, DEFAULT_STYLE_OPTIONS } from '/shared/presets.js';

const DEG = Math.PI / 180;
const role = new URLSearchParams(location.search).get('role') === 'renderer' ? 'renderer' : 'viewer';

const state = { scene: null, library: { images: {} }, selected: null, ws: null, lastCamera: null };
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
        const data = msg.kind === 'render' ? await view.renderImage(msg.opts) : await view.exportGlb(msg.opts);
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
  document.getElementById('export-btn').onclick = exportGlb;
  document.getElementById('project-btn').onclick = openProjectModal;
  document.getElementById('modal-close').onclick = closeModal;
  document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  renderShapeButtons();
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
  group: '<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3 2"/>',
};

function renderShapeButtons() {
  const grid = document.getElementById('shape-grid');
  for (const [type, icon] of Object.entries(ICONS)) {
    const b = document.createElement('button');
    b.innerHTML = `<svg viewBox="0 0 24 24">${icon}</svg>${type}`;
    b.title = `Add ${type}`;
    b.onclick = async () => {
      const args = { type };
      const sel = state.selected && state.scene.objects[state.selected];
      if (sel?.type === 'group') args.parent = sel.id;
      const r = await run('add_object', args);
      if (r) window.forgeSelect(r.id);
    };
    grid.append(b);
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
      li.innerHTML = `<button class="eye" title="Show/hide">${o.visible === false ? '◌' : '●'}</button><span class="label"></span><span class="type">${o.type}</span>`;
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
    t.title = `${img.name} (${img.width}×${img.height}). Click to place in scene.`;
    t.onclick = async () => {
      const r = await run('add_object', { type: 'image', name: img.name, params: { assetId: img.id } });
      if (r) window.forgeSelect(r.id);
    };
    box.append(t);
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
  if (root.contains(document.activeElement) && document.activeElement.matches('input[type=text], input[type=number]')) return;
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
    parts.push(el('h3', {}, 'Shape'), el('div', { class: 'prop-group' },
      paramKeys.map((k) => k === 'bevel'
        ? row('bevel', slider(o.params.bevel, 0, 0.3, 0.005, null, (v) => upd({ params: { bevel: v } })))
        : row(k, el('input', {
          type: 'number', step: /segments/i.test(k) ? 1 : 0.05, value: round(o.params[k], 3),
          onchange: (e) => upd({ params: { [k]: Number(e.target.value) } }),
        }))),
    ));
  }

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
