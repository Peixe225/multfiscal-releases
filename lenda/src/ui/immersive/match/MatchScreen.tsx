/**
 * Partida ao vivo — pré-jogo (seu status, adversário, mando) → transmissão: bug de placar com
 * relógio, campo 2D, lances, narração, estatísticas, tabela ao vivo, momentum, lance decisivo com
 * cronômetro (dentro do campo), minijogos, controles numa linha (postura · velocidade · pausa ·
 * próximo lance), ticker "outros jogos", intervalo e fim de jogo (nota, estatísticas, craque do
 * jogo) → "Voltar à Central".
 *
 * Tudo o que é "seu" (em campo, minutos, nota) segue o relógio EXIBIDO do replay, não o estado
 * final do motor — o banco só entra quando a substituição aparece na transmissão.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  Activity,
  ArrowLeftRight,
  ArrowRight,
  BatteryMedium,
  Crown,
  CircleHelp,
  FastForward,
  Flag as FlagIcon,
  HeartPulse,
  List,
  LogOut,
  Megaphone,
  MessageSquareText,
  MoreHorizontal,
  Pause,
  Play,
  Shirt,
  SkipForward,
  Square,
  Table2,
  Tv,
  Zap,
} from 'lucide-react'
import type { CalendarItem, KeyMoment, LiveMatch, MatchEvent, MatchPosture, UserMatchStats } from '@/engine/immersive/types'
import { useEffectStream, useImmersive } from '@/store/immersive'
import { getClub } from '@/store/data'
import { BallIcon, Button, Crest, Tabs, clubVars, cx, useIsTouch, useMediaQuery, useReducedMotion } from '@/ui/primitives'
import { CompLogo, ImOvr, ImSeg, Kpi, LowerThird, Meter, PanelHead, RatingBadge, SplitStat, TeamMark } from '../bits'
import { compInfo, deTeam, fmtRating, importanceLabel, isGoal, matchGoals, oppTeam, optionSide, presenceAt, ratingTone, scoreColors, scoreFrom, shootoutSet, stageSuffix, surnameOf, teamInfo, userTeam, visibleColor, type PitchPresence, type TeamInfo } from '../model/view'
import { isLeagueGame, liveStandings, roundGames } from '../model/round'
import { imSfx, keyBlocked, useFocusTrap } from '../hooks'
import { Confetti } from '../fx/TrophyCelebration'
import { KeyMomentPrompt, type MomentChoice } from './KeyMoment'
import { Pitch } from './Pitch'
import { ScoreBug } from './ScoreBug'
import { usePlayback, usePlaybackDriver, useShownEvents, type Speed } from './playback'
import { LiveTicker } from '../shell/ImTicker'
import { Jersey } from '@/ui/shared/identity/Jersey'
import { clubKit, nationKit } from '@/ui/shared/identity/kit'

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
  // o evento 'save' traz o time e o nome de quem FINALIZOU (a defesa é do goleiro do outro lado)
  save: 'Chute defendido',
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


/** Nome na camisa: o sobrenome, ou o nome inteiro se curto ("Vini Jr.", não "Jr."). */
function jerseyName(name: string): string {
  const t = name.trim().split(/\s+/)
  const last = t[t.length - 1] ?? name
  if (t.length > 1 && (name.length <= 10 || /^(jr\.?|júnior|junior|filho|neto|sobrinho|ii|iii)$/i.test(last))) return name.length <= 12 ? name : t[t.length - 2]
  return last
}

/** Jogo grande: final, decisão, mata-mata decisivo — ouro e confete só aqui. */
const isBigGame = (l: LiveMatch) => l.importance >= 0.8 || (l.knockout && /final/i.test(l.stage ?? ''))

/** Craque do jogo: você (nota ≥ 7,8 sem derrota) ou quem mais decidiu pelo vencedor. */
function manOfMatch(live: LiveMatch, surname: string): { name: string; team: TeamInfo; you: boolean; note: string; goals: number } {
  const us = userTeam(live)
  const them = oppTeam(live)
  const usG = live.userSide === 'home' ? live.score[0] : live.score[1]
  const thG = live.userSide === 'home' ? live.score[1] : live.score[0]
  const lost = live.pens ? (live.userSide === 'home' ? live.pens[0] < live.pens[1] : live.pens[1] < live.pens[0]) : usG < thG
  if (live.stats.minutes > 0 && live.stats.rating >= 7.8 && !lost) return { name: surname, team: teamInfo(us.id, us), you: true, note: `Nota ${fmtRating(live.stats.rating)}`, goals: live.stats.goals }
  const winnerSide: 'home' | 'away' = live.score[0] >= live.score[1] ? 'home' : 'away'
  // gols e assistências contados à parte (gol contra não credita ninguém; 'save' é de quem chutou)
  const tally = new Map<string, { g: number; a: number }>()
  const bump = (name: string, k: 'g' | 'a') => {
    const t = tally.get(name) ?? { g: 0, a: 0 }
    t[k]++
    tally.set(name, t)
  }
  for (const e of matchGoals(live.events)) {
    if (e.side !== winnerSide || e.byUser || (e.type !== 'goal' && e.type !== 'penalty_goal')) continue
    if (e.player) bump(e.player, 'g')
    if (e.assist) bump(e.assist, 'a')
  }
  const best = [...tally.entries()].sort((x, y) => y[1].g * 3 + y[1].a - (x[1].g * 3 + x[1].a))[0]
  const side = winnerSide === 'home' ? live.home : live.away
  if (best) {
    const { g, a } = best[1]
    return { name: best[0], team: teamInfo(side.id, side), you: false, note: [g ? `${g} gol${g === 1 ? '' : 's'}` : '', a ? `${a} assist.` : ''].filter(Boolean).join(' · ') || 'Destaque', goals: g }
  }
  // sem gol dos companheiros: você, se jogou bem (e não perdeu); senão quem mais finalizou no time que
  // mais atacou — nunca você sem ter entrado em campo
  if (live.stats.minutes > 0 && live.stats.rating >= 6.8 && !lost) return { name: surname, team: teamInfo(us.id, us), you: true, note: `Nota ${fmtRating(live.stats.rating)}`, goals: live.stats.goals }
  const shots = new Map<string, { n: number; side: 'home' | 'away' }>()
  for (const e of live.events) {
    if (e.byUser || !e.player || (e.type !== 'chance' && e.type !== 'save' && e.type !== 'woodwork')) continue
    const k = `${e.side}|${e.player}`
    shots.set(k, { n: (shots.get(k)?.n ?? 0) + 1, side: e.side })
  }
  const top = [...shots.entries()].sort((x, y) => y[1].n - x[1].n)[0]
  if (top) {
    const t = top[1].side === 'home' ? live.home : live.away
    return { name: top[0].split('|')[1], team: teamInfo(t.id, t), you: false, note: `${top[1].n} ${top[1].n === 1 ? 'finalização' : 'finalizações'}`, goals: 0 }
  }
  const team = teamInfo(side.id, side)
  return { name: `Goleiro ${deTeam(team)}`, team, you: false, note: 'Destaque', goals: 0 }
}

// ───────────────────────── postura ─────────────────────────

