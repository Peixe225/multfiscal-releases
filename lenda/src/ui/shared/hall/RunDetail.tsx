/** Hall das Lendas — detalhe de uma run, ficha de uma lenda e "como a nota é calculada". */
import { useMemo, useState } from 'react'
import { ArrowRight, BookOpen, CalendarCheck, CircleHelp, Medal, Quote, Trash2, Trophy, TrendingUp, Zap } from 'lucide-react'
import {
  CATEGORIES,
  CATEGORY_IDS,
  LEGACY_K,
  LEGACY_WEIGHTS,
  LEGENDS_AS_OF,
  LEGENDS_CHECKED_AT,
  MINOR_TITLE_CREDIT,
  OVERALL_TIEBREAK,
  RETRO_BALLON_DOR_CREDIT,
  categoryWeight,
  legendTotalTitles,
  compareRun,
  nextTarget,
  type CategoryId,
  type HonourKind,
  type LegendAward,
  type LegendAwardKey,
  type LegendField,
  type LegendLegacy,
  type RankRow,
  type RunLegacy,
} from '@/engine/legacy'
import { LIVE_LEGEND_IDS, liveUpdatedLabel } from '@/data/legendsLive'
import { TrophyArt } from '@/ui/trophies'
import { navigate } from '@/store/app'
import { useCareer } from '@/store/career'
import { useClub, useCountry } from '@/store/data'
import { Button, Crest, Eyebrow, Modal, POSITION_LABEL, TabPanel, Tabs, cx, formatInt, plural, toast } from '@/ui/primitives'
import { CategoryGlyph, LegendAvatar, NotaRing, RunCrests, TieNote, useRunModeLabel, valueOf } from './parts'
import { dayLabel, gapText, monthLabel, runHeadline, yearsLabel, type HallModel } from './model'

