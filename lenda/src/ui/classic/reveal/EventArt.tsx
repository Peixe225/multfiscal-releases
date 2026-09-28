/**
 * Art for decision cards: a real photo when `photoFor(art)` has one (graded to the Noite stage),
 * otherwise a tasteful illustration — themed gradient + big lucide glyph + subtle pattern.
 *
 *   <EventArt art="training_extra-accept" />                  card media (fills its box)
 *   <EventArt art="retirement" variant="bg" />                full-bleed background (end card, phones)
 *   <EventArt art="decisive_penalty-left" illustration />      force the illustration
 */
import { memo, useState, type ComponentType, type CSSProperties } from 'react'
import {
  Banknote,
  Bed,
  Crown,
  Dumbbell,
  Flag,
  GraduationCap,
  HeartHandshake,
  HeartPulse,
  Mic,
  PenLine,
  Plane,
  Shirt,
  Smartphone,
  Stethoscope,
  Sunset,
  Target,
  Trophy,
  Tv,
  Users,
  Handshake,
  type LucideProps,
} from 'lucide-react'
import { photoFor, themeFor, type PhotoTheme } from '@/ui/art/photos'
import { cx } from '@/ui/primitives'

type Ico = ComponentType<LucideProps>

interface Look {
  icon: Ico
  /** two stops of the gradient + accent glow */
  a: string
  b: string
  glow: string
  pattern: 'stripes' | 'dots' | 'grid' | 'rings'
}

const LOOKS: Record<PhotoTheme | 'penalty' | 'retirement' | 'default', Look> = {
  training: { icon: Dumbbell, a: '#0f3d2b', b: '#06140e', glow: '#3ee6a4', pattern: 'grid' },
  rest: { icon: Bed, a: '#1d2250', b: '#080a18', glow: '#8c9bff', pattern: 'dots' },
  press: { icon: Mic, a: '#25303f', b: '#090c12', glow: '#9fb7d8', pattern: 'rings' },
  phone: { icon: Smartphone, a: '#3a1f55', b: '#0e0718', glow: '#c08cff', pattern: 'dots' },
  contract: { icon: Handshake, a: '#3d2e0c', b: '#120c02', glow: '#ffc857', pattern: 'stripes' },
  crowd: { icon: Users, a: '#402108', b: '#120802', glow: '#ff9f43', pattern: 'rings' },
  celebration: { icon: Trophy, a: '#4a3606', b: '#140e01', glow: '#ffd66e', pattern: 'rings' },
  locker: { icon: Shirt, a: '#0e3440', b: '#040f14', glow: '#5fd4e6', pattern: 'stripes' },
  national: { icon: Flag, a: '#0b3b1d', b: '#051208', glow: '#ffdf3a', pattern: 'stripes' },
  airport: { icon: Plane, a: '#10304f', b: '#050d18', glow: '#6cb2ff', pattern: 'grid' },
  money: { icon: Banknote, a: '#243d12', b: '#0a1204', glow: '#b6f25c', pattern: 'stripes' },
  doctor: { icon: Stethoscope, a: '#46121c', b: '#140507', glow: '#ff5e78', pattern: 'grid' },
  injury: { icon: HeartPulse, a: '#4d0f1a', b: '#160406', glow: '#ff5e78', pattern: 'dots' },
  tattoo: { icon: PenLine, a: '#48142f', b: '#15050d', glow: '#ff7ab8', pattern: 'dots' },
  school: { icon: GraduationCap, a: '#152a52', b: '#060b17', glow: '#7fb0ff', pattern: 'grid' },
  family: { icon: HeartHandshake, a: '#4a1c2a', b: '#15070c', glow: '#ff9fb8', pattern: 'rings' },
  tv: { icon: Tv, a: '#2f1650', b: '#0c0616', glow: '#b18cff', pattern: 'stripes' },
  captain: { icon: Crown, a: '#4a3606', b: '#140e01', glow: '#ffd66e', pattern: 'rings' },
  penalty: { icon: Target, a: '#0c3a26', b: '#04120b', glow: '#3ee6a4', pattern: 'rings' },
  retirement: { icon: Sunset, a: '#4a2208', b: '#120702', glow: '#ffae5c', pattern: 'rings' },
  default: { icon: Trophy, a: '#23262f', b: '#0a0b10', glow: '#c9ced9', pattern: 'dots' },
}

function lookFor(art: string | undefined): Look {
  const key = (art ?? '').toLowerCase()
  if (/^(retirement|farewell)/.test(key)) return LOOKS.retirement
  if (/penalty/.test(key)) return LOOKS.penalty
  const theme = key ? themeFor(key) : null
  return (theme && LOOKS[theme]) || LOOKS.default
}

const PATTERN: Record<Look['pattern'], string> = {
  stripes: 'repeating-linear-gradient(125deg, rgba(255,255,255,.045) 0 1px, transparent 1px 11px)',
  dots: 'radial-gradient(rgba(255,255,255,.08) 1px, transparent 1.4px) 0 0 / 12px 12px',
  grid: 'linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px) 0 0 / 18px 18px, linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px) 0 0 / 18px 18px',
  rings: 'repeating-radial-gradient(circle at 50% 120%, rgba(255,255,255,.05) 0 1px, transparent 1px 14px)',
}

export interface EventArtProps {
  art?: string
  variant?: 'card' | 'bg'
  /** Skip the photo and draw the illustration. */
  illustration?: boolean
  nationality?: string
  salt?: string | number
  /** Tint (club colour) mixed into the grade. */
  tint?: string
  className?: string
  style?: CSSProperties
}

export const EventArt = memo(function EventArt({ art, variant = 'card', illustration, nationality, salt, tint, className, style }: EventArtProps) {
  const photo = !illustration && art ? photoFor(art, { nationality, salt }) : null
  const [failed, setFailed] = useState<string | null>(null)
  const look = lookFor(art)
  const Icon = look.icon
  const usePhoto = photo && failed !== photo
  const vars = { ['--ea-a' as string]: look.a, ['--ea-b' as string]: look.b, ['--ea-glow' as string]: look.glow, ['--ea-tint' as string]: tint ?? look.glow, ...style } as CSSProperties
  return (
    <span className={cx('ck-art', `ck-art--${variant}`, usePhoto ? 'is-photo' : 'is-illu', className)} style={vars} aria-hidden="true">
      {usePhoto ? (
        <>
          <img src={photo!} alt="" loading="lazy" decoding="async" onError={() => setFailed(photo)} className="ck-art__img" />
          <span className="ck-art__grade" />
        </>
      ) : (
        <>
          <span className="ck-art__pattern" style={{ background: PATTERN[look.pattern] }} />
          <span className="ck-art__light" />
          <Icon className="ck-art__icon" strokeWidth={1.4} />
          <Icon className="ck-art__ghost" strokeWidth={1} />
        </>
      )}
    </span>
  )
})
