/**
 * PLACEHOLDER (foundation) — the identity team replaces this file.
 * Contract: default export, no props. Route "#/identidade". On confirm:
 *   await useCareer.getState().start(identity, pace); navigate('/carreira')
 */
import { ArrowRight, UserRound } from 'lucide-react'
import { navigate } from '@/store/app'
import { useCareer } from '@/store/career'
import { Button } from '@/ui/primitives'
import { nationColors } from '@/ui/theme/club'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'
import { useShellSlots } from '@/ui/shell/slots'

export default function IdentityScreen() {
  useShellSlots({ stage: { preset: 'duo', colors: nationColors({ colors: { primary: '#009c3b', kit2: '#ffd600' } }) } })
  const busy = useCareer((s) => s.busy)
  return (
    <PlaceholderScreen
      eyebrow="Nova carreira · 1 Identidade"
      title="Defina sua identidade"
      icon={UserRound}
      description="Sobrenome, número, pé dominante, nacionalidade e posição — a camisa ganha vida enquanto você escolhe."
      items={['Camisa com o seu nome e número', 'Lista de países com bandeiras', 'Campo interativo para a posição']}
      actions={
        <Button
          variant="primary"
          iconRight={ArrowRight}
          loading={busy}
          onClick={async () => {
            await useCareer.getState().start({ surname: 'RIBEIRO', number: 9, foot: 'right', nationality: 'BRA', position: 'CA' }, 'normal')
            navigate('/carreira')
          }}
        >
          Começar com RIBEIRO #9
        </Button>
      }
    />
  )
}
