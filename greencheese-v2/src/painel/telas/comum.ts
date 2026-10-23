// Ajudas das telas: voltar pra mesma altura da rolagem e o título da aba do navegador.
import { useEffect, useLayoutEffect, useRef } from 'react'
import { rolagemGuardada } from '../rotas'

/** Assim que a tela tem o que mostrar, volta pra rolagem guardada dela (0 numa tela nova). */
export function useRestaurarRolagem(pronto: boolean): void {
  const feito = useRef(false)
  useLayoutEffect(() => {
    if (!pronto || feito.current) return
    feito.current = true
    window.scrollTo(0, rolagemGuardada())
  }, [pronto])
}

const BASE = 'Painel · Green Cheese'

export function useTitulo(nome: string | null): void {
  useEffect(() => {
    document.title = nome ? `${nome} · ${BASE}` : BASE
    return () => {
      document.title = BASE
    }
  }, [nome])
}
