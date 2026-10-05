# Calibração da lente (tabuleiro de xadrez)

Mede a focal, o campo de visão e a distorção reais de uma câmera, e aplica no simulador. Substitui os
valores estimados (`hfov`, `focalMm`, `distortionK`) de `src/presets/cameras.js`.

## 1. Imprimir o tabuleiro

`tabuleiro-a4.pdf` (gerado por `npm run tabuleiro`): 10 × 7 quadrados de 25 mm, ou seja, 9 × 6 cantos internos.

- Imprima em **100%** (desligue "ajustar à página"). Meça a régua de 100 mm da folha; se der diferente,
  meça um quadrado e passe o valor em `--quadrado`.
- Cole numa superfície **plana e rígida** (papelão grosso, MDF, vidro). Papel ondulado estraga a medida.

## 2. Preparar a câmera

A calibração vale para **uma** configuração de lente. Antes de fotografar:

- **Resolução** igual à que vai ser usada na inspeção.
- **Foco fixo.** O autofoco muda a focal entre uma foto e outra.
  - Logitech C920 no Linux: `v4l2-ctl -d /dev/video0 -c focus_automatic_continuous=0 -c focus_absolute=0`
    (em kernels antigos o controle se chama `focus_auto`). Ajuste `focus_absolute` até a bancada ficar
    nítida na altura de uso e não mexa mais. No macOS, use um app de controles UVC.
  - Câmera IP motorizada: escolha o zoom e o foco de uso e desligue o foco automático. Outro zoom = outra calibração.
- Desligue correção de distorção (LDC/"Lens correction") da câmera, se houver: queremos medir a lente.
- Câmera IP: tire as fotos pelo snapshot em resolução cheia (Hikvision: `http://<ip>/ISAPI/Streaming/channels/101/picture`),
  não por print da tela do vídeo.

## 3. Fotografar (15 a 25 fotos)

- O tabuleiro **inteiro** em cada foto, nítido, bem iluminado, sem reflexo forte.
- Varie: tabuleiro no centro, nos **quatro cantos** e nas bordas da imagem (a distorção está nas bordas),
  inclinado até ~45° para os lados, perto e longe.
- Câmera parada, tabuleiro na mão ou apoiado; sem borrão de movimento.
- Guarde em `calibracao/fotos/<nome-da-camera>/` (essa pasta não vai para o git).

## 4. Rodar

```bash
cd calibracao
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # uma vez
.venv/bin/python calibrar.py fotos/c920 --nome "Logitech C920" --pixel-um 3.0 --marcar
```

- `--pixel-um`: tamanho do pixel do sensor, para converter a focal em mm (opcional).
- `--marcar`: salva em `saida/cantos/` as fotos com os cantos achados, para conferir.

Exemplo de saída (números ilustrativos, não são medidas da C920):

```
15 de 17 fotos com o tabuleiro.
Erro de reprojeção: 0.21 px (bom)
Focal no centro: fx 1430.2 px, fy 1429.8 px · centro óptico desviado +6.1, -3.4 px
FOV medido: 67.8° × 40.1°
Simulador: FOV 67.65°, distorção λ = -0.0412 (erro do modelo até 1.10 px)
Salvo em saida/c920.json
```

- **Erro de reprojeção** abaixo de 0,5 px: boa. Acima de 1 px: fotos tremidas, tabuleiro curvo ou
  autofoco ligado. Refaça.
- **Erro do modelo**: o simulador usa um modelo de distorção de um termo (divisão); o OpenCV usa cinco. É a
  maior diferença entre os dois, quase sempre nos cantos extremos. Numa lente de barril forte (teste com
  câmera virtual de 4 mm e 81°) fica em ~5 px até 42° do centro e ~11 px nos cantos.

## 5. Aplicar no simulador

Aba **Câmera** → escolha o modelo de base (para abertura e sensor) → **Importar calibração…** →
`saida/c920.json`. A câmera vira "personalizada (calibrada)" com resolução, FOV, focal e distorção
medidos. Os indicadores (mm por pixel, largura da fita) passam a usar a lente medida.

## Autoteste

`.venv/bin/python teste_sintetico.py` fotografa o tabuleiro com uma câmera virtual de lente conhecida e
confere se `calibrar.py` recupera focal (±1%), k1, FOV (±0,5°) e a posição dos raios no modelo do simulador.
