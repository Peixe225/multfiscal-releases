"""Gera os roteiros (EDL) dos criativos a partir das gravações brutas, das marcas e das comemorações.

    python3 scripts/editar/comemoracoes.py pasta-das-gravacoes v-intenso-01 v-intenso-02
    python3 scripts/editar/roteiros.py pasta-das-gravacoes

Lê <pasta>/_catalogo.json (scripts/gravar/catalogo.mjs), <pasta>/<gravação>.json (marcas) e <pasta>/_ouro-*.json;
escreve scripts/editar/roteiros/<criativo>.json, que o montar.mjs transforma em vídeo. Os tempos fixos abaixo
(ex.: 149.0 = cartas de transferência) foram conferidos quadro a quadro nas gravações desta pasta.
"""
import json, os, sys
B = sys.argv[1] if len(sys.argv) > 1 else 'saida'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'roteiros')
win = lambda n: [w[0] for w in json.load(open(f'{B}/_ouro-{n}.json'))['ouro'] if w[0] > 10]
W1 = win('v-intenso-01')   # VAN RIJN: p10..p24
W2 = win('v-intenso-02')   # CORDEIRO
# VAN RIJN: Bolas de Ouro nas temporadas (period) 10–20 e 22 → janelas na ordem p10..p24
VR = dict(zip(range(10, 10 + len(W1)), W1))
# CORDEIRO: janelas p10..p22 e p24 (p23 não acendeu)
CO = dict(zip([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24], W2))
CTA_SUB = 'Sua carreira. *Suas decisões.*'

class Ed:
    def __init__(s, nome, bpm, estilo):
        s.r = {'nome': nome, 'bpm': bpm, 'estilo': estilo, 'cenas': [], 'textos': [], 'efeitos': []}
        s.t = 0.0
    def cena(s, src, de, dur, vel=1.0, zoom=(1, 1), foco=(0.5, 0.5)):
        s.r['cenas'].append({'src': src, 'de': round(de, 2), 'ate': round(de + dur * vel, 2), 'vel': vel, 'zoom': list(zoom), 'foco': list(foco)})
        t0 = s.t; s.t = round(s.t + dur, 3); return t0
    def txt(s, de, ate, tipo, **k):
        s.r['textos'].append({'de': round(de, 3), 'ate': round(ate, 3), 'tipo': tipo, **k})
    def fx(s, t, tipo, **k):
        s.r['efeitos'].append({'t': round(t, 3), 'tipo': tipo, **k})
    def salvar(s, drop, fim):
        s.r['drop'] = drop; s.r['fim'] = fim
        json.dump(s.r, open(f"{OUT}/{s.r['nome']}.json", 'w'), ensure_ascii=False, indent=1)
        print(s.r['nome'], round(s.t, 1), 's')

