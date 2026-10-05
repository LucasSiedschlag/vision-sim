import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fieldWidth, mmPerPixel, pixelsAcross, focalPx, lensState, depthOfField, project, lensProjection, lensMap, projectImage } from '../src/core/optics.js';
import { illuminantRgb, wbGainsForKelvin, rgbToHsv, hueDistance, linearToSrgb, srgbToLinear } from '../src/core/color.js';
import { flickerAverage, flickerRange, isFlickerSafe, ambientAt } from '../src/core/lighting.js';
import { colorMask, evaluate, verdict } from '../src/core/detection.js';
import { resolveHeights, opticsMetrics, resolveCamera } from '../src/core/scene.js';
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

test('lente: sem distorção o mapa é a identidade; com barril o centro fica no lugar', () => {
  const id = lensMap(41, 21, 41, 21, 0, 1);
  for (let j = 0; j < id.length; j++) assert.equal(id[j], j);
  const m = lensMap(41, 21, 61, 31, -0.2, 1);
  assert.equal(m.length, 41 * 21);
  assert.equal(m[10 * 41 + 20], 15 * 61 + 30);
});

test('lente: a borda da imagem distorcida cai no FOV do datasheet', () => {
  for (const k1 of [0, -0.05, -0.14, -0.22]) {
    const pr = lensProjection(1920, 1080, 85, k1, true);
    near(pr.hfov, 85, 1e-9);
    // o ponto do mundo no limite do FOV aparece na borda da imagem
    const cam = { x: 0, y: 0, z: 1000, w: 1920, h: 1080, fpx: pr.fpx, lambda: pr.lambda };
    const q = projectImage({ x: 1000 * Math.tan((42.5 * Math.PI) / 180), y: 0, z: 0 }, cam);
    near(q.u, 1920, 1e-6);
  }
  // corrigida pela câmera (LDC): mesma escala no centro, campo menor
  const on = lensProjection(1920, 1080, 85, -0.14, true), off = lensProjection(1920, 1080, 85, -0.14, false);
  near(off.fpx, on.fpx, 1e-9);
  assert.ok(off.hfov < 80, `${off.hfov}`);
});

test('lente: projeção direta e mapa inverso concordam', () => {
  const pr = lensProjection(1920, 1080, 94, -0.22, true);
  const W = 1920, H = 1080, Wi = 2 * Math.ceil((W / 2) * pr.cornerScale) + 2, Hi = 2 * Math.ceil((H / 2) * pr.cornerScale) + 2;
  const cam = { x: 0, y: 0, z: 1000, w: W, h: H, fpx: pr.fpx, lambda: pr.lambda };
  const icam = { ...cam, w: Wi, h: Hi };
  const map = lensMap(W, H, Wi, Hi, pr.lambda, 1);
  for (const pt of [{ x: 300, y: 200, z: 0 }, { x: -800, y: 400, z: 100 }, { x: 50, y: -30, z: 360 }]) {
    const out = projectImage(pt, cam), ideal = project(pt, icam);
    const m = map[Math.floor(out.v) * W + Math.floor(out.u)];
    near(m % Wi, ideal.u, 1.5);
    near(Math.floor(m / Wi), ideal.v, 1.5);
  }
});

