/**
 * Hall das Lendas (rota "#/hall") — as runs do jogador (carreiras encerradas neste navegador)
 * contra 50 lendas reais, na mesma escala: a Nota de Legado (src/engine/legacy).
 *
 *   hero ........ sua melhor run × o nº 1 do Hall (duelo por categoria, próximo alvo)
 *   ranking ..... geral misto (runs destacadas com OVR/escudo, lendas com bandeira)
 *   categorias .. 11 abas com pódio e top 10 (Bolas de Ouro … Média de gols)
 *   suas runs ... cards → detalhe (composição da nota, recordes, comparações, resumo)
 *
 * `#/hall?run=<id>` abre o detalhe de uma run (link do Resumo).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, ChevronDown, Crown, Info, Play, Quote, Sparkles, Swords, Zap } from 'lucide-react'
import { CATEGORIES, CATEGORY_IDS, LEGACY_WEIGHTS, compareRun, nextTarget, type CategoryId, type LegendLegacy, type RankEntry, type RankRow, type RunLegacy } from '@/engine/legacy'
import { navigate, useApp } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
import { useClub, useCountry } from '@/store/data'
import { Button, Eyebrow, POSITION_LABEL, Segmented, clubVars, cx, formatInt, rowClubVars, useReducedMotion } from '@/ui/primitives'
import { useShellSlots } from '@/ui/shell/slots'
import { clubKit } from '@/ui/shared/identity/kit'
import { PlayerCard } from '@/ui/shared/landing/PlayerCard'
import { CategoryGlyph, EntryAvatar, KeyTrophies, LegendAvatar, LegendCrests, NotaRing, RunAvatar, RunCrests, entryName, valueOf } from './parts'
import { HowModal, LegendDetail, RunDetail } from './RunDetail'
import { gapText, runHeadline, useHallModel, yearsLabel, type HallModel } from './model'
import '@/ui/shared/achievements/unlockToasts'
import './hall.css'

type Filter = 'todos' | 'runs' | 'lendas'
const EASE = [0.16, 1, 0.3, 1] as const
const TOP_ROWS = 12

export default function HallScreen() {
  useShellSlots({ sub: 'HALL DAS LENDAS', stage: { preset: 'legend' } })
  const hall = useHallModel()
  const q = useApp((s) => s.route.query.run)
  const [open, setOpen] = useState<RankEntry | null>(null)
  const [how, setHow] = useState(false)

  // o detalhe aberto pelo link (?run=) segue a URL: sai da URL → fecha
  const fromQuery = useRef(false)
  useEffect(() => {
    if (q) {
      const r = hall.runById.get(q)
      if (r) {
        setOpen(r)
        fromQuery.current = true
      }
    } else if (fromQuery.current) {
      fromQuery.current = false
      setOpen(null)
    }
  }, [q, hall])

  const close = () => {
    setOpen(null)
    if (q) navigate('/hall', { replace: true })
  }

  const runs = hall.runs.length
  return (
    <main id="conteudo" tabIndex={-1} className="hl-wrap outline-none">
      <header className="hl-head">
        <div>
          <Eyebrow>Hall das Lendas</Eyebrow>
          <h1>
            Onde a sua carreira <span className="lx-metal-text">encontra a história</span>
          </h1>
          <p>
            {runs
              ? `${runs === 1 ? 'Sua run' : `Suas ${runs} runs`} contra ${hall.legends.length} lendas reais, na mesma escala: a Nota de Legado, de 0 a 100.`
              : `${hall.legends.length} lendas reais já estão aqui. Termine uma carreira e descubra onde ela entra.`}
          </p>
        </div>
        <Button variant="ghost" size="sm" icon={Info} onClick={() => setHow(true)}>
          Como a nota é calculada
        </Button>
      </header>

      <Hero hall={hall} onOpen={setOpen} />
      <Overall hall={hall} onOpen={setOpen} />
      <Categories hall={hall} onOpen={setOpen} />
      {runs > 0 && <Runs hall={hall} onOpen={setOpen} />}
      <p className="hl-foot">
        Números oficiais de clubes + seleção principal até {`dez/2025`} para quem ainda joga; "≈" marca valores estimados ou com fontes divergentes. Antes de 1995 a Bola de Ouro era só para europeus — por isso Pelé, Maradona e
        Zico têm zero oficial; as Bolas retroativas da France Football (Pelé 7, Maradona 2…) valem meia na nota.
      </p>

      <RunDetail entry={open?.kind === 'run' ? open : null} hall={hall} onClose={close} />
      <LegendDetail entry={open?.kind === 'legend' ? open : null} hall={hall} onClose={close} />
      <HowModal open={how} onClose={() => setHow(false)} />
    </main>
  )
}

// ───────────────────────── hero ─────────────────────────

const DUELS: CategoryId[] = ['ballonDor', 'worldCups', 'ucl', 'libertadores', 'goldenBoots', 'leagueTitles', 'goals', 'assists']

function Hero({ hall, onOpen }: { hall: HallModel; onOpen: (e: RankEntry) => void }) {
  const rm = useReducedMotion()
  const best = hall.bestRun
  const top = hall.topLegend
  const enter = (i: number) => (rm ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.55, delay: 0.08 * i, ease: EASE } })
  return (
    <motion.section className="hl-hero lx-glass" aria-label={best ? 'Sua melhor run contra o número 1' : 'Número 1 do Hall'} {...enter(0)}>
      <div className="hl-hero__grid">
        {best ? <HeroRun run={best} hall={hall} onOpen={onOpen} /> : <HeroEmpty />}
        <div className={cx('hl-vs', !best && 'hl-vs--empty')} aria-hidden="true">
          <span>
            <Swords size={16} />
          </span>
          <b>VS</b>
          {best && <small>{best.score >= top.score ? `+${best.score - top.score}` : `−${top.score - best.score}`} pts</small>}
        </div>
        <HeroLegend legend={top} onOpen={onOpen} />
      </div>
      {best && <Duels run={best} legend={top} />}
      {best && <HeroFoot run={best} hall={hall} onOpen={onOpen} />}
    </motion.section>
  )
}

function HeroRun({ run, hall, onOpen }: { run: RunLegacy; hall: HallModel; onOpen: (e: RankEntry) => void }) {
  const entry = hall.entryById.get(run.id)
  const club = useClub(run.stats.mainClubId)
  const rank = hall.overall.find((r) => r.entry === run)?.rank ?? 0
  const id = run.input.identity
  return (
    <div className="hl-hero__side hl-hero__side--run" style={clubVars(club ?? {})}>
      <div className="hl-hero__card">
        <PlayerCard
          ovr={run.stats.peakOvr || 60}
          pos={run.stats.position}
          nationality={run.stats.nationality}
          club={club}
          kit={clubKit(club)}
          name={id.surname}
          number={id.number}
          stats={[
            ['GOL', formatInt(run.stats.goals)],
            ['TÍT', formatInt(run.stats.titles)],
            ['REC', formatInt(run.historic.length)],
          ]}
          width={176}
          decorative
        />
      </div>
      <div className="hl-hero__info">
        <span className="hl-kicker">
          <Crown size={12} aria-hidden /> Sua maior lenda · Run nº {run.runNo}
        </span>
        <h2 className="hl-hero__name">{id.surname}</h2>
        {entry && <p className="hl-hero__hl">{runHeadline(entry, run, rank)}</p>}
        <div className="hl-hero__score">
          <NotaRing score={run.score} size={78} />
          <div>
            <b className="hl-tier">{run.tier.label}</b>
            <span>
              <strong>{rank}º</strong> de {hall.overall.length} no Hall
            </span>
            <button type="button" className="hl-link" onClick={() => onOpen(run)}>
              Ver detalhes <ArrowRight size={13} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HeroEmpty() {
  const active = useCareer(selectHasActiveCareer)
  return (
    <div className="hl-hero__side hl-hero__side--empty">
      <span className="hl-kicker">
        <Sparkles size={12} aria-hidden /> Seu lugar está reservado
      </span>
      <h2 className="hl-hero__name hl-hero__name--sm">Seu nome ainda não está aqui</h2>
      <p className="hl-hero__lead">Jogue até a aposentadoria. A carreira entra no ranking com nota, recordes quebrados e comparações com Pelé, Messi e companhia.</p>
      <div className="flex gap-2 flex-wrap mt-4">
        {active ? (
          <Button variant="primary" size="lg" icon={Play} onClick={() => navigate('/carreira')}>
            Continuar carreira
          </Button>
        ) : (
          <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={() => navigate('/identidade')}>
            Começar carreira
          </Button>
        )}
      </div>
    </div>
  )
}

function useLegendCountry(l: LegendLegacy) {
  const c = useCountry(l.legend.nationality)
  return l.legend.nationality === 'URS' ? 'União Soviética' : (c?.name ?? l.legend.nationality)
}

function HeroLegend({ legend, onOpen }: { legend: LegendLegacy; onOpen: (e: RankEntry) => void }) {
  const l = legend.legend
  const country = useLegendCountry(legend)
  return (
    <div className="hl-hero__side hl-hero__side--legend">
      <div className="hl-hero__info hl-hero__info--legend">
        <span className="hl-kicker hl-kicker--gold">
          <Crown size={12} aria-hidden /> A maior lenda real
        </span>
        <h2 className="hl-hero__name">{l.name}</h2>
        <p className="hl-hero__meta">
          {country} · {POSITION_LABEL[l.position]} · {yearsLabel(l.years)}
        </p>
        <div className="hl-hero__score hl-hero__score--legend">
          <div>
            <b className="hl-tier">{legend.tier.label}</b>
            <span>{formatInt(l.goals)} gols oficiais</span>
            <button type="button" className="hl-link" onClick={() => onOpen(legend)}>
              Ficha da lenda <ArrowRight size={13} aria-hidden />
            </button>
          </div>
          <NotaRing score={legend.score} size={78} />
        </div>
      </div>
      <LegendPlaque legend={legend} />
    </div>
  )
}

export function LegendPlaque({ legend, width = 150 }: { legend: LegendLegacy; width?: number }) {
  const l = legend.legend
  return (
    <div className="hl-plaque lx-sheen" style={{ width }} aria-hidden="true">
      <span className="hl-plaque__rank">{legend.score}</span>
      <span className="hl-plaque__flag">
        <LegendAvatar legend={legend} size={Math.round(width * 0.42)} />
      </span>
      <b className="hl-plaque__name">{l.name}</b>
      <span className="hl-plaque__pos">{l.position}</span>
      <LegendCrests legend={legend} max={3} size={20} />
      <span className="hl-plaque__tier">Lenda real</span>
    </div>
  )
}

function Duels({ run, legend }: { run: RunLegacy; legend: LegendLegacy }) {
  return (
    <ul className="hl-duels" aria-label={`Sua run nº ${run.runNo} contra ${legend.legend.name}`}>
      {DUELS.map((id) => {
        const a = run.values[id]
        const b = legend.values[id]
        const sum = a + b
        const pa = sum > 0 ? (a / sum) * 100 : 50
        const win = a > b ? 'run' : b > a ? 'legend' : 'tie'
        return (
          <li key={id} className={cx('hl-duel', `is-${win}`, sum === 0 && 'is-empty')}>
            <span className="hl-duel__h">
              <CategoryGlyph id={id} size={22} />
              <span className="hl-lg">{CATEGORIES[id].label}</span>
              <span className="hl-sm">{CATEGORIES[id].short}</span>
            </span>
            <span className="hl-duel__v">
              <b className="hl-duel__a">{valueOf(run, id)}</b>
              <span className="hl-duel__bar" aria-hidden="true">
                <i style={{ width: `${pa}%` }} />
              </span>
              <b className="hl-duel__b">{valueOf(legend, id)}</b>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function HeroFoot({ run, hall, onOpen }: { run: RunLegacy; hall: HallModel; onOpen: (e: RankEntry) => void }) {
  const cmp = useMemo(() => compareRun(run, hall.legends, { max: 2 }), [run, hall.legends])
  const next = useMemo(() => nextTarget(run, hall.legends), [run, hall.legends])
  return (
    <div className="hl-hero__foot">
      {next ? (
        <button type="button" className="hl-target" onClick={() => onOpen(next.legend)}>
          <LegendAvatar legend={next.legend} size={26} />
          <span>
            <small>Próximo alvo</small>
            <b>
              {next.legend.legend.name} · {next.legend.score}
            </b>
          </span>
          <em>{gapText(next.gap)}</em>
        </button>
      ) : (
        <span className="hl-target is-top">
          <Crown size={16} aria-hidden />
          <span>
            <small>Topo do Hall</small>
            <b>Acima de todas as lendas</b>
          </span>
        </span>
      )}
      <ul className="hl-quotes">
        {cmp.map((c) => (
          <li key={c.text}>
            <Quote size={13} aria-hidden />
            <span>{c.text}</span>
          </li>
        ))}
        {!cmp.length && (
          <li>
            <Quote size={13} aria-hidden />
            <span>Ainda sem números acima de uma lenda. A próxima run pode ser a sua.</span>
          </li>
        )}
      </ul>
    </div>
  )
}

// ───────────────────────── ranking geral ─────────────────────────

function Overall({ hall, onOpen }: { hall: HallModel; onOpen: (e: RankEntry) => void }) {
  const [filter, setFilter] = useState<Filter>('todos')
  const [all, setAll] = useState(false)
  const rows = useMemo(() => hall.overall.filter((r) => filter === 'todos' || (filter === 'runs' ? r.entry.kind === 'run' : r.entry.kind === 'legend')), [hall.overall, filter])
  // top N + as runs que ficaram de fora (com separador)
  const shown = useMemo(() => {
    if (all || rows.length <= TOP_ROWS + 2) return rows.map((r) => ({ row: r, gap: false }))
    const out: { row: RankRow; gap: boolean }[] = []
    let last = -1
    rows.forEach((r, i) => {
      if (i < TOP_ROWS || r.entry.kind === 'run') {
        out.push({ row: r, gap: last >= 0 && i - last > 1 })
        last = i
      }
    })
    return out
  }, [rows, all])
  return (
    <section className="hl-panel lx-glass" aria-labelledby="hl-overall-h">
      <header className="hl-panel__h">
        <div>
          <h2 id="hl-overall-h">Ranking geral</h2>
          <p>Nota de Legado · runs e lendas na mesma régua</p>
        </div>
        {hall.runs.length > 0 && (
          <Segmented<Filter>
            size="sm"
            value={filter}
            onChange={(f) => {
              setFilter(f)
              setAll(false)
            }}
            aria-label="Filtrar ranking"
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'runs', label: 'Suas runs' },
              { value: 'lendas', label: 'Lendas' },
            ]}
          />
        )}
      </header>
      <div className="hl-table" role="table" aria-label="Ranking geral do Hall das Lendas">
        <div className="hl-row hl-row--head" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader" className="hl-row__who">
            Jogador
          </span>
          <span role="columnheader" className="hl-col-kt">
            Taças-chave
          </span>
          <span role="columnheader" className="hl-col-n">
            Gols
          </span>
          <span role="columnheader" className="hl-col-n">
            Títulos*
          </span>
          <span role="columnheader" className="hl-col-nota">
            Nota
          </span>
        </div>
        {shown.map(({ row, gap }) => (
          <OverallRow key={row.entry.id} row={row} gap={gap} onOpen={onOpen} />
        ))}
      </div>
      {!all && rows.length > shown.length && (
        <button type="button" className="hl-more" onClick={() => setAll(true)}>
          Ver ranking completo ({rows.length}) <ChevronDown size={15} aria-hidden />
        </button>
      )}
      <p className="hl-note">*Títulos nacionais de primeira divisão.</p>
    </section>
  )
}

function OverallRow({ row, gap, onOpen }: { row: RankRow; gap: boolean; onOpen: (e: RankEntry) => void }) {
  const e = row.entry
  const club = useClub(e.kind === 'run' ? e.stats.mainClubId : null)
  const style = e.kind === 'run' ? (rowClubVars(club) as CSSProperties) : undefined
  return (
    <>
      {gap && (
        <div className="hl-gap" role="presentation" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
      <button type="button" role="row" className={cx('hl-row', e.kind === 'run' ? 'is-run lx-club-row lx-club-row--filled' : 'is-legend', row.rank <= 3 && `is-top${row.rank}`)} style={style} onClick={() => onOpen(e)}>
        <span role="cell" className="hl-row__pos">
          {row.rank}
        </span>
        <span role="cell" className="hl-row__who">
          <EntryAvatar entry={e} size={e.kind === 'run' ? 36 : 32} />
          <span className="hl-row__name">
            <b>
              {entryName(e)}
              {e.kind === 'run' && <span className="hl-runtag">Run nº {e.runNo}</span>}
            </b>
            <small>{e.kind === 'run' ? <RunSub run={e} /> : <LegendSub legend={e} />}</small>
          </span>
        </span>
        <span role="cell" className="hl-col-kt">
          <KeyTrophies entry={e} size={22} />
        </span>
        <span role="cell" className="hl-col-n num">
          {valueOf(e, 'goals')}
        </span>
        <span role="cell" className="hl-col-n num">
          {valueOf(e, 'leagueTitles')}
        </span>
        <span role="cell" className="hl-col-nota">
          <span className="hl-bar" aria-hidden="true">
            <i style={{ transform: `scaleX(${e.score / 100})` }} />
          </span>
          <b className="num">{e.score}</b>
        </span>
      </button>
    </>
  )
}

function RunSub({ run }: { run: RunLegacy }) {
  return (
    <>
      <span>{POSITION_LABEL[run.stats.position]}</span>
      <span className="hl-dot" />
      <span>{run.stats.seasons} temp.</span>
      <span className="hl-dot hl-hide-sm" />
      <RunCrests run={run} max={4} size={16} />
    </>
  )
}

function LegendSub({ legend }: { legend: LegendLegacy }) {
  const l = legend.legend
  return (
    <>
      <span>{l.nationality === 'URS' ? 'URSS' : l.nationality}</span>
      <span className="hl-dot" />
      <span>{yearsLabel(l.years)}</span>
      <span className="hl-dot hl-hide-sm" />
      <LegendCrests legend={legend} max={3} size={16} />
    </>
  )
}

// ───────────────────────── categorias ─────────────────────────

function Categories({ hall, onOpen }: { hall: HallModel; onOpen: (e: RankEntry) => void }) {
  const [cat, setCat] = useState<CategoryId>('ballonDor')
  const rm = useReducedMotion()
  const rows = hall.categories[cat]
  const meta = CATEGORIES[cat]
  const podium = rows.slice(0, 3)
  const rest = rows.slice(3, 10)
  const myRuns = rows.filter((r) => r.entry.kind === 'run')
  return (
    <section className="hl-panel lx-glass" aria-labelledby="hl-cat-h">
      <header className="hl-panel__h">
        <div>
          <h2 id="hl-cat-h">Por categoria</h2>
          <p>Pódio e top 10 de cada categoria{meta.minApps ? ` · mínimo de ${meta.minApps} jogos` : ''}</p>
        </div>
      </header>
      <div className="hl-cats" role="tablist" aria-label="Categorias">
        {CATEGORY_IDS.map((id) => (
          <button key={id} type="button" role="tab" id={`hl-tab-${id}`} aria-selected={cat === id} aria-controls="hl-cat-panel" className={cx('hl-cat-tab', cat === id && 'is-on')} onClick={() => setCat(id)}>
            <CategoryGlyph id={id} size={22} />
            <span>{CATEGORIES[id].label}</span>
          </button>
        ))}
      </div>
      <motion.div key={cat} id="hl-cat-panel" role="tabpanel" aria-labelledby={`hl-tab-${cat}`} className="hl-cat" initial={rm ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
        <div className="hl-cat__main">
          <CatHero cat={cat} rows={rows} />
          <div className="hl-podium" aria-label={`Pódio: ${meta.label}`}>
            {[1, 0, 2].map((i) => podium[i] && <PodiumStep key={podium[i].entry.id} row={podium[i]} place={i + 1} cat={cat} onOpen={onOpen} />)}
          </div>
        </div>
        <div className="hl-cat__side">
          <ol className="hl-list" start={4}>
            {rest.map((r) => (
              <CatRow key={r.entry.id} row={r} cat={cat} onOpen={onOpen} />
            ))}
          </ol>
          {myRuns.length > 0 && (
            <div className="hl-myruns">
              <Eyebrow as="h3">Suas runs nesta categoria</Eyebrow>
              <ul>
                {myRuns.slice(0, 5).map((r) => (
                  <li key={r.entry.id}>
                    <button type="button" onClick={() => onOpen(r.entry)}>
                      <span className="hl-myruns__pos num">{r.value > 0 ? `${r.rank}º` : '—'}</span>
                      <b>
                        {entryName(r.entry)} <span className="hl-runtag">Run nº {(r.entry as RunLegacy).runNo}</span>
                      </b>
                      <span className="num">{valueOf(r.entry, cat, true)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </motion.div>
    </section>
  )
}

const CAT_BLURB: Record<CategoryId, string> = {
  ballonDor: 'O prêmio individual mais cobiçado. Até 1995, só europeus podiam ganhar.',
  worldCups: 'A taça que define gerações. Pelé é o único tricampeão.',
  goldenBoots: 'Maior artilheiro das ligas europeias na temporada.',
  ucl: 'A Liga dos Campeões — a orelhuda.',
  libertadores: 'A glória eterna da América do Sul.',
  leagueTitles: 'Campeonatos nacionais de primeira divisão, em qualquer país.',
  clubs: 'Clubes defendidos na carreira (empréstimos incluídos).',
  goals: 'Gols oficiais por clubes e pela seleção principal.',
  assists: 'Passes para gol. Para lendas antigas, estimativa.',
  records: 'Recordes mundiais nas métricas do jogo (Bolas de Ouro, gols, Libertadores…): os que a run quebrou e os que a lenda tem ou teve.',
  goalsPerGame: 'Gols por jogo oficial, com no mínimo 300 jogos.',
}

function CatHero({ cat, rows }: { cat: CategoryId; rows: RankRow[] }) {
  const meta = CATEGORIES[cat]
  const topLegend = rows.find((r) => r.entry.kind === 'legend')
  const bestRun = rows.find((r) => r.entry.kind === 'run')
  const shared = cat === 'ucl' || cat === 'libertadores'
  const weight = shared ? LEGACY_WEIGHTS.continental : LEGACY_WEIGHTS[cat as keyof typeof LEGACY_WEIGHTS]
  return (
    <div className="hl-cathero">
      <span className="hl-cathero__art">
        <CategoryGlyph id={cat} size={meta.art && cat !== 'leagueTitles' ? 108 : 64} photo />
      </span>
      <div className="min-w-0">
        <h3>{meta.label}</h3>
        <p>{CAT_BLURB[cat]}</p>
        <dl>
          {topLegend && (
            <div>
              <dt>Melhor lenda</dt>
              <dd>
                <b className="num">{valueOf(topLegend.entry, cat)}</b> {entryName(topLegend.entry)}
              </dd>
            </div>
          )}
          <div>
            <dt>Sua melhor run</dt>
            <dd>{bestRun ? <><b className="num">{valueOf(bestRun.entry, cat)}</b> {bestRun.value > 0 ? `${bestRun.rank}º lugar` : 'ainda sem pontuar'}</> : <span className="text-text-3">—</span>}</dd>
          </div>
          <div>
            <dt>Peso na nota</dt>
            <dd>
              <b className="num">{weight}</b> {shared ? `de 100, com a ${cat === 'ucl' ? 'Libertadores' : 'Champions'}` : 'de 100'}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

function PodiumStep({ row, place, cat, onOpen }: { row: RankRow; place: number; cat: CategoryId; onOpen: (e: RankEntry) => void }) {
  const e = row.entry
  const club = useClub(e.kind === 'run' ? e.stats.mainClubId : null)
  return (
    <button type="button" className={cx('hl-step', `hl-step--${place}`, e.kind === 'run' && 'is-run')} style={e.kind === 'run' ? clubVars(club ?? {}) : undefined} onClick={() => onOpen(e)}>
      <span className="hl-step__who">
        <EntryAvatar entry={e} size={place === 1 ? 54 : 44} />
        <b>{entryName(e)}</b>
        {e.kind === 'run' ? <span className="hl-runtag">Run nº {e.runNo}</span> : <small>{e.legend.nationality === 'URS' ? 'URSS' : e.legend.nationality}</small>}
      </span>
      <span className="hl-step__block">
        <span className="hl-step__place">{row.rank}º</span>
        <span className="hl-step__v num">{valueOf(e, cat)}</span>
        <small>{CATEGORIES[cat].ratio ? 'gol por jogo' : row.value === 1 ? CATEGORIES[cat].one : CATEGORIES[cat].many}</small>
        <span className="hl-step__glyph">
          <CategoryGlyph id={cat} size={place === 1 ? 64 : 40} photo />
        </span>
      </span>
    </button>
  )
}

function CatRow({ row, cat, onOpen }: { row: RankRow; cat: CategoryId; onOpen: (e: RankEntry) => void }) {
  const e = row.entry
  const club = useClub(e.kind === 'run' ? e.stats.mainClubId : null)
  return (
    <li>
      <button type="button" className={cx('hl-lrow', e.kind === 'run' && 'is-run lx-club-row lx-club-row--filled')} style={e.kind === 'run' ? (rowClubVars(club) as CSSProperties) : undefined} onClick={() => onOpen(e)}>
        <span className="hl-lrow__pos num">{row.rank}</span>
        <EntryAvatar entry={e} size={26} />
        <b>
          {entryName(e)}
          {e.kind === 'run' && <span className="hl-runtag">Run nº {e.runNo}</span>}
        </b>
        <span className="hl-lrow__v num">{valueOf(e, cat)}</span>
      </button>
    </li>
  )
}

// ───────────────────────── suas runs ─────────────────────────

function Runs({ hall, onOpen }: { hall: HallModel; onOpen: (e: RankEntry) => void }) {
  const list = useMemo(() => hall.runs.slice().sort((a, b) => b.raw - a.raw), [hall.runs])
  return (
    <section aria-labelledby="hl-runs-h" className="hl-runs">
      <header className="hl-panel__h hl-panel__h--bare">
        <div>
          <h2 id="hl-runs-h">Suas runs</h2>
          <p>Cada carreira avaliada contra as lendas e contra as suas runs anteriores</p>
        </div>
      </header>
      <ul className="hl-rgrid">
        {list.map((r) => (
          <li key={r.id}>
            <RunCard run={r} hall={hall} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function RunCard({ run, hall, onOpen }: { run: RunLegacy; hall: HallModel; onOpen: (e: RankEntry) => void }) {
  const entry = hall.entryById.get(run.id)
  const club = useClub(run.stats.mainClubId)
  const rank = hall.overall.find((r) => r.entry === run)?.rank ?? 0
  const best = useMemo(() => compareRun(run, hall.legends, { max: 1 })[0], [run, hall.legends])
  return (
    <article className="hl-rcard lx-glass" style={clubVars(club ?? {})}>
      <div className="hl-rcard__top">
        <RunAvatar run={run} size={46} />
        <div className="min-w-0 flex-1">
          <span className="hl-runtag">Run nº {run.runNo}</span>
          <h3>{run.input.identity.surname}</h3>
          <p>{runHeadline(entry, run, rank)}</p>
        </div>
        <NotaRing score={run.score} size={58} />
      </div>
      <div className="hl-rcard__stats">
        <span>
          <b className="num">{rank}º</b>
          <small>no Hall</small>
        </span>
        <span>
          <b className="num">{formatInt(run.stats.goals)}</b>
          <small>Gols</small>
        </span>
        <span>
          <b className="num">{formatInt(run.stats.titles)}</b>
          <small>Títulos</small>
        </span>
        <span>
          <b className="num">{run.historic.length}</b>
          <small>Recordes</small>
        </span>
      </div>
      <div className="hl-rcard__kt">
        <KeyTrophies entry={run} size={24} />
        <RunCrests run={run} max={5} size={18} />
      </div>
      {best && (
        <p className="hl-rcard__q">
          <Quote size={12} aria-hidden /> {best.text}
        </p>
      )}
      {run.historic.length > 0 && (
        <p className="hl-rcard__rec">
          <Zap size={12} aria-hidden /> {run.historic.length} {run.historic.length === 1 ? 'recorde histórico quebrado' : 'recordes históricos quebrados'}
        </p>
      )}
      {run.personal.length > 0 && (
        <p className="hl-rcard__rec hl-rcard__rec--own">
          {run.personal.length} {run.personal.length === 1 ? 'recorde das suas runs' : 'recordes das suas runs'}
        </p>
      )}
      <div className="hl-rcard__foot">
        <Button variant="ghost" size="sm" onClick={() => onOpen(run)}>
          Detalhes
        </Button>
        <Button variant="ghost" size="sm" iconRight={ArrowRight} onClick={() => navigate('/resumo', { query: { id: run.id } })}>
          Resumo
        </Button>
      </div>
    </article>
  )
}
