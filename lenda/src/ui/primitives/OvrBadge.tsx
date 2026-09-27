/**
 * OVR rating in FUT metal (DESIGN-SPEC-noite §8) + LENDA grades (90 Lenda · 95 Elite · 99 Ícone).
 *
 *   <OvrBadge ovr={87} size="xl" delta={2} />                     // career hero (100px, sheen, ↑2)
 *   <OvrBadge ovr={ovrAfter} from={ovrBefore} countUp size="xl" />  // animated reveal (1.7s)
 *   <OvrBadge ovr={52} size="md" />                               // 50px compact (no label)
 *   <OvrPill ovr={82} />                                          // table rows (38×22)
 *
 * The metal/grade follow the DISPLAYED value, so a count-up crossing 80 turns silver → gold live.
 */
import { memo, type CSSProperties } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cx } from './cx'
import { useCountUp } from './CountUp'
import { gradeOf, tierOf, TIER_LABEL, GRADE_LABEL } from './tiers'
import { useReducedMotion } from './hooks'

export type OvrSize = 'sm' | 'md' | 'lg' | 'xl'
const SIZE_W: Record<OvrSize, number> = { sm: 40, md: 58, lg: 78, xl: 100 }

export interface OvrBadgeProps {
  ovr: number
  /** sm 40 (compact) · md 58 · lg 78 · xl 100 (hero) — or an explicit width in px. Default md. */
  size?: OvrSize | number
  /** Show the "OVR" label (default: auto — hidden ≤ 50px). */
  label?: boolean
  /** ↑/↓ chip under the badge. 0/undefined hides it. */
  delta?: number
  /** Count-up: true (1700ms) or options. Starts from `from` (else the previous value). */
  countUp?: boolean | { duration?: number; delay?: number; start?: boolean; onStep?: (v: number) => void; onDone?: () => void }
  from?: number
  /** Idle sheen sweep (default true). */
  sheen?: boolean
  /** Glow aura for elite/icon grades (default true). */
  aura?: boolean
  /** Predicted / pending value (dimmed). */
  pending?: boolean
  className?: string
  style?: CSSProperties
}

export const OvrBadge = memo(function OvrBadge({ ovr, size = 'md', label, delta, countUp, from, sheen = true, aura = true, pending, className, style }: OvrBadgeProps) {
  const cu = typeof countUp === 'object' ? countUp : {}
  const shown = useCountUp(ovr, {
    from: countUp ? from : ovr,
    duration: countUp ? (cu.duration ?? 1700) : 0,
    delay: cu.delay,
    start: countUp ? (cu.start ?? true) : true,
    onStep: cu.onStep,
    onDone: cu.onDone,
  })
  const rm = useReducedMotion()
  const w = typeof size === 'number' ? size : SIZE_W[size]
  const compact = w <= 50
  const showLabel = label ?? !compact
  const tier = tierOf(shown)
  const grade = gradeOf(shown)
  const holo = grade !== 'base'
  const gradeName = GRADE_LABEL[grade]
  const auraOn = aura && (grade === 'elite' || grade === 'icon')
  const needsWrap = !!delta || auraOn
  const aria = `OVR ${ovr} · ${gradeName || TIER_LABEL[tierOf(ovr)]}${delta ? ` (${delta > 0 ? '+' : '−'}${Math.abs(delta)})` : ''}`

  const badge = (
    <div
      className={cx('lx-ovr', `lx-tier-${tier}`, sheen && !rm && 'lx-sheen', compact && 'lx-ovr--compact', className)}
      data-grade={grade}
      style={{ ['--w' as string]: `${w}px`, opacity: pending ? 0.55 : undefined, ...(needsWrap ? {} : style) }}
      role="img"
      aria-label={aria}
    >
      {holo && <span className="lx-ovr__holo" aria-hidden="true" />}
      {showLabel && (
        <span className="lx-ovr__l" aria-hidden="true">
          OVR
        </span>
      )}
      <span className="lx-ovr__n" aria-hidden="true">
        {shown}
      </span>
    </div>
  )

  if (!needsWrap) return badge
  return (
    <span className="lx-ovr-wrap" style={style}>
      {auraOn && <span className="lx-ovr-aura" data-grade={grade} aria-hidden="true" />}
      {badge}
      {!!delta && <OvrDelta value={delta} />}
    </span>
  )
})

/** ↑2 / ↓1 chip (absolute, bottom-centre of the nearest positioned parent). */
export function OvrDelta({ value, className, style }: { value: number; className?: string; style?: CSSProperties }) {
  if (!value) return null
  const up = value > 0
  return (
    <span className={cx('lx-delta', !up && 'lx-delta--down', className)} style={style} aria-hidden="true">
      {up ? <ArrowUp /> : <ArrowDown />}
      {Math.abs(value)}
    </span>
  )
}

export interface OvrPillProps {
  /** null/undefined → ghost "—". */
  ovr: number | null | undefined
  size?: 'xs' | 'sm' | 'md'
  /** Predicted value (Copero pending row): dimmed. */
  pending?: boolean
  className?: string
  style?: CSSProperties
  title?: string
}

const PILL: Record<'xs' | 'sm' | 'md', CSSProperties> = {
  xs: { minWidth: 26, height: 18, fontSize: 12.5, borderRadius: 5, padding: '0 4px' },
  sm: { minWidth: 32, height: 20, fontSize: 14, borderRadius: 6 },
  md: {},
}

/** Table-row OVR (38×22, Barlow 800 15). */
export const OvrPill = memo(function OvrPill({ ovr, size = 'md', pending, className, style, title }: OvrPillProps) {
  if (ovr == null) {
    return (
      <span className={cx('lx-ovr-pill lx-ovr-pill--ghost', className)} style={{ ...PILL[size], ...style }} aria-label="OVR indefinido">
        —
      </span>
    )
  }
  const grade = gradeOf(ovr)
  return (
    <span
      className={cx('lx-ovr-pill', `lx-tier-${tierOf(ovr)}`, pending && 'lx-ovr-pill--pending', className)}
      data-grade={grade}
      style={{ ...PILL[size], ...style }}
      title={title}
      aria-label={`OVR ${ovr}${pending ? ' (previsto)' : ''}`}
    >
      {grade === 'icon' ? <span className="lx-ovr__n">{ovr}</span> : ovr}
    </span>
  )
})
