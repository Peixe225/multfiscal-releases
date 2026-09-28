/**
 * Consumidor global da fila de efeitos do Modo Imersivo: toasts, OVR, transferências,
 * conquistas e a celebração "CAMPEÃO!" (fila de troféus). Eventos de partida ficam com a tela
 * da partida; prêmios individuais ficam com a cerimônia.
 */
import { useState } from 'react'
import { ArrowUpRight, Medal, TrendingUp } from 'lucide-react'
import type { TrophyWin } from '@/engine/types'
import { useEffectStream, useImmersive } from '@/store/immersive'
import { getClub } from '@/store/data'
import { toast } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'
import { goTab } from '../shell/ImTopBar'
import { TrophyCelebration } from './TrophyCelebration'

export function EffectsHost() {
  const [queue, setQueue] = useState<TrophyWin[]>([])
  useEffectStream((e, q) => {
    if (q.action === 'fixture') return
    switch (e.type) {
      case 'toast': {
        const tone = e.tone === 'info' ? 'default' : e.tone
        toast({ title: e.title, description: e.description, tone })
        break
      }
      case 'ovr_change':
        if (e.to !== e.from) {
          toast({ title: `OVR ${e.from} → ${e.to}`, description: e.to > e.from ? 'Evolução confirmada pelo departamento técnico.' : 'Queda de rendimento.', tone: e.to > e.from ? 'gold' : 'danger', icon: TrendingUp })
          if (e.to > e.from) sfx.play('unlock')
        }
        break
      case 'transfer': {
        const c = getClub(e.clubId)
        toast({ title: `Bem-vindo ao ${c?.name ?? 'novo clube'}!`, description: e.fee ? 'Transferência concluída. Apresentação na próxima semana.' : 'Contrato assinado.', tone: 'gold', icon: ArrowUpRight })
        break
      }
      case 'achievement':
        toast({ title: 'Conquista desbloqueada', description: e.id.replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase()), tone: 'gold', icon: Medal })
        break
      case 'trophy':
        setQueue((x) => [...x, e.trophy])
        break
      case 'season_end':
        // o balanço abre por baixo da celebração (se houver taça)
        setTimeout(() => goTab('temporada'), 400)
        break
      case 'retired':
        toast({ title: 'Fim de carreira', description: 'Obrigado por tudo, craque.', tone: 'gold' })
        break
      default:
        break
    }
  })
  const state = useImmersive((s) => s.state)
  const lastMatch = useImmersive((s) => s.lastMatch)
  if (!queue.length || !state) return null
  return <TrophyCelebration key={`${queue[0].trophyId}-${queue[0].season}-${queue.length}`} trophy={queue[0]} state={state} lastMatch={lastMatch} onClose={() => setQueue((x) => x.slice(1))} />
}
