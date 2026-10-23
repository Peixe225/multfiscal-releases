/**
 * Right column: tab header (Carreira · Temporada · Prêmios · Mundo) + the career table.
 * The other three tabs live in src/ui/classic/tabs (tabs team) and are code-split: each one has its own error
 * boundary, so a chunk that did not arrive (no internet) only shows a notice in that tab — the career goes on.
 */
import { Component, Suspense, lazy, memo, useEffect, useRef, useState, type ComponentType, type ErrorInfo, type LazyExoticComponent, type ReactNode } from 'react'
import { ChartLine, Clock, RefreshCw, RotateCcw, Sparkles, WifiOff } from 'lucide-react'
import { Button, Skeleton, TabPanel, Tabs, formatSeason, useIsWide, useMediaQuery, useReducedMotion, type TabItem } from '@/ui/primitives'
import { useReveal } from '@/ui/classic/reveal/store'
import { pinnedSeason, useTabSeason } from '@/ui/classic/tabs/model'
import { getLeague } from '@/store/data'
import { CareerTable } from './CareerTable'
import { PACE_SEASONS, LAST_AGE } from './model'
import { TAB_LOADERS, ehFalhaDePedaco, importarDeNovo, type TabKey } from './chunks'
import type { CockpitData } from './view'

type Tab = 'carreira' | TabKey

/** Um lazy por aba; depois de uma falha, a nova tentativa troca por um lazy novo (o React guarda a rejeição). */
const tabLazy: Record<TabKey, { atual: LazyExoticComponent<ComponentType>; erro: unknown }> = {
  temporada: { atual: lazy(TAB_LOADERS.temporada), erro: null },
  premios: { atual: lazy(TAB_LOADERS.premios), erro: null },
  mundo: { atual: lazy(TAB_LOADERS.mundo), erro: null },
}
function novaTentativa(k: TabKey) {
  const e = tabLazy[k]
  const antes = e.erro
  e.atual = lazy(() => importarDeNovo(TAB_LOADERS[k], antes))
}

export const RightPanel = memo(function RightPanel({ data, compactFuture }: { data: CockpitData; compactFuture?: boolean }) {
  const [tab, setTab] = useState<Tab>('carreira')
  const wide = useIsWide()
  const phone = !useMediaQuery('(min-width: 36rem)')
  const rm = useReducedMotion()
  const panel = useRef<HTMLElement>(null)
  // phones/tablets: the decision sheet covers the lower half — fold it and bring the tab into view
  // (and unfold it again when the player comes back to "Carreira", if we were the ones who folded it)
  const folded = useRef(false)
  const pickTab = (t: Tab) => {
    setTab(t)
    if (wide) return
    const R = useReveal.getState()
    if (t === 'carreira') {
      if (folded.current && R.sheetCollapsed && R.phase === 'idle') R.set({ sheetCollapsed: false })
      folded.current = false
      return
    }
    if (R.phase === 'idle' && !R.sheetCollapsed) {
      R.set({ sheetCollapsed: true })
      folded.current = true
    }
    requestAnimationFrame(() => panel.current?.scrollIntoView({ block: 'start', behavior: rm ? 'auto' : 'smooth' }))
  }
  const { state, gates } = data
  const shown = data.trophySeasons
  const last = data.visibleSeasons[data.visibleSeasons.length - 1]
  // the tab names the season the three tabs show: the latest one, or the one pinned on the rail
  const pin = useTabSeason((s) => pinnedSeason(s, last?.season))
  const shownRec = (pin != null && data.visibleSeasons.find((r) => r.season === pin)) || last
  const lg = getLeague(shownRec?.leagueId)
  const season = shownRec ? formatSeason(shownRec.season, lg?.calendar) : String(state.season)
  const podium = [...shown].reverse().find((r) => r.awards.some((a) => a.award === 'ballon_dor'))
  const bola = podium?.awards.find((a) => a.award === 'ballon_dor')
  const badge = bola && podium === shown[shown.length - 1] ? (bola.place === 1 ? 'BOLA DE OURO' : `BOLA ${bola.place}º`) : undefined
  const tabs: TabItem<Tab>[] = [
    { value: 'carreira', label: 'Carreira', icon: ChartLine },
    // phones: "Temporada 34/35" (the rail below spells the season out)
    { value: 'temporada', label: `Temporada ${phone ? season.replace(/^\d\d(\d\d\/\d\d)$/, '$1') : season}`, disabled: !last },
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
    <section ref={panel} className="lx-glass lx-club-panel ck-panel" aria-label="Painel da carreira">
      <div className="ck-panel__tabs">
        <Tabs aria-label="Painel da carreira" idPrefix="ck" value={tab} onChange={pickTab} tabs={tabs} className="ck-tabs no-scrollbar" />
        {aside}
      </div>
      <TabPanel idPrefix="ck" value="carreira" active={tab === 'carreira'} keepMounted>
        <CareerTable data={data} compactFuture={compactFuture} />
      </TabPanel>
      {tab !== 'carreira' && (
        <div className="ck-panel__body">
          <TabPanel idPrefix="ck" value={tab} active>
            <LazyTab key={tab} k={tab} />
          </TabPanel>
        </div>
      )}
    </section>
  )
})

