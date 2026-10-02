// Iluminação: tipos de luz, variação ao longo do dia, cintilação (flicker) e exposição.

/**
 * Luminárias da bancada. Cada modelo tem dois comportamentos: sem difusor (luz dura, reflexo forte e
 * pequeno) e com difusor por cima (luz macia, reflexo fraco e espalhado, perde ~30% da luz).
 * hot: tamanho da mancha de reflexo [x, y] em fração da meia-diagonal da imagem.
 * ring: reflexo em anel (ring light em volta da lente). falloff: escurecimento nas bordas.
 */
export const FIXTURE_MODELS = {
  bulb: {
    label: 'Lâmpada (bulbo LED)', lux: 800, kelvin: 3000, flicker: 0.1,
    hint: 'Lâmpada comum sobre a bancada. Sem difusor, faz um ponto de reflexo forte na fita.',
    bare: { specular: 1.6, hot: [0.12, 0.12], falloff: 0.9 },
    diffused: { specular: 0.35, hot: [0.35, 0.35], falloff: 0.45 },
  },
  bar: {
    label: 'Light bar (barra de LED)', lux: 900, kelvin: 5600, flicker: 0.03,
    hint: 'Barra linear paralela à fita. O reflexo vira uma faixa sobre a fita; afastar a barra para frente ou para trás tira o reflexo de cima dela.',
    bare: { specular: 1.1, hot: [0.42, 0.05], falloff: 0.5 },
    diffused: { specular: 0.22, hot: [0.55, 0.18], falloff: 0.25 },
  },
  ring: {
    label: 'Ring light (anel na lente)', lux: 700, kelvin: 5600, flicker: 0.03, fixedToCamera: true,
    hint: 'Anel de LED em volta da câmera. Ilumina por igual, mas reflete um anel em superfícies brilhantes.',
    bare: { specular: 1.2, ring: [0.13, 0.03], falloff: 0.35 },
    diffused: { specular: 0.1, ring: [0.16, 0.12], falloff: 0.2 },
  },
  panel: {
    label: 'Painel de LED', lux: 860, kelvin: 5000, flicker: 0.02,
    hint: 'Painel plano. Com difusor e cobertura é a luz mais estável e com menos reflexo.',
    bare: { specular: 0.5, hot: [0.6, 0.6], falloff: 0.1 },
    diffused: { specular: 0.06, hot: [0.9, 0.9], falloff: 0 },
  },
  dome: {
    label: 'Domo difuso', lux: 860, kelvin: 5600, flicker: 0.02, alwaysDiffuse: true,
    hint: 'Cúpula que espalha a luz por todos os lados. Praticamente elimina reflexo, mas precisa envolver a área da caixa.',
    bare: { specular: 0.02, hot: [1.2, 1.2], falloff: 0 },
    diffused: { specular: 0.02, hot: [1.2, 1.2], falloff: 0 },
  },
};

/** Fração da luz que atravessa o difusor. */
export const DIFFUSER_TRANSMISSION = 0.7;

let fixtureCount = 0;
export function makeFixture(model = 'panel', overrides = {}) {
  const m = FIXTURE_MODELS[model] || FIXTURE_MODELS.panel;
  fixtureCount += 1;
  return {
    id: `luz-${Date.now().toString(36)}-${fixtureCount}`,
    model, on: true, diffuser: true,
    lux: m.lux, kelvin: m.kelvin, flicker: m.flicker,
    offset: 0, strobe: false, pulse: 1 / 1000, overdrive: 4,
    ...overrides,
  };
}

export const DEFAULT_AMBIENT = { on: false, lamps: 600, lampKelvin: 4000, lampFlicker: 0.15, skylight: 220, windows: 120, hour: 12 };

export function defaultLight() {
  return { ambient: { ...DEFAULT_AMBIENT }, fixtures: [makeFixture('panel', { id: 'luz-painel' })], cover: 0 };
}

