/**
 * Eventos de bastidores (itens `story` do calendário, ~a cada 4–6 semanas).
 *
 * - Até 1 evento do CATÁLOGO DO CLÁSSICO por temporada (mesmas condições, textos e pílulas; o
 *   resultado sorteado é traduzido para o imersivo: OVR → atributos, papel → confiança do técnico,
 *   suspensão → jogos, lesão → semanas fora, salário/contrato/valor/posição/seleção iguais).
 * - Nos demais, mini-eventos do dia a dia (festa, patrocínio, vestiário, redes, família…), com
 *   efeitos em moral, relações, forma, energia, saldo e XP.
 * Oferta de base (início) também é uma Decision (kind 'academy').
 */
import type { WorldEngine } from '../api'
import { rng as subRng } from '../rng'
import type { Decision, DecisionOption, GameData } from '../types'
import { EVENTS } from '../career/events/catalog'
import { assembleDecision, buildEnv } from '../career/events/runtime'
import type { EffectSpec, OptionSpec } from '../career/events/types'
import { academyClubs, clubCard } from '../career/offers'
import type { AttributeKey, ImmersiveEffect, ImmersiveState } from './types'
import { mem, type Deltas } from './mem'
import { addInbox, addNews, applyDeltas } from './media'
import { joinClub } from './offers'
import { applyGrowth, attributesFor, convertAttributes, isGK, ovrOf, shiftOvr } from './player'
import { retireNow } from './season'
import { shadowCareer } from './shadow'
import { artigo, clamp, clubOf, countryOf, formatMoney, irng, trng } from './util'

/** Eventos do Clássico que não fazem sentido quando se joga partida a partida (título forçado). */
const EXCLUDED = new Set(['decisive_penalty', 'injury_at_peak'])

// ───────────────────────── oferta de base ─────────────────────────

/** Contrato da base no imersivo (o card mostra exatamente o que é assinado). */
const ACADEMY_CONTRACT = { salary: 24_000, years: 3 } as const

export function academyDecision(data: GameData, s: ImmersiveState): Decision {
  const shadow = shadowCareer(s)
  const clubs = academyClubs(data, shadow, subRng(s.seed, 'academy'))
  const specs: Record<string, OptionSpec> = {}
  const options: DecisionOption[] = clubs.map((c) => {
    const opt = clubCard(data, shadow, c, `academy-${c.id}`, 'Assinar com')
    // o card do Clássico estima salário/duração; aqui vale o contrato de base que o imersivo assina
    opt.details = opt.details?.map((d) =>
      d.label === 'Contrato' ? { ...d, value: `${ACADEMY_CONTRACT.years} anos` } : d.label === 'Salário/ano' ? { ...d, value: formatMoney(ACADEMY_CONTRACT.salary) } : d,
    )
    specs[opt.id] = { type: 'join', optionKey: 'join', clubId: c.id, outcomes: [{ p: 1, kind: 'neutral', fx: {}, summary: `Assinou com ${c.name}.` }] }
    return opt
  })
  mem(s).story = { source: 'academy' }
  return {
    id: `${s.seed}-academy`,
    kind: 'academy',
    title: 'Oferta da base',
    description: 'Três clubes querem você nas categorias de base. Escolha onde a sua história começa — a primeira temporada começa já, com o campeonato em andamento.',
    options,
    context: { specs },
  }
}

// ───────────────────────── mini-eventos ─────────────────────────

type Fx = Deltas & { ovr?: number; balance?: number; injuryWeeks?: number; xp?: AttributeKey[] }

interface MiniDef {
  key: string
  weight: number
  when?: (s: ImmersiveState) => boolean
  title: string
  description: string
  options: { id: string; title: string; label?: string; p: number; ok: Fx; bad?: Fx; okText: string; badText?: string; chips: [string, 'positive' | 'negative' | 'neutral'][] }[]
}

