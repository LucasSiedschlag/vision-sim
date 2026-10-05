// Cor: conversões sRGB/linear, temperatura de cor, HSV e balanço de branco.

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c) {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Tabela 0..255 → linear, para o pipeline de pixels. */
export const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLinear(i / 255);
  return t;
})();

/** Tabela linear (0..4095) → 0..255 sRGB. */
export const LINEAR_TO_SRGB8 = (() => {
  const t = new Uint8ClampedArray(4096);
  for (let i = 0; i < 4096; i++) t[i] = Math.round(linearToSrgb(i / 4095) * 255);
  return t;
})();

/**
 * Cor (sRGB 0..1) de um corpo negro na temperatura `kelvin`.
 * Aproximação de Tanner Helland, válida de 1000 K a 40000 K.
 */
export function kelvinToSrgb(kelvin) {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v) => Math.min(255, Math.max(0, v)) / 255;
  return [c(r), c(g), c(b)];
}

/**
 * Cor da luz em RGB linear, normalizada para que 6500 K seja (1, 1, 1).
 * É o que o sensor "vê" de uma superfície branca sob essa luz, antes do balanço de branco.
 */
export function illuminantRgb(kelvin) {
  const ref = kelvinToSrgb(6500).map(srgbToLinear);
  const c = kelvinToSrgb(kelvin).map(srgbToLinear);
  return [c[0] / ref[0], c[1] / ref[1], c[2] / ref[2]];
}

/** Ganhos de balanço de branco que neutralizam uma luz de `kelvin` (G = 1). */
export function wbGainsForKelvin(kelvin) {
  const [r, g, b] = illuminantRgb(kelvin);
  return [g / r, 1, g / b];
}

/**
 * Balanço de branco automático por "zona cinza", como fazem as câmeras: só entram pixels cuja cor
 * poderia ser uma superfície cinza sob alguma luz real, isto é, perto da curva do corpo negro (em log
 * r/g, b/g). Cores fortes como a fita vermelha ficam de fora sozinhas; escuros e estourados também.
 * O resultado é a temperatura da curva mais próxima da média desses pixels (pesada pelo brilho), dentro
 * da faixa que a câmera acompanha. Sem pixels candidatos, usa a média geral, também presa à curva.
 * samples: [r, g, b, …] do sinal bruto linear (fração da saturação); weights: peso de cada amostra.
 */
export function autoWhiteBalance(samples, weights = null, { minK = 2500, maxK = 10000, zone = 0.15 } = {}) {
  const locus = [];
  for (let mired = 1e6 / maxK; mired <= 1e6 / minK + 1e-9; mired += 2) {
    const K = 1e6 / mired;
    const [r, g, b] = illuminantRgb(K);
    locus.push({ K, x: Math.log(r / g), y: Math.log(b / g) });
  }
  const nearest = (x, y) => {
    let best = locus[0], d2 = Infinity;
    for (const p of locus) {
      const e = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (e < d2) { d2 = e; best = p; }
    }
    return { p: best, d: Math.sqrt(d2) };
  };
  let R = 0, G = 0, B = 0, W = 0, aR = 0, aG = 0, aB = 0, aW = 0;
  for (let i = 0, k = 0; i < samples.length; i += 3, k++) {
    const r = samples[i], g = samples[i + 1], b = samples[i + 2];
    const w = weights ? weights[k] : 1;
    aR += w * r; aG += w * g; aB += w * b; aW += w;
    const mx = Math.max(r, g, b);
    if (mx < 0.02 || mx > 0.95 || Math.min(r, g, b) <= 0) continue;
    if (nearest(Math.log(r / g), Math.log(b / g)).d > zone) continue;
    R += w * r; G += w * g; B += w * b; W += w;
  }
  const zoneUsed = W > 0.02 * aW;
  const [r, g, b] = zoneUsed ? [R, G, B] : [aR, aG, aB];
  const K = g > 0 && r > 0 && b > 0 ? nearest(Math.log(r / g), Math.log(b / g)).p.K : 6500;
  return { kelvin: K, gains: wbGainsForKelvin(K), grayShare: aW ? W / aW : 0, zoneUsed };
}

/** RGB 0..255 → HSV (h em graus 0..360, s e v em 0..1). */
export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

/** Menor distância angular entre dois matizes (graus). */
export function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  const h = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
