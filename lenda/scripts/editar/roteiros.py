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
FPS = 30
win = lambda n: [w[0] for w in json.load(open(f'{B}/_ouro-{n}.json'))['ouro'] if w[0] > 10]
W1 = win('v-intenso-01')   # VAN RIJN: p10..p24
W2 = win('v-intenso-02')   # CORDEIRO
# VAN RIJN: Bolas de Ouro nas temporadas (period) 10–20 e 22 → janelas na ordem p10..p24
VR = dict(zip(range(10, 10 + len(W1)), W1))
# CORDEIRO: janelas p10..p22 e p24 (p23 não acendeu)
CO = dict(zip([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24], W2))
CAT = {i['nome']: i for i in json.load(open(f'{B}/_catalogo.json'))}
MAR = lambda n, o: [x['t'] for x in json.load(open(f'{B}/{n}.json'))['marcas'] if x['o'] == o]
TIER = lambda n: 'Imortal' if n >= 90 else 'Lenda' if n >= 75 else 'Craque' if n >= 60 else 'Ídolo' if n >= 45 else 'Profissional' if n >= 25 else 'Promessa'
CHIPS_MODO = ['Clássico', 'Imersivo', 'Live']
CHIPS_RITMO = ['Intenso', 'Normal', 'Expresso']
SIMULACAO = 'SIMULAÇÃO DA LIVE'


class Ed:
    """Linha do tempo: cada cena dura um número inteiro de quadros, para os textos caírem no corte certo."""
    def __init__(s, nome, bpm, estilo):
        s.r = {'nome': nome, 'bpm': bpm, 'estilo': estilo, 'cenas': [], 'textos': [], 'efeitos': []}
        s.t = 0.0
    def cena(s, src, de, dur, vel=1.0, zoom=(1, 1), foco=(0.5, 0.5)):
        dur = round(dur * FPS) / FPS
        s.r['cenas'].append({'src': src, 'de': round(de, 4), 'ate': round(de + dur * vel, 4), 'vel': vel, 'zoom': list(zoom), 'foco': list(foco)})
        t0 = s.t; s.t = round(s.t + dur, 4); return t0
    def txt(s, de, ate, tipo, **k):
        s.r['textos'].append({'de': round(de, 4), 'ate': round(ate, 4), 'tipo': tipo, **k})
    def fx(s, t, tipo, **k):
        s.r['efeitos'].append({'t': round(t, 4), 'tipo': tipo, **k})
    def cta(s, src, de, dur, texto, vel=1.0, **k):
        t = s.cena(src, de, dur, vel=vel); s.fx(t, 'whoosh')
        s.txt(t, s.t, 'cta', texto=texto, anim='fade', **k)
        return t
    def salvar(s, drop, fim):
        s.r['drop'] = round(drop, 4); s.r['fim'] = round(fim, 4)
        json.dump(s.r, open(f"{OUT}/{s.r['nome']}.json", 'w'), ensure_ascii=False, indent=1)
        print(s.r['nome'], round(s.t, 1), 's')


