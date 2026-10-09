/**
 * Imprensa, redes sociais, notícias e caixa de entrada (veículos FICTÍCIOS).
 *
 * Coletiva: 2–3 perguntas por contexto (pré-jogo grande, clássico, fase boa/ruim, banco, rumor de
 * transferência, seleção, final). Tons: humilde (mídia/técnico +), confiante (moral/torcida +),
 * provocador (torcida ++, mídia/técnico/vestiário −), evasivo (mídia −). Pular a coletiva: mídia −4.
 * Posts do jogador: modelos com efeito em torcida/mídia/técnico/moral/seguidores (na mesma semana
 * cada post rende metade do anterior; "foco no treino" mexe com o técnico no máx. 1× a cada 4 semanas).
 */
import type { Rng } from '../rng'
import type { GameData } from '../types'
import { callUpOvr } from '../career/util'
import type { CalendarItem, ImmersiveEffect, ImmersiveState, InboxMessage, NewsItem, PressQuestion, SocialPost } from './types'
import { mem, type Deltas } from './mem'
import { artigo, cap, clamp, clubOf, irng, leagueById, nextId, pl, slug, teamShort, trng, withArt } from './util'

export const OUTLETS = ['LENDA TV', 'Rádio Arquibancada', 'Diário da Bola', 'Portal Camisa 10', 'Jornal do Gramado', 'Canal Resenha'] as const
export const JOURNALISTS = ['Paulo Viana', 'Marta Queiroz', 'Rogério Lins', 'Ana Beatriz Luz', 'Tadeu Falcão', 'Júlia Sampaio', 'Caio Mendonça', 'Renata Borges']

const MAX_FEED = 60
const MAX_INBOX = 80

export function addNews(s: ImmersiveState, headline: string, tone: NewsItem['tone'], fx?: ImmersiveEffect[], o: { outlet?: string; body?: string; aboutUser?: boolean; clubId?: string } = {}): NewsItem {
  // a mesma manchete não sai duas vezes seguidas no feed
  const dup = s.news.slice(0, 12).find((n) => n.season === s.season && n.headline === headline)
  if (dup) return dup
  const r = trng(s, 'news', mem(s).idSeq ?? 0)
  const item: NewsItem = {
    id: nextId(s, 'nw'),
    season: s.season,
    week: s.week,
    headline,
    outlet: o.outlet ?? r.pick(OUTLETS),
    tone,
    aboutUser: o.aboutUser ?? true,
  }
  if (o.body) item.body = o.body
  if (o.clubId) item.clubId = o.clubId
  s.news = cap([item, ...s.news], MAX_FEED)
  if (fx) fx.push({ type: 'news', item })
  return item
}

export function addPost(
  s: ImmersiveState,
  author: string,
  handle: string,
  text: string,
  tone: SocialPost['tone'],
  o: { verified?: boolean; likes?: number; reposts?: number; byUser?: boolean } = {},
): SocialPost {
  const p: SocialPost = {
    id: nextId(s, 'sp'),
    season: s.season,
    week: s.week,
    author,
    handle,
    text,
    likes: Math.max(0, Math.round(o.likes ?? 0)),
    reposts: Math.max(0, Math.round(o.reposts ?? 0)),
    tone,
  }
  if (o.byUser) p.byUser = true
  if (o.verified) p.verified = true
  s.social = cap([p, ...s.social], MAX_FEED)
  return p
}

export function addInbox(s: ImmersiveState, from: string, subject: string, body: string, extra: Partial<InboxMessage> = {}): InboxMessage {
  const msg: InboxMessage = { id: nextId(s, 'ib'), season: s.season, week: s.week, from, subject, body, read: false, ...extra }
  s.inbox = cap([msg, ...s.inbox], MAX_INBOX)
  return msg
}

/** Aplica variações de relação/condição (0–100). */
export function applyDeltas(s: ImmersiveState, d: Deltas): void {
  const R = s.relationships
  const C = s.condition
  if (d.coach) R.coach = clamp(Math.round((R.coach + d.coach) * 10) / 10, 0, 100)
  if (d.teammates) R.teammates = clamp(Math.round((R.teammates + d.teammates) * 10) / 10, 0, 100)
  if (d.fans) R.fans = clamp(Math.round((R.fans + d.fans) * 10) / 10, 0, 100)
  if (d.media) R.media = clamp(Math.round((R.media + d.media) * 10) / 10, 0, 100)
  if (d.morale) C.morale = clamp(Math.round((C.morale + d.morale) * 10) / 10, 0, 100)
  if (d.form) C.form = clamp(Math.round((C.form + d.form) * 10) / 10, 0, 100)
  if (d.fitness) C.fitness = clamp(Math.round((C.fitness + d.fitness) * 10) / 10, 0, 100)
  if (d.reputation) s.reputation = clamp(Math.round((s.reputation + d.reputation) * 10) / 10, 0, 100)
  if (d.followers) s.followers = Math.max(0, Math.round((s.followers ?? 0) + d.followers))
}

export function deltaLabels(d: Deltas): string[] {
  const L: [keyof Deltas, string][] = [
    ['fans', 'Torcida'],
    ['media', 'Imprensa'],
    ['coach', 'Técnico'],
    ['teammates', 'Vestiário'],
    ['morale', 'Moral'],
    ['followers', 'Seguidores'],
  ]
  const out: string[] = []
  for (const [k, label] of L) {
    const v = d[k]
    if (!v) continue
    const sign = v > 0 ? '+' : '−'
    const n = Math.abs(Math.round(v))
    // efeito pequeno (|v| < 0,5) sai só com o sinal, nunca "−0"
    out.push(k === 'followers' || !n ? `${label} ${sign}` : `${label} ${sign}${n}`)
  }
  return out
}

// ───────────────────────── coletiva ─────────────────────────

type Tone = PressQuestion['answers'][number]['tone']

interface QDef {
  /** Chave estável (não repetir a mesma pergunta em 4 semanas). */
  key: string
  when: (c: PressCtx) => boolean
  /** Variantes da pergunta e das respostas (uma é sorteada em cada coletiva). */
  q: string[]
  a: Partial<Record<Tone, string[]>>
  /** Pergunta genérica (sempre cabe): só completa a coletiva. */
  generic?: boolean
}

interface PressCtx {
  opp: string
  big: boolean
  final: boolean
  derby: boolean
  goals: number
  dry: number
  bench: boolean
  rumor: string | null
  national: boolean
  titleRace: boolean
  club: string
  /** Reta final da liga (≥ 75% das rodadas): sem "muito campeonato pela frente". */
  late: boolean
  zone: 'relegation' | 'promotion' | null
  /** Sequência atual do clube: vitórias (+) ou jogos sem vencer (−). */
  streak: number
  last: 'win' | 'draw' | 'loss' | null
  /** Voltando de lesão (ainda sem jogar desde a lesão). */
  back: boolean
  young: boolean
}

/**
 * Tons (cada um com ganho e custo): humilde agrada imprensa/técnico, mas soa morno (moral −, torcida
 * quer sangue em jogo grande); confiante sobe moral/torcida e custa com o técnico quando se está no
 * banco; provocador incendeia a torcida e queima imprensa/técnico/vestiário; evasivo protege o grupo
 * (técnico +) e irrita a imprensa.
 */
