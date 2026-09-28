/**
 * Small building blocks shared by the three tabs (and the summary): season rail, competition
 * logo tile, team mark (crest or flag), section card, empty state.
 */
import { memo, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, CloudOff, Trophy as TrophyIcon } from 'lucide-react'
import { getClub, getCompetition, getCountry, getLeague } from '@/store/data'
import { Crest, Flag, cx, rowClubVars } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import type { SeasonEntry } from './model'
import { isNation, teamName } from './model'

// ───────────────────────── season rail ─────────────────────────

export const SeasonRail = memo(function SeasonRail({
  entries,
  value,
  onChange,
  label = 'Temporada',
}: {
  entries: SeasonEntry[]
  value: number | null
  onChange: (season: number, pinned: boolean) => void
  label?: string
}) {
  const rail = useRef<HTMLDivElement>(null)
  const idx = entries.findIndex((e) => e.season === value)
  const latest = entries[entries.length - 1]?.season
  const go = (i: number) => {
    const e = entries[Math.max(0, Math.min(entries.length - 1, i))]
    if (e) onChange(e.season, e.season !== latest)
  }
  // keep the selected chip in view
  useEffect(() => {
    const el = rail.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!el || !rail.current) return
    const r = rail.current
    const left = el.offsetLeft - r.clientWidth / 2 + el.clientWidth / 2
    r.scrollTo({ left, behavior: 'smooth' })
  }, [value])
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      go(idx - 1)
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      go(idx + 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      go(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      go(entries.length - 1)
    }
  }
  useEffect(() => {
    if (idx < 0) return
    const el = rail.current?.querySelectorAll<HTMLElement>('[role="radio"]')[idx]
    if (el && rail.current?.contains(document.activeElement)) el.focus({ preventScroll: true })
  }, [idx])
  if (!entries.length) return null
  return (
    <div className="tb-rail">
      <button type="button" className="tb-rail__arrow" aria-label="Temporada anterior" disabled={idx <= 0} onClick={() => go(idx - 1)}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <div ref={rail} className="tb-rail__track no-scrollbar" role="radiogroup" aria-label={label} onKeyDown={onKey}>
        {entries.map((e) => {
          const club = getClub(e.record.clubId)
          const on = e.season === value
          return (
            <button
              key={e.season}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={cx('tb-rail__chip', on && 'is-on', !e.world && 'is-empty')}
              style={rowClubVars(club)}
              onClick={() => onChange(e.season, e.season !== latest)}
              title={`${e.label} · ${e.record.age} anos · ${club?.name ?? ''}`}
            >
              <Crest club={club} size={16} decorative />
              <span className="tb-rail__y num">{e.label}</span>
              <span className="tb-rail__a">{e.record.age}</span>
            </button>
          )
        })}
      </div>
      <button type="button" className="tb-rail__arrow" aria-label="Próxima temporada" disabled={idx < 0 || idx >= entries.length - 1} onClick={() => go(idx + 1)}>
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  )
})

// ───────────────────────── logos & marks ─────────────────────────

const logoFail = new Set<string>()

/** Competition / league logo on a white tile (ESPN logos are drawn for light backgrounds). */
export const CompLogo = memo(function CompLogo({ id, size = 30, tile = true, className }: { id: string; size?: number; tile?: boolean; className?: string }) {
  const comp = getCompetition(id)
  const lg = getLeague(id)
  const logo = comp?.logo ?? lg?.logo ?? `leagues/${id}.webp`
  const url = `${import.meta.env.BASE_URL ?? '/'}${logo.replace(/^\//, '')}`
  const [failed, setFailed] = useState(() => logoFail.has(url))
  const trophyId = comp?.trophyId ?? lg?.trophyId
  const pad = tile ? Math.max(2, Math.round(size * 0.14)) : 0
  return (
    <span className={cx('tb-logo', tile && 'tb-logo--tile', failed && 'is-failed', className)} style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), padding: pad }} aria-hidden="true">
      {failed ? (
        trophyId ? (
          <TrophyArt id={trophyId} size={Math.round(size * 0.82)} variant="svg" />
        ) : (
          <TrophyIcon size={Math.round(size * 0.56)} />
        )
      ) : (
        <img
          src={url}
          alt=""
          width={size - pad * 2}
          height={size - pad * 2}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => {
            logoFail.add(url)
            setFailed(true)
          }}
        />
      )}
    </span>
  )
})

/** Club crest, or a flag for national teams. */
export const TeamMark = memo(function TeamMark({ id, size = 20, className }: { id: string; size?: number; className?: string }) {
  if (isNation(id)) {
    const h = Math.round(size * 0.72)
    return (
      <span className={cx('tb-flag', className)} style={{ width: size, height: size }}>
        <Flag code={id} h={h} w={Math.round(h * 4 / 3)} radius={3} decorative />
      </span>
    )
  }
  return <Crest clubId={id} size={size} decorative className={className} />
})

export function TeamName({ id, short, className }: { id: string; short?: boolean; className?: string }) {
  return <span className={cx('tb-team', className)}>{teamName(id, short)}</span>
}

export function NationName({ code }: { code: string }) {
  return <>{getCountry(code)?.name ?? code}</>
}

// ───────────────────────── section card ─────────────────────────

export function Section({
  title,
  eyebrow,
  icon,
  aside,
  children,
  className,
  style,
  id,
  tone,
}: {
  title: ReactNode
  eyebrow?: ReactNode
  icon?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
  style?: CSSProperties
  id?: string
  tone?: 'gold' | 'club'
}) {
  return (
    <section className={cx('tb-card', tone && `tb-card--${tone}`, className)} style={style} aria-labelledby={id ? `${id}-h` : undefined}>
      <header className="tb-card__h">
        {icon && <span className="tb-card__icon">{icon}</span>}
        <div className="tb-card__t">
          {eyebrow && <div className="lx-eyebrow tb-card__eyebrow">{eyebrow}</div>}
          <h3 id={id ? `${id}-h` : undefined}>{title}</h3>
        </div>
        {aside && <div className="tb-card__aside">{aside}</div>}
      </header>
      {children}
    </section>
  )
}

export function EmptyTab({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="tb-empty" role="status">
      <span className="tb-empty__icon">{icon ?? <CloudOff aria-hidden="true" />}</span>
      <p className="tb-empty__t">{title}</p>
      {children && <p className="tb-empty__d">{children}</p>}
    </div>
  )
}

/** Tiny "VOCÊ"/"SEU CLUBE" badge. */
export const You = ({ children = 'VOCÊ' }: { children?: ReactNode }) => <span className="lx-you tb-you">{children}</span>
