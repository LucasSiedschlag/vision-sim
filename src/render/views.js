// Vista de cima (planta) e vista de frente (elevação), em escala real.

import { resolveHeights, drawOrder, resolveCamera, targetPlane, opticsMetrics, fieldAt } from '../core/scene.js';
import { normalizeLight, resolveLuminaire, glarePoint, FIXTURE_MODELS } from '../core/lighting.js';
import { rectCorners, DEG } from '../core/optics.js';
import { topTexture, sideColor } from './textures.js';

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const w = Math.max(10, Math.round(r.width * dpr)), h = Math.max(10, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

function niceStep(mmPerPx, targetPx) {
  const raw = mmPerPx * targetPx;
  const steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return steps.find((s) => s >= raw) || 5000;
}

function label(ctx, text, x, y, opts = {}) {
  const { dpr = 1, color = token('--fg'), bg = token('--panel'), align = 'left', size = 11 } = opts;
  ctx.font = `500 ${size * dpr}px ${token('--font-mono') || 'monospace'}`;
  const m = ctx.measureText(text);
  const pad = 4 * dpr;
  const w = m.width + pad * 2, h = (size + 6) * dpr;
  let x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  x0 = Math.max(2 * dpr, Math.min(ctx.canvas.width - w - 2 * dpr, x0));
  y = Math.max(h / 2 + 2 * dpr, Math.min(ctx.canvas.height - h / 2 - 2 * dpr, y));
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.88;
  ctx.fillRect(x0, y - h / 2, w, h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x0 + pad, y + 0.5 * dpr);
}

export const topViewport = { scale: 1, minX: 0, minY: 0, ox: 0, oy: 0, dpr: 1 };
export const frontViewport = { scale: 1, minX: 0, maxZ: 0, ox: 0, oy: 0, dpr: 1 };

// Enquadramento travado durante um arrasto: sem isso a escala muda enquanto o mouse se move
// e o objeto "acelera" (o campo de visão e a altura da câmera alteram os limites da vista).
const lastBounds = { top: null, front: null };
const locked = { top: null, front: null };
export function lockViews(on) {
  locked.top = on ? lastBounds.top : null;
  locked.front = on ? lastBounds.front : null;
}

/** Converte um ponto do canvas (px CSS) em coordenadas do mundo (mm). */
export function topToWorld(px, py) {
  const v = topViewport;
  return { x: v.minX + (px * v.dpr - v.ox) / v.scale, y: v.minY + (py * v.dpr - v.oy) / v.scale };
}

export function frontToWorld(px, py) {
  const v = frontViewport;
  return { x: v.minX + (px * v.dpr - v.ox) / v.scale, z: v.maxZ - (py * v.dpr - v.oy) / v.scale };
}

function sceneBounds(scene, resolved, cam) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const add = (x, y) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const o of resolved) if (o.visible) rectCorners(o, 0).forEach((p) => add(p.x, p.y));
  for (const { lum } of sceneFixtures(scene)) {
    const r = lum.shape === 'rect' ? Math.hypot(lum.w, lum.d) / 2 : lum.shape === 'ring' ? lum.rOut : lum.shape === 'dome' ? lum.R : lum.r;
    add(lum.x - r, lum.y - r);
    add(lum.x + r, lum.y + r);
  }
  const plane = targetPlane(resolved);
  const fp = fieldAt(cam, cam.z - plane.z);
  add(cam.x - fp.width / 2, cam.y - fp.height / 2);
  add(cam.x + fp.width / 2, cam.y + fp.height / 2);
  if (!Number.isFinite(minX)) { minX = -500; maxX = 500; minY = -400; maxY = 400; }
  const padX = (maxX - minX) * 0.06 + 40, padY = (maxY - minY) * 0.06 + 40;
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}

