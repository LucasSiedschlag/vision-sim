// Regras da cena: empilhamento, câmera resolvida e indicadores. Puro, sem DOM.

import { CAMERAS, customCamera, isZoom } from '../presets/cameras.js';
import { lensState, lensProjection, projectImage, depthOfField, DEG } from './optics.js';
import { hexToRgb, rgbToHsv } from './color.js';
import { sensorFor } from './sensor.js';
import { lightSources, lightMix, dayVariation, combinedFlicker, isFlickerSafe, shutterLabel, normalizeLight } from './lighting.js';

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

/**
 * Modelo da câmera da cena. Se a câmera saiu do catálogo, usa a cópia salva com a cena (`snapshot`) e
 * marca `missing`; sem cópia, cai na primeira do catálogo.
 */
export function cameraModel(sceneCam) {
  if (sceneCam.modelId === 'custom') return customCamera(sceneCam.custom || {});
  const cam = CAMERAS.find((c) => c.id === sceneCam.modelId);
  if (cam) return cam;
  if (sceneCam.snapshot) return { ...customCamera(sceneCam.snapshot), id: sceneCam.modelId, missing: true };
  return { ...(CAMERAS[0] || customCamera()), missing: true };
}

/** Cena para salvar: leva uma cópia dos dados da câmera, para abrir mesmo se ela sair do catálogo. */
export function withCameraSnapshot(scene) {
  const c = scene.camera;
  if (c.modelId === 'custom') return scene;
  const model = cameraModel(c);
  return { ...scene, camera: { ...c, snapshot: model.missing ? c.snapshot ?? null : model } };
}

/**
 * Câmera pronta para renderizar: modelo + zoom + posição + projeção da lente.
 * fpx: escala no centro da imagem; lambda: distorção; hfov/vfov: campo que a imagem entregue mostra.
 */
export function resolveCamera(sceneCam) {
  const model = cameraModel(sceneCam);
  const lens = lensState(model, sceneCam.zoom);
  const proj = lensProjection(model.widthPx, model.heightPx, lens.hfov, lens.k1, sceneCam.distortion !== false);
  return {
    model,
    lens,
    sensor: sensorFor(model, lens.sensorW),
    zoomable: isZoom(model),
    x: sceneCam.x, y: sceneCam.y, z: sceneCam.z,
    w: model.widthPx, h: model.heightPx,
    fpx: proj.fpx, lambda: proj.lambda, hfov: proj.hfov, vfov: proj.vfov, cornerScale: proj.cornerScale,
  };
}

