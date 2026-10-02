import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fieldWidth, mmPerPixel, pixelsAcross, focalPx, lensState, depthOfField, project, distortionMap } from '../src/core/optics.js';
import { illuminantRgb, wbGainsForKelvin, rgbToHsv, hueDistance, linearToSrgb, srgbToLinear } from '../src/core/color.js';
import { flickerAverage, flickerRange, isFlickerSafe, ambientAt } from '../src/core/lighting.js';
import { colorMask, evaluate, verdict } from '../src/core/detection.js';
import { resolveHeights, opticsMetrics } from '../src/core/scene.js';
import { exampleScene } from '../src/presets/objects.js';
import { CAMERAS } from '../src/presets/cameras.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

test('campo de visão da lente 2,8 mm (94°) a 1 m ≈ 2,14 m', () => {
  near(fieldWidth(1000, 94), 2144.7, 0.5);
});

test('fita de 48 mm ocupa ~43 px numa câmera 1080p de 94° a 1 m (bate com a planilha)', () => {
  near(pixelsAcross(48, 1000, 94, 1920), 42.97, 0.05);
  near(mmPerPixel(1000, 94, 1920), 1.117, 0.001);
});

test('focal em pixels é consistente com o FOV', () => {
  const f = focalPx(1920, 90);
  near(f, 960, 1e-9);
});

test('zoom motorizado: FOV vai do grande angular ao tele', () => {
  const cam = CAMERAS.find((c) => c.id === 'ds2cd2643g2-izs');
  near(lensState(cam, 0).hfov, 105.4, 0.01);
  const tele = lensState(cam, 1).hfov;
  assert.ok(tele < 40 && tele > 25, `tele = ${tele}`);
});

test('profundidade de campo: lente curta a 1 m cobre ±20 cm', () => {
  const dof = depthOfField(4, 1.0, 0.006, 1000);
  assert.ok(dof.near < 800 && dof.far > 1200, JSON.stringify(dof));
});

test('projeção: ponto sob a câmera cai no centro da imagem', () => {
  const p = project({ x: 0, y: 0, z: 300 }, { x: 0, y: 0, z: 1300, fpx: 1000, w: 1920, h: 1080 });
  assert.equal(p.u, 960);
  assert.equal(p.v, 540);
});

test('distorção: centro fica no lugar e o mapa tem o tamanho da imagem', () => {
  const m = distortionMap(41, 21, -0.2);
  assert.equal(m.length, 41 * 21);
  assert.equal(m[10 * 41 + 20], 10 * 41 + 20);
});

test('cor: ida e volta sRGB ↔ linear', () => {
  for (const v of [0, 0.02, 0.5, 0.9, 1]) near(linearToSrgb(srgbToLinear(v)), v, 1e-6);
});

test('luz quente (3000 K) é mais vermelha que azul; ganho de BB compensa', () => {
  const [r, , b] = illuminantRgb(3000);
  assert.ok(r > b);
  const [gr, , gb] = wbGainsForKelvin(3000);
  near(r * gr, illuminantRgb(3000)[1], 1e-9);
  assert.ok(gb > 1);
});

test('HSV: vermelho puro tem matiz 0; distância de matiz dá a volta em 360', () => {
  assert.equal(rgbToHsv(255, 0, 0)[0], 0);
  assert.equal(hueDistance(350, 10), 20);
});

test('flicker: 1/120 s não varia; 1/500 s varia', () => {
  near(flickerRange(1 / 120, 0.3).spread, 0, 1e-9);
  assert.ok(flickerRange(1 / 500, 0.3).spread > 0.3);
  assert.ok(isFlickerSafe(1 / 60));
  assert.ok(!isFlickerSafe(1 / 500));
  near(flickerAverage(1 / 120, 1.3, 0.5), 1, 1e-9);
});

test('luz ambiente: meio-dia mais claro e mais frio que 7h', () => {
  const a7 = ambientAt(7, 300), a12 = ambientAt(12.5, 300);
  assert.ok(a12.lux > a7.lux);
  assert.ok(a12.kelvin > a7.kelvin);
});

test('detecção: pixels vermelhos viram máscara; avaliação conta acertos e falsos positivos', () => {
  const rgba = new Uint8ClampedArray([200, 20, 30, 255, 180, 130, 90, 255, 210, 30, 25, 255, 30, 30, 30, 255]);
  const mask = colorMask(rgba, 4, 1, { hue: 0, hueTol: 15, sMin: 0.4, vMin: 0.2 });
  assert.deepEqual([...mask], [1, 0, 1, 0]);
  const res = evaluate(mask, new Uint8Array([1, 1, 0, 0]));
  assert.equal(res.detectedPx, 1);
  assert.equal(res.falsePositivePx, 1);
  assert.equal(verdict(res, { minCoverage: 0.7, maxFalsePositive: 0.1 }).ok, false);
});

