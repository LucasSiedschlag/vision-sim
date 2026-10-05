// Gera calibracao/tabuleiro-a4.pdf: tabuleiro de xadrez para calibrar a lente com OpenCV.
// 10 × 7 quadrados de 25 mm (9 × 6 cantos internos), A4 deitado, em vetor: imprime na medida exata
// se a impressão for em 100% (sem "ajustar à página").
import { writeFile, mkdir } from 'node:fs/promises';

const COLS = 10, ROWS = 7, SQUARE = 25; // quadrados e lado (mm)
const PAGE_W = 297, PAGE_H = 210; // A4 deitado (mm)
const pt = (mm) => (mm * 72) / 25.4;

const boardW = COLS * SQUARE, boardH = ROWS * SQUARE;
const x0 = (PAGE_W - boardW) / 2, y0 = 10; // 10 mm do topo: embaixo ficam a régua e as instruções

const ops = ['0 g'];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if ((r + c) % 2) continue;
    // PDF tem origem embaixo à esquerda
    const x = x0 + c * SQUARE, y = PAGE_H - (y0 + (r + 1) * SQUARE);
    ops.push(`${pt(x).toFixed(3)} ${pt(y).toFixed(3)} ${pt(SQUARE).toFixed(3)} ${pt(SQUARE).toFixed(3)} re f`);
  }
}
// régua de 100 mm para conferir a escala da impressão
const ry = PAGE_H - (y0 + boardH + 8);
ops.push(`0.6 w ${pt(x0).toFixed(3)} ${pt(ry).toFixed(3)} m ${pt(x0 + 100).toFixed(3)} ${pt(ry).toFixed(3)} l S`);
for (let k = 0; k <= 10; k++) {
  const x = pt(x0 + k * 10).toFixed(3), h = k % 5 ? 1.5 : 3;
  ops.push(`${x} ${pt(ry).toFixed(3)} m ${x} ${pt(ry + h).toFixed(3)} l S`);
}
const text = (x, y, size, s) => `BT /F1 ${size} Tf ${pt(x).toFixed(3)} ${pt(y).toFixed(3)} Td (${s.replace(/[()\\]/g, '\\$&')}) Tj ET`;
ops.push(text(x0 + 104, ry - 1, 8, 'Régua de 100 mm: confira com uma régua antes de fotografar.'));
ops.push(text(x0, ry - 6, 8, `Tabuleiro ${COLS - 1} × ${ROWS - 1} cantos internos · quadrados de ${SQUARE} mm · imprima em 100% (sem ajustar à página),`));
ops.push(text(x0, ry - 10, 8, 'cole numa superfície plana e rígida (papelão grosso, MDF). Simulador: calibracao/LEIA-ME.md'));

// Texto em WinAnsi (latin-1 cobre os acentos e o ×)
const content = Buffer.from(ops.join('\n'), 'latin1');
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(PAGE_W).toFixed(3)} ${pt(PAGE_H).toFixed(3)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
  null, // stream
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
];
const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
const offsets = [];
let size = chunks[0].length;
objs.forEach((o, i) => {
  offsets.push(size);
  const body = o === null
    ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream\nendobj\n')])
    : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
  chunks.push(body);
  size += body.length;
});
const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
  `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`].join('');
chunks.push(Buffer.from(xref, 'latin1'));

const out = new URL('../calibracao/tabuleiro-a4.pdf', import.meta.url);
await mkdir(new URL('./', out), { recursive: true });
await writeFile(out, Buffer.concat(chunks));
console.log(`calibracao/tabuleiro-a4.pdf: ${COLS} × ${ROWS} quadrados de ${SQUARE} mm`);