const TONE_FX: Record<Tone, Deltas> = {
  humilde: { media: 2, coach: 1.2, teammates: 1, fans: 0.5, morale: -1 },
  confiante: { morale: 3, fans: 2, media: 1, coach: -0.3, followers: 400 },
  provocador: { fans: 4, media: -4, coach: -2, teammates: -1.5, followers: 1500, morale: 1 },
  evasivo: { media: -2.5, coach: 0.6, morale: 1 },
}

/**
 * Banco de perguntas: contexto (final, clássico, jogo grande, fase, tabela, sequência, lesão, idade,
 * rumor, seleção) + duas genéricas. Variáveis: {oo}/{OO} adversário com artigo, {pelo}, {gols},
 * {n} jogos sem marcar, {k} sequência, {pos}, {dor} "do/da clube do rumor", {aor}, {oclub}.
 */
const QUESTIONS: QDef[] = [
  {
    key: 'final',
    when: (c) => c.final,
    q: ['É final. O que passa pela sua cabeça a poucos dias da decisão?', 'Decisão contra {oo}. Qual é o segredo para jogar uma final?', 'Final contra {oo}. Dá para dormir bem antes de um jogo desses?'],
    a: {
      humilde: ['“Respeito total {pelo}. É trabalhar e fazer o simples.”', '“Final se joga com a cabeça no lugar. Pé no chão e foco.”', '“Ninguém ganha final na véspera. Vamos com humildade.”'],
      confiante: ['“Nasci para jogar esse tipo de jogo. Vamos levantar essa taça.”', '“Estou pronto. Final é o lugar onde eu quero estar.”', '“A gente chegou até aqui para ser campeão.”'],
      provocador: ['“Eles que se preocupem com a gente. A taça tem dono.”', '“Podem ir preparando a faixa… para nós.”', '“Final é com a gente. Eles já sabem disso.”'],
      evasivo: ['“Prefiro não falar de título antes da hora.”', '“Falo depois do jogo.”', '“É um jogo de cada vez. Vamos ver.”'],
    },
  },
  {
    key: 'derby',
    when: (c) => c.derby,
    q: ['Semana de clássico contra {oo}. O que muda no vestiário?', 'Clássico é jogo à parte. Como você se prepara para enfrentar {oo}?', 'A cidade só fala do clássico. Você sente essa pressão?'],
    a: {
      humilde: ['“Clássico se ganha no detalhe. Muito respeito por eles.”', '“É um jogo diferente, mas a preparação é a mesma de sempre.”', '“A gente sabe o tamanho do jogo. Vamos com respeito.”'],
      confiante: ['“A gente está pronto. Quem estiver melhor vai ganhar — e somos nós.”', '“Gosto desse tipo de jogo. Vou deixar a minha marca.”', '“A cidade vai ser nossa depois do apito final.”'],
      provocador: ['“Clássico? Pra mim são só mais três pontos.”', '“Eles falam muito. Dentro de campo a conversa é outra.”', '“Já estão com medo, dá para sentir.”'],
      evasivo: ['“Cada jogo tem sua história. Vamos ver no campo.”', '“Não vou alimentar rivalidade.”', '“O que eu tenho para falar, falo no gramado.”'],
    },
  },
  {
    key: 'big',
    when: (c) => c.big && !c.final,
    q: ['{OO} vem forte. Como vocês se preparam para um jogo desse tamanho?', 'Jogo grande contra {oo}. O time está pronto?', 'Muita gente vê vocês como zebra contra {oo}. Isso incomoda?'],
    a: {
      humilde: ['“Com muito respeito e trabalho. Eles têm grandes jogadores.”', '“Sabemos da qualidade deles. Vamos com os pés no chão.”', '“Jogo grande pede concentração total. É o que vamos ter.”'],
      confiante: ['“Jogo grande é onde a gente mostra quem é. Estamos prontos.”', '“Respeito, sim; medo, nenhum. Vamos para vencer.”', '“É nesses jogos que eu gosto de aparecer.”'],
      provocador: ['“Forte? Vamos ver depois dos 90 minutos.”', '“Favorito no papel não ganha jogo.”', '“Vão sentir o peso da nossa camisa.”'],
      evasivo: ['“O professor vai decidir a estratégia. Eu só quero jogar.”', '“Não fico pensando no adversário.”', '“Vamos ver dentro de campo.”'],
    },
  },
  {
    key: 'goals',
    when: (c) => c.goals >= 5,
    q: ['Você já tem {gols} na temporada. É o melhor momento da sua carreira?', 'São {gols} na temporada. Qual é o segredo dessa fase?', 'Com {gols} no ano, dá para sonhar com a artilharia?'],
    a: {
      humilde: ['“Os gols são do grupo. Sem os companheiros eu não faço nada.”', '“Fico feliz, mas o mais importante é o time vencer.”', '“Gol é consequência do trabalho de todo mundo.”'],
      confiante: ['“Estou me sentindo muito bem. E vem mais por aí.”', '“Estou no meu melhor momento. Quero mais.”', '“A artilharia é consequência. E eu quero chegar lá.”'],
      provocador: ['“Quem duvidava de mim deve estar quieto agora.”', '“Falaram muito de mim. Os números respondem.”', '“Quem quiser me parar vai ter que suar.”'],
      evasivo: ['“Não fico contando gols. Penso no próximo jogo.”', '“Números eu deixo para vocês.”', '“Prefiro falar do time.”'],
    },
  },
  {
    key: 'dry',
    when: (c) => c.dry >= 5,
    q: ['São {n} jogos sem marcar. Isso te incomoda?', 'O gol não sai há {n} jogos. O que está faltando?', 'A torcida cobra o seu gol. Como lidar com essa seca?'],
    a: {
      humilde: ['“Faz parte. Vou continuar trabalhando que o gol volta.”', '“Preciso melhorar, e vou melhorar. Trabalho não falta.”', '“O importante é ajudar o time. O gol vai sair.”'],
      confiante: ['“Fase passa. Quando sair o primeiro, vão sair vários.”', '“Não perdi o faro. Logo, logo a bola entra.”', '“Atacante vive de fase. A minha boa vai voltar já.”'],
      provocador: ['“Incomoda mais vocês do que a mim.”', '“Vocês contam os jogos; eu conto os dias para calar todo mundo.”', '“Seca? Esperem a chuva.”'],
      evasivo: ['“Estou ajudando o time de outras formas.”', '“Não vou entrar nessa.”', '“Próxima pergunta.”'],
    },
  },
  {
    key: 'bench',
    when: (c) => c.bench,
    q: ['Você tem começado no banco. Está satisfeito com as escolhas do técnico?', 'Pouco tempo em campo nos últimos jogos. Como você lida com isso?', 'O banco incomoda? Você pediu explicações ao técnico?'],
    a: {
      humilde: ['“O professor sabe o que faz. Vou mostrar nos treinos.”', '“Respeito a decisão. Quando a chance vier, vou estar pronto.”', '“Banco faz parte. Meu trabalho é estar preparado.”'],
      confiante: ['“Quando eu entro, eu resolvo. A vaga vai vir.”', '“Sei do meu potencial. Logo estou no time titular.”', '“Uma chance e eu não saio mais do time.”'],
      provocador: ['“Não entendo, mas não sou eu que escalo.”', '“Tem coisa que nem eu consigo explicar.”', '“Perguntem para o técnico, não para mim.”'],
      evasivo: ['“Isso é assunto interno.”', '“Prefiro não comentar.”', '“Converso com o professor no dia a dia.”'],
    },
  },
  {
    key: 'rumor',
    when: (c) => !!c.rumor,
    q: ['Há rumores de interesse {dor}. Você fica?', 'O seu nome foi ligado {aor}. Existe negociação?', 'Fala-se muito de uma proposta {dor}. Vai sair na janela?'],
    a: {
      humilde: ['“Estou feliz aqui. Meu foco é {oclub}.”', '“Tenho contrato e respeito {oclub}. Só penso no próximo jogo.”', '“Fico feliz com o interesse, mas a minha cabeça está aqui.”'],
      confiante: ['“Quem joga bem é procurado. Meu empresário cuida disso.”', '“É sinal de que estou no caminho certo.”', '“Interesse sempre vai ter. Eu sigo fazendo a minha parte.”'],
      provocador: ['“Quem sabe? Grandes clubes querem grandes jogadores.”', '“Se a proposta for boa, a gente conversa.”', '“Valorizem enquanto eu estou aqui.”'],
      evasivo: ['“Não comento especulação.”', '“Isso é com o meu empresário.”', '“Não sei de nada disso.”'],
    },
  },
  {
    key: 'national',
    when: (c) => c.national,
    q: ['Você pensa em seleção?', 'Dá para sonhar com uma convocação para a seleção?', 'A comissão técnica da seleção está de olho. Isso mexe com você?'],
    a: {
      humilde: ['“Seria um sonho, mas primeiro tenho que fazer por onde no clube.”', '“Penso, claro. Mas o caminho passa pelo meu clube.”', '“Todo jogador sonha com isso. Vou continuar trabalhando.”'],
      confiante: ['“Estou pronto para vestir a camisa. É questão de tempo.”', '“Acho que já mereço uma chance.”', '“Quando chamarem, vou agarrar.”'],
      provocador: ['“Se não me chamarem, o problema não é meu.”', '“Tem gente lá que joga menos que eu.”', '“Os números estão aí. Quem quiser, que veja.”'],
      evasivo: ['“Deixo isso para a comissão técnica.”', '“Não penso nisso agora.”', '“Um passo de cada vez.”'],
    },
  },
  {
    key: 'title',
    when: (c) => c.titleRace && !c.late,
    q: ['O time briga lá em cima. Dá para falar em título?', 'Vocês estão entre os primeiros. Já dá para sonhar?', '{pos}º lugar na tabela. O grupo já pensa no título?'],
    a: {
      humilde: ['“Tem muito campeonato pela frente. Jogo a jogo.”', '“Ainda é cedo. A tabela só vale no fim.”', '“A gente pensa no próximo jogo, não no título.”'],
      confiante: ['“Dá, sim. Esse grupo tem cara de campeão.”', '“A gente acredita. E vai até o fim.”', '“Ninguém chega aqui por acaso. Vamos buscar.”'],
      provocador: ['“Os outros que corram atrás. O título é nosso.”', '“Podem ir se acostumando a ver a gente lá em cima.”', '“Quem está atrás que se preocupe.”'],
      evasivo: ['“Não gosto de fazer contas.”', '“Tabela é para o fim do campeonato.”', '“Vamos ver no fim.”'],
    },
  },
  {
    key: 'title_late',
    when: (c) => c.titleRace && c.late,
    q: ['Reta final e o time na briga pelo título. Como segurar a ansiedade?', 'Faltam poucas rodadas. O título está nas mãos de vocês?', '{pos}º lugar com o campeonato acabando. Cada jogo é uma final?'],
    a: {
      humilde: ['“Faltam poucas rodadas, e cada jogo vira uma final.”', '“Agora é jogo a jogo, sem olhar para a calculadora.”', '“Estamos perto, mas ainda não ganhamos nada.”'],
      confiante: ['“Está nas nossas mãos, e a gente não vai deixar escapar.”', '“Esse grupo nasceu para esse momento.”', '“Vamos ganhar todas até o fim.”'],
      provocador: ['“Quem está atrás pode desistir.”', '“A taça já sabe para onde vai.”', '“Pressão é para quem está correndo atrás.”'],
      evasivo: ['“Não faço contas.”', '“Falo quando acabar.”', '“O campeonato não terminou.”'],
    },
  },
  {
    key: 'relegation',
    when: (c) => c.zone === 'relegation',
    q: ['O time está na zona de rebaixamento. O que precisa mudar?', 'A briga agora é para não cair. O vestiário sente a pressão?', 'A torcida está preocupada com o rebaixamento. Qual é o recado?'],
    a: {
      humilde: ['“Momento difícil. É trabalhar em silêncio e somar pontos.”', '“Cada um tem que dar um pouco mais. Eu começo por mim.”', '“Ninguém aqui está satisfeito. Vamos sair dessa juntos.”'],
      confiante: ['“Esse time não vai cair. Eu garanto que vamos sair dessa.”', '“Temos elenco para estar bem mais acima. Vamos reagir.”', '“Uma vitória muda tudo. E ela vem já.”'],
      provocador: ['“Tem gente que já nos enterrou. Vão ter que engolir.”', '“Quem quiser descer que desça. Nós não.”', '“Joguem a pá de cal depois. Por enquanto, estamos vivos.”'],
      evasivo: ['“Não vou olhar a tabela agora.”', '“O foco é o próximo jogo, só isso.”', '“Prefiro não falar em rebaixamento.”'],
    },
  },
  {
    key: 'promotion',
    when: (c) => c.zone === 'promotion',
    q: ['O time está na zona de acesso. Dá para pensar na subida?', 'O acesso está perto. Como segurar a ansiedade?'],
    a: {
      humilde: ['“Ainda falta muito. É pensar jogo a jogo.”', '“A subida se constrói rodada a rodada.”'],
      confiante: ['“Esse time tem lugar na elite. Vamos subir.”', '“O lugar desse clube é lá em cima. E é para lá que a gente vai.”'],
      provocador: ['“Pode avisar a divisão de cima: estamos chegando.”', '“Quem estiver atrás da gente que se preocupe.”'],
      evasivo: ['“Não penso em acesso agora.”', '“A conta a gente faz no fim.”'],
    },
  },
  {
    key: 'win_streak',
    when: (c) => c.streak >= 3,
    q: ['São {k} vitórias seguidas. O que explica a boa fase?', 'O time embalou: {k} vitórias em sequência. Até onde dá para ir?'],
    a: {
      humilde: ['“Trabalho e união. Ninguém aqui se acha melhor que ninguém.”', '“É manter o pé no chão. Sequência não ganha título.”'],
      confiante: ['“Esse time está voando. E vai continuar.”', '“Quem ganha uma vez sabe o caminho. Queremos mais.”'],
      provocador: ['“Quem é o próximo da fila?”', '“Os outros que se acostumem.”'],
      evasivo: ['“Não fico contando sequência.”', '“Próximo jogo, só isso.”'],
    },
  },
  {
    key: 'bad_run',
    when: (c) => c.streak <= -3,
    q: ['O time não vence há {k} jogos. O que está acontecendo?', 'Fase ruim: {k} jogos sem vitória. Como sair dela?'],
    a: {
      humilde: ['“Momento ruim, e a gente assume. É trabalhar para virar.”', '“Cada um precisa olhar para si. Eu sou o primeiro.”'],
      confiante: ['“Fase ruim passa. Esse grupo é forte e vai reagir.”', '“A virada começa no próximo jogo.”'],
      provocador: ['“Tem gente torcendo contra. Vão ter de esperar sentados.”', '“Quem pulou do barco vai querer voltar.”'],
      evasivo: ['“Isso a gente resolve internamente.”', '“Não vou apontar culpados.”'],
    },
  },
  {
    key: 'injury_back',
    when: (c) => c.back,
    q: ['Você volta de lesão. Como está a parte física?', 'Depois da lesão, você se sente cem por cento?'],
    a: {
      humilde: ['“Estou bem, mas ainda buscando o ritmo. Vou com calma.”', '“Foi um período difícil. Agradeço ao departamento médico.”'],
      confiante: ['“Voltei melhor do que antes. Podem esperar o de sempre.”', '“Estou cem por cento. Só quero jogar.”'],
      provocador: ['“Quem achou que eu não voltaria vai se surpreender.”', '“Teve gente comemorando a minha lesão. Voltei.”'],
      evasivo: ['“O departamento médico fala sobre isso.”', '“Estou à disposição. É o que importa.”'],
    },
  },
  {
    key: 'young',
    when: (c) => c.young,
    q: ['Você é um dos mais jovens do elenco. Como lida com a expectativa?', 'Tão novo e já no profissional. Quem te aconselha no vestiário?'],
    a: {
      humilde: ['“Escuto muito os mais experientes. Estou aprendendo todo dia.”', '“Sou só um garoto querendo ajudar. Os mais velhos me ajudam muito.”'],
      confiante: ['“Idade não entra em campo. Estou pronto.”', '“Vim para ficar. A minha hora vai chegar.”'],
      provocador: ['“Tem veterano que não corre o que eu corro.”', '“Idade é só número. Quero a vaga.”'],
      evasivo: ['“Penso no meu trabalho, só isso.”', '“Deixo a expectativa para vocês.”'],
    },
  },
  {
    key: 'after_loss',
    when: (c) => c.last === 'loss' && c.streak > -3,
    q: ['O time vem de derrota. Como reagir contra {oo}?', 'Depois do último resultado, o que o grupo conversou?'],
    a: {
      humilde: ['“Derrota dói. Temos que aprender e virar a chave.”', '“Conversamos muito. Cada um sabe onde errou.”'],
      confiante: ['“É vida que segue. A resposta vem em campo.”', '“Esse grupo sabe reagir. Vocês vão ver.”'],
      provocador: ['“Quem comemorou a nossa derrota vai se arrepender.”', '“Perdemos um jogo, não a vontade.”'],
      evasivo: ['“O que se conversa no vestiário fica no vestiário.”', '“Já passou. Foco no próximo.”'],
    },
  },
  {
    key: 'after_win',
    when: (c) => c.last === 'win' && c.streak < 3,
    q: ['O time vem de vitória. Dá para manter o embalo contra {oo}?', 'Boa vitória no último jogo. O que ficou de lição?'],
    a: {
      humilde: ['“Uma vitória não muda nada se a gente não repetir.”', '“Foi bom, mas temos muito a melhorar.”'],
      confiante: ['“O time está confiante. Queremos mais uma.”', '“A gente pegou o jeito. Agora é manter.”'],
      provocador: ['“Quem vem pela frente que se prepare.”', '“Do jeito que estamos, ninguém segura.”'],
      evasivo: ['“Já virou a página.”', '“Cada jogo é uma história.”'],
    },
  },
  {
    key: 'mood',
    generic: true,
    when: () => true,
    q: ['Como está o clima no elenco para o jogo contra {oo}?', 'O que você espera do jogo contra {oo}?', 'Como você vê {oo} para esta partida?'],
    a: {
      humilde: ['“Grupo unido, todo mundo trabalhando junto.”', '“Jogo difícil. Eles têm qualidade e a gente respeita.”', '“Semana boa de treinos. Vamos com respeito.”'],
      confiante: ['“Clima de vitória. A gente sabe o nosso potencial.”', '“Vamos para cima deles desde o primeiro minuto.”', '“Estamos prontos para vencer.”'],
      provocador: ['“Melhor do que o clima lá do lado deles, com certeza.”', '“Eles que se preocupem com a gente.”', '“Respeito? Vão ter que conquistar no campo.”'],
      evasivo: ['“Normal, semana de trabalho.”', '“Vamos ver no jogo.”', '“Nada de especial para falar.”'],
    },
  },
  {
    key: 'fans',
    generic: true,
    when: () => true,
    q: ['O que o torcedor pode esperar de você nesta semana?', 'Qual é o recado para a torcida antes do jogo?', 'A torcida está com vocês. O que você promete para ela?'],
    a: {
      humilde: ['“Entrega total. É o mínimo que eu posso dar.”', '“Muita luta. O resto é consequência.”', '“Que continuem apoiando. A gente vai dar tudo.”'],
      confiante: ['“Pode esperar gol e vitória.”', '“Vou fazer a diferença. Podem confiar.”', '“Podem vir confiantes. Vai ser dia de festa.”'],
      provocador: ['“Espetáculo. Tragam os amigos.”', '“Vai ter show. E não vai ser do outro lado.”', '“Quem não for vai se arrepender.”'],
      evasivo: ['“Vamos ver no campo.”', '“Sem promessas. Só trabalho.”', '“O de sempre: dedicação.”'],
    },
  },
]

