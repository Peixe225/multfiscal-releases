/**
 * Campo 2D ao vivo (SVG 1050×680 = metros × 10; a CASA ataca → direita). A bola vai ao `at` de
 * cada evento revelado e passeia entre eles conforme a posse; os 22 pontos acompanham o bloco,
 * o mais próximo pressiona. Você: disco branco com anel ciano pulsando + etiqueta.
 * Tudo animado num rAF que escreve direto nos atributos (sem re-render por quadro).
 */
import { memo, useEffect, useMemo, useRef } from 'react'
import type { KeyMoment, LiveMatch, MatchEvent } from '@/engine/immersive/types'
import type { Position } from '@/engine/types'
import { cx, useReducedMotion } from '@/ui/primitives'
import type { TeamInfo } from '../model/view'

// 4-3-3 (x = comprimento 0–100 para a CASA, y = largura 0–100, 0 = topo)
const SLOTS: { pos: Position; x: number; y: number; n: number }[] = [
  { pos: 'GOL', x: 5, y: 50, n: 1 },
  { pos: 'LD', x: 24, y: 84, n: 2 },
  { pos: 'ZAG', x: 20, y: 62, n: 4 },
  { pos: 'ZAG', x: 20, y: 38, n: 3 },
  { pos: 'LE', x: 24, y: 16, n: 6 },
  { pos: 'VOL', x: 36, y: 50, n: 5 },
  { pos: 'MC', x: 45, y: 70, n: 8 },
  { pos: 'MEI', x: 47, y: 32, n: 10 },
  { pos: 'PD', x: 62, y: 82, n: 7 },
  { pos: 'CA', x: 66, y: 50, n: 9 },
  { pos: 'PE', x: 62, y: 18, n: 11 },
]
const NEAR: Record<Position, Position[]> = {
  GOL: ['GOL'],
  ZAG: ['ZAG'],
  LD: ['LD', 'ZAG'],
  LE: ['LE', 'ZAG'],
  VOL: ['VOL', 'MC'],
  MC: ['MC', 'VOL'],
  ME: ['PE', 'MEI', 'MC'],
  MD: ['PD', 'MC'],
  MEI: ['MEI', 'MC'],
  PE: ['PE', 'PD'],
  PD: ['PD', 'PE'],
  CA: ['CA', 'PE'],
}
export const slotOf = (p: Position) => {
  for (const q of NEAR[p] ?? [p]) {
    const i = SLOTS.findIndex((s) => s.pos === q)
    if (i >= 0) return i
  }
  return 9
}

