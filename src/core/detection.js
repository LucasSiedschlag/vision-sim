// Detecção por cor em HSV e avaliação contra a área esperada do objeto-alvo.

import { rgbToHsv, hueDistance } from './color.js';

/**
 * Máscara dos pixels cuja cor está perto do matiz alvo.
 * rgba: Uint8ClampedArray (w*h*4). Retorna Uint8Array (1 = detectado).
 */
export function colorMask(rgba, w, h, p) {
  const mask = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < mask.length; i += 4, j++) {
    const [hh, s, v] = rgbToHsv(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (s >= p.sMin && v >= p.vMin && hueDistance(hh, p.hue) <= p.hueTol) mask[j] = 1;
  }
  return mask;
}

/**
 * Tabela de decisão por cor com 5 bits por canal (32768 entradas).
 * Troca o cálculo de HSV por pixel por uma consulta: bem mais rápido em imagens grandes.
 */
export function colorLut(p) {
  const lut = new Uint8Array(32768);
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        const [hh, s, v] = rgbToHsv(r * 8 + 4, g * 8 + 4, b * 8 + 4);
        lut[(r << 10) | (g << 5) | b] = s >= p.sMin && v >= p.vMin && hueDistance(hh, p.hue) <= p.hueTol ? 1 : 0;
      }
    }
  }
  return lut;
}

/** Máscara usando a tabela de colorLut. */
export function colorMaskLut(rgba, lut) {
  const n = rgba.length >> 2;
  const mask = new Uint8Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    mask[j] = lut[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)];
  }
  return mask;
}

/**
 * Compara a máscara detectada com a máscara esperada (onde o alvo realmente está).
 * expected: Uint8Array (1 = pixel do alvo).
 */
export function evaluate(mask, expected, region = expected) {
  // expected: onde a cor deveria aparecer (cobertura). region: área do alvo; detecção fora dela é falso positivo.
  let hit = 0, exp = 0, fp = 0;
  for (let i = 0; i < mask.length; i++) {
    if (expected[i]) {
      exp++;
      if (mask[i]) hit++;
    } else if (mask[i] && !region[i]) {
      fp++;
    }
  }
  return {
    expectedPx: exp,
    detectedPx: hit,
    falsePositivePx: fp,
    coverage: exp ? hit / exp : 0,
    falsePositiveRatio: exp ? fp / exp : fp > 0 ? 1 : 0,
  };
}

/** Veredito com motivos, em linguagem para o cliente. */
export function verdict(result, rules, what = 'da fita') {
  const reasons = [];
  const adj = what.includes('fita') ? 'reconhecida' : 'reconhecido';
  if (result.expectedPx === 0) {
    return { ok: false, label: 'Sem alvo', reasons: ['Nenhum objeto marcado como alvo está visível na imagem.'] };
  }
  if (result.coverage < rules.minCoverage) {
    reasons.push(`Só ${Math.round(result.coverage * 100)}% ${what} foi ${adj} (mínimo ${Math.round(rules.minCoverage * 100)}%).`);
  }
  if (result.falsePositiveRatio > rules.maxFalsePositive) {
    reasons.push(`Há objetos fora da fita com a mesma cor (${Math.round(result.falsePositiveRatio * 100)}% da área esperada).`);
  }
  return reasons.length
    ? { ok: false, label: 'Falha na detecção', reasons }
    : { ok: true, label: 'Fita detectada', reasons: [`${Math.round(result.coverage * 100)}% ${what} ${adj}.`] };
}

/**
 * Perfil ao longo da fita: divide o comprimento do alvo em `bins` fatias e marca onde há
 * pixels detectados. Serve para fita com logo impresso: a cor só aparece nos logos, então
 * a pergunta é "há logo ao longo de toda a emenda?", não "a fita inteira tem a cor?".
 * a, b: extremidades do eixo longo do alvo na imagem (px). lengthMm: comprimento real.
 */
export function profileAlong(mask, expected, w, a, b, lengthMm, bins = 256) {
  const ux = b.u - a.u, uy = b.v - a.v;
  const L2 = ux * ux + uy * uy || 1;
  const tot = new Uint32Array(bins), hit = new Uint32Array(bins);
  for (let j = 0; j < expected.length; j++) {
    if (!expected[j]) continue;
    const x = j % w, y = (j / w) | 0;
    let t = ((x - a.u) * ux + (y - a.v) * uy) / L2;
    if (t < 0 || t >= 1) continue;
    const k = (t * bins) | 0;
    tot[k]++;
    if (mask[j]) hit[k]++;
  }
  return { tot, hit, bins, lengthMm };
}

