// O adesivo "Ver o Mercado" que sai quando chamam o mercador (na faixa do computador e no story do celular) e o que o
// leitor de tela ouve. No pedaço principal: o story do celular mostra o adesivo antes de a rua chegar.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Chamado } from './roteiro'

/** Quanto tempo o adesivo do Mercado fica à vista depois do chamado (sem foco nem mouse em cima). */
export const CTA_MS = 7000

/** O adesivo do Mercado: abre no chamado e some sozinho depois de CTA_MS, menos com foco ou mouse em cima. */
export function useCtaMercado() {
  const [visivel, setVisivel] = useState(false)
  const ref = useRef<HTMLAnchorElement>(null)
  const timer = useRef(0)
  const esconder = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const l = ref.current
      if (l && (l.matches(':focus') || l.matches(':hover'))) return esconder()
      setVisivel(false)
    }, CTA_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const abrir = useCallback(() => {
    setVisivel(true)
    esconder()
  }, [esconder])
  return { visivel, abrir, esconder, ref }
}

/** O que o leitor de tela ouve quando chamam o mercador: o que de fato acontece na cena. */
export function avisoDoChamado(c: Chamado, rodando: boolean): string {
  if (c === 'foto') return 'O mercador ofereceu o Mercado.'
  if (!rodando) return 'O mercador ofereceu o Mercado. A rua está parada: ele abre o casaco quando ela voltar a andar.'
  if (c === 'depois') return 'O mercador ofereceu o Mercado. Ele abre o casaco assim que terminar o atendimento.'
  return 'O mercador ofereceu o Mercado e abre o casaco.'
}