# ───────────────────────── C1 · Como funciona ─────────────────────────
e = Ed('c1-como-funciona', 120, 'hype'); b = 0.5
t = e.cena('v-intenso-01.mp4', VR[17] + 0.4, 2.0, zoom=(1.0, 1.12), foco=(0.5, 0.45))
e.txt(0, 2.0, 'gancho', texto='Você decide *tudo*.\nDa base à *Bola de Ouro*.', anim='pop')
t = e.cena('v-intenso-01.mp4', 17.6, 2.0, vel=2.0, zoom=(1.28, 1.32), foco=(0.5, 0.22)); e.fx(t, 'whoosh')
e.txt(t + 0.05, t + 2.0, 'legenda', texto='*1.* Crie o seu jogador')
t = e.cena('v-intenso-01.mp4', 28.9, 2.0, vel=1.1, zoom=(1.2, 1.24), foco=(0.5, 0.82)); e.fx(t, 'whoosh', nivel=0.6)
e.txt(t + 0.05, t + 2.0, 'legenda', texto='*2.* Escolha onde começar', y=520)
t = e.cena('v-intenso-01.mp4', 89.9, 2.0, vel=1.05, zoom=(1.22, 1.26), foco=(0.5, 0.42))
t2 = e.cena('v-intenso-01.mp4', VR[10] + 0.15, 2.0, zoom=(1.0, 1.1), foco=(0.5, 0.45))
e.txt(t + 0.05, t2 + 2.0, 'legenda', texto='*3.* Cada decisão\nmuda a sua história', y=1180)
e.fx(t2 + 0.3, 'ding', nota=0, nivel=0.7)
t = e.cena('v-intenso-01.mp4', 149.0, 2.0, vel=0.75, zoom=(1.15, 1.2), foco=(0.5, 0.58)); e.fx(t, 'whoosh')
e.txt(t, t + 2.0, 'chips', itens=['Clássico', 'Imersivo', 'Live'], ativo=0, anim='corte', y=1250)
e.txt(t, t + 6.0, 'gancho', texto='*3 modos* de jogar', tam=96, y=250, anim='sobe')
t = e.cena('v-imersivo-02.mp4', 4.7, 2.0, zoom=(1.2, 1.26), foco=(0.5, 0.2)); e.fx(t + 1.25, 'impacto', nivel=0.6)
e.txt(t, t + 2.0, 'chips', itens=['Clássico', 'Imersivo', 'Live'], ativo=1, anim='corte', y=1250)
t = e.cena('v-live-04.mp4', 24.0, 2.0, zoom=(1.3, 1.34), foco=(0.5, 0.16))
e.txt(t, t + 2.0, 'chips', itens=['Clássico', 'Imersivo', 'Live'], ativo=2, anim='corte', y=1250)
e.txt(t, t + 2.0, 'selo', texto='SIMULAÇÃO DA LIVE', anim='corte', y=1150)
t = e.cena('v-intenso-01.mp4', 176.0, 2.0, vel=4.0, zoom=(1.1, 1.1), foco=(0.5, 0.5)); e.fx(t, 'whoosh')
for k in range(3):
    e.txt(t + k * 0.667, t + (k + 1) * 0.667, 'chips', itens=['Intenso', 'Normal', 'Expresso'], ativo=k, anim='corte', y=1250)
    e.fx(t + k * 0.667, 'tick')
e.txt(t, t + 2.0, 'legenda', texto='Uma decisão por temporada…\nou a cada três', y=1060, escuro=True)
# Bolas de Ouro em sequência (6 cortes de 1 s)
t0 = e.t
for k, p in enumerate([11, 12, 13, 14, 15, 16]):
    t = e.cena('v-intenso-01.mp4', VR[p] + 0.55, 1.0, zoom=(1.0, 1.08) if k % 2 == 0 else (1.08, 1.0), foco=(0.5, 0.45))
    e.txt(t, t + 1.0, 'contador', numero=str(2037 + k), rotulo='Bola de Ouro', tam=230, anim='pop', y=200)
    e.fx(t + 0.05, 'ding', nota=[0, 2, 4, 5, 7, 9][k], nivel=0.8)
t = e.cena('v-intenso-01.mp4', 343.3, 3.0, zoom=(1.0, 1.22), foco=(0.5, 0.78)); e.fx(t, 'impacto')
t = e.cena('v-intenso-01.mp4', 348.6, 3.0, zoom=(1.42, 1.5), foco=(0.15, 0.27)); e.fx(t + 0.2, 'ding', nota=12)
e.txt(t + 0.2, t + 3.0, 'legenda', texto='Nota de Legado: *93 · Imortal*', y=1150)
t = e.cena('v-hall-01.mp4', 20.6, 2.0, zoom=(1.3, 1.34), foco=(0.5, 0.3))
e.txt(t, t + 2.0, 'legenda', texto='Compare com *50 lendas reais*', y=1180)
t = e.cena('v-intenso-01.mp4', 355.0, 4.0, vel=0.625); e.fx(t, 'whoosh')
e.txt(t, t + 4.0, 'cta', texto=CTA_SUB, anim='fade')
e.salvar(drop=2.0, fim=e.t - 3.5)

