/**
 * Trophy celebration overlay (DESIGN-SPEC §10.5 + Copero `_t`): the cockpit blurs underneath,
 * warm veil + beam + god rays, the hero trophy rises on a lit floor with a breathing glow and a
 * glint, 18 burst particles + canvas-confetti (2 bursts), kicker · chrome title · sub · facts,
 * "Continuar". Auto-dismisses 1800 ms after it settles (paused while hovered, and for good once the
 * content is touched or scrolled); a click on the veil, Esc or Space dismiss it. Several titles: one
 * figure per trophy (LaLiga ×3), at most 3 side by side on a phone. Relegation variant: red glow
 * and particles, no confetti.
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, ArrowRight, Copy, Share, Sparkles, Star, TrendingDown, TrendingUp, Trophy, Volume2, VolumeX, X } from 'lucide-react'
import { useApp } from '@/store/app'
import { useCareer } from '@/store/career'
import { useClub } from '@/store/data'
import { BallIcon, Button, IconButton, Modal, OvrPill, clubColors, cx, plural, toast, useIsWide, useMediaQuery, useReducedMotion } from '@/ui/primitives'
import { darken, lighten } from '@/ui/theme/club'
import { TrophyArt } from '@/ui/trophies'
import { careerTotals, isKeeper, seasonLabel } from '@/ui/classic/cockpit/model'
import { director } from '@/ui/classic/reveal/director'
import { CELEBRATION_HOLD, useReveal } from '@/ui/classic/reveal/store'
import { celebrationHeadline, celebrationKicker, celebrationPill, celebrationSeasons, groupCelebration, multiSubtitle, type CelebrationItem } from './items'

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
  const phone = useMediaQuery('(max-width: 575.98px)')
  const hero = items[0]
  const rel = hero.kind === 'relegation'
  const club = useClub(hero.scope === 'club' ? hero.teamId : null)
  const colors = clubColors(club ?? null)
  const state = useCareer((s) => s.state)
  const reveal = useCareer((s) => s.reveal)
  // todos os títulos do período aparecem juntos, lado a lado (dobradinha, tríplice coroa…) — uma
  // figura por taça (LaLiga ×3), até 4 lado a lado (3 no celular) e o resto numa fileira menor
  const multi = !rel && items.length > 1
  const groups = groupCelebration(items)
  const MULTI_MAX = phone ? 3 : 4
  const shown = multi ? groups.slice(0, MULTI_MAX) : [{ ...hero, count: 1, years: [hero.year] }]
  const extra = multi ? groups.slice(MULTI_MAX) : []
  const multiTitle = multi ? celebrationHeadline(items) : null
  const severalSeasons = celebrationSeasons(items) > 1
  // pausa: mouse sobre os botões (volta ao sair); toque, rolagem ou o diálogo de compartilhar (até fechar)
  const [hover, setHover] = useState(false)
  const [held, setHeld] = useState(false)
  const [shareText, setShareText] = useState<string | null>(null)
  const paused = hover || held || !!shareText
  const continueRef = useRef<HTMLButtonElement>(null)

  // auto-dismiss after the entrance + hold
  useEffect(() => {
    if (paused) return
    const t = setTimeout(onClose, (rm ? 200 : ENTRANCE) + CELEBRATION_HOLD + (shown.length - 1) * 900)
    return () => clearTimeout(t)
  }, [paused, onClose, rm, shown.length])

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
  const pill = celebrationPill(items, totals?.titles)
  const rec = hero.record
  const gk = isKeeper(state?.identity.position)
  // num período de várias temporadas, os números são da temporada do troféu principal: diz qual
  const inSeason = rec && severalSeasons ? `em ${seasonLabel(rec)}` : 'na temporada'
  const facts: { key: string; tone: 'gold' | 'pos' | 'neg'; icon: typeof Star; body: React.ReactNode }[] = []
  if (reveal && reveal.ovrAfter !== reveal.ovrBefore)
    facts.push({
      key: 'ovr',
      tone: reveal.ovrAfter > reveal.ovrBefore ? 'pos' : 'neg',
      icon: reveal.ovrAfter > reveal.ovrBefore ? TrendingUp : TrendingDown,
      body: (
        <>
          OVR <OvrPill ovr={reveal.ovrBefore} size="xs" /> <ArrowRight className="ck-cel__arrow" aria-hidden="true" /> <OvrPill ovr={reveal.ovrAfter} size="xs" />
        </>
      ),
    })
  if (rec && !rel) {
    const scorer = rec.awards.find((a) => a.award === 'league_top_scorer' && a.place === 1)
    if (scorer) facts.push({ key: 'art', tone: 'gold', icon: Star, body: `Artilheiro da liga · ${plural(rec.stats.goals, 'gol', 'gols')}${severalSeasons ? ` ${inSeason}` : ''}` })
    else if (!gk && rec.stats.goals > 0) facts.push({ key: 'g', tone: 'gold', icon: BallIcon as unknown as typeof Star, body: `${plural(rec.stats.goals, 'gol', 'gols')} ${inSeason}` })
    else if (gk && (rec.stats.cleanSheets ?? 0) > 0) facts.push({ key: 'sg', tone: 'gold', icon: Star, body: `${plural(rec.stats.cleanSheets ?? 0, 'jogo', 'jogos')} sem sofrer gol` })
    if (rec.captain) facts.push({ key: 'cap', tone: 'gold', icon: Sparkles, body: 'Capitão do time' })
  }

  const share = async () => {
    const who = state?.identity.surname ?? 'Meu jogador'
    const text = multi && multiTitle ? `${who}: ${multiTitle.toLowerCase()} no LENDA — ${multiSubtitle(items)} ⚽🏆` : `${who} é ${hero.kicker.split(' · ')[0].toLowerCase()} (${hero.name} ${hero.year}) no LENDA ⚽🏆`
    setHeld(true)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'LENDA', text })
        return
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return // a pessoa fechou a folha de compartilhar
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copiado!', 'Cole onde quiser para compartilhar.')
    } catch {
      // sem Web Share e sem área de transferência (ex.: dentro do claude.ai): o texto para copiar à mão
      setShareText(text)
    }
  }

  const vars = {
    ['--club' as string]: colors.primary,
    ['--club-glow' as string]: colors.glow,
    ['--cel-a' as string]: rel ? '#b91c1c' : '#ffd66e',
  } as CSSProperties
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900
  const heroH = Math.round(Math.max(150, Math.min(wide ? 320 : 220, vh * (wide ? 0.34 : 0.27))))
  /** Altura de cada taça lado a lado: no celular cabem 3 numa linha, sem empurrar os botões para fora da tela. */
  const multiH = (n: number) => (phone ? Math.round(Math.max(96, vh * (n === 1 ? 0.24 : n === 2 ? 0.19 : 0.16))) : Math.round(heroH * (n === 1 ? 1 : n === 2 ? 0.86 : n === 3 ? 0.74 : 0.62)))
  const d = (ms: number) => (rm ? 0 : ms / 1000)

  return (
    <motion.div
      className={cx('ck-cel', rel && 'is-rel', lowFx && 'is-lowfx')}
      style={vars}
      role="dialog"
      aria-modal="true"
      aria-label={groups.map((g) => (g.count > 1 ? `${g.name} (${g.count} vezes)` : g.name)).join(', ')}
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
      <div
        className="ck-cel__col"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={() => setHeld(true)}
        onScroll={() => setHeld(true)}
        onPointerDown={(e) => e.pointerType !== 'mouse' && setHeld(true)}
      >
        {pill && (
          <motion.span className="lx-pill-gold ck-cel__pill" initial={rm ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: d(200), duration: d(420), ease: EASE }}>
            <Trophy aria-hidden="true" /> {pill}
          </motion.span>
        )}
        {multi ? (
          <div className="ck-cel__multi lx-trophy-glow" style={{ ['--n' as string]: shown.length } as CSSProperties}>
            {shown.map((it, i) => {
              const h = Math.round(multiH(shown.length) * (i === 0 ? 1 : 0.92))
              return (
                <motion.figure
                  key={it.key}
                  className={cx('ck-cel__mitem', i === 0 && 'is-first')}
                  initial={rm ? false : { y: 50, scale: 0.86, opacity: 0 }}
                  animate={{ y: 0, scale: 1, opacity: 1 }}
                  transition={{ delay: d(200 + i * 160), duration: d(1000), ease: EASE }}
                >
                  <span className="ck-cel__mart" style={{ height: h }}>
                    <TrophyArt id={it.art} size={h} trophy={it.trophy} className="lx-trophy lx-trophy--hero" title={it.name} />
                    {it.count > 1 && <span className="lx-count lx-count--gold ck-cel__mx">×{it.count}</span>}
                  </span>
                  <figcaption>
                    <b>{it.name}</b>
                    <small>
                      {it.kind === 'award' ? 'Prêmio individual' : (it.teamName ?? '')}
                      {severalSeasons || it.count > 1 ? ` · ${it.years.join(' · ')}` : ''}
                    </small>
                  </figcaption>
                </motion.figure>
              )
            })}
          </div>
        ) : (
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
        )}
        <span className={cx('lx-floor ck-cel__floor', rel && 'is-rel')} aria-hidden="true" />
        <motion.p className="ck-cel__kicker" initial={rm ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: d(620), duration: d(420), ease: EASE }}>
          <span aria-hidden="true" />
          {multi ? celebrationKicker(items) : hero.kicker}
          <span aria-hidden="true" />
        </motion.p>
        <motion.h2 className={cx('ck-cel__title', rel ? 'is-rel' : 'lx-chrome-text')} initial={rm ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: d(700), duration: d(420), ease: EASE }}>
          {multi ? multiTitle : hero.name}
        </motion.h2>
        {multi && (
          <motion.p className="ck-cel__sub" initial={rm ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: d(780), duration: d(420), ease: EASE }}>
            {multiSubtitle(items)}
          </motion.p>
        )}
        {!multi && hero.subtitle && (
          <motion.p className="ck-cel__sub" initial={rm ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: d(780), duration: d(420), ease: EASE }}>
            {hero.subtitle}
          </motion.p>
        )}
        {extra.length > 0 && (
          <motion.div className="ck-cel__row" initial={rm ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: d(860), duration: d(300) }}>
            {extra.map((it) => (
              <span key={it.key} className="ck-cel__rowitem" title={`${it.name} ${it.years.join(', ')}`}>
                <TrophyArt id={it.art} size={40} trophy={it.trophy} className="lx-trophy" />
                <span>
                  {it.name}
                  {it.count > 1 ? ` ×${it.count}` : ''}
                </span>
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
          onPointerMove={(e) => e.pointerType === 'mouse' && !hover && setHover(true)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
          onFocus={(e) => (e.target as HTMLElement) !== continueRef.current && setHeld(true)}
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
          {/* dentro dos botões (que param o clique): um clique no diálogo não fecha a celebração */}
          <ShareTextDialog text={shareText} onClose={() => setShareText(null)} />
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

/** Sem Web Share nem área de transferência (iframe do claude.ai): o texto, selecionado, para copiar à mão. */
function ShareTextDialog({ text, onClose }: { text: string | null; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const copy = () => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    if (ok) {
      toast.success('Copiado!', 'Cole onde quiser para compartilhar.')
      onClose()
    } else toast.info('Texto selecionado', 'Use Ctrl+C (ou toque e segure → Copiar).')
  }
  return (
    <Modal
      open={!!text}
      onClose={onClose}
      size="sm"
      title="Compartilhar momento"
      description="Aqui o navegador não abre o compartilhamento. Copie o texto e cole onde quiser."
      initialFocusRef={ref}
      footer={
        <div className="flex gap-2 justify-end w-full">
          <Button variant="ghost" size="md" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="primary" size="md" icon={Copy} onClick={copy}>
            Copiar texto
          </Button>
        </div>
      }
    >
      <textarea ref={ref} className="lx-input ck-cel__sharetext" readOnly value={text ?? ''} rows={3} onFocus={(e) => e.currentTarget.select()} aria-label="Texto para compartilhar" />
    </Modal>
  )
}
