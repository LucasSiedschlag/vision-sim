// Gera dist/index.html: uma página única (CSS, JS e logo embutidos), pronta para publicar
// como página no claude.ai ou abrir em qualquer servidor estático.
import { build } from 'esbuild';
import { parseCameraCatalog } from '../src/presets/cameras.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

const html = await read('index.html');
const between = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`Marcadores ${a} / ${b} não encontrados em index.html`);
  return html.slice(i + a.length, j).trim();
};
const head = between('<!-- head:start -->', '<!-- head:end -->');
const body = between('<!-- body:start -->', '<!-- body:end -->');

const css = await read('css/styles.css');
const logo = await readFile(new URL('assets/logo-exemplo.png', root));
const logoUrl = `data:image/png;base64,${logo.toString('base64')}`;

const out = await build({
  entryPoints: [new URL('src/main.js', root).pathname],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  write: false,
  legalComments: 'none',
});
let js = out.outputFiles[0].text.replace('"assets/logo-exemplo.png"', () => JSON.stringify(logoUrl));
if (js.includes('assets/logo-exemplo.png')) throw new Error('Caminho do logo não foi substituído no bundle.');
js = js.replace(/<\/script/gi, () => '<\\/script');

// Arquivos de dados que o site lê com fetch (catálogo de câmeras e calibrações citadas nele): na página
// única não há de onde buscar, então vão embutidos em __VISION_FILES__.
const files = { 'data/cameras.csv': await read('data/cameras.csv') };
const catalog = parseCameraCatalog(files['data/cameras.csv']);
if (catalog.errors.length) throw new Error(`data/cameras.csv: ${catalog.errors.map((e) => `linha ${e.line}: ${e.message}`).join('; ')}`);
for (const c of catalog.cameras) if (c.calibrationPath) files[c.calibrationPath] = await read(c.calibrationPath);
const filesJs = `globalThis.__VISION_FILES__ = ${JSON.stringify(files).replace(/<\/script/gi, '<\\/script')};`;

const page = [
  // função de substituição: o código minificado pode conter "$'" ou "$&", que um texto de
  // substituição trataria como padrão especial e trocaria por pedaços do HTML
  head.replace(/<link rel="stylesheet" href="css\/styles\.css">/, () => `<style>\n${css}\n</style>`),
  body.replace(/<script type="module" src="src\/main\.js"><\/script>/, () => `<script>\n${filesJs}\n</script>\n<script type="module">\n${js}\n</script>`),
].join('\n');

await mkdir(new URL('dist/', root), { recursive: true });
// confere se o JS embutido continua íntegro
if (!page.includes(js.slice(-200))) throw new Error('O JavaScript embutido foi alterado na montagem da página.');
await writeFile(new URL('dist/index.html', root), page);
console.log(`dist/index.html (${(page.length / 1024).toFixed(0)} KB)`);
