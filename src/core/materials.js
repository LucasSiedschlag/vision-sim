// Superfícies: quanto refletem como espelho (F0, Fresnel) e quão espalhado é esse reflexo (aspereza).
// A cor difusa continua vindo da textura do objeto.

import { fresnelF0 } from './photometry.js';

/**
 * f0: refletância especular na incidência normal. roughness: desvio do lóbulo de reflexo (rad).
 * Filme BOPP: índice de refração ≈ 1,50 (1,495–1,528 conforme a direção de estiramento) → F0 ≈ 4%;
 * brilho a 45° de 83–93 GU (ASTM D2457), quase espelho. Na caixa o filme segue as ondas do papelão:
 * aspereza estimada em ~2°. Papelão: celulose (n ≈ 1,5), superfície fosca (kraftliner revestido
 * mede 42–45 GU a 75°, TAPPI T480; o pardo comum é mais fosco). Aço inox: F0 ≈ 0,55 (ferro).
 */
export const SURFACES = {
  film: { label: 'Filme plástico liso (fita BOPP)', f0: fresnelF0(1.5), roughness: 0.04 },
  paper: { label: 'Papelão / papel', f0: fresnelF0(1.5), roughness: 0.45 },
  metal: { label: 'Aço inox escovado', f0: 0.55, roughness: 0.2 },
  fabric: { label: 'Tecido', f0: fresnelF0(1.5), roughness: 1 },
  matte: { label: 'Fosco, sem reflexo', f0: 0, roughness: 1 },
};

/** Superfície de um objeto. Cenas antigas guardavam só `gloss` (0..2): convertido aqui. */
export function surfaceOf(o) {
  const key = o.surface || legacySurface(o.gloss);
  const base = SURFACES[key] || SURFACES.matte;
  const roughness = o.roughness ?? (o.surface ? base.roughness : legacyRoughness(key, o.gloss));
  return { key, f0: base.f0, roughness: Math.max(0.005, roughness) };
}

function legacySurface(gloss = 0) {
  if (gloss >= 0.4) return 'film';
  if (gloss >= 0.2) return 'metal';
  if (gloss > 0.01) return 'paper';
  return 'matte';
}

function legacyRoughness(key, gloss = 0) {
  // filme: brilho 150% (fita transparente) → 0,03; 45% (fita branca) → 0,09
  if (key === 'film') return 0.03 + (0.06 * (1.5 - Math.min(1.5, gloss))) / 1.05;
  return SURFACES[key].roughness;
}