/** Converte o formato antigo ({ type, lux, kelvin, ... }) e completa campos que faltarem. */
export function normalizeLight(raw) {
  if (!raw) return defaultLight();
  if (raw.fixtures || raw.ambient) {
    return {
      ambient: { ...DEFAULT_AMBIENT, ...(raw.ambient || {}) },
      fixtures: (raw.fixtures || []).map((f) => ({ ...makeFixture(f.model), ...f })),
      cover: raw.cover ?? 0,
    };
  }
  const L = { ambient: { ...DEFAULT_AMBIENT }, fixtures: [], cover: 0 };
  if (raw.type === 'ambiente') {
    Object.assign(L.ambient, { on: true, lamps: raw.lux ?? 600, hour: raw.hour ?? 12, skylight: raw.skylight ?? 220, windows: raw.windows ?? 120 });
  } else if (raw.type === 'pontual') {
    L.fixtures.push(makeFixture('bulb', { diffuser: false, lux: raw.lux ?? 800, kelvin: raw.kelvin ?? 3000, flicker: raw.flicker ?? 0.1 }));
  } else {
    L.fixtures.push(makeFixture('panel', { lux: (raw.lux ?? 600) / DIFFUSER_TRANSMISSION, kelvin: raw.kelvin ?? 5000, flicker: raw.flicker ?? 0.02 }));
  }
  return L;
}

/** Comportamento óptico de uma luminária (com ou sem difusor). */
export function fixtureLook(f) {
  const m = FIXTURE_MODELS[f.model] || FIXTURE_MODELS.panel;
  const diff = m.alwaysDiffuse || f.diffuser;
  return { ...(diff ? m.diffused : m.bare), diffused: diff, lux: f.lux * (diff && !m.alwaysDiffuse ? DIFFUSER_TRANSMISSION : 1) };
}

/** Luz do dia na bancada (teto com difusor e janelas) numa hora. */
export function daylightAt(hour, skylightLux = 220, windowLux = 120) {
  const dayT = Math.min(1, Math.max(0, (hour - 6) / 13)); // 0 às 6h, 1 às 19h
  const sun = Math.max(0, Math.sin(dayT * Math.PI)); // 0 no começo/fim do dia, 1 ao meio-dia
  return {
    sky: skylightLux * Math.pow(sun, 1.2), skyK: 5200 + 1000 * sun, // difusor deixa a luz mais neutra
    win: windowLux * Math.pow(sun, 0.8), winK: 3200 + 2800 * sun, // janela pega luz mais cedo e mais tarde
  };
}

const AMBIENT_LOOK = { specular: 0.18, hot: [0.45, 0.45], center: [0.62, 0.42], falloff: 0, gradient: 0, strobe: false };

/** Fontes ativas, cada uma com intensidade, cor, forma (queda, reflexo) e flicker. */
export function lightSources(light) {
  const L = normalizeLight(light);
  const out = [];
  const keep = 1 - Math.min(0.95, Math.max(0, L.cover || 0));
  const a = L.ambient;
  if (a.on) {
    const d = daylightAt(a.hour, a.skylight, a.windows);
    out.push({ id: 'lamps', group: 'ambient', label: 'Lâmpadas do galpão', lux: a.lamps * keep, kelvin: a.lampKelvin, flicker: a.lampFlicker, ...AMBIENT_LOOK });
    if (d.sky > 0.5) out.push({ id: 'sky', group: 'ambient', label: 'Teto (luz do dia)', lux: d.sky * keep, kelvin: d.skyK, flicker: 0, ...AMBIENT_LOOK });
    // janelas clareiam um lado da bancada
    if (d.win > 0.5) out.push({ id: 'win', group: 'ambient', label: 'Janelas', lux: d.win * keep, kelvin: d.winK, flicker: 0, ...AMBIENT_LOOK, gradient: 0.6 });
  }
  for (const f of L.fixtures) {
    if (!f.on) continue;
    const look = fixtureLook(f);
    out.push({
      id: f.id, group: 'bench', label: FIXTURE_MODELS[f.model]?.label || 'Luz',
      lux: look.lux, kelvin: f.kelvin, flicker: f.strobe ? 0 : f.flicker,
      specular: look.specular, hot: look.hot || null, ring: look.ring || null,
      // deslocamento para frente/trás da emenda (a fita corre no sentido do comprimento da caixa)
      center: [0.5, 0.5 + (FIXTURE_MODELS[f.model]?.fixedToCamera ? 0 : f.offset || 0)], falloff: look.falloff, gradient: 0,
      strobe: !!f.strobe, pulse: f.pulse, overdrive: f.overdrive,
    });
  }
  return out;
}

/**
 * Quanto a fonte contribui no tempo de exposição, relativo a 1/120 s.
 * Contínua: proporcional ao obturador. Pulsada: só dura o pulso (multiplicado pelo overdrive),
 * então encurtar o obturador até o tamanho do pulso corta o ambiente sem perder o LED.
 */
export function timeFactor(src, shutterS) {
  if (src.strobe) return src.overdrive * Math.min(src.pulse, shutterS) * 120;
  return shutterS * 120;
}