export type Posture = MatchPosture
const POSTURE_HINT: Record<Posture, string> = {
  ataque: 'Pedir a bola: até 2 lances decisivos a mais para você, mas cansa mais',
  equilibrada: 'Equilibrada: número normal de lances e de desgaste',
  poupar: 'Poupar energia: um lance a menos e cansa bem menos (e pede para sair quando o gás acabar)',
}
const POSTURE_LABEL: Record<Posture, string> = { ataque: 'Pedir a bola', equilibrada: 'Equilibrada', poupar: 'Poupar' }
const readPosture = (): Posture => {
  try {
    const v = localStorage.getItem('lenda:imm:postura')
    return v === 'ataque' || v === 'poupar' ? v : 'equilibrada'
  } catch {
    return 'equilibrada'
  }
}
const savePosture = (p: Posture) => {
  try {
    localStorage.setItem('lenda:imm:postura', p)
  } catch {
    /* ignore */
  }
}
const HOWTO_KEY = 'lenda:imm:comojogar:v1'
const howtoSeen = () => {
  try {
    return localStorage.getItem(HOWTO_KEY) === '1'
  } catch {
    return true
  }
}
/** Opção padrão do lance pela postura. */
function postureDefault(m: KeyMoment, p: Posture): string | undefined {
  const opts = m.options.slice()
  if (!opts.length) return undefined
  if (p === 'ataque') {
    const goalish = (id: string, label: string) => /shot|chute|finaliz|bater|pen_|gol|cabece|chip|long|cut|direto|left|right|center|dive|stay/i.test(`${id} ${label}`)
    return opts.sort((a, b) => b.chance * (goalish(b.id, b.label) ? 1.7 : 1) - a.chance * (goalish(a.id, a.label) ? 1.7 : 1))[0].id
  }
  return opts.sort((a, b) => b.chance - a.chance)[0].id
}

// ───────────────────────── pré-jogo ─────────────────────────

/** Formato do jogo para o chip do pré-jogo (o `knockout` do motor só marca o jogo que decide). */
function matchFormat(live: LiveMatch, it?: CalendarItem): string | null {
  const stage = live.stage ?? it?.stage ?? ''
  if (live.competitionId === 'friendly') return 'Amistoso'
  if (it?.legs === 2 || /·\s*(ida|volta)\b/i.test(stage)) return (it?.leg ?? (/volta/i.test(stage) ? 2 : 1)) === 2 ? 'Mata-mata · jogo de volta' : 'Mata-mata · jogo de ida'
  if (live.knockout) return 'Mata-mata · jogo único'
  if (/grupo/i.test(stage)) return 'Fase de grupos'
  if (/rodada/i.test(stage)) return 'Pontos corridos'
  return null
}

const PreMatch = memo(function PreMatch({ live }: { live: LiveMatch }) {
  const s = useImmersive((x) => x.state)!
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const phone = useMediaQuery('(max-width: 44.99rem)')
  const home = teamInfo(live.home.id, live.home)
  const away = teamInfo(live.away.id, live.away)
  const comp = compInfo(live.competitionId)
  const st = live.userStatus
  // a transmissão desta partida começa do apito inicial (inclusive assistindo da tribuna)
  useEffect(() => {
    usePlayback.getState().prime(live.itemId)
  }, [live.itemId])
  const statusText = st === 'starter' ? 'Titular' : st === 'bench' ? 'Banco de reservas' : 'Fora da partida'
  const format = matchFormat(live, s.calendar.find((x) => x.id === live.itemId))
  const statusSub =
    st === 'starter'
      ? `Camisa ${s.squadNumber} · ${s.identity.position} · o técnico confia em você.`
      : st === 'bench'
        ? 'Aquecendo no banco — a chance deve vir no segundo tempo.'
        : s.condition.injury
          ? `${s.condition.injury.name}: você acompanha da tribuna.`
          : (s.condition.suspendedMatches ?? 0) > 0
            ? 'Suspenso: você acompanha da tribuna.'
            : 'Não relacionado pelo técnico: você acompanha o jogo da tribuna. Treine e ganhe a confiança dele para entrar na lista.'
  const [posture, setPosture] = useState<Posture>(readPosture)
  // banco: a transmissão adianta até você entrar · tribuna: "Ver o resultado" adianta até o apito final
  const start = (accept?: boolean, mode: 'play' | 'watch' | 'result' = 'play') => {
    imSfx.play('whistle')
    savePosture(posture)
    usePlayback.getState().setFF(mode === 'result' || (mode === 'play' && st === 'bench' && accept !== false))
    void dispatch({ type: 'match_start', accept, posture: st === 'out' ? undefined : posture })
  }
  return (
    <main id="conteudo" tabIndex={-1} className="im-wrap im-pre outline-none">
      <div className="im-pre__card lx-plate lx-c-xl lx-anim-rise">
        <i className="lx-hl-top" aria-hidden="true" />
        <div className="lx-club-glow" aria-hidden="true" />
        <div className="im-pre__top">
          <span className="lx-kicker">
            <span className="lx-live-dot" /> Pré-jogo · {comp.name}
            {stageSuffix(live.competitionId, live.stage)}
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
            <Megaphone size={12} aria-hidden="true" /> {home.national ? 'Estádio nacional' : `Mando: ${home.short}`}
          </span>
          {format && <span className="lx-chip lx-chip--sm">{format}</span>}
          {live.aggregate && <span className="lx-chip lx-chip--sm">Ida: {live.aggregate[0]} × {live.aggregate[1]}</span>}
          {live.importance >= 0.8 && <span className="lx-chip lx-chip--sm lx-chip--gold">{importanceLabel({ importance: live.importance, stage: live.stage, competitionId: live.competitionId })}</span>}
        </div>
        <div className={cx('im-pre__status', `is-${st}`)}>
          <span className="im-pre__badge">
            <Shirt size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <span className="lx-label">Seu status</span>
            <b className="im-pre__st">{statusText}</b>
            <p className="lx-t-small m-0">{live.selectionReason ?? statusSub}</p>
          </div>
          <div className="im-pre__meters">
            <Meter label="Energia" value={s.condition.fitness} icon={BatteryMedium} />
            <Meter label="Ritmo" value={s.condition.sharpness} icon={Activity} />
          </div>
        </div>
        {st !== 'out' && (
          <div className="im-pre__posture">
            <div className="im-pre__posture-h">
              <span className="lx-label">Como você vai jogar</span>
              <ImSeg<Posture>
                size="sm"
                label="Postura em campo"
                value={posture}
                onChange={setPosture}
                options={(['ataque', 'equilibrada', 'poupar'] as Posture[]).map((p) => ({ value: p, label: POSTURE_LABEL[p], hint: POSTURE_HINT[p] }))}
              />
            </div>
            <p className="lx-t-small m-0">{POSTURE_HINT[posture]}. Dá para trocar durante o jogo.</p>
          </div>
        )}
        <div className="im-pre__cta">
          {st === 'bench' && (
            <Button variant="ghost" size="lg" onClick={() => start(false, 'result')} disabled={busy} title="O técnico não vai gostar">
              Recusar o banco
            </Button>
          )}
          {st === 'out' && (
            <Button variant="ghost" size="lg" icon={Tv} onClick={() => start(true, 'watch')} disabled={busy}>
              Assistir da tribuna
            </Button>
          )}
          <Button variant="primary" size="xl" icon={st === 'out' ? SkipForward : Play} loading={busy} onClick={() => start(true, st === 'out' ? 'result' : 'play')} autoFocus>
            {st === 'out' ? 'Ver o resultado' : st === 'bench' ? 'Ir para o banco' : 'Entrar em campo'}
          </Button>
        </div>
        {st === 'bench' && <p className="lx-t-small m-0 im-pre__note">No banco, a transmissão adianta sozinha até a hora de você entrar.</p>}
      </div>
    </main>
  )
})

// ───────────────────────── painéis ─────────────────────────

