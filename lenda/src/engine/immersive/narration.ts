/**
 * Banco de narração pt-BR (estilo transmissão de TV/rádio). Cada função sorteia uma variante com o
 * Rng recebido e troca os marcadores: {p} jogador, {a} quem deu o passe, {t} time, {o} adversário,
 * {g} goleiro, {s} placar, {m} minuto.
 */
import type { Rng } from '../rng'

export type Vars = Record<string, string | number | undefined>

export function fill(tpl: string, v: Vars): string {
  // nome abreviado com ponto ("Argentino Q.") seguido da pontuação do modelo: um ponto só
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? '')).replace(/(\p{L})\.\.(?!\.)/gu, '$1.')
}

export function say(r: Rng, list: readonly string[], v: Vars = {}): string {
  return fill(r.pick(list), v)
}

export const T = {
  // {st}: complemento opcional no fim da frase (" pela 31ª rodada", " em amistoso internacional")
  kickoff: [
    'Bola rolando! {h} e {aw} começam a partida{st}.',
    'Autorizou o árbitro: começa {h} × {aw}{st}.',
    'Tudo pronto, estádio cheio e a bola rola para {h} × {aw}{st}.',
    'Apita o árbitro! Vai começar {h} × {aw}{st}.',
  ],
  secondHalf: ['Recomeça o jogo para o segundo tempo!', 'Bola rolando na etapa final.', 'Voltam os times: segundo tempo em andamento.'],
  extraTime: ['Vamos para a prorrogação! Mais 30 minutos de tensão.', 'Empate no tempo normal: tem prorrogação!', 'Ninguém desempata: a decisão vai para o tempo extra.'],
  halfTime: ['Fim do primeiro tempo: {h} {s} {aw}.', 'Intervalo! {h} {s} {aw} no placar.', 'Termina a etapa inicial: {h} {s} {aw}.'],
  fullTimeWin: ['Fim de jogo! Vitória do {w}: {h} {s} {aw}.', 'Apita o árbitro! {w} vence: {h} {s} {aw}.', 'Acabou! Festa do {w}: {h} {s} {aw}.'],
  fullTimeDraw: ['Fim de jogo: empate em {s} entre {h} e {aw}.', 'Acabou! {h} e {aw} ficam no {s}.', 'Apita o árbitro. Tudo igual: {s}.'],
  fullTimePens: ['Fim de jogo nos pênaltis: {w} leva a melhor ({pens}).', 'Decidido nas penalidades! {w} vence por {pens}.'],
  goalTeam: [
    'GOOOL do {t}! {p} aparece na área e manda para as redes.',
    'É GOL! {p} finaliza cruzado, sem chances para {g}.',
    'GOL do {t}! {a} cruza na medida e {p} cabeceia firme.',
    'Bola na rede! {p} aproveita o rebote e faz a torcida explodir.',
    'GOOOL! Chute de fora da área de {p}, no ângulo!',
    'GOL do {t}! Tabela rápida e {p} só empurra.',
    'É do {t}! {p} bate colocado no canto.',
    'GOL! {a} rouba no meio, toca para {p}, que não perdoa.',
  ],
  // gol do jogador, frases que servem a qualquer finalização (somadas às do tipo de chute, `SHOT_TEXT`)
  goalUser: [
    'GOOOOOL! É DELE! {p} decide e explode a arquibancada!',
    'É GOL! {p} não perdoa e deixa sua marca!',
    'Balançou a rede! {p} faz o dele!',
    'GOL, GOL, GOL! {p} marca e o estádio vem abaixo!',
  ],
  goalOpp: [
    'Gol do {t}. {p} aproveita a desatenção e marca.',
    'Não deu para segurar: {p} marca para o {t}.',
    'Castigo! {p} finaliza e faz o gol do {t}.',
    'Gol do {t}: cruzamento, desvio de {p} e bola no fundo da rede.',
    'Silêncio na torcida: {p} marca para o {t}.',
  ],
  penaltyGoal: ['Pênalti convertido! {p} desloca {g}.', '{p} bate firme e converte a penalidade.'],
  penaltyMiss: ['{g} defende a cobrança de {p}!', '{p} manda a cobrança por cima do gol!', 'Na trave! {p} desperdiça o pênalti.'],
  chance: [
    'Quase! {p} finaliza e a bola passa raspando a trave.',
    '{p} arrisca de longe, por cima do travessão.',
    'Boa jogada do {t}, mas {p} finaliza fraco.',
    'Uuuh! {p} cabeceia e a bola sai tirando tinta do poste.',
    '{p} limpa a marcação e chuta para fora.',
  ],
  save: ['Que defesa! {g} voa e espalma o chute de {p}.', '{g} segura firme a finalização de {p}.', 'Milagre de {g}! Defesa à queima-roupa em chute de {p}.'],
  /** Defesa do jogador goleiro (o lance pode ser chute de longe, cabeceio ou cara a cara: frase neutra). */
  saveUser: ['Que defesa! {g} voa e espalma o chute de {p}.', '{g} segura firme a finalização de {p}.', '{g} fecha o gol e para {p}!'],
  woodwork: ['NA TRAVE! {p} acerta o poste!', 'Explodiu no travessão! {p} quase marca um golaço.', 'Bola no pé da trave em chute de {p}!'],
  yellow: [
    'Cartão amarelo para {p}, do {t}, por falta dura.',
    '{p} chega atrasado e leva o amarelo.',
    'Amarelo para {p} por reclamação.',
    '{p} puxa a camisa no contra-ataque: amarelo.',
    'O árbitro não perdoa: amarelo para {p} por retardar o reinício.',
    'Entrada por trás de {p}. Cartão amarelo, com justiça.',
    '{p} simula na área e é advertido com o amarelo.',
    'Falta tática de {p} para matar a jogada. Amarelo.',
    'Cotovelada de {p} na disputa pelo alto: amarelo.',
    'O {t} reclama muito e {p} acaba levando o amarelo.',
  ],
  red: ['Cartão vermelho! {p} é expulso e o {t} fica com um a menos.', 'Expulso! {p} recebe o vermelho direto.'],
  secondYellow: ['Segundo amarelo para {p}! Expulso, e o {t} fica com um a menos.', 'Mais uma falta de {p}: segundo amarelo e vermelho. O {t} vai jogar com dez.'],
  subOn: [
    'Substituição no {t}: entra {p}, sai {a}.',
    'Mexe o técnico do {t}: {p} no lugar de {a}.',
    'O {t} troca: {a} sai cansado, {p} entra para dar fôlego.',
    '{p} vai para o jogo no {t}; {a} deixa o campo aplaudido.',
    'Alteração tática no {t}: sai {a}, entra {p}.',
    'Mudança no {t}. {p} é a aposta do banco no lugar de {a}.',
    '{a} sente e pede para sair. Entra {p} no {t}.',
    'O {t} renova o ataque: {p} no lugar de {a}.',
  ],
  // dupla substituição: duas linhas (um evento por troca), a 2ª continua a 1ª
  subDouble: [
    ['Dupla substituição no {t}. Primeiro: entra {p}, sai {a}.', 'Na mesma parada, {p2} entra no lugar de {a2}.'],
    ['O técnico do {t} mexe duas vezes: {p} no lugar de {a}…', '…e {p2} no lugar de {a2}.'],
    ['Duas trocas de uma vez no {t}: {a} dá lugar a {p}…', '…e {a2} sai para a entrada de {p2}.'],
  ] as const,
  var: ['O VAR revisa o lance… jogo segue.', 'Checagem do VAR em possível pênalti: nada marcado.', 'Árbitro consulta o VAR e mantém a decisão de campo.'],
  injury: ['{p} sente a coxa e pede atendimento.', 'Preocupação: {p} cai no gramado e recebe atendimento médico.'],
  userSubOn: ['Entra {p}! A torcida aplaude a mudança. Sai {a}.', 'É a sua vez: {p} entra no lugar de {a}.', 'O técnico chama {p}, que entra no lugar de {a}.'],
  userSubOff: ['Sai {p}, aplaudido, para a entrada de {a}.', '{p} deixa o campo e dá lugar a {a}.', 'Fim de jogo para {p}: entra {a}.'],
  userAskOff: ['{p} pede para sair, sentindo o cansaço. Entra {a}.', '{p} está no limite e pede a troca. Entra {a}.'],
  /** Pediu para sair ainda inteiro (energia alta): sem "cansaço". */
  userAskOffFresh: ['{p} pede para sair e é substituído. Entra {a}.', '{p} pede a troca ao banco. Entra {a} no lugar dele.'],
}

