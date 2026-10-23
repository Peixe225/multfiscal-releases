/**
 * Modo Clássico cockpit (route "#/carreira") — DESIGN-SPEC-noite §10.4 + Copero behaviour.
 *
 * ≥ lg   two columns 560 | 1fr locked to the viewport: hero · stats · vitrine · decision | table
 * < lg   one column: hero · stats · vitrine · table, and the decision as a sticky bottom sheet
 *        (collapses while the reveal plays so the table stays visible)
 * Keys   1–4 focus an option · Enter confirms · ←/→ move · Space skips the reveal / celebration
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, ChevronDown, Crown, Gauge, SkipForward } from 'lucide-react'
import { navigate, useApp } from '@/store/app'
import { decisionProgress, useCareer } from '@/store/career'
import { getLeague, useClub } from '@/store/data'
import { Button, clubVars, cx, formatSeason, useIsWide, useMediaQuery, useReducedMotion } from '@/ui/primitives'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'
import { useShellSlots } from '@/ui/shell/slots'
import { prefetchRoute } from '@/ui/shell/routes'
import { DecisionPanel } from '@/ui/classic/decision/DecisionPanel'
import { TrophyCelebrationHost } from '@/ui/classic/celebration/TrophyCelebration'
import { director, useRevealDirector } from '@/ui/classic/reveal/director'
import { useReveal } from '@/ui/classic/reveal/store'
import { PlayerHeaderCard } from './PlayerHeaderCard'
import { StatRow } from './StatRow'
import { TrophyShowcase } from './TrophyShowcase'
import { RightPanel } from './RightPanel'
import { EndCard, abrirResumo } from './EndCard'
import { DECISION_KIND_LABEL } from './model'
import { useCockpitData } from './view'
import { preCarregarPedacosDaCarreira } from './chunks'
import '@/ui/shared/achievements/unlockToasts'
import './cockpit.css'
import '@/ui/classic/decision/decision.css'
import '@/ui/classic/celebration/celebration.css'

const BRAND = { primary: '#5c50ff', secondary: '#ffc45c' } as const

export default function CareerScreen() {
  useRevealDirector()
  const status = useCareer((s) => s.status)
  const data = useCockpitData()
  const wide = useIsWide()
  const phone = !useMediaQuery('(min-width: 36rem)')
  const rm = useReducedMotion()
  const displayedClubId = data ? (data.gates.identity ? data.state.clubId : (data.previous ?? data.state).clubId) : null
  const club = useClub(displayedClubId)
  useShellSlots(
    {
      stage: { preset: 'club', club: club ?? undefined },
      center: <SessionCenter />,
    },
    [club?.id],
  )
  useCockpitKeys()
  useMobileRevealScroll(!wide)
  useShortDesktopScroll(wide)
  // enquanto há rede: as abas sob demanda, o resumo e a identidade ("Jogar novamente") já ficam baixados —
  // sem internet no meio da carreira eles abrem do mesmo jeito (o motor é local)
  useEffect(() => {
    preCarregarPedacosDaCarreira(() => {
      prefetchRoute('/resumo')
      prefetchRoute('/identidade')
    })
  }, [])
  const finished = !!data && (data.state.phase === 'finished' || data.state.retired)
  const showEnd = finished && !!data && !data.gates.revealing
  useMobileEndScroll(!wide && showEnd, rm)
  // celular sem carreira (voltar depois de "Jogar novamente", link antigo): a Home, sem empilhar no histórico.
  // A rota entra nas dependências: voltando rápido, a mesma instância da tela (ainda saindo na animação) volta a valer
  const path = useApp((s) => s.route.path)
  useEffect(() => {
    if (data || status !== 'ready' || wide || path !== '/carreira') return
    const t = window.setTimeout(() => {
      if (!useCareer.getState().state && useApp.getState().route.path === '/carreira') navigate('/', { replace: true })
    }, 0)
    return () => window.clearTimeout(t)
  }, [data, status, wide, path])

  if (!data) {
    if (status !== 'ready') return null
    return (
      <PlaceholderScreen
        eyebrow="Modo Clássico"
        title="Nenhuma carreira em andamento"
        icon={Gauge}
        description="Crie o seu jogador e escolha o clube da base para começar a sua lenda."
        actions={
          <Button variant="primary" iconRight={ArrowRight} onClick={() => navigate('/identidade')}>
            Nova carreira
          </Button>
        }
      />
    )
  }

  const vars = clubVars(club ?? BRAND) as CSSProperties
  const stagger = (i: number) => (rm ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.42, delay: 0.04 * i, ease: [0.16, 1, 0.3, 1] as const } })

  return (
    <main id="conteudo" className={cx('ck', !wide && 'is-stacked')} style={vars} aria-label="Carreira">
      <div className="ck-layout">
        <div className="ck-left">
          <motion.div {...stagger(0)}>
            <PlayerHeaderCard data={data} />
          </motion.div>
          <motion.div {...stagger(1)}>
            <StatRow data={data} />
          </motion.div>
          <motion.div {...stagger(2)}>
            <TrophyShowcase data={data} />
          </motion.div>
          {wide ? (
            <motion.div className="ck-left__grow" {...stagger(3)}>
              {showEnd ? <EndCard data={data} /> : <DecisionPanel />}
            </motion.div>
          ) : (
            showEnd && <EndCard data={data} />
          )}
        </div>
        <motion.div className="ck-right" {...stagger(4)}>
          <RightPanel data={data} compactFuture={phone} />
        </motion.div>
      </div>
      {!wide && !showEnd && <MobileSheet />}
      {!wide && showEnd && <MobileEndBar />}
      <TrophyCelebrationHost />
    </main>
  )
}

/**
 * Celular: a carreira acabou — o cartão "Sua carreira chegou ao fim" (com Ver resumo · Jogar novamente) fica no alto
 * da coluna, e a página estava parada no fim da tabela (a revelação segue a linha nova). Rola até ele quando o fim
 * chega (não ao abrir uma carreira já encerrada: aí a barra de baixo avisa).
 */
