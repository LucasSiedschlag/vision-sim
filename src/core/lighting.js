// Iluminação: luminárias (produtos reais), luz do galpão ao longo do dia, cintilação (flicker) e exposição.

import { emitters, illuminance } from './photometry.js';

/**
 * Luminárias da bancada: produtos baratos encontrados no varejo brasileiro (consulta em 02/10/2026),
 * com os dados fotométricos do fabricante. `estimated` lista o que não veio do datasheet.
 * shape: forma emissora (ver src/core/photometry.js). size: dimensões da parte que emite luz (mm).
 * m: expoente da distribuição cosᵐ (0 = 180°, 1 = 120° Lambertiana, maior = feixe mais fechado).
 */
export const FIXTURE_MODELS = {
  bulb: {
    label: 'Lâmpada LED bulbo 9 W',
    product: 'Philips LEDbulb A60 9 W 6500 K E27', price: null, store: 'Telhanorte',
    lumens: 806, kelvin: 6500, flicker: 0.02, shape: 'sphere', size: [60, 60], m: 0,
    source: 'Signify 929002038012: 806 lm, feixe de 180°, Ø 61 mm',
    estimated: ['flicker'],
    hint: 'Lâmpada comum num soquete sobre a bancada. Pequena e muito brilhante: na fita, o reflexo é um ponto que estoura.',
  },
  bar: {
    label: 'Luminária linear LED 60 cm 16 W',
    product: 'Avant Hummer 60 cm 16 W 6500 K', price: 25.47, store: 'varejo online (Pix)',
    lumens: 1460, kelvin: 6500, flicker: 0.35, shape: 'rect', size: [600, 30], m: 1,
    source: 'Avant: 1460 lm. Largura da parte acesa estimada.',
    estimated: ['size', 'flicker', 'm'],
    hint: 'Barra paralela à fita. O reflexo é uma faixa; tirar a barra da linha entre a câmera e a fita tira o reflexo de cima dela.',
  },
  panel: {
    label: 'Painel LED de sobrepor 24 W (28 × 28 cm)',
    product: 'Taschibra painel quadrado sobrepor 24 W 6500 K', price: null, store: 'Telhanorte',
    lumens: 1680, kelvin: 6500, flicker: 0.1, shape: 'rect', size: [280, 280], m: 1,
    source: 'Taschibra: 1680 lm (versão 3000 K), feixe de 120°, 28 × 28 cm',
    estimated: ['lumens', 'flicker'],
    hint: 'Painel com tampa leitosa: luz mais macia que a lâmpada. Ainda assim aparece como um quadrado claro refletido na fita.',
  },
  ring: {
    label: 'Ring light 26 cm (USB)',
    product: 'Streamplify Light 10', price: 149.99, store: 'Pichau',
    lumens: 1000, kelvin: 5600, flicker: 0, shape: 'ring', size: [260, 220], m: 2.13, fixedToCamera: true,
    source: 'Streamplify: 1000 lm, 480 lux a 1 m (m = 2,13 reproduz isso com o anel de 26 cm), 3000–6000 K, USB 5 V (corrente contínua)',
    estimated: ['size'],
    hint: 'Anel em volta da lente. Ilumina por igual, mas numa superfície brilhante reflete um anel no meio da imagem.',
  },
  dome: {
    label: 'Domo difuso (montagem própria, Ø 90 cm)',
    product: 'Cúpula branca fosca com fita LED por dentro', price: null, store: '',
    lumens: 1500, kelvin: 6500, flicker: 0.02, shape: 'dome', size: [900, 40], m: 1, fixedToCamera: true, alwaysDiffuse: true,
    source: 'Montagem própria: valores estimados',
    estimated: ['lumens', 'flicker', 'size'],
    hint: 'Cúpula que cobre a caixa e ilumina de todos os lados. Quase sem reflexo; só o furo da câmera aparece como um ponto escuro refletido.',
  },
};

/** Fração da luz que atravessa a placa difusora leitosa (acrílico opalino). Estimada. */
export const DIFFUSER_TRANSMISSION = 0.7;
/** Placa difusora: margem em volta da luminária e distância abaixo dela (mm). */
const DIFFUSER_MARGIN = 100, DIFFUSER_DROP = 50;

/** Posição padrão das luminárias soltas: ao lado da câmera, um pouco abaixo dela. */
const DEFAULT_POSITION = { x: 0, y: 300, z: 1100, rot: 0 };

