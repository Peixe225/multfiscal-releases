import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import 'lenis/dist/lenis.css'
import { liberarArtesRealistas } from './arte/realista/carregar'
import { vigiarTeclado } from './lib/ambiente'
import { gravarSessao, lerSessao } from './lib/armazenamento'
import { movimentoReduzido, ponteiroFino } from './lib/movimento'
import { iniciarAbas } from './lib/abas'
import { quandoEmpilharem } from './lib/historico'
import { registrarLenis } from './lib/rolagem'
import { atualizarParametros, lerParametros } from './lib/url'
import { carregarPlanilha, produtoPorId, useCatalogo } from './store/catalogo'
import { useChat } from './store/chat'
import { iniciarLocal } from './store/local'
import { useUI } from './store/ui'
import { interativoPorParam } from './interativos/registro'
import { Abertura, Saida, idadeLembrada } from './componentes/Abertura'
import { Vistas } from './componentes/Abas'
import { BarraAbas } from './componentes/BarraAbas'
import { Aviso, Lateral } from './componentes/Lateral'
import { TopoLocal } from './componentes/Local'
import './estilos/layout.css'

gsap.registerPlugin(ScrollTrigger)

// abas antes do primeiro render: a vista da URL (?aba=) já monta por trás da abertura
iniciarAbas()

// Camadas que só aparecem com toque: carregam depois da primeira tela (durante a abertura).
// Cada uma tem o próprio Suspense (uma camada lenta não segura a página do produto) e a própria guarda de erro: um
// pedaço que não baixa (soluço da rede no 4G) só deixa aquela camada fechada, com aviso, em vez de derrubar o site.

/**
 * Baixa a camada tentando de novo antes de desistir (a rede do celular oscila). O navegador guarda a falha de um
 * import() e não busca o mesmo endereço outra vez: a nova tentativa vai no endereço do pedaço (que vem na mensagem do
 * erro, no Chrome e no Firefox) com um ?tentativa= no fim.
 */
function tentar<M>(carregar: () => Promise<M>, vezes = 3, n = 1): Promise<M> {
  return carregar().catch((erro: unknown) => {
    if (n >= vezes) return Promise.reject(erro)
    const url = String((erro as Error)?.message ?? '').match(/https?:\/\/\S+?\.js/)?.[0]
    const deNovo = url ? () => import(/* @vite-ignore */ `${url}?tentativa=${Date.now()}`) as Promise<M> : carregar
    return new Promise<M>((ok, falha) => setTimeout(() => tentar(deNovo, vezes, n + 1).then(ok, falha), 700 * n))
  })
}

/** lazy() que pode ser refeito: o React guarda a falha do import e nunca mais tentaria. */
function camadaPreguicosa<M>(carregar: () => Promise<M>, pegar: (m: M) => ComponentType) {
  const criar = () => lazy(() => tentar(carregar).then((m) => ({ default: pegar(m) })))
  let atual = criar()
  return {
    Componente: () => {
      const C = atual
      return <C />
    },
    refazer: () => {
      atual = criar()
    },
  }
}

const StoryProduto = camadaPreguicosa(() => import('./componentes/StoryProduto'), (m) => m.StoryProduto)
// interativos ("Teste minha sorte"): antes da página do produto, que abre por cima do jogo ("Ver produto")
const InterativoCamada = camadaPreguicosa(() => import('./interativos/Interativo'), (m) => m.Interativo)
const ProdutoPagina = camadaPreguicosa(() => import('./componentes/ProdutoPagina'), (m) => m.ProdutoPagina)
const InfoStory = camadaPreguicosa(() => import('./componentes/InfoStory'), (m) => m.InfoStory)
const ChatFolha = camadaPreguicosa(() => import('./componentes/Chat'), (m) => m.ChatFolha)
const SacolaFolha = camadaPreguicosa(() => import('./componentes/Sacola'), (m) => m.SacolaFolha)
// Minha conta: por cima da sacola ("ver todos")
const ContaFolha = camadaPreguicosa(() => import('./componentes/ContaFolha'), (m) => m.ContaFolha)
const SeletorFolha = camadaPreguicosa(() => import('./componentes/Seletor'), (m) => m.SeletorFolha)
const ConfirmarTroca = camadaPreguicosa(() => import('./componentes/ConfirmarTroca'), (m) => m.ConfirmarTroca)

interface PropsCamada {
  camada: { Componente: ComponentType; refazer: () => void }
  /** A pessoa pediu a camada agora (tocou): se falhou antes, tenta de novo. */
  pedida: boolean
  /** Fecha a camada no estado (ela não vai aparecer). */
  fechar: () => void
}

