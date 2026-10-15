/** Hall das Lendas por nacionalidade e por clube, e o ranking geral com as carreiras da comunidade. */
import { describe, expect, it } from 'vitest'
import { REAL_LEGENDS, evaluateHall, type RunInput } from '@/engine/legacy'
import type { AwardWin, PlayerIdentity, SeasonRecord, TrophyWin } from '@/engine/types'
import type { CarreiraComunidade } from '@/store/comunidade'
import { buscarClubes, clubesDaRun, comunidadeNoFiltro, filtrarHall, filtrarLinhas, filtroAtivo, horaBr, lendaNoFiltro, misturarRanking, normalizarBusca, runNoFiltro } from './filtros'

const ID = (nationality: string): PlayerIdentity => ({ surname: 'ROCHA', number: 9, foot: 'right', nationality, position: 'CA' })
function rec(age: number, clubId: string, o: { t?: Partial<TrophyWin>[]; a?: Partial<AwardWin>[]; goals?: number } = {}): SeasonRecord {
  const season = 2026 + age - 16
  return {
    season,
    age,
    clubId,
    leagueId: 'bra.1',
    tier: 1,
    loan: false,
    period: 1,
    role: 'starter',
    ovrStart: 80,
    ovrEnd: 81,
    marketValue: 1e7,
    stats: { apps: 40, goals: o.goals ?? 20, assists: 8, rating: 7 },
    country: 'BRA',
    confed: 'CONMEBOL',
    nationality: 'BRA',
    trophies: (o.t ?? []).map((x) => ({ trophyId: 'x', competitionId: 'x', season, teamId: clubId, scope: 'club', ...x }) as TrophyWin),
    awards: (o.a ?? []).map((x) => ({ award: 'ballon_dor', year: season + 1, place: 1, ...x }) as AwardWin),
  }
}
/** Carreira de um boliviano que passou pelo Cruzeiro (e2022). */
function boliviano(id = 'run-bol'): RunInput {
  const seasons = [17, 18, 19, 20, 21, 22].map((a) => rec(a, a < 19 ? 'e9999' : 'e2022'))
  return { id, runNo: 1, identity: ID('BOL'), seasons, finishedAt: '2026-10-14T10:00:00Z' }
}
function brasileiro(id = 'run-bra'): RunInput {
  return { id, runNo: 2, identity: ID('BRA'), seasons: [18, 19, 20].map((a) => rec(a, 'e819')), finishedAt: '2026-10-14T11:00:00Z' }
}

function com(o: Partial<CarreiraComunidade> & { id: string; nota: number }): CarreiraComunidade {
  return { posicao: 1, apelido: 'Foguete', jogador: 'BATISTA', numero: 10, pais: 'BOL', posicaoCampo: 'MEI', picoOvr: 90, temporadas: 20, gols: 300, titulos: 20, bolasOuro: 0, copas: 0, headline: '', clubes: ['e2022'], bonusOvr: 0, terminouEm: null, destaque: false, ...o }
}