function evDetail(e: MatchEvent, t: TeamInfo, home: TeamInfo, away: TeamInfo, scoreAfter: [number, number]): string {
  if (isGoal(e)) {
    const sc = `${home.abbr} ${scoreAfter[0]}–${scoreAfter[1]} ${away.abbr}`
    return e.assist ? `Assist.: ${e.assist} · ${sc}` : sc
  }
  if (e.type === 'sub_on') return `${t.abbr} · entra ${e.player ?? '—'}${e.assist ? `, sai ${e.assist}` : ''}`
  if (e.type === 'sub_off') return `${t.abbr} · sai ${e.player ?? '—'}${e.assist ? `, entra ${e.assist}` : ''}`
  if (e.type === 'penalty_miss') return `${t.abbr} · ${e.player ?? 'cobrança'} desperdiça`
  if (e.type === 'save') return `${t.abbr} · parou no goleiro`
  if (e.type === 'woodwork') return `${t.abbr} · ${e.player ?? 'chute'} carimba a trave`
  return t.short
}

const EventsList = memo(function EventsList({ events, home, away }: { events: MatchEvent[]; home: TeamInfo; away: TeamInfo }) {
  const rows = useMemo(() => {
    const sc: [number, number] = [0, 0]
    const so = shootoutSet(events)
    const out: { e: MatchEvent; i: number; sc: [number, number]; so: boolean }[] = []
    events.forEach((e, i) => {
      if (so.has(e)) {
        out.push({ e, i, sc: [sc[0], sc[1]], so: true })
        return
      }
      if (e.type === 'goal' || e.type === 'penalty_goal') sc[e.side === 'home' ? 0 : 1]++
      else if (e.type === 'own_goal') sc[e.side === 'home' ? 1 : 0]++
      if (KEY_TYPES.has(e.type)) out.push({ e, i, sc: [sc[0], sc[1]], so: false })
    })
    return out.reverse()
  }, [events])
  return (
    <ol className="im-evs" aria-live="polite" aria-label="Lances">
      {rows.length === 0 && <li className="lx-t-small im-evs__empty">Nenhum lance importante ainda.</li>}
      {rows.map(({ e, i, sc, so }, k) => {
        const t = e.side === 'home' ? home : away
        // disputa de pênaltis: "Pênaltis · Fulano" com o placar da disputa (o texto do motor termina em "(3–2)")
        const pens = so ? /\((\d+)[–-](\d+)\)\s*$/.exec(e.text) : null
        return (
          <li key={`ev-${i}`} className={cx('im-ev', k === 0 && 'is-new', !so && isGoal(e) && 'is-goal', e.byUser && 'is-me')} style={{ ['--tc' as string]: t.colors.primary } as CSSProperties}>
            <span className="im-ev__min num">{so ? 'PÊN' : `${e.minute}'`}</span>
            <span className="im-ev__ic">
              <EvIcon e={e} />
            </span>
            <span className="im-ev__txt">
              <b>
                {so ? (e.type === 'penalty_goal' ? 'Pênaltis · converte' : 'Pênaltis · perde') : EV_LABEL[e.type]}
                {e.player && e.type !== 'sub_on' && e.type !== 'sub_off' ? ` · ${e.player}` : ''}
              </b>
              <small>{so ? `${t.abbr}${pens ? ` · disputa ${home.abbr} ${pens[1]}–${pens[2]} ${away.abbr}` : ''}` : evDetail(e, t, home, away, sc)}</small>
            </span>
          </li>
        )
      })}
    </ol>
  )
})

