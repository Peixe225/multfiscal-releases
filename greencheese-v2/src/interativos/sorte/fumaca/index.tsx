// A revelação da fumaça do Teste minha sorte (pedido do Ian em 11/10): o beck bolado sai da câmara do dichavador, é
// aceso e fumado, solta muita fumaça e o prêmio aparece destacado no meio dela; quanto mais raro, mais viajada.
// Componente sozinho (não lê store do site): o jogo (JogoSorte) e o painel (Testar a animação) usam o mesmo.
// CONTRATO: as props abaixo. Este arquivo começa como esboço e a frente da animação troca o corpo pelo de verdade.
import type { ReactNode } from 'react'
import { INFO_RARIDADE, type Raridade } from '../../../lib/raridade'

export interface PremioNaFumaca {
  /** O destaque em pixel: "15% OFF", "LEVA 4 PAGA 3", "BRINDE". */
  destaque: string
  /** O nome do produto (ou da categoria) do prêmio. */
  produto: string
  raridade: Raridade
}

export interface PropsRevelacaoFumaca {
  premio: PremioNaFumaca
  /** O desenho/foto do produto, pintado por quem chama (o site usa o ProdutoVisual; o painel, a foto do produto). */
  visual?: ReactNode
  /** 'jogo': dentro do Teste minha sorte; 'previa': o teste do painel (mostra o selo PRÉVIA e nunca vale cupom). */
  modo: 'jogo' | 'previa'
  /** Movimento reduzido: sem animação, já no quadro final (a fumaça parada e o prêmio). */
  reduzido?: boolean
  /** A animação chegou no auge (o prêmio no meio da fumaça) e assentou. */
  onPronto?: () => void
  /** A pessoa tocou pra pular. */
  onPular?: () => void
}

/** Esboço: o quadro final parado. A frente da animação troca por inteiro. */
export function RevelacaoFumaca({ premio, visual, modo }: PropsRevelacaoFumaca) {
  const info = INFO_RARIDADE[premio.raridade]
  return (
    <div className="fumaca-esboco" data-raridade={premio.raridade} data-modo={modo} style={{ color: info.cor }}>
      {visual}
      <strong>{premio.destaque}</strong> <span>{premio.produto}</span> <em>{info.carimbo}</em>
    </div>
  )
}
