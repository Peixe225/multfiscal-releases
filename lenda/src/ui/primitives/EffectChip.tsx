/**
 * Decision effect pill (DESIGN-SPEC §10.1 `.lx-fx`): icon tile · label · probability.
 *
 *   <EffectChip effect={{ kind: 'positive', label: '+3 OVR', probability: 0.6 }} />
 *   <EffectChip kind="fixed" label="Capitão do time" probability={1} icon={Crown} />
 *   <EffectChip … state="hit" />   // roulette: 'idle' | 'dim' | 'hit' | 'flash'
 */
import { memo, type ComponentType, type CSSProperties } from 'react'
import {
  Ban, Banknote, CalendarClock, Crown, Flag as FlagIcon, Goal, HeartPulse, Lock, Megaphone, Minus, Plane, Shield, Shirt, Sparkles, Star,
  Trophy, TrendingDown, TrendingUp, Users, type LucideProps,
} from 'lucide-react'
import type { EffectChip as EffectChipData, EffectKind } from '@/engine/types'
import { cx } from './cx'
import { formatPercent, MINUS } from './format'

type IconType = ComponentType<LucideProps>

const KIND_CLASS: Record<EffectKind, string> = { positive: 'lx-fx--pos', negative: 'lx-fx--neg', neutral: 'lx-fx--neu', fixed: 'lx-fx--amb' }
const KIND_ICON: Record<EffectKind, IconType> = { positive: TrendingUp, negative: TrendingDown, neutral: Minus, fixed: Lock }

/** Label → icon heuristics (pt-BR). */
const HINTS: [RegExp, IconType][] = [
  [/capit[aã]o|bra[cç]adeira/i, Crown],
  [/sal[aá]rio|€|milh|valor/i, Banknote],
  [/t[ií]tulo|ta[cç]a|campe[aã]o|copa/i, Trophy],
  [/les[aã]o|m[eé]dic|recupera/i, HeartPulse],
  [/sele[cç][aã]o|convoca/i, FlagIcon],
  [/titular|reserva|banco|papel/i, Shirt],
  [/suspens|punid|proib/i, Ban],
  [/gol|artilh/i, Goal],
  [/torcida|f[aã]s|popular/i, Users],
  [/imprensa|pol[eê]mica|m[ií]dia/i, Megaphone],
  [/empr[eé]stimo|viagem|exterior|transfer/i, Plane],
  [/contrato|anos|temporada/i, CalendarClock],
  [/prest[ií]gio|fama|estrela/i, Star],
  [/defesa|prote/i, Shield],
  [/especial|b[oô]nus/i, Sparkles],
]

export function effectIcon(kind: EffectKind, label: string): IconType {
  if (/OVR/i.test(label)) return kind === 'negative' ? TrendingDown : kind === 'positive' ? TrendingUp : KIND_ICON[kind]
  for (const [re, ic] of HINTS) if (re.test(label)) return ic
  return KIND_ICON[kind]
}

/** Ensure a real minus sign in "-2 OVR". */
export const prettyEffectLabel = (label: string) => label.replace(/(^|\s)-(\d)/g, `$1${MINUS}$2`)

export interface EffectChipProps {
  effect?: EffectChipData
  kind?: EffectKind
  label?: string
  probability?: number
  icon?: IconType
  /** Roulette state: dim the losers, ring the winner, flash while spinning. */
  state?: 'idle' | 'dim' | 'hit' | 'flash'
  /** Hide the probability even when present. */
  hideProbability?: boolean
  className?: string
  style?: CSSProperties
}

export const EffectChip = memo(function EffectChip({ effect, kind, label, probability, icon, state = 'idle', hideProbability, className, style }: EffectChipProps) {
  const k = (effect?.kind ?? kind ?? 'neutral') as EffectKind
  const text = prettyEffectLabel(effect?.label ?? label ?? '')
  const p = effect?.probability ?? probability
  const Ico = icon ?? effectIcon(k, text)
  return (
    <div
      className={cx('lx-fx', KIND_CLASS[k], state === 'dim' && 'is-dim', state === 'hit' && 'is-hit', state === 'flash' && 'lx-fx--flash', className)}
      style={{ transition: 'opacity 200ms, filter 200ms, box-shadow 200ms', ...style }}
      aria-label={`${text}${p != null && !hideProbability ? `, chance de ${formatPercent(p)}` : ''}`}
    >
      <span className="lx-fx__ic" aria-hidden="true">
        <Ico strokeWidth={2.4} />
      </span>
      <span className="min-w-0 flex-1 truncate" aria-hidden="true">
        {text}
      </span>
      {p != null && !hideProbability && (
        <span className="lx-fx__p" aria-hidden="true">
          {formatPercent(p)}
        </span>
      )}
    </div>
  )
})

/** Standalone probability chip ("65%") in the effect tint. */
export function ProbChip({ p, kind = 'neutral', className }: { p: number; kind?: EffectKind; className?: string }) {
  const tint: Record<EffectKind, CSSProperties> = {
    positive: { background: 'rgba(62,230,164,.16)', color: 'var(--positive)' },
    negative: { background: 'rgba(255,94,120,.16)', color: 'var(--negative)' },
    neutral: { background: 'var(--surface-2)', color: 'var(--text-2)' },
    fixed: { background: 'rgba(255,200,87,.16)', color: 'var(--warning)' },
  }
  return (
    <span className={cx('num inline-grid place-items-center rounded-xs px-[7px] py-px text-[14px] font-bold', className)} style={tint[kind]}>
      {formatPercent(p)}
    </span>
  )
}
