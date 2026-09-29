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
import { cap, clamp, clubOf, irng, nextId, slug, teamShort, trng, withArt } from './util'

export const OUTLETS = ['LENDA TV', 'Rádio Arquibancada', 'Diário da Bola', 'Portal Camisa 10', 'Jornal do Gramado', 'Canal Resenha'] as const
export const JOURNALISTS = ['Paulo Viana', 'Marta Queiroz', 'Rogério Lins', 'Ana Beatriz Luz', 'Tadeu Falcão', 'Júlia Sampaio', 'Caio Mendonça', 'Renata Borges']

const MAX_FEED = 60
const MAX_INBOX = 80

export function addNews(s: ImmersiveState, headline: string, tone: NewsItem['tone'], fx?: ImmersiveEffect[], o: { outlet?: string; body?: string; aboutUser?: boolean; clubId?: string } = {}): NewsItem {
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
    ['media', 'Mídia'],
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
  when: (c: PressCtx) => boolean
  q: string
  a: Partial<Record<Tone, string>>
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

const QUESTIONS: QDef[] = [
  {
    when: (c) => c.final,
    q: 'É final. O que passa pela sua cabeça a poucos dias da decisão?',
    a: {
      humilde: '“Respeito total {pelo}. É trabalhar e fazer o simples.”',
      confiante: '“Nasci para jogar esse tipo de jogo. Vamos levantar essa taça.”',
      provocador: '“Eles que se preocupem com a gente. A taça tem dono.”',
      evasivo: '“Prefiro não falar de título antes da hora.”',
    },
  },
  {
    when: (c) => c.derby,
    q: 'Semana de clássico contra {oo}. O que muda no vestiário?',
    a: {
      humilde: '“Clássico se ganha no detalhe. Muito respeito por eles.”',
      confiante: '“A gente está pronto. Quem estiver melhor vai ganhar — e somos nós.”',
      provocador: '“Clássico? Pra mim é só mais três pontos.”',
      evasivo: '“Cada jogo tem sua história. Vamos ver no domingo.”',
    },
  },
  {
    when: (c) => c.big && !c.final,
    q: '{OO} vem forte. Como vocês se preparam para um jogo desse tamanho?',
    a: {
      humilde: '“Com muito respeito e trabalho. Eles têm grandes jogadores.”',
      confiante: '“Jogo grande é onde a gente mostra quem é. Estamos prontos.”',
      provocador: '“Forte? Vamos ver depois dos 90 minutos.”',
      evasivo: '“O professor vai decidir a estratégia. Eu só quero jogar.”',
    },
  },
  {
    when: (c) => c.goals >= 5,
    q: 'Você já tem {g} gols na temporada. É o melhor momento da sua carreira?',
    a: {
      humilde: '“Os gols são do grupo. Sem os companheiros eu não faço nada.”',
      confiante: '“Estou me sentindo muito bem. E vem mais por aí.”',
      provocador: '“Quem duvidava de mim deve estar quieto agora.”',
      evasivo: '“Não fico contando gols. Penso no próximo jogo.”',
    },
  },
  {
    when: (c) => c.dry >= 5,
    q: 'São {n} jogos sem marcar. Isso te incomoda?',
    a: {
      humilde: '“Faz parte. Vou continuar trabalhando que o gol volta.”',
      confiante: '“Fase passa. Quando sair o primeiro, vão sair vários.”',
      provocador: '“Incomoda mais vocês do que a mim.”',
      evasivo: '“Estou ajudando o time de outras formas.”',
    },
  },
  {
    when: (c) => c.bench,
    q: 'Você tem começado no banco. Está satisfeito com as escolhas do técnico?',
    a: {
      humilde: '“O professor sabe o que faz. Vou mostrar nos treinos.”',
      confiante: '“Quando eu entro, eu resolvo. A vaga vai vir.”',
      provocador: '“Não entendo, mas não sou eu que escalo.”',
      evasivo: '“Isso é assunto interno.”',
    },
  },
  {
    when: (c) => !!c.rumor,
    q: 'Há rumores de interesse do {r}. Você fica no {club}?',
    a: {
      humilde: '“Estou feliz aqui. Meu foco é o {club}.”',
      confiante: '“Quem joga bem é procurado. Meu empresário cuida disso.”',
      provocador: '“Quem sabe? Grandes clubes querem grandes jogadores.”',
      evasivo: '“Não comento especulação.”',
    },
  },
  {
    when: (c) => c.national,
    q: 'Você pensa em seleção?',
    a: {
      humilde: '“Seria um sonho, mas primeiro tenho que fazer por onde no clube.”',
      confiante: '“Estou pronto para vestir a camisa. É questão de tempo.”',
      provocador: '“Se não me chamarem, o problema não é meu.”',
      evasivo: '“Deixo isso para a comissão técnica.”',
    },
  },
  {
    when: (c) => c.titleRace,
    q: 'O time briga lá em cima. Dá para falar em título?',
    a: {
      humilde: '“Tem muito campeonato pela frente. Jogo a jogo.”',
      confiante: '“Dá, sim. Esse grupo tem cara de campeão.”',
      provocador: '“Os outros que corram atrás. O título é nosso.”',
      evasivo: '“Não gosto de fazer contas.”',
    },
  },
  {
    when: () => true,
    q: 'Como está o clima no elenco para o jogo contra {oo}?',
    a: {
      humilde: '“Grupo unido, todo mundo trabalhando junto.”',
      confiante: '“Clima de vitória. A gente sabe o nosso potencial.”',
      provocador: '“Melhor do que o clima lá do lado deles, com certeza.”',
      evasivo: '“Normal, semana de trabalho.”',
    },
  },
  {
    when: () => true,
    q: 'O que o torcedor pode esperar de você nesta semana?',
    a: {
      humilde: '“Entrega total. É o mínimo que eu posso dar.”',
      confiante: '“Pode esperar gol e vitória.”',
      provocador: '“Espetáculo. Tragam os amigos.”',
      evasivo: '“Vamos ver no campo.”',
    },
  },
]

export function buildPress(data: GameData, s: ImmersiveState, item: CalendarItem, leaguePos = 0): PressQuestion[] {
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
  const ctx: PressCtx = {
    opp,
    big: (item.importance ?? 0) >= 0.72,
    final: /Final/.test(item.title) && !/Semifinal|Quartas|Oitavas/.test(item.title),
    derby: (item.importance ?? 0) >= 0.78 && /rodada/.test(s.calendar.find((x) => x.fixtureKey === item.fixtureKey && x.kind === 'match')?.stage ?? ''),
    goals: s.seasonStats.goals,
    dry,
    bench,
    rumor: rumor ? teamShort(data, rumor.clubId) : null,
    national: (() => {
      const c = data.countries.find((x) => x.code === s.identity.nationality)
      return s.ovr >= (c ? callUpOvr(c) : 80) - 4 && s.national.apps === 0
    })(),
    titleRace: leaguePos > 0 && leaguePos <= 3 && s.calendar.filter((it) => it.done && it.kind === 'match').length >= 10,
    club: club?.shortName ?? 'clube',
  }
  const pool = QUESTIONS.filter((q) => q.when(ctx))
  const specific = pool.filter((q) => q !== QUESTIONS[QUESTIONS.length - 1] && q !== QUESTIONS[QUESTIONS.length - 2])
  const picks: QDef[] = []
  for (const q of r.shuffle(specific)) if (picks.length < 2) picks.push(q)
  for (const q of r.shuffle(pool)) if (picks.length < 3 && !picks.includes(q)) picks.push(q)
  const pelo = oo.startsWith('o ') ? `pelo ${oo.slice(2)}` : oo.startsWith('a ') ? `pela ${oo.slice(2)}` : oo.startsWith('os ') ? `pelos ${oo.slice(3)}` : oo.startsWith('as ') ? `pelas ${oo.slice(3)}` : `por ${oo}`
  const vars = (t: string) =>
    t.replace(/\{OO\}/g, OO).replace(/\{oo\}/g, oo).replace(/\{pelo\}/g, pelo).replace(/\{o\}/g, opp).replace(/\{g\}/g, String(ctx.goals)).replace(/\{n\}/g, String(dry)).replace(/\{r\}/g, ctx.rumor ?? '').replace(/\{club\}/g, ctx.club)
  const deltas: Record<string, Record<string, Deltas>> = {}
  const out: PressQuestion[] = picks.map((q, i) => {
    const qid = `${item.id}:q${i}`
    deltas[qid] = {}
    const answers: PressQuestion['answers'] = []
    for (const tone of ['humilde', 'confiante', 'provocador', 'evasivo'] as Tone[]) {
      const label = q.a[tone]
      if (!label) continue
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
    return { id: qid, journalist: r.pick(JOURNALISTS), outlet: r.pick(OUTLETS), question: vars(q.q), answers }
  })
  m.press = deltas
  return out
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
  const headline =
    a.tone === 'provocador'
      ? `${me} provoca: “${quote}”`
      : a.tone === 'confiante'
        ? `Confiante, ${me} avisa: “${quote}”`
        : a.tone === 'humilde'
          ? `${me} mantém os pés no chão: “${quote}”`
          : `${me} desconversa na coletiva`
  addNews(s, headline, a.tone === 'provocador' ? 'negative' : a.tone === 'evasivo' ? 'neutral' : 'positive', fx, { outlet: q.outlet })
  if (a.tone === 'provocador') {
    const club = clubOf(data, s.clubId)
    const r = trng(s, 'press-react', questionId)
    addPost(s, 'Torcedor', `@${slug(club?.abbr ?? 'fc')}_na_veia`, r.pick(['Falou tudo! 🔥🔥', 'Esse tem sangue no olho!', 'Pode provocar, é nosso camisa!']), 'positive', { likes: 200 + (s.followers ?? 0) * 0.02 })
  }
  s.press = s.press.filter((x) => x.id !== questionId)
  if (!s.press.length) s.press = null
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
  { id: 'provocar_rival', label: 'Provocar o rival', text: 'Tem gente que fala demais durante a semana… no campo a conversa é outra. 🤫', tone: 'negative', hint: 'Torcida ++ · Mídia −', fx: { fans: 4, media: -3, coach: -1, followers: 3500 } },
  { id: 'foco_treino', label: 'Foco no treino', text: 'Cabeça no próximo jogo. Treino, descanso e trabalho. 💪', tone: 'neutral', hint: 'Técnico +', fx: { coach: 1.5, followers: 300 } },
  { id: 'pedir_desculpas', label: 'Pedir desculpas', text: 'Hoje não deu. Assumo minha parte e a gente volta mais forte. Desculpa, torcida.', tone: 'neutral', hint: 'Torcida + · Moral −', fx: { fans: 2, morale: -1, media: 1 } },
  { id: 'mirar_titulo', label: 'Mirar o título', text: 'Ninguém aqui veio para ser coadjuvante. O objetivo é um só: taça. 🏆', tone: 'positive', hint: 'Mídia + · Pressão ▲', fx: { media: 2, morale: 1, followers: 1200 } },
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
  addPost(s, `${s.identity.surname} (você)`, `@${slug(s.identity.surname)}${s.identity.number}`, t.text.replace('{club}', slug(club?.shortName ?? 'lenda')), t.tone, {
    byUser: true,
    likes,
    reposts: likes * 0.12,
    verified: s.reputation >= 20,
  })
  applyDeltas(s, d)
  const r = trng(s, 'post-react', m.idSeq ?? 0)
  const fan = `@${slug(club?.abbr ?? 'fc')}_${r.pick(['na_veia', 'raiz', 'ate_morrer', 'fiel'])}`
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
}

export function matchReactions(data: GameData, s: ImmersiveState, ms: MatchSummary, fx: ImmersiveEffect[], r: Rng): void {
  const me = s.identity.surname
  const team = ms.national ? (data.countries.find((c) => c.code === s.identity.nationality)?.name ?? 'Seleção') : (clubOf(data, s.clubId)?.shortName ?? 'Time')
  const oppName = ms.item.opponentId ? teamShort(data, ms.item.opponentId) : 'adversário'
  const oppArt = withArt(data, ms.item.opponentId)
  const club = clubOf(data, s.clubId)
  const fanHandle = () => `@${slug(ms.national ? s.identity.nationality : (club?.abbr ?? 'fc'))}_${r.pick(['na_veia', 'raiz', 'ate_morrer', 'fiel', 'de_coracao', 'arquibancada'])}`
  const followers = s.followers ?? 1000
  const likes = (k: number) => Math.round(followers * k * r.range(0.6, 1.4) + r.int(20, 300))
  const score = `${ms.scoreFor}–${ms.scoreAgainst}`
  const big = (ms.item.importance ?? 0) >= 0.72
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
    if (ms.userGoals > 0) posts.push([r.pick([`${me} decidiu! Que jogador! 🔥`, `Esse ${me} é diferenciado demais`, `Camisa ${s.identity.number} pesando a favor! ⚽`, `${me} ${ms.userGoals > 1 ? `fez ${ms.userGoals}` : 'deixou o dele'}. Craque!`]), 'positive'])
    else if (ms.userAssists > 0) posts.push([r.pick([`Que passe do ${me}! Visão absurda`, `${me} não marcou mas jogou demais. Assistência de gênio`]), 'positive'])
    else if (ms.rating >= 7.5) posts.push([r.pick([`Que partida do ${me}. Monstro.`, `${me} joga muito, só falta o gol`]), 'positive'])
    else if (ms.rating <= 5.6) posts.push([r.pick([`${me} sumiu hoje. Precisa melhorar.`, `Não dá pra ser titular assim, ${me}.`, `Cadê o ${me} de antes?`]), 'negative'])
  } else if (ms.status !== 'out' && ms.lost) posts.push([r.pick([`Por que o ${me} não entrou?? 🤔`, `Deixa o ${me} jogar, professor!`]), 'negative'])
  if (ms.won) posts.push([r.pick(['VAMOOOO! 💪', `Vitória importante contra ${oppArt}!`, 'Mais três pontos! Seguimos!', 'É isso! Time com alma!']), 'positive'])
  else if (ms.lost) posts.push([r.pick(['Vergonha. Time sem alma hoje.', 'Precisamos de reforços urgente.', 'Que noite horrível…']), 'negative'])
  else posts.push([r.pick(['Empate com gosto de derrota.', 'Um ponto é um ponto.', 'Faltou capricho no último passe.']), 'neutral'])
  for (const [text, tone] of posts) addPost(s, 'Torcedor', fanHandle(), text, tone, { likes: likes(0.01), reposts: likes(0.001) })
  if (ms.minutes > 0 && (ms.userGoals > 0 || ms.rating >= 7.8 || ms.rating <= 5.4)) {
    const outlet = r.pick(OUTLETS)
    addPost(s, outlet, `@${slug(outlet)}`, `${me} (nota ${ms.rating.toFixed(1).replace('.', ',')}) em ${team} ${score} ${oppName}. ${ms.userGoals ? `${s.seasonStats.goals} gols na temporada.` : ''}`.trim(), ms.rating >= 7 ? 'positive' : 'negative', {
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
