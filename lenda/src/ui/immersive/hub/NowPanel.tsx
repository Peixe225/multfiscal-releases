/**
 * "Agora" — a ação do item atual do calendário: treino (foco + intensidade + prévia), partida
 * (herói do próximo jogo), coletiva, evento de história (cards), janela, convocação, fim de temporada.
 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import {
  ArrowRight,
  BatteryMedium,
  Bed,
  Brain,
  Dumbbell,
  HandMetal,
  Heart,
  Mic,
  Plane,
  Play,
  Repeat2,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  Star,
  Target,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react'
import type { CalendarItem, ImmersiveState, TrainingFocus } from '@/engine/immersive/types'
import type { DecisionOption } from '@/engine/types'
import { navigate } from '@/store/app'
import { getClub, getCountry, getLeague } from '@/store/data'
import { artigo, deCountry } from '@/engine/immersive/util'
import { themeFor, themeFromText } from '@/ui/art/photos'
import { useImmersive } from '@/store/immersive'
import { EventArt } from '@/ui/art/EventArt'
import { Button, Crest, EffectChip, Kbd, Modal, cx, formatPercent, useIsDesktop, useReducedMotion, useSkipAnimations } from '@/ui/primitives'
import { CompLogo, FormChips, ImDlgTitle, ImSeg, PanelHead, TeamMark } from '../bits'
import { ATTR_LABEL, FOCUS_ORDER, INTENSITY, TRAINING_FOCUS, type Intensity } from '../model/constants'
import { WEEK_RECOVERY, energyAtNext, trainingPreview } from '../model/training'
import { artTeam, bestOffer, compInfo, deTeam, fmtMoney, importanceLabel, itemTitle, ptsLabel, recentForm, selectionForecast, stageSuffix, teamInfo, userLeagueId, weeksUntil, winProbs, yearsLabel, type TeamInfo } from '../model/view'
import { clubForm } from '../model/round'
import { useImHotkey } from '../hooks'

/** Último foco/intensidade escolhidos (a Central não "esquece" a sua rotina a cada semana). */
const TRAIN_KEY = 'lenda:imm:treino'
function lastTraining(s: ImmersiveState): { focus?: TrainingFocus; intensity?: Intensity } {
  try {
    const raw = localStorage.getItem(TRAIN_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  const m = s.engine as { userFocus?: TrainingFocus; userIntensity?: Intensity; lastFocus?: TrainingFocus; lastIntensity?: Intensity }
  return { focus: m.userFocus ?? m.lastFocus, intensity: m.userIntensity ?? m.lastIntensity }
}

const FOCUS_ICON = { target: Target, send: Send, zap: Zap, dumbbell: Dumbbell, shield: Shield, hand: HandMetal, brain: Brain, bed: Bed, heart: Heart } as const

// ───────────────────────── treino ─────────────────────────

export const TrainingPicker = memo(function TrainingPicker({ s, it }: { s: ImmersiveState; it: CalendarItem }) {
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const gk = s.identity.position === 'GOL'
  const list = FOCUS_ORDER.filter((f) => {
    const only = TRAINING_FOCUS[f].only
    return !only || (only === 'gk' ? gk : !gk)
  })
  const remembered = lastTraining(s)
  const [focus, setFocus] = useState<TrainingFocus>(() => (remembered.focus && list.includes(remembered.focus) ? remembered.focus : s.condition.fitness < 45 ? 'recovery' : gk ? 'goalkeeping' : 'finishing'))
  const [intensity, setIntensity] = useState<Intensity>(() => remembered.intensity ?? (s.condition.fitness < 55 ? 'leve' : 'normal'))
  const load = focus !== 'rest' && focus !== 'recovery'
  const engine = useImmersive((x) => x.engine)
  const data = useImmersive((x) => x.data)
  const sendIntensity: Intensity = load ? intensity : intensity === 'intensa' ? 'normal' : intensity
  // motor real: prévia exata (o ganho é determinístico: progresso até o próximo ponto); mock: estimativa
  const exact = useMemo(() => {
    if (!engine?.trainingPreview || !data) return null
    try {
      return engine.trainingPreview(data, s, focus, sendIntensity)
    } catch {
      return null
    }
  }, [engine, data, s, focus, sendIntensity])
  const pv = useMemo(() => trainingPreview(s, focus, intensity), [s, focus, intensity])
  const go = () => {
    try {
      localStorage.setItem(TRAIN_KEY, JSON.stringify({ focus, intensity }))
    } catch {
      /* ignore */
    }
    void dispatch({ type: 'train', focus, intensity: sendIntensity })
  }
  return (
    <section className="lx-plate lx-c-lg im-now im-train" aria-labelledby="im-train-h">
      <i className="lx-hl-top" aria-hidden="true" />
      <PanelHead kicker={<span id="im-train-h">{it.title} · semana {it.week}</span>} title="Escolha o foco do treino" icon={Dumbbell} />
      <div className="im-train__grid" role="radiogroup" aria-label="Foco do treino">
        {list.map((f, i) => {
          const m = TRAINING_FOCUS[f]
          const Ico = FOCUS_ICON[m.icon]
          const attrs = (gk ? m.gkAttrs : m.attrs).map((k) => ATTR_LABEL[k].short)
          return (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={focus === f}
              className={cx('lx-option im-focus lx-anim-rise', focus === f && 'is-on')}
              style={{ ['--i' as string]: i }}
              onClick={() => setFocus(f)}
            >
              <span className="im-focus__ic">
                <Ico size={18} aria-hidden="true" />
              </span>
              <span className="im-focus__t">{m.label}</span>
              <span className="im-focus__a">{attrs.length ? attrs.join(' · ') : m.extra}</span>
            </button>
          )
        })}
      </div>
      <div className="im-train__foot">
        <div className="im-train__int">
          <span className="lx-label">Intensidade</span>
          <ImSeg<Intensity>
            value={load ? intensity : intensity === 'intensa' ? 'normal' : intensity}
            onChange={setIntensity}
            size="touch"
            label="Intensidade do treino"
            options={(Object.keys(INTENSITY) as Intensity[]).map((k) => ({ value: k, label: INTENSITY[k].label, disabled: !load && k === 'intensa' }))}
          />
          <p className="lx-t-small m-0 mt-2">{TRAINING_FOCUS[focus].desc}</p>
        </div>
        <div className="im-train__pv" aria-live="polite">
          <span className="lx-label">{exact ? 'Prévia · % até o próximo ponto' : 'Prévia'}</span>
          <div className="im-train__chips">
            {exact
              ? exact.gains.slice(0, Math.max(2, Math.min(3, (gk ? TRAINING_FOCUS[focus].gkAttrs : TRAINING_FOCUS[focus].attrs).length), focus === 'tactical' ? 3 : 0)).map((g) => {
                  const up = g.to > g.value
                  return (
                    <span
                      key={g.key}
                      className={cx('lx-fx lx-fx--sm', up ? 'lx-fx--gold' : 'lx-fx--up')}
                      title={up ? `${ATTR_LABEL[g.key].label} sobe para ${g.to} nesta semana` : `${ATTR_LABEL[g.key].label}: progresso até ${Math.min(99, g.value + 1)} vai de ${Math.round(g.progressBefore * 100)}% para ${Math.round(g.progress * 100)}%`}
                    >
                      <span className="lx-fx__ic">
                        <Zap size={14} aria-hidden="true" />
                      </span>
                      {ATTR_LABEL[g.key].short} {g.value}→{up ? g.to : Math.min(99, g.value + 1)}
                      <span className="lx-fx__p">{up ? 'sobe!' : `${Math.round(g.progress * 100)}%`}</span>
                    </span>
                  )
                })
              : pv.gains.map((g) => (
                  <span key={g.key} className="lx-fx lx-fx--up lx-fx--sm">
                    <span className="lx-fx__ic">
                      <Zap size={14} aria-hidden="true" />
                    </span>
                    {ATTR_LABEL[g.key].short} {g.value}→{Math.min(99, g.value + 1)}
                    <span className="lx-fx__p">{formatPercent(g.chance)}</span>
                  </span>
                ))}
            {(() => {
              const f = exact ?? pv
              // a prévia mostra a energia no próximo compromisso (a virada da semana devolve +22), e o
              // gasto do treino à parte — nada de "Energia 77" que vira 99 no jogo
              const at = energyAtNext(s, f.fitnessAfter)
              const delta = f.fitnessDelta >= 0 ? `+${f.fitnessDelta}` : `−${Math.abs(f.fitnessDelta)}`
              return (
                <span
                  className={cx('lx-fx lx-fx--sm', f.fitnessDelta >= 0 ? 'lx-fx--up' : 'lx-fx--down')}
                  title={at.weeks ? `Logo após o treino: ${f.fitnessAfter}. No próximo compromisso: ${at.value} (a semana devolve +${WEEK_RECOVERY})` : 'Energia logo após o treino'}
                >
                  <span className="lx-fx__ic">
                    <BatteryMedium size={14} aria-hidden="true" />
                  </span>
                  Energia {at.value}
                  <span className="lx-fx__p">treino {delta}</span>
                </span>
              )
            })()}
            {(exact ?? pv).injuryRisk > 0 && (
              <span className="lx-fx lx-fx--sm lx-fx--down">
                <span className="lx-fx__ic">
                  <ShieldAlert size={14} aria-hidden="true" />
                </span>
                Lesão
                <span className="lx-fx__p">{(exact ?? pv).injuryRisk < 0.01 ? '<1%' : formatPercent((exact ?? pv).injuryRisk)}</span>
              </span>
            )}
            {pv.extra && (
              <span className="lx-fx lx-fx--sm lx-fx--info">
                <span className="lx-fx__ic">
                  <Sparkles size={14} aria-hidden="true" />
                </span>
                {pv.extra}
              </span>
            )}
          </div>
        </div>
        <Button variant="primary" size="lg" icon={Dumbbell} loading={busy} onClick={go} className="im-train__go">
          Treinar
        </Button>
      </div>
    </section>
  )
})

// ───────────────────────── partida ─────────────────────────

function ImportancePips({ it }: { it: CalendarItem }) {
  const v = it.importance ?? 0.4
  const n = Math.max(1, Math.round(v * 5))
  const label = importanceLabel(it)
  return (
    <span className="im-imp" title={`Importância ${Math.round(v * 100)}%`}>
      <span className="im-imp__pips" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className={i < n ? 'is-on' : undefined} />
        ))}
      </span>
      {label}
    </span>
  )
}

