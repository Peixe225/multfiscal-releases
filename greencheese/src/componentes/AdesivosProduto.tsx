import { gsap } from 'gsap'
import { brl } from '../lib/formato'
import { movimentoReduzido } from '../lib/movimento'
import { calcularLinha } from '../lib/preco'
import type { Produto } from '../lib/tipos'
import { Icone } from './comum'
import './AdesivosProduto.css'

// Adesivos interativos do produto (enquete, quiz, link da sacola): os mesmos no story aberto e na página do produto.

/** Variação = adesivo de enquete. A metade escolhida enche. */
export function EnqueteVariacao({ produto, valor, mudar }: { produto: Produto; valor: string | null; mudar: (v: string) => void }) {
  const vs = produto.variacoes ?? []
  return (
    <div className="ad-enquete" role="radiogroup" aria-label="Formato">
      {vs.map((v) => {
        const [titulo, ...resto] = v.nome.split('·')
        const sel = v.id === valor
        return (
          <button key={v.id} type="button" role="radio" aria-checked={sel} className={`ad-enquete-op ${sel ? 'sel' : ''}`} onClick={() => mudar(v.id)}>
            <span className="ad-enquete-cheio" aria-hidden="true" />
            <span className="ad-enquete-txt">
              <strong>{titulo.trim()}</strong>
              {resto.length > 0 && <small>{resto.join('·').trim()}</small>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Combo = adesivo de quiz: cada linha é um preço; tocar escolhe a quantidade. */
export function QuizCombo({ produto, qtd, mudar }: { produto: Produto; qtd: number; mudar: (q: number) => void }) {
  const linhas = [{ qtd: 1, total: produto.preco ?? 0 }, ...(produto.combos ?? [])]
  return (
    <div className="ad-quiz" role="radiogroup" aria-label="Quanto leva">
      <p className="ad-quiz-topo">Quanto leva?</p>
      {linhas.map((l) => (
        <button key={l.qtd} type="button" role="radio" aria-checked={qtd === l.qtd} className={`ad-quiz-linha ${qtd === l.qtd ? 'sel' : ''}`} onClick={() => mudar(l.qtd)}>
          <span className="ad-quiz-letra">{l.qtd}</span>
          <span>
            {l.qtd} por {brl(l.total)}
          </span>
          {l.qtd > 1 && <span className="ad-quiz-cada">{brl(Math.round((l.total / l.qtd) * 100) / 100)} cada</span>}
        </button>
      ))}
    </div>
  )
}

/** − quantidade + (o adesivo de link usa; a barra da página do produto também). */
export function SeletorQtd({ qtd, mudar, className, tamanhoIcone = 14 }: { qtd: number; mudar: (q: number) => void; className?: string; tamanhoIcone?: number }) {
  return (
    <div className={className ? `ad-qtd ${className}` : 'ad-qtd'} role="group" aria-label="Quantidade">
      <button type="button" className="icone-botao toque" onClick={() => mudar(Math.max(1, qtd - 1))} aria-label="Menos um" disabled={qtd <= 1}>
        <Icone nome="menos" tamanho={tamanhoIcone} />
      </button>
      <span className="px px-20" aria-live="polite">
        {qtd}
      </span>
      <button type="button" className="icone-botao toque" onClick={() => mudar(Math.min(99, qtd + 1))} aria-label="Mais um">
        <Icone nome="mais" tamanho={tamanhoIcone} />
      </button>
    </div>
  )
}

/** Empurrão de combo: "leva mais 1 e as 3 saem por R$ 19,99". Sem combo na próxima quantidade, nada. */
export function Empurrao({ produto, qtd, className }: { produto: Produto; qtd: number; className?: string }) {
  const prox = produto.combos?.find((cb) => cb.qtd === qtd + 1)
  if (!prox) return null
  return (
    <p className={className ? `ad-empurrao px px-n ${className}` : 'ad-empurrao px px-n'}>
      Leva mais 1 e as {prox.qtd} saem por {brl(prox.total)}
    </p>
  )
}

/** "Pôr na sacola" = adesivo de link, com a quantidade dentro. */
export function AdesivoSacola({ produto, variacao, qtd, mudar, aoPor }: { produto: Produto; variacao: string | null; qtd: number; mudar: (q: number) => void; aoPor: () => void }) {
  const c = calcularLinha(produto, qtd, variacao)
  return (
    <>
      <div className="ad-sacola">
        <SeletorQtd qtd={qtd} mudar={mudar} />
        <button type="button" className="ad-por toque" onClick={aoPor}>
          <Icone nome="sacola" tamanho={18} />
          <span>Pôr na sacola</span>
          {c.total != null && c.total > 0 && <span className="ad-por-preco">{brl(c.total)}</span>}
        </button>
      </div>
      <Empurrao produto={produto} qtd={qtd} />
    </>
  )
}

/**
 * "Pôr na sacola": a arte vira uma miniatura e desce (ou sobe) até a sacola, como mandar um story por DM.
 * `caixa` é o elemento que contém a arte do produto (o .pv-real ou o canvas da pixel art).
 */
export function voarAteSacola(caixa: HTMLElement | null, alvo: HTMLElement | null) {
  if (!alvo || movimentoReduzido()) {
    pulsar(alvo)
    return
  }
  const real = caixa?.querySelector<HTMLElement>('.pv-real')
  const tela = caixa?.querySelector<HTMLCanvasElement>('canvas')
  const origem = real ?? tela
  if (!caixa || !origem) return
  const r = caixa.getBoundingClientRect()
  const a = alvo.getBoundingClientRect()
  let c: HTMLElement
  if (real) {
    c = real.cloneNode(true) as HTMLElement
  } else {
    const cv = document.createElement('canvas')
    cv.width = tela!.width
    cv.height = tela!.height
    cv.getContext('2d')?.drawImage(tela!, 0, 0)
    c = cv
  }
  c.removeAttribute('class')
  c.classList.add('voo-miniatura')
  Object.assign(c.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  document.body.appendChild(c)
  const escala = Math.min(1, 26 / r.width)
  gsap
    .timeline({ onComplete: () => c.remove() })
    .to(c, { scale: 0.5, duration: 0.18, ease: 'power2.out', transformOrigin: '50% 50%' })
    .to(c, {
      x: a.left + a.width / 2 - (r.left + r.width / 2),
      y: a.top + a.height / 2 - (r.top + r.height / 2),
      scale: escala,
      duration: 0.42,
      ease: 'power3.in',
    })
    .to(c, { opacity: 0, duration: 0.08, ease: 'steps(1)' })
    .add(() => pulsar(alvo), '-=0.06')
}

/** O contador da sacola pula em degraus (voz pixel). */
export function pulsar(alvo: HTMLElement | null) {
  if (!alvo || movimentoReduzido()) return
  gsap.fromTo(alvo, { scale: 1.25 }, { scale: 1, duration: 0.3, ease: 'steps(3)' })
}
