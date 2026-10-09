/** Prévia de energia do treino: conta a recuperação da virada de semana até o próximo compromisso. */
import { describe, expect, it } from 'vitest'
import type { CalendarItem } from '@/engine/immersive/types'
import { WEEK_RECOVERY, energyAtNext } from './training'

const item = (week: number) => ({ id: `x${week}`, week, kind: 'training', title: '' }) as CalendarItem

describe('energyAtNext', () => {
  it('próximo compromisso na semana seguinte: +22', () => {
    expect(energyAtNext({ calendar: [item(38), item(39)], cursor: 0, week: 38 }, 77)).toEqual({ value: 99, weeks: 1 })
    expect(WEEK_RECOVERY).toBe(22)
  })
  it('mesma semana: a energia de logo após o treino; teto 100', () => {
    expect(energyAtNext({ calendar: [item(38), item(38)], cursor: 0, week: 38 }, 77)).toEqual({ value: 77, weeks: 0 })
    expect(energyAtNext({ calendar: [item(38), item(40)], cursor: 0, week: 38 }, 80).value).toBe(100)
    expect(energyAtNext({ calendar: [item(38)], cursor: 0, week: 38 }, 60)).toEqual({ value: 60, weeks: 0 })
  })
})
