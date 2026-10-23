// O carimbo da raridade do prêmio (pedido do Ian em 11/10) nos cupons fora do jogo: Minha conta, o "Hoje saiu" da
// espera e a sacola. O mesmo carimbo do prêmio na fumaça e no story, em pequeno. Sozinho (estilo no próprio elemento):
// a sacola não baixa o CSS do jogo.
import type { CSSProperties } from 'react'
import { INFO_RARIDADE, raridadeDe, type Raridade } from '../../lib/raridade'
import { TINTA_RARIDADE } from './fumaca/tinta'

/** A raridade de um cupom (o retrato do prêmio congelado no dia em que saiu); sem o campo (os de antes de 11/10), comum. */
export function raridadeDoRetrato(r: object | null | undefined): Raridade {
  return raridadeDe(r as { raridade?: unknown } | null | undefined)
}

const HOLO = 'linear-gradient(105deg, #ffc53d 0%, #fff1b8 22%, #ff5fb0 45%, #35d4ff 68%, #9466ff 86%, #ffc53d 100%)'

export function SeloRaridade({ raridade, apagado = false, className }: { raridade: Raridade; apagado?: boolean; className?: string }) {
  const info = INFO_RARIDADE[raridade]
  const estilo: CSSProperties = {
    display: 'inline-block',
    flex: 'none',
    padding: '3px 6px 2px',
    fontSize: 12,
    fontWeight: 400,
    lineHeight: 1,
    letterSpacing: '0.04em',
    color: apagado ? '#d0d0d0' : TINTA_RARIDADE[raridade],
    background: apagado ? '#3a3a3a' : raridade === 'lendario' ? HOLO : info.cor,
    border: '2px solid #000',
    borderRadius: 3,
    boxShadow: '2px 2px 0 #000',
    rotate: '-4deg',
    whiteSpace: 'nowrap',
    verticalAlign: 'middle',
  }
  return (
    <span className={`selo-raridade px${className ? ` ${className}` : ''}`} style={estilo} data-raridade={raridade}>
      <span className="sr-only">Raridade: </span>
      {info.carimbo}
    </span>
  )
}