/** Tipo de finalização do jogador (pela opção escolhida): cada um tem a sua narração. */
export type ShotKind = 'placed' | 'power' | 'finish' | 'round_gk' | 'long' | 'cut_back' | 'header' | 'fk'

export const SHOT_KIND: Record<string, ShotKind> = {
  shoot_placed: 'placed',
  shoot_power: 'power',
  finish: 'finish',
  round_gk: 'round_gk',
  long_shot: 'long',
  cut_back: 'cut_back',
  header_goal: 'header',
  fk_direct: 'fk',
}

/**
 * Narração da finalização do jogador por tipo (gol, defesa, para fora, trave): cabeceio só no lance de
 * cabeça, "à queima-roupa" só cara a cara, cobrança de falta com barreira. {p} jogador, {P} em
 * maiúsculas, {g} goleiro.
 */
export const SHOT_TEXT: Record<ShotKind, { goal: readonly string[]; save: readonly string[]; wide: readonly string[]; post: readonly string[] }> = {
  placed: {
    goal: ['GOOOL! {p} ajeita e bate colocado, no cantinho de {g}!', 'É GOL! {p} coloca a bola onde {g} não alcança!', 'GOLAÇO DE {P}! Chute colocado, no canto, sem chance!'],
    save: ['{g} se estica todo e espalma o chute colocado de {p}.', 'Chute colocado de {p}, mas {g} adivinha o canto e defende.'],
    wide: ['{p} tenta colocar e a bola passa raspando a trave.', 'Chute colocado de {p}, mas a bola sai pela linha de fundo.'],
    post: ['NA TRAVE! {p} bate colocado e a bola beija o poste!', 'Bola no pé da trave em chute colocado de {p}!'],
  },
  power: {
    goal: ['GOOOL! {p} solta a bomba e estufa a rede!', 'É GOL! Pancada de {p}, sem chance para {g}!', 'GOLAÇO DE {P}! Encheu o pé e a bola entrou rasgando!'],
    save: ['{p} solta a bomba e {g} espalma para escanteio!', 'Pancada de {p}! {g} rebate firme.'],
    wide: ['{p} bate forte demais e isola por cima do gol.', 'Pancada de {p} que sobe demais: por cima do travessão.'],
    post: ['Explodiu no travessão! Que bomba de {p}!', 'NA TRAVE! O chute forte de {p} carimba o poste!'],
  },
  finish: {
    goal: ['GOOOL! {p} fica cara a cara e tira de {g}!', 'É GOL! {p} toca na saída de {g} e corre para a torcida!', 'GOOOL! Frente a frente com {g}, {p} não perdoa!'],
    save: ['{g} sai bem e fecha o ângulo: defesa na cara do gol diante de {p}!', 'Milagre de {g}! Defesa à queima-roupa na finalização de {p}.'],
    wide: ['Cara a cara, {p} toca na saída de {g}… e a bola sai rente à trave!', '{p} fica sozinho com {g} e manda para fora!'],
    post: ['NA TRAVE! {p} tira de {g} e a bola explode no poste!', 'Cara a cara, {p} toca por cima de {g}… e acerta o travessão!'],
  },
  round_gk: {
    goal: ['GOOOL! {p} dribla {g} e entra com bola e tudo!', 'É GOL! {p} deixa {g} no chão e empurra para a rede vazia!'],
    save: ['{p} tenta driblar {g}, que se joga nos pés dele e fica com a bola.', '{g} não cai no drible e abafa a jogada de {p}.'],
    wide: ['{p} passa por {g}, mas fica sem ângulo e chuta para fora.', '{p} dribla {g} e demora: o zagueiro volta e trava em cima da linha.'],
    post: ['{p} dribla {g} e chuta de ângulo difícil… na trave!'],
  },
  long: {
    goal: ['GOLAÇO DE {P}! Arriscou de longe e acertou o ângulo!', 'GOOOL! {p} acerta um chutaço de fora da área!'],
    save: ['{p} arrisca de longe e {g} encaixa sem problemas.', 'Chute de fora da área de {p}; {g} voa e espalma.'],
    wide: ['{p} arrisca de longe, por cima do travessão.', 'Chute de fora da área de {p} que sai longe do gol.'],
    post: ['De longe! {p} solta o pé e a bola explode no travessão!'],
  },
  cut_back: {
    goal: ['GOOOL! {p} corta para dentro e finaliza no canto!', 'É GOL! {p} puxa para o pé bom e não perdoa!'],
    save: ['{p} corta para dentro e chuta; {g} defende no canto.', 'Finalização de {p} depois do corte, e {g} segura.'],
    wide: ['{p} corta o marcador e chuta, mas a bola sai à esquerda.', '{p} puxa para dentro e finaliza mal, para fora.'],
    post: ['{p} corta para dentro, bate colocado… e acerta a trave!'],
  },
  header: {
    goal: ['GOOOL! {p} sobe mais que todo mundo e cabeceia para a rede!', 'É GOL de cabeça! {p} testa firme, sem chance para {g}!'],
    save: ['{p} cabeceia firme e {g} faz grande defesa!', 'Cabeçada de {p} no canto, mas {g} se estica e espalma.'],
    wide: ['Uuuh! {p} cabeceia e a bola sai tirando tinta do poste.', '{p} sobe sozinho, mas cabeceia por cima do gol.'],
    post: ['Cabeçada de {p} no travessão!', 'NA TRAVE! {p} testa firme e a bola carimba o poste!'],
  },
  fk: {
    goal: ['GOLAÇO DE FALTA! {p} passa a bola por cima da barreira e mata {g}!', 'GOOOL! Cobrança perfeita de {p}, no ângulo de {g}!'],
    save: ['{p} bate a falta por cima da barreira e {g} voa para espalmar!', 'Cobrança de falta de {p} no canto; {g} defende.'],
    wide: ['{p} bate a falta e a bola passa por cima do gol.', 'A cobrança de {p} explode na barreira.'],
    post: ['A cobrança de falta de {p} explode no travessão!', 'NA TRAVE! A falta de {p} passa pela barreira e carimba o poste!'],
  },
}

