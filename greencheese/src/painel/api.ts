// Conversa do painel com o servidor (API.md, "Painel do dono"). Tudo em ../api/index.php?r=<rota>, que do
// /painel/ cai na API do site (no ar e no Vite, que repassa /api pro PHP).
// - O csrf mora só aqui, em memória, e vai no X-CSRF de todo POST.
// - Sessão caiu (401) ou o csrf mudou (403): o pedido ESPERA o dono entrar de novo (a folha de login abre por cima
//   da tela, que continua montada com o que estava digitado) e é refeito sozinho. É seguro refazer: o servidor
//   confere a sessão antes de qualquer escrita.
// - Banco ocupado (503) tenta de novo uma vez em 2 s; erro de rede e demora viram mensagem clara.
// - Os arquivos (CSV, cópia do banco) também vêm por aqui: um <a download> direto pra API falhava calado com a sessão
//   vencida (o navegador cancelava o "index.json" e a tela não dizia nada).
import type {
  Diagnostico,
  Envio,
  Evento,
  Participante,
  ParticipanteCorpo,
  RateioAdmin,
  RateioCorpo,
  Resumo,
  Sessao,
  StatusRateio,
  StatusVaga,
  Usuario,
} from './tipos'

const BASE = '../api/index.php'
const PRAZO_MS = 25_000

export class ErroApi extends Error {
  codigo: string
  status: number
  dados: Record<string, unknown>
  constructor(codigo: string, mensagem: string, status = 0, dados: Record<string, unknown> = {}) {
    super(mensagem)
    this.codigo = codigo
    this.status = status
    this.dados = dados
  }
  /** Campo do formulário que o servidor recusou (erro `invalido`, `proibido`, `senha-atual`…). */
  get campo(): string | undefined {
    return typeof this.dados.campo === 'string' ? this.dados.campo : undefined
  }
}

/** Mensagem pronta pra tela, de qualquer erro. */
export function mensagemDe(e: unknown): string {
  if (e instanceof ErroApi) return e.message
  return 'Deu erro aqui. Tenta de novo.'
}

/** Relógio do servidor (o "vence em 5 h" não depende do relógio do celular estar certo). */
let desvio = 0
export function agora(): number {
  return Date.now() + desvio
}

let csrf: string | null = null
export function guardarCsrf(c: string | null): void {
  csrf = c
}

// ─── sessão caída: quem mostra a folha de login assina aqui ──────────────────────────────────────────────────────

type Espera = { promessa: Promise<void>; soltar: () => void; desistir: (e: unknown) => void }
let espera: Espera | null = null
const ouvintes = new Set<(caiu: boolean) => void>()

/** A tela de sessão assina: true = mostrar o login por cima; false = já entrou de novo. */
export function assinarSessao(f: (caiu: boolean) => void): () => void {
  ouvintes.add(f)
  return () => ouvintes.delete(f)
}

function esperarLogin(): Promise<void> {
  if (!espera) {
    let soltar = () => {}
    let desistir: (e: unknown) => void = () => {}
    const promessa = new Promise<void>((ok, nao) => {
      soltar = ok
      desistir = nao
    })
    // ninguém esperando (só a assinatura) não vira "erro não tratado"
    promessa.catch(() => {})
    espera = { promessa, soltar, desistir }
    csrf = null
    ouvintes.forEach((f) => f(true))
  }
  return espera.promessa
}

/** O dono entrou de novo pela folha: guarda o csrf novo e solta quem estava esperando. */
export function voltouASessao(novo: string): void {
  csrf = novo
  const e = espera
  espera = null
  ouvintes.forEach((f) => f(false))
  e?.soltar()
}

/** Desistiu de entrar (saiu): quem esperava recebe o erro. */
export function largouASessao(): void {
  const e = espera
  espera = null
  e?.desistir(new ErroApi('sem-sessao', 'Tua sessão acabou. Entra de novo.', 401))
}

// ─── pedido ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function urlApi(rota: string, params: Record<string, string> = {}): string {
  return `${BASE}?${new URLSearchParams({ r: rota, ...params })}`
}

interface Opcoes {
  corpo?: unknown
  params?: Record<string, string>
  sinal?: AbortSignal
  /** Rotas antes da sessão (instalar, entrar, recuperar): sem X-CSRF e sem esperar login. */
  aberta?: boolean
  tentativa?: number
  /** Resposta que é arquivo (não JSON): devolve { blob, nome } em vez do JSON. */
  arquivo?: boolean
  /** Prazo em ms (padrão 25 s). */
  prazo?: number
}

