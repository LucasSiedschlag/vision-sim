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

- FOV horizontal do datasheet: é o campo da imagem entregue, já distorcida, de borda a borda. Para zoom
  motorizado, a focal é interpolada linearmente e o FOV entre os dois extremos do datasheet (linear em
  1/tan, como numa lente sem distorção).
- Distorção radial pelo modelo de divisão: `r_ideal = r_imagem / (1 + k1 · n²)`, com n em meias larguras
  da imagem (barril quando k1 < 0). A escala do centro sai da condição de a borda horizontal cair no FOV
  do datasheet: `fpx = (W/2) / ((1 + k1) · tan(FOV/2))`. Por isso, com barril, o centro tem mais pixels
  por mm que uma câmera sem distorção de mesmo FOV, e os indicadores (largura da fita, mm por pixel)
  usam essa escala do centro: batem com a imagem. Diminui com o zoom (`k1 · (f_wide / f)²`). Os valores
  de `k1` são aproximados, não medidos (a calibração com tabuleiro de xadrez vai substituí-los).
- A imagem ideal (perspectiva sem distorção) é renderizada maior que a entregue, para cobrir os cantos
  que o barril puxa para dentro (até 2,5× os pixels; acima disso, em escala menor).
- Distorção desligada = correção da própria câmera (LDC): mesma escala no centro, bordas cortadas.
- Lente calibrada (`calibracao/calibrar.py`): o OpenCV mede focal e distorção (k1, k2, p1, p2, k3); o
  script ajusta o k1 do modelo de divisão do centro aos cantos e o FOV que reproduz a focal medida no
  centro. O modelo de um termo erra até alguns pixels nos cantos extremos de lentes muito abertas
  (~11 px no teste com 81°); o erro fica gravado na calibração e aparece na aba Câmera.
- "Caixa inteira na imagem" e a lupa usam a projeção com distorção. No modo logo, a emenda é percorrida
  na imagem ideal, onde ela é reta.
- Profundidade de campo pela fórmula da hiperfocal, com círculo de confusão de 2 pixels do sensor e foco no
  plano do alvo. Não há desfoque aplicado na imagem; o indicador só avisa.

## Luz e sensor

- Sinal linear = refletância (sRGB → linear) × iluminação × cor da luz × exposição × balanço de branco.
- Cor da luz por temperatura (aproximação de Tanner Helland), normalizada em 6500 K.
- Exposição pela equação da câmera (`src/core/sensor.js`). Uma superfície fosca de refletância ρ sob
  E lux entrega ao sensor `Es = ρ · E · T / (4 · N²)` lux (N = abertura, T = 0,9 de transmissão da
  lente, estimada). O sinal é `Es · tempo / Hsat`, em fração da saturação do pixel, vezes o ganho.
  Abrir de F2.0 para F1.0 dá 4× mais sinal.
- `Hsat`, a exposição que satura o pixel, vem do datasheet do Sony IMX327 (Product Information
  Ver.1.3): sensibilidade de 10741 dígitos com 706 cd/m², F5.6 e 1/30 s (≈ 0,589 lux·s no sensor) e
  saturação de 3855 dígitos, ou seja, `Hsat ≈ 0,21 lux·s`. No ganho de 0 dB isso equivale a cerca de ISO 370.