const MINI: MiniDef[] = [
  {
    key: 'treino_extra',
    weight: 3,
    title: 'Treino extra',
    description: 'O preparador físico propõe sessões extras depois das atividades, a semana toda.',
    options: [
      { id: 'sim', title: 'Topar', p: 0.75, ok: { form: 4, coach: 3, fitness: -6, xp: [] }, bad: { fitness: -15 }, okText: 'Semana puxada, mas você voa no treino.', badText: 'Exagerou: o corpo cobrou.', chips: [['Técnico +', 'positive'], ['Energia −', 'negative']] },
      { id: 'nao', title: 'Recusar educadamente', p: 1, ok: { fitness: 5, coach: -1 }, okText: 'Você preferiu descansar.', chips: [['Energia +', 'positive'], ['Técnico −', 'negative']] },
    ],
  },
  {
    key: 'festa',
    weight: 2,
    when: (s) => s.age >= 18,
    title: 'Festa na véspera',
    description: 'Um influenciador famoso te convida para a festa de aniversário dele… na véspera do jogo.',
    options: [
      { id: 'ir', title: 'Ir à festa', p: 0.45, ok: { morale: 5, followers: 3000 }, bad: { coach: -8, media: -5, fitness: -12, fans: -3 }, okText: 'Ninguém ficou sabendo. Noite ótima.', badText: 'Fotos vazaram. O técnico não gostou nada.', chips: [['Seguidores +', 'positive'], ['Risco de polêmica', 'negative']] },
      { id: 'ficar', title: 'Ficar em casa', p: 1, ok: { coach: 2, morale: -1 }, okText: 'Profissionalismo reconhecido pelo técnico.', chips: [['Técnico +', 'positive']] },
    ],
  },
  {
    key: 'patrocinio',
    weight: 2,
    when: (s) => s.reputation >= 12,
    title: 'Proposta de patrocínio',
    description: 'Uma marca de chuteiras quer você como garoto-propaganda da nova campanha.',
    options: [
      { id: 'assinar', title: 'Assinar', p: 0.9, ok: { balance: 1, followers: 2500, media: 2 }, bad: { media: -4, fans: -2 }, okText: 'Campanha no ar e dinheiro na conta.', badText: 'A campanha foi criticada nas redes.', chips: [['Saldo +', 'positive'], ['Imprensa +', 'positive']] },
      { id: 'recusar', title: 'Recusar', p: 1, ok: { morale: 1 }, okText: 'Foco total no futebol.', chips: [['Foco', 'neutral']] },
    ],
  },
  {
    key: 'jovem_base',
    weight: 2,
    when: (s) => s.age >= 23,
    title: 'Garoto da base',
    description: 'Um jovem da base pede conselhos e quer treinar finalização com você depois das atividades.',
    options: [
      { id: 'ajudar', title: 'Ajudar', p: 1, ok: { teammates: 3, morale: 1, fitness: -5 }, okText: 'O garoto não sai do seu lado. Vestiário aprova.', chips: [['Vestiário +', 'positive'], ['Energia −', 'negative']] },
      { id: 'semtempo', title: 'Sem tempo agora', p: 1, ok: { teammates: -1.5, fitness: 3 }, okText: 'Fica para outra hora.', chips: [['Vestiário −', 'negative'], ['Energia +', 'positive']] },
    ],
  },
  {
    key: 'discussao',
    weight: 2,
    title: 'Discussão no treino',
    description: 'Uma dividida mais dura vira bate-boca com um companheiro no treino.',
    options: [
      { id: 'desculpas', title: 'Pedir desculpas', p: 1, ok: { teammates: 3, morale: -1 }, okText: 'Aperto de mão e página virada.', chips: [['Vestiário +', 'positive'], ['Moral −', 'negative']] },
      { id: 'frente', title: 'Bater de frente', p: 0.35, ok: { teammates: 2, morale: 2 }, bad: { teammates: -6, coach: -4 }, okText: 'Ganhou respeito no grupo.', badText: 'Clima pesado no vestiário.', chips: [['Respeito?', 'neutral'], ['Técnico −', 'negative']] },
    ],
  },
  {
    key: 'entrevista',
    weight: 2,
    title: 'Entrevista exclusiva',
    description: 'Um canal de TV quer uma entrevista exclusiva, com gravação na sua casa.',
    options: [
      { id: 'aceitar', title: 'Aceitar', p: 0.9, ok: { media: 5, followers: 1500 }, bad: { media: -3 }, okText: 'Entrevista elogiada.', badText: 'Uma frase fora de contexto gerou polêmica.', chips: [['Imprensa +', 'positive']] },
      { id: 'recusar', title: 'Recusar', p: 1, ok: { media: -2 }, okText: 'A imprensa não gostou muito.', chips: [['Imprensa −', 'negative']] },
    ],
  },
  {
    key: 'acao_social',
    weight: 2,
    title: 'Visita ao hospital infantil',
    description: 'O clube organiza uma visita a um hospital infantil na folga da semana.',
    options: [
      { id: 'ir', title: 'Ir', p: 1, ok: { fans: 3, media: 2, morale: 2, fitness: -6 }, okText: 'Um dia que você não vai esquecer.', chips: [['Torcida +', 'positive'], ['Folga perdida', 'negative']] },
      { id: 'nao', title: 'Não dá desta vez', p: 1, ok: { media: -2, fitness: 4 }, okText: 'Você descansou em casa.', chips: [['Energia +', 'positive'], ['Imprensa −', 'negative']] },
    ],
  },
  {
    key: 'conversa_tecnico',
    weight: 3,
    title: 'Conversa com o técnico',
    description: 'O técnico te chama na sala dele para corrigir seu posicionamento com vídeos.',
    options: [
      { id: 'ouvir', title: 'Ouvir e aplicar', p: 0.8, ok: { coach: 4, morale: -1, xp: [] }, bad: { coach: 1, morale: -2 }, okText: 'Detalhes que fazem diferença.', badText: 'Você tentou, mas não pegou o jeito ainda.', chips: [['Técnico +', 'positive'], ['Evolução +?', 'positive'], ['Moral −', 'negative']] },
      { id: 'discordar', title: 'Discordar', p: 0.3, ok: { coach: 2, morale: 2 }, bad: { coach: -7 }, okText: 'Ele gostou da personalidade.', badText: 'O técnico ficou irritado.', chips: [['Técnico −?', 'negative']] },
    ],
  },
  {
    key: 'dor_muscular',
    weight: 2,
    title: 'Dor muscular',
    description: 'Você sente a posterior da coxa. O departamento médico sugere poupar.',
    options: [
      { id: 'tratar', title: 'Tratar e ficar fora uma semana', p: 1, ok: { fitness: 12, injuryWeeks: 1 }, okText: 'Recuperação tranquila.', chips: [['1 semana fora', 'neutral']] },
      { id: 'sacrificio', title: 'Jogar no sacrifício', p: 0.7, ok: { coach: 3, fans: 2 }, bad: { injuryWeeks: 4, coach: 1 }, okText: 'Aguentou firme.', badText: 'Lesão agravada: 4 semanas fora.', chips: [['Técnico +', 'positive'], ['Risco de lesão', 'negative']] },
    ],
  },
  {
    key: 'post_antigo',
    weight: 1,
    title: 'Post antigo viraliza',
    description: 'Um tuíte seu de anos atrás volta à tona e a repercussão é ruim.',
    options: [
      { id: 'desculpas', title: 'Pedir desculpas', p: 1, ok: { media: 2, fans: 1, morale: -2 }, okText: 'O assunto morreu rápido.', chips: [['Imprensa +', 'positive']] },
      { id: 'ignorar', title: 'Ignorar', p: 0.5, ok: {}, bad: { media: -5, fans: -3 }, okText: 'Ninguém lembra mais.', badText: 'Virou pauta na TV a semana inteira.', chips: [['Risco', 'negative']] },
    ],
  },
  {
    key: 'familia',
    weight: 2,
    title: 'Saudade de casa',
    description: 'Sua família quer passar umas semanas com você.',
    options: [
      { id: 'trazer', title: 'Trazer a família', p: 1, ok: { morale: 6, balance: -1 }, okText: 'Casa cheia, cabeça leve.', chips: [['Moral +', 'positive'], ['Saldo −', 'negative']] },
      { id: 'foco', title: 'Focar no trabalho', p: 1, ok: { morale: -2, coach: 1 }, okText: 'Foco total — mas a saudade aperta.', chips: [['Moral −', 'negative']] },
    ],
  },
  {
    key: 'mentor',
    weight: 2,
    when: (s) => s.age <= 24,
    title: 'Conselho de veterano',
    description: 'O capitão do time se oferece para te ensinar alguns segredos depois do treino.',
    options: [
      { id: 'aprender', title: 'Aprender', p: 1, ok: { teammates: 2, fitness: -5, xp: [] }, okText: 'Você absorve cada detalhe.', chips: [['Evolução +', 'positive'], ['Energia −', 'negative']] },
      { id: 'agradecer', title: 'Agradecer e seguir', p: 1, ok: { fitness: 2, teammates: -0.5 }, okText: 'Fica para outro dia.', chips: [['Energia +', 'positive']] },
    ],
  },
  {
    key: 'provocacao',
    weight: 1,
    title: 'Provocação nas redes',
    description: 'Um jogador rival te provoca nas redes sociais antes do próximo clássico.',
    options: [
      { id: 'responder', title: 'Responder à altura', p: 0.6, ok: { fans: 4, followers: 4000, media: -2 }, bad: { media: -5, coach: -3 }, okText: 'A torcida foi à loucura.', badText: 'O clube pediu para você apagar o post.', chips: [['Torcida +', 'positive'], ['Imprensa −', 'negative']] },
      { id: 'ignorar', title: 'Ignorar', p: 1, ok: { media: 2, fans: -1.5 }, okText: 'Resposta dentro de campo.', chips: [['Imprensa +', 'positive'], ['Torcida −', 'negative']] },
    ],
  },
  {
    key: 'nutricionista',
    weight: 1,
    when: (s) => s.finance.balance >= 80_000,
    title: 'Nutricionista particular',
    description: 'Um nutricionista renomado oferece acompanhamento personalizado por €50 mil.',
    options: [
      { id: 'contratar', title: 'Contratar', p: 1, ok: { balance: -50_000, fitness: 8, form: 2 }, okText: 'Mais energia nos treinos.', chips: [['Energia +', 'positive'], ['−€50K', 'negative']] },
      { id: 'nao', title: 'Não agora', p: 1, ok: {}, okText: 'Segue a dieta do clube.', chips: [['Nada muda', 'neutral']] },
    ],
  },
  {
    key: 'podcast',
    weight: 2,
    when: (s) => s.age >= 18,
    title: 'Convite para podcast',
    description: 'Um podcast famoso (e polêmico) quer você numa conversa de três horas, sem cortes.',
    options: [
      { id: 'ir', title: 'Topar', p: 0.6, ok: { followers: 5000, media: 2, fans: 1 }, bad: { media: -5, coach: -2, followers: 2000 }, okText: 'Episódio viralizou pelo lado bom.', badText: 'Um trecho sobre o técnico virou manchete.', chips: [['Seguidores +', 'positive'], ['Risco de polêmica', 'negative']] },
      { id: 'recusar', title: 'Recusar', p: 1, ok: { media: -1, coach: 0.5 }, okText: 'Discrição total.', chips: [['Imprensa −', 'negative']] },
    ],
  },
  {
    key: 'clinica',
    weight: 2,
    title: 'Clínica para crianças',
    description: 'Uma escolinha do bairro pede que você passe a folga ensinando a garotada.',
    options: [
      { id: 'sim', title: 'Passar a folga lá', p: 1, ok: { fans: 3, morale: 2, fitness: -5 }, okText: 'A garotada não esquece — nem a torcida.', chips: [['Torcida +', 'positive'], ['Folga perdida', 'negative']] },
      { id: 'nao', title: 'Mandar camisas autografadas', p: 1, ok: { fitness: 3, fans: 0.5, balance: -5_000 }, okText: 'As camisas fizeram sucesso.', chips: [['Energia +', 'positive'], ['−€5K', 'negative']] },
    ],
  },
  {
    key: 'videogame',
    weight: 2,
    when: (s) => s.age <= 30,
    title: 'Maratona de videogame',
    description: 'Os amigos marcam uma maratona de videogame online… que costuma ir até de madrugada.',
    options: [
      { id: 'jogar', title: 'Entrar na partida', p: 0.6, ok: { morale: 3, followers: 800 }, bad: { fitness: -10, coach: -2 }, okText: 'Diversão sem exagero.', badText: 'Foi até as 4h. O treino cobrou.', chips: [['Moral +', 'positive'], ['Risco: energia', 'negative']] },
      { id: 'dormir', title: 'Dormir cedo', p: 1, ok: { fitness: 4, morale: -1 }, okText: 'Oito horas de sono, corpo em dia.', chips: [['Energia +', 'positive'], ['Moral −', 'negative']] },
    ],
  },
  {
    key: 'capitao_cobra',
    weight: 2,
    when: (s) => !s.captain,
    title: 'Cobrança do capitão',
    description: 'O capitão cobra mais intensidade de você na frente de todo mundo no treino.',
    options: [
      { id: 'aceitar', title: 'Aceitar a crítica', p: 1, ok: { teammates: 3, morale: -2, coach: 1 }, okText: 'Você respondeu no treino seguinte.', chips: [['Vestiário +', 'positive'], ['Moral −', 'negative']] },
      { id: 'responder', title: 'Responder na hora', p: 0.4, ok: { teammates: 2, morale: 2 }, bad: { teammates: -5, coach: -3 }, okText: 'Ganhou respeito: ninguém te cobra mais assim.', badText: 'Bate-boca feio. O técnico separou.', chips: [['Respeito?', 'neutral'], ['Risco: vestiário', 'negative']] },
    ],
  },
  {
    key: 'jornal_estrangeiro',
    weight: 1,
    when: (s) => s.reputation >= 15,
    title: 'Entrevista a jornal estrangeiro',
    description: 'Um jornal europeu quer saber do seu futuro — e se você sonha em jogar lá fora.',
    options: [
      { id: 'falar', title: 'Falar abertamente', p: 0.7, ok: { media: 3, followers: 2000, reputation: 0.5 }, bad: { fans: -4, coach: -2 }, okText: 'Repercussão ótima: seu nome circula no mercado.', badText: 'A frase sobre "sonhar em sair" irritou a torcida.', chips: [['Vitrine +', 'positive'], ['Risco: torcida', 'negative']] },
      { id: 'negar', title: 'Desconversar', p: 1, ok: { media: -1, fans: 1 }, okText: 'Foco no clube. A torcida gostou.', chips: [['Torcida +', 'positive'], ['Imprensa −', 'negative']] },
    ],
  },
  {
    key: 'desfalque',
    weight: 2,
    title: 'Companheiro lesionado',
    description: 'Seu concorrente direto se machucou. O técnico pergunta se você aguenta jogar tudo nas próximas semanas.',
    options: [
      { id: 'aguento', title: '“Aguento!”', p: 1, ok: { coach: 4, fitness: -10 }, okText: 'O técnico conta com você.', chips: [['Técnico +', 'positive'], ['Energia −', 'negative']] },
      { id: 'rodizio', title: 'Pedir rodízio', p: 1, ok: { fitness: 5, coach: -2 }, okText: 'Corpo preservado; o técnico ficou com um pé atrás.', chips: [['Energia +', 'positive'], ['Técnico −', 'negative']] },
    ],
  },
]

