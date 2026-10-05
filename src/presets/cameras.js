// Catálogo de câmeras: lido de data/cameras.csv (uma linha por câmera e lente; colunas descritas em
// data/LEIA-ME.md). Este módulo converte e valida as linhas; quem carrega o arquivo é o main.js (ou os
// testes) e entrega a lista com setCameraCatalog.

import { parseCsv } from '../core/csv.js';

/** Câmeras do catálogo (vazio até setCameraCatalog). */
export let CAMERAS = [];

export function setCameraCatalog(list) {
  CAMERAS = list;
}

export const COLUMNS = [
  'id', 'marca', 'modelo', 'nome', 'tipo', 'linha',
  'largura_px', 'altura_px', 'formato_sensor', 'pixel_um', 'sensor_modelo', 'obturador', 'leitura_ms',
  'sat_lux_s', 'capacidade_e', 'ruido_leitura_e',
  'lente', 'focal_mm', 'focal_tele_mm', 'hfov_graus', 'hfov_tele_graus', 'abertura', 'abertura_tele', 'distorcao', 'foco',
  'exposicao_manual', 'obturador_min_s', 'obturador_max_s', 'ganho_max_db', 'balanco', 'anti_cintilacao', 'ldc',
  'gatilho_externo', 'dia_noite', 'fps_max', 'wdr_db', 'interface', 'protecao', 'codec',
  'fonte_url', 'consultado_em', 'estimados', 'calibrada', 'observacoes',
];
export const REQUIRED = ['id', 'marca', 'modelo', 'tipo', 'largura_px', 'altura_px', 'lente', 'focal_mm', 'hfov_graus', 'abertura'];
const ENUMS = {
  tipo: ['ip', 'usb', 'industrial'],
  lente: ['fixa', 'varifocal', 'motorizada'],
  obturador: ['rolling', 'global'],
  foco: ['fixo', 'auto', 'motorizado'],
  dia_noite: ['ir', 'colorvu', 'não'],
};
export const WB_MODES = ['auto', 'manual-k', 'manual-rgb'];
/** Leitura de quadro quando não há leitura_ms nem fps_max: 1/30 s, típico de câmera 1080p30. */
const DEFAULT_READOUT_MS = 1000 / 30;

/**
 * Converte o texto do CSV em câmeras. Linhas com erro ficam de fora e entram em `errors`
 * ({ line, message }), para o arquivo nunca derrubar o simulador.
 */
export function parseCameraCatalog(text) {
  const { header, rows } = parseCsv(text);
  const errors = [];
  const unknown = header.filter((h) => h && !COLUMNS.includes(h));
  if (unknown.length) errors.push({ line: 1, message: `colunas desconhecidas: ${unknown.join(', ')}` });
  const missingCols = REQUIRED.filter((c) => !header.includes(c));
  if (missingCols.length) return { cameras: [], errors: [...errors, { line: 1, message: `faltam colunas obrigatórias: ${missingCols.join(', ')}` }] };
  const cameras = [], ids = new Set();
  for (const r of rows) {
    if (r.values.length !== header.length) {
      errors.push({ line: r.line, message: `${r.values.length} colunas, o cabeçalho tem ${header.length} (separador ou aspas?)` });
      continue;
    }
    const raw = Object.fromEntries(header.map((h, i) => [h, r.values[i].trim()]));
    try {
      const cam = cameraFromRow(raw);
      if (ids.has(cam.id)) throw new Error(`id repetido: ${cam.id}`);
      ids.add(cam.id);
      cam.csvLine = r.line;
      cameras.push(cam);
    } catch (e) {
      errors.push({ line: r.line, message: e.message });
    }
  }
  return { cameras, errors };
}

/* ---------- conversões de célula ---------- */

function num(raw, col, { min = -Infinity, max = Infinity, int = false } = {}) {
  const s = raw[col];
  if (s == null || s === '') return null;
  let v;
  const frac = /^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/.exec(s); // 1/100000 (obturador)
  if (frac) v = Number(frac[1].replace(',', '.')) / Number(frac[2].replace(',', '.'));
  else if (/^-?\d+(?:[.,]\d+)?$/.test(s)) v = Number(s.replace(',', '.'));
  else throw new Error(`${col}: "${s}" não é um número`);
  if (int && !Number.isInteger(v)) throw new Error(`${col}: "${s}" precisa ser inteiro`);
  if (v < min || v > max) throw new Error(`${col}: ${v} fora do intervalo ${min}–${max}`);
  return v;
}

function bool(raw, col) {
  const s = (raw[col] || '').toLowerCase();
  if (!s) return null;
  if (['sim', 's', 'yes', 'true', '1'].includes(s)) return true;
  if (['não', 'nao', 'n', 'no', 'false', '0'].includes(s)) return false;
  throw new Error(`${col}: "${raw[col]}" (use sim ou não)`);
}

function oneOf(raw, col) {
  const s = (raw[col] || '').toLowerCase();
  if (!s) return null;
  const v = s === 'nao' ? 'não' : s;
  if (!ENUMS[col].includes(v)) throw new Error(`${col}: "${raw[col]}" (use ${ENUMS[col].join(', ')})`);
  return v;
}

