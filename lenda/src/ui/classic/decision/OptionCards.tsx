/**
 * Decision option cards (`.lx-option`, tinted by `--oc`):
 *   ClubOptionCard    offers / stay / loans — crest + halo, league logo · flag, effects, salary/contract
 *   EventOptionCard   personal events, injury, retirement — EventArt media + outcome chips
 *   TrophyOptionCard  club_priority — the trophy you would chase
 * All share OptionShell: kbd hint, keyboard focus ring, chosen / dimmed states and the roulette
 * (flip every 200 ms → winner scale 1.05, losers .9 / 25 % / greyscale).
 */
import { memo, type CSSProperties, type ReactNode } from 'react'
import { motion } from 'motion/react'
import type { Decision, DecisionOption, EffectChip as EffectData } from '@/engine/types'
import { useClub, useCountry, useLeague, useTrophy } from '@/store/data'
import { useCareer } from '@/store/career'
import { Crest, EffectChip, Flag, Kbd, clubColors, cx, formatPercent, prettyEffectLabel, useIsTouch, useMediaQuery, useReducedMotion } from '@/ui/primitives'
import { TrophyArt } from '@/ui/trophies'
import { LeagueLogo } from '@/ui/classic/cockpit/bits'
import { EventArt } from '@/ui/art/EventArt'
import { useReveal } from '@/ui/classic/reveal/store'
import { useLiveSession } from '@/live/config'
import { VoteBadge } from '@/ui/live/VoteBadge'

export type CardState = 'idle' | 'chosen' | 'dim' | 'locked'

/** Mock / placeholder verbs that add nothing above the option name. */
const GENERIC_VERB = /^(fazer|escolher|op[çc][ãa]o)$/i

export interface OptionCardProps {
  decision: Decision
  option: DecisionOption
  index: number
  count: number
  compact: boolean
  state: CardState
  onPick: (option: DecisionOption) => void
  className?: string
  style?: CSSProperties
}

// ───────────────────────── shell ─────────────────────────

