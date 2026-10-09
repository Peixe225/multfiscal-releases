/**
 * Montado pelo AppShell enquanto o modo live está ligado (ou na página #/live): mantém a conexão,
 * roda o autopiloto (só na janela que tem a trava) e mostra a faixa da live sobre o jogo.
 *
 * Janela da live (aberta por "Abrir janela da live", ou a fonte de navegador do OBS em /obs): fica PRONTA,
 * sem começar, e avisa as outras abas; o painel manda o começo ('start' com o modo escolhido) pelo
 * BroadcastChannel — e pela ponte, que leva tudo isso (e a configuração) até o OBS.
 */
import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
import { newLegendNow, requestStart, requestStop, startAutopilot, stopAutopilot } from '@/live/autopilot'
import { acquireLiveLock, beatCaptureReady, clearCaptureReady, isCaptureWindow, lockHolder, onLiveCommand, onLiveSim, onLiveStart, releaseLiveLock, startRelay, type LiveSummary } from '@/live/channel'
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

const secsLeft = (at: number) => Math.max(0, Math.ceil((at - Date.now()) / 1000))

/** Resumo do batimento: o que os painéis das outras janelas mostram (e usam para rotular os botões). */
function summary(): LiveSummary {
  const l = useLive.getState()
  const c = l.creation
  const career = useCareer.getState().state
  return {
    status: l.status.state,
    ...(l.round ? { round: l.round.title, secondsLeft: secsLeft(l.round.endsAt) } : {}),
    paused: useLiveSession.getState().paused,
    stage: l.stage,
    ...(c ? { creation: { phase: c.phase, secondsLeft: secsLeft(c.endsAt), ...(c.winner ? { winner: c.winner.user } : {}) } } : {}),
    ...(career && career.phase !== 'finished' && !career.retired ? { career: career.identity.surname } : {}),
  }
}

export default function LiveRoot() {
  const on = useLiveSession((s) => s.on)
  const source = useLiveConfig((s) => s.config.source)
  const simAuto = useLiveConfig((s) => s.config.simAuto)
  const hud = useHudVisible()
  const [leader, setLeader] = useState(false)

  // revezamento pela ponte (painel ↔ OBS): comandos, batimentos e configuração, qualquer que seja a fonte
  useEffect(() => startRelay(), [])

  // conexão: liga ao abrir #/live ou o modo live; troca de fonte reconecta
  useEffect(() => {
    connectLive()
    return () => disconnectLive()
  }, [source, simAuto])

  // a live começou nesta janela: o público de teste/os apoiadores de antes não entram nela. Recarregar a
  // página com a live já ligada (on veio true) mantém tudo, para retomar.
  const prevOn = useRef(on)
  useEffect(() => {
    if (on && !prevOn.current) useLive.getState().clearSession()
    prevOn.current = on
  }, [on])

  // janela da live esperando o começo: avisa o painel (com a carreira salva nesta janela — no OBS ela não é
  // a do painel) e atende o 'start'
  useEffect(() => {
    if (on || !isCaptureWindow()) return
    const beat = () => {
      const c = useCareer.getState()
      if (lockHolder()) clearCaptureReady()
      else beatCaptureReady(selectHasActiveCareer(c) ? c.state?.identity.surname : undefined)
    }
    beat()
    const t = setInterval(beat, 2000)
    const off = onLiveStart((mode) => {
      if (!lockHolder()) requestStart(mode)
    })
    window.addEventListener('pagehide', clearCaptureReady)
    return () => {
      clearInterval(t)
      off()
      window.removeEventListener('pagehide', clearCaptureReady)
      clearCaptureReady()
    }
  }, [on])

  // trava entre janelas + batimento com um resumo para os painéis
  useEffect(() => {
    if (!on) {
      setLeader(false)
      return
    }
    const beat = () => setLeader(acquireLiveLock(summary()))
    beat()
    const t = setInterval(beat, 2000)
    // recarregar/fechar solta a trava na hora: a página nova assume sem mostrar a faixa de "painel" no ar
    window.addEventListener('pagehide', releaseLiveLock)
    return () => {
      clearInterval(t)
      window.removeEventListener('pagehide', releaseLiveLock)
      releaseLiveLock()
    }
  }, [on])

  useEffect(() => {
    if (!on || !leader) return
    let alive = true
    // esta janela passa a rodar a live: relê carreira e Hall do IndexedDB antes de agir (outra janela pode
    // ter jogado enquanto esta era só painel)
    void useCareer
      .getState()
      .reload()
      .finally(() => {
        if (alive) startAutopilot()
      })
    const offCmd = onLiveCommand((cmd) => {
      const s = useLiveSession.getState()
      if (cmd === 'pause') s.setPaused(true)
      else if (cmd === 'resume') s.setPaused(false)
      else if (cmd === 'close-vote') useLive.getState().closeNow()
      else if (cmd === 'new-legend') newLegendNow()
      else if (cmd === 'stop') requestStop()
    })
    // botões de teste de um painel: entram aqui como eventos simulados
    const offSim = onLiveSim((e) => useLive.getState().ingest(e, { sim: true }))
    return () => {
      alive = false
      offCmd()
      offSim()
      stopAutopilot()
    }
  }, [on, leader])

  return hud ? <LiveHud leader={leader} /> : null
}
