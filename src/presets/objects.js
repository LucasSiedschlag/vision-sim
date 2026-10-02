import { DEFAULT_BOX_VARIANTS } from '../core/scene.js';
import { defaultLight } from '../core/lighting.js';

// Objetos da cena. Medidas em milímetros; x, y = centro; rot em graus; h = altura/espessura.
// `texture` gera a imagem do topo; `image` (data URL) substitui a textura quando o usuário envia uma foto.

let counter = 0;
export function newId(prefix = 'obj') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

const BASE = {
  rot: 0, sitOn: null, baseZ: 0,
  color: '#888888', sideColor: null,
  texture: null, image: null, imageName: null,
  tint: [1, 1, 1], opacity: 1, surface: 'matte', roughness: 1,
  isTarget: false, visible: true, keepAspect: true,
};

export const OBJECT_PRESETS = [
  {
    key: 'plate',
    label: 'Prato da balança',
    make: () => ({ ...BASE, name: 'Prato da balança', kind: 'box', w: 600, d: 450, h: 60, color: '#a7adb2', texture: 'plate', surface: 'metal', roughness: 0.2 }),
  },
  {
    key: 'box',
    label: 'Caixa de papelão (pardo)',
    make: () => ({ ...BASE, name: 'Caixa de papelão', kind: 'box', w: 500, d: 350, h: 300, color: '#b8875a', texture: 'kraft', surface: 'paper', roughness: 0.45 }),
  },
  {
    key: 'tape-red',
    label: 'Fita vermelha 48 mm',
    make: () => ({ ...BASE, name: 'Fita vermelha', kind: 'flat', w: 500, d: 48, h: 0.2, color: '#d0202a', texture: 'tape', surface: 'film', roughness: 0.05, isTarget: true }),
  },
  {
    key: 'tape-logo',
    label: 'Fita branca com logo',
    make: () => ({ ...BASE, name: 'Fita branca com logo', kind: 'flat', w: 500, d: 48, h: 0.2, color: '#f2f2ef', texture: 'tape-logo', surface: 'film', roughness: 0.06, isTarget: true }),
  },
  {
    key: 'tape-clear-logo',
    label: 'Fita transparente com logo',
    make: () => ({ ...BASE, name: 'Fita transparente com logo', kind: 'flat', w: 500, d: 48, h: 0.2, color: '#d42027', texture: 'tape-clear-logo', surface: 'film', roughness: 0.04, isTarget: true }),
  },
  {
    key: 'shirt',
    label: 'Operador (camiseta vermelha)',
    make: () => ({ ...BASE, name: 'Operador (camiseta vermelha)', kind: 'box', w: 460, d: 240, h: 520, color: '#c3242c', texture: 'fabric', surface: 'fabric', roughness: 1 }),
  },
  {
    key: 'block',
    label: 'Bloco simples',
    make: () => ({ ...BASE, name: 'Bloco', kind: 'box', w: 200, d: 150, h: 100, color: '#5b7c99' }),
  },
];

export function makeObject(key, overrides = {}) {
  const p = OBJECT_PRESETS.find((o) => o.key === key);
  if (!p) throw new Error(`Objeto desconhecido: ${key}`);
  return { ...p.make(), id: newId(key), ...overrides };
}

/** Objeto a partir de uma imagem enviada. Largura real informada; profundidade sai da proporção. */
export function makeImageObject(dataUrl, name, pxW, pxH, widthMm = 300) {
  return {
    ...BASE,
    id: newId('img'),
    name: name || 'Imagem',
    kind: 'flat',
    x: 0,
    y: 0,
    w: widthMm,
    d: Math.round((widthMm * pxH) / pxW),
    h: 1,
    color: '#cccccc',
    image: dataUrl,
    imageName: name,
    imageAspect: pxW / pxH,
  };
}

/** Cena de exemplo: caixa fechada com fita vermelha na balança, operador ao lado. */
export function exampleScene() {
  const plate = makeObject('plate', { x: 0, y: 0 });
  const box = makeObject('box', { x: 0, y: 0, sitOn: plate.id, role: 'box' });
  const tape = makeObject('tape-red', { x: 0, y: 0, sitOn: box.id, role: 'tape' });
  const tapeWhite = makeObject('tape-logo', { x: 0, y: 0, sitOn: box.id, visible: false, role: 'tape' });
  const tapeLogo = makeObject('tape-clear-logo', { x: 0, y: 0, sitOn: box.id, visible: false, role: 'tape' });
  const shirt = makeObject('shirt', { x: 120, y: 470, visible: false });
  return {
    version: 1,
    name: 'Caixa na balança',
    objects: [plate, box, tape, tapeWhite, tapeLogo, shirt],
    boxes: {
      variants: DEFAULT_BOX_VARIANTS.map((v) => ({ ...v })),
      active: 'm',
      align: 'centro',
    },
    camera: {
      modelId: 'ds2cd1027g2h-liu-4',
      custom: null,
      zoom: 0.35,
      x: 0, y: 0, z: 1300,
      // F1.0 sob ~600 lux satura em 1/120 s (sensor real): a exposição automática encurta o obturador
      exposureMode: 'auto',
      shutter: 1 / 120,
      gainDb: 0,
      wbMode: 'manual-k',
      wbKelvin: 6500, // luminárias de 6500 K ("luz fria", o padrão do varejo)
      wbGains: [1, 1, 1],
      colorMode: 'color',
      jpegQuality: 85,
      distortion: true,
      noise: true,
      focusMode: 'auto',
    },
    light: defaultLight(),
    detection: {
      mode: 'auto',
      minLogos: 2,
      maxGapMm: 100,
      color: '#d0202a',
      hueTol: 18,
      sMin: 0.45,
      vMin: 0.25,
      minCoverage: 0.7,
      maxFalsePositive: 0.1,
      showMask: true,
    },
  };
}