# ───────────────────────── C2 · 11 Bolas de Ouro seguidas (VAN RIJN) ─────────────────────────
e = Ed('c2-bolas-de-ouro-seguidas', 100, 'epico'); b = 0.6
t = e.cena('v-intenso-01.mp4', 49.4, 2.4, zoom=(1.0, 1.1), foco=(0.5, 0.45)); e.fx(0.15, 'impacto', nivel=0.7)
e.txt(0, 2.4, 'gancho', texto='Rebaixado\naos *18 anos*…', anim='pop', y=300)
t = e.cena('v-intenso-01.mp4', 89.9, 2.4, zoom=(1.2, 1.26), foco=(0.5, 0.42)); e.fx(t, 'whoosh')
e.txt(t, t + 2.4, 'legenda', texto='…até escolher\no *Barcelona*', y=1180)
t = e.cena('v-intenso-01.mp4', 93.0, 2.4, vel=3.3, zoom=(1.08, 1.08)); e.fx(t + 2.4, 'riser', nivel=0.9)
e.txt(t, t + 2.4, 'legenda', texto='Dois anos depois…', y=1180, escuro=True)
for k, p in enumerate(range(10, 21)):
    t = e.cena('v-intenso-01.mp4', VR[p] + 0.45, 1.2, zoom=(1.0, 1.08) if k % 2 == 0 else (1.08, 1.0), foco=(0.5, 0.45))
    rot = 'Bola de Ouro' if k == 0 else ('+ *Copa do Mundo*' if p == 12 else 'Bolas de Ouro seguidas')
    e.txt(t, t + 1.2, 'contador', numero=str(k + 1), prefixo='×', rotulo=rot, anim='pop', y=200)
    e.fx(t + 0.04, 'ding', nota=[0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17][k], nivel=0.85)
    if k == 0: e.txt(t, t + 0.12, 'flash', anim='corte'); e.fx(t, 'impacto')
t = e.cena('v-intenso-01.mp4', VR[22] + 0.3, 2.4, zoom=(1.0, 1.1), foco=(0.5, 0.45)); e.fx(t + 0.05, 'ding', nota=19)
e.txt(t, t + 2.4, 'contador', numero='12', prefixo='×', rotulo='e mais uma *aos 37*', anim='pop', y=200)
t = e.cena('v-intenso-01.mp4', 343.3, 3.0, zoom=(1.0, 1.22), foco=(0.5, 0.78)); e.fx(t, 'impacto')
e.txt(t + 0.4, t + 3.0, 'legenda', texto='794 gols:\n*mais que o Pelé*', y=210)
t = e.cena('v-intenso-01.mp4', 348.6, 3.6, zoom=(1.42, 1.5), foco=(0.15, 0.27)); e.fx(t + 0.2, 'ding', nota=12)
e.txt(t + 0.3, t + 3.6, 'nota', nota='93', tier='Imortal', anim='pop', y=980)
t = e.cena('v-intenso-01.mp4', 355.0, 3.6, vel=0.7); e.fx(t, 'whoosh')
e.txt(t, t + 3.6, 'cta', texto='E a *sua* carreira,\nvai até onde?', anim='fade')
e.salvar(drop=7.2, fim=e.t - 3.2)

# ───────────────────────── C3 · Qual nota você tiraria ─────────────────────────
e = Ed('c3-qual-nota-voce-tiraria', 92, 'hype'); bar = 4 * 60 / 92
t = e.cena('v-hall-01.mp4', 1.4, bar, zoom=(1.22, 1.3), foco=(0.5, 0.3))
e.txt(0, bar, 'gancho', texto='Qual *nota* a sua\ncarreira tiraria?', anim='pop', y=1150)
NOTAS = [('v-pessima-01.mp4', 86.0, '*5* · Promessa\nUm clube só. Zero títulos.'),
         ('v-ruim-03.mp4', 87.8, '*14* · Promessa\nParou aos 37 na Austrália'),
         ('v-mediana-03.mp4', 136.8, '*33* · Profissional\n117 gols e muita assistência'),
         ('v-boa-03.mp4', 118.0, '*51* · Ídolo\nLateral campeão em 4 países'),
         ('v-otima-04.mp4', 145.2, '*67* · Craque\nDeu o *hexa* pro Brasil'),
         ('v-extraordinaria-03.mp4', 143.5, '*85* · Lenda\n3 Bolas de Ouro + Copa'),
         ('v-intenso-01.mp4', 348.6, '*93* · IMORTAL\n12 Bolas de Ouro')]