# ───────────────────────── C1 · Como funciona ─────────────────────────
# Passo a passo do Clássico, os 3 modos, os 3 ritmos e uma carreira no Expresso (VALDEZ), para não repetir o C2.
e = Ed('c1-como-funciona', 120, 'hype')
t = e.cena('v-intenso-03.mp4', 129.4, 2.0, zoom=(1.0, 1.1), foco=(0.5, 0.45))
e.txt(0, 2.0, 'gancho', texto='Você decide *tudo*.\nDa base à *Bola de Ouro*.', tam=92, y=230, anim='pop')
t = e.cena('v-intenso-01.mp4', 17.6, 2.0, vel=2.0, zoom=(1.04, 1.08), foco=(0.5, 0.22)); e.fx(t, 'whoosh')
e.txt(t + 0.05, t + 2.0, 'legenda', texto='*1.* Crie o seu jogador', y=230)
t = e.cena('v-intenso-01.mp4', 28.9, 2.0, vel=1.1, zoom=(1.0, 1.04), foco=(0.5, 0.82)); e.fx(t, 'whoosh', nivel=0.6)
e.txt(t + 0.05, t + 2.0, 'legenda', texto='*2.* Escolha onde começar', y=520)
t = e.cena('v-intenso-01.mp4', 149.0, 2.0, vel=0.75, zoom=(1.1, 1.15), foco=(0.5, 0.58))
t2 = e.cena('v-intenso-04.mp4', 132.3, 2.0, zoom=(1.0, 1.1), foco=(0.5, 0.45))
e.txt(t + 0.05, t2 + 2.0, 'legenda', texto='*3.* Cada decisão\nmuda a sua história', y=1180)
e.fx(t2 + 0.3, 'ding', nota=0, nivel=0.7)
# 3 modos
t = e.cena('v-extraordinaria-01.mp4', 62.9, 2.0, vel=0.5, zoom=(1.1, 1.15), foco=(0.5, 0.7)); e.fx(t, 'whoosh')
e.txt(t, t + 2.0, 'chips', itens=CHIPS_MODO, ativo=0, anim='corte', y=1250)
e.txt(t, t + 6.0, 'gancho', texto='*3 modos* de jogar', tam=96, y=250, anim='sobe', fundo=True)
t = e.cena('v-imersivo-02.mp4', 61.4, 2.0, zoom=(1.0, 1.05), foco=(0.5, 0.2)); e.fx(t + 0.5, 'impacto', nivel=0.6)
e.txt(t, t + 2.0, 'chips', itens=CHIPS_MODO, ativo=1, anim='corte', y=1250)
t = e.cena('v-live-04.mp4', 24.0, 2.0, zoom=(1.1, 1.14), foco=(0.5, 0.16))
e.txt(t, t + 2.0, 'chips', itens=CHIPS_MODO, ativo=2, anim='corte', y=1250)
e.txt(t, t + 2.0, 'selo', texto=SIMULACAO, anim='corte', y=1150)
# 3 ritmos (1,5 s cada; os mesmos textos da tela de criação)
t = e.cena('v-intenso-01.mp4', 176.0, 4.5, vel=2.0, zoom=(1.05, 1.05), foco=(0.5, 0.5)); e.fx(t, 'whoosh')
for k, frase in enumerate(['Ritmo *Intenso*:\n1 decisão por temporada', 'Ritmo *Normal*:\n1 a cada 2 temporadas', 'Ritmo *Expresso*:\n1 a cada 3 temporadas']):
    e.txt(t + 1.5 * k, t + 1.5 * (k + 1), 'chips', itens=CHIPS_RITMO, ativo=k, anim='corte', y=1250)
    e.txt(t + 1.5 * k, t + 1.5 * (k + 1), 'legenda', texto=frase, y=230, escuro=True, anim='corte')
    e.fx(t + 1.5 * k, 'tick')
# VALDEZ no Expresso: cada tela fecha 3 temporadas (1 → 4 → 7 → 10 → 11 Bolas de Ouro, conferido nas telas)
t0 = e.t
for k, (tt, n) in enumerate([(77.3, 1), (91.1, 4), (102.6, 7), (121.0, 10), (127.6, 11)]):
    t = e.cena('v-extraordinaria-01.mp4', tt, 1.2, zoom=(1.0, 1.08) if k % 2 == 0 else (1.08, 1.0), foco=(0.5, 0.45))
    e.txt(t, t + 1.2, 'contador', numero=str(n), prefixo='×', rotulo='Bola de Ouro' if n == 1 else 'Bolas de Ouro', tam=240, anim='pop', y=200)
    e.fx(t + 0.04, 'ding', nota=[0, 4, 7, 11, 12][k], nivel=0.8)
    if k == 4: e.txt(t, t + 0.12, 'flash', anim='corte'); e.fx(t, 'impacto')
