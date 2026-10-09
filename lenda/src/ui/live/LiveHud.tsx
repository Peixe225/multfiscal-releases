/**
 * Faixa da live sobre o jogo (substitui a barra do topo): AO VIVO · votação com relógio e placar por
 * opção · último presente · maiores apoiadores · termômetro de curtidas · menu do streamer.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Crown, Flame, Pause, Play, Settings2, SkipForward, Sparkles, Square, Users } from 'lucide-react'
import { navigate } from '@/store/app'
import { newLegendNow } from '@/live/autopilot'
import { useLiveConfig, useLiveSession } from '@/live/config'
import { topSupporters, useLive, type FeedItem } from '@/live/store'
import { percents, type Round } from '@/live/votes'
import { useReveal } from '@/ui/classic/reveal/store'
import { cx } from '@/ui/primitives'
import { Countdown, GiftIcon, OPTION_COLORS, fmtCoins, howToVote, useNow } from './bits'

function LiveBadge() {
  const status = useLive((s) => s.status)
  const viewers = useLive((s) => s.viewers)
  const demo = status.state === 'demo'
  const ok = status.state === 'connected' || demo
  return (
    <span className={cx('lv-onair', !ok && 'is-off')} title={status.message}>
      <span className="lv-onair__dot" aria-hidden="true" />
      <span className="lv-onair__t">{demo ? 'SIMULADOR' : ok ? 'AO VIVO' : status.state === 'offline' ? 'OFFLINE' : 'SEM SINAL'}</span>
      {viewers != null && ok && !demo && (
        <span className="lv-onair__v">
          <Users size={12} aria-hidden="true" />
          {viewers}
        </span>
      )}
    </span>
  )
}

/** Placar: barra de cabo de guerra + um chip por opção. */
export const Legend = memo(function Legend({ round, big }: { round: Round; big?: boolean }) {
  const bindings = useLiveConfig((s) => s.config.giftBindings)
  const pct = percents(round)
  return (
    <div className={cx('lv-legend', big && 'is-big')}>
      <div className="lv-tug" aria-hidden="true">
        {round.options.map((o, i) => (
          <span key={o.id} style={{ flexGrow: Math.max(pct[i], 0.0001), background: OPTION_COLORS[i] }} />
        ))}
        {!pct.some(Boolean) && <span className="lv-tug__empty" />}
      </div>
      <ol className="lv-chips">
        {round.options.map((o, i) => (
          <li key={o.id} className="lv-chip" style={{ ['--oc' as string]: OPTION_COLORS[i] }}>
            <b className="lv-chip__n">{i + 1}</b>
            {bindings[i] && <GiftIcon name={bindings[i]} size={big ? 22 : 16} />}
            <span className="lv-chip__l">{o.label}</span>
            <span className="lv-chip__p tabular-nums">{pct[i]}%</span>
          </li>
        ))}
      </ol>
    </div>
  )
})

function RoundHead({ round }: { round: Round }) {
  return (
    <div className="lv-head">
      <span className="lv-head__k">
        <span className="lv-dot-live" aria-hidden="true" />
        Votação do chat
      </span>
      <span className="lv-head__t">{round.title}</span>
      <span className="lv-head__how">{howToVote(round.options.length)}</span>
    </div>
  )
}

function ResultHead() {
  const result = useLive((s) => s.result)
  if (!result) return null
  const { round, outcome } = result
  const opt = round.options[outcome.winner]
  const pct = percents(round)[outcome.winner]
  const why =
    outcome.reason === 'instant' && round.decidedBy
      ? `@${round.decidedBy.user.id} decidiu com ${round.decidedBy.coins} moedas!`
      : outcome.reason === 'no-votes'
        ? 'Ninguém votou: sorteio'
        : outcome.reason === 'tie-break'
          ? 'Empate decidido no desempate'
          : `${pct}% dos votos`
  return (
    <div className="lv-head is-result" style={{ ['--oc' as string]: OPTION_COLORS[outcome.winner] }}>
      <span className="lv-head__k">
        <Sparkles size={13} aria-hidden="true" /> O chat decidiu
      </span>
      <span className="lv-head__t">
        <b className="lv-head__n">{outcome.winner + 1}</b> {opt?.label}
      </span>
      <span className="lv-head__how">{why}</span>
    </div>
  )
}

