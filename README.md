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
| **Cena** | Objetos com medidas reais (mm): caixa, fita vermelha, fita branca com logo, fita transparente com logo (mais brilhante, sensível ao reflexo), prato da balança, operador, ou qualquer foto enviada. Empilhamento ("apoiado sobre"), posição, rotação, cor em RGB (na fita transparente, cor do logo), opacidade e brilho (reflexo). |
| **Caixas com câmera fixa** | Lista de tamanhos de caixa (P, M, G, GG e as que você criar). Trocar a caixa ajusta a fita e a posição (centralizada ou encostada no canto). "Comparar todas" gera a imagem de cada caixa com a mesma câmera e mostra se cabe inteira, quantos pixels a fita tem e se a detecção passa. |
| **Enquadramento** | Vista de cima e vista de frente em escala, com o campo de visão no plano do alvo e na bancada, altura da câmera, faixa nítida (profundidade de campo) e quantos pixels a fita ocupa. |
| **Câmera** | Modelos pesquisados (Logitech C920, Hikvision, Intelbras) com resolução, FOV, zoom motorizado e distorção. Câmera personalizada com dados do datasheet. |
| **Imagem** | Exposição automática ou manual (obturador e ganho), balanço de branco (automático, por temperatura ou ganhos R/G/B), preto e branco (modo noite), ruído e compressão JPEG. |
| **Luz** | Fontes somadas na mesma imagem. *Luzes da bancada*: lâmpada, light bar, ring light, painel de LED e domo, cada uma com ou sem difusor por cima (o difusor troca reflexo forte por macio e perde ~30% da luz), intensidade, cor, posição em relação à emenda e opção de LED pulsado sincronizado. *Luz do galpão*: lâmpadas (com flicker), teto com difusor e janelas, variando ao longo do dia. *Cobertura da bancada* bloqueia parte do galpão. Indicadores mostram a participação de cada uma na imagem e quanto a imagem varia ao longo do dia. |
| **Detecção** | Dois modos, escolhidos automaticamente pelo alvo. *Área de cor* (fita colorida): cobertura da fita e falsos positivos. *Logo repetido* (fita transparente ou branca com logo): percorre a emenda inteira da caixa e conta os logos; reprova se houver um trecho sem logo maior que o limite (fita curta, faltando ou emenda aberta). Régua da emenda no veredito, máscara sobre a imagem e lupa com zoom de 2× a 16× (clique para fixar o ponto). |

## Rodar

Sem dependências em tempo de execução. Os módulos ES precisam de um servidor (não abre via `file://`):

```bash
npm start            # python3 -m http.server 8080 → http://localhost:8080
npm test             # testes dos cálculos (node --test)
npm run build        # dist/index.html: página única com CSS, JS e logo embutidos
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
docs/modelo.md          as simplificações físicas, para saber o que o simulador NÃO representa
```

## Adicionar uma câmera

Inclua um item em `src/presets/cameras.js`. `hfov` e `focalMm` com um valor = lente fixa; com dois =
zoom motorizado `[grande angular, tele]`. Liste em `estimated` tudo que não veio do datasheet: a
interface avisa.

## Cena em arquivo

"Salvar cena" gera um JSON com todos os objetos (fotos embutidas), câmera, luz e critérios de
detecção. "Abrir cena" carrega de volta. Útil para guardar uma configuração por cliente.

## Limitações

Leia `docs/modelo.md`. Em resumo: a câmera sempre olha reto para baixo, a luz não projeta sombras, o
reflexo é uma mancha aproximada e os valores de exposição são relativos (calibrados para 500 lux,
1/120 s e 0 dB darem uma imagem bem exposta). Serve para comparar opções e explicar efeitos, não para
substituir o teste com a câmera real.