t = e.cena('v-extraordinaria-01.mp4', MAR('v-extraordinaria-01', 'nota')[0] + 1.2, 2.6, zoom=(1.42, 1.5), foco=(0.15, 0.2)); e.fx(t + 0.2, 'ding', nota=12)
e.txt(t + 0.2, t + 2.6, 'legenda', texto='Nota de Legado: *92 · Imortal*', y=1330, escuro=True)
t = e.cena('v-hall-01.mp4', 20.6, 2.0, zoom=(1.3, 1.34), foco=(0.5, 0.3))
e.txt(t, t + 2.0, 'legenda', texto='Compare com *50 lendas reais*', y=1180)
e.cta('v-extraordinaria-01.mp4', MAR('v-extraordinaria-01', 'card')[0] + 1.0, 3.0, 'Sua carreira. *Suas decisões.*', vel=0.9)
e.salvar(drop=2.0, fim=e.t - 2.6)

# ───────────────────────── C2 · 11 Bolas de Ouro seguidas (VAN RIJN) ─────────────────────────
e = Ed('c2-bolas-de-ouro-seguidas', 100, 'epico')
t = e.cena('v-intenso-01.mp4', 49.85, 2.4, zoom=(1.0, 1.1), foco=(0.5, 0.45)); e.fx(0.15, 'impacto', nivel=0.7)
e.txt(0, 2.4, 'gancho', texto='Rebaixado\naos *18 anos*…', anim='pop', y=300)
t = e.cena('v-intenso-01.mp4', 89.9, 2.4, zoom=(1.05, 1.1), foco=(0.5, 0.42)); e.fx(t, 'whoosh')
e.txt(t, t + 2.4, 'legenda', texto='…até escolher\no *Barcelona*', y=330)
t = e.cena('v-intenso-01.mp4', 99.9, 1.4, zoom=(1.08, 1.08)); e.fx(t + 1.4, 'riser', nivel=0.9)
e.txt(t, t + 1.4, 'legenda', texto='Dois anos depois,\njá no *City*…', y=1180, escuro=True)
drop = e.t
for k, p in enumerate(range(10, 21)):
    d = 1.2 if k < 3 else 0.6   # acelera do ×4 ao ×11
    t = e.cena('v-intenso-01.mp4', VR[p] + 0.45, d, zoom=(1.0, 1.08) if k % 2 == 0 else (1.08, 1.0), foco=(0.5, 0.45))
    rot = 'Bola de Ouro' if k == 0 else ('+ *Copa do Mundo*' if p == 12 else 'Bolas de Ouro seguidas')
    e.txt(t, t + d, 'contador', numero=str(k + 1), prefixo='×', rotulo=rot, anim='pop' if k < 3 else 'corte', y=200)
    e.fx(t + 0.04, 'ding', nota=[0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17][k], nivel=0.85)
    if k == 0: e.txt(t, t + 0.12, 'flash', anim='corte'); e.fx(t, 'impacto')
t = e.cena('v-intenso-01.mp4', VR[22] + 0.3, 2.4, zoom=(1.0, 1.1), foco=(0.5, 0.45)); e.fx(t + 0.05, 'ding', nota=19); e.fx(t, 'impacto')
e.txt(t, t + 0.12, 'flash', anim='corte')
e.txt(t, t + 2.4, 'contador', numero='12', prefixo='×', rotulo='e mais uma *aos 37*', anim='pop', y=200)
t = e.cena('v-intenso-01.mp4', 343.3, 3.0, zoom=(1.0, 1.1), foco=(0.5, 0.78)); e.fx(t, 'impacto', nivel=0.6)
e.txt(t + 0.3, t + 3.0, 'legenda', texto='794 gols oficiais:\n*mais que o Pelé (757)*', y=210)
t = e.cena('v-intenso-01.mp4', 348.6, 2.4, zoom=(1.42, 1.5), foco=(0.15, 0.27)); e.fx(t + 0.2, 'ding', nota=12)
e.txt(t + 0.2, t + 2.4, 'nota', nota='93', tier='Imortal', anim='pop', y=980)
e.cta('v-intenso-01.mp4', 355.0, 3.0, 'E a *sua* carreira,\nvai até onde?', vel=0.8)
e.salvar(drop=drop, fim=e.t - 2.6)

