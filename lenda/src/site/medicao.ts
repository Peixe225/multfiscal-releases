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
 * Batimento a cada 15 s só com a aba visível; p:1 quando está jogando (com o modo em `m`).
 * "Na área" do painel (v3.2, P1-4): o servidor guarda a tela do último `view` e o modo do último batimento. Sessão que
 * começa sem trocar de tela (a aba ficou 30 min no fundo) leva um `view` da tela de agora no primeiro envio — um evento
 * por sessão nova, nada a mais nos batimentos.
 *
 * v3.5 (celular no 4G lento): a visita é contada antes de o jogo carregar. O index.html do site traz um <script> embutido
 * (src/site/medicaoCedo.ts, montado pelo plugin lenda:medicao-cedo do vite.config.ts) que manda o 1º `view` assim que a
 * página chega — quem desiste olhando a tela de abertura também aparece no painel. Ele deixa o visitante, a sessão e o
 * envio em window.__lendaMedicao; o main.tsx liga a medição antes de desenhar o jogo (iniciarMedicao com um estado
 * provisório) e continua a mesma sessão; o vigias.ts (SiteRoot) chama iniciarMedicao de novo só para pôr o estado real.
 * Origem: utm, senão o convite, senão o referrer (android-app://com.whatsapp/ → "whatsapp"), senão o navegador de dentro
 * do app pelo user agent (TikTok, Instagram, Facebook…), que vai como utm implícito (medium "app").
 */
import { apiUrl } from './api'
import { codigoValido } from './indicacao'

/** v3.5: "erro" = um diálogo do site caiu por erro de JS (d: onde, msg); o e.php antigo o descarta em silêncio. */
export type TipoEvento = 'view' | 'hb' | 'jogo_inicio' | 'jogo_fim' | 'partida_fim' | 'gate_ver' | 'gate_fechar' | 'cadastro' | 'login' | 'logout' | 'compartilhar' | 'erro'
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
  // v3.5: as chaves que o storage não aceitou gravar (cheio, aba anônima do Safari antigo: lê, mas o setItem lança). Só
  // para elas a memória vale quando o storage devolve null — o resto segue o storage (que outra parte pode ter limpado)
  const soNaMemoria = new Set<string>()
  return {
    get(k) {
      try {
        const s = pegar()
        if (s) return s.getItem(k) ?? (soNaMemoria.has(k) ? mem.get(k) ?? null : null)
      } catch {
        /* bloqueado */
      }
      return mem.get(k) ?? null
    },
    set(k, v) {
      mem.set(k, v)
      try {
        const s = pegar()
        if (s) {
          s.setItem(k, v)
          soNaMemoria.delete(k)
        }
      } catch {
        /* bloqueado ou cheio: fica na memória */
        soNaMemoria.add(k)
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

/**
 * v3.5: o app que abriu o link, pelo pacote do Android (referrer android-app://<pacote>/: a Custom Tab do Chrome que o
 * WhatsApp, o Gmail… abrem). A mesma lista do normalizarOrigem do servidor (servidor/api/_lib.php).
 */
export const PACOTES_APP: ReadonlyMap<string, string> = new Map([
  ['com.whatsapp', 'whatsapp'],
  ['com.whatsapp.w4b', 'whatsapp'],
  ['com.zhiliaoapp.musically', 'tiktok'],
  ['com.zhiliaoapp.musically.go', 'tiktok'],
  ['com.ss.android.ugc.trill', 'tiktok'],
  ['com.ss.android.ugc.aweme', 'tiktok'],
  ['com.instagram.android', 'instagram'],
  ['com.instagram.lite', 'instagram'],
  ['com.facebook.katana', 'facebook'],
  ['com.facebook.lite', 'facebook'],
  ['com.facebook.orca', 'facebook'],
  ['com.facebook.mlite', 'facebook'],
  ['com.google.android.gm', 'gmail'],
  ['com.google.android.googlequicksearchbox', 'google'],
  ['com.google.android.youtube', 'youtube'],
  ['com.twitter.android', 'x'],
  ['com.reddit.frontpage', 'reddit'],
  ['org.telegram.messenger', 'telegram'],
  ['com.discord', 'discord'],
  ['com.kwai.video', 'kwai'],
  ['com.kwai.bulldog', 'kwai'],
])

/**
 * Domínio de quem mandou a visita (sem "www."); vazio quando veio direto ou do próprio site. Um app do Android
 * (android-app://com.whatsapp/) vira o nome da rede ("whatsapp"); um app fora da lista fica com o nome do pacote.
 */
export function dominioDeOrigem(referrer: string, hostAtual: string): string {
  if (!referrer) return ''
  try {
    const u = new URL(referrer)
    const h = u.hostname.toLowerCase().replace(/^www\./, '')
    if (u.protocol === 'android-app:') return (PACOTES_APP.get(h) ?? h).slice(0, 120)
    return h === hostAtual.toLowerCase().replace(/^www\./, '') ? '' : h.slice(0, 120)
  } catch {
    return ''
  }
}

/**
 * v3.5: o navegador de dentro de um app, pelo user agent (o TikTok e o Instagram não mandam referrer). Vazio quando é
 * um navegador comum. Só para a origem da visita — nada de robô aqui (isso é o servidor, ROBO_UA do e.php).
 */
export function appDoNavegador(ua: string): string {
  if (/BytedanceWebview|musical_ly|[\s_/]trill[\s_/]|AppName\/(?:trill|musical_ly)|TikTok/i.test(ua)) return 'tiktok'
  if (/\bInstagram\s\d/i.test(ua)) return 'instagram'
  if (/FBAN\/|FBAV\/|FB_IAB|FBIOS|FB4A|\[FB/i.test(ua)) return 'facebook'
  if (/\bWhatsApp\b/i.test(ua)) return 'whatsapp'
  if (/Snapchat/i.test(ua)) return 'snapchat'
  if (/Twitter for|TwitterAndroid/i.test(ua)) return 'x'
  if (/\bKwai|kwai_/i.test(ua)) return 'kwai'
  if (/LinkedInApp/i.test(ua)) return 'linkedin'
  if (/Pinterest/i.test(ua)) return 'pinterest'
  return ''
}

/**
 * Os utm da visita com a origem implícita (v3.5): sem utm_source e sem referrer, o app do navegador (user agent) vira
 * utm_source e o medium fica "app" — o servidor não precisa ler o user agent, e o painel separa (Campanhas · medium).
 */
export function utmComApp(utm: Contexto['utm'], ref: string, ua: string): Contexto['utm'] {
  if (utm.source || ref) return utm
  const app = appDoNavegador(ua)
  return app ? { ...utm, source: app, medium: utm.medium || 'app' } : utm
}

export function utmDe(search: string): Contexto['utm'] {
  const q = new URLSearchParams(search)
  const pega = (k: string) => (q.get(`utm_${k}`) ?? '').trim().slice(0, 80)
  return { source: pega('source'), medium: pega('medium'), campaign: pega('campaign') }
}

/**
 * Os utm da visita; quem chegou pelo link de convite de um amigo (`?c=<código>`) sem utm_source fica com a origem
 * "convite" (medium "indicacao"): o "De onde vieram" do painel separa os convites (MAPA A5).
 */
export function utmDaVisita(search: string): Contexto['utm'] {
  const utm = utmDe(search)
  if (utm.source) return utm
  let c: string | undefined
  try {
    c = new URLSearchParams(search).get('c')?.trim()
  } catch {
    c = undefined
  }
  return codigoValido(c) ? { ...utm, source: 'convite', medium: utm.medium || 'indicacao' } : utm
}

/** Rede conhecida pelo nome (utm, com apelidos) ou pelo domínio; mesma regra do normalizarOrigem do servidor. */
const REDES: [string, string[], RegExp][] = [
  ['tiktok', ['tiktok', 'tt'], /(^|\.)tiktok\.com$/],
  ['youtube', ['youtube', 'yt', 'youtu.be'], /(^|\.)youtube\.com$/],
  ['instagram', ['instagram', 'insta', 'ig'], /(^|\.)instagram\.com$/],
  ['reddit', ['reddit', 'redd.it'], /(^|\.)reddit\.com$/],
  ['facebook', ['facebook', 'fb', 'fb.com', 'fb.me'], /(^|\.)facebook\.com$/],
  ['x', ['x', 'twitter', 't.co'], /(^|\.)(x|twitter)\.com$/],
  ['whatsapp', ['whatsapp', 'zap', 'wa.me'], /(^|\.)whatsapp\.com$/],
  ['google', ['google'], /(^|\.)google\.[a-z.]+$/],
]
// v3.5: o pacote do app (a sessão gravada por uma versão de antes, que guardava "com.whatsapp" cru) também vale
const rede = (h: string) => PACOTES_APP.get(h) ?? REDES.find(([, nomes, dominio]) => nomes.includes(h) || dominio.test(h))?.[0]

/** Origem resumida (mesma regra do painel): utm_source, senão o domínio normalizado, senão "direto". */
export function origemResumida(ctx: Pick<Contexto, 'ref' | 'utm'>): string {
  const u = ctx.utm.source.trim().toLowerCase().replace(/^www\d*\./, '')
  if (u) return rede(u) ?? u.slice(0, 40)
  const r = ctx.ref
  if (!r) return 'direto'
  return rede(r) ?? r.slice(0, 40)
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

/** O que o servidor aceita como tela (visitas.rota): "/", "/hall", "/conta/carreiras"… até 24 caracteres. */
export const ROTA_RE = /^\/[a-z0-9/_-]{0,23}$/

/**
 * Sessão nova (o servidor abre outra visita): se o lote não traz um `view`, um da tela de agora vai na frente, para a
 * visita nova já saber onde a pessoa está. Devolve o lote (o mesmo, se não precisou).
 */
export function comTelaDaSessao(eventos: Evento[], nova: boolean, tela: string | null | undefined, agora = Date.now()): Evento[] {
  if (!nova || !tela || !ROTA_RE.test(tela) || eventos.some((e) => e.t === 'view')) return eventos
  return [{ t: 'view', m: null, ts: agora, d: { rota: tela } }, ...eventos]
}

/**
 * A tela pelo endereço (#/hall → "/hall", #/jogador/ABC → "/jogador"), para quando o roteador do jogo ainda não carregou
 * (o script embutido do index.html). O que não cabe no formato do servidor vira "/" (como o jogo faz com rota desconhecida).
 */
export function rotaDoEndereco(hash: string): string {
  const p = hash.replace(/^#/, '').split('?')[0] || '/'
  const r = /^\/jogador\/[^/]+\/?$/.test(p) ? '/jogador' : p
  return ROTA_RE.test(r) ? r : '/'
}

/**
 * v3.5: o que o <script> embutido do index.html (src/site/medicaoCedo.ts) deixa em window.__lendaMedicao: o visitante e a
 * sessão que ele usou (os mesmos do storage; com o storage bloqueado, só aqui), o contexto, a tela do `view` que ele
 * mandou e o envio (true = chegou ao servidor; false = não chegou, e o view vai de novo pela fila).
 */
export interface SementeMedicao {
  v: string
  s: string
  ctx: Contexto
  em: number
  rota: string
  p?: Promise<boolean>
}

declare global {
  interface Window {
    __lendaMedicao?: SementeMedicao
  }
}

/** A semente, se for uma de verdade (o script embutido rodou nesta página). */
export function sementeValida(x: unknown): SementeMedicao | null {
  if (!x || typeof x !== 'object') return null
  const s = x as Partial<SementeMedicao>
  if (typeof s.v !== 'string' || !UUID_V4.test(s.v) || typeof s.s !== 'string' || !UUID_V4.test(s.s)) return null
  if (typeof s.em !== 'number' || !Number.isFinite(s.em) || typeof s.rota !== 'string' || !s.ctx || typeof s.ctx !== 'object') return null
  return s as SementeMedicao
}

/** Robô de navegador automatizado (o servidor também olha o user agent: ROBO_UA do e.php). */
export function botDoNavegador(): 0 | 1 {
  try {
    return navigator.webdriver ? 1 : 0
  } catch {
    return 0
  }
}

interface Runtime {
  ls: Armazem
  ss: Armazem
  fila: FilaEventos
  vid: string
  bot: 0 | 1
  estadoJogo: () => EstadoJogo
  /** A tela de agora (rota, ou "/conta" com Minha conta aberta…), para a sessão nova. */
  telaAtual: (() => string | null) | null
  enviando: boolean
  /** v3.5: a tela do último `view` (o mesmo de novo seguido não vai: o do main.tsx e o 1º do vigias.ts são um só). */
  ultimaView: string | null
}

let rt: Runtime | null = null

/** O contexto desta página (origem, utm, aparelho, idioma, tela). Também usado pelo script embutido (medicaoCedo.ts). */
export function contextoAgora(): Contexto {
  const largura = Math.round(window.innerWidth || screen.width || 0)
  const ref = dominioDeOrigem(document.referrer, location.hostname)
  return {
    ref,
    utm: utmComApp(utmDaVisita(location.search), ref, navigator.userAgent || ''),
    dev: dispositivo(navigator.userAgent, largura, navigator.maxTouchPoints || 0),
    lang: (navigator.language || '').slice(0, 16),
    tela: `${screen.width || 0}x${screen.height || 0}`,
  }
}

function cabecalho(r: Runtime): Cabecalho & { nova: boolean } {
  const { sid, ctx, nova } = tocarSessao(r.ss, Date.now(), contextoAgora)
  return { v: r.vid, s: sid, bot: r.bot, ctx, nova }
}

function telaDe(r: Runtime): string | null {
  try {
    return r.telaAtual?.() ?? null
  } catch {
    return null
  }
}

/** Envia o que está na fila. `fechando`: a aba está sumindo — vai por sendBeacon, sem esperar resposta. */
async function enviar(fechando = false) {
  const r = rt
  // um envio normal em andamento não segura o da saída (a fila já está sem os eventos dele)
  if (!r || (r.enviando && !fechando) || !r.fila.tamanho) return
  const url = apiUrl('e.php')
  const { nova, ...cab } = cabecalho(r)
  const eventos = comTelaDaSessao(r.fila.tirarTudo(), nova, nova ? telaDe(r) : null)
  const corpos = montarCorpos(cab, eventos)
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
  if (t === 'view') {
    const rota = typeof d?.rota === 'string' ? d.rota : null
    if (rota !== null && rota === r.ultimaView) return
    r.ultimaView = rota
  }
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

/**
 * Liga a medição. `estadoJogo` diz, a cada batimento, se o visitante está jogando e em que modo; `telaAtual`, a tela de
 * agora (para a sessão que começa sem trocar de tela).
 * v3.5: a 1ª chamada é a do main.tsx (antes de desenhar o jogo, com um estado provisório) e manda o 1º `view` na hora —
 * ou, se o script embutido do index.html já mandou o desta página, só confere que ele chegou. As seguintes (o vigias.ts,
 * quando o SiteRoot carrega) só trocam `estadoJogo` e `telaAtual`.
 */
export function iniciarMedicao(opts: { estadoJogo: () => EstadoJogo; telaAtual?: () => string | null }): void {
  if (typeof window === 'undefined') return
  if (rt) {
    rt.estadoJogo = opts.estadoJogo
    if (opts.telaAtual) rt.telaAtual = opts.telaAtual
    return
  }
  const ls = armazem(() => window.localStorage)
  const ss = armazem(() => window.sessionStorage)
  let sem: SementeMedicao | null = null
  try {
    sem = sementeValida(window.__lendaMedicao)
  } catch {
    sem = null
  }
  if (sem) {
    // com o storage bloqueado, o visitante e a sessão do script embutido só existem nele: continuam os mesmos
    if (!ls.get(CHAVE_VID)) ls.set(CHAVE_VID, sem.v)
    if (!ss.get(CHAVE_SID)) {
      ss.set(CHAVE_SID, sem.s)
      ss.set(CHAVE_SID_ULTIMO, String(sem.em))
      ss.set(CHAVE_SID_CTX, JSON.stringify(sem.ctx))
    }
  }
  const r: Runtime = { ls, ss, fila: new FilaEventos(), vid: obterVisitante(ls), bot: botDoNavegador(), estadoJogo: opts.estadoJogo, telaAtual: opts.telaAtual ?? null, enviando: false, ultimaView: null }
  rt = r
  // a sessão começa já (o contexto da primeira página é o que vale)
  const { sid } = tocarSessao(ss, Date.now(), contextoAgora)
  const tela = telaDe(r) ?? rotaDoEndereco(location.hash)
  if (sem && sem.s === sid && sem.rota === tela) {
    // o view desta página já foi pelo script embutido; se ele não chegou (sem rede), vai pela fila, com a hora dele
    r.ultimaView = tela
    const s0 = sem
    void s0.p?.then(
      (ok) => {
        if (ok || rt !== r) return
        r.fila.push({ t: 'view', m: null, ts: s0.em, d: { rota: s0.rota } })
        void enviar()
      },
      () => undefined,
    )
  } else {
    // sem o script embutido (ou numa tela que ele não sabia): o 1º view vai já, sem esperar o batimento de 1,5 s
    track('view', null, { rota: tela })
    void enviar()
  }

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