test('lente: largura da fita no indicador = largura na imagem distorcida (centro)', () => {
  const scene = exampleScene();
  for (const id of ['ds2cd1027g2h-liu-4', 'ds2cd1021g0i', 'c920']) {
    scene.camera.modelId = id;
    const cam = resolveCamera(scene.camera), m = opticsMetrics(scene);
    const W = cam.w, H = cam.h;
    const Wi = 2 * Math.ceil((W / 2) * cam.cornerScale) + 2, Hi = 2 * Math.ceil((H / 2) * cam.cornerScale) + 2;
    const icam = { ...cam, w: Wi, h: Hi };
    const map = lensMap(W, H, Wi, Hi, cam.lambda, 1);
    const a = project({ x: 0, y: -24, z: 360.2 }, icam), b = project({ x: 0, y: 24, z: 360.2 }, icam);
    let rows = 0;
    for (let v = 0; v < H; v++) { const sv = Math.floor(map[v * W + W / 2] / Wi); if (sv >= a.v && sv < b.v) rows++; }
    near(rows, m.targetPx, 1.5);
  }
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

import { lightSources, timeFactor, lightMix, dayVariation, normalizeLight, combinedFlicker, makeFixture, resolveLuminaire, glarePoint } from '../src/core/lighting.js';

test('luz: formato antigo vira luminária; luz contínua não muda de proporção com o obturador', () => {
  const L = normalizeLight({ type: 'difuso', lux: 600, kelvin: 5000, flicker: 0.02 });
  assert.equal(L.fixtures.length, 1);
  assert.equal(L.fixtures[0].model, 'panel');
  assert.equal(L.ambient.on, false);
  assert.ok(L.fixtures[0].diffuser && lightSources(L)[0].lux > 100); // iluminância calculada pela posição
  const both = { ...L, ambient: { ...L.ambient, on: true } };
  near(lightMix(both, 1 / 120).shares.bench, lightMix(both, 1 / 1000).shares.bench, 1e-9);
});

test('luz: LED pulsado + obturador curto corta o ambiente', () => {
  const L = normalizeLight(null);
  L.ambient.on = true;
  L.fixtures[0] = { ...L.fixtures[0], strobe: true, pulse: 1 / 1000, overdrive: 4 };
  const slow = lightMix(L, 1 / 120).shares.bench, fast = lightMix(L, 1 / 1000).shares.bench;
  assert.ok(fast > slow + 0.3, `${slow} → ${fast}`);
  near(timeFactor({ strobe: true, overdrive: 4, pulse: 1 / 1000 }, 1 / 120), 0.004, 1e-12); // 4 × 1 ms
});

test('luz: difusor troca reflexo forte por macio e perde luz; cobertura reduz a variação do dia', () => {
  const bare = resolveLuminaire(makeFixture('bulb', { diffuser: false }));
  const soft = resolveLuminaire(makeFixture('bulb', { diffuser: true }));
  assert.ok(soft.lumens < bare.lumens && soft.w > 2 * bare.r && soft.m === 1);
  const L = normalizeLight(null);
  L.ambient.on = true;
  const open = dayVariation(L, 1 / 120).spread, covered = dayVariation({ ...L, cover: 0.8 }, 1 / 120).spread;
  assert.ok(covered < open, `${open} → ${covered}`);
  assert.ok(combinedFlicker(L, 1 / 120) < 1e-6);
  assert.ok(combinedFlicker(L, 1 / 500) > 0.01);
});

import { IMX327, SONY_REF_LUX_S, satFromSony, sensorFromFormat, sensorFor, signalFraction, noiseSigma, snrDb } from '../src/core/sensor.js';

test('sensor: referência da Sony (706 cd/m², F5.6, 1/30 s) dá ~0,59 lux·s no sensor', () => {
  near(SONY_REF_LUX_S, 0.5893, 0.0005);
  // IMX327: sensibilidade 10741 dígitos, saturação 3855 → satura com ~0,21 lux·s
  near(IMX327.satLuxS, satFromSony(10741, 3855), 1e-12);
  near(IMX327.satLuxS, 0.2115, 0.0005);
});

test('sensor: a referência da Sony reproduz a sensibilidade do datasheet', () => {
  // branco de 706 cd/m² = 706·π lux na cena; F5.6; 1/30 s; sem perda na lente
  const lux = 706 * Math.PI;
  const frac = signalFraction({ ...IMX327 }, 5.6, lux, 1 / 30) / 0.9; // descontar a transmissão de 0,9
  near(frac * 3855, 10741, 1);
});

test('sensor: F1.0 recebe 4× a luz de F2.0', () => {
  near(signalFraction(IMX327, 1.0, 500, 1 / 120) / signalFraction(IMX327, 2.0, 500, 1 / 120), 4, 1e-9);
});

test('sensor: formato 1/2.8" em 1920×1080 dá pixel de ~2,9 µm (como o IMX327)', () => {
  near(sensorFromFormat(2.8, 1920, 1080).pixelUm, 2.92, 0.03);
  const small = sensorFromFormat(3, 2688, 1520);
  assert.ok(small.pixelUm < 2.3 && small.fullWellE < IMX327.fullWellE, JSON.stringify(small));
  near(small.satLuxS, IMX327.satLuxS, 1e-12); // mesmo brilho, menos elétrons
});

test('sensor: ruído de disparo — SNR cresce com o sinal e cai com o ganho', () => {
  // saturação sem ganho: SNR ≈ √14500 ≈ 41,6 dB
  near(snrDb(IMX327, 1, 1), 20 * Math.log10(14500 / Math.sqrt(14500 + 9)), 1e-6);
  assert.ok(snrDb(IMX327, 0.18, 1) < snrDb(IMX327, 1, 1));
  // mesmo brilho de saída com 24 dB de ganho = 1/16 dos elétrons → ~12 dB pior
  const g = Math.pow(10, 24 / 20);
  near(snrDb(IMX327, 0.18, 1) - snrDb(IMX327, 0.18, g), 12, 0.5);
  // escuro total: só o ruído de leitura
  near(noiseSigma(IMX327, 0, 1), 3 / 14500, 1e-12);
});

test('sensor: toda câmera da lista resolve um sensor com valores plausíveis', () => {
  for (const cam of CAMERAS) {
    const r = resolveCamera({ modelId: cam.id, zoom: 0, x: 0, y: 0, z: 1000 });
    assert.ok(r.sensor.pixelUm > 1.5 && r.sensor.pixelUm < 4, `${cam.id}: ${r.sensor.pixelUm}`);
    assert.ok(r.sensor.fullWellE > 3000, `${cam.id}: ${r.sensor.fullWellE}`);
  }
  assert.ok(sensorFor({ sensorType: null, widthPx: 1920 }, 5.184).pixelUm > 2.6);
});

import { peakIntensity, exponentFromAxial, fresnelF0, schlick, erf, emitters, illuminance, mirrorLuminance, domeLuminance } from '../src/core/photometry.js';
import { surfaceOf } from '../src/core/materials.js';
import { lightContext } from '../src/core/scene.js';

test('fotometria: fonte Lambertiana pontual segue o inverso do quadrado e o cosseno', () => {
  const lum = { shape: 'sphere', x: 0, y: 0, z: 1000, r: 1, lumens: 1000, m: 1 };
  const ems = emitters(lum);
  const I0 = peakIntensity(1000, 1); // Φ/π
  near(I0, 1000 / Math.PI, 1e-9);
  near(illuminance(ems, 0, 0, 0), I0, 1e-6); // 1 m no eixo
  near(illuminance(ems, 0, 0, 500), I0 * 4, 1e-6); // metade da distância: 4×
  // 45° fora do eixo: cos(θ) emissão × cos(θ) chegada / d²
  const d2 = 2; // (1 m)² + (1 m)²
  near(illuminance(ems, 1000, 0, 0), (I0 * Math.SQRT1_2 * Math.SQRT1_2) / d2, 1e-6);
});

test('fotometria: painel quadrado bate com a fórmula fechada da fonte de área', () => {
  // painel Lambertiano 280 × 280 mm, 1680 lm, a 500 mm: E = 2L[a/√(a²+h²)·atan(b/√(a²+h²)) + …]
  const lum = { shape: 'rect', x: 0, y: 0, z: 500, rot: 0, w: 280, d: 280, lumens: 1680, m: 1 };
  const L = 1680 / (Math.PI * 0.28 * 0.28);
  const a = 0.14, b = 0.14, h = 0.5;
  const exact = 2 * L * ((a / Math.hypot(a, h)) * Math.atan(b / Math.hypot(a, h)) + (b / Math.hypot(b, h)) * Math.atan(a / Math.hypot(b, h)));
  near(illuminance(emitters(lum), 0, 0, 0), exact, exact * 0.01);
});

test('fotometria: ring light Streamplify (1000 lm, 480 lux a 1 m) reproduz os 480 lux', () => {
  near(exponentFromAxial(1000, 480, 1), 2.02, 0.01); // como fonte pontual
  // com o anel de 26 cm, o expoente do catálogo reproduz os 480 lux a 1 m
  const lum = resolveLuminaire(makeFixture('ring'), { x: 0, y: 0, z: 1020 });
  near(illuminance(emitters(lum), 0, 0, 0), 480, 480 * 0.01);
});

test('fita BOPP: índice 1,50 reflete 4% na normal, mais em ângulo rasante', () => {
  near(fresnelF0(1.5), 0.04, 1e-12);
  near(schlick(0.04, 1), 0.04, 1e-12);
  assert.ok(schlick(0.04, Math.cos((80 * Math.PI) / 180)) > 0.3);
  assert.equal(surfaceOf({ surface: 'film' }).f0, fresnelF0(1.5));
  // cena antiga: brilho 150% (fita transparente) vira filme quase espelho
  const old = surfaceOf({ gloss: 1.5 });
  assert.equal(old.key, 'film');
  assert.ok(old.roughness < 0.05);
  near(erf(1), 0.8427007929, 2e-7);
});

test('reflexo: espelho vê a luminância do painel; fora da imagem dele, nada', () => {
  const lum = { shape: 'rect', x: 0, y: 0, z: 1000, rot: 0, w: 280, d: 280, lumens: 1680, m: 1 };
  const L = 1680 / (Math.PI * 0.28 * 0.28);
  // raio refletido para cima, direto no centro do painel, superfície lisa
  near(mirrorLuminance(lum, 0, 0, 0, 0, 0, 1, 0.001), L, L * 1e-3);
  // raio que sai 300 mm para o lado no plano do painel: fora
  const r = Math.hypot(300, 1000);
  near(mirrorLuminance(lum, 0, 0, 0, 300 / r, 0, 1000 / r, 0.001), 0, 1e-9);
  // aspereza espalha: no centro cai, perto da borda (fora) aparece
  const rough = mirrorLuminance(lum, 0, 0, 0, 0, 0, 1, 0.2);
  assert.ok(rough < L && rough > 0.2 * L, `${rough}`);
  const rb = Math.hypot(160, 1000);
  assert.ok(mirrorLuminance(lum, 0, 0, 0, 160 / rb, 0, 1000 / rb, 0.2) > 0);
});

test('reflexo: o ponto de reflexo fica entre a câmera e a luminária, na proporção das alturas', () => {
  const g = glarePoint({ x: 0, y: 300, z: 1100 }, { x: 0, y: 0, z: 1300 }, 360);
  near(g.y, (300 * 940) / (940 + 740), 1e-9);
  assert.equal(glarePoint({ x: 0, y: 0, z: 300 }, { x: 0, y: 0, z: 1300 }, 360), null);
});

test('domo: luminância uniforme dá E = π·L no centro, menos o furo da câmera', () => {
  const lum = { shape: 'dome', x: 0, y: 0, z: 0, R: 450, hole: 40, lumens: 1500, m: 1 };
  const L = domeLuminance(lum);
  const E = illuminance(emitters(lum), 0, 0, 1);
  near(E, Math.PI * L, Math.PI * L * 0.03);
  // reflexo para cima no centro: cai no furo (escuro); inclinado: vê a cúpula
  assert.ok(mirrorLuminance(lum, 0, 0, 1, 0, 0, 1, 0.01) < 0.05 * L);
  const r = Math.hypot(0.3, 1);
  near(mirrorLuminance(lum, 0, 0, 1, 0.3 / r, 0, 1 / r, 0.01), L, L * 0.01);
});

test('cena de exemplo: painel ao lado da câmera dá ~700 lux na fita e o reflexo fora dela', () => {
  const scene = exampleScene();
  const src = lightSources(scene.light, lightContext(scene));
  assert.equal(src.length, 1);
  assert.ok(src[0].lux > 500 && src[0].lux < 900, `${src[0].lux}`);
  const g = glarePoint(src[0].lum, scene.camera, 360.2);
  assert.ok(Math.abs(g.y) > 24 + 50, `reflexo em y = ${g.y}`); // fita de 48 mm em y = 0
});

test('luminária antiga (lux + offset) vira produto com fluxo e posição', () => {
  const L = normalizeLight({ fixtures: [{ id: 'a', model: 'bar', lux: 900, offset: 0.2, on: true }] });
  const f = L.fixtures[0];
  assert.equal(f.lumens, 1460);
  assert.equal(f.lux, undefined);
  near(f.y, 500, 1e-9);
});

import { autoWhiteBalance } from '../src/core/color.js';

// sinal bruto de várias superfícies (hex sRGB, quantidade, brilho) sob uma luz de K kelvin
function rawScene(K, parts) {
  const ill = illuminantRgb(K);
  const out = [];
  for (const [hex, n, E] of parts) {
    const c = [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
    for (let i = 0; i < n; i++) out.push(c[0] * ill[0] * E, c[1] * ill[1] * E, c[2] * ill[2] * E);
  }
  return new Float32Array(out);
}

test('balanço automático: acha a luz pelo cinza e ignora a fita vermelha', () => {
  for (const K of [3000, 4000, 6500]) {
    const a = autoWhiteBalance(rawScene(K, [['#808080', 200, 0.8], ['#d0202a', 800, 0.9]]));
    near(1e6 / a.kelvin, 1e6 / K, 4); // dentro de 4 mired
    assert.ok(a.zoneUsed);
  }
});

test('balanço automático: papelão pardo engana (parece cinza sob luz quente), mas fica numa luz real', () => {
  const a = autoWhiteBalance(rawScene(6500, [['#b8875a', 600, 0.9], ['#62676b', 300, 0.5], ['#d0202a', 100, 0.9]]));
  assert.ok(a.kelvin < 5000, `${a.kelvin}`); // enganado para o lado quente
  assert.ok(a.kelvin >= 2500 && a.gains[0] > 0.4 && a.gains[2] < 2.6, JSON.stringify(a)); // ganhos de uma luz real
  // o "mundo cinza" antigo dava vermelho ×0,25 neste tipo de cena; preso à curva, não passa de 2500 K
});

test('balanço automático: sem nenhum cinza possível, usa a média presa à curva', () => {
  const a = autoWhiteBalance(rawScene(6500, [['#d0202a', 500, 0.9], ['#20a030', 500, 0.6]]));
  assert.equal(a.zoneUsed, false);
  assert.ok(a.kelvin >= 2500 && a.kelvin <= 10000);
});