const list = (raw, col) => (raw[col] ? raw[col].split('|').map((v) => v.trim()).filter(Boolean) : []);

/** "1/2.8" ou "1/2,8" → 2,8 (o x de 1/x"). */
function sensorFormat(raw) {
  const s = raw.formato_sensor;
  if (!s) return null;
  const m = /^1\s*\/\s*(\d+(?:[.,]\d+)?)"?$/.exec(s);
  if (!m) throw new Error(`formato_sensor: "${s}" (use 1/2.8)`);
  return Number(m[1].replace(',', '.'));
}

/** Uma linha do CSV → modelo de câmera usado pelo simulador. */
export function cameraFromRow(raw) {
  for (const c of REQUIRED) if (!raw[c]) throw new Error(`${c} é obrigatório`);
  const id = raw.id;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`id "${id}": use só letras minúsculas, números e hífen`);
  if (id === 'custom') throw new Error('id "custom" é reservado');

  const lens = oneOf(raw, 'lente');
  const fW = num(raw, 'focal_mm', { min: 0.5, max: 500 }), fT = num(raw, 'focal_tele_mm', { min: 0.5, max: 500 });
  const hW = num(raw, 'hfov_graus', { min: 1, max: 179 }), hT = num(raw, 'hfov_tele_graus', { min: 1, max: 179 });
  const zoom = fT != null || hT != null;
  if (zoom && (fT == null || hT == null)) throw new Error('zoom: preencha focal_tele_mm e hfov_tele_graus juntos');
  if (zoom && lens === 'fixa') throw new Error('lente fixa não tem focal_tele_mm / hfov_tele_graus');
  if (!zoom && lens !== 'fixa') throw new Error(`lente ${lens} precisa de focal_tele_mm e hfov_tele_graus`);
  if (zoom && !(fT > fW && hT < hW)) throw new Error('tele precisa ter focal maior e FOV menor que o grande angular');

  const estimated = list(raw, 'estimados');
  const badEst = estimated.filter((c) => !COLUMNS.includes(c));
  if (badEst.length) throw new Error(`estimados: colunas desconhecidas ${badEst.join(', ')}`);
  const distortion = num(raw, 'distorcao', { min: -0.9, max: 0.5 });
  if (distortion == null && !estimated.includes('distorcao')) estimated.push('distorcao'); // sem dado: sem distorção, estimado

  const wb = list(raw, 'balanco');
  const badWb = wb.filter((m) => !WB_MODES.includes(m));
  if (badWb.length) throw new Error(`balanco: ${badWb.join(', ')} (use ${WB_MODES.join('|')})`);
  const fps = num(raw, 'fps_max', { min: 1, max: 1000 });
  const shutterMin = num(raw, 'obturador_min_s', { min: 1e-7, max: 10 }), shutterMax = num(raw, 'obturador_max_s', { min: 1e-7, max: 10 });
  if (shutterMin != null && shutterMax != null && shutterMin >= shutterMax) throw new Error('obturador_min_s precisa ser menor que obturador_max_s');

  const override = {};
  for (const [col, key] of [['sat_lux_s', 'satLuxS'], ['capacidade_e', 'fullWellE'], ['ruido_leitura_e', 'readNoiseE']]) {
    const v = num(raw, col, { min: 0 });
    if (v != null) override[key] = v;
  }

  return {
    id,
    brand: raw.marca,
    model: raw.modelo,
    name: raw.nome || `${raw.marca} ${raw.modelo}`,
    kind: oneOf(raw, 'tipo'),
    line: raw.linha || null,
    widthPx: num(raw, 'largura_px', { min: 16, max: 20000, int: true }),
    heightPx: num(raw, 'altura_px', { min: 16, max: 20000, int: true }),
    sensorType: sensorFormat(raw),
    pixelUm: num(raw, 'pixel_um', { min: 0.3, max: 30 }),
    sensorModel: raw.sensor_modelo || null,
    sensorOverride: override,
    shutterType: oneOf(raw, 'obturador') || 'rolling',
    readoutMs: num(raw, 'leitura_ms', { min: 0.01, max: 1000 }) ?? (fps ? 1000 / fps : DEFAULT_READOUT_MS),
    lens,
    focalMm: zoom ? [fW, fT] : [fW],
    hfov: zoom ? [hW, hT] : [hW],
    aperture: num(raw, 'abertura', { min: 0.5, max: 32 }),
    apertureTele: num(raw, 'abertura_tele', { min: 0.5, max: 32 }),
    distortionK: distortion ?? 0,
    focus: oneOf(raw, 'foco'),
    // o que a câmera deixa configurar; null = não informado (o simulador permite sem aviso)
    caps: {
      manualExposure: bool(raw, 'exposicao_manual'),
      shutterMin, shutterMax,
      gainMaxDb: num(raw, 'ganho_max_db', { min: 0, max: 100 }),
      wbModes: wb.length ? wb : null,
      antiFlicker: bool(raw, 'anti_cintilacao'),
      ldc: bool(raw, 'ldc'),
      trigger: bool(raw, 'gatilho_externo'),
      dayNight: oneOf(raw, 'dia_noite'),
      fpsMax: fps,
    },
    info: {
      wdrDb: num(raw, 'wdr_db', { min: 0, max: 200 }),
      interface: raw.interface || null,
      protection: raw.protecao || null,
      codec: list(raw, 'codec'),
    },
    sourceUrl: raw.fonte_url || null,
    checkedAt: raw.consultado_em || null,
    estimated,
    calibrationPath: raw.calibrada || null,
    notes: raw.observacoes || '',
  };
}