function miniDecision(s: ImmersiveState, r: ReturnType<typeof subRng>): Decision | null {
  const m = mem(s)
  const recent = m.recentMini ?? []
  const seen = (m.miniSeen ??= {})
  // o mesmo mini-evento no máx. uma vez a cada 2 temporadas (e nunca entre os 6 últimos)
  const pool = MINI.filter((d) => (!d.when || d.when(s)) && !recent.includes(d.key) && !(seen[d.key] !== undefined && s.season - seen[d.key] < 2))
  if (!pool.length) return null
  const def = r.weighted(pool, (d) => d.weight)
  m.recentMini = [...recent, def.key].slice(-6)
  seen[def.key] = s.season
  const mini: NonNullable<NonNullable<typeof m.story>['mini']> = {}
  const options: DecisionOption[] = def.options.map((o) => {
    const id = `${def.key}-${o.id}`
    mini[id] = { p: o.p, ok: o.ok, bad: o.bad, okText: o.okText, badText: o.badText }
    return {
      id,
      label: o.label ?? '',
      title: o.title,
      art: `mini-${def.key}-${o.id}`,
      effects: o.chips.map(([label, kind]) => ({ kind, label, probability: o.p < 1 && kind !== 'neutral' ? (kind === 'positive' ? o.p : 1 - o.p) : undefined })),
    }
  })
  m.story = { source: 'mini', eventKey: def.key, mini }
  return { id: `${s.seed}-${s.season}-${s.week}-${def.key}`, kind: 'event', eventKey: def.key, title: def.title, description: def.description, options }
}

