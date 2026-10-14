/**
 * Números ao vivo de Messi e Cristiano Ronaldo (src/data/legendsLive.ts): a resposta de
 * servidor/api/lendas.php no dia da conferência (fixtures/lendas-php-2026-10-14.json) não muda nada;
 * o que o site ganhar depois entra por cima, sem quebrar as contas do Hall.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REAL_LEGENDS } from '../../../data/catalog/legends'
import { LIVE_BASELINE, LIVE_LEGENDS_ENABLED, applyLiveLegends, fetchLiveLegends, isAwardRow, isLivePayload, liveCounts, liveUpdatedLabel, type LiveLegendsPayload } from '../../../data/legendsLive'
import type { SeasonRecord } from '../../types'
import { evaluateHall, evaluateLegends, evaluateRun, legendAwardCounts, type RunInput } from '..'

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/lendas-php-2026-10-14.json', import.meta.url)), 'utf8')) as LiveLegendsPayload
const clone = (): LiveLegendsPayload => JSON.parse(JSON.stringify(fixture))
const byId = (list: typeof REAL_LEGENDS) => Object.fromEntries(list.map((l) => [l.id, l]))

describe('números ao vivo (MessivsRonaldo.app)', () => {
  it('fora do site não busca nada', async () => {
    expect(LIVE_LEGENDS_ENABLED).toBe(false)
    await expect(fetchLiveLegends()).resolves.toBeNull()
  })

  it('a foto de 14/10/2026 bate com a base dos incrementos e com os números fixos', () => {
    expect(isLivePayload(fixture)).toBe(true)
    for (const id of ['messi', 'cristiano-ronaldo'] as const) {
      expect(liveCounts(fixture.lendas[id])).toEqual(LIVE_BASELINE[id].counts)
      const fixed = byId(REAL_LEGENDS)[id]
      expect([fixture.lendas[id].jogos, fixture.lendas[id].gols, fixture.lendas[id].assistencias]).toEqual([fixed.apps, fixed.goals, fixed.assists])
      for (const [row, n] of Object.entries(LIVE_BASELINE[id].collective)) expect(fixture.lendas[id].premios.find((p) => p.nome === row)?.n ?? 0, `${id}: ${row}`).toBe(n)
      // a contagem de cada linha de prêmio (a base dos anos de um prêmio novo); as que faltam valem 0
      for (const p of fixture.lendas[id].premios.filter((x) => isAwardRow(x.nome))) expect(LIVE_BASELINE[id].rows[p.nome] ?? 0, `${id}: ${p.nome}`).toBe(p.n)
    }
    // o site conta 49 e 37 títulos; a regra do Hall, 46 e 35 (ver legends.ts)
    expect([fixture.lendas.messi.titulos, fixture.lendas['cristiano-ronaldo'].titulos]).toEqual([49, 37])
    const { legends, info } = applyLiveLegends(REAL_LEGENDS, fixture)
    expect(info.changes).toEqual({ messi: [], 'cristiano-ronaldo': [] })
    expect(liveUpdatedLabel(info)).toBe('Atualizado em 14/10/2026')
    const a = evaluateLegends(legends).map((l) => [l.id, l.raw])
    const b = evaluateLegends(REAL_LEGENDS).map((l) => [l.id, l.raw])
    expect(a).toEqual(b)
  })

  it('o que o site ganhar depois entra por cima, e as contas continuam fechando', () => {
    const p = clone()
    const m = p.lendas.messi
    m.jogos += 2
    m.gols += 3
    const row = (name: string) => m.premios.find((x) => x.nome === name)!
    row("Ballon d'Or").n += 1
    row("Ballon d'Or").anos = `2026, ${row("Ballon d'Or").anos}`
    row('Domestic Cup').n += 1
    row('Domestic Cup').anos = `2026 U.S. Open Cup, ${row('Domestic Cup').anos}`
    row('MLS Top Scorer').n += 1
    row('MLS Top Scorer').anos = `2026, ${row('MLS Top Scorer').anos}`
    // o Cristiano "perde" um gol no site: o Hall não volta atrás
    p.lendas['cristiano-ronaldo'].gols -= 1
    const { legends, info } = applyLiveLegends(REAL_LEGENDS, p)
    const L = byId(legends)
    expect([L.messi.apps, L.messi.goals, L.messi.ballonDor, L.messi.totalTitles]).toEqual([1181, 937, 9, 47])
    expect(L.messi.honours.reduce((s, h) => s + h.n, 0)).toBe(L.messi.totalTitles)
    expect(L.messi.honours.at(-1)).toMatchObject({ name: '2026 U.S. Open Cup', kind: 'cup', n: 1 })
    expect(legendAwardCounts(L.messi).ballon_dor).toBe(9)
    expect(L.messi.awards.find((a) => a.key === 'ballon_dor' && a.years === '2026')).toBeTruthy()
    expect(info.changes.messi).toEqual(['+2 jogos', '+3 gols', '+1 título', '+1 Bola de Ouro', '+1 Artilheiro de liga'])
    expect(L['cristiano-ronaldo'].goals).toBe(981)
    // as outras 48 lendas são os mesmos objetos
    expect(legends.filter((l, i) => l === REAL_LEGENDS[i])).toHaveLength(48)
    const ev = byId(evaluateLegends(legends) as never) as unknown as Record<string, { values: { ballonDor: number; topScorer: number } }>
    expect(ev.messi.values.ballonDor).toBe(9)
    expect(ev.messi.values.topScorer).toBe(10)
  })

  it('MLS: cada título novo vai para o grupo da regra do Hall, não para a linha do site', () => {
    const grow = (rowName: string, item: string) => {
      const p = clone()
      const r = p.lendas.messi.premios.find((x) => x.nome === rowName)!
      r.n += 1
      r.anos = `${item}, ${r.anos}`
      return byId(applyLiveLegends(REAL_LEGENDS, p).legends).messi
    }
    const base = byId(REAL_LEGENDS).messi
    // o site põe o Supporters' Shield em "League Titles": no Hall é só título (outros), não nacional
    const shield = grow('League Titles', "2026 MLS Supporters' Shield")
    expect([shield.leagueTitles, shield.totalTitles]).toEqual([base.leagueTitles, base.totalTitles + 1])
    expect(shield.honours.at(-1)).toMatchObject({ name: "2026 MLS Supporters' Shield", kind: 'other', n: 1 })
    // e a MLS Cup em "Domestic Cup": no Hall é o título nacional da MLS
    const cup = grow('Domestic Cup', '2026 MLS Cup')
    expect([cup.leagueTitles, cup.totalTitles]).toEqual([base.leagueTitles + 1, base.totalTitles + 1])
    expect(cup.honours.at(-1)).toMatchObject({ name: '2026 MLS Cup', kind: 'league', n: 1 })
    for (const l of [shield, cup]) {
      expect(l.honours.reduce((s, h) => s + h.n, 0)).toBe(l.totalTitles)
      expect(l.honours.filter((h) => h.kind === 'league').reduce((s, h) => s + h.n, 0)).toBe(l.leagueTitles)
    }
  })

  it('os anos de um prêmio novo saem da linha que cresceu', () => {
    const p = clone()
    const row = (name: string) => p.lendas.messi.premios.find((x) => x.nome === name)!
    row('MLS MVP Award').n += 1
    row('MLS MVP Award').anos = `2026, ${row('MLS MVP Award').anos}`
    row('MLS Top Scorer').n += 1
    row('MLS Top Scorer').anos = `2026, ${row('MLS Top Scorer').anos}`
    const m = byId(applyLiveLegends(REAL_LEGENDS, p).legends).messi
    const fresh = m.awards.filter((a) => a.name.includes('novo'))
    // não "2023 FIFA Best" (a linha do The Best também tem "Player of the Year") nem "2020/21" (o Pichichi)
    expect(fresh.find((a) => a.key === 'league_best_player')).toMatchObject({ n: 1, years: '2026' })
    expect(fresh.find((a) => a.key === 'league_top_scorer')).toMatchObject({ n: 1, years: '2026' })
    expect(fresh).toHaveLength(2)
  })

  it('a nota de uma run não muda com os números ao vivo (recordes medidos contra os fixos)', () => {
    const p = clone()
    p.lendas['cristiano-ronaldo'].gols += 20
    p.lendas['cristiano-ronaldo'].jogos += 20
    const { legends } = applyLiveLegends(REAL_LEGENDS, p)
    // 1.000 gols: recorde contra os 981 conferidos, mas não contra os 1.001 "ao vivo"
    const seasons = Array.from({ length: 20 }, (_, i) => ({ season: 2030 + i, age: 18 + i, clubId: 'c', leagueId: 'x', tier: 1, loan: false, period: 1, role: 'starter', ovrStart: 80, ovrEnd: 80, marketValue: 1, stats: { apps: 50, goals: 50, assists: 5, rating: 7 }, country: 'BRA', confed: 'CONMEBOL', nationality: 'BRA', trophies: [], awards: [] }) as unknown as SeasonRecord)
    const input: RunInput = { id: 'r', identity: { surname: 'X', number: 9, foot: 'right', nationality: 'BRA', position: 'CA' }, seasons }
    const solo = evaluateRun(input)
    expect(solo.historic.some((r) => r.metric === 'goals')).toBe(true)
    const hall = evaluateHall([input], { legends, recordBase: REAL_LEGENDS })
    expect(hall.runs[0].score).toBe(solo.score)
    expect(hall.legends.find((l) => l.id === 'cristiano-ronaldo')!.legend.goals).toBe(1001)
  })

  it('resposta estranha é ignorada', () => {
    expect(isLivePayload(null)).toBe(false)
    expect(isLivePayload({ buscadoEm: 'x', lendas: { messi: {} } })).toBe(false)
    const p = clone() as unknown as { lendas: { messi: { gols: unknown } } }
    p.lendas.messi.gols = 'muitos'
    expect(isLivePayload(p)).toBe(false)
    // cada item de `premios` também é conferido (antes, um nome nulo passava e derrubava applyLiveLegends)
    for (const bad of [{ nome: null, n: 1, anos: '' }, { nome: 'X', n: 'um', anos: '' }, { nome: 'X', n: 1, anos: 7 }, null]) {
      const q = clone()
      ;(q.lendas.messi.premios as unknown[]).push(bad)
      expect(isLivePayload(q), JSON.stringify(bad)).toBe(false)
    }
    // anos ausente é aceito (linha sem anos no site)
    const ok = clone()
    ;(ok.lendas.messi.premios as unknown[]).push({ nome: 'Linha nova', n: 0 })
    expect(isLivePayload(ok)).toBe(true)
    expect(() => applyLiveLegends(REAL_LEGENDS, ok)).not.toThrow()
  })
})