/**
 * Carrega o catálogo: texto do CSV (embutido no build de página única ou lido de data/cameras.csv) e as
 * calibrações citadas na coluna `calibrada`. loadText(caminho) devolve o texto de um arquivo do site.
 * Câmera com calibração usa a lente medida, mantendo id e nome do catálogo.
 */
export async function loadCameraCatalog(loadText) {
  const { cameras, errors } = parseCameraCatalog(await loadText('data/cameras.csv'));
  for (const [i, cam] of cameras.entries()) {
    if (!cam.calibrationPath) continue;
    try {
      const cal = calibratedCamera(cam, JSON.parse(await loadText(cam.calibrationPath)));
      cameras[i] = { ...cal, id: cam.id, name: cam.name, csvLine: cam.csvLine };
    } catch (e) {
      errors.push({ line: cam.csvLine, message: `calibrada: ${cam.calibrationPath}: ${e.message}` });
    }
  }
  setCameraCatalog(cameras);
  return errors;
}

/** Modelo editável para câmeras fora do catálogo. */
export function customCamera(base = {}) {
  return {
    id: 'custom',
    brand: '—',
    model: 'personalizada',
    name: 'Câmera personalizada',
    kind: 'ip',
    line: null,
    widthPx: 1920, heightPx: 1080,
    sensorType: 2.8, pixelUm: null, sensorModel: null, sensorOverride: {},
    shutterType: 'rolling', readoutMs: DEFAULT_READOUT_MS,
    lens: 'fixa',
    hfov: [80], focalMm: [4], aperture: 2.0, apertureTele: null,
    distortionK: -0.1,
    focus: null,
    caps: {},
    info: { codec: [] },
    sourceUrl: null, checkedAt: null,
    estimated: [],
    calibrationPath: null,
    notes: 'Preencha resolução, FOV, focal, abertura e formato do sensor com os dados do datasheet.',
    ...base,
  };
}

export function isZoom(cam) {
  return cam.hfov.length > 1;
}

/** Megapixels pela resolução (2 MP, 4 MP…), como se anuncia. */
export function megapixels(cam) {
  const mp = (cam.widthPx * cam.heightPx) / 1e6;
  return mp >= 10 ? Math.round(mp) : Math.round(mp * 10) / 10;
}

const MEASURED = ['largura_px', 'altura_px', 'hfov_graus', 'hfov_tele_graus', 'focal_mm', 'focal_tele_mm', 'distorcao'];

/**
 * Câmera personalizada a partir de uma calibração (calibracao/calibrar.py). Mantém do modelo de base o que
 * a calibração não mede (abertura, sensor, recursos) e troca resolução, FOV, focal e distorção pelos medidos.
 * A calibração vale para uma posição de zoom: a câmera resultante tem lente fixa.
 */
export function calibratedCamera(base, cal) {
  if (cal?.tipo !== 'calibracao-vision-sim' || !cal.simulador) {
    throw new Error('O arquivo não é uma calibração do simulador (gere com calibracao/calibrar.py).');
  }
  const s = cal.simulador;
  if (!(s.widthPx > 0 && s.heightPx > 0 && s.hfov?.[0] > 0 && Number.isFinite(s.distortionK))) {
    throw new Error('Calibração incompleta: faltam resolução, FOV ou distorção.');
  }
  return {
    ...base,
    id: 'custom',
    name: `${cal.camera || base.name} (calibrada)`,
    widthPx: s.widthPx, heightPx: s.heightPx,
    lens: 'fixa',
    hfov: [s.hfov[0]],
    focalMm: s.focalMm?.length ? [s.focalMm[0]] : [base.focalMm[0]],
    apertureTele: null,
    distortionK: s.distortionK,
    estimated: (base.estimated || []).filter((k) => !MEASURED.includes(k)),
    notes: `Lente medida com tabuleiro em ${cal.data} (${cal.fotos?.length ?? '?'} fotos, erro de reprojeção ${cal.erro_reprojecao_px} px).`,
    calibration: {
      date: cal.data, photos: cal.fotos?.length ?? null, rmsPx: cal.erro_reprojecao_px,
      modelErrorPx: s.erro_modelo_px, fovMeasured: cal.fov_medido_graus, centerOffsetPx: cal.centro_optico_desvio_px,
    },
  };
}
