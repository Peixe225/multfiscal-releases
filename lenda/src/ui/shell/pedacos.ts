/**
 * Pedaços do jogo que chegam sob demanda (telas por rota, conquistas, partes do site), com nova tentativa
 * quando a rede falha.
 *
 *   const hall = pedaco(() => import('@/ui/shared/hall/HallScreen'), 'HallScreen')
 *   <hall.atual />                    // o lazy de agora (troca depois de cada falha)
 *   hall.falhou(erro)                 // a tela não veio: o próximo `atual` busca o arquivo de novo
 *   hall.precarregar()                // baixa sem montar (sem conexão agora: nem tenta)
 *   ehFalhaDeCarga(erro)              // o arquivo não veio (rede/deploy), e não um erro de código
 *
 * Por que tudo isto (conferido no Chromium 141 do celular):
 *  - o React.lazy guarda a promessa rejeitada para sempre: depois de uma falha, só um lazy novo tenta de novo;
 *  - o navegador guarda a falha do import() por endereço até recarregar a página, e vale também para uma
 *    dependência que falhou e para o <link rel=modulepreload> que o Vite põe antes. Por isso, SEM conexão
 *    (navigator.onLine === false) o pedaço nem é pedido: a falha vem na hora (SemConexao), nada fica marcado
 *    como quebrado, e quando a rede volta o import() normal funciona;
 *  - com conexão e o arquivo não veio (4G que cai sem o aparelho perceber): a nova tentativa recoloca as folhas
 *    de estilo que não carregaram (o pré-carregamento do Vite marca o CSS como "visto" e não tenta de novo) e
 *    busca o próprio arquivo com "?tentativa=…" (o endereço vem da mensagem de erro; o Chrome e o Firefox põem,
 *    o Safari não — lá repete o import()). Se uma dependência ficou marcada, nem assim: quem mostra a tela
 *    (ErrorBoundary) confere se a internet voltou de verdade e recarrega a página (o progresso está salvo).
 *
 * Cada falha é marcada com a "geração" do lazy que falhou: `falhou()` só troca o lazy quando a falha é DESTE
 * pedaço (um lazy de dentro da tela que caiu não faz a tela buscar o arquivo errado).
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

/** O arquivo não veio: as mensagens do Chrome, Firefox, Safari e do próprio Vite (a mesma lista do main.tsx e mais). */
export const PEDACO_NAO_VEIO = /dynamically imported module|Importing a module script failed|Unable to preload CSS|error loading dynamically imported module|Load failed|NetworkError|Failed to fetch/i

/** O aparelho está sem conexão: o pedaço nem foi pedido (assim o navegador não guarda a falha). */
export class SemConexao extends Error {
  constructor(o = 'o arquivo não foi pedido') {
    super(`Sem conexão: ${o}`)
    this.name = 'SemConexao'
  }
}

export const semConexaoAgora = () => typeof navigator !== 'undefined' && navigator.onLine === false

const mensagem = (e: unknown) => String((e as { message?: unknown } | null)?.message ?? e ?? '')

/** O arquivo de um pedaço não veio (rede, deploy novo), e não um erro de código dentro dele. */
export function ehFalhaDeCarga(e: unknown): boolean {
  return (e as { name?: unknown } | null)?.name === 'SemConexao' || PEDACO_NAO_VEIO.test(mensagem(e))
}

