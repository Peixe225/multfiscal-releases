import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { posterEmPe } from 'virtual:rua-poster'
import { cliqueDeAba, hrefAba, irParaAba } from '../../lib/abas'
import { useUI } from '../../store/ui'
import { Icone } from '../comum'
import { avisoDoChamado, useCtaMercado } from './cta'
import { ALTURA, ANCORA, EM_PE, LARGURA_DEITADO, escalaDoAparelho, palcoEmPe, palcoFaixaStory } from './palco'
import type { AlcaRua, EstadoRua, RecorteStory } from './Rua'
import type { Chamado, Saco } from './roteiro'
import './StoryRua.css'

// A rua da loja como o primeiro story do Início do celular. O quadro mostra na hora o pôster (o quadro 0 da rua,
// desenhado no build) e a rua viva assume por cima quando o pedaço dela e os quadros do worker chegam, sem piscar: o
// primeiro quadro dela é o próprio pôster, no mesmo lugar e na mesma escala. Em pé, o mundo fixo de 176 × 281
// recortado no quadro (palco.ts); deitado, a faixa larga de sempre. O story manda: a rua só anda com o segmento dela à
// vista e tocando. Aqui ficam também o adesivo do pé ("Chega mais.") e o "Ver o Mercado" que sai quando chamam o
// mercador (o story segura enquanto ele está aberto).

const Rua = lazy(() => import('./Rua'))

/** Um pedaço que não baixou (4G oscilando) deixa o pôster parado, sem derrubar o story. */
class Guarda extends Component<{ children: ReactNode; aoFalhar: () => void }, { erro: boolean }> {
  state = { erro: false }
  static getDerivedStateFromError() {
    return { erro: true }
  }
  componentDidCatch() {
    this.props.aoFalhar()
  }
  render() {
    return this.state.erro ? null : this.props.children
  }
}

/** Entre o fim do cabeçalho e o balão; entre o pé dos personagens e os adesivos (px de CSS). */
const FOLGA_TOPO = 6
const FOLGA_PE = 4
/** Sem a rua pronta (rede lenta), o story corre com o pôster depois disto. */
const ESPERA_RUA = 4000

export interface PropsStoryRua {
  /** O segmento da rua é o que está no quadro (escondido, ela fica montada e parada: a cena continua na volta). */
  aqui: boolean
  /** À vista e tocando (o Hero decide: segmento, segurar, pausa, camada, tela, abertura). */
  ativa: boolean
  /** Celular deitado: a faixa larga, no quadro deitado. */
  deitado: boolean
  /** O texto do adesivo do pé. */
  legenda: string
  /** O adesivo do Mercado abriu ou fechou (o story segura enquanto ele está aberto). */
  aoSegurar: (s: boolean) => void
  /** A rua andando (ou a foto, ou desistiu de esperar): o tempo do segmento pode correr. */
  aoPronta: (p: boolean) => void
  /** O toque do story chega aqui (quem foi tocado reage; o mercador é chamado). */
  alca: RefObject<AlcaRua | null>
  /** A cena (o Hero anima a entrada e o arrasto nela). */
  refCena: RefObject<HTMLDivElement | null>
}

