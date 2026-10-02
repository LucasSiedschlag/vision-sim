// Regras da cena: empilhamento, câmera resolvida e indicadores. Puro, sem DOM.

import { CAMERAS, customCamera, isZoom } from '../presets/cameras.js';
import { lensState, focalPx, footprint, mmPerPixel, depthOfField } from './optics.js';
import { hexToRgb, rgbToHsv } from './color.js';
import { lightSources, lightMix, dayVariation, combinedFlicker, isFlickerSafe } from './lighting.js';

/** Altura da base de cada objeto, seguindo a cadeia "apoiar sobre". */
export function resolveHeights(objects) {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const memo = new Map();
  const base = (o, seen = new Set()) => {
    if (memo.has(o.id)) return memo.get(o.id);
    let z = Number(o.baseZ) || 0;
    if (o.sitOn && byId.has(o.sitOn) && !seen.has(o.id)) {
      seen.add(o.id);
      const parent = byId.get(o.sitOn);
      z = base(parent, seen) + parent.h;
    }
    memo.set(o.id, z);
    return z;
  };
  return objects.map((o) => {
    const z0 = base(o);
    return { ...o, z0, z1: z0 + o.h };
  });
}

/** Objetos visíveis, do mais baixo para o mais alto (ordem de desenho de cima). */
export function drawOrder(resolved) {
  return resolved
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.visible)
    .sort((a, b) => a.o.z1 - b.o.z1 || a.i - b.i)
    .map(({ o }) => o);
}

export function cameraModel(sceneCam) {
  if (sceneCam.modelId === 'custom') return customCamera(sceneCam.custom || {});
  return CAMERAS.find((c) => c.id === sceneCam.modelId) || CAMERAS[0];
}

/** Câmera pronta para renderizar: modelo + zoom + posição. */
export function resolveCamera(sceneCam) {
  const model = cameraModel(sceneCam);
  const lens = lensState(model, sceneCam.zoom);
  return {
    model,
    lens,
    zoomable: isZoom(model),
    x: sceneCam.x, y: sceneCam.y, z: sceneCam.z,
    w: model.widthPx, h: model.heightPx,
    fpx: focalPx(model.widthPx, lens.hfov),
  };
}

/** Plano de referência para os indicadores: topo do alvo mais alto, senão o topo mais alto. */
export function targetPlane(resolved) {
  const vis = resolved.filter((o) => o.visible);
  const targets = vis.filter((o) => o.isTarget);
  const pool = targets.length ? targets : vis;
  if (!pool.length) return { z: 0, target: null };
  const top = pool.reduce((a, b) => (b.z1 > a.z1 ? b : a));
  return { z: top.z1, target: targets.length ? top : null };
}

/** Luz total na bancada (lux) e temperatura de cor média (mistura em mired). */
export function effectiveLight(light) {
  const src = lightSources(light);
  const lux = src.reduce((a, s) => a + s.lux, 0);
  const mired = src.reduce((a, s) => a + s.lux * (1e6 / s.kelvin), 0) / Math.max(lux, 1);
  return { lux, kelvin: lux ? 1e6 / mired : 5000 };
}

export function detectionParams(det) {
  const [r, g, b] = hexToRgb(det.color);
  const [hue] = rgbToHsv(r, g, b);
  return { hue, hueTol: det.hueTol, sMin: det.sMin, vMin: det.vMin };
}

/** Indicadores de enquadramento e óptica. */
export function opticsMetrics(scene) {
  const resolved = resolveHeights(scene.objects);
  const cam = resolveCamera(scene.camera);
  const plane = targetPlane(resolved);
  const dist = cam.z - plane.z;
  const fp = footprint(dist, cam.lens.hfov, cam.w, cam.h);
  const mmpx = mmPerPixel(dist, cam.lens.hfov, cam.w);
  const targetSize = plane.target ? Math.min(plane.target.w, plane.target.d) : null;
  const coc = cam.lens.pitchMm * 2;
  const dof = depthOfField(cam.lens.focalMm, cam.lens.aperture, coc, Math.max(dist, cam.lens.focalMm * 20));
  const lowest = resolved.filter((o) => o.visible && o.kind !== 'flat').reduce((m, o) => Math.min(m, o.z1), plane.z);
  const sharp = dist >= dof.near - 1 && cam.z - lowest <= dof.far + 1;
  return {
    distanceMm: dist,
    fieldW: fp.width,
    fieldH: fp.height,
    mmPerPx: mmpx,
    targetPx: targetSize ? targetSize / mmpx : null,
    targetName: plane.target?.name ?? null,
    hfov: cam.lens.hfov,
    focalMm: cam.lens.focalMm,
    dofNear: dof.near,
    dofFar: dof.far,
    allSharp: sharp,
    resolution: `${cam.w}×${cam.h}`,
  };
}

