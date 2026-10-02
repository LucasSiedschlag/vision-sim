// Sensor: da luz na cena aos elétrons no pixel e ao valor de saída. Funções puras, sem DOM.
//
// Cadeia (superfície fosca, câmera olhando de frente):
//   luminância      L  = ρ · E / π                       (E em lux na cena, ρ = refletância)
//   no sensor       Es = π · L · T / (4 · N²)            (equação da câmera; T = transmissão da lente)
//                      = ρ · E · T / (4 · N²)
//   exposição       H  = Es · t                          (lux·s no sensor)
//   sinal           H / Hsat                             (fração da saturação, ganho 0 dB)
//   elétrons        (H / Hsat) · fullWell                → ruído de disparo √e⁻ + ruído de leitura

/**
 * Exposição de referência da Sony para "Sensitivity (F5.6)": fonte de 706 cd/m², F5.6, 1/30 s.
 * No sensor: π · 706 / (4 · 5,6²) · 1/30 ≈ 0,589 lux·s.
 */
export const SONY_REF_LUX_S = (Math.PI * 706) / (4 * 5.6 * 5.6) / 30;

/** Transmissão típica de lente de câmera de segurança (vidro + filtro IR). Estimada. */
export const LENS_TRANSMISSION = 0.9;

/**
 * Exposição que satura o pixel (lux·s no sensor), a partir da tabela "Image Sensor Characteristics"
 * da Sony: sensibilidade e saturação no mesmo conversor (dígitos).
 */
export function satFromSony(sensitivityDigits, saturationDigits) {
  return SONY_REF_LUX_S * (saturationDigits / sensitivityDigits);
}

/**
 * IMX327LQR (Sony STARVIS, 1/2.8", 2,9 µm). Base para os sensores sem datasheet.
 * Sensibilidade 10741 dígitos e saturação 3855 dígitos (12 bits): Sony, Product Information Ver.1.3.
 * Elétrons na saturação e ruído de leitura: medidos no IMX290 (mesmo pixel STARVIS de 2,9 µm) pela
 * ZWO (ASI290MC: 14,5 ke⁻, 3 e⁻ no ganho 0).
 */
export const IMX327 = {
  id: 'imx327',
  label: 'Sony IMX327 (1/2.8", 2,9 µm)',
  pixelUm: 2.9,
  satLuxS: satFromSony(10741, 3855),
  fullWellE: 14500,
  readNoiseE: 3,
  estimated: ['fullWellE', 'readNoiseE'],
};

/**
 * Sensor estimado a partir do formato óptico do datasheet da câmera ("1/2.7"" etc.).
 * Diagonal ≈ 18 mm / x (convenção dos tipos pequenos: 1/2.8" = 6,46 mm na Sony).
 * Supõe pixel da mesma geração do IMX327: mesma sensibilidade e capacidade por µm².
 */
export function sensorFromFormat(typeDenominator, widthPx, heightPx, label) {
  const diagMm = 18 / typeDenominator;
  const pixelUm = (diagMm / Math.hypot(widthPx, heightPx)) * 1000;
  return sensorFromPixel(pixelUm, label || `1/${typeDenominator}" (estimado)`);
}

/** Sensor estimado só pelo tamanho do pixel (µm), escalando o IMX327 pela área. */
export function sensorFromPixel(pixelUm, label) {
  const area = (pixelUm / IMX327.pixelUm) ** 2;
  return {
    id: 'estimado',
    label: label || `pixel de ${pixelUm.toFixed(2)} µm (estimado)`,
    pixelUm,
    // luz coletada e capacidade crescem com a área: a exposição que satura é a mesma.
    // Pixel menor fica com menos elétrons, ou seja, mais ruído com o mesmo brilho.
    satLuxS: IMX327.satLuxS,
    fullWellE: Math.round(IMX327.fullWellE * area),
    readNoiseE: IMX327.readNoiseE,
    estimated: ['pixelUm', 'satLuxS', 'fullWellE', 'readNoiseE'],
  };
}

/**
 * Sensor de um modelo de câmera: pelo formato óptico (`sensorType`) quando o datasheet informa;
 * senão, pelo pixel que a lente implica (largura do sensor tirada do par focal/FOV).
 */
export function sensorFor(model, sensorWidthMm) {
  if (model.sensorType > 0) return sensorFromFormat(model.sensorType, model.widthPx, model.heightPx);
  return sensorFromPixel((sensorWidthMm / model.widthPx) * 1000);
}

/**
 * Fração da saturação (ganho 0 dB) que uma superfície branca fosca atinge
 * por lux·s de luz na cena, com abertura `fNumber`.
 */
export function whiteSignalPerLuxS(sensor, fNumber, transmission = LENS_TRANSMISSION) {
  return transmission / (4 * fNumber * fNumber) / sensor.satLuxS;
}

/** Sinal (fração da saturação, 0 dB) de uma superfície com refletância ρ sob `lux`, obturador `shutterS`. */
export function signalFraction(sensor, fNumber, lux, shutterS, reflectance = 1) {
  return reflectance * lux * shutterS * whiteSignalPerLuxS(sensor, fNumber);
}

/**
 * Desvio padrão do ruído, na mesma escala do sinal de saída (fração da saturação × ganho),
 * para um sinal de saída `out`. Ruído de disparo (√e⁻) + leitura, ambos multiplicados pelo ganho.
 */
export function noiseSigma(sensor, out, gainLin) {
  const e = Math.max(0, out / gainLin) * sensor.fullWellE;
  return (gainLin / sensor.fullWellE) * Math.sqrt(e + sensor.readNoiseE ** 2);
}

/** Relação sinal/ruído (dB) de um sinal de saída `out` com o ganho dado. */
export function snrDb(sensor, out, gainLin) {
  const s = noiseSigma(sensor, out, gainLin);
  return s > 0 ? 20 * Math.log10(out / s) : Infinity;
}
