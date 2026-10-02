// Texturas do topo dos objetos (procedurais ou imagem enviada), com ajuste RGB.
// Cada textura é um canvas em escala de PX_PER_MM, guardado em cache.

import { hexToRgb } from '../core/color.js';

const PX_PER_MM = 4;
const MAX_SIDE = 2048;
const cache = new Map();
const images = new Map(); // data URL / caminho → HTMLImageElement
let onAssetLoaded = () => {};

export const LOGO_URL = 'assets/logo-exemplo.png';

/** Chamado quando uma imagem termina de carregar (para redesenhar). */
export function setAssetListener(fn) {
  onAssetLoaded = fn;
}

function loadImage(src) {
  if (images.has(src)) return images.get(src);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    cache.clear();
    recolored.clear();
    onAssetLoaded();
  };
  img.src = src;
  images.set(src, img);
  return img;
}

function ready(img) {
  return img && img.complete && img.naturalWidth > 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

function canvasFor(wMm, dMm) {
  let s = PX_PER_MM;
  const big = Math.max(wMm, dMm) * s;
  if (big > MAX_SIDE) s = MAX_SIDE / Math.max(wMm, dMm);
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(wMm * s));
  c.height = Math.max(2, Math.round(dMm * s));
  return { c, ctx: c.getContext('2d'), s };
}

function paintKraft(ctx, c, s, color) {
  const rand = rng(7);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  // fibras
  for (let i = 0; i < (c.width * c.height) / 90; i++) {
    const x = rand() * c.width, y = rand() * c.height;
    ctx.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y, 1 + rand() * 6, 1);
  }
  // abas: emenda no meio, ao longo do comprimento
  const mid = c.height / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  ctx.fillRect(0, mid - 1.5 * s, c.width, 3 * s);
  ctx.fillStyle = 'rgba(40,20,0,0.45)';
  ctx.fillRect(0, mid - 0.6 * s, c.width, 1.2 * s);
  // vincos das abas laterais
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(0, 0, c.width, 2 * s);
  ctx.fillRect(0, c.height - 2 * s, c.width, 2 * s);
  ctx.fillRect(0, 0, 2 * s, c.height);
  ctx.fillRect(c.width - 2 * s, 0, 2 * s, c.height);
}

function paintTape(ctx, c, s, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, 0, c.width, Math.max(1, 0.4 * s));
  ctx.fillRect(0, c.height - Math.max(1, 0.4 * s), c.width, Math.max(1, 0.4 * s));
}

export const LOGO_ORIGINAL = '#d42027';
const recolored = new Map();

/** Logo na cor pedida (a silhueta inteira). Na cor original, devolve a imagem como está. */
function logoIn(color) {
  const logo = loadImage(LOGO_URL);
  if (!ready(logo) || !color || color.toLowerCase() === LOGO_ORIGINAL) return logo;
  if (recolored.has(color)) return recolored.get(color);
  const t = document.createElement('canvas');
  t.width = logo.naturalWidth;
  t.height = logo.naturalHeight;
  const tc = t.getContext('2d');
  tc.drawImage(logo, 0, 0);
  tc.globalCompositeOperation = 'source-in';
  tc.fillStyle = color;
  tc.fillRect(0, 0, t.width, t.height);
  recolored.set(color, t);
  return t;
}

/** Logos repetidos ao longo da fita (altura = 62% da largura da fita, espaço de meio logo). */
function drawLogos(ctx, c, color) {
  const logo = loadImage(LOGO_URL);
  const h = c.height * 0.62;
  if (ready(logo)) {
    const img = logoIn(color);
    const w = h * (logo.naturalWidth / logo.naturalHeight);
    const gap = w * 0.5;
    for (let x = gap / 2; x < c.width; x += w + gap) ctx.drawImage(img, x, (c.height - h) / 2, w, h);
  } else {
    ctx.fillStyle = color || LOGO_ORIGINAL;
    ctx.font = `700 ${h}px sans-serif`;
    ctx.textBaseline = 'middle';
    for (let x = 10; x < c.width; x += h * 5) ctx.fillText('LOGO', x, c.height / 2);
  }
}

function paintTapeLogo(ctx, c, s, color) {
  paintTape(ctx, c, s, color);
  drawLogos(ctx, c);
}

/** Fita transparente: filme quase invisível com leve brilho nas bordas, e os logos impressos (color = cor do logo). */
function paintTapeClearLogo(ctx, c, s, color) {
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, 0, c.width, c.height);
  const edge = Math.max(1, 0.6 * s);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, 0, c.width, edge);
  ctx.fillRect(0, c.height - edge, c.width, edge);
  drawLogos(ctx, c, color);
}

