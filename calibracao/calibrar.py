#!/usr/bin/env python3
"""Calibra a lente de uma câmera com fotos do tabuleiro de xadrez e gera um JSON para o simulador.

Uso:
    python calibrar.py fotos/c920 --nome "Logitech C920" [--pixel-um 3.0] [--saida saida/c920.json]

Mede, a partir de ~15 fotos do tabuleiro (tabuleiro-a4.pdf, 9 × 6 cantos, quadrados de 25 mm):
  - a focal no centro, em pixels (fx, fy), e o centro óptico;
  - a distorção da lente (modelo do OpenCV: k1, k2, p1, p2, k3);
  - o campo de visão horizontal e vertical da imagem entregue (de borda a borda, já com a distorção);
  - o equivalente no modelo do simulador: λ do modelo de divisão e o FOV que, com esse λ, dá a
    mesma escala no centro (ver src/core/optics.js, lensProjection).
"""
import argparse
import datetime
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

EXTENSOES = {'.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff'}


def achar_cantos(cinza, padrao):
    """Cantos internos do tabuleiro com precisão subpixel, ou None."""
    if hasattr(cv2, 'findChessboardCornersSB'):
        ok, cantos = cv2.findChessboardCornersSB(cinza, padrao, flags=cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY)
        if ok:
            return cantos
    ok, cantos = cv2.findChessboardCorners(cinza, padrao, flags=cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE)
    if not ok:
        return None
    criterio = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 1e-4)
    return cv2.cornerSubPix(cinza, cantos, (11, 11), (-1, -1), criterio)


def tangente_ideal(K, dist, raios_px, ang=0.0):
    """Para pontos da imagem entregue a `raios_px` do centro óptico (na direção `ang`), a tangente do
    ângulo do raio de luz (o raio que teriam numa câmera sem distorção, em unidades de focal)."""
    cx, cy = K[0, 2], K[1, 2]
    pts = np.array([[[cx + r * math.cos(ang), cy + r * math.sin(ang)]] for r in raios_px], dtype=np.float64)
    und = cv2.undistortPoints(pts, K, dist)  # coordenadas normalizadas
    return np.hypot(und[:, 0, 0], und[:, 0, 1])


