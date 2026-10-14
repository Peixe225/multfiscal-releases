/**
 * Números ao vivo de Messi e Cristiano Ronaldo no Hall das Lendas.
 *
 * SÓ no build do site (VITE_SITE=1, oprojeto.online/lenda): o Hall busca `api/lendas.php` (no site,
 * /lenda/api/lendas.php — servidor/api/lendas.php guarda por 6 h o arquivo de dados do MessivsRonaldo.app)
 * e sobrepõe os números fixos de src/data/catalog/legends.ts. No build do claude.ai (VITE_ARTIFACT) e no
 * local não há chamada nenhuma: valem os números fixos. Sem resposta, idem.
 *
 *   jogos, gols, assistências ... a linha "All Time Career" do site (a mesma régua dos números fixos);
 *                                 nunca DIMINUEM (site atrasado em relação à conferência não volta o Hall)
 *   títulos e prêmios ........... por INCREMENTO: o que a tabela de honras do site ganhou desde a foto de
 *                                 14/10/2026 (LIVE_BASELINE, linha a linha) entra por cima dos números
 *                                 conferidos; os anos de um item novo saem só das linhas que cresceram. Assim
 *                                 a regra de contagem do Hall não muda (o site conta, por exemplo, a
 *                                 Supercopa 2005 do Messi e o Community Shield 2008 do Cristiano, em que
 *                                 eles não jogaram — 49 e 37 títulos contra 46 e 35 aqui).
 *
 * Mapa da tabela de honras (allSheetHonours, nomes originais em inglês) → Hall:
 *   "Ballon d'Or" → Bolas de Ouro · "FIFA World Player of the Year" (só as edições "FIFA Best"/"World
 *   Player"; as "FIFA Ballon d'Or" já estão na Bola de Ouro) → The Best · "European Golden Shoe" →
 *   Chuteiras · "Champions League" · "World Cup" · "Copa America / Euros" e "Club World Cup" → outros
 *   títulos grandes · "League Titles" → títulos nacionais · linhas coletivas → títulos (cada título novo
 *   é classificado pelo próprio texto: "MLS Cup", que o site põe em "Domestic Cup", é título nacional, e
 *   "Supporters' Shield", que o site põe em "League Titles", fica em outros — a regra de legends.ts) · "<liga> Top
 *   Scorer"/"Pichichi" → artilharias · "FIFA World Cup Golden Ball/Boot" · melhores jogadores de liga
 *   (La Liga, Premier League, Serie A AIC, MLS MVP, Saudi Pro League) → craque da liga · "FIFA Puskas
 *   Award" → Puskás · "Golden Boy" → melhor jovem.
 */
import { legendTotalTitles, type Legend, type LegendAward, type LegendAwardKey, type LegendHonour, type HonourKind } from './catalog/legends'

export const LIVE_LEGEND_IDS = ['messi', 'cristiano-ronaldo'] as const
export type LiveLegendId = (typeof LIVE_LEGEND_IDS)[number]

export interface LiveHonourRow {
  nome: string
  n: number
  anos: string
}

/** Uma lenda na resposta de lendas.php (contrato em servidor/CONTRATO.md). */
export interface LiveLegendRow {
  jogos: number
  gols: number
  assistencias: number
  golsSelecao?: number
  jogosSelecao?: number
  golsChampions?: number
  golsCopa?: number
  titulos: number
  bolasOuro: number
  premios: LiveHonourRow[]
}

export interface LiveLegendsPayload {
  fonte: string
  url: string
  buscadoEm: string
  desatualizado?: boolean
  lendas: Record<LiveLegendId, LiveLegendRow>
}

/** O que o Hall mostra sobre a atualização ("Atualizado em 14/10/2026 · fonte: MessivsRonaldo.app"). */
export interface LiveInfo {
  source: string
  url: string
  /** ISO (UTC) da última busca bem-sucedida no servidor. */
  fetchedAt: string
  /** O servidor não conseguiu buscar de novo e mandou o último cache. */
  stale: boolean
  /** O que mudou em relação aos números fixos, por lenda ("+3 gols", "+1 Bola de Ouro"). */
  changes: Record<LiveLegendId, string[]>
  /** A tabela de honras inteira do site, por lenda (nome original, número e anos). */
  honours: Record<LiveLegendId, LiveHonourRow[]>
}

