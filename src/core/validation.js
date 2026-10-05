// Validação: mede numa imagem (foto real ou simulada) as mesmas grandezas, com o mesmo código, para
// comparar o simulador com a câmera de verdade. Tudo é medido em relação à fita achada na própria imagem,
// então a foto não precisa estar alinhada pixel a pixel com a simulação. Puro, sem DOM.

import { colorMaskLut } from './detection.js';
import { rgbToHsv } from './color.js';

const median = (a) => {
  if (!a.length) return 0;
  const s = Float64Array.from(a).sort();
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Maior sequência de pixels marcados numa linha ou coluna: { len, start }. */
function longestRun(mask, start, step, count) {
  let best = 0, bestAt = -1, run = 0, at = 0;
  for (let k = 0, i = start; k < count; k++, i += step) {
    if (mask[i]) { if (!run) at = k; run++; if (run > best) { best = run; bestAt = at; } } else run = 0;
  }
  return { len: best, start: bestAt };
}

/**
 * Analisa uma imagem RGBA (W × H) com a tabela de cor da detecção (colorLut).
 * Fita de cor sólida, reta, na horizontal ou na vertical da imagem (como no posto de inspeção).
 * Retorna null se não achar a fita. Medidas:
 *   tapeWidthPx  largura da fita (mediana das seções transversais)
 *   tapeRgb/Hsv  cor média dos pixels detectados
 *   refRgb       cor média do que está dos dois lados da fita (o papelão), e refNoise: desvio do canal G
 *                em relação à média 3 × 3 (ruído + textura fina)
 *   coverage     fração da faixa da fita reconhecida pela detecção
 *   glare        fração da faixa da fita estourada (algum canal ≥ 250)
 *   band         faixa da fita na imagem (para desenhar)
 */
export function analyzePhoto(rgba, W, H, lut) {
  const mask = colorMaskLut(rgba, lut);
  const cols = [], rows = [];
  for (let x = 0; x < W; x += 2) { const r = longestRun(mask, x, W, H); if (r.len >= 3) cols.push({ x, ...r }); }
  for (let y = 0; y < H; y += 2) { const r = longestRun(mask, y * W, 1, W); if (r.len >= 3) rows.push({ y, ...r }); }
  if (!cols.length && !rows.length) return null;
  // fita na horizontal: as colunas cortam a fita na largura (seções curtas), as linhas no comprimento
  const horizontal = median(cols.map((c) => c.len)) <= median(rows.map((r) => r.len)) || !rows.length;
  const cuts = horizontal ? cols : rows;
  const width = median(cuts.map((c) => c.len));
  const good = cuts.filter((c) => c.len >= width * 0.5 && c.len <= width * 1.5);
  if (good.length < 5) return null;
  const a0 = Math.round(median(good.map((c) => c.start))), a1 = a0 + Math.round(width); // através da fita
  const along = good.map((c) => (horizontal ? c.x : c.y));
  const b0 = Math.min(...along), b1 = Math.max(...along) + 1; // ao longo da fita
  const at = (a, b) => (horizontal ? b + a * W : a + b * W); // a: através, b: ao longo

  // faixa da fita: cor, cobertura e estouro
  let n = 0, hits = 0, glare = 0, tr = 0, tg = 0, tb = 0, tn = 0;
  for (let a = a0; a < a1; a++) {
    for (let b = b0; b < b1; b++) {
      const j = at(a, b), i = j << 2;
      n++;
      if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) >= 250) glare++;
      if (mask[j]) { hits++; tr += rgba[i]; tg += rgba[i + 1]; tb += rgba[i + 2]; tn++; }
    }
  }
  // papelão dos dois lados: faixas da largura da fita, afastadas meia largura
  let rr = 0, rg = 0, rb = 0, rn = 0, d2 = 0, dn = 0;
  const lim = horizontal ? H : W, other = horizontal ? W : H;
  const gap = Math.round(width / 2), wd = Math.round(width);
  for (const [s, e] of [[a0 - gap - wd, a0 - gap], [a1 + gap, a1 + gap + wd]]) {
    for (let a = Math.max(1, s); a < Math.min(lim - 1, e); a++) {
      for (let b = Math.max(1, b0); b < Math.min(other - 1, b1); b++) {
        const j = at(a, b), i = j << 2;
        rr += rgba[i]; rg += rgba[i + 1]; rb += rgba[i + 2]; rn++;
        let m = 0;
        for (const dj of [-W - 1, -W, -W + 1, -1, 0, 1, W - 1, W, W + 1]) m += rgba[((j + dj) << 2) + 1];
        d2 += (rgba[i + 1] - m / 9) ** 2; dn++;
      }
    }
  }
  const tapeRgb = tn ? [tr / tn, tg / tn, tb / tn] : null;
  const [h, sv, v] = tapeRgb ? rgbToHsv(...tapeRgb) : [0, 0, 0];
  return {
    horizontal, tapeWidthPx: width, tapeLengthPx: b1 - b0,
    tapeRgb, tapeHsv: tapeRgb ? [h, sv, v] : null,
    refRgb: rn ? [rr / rn, rg / rn, rb / rn] : null,
    refNoise: dn ? Math.sqrt(d2 / dn) : null,
    coverage: n ? hits / n : 0,
    glare: n ? glare / n : 0,
    band: horizontal ? { x0: b0, x1: b1, y0: a0, y1: a1 } : { x0: a0, x1: a1, y0: b0, y1: b1 },
  };
}

