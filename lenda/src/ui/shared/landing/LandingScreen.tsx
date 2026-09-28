/**
 * PLACEHOLDER (foundation) — the landing team replaces this file.
 * Contract: default export, no props. Route "#/".
 */
import { ArrowRight, Play, Trophy } from 'lucide-react'
import { navigate } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
import { Button, LivePill, OvrPill } from '@/ui/primitives'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'
import { useShellSlots } from '@/ui/shell/slots'

export default function LandingScreen() {
  useShellSlots({ stage: { preset: 'brand' } })
  const active = useCareer(selectHasActiveCareer)
  const s = useCareer((x) => x.state)
  return (
    <PlaceholderScreen
      eyebrow="Início"
      title="Construa sua carreira no futebol."
      icon={Trophy}
      description={
        <>
          Escolha sua origem, tome decisões importantes e deixe o destino te levar a uma trajetória única de <b className="text-text">títulos, Bolas de Ouro e noites de Copa do Mundo</b>.
        </>
      }
      items={['Modo Clássico e Modo Imersivo', 'Ritmo Intensa · Normal · Expressa', 'Continuar carreira salva', 'Líderes das ligas ao vivo']}
      actions={
        <>
          <Button variant="primary" iconRight={ArrowRight} onClick={() => navigate('/identidade')}>
            Começar carreira
          </Button>
          {active && s && (
            <Button variant="ghost" icon={Play} onClick={() => navigate('/carreira')}>
              Continuar · {s.identity.surname} <OvrPill ovr={s.ovr} size="sm" />
            </Button>
          )}
        </>
      }
    >
      <div className="relative mt-5">
        <LivePill>Temporada 2026 ao vivo · Tabelas reais de hoje</LivePill>
      </div>
    </PlaceholderScreen>
  )
}
