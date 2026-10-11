"""
Trilha original e efeitos sonoros para os criativos (sintetizados aqui: sem direito autoral de terceiros).

    python3 trilha.py plano.json saida_musica.wav saida_efeitos.wav

plano.json: {"dur": 34.0, "bpm": 124, "estilo": "hype"|"epico"|"leve", "drop": 6.0, "fim": 30.0,
             "efeitos": [{"t": 2.0, "tipo": "whoosh"|"impacto"|"ding"|"riser"|"tick"|"pop", "nivel": 1, "nota": 0}]}
- drop: instante (s) em que a batida completa entra (ajustado ao compasso); antes dele, intro com pads e arpejo.
- fim: a partir daqui a música só sustenta e some (para o cartão final).
- ding: "nota" sobe a altura (para a contagem das Bolas de Ouro soar subindo).
"""
import json, sys
import numpy as np
from scipy.signal import butter, sosfilt, sawtooth, fftconvolve

SR = 44100
rng = np.random.default_rng(7)

def env(n, a=0.005, r=0.2):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / max(r, 1e-4))
    return e

def lp(x, f, o=2):
    return sosfilt(butter(o, min(f, SR / 2 - 100) / (SR / 2), 'low', output='sos'), x)
def hp(x, f, o=2):
    return sosfilt(butter(o, f / (SR / 2), 'high', output='sos'), x)
def bp(x, lo, hi, o=2):
    return sosfilt(butter(o, [lo / (SR / 2), min(hi, SR / 2 - 100) / (SR / 2)], 'band', output='sos'), x)

def kick(dur=0.45):
    n = int(SR * dur); t = np.arange(n) / SR
    f = 46 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.exp(-t * 7.5)
    click = hp(rng.standard_normal(n), 2500) * np.exp(-t * 300) * 0.25
    return np.tanh((x + click) * 1.6) * 0.95

def clap(dur=0.35):
    n = int(SR * dur); t = np.arange(n) / SR
    nz = bp(rng.standard_normal(n), 900, 4200)
    e = np.zeros(n)
    for d in (0, 0.011, 0.022):
        k = int(d * SR); e[k:] += np.exp(-(t[: n - k]) * 38)
    tail = np.exp(-t * 9) * 0.35
    return nz * (e * 0.6 + tail) * 0.55

def hat(dur=0.06, open_=False):
    n = int(SR * (0.32 if open_ else dur)); t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7500, 4) * np.exp(-t * (9 if open_ else 70)) * (0.2 if open_ else 0.16)

def note_f(semi):  # semitons a partir de A4 = 440
    return 440.0 * 2 ** (semi / 12)

def saw_voice(f, n, det=(0, 0.11, -0.13)):
    t = np.arange(n) / SR
    return sum(sawtooth(2 * np.pi * f * (1 + d / 100) * t + rng.random() * 6) for d in det) / len(det)

def reverb(x, secs=2.2, mix=0.25):
    n = int(SR * secs); t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * 3.2)
    ir = lp(ir, 6000); ir /= np.sqrt(np.sum(ir ** 2))
    wet = fftconvolve(x, ir)[: len(x)]
    return x * (1 - mix) + wet * mix

# progressões (semitons relativos a A): i – VI – III – VII em lá menor
PROG = {'hype': [(-12, [0, 3, 7]), (-16, [-4, 0, 3]), (-21, [-9, -5, -2]), (-14, [-2, 2, 5])],
        'epico': [(-12, [0, 3, 7]), (-16, [-4, 0, 3]), (-21, [-9, -5, -2]), (-14, [-2, 2, 5])],
        'leve': [(-16, [-4, 0, 3, 7]), (-14, [-2, 2, 5, 9]), (-12, [0, 3, 7, 10]), (-19, [-7, -3, 0, 4])]}

