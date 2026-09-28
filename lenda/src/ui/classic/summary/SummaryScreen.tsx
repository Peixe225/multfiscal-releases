/**
 * "#/resumo" — Resumo da carreira (DESIGN-SPEC-noite §10.7, summary.html).
 *
 *   hero: card do jogador no pico · título honorífico · números · 3 honrarias
 *   evolução do OVR por idade · sala de troféus · por clube · seleção · prêmios · Bola de Ouro ano a
 *   ano · comparações com lendas · card para compartilhar (PNG 1080×1350) · Jogar novamente.
 *
 * Source: the current career (`useCareer.state`, summarized by the engine) or a Hall da Fama entry
 * (`#/resumo?id=<hallId>`). Finished careers are saved to the Hall automatically by the store.
 */
import { memo, useMemo, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, ChartLine, Crown, Flag as FlagIcon, Landmark, Quote, RotateCcw, Share2, Sparkles, Star, Trophy as TrophyIcon, Users } from 'lucide-react'
import type { CareerSummary } from '@/engine/types'
import { LEGENDS } from '@/engine/career/summary'
import { navigate, useApp } from '@/store/app'
import { useCareer } from '@/store/career'
import { getClub, getCompetition, getCountry, getLeague, getTrophy } from '@/store/data'
import {
  BallIcon,
  BootIcon,
  Button,
  CountUp,
  Crest,
  Flag,
  IconButton,
  ShirtIcon,
  TIER_LABEL,
  clubVars,
  cx,
  formatInt,
  formatMoney,
  gradeOf,
  nationColors,
  rowClubVars,
  tierOf,
  useIsDesktop,
  useReducedMotion,
  POSITION_LABEL,
} from '@/ui/primitives'
import { PlaceholderScreen } from '@/ui/shell/Placeholder'
import { useShellSlots } from '@/ui/shell/slots'
import { PlayerCard } from '@/ui/shared/landing/PlayerCard'
import { clubKit } from '@/ui/shared/identity/kit'
import { CompLogo, Prize } from '@/ui/classic/tabs/parts'
import { BallonHistory } from '@/ui/classic/tabs/AwardsTab'
import { LegacyRankCard } from '@/ui/shared/hall/LegacyRankCard'
import { OvrChart } from './OvrChart'
import { SharePanel, type ShareModel } from './ShareCard'
import {
  AWARD_NAME,
  awardTrophy,
  awardsSorted,
  cabinet,
  careerSpan,
  chartPoints,
  clubRows,
  honors,
  isGoldTrophy,
  mainClub,
  spellsOf,
  type Honor,
  type SummaryCareer,
} from './model'
import '@/ui/classic/tabs/tabs.css'
import './summary.css'

export default function SummaryScreen() {
  const id = useApp((s) => s.route.query.id)
  const status = useCareer((s) => s.status)
  const hall = useCareer((s) => (id ? s.finishedCareers.find((h) => h.id === id) : undefined))
  const state = useCareer((s) => s.state)
  const live = !!state && (!hall || hall.career.id === state.id)
  const career: SummaryCareer | null = live ? state : (hall?.career ?? null)
  const summary = useCareer((s) => (live && s.state ? s.summaryOf(s.state) : (hall?.summary ?? null)))
  const saved = useCareer((s) => !!career && s.finishedCareers.some((h) => h.career.id === career.id))
  const main = summary ? mainClub(summary) : undefined
  const club = getClub(main)
  const desktop = useIsDesktop()

  useShellSlots(
    {
      sub: '',
      center: <span className="sm-topbar-t">Resumo da carreira</span>,
      extraActions: career && summary ? <TopActions live={live} finished={!!career.retired || career.phase === 'finished'} desktop={desktop} /> : undefined,
      stage: { preset: 'legend', club: club ?? undefined },
    },
    [club?.id, live, desktop, !!summary, career?.retired],
  )

  if (!career || !summary) {
    if (status !== 'ready') return null
    return (
      <PlaceholderScreen eyebrow="Resumo da carreira" title={id ? 'Carreira não encontrada' : 'Nenhuma carreira para resumir'} icon={ChartLine} description="Jogue uma carreira no Modo Clássico — o resumo com gráfico, taças, prêmios e o card para compartilhar aparece aqui.">
        <div className="mt-5 flex gap-3 flex-wrap">
          <Button variant="primary" iconRight={ArrowRight} onClick={() => navigate('/identidade')}>
            Começar uma carreira
          </Button>
          <Button variant="ghost" onClick={() => navigate('/hall')}>
            Hall da Fama
          </Button>
        </div>
      </PlaceholderScreen>
    )
  }
  return <SummaryBody career={career} summary={summary} live={live} saved={saved || !!hall} />
}

