/**
 * <BrandMark size={30} />                         — gold shield "L" + star
 * <Brand sub="CLÁSSICO" href="#/" />              — mark + LENDA wordmark (+ sub-label)
 */
import { useSvgId } from './hooks'
import { cx } from './cx'

export function BrandMark({ size = 30, className }: { size?: number; className?: string }) {
  const id = useSvgId('bm')
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset=".5" stopColor="#e7b54a" />
          <stop offset="1" stopColor="#8a5a0c" />
        </linearGradient>
      </defs>
      <path d="M16 1.8 28.4 6.6V16c0 7.2-5.6 12.3-12.4 14.2C9.2 28.3 3.6 23.2 3.6 16V6.6z" fill={`url(#${id})`} />
      <path d="M16 4.9 25.5 8.6V16c0 5.7-4.3 9.8-9.5 11.3C10.8 25.8 6.5 21.7 6.5 16V8.6z" fill="var(--bg-2, #0b0d12)" />
      <path d="M12.6 10.2v11.2h7.6" stroke={`url(#${id})`} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m19.6 9.2.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="#fff3c4" />
    </svg>
  )
}

export function Brand({ sub, href = '#/', className, hideSubOnPhone = true }: { sub?: string; href?: string; className?: string; hideSubOnPhone?: boolean }) {
  return (
    <a href={href} className={cx('lx-brand', className)} aria-label={`LENDA${sub ? ` · ${sub}` : ''} — início`}>
      <BrandMark size={30} />
      <span className="lx-brand__word">LENDA</span>
      {sub && <span className={cx('lx-brand__sub', hideSubOnPhone && 'max-sm:hidden')}>{sub}</span>}
    </a>
  )
}
