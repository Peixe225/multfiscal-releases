/**
 * Landing hero art: the fanned FUT-style cards telling a career (bronze → prata → ouro → lenda),
 * floating trophies, halo + god-rays, the floor and "A trajetória" strip.
 * Uses the player's own draft identity when there is one (name, number, flag, position).
 */
import { useMemo, useRef, type PointerEvent } from 'react'
import { motion } from 'motion/react'
import { ArrowRight } from 'lucide-react'
import { useData } from '@/store/data'
import { OvrPill, useIsTouch, useReducedMotion, type CrestClub } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import { clubKit } from '@/ui/shared/identity/kit'
import { usePrefs } from '@/ui/shared/identity/prefs'
import { PlayerCard } from './PlayerCard'

interface FanCard {
  ovr: number
  age: number
  clubId: string
  fallback: CrestClub
  stats: [string, string | number][]
  /** Final transform (from the spec). */
  to: { x: number; y: number; rotate: number; scale: number }
}

const CARDS: FanCard[] = [
  { ovr: 52, age: 16, clubId: 'e2029', fallback: { id: 'e2029', name: 'Palmeiras', abbr: 'PAL', colors: { primary: '#0b6b3a', secondary: '#ffffff' } }, stats: [['IDADE', 16], ['JOG', 12], ['GOL', 3]], to: { x: -196, y: 42, rotate: -17, scale: 0.8 } },
  { ovr: 75, age: 21, clubId: 'e9967', fallback: { id: 'e9967', name: 'Bahia', abbr: 'BAH', colors: { primary: '#0a55a3', secondary: '#e30613' } }, stats: [['IDADE', 21], ['JOG', 34], ['GOL', 15]], to: { x: -104, y: 14, rotate: -8, scale: 0.88 } },
  { ovr: 87, age: 25, clubId: 'e2029', fallback: { id: 'e2029', name: 'Palmeiras', abbr: 'PAL', colors: { primary: '#0b6b3a', secondary: '#ffffff' } }, stats: [['IDADE', 25], ['JOG', 44], ['GOL', 31]], to: { x: 118, y: 18, rotate: 9, scale: 0.9 } },
  { ovr: 94, age: 29, clubId: 'e86', fallback: { id: 'e86', name: 'Real Madrid', abbr: 'RMA', colors: { primary: '#ece6d2', secondary: '#febe10' } }, stats: [['IDADE', 29], ['GOL', 268], ['TÍT', 17]], to: { x: 0, y: -14, rotate: 0, scale: 1.08 } },
]
// paint order: back cards first, the Lenda card on top
const ORDER = [0, 1, 2, 3]

export function HeroArt() {
  const rm = useReducedMotion()
  const touch = useIsTouch()
  const index = useData((s) => s.index)
  const draft = usePrefs((s) => s.draft)
  // the player's own draft once they typed a surname; otherwise the mockup's RIBEIRO #9
  const mine = draft.surname.trim().length > 1
  const name = mine ? draft.surname.trim().toUpperCase() : 'RIBEIRO'
  const number = mine && /^\d{1,2}$/.test(draft.number) && Number(draft.number) > 0 ? Number(draft.number) : 9
  const nat = (mine && draft.nationality) || 'BRA'
  const pos = (mine && draft.position) || 'CA'
  const fanRef = useRef<HTMLDivElement>(null)
  const raf = useRef(0)

  const cards = useMemo(
    () =>
      CARDS.map((c) => {
        const club = index?.clubById.get(c.clubId) ?? null
        const crestClub: CrestClub = club ?? c.fallback
        return { ...c, club: crestClub, kit: clubKit(club ?? { id: c.clubId, colors: c.fallback.colors as { primary: `#${string}`; secondary: `#${string}` } }) }
      }),
    [index],
  )

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (rm || touch || e.pointerType !== 'mouse') return
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * 2 - 1
    const py = ((e.clientY - r.top) / r.height) * 2 - 1
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      fanRef.current?.style.setProperty('--px', px.toFixed(3))
      fanRef.current?.style.setProperty('--py', py.toFixed(3))
    })
  }
  const onLeave = () => {
    cancelAnimationFrame(raf.current)
    fanRef.current?.style.setProperty('--px', '0')
    fanRef.current?.style.setProperty('--py', '0')
  }

  return (
    <div className="ld-art" onPointerMove={onMove} onPointerLeave={onLeave} aria-hidden="true">
      <div className="lx-halo" />
      <div className="lx-rays" />
      <svg className="ld-floor" viewBox="0 0 900 240" fill="none">
        <defs>
          <radialGradient id="ld-fl" cx=".5" cy=".4" r=".6">
            <stop offset="0" stopColor="#fff" stopOpacity=".16" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="450" cy="110" rx="330" ry="70" stroke="url(#ld-fl)" strokeWidth="1.5" />
        <ellipse cx="450" cy="110" rx="6" ry="2" fill="#fff" fillOpacity=".25" />
        <path d="M0 110 H900" stroke="url(#ld-fl)" strokeWidth="1.5" />
        <ellipse cx="450" cy="110" rx="200" ry="44" fill="url(#ld-fl)" opacity=".35" />
      </svg>

      <div className="ld-tf ld-tf--bo lx-bob">
        <TrophyArt id="ballon-dor" size={170} />
      </div>

      <div className="ld-fanwrap">
        <div className="ld-fan" ref={fanRef}>
          {ORDER.map((i) => {
            const c = cards[i]
            const front = i === 3
            return (
              <motion.div
                key={i}
                className={front ? 'ld-fan__slot ld-fan__slot--front' : 'ld-fan__slot ld-fan__slot--back'}
                initial={rm ? false : { x: 0, y: 60, rotate: 0, scale: 0.86, opacity: 0 }}
                animate={{ ...c.to, opacity: 1 }}
                transition={rm ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 18, mass: 0.9, delay: 0.12 + (front ? 0.36 : i * 0.09) }}
              >
                <PlayerCard ovr={c.ovr} pos={pos} nationality={nat} club={c.club} kit={c.kit} name={name} number={number} stats={c.stats} decorative />
              </motion.div>
            )
          })}
        </div>
      </div>

      <div className="ld-tf ld-tf--wc lx-bob">
        <TrophyArt id="world-cup" size={200} />
      </div>
      <div className="ld-tf ld-tf--lib lx-bob">
        <TrophyArt id="libertadores" size={150} />
      </div>

      <div className="ld-trail lx-glass-tag">
        <span className="ld-trail__lab">A trajetória</span>
        {cards.map((c, i) => (
          <span key={i} className="ld-trail__st">
            {i > 0 && <ArrowRight size={14} className="ld-trail__ar" aria-hidden />}
            <OvrPill ovr={c.ovr} size="sm" />
            <span className="ld-trail__n">{i === 0 ? `${c.age} anos` : i === 3 ? `${c.age} · Lenda` : c.age}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
