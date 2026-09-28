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
import { getClub } from '@/store/data'
import { useImmersive } from '@/store/immersive'
import { EventArt } from '@/ui/art/EventArt'
import { Button, Crest, EffectChip, Kbd, cx, formatPercent, useIsDesktop, useReducedMotion, useSkipAnimations } from '@/ui/primitives'
import { CompLogo, FormChips, ImSeg, PanelHead, TeamMark } from '../bits'
import { ATTR_LABEL, FOCUS_ORDER, INTENSITY, TRAINING_FOCUS, type Intensity } from '../model/constants'
import { trainingPreview } from '../model/training'
import { compInfo, itemTitle, recentForm, selectionForecast, teamInfo, weeksUntil, winProbs } from '../model/view'
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
  const pv = useMemo(() => trainingPreview(s, focus, intensity), [s, focus, intensity])
  const load = focus !== 'rest' && focus !== 'recovery'
  const go = () => {
    try {
      localStorage.setItem(TRAIN_KEY, JSON.stringify({ focus, intensity }))
    } catch {
      /* ignore */
    }
    void dispatch({ type: 'train', focus, intensity: load ? intensity : intensity === 'intensa' ? 'normal' : intensity })
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
          <span className="lx-label">Prévia</span>
          <div className="im-train__chips">
            {pv.gains.map((g) => (
              <span key={g.key} className="lx-fx lx-fx--up lx-fx--sm">
                <span className="lx-fx__ic">
                  <Zap size={14} aria-hidden="true" />
                </span>
                {ATTR_LABEL[g.key].short} {g.value}→{Math.min(99, g.value + 1)}
                <span className="lx-fx__p">{formatPercent(g.chance)}</span>
              </span>
            ))}
            <span className={cx('lx-fx lx-fx--sm', pv.fitnessDelta >= 0 ? 'lx-fx--up' : 'lx-fx--down')}>
              <span className="lx-fx__ic">
                <BatteryMedium size={14} aria-hidden="true" />
              </span>
              Energia {pv.fitnessAfter}
              <span className="lx-fx__p">{pv.fitnessDelta >= 0 ? `+${pv.fitnessDelta}` : pv.fitnessDelta}</span>
            </span>
            {pv.injuryRisk > 0 && (
              <span className="lx-fx lx-fx--sm lx-fx--down">
                <span className="lx-fx__ic">
                  <ShieldAlert size={14} aria-hidden="true" />
                </span>
                Lesão
                <span className="lx-fx__p">{formatPercent(pv.injuryRisk)}</span>
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

function ImportancePips({ v }: { v: number }) {
  const n = Math.max(1, Math.round(v * 5))
  const label = v >= 0.95 ? 'Final' : v >= 0.8 ? 'Decisão' : v >= 0.6 ? 'Clássico' : v >= 0.45 ? 'Importante' : 'Rodada normal'
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

export const MatchHero = memo(function MatchHero({ s, it, table, primary }: { s: ImmersiveState; it: CalendarItem; table: { clubId: string; points: number }[]; primary: boolean }) {
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
  const pos = (id: string) => {
    const i = table.findIndex((r) => r.clubId === id)
    return i >= 0 ? `${i + 1}º · ${table[i].points} pts` : national ? 'Seleção' : comp.short
  }
  const usStr = (national ? us.country?.strength : us.club?.strength) ?? 70
  const themStr = (them.national ? them.country?.strength : them.club?.strength) ?? 70
  const [w, d, l] = winProbs(usStr, themStr, home)
  const weeks = weeksUntil(s, it)
  const fc = national ? { label: 'Convocado', tone: 'pos' as const } : selectionForecast(s, kind, it.importance ?? 0.4)
  const play = () => void dispatch({ type: 'advance' })
  // dia de jogo: o foco vai para "Jogar partida" (Enter/Espaço jogam) — sem atalho global de Enter
  useEffect(() => {
    if (primary) playRef.current?.focus({ preventScroll: true })
  }, [primary, it.id])
  const side = (t: typeof us, isHome: boolean) => {
    const form = t.id === usId ? recentForm(s) : t.national ? [] : clubForm(s, t.id)
    return (
      <div className={cx('im-vs__team', isHome ? 'is-home' : 'is-away')} style={{ ['--tc' as string]: t.colors.primary } as CSSProperties}>
        <TeamMark team={t} size={desk && primary ? 76 : desk ? 56 : 52} className="im-vs__crest" />
        <b className="im-vs__name">{t.short}</b>
        <span className="im-vs__pos">
          {t.id === usId ? <span className="lx-you">Você</span> : null} {pos(t.id)}
        </span>
        {form.length ? <FormChips form={form} /> : <span className="im-form is-empty" aria-label="Sem jogos recentes">{[0, 1, 2, 3, 4].map((k) => <span key={k} className="lx-form">–</span>)}</span>}
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
          {it.stage ? ` · ${it.stage}` : ''}
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
        <ImportancePips v={it.importance ?? 0.4} />
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
          Microfones ligados, flashes prontos. {opp ? `Os jornalistas querem saber do duelo contra o ${opp.short}.` : 'Os jornalistas querem ouvir você.'} Cada resposta mexe com torcida, técnico e imprensa.
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          <Button variant="primary" size="lg" icon={Mic} loading={busy} onClick={() => void dispatch({ type: 'advance' })}>
            Ir para a coletiva
          </Button>
          <Button variant="ghost" size="lg" onClick={() => void dispatch({ type: 'press_skip' })}>
            Faltar (Mídia −)
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
  const str = (s.world?.clubs?.[clubId]?.strength as number | undefined) ?? getClub(clubId)?.strength ?? s.ovr
  const gap = s.ovr - str
  const youth = s.age <= 19 ? 0.14 : 0
  const pct = Math.max(0.08, Math.min(0.92, 0.55 + gap * 0.03 + youth))
  return pct >= 0.55 ? { label: 'Minutos: muitos', cls: 'lx-fx--up', pct } : pct >= 0.3 ? { label: 'Minutos: alguns', cls: 'lx-fx--info', pct } : { label: 'Minutos: poucos', cls: 'lx-fx--down', pct }
}

function StoryOption({ o, i, chosen, onPick, s }: { o: DecisionOption; i: number; chosen: string | null; onPick: (id: string) => void; s: ImmersiveState }) {
  const rm = useReducedMotion()
  const club = o.clubId ? getClub(o.clubId) : undefined
  const mins = club ? minutesOutlook(s, club.id) : null
  const state = chosen ? (chosen === o.id ? 'chosen' : 'dim') : 'idle'
  return (
    <motion.button
      type="button"
      className={cx('lx-option im-story__opt', state === 'chosen' && 'is-chosen')}
      aria-pressed={state === 'chosen'}
      aria-keyshortcuts={String(i + 1)}
      disabled={!!chosen}
      onClick={() => onPick(o.id)}
      initial={rm ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: state === 'dim' ? 0.35 : 1, y: 0, scale: state === 'chosen' ? 1.01 : 1 }}
      transition={{ duration: 0.34, delay: rm ? 0 : 0.08 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className="im-story__media">
        {club ? (
          <span className="im-story__crest">
            <Crest club={club} size={84} decorative />
          </span>
        ) : (
          <EventArt art={o.art ?? 'default'} hint={o.title ?? o.label} fill />
        )}
        <Kbd className="im-story__kbd">{i + 1}</Kbd>
      </span>
      <span className="im-story__txt">
        <span className="lx-option__meta">{o.label}</span>
        <span className="lx-option__title">{o.title ?? o.label}</span>
      </span>
      {!!o.details?.length && (
        <span className="im-story__det">
          {o.details.slice(0, 3).map((d) => (
            <span key={d.label}>
              <small>{d.label}</small>
              <b>{d.value}</b>
            </span>
          ))}
        </span>
      )}
      <span className="im-story__fx">
        {o.effects.slice(0, mins ? 2 : 3).map((e, k) => (
          <EffectChip key={k} effect={e} />
        ))}
        {mins && (
          <span className={cx('lx-fx', mins.cls)} title="Estimativa de jogos em campo nesta temporada (OVR × força do elenco)">
            <span className="lx-fx__ic">
              <Timer size={14} aria-hidden="true" />
            </span>
            {mins.label}
            <span className="lx-fx__p">{formatPercent(mins.pct)}</span>
          </span>
        )}
      </span>
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
  return (
    <section className="lx-plate lx-c-lg im-now im-story" aria-labelledby="im-story-h">
      <i className="lx-hl-top" aria-hidden="true" />
      <PanelHead kicker={<span>{DECISION_KICKER[d.kind] ?? 'Decisão'}</span>} icon={Sparkles} title={<span id="im-story-h">{d.title}</span>} />
      <p className="lx-t-body im-story__desc">{d.description}</p>
      <div className={cx('im-story__opts', d.options.length >= 3 && 'is-3')}>
        {d.options.map((o, i) => (
          <StoryOption key={o.id} o={o} i={i} chosen={chosen} onPick={pick} s={s} />
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
  return (
    <section className="lx-plate lx-c-lg im-now im-cardnow" aria-labelledby="im-win-h">
      <i className="lx-hl-top" aria-hidden="true" />
      <div className="im-cardnow__art lx-window-band">
        <div className="im-offers-peek">
          {s.offers.slice(0, 3).map((o, i) => {
            const c = getClub(o.clubId)
            return c ? <Crest key={o.id} club={c} size={i === 0 ? 86 : 58} decorative className={`is-${i}`} /> : null
          })}
          {!n && <Repeat2 size={56} aria-hidden="true" />}
        </div>
      </div>
      <div className="im-cardnow__body">
        <PanelHead kicker={<span id="im-win-h">Mercado · {it.title}</span>} icon={Repeat2} title={n ? `${n} ${n === 1 ? 'proposta na mesa' : 'propostas na mesa'}` : 'Janela aberta'} />
        <p className="lx-t-body m-0">{n ? 'Seu empresário reuniu as ofertas. Negocie salário, duração e papel no elenco — ou siga onde está.' : 'Nenhum clube fez proposta desta vez. Continue jogando bem e o telefone toca.'}</p>
        <div className="flex flex-wrap gap-2 mt-5">
          {n > 0 && (
            <Button variant="primary" size="lg" icon={Repeat2} onClick={() => navigate('/imersivo', { query: { tela: 'mercado' } })}>
              Ver propostas
            </Button>
          )}
          <Button variant={n ? 'ghost' : 'primary'} size="lg" iconRight={ArrowRight} loading={busy} onClick={() => void dispatch({ type: 'advance' })}>
            {n ? 'Seguir no clube' : 'Continuar'}
          </Button>
        </div>
      </div>
    </section>
  )
})

export const GenericCard = memo(function GenericCard({ s, it }: { s: ImmersiveState; it: CalendarItem }) {
  const dispatch = useImmersive((x) => x.dispatch)
  const busy = useImmersive((x) => x.busy)
  const callup = it.kind === 'national_callup'
  const end = it.kind === 'season_end'
  const awards = it.kind === 'awards'
  const msg = callup ? s.inbox.find((m) => /sele/i.test(m.from) && m.week === s.week) : null
  const called = !!msg && /convocad/i.test(msg.subject)
  const Ico = callup ? Plane : end ? Star : awards ? Trophy : Sparkles
  return (
    <section className="lx-plate lx-c-lg im-now im-cardnow" aria-labelledby="im-gen-h">
      <i className="lx-hl-top" aria-hidden="true" />
      <div className="im-cardnow__art">
        <EventArt art={callup ? 'national' : end ? 'celebration' : 'crowd'} hint={it.title} nationality={s.identity.nationality} fill />
      </div>
      <div className="im-cardnow__body">
        <PanelHead kicker={<span id="im-gen-h">{callup ? 'Seleção' : end ? 'Fim de temporada' : awards ? 'Premiação' : 'Agenda'}</span>} icon={Ico} title={callup ? (called ? 'Você foi convocado!' : msg ? 'Lista divulgada' : it.title) : it.title} gold={called || awards} />
        <p className="lx-t-body m-0">
          {callup
            ? msg?.body ?? 'A comissão técnica divulga a lista desta data FIFA.'
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
