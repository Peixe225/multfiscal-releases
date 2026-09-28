/** Achievement icons, rarity styling and pt-BR date formatting (shared by the dialog and the unlock toast). */
import type { ComponentType } from 'react'
import {
  ArrowUp,
  Award,
  Baby,
  Backpack,
  Badge,
  BrickWall,
  Calendar,
  CircleDot,
  CircleOff,
  Compass,
  Crown,
  Earth,
  Flag,
  Flame,
  Footprints,
  Gem,
  Globe,
  Goal,
  Hand,
  HandHelping,
  Heart,
  Infinity as InfinityIcon,
  Layers,
  Map as MapIcon,
  Medal,
  Mountain,
  Plane,
  Shield,
  ShieldCheck,
  Shirt,
  Sparkles,
  Star,
  Sunrise,
  Swords,
  Target,
  TrendingUp,
  Trophy,
  Zap,
  type LucideProps,
} from 'lucide-react'
import type { Achievement } from '@/engine/types'

export type IconType = ComponentType<LucideProps>

const ICONS: Record<string, IconType> = {
  'arrow-up': ArrowUp,
  award: Award,
  baby: Baby,
  backpack: Backpack,
  badge: Badge,
  'brick-wall': BrickWall,
  calendar: Calendar,
  'circle-dot': CircleDot,
  'circle-off': CircleOff,
  compass: Compass,
  crown: Crown,
  goat: Crown,
  flag: Flag,
  flame: Flame,
  footprints: Footprints,
  gem: Gem,
  globe: Globe,
  'globe-2': Earth,
  goal: Goal,
  hand: Hand,
  'hand-helping': HandHelping,
  heart: Heart,
  infinity: InfinityIcon,
  layers: Layers,
  map: MapIcon,
  medal: Medal,
  mountain: Mountain,
  plane: Plane,
  shield: Shield,
  'shield-check': ShieldCheck,
  shirt: Shirt,
  sparkles: Sparkles,
  star: Star,
  sunrise: Sunrise,
  swords: Swords,
  target: Target,
  'trending-up': TrendingUp,
  trophy: Trophy,
  zap: Zap,
}

export const achievementIcon = (a: Pick<Achievement, 'icon'>): IconType => ICONS[a.icon] ?? Medal

export type Rarity = Achievement['rarity']

export const RARITY: Record<Rarity, { label: string; order: number; /** tile gradient */ bg: string; ink: string; ring: string; glow: string }> = {
  comum: { label: 'Comum', order: 0, bg: 'linear-gradient(160deg,#e9d2b4 0%,#b98652 48%,#6f4424 100%)', ink: '#2a1606', ring: 'rgba(230,180,130,.45)', glow: 'rgba(214,150,90,.28)' },
  rara: { label: 'Rara', order: 1, bg: 'linear-gradient(160deg,#ffffff 0%,#c8d0dc 45%,#7d8797 100%)', ink: '#141820', ring: 'rgba(200,210,225,.5)', glow: 'rgba(190,205,230,.28)' },
  epica: { label: 'Épica', order: 2, bg: 'linear-gradient(160deg,#fff4c9 0%,#f2c75a 42%,#9a6a14 100%)', ink: '#2a1a00', ring: 'rgba(255,214,110,.55)', glow: 'rgba(255,200,90,.34)' },
  lendaria: {
    label: 'Lendária',
    order: 3,
    bg: 'conic-gradient(from 210deg at 55% 45%,#fbe8ff,#c9b8ff,#9ff3dc,#fff1b8,#ffc2de,#d8c6ff,#fbe8ff)',
    ink: '#241536',
    ring: 'rgba(214,190,255,.6)',
    glow: 'rgba(200,170,255,.4)',
  },
}

/** Copero's format: "27 Set 17:05" (year only when not the current one: "3 Mar 2025 09:41"). */
export function formatUnlockDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }
  const date = new Intl.DateTimeFormat('pt-BR', opts)
    .format(d)
    .replace(/\./g, '')
    .replace(/ de /g, ' ')
    .replace(/(\d+) (\p{L})/u, (_m, day: string, c: string) => `${day} ${c.toUpperCase()}`)
  const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
  return `${date} ${time}`
}

/** Long form for aria labels: "27 de setembro de 2026, 17:05". */
export const longDate = (iso: string | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })
}