/** Decisão de bastidores do item `story` (null = semana tranquila). */
export function storyDecision(data: GameData, s: ImmersiveState): Decision | null {
  const m = mem(s)
  const r = irng(s, 'story', s.season, s.week)
  m.storiesThisSeason++
  if (s.age >= 17 && m.lastClassicEventSeason < s.season && r.chance(0.45)) {
    const shadow = shadowCareer(s)
    const env = buildEnv(data, shadow)
    let pool = EVENTS.filter((e) => !EXCLUDED.has(e.key) && !m.eventsDone.includes(e.key))
    pool = pool.filter((e) => {
      try {
        return e.eligible(env)
      } catch {
        return false
      }
    })
    while (pool.length) {
      const def = r.weighted(pool, (e) => e.weight)
      const variant = def.variants ? r.weighted(def.variants, (v) => v.weight).key : undefined
      let built = null
      try {
        built = def.build(env, variant, irng(s, 'story-build', s.season, s.week, def.key))
      } catch {
        built = null
      }
      if (built && built.options.length) {
        m.lastClassicEventSeason = s.season
        m.story = { source: 'classic', eventKey: def.key }
        return alignClubCards(assembleDecision(shadow, 'event', built, { eventKey: def.key, variant }), s)
      }
      pool = pool.filter((e) => e !== def)
    }
  }
  if (r.chance(0.2)) return null
  return miniDecision(s, r)
}