/** Finalização do companheiro depois do seu passe: de cabeça (cruzamento) ou com os pés (passe rasteiro). */
export const ASSIST_TEXT = {
  cross: {
    goal: ['GOOOL! Cruzamento de {a} na medida e {p} cabeceia para a rede!', 'É GOL do {t}! {a} levanta na área e {p} completa de cabeça!'],
    save: ['{p} cabeceia o cruzamento e {g} defende.', '{p} sobe para o cabeceio, mas {g} segura.'],
    wide: ['{p} cabeceia o cruzamento por cima do gol.', '{p} chega atrasado e a cabeçada sai fraca, para fora.'],
  },
  ground: {
    goal: ['GOOOL! Passe açucarado de {a} e {p} só completa!', 'É GOL do {t}! Assistência de {a}, conclusão de {p}!', 'GOL! Visão de jogo de {a}, que deixa {p} na cara do gol!'],
    save: ['{p} recebe o passe e finaliza, mas {g} defende.', 'Passe na medida e {p} chuta; {g} faz a defesa.'],
    wide: ['{p} recebe na área e finaliza para fora.', 'Passe perfeito, mas {p} pega mal e a bola sai.'],
  },
} as const

/** Opções de passe que terminam em cabeceio do companheiro. */
export const CROSS_OPTIONS = new Set(['cross_high', 'fk_cross', 'nod_down'])

