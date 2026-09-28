/**
 * PLACEHOLDER (foundation) — the hall team replaces this file.
 * Contract: default export, no props. Route "#/hall". Data: useCareer((s) => s.finishedCareers).
 */
import { Crown } from 'lucide-react'
import { useCareer } from '@/store/career'
import { OvrPill } from '@/ui/primitives'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'
import { useShellSlots } from '@/ui/shell/slots'

export default function HallScreen() {
  useShellSlots({ stage: { preset: 'legend' } })
  const hall = useCareer((s) => s.finishedCareers)
  return (
    <PlaceholderScreen eyebrow="Hall da Fama" title="Suas lendas" icon={Crown} description={hall.length ? `${hall.length} carreira(s) encerrada(s).` : 'Termine uma carreira para ela entrar no Hall da Fama.'}>
      {hall.length > 0 && (
        <ul className="relative mt-4 mb-0 p-0 list-none grid gap-2">
          {hall.slice(0, 6).map((h) => (
            <li key={h.id} className="flex items-center gap-3 rounded-sm px-3 py-2 bg-surface border border-border">
              <OvrPill ovr={h.summary.peakOvr} />
              <span className="font-display font-extrabold text-[15px] flex-1 truncate">{h.identity.surname}</span>
              <span className="text-[12px] text-text-3 truncate">{h.summary.headline}</span>
            </li>
          ))}
        </ul>
      )}
    </PlaceholderScreen>
  )
}