export function lightingMetrics(scene, shutterUsed) {
  const eff = effectiveLight(scene.light);
  const flicker = combinedFlicker(scene.light, shutterUsed);
  const mix = lightMix(scene.light, shutterUsed);
  const day = dayVariation(scene.light, shutterUsed);
  const src = lightSources(scene.light);
  return {
    lux: eff.lux,
    kelvin: eff.kelvin,
    flickerSpread: flicker,
    flickerSafe: isFlickerSafe(shutterUsed) || src.every((s) => !s.flicker || s.flicker < 0.01),
    benchShare: mix.shares.bench || 0,
    ambientShare: mix.shares.ambient || 0,
    daySpread: day.spread,
    ambientOn: src.some((s) => s.group === 'ambient'),
  };
}

/* ---------- Modo de detecção ---------- */

const LOGO_TEXTURES = new Set(['tape-logo', 'tape-clear-logo']);

/** 'cor' (fita colorida: área) ou 'logo' (logo repetido ao longo da emenda). 'auto' decide pelo alvo visível. */
export function detectionMode(scene) {
  const m = scene.detection.mode || 'auto';
  if (m !== 'auto') return m;
  const t = scene.objects.filter((o) => o.isTarget && o.visible).pop();
  return t && (LOGO_TEXTURES.has(t.texture) || t.image) ? 'logo' : 'cor';
}

/* ---------- Várias caixas com a câmera fixa ---------- */

export const DEFAULT_BOX_VARIANTS = [
  { id: 'p', name: 'Caixa P', w: 400, d: 300, h: 200 },
  { id: 'm', name: 'Caixa M', w: 500, d: 350, h: 300 },
  { id: 'g', name: 'Caixa G', w: 600, d: 400, h: 350 },
  { id: 'gg', name: 'Caixa GG', w: 600, d: 450, h: 400 },
];

/** Caixa principal da cena (papel "box"; se não houver, a primeira caixa com textura de papelão). */
export function mainBox(scene) {
  return scene.objects.find((o) => o.role === 'box') || scene.objects.find((o) => o.texture === 'kraft') || null;
}

/**
 * Troca as medidas da caixa principal mantendo a câmera onde está.
 * As fitas apoiadas nela acompanham o comprimento e a posição.
 * align 'centro': caixa centralizada no apoio; 'batente': encostada no canto traseiro esquerdo.
 */
export function applyBoxVariant(scene, variant) {
  const box = mainBox(scene);
  if (!box || !variant) return;
  box.w = variant.w;
  box.d = variant.d;
  box.h = variant.h;
  const base = scene.objects.find((o) => o.id === box.sitOn);
  const align = scene.boxes?.align || 'centro';
  if (base) {
    if (align === 'batente') {
      box.x = base.x - base.w / 2 + box.w / 2 + 10;
      box.y = base.y - base.d / 2 + box.d / 2 + 10;
    } else {
      box.x = base.x;
      box.y = base.y;
    }
    box.rot = 0;
  }
  for (const t of scene.objects) {
    if (t.sitOn !== box.id || t.kind !== 'flat') continue;
    if (t.role === 'tape' || t.isTarget) {
      t.w = box.w;
      t.x = box.x;
      t.y = box.y;
      t.rot = box.rot;
    }
  }
}

/** A caixa principal cabe inteira na imagem? Retorna folga mínima em pixels (negativa = cortada). */
export function boxInView(scene) {
  const box = resolveHeights(scene.objects).find((o) => o.id === mainBox(scene)?.id);
  if (!box || !box.visible) return null;
  const cam = resolveCamera(scene.camera);
  let margin = Infinity;
  for (const z of [box.z0, box.z1]) {
    for (const p of rectCornersAt(box, z)) {
      const depth = cam.z - p.z;
      if (depth <= 1) return { inside: false, marginPx: -Infinity };
      const u = cam.w / 2 + ((p.x - cam.x) * cam.fpx) / depth;
      const v = cam.h / 2 + ((p.y - cam.y) * cam.fpx) / depth;
      margin = Math.min(margin, u, v, cam.w - u, cam.h - v);
    }
  }
  return { inside: margin >= 0, marginPx: margin };
}

function rectCornersAt(o, z) {
  const r = (o.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({
    x: o.x + (a * o.w / 2) * c - (b * o.d / 2) * s,
    y: o.y + (a * o.w / 2) * s + (b * o.d / 2) * c,
    z,
  }));
}