export function StoryRua({ aqui, ativa, deitado, legenda, aoSegurar, aoPronta, alca, refCena }: PropsStoryRua) {
  const pe = useRef<HTMLDivElement>(null)
  const [recorte, setRecorte] = useState<RecorteStory | null>(null)
  const saco = useRef<Saco>({ fila: [], ultimo: null }).current
  const [montar, setMontar] = useState(false)
  const [estado, setEstado] = useState<EstadoRua>('carregando')
  const cta = useCtaMercado()
  const [aviso, setAviso] = useState('')

  // o recorte: a escala inteira (3× de 360 px de largura em diante, 2× abaixo; a faixa deitada, 2× ou o que couber) e
  // onde o mundo fica no quadro — no meio na largura e com a linha de baixo da moto logo acima dos adesivos. Antes da
  // pintura
  useLayoutEffect(() => {
    const cena = refCena.current
    const quadro = cena?.parentElement
    if (!cena || !quadro) return
    const medir = () => {
      const wf = quadro.clientWidth
      const hf = quadro.clientHeight
      const linha = pe.current
      if (!wf || !hf || !linha || !aqui) return
      const dpr = window.devicePixelRatio || 1
      const snap = (v: number) => Math.round(v * dpr) / dpr
      const cab = quadro.querySelector<HTMLElement>('.hero-cab')
      const topo = cab ? cab.offsetTop + cab.offsetHeight + FOLGA_TOPO : 0
      const base = linha.offsetTop - FOLGA_PE
      let novo: RecorteStory
      if (deitado) {
        // 2× (px inteiros do aparelho); no celular deitado baixo, o que couber com a ponta do poste (a linha 1 da faixa)
        // abaixo do cabeçalho
        const cabe = Math.floor(((base - topo + FOLGA_TOPO) * dpr) / (ALTURA - 1))
        const kk = Math.max(1, Math.min(escalaDoAparelho(2, dpr), cabe))
        const px = kk / dpr
        const left = snap((wf - LARGURA_DEITADO * px) / 2)
        const top = snap(base - ALTURA * px)
        const palco = palcoFaixaStory(LARGURA_DEITADO)
        novo = { palco: { ...palco, visivel: { x0: Math.max(0, -left / px), x1: Math.min(LARGURA_DEITADO, (wf - left) / px) } }, kk, dpr, left, top, topo, base }
      } else {
        const kk = escalaDoAparelho(wf >= 360 ? 3 : 2, dpr)
        const px = kk / dpr
        const left = snap((wf - EM_PE.w * px) / 2)
        const top = snap(base - ANCORA * px)
        novo = { palco: palcoEmPe({ x0: -left / px, x1: (wf - left) / px }), kk, dpr, left, top, topo, base }
      }
      setRecorte((r) =>
        r && r.kk === novo.kk && r.dpr === novo.dpr && r.left === novo.left && r.top === novo.top && r.topo === novo.topo && r.base === novo.base && r.palco.emPe === novo.palco.emPe ? r : novo,
      )
    }
    medir()
    // o pé muda de lugar sem mudar de tamanho (o aviso de local no lugar da linha de resposta): quem acusa é o meio do
    // quadro, que encolhe ou cresce junto
    const ro = new ResizeObserver(medir)
    ro.observe(quadro)
    if (pe.current) ro.observe(pe.current)
    const meio = quadro.querySelector('.hero-meio')
    if (meio) ro.observe(meio)
    window.addEventListener('resize', medir)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', medir)
    }
  }, [deitado, aqui, refCena])

  // a rua viva baixa no primeiro respiro depois da abertura (o pôster segura a primeira tela; a abertura não divide o
  // processador com ela)
  const aberturaAtiva = useUI((s) => s.aberturaAtiva)
  useEffect(() => {
    if (montar || aberturaAtiva) return
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setMontar(true), { timeout: 1200 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = setTimeout(() => setMontar(true), 600)
    return () => clearTimeout(t)
  }, [montar, aberturaAtiva])

  // o tempo do segmento só corre com a rua pronta (como o story que espera a mídia carregar), ou ESPERA_RUA depois de
  // ela começar a baixar com o segmento à vista (rede lenta: o story segue com o pôster)
  const [cansou, setCansou] = useState(false)
  const baixando = montar && aqui
  useEffect(() => {
    if (!baixando || cansou) return
    const t = setTimeout(() => setCansou(true), ESPERA_RUA)
    return () => clearTimeout(t)
  }, [baixando, cansou])
  const pronta = estado !== 'carregando' || cansou
  useEffect(() => aoPronta(pronta), [pronta, aoPronta])
  useEffect(() => aoSegurar(cta.visivel), [cta.visivel, aoSegurar])

  const abrirCta = cta.abrir
  const aoChamar = useCallback(
    (c: Chamado, rodando: boolean) => {
      abrirCta()
      setAviso(avisoDoChamado(c, rodando))
    },
    [abrirCta],
  )
  const story = useMemo(
    () => (recorte ? { recorte, ativa, alca, aoChamar, aoEstado: setEstado, saco, legenda } : null),
    [recorte, ativa, alca, aoChamar, saco, legenda],
  )

  // o pôster da faixa (celular deitado) num pedaço à parte, de uns 2 KB: só quem deita baixa
  const [posterFaixa, setPosterFaixa] = useState<string | null>(null)
  useEffect(() => {
    if (!deitado || posterFaixa) return
    let vivo = true
    import('virtual:rua-poster-faixa').then(
      (m) => vivo && setPosterFaixa(m.posterFaixa),
      () => {},
    )
    return () => {
      vivo = false
    }
  }, [deitado, posterFaixa])

  const px = recorte ? recorte.kk / recorte.dpr : 0
  const poster = deitado ? posterFaixa : posterEmPe
  const viva = estado === 'rodando' || estado === 'parada' || estado === 'foto'

  return (
    <>
      <div
        ref={refCena}
        className={`rua-story${viva ? ' viva' : ''}`}
        role="group"
        aria-label="A rua da loja: o mercador atendendo"
        data-rua={estado}
        hidden={!aqui}
      >
        {recorte && poster && (
          <img
            className="rua-story-poster"
            src={poster}
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{ width: recorte.palco.w * px, height: recorte.palco.h * px, transform: `translate(${recorte.left}px, ${recorte.top}px)` }}
          />
        )}
        {montar && story && (
          <Guarda aoFalhar={() => setEstado('falhou')}>
            <Suspense fallback={null}>
              <Rua story={story} />
            </Suspense>
          </Guarda>
        )}
      </div>
      <div ref={pe} className="hero-adesivos rua-adesivos" hidden={!aqui}>
        <p className="adesivo-texto-bloco rua-frase">
          <span className="rua-frase-texto px">{legenda}</span>
        </p>
        {cta.visivel && (
          <a
            ref={cta.ref}
            className="adesivo-link toque rua-ver"
            href={hrefAba('catalogo')}
            onClick={(e) => {
              if (!cliqueDeAba(e)) return
              irParaAba('catalogo')
            }}
            onBlur={cta.esconder}
          >
            <Icone nome="link" tamanho={16} />
            Ver o Mercado
          </a>
        )}
      </div>
      <span className="sr-only rua-aviso" aria-live="polite">
        {cta.visivel ? aviso : ''}
      </span>
    </>
  )
}