let fixtureCount = 0;
export function makeFixture(model = 'panel', overrides = {}) {
  const m = FIXTURE_MODELS[model] || FIXTURE_MODELS.panel;
  fixtureCount += 1;
  return {
    id: `luz-${Date.now().toString(36)}-${fixtureCount}`,
    model, on: true, diffuser: false,
    lumens: m.lumens, kelvin: m.kelvin, flicker: m.flicker,
    ...DEFAULT_POSITION,
    ...(model === 'dome' ? { z: 60, radius: m.size[0] / 2 } : {}),
    strobe: false, pulse: 1 / 1000, overdrive: 4,
    ...overrides,
  };
}

export const DEFAULT_AMBIENT = { on: false, lamps: 600, lampKelvin: 4000, lampFlicker: 0.15, skylight: 220, windows: 120, hour: 12 };

export function defaultLight() {
  return { ambient: { ...DEFAULT_AMBIENT }, fixtures: [makeFixture('panel', { id: 'luz-painel' })], cover: 0 };
}

/** Converte formatos antigos e completa campos que faltarem. */
export function normalizeLight(raw) {
  if (!raw) return defaultLight();
  if (raw.fixtures || raw.ambient) {
    return {
      ambient: { ...DEFAULT_AMBIENT, ...(raw.ambient || {}) },
      fixtures: (raw.fixtures || []).map(normalizeFixture),
      cover: raw.cover ?? 0,
    };
  }
  const L = { ambient: { ...DEFAULT_AMBIENT }, fixtures: [], cover: 0 };
  if (raw.type === 'ambiente') {
    Object.assign(L.ambient, { on: true, lamps: raw.lux ?? 600, hour: raw.hour ?? 12, skylight: raw.skylight ?? 220, windows: raw.windows ?? 120 });
  } else if (raw.type === 'pontual') {
    L.fixtures.push(makeFixture('bulb', { kelvin: raw.kelvin ?? 3000, flicker: raw.flicker ?? 0.1 }));
  } else {
    L.fixtures.push(makeFixture('panel', { diffuser: true, kelvin: raw.kelvin ?? 5000, flicker: raw.flicker ?? 0.02 }));
  }
  return L;
}

/**
 * Luminária salva antes da fotometria tinha `lux` (na bancada) e `offset` (fração da imagem).
 * Vira o produto do mesmo tipo na posição padrão; o deslocamento vira mm na direção da fita.
 */
function normalizeFixture(f) {
  const base = makeFixture(FIXTURE_MODELS[f.model] ? f.model : 'panel');
  const out = { ...base, ...f };
  if (f.lumens == null) {
    out.lumens = base.lumens;
    if (f.offset) out.y = DEFAULT_POSITION.y + f.offset * 1000;
  }
  delete out.lux;
  delete out.offset;
  return out;
}

/**
 * Forma emissora de uma luminária, no espaço da cena (mm). Com placa difusora, quem emite é a placa:
 * maior, Lambertiana, mais baixa e com 70% do fluxo.
 */
export function resolveLuminaire(f, camera = { x: 0, y: 0, z: 1300 }) {
  const m = FIXTURE_MODELS[f.model] || FIXTURE_MODELS.panel;
  const attached = m.fixedToCamera;
  const x = attached ? camera.x : f.x, y = attached ? camera.y : f.y;
  const rot = ((f.rot || 0) * Math.PI) / 180;
  if (m.shape === 'dome') {
    return { shape: 'dome', x, y, z: f.z ?? 60, R: f.radius ?? m.size[0] / 2, hole: m.size[1], lumens: f.lumens, m: 1, rot: 0 };
  }
  const z = attached ? camera.z - 20 : f.z;
  if (f.diffuser && !m.alwaysDiffuse && !attached) {
    const [w, d] = m.size;
    return {
      shape: 'rect', x, y, z: z - DIFFUSER_DROP, rot,
      w: Math.max(300, w + 2 * DIFFUSER_MARGIN), d: Math.max(300, d + 2 * DIFFUSER_MARGIN),
      lumens: f.lumens * DIFFUSER_TRANSMISSION, m: 1, diffused: true,
    };
  }
  if (m.shape === 'ring') return { shape: 'ring', x, y, z, rot, rOut: m.size[0] / 2, rIn: m.size[1] / 2, lumens: f.lumens, m: m.m };
  if (m.shape === 'sphere') return { shape: 'sphere', x, y, z, rot, r: m.size[0] / 2, lumens: f.lumens, m: m.m };
  return { shape: 'rect', x, y, z, rot, w: m.size[0], d: m.size[1], lumens: f.lumens, m: m.m };
}