export const MatchHero = memo(function MatchHero({ s, it, table, primary }: { s: ImmersiveState; it: CalendarItem; table: { clubId: string; points: number; played?: number; won?: number; drawn?: number; lost?: number }[]; primary: boolean }) {
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const kind = useImmersive((x) => x.engineKind)
  const desk = useIsDesktop()
  const playRef = useRef<HTMLButtonElement>(null)
  const national = it.kind === 'national_match'
  const usId = national ? s.identity.nationality : s.clubId
  const us = teamInfo(usId)
  const them = teamInfo(it.opponentId)
  const home = it.home !== false
  const [H, A] = home ? [us, them] : [them, us]
  const comp = compInfo(it.competitionId)
  // posição só num jogo da liga e com rodada disputada (nada de "2º vs 11º · 0 pts" na estreia nem
  // de posição do Brasileirão numa final do Baiano); fora disso, a liga de cada clube (o nível do rival)
  const ranked = !national && it.competitionId === userLeagueId(s) && table.some((r) => (r.played ?? 0) > 0)
  const pos = (t: TeamInfo) => {
    if (t.national) return 'Seleção'
    const i = ranked ? table.findIndex((r) => r.clubId === t.id) : -1
    if (i >= 0) return `${i + 1}º · ${ptsLabel(table[i].points)}`
    return getLeague(s.world?.clubs?.[t.id]?.leagueId ?? t.club?.leagueId)?.shortName ?? comp.short
  }
  const usStr = (national ? us.country?.strength : us.club?.strength) ?? 70
  const themStr = (them.national ? them.country?.strength : them.club?.strength) ?? 70
  const [w, d, l] = winProbs(usStr, themStr, home)
  const weeks = weeksUntil(s, it)
  const fc = national ? { label: 'Convocado', tone: 'pos' as const } : selectionForecast(s, kind, it.importance ?? 0.4)
  const play = () => void dispatch({ type: 'advance' })
  // jogo de volta: o placar da ida, na ordem mandante–visitante DESTE jogo
  const firstLeg = useMemo(() => {
    if (it.leg !== 2) return null
    const ida = s.calendar.find((x) => x.kind === it.kind && x.competitionId === it.competitionId && x.opponentId === it.opponentId && x.leg === 1 && x.result)
    if (!ida?.result) return null
    const [u, o] = ida.home === false ? [ida.result.score[1], ida.result.score[0]] : ida.result.score
    return home ? [u, o] : [o, u]
  }, [s.calendar, it, home])
  // dia de jogo: o foco vai para "Jogar partida" (Enter/Espaço jogam) — sem atalho global de Enter
  useEffect(() => {
    if (primary) playRef.current?.focus({ preventScroll: true })
  }, [primary, it.id])
  const side = (t: typeof us, isHome: boolean) => {
    const form = t.id === usId ? recentForm(s) : t.national ? [] : clubForm(s, t.id)
    const row = t.national ? undefined : table.find((r) => r.clubId === t.id)
    return (
      <div className={cx('im-vs__team', isHome ? 'is-home' : 'is-away')} style={{ ['--tc' as string]: t.colors.primary } as CSSProperties}>
        <TeamMark team={t} size={desk && primary ? 76 : desk ? 56 : 52} className="im-vs__crest" />
        <b className="im-vs__name">{t.short}</b>
        <span className="im-vs__pos">
          {t.id === usId ? <span className="lx-you">Você</span> : null} {pos(t)}
        </span>
        {form.length ? (
          <FormChips form={form} />
        ) : ranked && row && row.won != null && row.played ? (
          // antes de jogos acompanhados no imersivo: a campanha na liga (a tabela real já tem jogos)
          <span className="im-vs__camp lx-t-small num" title="Campanha na liga">
            {row.won}V · {row.drawn}E · {row.lost}D
          </span>
        ) : null}
      </div>
    )
  }
  return (
    <section className={cx('lx-plate lx-c-lg im-hero', primary && 'im-now')} aria-labelledby={`im-hero-h-${primary ? 'p' : 'n'}`}>
      {primary && <i className="lx-hl-top" aria-hidden="true" />}
      <div className="lx-club-glow" aria-hidden="true" />
      <div className="im-hero__top">
        <span className="lx-kicker" id={`im-hero-h-${primary ? 'p' : 'n'}`}>
          {primary ? <span className="lx-live-dot" /> : null}
          {primary ? 'Dia de jogo' : 'Próximo jogo'} · {comp.short}
          {stageSuffix(it.competitionId, it.stage)}
        </span>
        <CompLogo id={it.competitionId} size={30} />
      </div>
      <div className="im-vs">
        {side(H, true)}
        <span className="im-vs__x" aria-hidden="true">
          ×
        </span>
        {side(A, false)}
      </div>
      <div className="im-hero__chips">
        <span className="lx-chip lx-chip--sm">{home ? 'Em casa' : 'Fora de casa'}</span>
        {firstLeg && <span className="lx-chip lx-chip--sm" title="Placar do jogo de ida">Ida: {firstLeg[0]}–{firstLeg[1]}</span>}
        <ImportancePips it={it} />
        <span className={cx('lx-chip lx-chip--sm', fc.tone === 'pos' ? 'lx-chip--pos-ok' : fc.tone === 'neg' ? 'lx-chip--neg' : 'lx-chip--gold')} title="Previsão da escalação (confiança do técnico, fase, energia e força do elenco)">
          {fc.label}
        </span>
      </div>
      {primary && (
        <div className="im-prob" aria-label={`Chances: vitória ${formatPercent(w)}, empate ${formatPercent(d)}, derrota ${formatPercent(l)}`}>
          <div className="im-prob__bar" aria-hidden="true">
            <i className="is-w" style={{ width: `${w * 100}%` }} />
            <i className="is-d" style={{ width: `${d * 100}%` }} />
            <i className="is-l" style={{ width: `${l * 100}%` }} />
          </div>
          <div className="im-prob__leg">
            <span className="is-w">Vitória {formatPercent(w)}</span>
            <span className="is-d">Empate {formatPercent(d)}</span>
            <span className="is-l">Derrota {formatPercent(l)}</span>
          </div>
        </div>
      )}
      <div className="im-hero__cta">
        <div className="im-hero__kpi">
          <b className="num">{primary || weeks === 0 ? 'Hoje' : weeks}</b>
          <span className="lx-label">{primary || weeks === 0 ? (home ? 'No seu estádio' : `Fora · ${them.short}`) : weeks === 1 ? 'Falta 1 semana' : `Faltam ${weeks} semanas`}</span>
        </div>
        {primary ? (
          <Button ref={playRef} variant="primary" size="xl" icon={Play} loading={busy} onClick={play} className="im-hero__play">
            Jogar partida
          </Button>
        ) : (
          <span className="im-hero__when">{it.title}</span>
        )}
      </div>
    </section>
  )
})