/** Arquivo baixado da API: o conteúdo e o nome que o servidor deu (Content-Disposition). */
export interface Arquivo {
  blob: Blob
  nome: string | null
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

function minutos(seg: number): string {
  if (seg < 60) return `${seg} s`
  const m = Math.ceil(seg / 60)
  return m === 1 ? '1 min' : `${m} min`
}

/** Traduz a resposta de erro do servidor (ou a falta dela) num ErroApi. */
function erroDaResposta(status: number, json: Record<string, unknown> | null): ErroApi {
  const codigo = typeof json?.erro === 'string' ? json.erro : 'erro'
  let msg = typeof json?.mensagem === 'string' && json.mensagem ? json.mensagem : 'Deu erro aqui. Tenta de novo.'
  if (codigo === 'muitas-tentativas' && typeof json?.esperaSegundos === 'number') msg = `${msg.replace(/\.?$/, '.')} Libera em ${minutos(json.esperaSegundos)}.`
  if (codigo === 'sem-servidor') msg = 'O servidor tá desligado. Liga a API (npm run api) e tenta de novo.'
  return new ErroApi(codigo, msg, status, json ?? {})
}

export async function pedir<T>(metodo: 'GET' | 'POST', rota: string, op: Opcoes = {}): Promise<T> {
  const tentativa = op.tentativa ?? 0
  const cab: Record<string, string> = { Accept: 'application/json' }
  let corpo: string | undefined
  if (metodo === 'POST') {
    cab['Content-Type'] = 'application/json'
    corpo = JSON.stringify(op.corpo ?? {})
    if (!op.aberta && csrf) cab['X-CSRF'] = csrf
  }
  const ctrl = new AbortController()
  let demorou = false
  const relogio = setTimeout(() => {
    demorou = true
    ctrl.abort()
  }, op.prazo ?? PRAZO_MS)
  const largar = () => ctrl.abort()
  op.sinal?.addEventListener('abort', largar)
  let res: Response
  try {
    res = await fetch(urlApi(rota, op.params), { method: metodo, headers: cab, body: corpo, credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
    // arquivo: lê o corpo ainda dentro do prazo (cair no meio do download também vira mensagem)
    if (op.arquivo && res.ok && !/json/i.test(res.headers.get('Content-Type') ?? '')) {
      const blob = await res.blob()
      const nome = /filename="([^"\\/]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? null
      return { blob, nome } satisfies Arquivo as T
    }
  } catch (e) {
    if (op.sinal?.aborted) throw e
    throw demorou
      ? new ErroApi('demorou', 'O servidor demorou demais pra responder. Confere a internet e tenta de novo.')
      : new ErroApi('rede', 'Sem conexão com o servidor. Confere a internet e tenta de novo.')
  } finally {
    clearTimeout(relogio)
    op.sinal?.removeEventListener('abort', largar)
  }
  let json: Record<string, unknown> | null = null
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    json = null
  }
  if (res.ok && json?.ok === true) {
    if (typeof json.agora === 'string') {
      const t = Date.parse(json.agora)
      if (Number.isFinite(t)) desvio = t - Date.now()
    }
    return json as T
  }
  const erro = erroDaResposta(res.status, json)
  if (!json) throw new ErroApi('resposta', 'O servidor respondeu de um jeito estranho. Tenta de novo daqui a pouco.', res.status)

  if (!op.aberta && tentativa < 2) {
    if (erro.codigo === 'sem-sessao') {
      await esperarLogin()
      return pedir<T>(metodo, rota, { ...op, tentativa: tentativa + 1 })
    }
    if (erro.codigo === 'csrf') {
      // o csrf mudou (entrou em outra aba): pega o da sessão atual e refaz
      const s = await sessao().catch(() => null)
      if (s?.usuario && s.csrf) csrf = s.csrf
      else await esperarLogin()
      return pedir<T>(metodo, rota, { ...op, tentativa: tentativa + 1 })
    }
  }
  if (erro.codigo === 'ocupado' && tentativa < 1) {
    await dormir(2000)
    return pedir<T>(metodo, rota, { ...op, tentativa: tentativa + 1 })
  }
  throw erro
}

// ─── rotas ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Ok<T> = T & { ok: true }

export const sessao = () => pedir<Ok<Sessao>>('GET', 'admin-sessao', { aberta: true })

export const instalar = (c: { codigo: string; login: string; nome: string; senha: string }) =>
  pedir<Ok<{ usuario: Usuario; csrf: string }>>('POST', 'admin-instalar', { corpo: c, aberta: true })

export const entrar = (c: { login: string; senha: string }) => pedir<Ok<{ usuario: Usuario; csrf: string }>>('POST', 'admin-entrar', { corpo: c, aberta: true })

export const recuperar = (c: { codigo: string; senha: string; login?: string }) =>
  pedir<Ok<{ usuario: Usuario; csrf: string }>>('POST', 'admin-recuperar', { corpo: c, aberta: true })

export const sair = () => pedir<Ok<object>>('POST', 'admin-sair', { aberta: false, tentativa: 2 })

export const trocarSenha = (c: { atual: string; nova: string }) => pedir<Ok<object>>('POST', 'admin-senha', { corpo: c })

export const resumo = (sinal?: AbortSignal) => pedir<Ok<Resumo>>('GET', 'admin-resumo', { sinal })

export const rateios = (sinal?: AbortSignal) => pedir<Ok<{ agora: string; rateios: RateioAdmin[] }>>('GET', 'admin-rateios', { sinal })

export const rateio = (id: string, sinal?: AbortSignal) => pedir<Ok<{ rateio: RateioAdmin }>>('GET', 'admin-rateio', { params: { id }, sinal })

export const salvarRateio = (c: RateioCorpo) => pedir<Ok<{ rateio: RateioAdmin }>>('POST', 'admin-rateio-salvar', { corpo: c })

export const statusRateio = (id: string, status: StatusRateio) => pedir<Ok<{ rateio: RateioAdmin }>>('POST', 'admin-rateio-status', { corpo: { id, status } })

export const apagarRateio = (id: string) => pedir<Ok<object>>('POST', 'admin-rateio-apagar', { corpo: { id } })

export const participantes = (rateioId: string, sinal?: AbortSignal) =>
  pedir<Ok<{ rateio: RateioAdmin; participantes: Participante[] }>>('GET', 'admin-participantes', { params: { rateio: rateioId }, sinal })

export const salvarParticipante = (c: ParticipanteCorpo) =>
  pedir<Ok<{ participante: Participante; rateio: RateioAdmin; token?: string }>>('POST', 'admin-participante-salvar', { corpo: c })

/** jaEstava: a vaga já tinha esse status (outro aparelho, ou um toque de novo depois do "demorou"); nada mudou. */
export const statusParticipante = (id: number, status: Exclude<StatusVaga, 'expirado'>) =>
  pedir<Ok<{ participante: Participante; rateio: RateioAdmin; jaEstava?: boolean }>>('POST', 'admin-participante-status', { corpo: { id, status } })

export const apagarParticipante = (id: number) =>
  pedir<Ok<{ participante: Participante; rateio: RateioAdmin }>>('POST', 'admin-participante-apagar', { corpo: { id } })

export const diagnostico = () => pedir<Ok<Diagnostico>>('GET', 'admin-diagnostico')

export const eventos = (sinal?: AbortSignal) => pedir<Ok<{ eventos: Evento[] }>>('GET', 'admin-eventos', { sinal })

/** Entrega o arquivo baixado pro navegador salvar (o mesmo "baixar" de um link com download). */
function salvar({ blob, nome }: Arquivo, reserva: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome ?? reserva
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // o navegador já pegou o arquivo; o endereço temporário sai depois
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Baixa a planilha do rateio / a cópia do banco. Passa pelo mesmo caminho dos outros pedidos: sessão caída abre o
 * login por cima e o download recomeça sozinho; erro vira mensagem (ErroApi) pra tela mostrar.
 */
export async function baixarCsv(rateioId: string): Promise<void> {
  const a = await pedir<Arquivo>('GET', 'admin-participantes-csv', { params: { rateio: rateioId }, arquivo: true, prazo: 60_000 })
  salvar(a, `rateio-${rateioId}.csv`)
}
export async function baixarBackup(): Promise<void> {
  const a = await pedir<Arquivo>('GET', 'admin-backup', { arquivo: true, prazo: 120_000 })
  salvar(a, 'greencheese-loja.sqlite')
}

/**
 * Envio da foto (multipart, campo `imagem`), com o andamento. XHR em vez de fetch só por causa do progresso.
 * Sessão caída no meio: espera entrar de novo e manda outra vez.
 */
export function enviarImagem(arquivo: Blob, nome: string, aoAndar?: (fracao: number) => void, tentativa = 0): Promise<Envio> {
  return new Promise<Envio>((ok, nao) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', urlApi('admin-upload'))
    xhr.timeout = 120_000
    xhr.responseType = 'json'
    if (csrf) xhr.setRequestHeader('X-CSRF', csrf)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) aoAndar?.(e.loaded / e.total)
    }
    xhr.onerror = () => nao(new ErroApi('rede', 'A foto não subiu: sem conexão com o servidor. Tenta de novo.'))
    xhr.ontimeout = () => nao(new ErroApi('demorou', 'A foto demorou demais pra subir. Tenta de novo, de preferência no Wi-Fi.'))
    xhr.onload = () => {
      const json = (xhr.response ?? null) as Record<string, unknown> | null
      if (xhr.status >= 200 && xhr.status < 300 && json?.ok === true) {
        ok(json as unknown as Envio)
        return
      }
      const erro = json ? erroDaResposta(xhr.status, json) : new ErroApi('resposta', 'O servidor respondeu de um jeito estranho. Tenta de novo.', xhr.status)
      if ((erro.codigo === 'sem-sessao' || erro.codigo === 'csrf') && tentativa < 2) {
        const refazer = () => enviarImagem(arquivo, nome, aoAndar, tentativa + 1).then(ok, nao)
        if (erro.codigo === 'csrf') {
          sessao()
            .then((s) => {
              if (s.usuario && s.csrf) {
                csrf = s.csrf
                return refazer()
              }
              return esperarLogin().then(refazer)
            })
            .catch(nao)
        } else esperarLogin().then(refazer, nao)
        return
      }
      nao(erro)
    }
    const f = new FormData()
    f.append('imagem', arquivo, nome)
    xhr.send(f)
  })
}
