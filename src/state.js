// Estado da aplicação: a cena (salva/aberta como JSON) e o estado da interface.

import { exampleScene } from './presets/objects.js';
import { normalizeLight } from './core/lighting.js';

const STORAGE_KEY = 'vision-sim:scene:v1';

export function createStore(initialScene) {
  const state = {
    scene: initialScene,
    ui: { tab: 'cena', selectedId: initialScene.objects[1]?.id ?? null, captureSeed: 1 },
  };
  const subs = new Set();
  return {
    get: () => state,
    /** fn muda o estado no lugar. structural = painéis precisam ser reconstruídos. */
    update(fn, { structural = false, camera = true } = {}) {
      fn(state);
      for (const s of subs) s({ structural, camera });
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Completa uma cena carregada com os campos que faltarem. */
export function normalizeScene(raw) {
  const base = exampleScene();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.objects)) {
    throw new Error('O arquivo não parece ser uma cena do simulador (faltam os objetos).');
  }
  return {
    ...base,
    ...raw,
    camera: { ...base.camera, ...(raw.camera || {}) },
    light: normalizeLight(raw.light),
    detection: { ...base.detection, ...(raw.detection || {}) },
    boxes: raw.boxes ? { ...base.boxes, ...raw.boxes } : base.boxes,
    objects: raw.objects.map((o) => ({
      x: 0, y: 0, w: 100, d: 100, h: 10, kind: 'box', rot: 0, sitOn: null, baseZ: 0, tint: [1, 1, 1], opacity: 1,
      isTarget: false, visible: true, keepAspect: true, color: '#888888', ...o,
    })),
  };
}

export function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeScene(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

let saveTimer = 0;
export function autosave(scene) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scene));
    } catch {
      // Sem armazenamento (janela privada, cota cheia com imagens grandes): segue sem salvar.
    }
  }, 800);
}
