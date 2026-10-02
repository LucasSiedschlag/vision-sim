// Salvar e abrir arquivos. Dentro do claude.ai usa o recurso de downloads da página;
// fora dele (servidor local), usa um link de download comum.

async function downloadsCapability() {
  try {
    return (await window.claude?.use?.('downloads')) || null;
  } catch {
    return null;
  }
}

export async function saveFile(filename, data) {
  const dl = await downloadsCapability();
  if (dl) {
    try {
      await dl.save({ filename, data });
      return 'saved';
    } catch (e) {
      if (e?.code === 'declined') return 'declined';
      if (e?.code !== 'unavailable' && e?.code !== 'not_granted') throw e;
    }
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'saved';
}

export function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('Não foi possível ler o arquivo.'));
    r.readAsText(file);
  });
}

/** Lê uma imagem e devolve { dataUrl, width, height }, reduzindo fotos muito grandes. */
export function readImage(file, maxSide = 2048) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error('Não foi possível ler a imagem.'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('Formato de imagem não suportado. Use PNG ou JPG.'));
      img.onload = () => {
        let { naturalWidth: w, naturalHeight: h } = img;
        const k = Math.min(1, maxSide / Math.max(w, h));
        if (k < 1) {
          const c = document.createElement('canvas');
          c.width = Math.round(w * k);
          c.height = Math.round(h * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          res({ dataUrl: c.toDataURL(type, 0.9), width: c.width, height: c.height });
          return;
        }
        res({ dataUrl: String(r.result), width: w, height: h });
      };
      img.src = String(r.result);
    };
    r.readAsDataURL(file);
  });
}
