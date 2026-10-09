/**
 * Catálogo de eventos pessoais.
 *
 * - Os 25 eventos do Copero (mesmas condições, pesos, probabilidades e efeitos, inclusive os
 *   ocultos), com textos reescritos em pt-BR, variantes que o Copero deixava mortas agora
 *   sorteáveis e pílulas que mostram o efeito REAL.
 * - 10 eventos novos do LENDA (origin: 'lenda').
 * - A lesão (`injury`) é construída à parte (pré-sorteio de 2% por janela).
 *
 * Arte de cada opção: `${eventKey}-${optionKey}`.
 */
import type { Rng } from '../../rng'
import type { Club, DecisionOption, EffectChip, Position } from '../../types'
import { INJURIES, type InjuryDef } from '../constants'
import { clubCard, foreignClub, homeClub, moneyClub, rivalClubs } from '../offers'
import { isPlayingRole, predictRole } from '../player'
import { clubArticle, clubStrength, confedCompetition, indexData, POSITION_NAMES, withArticle } from '../util'
import type { BuiltEvent, EffectSpec, EventDef, EventEnv, EventOption, OutcomeSpec } from './types'

// ───────────────────────── construtores ─────────────────────────

const pos = (label: string, probability?: number): EffectChip => ({ kind: 'positive', label, probability })
const neg = (label: string, probability?: number): EffectChip => ({ kind: 'negative', label, probability })
const neu = (label: string, probability?: number): EffectChip => ({ kind: 'neutral', label, probability })
const fixed = (label: string): EffectChip => ({ kind: 'fixed', label })

const sure = (fx: EffectSpec, summary: string, kind: OutcomeSpec['kind'] = 'neutral'): OutcomeSpec[] => [{ p: 1, kind, fx, summary }]
const nothing = (summary = 'Nada mudou.'): OutcomeSpec[] => sure({}, summary)

function choice(
  eventKey: string,
  optionKey: string,
  label: string,
  effects: EffectChip[],
  outcomes: OutcomeSpec[],
  extra: Partial<DecisionOption> = {},
): EventOption {
  return {
    option: { id: `${eventKey}-${optionKey}`, label, art: `${eventKey}-${optionKey}`, effects, ...extra },
    spec: { type: 'choice', optionKey, outcomes },
  }
}

/** Opção com um resultado sorteado entre duas pílulas (0 = boa, 1 = ruim). */
function gamble(p: number, win: EffectSpec, lose: EffectSpec, winText: string, loseText: string): OutcomeSpec[] {
  return [
    { p, chip: 0, kind: 'positive', fx: win, summary: winText },
    { p: 1 - p, chip: 1, kind: 'negative', fx: lose, summary: loseText },
  ]
}

/** Card de clube dentro de um evento (entrar em outro clube). */
function clubJoin(env: EventEnv, eventKey: string, optionKey: string, label: string, club: Club, fx: EffectSpec = {}, summary?: string): EventOption {
  const card = clubCard(env.data, env.state, club, `${eventKey}-${optionKey}-${club.id}`, label)
  return {
    option: { ...card, art: `${eventKey}-${optionKey}` },
    spec: { type: 'join', optionKey, clubId: club.id, outcomes: sure(fx, summary ?? `Novo clube: ${club.name}.`) },
  }
}

/** Card de "ficar" no clube atual (sem troca). */
function clubStay(env: EventEnv, eventKey: string, optionKey: string, label: string, effects: EffectChip[], outcomes: OutcomeSpec[]): EventOption {
  const club = env.club!
  return {
    option: { id: `${eventKey}-${optionKey}`, label, title: club.shortName || club.name, clubId: club.id, art: `${eventKey}-${optionKey}`, effects },
    spec: { type: 'choice', optionKey, clubId: club.id, outcomes },
  }
}

/** Primeira oferta da janela injetada como saída (Copero `cr` para o conjunto Kl). */
function exitOption(env: EventEnv, eventKey: string, label: string): EventOption | null {
  const club = env.offers()[0]
  return club ? clubJoin(env, eventKey, 'join', label, club) : null
}

const no = (env: EventEnv) => withArticle('em', env.club ?? undefined)
/** "O Flamengo" / "A Juventus" no começo da frase. */
const theClub = (club: Club) => `${clubArticle(club).toUpperCase()} ${club.name}`
const hasOffer = (env: EventEnv) => env.offers().length > 0

const RELATIVES: Record<string, [string, string]> = {
  uncle: ['Seu tio', 'seu tio'],
  aunt: ['Sua tia', 'sua tia'],
  male_cousin: ['Seu primo', 'seu primo'],
  female_cousin: ['Sua prima', 'sua prima'],
  brother: ['Seu irmão', 'seu irmão'],
  sister: ['Sua irmã', 'sua irmã'],
}

const RETRAIN: Partial<Record<Position, Position>> = {
  CA: 'MEI',
  PE: 'ME',
  PD: 'MD',
  MEI: 'MC',
  ME: 'LE',
  MD: 'LD',
  MC: 'VOL',
  LE: 'ZAG',
  LD: 'ZAG',
  VOL: 'ZAG',
}

// ───────────────────────── os 25 eventos do Copero ─────────────────────────