/** Salário que o imersivo assina ao trocar de clube por um evento (ver `resolveDecision`). */
const eventSalary = (s: ImmersiveState) => Math.max(s.finance.salary, 24_000)
const EVENT_YEARS = 3

/**
 * Cards de clube dos eventos do Clássico ("Assinar com Ponte Preta · 5 anos · €20K"): o imersivo assina
 * 3 anos pelo salário atual (mín. €24K) e o empréstimo mantém o salário — o card mostra isso.
 */
function alignClubCards(d: Decision, s: ImmersiveState): Decision {
  const specs = (d.context?.specs ?? {}) as Record<string, OptionSpec>
  for (const o of d.options) {
    const spec = specs[o.id]
    if (!o.clubId || !spec || (spec.type !== 'join' && spec.type !== 'permanent' && spec.type !== 'loan')) continue
    const loan = spec.type === 'loan'
    o.details = o.details?.map((x) =>
      x.label === 'Contrato' && !loan ? { ...x, value: `${EVENT_YEARS} anos` } : x.label === 'Salário/ano' ? { ...x, value: formatMoney(loan ? s.finance.salary : eventSalary(s)) } : x,
    )
  }
  return d
}

// ───────────────────────── resolução ─────────────────────────

export function resolveDecision(W: WorldEngine, data: GameData, s: ImmersiveState, optionId: string, fx: ImmersiveEffect[]): boolean {
  const d = s.pendingDecision
  if (!d) return false
  const option = d.options.find((o) => o.id === optionId)
  if (!option) return false
  const m = mem(s)
  const story = m.story
  s.pendingDecision = null
  m.story = undefined
  if (d.kind === 'academy' || story?.source === 'academy') {
    const spec = (d.context?.specs as Record<string, OptionSpec> | undefined)?.[optionId]
    if (!spec?.clubId) return false
    const club = clubOf(data, spec.clubId)
    joinClub(W, data, s, { clubId: spec.clubId, kind: 'free_agent', salary: ACADEMY_CONTRACT.salary, years: ACADEMY_CONTRACT.years, role: 'Promessa' }, fx)
    addInbox(s, 'Seu empresário', 'Vamos construir sua carreira', 'Primeiro passo: ganhar a confiança do técnico nos treinos. Quando surgirem propostas, eu te aviso por aqui — nada de assinar sem falar comigo.')
    fx.push({ type: 'toast', tone: 'gold', title: `Bem-vindo ${artigo(club) === 'a' ? 'à' : 'ao'} ${club?.shortName ?? 'clube'}!`, description: 'Sua carreira começa agora.' })
    return true
  }
  if (story?.source === 'mini' && story.mini?.[optionId]) {
    const o = story.mini[optionId]
    const ok = trng(s, 'mini', d.id, optionId).chance(o.p)
    applyMini(s, ok ? o.ok : (o.bad ?? {}), fx)
    fx.push({ type: 'toast', tone: ok ? 'success' : 'danger', title: d.title, description: ok ? o.okText : (o.badText ?? o.okText) })
    s.log.push({ season: s.season, age: s.age, type: 'decision', text: `${d.title}: ${option.title ?? option.label}. ${ok ? o.okText : (o.badText ?? o.okText)}` })
    return true
  }
  // evento do Clássico
  const specs = (d.context?.specs ?? {}) as Record<string, OptionSpec>
  const spec = specs[optionId]
  if (!spec) return false
  let outcome = spec.outcomes[0] ?? { p: 1, kind: 'neutral' as const, fx: {}, summary: '' }
  if (spec.outcomes.length > 1) {
    const u = trng(s, 'outcome', d.id, optionId).next()
    let acc = 0
    for (const o of spec.outcomes) {
      acc += o.p
      if (u < acc) {
        outcome = o
        break
      }
    }
  }
  if (d.eventKey && !m.eventsDone.includes(d.eventKey)) m.eventsDone.push(d.eventKey)
  if (spec.type === 'retire') {
    retireNow(s, spec.retireReason ?? 'voluntary', fx)
    return true
  }
  if ((spec.type === 'join' || spec.type === 'permanent' || spec.type === 'loan') && spec.clubId && spec.clubId !== s.clubId) {
    const club = clubOf(data, spec.clubId)
    joinClub(W, data, s, { clubId: spec.clubId, kind: spec.type === 'loan' ? 'loan' : 'transfer', salary: eventSalary(s), years: EVENT_YEARS, role: 'Titular' }, fx)
    void club
  }
  applyClassicEffects(data, s, outcome.fx, fx)
  const pick = option.title ? `${option.label} ${option.title}`.trim() : option.label
  s.log.push({ season: s.season, age: s.age, type: 'decision', text: `${d.title} — ${pick}. ${outcome.summary}`.trim(), data: { eventKey: d.eventKey, optionId, outcome: outcome.kind } })
  fx.push({ type: 'toast', tone: outcome.kind === 'positive' ? 'success' : outcome.kind === 'negative' ? 'danger' : 'info', title: d.title, description: outcome.summary })
  return true
}

