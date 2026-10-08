// As seções do painel, na ordem da lateral (computador) e da barra (celular). Seção nova (produtos, prêmios,
// ajustes, pedidos) entra aqui com a tela dela em Painel.tsx: a lateral mostra todas; a barra do celular, as que têm
// `barra` (no máximo 5). Só entra o que já funciona.
import type { Rota } from './rotas'
import { caminho } from './rotas'

export interface Secao {
  id: string
  nome: string
  href: string
  icone: string
  iconeAtivo: string
  /** Telas que acendem esta seção. */
  telas: Rota['tela'][]
  /** Mostra na barra de baixo do celular. */
  barra: boolean
}

export const secoes: Secao[] = [
  { id: 'resumo', nome: 'Resumo', href: caminho.resumo, icone: 'casa', iconeAtivo: 'casa-cheia', telas: ['resumo'], barra: true },
  { id: 'rateios', nome: 'Rateios', href: caminho.rateios, icone: 'caixa', iconeAtivo: 'caixa-cheia', telas: ['rateios', 'rateio', 'editar'], barra: true },
  { id: 'novo', nome: 'Criar rateio', href: caminho.novo, icone: 'criar', iconeAtivo: 'criar-cheio', telas: ['novo'], barra: true },
  { id: 'atividade', nome: 'Atividade', href: caminho.atividade, icone: 'coracao', iconeAtivo: 'coracao-cheio', telas: ['atividade'], barra: true },
  { id: 'conta', nome: 'Conta', href: caminho.conta, icone: 'conta', iconeAtivo: 'conta', telas: ['conta'], barra: true },
  { id: 'servidor', nome: 'Servidor', href: caminho.servidor, icone: 'servidor', iconeAtivo: 'servidor-cheio', telas: ['servidor'], barra: false },
]
