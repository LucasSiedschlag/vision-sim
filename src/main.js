// Liga estado, painéis, vistas e a imagem da câmera.

import { createStore, normalizeScene, loadSaved, autosave } from './state.js';
import { exampleScene } from './presets/objects.js';
import { buildPanel } from './ui/panels.js';
import { saveFile, readFileAsText, readImage } from './ui/io.js';
import { drawTopView, drawFrontView, topToWorld, topViewport, frontViewport, lockViews, sceneFixtures } from './render/views.js';
import { renderCamera } from './render/camera.js';
import { setAssetListener } from './render/textures.js';
import { opticsMetrics, lightingMetrics, resolveHeights, drawOrder, resolveCamera, applyBoxVariant, boxInView, detectionParams } from './core/scene.js';
import { colorLut } from './core/detection.js';
import { analyzePhoto, compareAnalyses } from './core/validation.js';
import { projectImage, rectCorners, DEG } from './core/optics.js';
import { shutterLabel } from './core/lighting.js';

const $ = (s) => document.querySelector(s);
const els = {
  panel: $('#panel'),
  tabs: [...document.querySelectorAll('.tabs button')],
  top: $('#cv-top'),
  front: $('#cv-front'),
  cam: $('#cv-cam'),
  overlay: $('#cv-overlay'),
  loupe: $('#cv-loupe'),
  metrics: $('#metrics'),
  verdict: $('#verdict'),
  camTitle: $('#cam-res'),
  busy: $('#cam-busy'),
  toast: $('#toast'),
  sceneName: $('#scene-name'),
  topInfo: $('#top-info'),
  loupeZoom: $('#loupe-zoom'),
  loupeZoomOut: $('#loupe-zoom-out'),
  loupeMask: $('#loupe-mask'),
  loupeBox: $('#loupe-box'),
  loupeState: $('#loupe-state'),
  strip: $('#verdict-strip'),
  stripCap: $('#verdict-strip-cap'),
  compare: $('#compare'),
  compareGrid: $('#compare-grid'),
  compareSub: $('#compare-sub'),
  frontInfo: $('#front-info'),
};

