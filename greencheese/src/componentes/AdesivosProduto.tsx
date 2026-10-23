import { gsap } from 'gsap'
import type { KeyboardEvent } from 'react'
import { brl } from '../lib/formato'
import { movimentoReduzido } from '../lib/movimento'
import { calcularLinha } from '../lib/preco'
import type { Produto } from '../lib/tipos'
import { Icone } from './comum'
import './AdesivosProduto.css'

// Adesivos interativos do produto (enquete, quiz, link da sacola): os mesmos no story aberto e na página do produto.

/**
 * Grupo de rádio no teclado: só o marcado é parada de Tab (sem marcado, o 1º) e as setas, Home e End trocam a escolha
 * levando o foco junto. As setas não passam o story por baixo.
 */
function setasRadio<T>(e: KeyboardEvent<HTMLElement>, valores: T[], atual: T | null, mudar: (v: T) => void) {
  const n = valores.length
  const i = atual == null ? -1 : valores.indexOf(atual)
  let j = -1
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (i + 1) % n
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = i < 0 ? n - 1 : (i - 1 + n) % n
  else if (e.key === 'Home') j = 0
  else if (e.key === 'End') j = n - 1
  if (j < 0 || !n) return
  e.preventDefault()
  e.stopPropagation()
  mudar(valores[j])
  e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[j]?.focus()
}

/** Variação = adesivo de enquete. A metade escolhida enche. */
export function EnqueteVariacao({ produto, valor, mudar }: { produto: Produto; valor: string | null; mudar: (v: string) => void }) {
  const vs = produto.variacoes ?? []
  const parada = vs.some((v) => v.id === valor) ? valor : vs[0]?.id
  return (
    <div
      className="ad-enquete"
      role="radiogroup"
      aria-label="Formato"
      onKeyDown={(e) =>
        setasRadio(
          e,
          vs.map((v) => v.id),
          valor,
          mudar,
        )
      }
    >
      {vs.map((v) => {
        const [titulo, ...resto] = v.nome.split('·')
        const sel = v.id === valor
        return (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={sel}
            tabIndex={v.id === parada ? 0 : -1}
            className={`ad-enquete-op ${sel ? 'sel' : ''}`}
            onClick={() => mudar(v.id)}
          >
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

/** Combo = adesivo de quiz: cada linha é um preço; tocar escolhe a quantidade. Acima do que resta, a linha apaga. */
export function QuizCombo({ produto, qtd, mudar, max = 99 }: { produto: Produto; qtd: number; mudar: (q: number) => void; max?: number }) {
  const linhas = [{ qtd: 1, total: produto.preco ?? 0 }, ...(produto.combos ?? [])]
  // as setas e a parada de Tab só andam pelas linhas que dá pra levar (acima do que resta, a linha apaga)
  const cabem = linhas.filter((l) => l.qtd <= max).map((l) => l.qtd)
  // fora do combo (ex.: 4 pelo − +), nenhuma linha marcada: a parada de Tab fica na 1ª
  const parada = cabem.includes(qtd) ? qtd : (cabem[0] ?? 1)
  return (
    <div
      className="ad-quiz"
      role="radiogroup"
      aria-label="Quanto leva"
      onKeyDown={(e) =>
        setasRadio(
          e,
          cabem,
          cabem.includes(qtd) ? qtd : null,
          mudar,
        )
      }
    >
      <p className="ad-quiz-topo" aria-hidden="true">
        Quanto leva?
      </p>
      {linhas.map((l) => (
        <button
          key={l.qtd}
          type="button"
          role="radio"
          aria-checked={qtd === l.qtd}
          tabIndex={l.qtd === parada ? 0 : -1}
          className={`ad-quiz-linha ${qtd === l.qtd ? 'sel' : ''}`}
          disabled={l.qtd > max}
          onClick={() => mudar(l.qtd)}
        >
          {/* o número do quiz é enfeite: o leitor ouve "2 por R$ 14,99", sem o "2" repetido */}
          <span className="ad-quiz-letra" aria-hidden="true">
            {l.qtd}
          </span>
          <span>
            {l.qtd} por {brl(l.total)}
          </span>
          {l.qtd > 1 && <span className="ad-quiz-cada">{brl(Math.round((l.total / l.qtd) * 100) / 100)} cada</span>}
        </button>
      ))}
    </div>
  )
}

/** − quantidade + (o adesivo de link usa; a barra da página do produto também). `max`: o que resta no estado. */
export function SeletorQtd({ qtd, mudar, className, tamanhoIcone = 14, max = 99 }: { qtd: number; mudar: (q: number) => void; className?: string; tamanhoIcone?: number; max?: number }) {
  return (
    <div className={className ? `ad-qtd ${className}` : 'ad-qtd'} role="group" aria-label="Quantidade">
      <button type="button" className="icone-botao toque" onClick={() => mudar(Math.max(1, qtd - 1))} aria-label="Menos um" disabled={qtd <= 1}>
        <Icone nome="menos" tamanho={tamanhoIcone} />
      </button>
      <span className="px px-20" aria-live="polite">
        {qtd}
      </span>
      <button type="button" className="icone-botao toque" onClick={() => mudar(Math.min(max, qtd + 1))} aria-label="Mais um" disabled={qtd >= max}>
        <Icone nome="mais" tamanho={tamanhoIcone} />
      </button>
    </div>
  )
}

/** Empurrão de combo: "leva mais 1 e as 3 saem por R$ 19,99". Sem combo na próxima quantidade (ou sem estoque pra ela), nada. */
export function Empurrao({ produto, qtd, className, max = 99 }: { produto: Produto; qtd: number; className?: string; max?: number }) {
  const prox = produto.combos?.find((cb) => cb.qtd === qtd + 1)
  if (!prox || prox.qtd > max) return null
  return (
    <p className={className ? `ad-empurrao px px-n ${className}` : 'ad-empurrao px px-n'}>
      Leva mais 1 e as {prox.qtd} saem por {brl(prox.total)}
    </p>
  )
}

/** "Pôr na sacola" = adesivo de link, com a quantidade dentro (até o que resta no estado). */
export function AdesivoSacola({
  produto,
  variacao,
  qtd,
  mudar,
  aoPor,
  max = 99,
}: {
  produto: Produto
  variacao: string | null
  qtd: number
  mudar: (q: number) => void
  aoPor: () => void
  max?: number
}) {
  const c = calcularLinha(produto, qtd, variacao)
  return (
    <>
      <div className="ad-sacola">
        <SeletorQtd qtd={qtd} mudar={mudar} max={max} />
        <button type="button" className="ad-por toque" onClick={aoPor}>
          <Icone nome="sacola" tamanho={18} />
          <span>Pôr na sacola</span>
          {c.total != null && c.total > 0 && <span className="ad-por-preco">{brl(c.total)}</span>}
        </button>
      </div>
      <Empurrao produto={produto} qtd={qtd} max={max} />
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
