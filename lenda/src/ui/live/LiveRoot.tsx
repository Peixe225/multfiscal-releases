/**
 * Montado pelo AppShell enquanto o modo live está ligado (ou na página #/live): mantém a conexão,
 * roda o autopiloto (só na janela que tem a trava) e mostra a faixa da live sobre o jogo.
 */
import { useEffect, useState } from 'react'
import { useApp } from '@/store/app'
import { startAutopilot, stopAutopilot, newLegendNow } from '@/live/autopilot'
import { acquireLiveLock, onLiveCommand, releaseLiveLock } from '@/live/channel'
import { useLiveConfig, useLiveSession } from '@/live/config'
import { connectLive, disconnectLive } from '@/live/connection'
import { useLive } from '@/live/store'
import { LiveHud } from './LiveHud'
import './live.css'

/** Faixa visível só onde o jogo aparece para o público. */
export function useHudVisible(): boolean {
  const on = useLiveSession((s) => s.on)
  const path = useApp((s) => s.route.path)
  const tela = useApp((s) => s.route.query.tela)
  return on && (path === '/carreira' || (path === '/live' && tela === 'palco'))
}

export default function LiveRoot() {
  const on = useLiveSession((s) => s.on)
  const source = useLiveConfig((s) => s.config.source)
  const simAuto = useLiveConfig((s) => s.config.simAuto)
  const hud = useHudVisible()
  const [leader, setLeader] = useState(false)

  // conexão: liga ao abrir #/live ou o modo live; troca de fonte reconecta
  useEffect(() => {
    connectLive()
    return () => disconnectLive()
  }, [source, simAuto])

  // trava entre janelas + batimento com um resumo para os painéis
  useEffect(() => {
    if (!on) {
      setLeader(false)
      return
    }
    const beat = () => {
      const l = useLive.getState()
      const s = useLiveSession.getState()
      const ok = acquireLiveLock({
        status: l.status.state,
        ...(l.round ? { round: l.round.title, secondsLeft: Math.max(0, Math.ceil((l.round.endsAt - Date.now()) / 1000)) } : {}),
        paused: s.paused,
        stage: l.stage,
      })
      setLeader(ok)
    }
    beat()
    const t = setInterval(beat, 2000)
    return () => {
      clearInterval(t)
      releaseLiveLock()
    }
  }, [on])

  useEffect(() => {
    if (!on || !leader) return
    startAutopilot()
    const off = onLiveCommand((cmd) => {
      const s = useLiveSession.getState()
      if (cmd === 'pause') s.setPaused(true)
      else if (cmd === 'resume') s.setPaused(false)
      else if (cmd === 'close-vote') useLive.getState().closeNow()
      else if (cmd === 'new-legend') newLegendNow()
      else if (cmd === 'stop') s.stop()
    })
    return () => {
      off()
      stopAutopilot()
    }
  }, [on, leader])

  return hud ? <LiveHud leader={leader} /> : null
}
