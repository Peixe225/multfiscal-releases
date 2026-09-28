/**
 * "Evolução do OVR" — SVG line chart by age (DESIGN-SPEC-noite §10.7).
 *
 * Layers: tier bands (bronze/prata/ouro/lenda) · gridlines · area · tier-coloured line (+ glow) ·
 * points · Bola de Ouro / Copa do Mundo markers · transfer markers · "PICO" label · crosshair +
 * tooltip (pointer, touch and keyboard ←/→) · club strip under the plot.
 * Drawn in pixels (ResizeObserver) so strokes never stretch; the line draws itself on mount.
 */
import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { motion } from 'motion/react'
import { getClub } from '@/store/data'
import { BallIcon, Crest, OvrPill, TIER_CHART, cx, rowClubVars, tierOf, useReducedMotion, useSkipAnimations, useSvgId, type OvrTier } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import type { ChartPoint, Spell } from './model'

const TIERS: [number, number, OvrTier, string][] = [
  [0, 70, 'bronze', 'BRONZE'],
  [70, 80, 'silver', 'PRATA'],
  [80, 90, 'gold', 'OURO'],
  [90, 100, 'lenda', 'LENDA'],
]

export const OvrChart = memo(function OvrChart({
  points,
  spells,
  finished,
  height = 356,
}: {
  points: ChartPoint[]
  spells: Spell[]
  finished: boolean
  height?: number
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(760)
  const [hover, setHover] = useState<number | null>(null)
  const rm = useReducedMotion()
  const skip = useSkipAnimations()
  const still = rm || skip
  const uid = useSvgId('ovr')

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth)))
    ro.observe(el)
    setW(Math.max(280, el.clientWidth))
    return () => ro.disconnect()
  }, [])

  const compact = w < 560
  const H = compact ? Math.min(height, 260) : height
  const pad = { l: compact ? 28 : 34, r: compact ? 12 : 60, t: 24, b: 24 }
  const a0 = points[0]?.age ?? 16
  const last = points[points.length - 1]?.age ?? a0 + 1
  const a1 = Math.max(a0 + 1, finished ? last : Math.max(last, 39))
  const minOvr = Math.min(...points.map((p) => p.ovr), 60)
  const yMin = Math.min(50, Math.floor((minOvr - 3) / 10) * 10)
  const yMax = 100
  const pw = w - pad.l - pad.r
  const ph = H - pad.t - pad.b
  const x = (age: number) => pad.l + ((age - a0) / (a1 - a0)) * pw
  const y = (v: number) => pad.t + ((yMax - v) / (yMax - yMin)) * ph
  const step = pw / (a1 - a0)

  const geo = useMemo(() => {
    const pts = points.map((p) => [x(p.age), y(p.ovr)] as const)
    const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
    const area = pts.length ? `${line}L${pts[pts.length - 1][0].toFixed(1)},${(pad.t + ph).toFixed(1)}L${pts[0][0].toFixed(1)},${(pad.t + ph).toFixed(1)}Z` : ''
    let peak = 0
    points.forEach((p, i) => {
      if (p.ovr > points[peak].ovr) peak = i
    })
    return { pts, line, area, peak }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, w, H, a0, a1, yMin])

  const stops = TIERS.map(([lo, hi, t]) => [Math.max(lo, yMin), Math.min(hi, yMax), t] as const).filter(([lo, hi]) => hi > lo)
  const off = (v: number) => (v - yMin) / (yMax - yMin)
  const transfers = spells.slice(1).filter((s, i) => !s.loan && spells[i].clubId !== s.clubId)
  let lastLabelX = -999
  const peak = points[geo.peak]
  const hp = hover != null ? points[hover] : null

  const pick = (clientX: number) => {
    const el = wrap.current
    if (!el || !points.length) return
    const r = el.getBoundingClientRect()
    const age = a0 + ((clientX - r.left - pad.l) / pw) * (a1 - a0)
    let best = 0
    points.forEach((p, i) => {
      if (Math.abs(p.age - age) < Math.abs(points[best].age - age)) best = i
    })
    setHover(best)
  }
  const onKey = (e: KeyboardEvent) => {
    if (!points.length) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const d = e.key === 'ArrowRight' ? 1 : -1
      setHover((h) => Math.max(0, Math.min(points.length - 1, (h ?? (d > 0 ? -1 : points.length)) + d)))
    } else if (e.key === 'Home') setHover(0)
    else if (e.key === 'End') setHover(points.length - 1)
    else if (e.key === 'Escape') setHover(null)
  }

  const ariaLabel = points.length
    ? `Evolução do OVR: ${points[0].ovr} aos ${points[0].age} anos, pico ${peak.ovr} aos ${peak.age}, ${points[points.length - 1].ovr} aos ${points[points.length - 1].age}. Use as setas para percorrer as temporadas.`
    : 'Evolução do OVR'

  return (
    <div className="sm-chart">
      <div
        ref={wrap}
        className="sm-chart__plot"
        style={{ height: H }}
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        onKeyDown={onKey}
        onPointerMove={(e: PointerEvent) => pick(e.clientX)}
        onPointerDown={(e: PointerEvent) => pick(e.clientX)}
        onPointerLeave={(e: PointerEvent) => e.pointerType === 'mouse' && setHover(null)}
        onBlur={() => setHover(null)}
      >
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} aria-hidden="true">
          <defs>
            <linearGradient id={`${uid}-ar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".16" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-ln`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={y(yMin)} y2={y(yMax)}>
              {stops.flatMap(([lo, hi, t]) => [
                <stop key={`${t}a`} offset={off(lo)} stopColor={TIER_CHART[t].line} />,
                <stop key={`${t}b`} offset={off(hi)} stopColor={TIER_CHART[t].line} />,
              ])}
            </linearGradient>
            <filter id={`${uid}-gl`} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
            <clipPath id={`${uid}-cp`}>
              <rect x={pad.l} y={pad.t - 14} width={pw + 2} height={ph + 14} />
            </clipPath>
          </defs>
          {/* tier bands */}
          {stops.map(([lo, hi, t]) => (
            <g key={t}>
              <rect x={pad.l} y={y(hi)} width={pw} height={y(lo) - y(hi)} fill={TIER_CHART[t].band} />
              {!compact && (
                <text x={pad.l + pw + 10} y={y(hi) + 14} className="sm-chart__tier">
                  {TIERS.find((z) => z[2] === t)![3]}
                </text>
              )}
            </g>
          ))}
          {/* grid */}
          {Array.from({ length: (yMax - yMin) / 10 + 1 }, (_, i) => yMin + i * 10).map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={pad.l + pw} y1={y(v)} y2={y(v)} className="sm-chart__grid" />
              <text x={pad.l - 8} y={y(v) + 3.5} textAnchor="end" className="sm-chart__ax">
                {v}
              </text>
            </g>
          ))}
          {Array.from({ length: a1 - a0 + 1 }, (_, i) => a0 + i)
            .filter((a) => (a - a0) % (compact ? 6 : 4) === 0 || a === a1)
            .map((a) => (
              <text key={a} x={x(a)} y={H - 6} textAnchor="middle" className="sm-chart__ax">
                {a}
              </text>
            ))}
          {/* future (career in progress) */}
          {!finished && last < a1 && <rect x={x(last)} y={pad.t} width={x(a1) - x(last)} height={ph} className="sm-chart__future" />}
          {/* transfers */}
          {transfers.map((s) => {
            const tx = x(s.fromAge)
            const show = !compact && tx - lastLabelX > 86 && tx < pad.l + pw - 40
            if (show) lastLabelX = tx
            return (
              <g key={`${s.clubId}-${s.from}`}>
                <line x1={tx} x2={tx} y1={pad.t} y2={pad.t + ph} className="sm-chart__tr" />
                {show && (
                  <text x={tx + 5} y={pad.t + ph - 7} className="sm-chart__trl">
                    {getClub(s.clubId)?.shortName ?? ''}
                  </text>
                )}
              </g>
            )
          })}
          <g clipPath={`url(#${uid}-cp)`}>
            <motion.path d={geo.area} fill={`url(#${uid}-ar)`} initial={still ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.6 }} />
            <motion.path
              d={geo.line}
              fill="none"
              stroke={`url(#${uid}-ln)`}
              strokeWidth="6"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity=".35"
              filter={`url(#${uid}-gl)`}
              initial={still ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
            />
            <motion.path
              d={geo.line}
              fill="none"
              stroke={`url(#${uid}-ln)`}
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
              initial={still ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
            />
          </g>
          {/* points + markers */}
          {geo.pts.map(([px, py], i) => {
            const p = points[i]
            const mk = p.ballon === 1 ? 'bdo' : p.worldCup ? 'wc' : null
            const delay = still ? 0 : 0.2 + (i / Math.max(1, points.length)) * 1.2
            return (
              <motion.g
                key={p.season}
                initial={still ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay }}
                style={{ transformOrigin: `${px}px ${py}px` } as CSSProperties}
              >
                {mk && <circle cx={px} cy={py} r="9" className={cx('sm-chart__mk', `is-${mk}`)} />}
                <circle cx={px} cy={py} r={mk ? 4 : 3} className={cx('sm-chart__pt', mk && `is-${mk}`)} />
              </motion.g>
            )
          })}
          {/* peak */}
          {peak && (
            <motion.g initial={still ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: still ? 0 : 1.3 }}>
              <text x={x(peak.age)} y={y(peak.ovr) - 14} textAnchor="middle" className="sm-chart__peak">
                PICO {peak.ovr}
              </text>
            </motion.g>
          )}
          {/* crosshair */}
          {hp && (
            <g>
              <line x1={x(hp.age)} x2={x(hp.age)} y1={pad.t} y2={pad.t + ph} className="sm-chart__cross" />
              <circle cx={x(hp.age)} cy={y(hp.ovr)} r="6" className="sm-chart__dot" />
            </g>
          )}
        </svg>
        {hp && <ChartTip p={hp} left={x(hp.age)} top={y(hp.ovr)} w={w} />}
      </div>
      <ClubStrip spells={spells} x={x} step={step} left={pad.l} width={pw} />
    </div>
  )
})

