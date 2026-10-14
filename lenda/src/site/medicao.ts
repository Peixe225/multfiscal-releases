/**
 * Medição de visitantes do site (POST /lenda/api/e.php — servidor/CONTRATO.md, "medição").
 *
 *   iniciarMedicao({ estadoJogo: () => ({ jogando: true, modo: 'classico' }) })
 *   track('jogo_inicio', 'classico', { ritmo: 'normal' })
 *   track('view', null, { rota: '/hall' })
 *
 * Visitante: UUID v4 em localStorage['lenda:vid'] (o mesmo para sempre neste navegador).
 * Sessão: UUID v4 em sessionStorage['lenda:sid']; parado mais de 30 min (sem evento nem batimento) → sessão nova.
 * Contexto (origem, utm, aparelho, idioma, tela): lido na criação da sessão e mandado em todo envio (o
 * servidor só usa o do primeiro).
 * Fila: envia a cada 10 s, ao juntar 20 eventos, e ao esconder/fechar a aba (sendBeacon). Rede falhou → os
 * eventos voltam para a fila (máx. 200, saem os mais antigos) e vão no próximo envio. Nunca lança erro.
 * Batimento a cada 15 s só com a aba visível; p:1 quando está jogando.
 */
import { apiUrl } from './api'

export type TipoEvento = 'view' | 'hb' | 'jogo_inicio' | 'jogo_fim' | 'partida_fim' | 'gate_ver' | 'gate_fechar' | 'cadastro' | 'login' | 'logout' | 'compartilhar'
export type ModoJogo = 'classico' | 'imersivo' | 'live'

export interface Evento {
  t: TipoEvento
  m?: ModoJogo | null
  d?: Record<string, unknown>
  ts?: number
  /** Só no batimento: 1 = jogando. */
  p?: 0 | 1
}

export interface Contexto {
  ref: string
  utm: { source: string; medium: string; campaign: string }
  dev: 'mobile' | 'tablet' | 'desktop'
  lang: string
  tela: string
}

/** Leitura/escrita de texto que nunca lança (storage bloqueado = memória). */
export interface Armazem {
  get(chave: string): string | null
  set(chave: string, valor: string): void
}

export const CHAVE_VID = 'lenda:vid'
export const CHAVE_SID = 'lenda:sid'
const CHAVE_SID_ULTIMO = 'lenda:sid:ultimo'
const CHAVE_SID_CTX = 'lenda:sid:ctx'

export const FILA_MAX = 200
export const ENVIAR_AO_JUNTAR = 20
export const ENVIO_MS = 10_000
/**
 * Eventos que mexem na conta (servidor/CONTRATO-v3.md §8.6): a partida terminada soma em `partidas_conta` (libera
 * os bônus) e a 1ª do amigo valida a indicação. Vão logo, sem esperar os 10 s — senão o bônus só aparece uma
 * carreira depois e a partida que abriu o convite de conta chegaria ao servidor já com a conta criada.
 */
/**
 * Saem da fila em ~250 ms (não esperam os 10 s): o fim de partida (a 5ª, que abre o convite, vai antes do cadastro)
 * e o início — o servidor só conta a partida "com a conta" se o início chegou pelo menos 20 s antes do fim.
 */
export const ENVIAR_JA: ReadonlySet<TipoEvento> = new Set(['jogo_inicio', 'jogo_fim', 'partida_fim'])
export const ENVIAR_JA_MS = 250
export const BATIMENTO_MS = 15_000
export const SESSAO_OCIOSA_MS = 30 * 60_000
/** O e.php aceita até 16 KB por pedido: cada envio fica abaixo disto. */
export const CORPO_MAX_BYTES = 15_000

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function uuid4(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* contexto inseguro (http fora do localhost) */
  }
  const b = new Uint8Array(16)
  try {
    crypto.getRandomValues(b)
  } catch {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  }
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Armazém sobre localStorage/sessionStorage; se o navegador bloquear, guarda só na memória. */
export function armazem(pegar: () => Storage | undefined): Armazem {
  const mem = new Map<string, string>()
  return {
    get(k) {
      try {
        const s = pegar()
        if (s) return s.getItem(k)
      } catch {
        /* bloqueado */
      }
      return mem.get(k) ?? null
    },
    set(k, v) {
      mem.set(k, v)
      try {
        pegar()?.setItem(k, v)
      } catch {
        /* bloqueado: fica na memória */
      }
    },
  }
}

