/**
 * The LENDA "portrait": the back of the shirt with the surname on an arc and the number.
 * Themeable through KitColors; gradient/clip/pattern ids are unique per instance.
 *
 *   <Jersey name="RIBEIRO" number={9} kit={nationKit(country)} />
 */
import { memo, useId, type CSSProperties } from 'react'
import type { KitColors } from './kit'

const BODY =
  'M58,22 C66,28 82,32 100,32 C118,32 134,28 142,22 L178,37 C184,40 188,45 190,51 L199,86 L168,98 L160,80 L160,184 C160,190 156,194 150,194 L50,194 C44,194 40,190 40,184 L40,80 L32,98 L1,86 L10,51 C12,45 16,40 22,37 Z'
const COLLAR = 'M72,23 C80,28 90,30 100,30 C110,30 120,28 128,23 C124,31 114,36 100,36 C86,36 76,31 72,23 Z'

export interface JerseyProps {
  name: string
  number: number | string
  kit: KitColors
  className?: string
  style?: CSSProperties
  /** Accessible label; decorative (aria-hidden) when omitted. */
  title?: string
}

/** Font size so that up to 15 characters fit on the arc. */
function nameSize(len: number): number {
  if (len <= 6) return 20
  if (len <= 8) return 18
  return Math.max(10.5, Math.min(18, 140 / (len * 0.86)))
}

export const Jersey = memo(function Jersey({ name, number, kit, className, style, title }: JerseyProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const id = (k: string) => `jk${uid}-${k}`
  const text = (name || '').toUpperCase().slice(0, 15)
  const fs = nameSize(text.length || 1)
  const long = text.length > 11
  const num = String(number ?? '').slice(0, 2)
  const striped = !!kit.pattern
  const halo = striped ? { paintOrder: 'stroke' as const, stroke: kit.base, strokeWidth: 3.2, strokeLinejoin: 'round' as const } : undefined
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 200"
      className={className}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={id('shade')} x1="0" x2="1">
          <stop offset="0" stopColor="#000" stopOpacity=".38" />
          <stop offset=".22" stopColor="#000" stopOpacity=".05" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".1" />
          <stop offset=".78" stopColor="#000" stopOpacity=".05" />
          <stop offset="1" stopColor="#000" stopOpacity=".4" />
        </linearGradient>
        <linearGradient id={id('body')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={kit.base2} />
          <stop offset="1" stopColor={kit.base} />
        </linearGradient>
        <clipPath id={id('clip')}>
          <path d={BODY} />
        </clipPath>
        <path id={id('arc')} d="M40 82 Q100 58 160 82" fill="none" />
        {kit.pattern === 'checker' && (
          <pattern id={id('chk')} width="24" height="24" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill={kit.stripe} />
            <rect x="12" y="12" width="12" height="12" fill={kit.stripe} />
          </pattern>
        )}
      </defs>
      <path d={BODY} fill={`url(#${id('body')})`} />
      <g clipPath={`url(#${id('clip')})`}>
        {kit.pattern === 'stripes' && (
          <g fill={kit.stripe} opacity=".95">
            {[27, 61, 95, 129, 163].map((x) => (
              <rect key={x} x={x} y="0" width="17" height="200" />
            ))}
          </g>
        )}
        {kit.pattern === 'hoops' && (
          <g fill={kit.stripe} opacity=".92">
            {[48, 84, 120, 156].map((y) => (
              <rect key={y} x="0" y={y} width="200" height="18" />
            ))}
          </g>
        )}
        {kit.pattern === 'checker' && <rect x="0" y="0" width="200" height="200" fill={`url(#${id('chk')})`} opacity=".95" />}
        {kit.pattern === 'sash' && <path d="M36 30 L70 30 L166 194 L132 194 Z" fill={kit.stripe} opacity=".95" />}
        {kit.pattern === 'center' && (
          <g>
            <rect x="92" y="0" width="16" height="200" fill={kit.stripe} opacity=".9" />
            <rect x="84" y="0" width="8" height="200" fill={kit.trim} />
            <rect x="108" y="0" width="8" height="200" fill={kit.trim} />
          </g>
        )}
        <path d="M1,86 L32,98 L35,90 L4,78 Z M199,86 L168,98 L165,90 L196,78 Z" fill={kit.trim} />
        <path d="M40,80 L40,194 M160,80 L160,194" stroke={kit.trim} strokeWidth="3" opacity=".8" />
        <path d="M70,120 C80,140 76,170 64,194 M136,110 C126,136 130,168 142,194" stroke="#000" strokeOpacity=".07" strokeWidth="10" fill="none" />
        <rect x="0" y="0" width="200" height="200" fill={`url(#${id('shade')})`} />
      </g>
      <path d={COLLAR} fill={kit.trim} />
      <path d={BODY} fill="none" stroke={kit.stroke} strokeWidth="1.5" />
      {text && (
        <text
          fill={kit.ink}
          style={{ fontFamily: "'Inter Tight Variable','Inter Tight',Inter,sans-serif", fontWeight: 900, ...halo }}
          fontSize={fs}
          letterSpacing={long ? 0.6 : fs * 0.11}
        >
          <textPath href={`#${id('arc')}`} startOffset="50%" textAnchor="middle" {...(long ? { textLength: 112, lengthAdjust: 'spacingAndGlyphs' } : {})}>
            {text}
          </textPath>
        </text>
      )}
      {num && (
        <text
          x="100"
          y="168"
          textAnchor="middle"
          fill={kit.ink}
          style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, ...(halo ? { ...halo, strokeWidth: 5 } : {}) }}
          fontSize="96"
        >
          {num}
        </text>
      )}
    </svg>
  )
})
