// Confere data/cameras.csv e lista as câmeras: `npm run catalogo`. Sai com erro se alguma linha tiver
// problema, para dar para usar antes do commit (e numa ação do GitHub).
import { readFile } from 'node:fs/promises';
import { parseCameraCatalog, megapixels } from '../src/presets/cameras.js';

const text = await readFile(new URL('../data/cameras.csv', import.meta.url), 'utf8');
const { cameras, errors } = parseCameraCatalog(text);
for (const c of cameras) {
  const lens = c.focalMm.length > 1 ? `${c.focalMm[0]}–${c.focalMm[1]} mm` : `${c.focalMm[0]} mm`;
  console.log(`  ${c.id.padEnd(22)} ${c.name.padEnd(44)} ${String(megapixels(c)).padStart(4)} MP  ${c.lens.padEnd(10)} ${lens.padEnd(12)} F${c.aperture}${c.estimated.length ? `  (estimados: ${c.estimated.join(', ')})` : ''}`);
}
console.log(`${cameras.length} câmera(s) válida(s).`);
if (errors.length) {
  for (const e of errors) console.error(`data/cameras.csv, linha ${e.line}: ${e.message}`);
  process.exit(1);
}