describe('filtros do Hall: país e clube', () => {
  it('lendas reais: por seleção (nationality) e por clube (clubs[].clubId)', () => {
    const brasileiros = REAL_LEGENDS.filter((l) => lendaNoFiltro(l, { pais: 'BRA' }))
    expect(brasileiros.length).toBeGreaterThan(5)
    expect(brasileiros.every((l) => l.nationality === 'BRA')).toBe(true)
    expect(brasileiros.some((l) => l.name === 'Pelé')).toBe(true)
    // nenhuma das 50 é da Bolívia
    expect(REAL_LEGENDS.filter((l) => lendaNoFiltro(l, { pais: 'BOL' }))).toHaveLength(0)
    const comClube = REAL_LEGENDS.find((l) => l.clubs.some((c) => c.clubId))!
    const clube = comClube.clubs.find((c) => c.clubId)!.clubId!
    const doClube = REAL_LEGENDS.filter((l) => lendaNoFiltro(l, { clube }))
    expect(doClube).toContain(comClube)
    expect(doClube.every((l) => l.clubs.some((c) => c.clubId === clube))).toBe(true)
    // país E clube juntos
    expect(REAL_LEGENDS.filter((l) => lendaNoFiltro(l, { pais: comClube.nationality, clube }))).toContain(comClube)
    expect(lendaNoFiltro(comClube, {})).toBe(true)
    expect(filtroAtivo({})).toBe(false)
    expect(filtroAtivo({ clube: 'e2022' })).toBe(true)
  })

  it('carreiras do aparelho: nacionalidade da identidade e todos os clubes defendidos', () => {
    const hall = evaluateHall([boliviano(), brasileiro()])
    const bol = hall.runs.find((r) => r.id === 'run-bol')!
    expect([...clubesDaRun(bol)].sort()).toEqual(['e2022', 'e9999'])
    expect(runNoFiltro(bol, { pais: 'BOL' })).toBe(true)
    expect(runNoFiltro(bol, { clube: 'e9999' })).toBe(true)
    expect(runNoFiltro(bol, { pais: 'BOL', clube: 'e2022' })).toBe(true)
    expect(runNoFiltro(bol, { pais: 'BRA' })).toBe(false)
    expect(runNoFiltro(bol, { clube: 'e819' })).toBe(false)
  })

  it('Hall filtrado: rankings só com quem passa, posições refeitas a partir de 1, sem desempate citando quem saiu', () => {
    const hall = evaluateHall([boliviano(), brasileiro()])
    const f = filtrarHall(hall, { pais: 'BOL', clube: 'e2022' })
    expect(f.legends).toHaveLength(0)
    expect(f.topLegend).toBeNull()
    expect(f.runs.map((r) => r.id)).toEqual(['run-bol'])
    expect(f.overall.map((r) => [r.rank, r.entry.id])).toEqual([[1, 'run-bol']])
    expect(f.bestRun?.id).toBe('run-bol')
    for (const rows of Object.values(f.categories)) expect(rows.every((r) => r.entry.id === 'run-bol')).toBe(true)
    // Brasil: lendas brasileiras + a carreira do brasileiro; posições 1..n (dividida só quando já era)
    const br = filtrarHall(hall, { pais: 'BRA' })
    expect(br.overall.length).toBe(br.legends.length + 1)
    br.overall.forEach((r, i) => expect(r.rank === i + 1 || r.rank === br.overall[i - 1]?.rank).toBe(true))
    for (const r of br.overall) if (r.tieBreak) expect(br.overall[br.overall.indexOf(r) + 1]).toBeDefined()
    // sem filtro: o Hall de sempre
    expect(filtrarHall(hall, {}).overall).toBe(hall.overall)
  })

  it('filtrarLinhas: quem dividia a posição continua dividindo', () => {
    const hall = evaluateHall([])
    const rows = hall.overall.slice(0, 6).map((r, i) => ({ ...r, rank: i < 2 ? 1 : i + 1 }))
    const out = filtrarLinhas(rows, () => true)
    expect(out[0].rank).toBe(1)
    expect(out[1].rank).toBe(1)
    expect(out[2].rank).toBe(3)
  })

  it('comunidade: o servidor já filtra, e o cliente confere de novo (país e clube)', () => {
    const c = com({ id: 'x', nota: 50 })
    expect(comunidadeNoFiltro(c, { pais: 'BOL', clube: 'e2022' })).toBe(true)
    expect(comunidadeNoFiltro(c, { pais: 'BRA' })).toBe(false)
    expect(comunidadeNoFiltro(c, { clube: 'e819' })).toBe(false)
  })
})