for k, (src, tn, linha) in enumerate(NOTAS):
    last = k == len(NOTAS) - 1
    t = e.cena(src, tn + 0.15, bar * (1.5 if last else 1), zoom=(1.45, 1.52), foco=(0.15, 0.27))
    e.txt(t + 0.05, t + bar * (1.5 if last else 1), 'legenda', texto=linha, y=1100, escuro=True, anim='pop')
    e.fx(t, 'whoosh', nivel=0.5)
    e.fx(t + 0.1, 'ding', nota=[0, 2, 4, 7, 9, 12, 16][k], nivel=0.6 + 0.05 * k)
    if last: e.txt(t, t + 0.12, 'flash', anim='corte'); e.fx(t, 'impacto')
t = e.cena('v-intenso-01.mp4', 355.0, 3.6, vel=0.7)
e.txt(t, t + 3.6, 'cta', texto='Descubra a *sua*\nNota de Legado', anim='fade')
e.salvar(drop=bar, fim=e.t - 3.2)

# ───────────────────────── C4 · O chat decide (live) ─────────────────────────
e = Ed('c4-o-chat-decide', 124, 'hype'); bar = 4 * 60 / 124
t = e.cena('v-live-04.mp4', 3.0, bar * 1.5, vel=2.0, zoom=(1.32, 1.36), foco=(0.5, 0.14))
e.txt(0, bar * 1.5, 'gancho', texto='E se o *CHAT*\ndecidisse a carreira\ninteira?', anim='pop', y=1080, tam=100)
t = e.cena('v-live-04.mp4', 11.6, bar * 1.5, vel=1.5, zoom=(1.32, 1.36), foco=(0.5, 0.14)); e.fx(t, 'whoosh')
e.txt(t, t + bar * 1.5, 'legenda', texto='Quem doa mais\n*cria o jogador*', y=1150)
t = e.cena('v-live-04.mp4', 17.6, bar * 1.5, zoom=(1.0, 1.15), foco=(0.5, 0.12)); e.fx(t, 'impacto')
e.txt(t + 0.2, t + bar * 1.5, 'legenda', texto='Nasce uma lenda', y=1150, escuro=True)
t = e.cena('v-live-04.mp4', 24.0, bar * 2, vel=1.8, zoom=(1.3, 1.34), foco=(0.5, 0.17)); e.fx(t, 'whoosh')
e.txt(t, t + bar * 2, 'legenda', texto='Comente *1, 2, 3 ou 4*\nou mande uma rosa (10 votos)', y=1180)
t = e.cena('v-live-04.mp4', 32.6, bar, zoom=(1.3, 1.34), foco=(0.5, 0.17)); e.fx(t, 'pop')
e.txt(t, t + bar, 'legenda', texto='*O chat decidiu!*', y=1180)
t = e.cena('v-live-04.mp4', 51.4, bar, zoom=(1.05, 1.15), foco=(0.5, 0.35)); e.fx(t, 'impacto', nivel=0.7)
e.txt(t, t + bar, 'legenda', texto='Rebaixou? *Culpa do chat.*', y=1180, escuro=True)
t = e.cena('v-live-04.mp4', 99.9, bar * 1.5, zoom=(1.0, 1.1), foco=(0.5, 0.42)); e.fx(t + 0.1, 'ding', nota=7)
e.txt(t, t + bar * 1.5, 'legenda', texto='Título também.', y=330)
t = e.cena('v-live-04.mp4', 149.3, bar * 1.5, zoom=(1.3, 1.34), foco=(0.5, 0.26))
e.txt(t, t + bar * 1.5, 'legenda', texto='No fim, os maiores\napoiadores *na tela*', y=1180)
e.txt(0, e.t, 'selo', texto='SIMULAÇÃO DA LIVE', anim='corte', y=210)
t = e.cena('v-live-04.mp4', 154.0, bar * 2, vel=0.8); e.fx(t, 'whoosh')
e.txt(t, t + bar * 2, 'cta', texto='*Live interativa*\naqui no perfil', rodape='Siga pra jogar com a gente', anim='fade')
e.salvar(drop=bar * 1.5, fim=e.t - bar * 2)

