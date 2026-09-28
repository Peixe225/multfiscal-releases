/**
 * PLACEHOLDER (foundation) — the live-leagues team replaces this file.
 * Contract: default export, no props. Route "#/ligas".
 */
import { Radio } from 'lucide-react'
import { useData } from '@/store/data'
import { ClubChip } from '@/ui/primitives'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'

export default function LiveLeaguesScreen() {
  const data = useData((s) => s.data)
  const leaders = data ? data.leagues.slice(0, 5).map((l) => ({ l, row: data.standings[l.id]?.[0] })) : []
  return (
    <PlaceholderScreen eyebrow="Ligas ao vivo" title="As tabelas reais de hoje" icon={Radio} description="Classificação atual de cada liga, zonas de classificação e rebaixamento, e o que falta jogar.">
      <ul className="relative mt-4 mb-0 p-0 list-none grid gap-2">
        {leaders.map(({ l, row }) => (
          <li key={l.id} className="flex items-center gap-3 rounded-sm px-3 py-2 bg-surface border border-border">
            <span className="text-[12.5px] font-semibold text-text-2 w-28 truncate">{l.shortName}</span>
            <ClubChip clubId={row?.clubId} size="sm" className="flex-1" />
            <span className="num text-[16px] font-extrabold">{row?.points ?? '—'}</span>
            <span className="text-[10px] font-bold text-text-3 tracking-[.12em]">PTS</span>
          </li>
        ))}
      </ul>
    </PlaceholderScreen>
  )
}
