/**
 * Vitrine (`.lx-shelf`): trophies grouped by kind with ×N, Copero ordering (national → club →
 * awards) and overlap formula (§8.3, scaled to the measured width). Hover / focus fans a group
 * out and dims the others; "Ver todas" opens the trophy room. New items drop in (spring).
 */
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Trophy } from 'lucide-react'
import { Modal, cx, useMediaQuery, useReducedMotion } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import { groupLabel, trophyGroups, type TrophyGroup } from './model'
import type { CockpitData } from './view'

const ASPECT = 0.66 // typical trophy art width / height (ballon / boot are wider)

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    setW(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

interface Layout {
  groups: TrophyGroup[]
  hidden: number
  h: number
  overlap: number
}

/** Copero `Ir` overlap: gap shrinks with the count, stacked copies share what is left. */
function layout(all: TrophyGroup[], width: number, baseH: number, maxGroups: number): Layout {
  if (!all.length || width <= 0) return { groups: all.slice(0, maxGroups), hidden: Math.max(0, all.length - maxGroups), h: baseH, overlap: baseH * ASPECT * 0.4 }
  let groups = all.slice(0, maxGroups)
  let h = baseH
  const gapFor = (F: number, D: number) => (F >= 16 || D >= 6 ? 2 : F >= 12 || D >= 5 ? 4 : F >= 8 || D >= 4 ? 6 : 8)
  const badge = all.some((g) => g.items.length > 1) ? 16 : 0
  width = width - badge
  const fits = (gs: TrophyGroup[], hh: number) => gs.length * hh * ASPECT + (gs.length - 1) * gapFor(gs.length, gs.length) * 2 <= width
  while (h > baseH * 0.7 && !fits(groups, h)) h -= 2
  while (groups.length > 1 && !fits(groups, h)) groups = groups.slice(0, -1)
  const D = groups.length
  const F = groups.reduce((a, g) => a + g.items.length, 0)
  const itemW = h * ASPECT
  const gap = gapFor(F, D) * 2
  const L = F - D
  const free = width - D * itemW - (D - 1) * gap
  const slice = L > 0 ? Math.min(itemW * 0.62, Math.max(6, free / L)) : itemW * 0.62
  return { groups, hidden: all.length - groups.length, h, overlap: Math.max(0, itemW - slice) }
}

export const TrophyShowcase = memo(function TrophyShowcase({ data }: { data: CockpitData }) {
  const groups = useMemo(() => trophyGroups(data.trophySeasons), [data.trophySeasons])
  const total = groups.reduce((a, g) => a + g.items.length, 0)
  const phone = !useMediaQuery('(min-width: 36rem)')
  const [rowRef, width] = useWidth<HTMLDivElement>()
  const L = layout(groups, width, phone ? 46 : 70, phone ? 4 : 12)
  const [hover, setHover] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const rm = useReducedMotion()

  // items present at mount never animate; later arrivals drop in
  const seen = useRef<Set<string> | null>(null)
  if (seen.current === null) seen.current = new Set(groups.flatMap((g) => g.items.map((i) => i.key)))
  const fresh = (k: string) => !seen.current!.has(k)
  useLayoutEffect(() => {
    const s = seen.current!
    const t = setTimeout(() => groups.forEach((g) => g.items.forEach((i) => s.add(i.key))), 1200)
    return () => clearTimeout(t)
  }, [groups])

  return (
    <section className="lx-shelf ck-shelf" aria-label={`Vitrine: ${total} ${total === 1 ? 'troféu' : 'troféus'}`}>
      <div className="ck-shelf__h">
        <span className="lx-eyebrow">
          Vitrine <b className="ck-shelf__n num">{total}</b>
        </span>
        {total > 0 && (
          <button type="button" className="ck-link" onClick={() => setOpen(true)}>
            Ver todas <ArrowRight aria-hidden="true" />
          </button>
        )}
      </div>
      <div ref={rowRef} className={cx('ck-shelf__row', L.groups.length <= 2 && 'is-few')} onMouseLeave={() => setHover(null)}>
        {groups.length === 0 ? (
          <div className="ck-shelf__empty">
            <Trophy aria-hidden="true" />
            <span>Vitrine vazia</span>
          </div>
        ) : (
          <>
            {L.groups.map((g, gi) => {
              const h = g.minor ? Math.round(L.h * 0.83) : L.h
              const on = hover === g.key
              const ov = g.items.length > 1 ? (on ? Math.max(4, L.overlap - 8 - h * 0.12) : L.overlap) : 0
              const label = groupLabel(g)
              return (
                <button
                  key={g.key}
                  type="button"
                  className={cx('ck-tg lx-trophy-spot', g.family === 'world_cup' && 'lx-trophy-spot--gold', hover && !on && 'is-dim', on && 'is-on')}
                  style={{ ['--spot' as string]: `${Math.round(h * 1.3)}px`, zIndex: on ? 20 : 10 - Math.min(gi, 9) }}
                  aria-label={`${label}: ${g.items.map((i) => i.year).join(', ')}`}
                  onMouseEnter={() => setHover(g.key)}
                  onFocus={() => setHover(g.key)}
                  onBlur={() => setHover(null)}
                  onClick={() => setOpen(true)}
                >
                  <span className="ck-tg__stack" style={{ height: h }}>
                    {g.items.map((it, i) => (
                      <motion.span
                        key={it.key}
                        className="ck-tg__item"
                        style={{ marginLeft: i ? -ov : 0, zIndex: g.items.length - i }}
                        initial={fresh(it.key) && !rm ? { y: -14, opacity: 0, scale: 0.8 } : false}
                        animate={{ y: 0, opacity: 1, scale: 1, marginLeft: i ? -ov : 0 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 24, delay: fresh(it.key) ? 0.08 * i : 0 }}
                      >
                        <TrophyArt id={it.art} size={h} trophy={it.trophy} className="lx-trophy" />
                      </motion.span>
                    ))}
                  </span>
                  {g.items.length > 1 && <span className={cx('lx-count ck-tg__count', g.scope !== 'club' && 'lx-count--gold')}>×{g.items.length}</span>}
                  <span className="ck-tg__label" aria-hidden="true">
                    {label}
                  </span>
                </button>
              )
            })}
            {L.hidden > 0 && (
              <button type="button" className="ck-tg__more" onClick={() => setOpen(true)} aria-label={`Mais ${L.hidden} grupos de troféus`}>
                +{L.hidden}
              </button>
            )}
          </>
        )}
      </div>
      <TrophyRoom open={open} onClose={() => setOpen(false)} groups={groups} total={total} />
    </section>
  )
})

/** "Sala de troféus" — every group with its years. */
function TrophyRoom({ open, onClose, groups, total }: { open: boolean; onClose: () => void; groups: TrophyGroup[]; total: number }) {
  return (
    <Modal open={open} onClose={onClose} title="Sala de troféus" description={`${total} ${total === 1 ? 'troféu' : 'troféus'} na carreira`} size="lg">
      <ul className="ck-room">
        {groups.map((g) => (
          <li key={g.key} className="ck-room__item lx-trophy-spot" style={{ ['--spot' as string]: '110px' }}>
            <span className="ck-room__art">
              <TrophyArt id={g.art} size={76} trophy={g.trophy} className="lx-trophy lx-trophy--card" />
              {g.items.length > 1 && <span className="lx-count lx-count--gold ck-room__count">×{g.items.length}</span>}
            </span>
            <span className="ck-room__name">{g.name}</span>
            <span className="ck-room__years">{g.items.map((i) => i.year).join(' · ')}</span>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