# ───────────────────────── C5 · Brasileiro Imortal (CORDEIRO) ─────────────────────────
e = Ed('c5-brasileiro-imortal', 116, 'epico'); b = 60 / 116; bar = 4 * b
t = e.cena('v-intenso-02.mp4', CO[24] + 0.5, bar, zoom=(1.0, 1.1), foco=(0.5, 0.45)); e.fx(0.1, 'impacto', nivel=0.8)
e.txt(0, bar, 'gancho', texto='Campeão do mundo\n*aos 39 anos*', anim='pop', y=230)
t = e.cena('v-intenso-02.mp4', 30.4, bar, zoom=(1.2, 1.24), foco=(0.5, 0.8)); e.fx(t, 'whoosh')
e.txt(t, t + bar, 'legenda', texto='Tudo começou\nna base do *Náutico*', y=520)
t = e.cena('v-intenso-02.mp4', 38.0, bar, vel=8.0, zoom=(1.1, 1.1)); e.fx(t, 'whoosh', nivel=0.6)
e.txt(t, t + bar, 'legenda', texto='Ponte Preta. Operário.\nNovorizontino.', y=1180, escuro=True)
t = e.cena('v-intenso-02.mp4', 102.3, bar, vel=0.5, zoom=(1.2, 1.26), foco=(0.5, 0.8))
e.txt(t, t + bar, 'legenda', texto='Até a Europa\n*bater na porta*', y=1180)
t = e.cena('v-intenso-02.mp4', 114.9, bar, vel=0.6, zoom=(1.2, 1.26), foco=(0.5, 0.62)); e.fx(t + bar, 'riser', nivel=0.8)
e.txt(t, t + bar, 'legenda', texto='*Barcelona.*', y=1180)
for k, p in enumerate([11, 13, 15, 16, 17, 18, 19, 20, 21]):
    t = e.cena('v-intenso-02.mp4', CO[p] + 0.5, 2 * b, zoom=(1.0, 1.08) if k % 2 == 0 else (1.08, 1.0), foco=(0.5, 0.45))
    e.txt(t, t + 2 * b, 'contador', numero=str(k + 1), prefixo='×', rotulo='Bola de Ouro' if k == 0 else 'Bolas de Ouro', anim='pop', y=200)
    e.fx(t + 0.04, 'ding', nota=[0, 2, 4, 5, 7, 9, 11, 12, 14][k], nivel=0.85)
    if k == 0: e.txt(t, t + 0.12, 'flash', anim='corte'); e.fx(t, 'impacto')
t = e.cena('v-intenso-02.mp4', CO[24] + 0.4, bar * 1.5, zoom=(1.0, 1.12), foco=(0.5, 0.45)); e.fx(t, 'impacto'); e.fx(t + 0.1, 'ding', nota=16)
e.txt(t, t + 0.12, 'flash', anim='corte')
e.txt(t, t + bar * 1.5, 'contador', numero='10', prefixo='×', rotulo='+ *Copa do Mundo* aos 39', anim='pop', y=200)
t = e.cena('v-intenso-02.mp4', 341.1, bar * 1.5, zoom=(1.42, 1.5), foco=(0.15, 0.27)); e.fx(t + 0.2, 'ding', nota=12)
e.txt(t + 0.3, t + bar * 1.5, 'nota', nota='92', tier='Imortal', anim='pop', y=980)
t = e.cena('v-intenso-02.mp4', 347.6, bar * 1.7, vel=0.6); e.fx(t, 'whoosh')
e.txt(t, t + bar * 1.7, 'cta', texto='Crie o *seu* craque', anim='fade')
e.salvar(drop=5 * bar, fim=e.t - bar * 1.5)