/** Visitante deste navegador (cria na primeira visita). */
export function obterVisitante(ls: Armazem): string {
  const v = ls.get(CHAVE_VID)
  if (v && UUID_V4.test(v)) return v
  const novo = uuid4()
  ls.set(CHAVE_VID, novo)
  return novo
}

/**
 * Sessão atual: a mesma enquanto houver atividade há menos de 30 min; senão, uma nova (com o contexto de
 * agora). Cada chamada conta como atividade.
 */
export function tocarSessao(ss: Armazem, agora: number, novoCtx: () => Contexto): { sid: string; ctx: Contexto; nova: boolean } {
  const sid = ss.get(CHAVE_SID)
  const ultimo = Number(ss.get(CHAVE_SID_ULTIMO))
  let ctx: Contexto | null = null
  try {
    ctx = JSON.parse(ss.get(CHAVE_SID_CTX) ?? 'null') as Contexto | null
  } catch {
    ctx = null
  }
  const viva = !!sid && UUID_V4.test(sid) && Number.isFinite(ultimo) && ultimo > 0 && agora - ultimo <= SESSAO_OCIOSA_MS && !!ctx && typeof ctx === 'object'
  if (viva) {
    ss.set(CHAVE_SID_ULTIMO, String(agora))
    return { sid: sid!, ctx: ctx!, nova: false }
  }
  const nova = { sid: uuid4(), ctx: novoCtx() }
  ss.set(CHAVE_SID, nova.sid)
  ss.set(CHAVE_SID_ULTIMO, String(agora))
  ss.set(CHAVE_SID_CTX, JSON.stringify(nova.ctx))
  return { ...nova, nova: true }
}

/** Celular / tablet / computador pelo navegador e pela largura da janela. */
export function dispositivo(ua: string, largura: number, toque = 0): Contexto['dev'] {
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet'
  if (/Mobi|iPhone|iPod|Android|IEMobile|Opera Mini|BlackBerry/i.test(ua)) return 'mobile'
  // iPad recente se apresenta como Mac: só a tela de toque denuncia
  if (/Macintosh/i.test(ua) && toque > 1) return 'tablet'
  if (largura > 0 && largura < 640) return 'mobile'
  if (largura > 0 && largura < 1024 && toque > 0) return 'tablet'
  return 'desktop'
}

/** Domínio de quem mandou a visita (sem "www."); vazio quando veio direto ou do próprio site. */
export function dominioDeOrigem(referrer: string, hostAtual: string): string {
  if (!referrer) return ''
  try {
    const h = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '')
    return h === hostAtual.toLowerCase().replace(/^www\./, '') ? '' : h.slice(0, 120)
  } catch {
    return ''
  }
}

export function utmDe(search: string): Contexto['utm'] {
  const q = new URLSearchParams(search)
  const pega = (k: string) => (q.get(`utm_${k}`) ?? '').trim().slice(0, 80)
  return { source: pega('source'), medium: pega('medium'), campaign: pega('campaign') }
}

/** Origem resumida (mesma regra do painel): utm_source, senão o domínio normalizado, senão "direto". */
export function origemResumida(ctx: Pick<Contexto, 'ref' | 'utm'>): string {
  if (ctx.utm.source) return ctx.utm.source.toLowerCase().slice(0, 40)
  const r = ctx.ref
  if (!r) return 'direto'
  if (/(^|\.)tiktok\.com$/.test(r)) return 'tiktok'
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(r)) return 'youtube'
  if (/(^|\.)instagram\.com$/.test(r)) return 'instagram'
  if (/(^|\.)google\.[a-z.]+$/.test(r)) return 'google'
  return r.slice(0, 40)
}

