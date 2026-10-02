// Fotometria das luminárias: iluminância numa superfície horizontal e reflexo especular
// (a imagem espelhada da luminária). Puro, sem DOM. Distâncias em mm, luz em lm, cd, lux e cd/m².
//
// Cada luminária vira uma forma emissora com distribuição I(θ) = I0 · cosᵐ θ em torno da normal:
//   m = 0: igual em todas as direções da metade de baixo (lâmpada bulbo, 180°);
//   m = 1: Lambertiana, ângulo de 120° (painel, barra, difusor leitoso);
//   m > 1: feixe mais fechado (ring light). Fluxo: Φ = 2π · I0 / (m + 1).

const MM2_TO_M2 = 1e-6;

/** Intensidade no eixo (cd) de uma fonte com fluxo `lumens` e distribuição cosᵐ. */
export function peakIntensity(lumens, m) {
  return (lumens * (m + 1)) / (2 * Math.PI);
}

/** Expoente m a partir da iluminância no eixo que o fabricante informa (lux a `distM` metros). */
export function exponentFromAxial(lumens, lux, distM = 1) {
  return (2 * Math.PI * lux * distM * distM) / lumens - 1;
}

/** Refletância especular na incidência normal de um dielétrico com índice de refração n. */
export function fresnelF0(n) {
  return ((n - 1) / (n + 1)) ** 2;
}

/** Aproximação de Schlick: a reflexão cresce em ângulos rasantes. cosTheta = ângulo com a normal. */
export function schlick(f0, cosTheta) {
  const k = 1 - Math.min(1, Math.max(0, cosTheta));
  return f0 + (1 - f0) * k * k * k * k * k;
}

/** Função erro (Abramowitz & Stegun 7.1.26, erro < 1,5·10⁻⁷). */
export function erf(x) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

/** Fração de uma gaussiana de desvio `s`, centrada em `x`, que cai dentro de [a, b]. */
function inside(a, b, x, s) {
  return 0.5 * (erf(((b - x) * Math.SQRT1_2) / s) - erf(((a - x) * Math.SQRT1_2) / s));
}

/**
 * Pontos emissores de uma luminária resolvida (ver `resolveLuminaire` em lighting.js).
 * Cada um: posição (mm), normal unitária, intensidade no eixo I0 (cd) e expoente m.
 */
export function emitters(lum) {
  const out = [];
  const I0 = peakIntensity(lum.lumens, lum.m);
  if (lum.shape === 'rect') {
    const nx = Math.min(12, Math.max(1, Math.round(lum.w / 50)));
    const ny = Math.min(12, Math.max(1, Math.round(lum.d / 50)));
    const c = Math.cos(lum.rot), s = Math.sin(lum.rot);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const lx = ((i + 0.5) / nx - 0.5) * lum.w, ly = ((j + 0.5) / ny - 0.5) * lum.d;
        out.push({ x: lum.x + lx * c - ly * s, y: lum.y + lx * s + ly * c, z: lum.z, nx: 0, ny: 0, nz: -1, I0: I0 / (nx * ny), m: lum.m });
      }
    }
  } else if (lum.shape === 'sphere') {
    out.push({ x: lum.x, y: lum.y, z: lum.z, nx: 0, ny: 0, nz: -1, I0, m: lum.m });
  } else if (lum.shape === 'ring') {
    const n = 24, r = (lum.rIn + lum.rOut) / 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      out.push({ x: lum.x + r * Math.cos(a), y: lum.y + r * Math.sin(a), z: lum.z, nx: 0, ny: 0, nz: -1, I0: I0 / n, m: lum.m });
    }
  } else if (lum.shape === 'dome') {
    // superfície interna de luminância uniforme L, Lambertiana, voltada para o centro
    const L = domeLuminance(lum);
    const bands = 8, top = Math.asin(Math.min(1, lum.hole / lum.R)); // ângulo do furo, a partir do zênite
    const el0 = 0, el1 = Math.PI / 2 - top; // elevação a partir da borda
    const dEl = (el1 - el0) / bands;
    for (let b = 0; b < bands; b++) {
      const el = el0 + (b + 0.5) * dEl;
      const n = Math.max(6, Math.round(32 * Math.cos(el)));
      const dAz = (2 * Math.PI) / n;
      const area = lum.R * lum.R * Math.cos(el) * dEl * dAz * MM2_TO_M2;
      for (let i = 0; i < n; i++) {
        const az = (i + 0.5) * dAz;
        const ux = Math.cos(el) * Math.cos(az), uy = Math.cos(el) * Math.sin(az), uz = Math.sin(el);
        out.push({ x: lum.x + lum.R * ux, y: lum.y + lum.R * uy, z: lum.z + lum.R * uz, nx: -ux, ny: -uy, nz: -uz, I0: L * area, m: 1 });
      }
    }
  }
  return out;
}

