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
 * O streamer pode pausar (as votações congelam) ou clicar numa opção ele mesmo (a votação é cancelada).
 */
import type { Decision, PlayerIdentity, Position } from '@/engine/types'
import { POSITION_NAMES } from '@/engine/career/util'
import { navigate, useApp } from '@/store/app'
import { useCareer } from '@/store/career'
import { getClub, getCountry } from '@/store/data'
import { penaltyTargets, isPenaltyDecision } from '@/ui/classic/decision/PenaltyMinigame'
import { director } from '@/ui/classic/reveal/director'
import { useReveal } from '@/ui/classic/reveal/store'
import { useLiveConfig, useLiveSession } from './config'
import { NUMBER_BY_POSITION, POSITION_CHOICES, cleanFixed, footFor, nationChoices, randomSurname, surnameFromNick, type CreatorDraft } from './identity'
import { topBids, topSupporters, useLive, type Bid, type RoundSpec } from './store'
import type { LiveUser } from './types'

type Side = 'left' | 'center' | 'right'
interface Pick {
  optionId: string
  side?: Side
}

const SIDE_LABEL: Record<Side, string> = { left: 'Canto esquerdo', center: 'No meio', right: 'Canto direito' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Rótulos curtos das opções (nome do clube, da ação ou do canto) + o que cada voto escolhe de fato. */
export function decisionRound(d: Decision): { spec: RoundSpec; picks: Pick[] } {
  if (isPenaltyDecision(d)) {
    const { targets, others } = penaltyTargets(d)
    const picks: Pick[] = [...targets.map((t) => ({ optionId: t.option.id, side: t.side })), ...others.map((o) => ({ optionId: o.id }))].slice(0, 4)
    const options = [
      ...targets.map((t) => ({ id: `${t.option.id}:${t.side}`, label: SIDE_LABEL[t.side], ...(t.p != null ? { sub: `${Math.round(t.p * 100)}% de chance` } : {}) })),
      ...others.map((o) => ({ id: o.id, label: o.title ?? o.label })),
    ].slice(0, 4)
    return { spec: { id: `d:${d.id}`, kind: 'decision', title: d.title, options }, picks }
  }
  const opts = d.options.slice(0, 4)
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
 * ao topo); no computador ela fica na coluna da esquerda e pode estar abaixo da dobra.
 */
function showDecision() {
  setTimeout(() => {
    const el = document.querySelector('.ck-decision')
    if (el && matchMedia('(min-width: 69rem)').matches) {
      const r = el.getBoundingClientRect()
      if (r.bottom > innerHeight || r.top < 0) el.scrollIntoView({ block: 'end', behavior: 'smooth' })
    } else window.scrollTo({ top: 0, behavior: 'smooth' })
  }, 350)
}

let running = false
let timer: ReturnType<typeof setInterval> | null = null
let decisionFor: string | null = null
let celebTimer: ReturnType<typeof setTimeout> | null = null
let endTimer: ReturnType<typeof setTimeout> | null = null
let identityBusy = false
let legends = 0

const onStage = () => {
  const r = useApp.getState().route
  return r.path === '/carreira' || (r.path === '/live' && r.query.tela === 'palco')
}

function clearEnd() {
  if (endTimer) clearTimeout(endTimer)
  endTimer = null
  useLive.setState({ nextCareerAt: null })
}

/** Nome da próxima lenda conforme a configuração. */
function legendName(): { surname: string; honoree?: LiveUser } {
  const cfg = useLiveConfig.getState().config
  const seed = Date.now() + legends
  if (cfg.nameMode === 'fixo') return { surname: cleanFixed(cfg.fixedName) ?? randomSurname(seed) }
  if (cfg.nameMode === 'apoiador') {
    const live = useLive.getState()
    const pool = [...topSupporters(live.careerSupporters, 5), ...topSupporters(live.supporters, 5)]
    for (const s of pool) {
      const n = surnameFromNick(s.user.name) ?? surnameFromNick(s.user.id)
      if (n) return { surname: n, honoree: s.user }
    }
  }
  return { surname: randomSurname(seed) }
}

const sessionOn = () => running && useLiveSession.getState().on

/** Espera `done()` (checa a cada 200 ms); false se a live parou no meio. */
async function waitUntil(done: () => boolean): Promise<boolean> {
  while (sessionOn() && !done()) await sleep(200)
  return sessionOn()
}

/** Disputa: quem doar mais em N segundos ganha o direito de criar a lenda. */
async function runBidding(): Promise<Bid | null> {
  const cfg = useLiveConfig.getState().config
  useLive.getState().startBidding(cfg.bidSeconds)
  const ok = await waitUntil(() => {
    const c = useLive.getState().creation
    return !c || Date.now() >= c.endsAt
  })
  const top = topBids(useLive.getState().creation, 1)[0]
  if (!ok) return null
  if (!top || top.coins < Math.max(1, cfg.minBidCoins)) {
    useLive.getState().endCreation()
    useLive.getState().pushInfo('Ninguém doou na disputa: o chat escolhe a nova lenda')
    return null
  }
  return top
}

/** O vencedor digita nome, país e posição no chat (só as mensagens dele contam). */
async function runCreation(winner: Bid): Promise<CreatorDraft | null> {
  const cfg = useLiveConfig.getState().config
  useLive.getState().startCreating(winner, cfg.createSeconds)
  let readyAt = 0
  const ok = await waitUntil(() => {
    const c = useLive.getState().creation
    if (!c) return true
    const d = c.draft
    if (d.surname && d.nationality && d.position) {
      // tudo escolhido: um instante para a galera ver a ficha completa
      readyAt ||= Date.now() + 2500
      return Date.now() >= readyAt
    }
    return Date.now() >= c.endsAt
  })
  return ok ? (useLive.getState().creation?.draft ?? {}) : null
}

/** Maior apoiador da carreira que acabou (ou da live), para o modo "apoiador". */
function topSupporterBid(): Bid | null {
  const live = useLive.getState()
  const s = topSupporters(live.careerSupporters, 1)[0] ?? topSupporters(live.supporters, 1)[0]
  return s && s.coins > 0 ? { user: s.user, coins: s.coins, at: s.at } : null
}

/** Votação de posição (quando ninguém escolheu). */
async function votePosition(): Promise<Position | null> {
  const out = await useLive.getState().startRound({ id: `id:pos:${Date.now()}`, kind: 'identity', title: 'Qual vai ser a posição da nova lenda?', options: POSITION_CHOICES.map((p) => ({ id: p.id, label: p.label })) })
  if (!out || !sessionOn()) return null
  await sleep(1800)
  return POSITION_CHOICES[out.winner].id
}

async function voteNationality(): Promise<string | null> {
  const codes = nationChoices(Date.now() + legends, (c) => !!getCountry(c))
  const out = await useLive.getState().startRound({ id: `id:nat:${Date.now()}`, kind: 'identity', title: 'E a nacionalidade?', options: codes.map((c) => ({ id: c, label: getCountry(c)?.name ?? c })) })
  if (!out || !sessionOn()) return null
  await sleep(1800)
  return codes[out.winner]
}

/**
 * Nova lenda: disputa → criação pelo vencedor (ou maior apoiador) → o chat vota o que faltou → anúncio →
 * carreira. No modo "votação", o chat vota posição e nacionalidade e o nome vem do maior apoiador.
 */
async function runIdentity() {
  if (identityBusy) return
  identityBusy = true
  clearEnd()
  const cfg = useLiveConfig.getState().config
  useLive.setState({ stage: 'identity', announce: null })
  navigate('/live', { query: { tela: 'palco' } })
  try {
    legends++
    let draft: CreatorDraft = {}
    let creator: Bid | null = null
    if (cfg.creator !== 'votacao') {
      creator = cfg.creator === 'apoiador' ? topSupporterBid() : await runBidding()
      if (!sessionOn()) return
      if (creator) {
        const d = await runCreation(creator)
        if (!d) return
        draft = d
      }
      useLive.getState().endCreation()
    }
    let position: Position = draft.position ?? POSITION_CHOICES[legends % POSITION_CHOICES.length].id
    if (!draft.position && cfg.identityVote) {
      const p = await votePosition()
      if (!p) return
      position = p
    }
    let nationality = draft.nationality ?? 'BRA'
    if (!draft.nationality && cfg.identityVote) {
      const n = await voteNationality()
      if (!n) return
      nationality = n
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
    const identity: PlayerIdentity = { surname, number, foot: footFor(Date.now()), nationality, position }
    const country = getCountry(nationality)?.name ?? nationality
    const credit = creator
      ? cfg.creator === 'apoiador'
        ? `Criada por @${creator.user.id}, maior apoiador da última carreira!`
        : `Criada por @${creator.user.id}, que venceu a disputa com ${creator.coins} moedas!`
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
      },
    })
    await sleep(5000)
    if (!sessionOn()) return
    await useCareer.getState().start(identity, cfg.pace)
    useLive.getState().resetCareerSupporters()
    useLive.setState({ announce: null, stage: 'career' })
    decisionFor = null
    navigate('/carreira')
  } catch (err) {
    console.error('[LENDA live] falha ao criar a lenda', err)
    useLive.getState().pushInfo('Não deu para criar a lenda — tentando de novo')
  } finally {
    useLive.getState().endCreation()
    identityBusy = false
  }
}