def musica(dur, bpm, estilo, drop, fim):
    beat = 60 / bpm; bar = beat * 4
    N = int(SR * (dur + 2.5))
    mix = {k: np.zeros(N) for k in ('drums', 'bass', 'pad', 'arp', 'fx')}
    prog = PROG[estilo]
    nbars = int(np.ceil((dur + 1) / bar))
    drop_bar = int(round(drop / bar)) if drop is not None else 0
    fim_t = fim if fim is not None else dur
    def put(track, x, t0, g=1.0):
        i = int(t0 * SR)
        if i >= N: return
        j = min(N, i + len(x)); mix[track][i:j] += x[: j - i] * g
    kick_s, clap_s, hat_s, ohat_s = kick(), clap(), hat(), hat(open_=True)
    for b in range(nbars):
        t0 = b * bar
        if t0 > dur + 1: break
        root, chord = prog[b % len(prog)]
        after = b >= drop_bar
        ending = t0 >= fim_t
        # pad (acorde inteiro do compasso)
        n = int(bar * SR)
        pad = sum(saw_voice(note_f(c), n) for c in chord) / len(chord)
        cut = 900 if not after else (2600 if estilo != 'leve' else 1400)
        if ending: cut = 700
        pad = lp(pad, cut, 2) * env(n, a=0.25 if not after else 0.04, r=bar * 1.4)
        put('pad', pad, t0, (0.32 if after else 0.62) if estilo != 'leve' else 0.45)
        # arpejo em semicolcheias
        step = beat / 4 if estilo != 'leve' else beat / 2
        notes = [c + 12 for c in chord] + [c + 24 for c in chord]
        for k in range(int(round(bar / step))):
            f = note_f(notes[k % len(notes)])
            m = int(step * SR * 1.6)
            v = lp(saw_voice(f, m, (0, 0.07)), 3200 if after else 1800) * env(m, a=0.002, r=0.12)
            put('arp', v, t0 + k * step, (0.16 if after else 0.22) * (0.5 if ending else 1))
        # baixo (sub) com "sidechain" nos tempos
        if after and not ending:
            for q in range(4):
                m = int(beat * SR)
                tt = np.arange(m) / SR
                f = note_f(root - 12)
                v = np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(4 * np.pi * f * tt)
                duck = 1 - 0.85 * np.exp(-tt * 14)
                put('bass', np.tanh(v * 1.3) * duck * env(m, a=0.01, r=beat * 2), t0 + q * beat, 0.42)
        # bateria
        if after and not ending:
            for q in range(4):
                tq = t0 + q * beat
                if estilo == 'epico':
                    if q in (0, 2): put('drums', kick_s, tq, 1.0)
                    if q == 2: put('drums', clap_s, tq, 1.1)
                    for h in range(2): put('drums', hat_s, tq + h * beat / 2, 0.7)
                elif estilo == 'leve':
                    if q in (0, 2): put('drums', kick_s, tq, 0.8)
                    if q in (1, 3): put('drums', clap_s, tq, 0.6)
                    for h in range(2): put('drums', hat_s, tq + h * beat / 2, 0.5)
                else:  # hype: 4 no chão
                    put('drums', kick_s, tq, 1.0)
                    if q in (1, 3): put('drums', clap_s, tq, 1.0)
                    put('drums', hat_s, tq + beat / 2, 0.9)
                    if q == 3: put('drums', ohat_s, tq + beat / 2, 0.8)
        elif not after and b >= drop_bar - 1 and drop_bar > 0:
            # compasso antes do drop: virada de caixa acelerando + riser
            for k in range(16):
                put('drums', clap_s * (0.25 + 0.75 * k / 15), t0 + k * bar / 16, 0.55)
        elif not after and estilo != 'leve':
            # intro com pulso (o gancho dos 2 primeiros segundos não pode ser silêncio)
            for q in range(4):
                if q in (0, 2): put('drums', kick_s, t0 + q * beat, 0.45)
                put('drums', hat_s, t0 + q * beat + beat / 2, 0.55)
    # riser antes do drop
    if drop_bar > 0:
        rs = riser(bar)
        put('fx', rs, drop_bar * bar - bar, 0.55)
        put('fx', impacto(), drop_bar * bar, 0.8)
    out = (reverb(mix['pad'], 2.6, 0.35) + reverb(mix['arp'], 1.6, 0.25) + mix['bass'] + reverb(mix['drums'], 0.9, 0.08) + mix['fx'])
    # fade final
    t = np.arange(N) / SR
    fade = np.clip((dur + 0.2 - t) / 1.6, 0, 1)
    out = out * fade
    out = out[: int(SR * dur)]
    return out

