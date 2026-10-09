/**
 * Autopiloto do Modo Clássico durante a live: o chat decide, o jogo anda sozinho.
 *
 *   sem carreira / carreira encerrada → palco (#/live?tela=palco): disputa (quem doar mais cria a lenda:
 *                                       nome, país e posição por comandos no chat) ou votação do chat
 *                                       → carreira começa
 *   decisão pendente                  → votação (comentários + presentes) → escolha automática
 *   comemoração de título             → fica N s na tela e segue
 *   fim de carreira                   → tela final por N s (com os maiores apoiadores) → nova lenda
 *
 * O streamer pode pausar (as votações, a disputa, a contagem do fim de carreira e a comemoração congelam)
 * ou clicar numa opção ele mesmo (a votação é cancelada).
 *
 * Cada start/stop do autopiloto abre uma "geração": um fluxo assíncrono antigo (anúncio, espera, votação)
 * que acorde depois de um stop + start não age sobre a sessão nova.
 */
import type { Decision, PlayerIdentity, Position } from '@/engine/types'
import { POSITION_NAMES } from '@/engine/career/util'
import { navigate, useApp } from '@/store/app'
import { selectHasActiveCareer, useCareer } from '@/store/career'
import { getClub, getCountry } from '@/store/data'
import { penaltyTargets, isPenaltyDecision } from '@/ui/classic/decision/PenaltyMinigame'
import { director } from '@/ui/classic/reveal/director'
import { useReveal } from '@/ui/classic/reveal/store'
import { isCaptureWindow, type StartMode } from './channel'
import { useLiveConfig, useLiveSession } from './config'
import { coinsLabel } from './gifts'
import { NUMBER_BY_POSITION, POSITION_CHOICES, cleanFixed, footFor, nationChoices, randomSurname, surnameFromNick, type CreatorDraft } from './identity'
import { realSource, topBids, topSupporters, useLive, type Bid, type RoundSpec, type Supporter } from './store'
import type { LiveUser } from './types'
import { MAX_OPTIONS, fitOptions } from './votes'

type Side = 'left' | 'center' | 'right'
interface Pick {
  optionId: string
  side?: Side
}

/** Os mesmos nomes das zonas do pênalti na tela (Esquerda · Meio · Direita). */
const SIDE_LABEL: Record<Side, string> = { left: 'Esquerda', center: 'Meio', right: 'Direita' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Rótulos curtos das opções (nome do clube, da ação ou do canto) + o que cada voto escolhe de fato. */
export function decisionRound(d: Decision): { spec: RoundSpec; picks: Pick[] } {
  if (isPenaltyDecision(d)) {
    const { targets, others } = penaltyTargets(d)
    const picks: Pick[] = [...targets.map((t) => ({ optionId: t.option.id, side: t.side })), ...others.map((o) => ({ optionId: o.id }))].slice(0, MAX_OPTIONS)
    const options = [
      ...targets.map((t) => ({ id: `${t.option.id}:${t.side}`, label: SIDE_LABEL[t.side], ...(t.p != null ? { sub: `${Math.round(t.p * 100)}% de chance` } : {}) })),
      ...others.map((o) => ({ id: o.id, label: o.title ?? o.label })),
    ].slice(0, MAX_OPTIONS)
    return { spec: { id: `d:${d.id}`, kind: 'decision', title: d.title, options }, picks }
  }
  // até 4 opções (a tela tem 4 cores/presentes): com mais, ficam "ficar"/"aposentar-se" e as primeiras propostas
  const opts = fitOptions(d.options)
  return {
    spec: {
      id: `d:${d.id}`,
      kind: 'decision',
      title: d.title,
      options: opts.map((o) => {
        const club = o.clubId ? getClub(o.clubId) : undefined
        const name = o.title ?? club?.shortName ?? club?.name ?? o.label
        return { id: o.id, label: name, ...(o.title || club ? { sub: o.label } : {}) }
      }),
    },
    picks: opts.map((o) => ({ optionId: o.id })),
  }
}

/**
 * Deixa a decisão à vista do público: no celular/janela em pé ela é a folha fixa de baixo (basta voltar
 * ao topo); no computador ela fica na coluna da esquerda e pode estar abaixo da dobra. A primeira decisão
 * de cada carreira monta junto com a troca de página: espera a posição assentar (duas leituras iguais).
 */
function showDecision(g: number) {
  if (!matchMedia('(min-width: 69rem)').matches) {
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 350)
    return
  }
  const t0 = Date.now()
  let last: { top: number; bottom: number } | null = null
  const poll = () => {
    if (g !== gen) return
    const el = document.querySelector('.ck-decision')
    if (el) {
      const r = el.getBoundingClientRect()
      if (last && Math.abs(r.top - last.top) < 1 && Math.abs(r.bottom - last.bottom) < 1) {
        if (r.bottom > innerHeight || r.top < 0) el.scrollIntoView({ block: 'end', behavior: 'smooth' })
        return
      }
      last = { top: r.top, bottom: r.bottom }
    } else last = null
    if (Date.now() - t0 < 2500) setTimeout(poll, 150)
  }
  setTimeout(poll, 150)
}