/** Busca feita no site? (build do site e fora do claude.ai) */
export const LIVE_LEGENDS_ENABLED = import.meta.env.VITE_SITE === '1' && import.meta.env.VITE_ARTIFACT !== '1'

/** Contagens do Hall tiradas da tabela de honras do site. */
export interface LiveCounts {
  ballonDor: number
  theBest: number
  goldenBoots: number
  ucl: number
  worldCups: number
  natCont: number
  clubWorldCups: number
  leagueTitles: number
  titles: number
  leagueTopScorer: number
  wcGoldenBall: number
  wcGoldenBoot: number
  leagueBestPlayer: number
  puskas: number
  kopa: number
}

/** Linhas coletivas (a soma é o "Total Trophies" do site) e o grupo do título na ficha. */
const COLLECTIVE: Record<string, HonourKind> = {
  'League Titles': 'league',
  'Domestic Cup': 'cup',
  'Domestic Super Cup': 'supercup',
  'UEFA Super Cup': 'supercup',
  'Club World Cup': 'world',
  'Champions League': 'continental',
  'Other Official Club Titles': 'other',
  'Full Senior International': 'national',
  'Other Official International': 'national',
}
const LEAGUE_BEST = new Set(['La Liga Best Player (08-16)', 'MLS MVP Award', 'Premier League Player of the Season', 'Serie A Footballer of the Year (AIC)'])
const LEAGUE_TOP_SCORER = /^(La Liga|Premier League|Serie A|Saudi Pro League|MLS|Ligue 1|Bundesliga|Eredivisie|Primeira Liga)\b.*(Top Scorer|Pichichi)/i
/** Linhas de prêmio de melhor jogador de LIGA (a mesma régua de `league_best_player` em legends.ts). */
const isLeagueBest = (name: string) => LEAGUE_BEST.has(name) || /^Saudi Pro League .*Player of the (Season|Year)/i.test(name)
const isLeagueTopScorer = (name: string) => LEAGUE_TOP_SCORER.test(name)
/** Itens da linha "FIFA World Player of the Year" que são The Best/World Player (os "FIFA Ballon d'Or" 2010–15 são Bola de Ouro). */
const isTheBestItem = (item: string) => !/ballon d'or/i.test(item)

