// Imagem simulada da câmera: geometria em perspectiva → luz → exposição → balanço de branco
// → ruído → modo de cor → compressão JPEG → detecção.

import { resolveHeights, drawOrder, resolveCamera, effectiveLight, detectionParams, detectionMode, lightContext } from '../core/scene.js';
import { project, planeScale, rectCorners, lensMap, DEG } from '../core/optics.js';
import { SRGB_TO_LINEAR, LINEAR_TO_SRGB8, illuminantRgb, wbGainsForKelvin, grayWorldGains } from '../core/color.js';
import { lightSources, timeFactor, flickerAverage } from '../core/lighting.js';
import { whiteSignalPerLuxS, snrDb } from '../core/sensor.js';
import { computeLightFields } from '../core/illumination.js';
import { colorLut, colorMaskLut, evaluate, verdict, profileBand, analyzeProfile, verdictLogo } from '../core/detection.js';
import { topTexture, sideColor, inkTexture } from './textures.js';

const BENCH = '#62676b';
const canvases = {};
let mapCache = { key: '', map: null };
let fieldCache = { key: '', fields: null };
let lutCache = { key: '', lut: null };

// Ruído pré-calculado: soma de 3 uniformes, desvio padrão 1 (quase gaussiana)
const NOISE = (() => {
  const t = new Float32Array(1 << 16);
  let x = 2463534242;
  const r = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
  for (let i = 0; i < t.length; i++) t[i] = (r() + r() + r() - 1.5) * 2;
  return t;
})();

