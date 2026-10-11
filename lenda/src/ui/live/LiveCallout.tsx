/**
 * Linha de chamadas da faixa da live — o que entretém e ensina enquanto a sala ainda está vazia:
 *
 *   1. boas-vindas / agradecimento ("Chegou Ana · comenta 1 a 4 pra jogar", "Valeu por seguir, Bia!") —
 *      a fila da store (shoutouts.ts) já limita a 1 a cada 4 s;
 *   2. votação pausada → o aviso da pausa;
 *   3. votação que acabou de fechar → por que a opção venceu (4,5 s);
 *   4. chamadas girando a cada 6 s (config.ctaOn, src/live/cta.ts): "quente" (fixa em "Seja o primeiro:
 *      comente…") quando a votação está aberta e ninguém votou ainda;
 *   5. chamadas desligadas → o texto "como participar" de sempre.
 *
 * Fica no lugar da linha "como participar" da faixa (mesma altura: a faixa não pula e nada cobre os cards
 * das opções); no palco, onde o cartão grande já explica a fase, entra como uma linha própria.
 */
import type { ReactNode } from 'react'
import { Crown, Dices, Gamepad2, Gift, Hand, Heart, Megaphone, MessageCircle, Mic, Pause, Share2, Sparkles, UserPlus } from 'lucide-react'
import { useLiveConfig, useLiveSession } from '@/live/config'
import { CTA_PERIOD_MS, ctaItems, pickCta, type CtaItem, type CtaPhase } from '@/live/cta'
import { giftMeta, sameGift } from '@/live/gifts'
import { isOffensive } from '@/live/identity'
import { useLive } from '@/live/store'
import type { LiveUser } from '@/live/types'
import { hasVotes, roundClock, type Round } from '@/live/votes'
import { cx } from '@/ui/primitives'
import { GiftIcon, OPTION_COLORS, useNow } from './bits'

/** Nome para a chamada: o apelido (curto) — com palavrão, o @; se o @ também tiver, "um torcedor". */
export function shoutName(u: LiveUser): string {
  const nick = u.name.replace(/\s+/g, ' ').trim()
  const pick = nick && !isOffensive(nick) ? nick : !isOffensive(u.id) ? `@${u.id}` : 'um torcedor'
  const chars = Array.from(pick)
  return chars.length > 22 ? `${chars.slice(0, 21).join('')}…` : pick
}

const CTA_ICON: Record<CtaItem['kind'], typeof Crown> = {
  vote: MessageCircle,
  gift: Gift,
  quiet: Dices,
  bid: Gift,
  creator: Crown,
  site: Gamepad2,
  follow: UserPlus,
  custom: Megaphone,
}

interface Line {
  key: string
  tone: string
  icon: ReactNode
  text: ReactNode
  /** Cor da opção (resultado). */
  oc?: string
}

/**
 * O convite da boas-vindas, pelo que dá para fazer AGORA: comentar um número só serve com a votação aberta
 * (no anúncio, na criação, entre as decisões e no fim de carreira um "1" seria ignorado sem resposta).
 */
export function joinInvite(phase: { round: Round | null; creation: 'bidding' | 'creating' | null }): string {
  if (phase.round) return `comenta 1 a ${phase.round.options.length} pra jogar`
  if (phase.creation === 'bidding') return 'doe e crie a próxima lenda'
  if (phase.creation === 'creating') return 'a próxima lenda está nascendo'
  return 'a próxima votação já vem: comente o número'
}

export function LiveCallout({ round, showResult, how, onStage }: { round: Round | null; showResult: boolean; how: string; onStage: boolean }) {
  const cfg = useLiveConfig((s) => s.config)
  const shout = useLive((s) => s.shout)
  const result = useLive((s) => s.result)
  const creation = useLive((s) => s.creation)
  const catalog = useLive((s) => s.catalog)
  const paused = useLiveSession((s) => s.paused)
  // gira as chamadas e a contagem da sala vazia (rodada sem voto: 4× por segundo, para o "em N s" andar junto
  // com o número do anel da faixa)
  const quietRound = !!round && round.quietAt != null && !hasVotes(round)
  const now = useNow(cfg.ctaOn || !!shout, quietRound ? 250 : 1000)

  let line: Line | null = null
  if (shout && now < shout.until) {
    const name = <b>{shoutName(shout.user)}</b>
    if (shout.kind === 'join')
      line = {
        key: `s${shout.id}`,
        tone: 'join',
        icon: <Hand size={17} aria-hidden="true" />,
        text: (
          <>
            Chegou {name} · {joinInvite({ round, creation: creation?.phase ?? null })}
          </>
        ),
      }
    else if (shout.kind === 'follow') line = { key: `s${shout.id}`, tone: 'follow', icon: <Heart size={17} aria-hidden="true" />, text: <>Valeu por seguir, {name}!</> }
    else line = { key: `s${shout.id}`, tone: 'share', icon: <Share2 size={17} aria-hidden="true" />, text: <>{name} compartilhou a live · valeu!</> }
  } else if (paused) {
    line = { key: 'paused', tone: 'paused', icon: <Pause size={17} aria-hidden="true" />, text: how }
  } else if (showResult && result && !round) {
    const fate = result.outcome.reason === 'no-votes'
    const icon = fate ? <Dices size={17} aria-hidden="true" /> : result.outcome.streamer ? <Mic size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />
    line = { key: `r${result.at}`, tone: fate ? 'quiet' : 'result', icon, text: how, oc: OPTION_COLORS[result.outcome.winner] }
  } else if (cfg.ctaOn) {
    const phase: CtaPhase = round ? 'vote' : creation?.phase === 'bidding' ? 'bidding' : creation?.phase === 'creating' ? 'creating' : 'other'
    // o mesmo relógio do anel da faixa (roundClock): sem voto, conta até o fechamento da sala vazia
    const clock = round ? roundClock(round) : null
    const { items, hot, anchor } = ctaItems({
      cfg,
      phase,
      round: round && clock ? { options: round.options.length, voted: hasVotes(round), quietIn: clock.quiet ? Math.max(0, Math.ceil((clock.endsAt - now) / 1000)) : null, startedAt: round.startedAt } : null,
      giftCoins: (name) => catalog.find((g) => sameGift(g, name))?.coins ?? giftMeta(name)?.coins ?? 1,
    })
    const item = pickCta(items, now, CTA_PERIOD_MS, anchor)
    if (item) {
      const Icon = CTA_ICON[item.kind]
      line = {
        // a contagem da sala vazia muda o texto a cada segundo: a chave fica a mesma (sem reentrar)
        key: `c:${item.id}:${hot ? 'h' : 'n'}`,
        tone: hot ? 'hot' : `cta-${item.kind}`,
        icon: item.gift ? <GiftIcon name={item.gift} size={20} /> : <Icon size={17} aria-hidden="true" />,
        text: item.text,
      }
    }
  } else if (!onStage) {
    line = { key: 'how', tone: 'how', icon: <MessageCircle size={17} aria-hidden="true" />, text: how }
  }
  if (!line) return null
  return (
    <div className={cx('lv-callout', `is-${line.tone}`, onStage && 'is-stage')} aria-live="polite" style={line.oc ? { ['--oc' as string]: line.oc } : undefined}>
      {/* troca seca + entrada curta (como o feed): saída animada sobreporia duas chamadas */}
      <span key={line.key} className="lv-callout__in">
        <span className="lv-callout__ic">{line.icon}</span>
        <span className="lv-callout__t">{line.text}</span>
      </span>
    </div>
  )
}
