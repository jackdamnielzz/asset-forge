// The PixelLab tab: pick any PixelLab tool and get a form with all of its settings,
// built automatically from PixelLab's own description of that tool.

const LONG_TEXT = /description|prompt|action|text|instructions|style/i;

export function pixellabTab({ el, run, state, toast, imageActions }) {
  const box = el('div', {}, el('p', { class: 'muted' }, 'Loading PixelLab tools…'));
  (async () => {
    const tools = await run('pixellab_tools');
    box.innerHTML = '';
    if (!tools) {
      box.append(el('p', {}, 'Connect PixelLab first under Services (✨ AI → Services).'));
      return;
    }
    const balance = el('p', { class: 'hint' });
    run('pixellab_balance').then((b) => {
      if (b) balance.textContent = `PixelLab: ${b.subscription?.generations ?? '?'} of ${b.subscription?.total ?? '?'} subscription pictures left · $${b.credits?.usd ?? 0} credits`;
    });
    let last = '';
    try { last = localStorage.getItem('forge.pixellabTool') ?? ''; } catch {}
    const groups = {};
    for (const t of tools) (groups[t.category] ??= []).push(t);
    const pick = el('select', {}, Object.entries(groups).map(([cat, list]) => el('optgroup', { label: cat }, list.map((t) => el('option', { value: t.tool, selected: t.tool === last }, `${t.title}${t.background ? ' ⏳' : ''}`)))));
    const formBox = el('div', {});
    const out = el('div', {});
    pick.onchange = () => { try { localStorage.setItem('forge.pixellabTool', pick.value); } catch {} showForm(); };
    box.append(balance, el('div', { class: 'form-grid' }, el('label', {}, 'PixelLab tool (⏳ = takes a while)', pick)), formBox, out);

    async function showForm() {
      formBox.innerHTML = '<p class="muted">Loading settings…</p>';
      out.innerHTML = '';
      const info = await run('pixellab_tool_info', { tool: pick.value });
      formBox.innerHTML = '';
      if (!info) return;
      const required = new Set(info.params.required ?? []);
      const pathFields = info.pathParams.map((p) => ({ name: p.name, input: el('input', { type: 'text', placeholder: p.description || p.name }) }));
      const fields = Object.entries(info.params.properties ?? {}).map(([name, schema]) => makeField(name, schema, required.has(name), { el, state }));
      const desc = (info.description || '').trim();
      // append() would print empty slots as the text "null", so leave them out
      formBox.append(...[
        desc ? el('details', {}, el('summary', { class: 'hint' }, desc.split('\n')[0].slice(0, 160)), el('pre', { class: 'hint', style: 'white-space:pre-wrap' }, desc)) : null,
        pathFields.length ? el('div', { class: 'form-grid' }, pathFields.map((f) => el('label', {}, `${f.name} *`, f.input))) : null,
        ...fields.filter((f) => f.wide).map((f) => f.node),
        el('div', { class: 'form-grid' }, fields.filter((f) => !f.wide).map((f) => f.node)),
        el('div', { class: 'btn-row', style: 'margin-top:10px' },
          el('button', { class: 'primary', onclick: go }, '✨ Run in PixelLab'),
          el('span', { class: 'hint' }, 'Costs PixelLab generations or credits.'))].filter(Boolean));

      async function go() {
        const params = {};
        for (const f of fields) {
          const v = f.get();
          if (v !== undefined) params[f.name] = v;
        }
        const missing = [...required].filter((k) => params[k] === undefined);
        if (missing.length) return toast(`Fill in: ${missing.join(', ')}`, true);
        const pathParams = Object.fromEntries(pathFields.map((f) => [f.name, f.input.value.trim()]));
        out.innerHTML = '<p class="muted">PixelLab is working… Long jobs (characters, animations, tilesets) can take a few minutes; progress shows in the bottom bar.</p>';
        const r = await run('pixellab_run', { tool: pick.value, params, pathParams });
        out.innerHTML = '';
        if (!r) return;
        run('pixellab_balance').then((b) => { if (b) balance.textContent = `PixelLab: ${b.subscription?.generations ?? '?'} of ${b.subscription?.total ?? '?'} subscription pictures left · $${b.credits?.usd ?? 0} credits`; });
        out.append(
          el('p', {}, r.assets.length ? `${r.assets.length} picture${r.assets.length > 1 ? 's' : ''} added to your library${costText(r.usage)}.` : r.note ?? 'Done.'),
          el('div', { class: 'icon-grid' }, r.assets.map((a) => el('div', { style: 'text-align:center' },
            el('img', { src: `/library/images/${state.library.images[a.assetId]?.file ?? ''}`, class: 'pixelated', title: a.label, style: 'width:128px;height:128px;object-fit:contain' }),
            el('div', { class: 'hint' }, a.label || '')))),
          r.assets[0] ? imageActions(r.assets[0].assetId) : null,
          el('details', {}, el('summary', { class: 'hint' }, 'What PixelLab answered'), el('pre', { class: 'hint', style: 'white-space:pre-wrap;max-height:200px;overflow:auto' }, JSON.stringify(r.response, null, 1))));
      }
    }
    showForm();
  })();
  return box;
}

