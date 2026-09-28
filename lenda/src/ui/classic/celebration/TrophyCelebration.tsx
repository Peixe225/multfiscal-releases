/**
 * Trophy celebration overlay (DESIGN-SPEC §10.5 + Copero `_t`): the cockpit blurs underneath,
 * warm veil + beam + god rays, the hero trophy rises on a lit floor with a breathing glow and a
 * glint, 18 burst particles + canvas-confetti (2 bursts), kicker · chrome title · sub · facts,
 * "Continuar". Auto-dismisses 1800 ms after it settles (paused while hovered); click, Esc or
 * Space dismiss it. Relegation variant: red glow and particles, no confetti.
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, ArrowRight, Share, Sparkles, Star, TrendingUp, Trophy, Volume2, VolumeX, X } from 'lucide-react'
import { useApp } from '@/store/app'
import { useCareer } from '@/store/career'
import { useClub } from '@/store/data'
import { BallIcon, Button, IconButton, OvrPill, clubColors, cx, toast, useIsWide, useReducedMotion } from '@/ui/primitives'
import { darken, lighten } from '@/ui/theme/club'
import { TrophyArt } from '@/ui/trophies'
import { careerTotals, isKeeper } from '@/ui/classic/cockpit/model'
import { director } from '@/ui/classic/reveal/director'
import { CELEBRATION_HOLD, useReveal } from '@/ui/classic/reveal/store'
import type { CelebrationItem } from './items'

const ENTRANCE = 900
const EASE = [0.16, 1, 0.3, 1] as const

export function TrophyCelebrationHost() {
  const open = useReveal((s) => s.celebrationOpen)
  const items = useReveal((s) => s.celebration)
  const runId = useReveal((s) => s.runId)
  return createPortal(
    <AnimatePresence>{open && items && items.length > 0 && <TrophyCelebration key={runId} items={items} onClose={() => director.dismissCelebration()} />}</AnimatePresence>,
    document.body,
  )
}

export const TrophyCelebration = memo(function TrophyCelebration({ items, onClose }: { items: CelebrationItem[]; onClose: () => void }) {
  const rm = useReducedMotion()
  const lowFx = useApp((s) => s.settings.lowFx)
  const sound = useApp((s) => s.settings.sound)
  const toggle = useApp((s) => s.toggleSetting)
  const wide = useIsWide()
  const hero = items[0]
  const rel = hero.kind === 'relegation'
  const club = useClub(hero.scope === 'club' ? hero.teamId : null)
  const colors = clubColors(club ?? null)
  const state = useCareer((s) => s.state)
  const reveal = useCareer((s) => s.reveal)
  // other items of this reveal, grouped ("2x LaLiga · 2036/37 · 2037/38")
  const rest = Object.values(
    items.slice(1).reduce<Record<string, { it: CelebrationItem; n: number; years: string[] }>>((acc, it) => {
      const k = `${it.art}:${it.name}`
      acc[k] ??= { it, n: 0, years: [] }
      acc[k].n++
      acc[k].years.push(it.year)
      return acc
    }, {}),
  )
  const [paused, setPaused] = useState(false)
  const continueRef = useRef<HTMLButtonElement>(null)

  // auto-dismiss after the entrance + hold (paused while the pointer is on the content)
  useEffect(() => {
    if (paused) return
    const t = setTimeout(onClose, (rm ? 200 : ENTRANCE) + CELEBRATION_HOLD)
    return () => clearTimeout(t)
  }, [paused, onClose, rm])

  // focus → Continuar; Esc closes; the page behind is inert via aria-modal + the blur class
  useEffect(() => {
    const t = setTimeout(() => continueRef.current?.focus({ preventScroll: true }), rm ? 0 : ENTRANCE)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    document.documentElement.classList.add('ck-celebrating')
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('ck-celebrating')
    }
  }, [onClose, rm])

  // canvas-confetti: burst at 300 ms, side cannons at 700 ms
  useEffect(() => {
    if (rel || rm) return
    let cancelled = false
    const palette = [colors.primary, darken(colors.primary, 0.3), '#ffffff', '#ffd66e', '#f3c14a', lighten(colors.primary, 0.35)]
    const scale = lowFx ? 0.45 : 1
    const timers: ReturnType<typeof setTimeout>[] = []
    import('canvas-confetti')
      .then(({ default: confetti }) => {
        if (cancelled) return
        const fire = confetti.create(undefined, { resize: true, useWorker: true, disableForReducedMotion: true })
        timers.push(setTimeout(() => void fire({ particleCount: Math.round(140 * scale), spread: 80, startVelocity: 45, origin: { y: 0.25 }, colors: palette, disableForReducedMotion: true, zIndex: 80 }), 300))
        timers.push(
          setTimeout(() => {
            void fire({ particleCount: Math.round(70 * scale), angle: 60, spread: 60, startVelocity: 55, origin: { x: 0.08, y: 0.7 }, colors: palette, zIndex: 80 })
            void fire({ particleCount: Math.round(70 * scale), angle: 120, spread: 60, startVelocity: 55, origin: { x: 0.92, y: 0.7 }, colors: palette, zIndex: 80 })
          }, 700),
        )
        cleanup = () => fire.reset()
      })
      .catch(() => {})
    let cleanup = () => {}
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = state ? careerTotals(state.seasons) : null
  const newTitles = items.filter((i) => i.kind === 'trophy').length
  const pill = rel ? null : hero.kind === 'award' ? 'PRÊMIO INDIVIDUAL' : newTitles > 1 ? `+${newTitles} TÍTULOS · ${totals?.titles ?? newTitles} NA CARREIRA` : `${totals?.titles ?? 1}º TÍTULO DA CARREIRA`
  const rec = hero.record
  const gk = isKeeper(state?.identity.position)
  const facts: { key: string; tone: 'gold' | 'pos' | 'neg'; icon: typeof Star; body: React.ReactNode }[] = []
  if (reveal && reveal.ovrAfter !== reveal.ovrBefore)
    facts.push({
      key: 'ovr',
      tone: reveal.ovrAfter > reveal.ovrBefore ? 'pos' : 'neg',
      icon: TrendingUp,
      body: (
        <>
          OVR <OvrPill ovr={reveal.ovrBefore} size="xs" /> <ArrowRight className="ck-cel__arrow" aria-hidden="true" /> <OvrPill ovr={reveal.ovrAfter} size="xs" />
        </>
      ),
    })
  if (rec && !rel) {
    const scorer = rec.awards.find((a) => a.award === 'league_top_scorer' && a.place === 1)
    if (scorer) facts.push({ key: 'art', tone: 'gold', icon: Star, body: `Artilheiro da liga · ${rec.stats.goals} gols` })
    else if (!gk && rec.stats.goals > 0) facts.push({ key: 'g', tone: 'gold', icon: BallIcon as unknown as typeof Star, body: `${rec.stats.goals} ${rec.stats.goals === 1 ? 'gol' : 'gols'} na temporada` })
    else if (gk && (rec.stats.cleanSheets ?? 0) > 0) facts.push({ key: 'sg', tone: 'gold', icon: Star, body: `${rec.stats.cleanSheets} jogos sem sofrer gol` })
    if (rec.captain) facts.push({ key: 'cap', tone: 'gold', icon: Sparkles, body: 'Capitão do time' })
  }

  const share = async () => {
    const text = `${state?.identity.surname ?? 'Meu jogador'} é ${hero.kicker.split(' · ')[0].toLowerCase()} (${hero.name} ${hero.year}) no LENDA ⚽🏆`
    try {
      if (navigator.share) await navigator.share({ title: 'LENDA', text })
      else {
        await navigator.clipboard.writeText(text)
        toast.success('Copiado!', 'Cole onde quiser para compartilhar.')
      }
    } catch {
      /* cancelled */
    }
  }

  const vars = {
    ['--club' as string]: colors.primary,
    ['--club-glow' as string]: colors.glow,
    ['--cel-a' as string]: rel ? '#b91c1c' : '#ffd66e',
  } as CSSProperties
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  const heroH = Math.round(Math.max(150, Math.min(wide ? 320 : 220, vh * (wide ? 0.34 : 0.27))))
  const d = (ms: number) => (rm ? 0 : ms / 1000)

  return (
    <motion.div
      className={cx('ck-cel', rel && 'is-rel', lowFx && 'is-lowfx')}
      style={vars}
      role="dialog"
      aria-modal="true"
      aria-label={items.map((i) => i.name).join(', ')}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: rm ? 0 : 0.24 } }}
      transition={{ duration: d(240) }}
      onClick={onClose}
    >
      <span className="lx-veil ck-cel__veil" aria-hidden="true" />
      {!rel && <motion.span className="lx-beam ck-cel__beam" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: d(120), duration: d(800) }} />}
      {!lowFx && <motion.span className={cx('lx-rays lx-rays--celebration ck-cel__rays')} aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: rel ? 0.35 : 1 }} transition={{ delay: d(120), duration: d(800) }} />}
      <span className="lx-outline-word ck-cel__word" aria-hidden="true">
        {rel ? 'REBAIXADO' : hero.kind === 'award' ? 'LENDA' : 'CAMPEÃO'}
      </span>
      <Burst rel={rel} />

      {/* corners */}
      <div className="ck-cel__corner-r" onClick={(e) => e.stopPropagation()}>
        <IconButton label={sound ? 'Desativar som' : 'Ativar som'} icon={sound ? Volume2 : VolumeX} onClick={() => toggle('sound')} />
        <IconButton label="Fechar celebração" icon={X} onClick={onClose} />
      </div>
      {wide && rest.length > 0 && (
        <motion.div className="ck-cel__also" initial={rm ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: d(1000), duration: d(420), ease: EASE }}>
          {rest.slice(0, 4).map(({ it, n, years }) => (
            <span key={it.key} className="lx-glass-tag ck-cel__also-item">
              <TrophyArt id={it.art} size={30} trophy={it.trophy} className="lx-trophy" />
              <span>
                <span className="lx-eyebrow">Também em {years.join(' · ')}</span>
                <b>{n > 1 ? `${n}x ${it.name}` : it.name}</b>
              </span>
            </span>
          ))}
        </motion.div>
      )}

      <div className="ck-cel__col">
        {pill && (
          <motion.span className="lx-pill-gold ck-cel__pill" initial={rm ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: d(200), duration: d(420), ease: EASE }}>
            <Trophy aria-hidden="true" /> {pill}
          </motion.span>
        )}
        <div className={cx('ck-cel__hero lx-trophy-glow', rel && 'is-rel')} style={{ height: heroH }}>
          <motion.span className="ck-cel__art" initial={rm ? false : { y: 60, scale: 0.86, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} transition={{ delay: d(200), duration: d(1100), ease: EASE }}>
            {rel ? (
              <span className="ck-cel__rel" aria-hidden="true">
                <ArrowDown />
              </span>
            ) : (
              <TrophyArt id={hero.art} size={heroH} trophy={hero.trophy} className="lx-trophy lx-trophy--hero" title={hero.name} />
            )}
          </motion.span>
          {!rel && <span className="ck-cel__glint" aria-hidden="true" />}
        </div>
        <span className={cx('lx-floor ck-cel__floor', rel && 'is-rel')} aria-hidden="true" />
        <motion.p className="ck-cel__kicker" initial={rm ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: d(620), duration: d(420), ease: EASE }}>
          <span aria-hidden="true" />
          {hero.kicker}
          <span aria-hidden="true" />
        </motion.p>
        <motion.h2 className={cx('ck-cel__title', rel ? 'is-rel' : 'lx-chrome-text')} initial={rm ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: d(700), duration: d(420), ease: EASE }}>
          {hero.name}
        </motion.h2>
        {hero.subtitle && (
          <motion.p className="ck-cel__sub" initial={rm ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: d(780), duration: d(420), ease: EASE }}>
            {hero.subtitle}
          </motion.p>
        )}
        {(!wide && rest.length > 0) && (
          <motion.div className="ck-cel__row" initial={rm ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: d(860), duration: d(300) }}>
            {rest.slice(0, 5).map(({ it, n, years }) => (
              <span key={it.key} className="ck-cel__rowitem" title={`${it.name} ${years.join(', ')}`}>
                <TrophyArt id={it.art} size={40} trophy={it.trophy} className="lx-trophy" />
                <span>{n > 1 ? `${n}x ${it.name}` : it.name}</span>
              </span>
            ))}
          </motion.div>
        )}
        {facts.length > 0 && (
          <div className="ck-cel__facts">
            {facts.map((f, i) => (
              <motion.span key={f.key} className={cx('lx-glass-tag ck-cel__fact', `is-${f.tone}`)} initial={rm ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: d(880 + i * 80), duration: d(300), ease: EASE }}>
                <span className="ck-cel__fact-ic">
                  <f.icon aria-hidden="true" />
                </span>
                {f.body}
              </motion.span>
            ))}
          </div>
        )}
        <motion.div
          className="ck-cel__actions"
          initial={rm ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: d(ENTRANCE), duration: d(300) }}
          onClick={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.pointerType === 'mouse' && !paused && setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={(e) => (e.target as HTMLElement) !== continueRef.current && setPaused(true)}
        >
          <Button ref={continueRef} variant="primary" size="lg" iconRight={ArrowRight} onClick={onClose} className="ck-cel__continue">
            Continuar
            {!paused && !rm && <span className="ck-cel__timer" style={{ animationDuration: `${CELEBRATION_HOLD}ms`, animationDelay: `${ENTRANCE}ms` }} aria-hidden="true" />}
          </Button>
          {!rel && (
            <Button variant="ghost" size="lg" icon={Share} onClick={share} aria-label="Compartilhar momento">
              <span className="ck-cel__share-l">Compartilhar momento</span>
              <span className="ck-cel__share-s" aria-hidden="true">
                Compartilhar
              </span>
            </Button>
          )}
        </motion.div>
      </div>
    </motion.div>
  )
})

/** Copero `$c`: 18 particles, 20° apart, 112/136/160 px, 0–72 ms delays. */
function Burst({ rel }: { rel: boolean }) {
  const colors = rel ? ['#ef4444', '#991b1b', '#fecaca'] : ['#facc15', '#fb923c', '#f8fafc', '#38bdf8']
  return (
    <span className="ck-cel__burst" aria-hidden="true">
      <span className={cx('ck-cel__burst-glow', rel && 'is-rel')} />
      {Array.from({ length: 18 }, (_, e) => {
        const angle = e * 20
        const style = {
          ['--a' as string]: `${angle}deg`,
          ['--dist' as string]: `${112 + (e % 3) * 24}px`,
          ['--delay' as string]: `${(e % 4) * 24}ms`,
          ['--c' as string]: rel ? colors[angle % 3] : colors[e % 4],
        } as CSSProperties
        return <i key={e} style={style} />
      })}
    </span>
  )
}