/**
 * Lê o perfil: quantos logos (trechos com cor, unindo falhas menores que mergeMm),
 * maior trecho sem logo (inclui as pontas) e quanto da fita estava visível.
 */
export function analyzeProfile(p, { mergeMm = 15, minHits = 2 } = {}) {
  const binMm = p.lengthMm / p.bins;
  const occ = [];
  let visible = 0;
  for (let k = 0; k < p.bins; k++) {
    if (p.tot[k] > 0) visible++;
    occ.push(p.hit[k] >= minHits);
  }
  const segments = [];
  let start = -1, lastEnd = -1;
  for (let k = 0; k <= p.bins; k++) {
    const on = k < p.bins && occ[k];
    if (on && start < 0) start = k;
    if (!on && start >= 0) {
      const prev = segments[segments.length - 1];
      if (prev && (start - prev.end) * binMm < mergeMm) prev.end = k;
      else segments.push({ start, end: k });
      start = -1;
      lastEnd = k;
    }
  }
  let maxGap = 0;
  if (!segments.length) maxGap = p.lengthMm;
  else {
    maxGap = Math.max(segments[0].start * binMm, (p.bins - segments[segments.length - 1].end) * binMm);
    for (let i = 1; i < segments.length; i++) maxGap = Math.max(maxGap, (segments[i].start - segments[i - 1].end) * binMm);
  }
  return { occ, segments, logos: segments.length, maxGapMm: maxGap, visibleRatio: visible / p.bins, binMm, lastEnd };
}

/** Veredito no modo "logo repetido". */
export function verdictLogo(result, prof, rules) {
  if (result.expectedPx === 0) {
    return { ok: false, label: 'Sem alvo', reasons: ['Nenhum objeto marcado como alvo está visível na imagem.'] };
  }
  const reasons = [];
  if (prof.visibleRatio < 0.9) reasons.push(`Só ${Math.round(prof.visibleRatio * 100)}% da fita aparece na imagem.`);
  if (prof.logos < rules.minLogos) reasons.push(`${prof.logos} logo(s) encontrado(s); o mínimo é ${rules.minLogos}.`);
  if (prof.maxGapMm > rules.maxGapMm) reasons.push(`Há um trecho de ${Math.round(prof.maxGapMm)} mm sem logo (limite ${rules.maxGapMm} mm).`);
  if (result.falsePositiveRatio > rules.maxFalsePositive) {
    reasons.push(`Há objetos fora da fita com a mesma cor (${Math.round(result.falsePositiveRatio * 100)}% da área da fita).`);
  }
  return reasons.length
    ? { ok: false, label: 'Falha na detecção', reasons }
    : { ok: true, label: 'Fita detectada', reasons: [`${prof.logos} logos ao longo da emenda; maior intervalo ${Math.round(prof.maxGapMm)} mm.`] };
}

/**
 * Como profileAlong, mas percorre uma faixa geométrica (a emenda da caixa) em vez da área da fita.
 * Assim, uma fita curta ou faltando aparece como trecho sem logo.
 * a, b: extremidades da emenda na imagem; halfWidthPx: meia largura da faixa em px.
 */
export function profileBand(mask, w, h, a, b, halfWidthPx, lengthMm, bins = 256) {
  const ux = b.u - a.u, uy = b.v - a.v;
  const L = Math.hypot(ux, uy) || 1;
  const dx = ux / L, dy = uy / L;
  const tot = new Uint32Array(bins), hit = new Uint32Array(bins);
  const x0 = Math.max(0, Math.floor(Math.min(a.u, b.u) - halfWidthPx)), x1 = Math.min(w - 1, Math.ceil(Math.max(a.u, b.u) + halfWidthPx));
  const y0 = Math.max(0, Math.floor(Math.min(a.v, b.v) - halfWidthPx)), y1 = Math.min(h - 1, Math.ceil(Math.max(a.v, b.v) + halfWidthPx));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const rx = x - a.u, ry = y - a.v;
      const along = rx * dx + ry * dy;
      if (along < 0 || along >= L) continue;
      if (Math.abs(-rx * dy + ry * dx) > halfWidthPx) continue;
      const k = ((along / L) * bins) | 0;
      tot[k]++;
      if (mask[y * w + x]) hit[k]++;
    }
  }
  return { tot, hit, bins, lengthMm };
}
