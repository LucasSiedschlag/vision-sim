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
 * Retorna o FOV horizontal do datasheet nesse zoom, focal (mm), largura do sensor (mm), pitch do pixel e k1
 * da distorção (k1 é o λ do modelo de divisão, ver lensProjection).
 */
export function lensState(cam, zoom = 0) {
  const t = cam.hfov.length > 1 ? Math.min(1, Math.max(0, zoom)) : 0;
  const fWide = cam.focalMm[0];
  const fTele = cam.focalMm[cam.focalMm.length - 1];
  // A largura do sensor sai do par (focal, FOV) no grande angular.
  const sensorW = 2 * fWide * Math.tan((cam.hfov[0] * DEG) / 2);
  // Interpolação em focal (linear em mm, como um zoom real).
  const f = fWide + (fTele - fWide) * t;
  const pitch = sensorW / cam.widthPx;
  // Distorção diminui conforme o zoom fecha.
  const k1 = (cam.distortionK ?? 0) * Math.pow(fWide / f, 2);
  // Interpola o FOV do datasheet (o que a imagem mostra de borda a borda) entre os extremos do zoom,
  // na tangente, que é o que escala com a focal.
  const tw = Math.tan((cam.hfov[0] * DEG) / 2), tt = Math.tan((cam.hfov[cam.hfov.length - 1] * DEG) / 2);
  const hfovSheet = cam.hfov.length > 1 ? (2 * Math.atan(1 / (1 / tw + (1 / tt - 1 / tw) * ((f - fWide) / (fTele - fWide || 1))))) / DEG : cam.hfov[0];
  // abertura: muitas lentes de zoom fecham ao aproximar (F1.6 → F2.7); interpolada na focal
  const aperture = cam.apertureTele && fTele > fWide ? cam.aperture + (cam.apertureTele - cam.aperture) * ((f - fWide) / (fTele - fWide)) : cam.aperture;
  return { hfov: hfovSheet, focalMm: f, sensorW, pitchMm: pitch, k1, aperture };
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
 * Projeção da lente com distorção radial pelo modelo de divisão (Fitzgibbon):
 *   r_ideal = r_imagem / (1 + λ · n²),  n = r_imagem / (meia largura)
 * λ < 0 é barril. A escala do centro (fpx) é escolhida para que a borda horizontal da imagem caia
 * exatamente no FOV do datasheet: o que o fabricante mede é o campo da imagem já distorcida.
 * distort = false: imagem corrigida pela câmera (LDC): mesma escala no centro, bordas cortadas.
 * Retorna fpx (px por unidade de tangente no centro), λ efetivo e FOV horizontal/vertical da imagem.
 */
export function lensProjection(widthPx, heightPx, hfovDeg, k1, distort = true) {
  const half = widthPx / 2;
  const nCorner = Math.hypot(widthPx, heightPx) / widthPx;
  // o modelo só vale enquanto 1 + λn² > 0 nos cantos; limita barris exagerados
  const lam = Math.max(k1, -0.85 / (nCorner * nCorner));
  const fpx = half / ((1 + lam) * Math.tan((hfovDeg * DEG) / 2));
  const L = distort ? lam : 0;
  const tanAt = (n) => (n / (1 + L * n * n)) * (half / fpx); // tangente do raio na borda, a n meias larguras
  const aspect = heightPx / widthPx;
  return {
    fpx, lambda: L,
    hfov: (2 * Math.atan(tanAt(1))) / DEG,
    vfov: (2 * Math.atan(tanAt(aspect))) / DEG,
    // quanto a imagem ideal (sem distorção) precisa ser maior para cobrir os cantos
    cornerScale: 1 / (1 + L * nCorner * nCorner),
  };
}

/**
 * Para cada pixel da imagem entregue (W × H), o índice do pixel de origem na imagem ideal
 * (Wi × Hi, renderizada com escala q em relação a fpx). -1 = fora da imagem ideal.
 */
export function lensMap(W, H, Wi, Hi, lambda, q = 1) {
  const map = new Int32Array(W * H);
  const half = W / 2, cx = W / 2, cy = H / 2, ci = Wi / 2, cj = Hi / 2;
  const inv = 1 / (half * half);
  for (let y = 0, j = 0; y < H; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < W; x++, j++) {
      const dx = x + 0.5 - cx;
      const s = q / (1 + lambda * (dx * dx + dy * dy) * inv);
      const sx = Math.floor(ci + dx * s), sy = Math.floor(cj + dy * s);
      map[j] = sx >= 0 && sx < Wi && sy >= 0 && sy < Hi ? sy * Wi + sx : -1;
    }
  }
  return map;
}

/**
 * Projeção de um ponto do mundo na imagem entregue, com a distorção da lente.
 * cam: câmera resolvida (fpx, lambda, w, h). null se o ponto está fora do alcance da lente.
 */
export function projectImage(p, cam) {
  const depth = cam.z - p.z;
  if (depth <= 1) return null;
  const du = ((p.x - cam.x) * cam.fpx) / depth, dv = ((p.y - cam.y) * cam.fpx) / depth;
  const half = cam.w / 2;
  const nu = Math.hypot(du, dv) / half;
  let k = 1;
  if (cam.lambda && nu > 1e-9) {
    // nu = nd / (1 + λ nd²)  →  λ nu nd² − nd + nu = 0
    const disc = 1 - 4 * cam.lambda * nu * nu;
    if (disc < 0) return null;
    k = (1 - Math.sqrt(disc)) / (2 * cam.lambda * nu) / nu;
  }
  return { u: cam.w / 2 + du * k, v: cam.h / 2 + dv * k };
}