/** Fila de eventos com teto: passando de `max`, os mais antigos saem. */
export class FilaEventos {
  private itens: Evento[] = []
  constructor(readonly max = FILA_MAX) {}
  get tamanho() {
    return this.itens.length
  }
  push(e: Evento) {
    this.itens.push(e)
    this.cortar()
  }
  /** Tira todos (para enviar). */
  tirarTudo(): Evento[] {
    const t = this.itens
    this.itens = []
    return t
  }
  /** Devolve um lote que não foi entregue (na frente: são os mais antigos). */
  devolver(lote: Evento[]) {
    if (!lote.length) return
    this.itens = [...lote, ...this.itens]
    this.cortar()
  }
  private cortar() {
    if (this.itens.length > this.max) this.itens.splice(0, this.itens.length - this.max)
  }
}

export interface Cabecalho {
  v: string
  s: string
  bot: 0 | 1
  ctx: Contexto
}

/** Corpos de envio, cada um abaixo de `limite` bytes (um evento enorme sozinho é descartado). */
export function montarCorpos(cab: Cabecalho, eventos: Evento[], limite = CORPO_MAX_BYTES): string[] {
  const corpos: string[] = []
  const vazio = JSON.stringify({ ...cab, ev: [] })
  const enc = (s: string) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length * 3)
  let atual: string[] = []
  let tam = enc(vazio)
  const fecha = () => {
    if (atual.length) corpos.push(`${vazio.slice(0, -3)}[${atual.join(',')}]}`)
    atual = []
    tam = enc(vazio)
  }
  for (const e of eventos) {
    const j = JSON.stringify(e)
    const n = enc(j) + 1
    if (enc(vazio) + n > limite) continue
    if (tam + n > limite) fecha()
    atual.push(j)
    tam += n
  }
  fecha()
  return corpos
}

// ───────────────────────────── no navegador ─────────────────────────────

interface EstadoJogo {
  jogando: boolean
  modo: ModoJogo | null
}

interface Runtime {
  ls: Armazem
  ss: Armazem
  fila: FilaEventos
  vid: string
  bot: 0 | 1
  estadoJogo: () => EstadoJogo
  enviando: boolean
}

let rt: Runtime | null = null

function contextoAgora(): Contexto {
  const largura = Math.round(window.innerWidth || screen.width || 0)
  return {
    ref: dominioDeOrigem(document.referrer, location.hostname),
    utm: utmDe(location.search),
    dev: dispositivo(navigator.userAgent, largura, navigator.maxTouchPoints || 0),
    lang: (navigator.language || '').slice(0, 16),
    tela: `${screen.width || 0}x${screen.height || 0}`,
  }
}

function cabecalho(r: Runtime): Cabecalho {
  const { sid, ctx } = tocarSessao(r.ss, Date.now(), contextoAgora)
  return { v: r.vid, s: sid, bot: r.bot, ctx }
}

/** Envia o que está na fila. `fechando`: a aba está sumindo — vai por sendBeacon, sem esperar resposta. */
async function enviar(fechando = false) {
  const r = rt
  // um envio normal em andamento não segura o da saída (a fila já está sem os eventos dele)
  if (!r || (r.enviando && !fechando) || !r.fila.tamanho) return
  const url = apiUrl('e.php')
  const eventos = r.fila.tirarTudo()
  const corpos = montarCorpos(cabecalho(r), eventos)
  if (fechando) {
    let ok = true
    try {
      for (const c of corpos) ok = (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, new Blob([c], { type: 'text/plain' }))) && ok
    } catch {
      ok = false
    }
    if (!ok) r.fila.devolver(eventos)
    return
  }
  r.enviando = true
  try {
    for (let i = 0; i < corpos.length; i++) {
      try {
        const res = await fetch(url, { method: 'POST', body: corpos[i], headers: { 'Content-Type': 'text/plain' }, credentials: 'same-origin', keepalive: corpos[i].length < 60_000 })
        // 429 (limite) e 4xx: o servidor recusou o lote — não adianta mandar de novo
        if (res.status >= 500) throw new Error(String(res.status))
      } catch {
        // devolve este lote e os que faltavam (mais simples: os eventos inteiros deles)
        const resto = corpos.slice(i).flatMap((c) => {
          try {
            return (JSON.parse(c) as { ev: Evento[] }).ev
          } catch {
            return []
          }
        })
        r.fila.devolver(resto)
        return
      }
    }
  } finally {
    r.enviando = false
  }
}

