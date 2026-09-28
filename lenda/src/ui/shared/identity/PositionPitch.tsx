/** 03 Posição — vertical pitch with the 12 positions (radio group, arrow keys) + the position card. */
import { memo, useRef, type KeyboardEvent } from 'react'
import type { Position } from '@/engine/types'
import { cx, POSITION_LABEL, positionFamily, useSvgId } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'
import { FAMILY_GRAD, FAMILY_LABEL, PITCH_SPOTS, positionTraits } from './countries'

export const Pitch = memo(function Pitch({ value, onChange }: { value: Position | null; onChange: (p: Position) => void }) {
  const id = useSvgId('pv')
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const idx = PITCH_SPOTS.findIndex((s) => s.pos === value)

  const onKey = (e: KeyboardEvent, i: number) => {
    const cur = PITCH_SPOTS[i]
    let best = -1
    if (e.key === 'Home') best = 0
    else if (e.key === 'End') best = PITCH_SPOTS.length - 1
    else {
      const dir = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key]
      if (!dir) return
      // spatial navigation: nearest chip in the pressed direction
      let bestD = Infinity
      PITCH_SPOTS.forEach((s, j) => {
        if (j === i) return
        const dx = s.x - cur.x
        const dy = s.y - cur.y
        const along = dx * dir[0] + dy * dir[1]
        if (along <= 0.5) return
        const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0])
        const d = along + across * 2.2
        if (d < bestD) {
          bestD = d
          best = j
        }
      })
    }
    if (best < 0) return
    e.preventDefault()
    onChange(PITCH_SPOTS[best].pos)
    sfx.play('tap')
    refs.current[best]?.focus()
  }

  return (
    <div className="id-pitch">
      <svg viewBox="0 0 328 400" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0f4a2c" />
            <stop offset=".5" stopColor="#0c3d24" />
            <stop offset="1" stopColor="#0a321e" />
          </linearGradient>
          <radialGradient id={`${id}-s`} cx=".5" cy=".12" r=".6">
            <stop offset="0" stopColor="#fff" stopOpacity=".16" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <pattern id={`${id}-st`} width="328" height="50" patternUnits="userSpaceOnUse">
            <rect width="328" height="25" fill="#fff" fillOpacity=".028" />
          </pattern>
        </defs>
        <rect width="328" height="400" fill={`url(#${id}-g)`} />
        <rect width="328" height="400" fill={`url(#${id}-st)`} />
        <rect width="328" height="400" fill={`url(#${id}-s)`} />
        <g fill="none" stroke="#fff" strokeOpacity=".32" strokeWidth="1.4">
          <rect x="12" y="12" width="304" height="376" rx="2" />
          <path d="M12 200 H316" />
          <circle cx="164" cy="200" r="40" />
          <rect x="86" y="12" width="156" height="58" />
          <rect x="126" y="12" width="76" height="22" />
          <path d="M134 70 A 34 34 0 0 0 194 70" />
          <rect x="86" y="330" width="156" height="58" />
          <rect x="126" y="366" width="76" height="22" />
          <path d="M134 330 A 34 34 0 0 1 194 330" />
        </g>
        <circle cx="164" cy="200" r="2.4" fill="#fff" fillOpacity=".5" />
      </svg>
      <div role="radiogroup" aria-label="Posição em campo" className="absolute inset-0">
        {PITCH_SPOTS.map((s, i) => {
          const on = s.pos === value
          return (
            <button
              key={s.pos}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={POSITION_LABEL[s.pos]}
              title={POSITION_LABEL[s.pos]}
              tabIndex={on || (idx < 0 && i === 0) ? 0 : -1}
              className={cx('lx-pchip', `lx-pchip--${positionFamily(s.pos)}`)}
              style={{ left: `${s.x}%`, top: `${s.y}%` }}
              onClick={() => {
                if (!on) sfx.play('tap')
                onChange(s.pos)
              }}
              onKeyDown={(e) => onKey(e, i)}
            >
              {s.pos}
            </button>
          )
        })}
      </div>
    </div>
  )
})

export const PositionCard = memo(function PositionCard({ value }: { value: Position | null }) {
  if (!value)
    return (
      <div className="id-poscard" aria-live="polite">
        <div className="id-poscard__h">
          <b>Escolha sua posição</b>
        </div>
        <p className="id-poscard__note m-0">Toque numa posição do campo. Ela define quantos gols e assistências você tende a fazer e o seu peso nos prêmios individuais.</p>
      </div>
    )
  const fam = positionFamily(value)
  const { traits, note } = positionTraits(value)
  return (
    <div className="id-poscard" aria-live="polite">
      <div className="id-poscard__h">
        <b>{POSITION_LABEL[value]}</b>
        <span className={cx('lx-chip', `lx-chip--${fam}`)}>{FAMILY_LABEL[fam]}</span>
      </div>
      {traits.map((t) => (
        <div key={t.label} className="id-attr">
          <span>{t.label}</span>
          <span className="id-attr__bar" aria-hidden="true">
            <i style={{ background: FAMILY_GRAD[fam], transform: `scaleX(${Math.max(0.02, Math.min(1, t.pct))})` }} />
          </span>
          <b>{t.value}</b>
        </div>
      ))}
      <p className="id-poscard__note">{note}</p>
    </div>
  )
})
