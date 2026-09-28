/**
 * PLACEHOLDER (foundation) — the summary team replaces this file.
 * Contract: default export, no props. Route "#/resumo" (current career) or "#/resumo?id=<hallId>".
 * Data: useCareer((s) => s.summary()) or summaryOf(hallEntry.career).
 */
import { ChartLine } from 'lucide-react'
import { useApp } from '@/store/app'
import { useCareer } from '@/store/career'
import { formatInt, formatMoney, OvrBadge } from '@/ui/primitives'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'
import { useShellSlots } from '@/ui/shell/slots'

export default function SummaryScreen() {
  useShellSlots({ stage: { preset: 'legend' } })
  const id = useApp((s) => s.route.query.id)
  const hall = useCareer((s) => (id ? s.finishedCareers.find((h) => h.id === id) : undefined))
  const state = useCareer((s) => s.state)
  const summary = useCareer((s) => (hall ? hall.summary : s.state ? s.summaryOf(s.state) : null))
  const who = hall?.identity ?? state?.identity
  return (
    <PlaceholderScreen eyebrow="Resumo da carreira" title={who ? `${who.surname} — ${summary?.headline ?? ''}` : 'Sem carreira'} icon={ChartLine} description="Gráfico de OVR, clubes, seleção, títulos, prêmios, comparações com lendas e card para compartilhar.">
      {summary && (
        <div className="relative mt-4 flex items-center gap-5 flex-wrap">
          <OvrBadge ovr={summary.peakOvr} size="lg" />
          <dl className="grid grid-cols-3 gap-x-6 gap-y-1 m-0">
            {[
              ['Jogos', formatInt(summary.totals.apps)],
              ['Gols', formatInt(summary.totals.goals)],
              ['Títulos', formatInt(summary.trophies.reduce((a, t) => a + t.count, 0))],
              ['Temporadas', formatInt(summary.seasons)],
              ['Pico', formatMoney(summary.peakValue)],
              ['Legado', formatInt(summary.legacyScore)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="lx-eyebrow">{k}</dt>
                <dd className="num text-[24px] font-extrabold m-0">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </PlaceholderScreen>
  )
}
