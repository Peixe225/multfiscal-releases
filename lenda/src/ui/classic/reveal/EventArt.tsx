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
import { PHOTOS, photoFor, photoUrl, themeFor, type PhotoTheme } from '@/ui/art/photos'
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

/** pt-BR copy → photo theme, for engines whose options carry no art key (mock) or unknown keys. */
const HINTS: [RegExp, PhotoTheme][] = [
  [/aposent|despedid|pendurar/i, 'crowd'],
  [/pênalti|penalti|cobran[çc]a/i, 'crowd'],
  [/cirurg|m[ée]dic|fisio|recupera|tratament/i, 'doctor'],
  [/les[ãa]o|machuc|contus/i, 'injury'],
  [/trein|academia|f[íi]sic|prepara|pr[ée]-temporada|t[ée]cnica/i, 'training'],
  [/descans|rotina|folga|f[ée]rias|poupar/i, 'rest'],
  [/imprensa|entrevista|declara|coletiva|pol[êe]mica/i, 'press'],
  [/post|rede social|celular|internet|v[íi]deo viral/i, 'phone'],
  [/tatua/i, 'tattoo'],
  [/escola|estud|diploma|col[ée]gio/i, 'school'],
  [/fam[íi]lia|filh|m[ãa]e|pai|esposa/i, 'family'],
  [/document[áa]rio|s[ée]rie|tv|c[âa]mera|reality/i, 'tv'],
  [/capit[ãa]o|bra[çc]adeira/i, 'captain'],
  [/sele[çc][ãa]o|convoca|p[áa]tria|av[ôo]/i, 'national'],
  [/imposto|dinheiro|milh|sal[áa]rio|oferta|€|pix|dívida/i, 'money'],
  [/contrat|renova|agente|empres[áa]rio|assinar/i, 'contract'],
  [/viag|aeroporto|exterior|voltar para|empr[ée]stimo/i, 'airport'],
  [/vesti[áa]rio|elenco|t[ée]cnico|treinador|crise/i, 'locker'],
  [/torcida|f[ãa]s|est[áa]dio|vaia/i, 'crowd'],
  [/t[íi]tulo|ta[çc]a|campe[ãa]o|final/i, 'celebration'],
]

/** Lines are tried in order (option copy first, then the decision title). */
function hintTheme(hint: string | undefined): PhotoTheme | null {
  if (!hint) return null
  for (const line of hint.split('\n')) for (const [re, t] of HINTS) if (re.test(line)) return t
  return null
}

function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

function lookFor(art: string | undefined, hinted: PhotoTheme | null): Look {
  const key = (art ?? '').toLowerCase()
  if (/^(retirement|farewell)/.test(key)) return LOOKS.retirement
  if (/penalty/.test(key)) return LOOKS.penalty
  const theme = (key ? themeFor(key) : null) ?? hinted
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
  /** Copy used to pick a theme when the art key is unknown (option title, decision title…). */
  hint?: string
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

export const EventArt = memo(function EventArt({ art, hint, variant = 'card', illustration, nationality, salt, tint, className, style }: EventArtProps) {
  const hinted = art && themeFor(art) ? null : hintTheme(hint)
  let photo = !illustration && art ? photoFor(art, { nationality, salt }) : null
  if (!photo && !illustration && hinted) {
    const pool = PHOTOS[hinted]
    if (pool?.length) photo = photoUrl(pool[hash(`${hint}|${salt ?? ''}`) % pool.length])
  }
  const [failed, setFailed] = useState<string | null>(null)
  const look = lookFor(art, hinted)
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
