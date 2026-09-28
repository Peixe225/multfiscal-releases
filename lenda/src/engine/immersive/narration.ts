/**
 * Banco de narração pt-BR (estilo transmissão de TV/rádio). Cada função sorteia uma variante com o
 * Rng recebido e troca os marcadores: {p} jogador, {a} quem deu o passe, {t} time, {o} adversário,
 * {g} goleiro, {s} placar, {m} minuto.
 */
import type { Rng } from '../rng'

export type Vars = Record<string, string | number | undefined>

export function fill(tpl: string, v: Vars): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''))
}

export function say(r: Rng, list: readonly string[], v: Vars = {}): string {
  return fill(r.pick(list), v)
}

export const T = {
  kickoff: [
    'Bola rolando! {h} e {aw} começam a partida{st}.',
    'Autorizou o árbitro, começa o jogo{st}: {h} × {aw}.',
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
    'Bola na rede! {p} aproveita o rebote e amplia a vibração da torcida.',
    'GOOOL! Chute de fora da área de {p}, no ângulo!',
    'GOL do {t}! Tabela rápida e {p} só empurra.',
    'É do {t}! {p} bate colocado no canto.',
    'GOL! {a} rouba no meio, toca para {p}, que não perdoa.',
  ],
  goalUser: [
    'GOOOOOL! É DELE! {p} decide e explode a arquibancada!',
    'GOLAÇO DE {P}! Que finalização!',
    'É GOL! {p} não perdoa e deixa sua marca!',
    'GOOOL! {p} bate com categoria e corre para a torcida!',
    'Balançou a rede! {p} faz o dele!',
    'GOL, GOL, GOL! {p} marca e o estádio vem abaixo!',
  ],
  goalAssistUser: [
    'GOOOL! Passe açucarado de {a} e {p} só completa!',
    'É GOL do {t}! Assistência de {a}, conclusão de {p}!',
    'GOL! Visão de jogo de {a}, que deixa {p} na cara do gol!',
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
  subDouble: [
    'Dupla substituição no {t}: entram {p} e {p2}; saem {a} e {a2}.',
    'O técnico do {t} mexe duas vezes: {p} e {p2} nos lugares de {a} e {a2}.',
    'Duas trocas de uma vez no {t}: {a} e {a2} dão lugar a {p} e {p2}.',
  ],
  var: ['O VAR revisa o lance… jogo segue.', 'Checagem do VAR em possível pênalti: nada marcado.', 'Árbitro consulta o VAR e mantém a decisão de campo.'],
  injury: ['{p} sente a coxa e pede atendimento.', 'Preocupação: {p} cai no gramado e recebe atendimento médico.'],
  userSubOn: ['Entra {p}! A torcida aplaude a mudança. Sai {a}.', 'É a sua vez: {p} entra no lugar de {a}.', 'O técnico chama {p}, que entra no lugar de {a}.'],
  userSubOff: ['Sai {p}, aplaudido, para a entrada de {a}.', '{p} deixa o campo e dá lugar a {a}.', 'Fim de jogo para {p}: entra {a}.'],
  userAskOff: ['{p} pede para sair, sentindo o cansaço. Entra {a}.'],
}

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
  assist: ['Passe perfeito — e é GOL do companheiro!', 'Assistência! O companheiro só empurrou.'],
  chance: ['Passe certo, mas a finalização não entrou.', 'Boa jogada criada, o goleiro salvou.'],
  passFail: ['Passe interceptado.', 'A bola não chegou.'],
  dribbleOk: ['Passou! Você deixa o marcador para trás.', 'Drible desconcertante!'],
  dribbleFail: ['Desarmado.', 'O marcador levou a melhor.'],
  stop: ['Desarme limpo! Bola recuperada.', 'Cortou! Perigo afastado.', 'Leitura perfeita, bola roubada.'],
  stopFail: ['Passou por você…', 'Chegou atrasado.'],
  save: ['DEFESAÇA!', 'Espalmou!', 'Segurou firme!'],
  concede: ['Não deu para alcançar.', 'A bola entrou.'],
}
