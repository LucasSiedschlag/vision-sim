# Validação contra a câmera real

Objetivo: medir quanto o simulador erra, com números, numa bancada real. Depois desta sessão, cada valor
estimado do simulador (sensor da C920, aspereza da fita, flicker da barra, distorção) vira medido ou
ganha uma margem de erro conhecida.

Ferramentas no simulador:

- **Importar calibração…** (aba Câmera): aplica a lente medida com o tabuleiro (`calibracao/LEIA-ME.md`).
- **Foto real…** (sobre a imagem da câmera): abre uma foto da câmera real ao lado da simulação, mede as
  duas com o mesmo código (`src/core/validation.js`) e salva um relatório em Markdown.

As medidas são feitas em relação à fita achada em cada imagem, então a foto não precisa estar alinhada
pixel a pixel com a simulação. A medida de largura pede fita de cor sólida (use a fita vermelha).

## Material

- Logitech C920 (ou a câmera IP escolhida) num suporte fixo, apontando reto para baixo.
- Luxímetro (um app de celular serve para ordem de grandeza; luxímetro de verdade para os ±15%).
- Trena, régua, nível.
- Caixa de papelão pardo, fita vermelha de 48 mm e fita transparente com logo.
- Uma luminária do catálogo (a mais barata: barra LED Avant 60 cm 16 W).
- Tabuleiro impresso (`calibracao/tabuleiro-a4.pdf`).

## Roteiro (~1 h)

1. **Calibrar a lente.** Siga `calibracao/LEIA-ME.md` com foco fixo e a resolução de uso. Importe o JSON
   no simulador.
2. **Montar a cena e reproduzir no simulador.** Meça e anote: altura da lente até a bancada, medidas da
   caixa, posição da caixa e da fita, posição e altura da luminária (centro da parte que acende). Monte o
   mesmo no simulador (Cena e Luz).
3. **Fixar a câmera real.** Exposição manual, ganho mínimo, balanço de branco fixo, foco fixo. No
   simulador, ponha os mesmos valores (aba Câmera). Na C920 (Linux):
   `v4l2-ctl -c auto_exposure=1 -c exposure_time_absolute=<×100 µs> -c gain=0 -c white_balance_automatic=0 -c white_balance_temperature=6500`
   (os nomes dos controles mudam com a versão do kernel: `v4l2-ctl -l` lista os disponíveis).
   O obturador na C920 vai em unidades de 100 µs: 1/120 s ≈ 83.
4. **Medir a luz.** Luxímetro deitado sobre a fita, sensor para cima, sem fazer sombra. Anote.
5. **Fotografar.** Para cada caso abaixo, uma foto em PNG (ou o JPEG que a câmera entrega), sem mexer
   na câmera entre fotos:

   | Caso | O que muda | O que valida |
   |---|---|---|
   | A | Luminária afastada (reflexo fora da fita) | escala (px/mm), brilho, cor, ruído |
   | B | Luminária perto da linha câmera–fita (reflexo na fita) | posição e força do reflexo |
   | C | Fita transparente com logo, luminária como em B | reflexo no filme BOPP, detecção dos logos |
   | D | Caso A com ganho alto (ex.: 18 dB) e obturador mais curto | ruído do sensor |
   | E | Caso A com balanço automático | o quanto o automático é enganado pela caixa |

6. **Comparar.** Para cada foto: **Foto real…**, digite o lux medido, abra a foto, **Salvar relatório**.
   Junte os relatórios aqui embaixo.

## Limites de aceitação

| Medida | Limite | Se passar do limite, suspeitar de |
|---|---|---|
| Largura da fita (px) | ±5% | altura medida, calibração, FOV |
| Lux na fita | ±15% | fluxo da luminária, posição/altura, distribuição (m) |
| Brilho da fita e do papelão | ±15% | sensibilidade do sensor (`satLuxS`), transmissão da lente, lux |
| Matiz da fita | ±8° | balanço de branco, cor da fita (`color`), temperatura da luz |
| Saturação da fita | ±10 pontos | reflexo, compressão, cor da fita |
| Ruído no papelão | ±50% | capacidade (`fullWellE`), ruído de leitura, filtro de ruído da câmera |
| Fita reconhecida | ±10 pontos | tudo acima |
| Fita estourada (reflexo) | ±5 pontos | aspereza da fita (`roughness`), luminância da luminária |

## O que ajustar com os resultados

- **Brilho sistematicamente diferente** (com lux certo): ajuste `satLuxS` do sensor da câmera em
  `src/core/sensor.js` (é o único número que liga lux·s a brilho) e marque como medido.
- **Ruído menor na foto real**: esperado em câmera IP (filtro de ruído). Anote o fator; na C920 o filtro é fraco.
- **Reflexo maior/menor ou mais espalhado**: ajuste a aspereza do filme (`roughness` da fita, hoje 0,04 rad estimado).
- **Lux diferente**: confira posição/altura; se persistir, o fluxo real da luminária difere do catálogo.

## Resultados

_(preencher após a sessão: um relatório por caso, gerado pelo botão "Salvar relatório")_

| Caso | Data | Câmera | Lux real / sim | Largura real / sim | Brilho papelão real / sim | Reflexo real / sim | Dentro dos limites? |
|---|---|---|---|---|---|---|---|
| A | | | | | | | |
| B | | | | | | | |
| C | | | | | | | |
| D | | | | | | | |
| E | | | | | | | |

### Autoteste da ferramenta

Antes da sessão real, a ferramenta foi conferida com uma "foto real" gerada pelo próprio simulador com
a câmera 50 mm mais baixa (2026-10-05): a largura da fita medida diferiu 5,9%, contra 5,6% esperados pela
geometria (940 / 890 mm); matiz, saturação e cobertura bateram exatamente.
