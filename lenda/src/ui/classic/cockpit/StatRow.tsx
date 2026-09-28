/** Career totals bar: Jogos · Gols · Assist. · Títulos (goalkeeper: Jogos · SG · GS · Títulos). */
import { memo, type ComponentType } from 'react'
import { Trophy } from 'lucide-react'
import { BallIcon, BootIcon, CleanSheetIcon, ShirtIcon, GlovesIcon } from '@/ui/primitives'
import { Num } from './bits'
import { careerTotals, isKeeper } from './model'
import type { CockpitData } from './view'

type Ico = ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean }>

export const StatRow = memo(function StatRow({ data }: { data: CockpitData }) {
  const t = careerTotals(data.statSeasons)
  const titles = careerTotals(data.trophySeasons).titles
  const gk = isKeeper(data.state.identity.position)
  const cols: { label: string; icon: Ico; value: number }[] = gk
    ? [
        { label: 'Jogos', icon: ShirtIcon as Ico, value: t.apps },
        { label: 'SG', icon: CleanSheetIcon as Ico, value: t.cleanSheets },
        { label: 'GS', icon: GlovesIcon as Ico, value: t.conceded },
        { label: 'Títulos', icon: Trophy as Ico, value: titles },
      ]
    : [
        { label: 'Jogos', icon: ShirtIcon as Ico, value: t.apps },
        { label: 'Gols', icon: BallIcon as Ico, value: t.goals },
        { label: 'Assist.', icon: BootIcon as Ico, value: t.assists },
        { label: 'Títulos', icon: Trophy as Ico, value: titles },
      ]
  const titleFull: Record<string, string> = { SG: 'Jogos sem sofrer gol', GS: 'Gols sofridos', 'Assist.': 'Assistências' }
  return (
    <dl className="ck-stats lx-glass-flat" aria-label="Números da carreira">
      {cols.map((c) => (
        <div key={c.label} className="ck-stat" title={titleFull[c.label]}>
          <dt className="lx-eyebrow ck-stat__l">
            <c.icon size={13} strokeWidth={1.9} aria-hidden />
            {c.label}
          </dt>
          <dd className="ck-stat__v num">
            <Num value={c.value} duration={500} />
          </dd>
        </div>
      ))}
    </dl>
  )
})
