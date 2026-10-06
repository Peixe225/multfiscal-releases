import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { canais, canalDa } from '../dados/canais'
import { interativosAtivos } from '../interativos/registro'
import { focarBusca, irParaAba, ultimaTroca, type Aba } from '../lib/abas'
import { FOCAVEIS } from '../lib/foco'
import { movimentoReduzido } from '../lib/movimento'
import { obterLenis } from '../lib/rolagem'
import { useCatalogo } from '../store/catalogo'
import { useChat } from '../store/chat'
import { useDisponiveis } from '../store/derivados'
import { nomeCidade, useLocal } from '../store/local'
import { useUI } from '../store/ui'
import { AdesivoInterativo } from './AdesivoInterativo'
import { Catalogo } from './Catalogo'
import { Icone } from './comum'
import { Faixa } from './Faixa'
import { Hero } from './Hero'
import { Perfil } from './Perfil'
import { PorEstado } from './PorEstado'
import { Reposts, Rodape, TextoReposts } from './Rodape'
import { SemAtendimento } from './SemAtendimento'
import './Abas.css'

gsap.registerPlugin(ScrollTrigger)

// As três vistas do site, sempre no mesmo app (a barra de baixo do celular e a lateral do computador trocam):
//   Início: o story + perfil (e a faixa dos @). A home termina aí, com o rodapé.
//   Catálogo: destaques, busca, grade, encomenda e, no fim, o interativo e os reposts.
//   Por estado: os perfis de cada estado.
// Escondidas com hidden + inert (fora do Tab e do leitor de tela). O Início fica sempre montado; o Catálogo monta
// no primeiro respiro depois da abertura (ou na primeira visita) e não desmonta mais (busca, filtro e o story aberto
// continuam onde estavam); Por estado monta na primeira visita.
// Trocar de aba precisa ser instantâneo num Android médio: o catálogo tem ~7 mil elementos (a pixel art é <rect>).
//   - a vista escondida usa content-visibility: hidden (Abas.css), não display:none: o navegador guarda o estilo e o
//     layout dela e mostrar de novo não recalcula nada. O hero e o mercador continuam pausando sozinhos (o
//     IntersectionObserver vê a vista escondida como fora da tela, igual ao display:none).
//   - o Catálogo, montado no respiro, ganha um quadro "aquecendo" (fora do fluxo, recortado em altura zero): o estilo e
//     o layout dele saem no tempo ocioso, e a 1ª visita também não trava.
//   - o conteúdo de cada vista é memo: trocar de aba não re-renderiza o catálogo nem o hero.

const TITULO_ORIGINAL = typeof document !== 'undefined' ? document.title : ''
const TITULOS: Record<Aba, string | null> = {
  inicio: null,
  catalogo: 'Catálogo · Green Cheese Imports',
  estados: 'Por estado · Green Cheese Imports',
}

/**
 * Para onde vai o foco ao abrir a vista: o h1 visível (o título do Catálogo, o do perfil), a não ser que algo focável
 * venha antes dele — no Início, o story do celular e o card do mercador da Home 2 ficam antes do perfil. Aí vai a
 * própria vista (região "Início"), e o Tab seguinte segue a ordem da tela em vez de pular o que vem antes do título.
 */
function alvoDoFoco(vista: HTMLElement): HTMLElement {
  const h1 = [...vista.querySelectorAll<HTMLElement>('h1')].find((h) => h.getClientRects().length > 0)
  if (!h1) return vista
  const antes = [...vista.querySelectorAll<HTMLElement>(FOCAVEIS)].some(
    (el) => el.tabIndex >= 0 && el.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING && el.getClientRects().length > 0,
  )
  return antes ? vista : h1
}

