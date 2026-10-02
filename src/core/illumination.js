// Luz por pixel da imagem ideal (antes da distorção da lente): iluminância de cada fonte na superfície
// vista em cada pixel e o reflexo especular dela. Puro, sem DOM.

import { mirrorLuminance, schlick, illuminance } from './photometry.js';
import { surfaceOf } from './materials.js';

const GRID = 16; // a iluminância varia devagar: calculada a cada 16 px e interpolada

/**
 * Para cada fonte, dois mapas relativos à iluminância de referência da fonte (`src.lux`):
 *   field[j]: iluminância no pixel j / src.lux (luz difusa);
 *   hot[j]:   reflexo especular no pixel j, como iluminância equivalente / src.lux
 *             (π · Fresnel · luminância refletida da luminária / src.lux).
 * O galpão é tratado como um céu uniforme: reflete Fresnel × a própria iluminância.
 * objs: objetos visíveis, já com z1, em ordem de desenho (do mais baixo ao mais alto).
 */
export function computeLightFields({ cam, W, H, objs, sources }) {
  const N = W * H;
  const tops = objs.filter((o) => o.z1 < cam.z - 5).map((o) => {
    const s = surfaceOf(o);
    const r = (o.rot * Math.PI) / 180;
    return { z: o.z1, x: o.x, y: o.y, hw: o.w / 2, hd: o.d / 2, c: Math.cos(r), s: Math.sin(r), f0: s.f0, rough: s.roughness };
  }).reverse(); // o de cima primeiro
  const heights = [0, ...new Set(tops.map((t) => t.z))];
  const layerOf = tops.map((t) => heights.indexOf(t.z));

  // Qual superfície cada pixel vê (-1 = bancada)
  const hit = new Int16Array(N).fill(-1);
  const cx = W / 2, cy = H / 2;
  for (let v = 0, j = 0; v < H; v++) {
    for (let u = 0; u < W; u++, j++) {
      const du = (u + 0.5 - cx) / cam.fpx, dv = (v + 0.5 - cy) / cam.fpx;
      for (let k = 0; k < tops.length; k++) {
        const t = tops[k], depth = cam.z - t.z;
        const dx = cam.x + du * depth - t.x, dy = cam.y + dv * depth - t.y;
        const lx = dx * t.c + dy * t.s, ly = -dx * t.s + dy * t.c;
        if (lx >= -t.hw && lx <= t.hw && ly >= -t.hd && ly <= t.hd) { hit[j] = k; break; }
      }
    }
  }

  // Iluminância numa grade, por altura de superfície
  const gw = Math.ceil(W / GRID) + 1, gh = Math.ceil(H / GRID) + 1;
  const grid = (ems, z) => {
    const g = new Float32Array(gw * gh);
    const depth = cam.z - z;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const x = cam.x + ((gx * GRID - cx) / cam.fpx) * depth, y = cam.y + ((gy * GRID - cy) / cam.fpx) * depth;
        g[gy * gw + gx] = illuminance(ems, x, y, z);
      }
    }
    return g;
  };
  const sample = (g, u, v) => {
    const fx = u / GRID, fy = v / GRID;
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
    const i = y0 * gw + x0;
    return (g[i] * (1 - tx) + g[i + 1] * tx) * (1 - ty) + (g[i + gw] * (1 - tx) + g[i + gw + 1] * tx) * ty;
  };

  const R = Math.hypot(W, H) / 2;

  const out = sources.map((src) => {
    const ref = Math.max(src.lux, 1e-3);
    if (src.group !== 'bench') {
      let field = null;
      if (src.gradient) {
        field = new Float32Array(N);
        for (let v = 0, j = 0; v < H; v++) for (let u = 0; u < W; u++, j++) field[j] = 1 + (src.gradient * (u - cx)) / R;
      }
      return { field, hot: null, ambient: true };
    }
    const grids = heights.map((z) => grid(src.ems, z));
    const field = new Float32Array(N);
    const hot = new Float32Array(N);
    const lum = src.lum;
    for (let v = 0, j = 0; v < H; v++) {
      for (let u = 0; u < W; u++, j++) {
        const k = hit[j];
        field[j] = sample(grids[k < 0 ? 0 : layerOf[k]], u, v) / ref;
        if (k < 0) continue;
        const t = tops[k];
        if (!t.f0) continue;
        // ponto visto, direção da câmera até ele e direção refletida (normal para cima)
        const depth = cam.z - t.z;
        const px = cam.x + ((u + 0.5 - cx) / cam.fpx) * depth, py = cam.y + ((v + 0.5 - cy) / cam.fpx) * depth;
        let vx = px - cam.x, vy = py - cam.y, vz = -depth;
        const n = Math.hypot(vx, vy, vz);
        vx /= n; vy /= n; vz /= n;
        const L = mirrorLuminance(lum, px, py, t.z, vx, vy, -vz, t.rough);
        if (L > 0) hot[j] = (Math.PI * schlick(t.f0, -vz) * L) / ref;
      }
    }
    return { field, hot, ambient: false };
  });

  // Galpão: céu uniforme de luminância E/π → reflexo = Fresnel × E
  if (out.some((o) => o.ambient)) {
    const ambientHot = new Float32Array(N);
    for (let v = 0, j = 0; v < H; v++) {
      for (let u = 0; u < W; u++, j++) {
        const k = hit[j];
        if (k < 0 || !tops[k].f0) continue;
        const depth = cam.z - tops[k].z;
        const du = (u + 0.5 - cx) / cam.fpx * depth, dv = (v + 0.5 - cy) / cam.fpx * depth;
        ambientHot[j] = schlick(tops[k].f0, depth / Math.hypot(du, dv, depth));
      }
    }
    for (const o of out) if (o.ambient) o.hot = ambientHot;
  }
  return out;
}