/**
 * Onde o reflexo do centro da luminária cai num plano horizontal na altura z, visto pela câmera:
 * o ponto do plano em que o raio câmera → plano → luminária obedece à lei da reflexão.
 * null se a luminária não está acima do plano.
 */
export function glarePoint(lum, camera, z) {
  const hc = camera.z - z, hf = lum.z - z;
  if (hc <= 0 || hf <= 0) return null;
  const t = hc / (hc + hf);
  return { x: camera.x + (lum.x - camera.x) * t, y: camera.y + (lum.y - camera.y) * t };
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

/**
 * Fontes ativas. Galpão: iluminância uniforme (as janelas clareiam um lado). Bancada: luminária com
 * forma e posição; `lux` é a iluminância calculada no ponto de referência (centro do alvo).
 * ctx: { camera: {x, y, z}, ref: {x, y, z} } — câmera (ring light e domo acompanham) e alvo.
 */
export function lightSources(light, ctx = {}) {
  const L = normalizeLight(light);
  const camera = ctx.camera || { x: 0, y: 0, z: 1300 };
  const ref = ctx.ref || { x: 0, y: 0, z: 0 };
  const out = [];
  const keep = 1 - Math.min(0.95, Math.max(0, L.cover || 0));
  const a = L.ambient;
  if (a.on) {
    const d = daylightAt(a.hour, a.skylight, a.windows);
    const amb = { group: 'ambient', gradient: 0, strobe: false };
    out.push({ ...amb, id: 'lamps', label: 'Lâmpadas do galpão', lux: a.lamps * keep, kelvin: a.lampKelvin, flicker: a.lampFlicker });
    if (d.sky > 0.5) out.push({ ...amb, id: 'sky', label: 'Teto (luz do dia)', lux: d.sky * keep, kelvin: d.skyK, flicker: 0 });
    // janelas clareiam um lado da bancada
    if (d.win > 0.5) out.push({ ...amb, id: 'win', label: 'Janelas', lux: d.win * keep, kelvin: d.winK, flicker: 0, gradient: 0.6 });
  }
  for (const f of L.fixtures) {
    if (!f.on) continue;
    const lum = resolveLuminaire(f, camera);
    const ems = emitters(lum);
    out.push({
      id: f.id, group: 'bench', label: FIXTURE_MODELS[f.model]?.label || 'Luz',
      lux: illuminance(ems, ref.x, ref.y, ref.z), kelvin: f.kelvin, flicker: f.strobe ? 0 : f.flicker,
      lum, ems, strobe: !!f.strobe, pulse: f.pulse, overdrive: f.overdrive,
    });
  }
  return out;
}

/**
 * Tempo de exposição efetivo da fonte (s): luz que ela entrega equivale a `lux` durante esse tempo.
 * Contínua: o próprio obturador. Pulsada: só dura o pulso (multiplicado pelo overdrive),
 * então encurtar o obturador até o tamanho do pulso corta o ambiente sem perder o LED.
 */
export function timeFactor(src, shutterS) {
  if (src.strobe) return src.overdrive * Math.min(src.pulse, shutterS);
  return shutterS;
}

/** Exposição (lux·s na cena) que a fonte entrega, já multiplicada pelo ganho. */
export function sourceSignal(src, shutterS, gainDb = 0) {
  return src.lux * timeFactor(src, shutterS) * Math.pow(10, gainDb / 20);
}

/** Participação de cada grupo de fonte (ambient = galpão, bench = luzes da bancada) no sinal da imagem. */
export function lightMix(light, shutterS, ctx) {
  const src = lightSources(light, ctx);
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
export function dayVariation(light, shutterS, ctx) {
  const L = normalizeLight(light);
  if (!L.ambient.on) return { min: 1, max: 1, spread: 0 };
  let min = Infinity, max = -Infinity;
  for (let h = 7; h <= 18; h += 0.5) {
    const t = lightSources({ ...L, ambient: { ...L.ambient, hour: h } }, ctx).reduce((acc, s) => acc + sourceSignal(s, shutterS), 0);
    min = Math.min(min, t);
    max = Math.max(max, t);
  }
  return { min, max, spread: (max - min) / ((max + min) / 2 || 1) };
}

/** Variação entre fotos por flicker, ponderada pela participação de cada fonte. */
export function combinedFlicker(light, shutterS, ctx) {
  const src = lightSources(light, ctx);
  let total = 0, acc = 0;
  for (const s of src) {
    const v = sourceSignal(s, shutterS);
    total += v;
    if (s.flicker > 0) acc += v * flickerRange(shutterS, s.flicker).spread;
  }
  return total ? acc / total : 0;
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