let running = false
/** Muda a cada start/stop: fluxos antigos comparam a sua com esta. */
let gen = 0
let timer: ReturnType<typeof setInterval> | null = null
let decisionFor: string | null = null
/** Comemoração aberta: some neste instante (empurrado enquanto pausado). */
let celebUntil = 0
let identityBusy = false
let legends = 0
/** Pediram uma nova lenda antes de o autopiloto rodar (ex.: botão no painel ao ligar a live). */
let wantNew = false
let lastClock = 0

const onStage = () => {
  const r = useApp.getState().route
  return r.path === '/carreira' || (r.path === '/live' && r.query.tela === 'palco')
}

function clearEnd() {
  useLive.setState({ nextCareerAt: null })
}

/** Numa live de verdade, apoiador de teste (simulador/botões) não conta para dar nome nem criar. */
function eligible(map: Record<string, Supporter>): Record<string, Supporter> {
  if (!realSource()) return map
  return Object.fromEntries(Object.entries(map).filter(([, s]) => !s.sim))
}

/** Nome da próxima lenda conforme a configuração. */
function legendName(): { surname: string; honoree?: LiveUser } {
  const cfg = useLiveConfig.getState().config
  const seed = Date.now() + legends
  if (cfg.nameMode === 'fixo') return { surname: cleanFixed(cfg.fixedName) ?? randomSurname(seed) }
  if (cfg.nameMode === 'apoiador') {
    const live = useLive.getState()
    const pool = [...topSupporters(eligible(live.careerSupporters), 5), ...topSupporters(eligible(live.supporters), 5)]
    for (const s of pool) {
      const n = surnameFromNick(s.user.name) ?? surnameFromNick(s.user.id)
      if (n) return { surname: n, honoree: s.user }
    }
  }
  return { surname: randomSurname(seed) }
}

type Alive = () => boolean
/** Vivo = autopiloto rodando, live ligada e ainda a mesma geração. */
const aliveFor =
  (g: number): Alive =>
  () =>
    running && g === gen && useLiveSession.getState().on

/** Espera `done()` (checa a cada 200 ms); false se a live parou (ou reiniciou) no meio. */
async function waitUntil(done: () => boolean, alive: Alive): Promise<boolean> {
  while (alive() && !done()) await sleep(200)
  return alive()
}

/** Disputa: quem doar mais em N segundos ganha o direito de criar a lenda. `resume` = disputa já aberta. */
async function runBidding(alive: Alive, resume: boolean): Promise<Bid | null> {
  const cfg = useLiveConfig.getState().config
  if (!resume) useLive.getState().startBidding(cfg.bidSeconds)
  const ok = await waitUntil(() => {
    const c = useLive.getState().creation
    return !c || c.phase !== 'bidding' || Date.now() >= c.endsAt
  }, alive)
  if (!ok) return null
  const real = realSource()
  const top = topBids(useLive.getState().creation, 50).filter((b) => !(real && b.sim))[0]
  const min = Math.max(1, cfg.minBidCoins)
  if (!top || top.coins < min) {
    useLive.getState().endCreation()
    const then = cfg.identityVote ? ': o chat escolhe a nova lenda' : ''
    useLive.getState().pushInfo(top ? `Ninguém chegou ao mínimo de ${coinsLabel(min)}${then}` : `Ninguém doou na disputa${then}`)
    return null
  }
  return top
}

/**
 * O vencedor digita nome, país e posição no chat (só as mensagens dele contam). Ficha completa: a store
 * marca `readyAt` (~6 s, reinicia a cada correção; "!ok" começa na hora; congela na pausa).
 */