test('cena de exemplo: fita apoiada na caixa, que está apoiada no prato', () => {
  const scene = exampleScene();
  const r = resolveHeights(scene.objects);
  const tape = r.find((o) => o.name === 'Fita vermelha');
  assert.equal(tape.z0, 60 + 300);
  const m = opticsMetrics(scene);
  near(m.distanceMm, 1300 - 360.2, 0.01);
  assert.ok(m.targetPx > 40, `targetPx = ${m.targetPx}`);
});

import { profileAlong, analyzeProfile, verdictLogo } from '../src/core/detection.js';

test('logo repetido: conta logos ao longo da fita e mede o maior intervalo', () => {
  // fita horizontal de 100 px = 500 mm; logos em 3 trechos de 10 px
  const w = 100, h = 4;
  const expected = new Uint8Array(w * h).fill(1);
  const mask = new Uint8Array(w * h);
  for (const x0 of [10, 45, 80]) for (let x = x0; x < x0 + 10; x++) for (let y = 0; y < h; y++) mask[y * w + x] = 1;
  const prof = analyzeProfile(profileAlong(mask, expected, w, { u: 0, v: 2 }, { u: 100, v: 2 }, 500, 100));
  assert.equal(prof.logos, 3);
  near(prof.maxGapMm, 125, 1); // 55→80 px = 25 px = 125 mm
  const res = { expectedPx: 400, falsePositiveRatio: 0 };
  assert.equal(verdictLogo(res, prof, { minLogos: 2, maxGapMm: 150, maxFalsePositive: 0.1 }).ok, true);
  assert.equal(verdictLogo(res, prof, { minLogos: 2, maxGapMm: 100, maxFalsePositive: 0.1 }).ok, false);
});

import { profileBand } from '../src/core/detection.js';

test('emenda: fita cobrindo só metade aparece como trecho grande sem logo', () => {
  const w = 100, h = 10;
  const mask = new Uint8Array(w * h);
  for (const x0 of [5, 25, 45]) for (let x = x0; x < x0 + 8; x++) for (let y = 3; y < 7; y++) mask[y * w + x] = 1;
  const prof = analyzeProfile(profileBand(mask, w, h, { u: 0, v: 5 }, { u: 100, v: 5 }, 3, 500, 100));
  assert.equal(prof.logos, 3);
  assert.ok(prof.maxGapMm > 200, `maxGap = ${prof.maxGapMm}`);
});

import { lightSources, timeFactor, lightMix, dayVariation, normalizeLight, combinedFlicker, fixtureLook, makeFixture } from '../src/core/lighting.js';

test('luz: formato antigo vira luminária; luz contínua não muda de proporção com o obturador', () => {
  const L = normalizeLight({ type: 'difuso', lux: 600, kelvin: 5000, flicker: 0.02 });
  assert.equal(L.fixtures.length, 1);
  assert.equal(L.fixtures[0].model, 'panel');
  assert.equal(L.ambient.on, false);
  near(lightSources(L)[0].lux, 600, 1e-6); // já descontado o difusor
  const both = { ...L, ambient: { ...L.ambient, on: true } };
  near(lightMix(both, 1 / 120).shares.bench, lightMix(both, 1 / 1000).shares.bench, 1e-9);
});

test('luz: LED pulsado + obturador curto corta o ambiente', () => {
  const L = normalizeLight(null);
  L.ambient.on = true;
  L.fixtures[0] = { ...L.fixtures[0], strobe: true, pulse: 1 / 1000, overdrive: 4 };
  const slow = lightMix(L, 1 / 120).shares.bench, fast = lightMix(L, 1 / 1000).shares.bench;
  assert.ok(fast > slow + 0.3, `${slow} → ${fast}`);
  near(timeFactor({ strobe: true, overdrive: 4, pulse: 1 / 1000 }, 1 / 120), 0.48, 1e-9);
});

test('luz: difusor troca reflexo forte por macio e perde luz; cobertura reduz a variação do dia', () => {
  const bare = fixtureLook(makeFixture('bulb', { diffuser: false }));
  const soft = fixtureLook(makeFixture('bulb', { diffuser: true }));
  assert.ok(soft.specular < bare.specular && soft.lux < bare.lux);
  const L = normalizeLight(null);
  L.ambient.on = true;
  const open = dayVariation(L, 1 / 120).spread, covered = dayVariation({ ...L, cover: 0.8 }, 1 / 120).spread;
  assert.ok(covered < open, `${open} → ${covered}`);
  assert.ok(combinedFlicker(L, 1 / 120) < 1e-6);
  assert.ok(combinedFlicker(L, 1 / 500) > 0.01);
});
