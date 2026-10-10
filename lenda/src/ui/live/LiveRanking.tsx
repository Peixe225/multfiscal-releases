/**
 * Ranking da live de hoje (src/live/ranking.ts) na tela: entre uma carreira e outra (fim de carreira) e o
 * recorde do dia no palco. Numa live de verdade, as lendas do simulador não aparecem.
 */
import { useEffect } from 'react'
import { Trophy } from 'lucide-react'
import { creatorLabel, refreshRanking, useLiveRanking, visibleRanking, type RankEntry } from '@/live/ranking'
import { realSource, useLive } from '@/live/store'
import { cx } from '@/ui/primitives'
import './live.css'

/** Lendas de hoje que podem aparecer nesta live (com a fonte atual). */
export function useTodayRanking(): { list: RankEntry[]; last: { id: string; record: boolean } | null } {
  const list = useLiveRanking((s) => s.list)
  const last = useLiveRanking((s) => s.last)
  const source = useLive((s) => s.source)
  // abriu a janela (ou virou o dia): lê o ranking de hoje do armazenamento
  useEffect(() => {
    refreshRanking()
  }, [])
  return { list: visibleRanking(list, realSource(source)), last }
}

/** Ranking compacto (top `limit`) + recorde do dia. `highlight` = a carreira que acabou de terminar. */
export function LiveRanking({ highlight, limit = 5 }: { highlight?: string; limit?: number }) {
  const { list, last } = useTodayRanking()
  if (!list.length) return null
  const best = list[0]
  const top = list.slice(0, limit)
  const mine = highlight ? list.findIndex((e) => e.id === highlight) : -1
  const record = !!highlight && last?.id === highlight && last.record
  return (
    <section className={cx('lv-rank', record && 'is-record')} aria-label="Ranking da live de hoje">
      <header className="lv-rank__head">
        <span className="lv-rank__k">
          <Trophy size={14} aria-hidden="true" /> Ranking da live de hoje
        </span>
        {list.length > 1 && <span className="lv-rank__n tabular-nums">{list.length} lendas</span>}
      </header>
      {record && <p className="lv-rank__party">Novo recorde do dia! 🏆</p>}
      <ol className="lv-rank__list">
        {top.map((e, i) => (
          <li key={e.id} className={cx(i === 0 && 'is-top', e.id === highlight && 'is-me')}>
            <span className="lv-rank__pos tabular-nums">{i + 1}</span>
            <span className="lv-rank__name">{e.surname}</span>
            {e.tier && <span className="lv-rank__tier">{e.tier}</span>}
            <span className="lv-rank__by">{creatorLabel(e)}</span>
            <b className="lv-rank__score tabular-nums">{e.score}</b>
          </li>
        ))}
      </ol>
      {mine >= limit && (
        <p className="lv-rank__me">
          Esta lenda ficou em <b>{mine + 1}º</b> hoje, com nota {list[mine].score}.
        </p>
      )}
      <p className="lv-rank__best">
        Recorde do dia: <b>nota {best.score}</b> — {best.surname}, criada por {creatorLabel(best)}
      </p>
    </section>
  )
}

/** Uma linha só, para o palco: "Recorde do dia: nota 82 — SILVA, criada por @ana". */
export function DayRecordLine() {
  const { list } = useTodayRanking()
  const best = list[0]
  if (!best) return null
  return (
    <p className="lv-rank__line">
      <Trophy size={15} aria-hidden="true" /> Recorde do dia: <b>nota {best.score}</b> — {best.surname}, criada por {creatorLabel(best)}
    </p>
  )
}
