import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type RefObject } from 'react'
import { config } from '../dados/config'
import { interativoPorId } from '../interativos/registro'
import { ID_SORTE, useEntradaSorte } from '../interativos/sorte/estado'
import { TE } from '../interativos/sorte/textos-entrada'
import { irParaAba } from '../lib/abas'
import { useLocal } from '../store/local'
import { Avatar, Icone } from './comum'
import { MercadorAnimado, marcarPassoVisto, useMercadorAnda } from './Mercador'
import './StoryMercador.css'

// "Story do mercador": o convite do Teste minha sorte com o mercador animado, no Início da Home 2.
//   'coluna'  computador largo (>= 1200): card de story menor ao lado do perfil, como os stories vizinhos do
//             visualizador do instagram.com. Adesivo de pergunta com o CTA, mercador de pé embaixo.
//   'deitada' computador estreito (900–1199): o mesmo card deitado, embaixo do perfil (mercador à esquerda).
//   'passo'   celular: o 2º passo do story do hero (sem moldura; o CTA vai no adesivo-link do pé do story).
// Um componente só: a entrada do interativo (i.useEntrada) é chamada aqui dentro, com a ordem de hooks estável.

export interface Convite {
  /** Interativo ativo (com prêmio, num estado atendido). Sem ele, o mercador vira "Vai levar o quê?" → loja. */
  ativo: boolean
  titulo: string
  pergunta: string
  texto?: string
  legenda?: string
  cta: string
  acao: () => void
  aceso: boolean
  novo: boolean
  ponto: boolean
  instagram: string | null
  exemplo: boolean
}

/** O convite do Teste minha sorte no estado da pessoa (A–E1), ou o "Ver loja" quando o jogo não está no ar. */
export function useConviteSorte(): Convite {
  const e = useEntradaSorte()
  // o interativo some num estado sem atendimento: re-renderiza quando o estado muda
  useLocal((s) => s.uf)
  const i = interativoPorId(ID_SORTE)
  const a = e.adesivo
  if (i && i.status === 'ativo' && i.ativo() && a) {
    return {
      ativo: true,
      titulo: a.titulo,
      pergunta: a.pergunta ?? TE.pergunta,
      texto: a.texto,
      legenda: a.legenda,
      cta: a.cta,
      acao: a.acao,
      aceso: e.aceso,
      novo: e.novo,
      ponto: e.ponto,
      instagram: e.instagram,
      exemplo: e.exemplo,
    }
  }
  return {
    ativo: false,
    titulo: 'GREEN CHEESE',
    pergunta: 'Vai levar o quê?',
    cta: 'Ver loja',
    acao: () => irParaAba('catalogo'),
    aceso: false,
    novo: false,
    ponto: false,
    instagram: e.instagram,
    exemplo: false,
  }
}

function consulta(q: string) {
  return {
    assinar: (avisar: () => void) => {
      try {
        const m = window.matchMedia(q)
        m.addEventListener('change', avisar)
        return () => m.removeEventListener('change', avisar)
      } catch {
        return () => {}
      }
    },
    ler: () => {
      try {
        return window.matchMedia(q).matches
      } catch {
        return false
      }
    },
  }
}
const GIGANTE = consulta('(min-width: 1800px)')
const LARGA = consulta('(min-width: 1440px)')

/** Teto da escala do mercador no card 'coluna': 5× (220 px) em tela gigante, 4× (176) em 1440+, 3× (132) abaixo. */
function useTetoColuna(): number {
  const gigante = useSyncExternalStore(GIGANTE.assinar, GIGANTE.ler, () => false)
  const larga = useSyncExternalStore(LARGA.assinar, LARGA.ler, () => false)
  return gigante ? 5 : larga ? 4 : 3
}

/**
 * A maior escala inteira do mercador (do teto até 2×) que cabe embaixo do adesivo, medida como o hero mede: na
 * coluna, um notebook baixo (1440×800) não tem altura para o 4×; no passo do celular, o 320×568 fica com o 2×.
 * Com `compactavel` (o card da coluna), o 3× vem antes do adesivo inteiro: se só o adesivo compacto (sem o título,
 * CTA numa linha) deixa o mercador em 3×, o card fica compacto (notebook com a barra do navegador, 1366×657); volta
 * ao inteiro quando o inteiro também deixaria o 3×.
 */