function canvas(name, w, h) {
  let c = canvases[name];
  if (!c) {
    c = document.createElement('canvas');
    canvases[name] = c;
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/**
 * Desenha a cena vista pela câmera.
 * mode 'color': cores reais. mode 'data': canal R = brilho (reflexo) do material, canal G = 255 onde está o alvo,
 * canal B = 255 onde o alvo tem tinta da cor procurada (referência ideal).
 */
function drawGeometry(ctx, objs, cam, mode, ink = null) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = mode === 'color' ? BENCH : '#000';
  ctx.fillRect(0, 0, cam.w, cam.h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  for (const o of objs) {
    if (o.z1 >= cam.z - 5) continue; // objeto acima da câmera
    const alpha = mode === 'color' ? o.opacity : o.opacity > 0.5 ? 1 : 0;
    if (alpha <= 0) continue;
    ctx.globalAlpha = alpha;

    // Paredes (só para volumes)
    if (o.kind === 'box' && o.h > 2) {
      const bot = rectCorners(o, o.z0).map((p) => project(p, cam));
      const top = rectCorners(o, o.z1).map((p) => project(p, cam));
      if (bot.every(Boolean) && top.every(Boolean)) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = mode === 'color' ? sideColor(o) : '#000';
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          ctx.beginPath();
          ctx.moveTo(bot[i].u, bot[i].v);
          ctx.lineTo(bot[j].u, bot[j].v);
          ctx.lineTo(top[j].u, top[j].v);
          ctx.lineTo(top[i].u, top[i].v);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Topo: um plano horizontal vira escala + rotação na projeção
    const s = planeScale(o.z1, cam);
    if (!s) continue;
    const c = project({ x: o.x, y: o.y, z: o.z1 }, cam);
    const cos = Math.cos(o.rot * DEG) * s, sin = Math.sin(o.rot * DEG) * s;
    ctx.setTransform(cos, sin, -sin, cos, c.u, c.v);
    if (mode === 'color') {
      ctx.drawImage(topTexture(o), -o.w / 2, -o.d / 2, o.w, o.d);
    } else {
      ctx.fillStyle = `rgb(0,${o.isTarget ? 255 : 0},0)`;
      ctx.fillRect(-o.w / 2, -o.d / 2, o.w, o.d);
      if (o.isTarget && ink) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(inkTexture(o, ink.lut, ink.key), -o.w / 2, -o.d / 2, o.w, o.d);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
}

/** Mesmo remapeamento da distorção para um mapa de luz (Float32, um valor por pixel). */
function remapF32(src, map) {
  const out = new Float32Array(map.length);
  for (let i = 0; i < map.length; i++) {
    const m = map[i];
    out[i] = m >= 0 ? src[m] : 0;
  }
  return out;
}

function remap32(src, map) {
  const s32 = new Uint32Array(src.buffer, src.byteOffset, src.length >> 2);
  const out = new Uint8ClampedArray(src.length);
  const o32 = new Uint32Array(out.buffer);
  for (let i = 0; i < map.length; i++) {
    const m = map[i];
    o32[i] = m >= 0 ? s32[m] : 0xff000000;
  }
  return out;
}

/**
 * Renderiza a imagem da câmera. Retorna o canvas final e os resultados de detecção.
 * captureSeed muda a cada "nova foto" (fase do flicker e ruído).
 */
export async function renderCamera(scene, captureSeed = 1) {
  const T = [['start', performance.now()]];
  const mark = (n) => T.push([n, performance.now()]);
  const cam = resolveCamera(scene.camera);
  const W = cam.w, H = cam.h, N = W * H;
  const objs = drawOrder(resolveHeights(scene.objects));

  // Imagem ideal (perspectiva sem distorção, mesma escala do centro). Com barril, os cantos da imagem
  // entregue vêm de fora do retângulo W × H: a ideal é maior. Limite de 2,5× os pixels (escala q < 1).
  const grow = cam.lambda ? cam.cornerScale : 1;
  let q = 1;
  if (grow * grow > 2.5) q = Math.sqrt(2.5) / grow;
  const Wi = cam.lambda ? 2 * Math.ceil((W / 2) * grow * q) + 2 : W;
  const Hi = cam.lambda ? 2 * Math.ceil((H / 2) * grow * q) + 2 : H;
  const icam = { ...cam, w: Wi, h: Hi, fpx: cam.fpx * q };

  const refl = canvas('refl', Wi, Hi), data = canvas('data', Wi, Hi);
  const rctx = refl.getContext('2d', { willReadFrequently: true });
  const dctx = data.getContext('2d', { willReadFrequently: true });
  drawGeometry(rctx, objs, icam, 'color');
  const p = detectionParams(scene.detection);
  const lkey = `${p.hue.toFixed(1)}|${p.hueTol}|${p.sMin}|${p.vMin}`;
  if (lutCache.key !== lkey) lutCache = { key: lkey, lut: colorLut(p) };
  drawGeometry(dctx, objs, icam, 'data', { lut: lutCache.lut, key: lkey });
  mark('desenho');

  let rgba = rctx.getImageData(0, 0, Wi, Hi).data;
  let aux = dctx.getImageData(0, 0, Wi, Hi).data; // G = alvo, B = tinta da cor procurada

  // Luz: soma de todas as fontes ligadas (galpão e luminárias da bancada). Iluminância e reflexo de
  // cada luminária calculados por pixel na imagem ideal (src/core/illumination.js), em cache.
  const lsrc = lightSources(scene.light, lightContext(scene));
  const fkey = JSON.stringify([Wi, Hi, cam.x, cam.y, cam.z, icam.fpx,
    objs.map((o) => [o.x, o.y, o.z1, o.w, o.d, o.rot, o.surface, o.roughness, o.gloss]),
    lsrc.map((s) => [s.group, s.lux, s.gradient, s.lum])]);
  if (fieldCache.key !== fkey) fieldCache = { key: fkey, fields: computeLightFields({ cam: icam, W: Wi, H: Hi, objs, sources: lsrc }), distorted: new Map() };
  let fields = fieldCache.fields;
  mark('luz por pixel');

  // Distorção da lente: imagem, dados e mapas de luz passam pelo mesmo remapeamento ideal → entregue
  let lmap = null;
  if (cam.lambda) {
    const key = `${W}x${H}:${Wi}x${Hi}:${cam.lambda}:${q}`;
    if (mapCache.key !== key) mapCache = { key, map: lensMap(W, H, Wi, Hi, cam.lambda, q) };
    lmap = mapCache.map;
    rgba = remap32(rgba, mapCache.map);
    aux = remap32(aux, mapCache.map);
    if (!fieldCache.distorted.has(key)) {
      const r = (a) => (a ? remapF32(a, mapCache.map) : null);
      const shared = new Map(); // o reflexo do galpão é o mesmo mapa para as três fontes
      const once = (a) => { if (!a) return null; if (!shared.has(a)) shared.set(a, r(a)); return shared.get(a); };
      fieldCache.distorted.set(key, fields.map((f) => ({ field: r(f.field), hot: once(f.hot) })));
    }
    fields = fieldCache.distorted.get(key);
  }
  mark('distorção');

  const sources = lsrc.map((src, i) => ({ ...src, lux: Math.max(src.lux, 1e-3), ill: illuminantRgb(src.kelvin), ...fields[i] }));
  const LIN = SRGB_TO_LINEAR;

  // Estatísticas do sinal bruto (amostradas), por fonte, para exposição e balanço automáticos.
  // m[c] = média do canal c por segundo de exposição, em fração da saturação do pixel (0 dB).
  // kWhite: equação da câmera com a abertura da lente e a saturação do sensor (src/core/sensor.js).
  const kWhite = whiteSignalPerLuxS(cam.sensor, cam.lens.aperture);
  // Medição central ponderada (o padrão das câmeras IP): o centro pesa mais que as bordas, que
  // costumam ser bancada escura com menos luz.
  const meterW = new Float32Array(Math.ceil(N / 17));
  for (let j = 0, q = 0; j < N; j += 17, q++) {
    const dx = ((j % W) - W / 2) / (W / 2), dy = (((j / W) | 0) - H / 2) / (H / 2);
    meterW[q] = Math.exp(-(dx * dx + dy * dy) / (2 * 0.35 * 0.35));
  }
  for (const src of sources) {
    const base = src.lux * kWhite;
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = 0, q = 0; j < N; j += 17, q++) {
      const i = j << 2, w = meterW[q];
      const f = src.field ? src.field[j] : 1;
      const sp = src.hot ? src.hot[j] : 0;
      r += w * (LIN[rgba[i]] * f + sp);
      g += w * (LIN[rgba[i + 1]] * f + sp);
      b += w * (LIN[rgba[i + 2]] * f + sp);
      n += w;
    }
    src.m = [(r / n) * base * src.ill[0], (g / n) * base * src.ill[1], (b / n) * base * src.ill[2]];
  }
  const meanAt = (t) => sources.reduce((acc, src) => {
    const k = timeFactor(src, t);
    return [acc[0] + src.m[0] * k, acc[1] + src.m[1] * k, acc[2] + src.m[2] * k];
  }, [0, 0, 0]);
  const lumaAt = (t) => { const m = meanAt(t); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };

  // Exposição
  const c = scene.camera;
  let shutter = c.shutter, gainDb = c.gainDb;
  if (c.exposureMode === 'auto' && sources.length) {
    // menor ganho possível: procura o obturador que deixa a média em 18%, depois completa com ganho
    gainDb = 0;
    if (lumaAt(1 / 30) < 0.18) {
      shutter = 1 / 30;
      gainDb = Math.min(36, Math.max(0, 20 * Math.log10(0.18 / Math.max(lumaAt(1 / 30), 1e-6))));
    } else {
      let lo = Math.log(1 / 10000), hi = Math.log(1 / 30);
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        if (lumaAt(Math.exp(mid)) > 0.18) hi = mid; else lo = mid;
      }
      shutter = Math.exp(hi);
    }
  }
  const gainLin = Math.pow(10, gainDb / 20);

  // Balanço de branco
  let wb;
  if (c.wbMode === 'auto') {
    const m = meanAt(shutter);
    wb = grayWorldGains(m[0], m[1], m[2]);
  } else if (c.wbMode === 'manual-k') wb = wbGainsForKelvin(c.wbKelvin);
  else wb = c.wbGains.slice();

  // Flicker com obturador "rolling": cada linha começa num instante diferente (mesma rede para todas as fontes)
  let seed = (captureSeed * 2654435761) >>> 0 || 1;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const phase = rnd() * Math.PI * 2;
  const lineTime = 1 / 30 / H;
  const S = sources.length;
  // coeficiente por fonte e canal: iluminância de referência × exposição × cor da luz × balanço
  const kd = sources.map((src) => {
    const k = src.lux * kWhite * timeFactor(src, shutter) * gainLin * 4095;
    return [k * src.ill[0] * wb[0], k * src.ill[1] * wb[1], k * src.ill[2] * wb[2]];
  });
  const rows = sources.map((src) => {
    const r = new Float32Array(H);
    for (let y = 0; y < H; y++) r[y] = src.strobe ? 1 : flickerAverage(shutter, phase + 2 * Math.PI * 120 * y * lineTime, src.flicker);
    return r;
  });
  const fieldMaps = sources.map((src) => src.field), hots = sources.map((src) => src.hot);
  mark('luz');

  // Pixels
  const out = new Uint8ClampedArray(N * 4);
  // Ruído do sensor, por canal, antes do balanço de branco: variância = disparo (∝ elétrons) + leitura.
  // Em unidades de saída (0..4095): σ² = a·v + b, com a = 4095·ganho/fullWell e b = (a·ruídoLeitura)².
  // O balanço de branco multiplica o canal depois, e com ele o ruído.
  const nA = (4095 * gainLin) / cam.sensor.fullWellE, nB = (nA * cam.sensor.readNoiseE) ** 2;
  const noisy = !!c.noise;
  const naR = nA * wb[0], naG = nA * wb[1], naB = nA * wb[2];
  const nbR = nB * wb[0] ** 2, nbG = nB * wb[1] ** 2, nbB = nB * wb[2] ** 2;
  const bw = c.colorMode === 'bw';
  const OUT = LINEAR_TO_SRGB8;
  let clipped = 0;
  let ni = (rnd() * 65536) | 0;
  const dR = new Float64Array(S), dG = new Float64Array(S), dB = new Float64Array(S);
  for (let y = 0, j = 0; y < H; y++) {
    for (let k = 0; k < S; k++) {
      const rf = rows[k][y];
      dR[k] = kd[k][0] * rf; dG[k] = kd[k][1] * rf; dB[k] = kd[k][2] * rf;
    }
    for (let x = 0; x < W; x++, j++) {
      const i = j << 2;
      // difuso: refletância × iluminância; reflexo: cor da luz × iluminância equivalente do espelho
      let ar = 0, ag = 0, ab = 0, br = 0, bg = 0, bb = 0;
      for (let k = 0; k < S; k++) {
        const f = fieldMaps[k] ? fieldMaps[k][j] : 1;
        ar += dR[k] * f; ag += dG[k] * f; ab += dB[k] * f;
        const hh = hots[k] ? hots[k][j] : 0;
        br += dR[k] * hh; bg += dG[k] * hh; bb += dB[k] * hh;
      }
      let r = LIN[rgba[i]] * ar + br;
      let g = LIN[rgba[i + 1]] * ag + bg;
      let b = LIN[rgba[i + 2]] * ab + bb;
      if (noisy) {
        r += NOISE[ni] * Math.sqrt(naR * (r > 0 ? r : 0) + nbR); ni = (ni + 1) & 65535;
        g += NOISE[ni] * Math.sqrt(naG * (g > 0 ? g : 0) + nbG); ni = (ni + 1) & 65535;
        b += NOISE[ni] * Math.sqrt(naB * (b > 0 ? b : 0) + nbB); ni = (ni + 7) & 65535;
      }
      if (r >= 4095 || g >= 4095 || b >= 4095) clipped++;
      if (bw) r = g = b = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      out[i] = OUT[r <= 0 ? 0 : r >= 4095 ? 4095 : r | 0];
      out[i + 1] = OUT[g <= 0 ? 0 : g >= 4095 ? 4095 : g | 0];
      out[i + 2] = OUT[b <= 0 ? 0 : b >= 4095 ? 4095 : b | 0];
      out[i + 3] = 255;
    }
  }
  mark('pixels');

  const final = canvas('final', W, H);
  const fctx = final.getContext('2d', { willReadFrequently: true });
  fctx.putImageData(new ImageData(out, W, H), 0, 0);

  // Compressão JPEG (como a câmera entrega a foto)
  let pixels = out;
  if (c.jpegQuality < 100) {
    const blob = await new Promise((res) => final.toBlob(res, 'image/jpeg', c.jpegQuality / 100));
    if (blob) {
      const bmp = await createImageBitmap(blob);
      fctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      pixels = fctx.getImageData(0, 0, W, H).data;
    }
  }
  mark('jpeg');

  // Detecção
  const mask = colorMaskLut(pixels, lutCache.lut);
  // region: onde o alvo está. ink: onde a cor deveria aparecer (a fita inteira, ou só o logo).
  const region = new Uint8Array(N), ink = new Uint8Array(N);
  let inkPx = 0;
  for (let j = 0; j < N; j++) {
    const k = j << 2;
    if (aux[k + 1] > 127) {
      region[j] = 1;
      if (aux[k + 2] > 127) { ink[j] = 1; inkPx++; }
    }
  }
  const mode = detectionMode(scene);
  const byInk = mode === 'cor' && inkPx > 0;
  const expected = byInk ? ink : region;
  const result = evaluate(mask, expected, region);
  // a fita é "toda tinta" quando quase toda a área tem a cor procurada
  let regionPx = 0;
  for (let j = 0; j < N; j++) regionPx += region[j];
  const what = byInk && inkPx < regionPx * 0.8 ? 'do logo esperado' : 'da fita';
  let v, profile = null;
  const tgt = objs.filter((o) => o.isTarget).pop();
  if (mode === 'logo' && tgt) {
    // Percorre a emenda inteira (comprimento do objeto onde a fita está apoiada), não só a fita:
    // com câmera e balança fixas, essa região é conhecida pela receita da caixa.
    const long = tgt.w >= tgt.d;
    const ang = (tgt.rot + (long ? 0 : 90)) * DEG;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const parent = objs.find((o) => o.id === tgt.sitOn) || null;
    let cx = tgt.x, cy = tgt.y, len = long ? tgt.w : tgt.d;
    if (parent) {
      const off = (parent.x - tgt.x) * ux + (parent.y - tgt.y) * uy;
      cx = tgt.x + off * ux;
      cy = tgt.y + off * uy;
      const rel = ang - parent.rot * DEG;
      len = Math.abs(Math.cos(rel)) * parent.w + Math.abs(Math.sin(rel)) * parent.d;
    }
    // na imagem ideal, onde a emenda é uma reta (a distorção a curvaria)
    const a = project({ x: cx - ux * len / 2, y: cy - uy * len / 2, z: tgt.z1 }, icam);
    const b = project({ x: cx + ux * len / 2, y: cy + uy * len / 2, z: tgt.z1 }, icam);
    const scale = planeScale(tgt.z1, icam);
    if (a && b && scale) {
      const halfPx = ((long ? tgt.d : tgt.w) / 2) * scale;
      profile = analyzeProfile(profileBand(mask, W, H, a, b, halfPx, len, 256, lmap, Wi));
      v = verdictLogo(result, profile, scene.detection);
    }
  }
  if (!v) v = verdict(result, scene.detection, what);
  mark('detecção');

  if (globalThis.__visionTiming) {
    console.log('timing', T.map(([name, t], i) => (i ? `${name} ${Math.round(t - T[i - 1][1])}ms` : '')).join(' '));
  }
  return {
    canvas: final,
    width: W,
    height: H,
    mask,
    expected,
    region,
    result,
    verdict: v,
    mode,
    profile,
    what,
    exposure: {
      shutter, gainDb, clippedRatio: clipped / N,
      // cinza médio da imagem: elétrons por pixel e relação sinal/ruído
      meanE: Math.min(1, lumaAt(shutter)) * cam.sensor.fullWellE,
      snrDb: snrDb(cam.sensor, Math.min(1, lumaAt(shutter)) * gainLin, gainLin),
    },
    sensor: cam.sensor,
    wb,
    light: effectiveLight(scene),
  };
}