export function drawTopView(canvas, scene, ui) {
  const { w, h, dpr } = fitCanvas(canvas);
  const ctx = canvas.getContext('2d');
  const resolved = resolveHeights(scene.objects);
  const cam = resolveCamera(scene.camera);
  const b = locked.top || sceneBounds(scene, resolved, cam);
  lastBounds.top = b;
  const scale = Math.min(w / (b.maxX - b.minX), h / (b.maxY - b.minY));
  const ox = (w - (b.maxX - b.minX) * scale) / 2, oy = (h - (b.maxY - b.minY) * scale) / 2;
  Object.assign(topViewport, { scale, minX: b.minX, minY: b.minY, ox, oy, dpr });
  const X = (x) => ox + (x - b.minX) * scale;
  const Y = (y) => oy + (y - b.minY) * scale;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = token('--view-bg');
  ctx.fillRect(0, 0, w, h);

  // Grade
  const step = niceStep(1 / scale, 60 * dpr);
  ctx.strokeStyle = token('--grid');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.ceil(b.minX / step) * step; x <= b.maxX; x += step) { ctx.moveTo(X(x) + 0.5, 0); ctx.lineTo(X(x) + 0.5, h); }
  for (let y = Math.ceil(b.minY / step) * step; y <= b.maxY; y += step) { ctx.moveTo(0, Y(y) + 0.5); ctx.lineTo(w, Y(y) + 0.5); }
  ctx.stroke();

  // Objetos
  for (const o of drawOrder(resolved)) {
    const c = Math.cos(o.rot * DEG) * scale, s = Math.sin(o.rot * DEG) * scale;
    ctx.setTransform(c, s, -s, c, X(o.x), Y(o.y));
    ctx.globalAlpha = Math.max(0.15, o.opacity);
    ctx.drawImage(topTexture(o), -o.w / 2, -o.d / 2, o.w, o.d);
    ctx.globalAlpha = 1;
    const sel = ui.selectedId === o.id;
    ctx.strokeStyle = sel ? token('--accent') : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = (sel ? 2.5 : 1) * dpr / scale;
    ctx.strokeRect(-o.w / 2, -o.d / 2, o.w, o.d);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const plane = targetPlane(resolved);
  drawFixturesTop(ctx, scene, plane, { X, Y, scale, dpr }, ui);

  // Campo de visão
  const fpT = fieldAt(cam, cam.z - plane.z);
  const fpB = fieldAt(cam, cam.z);
  const accent = token('--accent');
  ctx.strokeStyle = accent;
  ctx.setLineDash([6 * dpr, 5 * dpr]);
  ctx.lineWidth = 1.2 * dpr;
  ctx.strokeRect(X(cam.x - fpB.width / 2), Y(cam.y - fpB.height / 2), fpB.width * scale, fpB.height * scale);
  ctx.setLineDash([]);
  ctx.lineWidth = 2 * dpr;
  ctx.strokeRect(X(cam.x - fpT.width / 2), Y(cam.y - fpT.height / 2), fpT.width * scale, fpT.height * scale);
  ctx.fillStyle = token('--accent-soft');
  ctx.fillRect(X(cam.x - fpT.width / 2), Y(cam.y - fpT.height / 2), fpT.width * scale, fpT.height * scale);
  label(ctx, `campo no alvo ${Math.round(fpT.width)} × ${Math.round(fpT.height)} mm`,
    X(cam.x - fpT.width / 2) + 4 * dpr, Y(cam.y - fpT.height / 2) + 12 * dpr, { dpr, color: accent });
  const by = Y(cam.y + fpB.height / 2);
  if (by < h - 10 * dpr) {
    label(ctx, `campo na bancada ${Math.round(fpB.width)} × ${Math.round(fpB.height)} mm`,
      X(cam.x - fpB.width / 2) + 4 * dpr, by - 12 * dpr, { dpr, color: token('--muted') });
  }

  // Câmera
  const cx = X(cam.x), cy = Y(cam.y);
  ctx.fillStyle = token('--cam');
  ctx.strokeStyle = token('--view-bg');
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.arc(cx, cy, 8 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = token('--view-bg');
  ctx.fill();

  // Barra de escala
  const barMm = niceStep(1 / scale, 90 * dpr);
  const bx = 12 * dpr, byy = h - 14 * dpr;
  ctx.strokeStyle = token('--fg');
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(bx, byy); ctx.lineTo(bx + barMm * scale, byy);
  ctx.moveTo(bx, byy - 4 * dpr); ctx.lineTo(bx, byy + 4 * dpr);
  ctx.moveTo(bx + barMm * scale, byy - 4 * dpr); ctx.lineTo(bx + barMm * scale, byy + 4 * dpr);
  ctx.stroke();
  label(ctx, `${barMm} mm`, bx + barMm * scale + 6 * dpr, byy, { dpr, color: token('--muted') });
}

export function drawFrontView(canvas, scene, ui) {
  const { w, h, dpr } = fitCanvas(canvas);
  const ctx = canvas.getContext('2d');
  const resolved = resolveHeights(scene.objects);
  const cam = resolveCamera(scene.camera);
  const m = opticsMetrics(scene);
  const plane = targetPlane(resolved);

  // Limites: largura do campo na bancada, objetos e câmera
  const half = cam.z * Math.tan((cam.hfov * DEG) / 2);
  let fb = locked.front;
  if (!fb) {
    let minX = cam.x - half, maxX = cam.x + half;
    for (const o of resolved) if (o.visible) rectCorners(o, 0).forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); });
    for (const { lum } of sceneFixtures(scene)) {
      const r = lum.shape === 'rect' ? Math.max(lum.w, lum.d) / 2 : lum.shape === 'ring' ? lum.rOut : lum.shape === 'dome' ? lum.R : lum.r;
      minX = Math.min(minX, lum.x - r); maxX = Math.max(maxX, lum.x + r);
    }
    const maxTop = Math.max(cam.z, ...resolved.filter((o) => o.visible).map((o) => o.z1));
    const padX = (maxX - minX) * 0.08 + 60;
    fb = { minX: minX - padX, maxX: maxX + padX, minZ: -Math.max(80, maxTop * 0.1), maxZ: maxTop * 1.12 + 60 };
  }
  lastBounds.front = fb;
  const { minX, maxX, minZ, maxZ } = fb;
  const scale = Math.min(w / (maxX - minX), h / (maxZ - minZ));
  const ox = (w - (maxX - minX) * scale) / 2, oy = (h - (maxZ - minZ) * scale) / 2;
  Object.assign(frontViewport, { scale, minX, maxZ, ox, oy, dpr });
  const X = (x) => ox + (x - minX) * scale;
  const Z = (z) => oy + (maxZ - z) * scale;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = token('--view-bg');
  ctx.fillRect(0, 0, w, h);

  // Grade horizontal (alturas)
  const step = niceStep(1 / scale, 50 * dpr);
  ctx.strokeStyle = token('--grid');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let z = 0; z <= maxZ; z += step) { ctx.moveTo(0, Z(z) + 0.5); ctx.lineTo(w, Z(z) + 0.5); }
  ctx.stroke();

  // Bancada
  ctx.fillStyle = token('--bench');
  ctx.fillRect(0, Z(0), w, h - Z(0));
  ctx.strokeStyle = token('--fg');
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(0, Z(0)); ctx.lineTo(w, Z(0)); ctx.stroke();

  // Cone do campo de visão
  const accent = token('--accent');
  ctx.fillStyle = token('--accent-soft');
  ctx.beginPath();
  ctx.moveTo(X(cam.x), Z(cam.z));
  ctx.lineTo(X(cam.x - half), Z(0));
  ctx.lineTo(X(cam.x + half), Z(0));
  ctx.closePath();
  ctx.fill();

  // Faixa nítida (profundidade de campo)
  const zFar = Math.max(minZ, cam.z - (Number.isFinite(m.dofFar) ? m.dofFar : cam.z * 4));
  const zNear = Math.min(cam.z, cam.z - m.dofNear);
  if (zNear > zFar) {
    ctx.fillStyle = token('--dof');
    ctx.fillRect(0, Z(zNear), w, Z(zFar) - Z(zNear));
  }

  // Objetos, do fundo para a frente (observador do lado +y)
  const objs = resolved.filter((o) => o.visible).sort((a, b) => a.y - b.y);
  for (const o of objs) {
    const xs = rectCorners(o, 0).map((p) => p.x);
    const x0 = X(Math.min(...xs)), x1 = X(Math.max(...xs));
    const top = Z(o.z1), bot = Z(o.z0);
    const hh = Math.max(2.5 * dpr, bot - top);
    ctx.globalAlpha = 0.92 * Math.max(0.2, o.opacity);
    ctx.fillStyle = sideColor(o);
    ctx.fillRect(x0, bot - hh, x1 - x0, hh);
    ctx.globalAlpha = 1;
    const sel = ui.selectedId === o.id;
    ctx.strokeStyle = sel ? accent : 'rgba(0,0,0,0.45)';
    ctx.lineWidth = (sel ? 2.5 : 1) * dpr;
    ctx.strokeRect(x0, bot - hh, x1 - x0, hh);
  }

  // Linhas do cone
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.2 * dpr;
  ctx.setLineDash([6 * dpr, 5 * dpr]);
  ctx.beginPath();
  ctx.moveTo(X(cam.x), Z(cam.z)); ctx.lineTo(X(cam.x - half), Z(0));
  ctx.moveTo(X(cam.x), Z(cam.z)); ctx.lineTo(X(cam.x + half), Z(0));
  ctx.stroke();
  ctx.setLineDash([]);

  // Largura do campo no plano do alvo
  const fpT = fieldAt(cam, cam.z - plane.z);
  ctx.lineWidth = 2.5 * dpr;
  ctx.beginPath();
  ctx.moveTo(X(cam.x - fpT.width / 2), Z(plane.z));
  ctx.lineTo(X(cam.x + fpT.width / 2), Z(plane.z));
  ctx.stroke();
  label(ctx, `${Math.round(fpT.width)} mm`, X(cam.x + fpT.width / 2) + 6 * dpr, Z(plane.z) - 10 * dpr, { dpr, color: accent });

  drawFixturesFront(ctx, scene, { X, Z, dpr });

  // Câmera
  const cx = X(cam.x), cz = Z(cam.z);
  ctx.fillStyle = token('--cam');
  ctx.fillRect(cx - 14 * dpr, cz - 20 * dpr, 28 * dpr, 16 * dpr);
  ctx.fillRect(cx - 6 * dpr, cz - 5 * dpr, 12 * dpr, 6 * dpr);

  // Cotas
  const rx = 14 * dpr;
  ctx.strokeStyle = token('--muted');
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.moveTo(rx, Z(0)); ctx.lineTo(rx, cz);
  ctx.moveTo(rx - 4 * dpr, Z(0)); ctx.lineTo(rx + 4 * dpr, Z(0));
  ctx.moveTo(rx - 4 * dpr, cz); ctx.lineTo(rx + 4 * dpr, cz);
  ctx.stroke();
  label(ctx, `altura ${Math.round(cam.z)} mm`, rx + 6 * dpr, cz + 10 * dpr, { dpr, color: token('--muted') });
  label(ctx, `${Math.round(m.distanceMm)} mm até o alvo`, cx + 8 * dpr, (cz + Z(plane.z)) / 2, { dpr });
  if (zNear > zFar) label(ctx, 'faixa nítida', w - 8 * dpr, Z(Math.max(zFar, 0)) - 12 * dpr, { dpr, color: token('--ok'), align: 'right' });
}