describe('ranking geral com a comunidade', () => {
  it('entra pela nota, sem mexer na ordem do motor, e uma carreira deste aparelho não aparece duas vezes', () => {
    const hall = evaluateHall([boliviano(), brasileiro()])
    const top = hall.overall[0].entry.score
    const linhas = misturarRanking(
      hall.overall,
      [com({ id: 'c-top', nota: top + 1 }), com({ id: 'c-meio', nota: hall.overall[5].entry.score }), com({ id: 'run-bol', nota: 99 })],
      new Set(['run-bol', 'run-bra']),
    )
    expect(linhas.length).toBe(hall.overall.length + 2)
    expect(linhas[0]).toMatchObject({ kind: 'comunidade', rank: 1 })
    expect(linhas[0].kind === 'comunidade' && linhas[0].c.id).toBe('c-top')
    // a ordem do motor entre as linhas dele continua a mesma
    const doMotor = linhas.filter((l) => l.kind === 'rank').map((l) => (l.kind === 'rank' ? l.row.entry.id : ''))
    expect(doMotor).toEqual(hall.overall.map((r) => r.entry.id))
    // a carreira daqui que também está no Hall público entra uma vez só (como a daqui)
    expect(linhas.filter((l) => (l.kind === 'comunidade' ? l.c.id : l.row.entry.id) === 'run-bol')).toHaveLength(1)
    // nota igual: a do motor fica na frente
    const meio = linhas.findIndex((l) => l.kind === 'comunidade' && l.c.id === 'c-meio')
    const ant = linhas[meio - 1]
    expect(ant.kind === 'rank' && ant.row.entry.score).toBeGreaterThanOrEqual(hall.overall[5].entry.score)
    // posições crescem (ou empatam)
    linhas.forEach((l, i) => i && expect(l.rank).toBeGreaterThanOrEqual(linhas[i - 1].rank))
  })

  it('empate total entre duas da comunidade: posição dividida; sem comunidade, as posições do motor', () => {
    const hall = evaluateHall([])
    const nota = hall.overall.at(-1)!.entry.score - 1
    const l = misturarRanking(hall.overall, [com({ id: 'a', nota }), com({ id: 'b', nota })])
    expect(l.at(-1)!.rank).toBe(l.at(-2)!.rank)
    expect(misturarRanking(hall.overall, []).map((x) => x.rank)).toEqual(hall.overall.map((r) => r.rank))
  })
})

describe('busca de clube', () => {
  const clubes = [
    { id: 'e2022', name: 'Cruzeiro', shortName: 'Cruzeiro', country: 'BRA' },
    { id: 'e3454', name: 'Cruz Azul', shortName: 'Cruz Azul', country: 'MEX' },
    { id: 'e2029', name: 'Palmeiras', shortName: 'Palmeiras', country: 'BRA' },
    { id: 'e819', name: 'Flamengo', shortName: 'Flamengo', country: 'BRA' },
    { id: 'e2026', name: 'São Paulo', shortName: 'São Paulo', country: 'BRA' },
    { id: 'e86', name: 'Real Madrid', shortName: 'Real Madrid', country: 'ESP' },
    { id: 'e244', name: 'Real Betis', shortName: 'Betis', country: 'ESP' },
  ]
  it('sem acento, começa com primeiro, e os clubes das lendas na frente no empate', () => {
    expect(normalizarBusca('  São-Paulo! ')).toBe('sao paulo')
    expect(buscarClubes(clubes, 'sao').map((c) => c.id)).toEqual(['e2026'])
    expect(buscarClubes(clubes, 'cruz').map((c) => c.id)).toEqual(['e3454', 'e2022'])
    expect(buscarClubes(clubes, 'cruzeiro')[0].id).toBe('e2022')
    expect(buscarClubes(clubes, 'real', 8, new Set(['e86'])).map((c) => c.id)).toEqual(['e86', 'e244'])
    expect(buscarClubes(clubes, 'madrid').map((c) => c.id)).toEqual(['e86'])
    expect(buscarClubes(clubes, '')).toEqual([])
    expect(buscarClubes(clubes, 'zzz')).toEqual([])
    expect(buscarClubes(clubes, 'a', 2)).toHaveLength(2)
  })
  it('hora de Brasília para "Atualizado às HH:MM"', () => {
    expect(horaBr('2026-10-14T17:05:00Z')).toBe('14:05')
    expect(horaBr(null)).toBeNull()
    expect(horaBr('lixo')).toBeNull()
  })
})