function paintPlate(ctx, c, s, color) {
  const rand = rng(3);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < c.height; y += 2) {
    ctx.fillStyle = `rgba(255,255,255,${0.03 + rand() * 0.05})`;
    ctx.fillRect(0, y, c.width, 1);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 3 * s;
  ctx.strokeRect(0, 0, c.width, c.height);
}

function paintFabric(ctx, c, s, color) {
  const rand = rng(11);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < (c.width * c.height) / 40; i++) {
    ctx.fillStyle = rand() > 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(rand() * c.width, rand() * c.height, 2, 2);
  }
  // dobras
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 5; i++) ctx.fillRect(rand() * c.width, 0, 6 * s, c.height);
}

function applyTint(c, ctx, tint) {
  if (tint[0] === 1 && tint[1] === 1 && tint[2] === 1) return;
  const id = ctx.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] * tint[0];
    d[i + 1] = d[i + 1] * tint[1];
    d[i + 2] = d[i + 2] * tint[2];
  }
  ctx.putImageData(id, 0, 0);
}

/** Canvas com o topo do objeto em escala real (px/mm variável). */
export function topTexture(o) {
  const key = [o.id, o.texture, o.color, o.w, o.d, o.tint.join(','), o.image ? o.image.length : 0, o.image?.slice(-32)].join('|');
  if (cache.has(key)) return cache.get(key);
  const { c, ctx, s } = canvasFor(o.w, o.d);
  if (o.image) {
    const img = loadImage(o.image);
    if (ready(img)) ctx.drawImage(img, 0, 0, c.width, c.height);
    else {
      ctx.fillStyle = o.color;
      ctx.fillRect(0, 0, c.width, c.height);
    }
  } else {
    switch (o.texture) {
      case 'kraft': paintKraft(ctx, c, s, o.color); break;
      case 'tape': paintTape(ctx, c, s, o.color); break;
      case 'tape-logo': paintTapeLogo(ctx, c, s, o.color); break;
      case 'tape-clear-logo': paintTapeClearLogo(ctx, c, s, o.color); break;
      case 'plate': paintPlate(ctx, c, s, o.color); break;
      case 'fabric': paintFabric(ctx, c, s, o.color); break;
      default:
        ctx.fillStyle = o.color;
        ctx.fillRect(0, 0, c.width, c.height);
    }
  }
  applyTint(c, ctx, o.tint);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  cache.set(key, c);
  return c;
}

const inkCache = new Map();

/**
 * "Tinta" do alvo: pixels da textura que já têm a cor procurada (referência ideal, como uma foto de
 * uma caixa boa). Azul onde há tinta, transparente no resto. Fita vermelha: a fita inteira.
 * Fita com logo: só as letras.
 */
export function inkTexture(o, lut, lutKey) {
  const tex = topTexture(o);
  const key = `${o.id}|${tex.width}x${tex.height}|${o.color}|${o.tint.join(',')}|${o.image ? o.image.length : 0}|${lutKey}`;
  if (inkCache.has(key)) return inkCache.get(key);
  const c = document.createElement('canvas');
  c.width = tex.width;
  c.height = tex.height;
  const src = tex.getContext('2d').getImageData(0, 0, tex.width, tex.height).data;
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(tex.width, tex.height);
  const d = out.data;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] < 128) continue;
    if (lut[((src[i] >> 3) << 10) | ((src[i + 1] >> 3) << 5) | (src[i + 2] >> 3)]) {
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  if (inkCache.size > 20) inkCache.delete(inkCache.keys().next().value);
  inkCache.set(key, c);
  return c;
}

/** Cor das laterais (vista de frente e paredes da caixa na câmera). */
export function sideColor(o) {
  if (o.sideColor) return o.sideColor;
  if (o.image) {
    const tex = topTexture(o);
    const t = document.createElement('canvas');
    t.width = t.height = 1;
    const tc = t.getContext('2d');
    tc.drawImage(tex, 0, 0, 1, 1);
    const [r, g, b] = tc.getImageData(0, 0, 1, 1).data;
    return `rgb(${Math.round(r * 0.8)},${Math.round(g * 0.8)},${Math.round(b * 0.8)})`;
  }
  const [r, g, b] = hexToRgb(o.color);
  const t = o.tint;
  return `rgb(${Math.round(r * t[0] * 0.78)},${Math.round(g * t[1] * 0.78)},${Math.round(b * t[2] * 0.78)})`;
}

export { shade };
