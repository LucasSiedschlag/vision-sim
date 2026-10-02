// Controles de formulário ligados ao estado. Cada um devolve { el, refresh }:
// `refresh()` relê o estado sem roubar o foco de quem está editando.

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

function busy(el) {
  return document.activeElement === el && el.type !== 'range' && el.type !== 'checkbox';
}

export function section(title, hint, ...body) {
  return h('section', { class: 'group' },
    h('h3', { text: title }),
    hint ? h('p', { class: 'hint', text: hint }) : null,
    ...body);
}

/** Slider com valor formatado ao lado. */
export function range({ id, label, min, max, step = 1, get, set, format = (v) => v, hint }) {
  const inputId = id || nextId('rg');
  const out = h('output', { class: 'val', for: inputId });
  const input = h('input', { type: 'range', id: inputId, min, max, step });
  input.addEventListener('input', () => { set(Number(input.value)); out.textContent = format(Number(input.value)); });
  const el = h('div', { class: 'ctl ctl-range' },
    h('div', { class: 'ctl-head' }, h('label', { for: inputId, text: label }), out),
    input,
    hint ? h('p', { class: 'hint', text: hint }) : null);
  const refresh = () => {
    const v = get();
    if (document.activeElement !== input || Number(input.value) !== v) input.value = v;
    out.textContent = format(v);
  };
  refresh();
  return { el, refresh };
}

export function number({ id, label, min, max, step = 1, get, set, unit }) {
  const inputId = id || nextId('nb');
  const input = h('input', { type: 'number', id: inputId, min, max, step, inputmode: 'decimal' });
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) set(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)));
  });
  const el = h('div', { class: 'ctl ctl-number' },
    h('label', { for: inputId, text: label }),
    h('div', { class: 'with-unit' }, input, unit ? h('span', { class: 'unit', text: unit }) : null));
  const refresh = () => { if (!busy(input)) input.value = Math.round(get() * 100) / 100; };
  refresh();
  return { el, refresh };
}

export function text({ id, label, get, set }) {
  const inputId = id || nextId('tx');
  const input = h('input', { type: 'text', id: inputId });
  input.addEventListener('input', () => set(input.value));
  const el = h('div', { class: 'ctl' }, h('label', { for: inputId, text: label }), input);
  const refresh = () => { if (!busy(input)) input.value = get(); };
  refresh();
  return { el, refresh };
}

export function select({ id, label, options, get, set, hint }) {
  const inputId = id || nextId('sl');
  const input = h('select', { id: inputId });
  const fill = (opts) => {
    input.replaceChildren();
    for (const o of opts) {
      if (o.group) {
        const g = h('optgroup', { label: o.group });
        for (const c of o.options) g.append(h('option', { value: c.value, text: c.label }));
        input.append(g);
      } else input.append(h('option', { value: o.value, text: o.label }));
    }
  };
  fill(typeof options === 'function' ? options() : options);
  input.addEventListener('change', () => set(input.value));
  const el = h('div', { class: 'ctl' },
    h('label', { for: inputId, text: label }), input,
    hint ? h('p', { class: 'hint', text: hint }) : null);
  const refresh = () => {
    if (typeof options === 'function') fill(options());
    input.value = String(get());
  };
  refresh();
  return { el, refresh };
}

/** Botões exclusivos (segmentado). */
export function segmented({ label, options, get, set }) {
  const name = nextId('sg');
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', class: 'seg', 'data-value': o.value, text: o.label, title: o.title || null });
    b.addEventListener('click', () => set(o.value));
    return b;
  });
  const el = h('div', { class: 'ctl' },
    label ? h('span', { class: 'ctl-label', id: name, text: label }) : null,
    h('div', { class: 'segmented', role: 'group', 'aria-labelledby': label ? name : null }, buttons));
  const refresh = () => {
    const v = String(get());
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === v));
  };
  refresh();
  return { el, refresh };
}

export function check({ id, label, get, set, hint }) {
  const inputId = id || nextId('ck');
  const input = h('input', { type: 'checkbox', id: inputId });
  input.addEventListener('change', () => set(input.checked));
  const el = h('div', { class: 'ctl ctl-check' },
    h('label', { for: inputId }, input, h('span', { text: label })),
    hint ? h('p', { class: 'hint', text: hint }) : null);
  const refresh = () => { input.checked = !!get(); };
  refresh();
  return { el, refresh };
}

/** Seletor de cor + sliders R, G, B (0–255). */
export function rgbColor({ label, get, set, hexToRgb, rgbToHex }) {
  const pickId = nextId('cl');
  const pick = h('input', { type: 'color', id: pickId });
  pick.addEventListener('input', () => set(pick.value));
  const names = ['R', 'G', 'B'];
  const sliders = names.map((n, i) => range({
    label: n, min: 0, max: 255, step: 1,
    get: () => hexToRgb(get())[i],
    set: (v) => { const c = hexToRgb(get()); c[i] = v; set(rgbToHex(...c)); },
  }));
  const el = h('div', { class: 'ctl ctl-color' },
    h('div', { class: 'ctl-head' }, h('label', { for: pickId, text: label }), pick),
    h('div', { class: 'rgb-grid' }, sliders.map((s) => s.el)));
  const refresh = () => { pick.value = get(); sliders.forEach((s) => s.refresh()); };
  refresh();
  return { el, refresh };
}

export function button(textLabel, onClick, cls = '') {
  return h('button', { type: 'button', class: `btn ${cls}`.trim(), onClick }, textLabel);
}