def riser(d=2.0):
    n = int(SR * d); t = np.arange(n) / SR
    nz = rng.standard_normal(n)
    # varre um passa-faixa subindo, em blocos
    outs = np.zeros(n); blk = 2048
    for i in range(0, n, blk):
        frac = i / n
        lo = 300 + 5000 * frac ** 2; hi = lo * 2.2
        outs[i:i + blk] = bp(nz[i:i + blk + 0], lo, min(hi, 18000), 1)[: len(outs[i:i + blk])]
    sw = np.sin(2 * np.pi * np.cumsum(200 + 1200 * (t / d) ** 2) / SR) * 0.15
    return (outs * 0.6 + sw) * (t / d) ** 1.5

def impacto():
    n = int(SR * 1.6); t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t * 18)) / SR) * np.exp(-t * 2.6)
    nz = lp(rng.standard_normal(n), 3000) * np.exp(-t * 7) * 0.5
    return np.tanh((boom + nz) * 1.4) * 0.9

def whoosh(d=0.42):
    n = int(SR * d); t = np.arange(n) / SR
    nz = rng.standard_normal(n); out = np.zeros(n); blk = 1024
    for i in range(0, n, blk):
        frac = i / n
        c = 400 + 4000 * np.sin(np.pi * frac)
        out[i:i + blk] = bp(nz[i:i + blk], c * 0.6, c * 1.6, 1)[: len(out[i:i + blk])]
    return out * np.sin(np.pi * t / d) ** 2 * 0.7

def ding(nota=0):
    n = int(SR * 1.8); t = np.arange(n) / SR
    f = 1046.5 * 2 ** (nota / 12)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t * 3) + 0.5 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 6)
         + 0.25 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 9) + 0.4 * np.sin(2 * np.pi * f / 2 * t) * np.exp(-t * 4))
    return reverb(x * 0.35, 1.8, 0.3)

def tick():
    n = int(SR * 0.05); t = np.arange(n) / SR
    return hp(rng.standard_normal(n), 3000) * np.exp(-t * 160) * 0.5

def pop():
    n = int(SR * 0.12); t = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(300 + 900 * np.exp(-t * 40)) / SR) * np.exp(-t * 30) * 0.5

EFEITO = {'whoosh': whoosh, 'impacto': impacto, 'riser': riser, 'tick': tick, 'pop': pop}

def efeitos(dur, lista):
    N = int(SR * (dur + 2)); out = np.zeros(N)
    for e in lista:
        tipo = e['tipo']
        x = ding(e.get('nota', 0)) if tipo == 'ding' else EFEITO[tipo]()
        # o riser termina no instante pedido (sobe até o momento)
        t0 = e['t'] - (len(x) / SR if tipo == 'riser' else 0)
        i = max(0, int(t0 * SR)); j = min(N, i + len(x))
        out[i:j] += x[: j - i] * e.get('nivel', 1.0)
    return out[: int(SR * dur)]

def salvar(path, x):
    import wave
    x = x / max(1e-9, np.max(np.abs(x))) * 0.89
    st = np.stack([x, x], axis=1)
    pcm = (st * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

if __name__ == '__main__':
    plano = json.load(open(sys.argv[1]))
    dur = plano['dur']
    m = musica(dur, plano.get('bpm', 124), plano.get('estilo', 'hype'), plano.get('drop'), plano.get('fim'))
    fx = efeitos(dur, plano.get('efeitos', []))
    # música mais baixa que os efeitos de impacto; normalização final de loudness fica com o ffmpeg
    salvar(sys.argv[2], m * 0.8 + fx * 0.9)
    salvar(sys.argv[3], fx if np.any(fx) else np.zeros_like(fx) + 1e-9)
    print('ok', dur)