/** Descrições de lances-chave por situação. */
export const MOMENT_DESC: Record<string, readonly string[]> = {
  shot: [
    '{a} ajeita na entrada da área e a bola sobra limpa para você. {d} vem fechando.',
    'Rebote na meia-lua! Você domina com {d} na cola.',
    'Você recebe de costas, gira e tem espaço para finalizar.',
  ],
  one_on_one: [
    '{a} enfia na medida e você sai cara a cara com {g}!',
    'Lançamento longo, você ganha na corrida de {d} e fica sozinho diante de {g}.',
    'Erro na saída de bola do {o}! Você rouba e parte livre para o gol.',
  ],
  dribble: [
    'Você recebe aberto, {d} no mano a mano.',
    'Bola nos seus pés na intermediária, dois marcadores do {o} à frente.',
    'Contra-ataque! Você conduz em velocidade com {d} voltando.',
  ],
  pass: [
    'Você tem a bola no meio. {a} pede na frente.',
    'O {o} está recuado; você observa as opções com calma.',
    'Pivô: você segura a bola de costas, {a} se aproxima.',
  ],
  through_ball: [
    'Você levanta a cabeça: {a} dá o pique nas costas de {d}.',
    'Espaço entre as linhas do {o}. {a} faz a diagonal.',
  ],
  cross: [
    'Você chega ao fundo pela lateral. {a} e mais dois na área.',
    'Bola aberta para você na ponta; a área está cheia.',
  ],
  header: [
    'Escanteio para o seu time. Você sobe para a área.',
    'Cobrança de falta lateral na cabeça… você se posiciona entre os zagueiros.',
  ],
  free_kick: ['Falta perigosa na entrada da área. A bola é sua.', 'Falta frontal, a 22 metros. Barreira armada por {g}.'],
  penalty: ['PÊNALTI para o seu time! Você pega a bola. {g} no gol.', 'O árbitro aponta a marca da cal! A responsabilidade é sua.'],
  tackle: ['{d} parte em velocidade para cima de você.', 'Contra-ataque do {o}! {d} conduz e você é o último homem.', '{d} tenta o drible na sua frente.'],
  interception: ['O {o} troca passes na intermediária. Você lê a jogada.', 'Passe longo do {o} procurando {d}.'],
  block: ['{d} arma o chute na entrada da área!', 'Bola sobra para {d}, que vai finalizar de primeira.'],
  save: ['{d} chuta forte de fora da área!', '{d} aparece livre na área e cabeceia!', 'Cara a cara: {d} sai sozinho na sua frente!'],
  penalty_save: ['Pênalti para o {o}. {d} vai cobrar. Você é o goleiro.', 'O árbitro marca pênalti contra o seu time. {d} ajeita a bola.'],
}

