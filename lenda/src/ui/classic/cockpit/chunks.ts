/**
 * Pedaços da carreira que chegam sob demanda (abas Temporada · Prêmios · Mundo e o resumo): pré-carga enquanto
 * há rede e nova tentativa quando um deles não veio.
 *
 * O motor é local: sem internet a pessoa continua escolhendo e vendo a tabela. Só o código das abas (e o CSS
 * delas) e o do resumo vêm do servidor na primeira vez. Por isso, assim que a carreira abre, o jogo baixa esses
 * pedaços num momento ocioso: depois disso eles estão no mapa de módulos do navegador e abrem mesmo sem rede.
 *
 * Quando um pedaço não veio: o React.lazy guarda a rejeição para sempre (cada nova tentativa ganha um lazy
 * novo) e o navegador também guarda a falha do import() por endereço até recarregar (Chrome 141 conferido:
 * nem a dependência que falhou volta). A nova tentativa: (1) recoloca as folhas de estilo que não carregaram
 * (o pré-carregamento do Vite marca o CSS como "visto" e não tenta de novo); (2) repete o import() de antes;
 * (3) se ainda falhar, busca o arquivo do erro com "?tentativa=…" (vale quando foi o próprio arquivo da aba que
 * não veio). Se nem assim, quem mostra a aba oferece recarregar a página (a carreira está salva no aparelho).
 */
import type { ComponentType } from 'react'

export type TabKey = 'temporada' | 'premios' | 'mundo'
type Loader = () => Promise<{ default: ComponentType }>

export const TAB_LOADERS: Record<TabKey, Loader> = {
  temporada: () => import('@/ui/classic/tabs/SeasonTab'),
  premios: () => import('@/ui/classic/tabs/AwardsTab'),
  mundo: () => import('@/ui/classic/tabs/WorldTab'),
}

/** Erro de "o arquivo não veio" (rede/deploy), e não um erro de código dentro do módulo. */
export const CHUNK_FALHOU = /dynamically imported module|Importing a module script failed|Unable to preload CSS|error loading dynamically imported module|Load failed|NetworkError/i
export const ehFalhaDePedaco = (e: unknown) => CHUNK_FALHOU.test(String((e as { message?: unknown } | null)?.message ?? e ?? ''))

/** Endereço do .js que não veio, tirado da mensagem do navegador (só do próprio site). Chrome e Firefox põem; o Safari não. */
export function enderecoDoErro(e: unknown, origem = typeof location !== 'undefined' ? location.origin : ''): string | null {
  const m = /(https?:\/\/[^\s'"?#]+?\.js)\b/.exec(String((e as { message?: unknown } | null)?.message ?? ''))
  if (!m) return null
  try {
    return new URL(m[1]).origin === origem ? m[1] : null
  } catch {
    return null
  }
}

/** Folhas de estilo que não carregaram (sem `sheet`): troca cada uma por uma cópia, que busca o arquivo de novo. */
export function recolocarEstilosQueFalharam(doc: Document = document): Promise<void> {
  const falhas = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')].filter((l) => !l.sheet && l.dataset.lendaDeNovo !== '1')
  return Promise.all(
    falhas.map(
      (velho) =>
        new Promise<void>((ok, falha) => {
          const novo = velho.cloneNode() as HTMLLinkElement
          novo.dataset.lendaDeNovo = '1'
          novo.addEventListener('load', () => {
            velho.remove()
            delete novo.dataset.lendaDeNovo
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
}

/** Import com nova tentativa (ver o topo). `ultimoErro` = a falha anterior (de onde sai o endereço do arquivo). */
export async function importarDeNovo<T>(carregar: () => Promise<T>, ultimoErro?: unknown): Promise<T> {
  await recolocarEstilosQueFalharam()
  try {
    return await carregar()
  } catch (e) {
    const url = enderecoDoErro(e) ?? enderecoDoErro(ultimoErro)
    if (!url) throw e
    return (await import(/* @vite-ignore */ `${url}?tentativa=${Date.now()}`)) as T
  }
}

let preCarregou = false
/**
 * Baixa, num momento ocioso, as 3 abas (com o CSS delas) e o resumo. Uma vez por página; sem rede agora, tenta
 * de novo quando ela voltar. Falha em silêncio (a aba mostra o aviso dela se a pessoa abrir sem rede).
 */
export function preCarregarPedacosDaCarreira(extra: () => void = () => {}): void {
  if (preCarregou || typeof window === 'undefined') return
  const ir = () => {
    if (preCarregou) return
    if (navigator.onLine === false) {
      window.addEventListener('online', () => agendar(), { once: true })
      return
    }
    preCarregou = true
    extra()
    const falhou = () => {
      if (!preCarregou) return
      preCarregou = false
      window.addEventListener('online', () => agendar(), { once: true })
    }
    for (const k of Object.keys(TAB_LOADERS) as TabKey[]) void TAB_LOADERS[k]().catch(falhou)
  }
  const agendar = () => {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    // o ocioso pode demorar (revelação animando): o setTimeout é a reserva
    let feito = false
    const uma = () => {
      if (feito) return
      feito = true
      ir()
    }
    if (ric) ric(uma, { timeout: 4000 })
    window.setTimeout(uma, 4500)
  }
  agendar()
}

/** Só para os testes. */
export function _zerarPreCarga() {
  preCarregou = false
}
