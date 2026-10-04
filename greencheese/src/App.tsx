import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import 'lenis/dist/lenis.css'
import { canalDa } from './dados/canais'
import { gravarSessao, lerSessao } from './lib/armazenamento'
import { movimentoReduzido, ponteiroFino } from './lib/movimento'
import { registrarLenis } from './lib/rolagem'
import { lerParametros } from './lib/url'
import { carregarPlanilha, useCatalogo } from './store/catalogo'
import { useChat } from './store/chat'
import { iniciarLocal, useLocal } from './store/local'
import { useUI } from './store/ui'
import { Abertura, Saida, idadeLembrada } from './componentes/Abertura'
import { BarraMensagem } from './componentes/BarraMensagem'
import { Catalogo } from './componentes/Catalogo'
import { Faixa } from './componentes/Faixa'
import { Hero } from './componentes/Hero'
import { Aviso, Lateral, SeloPrevia } from './componentes/Lateral'
import { TopoLocal } from './componentes/Local'
import { Perfil } from './componentes/Perfil'
import { PorEstado } from './componentes/PorEstado'
import { Reposts, Rodape } from './componentes/Rodape'
import { SemAtendimento } from './componentes/SemAtendimento'
import './estilos/layout.css'

gsap.registerPlugin(ScrollTrigger)

// Camadas que só aparecem com toque: carregam depois da primeira tela (durante a abertura).
const StoryProduto = lazy(() => import('./componentes/StoryProduto').then((m) => ({ default: m.StoryProduto })))
const InfoStory = lazy(() => import('./componentes/InfoStory').then((m) => ({ default: m.InfoStory })))
const ChatFolha = lazy(() => import('./componentes/Chat').then((m) => ({ default: m.ChatFolha })))
const SacolaFolha = lazy(() => import('./componentes/Sacola').then((m) => ({ default: m.SacolaFolha })))
const SeletorFolha = lazy(() => import('./componentes/Seletor').then((m) => ({ default: m.SeletorFolha })))
const PainelPrevia = lazy(() => import('./componentes/Lateral').then((m) => ({ default: m.PainelPrevia })))

/** Monta as camadas no primeiro respiro do navegador, ou na hora se alguém já pediu uma delas. */
function useCamadasProntas(): boolean {
  const pedida = useUI((s) => !!s.story || s.sacolaAberta || s.seletorAberto || s.infoAberto || s.painelPrevia)
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
  const uf = useLocal((s) => s.uf)
  const canal = canalDa(uf)
  const setAberturaUI = useUI((s) => s.setAbertura)
  const setInfo = useUI((s) => s.setInfo)
  const camadas = useCamadasProntas()

  useEffect(() => {
    void iniciarLocal()
    void carregarPlanilha()
  }, [])

  useEffect(() => setAberturaUI(abertura || saida), [abertura, saida, setAberturaUI])

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

  // depois da abertura: link direto de produto (?p=) e de chat (?chat=pedido|encomenda); volta do WhatsApp
  useEffect(() => {
    if (abertura || saida) return
    const p = lerParametros()
    if (voltandoDoWhatsApp()) {
      useChat.getState().abrir(useChat.getState().modo)
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
    if (p.chat === 'pedido' || p.chat === 'encomenda') useChat.getState().abrir(p.chat)
    requestAnimationFrame(() => ScrollTrigger.refresh())
  }, [abertura, saida])

  const fimAbertura = useCallback(() => {
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
        <SeloPrevia />
        <main className="principal" id="principal">
          {uf && !canal ? <SemAtendimento /> : <Hero />}
          <Faixa />
          {(!uf || canal) && (
            <>
              <div className="so-celular">
                <Perfil />
              </div>
              <Catalogo abrirInfo={() => setInfo(true)} />
              <Reposts />
            </>
          )}
          <PorEstado />
          <Rodape />
        </main>
        <BarraMensagem />
      </div>
      {camadas && (
        <Suspense fallback={null}>
          <StoryProduto />
          <InfoStory />
          <ChatFolha />
          <SacolaFolha />
          <SeletorFolha />
          <PainelPrevia />
        </Suspense>
      )}
      <Aviso />
    </>
  )
}