/** Sinal relativo que a fonte gera numa superfície branca (1 ≈ bem exposto). */
export function sourceSignal(src, shutterS, gainDb = 0) {
  return (src.lux / 500) * timeFactor(src, shutterS) * Math.pow(10, gainDb / 20) * 0.9;
}

/** Participação de cada grupo de fonte (ambient = galpão, bench = luzes da bancada) no sinal da imagem. */
export function lightMix(light, shutterS) {
  const src = lightSources(light);
  const by = {};
  let total = 0;
  for (const s of src) {
    const v = sourceSignal(s, shutterS);
    by[s.group] = (by[s.group] || 0) + v;
    total += v;
  }
  for (const k of Object.keys(by)) by[k] /= total || 1;
  return { shares: by, total };
}

/** Quanto o brilho total da imagem muda ao longo do dia (7h a 18h), com o obturador dado. */
export function dayVariation(light, shutterS) {
  const L = normalizeLight(light);
  if (!L.ambient.on) return { min: 1, max: 1, spread: 0 };
  let min = Infinity, max = -Infinity;
  for (let h = 7; h <= 18; h += 0.5) {
    const t = lightSources({ ...L, ambient: { ...L.ambient, hour: h } }).reduce((acc, s) => acc + sourceSignal(s, shutterS), 0);
    min = Math.min(min, t);
    max = Math.max(max, t);
  }
  return { min, max, spread: (max - min) / ((max + min) / 2 || 1) };
}

/** Variação entre fotos por flicker, ponderada pela participação de cada fonte. */
export function combinedFlicker(light, shutterS) {
  const src = lightSources(light);
  let total = 0, acc = 0;
  for (const s of src) {
    const v = sourceSignal(s, shutterS);
    total += v;
    if (s.flicker > 0) acc += v * flickerRange(shutterS, s.flicker).spread;
  }
  return total ? acc / total : 0;
}

/** Exposição de referência: 500 lux, 1/120 s, 0 dB dá uma imagem bem exposta. */
const REF = 500 * (1 / 120);

/** Fator multiplicativo de exposição (sinal linear relativo). */
export function exposureFactor(lux, shutterS, gainDb) {
  return ((lux * shutterS) / REF) * Math.pow(10, gainDb / 20) * 0.9;
}

/**
 * Média da intensidade de uma luz que oscila a `freqHz` (luz de rede 60 Hz → 120 Hz)
 * durante uma exposição de `shutterS`, começando na fase `phase`.
 * modulation 0..1 = profundidade da oscilação.
 */
export function flickerAverage(shutterS, phase, modulation, freqHz = 120) {
  if (!modulation) return 1;
  const w = 2 * Math.PI * freqHz;
  const x = w * shutterS;
  if (x < 1e-6) return 1 + modulation * Math.cos(phase);
  return 1 + (modulation * (Math.sin(x + phase) - Math.sin(phase))) / x;
}

/** Variação (mín e máx) do brilho entre fotos por causa do flicker, em fração. */
export function flickerRange(shutterS, modulation, freqHz = 120) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 64; i++) {
    const v = flickerAverage(shutterS, (i / 64) * 2 * Math.PI, modulation, freqHz);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { min, max, spread: max - min };
}

/** Luz ambiente total (lâmpadas + dia) numa hora: lux, temperatura de cor e fração das janelas. */
export function ambientAt(hour, baseLux, { skylightLux = 220, windowLux = 120, baseKelvin = 4000 } = {}) {
  const d = daylightAt(hour, skylightLux, windowLux);
  const total = baseLux + d.sky + d.win;
  const mired = (baseLux * (1e6 / baseKelvin) + d.sky * (1e6 / d.skyK) + d.win * (1e6 / d.winK)) / Math.max(total, 1);
  return { lux: total, kelvin: 1e6 / mired, windowShare: d.win / Math.max(total, 1) };
}

/** Lista de tempos de obturador comuns em câmeras IP. */
export const SHUTTERS = [
  1 / 30, 1 / 50, 1 / 60, 1 / 100, 1 / 120, 1 / 200, 1 / 250, 1 / 500, 1 / 1000, 1 / 2000, 1 / 4000,
];

export function shutterLabel(s) {
  return s >= 1 ? `${s.toFixed(1)} s` : `1/${Math.round(1 / s)} s`;
}

/** Tempo de obturador é múltiplo do período de flicker (1/120 s)? */
export function isFlickerSafe(shutterS, freqHz = 120) {
  const n = shutterS * freqHz;
  return n >= 0.999 && Math.abs(n - Math.round(n)) < 0.02;
}
