import { useId, useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import { PixelArte } from '../../arte/PixelArte'
import type { Grade } from '../../arte/pixel/grades'
import { Beck, type Papel } from '../../arte/realista/beck'
import { BOCA, CorpoAberto, Estatico, FundoTampa, LabioCamara, LadoTampa, PROPORCAO_CORPO, Rotor } from '../../arte/realista/dichavador-jogo'
import { Icone } from '../../componentes/comum'
import { T } from './textos'

// O palco do jogo: disco (tampa vista de cima) com o anel de 8 segmentos e o indicador às 12h; por trás, o corpo em
// 3/4 que aparece quando a "câmera deita", a boca da câmara, o beck e o lábio que fica por cima dele.
// Medidas em função de --d (diâmetro da caixa do disco): min(78vw, 44dvh, 340px), 250 px numa tela de 320.

/** Triângulo do indicador às 12h: 8×4 em escala 3 (24×12 px). */
const TRIANGULO: Grade = { w: 8, h: 4, linhas: ['xxxxxxxx', '.xxxxxx.', '..xxxx..', '...xx...'] }

export interface RefsPalco {
  palco: RefObject<HTMLDivElement | null>
  anel: RefObject<SVGSVGElement | null>
  corpo: RefObject<HTMLDivElement | null>
  beck: RefObject<HTMLDivElement | null>
  labio: RefObject<HTMLDivElement | null>
  tampa: RefObject<HTMLDivElement | null>
  lado: RefObject<HTMLDivElement | null>
  disco: RefObject<HTMLDivElement | null>
  rotor: RefObject<HTMLDivElement | null>
  indicador: RefObject<HTMLDivElement | null>
  dedo: RefObject<HTMLDivElement | null>
}

/** Posição do beck em pé, todo pra fora: base a 10% da altura acima do centro da boca. Altura = d/2, largura = d/8. */
export const BECK = { altura: 0.5, largura: 0.125, topo: BOCA.y - 0.55, esquerda: 0.5 - 0.0625 }
/** Quanto o beck desce (em % da própria altura) pra ficar todo escondido atrás do lábio da câmara. */
export const BECK_ESCONDIDO = ((0.55 + BOCA.ry) / BECK.altura) * 100

interface Props {
  refs: RefsPalco
  quartos: number
  /** 'girar': o jogo; 'parado': espera (anel apagado); 'travado': bloqueado (anel cinza, cadeado no lugar do indicador). */
  modo: 'girar' | 'parado' | 'travado'
  /** Aceita gesto e teclado (convite/girando). */
  interativo: boolean
  papel: Papel
  aoTecla?: (e: KeyboardEvent<HTMLDivElement>) => void
  aoSoltarTecla?: (e: KeyboardEvent<HTMLDivElement>) => void
  /** Mostra o dedo-guia e o adesivo "Gira a tampa" (convite). */
  convite: boolean
}

export function Palco({ refs, quartos, modo, interativo, papel, aoTecla, aoSoltarTecla, convite }: Props) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  // tamanho do palco em px: o anel desenha em px de verdade (traço de 3 px em qualquer tela)
  const [tam, setTam] = useState(0)
  useLayoutEffect(() => {
    const el = refs.palco.current
    if (!el) return
    const medir = () => setTam(el.offsetWidth)
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [refs.palco])
  const caixaCorpo = { left: 16, top: 16, width: 'var(--d)', height: `calc(var(--d) * ${PROPORCAO_CORPO.toFixed(4)})` }
  const caixaBeck = {
    left: `calc(16px + var(--d) * ${BECK.esquerda})`,
    top: `calc(16px + var(--d) * ${BECK.topo.toFixed(4)})`,
    width: `calc(var(--d) * ${BECK.largura})`,
    height: `calc(var(--d) * ${BECK.altura})`,
  }
  return (
    <div ref={refs.palco} className={`sorte-palco sorte-palco-${modo}${interativo ? ' sorte-palco-ativo' : ''}`} data-lenis-prevent>
      <Anel refAnel={refs.anel} acesos={modo === 'girar' ? quartos : 0} tamanho={Math.max(40, tam - 4)} />
      <div ref={refs.corpo} className="sorte-corpo" style={caixaCorpo} aria-hidden="true">
        <CorpoAberto id={`${id}c`} />
      </div>
      <div ref={refs.beck} className="sorte-beck" style={caixaBeck} aria-hidden="true">
        <Beck id={`${id}b`} papel={papel} />
      </div>
      <div ref={refs.labio} className="sorte-labio" style={caixaCorpo} aria-hidden="true">
        <LabioCamara id={`${id}l`} />
      </div>
      <div ref={refs.tampa} className="sorte-tampa">
        <div ref={refs.lado} className="sorte-lado" style={caixaCorpo} aria-hidden="true">
          <LadoTampa id={`${id}t`} />
        </div>
        <div
          ref={refs.disco}
          className="sorte-disco"
          {...(interativo
            ? {
                role: 'slider',
                tabIndex: 0,
                'aria-label': T.ariaTampa,
                'aria-valuemin': 0,
                'aria-valuemax': 8,
                'aria-valuenow': quartos,
                'aria-valuetext': T.valorTampa(quartos),
                onKeyDown: aoTecla,
                onKeyUp: aoSoltarTecla,
              }
            : { 'aria-hidden': true })}
        >
          <div className="sorte-camada sorte-fundo">
            <FundoTampa id={`${id}f`} />
          </div>
          <div ref={refs.rotor} className="sorte-camada sorte-rotor">
            <Rotor id={`${id}r`} />
          </div>
          <div className="sorte-camada sorte-estatico">
            <Estatico id={`${id}e`} />
          </div>
        </div>
      </div>
      <div ref={refs.indicador} className="sorte-indicador" aria-hidden="true">
        {modo === 'travado' ? <Icone nome="cadeado" tamanho={32} /> : <PixelArte grade={TRIANGULO} escala={3} />}
      </div>
      {convite && (
        <>
          <div ref={refs.dedo} className="sorte-dedo" aria-hidden="true">
            <Icone nome="dedo" tamanho={32} />
          </div>
          <p className="sorte-adesivo-gira" aria-hidden="true">
            <Icone nome="giro" tamanho={16} />
            <span>{T.adesivoGira}</span>
          </p>
        </>
      )}
    </div>
  )
}

/** Anel de 8 segmentos em volta do disco (a geometria do anel dos destaques, traço de 3 px). */
function Anel({ refAnel, acesos, tamanho }: { refAnel: RefObject<SVGSVGElement | null>; acesos: number; tamanho: number }) {
  const n = 8
  const t = tamanho
  const r = t / 2 - 1.5
  const c = 2 * Math.PI * r
  const folga = 6
  const seg = c / n - folga
  return (
    <svg ref={refAnel} className="sorte-anel" viewBox={`0 0 ${t} ${t}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <circle
          key={i}
          className={i < acesos ? 'aceso' : undefined}
          cx={t / 2}
          cy={t / 2}
          r={r}
          fill="none"
          strokeWidth={3}
          strokeDasharray={`${seg} ${c - seg}`}
          // o 1º segmento começa logo depois das 12h (a folga fica embaixo do indicador)
          strokeDashoffset={-(i * (c / n)) + c / 4 - folga / 2}
        />
      ))}
    </svg>
  )
}