function useMobileEndScroll(on: boolean, rm: boolean) {
  const was = useRef(on)
  useEffect(() => {
    const prev = was.current
    was.current = on
    if (!on || prev) return
    let raf = 0
    const t = window.setTimeout(() => {
      raf = requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>('.ck-end')
        if (!el) return
        // a barra do topo só conta se ficar presa na tela (sticky/fixed); senão ela sobe junto com a página
        const bar = document.querySelector<HTMLElement>('.lx-topbar')
        const pos = bar ? getComputedStyle(bar).position : ''
        const off = bar && (pos === 'sticky' || pos === 'fixed') ? bar.getBoundingClientRect().height : 0
        const top = Math.max(0, scrollY + el.getBoundingClientRect().top - off - 10)
        window.scrollTo({ top, behavior: rm ? 'auto' : 'smooth' })
      })
    }, 60)
    return () => {
      window.clearTimeout(t)
      cancelAnimationFrame(raf)
    }
  }, [on, rm])
}

/** Celular, carreira encerrada: enquanto o cartão do fim não está na tela, uma barra fixa embaixo leva ao resumo. */
function MobileEndBar() {
  const [cardVisible, setCardVisible] = useState(true)
  useEffect(() => {
    const el = document.querySelector('.ck-end')
    if (!el || typeof IntersectionObserver === 'undefined') {
      setCardVisible(false)
      return
    }
    const io = new IntersectionObserver(([e]) => setCardVisible(e.isIntersecting), { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const goCard = () => {
    const el = document.querySelector<HTMLElement>('.ck-end')
    if (el) window.scrollTo({ top: Math.max(0, scrollY + el.getBoundingClientRect().top - 10), behavior: 'smooth' })
  }
  return (
    <div className={cx('ck-endbar', cardVisible && 'is-hidden')} aria-hidden={cardVisible || undefined} inert={cardVisible || undefined}>
      <button type="button" className="ck-endbar__t" onClick={goCard}>
        <Crown aria-hidden="true" />
        <span>Fim de carreira</span>
      </button>
      <Button variant="primary" size="md" iconRight={ArrowRight} onClick={() => void abrirResumo().then((foi) => !foi && goCard())} className="ck-endbar__go">
        Ver resumo
      </Button>
    </div>
  )
}

const PACE_LABEL = { intensa: 'Ritmo Intenso', normal: 'Ritmo Normal', expressa: 'Ritmo Expresso' } as const

/** Top-bar centre: "Temporada 2035 · Ritmo Normal" + "Carreira ▬▬▭ 10/24" — frozen while a reveal plays. */
function SessionCenter() {
  const data = useCockpitData()
  if (!data) return null
  const seasons = data.visibleSeasons
  const last = seasons[seasons.length - 1]
  const lg = getLeague(last?.leagueId)
  const pct = Math.min(100, (seasons.length / 24) * 100)
  return (
    <>
      {/* celular deitado (640–760 px): só a temporada; o ritmo passava por baixo de "Salvar carreira" */}
      <div className="lx-session ck-session max-sm:hidden">
        <b className="tabular-nums">Temporada {formatSeason(last?.season ?? data.state.season, lg?.calendar)}</b>
        <span className="ck-session__pace">
          <span className="lx-session__dot" aria-hidden="true" />
          {PACE_LABEL[data.state.pace]}
        </span>
      </div>
      <div className="lx-session max-lg:hidden" role="group" aria-label={`Carreira: ${seasons.length} de 24 temporadas`}>
        Carreira
        <span className="lx-bar lx-bar--club" style={{ width: 120, ['--v' as string]: `${pct}%`, ['--from' as string]: 'var(--club-hi, #36d884)', ['--to' as string]: '#d7ffe9' }} aria-hidden="true" />
        <b className="num text-[14px]">{seasons.length}/24</b>
      </div>
    </>
  )
}

/** Phones / tablets: the decision lives in a sticky bottom sheet (collapsible). */
function MobileSheet() {
  const collapsed = useReveal((s) => s.sheetCollapsed)
  const phase = useReveal((s) => s.phase)
  const frozen = useReveal((s) => s.decision)
  const state = useCareer((s) => s.state)
  const set = useReveal((s) => s.set)
  const revealing = phase !== 'idle'
  const d = revealing ? frozen : state?.pendingDecision
  useFoldOnFocusBehind(!!d && !collapsed && !revealing)
  if (!state || !d) return null
  const prog = decisionProgress(state)
  const idx = revealing ? Math.max(1, prog.index - 1) : prog.index
  return (
    // is-busy: o motor está simulando (a tela pode travar ~1 s num celular lento) — a faixa animada é só CSS
    // (transform), roda no compositor mesmo com a página ocupada
    <aside className={cx('ck-sheet', collapsed && 'is-collapsed', phase === 'choosing' && 'is-busy')} aria-label="Decisão">
      {phase === 'choosing' && <span className="ck-sheet__busy" aria-hidden="true" />}
      <button type="button" className="ck-sheet__peek" aria-expanded={!collapsed} aria-controls="ck-sheet-body" onClick={() => set({ sheetCollapsed: !collapsed })}>
        <span className="ck-sheet__handle" aria-hidden="true" />
        <span className="ck-sheet__peekrow">
          <span className="lx-eyebrow ck-kind">
            <span className={cx('lx-dot', !revealing && 'lx-dot--pulse')} aria-hidden="true" />
            {revealing ? 'Simulando…' : (DECISION_KIND_LABEL[d.kind] ?? 'Decisão')}
          </span>
          <span className="ck-sheet__step">
            Decisão {idx} de {prog.total}
          </span>
          <ChevronDown className="ck-sheet__chev" aria-hidden="true" />
        </span>
        {collapsed && <span className="ck-sheet__title">{d.title}</span>}
      </button>
      {collapsed && revealing && (
        <div className="ck-sheet__skip">
          <Button variant="ghost" size="sm" icon={SkipForward} onClick={() => director.skip()}>
            Pular
          </Button>
        </div>
      )}
      <div id="ck-sheet-body" className="ck-sheet__body" hidden={collapsed || undefined}>
        <div className="ck-sheet__inner">
          <DecisionPanel />
        </div>
      </div>
    </aside>
  )
}

/**
 * Teclado (Tab) com o sheet da decisão aberto: o foco que vai para o que está atrás dele (abas, vitrine, tabela)
 * ficaria invisível. O sheet se recolhe e o elemento aparece; o cabeçalho do sheet (Tab de novo) o abre outra vez.
 * Só com foco de teclado (:focus-visible): um toque nas abas já é tratado no RightPanel.
 */
function useFoldOnFocusBehind(open: boolean) {
  useEffect(() => {
    if (!open) return
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || !t.closest?.('.ck-layout')) return
      let kb = false
      try {
        kb = t.matches(':focus-visible')
      } catch {
        kb = false
      }
      if (!kb) return
      const sheet = document.querySelector('.ck-sheet')
      if (!sheet) return
      // só se o sheet cobre o elemento (deitado, com o sheet ao lado, nada a fazer)
      const r = t.getBoundingClientRect()
      const s = sheet.getBoundingClientRect()
      const cobre = r.bottom > s.top && r.top < s.bottom && r.right > s.left && r.left < s.right
      if (!cobre) return
      useReveal.getState().set({ sheetCollapsed: true })
      requestAnimationFrame(() => t.scrollIntoView({ block: 'nearest' }))
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [open])
}

/** 1–4 focus · ←/→ move · Enter confirm (native) · Space skip. */
function useCockpitKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (useApp.getState().dialog) return
      const el = e.target as HTMLElement | null
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return
      const R = useReveal.getState()
      if (e.key === ' ' || e.code === 'Space') {
        if (R.celebrationOpen) {
          e.preventDefault()
          director.dismissCelebration()
        } else if (R.phase !== 'idle' && R.phase !== 'choosing') {
          e.preventDefault()
          director.skip()
        }
        return
      }
      if (R.phase !== 'idle' || R.celebrationOpen) return
      if (el?.closest('[role="dialog"]')) return
      const opts = [...document.querySelectorAll<HTMLButtonElement>('[id^="ck-opt-"]')].filter((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true')
      if (!opts.length) return
      const n = Number(e.key)
      if (n >= 1 && n <= 4) {
        const b = document.getElementById(`ck-opt-${n - 1}`) as HTMLButtonElement | null
        if (b && opts.includes(b)) {
          e.preventDefault()
          if (useReveal.getState().sheetCollapsed) useReveal.getState().set({ sheetCollapsed: false })
          R.set({ focusIdx: n - 1 })
          b.focus({ preventScroll: false })
        }
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const cur = opts.findIndex((b) => b === document.activeElement)
        if (cur < 0) return
        e.preventDefault()
        const next = opts[(cur + (e.key === 'ArrowRight' ? 1 : opts.length - 1)) % opts.length]
        R.set({ focusIdx: Number(next.dataset.idx) })
        next.focus()
        return
      }
      if (e.key === 'Enter' && R.focusIdx != null && !opts.includes(document.activeElement as HTMLButtonElement)) {
        const b = document.getElementById(`ck-opt-${R.focusIdx}`) as HTMLButtonElement | null
        if (b && opts.includes(b)) {
          e.preventDefault()
          b.click()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * Desktop windows shorter than the cockpit (≈ 1280×720): when a decision arrives with its options
 * below the fold, scroll just enough to show them; while a reveal plays, go back up (hero + table).
 */
function useShortDesktopScroll(enabled: boolean) {
  const phase = useReveal((s) => s.phase)
  const id = useCareer((s) => s.state?.pendingDecision?.id ?? null)
  const rm = useReducedMotion()
  useEffect(() => {
    if (!enabled || phase !== 'idle' || !id) return
    const t = setTimeout(() => {
      const el = document.querySelector('.ck-left .ck-decision')
      if (!el) return
      const r = el.getBoundingClientRect()
      const dy = Math.min(r.bottom - innerHeight + 16, r.top - 8)
      if (dy > 0) window.scrollBy({ top: dy, behavior: rm ? 'auto' : 'smooth' })
    }, 600)
    return () => clearTimeout(t)
  }, [enabled, phase, id, rm])
  useEffect(() => {
    if (enabled && phase === 'identity' && scrollY > 0) window.scrollTo({ top: 0, behavior: rm ? 'auto' : 'smooth' })
  }, [enabled, phase, rm])
}

/** Phones: follow the revealed row, then come back to the next decision. */
function useMobileRevealScroll(enabled: boolean) {
  const phase = useReveal((s) => s.phase)
  const rm = useReducedMotion()
  const was = useRef(phase)
  useEffect(() => {
    const prev = was.current
    was.current = phase
    if (!enabled) return
    if (phase === 'identity' && prev !== 'identity') {
      const row = document.querySelector('.ck-row.is-new')
      row?.scrollIntoView({ block: 'center', behavior: rm ? 'auto' : 'smooth' })
    }
  }, [phase, enabled, rm])
}
