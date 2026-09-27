/**
 * Loading placeholders with a slow shimmer (static under reduced motion).
 *   <Skeleton w={120} h={14} />   <Skeleton w="100%" h={56} r={14} />   <SkeletonText lines={3} />   <SkeletonCircle size={28} />
 */
import type { CSSProperties } from 'react'
import { cx } from './cx'

export function Skeleton({ w = '100%', h = 14, r, className, style }: { w?: number | string; h?: number | string; r?: number; className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={cx('lx-skel block', className)} style={{ width: w, height: h, borderRadius: r, ...style }} />
}

export function SkeletonCircle({ size = 28, className }: { size?: number; className?: string }) {
  return <Skeleton w={size} h={size} r={size} className={className} />
}

export function SkeletonText({ lines = 3, className, lastWidth = '60%' }: { lines?: number; className?: string; lastWidth?: string }) {
  return (
    <span className={cx('flex flex-col gap-2', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} h={11} w={i === lines - 1 ? lastWidth : '100%'} />
      ))}
    </span>
  )
}