// ───────────────────────── coletiva ─────────────────────────

export const PressCard = memo(function PressCard({ it }: { it: CalendarItem }) {
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const opp = it.opponentId ? teamInfo(it.opponentId) : null
  return (
    <section className="lx-plate lx-c-lg im-now im-cardnow" aria-labelledby="im-press-h">
      <i className="lx-hl-top" aria-hidden="true" />
      <div className="im-cardnow__art">
        <EventArt art="press" hint="coletiva de imprensa" fill />
      </div>
      <div className="im-cardnow__body">
        <PanelHead kicker={<span id="im-press-h">Sala de imprensa</span>} icon={Mic} title={itemTitle(it)} />
        <p className="lx-t-body m-0">
          Microfones ligados, flashes prontos. {opp ? `Os jornalistas querem saber do duelo contra ${artTeam(opp)}.` : 'Os jornalistas querem ouvir você.'} Cada resposta mexe com torcida, técnico e imprensa.
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          <Button variant="primary" size="lg" icon={Mic} loading={busy} onClick={() => void dispatch({ type: 'advance' })}>
            Ir para a coletiva
          </Button>
          <Button variant="ghost" size="lg" onClick={() => void dispatch({ type: 'press_skip' })}>
            Faltar (Imprensa −)
          </Button>
        </div>
      </div>
    </section>
  )
})