/** Largura e altura (mm) do campo que a imagem mostra num plano a `distanceMm` da câmera. */
export function fieldAt(cam, distanceMm) {
  return {
    width: 2 * distanceMm * Math.tan((cam.hfov * DEG) / 2),
    height: 2 * distanceMm * Math.tan((cam.vfov * DEG) / 2),
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

/**
 * Contexto da luz: câmera (ring light e domo acompanham) e ponto de referência, o centro do topo do
 * alvo (ou do objeto mais alto). É onde se mede a iluminância de cada luminária.
 */
export function lightContext(scene) {
  const resolved = resolveHeights(scene.objects);
  const plane = targetPlane(resolved);
  const vis = resolved.filter((o) => o.visible);
  const at = plane.target || vis.find((o) => o.z1 === plane.z) || null;
  const c = scene.camera;
  return { camera: { x: c.x, y: c.y, z: c.z }, ref: { x: at ? at.x : c.x, y: at ? at.y : c.y, z: plane.z } };
}

/** Luz total no alvo (lux) e temperatura de cor média (mistura em mired). */
export function effectiveLight(scene) {
  const src = lightSources(scene.light, lightContext(scene));
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
  const fp = fieldAt(cam, dist);
  const mmpx = dist / cam.fpx; // no centro da imagem; com distorção em barril, as bordas cobrem mais mm por pixel
  const targetSize = plane.target ? Math.min(plane.target.w, plane.target.d) : null;
  const coc = (cam.sensor.pixelUm / 1000) * 2;
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
    hfov: cam.hfov,
    focalMm: cam.lens.focalMm,
    dofNear: dof.near,
    dofFar: dof.far,
    allSharp: sharp,
    resolution: `${cam.w}×${cam.h}`,
  };
}

export function lightingMetrics(scene, shutterUsed) {
  const ctx = lightContext(scene);
  const eff = effectiveLight(scene);
  const flicker = combinedFlicker(scene.light, shutterUsed, ctx);
  const mix = lightMix(scene.light, shutterUsed, ctx);
  const day = dayVariation(scene.light, shutterUsed, ctx);
  const src = lightSources(scene.light, ctx);
  return {
    lux: eff.lux,
    kelvin: eff.kelvin,
    rollingShutter: cameraModel(scene.camera).shutterType !== 'global',
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
      const q = projectImage(p, cam); // com a distorção: é o que a imagem entregue mostra
      if (!q) return { inside: false, marginPx: -Infinity };
      margin = Math.min(margin, q.u, q.v, cam.w - q.u, cam.h - q.v);
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

/* ---------- Recursos da câmera ---------- */

const WB_LABEL = { auto: 'automático', 'manual-k': 'temperatura', 'manual-rgb': 'manual RGB' };

/**
 * Ajustes da cena que a câmera real não tem, pelo catálogo (colunas de configuração). O simulador deixa
 * usar ("e se?"), mas avisa. Campo vazio no catálogo = não informado: sem aviso.
 * Retorna [{ key, message }].
 */
export function cameraWarnings(scene) {
  const c = scene.camera, caps = cameraModel(c).caps || {};
  const out = [];
  const manual = c.exposureMode === 'manual';
  if (manual && caps.manualExposure === false) out.push({ key: 'exposure', message: 'Esta câmera não tem exposição manual: na real, só automática.' });
  if (manual && caps.shutterMin != null && c.shutter < caps.shutterMin * 0.999) {
    out.push({ key: 'shutter', message: `Obturador ${shutterLabel(c.shutter)} é mais curto que o mínimo da câmera (${shutterLabel(caps.shutterMin)}).` });
  }
  if (manual && caps.shutterMax != null && c.shutter > caps.shutterMax * 1.001) {
    out.push({ key: 'shutter', message: `Obturador ${shutterLabel(c.shutter)} é mais longo que o máximo da câmera (${shutterLabel(caps.shutterMax)}).` });
  }
  if (manual && caps.gainMaxDb != null && c.gainDb > caps.gainMaxDb) {
    out.push({ key: 'gain', message: `Ganho de ${c.gainDb} dB passa do máximo da câmera (${caps.gainMaxDb} dB).` });
  }
  if (caps.wbModes && !caps.wbModes.includes(c.wbMode)) {
    out.push({ key: 'wb', message: `Balanço "${WB_LABEL[c.wbMode]}" não existe nesta câmera (tem: ${caps.wbModes.map((m) => WB_LABEL[m]).join(', ')}).` });
  }
  if (c.exposureMode === 'auto' && c.antiFlicker && caps.antiFlicker === false) {
    out.push({ key: 'antiflicker', message: 'Esta câmera não tem anti-cintilação: na real, as faixas das lâmpadas aparecem.' });
  }
  if (c.distortion === false && caps.ldc === false) {
    out.push({ key: 'ldc', message: 'Esta câmera não corrige distorção (LDC): na real, a imagem sai distorcida.' });
  }
  if (normalizeLight(scene.light).fixtures.some((f) => f.on && f.strobe) && caps.trigger === false) {
    out.push({ key: 'strobe', message: 'Luz pulsada sincronizada precisa de saída de disparo, que esta câmera não tem.' });
  }
  if (c.colorMode === 'bw' && caps.dayNight === 'não') {
    out.push({ key: 'bw', message: 'Esta câmera não tem modo noite em preto e branco.' });
  }
  return out;
}