function OptionShell({
  option,
  index,
  state,
  onPick,
  oc,
  className,
  style,
  label,
  children,
}: Pick<OptionCardProps, 'option' | 'index' | 'state' | 'onPick' | 'className' | 'style'> & { oc?: string; label: string; children: ReactNode }) {
  const rm = useReducedMotion()
  const touch = useIsTouch()
  const focusIdx = useReveal((s) => s.focusIdx)
  const live = useLiveSession((s) => s.on)
  const chosen = state === 'chosen'
  const dim = state === 'dim'
  return (
    <motion.button
      type="button"
      id={`ck-opt-${index}`}
      data-idx={index}
      className={cx('lx-option ck-opt', focusIdx === index && state === 'idle' && 'is-focus', chosen && 'is-chosen', dim && 'is-dim', state !== 'idle' && 'is-locked', className)}
      style={{ ['--oc' as string]: oc ?? '#ffffff', ...style }}
      aria-label={label}
      aria-pressed={chosen || undefined}
      aria-disabled={state !== 'idle' || undefined}
      aria-keyshortcuts={String(index + 1)}
      onClick={() => state === 'idle' && onPick(option)}
      initial={false}
      animate={rm ? { opacity: dim ? 0.35 : 1 } : chosen ? { scale: [1, 1.02, 1.01], opacity: 1 } : dim ? { scale: 0.98, opacity: 0.35 } : { scale: 1, opacity: 1 }}
      transition={chosen ? { duration: 0.42, ease: [0.34, 1.56, 0.64, 1] } : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      {!touch && (
        <Kbd className="ck-opt__kbd" aria-hidden="true">
          {index + 1}
        </Kbd>
      )}
      {live && <VoteBadge optionId={option.id} />}
      {children}
    </motion.button>
  )
}

/** Title block: verb eyebrow ("ASSINAR COM") + name. */
function OptTitle({ verb, name, center }: { verb?: string; name: string; center?: boolean }) {
  return (
    <span className={cx('ck-opt__head', center && 'is-center')}>
      {verb ? <span className="lx-eyebrow ck-opt__verb">{verb}</span> : null}
      <span className="ck-opt__name">{name}</span>
    </span>
  )
}

/** Effect chips with the roulette states for the chosen card. */
function Effects({ option, chosen, compact, max }: { option: DecisionOption; chosen: boolean; compact: boolean; max?: number }) {
  const phase = useReveal((s) => s.phase)
  const spinIdx = useReveal((s) => s.spinIdx)
  const settled = useReveal((s) => s.settled)
  // phones and the narrow two-column range (1104–1279) drop the long tail of chip labels
  const phone = useMediaQuery('(max-width: 35.99rem), (min-width: 69rem) and (max-width: 79.99rem)')
  const effects = option.effects.slice(0, max ?? option.effects.length)
  if (!effects.length) return null
  const live = chosen && phase !== 'idle' && phase !== 'choosing'
  const result = live && settled && spinIdx != null && option.effects.length > 1 ? spinIdx : null
  const resultChip = result != null ? option.effects[result] : null
  return (
    <span className={cx('ck-opt__fx', compact && 'is-compact')}>
      {effects.map((e, i) => {
        const lit = live && !settled && spinIdx === i
        const win = result === i
        const lose = result != null && result !== i
        return (
          <EffectChip
            key={i}
            effect={shorten(e, phone || compact)}
            state={lit || win ? 'hit' : 'idle'}
            className={cx('ck-fx', lit && 'ck-fx-lit', win && 'ck-fx-win', lose && 'ck-fx-lose')}
          />
        )
      })}
      {resultChip && (
        <span className="lx-sr-only" aria-live="polite">
          Resultado: {prettyEffectLabel(resultChip.label)}
        </span>
      )}
    </span>
  )
}

/** Phones / compact cards: drop the long tail ("−2 OVR · adaptação" → "−2 OVR"). */
function shorten(e: EffectData, short: boolean): EffectData {
  if (!short) return e
  const i = e.label.indexOf(' · ')
  return i > 0 ? { ...e, label: e.label.slice(0, i) } : e
}

function effectsAria(option: DecisionOption): string {
  return option.effects.map((e) => `${prettyEffectLabel(e.label)}${e.probability != null && e.probability < 1 ? ` (${formatPercent(e.probability)})` : ''}`).join(', ')
}

// ───────────────────────── club ─────────────────────────

export const ClubOptionCard = memo(function ClubOptionCard(p: OptionCardProps) {
  const { option, compact, state } = p
  const club = useClub(option.clubId)
  const worldLeague = useCareer((s) => (option.clubId ? s.state?.world.clubs[option.clubId]?.leagueId : undefined))
  const league = useLeague(worldLeague ?? club?.leagueId)
  const country = useCountry(club?.country)
  const c = clubColors(club ?? null)
  const name = option.title ?? club?.name ?? 'Clube'
  const verb = option.label || 'Assinar com'
  const details = pickDetails(option.details)
  const label = `${verb} ${name}. ${[league?.shortName, country?.name].filter(Boolean).join(', ')}. ${effectsAria(option)}. ${details.map((d) => `${d.label} ${d.value}`).join(', ')}`
  return (
    <OptionShell {...p} oc={c.glow} label={label} className={cx(p.className, 'ck-opt--club', compact && 'is-compact')}>
      {compact ? (
        <span className="ck-opt__hrow">
          <span className="lx-option__crest ck-opt__thumb">
            <Crest club={club ?? { id: option.clubId ?? 'x', name }} size={44} decorative shadow />
          </span>
          <span className="ck-opt__htext">
            <OptTitle verb={verb} name={name} />
            <ClubMeta league={league} country={country} />
            {details.length > 0 && (
              <span className="ck-opt__mini">
                {details.map((d) => (
                  <span key={d.label}>
                    {d.label} <b>{d.value}</b>
                  </span>
                ))}
              </span>
            )}
          </span>
        </span>
      ) : (
        <>
          <OptTitle verb={verb} name={name} />
          <span className="lx-option__crest ck-opt__crest">
            <Crest club={club ?? { id: option.clubId ?? 'x', name }} size={70} decorative shadow />
          </span>
          <ClubMeta league={league} country={country} center />
        </>
      )}
      <Effects option={option} chosen={state === 'chosen'} compact={compact} max={compact ? 2 : undefined} />
      {details.length > 0 && !compact && (
        <span className="ck-opt__foot">
          {details.map((d) => (
            <span key={d.label}>
              {d.label} <b>{d.value}</b>
            </span>
          ))}
        </span>
      )}
    </OptionShell>
  )
})

function ClubMeta({ league, country, center }: { league?: ReturnType<typeof useLeague>; country?: ReturnType<typeof useCountry>; center?: boolean }) {
  if (!league && !country) return null
  return (
    <span className={cx('ck-opt__meta', center && 'is-center')}>
      {league && (
        <span className="ck-opt__lg">
          <LeagueLogo league={league} size={14} />
          <span className="ck-opt__lgname">{league.shortName}</span>
        </span>
      )}
      {league && country && <span className="ck-dot" aria-hidden="true" />}
      {country && (
        <span className="ck-opt__ct">
          <Flag code={country.code} h={12} w={16} radius={2} decorative />
          {country.code}
        </span>
      )}
    </span>
  )
}

/** Footer facts: salary + contract (the role is already an effect chip; the league is in the meta). */
function pickDetails(details: DecisionOption['details']): { label: string; value: string }[] {
  if (!details?.length) return []
  const clean = details.filter((d) => !/^liga$/i.test(d.label) && !/papel/i.test(d.label))
  const sal = clean.find((d) => /sal[aá]rio/i.test(d.label))
  const con = clean.find((d) => /contrato|dura[cç][aã]o/i.test(d.label))
  const out = [sal, con].filter(Boolean) as { label: string; value: string }[]
  const rest = clean.filter((d) => !out.includes(d))
  return [...out, ...rest].slice(0, 2).map((d) => ({ label: d.label.replace(/\/ano$/i, ''), value: /sal[aá]rio\/ano/i.test(d.label) && !/\/ano/.test(d.value) ? `${d.value}/ano` : d.value }))
}

// ───────────────────────── event ─────────────────────────

export const EventOptionCard = memo(function EventOptionCard(p: OptionCardProps) {
  const { option, decision, compact, state } = p
  const nat = useCareer((s) => s.state?.identity.nationality)
  const seed = useCareer((s) => s.state?.seed)
  const club = useClub(option.clubId)
  const retire = decision.kind === 'retirement' && /retire|aposent/i.test(`${option.id} ${option.art ?? ''} ${option.title ?? ''}`)
  const art = option.art ?? (retire ? 'retirement' : decision.eventKey ? `${decision.eventKey}` : decision.kind)
  const name = option.title || option.label || 'Opção'
  const verb = option.title && option.label && option.label !== option.title && !GENERIC_VERB.test(option.label) ? option.label : undefined
  const label = `${verb ? `${verb} ` : ''}${name}. ${effectsAria(option)}`
  const tint = club ? clubColors(club).glow : undefined
  const media = (
    <>
      <EventArt art={art} hint={`${option.title ?? ''} ${option.label ?? ''}\n${decision.title}\n${decision.description}`} nationality={nat} salt={seed} tint={tint} fill priority />
      {club && (
        <span className="ck-opt__overlay">
          <Crest club={club} size={compact ? 30 : 48} decorative shadow />
        </span>
      )}
    </>
  )
  return (
    <OptionShell {...p} oc={tint ?? (retire ? '#ffae5c' : undefined)} label={label} className={cx(p.className, 'ck-opt--event', compact && 'is-compact', retire && 'is-retire')}>
      {compact ? (
        <span className="ck-opt__hrow">
          <span className="ck-opt__media ck-opt__thumb">{media}</span>
          <span className="ck-opt__htext">
            <OptTitle verb={verb} name={name} />
          </span>
        </span>
      ) : (
        <>
          <OptTitle verb={verb} name={name} center />
          <span className="ck-opt__media">{media}</span>
        </>
      )}
      <Effects option={option} chosen={state === 'chosen'} compact={compact} max={compact ? 2 : 3} />
    </OptionShell>
  )
})

// ───────────────────────── trophy (club priority) ─────────────────────────

export const TrophyOptionCard = memo(function TrophyOptionCard(p: OptionCardProps) {
  const { option, compact, state } = p
  const trophy = useTrophy(option.trophyId)
  const name = option.label || option.title || 'Prioridade'
  const comp = option.title && option.title !== name ? option.title : trophy?.name
  const label = `${name}. ${comp ?? ''}. ${effectsAria(option)}`
  return (
    <OptionShell {...p} oc="#ffd66e" label={label} className={cx(p.className, 'ck-opt--trophy', compact && 'is-compact')}>
      <OptTitle name={name} center />
      <span className="ck-opt__trophy lx-trophy-spot lx-trophy-spot--gold" style={{ ['--spot' as string]: compact ? '110px' : '150px' }}>
        {option.trophyId ? <TrophyArt id={trophy?.art ?? option.trophyId} size={compact ? 70 : 128} trophy={trophy ? { family: trophy.family, metal: trophy.metal, accent: trophy.accent } : undefined} className="lx-trophy lx-trophy--card" title={trophy?.name} /> : null}
      </span>
      {comp && <span className="ck-opt__comp">{comp}</span>}
      <Effects option={option} chosen={state === 'chosen'} compact={compact} max={2} />
    </OptionShell>
  )
})

export function cardFor(decision: Decision, option: DecisionOption) {
  if ((decision.kind === 'club_priority' || decision.eventKey === 'club_priority') && option.trophyId) return TrophyOptionCard
  if (option.clubId && decision.kind !== 'event' && decision.kind !== 'national_call') return ClubOptionCard
  if (option.clubId && !option.art) return ClubOptionCard
  return EventOptionCard
}