/** Luminância interna do domo: fluxo útil espalhado por igual na meia esfera (Φ = π · L · área). */
export function domeLuminance(lum) {
  const area = 2 * Math.PI * lum.R * lum.R * MM2_TO_M2;
  return lum.lumens / (Math.PI * area);
}

/** Iluminância (lux) numa superfície horizontal virada para cima no ponto (x, y, z). */
export function illuminance(ems, x, y, z) {
  let E = 0;
  for (const e of ems) {
    const sx = e.x - x, sy = e.y - y, sz = e.z - z;
    if (sz <= 0) continue; // fonte abaixo da superfície
    const d2 = sx * sx + sy * sy + sz * sz;
    const d = Math.sqrt(d2);
    const cosR = sz / d;
    // ângulo de emissão: entre a normal do emissor e a direção emissor → ponto
    const cosE = -(e.nx * sx + e.ny * sy + e.nz * sz) / d;
    if (cosE <= 0) continue;
    E += (e.I0 * (e.m === 0 ? 1 : e.m === 1 ? cosE : Math.pow(cosE, e.m)) * cosR) / (d2 * MM2_TO_M2);
  }
  return E;
}

/**
 * Luminância (cd/m²) que um espelho no ponto P vê na direção refletida r (unitária, para cima),
 * já espalhada pela aspereza: a reflexão é um lóbulo gaussiano de desvio `sigma` (rad) em torno de r.
 * Retorna 0 se o raio refletido não chega à luminária.
 */
export function mirrorLuminance(lum, px, py, pz, rx, ry, rz, sigma) {
  if (rz <= 1e-6) return 0;
  const spread = Math.tan(Math.min(sigma, 1.2));
  if (lum.shape === 'dome') return domeMirror(lum, px, py, pz, rx, ry, rz, spread);
  const t = (lum.z - pz) / rz; // distância até o plano da luminária, ao longo do raio
  if (t <= 0) return 0;
  const hx = px + t * rx - lum.x, hy = py + t * ry - lum.y;
  const s = Math.max(0.5, t * spread);
  const cosE = rz;
  const I0 = peakIntensity(lum.lumens, lum.m);
  if (lum.shape === 'rect') {
    const c = Math.cos(lum.rot), sn = Math.sin(lum.rot);
    const lx = hx * c + hy * sn, ly = -hx * sn + hy * c;
    const hw = lum.w / 2, hd = lum.d / 2;
    if (Math.abs(lx) > hw + 4 * s || Math.abs(ly) > hd + 4 * s) return 0;
    const L = (I0 * Math.pow(cosE, lum.m - 1)) / (lum.w * lum.d * MM2_TO_M2);
    return L * inside(-hw, hw, lx, s) * inside(-hd, hd, ly, s);
  }
  if (lum.shape === 'sphere') {
    // esfera: área projetada constante; para o espalhamento, quadrado de mesma área
    const half = (lum.r * Math.sqrt(Math.PI)) / 2;
    if (Math.abs(hx) > half + 4 * s || Math.abs(hy) > half + 4 * s) return 0;
    const L = (I0 * Math.pow(cosE, lum.m)) / (Math.PI * lum.r * lum.r * MM2_TO_M2);
    return L * inside(-half, half, hx, s) * inside(-half, half, hy, s);
  }
  if (lum.shape === 'ring') {
    const rho = Math.hypot(hx, hy);
    if (rho < lum.rIn - 4 * s || rho > lum.rOut + 4 * s) return 0;
    const area = Math.PI * (lum.rOut * lum.rOut - lum.rIn * lum.rIn) * MM2_TO_M2;
    const L = (I0 * Math.pow(cosE, lum.m - 1)) / area;
    return L * inside(lum.rIn, lum.rOut, rho, s);
  }
  return 0;
}

function domeMirror(lum, px, py, pz, rx, ry, rz, spread) {
  const ox = px - lum.x, oy = py - lum.y, oz = pz - lum.z;
  const c = ox * ox + oy * oy + oz * oz - lum.R * lum.R;
  if (c > 0) return 0; // ponto fora do domo
  const b = ox * rx + oy * ry + oz * rz;
  const t = -b + Math.sqrt(b * b - c);
  const hz = oz + t * rz;
  if (hz <= 0) return 0; // sai pela abertura de baixo
  const phi = Math.acos(Math.min(1, hz / lum.R)); // ângulo a partir do zênite
  const beta = Math.asin(Math.min(1, lum.hole / lum.R));
  const s = Math.max(0.5, t * spread) / lum.R;
  // fora do furo da câmera: o furo aparece como um ponto escuro refletido
  return domeLuminance(lum) * 0.5 * (1 + erf(((phi - beta) * Math.SQRT1_2) / s));
}
