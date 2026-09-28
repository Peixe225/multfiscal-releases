/**
 * Right column: tab header (Carreira · Temporada · Prêmios · Mundo) + the career table.
 * The other three tabs live in src/ui/classic/tabs (tabs team) and are code-split.
 */
import { Suspense, lazy, memo, useState } from 'react'
import { ChartLine, Clock, Sparkles } from 'lucide-react'
import { Skeleton, TabPanel, Tabs, formatSeason, type TabItem } from '@/ui/primitives'
import { getLeague } from '@/store/data'
import { CareerTable } from './CareerTable'
import { PACE_SEASONS, LAST_AGE } from './model'
import type { CockpitData } from './view'

const SeasonTab = lazy(() => import('@/ui/classic/tabs/SeasonTab'))
const AwardsTab = lazy(() => import('@/ui/classic/tabs/AwardsTab'))
const WorldTab = lazy(() => import('@/ui/classic/tabs/WorldTab'))

type Tab = 'carreira' | 'temporada' | 'premios' | 'mundo'

export const RightPanel = memo(function RightPanel({ data, compactFuture }: { data: CockpitData; compactFuture?: boolean }) {
  const [tab, setTab] = useState<Tab>('carreira')
  const { state, gates } = data
  const shown = data.trophySeasons
  const last = data.visibleSeasons[data.visibleSeasons.length - 1]
  const lg = getLeague(last?.leagueId)
  const season = last ? formatSeason(last.season, lg?.calendar) : String(state.season)
  const podium = [...shown].reverse().find((r) => r.awards.some((a) => a.award === 'ballon_dor'))
  const bola = podium?.awards.find((a) => a.award === 'ballon_dor')
  const badge = bola && podium === shown[shown.length - 1] ? (bola.place === 1 ? 'BOLA DE OURO' : `BOLA ${bola.place}º`) : undefined
  const tabs: TabItem<Tab>[] = [
    { value: 'carreira', label: 'Carreira', icon: ChartLine },
    { value: 'temporada', label: `Temporada ${season}`, disabled: !last },
    { value: 'premios', label: 'Prêmios', badge },
    { value: 'mundo', label: 'Mundo', disabled: !last },
  ]
  const per = PACE_SEASONS[state.pace]
  const left = Math.max(0, LAST_AGE - state.age + 1)
  const next = Math.min(per, left)
  const finished = state.phase === 'finished' || state.retired
  const aside = gates.revealing ? (
    <span className="ck-aside is-live" aria-live="polite">
      <Sparkles aria-hidden="true" /> Simulando {data.newSeasons.size > 1 ? `${data.newSeasons.size} temporadas` : 'a temporada'}…
    </span>
  ) : finished ? (
    <span className="ck-aside">Carreira encerrada</span>
  ) : state.pendingDecision ? (
    <span className="ck-aside">
      <Clock aria-hidden="true" /> Próxima decisão em {next} {next === 1 ? 'temporada' : 'temporadas'}
    </span>
  ) : null

  return (
    <section className="lx-glass lx-club-panel ck-panel" aria-label="Painel da carreira">
      <div className="ck-panel__tabs">
        <Tabs aria-label="Painel da carreira" idPrefix="ck" value={tab} onChange={setTab} tabs={tabs} className="ck-tabs no-scrollbar" />
        {aside}
      </div>
      <TabPanel idPrefix="ck" value="carreira" active={tab === 'carreira'} keepMounted>
        <CareerTable data={data} compactFuture={compactFuture} />
      </TabPanel>
      {tab !== 'carreira' && (
        <div className="ck-panel__body">
          <Suspense fallback={<Skeleton w="100%" h={320} r={16} />}>
            <TabPanel idPrefix="ck" value="temporada" active={tab === 'temporada'}>
              <SeasonTab />
            </TabPanel>
            <TabPanel idPrefix="ck" value="premios" active={tab === 'premios'}>
              <AwardsTab />
            </TabPanel>
            <TabPanel idPrefix="ck" value="mundo" active={tab === 'mundo'}>
              <WorldTab />
            </TabPanel>
          </Suspense>
        </div>
      )}
    </section>
  )
})
