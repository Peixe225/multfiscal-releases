import { lazy, Suspense, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { useUI, type InterativoAberto } from '../store/ui'
import { CarregandoJogo, CascaInterativo } from './CascaInterativo'
import { interativoPorId, interativosAtivos, type Interativo as DefInterativo, type PropsJogo } from './registro'

// Camada dos interativos: escolhe o jogo no registro, baixa o pedaço dele (lazy) e põe dentro da casca.
// Esta camada já carrega no primeiro respiro do site; no respiro seguinte, baixa também os jogos ativos,
// pra estarem prontos quando a pessoa tocar.

const jogos = new Map<string, LazyExoticComponent<ComponentType<PropsJogo>>>()

function jogoDe(i: DefInterativo): LazyExoticComponent<ComponentType<PropsJogo>> | null {
  if (!i.carregar) return null
  let j = jogos.get(i.id)
  if (!j) {
    const carregar = i.carregar
    // falhou (rede): esquece o lazy, senão o React guarda a falha e nunca mais tenta
    j = lazy(() =>
      carregar().catch((erro: unknown) => {
        jogos.delete(i.id)
        throw erro
      }),
    )
    jogos.set(i.id, j)
  }
  return j
}

// pré-carga no respiro do navegador
{
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
  const baixar = () => interativosAtivos().forEach((i) => void i.carregar?.().catch(() => undefined))
  if (w.requestIdleCallback) w.requestIdleCallback(baixar, { timeout: 2500 })
  else setTimeout(baixar, 1200)
}

export function Interativo() {
  const pedido = useUI((s) => s.interativo)
  const fechar = useUI((s) => s.fecharInterativo)
  // o que está na tela (fica montado durante a saída) e quantas vezes abriu (cada abertura começa do zero)
  const [vista, setVista] = useState<{ aberto: InterativoAberto; vez: number; saindo: boolean } | null>(pedido ? { aberto: pedido, vez: 1, saindo: false } : null)
  if (!pedido && vista && !vista.saindo) setVista({ ...vista, saindo: true })
  if (pedido && pedido !== vista?.aberto) {
    // reabriu (do zero ou no meio da saída): monta de novo; trocou só a tela com a camada aberta: a mesma montagem
    setVista({ aberto: pedido, vez: !vista || vista.saindo ? (vista?.vez ?? 0) + 1 : vista.vez, saindo: false })
  }
  if (!vista) return null
  const i = interativoPorId(vista.aberto.id)
  const Jogo = i && i.status === 'ativo' && i.ativo() ? jogoDe(i) : null
  if (!i || !Jogo) {
    if (pedido) queueMicrotask(fechar)
    return null
  }
  return (
    <CascaInterativo key={`${i.id}-${vista.vez}`} interativo={i} aberto={!!pedido} aoFechar={fechar} aoSair={() => setVista((v) => (v?.saindo ? null : v))}>
      <Suspense fallback={<CarregandoJogo />}>
        <Jogo tela={vista.aberto.tela} />
      </Suspense>
    </CascaInterativo>
  )
}