/** Registra um evento (não faz nada fora do site ou antes de iniciarMedicao). */
export function track(t: Exclude<TipoEvento, 'hb'>, m: ModoJogo | null = null, d?: Record<string, unknown>) {
  const r = rt
  if (!r) return
  const e: Evento = { t, m, ts: Date.now() }
  if (d && Object.keys(d).length) e.d = d
  r.fila.push(e)
  if (r.fila.tamanho >= ENVIAR_AO_JUNTAR) void enviar()
  else if (ENVIAR_JA.has(t)) enviarLogo()
}

/** Envia daqui a pouco (junta o que vier junto); com um envio no ar, tenta de novo logo depois dele. */
function enviarLogo(tentativa = 0) {
  window.setTimeout(() => {
    const r = rt
    if (!r || !r.fila.tamanho) return
    if (r.enviando) {
      if (tentativa < 8) enviarLogo(tentativa + 1)
      return
    }
    void enviar()
  }, ENVIAR_JA_MS)
}

/**
 * Manda a fila agora e espera (no máximo `maxMs`). Antes de criar a conta ou entrar: o que aconteceu até aqui
 * (a partida que abriu o convite) vai como do visitante, sem a conta — não conta como partida "com a conta".
 */
export async function enviarAgora(maxMs = 1500): Promise<void> {
  const r = rt
  if (!r) return
  const ate = Date.now() + maxMs
  while (r.enviando && Date.now() < ate) await new Promise((res) => window.setTimeout(res, 50))
  if (r.enviando || !r.fila.tamanho) return
  await Promise.race([enviar(), new Promise((res) => window.setTimeout(res, Math.max(0, ate - Date.now())))])
}

export function visitanteAtual(): string | null {
  return rt?.vid ?? null
}

/** Origem da sessão atual ("tiktok", "direto"…) — vai no cadastro. */
export function origemAtual(): string | null {
  if (!rt) return null
  try {
    return origemResumida(tocarSessao(rt.ss, Date.now(), contextoAgora).ctx)
  } catch {
    return null
  }
}

/** Liga a medição (uma vez). `estadoJogo` diz, a cada batimento, se o visitante está jogando e em que modo. */
export function iniciarMedicao(opts: { estadoJogo: () => EstadoJogo }): void {
  if (rt || typeof window === 'undefined') return
  const ls = armazem(() => window.localStorage)
  const ss = armazem(() => window.sessionStorage)
  let bot: 0 | 1 = 0
  try {
    bot = navigator.webdriver ? 1 : 0
  } catch {
    /* ignora */
  }
  rt = { ls, ss, fila: new FilaEventos(), vid: obterVisitante(ls), bot, estadoJogo: opts.estadoJogo, enviando: false }
  // a sessão começa já (o contexto da primeira página é o que vale)
  tocarSessao(ss, Date.now(), contextoAgora)

  const batimento = () => {
    const r = rt
    if (!r || document.visibilityState !== 'visible') return
    let e: EstadoJogo = { jogando: false, modo: null }
    try {
      e = r.estadoJogo()
    } catch {
      /* ignora */
    }
    r.fila.push({ t: 'hb', p: e.jogando ? 1 : 0, m: e.modo })
  }
  window.setInterval(batimento, BATIMENTO_MS)
  window.setInterval(() => void enviar(), ENVIO_MS)
  // o primeiro batimento logo no começo: o painel já conta o visitante como online
  window.setTimeout(() => {
    batimento()
    void enviar()
  }, 1500)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void enviar(true)
  })
  window.addEventListener('pagehide', () => void enviar(true))
}