function ChartTip({ p, left, top, w }: { p: ChartPoint; left: number; top: number; w: number }) {
  const club = getClub(p.clubId)
  const flip = left > w - 230
  return (
    <div className="lx-tooltip sm-tip" style={{ left, top, transform: `translate(${flip ? 'calc(-100% - 16px)' : '16px'}, ${top < 110 ? '8px' : '-50%'})` }} role="status" aria-live="polite">
      <div className="sm-tip__t1">
        <Crest club={club} size={18} decorative />
        <b>{club?.shortName ?? club?.name ?? ''}</b>
        {p.loan && <span className="sm-tip__loan">emp.</span>}
        <span className="sm-tip__y">
          {p.season} · {p.age} anos
        </span>
      </div>
      <div className="sm-tip__t2">
        <OvrPill ovr={p.ovr} size="sm" />
        <span>
          <b className="num">{p.goals}</b> gols em <b className="num">{p.apps}</b> jogos
        </span>
      </div>
      {(p.ballon || p.trophies.length > 0) && (
        <div className="sm-tip__t3">
          {p.ballon && (
            <span className="lx-tag lx-tag--gold">
              <BallIcon aria-hidden="true" /> Bola de Ouro {p.ballon > 1 ? `${p.ballon}º` : ''}
            </span>
          )}
          {p.trophies.slice(0, 4).map((t, i) => (
            <span key={t + i} className="sm-tip__trophy">
              <TrophyArt id={t} size={18} variant="svg" />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ClubStrip({ spells, x, step, left, width }: { spells: Spell[]; x: (a: number) => number; step: number; left: number; width: number }) {
  return (
    <div className="sm-strip" style={{ marginLeft: left - step / 2 + 1, width: width + step - 2 }} aria-label="Clubes por idade">
      {spells.map((s) => {
        const club = getClub(s.clubId)
        const l = x(s.fromAge) - left
        const wd = step * s.seasons - 3
        return (
          <span
            key={`${s.clubId}-${s.from}`}
            className={cx('lx-club-strip sm-strip__seg', s.loan && 'is-loan')}
            style={{ left: l, width: Math.max(8, wd), ...rowClubVars(club) }}
            title={`${club?.name ?? ''} · ${s.fromAge}–${s.toAge} anos${s.loan ? ' (empréstimo)' : ''}`}
          >
            {wd > 22 && <Crest club={club} size={15} decorative />}
            {wd > 96 && <span className="sm-strip__n">{club?.shortName}</span>}
          </span>
        )
      })}
    </div>
  )
}
