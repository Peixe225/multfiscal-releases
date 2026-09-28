/**
 * LENDA — fronteiras entre módulos do motor.
 *
 *   data (src/data)        → GameData (estático, gerado)
 *   world (src/engine/world) → simula o MUNDO: ligas, copas, continentais, seleções, prêmios.
 *   career (src/engine/career) → simula o JOGADOR no modo Clássico, consumindo o mundo.
 *   immersive (src/engine/immersive) → (fase 2) partida a partida, reutiliza world/*.
 *
 * Regras:
 *   - Tudo é determinístico a partir de `seed` (nada de Math.random no motor).
 *   - Funções puras: recebem estado, devolvem estado novo (sem mutação de entradas).
 *   - O mundo não conhece a carreira: recebe apenas um `UserSeasonContext` por temporada.
 */
import type {
  AwardResult,
  CompetitionKind,
  GameData,
  KnockoutStage,
  Position,
  SeasonWorldResult,
  SquadRole,
  StandingRow,
  WorldState,
} from './types'

// ───────────────────────── dados de competições em andamento (snapshot real) ─────────────────────────

/** Estado REAL de uma competição em andamento hoje (ex.: Libertadores 2026 nas semifinais). */
export interface CupInProgress {
  competitionId: string
  season: number
  /** Fase atual em pt-BR ("Semifinal", "Fase de liga"…). */
  stage: string
  /** Clubes ainda vivos (ids). */
  alive: string[]
  /** Confrontos já definidos da fase atual (ida/volta ou jogo único). */
  pairs?: { a: string; b: string; legs?: { home: string; away: string; score?: [number, number] }[] }[]
  /** Fase de liga/grupos em andamento (Champions 2026/27 com 36 clubes, etc.). */
  table?: StandingRow[]
  /** Fases já concluídas, para exibir o chaveamento real. */
  completed?: KnockoutStage[]
}

// ───────────────────────── contexto do jogador para uma temporada ─────────────────────────

export interface UserSeasonContext {
  /** Clube do jogador na temporada (null = sem clube). */
  clubId: string | null
  /** Seleção do jogador se convocado nesta temporada (código FIFA). */
  nationalTeam: string | null
  /** Quanto o jogador soma à força do clube (0–4 típicos; craque absoluto ~4–6). */
  clubStrengthBoost: number
  nationalStrengthBoost: number
  /** Prioridade escolhida no evento club_priority. */
  priority?: 'league' | 'continental'
  /** Forçar/impedir título (eventos: pênalti decisivo, lesão no auge). chance = prob. de forçar a vitória; negativa = prob. de impedir. */
  forceTrophy?: { kind: CompetitionKind; chance: number }
  /** Suspenso: não conta para o elenco do clube. */
  suspended?: boolean
  // ── aditivos (Modo Imersivo) ──
  /**
   * Resultados fixos por chave de partida (ver `UserFixture.key`). O jogo é simulado normalmente
   * (mesmo consumo do rng, então o resto do mundo não muda) e o placar é trocado pelo fixo.
   * Mata-mata: pênaltis/prorrogação vêm do resultado fixo.
   */
  fixedResults?: Record<string, FixedResult>
  /** Coletar a agenda do clube/seleção do jogador em `SeasonWorldResult.userFixtures` etc. */
  collectUserFixtures?: boolean
  /**
   * Com `collectUserFixtures`: pré-simulação rápida só para a agenda. Simula apenas a liga do jogador
   * (e as divisões ligadas), as copas nacionais/estadual dele, continentais, Mundial/Intercontinental
   * e torneios de seleções — cada competição tem seu próprio sub-stream de rng, então a agenda sai
   * idêntica à da simulação completa. Pula entressafra, estatísticas e evolução: o `world` devolvido
   * é o de entrada e o `result` só traz as competições simuladas (não consolidar).
   */
  agendaOnly?: boolean
  /**
   * (Modo Imersivo) Regras de calendário do modo imersivo: mando alternado nos pontos corridos
   * (método do círculo balanceado), Clausura espelhando o Apertura e um sub-stream de rng por
   * torneio (Apertura/Clausura independentes). Ausente = Clássico, byte a byte igual.
   */
  immersiveRules?: boolean
}

/**
 * (aditivo, Modo Imersivo) Placar fixo de uma partida: `[mandante, visitante]`,
 * `[mandante, visitante, pênaltisMandante, pênaltisVisitante]` ou objeto com prorrogação.
 */
export type FixedResult =
  | [number, number]
  | [number, number, number, number]
  | { score: [number, number]; pens?: [number, number]; aet?: boolean }

// ───────────────────────── motor do mundo ─────────────────────────

export interface WorldEngine {
  /** Cria o mundo a partir dos dados reais de hoje (temporada 2026 em andamento). */
  createWorld(data: GameData, seed: string): WorldState

