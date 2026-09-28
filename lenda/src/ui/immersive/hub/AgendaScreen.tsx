/**
 * Agenda da temporada: todas as semanas com seus itens (treinos, jogos, coletivas, janelas,
 * convocações), resultados dos jogos já disputados e a semana atual em destaque.
 */
import { useEffect, useMemo, useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import type { CalendarItem } from '@/engine/immersive/types'
import { useImmersive } from '@/store/immersive'
import { cx } from '@/ui/primitives'
import { DayCard } from './panels'

export default function AgendaScreen() {
  const s = useImmersive((x) => x.state)!
  const cur = useRef<HTMLDivElement>(null)
  const weeks = useMemo(() => {
    const m = new Map<number, { it: CalendarItem; idx: number }[]>()
    s.calendar.forEach((it, idx) => {
      if (!m.has(it.week)) m.set(it.week, [])
      m.get(it.week)!.push({ it, idx })
    })
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [s.calendar])
  useEffect(() => {
    cur.current?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
  }, [])
  const played = s.calendar.filter((c) => (c.kind === 'match' || c.kind === 'national_match') && c.result).length
  const total = s.calendar.filter((c) => c.kind === 'match' || c.kind === 'national_match').length
  return (
    <main id="conteudo" tabIndex={-1} className="im-wrap im-agendapage outline-none">
      <header className="im-hub__head lx-anim-rise">
        <div>
          <span className="lx-kicker">
            <CalendarDays size={13} aria-hidden="true" /> Temporada {s.season} · {played}/{total} jogos
          </span>
          <h1 className="lx-t-display im-hub__title">Agenda</h1>
        </div>
      </header>
      <div className="im-weeks">
        {weeks.map(([w, list]) => {
          const now = list.some((x) => x.idx === s.cursor)
          const past = list.every((x) => x.idx < s.cursor)
          return (
            <section key={w} ref={now ? cur : undefined} className={cx('im-week', now && 'is-now', past && 'is-past')} aria-label={w === 0 ? 'Pré-temporada' : `Semana ${w}`}>
              <span className="im-week__n">
                <small>{w === 0 ? 'Pré' : 'Sem'}</small>
                <b className="num">{w === 0 ? '—' : w}</b>
              </span>
              <div className="im-week__items">
                {list.map(({ it, idx }) => (
                  <DayCard key={it.id} it={it} s={s} state={idx < s.cursor ? 'past' : idx === s.cursor ? 'today' : 'next'} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}
