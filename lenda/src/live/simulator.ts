/**
 * Simulador de público: testa a live sem estar ao vivo (e é o único modo que funciona dentro do claude.ai).
 *
 *   startSimulator()          // espectadores de mentira comentando números, mandando rosas, curtindo
 *   simGift('Rose', 3)        // botões de teste
 *   simChat('2')
 */
import { useLiveConfig } from './config'
import { FALLBACK_GIFTS, giftMeta } from './gifts'
import { useLive } from './store'
import type { LiveUser } from './types'

const HANDLES = [
  'gabi.fut', 'rafa_10', 'joaozinho.fc', 'mari.gol', 'pedrinho_vasco', 'lu.tricolor', 'bia_verdao', 'caio.mengao', 'nanda_timao',
  'dudu.peixe', 'leo.inter', 'gui.gremio', 'tati_galo', 'vini.raposa', 'carol.bahea', 'fefe.sport', 'theo_furacao', 'manu.coxa',
  'arthur.ceara', 'isa.fortaleza', 'davi.botafogo', 'lara.flu', 'bento.santos', 'nina.saopaulo', 'enzo.palmeiras', 'alice.goiás',
]

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]

function viewer(): LiveUser {
  const h = pick(HANDLES)
  return { id: h, name: h.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }
}

const ME: LiveUser = { id: 'voce.teste', name: 'Você (teste)' }

export function simGift(name: string, count = 1, user: LiveUser = ME) {
  const meta = giftMeta(name) ?? FALLBACK_GIFTS[0]
  const catalog = useLive.getState().catalog.find((g) => g.name === name)
  useLive.getState().ingest({ type: 'gift', user, gift: catalog ?? { id: meta.id, name: meta.name, coins: meta.coins }, count, at: Date.now() })
}

export function simChat(text: string, user: LiveUser = ME) {
  useLive.getState().ingest({ type: 'chat', user, text, at: Date.now() })
}

let timer: ReturnType<typeof setTimeout> | null = null
/** Cada rodada tem uma "opção da galera" (o público de mentira tem preferência, não é uniforme). */
let favRound = ''
let fav = 0

const SIM_NAMES = ['GABIGOL', 'FENÔMENO', 'PELEZINHO', 'ZICO', 'RAFINHA', 'DUDU', 'MANU', 'TÉO']
const SIM_COUNTRIES = ['Brasil', 'Argentina', 'Portugal', 'França', 'Japão', 'eua']
const SIM_POSITIONS = ['atacante', 'meia', 'goleiro', 'zagueiro', 'ponta', 'volante', 'lateral esquerdo']

/** Vencedor de mentira digitando a ficha aos poucos (às vezes tudo de uma vez). */
function simCreator(): boolean {
  const c = useLive.getState().creation
  if (c?.phase !== 'creating' || !c.winner || !HANDLES.includes(c.winner.user.id)) return false
  if (Math.random() > 0.3) return false
  const u = c.winner.user
  const d = c.draft
  if (!d.surname && !d.nationality && !d.position && Math.random() < 0.3) simChat(`!criar ${pick(SIM_NAMES)}, ${pick(SIM_COUNTRIES)}, ${pick(SIM_POSITIONS)}`, u)
  else if (!d.surname) simChat(`!nome ${pick(SIM_NAMES)}`, u)
  else if (!d.nationality) simChat(`!pais ${pick(SIM_COUNTRIES)}`, u)
  else if (!d.position) simChat(`!posicao ${pick(SIM_POSITIONS)}`, u)
  return true
}

function step() {
  const cfg = useLiveConfig.getState().config
  const live = useLive.getState()
  if (simCreator()) {
    timer = setTimeout(step, 900)
    return
  }
  // disputa: o público de teste dá lances (presentes) para criar a lenda
  if (live.creation?.phase === 'bidding' && Math.random() < 0.6) {
    simGift(pick(['Rose', 'Rose', 'TikTok', 'Finger Heart', 'Doughnut', 'Perfume']), Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 6) : 1, viewer())
    timer = setTimeout(step, (cfg.simSpeed === 3 ? 260 : cfg.simSpeed === 2 ? 650 : 1400) * (0.5 + Math.random()))
    return
  }
  const r = live.round
  const n = r?.options.length ?? 0
  if (r && r.id !== favRound) {
    favRound = r.id
    fav = Math.floor(Math.random() * n)
  }
  const choose = () => (Math.random() < 0.55 ? fav : Math.floor(Math.random() * n))
  const u = viewer()
  const roll = Math.random()
  if (roll < 0.12) {
    useLive.getState().ingest({ type: 'like', user: u, count: 5 + Math.floor(Math.random() * 40), at: Date.now() })
  } else if (roll < 0.15) {
    useLive.getState().ingest({ type: Math.random() < 0.7 ? 'follow' : 'share', user: u, at: Date.now() })
  } else if (n && roll < 0.62) {
    simChat(String(choose() + 1), u)
  } else if (n && roll < 0.97) {
    const opt = choose()
    const bound = cfg.giftBindings[opt]
    if (bound && Math.random() < 0.75) simGift(bound, Math.random() < 0.25 ? 2 + Math.floor(Math.random() * 8) : 1, u)
    else {
      // presente "solto": vai para o número que a pessoa comentou
      simChat(String(opt + 1), u)
      simGift(pick(['Finger Heart', 'Perfume', 'Doughnut', 'Heart Me']), 1, u)
    }
  } else if (roll < 0.985) {
    simGift(pick(['Hand Hearts', 'Corgi']), 1, u)
  } else {
    if (n) simChat(String(choose() + 1), u)
    simGift('Galaxy', 1, u)
  }
  const speed = cfg.simSpeed
  const base = speed === 3 ? 260 : speed === 2 ? 650 : 1400
  timer = setTimeout(step, base * (0.5 + Math.random()))
}

export function startSimulator() {
  stopSimulator()
  timer = setTimeout(step, 500)
}

export function stopSimulator() {
  if (timer) clearTimeout(timer)
  timer = null
}

export const simulatorRunning = () => timer != null