# ───────────────────────── C6 · Entre em campo (Imersivo) ─────────────────────────
e = Ed('c6-entre-em-campo', 120, 'hype'); bar = 2.0
t = e.cena('v-imersivo-02.mp4', 5.2, bar, zoom=(1.2, 1.28), foco=(0.5, 0.2)); e.fx(0.8, 'impacto', nivel=0.8)
e.txt(0, bar, 'gancho', texto='Aqui você\n*entra em campo*', anim='pop', y=1150)
t = e.cena('v-imersivo-02.mp4', 0.1, bar * 1.25, zoom=(1.25, 1.3), foco=(0.5, 0.55)); e.fx(t, 'whoosh')
e.txt(t, t + bar * 1.25, 'legenda', texto='Você escolhe *o lance*', y=330)
t = e.cena('v-imersivo-02.mp4', 26.9, bar * 1.25, zoom=(1.3, 1.36), foco=(0.5, 0.55))
e.txt(t, t + bar * 1.25, 'legenda', texto='Acerta *o tempo*…', y=330)
t = e.cena('v-imersivo-02.mp4', 59.6, bar, vel=1.5, zoom=(1.2, 1.26), foco=(0.5, 0.3)); e.fx(t + 1.4, 'impacto')
e.txt(t, t + bar, 'legenda', texto='…e decide o jogo', y=1380)
t = e.cena('v-imersivo-02.mp4', 78.6, bar, zoom=(1.15, 1.2), foco=(0.5, 0.35)); e.fx(t, 'whoosh')
e.txt(t, t + bar * 2, 'legenda', texto='No fim do ano:\n*Noite da Bola de Ouro*', y=1260, escuro=True)
t = e.cena('v-imersivo-02.mp4', 99.0, bar, zoom=(1.2, 1.26), foco=(0.5, 0.3)); e.fx(t + bar, 'riser', nivel=0.7)
t = e.cena('v-intenso-01.mp4', VR[18] + 0.4, bar, zoom=(1.0, 1.1), foco=(0.5, 0.45)); e.fx(t, 'ding', nota=7)
e.txt(t, t + bar, 'legenda', texto='Quer rapidez? *Modo Clássico*:\na carreira inteira em minutos', y=1180)
t = e.cena('v-intenso-01.mp4', 355.0, 3.6, vel=0.7); e.fx(t, 'whoosh')
e.txt(t, t + 3.6, 'cta', texto='Entre em campo.\nVire *lenda*.', anim='fade')
e.salvar(drop=0.75, fim=e.t - 3.2)

# ───────────────────────── C7 · Nenhuma carreira é igual (montagem com todas as gravações) ─────────────────────────
CAT = {i['nome']: i for i in json.load(open(f'{B}/_catalogo.json'))}
MAR = lambda n, o: [x['t'] for x in json.load(open(f'{B}/{n}.json'))['marcas'] if x['o'] == o]
e = Ed('c7-nenhuma-carreira-igual', 120, 'hype'); b = 0.5
CARTAS_INI = ['v-otima-02', 'v-boa-03', 'v-mediana-04', 'v-extraordinaria-05']
BAIXAS = ['v-pessima-01', 'v-pessima-03', 'v-ruim-04', 'v-ruim-02']
MEIO = [('v-mediana-05', 46.1), ('v-mediana-04', 60.2), ('v-mediana-02', 91.9), ('v-mediana-01', 61.9), ('v-boa-05', 100.1), ('v-boa-03', 25.1), ('v-boa-02', 90.5), ('v-otima-06', 84.9)]
ALTO = [('v-otima-05', 96.2), ('v-otima-04', 91.2), ('v-otima-03', 76.5), ('v-otima-02', 119.6), ('v-otima-01', 49.6), ('v-extraordinaria-06', 105.3), ('v-extraordinaria-05', 33.8),
        ('v-intenso-06', 205.7), ('v-extraordinaria-04', 43.3), ('v-extraordinaria-03', 87.6), ('v-intenso-05', 169.5), ('v-intenso-04', 131.3), ('v-extraordinaria-02', 86.8),
        ('v-intenso-03', 128.9), ('v-extraordinaria-01', 90.0), ('v-intenso-02', CO[24]), ('v-intenso-01', VR[12])]