function applyMini(s: ImmersiveState, f: Fx, fx: ImmersiveEffect[]) {
  const m = mem(s)
  const { ovr, balance, injuryWeeks, xp, ...deltas } = f
  applyDeltas(s, deltas)
  if (balance) s.finance.balance = Math.max(0, s.finance.balance + (Math.abs(balance) === 1 ? Math.sign(balance) * Math.max(20_000, Math.round(s.finance.salary * 0.15)) : balance))
  if (injuryWeeks) {
    // uma lesão nova nunca encurta a que já existe
    if ((s.condition.injury?.weeksLeft ?? 0) < injuryWeeks) s.condition.injury = { name: 'Lesão muscular', weeksLeft: injuryWeeks }
    m.injuries++
  }
  if (xp) {
    // ~meia semana extra de treino no foco mais útil da posição
    const focus = isGK(s.identity.position) ? 'goalkeeping' : 'tactical'
    const before = s.ovr
    for (const u of applyGrowth(s.attributes, s.identity.position, focus, 0.35, m.xp)) fx.push({ type: 'attribute_up', key: u.key, from: u.from, to: u.to })
    s.ovr = ovrOf(s.attributes, s.identity.position)
    if (s.ovr !== before) fx.push({ type: 'ovr_change', from: before, to: s.ovr })
  }
  if (ovr) changeOvr(s, ovr, fx)
}