# ───────────────────────── C3 · Qual nota você tiraria ─────────────────────────
e = Ed('c3-qual-nota-voce-tiraria', 92, 'hype'); bar = 4 * 60 / 92
t = e.cena('v-hall-01.mp4', 1.4, bar, zoom=(1.0, 1.04), foco=(0.5, 0.3))
e.txt(0, e.t, 'gancho', texto='Qual *nota* a sua\ncarreira tiraria?', anim='pop', y=910, fundo=True)
NOTAS = [('v-pessima-01.mp4', 86.0, '*5* · Promessa\nUm clube só. Zero títulos.', 1320),
         ('v-ruim-03.mp4', 87.8, '*14* · Promessa\nParou aos 37 na Austrália', 1100),
         ('v-mediana-03.mp4', 136.8, '*33* · Profissional\n117 gols e muita assistência', 1100),
         ('v-boa-03.mp4', 118.0, '*51* · Ídolo\nLateral campeão em 4 países', 1100),
         ('v-otima-04.mp4', 145.2, '*67* · Craque\nDeu o *hexa* pro Brasil', 1100),
         ('v-extraordinaria-03.mp4', 143.5, '*85* · Lenda\n3 Bolas de Ouro + Copa', 1100),
         ('v-intenso-01.mp4', 348.6, '*93* · IMORTAL\n12 Bolas de Ouro', 1320)]
for k, (src, tn, linha, y) in enumerate(NOTAS):
    last = k == len(NOTAS) - 1
    t = e.cena(src, tn + 0.15, bar * (1.5 if last else 1), zoom=(1.45, 1.52), foco=(0.15, 0.27))
    e.txt(t + 0.05, e.t, 'legenda', texto=linha, y=y, escuro=True, anim='pop')
    e.fx(t, 'whoosh', nivel=0.5)
    e.fx(t + 0.1, 'ding', nota=[0, 2, 4, 7, 9, 12, 16][k], nivel=0.6 + 0.05 * k)
    if last: e.txt(t, t + 0.12, 'flash', anim='corte'); e.fx(t, 'impacto')
e.cta('v-hall-01.mp4', 44.5, 3.0, 'Descubra a *sua*\nNota de Legado')
e.salvar(drop=bar, fim=e.t - 2.6)

# ───────────────────────── C4 · O chat decide (live, simulação) ─────────────────────────
e = Ed('c4-o-chat-decide', 124, 'hype'); bar = 4 * 60 / 124
t = e.cena('v-live-04.mp4', 3.0, bar * 1.5, vel=2.0, zoom=(1.0, 1.05), foco=(0.5, 0.14))
e.txt(0, e.t, 'gancho', texto='E se o *CHAT*\ndecidisse tudo?', anim='pop', y=1080, fundo=True)
t = e.cena('v-live-04.mp4', 11.6, bar * 1.5, vel=1.5, zoom=(1.32, 1.36), foco=(0.5, 0.14)); e.fx(t, 'whoosh')
e.txt(t, e.t, 'legenda', texto='Quem doa mais\n*cria o jogador*', y=1150)
t = e.cena('v-live-04.mp4', 17.6, bar * 1.5, zoom=(1.0, 1.15), foco=(0.5, 0.12)); e.fx(t, 'impacto')
e.txt(t + 0.2, e.t, 'legenda', texto='Nasce uma lenda', y=1150, escuro=True)
t = e.cena('v-live-04.mp4', 24.0, bar * 2, vel=1.8, zoom=(1.3, 1.34), foco=(0.5, 0.17)); e.fx(t, 'whoosh')
e.txt(t, e.t, 'legenda', texto='Comente *1, 2 ou 3*\nRosa = *10 votos na opção 1*', y=1180)
t = e.cena('v-live-04.mp4', 32.6, bar, zoom=(1.3, 1.34), foco=(0.5, 0.17)); e.fx(t, 'pop')
e.txt(t, e.t, 'legenda', texto='*O chat decidiu!*', y=1180)
t = e.cena('v-live-04.mp4', 51.4, bar, zoom=(1.3, 1.36), foco=(0.5, 0.62)); e.fx(t, 'impacto', nivel=0.7)
e.txt(t, e.t, 'legenda', texto='Rebaixou? *Culpa do chat.*', y=430, escuro=True)
t = e.cena('v-live-04.mp4', 99.9, bar * 1.5, zoom=(1.0, 1.1), foco=(0.5, 0.42)); e.fx(t + 0.1, 'ding', nota=7)
e.txt(t, t + 1.95, 'legenda', texto='Bola de Ouro?\n*Também é do chat.*', y=330)
t = e.cena('v-live-04.mp4', 149.3, bar * 1.5, zoom=(1.0, 1.05), foco=(0.5, 0.26))
e.txt(t, e.t, 'legenda', texto='No fim, os maiores\napoiadores *na tela*', y=300)
e.cta('v-live-04.mp4', 154.0, bar * 2, '*Live interativa*\naqui no perfil', vel=0.8, rodape='Siga o perfil pra jogar junto')
e.txt(0, e.t, 'selo', texto=SIMULACAO, anim='corte', y=210)   # depois do CTA: fica por cima até o fim
e.salvar(drop=bar * 1.5, fim=e.t - bar * 2)