def ajustar_lambda(raios_d, raios_u, meia_largura):
    """λ do modelo de divisão r_u = r_d / (1 + λ (r_d / meia_largura)²) por mínimos quadrados (busca 1D)."""
    n2 = (raios_d / meia_largura) ** 2

    def erro(lam):
        den = 1 + lam * n2
        if np.any(den <= 0.05):
            return float('inf')
        return float(np.sum((raios_d / den - raios_u) ** 2))

    a, b = -0.9, 0.6
    for _ in range(200):  # seção áurea
        c1, c2 = b - (b - a) / 1.618, a + (b - a) / 1.618
        if erro(c1) < erro(c2):
            b = c2
        else:
            a = c1
    lam = (a + b) / 2
    residuo = np.abs(raios_d / (1 + lam * n2) - raios_u)
    return lam, float(residuo.max())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pasta', type=Path, help='pasta com as fotos do tabuleiro')
    ap.add_argument('--nome', default='Câmera calibrada')
    ap.add_argument('--cantos', default='9x6', help='cantos internos, colunas x linhas (padrão 9x6)')
    ap.add_argument('--quadrado', type=float, default=25.0, help='lado do quadrado impresso, mm (meça!)')
    ap.add_argument('--pixel-um', type=float, default=None, help='tamanho do pixel do sensor (µm), para a focal em mm')
    ap.add_argument('--saida', type=Path, default=None, help='JSON de saída (padrão: saida/<pasta>.json)')
    ap.add_argument('--marcar', action='store_true', help='salva as fotos com os cantos achados em saida/cantos/')
    args = ap.parse_args()

    cols, rows = (int(v) for v in args.cantos.lower().split('x'))
    padrao = (cols, rows)
    obj = np.zeros((cols * rows, 3), np.float32)
    obj[:, :2] = np.mgrid[0:cols, 0:rows].T.reshape(-1, 2) * args.quadrado

    fotos = sorted(p for p in args.pasta.iterdir() if p.suffix.lower() in EXTENSOES)
    if not fotos:
        sys.exit(f'Nenhuma foto em {args.pasta}')
    pontos_obj, pontos_img, tamanho, usadas = [], [], None, []
    for p in fotos:
        img = cv2.imread(str(p))
        if img is None:
            print(f'  {p.name}: não abriu')
            continue
        cinza = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if tamanho is None:
            tamanho = cinza.shape[::-1]
        elif cinza.shape[::-1] != tamanho:
            print(f'  {p.name}: resolução diferente ({cinza.shape[1]}×{cinza.shape[0]}), ignorada')
            continue
        cantos = achar_cantos(cinza, padrao)
        if cantos is None:
            print(f'  {p.name}: tabuleiro não encontrado')
            continue
        pontos_obj.append(obj)
        pontos_img.append(cantos)
        usadas.append(p.name)
        if args.marcar:
            pasta = (args.saida.parent if args.saida else Path('saida')) / 'cantos'
            pasta.mkdir(parents=True, exist_ok=True)
            cv2.drawChessboardCorners(img, padrao, cantos, True)
            cv2.imwrite(str(pasta / p.name), img)
    print(f'{len(usadas)} de {len(fotos)} fotos com o tabuleiro.')
    if len(usadas) < 8:
        sys.exit('Poucas fotos válidas (mínimo 8, ideal 15+). Veja calibracao/LEIA-ME.md.')

    W, H = tamanho
    rms, K, dist, rvecs, tvecs = cv2.calibrateCamera(pontos_obj, pontos_img, tamanho, None, None)
    dist = dist.ravel()
    fx, fy, cx, cy = K[0, 0], K[1, 1], K[0, 2], K[1, 2]

    # Campo de visão real da imagem entregue: ângulo dos pontos das bordas, do centro óptico
    def tan_borda(u, v):
        return cv2.undistortPoints(np.array([[[u, v]]], np.float64), K, dist)[0, 0]
    esq, dir_ = tan_borda(0, cy), tan_borda(W, cy)
    cima, baixo = tan_borda(cx, 0), tan_borda(cx, H)
    hfov = math.degrees(math.atan(abs(esq[0])) + math.atan(abs(dir_[0])))
    vfov = math.degrees(math.atan(abs(cima[1])) + math.atan(abs(baixo[1])))

    # Equivalente no simulador: λ (modelo de divisão, raio em meias larguras) ajustado do centro aos cantos,
    # em várias direções; e o FOV que, com esse λ, reproduz a focal medida no centro.
    meia = W / 2
    canto = math.hypot(W, H) / 2
    raios = np.linspace(canto * 0.05, canto * 0.98, 40)
    rd, ru = [], []
    for ang in np.linspace(0, 2 * math.pi, 16, endpoint=False):
        # só os raios que caem dentro da imagem nessa direção
        lim = min(abs((W - cx if math.cos(ang) >= 0 else cx) / (math.cos(ang) or 1e-9)),
                  abs((H - cy if math.sin(ang) >= 0 else cy) / (math.sin(ang) or 1e-9)))
        r_ok = raios[raios <= lim]
        if len(r_ok):
            rd.extend(r_ok)
            ru.extend(tangente_ideal(K, dist, r_ok, ang))
    f_media = math.sqrt(fx * fy)  # o simulador usa pixel quadrado
    rd, ru = np.array(rd), np.array(ru) * f_media
    lam, residuo = ajustar_lambda(rd, ru, meia)
    hfov_sim = math.degrees(2 * math.atan(meia / ((1 + lam) * f_media)))

    resultado = {
        'tipo': 'calibracao-vision-sim',
        'versao': 1,
        'camera': args.nome,
        'data': datetime.date.today().isoformat(),
        'fotos': usadas,
        'resolucao': [W, H],
        'erro_reprojecao_px': round(float(rms), 3),
        'opencv': {'fx': fx, 'fy': fy, 'cx': cx, 'cy': cy, 'dist_k1_k2_p1_p2_k3': [float(v) for v in dist[:5]]},
        'fov_medido_graus': {'horizontal': round(hfov, 2), 'vertical': round(vfov, 2)},
        'centro_optico_desvio_px': [round(cx - W / 2, 1), round(cy - H / 2, 1)],
        'simulador': {
            'widthPx': W,
            'heightPx': H,
            'hfov': [round(hfov_sim, 2)],
            'distortionK': round(lam, 4),
            'focalMm': [round(f_media * args.pixel_um / 1000, 3)] if args.pixel_um else None,
            'erro_modelo_px': round(residuo, 2),
        },
    }
    saida = args.saida or Path('saida') / f'{args.pasta.name}.json'
    saida.parent.mkdir(parents=True, exist_ok=True)
    saida.write_text(json.dumps(resultado, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'Erro de reprojeção: {rms:.3f} px {"(bom)" if rms < 0.5 else "(alto: refaça com fotos mais nítidas)" if rms > 1 else ""}')
    print(f'Focal no centro: fx {fx:.1f} px, fy {fy:.1f} px · centro óptico desviado {cx - W / 2:+.1f}, {cy - H / 2:+.1f} px')
    print(f'FOV medido: {hfov:.1f}° × {vfov:.1f}°')
    print(f'Simulador: FOV {hfov_sim:.2f}°, distorção λ = {lam:.4f} (erro do modelo até {residuo:.2f} px)')
    print(f'Salvo em {saida}: no simulador, aba Câmera → "Importar calibração…".')


if __name__ == '__main__':
    main()
