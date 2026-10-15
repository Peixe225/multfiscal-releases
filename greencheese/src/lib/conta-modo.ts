import { useSyncExternalStore } from 'react'
import { useContaStore } from '../store/conta'

// Qual conta vale neste aparelho: a do servidor da loja (entrar com o WhatsApp + código que o WhatsApp da loja manda)
// ou a só do aparelho (a de sempre). Quem decide é o servidor, no GET recursos: com o motor de aviso ligado no painel,
// conta no servidor; sem ele (ou sem servidor nenhum: o arquivo único, o zip sem api/, o PHP desligado), no aparelho.
// Fica no pedaço principal (a lateral mostra "Entrar" no modo servidor) e só baixa a resposta no tempo ocioso, uma
// vez por visita (guardada 5 min na sessão). O adaptador (conta-adaptador.ts) segue o modo daqui.
// Quando o modo vira servidor com uma conta do aparelho aberta, ela sai da tela e espera a pessoa confirmar o número
// (paraMigrar): no primeiro login ela vai junto (nome, cupons que valem, prêmio reservado, dias de giro).

export type ModoConta = 'local' | 'servidor'

const API = './api/index.php?r=recursos'
const CHAVE_SESSAO = 'gc-recursos'
const VALE_MS = 5 * 60_000
const ESPERA_MS = 6_000

const st = () => useContaStore.getState()

let modo: ModoConta = st().servidor ? 'servidor' : 'local'
let codigoLigado = false
let descoberto = false
let promessa: Promise<ModoConta> | null = null
const ouvintes = new Set<() => void>()

function avisar() {
  ouvintes.forEach((f) => f())
}

function aplicar(novo: ModoConta, ligado: boolean) {
  codigoLigado = ligado
  descoberto = true
  if (novo === 'servidor') {
    // a conta do aparelho aberta sai da tela até a pessoa confirmar o número (vai junto no primeiro login)
    const s = st()
    if (s.atual && s.atual !== s.servidor) useContaStore.setState({ paraMigrar: s.atual, atual: null })
  }
  if (novo !== modo) {
    modo = novo
  }
  avisar()
}

/** O servidor diz que a sessão da conta morreu (saiu em outro aparelho, a conta foi apagada, 90 dias sem usar). */
export function sessaoDoServidorCaiu() {
  const s = st()
  if (!s.servidor) return
  const contas = { ...s.contas }
  delete contas[s.servidor]
  useContaStore.setState({ contas, atual: s.atual === s.servidor ? null : s.atual, servidor: null, enderecos: [] })
}

/** Aqui não tem servidor nenhum (o arquivo único da prévia, a página aberta do disco). */
function semServidorAqui(): boolean {
  try {
    return __ARQUIVO_UNICO__ || location.protocol === 'file:'
  } catch {
    return true
  }
}

function lerGuardado(): { em: number; codigo: boolean; sessao: boolean } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) ?? 'null') as { em: number; codigo: boolean; sessao: boolean } | null
    return v && typeof v.em === 'number' && Date.now() - v.em < VALE_MS && Date.now() >= v.em ? v : null
  } catch {
    return null
  }
}

function guardar(codigo: boolean, sessao: boolean) {
  try {
    sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ em: Date.now(), codigo, sessao }))
  } catch {
    /* sem armazenamento: pergunta de novo na próxima */
  }
}

/** Decide o modo pelo que o servidor respondeu (codigo: dá pra entrar por código; sessao: tem sessão viva). */
function decidir(codigo: boolean, sessao: boolean): ModoConta {
  if (st().servidor && !sessao) sessaoDoServidorCaiu()
  // sessão viva sem a conta no cache (o navegador limpou o armazenamento e ficou o cookie): a conta volta quando o
  // adaptador estiver aqui (ele baixa com o jogo, a Minha conta e o pedido guiado; daqui não se importa ele, pra não
  // mudar os pedaços da primeira tela)
  restaurar = sessao && !st().servidor
  if (restaurar) aoRestaurar?.()
  return codigo || sessao ? 'servidor' : 'local'
}

let restaurar = false
let aoRestaurar: (() => void) | null = null

/** O adaptador se registra: busca a conta de volta quando o servidor disser que a sessão está viva sem ela no cache. */
export function registrarRestauro(f: () => void) {
  aoRestaurar = f
  if (restaurar) f()
}

/**
 * Pergunta ao servidor (uma vez por visita; forcar = de novo, ex.: depois de entrar ou sair). Sem resposta em 6 s, sem
 * servidor ou resposta torta: vale o aparelho, e uma conta do servidor que já estava aberta continua (a sessão é
 * conferida na próxima).
 */
export function descobrirModo(forcar = false): Promise<ModoConta> {
  if (promessa && !forcar) return promessa
  if (semServidorAqui()) {
    aplicar('local', false)
    return (promessa = Promise.resolve(modo))
  }
  const g = forcar ? null : lerGuardado()
  if (g) {
    aplicar(decidir(g.codigo, g.sessao), g.codigo)
    return (promessa = Promise.resolve(modo))
  }
  promessa = (async () => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ESPERA_MS)
    try {
      const r = await fetch(API, { signal: ctrl.signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      const j = (await r.json()) as { ok?: boolean; contas?: { codigo?: unknown; sessao?: unknown } }
      if (!r.ok || j?.ok !== true || typeof j.contas?.codigo !== 'boolean') throw new Error('resposta')
      const sessao = j.contas.sessao === true
      guardar(j.contas.codigo, sessao)
      aplicar(decidir(j.contas.codigo, sessao), j.contas.codigo)
    } catch {
      aplicar(st().servidor ? 'servidor' : 'local', false)
    } finally {
      clearTimeout(t)
    }
    return modo
  })()
  return promessa
}

/** Esquece o que estava guardado (entrou, saiu, apagou): a próxima pergunta vai ao servidor. */
export function esquecerRecursos() {
  try {
    sessionStorage.removeItem(CHAVE_SESSAO)
  } catch {
    /* nada guardado */
  }
}

/** O modo de agora (sem esperar o servidor). */
export function modoConta(): ModoConta {
  return modo
}

/** Já perguntou ao servidor nesta visita? */
export function modoDescoberto(): boolean {
  return descoberto
}

/** Entrar com código está ligado no servidor (pra mostrar "Entrar" fora do jogo). */
export function entrarPorCodigo(): boolean {
  return codigoLigado
}

/** O adaptador muda o modo na hora (entrou: servidor; o servidor desligou o código: aparelho). */
export function definirModo(novo: ModoConta) {
  if (novo === modo) return
  modo = novo
  avisar()
}

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => {
    ouvintes.delete(f)
  }
}

/** O modo, pra tela redesenhar quando o servidor responder. */
export function useModoConta(): ModoConta {
  return useSyncExternalStore(assinar, modoConta, modoConta)
}

/** Dá pra entrar por código agora (a lateral e o Por estado mostram "Entrar" só assim). */
export function useEntrarPorCodigo(): boolean {
  return useSyncExternalStore(assinar, entrarPorCodigo, entrarPorCodigo)
}
