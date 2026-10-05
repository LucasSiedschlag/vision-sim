// Painéis laterais: Cena (objetos), Câmera, Luz e Detecção.

import { h, section, range, number, text, select, segmented, check, rgbColor, button } from './controls.js';
import { OBJECT_PRESETS, makeObject, makeImageObject, newId } from '../presets/objects.js';
import { CAMERAS, isZoom, calibratedCamera } from '../presets/cameras.js';
import { SHUTTERS, shutterLabel, isFlickerSafe, FIXTURE_MODELS, makeFixture, DIFFUSER_TRANSMISSION, lightSources } from '../core/lighting.js';
import { SURFACES, surfaceOf } from '../core/materials.js';
import { hexToRgb, rgbToHex } from '../core/color.js';
import { resolveHeights, cameraModel, resolveCamera, detectionMode, applyBoxVariant, mainBox, lightContext } from '../core/scene.js';
import { readImage, readFileAsText } from './io.js';

const fmtMm = (v) => `${Math.round(v)} mm`;
const fmtPct = (v) => `${Math.round(v * 100)}%`;
const brl = (v) => v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Monta o painel da aba ativa. Retorna { el, refreshers }. */
export function buildPanel(store, notify) {
  const { ui } = store.get();
  const refreshers = [];
  const add = (ctl) => { refreshers.push(ctl.refresh); return ctl.el; };
  const ctx = { store, add, notify };
  const el =
    ui.tab === 'camera' ? cameraPanel(ctx)
      : ui.tab === 'luz' ? lightPanel(ctx)
        : ui.tab === 'deteccao' ? detectionPanel(ctx)
          : scenePanel(ctx);
  return { el, refreshers };
}

/* ---------------- Cena ---------------- */

function descendants(objects, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of objects) if (o.sitOn && out.has(o.sitOn) && !out.has(o.id)) { out.add(o.id); grew = true; }
  }
  return out;
}

