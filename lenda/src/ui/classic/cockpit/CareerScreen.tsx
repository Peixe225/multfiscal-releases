/**
 * Modo Clássico cockpit (route "#/carreira") — DESIGN-SPEC-noite §10.4 + Copero behaviour.
 *
 * ≥ lg   two columns 560 | 1fr locked to the viewport: hero · stats · vitrine · decision | table
 * < lg   one column: hero · stats · vitrine · table, and the decision as a sticky bottom sheet
 *        (collapses while the reveal plays so the table stays visible)
 * Keys   1–4 focus an option · Enter confirms · ←/→ move · Space skips the reveal / celebration
 */
import { useEffect, useRef, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, ChevronDown, Gauge, SkipForward } from 'lucide-react'
import { navigate, useApp } from '@/store/app'
import { decisionProgress, useCareer } from '@/store/career'
import { getLeague, useClub } from '@/store/data'
import { Button, clubVars, cx, formatSeason, useIsWide, useMediaQuery, useReducedMotion } from '@/ui/primitives'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'
import { useShellSlots } from '@/ui/shell/slots'
import { DecisionPanel } from '@/ui/classic/decision/DecisionPanel'
import { TrophyCelebrationHost } from '@/ui/classic/celebration/TrophyCelebration'
import { director, useRevealDirector } from '@/ui/classic/reveal/director'
import { useReveal } from '@/ui/classic/reveal/store'
import { PlayerHeaderCard } from './PlayerHeaderCard'
import { StatRow } from './StatRow'
import { TrophyShowcase } from './TrophyShowcase'
import { RightPanel } from './RightPanel'
import { EndCard } from './EndCard'
import { DECISION_KIND_LABEL } from './model'
import { useCockpitData } from './view'
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

  const finished = data.state.phase === 'finished' || data.state.retired
  const showEnd = finished && !data.gates.revealing
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
      <TrophyCelebrationHost />
    </main>
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
      <div className="lx-session max-sm:hidden">
        <b className="tabular-nums">Temporada {formatSeason(last?.season ?? data.state.season, lg?.calendar)}</b>
        <span className="lx-session__dot" aria-hidden="true" />
        {PACE_LABEL[data.state.pace]}
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
  if (!state || !d) return null
  const prog = decisionProgress(state)
  const idx = revealing ? Math.max(1, prog.index - 1) : prog.index
  return (
    <aside className={cx('ck-sheet', collapsed && 'is-collapsed')} aria-label="Decisão">
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
