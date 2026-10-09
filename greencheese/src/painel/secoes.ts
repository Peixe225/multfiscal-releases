// As seções do painel, na ordem da lateral (computador) e da barra (celular). Seção nova (produtos, prêmios,
// ajustes, pedidos) entra aqui com a tela dela em Painel.tsx e a permissão que ela pede (a do mapa do servidor,
// equipe.php): a lateral mostra as que o papel pode; a barra do celular, as que têm o papel em `barra` (no máximo 5
// por papel). Só entra o que já funciona.
import { pode } from './permissoes'
import type { Rota } from './rotas'
import { caminho } from './rotas'
import type { Papel, Usuario } from './tipos'

export interface Secao {
  id: string
  nome: string
  href: string
  icone: string
  iconeAtivo: string
  /** Telas que acendem esta seção. */
  telas: Rota['tela'][]
  /** Papéis que têm a seção na barra de baixo do celular (no máximo 5 por papel). */
  barra: Papel[]
  /** A permissão que a seção pede (a mesma do servidor). */
  permissao: string
}

const TODOS: Papel[] = ['dono', 'gerente', 'atendente']

export const secoes: Secao[] = [
  { id: 'resumo', nome: 'Resumo', href: caminho.resumo, icone: 'casa', iconeAtivo: 'casa-cheia', telas: ['resumo'], barra: TODOS, permissao: 'resumo' },
  // loja (produtos, estados, stories, textos e Teste minha sorte; só o dono por enquanto): no celular, pelo Resumo
  // (atalhos) e por Conta → "Mais do painel"
  { id: 'produtos', nome: 'Produtos', href: caminho.produtos, icone: 'sacola', iconeAtivo: 'sacola-cheia', telas: ['produtos', 'produto', 'produto-novo'], barra: [], permissao: 'loja' },
  { id: 'loja', nome: 'Loja', href: caminho.loja, icone: 'loja', iconeAtivo: 'loja-cheia', telas: ['loja', 'estados', 'estado', 'stories', 'categorias', 'sorte', 'premio'], barra: [], permissao: 'loja' },
  { id: 'rateios', nome: 'Rateios', href: caminho.rateios, icone: 'caixa', iconeAtivo: 'caixa-cheia', telas: ['rateios', 'rateio', 'editar'], barra: TODOS, permissao: 'rateios-ver' },
  { id: 'novo', nome: 'Criar rateio', href: caminho.novo, icone: 'criar', iconeAtivo: 'criar-cheio', telas: ['novo'], barra: ['dono', 'gerente'], permissao: 'rateios' },
  // pedidos do site, avisos no WhatsApp e falas do pedido guiado: no celular do dono, pelo Resumo e por Conta → "Mais do
  // painel"; na barra de quem atende (gerente e atendente)
  { id: 'pedidos', nome: 'Pedidos', href: caminho.pedidos, icone: 'pedido', iconeAtivo: 'pedido-cheio', telas: ['pedidos', 'pedido'], barra: ['gerente', 'atendente'], permissao: 'pedidos' },
  { id: 'atividade', nome: 'Atividade', href: caminho.atividade, icone: 'coracao', iconeAtivo: 'coracao-cheio', telas: ['atividade'], barra: ['dono', 'atendente'], permissao: 'atividade' },
  { id: 'avisos', nome: 'Avisos no WhatsApp', href: caminho.avisos, icone: 'sino', iconeAtivo: 'sino-cheio', telas: ['avisos'], barra: [], permissao: 'avisos' },
  { id: 'textos', nome: 'Textos do pedido', href: caminho.textos, icone: 'balao', iconeAtivo: 'balao-cheio', telas: ['textos'], barra: [], permissao: 'textos' },
  // contas: a equipe (logins e papéis) e os clientes do site (só o dono)
  { id: 'clientes', nome: 'Clientes', href: caminho.clientes, icone: 'clientes', iconeAtivo: 'clientes-cheio', telas: ['clientes', 'cliente'], barra: [], permissao: 'clientes' },
  { id: 'equipe', nome: 'Equipe', href: caminho.equipe, icone: 'equipe', iconeAtivo: 'equipe-cheia', telas: ['equipe', 'usuario'], barra: [], permissao: 'equipe' },
  { id: 'conta', nome: 'Conta', href: caminho.conta, icone: 'conta', iconeAtivo: 'conta', telas: ['conta'], barra: TODOS, permissao: 'conta' },
  { id: 'servidor', nome: 'Servidor', href: caminho.servidor, icone: 'servidor', iconeAtivo: 'servidor-cheio', telas: ['servidor'], barra: [], permissao: 'servidor' },
]

/** As seções que o papel de quem está logado pode abrir. */
export function secoesDo(u: Usuario | null): Secao[] {
  return secoes.filter((s) => pode(s.permissao, u))
}

/** As da barra de baixo do celular pra esse papel (no máximo 5). */
export function barraDo(u: Usuario | null): Secao[] {
  const papel: Papel = u?.papel ?? 'dono'
  return secoesDo(u)
    .filter((s) => s.barra.includes(papel))
    .slice(0, 5)
}

/** A seção que tem essa tela (pra saber se o papel pode abrir). */
export function secaoDaTela(tela: Rota['tela']): Secao | undefined {
  return secoes.find((s) => s.telas.includes(tela))
}