/** Endereço do .js que não veio, tirado da mensagem do navegador (só do próprio site). */
export function enderecoDaFalha(e: unknown, origem = typeof location !== 'undefined' ? location.origin : ''): string | null {
  const m = /(https?:\/\/[^\s'"?#]+?\.js)\b/.exec(mensagem(e))
  if (!m) return null
  try {
    return new URL(m[1]).origin === origem ? m[1] : null
  } catch {
    return null
  }
}

/**
 * Folhas de estilo que não carregaram (sem `sheet`): troca cada uma por uma cópia, que busca o arquivo de novo.
 * Nunca falha e espera no máximo `espera` ms: uma folha de outra parte do jogo que não veio não pode impedir esta
 * tela de abrir (ela só ficaria sem o estilo da outra parte).
 */
export function recolocarEstilosQueFalharam(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined, espera = 4000): Promise<void> {
  if (!doc) return Promise.resolve()
  const falhas = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')].filter((l) => !l.sheet && l.dataset.lxDeNovo !== '1')
  if (!falhas.length) return Promise.resolve()
  const todas = Promise.allSettled(
    falhas.map(
      (velho) =>
        new Promise<void>((ok, falha) => {
          const novo = velho.cloneNode() as HTMLLinkElement
          novo.dataset.lxDeNovo = '1'
          novo.addEventListener('load', () => {
            velho.remove()
            delete novo.dataset.lxDeNovo
            ok()
          })
          novo.addEventListener('error', () => {
            novo.remove()
            falha(new Error(`Unable to preload CSS for ${velho.href}`))
          })
          velho.after(novo)
        }),
    ),
  ).then(() => undefined)
  return Promise.race([todas, new Promise<void>((ok) => setTimeout(ok, espera))])
}

/** Sem conexão agora: falha na hora, sem pedir nada. */
export function comConexao<T>(carregar: () => Promise<T>): Promise<T> {
  return semConexaoAgora() ? Promise.reject(new SemConexao()) : carregar()
}

/** A nova tentativa depois de `antes` (ver o topo): estilos de novo, depois o arquivo com "?tentativa=" ou o import() de novo. */
export async function importarDeNovo<T>(carregar: () => Promise<T>, antes: unknown): Promise<T> {
  if (semConexaoAgora()) throw new SemConexao()
  await recolocarEstilosQueFalharam()
  const url = enderecoDaFalha(antes)
  if (!url) return carregar()
  return (await import(/* @vite-ignore */ `${url}?tentativa=${Date.now()}`)) as T
}

/** A internet voltou de verdade? Um pedido pequeno, sem cache (até 6 s). Sem `fetch`: confia no navigator.onLine. */
export async function internetVoltou(): Promise<boolean> {
  if (semConexaoAgora()) return false
  if (typeof fetch !== 'function' || typeof location === 'undefined') return true
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const t = setTimeout(() => ctl?.abort(), 6000)
  try {
    const r = await fetch(new URL(`./?conexao=${Date.now()}`, location.href).href, { cache: 'no-store', signal: ctl?.signal })
    return r.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

type Modulo = Record<string, unknown>
type Carregar = () => Promise<unknown>

export interface Pedaco<P extends object = object> {
  /** O componente de agora (um lazy novo depois de cada falha deste pedaço). */
  readonly atual: LazyExoticComponent<ComponentType<P>>
  /** Uma falha deste pedaço: o próximo `atual` busca o arquivo de novo. Devolve false se a falha não era dele. */
  falhou(erro: unknown): boolean
  /** Baixa sem montar. Sem conexão agora: não tenta (nada fica marcado como quebrado). */
  precarregar(): void
}

interface Geracao<P extends object> {
  lazy: LazyExoticComponent<ComponentType<P>>
  /** A busca desta geração (a mesma promessa para a pré-carga e para o lazy). */
  buscar: () => Promise<{ default: ComponentType<P> }>
}

/** De qual geração (de qual pedaço) veio cada falha. */
const origem = new WeakMap<object, object>()

/**
 * Um pedaço com nova tentativa. `carregar` é o import() do módulo; o componente é o `default` ou o export
 * `nome` (as telas usam um ou outro).
 */
export function pedaco<P extends object = object>(carregar: Carregar, nome?: string): Pedaco<P> {
  /** A falha que vale para a próxima tentativa (a que traz o endereço do arquivo, se alguma trouxe). */
  let antes: unknown = null
  const pegar = (m: unknown): { default: ComponentType<P> } => {
    const mod = (m ?? {}) as Modulo
    const C = (mod.default ?? (nome ? mod[nome] : undefined)) as ComponentType<P> | undefined
    if (!C) throw new Error(`O pedaço "${nome ?? '?'}" não exporta um componente.`)
    return { default: C }
  }
  const nova = (): Geracao<P> => {
    const erroAntes = antes
    let promessa: Promise<{ default: ComponentType<P> }> | null = null
    const g = {} as Geracao<P>
    g.buscar = () =>
      (promessa ??= (erroAntes == null ? comConexao(carregar) : importarDeNovo(carregar, erroAntes)).then(pegar, (e: unknown) => {
        const erro = e !== null && typeof e === 'object' ? e : new Error(String(e))
        origem.set(erro, g)
        throw erro
      }))
    g.lazy = lazy(g.buscar)
    return g
  }
  let atual = nova()
  const trocar = (erro: unknown) => {
    // o endereço do arquivo de uma falha anterior continua valendo se esta não trouxe (Safari, "sem conexão")
    if (antes == null || enderecoDaFalha(erro) || !enderecoDaFalha(antes)) antes = erro
    atual = nova()
  }
  return {
    get atual() {
      return atual.lazy
    },
    falhou(erro) {
      if (erro === null || typeof erro !== 'object' || origem.get(erro) !== atual) return false
      trocar(erro)
      return true
    },
    precarregar() {
      if (semConexaoAgora()) return
      const g = atual
      g.buscar().catch((e: unknown) => {
        if (atual === g) trocar(e)
      })
    },
  }
}