// ───────────────────────── história ─────────────────────────

/**
 * Minutos previstos num clube (mesma régua da escalação: OVR × força do elenco; garoto da base ganha
 * minutos do banco). Consequência antes da escolha: clube grande = mais banco no começo.
 */
function minutesOutlook(s: ImmersiveState, clubId: string): { label: string; cls: string; pct: number } {
  const str = clubStrength(s, clubId)
  const gap = s.ovr - str
  const youth = s.age <= 19 ? 0.14 : 0
  // plano de minutos da base no motor (≤ 17: meta de ~42% dos jogos saindo do banco; 18–19: 30%):
  // mesmo no clube grande o garoto entra em ~1/3 dos jogos — não "8%"
  const floor = s.age <= 17 ? 0.3 : s.age <= 19 ? 0.22 : 0.08
  const pct = Math.max(floor, Math.min(0.92, 0.55 + gap * 0.03 + youth))
  return { label: 'Tempo de jogo', cls: pct >= 0.55 ? 'lx-fx--up' : pct >= 0.3 ? 'lx-fx--info' : 'lx-fx--down', pct }
}

const clubStrength = (s: ImmersiveState, clubId: string) => (s.world?.clubs?.[clubId]?.strength as number | undefined) ?? getClub(clubId)?.strength ?? s.ovr