# ───────────────────────── C5 · Brasileiro Imortal (CORDEIRO) ─────────────────────────
e = Ed('c5-brasileiro-imortal', 116, 'epico'); b = 60 / 116; bar = 4 * b
t = e.cena('v-intenso-02.mp4', CO[24] + 0.5, bar, zoom=(1.0, 1.1), foco=(0.5, 0.45)); e.fx(0.1, 'impacto', nivel=0.8)
e.txt(0, e.t, 'gancho', texto='Campeão do mundo\n*aos 39 anos*', anim='pop', y=215, tam=104)
t = e.cena('v-intenso-02.mp4', 30.4, bar, zoom=(1.0, 1.04), foco=(0.5, 0.8)); e.fx(t, 'whoosh')
e.txt(t, e.t, 'legenda', texto='Tudo começou\nna base do *Náutico*', y=520)
t = e.cena('v-intenso-02.mp4', 38.0, bar, vel=8.0, zoom=(1.1, 1.1)); e.fx(t, 'whoosh', nivel=0.6)
e.txt(t, e.t, 'legenda', texto='Ponte Preta. Operário.\nNovorizontino.', y=1180, escuro=True)
t = e.cena('v-intenso-02.mp4', 67.0, bar, zoom=(1.0, 1.08), foco=(0.5, 0.45)); e.fx(t + 0.1, 'ding', nota=4, nivel=0.6)
e.txt(t, e.t, 'legenda', texto='Primeiro título:\n*Carioca* pelo Flu', y=330)
t = e.cena('v-intenso-02.mp4', 114.95, 1.5, zoom=(1.2, 1.26), foco=(0.5, 0.62)); e.fx(t, 'whoosh')
e.txt(t, e.t, 'legenda', texto='A Europa bateu na porta:\n*Barcelona.*', y=330)
t = e.cena('v-intenso-02.mp4', 125.0, bar, zoom=(1.0, 1.08), foco=(0.5, 0.45)); e.fx(t + 0.1, 'ding', nota=7, nivel=0.7); e.fx(t + bar, 'riser', nivel=0.8)
e.txt(t, e.t, 'legenda', texto='Copa América\n*com a Seleção*', y=330)
drop = e.t
for k, p in enumerate([11, 13, 15, 16, 17, 18, 19, 20, 21]):
    t = e.cena('v-intenso-02.mp4', CO[p] + 0.5, b, zoom=(1.0, 1.06) if k % 2 == 0 else (1.06, 1.0), foco=(0.5, 0.45))
    e.txt(t, e.t, 'contador', numero=str(k + 1), prefixo='×', rotulo='Bola de Ouro' if k == 0 else 'Bolas de Ouro', anim='pop' if k == 0 else 'corte', y=200)
    e.fx(t + 0.04, 'ding', nota=[0, 2, 4, 5, 7, 9, 11, 12, 14][k], nivel=0.85)
    if k == 0: e.txt(t, t + 0.12, 'flash', anim='corte'); e.fx(t, 'impacto')