class Camada extends Component<PropsCamada, { erro: boolean }> {
  state = { erro: false }
  static getDerivedStateFromError() {
    return { erro: true }
  }
  componentDidCatch() {
    // falhou com a camada pedida: fecha (nada fica travado esperando) e avisa; baixando de reserva, fica calado
    if (this.props.pedida) {
      this.props.fechar()
      useUI.getState().avisar('Sem conexão pra abrir agora. Tenta de novo.')
    }
  }
  componentDidUpdate(antes: PropsCamada) {
    if (this.state.erro && this.props.pedida && !antes.pedida) {
      this.props.camada.refazer()
      this.setState({ erro: false })
    }
  }
  render(): ReactNode {
    if (this.state.erro) return null
    const { Componente } = this.props.camada
    return (
      <Suspense fallback={null}>
        <Componente />
      </Suspense>
    )
  }
}

/** As camadas, cada uma com a guarda dela (só os "aberta?" chegam aqui: o resto da store não re-renderiza as camadas). */
function Camadas() {
  const story = useUI((s) => !!s.story)
  const pagina = useUI((s) => !!s.pagina)
  const info = useUI((s) => s.infoAberto)
  const sacola = useUI((s) => s.sacolaAberta)
  const seletor = useUI((s) => s.seletorAberto)
  const troca = useUI((s) => !!s.trocaPendente)
  const interativo = useUI((s) => !!s.interativo)
  const conta = useUI((s) => s.contaAberta)
  const chat = useChat((s) => s.aberto)
  const ui = useUI.getState
  return (
    <>
      <Camada camada={StoryProduto} pedida={story} fechar={() => ui().fecharStory()} />
      <Camada camada={InterativoCamada} pedida={interativo} fechar={() => ui().fecharInterativo()} />
      <Camada camada={ProdutoPagina} pedida={pagina} fechar={() => ui().fecharPagina()} />
      <Camada camada={InfoStory} pedida={info} fechar={() => ui().setInfo(false)} />
      <Camada camada={ChatFolha} pedida={chat} fechar={() => useChat.getState().fechar()} />
      <Camada camada={SacolaFolha} pedida={sacola} fechar={() => ui().setSacola(false)} />
      <Camada camada={ContaFolha} pedida={conta} fechar={() => ui().setConta(false)} />
      <Camada camada={SeletorFolha} pedida={seletor} fechar={() => ui().setSeletor(false)} />
      <Camada camada={ConfirmarTroca} pedida={troca} fechar={() => ui().setTroca(null)} />
    </>
  )
}

/** Monta as camadas no primeiro respiro do navegador, ou na hora se alguém já pediu uma delas. */
function useCamadasProntas(): boolean {
  const pedida = useUI(
    (s) => !!s.story || !!s.pagina || s.sacolaAberta || s.seletorAberto || s.infoAberto || !!s.trocaPendente || !!s.interativo || s.contaAberta,
  )
  const chat = useChat((s) => s.aberto)
  const [pronto, setPronto] = useState(false)
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(() => setPronto(true), { timeout: 1200 })
    else setTimeout(() => setPronto(true), 600)
  }, [])
  return pronto || pedida || chat
}

const TRES_HORAS = 3 * 3600 * 1000

/** Voltou do WhatsApp com um pedido montado? Reabre o pedido em vez de tocar a abertura de novo. */
function voltandoDoWhatsApp(): boolean {
  const c = useChat.getState()
  return !!c.enviadoEm && Date.now() - c.enviadoEm < TRES_HORAS && (c.passo === 'resumo' || c.passo === 'enc-resumo')
}

