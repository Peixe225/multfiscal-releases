/**
 * Faixa da live sobre o jogo (substitui a barra do topo): AO VIVO · votação com relógio e placar por
 * opção · último presente · maiores apoiadores · termômetro de curtidas · menu do streamer.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Crown, Flame, Pause, Play, Settings2, SkipForward, Sparkles, Square, Users } from 'lucide-react'
import { useApp } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
import { newLegendNow, requestStop } from '@/live/autopilot'
import { lockHolder, sendLiveCommand } from '@/live/channel'
import { useLiveConfig, useLiveSession } from '@/live/config'
import { topSupporters, useLive, type FeedItem } from '@/live/store'
import { percents, type Outcome, type Round } from '@/live/votes'
import { useReveal } from '@/ui/classic/reveal/store'
import { cx } from '@/ui/primitives'
import { Countdown, GiftIcon, NEW_LEGEND_LABEL, OPTION_COLORS, coinsLabel, confirmNewLegend, fmtCoins, howToVote, useNow, useSafeArea } from './bits'

/** Pênalti decisivo: as opções são as zonas do gol (ids "opção:left|center|right"), desenhadas sem placar nos cards. */
export const isPenaltyRound = (r: Round | null | undefined) => r?.kind === 'decision' && r.options.some((o) => /:(?:left|center|right)$/.test(o.id))

