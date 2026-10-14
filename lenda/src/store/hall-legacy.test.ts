/**
 * Nota de Legado gravada em cada carreira do Hall (HallEntry.legacy): quando os pesos mudam
 * (LEGACY_VERSION), a nota gravada é recalculada ao ler o Hall e antes do corte de 100 carreiras,
 * para o corte, o Hall e a conta (carreiras.php lê `legacy.score`) usarem o mesmo número.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_VERSION, evaluateRun } from '@/engine/legacy'
import type { AwardWin, PlayerIdentity, SeasonRecord, TrophyWin } from '@/engine/types'
import { capHall, legacyIsCurrent, refreshLegacy, useCareer, type HallEntry } from './career'
import { kv, KV_KEYS } from './persist'

const ID: PlayerIdentity = { surname: 'RIBEIRO', number: 9, foot: 'right', nationality: 'BRA', position: 'CA' }
function rec(age: number, o: Partial<SeasonRecord> & { t?: Partial<TrophyWin>[]; a?: Partial<AwardWin>[] } = {}): SeasonRecord {
  const { t = [], a = [], ...rest } = o
  const season = 2026 + age - 16
  return {
    season,
    age,
    clubId: 'c1',
    leagueId: 'bra.1',
    tier: 1,
    loan: false,
    period: 1,
    role: 'starter',
    ovrStart: 80,
    ovrEnd: 81,
    marketValue: 1e7,
    stats: { apps: 40, goals: 20, assists: 8, rating: 7 },
    country: 'BRA',
    confed: 'CONMEBOL',
    nationality: 'BRA',
    trophies: t.map((x) => ({ trophyId: 'x', competitionId: 'x', season, teamId: 'c1', scope: 'club', ...x }) as TrophyWin),
    awards: a.map((x) => ({ award: 'ballon_dor', year: season + 1, place: 1, ...x }) as AwardWin),
    ...rest,
  }
}
const entry = (id: string, seasons: SeasonRecord[], legacy?: HallEntry['legacy']): HallEntry =>
  ({ id, runNo: 1, finishedAt: '2026-10-01T00:00:00Z', identity: { ...ID, surname: id.toUpperCase() }, pace: 'normal', mode: 'classico', engine: 'real', summary: { legacyScore: 0 }, career: { id, seasons }, legacy }) as unknown as HallEntry

// craque campeão: Copa, Champions e Bolas de Ouro; e um artilheiro de liga fraca com muitas taças menores
const star = Array.from({ length: 14 }, (_, i) => rec(20 + i, { t: [{ kind: 'league', tier: 1 }, ...(i % 4 === 0 ? [{ kind: 'world_cup' as const, scope: 'national' as const }] : []), ...(i < 3 ? [{ kind: 'continental_primary' as const, confed: 'UEFA' as const }] : [])], a: i < 3 ? [{ award: 'ballon_dor' }] : [] }))
const volume = Array.from({ length: 18 }, (_, i) => rec(18 + i, { t: [{ kind: 'domestic_cup', minor: true }, { kind: 'domestic_cup', minor: true }], a: [{ award: 'league_top_scorer' }] }))

afterEach(() => vi.unstubAllGlobals())

describe('nota de legado gravada no Hall', () => {
  it('recalcula as notas gravadas com outra versão dos pesos (e só elas)', async () => {
    const real = evaluateRun({ id: 'star', identity: { ...ID, surname: 'STAR' }, seasons: star }, { finished: true })
    // gravada antes da v2 (sem `v`) com outra nota; a outra já está na versão atual
    const old = entry('star', star, { score: 12, raw: 3.5, at: '2026-01-01T00:00:00Z' })
    const cur = entry('vol', volume, { v: LEGACY_VERSION, score: 40, raw: 18, at: '2026-01-01T00:00:00Z' })
    const out = await refreshLegacy([old, cur])
    expect(out[0].legacy).toMatchObject({ v: LEGACY_VERSION, score: real.score, raw: Math.round(real.raw * 100) / 100 })
    expect(out[1]).toBe(cur)
    expect(out.every(legacyIsCurrent)).toBe(true)
    // nada a recalcular: a mesma lista (o store não re-renderiza à toa)
    expect(await refreshLegacy(out)).toBe(out)
    // entrada sem carreira (formato estranho) fica como estava, sem derrubar as outras
    const broken = { id: 'x', summary: { legacyScore: 5 } } as unknown as HallEntry
    const mixed = await refreshLegacy([broken, old])
    expect(mixed[0]).toBe(broken)
    expect(legacyIsCurrent(mixed[1])).toBe(true)
  })

  it('o corte de 100 carreiras usa a nota com os pesos atuais, não a gravada', async () => {
    const real = { star: evaluateRun({ id: 'star', identity: ID, seasons: star }, { finished: true }), vol: evaluateRun({ id: 'vol', identity: ID, seasons: volume }, { finished: true }) }
    expect(real.star.raw).toBeGreaterThan(real.vol.raw)
    // gravadas com os pesos antigos na ordem contrária
    const list = [entry('vol', volume, { score: 90, raw: 70, at: 'x' }), entry('star', star, { score: 10, raw: 2, at: 'x' })]
    const kept = await capHall(list, 1)
    expect(kept.map((h) => h.id)).toEqual(['star'])
    expect(kept[0].legacy?.score).toBe(real.star.score)
  })

  it('reload() traz o Hall de outra janela já com as notas recalculadas', async () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k) })
    await kv.set(KV_KEYS.hall, [entry('star', star, { score: 12, raw: 3.5, at: 'x' })])
    useCareer.setState({ status: 'ready', state: null, finishedCareers: [entry('vol', volume)], busy: false, saving: false, reveal: null, isFixture: false })
    await useCareer.getState().reload()
    const hall = useCareer.getState().finishedCareers
    expect(hall.map((h) => h.id).sort()).toEqual(['star', 'vol'])
    expect(hall.every(legacyIsCurrent)).toBe(true)
  })
})