export function App() {
  const [abertura, setAbertura] = useState(() => {
    if (lerSessao('gc-abertura') && idadeLembrada()) return false
    if (voltandoDoWhatsApp() && idadeLembrada()) return false
    return true
  })
  const [saida, setSaida] = useState(false)
  // "Trocar" na pergunta do palpite, dentro da abertura: o seletor abre quando ela sai (ver o efeito pós-abertura)
  const trocarDepois = useRef(false)
  const setAberturaUI = useUI((s) => s.setAbertura)
  const setInfo = useUI((s) => s.setInfo)
  // estável: o catálogo é memo e não re-renderiza quando o App re-renderiza
  const abrirInfo = useCallback(() => setInfo(true), [setInfo])
  const camadas = useCamadasProntas()

  useEffect(() => {
    void iniciarLocal()
    void carregarPlanilha()
  }, [])

  useEffect(() => setAberturaUI(abertura || saida), [abertura, saida, setAberturaUI])

  // ilustrações realistas: sem abertura, baixa já; com abertura, a própria abertura libera no quadro parado.
  // Reserva: 8 s depois de montar libera de qualquer jeito (abertura presa no logo, aba em segundo plano…).
  useEffect(() => {
    if (!abertura) {
      liberarArtesRealistas()
      return
    }
    const t = setTimeout(liberarArtesRealistas, 8000)
    return () => clearTimeout(t)
  }, [abertura])

  // teclado virtual: as folhas sobem junto (ver --teclado)
  useEffect(() => vigiarTeclado(), [])

  // rolagem suave só com mouse (no celular, a nativa; nunca briga com o arrastar do story)
  useEffect(() => {
    if (!ponteiroFino() || movimentoReduzido()) return
    let vivo = true
    let desfazer = () => {}
    // Lenis só no desktop: o celular nem baixa
    void import('lenis').then(({ default: Lenis }) => {
      if (!vivo) return
      const lenis = new Lenis({ lerp: 0.12 })
      registrarLenis(lenis)
      lenis.on('scroll', ScrollTrigger.update)
      const tick = (t: number) => lenis.raf(t * 1000)
      gsap.ticker.add(tick)
      gsap.ticker.lagSmoothing(0)
      desfazer = () => {
        gsap.ticker.remove(tick)
        lenis.destroy()
        registrarLenis(null)
      }
    })
    return () => {
      vivo = false
      desfazer()
    }
  }, [])

  // depois da abertura: link direto do story (?p=), da página do produto (?produto=), do interativo (?jogo=) e do chat
  // (?chat=pedido|encomenda); volta do WhatsApp
  useEffect(() => {
    if (abertura || saida) return
    const p = lerParametros()
    if (voltandoDoWhatsApp()) {
      // só o pedido reabre: o ?produto=/?p=/?jogo= que ficou na URL não pode reabrir nada depois (recarregar)
      atualizarParametros({ produto: null, p: null, jogo: null })
      useChat.getState().abrir(useChat.getState().modo)
      // "Trocar" na abertura (o +18 tinha vencido): o seletor abre por cima do pedido
      if (trocarDepois.current) {
        trocarDepois.current = false
        quandoEmpilharem(1, () => useUI.getState().setSeletor(true))
      }
      return
    }
    if (p.p) {
      const produtos = useCatalogo.getState().produtos
      const i = produtos.findIndex((x) => x.id === p.p)
      if (i >= 0) {
        const daCat = produtos.filter((x) => x.categoria === produtos[i].categoria)
        useUI.getState().abrirStory(
          daCat.map((x) => x.id),
          daCat.findIndex((x) => x.id === p.p),
        )
      }
    }
    // página do produto por cima (link aberto numa aba nova cai aqui depois do +18; "Voltar" fecha na aba da URL).
    // Recarregou com níveis empilhados? A entrada do histórico guardou a pilha inteira (ver ProdutoPagina).
    if (p.produto && !useUI.getState().pagina) {
      if (produtoPorId(p.produto)) {
        const guardada: unknown = history.state?.gcPagina
        const pilha =
          Array.isArray(guardada) && guardada.length <= 12 && guardada[guardada.length - 1] === p.produto && guardada.every((id) => typeof id === 'string' && produtoPorId(id))
            ? (guardada as string[])
            : [p.produto]
        const origem = useUI.getState().story ? 'story' : 'link'
        pilha.forEach((id) => useUI.getState().abrirPagina(id, origem))
      } else atualizarParametros({ produto: null })
    }
    // interativo (?jogo=sorte): abre depois do +18; sem prêmio ativo (ou jogo desconhecido), o parâmetro sai da URL
    if (p.jogo) {
      const i = interativoPorParam(p.jogo)
      if (i?.ativo()) useUI.getState().abrirInterativo(i.id)
      else atualizarParametros({ jogo: null })
    }
    if (p.chat === 'pedido' || p.chat === 'encomenda') useChat.getState().abrir(p.chat)
    // "Trocar" na abertura: o seletor fica por cima de tudo o que o link abriu, também no histórico. As camadas
    // entram no histórico quando o pedaço delas carrega, então ele espera elas entrarem
    if (trocarDepois.current) {
      trocarDepois.current = false
      const ui = useUI.getState()
      const pedidas = (ui.story ? 1 : 0) + (ui.pagina?.pilha.length ?? 0) + (ui.interativo ? 1 : 0) + (useChat.getState().aberto ? 1 : 0)
      quandoEmpilharem(pedidas, () => useUI.getState().setSeletor(true))
    }
    requestAnimationFrame(() => ScrollTrigger.refresh())
  }, [abertura, saida])

  const fimAbertura = useCallback((trocarEstado: boolean) => {
    trocarDepois.current = trocarEstado
    gravarSessao('gc-abertura', '1')
    setAbertura(false)
  }, [])

  return (
    <>
      {abertura && !saida && <Abertura aoTerminar={fimAbertura} aoSair={() => setSaida(true)} />}
      {saida && (
        <Saida
          voltar={() => {
            setSaida(false)
            setAbertura(true)
          }}
        />
      )}
      <div className="app" inert={abertura || saida}>
        <Lateral />
        <TopoLocal />
        <main className="principal" id="principal">
          <Vistas abrirInfo={abrirInfo} />
        </main>
        <BarraAbas />
      </div>
      {camadas && <Camadas />}
      <Aviso />
    </>
  )
}
