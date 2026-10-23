/**
 * O destaque do desafio na tela inicial (v3.3), já com a lista pedida: só aparece com um desafio valendo. Carregado pelo
 * ./DestaqueDesafio depois que a tela pintou e o navegador sossegou (v3.5: este pedaço — a lista dos desafios, os
 * emblemas, os ícones e o troféu — não vem mais junto com a tela inicial); sem rede ou com o servidor antigo, nada aparece.
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
import { medirFaixa } from './DestaqueDesafio'
import './v33.css'
import './v34.css'

export default function DestaqueDesafioCorpo() {
  const ativo = useDesafios(temDesafioAtivo)
  const d = useDesafios((s) => s.lista.find((x) => x.modo !== 'emblema' && valendo(x)) ?? null)
  const lista = useDesafios((s) => s.lista)
  useEffect(() => {
    void useDesafios.getState().carregar()
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
          Desafio valendo: {criterioEmFrase(d.criterio)}. O primeiro leva{fraseDoPremio(d.premio)}
        </span>
      </span>
      <ArrowRight aria-hidden="true" />
    </button>
  )
}

/**
 * v3.5: o fim da frase do destaque (": <prêmio>." ou " o prêmio."). O prêmio escrito no painel com ponto no fim não sai
 * com dois pontos ("…(texto).."), e o cortado em 80 letras termina nas reticências.
 */
export function fraseDoPremio(premio: string | null | undefined): string {
  const p = (premio ?? '').trim().replace(/[\s.]+$/, '')
  if (!p) return ' o prêmio.'
  if (p.length > 80) return `: ${p.slice(0, 78).trimEnd()}…`
  return /[!?…]$/.test(p) ? `: ${p}` : `: ${p}.`
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