async function runCreation(winner: Bid, alive: Alive, resume: boolean): Promise<CreatorDraft | null> {
  const cfg = useLiveConfig.getState().config
  if (!resume) useLive.getState().startCreating(winner, cfg.createSeconds)
  const ok = await waitUntil(() => {
    const c = useLive.getState().creation
    if (!c || c.phase !== 'creating') return true
    if (c.readyAt != null && Date.now() >= c.readyAt && !useLiveSession.getState().paused) return true
    return Date.now() >= c.endsAt
  }, alive)
  return ok ? (useLive.getState().creation?.draft ?? {}) : null
}

/** Maior apoiador da carreira que acabou (ou da live), para o modo "apoiador". */
function topSupporterBid(): Bid | null {
  const live = useLive.getState()
  const s = topSupporters(eligible(live.careerSupporters), 1)[0] ?? topSupporters(eligible(live.supporters), 1)[0]
  return s && s.coins > 0 ? { user: s.user, coins: s.coins, at: s.at } : null
}

/** Votação de posição (quando ninguém escolheu). */
async function votePosition(alive: Alive): Promise<Position | null> {
  const out = await useLive.getState().startRound({ id: `id:pos:${Date.now()}`, kind: 'identity', title: 'Qual vai ser a posição da nova lenda?', options: POSITION_CHOICES.map((p) => ({ id: p.id, label: p.label })) })
  if (!out || !alive()) return null
  await sleep(1800)
  return alive() ? POSITION_CHOICES[out.winner].id : null
}

async function voteNationality(alive: Alive): Promise<string | null> {
  const codes = nationChoices(Date.now() + legends, (c) => !!getCountry(c))
  const out = await useLive.getState().startRound({ id: `id:nat:${Date.now()}`, kind: 'identity', title: 'E a nacionalidade?', options: codes.map((c) => ({ id: c, label: getCountry(c)?.name ?? c })) })
  if (!out || !alive()) return null
  await sleep(1800)
  return alive() ? codes[out.winner] : null
}

/**
 * Nova lenda: disputa → criação pelo vencedor (ou maior apoiador) → o chat vota o que faltou → anúncio →
 * carreira. No modo "votação", o chat vota posição e nacionalidade e o nome vem do maior apoiador.
 *
 * Retoma depois de recarregar a página: disputa/criação abertas, ficha já decidida (pendingLegend) ou o
 * anúncio (com a identidade) voltam da sessionStorage e o fluxo segue dali.
 */