function scenePanel({ store, add, notify }) {
  const S = () => store.get().scene;
  const sel = () => S().objects.find((o) => o.id === store.get().ui.selectedId);
  const up = (fn, structural = false) => store.update((st) => fn(st), { structural });

  // Lista
  const resolved = resolveHeights(S().objects);
  const list = h('ul', { class: 'obj-list', role: 'listbox', 'aria-label': 'Objetos da cena' });
  for (const o of resolved) {
    const parent = S().objects.find((p) => p.id === o.sitOn);
    const vis = h('input', { type: 'checkbox', 'aria-label': `Mostrar ${o.name}` });
    vis.checked = o.visible;
    vis.addEventListener('click', (e) => e.stopPropagation());
    vis.addEventListener('change', () => up((st) => { st.scene.objects.find((x) => x.id === o.id).visible = vis.checked; }, true));
    const li = h('li', {
      class: `obj-row${store.get().ui.selectedId === o.id ? ' is-selected' : ''}${o.visible ? '' : ' is-hidden'}`,
      role: 'option', tabindex: 0, 'aria-selected': String(store.get().ui.selectedId === o.id),
    },
    vis,
    h('span', { class: 'swatch', style: `background:${o.image ? `center/cover url(${o.image})` : o.color}` }),
    h('span', { class: 'obj-name' },
      h('strong', { text: o.name }),
      h('small', { text: `${Math.round(o.w)}×${Math.round(o.d)}×${Math.round(o.h)} mm${parent ? ` · sobre ${parent.name}` : ''}` })),
    o.isTarget ? h('span', { class: 'pill pill-target', text: 'alvo' }) : null);
    const pickRow = () => up((st) => { st.ui.selectedId = o.id; }, true);
    li.addEventListener('click', pickRow);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRow(); } });
    list.append(li);
  }

  // Adicionar
  const addSel = h('select', { id: 'add-object', 'aria-label': 'Adicionar objeto' },
    h('option', { value: '', text: 'Adicionar objeto…' }),
    OBJECT_PRESETS.map((p) => h('option', { value: p.key, text: p.label })));
  addSel.addEventListener('change', () => {
    const key = addSel.value;
    if (!key) return;
    const o = makeObject(key, { x: 0, y: 0 });
    up((st) => { st.scene.objects.push(o); st.ui.selectedId = o.id; }, true);
  });
  const fileId = 'add-image';
  const fileIn = h('input', { type: 'file', id: fileId, accept: 'image/png,image/jpeg,image/webp', class: 'visually-hidden' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    try {
      const img = await readImage(f);
      const o = makeImageObject(img.dataUrl, f.name.replace(/\.[^.]+$/, ''), img.width, img.height, 300);
      up((st) => { st.scene.objects.push(o); st.ui.selectedId = o.id; }, true);
      notify('Imagem adicionada. Ajuste a largura real em milímetros.');
    } catch (e) {
      notify(e.message, 'bad');
    }
    fileIn.value = '';
  });

  const top = section('Objetos na cena',
    'Tudo em milímetros reais. Arraste os objetos na vista de cima.',
    list,
    h('div', { class: 'row-actions' }, addSel, fileIn, h('label', { for: fileId, class: 'btn', text: 'Adicionar imagem…' })));

  const boxes = boxesSection(store, add);
  const o = sel();
  if (!o) return h('div', {}, boxes, top, h('p', { class: 'empty', text: 'Selecione um objeto para editar.' }));

  const mut = (fn, structural = false) => up((st) => { const t = st.scene.objects.find((x) => x.id === o.id); if (t) fn(t, st); }, structural);
  const get = (k) => () => sel()?.[k] ?? 0;

  // Imagem
  const imgId = 'obj-image';
  const imgIn = h('input', { type: 'file', id: imgId, accept: 'image/png,image/jpeg,image/webp', class: 'visually-hidden' });
  imgIn.addEventListener('change', async () => {
    const f = imgIn.files?.[0];
    if (!f) return;
    try {
      const img = await readImage(f);
      mut((t) => {
        t.image = img.dataUrl;
        t.imageName = f.name;
        t.imageAspect = img.width / img.height;
        if (t.keepAspect) t.d = Math.round(t.w / t.imageAspect);
      }, true);
    } catch (e) {
      notify(e.message, 'bad');
    }
    imgIn.value = '';
  });
  const imageBlock = h('div', { class: 'ctl image-ctl' },
    o.image ? h('img', { class: 'thumb', src: o.image, alt: `Imagem de ${o.name}` }) : null,
    h('div', { class: 'row-actions' },
      imgIn,
      h('label', { for: imgId, class: 'btn', text: o.image ? 'Trocar imagem…' : 'Usar foto própria…' }),
      o.image ? button('Voltar à textura', () => mut((t) => { t.image = null; t.imageName = null; }, true), 'btn-quiet') : null));

  const setW = (v) => mut((t) => { t.w = v; if (t.image && t.keepAspect && t.imageAspect) t.d = Math.round(v / t.imageAspect); });
  const setD = (v) => mut((t) => { t.d = v; if (t.image && t.keepAspect && t.imageAspect) t.w = Math.round(v * t.imageAspect); });

  const blocked = descendants(S().objects, o.id);
  const supportOptions = () => [{ value: '', label: 'Bancada' },
    ...S().objects.filter((x) => !blocked.has(x.id)).map((x) => ({ value: x.id, label: x.name }))];

  const editor = section(`Editar: ${o.name}`, null,
    add(text({ id: 'obj-name', label: 'Nome', get: () => sel()?.name ?? '', set: (v) => mut((t) => { t.name = v; }) })),
    imageBlock,
    h('div', { class: 'grid-3' },
      add(number({ id: 'obj-w', label: 'Largura', unit: 'mm', min: 1, max: 5000, get: get('w'), set: setW })),
      add(number({ id: 'obj-d', label: 'Profundidade', unit: 'mm', min: 1, max: 5000, get: get('d'), set: setD })),
      add(number({ id: 'obj-h', label: 'Altura', unit: 'mm', min: 0.1, max: 3000, step: 0.1, get: get('h'), set: (v) => mut((t) => { t.h = v; }) }))),
    o.image ? add(check({ id: 'obj-aspect', label: 'Manter proporção da imagem', get: get('keepAspect'), set: (v) => mut((t) => { t.keepAspect = v; }) })) : null,
    add(segmented({ label: 'Forma', options: [{ value: 'box', label: 'Volume (caixa)' }, { value: 'flat', label: 'Plano (fita, etiqueta)' }],
      get: get('kind'), set: (v) => mut((t) => { t.kind = v; }, true) })),
    h('div', { class: 'grid-2' },
      add(number({ id: 'obj-x', label: 'Posição X', unit: 'mm', min: -5000, max: 5000, get: get('x'), set: (v) => mut((t) => { t.x = v; }) })),
      add(number({ id: 'obj-y', label: 'Posição Y', unit: 'mm', min: -5000, max: 5000, get: get('y'), set: (v) => mut((t) => { t.y = v; }) }))),
    add(range({ id: 'obj-rot', label: 'Rotação', min: -180, max: 180, step: 1, get: get('rot'), set: (v) => mut((t) => { t.rot = v; }), format: (v) => `${v}°` })),
    add(select({ id: 'obj-sit', label: 'Apoiado sobre', options: supportOptions, get: () => sel()?.sitOn ?? '',
      set: (v) => mut((t) => { t.sitOn = v || null; }, true) })),
    !o.sitOn ? add(number({ id: 'obj-base', label: 'Altura da base', unit: 'mm', min: 0, max: 3000, get: get('baseZ'), set: (v) => mut((t) => { t.baseZ = v; }) })) : null);

  const look = section('Aparência', o.image
    ? 'Multiplica os canais da foto. Use para simular outra cor de fita ou de caixa.'
    : 'Cor do material em R, G, B. Mude para testar outra cor de fita ou de caixa.',
  o.image
    ? h('div', { class: 'rgb-grid' }, ['R', 'G', 'B'].map((n, i) => add(range({
      label: `Ajuste ${n}`, min: 0, max: 2, step: 0.01, format: fmtPct,
      get: () => sel()?.tint[i] ?? 1, set: (v) => mut((t) => { t.tint = t.tint.slice(); t.tint[i] = v; }) }))))
    : add(rgbColor({ label: o.texture === 'tape-clear-logo' ? 'Cor do logo' : 'Cor', get: () => sel()?.color ?? '#888888', set: (v) => mut((t) => { t.color = v; }), hexToRgb, rgbToHex })),
  add(range({ id: 'obj-op', label: 'Opacidade', min: 0.1, max: 1, step: 0.05, format: fmtPct, get: get('opacity'), set: (v) => mut((t) => { t.opacity = v; }),
    hint: 'Abaixo de 100%: filme colorido translúcido. Filtra o que está embaixo (escurece e mantém o tom), como uma fita colorida transparente.' })),
  add(select({ id: 'obj-surface', label: 'Superfície (reflexo)', options: Object.entries(SURFACES).map(([k, m]) => ({ value: k, label: m.label })),
    get: () => surfaceOf(sel() || {}).key,
    set: (v) => mut((t) => { t.surface = v; t.roughness = SURFACES[v].roughness; }, true) })),
  add(range({ id: 'obj-rough', label: 'Aspereza do reflexo', min: 0.01, max: 1, step: 0.01, get: () => surfaceOf(sel() || {}).roughness,
    set: (v) => mut((t) => { t.surface = surfaceOf(t).key; t.roughness = v; }), format: (v) => `${(v * 180 / Math.PI).toFixed(0)}°`,
    hint: 'Filme liso (fita): reflete a luminária como espelho, ~4% da luz dela. Papelão: reflexo espalhado, quase some.' })),
  add(check({ id: 'obj-target', label: 'É o alvo da detecção (a fita)', get: get('isTarget'), set: (v) => mut((t) => { t.isTarget = v; }, true) })),
  h('div', { class: 'row-actions' },
    button('Duplicar', () => {
      const copy = { ...structuredClone(sel()), id: newId('copia'), name: `${o.name} (cópia)`, x: o.x + 40, y: o.y + 40 };
      up((st) => { st.scene.objects.push(copy); st.ui.selectedId = copy.id; }, true);
    }),
    button('Remover', () => up((st) => {
      st.scene.objects = st.scene.objects.filter((x) => x.id !== o.id).map((x) => (x.sitOn === o.id ? { ...x, sitOn: o.sitOn, baseZ: o.baseZ } : x));
      st.ui.selectedId = st.scene.objects[0]?.id ?? null;
    }, true), 'btn-danger')));

  return h('div', {}, boxes, top, editor, look);
}