function LiveBadge() {
  const status = useLive((s) => s.status)
  const viewers = useLive((s) => s.viewers)
  const source = useLive((s) => s.source)
  const demo = status.state === 'demo'
  const ok = status.state === 'connected' || demo
  return (
    <span className={cx('lv-onair', !ok && 'is-off')} title={status.message}>
      <span className="lv-onair__dot" aria-hidden="true" />
      <span className="lv-onair__t">{demo ? (source === 'ponte' ? 'DEMO' : 'SIMULADOR') : ok ? 'AO VIVO' : status.state === 'offline' ? 'OFFLINE' : 'SEM SINAL'}</span>
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

/** Votação pausada: a faixa e o palco avisam (o relógio sozinho, em "II", passava despercebido). */
export const PAUSED_HOW = 'O streamer pausou — a votação volta já'

function RoundHead({ round, paused }: { round: Round; paused: boolean }) {
  return (
    <div className="lv-head">
      <span className={cx('lv-head__k', paused && 'is-paused')}>
        {paused ? <Pause size={13} aria-hidden="true" /> : <span className="lv-dot-live" aria-hidden="true" />}
        <span className="lv-head__kt">{paused ? 'Votação pausada' : 'Votação do chat'}</span>
      </span>
      <span className="lv-head__t">{round.title}</span>
    </div>
  )
}

/** Por que a opção venceu (faixa e palco): votos, presente que decide, desempate ou sorteio. */
export function outcomeWhy(round: Round, outcome: Outcome): string {
  if (outcome.reason === 'instant' && round.decidedBy) return `@${round.decidedBy.user.id} decidiu com ${coinsLabel(round.decidedBy.coins)}!`
  if (outcome.reason === 'no-votes') return 'Ninguém votou: sorteio'
  if (outcome.reason === 'tie-break')
    return outcome.tieBy === 'coins'
      ? 'Empate nos votos — venceu quem mandou mais moedas'
      : outcome.tieBy === 'voters'
        ? 'Empate nos votos — venceu a opção com mais gente'
        : 'Empate total: decidido no sorteio'
  return `${percents(round)[outcome.winner]}% dos votos`
}

function ResultHead() {
  const result = useLive((s) => s.result)
  if (!result) return null
  const { round, outcome } = result
  const opt = round.options[outcome.winner]
  return (
    <div className="lv-head is-result" style={{ ['--oc' as string]: OPTION_COLORS[outcome.winner] }}>
      <span className="lv-head__k">
        <Sparkles size={13} aria-hidden="true" /> <span className="lv-head__kt">O chat decidiu</span>
      </span>
      <span className="lv-head__t">
        <b className="lv-head__n">{outcome.winner + 1}</b> {opt?.label}
      </span>
    </div>
  )
}

function StageHead() {
  const stage = useLive((s) => s.stage)
  const creation = useLive((s) => s.creation)
  const announce = useLive((s) => s.announce)
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
  } else if (announce) {
    k = announce.kicker || 'Nasce uma lenda'
    t = announce.title
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
      <span className={cx('lv-head__k', paused && 'is-paused')}>
        <span className="lv-head__kt">{k}</span>
      </span>
      <span className="lv-head__t">{t}</span>
    </div>
  )
}

/** Linha "como participar" da faixa, conforme a fase (votação, disputa, criação, fim de carreira…). */
function HowLine({ round, showResult }: { round: Round | null; showResult: boolean }) {
  const paused = useLiveSession((s) => s.paused)
  const creation = useLive((s) => s.creation)
  const stage = useLive((s) => s.stage)
  const announce = useLive((s) => s.announce)
  const result = useLive((s) => s.result)
  // a linha de votos lê a configuração (presentes, moedas): assina para atualizar quando ela muda
  const creator = useLiveConfig((s) => s.config).creator
  let text: string
  if (round) text = paused ? PAUSED_HOW : howToVote(round.options.length)
  else if (showResult && result) text = outcomeWhy(result.round, result.outcome)
  else if (paused) text = 'A próxima votação começa quando o streamer voltar'
  else if (creation?.phase === 'bidding') text = 'Mande presentes: quem doar mais cria a lenda'
  else if (creation?.phase === 'creating') text = creation.winner ? `Só @${creation.winner.user.id} digita: !nome · !pais · !posicao` : 'O vencedor digita no chat: !nome · !pais · !posicao'
  else if (announce) text = announce.lines[0] ?? 'Cada decisão da carreira será votada pelo chat'
  else if (stage === 'ending') text = creator === 'disputa' ? 'Prepare os presentes para a próxima disputa' : creator === 'apoiador' ? 'Quem mais doou nesta carreira cria a próxima lenda' : 'Na próxima lenda, o chat vota de novo'
  else text = 'Cada decisão da carreira é votada aqui: comentários e presentes'
  return <p className={cx('lv-hud__how', paused && 'is-paused')}>{text}</p>
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
        <b>{item.user?.name}</b>
        <span className="lv-feed__rest">mandou {item.text}</span>
        {item.option != null ? (
          <span className="lv-feed__opt" style={{ ['--oc' as string]: OPTION_COLORS[item.option] }}>
            → {item.option + 1}
          </span>
        ) : (
          item.held != null && <span className="lv-feed__opt is-held">comente {item.held > 1 ? `1 a ${item.held}` : '1'}</span>
        )}
      </>
    )
  if (item.kind === 'result')
    return (
      <>
        <Sparkles size={14} aria-hidden="true" /> Decidido: <b>{item.text}</b>
      </>
    )
  if (item.kind === 'info')
    return (
      <>
        <span className="lv-feed__rest">{item.text}</span>
        {item.option != null && (
          <span className="lv-feed__opt" style={{ ['--oc' as string]: OPTION_COLORS[item.option] }}>
            → {item.option + 1}
          </span>
        )}
      </>
    )
  return (
    <>
      <b>{item.user?.name}</b>
      <span className="lv-feed__rest">{item.text}</span>
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

/** Abre a configuração numa aba nova: a janela da live (capturada) nunca mostra a página de configuração no ar. */
export function openLiveSettings() {
  const w = window.open(`${location.origin}${location.pathname}#/live`, '_blank')
  w?.focus()
}

/**
 * Menu do streamer na faixa. Na janela que roda a live, age aqui; numa janela "painel" (a live roda em
 * outra), cada ação vai como comando para a janela da live.
 */
function HudMenu({ leader }: { leader: boolean }) {
  const [open, setOpen] = useState(false)
  const localPaused = useLiveSession((s) => s.paused)
  const round = useLive((s) => s.round)
  const creation = useLive((s) => s.creation)
  const stage = useLive((s) => s.stage)
  const creator = useLiveConfig((s) => s.config.creator)
  const active = useCareer(selectHasActiveCareer)
  const surname = useCareer((s) => s.state?.identity.surname)
  const now = useNow(open && !leader, 1000)
  const holder = leader ? null : lockHolder(now)
  const sum = holder?.summary ?? null
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
    setOpen(false)
    fn()
  }
  const paused = leader ? localPaused : !!sum?.paused
  const phase = leader ? creation?.phase : sum?.creation?.phase
  const canClose = leader ? !!(round || creation) : !!(sum?.round || sum?.creation)
  const busy = leader ? stage === 'identity' : sum?.stage === 'identity'
  const careerName = leader ? (active ? surname : null) : sum?.career
  const togglePause = () => (leader ? useLiveSession.getState().setPaused(!paused) : sendLiveCommand(paused ? 'resume' : 'pause'))
  const closeVote = () => (leader ? useLive.getState().closeNow() : sendLiveCommand('close-vote'))
  const newLegend = () => {
    if (!confirmNewLegend(careerName)) return
    if (leader) newLegendNow()
    else sendLiveCommand('new-legend')
  }
  return (
    <div className="lv-menu" ref={ref}>
      <button type="button" className="lv-menu__btn" aria-label="Controles da live" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Settings2 size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="lv-menu__pop" role="menu">
          {!leader && <p className="lv-menu__note">{holder?.where === 'obs' ? 'A live roda no OBS: estes comandos vão para lá.' : 'A live roda em outra janela: estes comandos vão para ela.'}</p>}
          <button type="button" role="menuitem" onClick={act(togglePause)}>
            {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Retomar votações' : 'Pausar votações'}
          </button>
          <button type="button" role="menuitem" disabled={!canClose} onClick={act(closeVote)}>
            <SkipForward size={15} /> {phase === 'bidding' ? 'Encerrar a disputa agora' : phase === 'creating' ? 'Encerrar a criação agora' : 'Encerrar a votação agora'}
          </button>
          <button type="button" role="menuitem" disabled={busy} onClick={act(newLegend)}>
            <Sparkles size={15} /> {NEW_LEGEND_LABEL[creator]}
          </button>
          <button type="button" role="menuitem" onClick={act(openLiveSettings)}>
            <Settings2 size={15} /> Configurações da live (nova aba)
          </button>
          <button type="button" role="menuitem" className="is-danger" onClick={act(() => (leader ? requestStop() : useLiveSession.getState().stop()))}>
            <Square size={15} /> {leader ? 'Sair do modo live' : 'Fechar este painel'}
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
  // no palco o cartão grande já explica como participar: a faixa não repete a linha
  const onStage = useApp((s) => s.route.path === '/live')
  const now = useNow(!!result && !round, 500)
  const showResult = !round && !!result && now - result.at < 4500
  // só a janela que roda a live é capturada: é nela que a faixa respeita a área segura do TikTok
  useSafeArea(leader)
  if (!leader) {
    // a live roda noutra janela deste navegador ou no OBS (pela ponte)
    const obs = lockHolder()?.where === 'obs'
    return (
      <header ref={ref} className="lv-hud is-follower" role="region" aria-label="Live interativa">
        <div className="lv-hud__row">
          <LiveBadge />
          <div className="lv-head">
            <span className="lv-head__k">
              <span className="lv-head__kt">Painel</span>
            </span>
            <span className="lv-head__t">{obs ? 'A live está rodando no OBS' : 'A live está rodando em outra janela'}</span>
          </div>
          <HudMenu leader={false} />
        </div>
        <p className="lv-hud__how">Esta aba não vai ao ar: use o menu para comandar {obs ? 'a live do OBS' : 'a janela da live'}, ou feche-a.</p>
      </header>
    )
  }
  const decision = round?.kind === 'decision' ? round : null
  const penalty = isPenaltyRound(decision)
  return (
    <header ref={ref} className={cx('lv-hud', round && 'is-voting', decision && (penalty ? 'is-penalty' : 'is-decision'), paused && 'is-paused', onStage && 'is-stage')} role="region" aria-label="Live interativa">
      <div className="lv-hud__row">
        <LiveBadge />
        {round ? <RoundHead round={round} paused={paused} /> : showResult ? <ResultHead /> : <StageHead />}
        {round && <Countdown endsAt={round.endsAt} total={round.endsAt - round.startedAt} paused={paused} />}
        <HudMenu leader />
      </div>
      {!onStage && <HowLine round={round} showResult={showResult} />}
      {/* a linha do placar fica sempre montada (vazia fora das votações): a faixa não muda de altura a cada voto */}
      {decision ? <Legend round={decision} /> : !onStage && <LegendSlot />}
      <div className="lv-hud__foot">
        <FeedLine />
        <TopFans />
        <Likes />
      </div>
    </header>
  )
}

function LegendSlot() {
  return (
    <div className="lv-legend is-slot" aria-hidden="true">
      <div className="lv-tug" />
    </div>
  )
}
