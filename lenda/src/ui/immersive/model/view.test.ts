/**
 * Derivações de texto da Central: datas relativas (o bloco de fim de temporada não vira "há 62 sem."),
 * aposentadoria sem código cru do motor, convocação sem "Convocação · Convocação" e pontos no singular.
 */
import { describe, expect, it } from 'vitest'
import type { ContractOffer } from '@/engine/immersive/types'
import { bestOffer, callupLabel, ptsLabel, relWeek, retiredLead } from './view'

describe('relWeek', () => {
  const s = (week: number) => ({ week, season: 2028 })
  it('semanas recentes', () => {
    expect(relWeek(s(10), 10, 2028)).toBe('esta semana')
    expect(relWeek(s(10), 9, 2028)).toBe('há 1 sem.')
    expect(relWeek(s(10), 4, 2028)).toBe('há 6 sem.')
  })
  it('mais de 8 semanas: a semana em si; o bloco de fim (53–62) conta como 52', () => {
    expect(relWeek(s(62), 0, 2028)).toBe('pré-temp.')
    expect(relWeek(s(41), 17, 2028)).toBe('sem. 17')
    expect(relWeek(s(62), 48, 2028)).toBe('há 4 sem.')
    expect(relWeek(s(62), 60, 2028)).toBe('esta semana')
  })
  it('outras temporadas', () => {
    expect(relWeek(s(3), 40, 2027)).toBe('temp. 2027')
  })
})

describe('retiredLead', () => {
  it('nunca mostra a chave do motor', () => {
    for (const k of ['voluntary', 'retirement_age', 'no_offers', 'algo_novo', undefined]) expect(retiredLead(k)).not.toMatch(/^[a-z_]+$/)
    expect(retiredLead('voluntary')).toBe('Você decidiu pendurar as chuteiras.')
    expect(retiredLead('Aposentadoria aos 38 anos.')).toBe('Aposentadoria aos 38 anos.')
  })
})

describe('textos curtos', () => {
  it('pt/pts', () => {
    expect(ptsLabel(1)).toBe('1 pt')
    expect(ptsLabel(0)).toBe('0 pts')
    expect(ptsLabel(12)).toBe('12 pts')
  })
  it('convocação: data FIFA até sair a lista; convocado só com a mensagem da seleção', () => {
    const it0 = { id: 'c:2026:41', kind: 'national_callup' as const, title: 'Convocação · Brasil', week: 41, done: false }
    expect(callupLabel({ inbox: [], season: 2026 }, it0)).toEqual({ label: 'Data FIFA', sub: 'Brasil', called: false })
    const inbox = [{ id: 'm', from: 'Seleção · Brasil', subject: 'Você foi convocado!', body: '', week: 41, season: 2026, read: false }]
    expect(callupLabel({ inbox, season: 2026 } as never, { ...it0, done: true }).label).toBe('Convocado')
    expect(callupLabel({ inbox: [], season: 2026 }, { ...it0, id: 'ct:2026', title: 'Convocação · Copa do Mundo 2027' })).toMatchObject({ label: 'Lista final', sub: 'Copa do Mundo 2027' })
  })
  it('melhor proposta: papel pesa mais que o salário', () => {
    const o = (id: string, role: ContractOffer['role'], salary: number) => ({ id, clubId: id, role, salary }) as ContractOffer
    expect(bestOffer([])).toBeNull()
    expect(bestOffer([o('a', 'Reserva', 900_000), o('b', 'Titular', 50_000)])?.id).toBe('b')
  })
})