// PixelLab reports cost either in subscription generations or in dollars.
function costText(usage) {
  if (usage?.generations !== undefined) return ` · used ${usage.generations} subscription picture${usage.generations === 1 ? '' : 's'}`;
  if (usage?.usd !== undefined) return ` · cost $${usage.usd}`;
  return '';
}

// One form field for one setting, chosen by the setting's type.
function makeField(name, schema, required, { el, state }) {
  // the field's own name reads better than PixelLab's type names ("init_image" → "Init image")
  const label = `${name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}${required ? ' *' : ''}`;
  const tip = [schema.title && schema.title !== label ? schema.title : '', schema.description, schema.default !== undefined ? `Default: ${JSON.stringify(schema.default)}` : '', schema.minimum !== undefined ? `Min ${schema.minimum}` : '', schema.maximum !== undefined ? `Max ${schema.maximum}` : ''].filter(Boolean).join(' · ');
  const wrap = (input, wide = false) => ({ name, wide, node: el('label', { title: tip, style: wide ? 'display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:12px;margin-bottom:8px' : '' }, label, input) });

  if (schema['x-image']) {
    const s = imagePicker(el, state);
    return { ...wrap(s), get: () => pickedImage(s, state) };
  }
  if (schema.enum) {
    const s = el('select', {}, el('option', { value: '' }, schema.default !== undefined ? `default (${schema.default})` : '—'), schema.enum.map((v) => el('option', { value: v }, String(v))));
    return { ...wrap(s), get: () => (s.value === '' ? undefined : schema.type === 'integer' || schema.type === 'number' ? Number(s.value) : s.value) };
  }
  if (schema.type === 'boolean') {
    const c = el('input', { type: 'checkbox', checked: schema.default === true });
    return { name, wide: false, node: el('label', { class: 'check', title: tip }, c, ` ${label}`), get: () => (c.checked === (schema.default === true) ? undefined : c.checked) };
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    const i = el('input', { type: 'number', min: schema.minimum, max: schema.maximum, step: schema.type === 'integer' ? 1 : 'any', placeholder: schema.default ?? '' });
    return { ...wrap(i), get: () => (i.value === '' ? undefined : Number(i.value)) };
  }
  if (schema.type === 'string') {
    const long = LONG_TEXT.test(name);
    const i = long ? el('textarea', { placeholder: schema.default ?? schema.description?.slice(0, 80) ?? '' }) : el('input', { type: 'text', placeholder: schema.default ?? '' });
    return { ...wrap(i, long), get: () => (i.value === '' ? undefined : i.value) };
  }
  if (schema.type === 'object' && schema.properties) {
    // e.g. image_size { width, height }: a small group of sub-fields
    const subRequired = new Set(schema.required ?? []);
    const subs = Object.entries(schema.properties).map(([k, v]) => makeField(k, v, subRequired.has(k), { el, state }));
    return {
      name, wide: true,
      node: el('fieldset', { class: 'pl-group', title: tip }, el('legend', {}, label), el('div', { class: 'form-grid' }, subs.map((s) => s.node))),
      get: () => {
        const o = {};
        for (const s of subs) { const v = s.get(); if (v !== undefined) o[s.name] = v; }
        return Object.keys(o).length ? o : undefined;
      },
    };
  }
  if (schema.type === 'array' && schema.items?.['x-image']) {
    const s = imagePicker(el, state, true);
    return { ...wrap(s), get: () => { const v = [...s.selectedOptions].map((o) => o.value).filter(Boolean); return v.length ? v : undefined; } };
  }
  if (schema.type === 'array' && ['string', 'number', 'integer'].includes(schema.items?.type)) {
    const i = el('input', { type: 'text', placeholder: 'values separated by commas' });
    return { ...wrap(i), get: () => (i.value.trim() ? i.value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (schema.items.type === 'string' ? x : Number(x))) : undefined) };
  }
  // anything else: type it as JSON
  const t = el('textarea', { placeholder: 'JSON', spellcheck: 'false' });
  return { ...wrap(t, true), get: () => { if (!t.value.trim()) return undefined; try { return JSON.parse(t.value); } catch { return t.value; } } };
}

function imagePicker(el, state, multiple = false) {
  const opts = Object.values(state.library.images).map((i) => el('option', { value: i.id }, i.name));
  const render = state.selected ? [el('option', { value: `render:${state.selected}` }, `📷 render of "${state.scene.objects[state.selected]?.name}"`)] : [];
  return el('select', multiple ? { multiple: true, size: 4 } : {}, multiple ? null : el('option', { value: '' }, '— none —'), render, opts);
}

function pickedImage(select) {
  const v = select.value;
  if (!v) return undefined;
  return v.startsWith('render:') ? { render: v.slice(7) } : v;
}