function MinutesChip({ m }: { m: { label: string; cls: string; pct: number } }) {
  return (
    <span className={cx('lx-fx', m.cls)} title="Tempo de jogo previsto nesta temporada (OVR × força do elenco)">
      <span className="lx-fx__ic">
        <Timer size={14} aria-hidden="true" />
      </span>
      {m.label}
      <span className="lx-fx__p">~{formatPercent(m.pct)} dos jogos</span>
    </span>
  )
}

/**
 * O que é igual em todas as opções (oferta da base: mesmo papel, contrato, salário e minutos nos três
 * clubes) sai dos cards e aparece uma vez só, acima deles — cada card mostra o que o diferencia.
 */
function sharedTerms(s: ImmersiveState, opts: DecisionOption[]) {
  const labels = new Set<string>()
  if (opts.length < 2) return { labels, minutes: null }
  for (const d of opts[0].details ?? []) if (opts.every((o) => o.details?.some((x) => x.label === d.label && x.value === d.value))) labels.add(d.label)
  const mins = opts.every((o) => o.clubId) ? opts.map((o) => minutesOutlook(s, o.clubId!)) : []
  const minutes = mins.length && mins.every((m) => Math.round(m.pct * 100) === Math.round(mins[0].pct * 100)) ? mins[0] : null
  return { labels, minutes }
}

interface StoryCtx {
  id: string
  title: string
  description: string
  shared: ReturnType<typeof sharedTerms>
}