/* ---------------- Caixas (câmera fixa) ---------------- */

function boxesSection(store, add) {
  const sc = () => store.get().scene;
  const B = () => sc().boxes;
  if (!B() || !mainBox(sc())) return null;
  const active = () => B().variants.find((v) => v.id === B().active);
  const apply = (st) => applyBoxVariant(st.scene, st.scene.boxes.variants.find((v) => v.id === st.scene.boxes.active));
  const use = (id) => store.update((st) => { st.scene.boxes.active = id; apply(st); }, { structural: true });

  const list = h('div', { class: 'box-variants', role: 'group', 'aria-label': 'Tamanhos de caixa' },
    B().variants.map((v) => h('button', {
      type: 'button', class: 'box-chip', 'aria-pressed': String(v.id === B().active), onClick: () => use(v.id),
    }, h('strong', { text: v.name }), h('small', { text: `${v.w}×${v.d}×${v.h}` }))));

  const editV = (k) => (val) => store.update((st) => { const v = st.scene.boxes.variants.find((x) => x.id === st.scene.boxes.active); if (v) { v[k] = val; apply(st); } }, { structural: k === 'name' ? false : false });
  const a = active();
  return section('Caixas para testar',
    'A câmera fica parada. Troque a caixa para ver se todas cabem na imagem e se a fita continua legível.',
    list,
    a ? h('div', { class: 'grid-3' },
      add(number({ id: 'bx-w', label: 'Comprimento', unit: 'mm', min: 50, max: 2000, get: () => active()?.w ?? 0, set: editV('w') })),
      add(number({ id: 'bx-d', label: 'Largura', unit: 'mm', min: 50, max: 2000, get: () => active()?.d ?? 0, set: editV('d') })),
      add(number({ id: 'bx-h', label: 'Altura', unit: 'mm', min: 20, max: 2000, get: () => active()?.h ?? 0, set: editV('h') }))) : null,
    add(segmented({ label: 'Posição na balança', options: [{ value: 'centro', label: 'Centralizada' }, { value: 'batente', label: 'Encostada no canto' }],
      get: () => B().align, set: (v) => store.update((st) => { st.scene.boxes.align = v; apply(st); }, { structural: true }) })),
    h('div', { class: 'row-actions' },
      button('Nova caixa', () => store.update((st) => {
        const v = { id: newId('cx'), name: `Caixa ${st.scene.boxes.variants.length + 1}`, w: 450, d: 350, h: 250 };
        st.scene.boxes.variants.push(v);
        st.scene.boxes.active = v.id;
        apply(st);
      }, { structural: true })),
      B().variants.length > 1 ? button('Remover esta', () => store.update((st) => {
        st.scene.boxes.variants = st.scene.boxes.variants.filter((v) => v.id !== st.scene.boxes.active);
        st.scene.boxes.active = st.scene.boxes.variants[0].id;
        apply(st);
      }, { structural: true }), 'btn-quiet') : null,
      button('Comparar todas', () => document.dispatchEvent(new CustomEvent('vs:compare')), 'btn-primary')));
}

/* ---------------- Câmera ---------------- */

