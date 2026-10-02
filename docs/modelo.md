# Modelo físico e simplificações

O simulador existe para comparar alternativas e mostrar efeitos ao cliente. Abaixo, o que cada etapa
calcula e onde ela simplifica a realidade.

## Geometria

- Câmera pinhole olhando reto para baixo (sem inclinação). Distância focal em pixels:
  `f = (largura_px / 2) / tan(FOV_h / 2)`.
- Cada objeto é um prisma retangular (ou um plano fino). O topo de um plano horizontal vira uma
  transformação afim na imagem (escala `f / (altura_câmera − z)` + rotação), por isso fotos enviadas
  aparecem em escala correta e sem custo extra.
- Paredes das caixas aparecem quando a caixa está fora do eixo da câmera.
- Ordem de desenho por altura do topo. Objetos que se cruzam em altura não são resolvidos pixel a pixel.

## Lente

- FOV horizontal do datasheet. Para zoom motorizado, a largura do sensor sai do par (focal, FOV) no
  grande angular e a focal é interpolada linearmente.
- Distorção radial de um termo (`k1`), normalizada para os cantos ficarem no lugar. Diminui com o zoom
  (`k1 · (f_wide / f)²`). Os valores de `k1` são aproximados, não medidos.
- Profundidade de campo pela fórmula da hiperfocal, com círculo de confusão de 2 pixels e foco no
  plano do alvo. Não há desfoque aplicado na imagem; o indicador só avisa.

## Luz e sensor

- Sinal linear = refletância (sRGB → linear) × iluminação × cor da luz × exposição × balanço de branco.
- Cor da luz por temperatura (aproximação de Tanner Helland), normalizada em 6500 K.
- Exposição relativa, por fonte: `lux/500 × (tempo × 120) × ganho × 0,9`. Não é uma calibração radiométrica.
  Exposição automática: menor ganho possível; procura o obturador que deixa a média da imagem em 18%.
- Várias fontes ao mesmo tempo: cada uma soma seu sinal (com sua cor, queda de luz, reflexo e flicker).
- Reflexo: mancha multiplicada pelo "brilho" do material. Lâmpada nua = ponto forte; light bar = faixa
  alongada no sentido da fita; ring light = anel; painel = mancha larga; domo = quase nada. O difusor
  deixa o reflexo mais fraco e espalhado e deixa passar 70% da luz. Afastar a luminária da emenda move
  a mancha para fora da fita.
- Luz contínua: o sinal de todas as fontes é proporcional ao obturador, então a proporção bancada/galpão
  não muda com o obturador. LED pulsado: a contribuição é intensidade × sobrecorrente × min(pulso,
  obturador); encurtar o obturador até o pulso corta o galpão sem perder o LED.
- Cobertura da bancada: multiplica as fontes do galpão por (1 − bloqueio).
- Luz ambiente: lâmpadas de 4000 K + luz do dia pelo difusor do teto (~5200–6200 K, suave) + janelas
  laterais (3200 K no começo/fim do dia, ~6000 K ao meio-dia), misturadas em mired. As janelas deixam
  um lado da imagem mais claro, na proporção da luz que vem delas.
- Flicker: lâmpada oscila a 120 Hz; cada linha da imagem integra a luz num intervalo diferente
  (obturador rolling, 1/30 s para ler o quadro). Por isso aparecem faixas e variação entre fotos quando
  o obturador não é múltiplo de 1/120 s.
- Ruído: triangular, proporcional ao ganho. Saturação conta pixels com algum canal ≥ 1.
- Balanço automático: "mundo cinza" (a média da imagem vira neutra). É o motivo de uma fita vermelha
  grande puxar a cor do resto.

## Entrega e detecção

- Compressão JPEG real do navegador na qualidade escolhida.
- Detecção: pixel conta se saturação ≥ mínimo, brilho ≥ mínimo e matiz dentro da tolerância da cor
  procurada. Usa uma tabela de 32 768 cores (5 bits por canal).
- Modo logo: a emenda (comprimento do objeto em que a fita está apoiada, na largura da fita) é
  dividida em 256 fatias; uma fatia tem logo se tiver ao menos 2 pixels da cor. Falhas menores que
  15 mm (espaço entre letras) são unidas. Conta-se o número de logos e o maior trecho sem logo,
  incluindo as pontas.
- Modo área de cor: a referência é a "tinta" do alvo, isto é, os pixels da textura ideal que já têm a cor
  procurada (fita vermelha: a fita inteira; fita com logo: só as letras), como uma foto de uma caixa boa.
  Cobertura = detectado dentro da tinta / área da tinta. Falso positivo = detectado fora da área do alvo,
  em proporção da área esperada. Bordas de letras dentro da fita não contam como falso positivo.
- Tudo isso vem da geometria (onde os objetos marcados como alvo realmente estão, descontando o que está
  por cima).

## O que não está modelado

Sombras projetadas, câmera inclinada, desfoque, aberração cromática, vinheta da lente, sensor com
resposta espectral real, infravermelho no modo noite (o P&B é só a luminância), movimento.
