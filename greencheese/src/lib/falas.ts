// Falas do pedido guiado com as trocas do dono (GET r=pedido-textos, API.md). O texto de sempre mora em
// src/dados/textos-pedido.ts; aqui ficam só as trocas, guardadas no aparelho com a versão (ETag) do servidor. O chat
// pede de novo cada vez que abre (If-None-Match: igual = 304, sem corpo, no máximo 1 vez por minuto); sem servidor,
// ou enquanto a resposta não chega, vale o que o aparelho já tinha (na primeira vez, as de sempre).
import { create } from 'zustand'
import { problemaDaFala, pedacosDaFala, preencher, TEXTOS_PEDIDO, type ChaveTexto, type Pedaco } from '../dados/textos-pedido'
import { gravar, ler } from './armazenamento'

type Trocas = Partial<Record<ChaveTexto, string>>
interface Guardado {
  versao: string
  textos: Trocas
}

const CHAVE = 'gc-falas'
const API = './api/index.php?r=pedido-textos'
const LIMITE_MS = 6000
const INTERVALO_MS = 60_000

/** Só as trocas que este site entende: chave conhecida, marcadores da lista, no tamanho, sem promessa. */
function aceitas(bruto: unknown): Trocas {
  const out: Trocas = {}
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return out
  for (const [chave, texto] of Object.entries(bruto as Record<string, unknown>)) {
    if (!(chave in TEXTOS_PEDIDO) || typeof texto !== 'string') continue
    const c = chave as ChaveTexto
    if (problemaDaFala(c, texto) === null) out[c] = texto
  }
  return out
}

function lerGuardado(): Guardado | null {
  const g = ler<Guardado | null>(CHAVE, null)
  return g && typeof g.versao === 'string' ? { versao: g.versao, textos: aceitas(g.textos) } : null
}

const guardado = lerGuardado()

export const useFalas = create<{ trocas: Trocas; versao: string | null }>(() => ({
  trocas: guardado?.textos ?? {},
  versao: guardado?.versao ?? null,
}))

function semServidorAqui(): boolean {
  try {
    return __ARQUIVO_UNICO__ || location.protocol === 'file:'
  } catch {
    return false
  }
}

let buscando: Promise<void> | null = null
let ultima = 0

/** Pergunta ao servidor se o dono trocou alguma fala (o chat chama ao abrir). Nunca lança: sem resposta, fica como está. */
export function atualizarFalas(): Promise<void> {
  if (semServidorAqui()) return Promise.resolve()
  if (buscando) return buscando
  if (Date.now() - ultima < INTERVALO_MS) return Promise.resolve()
  ultima = Date.now()
  buscando = (async () => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    const t = setTimeout(() => ctrl?.abort(), LIMITE_MS)
    try {
      const { versao } = useFalas.getState()
      const r = await fetch(API, {
        headers: versao ? { Accept: 'application/json', 'If-None-Match': versao } : { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'same-origin',
        signal: ctrl?.signal,
      })
      if (r.status === 304 || !r.ok) return
      const j = (await r.json()) as { ok?: unknown; textos?: unknown; versao?: unknown }
      if (j?.ok !== true || typeof j.versao !== 'string') return
      const novo = { versao: j.versao, textos: aceitas(j.textos) }
      gravar(CHAVE, novo)
      useFalas.setState({ trocas: novo.textos, versao: novo.versao })
    } catch {
      /* sem servidor, rede caída ou JSON torto: segue com o que tem */
    } finally {
      clearTimeout(t)
      buscando = null
    }
  })()
  return buscando
}

export type Valores = Record<string, string | null | undefined>

/** O {nome} das falas: o primeiro nome, como a loja chama no chat ("Ian", não "Ian Teste"). */
export function primeiroNome(nome: string): string {
  const n = nome.trim()
  const primeiro = n.split(/\s+/)[0] ?? ''
  return primeiro.length >= 2 ? primeiro : n
}

/** O texto da fala agora (a troca do dono ou o de sempre). */
export function textoDaFala(trocas: Trocas, chave: ChaveTexto): string {
  return trocas[chave] ?? TEXTOS_PEDIDO[chave].padrao
}

/** As falas da hora: t = texto puro com os marcadores preenchidos; p = os pedaços (pra desenhar um marcador diferente). */
export function useFala(): { t: (chave: ChaveTexto, valores?: Valores) => string; p: (chave: ChaveTexto, valores?: Valores) => Pedaco[] } {
  const trocas = useFalas((s) => s.trocas)
  return {
    t: (chave, valores = {}) => preencher(textoDaFala(trocas, chave), valores),
    p: (chave, valores = {}) => pedacosDaFala(textoDaFala(trocas, chave), valores),
  }
}