function cameraPanel({ store, add, notify }) {
  const C = () => store.get().scene.camera;
  const up = (fn, structural = false) => store.update((st) => fn(st.scene.camera, st), { structural });
  const model = cameraModel(C());
  const cam = resolveCamera(C());

  const groups = [
    { group: 'USB', options: CAMERAS.filter((c) => c.kind === 'usb').map((c) => ({ value: c.id, label: c.name })) },
    { group: 'IP · lente fixa', options: CAMERAS.filter((c) => c.kind === 'ip' && !isZoom(c)).map((c) => ({ value: c.id, label: c.name })) },
    { group: 'IP · zoom motorizado', options: CAMERAS.filter((c) => c.kind === 'ip' && isZoom(c)).map((c) => ({ value: c.id, label: c.name })) },
    { group: 'Outra', options: [{ value: 'custom', label: 'Câmera personalizada…' }] },
  ];

  const est = model.estimated?.length
    ? h('p', { class: 'note' }, h('strong', { text: 'Valores estimados: ' }), model.estimated.join(', '), '. Confira no datasheet.')
    : null;
  const sn = cam.sensor;
  const sensorText = `${model.sensorType > 0 ? `1/${model.sensorType}" · ` : ''}pixel ${sn.pixelUm.toFixed(2).replace('.', ',')} µm${model.sensorType > 0 ? '' : ' (pela lente)'}`;
  const info = h('div', { class: 'card' },
    h('div', { class: 'card-row' }, h('span', { text: 'Resolução' }), h('b', { text: `${model.widthPx} × ${model.heightPx}` })),
    h('div', { class: 'card-row' }, h('span', { text: 'Lente' }), h('b', { text: model.focalMm.length > 1 ? `${model.focalMm[0]}–${model.focalMm[1]} mm` : `${model.focalMm[0]} mm` })),
    h('div', { class: 'card-row' }, h('span', { text: 'Abertura' }), h('b', { text: `F${Number(model.aperture).toFixed(1)}` })),
    h('div', { class: 'card-row' }, h('span', { text: 'Sensor' }), h('b', { text: sensorText })),
    h('div', { class: 'card-row' }, h('span', { text: 'Pixel' }),
      h('b', { text: `satura com ${sn.satLuxS.toFixed(2).replace('.', ',')} lux·s · ${(sn.fullWellE / 1000).toFixed(1).replace('.', ',')} mil e⁻ · leitura ${sn.readNoiseE} e⁻` })),
    h('div', { class: 'card-row' }, h('span', { text: 'Preço' }), h('b', { text: `${brl(model.price)}${model.store ? ` · ${model.store}` : ''}` })),
    model.calibration ? h('div', { class: 'card-row' }, h('span', { text: 'Calibração' }),
      h('b', { text: `${model.calibration.date} · erro ${model.calibration.rmsPx} px · modelo até ${model.calibration.modelErrorPx} px` })) : null,
    h('p', { class: 'hint', text: model.notes }), est,
    h('p', { class: 'note', text: 'Sensibilidade e saturação do pixel: datasheet do Sony IMX327 (1/2.8", 2,9 µm). Capacidade e ruído de leitura: medidos no IMX290, de mesmo pixel. Outros sensores: estimados pelo tamanho do pixel.' }));

  const custom = C().modelId === 'custom' ? (() => {
    const cu = () => C().custom || (C().custom = {});
    const cm = () => cameraModel(C());
    const setC = (k, fn) => (v) => up((c) => { c.custom = { ...cm(), ...(c.custom || {}) }; c.custom[k] = fn ? fn(v) : v; }, true);
    cu();
    return section('Dados da câmera personalizada', 'Copie do datasheet do fabricante.',
      h('div', { class: 'grid-2' },
        add(number({ label: 'Largura', unit: 'px', min: 320, max: 8000, get: () => cm().widthPx, set: setC('widthPx') })),
        add(number({ label: 'Altura', unit: 'px', min: 240, max: 6000, get: () => cm().heightPx, set: setC('heightPx') })),
        add(number({ label: 'FOV horizontal', unit: '°', min: 5, max: 170, step: 0.1, get: () => cm().hfov[0], set: setC('hfov', (v) => [v]) })),
        add(number({ label: 'Focal', unit: 'mm', min: 1, max: 100, step: 0.1, get: () => cm().focalMm[0], set: setC('focalMm', (v) => [v]) })),
        add(number({ label: 'Abertura F', min: 0.8, max: 16, step: 0.1, get: () => cm().aperture, set: setC('aperture') })),
        add(number({ label: 'Sensor 1/x"', min: 1, max: 4, step: 0.1, get: () => cm().sensorType, set: setC('sensorType') })),
        add(number({ label: 'Distorção k1', min: -0.5, max: 0.2, step: 0.01, get: () => cm().distortionK, set: setC('distortionK') }))));
  })() : null;

  const shutterOpts = SHUTTERS.map((s) => ({ value: String(s), label: `${shutterLabel(s)}${isFlickerSafe(s) ? '  · sem flicker' : ''}` }));
  const nearestShutter = () => String(SHUTTERS.reduce((a, b) => (Math.abs(b - C().shutter) < Math.abs(a - C().shutter) ? b : a)));

  return h('div', {},
    section('Modelo', null,
      add(select({ id: 'cam-model', label: 'Câmera', options: groups, get: () => C().modelId, set: (v) => up((c) => { c.modelId = v; }, true) })),
      info,
      calibrationImport(store, notify)),
    custom,
    section('Posição e lente', 'A câmera aponta para baixo. Arraste-a também nas vistas.',
      cam.zoomable ? add(range({ id: 'cam-zoom', label: 'Zoom', min: 0, max: 1, step: 0.01, get: () => C().zoom, set: (v) => up((c) => { c.zoom = v; }),
        format: () => { const r = resolveCamera(C()); return `${r.lens.focalMm.toFixed(1)} mm · ${r.hfov.toFixed(0)}°`; } })) : null,
      add(range({ id: 'cam-z', label: 'Altura acima da bancada', min: 300, max: 3000, step: 5, get: () => C().z, set: (v) => up((c) => { c.z = v; }), format: fmtMm })),
      h('div', { class: 'grid-3' },
        add(number({ id: 'cam-z-num', label: 'Altura', unit: 'mm', min: 100, max: 4000, get: () => C().z, set: (v) => up((c) => { c.z = v; }) })),
        add(number({ id: 'cam-x', label: 'X', unit: 'mm', min: -3000, max: 3000, get: () => C().x, set: (v) => up((c) => { c.x = v; }) })),
        add(number({ id: 'cam-y', label: 'Y', unit: 'mm', min: -3000, max: 3000, get: () => C().y, set: (v) => up((c) => { c.y = v; }) }))),
      add(check({ id: 'cam-dist', label: 'Simular distorção da lente', get: () => C().distortion, set: (v) => up((c) => { c.distortion = v; }),
        hint: 'Desligado: imagem corrigida pela própria câmera (LDC): mesma resolução no centro, bordas cortadas.' }))),
    section('Exposição', 'Tempo de obturador múltiplo de 1/120 s evita o "piscar" das lâmpadas na rede de 60 Hz.',
      add(segmented({ label: 'Modo', options: [{ value: 'auto', label: 'Automática' }, { value: 'manual', label: 'Manual' }],
        get: () => C().exposureMode, set: (v) => up((c) => { c.exposureMode = v; }, true) })),
      C().exposureMode === 'manual' ? add(select({ id: 'cam-shutter', label: 'Obturador', options: shutterOpts, get: nearestShutter, set: (v) => up((c) => { c.shutter = Number(v); }) })) : null,
      C().exposureMode === 'manual' ? add(range({ id: 'cam-gain', label: 'Ganho', min: 0, max: 36, step: 1, get: () => C().gainDb, set: (v) => up((c) => { c.gainDb = v; }), format: (v) => `${v} dB`,
        hint: 'Mais ganho clareia sem juntar mais luz: o ruído cresce junto.' })) : null),
    section('Balanço de branco', 'Diz à câmera qual cor é "branco". Errado, a fita muda de tom.',
      add(segmented({ label: 'Modo', options: [{ value: 'auto', label: 'Automático' }, { value: 'manual-k', label: 'Temperatura' }, { value: 'manual-rgb', label: 'Manual RGB' }],
        get: () => C().wbMode, set: (v) => up((c) => { c.wbMode = v; }, true) })),
      C().wbMode === 'manual-k' ? add(range({ id: 'cam-wbk', label: 'Temperatura ajustada', min: 2500, max: 8000, step: 50, get: () => C().wbKelvin, set: (v) => up((c) => { c.wbKelvin = v; }), format: (v) => `${v} K` })) : null,
      C().wbMode === 'manual-rgb' ? h('div', { class: 'rgb-grid' }, ['R', 'G', 'B'].map((n, i) => add(range({
        label: `Ganho ${n}`, min: 0.3, max: 3, step: 0.01, format: (v) => `${v.toFixed(2)}×`,
        get: () => C().wbGains[i], set: (v) => up((c) => { c.wbGains = c.wbGains.slice(); c.wbGains[i] = v; }) })))) : null,
      C().wbMode === 'auto' ? h('p', { class: 'note', text: 'No automático a câmera procura na imagem o que parece cinza. O papelão pardo parece cinza sob luz quente: com a caixa ocupando a imagem, o automático esfria tudo e a fita puxa para o magenta. Para inspeção, fixe o balanço na temperatura da luz.' }) : null),
    section('Imagem entregue', null,
      add(segmented({ label: 'Cor', options: [{ value: 'color', label: 'Colorido' }, { value: 'bw', label: 'Preto e branco (modo noite)' }],
        get: () => C().colorMode, set: (v) => up((c) => { c.colorMode = v; }) })),
      add(range({ id: 'cam-jpeg', label: 'Qualidade da compressão', min: 10, max: 100, step: 1, get: () => C().jpegQuality, set: (v) => up((c) => { c.jpegQuality = v; }),
        format: (v) => (v >= 100 ? 'sem compressão' : `JPEG ${v}`) })),
      add(check({ id: 'cam-noise', label: 'Simular ruído do sensor', get: () => C().noise, set: (v) => up((c) => { c.noise = v; }) }))));
}

