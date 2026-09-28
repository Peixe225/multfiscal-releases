/** Small shared pieces of the cockpit (league logo, animated numbers). */
import { memo, useState, type CSSProperties } from 'react'
import type { League } from '@/engine/types'
import { cx, useCountUp } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'

/** League / competition logo from public/ (pipeline). Hidden when the file is missing. */
export const LeagueLogo = memo(function LeagueLogo({ league, size = 15, className, style }: { league?: Pick<League, 'logo' | 'shortName'> | null; size?: number; className?: string; style?: CSSProperties }) {
  const [failed, setFailed] = useState(false)
  if (!league?.logo || failed) return null
  const src = /^https?:|^\//.test(league.logo) ? league.logo : `${import.meta.env.BASE_URL}${league.logo}`
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cx('ck-league-logo', className)}
      style={{ width: size, height: size, ...style }}
    />
  )
})

/** Integer that counts from its last value (or `from`) whenever `value` changes / `start` flips. */
export function Num({
  value,
  from,
  start = true,
  duration = 500,
  tick,
  format,
  className,
  style,
}: {
  value: number
  from?: number
  start?: boolean
  duration?: number
  tick?: boolean
  format?: (v: number) => string
  className?: string
  style?: CSSProperties
}) {
  const v = useCountUp(value, { from, start, duration, onStep: tick ? () => sfx.tick() : undefined })
  return (
    <span className={className} style={style}>
      <span aria-hidden="true">{format ? format(v) : v}</span>
      <span className="lx-sr-only">{format ? format(value) : value}</span>
    </span>
  )
}