const COPERO: EventDef[] = [
  {
    key: 'training_extra',
    weight: 100,
    origin: 'copero',
    variants: [
      { key: 'standard', weight: 50 },
      { key: 'preseason_camp', weight: 50 },
    ],
    eligible: () => true,
    build(env, v) {
      const k = 'training_extra'
      if (v === 'preseason_camp')
        return {
          title: 'Concentração extra',
          description: 'Uma concentração fechada, longe de casa, pode dar um salto no seu jogo — ou te deixar esgotado.',
          options: [
            choice(k, 'accept', 'Topar', [pos('+4 OVR', 0.65), neg('−3 OVR', 0.35)], gamble(0.65, { ovr: 4 }, { ovr: -3 }, 'A concentração valeu a pena: +4 OVR.', 'O corpo cobrou a conta: −3 OVR.')),
            choice(k, 'reject', 'Seguir a rotina', [fixed('Nada muda')], nothing()),
          ],
        }
      return {
        title: 'Treino extra',
        description: 'A comissão técnica propõe uma pré-temporada puxada. Dá para evoluir bastante, mas o risco de se machucar aumenta.',
        options: [
          choice(k, 'accept', 'Encarar', [pos('+3 OVR', 0.7), neg('−2 OVR', 0.3)], gamble(0.7, { ovr: 3 }, { ovr: -2 }, 'O treino extra deu resultado: +3 OVR.', 'Exagerou na dose: −2 OVR.')),
          choice(k, 'reject', 'Priorizar o descanso', [fixed('Nada muda')], nothing()),
        ],
      }
    },
  },
  {
    key: 'personal_coach',
    weight: 100,
    origin: 'copero',
    variants: [
      { key: 'technique', weight: 50 },
      { key: 'nutrition_plan', weight: 50 },
    ],
    eligible: () => true,
    build(env, v) {
      const k = 'personal_coach'
      if (v === 'nutrition_plan')
        return {
          title: 'Dieta nova',
          description: 'Uma nutricionista propõe uma reeducação alimentar completa. O corpo pode responder muito bem ou estranhar.',
          options: [
            choice(k, 'accept', 'Seguir a dieta', [pos('+3 OVR', 0.6), neg('−2 OVR', 0.4)], gamble(0.6, { ovr: 3 }, { ovr: -2 }, 'A dieta funcionou: +3 OVR.', 'O corpo estranhou a dieta: −2 OVR.')),
            choice(k, 'reject', 'Comer como sempre', [fixed('Nada muda')], nothing()),
          ],
        }
      return {
        title: 'Preparador particular',
        description: 'Um preparador particular quer reconstruir sua técnica do zero. Pode dar muito certo… ou te tirar do eixo.',
        options: [
          choice(k, 'accept', 'Mudar a técnica', [pos('+2 OVR', 0.5), neg('−2 OVR', 0.5)], gamble(0.5, { ovr: 2 }, { ovr: -2 }, 'A nova técnica encaixou: +2 OVR.', 'A mudança te tirou do eixo: −2 OVR.')),
          choice(k, 'reject', 'Manter o estilo', [fixed('Nada muda')], nothing()),
        ],
      }
    },
  },
  {
    key: 'mysterious_substance',
    weight: 20,
    origin: 'copero',
    eligible: () => true,
    build() {
      const k = 'mysterious_substance'
      return {
        title: 'Suplemento suspeito',
        description: 'Alguém da equipe médica oferece um suplemento sem rótulo, jurando que é "totalmente natural".',
        options: [
          choice(k, 'consume', 'Tomar', [pos('+5 OVR', 0.75), neg('Pego no antidoping: suspensão', 0.25)], gamble(0.75, { ovr: 5 }, { suspend: true }, 'Ninguém percebeu nada: +5 OVR.', 'Pego no antidoping: suspenso.')),
          choice(k, 'reject', 'Recusar', [fixed('Nada muda')], nothing()),
        ],
      }
    },
  },
  {
    key: 'honesty_test',
    weight: 20,
    origin: 'copero',
    eligible: () => true,
    build() {
      const k = 'honesty_test'
      return {
        title: 'Mala preta',
        description: 'Um sujeito misterioso oferece uma bolada para você "facilitar" no próximo jogo.',
        options: [
          choice(k, 'accept', 'Aceitar a bolada', [pos('+2 OVR (ninguém descobre)', 0.5), neg('Esquema descoberto: suspensão', 0.5)], gamble(0.5, { ovr: 2 }, { suspend: true }, 'Ninguém descobriu: +2 OVR.', 'O esquema foi descoberto: suspenso.')),
          choice(k, 'reject', 'Recusar e denunciar', [fixed('Nada acontece')], nothing('Você recusou a proposta.')),
        ],
      }
    },
  },
  {
    key: 'indecent_proposal',
    weight: 20,
    origin: 'copero',
    eligible: () => true,
    build() {
      const k = 'indecent_proposal'
      return {
        title: 'Proposta indecente',
        description: 'A namorada de um companheiro de time começa a dar em cima de você.',
        options: [
          choice(
            k,
            'proceed',
            'Seguir em frente',
            [pos('+2 OVR de motivação', 0.5), neg('Descoberto: −2 OVR e banco por uma temporada', 0.5)],
            gamble(0.5, { ovr: 2 }, { ovr: -2, roleOverride: 'substitute', roleSeasons: 1 }, 'Ninguém ficou sabendo: +2 OVR.', 'Vocês foram descobertos: −2 OVR e banco.'),
          ),
          choice(k, 'reject', 'Cortar o papo', [fixed('Nada acontece')], nothing()),
        ],
      }
    },
  },
  {
    key: 'controversial_post',
    weight: 35,
    origin: 'copero',
    variants: Object.keys(RELATIVES).map((key) => ({ key, weight: 1 })),
    eligible: () => true,
    build(env, v) {
      const k = 'controversial_post'
      const [Rel, rel] = RELATIVES[v ?? 'uncle'] ?? RELATIVES.uncle
      return {
        title: 'Post polêmico',
        description: `${Rel} detonou o time nas redes sociais e a torcida está furiosa.`,
        options: [
          choice(k, 'support_family', `Defender ${rel}`, [neg('Menos minutos nesta temporada')], sure({ demoteRoleSeasons: 1 }, 'O clube não gostou: menos minutos.', 'negative')),
          choice(k, 'support_club', 'Ficar do lado do clube', [neg(`−2 OVR temporário (clima ruim com ${rel})`)], sure({ temp: { delta: -2, afterSeasons: 1 } }, 'O clima em casa pesou: −2 OVR temporário.', 'negative')),
        ],
      }
    },
  },
  {
    key: 'season_load',
    weight: 100,
    origin: 'copero',
    variants: [
      { key: 'heavy_load', weight: 50 },
      { key: 'double_session', weight: 50 },
    ],
    eligible: (env) => isPlayingRole(env.role),
    build(env, v) {
      const k = 'season_load'
      const dbl = v === 'double_session'
      const p = dbl ? 0.65 : 0.7
      return {
        title: dbl ? 'Treino em dobro' : 'Carga pesada',
        description: dbl
          ? 'O preparador sugere dois treinos por dia para você brigar por mais espaço.'
          : 'Depois de uma temporada puxada, você pode acelerar ainda mais ou cuidar do físico.',
        options: [
          choice(k, 'accept', dbl ? 'Treinar dobrado' : 'Acelerar', [pos('Titular', p), neg('Lesão: reserva no período', 1 - p)], gamble(p, { roleOverride: 'starter' }, { roleOverride: 'substitute' }, 'O físico respondeu: titular absoluto.', 'O corpo não aguentou: reserva no período.')),
          choice(k, 'stay_calm', dbl ? 'Manter a carga' : 'Cuidar do físico', [neg('Menos minutos')], sure({ roleShift: -1 }, 'Você jogou menos.', 'negative')),
        ],
      }
    },
  },
  {
    key: 'position_change',
    weight: 100,
    origin: 'copero',
    eligible: (env) => !env.isGK,
    build() {
      const k = 'position_change'
      return {
        title: 'Improvisado',
        description: 'O técnico precisa de você numa posição que não é a sua por um tempo.',
        options: [
          choice(k, 'accept', 'Aceitar', [pos('Titular no período'), neg('−2 OVR temporário')], sure({ roleOverride: 'starter', temp: { delta: -2 } }, 'Titular improvisado: −2 OVR temporário.', 'positive')),
          choice(k, 'reject', 'Recusar', [neg('Menos minutos')], sure({ roleShift: -1 }, 'O técnico não gostou: menos minutos.', 'negative')),
        ],
      }
    },
  },
  {
    key: 'position_competition',
    weight: 100,
    origin: 'copero',
    eligible: (env) => isPlayingRole(env.role),
    build(env) {
      const k = 'position_competition'
      const opts = [
        choice(k, 'compete', 'Brigar pela vaga', [pos('Titular', 0.5), neg('Rotação baixa', 0.5)], gamble(0.5, { roleOverride: 'starter' }, { roleOverride: 'low_rotation' }, 'Você ganhou a disputa: titular.', 'O reforço levou a melhor: rotação baixa.')),
      ]
      const exit = exitOption(env, k, 'Assinar com')
      if (exit) opts.push(exit)
      return { title: 'Briga pela vaga', description: 'O clube contratou um reforço para a sua posição. A titularidade está em jogo.', options: opts }
    },
  },
  {
    key: 'unexpected_prospect',
    weight: 45,
    origin: 'copero',
    eligible: (env) => env.age > 22 && isPlayingRole(env.role) && hasOffer(env),
    build(env) {
      const k = 'unexpected_prospect'
      const exit = exitOption(env, k, 'Sair para')
      if (!exit) return null
      return {
        title: 'Joia da base',
        description: 'Um garoto da base está voando nos treinos e ameaça o seu lugar. Você pode ajudá-lo a crescer ou procurar outro clube.',
        options: [
          choice(k, 'mentor', 'Ser o mentor dele', [pos('Mais chances de títulos'), neg('Seu papel diminui')], sure({ roleShift: -1, boost: 1.5 }, 'O time ficou mais forte, mas você jogou menos.', 'neutral')),
          exit,
        ],
      }
    },
  },
  {
    key: 'club_priority',
    weight: 100,
    origin: 'copero',
    eligible: (env) => {
      if (env.role !== 'starter' || !env.club || !env.league || env.tier !== 1 || env.clubPrestige < 3) return false
      const prim = confedCompetition(env.data, env.league.confed, 'primary')
      if (!prim) return false
      const q = env.state.world.qualified[prim.id]
      return q && q.length ? q.includes(env.club.id) : env.league.coefficient >= 0.6
    },
    build(env) {
      const k = 'club_priority'
      const league = env.league!
      const prim = confedCompetition(env.data, league.confed, 'primary')!
      return {
        title: 'Prioridade do clube',
        description: 'A diretoria quer definir o foco da temporada: o campeonato nacional ou o torneio continental?',
        options: [
          choice(k, 'prioritize_league', 'Priorizar a liga', [pos('Mais chance de ganhar a liga'), neg(`Menos chance na ${prim.name}`)], sure({ priority: 'league' }, 'Foco total na liga.'), {
            title: league.shortName,
            trophyId: league.trophyId,
          }),
          choice(k, 'prioritize_continental', 'Priorizar o continental', [pos(`Mais chance na ${prim.name}`), neg('Menos chance de ganhar a liga')], sure({ priority: 'continental' }, 'Foco total no torneio continental.'), {
            title: prim.name,
            trophyId: prim.trophyId,
          }),
        ],
        context: { competitions: [league.id, prim.id] },
      }
    },
  },
  {
    key: 'rival_offer',
    weight: 80,
    origin: 'copero',
    eligible: (env) => env.role === 'starter' && env.clubPrestige >= 3 && env.tier === 1 && rivalClubs(env.data, env.state).length > 0,
    build(env, _v, r) {
      const k = 'rival_offer'
      const rival = r.pick(rivalClubs(env.data, env.state))
      const join = clubJoin(env, k, 'accept', 'Ir para', rival, { roleOverride: 'high_rotation', boost: 1.5 }, `Trocou de lado: agora joga ${withArticle('em', rival)} ${rival.name}.`)
      join.option.effects = [pos('Mais chances de título'), neg('Menos minutos')]
      return {
        title: 'Proposta do rival',
        description: `${theClub(rival)} quer te tirar daqui para montar um esquadrão. Topa a provocação?`,
        options: [join, clubStay(env, k, 'reject', `Ficar ${no(env)}`, [fixed('Você segue titular')], nothing('Você recusou o rival.'))],
        context: { rivalClubId: rival.id },
      }
    },
  },
  {
    key: 'club_crisis',
    weight: 45,
    origin: 'copero',
    eligible: (env) => env.clubPrestige >= 2 && hasOffer(env),
    build(env) {
      const k = 'club_crisis'
      const exit = exitOption(env, k, 'Sair para')
      if (!exit) return null
      return {
        title: 'Clube em crise',
        description: 'Salários atrasados, técnico balançando e resultados ruins. Um clube aparece com uma proposta.',
        options: [clubStay(env, k, 'stay_and_fight', `Ficar e lutar ${no(env)}`, [neg('Menos chances de título')], sure({ boost: -3 }, 'A crise derrubou o time.', 'negative')), exit],
      }
    },
  },
  {
    key: 'fan_backlash',
    weight: 80,
    origin: 'copero',
    eligible: (env) => env.age > 22 && hasOffer(env),
    build(env) {
      const k = 'fan_backlash'
      const exit = exitOption(env, k, 'Sair para')
      if (!exit) return null
      return {
        title: 'Torcida na bronca',
        description: 'As vaias aumentam a cada jogo e a torcida questiona se você ainda merece a camisa.',
        options: [clubStay(env, k, 'stay_and_fight', `Aguentar a pressão ${no(env)}`, [neg('−2 OVR temporário (pressão)')], sure({ temp: { delta: -2 } }, 'A pressão pesou: −2 OVR temporário.', 'negative')), exit],
      }
    },
  },
  {
    key: 'return_home',
    weight: 45,
    origin: 'copero',
    eligible: (env) => env.age > 24 && env.abroad && (indexData(env.data).clubsByCountry.get(env.state.identity.nationality)?.length ?? 0) > 0,
    build(env, _v, r) {
      const k = 'return_home'
      const home = homeClub(env.data, env.state, r)
      if (!home) return null
      return {
        title: 'Saudade de casa',
        description: 'Sua família sente sua falta e pede que você volte a jogar no seu país.',
        options: [
          clubStay(env, k, 'stay_abroad', `Ficar ${no(env)}`, [neg('−5 OVR temporário (clima pesado em casa)')], sure({ temp: { delta: -5 } }, 'A distância pesou: −5 OVR temporário.', 'negative')),
          clubJoin(env, k, 'join', 'Voltar para', home, {}, `De volta para casa: ${home.name}.`),
        ],
      }
    },
  },
  {
    key: 'giant_tattoo',
    weight: 35,
    origin: 'copero',
    eligible: () => true,
    build() {
      const k = 'giant_tattoo'
      return {
        title: 'Tatuagem gigante',
        description: 'Um estúdio famoso quer tatuar um leão enorme nas suas costas — de graça, em troca de divulgação.',
        options: [
          choice(k, 'accept', 'Fazer', [pos('+2 OVR (autoestima)', 0.7), neg('Infeccionou: reserva por uma temporada', 0.3)], gamble(0.7, { ovr: 2 }, { roleOverride: 'substitute', roleSeasons: 1 }, 'Ficou incrível: +2 OVR de autoestima.', 'A tatuagem infeccionou: banco por uma temporada.')),
          choice(k, 'reject', 'Dispensar', [fixed('Nada acontece')], nothing()),
        ],
      }
    },
  },
  {
    key: 'tax_trouble',
    weight: 25,
    origin: 'copero',
    // o fisco "local" e a permanência no país só fazem sentido para quem joga fora de casa
    eligible: (env) => env.abroad && !!env.club && indexData(env.data).simClubs.some((c) => c.country !== env.club!.country),
    build(env, _v, r) {
      const k = 'tax_trouble'
      const exit = foreignClub(env.data, env.state, r)
      if (!exit) return null
      const country = indexData(env.data).country.get(env.club!.country)?.name ?? env.club!.country
      return {
        title: `Problemas fiscais · ${country}`,
        description: 'O fisco local abriu uma investigação sobre seus contratos de imagem e sua permanência no país ficou em dúvida.',
        options: [
          clubStay(env, k, 'stay_and_fight', `Ficar ${no(env)}`, [neg('−3 OVR temporário (distração)')], sure({ temp: { delta: -3 } }, 'A investigação tirou seu foco: −3 OVR temporário.', 'negative')),
          clubJoin(env, k, 'join', 'Sair para', exit),
        ],
      }
    },
  },
  {
    key: 'foreign_grandfather',
    weight: 25,
    origin: 'copero',
    eligible: (env) =>
      !env.calledUpBefore && !!env.nat && (indexData(env.data).countriesByConfed.get(env.nat.confed)?.length ?? 0) > 1,
    build(env, _v, r) {
      const k = 'foreign_grandfather'
      const others = (indexData(env.data).countriesByConfed.get(env.nat!.confed) ?? []).filter((c) => c.code !== env.nat!.code)
      if (!others.length) return null
      const alt = r.pick(others)
      return {
        title: 'Avô estrangeiro',
        description: `Uma pesquisa de família revelou um avô nascido no exterior. Com isso, você pode defender outra seleção: ${alt.name}.`,
        options: [
          choice(k, 'switch_national_team', 'Mudar de seleção', [fixed('Você passa a defender uma nova seleção')], sure({ switchNationality: alt.code }, `Nova seleção: ${alt.name}.`), { title: alt.name }),
          choice(k, 'keep_national_team', 'Manter a seleção', [fixed('Tudo segue como está')], nothing('Você manteve sua seleção.'), { title: env.nat!.name }),
        ],
        context: { alternativeNationality: alt.code },
      }
    },
  },
  {
    key: 'finish_high_school',
    weight: 35,
    origin: 'copero',
    // correção óbvia: não faz sentido voltar ao ensino médio aos 35
    eligible: (env) => env.age <= 28,
    build() {
      const k = 'finish_high_school'
      return {
        title: 'Terminar os estudos',
        description: 'Você pode voltar à sala de aula e concluir o ensino médio sem largar o futebol.',
        options: [
          choice(k, 'accept', 'Voltar a estudar', [pos('+1 OVR (maturidade)'), neg('Menos minutos no período')], sure({ ovr: 1, roleShift: -1 }, 'Diploma na mão: +1 OVR, menos minutos.', 'positive')),
          choice(k, 'reject', 'Focar só na bola', [fixed('Nada muda')], nothing()),
        ],
      }
    },
  },
  {
    key: 'controversial_statement',
    weight: 45,
    origin: 'copero',
    eligible: () => true,
    build(env) {
      const k = 'controversial_statement'
      const opts = [choice(k, 'apologize', 'Pedir desculpas', [neg('Seus minutos diminuem')], sure({ roleShift: -1 }, 'O técnico aceitou as desculpas, mas você perdeu espaço.', 'negative'))]
      const exit = exitOption(env, k, 'Assinar com')
      if (exit) opts.push(exit)
      return { title: 'Desabafo polêmico', description: 'Depois de uma derrota dolorosa, você critica o técnico em público e o vestiário racha.', options: opts }
    },
  },
  {
    key: 'triumphant_return',
    weight: 50,
    origin: 'copero',
    eligible: (env) => {
      const first = env.m.firstClubId
      if (env.age < 32 || !first || !env.club || first === env.club.id) return false
      const club = indexData(env.data).club.get(first)
      if (!club) return false
      const role = predictRole(env.ovr, clubStrength(env.state.world, club), env.position)
      return env.isGK ? role === 'starter' || role === 'substitute' : role !== 'substitute'
    },
    build(env) {
      const k = 'triumphant_return'
      const first = indexData(env.data).club.get(env.m.firstClubId!)!
      const join = clubJoin(env, k, 'join', `Voltar ${withArticle('a', first)}`, first, { roleOverride: 'starter' }, `A volta para casa: ${first.name}.`)
      join.option.effects = [pos('Titular garantido')]
      return {
        title: 'A volta do filho pródigo',
        description: 'Seu clube formador quer você de volta para encerrar a carreira como titular, em casa.',
        options: [join, clubStay(env, k, 'stay', `Ficar ${no(env)}`, [fixed('Você segue onde está')], nothing('Você preferiu ficar.'))],
      }
    },
  },
  {
    key: 'club_national_team_conflict',
    weight: 20,
    origin: 'copero',
    eligible: (env) => env.ovr >= env.callUpOvr && !env.m.nationalRetired && !!env.nationalTournament(),
    build(env) {
      const k = 'club_national_team_conflict'
      const t = env.nationalTournament()!
      return {
        title: 'Clube × seleção',
        description: `O clube não quer liberar você para a preparação da seleção antes da ${t.name}.`,
        options: [
          choice(k, 'go_anyway', 'Ir mesmo assim', [pos(`Você joga a ${t.name}`), neg('Reserva no clube')], sure({ national: 'force', roleOverride: 'substitute' }, `Você foi para a ${t.name} e perdeu espaço no clube.`)),
          choice(k, 'comply', 'Obedecer ao clube', [pos('Seu papel no clube não muda'), neg(`Fora da ${t.name}`)], sure({ national: 'skip' }, `Você ficou fora da ${t.name}.`)),
        ],
        context: { tournament: t },
      }
    },
  },
  {
    key: 'injury_at_peak',
    weight: 20,
    origin: 'copero',
    eligible: (env) => env.role === 'starter' && !!env.clubTrophyTarget(),
    build(env) {
      const k = 'injury_at_peak'
      const t = env.clubTrophyTarget()!
      const win = (w: boolean): EffectSpec => ({ ovr: -1, forceTrophy: { kind: t.kind, win: w } })
      return {
        title: 'Lesão na hora H',
        description: `Uma lesão aparece justo na reta final da disputa: ${t.name}. Joga no sacrifício ou se trata?`,
        options: [
          choice(k, 'play_injured', 'Jogar no sacrifício', [pos(`Título: ${t.name}`, 0.8), neg('Perde o título', 0.2), neg('−1 OVR (a lesão piora)')], gamble(0.8, win(true), win(false), `Valeu o sacrifício: ${t.name}!`, 'O sacrifício não bastou.')),
          choice(
            k,
            'recover',
            'Se tratar',
            [pos(`Título: ${t.name}`, 0.3), neg('Perde o título', 0.7), neu('Recuperação sem sequelas')],
            gamble(0.3, { forceTrophy: { kind: t.kind, win: true } }, { forceTrophy: { kind: t.kind, win: false } }, `Mesmo sem você, veio o título: ${t.name}!`, 'Sem você, o time não aguentou.'),
          ),
        ],
        context: { target: t },
      }
    },
  },
  {
    key: 'decisive_penalty',
    weight: 20,
    origin: 'copero',
    eligible: (env) => !!env.penaltyTarget(),
    build(env) {
      const k = 'decisive_penalty'
      const t = env.penaltyTarget()!
      // melhora: a chance depende do OVR (Copero: 50% fixos); o meio é mais arriscado
      const base = Math.min(0.65, Math.max(0.4, 0.5 + (env.ovr - 80) * 0.01))
      const sides: { key: 'left' | 'center' | 'right'; label: string; gk: string; p: number }[] = [
        { key: 'left', label: 'Canto esquerdo', gk: 'Pular para a esquerda', p: base },
        { key: 'center', label: 'No meio', gk: 'Ficar no meio', p: base - 0.05 },
        { key: 'right', label: 'Canto direito', gk: 'Pular para a direita', p: base },
      ]
      const p2 = (p: number) => Math.round(p * 100) / 100
      return {
        title: 'Pênalti decisivo',
        description: env.isGK
          ? `Final de ${t.name}: a decisão foi para os pênaltis e a última cobrança adversária está nas suas mãos.`
          : `Final de ${t.name}: a decisão foi para os pênaltis e a última cobrança é sua.`,
        options: sides.map((s) => {
          const o = choice(
            k,
            s.key,
            env.isGK ? s.gk : s.label,
            env.isGK ? [pos('Defesa! Título', p2(s.p)), neg('Gol deles: vice', p2(1 - s.p))] : [pos('Gol! Título', p2(s.p)), neg('Defesa: fica com o vice', p2(1 - s.p))],
            gamble(p2(s.p), { forceTrophy: { kind: t.kind, win: true } }, { forceTrophy: { kind: t.kind, win: false } }, env.isGK ? 'Defesa! O título é seu.' : 'Gol! O título é seu.', env.isGK ? 'Gol deles: ficou com o vice.' : 'O goleiro defendeu: ficou com o vice.'),
            { minigame: 'penalty' },
          )
          o.spec.penalty = { side: s.key }
          return o
        }),
        context: { target: t },
      }
    },
  },
]