const Narration = memo(function Narration({ events }: { events: MatchEvent[] }) {
  const list = events.map((e, i) => ({ e, i })).reverse()
  return (
    <ol className="im-narr" aria-label="Narração">
      {list.map(({ e, i }, k) => (
        <li key={`n-${i}`} className={cx(k === 0 && 'is-new', (isGoal(e) || e.byUser) && 'is-strong', isGoal(e) && 'is-goal')}>
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

const YouCard = memo(function YouCard({ live, me, stats }: { live: LiveMatch; me: PitchPresence; stats: UserMatchStats }) {
  const s = useImmersive((x) => x.state)!
  const gk = s.identity.position === 'GOL'
  const def = s.identity.position === 'ZAG' || s.identity.position === 'VOL'
  return (
    <section className="lx-plate lx-plate--flat lx-c-md im-you" aria-label="Você na partida">
      <div className="im-you__top">
        <ImOvr ovr={s.ovr} w={54} />
        <div className="min-w-0 flex-1">
          <b className="im-you__name">{s.identity.surname}</b>
          <span className="im-you__meta">
            {s.identity.position} · #{s.squadNumber} · {me.label}
            {me.played ? ` · ${me.minutes} min` : ''}
          </span>
        </div>
        {me.played ? <RatingBadge rating={stats.rating} live /> : <span className="im-rating is-none" aria-label="Sem nota: não entrou em campo">—</span>}
      </div>
      <div className="im-you__kpis">
        {gk ? (
          <>
            <Kpi label="Defesas" value={stats.saves ?? 0} />
            <Kpi label="Sofridos" value={stats.conceded ?? 0} />
          </>
        ) : (
          <>
            <Kpi label="Gols" value={stats.goals} gold={stats.goals > 0} />
            <Kpi label="Assist." value={stats.assists} />
          </>
        )}
        <Kpi label={gk ? 'Passes' : 'Finaliz.'} value={gk ? stats.keyPasses : `${stats.shotsOnTarget}/${stats.shots}`} />
        <Kpi label={gk ? 'Saídas' : def ? 'Desarmes' : 'Dribles'} value={gk || def ? stats.tackles : stats.dribbles} />
      </div>
      <Meter label="Energia" value={s.condition.fitness} icon={BatteryMedium} />
    </section>
  )
})

/** Momentum: 1 barra por minuto de um sinal contínuo de pressão (posse + lances, suavizado); gols = losangos sem distorção. */
const Momentum = memo(function Momentum({ live, events, clock, home, away }: { live: LiveMatch; events: MatchEvent[]; clock: number; home: TeamInfo; away: TeamInfo }) {
  const hc = visibleColor(home.colors)
  const ac = visibleColor(away.colors, hc)
  const span = live.phase === 'extra_time' || live.phase === 'penalties' || clock > 92 ? 120 : 90
  const bars = useMemo(() => {
    const W: Partial<Record<MatchEvent['type'], number>> = { goal: 1.6, penalty_goal: 1.4, own_goal: 1.1, chance: 1, save: 0.9, woodwork: 1, penalty_miss: 0.9, key_moment: 0.7, yellow: -0.25, red: -0.5, var: 0.3 }
    const base = (live.team.possession[0] - 50) / 50
    let seed = 0
    for (const ch of live.itemId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
    const noise = (m: number) => {
      const x = Math.sin(seed * 0.001 + m * 12.9898) * 43758.5453
      return (x - Math.floor(x)) * 2 - 1
    }
    const raw: number[] = []
    const upto = Math.min(span, Math.floor(clock))
    for (let m = 0; m <= upto; m++) {
      let v = base * 0.35 + noise(m) * 0.32
      for (const e of events) {
        const w = W[e.type]
        if (!w) continue
        const d = (m - e.minute) / 2.2
        if (d < -2.5 || d > 3.5) continue
        const sideW = e.side === 'home' ? 1 : -1
        v += sideW * w * Math.exp(-d * d)
      }
      raw.push(v)
    }
    return raw.map((v, i) => (0.25 * (raw[i - 1] ?? v) + 0.5 * v + 0.25 * (raw[i + 1] ?? v)))
  }, [events, clock, live.team.possession, live.itemId, span])
  const goals = matchGoals(events)
  const step = 900 / span
  return (
    <div className="lx-plate lx-plate--flat lx-c-sm im-mom" aria-label="Momentum da partida">
      <span className="lx-label im-mom__l">Momentum</span>
      <div className="im-mom__box">
        <svg viewBox="0 0 900 48" preserveAspectRatio="none" className="im-mom__svg" aria-hidden="true">
          <line x1="0" x2="900" y1="24" y2="24" stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1={(45 / span) * 900} x2={(45 / span) * 900} y1="4" y2="44" stroke="rgb(160 175 230 / .18)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          {bars.map((v, i) => {
            const h = Math.min(22, Math.abs(v) * 13 + 1.5)
            return <rect key={i} x={i * step + step * 0.12} y={v >= 0 ? 24 - h : 24} width={Math.max(1, step * 0.76)} height={h} fill={v >= 0 ? hc : ac} opacity={0.88} />
          })}
        </svg>
        {goals.map((e, i) => {
          const side = e.type === 'own_goal' ? (e.side === 'home' ? 'away' : 'home') : e.side
          return <i key={i} className={cx('im-mom__goal', side === 'home' ? 'is-home' : 'is-away', side === live.userSide && 'is-us')} style={{ left: `${(Math.min(span, e.minute) / span) * 100}%` }} title={`Gol ${e.minute}'`} />
        })}
        <i className="im-mom__now" style={{ left: `${(Math.min(span, clock) / span) * 100}%` }} />
      </div>
    </div>
  )
})

/** Tabela ao vivo (liga): 5 linhas em volta do seu clube, com ▲/▼ em relação ao início da rodada. */
const LiveTable = memo(function LiveTable({ live, clock, score, done }: { live: LiveMatch; clock: number; score: [number, number]; done: boolean }) {
  const s = useImmersive((x) => x.state)!
  const engine = useImmersive((x) => x.engine)
  const data = useImmersive((x) => x.data)
  const base = useMemo(() => {
    if (!engine || !data) return []
    try {
      return engine.liveTable(data, s)
    } catch {
      return []
    }
    // a base é a tabela antes da rodada: não muda durante a partida
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, data, live.itemId])
  const games = useMemo(() => roundGames(s, live), [s, live])
  const rows = useMemo(() => liveStandings(base, s, live, games, clock, score, done), [base, s, live, games, clock, score, done])
  const me = rows.findIndex((r) => r.row.clubId === s.clubId)
  const league = isLeagueGame(s, live)
  if (me < 0) return <p className="lx-t-small m-0">Jogo fora da liga: a tabela não muda nesta partida.</p>
  // liga ainda sem rodadas (estadual/copa antes do campeonato): uma tabela de zeros não diz nada
  if (!league && !base.some((r) => r.played > 0)) return <p className="lx-t-small m-0">{compInfo(live.competitionId).short}: a tabela da liga entra no ar na 1ª rodada do campeonato.</p>
  const from = Math.max(0, Math.min(rows.length - 5, me - 2))
  return (
    <>
    {!league && <p className="lx-t-small m-0 mb-2">{compInfo(live.competitionId).short}: a tabela da liga não muda neste jogo.</p>}
    <ol className="im-ltable">
      {rows.slice(from, from + 5).map((r) => {
        const c = getClub(r.row.clubId)
        const mine = r.row.clubId === s.clubId
        return (
          <li key={r.row.clubId} className={cx(mine && 'is-me')}>
            <span className="num im-ltable__pos">{r.pos}</span>
            <span className={cx('im-ltable__d', r.delta > 0 ? 'is-up' : r.delta < 0 && 'is-down')} aria-label={r.delta ? `${r.delta > 0 ? 'sobe' : 'cai'} ${Math.abs(r.delta)}` : 'mantém'}>
              {r.delta > 0 ? '▲' : r.delta < 0 ? '▼' : '–'}
            </span>
            {c && <Crest club={c} size={18} decorative />}
            <b className="truncate">{c?.shortName ?? r.row.clubId}</b>
            <span className="num im-ltable__pts">{r.row.points}</span>
          </li>
        )
      })}
    </ol>
    </>
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
    const t = setTimeout(() => setList((l) => l.slice(1)), speed === 4 ? 1400 : speed === 2 ? 2000 : 3500)
    return () => clearTimeout(t)
  }, [list, speed])
  return { current: list[0] ?? null, push }
}

// ───────────────────────── menu "⋯" dos controles ─────────────────────────

function MoreMenu({ items, label = 'Mais opções', disabled }: { items: { label: string; icon: typeof Zap; onClick: () => void; disabled?: boolean; checked?: boolean; group?: string }[]; label?: string; disabled?: boolean }) {
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const open = !!pos
  // o menu sai num portal com posição fixa (a placa dos controles tem chanfro/clip-path e cortaria o menu)
  const toggle = () => {
    if (open) return setPos(null)
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ right: Math.max(8, window.innerWidth - r.right), bottom: Math.max(8, window.innerHeight - r.top + 8) })
  }
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setPos(null)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPos(null)
        btnRef.current?.focus({ preventScroll: true })
      }
    }
    const close = () => setPos(null)
    window.addEventListener('pointerdown', off)
    window.addEventListener('keydown', esc)
    window.addEventListener('resize', close)
    const t = setTimeout(() => (menuRef.current?.querySelector('button:not([disabled])') as HTMLButtonElement | null)?.focus({ preventScroll: true }), 30)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', off)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('resize', close)
    }
  }, [open])
  return (
    <div className="im-more" ref={ref}>
      <button ref={btnRef} type="button" className="lx-icon-btn im-more__btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle} onPointerUp={(e) => e.currentTarget.blur()} disabled={disabled}>
        <MoreHorizontal aria-hidden="true" />
      </button>
      {pos &&
        createPortal(
          <div ref={menuRef} className="im-more__menu" role="menu" aria-label={label} style={{ position: 'fixed', right: pos.right, bottom: pos.bottom }}>
            {items.map((it, i) => (
              <button
                key={i}
                type="button"
                role={it.checked != null ? 'menuitemradio' : 'menuitem'}
                aria-checked={it.checked}
                className={cx('im-more__it', it.checked && 'is-on', it.group && items[i - 1]?.group !== it.group && 'is-sep')}
                disabled={it.disabled}
                onClick={() => {
                  setPos(null)
                  it.onClick()
                }}
              >
                <it.icon size={16} aria-hidden="true" />
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
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
  const touch = useIsTouch()
  const phone = useMediaQuery('(max-width: 44.99rem)')
  const home = useMemo(() => teamInfo(live.home.id, live.home), [live.home])
  const away = useMemo(() => teamInfo(live.away.id, live.away), [live.away])
  const [auto, setAutoState] = useState(() => {
    try {
      return localStorage.getItem('lenda:imm:auto') !== '0'
    } catch {
      return true
    }
  })
  const setAuto = (v: boolean) => {
    setAutoState(v)
    try {
      localStorage.setItem('lenda:imm:auto', v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  const [posture, setPostureState] = useState<Posture>(() => live.posture ?? readPosture())
  const setPosture = (p: Posture) => {
    setPostureState(p)
    savePosture(p)
    // o motor replaneja os lances que faltam (mais lances pedindo a bola, menos poupando)
    if (live.phase !== 'full_time' && live.phase !== 'penalties' && !live.pendingMoment) void dispatch({ type: 'match_posture', posture: p })
  }
  const ff = usePlayback((x) => x.ff)
  const setFF = usePlayback((x) => x.setFF)
  const [howto, setHowto] = useState(false)
  const [active, setActive] = useState<KeyMoment | null>(null)
  const [mBusy, setMBusy] = useState(false)
  const [stinger, setStinger] = useState<{ id: number; mine: boolean; own: boolean } | null>(null)
  const [tab, setTab] = useState<'lances' | 'narracao' | 'stats' | 'tabela'>('lances')
  const speed = usePlayback((x) => x.speed)
  const setSpeed = usePlayback((x) => x.setSpeed)
  const settled = usePlayback((x) => x.settled)
  const userPaused = usePlayback((x) => x.userPaused)
  const last = usePlayback((x) => x.last)
  const seq = usePlayback((x) => x.revealSeq)
  const burst = usePlayback((x) => x.burst)
  const clockF = usePlayback((x) => Math.floor(x.clock * 4) / 4)
  const clock = Math.floor(clockF)
  const lt = useLowerThirds(speed)
  const paused = !!active || !!stinger

  usePlaybackDriver(live, !!active || howto)
  const events = useShownEvents(live)
  const allShown = events.length === live.events.length
  const target = live.phase === 'pre' ? 0 : live.minute
  const atTarget = usePlayback((x) => x.clock >= target - 0.001)
  // "tudo exibido": sem eventos pendentes e relógio no minuto do motor (evita abrir o lance antes da hora)
  const done = settled && allShown && atTarget
  const score = useMemo<[number, number]>(() => (done && live.phase !== 'penalties' ? live.score : scoreFrom(events)), [done, live.score, live.phase, events])
  const me = useMemo(() => presenceAt(live, events, clockF, done), [live, events, clockF, done])

  // estatísticas "congeladas" enquanto o lance decisivo/minijogo anima (nada de spoiler do resultado)
  const frozen = useRef<UserMatchStats | null>(null)
  if (active && !frozen.current) frozen.current = live.stats
  if (!active && frozen.current) frozen.current = null
  const stats = frozen.current ?? live.stats

  // lance decisivo aparece quando o replay alcança o minuto
  useEffect(() => {
    if (done && live.pendingMoment && !active) setActive(live.pendingMoment)
  }, [done, live.pendingMoment, active])
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
        imSfx.play(mine ? 'goal' : 'miss')
        lt.push({ k: `${EV_LABEL[e.type]} · ${e.minute}'`, v: `${e.player ?? t.short} · ${(scorer === 'home' ? home : away).short}`, tone: mine ? undefined : 'accent', mark: scorer === 'home' ? home : away })
      } else if (e.type === 'yellow' || e.type === 'red') lt.push({ k: `${EV_LABEL[e.type]} · ${e.minute}'`, v: `${e.player ?? ''} · ${t.short}`, tone: e.type === 'red' ? 'red' : 'yellow', icon: Square })
      else if (e.type === 'sub_on') lt.push({ k: `Substituição · ${e.minute}'`, v: `Entra ${e.player ?? ''}${e.assist ? ` · sai ${e.assist}` : ''}`, tone: 'club', icon: ArrowLeftRight, style: clubVars(t.colors) as CSSProperties })
      else if (e.type === 'injury') lt.push({ k: `Lesão · ${e.minute}'`, v: e.player ?? t.short, tone: 'red', icon: HeartPulse })
      else if (e.type === 'var') lt.push({ k: 'VAR', v: e.text.slice(0, 48), tone: 'accent', icon: Tv })
      else if (e.type === 'half_time') {
        lt.push({ k: 'Intervalo', v: `${home.abbr} ${scoreFrom(events)[0]} × ${scoreFrom(events)[1]} ${away.abbr}`, tone: 'live', icon: FlagIcon })
        imSfx.play('whistle')
      } else if (e.type === 'full_time') imSfx.play('whistle')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq])
  useEffect(() => {
    if (!stinger) return
    const t = setTimeout(() => setStinger(null), rm ? 900 : speed === 4 ? 900 : speed === 2 ? 1300 : 2300)
    return () => clearTimeout(t)
  }, [stinger, rm, speed])

  // resultado do lance → lower-third
  useEffectStream((e) => {
    if (e.type === 'moment_result' && !e.goal) lt.push({ k: e.success ? 'Deu certo' : 'Não deu', v: e.text.replace(/^[A-ZÇÃÉÍÓÚ!]+[!.]\s*/, '').slice(0, 60), tone: e.success ? 'accent' : 'red', icon: Zap })
  })

  const running = live.phase === 'first_half' || live.phase === 'second_half' || live.phase === 'extra_time' || (live.phase === 'penalties' && !live.pendingMoment)
  const canSim = done && !busy && !active && !live.pendingMoment && running
  const locked = !!active

  // auto: segue até o próximo lance (a não ser que a transmissão esteja pausada)
  useEffect(() => {
    if (howto) return
    if (ff ? false : !auto || userPaused || !!stinger) return
    if (!canSim) return
    const t = setTimeout(() => void dispatch({ type: 'match_sim' }), ff || speed === 0 ? 80 : speed === 4 ? 350 : 900)
    return () => clearTimeout(t)
  }, [auto, userPaused, canSim, stinger, speed, dispatch, live.minute, live.events.length, ff, howto])

  // adiantando: você entrou em campo → volta à velocidade escolhida (e avisa); intervalo → segue sozinho
  useEffect(() => {
    if (!ff) return
    if (me.on) {
      setFF(false)
      lt.push({ k: `Sua vez · ${clock}'`, v: 'Você entra em campo — boa sorte!', tone: 'accent', icon: ArrowLeftRight })
      return
    }
    if (live.phase === 'half_time' && done && !busy) void dispatch({ type: 'match_sim' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ff, me.on, live.phase, done, busy])
  // fim de jogo: desliga o adiantamento (o pré-jogo de cada partida liga/desliga de novo)
  useEffect(() => {
    if (live.phase === 'full_time' && done) setFF(false)
  }, [live.phase, done, setFF])

  // "Como jogar": na 1ª partida em que você está em campo, assim que você entra — também se um lance
  // decisivo já estiver na tela (entrando do banco no adiantamento): o guia é um diálogo modal e o
  // cronômetro do lance fica parado enquanto ele estiver aberto (useCountdown › appModalOpen)
  useEffect(() => {
    if (me.on && !howtoSeen() && live.phase !== 'full_time') setHowto(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.on])
  const closeHowto = () => {
    setHowto(false)
    try {
      localStorage.setItem(HOWTO_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  // "Pedir para sair": o motor só aceita sem lance pendente — e ele pode já ter um lance à frente do
  // replay (ainda não mostrado). Nesse caso o pedido fica guardado e sai logo depois do lance.
  const [offAsked, setOffAsked] = useState(false)
  const askOff = useCallback(async () => {
    const l = useImmersive.getState().state?.live
    if (!l?.userOnPitch) return
    lt.push({ k: 'Pedido ao técnico', v: 'Você pede para sair — a troca sai na próxima parada', tone: 'accent', icon: LogOut })
    if (l.pendingMoment) return setOffAsked(true)
    const fx = await dispatch({ type: 'match_sub_request' })
    if (fx.some((e) => e.type === 'toast' && e.tone === 'danger')) setOffAsked(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch])
  useEffect(() => {
    if (!offAsked || busy) return
    if (!live.userOnPitch || live.phase === 'full_time' || live.phase === 'penalties') return setOffAsked(false)
    if (live.pendingMoment || active) return
    setOffAsked(false)
    void dispatch({ type: 'match_sub_request' })
  }, [offAsked, busy, live.userOnPitch, live.phase, live.pendingMoment, active, dispatch])

  // postura "poupar energia": pede para sair uma vez quando o gás acaba
  const subAsked = useRef(false)
  useEffect(() => {
    if (posture !== 'poupar' || subAsked.current || !done || !live.userOnPitch || locked || busy) return
    if (s.condition.fitness < 45 && running) {
      subAsked.current = true
      void askOff()
    }
  }, [posture, done, live.userOnPitch, locked, busy, s.condition.fitness, running, askOff])

  const next = useCallback(() => {
    if (locked) return
    usePlayback.getState().togglePause(false)
    if (!done) {
      usePlayback.getState().skip()
      return
    }
    if (live.phase === 'half_time') return void dispatch({ type: 'match_sim' })
    if (canSim) void dispatch({ type: 'match_sim' })
  }, [done, live.phase, canSim, dispatch, locked])

  const playPause = useCallback(() => {
    const st = usePlayback.getState()
    const nowPaused = !st.userPaused && auto
    if (nowPaused) {
      st.togglePause(true)
      setAuto(false)
    } else {
      st.togglePause(false)
      setAuto(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  const simToEnd = useCallback(async () => {
    setSpeed(0)
    setAuto(true)
    usePlayback.getState().togglePause(false)
    for (let i = 0; i < 40; i++) {
      const l = useImmersive.getState().state?.live
      if (!l || l.phase === 'full_time') break
      const pm = l.pendingMoment
      if (pm) {
        const id = postureDefault(pm, posture) ?? pm.options[0].id
        const idx = Math.max(0, pm.options.findIndex((o) => o.id === id))
        await dispatch({ type: 'match_choose', optionId: id, minigame: pm.minigame === 'timing' ? { timing: 0.6 } : pm.minigame ? { side: optionSide(id, idx, pm.options.length) } : undefined })
      } else await dispatch({ type: 'match_sim' })
    }
    setActive(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, setSpeed, posture])

  // teclado: Espaço = próximo lance / pular replay (também com o foco num botão dos controles)
  const rootRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || active) return
      if (keyBlocked(e)) return
      const t = e.target as HTMLElement | null
      const inCtrl = !!t?.closest?.('.im-ctrl')
      if (t instanceof HTMLButtonElement && !inCtrl) return
      if (t?.getAttribute?.('role') === 'radio' && !inCtrl) return
      e.preventDefault()
      next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, active])

  const choose: MomentChoice = useCallback(async (optionId, minigame) => dispatch({ type: 'match_choose', optionId, minigame }), [dispatch])
  const timeout = useCallback(() => {
    setMBusy(true)
    const pm = useImmersive.getState().state?.live?.pendingMoment
    const id = pm && posture !== 'equilibrada' ? postureDefault(pm, posture) : undefined
    const idx = pm && id ? pm.options.findIndex((o) => o.id === id) : -1
    const p = id && pm ? dispatch({ type: 'match_choose', optionId: id, minigame: pm.minigame === 'timing' ? { timing: 0.5 } : pm.minigame ? { side: optionSide(id, idx, pm.options.length) } : undefined }) : dispatch({ type: 'match_timeout' })
    void p.finally(() => setMBusy(false))
  }, [dispatch, posture])

  const ft = live.phase === 'full_time' && done && !active
  const ht = live.phase === 'half_time' && done && !active
  const meLabel = me.played ? `${s.identity.surname} · ${fmtRating(stats.rating)}` : s.identity.surname
  const vars = clubVars(userTeam(live).id === home.id ? home.colors : away.colors) as CSSProperties
  const keeperTeam = active?.minigame === 'penalty_save' ? (live.userSide === 'home' ? home : away) : live.userSide === 'home' ? away : home

  const bug = <ScoreBug live={live} home={home} away={away} score={score} events={events} last={last} seq={seq} />
  const pitch = (
    <div className={cx('im-field', active && 'has-moment')}>
      <Pitch live={live} home={home} away={away} userPos={s.identity.position} userNumber={s.squadNumber} focus={last} focusSeq={seq} moment={active} dim={!!active} meLabel={meLabel} showMe={me.on} />
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
      {!phone && active && <KeyMomentPrompt key={active.id} live={live} moment={active} defaultId={postureDefault(active, posture)} keeperTeam={keeperTeam} onChoose={choose} onTimeout={timeout} onBusy={setMBusy} />}
      {me.label === 'Tribuna' && !active && !ft && !ff && <span className="im-field__tag">Você assiste da tribuna</span>}
      {!active && !ft && !ht && (
        <button type="button" className="im-field__help" onClick={() => setHowto(true)} onPointerUp={(e) => e.currentTarget.blur()}>
          <CircleHelp size={15} aria-hidden="true" /> Como jogar
        </button>
      )}
      {ff && !ft && (
        <div className="im-ff" role="status">
          <FastForward size={18} aria-hidden="true" />
          <span>
            <b>{live.userStatus === 'bench' ? 'Você está no banco' : 'Você não foi relacionado'}</b>
            <small>{live.userStatus === 'bench' ? 'Adiantando o jogo até a hora de você entrar' : 'Adiantando até o apito final'}</small>
          </span>
          <Button variant="outline" size="sm" onClick={() => setFF(false)}>
            Assistir normalmente
          </Button>
        </div>
      )}
      {ht && <HalfTime live={live} home={home} away={away} events={events} me={me} stats={stats} onNext={next} busy={busy} />}
    </div>
  )

  const togglePlay = (
    <button type="button" className={cx('lx-icon-btn im-play', !(auto && !userPaused) && 'is-paused')} aria-pressed={!(auto && !userPaused)} aria-label={auto && !userPaused ? 'Pausar a transmissão' : 'Continuar a transmissão'} title={auto && !userPaused ? 'Pausar' : 'Continuar'} onClick={playPause} onPointerUp={(e) => e.currentTarget.blur()} disabled={locked}>
      {auto && !userPaused ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
    </button>
  )
  // postura só vale para quem está em campo (ou no banco, esperando entrar): da tribuna ou depois de sair, some
  const canPosture = live.userStatus !== 'out' && !(me.played && !me.on) && live.phase !== 'full_time'
  const moreItems = [
    ...(phone && canPosture
      ? (['ataque', 'equilibrada', 'poupar'] as Posture[]).map((p) => ({ label: p === 'ataque' ? 'Postura: pedir a bola' : p === 'poupar' ? 'Postura: poupar energia' : 'Postura: equilibrada', icon: Activity, checked: posture === p, group: 'p', onClick: () => setPosture(p) }))
      : []),
    { label: 'Simular até o fim', icon: SkipForward, group: 'a', onClick: () => void simToEnd(), disabled: busy || live.phase === 'full_time' || locked },
    ...(me.on && live.userOnPitch && live.phase !== 'full_time' && live.phase !== 'penalties'
      ? [{ label: offAsked ? 'Saída pedida ao técnico' : 'Pedir para sair', icon: LogOut, group: 'a', onClick: () => void askOff(), disabled: busy || locked || offAsked }]
      : []),
  ]
  const controls = (
    <div className={cx('lx-plate lx-plate--flat lx-c-sm im-ctrl', phone && 'is-dock', locked && 'is-locked', ht && 'is-ht')} aria-disabled={locked || undefined}>
      {!phone && canPosture && (
        <div className="im-ctrl__grp" title={POSTURE_HINT[posture]}>
          <span className="lx-label">Postura</span>
          <ImSeg<Posture>
            size="xs"
            label="Postura em campo"
            value={posture}
            onChange={setPosture}
            disabled={locked}
            options={(['ataque', 'equilibrada', 'poupar'] as Posture[]).map((p) => ({ value: p, label: POSTURE_LABEL[p], hint: POSTURE_HINT[p] }))}
          />
        </div>
      )}
      {!phone ? (
        <div className="im-ctrl__grp">
          <span className="lx-label">Velocidade</span>
          <ImSeg<'1' | '2' | '4' | '0'>
            size="xs"
            label="Velocidade da transmissão"
            value={String(speed) as '1' | '2' | '4' | '0'}
            onChange={(v) => setSpeed(Number(v) as Speed)}
            disabled={locked}
            options={[
              { value: '1', label: '1×' },
              { value: '2', label: '2×' },
              { value: '4', label: '4×' },
              { value: '0', label: '', icon: FastForward, hint: 'Instantâneo' },
            ]}
          />
        </div>
      ) : (
        <button type="button" className="im-auto lx-focus-inset" onClick={() => setSpeed(speed === 1 ? 2 : speed === 2 ? 4 : speed === 4 ? 0 : 1)} aria-label={`Velocidade: ${speed === 0 ? 'instantânea' : `${speed}×`}`} disabled={locked}>
          <FastForward size={14} aria-hidden="true" /> {speed === 0 ? 'Inst.' : `${speed}×`}
        </button>
      )}
      {togglePlay}
      <span className="flex-1" />
      <MoreMenu items={moreItems} disabled={locked} />
      {!ht && (
        <Button variant="outline" size="sm" iconRight={ArrowRight} onClick={next} onPointerUp={(e) => e.currentTarget.blur()} disabled={locked || live.phase === 'full_time' || (done && !canSim && live.phase !== 'half_time')} kbd={touch ? undefined : 'Espaço'} className="im-ctrl__next">
          {!done ? 'Pular' : 'Próx. lance'}
        </Button>
      )}
    </div>
  )

  const tabs = [
    { value: 'lances' as const, label: 'Lances', icon: List },
    { value: 'narracao' as const, label: 'Narração', icon: MessageSquareText },
    { value: 'stats' as const, label: 'Números', icon: Activity },
    { value: 'tabela' as const, label: 'Tabela', icon: Table2 },
  ]

  return (
    <main ref={rootRef} id="conteudo" tabIndex={-1} className={cx('im-match outline-none', phone && 'is-phone', active && 'has-moment', (active?.minigame === 'penalty_kick' || active?.minigame === 'penalty_save') && 'has-pen')} style={vars}>
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
          {phone && active && <KeyMomentPrompt key={active.id} live={live} moment={active} defaultId={postureDefault(active, posture)} keeperTeam={keeperTeam} onChoose={choose} onTimeout={timeout} onBusy={setMBusy} />}
          <Momentum live={live} events={events} clock={clockF} home={home} away={away} />
          {!phone && controls}
          {phone && (
            <div className="im-match__tabs">
              <Tabs value={tab} onChange={setTab} idPrefix="im-mt" variant="underline" aria-label="Painéis da partida" tabs={tabs} />
              <div className="im-match__tabp">
                {tab === 'lances' ? (
                  <EventsList events={events} home={home} away={away} />
                ) : tab === 'narracao' ? (
                  <Narration events={events} />
                ) : tab === 'stats' ? (
                  <StatsPanel live={live} events={events} home={home} away={away} />
                ) : (
                  <LiveTable live={live} clock={clockF} score={score} done={done && live.phase === 'full_time'} />
                )}
              </div>
              <YouCard live={live} me={me} stats={stats} />
            </div>
          )}
        </div>
        <aside className="im-match__r max-lg:hidden">
          <YouCard live={live} me={me} stats={stats} />
          <section className="lx-plate lx-plate--flat lx-c-md im-panel is-fill">
            <PanelHead kicker="Narração" icon={MessageSquareText} />
            <Narration events={events} />
          </section>
          <section className="lx-plate lx-plate--flat lx-c-md im-panel im-ltable-panel">
            <PanelHead kicker={isLeagueGame(s, live) ? 'Tabela ao vivo' : 'Classificação da liga'} icon={Table2} />
            <LiveTable live={live} clock={clockF} score={score} done={done && live.phase === 'full_time'} />
          </section>
        </aside>
      </div>
      {phone && !active && controls}
      {!phone && <LiveTicker live={live} clock={clockF} done={done && live.phase === 'full_time'} />}
      {ft && <FullTime live={live} home={home} away={away} />}
      {howto && <HowToPlay onClose={closeHowto} />}
      {paused && <span className="sr-only">Transmissão pausada</span>}
    </main>
  )
}

// ───────────────────────── como jogar ─────────────────────────

const HOWTO: { icon: typeof Zap; t: string; d: string }[] = [
  { icon: Play, t: 'A partida corre sozinha', d: 'Você é o seu jogador em campo. O jogo anda no relógio e para quando a bola chega em você.' },
  { icon: Zap, t: 'Lance decisivo: você escolhe', d: 'Aparecem 2 ou 3 jogadas com a chance de dar certo e o risco. Clique ou use as teclas 1, 2 e 3 antes de o tempo acabar; sem resposta, vale a opção Padrão.' },
  { icon: BallIcon as unknown as typeof Zap, t: 'Pênalti e chute no tempo certo', d: 'No pênalti, escolha o canto. No chute no tempo certo, aperte Espaço (ou toque) quando o marcador passar pela faixa verde.' },
  { icon: Activity, t: 'Postura', d: 'Pedir a bola: mais lances seus e mais cansaço. Poupar: menos lances e menos cansaço. Troque quando quiser.' },
  { icon: SkipForward, t: 'Ritmo da transmissão', d: 'Velocidade 1×, 2×, 4× ou instantânea, pausa, e Próx. lance (Espaço) para pular direto ao próximo acontecimento.' },
]

function HowToPlay({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  return (
    <div ref={ref} tabIndex={-1} className="im-howto outline-none" role="dialog" aria-modal="true" aria-labelledby="im-howto-t">
      <div className="lx-plate lx-plate--glass lx-c-lg im-howto__card">
        <i className="lx-hl-top" aria-hidden="true" />
        <span className="lx-kicker">Modo Imersivo</span>
        <h2 id="im-howto-t" className="im-howto__t">
          Como jogar a partida
        </h2>
        <ol className="im-howto__list">
          {HOWTO.map((h) => (
            <li key={h.t}>
              <span className="im-howto__ic">
                <h.icon size={18} aria-hidden="true" />
              </span>
              <span>
                <b>{h.t}</b>
                <small>{h.d}</small>
              </span>
            </li>
          ))}
        </ol>
        <Button variant="primary" size="lg" icon={Play} onClick={onClose} block autoFocus>
          Bola rolando
        </Button>
      </div>
    </div>
  )
}

// ───────────────────────── intervalo ─────────────────────────

function HalfTime({ live, home, away, events, me, stats, onNext, busy }: { live: LiveMatch; home: TeamInfo; away: TeamInfo; events: MatchEvent[]; me: PitchPresence; stats: UserMatchStats; onNext: () => void; busy: boolean }) {
  const rm = useReducedMotion()
  const phone = useMediaQuery('(max-width: 44.99rem)')
  const touch = useIsTouch()
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  // Espaço (anunciado no botão) começa o 2º tempo mesmo com o foco no contêiner do intervalo
  const go = useRef(onNext)
  go.current = onNext
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== ' ' || keyBlocked(e, ref.current)) return
      if (e.target instanceof HTMLButtonElement && ref.current?.contains(e.target)) return
      e.preventDefault()
      go.current()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  return (
    <motion.div ref={ref} tabIndex={-1} className="im-ht outline-none" initial={rm ? { opacity: 0 } : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} role="dialog" aria-modal="true" aria-labelledby="im-ht-t">
      <div className="lx-plate lx-plate--glass lx-c-lg im-ht__card">
        <i className="lx-hl-top" aria-hidden="true" />
        <span className="lx-kicker lx-kicker--gold" id="im-ht-t">
          Intervalo
        </span>
        <ScorePlate live={live} home={home} away={away} score={scoreFrom(events)} max={phone ? 7 : 11} />
        <StatsPanel live={live} events={events} home={home} away={away} />
        <div className="im-ht__you">
          {me.played ? (
            <>
              <span className="lx-label">Sua nota no 1º tempo</span>
              <RatingBadge rating={stats.rating} />
            </>
          ) : (
            <span className="lx-label">{me.label === 'Tribuna' ? 'Você acompanha da tribuna' : 'Você segue no banco · aquecendo para o 2º tempo'}</span>
          )}
        </div>
        <Button variant="primary" size="lg" icon={Play} onClick={onNext} loading={busy} kbd={touch ? undefined : 'Espaço'} block>
          Começar o 2º tempo
        </Button>
      </div>
    </motion.div>
  )
}

function ScorePlate({ live, home, away, score, max = 11 }: { live: LiveMatch; home: TeamInfo; away: TeamInfo; score?: [number, number]; max?: number }) {
  const sc = score ?? live.score
  // se um dos nomes não cabe, os dois viram sigla (nada de "ATLÉTICO-MG 0 × 1 RBB")
  const both = home.short.length <= max && away.short.length <= max
  const nm = (t: TeamInfo) => (both ? t.short : t.abbr)
  return (
    <div className="lx-score im-scoreplate">
      <div className="lx-score__tm is-home" style={scoreColors(home.colors) as CSSProperties}>
        <span className="truncate" title={home.name}>
          {nm(home)}
        </span>
        <TeamMark team={home} size={34} />
      </div>
      <div className="lx-score__res num">
        {sc[0]} × {sc[1]}
      </div>
      <div className="lx-score__tm is-away" style={scoreColors(away.colors) as CSSProperties}>
        <TeamMark team={away} size={34} />
        <span className="truncate" title={away.name}>
          {nm(away)}
        </span>
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
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  const st = live.stats
  const played = st.minutes > 0
  const motm = manOfMatch(live, surnameOf(s))
  const us = live.userSide === 'home' ? live.score[0] : live.score[1]
  const them = live.userSide === 'home' ? live.score[1] : live.score[0]
  const won = live.pens ? (live.userSide === 'home' ? live.pens[0] > live.pens[1] : live.pens[1] > live.pens[0]) : us > them
  const lost = live.pens ? !won : us < them
  const glory = won && isBigGame(live)
  const goals = matchGoals(live.events)
  const gk = s.identity.position === 'GOL'
  const back = () => void dispatch({ type: 'match_finish' })
  useEffect(() => {
    imSfx.play(glory ? 'trophy' : 'whistle')
  }, [glory])
  return (
    <div ref={ref} tabIndex={-1} className="im-ft outline-none" role="dialog" aria-modal="true" aria-labelledby="im-ft-t">
      {glory && !rm && <Confetti n={40} seed={us * 7 + them} />}
      <motion.div className="im-ft__inner" initial={rm ? { opacity: 0 } : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <span className="lx-kicker lx-kicker--gold">
          Fim de jogo · {compInfo(live.competitionId).name}
          {stageSuffix(live.competitionId, live.stage)}
        </span>
        <h1 id="im-ft-t" className={cx('im-ft__res', glory ? 'is-glory' : won ? 'is-win' : lost ? 'is-loss' : 'is-draw')}>
          {won ? 'Vitória!' : lost ? 'Derrota' : 'Empate'}
        </h1>
        <ScorePlate live={live} home={home} away={away} />
        {live.pens && (
          <p className="im-ft__pens num">
            Pênaltis: {live.pens[0]} × {live.pens[1]}
          </p>
        )}
        {goals.length > 0 && (
          // autores dos gols embaixo do time que marcou (gol contra conta para o outro lado)
          <div className="im-ft__goals">
            {(['home', 'away'] as const).map((sd) => (
              <div key={sd} className={cx('im-ft__gcol', sd === 'away' && 'is-away')} aria-label={`Gols ${sd === 'home' ? home.short : away.short}`}>
                {goals
                  .filter((e) => (e.type === 'own_goal' ? (e.side === 'home' ? 'away' : 'home') : e.side) === sd)
                  .map((e, i) => (
                    <span key={i} className={cx(e.byUser && 'is-me')}>
                      <BallIcon size={12} aria-hidden /> <b>{e.player ?? '—'}</b> {e.minute}&apos;
                      {e.type === 'own_goal' ? ' (contra)' : e.type === 'penalty_goal' ? ' (pên.)' : ''}
                    </span>
                  ))}
              </div>
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
                      <Kpi label="Passes" value={st.keyPasses} />
                      <Kpi label="Saídas" value={st.tackles} />
                    </>
                  ) : (
                    <>
                      <Kpi label="Gols" value={st.goals} gold={st.goals > 0} />
                      <Kpi label="Assist." value={st.assists} />
                      <Kpi label="Finaliz." value={`${st.shotsOnTarget}/${st.shots}`} />
                      <Kpi label="Dribles" value={st.dribbles} />
                      <Kpi label="Desarmes" value={st.tackles} />
                    </>
                  )}
                </div>
              </>
            ) : (
              <p className="lx-t-body m-0 mt-2">{live.userStatus === 'out' ? 'Você acompanhou da tribuna. Treine forte e conquiste o técnico para ser relacionado.' : 'Você ficou no banco e não entrou em campo desta vez.'}</p>
            )}
          </section>
          <section className={cx('lx-plate lx-c-md im-ft__motm', motm.you && 'lx-plate--gold')}>
            <span className="lx-label">
              <Crown size={12} aria-hidden="true" /> Craque do jogo
            </span>
            <div className="im-ft__motm-b">
              <span className="im-ft__motm-art" style={clubVars(motm.team.colors) as CSSProperties}>
                <Jersey name={jerseyName(motm.name)} number={motm.you ? s.squadNumber : ''} kit={motm.team.national ? nationKit(motm.team.country ?? null) : clubKit(motm.team.club ?? null)} className="im-ft__motm-jersey" />
                <TeamMark team={motm.team} size={26} className="im-ft__motm-crest" />
              </span>
              <div className="min-w-0">
                <b>{motm.name}</b>
                <small>{motm.team.short}</small>
                <span className="im-ft__motm-note">
                  {motm.you ? <RatingBadge rating={st.rating} size="sm" /> : motm.goals ? <span className="lx-chip lx-chip--sm lx-chip--gold">{motm.note}</span> : <span className="lx-chip lx-chip--sm">{motm.note}</span>}
                </span>
              </div>
            </div>
          </section>
          <section className="lx-plate lx-plate--flat lx-c-md im-ft__stats">
            <span className="lx-label">Estatísticas</span>
            <StatsPanel live={live} events={live.events} home={home} away={away} />
          </section>
        </div>
        <div className="im-ft__cta">
          <Button variant="primary" size="xl" iconRight={ArrowRight} onClick={back} loading={busy}>
            Voltar à Central
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
