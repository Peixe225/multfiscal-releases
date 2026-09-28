/**
 * PLACEHOLDER (foundation) — the cockpit team replaces this file.
 * Contract: default export, no props. Route "#/carreira".
 * Store: useCareer() → state, reveal, previous, busy, choose(optionId), ackReveal().
 */
import { ArrowRight, Gauge } from 'lucide-react'
import { navigate } from '@/store/app'
import { useCareer } from '@/store/career'
import { AgeBadge, Button, ClubChip, EffectChip, Money, OvrBadge, OvrPill } from '@/ui/primitives'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'

export default function CareerScreen() {
  const s = useCareer((x) => x.state)
  const busy = useCareer((x) => x.busy)
  const reveal = useCareer((x) => x.reveal)
  const choose = useCareer((x) => x.choose)
  const ack = useCareer((x) => x.ackReveal)
  if (!s)
    return (
      <PlaceholderScreen
        eyebrow="Modo Clássico"
        title="Nenhuma carreira em andamento"
        icon={Gauge}
        description="Crie o seu jogador para começar."
        actions={
          <Button variant="primary" iconRight={ArrowRight} onClick={() => navigate('/identidade')}>
            Nova carreira
          </Button>
        }
      />
    )
  const d = s.pendingDecision
  const last = s.seasons[s.seasons.length - 1]
  return (
    <PlaceholderScreen eyebrow="Modo Clássico · cockpit" title={`${s.identity.surname} · ${s.age} anos`} icon={Gauge} description={d ? d.title : s.retiredReason ?? 'Carreira encerrada.'} actions={<></>}>
      <div className="relative mt-4 flex items-center gap-4">
        <OvrBadge ovr={s.ovr} size="lg" from={reveal?.ovrBefore} countUp={!!reveal} delta={last ? last.ovrEnd - last.ovrStart : 0} />
        <div className="grid gap-1.5 min-w-0">
          <ClubChip clubId={s.clubId} size="lg" />
          <Money value={s.marketValue} className="text-[22px] font-extrabold" />
        </div>
      </div>
      {s.seasons.length > 0 && (
        <div className="relative mt-4 flex flex-wrap gap-1.5" aria-label="Temporadas">
          {s.seasons.map((r) => (
            <span key={r.season} className="inline-flex items-center gap-1">
              <AgeBadge age={r.age} clubId={r.clubId} size="sm" />
              <OvrPill ovr={r.ovrEnd} size="xs" />
            </span>
          ))}
        </div>
      )}
      {reveal && (
        <div className="relative mt-4">
          <Button variant="gold" size="sm" onClick={ack}>
            Revelação pronta ({reveal.seasons.length} temporada(s)) — concluir
          </Button>
        </div>
      )}
      {d && !reveal && (
        <div className="relative mt-4 grid gap-2">
          {d.options.map((o) => (
            <div key={o.id} className="rounded-md p-3 bg-surface border border-border-strong grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="lx-eyebrow block">{o.label}</span>
                  <b className="font-display text-[16px]">{o.title}</b>
                </span>
                <Button variant="primary" size="sm" loading={busy} onClick={() => choose(o.id)}>
                  Escolher
                </Button>
              </div>
              {o.effects.map((e, i) => (
                <EffectChip key={i} effect={e} />
              ))}
            </div>
          ))}
        </div>
      )}
    </PlaceholderScreen>
  )
}