// ───────────────────────── eventos novos do LENDA ─────────────────────────

const LENDA: EventDef[] = [
  {
    key: 'contract_renewal',
    weight: 60,
    origin: 'lenda',
    eligible: (env) => env.age >= 23 && env.age <= 31 && isPlayingRole(env.role) && env.m.seasonsAtClub >= 1 && !env.m.loan,
    build() {
      const k = 'contract_renewal'
      return {
        title: 'Renovação de contrato',
        description: 'A diretoria quer renovar seu contrato. Seu empresário acha que dá para ganhar mais testando o mercado.',
        options: [
          choice(k, 'renew', 'Renovar com aumento', [pos('Salário +40%'), pos('+1 OVR (tranquilidade)')], sure({ salaryMult: 1.4, ovr: 1, renewYears: 4 }, 'Contrato renovado com aumento: +1 OVR.', 'positive')),
          choice(
            k,
            'test_market',
            'Testar o mercado',
            [pos('Propostas de clubes maiores', 0.6), neg('Clima ruim: menos minutos', 0.4)],
            gamble(0.6, { offerBoost: 4 }, { roleShift: -1 }, 'Seu nome agitou o mercado: a próxima janela trará clubes maiores.', 'A diretoria não gostou: menos minutos.'),
          ),
        ],
      }
    },
  },
  {
    key: 'captaincy',
    weight: 50,
    origin: 'lenda',
    eligible: (env) => env.age >= 25 && env.role === 'starter' && env.m.seasonsAtClub >= 2 && !!env.club && env.m.captainAt !== env.club.id && !env.m.loan,
    build() {
      const k = 'captaincy'
      return {
        title: 'A braçadeira',
        description: 'O técnico quer que você seja o novo capitão do time.',
        options: [
          choice(k, 'accept', 'Aceitar a braçadeira', [pos('+2 OVR (liderança)', 0.6), neg('Pressão: −2 OVR temporário', 0.4)], gamble(0.6, { captain: true, ovr: 2 }, { captain: true, temp: { delta: -2 } }, 'Capitão nato: +2 OVR.', 'A braçadeira pesou: −2 OVR temporário.')),
          choice(k, 'decline', 'Recusar', [fixed('Nada muda')], nothing('Você preferiu não ser capitão.')),
        ],
      }
    },
  },
  {
    key: 'saudi_millions',
    weight: 40,
    origin: 'lenda',
    eligible: (env) => env.age >= 29 && env.ovr >= 74 && !env.m.farFromSpotlight && !!env.club,
    build(env, _v, r) {
      const k = 'saudi_millions'
      const club = moneyClub(env.data, env.state, r)
      if (!club || club.id === env.club?.id) return null
      const join = clubJoin(env, k, 'accept', 'Aceitar os milhões:', club, { salaryMult: 4, spotlightOff: true }, `Rumo aos milhões: ${club.name}.`)
      join.option.effects = [pos('Salário astronômico'), neg('Adeus ao sonho da Bola de Ouro')]
      return {
        title: 'Proposta milionária',
        description: `${theClub(club)} oferece um caminhão de dinheiro para você virar a estrela do projeto.`,
        options: [join, clubStay(env, k, 'stay', `Ficar ${no(env)}`, [fixed('O sonho continua')], nothing('Você recusou os milhões.'))],
      }
    },
  },
  {
    key: 'national_retirement',
    weight: 45,
    origin: 'lenda',
    eligible: (env) => env.age >= 33 && env.state.national.apps >= 10 && !env.m.nationalRetired,
    build(env) {
      const k = 'national_retirement'
      return {
        title: 'Adeus à seleção?',
        description: `Aos ${env.age} anos, você pensa em se despedir da seleção para prolongar a carreira no clube.`,
        options: [
          choice(k, 'retire_national', 'Aposentar da seleção', [pos('Declínio mais lento'), neg('Fim das convocações')], sure({ retireNational: true, declineFactor: 0.75 }, 'Você se despediu da seleção.', 'neutral')),
          choice(k, 'keep', 'Seguir à disposição', [fixed('Nada muda')], nothing('Você segue à disposição da seleção.')),
        ],
      }
    },
  },
  {
    key: 'world_cup_dilemma',
    weight: 50,
    origin: 'lenda',
    eligible: (env) => env.age >= 20 && !env.m.nationalRetired && env.ovr >= env.callUpOvr - 1 && env.worldCupAhead(),
    build() {
      const k = 'world_cup_dilemma'
      return {
        title: 'Copa no horizonte',
        description: 'Faltam poucos meses para a Copa do Mundo e um incômodo muscular não passa.',
        options: [
          choice(
            k,
            'sacrifice',
            'Jogar no sacrifício',
            [pos('Sem sequelas', 0.5), neg('−2 OVR (desgaste)', 0.5), neu('Você joga a Copa com tudo')],
            gamble(0.5, { national: 'force', nationalBoost: 1.5 }, { national: 'force', nationalBoost: 1.5, ovr: -2 }, 'Você jogou a Copa com tudo e saiu inteiro.', 'Você jogou a Copa com tudo, mas pagou o preço: −2 OVR.'),
          ),
          choice(k, 'rest', 'Se poupar', [pos('Convocado mesmo assim', 0.6), neg('Cortado da Copa', 0.4)], gamble(0.6, {}, { national: 'skip' }, 'Mesmo poupado, você foi convocado.', 'Você foi cortado da Copa.')),
        ],
      }
    },
  },
  {
    key: 'super_agent',
    weight: 40,
    origin: 'lenda',
    eligible: (env) => env.age >= 21 && env.age <= 31 && env.ovr >= 70 && !env.m.superAgent,
    build() {
      const k = 'super_agent'
      return {
        title: 'Superempresário',
        description: 'Um dos empresários mais poderosos do planeta quer cuidar da sua carreira.',
        options: [
          choice(k, 'sign', 'Assinar com ele', [pos('Propostas maiores daqui em diante'), neg('Fama de mercenário: menos minutos no clube')], sure({ superAgent: true, roleShift: -1, captain: 'lose' }, 'Novo empresário: o mercado vai ferver.', 'neutral')),
          choice(k, 'loyal', 'Manter o empresário de sempre', [pos('Moral com o clube: mais minutos')], sure({ roleShift: 1 }, 'A lealdade foi recompensada com mais minutos.', 'positive')),
        ],
      }
    },
  },
  {
    key: 'coach_conflict',
    weight: 55,
    origin: 'lenda',
    eligible: (env) => env.age >= 20 && isPlayingRole(env.role),
    build(env) {
      const k = 'coach_conflict'
      const opts = [
        choice(k, 'confront', 'Bater de frente', [pos('Ele cede: titular', 0.4), neg('Encostado no elenco', 0.6)], gamble(0.4, { roleOverride: 'starter' }, { roleOverride: 'substitute' }, 'O técnico cedeu: titular.', 'Você foi encostado no elenco.')),
        choice(k, 'adapt', 'Se adaptar', [pos('+1 OVR (versatilidade)'), neg('Menos minutos')], sure({ ovr: 1, roleShift: -1 }, 'Você se adaptou: +1 OVR, menos minutos.', 'neutral')),
      ]
      const exit = exitOption(env, k, 'Pedir para sair e assinar com')
      if (exit) opts.push(exit)
      return { title: 'Técnico novo', description: 'O novo treinador chegou com outras ideias e não parece confiar em você.', options: opts }
    },
  },
  {
    key: 'documentary',
    weight: 35,
    origin: 'lenda',
    eligible: (env) => env.ovr >= 76 && env.age >= 21,
    build() {
      const k = 'documentary'
      return {
        title: 'Série documental',
        description: 'Uma plataforma de streaming quer gravar uma série sobre a sua vida, dentro e fora de campo.',
        options: [
          choice(
            k,
            'accept',
            'Topar as câmeras',
            [pos('Fama sem distração', 0.5), neg('Distração: −2 OVR temporário', 0.5), neu('Valor de mercado +20% no período')],
            gamble(0.5, { valueMult: 1.2 }, { valueMult: 1.2, temp: { delta: -2 } }, 'A série foi um sucesso e você não perdeu o foco.', 'A série bombou, mas tirou seu foco: −2 OVR temporário.'),
          ),
          choice(k, 'decline', 'Recusar', [fixed('Foco total no futebol')], nothing('Você recusou a série.')),
        ],
      }
    },
  },
  {
    key: 'mentor_prospect',
    weight: 45,
    origin: 'lenda',
    eligible: (env) => env.age >= 31 && env.m.declineFactor > 0.5,
    build() {
      const k = 'mentor_prospect'
      return {
        title: 'Padrinho da base',
        description: 'O clube pede que você apadrinhe a maior promessa da base. Ensinar também é aprender.',
        options: [
          choice(k, 'accept', 'Apadrinhar o garoto', [pos('Declínio mais lento pelo resto da carreira'), neg('Menos minutos no período')], sure({ declineFactor: 0.6, roleShift: -1 }, 'Você virou referência para a garotada.', 'positive')),
          choice(k, 'reject', 'Focar em si mesmo', [fixed('Nada muda')], nothing()),
        ],
      }
    },
  },
  {
    key: 'position_retraining',
    weight: 45,
    origin: 'lenda',
    eligible: (env) => env.age >= 31 && !env.isGK && !!RETRAIN[env.position] && !env.m.retrainedFrom,
    build(env) {
      const k = 'position_retraining'
      const to = RETRAIN[env.position]!
      return {
        title: 'Recuar de posição',
        description: `A comissão sugere que você recue para ${POSITION_NAMES[to].toLowerCase()} para prolongar a carreira.`,
        options: [
          choice(k, 'accept', 'Recuar', [pos('Declínio bem mais lento'), neg('−2 OVR agora e menos gols')], sure({ newPosition: to, declineFactor: 0.5, ovr: -2 }, `Nova posição: ${POSITION_NAMES[to]}.`, 'neutral'), { title: POSITION_NAMES[to] }),
          choice(k, 'reject', 'Seguir na posição', [fixed('Nada muda')], nothing()),
        ],
        context: { newPosition: to },
      }
    },
  },
]