function useEscalaMedida(
  caixa: RefObject<HTMLDivElement | null>,
  adesivo: RefObject<HTMLDivElement | null>,
  teto: number,
  ligado: boolean,
  compactavel: boolean,
): { tamanho: number; compacto: boolean } {
  const [k, setK] = useState(Math.min(3, teto))
  const [compacto, setCompacto] = useState(false)
  // no compacto: quanto da altura do card o adesivo inteiro (com o respiro e o vão dele) ocupava
  const estado = useRef({ compacto: false, cheio: 0 })
  useLayoutEffect(() => {
    const c = caixa.current
    const a = adesivo.current
    if (!ligado || !c || !a) return
    const medir = () => {
      const st = getComputedStyle(c)
      const px = (v: string) => parseFloat(v) || 0
      // empilhado (coluna, passo em pé): a altura livre é a caixa sem o respiro, sem o adesivo e sem o vão do rabinho.
      // Lado a lado (passo do celular deitado): a altura toda, e a largura sem o adesivo e o vão
      const lado = st.flexDirection.startsWith('row')
      const alto = c.clientHeight - px(st.paddingTop) - px(st.paddingBottom) - (lado ? 0 : px(st.rowGap))
      const largura = c.clientWidth - px(st.paddingLeft) - px(st.paddingRight) - (lado ? a.offsetWidth + px(st.columnGap) : 0)
      const escala = (livre: number) => {
        let n = teto
        while (n > 2 && (64 * n > livre || 44 * n > largura)) n--
        return n
      }
      const e = estado.current
      const n = escala(alto - (lado ? 0 : a.offsetHeight))
      if (compactavel && !lado && teto >= 3) {
        if (!e.compacto && n < 3) {
          // tenta o compacto (o ResizeObserver do adesivo mede de novo); guarda o que o inteiro ocupava (adesivo,
          // respiro e vão, que também encolhem no compacto) para saber, pela altura do card, quando ele volta a caber
          e.compacto = true
          e.cheio = c.clientHeight - alto + a.offsetHeight
          setCompacto(true)
          return
        }
        if (e.compacto && escala(c.clientHeight - e.cheio) >= 3) {
          e.compacto = false
          setCompacto(false)
          return
        }
      }
      setK(n)
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(c)
    ro.observe(a)
    return () => ro.disconnect()
  }, [caixa, adesivo, teto, ligado, compactavel])
  return { tamanho: 44 * k, compacto }
}

/**
 * @ do perfil no cabeçalho do card: corta no meio, não no fim ("greencheese_imp…mg"), para o sufixo da UF — o que
 * diferencia um perfil do outro — ficar sempre à vista no card estreito.
 */
function NomePerfil({ nome }: { nome: string }) {
  const corte = /^greencheese_imports..$/.test(nome) ? nome.length - 2 : nome.length
  return (
    <span className="sm-cab-nome">
      <span className="sm-cab-ini">{nome.slice(0, corte)}</span>
      {corte < nome.length && <span className="sm-cab-fim">{nome.slice(corte)}</span>}
    </span>
  )
}

interface Props {
  variante: 'coluna' | 'deitada' | 'passo'
  /** Story segurado ou pausado (passo do celular): o mercador para junto. */
  parado?: boolean
}

export function StoryMercador({ variante, parado = false }: Props) {
  const c = useConviteSorte()
  const id = useId()
  const raiz = useRef<HTMLDivElement>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const adesivo = useRef<HTMLDivElement>(null)
  const cta = useRef<HTMLButtonElement>(null)
  const anda = useMercadorAnda(raiz, { parado })
  const teto = useTetoColuna()
  const passo = variante === 'passo'
  const medido = useEscalaMedida(caixa, adesivo, passo ? 4 : teto, variante !== 'deitada', variante === 'coluna')
  // deitada: a altura do card vem do mercador 3× (não há o que medir)
  const tamanho = variante === 'deitada' ? 132 : medido.tamanho

  // passo do celular: quando ele sai do story (depois de aparecer), o balão da barra pode entrar
  useEffect(() => {
    if (!passo) return
    const desde = performance.now()
    return () => {
      if (performance.now() - desde > 1500) marcarPassoVisto()
    }
  }, [passo])

  // card inteiro clicável com o mouse (o CTA continua sendo a única parada do Tab)
  const aoClicar = (e: MouseEvent<HTMLElement>) => {
    if (passo || (e.target as Element).closest('.sm-cta')) return
    cta.current?.click()
  }

  const disco = (
    <span className="sm-disco" aria-hidden="true">
      {c.ativo ? <Icone nome="dichavador" tamanho={32} /> : <Avatar tamanho={36} anel={false} />}
      {/* selo "novo" até a 1ª abertura, como na bolha do destaque */}
      {c.novo && !passo && <span className="sm-novo carimbo">novo</span>}
    </span>
  )

  const corpo = (
    <div ref={caixa} className="sm-corpo">
      <div ref={adesivo} className="sm-adesivo">
        {disco}
        <p className="sm-titulo px" id={`${id}-titulo`}>
          {c.titulo}
        </p>
        <p className="sm-pergunta">{c.pergunta}</p>
        {c.texto && !passo && <p className="sm-texto">{c.texto}</p>}
        {!passo && (
          <button ref={cta} type="button" className="sm-cta toque" onClick={c.acao}>
            {c.cta}
          </button>
        )}
        {variante === 'coluna' && (c.legenda || c.exemplo) && (
          <p className="sm-legenda">
            {c.legenda}
            {c.exemplo && <span className="carimbo">exemplo</span>}
          </p>
        )}
        <span className="sm-rabo" aria-hidden="true" />
      </div>
      <div className="sm-palco">
        <MercadorAnimado tamanho={tamanho} anda={anda} />
      </div>
    </div>
  )

  if (passo) {
    return (
      <div ref={raiz} className={`sm sm-passo${config.mercadorTraga ? ' com-trago' : ''}`}>
        {corpo}
      </div>
    )
  }

  return (
    <section
      ref={raiz}
      className={`sm sm-${variante}${medido.compacto ? ' sm-compacto' : ''}${config.mercadorTraga ? ' com-trago' : ''}`}
      aria-labelledby={`${id}-titulo`}
      onClick={aoClicar}
    >
      {variante === 'coluna' && (
        <>
          <div className="sm-barra" aria-hidden="true">
            <i className={anda ? undefined : 'parado'} />
          </div>
          <div className="sm-cab">
            <Avatar tamanho={28} className={c.aceso ? undefined : 'visto'} />
            <NomePerfil nome={c.instagram ?? 'greencheese'} />
            <span className="sm-cab-rot legenda">interativo</span>
          </div>
        </>
      )}
      {corpo}
    </section>
  )
}