function changeOvr(s: ImmersiveState, delta: number, fx: ImmersiveEffect[]) {
  const before = s.ovr
  shiftOvr(s.attributes, s.identity.position, delta)
  s.ovr = ovrOf(s.attributes, s.identity.position)
  if (s.ovr !== before) fx.push({ type: 'ovr_change', from: before, to: s.ovr })
}

/** Tradução dos efeitos do Clássico (EffectSpec) para o Modo Imersivo. */
export function applyClassicEffects(data: GameData, s: ImmersiveState, e: EffectSpec, fx: ImmersiveEffect[]): void {
  const m = mem(s)
  const R = s.relationships
  if (e.newPosition && e.newPosition !== s.identity.position) {
    // mudança de posição: atributos rebalanceados para o perfil da posição nova MANTENDO o OVR (a
    // perda prometida pelo evento vem depois, em `e.ovr`)
    m.retrainedFrom = s.identity.position
    const before = s.ovr
    const toGK = e.newPosition === 'GOL'
    let a = toGK !== isGK(s.identity.position) ? convertAttributes(s.attributes, e.newPosition) : { ...s.attributes }
    const prof = attributesFor(e.newPosition, before) as unknown as Record<string, number>
    const cur = a as unknown as Record<string, number>
    for (const k of Object.keys(prof)) cur[k] = Math.round(((cur[k] ?? prof[k]) + prof[k]) / 2)
    a = cur as unknown as typeof a
    shiftOvr(a, e.newPosition, before - ovrOf(a, e.newPosition))
    s.attributes = a
    s.identity = { ...s.identity, position: e.newPosition }
    s.ovr = ovrOf(s.attributes, s.identity.position)
    if (s.ovr !== before) fx.push({ type: 'ovr_change', from: before, to: s.ovr })
  }
  if (e.ovr) changeOvr(s, e.ovr, fx)
  if (e.temp) m.tempOvr = { delta: e.temp.delta, untilSeason: s.season + Math.max(0, (e.temp.afterSeasons ?? 1) - 1) }
  if (e.roleOverride) {
    if (e.roleOverride === 'starter') R.coach = Math.max(R.coach, 80)
    else if (e.roleOverride === 'high_rotation') R.coach = clamp(R.coach, 50, 65)
    else R.coach = Math.min(R.coach, 28)
  }
  if (e.roleShift) R.coach = clamp(R.coach + 12 * e.roleShift, 0, 100)
  if (e.demoteRoleSeasons) R.coach = Math.min(R.coach, 25)
  if (e.suspend) {
    s.condition.suspendedMatches = (s.condition.suspendedMatches ?? 0) + 15
    s.log.push({ season: s.season, age: s.age, type: 'decision', text: 'Suspenso por 15 jogos.' })
  }
  if (e.boost) applyDeltas(s, { teammates: e.boost * 4, coach: e.boost * 2, morale: e.boost * 2 })
  if (e.priority) {
    // vale para a temporada em curso (e a próxima, se o evento vier já na reta final)
    m.priority = e.priority
    m.priorityUntil = s.season + (m.clubMatches >= 25 ? 1 : 0)
  }
  if (e.forceTrophy) applyDeltas(s, { morale: 5 })
  if (e.national) {
    m.nationalFlag = e.national
    m.nationalFlagSeason = s.season
  }
  if (e.nationalBoost) applyDeltas(s, { morale: 3 })
  if (e.switchNationality) {
    s.identity = { ...s.identity, nationality: e.switchNationality }
    const cf = countryOf(data, e.switchNationality)?.confed
    if (cf) m.natConfeds[e.switchNationality] = cf
  }
  if (e.retireNational) m.nationalRetired = true
  if (e.declineFactor) m.declineFactor = Math.max(0.35, m.declineFactor * e.declineFactor)
  if (e.offerBoost) m.offerBoost = e.offerBoost
  if (e.superAgent) m.superAgent = true
  if (e.captain === true && s.clubId) {
    m.captainAt = s.clubId
    s.captain = true
  }
  if (e.captain === 'lose') {
    m.captainAt = null
    s.captain = false
  }
  if (e.salaryMult) s.finance.salary = Math.round(Math.max(s.finance.salary, 24_000) * e.salaryMult)
  if (e.renewYears) s.finance.contractUntil = s.season + e.renewYears
  if (e.valueMult) m.valueMult *= e.valueMult
  if (e.statsMult) applyDeltas(s, e.statsMult > 1 ? { form: 10, morale: 5 } : { form: -10, morale: -3 })
  if (e.spotlightOff) {
    m.farFromSpotlight = true
    s.reputation = clamp(s.reputation - 5, 0, 100)
  }
  if (e.injury) {
    const weeks = clamp(Math.abs(e.injury.ovrDelta) * 3 + 2, 2, 30)
    if ((s.condition.injury?.weeksLeft ?? 0) < weeks) s.condition.injury = { name: e.injury.name, weeksLeft: weeks, ovrDelta: e.injury.ovrDelta }
    changeOvr(s, e.injury.ovrDelta, fx)
    m.seasonInjury = e.injury
    m.injuries++
    s.log.push({ season: s.season, age: s.age, type: 'injury', text: `Lesão: ${e.injury.name} (${weeks} semanas).` })
    addNews(s, `${s.identity.surname} sofre ${e.injury.name.toLowerCase()} e desfalca o time`, 'negative', fx)
  }
}