/** "2023 FIFA Best, 2015 FIFA Ballon d'Or, …" → itens. */
const items = (anos: string) =>
  (anos ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export function liveCounts(row: LiveLegendRow): LiveCounts {
  const by = new Map(row.premios.map((p) => [p.nome.trim(), p]))
  const n = (name: string) => by.get(name)?.n ?? 0
  const sum = (test: (name: string) => boolean) => row.premios.filter((p) => test(p.nome.trim())).reduce((s, p) => s + p.n, 0)
  const fifa = by.get('FIFA World Player of the Year')
  return {
    ballonDor: n("Ballon d'Or") || row.bolasOuro,
    // as edições "FIFA Ballon d'Or" (2010–15) são a própria Bola de Ouro
    theBest: fifa ? (fifa.anos ? items(fifa.anos).filter(isTheBestItem).length : fifa.n) : 0,
    goldenBoots: n('European Golden Shoe'),
    ucl: n('Champions League'),
    worldCups: n('World Cup'),
    natCont: n('Copa America / Euros'),
    clubWorldCups: n('Club World Cup'),
    leagueTitles: n('League Titles'),
    titles: sum((x) => x in COLLECTIVE),
    leagueTopScorer: sum(isLeagueTopScorer),
    wcGoldenBall: n('FIFA World Cup Golden Ball'),
    wcGoldenBoot: n('FIFA World Cup Golden Boot'),
    leagueBestPlayer: sum(isLeagueBest),
    puskas: n('FIFA Puskas Award'),
    kopa: n('Golden Boy (UEFA Young Player of the Year)'),
  }
}

/**
 * A tabela do site no dia da conferência (14/10/2026), já mapeada: a base dos incrementos. Os números
 * fixos de legends.ts correspondem a esta foto (o teste confere com a cópia em
 * src/engine/legacy/__tests__/fixtures/lendas-php-2026-10-14.json). `rows` = contagem de cada linha de
 * prêmio do Hall (as que faltam valem 0): os anos de um prêmio novo saem só das linhas que cresceram.
 */
export const LIVE_BASELINE: Record<LiveLegendId, { apps: number; goals: number; assists: number; counts: LiveCounts; collective: Record<string, number>; rows: Record<string, number> }> = {
  messi: {
    apps: 1179,
    goals: 934,
    assists: 426,
    counts: { ballonDor: 8, theBest: 4, goldenBoots: 6, ucl: 4, worldCups: 1, natCont: 2, clubWorldCups: 3, leagueTitles: 13, titles: 49, leagueTopScorer: 9, wcGoldenBall: 2, wcGoldenBoot: 0, leagueBestPlayer: 8, puskas: 0, kopa: 1 },
    collective: { 'League Titles': 13, 'Domestic Cup': 8, 'Domestic Super Cup': 10, 'UEFA Super Cup': 3, 'Club World Cup': 3, 'Champions League': 4, 'Other Official Club Titles': 2, 'Full Senior International': 4, 'Other Official International': 2 },
    rows: { "Ballon d'Or": 8, 'FIFA World Player of the Year': 8, 'European Golden Shoe': 6, 'FIFA World Cup Golden Ball': 2, 'La Liga Top Scorer (Pichichi)': 8, 'MLS Top Scorer': 1, 'Golden Boy (UEFA Young Player of the Year)': 1, 'La Liga Best Player (08-16)': 6, 'MLS MVP Award': 2 },
  },
  'cristiano-ronaldo': {
    apps: 1340,
    goals: 981,
    assists: 261,
    counts: { ballonDor: 5, theBest: 3, goldenBoots: 4, ucl: 5, worldCups: 0, natCont: 1, clubWorldCups: 4, leagueTitles: 8, titles: 37, leagueTopScorer: 7, wcGoldenBall: 0, wcGoldenBoot: 0, leagueBestPlayer: 5, puskas: 1, kopa: 0 },
    collective: { 'League Titles': 8, 'Domestic Cup': 6, 'Domestic Super Cup': 7, 'UEFA Super Cup': 3, 'Club World Cup': 4, 'Champions League': 5, 'Other Official Club Titles': 1, 'Full Senior International': 3, 'Other Official International': 0 },
    rows: { "Ballon d'Or": 5, 'FIFA World Player of the Year': 5, 'European Golden Shoe': 4, 'La Liga Top Scorer (Pichichi)': 3, 'Premier League Top Scorer': 1, 'Serie A Top Scorer': 1, 'Saudi Pro League Top Scorer': 2, 'La Liga Best Player (08-16)': 1, 'Serie A Footballer of the Year (AIC)': 2, 'Premier League Player of the Season': 2, 'FIFA Puskas Award': 1 },
  },
}

/**
 * Prêmio do Hall que cada contagem alimenta (incremento vira um item novo na lista de prêmios). `row` é o
 * MESMO teste de linha que liveCounts usa; `item` filtra os itens da linha (só The Best).
 */
const AWARD_OF: Partial<Record<keyof LiveCounts, { key: LegendAwardKey; row: (name: string) => boolean; item?: (item: string) => boolean; label: string }>> = {
  ballonDor: { key: 'ballon_dor', row: (x) => x === "Ballon d'Or", label: 'Bola de Ouro' },
  theBest: { key: 'the_best', row: (x) => x === 'FIFA World Player of the Year', item: isTheBestItem, label: 'The Best FIFA' },
  goldenBoots: { key: 'golden_boot', row: (x) => x === 'European Golden Shoe', label: 'Chuteira de Ouro europeia' },
  leagueTopScorer: { key: 'league_top_scorer', row: isLeagueTopScorer, label: 'Artilheiro de liga' },
  wcGoldenBall: { key: 'wc_golden_ball', row: (x) => x === 'FIFA World Cup Golden Ball', label: 'Bola de Ouro da Copa do Mundo' },
  wcGoldenBoot: { key: 'wc_golden_boot', row: (x) => x === 'FIFA World Cup Golden Boot', label: 'Chuteira de Ouro da Copa do Mundo' },
  leagueBestPlayer: { key: 'league_best_player', row: isLeagueBest, label: 'Melhor jogador de liga' },
  puskas: { key: 'puskas', row: (x) => x === 'FIFA Puskas Award', label: 'Prêmio Puskás' },
  kopa: { key: 'kopa', row: (x) => x === 'Golden Boy (UEFA Young Player of the Year)', label: 'Golden Boy' },
}

/** Linhas da tabela que alimentam algum prêmio do Hall (a base guarda a contagem de cada uma). */
export const isAwardRow = (name: string) => Object.values(AWARD_OF).some((m) => m!.row(name.trim()))

/**
 * Grupo de um título NOVO, pelo texto do próprio item (o site agrupa diferente da regra do Hall):
 * a MLS Cup é o título nacional da MLS (o site a põe em "Domestic Cup") e o Supporters' Shield fica
 * só no total (o site o põe em "League Titles"). Os demais seguem a linha.
 */
export function liveTitleKind(item: string, rowKind: HonourKind): HonourKind {
  if (/supporters'?\s*shield/i.test(item)) return 'other'
  if (/\bMLS Cup\b/i.test(item)) return 'league'
  return rowKind
}

const plural = (n: number, one: string, many: string) => `+${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`
const ddmmyyyy = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/** "Atualizado em 14/10/2026" (data da busca no fuso de Brasília). */
export const liveUpdatedLabel = (info: LiveInfo) => `Atualizado em ${ddmmyyyy(info.fetchedAt)}`

const isPremio = (x: unknown): x is LiveHonourRow => {
  const p = x as LiveHonourRow
  return !!p && typeof p === 'object' && typeof p.nome === 'string' && Number.isFinite(p.n) && p.n >= 0 && (p.anos == null || typeof p.anos === 'string')
}

function isRow(x: unknown): x is LiveLegendRow {
  const r = x as LiveLegendRow
  return !!r && typeof r === 'object' && [r.jogos, r.gols, r.assistencias, r.titulos].every((v) => Number.isFinite(v)) && Array.isArray(r.premios) && r.premios.every(isPremio)
}

/** Resposta de lendas.php no formato do contrato (cada item de `premios` com nome texto, n número e anos texto). */
export function isLivePayload(x: unknown): x is LiveLegendsPayload {
  const p = x as LiveLegendsPayload
  return !!p && typeof p === 'object' && typeof p.buscadoEm === 'string' && !!p.lendas && LIVE_LEGEND_IDS.every((id) => isRow(p.lendas[id]))
}

/**
 * Sobrepõe os números do site às lendas (puro). Devolve uma NOVA lista (as outras 48 lendas são os
 * mesmos objetos) e o resumo do que mudou.
 */
export function applyLiveLegends(legends: Legend[], payload: LiveLegendsPayload): { legends: Legend[]; info: LiveInfo } {
  const changes = { messi: [] as string[], 'cristiano-ronaldo': [] as string[] }
  const honours = { messi: [] as LiveHonourRow[], 'cristiano-ronaldo': [] as LiveHonourRow[] }
  const out = legends.map((l) => {
    if (!(LIVE_LEGEND_IDS as readonly string[]).includes(l.id)) return l
    const id = l.id as LiveLegendId
    const row = payload.lendas[id]
    const base = LIVE_BASELINE[id]
    honours[id] = row.premios
    const now = liveCounts(row)
    const d = (k: keyof LiveCounts) => Math.max(0, now[k] - base.counts[k])
    const c = changes[id]
    const next: Legend = { ...l }
    // jogos, gols e assistências: o número do site (nunca menor que o conferido)
    const apps = Math.max(l.apps, Math.round(row.jogos))
    const goals = Math.min(apps, Math.max(l.goals, Math.round(row.gols)))
    const assists = Math.max(l.assists, Math.round(row.assistencias))
    if (apps > l.apps) c.push(plural(apps - l.apps, 'jogo', 'jogos'))
    if (goals > l.goals) c.push(plural(goals - l.goals, 'gol', 'gols'))
    if (assists > l.assists) c.push(plural(assists - l.assists, 'assistência', 'assistências'))
    Object.assign(next, { apps, goals, assists })
    // campos numéricos por incremento
    next.ballonDor = l.ballonDor + d('ballonDor')
    next.goldenBoots = l.goldenBoots + d('goldenBoots')
    next.ucl = l.ucl + d('ucl')
    next.worldCups = l.worldCups + d('worldCups')
    next.otherMajorTitles = l.otherMajorTitles + d('natCont') + d('clubWorldCups')
    // títulos: cada linha coletiva que cresceu vira um item novo na lista (a soma continua fechando)
    const newHonours: LegendHonour[] = []
    for (const [name, rowKind] of Object.entries(COLLECTIVE)) {
      const p = row.premios.find((x) => x.nome.trim() === name)
      const delta = Math.max(0, (p?.n ?? 0) - (base.collective[name] ?? 0))
      if (!delta) continue
      // o site lista do mais novo para o mais antigo: os primeiros itens são os títulos novos ("2026 Campeones Cup").
      // Cada item é classificado pelo próprio texto (MLS Cup → nacional; Supporters' Shield → outros).
      const fresh = items(p?.anos ?? '').slice(0, delta)
      const byKind = new Map<HonourKind, string[]>()
      for (const it of fresh) byKind.set(liveTitleKind(it, rowKind), [...(byKind.get(liveTitleKind(it, rowKind)) ?? []), it])
      for (const [kind, list] of byKind) newHonours.push({ name: list.join(', '), team: 'novo · MessivsRonaldo.app', n: list.length, years: '', kind })
      // a linha cresceu mais do que os anos mostram: o resto fica no grupo da linha, com o nome dela
      if (delta > fresh.length) newHonours.push({ name, team: 'novo · MessivsRonaldo.app', n: delta - fresh.length, years: '', kind: rowKind })
    }
    const dTitles = newHonours.reduce((s, h) => s + h.n, 0)
    const dLeague = newHonours.filter((h) => h.kind === 'league').reduce((s, h) => s + h.n, 0)
    next.totalTitles = legendTotalTitles(l) + dTitles
    next.leagueTitles = l.leagueTitles + dLeague
    if (dTitles) {
      next.honours = [...(l.honours ?? []), ...newHonours]
      c.push(plural(dTitles, 'título', 'títulos'))
    }
    // prêmios: incremento de cada prêmio do Hall vira um item novo na lista
    const newAwards: LegendAward[] = []
    for (const [k, meta] of Object.entries(AWARD_OF) as [keyof LiveCounts, NonNullable<(typeof AWARD_OF)[keyof LiveCounts]>][]) {
      const delta = d(k)
      if (!delta) continue
      // anos: só das linhas cuja contagem subiu desde a foto (os primeiros itens de cada uma são os novos)
      const years = row.premios
        .filter((p) => meta.row(p.nome.trim()))
        .flatMap((p) => {
          const grew = Math.max(0, p.n - (base.rows[p.nome.trim()] ?? 0))
          return grew ? items(p.anos).filter((it) => !meta.item || meta.item(it)).slice(0, grew) : []
        })
        .slice(0, delta)
        .join(', ')
      newAwards.push({ name: `${meta.label} (novo, MessivsRonaldo.app)`, n: delta, years, key: meta.key })
      c.push(`+${delta} ${meta.label}`)
    }
    if (newAwards.length) next.awards = [...(l.awards ?? []), ...newAwards]
    return next
  })
  return {
    legends: out,
    info: { source: payload.fonte || 'MessivsRonaldo.app', url: payload.url || 'https://www.messivsronaldo.app/', fetchedAt: payload.buscadoEm, stale: !!payload.desatualizado, changes, honours },
  }
}

let pending: Promise<LiveLegendsPayload | null> | null = null

/** Busca (uma vez por carregamento da página) a resposta de lendas.php. Sem resposta válida: null. */
export function fetchLiveLegends(): Promise<LiveLegendsPayload | null> {
  if (!LIVE_LEGENDS_ENABLED || typeof fetch === 'undefined') return Promise.resolve(null)
  pending ??= (async () => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const t = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null
    try {
      // relativo à página: no site, /lenda/api/lendas.php
      const url = new URL('api/lendas.php', document.baseURI).href
      const res = await fetch(url, { credentials: 'omit', headers: { Accept: 'application/json' }, signal: ctrl?.signal })
      if (!res.ok) return null
      const body: unknown = await res.json()
      return isLivePayload(body) ? body : null
    } catch {
      return null
    } finally {
      if (t) clearTimeout(t)
    }
  })()
  const p = pending
  // falhou: a próxima abertura do Hall tenta de novo
  void p.then((r) => {
    if (!r && pending === p) pending = null
  })
  return p
}
