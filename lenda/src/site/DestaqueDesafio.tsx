/**
 * O destaque do desafio na tela inicial (v3.3): só aparece com um desafio valendo. A lista é pedida depois que a tela
 * pintou e o navegador sossegou (nada de atrasar a abertura do jogo); sem rede ou com o servidor antigo, nada aparece.
 * v3.4: o destaque grande é só do desafio de PRÊMIO valendo; sem ele, a faixa discreta dos desafios de emblema (uma linha,
 * 2 ou 3 desafios e "Ver todos" → #/desafios). Sem nenhum valendo (ou sem resposta do servidor), nada.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import { ArrowRight } from 'lucide-react'
import { navigate } from '@/store/app'
import { TrophyArt } from '@/ui/trophies'
import { Emblema } from '@/ui/shared/emblemas/Emblema'
import { criterioEmFrase, desafiosDaFaixa, temDesafioAtivo, textoCriterio, useDesafios, valendo, type Desafio } from './desafios'
import { useEmblemas } from './emblemas'
import './v33.css'
import './v34.css'

/** Espera antes de pedir a lista (a tela inicial e o jogo vêm primeiro). */
const ESPERA_MS = 1800

export default function DestaqueDesafio() {
  const ativo = useDesafios(temDesafioAtivo)
  const d = useDesafios((s) => s.lista.find((x) => x.modo !== 'emblema' && valendo(x)) ?? null)
  const lista = useDesafios((s) => s.lista)
  useEffect(() => {
    let feito = false
    const pedir = () => {
      if (feito) return
      feito = true
      void useDesafios.getState().carregar()
    }
    const ocioso = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const t = window.setTimeout(() => (ocioso ? ocioso(pedir, { timeout: 4000 }) : pedir()), ESPERA_MS)
    return () => window.clearTimeout(t)
  }, [])
  if (!ativo || !d) return <FaixaDesafios lista={desafiosDaFaixa(lista)} />
  const icone = d.criterio.todasConquistas ? 'ballon-dor' : 'world-cup'
  return (
    <button type="button" className="sv-destaque" onClick={() => navigate('/desafios')} aria-label={`Desafio valendo: ${d.titulo}. ${textoCriterio(d.criterio)}. Ver as regras`}>
      <span className="sv-destaque__i" aria-hidden="true">
        <TrophyArt id={icone} size={42} />
      </span>
      <span className="sv-destaque__t">
        <b>{d.titulo}</b>
        <span>
          Desafio valendo: {criterioEmFrase(d.criterio)}. O primeiro leva{d.premio ? `: ${d.premio.length > 80 ? `${d.premio.slice(0, 78)}…` : d.premio}` : ' o prêmio'}.
        </span>
      </span>
      <ArrowRight aria-hidden="true" />
    </button>
  )
}

/**
 * v3.4 §E: mede a faixa (e de novo a cada mudança de largura): no celular, a frase "com emblema" sai inteira ou não sai (nada de
 * "Desafios c…"); no computador, o desafio que desceu para a 2ª linha (escondida) sai do Tab e do leitor de tela. Direto no DOM
 * (classe e atributos que o React não controla), para medir sem esperar outro render. Sem ResizeObserver: como antes.
 */
export function medirFaixa(nav: HTMLElement) {
  nav.classList.remove('is-curta')
  const c = nav.querySelector<HTMLElement>('.s4-faixa__c')
  if (c && c.getClientRects().length && c.scrollWidth > c.clientWidth + 1) nav.classList.add('is-curta')
  const bs = [...nav.querySelectorAll<HTMLElement>('.s4-faixa__d')]
  const topo = bs[0]?.offsetTop ?? 0
  for (const b of bs) {
    const fora = b.offsetTop > topo + 2
    b.classList.toggle('is-fora', fora)
    if (fora) {
      b.tabIndex = -1
      b.setAttribute('aria-hidden', 'true')
    } else {
      b.removeAttribute('tabindex')
      b.removeAttribute('aria-hidden')
    }
  }
}

/** v3.4: a faixa discreta dos desafios de emblema (uma linha: 2 ou 3 desafios e "Ver todos"). */
export function FaixaDesafios({ lista }: { lista: readonly Desafio[] }) {
  const meus = useEmblemas((s) => s.meus)
  const ref = useRef<HTMLElement>(null)
  const chave = lista.map((x) => x.slug).join(',')
  useLayoutEffect(() => {
    const nav = ref.current
    if (!nav || typeof ResizeObserver === 'undefined') return
    medirFaixa(nav)
    const ro = new ResizeObserver(() => medirFaixa(nav))
    ro.observe(nav)
    return () => ro.disconnect()
  }, [chave, meus])
  if (!lista.length) return null
  const tem = new Set((meus ?? []).map((e) => e.slug))
  return (
    <nav ref={ref} className="s4-faixa" aria-label="Desafios: ganhe emblemas">
      <span className="s4-faixa__k">Desafios</span>
      {/* no celular só os emblemas (o nome de cada um vai no aria-label e no title) e esta frase curta */}
      <span className="s4-faixa__c" aria-hidden="true">
        com emblema
      </span>
      <span className="s4-faixa__l">
        {lista.map((x) => (
          <button
            key={x.slug}
            type="button"
            className={tem.has(x.slug) ? 's4-faixa__d is-tem' : 's4-faixa__d'}
            onClick={() => navigate('/desafios', { query: { d: x.slug } })}
            aria-label={`Desafio ${x.titulo}${tem.has(x.slug) ? ' (você já tem o emblema)' : ''}: ${textoCriterio(x.criterio)}`}
            title={x.titulo}
          >
            {x.emblema && <Emblema e={x.emblema} size={20} rotulo={null} />}
            <span className="s4-faixa__n">{x.titulo}</span>
          </button>
        ))}
      </span>
      <button type="button" className="s4-faixa__todos" onClick={() => navigate('/desafios')}>
        Ver todos <ArrowRight aria-hidden="true" />
      </button>
    </nav>
  )
}
