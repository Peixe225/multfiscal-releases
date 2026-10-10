import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { prenderTab } from '../lib/foco'
import { useCamadaNoHistorico } from '../lib/historico'
import { movimentoReduzido } from '../lib/movimento'
import { useProgresso } from '../lib/progresso'
import { liberarRolagem, travarRolagem } from '../lib/rolagem'
import { Avatar, Icone, tempoDoCatalogo } from './comum'
import './StoryShell.css'

interface Props {
  id: string
  total: number
  indice: number
  irPara: (i: number) => void
  fechar: () => void
  /** Retângulo de onde o story nasce (card tocado). */
  origem: DOMRect | null
  /** Seletor do elemento para onde o story volta ao fechar. */
  alvoVolta?: (i: number) => HTMLElement | null
  duracaoMs: number
  /** Pausa externa (chat aberto, interação com adesivo...). */
  pausadoFora?: boolean
  instagram: string | null
  rotuloCabecalho?: string
  menu?: ReactNode
  /** Quadro atual (9:16). */
  quadro: ReactNode
  /** Área sob o quadro (legenda + barra de resposta). */
  rodape?: ReactNode
  /** Vizinhos para o desktop (miniaturas). */
  vizinho?: (i: number) => ReactNode
  rotulo: string
}

/** A casca do story: quadro 9:16, barrinhas, cabeçalho, gestos (toque, segurar, arrastar), teclado, entrada e saída. */
export function StoryShell(p: Props) {
  const { total, indice, irPara, fechar } = p
  const raiz = useRef<HTMLDivElement>(null)
  const quadro = useRef<HTMLDivElement>(null)
  const fundo = useRef<HTMLDivElement>(null)
  const [segurando, setSegurando] = useState(false)
  const [pausaManual, setPausaManual] = useState(false)
  const [oculto, setOculto] = useState(false)
  const [saindo, setSaindo] = useState(false)
  const reduz = movimentoReduzido()
  /** Quando o story abriu: o 2º toque de um toque duplo no card (o "curtir" do Instagram) não passa o produto. */
  const abertoEm = useRef(performance.now())
  /** Quem tinha o foco ao abrir (o card, o destaque): o foco volta pra ele ao fechar. */
  const voltaFoco = useRef<HTMLElement | null>(null)
  const indiceRef = useRef(indice)
  indiceRef.current = indice
  const alvoVoltaRef = useRef(p.alvoVolta)
  alvoVoltaRef.current = p.alvoVolta

  useCamadaNoHistorico(true, p.id, () => sair())

  const proximo = useCallback(() => {
    if (indice < total - 1) irPara(indice + 1)
    else sair()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indice, total, irPara])
  const anterior = useCallback(() => {
    if (indice > 0) irPara(indice - 1)
  }, [indice, irPara])

  const ativo = !reduz && !segurando && !pausaManual && !oculto && !p.pausadoFora && !saindo
  const barra = useProgresso({ ativo, duracaoMs: p.duracaoMs, chave: indice, aoTerminar: proximo })

  // aba escondida pausa
  useEffect(() => {
    const vis = () => setOculto(document.hidden)
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [])

  // trava a rolagem da página
  useEffect(() => {
    travarRolagem()
    return () => liberarRolagem()
  }, [])

  // ao fechar, o foco volta pro card do produto que estava no story (ou pra quem abriu), não pro começo da página;
  // com outra camada por cima (página do produto, folha), ela cuida do foco
  useEffect(
    () => () => {
      if (document.querySelector('.folha:not(.folha-saindo), .pp:not(.pp-saindo)')) return
      const card = alvoVoltaRef.current?.(indiceRef.current)
      const alvo = [card, voltaFoco.current].find((el) => el?.isConnected && !el.closest('.story'))
      alvo?.focus({ preventScroll: true })
    },
    [],
  )

  // entrada: o card cresce até virar o story (voz app)
  useLayoutEffect(() => {
    const q = quadro.current
    const f = fundo.current
    if (!q || !f) return
    abertoEm.current = performance.now()
    voltaFoco.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    if (reduz) {
      q.focus({ preventScroll: true })
      return
    }
    gsap.fromTo(f, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none' })
    const o = p.origem
    if (o && o.width > 0) {
      const r = q.getBoundingClientRect()
      gsap.fromTo(
        q,
        { x: o.left - r.left, y: o.top - r.top, scale: o.width / r.width, transformOrigin: '0 0' },
        { x: 0, y: 0, scale: 1, duration: 0.52, ease: 'expo.out', clearProps: 'transform' },
      )
    } else {
      gsap.fromTo(q, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.32, ease: 'power3.out', clearProps: 'transform,opacity' })
    }
    q.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sair = useCallback(() => {
    if (saindo) return
    setSaindo(true)
    const q = quadro.current
    const f = fundo.current
    if (!q || !f || reduz) {
      fechar()
      return
    }
    const alvo = p.alvoVolta?.(indice)
    const ar = alvo?.getBoundingClientRect()
    const visivel = ar && ar.bottom > 0 && ar.top < window.innerHeight && ar.width > 0
    gsap.to(f, { opacity: 0, duration: 0.28, ease: 'none' })
    if (visivel && ar) {
      const r = q.getBoundingClientRect()
      gsap.to(q, {
        x: ar.left - r.left,
        y: ar.top - r.top,
        scale: ar.width / r.width,
        transformOrigin: '0 0',
        duration: 0.38,
        ease: 'power3.inOut',
        onComplete: fechar,
      })
    } else {
      gsap.to(q, { y: 40, scale: 0.9, opacity: 0, duration: 0.26, ease: 'power3.in', onComplete: fechar })
    }
  }, [saindo, fechar, indice, p, reduz])

  // teclado: setas, Esc, espaço
  useEffect(() => {
    const t = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement
      if (alvo?.closest('input, textarea')) return
      if (document.querySelector('.folha')) return // chat/sacola por cima
      if (e.key === 'ArrowRight') proximo()
      else if (e.key === 'ArrowLeft') anterior()
      else if (e.key === 'Escape') sair()
      else if (e.key === ' ' && !alvo?.closest('button, a')) {
        e.preventDefault()
        setPausaManual((v) => !v)
      }
    }
    window.addEventListener('keydown', t)
    return () => window.removeEventListener('keydown', t)
  }, [proximo, anterior, sair])

  // gestos na zona da imagem: toque lateral, segurar para pausar, arrastar para baixo para fechar
  const g = useRef<{ x: number; y: number; t: number; arrastando: boolean; segurou: boolean; timer: number } | null>(null)
  const aoDescer = (e: React.PointerEvent<HTMLDivElement>) => {
    // adesivos e botões não navegam (um toque que erra o "−" não pode passar o produto)
    if ((e.target as HTMLElement).closest('button, a, input, .sq-adesivos')) return
    // logo depois de abrir (enquanto a entrada anima), o toque é o 2º de um toque duplo no card: não passa nem volta
    if (performance.now() - abertoEm.current < 550) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const timer = window.setTimeout(() => {
      if (g.current) {
        g.current.segurou = true
        setSegurando(true)
      }
    }, 200)
    g.current = { x: e.clientX, y: e.clientY, t: performance.now(), arrastando: false, segurou: false, timer }
  }
  const aoMover = (e: React.PointerEvent) => {
    const s = g.current
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!s.arrastando && dy > 12 && Math.abs(dy) > Math.abs(dx)) {
      s.arrastando = true
      clearTimeout(s.timer)
      setSegurando(true)
    }
    if (s.arrastando && quadro.current && fundo.current) {
      const d = Math.max(0, dy)
      gsap.set(quadro.current, { y: d, scale: 1 - Math.min(0.15, d / 1200), transformOrigin: '50% 0' })
      gsap.set(fundo.current, { opacity: 1 - Math.min(0.8, d / 400) })
    }
  }
  const aoSoltar = (e: React.PointerEvent) => {
    const s = g.current
    g.current = null
    if (!s) return
    clearTimeout(s.timer)
    const dy = e.clientY - s.y
    if (s.arrastando) {
      const v = dy / Math.max(1, performance.now() - s.t)
      if (dy > 120 || v > 0.6) sair()
      else {
        setSegurando(false)
        if (quadro.current) gsap.to(quadro.current, { y: 0, scale: 1, duration: 0.3, ease: 'power3.out' })
        if (fundo.current) gsap.to(fundo.current, { opacity: 1, duration: 0.3 })
      }
      return
    }
    if (s.segurou) {
      setSegurando(false)
      return
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (e.clientX - r.left < r.width / 3) anterior()
    else proximo()
  }

  return (
    <div
      ref={raiz}
      className={`story ${segurando ? 'segurando' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={p.rotulo}
      // Tab dá a volta dentro do story (não vai parar no site por trás)
      onKeyDown={(e) => prenderTab(e, raiz.current)}
    >
      <div ref={fundo} className="story-fundo cortina" onClick={sair} aria-hidden="true" />
      <div className="story-coluna">
        {p.vizinho && indice > 0 && (
          <button type="button" className="story-vizinho story-vizinho-esq" onClick={anterior} aria-label="Story anterior" tabIndex={-1}>
            <span aria-hidden="true">{p.vizinho(indice - 1)}</span>
          </button>
        )}
        {p.vizinho && indice < total - 1 && (
          <button type="button" className="story-vizinho story-vizinho-dir" onClick={proximo} aria-label="Próximo story" tabIndex={-1}>
            <span aria-hidden="true">{p.vizinho(indice + 1)}</span>
          </button>
        )}
        <div ref={quadro} className="story-quadro" tabIndex={-1} onContextMenu={(e) => e.preventDefault()}>
          <div className="story-barras" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className="story-barra">
                <i
                  ref={i === indice ? (el) => { barra.current = el } : undefined}
                  style={{ transform: i < indice || (reduz && i === indice) ? 'scaleX(1)' : 'scaleX(0)' }}
                />
              </span>
            ))}
          </div>
          <div className="story-cab">
            <Avatar tamanho={32} />
            <span className="story-cab-nome">{p.rotuloCabecalho ?? p.instagram ?? 'Green Cheese Imports'}</span>
            {tempoDoCatalogo() && <span className="story-cab-tempo">{tempoDoCatalogo()}</span>}
            <span className="story-cab-espaco" />
            <button
              type="button"
              className="icone-botao toque"
              onClick={() => setPausaManual((v) => !v)}
              aria-label={pausaManual ? 'Continuar' : 'Pausar'}
              aria-pressed={pausaManual}
            >
              <Icone nome={pausaManual ? 'play' : 'pausa'} tamanho={18} />
            </button>
            {p.menu}
            <button type="button" className="icone-botao toque" onClick={sair} aria-label="Fechar story">
              <Icone nome="fechar" tamanho={20} />
            </button>
          </div>
          {/* toque: 1/3 da esquerda volta, o resto avança; segurar pausa; arrastar para baixo fecha */}
          <div className="story-palco" onPointerDown={aoDescer} onPointerMove={aoMover} onPointerUp={aoSoltar} onPointerCancel={aoSoltar}>
            {p.quadro}
          </div>
          <span className="sr-only" aria-live="polite">
            {`Story ${indice + 1} de ${total}`}
          </span>
        </div>
        {p.rodape && <div className="story-rodape">{p.rodape}</div>}
        <button type="button" className="story-seta story-seta-esq toque" onClick={anterior} disabled={indice === 0} aria-label="Anterior">
          <Icone nome="seta-esq" tamanho={20} />
        </button>
        <button type="button" className="story-seta story-seta-dir toque" onClick={proximo} aria-label={indice === total - 1 ? 'Fechar' : 'Próximo'}>
          <Icone nome="seta-dir" tamanho={20} />
        </button>
      </div>
    </div>
  )
}