/** Botão "Importar calibração…": troca a câmera por uma personalizada com a lente medida. */
function calibrationImport(store, notify) {
  const input = h('input', { type: 'file', id: 'cal-file', accept: '.json,application/json', class: 'visually-hidden' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const cal = JSON.parse(await readFileAsText(f));
      const base = cameraModel(store.get().scene.camera);
      const cam = calibratedCamera(base.id === 'custom' ? base : { ...base }, cal);
      store.update((st) => { st.scene.camera.modelId = 'custom'; st.scene.camera.custom = cam; st.scene.camera.zoom = 0; }, { structural: true });
      notify(`Lente calibrada aplicada: FOV ${cam.hfov[0]}°, distorção ${cam.distortionK}.`);
    } catch (e) {
      notify(e instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : e.message, 'bad');
    }
    input.value = '';
  });
  return h('div', { class: 'row-actions' }, input,
    h('label', { for: 'cal-file', class: 'btn btn-quiet', text: 'Importar calibração…' }),
    h('p', { class: 'hint', text: 'JSON gerado por calibracao/calibrar.py com fotos do tabuleiro. Usa a câmera atual como base (abertura, sensor).' }));
}

/* ---------------- Luz ---------------- */

function lightPanel({ store, add }) {
  const L = () => store.get().scene.light;
  const up = (fn, structural = false) => store.update((st) => fn(st.scene.light, st), { structural });
  const A = () => L().ambient;
  const flickerPresets = [
    { value: '0', label: 'Sem oscilação' },
    { value: '0.02', label: 'LED de qualidade (2%)' },
    { value: '0.1', label: 'LED comum (10%)' },
    { value: '0.15', label: 'Fluorescente (15%)' },
    { value: '0.35', label: 'LED barato (35%)' },
  ];
  const flickerSelect = (id, get, set) => add(select({ id, label: 'Oscilação da rede (flicker)',
    options: [...flickerPresets, { value: 'custom', label: 'Outro valor' }],
    get: () => (flickerPresets.find((p) => Math.abs(Number(p.value) - get()) < 1e-6)?.value ?? 'custom'),
    set: (v) => { if (v !== 'custom') set(Number(v)); } }));
  const hourFmt = (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`;

  // Galpão
  const ambient = section('Luz do galpão', 'Lâmpadas do teto, luz do dia pelo difusor do teto e janelas laterais. Muda ao longo do dia.',
    add(check({ id: 'amb-on', label: 'Ligada (ambiente aberto)', get: () => A().on, set: (v) => up((l) => { l.ambient.on = v; }, true) })),
    A().on ? h('div', { class: 'stack' },
      add(range({ id: 'amb-lamps', label: 'Lâmpadas do galpão', min: 0, max: 2000, step: 10, get: () => A().lamps, set: (v) => up((l) => { l.ambient.lamps = v; }), format: (v) => `${v} lux` })),
      flickerSelect('amb-flk', () => A().lampFlicker, (v) => up((l) => { l.ambient.lampFlicker = v; })),
      add(range({ id: 'amb-sky', label: 'Luz pelo teto (difusor), ao meio-dia', min: 0, max: 800, step: 10,
        get: () => A().skylight, set: (v) => up((l) => { l.ambient.skylight = v; }), format: (v) => `${v} lux` })),
      add(range({ id: 'amb-win', label: 'Janelas, ao meio-dia', min: 0, max: 800, step: 10,
        get: () => A().windows, set: (v) => up((l) => { l.ambient.windows = v; }), format: (v) => `${v} lux`,
        hint: 'Entra de lado, mais quente de manhã e à tarde, e clareia um lado da bancada.' })),
      add(range({ id: 'li-hour', label: 'Hora do dia', min: 6, max: 19, step: 0.25, get: () => A().hour, set: (v) => up((l) => { l.ambient.hour = v; }), format: hourFmt })),
      h('button', { type: 'button', class: 'btn', id: 'btn-animate', 'data-action': 'animate-day', text: 'Passar o dia' })) : null);

  const cover = A().on ? section('Cobertura da bancada', 'Proteção em volta do posto (policarbonato, lona, chapa). Bloqueia parte da luz do galpão; não afeta as luzes da bancada.',
    add(range({ id: 'li-cover', label: 'Luz do galpão bloqueada', min: 0, max: 0.95, step: 0.05, get: () => L().cover, set: (v) => up((l) => { l.cover = v; }), format: fmtPct }))) : null;

  // Luminárias da bancada
  const modelOpts = Object.entries(FIXTURE_MODELS).map(([k, m]) => ({ value: k, label: m.label }));
  // iluminância no alvo, recalculada a cada mudança (arrastar a luz ou a câmera, mexer no fluxo)
  const benchLux = () => new Map(lightSources(L(), lightContext(store.get().scene)).filter((s) => s.group === 'bench').map((s) => [s.id, s.lux]));
  const cards = L().fixtures.map((f, idx) => {
    const F = () => L().fixtures.find((x) => x.id === f.id) || f;
    const mut = (fn, structural = false) => up((l) => { const t = l.fixtures.find((x) => x.id === f.id); if (t) fn(t); }, structural);
    const model = FIXTURE_MODELS[f.model];
    const productLine = [model.product, `${model.lumens} lm`, model.price ? brl(model.price) : null, model.store].filter(Boolean).join(' · ');
    return h('div', { class: 'fixture' + (f.on ? '' : ' is-off') },
      h('div', { class: 'fixture-head' },
        add(check({ id: `fx-on-${idx}`, label: `Luz ${idx + 1}`, get: () => F().on, set: (v) => mut((t) => { t.on = v; }, true) })),
        button('Remover', () => up((l) => { l.fixtures = l.fixtures.filter((x) => x.id !== f.id); }, true), 'btn-quiet btn-sm')),
      add(select({ id: `fx-model-${idx}`, label: 'Modelo', options: modelOpts, get: () => F().model,
        set: (v) => mut((t) => { Object.assign(t, makeFixture(v, { id: t.id, on: t.on, x: t.x, y: t.y, ...(v === 'dome' || t.model === 'dome' ? {} : { z: t.z }) })); }, true) })),
      h('p', { class: 'hint', text: productLine }),
      h('p', { class: 'hint', text: model.hint }),
      model.estimated?.length ? h('p', { class: 'note', text: `Estimado: ${model.estimated.join(', ')}. Fonte: ${model.source}.` }) : h('p', { class: 'note', text: `Fonte: ${model.source}.` }),
      f.on ? (() => {
        const v = h('strong');
        const refresh = () => { v.textContent = `${Math.round(benchLux().get(f.id) ?? 0)} lux no alvo`; };
        refresh();
        return add({ el: h('p', { class: 'note' }, v, ' (calculado pela posição e pelo fluxo)'), refresh });
      })() : null,
      model.alwaysDiffuse || model.fixedToCamera ? null : add(check({ id: `fx-diff-${idx}`,
        label: `Placa difusora leitosa embaixo (passa ${Math.round(DIFFUSER_TRANSMISSION * 100)}% da luz)`,
        hint: 'Aumenta a área que brilha: o reflexo fica maior e bem mais fraco.',
        get: () => F().diffuser, set: (v) => mut((t) => { t.diffuser = v; }, true) })),
      model.fixedToCamera && f.model !== 'dome' ? h('p', { class: 'hint', text: 'Presa na câmera: acompanha a posição dela.' }) : null,
      f.model === 'dome' ? h('div', { class: 'grid-2' },
        add(number({ id: `fx-z-${idx}`, label: 'Altura da borda', unit: 'mm', min: 0, max: 3000, get: () => F().z, set: (v) => mut((t) => { t.z = v; }) })),
        add(number({ id: `fx-rad-${idx}`, label: 'Raio', unit: 'mm', min: 100, max: 1500, get: () => F().radius, set: (v) => mut((t) => { t.radius = v; }) }))) : null,
      model.fixedToCamera ? null : h('div', { class: 'grid-3' },
        add(number({ id: `fx-x-${idx}`, label: 'X', unit: 'mm', min: -5000, max: 5000, get: () => F().x, set: (v) => mut((t) => { t.x = v; }) })),
        add(number({ id: `fx-y-${idx}`, label: 'Y', unit: 'mm', min: -5000, max: 5000, get: () => F().y, set: (v) => mut((t) => { t.y = v; }) })),
        add(number({ id: `fx-z-${idx}`, label: 'Altura', unit: 'mm', min: 50, max: 4000, get: () => F().z, set: (v) => mut((t) => { t.z = v; }) }))),
      model.fixedToCamera || model.shape === 'sphere' ? null : add(range({ id: `fx-rot-${idx}`, label: 'Rotação', min: -90, max: 90, step: 1,
        get: () => F().rot, set: (v) => mut((t) => { t.rot = v; }), format: (v) => `${v}°` })),
      add(range({ id: `fx-lm-${idx}`, label: 'Fluxo luminoso', min: 100, max: 6000, step: 10, get: () => F().lumens, set: (v) => mut((t) => { t.lumens = v; }),
        format: (v) => `${v} lm`, hint: 'Do datasheet. Duas luminárias iguais lado a lado: use uma com o dobro, ou adicione outra.' })),
      add(range({ id: `fx-k-${idx}`, label: 'Temperatura de cor', min: 2700, max: 6500, step: 50, get: () => F().kelvin, set: (v) => mut((t) => { t.kelvin = v; }), format: (v) => `${v} K` })),
      F().strobe ? null : flickerSelect(`fx-flk-${idx}`, () => F().flicker, (v) => mut((t) => { t.flicker = v; })),
      add(check({ id: `fx-strobe-${idx}`, label: 'Pulsada (estroboscópica), sincronizada com a câmera',
        hint: 'O LED acende só durante a foto, mais forte. Com obturador curto, a luz do galpão quase some. Exige câmera com saída de disparo.',
        get: () => F().strobe, set: (v) => mut((t) => { t.strobe = v; }, true) })),
      F().strobe ? h('div', { class: 'grid-2' },
        add(select({ id: `fx-pulse-${idx}`, label: 'Duração do pulso',
          options: [1 / 4000, 1 / 2000, 1 / 1000, 1 / 500].map((v) => ({ value: String(v), label: shutterLabel(v) })),
          get: () => String(F().pulse), set: (v) => mut((t) => { t.pulse = Number(v); }) })),
        add(select({ id: `fx-od-${idx}`, label: 'Sobrecorrente no pulso',
          options: [1, 2, 4, 8].map((v) => ({ value: String(v), label: `${v}× a intensidade` })),
          get: () => String(F().overdrive), set: (v) => mut((t) => { t.overdrive = Number(v); }) }))) : null);
  });

  const addSel = h('select', { id: 'fx-add', 'aria-label': 'Adicionar luz da bancada' },
    h('option', { value: '', text: 'Adicionar luz da bancada…' }),
    modelOpts.map((o) => h('option', { value: o.value, text: o.label })));
  addSel.addEventListener('change', () => {
    if (!addSel.value) return;
    const c = store.get().scene.camera;
    // nova luminária ao lado da câmera, um pouco abaixo dela
    const fx = makeFixture(addSel.value, { x: c.x, y: c.y + 300, z: Math.max(200, c.z - 200) });
    up((l) => { l.fixtures.push(fx); }, true);
  });

  return h('div', {},
    section('Luzes da bancada', 'Luminárias do próprio posto de inspeção. Somam com a luz do galpão.', ...cards,
      cards.length ? null : h('p', { class: 'empty', text: 'Nenhuma luz na bancada.' }),
      h('div', { class: 'row-actions' }, addSel)),
    ambient,
    cover,
    A().on ? h('p', { class: 'note', text: 'Com luz contínua, encurtar o obturador escurece a bancada e o galpão na mesma proporção: a influência do galpão só cai com luz da bancada mais forte, cobertura, ou luz pulsada.' }) : null);
}

/* ---------------- Detecção ---------------- */

function detectionPanel({ store, add }) {
  const D = () => store.get().scene.detection;
  const up = (fn, structural = false) => store.update((st) => fn(st.scene.detection, st), { structural });
  const target = () => store.get().scene.objects.filter((o) => o.isTarget && o.visible).pop();
  const mode = detectionMode(store.get().scene);
  const modeLabel = mode === 'logo' ? 'logo repetido' : 'área de cor';
  return h('div', {},
    section('Como verificar a fita',
      'Área de cor: compara a cor encontrada com a referência de uma caixa boa (a fita inteira, ou só o logo quando a fita tem logo). Logo repetido: percorre a emenda inteira procurando os logos; também pega fita curta ou faltando.',
      add(segmented({ options: [{ value: 'auto', label: 'Automático' }, { value: 'cor', label: 'Área de cor' }, { value: 'logo', label: 'Logo repetido' }],
        get: () => D().mode || 'auto', set: (v) => up((d) => { d.mode = v; }, true) })),
      (D().mode || 'auto') === 'auto' ? h('p', { class: 'hint', text: `Pelo alvo visível, usando: ${modeLabel}.` }) : null),
    section('Cor procurada', 'O sistema procura pixels com esta cor (matiz) na imagem final da câmera.',
      add(rgbColor({ label: 'Cor', get: () => D().color, set: (v) => up((d) => { d.color = v; }), hexToRgb, rgbToHex })),
      button('Usar a cor do alvo', () => { const t = target(); if (t) up((d) => { d.color = t.color; }); }),
      add(range({ id: 'det-hue', label: 'Tolerância de cor', min: 2, max: 60, step: 1, get: () => D().hueTol, set: (v) => up((d) => { d.hueTol = v; }), format: (v) => `±${v}°` })),
      add(range({ id: 'det-s', label: 'Saturação mínima', min: 0, max: 1, step: 0.01, get: () => D().sMin, set: (v) => up((d) => { d.sMin = v; }), format: fmtPct,
        hint: 'Separa o vermelho vivo do pardo apagado do papelão.' })),
      add(range({ id: 'det-v', label: 'Brilho mínimo', min: 0, max: 1, step: 0.01, get: () => D().vMin, set: (v) => up((d) => { d.vMin = v; }), format: fmtPct })),
      add(check({ id: 'det-mask', label: 'Mostrar o que foi detectado sobre a imagem', get: () => D().showMask, set: (v) => up((d) => { d.showMask = v; }) }))),
    mode === 'logo'
      ? section('Critério de aprovação (logo)', 'A região da emenda é conhecida porque a câmera e a balança são fixas. O sistema percorre a emenda e procura os logos.',
        add(range({ id: 'det-logos', label: 'Logos encontrados, mínimo', min: 1, max: 10, step: 1, get: () => D().minLogos, set: (v) => up((d) => { d.minLogos = v; }) })),
        add(range({ id: 'det-gap', label: 'Maior trecho sem logo, máximo', min: 20, max: 400, step: 5, get: () => D().maxGapMm, set: (v) => up((d) => { d.maxGapMm = v; }), format: fmtMm,
          hint: 'Inclui as pontas. Um pedaço de fita faltando ou uma emenda aberta vira um trecho grande sem logo.' })),
        add(range({ id: 'det-fp', label: 'Área vermelha fora da fita, máximo', min: 0, max: 1, step: 0.01, get: () => D().maxFalsePositive, set: (v) => up((d) => { d.maxFalsePositive = v; }), format: fmtPct })))
      : section('Critério de aprovação (área)', null,
        add(range({ id: 'det-cov', label: 'Cor esperada reconhecida, mínimo', min: 0.1, max: 1, step: 0.01, get: () => D().minCoverage, set: (v) => up((d) => { d.minCoverage = v; }), format: fmtPct })),
        add(range({ id: 'det-fp', label: 'Área vermelha fora da fita, máximo', min: 0, max: 1, step: 0.01, get: () => D().maxFalsePositive, set: (v) => up((d) => { d.maxFalsePositive = v; }), format: fmtPct,
          hint: 'Em relação à área da fita. Algo vermelho perto da caixa conta aqui.' }))));
}