  /**
   * Simula a temporada `world.nextSeason` inteira: termina as ligas a partir da tabela real
   * (na 1ª temporada) ou do zero, aplica acesso/rebaixamento, disputa copas nacionais,
   * continentais, Mundial de Clubes (anos de edição) e torneios de seleções que terminam
   * nesta temporada. NÃO calcula prêmios individuais (ver computeAwards).
   */
  simulateSeason(data: GameData, world: WorldState, ctx: UserSeasonContext): { world: WorldState; result: SeasonWorldResult }

  /**
   * Prêmios individuais da temporada (Bola de Ouro, Chuteira de Ouro, artilheiros…), já com o
   * jogador do usuário concorrendo. Chamado DEPOIS que a carreira gerou as estatísticas dele.
   */
  computeAwards(data: GameData, world: WorldState, season: number, user: UserAwardEntry | null): { world: WorldState; awards: AwardResult[] }

  /** Resumo do que um clube viveu na temporada (para a linha da tabela de carreira). */
  clubSeason(result: SeasonWorldResult, data: GameData, clubId: string): ClubSeasonSummary

  /** Resumo de uma seleção na temporada (torneio, fase alcançada). */
  nationSeason(result: SeasonWorldResult, countryCode: string): NationSeasonSummary
}

export interface UserAwardEntry {
  name: string
  nationality: string
  position: Position
  clubId: string | null
  leagueId: string | null
  ovr: number
  age: number
  role: SquadRole
  apps: number
  goals: number
  assists: number
  cleanSheets?: number
  /** Títulos coletivos da temporada (ids de competição) — pesam na Bola de Ouro. */
  titles: string[]
  /** Seleção: fase alcançada em torneio desta temporada e gols nele. */
  nationalTournament?: { competitionId: string; reached: string; goals: number }
  /** (aditivo, Modo Imersivo) Gols na liga de fato (senão: estimativa gols × fatia da liga). */
  leagueGoals?: number
}

export interface ClubSeasonSummary {
  clubId: string
  leagueId: string
  tier: 1 | 2 | 3
  position: number
  points: number
  leagueChampion: boolean
  promoted: boolean
  relegated: boolean
  /** Jogos oficiais que o clube disputou (liga + copas + continental), base para "Jogos" do jogador. */
  matches: number
  goalsFor: number
  goalsAgainst: number
  cleanSheets: number
  /** Competições vencidas: competitionId + trophyId. */
  titles: { competitionId: string; trophyId: string; kind: CompetitionKind }[]
  /** Até onde chegou em cada copa: competitionId → fase ("Campeão", "Final", "Semifinal"…). */
  reached: Record<string, string>
}

export interface NationSeasonSummary {
  countryCode: string
  matches: number
  goalsFor: number
  tournament?: { competitionId: string; reached: string; champion: boolean; trophyId: string }
}

// ───────────────────────── motor da carreira (modo Clássico) ↔ UI ─────────────────────────

import type {
  AwardWin,
  CareerLogEntry,
  CareerState,
  CareerSummary,
  EffectChip,
  Pace,
  PlayerIdentity,
  SeasonRecord,
  TrophyWin,
} from './types'

/**
 * Roteiro da revelação animada após uma decisão (a UI anima nesta ordem):
 * roleta do efeito sorteado → linha(s) da tabela → números (count-up) → troféus → OVR → celebração.
 */
export interface RevealScript {
  /** Opção escolhida e, se havia sorteio, qual efeito saiu (índice em option.effects). */
  optionId: string
  rolledEffect?: number
  /** Minijogo de pênalti: resultado para a animação. */
  penalty?: { scored: boolean; side: 'left' | 'center' | 'right'; keeperSide: 'left' | 'center' | 'right' }
  /** Temporadas simuladas neste período (1, 2 ou 3), em ordem. */
  seasons: SeasonRecord[]
  /** Títulos conquistados no período (clube + seleção), para a celebração. */
  trophies: TrophyWin[]
  awards: AwardWin[]
  relegated: boolean
  promoted: boolean
  ovrBefore: number
  ovrAfter: number
  valueBefore: number
  valueAfter: number
  log: CareerLogEntry[]
  /** Conquistas desbloqueadas neste passo (ids). */
  achievements: string[]
  /** true se a carreira terminou neste passo. */
  finished: boolean
}

export interface CareerEngine {
  /** Cria a carreira: mundo inicial (dados reais de hoje) + decisão de "Oferta de base". */
  newCareer(data: GameData, identity: PlayerIdentity, pace: Pace, seed: string): CareerState
  /** Aplica a opção escolhida na decisão pendente, simula o período e prepara a próxima decisão. */
  choose(data: GameData, state: CareerState, optionId: string): { state: CareerState; reveal: RevealScript }
  /** Resumo final (também serve para carreira em andamento). */
  summarize(data: GameData, state: CareerState): CareerSummary
  /** Efeitos exibidos para uma opção (pílulas), já com probabilidades. */
  describeOption?(data: GameData, state: CareerState, optionId: string): EffectChip[]
}
