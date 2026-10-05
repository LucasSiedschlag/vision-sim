# Bancada Virtual de Visão

Simulador interativo de um posto de inspeção por câmera. Serve para escolher câmera, lente, altura e
iluminação **antes** de comprar o hardware, e para mostrar ao cliente, de forma visual, por que cada
escolha importa.

Primeiro caso de uso: verificar se a caixa saiu da balança fechada e lacrada com fita (projeto de
pesagem, etiqueta e visão da fita). A cena de exemplo é esse posto, mas qualquer objeto pode ser
adicionado a partir de uma foto com as medidas reais.

## O que dá para simular

| Área | O que muda na tela |
|---|---|
| **Cena** | Objetos com medidas reais (mm): caixa, fita vermelha, fita branca com logo, fita transparente com logo (mais brilhante, sensível ao reflexo), prato da balança, operador, ou qualquer foto enviada. Empilhamento ("apoiado sobre"), posição, rotação, cor em RGB (na fita transparente, cor do logo), opacidade e superfície (filme BOPP, papelão, inox, tecido) com a aspereza do reflexo. |
| **Caixas com câmera fixa** | Lista de tamanhos de caixa (P, M, G, GG e as que você criar). Trocar a caixa ajusta a fita e a posição (centralizada ou encostada no canto). "Comparar todas" gera a imagem de cada caixa com a mesma câmera e mostra se cabe inteira, quantos pixels a fita tem e se a detecção passa. |
| **Enquadramento** | Vista de cima e vista de frente em escala, com o campo de visão no plano do alvo e na bancada, altura da câmera, faixa nítida (profundidade de campo) e quantos pixels a fita ocupa. |
| **Câmera** | Modelos pesquisados (Logitech C920, Hikvision, Intelbras) com resolução, FOV, zoom motorizado e distorção. Câmera personalizada com dados do datasheet. |
| **Imagem** | Exposição automática ou manual (obturador e ganho), balanço de branco (automático, por temperatura ou ganhos R/G/B), preto e branco (modo noite), ruído e compressão JPEG. |
| **Luz** | Fontes somadas na mesma imagem. *Luzes da bancada*: produtos baratos reais (lâmpada bulbo 9 W, barra LED 60 cm, painel 24 W, ring light USB, domo), com fluxo em lúmens do fabricante, posição e altura em mm (arraste nas vistas), placa difusora opcional (reflexo maior e mais fraco, perde ~30% da luz), cor e opção de LED pulsado sincronizado. A iluminância no alvo é calculada, e a vista de cima marca onde cai o reflexo de cada luminária. *Luz do galpão*: lâmpadas (com flicker), teto com difusor e janelas, variando ao longo do dia. *Cobertura da bancada* bloqueia parte do galpão. Indicadores mostram a participação de cada uma na imagem e quanto a imagem varia ao longo do dia. |
| **Detecção** | Dois modos, escolhidos automaticamente pelo alvo. *Área de cor* (fita colorida): cobertura da fita e falsos positivos. *Logo repetido* (fita transparente ou branca com logo): percorre a emenda inteira da caixa e conta os logos; reprova se houver um trecho sem logo maior que o limite (fita curta, faltando ou emenda aberta). Régua da emenda no veredito, máscara sobre a imagem e lupa com zoom de 2× a 16× (clique para fixar o ponto). |

## Rodar

Sem dependências em tempo de execução. Os módulos ES precisam de um servidor (não abre via `file://`):

```bash
npm start            # python3 -m http.server 8080 → http://localhost:8080
npm test             # testes dos cálculos (node --test)
npm run build        # dist/index.html: página única com CSS, JS e logo embutidos
npm run tabuleiro    # calibracao/tabuleiro-a4.pdf para calibrar a lente
```

`dist/index.html` não tem `<html>`/`<head>`/`<body>` de propósito: é o formato publicado como página
no claude.ai, que adiciona esse esqueleto. Para abrir localmente, use o `index.html` da raiz.

## Estrutura

