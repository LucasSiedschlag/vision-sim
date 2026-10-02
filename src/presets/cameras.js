// Câmeras pesquisadas para o projeto (preços consultados em 02/10/2026).
// `estimated` lista os campos que não vieram de datasheet e devem ser conferidos.
// hfov e focalMm: um valor = lente fixa; dois valores = zoom motorizado [grande angular, tele].
// sensorType: formato óptico do datasheet (1/x"), de onde sai o tamanho do pixel; null = calculado pela lente.
// O comportamento do pixel (sensibilidade, saturação, ruído) vem do Sony IMX327: ver src/core/sensor.js.

export const CAMERAS = [
  {
    id: 'c920',
    name: 'Logitech C920 (USB)',
    brand: 'Logitech',
    kind: 'usb',
    widthPx: 1920, heightPx: 1080,
    hfov: [70.4], focalMm: [3.67], aperture: 2.0,
    distortionK: -0.05,
    sensorType: null, // sensor não divulgado: pixel calculado pela lente (focal e FOV)
    price: null, store: 'Protótipo de bancada',
    notes: 'Webcam para desenvolver o algoritmo. Controles manuais via UVC.',
    estimated: ['hfov', 'focalMm', 'aperture'],
  },
  {
    id: 'ds2cd1021g0i',
    name: 'Hikvision DS-2CD1021G0-I (2,8 mm)',
    brand: 'Hikvision',
    kind: 'ip',
    widthPx: 1920, heightPx: 1080,
    hfov: [94], focalMm: [2.8], aperture: 2.0,
    distortionK: -0.22,
    sensorType: 2.7,
    price: 289, store: 'Kabum (PIX)',
    notes: 'A mais barata. Grande angular: pega muito fundo e distorce nas bordas.',
    estimated: ['aperture'],
  },
  {
    id: 'ds2cd1023g0ei-4',
    name: 'Hikvision DS-2CD1023G0E-I (4 mm)',
    brand: 'Hikvision',
    kind: 'ip',
    widthPx: 1920, heightPx: 1080,
    hfov: [82], focalMm: [4], aperture: 2.0,
    distortionK: -0.14,
    sensorType: 2.7,
    price: 379, store: 'Amazon (preço da versão 2,8 mm)',
    notes: 'Linha de entrada com lente de 4 mm. Confirmar preço da versão 4 mm.',
    estimated: ['hfov', 'aperture'],
  },
  {
    id: 'ds2cd1027g2h-liu-4',
    name: 'Hikvision DS-2CD1027G2H-LIU ColorVu (4 mm)',
    brand: 'Hikvision',
    kind: 'ip',
    widthPx: 1920, heightPx: 1080,
    hfov: [85], focalMm: [4], aperture: 1.0,
    distortionK: -0.14,
    sensorType: 2.8,
    price: 411.25, store: 'Amazon',
    notes: 'Lente 4 mm F1.0. Tem LED branco automático: deixar desligado.',
    estimated: ['hfov'],
  },
  {
    id: 'vip3240dzg2',
    name: 'Intelbras VIP 3240 D Z G2 (motorizada)',
    brand: 'Intelbras',
    kind: 'ip',
    widthPx: 1920, heightPx: 1080,
    hfov: [105, 33], focalMm: [2.8, 12], aperture: 1.4,
    distortionK: -0.2,
    sensorType: 2.7,
    price: 1196.9, store: 'Amazon',
    notes: 'Motorizada mais barata encontrada. Datasheet cita só balanço de branco automático.',
    estimated: ['aperture'],
  },
  {
    id: 'ds2cd3666g2t-izs',
    name: 'Hikvision DS-2CD3666G2T-IZS (6 MP, motorizada)',
    brand: 'Hikvision',
    kind: 'ip',
    widthPx: 3200, heightPx: 1800,
    hfov: [103, 29], focalMm: [2.7, 13.5], aperture: 1.6,
    distortionK: -0.2,
    sensorType: null, // formato não confirmado: pixel calculado pela lente
    price: 1265.58, store: 'Amazon',
    notes: 'Melhor custo-benefício entre as motorizadas. Confirmar se pede PoE+.',
    estimated: ['widthPx', 'heightPx', 'hfov', 'aperture'],
  },
  {
    id: 'ds2cd2643g2-izs',
    name: 'Hikvision DS-2CD2643G2-IZS (4 MP, motorizada)',
    brand: 'Hikvision',
    kind: 'ip',
    widthPx: 2688, heightPx: 1520,
    hfov: [105.4, 34.3], focalMm: [2.8, 12], aperture: 1.6,
    distortionK: -0.2,
    sensorType: 3,
    price: 2314.99, store: 'Amazon',
    notes: 'Modelo discutido originalmente. O mais caro da lista.',
    estimated: ['aperture', 'hfov'],
  },
];

/** Modelo editável para câmeras fora da lista. */
export function customCamera(base = {}) {
  return {
    id: 'custom',
    name: 'Câmera personalizada',
    brand: '—',
    kind: 'ip',
    widthPx: 1920, heightPx: 1080,
    hfov: [80], focalMm: [4], aperture: 2.0,
    distortionK: -0.1,
    sensorType: 2.8,
    price: null, store: '',
    notes: 'Preencha resolução, FOV, focal, abertura e formato do sensor com os dados do datasheet.',
    estimated: [],
    ...base,
  };
}

export function isZoom(cam) {
  return cam.hfov.length > 1;
}