export const EVENTS: EventDef[] = [...COPERO, ...LENDA]
export const EVENT_BY_KEY: Record<string, EventDef> = Object.fromEntries(EVENTS.map((e) => [e.key, e]))

// ───────────────────────── lesão ─────────────────────────

/** Lesão grave (cruzado, fratura, Aquiles…): OVR −4 ou pior. */
export function isSevereInjury(inj: InjuryDef): boolean {
  return inj.ovr <= -4
}

/**
 * A lesão tira UMA temporada, não o período inteiro (no ritmo Expressa eram 3 anos de banco):
 * a grave (7–10 meses parado) deixa o jogador como reserva nessa temporada; a moderada (coxa,
 * menisco, panturrilha, tornozelo: semanas) custa um degrau no papel.
 */
export function buildInjury(r: Rng): BuiltEvent & { injuryId: string } {
  const inj = r.weighted(INJURIES, (i) => i.weight)
  const severe = isSevereInjury(inj)
  const injury = { id: inj.id, name: inj.name, ovrDelta: inj.ovr }
  return {
    injuryId: inj.id,
    title: inj.name,
    description: severe
      ? 'A recuperação vai ser longa: você perde boa parte da temporada.'
      : 'Algumas semanas fora: você perde espaço no time nesta temporada.',
    options: [
      choice('injury', 'continue', 'Iniciar a recuperação', [neg(`${inj.ovr} OVR`.replace('-', '−')), neg(severe ? 'Reserva nesta temporada' : 'Menos jogos nesta temporada')], sure(
        severe ? { ovr: inj.ovr, roleOverride: 'substitute', roleSeasons: 1, injury } : { ovr: inj.ovr, roleShift: -1, roleShiftSeasons: 1, injury },
        `${inj.name}: ${inj.ovr} OVR.`.replace('-', '−'),
        'negative',
      )),
    ],
  }
}