CARTAS_FIM = ['v-otima-04', 'v-intenso-03', 'v-boa-01', 'v-mediana-05', 'v-otima-05', 'v-extraordinaria-02']
nomes = set(CARTAS_INI + BAIXAS + [n for n, _ in MEIO + ALTO] + CARTAS_FIM)
nota_de = lambda n: CAT[n]['nota']
assert [nota_de(n) for n, _ in MEIO + ALTO] == sorted(nota_de(n) for n, _ in MEIO + ALTO), 'a montagem tem que subir de nota'
tom = lambda nota: max(0, round((nota - 26) / 3))
t0 = e.t
for n in CARTAS_INI:
    t = e.cena(f'{n}.mp4', MAR(n, 'card')[0] + 1.0, b, zoom=(1.45, 1.5), foco=(0.5, 0.0)); e.fx(t, 'tick', nivel=0.7)
e.txt(t0, e.t, 'gancho', texto=f'*{len(nomes)} carreiras.*\nNenhuma igual.', tam=104, y=190, anim='pop')
t0 = e.t
for n in BAIXAS:
    t = e.cena(f'{n}.mp4', MAR(n, 'nota')[0] + 1.2, b, zoom=(1.6, 1.64), foco=(0.1, 0.3)); e.fx(t, 'tick')
e.fx(t0, 'whoosh', nivel=0.6)
e.txt(t0, e.t, 'legenda', texto='Tem quem pare *cedo*…', y=1150, escuro=True)
t0 = e.t
for k, (n, tt) in enumerate(MEIO):
    t = e.cena(f'{n}.mp4', tt + 0.9, b, zoom=(1.0, 1.06) if k % 2 == 0 else (1.06, 1.0), foco=(0.5, 0.45))
    e.txt(t, t + b, 'contador', numero=str(nota_de(n)), rotulo=CAT[n]['jogador'], tam=240, anim='corte', y=200)
    e.fx(t + 0.02, 'ding', nota=tom(nota_de(n)), nivel=0.6)
e.txt(t0, e.t, 'legenda', texto='…tem quem vire *ídolo*…', y=1380)
e.fx(e.t, 'riser', nivel=0.9)
drop = e.t; t0 = e.t; faixas = {}
TIER7 = lambda n: 'Imortal' if n >= 90 else 'Lenda' if n >= 75 else 'Craque'
for k, (n, tt) in enumerate(ALTO):
    ult = k == len(ALTO) - 1
    t = e.cena(f'{n}.mp4', tt + (0.5 if ult else 0.9), b * (3 if ult else 1), zoom=(1.0, 1.1) if ult else ((1.0, 1.06) if k % 2 == 0 else (1.06, 1.0)), foco=(0.5, 0.45))
    e.txt(t, t + b * (3 if ult else 1), 'contador', numero=str(nota_de(n)), rotulo=CAT[n]['jogador'], tam=240, anim='pop' if ult else 'corte', y=200)
    e.fx(t + 0.02, 'ding', nota=tom(nota_de(n)), nivel=0.75)
    if k == 0 or ult: e.txt(t, t + 0.12, 'flash', anim='corte'); e.fx(t, 'impacto')
    faixas.setdefault(TIER7(nota_de(n)), [t, 0])[1] = e.t
for tier, (de, ate) in faixas.items():
    e.txt(de, ate, 'legenda', texto={'Craque': '…tem quem vire *craque*…', 'Lenda': '…tem quem vire *lenda*…', 'Imortal': '…e tem quem vire *IMORTAL*'}[tier], y=1380)
t0 = e.t
for n in CARTAS_FIM:
    t = e.cena(f'{n}.mp4', MAR(n, 'card')[0] + 1.0, b * 2 / 3, zoom=(1.45, 1.5), foco=(0.5, 0.0)); e.fx(t, 'tick', nivel=0.6)
e.fx(t0, 'whoosh')
e.txt(t0, e.t, 'gancho', texto='E a *sua*?', tam=150, y=200, anim='pop')
t = e.cena('v-intenso-01.mp4', 355.0, 3.6, vel=0.7); e.fx(t, 'whoosh')
e.txt(t, t + 3.6, 'cta', texto='Toda lenda\ncomeça do *zero*.', anim='fade')
e.salvar(drop=drop, fim=e.t - 3.2)
print('C7 usa', len(nomes), 'carreiras diferentes')