const hexToRgb = (h: string) => {
  const m = h.replace('#', '')
  const n = parseInt(m.length === 3 ? m.replace(/./g, (c) => c + c) : m, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** Cor que se confunde com a grama (verde) ou com a noite (muito escura) → ponto branco. */
function dotStyle(c: TeamInfo['colors']) {
  const [r, g, b] = hexToRgb(c.primary)
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const greenish = g > r * 1.15 && g > b * 1.1
  if (greenish || lum < 0.13) return { fill: '#F4F6FF', ring: greenish ? c.primary : c.secondary, ink: greenish ? c.primary : '#0A0F3A' }
  const [r2, g2, b2] = hexToRgb(c.secondary)
  const lum2 = (0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2) / 255
  return { fill: c.primary, ring: Math.abs(lum2 - lum) > 0.2 ? c.secondary : lum > 0.6 ? '#0A0F3A' : '#F4F6FF', ink: lum > 0.55 ? '#0A0F3A' : '#FFFFFF' }
}

interface PitchProps {
  live: LiveMatch
  home: TeamInfo
  away: TeamInfo
  userPos: Position
  userNumber: number
  focus: MatchEvent | null
  focusSeq: number
  moment: KeyMoment | null
  dim: boolean
  meLabel: string
  /** Escala dos pontos (celular: pontos maiores para leitura). */
  dotScale?: number
  className?: string
}

export const Pitch = memo(function Pitch({ live, home, away, userPos, userNumber, focus, focusSeq, moment, dim, meLabel, dotScale = 1, className }: PitchProps) {
  const rm = useReducedMotion()
  const dots = useRef<(SVGGElement | null)[]>([])
  const ball = useRef<SVGGElement | null>(null)
  const trail = useRef<(SVGCircleElement | null)[]>([])
  const me = useRef<SVGGElement | null>(null)
  const st = useRef({ bx: 50, by: 50, tx: 50, ty: 50, fast: false, nextDrift: 0, px: new Float32Array(44), inited: false, hist: [] as [number, number][] })
  const props = useRef({ live, focus, moment, userPos, rm, dotScale })
  props.current = { live, focus, moment, userPos, rm, dotScale }
  const userSlot = slotOf(userPos)
  const hs = useMemo(() => dotStyle(home.colors), [home.colors])
  const as = useMemo(() => {
    const a = dotStyle(away.colors)
    // mesma cor dos dois lados (preto × preto, branco × branco): visitante com a 2ª cor ou vermelho de TV
    if (a.fill.toLowerCase() === hs.fill.toLowerCase()) {
      const alt = away.colors.secondary.toLowerCase() !== hs.fill.toLowerCase() && away.colors.secondary.toLowerCase() !== '#ffffff' ? away.colors.secondary : '#E5243B'
      return { fill: alt, ring: '#F4F6FF', ink: '#FFFFFF' }
    }
    return a
  }, [away.colors, hs.fill])

  // novo evento → bola vai até ele
  useEffect(() => {
    if (!focus?.at) return
    const S = st.current
    const goal = focus.type === 'goal' || focus.type === 'penalty_goal' || focus.type === 'own_goal'
    const scorerSide = focus.type === 'own_goal' ? (focus.side === 'home' ? 'away' : 'home') : focus.side
    S.tx = goal ? (scorerSide === 'home' ? 99.3 : 0.7) : focus.at.x
    S.ty = goal ? 46 + (focus.at.y % 8) : focus.at.y
    S.fast = true
    S.nextDrift = performance.now() + (goal ? 2600 : 1100)
  }, [focusSeq, focus])

  useEffect(() => {
    if (!moment?.at) return
    const S = st.current
    S.tx = moment.at.x
    S.ty = moment.at.y
    S.fast = true
    S.nextDrift = Number.POSITIVE_INFINITY
  }, [moment])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let seed = 1
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      const S = st.current
      const { live: L, moment: M, rm: R, dotScale: K } = props.current
      const sc = K !== 1 ? ` scale(${K})` : ''
      const running = L.phase === 'first_half' || L.phase === 'second_half' || L.phase === 'extra_time'
      // deriva: novo alvo a cada ~1 s pela posse
      if (!M && t > S.nextDrift) {
        const homeBall = rnd() * 100 < L.team.possession[0]
        S.tx = running ? (homeBall ? 44 + rnd() * 42 : 14 + rnd() * 42) : 50
        S.ty = running ? 12 + rnd() * 76 : 50
        S.fast = false
        S.nextDrift = t + 700 + rnd() * 900
      }
      const sp = (S.fast ? 90 : 26) * dt
      const dx = S.tx - S.bx
      const dy = S.ty - S.by
      const d = Math.hypot(dx, dy)
      if (d > 0.01) {
        const k = Math.min(1, sp / d)
        S.bx += dx * k
        S.by += dy * k
      } else S.fast = false
      // rastro
      S.hist.unshift([S.bx, S.by])
      if (S.hist.length > 16) S.hist.length = 16
      ball.current?.setAttribute('transform', `translate(${(S.bx * 10.5).toFixed(1)} ${(S.by * 6.8).toFixed(1)})${sc}`)
      trail.current.forEach((c, i) => {
        const h = S.hist[(i + 1) * 4]
        if (c && h) {
          c.setAttribute('cx', (h[0] * 10.5).toFixed(1))
          c.setAttribute('cy', (h[1] * 6.8).toFixed(1))
        }
      })
      // jogadores
      const homeAtk = S.bx >= 50
      for (let team = 0; team < 2; team++) {
        const dir = team === 0 ? 1 : -1
        let best = -1
        let bestD = 1e9
        const tgt: [number, number][] = []
        for (let i = 0; i < 11; i++) {
          const sl = SLOTS[i]
          const bx = team === 0 ? sl.x : 100 - sl.x
          const by = team === 0 ? sl.y : 100 - sl.y
          const atk = (team === 0) === homeAtk
          const gk = i === 0
          let x = gk ? bx + (S.bx - 50) * 0.07 : bx + (S.bx - 50) * 0.5 + (atk ? 5 : -3) * dir
          let y = gk ? 50 + (S.by - 50) * 0.28 : by + (S.by - 50) * 0.26
          if (!R && !gk && running) {
            x += Math.sin(t * 0.0011 + i * 1.7 + team) * 1.3
            y += Math.cos(t * 0.0009 + i * 2.3 + team) * 1.6
          }
          tgt.push([x, y])
          if (!gk) {
            const dd = Math.hypot(x - S.bx, y - S.by)
            if (dd < bestD) {
              bestD = dd
              best = i
            }
          }
        }
        // o mais próximo vai na bola
        if (best >= 0 && running) {
          const pull = team === (homeAtk ? 0 : 1) ? 0.72 : 0.5
          tgt[best] = [tgt[best][0] + (S.bx - tgt[best][0]) * pull, tgt[best][1] + (S.by - tgt[best][1]) * pull]
        }
        // lance decisivo: você perto da bola
        if (M?.at && (team === 0) === (L.userSide === 'home') && L.userOnPitch) {
          tgt[userSlot] = [M.at.x - 1.6 * (L.userSide === 'home' ? 1 : -1), M.at.y + 2]
        }
        for (let i = 0; i < 11; i++) {
          const j = (team * 11 + i) * 2
          const [x, y] = tgt[i]
          if (!S.inited) {
            S.px[j] = x
            S.px[j + 1] = y
          } else {
            const k = Math.min(1, dt * (M ? 4 : 2.2))
            S.px[j] += (Math.max(1.5, Math.min(98.5, x)) - S.px[j]) * k
            S.px[j + 1] += (Math.max(3, Math.min(97, y)) - S.px[j + 1]) * k
          }
          const el = dots.current[team * 11 + i]
          el?.setAttribute('transform', `translate(${(S.px[j] * 10.5).toFixed(1)} ${(S.px[j + 1] * 6.8).toFixed(1)})${sc}`)
          if (i === userSlot && (team === 0) === (L.userSide === 'home') && me.current) me.current.setAttribute('transform', `translate(${(S.px[j] * 10.5).toFixed(1)} ${(S.px[j + 1] * 6.8).toFixed(1)})${sc}`)
        }
      }
      S.inited = true
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSlot])

  const userTeam = live.userSide === 'home' ? 0 : 1
  const showMe = live.userOnPitch
  const spot = moment?.at
  return (
    <div className={cx('im-pitch', dim && 'is-dim', className)}>
      <svg viewBox="0 0 1050 680" className="im-pitch__svg" role="img" aria-label={`Campo: ${home.short} ataca para a direita, ${away.short} para a esquerda`}>
        <defs>
          <linearGradient id="im-grass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0F6149" />
            <stop offset="1" stopColor="#0A4638" />
          </linearGradient>
          <radialGradient id="im-vig" cx=".5" cy=".5" r=".75">
            <stop offset=".55" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#020618" stopOpacity=".55" />
          </radialGradient>
        </defs>
        <rect width="1050" height="680" fill="url(#im-grass)" />
        <g fill="#fff" opacity=".04">
          {[0, 150, 300, 450, 600, 750, 900].map((x) => (
            <rect key={x} x={x} width="75" height="680" />
          ))}
        </g>
        <g fill="none" stroke="#DFFCF2" strokeOpacity=".62" strokeWidth="3">
          <rect x="10" y="10" width="1030" height="660" />
          <line x1="525" y1="10" x2="525" y2="670" />
          <circle cx="525" cy="340" r="91.5" />
          <rect x="10" y="138.5" width="165" height="403" />
          <rect x="875" y="138.5" width="165" height="403" />
          <rect x="10" y="248.5" width="55" height="183" />
          <rect x="985" y="248.5" width="55" height="183" />
          <path d="M175 266 A91.5 91.5 0 0 1 175 414" />
          <path d="M875 266 A91.5 91.5 0 0 0 875 414" />
        </g>
        <g fill="#DFFCF2" fillOpacity=".7">
          <circle cx="525" cy="340" r="4" />
          <circle cx="120" cy="340" r="3.5" />
          <circle cx="930" cy="340" r="3.5" />
        </g>
        <g fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth="4">
          <rect x="-6" y="303" width="16" height="74" />
          <rect x="1040" y="303" width="16" height="74" />
        </g>
        <rect width="1050" height="680" fill="url(#im-vig)" />

        <g fontFamily="var(--font-display)" fontWeight="800" fontSize="12" textAnchor="middle">
          {[0, 1].map((team) => {
            const ds = team === 0 ? hs : as
            return SLOTS.map((sl, i) => {
              const mine = team === userTeam && i === userSlot && showMe
              return (
                <g key={`${team}-${i}`} ref={(el) => void (dots.current[team * 11 + i] = el)} opacity={mine ? 0 : 1}>
                  <circle r="11" fill={ds.fill} stroke={ds.ring} strokeWidth="2.5" />
                  <text y="4" fill={ds.ink}>
                    {team === userTeam && i === userSlot ? userNumber : sl.n}
                  </text>
                </g>
              )
            })
          })}
        </g>
        {showMe && (
          <g ref={me}>
            <circle className="lx-pitch-me" r="22" fill="none" stroke="#3BE4FF" strokeWidth="2" />
            <circle r="14" fill="#F4F6FF" stroke="#3BE4FF" strokeWidth="3" />
            <text y="5" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="800" fontSize="14" fill={(userTeam === 0 ? hs : as).ring === '#F4F6FF' ? '#0A0F3A' : (userTeam === 0 ? home : away).colors.primary}>
              {userNumber}
            </text>
            <g transform="translate(0 -36)">
              <path d={`M${-meLabel.length * 4.2 - 8} -12 H${meLabel.length * 4.2 + 12} L${meLabel.length * 4.2 + 6} 8 H${-meLabel.length * 4.2 - 14} Z`} fill="#06103A" stroke="#3BE4FF" strokeOpacity=".6" />
              <text y="3" textAnchor="middle" fill="#F4F6FF" fontFamily="var(--font-display)" fontWeight="800" fontStyle="italic" fontSize="14">
                {meLabel}
              </text>
            </g>
          </g>
        )}
        {[0, 1, 2].map((i) => (
          <circle key={i} ref={(el) => void (trail.current[i] = el)} r="5" fill="#fff" opacity={0.42 - i * 0.12} cx="525" cy="340" />
        ))}
        <g ref={ball}>
          <circle r="7" fill="#fff" stroke="#0A0F3A" strokeWidth="1.5" />
          <circle r="2.4" cx="-1.5" cy="-1.5" fill="#0A0F3A" opacity=".55" />
        </g>
      </svg>
      {spot && <div className="lx-spotlight" style={{ ['--lx-x' as string]: `${spot.x}%`, ['--lx-y' as string]: `${spot.y}%` }} />}
    </div>
  )
})