function StoryOption({ o, i, chosen, onPick, s, ctx }: { o: DecisionOption; i: number; chosen: string | null; onPick: (id: string) => void; s: ImmersiveState; ctx: StoryCtx }) {
  const rm = useReducedMotion()
  const club = o.clubId ? getClub(o.clubId) : undefined
  const mins = club && !ctx.shared.minutes ? minutesOutlook(s, club.id) : null
  const state = chosen ? (chosen === o.id ? 'chosen' : 'dim') : 'idle'
  // a pílula "Papel: Reserva" repete o "Papel previsto" dos detalhes: fica só um
  const role = o.details?.find((d) => d.label === 'Papel previsto')?.value
  const effects = o.effects.filter((e) => !(role && e.label === `Papel: ${role}`))
  // clube: a liga e a força do elenco no lugar do que é igual em todos os cards
  const details = [...(o.details ?? []).filter((d) => !ctx.shared.labels.has(d.label)), ...(club ? [{ label: 'Força do elenco', value: String(Math.round(clubStrength(s, club.id))) }] : [])].slice(0, 4)
  // arte: chave do evento; sem mapeamento, o texto da opção e o da decisão escolhem o tema (sem tema, sem quadro)
  const hint = [o.title ?? o.label, ctx.title, ctx.description].join('\n')
  const art = o.art ?? 'default'
  const hasArt = !!(themeFor(art) ?? themeFromText(hint))
  const kbd = <Kbd className="im-story__kbd">{i + 1}</Kbd>
  return (
    <motion.button
      type="button"
      className={cx('lx-option im-story__opt', state === 'chosen' && 'is-chosen', club && 'has-crest', !club && !hasArt && 'no-media')}
      aria-pressed={state === 'chosen'}
      aria-keyshortcuts={String(i + 1)}
      disabled={!!chosen}
      onClick={() => onPick(o.id)}
      initial={rm ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: state === 'dim' ? 0.35 : 1, y: 0, scale: state === 'chosen' ? 1.01 : 1 }}
      transition={{ duration: 0.34, delay: rm ? 0 : 0.08 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      {club || hasArt ? (
        <span className="im-story__media">
          {club ? (
            <span className="im-story__crest">
              <Crest club={club} size={84} decorative />
            </span>
          ) : (
            // slot: as duas opções do mesmo tema saem com fotos diferentes
            <EventArt art={art} hint={hint} salt={ctx.id} slot={i} fill />
          )}
          {kbd}
        </span>
      ) : (
        kbd
      )}
      <span className="im-story__txt">
        {/* eventos sem título trazem só o rótulo: nada de "Pedir desculpas / Pedir desculpas" */}
        {o.title && o.title !== o.label && <span className="lx-option__meta">{o.label}</span>}
        <span className="lx-option__title">{o.title ?? o.label}</span>
      </span>
      {details.length > 0 && (
        <span className="im-story__det">
          {details.map((d) => (
            <span key={d.label}>
              <small>{d.label}</small>
              <b>{d.value}</b>
            </span>
          ))}
        </span>
      )}
      {(effects.length > 0 || mins) && (
        <span className="im-story__fx">
          {effects.slice(0, mins ? 2 : 3).map((e, k) => (
            <EffectChip key={k} effect={e} />
          ))}
          {mins && <MinutesChip m={mins} />}
        </span>
      )}
    </motion.button>
  )
}

export const StoryDecision = memo(function StoryDecision({ s }: { s: ImmersiveState }) {
  const dispatch = useImmersive((x) => x.dispatch)
  const d = s.pendingDecision!
  const [chosen, setChosen] = useState<string | null>(null)
  const skip = useSkipAnimations()
  const pick = (id: string) => {
    if (chosen) return
    setChosen(id)
    setTimeout(() => void dispatch({ type: 'decision_choose', optionId: id }), skip ? 60 : 520)
  }
  useImHotkey(['1', '2', '3'], (e) => {
    const o = d.options[Number(e.key) - 1]
    if (o) pick(o.id)
  })
  const ctx = useMemo<StoryCtx>(() => ({ id: d.id, title: d.title, description: d.description, shared: sharedTerms(s, d.options) }), [d, s])
  const first = d.options[0]
  const common = (first?.details ?? []).filter((x) => ctx.shared.labels.has(x.label))
  const clubs = d.options.every((o) => o.clubId)
  const n = d.options.length
  const who = clubs ? (n === 2 ? 'Nos dois clubes' : n === 3 ? 'Nos três clubes' : 'Em todos os clubes') : n === 2 ? 'Nas duas opções' : n === 3 ? 'Nas três opções' : 'Em todas as opções'
  return (
    <section className="lx-plate lx-c-lg im-now im-story" aria-labelledby="im-story-h">
      <i className="lx-hl-top" aria-hidden="true" />
      <PanelHead kicker={<span>{DECISION_KICKER[d.kind] ?? 'Decisão'}</span>} icon={Sparkles} title={<span id="im-story-h">{d.title}</span>} />
      <p className="lx-t-body im-story__desc">{d.description}</p>
      {(common.length > 0 || ctx.shared.minutes) && (
        <div className="im-story__common">
          <span className="lx-label">{who}</span>
          <span className="im-story__det">
            {common.map((x) => (
              <span key={x.label}>
                <small>{x.label}</small>
                <b>{x.value}</b>
              </span>
            ))}
          </span>
          {ctx.shared.minutes && <MinutesChip m={ctx.shared.minutes} />}
        </div>
      )}
      <div className={cx('im-story__opts', d.options.length >= 3 && 'is-3')}>
        {d.options.map((o, i) => (
          <StoryOption key={o.id} o={o} i={i} chosen={chosen} onPick={pick} s={s} ctx={ctx} />
        ))}
      </div>
    </section>
  )
})

const DECISION_KICKER: Partial<Record<string, string>> = {
  academy: 'Início da carreira · escolha sua base',
  transfer: 'Mercado · decisão',
  loan: 'Empréstimo · decisão',
  loan_return: 'Fim de empréstimo',
  non_renewal: 'Fim de contrato',
  event: 'Bastidores · decisão',
  injury: 'Departamento médico',
  club_priority: 'Prioridade da temporada',
  national_call: 'Seleção',
  contract: 'Renovação de contrato',
  retirement: 'Fim de carreira?',
}

/** Sem item no calendário (antes da primeira temporada ou entre fases do motor). */
export const EmptyNow = memo(function EmptyNow() {
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  return (
    <section className="lx-plate lx-c-lg im-now im-cardnow" aria-labelledby="im-empty-h">
      <i className="lx-hl-top" aria-hidden="true" />
      <div className="im-cardnow__art">
        <EventArt art="locker" hint="vestiário" fill />
      </div>
      <div className="im-cardnow__body">
        <PanelHead kicker={<span id="im-empty-h">Agenda</span>} icon={Sparkles} title="Preparando a temporada" />
        <p className="lx-t-body m-0">A comissão técnica está fechando a agenda da semana. Avance para o próximo compromisso.</p>
        <div className="flex flex-wrap gap-2 mt-5">
          <Button variant="primary" size="lg" iconRight={ArrowRight} loading={busy} onClick={() => void dispatch({ type: 'advance' })}>
            Continuar
          </Button>
        </div>
      </div>
    </section>
  )
})

// ───────────────────────── janela / convocação / fim ─────────────────────────

export const WindowCard = memo(function WindowCard({ s, it }: { s: ImmersiveState; it: CalendarItem }) {
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const n = s.offers.length
  const free = !s.clubId
  // sem clube, "seguir" não existe: a ação é assinar com a melhor proposta (a mesma régua do Mercado)
  const best = free ? bestOffer(s.offers) : null
  const bestClub = best ? getClub(best.clubId) : undefined
  // negócio fechado nesta janela (empréstimo/transferência já assinados, ou acerto para a próxima temporada)
  const deal = !n ? s.inbox.find((m) => m.season === s.season && m.week === s.week && ((m.from === 'Diretoria' && /^Bem-vindo/.test(m.subject)) || /^Acerto fechado/.test(m.subject))) : undefined
  const renewed = !n && !deal && s.news.some((x) => x.season === s.season && x.week === s.week && / renova com /.test(x.headline))
  const club = getClub(s.clubId)
  const fem = artigo(club) === 'a'
  const dealText = deal
    ? /^Acerto/.test(deal.subject)
      ? `${deal.subject}: você termina esta temporada onde está e se apresenta na pré-temporada.`
      : s.parentClubId
        ? `Você foi emprestado ${fem ? 'à' : 'ao'} ${club?.shortName ?? 'novo clube'}.`
        : `Contrato assinado: agora você joga ${fem ? 'na' : 'no'} ${club?.shortName ?? 'novo clube'}.`
    : renewed
      ? `Contrato renovado: você segue ${fem ? 'na' : 'no'} ${club?.shortName ?? 'clube'} até ${s.finance.contractUntil}.`
      : null
  return (
    <section className="lx-plate lx-c-lg im-now im-cardnow" aria-labelledby="im-win-h">
      <i className="lx-hl-top" aria-hidden="true" />
      <div className="im-cardnow__art lx-window-band">
        <div className="im-offers-peek">
          {s.offers.slice(0, 3).map((o, i) => {
            const c = getClub(o.clubId)
            return c ? <Crest key={o.id} club={c} size={i === 0 ? 86 : 58} decorative className={`is-${i}`} /> : null
          })}
          {!n && dealText && club && <Crest club={club} size={86} decorative />}
          {!n && !(dealText && club) && <Repeat2 size={56} aria-hidden="true" />}
        </div>
      </div>
      <div className="im-cardnow__body">
        {/* o título do motor já pode começar com "Mercado ·" (sem clube): sem "Mercado · Mercado ·" */}
        <PanelHead kicker={<span id="im-win-h">Mercado · {it.title.replace(/^mercado\s*·\s*/i, '')}</span>} icon={Repeat2} title={n ? `${n} ${n === 1 ? 'proposta na mesa' : 'propostas na mesa'}` : dealText ? 'Negócio fechado' : 'Janela aberta'} gold={!!dealText} />
        <p className="lx-t-body m-0">
          {n
            ? free
              ? 'Você está sem clube. Seu empresário reuniu as ofertas: compare salário, duração e papel no elenco e escolha onde jogar.'
              : 'Seu empresário reuniu as ofertas. Negocie salário, duração e papel no elenco — ou siga onde está.'
            : (dealText ?? 'Nenhum clube fez proposta desta vez. Continue jogando bem e o telefone toca.')}
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          {n > 0 && (
            <Button variant={free ? 'ghost' : 'primary'} size="lg" icon={Repeat2} onClick={() => navigate('/imersivo', { query: { tela: 'mercado' } })}>
              Ver propostas
            </Button>
          )}
          {free && best ? (
            <Button variant="primary" size="lg" iconRight={ArrowRight} loading={busy} onClick={() => void dispatch({ type: 'offer_respond', offerId: best.id, response: 'accept' })} title="A proposta marcada como a melhor no Mercado">
              Assinar com {bestClub?.shortName ?? 'o clube'}
            </Button>
          ) : (
            <Button variant={n ? 'ghost' : 'primary'} size="lg" iconRight={ArrowRight} loading={busy} onClick={() => void dispatch({ type: 'advance' })}>
              {n ? 'Seguir no clube' : 'Continuar'}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
})

/**
 * "Fechar a janela" do Mercado sem clube: o motor assinaria sozinho com alguém. Aqui a escolha é
 * explícita — a melhor proposta (a mesma marcada no Mercado) ou voltar às propostas.
 */
export function CloseWindowDialog({ s, open, onClose }: { s: ImmersiveState; open: boolean; onClose: () => void }) {
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const best = bestOffer(s.offers)
  const team = best ? teamInfo(best.clubId) : undefined
  // o botão segue vivo na animação de saída do diálogo: um clique duplo aceitaria duas vezes
  const sent = useRef(false)
  useEffect(() => {
    if (open) sent.current = false
  }, [open])
  return (
    <Modal
      open={open && !!best}
      onClose={onClose}
      size="sm"
      className="im-dlg"
      title={<ImDlgTitle kicker="Mercado · sem clube">Assinar com {team?.short ?? 'o clube'}?</ImDlgTitle>}
      description={best ? `Você está sem clube: a janela só fecha com uma assinatura. A melhor proposta na mesa é a ${deTeam(team)} — ${best.role}, ${yearsLabel(best.years)}, ${fmtMoney(best.salary)}/ano.` : undefined}
      footer={
        <div className="flex flex-wrap gap-2 justify-end w-full">
          <Button variant="ghost" size="md" onClick={onClose}>
            Voltar
          </Button>
          <Button
            variant="primary"
            size="md"
            iconRight={ArrowRight}
            loading={busy}
            onClick={() => {
              if (best && !sent.current) void dispatch({ type: 'offer_respond', offerId: best.id, response: 'accept' })
              sent.current = true
              onClose()
            }}
          >
            Assinar com {team?.short ?? 'o clube'}
          </Button>
        </div>
      }
    />
  )
}

export const GenericCard = memo(function GenericCard({ s, it }: { s: ImmersiveState; it: CalendarItem }) {
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const callup = it.kind === 'national_callup'
  const end = it.kind === 'season_end'
  const awards = it.kind === 'awards'
  const msg = callup ? s.inbox.find((m) => /sele/i.test(m.from) && m.week === s.week && m.season === s.season) : null
  const country = getCountry(s.identity.nationality)
  const called = !!msg && /convocad/i.test(msg.subject)
  const Ico = callup ? Plane : end ? Star : awards ? Trophy : Sparkles
  return (
    <section className="lx-plate lx-c-lg im-now im-cardnow" aria-labelledby="im-gen-h">
      <i className="lx-hl-top" aria-hidden="true" />
      <div className="im-cardnow__art">
        <EventArt art={callup ? 'national' : end ? 'celebration' : 'crowd'} hint={it.title} nationality={s.identity.nationality} fill />
      </div>
      <div className="im-cardnow__body">
        <PanelHead kicker={<span id="im-gen-h">{callup ? `Seleção · ${it.title.replace(/^Convocação\s*·\s*/i, '')}` : end ? 'Fim de temporada' : awards ? 'Premiação' : 'Agenda'}</span>} icon={Ico} title={callup ? (called ? 'Você foi convocado!' : 'Lista divulgada') : it.title} gold={called || awards} />
        <p className="lx-t-body m-0">
          {callup
            ? msg?.body ??
              // sem mensagem da seleção nesta semana: a lista saiu (na chegada ao item) sem você, longe do corte
              `A seleção${country ? ` ${deCountry(country.name)}` : ''} divulgou a lista ${it.id.startsWith('ct:') ? `final para a ${it.title.replace(/^Convocação\s*·\s*/i, '')}` : 'desta data FIFA'} e seu nome não está nela. ${s.age < 17 ? 'A seleção principal só chama a partir dos 17 anos.' : 'Minutos no clube e OVR em alta colocam você no radar da comissão técnica.'}`
            : end
              ? 'Última semana. Hora do balanço: tabela final, evolução, prêmios e a conversa sobre o futuro.'
              : awards
                ? 'A noite de gala: Bola de Ouro, artilharia e seleção do campeonato.'
                : it.title}
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          {awards ? (
            <Button variant="primary" size="lg" icon={Trophy} onClick={() => navigate('/imersivo', { query: { tela: 'temporada' } })}>
              Ver balanço e premiação
            </Button>
          ) : (
            <Button variant="primary" size="lg" iconRight={ArrowRight} loading={busy} onClick={() => void dispatch({ type: 'advance' })}>
              {end ? 'Encerrar temporada' : 'Continuar'}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
})

export { weeksUntil }
