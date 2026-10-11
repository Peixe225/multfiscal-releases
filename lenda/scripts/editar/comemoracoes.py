"""Acha as comemorações (tela de título dourada) e os rebaixamentos (tela vermelha) de uma gravação bruta.

    python3 scripts/editar/comemoracoes.py pasta-das-gravacoes v-intenso-01 [v-intenso-02 ...]

Escreve pasta-das-gravacoes/_ouro-<nome>.json = {"ouro": [[inicio, fim, pico], ...], "vermelho": [...]}, em segundos.
A comemoração deixa o centro da tela claro (~70–80 de luminância média) contra ~35 no resto do jogo.
Usa o ffmpeg do PATH ou o de LENDA_FFMPEG.
"""
import json, os, subprocess, sys
import numpy as np

FF = os.environ.get('LENDA_FFMPEG', 'ffmpeg')


def serie(mp4, fps=10, w=108, h=192):
    raw = subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-i', mp4, '-vf', f'fps={fps},scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3).astype(np.int16)
    c = a[:, int(h * .28):int(h * .72), int(w * .1):int(w * .9)]
    R, G, B = c[..., 0], c[..., 1], c[..., 2]
    return ((R + G + B) / 3).mean(axis=(1, 2)), ((R > 150) & (G < 80) & (B < 90)).mean(axis=(1, 2))


def janelas(score, lim, minlen, fps=10):
    on = score > lim; out = []; i = 0
    while i < len(on):
        if on[i]:
            j = i
            while j < len(on) and on[j]: j += 1
            if (j - i) / fps >= minlen: out.append((round(i / fps, 1), round(j / fps, 1), round(float(score[i:j].max()), 3)))
            i = j
        else: i += 1
    return out


if __name__ == '__main__':
    pasta = sys.argv[1]
    for nome in sys.argv[2:]:
        lum, red = serie(os.path.join(pasta, f'{nome}.mp4'))
        res = {'ouro': janelas(lum, 58, 1.0), 'vermelho': janelas(red, 0.08, 0.6)}
        json.dump(res, open(os.path.join(pasta, f'_ouro-{nome}.json'), 'w'))
        print(nome, len(res['ouro']), 'comemorações,', len(res['vermelho']), 'telas vermelhas')