function Breakdown({ items, values }: { items: RunLegacy['breakdown']; values: RunLegacy | LegendLegacy }) {
  return (
    <ul className="hl-bd">
      {items.map((b) => (
        <li key={b.id} className={cx(b.points < 0.05 && 'is-zero')}>
          <span className="hl-bd__h">
            <CategoryGlyph id={b.id} size={20} />
            <span className="hl-lg">{CATEGORIES[b.id].label}</span>
            <span className="hl-sm">{CATEGORIES[b.id].short}</span>
          </span>
          <span className="hl-bd__v num">{valueOf(values, b.id)}</span>
          <span className="hl-bd__bar" aria-hidden="true">
            <i style={{ transform: `scaleX(${b.max ? b.points / b.max : 0})` }} />
          </span>
          <span className="hl-bd__p num" title={`${b.points.toFixed(1)} de ${b.max} pontos`}>
            {b.points.toFixed(1).replace('.', ',')}
            <small>/{b.max}</small>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function RunDetail({ entry: run, hall, onClose }: { entry: RunLegacy | null; hall: HallModel; onClose: () => void }) {
  const remove = useCareer((s) => s.removeHallEntry)
  const [confirm, setConfirm] = useState(false)
  const h = run ? hall.entryById.get(run.id) : undefined
  const club = useClub(run?.stats.mainClubId)
  const cmp = useMemo(() => (run ? compareRun(run, hall.legends, { max: 8 }) : []), [run, hall.legends])
  const next = useMemo(() => (run ? nextTarget(run, hall.legends) : null), [run, hall.legends])
  const rank = run ? (hall.overall.find((r) => r.entry === run)?.rank ?? 0) : 0
  const mode = useRunModeLabel(run?.id ?? '')
  const gk = run?.stats.position === 'GOL'
  const del = async () => {
    if (!run) return
    const name = run.input.identity.surname
    setConfirm(false)
    onClose()
    await remove(run.id)
    toast.info(`${name} saiu do Hall das Lendas`)
  }
  return (
    <>
      <Modal
        open={!!run}
        onClose={onClose}
        size="xl"
        media={run ? <NotaRing score={run.score} size={64} /> : undefined}
        title={
          run ? (
            <span className="hl-md__t">
              {run.input.identity.surname} <span className="hl-runtag">Carreira nº {run.runNo}</span>
            </span>
          ) : undefined
        }
        description={
          run
            ? `${run.tier.label} · ${rank}º de ${hall.overall.length} no Hall das Lendas · ${mode ? `Modo ${mode} · ` : ''}${POSITION_LABEL[run.stats.position]} · ${plural(run.stats.seasons, 'temporada', 'temporadas')}${h ? ` · ${runHeadline(h, run, rank)}` : ''}`
            : undefined
        }
        footer={
          run && (
            <div className="flex gap-2 w-full items-center flex-wrap">
              <Button variant="ghost" size="md" icon={Trash2} onClick={() => setConfirm(true)}>
                Remover
              </Button>
              <span className="flex-1" />
              {h && (
                <Button variant="primary" size="md" iconRight={ArrowRight} onClick={() => navigate('/resumo', { query: { id: run.id } })}>
                  Ver resumo
                </Button>
              )}
            </div>
          )
        }
      >
        {run && (
          <div className="hl-md">
            <div className="hl-md__col">
              <div className="hl-md__meta">
                {club && <Crest club={club} size={22} decorative />}
                <RunCrests run={run} max={8} size={20} exclude={club ? run.stats.mainClubId : undefined} />
                <span>
                  {plural(run.stats.apps, 'jogo', 'jogos')} ·{' '}
                  {gk ? `${plural(run.stats.cleanSheets, 'jogo', 'jogos')} sem sofrer gol` : `${plural(run.stats.goals, 'gol', 'gols')} · ${plural(run.stats.assists, 'assistência', 'assistências')}`} ·{' '}
                  {plural(run.stats.titles, 'título', 'títulos')}
                </span>
              </div>
              <Eyebrow as="h3">Composição da Nota de Legado</Eyebrow>
              <Breakdown items={run.breakdown} values={run} />
              {next && (
                <p className="hl-md__next">
                  <TrendingUp size={14} aria-hidden /> Próximo alvo: <b>{next.legend.legend.name}</b> ({next.legend.score}) — {gapText(next.gap)}.
                </p>
              )}
            </div>
            <div className="hl-md__col">
              <Eyebrow as="h3">Posição por categoria</Eyebrow>
              <ul className="hl-pos">
                {CATEGORY_IDS.map((id) => {
                  const rows = hall.categories[id]
                  const row = rows.find((r) => r.entry === run)
                  const ok = !!row && run.values[id] > 0
                  return (
                    <li key={id} className={cx(!ok && 'is-zero', ok && row!.rank <= 3 && 'is-podium')}>
                      <CategoryGlyph id={id} size={20} />
                      <span className="hl-pos__l">{CATEGORIES[id].short}</span>
                      <b className="num">{ok ? `${row!.rank}º` : '—'}</b>
                      <small className="num">{valueOf(run, id)}</small>
                    </li>
                  )
                })}
              </ul>
              <Eyebrow as="h3" className="mt-4 block">
                Recordes históricos · {run.historic.length}
              </Eyebrow>
              {run.historic.length ? (
                <ul className="hl-recs">
                  {run.historic.map((r) => (
                    <li key={r.id} className="is-hist">
                      <span className="hl-recs__ic">
                        <Trophy size={14} aria-hidden />
                      </span>
                      <span>
                        <small>Recorde mundial</small>
                        {r.text}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hl-md__empty">Nenhum recorde histórico nesta carreira. Supere uma marca mundial (Bolas de Ouro, gols, Libertadores…) para entrar nesta lista.</p>
              )}
              {run.personal.length > 0 && (
                <>
                  <Eyebrow as="h3" className="mt-4 block">
                    Recordes das suas carreiras · {run.personal.length}
                  </Eyebrow>
                  <ul className="hl-recs">
                    {run.personal.map((r) => (
                      <li key={r.id} className="is-pers">
                        <span className="hl-recs__ic">
                          <Zap size={14} aria-hidden />
                        </span>
                        <span>
                          <small>Só selo · não entra na nota</small>
                          {r.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <Eyebrow as="h3" className="mt-4 block">
                Comparações com lendas
              </Eyebrow>
              {cmp.length ? (
                <ul className="hl-quotes hl-quotes--list">
                  {cmp.map((c) => (
                    <li key={c.text}>
                      <Quote size={13} aria-hidden />
                      <span>{c.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hl-md__empty">Nenhuma categoria acima de uma lenda ainda.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        size="sm"
        title="Remover do Hall das Lendas?"
        description={run ? `A carreira nº ${run.runNo} (${run.input.identity.surname}) será apagada deste navegador. Não dá para desfazer.` : undefined}
        footer={
          <div className="flex gap-2 justify-end w-full">
            <Button variant="ghost" size="md" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button variant="danger" size="md" icon={Trash2} onClick={del}>
              Remover
            </Button>
          </div>
        }
      />
    </>
  )
}

// ───────────────────────── ficha da lenda ─────────────────────────

type FichaTab = 'resumo' | 'titulos' | 'premios' | 'feitos'

/** Grupos de títulos na ficha (ordem de exibição). */
const HONOUR_GROUPS: { kind: HonourKind; label: string; short: string; art: string }[] = [
  { kind: 'national', label: 'Seleção', short: 'Seleção', art: 'world-cup' },
  { kind: 'world', label: 'Mundiais de clubes', short: 'Mundiais', art: 'club-world-cup' },
  { kind: 'continental', label: 'Continentais', short: 'Continentais', art: 'champions-league' },
  { kind: 'league', label: 'Ligas', short: 'Ligas', art: 'league-generic' },
  { kind: 'cup', label: 'Copas nacionais', short: 'Copas', art: 'cup-generic' },
  { kind: 'supercup', label: 'Supercopas', short: 'Supercopas', art: 'uefa-super-cup' },
  { kind: 'state', label: 'Estaduais e regionais', short: 'Estaduais', art: 'estadual' },
  { kind: 'other', label: 'Outros títulos oficiais', short: 'Outros', art: 'cup-generic' },
]

/** Prêmios que contam no Hall, agrupados pela categoria do jogo. */
const AWARD_GROUPS: { id: CategoryId | 'kopa'; label: string; keys: LegendAwardKey[]; art: string }[] = [
  { id: 'ballonDor', label: 'Bola de Ouro', keys: ['ballon_dor'], art: 'ballon-dor' },
  { id: 'bestPlayer', label: 'Melhor jogador', keys: ['the_best', 'wc_golden_ball', 'league_best_player'], art: 'the-best' },
  { id: 'goldenBoots', label: 'Chuteira de Ouro', keys: ['golden_boot'], art: 'golden-boot' },
  { id: 'topScorer', label: 'Artilharias', keys: ['wc_golden_boot', 'league_top_scorer'], art: 'league-top-scorer' },
  { id: 'puskas', label: 'Prêmio Puskás', keys: ['puskas'], art: 'puskas' },
  { id: 'goldenGloves', label: 'Luva de Ouro', keys: ['golden_glove'], art: 'golden-glove' },
  { id: 'kopa', label: 'Melhor jovem', keys: ['kopa'], art: 'kopa' },
]
const OTHER_AWARD_GROUPS: { label: string; keys: LegendAwardKey[] }[] = [
  { label: 'Melhor jogador de torneio ou do continente', keys: ['continental_best', 'tournament_best'] },
  { label: 'Artilharias de torneios e continentais', keys: ['continental_top_scorer', 'tournament_top_scorer'] },
  { label: 'Outros prêmios e homenagens', keys: ['other'] },
]

const sumN = (xs: { n: number }[]) => xs.reduce((a, x) => a + x.n, 0)

/** "Wikipedia (en)", "Transfermarkt", "RSSSF"… a partir da URL. */
function sourceLabel(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '')
    const wiki = /^([a-z]{2})\.wikipedia\.org$/.exec(h)
    if (wiki) return `Wikipedia (${wiki[1]})`
    if (h.endsWith('transfermarkt.com') || h.includes('transfermarkt')) return 'Transfermarkt'
    if (h.endsWith('rsssf.org') || h.endsWith('rsssf.com')) return 'RSSSF'
    if (h.endsWith('messivsronaldo.app')) return 'MessivsRonaldo.app'
    return h
  } catch {
    return url
  }
}

function useCountryName(nationality?: string) {
  const country = useCountry(nationality)
  return nationality === 'URS' ? 'União Soviética' : (country?.name ?? nationality)
}

export function LegendDetail({ entry, hall, onClose }: { entry: LegendLegacy | null; hall: HallModel; onClose: () => void }) {
  const l = entry?.legend
  const cname = useCountryName(l?.nationality)
  const row = entry ? hall.overall.find((r) => r.entry === entry) : undefined
  const [tab, setTab] = useState<FichaTab>('resumo')
  const [shownId, setShownId] = useState<string | null>(null)
  // outra lenda aberta: volta para o resumo
  if (entry && entry.id !== shownId) {
    setShownId(entry.id)
    setTab('resumo')
  }
  const awardsHall = l ? sumN((l.awards ?? []).filter((a) => a.key !== 'other' && !OTHER_KEYS.has(a.key))) : 0
  return (
    <Modal
      open={!!entry}
      onClose={onClose}
      size="xl"
      media={entry ? <LegendAvatar legend={entry} size={56} /> : undefined}
      title={l?.name}
      description={entry && l ? `${l.fullName} · ${cname} · ${POSITION_LABEL[l.position]} · ${yearsLabel(l.years)}${l.active ? ' (em atividade)' : ''}` : undefined}
    >
      {entry && l && (
        <div className="hl-lf">
          <LegendHead entry={entry} row={row} hall={hall} />
          <Tabs<FichaTab>
            aria-label={`Ficha de ${l.name}`}
            idPrefix="hl-lf"
            value={tab}
            onChange={setTab}
            className="hl-lf__tabs"
            tabs={[
              { value: 'resumo', label: 'Resumo' },
              { value: 'titulos', label: 'Títulos', badge: legendTotalTitles(l) },
              { value: 'premios', label: 'Prêmios', badge: sumN(l.awards ?? []) },
              { value: 'feitos', label: 'Feitos', badge: (l.feats ?? []).length },
            ]}
          />
          <TabPanel idPrefix="hl-lf" value="resumo" active={tab === 'resumo'} className="hl-lf__panel">
            <LegendSummary entry={entry} hall={hall} awardsHall={awardsHall} />
          </TabPanel>
          <TabPanel idPrefix="hl-lf" value="titulos" active={tab === 'titulos'} className="hl-lf__panel">
            <LegendHonours entry={entry} />
          </TabPanel>
          <TabPanel idPrefix="hl-lf" value="premios" active={tab === 'premios'} className="hl-lf__panel">
            <LegendAwards entry={entry} />
          </TabPanel>
          <TabPanel idPrefix="hl-lf" value="feitos" active={tab === 'feitos'} className="hl-lf__panel">
            <LegendFeats entry={entry} hall={hall} />
          </TabPanel>
        </div>
      )}
    </Modal>
  )
}

const OTHER_KEYS = new Set<LegendAwardKey>(['continental_best', 'continental_top_scorer', 'tournament_best', 'tournament_top_scorer'])
const LIVE_IDS = new Set<string>(LIVE_LEGEND_IDS)

/** Nota, posição, números grandes e a data/fonte dos números. */
function LegendHead({ entry, row, hall }: { entry: LegendLegacy; row?: RankRow; hall: HallModel }) {
  const l = entry.legend
  const live = hall.live && LIVE_IDS.has(l.id) ? hall.live : null
  const changes = live ? live.changes[l.id as keyof typeof live.changes] : []
  const ap = (k: LegendField) => (l.uncertain ?? []).includes(k)
  const big: { label: string; value: string }[] = [
    { label: 'Jogos', value: `${ap('apps') ? '≈' : ''}${formatInt(l.apps)}` },
    { label: 'Gols', value: `${ap('goals') ? '≈' : ''}${formatInt(l.goals)}` },
    { label: 'Assistências', value: `${l.assistsEstimated || ap('assists') ? '≈' : ''}${formatInt(l.assists)}` },
    { label: 'Títulos', value: `${ap('totalTitles') ? '≈' : ''}${formatInt(legendTotalTitles(l))}` },
    { label: 'Prêmios no Hall', value: valueOf(entry, 'awards') },
  ]
  return (
    <div className="hl-lf__head">
      <div className="hl-lf__score">
        <NotaRing score={entry.score} size={72} />
        <div>
          <b className="hl-tier">{entry.tier.label}</b>
          <span>
            <strong className="num">{row?.rank ?? '—'}º</strong> de {hall.overall.length} no Hall · nota bruta <span className="num">{entry.raw.toFixed(2).replace('.', ',')}</span>
          </span>
          {row && <TieNote row={row} />}
          {row && <TieNote row={row} behind />}
        </div>
      </div>
      <dl className="hl-lf__big">
        {big.map((b) => (
          <div key={b.label}>
            <dt>{b.label}</dt>
            <dd className="num">{b.value}</dd>
          </div>
        ))}
      </dl>
      <p className="hl-lf__src">
        <CalendarCheck size={13} aria-hidden />
        {live ? (
          <span>
            {liveUpdatedLabel(live)} · fonte:{' '}
            <a className="hl-src-link" href={live.url} target="_blank" rel="noopener noreferrer">
              {live.source}
            </a>
            {live.stale ? ' (última busca do servidor)' : ''}
            {changes.length > 0 && <span className="hl-lf__chg"> · desde a conferência: {changes.join(', ')}</span>}
          </span>
        ) : (
          <span>
            {l.active ? `Números até ${monthLabel(l.asOf ?? LEGENDS_AS_OF)} (em atividade)` : `Carreira encerrada em ${l.years[1]}`} · conferidos em {dayLabel(LEGENDS_CHECKED_AT)} · fontes:{' '}
            {[...new Set((l.sources ?? []).map(sourceLabel))].slice(0, 4).join(', ')}
          </span>
        )}
      </p>
    </div>
  )
}

const STAT_ROWS: { id: CategoryId; label: string }[] = [
  { id: 'ballonDor', label: 'Bolas de Ouro' },
  { id: 'worldCups', label: 'Copas do Mundo' },
  { id: 'ucl', label: 'Champions' },
  { id: 'libertadores', label: 'Libertadores' },
  { id: 'leagueTitles', label: 'Títulos nacionais' },
  { id: 'bestPlayer', label: 'Melhor jogador' },
  { id: 'topScorer', label: 'Artilharias' },
  { id: 'goldenBoots', label: 'Chuteiras de Ouro' },
  { id: 'puskas', label: 'Prêmio Puskás' },
  { id: 'goldenGloves', label: 'Luvas de Ouro' },
  { id: 'goalsPerGame', label: 'Média de gols' },
  { id: 'clubs', label: 'Clubes' },
]

function LegendSummary({ entry, hall }: { entry: LegendLegacy; hall: HallModel; awardsHall: number }) {
  const l = entry.legend
  const best = hall.bestRun
  // "Sua carreira tem mais X que Y": as categorias em que a sua melhor carreira passa esta lenda
  const beats = best ? CATEGORY_IDS.filter((id) => entry.values[id] > 0 && best.values[id] > entry.values[id] && (!CATEGORIES[id].minApps || best.stats.apps >= CATEGORIES[id].minApps!)) : []
  return (
    <div className="hl-md">
      <div className="hl-md__col">
        <Eyebrow as="h3">Números de carreira</Eyebrow>
        <dl className="hl-facts">
          {STAT_ROWS.map(({ id, label }) => (
            <div key={id} className={cx(entry.values[id] === 0 && id !== 'goalsPerGame' && 'is-zero')}>
              <dt>{label}</dt>
              <dd className="num">{valueOf(entry, id)}</dd>
            </div>
          ))}
          <div>
            <dt>Outros títulos grandes</dt>
            <dd className="num">{formatInt(l.otherMajorTitles)}</dd>
          </div>
          {(l.retroBallonDor ?? 0) > 0 && (
            <div>
              <dt>Bolas de Ouro retroativas</dt>
              <dd className="num">{l.retroBallonDor}</dd>
            </div>
          )}
        </dl>
        <Eyebrow as="h3" className="mt-4 block">
          Clubes
        </Eyebrow>
        <ul className="hl-lclubs">
          {l.clubs.map((c) => (
            <LegendClubChip key={c.name} name={c.name} clubId={c.clubId} />
          ))}
        </ul>
        {(l.records ?? []).length > 0 && (
          <>
            <Eyebrow as="h3" className="mt-4 block">
              Destaques
            </Eyebrow>
            <ul className="hl-hl">
              {(l.records ?? []).map((r) => (
                <li key={r}>
                  <Trophy size={13} aria-hidden />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {entry.worldRecords.length > 0 && (
          <>
            <Eyebrow as="h3" className="mt-4 block">
              Recordes mundiais que contam na nota · {entry.worldRecords.length}
            </Eyebrow>
            <ul className="hl-wrecs">
              {entry.worldRecords.map((r) => (
                <li key={r.metric} className={cx(r.current && 'is-cur')}>
                  {r.label}
                  <small>{r.current ? 'atual' : 'na época'}</small>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="hl-md__col">
        {best && (
          <div className="hl-lf__vs">
            <Eyebrow as="h3">
              Sua carreira nº {best.runNo} contra {l.name}
            </Eyebrow>
            {beats.length ? (
              <ul className="hl-quotes hl-quotes--list">
                {beats.slice(0, 6).map((id) => (
                  <li key={id}>
                    <Quote size={13} aria-hidden />
                    <span>
                      Sua carreira nº {best.runNo} {CATEGORIES[id].more} {l.name} ({valueOf(entry, id)}).
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hl-md__empty">Ainda nenhuma categoria acima de {l.name}.</p>
            )}
          </div>
        )}
        <Eyebrow as="h3">Composição da nota</Eyebrow>
        <Breakdown items={entry.breakdown} values={entry} />
        <Eyebrow as="h3" className="mt-4 block">
          Posição por categoria
        </Eyebrow>
        <ul className="hl-pos">
          {CATEGORY_IDS.map((id) => {
            const r = hall.categories[id].find((x) => x.entry === entry)
            const ok = !!r && entry.values[id] > 0
            return (
              <li key={id} className={cx(!ok && 'is-zero', ok && r!.rank <= 3 && 'is-podium')}>
                <CategoryGlyph id={id} size={20} />
                <span className="hl-pos__l">{CATEGORIES[id].short}</span>
                <b className="num">{ok ? `${r!.rank}º` : '—'}</b>
                <small className="num">{valueOf(entry, id)}</small>
              </li>
            )
          })}
        </ul>
        {(l.notes?.length ?? 0) > 0 && (
          <ul className="hl-notes">
            {l.notes!.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function LegendHonours({ entry }: { entry: LegendLegacy }) {
  const l = entry.legend
  const groups = HONOUR_GROUPS.map((g) => ({ ...g, items: (l.honours ?? []).filter((h) => h.kind === g.kind) })).filter((g) => g.items.length)
  return (
    <div className="hl-lf__sec">
      <p className="hl-lf__lead">
        <b className="num">{legendTotalTitles(l)}</b> {legendTotalTitles(l) === 1 ? 'título oficial' : 'títulos oficiais'}
        {(l.uncertain ?? []).includes('totalTitles') ? ' (há títulos em aberto: ver "Pontos em aberto" em Feitos)' : ''}
      </p>
      <ul className="hl-lf__chips" aria-label="Títulos por grupo">
        {groups.map((g) => (
          <li key={g.kind}>
            {g.short} <b className="num">{sumN(g.items)}</b>
          </li>
        ))}
      </ul>
      <div className="hl-hon">
        {groups.map((g) => (
          <section key={g.kind} className="hl-hon__g" aria-label={g.label}>
            <header>
              <TrophyArt id={g.art} size={26} variant="svg" />
              <h4>{g.label}</h4>
              <span className="num">{sumN(g.items)}</span>
            </header>
            <ul>
              {g.items.map((h) => (
                <li key={`${h.name}·${h.team}`}>
                  <b className="num">{h.n}×</b>
                  <span>
                    <span className="hl-hon__n">{h.name}</span>
                    <small>
                      {h.team}
                      {h.years ? ` · ${h.years}` : ''}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="hl-note">Contam os títulos oficiais em que ele jogou ou estava na lista do jogo; amistosos, torneios de convite e base ficam de fora.</p>
    </div>
  )
}

function AwardList({ items }: { items: LegendAward[] }) {
  return (
    <ul>
      {items.map((a) => (
        <li key={`${a.key}·${a.name}`}>
          <b className="num">{a.n}×</b>
          <span>
            <span className="hl-hon__n">{a.name}</span>
            {a.years && <small>{a.years}</small>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function LegendAwards({ entry }: { entry: LegendLegacy }) {
  const l = entry.legend
  const counted = AWARD_GROUPS.map((g) => ({ ...g, items: (l.awards ?? []).filter((a) => g.keys.includes(a.key)) })).filter((g) => g.items.length)
  const others = OTHER_AWARD_GROUPS.map((g) => ({ ...g, items: (l.awards ?? []).filter((a) => g.keys.includes(a.key)) })).filter((g) => g.items.length)
  const nCounted = sumN(counted.flatMap((g) => g.items))
  return (
    <div className="hl-lf__sec">
      <p className="hl-lf__lead">
        <b className="num">{nCounted}</b> {nCounted === 1 ? 'prêmio conta' : 'prêmios contam'} no Hall (os mesmos que uma carreira do jogo ganha) · <b className="num">{sumN(others.flatMap((g) => g.items))}</b> outros prêmios e homenagens
      </p>
      {counted.length > 0 ? (
        <div className="hl-hon">
          {counted.map((g) => (
            <section key={g.id} className="hl-hon__g is-counted" aria-label={g.label}>
              <header>
                <TrophyArt id={g.art} size={26} variant="svg" />
                <h4>{g.label}</h4>
                <span className="num">{sumN(g.items)}</span>
              </header>
              <AwardList items={g.items} />
            </section>
          ))}
        </div>
      ) : (
        <p className="hl-md__empty">Nenhum dos prêmios individuais que o jogo dá.</p>
      )}
      {others.length > 0 && (
        <>
          <Eyebrow as="h3" className="mt-4 block">
            Outros prêmios · não contam nas categorias (o jogo não dá)
          </Eyebrow>
          <div className="hl-hon">
            {others.map((g) => (
              <section key={g.label} className="hl-hon__g" aria-label={g.label}>
                <header>
                  <Medal size={18} aria-hidden className="hl-hon__ic" />
                  <h4>{g.label}</h4>
                  <span className="num">{sumN(g.items)}</span>
                </header>
                <AwardList items={g.items} />
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function LegendFeats({ entry, hall }: { entry: LegendLegacy; hall: HallModel }) {
  const l = entry.legend
  const live = hall.live && LIVE_IDS.has(l.id) ? hall.live : null
  const table = live ? live.honours[l.id as keyof typeof live.honours].filter((p) => p.n > 0) : []
  return (
    <div className="hl-lf__sec">
      <ol className="hl-feats">
        {(l.feats ?? []).map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ol>
      {(l.doubts?.length ?? 0) > 0 && (
        <details className="hl-lf__more">
          <summary>
            <CircleHelp size={14} aria-hidden /> Pontos em aberto nos dados · {l.doubts!.length}
          </summary>
          <ul className="hl-notes">
            {l.doubts!.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </details>
      )}
      {table.length > 0 && live && (
        <details className="hl-lf__more">
          <summary>
            <CalendarCheck size={14} aria-hidden /> Tabela de honras do {live.source} · {liveUpdatedLabel(live).toLowerCase()}
          </summary>
          <ul className="hl-mvr">
            {table.map((p) => (
              <li key={p.nome}>
                <b className="num">{p.n}</b>
                <span>
                  {p.nome}
                  {p.anos && <small>{p.anos}</small>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="hl-lf__more">
        <summary>
          <BookOpen size={14} aria-hidden /> Fontes · {(l.sources ?? []).length}
        </summary>
        <ul className="hl-srcs">
          {(l.sources ?? []).map((u) => (
            <li key={u}>
              <a className="hl-src-link" href={u} target="_blank" rel="noopener noreferrer">
                {sourceLabel(u)}
                <span>{decodeURIComponent(new URL(u).pathname).replace(/^\/wiki\//, '').replace(/_/g, ' ').slice(0, 64)}</span>
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

function LegendClubChip({ name, clubId }: { name: string; clubId?: string }) {
  const club = useClub(clubId)
  return (
    <li>
      {club ? <Crest club={club} size={18} decorative /> : <span className="hl-lclubs__dot" aria-hidden="true" />}
      {name}
    </li>
  )
}

// ───────────────────────── como a nota é calculada ─────────────────────────

/** "1 ≈ 39%, 3 ≈ 78%" — tirado das mesmas curvas da nota (LEGACY_K), para o texto nunca ficar velho. */
const fills = (k: number, at: number[]) => at.map((v) => `${v.toLocaleString('pt-BR')} ≈ ${Math.round(100 * (1 - Math.exp(-v / k)))}%`).join(', ')
const credit = (v: number) => (v === 0.5 ? 'meia' : v === 0.75 ? '3/4' : v.toLocaleString('pt-BR'))
const K = LEGACY_K

const HOW: { label: string; id: CategoryId | 'continental'; rule: string }[] = [
  { label: 'Copas do Mundo', id: 'worldCups', rule: fills(K.worldCups, [1, 2, 3]) },
  { label: 'Bolas de Ouro', id: 'ballonDor', rule: `${fills(K.ballonDor, [1, 3, 5, 8])}; as retroativas da France Football (lendas pré-1995) valem ${credit(RETRO_BALLON_DOR_CREDIT)}` },
  { label: 'Champions + Libertadores', id: 'continental', rule: `somadas (${fills(K.continental, [1, 3, 5])}); o peso é dividido entre as duas` },
  { label: 'Gols', id: 'goals', rule: `${fills(K.goals, [300, 500, 1000])} (ajustado por posição)` },
  { label: 'Média de gols', id: 'goalsPerGame', rule: 'de 0,25 a 0,90 gol por jogo, com 300+ jogos' },
  { label: 'Melhor jogador', id: 'bestPlayer', rule: `The Best + craque da liga + Bola de Ouro da Copa: ${fills(K.bestPlayer, [1, 3, 6, 10])}` },
  { label: 'Títulos (todos)', id: 'titles', rule: `ligas, copas, continentais, mundiais e de seleção valem 1; estaduais e supercopas, ${credit(MINOR_TITLE_CREDIT)}: ${fills(K.titles, [10, 20, 35])}` },
  { label: 'Recordes mundiais', id: 'records', rule: `nas métricas do jogo: ${fills(K.records, [1, 3])}. Recordes das suas carreiras são só selo` },
  { label: 'Títulos nacionais', id: 'leagueTitles', rule: `só primeira divisão; ${fills(K.leagueTitles, [5, 10])}` },
  { label: 'Artilharias', id: 'topScorer', rule: `artilheiro da liga + Chuteira de Ouro da Copa: ${fills(K.topScorer, [2, 5, 9])}` },
  { label: 'Assistências', id: 'assists', rule: fills(K.assists, [160, 400]) },
  { label: 'Chuteiras de Ouro', id: 'goldenBoots', rule: fills(K.goldenBoots, [1, 3]) },
  { label: 'Luvas de Ouro', id: 'goldenGloves', rule: `melhor goleiro do mundo: ${fills(K.goldenGloves, [1, 3])}` },
  { label: 'Prêmio Puskás', id: 'puskas', rule: fills(K.puskas, [1, 2]) },
  { label: 'Clubes', id: 'clubs', rule: '2 ≈ 50%, 4+ = 100%; um clube só (300+ jogos) também vale 100%' },
]

export function HowModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} size="md" title="Como a Nota de Legado é calculada" description="A mesma fórmula avalia as suas carreiras e as lendas reais — por isso dá para comparar.">
      <div className="hl-how">
        <p>Cada categoria rende pontos com retorno decrescente (o primeiro título vale mais que o nono). Os pesos somam 100; a soma passa por uma curva final que vai de 0 a 100.</p>
        <table>
          <thead>
            <tr>
              <th>Categoria</th>
              <th>Peso</th>
              <th>Como enche</th>
            </tr>
          </thead>
          <tbody>
            {HOW.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num">{r.id === 'continental' ? LEGACY_WEIGHTS.continental : categoryWeight(r.id)}</td>
                <td>{r.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <b>Prêmios individuais</b> (a soma de todos os prêmios acima e do melhor jovem) tem ranking e pódio próprios, mas não entra na nota: já está contado nas categorias de prêmio.
        </p>
        <p>
          <b>Mesma régua para todos:</b> só contam os prêmios e títulos que o jogo também dá. Artilharia da Champions, melhor jogador da Copa América e outras homenagens aparecem na ficha da lenda, mas não nas categorias.
        </p>
        <p>
          <b>Posição conta:</b> gols e assistências de meio-campistas valem ×1,5; de defensores, ×3 mais um bônus de longevidade (0,2 por jogo, sem passar de um artilheiro de verdade); goleiros pontuam pela longevidade (jogos) e pelas Luvas de Ouro. OVR não entra: as lendas não têm.
        </p>
        <p>
          <b>Desempate:</b> notas iguais são decididas por {OVERALL_TIEBREAK.map((c) => c.label).join(' → ')} → nome. Nas categorias, o valor da categoria e depois critérios parecidos (aparecem embaixo do pódio).
        </p>
        <p>
          <b>A nota é só da carreira:</b> não muda com a ordem das carreiras, quando uma delas sai do Hall nem com os números ao vivo das lendas. Superar as suas carreiras anteriores rende selo, não pontos.
        </p>
        <p>
          <b>Níveis:</b> Promessa (0–24) · Profissional (25–44) · Ídolo (45–59) · Craque (60–74) · Lenda (75–89) · Imortal (90+).
        </p>
      </div>
    </Modal>
  )
}