/** Resultado de um jogo do clube do ponto de vista do jogador (o placar dos pênaltis não conta). */
function outcomeOf(it: CalendarItem): 'win' | 'draw' | 'loss' | null {
  if (!it.result) return null
  const home = it.home !== false
  const us = home ? it.result.score[0] : it.result.score[1]
  const them = home ? it.result.score[1] : it.result.score[0]
  return us > them ? 'win' : us < them ? 'loss' : 'draw'
}

/** Sequência atual do clube: vitórias seguidas (+n) ou jogos sem vencer (−n); 0 = nenhuma. */
export function clubStreak(s: ImmersiveState): number {
  const done = s.calendar.filter((it) => it.done && it.kind === 'match' && it.season === s.season && it.result)
  let n = 0
  for (let i = done.length - 1; i >= 0; i--) {
    const o = outcomeOf(done[i])
    if (n === 0) n = o === 'win' ? 1 : -1
    else if (n > 0 && o === 'win') n++
    else if (n < 0 && o !== 'win') n--
    else break
  }
  return n
}

/** Até onde a mesma pergunta não volta (semanas). */
const PRESS_COOLDOWN = 4

export function buildPress(data: GameData, s: ImmersiveState, item: CalendarItem, leaguePos = 0, leagueSize = 0): PressQuestion[] {
  const m = mem(s)
  const r = irng(s, 'press', item.id)
  const opp = item.opponentId ? teamShort(data, item.opponentId) : 'o adversário'
  const oo = withArt(data, item.opponentId)
  const OO = oo.charAt(0).toUpperCase() + oo.slice(1)
  const club = clubOf(data, s.clubId)
  let dry = 0
  for (let i = s.calendar.length - 1; i >= 0; i--) {
    const it = s.calendar[i]
    if (!it.done || it.kind !== 'match' || !it.result?.played) continue
    if (it.result.userGoals > 0) break
    dry++
  }
  const recent = s.calendar.filter((it) => it.done && it.kind === 'match').slice(-5)
  const bench = recent.length >= 3 && recent.filter((it) => (it.result?.minutes ?? 90) < 45).length >= 3
  const rumor = s.offers.find((o) => o.kind === 'transfer')
  const rumorClub = rumor ? clubOf(data, rumor.clubId) : undefined
  // reta final e zona da tabela (liga do clube)
  const leagueGames = s.calendar.filter((it) => it.kind === 'match' && it.competitionId === s.leagueId && /rodada/.test(it.stage ?? ''))
  const played = leagueGames.filter((it) => it.done).length
  const league = leagueById(data, s.leagueId)
  const zone: PressCtx['zone'] =
    leaguePos > 0 && leagueSize > 0 && played >= 5 && league
      ? league.relegation > 0 && leaguePos > leagueSize - league.relegation
        ? 'relegation'
        : league.tier > 1 && league.promotion > 0 && leaguePos <= league.promotion
          ? 'promotion'
          : null
      : null
  const lastMatch = s.calendar.filter((it) => it.done && it.kind === 'match' && it.season === s.season).slice(-1)[0]
  // o jogo que a coletiva antecede (a fase está nele, não no título da coletiva)
  const game = item.fixtureKey ? s.calendar.find((x) => x.fixtureKey === item.fixtureKey && (x.kind === 'match' || x.kind === 'national_match')) : undefined
  const injuryNews = s.news.find((n) => n.season === s.season && /lesionado|se machuca/.test(n.headline))
  const ctx: PressCtx = {
    opp,
    big: (item.importance ?? 0) >= 0.72,
    final: /(^|— )Final( · (ida|volta))?$/.test(game?.stage ?? ''),
    derby: (item.importance ?? 0) >= 0.78 && game?.kind === 'match' && /rodada/.test(game.stage ?? ''),
    goals: s.seasonStats.goals,
    dry,
    bench,
    rumor: rumorClub ? (rumorClub.shortName || rumorClub.name) : null,
    national: (() => {
      const c = data.countries.find((x) => x.code === s.identity.nationality)
      return s.ovr >= (c ? callUpOvr(c) : 80) - 4 && s.national.apps === 0
    })(),
    titleRace: leaguePos > 0 && leaguePos <= 3 && s.calendar.filter((it) => it.done && it.kind === 'match').length >= 10,
    club: club?.shortName ?? 'clube',
    late: leagueGames.length > 0 && played / leagueGames.length >= 0.75,
    zone,
    streak: clubStreak(s),
    last: lastMatch ? outcomeOf(lastMatch) : null,
    back: !!injuryNews && !s.condition.injury && s.week - injuryNews.week <= 10 && (m.lastMatchWeek ?? -1) <= injuryNews.week,
    young: s.age <= 18,
  }
  // a mesma pergunta não volta em menos de 4 semanas
  const now = s.season * 100 + s.week
  const seen = m.pressSeen ?? {}
  const eligible = QUESTIONS.filter((q) => q.when(ctx))
  const freshQ = eligible.filter((q) => !(seen[q.key] !== undefined && now - seen[q.key] < PRESS_COOLDOWN))
  const pool = freshQ.length >= 2 ? freshQ : eligible
  const picks: QDef[] = []
  for (const q of r.shuffle(pool.filter((q) => !q.generic))) if (picks.length < 2) picks.push(q)
  for (const q of r.shuffle(pool)) if (picks.length < 3 && !picks.includes(q)) picks.push(q)
  const keep: Record<string, number> = {}
  for (const [k, w] of Object.entries(seen)) if (now - w < PRESS_COOLDOWN * 2) keep[k] = w
  for (const q of picks) keep[q.key] = now
  m.pressSeen = keep
  const pelo = oo.startsWith('o ') ? `pelo ${oo.slice(2)}` : oo.startsWith('a ') ? `pela ${oo.slice(2)}` : oo.startsWith('os ') ? `pelos ${oo.slice(3)}` : oo.startsWith('as ') ? `pelas ${oo.slice(3)}` : `por ${oo}`
  const rName = ctx.rumor ?? ''
  const fem = artigo(rumorClub) === 'a'
  const vars = (t: string) =>
    t
      .replace(/\{OO\}/g, OO)
      .replace(/\{oo\}/g, oo)
      .replace(/\{pelo\}/g, pelo)
      .replace(/\{o\}/g, opp)
      .replace(/\{gols\}/g, pl(ctx.goals, 'gol', 'gols'))
      .replace(/\{n\}/g, String(dry))
      .replace(/\{k\}/g, String(Math.abs(ctx.streak)))
      .replace(/\{pos\}/g, String(leaguePos))
      .replace(/\{dor\}/g, `${fem ? 'da' : 'do'} ${rName}`)
      .replace(/\{aor\}/g, `${fem ? 'à' : 'ao'} ${rName}`)
      .replace(/\{oclub\}/g, `${artigo(club)} ${ctx.club}`)
  const deltas: Record<string, Record<string, Deltas>> = {}
  const out: PressQuestion[] = picks.map((q, i) => {
    const qid = `${item.id}:q${i}`
    deltas[qid] = {}
    const answers: PressQuestion['answers'] = []
    const question = vars(r.pick(q.q))
    for (const tone of ['humilde', 'confiante', 'provocador', 'evasivo'] as Tone[]) {
      const labels = q.a[tone]
      if (!labels?.length) continue
      const label = r.pick(labels)
      const aid = `${qid}:${tone}`
      const d: Deltas = { ...TONE_FX[tone] }
      // provocar em jogo grande rende mais (e custa mais)
      if (tone === 'provocador' && (ctx.big || ctx.derby)) {
        d.fans = (d.fans ?? 0) + 2
        d.media = (d.media ?? 0) - 1
      }
      if (tone === 'confiante' && ctx.bench) d.coach = (d.coach ?? 0) - 1
      // resposta morna em jogo grande/clássico: a torcida queria mais
      if (tone === 'humilde' && (ctx.big || ctx.derby || ctx.final)) d.fans = (d.fans ?? 0) - 1.5
      deltas[qid][aid] = d
      answers.push({ id: aid, label: vars(label), tone, effects: deltaLabels(d) })
    }
    return { id: qid, journalist: r.pick(JOURNALISTS), outlet: r.pick(OUTLETS), question, answers }
  })
  m.press = deltas
  m.pressHead = undefined
  const R = s.relationships
  s.pressLog = { itemId: item.id, total: out.length, start: { fans: R.fans, media: R.media, coach: R.coach, teammates: R.teammates, morale: s.condition.morale }, answers: [] }
  return out
}

