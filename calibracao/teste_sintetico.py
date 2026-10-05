#!/usr/bin/env python3
"""Autoteste da calibração: fotografa o tabuleiro com uma câmera virtual de lente conhecida (barril forte,
parecida com a ColorVu 4 mm), roda calibrar.py e confere se ele recupera a lente.

    python teste_sintetico.py
"""
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

W, H = 1920, 1080
K = np.array([[1370.0, 0, 965.0], [0, 1370.0, 538.0], [0, 0, 1]])  # 4 mm / 2,92 µm
DIST = np.array([-0.33, 0.12, 0.0004, -0.0003, -0.02])
SQ = 25.0
rng = np.random.default_rng(7)


def foto(R, t):
    """Imagem do tabuleiro impresso (A4, 10 × 7 quadrados de 25 mm) na pose R, t, pela lente K + DIST."""
    u, v = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    pts = np.stack([u.ravel(), v.ravel()], 1).reshape(-1, 1, 2).astype(np.float64)
    n = cv2.undistortPoints(pts, K, DIST).reshape(-1, 2)  # direção de cada pixel
    Hm = np.column_stack([R[:, 0], R[:, 1], t])  # plano do tabuleiro → câmera
    b = np.linalg.solve(Hm, np.column_stack([n, np.ones(len(n))]).T)
    bx, by = b[0] / b[2], b[1] / b[2]  # mm no plano; (0, 0) = primeiro canto interno
    sq = ((np.floor(bx / SQ) + np.floor(by / SQ)) % 2 == 0)
    on_board = (bx >= -SQ) & (bx < 9 * SQ) & (by >= -SQ) & (by < 6 * SQ)
    on_page = (bx >= -SQ - 23) & (bx < 9 * SQ + 23) & (by >= -SQ - 10) & (by < 6 * SQ + 25)
    img = np.where(on_board & sq, 25, np.where(on_page, 235, 90)).astype(np.float32).reshape(H, W)
    img = cv2.GaussianBlur(img, (0, 0), 0.8) + rng.normal(0, 2.0, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def pose(dist_mm, ax, ay, ox, oy):
    R, _ = cv2.Rodrigues(np.array([ax, ay, rng.uniform(-0.3, 0.3)]))
    centro = np.array([4 * SQ, 2.5 * SQ, 0])  # gira em torno do meio do tabuleiro
    return R, np.array([ox, oy, dist_mm]) - R @ centro


def main():
    with tempfile.TemporaryDirectory() as tmp:
        pasta = Path(tmp) / 'sintetico'
        pasta.mkdir()
        # poses variadas cobrindo centro, bordas e cantos, com o tabuleiro inteiro na imagem (como se pede
        # nas fotos reais); posições sorteadas até achar 15 boas
        borda = np.array([[-SQ, -SQ, 0], [9 * SQ, -SQ, 0], [9 * SQ, 6 * SQ, 0], [-SQ, 6 * SQ, 0]], np.float64)
        alvos = [(-0.62, -0.5), (0.62, -0.5), (-0.62, 0.5), (0.62, 0.5), (0, 0), (0, -0.55), (0, 0.55), (-0.7, 0),
                 (0.7, 0), (-0.3, -0.3), (0.3, 0.3), (-0.35, 0.35), (0.35, -0.35), (0, 0), (0.15, 0.1)]
        for k, (ax_, ay_) in enumerate(alvos):
            for _ in range(500):
                d = rng.uniform(420, 620)
                R, t = pose(d, rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), ax_ * d * 0.8, ay_ * d * 0.45)
                q = cv2.projectPoints(borda, cv2.Rodrigues(R)[0], t, K, DIST)[0].reshape(-1, 2)
                if np.all((q[:, 0] > 10) & (q[:, 0] < W - 10) & (q[:, 1] > 10) & (q[:, 1] < H - 10)):
                    break
            cv2.imwrite(str(pasta / f'tab_{k:02d}.png'), foto(R, t))
        saida = Path(tmp) / 'r.json'
        subprocess.run([sys.executable, str(Path(__file__).with_name('calibrar.py')), str(pasta), '--nome', 'virtual',
                        '--pixel-um', '2.92', '--saida', str(saida)], check=True)
        r = json.loads(saida.read_text())

    # verdade: FOV da imagem pelas bordas, com a lente conhecida
    def ang(u, v):
        n = cv2.undistortPoints(np.array([[[u, v]]], np.float64), K, DIST)[0, 0]
        return n
    e, d_ = ang(0, K[1, 2]), ang(W, K[1, 2])
    hfov_true = math.degrees(math.atan(abs(e[0])) + math.atan(abs(d_[0])))

    falhas = []
    def confere(nome, medido, real, tol):
        ok = abs(medido - real) <= tol
        print(f'  {"ok " if ok else "FALHOU"} {nome}: medido {medido:.4f}, real {real:.4f} (±{tol})')
        if not ok:
            falhas.append(nome)

    print('Resultado:')
    confere('fx (px)', r['opencv']['fx'], K[0, 0], K[0, 0] * 0.01)
    confere('k1', r['opencv']['dist_k1_k2_p1_p2_k3'][0], DIST[0], 0.03)
    confere('FOV horizontal medido (°)', r['fov_medido_graus']['horizontal'], hfov_true, 0.5)
    confere('focal (mm)', r['simulador']['focalMm'][0], 4.0, 0.04)
    confere('erro de reprojeção (px)', r['erro_reprojecao_px'], 0, 0.5)

    # o modelo do simulador põe os raios no lugar? ângulos de 0 a ~42° na horizontal
    sim = r['simulador']
    lam, meia = sim['distortionK'], W / 2
    fpx = meia / ((1 + lam) * math.tan(math.radians(sim['hfov'][0]) / 2))
    pior = 0
    for graus in range(5, 43, 3):
        real = cv2.projectPoints(np.array([[math.tan(math.radians(graus)), 0, 1]]), np.zeros(3), np.zeros(3), K, DIST)[0][0, 0, 0] - K[0, 2]
        nu = fpx * math.tan(math.radians(graus)) / meia  # raio ideal em meias larguras
        nd = nu if abs(lam) < 1e-9 else (1 - math.sqrt(1 - 4 * lam * nu * nu)) / (2 * lam * nu)
        pior = max(pior, abs(nd * meia - real))
    confere('posição dos raios no simulador, pior caso até 42° (px)', pior, 0, 6)
    sys.exit(1 if falhas else 0)


if __name__ == '__main__':
    main()
