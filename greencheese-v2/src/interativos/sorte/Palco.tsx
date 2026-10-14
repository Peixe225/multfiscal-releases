import { memo, useId, useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import { PixelArte } from '../../arte/PixelArte'
import type { Grade } from '../../arte/pixel/grades'
import { CorpoAberto, Estatico, FundoTampa, LabioCamara, LadoTampa, PROPORCAO_CORPO, Rotor } from '../../arte/realista/dichavador-jogo'
import { Icone } from '../../componentes/comum'
import { T } from './textos'

// O palco do jogo: disco (tampa vista de cima) com o anel de 8 segmentos e o indicador às 12h; por trás, o corpo em
// 3/4 que aparece quando a "câmera deita", a boca da câmara e o lábio por cima dela. Dentro da câmara mora o beck
// bolado: quando a tampa sai, a fumaça (RevelacaoFumaca, na mesma grade de pixel dela) desenha ele subindo de dentro da
// boca (a borda da frente recorta o pé dele) até o meio da tela, e o dichavador cai pelo pé do quadro (revelar.ts).
// Medidas em função de --d (diâmetro da caixa do disco): min(78vw, 44dvh, 340px), 250 px numa tela de 320.

/** Altura do beck dentro da câmara, em diâmetros do disco (a fumaça desenha ele saindo daqui: origemDoBeck). */
export const BECK_ALT = 0.7

/** Triângulo do indicador às 12h: 8×4 em escala 3 (24×12 px). */
const TRIANGULO: Grade = { w: 8, h: 4, linhas: ['xxxxxxxx', '.xxxxxx.', '..xxxx..', '...xx...'] }

export interface RefsPalco {
  palco: RefObject<HTMLDivElement | null>
  anel: RefObject<SVGSVGElement | null>
  corpo: RefObject<HTMLDivElement | null>
  labio: RefObject<HTMLDivElement | null>
  tampa: RefObject<HTMLDivElement | null>
  lado: RefObject<HTMLDivElement | null>
  disco: RefObject<HTMLDivElement | null>
  rotor: RefObject<HTMLDivElement | null>
  indicador: RefObject<HTMLDivElement | null>
  dedo: RefObject<HTMLDivElement | null>
}

interface Props {
  refs: RefsPalco
  quartos: number
  /** 'girar': o jogo; 'parado': espera (anel apagado); 'travado': bloqueado (anel cinza, cadeado no lugar do indicador). */
  modo: 'girar' | 'parado' | 'travado'
  /** Aceita gesto e teclado (convite/girando). */
  interativo: boolean
  aoTecla?: (e: KeyboardEvent<HTMLDivElement>) => void
  aoSoltarTecla?: (e: KeyboardEvent<HTMLDivElement>) => void
  /** Mostra o dedo-guia e o adesivo "Gira a tampa" (convite). */
  convite: boolean
}

// as peças do desenho (~240 elementos de SVG) só dependem do id: memo, o quarto de volta re-renderiza só o anel
const CorpoAbertoM = memo(CorpoAberto)
const LabioCamaraM = memo(LabioCamara)
const LadoTampaM = memo(LadoTampa)
const FundoTampaM = memo(FundoTampa)
const RotorM = memo(Rotor)
const EstaticoM = memo(Estatico)

/** O palco (memo: o jogo re-renderiza a cada fase; o dichavador em SVG só muda com quartos, modo e convite). */
export const Palco = memo(function Palco({ refs, quartos, modo, interativo, aoTecla, aoSoltarTecla, convite }: Props) {
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
  return (
    <div ref={refs.palco} className={`sorte-palco sorte-palco-${modo}${interativo ? ' sorte-palco-ativo' : ''}`} data-lenis-prevent>
      <Anel refAnel={refs.anel} acesos={modo === 'girar' ? quartos : 0} tamanho={Math.max(40, tam - 4)} />
      <div ref={refs.corpo} className="sorte-corpo" style={caixaCorpo} aria-hidden="true">
        <CorpoAbertoM id={`${id}c`} />
      </div>
      <div ref={refs.labio} className="sorte-labio" style={caixaCorpo} aria-hidden="true">
        <LabioCamaraM id={`${id}l`} />
      </div>
      <div ref={refs.tampa} className="sorte-tampa">
        <div ref={refs.lado} className="sorte-lado" style={caixaCorpo} aria-hidden="true">
          <LadoTampaM id={`${id}t`} />
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
            <FundoTampaM id={`${id}f`} />
          </div>
          <div ref={refs.rotor} className="sorte-camada sorte-rotor">
            <RotorM id={`${id}r`} />
          </div>
          <div className="sorte-camada sorte-estatico">
            <EstaticoM id={`${id}e`} />
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
})

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