t = e.cena('v-intenso-02.mp4', CO[24] + 0.4, bar * 1.5, zoom=(1.0, 1.12), foco=(0.5, 0.45)); e.fx(t, 'impacto'); e.fx(t + 0.1, 'ding', nota=16)
e.txt(t, t + 0.12, 'flash', anim='corte')
e.txt(t, e.t, 'contador', numero='10', prefixo='×', rotulo='+ *Copa do Mundo* aos 39', anim='pop', y=200)
t = e.cena('v-intenso-02.mp4', 341.1, bar * 1.5, zoom=(1.42, 1.5), foco=(0.15, 0.27)); e.fx(t + 0.2, 'ding', nota=12)
e.txt(t + 0.3, e.t, 'nota', nota='92', tier='Imortal', anim='pop', y=980)
e.cta('v-intenso-02.mp4', 347.6, 3.0, 'Crie o *seu* craque', vel=0.75)
e.salvar(drop=drop, fim=e.t - 2.6)

# ───────────────────────── C6 · Entre em campo (Imersivo) ─────────────────────────
# Abre no pênalti do próprio jogador (RIBEIRO) e fecha na revelação da Bola de Ouro.
e = Ed('c6-entre-em-campo', 120, 'hype')
t = e.cena('v-imersivo-02.mp4', 57.0, 2.0, zoom=(1.0, 1.05), foco=(0.5, 0.5)); e.fx(0.1, 'impacto', nivel=0.6)
e.txt(0, e.t, 'gancho', texto='Pênalti decisivo.\n*Você* bate.', anim='pop', y=300, tam=104, fundo=True)
t = e.cena('v-imersivo-02.mp4', 60.4, 2.4, zoom=(1.0, 1.05), foco=(0.5, 0.3)); e.fx(t + 1.5, 'impacto')
e.txt(t + 1.5, e.t, 'legenda', texto='Aqui você *entra em campo*', y=330)
t = e.cena('v-imersivo-02.mp4', 0.1, 2.5, zoom=(1.0, 1.05), foco=(0.5, 0.55)); e.fx(t, 'whoosh')
e.txt(t, e.t, 'legenda', texto='Você escolhe *o lance*', y=330)
t = e.cena('v-imersivo-02.mp4', 26.9, 2.5, zoom=(1.0, 1.05), foco=(0.5, 0.55))
e.txt(t, e.t, 'legenda', texto='…e acerta *o tempo*', y=330)
t = e.cena('v-imersivo-02.mp4', 78.6, 1.5, zoom=(1.15, 1.2), foco=(0.5, 0.35)); e.fx(t, 'whoosh'); e.fx(t + 1.5, 'riser', nivel=0.7)
e.txt(t, e.t, 'legenda', texto='No fim do ano:\n*Noite da Bola de Ouro*', y=1120, escuro=True)
t = e.cena('v-imersivo-02.mp4', 101.5, 2.4, zoom=(1.0, 1.06), foco=(0.5, 0.35)); e.fx(t + 1.3, 'impacto', nivel=0.6)
e.txt(t + 1.0, e.t, 'legenda', texto='Nem top 10… *ainda*.\nAté onde você chega?', y=330)
e.cta('v-imersivo-02.mp4', 64.0, 3.0, 'Entre em campo.\nVire *lenda*.')
e.salvar(drop=2.0, fim=e.t - 2.6)

# ───────────────────────── C7 · Nenhuma carreira é igual (montagem com todas as gravações) ─────────────────────────
e = Ed('c7-nenhuma-carreira-igual', 120, 'hype'); b = 0.5
CARTAS_INI = ['v-otima-02', 'v-boa-03', 'v-mediana-04', 'v-extraordinaria-05']
BAIXAS = ['v-pessima-01', 'v-pessima-03', 'v-ruim-04', 'v-ruim-03']   # todos pararam aos 37
MEIO = [('v-mediana-05', 46.1), ('v-mediana-04', 60.2), ('v-mediana-02', 91.9), ('v-mediana-01', 61.9), ('v-boa-05', 100.1), ('v-boa-03', 25.1), ('v-boa-02', 90.5), ('v-boa-01', 64.2), ('v-otima-06', 84.9)]
ALTO = [('v-otima-05', 96.2), ('v-otima-04', 91.2), ('v-otima-03', 76.5), ('v-otima-02', 119.6), ('v-otima-01', 49.6), ('v-extraordinaria-06', 105.3), ('v-extraordinaria-05', 33.8),
        ('v-intenso-06', 205.7), ('v-extraordinaria-04', 43.3), ('v-extraordinaria-03', 87.6), ('v-intenso-05', 169.5), ('v-intenso-04', 131.3), ('v-extraordinaria-02', 86.8),
        ('v-intenso-03', 128.9), ('v-extraordinaria-01', 90.0), ('v-intenso-02', CO[24]), ('v-intenso-01', VR[12])]