async function runIdentity() {
  if (identityBusy) return
  identityBusy = true
  const g = gen
  const alive = aliveFor(g)
  const live0 = useLive.getState()
  // "Nova lenda" no meio de uma votação de decisão: a votação antiga morre aqui (senão o fluxo dela
  // acordaria depois e escolheria na carreira velha)
  if (live0.round) live0.cancelRound()
  decisionFor = null
  celebUntil = 0
  clearEnd()
  const cfg = useLiveConfig.getState().config
  const resumeCreation = live0.creation
  const resumePending = live0.pendingLegend
  const resumeAnnounce = live0.announce?.identity ? live0.announce : null
  useLive.setState({ stage: 'identity', ...(resumeAnnounce ? {} : { announce: null }) })
  navigate('/live', { query: { tela: 'palco' } })
  try {
    let identity: PlayerIdentity
    if (resumeAnnounce?.identity) {
      identity = resumeAnnounce.identity
      await sleep(Math.max(0, Math.min(5000, resumeAnnounce.until - Date.now())))
      if (!alive()) return
    } else {
      legends++
      let draft: CreatorDraft = {}
      let creator: Bid | null = null
      if (resumePending) {
        draft = resumePending.draft
        creator = resumePending.creator
      } else if (resumeCreation || cfg.creator !== 'votacao') {
        if (resumeCreation?.phase === 'creating' && resumeCreation.winner) creator = resumeCreation.winner
        else creator = !resumeCreation && cfg.creator === 'apoiador' ? topSupporterBid() : await runBidding(alive, resumeCreation?.phase === 'bidding')
        if (!alive()) return
        if (creator) {
          const d = await runCreation(creator, alive, resumeCreation?.phase === 'creating')
          if (!d) return
          draft = d
        }
        // ficha guardada: se a página recarregar durante as votações, o criador não perde o que escolheu
        useLive.setState({ pendingLegend: { draft, creator } })
        useLive.getState().endCreation()
      }
      let position: Position = draft.position ?? POSITION_CHOICES[legends % POSITION_CHOICES.length].id
      if (!draft.position && cfg.identityVote) {
        const p = await votePosition(alive)
        if (!p) return
        position = p
        draft = { ...draft, position }
        useLive.setState({ pendingLegend: { draft, creator } })
      }
      let nationality = draft.nationality ?? 'BRA'
      if (!draft.nationality && cfg.identityVote) {
        const n = await voteNationality(alive)
        if (!n) return
        nationality = n
        draft = { ...draft, nationality }
        useLive.setState({ pendingLegend: { draft, creator } })
      }
      let surname: string
      let honoree: LiveUser | undefined
      if (creator) {
        surname = draft.surname ?? surnameFromNick(creator.user.name) ?? surnameFromNick(creator.user.id) ?? randomSurname(Date.now())
        honoree = creator.user
      } else {
        ;({ surname, honoree } = legendName())
      }
      const number = NUMBER_BY_POSITION[position]
      identity = { surname, number, foot: footFor(Date.now()), nationality, position }
      const country = getCountry(nationality)?.name ?? nationality
      const credit = creator
        ? cfg.creator === 'apoiador'
          ? `Criada por @${creator.user.id}, maior apoiador da última carreira!`
          : `Criada por @${creator.user.id}, que venceu a disputa com ${coinsLabel(creator.coins)}!`
        : honoree
          ? `Nome em homenagem a @${honoree.id}, maior apoiador!`
          : 'Cada decisão da carreira será votada pelo chat.'
      useLive.setState({
        announce: {
          kicker: 'Nasce uma lenda',
          title: surname,
          lines: [`${POSITION_NAMES[position]} · ${country} · camisa ${number}`, credit],
          ...(honoree ? { honoree } : {}),
          until: Date.now() + 5000,
          identity,
        },
        pendingLegend: null,
      })
      await sleep(5000)
      if (!alive()) return
    }
    await useCareer.getState().start(identity, cfg.pace)
    if (g !== gen) return
    // nenhuma escolha pendurada da carreira anterior pode passar para a nova
    director.reset()
    useLive.getState().resetCareerSupporters()
    useLive.setState({ announce: null, stage: 'career', pendingLegend: null })
    decisionFor = null
    navigate('/carreira')
  } catch (err) {
    console.error('[LENDA live] falha ao criar a lenda', err)
    useLive.setState({ announce: null, pendingLegend: null })
    useLive.getState().pushInfo('Não deu para criar a lenda — tentando de novo')
  } finally {
    // um fluxo de uma geração antiga não mexe na sessão nova (nem na disputa que ela abriu)
    if (g === gen) {
      useLive.getState().endCreation()
      identityBusy = false
    }
  }
}