// ───────────────────────── top bar ─────────────────────────

function scrollToShare() {
  const el = document.getElementById('sm-share')
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el?.querySelector<HTMLButtonElement>('.sm-share__actions button')?.focus({ preventScroll: true })
}

function TopActions({ live, finished, desktop }: { live: boolean; finished: boolean; desktop: boolean }) {
  if (!desktop) return <IconButton label="Compartilhar card" icon={Share2} onClick={scrollToShare} />
  return (
    <>
      {live && (
        <Button variant="ghost" size="sm" icon={ChartLine} onClick={() => navigate('/carreira')} className="max-lg:hidden">
          {finished ? 'Ver tabela completa' : 'Voltar à carreira'}
        </Button>
      )}
      <Button variant="ghost" size="sm" icon={Share2} onClick={scrollToShare}>
        Compartilhar card
      </Button>
      <PlayAgain size="sm" live={live} finished={finished} />
    </>
  )
}

function PlayAgain({ size = 'md', live, finished }: { size?: 'sm' | 'md' | 'lg'; live: boolean; finished: boolean }) {
  const abandon = useCareer((s) => s.abandon)
  const hasActive = useCareer((s) => !!s.state && s.state.phase !== 'finished' && !s.state.retired)
  if (live && !finished) {
    return (
      <Button variant="primary" size={size} iconRight={ArrowRight} onClick={() => navigate('/carreira')}>
        Continuar carreira
      </Button>
    )
  }
  return (
    <Button
      variant="primary"
      size={size}
      icon={RotateCcw}
      onClick={async () => {
        // the finished career is already in the Hall da Fama; clear it only when it is the current one
        if (live) await abandon()
        navigate(hasActive && !live ? '/carreira' : '/identidade')
      }}
    >
      {hasActive && !live ? 'Voltar à carreira' : 'Jogar novamente'}
    </Button>
  )
}

// ───────────────────────── body ─────────────────────────