nomes = set(CARTAS_INI + BAIXAS + [n for n, _ in MEIO + ALTO])
nota_de = lambda n: CAT[n]['nota']
assert [nota_de(n) for n, _ in MEIO + ALTO] == sorted(nota_de(n) for n, _ in MEIO + ALTO), 'a montagem tem que subir de nota'
tom = lambda nota: max(0, round((nota - 26) / 3))
t0 = e.t
for n in CARTAS_INI:
    t = e.cena(f'{n}.mp4', MAR(n, 'card')[0] + 1.0, b, zoom=(1.45, 1.5), foco=(0.5, 0.0)); e.fx(t, 'tick', nivel=0.7)
e.txt(t0, e.t, 'gancho', texto=f'*{len(nomes)} carreiras.*\nNenhuma igual.', tam=96, y=205, anim='pop', fundo=True)
t0 = e.t
for n in BAIXAS:
    t = e.cena(f'{n}.mp4', MAR(n, 'nota')[0] + 1.2, b, zoom=(1.6, 1.64), foco=(0.1, 0.3)); e.fx(t, 'tick')
e.fx(t0, 'whoosh', nivel=0.6)
e.txt(t0, e.t, 'legenda', texto='Tem quem pare *cedo*…', y=1150, escuro=True)
faixas, drop = {}, None
for k, (n, tt) in enumerate(MEIO + ALTO):
    alto = k >= len(MEIO); ult = k == len(MEIO) + len(ALTO) - 1
    if alto and drop is None: drop = e.t; e.fx(e.t, 'impacto')
    d = b * 3 if ult else b
    t = e.cena(f'{n}.mp4', tt + (0.5 if ult else 0.9), d, zoom=(1.0, 1.1) if ult else ((1.0, 1.06) if k % 2 == 0 else (1.06, 1.0)), foco=(0.5, 0.45))
    e.txt(t, e.t, 'contador', numero=str(nota_de(n)), rotulo=CAT[n]['jogador'], topo='Nota de Legado', tam=230, anim='pop' if ult else 'corte', y=200)
    e.fx(t + 0.02, 'ding', nota=tom(nota_de(n)), nivel=0.75 if alto else 0.6)
    if ult: e.txt(t, t + 0.12, 'flash', anim='corte'); e.fx(t, 'impacto')
    faixas.setdefault(TIER(nota_de(n)), [t, 0])[1] = e.t
    if k == len(MEIO) - 1: e.fx(e.t, 'riser', nivel=0.9)
FRASE = {'Profissional': '…tem quem vire *profissional*…', 'Ídolo': '…tem quem vire *ídolo*…', 'Craque': '…tem quem vire *craque*…', 'Lenda': '…tem quem vire *lenda*…', 'Imortal': '…e tem quem vire *IMORTAL*'}
for tier, (de, ate) in faixas.items():
    e.txt(de, ate, 'legenda', texto=FRASE[tier], y=1380, escuro=True)
# fim: a tela de criação vazia ("E a sua?") e o nome sendo digitado por baixo do cartão
t = e.cena('v-intenso-01.mp4', 16.6, 2.0); e.fx(t, 'whoosh')
e.txt(t, e.t, 'gancho', texto='E a *sua*?', tam=150, y=215, anim='pop', fundo=True)
e.cta('v-intenso-01.mp4', 18.6, 3.0, 'Toda lenda\ncomeça do *zero*.')
e.salvar(drop=drop, fim=e.t - 2.6)
print('C7 usa', len(nomes), 'carreiras diferentes')