- Câmeras sem sensor identificado: tamanho do pixel pelo formato óptico do datasheet (diagonal ≈ 18 mm / x
  para "1/x"") ou, sem formato, pela lente (focal e FOV). Supõe-se pixel da mesma geração do IMX327:
  mesmo `Hsat` (mesmo brilho) e capacidade proporcional à área (pixel menor = menos elétrons = mais ruído).
- Exposição automática: menor ganho possível; procura o obturador que deixa a média da imagem em 18%,
  com medição central ponderada (gaussiana de 35% da meia largura), o padrão comum em câmeras IP.
- Flicker das luminárias: os fabricantes baratos não informam; valores estimados (o DOE/CALiPER mediu
  de 0 a 100% em LEDs comerciais a 120 Hz). Ring light USB: corrente contínua, sem flicker.
- Ruído do sensor, por pixel e por canal, antes do balanço de branco: ruído de disparo (√elétrons) mais
  ruído de leitura. Capacidade de 14 500 e⁻ e leitura de 3 e⁻ (ZWO ASI290MC, mesmo pixel STARVIS de
  2,9 µm), escalados pela área do pixel nos outros sensores. O ganho multiplica sinal e ruído juntos:
  clarear com ganho não melhora a relação sinal/ruído (SNR, no painel de indicadores).
- Várias fontes ao mesmo tempo: cada uma soma seu sinal (com sua cor, iluminância, reflexo e flicker).

## Luminárias (`src/core/photometry.js`, `src/core/illumination.js`)

- Cada luminária é um produto real de baixo custo com os dados do fabricante (fluxo em lm, ângulo,
  tamanho; preço e loja consultados em 02/10/2026). Os campos que não vieram do datasheet são marcados
  como estimados na interface:

  | Tipo | Produto | Fluxo | Forma | Distribuição |
  |---|---|---|---|---|
  | Lâmpada bulbo | Philips LEDbulb A60 9 W 6500 K | 806 lm | esfera Ø 60 mm | 180° (m = 0) |
  | Barra linear | Avant Hummer 60 cm 16 W | 1460 lm | 600 × 30 mm (largura estimada) | 120° (m = 1) |
  | Painel | Taschibra sobrepor 24 W | 1680 lm | 280 × 280 mm | 120° (m = 1) |
  | Ring light | Streamplify Light 10 (USB) | 1000 lm | anel Ø 220–260 mm | m = 2,13 (480 lux a 1 m) |
  | Domo | montagem própria Ø 90 cm | 1500 lm (estimado) | meia esfera | Lambertiana |

- Intensidade `I(θ) = I0 · cosᵐ θ`, com `Φ = 2π · I0 / (m + 1)`. A forma é dividida em pontos emissores
  (até 12 × 12 no painel, 24 no anel, ~150 no domo) e a iluminância numa superfície horizontal é
  `E = Σ I0 · cosᵐ θe · cos θr / d²`. Testado contra a fórmula fechada da fonte retangular Lambertiana
  (erro < 1%) e contra os 480 lux a 1 m do ring light.
- A iluminância é calculada a cada 16 px da imagem, na altura de cada superfície (bancada, prato, topo
  da caixa, fita), e interpolada. Subir a luminária escurece; a luz cai para as bordas sozinha.
- Placa difusora leitosa: quem emite passa a ser a placa (luminária + 100 mm de cada lado, 50 mm abaixo),
  Lambertiana, com 70% do fluxo (transmissão estimada).
- Domo: superfície interna de luminância uniforme `L = Φ / (π · área)`. A cúpula é opaca: a luz de dentro
  só chega a pontos dentro dela ou, abaixo da borda, pelo vão entre a borda e a bancada.
- Paredes das caixas: recebem a luz calculada para o topo da própria caixa (aproximação; uma parede
  vertical recebe a luz de lado) e não refletem as luminárias.

## Reflexo especular

- Superfícies têm refletância especular na incidência normal `F0` (Fresnel) e aspereza (desvio do
  lóbulo de reflexo, em radianos). O reflexo cresce em ângulo rasante (aproximação de Schlick).
- Fita (filme BOPP): índice de refração ≈ 1,50 (1,495–1,528 conforme a direção de estiramento, dados de
  patentes de filme BOPP) → `F0 = ((n − 1)/(n + 1))² ≈ 4%`. Brilho a 45° de 83–93 GU (ASTM D2457): o
  filme é quase um espelho. Na caixa ele segue as ondas do papelão: aspereza estimada em ~2° (0,04 rad).
- Papelão: celulose (n ≈ 1,5), mas fosco (kraftliner revestido mede 42–45 GU a 75°, TAPPI T480; o pardo
  comum é mais fosco). Aspereza 0,45 rad: o reflexo se espalha tanto que quase some. Aço inox escovado
  do prato: `F0 ≈ 0,55`, aspereza 0,2 (estimados).
- Para cada pixel: o raio da câmera até a superfície é espelhado na normal (para cima) e segue até a
  luminária. Se acerta, o pixel recebe `F · L` da luminária (L = luminância da parte que brilha, cd/m²).
  A aspereza vira um lóbulo gaussiano: a forma da luminária é suavizada pela largura do lóbulo naquela
  distância (convolução exata de retângulo com gaussiana, via função erro).
- Ordem de grandeza: painel de 24 W tem ~6800 cd/m²; refletido na fita, ~270 cd/m², cerca de 4× o
  papelão em volta sob 700 lux. A lâmpada bulbo (~45 000 cd/m²) estoura. Por isso tirar a luminária da
  linha entre a câmera e a fita resolve: a vista de cima marca onde cai o reflexo de cada luminária.
- Galpão: tratado como céu uniforme, reflete `F × E` (um véu fraco, ~4% na fita).
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
- Saturação conta pixels com algum canal ≥ 1.
- Balanço automático por "zona cinza", como nas câmeras: só entram pixels cuja cor poderia ser uma
  superfície cinza sob alguma luz real (a até 0,15 em log r/g, b/g da curva do corpo negro), sem escuros
  nem estourados, pesados pela medição central. Cores fortes, como a fita vermelha, ficam de fora
  sozinhas. O resultado é a temperatura da curva (2500–10 000 K) mais próxima da média desses pixels, e
  os ganhos são os dessa luz. Limitação real que o simulador reproduz: papelão pardo sob luz fria tem a
  mesma cor de um cinza sob luz quente (~3300 K), então uma caixa ocupando a imagem engana o automático
  para ~3700–4000 K: a imagem esfria e a fita puxa ~7–10° para o magenta. O indicador avisa quando o
  automático se afasta mais de 30 mired da luz real. Antes era "mundo cinza" sem limite, que chegava a
  ganhos impossíveis (vermelho ×0,25) e jogava a fita para perto do limite da tolerância de cor.

## Objetos translúcidos

- Abaixo de 100% de opacidade, o objeto é um filme colorido: a parte opaca (α) devolve a própria cor C e o
  resto deixa a luz atravessar o corante na ida e na volta, filtrando o que está embaixo:
  `R = C · (α + (1 − α) · R_embaixo)`. Escurece e mantém o tom do filme (fita vermelha translúcida sobre
  papelão continua vermelha), em vez de misturar as cores como tinta, que puxava o vermelho para o laranja.
  A conta é feita em sRGB, que se aproxima de uma potência, onde multiplicar equivale a multiplicar em
  linear.
- O alvo conta como alvo com qualquer opacidade; outros objetos só tapam o alvo acima de 50%.

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

Sombras projetadas (inclusive a da própria câmera e da caixa), luminárias aparecendo na imagem ou
tapando a vista, luz refletida entre superfícies (só o domo assume interior uniforme), paredes das
caixas iluminadas de lado (usam a luz do topo), reflexo nas paredes, câmera inclinada, desfoque, aberração cromática, vinheta da lente (lentes grande
angular com distorção em barril não seguem cos⁴ e os datasheets não trazem a iluminação relativa), sensor
com resposta espectral real (a resposta por lux é a da referência de 3200 K para todas as luzes), mosaico
Bayer e redução de ruído da câmera (o ruído mostrado é o do sensor, antes do filtro de ruído que câmeras
IP aplicam), corrente de escuro, infravermelho no modo noite (o P&B é só a luminância), movimento.
