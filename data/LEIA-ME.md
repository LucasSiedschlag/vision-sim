# Catálogo de câmeras (`cameras.csv`)

Uma linha por câmera **e lente**: a mesma câmera vendida com 2,8 mm e 4 mm vira duas linhas, porque FOV e
distorção mudam. Só dados técnicos.

## Como editar

- Abra no Excel/LibreOffice (separador `;`, UTF-8) ou edite direto no GitHub.
- Decimal com vírgula ou ponto (`1,6` ou `1.6`). Frações no obturador: `1/100000`.
- Sim/não: `sim` / `não`. Listas: separadas por `|` (`auto|manual-k`).
- **Célula vazia = não informado**: o simulador usa um padrão (abaixo) e não avisa nada.
- Valor que não veio do datasheet: coloque o nome da coluna em `estimados`. A interface avisa.
- Antes do commit: `npm run catalogo` confere tudo e aponta a linha com erro. No site, uma linha com
  erro é ignorada (e avisada); as outras continuam.
- Uma câmera que sair do catálogo não quebra cenas salvas: a cena guarda uma cópia dos dados dela.

## Colunas

### Identificação

| Coluna | Obrig. | Exemplo | Observação |
|---|---|---|---|
| `id` | ✔ | `ds2cd1027g2h-liu-4` | único; minúsculas, números e hífen. As cenas salvas usam o id: não troque |
| `marca` | ✔ | `Hikvision` | agrupa a lista |
| `modelo` | ✔ | `DS-2CD1027G2H-LIU` | |
| `nome` | | `Hikvision … ColorVu (4 mm)` | nome na lista; vazio = marca + modelo |
| `tipo` | ✔ | `ip`, `usb`, `industrial` | |
| `linha` | | `ColorVu`, `Value`, `Pro` | família do fabricante |

### Sensor

| Coluna | Obrig. | Exemplo | Vazio = | Efeito no simulador |
|---|---|---|---|---|
| `largura_px`, `altura_px` | ✔ | `1920`, `1080` | | resolução; MP é calculado |
| `formato_sensor` | | `1/2.8` | pixel pela lente | tamanho do pixel (diagonal ≈ 18 mm / x) |
| `pixel_um` | | `2.9` | pelo formato | substitui o formato |
| `sensor_modelo` | | `IMX327` | | exibição |
| `obturador` | | `rolling`, `global` | `rolling` | **global: sem faixas de flicker** (todas as linhas expõem juntas) |
| `leitura_ms` | | `33.3` | 1000 / `fps_max`, ou 1/30 s | rolling: tempo de leitura do quadro, define o espaçamento das faixas |
| `sat_lux_s` | | `0.21` | IMX327 | exposição que satura o pixel (lux·s no sensor): brilho |
| `capacidade_e` | | `14500` | IMX327 × área do pixel | elétrons na saturação: ruído |
| `ruido_leitura_e` | | `3` | 3 | ruído no escuro |

### Lente

| Coluna | Obrig. | Exemplo | Vazio = | Efeito |
|---|---|---|---|---|
| `lente` | ✔ | `fixa`, `varifocal`, `motorizada` | | varifocal/motorizada exigem as colunas `_tele` |
| `focal_mm` | ✔ | `2.8` | | grande angular (ou única) |
| `focal_tele_mm` | | `12` | lente fixa | |
| `hfov_graus` | ✔ | `105` | | FOV horizontal do datasheet, de borda a borda |
| `hfov_tele_graus` | | `33` | lente fixa | |
| `abertura` | ✔ | `1.6` | | número f no grande angular: brilho da imagem |
| `abertura_tele` | | `2.7` | igual à `abertura` | interpolada com o zoom |
| `distorcao` | | `-0.14` | 0, marcado estimado | k1 do modelo de divisão (barril < 0). Melhor: calibrar (`calibracao/`) |
| `foco` | | `fixo`, `auto`, `motorizado` | | exibição; foco automático precisa ser travado para calibrar |

### O que a câmera deixa configurar

O simulador **permite** qualquer ajuste, mas **avisa** quando a câmera real não tem (painel da Câmera e
indicador "Recursos da câmera"). O automático da câmera simulada respeita os limites de obturador e ganho.

| Coluna | Exemplo | Vazio = | Efeito |
|---|---|---|---|
| `exposicao_manual` | `sim` | não informado | `não` + modo manual → aviso |
| `obturador_min_s`, `obturador_max_s` | `1/100000`, `1/3` | 1/10000 e 1/30 s | limita o automático; manual fora → aviso |
| `ganho_max_db` | `30` | 36 dB | limita o automático; manual acima → aviso |
| `balanco` | `auto\|manual-k\|manual-rgb` | todos | modo de balanço fora da lista → aviso |
| `anti_cintilacao` | `sim` | não informado | `não` + anti-cintilação ligada → aviso |
| `ldc` | `sim` | não informado | `não` + distorção desligada (correção LDC) → aviso |
| `gatilho_externo` | `não` | não informado | `não` + luz pulsada sincronizada → aviso |
| `dia_noite` | `ir`, `colorvu`, `não` | não informado | `não` + preto e branco → aviso |
| `fps_max` | `30` | | tempo de leitura quando não há `leitura_ms` |
| `wdr_db`, `interface`, `protecao`, `codec` | `120`, `poe`, `IP67`, `h265\|h264` | | só exibição |

### Procedência

| Coluna | Exemplo | Observação |
|---|---|---|
| `fonte_url` | link do datasheet | vira link na aba Câmera |
| `consultado_em` | `2026-10-02` | |
| `estimados` | `hfov_graus\|abertura` | nomes de colunas; a interface mostra como "valores estimados" |
| `calibrada` | `calibracao/saida/c920.json` | calibração de `calibracao/calibrar.py`: usa a lente medida (resolução, FOV, focal, distorção) |
| `observacoes` | texto livre | aparece sob a ficha da câmera |
