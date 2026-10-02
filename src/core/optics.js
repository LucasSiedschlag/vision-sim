// Óptica de câmera pinhole olhando para baixo, com distorção radial simples.
// Funções puras: sem DOM, testáveis em Node.

export const DEG = Math.PI / 180;

/** Distância focal em pixels a partir do FOV horizontal e da largura do sensor em pixels. */
export function focalPx(widthPx, hfovDeg) {
  return (widthPx / 2) / Math.tan((hfovDeg * DEG) / 2);
}

/** Largura (mm) do campo de visão num plano a `distanceMm` da câmera. */
export function fieldWidth(distanceMm, hfovDeg) {
  return 2 * distanceMm * Math.tan((hfovDeg * DEG) / 2);
}

/** Campo de visão (largura e altura, mm) num plano a `distanceMm`. */
export function footprint(distanceMm, hfovDeg, widthPx, heightPx) {
  const width = fieldWidth(distanceMm, hfovDeg);
  return { width, height: width * (heightPx / widthPx) };
}

/** Quantos milímetros cada pixel cobre num plano a `distanceMm`. */
export function mmPerPixel(distanceMm, hfovDeg, widthPx) {
  return fieldWidth(distanceMm, hfovDeg) / widthPx;
}

/** Quantos pixels um objeto de `sizeMm` ocupa num plano a `distanceMm`. */
export function pixelsAcross(sizeMm, distanceMm, hfovDeg, widthPx) {
  return sizeMm / mmPerPixel(distanceMm, hfovDeg, widthPx);
}

/** FOV vertical (graus) a partir do horizontal e da proporção do sensor. */
export function vfov(hfovDeg, widthPx, heightPx) {
  return 2 * Math.atan(Math.tan((hfovDeg * DEG) / 2) * (heightPx / widthPx)) / DEG;
}

/**
 * Estado óptico de uma câmera com zoom `zoom` (0 = grande angular, 1 = tele).
 * Para lente fixa, zoom é ignorado.
 * Retorna FOV horizontal, focal (mm), largura do sensor (mm), pitch do pixel e k1 da distorção.
 */
export function lensState(cam, zoom = 0) {
  const t = cam.hfov.length > 1 ? Math.min(1, Math.max(0, zoom)) : 0;
  const fWide = cam.focalMm[0];
  const fTele = cam.focalMm[cam.focalMm.length - 1];
  // A largura do sensor sai do par (focal, FOV) no grande angular.
  const sensorW = 2 * fWide * Math.tan((cam.hfov[0] * DEG) / 2);
  // Interpolação em focal (linear em mm, como um zoom real).
  const f = fWide + (fTele - fWide) * t;
  const hfov = 2 * Math.atan(sensorW / (2 * f)) / DEG;
  const pitch = sensorW / cam.widthPx;
  // Distorção diminui conforme o zoom fecha.
  const k1 = (cam.distortionK ?? 0) * Math.pow(fWide / f, 2);
  return { hfov, focalMm: f, sensorW, pitchMm: pitch, k1, aperture: cam.aperture };
}

/**
 * Profundidade de campo (mm, medidos a partir da câmera).
 * Círculo de confusão = 2 pixels. Retorna near/far (far pode ser Infinity) e hiperfocal.
 */
export function depthOfField(focalMm, fNumber, cocMm, focusMm) {
  const H = (focalMm * focalMm) / (fNumber * cocMm) + focalMm;
  const s = focusMm;
  const near = (s * (H - focalMm)) / (H + s - 2 * focalMm);
  const far = s >= H ? Infinity : (s * (H - focalMm)) / (H - s);
  return { near, far, hyperfocal: H };
}

/**
 * Projeção de um ponto do mundo (mm) na imagem para câmera em (cx, cy, camZ) olhando para -Z.
 * Eixo x da imagem = x do mundo; eixo y da imagem = y do mundo (vista de cima, y para baixo).
 */
export function project(p, cam) {
  const depth = cam.z - p.z;
  if (depth <= 1) return null;
  const s = cam.fpx / depth;
  return { u: cam.w / 2 + (p.x - cam.x) * s, v: cam.h / 2 + (p.y - cam.y) * s, s };
}

/** Escala (px por mm) de um plano horizontal na altura z. */
export function planeScale(z, cam) {
  const depth = cam.z - z;
  return depth > 1 ? cam.fpx / depth : null;
}

/** Cantos de um retângulo rotacionado (centro x,y; dimensões w×d; rot em graus) na altura z. */
export function rectCorners(o, z) {
  const c = Math.cos(o.rot * DEG), s = Math.sin(o.rot * DEG);
  const hw = o.w / 2, hd = o.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([dx, dy]) => ({
    x: o.x + dx * c - dy * s,
    y: o.y + dx * s + dy * c,
    z,
  }));
}

/**
 * Tabela de remapeamento para distorção radial (barril quando k1 < 0).
 * Para cada pixel da imagem final (distorcida), o índice do pixel de origem na imagem ideal.
 * Normalizado pela meia-diagonal, de modo que os cantos ficam no lugar.
 */
export function distortionMap(w, h, k1) {
  const map = new Int32Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const R = Math.hypot(cx, cy);
  // Fator de escala em função de r² (tabela 1D): evita a iteração por pixel.
  const N = 2048;
  const lut = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const rd = Math.sqrt(i / N);
    let rs = rd;
    // Inverte rd = rs(1 + k rs²)/(1 + k) por iteração de ponto fixo.
    for (let k = 0; k < 6; k++) rs = (rd * (1 + k1)) / (1 + k1 * rs * rs);
    lut[i] = rd > 0 ? rs / rd : 1 + k1;
  }
  const invR2 = 1 / (R * R);
  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    const dy2 = dy * dy;
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const t = (dx * dx + dy2) * invR2 * N;
      const i0 = t | 0;
      const scale = i0 >= N ? lut[N] : lut[i0] + (lut[i0 + 1] - lut[i0]) * (t - i0);
      const sx = Math.round(cx + dx * scale);
      const sy = Math.round(cy + dy * scale);
      map[y * w + x] = sx >= 0 && sx < w && sy >= 0 && sy < h ? sy * w + sx : -1;
    }
  }
  return map;
}