const SummaryBody = memo(function SummaryBody({ career, summary, live, saved }: { career: SummaryCareer; summary: CareerSummary; live: boolean; saved: boolean }) {
  const rm = useReducedMotion()
  const desktop = useIsDesktop()
  const seasons = career.seasons
  const finished = !!career.retired || career.phase === 'finished'
  const span = careerSpan(seasons)
  const main = mainClub(summary)
  const mc = getClub(main)
  const last = seasons[seasons.length - 1]
  const lastClub = getClub(last?.clubId)
  const cab = useMemo(() => cabinet(summary), [summary])
  const rows = useMemo(() => clubRows(summary, seasons), [summary, seasons])
  const hon = useMemo(() => honors(summary, career), [summary, career])
  const points = useMemo(() => chartPoints(seasons), [seasons])
  const spells = useMemo(() => spellsOf(seasons), [seasons])
  const peakClub = getClub(seasons.find((r) => r.age === summary.peakOvrAge)?.clubId ?? main)
  const tier = tierOf(summary.peakOvr)
  const grade = gradeOf(summary.peakOvr)
  const titles = summary.trophies.reduce((a, t) => a + t.count, 0)
  const loans = rows.filter((r) => r.loan).length
  const id = career.identity
  const nat = getCountry(id.nationality)
  const pos = seasons[seasons.length - 1]?.position ?? id.position
  const share: ShareModel = {
    surname: id.surname,
    number: id.number,
    position: pos,
    nationality: id.nationality,
    peakOvr: summary.peakOvr,
    headline: summary.headline,
    span: span.label.replace(' – ', '–'),
    seasons: summary.seasons,
    apps: summary.totals.apps,
    goals: summary.totals.goals,
    assists: summary.totals.assists,
    titles,
    peakValue: summary.peakValue,
    clubs: [...new Set(seasons.map((r) => r.clubId))],
    trophies: cab.items.map((t) => ({ trophyId: t.trophyId, count: t.count })),
    mainClubId: main,
    retired: finished,
  }
  const kpis: [string, number][] = [
    ['Jogos', summary.totals.apps],
    [pos === 'GOL' ? 'Sem sofrer gol' : 'Gols', pos === 'GOL' ? (summary.totals.cleanSheets ?? 0) : summary.totals.goals],
    ['Assistências', summary.totals.assists],
    ['Títulos', titles],
  ]
  const enter = (i: number) => (rm ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, delay: 0.08 * i, ease: [0.16, 1, 0.3, 1] as const } })

  return (
    <div className="sm" style={clubVars(mc ?? lastClub)}>
      {/* ── hero band ── */}
      <section className="sm-top" aria-label="Resumo">
        <motion.div className="sm-cardslot" {...enter(0)}>
          <span className="sm-cardslot__glow" aria-hidden="true" />
          <PlayerCard
            ovr={summary.peakOvr}
            pos={pos}
            nationality={id.nationality}
            club={peakClub}
            kit={clubKit(peakClub)}
            name={id.surname}
            number={id.number}
            stats={[
              ['Jog', formatInt(summary.totals.apps)],
              [pos === 'GOL' ? 'SG' : 'Gol', formatInt(pos === 'GOL' ? (summary.totals.cleanSheets ?? 0) : summary.totals.goals)],
              ['Tít', formatInt(titles)],
            ]}
            width={196}
          />
        </motion.div>
        <motion.div className="sm-ident" {...enter(1)}>
          <div className="sm-ident__eyebrow lx-eyebrow">
            <span>{finished ? 'Fim de carreira' : 'Carreira em andamento'}</span>
            <i aria-hidden="true" />
            <span className="num">{span.label}</span>
            <i aria-hidden="true" />
            <span>
              {summary.seasons} {summary.seasons === 1 ? 'temporada' : 'temporadas'}
            </span>
          </div>
          <h1 className="sm-ident__name">{id.surname}</h1>
          <div className="sm-ident__legacy">
            <span className={cx('sm-grade', `is-${grade === 'base' ? tier : grade}`)}>
              <Crown aria-hidden="true" /> {grade === 'icon' ? 'Ícone' : grade === 'elite' ? 'Elite' : TIER_LABEL[tier]}
            </span>
            <span className="sm-ident__headline">{summary.headline}</span>
          </div>
          <div className="sm-ident__chips">
            <span className="sm-chip">
              <Flag code={id.nationality} h={13} decorative /> {nat?.code ?? id.nationality}
            </span>
            <span className="sm-chip sm-chip--pos" title={POSITION_LABEL[pos]}>
              #{id.number} {pos}
            </span>
            <span className="sm-chip">
              Pico <b className="num">{summary.peakOvr}</b> aos {summary.peakOvrAge}
            </span>
            <span className="sm-chip">{finished ? `Aposentou aos ${last?.age ?? career.age}` : `${career.age} anos · em atividade`}</span>
            <span className="sm-chip">
              Valor máx. <b className="num">{formatMoney(summary.peakValue)}</b>
            </span>
          </div>
          <dl className="sm-kpis">
            {kpis.map(([k, v], i) => (
              <div key={k}>
                <dd className="num">
                  <CountUp to={v} duration={1200} delay={rm ? 0 : 250 + i * 120} format={formatInt} />
                </dd>
                <dt>{k}</dt>
              </div>
            ))}
          </dl>
        </motion.div>
        <div className="sm-honors no-scrollbar">
          {hon.map((h, i) => (
            <motion.div key={h.key} {...enter(2 + i)} className="sm-honors__slot">
              <HonorCard h={h} />
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── chart + trophy room ── */}
      <div className="sm-mid">
        <section className="lx-glass sm-panel sm-chartpanel" aria-labelledby="sm-chart-h">
          <header className="sm-panel__h">
            <h2 id="sm-chart-h">Evolução do OVR</h2>
            <div className="sm-legend">
              <span>
                <i className="is-bdo" aria-hidden="true" /> Bola de Ouro
              </span>
              <span>
                <i className="is-wc" aria-hidden="true" /> Copa do Mundo
              </span>
              <span className="num">
                Idade {seasons[0]?.age ?? 16} → {last?.age ?? 16}
              </span>
            </div>
          </header>
          <OvrChart points={points} spells={spells} finished={finished} />
        </section>
        <section className="lx-glass sm-panel sm-cabinet" aria-labelledby="sm-cab-h">
          <header className="sm-panel__h">
            <h2 id="sm-cab-h">Sala de troféus</h2>
            <span className="sm-panel__aside">
              {cab.titles} {cab.titles === 1 ? 'título' : 'títulos'} · {cab.prizes} {cab.prizes === 1 ? 'prêmio' : 'prêmios'}
            </span>
          </header>
          {cab.items.length ? (
            <div className={cx('sm-cab', cab.items.length > 10 && 'is-dense')}>
              {cab.items.map((t, i) => (
                <motion.div
                  key={t.trophyId}
                  className={cx('sm-cab__tile', isGoldTrophy(t.trophyId) && 'is-gold')}
                  title={`${t.name}: ${t.seasons.join(', ')}`}
                  initial={rm ? false : { opacity: 0, y: 10, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.4, delay: rm ? 0 : 0.3 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span className="sm-cab__art lx-trophy-spot">
                    <Prize id={t.trophyId} h={cab.items.length > 10 ? 70 : 84} maxW={cab.items.length > 10 ? 74 : 92} />
                  </span>
                  <span className="sm-cab__n">{t.name}</span>
                  <span className={cx('lx-count sm-cab__c', isGoldTrophy(t.trophyId) && 'lx-count--gold')}>×{t.count}</span>
                </motion.div>
              ))}
            </div>
          ) : (
            <p className="sm-empty">Nenhuma taça levantada — a vitrine está esperando a próxima carreira.</p>
          )}
          <Records career={career} summary={summary} saved={saved} />
        </section>
      </div>

      {/* ── by club ── */}
      <section className="lx-glass sm-panel sm-clubs" aria-labelledby="sm-clubs-h">
        <header className="sm-panel__h">
          <h2 id="sm-clubs-h">Por clube</h2>
          <span className="sm-panel__aside">
            {rows.length} {rows.length === 1 ? 'clube' : 'clubes'}
            {loans ? ` · ${loans} ${loans === 1 ? 'empréstimo' : 'empréstimos'}` : ''}
          </span>
        </header>
        <div className="sm-ct" role="table" aria-label="Estatísticas por clube">
          <div className="sm-ct__r sm-ct__head" role="row">
            <span role="columnheader">Clube</span>
            <span role="columnheader">Período</span>
            <span role="columnheader">Jogos</span>
            <span role="columnheader">Gols</span>
            <span role="columnheader">Assist.</span>
            <span role="columnheader">Títulos</span>
            <span role="columnheader">Taças</span>
          </div>
          {rows.map((r) => {
            const c = getClub(r.clubId)
            return (
              <div key={r.clubId} role="row" className={cx('sm-ct__r lx-club-row', r.loan ? 'lx-club-row--loan' : 'lx-club-row--filled')} style={rowClubVars(c)}>
                <span role="cell" className="sm-ct__club">
                  <Crest club={c} size={26} decorative />
                  <b>{c?.name ?? r.clubId}</b>
                  <small>{getLeague(r.leagueId)?.shortName}</small>
                </span>
                <span role="cell" className="sm-ct__per num">
                  {r.periods}
                </span>
                <span role="cell" className="sm-ct__n num" data-k="Jogos">
                  {formatInt(r.apps)}
                </span>
                <span role="cell" className="sm-ct__n num" data-k="Gols">
                  {formatInt(r.goals)}
                </span>
                <span role="cell" className="sm-ct__n num" data-k="Assist.">
                  {formatInt(r.assists)}
                </span>
                <span role="cell" className="sm-ct__n num" data-k="Títulos">
                  {formatInt(r.titles)}
                </span>
                <span role="cell" className="sm-ct__t">
                  {r.trophies.slice(0, 7).map((t) => (
                    <span key={t.trophyId} className="sm-ct__trophy" title={`${t.count}× ${trophyName(t.trophyId)}`}>
                      <Prize id={t.trophyId} h={26} maxW={30} />
                      {t.count > 1 && <i>×{t.count}</i>}
                    </span>
                  ))}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── national team · awards · legends ── */}
      <div className="sm-row3">
        <NationalCard career={career} summary={summary} />
        <AwardsCard summary={summary} />
        <LegendsCard summary={summary} />
      </div>

      <LegacyRankCard career={career} />

      {(summary.ballonDorPodiums.length > 0 || hasTop10(career)) && (
        <div className="sm-bdo">
          <BallonHistory state={career} selectedYear={-1} />
        </div>
      )}

      {/* ── share ── */}
      <section id="sm-share" className="lx-glass sm-panel sm-sharepanel" aria-labelledby="sm-share-h">
        <header className="sm-panel__h">
          <h2 id="sm-share-h">Card para compartilhar</h2>
          {saved ? (
            <button type="button" className="sm-saved" onClick={() => navigate('/hall')}>
              <Landmark aria-hidden="true" /> Salvo no Hall da Fama <ArrowRight aria-hidden="true" />
            </button>
          ) : (
            <span className="sm-panel__aside">{finished ? 'Salvando no Hall da Fama…' : 'Vai para o Hall da Fama quando a carreira terminar'}</span>
          )}
        </header>
        <SharePanel m={share} compact={!desktop} />
      </section>

      <footer className="sm-foot">
        <PlayAgain size="lg" live={live} finished={finished} />
        {live && finished && (
          <Button variant="ghost" size="lg" icon={ChartLine} onClick={() => navigate('/carreira')}>
            {finished ? 'Ver tabela completa' : 'Voltar à carreira'}
          </Button>
        )}
        <Button variant="text" size="lg" icon={Users} onClick={() => navigate('/hall')}>
          Hall da Fama
        </Button>
      </footer>
    </div>
  )
})

function hasTop10(career: SummaryCareer): boolean {
  return Object.values(career.world?.seasons ?? {}).some((s) => s.awards.some((a) => a.award === 'ballon_dor' && a.ranking.some((e) => e.isUser)))
}

function trophyName(trophyId: string): string {
  return getTrophy(trophyId)?.name ?? trophyId
}

// ───────────────────────── honors ─────────────────────────

const HONOR_TONE: Record<Honor['tone'], { hg: string; hl: string }> = {
  gold: { hg: 'rgba(255,205,90,.26)', hl: 'rgba(255,210,110,.32)' },
  green: { hg: 'rgba(60,220,140,.22)', hl: 'rgba(80,230,160,.28)' },
  amber: { hg: 'rgba(255,170,60,.2)', hl: 'var(--border-strong)' },
  blue: { hg: 'rgba(108,178,255,.22)', hl: 'rgba(108,178,255,.28)' },
}

function HonorCard({ h }: { h: Honor }) {
  const t = HONOR_TONE[h.tone]
  return (
    <article className={cx('lx-honor sm-honor', h.count === 0 && 'is-muted')} style={{ '--hg': t.hg, '--hl': t.hl } as CSSProperties}>
      <span className="sm-honor__corner">{h.corner}</span>
      <div className="sm-honor__art lx-trophy-spot lx-trophy-spot--gold">
        <Prize id={h.trophyId} h={h.trophyId.includes('boot') ? 70 : 108} maxW={140} />
      </div>
      <div className="sm-honor__t">
        <h3>{h.title}</h3>
        {h.count > 0 && <span className="sm-honor__x lx-metal-text--v num">×{h.count}</span>}
      </div>
      <div className="sm-honor__chips">
        {h.chips.slice(0, 5).map((c, i) => (
          <span key={c.label + i} className={cx('sm-yr', c.win && 'is-win')}>
            {c.label}
          </span>
        ))}
        {h.chips.length > 5 && <span className="sm-yr">+{h.chips.length - 5}</span>}
      </div>
      {h.foot && (
        <div className="sm-honor__foot">
          <b>{h.foot.k}</b> <span>{h.foot.v}</span>
        </div>
      )}
    </article>
  )
}

// ───────────────────────── records chips ─────────────────────────

function Records({ career, summary, saved }: { career: SummaryCareer; summary: CareerSummary; saved: boolean }) {
  const s = career.seasons
  const best = [...s].sort((a, b) => b.stats.goals - a.stats.goals)[0]
  const caps = s.filter((r) => r.captain).length
  const topClub = [...summary.clubs].sort((a, b) => b.goals - a.goals)[0]
  const promos = s.filter((r) => r.promoted).length
  const items: { icon: typeof Star; lead: string; rest: string }[] = []
  if (topClub && topClub.goals > 0) items.push({ icon: Star, lead: `${formatInt(topClub.goals)} gols`, rest: `pelo ${getClub(topClub.clubId)?.shortName ?? ''}` })
  if (best && best.stats.goals > 0) items.push({ icon: BallIcon as unknown as typeof Star, lead: `${best.stats.goals} gols`, rest: `em ${best.season} · recorde pessoal` })
  if (caps) items.push({ icon: Crown, lead: `Capitão`, rest: `em ${caps} ${caps === 1 ? 'temporada' : 'temporadas'}` })
  if (promos) items.push({ icon: TrophyIcon, lead: `${promos} ${promos === 1 ? 'acesso' : 'acessos'}`, rest: 'de divisão' })
  if (saved) items.push({ icon: Landmark, lead: 'Hall da Fama', rest: 'LENDA' })
  if (!items.length) return null
  return (
    <div className="sm-records">
      {items.map((it) => (
        <span key={it.lead + it.rest} className="sm-record">
          <it.icon aria-hidden="true" />
          <b>{it.lead}</b> {it.rest}
        </span>
      ))}
    </div>
  )
}

// ───────────────────────── national team ─────────────────────────

function NationalCard({ career, summary }: { career: SummaryCareer; summary: CareerSummary }) {
  const code = career.seasons[career.seasons.length - 1]?.nationality ?? career.identity.nationality
  const country = getCountry(code)
  const n = summary.national
  const trophies = new Map<string, number>()
  for (const t of n.trophies) trophies.set(t.trophyId, (trophies.get(t.trophyId) ?? 0) + 1)
  return (
    <section className="lx-glass sm-panel sm-nat" style={rowClubVars(nationColors(country))} aria-labelledby="sm-nat-h">
      <header className="sm-nat__h">
        <Flag code={code} h={36} radius={5} decorative />
        <div>
          <div className="lx-eyebrow">Seleção</div>
          <h2 id="sm-nat-h">{country?.name ?? code}</h2>
        </div>
        {n.firstCallUp && <span className="sm-panel__aside sm-nat__first">Estreia em {n.firstCallUp}</span>}
      </header>
      {n.apps > 0 ? (
        <>
          <dl className="sm-nat__stats">
            <div>
              <dt>
                <ShirtIcon aria-hidden="true" /> Jogos
              </dt>
              <dd className="num">{formatInt(n.apps)}</dd>
            </div>
            <div>
              <dt>
                <BallIcon aria-hidden="true" /> Gols
              </dt>
              <dd className="num">{formatInt(n.goals)}</dd>
            </div>
            <div>
              <dt>
                <BootIcon aria-hidden="true" /> Assist.
              </dt>
              <dd className="num">{formatInt(n.assists)}</dd>
            </div>
          </dl>
          {n.tournaments.length > 0 && (
            <ul className="sm-nat__list">
              {[...n.tournaments]
                .sort((a, b) => a.year - b.year)
                .map((t) => (
                  <li key={t.competitionId + t.year} className={cx(t.reached === 'Campeão' && 'is-gold')}>
                    <CompLogo id={t.competitionId} size={20} />
                    <span className="sm-nat__c">
                      {getCompetition(t.competitionId)?.name ?? t.competitionId} <span className="num">{t.year}</span>
                    </span>
                    <span className="sm-nat__r">{t.reached}</span>
                    <span className="sm-nat__g num">{t.goals} g</span>
                  </li>
                ))}
            </ul>
          )}
          {trophies.size > 0 && (
            <div className="sm-nat__tro">
              {[...trophies.entries()].map(([t, c]) => (
                <span key={t} className="sm-nat__trophy">
                  <Prize id={t} h={58} maxW={60} />
                  {c > 1 && <i className="lx-count lx-count--gold">×{c}</i>}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="sm-empty">
          <FlagIcon aria-hidden="true" /> Nunca foi convocado. A camisa da seleção fica para a próxima.
        </p>
      )}
    </section>
  )
}

// ───────────────────────── awards ─────────────────────────

function AwardsCard({ summary }: { summary: CareerSummary }) {
  const list = awardsSorted(summary)
  const pods = summary.ballonDorPodiums.filter((p) => p.place > 1)
  return (
    <section className="lx-glass sm-panel sm-awards" aria-labelledby="sm-aw-h">
      <header className="sm-panel__h">
        <h2 id="sm-aw-h">Prêmios individuais</h2>
        <span className="sm-panel__aside">{list.reduce((a, x) => a + x.count, 0)} no total</span>
      </header>
      {list.length ? (
        <ul className="sm-aw">
          {list.map((a) => (
            <li key={a.award}>
              <span className="sm-aw__art">
                <Prize id={awardTrophy(a.award)} h={40} maxW={48} />
              </span>
              <span className="sm-aw__t">
                <b>{AWARD_NAME[a.award]}</b>
                <small className="num">{a.years.join(' · ')}</small>
              </span>
              <span className="sm-aw__x lx-metal-text--v num">×{a.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sm-empty">
          <Sparkles aria-hidden="true" /> Nenhum prêmio individual — ainda.
        </p>
      )}
      {pods.length > 0 && (
        <div className="sm-aw__pods">
          <span className="lx-eyebrow">Pódios na Bola de Ouro</span>
          <div>
            {pods.map((p) => (
              <span key={p.year} className={cx('sm-yr', p.place === 2 ? 'is-silver' : 'is-bronze')}>
                {p.place}º {p.year}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

// ───────────────────────── legends ─────────────────────────

function LegendsCard({ summary }: { summary: CareerSummary }) {
  const you = summary.totals.goals
  const bars = [...LEGENDS.map((l) => ({ name: l.name, goals: l.goals, you: false })), { name: 'Você', goals: you, you: true }].sort((a, b) => b.goals - a.goals)
  const max = Math.max(...bars.map((b) => b.goals), 1)
  const at = bars.findIndex((b) => b.you)
  const shown = bars.filter((_, i) => i < 3 || Math.abs(i - at) <= 2 || i === bars.length - 1)
  return (
    <section className="lx-glass sm-panel sm-legends" aria-labelledby="sm-lg-h">
      <header className="sm-panel__h">
        <h2 id="sm-lg-h">Comparação com lendas</h2>
        <span className="sm-panel__aside">Gols na carreira</span>
      </header>
      <ol className="sm-lg">
        {shown.map((b) => (
          <li key={b.name} className={cx(b.you && 'is-you')}>
            <span className="sm-lg__n">{b.name}</span>
            <span className="sm-lg__bar" aria-hidden="true">
              <i style={{ width: `${Math.max(3, (b.goals / max) * 100)}%` }} />
            </span>
            <span className="sm-lg__v num">{formatInt(b.goals)}</span>
          </li>
        ))}
      </ol>
      {summary.comparisons.length > 0 && (
        <ul className="sm-quotes">
          {summary.comparisons.slice(0, 4).map((c) => (
            <li key={c}>
              <Quote aria-hidden="true" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
