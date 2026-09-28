/**
 * Partida ao vivo — pré-jogo (seu status, adversário, estádio) → transmissão: bug de placar com
 * relógio, campo 2D, lances, narração, estatísticas, momentum, lance decisivo com cronômetro,
 * minijogos, controles (próximo lance, velocidade 1×/2×/instantâneo, auto), intervalo e fim de
 * jogo (nota, estatísticas, craque do jogo) → "Voltar à Central".
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  BatteryMedium,
  Crown,
  FastForward,
  Flag as FlagIcon,
  HeartPulse,
  List,
  Megaphone,
  MessageSquareText,
  Pause,
  Play,
  Shirt,
  SkipForward,
  Square,
  Tv,
  Zap,
} from 'lucide-react'
import type { KeyMoment, LiveMatch, MatchEvent } from '@/engine/immersive/types'
import { useEffectStream, useImmersive } from '@/store/immersive'
import { BallIcon, Button, Segmented, Tabs, clubVars, cx, useMediaQuery, useReducedMotion } from '@/ui/primitives'
import { sfx } from '@/ui/shell/sfx'
import { CompLogo, ImOvr, Kpi, LowerThird, Meter, PanelHead, RatingBadge, SplitStat, TeamMark } from '../bits'
import { compInfo, fmtRating, isGoal, oppTeam, ratingTone, scoreFrom, teamInfo, userTeam, visibleColor, type TeamInfo } from '../model/view'
import { Confetti } from '../fx/TrophyCelebration'
import { KeyMomentPrompt, type MomentChoice } from './KeyMoment'
import { Pitch } from './Pitch'
import { ScoreBug } from './ScoreBug'
import { usePlayback, usePlaybackDriver, useShownEvents, type Speed } from './playback'

// ───────────────────────── helpers ─────────────────────────

const EV_ICON: Partial<Record<MatchEvent['type'], typeof Zap>> = {
  sub_on: ArrowLeftRight,
  sub_off: ArrowLeftRight,
  injury: HeartPulse,
  var: Tv,
  half_time: FlagIcon,
  full_time: FlagIcon,
  kickoff: Play,
  save: Activity,
  chance: Zap,
  woodwork: Square,
  key_moment: Zap,
}
const EV_LABEL: Partial<Record<MatchEvent['type'], string>> = {
  goal: 'Gol',
  own_goal: 'Gol contra',
  penalty_goal: 'Gol de pênalti',
  penalty_miss: 'Pênalti perdido',
  chance: 'Chance',
  save: 'Defesa',
  woodwork: 'Na trave',
  yellow: 'Cartão amarelo',
  red: 'Expulsão',
  sub_on: 'Substituição',
  sub_off: 'Substituição',
  injury: 'Lesão',
  var: 'VAR',
  half_time: 'Intervalo',
  full_time: 'Fim de jogo',
  kickoff: 'Bola rolando',
  key_moment: 'Lance',
}
const KEY_TYPES = new Set<MatchEvent['type']>(['goal', 'own_goal', 'penalty_goal', 'penalty_miss', 'red', 'yellow', 'sub_on', 'injury', 'var', 'woodwork', 'save'])

function EvIcon({ e }: { e: MatchEvent }) {
  if (isGoal(e)) return <BallIcon size={16} aria-hidden />
  if (e.type === 'yellow' || e.type === 'red') return <i className={cx('im-card', e.type === 'red' && 'is-red')} aria-hidden="true" />
  const I = EV_ICON[e.type] ?? Zap
  return <I size={16} aria-hidden="true" />
}

function shotsFrom(events: MatchEvent[]): { shots: [number, number]; on: [number, number] } {
  const shots: [number, number] = [0, 0]
  const on: [number, number] = [0, 0]
  for (const e of events) {
    const i = e.side === 'home' ? 0 : 1
    if (e.type === 'goal' || e.type === 'penalty_goal') {
      shots[i]++
      on[i]++
    } else if (e.type === 'chance' || e.type === 'woodwork' || e.type === 'penalty_miss') shots[i]++
    else if (e.type === 'save') {
      shots[i]++
      on[i]++
    }
  }
  return { shots, on }
}

/** Craque do jogo: você (nota ≥ 7,8 sem derrota) ou quem mais decidiu pelo vencedor. */
function manOfMatch(live: LiveMatch, surname: string): { name: string; team: TeamInfo; you: boolean; note: string } {
  const us = userTeam(live)
  const them = oppTeam(live)
  const usG = live.userSide === 'home' ? live.score[0] : live.score[1]
  const thG = live.userSide === 'home' ? live.score[1] : live.score[0]
  const lost = live.pens ? (live.userSide === 'home' ? live.pens[0] < live.pens[1] : live.pens[1] < live.pens[0]) : usG < thG
  if (live.stats.minutes > 0 && live.stats.rating >= 7.8 && !lost) return { name: surname, team: teamInfo(us.id, us), you: true, note: `Nota ${fmtRating(live.stats.rating)}` }
  const winnerSide: 'home' | 'away' = live.score[0] >= live.score[1] ? 'home' : 'away'
  const tally = new Map<string, number>()
  for (const e of live.events) {
    if (e.side !== winnerSide || e.byUser) continue
    if (isGoal(e) && e.player) tally.set(e.player, (tally.get(e.player) ?? 0) + 3)
    if (isGoal(e) && e.assist) tally.set(e.assist, (tally.get(e.assist) ?? 0) + 1)
    if (e.type === 'save' && e.player) tally.set(e.player, (tally.get(e.player) ?? 0) + 1)
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
  const side = winnerSide === 'home' ? live.home : live.away
  if (best) return { name: best[0], team: teamInfo(side.id, side), you: false, note: `${Math.floor(best[1] / 3)} gol${Math.floor(best[1] / 3) === 1 ? '' : 's'}` }
  return { name: side.id === us.id ? surname : 'Goleiro do ' + them.shortName, team: teamInfo(side.id, side), you: side.id === us.id, note: 'Destaque' }
}

// ───────────────────────── pré-jogo ─────────────────────────

const PreMatch = memo(function PreMatch({ live }: { live: LiveMatch }) {
  const s = useImmersive((x) => x.state)!
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const phone = useMediaQuery('(max-width: 44.99rem)')
  const home = teamInfo(live.home.id, live.home)
  const away = teamInfo(live.away.id, live.away)
  const comp = compInfo(live.competitionId)
  const st = live.userStatus
  const statusText = st === 'starter' ? 'Titular' : st === 'bench' ? 'Banco de reservas' : 'Fora da partida'
  const statusSub =
    st === 'starter'
      ? `Camisa ${s.squadNumber} · ${s.identity.position} · o técnico confia em você.`
      : st === 'bench'
        ? 'Aquecendo no banco — a chance deve vir no segundo tempo.'
        : s.condition.injury
          ? `${s.condition.injury.name}: você acompanha da tribuna.`
          : (s.condition.suspendedMatches ?? 0) > 0
            ? 'Suspenso: você acompanha da tribuna.'
            : 'Não relacionado pelo técnico: você acompanha da tribuna.'
  const start = (accept?: boolean) => {
    sfx.play('whistle')
    void dispatch({ type: 'match_start', accept })
  }
  return (
    <main id="conteudo" tabIndex={-1} className="im-wrap im-pre outline-none">
      <div className="im-pre__card lx-plate lx-c-xl lx-anim-rise">
        <i className="lx-hl-top" aria-hidden="true" />
        <div className="lx-club-glow" aria-hidden="true" />
        <div className="im-pre__top">
          <span className="lx-kicker">
            <span className="lx-live-dot" /> Pré-jogo · {comp.short}
            {live.stage ? ` · ${live.stage}` : ''}
          </span>
          <CompLogo id={live.competitionId} size={34} />
        </div>
        <div className="im-vs is-big">
          {[home, away].map((t, i) => (
            <div key={t.id} className={cx('im-vs__team', i === 0 ? 'is-home' : 'is-away')}>
              <TeamMark team={t} size={phone ? 60 : 96} className="im-vs__crest" />
              <b className="im-vs__name">{t.name}</b>
              <span className="im-vs__pos">
                {i === 0 ? 'Mandante' : 'Visitante'} · força {Math.round(i === 0 ? live.home.strength : live.away.strength)}
              </span>
            </div>
          ))}
          <span className="im-vs__x" aria-hidden="true">
            ×
          </span>
        </div>
        <div className="im-pre__meta">
          <span className="lx-chip lx-chip--sm">
            <Megaphone size={12} aria-hidden="true" /> {home.national ? 'Estádio nacional' : `Casa do ${home.short}`}
          </span>
          <span className="lx-chip lx-chip--sm">{live.knockout ? 'Mata-mata' : 'Pontos corridos'}</span>
          {live.importance >= 0.8 && <span className="lx-chip lx-chip--sm lx-chip--gold">Jogo decisivo</span>}
        </div>
        <div className={cx('im-pre__status', `is-${st}`)}>
          <span className="im-pre__badge">
            <Shirt size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <span className="lx-label">Seu status</span>
            <b className="im-pre__st">{statusText}</b>
            <p className="lx-t-small m-0">{statusSub}</p>
          </div>
          <div className="im-pre__meters">
            <Meter label="Energia" value={s.condition.fitness} icon={BatteryMedium} />
            <Meter label="Ritmo" value={s.condition.sharpness} icon={Activity} />
          </div>
        </div>
        <div className="im-pre__cta">
          {st === 'bench' && (
            <Button variant="ghost" size="lg" onClick={() => start(false)} disabled={busy} title="O técnico não vai gostar">
              Recusar o banco
            </Button>
          )}
          <Button variant="primary" size="xl" icon={Play} loading={busy} onClick={() => start(true)} autoFocus>
            {st === 'out' ? 'Assistir à partida' : st === 'bench' ? 'Ir para o banco' : 'Entrar em campo'}
          </Button>
        </div>
      </div>
    </main>
  )
})

// ───────────────────────── painéis ─────────────────────────

const EventsList = memo(function EventsList({ events, home, away }: { events: MatchEvent[]; home: TeamInfo; away: TeamInfo }) {
  const list = events.filter((e) => KEY_TYPES.has(e.type)).slice().reverse()
  return (
    <ol className="im-evs" aria-live="polite" aria-label="Lances">
      {list.length === 0 && <li className="lx-t-small im-evs__empty">Nenhum lance importante ainda.</li>}
      {list.map((e, i) => {
        const t = e.side === 'home' ? home : away
        return (
          <li key={`${e.minute}-${e.type}-${i}-${list.length}`} className={cx('im-ev', i === 0 && 'lx-anim-slide lx-stamp', isGoal(e) && 'is-goal', e.byUser && 'is-me')} style={{ ['--tc' as string]: t.colors.primary } as CSSProperties}>
            <span className="im-ev__min num">{e.minute}&apos;</span>
            <span className="im-ev__ic">
              <EvIcon e={e} />
            </span>
            <span className="im-ev__txt">
              <b>{EV_LABEL[e.type]}{e.player ? ` · ${e.player}` : ''}</b>
              <small>{t.short}{e.assist && isGoal(e) ? ` · assist. ${e.assist}` : ''}</small>
            </span>
          </li>
        )
      })}
    </ol>
  )
})

const Narration = memo(function Narration({ events }: { events: MatchEvent[] }) {
  const list = events.slice().reverse()
  return (
    <ol className="im-narr" aria-label="Narração">
      {list.map((e, i) => (
        <li key={`${e.minute}-${i}-${list.length}`} className={cx(i === 0 && 'lx-anim-rise', (isGoal(e) || e.byUser) && 'is-strong', isGoal(e) && 'is-goal')}>
          <span className="im-narr__min num">{e.minute}&apos;</span>
          <span>{e.text}</span>
        </li>
      ))}
    </ol>
  )
})

const StatsPanel = memo(function StatsPanel({ live, events, home, away }: { live: LiveMatch; events: MatchEvent[]; home: TeamInfo; away: TeamInfo }) {
  const { shots, on } = shotsFrom(events)
  const hc = visibleColor(home.colors)
  const ac = visibleColor(away.colors, hc)
  const cards = (side: 'home' | 'away') => events.filter((e) => (e.type === 'yellow' || e.type === 'red') && e.side === side).length
  return (
    <div className="im-stats">
      <SplitStat label="Posse" home={live.team.possession[0]} away={live.team.possession[1]} homeColor={hc} awayColor={ac} pct />
      <SplitStat label="Finalizações" home={Math.max(shots[0], 0)} away={shots[1]} homeColor={hc} awayColor={ac} />
      <SplitStat label="No alvo" home={on[0]} away={on[1]} homeColor={hc} awayColor={ac} />
      <SplitStat label="Cartões" home={cards('home')} away={cards('away')} homeColor={hc} awayColor={ac} />
    </div>
  )
})

const YouCard = memo(function YouCard({ live, clock, events }: { live: LiveMatch; clock: number; events: MatchEvent[] }) {
  const s = useImmersive((x) => x.state)!
  const st = live.stats
  const gk = s.identity.position === 'GOL'
  const entered = live.userStatus === 'starter' ? 0 : events.find((e) => e.type === 'sub_on' && e.byUser)?.minute ?? clock
  const mins = live.userOnPitch ? Math.max(0, clock - entered) : st.minutes
  const status = live.userOnPitch ? 'Em campo' : live.userStatus === 'bench' ? (st.minutes ? 'Substituído' : 'No banco') : live.userStatus === 'out' ? 'Fora' : 'Substituído'
  return (
    <section className="lx-plate lx-plate--flat lx-c-md im-you" aria-label="Você na partida">
      <div className="im-you__top">
        <ImOvr ovr={s.ovr} w={54} />
        <div className="min-w-0 flex-1">
          <b className="im-you__name">{s.identity.surname}</b>
          <span className="im-you__meta">
            {s.identity.position} · #{s.squadNumber} · {status}
            {live.userOnPitch || st.minutes ? ` · ${mins} min` : ''}
          </span>
        </div>
        <RatingBadge rating={st.rating} live />
      </div>
      <div className="im-you__kpis">
        {gk ? (
          <>
            <Kpi label="Defesas" value={st.saves ?? 0} />
            <Kpi label="Sofridos" value={st.conceded ?? 0} />
          </>
        ) : (
          <>
            <Kpi label="Gols" value={st.goals} gold={st.goals > 0} />
            <Kpi label="Assist." value={st.assists} />
          </>
        )}
        <Kpi label={gk ? 'Passes' : 'Finaliz.'} value={gk ? st.keyPasses : `${st.shotsOnTarget}/${st.shots}`} />
        <Kpi label={gk ? 'Saídas' : s.identity.position === 'ZAG' || s.identity.position === 'VOL' ? 'Desarmes' : 'Dribles'} value={gk ? st.tackles : s.identity.position === 'ZAG' || s.identity.position === 'VOL' ? st.tackles : st.dribbles} />
      </div>
      <Meter label="Energia" value={s.condition.fitness} icon={BatteryMedium} />
    </section>
  )
})

/** Momentum: barras por janela de 3 min (casa ↑, visitante ↓), gols = losangos, minuto atual ciano. */
const Momentum = memo(function Momentum({ events, clock, home, away, userSide }: { events: MatchEvent[]; clock: number; home: TeamInfo; away: TeamInfo; userSide: 'home' | 'away' }) {
  const W = { goal: 5, penalty_goal: 5, own_goal: 4, chance: 3, save: 3, woodwork: 3, penalty_miss: 3, key_moment: 2, yellow: 1, red: 2, var: 1 } as Partial<Record<MatchEvent['type'], number>>
  const buckets = Array.from({ length: 31 }, () => [0, 0])
  const hc = visibleColor(home.colors)
  const ac = visibleColor(away.colors, hc)
  for (const e of events) {
    const w = W[e.type]
    if (!w) continue
    const b = Math.min(30, Math.floor(e.minute / 3))
    buckets[b][e.side === 'home' ? 0 : 1] += w
  }
  return (
    <div className="lx-plate lx-plate--flat lx-c-sm im-mom" aria-label="Momentum da partida">
      <span className="lx-label im-mom__l">Momentum</span>
      <svg viewBox="0 0 930 48" preserveAspectRatio="none" className="im-mom__svg" aria-hidden="true">
        <line x1="0" x2="930" y1="24" y2="24" stroke="var(--border-strong)" strokeWidth="1" />
        {buckets.map(([h, a], i) => (
          <g key={i}>
            {h > 0 && <rect x={i * 30 + 6} y={24 - Math.min(22, h * 3.4)} width="18" height={Math.min(22, h * 3.4)} fill={hc} opacity=".85" />}
            {a > 0 && <rect x={i * 30 + 6} y={24} width="18" height={Math.min(22, a * 3.4)} fill={ac} opacity=".85" />}
          </g>
        ))}
        {events.filter(isGoal).map((e, i) => {
          const side = e.type === 'own_goal' ? (e.side === 'home' ? 'away' : 'home') : e.side
          return <rect key={i} x={(e.minute / 90) * 930 - 5} y={side === 'home' ? 2 : 36} width="10" height="10" transform={`rotate(45 ${(e.minute / 90) * 930} ${side === 'home' ? 7 : 41})`} fill={side === userSide ? '#F7C948' : '#F4F6FF'} />
        })}
        <line x1={(Math.min(90, clock) / 90) * 930} x2={(Math.min(90, clock) / 90) * 930} y1="0" y2="48" stroke="#3BE4FF" strokeWidth="2" />
      </svg>
    </div>
  )
})

// ───────────────────────── stinger + lower-thirds ─────────────────────────

interface Lt {
  id: number
  k: string
  v: string
  tone?: 'accent' | 'club' | 'live' | 'red' | 'yellow'
  icon?: typeof Zap
  style?: CSSProperties
  mark?: TeamInfo
}

function useLowerThirds(speed: Speed) {
  const [list, setList] = useState<Lt[]>([])
  const idRef = useRef(0)
  const push = useCallback((lt: Omit<Lt, 'id'>) => setList((l) => [...l.slice(-2), { ...lt, id: ++idRef.current }]), [])
  useEffect(() => {
    if (!list.length) return
    const t = setTimeout(() => setList((l) => l.slice(1)), speed === 2 ? 2000 : 3500)
    return () => clearTimeout(t)
  }, [list, speed])
  return { current: list[0] ?? null, push }
}

// ───────────────────────── partida ─────────────────────────

export default function MatchScreen() {
  const s = useImmersive((x) => x.state)!
  const live = s.live!
  if (live.phase === 'pre') return <PreMatch live={live} />
  return <LiveMatchView key={live.itemId} />
}

function LiveMatchView() {
  const s = useImmersive((x) => x.state)!
  const live = s.live!
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const rm = useReducedMotion()
  const phone = useMediaQuery('(max-width: 44.99rem)')
  const home = useMemo(() => teamInfo(live.home.id, live.home), [live.home])
  const away = useMemo(() => teamInfo(live.away.id, live.away), [live.away])
  const [auto, setAuto] = useState(() => {
    try {
      return localStorage.getItem('lenda:imm:auto') !== '0'
    } catch {
      return true
    }
  })
  const [active, setActive] = useState<KeyMoment | null>(null)
  const [mBusy, setMBusy] = useState(false)
  const [stinger, setStinger] = useState<{ id: number; mine: boolean; own: boolean } | null>(null)
  const [tab, setTab] = useState<'lances' | 'narracao' | 'stats'>('lances')
  const speed = usePlayback((x) => x.speed)
  const setSpeed = usePlayback((x) => x.setSpeed)
  const settled = usePlayback((x) => x.settled)
  const last = usePlayback((x) => x.last)
  const seq = usePlayback((x) => x.revealSeq)
  const burst = usePlayback((x) => x.burst)
  const clock = usePlayback((x) => Math.floor(x.clock))
  const lt = useLowerThirds(speed)
  const paused = !!active || !!stinger

  usePlaybackDriver(live, !!active)
  const events = useShownEvents(live)
  const score = useMemo(() => (settled && live.phase !== 'penalties' ? live.score : scoreFrom(events)), [settled, live.score, live.phase, events])

  // lance decisivo aparece quando o replay alcança o minuto
  useEffect(() => {
    if (settled && live.pendingMoment && !active) setActive(live.pendingMoment)
  }, [settled, live.pendingMoment, active])
  useEffect(() => {
    if (active && !mBusy && live.pendingMoment?.id !== active.id) setActive(null)
  }, [live.pendingMoment, mBusy, active])

  // eventos revelados → stinger, lower-third, som
  useEffect(() => {
    if (!seq) return
    const list = burst.length ? burst : last ? [last] : []
    for (const e of list) {
      const t = e.side === 'home' ? home : away
      if (isGoal(e)) {
        const scorer = e.type === 'own_goal' ? (e.side === 'home' ? 'away' : 'home') : e.side
        const mine = scorer === live.userSide
        setStinger({ id: seq, mine, own: !!e.byUser })
        sfx.play(mine ? 'goal' : 'miss')
        lt.push({ k: `${EV_LABEL[e.type]} · ${e.minute}'`, v: `${e.player ?? t.short} · ${(scorer === 'home' ? home : away).short}`, tone: mine ? undefined : 'accent', mark: scorer === 'home' ? home : away })
      } else if (e.type === 'yellow' || e.type === 'red') lt.push({ k: `${EV_LABEL[e.type]} · ${e.minute}'`, v: `${e.player ?? ''} · ${t.short}`, tone: e.type === 'red' ? 'red' : 'yellow', icon: Square })
      else if (e.type === 'sub_on') lt.push({ k: `Substituição · ${e.minute}'`, v: `Entra ${e.player ?? ''}${e.assist ? ` · sai ${e.assist}` : ''}`, tone: 'club', icon: ArrowLeftRight, style: clubVars(t.colors) as CSSProperties })
      else if (e.type === 'injury') lt.push({ k: `Lesão · ${e.minute}'`, v: e.player ?? t.short, tone: 'red', icon: HeartPulse })
      else if (e.type === 'var') lt.push({ k: 'VAR', v: e.text.slice(0, 48), tone: 'accent', icon: Tv })
      else if (e.type === 'half_time') {
        lt.push({ k: 'Intervalo', v: `${home.short} ${live.score[0]} × ${live.score[1]} ${away.short}`, tone: 'live', icon: FlagIcon })
        sfx.play('whistle')
      } else if (e.type === 'full_time') sfx.play('whistle')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq])
  useEffect(() => {
    if (!stinger) return
    const t = setTimeout(() => setStinger(null), rm ? 900 : speed === 2 ? 1300 : 2300)
    return () => clearTimeout(t)
  }, [stinger, rm, speed])

  // resultado do lance → lower-third
  useEffectStream((e) => {
    if (e.type === 'moment_result' && !e.goal) lt.push({ k: e.success ? 'Deu certo' : 'Não deu', v: e.text.replace(/^[A-ZÇÃÉÍÓÚ!]+[!.]\s*/, '').slice(0, 60), tone: e.success ? 'accent' : 'red', icon: Zap })
  })

  const running = live.phase === 'first_half' || live.phase === 'second_half' || live.phase === 'extra_time' || (live.phase === 'penalties' && !live.pendingMoment)
  const canSim = settled && !busy && !active && !live.pendingMoment && running

  // auto: segue até o próximo lance
  useEffect(() => {
    if (!auto || !canSim || stinger) return
    const t = setTimeout(() => void dispatch({ type: 'match_sim' }), speed === 0 ? 80 : 900)
    return () => clearTimeout(t)
  }, [auto, canSim, stinger, speed, dispatch, live.minute, live.events.length])

  const next = useCallback(() => {
    if (!settled) {
      usePlayback.getState().skip()
      return
    }
    if (live.phase === 'half_time') return void dispatch({ type: 'match_sim' })
    if (canSim) void dispatch({ type: 'match_sim' })
  }, [settled, live.phase, canSim, dispatch])

  const simToEnd = useCallback(async () => {
    setSpeed(0)
    setAuto(true)
    for (let i = 0; i < 30; i++) {
      const l = useImmersive.getState().state?.live
      if (!l || l.phase === 'full_time') break
      if (l.pendingMoment) {
        const best = l.pendingMoment.options.slice().sort((a, b) => b.chance - a.chance)[0]
        await dispatch({ type: 'match_choose', optionId: best.id, minigame: l.pendingMoment.minigame === 'timing' ? { timing: 0.6 } : l.pendingMoment.minigame ? { side: best.id as 'left' } : undefined })
      } else await dispatch({ type: 'match_sim' })
    }
    setActive(null)
  }, [dispatch, setSpeed])

  // teclado: Espaço = próximo lance / pular replay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || active || e.target instanceof HTMLInputElement || (e.target instanceof HTMLElement && e.target.closest('[role="dialog"]'))) return
      if (e.target instanceof HTMLButtonElement) return
      e.preventDefault()
      next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, active])

  const choose: MomentChoice = useCallback(async (optionId, minigame) => dispatch({ type: 'match_choose', optionId, minigame }), [dispatch])
  const timeout = useCallback(() => {
    setMBusy(true)
    void dispatch({ type: 'match_timeout' }).finally(() => setMBusy(false))
  }, [dispatch])

  const ft = live.phase === 'full_time' && settled
  const ht = live.phase === 'half_time' && settled
  const meLabel = `${s.identity.surname} · ${fmtRating(live.stats.rating)}`
  const vars = clubVars(userTeam(live).id === home.id ? home.colors : away.colors) as CSSProperties

  const bug = <ScoreBug live={live} home={home} away={away} score={score} events={events} last={last} seq={seq} />
  const pitch = (
    <div className="im-field">
      <Pitch live={live} home={home} away={away} userPos={s.identity.position} userNumber={s.squadNumber} focus={last} focusSeq={seq} moment={active} dim={!!active} meLabel={meLabel} dotScale={phone ? 1.7 : 1} />
      {!phone && <div className="im-field__bug">{bug}</div>}
      <AnimatePresence>
        {lt.current && !active && (
          <motion.div key={lt.current.id} className="im-field__lt" initial={rm ? { opacity: 0 } : { opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: rm ? 0 : 30 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
            <LowerThird k={lt.current.k} v={lt.current.v} tone={lt.current.tone} icon={lt.current.mark ? undefined : lt.current.icon ?? BallIcon} style={lt.current.style}>
              {lt.current.mark ? <TeamMark team={lt.current.mark} size={26} /> : null}
            </LowerThird>
          </motion.div>
        )}
      </AnimatePresence>
      {stinger && (
        <div className={cx('lx-stinger im-stinger', !stinger.mine && 'is-them')} key={stinger.id} aria-hidden="true">
          <span className="lx-stinger__txt">{stinger.mine ? 'Gooool!' : 'Gol'}</span>
        </div>
      )}
      {stinger?.own && !rm && <Confetti n={46} seed={stinger.id} />}
      {active && <KeyMomentPrompt key={active.id} live={live} moment={active} onChoose={choose} onTimeout={timeout} onBusy={setMBusy} />}
      {ht && <HalfTime live={live} home={home} away={away} events={events} onNext={next} busy={busy} />}
    </div>
  )

  const controls = (
    <div className={cx('lx-plate lx-plate--flat lx-c-sm im-ctrl', phone && 'is-dock')}>
      <div className="im-ctrl__grp max-sm:hidden">
        <span className="lx-label">Velocidade</span>
        <Segmented<'1' | '2' | '0'>
          size="sm"
          value={String(speed) as '1' | '2' | '0'}
          onChange={(v) => setSpeed(Number(v) as Speed)}
          aria-label="Velocidade da transmissão"
          options={[
            { value: '1', label: '1×' },
            { value: '2', label: '2×' },
            { value: '0', label: 'Instantâneo', icon: FastForward },
          ]}
        />
      </div>
      <button
        type="button"
        className={cx('im-auto lx-focus-inset', auto && 'is-on')}
        aria-pressed={auto}
        onClick={() => {
          setAuto(!auto)
          try {
            localStorage.setItem('lenda:imm:auto', auto ? '0' : '1')
          } catch {
            /* ignore */
          }
        }}
        title="Seguir automaticamente até o próximo lance"
      >
        {auto ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        {auto ? 'Auto' : 'Pausado'}
      </button>
      {phone && (
        <button type="button" className="im-auto lx-focus-inset" onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 0 : 1)} aria-label="Trocar velocidade">
          <FastForward size={14} aria-hidden="true" /> {speed === 0 ? 'Inst.' : `${speed}×`}
        </button>
      )}
      <span className="flex-1" />
      {live.userOnPitch && live.phase !== 'full_time' && s.condition.fitness < 55 && (
        <Button variant="ghost" size="sm" onClick={() => void dispatch({ type: 'match_sub_request' })} className="max-sm:hidden">
          Pedir para sair
        </Button>
      )}
      <Button variant="ghost" size="sm" icon={SkipForward} onClick={() => void simToEnd()} disabled={busy || live.phase === 'full_time'} className="max-sm:hidden">
        Simular até o fim
      </Button>
      <Button variant="primary" size="sm" iconRight={ArrowRight} onClick={next} disabled={!!active || live.phase === 'full_time' || (settled && !canSim && live.phase !== 'half_time')} kbd="Espaço">
        {!settled ? 'Pular' : live.phase === 'half_time' ? '2º tempo' : 'Próx. lance'}
      </Button>
    </div>
  )

  return (
    <main id="conteudo" tabIndex={-1} className={cx('im-match outline-none', phone && 'is-phone')} style={vars}>
      {phone && <div className="im-match__bugbar">{bug}</div>}
      <div className="im-match__grid">
        <aside className="im-match__l max-lg:hidden">
          <section className="lx-plate lx-plate--flat lx-c-md im-panel is-fill">
            <PanelHead kicker="Lances" icon={List} />
            <EventsList events={events} home={home} away={away} />
          </section>
          <section className="lx-plate lx-plate--flat lx-c-md im-panel">
            <PanelHead kicker="Estatísticas" icon={Activity} />
            <StatsPanel live={live} events={events} home={home} away={away} />
          </section>
        </aside>
        <div className="im-match__c">
          {pitch}
          <Momentum events={events} clock={clock} home={home} away={away} userSide={live.userSide} />
          {!phone && controls}
          {phone && (
            <div className="im-match__tabs">
              <Tabs
                value={tab}
                onChange={setTab}
                idPrefix="im-mt"
                variant="underline"
                aria-label="Painéis da partida"
                tabs={[
                  { value: 'lances', label: 'Lances', icon: List },
                  { value: 'narracao', label: 'Narração', icon: MessageSquareText },
                  { value: 'stats', label: 'Números', icon: Activity },
                ]}
              />
              <div className="im-match__tabp">
                {tab === 'lances' ? <EventsList events={events} home={home} away={away} /> : tab === 'narracao' ? <Narration events={events} /> : <StatsPanel live={live} events={events} home={home} away={away} />}
              </div>
              <YouCard live={live} clock={clock} events={events} />
            </div>
          )}
        </div>
        <aside className="im-match__r max-lg:hidden">
          <YouCard live={live} clock={clock} events={events} />
          <section className="lx-plate lx-plate--flat lx-c-md im-panel is-fill">
            <PanelHead kicker="Narração" icon={MessageSquareText} />
            <Narration events={events} />
          </section>
        </aside>
      </div>
      {phone && controls}
      {ft && <FullTime live={live} home={home} away={away} />}
      {paused && <span className="sr-only">Transmissão pausada</span>}
    </main>
  )
}

// ───────────────────────── intervalo ─────────────────────────

function HalfTime({ live, home, away, events, onNext, busy }: { live: LiveMatch; home: TeamInfo; away: TeamInfo; events: MatchEvent[]; onNext: () => void; busy: boolean }) {
  const rm = useReducedMotion()
  return (
    <motion.div className="im-ht" initial={rm ? { opacity: 0 } : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} role="dialog" aria-labelledby="im-ht-t">
      <div className="lx-plate lx-plate--glass lx-c-lg im-ht__card">
        <i className="lx-hl-top" aria-hidden="true" />
        <span className="lx-kicker lx-kicker--gold" id="im-ht-t">
          Intervalo
        </span>
        <ScorePlate live={live} home={home} away={away} />
        <StatsPanel live={live} events={events} home={home} away={away} />
        <div className="im-ht__you">
          <span className="lx-label">Sua nota no 1º tempo</span>
          <RatingBadge rating={live.stats.rating} />
        </div>
        <Button variant="primary" size="lg" icon={Play} onClick={onNext} loading={busy} autoFocus kbd="Espaço" block>
          Começar o 2º tempo
        </Button>
      </div>
    </motion.div>
  )
}

function ScorePlate({ live, home, away }: { live: LiveMatch; home: TeamInfo; away: TeamInfo }) {
  return (
    <div className="lx-score im-scoreplate">
      <div className="lx-score__tm is-home" style={clubVars(home.colors) as CSSProperties}>
        <span className="truncate">{home.short}</span>
        <TeamMark team={home} size={34} />
      </div>
      <div className="lx-score__res num">
        {live.score[0]} × {live.score[1]}
      </div>
      <div className="lx-score__tm is-away" style={clubVars(away.colors) as CSSProperties}>
        <TeamMark team={away} size={34} />
        <span className="truncate">{away.short}</span>
      </div>
    </div>
  )
}

// ───────────────────────── fim de jogo ─────────────────────────

function FullTime({ live, home, away }: { live: LiveMatch; home: TeamInfo; away: TeamInfo }) {
  const s = useImmersive((x) => x.state)!
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const rm = useReducedMotion()
  const st = live.stats
  const played = st.minutes > 0
  const motm = manOfMatch(live, s.identity.surname)
  const us = live.userSide === 'home' ? live.score[0] : live.score[1]
  const them = live.userSide === 'home' ? live.score[1] : live.score[0]
  const won = live.pens ? (live.userSide === 'home' ? live.pens[0] > live.pens[1] : live.pens[1] > live.pens[0]) : us > them
  const lost = live.pens ? !won : us < them
  const goals = live.events.filter(isGoal)
  const gk = s.identity.position === 'GOL'
  const back = () => void dispatch({ type: 'match_finish' })
  useEffect(() => {
    sfx.play(won ? 'trophy' : 'whistle')
  }, [won])
  return (
    <div className="im-ft" role="dialog" aria-modal="true" aria-labelledby="im-ft-t">
      {won && !rm && <Confetti n={40} seed={us * 7 + them} />}
      <motion.div className="im-ft__inner" initial={rm ? { opacity: 0 } : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <span className="lx-kicker lx-kicker--gold" id="im-ft-t">
          Fim de jogo · {compInfo(live.competitionId).short}
          {live.stage ? ` · ${live.stage}` : ''}
        </span>
        <h1 className={cx('im-ft__res', won ? 'is-win' : lost ? 'is-loss' : 'is-draw')}>{won ? 'Vitória!' : lost ? 'Derrota' : 'Empate'}</h1>
        <ScorePlate live={live} home={home} away={away} />
        {live.pens && (
          <p className="im-ft__pens num">
            Pênaltis: {live.pens[0]} × {live.pens[1]}
          </p>
        )}
        {goals.length > 0 && (
          <div className="im-ft__goals">
            {goals.map((e, i) => (
              <span key={i} className={cx(e.byUser && 'is-me', e.side === 'away' && 'is-away')}>
                <BallIcon size={12} aria-hidden /> <b>{e.player ?? '—'}</b> {e.minute}&apos;
              </span>
            ))}
          </div>
        )}
        <div className="im-ft__grid">
          <section className="lx-plate lx-c-md im-ft__you">
            <span className="lx-label">Sua atuação</span>
            {played ? (
              <>
                <div className="im-ft__rating" data-tone={ratingTone(st.rating)}>
                  <b className="num">{fmtRating(st.rating)}</b>
                  <small>{st.minutes} min</small>
                </div>
                <div className="im-ft__kpis">
                  {gk ? (
                    <>
                      <Kpi label="Defesas" value={st.saves ?? 0} />
                      <Kpi label="Sofridos" value={st.conceded ?? 0} />
                    </>
                  ) : (
                    <>
                      <Kpi label="Gols" value={st.goals} gold={st.goals > 0} />
                      <Kpi label="Assist." value={st.assists} />
                      <Kpi label="Finaliz." value={`${st.shotsOnTarget}/${st.shots}`} />
                      <Kpi label="Dribles" value={st.dribbles} />
                    </>
                  )}
                  <Kpi label="Desarmes" value={st.tackles} />
                </div>
              </>
            ) : (
              <p className="lx-t-body m-0 mt-2">Você não entrou em campo desta vez.</p>
            )}
          </section>
          <section className={cx('lx-plate lx-c-md im-ft__motm', motm.you && 'lx-plate--gold')}>
            <span className="lx-label">
              <Crown size={12} aria-hidden="true" /> Craque do jogo
            </span>
            <div className="im-ft__motm-b">
              <TeamMark team={motm.team} size={44} />
              <div className="min-w-0">
                <b>{motm.name}</b>
                <small>
                  {motm.team.short} · {motm.note}
                </small>
              </div>
            </div>
          </section>
          <section className="lx-plate lx-plate--flat lx-c-md im-ft__stats">
            <span className="lx-label">Estatísticas</span>
            <StatsPanel live={live} events={live.events} home={home} away={away} />
          </section>
        </div>
        <div className="im-ft__cta">
          <Button variant="primary" size="xl" iconRight={ArrowRight} onClick={back} loading={busy} autoFocus>
            Voltar à Central
          </Button>
        </div>
      </motion.div>
    </div>
  )
}