export function Vistas({ abrirInfo }: { abrirInfo: () => void }) {
  const aba = useUI((s) => s.aba)
  const aberturaAtiva = useUI((s) => s.aberturaAtiva)
  const [catalogo, setCatalogo] = useState(aba === 'catalogo')
  const [estados, setEstados] = useState(aba === 'estados')
  // o Catálogo montado no respiro passa um quadro "aquecendo" (ver o comentário do topo)
  const [aquecendo, setAquecendo] = useState(false)
  if (aba === 'catalogo' && !catalogo) setCatalogo(true)
  if (aba === 'estados' && !estados) setEstados(true)

  // o Catálogo monta no primeiro respiro depois da abertura: a troca de aba fica instantânea
  useEffect(() => {
    if (aberturaAtiva || catalogo) return
    const montar = () => {
      setCatalogo(true)
      setAquecendo(true)
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(montar, { timeout: 2500 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = setTimeout(montar, 1200)
    return () => clearTimeout(t)
  }, [aberturaAtiva, catalogo])

  // aquecendo: um quadro para o navegador calcular estilo e layout do catálogo (o 1º requestAnimationFrame roda antes
  // desse quadro, o 2º depois dele); aí ele volta a ser só escondido, com o layout guardado
  useEffect(() => {
    if (!aquecendo) return
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setAquecendo(false))
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [aquecendo])

  // depois de pintar a aba nova: rolagem (topo, ou a de antes no voltar), gatilhos de rolagem, entrada, foco e título
  const primeira = useRef(true)
  useLayoutEffect(() => {
    document.title = TITULOS[aba] ?? TITULO_ORIGINAL
    if (primeira.current) {
      primeira.current = false
      return
    }
    const t = ultimaTroca()
    const y = t.origem === 'volta' ? t.y : 0
    const lenis = obterLenis()
    // o Lenis sobrescreve o window.scrollTo: com ele, quem rola é ele
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true })
    else window.scrollTo(0, y)
    const raf = requestAnimationFrame(() => ScrollTrigger.refresh())
    const vista = document.querySelector<HTMLElement>(`.vista[data-vista="${aba}"]`)
    // entrada (voz app) pela Web Animations: não lê o estilo calculado, então não força o layout dentro do commit
    if (vista && !movimentoReduzido() && typeof vista.animate === 'function') {
      vista.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    }
    if (vista && t.origem !== 'boot') {
      if (t.foco === 'busca') focarBusca(false)
      else if (t.foco === 'titulo') alvoDoFoco(vista).focus({ preventScroll: true })
    }
    return () => cancelAnimationFrame(raf)
  }, [aba])

  return (
    <>
      <div className="vista vista-inicio" data-vista="inicio" role="region" aria-label="Início" hidden={aba !== 'inicio'} inert={aba !== 'inicio'} tabIndex={-1}>
        <ConteudoInicio />
      </div>
      {catalogo && (
        <div
          className="vista"
          data-vista="catalogo"
          data-aquecendo={aquecendo && aba !== 'catalogo' ? '' : undefined}
          hidden={aba !== 'catalogo'}
          // sem inert enquanto aquece (2 quadros, recortado em altura zero): o estilo calculado já sai como o da vista
          // aberta; trocar o inert depois recalcularia os 7 mil filhos na 1ª visita
          inert={aba !== 'catalogo' && !aquecendo}
          tabIndex={-1}
        >
          <AbaCatalogo abrirInfo={abrirInfo} />
        </div>
      )}
      {estados && (
        <div className="vista" data-vista="estados" hidden={aba !== 'estados'} inert={aba !== 'estados'} tabIndex={-1}>
          <AbaEstados />
        </div>
      )}
      <RodapeFixo />
    </>
  )
}

/** Início: o hero (ou o aviso de estado sem entrega), a faixa dos @ e, no celular, o perfil embaixo. */
const ConteudoInicio = memo(function ConteudoInicio() {
  const uf = useLocal((s) => s.uf)
  const comEntrega = !uf || !!canalDa(uf)
  return (
    <>
      {comEntrega ? <Hero /> : <SemAtendimento />}
      <Faixa />
      {comEntrega && (
        <div className="so-celular">
          <Perfil />
        </div>
      )}
    </>
  )
})

const RodapeFixo = memo(Rodape)

/** Título de seção no fim do catálogo (INTERATIVO, MARCADOS): fio em cima, rótulo pequeno em caixa-alta. */
function TituloSecao({ id, icone, children }: { id: string; icone: string; children: string }) {
  return (
    <h2 id={id} className="aba-secao-titulo">
      <Icone nome={icone} tamanho={16} />
      {children}
    </h2>
  )
}

/** Aba Catálogo: título com a contagem, o catálogo e, no fim, o interativo e os reposts. */
const AbaCatalogo = memo(function AbaCatalogo({ abrirInfo }: { abrirInfo: () => void }) {
  const { uf, cidade, cidadeInformada } = useLocal()
  const canal = canalDa(uf)
  const total = useCatalogo((s) => s.produtos.length)
  const disp = useDisponiveis().length
  if (uf && !canal) return <CatalogoSemEntrega />
  const lugar = canal ? (nomeCidade(canal, cidade, cidadeInformada) ?? canal.nome) : null
  const legenda = canal ? `${disp} disponíveis em ${lugar} · ${total} produtos` : `${total} produtos · ${canais.map((c) => c.uf.toUpperCase()).join(' · ')}`
  const interativo = interativosAtivos().length > 0
  return (
    <div className="aba-pagina aba-catalogo">
      <header className="aba-cab">
        <h1 id="catalogo-titulo" className="aba-titulo px" tabIndex={-1}>
          Catálogo
        </h1>
        <p className="aba-legenda legenda">{legenda}</p>
      </header>
      <Catalogo abrirInfo={abrirInfo} />
      <div className={`aba-fim${interativo ? '' : ' aba-fim-um'}`}>
        {interativo && (
          <section className="aba-secao" aria-labelledby="secao-interativo">
            <TituloSecao id="secao-interativo" icone="dichavador">
              Interativo
            </TituloSecao>
            <AdesivoInterativo />
          </section>
        )}
        <section className="aba-secao" aria-labelledby="secao-marcados">
          <TituloSecao id="secao-marcados" icone="instagram">
            Marcados
          </TituloSecao>
          <Reposts texto={false} />
        </section>
      </div>
      <TextoReposts />
    </div>
  )
})

/** Catálogo num estado sem entrega: sem vitrine, com o caminho para os estados atendidos e para a encomenda. */
function CatalogoSemEntrega() {
  const abrir = useChat((s) => s.abrir)
  return (
    <div className="aba-pagina aba-catalogo">
      <header className="aba-cab">
        <h1 id="catalogo-titulo" className="aba-titulo px" tabIndex={-1}>
          Catálogo
        </h1>
      </header>
      <div className="sem-entrega">
        <h2 className="sem-entrega-titulo">Esse estado ainda não tem entrega.</h2>
        <p className="sem-entrega-texto legenda">Dá pra encomendar ou ver onde a Green Cheese já entrega.</p>
        <div className="sem-entrega-botoes">
          <button type="button" className="botao botao-cheio toque" onClick={() => irParaAba('estados')}>
            Ver estados
          </button>
          <button type="button" className="botao botao-contorno toque" onClick={() => abrir('encomenda')}>
            Pedir encomenda
          </button>
        </div>
      </div>
    </div>
  )
}

/** Aba Por estado: a mesma moldura, com o PorEstado como vier. */
const AbaEstados = memo(function AbaEstados() {
  return (
    <div className="aba-pagina aba-estados">
      <h1 className="sr-only" tabIndex={-1}>
        Por estado
      </h1>
      <PorEstado />
    </div>
  )
})