/* ---------- Luminárias nas vistas ---------- */

/** Luminárias ligadas, com a forma resolvida (ring light e domo seguem a câmera). */
export function sceneFixtures(scene) {
  const L = normalizeLight(scene.light);
  return L.fixtures.filter((f) => f.on).map((f) => ({ f, lum: resolveLuminaire(f, scene.camera), model: FIXTURE_MODELS[f.model] }));
}

function drawFixturesTop(ctx, scene, plane, { X, Y, scale, dpr }, ui) {
  const warn = token('--warn');
  for (const { f, lum, model } of sceneFixtures(scene)) {
    ctx.save();
    ctx.strokeStyle = warn;
    ctx.fillStyle = token('--warn-soft');
    ctx.lineWidth = (ui.selectedFixture === f.id ? 2.5 : 1.5) * dpr;
    ctx.setLineDash(lum.diffused ? [4 * dpr, 3 * dpr] : []);
    ctx.beginPath();
    if (lum.shape === 'rect') {
      ctx.translate(X(lum.x), Y(lum.y));
      ctx.rotate(lum.rot);
      ctx.rect((-lum.w / 2) * scale, (-lum.d / 2) * scale, lum.w * scale, lum.d * scale);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else if (lum.shape === 'sphere') {
      ctx.arc(X(lum.x), Y(lum.y), Math.max(4 * dpr, lum.r * scale), 0, Math.PI * 2);
    } else if (lum.shape === 'ring') {
      ctx.arc(X(lum.x), Y(lum.y), lum.rOut * scale, 0, Math.PI * 2);
      ctx.moveTo(X(lum.x) + lum.rIn * scale, Y(lum.y));
      ctx.arc(X(lum.x), Y(lum.y), lum.rIn * scale, 0, Math.PI * 2, true);
    } else if (lum.shape === 'dome') {
      ctx.arc(X(lum.x), Y(lum.y), lum.R * scale, 0, Math.PI * 2);
    }
    ctx.fill('evenodd');
    ctx.stroke();
    ctx.restore();
    if (!model.fixedToCamera) {
      label(ctx, `${model.label.split(' ')[0]} ${Math.round(f.z)} mm`, X(lum.x), Y(lum.y) - 14 * dpr, { dpr, color: warn, align: 'center', size: 10 });
    }
    // onde o reflexo do centro da luminária aparece no plano do alvo
    const g = lum.shape === 'dome' ? null : glarePoint(lum, scene.camera, plane.z);
    if (g) {
      const gx = X(g.x), gy = Y(g.y), r = 5 * dpr;
      ctx.strokeStyle = warn;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(gx - r, gy); ctx.lineTo(gx + r, gy);
      ctx.moveTo(gx, gy - r); ctx.lineTo(gx, gy + r);
      ctx.moveTo(gx - r * 0.7, gy - r * 0.7); ctx.lineTo(gx + r * 0.7, gy + r * 0.7);
      ctx.moveTo(gx - r * 0.7, gy + r * 0.7); ctx.lineTo(gx + r * 0.7, gy - r * 0.7);
      ctx.stroke();
      label(ctx, 'reflexo', gx + 8 * dpr, gy, { dpr, color: warn, size: 10 });
    }
  }
}

function drawFixturesFront(ctx, scene, { X, Z, dpr }) {
  const warn = token('--warn');
  for (const { lum } of sceneFixtures(scene)) {
    ctx.fillStyle = warn;
    ctx.strokeStyle = warn;
    ctx.lineWidth = 1.5 * dpr;
    if (lum.shape === 'dome') {
      const r = lum.R;
      ctx.beginPath();
      ctx.moveTo(X(lum.x - r), Z(lum.z));
      ctx.lineTo(X(lum.x + r), Z(lum.z));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(X(lum.x), Z(lum.z), Math.abs(X(lum.x + r) - X(lum.x)), Math.PI, 2 * Math.PI);
      ctx.stroke();
      continue;
    }
    // extensão em X da forma emissora
    let half;
    if (lum.shape === 'rect') half = (Math.abs(Math.cos(lum.rot)) * lum.w + Math.abs(Math.sin(lum.rot)) * lum.d) / 2;
    else if (lum.shape === 'ring') half = lum.rOut;
    else half = lum.r;
    const x0 = X(lum.x - half), x1 = X(lum.x + half);
    ctx.fillRect(x0, Z(lum.z) - 3 * dpr, Math.max(4 * dpr, x1 - x0), 5 * dpr);
  }
}