```
index.html              página (marcadores head:/body: usados pelo build)
css/styles.css          tema claro/escuro por tokens
src/
  main.js               liga estado, painéis, vistas e câmera
  state.js              store, normalização e autosave (localStorage)
  core/                 cálculo puro, sem DOM (testado em Node)
    optics.js           FOV, mm/pixel, projeção, profundidade de campo, distorção
    color.js            sRGB/linear, temperatura de cor, HSV, balanço de branco
    sensor.js           equação da câmera, saturação e ruído do pixel (dados do Sony IMX327)
    photometry.js       luminárias como emissores: iluminância, reflexo espelhado, Fresnel
    illumination.js     luz e reflexo por pixel, por superfície
    materials.js        superfícies: Fresnel e aspereza (fita BOPP, papelão, inox)
    validation.js       medidas comparáveis entre foto real e simulada
    lighting.js         tipos de luz, dia, flicker, exposição
    detection.js        máscara por cor (com tabela de 32 768 cores), avaliação, veredito
    scene.js            empilhamento, câmera resolvida, indicadores
  presets/
    cameras.js          câmeras pesquisadas (preços de 02/10/2026; campos estimados marcados)
    objects.js          objetos prontos e cena de exemplo
  render/
    camera.js           pipeline da imagem simulada
    views.js            vista de cima e vista de frente
    textures.js         texturas procedurais, foto do usuário e ajuste RGB
  ui/
    controls.js         sliders, seletores e afins ligados ao estado
    panels.js           abas Cena, Câmera, Luz e Detecção
    io.js               salvar/abrir arquivos e ler imagens
tests/core.test.js
scripts/build-artifact.mjs
scripts/tabuleiro.mjs   gera o tabuleiro de calibração (PDF)
calibracao/             calibração da lente com OpenCV (LEIA-ME.md)
docs/modelo.md          as simplificações físicas, para saber o que o simulador NÃO representa
docs/validacao.md       roteiro da validação com a câmera real e resultados
```

## Calibrar a lente e validar contra a câmera real

- `npm run tabuleiro` gera `calibracao/tabuleiro-a4.pdf`. Fotos do tabuleiro + `calibracao/calibrar.py`
  (Python + OpenCV) medem focal, FOV e distorção; **Importar calibração…** (aba Câmera) aplica no
  simulador. Passo a passo em `calibracao/LEIA-ME.md`; `calibracao/teste_sintetico.py` confere o script
  com uma câmera virtual de lente conhecida.
- **Foto real…** (sobre a imagem da câmera) compara uma foto da câmera de verdade com a simulação, com as
  mesmas medidas (largura da fita, cor, brilho, ruído, reflexo, detecção, lux), e salva um relatório.
  Roteiro da sessão e limites de aceitação em `docs/validacao.md`.

## Adicionar uma câmera

Inclua um item em `src/presets/cameras.js`. `hfov` e `focalMm` com um valor = lente fixa; com dois =
zoom motorizado `[grande angular, tele]`. Liste em `estimated` tudo que não veio do datasheet: a
interface avisa.

## Cena em arquivo

"Salvar cena" gera um JSON com todos os objetos (fotos embutidas), câmera, luz e critérios de
detecção. "Abrir cena" carrega de volta. Útil para guardar uma configuração por cliente.

## Limitações

Leia `docs/modelo.md`. Em resumo: a câmera sempre olha reto para baixo e a luz não projeta sombras.
As luminárias são produtos reais (fluxo e ângulo do fabricante) posicionadas em mm, e o reflexo na fita é
a imagem espelhada delas (filme BOPP, ~4% de Fresnel). A exposição e o ruído seguem a equação da câmera e o datasheet do
sensor Sony IMX327 (abertura, tamanho do pixel, obturador e ganho mudam a imagem como na câmera real),
mas os sensores das câmeras da lista são estimados pelo formato óptico até serem medidos. Serve para
comparar opções e explicar efeitos, não para substituir o teste com a câmera real.
