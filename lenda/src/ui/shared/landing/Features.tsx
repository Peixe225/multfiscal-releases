/** "Tudo o que uma carreira de verdade tem" — four feature cards; the last one uses the REAL Brasileirão table. */
import { memo, useMemo } from 'react'
import { useData } from '@/store/data'
import { Crest, Eyebrow } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import { liveLeagues, sortRows, zonesFor } from '@/ui/shared/live/leagues'

function MiniTable() {
  const data = useData((s) => s.data)
  const index = useData((s) => s.index)
  const view = useMemo(() => {
    if (!data || !index) return null
    const league = liveLeagues(data).find((l) => l.relegation > 0 && (data.standings[l.id]?.length ?? 0) >= 10 && !data.standings[l.id]!.some((r) => r.group))
    if (!league) return null
    const rows = sortRows(data.standings[league.id]!)
    const zones = zonesFor(league, rows.length, data)
    const pick = [0, 1, 2, rows.length - 3, rows.length - 2, rows.length - 1]
    return { league, items: pick.map((i) => ({ pos: i + 1, row: rows[i], club: index.clubById.get(rows[i].clubId), zone: zones[i + 1] })) }
  }, [data, index])
  if (!view) return <TrophyArt id="brasileirao" size={118} />
  return (
    <div className="ld-mt" aria-label={`${view.league.shortName}: topo e zona de rebaixamento`}>
      {view.items.map((it, k) => (
        <div key={it.pos}>
          {k === 3 && <div className="ld-mt__gap" aria-hidden="true" />}
          <div className="ld-mt__row">
            <span className="ld-mt__pos">
              <span className="lx-zone" style={{ ['--zc' as string]: it.zone?.color ?? 'transparent' }} />
              {it.pos}
            </span>
            <Crest club={it.club ?? { id: it.row.clubId }} size={16} decorative />
            <span className="truncate font-semibold">{it.club?.shortName ?? it.row.clubId}</span>
            <b>{it.row.points}</b>
          </div>
        </div>
      ))}
    </div>
  )
}

export const Features = memo(function Features() {
  return (
    <section className="ld-features" aria-labelledby="ld-feat-h">
      <div className="ld-sec-h">
        <div>
          <Eyebrow>Tudo o que uma carreira de verdade tem</Eyebrow>
          <h2 id="ld-feat-h">Taças reais. Noites que não se esquecem.</h2>
        </div>
        <p>Clubes, escudos e troféus fiéis à realidade, com as tabelas das principais ligas atualizadas no dia em que sua carreira começa.</p>
      </div>
      <div className="ld-feats">
        <article className="ld-feat lx-glass">
          <div className="ld-feat__art">
            <TrophyArt id="ballon-dor" size={118} />
          </div>
          <h3>Bola de Ouro</h3>
          <p>Ranking anual com cerimônia. Brigue com as estrelas do mundo pelo prêmio máximo.</p>
        </article>
        <article className="ld-feat lx-glass">
          <div className="ld-feat__art">
            <TrophyArt id="world-cup" size={118} />
          </div>
          <h3>Copa do Mundo</h3>
          <p>Convocações, Eliminatórias e Copas a cada 4 anos — 2030, 2034, 2038…</p>
        </article>
        <article className="ld-feat lx-glass">
          <div className="ld-feat__art">
            <TrophyArt id="golden-boot" size={118} />
          </div>
          <h3>Chuteira de Ouro</h3>
          <p>Artilharia de cada liga e a Chuteira de Ouro europeia para quem balança as redes.</p>
        </article>
        <article className="ld-feat lx-glass" style={{ ['--fg' as string]: 'rgba(62,230,164,.14)' }}>
          <div className="ld-feat__art">
            <MiniTable />
          </div>
          <h3>Acesso e rebaixamento</h3>
          <p>Tabelas reais com G4, Sul-Americana e Z4. Seu clube pode subir — ou cair com você.</p>
        </article>
      </div>
    </section>
  )
})
