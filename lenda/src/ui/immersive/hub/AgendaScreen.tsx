/**
 * Agenda da temporada: uma faixa por semana em trilho fixo (semana | compromissos | resultado),
 * separadores de mês, faixa listrada na janela de transferências e a semana atual em destaque
 * (rolada para logo abaixo do cabeçalho, sem cortar a barra do topo).
 */
import { useEffect, useMemo, useRef } from 'react'
import { CalendarDays, Repeat2 } from 'lucide-react'
import type { CalendarItem } from '@/engine/immersive/types'
import { useImmersive } from '@/store/immersive'
import { cx, useReducedMotion } from '@/ui/primitives'
import { DayCard } from './panels'
import { TeamMark } from '../bits'
import { compInfo, resultLetter, teamInfo } from '../model/view'

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

function WeekResult({ list, cursor }: { list: { it: CalendarItem; idx: number }[]; cursor: number }) {
  const games = list.filter(({ it }) => it.kind === 'match' || it.kind === 'national_match')
  if (!games.length) return <span className="im-week__res is-none">Sem jogo</span>
  return (
    <span className="im-week__res">
      {games.map(({ it, idx }) => {
        const opp = it.opponentId ? teamInfo(it.opponentId) : null
        const r = it.result ? resultLetter(it) : null
        const sc = it.result ? (it.home === false ? `${it.result.score[1]}–${it.result.score[0]}` : `${it.result.score[0]}–${it.result.score[1]}`) : null
        return (
          <span key={it.id} className={cx('im-wres', idx === cursor && 'is-now')}>
            {opp && <TeamMark team={opp} size={20} />}
            <b className="truncate">
              {it.home === false ? '@ ' : 'vs '}
              {opp?.abbr ?? '—'}
            </b>
            {sc ? (
              <>
                <span className="lx-form" data-r={r ?? 'E'}>
                  {r}
                </span>
                <b className="num">{sc}</b>
              </>
            ) : (
              <small className="truncate">{it.stage ?? compInfo(it.competitionId).short}</small>
            )}
          </span>
        )
      })}
    </span>
  )
}

export default function AgendaScreen() {
  const s = useImmersive((x) => x.state)!
  const rm = useReducedMotion()
  const cur = useRef<HTMLElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const weeks = useMemo(() => {
    const m = new Map<number, { it: CalendarItem; idx: number }[]>()
    s.calendar.forEach((it, idx) => {
      if (!m.has(it.week)) m.set(it.week, [])
      m.get(it.week)!.push({ it, idx })
    })
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [s.calendar])
  // a lista rola por dentro: a semana atual sobe para o topo da lista sem esconder a barra e o título
  useEffect(() => {
    const t = setTimeout(() => {
      const box = list.current
      const el = cur.current
      if (!box || !el) return
      // logo abaixo do cabeçalho fixo da lista (sem "fatia" da semana anterior aparecendo)
      const head = (box.querySelector('.im-week.is-head') as HTMLElement | null)?.offsetHeight ?? 24
      box.scrollTo({ top: Math.max(0, el.offsetTop - head - 6), behavior: rm ? 'auto' : 'smooth' })
    }, 60)
    return () => clearTimeout(t)
  }, [rm])
  const played = s.calendar.filter((c) => (c.kind === 'match' || c.kind === 'national_match') && c.result).length
  const total = s.calendar.filter((c) => c.kind === 'match' || c.kind === 'national_match').length
  let lastMonth = ''
  return (
    <main id="conteudo" tabIndex={-1} className="im-wrap im-agendapage outline-none">
      <header className="im-hub__head lx-anim-rise">
        <div>
          <span className="lx-kicker">
            <CalendarDays size={13} aria-hidden="true" /> Temporada {s.season} · {played}/{total} jogos disputados
          </span>
          <h1 className="lx-t-display im-hub__title">Agenda</h1>
        </div>
        <div className="im-agenda__legend lx-t-small" aria-hidden="true">
          <span>
            <i className="lx-window-band" /> Janela de transferências
          </span>
          <span>
            <i className="is-now" /> Semana atual
          </span>
        </div>
      </header>
      <div className="im-weeks" ref={list}>
        <div className="im-week is-head" aria-hidden="true">
          <span>Semana</span>
          <span>Compromissos</span>
          <span>Jogo da semana</span>
        </div>
        {weeks.map(([w, list]) => {
          const now = list.some((x) => x.idx === s.cursor)
          const past = list.every((x) => x.idx < s.cursor)
          const first = list[0].it
          const month = first.month ? `${MONTHS[first.month - 1]} ${first.year ?? ''}`.trim() : ''
          const showMonth = !!month && month !== lastMonth
          if (month) lastMonth = month
          const window = list.some((x) => x.it.kind === 'transfer_window')
          return (
            <section key={w} ref={now ? cur : undefined} className={cx('im-week', now && 'is-now', past && 'is-past', window && 'has-window')} aria-label={w === 0 ? 'Pré-temporada' : `Semana ${w}`}>
              {showMonth && <span className="im-week__month">{month}</span>}
              <span className="im-week__n">
                <small>{w === 0 ? 'Pré' : 'Sem'}</small>
                <b className="num">{w === 0 ? '—' : w}</b>
                {window && <Repeat2 size={13} aria-label="Janela de transferências" className="im-week__win" />}
              </span>
              <div className="im-week__items">
                {list.map(({ it, idx }) => (
                  <DayCard key={it.id} it={it} s={s} state={idx < s.cursor ? 'past' : idx === s.cursor ? 'today' : 'next'} />
                ))}
              </div>
              <WeekResult list={list} cursor={s.cursor} />
            </section>
          )
        })}
      </div>
    </main>
  )
}