async function tick() {
  if (!running) return
  const session = useLiveSession.getState()
  if (!session.on || session.paused || identityBusy) return
  const c = useCareer.getState()
  if (c.status !== 'ready' || c.isFixture) return
  if (!onStage()) return
  const live = useLive.getState()
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
    const secs = useLiveConfig.getState().config.nextCareerSeconds
    if (secs > 0 && !endTimer) {
      useLive.setState({ nextCareerAt: Date.now() + secs * 1000 })
      endTimer = setTimeout(() => {
        endTimer = null
        if (useLiveSession.getState().on) void runIdentity()
      }, secs * 1000)
    }
    return
  }
  if (live.stage !== 'career') useLive.setState({ stage: 'career' })
  if (useApp.getState().route.path !== '/carreira') {
    navigate('/carreira')
    return
  }

  // comemoração aberta: deixa a galera ver e segue
  if (r.celebrationOpen) {
    if (!celebTimer)
      celebTimer = setTimeout(() => {
        celebTimer = null
        if (useReveal.getState().celebrationOpen) director.dismissCelebration()
      }, useLiveConfig.getState().config.celebrationSeconds * 1000)
    return
  }

  const d = st.pendingDecision
  // o streamer escolheu na mão (ou a decisão mudou): cancela a votação antiga
  if (live.round?.kind === 'decision' && live.round.id !== `d:${d?.id}`) live.cancelRound()
  if (!d || r.phase !== 'idle' || c.busy || live.round || decisionFor === d.id) return
  decisionFor = d.id
  useReveal.setState({ sheetCollapsed: false })
  showDecision()
  const { spec, picks } = decisionRound(d)
  const outcome = await live.startRound(spec)
  if (!outcome) {
    decisionFor = null
    return
  }
  // mostra o vencedor um instante antes de simular
  await sleep(1500)
  const now = useCareer.getState().state?.pendingDecision
  if (!running || now?.id !== d.id || useReveal.getState().phase !== 'idle') return
  const p = picks[outcome.winner] ?? picks[0]
  void director.pick(p.optionId, p.side ? { side: p.side } : {})
}

export function startAutopilot() {
  if (running) return
  running = true
  decisionFor = null
  timer = setInterval(() => void tick(), 400)
}

export function stopAutopilot() {
  running = false
  if (timer) clearInterval(timer)
  timer = null
  if (celebTimer) clearTimeout(celebTimer)
  celebTimer = null
  clearEnd()
  useLive.getState().cancelRound()
  useLive.getState().endCreation()
  useLive.setState({ stage: 'idle', announce: null })
  identityBusy = false
}

/** O streamer pediu uma nova lenda agora (botão no painel). */
export function newLegendNow() {
  void runIdentity()
}
