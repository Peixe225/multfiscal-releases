/**
 * Consumidor global da fila de efeitos do Modo Imersivo: toasts (lower-thirds da Transmissão),
 * OVR, transferências, conquistas e a celebração "CAMPEÃO!" (fila de troféus). Eventos de partida
 * ficam com a tela da partida; prêmios individuais ficam com a cerimônia.
 *
 * Toasts: no máximo 2 visíveis, duplicados colapsados, e a próxima ação do jogador limpa os
 * anteriores (nada de pilha cobrindo a Central). Recusas de ação por corrida da UI não viram aviso.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Medal, TrendingUp } from 'lucide-react'
import type { ImmersiveEffect } from '@/engine/immersive/types'
import { artigo } from '@/engine/immersive/util'
import type { CareerState, TrophyWin } from '@/engine/types'
import { useEffectStream, useImmersive } from '@/store/immersive'
import { getClub } from '@/store/data'
import { useCareer } from '@/store/career'
import { toast, useToasts } from '@/ui/primitives'
import { achievementById } from '@/ui/shell/achievementsRegistry'
import { goTab } from '../shell/ImTopBar'
import { imSfx } from '../hooks'
import { TrophyCelebration } from './TrophyCelebration'

/** Ações que a UI pode disparar "atrasadas" (o motor já seguiu adiante): recusa silenciosa. */
const RACE = new Set(['match_choose', 'match_timeout', 'match_sim', 'press_answer', 'press_skip', 'match_sub_request', 'advance', 'auto'])
const ACTION_PT: Record<string, string> = {
  retire: 'A aposentadoria só é possível a partir dos 34 anos.',
  train: 'Não há treino agora.',
  match_start: 'Não há jogo agora.',
  offer_respond: 'Esta proposta não está mais na mesa.',
  decision_choose: 'Esta decisão já foi tomada.',
  social_post: 'Você já postou nesta semana.',
  buy: 'Compra indisponível agora.',
  inbox_read: 'Mensagem indisponível.',
}
/** Avisos que só repetem o que a tela já mostra: a escalação (pré-jogo) e o fechamento da coletiva. */
const ON_SCREEN = new Set(['Titular', 'No banco', 'Fora do jogo', 'Coletiva encerrada'])
/** No celular o aviso fica acima das abas, por cima do conteúdo: some mais rápido. */
const PHONE_MS: Record<string, number> = { gold: 2600, danger: 3200 }
const isPhone = () => {
  try {
    return matchMedia('(max-width: 44.99rem)').matches
  } catch {
    return false
  }
}
/** Conquistas do motor de exemplo (o catálogo do Clássico cobre as do motor real). */
const IMM_ACH: Record<string, string> = {
  'imersivo-estreia': 'Estreia profissional',
  'imersivo-primeiro-gol': 'Primeiro gol',
  'imersivo-hat-trick': 'Hat-trick',
  'imersivo-selecao': 'Estreia pela seleção',
}

export function EffectsHost() {
  const [queue, setQueue] = useState<TrophyWin[]>([])
  const shown = useRef<Set<string>>(new Set())

  // cada nova ação limpa os avisos da anterior
  useEffect(
    () =>
      useImmersive.subscribe((s, p) => {
        if (s.busy && !p.busy) {
          const t = useToasts.getState()
          for (const x of [...t.items, ...t.queue]) t.dismiss(x.id)
          shown.current.clear()
        }
        if (s.saveFailed && !p.saveFailed) toast({ title: 'Não foi possível salvar', description: 'O navegador recusou a gravação (armazenamento cheio ou bloqueado). O jogo continua, mas o progresso pode se perder.', tone: 'danger' })
      }),
    [],
  )

  const say = (key: string, t: Parameters<typeof toast>[0]) => {
    if (shown.current.has(key)) return
    shown.current.add(key)
    toast(isPhone() && !t.action ? { ...t, duration: PHONE_MS[t.tone ?? ''] ?? 1800 } : t)
  }

  useEffectStream((e: ImmersiveEffect, q) => {
    if (q.action === 'fixture') return
    switch (e.type) {
      case 'toast': {
        if (e.tone === 'danger' && /indispon[ií]vel/i.test(e.title)) {
          const id = e.description ?? ''
          if (RACE.has(id)) return
          // clique duplo em "Aposentar": o segundo envio chega com a carreira já encerrada
          if (id === 'retire' && useImmersive.getState().state?.retired) return
          say(`deny:${id}`, { title: 'Agora não dá', description: ACTION_PT[id] ?? 'Essa ação não está disponível neste momento.', tone: 'danger' })
          return
        }
        // treino escolhido na Central: no desktop os atributos já sobem animados no painel; no celular
        // (painel longe, lá embaixo) o aviso fica só quando algum atributo subiu
        if (ON_SCREEN.has(e.title) || (e.title === 'Treino concluído' && q.action === 'train' && (!isPhone() || !e.description?.startsWith('+')))) return
        const tone = e.tone === 'info' ? 'default' : e.tone
        // "Bem-vindo ao …" e o efeito de transferência são o mesmo aviso: vale o primeiro
        say(/^bem-vindo/i.test(e.title) ? 'welcome' : `t:${e.title}`, { title: e.title, description: e.description, tone })
        break
      }
      case 'ovr_change':
        if (e.to !== e.from) {
          say('ovr', { title: `OVR ${e.from} → ${e.to}`, description: e.to > e.from ? 'Evolução confirmada pelo departamento técnico.' : 'Queda de rendimento.', tone: e.to > e.from ? 'gold' : 'danger', icon: TrendingUp })
          if (e.to > e.from) imSfx.play('unlock')
        }
        break
      case 'transfer': {
        const c = getClub(e.clubId)
        say('welcome', { title: `Bem-vindo ${artigo(c) === 'a' ? 'à' : 'ao'} ${c?.name ?? 'novo clube'}!`, description: e.fee ? 'Transferência concluída. Apresentação na próxima semana.' : 'Contrato assinado.', tone: 'gold', icon: ArrowUpRight })
        break
      }
      case 'achievement': {
        const a = achievementById(e.id)
        const name = a?.title ?? IMM_ACH[e.id] ?? e.id.replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase())
        // conquistas do catálogo ficam salvas (contador e diálogo de conquistas da barra valem para os dois modos)
        if (a && !useImmersive.getState().isFixture) useCareer.getState().unlockAchievements([e.id], useImmersive.getState().state as unknown as CareerState)
        say(`a:${e.id}`, { title: 'Conquista desbloqueada', description: name, tone: 'gold', icon: Medal })
        break
      }
      case 'trophy':
        setQueue((x) => [...x, e.trophy])
        break
      case 'season_end':
        // o balanço abre por baixo da celebração (se houver taça)
        setTimeout(() => goTab('temporada'), 400)
        break
      case 'retired':
        say('ret', { title: 'Fim de carreira', description: 'Obrigado por tudo, craque. A sua trajetória entrou no Hall das Lendas.', tone: 'gold' })
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
