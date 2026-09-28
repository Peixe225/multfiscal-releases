/**
 * Ticker "CENTRAL LENDA" (rodapé de TV): tabela ao vivo da liga do jogador + manchetes.
 * Crawl de 70 s que pausa no hover/foco; estático e rolável com movimento reduzido.
 */
import { memo, useMemo } from 'react'
import { useImmersive } from '@/store/immersive'
import { Crest, cx, useReducedMotion } from '@/ui/primitives'
import { getClub } from '@/store/data'
import { TrophyArt } from '@/ui/trophies'
import { compInfo, userLeagueId } from '../model/view'

export const ImTicker = memo(function ImTicker() {
  const s = useImmersive((x) => x.state)
  const engine = useImmersive((x) => x.engine)
  const data = useImmersive((x) => x.data)
  const rm = useReducedMotion()
  const table = useMemo(() => {
    if (!s || !engine || !data) return []
    try {
      return engine.liveTable(data, s)
    } catch {
      return []
    }
  }, [s, engine, data])
  if (!s) return null
  const league = compInfo(userLeagueId(s))
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
        return (
          <span key={`${dup}-${r.clubId}`} className={cx('lx-ticker__it', r.clubId === s.clubId && 'is-me')}>
            <span className="lx-ticker__pos">{i + 1}</span>
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
        Central Lenda
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
