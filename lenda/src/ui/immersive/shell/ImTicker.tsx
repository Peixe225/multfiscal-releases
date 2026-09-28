/**
 * Tickers de TV (rodapé):
 *  - "CENTRAL LENDA" (fora da partida): tabela ao vivo da liga do jogador (posição com a cor da zona)
 *    + manchetes. Crawl que pausa no hover/foco; estático e rolável com movimento reduzido.
 *  - "AO VIVO · OUTROS JOGOS" (durante a partida): placares da rodada no relógio da transmissão.
 */
import { memo, useMemo } from 'react'
import type { LiveMatch } from '@/engine/immersive/types'
import { useImmersive } from '@/store/immersive'
import { Crest, cx, useReducedMotion } from '@/ui/primitives'
import { getClub, getLeague } from '@/store/data'
import { TrophyArt } from '@/ui/trophies'
import { compInfo, userLeagueId, zoneOf } from '../model/view'
import { roundGames, scoreAt } from '../model/round'

function useTable() {
  const s = useImmersive((x) => x.state)
  const engine = useImmersive((x) => x.engine)
  const data = useImmersive((x) => x.data)
  return useMemo(() => {
    if (!s || !engine || !data) return []
    try {
      return engine.liveTable(data, s)
    } catch {
      return []
    }
  }, [s, engine, data])
}

export const ImTicker = memo(function ImTicker() {
  const s = useImmersive((x) => x.state)
  const rm = useReducedMotion()
  const table = useTable()
  if (!s) return null
  const league = compInfo(userLeagueId(s))
  const lg = getLeague(userLeagueId(s))
  const round = table.length ? Math.max(...table.map((r) => r.played)) : 0
  const news = s.news.slice(0, 4)
  const row = (dup: boolean) => (
    <>
      {league.id && (
        <span className="lx-ticker__sec">
          {league.trophyId && <TrophyArt id={league.trophyId} size={18} variant="svg" />}
          {league.short} {s.season}
          {round ? ` · ${round}ª rodada` : ''}
        </span>
      )}
      {table.slice(0, 10).map((r, i) => {
        const c = getClub(r.clubId)
        const z = zoneOf(lg, i + 1, table.length)
        return (
          <span key={`${dup}-${r.clubId}`} className={cx('lx-ticker__it', r.clubId === s.clubId && 'is-me')}>
            <span className={cx('lx-ticker__pos', z && `is-${z}`)}>{i + 1}</span>
            {c && <Crest club={c} size={20} decorative />}
            <b>{c?.abbr ?? r.clubId}</b>
            <span className="lx-ticker__pts">{r.points}</span>
          </span>
        )
      })}
      {table.length > 10 &&
        table.slice(-4).map((r, k) => {
          const i = table.length - 4 + k
          const c = getClub(r.clubId)
          const z = zoneOf(lg, i + 1, table.length)
          return (
            <span key={`${dup}-z-${r.clubId}`} className={cx('lx-ticker__it', r.clubId === s.clubId && 'is-me')}>
              <span className={cx('lx-ticker__pos', z && `is-${z}`)}>{i + 1}</span>
              {c && <Crest club={c} size={20} decorative />}
              <b>{c?.abbr ?? r.clubId}</b>
              <span className="lx-ticker__pts">{r.points}</span>
            </span>
          )
        })}
      {news.length > 0 && <span className="lx-ticker__sec">Manchetes</span>}
      {news.map((n) => (
        <span key={`${dup}-${n.id}`} className="lx-ticker__it">
          <i className="lx-ticker__sep" aria-hidden="true" />
          <span>
            <b>{n.outlet}</b> · {n.headline}
          </span>
        </span>
      ))}
    </>
  )
  return (
    <div className={cx('lx-ticker im-ticker', rm && 'is-static')} role="region" aria-label="Central Lenda: tabela e manchetes">
      <span className="lx-ticker__tag">
        <span className="lx-chip lx-chip--live lx-chip--sm">Ao vivo</span>
        <span className="im-ticker__tagt">Central Lenda</span>
      </span>
      <div className="lx-ticker__vp">
        <div className="lx-ticker__track" style={{ ['--lx-crawl-dur' as string]: '80s' }}>
          <span className="inline-flex items-center">{row(false)}</span>
          {!rm && (
            <span className="inline-flex items-center" aria-hidden="true">
              {row(true)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
})

/** Durante a partida: os outros jogos da rodada (placar no relógio exibido) + a classificação. */
export const LiveTicker = memo(function LiveTicker({ live, clock, done }: { live: LiveMatch; clock: number; done: boolean }) {
  const s = useImmersive((x) => x.state)!
  const rm = useReducedMotion()
  const table = useTable()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const games = useMemo(() => roundGames(s, live), [live.itemId, s.engine])
  const lg = getLeague(userLeagueId(s))
  const ht = live.phase === 'half_time'
  const minute = done ? 'FIM' : ht ? 'INT' : live.phase === 'pre' ? '—' : `${Math.min(90, Math.floor(clock))}'`
  const row = (dup: boolean) => (
    <>
      {games.length > 0 && <span className="lx-ticker__sec">Outros jogos · {compInfo(live.competitionId).short}</span>}
      {games.map((g) => {
        const h = getClub(g.home)
        const a = getClub(g.away)
        const [x, y] = scoreAt(g, live.phase === 'pre' ? 0 : clock, done)
        return (
          <span key={`${dup}-${g.home}`} className="lx-ticker__it im-tk-game">
            {h && <Crest club={h} size={20} decorative />}
            <b>{h?.abbr ?? g.home}</b>
            <span className="im-tk-game__sc num">
              {x}–{y}
            </span>
            <b>{a?.abbr ?? g.away}</b>
            {a && <Crest club={a} size={20} decorative />}
            <span className={cx('im-tk-game__min num', (done || ht) && 'is-stop')}>{minute}</span>
          </span>
        )
      })}
      {table.length > 0 && <span className="lx-ticker__sec">Classificação</span>}
      {table.slice(0, 8).map((r, i) => {
        const c = getClub(r.clubId)
        const z = zoneOf(lg, i + 1, table.length)
        return (
          <span key={`${dup}-t-${r.clubId}`} className={cx('lx-ticker__it', r.clubId === s.clubId && 'is-me')}>
            <span className={cx('lx-ticker__pos', z && `is-${z}`)}>{i + 1}</span>
            {c && <Crest club={c} size={20} decorative />}
            <b>{c?.abbr ?? r.clubId}</b>
            <span className="lx-ticker__pts">{r.points}</span>
          </span>
        )
      })}
      {s.news.slice(0, 2).map((n) => (
        <span key={`${dup}-${n.id}`} className="lx-ticker__it">
          <i className="lx-ticker__sep" aria-hidden="true" />
          <span>
            <b>{n.outlet}</b> · {n.headline}
          </span>
        </span>
      ))}
    </>
  )
  return (
    <div className={cx('lx-ticker im-ticker im-ticker--live', rm && 'is-static')} role="region" aria-label="Ao vivo: outros jogos da rodada">
      <span className="lx-ticker__tag">
        <span className="lx-chip lx-chip--live lx-chip--sm">Ao vivo</span>
        <span className="im-ticker__tagt">{games.length ? 'Outros jogos' : 'Central Lenda'}</span>
      </span>
      <div className="lx-ticker__vp">
        <div className="lx-ticker__track" style={{ ['--lx-crawl-dur' as string]: '70s' }}>
          <span className="inline-flex items-center">{row(false)}</span>
          {!rm && (
            <span className="inline-flex items-center" aria-hidden="true">
              {row(true)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
})