/** Linhas da comparação real × simulado: [rótulo, real, simulado, diferença em texto, ok?]. */
export function compareAnalyses(real, sim) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const rel = (a, b) => (b ? (a - b) / b : 0);
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const hueDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const rows = [];
  rows.push(['Largura da fita', `${real.tapeWidthPx.toFixed(1)} px`, `${sim.tapeWidthPx.toFixed(1)} px`,
    `${(rel(sim.tapeWidthPx, real.tapeWidthPx) * 100).toFixed(1)}%`, Math.abs(rel(sim.tapeWidthPx, real.tapeWidthPx)) <= 0.05]);
  if (real.tapeHsv && sim.tapeHsv) {
    rows.push(['Matiz da fita', `${real.tapeHsv[0].toFixed(0)}°`, `${sim.tapeHsv[0].toFixed(0)}°`,
      `${hueDiff(real.tapeHsv[0], sim.tapeHsv[0]).toFixed(0)}°`, hueDiff(real.tapeHsv[0], sim.tapeHsv[0]) <= 8]);
    rows.push(['Saturação da fita', pct(real.tapeHsv[1]), pct(sim.tapeHsv[1]),
      `${((sim.tapeHsv[1] - real.tapeHsv[1]) * 100).toFixed(0)} pontos`, Math.abs(sim.tapeHsv[1] - real.tapeHsv[1]) <= 0.1]);
    rows.push(['Brilho da fita (luma)', luma(real.tapeRgb).toFixed(0), luma(sim.tapeRgb).toFixed(0),
      `${(rel(luma(sim.tapeRgb), luma(real.tapeRgb)) * 100).toFixed(0)}%`, Math.abs(rel(luma(sim.tapeRgb), luma(real.tapeRgb))) <= 0.15]);
  }
  if (real.refRgb && sim.refRgb) {
    rows.push(['Brilho do papelão (luma)', luma(real.refRgb).toFixed(0), luma(sim.refRgb).toFixed(0),
      `${(rel(luma(sim.refRgb), luma(real.refRgb)) * 100).toFixed(0)}%`, Math.abs(rel(luma(sim.refRgb), luma(real.refRgb))) <= 0.15]);
    rows.push(['Ruído no papelão (desvio, G)', real.refNoise.toFixed(1), sim.refNoise.toFixed(1),
      `${(rel(sim.refNoise, real.refNoise) * 100).toFixed(0)}%`, Math.abs(rel(sim.refNoise, real.refNoise)) <= 0.5]);
  }
  rows.push(['Fita reconhecida', pct(real.coverage), pct(sim.coverage), `${((sim.coverage - real.coverage) * 100).toFixed(0)} pontos`,
    Math.abs(sim.coverage - real.coverage) <= 0.1]);
  rows.push(['Fita estourada (reflexo)', pct(real.glare), pct(sim.glare), `${((sim.glare - real.glare) * 100).toFixed(0)} pontos`,
    Math.abs(sim.glare - real.glare) <= 0.05]);
  return rows;
}