/** Peso de manchete de cada tom (a coletiva vira no máximo uma manchete: a mais quente). */
const TONE_NEWS: Record<Tone, number> = { provocador: 3, confiante: 2, humilde: 1, evasivo: 0 }

const HEADLINES: Record<Tone, ((me: string, quote: string) => string)[]> = {
  provocador: [(me, q) => `${me} provoca: “${q}”`, (me, q) => `${me} esquenta o jogo: “${q}”`, (me, q) => `Recado de ${me}: “${q}”`],
  confiante: [(me, q) => `Confiante, ${me} avisa: “${q}”`, (me, q) => `${me} não se esconde: “${q}”`, (me, q) => `“${q}”, garante ${me}`],
  humilde: [(me, q) => `${me} mantém os pés no chão: “${q}”`, (me, q) => `${me} pede calma: “${q}”`, (me, q) => `“${q}”, diz ${me}`],
  evasivo: [(me) => `${me} desconversa na coletiva`, (me) => `${me} foge das polêmicas na coletiva`],
}

export function answerPress(data: GameData, s: ImmersiveState, questionId: string, answerId: string, fx: ImmersiveEffect[]): boolean {
  const m = mem(s)
  if (!s.press) return false
  const q = s.press.find((x) => x.id === questionId)
  const a = q?.answers.find((x) => x.id === answerId)
  if (!q || !a) return false
  const d = m.press?.[questionId]?.[answerId] ?? {}
  applyDeltas(s, d)
  const me = s.identity.surname
  const quote = a.label.replace(/[“”"]/g, '')
  const hr = trng(s, 'press-head', questionId)
  const headline = hr.pick(HEADLINES[a.tone])(me, quote)
  // uma manchete por coletiva: a resposta mais quente substitui a anterior; as mornas não viram notícia
  const prev = m.pressHead
  let newsId = ''
  if (!prev || TONE_NEWS[a.tone] > prev.rank) {
    if (prev) s.news = s.news.filter((n) => n.id !== prev.newsId)
    const news = addNews(s, headline, a.tone === 'provocador' ? 'negative' : a.tone === 'evasivo' ? 'neutral' : 'positive', fx, { outlet: q.outlet })
    newsId = news.id
    m.pressHead = { newsId, rank: TONE_NEWS[a.tone] }
  }
  s.pressLog?.answers.push({ questionId, answerId, tone: a.tone, newsId })
  if (a.tone === 'provocador') {
    const club = clubOf(data, s.clubId)
    const r = trng(s, 'press-react', questionId)
    addPost(s, 'Torcedor', `@${slug(club?.abbr ?? 'fc')}_${r.pick(fanTails(club?.country))}`, r.pick(['Falou tudo! 🔥🔥', 'Esse tem sangue no olho!', 'Pode provocar, é nosso camisa!']), 'positive', { likes: 200 + (s.followers ?? 0) * 0.02 })
  }
  s.press = s.press.filter((x) => x.id !== questionId)
  if (!s.press.length) {
    s.press = null
    m.pressHead = undefined
  }
  return true
}

// ───────────────────────── redes sociais ─────────────────────────

export interface PostTemplate {
  id: string
  label: string
  text: string
  tone: SocialPost['tone']
  hint: string
  fx: Deltas
}

/** Mesmos ids dos modelos da UI (src/ui/immersive/model/constants.ts). */
export const POST_TEMPLATES: PostTemplate[] = [
  { id: 'obrigado_torcida', label: '“Obrigado, torcida!”', text: 'Obrigado, torcida! Vocês empurraram a gente do começo ao fim. Juntos! 💚', tone: 'positive', hint: 'Torcida +', fx: { fans: 3, followers: 900 } },
  { id: 'foto_gol', label: 'Foto do gol', text: 'Esse vai pro quadro. ⚽🔥 #{club}', tone: 'positive', hint: 'Seguidores ++', fx: { followers: 2500, fans: 1 } },
  { id: 'provocar_rival', label: 'Provocar o rival', text: 'Tem gente que fala demais durante a semana… no campo a conversa é outra. 🤫', tone: 'negative', hint: 'Torcida ++ · Imprensa −', fx: { fans: 4, media: -3, coach: -1, followers: 3500 } },
  { id: 'foco_treino', label: 'Foco no treino', text: 'Cabeça no próximo jogo. Treino, descanso e trabalho. 💪', tone: 'neutral', hint: 'Técnico +', fx: { coach: 1.5, followers: 300 } },
  { id: 'pedir_desculpas', label: 'Pedir desculpas', text: 'Hoje não deu. Assumo minha parte e a gente volta mais forte. Desculpa, torcida.', tone: 'neutral', hint: 'Torcida + · Moral −', fx: { fans: 2, morale: -1, media: 1 } },
  { id: 'mirar_titulo', label: 'Mirar o título', text: 'Ninguém aqui veio para ser coadjuvante. O objetivo é um só: taça. 🏆', tone: 'positive', hint: 'Imprensa + · Pressão ▲', fx: { media: 2, morale: 1, followers: 1200 } },
  { id: 'familia', label: 'Post com a família', text: 'Tudo por eles. Obrigado por estarem sempre comigo. ❤️', tone: 'positive', hint: 'Moral +', fx: { morale: 3, followers: 700 } },
  { id: 'silencio', label: 'Ficar em silêncio', text: '', tone: 'neutral', hint: 'Sem efeito', fx: {} },
]

/**
 * Post do jogador. Na mesma semana cada post rende metade do anterior (1, ½, ¼…) — spam não compra
 * relação; "Foco no treino" só mexe com o técnico 1× a cada 4 semanas e às vezes soa ensaiado (mídia −).
 */
export function userPost(data: GameData, s: ImmersiveState, templateId: string, fx: ImmersiveEffect[]): boolean {
  const t = POST_TEMPLATES.find((x) => x.id === templateId)
  if (!t) return false
  const m = mem(s)
  if (t.id === 'silencio') {
    fx.push({ type: 'toast', tone: 'info', title: 'Você preferiu o silêncio' })
    return true
  }
  const club = clubOf(data, s.clubId)
  const wk = s.season * 100 + s.week
  const n = m.lastPostWeek === wk ? (m.postsWeek ?? 0) : 0
  m.lastPostWeek = wk
  m.postsWeek = n + 1
  m.postsCount = (m.postsCount ?? 0) + 1
  const scale = Math.pow(0.5, n)
  const d: Deltas = {}
  for (const [k, v] of Object.entries(t.fx)) (d as Record<string, number>)[k] = (v as number) * scale
  let note = ''
  if (t.id === 'foco_treino') {
    // o técnico nota o recado no máximo uma vez a cada 4 semanas
    const last = m.focusPostWeek ?? -99
    const sameStretch = Math.floor(last / 100) === s.season && s.week - (last % 100) < 4
    if (sameStretch) d.coach = 0
    else {
      // e cada recado na temporada vale menos (1,5 · 1/(1+k))
      const k = Math.floor(last / 100) === s.season ? (m.focusPostsSeason ?? 0) : 0
      m.focusPostsSeason = k + 1
      d.coach = (d.coach ?? 0) / (1 + k)
      m.focusPostWeek = wk
      if (trng(s, 'focus-post', m.postsCount).chance(0.2)) {
        d.media = (d.media ?? 0) - 1.5
        note = ' · a imprensa achou ensaiado'
      }
    }
  }
  if (n >= 2) {
    // postar demais cansa: a imprensa torce o nariz e os seguidores param de engajar
    d.media = (d.media ?? 0) - 0.25 * (n - 1)
    d.followers = Math.round((d.followers ?? 0) * 0.5)
  }
  const followers = s.followers ?? 0
  const likes = followers * (0.05 + (t.tone === 'positive' ? 0.04 : 0.02)) * (0.6 + s.reputation / 100) * scale
  // agradecer "do começo ao fim" depois de uma derrota soa errado: o texto acompanha o resultado
  const last = s.calendar.filter((it) => it.done && (it.kind === 'match' || it.kind === 'national_match') && it.result).slice(-1)[0]
  const lostLast = !!last?.result && (last.home !== false ? last.result.score[0] < last.result.score[1] : last.result.score[1] < last.result.score[0])
  const text = t.id === 'obrigado_torcida' && lostLast ? 'Obrigado pelo apoio de sempre, torcida. Hoje não deu, mas a gente vai dar a volta por cima. 💚' : t.text
  addPost(s, `${s.identity.surname} (você)`, `@${slug(s.identity.surname)}${s.identity.number}`, text.replace('{club}', slug(club?.shortName ?? 'lenda')), t.tone, {
    byUser: true,
    likes,
    reposts: likes * 0.12,
    verified: s.reputation >= 20,
  })
  applyDeltas(s, d)
  const r = trng(s, 'post-react', m.idSeq ?? 0)
  const fan = `@${slug(club?.abbr ?? 'fc')}_${r.pick(fanTails(club?.country))}`
  addPost(s, 'Torcedor', fan, n >= 2 ? r.pick(['De novo? Menos post e mais bola.', 'Joga mais e posta menos, craque.', 'Já vimos esse filme essa semana…']) : t.tone === 'negative' ? r.pick(['Kkkkk provocou mesmo! 🔥', 'Tá certo! Respeita o camisa!', 'Isso vai dar o que falar…']) : r.pick(['Tamo junto, craque! 👏', 'Orgulho da torcida!', 'Esse é dos nossos!']), n >= 2 ? 'negative' : 'positive', { likes: likes * 0.05 })
  fx.push({ type: 'toast', tone: 'success', title: 'Post publicado', description: n ? `${t.hint} (efeito menor: ${n + 1}º post da semana)${note}` : `${t.hint}${note}` })
  return true
}

// ───────────────────────── reações a partidas ─────────────────────────

export interface MatchSummary {
  item: CalendarItem
  userGoals: number
  userAssists: number
  rating: number
  minutes: number
  won: boolean
  lost: boolean
  scoreFor: number
  scoreAgainst: number
  national: boolean
  status: 'starter' | 'bench' | 'out'
  /** Autores dos gols do time do jogador (sem o jogador). */
  scorers?: string[]
}

const SPANISH = new Set(['ARG', 'URU', 'CHI', 'COL', 'PAR', 'PER', 'ECU', 'BOL', 'VEN', 'MEX', 'ESP', 'CRC', 'HON', 'GUA', 'SLV', 'PAN', 'CUB', 'DOM', 'NCA', 'PUR'])
const ENGLISH = new Set(['ENG', 'SCO', 'WAL', 'NIR', 'IRL', 'USA', 'CAN', 'AUS', 'NZL', 'JAM', 'RSA'])

/** Fim do @ de torcedor pela língua do país do clube (o "na_veia" é coisa de brasileiro). */
export function fanTails(country: string | undefined): string[] {
  if (!country || country === 'BRA' || country === 'POR') return ['na_veia', 'raiz', 'ate_morrer', 'fiel', 'de_coracao', 'arquibancada']
  if (SPANISH.has(country)) return ['hincha', 'de_la_cuna', 'barra', 'del_alma', 'siempre', 'tribuna']
  if (country === 'ITA') return ['tifoso', 'ultra', 'curva', 'sempre']
  if (country === 'FRA') return ['supporter', 'virage', 'ultra', 'toujours']
  if (country === 'GER' || country === 'AUT' || country === 'SUI') return ['fan', 'kurve', 'ultras', 'immer']
  if (ENGLISH.has(country)) return ['fan', 'faithful', 'til_i_die', 'away_days']
  return ['fan', 'ultras', 'torcida', 'forever']
}

/** Sorteia uma frase que não saiu nos últimos ~10 posts (sem "Mais três pontos!" em sequência). */
function freshPick(r: Rng, s: ImmersiveState, list: string[]): string {
  const recent = new Set(s.social.slice(0, 10).map((p) => p.text))
  const ok = list.filter((t) => !recent.has(t))
  return r.pick(ok.length ? ok : list)
}

export function matchReactions(data: GameData, s: ImmersiveState, ms: MatchSummary, fx: ImmersiveEffect[], r: Rng): void {
  const me = s.identity.surname
  const team = ms.national ? (data.countries.find((c) => c.code === s.identity.nationality)?.name ?? 'Seleção') : (clubOf(data, s.clubId)?.shortName ?? 'Time')
  const oppName = ms.item.opponentId ? teamShort(data, ms.item.opponentId) : 'adversário'
  const oppArt = withArt(data, ms.item.opponentId)
  const club = clubOf(data, s.clubId)
  const tails = fanTails(ms.national ? s.identity.nationality : club?.country)
  const fanHandle = () => `@${slug(ms.national ? s.identity.nationality : (club?.abbr ?? 'fc'))}_${r.pick(tails)}`
  const followers = s.followers ?? 1000
  const likes = (k: number) => Math.round(followers * k * r.range(0.6, 1.4) + r.int(20, 300))
  const score = `${ms.scoreFor}–${ms.scoreAgainst}`
  const big = (ms.item.importance ?? 0) >= 0.72
  const league = !ms.national && ms.item.competitionId === s.leagueId && /rodada/.test(ms.item.stage ?? '')
  const margin = ms.scoreFor - ms.scoreAgainst
  const scorer = ms.scorers?.length ? r.pick(ms.scorers) : undefined
  // notícia
  if (ms.minutes > 0 && ms.userGoals >= 3) addNews(s, `Hat-trick! ${me} brilha e ${team} bate ${oppArt}`, 'positive', fx)
  else if (ms.minutes > 0 && ms.userGoals >= 1 && (ms.won || big)) addNews(s, `${me} marca e ${team} ${ms.won ? 'vence' : 'empata com'} ${oppArt} (${score})`, 'positive', fx)
  else if (ms.minutes > 0 && ms.rating >= 8) addNews(s, `Nota ${ms.rating.toFixed(1).replace('.', ',')}: ${me} é o destaque de ${team} ${score} ${oppName}`, 'positive', fx)
  else if (ms.minutes > 0 && ms.rating <= 5.2) addNews(s, `${me} vai mal e vira alvo de críticas após ${team} ${score} ${oppName}`, 'negative', fx)
  else if (big && ms.lost) addNews(s, `${team} perde para ${oppArt} (${score}) e pressão aumenta`, 'negative', fx, { aboutUser: false })
  else if (ms.status === 'bench' && ms.minutes === 0 && big) addNews(s, `${me} fica no banco em ${team} ${score} ${oppName}`, 'neutral', fx)
  // redes
  const posts: [string, SocialPost['tone']][] = []
  if (ms.minutes > 0) {
    if (ms.userGoals > 0)
      posts.push([
        freshPick(r, s, [
          `${me} decidiu! Que jogador! 🔥`,
          `Esse ${me} é diferenciado demais`,
          `Camisa ${s.identity.number} pesando a favor! ⚽`,
          `${me} ${ms.userGoals > 1 ? `fez ${ms.userGoals}` : 'deixou o dele'}. Craque!`,
          `Gol do ${me} contra ${oppArt}! Que fase!`,
          `${me} é o cara. Não tem jeito.`,
        ]),
        'positive',
      ])
    else if (ms.userAssists > 0) posts.push([freshPick(r, s, [`Que passe do ${me}! Visão absurda`, `${me} não marcou, mas jogou demais. Assistência de gênio`, `Assistência do ${me} na medida! 🎯`]), 'positive'])
    else if (ms.rating >= 7.5) posts.push([freshPick(r, s, [`Que partida do ${me}. Monstro.`, `${me} joga muito, só falta o gol`, `${me} carregou o time hoje.`, `Pra mim, ${me} foi o melhor em campo.`]), 'positive'])
    else if (ms.rating <= 5.6)
      posts.push([freshPick(r, s, [`${me} sumiu hoje. Precisa melhorar.`, `Cadê o ${me} de antes?`, `${me} não viu a cor da bola.`, `Dia ruim do ${me}. Acontece.`, ...(ms.status === 'starter' ? [`Não dá pra ser titular assim, ${me}.`] : [])]), 'negative'])
  } else if (ms.status !== 'out' && ms.lost) posts.push([freshPick(r, s, [`Por que o ${me} não entrou?? 🤔`, `Deixa o ${me} jogar, professor!`, `Com o ${me} no banco não dá.`]), 'negative'])
  if (ms.won)
    posts.push([
      freshPick(r, s, [
        'VAMOOOO! 💪',
        `Vitória importante contra ${oppArt}!`,
        'É isso! Time com alma!',
        `${score} no placar e a torcida em festa!`,
        ...(league ? ['Mais três pontos! Seguimos!', `Três pontos contra ${oppArt}. É assim que se faz!`] : ['Noite de copa é noite de raça! 🔥', `Vitória com cara de mata-mata: ${score}!`]),
        ...(margin >= 3 ? [`Passeio! ${score} sem dó.`, `Atropelo! ${team} não tomou conhecimento.`] : []),
        ...(scorer ? [`Que gol do ${scorer}! 🔥`, `${scorer} decidiu! Valeu demais!`] : []),
      ]),
      'positive',
    ])
  else if (ms.lost)
    posts.push([
      freshPick(r, s, [
        'Precisamos de reforços com urgência.',
        'Que noite horrível…',
        `Perder para ${oppArt} assim não dá.`,
        `${score}… dia para esquecer.`,
        ...(margin <= -2 ? ['Vergonha. Time sem alma hoje.', 'Diretoria, acorda! Assim não dá.'] : ['Faltou pouco. Cabeça erguida.', 'Derrota doída, mas tem jogo pela frente.']),
        ...(margin <= -3 ? [`Humilhação. ${score} é inaceitável.`] : []),
      ]),
      'negative',
    ])
  else
    posts.push([
      freshPick(r, s, [
        'Faltou capricho no último passe.',
        `${score} contra ${oppArt}. Dava para mais.`,
        'Jogo travado. Segue o baile.',
        ...(league ? ['Um ponto é um ponto.', 'Empate com gosto de derrota.'] : []),
        ...(!league && ms.item.leg === 1 ? ['Tudo aberto para a volta!'] : []),
      ]),
      'neutral',
    ])
  for (const [text, tone] of posts) addPost(s, 'Torcedor', fanHandle(), text, tone, { likes: likes(0.01), reposts: likes(0.001) })
  if (ms.minutes > 0 && (ms.userGoals > 0 || ms.rating >= 7.8 || ms.rating <= 5.4)) {
    const outlet = r.pick(OUTLETS)
    addPost(s, outlet, `@${slug(outlet)}`, `${me} (nota ${ms.rating.toFixed(1).replace('.', ',')}) em ${team} ${score} ${oppName}. ${ms.userGoals ? `${pl(s.seasonStats.goals, 'gol', 'gols')} na temporada.` : ''}`.trim(), ms.rating >= 7 ? 'positive' : 'negative', {
      verified: true,
      likes: likes(0.02),
      reposts: likes(0.004),
    })
  }
  s.followers = Math.round(followers + ms.userGoals * (80 + s.reputation * 30) + (ms.rating >= 8 ? 200 + s.reputation * 10 : 0))
}

// ───────────────────────── estilo de vida ─────────────────────────

export const LIFESTYLE_ITEMS = [
  { id: 'relogio', name: 'Relógio de grife', price: 25_000, morale: 2 },
  { id: 'viagem', name: 'Viagem nas férias', price: 60_000, morale: 5 },
  { id: 'carro', name: 'Carro esportivo', price: 140_000, morale: 4 },
  { id: 'casa-pais', name: 'Casa para os pais', price: 450_000, morale: 9 },
  { id: 'apartamento', name: 'Cobertura na praia', price: 1_200_000, morale: 6 },
  { id: 'mansao', name: 'Mansão', price: 4_500_000, morale: 8 },
  { id: 'iate', name: 'Iate', price: 9_000_000, morale: 7 },
  { id: 'jatinho', name: 'Jatinho particular', price: 25_000_000, morale: 8 },
  { id: 'instituto', name: 'Instituto social com seu nome', price: 2_000_000, morale: 10 },
] as const

export function buyItem(s: ImmersiveState, itemId: string, fx: ImmersiveEffect[]): boolean {
  const item = LIFESTYLE_ITEMS.find((i) => i.id === itemId)
  if (!item) return false
  if (s.finance.balance < item.price) {
    fx.push({ type: 'toast', tone: 'danger', title: 'Saldo insuficiente', description: `${item.name} custa €${item.price.toLocaleString('pt-BR')}.` })
    return false
  }
  const owned = (s.finance.lifestyle ?? []).filter((l) => l.id === itemId).length
  s.finance.balance -= item.price
  s.finance.lifestyle = [...(s.finance.lifestyle ?? []), { id: item.id, name: item.name, price: item.price, season: s.season }]
  const morale = Math.max(1, Math.round(item.morale / (1 + owned)))
  // repetir a compra rende cada vez menos (moral e imagem)
  const img = 1 / (1 + owned * 2)
  applyDeltas(s, { morale, fans: item.id === 'instituto' ? 4 * img : 0, media: item.id === 'instituto' ? 3 * img : item.id === 'jatinho' || item.id === 'iate' ? -1 : 0 })
  fx.push({ type: 'toast', tone: 'gold', title: item.name, description: `Moral +${morale}` })
  if (item.price >= 1_000_000) addNews(s, item.id === 'instituto' ? `${s.identity.surname} inaugura instituto social` : `${s.identity.surname} compra ${item.name.toLowerCase()}`, item.id === 'instituto' ? 'positive' : 'neutral', fx)
  return true
}