export const RESULT_TEXT = {
  goal: ['GOOOL! Você decide!', 'Na rede! Que finalização!', 'É GOL! Estádio em festa!'],
  miss: ['Para fora! Não foi dessa vez.', 'O goleiro defendeu.', 'Por cima do gol.'],
  // o texto do resultado segue o lance narrado (defesa, para fora, na trave)
  missSaved: ['O goleiro defendeu.', 'Parou no goleiro.', 'Defesa do goleiro. Não foi dessa vez.'],
  missWide: ['Para fora! Não foi dessa vez.', 'Por cima do gol.', 'Tirou tinta da trave, mas foi para fora.'],
  missPost: ['Na trave! Por muito pouco.', 'Carimbou a trave!'],
  assist: ['Passe perfeito — e é GOL do companheiro!', 'Assistência! O companheiro só empurrou.'],
  chance: ['Passe certo, mas a finalização não entrou.', 'Boa jogada criada, o goleiro salvou.'],
  chanceSaved: ['Boa jogada criada, o goleiro salvou.', 'Passe certo, mas o goleiro defendeu.'],
  chanceWide: ['Passe certo, mas a finalização saiu para fora.', 'Boa jogada criada, a bola não entrou.'],
  passFail: ['Passe interceptado.', 'A bola não chegou.'],
  dribbleOk: ['Passou! Você deixa o marcador para trás.', 'Drible desconcertante!'],
  dribbleFail: ['Desarmado.', 'O marcador levou a melhor.'],
  oneTwoOk: ['Tabela perfeita! A bola volta e você sai na frente.', 'Tabelou! Você recebe de volta com espaço.'],
  oneTwoFail: ['Passe cortado.', 'A tabela não saiu: cortaram o passe.'],
  foulFail: ['O árbitro mandou seguir.', 'Não convenceu o árbitro: jogo segue.'],
  stop: ['Desarme limpo! Bola recuperada.', 'Cortou! Perigo afastado.', 'Leitura perfeita, bola roubada.'],
  stopFail: ['Passou por você…', 'Chegou atrasado.'],
  save: ['DEFESAÇA!', 'Espalmou!', 'Segurou firme!'],
  concede: ['Não deu para alcançar.', 'A bola entrou.'],
}
