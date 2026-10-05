// Leitor de CSV: separador detectado pelo cabeçalho (; do Excel em português, ou ,), campos entre aspas
// com "" escapado e quebras de linha dentro das aspas, BOM e CRLF. Puro, sem DOM.

/**
 * Retorna { header, rows }, cada linha { line, values } com o número da linha no arquivo (1 = cabeçalho).
 * Linhas vazias são ignoradas.
 */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  const records = [];
  let field = '', fields = [], quoted = false, line = 1, startLine = 1, i = 0;
  const endRecord = () => {
    fields.push(field);
    if (fields.length > 1 || fields[0] !== '') records.push({ line: startLine, values: fields });
    fields = []; field = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      if (ch === '\n') line++;
      field += ch; i++;
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === sep) { fields.push(field); field = ''; i++; continue; }
    if (ch === '\r' && src[i + 1] === '\n') { i++; continue; }
    if (ch === '\n') { endRecord(); line++; startLine = line; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || fields.length) endRecord();
  const [head, ...rows] = records;
  return { header: head ? head.values.map((h) => h.trim()) : [], rows, separator: sep };
}