async function tick() {
  if (!running) return
  const g = gen
  const session = useLiveSession.getState()
  if (!session.on || session.paused || identityBusy) return
  const live = useLive.getState()
  // nova lenda pedida antes de o autopiloto rodar, ou disputa/ficha/anúncio retomados depois de recarregar
  if (wantNew || live.creation || live.pendingLegend || live.announce?.identity) {
    wantNew = false
    void runIdentity()
    return
  }
  const c = useCareer.getState()
  if (c.status !== 'ready' || c.isFixture) return
  if (!onStage()) return
  const st = c.state
  const r = useReveal.getState()

  // fim de carreira (ou nenhuma carreira): tela final e depois uma nova lenda
  if (!st || st.phase === 'finished' || st.retired) {
    if (!st) {
      void runIdentity()
      return
    }
    if (r.phase !== 'idle') return
    if (useApp.getState().route.path !== '/carreira') {
      // já no palco sem votação (ex.: recarregou a página): segue para a próxima lenda
      void runIdentity()
      return
    }
    if (live.stage !== 'ending') {
      useLive.setState({ stage: 'ending' })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    // contagem para a próxima carreira: fica na store (a tela mostra) e congela na pausa (clock())
    const secs = useLiveConfig.getState().config.nextCareerSeconds
    if (secs > 0) {
      const at = live.nextCareerAt
      if (!at) useLive.setState({ nextCareerAt: Date.now() + secs * 1000 })
      else if (Date.now() >= at) void runIdentity()
    }
    return
  }
  if (live.stage !== 'career') useLive.setState({ stage: 'career' })
  if (useApp.getState().route.path !== '/carreira') {
    navigate('/carreira')
    return
  }

  // comemoração aberta: deixa a galera ver e segue (o tempo congela na pausa)
  if (r.celebrationOpen) {
    if (!celebUntil) celebUntil = Date.now() + useLiveConfig.getState().config.celebrationSeconds * 1000
    else if (Date.now() >= celebUntil) {
      celebUntil = 0
      director.dismissCelebration()
    }
    return
  }
  celebUntil = 0

  const d = st.pendingDecision
  // o streamer escolheu na mão (ou a decisão mudou): cancela a votação antiga
  if (live.round?.kind === 'decision' && live.round.id !== `d:${d?.id}`) live.cancelRound()
  if (!d || r.phase !== 'idle' || c.busy || live.round || decisionFor === d.id) return
  decisionFor = d.id
  useReveal.setState({ sheetCollapsed: false })
  showDecision(g)
  const { spec, picks } = decisionRound(d)
  const outcome = await live.startRound(spec)
  if (!outcome) {
    if (decisionFor === d.id) decisionFor = null
    return
  }
  // mostra o vencedor um instante antes de simular
  await sleep(1500)
  const now = useCareer.getState().state?.pendingDecision
  // "Nova lenda" / stop / saiu da tela da carreira nesse meio-tempo: não escolhe nada
  if (g !== gen || !running || identityBusy || useApp.getState().route.path !== '/carreira' || now?.id !== d.id || useReveal.getState().phase !== 'idle') return
  const p = picks[outcome.winner] ?? picks[0]
  void director.pick(p.optionId, p.side ? { side: p.side } : {})
}

/** Relógio do autopiloto: na pausa empurra a contagem do fim de carreira e a da comemoração. */
function clock() {
  const now = Date.now()
  const dt = lastClock ? now - lastClock : 0
  lastClock = now
  if (dt > 0 && useLiveSession.getState().paused) {
    const at = useLive.getState().nextCareerAt
    if (at) useLive.setState({ nextCareerAt: at + dt })
    if (celebUntil) celebUntil += dt
  }
  void tick()
}

export function startAutopilot() {
  if (running) return
  running = true
  gen++
  decisionFor = null
  celebUntil = 0
  identityBusy = false
  lastClock = 0
  // disputa/criação retomadas depois de recarregar: o relógio delas volta a andar
  useLive.getState().resumeClock()
  timer = setInterval(clock, 400)
}

export function stopAutopilot() {
  running = false
  gen++
  if (timer) clearInterval(timer)
  timer = null
  celebUntil = 0
  identityBusy = false
  clearEnd()
  useLive.getState().cancelRound()
  if (!useLiveSession.getState().on) {
    // a live acabou de verdade. Com ela ainda ligada (a janela só perdeu a vez ou o React remontou),
    // a disputa, a ficha e o anúncio ficam para o próximo start retomar.
    wantNew = false
    useLive.getState().endCreation()
    useLive.setState({ stage: 'idle', announce: null, pendingLegend: null })
  }
}

/** O streamer pediu uma nova lenda agora (painel / faixa). Antes de o autopiloto rodar, fica na fila. */
export function newLegendNow() {
  if (!running) {
    wantNew = true
    return
  }
  void runIdentity()
}

/**
 * Começa a live NESTA janela. 'continue' segue a carreira salva (ou cria uma se não houver); 'new' abre
 * uma nova lenda (disputa / maior apoiador / votação, conforme a configuração).
 */
export function requestStart(mode: StartMode) {
  const session = useLiveSession.getState()
  if (mode === 'new') newLegendNow()
  else wantNew = false
  if (!session.on) session.start()
  else if (session.paused) session.setPaused(false)
  const toCareer = mode === 'continue' && selectHasActiveCareer(useCareer.getState())
  if (toCareer) navigate('/carreira')
  else navigate('/live', { query: { tela: 'palco' } })
}

/**
 * Para a live nesta janela. A janela da live (a capturada pelo LIVE Studio) volta para a tela "A live já vai
 * começar!" — sem isso ela ficaria no ar mostrando o Modo Clássico comum, com a barra do jogo.
 */
export function requestStop() {
  useLiveSession.getState().stop()
  if (isCaptureWindow()) navigate('/live', { query: { tela: 'palco' } })
}
