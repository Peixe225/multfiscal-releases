/**
 * Simulador de público: testa a live sem estar ao vivo (e é o único modo que funciona dentro do claude.ai).
 *
 *   startSimulator()          // espectadores de mentira comentando números, mandando rosas, curtindo
 *   simGift('Rose', 3)        // botões de teste
 *   simChat('2')
 *
 * Todo evento daqui vai marcado como simulado (numa live de verdade ele vota, mas não vira apoiador).
 * Num painel (a live roda em outra janela), os botões de teste mandam o evento para a janela da live;
 * o público automático só roda na janela da live.
 */
import { lockHolder, sendLiveSim } from './channel'
import { useLiveConfig } from './config'
import { FALLBACK_GIFTS, giftMeta } from './gifts'
import { useLive } from './store'
import type { LiveEvent, LiveUser } from './types'

const HANDLES = [
  'gabi.fut', 'rafa_10', 'joaozinho.fc', 'mari.gol', 'pedrinho_vasco', 'lu.tricolor', 'bia_verdao', 'caio.mengao', 'nanda_timao',
  'dudu.peixe', 'leo.inter', 'gui.gremio', 'tati_galo', 'vini.raposa', 'carol.bahea', 'fefe.sport', 'theo_furacao', 'manu.coxa',
  'arthur.ceara', 'isa.fortaleza', 'davi.botafogo', 'lara.flu', 'bento.santos', 'nina.saopaulo', 'enzo.palmeiras', 'alice.goiás',
]

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]

function viewer(): LiveUser {
  const h = pick(HANDLES)
  return { id: h, name: h.replace(/[._]/g, ' ').replace(/(^|\s)(\S)/g, (_, a: string, c: string) => a + c.toUpperCase()) }
}

const ME: LiveUser = { id: 'voce.teste', name: 'Você (teste)' }

/** 'remote' = a live roda em outra janela e o evento foi para lá. */
export type SimTarget = 'local' | 'remote'

/** Botão de teste: entra na live desta janela ou, num painel, na janela que roda a live. */
export function simEmit(e: LiveEvent): SimTarget {
  if (lockHolder()) {
    sendLiveSim(e)
    return 'remote'
  }
  useLive.getState().ingest(e, { sim: true })
  return 'local'
}

function giftEvent(name: string, count: number, user: LiveUser): LiveEvent {
  const meta = giftMeta(name) ?? FALLBACK_GIFTS[0]
  const catalog = useLive.getState().catalog.find((g) => g.name === name)
  return { type: 'gift', user, gift: catalog ?? { id: meta.id, name: meta.name, coins: meta.coins }, count, at: Date.now() }
}

export function simGift(name: string, count = 1, user: LiveUser = ME): SimTarget {
  return simEmit(giftEvent(name, count, user))
}

export function simChat(text: string, user: LiveUser = ME): SimTarget {
  return simEmit({ type: 'chat', user, text, at: Date.now() })
}

/** Público automático: sempre local (só roda na janela da live). */
const autoGift = (name: string, count: number, user: LiveUser) => useLive.getState().ingest(giftEvent(name, count, user), { sim: true })
const autoChat = (text: string, user: LiveUser) => useLive.getState().ingest({ type: 'chat', user, text, at: Date.now() }, { sim: true })
const autoEvent = (e: LiveEvent) => useLive.getState().ingest(e, { sim: true })

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
  if (!d.surname && !d.nationality && !d.position && Math.random() < 0.3) autoChat(`!criar ${pick(SIM_NAMES)}, ${pick(SIM_COUNTRIES)}, ${pick(SIM_POSITIONS)}`, u)
  else if (!d.surname) autoChat(`!nome ${pick(SIM_NAMES)}`, u)
  else if (!d.nationality) autoChat(`!pais ${pick(SIM_COUNTRIES)}`, u)
  else if (!d.position) autoChat(`!posicao ${pick(SIM_POSITIONS)}`, u)
  // ficha completa: às vezes confirma na hora
  else if (!c.readyAt || Math.random() < 0.5) autoChat('!ok', u)
  return true
}

function step() {
  const cfg = useLiveConfig.getState().config
  const base = cfg.simSpeed === 3 ? 260 : cfg.simSpeed === 2 ? 650 : 1400
  const next = (ms = base * (0.5 + Math.random())) => {
    timer = setTimeout(step, ms)
  }
  // a live roda em outra janela: este é só o painel, o público de teste fica quieto aqui
  if (lockHolder()) return next(1500)
  const live = useLive.getState()
  if (simCreator()) return next(900)
  // disputa: o público de teste dá lances (presentes) para criar a lenda
  if (live.creation?.phase === 'bidding' && Math.random() < 0.6) {
    autoGift(pick(['Rose', 'Rose', 'TikTok', 'Finger Heart', 'Doughnut', 'Perfume']), Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 6) : 1, viewer())
    return next()
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
    autoEvent({ type: 'like', user: u, count: 5 + Math.floor(Math.random() * 40), at: Date.now() })
  } else if (roll < 0.15) {
    autoEvent({ type: Math.random() < 0.7 ? 'follow' : 'share', user: u, at: Date.now() })
  } else if (!n) {
    // sem votação nem disputa aberta: ninguém de mentira manda presente (senão os "apoiadores" de teste
    // se acumulam enquanto a live nem começou)
  } else if (roll < 0.62) {
    autoChat(String(choose() + 1), u)
  } else if (roll < 0.97) {
    const opt = choose()
    const bound = cfg.giftBindings[opt]
    if (bound && Math.random() < 0.75) autoGift(bound, Math.random() < 0.25 ? 2 + Math.floor(Math.random() * 8) : 1, u)
    else {
      // presente "solto": vai para o número que a pessoa comentou
      autoChat(String(opt + 1), u)
      autoGift(pick(['Finger Heart', 'Perfume', 'Doughnut', 'Heart Me']), 1, u)
    }
  } else if (roll < 0.985) {
    autoChat(String(choose() + 1), u)
    autoGift(pick(['Hand Hearts', 'Corgi']), 1, u)
  } else {
    autoChat(String(choose() + 1), u)
    autoGift('Galaxy', 1, u)
  }
  next()
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