function StageHead() {
  const stage = useLive((s) => s.stage)
  const creation = useLive((s) => s.creation)
  const nextAt = useLive((s) => s.nextCareerAt)
  const paused = useLiveSession((s) => s.paused)
  const phase = useReveal((s) => s.phase)
  const celebrating = useReveal((s) => s.celebrationOpen)
  const now = useNow(!!nextAt, 500)
  let k = 'Live interativa'
  let t = 'Aguardando a próxima decisão'
  if (paused) {
    k = 'Pausado'
    t = 'O streamer pausou as votações'
  } else if (stage === 'ending') {
    k = 'Fim de carreira'
    t = nextAt ? `Nova lenda em ${Math.max(0, Math.ceil((nextAt - now) / 1000))}s` : 'A próxima lenda começa quando o streamer quiser'
  } else if (creation?.phase === 'bidding') {
    k = 'Disputa pela criação'
    t = 'Quem doar mais agora cria a próxima lenda!'
  } else if (creation?.phase === 'creating') {
    k = 'Criação da lenda'
    t = `${creation.winner?.user.name ?? 'O vencedor'} está criando a lenda`
  } else if (stage === 'identity') {
    k = 'Nova lenda'
    t = 'O chat está montando o próximo craque'
  } else if (celebrating) {
    k = 'Título!'
    t = 'Comemora, torcida!'
  } else if (phase !== 'idle') {
    k = 'Simulando'
    t = 'A temporada está rolando…'
  }
  return (
    <div className="lv-head">
      <span className="lv-head__k">{k}</span>
      <span className="lv-head__t">{t}</span>
      <span className="lv-head__how">Cada decisão da carreira é votada aqui: comentários e presentes</span>
    </div>
  )
}

function FeedLine() {
  const feed = useLive((s) => s.feed)
  const item = feed.find((f) => f.kind !== 'vote') ?? feed[0]
  return (
    <div className="lv-feed" aria-live="polite">
      {/* troca seca + entrada curta: com muitos presentes seguidos, saída animada sobrepunha duas linhas */}
      {item && (
        <span key={item.id} className={cx('lv-feed__it', `is-${item.kind}`)}>
          <FeedText item={item} />
        </span>
      )}
    </div>
  )
}

export function FeedText({ item }: { item: FeedItem }) {
  if (item.kind === 'gift' && item.gift)
    return (
      <>
        <GiftIcon name={item.gift.name} size={16} />
        <b>{item.user?.name}</b> mandou {item.text}
        {item.option != null && (
          <span className="lv-feed__opt" style={{ ['--oc' as string]: OPTION_COLORS[item.option] }}>
            → {item.option + 1}
          </span>
        )}
      </>
    )
  if (item.kind === 'result')
    return (
      <>
        <Sparkles size={14} aria-hidden="true" /> Decidido: <b>{item.text}</b>
      </>
    )
  if (item.kind === 'info') return <>{item.text}</>
  return (
    <>
      <b>{item.user?.name}</b> {item.text}
    </>
  )
}

function TopFans() {
  const supporters = useLive((s) => s.supporters)
  const top = topSupporters(supporters, 3)
  if (!top.length) return <span className="lv-fans is-empty">Mande um presente e entre no pódio da live</span>
  return (
    <ol className="lv-fans" aria-label="Maiores apoiadores">
      {top.map((s, i) => (
        <li key={s.user.id} className={cx('lv-fan', i === 0 && 'is-top')}>
          {i === 0 ? <Crown size={12} aria-hidden="true" /> : <span className="lv-fan__n">{i + 1}</span>}
          <span className="lv-fan__name">{s.user.name}</span>
          <span className="lv-fan__c tabular-nums">{fmtCoins(s.coins)}</span>
        </li>
      ))}
    </ol>
  )
}