/** Uma aba sob demanda, com a sua própria barreira: sem rede, o aviso fica só nela. */
function LazyTab({ k }: { k: TabKey }) {
  const [vez, setVez] = useState(0)
  const C = tabLazy[k].atual
  return (
    <TabBarrier
      key={vez}
      onRetry={() => {
        novaTentativa(k)
        setVez((n) => n + 1)
      }}
      onError={(e) => (tabLazy[k].erro = e)}
      retried={vez > 0}
    >
      <Suspense fallback={<Skeleton w="100%" h={320} r={16} />}>
        <C />
      </Suspense>
    </TabBarrier>
  )
}

class TabBarrier extends Component<{ children: ReactNode; onRetry: () => void; onError: (e: unknown) => void; retried: boolean }, { erro: unknown }> {
  state: { erro: unknown } = { erro: null }
  static getDerivedStateFromError(erro: unknown) {
    return { erro }
  }
  componentDidCatch(e: unknown, info: ErrorInfo) {
    // falha de rede é esperada (túnel, elevador): aviso, não erro
    if (ehFalhaDePedaco(e)) console.warn('[LENDA] aba sem conexão', String((e as Error)?.message ?? e))
    else console.error('[LENDA] erro na aba', e, info.componentStack)
    this.props.onError(e)
  }
  render() {
    if (this.state.erro == null) return this.props.children
    return <TabOffline erro={this.state.erro} onRetry={this.props.onRetry} retried={this.props.retried} />
  }
}

function TabOffline({ erro, onRetry, retried }: { erro: unknown; onRetry: () => void; retried: boolean }) {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const rede = ehFalhaDePedaco(erro)
  // a internet voltou (evento "online" depois da falha): tenta sozinho uma vez
  const retry = useRef(onRetry)
  retry.current = onRetry
  useEffect(() => {
    let tentou = false
    const on = () => {
      setOnline(true)
      if (rede && !tentou) {
        tentou = true
        window.setTimeout(() => retry.current(), 600)
      }
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [rede])
  const semRede = rede && !online
  return (
    <div className="ck-taberr" role="alert">
      <span className="ck-taberr__ic" aria-hidden="true">
        <WifiOff />
      </span>
      <b className="ck-taberr__t">{semRede || rede ? 'Sem conexão: esta aba abre quando a internet voltar' : 'Esta aba não abriu'}</b>
      <p className="ck-taberr__d">
        {semRede
          ? 'A sua carreira continua: dá para seguir escolhendo e ver a tabela na aba Carreira.'
          : rede && retried
            ? 'O navegador guardou a falha. Recarregue a página: a sua carreira está salva neste aparelho e volta de onde parou.'
            : 'A sua carreira continua na aba Carreira. Tente de novo.'}
      </p>
      <div className="ck-taberr__act">
        <Button variant="primary" size="md" icon={RotateCcw} onClick={onRetry}>
          Tentar de novo
        </Button>
        {retried && online && (
          <Button variant="ghost" size="md" icon={RefreshCw} onClick={() => location.reload()}>
            Recarregar a página
          </Button>
        )}
      </div>
    </div>
  )
}
