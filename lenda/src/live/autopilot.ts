/**
 * Autopiloto do Modo Clássico durante a live: o chat decide, o jogo anda sozinho.
 *
 *   sem carreira / carreira encerrada → palco (#/live?tela=palco): o chat vota posição e nacionalidade,
 *                                       o maior apoiador dá nome à lenda → carreira começa
 *   decisão pendente                  → votação (comentários + presentes) → escolha automática
 *   comemoração de título             → fica N s na tela e segue
 *   fim de carreira                   → tela final por N s (com os maiores apoiadores) → nova lenda
 *
 * O streamer pode pausar (as votações congelam) ou clicar numa opção ele mesmo (a votação é cancelada).
 */
import type { Decision, PlayerIdentity } from '@/engine/types'
import { navigate, useApp } from '@/store/app'
import { useCareer } from '@/store/career'
import { getClub, getCountry } from '@/store/data'
import { penaltyTargets, isPenaltyDecision } from '@/ui/classic/decision/PenaltyMinigame'
import { director } from '@/ui/classic/reveal/director'
import { useReveal } from '@/ui/classic/reveal/store'
import { useLiveConfig, useLiveSession } from './config'
import { POSITION_CHOICES, cleanFixed, footFor, nationChoices, randomSurname, surnameFromNick } from './identity'
import { topSupporters, useLive, type RoundSpec } from './store'
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

/** Palco: posição → nacionalidade → anúncio → carreira. */
async function runIdentity() {
  if (identityBusy) return
  identityBusy = true
  clearEnd()
  const live = useLive.getState()
  const cfg = useLiveConfig.getState().config
  useLive.setState({ stage: 'identity', announce: null })
  navigate('/live', { query: { tela: 'palco' } })
  try {
    legends++
    let position = POSITION_CHOICES[0]
    let nationality = 'BRA'
    if (cfg.identityVote) {
      const pos = await live.startRound({ id: `id:pos:${Date.now()}`, kind: 'identity', title: 'Qual vai ser a posição da nova lenda?', options: POSITION_CHOICES.map((p) => ({ id: p.id, label: p.label })) })
      if (!pos || !useLiveSession.getState().on) return
      position = POSITION_CHOICES[pos.winner]
      await sleep(1800)
      const codes = nationChoices(Date.now() + legends, (c) => !!getCountry(c))
      const nat = await useLive.getState().startRound({ id: `id:nat:${Date.now()}`, kind: 'identity', title: 'E a nacionalidade?', options: codes.map((c) => ({ id: c, label: getCountry(c)?.name ?? c })) })
      if (!nat || !useLiveSession.getState().on) return
      nationality = codes[nat.winner]
      await sleep(1800)
    } else {
      position = POSITION_CHOICES[legends % POSITION_CHOICES.length]
    }
    const { surname, honoree } = legendName()
    const identity: PlayerIdentity = { surname, number: position.number, foot: footFor(Date.now()), nationality, position: position.id }
    const country = getCountry(nationality)?.name ?? nationality
    useLive.setState({
      announce: {
        kicker: 'Nasce uma lenda',
        title: surname,
        lines: [`${position.label} · ${country} · camisa ${position.number}`, honoree ? `Nome em homenagem a @${honoree.id}, maior apoiador!` : 'Cada decisão da carreira será votada pelo chat.'],
        ...(honoree ? { honoree } : {}),
        until: Date.now() + 5000,
      },
    })
    await sleep(5000)
    if (!useLiveSession.getState().on) return
    await useCareer.getState().start(identity, cfg.pace)
    useLive.getState().resetCareerSupporters()
    useLive.setState({ announce: null, stage: 'career' })
    decisionFor = null
    navigate('/carreira')
  } catch (err) {
    console.error('[LENDA live] falha ao criar a lenda', err)
    useLive.getState().pushInfo('Não deu para criar a lenda — tentando de novo')
  } finally {
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
  useLive.setState({ stage: 'idle', announce: null })
  identityBusy = false
}

/** O streamer pediu uma nova lenda agora (botão no painel). */
export function newLegendNow() {
  void runIdentity()
}