function Likes() {
  const meter = useLive((s) => s.likesMeter)
  const bursts = useLive((s) => s.likeBursts)
  const goal = useLiveConfig((s) => Math.max(50, s.config.likesGoal))
  const [pop, setPop] = useState(false)
  const prev = useRef(bursts)
  useEffect(() => {
    if (bursts === prev.current) return
    prev.current = bursts
    setPop(true)
    const t = setTimeout(() => setPop(false), 1600)
    return () => clearTimeout(t)
  }, [bursts])
  return (
    <span className={cx('lv-likes', pop && 'is-pop')} title={`Termômetro da torcida: ${meter}/${goal} curtidas`}>
      <Flame size={14} aria-hidden="true" />
      <span className="lv-likes__bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (meter / goal) * 100)}%` }} />
      </span>
    </span>
  )
}

function HudMenu() {
  const [open, setOpen] = useState(false)
  const paused = useLiveSession((s) => s.paused)
  const round = useLive((s) => s.round)
  const creation = useLive((s) => s.creation)
  const stage = useLive((s) => s.stage)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', h)
    return () => document.removeEventListener('pointerdown', h)
  }, [open])
  const act = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }
  return (
    <div className="lv-menu" ref={ref}>
      <button type="button" className="lv-menu__btn" aria-label="Controles da live" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Settings2 size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="lv-menu__pop" role="menu">
          <button type="button" role="menuitem" onClick={act(() => useLiveSession.getState().setPaused(!paused))}>
            {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Retomar votações' : 'Pausar votações'}
          </button>
          <button type="button" role="menuitem" disabled={!round && !creation} onClick={act(() => useLive.getState().closeNow())}>
            <SkipForward size={15} /> {creation ? (creation.phase === 'bidding' ? 'Encerrar a disputa agora' : 'Encerrar a criação agora') : 'Encerrar a votação agora'}
          </button>
          <button type="button" role="menuitem" disabled={stage === 'identity'} onClick={act(() => newLegendNow())}>
            <Sparkles size={15} /> Nova lenda (chat vota)
          </button>
          <button type="button" role="menuitem" onClick={act(() => navigate('/live'))}>
            <Settings2 size={15} /> Configurações da live
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={act(() => useLiveSession.getState().stop())}>
            <Square size={15} /> Sair do modo live
          </button>
        </div>
      )}
    </div>
  )
}

/** Altura da faixa em --lv-hud-h (os avisos/toasts aparecem logo abaixo dela). */
function useHudHeight() {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const apply = () => root.style.setProperty('--lv-hud-h', `${Math.round(el.getBoundingClientRect().height)}px`)
    apply()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      root.style.removeProperty('--lv-hud-h')
    }
  }, [])
  return ref
}

export function LiveHud({ leader }: { leader: boolean }) {
  const ref = useHudHeight()
  const round = useLive((s) => s.round)
  const result = useLive((s) => s.result)
  const paused = useLiveSession((s) => s.paused)
  const now = useNow(!!result && !round, 500)
  const showResult = !round && !!result && now - result.at < 4500
  if (!leader)
    return (
      <header ref={ref} className="lv-hud is-follower" role="region" aria-label="Live interativa">
        <div className="lv-hud__row">
          <LiveBadge />
          <div className="lv-head">
            <span className="lv-head__k">Painel</span>
            <span className="lv-head__t">A live está rodando em outra janela</span>
            <span className="lv-head__how">Feche esta aba ou use-a só para configurar (#/live)</span>
          </div>
          <HudMenu />
        </div>
      </header>
    )
  return (
    <header ref={ref} className={cx('lv-hud', round && 'is-voting', round?.kind === 'decision' && 'is-decision')} role="region" aria-label="Live interativa">
      <div className="lv-hud__row">
        <LiveBadge />
        {round ? <RoundHead round={round} /> : showResult ? <ResultHead /> : <StageHead />}
        {round && <Countdown endsAt={round.endsAt} total={round.endsAt - round.startedAt} paused={paused} />}
        <HudMenu />
      </div>
      {round && round.kind === 'decision' && <Legend round={round} />}
      <div className="lv-hud__foot">
        <FeedLine />
        <TopFans />
        <Likes />
      </div>
    </header>
  )
}