function start(saved) {
  const initial = saved?.scene ? normalizeScene(saved.scene) : loadSaved() || exampleScene();
  const store = createStore(initial);
  if (saved?.ui) Object.assign(store.get().ui, saved.ui);
  window.claude?.hot?.snapshot?.(() => ({ scene: store.get().scene, ui: store.get().ui }));

  /* ---------- Avisos ---------- */
  let toastTimer = 0;
  function notify(msg, kind = 'ok') {
    els.toast.textContent = msg;
    els.toast.dataset.kind = kind;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3500);
  }

  /* ---------- Painel ---------- */
  let refreshers = [];
  function rebuildPanel() {
    const { el, refreshers: r } = buildPanel(store, notify);
    refreshers = r;
    els.panel.replaceChildren(el);
    const anim = els.panel.querySelector('[data-action="animate-day"]');
    if (anim) {
      anim.textContent = dayTimer ? 'Parar' : 'Passar o dia';
      anim.addEventListener('click', toggleDay);
    }
    for (const b of els.tabs) b.setAttribute('aria-selected', String(b.dataset.tab === store.get().ui.tab));
  }
  for (const b of els.tabs) {
    b.addEventListener('click', () => store.update((st) => { st.ui.tab = b.dataset.tab; }, { structural: true, camera: false }));
  }

  /* ---------- Animação do dia ---------- */
  let dayTimer = 0;
  function toggleDay() {
    if (dayTimer) {
      clearInterval(dayTimer);
      dayTimer = 0;
    } else {
      dayTimer = setInterval(() => {
        store.update((st) => {
          const l = st.scene.light.ambient;
          l.hour = l.hour >= 19 ? 6 : Math.round((l.hour + 0.25) * 4) / 4;
          st.ui.captureSeed++;
        });
      }, 450);
    }
    const anim = els.panel.querySelector('[data-action="animate-day"]');
    if (anim) anim.textContent = dayTimer ? 'Parar' : 'Passar o dia';
  }

  /* ---------- Vistas ---------- */
  let viewsQueued = false;
  function drawViews() {
    if (viewsQueued) return;
    viewsQueued = true;
    requestAnimationFrame(() => {
      viewsQueued = false;
      const st = store.get();
      drawTopView(els.top, st.scene, st.ui);
      drawFrontView(els.front, st.scene, st.ui);
      updateOpticsReadout();
    });
  }

  /* ---------- Câmera ---------- */
  let last = null, rendering = false, pending = false, camTimer = 0;
  function scheduleCamera(delay = 70) {
    clearTimeout(camTimer);
    camTimer = setTimeout(runCamera, delay);
  }
  async function runCamera() {
    if (rendering) { pending = true; return; }
    rendering = true;
    els.busy.hidden = false;
    try {
      const st = store.get();
      last = await renderCamera(st.scene, st.ui.captureSeed);
      paintCamera();
    } catch (e) {
      console.error(e);
      notify(`Não foi possível gerar a imagem: ${e.message}`, 'bad');
    } finally {
      rendering = false;
      els.busy.hidden = true;
      if (pending) { pending = false; runCamera(); }
    }
  }

  let loupeAt = null; // ponto (px da imagem) sob o mouse
  function paintCamera() {
    if (!last) return;
    const { canvas, width: W, height: H } = last;
    for (const c of [els.cam, els.overlay]) {
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    }
    els.cam.getContext('2d').drawImage(canvas, 0, 0);
    const octx = els.overlay.getContext('2d');
    octx.clearRect(0, 0, W, H);
    if (store.get().scene.detection.showMask) {
      const img = octx.createImageData(W, H);
      const d = img.data, m = last.mask, e = last.expected;
      // Acerto: só o contorno (para a cor real continuar visível). Fora da fita e não reconhecido: preenchido.
      const g = last.region;
      const hit = (k) => k >= 0 && k < m.length && m[k] && e[k];
      const logoMode = last.mode === 'logo';
      for (let i = 0, j = 0; j < m.length; i += 4, j++) {
        if (m[j] && e[j]) {
          const x = j % W;
          const edge = x === 0 || x === W - 1 || !hit(j - 1) || !hit(j + 1) || !hit(j - W) || !hit(j + W);
          if (edge) { d[i] = 0; d[i + 1] = 210; d[i + 2] = 255; d[i + 3] = 255; }
        } else if (m[j] && !g[j]) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 170; d[i + 3] = 200; }
        else if (e[j] && !logoMode) { d[i] = 255; d[i + 1] = 180; d[i + 2] = 0; d[i + 3] = 170; }
      }
      octx.putImageData(img, 0, 0);
    }
    els.camTitle.textContent = `${W} × ${H} px`;
    paintLoupe();
    updateCameraReadout();
    if (!vEl.dlg.hidden) runValidation();
  }

  function defaultLoupePoint() {
    const sc = store.get().scene;
    const objs = drawOrder(resolveHeights(sc.objects));
    const t = objs.filter((o) => o.isTarget).pop() || objs[objs.length - 1];
    const cam = resolveCamera(sc.camera);
    if (!t) return { u: cam.w / 2, v: cam.h / 2 };
    const p = projectImage({ x: t.x, y: t.y, z: t.z1 }, cam);
    return p ? { u: p.u, v: p.v } : { u: cam.w / 2, v: cam.h / 2 };
  }

  // Lupa: zoom ajustável; clique na imagem fixa o ponto (clique de novo para soltar).
  let loupePinned = null;
  const loupeZoom = () => Number(els.loupeZoom.value) || 4;

  function camGeometry() {
    const r = els.cam.getBoundingClientRect();
    const k = Math.min(r.width / last.width, r.height / last.height);
    return { r, k, ox: (r.width - last.width * k) / 2, oy: (r.height - last.height * k) / 2 };
  }

  function imagePoint(e) {
    if (!last) return null;
    const { r, k, ox, oy } = camGeometry();
    const u = (e.clientX - r.left - ox) / k, v = (e.clientY - r.top - oy) / k;
    return u < 0 || v < 0 || u > last.width || v > last.height ? null : { u, v };
  }

  function paintLoupe() {
    if (!last) return;
    const ctx = els.loupe.getContext('2d');
    const zoom = loupeZoom();
    els.loupeZoomOut.textContent = `${zoom}×`;
    const lw = els.loupe.width / zoom, lh = els.loupe.height / zoom;
    const p = loupeAt || loupePinned || defaultLoupePoint();
    const sx = Math.max(0, Math.min(last.width - lw, p.u - lw / 2));
    const sy = Math.max(0, Math.min(last.height - lh, p.v - lh / 2));
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, els.loupe.width, els.loupe.height);
    ctx.drawImage(els.cam, sx, sy, lw, lh, 0, 0, els.loupe.width, els.loupe.height);
    if (els.loupeMask.checked && store.get().scene.detection.showMask) {
      ctx.drawImage(els.overlay, sx, sy, lw, lh, 0, 0, els.loupe.width, els.loupe.height);
    }
    // moldura na imagem mostrando a área ampliada
    const { k, ox, oy } = camGeometry();
    Object.assign(els.loupeBox.style, { left: `${ox + sx * k}px`, top: `${oy + sy * k}px`, width: `${lw * k}px`, height: `${lh * k}px` });
    els.loupeBox.hidden = false;
    els.loupeBox.dataset.pinned = String(!!loupePinned);
    els.loupeState.textContent = loupePinned ? 'Ponto fixado. Clique na imagem para soltar.' : 'Passe o mouse na imagem; clique para fixar o ponto.';
  }

  const camArea = els.cam.parentElement;
  camArea.addEventListener('pointermove', (e) => {
    if (loupePinned) return;
    const p = imagePoint(e);
    if (!p) return;
    loupeAt = p;
    paintLoupe();
  });
  camArea.addEventListener('pointerleave', () => { loupeAt = null; paintLoupe(); });
  camArea.addEventListener('click', (e) => {
    const p = imagePoint(e);
    if (loupePinned || !p) loupePinned = null;
    else loupePinned = p;
    loupeAt = null;
    paintLoupe();
  });
  els.loupeZoom.addEventListener('input', paintLoupe);
  els.loupeMask.addEventListener('change', paintLoupe);

  /* ---------- Indicadores ---------- */
  function metric(id, labelText, value, state, note) {
    let row = els.metrics.querySelector(`[data-m="${id}"]`);
    if (!row) {
      row = document.createElement('div');
      row.className = 'metric';
      row.dataset.m = id;
      row.innerHTML = '<dt></dt><dd><span class="v"></span><small></small></dd>';
      els.metrics.append(row);
    }
    row.querySelector('dt').textContent = labelText;
    row.querySelector('.v').textContent = value;
    row.querySelector('small').textContent = note || '';
    row.dataset.state = state || '';
  }

  function updateOpticsReadout() {
    const m = opticsMetrics(store.get().scene);
    metric('field', 'Campo no alvo', `${Math.round(m.fieldW)} × ${Math.round(m.fieldH)} mm`, '', `a ${Math.round(m.distanceMm)} mm da câmera`);
    metric('mmpx', 'Cada pixel cobre', `${m.mmPerPx.toFixed(2)} mm`, '', `${m.resolution} · ${m.hfov.toFixed(0)}° · ${m.focalMm.toFixed(1)} mm`);
    if (m.targetPx != null) {
      const st = m.targetPx >= 60 ? 'ok' : m.targetPx >= 30 ? 'warn' : 'bad';
      const note = st === 'ok' ? 'sobra para ler o logo' : st === 'warn' ? 'detecta a cor, logo apertado' : 'pouco para detectar com segurança';
      metric('tapepx', `Largura de "${m.targetName}"`, `${Math.round(m.targetPx)} px`, st, note);
    } else {
      metric('tapepx', 'Largura do alvo', '—', 'warn', 'marque um objeto como alvo');
    }
    metric('focus', 'Foco', m.allSharp ? 'Tudo nítido' : 'Parte desfocada', m.allSharp ? 'ok' : 'warn',
      `faixa nítida de ${Math.round(m.dofNear)} a ${Number.isFinite(m.dofFar) ? `${Math.round(m.dofFar)} mm` : '∞'}`);
  }

  /** Régua da fita (modo logo): onde há logo ao longo da emenda e os trechos acima do limite. */
  function paintStrip() {
    const p = last?.profile;
    els.strip.hidden = !p;
    els.stripCap.hidden = !p;
    if (!p) return;
    const c = els.strip, ctx = c.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const w = c.width, h = c.height, n = p.occ.length, bw = w / n;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = css.getPropertyValue('--line').trim();
    ctx.fillRect(0, h * 0.35, w, h * 0.3);
    const limit = store.get().scene.detection.maxGapMm;
    const segs = p.segments;
    const gaps = [];
    if (segs.length) {
      gaps.push([0, segs[0].start]);
      for (let i = 1; i < segs.length; i++) gaps.push([segs[i - 1].end, segs[i].start]);
      gaps.push([segs[segs.length - 1].end, n]);
    } else gaps.push([0, n]);
    ctx.fillStyle = 'rgb(255,180,0)';
    for (const [a, b] of gaps) if ((b - a) * p.binMm > limit) ctx.fillRect(a * bw, h * 0.2, (b - a) * bw, h * 0.6);
    ctx.fillStyle = 'rgb(0,190,235)';
    for (const sgm of segs) ctx.fillRect(sgm.start * bw, 0, Math.max(2, (sgm.end - sgm.start) * bw), h);
  }

  function updateCameraReadout() {
    if (!last) return;
    const sc = store.get().scene;
    const lm = lightingMetrics(sc, last.exposure.shutter);
    const ex = last.exposure;
    const clip = ex.clippedRatio;
    metric('exposure', 'Exposição', `${shutterLabel(ex.shutter)} · ${ex.gainDb.toFixed(0)} dB${ex.antiFlicker ? ' · anti-cintilação' : ''}`,
      clip > 0.02 ? 'bad' : ex.gainDb > 18 ? 'warn' : 'ok',
      clip > 0.002
        ? `${(clip * 100).toFixed(1)}% da imagem estourada${ex.antiFlicker && ex.shutter >= 1 / 121 && ex.gainDb < 0.5 ? ': mesmo em 1/120 s entra luz demais (diminua a luz da bancada)' : ''}`
        : ex.gainDb > 18 ? 'ganho alto, mais ruído' : 'sem áreas estouradas');
    if (ex.meanE < 1 || !Number.isFinite(ex.snrDb)) {
      metric('noise', 'Ruído no cinza médio', 'sem luz', 'bad', 'nenhuma luz chega ao sensor');
    } else {
      metric('noise', 'Ruído no cinza médio', `SNR ${ex.snrDb.toFixed(0)} dB`,
        ex.snrDb < 20 ? 'bad' : ex.snrDb < 30 ? 'warn' : 'ok',
        `${Math.round(ex.meanE).toLocaleString('pt-BR')} e⁻ por pixel${ex.snrDb < 20 ? ' · granulado visível' : ''}`);
    }
    metric('flicker', 'Variação entre fotos', `±${(lm.flickerSpread * 50).toFixed(0)}%`,
      lm.flickerSpread > 0.1 ? 'bad' : lm.flickerSpread > 0.03 ? 'warn' : 'ok',
      lm.flickerSafe ? 'obturador em sincronia com a rede'
        : lm.flickerSpread > 0.03 ? 'faixas horizontais na imagem: obturador mais curto que o piscar das lâmpadas (1/120 s); ligue a anti-cintilação'
          : 'obturador fora de sincronia com 60 Hz');
    metric('light', 'Luz na cena', `${Math.round(lm.lux)} lux · ${Math.round(lm.kelvin)} K`, '',
      lm.ambientOn ? `bancada ${Math.round(lm.benchShare * 100)}% · galpão ${Math.round(lm.ambientShare * 100)}% da imagem` : 'só luzes da bancada');
    if (lm.ambientOn) {
      const d = lm.daySpread;
      metric('day', 'Variação ao longo do dia', `±${Math.round(d * 50)}%`, d > 0.3 ? 'bad' : d > 0.12 ? 'warn' : 'ok',
        d > 0.3 ? 'a luz do galpão manda na imagem' : d > 0.12 ? 'influência perceptível do galpão' : 'luz da bancada domina');
    } else {
      els.metrics.querySelector('[data-m="day"]')?.remove();
    }
    if (last.awbKelvin) {
      // diferença em mired (1e6/K): é a escala em que o olho e a câmera percebem desvio de cor
      const off = Math.abs(1e6 / last.awbKelvin - 1e6 / lm.kelvin);
      metric('wb', 'Balanço de branco', `automático: ${Math.round(last.awbKelvin / 50) * 50} K`, off > 30 ? 'warn' : 'ok',
        off > 30 ? `as cores da cena enganaram o automático (luz real ~${Math.round(lm.kelvin / 50) * 50} K): fixe o balanço` : `ganhos ${last.wb.map((g) => g.toFixed(2)).join(' / ')}`);
    } else {
      metric('wb', 'Balanço de branco', last.wb.map((g) => g.toFixed(2)).join(' / '), '', 'ganhos R / G / B');
    }

    const v = last.verdict, r = last.result;
    els.verdict.dataset.state = v.ok ? 'ok' : 'bad';
    els.verdict.querySelector('.verdict-label').textContent = v.label;
    els.verdict.querySelector('.verdict-reasons').replaceChildren(...v.reasons.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }));
    paintStrip();
    els.verdict.querySelector('.verdict-nums').textContent =
      r.expectedPx ? `${r.detectedPx.toLocaleString('pt-BR')} de ${r.expectedPx.toLocaleString('pt-BR')} px ${last.what || 'da fita'} · ${r.falsePositivePx.toLocaleString('pt-BR')} px fora` : '';
  }

  /* ---------- Interação nas vistas ---------- */
  function hitTop(px, py) {
    const st = store.get();
    const cam = st.scene.camera;
    const camPx = { x: topViewport.ox + (cam.x - topViewport.minX) * topViewport.scale, y: topViewport.oy + (cam.y - topViewport.minY) * topViewport.scale };
    if (Math.hypot(px * topViewport.dpr - camPx.x, py * topViewport.dpr - camPx.y) < 14 * topViewport.dpr) return { kind: 'camera' };
    const w = topToWorld(px, py);
    const tol = (10 * topViewport.dpr) / topViewport.scale; // 10 px de folga, em mm
    for (const { f, lum, model } of sceneFixtures(st.scene).reverse()) {
      if (model.fixedToCamera) continue;
      const dx = w.x - lum.x, dy = w.y - lum.y;
      const c = Math.cos(-lum.rot), s = Math.sin(-lum.rot);
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      const hw = lum.shape === 'rect' ? lum.w / 2 : lum.r, hd = lum.shape === 'rect' ? lum.d / 2 : lum.r;
      if (Math.abs(lx) <= hw + tol && Math.abs(ly) <= hd + tol) return { kind: 'fixture', id: f.id };
    }
    const objs = drawOrder(resolveHeights(st.scene.objects)).reverse();
    for (const o of objs) {
      const c = Math.cos(-o.rot * DEG), s = Math.sin(-o.rot * DEG);
      const dx = w.x - o.x, dy = w.y - o.y;
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      if (Math.abs(lx) <= o.w / 2 && Math.abs(ly) <= o.d / 2) return { kind: 'object', id: o.id };
    }
    return null;
  }

  // Arrasto: movimento 1:1 com o mouse (o enquadramento fica travado até soltar).
  // Shift = ajuste fino: 1/5 do movimento e passo de 1 mm.
  const FINE = 0.2;
  const snap = (v, step) => Math.round(v / step) * step;

  function dragOn(canvas, info, onDown) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = canvas.getBoundingClientRect();
      const handler = onDown(e.clientX - r.left, e.clientY - r.top);
      if (!handler) return;
      e.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      lockViews(true);
      let lastX = e.clientX, lastY = e.clientY, accX = 0, accY = 0;
      info.textContent = handler.label();
      const move = (ev) => {
        const k = ev.shiftKey ? FINE : 1;
        accX += (ev.clientX - lastX) * k;
        accY += (ev.clientY - lastY) * k;
        lastX = ev.clientX;
        lastY = ev.clientY;
        handler.move(accX, accY, ev.shiftKey);
        info.textContent = handler.label();
      };
      const end = () => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end);
        canvas.removeEventListener('pointercancel', end);
        lockViews(false);
        info.textContent = '';
        drawViews();
        scheduleCamera(0);
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
    });
  }

  /** Objeto selecionado e tudo que está apoiado nele (move junto). */
  function groupOf(id) {
    const objs = store.get().scene.objects;
    const group = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of objs) if (o.sitOn && group.has(o.sitOn) && !group.has(o.id)) { group.add(o.id); grew = true; }
    }
    return new Map(objs.filter((o) => group.has(o.id)).map((o) => [o.id, { x: o.x, y: o.y }]));
  }
  function moveGroup(origin, dx, dy) {
    store.update((st) => {
      for (const o of st.scene.objects) if (origin.has(o.id)) { o.x = origin.get(o.id).x + dx; o.y = origin.get(o.id).y + dy; }
    });
  }
  const sel = () => store.get().scene.objects.find((o) => o.id === store.get().ui.selectedId);
  const camLabel = () => { const c = store.get().scene.camera; return `Câmera: X ${c.x} · Y ${c.y} · altura ${c.z} mm`; };
  const fixtureOf = (id) => store.get().scene.light.fixtures.find((x) => x.id === id);
  const fixLabel = (id) => () => { const f = fixtureOf(id); return f ? `Luz: X ${f.x} · Y ${f.y} · altura ${f.z} mm` : ''; };
  /** Arrasto de uma luminária: no plano (vista de cima) ou em altura/X (vista de frente). */
  function dragFixture(id, k, axisLock) {
    const f0 = { ...fixtureOf(id) };
    let axis = null;
    store.update((st) => { st.ui.selectedFixture = id; }, { camera: false });
    return {
      label: fixLabel(id),
      move: (ax, ay, fine) => store.update((st) => {
        const f = st.scene.light.fixtures.find((x) => x.id === id);
        if (!f) return;
        const step = fine ? 1 : 5;
        if (!axisLock) {
          f.x = snap(f0.x + ax * k, step);
          f.y = snap(f0.y + ay * k, step);
          return;
        }
        if (!axis && Math.hypot(ax, ay) > 6) axis = Math.abs(ay) >= Math.abs(ax) ? 'z' : 'x';
        if (axis === 'z') f.z = Math.max(50, Math.min(4000, snap(f0.z - ay * k, fine ? 1 : 10)));
        else if (axis === 'x') f.x = snap(f0.x + ax * k, step);
      }),
    };
  }
  const objLabel = () => { const o = sel(); return o ? `${o.name}: X ${o.x} · Y ${o.y} mm` : ''; };
  // mm por pixel de tela, medido no início do arrasto (não muda se o layout mexer no meio)
  const mmPerPx = (v) => v.dpr / v.scale;

  dragOn(els.top, els.topInfo, (px, py) => {
    const hit = hitTop(px, py);
    if (!hit) return null;
    const k = mmPerPx(topViewport);
    if (hit.kind === 'fixture') return dragFixture(hit.id, k, false);
    if (hit.kind === 'camera') {
      const c0 = { ...store.get().scene.camera };
      return {
        label: camLabel,
        move: (ax, ay, fine) => store.update((st) => {
          const step = fine ? 1 : 5;
          st.scene.camera.x = snap(c0.x + ax * k, step);
          st.scene.camera.y = snap(c0.y + ay * k, step);
        }),
      };
    }
    if (store.get().ui.selectedId !== hit.id) {
      store.update((st) => { st.ui.selectedId = hit.id; }, { structural: store.get().ui.tab === 'cena', camera: false });
    }
    const origin = groupOf(hit.id);
    const o0 = origin.get(hit.id);
    return {
      label: objLabel,
      move: (ax, ay, fine) => {
        const step = fine ? 1 : 5;
        // encaixa a posição final do objeto arrastado, não o deslocamento
        const dx = snap(o0.x + ax * k, step) - o0.x;
        const dy = snap(o0.y + ay * k, step) - o0.y;
        moveGroup(origin, dx, dy);
      },
    };
  });

  dragOn(els.front, els.frontInfo, (px, py) => {
    const cam = store.get().scene.camera;
    const v = frontViewport;
    const cxp = v.ox + (cam.x - v.minX) * v.scale, czp = v.oy + (v.maxZ - cam.z) * v.scale;
    if (Math.hypot(px * v.dpr - cxp, py * v.dpr - (czp - 12 * v.dpr)) > 26 * v.dpr) {
      // luminária: faixa na altura dela
      for (const { f, lum, model } of sceneFixtures(store.get().scene)) {
        if (model.fixedToCamera) continue;
        const half = lum.shape === 'rect' ? (Math.abs(Math.cos(lum.rot)) * lum.w + Math.abs(Math.sin(lum.rot)) * lum.d) / 2 : lum.r;
        const fx = v.ox + (lum.x - v.minX) * v.scale, fz = v.oy + (v.maxZ - lum.z) * v.scale;
        if (Math.abs(px * v.dpr - fx) <= half * v.scale + 8 * v.dpr && Math.abs(py * v.dpr - fz) <= 10 * v.dpr) return dragFixture(f.id, mmPerPx(v), true);
      }
      return null;
    }
    const c0 = { ...cam };
    const k = mmPerPx(v);
    const minZ = Math.max(...resolveHeights(store.get().scene.objects).filter((o) => o.visible).map((o) => o.z1), 0) + 60;
    let axis = null; // trava no eixo dominante: subir/descer não mexe no X sem querer
    return {
      label: camLabel,
      move: (ax, ay, fine) => {
        if (!axis && Math.hypot(ax, ay) > 6) axis = Math.abs(ay) >= Math.abs(ax) ? 'z' : 'x';
        if (!axis) return;
        store.update((st) => {
          if (axis === 'z') {
            const z = snap(c0.z - ay * k, fine ? 1 : 10);
            st.scene.camera.z = Math.max(minZ, Math.min(4000, z));
          } else {
            st.scene.camera.x = snap(c0.x + ax * k, fine ? 1 : 5);
          }
        });
      },
    };
  });

  // Teclado: setas movem 10 mm; com Shift, 1 mm.
  els.top.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const o = sel();
    if (!d || !o) return;
    e.preventDefault();
    const step = e.shiftKey ? 1 : 10;
    moveGroup(groupOf(o.id), d[0] * step, d[1] * step);
    els.topInfo.textContent = objLabel();
  });
  els.front.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1 : 10;
    const map = { ArrowUp: ['z', step], ArrowDown: ['z', -step], ArrowLeft: ['x', -step], ArrowRight: ['x', step] }[e.key];
    if (!map) return;
    e.preventDefault();
    store.update((st) => { st.scene.camera[map[0]] = Math.max(map[0] === 'z' ? 100 : -5000, st.scene.camera[map[0]] + map[1]); });
    els.frontInfo.textContent = camLabel();
  });
  for (const [cv, info] of [[els.top, els.topInfo], [els.front, els.frontInfo]]) {
    cv.addEventListener('blur', () => { info.textContent = ''; });
  }

  /* ---------- Comparar caixas (câmera fixa) ---------- */
  async function runCompare() {
    const base = store.get().scene;
    if (!base.boxes?.variants?.length) return;
    els.compare.hidden = false;
    els.compareGrid.replaceChildren();
    els.compareSub.textContent = 'Gerando a imagem de cada caixa…';
    $('#compare-close').focus();
    while (rendering) await new Promise((r) => setTimeout(r, 40));
    rendering = true;
    let ok = 0;
    try {
      for (const v of base.boxes.variants) {
        const sc = structuredClone(base);
        sc.boxes.active = v.id;
        applyBoxVariant(sc, v);
        const r = await renderCamera(sc, store.get().ui.captureSeed);
        const thumb = document.createElement('canvas');
        thumb.width = 480;
        thumb.height = Math.round((480 * r.height) / r.width);
        thumb.getContext('2d').drawImage(r.canvas, 0, 0, thumb.width, thumb.height);
        const m = opticsMetrics(sc);
        const fit = boxInView(sc);
        if (r.verdict.ok && fit?.inside) ok++;
        const row = (k, val, state) => {
          const d = document.createElement('div');
          d.className = 'cmp-row';
          if (state) d.dataset.state = state;
          d.innerHTML = '<span></span><b></b>';
          d.children[0].textContent = k;
          d.children[1].textContent = val;
          return d;
        };
        const card = document.createElement('article');
        card.className = 'cmp-card';
        card.dataset.state = r.verdict.ok && fit?.inside ? 'ok' : 'bad';
        const head = document.createElement('header');
        head.innerHTML = '<strong></strong><small></small>';
        head.children[0].textContent = v.name;
        head.children[1].textContent = `${v.w} × ${v.d} × ${v.h} mm`;
        const use = document.createElement('button');
        use.type = 'button';
        use.className = 'btn btn-sm';
        use.textContent = 'Usar esta caixa';
        use.addEventListener('click', () => {
          store.update((st) => { st.scene.boxes.active = v.id; applyBoxVariant(st.scene, v); }, { structural: true });
          els.compare.hidden = true;
        });
        card.append(head, thumb,
          row('Caixa inteira na imagem', fit?.inside ? 'sim' : 'não, cortada', fit?.inside ? 'ok' : 'bad'),
          row('Distância até a fita', `${Math.round(m.distanceMm)} mm`),
          row('Largura da fita na imagem', m.targetPx ? `${Math.round(m.targetPx)} px` : '—', m.targetPx >= 60 ? 'ok' : m.targetPx >= 30 ? 'warn' : 'bad'),
          row('Detecção', r.verdict.label, r.verdict.ok ? 'ok' : 'bad'),
          (() => { const p = document.createElement('p'); p.className = 'hint'; p.textContent = r.verdict.reasons[0] || ''; return p; })(),
          use);
        els.compareGrid.append(card);
      }
      const cam = resolveCamera(base.camera);
      els.compareSub.textContent = `Câmera fixa: ${cam.model.name}, a ${Math.round(base.camera.z)} mm da bancada. ${ok} de ${base.boxes.variants.length} caixas aprovadas.`;
    } catch (e) {
      console.error(e);
      els.compareSub.textContent = `Não foi possível comparar: ${e.message}`;
    } finally {
      rendering = false;
      scheduleCamera(0);
    }
  }
  document.addEventListener('vs:compare', runCompare);
  $('#compare-close').addEventListener('click', () => { els.compare.hidden = true; });
  els.compare.addEventListener('click', (e) => { if (e.target === els.compare) els.compare.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.compare.hidden) els.compare.hidden = true; });

  /* ---------- Validação com foto real ---------- */
  // A foto real é redimensionada para a resolução da câmera simulada e as duas imagens passam pela mesma
  // análise (src/core/validation.js), medida em relação à fita achada em cada uma.
  const vEl = {
    dlg: $('#validate'), real: $('#validate-real'), sim: $('#validate-sim'), table: $('#validate-table'),
    lux: $('#validate-lux'), save: $('#validate-save'), setup: $('#validate-setup'), file: $('#validate-file'),
  };
  let realPhoto = null, report = null; // realPhoto: { name, w, h, image }

  function setupText() {
    const sc = store.get().scene, c = sc.camera, ex = last.exposure;
    const cam = resolveCamera(c), lm = lightingMetrics(sc, ex.shutter);
    const wb = c.wbMode === 'auto' ? 'automático' : c.wbMode === 'manual-k' ? `${c.wbKelvin} K` : `manual ${c.wbGains.map((g) => g.toFixed(2)).join('/')}`;
    return `Simulação: ${cam.model.name}, ${cam.w} × ${cam.h}, câmera a ${Math.round(c.z)} mm da bancada, obturador ${shutterLabel(ex.shutter)}, ganho ${ex.gainDb.toFixed(0)} dB, balanço ${wb}, ${Math.round(lm.lux)} lux calculados na fita. Ajuste a câmera real igual, com exposição manual.`;
  }

  function showImage(canvas, src, W, H, band) {
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    if (src instanceof ImageData) ctx.putImageData(src, 0, 0);
    else { ctx.clearRect(0, 0, W, H); ctx.drawImage(src, 0, 0, W, H); }
    if (band) {
      ctx.strokeStyle = 'rgb(0,210,255)';
      ctx.lineWidth = Math.max(2, W / 480);
      ctx.strokeRect(band.x0, band.y0, band.x1 - band.x0, band.y1 - band.y0);
    }
  }

  function runValidation() {
    if (!last) return;
    const sc = store.get().scene, W = last.width, H = last.height;
    vEl.setup.textContent = setupText();
    const lut = colorLut(detectionParams(sc.detection));
    const simData = els.cam.getContext('2d').getImageData(0, 0, W, H);
    const sim = analyzePhoto(simData.data, W, H, lut);
    showImage(vEl.sim, simData, W, H, sim?.band);
    report = null;
    vEl.save.disabled = true;
    vEl.table.hidden = true;
    if (!realPhoto) return;
    showImage(vEl.real, realPhoto.image, W, H, null);
    const realData = vEl.real.getContext('2d').getImageData(0, 0, W, H);
    const real = analyzePhoto(realData.data, W, H, lut);
    if (real) showImage(vEl.real, realPhoto.image, W, H, real.band);
    if (!real || !sim) {
      notify(!real ? 'A fita não foi achada na foto real. Confira a cor procurada e a tolerância (aba Detecção).' : 'A fita não foi achada na simulação.', 'bad');
      return;
    }
    const rows = compareAnalyses(real, sim);
    const luxReal = Number(vEl.lux.value), luxSim = lightingMetrics(sc, last.exposure.shutter).lux;
    if (luxReal > 0) {
      const d = (luxSim - luxReal) / luxReal;
      rows.unshift(['Luz na fita (lux)', String(Math.round(luxReal)), String(Math.round(luxSim)), `${(d * 100).toFixed(0)}%`, Math.abs(d) <= 0.15]);
    }
    vEl.table.querySelector('tbody').replaceChildren(...rows.map(([k, a, b, d, ok]) => {
      const tr = document.createElement('tr');
      tr.dataset.state = ok ? 'ok' : 'bad';
      for (const t of [k, a, b, d]) { const td = document.createElement('td'); td.textContent = t; tr.append(td); }
      return tr;
    }));
    vEl.table.hidden = false;
    report = { rows, setup: vEl.setup.textContent, photo: realPhoto, camera: resolveCamera(sc.camera).model.name, W, H };
    vEl.save.disabled = false;
  }

  $('#btn-validate').addEventListener('click', () => { vEl.dlg.hidden = false; $('#validate-close').focus(); runValidation(); });
  $('#validate-close').addEventListener('click', () => { vEl.dlg.hidden = true; });
  vEl.dlg.addEventListener('click', (e) => { if (e.target === vEl.dlg) vEl.dlg.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !vEl.dlg.hidden) vEl.dlg.hidden = true; });
  vEl.lux.addEventListener('change', runValidation);
  vEl.file.addEventListener('change', async () => {
    const f = vEl.file.files?.[0];
    if (!f || !last) return;
    try {
      const img = await readImage(f, 12000);
      const image = new Image();
      await new Promise((res, rej) => { image.onload = res; image.onerror = rej; image.src = img.dataUrl; });
      realPhoto = { name: f.name, w: img.width, h: img.height, image };
      const aspect = img.width / img.height, simAspect = last.width / last.height;
      if (Math.abs(aspect / simAspect - 1) > 0.01) notify(`A foto (${img.width} × ${img.height}) tem outra proporção que a câmera simulada (${last.width} × ${last.height}): confira a resolução da câmera real.`, 'bad');
      else if (img.width !== last.width) notify(`Foto redimensionada de ${img.width} × ${img.height} para ${last.width} × ${last.height}.`);
      runValidation();
    } catch {
      notify('Não foi possível abrir a foto.', 'bad');
    }
    vEl.file.value = '';
  });
  vEl.save.addEventListener('click', async () => {
    if (!report) return;
    const date = new Date().toISOString().slice(0, 10);
    const md = [
      `# Validação: ${report.camera} · ${date}`,
      '',
      `Foto real: ${report.photo.name} (${report.photo.w} × ${report.photo.h}, analisada em ${report.W} × ${report.H}).`,
      '',
      report.setup,
      '',
      '| Medida | Real | Simulado | Diferença | Dentro do limite |',
      '|---|---|---|---|---|',
      ...report.rows.map(([k, a, b, d, ok]) => `| ${k} | ${a} | ${b} | ${d} | ${ok ? 'sim' : 'não'} |`),
      '',
      'Limites: largura ±5%, matiz ±8°, saturação ±10 pontos, brilho ±15%, ruído ±50%, fita reconhecida ±10 pontos, reflexo ±5 pontos, lux ±15%.',
      'Medidas feitas em relação à fita achada em cada imagem (src/core/validation.js).',
      '',
    ].join('\n');
    try {
      const res = await saveFile(`validacao-${store.get().scene.camera.modelId}-${date}.md`, md);
      if (res === 'saved') notify('Relatório de validação salvo.');
    } catch (e) {
      notify(`Não foi possível salvar: ${e.message}`, 'bad');
    }
  });

  /* ---------- Topo: arquivos ---------- */
  $('#btn-example').addEventListener('click', () => {
    const sc = exampleScene();
    store.update((st) => { st.scene = sc; st.ui.selectedId = sc.objects[1].id; }, { structural: true });
    notify('Cena de exemplo carregada.');
  });
  $('#btn-save').addEventListener('click', async () => {
    try {
      const sc = store.get().scene;
      const name = (sc.name || 'cena').replace(/[^\w\-]+/g, '-').toLowerCase();
      const res = await saveFile(`${name}.json`, JSON.stringify(sc, null, 2));
      if (res === 'saved') notify('Cena salva.');
    } catch (e) {
      notify(`Não foi possível salvar: ${e.message}`, 'bad');
    }
  });
  $('#btn-shot').addEventListener('click', async () => {
    if (!last) return;
    const c = document.createElement('canvas');
    c.width = last.width;
    c.height = last.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(els.cam, 0, 0);
    if (store.get().scene.detection.showMask) ctx.drawImage(els.overlay, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    try {
      const res = await saveFile(`imagem-camera-${store.get().scene.camera.modelId}.png`, blob);
      if (res === 'saved') notify('Imagem da câmera salva.');
    } catch (e) {
      notify(`Não foi possível salvar: ${e.message}`, 'bad');
    }
  });
  $('#file-open').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const sc = normalizeScene(JSON.parse(await readFileAsText(f)));
      store.update((st) => { st.scene = sc; st.ui.selectedId = sc.objects[0]?.id ?? null; }, { structural: true });
      notify(`Cena "${sc.name || f.name}" aberta.`);
    } catch (err) {
      notify(err instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : err.message, 'bad');
    }
    e.target.value = '';
  });
  $('#btn-shoot').addEventListener('click', () => store.update((st) => { st.ui.captureSeed++; }));
  $('#tgl-mask').addEventListener('change', (e) => store.update((st) => { st.scene.detection.showMask = e.target.checked; }));

  /* ---------- Assinaturas ---------- */
  store.subscribe(({ structural, camera }) => {
    const st = store.get();
    if (structural) rebuildPanel();
    else refreshers.forEach((r) => r());
    $('#tgl-mask').checked = st.scene.detection.showMask;
    els.sceneName.textContent = st.scene.name || '';
    drawViews();
    if (camera) scheduleCamera();
    autosave(st.scene);
  });
  setAssetListener(() => { drawViews(); scheduleCamera(10); });
  new ResizeObserver(() => drawViews()).observe(document.querySelector('.stage'));

  rebuildPanel();
  $('#tgl-mask').checked = store.get().scene.detection.showMask;
  els.sceneName.textContent = store.get().scene.name || '';
  drawViews();
  scheduleCamera(0);
}

const hot = window.claude?.hot;
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? null);
