/** Hall das Lendas — peças visuais compartilhadas (anel da nota, avatares, glifos de categoria). */
import { memo, useId, type CSSProperties } from 'react'
import { Goal, HandHelping, Medal, Shirt, Target, Zap, type LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { CATEGORIES, formatCategoryValue, type CategoryId, type LegendLegacy, type RankEntry, type RunLegacy } from '@/engine/legacy'
import { useCareer } from '@/store/career'
import { useClub } from '@/store/data'
import { Crest, Flag, OvrBadge, cx } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'

const ICONS: Partial<Record<CategoryId, ComponentType<LucideProps>>> = { clubs: Shirt, goals: Goal, assists: HandHelping, records: Zap, goalsPerGame: Target, leagueTitles: Medal }

/** Troféu (quando a categoria tem arte) ou ícone num ladrilho. */
export const CategoryGlyph = memo(function CategoryGlyph({ id, size = 28, photo }: { id: CategoryId; size?: number; photo?: boolean }) {
  const meta = CATEGORIES[id]
  if (meta.art && id !== 'leagueTitles') return <TrophyArt id={meta.art} size={size} variant={photo ? 'auto' : 'svg'} className="hl-glyph__art" />
  const Ico = ICONS[id] ?? Medal
  return (
    <span className="hl-glyph" style={{ width: size, height: size }} aria-hidden="true">
      <Ico size={Math.round(size * 0.56)} strokeWidth={2.2} />
    </span>
  )
})

/** Anel da Nota de Legado (0–100). */
export const NotaRing = memo(function NotaRing({ score, size = 72, tone = 'gold', label, className }: { score: number; size?: number; tone?: 'gold' | 'silver' | 'club'; label?: string; className?: string }) {
  const id = useId().replace(/:/g, '')
  const stroke = Math.max(4, Math.round(size * 0.075))
  const r = (size - stroke) / 2 - 1
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, score))
  const stops = tone === 'silver' ? ['#ffffff', '#aab3c2'] : tone === 'club' ? ['var(--hl-ring-a, #ffffff)', 'var(--hl-ring-b, #cfd5e2)'] : ['#fff1bf', '#e2a93b']
  return (
    <span className={cx('hl-ring', className)} style={{ width: size, height: size, ['--ring-size' as string]: `${size}px` } as CSSProperties} role="img" aria-label={`Nota de Legado ${v} de 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={stops[0]} />
            <stop offset="1" stopColor={stops[1]} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#g${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * v) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <b className="hl-ring__n">{v}</b>
      {label && <small className="hl-ring__l">{label}</small>}
    </span>
  )
})

/** Bandeira redonda da lenda. */
export const LegendAvatar = memo(function LegendAvatar({ legend, size = 34 }: { legend: LegendLegacy; size?: number }) {
  const l = legend.legend
  return (
    <span className="hl-lav" style={{ width: size, height: size }}>
      <Flag code={l.flag ? null : l.nationality} iso2={l.flag} h={size} w={Math.round((size * 4) / 3)} radius={0} decorative style={{ boxShadow: 'none' }} />
    </span>
  )
})

/** OVR máximo + escudo do clube principal. */
export const RunAvatar = memo(function RunAvatar({ run, size = 38 }: { run: RunLegacy; size?: number }) {
  const club = useClub(run.stats.mainClubId)
  return (
    <span className="hl-rav">
      <OvrBadge ovr={run.stats.peakOvr || 60} size={size} sheen={false} aura={false} label={false} />
      {club && (
        <span className="hl-rav__crest">
          <Crest club={club} size={Math.round(size * 0.5)} decorative />
        </span>
      )}
    </span>
  )
})

export const EntryAvatar = ({ entry, size }: { entry: RankEntry; size?: number }) =>
  entry.kind === 'run' ? <RunAvatar run={entry} size={size} /> : <LegendAvatar legend={entry} size={size} />

export const entryName = (e: RankEntry) => (e.kind === 'run' ? e.input.identity.surname.toUpperCase() : e.legend.name)

/** Valor de uma categoria com "≈" para números incertos das lendas. */
export function valueOf(e: RankEntry, id: CategoryId, unit = false): string {
  const approx = e.kind === 'legend' && !!e.approx[id]
  return formatCategoryValue(id, e.values[id], { approx, unit })
}

const KEY: CategoryId[] = ['ballonDor', 'worldCups', 'ucl', 'libertadores']

/** Taças-chave com contagem (Bola de Ouro, Copa, Champions, Libertadores). */
export const KeyTrophies = memo(function KeyTrophies({ entry, size = 24, hideZero = true }: { entry: RankEntry; size?: number; hideZero?: boolean }) {
  const items = KEY.filter((id) => !hideZero || entry.values[id] > 0)
  if (!items.length) return <span className="hl-kt hl-kt--none">—</span>
  return (
    <span className="hl-kt">
      {items.map((id) => (
        <span key={id} className={cx('hl-kt__i', entry.values[id] === 0 && 'is-zero')} title={`${entry.values[id]}× ${CATEGORIES[id].one}`}>
          <CategoryGlyph id={id} size={size} />
          <b>{entry.values[id]}</b>
        </span>
      ))}
    </span>
  )
})

/** Escudos dos clubes de uma lenda (os que existem no jogo). */
export function LegendCrests({ legend, max = 4, size = 18 }: { legend: LegendLegacy; max?: number; size?: number }) {
  const ids = legend.legend.clubs.map((c) => c.clubId).filter((x): x is string => !!x)
  return (
    <span className="hl-crests">
      {ids.slice(0, max).map((id) => (
        <LegendCrest key={id} id={id} size={size} />
      ))}
    </span>
  )
}
function LegendCrest({ id, size }: { id: string; size: number }) {
  const club = useClub(id)
  return club ? <Crest club={club} size={size} decorative /> : null
}

/** Escudos dos clubes da run (mais temporadas primeiro). `exclude`: um escudo já mostrado ao lado. */
export function RunCrests({ run, max = 5, size = 18, exclude }: { run: RunLegacy; max?: number; size?: number; exclude?: string }) {
  const ids = run.stats.clubTotals
    .slice()
    .sort((a, b) => b.seasons - a.seasons || b.apps - a.apps)
    .map((c) => c.clubId)
    .filter((id) => id !== exclude)
  return (
    <span className="hl-crests">
      {ids.slice(0, max).map((id) => (
        <LegendCrest key={id} id={id} size={size} />
      ))}
      {ids.length > max && <span className="hl-crests__more">+{ids.length - max}</span>}
    </span>
  )
}

/** "Clássico" / "Imersivo": o modo em que a carreira do Hall foi jogada. */
export function useRunModeLabel(id: string): string | null {
  const mode = useCareer((s) => s.finishedCareers.find((h) => h.id === id)?.mode)
  return mode === 'immersive' ? 'Imersivo' : mode === 'classic' ? 'Clássico' : null
}
